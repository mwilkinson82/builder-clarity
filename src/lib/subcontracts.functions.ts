// Per-project subcontracts, cost-code allocations, and progress payments
// (SUBCONTRACTORS Slice 1). Project-scoped (can_read/can_manage_project). The
// budget effect is additive and computed in the app (subcontract-budget.ts) —
// nothing here touches cost_actuals. Reads degrade to empty and writes surface a
// clear "not enabled yet" message before the migration lands (mirrors
// daily_wip_entries).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  canApproveSubPayment,
  canPaySubcontract,
  subcontractInsuranceStatus,
} from "@/lib/compliance-domain";

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
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function isMissingSubcontractTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" || /subcontract|schema cache|does not exist|relation/i.test(message)
  );
}

const NOT_ENABLED =
  "Subcontractors aren't enabled on this workspace yet — the subcontracts tables haven't been applied.";

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
}
// A pay app's lifecycle (field request 2026-07-09): the sub submits it and it's
// logged as a DRAFT, the PM marks it APPROVED for payment, then PAID when the
// money goes out. Only 'paid' rows count as actual cost in the budget. Rows
// recorded before the lifecycle existed have no status column → treated as paid.
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
  contract_value: num(row.contract_value),
  retainage_pct: num(row.retainage_pct),
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
  amount: num(row.amount),
});
const normalizePayment = (row: Record<string, unknown>): SubcontractPaymentRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  amount: num(row.amount),
  retainage_held: num(row.retainage_held),
  payment_date: str(row.payment_date),
  reference: str(row.reference),
  notes: str(row.notes),
  status: str(row.status, "paid") as SubPaymentStatus,
  approved_at: (row.approved_at as string | null) ?? null,
  exposure_id: (row.exposure_id as string | null) ?? null,
  payment_method: str(row.payment_method),
  compliance_override_reason: str(row.compliance_override_reason),
  compliance_overridden_at: (row.compliance_overridden_at as string | null) ?? null,
});
const normalizeChangeOrder = (row: Record<string, unknown>): SubcontractChangeOrderRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  cost_bucket_id: (row.cost_bucket_id as string | null) ?? null,
  cost_code: str(row.cost_code),
  description: str(row.description),
  amount: num(row.amount),
  co_date: str(row.co_date),
  exposure_id: (row.exposure_id as string | null) ?? null,
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
  amount: num(row.amount),
});

const projectIdInput = z.object({ projectId: z.string().uuid() });

// One call hydrates the whole tab: subcontracts + allocations + payments for a
// project. Each read degrades to [] independently before the migration lands.
export const listProjectSubcontracts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) => projectIdInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectSubcontracts> => {
    const readList = async (relation: string, order: string) => {
      const { data: rows, error } = await dynamicTable(context.supabase, relation)
        .select("*")
        .eq("project_id", data.projectId)
        .order(order, { ascending: false });
      if (error) {
        if (isMissingSubcontractTable(error)) return [];
        throw new Error(error.message);
      }
      return (rows ?? []) as Record<string, unknown>[];
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
  });

const subcontractFieldsInput = z.object({
  subcontractor_id: z.string().uuid(),
  title: z.string().max(300).default(""),
  scope: z.string().max(8000).default(""),
  contract_value: z.number().min(0).default(0),
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
      .object({ projectId: z.string().uuid(), id: z.string().uuid().optional() })
      .merge(subcontractFieldsInput)
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractRow> => {
    const { projectId, id, ...fields } = data;
    const table = dynamicTable(context.supabase, "subcontracts");
    const query = id
      ? table.update(fields).eq("id", id).select("*").single()
      : table
          .insert({ project_id: projectId, ...fields })
          .select("*")
          .single();
    const { data: row, error } = await query;
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeSubcontract(row as Record<string, unknown>);
  });

export const deleteSubcontract = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Allocations + payments cascade with the subcontract (ON DELETE CASCADE).
    const { error } = await dynamicTable(context.supabase, "subcontracts")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
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
        amount: z.number().min(0).default(0),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractAllocationRow> => {
    // Stamp cost_code/description off the bucket for readable context (mirrors
    // allocateChangeOrder). The bucket read is RLS-gated to this project.
    const { data: bucket, error: bucketError } = await dynamicTable(
      context.supabase,
      "cost_buckets",
    )
      .select("id,project_id,cost_code,bucket")
      .eq("id", data.costBucketId)
      .single();
    if (bucketError) {
      if (isMissingSubcontractTable(bucketError)) throw new Error(NOT_ENABLED);
      throw new Error(bucketError.message);
    }
    const bucketRow = bucket as Record<string, unknown>;
    if (str(bucketRow.project_id) !== data.projectId) {
      throw new Error("That cost code belongs to a different project.");
    }
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_allocations")
      .insert({
        project_id: data.projectId,
        subcontract_id: data.subcontractId,
        cost_bucket_id: data.costBucketId,
        cost_code: str(bucketRow.cost_code),
        description: str(bucketRow.bucket),
        amount: data.amount,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeAllocation(row as Record<string, unknown>);
  });

// Re-price a buyout's allocation on a cost code — the lever for a change order or
// credit that moves the committed cost on that code up or down. Only the dollar
// amount changes; the code it lands on is fixed (delete + re-add to move codes).
export const updateSubcontractAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), amount: z.number().min(0) }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractAllocationRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_allocations")
      .update({ amount: data.amount })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeAllocation(row as Record<string, unknown>);
  });

export const deleteSubcontractAllocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "subcontract_allocations")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractChangeOrderRow> => {
    await validateExposureForProject(context.supabase, data.exposureId, data.projectId);
    let costCode = "";
    let bucketLabel = "";
    if (data.costBucketId) {
      const { data: bucket, error: bucketError } = await dynamicTable(
        context.supabase,
        "cost_buckets",
      )
        .select("id,project_id,cost_code,bucket")
        .eq("id", data.costBucketId)
        .single();
      if (bucketError) {
        if (isMissingSubcontractTable(bucketError)) throw new Error(NOT_ENABLED);
        throw new Error(bucketError.message);
      }
      const bucketRow = bucket as Record<string, unknown>;
      if (str(bucketRow.project_id) !== data.projectId) {
        throw new Error("That cost code belongs to a different project.");
      }
      costCode = str(bucketRow.cost_code);
      bucketLabel = str(bucketRow.bucket);
    }
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_change_orders")
      .insert({
        project_id: data.projectId,
        subcontract_id: data.subcontractId,
        cost_bucket_id: data.costBucketId,
        cost_code: costCode,
        description: data.description || bucketLabel,
        amount: data.amount,
        co_date: data.co_date,
        exposure_id: data.exposureId,
      })
      .select("*")
      .single();
    if (error) {
      if (data.exposureId && isMissingExposureColumn(error))
        throw new Error(RISK_LINKS_NOT_ENABLED);
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeChangeOrder(row as Record<string, unknown>);
  });

export const setSubcontractChangeOrderExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), exposureId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractChangeOrderRow> => {
    const current = await dynamicTable(context.supabase, "subcontract_change_orders")
      .select("id,project_id")
      .eq("id", data.id)
      .single();
    if (current.error) throw new Error(current.error.message);
    const projectId = str((current.data as Record<string, unknown>).project_id);
    await validateExposureForProject(context.supabase, data.exposureId, projectId);
    const result = await dynamicTable(context.supabase, "subcontract_change_orders")
      .update({ exposure_id: data.exposureId })
      .eq("id", data.id)
      .select("*")
      .single();
    if (result.error) {
      if (isMissingExposureColumn(result.error)) throw new Error(RISK_LINKS_NOT_ENABLED);
      throw new Error(result.error.message);
    }
    return normalizeChangeOrder(result.data as Record<string, unknown>);
  });

export const deleteSubcontractChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "subcontract_change_orders")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

// COMPLIANCE GATE (docs/compliance arc, module 2). Unless the project has opted
// out (require_compliance_gating = false, or the column/tables aren't there yet),
// a sub can't be paid without a valid COI as of the payment date AND an unused
// lien waiver on file. Fails OPEN on any read error — a DB hiccup must never trap
// a legitimate payment; a genuinely MISSING cert/waiver (clean empty read) still
// blocks, which is the whole point. Returns the waiver id to consume on success.
async function evaluateSubPaymentGate(
  supabase: unknown,
  projectId: string,
  subcontractId: string,
  paymentDate: string,
): Promise<{ allowed: boolean; blockers: string[]; consumeWaiverId: string | null }> {
  const OPEN = { allowed: true, blockers: [] as string[], consumeWaiverId: null };
  // Couldn't verify a hard money gate → FAIL CLOSED: block with a retry so a
  // transient DB error can't let an uncompliant payment slip through. (This only
  // fires once gating is confirmed ON below — pre-migration stays open.)
  const CLOSED = {
    allowed: false,
    blockers: ["Couldn't verify insurance/lien-waiver status right now — try again in a moment."],
    consumeWaiverId: null,
  };
  const projRes = await dynamicTable(supabase, "projects")
    .select("require_compliance_gating")
    .eq("id", projectId)
    .maybeSingle();
  // Absent column / read error here is indistinguishable from "feature not
  // provisioned yet" (pre-migration), so stay OPEN — never block a project that
  // hasn't turned this on. Once we can read the toggle, the same migration has
  // provisioned the cert/waiver tables, so errors past this point are transient.
  if (projRes.error || !projRes.data) return OPEN;
  const gatingEnabled =
    (projRes.data as Record<string, unknown>).require_compliance_gating !== false;
  if (!gatingEnabled) return OPEN;

  const certsRes = await dynamicTable(supabase, "insurance_certificates")
    .select("*")
    .eq("subcontract_id", subcontractId);
  if (certsRes.error) return CLOSED; // gating is ON but we couldn't check → block
  const certs = ((certsRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
    verified: c.verified === true,
    effective_date: (c.effective_date as string | null) ?? null,
    expiry_date: (c.expiry_date as string | null) ?? null,
  }));
  const status = subcontractInsuranceStatus(certs, paymentDate);

  const waiversRes = await dynamicTable(supabase, "lien_waivers")
    .select("*")
    .eq("subcontract_id", subcontractId);
  if (waiversRes.error) return CLOSED;
  const unconsumed = ((waiversRes.data ?? []) as Record<string, unknown>[]).filter(
    (w) => !w.payment_id,
  );
  const result = canPaySubcontract({
    gatingEnabled: true,
    insuranceStatus: status,
    hasCoveringWaiver: unconsumed.length > 0,
  });
  return {
    ...result,
    consumeWaiverId:
      result.allowed && unconsumed.length > 0 ? str(unconsumed[unconsumed.length - 1].id) : null,
  };
}

// PER-PAYMENT gate (field request 2026-07-10): a pay app can't move FORWARD
// (draft → approved, or on to paid) until a lien waiver is tied to that
// specific payment record AND the sub's insurance is verified as of the
// payment date. A waiver sitting unattached in the sub's on-file pool counts —
// it auto-attaches when the transition succeeds (attachWaiverId), which is the
// same consumption the record-as-paid path has always done. Same OPEN/CLOSED
// posture as evaluateSubPaymentGate: pre-migration reads stay open; a
// transient read error once gating is confirmed ON blocks with a retry.
async function evaluateSubApprovalGate(
  supabase: unknown,
  projectId: string,
  subcontractId: string,
  paymentId: string,
  asOfDate: string,
): Promise<{ allowed: boolean; blockers: string[]; attachWaiverId: string | null }> {
  const OPEN = { allowed: true, blockers: [] as string[], attachWaiverId: null };
  const CLOSED = {
    allowed: false,
    blockers: ["Couldn't verify insurance/lien-waiver status right now — try again in a moment."],
    attachWaiverId: null,
  };
  const projRes = await dynamicTable(supabase, "projects")
    .select("require_compliance_gating")
    .eq("id", projectId)
    .maybeSingle();
  if (projRes.error || !projRes.data) return OPEN;
  const gatingEnabled =
    (projRes.data as Record<string, unknown>).require_compliance_gating !== false;
  if (!gatingEnabled) return OPEN;

  const certsRes = await dynamicTable(supabase, "insurance_certificates")
    .select("*")
    .eq("subcontract_id", subcontractId);
  if (certsRes.error) return CLOSED;
  const certs = ((certsRes.data ?? []) as Record<string, unknown>[]).map((c) => ({
    verified: c.verified === true,
    effective_date: (c.effective_date as string | null) ?? null,
    expiry_date: (c.expiry_date as string | null) ?? null,
  }));
  const status = subcontractInsuranceStatus(certs, asOfDate);

  const waiversRes = await dynamicTable(supabase, "lien_waivers")
    .select("*")
    .eq("subcontract_id", subcontractId);
  if (waiversRes.error) return CLOSED;
  const waivers = (waiversRes.data ?? []) as Record<string, unknown>[];
  const attached = waivers.some((w) => str(w.payment_id) === paymentId);
  const pool = waivers.filter((w) => !w.payment_id);

  const result = canApproveSubPayment({
    gatingEnabled: true,
    insuranceStatus: status,
    // An unattached on-file waiver satisfies the gate — it becomes THIS pay
    // app's waiver the moment the transition succeeds.
    hasAttachedWaiver: attached || pool.length > 0,
  });
  return {
    ...result,
    attachWaiverId:
      result.allowed && !attached && pool.length > 0 ? str(pool[pool.length - 1].id) : null,
  };
}

// The status column ships in the payables-approval migration. Pre-migration,
// PostgREST rejects an insert/update naming it — detect that specific miss so
// the legacy record-as-paid path can keep working while the desk catches up.
const isMissingPaymentStatusColumn = (error: DynamicSupabaseError | null) => {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || /column/i.test(message)) && /status|approved_at/i.test(message)
  );
};

const STAGES_NOT_ENABLED =
  "The pay-app approval stages aren't enabled yet (database update pending). Record the payment as paid for now.";

// The override audit columns ship in the sub-payment-compliance-override
// migration. Pre-migration we must NOT silently pay past the gate without
// logging the override, so a missing column surfaces a clear "not enabled yet".
const isMissingOverrideColumn = (error: DynamicSupabaseError | null) =>
  /compliance_override/i.test(error?.message ?? "");
// The payment_method column ships in the sub-payment-method migration.
const isMissingPaymentMethodColumn = (error: DynamicSupabaseError | null) =>
  /payment_method/i.test(error?.message ?? "");
const OVERRIDE_NOT_ENABLED =
  "The compliance override isn't enabled yet (database update pending) — attach the waiver/COI, or try the override again once the update lands.";

// Whether a gate block should be overridden this call, given a typed reason.
// Marshall's policy (2026-07-10): keep the hard block by default; an override
// is only honored WITH a non-empty reason, which is then audited.
const overrideOf = (reason: string | undefined) => (reason ?? "").trim();

export const recordSubcontractPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        subcontractId: z.string().uuid(),
        amount: z.number().min(0),
        retainage_held: z.number().min(0).default(0),
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "payment_date must be YYYY-MM-DD"),
        reference: z.string().max(200).default(""),
        notes: z.string().max(4000).default(""),
        // Lifecycle stage the row lands in. Default 'paid' = the pre-lifecycle
        // behaviour, so existing callers keep recording paid facts.
        status: z.enum(["draft", "approved", "paid"]).default("paid"),
        exposureId: z.string().uuid().nullable().default(null),
        // A typed reason overrides a failing gate (audited); absent → gate blocks.
        override_reason: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const { projectId, subcontractId, status, override_reason, exposureId, ...fields } = data;
    await validateExposureForProject(context.supabase, exposureId, projectId);

    // Logging a DRAFT pay app needs nothing on file — that's the inbox. Landing
    // directly at approved-for-payment or paid is gated (field request
    // 2026-07-10: no approval without a lien waiver + verified insurance); the
    // waiver that clears it is attached to the payment right after insert.
    const gate =
      status !== "draft"
        ? await evaluateSubPaymentGate(
            context.supabase,
            projectId,
            subcontractId,
            fields.payment_date,
          )
        : { allowed: true, blockers: [] as string[], consumeWaiverId: null };
    const reason = overrideOf(override_reason);
    const overriding = !gate.allowed && reason.length > 0;
    if (!gate.allowed && !overriding) {
      throw new Error(
        `${status === "paid" ? "Payment blocked" : "Can't approve for payment"} — compliance not met. ${gate.blockers.join(" ")} Add the missing item, override with a reason, or turn off "Require lien waivers + insurance" for this project.`,
      );
    }
    const now = new Date().toISOString();
    const overrideStamp = overriding
      ? {
          compliance_override_reason: reason,
          compliance_overridden_by: context.userId,
          compliance_overridden_at: now,
        }
      : {};

    const base = {
      project_id: projectId,
      subcontract_id: subcontractId,
      exposure_id: exposureId,
      ...fields,
    };
    let insertRes = await dynamicTable(context.supabase, "subcontract_payments")
      .insert({
        ...base,
        status,
        ...(status === "approved" ? { approved_at: now } : {}),
        ...overrideStamp,
      })
      .select("*")
      .single();
    if (insertRes.error && isMissingExposureColumn(insertRes.error)) {
      if (exposureId) throw new Error(RISK_LINKS_NOT_ENABLED);
      const { exposure_id: _exposureId, ...baseWithoutExposure } = base;
      insertRes = await dynamicTable(context.supabase, "subcontract_payments")
        .insert({
          ...baseWithoutExposure,
          status,
          ...(status === "approved" ? { approved_at: now } : {}),
          ...overrideStamp,
        })
        .select("*")
        .single();
    }
    if (insertRes.error && overriding && isMissingOverrideColumn(insertRes.error)) {
      throw new Error(OVERRIDE_NOT_ENABLED);
    }
    if (insertRes.error && isMissingPaymentStatusColumn(insertRes.error)) {
      // Migration not applied yet: a paid row is exactly the legacy shape, so
      // record it the old way; the new stages have nothing to fall back to.
      if (status !== "paid") throw new Error(STAGES_NOT_ENABLED);
      const { exposure_id: _exposureId, ...legacyBase } = base;
      insertRes = await dynamicTable(context.supabase, "subcontract_payments")
        .insert(legacyBase)
        .select("*")
        .single();
    }
    if (insertRes.error) {
      if (isMissingSubcontractTable(insertRes.error)) throw new Error(NOT_ENABLED);
      throw new Error(insertRes.error.message);
    }
    const payment = normalizePayment(insertRes.data as Record<string, unknown>);
    // Consume the waiver that cleared the gate — link it so it can't clear a
    // second payment (best-effort; the payment already succeeded).
    if (gate.consumeWaiverId) {
      await dynamicTable(context.supabase, "lien_waivers")
        .update({ payment_id: payment.id })
        .eq("id", gate.consumeWaiverId);
    }
    return payment;
  });

export const setSubcontractPaymentExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid(), exposureId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const current = await dynamicTable(context.supabase, "subcontract_payments")
      .select("id,project_id")
      .eq("id", data.id)
      .single();
    if (current.error) throw new Error(current.error.message);
    const projectId = str((current.data as Record<string, unknown>).project_id);
    await validateExposureForProject(context.supabase, data.exposureId, projectId);
    const result = await dynamicTable(context.supabase, "subcontract_payments")
      .update({ exposure_id: data.exposureId })
      .eq("id", data.id)
      .select("*")
      .single();
    if (result.error) {
      if (isMissingExposureColumn(result.error)) throw new Error(RISK_LINKS_NOT_ENABLED);
      throw new Error(result.error.message);
    }
    return normalizePayment(result.data as Record<string, unknown>);
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
        paid_date: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_payments")
      .select("*")
      .eq("id", data.id)
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    const current = normalizePayment(row as Record<string, unknown>);
    if (current.status === "paid") throw new Error("This pay app is already marked paid.");

    const gate = await evaluateSubApprovalGate(
      context.supabase,
      current.project_id,
      current.subcontract_id,
      current.id,
      current.payment_date,
    );
    // Gate blocked: honor a typed override (audited), else surface the blockers.
    const reason = overrideOf(data.override_reason);
    const overriding = !gate.allowed && reason.length > 0;
    if (!gate.allowed && !overriding) {
      throw new Error(
        `${data.status === "paid" ? "Payment blocked" : "Can't approve for payment"} — compliance not met. ${gate.blockers.join(" ")} Attach the missing item, override with a reason, or turn off "Require lien waivers + insurance" for this project.`,
      );
    }

    const now = new Date().toISOString();
    // "How paid" details ride along on the paid transition (field request
    // 2026-07-10). Only overwrite fields the caller actually supplied.
    const paymentDetails: Record<string, unknown> = {};
    if (data.status === "paid") {
      if (data.payment_method !== undefined) paymentDetails.payment_method = data.payment_method;
      if (data.payment_reference !== undefined) paymentDetails.reference = data.payment_reference;
      if (data.paid_date) paymentDetails.payment_date = data.paid_date;
    }
    const core = {
      status: data.status,
      // First pass through approval stamps it — a draft marked straight to
      // paid still records when the spend was approved.
      ...(current.approved_at ? {} : { approved_at: now }),
      ...(overriding
        ? {
            compliance_override_reason: reason,
            compliance_overridden_by: context.userId,
            compliance_overridden_at: now,
          }
        : {}),
    };
    let updateRes = await dynamicTable(context.supabase, "subcontract_payments")
      .update({ ...core, ...paymentDetails })
      .eq("id", data.id)
      .select("*")
      .single();
    // Pre-migration: payment_method column not there yet — retry without it so
    // the transition (and the always-present reference/payment_date) still land.
    if (updateRes.error && isMissingPaymentMethodColumn(updateRes.error)) {
      const { payment_method: _pm, ...detailsNoMethod } = paymentDetails;
      updateRes = await dynamicTable(context.supabase, "subcontract_payments")
        .update({ ...core, ...detailsNoMethod })
        .eq("id", data.id)
        .select("*")
        .single();
    }
    if (updateRes.error) {
      if (overriding && isMissingOverrideColumn(updateRes.error))
        throw new Error(OVERRIDE_NOT_ENABLED);
      if (isMissingPaymentStatusColumn(updateRes.error)) throw new Error(STAGES_NOT_ENABLED);
      throw new Error(updateRes.error.message);
    }
    const payment = normalizePayment(updateRes.data as Record<string, unknown>);
    // A pool waiver cleared the gate — tie it to this pay app so it can't clear
    // a second one (best-effort; the transition already succeeded).
    if (gate.attachWaiverId) {
      await dynamicTable(context.supabase, "lien_waivers")
        .update({ payment_id: payment.id })
        .eq("id", gate.attachWaiverId);
    }
    return payment;
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
    const payRes = await dynamicTable(context.supabase, "subcontract_payments")
      .select("id,subcontract_id")
      .eq("id", data.paymentId)
      .single();
    if (payRes.error) {
      if (isMissingSubcontractTable(payRes.error)) throw new Error(NOT_ENABLED);
      throw new Error(payRes.error.message);
    }
    const waiverRes = await dynamicTable(context.supabase, "lien_waivers")
      .select("id,subcontract_id,payment_id")
      .eq("id", data.waiverId)
      .single();
    if (waiverRes.error) throw new Error(waiverRes.error.message);
    const waiver = waiverRes.data as Record<string, unknown>;
    const payment = payRes.data as Record<string, unknown>;
    if (str(waiver.subcontract_id) !== str(payment.subcontract_id)) {
      throw new Error("That lien waiver belongs to a different subcontract.");
    }
    if (waiver.payment_id && str(waiver.payment_id) !== data.paymentId) {
      throw new Error("That lien waiver already covers another payment — collect a new one.");
    }
    const updateRes = await dynamicTable(context.supabase, "lien_waivers")
      .update({ payment_id: data.paymentId })
      .eq("id", data.waiverId);
    if (updateRes.error) throw new Error(updateRes.error.message);
    return { ok: true };
  });

// Undo an attach made in error. Only while the pay app hasn't been paid — once
// money left, its waiver is part of the payment's paper trail.
export const detachLienWaiverFromPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ waiverId: z.string().uuid(), paymentId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const payRes = await dynamicTable(context.supabase, "subcontract_payments")
      .select("id,status")
      .eq("id", data.paymentId)
      .single();
    if (payRes.error) {
      if (isMissingSubcontractTable(payRes.error)) throw new Error(NOT_ENABLED);
      throw new Error(payRes.error.message);
    }
    if (str((payRes.data as Record<string, unknown>).status, "paid") === "paid") {
      throw new Error("This pay app is already paid — its lien waiver stays on the record.");
    }
    const updateRes = await dynamicTable(context.supabase, "lien_waivers")
      .update({ payment_id: null })
      .eq("id", data.waiverId)
      .eq("payment_id", data.paymentId);
    if (updateRes.error) throw new Error(updateRes.error.message);
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
        amount: z.number().min(0),
        retainage_held: z.number().min(0).default(0),
        payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "payment_date must be YYYY-MM-DD"),
        reference: z.string().max(200).default(""),
        notes: z.string().max(4000).default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const { id, ...fields } = data;
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_payments")
      .update(fields)
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizePayment(row as Record<string, unknown>);
  });

export const deleteSubcontractPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "subcontract_payments")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

// Replace a payment's explicit cost-code split (field request 2026-07-09:
// "for progress payments … add which cost code it goes to"). Empty rows =
// clear the explicit split, falling back to the pro-rata derivation. Non-empty
// rows must sum cents-exact to the payment so the budget's paid-per-code never
// drifts from cash.
//
// Replacement is all-or-nothing without a cross-call transaction: the NEW rows
// are inserted BEFORE the old ones are removed, so a failed insert leaves the
// existing split untouched; if the cleanup delete then fails, the just-inserted
// rows are compensated away so the old split still stands alone. The sub the
// cash belongs to comes from the payment row itself — never from the client —
// so a split can't attribute cash to another sub's buyout.
export const setSubcontractPaymentSplit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        paymentId: z.string().uuid(),
        rows: z
          .array(
            z.object({
              cost_bucket_id: z.string().uuid().nullable(),
              cost_code: z.string().max(80).default(""),
              description: z.string().max(300).default(""),
              amount: z.number().min(0),
            }),
          )
          .max(40)
          .default([]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<{ paymentId: string; rowCount: number }> => {
    const { data: paymentRow, error: paymentError } = await dynamicTable(
      context.supabase,
      "subcontract_payments",
    )
      .select("id,project_id,subcontract_id,amount")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (paymentError) {
      if (isMissingSubcontractTable(paymentError)) throw new Error(NOT_ENABLED);
      throw new Error(paymentError.message);
    }
    const payment = (paymentRow ?? null) as Record<string, unknown> | null;
    if (!payment || str(payment.project_id) !== data.projectId) {
      throw new Error("That payment was not found on this project.");
    }
    // Server truth: the payment row says which sub the cash belongs to.
    const subcontractId = str(payment.subcontract_id);

    const cents = (value: number) => Math.round(num(value) * 100);
    if (data.rows.length > 0) {
      const rowCents = data.rows.reduce((sum, row) => sum + cents(row.amount), 0);
      if (rowCents !== cents(num(payment.amount))) {
        throw new Error(
          "The split must add up to the payment amount exactly — adjust a line and save again.",
        );
      }
    }

    // Capture the current rows by id so the swap can be compensated exactly.
    const { data: existingRows, error: existingError } = await dynamicTable(
      context.supabase,
      "subcontract_payment_allocations",
    )
      .select("id")
      .eq("payment_id", data.paymentId);
    if (existingError) {
      if (isMissingSubcontractTable(existingError)) throw new Error(NOT_ENABLED);
      throw new Error(existingError.message);
    }
    const oldIds = ((existingRows ?? []) as Record<string, unknown>[])
      .map((row) => str(row.id))
      .filter(Boolean);

    // 1. Insert the replacement rows first — if this fails, the old split is
    //    still fully intact and the save just reports the error.
    let newIds: string[] = [];
    if (data.rows.length > 0) {
      const { data: insertedRows, error: insertError } = await dynamicTable(
        context.supabase,
        "subcontract_payment_allocations",
      )
        .insert(
          data.rows.map((row) => ({
            project_id: data.projectId,
            subcontract_id: subcontractId,
            payment_id: data.paymentId,
            cost_bucket_id: row.cost_bucket_id,
            cost_code: row.cost_code,
            description: row.description,
            amount: row.amount,
          })),
        )
        .select("id");
      if (insertError) {
        if (isMissingSubcontractTable(insertError)) throw new Error(NOT_ENABLED);
        throw new Error(insertError.message);
      }
      newIds = ((insertedRows ?? []) as Record<string, unknown>[])
        .map((row) => str(row.id))
        .filter(Boolean);
    }

    // 2. Remove the superseded rows. If this fails, compensate by removing the
    //    rows just inserted so the old split stands alone again.
    if (oldIds.length > 0) {
      const { error: clearError } = await dynamicTable(
        context.supabase,
        "subcontract_payment_allocations",
      )
        .delete()
        .in("id", oldIds);
      if (clearError) {
        if (newIds.length > 0) {
          const { error: undoError } = await dynamicTable(
            context.supabase,
            "subcontract_payment_allocations",
          )
            .delete()
            .in("id", newIds);
          if (undoError) {
            // Both sets are present — a re-save captures them all as "old" and
            // replaces them, so the fix is to simply save again.
            throw new Error(
              "The split did not save cleanly — reopen the payment and save the split again.",
            );
          }
        }
        if (isMissingSubcontractTable(clearError)) throw new Error(NOT_ENABLED);
        throw new Error(clearError.message);
      }
    }
    return { paymentId: data.paymentId, rowCount: data.rows.length };
  });
