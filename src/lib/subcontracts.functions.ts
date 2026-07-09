// Per-project subcontracts, cost-code allocations, and progress payments
// (SUBCONTRACTORS Slice 1). Project-scoped (can_read/can_manage_project). The
// budget effect is additive and computed in the app (subcontract-budget.ts) —
// nothing here touches cost_actuals. Reads degrade to empty and writes surface a
// clear "not enabled yet" message before the migration lands (mirrors
// daily_wip_entries).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canPaySubcontract, subcontractInsuranceStatus } from "@/lib/compliance-domain";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
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
export interface SubcontractPaymentRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  amount: number;
  retainage_held: number;
  payment_date: string;
  reference: string;
  notes: string;
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
export interface ProjectSubcontracts {
  subcontracts: SubcontractRow[];
  allocations: SubcontractAllocationRow[];
  payments: SubcontractPaymentRow[];
  documents: SubcontractDocumentRow[];
  change_orders: SubcontractChangeOrderRow[];
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
});
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
    const [subs, allocs, pays, docs, changeOrders] = await Promise.all([
      readList("subcontracts", "created_at"),
      readList("subcontract_allocations", "created_at"),
      readList("subcontract_payments", "payment_date"),
      readList("subcontract_documents", "uploaded_at"),
      readList("subcontract_change_orders", "co_date"),
    ]);
    return {
      subcontracts: subs.map(normalizeSubcontract),
      allocations: allocs.map(normalizeAllocation),
      payments: pays.map(normalizePayment),
      documents: docs.map(normalizeDocument),
      change_orders: changeOrders.map(normalizeChangeOrder),
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractChangeOrderRow> => {
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
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeChangeOrder(row as Record<string, unknown>);
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
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractPaymentRow> => {
    const { projectId, subcontractId, ...fields } = data;

    const gate = await evaluateSubPaymentGate(
      context.supabase,
      projectId,
      subcontractId,
      fields.payment_date,
    );
    if (!gate.allowed) {
      throw new Error(
        `Payment blocked — compliance not met. ${gate.blockers.join(" ")} Add the missing item, or turn off "Require lien waivers + insurance" for this project.`,
      );
    }

    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_payments")
      .insert({ project_id: projectId, subcontract_id: subcontractId, ...fields })
      .select("*")
      .single();
    if (error) {
      if (isMissingSubcontractTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    const payment = normalizePayment(row as Record<string, unknown>);
    // Consume the waiver that cleared the gate — link it so it can't clear a
    // second payment (best-effort; the payment already succeeded).
    if (gate.consumeWaiverId) {
      await dynamicTable(context.supabase, "lien_waivers")
        .update({ payment_id: payment.id })
        .eq("id", gate.consumeWaiverId);
    }
    return payment;
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
