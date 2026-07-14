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
import { buildBillingLinesFromBuckets } from "@/lib/billing-line-generation";
import { computeBudgetLedger, type BudgetLedger, type BudgetLedgerRow } from "@/lib/budget-ledger";
import { summarizeSubCostByBucket } from "@/lib/subcontract-budget";
import { latestPercentBySubBucket } from "@/lib/daily-wip";
import type { ExposureLike, ExposureAllocationLike, HoldClass } from "@/lib/exposure-allocation";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  neq(column: string, value: unknown): DynamicSupabaseQuery;
  is(column: string, value: unknown): DynamicSupabaseQuery;
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
// Like num(), but preserves "no value" as null instead of collapsing it to 0. Used where
// the difference between "explicitly 0" and "never entered" is meaningful (e.g. WIP earned %).
const numOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
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
  // Shared by every cost-code allocation row on one supplier invoice.
  cost_document_id: string;
  // Optional attribution to the risk tally. Cost code remains the accounting home.
  exposure_id: string | null;
  // Signed amount of Budget Open this recognized direct cost relieved. Stored
  // by the database trigger so void/delete/move can restore it exactly.
  budget_open_relief: number;
  // Optional subcontract commitment represented by this actual. Exactly one may
  // be set; the Budget layer uses it to relieve Open without duplicating cost.
  subcontract_change_order_id: string | null;
  subcontract_payment_id: string | null;
  cost_code: string;
  description: string;
  category: "direct" | "labor" | "material" | "equipment" | "subcontract" | "overhead";
  amount: number;
  vendor: string;
  reference_number: string;
  source_row_hash: string;
  source_external_id: string;
  cost_date: string;
  // Payables lifecycle (field request 2026-07-09): draft (logged, not vetted —
  // never counts toward job cost) → approved (approved for payment) → paid.
  // 'committed' predates the approval flow and keeps counting as incurred cost.
  status: "draft" | "committed" | "approved" | "paid" | "void";
  notes: string;
  approved_at: string | null;
  paid_at: string | null;
  // How this cost was paid (field request 2026-07-10): method (wire/check/card/
  // ach/other), the check #/wire confirmation/ACH trace, and the real-world date
  // money went out. Distinct from reference_number (the vendor's invoice number)
  // and paid_at (the system stamp of when it was marked paid).
  payment_method: string;
  payment_reference: string;
  paid_date: string | null;
  // Supplier invoice backup in the private project-docs bucket. Multi-line
  // invoices intentionally share the same path across their cost-code rows.
  invoice_attachment_path: string;
  invoice_attachment_name: string;
  invoice_attachment_type: string;
  invoice_attachment_size: number;
  // Dollars of daily WIP this cost SETTLES (field feedback 2026-07-13) — netted
  // out of the self-perform rollup so the invoice doesn't double-count the lump.
  // 0 pre-migration (column absent → read defensively).
  daily_wip_offset: number;
  // A negative supplier credit can point to the positive invoice it reduces.
  // The settlement view combines approved credits with cash-payment rows.
  credit_applies_to_id: string | null;
  voided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostActualPaymentRow {
  id: string;
  project_id: string;
  cost_actual_id: string;
  amount_cents: number;
  payment_date: string;
  payment_method: string;
  payment_reference: string;
  notes: string;
  created_at: string;
}

export interface CostBudgetItemRow {
  id: string;
  project_id: string;
  cost_bucket_id: string;
  description: string;
  category: "labor" | "material" | "equipment" | "subcontract" | "other";
  planned_amount_cents: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CostLedgerDetails {
  settlementReady: boolean;
  breakdownReady: boolean;
  payments: CostActualPaymentRow[];
  budgetItems: CostBudgetItemRow[];
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
  // BUDGETVSCONTRACT1: billable value of the line (0 = unpriced → downstream
  // contract math falls back to budget, the legacy behavior).
  contract_value: number;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  sort_order: number;
  retainage_pct: number;
  billing_method: BillingMethod;
  contract_quantity: number;
  unit: string;
  // null when this bucket has never had an earned % entered ("not assessed").
  earned_percent_complete: number | null;
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
  // Missing column (migration not applied yet) reads as 0 = unpriced.
  contract_value: num(row.contract_value),
  original_budget: num(row.original_budget),
  actual_to_date: num(row.actual_to_date),
  ftc: num(row.ftc),
  sort_order: num(row.sort_order),
  retainage_pct: num(row.retainage_pct ?? 10),
  billing_method: str(row.billing_method, "percent") as BillingMethod,
  contract_quantity: num(row.contract_quantity),
  unit: str(row.unit),
  // Preserve null: a bucket with no earned % (and no per-bucket percent_complete) is
  // "not assessed", not 0%. `??` keeps an explicit 0. We never fall back to the PROJECT
  // roll-up here — that borrowing is the bug WIPHONESTY1 removes.
  earned_percent_complete: numOrNull(row.earned_percent_complete ?? row.percent_complete),
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
  cost_document_id: str(row.cost_document_id),
  exposure_id: (row.exposure_id as string | null) ?? null,
  budget_open_relief: num(row.budget_open_relief),
  subcontract_change_order_id: (row.subcontract_change_order_id as string | null) ?? null,
  subcontract_payment_id: (row.subcontract_payment_id as string | null) ?? null,
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
  approved_at: (row.approved_at as string | null) ?? null,
  paid_at: (row.paid_at as string | null) ?? null,
  payment_method: str(row.payment_method),
  payment_reference: str(row.payment_reference),
  paid_date: (row.paid_date as string | null) ?? null,
  invoice_attachment_path: str(row.invoice_attachment_path),
  invoice_attachment_name: str(row.invoice_attachment_name),
  invoice_attachment_type: str(row.invoice_attachment_type),
  invoice_attachment_size: num(row.invoice_attachment_size),
  // Read defensively: pre-migration the column is absent → 0 (no settlement).
  daily_wip_offset: num(row.daily_wip_offset ?? 0),
  credit_applies_to_id: (row.credit_applies_to_id as string | null) ?? null,
  voided_at: (row.voided_at as string | null) ?? null,
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const normalizeCostActualPayment = (row: Record<string, unknown>): CostActualPaymentRow => ({
  id: row.id as string,
  project_id: row.project_id as string,
  cost_actual_id: row.cost_actual_id as string,
  amount_cents: num(row.amount_cents),
  payment_date: str(row.payment_date),
  payment_method: str(row.payment_method),
  payment_reference: str(row.payment_reference),
  notes: str(row.notes),
  created_at: str(row.created_at),
});

const normalizeCostBudgetItem = (row: Record<string, unknown>): CostBudgetItemRow => ({
  id: row.id as string,
  project_id: row.project_id as string,
  cost_bucket_id: row.cost_bucket_id as string,
  description: str(row.description),
  category: str(row.category, "other") as CostBudgetItemRow["category"],
  planned_amount_cents: num(row.planned_amount_cents),
  sort_order: num(row.sort_order),
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
  // BUDGETVSCONTRACT1: a priced line's contract basis is its contract_value;
  // an unpriced legacy line falls back to budget (pre-contract_value behavior).
  const bucketContractBasis = (bucket: BucketRecord) =>
    bucket.contract_value > 0 ? bucket.contract_value : bucket.original_budget;
  const totalBucketContract =
    input.buckets.reduce(
      (sum, bucket) =>
        sum + bucketContractBasis(bucket) + (allocatedContractByBucket.get(bucket.id) ?? 0),
      0,
    ) + unallocatedApprovedContract;

  const bucketInputs: WIPBucketInput[] = input.buckets.map((bucket) => {
    const line = latestLineByBucket.get(bucket.id);
    const contractValue =
      bucketContractBasis(bucket) + (allocatedContractByBucket.get(bucket.id) ?? 0);
    const fallbackShare = totalBucketContract > 0 ? contractValue / totalBucketContract : 0;
    return {
      cost_bucket_id: bucket.id,
      cost_code: bucket.cost_code,
      bucket: bucket.bucket,
      contract_value: bucket.contract_value,
      original_budget: bucket.original_budget,
      change_order_additions: allocatedContractByBucket.get(bucket.id) ?? 0,
      actual_to_date: bucket.actual_to_date,
      ftc: bucket.ftc,
      // Use only the bucket's own assessment (including an explicit 0, and null when
      // unassessed). Never substitute the project-level percent_complete — that made every
      // un-updated bucket report the project roll-up as if it were fact.
      earned_percent_complete: bucket.earned_percent_complete,
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
      // Synthetic roll-up of approved change orders not yet allocated to a bucket. It has
      // contract value but no earned assessment of its own — report it as not assessed
      // rather than borrowing the project percent.
      earned_percent_complete: null,
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
      // Reconciliation plug: billing not tied to any cost bucket is, by
      // definition, billed with nothing earned behind it — a real (assessed)
      // over-bill, not a borrowed number (WIPHONESTY1).
      assessed: true,
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

// Optional second slice for the contractor-facing cost ledger. Keeping it
// separate lets the existing billing workspace stay usable while Lovable
// applies the additive settlement/breakdown migrations.
export const getCostLedgerDetails = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanReadProject(ctx, data.projectId);
    const [paymentRes, budgetItemRes] = await Promise.all([
      dynamicTable(ctx.supabase, "cost_actual_payments")
        .select("*")
        .eq("project_id", data.projectId)
        .order("payment_date", { ascending: false }),
      dynamicTable(ctx.supabase, "cost_budget_items")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("created_at"),
    ]);

    const settlementReady = !isMissingRestRelation(paymentRes.error, "cost_actual_payments");
    const breakdownReady = !isMissingRestRelation(budgetItemRes.error, "cost_budget_items");
    if (paymentRes.error && settlementReady) throw new Error(paymentRes.error.message);
    if (budgetItemRes.error && breakdownReady) throw new Error(budgetItemRes.error.message);

    return {
      settlementReady,
      breakdownReady,
      payments: settlementReady
        ? ((paymentRes.data ?? []) as Record<string, unknown>[]).map(normalizeCostActualPayment)
        : [],
      budgetItems: breakdownReady
        ? ((budgetItemRes.data ?? []) as Record<string, unknown>[]).map(normalizeCostBudgetItem)
        : [],
    } satisfies CostLedgerDetails;
  });

const recordCostActualPaymentInput = z.object({
  cost_actual_id: z.string().uuid(),
  amount: z.number().positive(),
  payment_date: z.string().min(1),
  payment_method: z.string().max(40).default(""),
  payment_reference: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
});

export const recordCostActualPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof recordCostActualPaymentInput>) =>
    recordCostActualPaymentInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const result = await ctx.supabase.rpc("record_cost_actual_payment", {
      p_cost_actual_id: data.cost_actual_id,
      p_amount_cents: dollarsToCents(data.amount),
      p_payment_date: data.payment_date,
      p_payment_method: data.payment_method,
      p_payment_reference: data.payment_reference,
      p_notes: data.notes,
    });
    if (result.error) {
      if (/record_cost_actual_payment|schema cache|function/i.test(result.error.message)) {
        throw new Error(
          "Partial payments are not enabled yet (database update pending). Apply the billing settlement migration, then try again.",
        );
      }
      throw new Error(result.error.message);
    }
    return result.data as Record<string, unknown>;
  });

const saveCostBudgetItemInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  cost_bucket_id: z.string().uuid(),
  description: z.string().trim().min(1).max(300),
  category: z.enum(["labor", "material", "equipment", "subcontract", "other"]),
  planned_amount: z.number().min(0),
  sort_order: z.number().int().min(0).default(0),
});

export const saveCostBudgetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveCostBudgetItemInput>) =>
    saveCostBudgetItemInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanManageProject(ctx, data.projectId);

    const bucketRes = await dynamicTable(ctx.supabase, "cost_buckets")
      .select("id,project_id")
      .eq("id", data.cost_bucket_id)
      .single();
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    if ((bucketRes.data as Record<string, unknown>).project_id !== data.projectId) {
      throw new Error("That budget code does not belong to this project.");
    }

    const payload = {
      project_id: data.projectId,
      cost_bucket_id: data.cost_bucket_id,
      description: data.description,
      category: data.category,
      planned_amount_cents: dollarsToCents(data.planned_amount),
      sort_order: data.sort_order,
    };
    const saveRes = data.id
      ? await dynamicTable(ctx.supabase, "cost_budget_items")
          .update(payload)
          .eq("id", data.id)
          .eq("project_id", data.projectId)
          .select("*")
          .single()
      : await dynamicTable(ctx.supabase, "cost_budget_items").insert(payload).select("*").single();
    if (saveRes.error) {
      if (isMissingRestRelation(saveRes.error, "cost_budget_items")) {
        throw new Error(
          "Budget breakdowns are not enabled yet (database update pending). Apply the billing breakdown migration, then try again.",
        );
      }
      throw new Error(saveRes.error.message);
    }
    return normalizeCostBudgetItem(saveRes.data as Record<string, unknown>);
  });

const deleteCostBudgetItemInput = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
});

export const deleteCostBudgetItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteCostBudgetItemInput>) =>
    deleteCostBudgetItemInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    await requireCanManageProject(ctx, data.projectId);
    const deleteRes = await dynamicTable(ctx.supabase, "cost_budget_items")
      .delete()
      .eq("id", data.id)
      .eq("project_id", data.projectId);
    if (deleteRes.error) throw new Error(deleteRes.error.message);
    return { ok: true };
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

    const changeOrders = ((changeOrderRes.data ?? []) as unknown[]).map((row) =>
      normalizeChangeOrder(row as Record<string, unknown>),
    );
    const allocations = ((allocationRes.data ?? []) as unknown[]).map((row) =>
      normalizeChangeOrderAllocation(row as Record<string, unknown>),
    );
    const project = projectRes.data as Record<string, unknown>;
    const defaultRetainage = num(project.default_retainage_pct ?? 10);
    // Shared, pure mapping (billing-line-generation): an approved CO
    // allocated to a cost code rides change_order_value_cents (G702 line 2),
    // never scheduled_value_cents (line 1). Exercised directly by the
    // CO-reaches-line-2 regression test.
    const generatedLines = buildBillingLinesFromBuckets({
      buckets: buckets.map((bucket) => ({
        id: bucket.id,
        cost_code: bucket.cost_code,
        bucket: bucket.bucket,
        // BUDGETVSCONTRACT1: priced lines bill the contract; unpriced fall
        // back to budget inside the generator.
        contract_value: bucket.contract_value,
        original_budget: bucket.original_budget,
        retainage_pct: bucket.retainage_pct,
        billing_method: bucket.billing_method,
        sort_order: bucket.sort_order,
      })),
      changeOrders: changeOrders.map((co) => ({ id: co.id, status: co.status })),
      allocations: allocations.map((allocation) => ({
        change_order_id: allocation.change_order_id,
        cost_bucket_id: allocation.cost_bucket_id,
        contract_amount: allocation.contract_amount,
      })),
      previousLines: previousLines.map((line) => ({
        cost_bucket_id: line.cost_bucket_id,
        work_completed_to_date_cents: line.work_completed_to_date_cents,
        materials_stored_to_date_cents: line.materials_stored_to_date_cents,
      })),
      amountBilled: app.amount_billed,
      defaultRetainagePct: defaultRetainage,
    });
    const rows = generatedLines.map((line) => ({
      ...line,
      billing_application_id: app.id,
      project_id: data.projectId,
    }));

    const insertRes = await dynamicTable(ctx.supabase, "billing_line_items").insert(rows);
    if (insertRes.error) throw new Error(insertRes.error.message);

    const syncRes = await ctx.supabase.rpc("sync_billing_application_from_lines", {
      p_billing_application_id: app.id,
    });
    if (syncRes.error) throw new Error(syncRes.error.message);
    return { ok: true, line_count: rows.length, created: true };
  });

const lineItemPatchInput = z.object({
  work_completed_this_period: z.number().min(0).optional(),
  materials_stored_this_period: z.number().min(0).optional(),
  retainage_pct: z.number().min(0).max(100).optional(),
  retainage_released: z.number().min(0).optional(),
});
type LineItemPatchInput = z.infer<typeof lineItemPatchInput>;

const updateLineItemInput = z.object({
  id: z.string().uuid(),
  patch: lineItemPatchInput,
});

// Builds the cents-domain DB patch for one billing line from a caller patch,
// clamping any retainage release to what the line can actually release. Shared
// by the single-line save and the save-all batch so both stay identical.
function buildBillingLineDbPatch(
  line: Record<string, unknown>,
  input: LineItemPatchInput,
): Record<string, number> {
  const patch: Record<string, number> = {};
  if (typeof input.work_completed_this_period === "number") {
    patch.work_completed_this_period_cents = dollarsToCents(input.work_completed_this_period);
  }
  if (typeof input.materials_stored_this_period === "number") {
    patch.materials_stored_this_period_cents = dollarsToCents(input.materials_stored_this_period);
  }
  if (typeof input.retainage_pct === "number") {
    patch.retainage_pct = input.retainage_pct;
  }
  const retainagePct =
    typeof input.retainage_pct === "number" ? input.retainage_pct : num(line.retainage_pct);
  const retainageReleaseCap = billingLineRetainageCapCents(line, retainagePct, patch);
  if (typeof input.retainage_released === "number") {
    patch.retainage_released_cents = Math.min(
      dollarsToCents(input.retainage_released),
      retainageReleaseCap,
    );
  } else if (
    typeof input.retainage_pct === "number" ||
    typeof input.work_completed_this_period === "number" ||
    typeof input.materials_stored_this_period === "number"
  ) {
    patch.retainage_released_cents = Math.min(
      num(line.retainage_released_cents),
      retainageReleaseCap,
    );
  }
  return patch;
}

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

    const patch = buildBillingLineDbPatch(line, data.patch);

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

const updateLineItemsInput = z.object({
  items: z.array(updateLineItemInput).min(1).max(500),
});

// Save-all: commit every changed pay-app line in one call, then sync each
// affected application ONCE. The field report was that per-line saves were the
// only way work reached the rollup ("save all lines would be nice" + "if it is
// working it is not rolling up") — this makes the whole application's entries
// land, and the totals move, in a single action. Same per-line math as the
// single save (shared buildBillingLineDbPatch), so the two can't diverge.
export const updateBillingLineItems = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateLineItemsInput>) =>
    updateLineItemsInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const authedProjects = new Set<string>();
    const applicationIds = new Set<string>();

    // Sequential so a failure stops cleanly and reports which line broke,
    // rather than leaving a half-applied batch behind concurrent writes.
    for (const item of data.items) {
      const lineRes = await dynamicTable(ctx.supabase, "billing_line_items")
        .select(billingLineRetainageSelect)
        .eq("id", item.id)
        .single();
      if (lineRes.error) throw new Error(lineRes.error.message);
      const line = lineRes.data as Record<string, unknown>;
      const projectId = line.project_id as string;
      if (!authedProjects.has(projectId)) {
        await requireCanManageProject(ctx, projectId);
        authedProjects.add(projectId);
      }
      const patch = buildBillingLineDbPatch(line, item.patch);
      const updateRes = await dynamicTable(ctx.supabase, "billing_line_items")
        .update(patch)
        .eq("id", item.id);
      if (updateRes.error) throw new Error(updateRes.error.message);
      applicationIds.add(line.billing_application_id as string);
    }

    for (const applicationId of applicationIds) {
      const syncRes = await ctx.supabase.rpc("sync_billing_application_from_lines", {
        p_billing_application_id: applicationId,
      });
      if (syncRes.error) throw new Error(syncRes.error.message);
    }
    return { ok: true, saved_count: data.items.length };
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

const costActualInput = z
  .object({
    projectId: z.string().uuid(),
    cost_bucket_id: z.string().uuid().nullable().optional(),
    cost_code: z.string().max(64).default(""),
    description: z.string().min(1).max(500),
    category: z
      .enum(["direct", "labor", "material", "equipment", "subcontract", "overhead"])
      .default("direct"),
    // Signed: a negative amount is a supplier credit / refund (field feedback
    // 2026-07-13). The bucket rollup trigger applies the signed delta, so a credit
    // reduces the code's actuals.
    amount: z.number(),
    vendor: z.string().max(200).default(""),
    reference_number: z.string().max(200).default(""),
    cost_date: z.string().min(1),
    status: z.enum(["draft", "committed", "approved", "paid"]).default("committed"),
    notes: z.string().max(2000).default(""),
    // Dollars of daily WIP this cost SETTLES (field feedback 2026-07-13): the
    // self-perform lump already folded into the bucket actual, which this vendor
    // invoice now covers. Netted out at the rollup chokepoint so the same dollars
    // aren't counted twice. Non-negative; a credit (amount < 0) forces 0 upstream.
    daily_wip_offset: z.number().min(0).default(0).optional(),
    invoice_attachment_path: z.string().max(1000).default(""),
    invoice_attachment_name: z.string().max(500).default(""),
    invoice_attachment_type: z.string().max(200).default(""),
    invoice_attachment_size: z.number().int().min(0).default(0),
    credit_applies_to_id: z.string().uuid().nullable().default(null),
    cost_document_id: z.string().uuid().optional(),
    exposure_id: z.string().uuid().nullable().default(null),
    subcontract_change_order_id: z.string().uuid().nullable().default(null),
    subcontract_payment_id: z.string().uuid().nullable().default(null),
  })
  .refine((value) => !(value.subcontract_change_order_id && value.subcontract_payment_id), {
    message: "Link a cost to either a subcontract change order or a progress payment, not both.",
  });

// The draft/approved stages need the payables-approval migration, and credits
// (negative amounts) need the cost_actual_credits migration. If either isn't
// applied yet the DB CHECK rejects the write — translate that into plain English
// instead of surfacing a constraint name.
const mapCostStatusError = (message: string) => {
  if (/credit_applies_to_id|credit link/i.test(message)) {
    return "Linked credits are not enabled yet (database update pending). Apply the billing settlement migration, then try again.";
  }
  if (/invoice_attachment_(path|name|type|size)/i.test(message)) {
    return "Invoice uploads are not enabled yet (database update pending). Apply the cost invoice attachment migration, then try again.";
  }
  if (/subcontract_change_order_id|subcontract_payment_id|subcontract link/i.test(message)) {
    return "Subcontract cost links are not enabled yet (database update pending). Apply the cost-to-subcontract migration, then try again.";
  }
  if (message.includes("cost_actuals_status_check")) {
    return 'The invoice approval stages are not enabled yet (database update pending). Save the cost as "Committed" or "Paid" for now.';
  }
  if (message.includes("cost_actuals_amount_check")) {
    return "Credits and refunds (negative amounts) are not enabled yet (database update pending). Enter a positive amount for now.";
  }
  return message;
};

// The daily_wip_offset column ships in the cost_actual_daily_wip_offset
// migration. Pre-migration, PostgREST rejects a write naming it — detect that so
// the cost still records (just without the WIP-settlement) until the desk applies
// it. Mirrors isMissingPaymentColumn's strip-and-retry pattern.
const isMissingWipOffsetColumn = (message: string) => /daily_wip_offset/i.test(message);
const isMissingSubcontractLinkColumn = (message: string) =>
  /subcontract_change_order_id|subcontract_payment_id/i.test(message);

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

    // A credit (amount < 0) can never settle daily WIP — clamp its offset to 0.
    const insertPayload = {
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
      daily_wip_offset: data.amount < 0 ? 0 : (data.daily_wip_offset ?? 0),
      invoice_attachment_path: data.invoice_attachment_path,
      invoice_attachment_name: data.invoice_attachment_name,
      invoice_attachment_type: data.invoice_attachment_type,
      invoice_attachment_size: data.invoice_attachment_size,
      credit_applies_to_id: data.amount < 0 ? data.credit_applies_to_id : null,
      ...(data.cost_document_id ? { cost_document_id: data.cost_document_id } : {}),
      exposure_id: data.exposure_id,
      subcontract_change_order_id: data.subcontract_change_order_id,
      subcontract_payment_id: data.subcontract_payment_id,
      ...(data.status === "approved"
        ? { approved_at: new Date().toISOString(), approved_by: ctx.userId }
        : {}),
      ...(data.status === "paid" ? { paid_at: new Date().toISOString() } : {}),
    };
    let insertRes = await dynamicTable(ctx.supabase, "cost_actuals").insert(insertPayload);
    // Pre-migration: the offset column doesn't exist yet — record the cost
    // anyway (drop the offset), never blocking the invoice.
    if (insertRes.error && isMissingWipOffsetColumn(insertRes.error.message)) {
      const { daily_wip_offset: _drop, ...withoutOffset } = insertPayload;
      insertRes = await dynamicTable(ctx.supabase, "cost_actuals").insert(withoutOffset);
    }
    // A deploy may briefly precede its Lovable-applied migration. Unlinked costs
    // still save during that window; a selected link fails clearly instead of
    // silently discarding the user's accounting attribution.
    if (
      insertRes.error &&
      isMissingSubcontractLinkColumn(insertRes.error.message) &&
      !data.subcontract_change_order_id &&
      !data.subcontract_payment_id
    ) {
      const {
        subcontract_change_order_id: _dropCo,
        subcontract_payment_id: _dropPayment,
        ...withoutSubcontractLinks
      } = insertPayload;
      insertRes = await dynamicTable(ctx.supabase, "cost_actuals").insert(withoutSubcontractLinks);
    }
    if (insertRes.error) throw new Error(mapCostStatusError(insertRes.error.message));
    return { ok: true };
  });

// Move an invoice through the payables lifecycle: draft → approved for payment
// → paid. Approving or paying a draft starts counting it as job cost (the DB
// trigger applies the delta); nothing else about the row changes.
// Edit a cost row's facts. Drafts carry no job cost (the rollup zeroes them);
// committed/approved rows DO count, and the bucket trigger recomputes
// actual_to_date from the amount/bucket delta on every UPDATE, so editing them
// keeps job cost exactly in sync (verified: tg_apply_cost_actual_to_bucket
// handles amount deltas and bucket moves). PAID is the line in the sand —
// money already went out the door, so a paid row stays locked: void it and
// enter a corrected cost, keeping both in the audit trail.
const updateCostActualInput = z
  .object({
    id: z.string().uuid(),
    cost_bucket_id: z.string().uuid().nullable().optional(),
    cost_code: z.string().max(64).default(""),
    description: z.string().min(1).max(500),
    category: z
      .enum(["direct", "labor", "material", "equipment", "subcontract", "overhead"])
      .default("direct"),
    // Signed: negative = supplier credit / refund (see costActualInput).
    amount: z.number(),
    vendor: z.string().max(200).default(""),
    reference_number: z.string().max(200).default(""),
    cost_date: z.string().min(1),
    notes: z.string().max(2000).default(""),
    // Daily-WIP this cost settles (see costActualInput). Optional with NO forced
    // default here: an edit that doesn't carry the field leaves the stored offset
    // untouched (undefined → omitted from the PostgREST body), so we never wipe an
    // offset set at creation; a supplied value updates it.
    daily_wip_offset: z.number().min(0).optional(),
    invoice_attachment_path: z.string().max(1000).optional(),
    invoice_attachment_name: z.string().max(500).optional(),
    invoice_attachment_type: z.string().max(200).optional(),
    invoice_attachment_size: z.number().int().min(0).optional(),
    credit_applies_to_id: z.string().uuid().nullable().optional(),
    exposure_id: z.string().uuid().nullable().optional(),
    subcontract_change_order_id: z.string().uuid().nullable().optional(),
    subcontract_payment_id: z.string().uuid().nullable().optional(),
  })
  .refine((value) => !(value.subcontract_change_order_id && value.subcontract_payment_id), {
    message: "Link a cost to either a subcontract change order or a progress payment, not both.",
  });

export const updateCostActual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateCostActualInput>) =>
    updateCostActualInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const actualRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .select("id,project_id,status")
      .eq("id", data.id)
      .single();
    if (actualRes.error) throw new Error(actualRes.error.message);
    const actual = actualRes.data as Record<string, unknown>;
    await requireCanManageProject(ctx, actual.project_id as string);
    const currentStatus = str(actual.status, "committed");
    if (currentStatus === "paid") {
      throw new Error(
        "This cost is already paid — money went out the door. Void it and enter a corrected cost instead.",
      );
    }
    if (currentStatus === "void") {
      throw new Error("This cost was voided — enter a new cost instead.");
    }

    // Resolve the bucket from the cost code when no explicit bucket came in —
    // the same matching the create path uses.
    let bucketId = data.cost_bucket_id ?? null;
    if (!bucketId && data.cost_code.trim()) {
      const bucketRes = await dynamicTable(ctx.supabase, "cost_buckets")
        .select("id,cost_code")
        .eq("project_id", actual.project_id as string);
      if (bucketRes.error) throw new Error(bucketRes.error.message);
      const match = ((bucketRes.data ?? []) as Record<string, unknown>[]).find(
        (bucket) => normalizeKey(str(bucket.cost_code)) === normalizeKey(data.cost_code),
      );
      bucketId = (match?.id as string | undefined) ?? null;
    }

    const { id, ...fields } = data;
    // A credit (amount < 0) can never settle daily WIP — clamp its offset to 0
    // when the edit carries one; leave it untouched otherwise (undefined omits it).
    const updatePayload: Record<string, unknown> = {
      ...fields,
      cost_bucket_id: bucketId,
      cost_code: fields.cost_code.trim(),
    };
    if (fields.daily_wip_offset !== undefined && data.amount < 0) {
      updatePayload.daily_wip_offset = 0;
    }
    updatePayload.credit_applies_to_id =
      data.amount < 0 ? (fields.credit_applies_to_id ?? null) : null;
    // Re-assert the stage IN the update itself: between the check above and
    // this write, someone else may have marked the row paid (or voided it) —
    // the predicate makes that race land as "0 rows", never as an edit to
    // money that already went out the door.
    const runUpdate = (payload: Record<string, unknown>) =>
      dynamicTable(ctx.supabase, "cost_actuals")
        .update(payload)
        .eq("id", id)
        .neq("status", "paid")
        .neq("status", "void")
        .select("id")
        .maybeSingle();
    let updateRes = await runUpdate(updatePayload);
    // Pre-migration: the offset column doesn't exist yet — retry without it so
    // the edit still lands.
    if (updateRes.error && isMissingWipOffsetColumn(updateRes.error.message)) {
      const { daily_wip_offset: _drop, ...withoutOffset } = updatePayload;
      updateRes = await runUpdate(withoutOffset);
    }
    if (
      updateRes.error &&
      isMissingSubcontractLinkColumn(updateRes.error.message) &&
      !data.subcontract_change_order_id &&
      !data.subcontract_payment_id
    ) {
      const {
        subcontract_change_order_id: _dropCo,
        subcontract_payment_id: _dropPayment,
        ...withoutSubcontractLinks
      } = updatePayload;
      updateRes = await runUpdate(withoutSubcontractLinks);
    }
    if (updateRes.error) throw new Error(mapCostStatusError(updateRes.error.message));
    if (!updateRes.data) {
      throw new Error(
        "This cost changed state while you were editing — someone marked it paid or voided it. Reload and try again.",
      );
    }
    return { ok: true };
  });

const setCostActualStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["approved", "paid"]),
  // How it was paid (field request 2026-07-10) — only meaningful on the 'paid'
  // transition; ignored for 'approved'. All optional so a bare mark-paid works.
  payment_method: z.string().max(40).optional(),
  payment_reference: z.string().max(200).optional(),
  paid_date: z.string().nullable().optional(),
});

// The payment-detail columns ship in the cost-payment-details migration.
// Pre-migration, PostgREST rejects an update naming them — detect that so the
// paid transition still lands (details are just dropped until the desk applies).
const isMissingPaymentColumn = (message: string) =>
  /payment_method|payment_reference|paid_date/i.test(message);

export const setCostActualStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof setCostActualStatusInput>) =>
    setCostActualStatusInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as BillingServerContext;
    const actualRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .select("id,project_id,status,approved_at")
      .eq("id", data.id)
      .single();
    if (actualRes.error) throw new Error(actualRes.error.message);
    const actual = actualRes.data as Record<string, unknown>;
    await requireCanManageProject(ctx, actual.project_id as string);
    const current = str(actual.status, "committed");
    if (current === "void") throw new Error("This cost was voided — it can't be approved or paid.");
    if (current === "paid") throw new Error("This cost is already marked paid.");
    const now = new Date().toISOString();
    // The lifecycle stamps (status + approval/paid_at) always apply; the "how
    // paid" details are layered on top only when marking paid.
    const core = {
      status: data.status,
      // Stamp approval the first time the row passes through it — marking a
      // draft straight to paid still records who approved the spend.
      ...(actual.approved_at ? {} : { approved_at: now, approved_by: ctx.userId }),
      ...(data.status === "paid" ? { paid_at: now } : {}),
    };
    const paymentDetails =
      data.status === "paid"
        ? {
            payment_method: data.payment_method ?? "",
            payment_reference: data.payment_reference ?? "",
            paid_date: data.paid_date || null,
          }
        : {};
    let updateRes = await dynamicTable(ctx.supabase, "cost_actuals")
      .update({ ...core, ...paymentDetails })
      .eq("id", data.id);
    // Pre-migration: the detail columns don't exist yet — flip the status
    // anyway so marking paid never blocks, and drop the details silently.
    if (updateRes.error && isMissingPaymentColumn(updateRes.error.message)) {
      updateRes = await dynamicTable(ctx.supabase, "cost_actuals").update(core).eq("id", data.id);
    }
    if (updateRes.error) throw new Error(mapCostStatusError(updateRes.error.message));
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
    // Archived projects (including a hidden Harbor demo) stay out of the
    // billing portfolio, matching the main project list.
    const projectRes = await dynamicTable(ctx.supabase, "projects")
      .select("*")
      .is("archived_at", null)
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

// ---------------- JOB COST REPORT (REPORTS P3.2) ----------------

export interface JobCostProject {
  project_id: string;
  project_name: string;
  job_number: string;
  client: string;
  project_manager: string;
  ledger: BudgetLedger;
}

export interface JobCostSummary {
  projects: JobCostProject[];
  // Portfolio rollup of every project's ledger totals — the same shape as a
  // ledger row so the report foots identically at the project and portfolio
  // level.
  totals: BudgetLedgerRow;
}

const normalizeExposure = (row: Record<string, unknown>): ExposureLike => ({
  id: str(row.id),
  dollar_exposure: num(row.dollar_exposure),
  hold_class: str(row.hold_class, "None") as HoldClass,
});

const normalizeExposureAllocation = (row: Record<string, unknown>): ExposureAllocationLike => ({
  exposure_id: str(row.exposure_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  amount: num(row.amount),
});

// Group raw rows by project_id before normalizing — the Like shapes the ledger
// consumes intentionally drop project_id, so grouping has to happen on the raw
// rows first.
const groupRawByProject = (rows: Record<string, unknown>[]) => {
  const map = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const pid = row.project_id as string;
    if (!pid) continue;
    const list = map.get(pid);
    if (list) list.push(row);
    else map.set(pid, [row]);
  }
  return map;
};

// The Job Cost report: budget vs actual by cost code, per project. Reuses the
// exact budget-vs-cost ledger the project Budget tab computes (BUDGETENGINE),
// so this report can never disagree with the project screen. One fetch scoped
// to the caller's active projects (same RLS pattern as listPortfolioBilling),
// then the client picks a job.
export const listPortfolioJobCost = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<JobCostSummary> => {
    const ctx = context as unknown as BillingServerContext;
    const projectRes = await dynamicTable(ctx.supabase, "projects")
      .select("*")
      .is("archived_at", null)
      .order("name", { ascending: true });
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projectRows = (projectRes.data ?? []) as Record<string, unknown>[];
    const ids = projectRows.map((project) => project.id as string).filter(Boolean);
    const emptyLedgerRow: BudgetLedgerRow = {
      costBucketId: null,
      costCode: "",
      description: "Total",
      contractValue: 0,
      changeOrderContract: 0,
      priced: false,
      margin: null,
      marginPct: null,
      budget: 0,
      originalBudget: 0,
      changeOrderBudget: 0,
      actuals: 0,
      open: 0,
      atRisk: 0,
      contingency: 0,
      eac: 0,
      overUnder: 0,
    };
    if (ids.length === 0) {
      return { projects: [], totals: emptyLedgerRow };
    }

    const [
      bucketRes,
      exposureRes,
      allocationRes,
      changeOrderRes,
      coAllocationRes,
      subRes,
      subAllocRes,
      subPayRes,
      subCoRes,
      subSplitRes,
      dailyWipRes,
      costActualRes,
    ] = await Promise.all([
      dynamicTable(ctx.supabase, "cost_buckets").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "exposures").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "exposure_allocations").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "change_orders").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "change_order_allocations").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "subcontracts").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "subcontract_allocations").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "subcontract_payments").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "subcontract_change_orders").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "subcontract_payment_allocations")
        .select("*")
        .in("project_id", ids),
      dynamicTable(ctx.supabase, "daily_wip_entries").select("*").in("project_id", ids),
      dynamicTable(ctx.supabase, "cost_actuals").select("*").in("project_id", ids),
    ]);
    if (bucketRes.error) throw new Error(bucketRes.error.message);
    // Exposures / allocations power the At Risk + Contingency columns only; if
    // either table isn't present yet, the ledger still stands on budget/actuals.
    const exposuresMissing = isMissingRestRelation(exposureRes.error, "exposures");
    const allocationsMissing = isMissingRestRelation(allocationRes.error, "exposure_allocations");
    if (exposureRes.error && !exposuresMissing) throw new Error(exposureRes.error.message);
    if (allocationRes.error && !allocationsMissing) throw new Error(allocationRes.error.message);
    if (changeOrderRes.error) throw new Error(changeOrderRes.error.message);
    // BUDGETLOCK1: approved CO cost layers onto the frozen baseline. Degrade to
    // no CO layer if the allocations table is absent.
    const coAllocationsMissing = isMissingRestRelation(
      coAllocationRes.error,
      "change_order_allocations",
    );
    if (coAllocationRes.error && !coAllocationsMissing) {
      throw new Error(coAllocationRes.error.message);
    }

    const rawBuckets = bucketRes.data ? (bucketRes.data as Record<string, unknown>[]) : [];
    const rawExposures =
      exposureRes.error || !exposureRes.data ? [] : (exposureRes.data as Record<string, unknown>[]);
    const rawAllocations =
      allocationRes.error || !allocationRes.data
        ? []
        : (allocationRes.data as Record<string, unknown>[]);
    const rawChangeOrders = changeOrderRes.data
      ? (changeOrderRes.data as Record<string, unknown>[])
      : [];
    const rawCoAllocations =
      coAllocationRes.error || !coAllocationRes.data
        ? []
        : (coAllocationRes.data as Record<string, unknown>[]);

    // SUBCONTRACTORS Slice 1: the additive sub cost layer. Degrade to no layer
    // if the tables aren't present yet, exactly like the CO allocations above.
    const rawSubs =
      isMissingRestRelation(subRes.error, "subcontracts") || !subRes.data
        ? []
        : (subRes.data as Record<string, unknown>[]);
    const rawSubAllocs =
      isMissingRestRelation(subAllocRes.error, "subcontract_allocations") || !subAllocRes.data
        ? []
        : (subAllocRes.data as Record<string, unknown>[]);
    const rawSubPays =
      isMissingRestRelation(subPayRes.error, "subcontract_payments") || !subPayRes.data
        ? []
        : (subPayRes.data as Record<string, unknown>[]);
    const rawSubCos =
      isMissingRestRelation(subCoRes.error, "subcontract_change_orders") || !subCoRes.data
        ? []
        : (subCoRes.data as Record<string, unknown>[]);
    const rawSubSplits =
      isMissingRestRelation(subSplitRes.error, "subcontract_payment_allocations") ||
      !subSplitRes.data
        ? []
        : (subSplitRes.data as Record<string, unknown>[]);
    // Daily-WIP entries feed earned value (latest field % per sub+code). Degrade
    // to no layer if the table isn't present, like the sub tables above.
    const rawDailyWip =
      isMissingRestRelation(dailyWipRes.error, "daily_wip_entries") || !dailyWipRes.data
        ? []
        : (dailyWipRes.data as Record<string, unknown>[]);
    const rawCostActuals =
      isMissingRestRelation(costActualRes.error, "cost_actuals") || !costActualRes.data
        ? []
        : (costActualRes.data as Record<string, unknown>[]);

    const bucketsByProject = groupRawByProject(rawBuckets);
    const exposuresByProject = groupRawByProject(rawExposures);
    const allocationsByProject = groupRawByProject(rawAllocations);
    const changeOrdersByProject = groupRawByProject(rawChangeOrders);
    const coAllocationsByProject = groupRawByProject(rawCoAllocations);
    const subsByProject = groupRawByProject(rawSubs);
    const subAllocsByProject = groupRawByProject(rawSubAllocs);
    const subPaysByProject = groupRawByProject(rawSubPays);
    const subCosByProject = groupRawByProject(rawSubCos);
    const subSplitsByProject = groupRawByProject(rawSubSplits);
    const dailyWipByProject = groupRawByProject(rawDailyWip);
    const costActualsByProject = groupRawByProject(rawCostActuals);

    const projects = projectRows.map((projectRow) => {
      const pid = projectRow.id as string;
      // Earned-value input: latest field % per (sub company, cost code), so the
      // job-cost report recognizes sub cost the same way the budget tab does.
      const currentPct = latestPercentBySubBucket(
        (dailyWipByProject.get(pid) ?? []).map((row) => ({
          subcontractor_id: (row.subcontractor_id as string | null) ?? null,
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          percent_complete: num(row.percent_complete),
          entry_date: str(row.entry_date),
          updated_at: (row.updated_at as string | null) ?? null,
        })),
      );
      const subCostByBucket = summarizeSubCostByBucket(
        (subsByProject.get(pid) ?? []).map((row) => ({
          id: str(row.id),
          contract_value: num(row.contract_value),
          status: str(row.status),
          subcontractor_id: str(row.subcontractor_id),
        })),
        (subAllocsByProject.get(pid) ?? []).map((row) => ({
          subcontract_id: str(row.subcontract_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        (subPaysByProject.get(pid) ?? []).map((row) => ({
          id: str(row.id),
          subcontract_id: str(row.subcontract_id),
          amount: num(row.amount),
          // Pre-lifecycle rows have no status column — they were paid facts.
          status: str(row.status, "paid"),
        })),
        currentPct,
        // Coded sub COs fold into committed — job-cost reporting matches the
        // Budget grid and dashboard after a change order lands.
        (subCosByProject.get(pid) ?? []).map((row) => ({
          id: str(row.id),
          subcontract_id: str(row.subcontract_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        // Explicit per-payment splits override the pro-rata paid distribution.
        (subSplitsByProject.get(pid) ?? []).map((row) => ({
          payment_id: str(row.payment_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
        })),
        (costActualsByProject.get(pid) ?? []).map((row) => ({
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          amount: num(row.amount),
          status: str(row.status),
          subcontract_change_order_id: (row.subcontract_change_order_id as string | null) ?? null,
          subcontract_payment_id: (row.subcontract_payment_id as string | null) ?? null,
        })),
      );
      const ledger = computeBudgetLedger(
        (bucketsByProject.get(pid) ?? []).map(normalizeBucket),
        (exposuresByProject.get(pid) ?? []).map(normalizeExposure),
        (allocationsByProject.get(pid) ?? []).map(normalizeExposureAllocation),
        (changeOrdersByProject.get(pid) ?? []).map((row) => ({
          id: str(row.id),
          status: str(row.status),
          contract_amount: num(row.contract_amount),
          cost_amount: num(row.cost_amount),
        })),
        (coAllocationsByProject.get(pid) ?? []).map((row) => ({
          change_order_id: str(row.change_order_id),
          cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
          contract_amount: num(row.contract_amount),
          cost_amount: num(row.cost_amount),
        })),
        subCostByBucket,
      );
      return {
        project_id: pid,
        project_name: str(projectRow.name),
        job_number: str(projectRow.job_number),
        client: str(projectRow.client),
        project_manager: str(projectRow.project_manager),
        ledger,
      } satisfies JobCostProject;
    });

    const totals = projects.reduce<BudgetLedgerRow>((acc, project) => {
      const t = project.ledger.totals;
      const anyMargin = acc.margin !== null || t.margin !== null;
      return {
        costBucketId: null,
        costCode: "",
        description: "Total",
        contractValue: acc.contractValue + t.contractValue,
        changeOrderContract: acc.changeOrderContract + t.changeOrderContract,
        priced: acc.priced || t.priced,
        // Portfolio margin = Σ per-project priced margins; % is not meaningful
        // across mixed priced/unpriced portfolios, so it stays null here.
        margin: anyMargin ? (acc.margin ?? 0) + (t.margin ?? 0) : null,
        marginPct: null,
        budget: acc.budget + t.budget,
        originalBudget: acc.originalBudget + t.originalBudget,
        changeOrderBudget: acc.changeOrderBudget + t.changeOrderBudget,
        actuals: acc.actuals + t.actuals,
        open: acc.open + t.open,
        atRisk: acc.atRisk + t.atRisk,
        contingency: acc.contingency + t.contingency,
        eac: acc.eac + t.eac,
        overUnder: acc.overUnder + t.overUnder,
      };
    }, emptyLedgerRow);

    return { projects, totals };
  });

// ---------------- BILLING HISTORY REPORT (REPORTS P3.3) ----------------

export interface BillingHistoryEntry {
  id: string;
  application_number: string;
  invoice_number: string;
  submitted_date: string | null;
  billing_period: string;
  output_format: string;
  status: string;
  amount_billed: number;
  retainage: number;
  paid_to_date: number;
  // Running cumulative of amount_billed across this project's applications, in
  // submission order — "billed to date" as of each requisition.
  billed_to_date: number;
}

export interface BillingHistoryProject {
  project_id: string;
  project_name: string;
  job_number: string;
  client: string;
  entries: BillingHistoryEntry[];
  total_billed: number;
  total_retainage: number;
  total_paid: number;
}

export interface BillingHistorySummary {
  projects: BillingHistoryProject[];
  totals: {
    project_count: number;
    application_count: number;
    total_billed: number;
    total_retainage: number;
    total_paid: number;
  };
}

// The Billing history report: every requisition (pay application) on a job, in
// order, with what was billed, retainage held, the running billed-to-date, and
// where payment stands. Same billing_applications the project billing workspace
// reads, so the history can never disagree with the project screen.
export const listPortfolioBillingHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingHistorySummary> => {
    const ctx = context as unknown as BillingServerContext;
    const projectRes = await dynamicTable(ctx.supabase, "projects")
      .select("*")
      .is("archived_at", null)
      .order("name", { ascending: true });
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projectRows = (projectRes.data ?? []) as Record<string, unknown>[];
    const ids = projectRows.map((project) => project.id as string).filter(Boolean);
    const emptyTotals = {
      project_count: 0,
      application_count: 0,
      total_billed: 0,
      total_retainage: 0,
      total_paid: 0,
    };
    if (ids.length === 0) {
      return { projects: [], totals: emptyTotals };
    }

    const appRes = await dynamicTable(ctx.supabase, "billing_applications")
      .select("*")
      .in("project_id", ids);
    // The report stands even before any billing has happened.
    if (appRes.error && !isMissingRestRelation(appRes.error, "billing_applications")) {
      throw new Error(appRes.error.message);
    }
    const appRows = appRes.error || !appRes.data ? [] : (appRes.data as Record<string, unknown>[]);
    const appsByProject = groupRawByProject(appRows);

    const projects = projectRows
      .map((projectRow) => {
        const pid = projectRow.id as string;
        const rows = (appsByProject.get(pid) ?? []).slice().sort((a, b) => {
          const orderDelta = num(a.sort_order) - num(b.sort_order);
          if (orderDelta !== 0) return orderDelta;
          return str(a.submitted_date).localeCompare(str(b.submitted_date));
        });
        let runningBilled = 0;
        const entries: BillingHistoryEntry[] = rows.map((row) => {
          const amountBilled = num(row.amount_billed);
          runningBilled += amountBilled;
          return {
            id: str(row.id),
            application_number: str(row.application_number),
            invoice_number: str(row.invoice_number),
            submitted_date: (row.submitted_date as string | null) ?? null,
            billing_period: str(row.billing_period),
            output_format: str(row.output_format, "invoice"),
            status: str(row.status, "draft"),
            amount_billed: amountBilled,
            retainage: num(row.retainage),
            paid_to_date: num(row.paid_to_date),
            billed_to_date: runningBilled,
          };
        });
        return {
          project_id: pid,
          project_name: str(projectRow.name),
          job_number: str(projectRow.job_number),
          client: str(projectRow.client),
          entries,
          total_billed: entries.reduce((sum, entry) => sum + entry.amount_billed, 0),
          total_retainage: entries.reduce((sum, entry) => sum + entry.retainage, 0),
          total_paid: entries.reduce((sum, entry) => sum + entry.paid_to_date, 0),
        } satisfies BillingHistoryProject;
      })
      // Only jobs that have actually billed belong on a billing history.
      .filter((project) => project.entries.length > 0);

    const totals = projects.reduce(
      (acc, project) => {
        acc.project_count += 1;
        acc.application_count += project.entries.length;
        acc.total_billed += project.total_billed;
        acc.total_retainage += project.total_retainage;
        acc.total_paid += project.total_paid;
        return acc;
      },
      { ...emptyTotals },
    );

    return { projects, totals };
  });

// ---------------- CHANGE ORDER LOG REPORT (REPORTS P3.4) ----------------

export interface ChangeOrderEntry {
  id: string;
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
  status: string; // Approved | Pending | Denied
  co_type: string;
}

export interface ChangeOrderProject {
  project_id: string;
  project_name: string;
  job_number: string;
  client: string;
  original_contract: number;
  approved_contract: number;
  pending_contract: number;
  // original + approved (the contract you can bill against today).
  revised_contract: number;
  change_orders: ChangeOrderEntry[];
}

export interface ChangeOrderReportSummary {
  projects: ChangeOrderProject[];
  totals: {
    project_count: number;
    change_order_count: number;
    original_contract: number;
    approved_contract: number;
    pending_contract: number;
    revised_contract: number;
  };
}

// The Change order log report: every change order on a job with its contract
// and cost impact, plus the original → approved → revised contract roll-up so
// the contract's growth is auditable. Approved is the only status that moves
// the revised contract, matching the WIP/billing engine (status === "Approved").
export const listPortfolioChangeOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ChangeOrderReportSummary> => {
    const ctx = context as unknown as BillingServerContext;
    const projectRes = await dynamicTable(ctx.supabase, "projects")
      .select("*")
      .is("archived_at", null)
      .order("name", { ascending: true });
    if (projectRes.error) throw new Error(projectRes.error.message);
    const projectRows = (projectRes.data ?? []) as Record<string, unknown>[];
    const ids = projectRows.map((project) => project.id as string).filter(Boolean);
    const emptyTotals = {
      project_count: 0,
      change_order_count: 0,
      original_contract: 0,
      approved_contract: 0,
      pending_contract: 0,
      revised_contract: 0,
    };
    if (ids.length === 0) {
      return { projects: [], totals: emptyTotals };
    }

    const coRes = await dynamicTable(ctx.supabase, "change_orders")
      .select("*")
      .in("project_id", ids);
    if (coRes.error) throw new Error(coRes.error.message);
    const coRows = (coRes.data ?? []) as Record<string, unknown>[];
    const cosByProject = groupRawByProject(coRows);

    const projects = projectRows
      .map((projectRow) => {
        const pid = projectRow.id as string;
        const rows = cosByProject.get(pid) ?? [];
        const changeOrders: ChangeOrderEntry[] = rows
          .map((row) => ({
            id: str(row.id),
            number: str(row.number),
            description: str(row.description),
            contract_amount: num(row.contract_amount),
            cost_amount: num(row.cost_amount),
            status: str(row.status, "Pending"),
            co_type: str(row.co_type),
          }))
          .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
        const approved = changeOrders
          .filter((co) => co.status === "Approved")
          .reduce((sum, co) => sum + co.contract_amount, 0);
        const pending = changeOrders
          .filter((co) => co.status === "Pending")
          .reduce((sum, co) => sum + co.contract_amount, 0);
        const originalContract = num(projectRow.original_contract);
        return {
          project_id: pid,
          project_name: str(projectRow.name),
          job_number: str(projectRow.job_number),
          client: str(projectRow.client),
          original_contract: originalContract,
          approved_contract: approved,
          pending_contract: pending,
          revised_contract: originalContract + approved,
          change_orders: changeOrders,
        } satisfies ChangeOrderProject;
      })
      // A change-order report is about jobs that actually have change orders.
      .filter((project) => project.change_orders.length > 0);

    const totals = projects.reduce(
      (acc, project) => {
        acc.project_count += 1;
        acc.change_order_count += project.change_orders.length;
        acc.original_contract += project.original_contract;
        acc.approved_contract += project.approved_contract;
        acc.pending_contract += project.pending_contract;
        acc.revised_contract += project.revised_contract;
        return acc;
      },
      { ...emptyTotals },
    );

    return { projects, totals };
  });
