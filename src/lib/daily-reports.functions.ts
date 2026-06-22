import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export interface DailyReportRow {
  id: string;
  project_id: string;
  report_date: string;
  author: string;
  weather: string;
  crew_count: number;
  work_performed: string;
  delays: string;
  safety_notes: string;
  notes: string;
  attachment_name: string;
  attachment_path: string;
  attachment_type: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

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

const normalizeDailyReport = (r: Record<string, unknown>): DailyReportRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  report_date: str(r.report_date),
  author: str(r.author),
  weather: str(r.weather),
  crew_count: num(r.crew_count),
  work_performed: str(r.work_performed),
  delays: str(r.delays),
  safety_notes: str(r.safety_notes),
  notes: str(r.notes),
  attachment_name: str(r.attachment_name),
  attachment_path: str(r.attachment_path),
  attachment_type: str(r.attachment_type),
  created_by: r.created_by as string,
  created_at: str(r.created_at),
  updated_at: str(r.updated_at),
});

const dailyReportInput = z.object({
  projectId: z.string().uuid(),
  report_date: z.string().min(1).max(20),
  author: z.string().max(200).default(""),
  weather: z.string().max(200).default(""),
  crew_count: z.number().int().min(0).default(0),
  work_performed: z.string().max(8000).default(""),
  delays: z.string().max(8000).default(""),
  safety_notes: z.string().max(8000).default(""),
  notes: z.string().max(8000).default(""),
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
    const { projectId, ...report } = data;
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

    const { data: row, error } = await context.supabase
      .from("daily_reports")
      .upsert(
        {
          project_id: projectId,
          ...report,
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
