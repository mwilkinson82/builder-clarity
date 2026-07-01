import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  agingBucket,
  computeProjectWIP,
  type BillingMethod,
  type ProjectWIPResult,
  type WIPBucketInput,
} from "@/lib/wip";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DynamicSupabaseResult>;
};
type BillingServerContext = {
  supabase: DynamicSupabaseClient;
  userId: string;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0));
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const bool = (value: unknown) => (typeof value === "boolean" ? value : Boolean(value));
const dollarsToCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
const centsToDollars = (value: unknown) => num(value) / 100;
const normalizeKey = (value: string) => value.trim().toLowerCase();
const billingLineRetainageSelect =
  "id,project_id,billing_application_id,work_completed_previous_cents,materials_stored_previous_cents,work_completed_this_period_cents,materials_stored_this_period_cents,retainage_pct,retainage_released_cents";

function billingLineRetainageCapCents(
  line: Record<string, unknown>,
  retainagePct: number,
  patch: Record<string, number> = {},
) {
  const completedAndStored =
    num(line.work_completed_previous_cents) +
    num(line.materials_stored_previous_cents) +
    num(patch.work_completed_this_period_cents ?? line.work_completed_this_period_cents) +
    num(patch.materials_stored_this_period_cents ?? line.materials_stored_this_period_cents);

  return Math.max(0, Math.round(completedAndStored * (retainagePct / 100)));
}

function isMissingRestRelation(error: DynamicSupabaseError | null, relation: string) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" &&
    (message.includes(`'public.${relation}'`) ||
      message.includes(`'${relation}'`) ||
      message.includes("schema cache"))
  );
}

async function requireCanReadProject(context: BillingServerContext, projectId: string) {
  const { data, error } = await context.supabase.rpc("can_read_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have access to this project.");
}

async function requireCanManageProject(context: BillingServerContext, projectId: string) {
  const { data, error } = await context.supabase.rpc("can_manage_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You do not have permission to manage this project.");
}

export interface BillingLineItemRow {
  id: string;
  billing_application_id: string;
  project_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  billing_method: BillingMethod;
  scheduled_value_cents: number;
  change_order_value_cents: number;
  work_completed_previous_cents: number;
  materials_stored_previous_cents: number;
  work_completed_this_period_cents: number;
  materials_stored_this_period_cents: number;
  work_completed_to_date_cents: number;
  materials_stored_to_date_cents: number;
  total_completed_and_stored_cents: number;
  billing_percent_complete: number;
  balance_to_finish_cents: number;
  retainage_pct: number;
  retainage_held_cents: number;
  retainage_released_cents: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CostActualRow {
  id: string;
  project_id: string;
  cost_bucket_id: string | null;
  import_batch_id: string | null;
  cost_code: string;
  description: string;
  category: "direct" | "labor" | "material" | "equipment" | "subcontract" | "overhead";
  amount: number;
  vendor: string;
  reference_number: string;
  source_row_hash: string;
  source_external_id: string;
  cost_date: string;
  status: "committed" | "paid" | "void";
  notes: string;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostActualImportRow {
  cost_bucket_id?: string | null;
  cost_code?: string;
  description: string;
  category?: "direct" | "labor" | "material" | "equipment" | "subcontract" | "overhead";
  amount: number;
  vendor?: string;
  reference_number?: string;
  cost_date: string;
  status?: "committed" | "paid";
  notes?: string;
}

export interface ChangeOrderAllocationRow {
  id: string;
  project_id: string;
  change_order_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
}

type ProjectRecord = {
  id: string;
  name: string;
  original_contract: number;
  percent_complete: number;
};

type BucketRecord = {
  id: string;
  project_id: string;
  cost_code: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  sort_order: number;
  retainage_pct: number;
  billing_method: BillingMethod;
  contract_quantity: number;
  unit: string;
  earned_percent_complete: number;
};

type BillingApplicationRecord = {
  id: string;
  project_id: string;
  amount_billed: number;
  paid_to_date: number;
  retainage: number;
  sort_order: number;
  submitted_date: string | null;
  due_date: string | null;
  has_line_detail: boolean;
};

type BillingInvoiceRecord = {
  id: string;
  project_id: string;
  total_due: number;
  paid_amount: number;
  status: string;
  issue_date: string | null;
  due_date: string | null;
};

type PaymentRecord = {
  id: string;
  project_id: string;
  amount: number;
  status: string;
  paid_at: string;
};

type ChangeOrderRecord = {
  id: string;
  project_id: string;
  contract_amount: number;
  status: string;
};

export interface BillingWorkspaceData {
  schemaReady: boolean;
  lineItems: BillingLineItemRow[];
  costActuals: CostActualRow[];
  changeOrderAllocations: ChangeOrderAllocationRow[];
  wip: ProjectWIPResult | null;
}

export interface PortfolioBillingProject extends ProjectWIPResult {
  job_number: string;
  client: string;
  project_manager: string;
  next_billing_date: string | null;
  invoice_count: number;
  open_invoice_count: number;
  aging: {
    current: number;
    days_30: number;
    days_60: number;
    days_90: number;
  };
}

export interface PortfolioBillingSummary {
  projects: PortfolioBillingProject[];
  totals: {
    project_count: number;
    total_contract: number;
    total_earned: number;
    total_billed: number;
    total_over_under: number;
    total_cost: number;
    estimated_gross_profit: number;
    gross_profit_pct: number;
    open_receivable: number;
    retainage_held: number;
    cash_collected_30_days: number;
    cash_position: number;
    aging: PortfolioBillingProject["aging"];
  };
}

const normalizeProject = (row: Record<string, unknown>): ProjectRecord => ({
  id: row.id as string,
  name: str(row.name),
  original_contract: num(row.original_contract),
  percent_complete: num(row.percent_complete),
});

const normalizeBucket = (row: Record<string, unknown>): BucketRecord => ({
  id: row.id as string,
  project_id: row.project_id as string,
  cost_code: str(row.cost_code),
  bucket: str(row.bucket),
  original_budget: num(row.original_budget),
  actual_to_date: num(row.actual_to_date),
  ftc: num(row.ftc),
  sort_order: num(row.sort_order),
  retainage_pct: num(row.retainage_pct ?? 10),
  billing_method: str(row.billing_method, "percent") as BillingMethod,
  contract_quantity: num(row.contract_quantity),
  unit: str(row.unit),
  earned_percent_complete: num(row.earned_percent_complete ?? row.percent_complete),
});

const normalizeBillingApplication = (row: Record<string, unknown>): BillingApplicationRecord => ({
  id: row.id as string,
  project_id: row.project_id as string,
  amount_billed: num(row.amount_billed),
  paid_to_date: num(row.paid_to_date),
  retainage: num(row.retainage),
  sort_order: num(row.sort_order),
  submitted_date: (row.submitted_date as string | null) ?? null,
  due_date: (row.due_date as string | null) ?? null,
  has_line_detail: bool(row.has_line_detail),
});

const normalizeBillingInvoice = (row: Record<string, unknown>): BillingInvoiceRecord => ({
  id: row.id as string,
  project_id: row.project_id as string,
  total_due: num(row.total_due),
  paid_amount: num(row.paid_amount),
  status: str(row.status),
  issue_date: (row.issue_date as string | null) ?? null,
  due_date: (row.due_date as string | null) ?? null,
});

const normalizePayment = (row: Record<string, unknown>): PaymentRecord => ({
  id: row.id as string,
  project_id: row.project_id as string,
  amount: num(row.amount),
  status: str(row.status, "succeeded"),
  paid_at: str(row.paid_at),
});

const normalizeChangeOrder = (row: Record<string, unknown>): ChangeOrderRecord => ({
  id: row.id as string,
  project_id: row.project_id as string,
  contract_amount: num(row.contract_amount),
  status: str(row.status),
});

const normalizeLineItem = (row: Record<string, unknown>): BillingLineItemRow => ({
  id: row.id as string,
  billing_application_id: row.billing_application_id as string,
  project_id: row.project_id as string,
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  billing_method: str(row.billing_method, "percent") as BillingMethod,
  scheduled_value_cents: num(row.scheduled_value_cents),
  change_order_value_cents: num(row.change_order_value_cents),
  work_completed_previous_cents: num(row.work_completed_previous_cents),
  materials_stored_previous_cents: num(row.materials_stored_previous_cents),
  work_completed_this_period_cents: num(row.work_completed_this_period_cents),
  materials_stored_this_period_cents: num(row.materials_stored_this_period_cents),
  work_completed_to_date_cents: num(row.work_completed_to_date_cents),
  materials_stored_to_date_cents: num(row.materials_stored_to_date_cents),
  total_completed_and_stored_cents: num(row.total_completed_and_stored_cents),
  billing_percent_complete: num(row.billing_percent_complete),
  balance_to_finish_cents: num(row.balance_to_finish_cents),
  retainage_pct: num(row.retainage_pct),
  retainage_held_cents: num(row.retainage_held_cents),
  retainage_released_cents: num(row.retainage_released_cents),
  sort_order: num(row.sort_order),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeCostActual = (row: Record<string, unknown>): CostActualRow => ({
  id: row.id as string,
  project_id: row.project_id as string,
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  import_batch_id: (row.import_batch_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  category: str(row.category, "direct") as CostActualRow["category"],
  amount: num(row.amount),
  vendor: str(row.vendor),
  reference_number: str(row.reference_number),
  source_row_hash: str(row.source_row_hash),
  source_external_id: str(row.source_external_id),
  cost_date: str(row.cost_date),
  status: str(row.status, "committed") as CostActualRow["status"],
  notes: str(row.notes),
  voided_at: (row.voided_at as string | null) ?? null,
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeChangeOrderAllocation = (
  row: Record<string, unknown>,
): ChangeOrderAllocationRow => ({
  id: row.id as string,
  project_id: row.project_id as string,
  change_order_id: row.change_order_id as string,
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  contract_amount: num(row.contract_amount),
  cost_amount: num(row.cost_amount),
});

function appRank(app: BillingApplicationRecord | undefined) {
  return app ? app.sort_order || 0 : 0;
}

function buildWIPForProject(input: {
  project: ProjectRecord;
  buckets: BucketRecord[];
  billingApplications: BillingApplicationRecord[];
  billingInvoices: BillingInvoiceRecord[];
  payments: PaymentRecord[];
  lineItems: BillingLineItemRow[];
  changeOrders: ChangeOrderRecord[];
  allocations: ChangeOrderAllocationRow[];
}) {
  const appById = new Map(input.billingApplications.map((app) => [app.id, app]));
  const approvedChangeOrderIds = new Set(
    input.changeOrders.filter((co) => co.status === "Approved").map((co) => co.id),
  );
  const approvedAllocations = input.allocations.filter((allocation) =>
    approvedChangeOrderIds.has(allocation.change_order_id),
  );
  const allocatedContractByBucket = new Map<string, number>();
  let allocatedApprovedContract = 0;
  approvedAllocations.forEach((allocation) => {
    allocatedApprovedContract += allocation.contract_amount;
    if (!allocation.cost_bucket_id) return;
    allocatedContractByBucket.set(
      allocation.cost_bucket_id,
      (allocatedContractByBucket.get(allocation.cost_bucket_id) ?? 0) + allocation.contract_amount,
    );
  });

  const approvedContractTotal = input.changeOrders
    .filter((co) => co.status === "Approved")
    .reduce((sum, co) => sum + co.contract_amount, 0);
  const unallocatedApprovedContract = Math.max(
    0,
    approvedContractTotal - allocatedApprovedContract,
  );

  const latestLineByBucket = new Map<string, BillingLineItemRow>();
  input.lineItems.forEach((line) => {
    if (!line.cost_bucket_id) return;
    const existing = latestLineByBucket.get(line.cost_bucket_id);
    if (
      !existing ||
      appRank(appById.get(line.billing_application_id)) >=
        appRank(appById.get(existing.billing_application_id))
    ) {
      latestLineByBucket.set(line.cost_bucket_id, line);
    }
  });

  const totalBilledFromApps = input.billingApplications.reduce(
    (sum, app) => sum + app.amount_billed,
    0,
  );
  const totalRetainageFromApps = input.billingApplications.reduce(
    (sum, app) => sum + app.retainage,
    0,
  );
  const hasLineDetail = input.lineItems.length > 0;
  const totalBucketContract =
    input.buckets.reduce(
      (sum, bucket) =>
        sum + bucket.original_budget + (allocatedContractByBucket.get(bucket.id) ?? 0),
      0,
    ) + unallocatedApprovedContract;

  const bucketInputs: WIPBucketInput[] = input.buckets.map((bucket) => {
    const line = latestLineByBucket.get(bucket.id);
    const contractValue = bucket.original_budget + (allocatedContractByBucket.get(bucket.id) ?? 0);
    const fallbackShare = totalBucketContract > 0 ? contractValue / totalBucketContract : 0;
    return {
      cost_bucket_id: bucket.id,
      cost_code: bucket.cost_code,
      bucket: bucket.bucket,
      original_budget: bucket.original_budget,
      change_order_additions: allocatedContractByBucket.get(bucket.id) ?? 0,
      actual_to_date: bucket.actual_to_date,
      ftc: bucket.ftc,
      earned_percent_complete:
        bucket.earned_percent_complete || input.project.percent_complete || 0,
      billed_to_date: line
        ? centsToDollars(line.total_completed_and_stored_cents)
        : hasLineDetail
          ? 0
          : totalBilledFromApps * fallbackShare,
      retainage_held: line
        ? centsToDollars(line.retainage_held_cents)
        : hasLineDetail
          ? 0
          : totalRetainageFromApps * fallbackShare,
      retainage_released: line ? centsToDollars(line.retainage_released_cents) : 0,
    };
  });

  if (unallocatedApprovedContract > 0.01) {
    bucketInputs.push({
      cost_bucket_id: "unallocated-change-orders",
      cost_code: "",
      bucket: "Unallocated approved change orders",
      original_budget: 0,
      change_order_additions: unallocatedApprovedContract,
      actual_to_date: 0,
      ftc: 0,
      earned_percent_complete: input.project.percent_complete || 0,
      billed_to_date: hasLineDetail
        ? 0
        : totalBilledFromApps * (unallocatedApprovedContract / totalBucketContract),
      retainage_held: hasLineDetail
        ? 0
        : totalRetainageFromApps * (unallocatedApprovedContract / totalBucketContract),
      retainage_released: 0,
    });
  }

  const paidFromPayments = input.payments
    .filter((payment) => payment.status === "succeeded")
    .reduce((sum, payment) => sum + payment.amount, 0);
  const paidFallback = input.billingApplications.reduce((sum, app) => sum + app.paid_to_date, 0);
  const result = computeProjectWIP(
    { id: input.project.id, name: input.project.name },
    bucketInputs,
    paidFromPayments || paidFallback,
  );

  const bucketBilled = result.buckets.reduce((sum, bucket) => sum + bucket.billed_to_date, 0);
  const unallocatedBilling = totalBilledFromApps - bucketBilled;
  if (Math.abs(unallocatedBilling) > 0.01) {
    result.buckets.push({
      cost_bucket_id: "unallocated-billing",
      cost_code: "",
      bucket: "Unallocated billing",
      contract_value: 0,
      earned_revenue: 0,
      billed_to_date: unallocatedBilling,
      over_under_billing: unallocatedBilling,
      cost_to_date: 0,
      cost_to_complete: 0,
      estimated_total_cost: 0,
      estimated_gross_profit: 0,
      gross_profit_pct: 0,
      net_retainage: 0,
    });
    result.total_billed = totalBilledFromApps;
    result.total_over_under = result.total_billed - result.total_earned;
    result.open_receivable = Math.max(
      0,
      result.total_billed - (paidFromPayments || paidFallback) - result.total_retainage_net,
    );
    result.cash_position = (paidFromPayments || paidFallback) - result.total_cost;
  }

  return result;
}

async function loadProjectBillingData(context: BillingServerContext, projectId: string) {
  const [
    projectRes,
    bucketRes,
    appRes,
    invoiceRes,
    paymentRes,
    changeOrderRes,
    lineRes,
    costActualRes,
    allocationRes,
  ] = await Promise.all([
    dynamicTable(context.supabase, "projects").select("*").eq("id", projectId).single(),
    dynamicTable(context.supabase, "cost_buckets")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
    dynamicTable(context.supabase, "billing_applications")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
    dynamicTable(context.supabase, "billing_invoices").select("*").eq("project_id", projectId),
    dynamicTable(context.supabase, "payment_ledger").select("*").eq("project_id", projectId),
    dynamicTable(context.supabase, "change_orders").select("*").eq("project_id", projectId),
    dynamicTable(context.supabase, "billing_line_items")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order"),
    dynamicTable(context.supabase, "cost_actuals")
      .select("*")
      .eq("project_id", projectId)
      .order("cost_date", { ascending: false }),
    dynamicTable(context.supabase, "change_order_allocations")
      .select("*")
      .eq("project_id", projectId),
  ]);

  if (projectRes.error) throw new Error(projectRes.error.message);
  if (bucketRes.error) throw new Error(bucketRes.error.message);
  if (appRes.error) throw new Error(appRes.error.message);
  if (invoiceRes.error && !isMissingRestRelation(invoiceRes.error, "billing_invoices")) {
    throw new Error(invoiceRes.error.message);
  }
  if (paymentRes.error && !isMissingRestRelation(paymentRes.error, "payment_ledger")) {
    throw new Error(paymentRes.error.message);
  }
  if (changeOrderRes.error) throw new Error(changeOrderRes.error.message);

  const enhancedMissing =
    isMissingRestRelation(lineRes.error, "billing_line_items") ||
    isMissingRestRelation(costActualRes.error, "cost_actuals") ||
    isMissingRestRelation(allocationRes.error, "change_order_allocations");
  if (lineRes.error && !enhancedMissing) throw new Error(lineRes.error.message);
  if (costActualRes.error && !enhancedMissing) throw new Error(costActualRes.error.message);
  if (allocationRes.error && !enhancedMissing) throw new Error(allocationRes.error.message);

  const project = normalizeProject(projectRes.data as Record<string, unknown>);
  const buckets = ((bucketRes.data ?? []) as unknown[]).map((row) =>
    normalizeBucket(row as Record<string, unknown>),
  );
  const billingApplications = ((appRes.data ?? []) as unknown[]).map((row) =>
    normalizeBillingApplication(row as Record<string, unknown>),
  );
  const billingInvoices = invoiceRes.error
    ? []
    : ((invoiceRes.data ?? []) as unknown[]).map((row) =>
        normalizeBillingInvoice(row as Record<string, unknown>),
      );
  const payments = paymentRes.error
    ? []
    : ((paymentRes.data ?? []) as unknown[]).map((row) =>
        normalizePayment(row as Record<string, unknown>),
      );
  const changeOrders = ((changeOrderRes.data ?? []) as unknown[]).map((row) =>
    normalizeChangeOrder(row as Record<string, unknown>),
  );
  const lineItems =
    enhancedMissing || lineRes.error
      ? []
      : ((lineRes.data ?? []) as unknown[]).map((row) =>
          normalizeLineItem(row as Record<string, unknown>),
        );
  const costActuals =
    enhancedMissing || costActualRes.error
      ? []
      : ((costActualRes.data ?? []) as unknown[]).map((row) =>
          normalizeCostActual(row as Record<string, unknown>),
        );
  const allocations =
    enhancedMissing || allocationRes.error
      ? []
      : ((allocationRes.data ?? []) as unknown[]).map((row) =>
          normalizeChangeOrderAllocation(row as Record<string, unknown>),
        );

  return {
    schemaReady: !enhancedMissing,
    project,
    buckets,
    billingApplications,
    billingInvoices,
    payments,
    changeOrders,
    lineItems,
    costActuals,
    allocations,
  };
}

export const getBillingWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanReadProject(ctx, data.projectId);
    const loaded = await loadProjectBillingData(ctx, data.projectId);
    const wip = buildWIPForProject({
      project: loaded.project,
      buckets: loaded.buckets,
      billingApplications: loaded.billingApplications,
      billingInvoices: loaded.billingInvoices,
      payments: loaded.payments,
      lineItems: loaded.lineItems,
      changeOrders: loaded.changeOrders,
      allocations: loaded.allocations,
    });

    return {
      schemaReady: loaded.schemaReady,
      lineItems: loaded.lineItems,
      costActuals: loaded.costActuals,
      changeOrderAllocations: loaded.allocations,
      wip,
    } satisfies BillingWorkspaceData;
  });

const generateLineItemsInput = z.object({
  projectId: z.string().uuid(),
  billingApplicationId: z.string().uuid(),
});

export const generateBillingLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof generateLineItemsInput>) =>
    generateLineItemsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanManageProject(ctx, data.projectId);

    const [
      appRes,
      bucketRes,
      appListRes,
      existingLineRes,
      allocationRes,
      changeOrderRes,
      projectRes,
    ] = await Promise.all([
      dynamicTable(ctx.supabase, "billing_applications")
        .select("*")
        .eq("id", data.billingApplicationId)
        .single(),
      dynamicTable(ctx.supabase, "cost_buckets")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
      dynamicTable(ctx.supabase, "billing_applications")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
      dynamicTable(ctx.supabase, "billing_line_items")
        .select("*")
        .eq("billing_application_id", data.billingApplicationId),
      dynamicTable(ctx.supabase, "change_order_allocations")
        .select("*")
        .eq("project_id", data.projectId),
      dynamicTable(ctx.supabase, "change_orders").select("*").eq("project_id", data.projectId),
      dynamicTable(ctx.supabase, "projects").select("*").eq("id", data.projectId).single(),
    ]);
    if (appRes.error) throw new Error(appRes.error.message);
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    if (appListRes.error) throw new Error(appListRes.error.message);
    if (existingLineRes.error) throw new Error(existingLineRes.error.message);
    if (allocationRes.error) throw new Error(allocationRes.error.message);
    if (changeOrderRes.error) throw new Error(changeOrderRes.error.message);
    if (projectRes.error) throw new Error(projectRes.error.message);

    const app = normalizeBillingApplication(appRes.data as Record<string, unknown>);
    if (app.project_id !== data.projectId)
      throw new Error("Pay app does not belong to this project.");
    const existingLines = ((existingLineRes.data ?? []) as unknown[]).map((row) =>
      normalizeLineItem(row as Record<string, unknown>),
    );
    if (existingLines.length > 0) {
      return { ok: true, line_count: existingLines.length, created: false };
    }

    const buckets = ((bucketRes.data ?? []) as unknown[]).map((row) =>
      normalizeBucket(row as Record<string, unknown>),
    );
    if (buckets.length === 0)
      throw new Error("Import or create SOV cost buckets before generating line detail.");

    const apps = ((appListRes.data ?? []) as unknown[]).map((row) =>
      normalizeBillingApplication(row as Record<string, unknown>),
    );
    const currentIndex = apps.findIndex((item) => item.id === app.id);
    const previousApp = currentIndex > 0 ? apps[currentIndex - 1] : null;
    let previousLines: BillingLineItemRow[] = [];
    if (previousApp) {
      const prevLineRes = await dynamicTable(ctx.supabase, "billing_line_items")
        .select("*")
        .eq("billing_application_id", previousApp.id);
      if (prevLineRes.error) throw new Error(prevLineRes.error.message);
      previousLines = ((prevLineRes.data ?? []) as unknown[]).map((row) =>
        normalizeLineItem(row as Record<string, unknown>),
      );
    }
    const previousByBucket = new Map(
      previousLines
        .filter((line) => line.cost_bucket_id)
        .map((line) => [line.cost_bucket_id as string, line]),
    );

    const changeOrders = ((changeOrderRes.data ?? []) as unknown[]).map((row) =>
      normalizeChangeOrder(row as Record<string, unknown>),
    );
    const approvedChangeOrderIds = new Set(
      changeOrders.filter((co) => co.status === "Approved").map((co) => co.id),
    );
    const allocations = ((allocationRes.data ?? []) as unknown[]).map((row) =>
      normalizeChangeOrderAllocation(row as Record<string, unknown>),
    );
    const coByBucket = new Map<string, number>();
    allocations.forEach((allocation) => {
      if (!allocation.cost_bucket_id || !approvedChangeOrderIds.has(allocation.change_order_id))
        return;
      coByBucket.set(
        allocation.cost_bucket_id,
        (coByBucket.get(allocation.cost_bucket_id) ?? 0) + allocation.contract_amount,
      );
    });

    const targetThisPeriod = dollarsToCents(app.amount_billed);
    const contractTotal = buckets.reduce(
      (sum, bucket) => sum + bucket.original_budget + (coByBucket.get(bucket.id) ?? 0),
      0,
    );
    let remainingThisPeriod = targetThisPeriod;
    const project = projectRes.data as Record<string, unknown>;
    const defaultRetainage = num(project.default_retainage_pct ?? 10);
    const rows = buckets.map((bucket, index) => {
      const lineContract = bucket.original_budget + (coByBucket.get(bucket.id) ?? 0);
      const thisPeriod =
        index === buckets.length - 1
          ? remainingThisPeriod
          : contractTotal > 0
            ? Math.round(targetThisPeriod * (lineContract / contractTotal))
            : 0;
      remainingThisPeriod -= thisPeriod;
      const previous = previousByBucket.get(bucket.id);
      return {
        billing_application_id: app.id,
        project_id: data.projectId,
        cost_bucket_id: bucket.id,
        cost_code: bucket.cost_code,
        description: bucket.bucket,
        billing_method: bucket.billing_method,
        scheduled_value_cents: dollarsToCents(bucket.original_budget),
        change_order_value_cents: dollarsToCents(coByBucket.get(bucket.id) ?? 0),
        work_completed_previous_cents: previous?.work_completed_to_date_cents ?? 0,
        materials_stored_previous_cents: previous?.materials_stored_to_date_cents ?? 0,
        work_completed_this_period_cents: Math.max(0, thisPeriod),
        materials_stored_this_period_cents: 0,
        retainage_pct: bucket.retainage_pct || defaultRetainage,
        retainage_released_cents: 0,
        sort_order: bucket.sort_order || index + 1,
      };
    });

    const insertRes = await dynamicTable(ctx.supabase, "billing_line_items").insert(rows);
    if (insertRes.error) throw new Error(insertRes.error.message);

    const syncRes = await ctx.supabase.rpc("sync_billing_application_from_lines", {
      p_billing_application_id: app.id,
    });
    if (syncRes.error) throw new Error(syncRes.error.message);
    return { ok: true, line_count: rows.length, created: true };
  });

const updateLineItemInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    work_completed_this_period: z.number().min(0).optional(),
    materials_stored_this_period: z.number().min(0).optional(),
    retainage_pct: z.number().min(0).max(100).optional(),
    retainage_released: z.number().min(0).optional(),
  }),
});

export const updateBillingLineItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateLineItemInput>) => updateLineItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const lineRes = await dynamicTable(ctx.supabase, "billing_line_items")
      .select(billingLineRetainageSelect)
      .eq("id", data.id)
      .single();
    if (lineRes.error) throw new Error(lineRes.error.message);
    const line = lineRes.data as Record<string, unknown>;
    await requireCanManageProject(ctx, line.project_id as string);

    const patch: Record<string, number> = {};
    if (typeof data.patch.work_completed_this_period === "number") {
      patch.work_completed_this_period_cents = dollarsToCents(
        data.patch.work_completed_this_period,
      );
    }
    if (typeof data.patch.materials_stored_this_period === "number") {
      patch.materials_stored_this_period_cents = dollarsToCents(
        data.patch.materials_stored_this_period,
      );
    }
    if (typeof data.patch.retainage_pct === "number") {
      patch.retainage_pct = data.patch.retainage_pct;
    }
    const retainagePct =
      typeof data.patch.retainage_pct === "number"
        ? data.patch.retainage_pct
        : num(line.retainage_pct);
    const retainageReleaseCap = billingLineRetainageCapCents(line, retainagePct, patch);
    if (typeof data.patch.retainage_released === "number") {
      patch.retainage_released_cents = Math.min(
        dollarsToCents(data.patch.retainage_released),
        retainageReleaseCap,
      );
    } else if (
      typeof data.patch.retainage_pct === "number" ||
      typeof data.patch.work_completed_this_period === "number" ||
      typeof data.patch.materials_stored_this_period === "number"
    ) {
      patch.retainage_released_cents = Math.min(
        num(line.retainage_released_cents),
        retainageReleaseCap,
      );
    }

    const updateRes = await dynamicTable(ctx.supabase, "billing_line_items")
      .update(patch)
      .eq("id", data.id);
    if (updateRes.error) throw new Error(updateRes.error.message);
    const syncRes = await ctx.supabase.rpc("sync_billing_application_from_lines", {
      p_billing_application_id: line.billing_application_id,
    });
    if (syncRes.error) throw new Error(syncRes.error.message);
    return { ok: true };
  });

const updatePayAppRetainageRateInput = z.object({
  billingApplicationId: z.string().uuid(),
  retainage_pct: z.number().min(0).max(100),
});

export const updateBillingApplicationRetainageRate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updatePayAppRetainageRateInput>) =>
    updatePayAppRetainageRateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const appRes = await dynamicTable(ctx.supabase, "billing_applications")
      .select("id,project_id")
      .eq("id", data.billingApplicationId)
      .single();
    if (appRes.error) throw new Error(appRes.error.message);
    const app = appRes.data as Record<string, unknown>;
    await requireCanManageProject(ctx, app.project_id as string);

    const linesRes = await dynamicTable(ctx.supabase, "billing_line_items")
      .select(billingLineRetainageSelect)
      .eq("billing_application_id", data.billingApplicationId);
    if (linesRes.error) throw new Error(linesRes.error.message);
    const lines = Array.isArray(linesRes.data) ? (linesRes.data as Record<string, unknown>[]) : [];

    const updateResults = await Promise.all(
      lines.map((line) => {
        const retainageReleaseCap = billingLineRetainageCapCents(line, data.retainage_pct);
        return dynamicTable(ctx.supabase, "billing_line_items")
          .update({
            retainage_pct: data.retainage_pct,
            retainage_released_cents: Math.min(
              num(line.retainage_released_cents),
              retainageReleaseCap,
            ),
          })
          .eq("id", line.id);
      }),
    );
    const failedUpdate = updateResults.find((result) => result.error);
    if (failedUpdate?.error) throw new Error(failedUpdate.error.message);

    const syncRes = await ctx.supabase.rpc("sync_billing_application_from_lines", {
      p_billing_application_id: data.billingApplicationId,
    });
    if (syncRes.error) throw new Error(syncRes.error.message);
    return {
      ok: true,
      line_count: lines.length,
    };
  });

const updateBucketWipInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    earned_percent_complete: z.number().min(0).max(100).optional(),
    retainage_pct: z.number().min(0).max(100).optional(),
    billing_method: z.enum(["percent", "unit", "material"]).optional(),
    contract_quantity: z.number().min(0).optional(),
    unit: z.string().max(16).optional(),
  }),
});

export const updateCostBucketBillingSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateBucketWipInput>) =>
    updateBucketWipInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const bucketRes = await dynamicTable(ctx.supabase, "cost_buckets")
      .select("id,project_id")
      .eq("id", data.id)
      .single();
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    await requireCanManageProject(
      ctx,
      (bucketRes.data as Record<string, unknown>).project_id as string,
    );
    const updateRes = await dynamicTable(ctx.supabase, "cost_buckets")
      .update(data.patch)
      .eq("id", data.id);
    if (updateRes.error) throw new Error(updateRes.error.message);
    return { ok: true };
  });

const costActualInput = z.object({
  projectId: z.string().uuid(),
  cost_bucket_id: z.string().uuid().nullable().optional(),
  cost_code: z.string().max(64).default(""),
  description: z.string().min(1).max(500),
  category: z
    .enum(["direct", "labor", "material", "equipment", "subcontract", "overhead"])
    .default("direct"),
  amount: z.number().min(0),
  vendor: z.string().max(200).default(""),
  reference_number: z.string().max(200).default(""),
  cost_date: z.string().min(1),
  status: z.enum(["committed", "paid"]).default("committed"),
  notes: z.string().max(2000).default(""),
});

export const createCostActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof costActualInput>) => costActualInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanManageProject(ctx, data.projectId);
    let bucketId = data.cost_bucket_id ?? null;
    if (!bucketId && data.cost_code.trim()) {
      const bucketRes = await dynamicTable(ctx.supabase, "cost_buckets")
        .select("id,cost_code")
        .eq("project_id", data.projectId);
      if (bucketRes.error) throw new Error(bucketRes.error.message);
      const match = ((bucketRes.data ?? []) as Record<string, unknown>[]).find(
        (bucket) => normalizeKey(str(bucket.cost_code)) === normalizeKey(data.cost_code),
      );
      bucketId = (match?.id as string | undefined) ?? null;
    }

    const insertRes = await dynamicTable(ctx.supabase, "cost_actuals").insert({
      project_id: data.projectId,
      cost_bucket_id: bucketId,
      cost_code: data.cost_code.trim(),
      description: data.description,
      category: data.category,
      amount: data.amount,
      vendor: data.vendor,
      reference_number: data.reference_number,
      cost_date: data.cost_date,
      status: data.status,
      notes: data.notes,
    });
    if (insertRes.error) throw new Error(insertRes.error.message);
    return { ok: true };
  });

const importCostActualsInput = z.object({
  projectId: z.string().uuid(),
  source_name: z.string().max(200).default("CSV import"),
  rows: z
    .array(
      z.object({
        cost_bucket_id: z.string().uuid().nullable().optional(),
        cost_code: z.string().max(64).default(""),
        description: z.string().min(1).max(500),
        category: z
          .enum(["direct", "labor", "material", "equipment", "subcontract", "overhead"])
          .default("direct"),
        amount: z.number().min(0.01),
        vendor: z.string().max(200).default(""),
        reference_number: z.string().max(200).default(""),
        cost_date: z.string().min(1),
        status: z.enum(["committed", "paid"]).default("committed"),
        notes: z.string().max(2000).default(""),
      }),
    )
    .min(1)
    .max(500),
});

const sourceExternalId = (
  projectId: string,
  sourceName: string,
  row: z.infer<typeof importCostActualsInput>["rows"][number],
) =>
  [
    projectId,
    sourceName,
    row.cost_date,
    row.reference_number,
    row.vendor,
    row.amount.toFixed(2),
    row.cost_code,
    row.description,
  ]
    .map((part) => normalizeKey(String(part ?? "")))
    .join("|");

export const importCostActuals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof importCostActualsInput>) =>
    importCostActualsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanManageProject(ctx, data.projectId);

    const bucketRes = await dynamicTable(ctx.supabase, "cost_buckets")
      .select("id,cost_code,bucket")
      .eq("project_id", data.projectId);
    if (bucketRes.error) throw new Error(bucketRes.error.message);

    const buckets = (bucketRes.data ?? []) as Record<string, unknown>[];
    const bucketById = new Map(buckets.map((bucket) => [bucket.id as string, bucket]));
    const bucketByCode = new Map(
      buckets
        .filter((bucket) => str(bucket.cost_code))
        .map((bucket) => [normalizeKey(str(bucket.cost_code)), bucket]),
    );

    const requestedExternalIds = data.rows.map((row) =>
      sourceExternalId(data.projectId, data.source_name, row),
    );
    const existingRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .select("source_external_id")
      .eq("project_id", data.projectId)
      .in("source_external_id", requestedExternalIds);
    if (existingRes.error) throw new Error(existingRes.error.message);
    const existingIds = new Set(
      ((existingRes.data ?? []) as Record<string, unknown>[]).map((row) =>
        str(row.source_external_id),
      ),
    );

    let unmatchedCount = 0;
    let skippedCount = 0;
    const seenExternalIds = new Set<string>();
    const rows = data.rows.flatMap((row) => {
      const externalId = sourceExternalId(data.projectId, data.source_name, row);
      if (existingIds.has(externalId) || seenExternalIds.has(externalId)) {
        skippedCount += 1;
        return [];
      }
      seenExternalIds.add(externalId);

      let bucketId = row.cost_bucket_id ?? null;
      if (bucketId && !bucketById.has(bucketId)) bucketId = null;
      if (!bucketId && row.cost_code.trim()) {
        bucketId =
          (bucketByCode.get(normalizeKey(row.cost_code))?.id as string | undefined) ?? null;
      }
      if (!bucketId) unmatchedCount += 1;

      return [
        {
          project_id: data.projectId,
          cost_bucket_id: bucketId,
          cost_code: row.cost_code.trim(),
          description: row.description.trim(),
          category: row.category,
          amount: row.amount,
          vendor: row.vendor.trim(),
          reference_number: row.reference_number.trim(),
          cost_date: row.cost_date,
          status: row.status,
          notes: row.notes.trim(),
          source_external_id: externalId,
        },
      ];
    });

    if (rows.length === 0) {
      return { ok: true, imported_count: 0, skipped_count: skippedCount, unmatched_count: 0 };
    }

    const batchRes = await dynamicTable(ctx.supabase, "cost_actual_import_batches")
      .insert({
        project_id: data.projectId,
        source_type: "csv",
        source_name: data.source_name,
        row_count: data.rows.length,
        matched_count: rows.length - unmatchedCount,
        unmatched_count: unmatchedCount,
        status: unmatchedCount > 0 ? "review" : "imported",
      })
      .select("id")
      .single();
    if (batchRes.error) throw new Error(batchRes.error.message);
    const importBatchId = str((batchRes.data as Record<string, unknown> | null)?.id);

    const insertRes = await dynamicTable(ctx.supabase, "cost_actuals").insert(
      rows.map((row) => ({
        ...row,
        import_batch_id: importBatchId || null,
      })),
    );
    if (insertRes.error) throw new Error(insertRes.error.message);

    return {
      ok: true,
      imported_count: rows.length,
      skipped_count: skippedCount,
      unmatched_count: unmatchedCount,
    };
  });

const voidCostActualInput = z.object({
  id: z.string().uuid(),
  notes: z.string().max(2000).default(""),
});

export const voidCostActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof voidCostActualInput>) => voidCostActualInput.parse(input))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const actualRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .select("id,project_id,notes")
      .eq("id", data.id)
      .single();
    if (actualRes.error) throw new Error(actualRes.error.message);
    const actual = actualRes.data as Record<string, unknown>;
    await requireCanManageProject(ctx, actual.project_id as string);
    const existingNotes = str(actual.notes);
    const updateRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .update({
        status: "void",
        voided_at: new Date().toISOString(),
        voided_by: ctx.userId,
        notes: [existingNotes, data.notes].filter(Boolean).join("\n"),
      })
      .eq("id", data.id);
    if (updateRes.error) throw new Error(updateRes.error.message);
    return { ok: true };
  });

export const listPortfolioBilling = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as BillingServerContext;
    const projectRes = await dynamicTable(ctx.supabase, "projects")
      .select("*")
      .order("name", { ascending: true });
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projectRows = (projectRes.data ?? []) as Record<string, unknown>[];
    const ids = projectRows.map((project) => project.id as string).filter(Boolean);
    if (ids.length === 0) {
      return {
        projects: [],
        totals: {
          project_count: 0,
          total_contract: 0,
          total_earned: 0,
          total_billed: 0,
          total_over_under: 0,
          total_cost: 0,
          estimated_gross_profit: 0,
          gross_profit_pct: 0,
          open_receivable: 0,
          retainage_held: 0,
          cash_collected_30_days: 0,
          cash_position: 0,
          aging: { current: 0, days_30: 0, days_60: 0, days_90: 0 },
        },
      } satisfies PortfolioBillingSummary;
    }

    const [bucketRes, appRes, invoiceRes, paymentRes, lineRes, changeOrderRes, allocationRes] =
      await Promise.all([
        dynamicTable(ctx.supabase, "cost_buckets").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "billing_applications").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "billing_invoices").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "payment_ledger").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "billing_line_items").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "change_orders").select("*").in("project_id", ids),
        dynamicTable(ctx.supabase, "change_order_allocations").select("*").in("project_id", ids),
      ]);
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    if (appRes.error) throw new Error(appRes.error.message);
    if (invoiceRes.error && !isMissingRestRelation(invoiceRes.error, "billing_invoices")) {
      throw new Error(invoiceRes.error.message);
    }
    if (paymentRes.error && !isMissingRestRelation(paymentRes.error, "payment_ledger")) {
      throw new Error(paymentRes.error.message);
    }
    const enhancedMissing =
      isMissingRestRelation(lineRes.error, "billing_line_items") ||
      isMissingRestRelation(allocationRes.error, "change_order_allocations");
    if (lineRes.error && !enhancedMissing) throw new Error(lineRes.error.message);
    if (changeOrderRes.error) throw new Error(changeOrderRes.error.message);
    if (allocationRes.error && !enhancedMissing) throw new Error(allocationRes.error.message);

    const buckets = ((bucketRes.data ?? []) as unknown[]).map((row) =>
      normalizeBucket(row as Record<string, unknown>),
    );
    const apps = ((appRes.data ?? []) as unknown[]).map((row) =>
      normalizeBillingApplication(row as Record<string, unknown>),
    );
    const invoices = invoiceRes.error
      ? []
      : ((invoiceRes.data ?? []) as unknown[]).map((row) =>
          normalizeBillingInvoice(row as Record<string, unknown>),
        );
    const payments = paymentRes.error
      ? []
      : ((paymentRes.data ?? []) as unknown[]).map((row) =>
          normalizePayment(row as Record<string, unknown>),
        );
    const lineItems =
      enhancedMissing || lineRes.error
        ? []
        : ((lineRes.data ?? []) as unknown[]).map((row) =>
            normalizeLineItem(row as Record<string, unknown>),
          );
    const changeOrders = ((changeOrderRes.data ?? []) as unknown[]).map((row) =>
      normalizeChangeOrder(row as Record<string, unknown>),
    );
    const allocations =
      enhancedMissing || allocationRes.error
        ? []
        : ((allocationRes.data ?? []) as unknown[]).map((row) =>
            normalizeChangeOrderAllocation(row as Record<string, unknown>),
          );

    const today = new Date();
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 86400000);
    const projects = projectRows.map((projectRow) => {
      const project = normalizeProject(projectRow);
      const projectInvoices = invoices.filter((invoice) => invoice.project_id === project.id);
      const aging = { current: 0, days_30: 0, days_60: 0, days_90: 0 };
      projectInvoices.forEach((invoice) => {
        if (invoice.status === "void") return;
        const outstanding = Math.max(0, invoice.total_due - invoice.paid_amount);
        if (outstanding <= 0) return;
        const dateValue = invoice.due_date ?? invoice.issue_date;
        const ageDate = dateValue ? new Date(`${dateValue}T00:00:00`) : today;
        const daysPastDue = Math.floor((today.getTime() - ageDate.getTime()) / 86400000);
        aging[agingBucket(daysPastDue)] += outstanding;
      });
      const wip = buildWIPForProject({
        project,
        buckets: buckets.filter((bucket) => bucket.project_id === project.id),
        billingApplications: apps.filter((app) => app.project_id === project.id),
        billingInvoices: projectInvoices,
        payments: payments.filter((payment) => payment.project_id === project.id),
        lineItems: lineItems.filter((line) => line.project_id === project.id),
        changeOrders: changeOrders.filter((co) => co.project_id === project.id),
        allocations: allocations.filter((allocation) => allocation.project_id === project.id),
      });
      return {
        ...wip,
        job_number: str(projectRow.job_number),
        client: str(projectRow.client),
        project_manager: str(projectRow.project_manager),
        next_billing_date: (projectRow.next_billing_date as string | null) ?? null,
        invoice_count: projectInvoices.length,
        open_invoice_count: projectInvoices.filter(
          (invoice) => invoice.status !== "void" && invoice.total_due > invoice.paid_amount,
        ).length,
        aging,
      } satisfies PortfolioBillingProject;
    });

    const totals = projects.reduce<PortfolioBillingSummary["totals"]>(
      (sum, project) => {
        sum.project_count += 1;
        sum.total_contract += project.total_contract;
        sum.total_earned += project.total_earned;
        sum.total_billed += project.total_billed;
        sum.total_over_under += project.total_over_under;
        sum.total_cost += project.total_cost;
        sum.estimated_gross_profit += project.estimated_gross_profit;
        sum.open_receivable += project.open_receivable;
        sum.retainage_held += project.total_retainage_net;
        sum.cash_position += project.cash_position;
        sum.aging.current += project.aging.current;
        sum.aging.days_30 += project.aging.days_30;
        sum.aging.days_60 += project.aging.days_60;
        sum.aging.days_90 += project.aging.days_90;
        return sum;
      },
      {
        project_count: 0,
        total_contract: 0,
        total_earned: 0,
        total_billed: 0,
        total_over_under: 0,
        total_cost: 0,
        estimated_gross_profit: 0,
        gross_profit_pct: 0,
        open_receivable: 0,
        retainage_held: 0,
        cash_collected_30_days: payments
          .filter(
            (payment) =>
              payment.status === "succeeded" &&
              new Date(payment.paid_at).getTime() >= thirtyDaysAgo.getTime(),
          )
          .reduce((sum, payment) => sum + payment.amount, 0),
        cash_position: 0,
        aging: { current: 0, days_30: 0, days_60: 0, days_90: 0 },
      },
    );
    totals.gross_profit_pct =
      totals.total_contract > 0 ? (totals.estimated_gross_profit / totals.total_contract) * 100 : 0;

    return { projects, totals } satisfies PortfolioBillingSummary;
  });
