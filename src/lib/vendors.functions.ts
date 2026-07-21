// Vendor directory — org-level (field request, DB3T 2026-07-09: "database for
// vendors should exist also just like subs and have this be a dropdown").
// Mirrors subcontractors.functions.ts: is_org_member reads/creates, RLS-scoped
// to the caller's org, and every read degrades to empty before the migration
// lands so the cost form never breaks ahead of the desk (the Vendor picker
// simply offers subcontractors + free typing until then).
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireOrgCapability } from "@/lib/capabilities-server";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
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

// A typed vendor name goes into ilike() — escape % and _ so "A&B 100% Rentals"
// matches literally instead of becoming a wildcard pattern.
const escapeIlike = (value: string) => value.replace(/[\\%_]/g, (m) => `\\${m}`);

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
      .ilike("name", escapeIlike(name))
      .maybeSingle();
    if (findError) {
      if (isMissingVendorTable(findError)) return null;
      throw new Error(findError.message);
    }
    if (existing) return normalizeVendor(existing as Record<string, unknown>);
    // Phase 3 (provisional mapping): adding a vendor to the org directory
    // requires projects.manage until the founder assigns the directory its
    // own capability. Directory edits/deletes stay manager-gated by RLS.
    await requireOrgCapability(context.supabase, organizationId, "projects.manage");
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
          .ilike("name", escapeIlike(name))
          .maybeSingle();
        return raced ? normalizeVendor(raced as Record<string, unknown>) : null;
      }
      throw new Error(createError.message);
    }
    return normalizeVendor(created as Record<string, unknown>);
  });

// Full-detail save from the "Add a new vendor" window (field request
// 2026-07-10: "a secondary window popped up and we could put contact name
// address email phone etc to build them out in the database"). Finds by name
// and fills in the details, or creates the vendor with them. The address
// column ships in its own migration — until the desk applies it, the save
// simply proceeds without the address rather than failing the whole vendor.
const vendorDetailsInput = z.object({
  name: z.string().min(1).max(200),
  trade: z.string().max(120).default(""),
  contact_name: z.string().max(200).default(""),
  contact_email: z.string().max(200).default(""),
  contact_phone: z.string().max(60).default(""),
  address: z.string().max(400).default(""),
});

function isMissingAddressColumn(error: DynamicSupabaseError | null) {
  return /address/i.test(error?.message ?? "") && /column|schema cache/i.test(error?.message ?? "");
}

export const saveVendor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof vendorDetailsInput>) => vendorDetailsInput.parse(input))
  .handler(async ({ data, context }): Promise<VendorRow> => {
    const organizationId = await getOrganizationId(context);
    const name = data.name.trim();
    // Only fields the user actually filled in — updating an existing vendor
    // with blanks must never wipe details someone else already entered.
    const details: Record<string, string> = {};
    for (const [key, value] of Object.entries({
      trade: data.trade.trim(),
      contact_name: data.contact_name.trim(),
      contact_email: data.contact_email.trim(),
      contact_phone: data.contact_phone.trim(),
      address: data.address.trim(),
    })) {
      if (value) details[key] = value;
    }
    const table = () => dynamicTable(context.supabase, "vendors");

    const { data: existing, error: findError } = await table()
      .select("id,name,trade")
      .eq("organization_id", organizationId)
      .ilike("name", escapeIlike(name))
      .maybeSingle();
    if (findError) {
      if (isMissingVendorTable(findError)) {
        throw new Error(
          "The vendor directory isn't enabled on this workspace yet — the vendors migration hasn't been applied.",
        );
      }
      throw new Error(findError.message);
    }

    const writeRow = async (payload: Record<string, string>) => {
      if (existing) {
        if (Object.keys(payload).length === 0) {
          // Nothing new to write — the existing vendor already wins.
          return { data: existing, error: null } as {
            data: Record<string, unknown>;
            error: null;
          };
        }
        return table()
          .update(payload)
          .eq("id", str((existing as Record<string, unknown>).id))
          .select("id,name,trade")
          .single();
      }
      return table()
        .insert({ organization_id: organizationId, name, source: "user", ...payload })
        .select("id,name,trade")
        .single();
    };

    if (!existing) {
      // Phase 3 (provisional): new directory vendors require projects.manage.
      await requireOrgCapability(context.supabase, organizationId, "projects.manage");
    }
    let res = await writeRow(details);
    if (res.error && isMissingAddressColumn(res.error)) {
      // Pre-migration workspace: save everything except the address.
      const { address: _address, ...withoutAddress } = details;
      res = await writeRow(withoutAddress);
    }
    if ((res.error || !res.data) && existing) {
      // Updating an existing vendor's details is manager-gated by RLS — a team
      // member who can't edit the directory still needs the payee on their
      // cost. The vendor exists; return it and let the details ride.
      return normalizeVendor(existing as Record<string, unknown>);
    }
    if (res.error || !res.data) {
      throw new Error(res.error?.message ?? "Could not save the vendor.");
    }
    return normalizeVendor(res.data as Record<string, unknown>);
  });
