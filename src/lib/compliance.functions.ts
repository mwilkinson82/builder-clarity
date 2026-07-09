// COMPLIANCE GATING server fns (docs/compliance arc, module 2). Insurance
// certificates + lien waivers per subcontract, and the per-project enforcement
// toggle. Project-scoped via team RLS. Reads degrade to empty and writes surface
// a clear "not enabled yet" message before the migration lands (mirrors
// subcontracts.functions.ts). The payment GATE itself lives in
// recordSubcontractPayment; this file is storage + the toggle.
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
const dateOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);

function isMissingComplianceTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /insurance_certificates|lien_waivers|require_compliance_gating|schema cache|does not exist|relation|column/i.test(
      message,
    )
  );
}
const NOT_ENABLED =
  "Compliance tracking isn't enabled on this workspace yet — the migration hasn't been applied.";

export interface InsuranceCertificateRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  carrier: string;
  effective_date: string | null;
  expiry_date: string | null;
  verified: boolean;
  gl_limit: number;
  wc_limit: number;
  auto_limit: number;
  umbrella_limit: number;
  other_coverage: string;
  storage_path: string;
  file_name: string;
  notes: string;
  created_at: string;
}

export interface LienWaiverRow {
  id: string;
  project_id: string;
  subcontract_id: string;
  payment_id: string | null;
  waiver_type: string;
  through_date: string | null;
  amount: number;
  signed_date: string | null;
  storage_path: string;
  file_name: string;
  notes: string;
  created_at: string;
}

const normalizeCert = (row: Record<string, unknown>): InsuranceCertificateRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  carrier: str(row.carrier),
  effective_date: (row.effective_date as string | null) ?? null,
  expiry_date: (row.expiry_date as string | null) ?? null,
  verified: row.verified === true,
  gl_limit: num(row.gl_limit),
  wc_limit: num(row.wc_limit),
  auto_limit: num(row.auto_limit),
  umbrella_limit: num(row.umbrella_limit),
  other_coverage: str(row.other_coverage),
  storage_path: str(row.storage_path),
  file_name: str(row.file_name),
  notes: str(row.notes),
  created_at: str(row.created_at),
});

const normalizeWaiver = (row: Record<string, unknown>): LienWaiverRow => ({
  id: str(row.id),
  project_id: str(row.project_id),
  subcontract_id: str(row.subcontract_id),
  payment_id: (row.payment_id as string | null) ?? null,
  waiver_type: str(row.waiver_type, "conditional_progress"),
  through_date: (row.through_date as string | null) ?? null,
  amount: num(row.amount),
  signed_date: (row.signed_date as string | null) ?? null,
  storage_path: str(row.storage_path),
  file_name: str(row.file_name),
  notes: str(row.notes),
  created_at: str(row.created_at),
});

// Everything the compliance UI + gate need for one project: certs, waivers, and
// whether the project enforces the gate. Degrades to empty + gating ON (the
// default) if the tables/column aren't there yet — writes are what surface the
// "not enabled" message, not this read.
export const listProjectCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(
    async ({
      data,
      context,
    }): Promise<{
      certificates: InsuranceCertificateRow[];
      waivers: LienWaiverRow[];
      gatingEnabled: boolean;
    }> => {
      const certsRes = await dynamicTable(context.supabase, "insurance_certificates")
        .select("*")
        .eq("project_id", data.projectId);
      const certificates =
        certsRes.error || !certsRes.data
          ? []
          : (certsRes.data as Record<string, unknown>[]).map(normalizeCert);
      if (certsRes.error && !isMissingComplianceTable(certsRes.error)) {
        throw new Error(certsRes.error.message);
      }

      const waiversRes = await dynamicTable(context.supabase, "lien_waivers")
        .select("*")
        .eq("project_id", data.projectId);
      const waivers =
        waiversRes.error || !waiversRes.data
          ? []
          : (waiversRes.data as Record<string, unknown>[]).map(normalizeWaiver);

      // The toggle lives on the project row. Absent column → default ON.
      const projRes = await dynamicTable(context.supabase, "projects")
        .select("require_compliance_gating")
        .eq("id", data.projectId)
        .maybeSingle();
      const gatingEnabled =
        projRes.error || !projRes.data
          ? true
          : (projRes.data as Record<string, unknown>).require_compliance_gating !== false;

      return { certificates, waivers, gatingEnabled };
    },
  );

const certInput = z.object({
  id: z.string().uuid().optional(),
  projectId: z.string().uuid(),
  subcontractId: z.string().uuid(),
  carrier: z.string().max(200).default(""),
  effective_date: z.string().nullable().optional(),
  expiry_date: z.string().nullable().optional(),
  verified: z.boolean().default(false),
  gl_limit: z.number().min(0).default(0),
  wc_limit: z.number().min(0).default(0),
  auto_limit: z.number().min(0).default(0),
  umbrella_limit: z.number().min(0).default(0),
  other_coverage: z.string().max(500).default(""),
  storage_path: z.string().max(500).default(""),
  file_name: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});

// Save one COI — insert on first capture, update when re-verifying / editing.
export const saveInsuranceCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof certInput>) => certInput.parse(input))
  .handler(async ({ data, context }): Promise<InsuranceCertificateRow> => {
    const fields = {
      carrier: data.carrier,
      effective_date: dateOrNull(data.effective_date),
      expiry_date: dateOrNull(data.expiry_date),
      verified: data.verified,
      gl_limit: data.gl_limit,
      wc_limit: data.wc_limit,
      auto_limit: data.auto_limit,
      umbrella_limit: data.umbrella_limit,
      other_coverage: data.other_coverage,
      storage_path: data.storage_path,
      file_name: data.file_name,
      notes: data.notes,
    };
    const table = dynamicTable(context.supabase, "insurance_certificates");
    const res = data.id
      ? await table
          .update({ ...fields, updated_at: new Date().toISOString() })
          .eq("id", data.id)
          .select("*")
          .single()
      : await table
          .insert({
            project_id: data.projectId,
            subcontract_id: data.subcontractId,
            uploaded_by: context.userId,
            ...fields,
          })
          .select("*")
          .single();
    if (res.error || !res.data) {
      if (isMissingComplianceTable(res.error)) throw new Error(NOT_ENABLED);
      throw new Error(res.error?.message ?? "Could not save the certificate");
    }
    return normalizeCert(res.data as Record<string, unknown>);
  });

export const deleteInsuranceCertificate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "insurance_certificates")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingComplianceTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

const waiverInput = z.object({
  projectId: z.string().uuid(),
  subcontractId: z.string().uuid(),
  payment_id: z.string().uuid().nullable().optional(),
  waiver_type: z
    .enum([
      "conditional_progress",
      "unconditional_progress",
      "conditional_final",
      "unconditional_final",
    ])
    .default("conditional_progress"),
  through_date: z.string().nullable().optional(),
  amount: z.number().min(0).default(0),
  signed_date: z.string().nullable().optional(),
  storage_path: z.string().max(500).default(""),
  file_name: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});

export const recordLienWaiver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof waiverInput>) => waiverInput.parse(input))
  .handler(async ({ data, context }): Promise<LienWaiverRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "lien_waivers")
      .insert({
        project_id: data.projectId,
        subcontract_id: data.subcontractId,
        payment_id: data.payment_id ?? null,
        waiver_type: data.waiver_type,
        through_date: dateOrNull(data.through_date),
        amount: data.amount,
        signed_date: dateOrNull(data.signed_date),
        storage_path: data.storage_path,
        file_name: data.file_name,
        notes: data.notes,
        uploaded_by: context.userId,
      })
      .select("*")
      .single();
    if (error || !row) {
      if (isMissingComplianceTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error?.message ?? "Could not record the lien waiver");
    }
    return normalizeWaiver(row as Record<string, unknown>);
  });

export const deleteLienWaiver = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "lien_waivers")
      .delete()
      .eq("id", data.id);
    if (error && !isMissingComplianceTable(error)) throw new Error(error.message);
    return { id: data.id };
  });

// The per-project toggle: default ON, flip OFF to self-manage compliance.
export const setProjectComplianceGating = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; enabled: boolean }) =>
    z.object({ projectId: z.string().uuid(), enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await dynamicTable(context.supabase, "projects")
      .update({ require_compliance_gating: data.enabled })
      .eq("id", data.projectId);
    if (error) {
      if (isMissingComplianceTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return { ok: true, enabled: data.enabled };
  });
