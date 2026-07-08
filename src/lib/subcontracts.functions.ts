// Per-project subcontracts, cost-code allocations, and progress payments
// (SUBCONTRACTORS Slice 1). Project-scoped (can_read/can_manage_project). The
// budget effect is additive and computed in the app (subcontract-budget.ts) —
// nothing here touches cost_actuals. Reads degrade to empty and writes surface a
// clear "not enabled yet" message before the migration lands (mirrors
// daily_wip_entries).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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
    const [subs, allocs, pays, docs] = await Promise.all([
      readList("subcontracts", "created_at"),
      readList("subcontract_allocations", "created_at"),
      readList("subcontract_payments", "payment_date"),
      readList("subcontract_documents", "uploaded_at"),
    ]);
    return {
      subcontracts: subs.map(normalizeSubcontract),
      allocations: allocs.map(normalizeAllocation),
      payments: pays.map(normalizePayment),
      documents: docs.map(normalizeDocument),
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
    const { data: row, error } = await dynamicTable(context.supabase, "subcontract_payments")
      .insert({ project_id: projectId, subcontract_id: subcontractId, ...fields })
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
