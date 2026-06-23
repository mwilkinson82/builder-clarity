import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DailyReportAttachment {
  name: string;
  path: string;
  type: string;
  size: number;
  uploaded_at: string;
  client_visible: boolean;
}

export interface DailyReportRow {
  id: string;
  project_id: string;
  report_date: string;
  author: string;
  weather: string;
  crew_count: number;
  manpower: string;
  work_performed: string;
  delays: string;
  safety_notes: string;
  visitors: string;
  quality_notes: string;
  notes: string;
  attachment_name: string;
  attachment_path: string;
  attachment_type: string;
  attachment_manifest: DailyReportAttachment[];
  attachment_count: number;
  attachment_bytes: number;
  client_visible: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const bool = (v: unknown) => (typeof v === "boolean" ? v : false);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const monthBounds = (dateText: string) => {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new Error("Report date is not valid.");

  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  const end = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
};

const normalizeAttachment = (item: unknown): DailyReportAttachment | null => {
  if (!isRecord(item)) return null;
  const path = str(item.path).trim();
  if (!path) return null;
  return {
    name: str(item.name, "Attachment"),
    path,
    type: str(item.type, "application/octet-stream"),
    size: Math.max(0, Math.round(num(item.size))),
    uploaded_at: str(item.uploaded_at),
    client_visible: bool(item.client_visible),
  };
};

const legacyAttachment = (r: Record<string, unknown>): DailyReportAttachment | null => {
  const path = str(r.attachment_path).trim();
  if (!path) return null;
  return {
    name: str(r.attachment_name, "Attachment"),
    path,
    type: str(r.attachment_type, "application/octet-stream"),
    size: 0,
    uploaded_at: str(r.created_at),
    client_visible: bool(r.client_visible),
  };
};

const normalizeAttachmentManifest = (
  manifest: unknown,
  legacy?: Record<string, unknown>,
): DailyReportAttachment[] => {
  const normalized = Array.isArray(manifest)
    ? manifest
        .map((item) => normalizeAttachment(item))
        .filter((item): item is DailyReportAttachment => Boolean(item))
    : [];
  if (normalized.length > 0) return normalized;
  const fallback = legacy ? legacyAttachment(legacy) : null;
  return fallback ? [fallback] : [];
};

const normalizeDailyReport = (r: Record<string, unknown>): DailyReportRow => {
  const attachmentManifest = normalizeAttachmentManifest(r.attachment_manifest, r);
  const attachmentBytes = attachmentManifest.reduce((sum, attachment) => sum + attachment.size, 0);
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    report_date: str(r.report_date),
    author: str(r.author),
    weather: str(r.weather),
    crew_count: num(r.crew_count),
    manpower: str(r.manpower),
    work_performed: str(r.work_performed),
    delays: str(r.delays),
    safety_notes: str(r.safety_notes),
    visitors: str(r.visitors),
    quality_notes: str(r.quality_notes),
    notes: str(r.notes),
    attachment_name: str(r.attachment_name),
    attachment_path: str(r.attachment_path),
    attachment_type: str(r.attachment_type),
    attachment_manifest: attachmentManifest,
    attachment_count: Math.max(num(r.attachment_count), attachmentManifest.length),
    attachment_bytes: Math.max(num(r.attachment_bytes), attachmentBytes),
    client_visible: bool(r.client_visible),
    created_by: r.created_by as string,
    created_at: str(r.created_at),
    updated_at: str(r.updated_at),
  };
};

const attachmentInput = z.object({
  name: z.string().max(500).default("Attachment"),
  path: z.string().max(1000),
  type: z.string().max(200).default("application/octet-stream"),
  size: z.number().int().min(0).default(0),
  uploaded_at: z.string().max(100).default(""),
  client_visible: z.boolean().default(false),
});

const dailyReportInput = z.object({
  projectId: z.string().uuid(),
  report_date: z.string().min(1).max(20),
  author: z.string().max(200).default(""),
  weather: z.string().max(200).default(""),
  crew_count: z.number().int().min(0).default(0),
  manpower: z.string().max(8000).default(""),
  work_performed: z.string().max(8000).default(""),
  delays: z.string().max(8000).default(""),
  safety_notes: z.string().max(8000).default(""),
  visitors: z.string().max(8000).default(""),
  quality_notes: z.string().max(8000).default(""),
  notes: z.string().max(8000).default(""),
  client_visible: z.boolean().default(false),
  attachment_manifest: z.array(attachmentInput).default([]),
  attachment_name: z.string().max(500).default(""),
  attachment_path: z.string().max(1000).default(""),
  attachment_type: z.string().max(200).default(""),
});

export const listDailyReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("daily_reports")
      .select("*")
      .eq("project_id", data.projectId)
      .order("report_date", { ascending: false });

    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => normalizeDailyReport(r as Record<string, unknown>));
  });

export const upsertDailyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => dailyReportInput.parse(input))
  .handler(async ({ data, context }) => {
    const {
      projectId,
      attachment_manifest,
      attachment_name,
      attachment_path,
      attachment_type,
      ...report
    } = data;
    const normalizedAttachments =
      attachment_manifest.length > 0
        ? normalizeAttachmentManifest(attachment_manifest)
        : normalizeAttachmentManifest(undefined, {
            attachment_name,
            attachment_path,
            attachment_type,
            created_at: new Date().toISOString(),
            client_visible: report.client_visible,
          });
    const primaryAttachment = normalizedAttachments[0];
    const attachmentBytes = normalizedAttachments.reduce(
      (sum, attachment) => sum + attachment.size,
      0,
    );
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,organization_id")
      .eq("id", projectId)
      .single();
    if (projectError) throw new Error(projectError.message);

    if (project.organization_id) {
      const { data: existing, error: existingError } = await context.supabase
        .from("daily_reports")
        .select("id")
        .eq("project_id", projectId)
        .eq("report_date", report.report_date)
        .maybeSingle();
      if (existingError) throw new Error(existingError.message);

      if (!existing) {
        const { data: organization, error: orgError } = await context.supabase
          .from("organizations")
          .select("daily_report_limit_per_month")
          .eq("id", project.organization_id)
          .single();
        if (orgError) throw new Error(orgError.message);

        const limit = Number(organization.daily_report_limit_per_month ?? 0);
        if (limit > 0) {
          const { data: organizationProjects, error: orgProjectsError } = await context.supabase
            .from("projects")
            .select("id")
            .eq("organization_id", project.organization_id)
            .is("archived_at", null);
          if (orgProjectsError) throw new Error(orgProjectsError.message);

          const projectIds = (organizationProjects ?? []).map((p) => p.id);
          const bounds = monthBounds(report.report_date);
          const { count, error: countError } =
            projectIds.length === 0
              ? { count: 0, error: null }
              : await context.supabase
                  .from("daily_reports")
                  .select("id", { count: "exact", head: true })
                  .in("project_id", projectIds)
                  .gte("report_date", bounds.start)
                  .lt("report_date", bounds.end);
          if (countError) throw new Error(countError.message);

          if ((count ?? 0) >= limit) {
            throw new Error(
              `This Overwatch team is at its ${limit}-daily-log monthly limit. Upgrade before adding another daily report for this month.`,
            );
          }
        }
      }
    }

    const { data: row, error } = await (context.supabase as any)
      .from("daily_reports")
      .upsert(
        {
          project_id: projectId,
          ...report,
          attachment_manifest: normalizedAttachments,
          attachment_count: normalizedAttachments.length,
          attachment_bytes: attachmentBytes,
          attachment_name: primaryAttachment?.name ?? "",
          attachment_path: primaryAttachment?.path ?? "",
          attachment_type: primaryAttachment?.type ?? "",
        },
        { onConflict: "project_id,report_date" },
      )
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return normalizeDailyReport(row as Record<string, unknown>);
  });

export const deleteDailyReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("daily_reports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
