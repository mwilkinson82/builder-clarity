// Per-project subcontracts, cost-code allocations, and progress payments
// (SUBCONTRACTORS Slice 1). Project-scoped (can_read/can_manage_project). The
// budget effect is additive and computed in the app (subcontract-budget.ts) —
// nothing here touches cost_actuals. Financial reads fail closed: a query or
// schema failure must never masquerade as an empty buyout/payment ledger.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { dollarsToCents } from "@/lib/payments-domain";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly unknown[]): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  rpc(functionName: string, args?: Record<string, unknown>): Promise<DynamicSupabaseResult>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);
const dynamicRpc = (supabase: unknown, functionName: string, args?: Record<string, unknown>) =>
  (supabase as DynamicSupabaseClient).rpc(functionName, args);

const INVALID_FINANCIAL_RESPONSE =
  "Subcontract financials returned incomplete data. Refresh and try again; do not rely on buyout, payment, budget, or WIP totals until this loads.";

const num = (value: unknown, field: string) => {
  if (value === null || value === undefined || value === "") {
    throw new Error(`${INVALID_FINANCIAL_RESPONSE} Missing field: ${field}.`);
  }
  const n = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(n)) {
    throw new Error(`${INVALID_FINANCIAL_RESPONSE} Invalid field: ${field}.`);
  }
  return n;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function isMissingSubcontractTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    error?.code === "42P01" ||
    (/subcontract/i.test(message) &&
      /does not exist|could not find.*schema cache|schema cache.*could not find/i.test(message))
  );
}

const NOT_ENABLED =
  "Subcontractors aren't enabled on this workspace yet — the subcontracts tables haven't been applied.";
const SUBCONTRACT_FINANCIAL_READ_FAILED =
  "Subcontract financials could not be loaded. Refresh and try again. If the problem continues, contact support before relying on buyout, payment, budget, or WIP totals.";
const MAX_SAFE_DOLLARS = Number.MAX_SAFE_INTEGER / 100;
const exactCentMoney = z
  .number()
  .positive()
  .max(MAX_SAFE_DOLLARS)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
    "Enter an amount with no more than two decimal places.",
  );
const exactCentNonnegativeMoney = z
  .number()
  .min(0)
  .max(MAX_SAFE_DOLLARS)
  .refine(
    (value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-7,
    "Enter an amount with no more than two decimal places.",
  );

const ATOMIC_PAYMENT_UPDATE_PENDING =
  "The financial-integrity database update is still being applied. No payment or lien waiver was changed; try again in a few minutes.";

function isMissingAtomicPaymentFunction(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST202" ||
    error?.code === "42883" ||
    /schema cache|could not find the function|function .* does not exist/i.test(message)
  );
}

function throwAtomicPaymentError(error: DynamicSupabaseError) {
  if (isMissingAtomicPaymentFunction(error)) throw new Error(ATOMIC_PAYMENT_UPDATE_PENDING);
  throw new Error(error.message);
}

function paymentFromRpc(data: unknown): SubcontractPaymentRow {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("The payment transaction completed without returning its payment record.");
  }
  return normalizePayment(data as Record<string, unknown>);
}

export interface SubcontractRow {
  id: string;
  project_id: string;
  subcontractor_id: string;
  title: string;
  scope: string;
  contract_value: number;
  retainage_pct: number;
  status: string;
  executed_at: string | null;
  executed_contract_path: string;
  executed_contract_name: string;
  executed_contract_uploaded_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface SubcontractAllocationRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  amount: number;
  planned_quantity: number;
  unit: string;
  benchmark_labor_rate: number;
  updated_at: string;
}
// A pay app's lifecycle (field request 2026-07-09): the sub submits it and it's
// logged as a DRAFT, the PM marks it APPROVED for payment, then PAID when the
// money goes out. Only 'paid' rows count as actual cost in the budget. The
// lifecycle migration backfilled older rows as paid; API responses must now
// carry an explicit status so schema lag cannot silently imply payment.
export type SubPaymentStatus = "draft" | "approved" | "paid";

export interface SubcontractPaymentRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  amount: number;
  retainage_held: number;
  payment_date: string;
  reference: string;
  notes: string;
  status: SubPaymentStatus;
  approved_at: string | null;
  exposure_id: string | null;
  // How this pay app was paid (field request 2026-07-10, mirrors cost #273):
  // method wire/check/card/ach/other; the check#/wire confirmation lives on
  // `reference`; the date paid on `payment_date`.
  payment_method: string;
  // Compliance override (field request 2026-07-10, Marshall-approved): a
  // non-empty reason means this pay app was paid despite a failing lien-waiver/
  // insurance gate. Audited — who/when live on overridden_by/at (server-only).
  compliance_override_reason: string;
  compliance_overridden_at: string | null;
  updated_at: string;
}
// A change order or credit against a subcontract, kept SEPARATE from the base
// contracted amount (field request 2026-07-09). amount is signed dollars:
// change order positive, credit negative. Optional cost-code tag for context.
export interface SubcontractChangeOrderRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  amount: number;
  co_date: string;
  exposure_id: string | null;
  updated_at: string;
}
// One version of a subcontract's paper — original, an amendment, a re-negotiated
// copy. Many per subcontract; exactly one is_active = the current contract.
export interface SubcontractDocumentRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  storage_path: string;
  file_name: string;
  note: string;
  is_active: boolean;
  uploaded_at: string;
}
// An explicit per-payment cost-code split row (field request 2026-07-09). A
// payment with rows here uses them verbatim; without, the pro-rata derivation
// from the buyout's allocations applies.
export interface SubcontractPaymentAllocationRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  payment_id: string;
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  amount: number;
}
export interface ProjectSubcontracts {
  subcontracts: SubcontractRow[];
  allocations: SubcontractAllocationRow[];
  payments: SubcontractPaymentRow[];
  documents: SubcontractDocumentRow[];
  change_orders: SubcontractChangeOrderRow[];
  payment_allocations: SubcontractPaymentAllocationRow[];
}

const normalizeSubcontract = (row: Record<string, unknown>): SubcontractRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontractor_id: str(row.subcontractor_id),
  title: str(row.title),
  scope: str(row.scope),
  contract_value: num(row.contract_value, "subcontracts.contract_value"),
  retainage_pct: num(row.retainage_pct, "subcontracts.retainage_pct"),
  status: str(row.status, "draft"),
  executed_at: (row.executed_at as string | null) ?? null,
  executed_contract_path: str(row.executed_contract_path),
  executed_contract_name: str(row.executed_contract_name),
  executed_contract_uploaded_at: (row.executed_contract_uploaded_at as string | null) ?? null,
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});
const normalizeAllocation = (row: Record<string, unknown>): SubcontractAllocationRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  amount: num(row.amount, "subcontract_allocations.amount"),
  planned_quantity: num(row.planned_quantity, "subcontract_allocations.planned_quantity"),
  unit: str(row.unit),
  benchmark_labor_rate: num(
    row.benchmark_labor_rate,
    "subcontract_allocations.benchmark_labor_rate",
  ),
  updated_at: str(row.updated_at),
});
const normalizePayment = (row: Record<string, unknown>): SubcontractPaymentRow => {
  const status = str(row.status);
  if (status !== "draft" && status !== "approved" && status !== "paid") {
    throw new Error(`${INVALID_FINANCIAL_RESPONSE} Invalid field: subcontract_payments.status.`);
  }
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    subcontract_id: str(row.subcontract_id),
    amount: num(row.amount, "subcontract_payments.amount"),
    retainage_held: num(row.retainage_held, "subcontract_payments.retainage_held"),
    payment_date: str(row.payment_date),
    reference: str(row.reference),
    notes: str(row.notes),
    status,
    approved_at: (row.approved_at as string | null) ?? null,
    exposure_id: (row.exposure_id as string | null) ?? null,
    payment_method: str(row.payment_method),
    compliance_override_reason: str(row.compliance_override_reason),
    compliance_overridden_at: (row.compliance_overridden_at as string | null) ?? null,
    updated_at: str(row.updated_at),
  };
};
const normalizeChangeOrder = (row: Record<string, unknown>): SubcontractChangeOrderRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  amount: num(row.amount, "subcontract_change_orders.amount"),
  co_date: str(row.co_date),
  exposure_id: (row.exposure_id as string | null) ?? null,
  updated_at: str(row.updated_at),
});

const RISK_LINKS_NOT_ENABLED =
  "Subcontract Risk Tally links aren't enabled yet — the database update is still pending.";

function isMissingExposureColumn(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || /column|schema cache/i.test(message)) &&
    /exposure_id/i.test(message)
  );
}

async function validateExposureForProject(
  supabase: unknown,
  exposureId: string | null,
  projectId: string,
) {
  if (!exposureId) return;
  const { data: exposure, error } = await dynamicTable(supabase, "exposures")
    .select("id,project_id")
    .eq("id", exposureId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!exposure || str((exposure as Record<string, unknown>).project_id) !== projectId) {
    throw new Error("That risk belongs to a different project or is no longer available.");
  }
}
const normalizeDocument = (row: Record<string, unknown>): SubcontractDocumentRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  storage_path: str(row.storage_path),
  file_name: str(row.file_name),
  note: str(row.note),
  is_active: Boolean(row.is_active),
  uploaded_at: str(row.uploaded_at),
});
const normalizePaymentAllocation = (
  row: Record<string, unknown>,
): SubcontractPaymentAllocationRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  payment_id: str(row.payment_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  amount: num(row.amount, "subcontract_payment_allocations.amount"),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

// One call hydrates the whole tab: subcontracts + allocations + payments for a
// project. The response is atomic from the application's perspective: if any
// financial relation fails, callers get an error rather than a partial ledger.
export async function readProjectSubcontracts(
  supabase: unknown,
  projectId: string,
): Promise<ProjectSubcontracts> {
  const readList = async (relation: string, order: string) => {
    const { data: rows, error } = await dynamicTable(supabase, relation)
      .select("*")
      .eq("project_id", projectId)
      .order(order, { ascending: false });
    if (error) {
      if (isMissingSubcontractTable(error)) {
        throw new Error(
          `${NOT_ENABLED} Financial totals and actions are blocked until setup is complete.`,
        );
      }
      throw new Error(
        `${SUBCONTRACT_FINANCIAL_READ_FAILED} Database detail (${relation}): ${error.message}`,
      );
    }
    if (!Array.isArray(rows)) {
      throw new Error(`${INVALID_FINANCIAL_RESPONSE} Invalid relation: ${relation}.`);
    }
    return rows as Record<string, unknown>[];
  };
  const [subs, allocs, pays, docs, changeOrders, paymentAllocations] = await Promise.all([
    readList("subcontracts", "created_at"),
    readList("subcontract_allocations", "created_at"),
    readList("subcontract_payments", "payment_date"),
    readList("subcontract_documents", "uploaded_at"),
    readList("subcontract_change_orders", "co_date"),
    readList("subcontract_payment_allocations", "created_at"),
  ]);
  return {
    subcontracts: subs.map(normalizeSubcontract),
    allocations: allocs.map(normalizeAllocation),
    payments: pays.map(normalizePayment),
    documents: docs.map(normalizeDocument),
    change_orders: changeOrders.map(normalizeChangeOrder),
    payment_allocations: paymentAllocations.map(normalizePaymentAllocation),
  };
}

export const listProjectSubcontracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectSubcontracts> =>
    readProjectSubcontracts(context.supabase, data.projectId),
  );

const subcontractFieldsInput = z.object({
  subcontractor_id: z.string().uuid(),
  title: z.string().max(300).default(""),
  scope: z.string().max(8000).default(""),
  contract_value: exactCentNonnegativeMoney.default(0),
  retainage_pct: z.number().min(0).max(100).default(0),
  status: z.enum(["draft", "executed"]).default("draft"),
  executed_at: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "executed_at must be YYYY-MM-DD")
    .nullable()
    .default(null),
});

export const saveSubcontract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        id: z.string().uuid().optional(),
        expected_updated_at: z.string().datetime({ offset: true }).nullable().default(null),
        operation_key: z.string().trim().min(1).max(200),
      })
      .merge(subcontractFieldsInput)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractRow> => {
    const { projectId, id, expected_updated_at, operation_key, contract_value, ...fields } = data;
    const result = await dynamicRpc(context.supabase, "save_subcontract_atomic", {
      p_project_id: projectId,
      p_subcontract_id: id ?? null,
      p_expected_updated_at: expected_updated_at,
      p_patch: { ...fields, contract_value_cents: dollarsToCents(contract_value) },
      p_operation_key: operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeSubcontract(result.data as Record<string, unknown>);
  });

export const deleteSubcontract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "delete_untouched_subcontract_draft_atomic", {
      p_subcontract_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { id: data.id };
  });

// Deactivate every document on a subcontract, so the caller can then flag exactly
// one active (uploading a new version, or re-tagging an older one). Single-active
// is enforced here rather than by a DB constraint because the REST client can
// only touch one row-set per call.
async function deactivateSubcontractDocuments(supabase: unknown, subcontractId: string) {
  const { error } = await dynamicTable(supabase, "subcontract_documents")
    .update({ is_active: false })
    .eq("subcontract_id", subcontractId);
  if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
}

// Add a contract version to a subcontract's paper trail and make it the active
// one (the prior active version stays, just flagged inactive). The bytes are
// uploaded to the 'subcontract-docs' bucket client-side (like daily reports);
// this records the storage path + display name and flips the active flag.
export const addSubcontractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        subcontractId: z.string().uuid(),
        projectId: z.string().uuid(),
        path: z.string().min(1).max(500),
        name: z.string().min(1).max(300),
        note: z.string().max(300).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractDocumentRow> => {
    await deactivateSubcontractDocuments(context.supabase, data.subcontractId);
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_documents")
      .insert({
        subcontract_id: data.subcontractId,
        project_id: data.projectId,
        storage_path: data.path,
        file_name: data.name,
        note: data.note,
        is_active: true,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeDocument(row as Record<string, unknown>);
  });

// Re-tag which stored version is the active contract (point back to an older one,
// or forward again). Deactivates the siblings first so exactly one stays active.
export const setActiveSubcontractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), subcontractId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    await deactivateSubcontractDocuments(context.supabase, data.subcontractId);
    const { error } = await dynamicTable(context.supabase, "subcontract_documents")
      .update({ is_active: true })
      .eq("id", data.id);
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return { id: data.id };
  });

// Remove one stored version (for a genuine mistake — the paper trail is meant to
// be kept). Storage bytes are removed client-side.
export const deleteSubcontractDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "subcontract_documents")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

export const allocateSubcontract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        subcontractId: z.string().uuid(),
        costBucketId: z.string().uuid(),
        amount: exactCentNonnegativeMoney.default(0),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractAllocationRow> => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_allocation_atomic", {
      p_subcontract_id: data.subcontractId,
      p_allocation_id: null,
      p_expected_updated_at: null,
      p_patch: {
        cost_bucket_id: data.costBucketId,
        amount_cents: dollarsToCents(data.amount),
      },
      p_delete: false,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeAllocation(result.data as Record<string, unknown>);
  });

// Re-price a buyout's allocation on a cost code — the lever for a change order or
// credit that moves the committed cost on that code up or down. Only the dollar
// amount changes; the code it lands on is fixed (delete + re-add to move codes).
export const updateSubcontractAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subcontractId: z.string().uuid(),
        amount: exactCentNonnegativeMoney,
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractAllocationRow> => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_allocation_atomic", {
      p_subcontract_id: data.subcontractId,
      p_allocation_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: { amount_cents: dollarsToCents(data.amount) },
      p_delete: false,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeAllocation(result.data as Record<string, unknown>);
  });

// Persist the GC's production assumptions on the exact bought-out allocation.
// The hourly figure is deliberately a labor-equivalent benchmark selected by
// the GC, not a claim about the subcontractor's private payroll or burden.
export const updateSubcontractProductionBenchmark = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subcontractId: z.string().uuid(),
        planned_quantity: z.number().min(0),
        unit: z.string().trim().max(40),
        benchmark_labor_rate: exactCentNonnegativeMoney,
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractAllocationRow> => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_allocation_atomic", {
      p_subcontract_id: data.subcontractId,
      p_allocation_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: {
        planned_quantity: data.planned_quantity,
        unit: data.unit,
        benchmark_labor_rate_cents: dollarsToCents(data.benchmark_labor_rate),
      },
      p_delete: false,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeAllocation(result.data as Record<string, unknown>);
  });

export const deleteSubcontractAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subcontractId: z.string().uuid(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_allocation_atomic", {
      p_subcontract_id: data.subcontractId,
      p_allocation_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: {},
      p_delete: true,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { id: data.id };
  });

// Record a change order (positive) or credit (negative) against a subcontract —
// its own line item, deliberately NOT an edit to contract_value: the base
// contract and the CO/credit trail stay separate, and the app derives the
// revised total. Optional cost-code tag stamped off the bucket for context
// (mirrors allocateSubcontract).
export const recordSubcontractChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        subcontractId: z.string().uuid(),
        costBucketId: z.string().uuid().nullable().default(null),
        description: z.string().max(500).default(""),
        amount: z
          .number()
          .refine((value) => value !== 0, "Enter the change order or credit amount."),
        co_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "co_date must be YYYY-MM-DD"),
        exposureId: z.string().uuid().nullable().default(null),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractChangeOrderRow> => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_change_order_atomic", {
      p_subcontract_id: data.subcontractId,
      p_change_order_id: null,
      p_expected_updated_at: null,
      p_patch: {
        cost_bucket_id: data.costBucketId,
        description: data.description,
        amount_cents: dollarsToCents(data.amount),
        co_date: data.co_date,
        exposure_id: data.exposureId,
      },
      p_delete: false,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeChangeOrder(result.data as Record<string, unknown>);
  });

export const setSubcontractChangeOrderExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subcontractId: z.string().uuid(),
        exposureId: z.string().uuid().nullable(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractChangeOrderRow> => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_change_order_atomic", {
      p_subcontract_id: data.subcontractId,
      p_change_order_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: { exposure_id: data.exposureId },
      p_delete: false,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return normalizeChangeOrder(result.data as Record<string, unknown>);
  });

export const deleteSubcontractChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        subcontractId: z.string().uuid(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "mutate_subcontract_change_order_atomic", {
      p_subcontract_id: data.subcontractId,
      p_change_order_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: {},
      p_delete: true,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { id: data.id };
  });

export const recordSubcontractPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        subcontractId: z.string().uuid(),
        amount: exactCentMoney,
        retainage_held: exactCentNonnegativeMoney.default(0),
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "payment_date must be YYYY-MM-DD"),
        reference: z.string().max(200).default(""),
        notes: z.string().max(4000).default(""),
        // Lifecycle stage the row lands in. Default 'paid' = the pre-lifecycle
        // behaviour, so existing callers keep recording paid facts.
        status: z.enum(["draft", "approved", "paid"]).default("paid"),
        exposureId: z.string().uuid().nullable().default(null),
        // A typed reason overrides a failing gate (audited); absent → gate blocks.
        override_reason: z.string().max(500).optional(),
        // Stable across retries of one user submission. The database rejects
        // reuse with different details instead of recording a second payment.
        idempotency_key: z.string().trim().min(1).max(200),
      })
      .refine((value) => value.retainage_held <= value.amount, {
        message: "Retainage held cannot exceed the gross payment amount.",
        path: ["retainage_held"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    // The compliance read, payment insert, waiver assignment, override audit,
    // and final status are one PostgreSQL transaction. There is deliberately no
    // legacy direct-insert fallback: if the RPC is unavailable, fail closed.
    const result = await dynamicRpc(context.supabase, "record_subcontract_payment_atomic", {
      p_project_id: data.projectId,
      p_subcontract_id: data.subcontractId,
      p_amount_cents: dollarsToCents(data.amount),
      p_retainage_held_cents: dollarsToCents(data.retainage_held),
      p_payment_date: data.payment_date,
      p_reference: data.reference,
      p_notes: data.notes,
      p_status: data.status,
      p_exposure_id: data.exposureId,
      p_override_reason: data.override_reason?.trim() || null,
      p_idempotency_key: data.idempotency_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return paymentFromRpc(result.data);
  });

export const setSubcontractPaymentExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        exposureId: z.string().uuid().nullable(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const result = await dynamicRpc(context.supabase, "update_subcontract_payment_draft_atomic", {
      p_payment_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_patch: { exposure_id: data.exposureId },
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return paymentFromRpc(result.data);
  });

// Walk a pay app forward: draft → approved (for payment) → paid. BOTH forward
// transitions run the per-payment gate (field request 2026-07-10): the pay app
// needs a lien waiver tied to this payment record + verified insurance before
// it can even be APPROVED — marking it paid re-checks (the COI could have
// lapsed between approval and the check run).
export const setSubcontractPaymentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        status: z.enum(["approved", "paid"]),
        // A typed reason overrides a failing gate (Marshall-approved 2026-07-10)
        // — deliberate + audited. Absent → the gate blocks as before.
        override_reason: z.string().max(500).optional(),
        // How it was paid (field request 2026-07-10, mirrors cost #273) — only
        // meaningful on the 'paid' transition. reference = check#/wire conf.
        payment_method: z.string().max(40).optional(),
        payment_reference: z.string().max(200).optional(),
        paid_date: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "paid_date must be YYYY-MM-DD")
          .nullable()
          .optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const result = await dynamicRpc(context.supabase, "transition_subcontract_payment_atomic", {
      p_payment_id: data.id,
      p_status: data.status,
      p_override_reason: data.override_reason?.trim() || null,
      p_payment_method: data.payment_method ?? null,
      p_payment_reference: data.payment_reference ?? null,
      p_paid_date: data.paid_date ?? null,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return paymentFromRpc(result.data);
  });

// Tie an on-file lien waiver to one pay app (field request 2026-07-10: "attach
// that lien waiver to that payment record"). The waiver and payment must belong
// to the same subcontract, and a waiver already covering another payment can't
// be moved — collect a new one instead.
export const attachLienWaiverToPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ waiverId: z.string().uuid(), paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "attach_lien_waiver_to_payment_atomic", {
      p_waiver_id: data.waiverId,
      p_payment_id: data.paymentId,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { ok: true };
  });

// Undo an attach made in error only while the pay app is a draft. Once it is
// approved or paid, its waiver is part of the permanent payment paper trail.
export const detachLienWaiverFromPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ waiverId: z.string().uuid(), paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "detach_lien_waiver_from_payment_atomic", {
      p_waiver_id: data.waiverId,
      p_payment_id: data.paymentId,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { ok: true };
  });

// Edit a recorded payment after the fact — fix the date, the amount, the
// retainage held, or add a description. Same validated shape as recording one.
export const updateSubcontractPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        amount: exactCentMoney,
        retainage_held: exactCentNonnegativeMoney.default(0),
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "payment_date must be YYYY-MM-DD"),
        reference: z.string().max(200).default(""),
        notes: z.string().max(4000).default(""),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .refine((value) => value.retainage_held <= value.amount, {
        message: "Retainage held cannot exceed the gross payment amount.",
        path: ["retainage_held"],
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const { id, expected_updated_at, operation_key, ...fields } = data;
    const result = await dynamicRpc(context.supabase, "update_subcontract_payment_draft_atomic", {
      p_payment_id: id,
      p_expected_updated_at: expected_updated_at,
      p_patch: fields,
      p_operation_key: operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return paymentFromRpc(result.data);
  });

export const deleteSubcontractPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        expected_updated_at: z.string().datetime({ offset: true }),
        operation_key: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const result = await dynamicRpc(context.supabase, "delete_subcontract_payment_draft_atomic", {
      p_payment_id: data.id,
      p_expected_updated_at: data.expected_updated_at,
      p_operation_key: data.operation_key,
    });
    if (result.error) throwAtomicPaymentError(result.error);
    return { id: data.id };
  });

// Replace a payment's explicit cost-code split (field request 2026-07-09:
// "for progress payments … add which cost code it goes to"). Empty rows =
// clear the explicit split, falling back to the pro-rata derivation. Non-empty
// rows must sum cents-exact to the payment so the budget's paid-per-code never
// drifts from cash.
//
// Replacement is one database transaction. The RPC locks the parent pay app,
// derives its project/subcontract, validates cost-bucket scope and cents, then
// swaps every row. Approved and paid coding is frozen in the database.
export const setSubcontractPaymentSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        paymentId: z.string().uuid(),
        rows: z
          .array(
            z.object({
              cost_bucket_id: z.string().uuid().nullable(),
              cost_code: z.string().max(80).default(""),
              description: z.string().max(300).default(""),
              amount: exactCentMoney,
            }),
          )
          .max(40)
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ paymentId: string; rowCount: number }> => {
    const result = await dynamicRpc(
      context.supabase,
      "replace_subcontract_payment_allocations_atomic",
      {
        p_payment_id: data.paymentId,
        p_rows: data.rows.map((row) => ({
          cost_bucket_id: row.cost_bucket_id,
          cost_code: row.cost_code,
          description: row.description,
          amount_cents: dollarsToCents(row.amount),
        })),
      },
    );
    if (result.error) throwAtomicPaymentError(result.error);
    return { paymentId: data.paymentId, rowCount: data.rows.length };
  });
