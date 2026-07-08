// Subcontractor directory — org-level CRUD (SUBCONTRACTORS Slice 1). Mirrors the
// cost_library_items directory pattern (is_org_member reads/creates,
// can_manage_org edits/deletes). The table ships in a migration the desk
// applies; until then reads degrade to empty and writes surface a clear "not
// enabled yet" message, so the app never breaks ahead of the migration (mirrors
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
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

// The migration hasn't been applied yet — treat as an empty directory for reads.
function isMissingSubcontractorTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /subcontractor|schema cache|does not exist|relation/i.test(message)
  );
}

// Resolve the caller's active organization (mirrors estimates.functions.ts).
async function getOrganizationId(context: { supabase: unknown; userId: string }) {
  const { data: ensuredOrganizationId, error: accountError } = await (
    context.supabase as { rpc: (fn: string) => Promise<DynamicSupabaseResult<string>> }
  ).rpc("ensure_current_user_account");
  if (accountError) throw new Error(accountError.message);
  if (!ensuredOrganizationId) throw new Error("No Overwatch company workspace is available.");
  const { data: memberships, error: membershipsError } = await dynamicTable(
    context.supabase,
    "organization_memberships",
  )
    .select("organization_id,status,created_at")
    .eq("user_id", context.userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (membershipsError) throw new Error(membershipsError.message);
  const firstMembership = (memberships as Record<string, unknown>[] | null)?.find(
    (membership) => membership.organization_id,
  );
  return str(firstMembership?.organization_id, ensuredOrganizationId as string);
}

export interface SubcontractorRow {
  id: string;
  organization_id: string;
  name: string;
  trade: string;
  contact_name: string;
  contact_email: string;
  contact_phone: string;
  notes: string;
  created_at: string;
  updated_at: string;
}

const normalizeSubcontractor = (row: Record<string, unknown>): SubcontractorRow => ({
  id: str(row.id),
  organization_id: str(row.organization_id),
  name: str(row.name),
  trade: str(row.trade),
  contact_name: str(row.contact_name),
  contact_email: str(row.contact_email),
  contact_phone: str(row.contact_phone),
  notes: str(row.notes),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

const subcontractorFieldsInput = z.object({
  name: z.string().min(1, "A subcontractor name is required").max(200),
  trade: z.string().max(120).default(""),
  contact_name: z.string().max(200).default(""),
  contact_email: z.string().max(200).default(""),
  contact_phone: z.string().max(60).default(""),
  notes: z.string().max(4000).default(""),
});

export const listSubcontractors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SubcontractorRow[]> => {
    const organizationId = await getOrganizationId(context);
    const { data: rows, error } = await dynamicTable(context.supabase, "subcontractors")
      .select("*")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (error) {
      if (isMissingSubcontractorTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map(normalizeSubcontractor);
  });

export const saveSubcontractor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ id: z.string().uuid().optional() }).merge(subcontractorFieldsInput).parse(input),
  )
  .handler(async ({ data, context }): Promise<SubcontractorRow> => {
    const organizationId = await getOrganizationId(context);
    const { id, ...fields } = data;
    const table = dynamicTable(context.supabase, "subcontractors");
    const query = id
      ? table.update(fields).eq("id", id).select("*").single()
      : table
          .insert({ organization_id: organizationId, source: "user", ...fields })
          .select("*")
          .single();
    const { data: row, error } = await query;
    if (error) {
      if (isMissingSubcontractorTable(error)) {
        throw new Error(
          "Subcontractors aren't enabled on this workspace yet — the subcontractors table hasn't been applied.",
        );
      }
      throw new Error(error.message);
    }
    return normalizeSubcontractor(row as Record<string, unknown>);
  });

export const deleteSubcontractor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "subcontractors")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingSubcontractorTable(error)) {
      // A subcontractor under an active subcontract can't be deleted (FK RESTRICT).
      if (/foreign key|violates|referenced/i.test(error.message)) {
        throw new Error(
          "This subcontractor is on a project subcontract. Remove the subcontract first.",
        );
      }
      throw new Error(error.message);
    }
    return { id: data.id };
  });
