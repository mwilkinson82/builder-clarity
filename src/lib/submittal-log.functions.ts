// RFI & SUBMITTALS LOG server fns (docs/compliance arc, module 3). Two logs in
// one table via `kind` (rfi | submittal), plus the project's organization
// letterhead for the transmittal cover. Project-scoped via team RLS. Reads
// degrade to empty and writes surface a clear "not enabled yet" message before
// the migration lands.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";

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
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
  storage: {
    from(bucket: string): { getPublicUrl(path: string): { data: { publicUrl: string } } };
  };
};
const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const int = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const dateOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

function isMissingLogTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /submittal_log|schema cache|does not exist|relation|column/i.test(message)
  );
}
const NOT_ENABLED =
  "The RFI / submittal log isn't enabled on this workspace yet — the migration hasn't been applied.";

// The pending stage + due dates ship in the submittal-pipeline migration.
const isMissingPipeline = (error: DynamicSupabaseError | null) =>
  /submittal_log_entries_status_check|due_date/i.test(error?.message ?? "");
const PIPELINE_NOT_ENABLED =
  "The pending stage and due dates aren't enabled yet (database update pending) — dates and reviewer actions still save.";

export type SubmittalLogKind = "rfi" | "submittal";
// 'pending' = planned at job start, not sent yet (field request 2026-07-10).
export type SubmittalLogStatus = "" | "pending" | "a" | "aan" | "rar" | "ur";

export interface SubmittalLogEntryRow {
  id: string;
  project_id: string;
  kind: SubmittalLogKind;
  number: string;
  spec_section: string;
  sub_rev: string;
  item: string;
  description: string;
  mfgr_supplier: string;
  date_submitted: string | null;
  date_returned: string | null;
  // When the answer/return is needed by — drives overdue + days-outstanding.
  due_date: string | null;
  status: SubmittalLogStatus;
  comments: string;
  storage_path: string;
  file_name: string;
  sort_order: number;
}

// A durable record of one generated Letter of Transmittal. Mirrors the
// public.transmittals table columns (kind splits RFI cover letters from
// submittal ones; entry_ids records which log rows rode along; storage_path
// points at the generated PDF in 'project-docs' for re-download).
export interface TransmittalRow {
  id: string;
  project_id: string;
  kind: SubmittalLogKind;
  number: string;
  to_party: string;
  attn: string;
  re: string;
  sent_by: string;
  sent_at: string | null;
  entry_ids: string[];
  storage_path: string;
  file_name: string;
  notes: string;
  created_at: string;
}

export interface ProjectLetterhead {
  company_name: string;
  legal_name: string;
  logo_url: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  office_phone: string;
  license_number: string;
}

const normalize = (row: Record<string, unknown>): SubmittalLogEntryRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  kind: (str(row.kind, "submittal") as SubmittalLogKind) || "submittal",
  number: str(row.number),
  spec_section: str(row.spec_section),
  sub_rev: str(row.sub_rev),
  item: str(row.item),
  description: str(row.description),
  mfgr_supplier: str(row.mfgr_supplier),
  date_submitted: (row.date_submitted as string | null) ?? null,
  date_returned: (row.date_returned as string | null) ?? null,
  due_date: (row.due_date as string | null) ?? null,
  status: (str(row.status) as SubmittalLogStatus) ?? "",
  comments: str(row.comments),
  storage_path: str(row.storage_path),
  file_name: str(row.file_name),
  sort_order: int(row.sort_order),
});

export const listSubmittalLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<SubmittalLogEntryRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "submittal_log_entries")
      .select("*")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: true });
    if (error) {
      if (isMissingLogTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map(normalize);
  });

const entryInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  kind: z.enum(["rfi", "submittal"]),
  number: z.string().max(60).default(""),
  spec_section: z.string().max(60).default(""),
  sub_rev: z.string().max(30).default(""),
  item: z.string().max(120).default(""),
  description: z.string().max(1000).default(""),
  mfgr_supplier: z.string().max(200).default(""),
  date_submitted: z.string().nullable().optional(),
  date_returned: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["", "pending", "a", "aan", "rar", "ur"]).default(""),
  comments: z.string().max(2000).default(""),
  storage_path: z.string().max(500).default(""),
  file_name: z.string().max(300).default(""),
  sort_order: z.number().default(0),
});

export const saveSubmittalLogEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof entryInput>) => entryInput.parse(input))
  .handler(async ({ data, context }): Promise<SubmittalLogEntryRow> => {
    const fields = {
      kind: data.kind,
      number: data.number,
      spec_section: data.spec_section,
      sub_rev: data.sub_rev,
      item: data.item,
      description: data.description,
      mfgr_supplier: data.mfgr_supplier,
      date_submitted: dateOrNull(data.date_submitted),
      date_returned: dateOrNull(data.date_returned),
      due_date: dateOrNull(data.due_date),
      status: data.status,
      comments: data.comments,
      storage_path: data.storage_path,
      file_name: data.file_name,
      sort_order: data.sort_order,
    };
    const table = dynamicTable(context.supabase, "submittal_log_entries");
    const res = data.id
      ? await table
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", data.id)
          .select("*")
          .single()
      : await table
          .insert({ project_id: data.projectId, ...fields })
          .select("*")
          .single();
    if (res.error || !res.data) {
      if (isMissingPipeline(res.error)) throw new Error(PIPELINE_NOT_ENABLED);
      if (isMissingLogTable(res.error)) throw new Error(NOT_ENABLED);
      throw new Error(res.error?.message ?? "Could not save the entry");
    }
    return normalize(res.data as Record<string, unknown>);
  });

// Partial per-field update. Only the fields actually provided are written, so
// concurrent inline-cell edits (one save per blur) never clobber each other's
// columns — the full-row save was overwriting sibling fields with stale values.
const patchInput = z.object({
  id: z.string().uuid(),
  number: z.string().max(60).optional(),
  spec_section: z.string().max(60).optional(),
  sub_rev: z.string().max(30).optional(),
  item: z.string().max(120).optional(),
  description: z.string().max(1000).optional(),
  mfgr_supplier: z.string().max(200).optional(),
  date_submitted: z.string().nullable().optional(),
  date_returned: z.string().nullable().optional(),
  due_date: z.string().nullable().optional(),
  status: z.enum(["", "pending", "a", "aan", "rar", "ur"]).optional(),
  comments: z.string().max(2000).optional(),
  storage_path: z.string().max(500).optional(),
  file_name: z.string().max(300).optional(),
});

export const patchSubmittalLogEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof patchInput>) => patchInput.parse(input))
  .handler(async ({ data, context }): Promise<SubmittalLogEntryRow> => {
    const { id, ...rest } = data;
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(rest)) {
      if (v === undefined) continue;
      update[k] =
        k === "date_submitted" || k === "date_returned" || k === "due_date" ? dateOrNull(v) : v;
    }
    const { data: row, error } = await dynamicTable(context.supabase, "submittal_log_entries")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error || !row) {
      if (isMissingPipeline(error)) throw new Error(PIPELINE_NOT_ENABLED);
      if (isMissingLogTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error?.message ?? "Could not save the change");
    }
    return normalize(row as Record<string, unknown>);
  });

export const deleteSubmittalLogEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "submittal_log_entries")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingLogTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

// The project's organization letterhead for the transmittal cover — name, logo,
// address, phone, license. Empty fallbacks so a missing field just doesn't print.
export const getProjectLetterhead = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProjectLetterhead> => {
    const empty: ProjectLetterhead = {
      company_name: "",
      legal_name: "",
      logo_url: "",
      address_line1: "",
      address_line2: "",
      city: "",
      state: "",
      postal_code: "",
      office_phone: "",
      license_number: "",
    };
    const projRes = await dynamicTable(context.supabase, "projects")
      .select("organization_id")
      .eq("id", data.projectId)
      .maybeSingle();
    const orgId = projRes.data
      ? str((projRes.data as Record<string, unknown>).organization_id)
      : "";
    if (!orgId) return empty;

    // Phase 3: the organizations base row is settings/billing/team data, but
    // any project member may print a transmittal cover. The org id came from
    // an RLS-passed project read and only company-identity letterhead fields
    // are selected, so the read runs on the admin client (falls back to the
    // caller's client — and then possibly the empty letterhead — without a
    // service key).
    let letterheadClient: unknown = context.supabase;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      letterheadClient = supabaseAdmin;
    } catch {
      // Local/dev without a service role key: keep the user's client.
    }
    const orgRes = await dynamicTable(letterheadClient, "organizations")
      .select(
        "id,name,legal_name,logo_url,logo_path,address_line1,address_line2,city,state,postal_code,office_phone,license_number,updated_at",
      )
      .eq("id", orgId)
      .maybeSingle();
    if (orgRes.error || !orgRes.data) return empty;
    const o = orgRes.data as Record<string, unknown>;

    // Resolve a fetchable logo URL (stored URL, else the public asset URL).
    let logoUrl = str(o.logo_url);
    if (!logoUrl && str(o.id)) {
      const { data: pub } = (context.supabase as unknown as DynamicSupabaseClient).storage
        .from(COMPANY_ASSET_BUCKET)
        .getPublicUrl(companyLogoPath(str(o.id)));
      logoUrl = versionAssetUrl(pub.publicUrl, str(o.updated_at));
    }
    return {
      company_name: str(o.name),
      legal_name: str(o.legal_name),
      logo_url: logoUrl,
      address_line1: str(o.address_line1),
      address_line2: str(o.address_line2),
      city: str(o.city),
      state: str(o.state),
      postal_code: str(o.postal_code),
      office_phone: str(o.office_phone),
      license_number: str(o.license_number),
    };
  });

// ── Transmittal register ─────────────────────────────────────────────────────
// A durable record of every generated Letter of Transmittal. Reads degrade to
// an empty list and saves no-op (sentinel { persisted: false }) before the
// migration lands — persistence is best-effort ADDITIVE and never blocks the
// existing generate-and-download path.
const normalizeTransmittal = (row: Record<string, unknown>): TransmittalRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  kind: (str(row.kind, "submittal") as SubmittalLogKind) || "submittal",
  number: str(row.number),
  to_party: str(row.to_party),
  attn: str(row.attn),
  re: str(row.re),
  sent_by: str(row.sent_by),
  sent_at: (row.sent_at as string | null) ?? null,
  entry_ids: Array.isArray(row.entry_ids) ? (row.entry_ids as unknown[]).map((v) => str(v)) : [],
  storage_path: str(row.storage_path),
  file_name: str(row.file_name),
  notes: str(row.notes),
  created_at: str(row.created_at),
});

export const listTransmittals = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<TransmittalRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "transmittals")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) {
      // Table not there yet → the register just hasn't been enabled; show none.
      if (isMissingLogTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[]).map(normalizeTransmittal);
  });

const transmittalInput = z.object({
  projectId: z.string().uuid(),
  kind: z.enum(["rfi", "submittal"]),
  // Empty → the server assigns the authoritative next number for the project.
  number: z.string().max(60).default(""),
  to_party: z.string().max(200).default(""),
  attn: z.string().max(200).default(""),
  re: z.string().max(300).default(""),
  sent_by: z.string().max(200).default(""),
  sent_at: z.string().nullable().optional(),
  entry_ids: z.array(z.string().uuid()).default([]),
  storage_path: z.string().max(500).default(""),
  file_name: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});

// { persisted: false } signals the table isn't there yet — the caller already
// has the downloaded PDF, so this is a soft skip, never an error.
export type SaveTransmittalResult = TransmittalRow | { persisted: false };

export const saveTransmittal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof transmittalInput>) => transmittalInput.parse(input))
  .handler(async ({ data, context }): Promise<SaveTransmittalResult> => {
    const table = () => dynamicTable(context.supabase, "transmittals");
    // Authoritative per-project number when the caller didn't supply one: the
    // max existing numeric transmittal number + 1 (fallback '1'). Simple and
    // race-tolerant — a rare concurrent collision is acceptable (best-effort).
    let number = data.number.trim();
    if (!number) {
      const { data: existing, error: readErr } = await table()
        .select("number")
        .eq("project_id", data.projectId);
      if (readErr) {
        if (isMissingLogTable(readErr)) return { persisted: false };
        throw new Error(readErr.message);
      }
      let max = 0;
      for (const r of (existing ?? []) as Record<string, unknown>[]) {
        const n = parseInt(str(r.number).replace(/\D+/g, ""), 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
      number = String(max + 1);
    }
    const { data: row, error } = await table()
      .insert({
        project_id: data.projectId,
        kind: data.kind,
        number,
        to_party: data.to_party,
        attn: data.attn,
        re: data.re,
        sent_by: data.sent_by,
        sent_at: dateOrNull(data.sent_at),
        entry_ids: data.entry_ids,
        storage_path: data.storage_path,
        file_name: data.file_name,
        notes: data.notes,
      })
      .select("*")
      .single();
    if (error || !row) {
      if (isMissingLogTable(error)) return { persisted: false };
      throw new Error(error?.message ?? "Could not save the transmittal");
    }
    return normalizeTransmittal(row as Record<string, unknown>);
  });

// Remove a transmittal from the register. The archived PDF in storage is cleared
// by the caller (client-side, same as the CO-doc pattern) before this runs.
// Team RLS (transmittals_delete → can_manage_project) gates who may delete.
export const deleteTransmittal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "transmittals")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingLogTable(error)) throw new Error(error.message);
    return { id: data.id };
  });
