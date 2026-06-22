import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeScheduleVarianceWeeks,
  type ExposureCategory,
  type HoldClass,
  type ResponsePath,
} from "@/lib/ior";

export type MilestoneStatus = "on_track" | "at_risk" | "delayed" | "complete";
export type ScheduleRiskKind = "procurement" | "trade_performance" | "critical_decision";
export type ScheduleRiskStatus = "active" | "inactive" | "completed";

export interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  baseline_date: string | null;
  forecast_date: string | null;
  status: MilestoneStatus;
  delay_reason: string;
  owner: string;
  sort_order: number;
}

export interface ScheduleRiskRow {
  id: string;
  project_id: string;
  kind: ScheduleRiskKind;
  title: string;
  detail: string;
  dollar_exposure: number;
  probability: number;
  schedule_impact_weeks: number | null;
  owner: string;
  due_date: string | null;
  response_path: ResponsePath;
  hold_class: HoldClass;
  linked_exposure_id: string | null;
  status: ScheduleRiskStatus;
  completed_at: string | null;
  inactive_reason: string;
  sort_order: number;
}

export interface ScheduleUpdateRow {
  id: string;
  project_id: string;
  update_number: number;
  update_date: string;
  baseline_completion_date: string | null;
  forecast_completion_date: string;
  variance_weeks: number;
  movement_weeks: number;
  notes: string;
}

export interface ScheduleMilestoneUpdateRow {
  id: string;
  project_id: string;
  milestone_id: string;
  schedule_update_id: string | null;
  update_number: number;
  baseline_date: string | null;
  forecast_date: string | null;
  variance_weeks: number;
  status: MilestoneStatus;
  notes: string;
}

const MILESTONE_STATUSES = ["on_track", "at_risk", "delayed", "complete"] as const;
const RISK_KINDS = ["procurement", "trade_performance", "critical_decision"] as const;
const RISK_STATUSES = ["active", "inactive", "completed"] as const;
const RESPONSE_PATHS = ["eliminate", "recover", "offset", "accept"] as const;
const HOLD_CLASSES = ["E-Hold", "C-Hold", "Both", "None"] as const;
const RISK_EXPOSURE_CATEGORY: Record<ScheduleRiskKind, ExposureCategory> = {
  critical_decision: "owner_decision",
  procurement: "procurement",
  trade_performance: "trade_performance",
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) =>
  error?.code === "PGRST204" && (error.message ?? "").includes(`'${column}' column`);

const normalizeScheduleRisk = (r: Record<string, unknown>): ScheduleRiskRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  kind: str(r.kind, "critical_decision") as ScheduleRiskKind,
  title: str(r.title),
  detail: str(r.detail),
  dollar_exposure: num(r.dollar_exposure),
  probability: r.probability == null ? 100 : num(r.probability),
  schedule_impact_weeks: r.schedule_impact_weeks == null ? null : num(r.schedule_impact_weeks),
  owner: str(r.owner),
  due_date: (r.due_date as string | null) ?? null,
  response_path: str(r.response_path, "recover") as ResponsePath,
  hold_class: str(r.hold_class, "E-Hold") as HoldClass,
  linked_exposure_id: (r.linked_exposure_id as string | null) ?? null,
  status: str(r.status, "active") as ScheduleRiskStatus,
  completed_at: (r.completed_at as string | null) ?? null,
  inactive_reason: str(r.inactive_reason),
  sort_order: num(r.sort_order),
});

const normalizeScheduleUpdate = (r: Record<string, unknown>): ScheduleUpdateRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  update_number: num(r.update_number),
  update_date: str(r.update_date),
  baseline_completion_date: (r.baseline_completion_date as string | null) ?? null,
  forecast_completion_date: str(r.forecast_completion_date),
  variance_weeks: num(r.variance_weeks),
  movement_weeks: num(r.movement_weeks),
  notes: str(r.notes),
});

const normalizeMilestoneUpdate = (r: Record<string, unknown>): ScheduleMilestoneUpdateRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  milestone_id: r.milestone_id as string,
  schedule_update_id: (r.schedule_update_id as string | null) ?? null,
  update_number: num(r.update_number),
  baseline_date: (r.baseline_date as string | null) ?? null,
  forecast_date: (r.forecast_date as string | null) ?? null,
  variance_weeks: num(r.variance_weeks),
  status: str(r.status, "on_track") as MilestoneStatus,
  notes: str(r.notes),
});

// ---------- LIST ----------
export const listSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [mRes, rRes] = await Promise.all([
      context.supabase
        .from("schedule_milestones")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
      context.supabase
        .from("schedule_risks")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
    ]);
    const [uRes, muRes] = await Promise.all([
      context.supabase
        .from("schedule_updates")
        .select("*")
        .eq("project_id", data.projectId)
        .order("update_number", { ascending: false }),
      context.supabase
        .from("schedule_milestone_updates")
        .select("*")
        .eq("project_id", data.projectId)
        .order("update_number", { ascending: false }),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);
    const updatesMissing =
      uRes.error &&
      (uRes.error.message.includes("schedule_updates") ||
        uRes.error.message.includes("schema cache"));
    const milestoneUpdatesMissing =
      muRes.error &&
      (muRes.error.message.includes("schedule_milestone_updates") ||
        muRes.error.message.includes("schema cache"));
    if (uRes.error && !updatesMissing) throw new Error(uRes.error.message);
    if (muRes.error && !milestoneUpdatesMissing) throw new Error(muRes.error.message);
    const risks = (rRes.data ?? []).map((r) => normalizeScheduleRisk(r as Record<string, unknown>));
    const unlinkedTitles = Array.from(
      new Set(risks.filter((r) => !r.linked_exposure_id && r.title).map((r) => r.title)),
    );
    if (unlinkedTitles.length > 0) {
      const { data: exposures, error: exposureError } = await context.supabase
        .from("exposures")
        .select("id,title,category,status")
        .eq("project_id", data.projectId)
        .in("title", unlinkedTitles)
        .in("status", ["active", "escalated"]);
      if (!exposureError) {
        for (const risk of risks) {
          if (risk.linked_exposure_id) continue;
          const match = exposures?.find(
            (exposure) =>
              exposure.title === risk.title &&
              exposure.category === RISK_EXPOSURE_CATEGORY[risk.kind],
          );
          if (match?.id) risk.linked_exposure_id = match.id as string;
        }
      }
    }
    return {
      milestones: (mRes.data ?? []) as unknown as MilestoneRow[],
      risks,
      updates: updatesMissing
        ? []
        : (uRes.data ?? []).map((r) => normalizeScheduleUpdate(r as Record<string, unknown>)),
      milestoneUpdates: milestoneUpdatesMissing
        ? []
        : (muRes.data ?? []).map((r) => normalizeMilestoneUpdate(r as Record<string, unknown>)),
    };
  });

// ---------- SCHEDULE UPDATES ----------
const createScheduleUpdateInput = z.object({
  projectId: z.string().uuid(),
  forecast_completion_date: z.string().min(1),
  update_date: z.string().optional(),
  notes: z.string().max(4000).default(""),
});

export const createScheduleUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createScheduleUpdateInput>) =>
    createScheduleUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("baseline_completion_date, forecast_completion_date")
      .eq("id", data.projectId)
      .single();
    if (projectError) throw new Error(projectError.message);

    const { data: last } = await context.supabase
      .from("schedule_updates")
      .select("update_number, forecast_completion_date")
      .eq("project_id", data.projectId)
      .order("update_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const baseline = (project.baseline_completion_date as string | null) ?? null;
    const previousForecast =
      (last?.forecast_completion_date as string | null) ??
      (project.forecast_completion_date as string | null) ??
      null;
    const updateNumber = ((last?.update_number as number | undefined) ?? 0) + 1;
    const varianceWeeks =
      computeScheduleVarianceWeeks(baseline, data.forecast_completion_date) ?? 0;
    const movementWeeks =
      computeScheduleVarianceWeeks(previousForecast, data.forecast_completion_date) ?? 0;

    const { data: update, error: insertError } = await context.supabase
      .from("schedule_updates")
      .insert({
        project_id: data.projectId,
        update_number: updateNumber,
        update_date: data.update_date ?? new Date().toISOString().slice(0, 10),
        baseline_completion_date: baseline,
        forecast_completion_date: data.forecast_completion_date,
        variance_weeks: varianceWeeks,
        movement_weeks: movementWeeks,
        notes: data.notes,
      })
      .select("*")
      .single();
    if (insertError) throw new Error(insertError.message);

    const { error: projectUpdateError } = await context.supabase
      .from("projects")
      .update({
        forecast_completion_date: data.forecast_completion_date,
        schedule_variance_weeks: varianceWeeks,
      })
      .eq("id", data.projectId);
    if (projectUpdateError) throw new Error(projectUpdateError.message);

    const { data: milestones, error: milestoneError } = await context.supabase
      .from("schedule_milestones")
      .select("*")
      .eq("project_id", data.projectId);
    if (milestoneError) throw new Error(milestoneError.message);
    if ((milestones ?? []).length > 0) {
      const { error: snapshotError } = await context.supabase
        .from("schedule_milestone_updates")
        .insert(
          (milestones ?? []).map((m) => {
            const row = m as Record<string, unknown>;
            const baselineDate = (row.baseline_date as string | null) ?? null;
            const forecastDate = (row.forecast_date as string | null) ?? null;
            return {
              project_id: data.projectId,
              milestone_id: row.id as string,
              schedule_update_id: update.id as string,
              update_number: updateNumber,
              baseline_date: baselineDate,
              forecast_date: forecastDate,
              variance_weeks: computeScheduleVarianceWeeks(baselineDate, forecastDate) ?? 0,
              status: str(row.status, "on_track"),
              notes: str(row.delay_reason),
            };
          }),
        );
      if (snapshotError) throw new Error(snapshotError.message);
    }

    return { ok: true, update: normalizeScheduleUpdate(update as Record<string, unknown>) };
  });

// ---------- MILESTONES ----------
const milestonePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  baseline_date: z.string().nullable().optional(),
  forecast_date: z.string().nullable().optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  delay_reason: z.string().max(2000).optional(),
  owner: z.string().max(200).optional(),
  sort_order: z.number().int().optional(),
});

export const createMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; name: string }) =>
    z.object({ projectId: z.string().uuid(), name: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: last } = await context.supabase
      .from("schedule_milestones")
      .select("sort_order")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = ((last?.sort_order as number | undefined) ?? 0) + 1;
    const { error } = await context.supabase.from("schedule_milestones").insert({
      project_id: data.projectId,
      name: data.name,
      sort_order,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof milestonePatch> }) =>
    z.object({ id: z.string().uuid(), patch: milestonePatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_milestones")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedule_milestones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- RISKS ----------
const riskPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(2000).optional(),
  kind: z.enum(RISK_KINDS).optional(),
  dollar_exposure: z.number().min(0).optional(),
  probability: z.number().min(0).max(100).optional(),
  schedule_impact_weeks: z.number().nullable().optional(),
  owner: z.string().max(200).optional(),
  due_date: z.string().nullable().optional(),
  response_path: z.enum(RESPONSE_PATHS).optional(),
  hold_class: z.enum(HOLD_CLASSES).optional(),
  linked_exposure_id: z.string().uuid().nullable().optional(),
  status: z.enum(RISK_STATUSES).optional(),
  completed_at: z.string().nullable().optional(),
  inactive_reason: z.string().max(2000).optional(),
  sort_order: z.number().int().optional(),
});

export const createScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: { projectId: string; kind: ScheduleRiskKind; title: string } & Partial<
        z.input<typeof riskPatch>
      >,
    ) =>
      z
        .object({
          projectId: z.string().uuid(),
          kind: z.enum(RISK_KINDS),
          title: z.string().min(1).max(200),
        })
        .merge(riskPatch.omit({ kind: true, title: true }).partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase.from("schedule_risks").insert({
      project_id: projectId,
      ...rest,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof riskPatch> }) =>
    z.object({ id: z.string().uuid(), patch: riskPatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const savePatch = (patch: z.input<typeof riskPatch>) =>
      context.supabase.from("schedule_risks").update(patch).eq("id", data.id);
    let { error } = await savePatch(data.patch);
    if (isMissingRestColumn(error, "linked_exposure_id") && "linked_exposure_id" in data.patch) {
      const retryPatch = { ...data.patch };
      delete retryPatch.linked_exposure_id;
      if (Object.keys(retryPatch).length === 0) return { ok: true, linkSkipped: true };
      ({ error } = await savePatch(retryPatch));
    }
    if (
      (isMissingRestColumn(error, "status") ||
        isMissingRestColumn(error, "completed_at") ||
        isMissingRestColumn(error, "inactive_reason")) &&
      ("status" in data.patch || "completed_at" in data.patch || "inactive_reason" in data.patch)
    ) {
      const retryPatch = { ...data.patch };
      delete retryPatch.status;
      delete retryPatch.completed_at;
      delete retryPatch.inactive_reason;
      if (Object.keys(retryPatch).length === 0) return { ok: true, statusSkipped: true };
      ({ error } = await savePatch(retryPatch));
    }
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedule_risks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
