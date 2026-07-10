// Vendor directory — org-level (field request, DB3T 2026-07-09: "database for
// vendors should exist also just like subs and have this be a dropdown").
// Mirrors subcontractors.functions.ts: is_org_member reads/creates, RLS-scoped
// to the caller's org, and every read degrades to empty before the migration
// lands so the cost form never breaks ahead of the desk (the Vendor picker
// simply offers subcontractors + free typing until then).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  ilike(column: string, value: string): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  maybeSingle(): Promise<DynamicSupabaseResult>;
  single(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

// The migration hasn't been applied yet — treat as an empty directory.
function isMissingVendorTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" || /vendors|schema cache|does not exist|relation/i.test(message)
  );
}

// Resolve the caller's active organization (mirrors subcontractors.functions.ts).
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

export interface VendorRow {
  id: string;
  name: string;
  trade: string;
}

const normalizeVendor = (row: Record<string, unknown>): VendorRow => ({
  id: str(row.id),
  name: str(row.name),
  trade: str(row.trade),
});

export const listVendors = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VendorRow[]> => {
    const organizationId = await getOrganizationId(context);
    const { data: rows, error } = await dynamicTable(context.supabase, "vendors")
      .select("id,name,trade")
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (error) {
      if (isMissingVendorTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map(normalizeVendor);
  });

// Find-or-create by name — the pick-or-add path when a cost is saved with a
// vendor the directory doesn't know yet. Best-effort by design: callers save
// the cost row FIRST and enroll the vendor after, so a directory hiccup (or
// the migration not being applied yet) never blocks recording real money.
export const findOrCreateVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ name: z.string().min(1).max(200) }).parse(input))
  .handler(async ({ data, context }): Promise<VendorRow | null> => {
    const organizationId = await getOrganizationId(context);
    const name = data.name.trim();
    if (!name) return null;
    const table = () => dynamicTable(context.supabase, "vendors");
    const { data: existing, error: findError } = await table()
      .select("id,name,trade")
      .eq("organization_id", organizationId)
      .ilike("name", name)
      .maybeSingle();
    if (findError) {
      if (isMissingVendorTable(findError)) return null;
      throw new Error(findError.message);
    }
    if (existing) return normalizeVendor(existing as Record<string, unknown>);
    const { data: created, error: createError } = await table()
      .insert({ organization_id: organizationId, name, source: "user" })
      .select("id,name,trade")
      .single();
    if (createError) {
      if (isMissingVendorTable(createError)) return null;
      // Raced another save of the same name — the unique index held; re-read.
      if (/duplicate|unique/i.test(createError.message)) {
        const { data: raced } = await table()
          .select("id,name,trade")
          .eq("organization_id", organizationId)
          .ilike("name", name)
          .maybeSingle();
        return raced ? normalizeVendor(raced as Record<string, unknown>) : null;
      }
      throw new Error(createError.message);
    }
    return normalizeVendor(created as Record<string, unknown>);
  });
