import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeScheduleVarianceWeeks,
  type ExposureCategory,
  type HoldClass,
  type ResponsePath,
} from "@/lib/ior";
import {
  ensureHarborDemoCpmActivitiesForProject,
  getHarborDemoCpmActivityRows,
} from "@/lib/projects.functions";

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

export interface ScheduleActivityRow {
  id: string;
  project_id: string;
  activity_id: string;
  name: string;
  division: string;
  start_date: string | null;
  finish_date: string | null;
  percent_complete: number;
  predecessor_activity_ids: string[];
  successor_activity_ids: string[];
  notes: string;
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
  data_date: string;
  baseline_completion_date: string | null;
  forecast_completion_date: string;
  variance_weeks: number;
  movement_weeks: number;
  schedule_money_exposure: number;
  schedule_money_recovery: number;
  schedule_money_net: number;
  money_notes: string;
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
const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    (error?.code === "PGRST204" && message.includes(`'${target}' column`)) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`.${target} does not exist`)
  );
};

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

const normalizeScheduleUpdate = (r: Record<string, unknown>): ScheduleUpdateRow => {
  const updateDate = str(r.update_date, str(r.data_date));
  const dataDate = str(r.data_date, updateDate);
  const scheduleMoneyExposure = num(r.schedule_money_exposure);
  const scheduleMoneyRecovery = num(r.schedule_money_recovery);
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    update_number: num(r.update_number),
    update_date: updateDate,
    data_date: dataDate,
    baseline_completion_date: (r.baseline_completion_date as string | null) ?? null,
    forecast_completion_date: str(r.forecast_completion_date),
    variance_weeks: num(r.variance_weeks),
    movement_weeks: num(r.movement_weeks),
    schedule_money_exposure: scheduleMoneyExposure,
    schedule_money_recovery: scheduleMoneyRecovery,
    schedule_money_net:
      r.schedule_money_net == null
        ? scheduleMoneyExposure - scheduleMoneyRecovery
        : num(r.schedule_money_net),
    money_notes: str(r.money_notes),
    notes: str(r.notes),
  };
};

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

const normalizeScheduleActivity = (r: Record<string, unknown>): ScheduleActivityRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  activity_id: str(r.activity_id),
  name: str(r.name),
  division: str(r.division, "General"),
  start_date: (r.start_date as string | null) ?? null,
  finish_date: (r.finish_date as string | null) ?? null,
  percent_complete: num(r.percent_complete),
  predecessor_activity_ids: Array.isArray(r.predecessor_activity_ids)
    ? r.predecessor_activity_ids.map(String)
    : [],
  successor_activity_ids: Array.isArray(r.successor_activity_ids)
    ? r.successor_activity_ids.map(String)
    : [],
  notes: str(r.notes),
  sort_order: num(r.sort_order),
});

// ---------- LIST ----------
export const listSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [mRes, rRes, aRes] = await Promise.all([
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
      context.supabase
        .from("schedule_activities" as any)
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("activity_id"),
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
    const activitiesMissing =
      aRes.error &&
      (aRes.error.message.includes("schedule_activities") ||
        aRes.error.message.includes("schema cache"));
    const updatesMissing =
      uRes.error &&
      (uRes.error.message.includes("schedule_updates") ||
        uRes.error.message.includes("schema cache"));
    const milestoneUpdatesMissing =
      muRes.error &&
      (muRes.error.message.includes("schedule_milestone_updates") ||
        muRes.error.message.includes("schema cache"));
    if (aRes.error && !activitiesMissing) throw new Error(aRes.error.message);
    if (uRes.error && !updatesMissing) throw new Error(uRes.error.message);
    if (muRes.error && !milestoneUpdatesMissing) throw new Error(muRes.error.message);

    let activityRows = activitiesMissing
      ? []
      : ((aRes.data ?? []) as unknown as Array<Record<string, unknown>>);
    const hasHarborDemoCpmRows = activityRows.some((row) => row.activity_id === "01-010");
    if (!activitiesMissing && !hasHarborDemoCpmRows) {
      const ensureResult = await ensureHarborDemoCpmActivitiesForProject(
        context.supabase,
        data.projectId,
      );
      if (ensureResult.ensured) {
        const refreshedActivities = await context.supabase
          .from("schedule_activities" as any)
          .select("*")
          .eq("project_id", data.projectId)
          .order("sort_order")
          .order("activity_id");
        if (refreshedActivities.error) throw new Error(refreshedActivities.error.message);
        activityRows = (refreshedActivities.data ?? []) as unknown as Array<Record<string, unknown>>;
        if (!activityRows.some((row) => row.activity_id === "01-010")) {
          activityRows = getHarborDemoCpmActivityRows(data.projectId);
        }
      }
    }

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
      activities: activitiesMissing
        ? []
        : activityRows.map((r) => normalizeScheduleActivity(r)),
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
  data_date: z.string().optional(),
  update_date: z.string().optional(),
  schedule_money_exposure: z.number().min(0).default(0),
  schedule_money_recovery: z.number().min(0).default(0),
  money_notes: z.string().max(4000).default(""),
  notes: z.string().max(4000).default(""),
  milestone_forecasts: z
    .array(
      z.object({
        milestone_id: z.string().uuid(),
        forecast_date: z.string().nullable(),
        status: z.enum(MILESTONE_STATUSES),
        delay_reason: z.string().max(2000).optional(),
      }),
    )
    .default([]),
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
    const previousCompletion =
      (last?.forecast_completion_date as string | null) ??
      (project.forecast_completion_date as string | null) ??
      null;
    const updateNumber = ((last?.update_number as number | undefined) ?? 0) + 1;
    const varianceWeeks =
      computeScheduleVarianceWeeks(baseline, data.forecast_completion_date) ?? 0;
    const movementWeeks =
      computeScheduleVarianceWeeks(previousCompletion, data.forecast_completion_date) ?? 0;
    const dataDate = data.data_date ?? data.update_date ?? new Date().toISOString().slice(0, 10);

    const baseUpdatePayload = {
      project_id: data.projectId,
      update_number: updateNumber,
      update_date: dataDate,
      baseline_completion_date: baseline,
      forecast_completion_date: data.forecast_completion_date,
      variance_weeks: varianceWeeks,
      movement_weeks: movementWeeks,
      notes: data.notes,
    };
    const extendedUpdatePayload = {
      ...baseUpdatePayload,
      data_date: dataDate,
      schedule_money_exposure: data.schedule_money_exposure,
      schedule_money_recovery: data.schedule_money_recovery,
      money_notes: data.money_notes,
    };

    let { data: update, error: insertError } = await context.supabase
      .from("schedule_updates")
      .insert(extendedUpdatePayload as any)
      .select("*")
      .single();
    if (
      insertError &&
      (isMissingRestColumn(insertError, "data_date") ||
        isMissingRestColumn(insertError, "schedule_money_exposure") ||
        isMissingRestColumn(insertError, "schedule_money_recovery") ||
        isMissingRestColumn(insertError, "money_notes"))
    ) {
      ({ data: update, error: insertError } = await context.supabase
        .from("schedule_updates")
        .insert(baseUpdatePayload)
        .select("*")
        .single());
    }
    if (insertError) throw new Error(insertError.message);
    if (!update) throw new Error("Schedule update did not save.");

    const { error: projectUpdateError } = await context.supabase
      .from("projects")
      .update({
        forecast_completion_date: data.forecast_completion_date,
        schedule_variance_weeks: varianceWeeks,
      })
      .eq("id", data.projectId);
    if (projectUpdateError) throw new Error(projectUpdateError.message);

    if (data.milestone_forecasts.length > 0) {
      const milestoneResults = await Promise.all(
        data.milestone_forecasts.map((forecast) =>
          context.supabase
            .from("schedule_milestones")
            .update({
              forecast_date: forecast.forecast_date,
              status: forecast.status,
              delay_reason: forecast.delay_reason ?? "",
            })
            .eq("id", forecast.milestone_id)
            .eq("project_id", data.projectId),
        ),
      );
      const milestoneError = milestoneResults.find((result) => result.error)?.error;
      if (milestoneError) throw new Error(milestoneError.message);
    }

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

// ---------- CPM ACTIVITIES ----------
const activityPatch = z.object({
  activity_id: z.string().max(50).optional(),
  name: z.string().min(1).max(240).optional(),
  division: z.string().max(120).optional(),
  start_date: z.string().nullable().optional(),
  finish_date: z.string().nullable().optional(),
  percent_complete: z.number().min(0).max(100).optional(),
  predecessor_activity_ids: z.array(z.string().max(50)).optional(),
  successor_activity_ids: z.array(z.string().max(50)).optional(),
  notes: z.string().max(4000).optional(),
  sort_order: z.number().int().optional(),
});

export const createScheduleActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: { projectId: string } & Partial<z.input<typeof activityPatch>> & {
          name: string;
        },
    ) =>
      z
        .object({
          projectId: z.string().uuid(),
          name: z.string().min(1).max(240),
        })
        .merge(activityPatch.omit({ name: true }).partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { data: last } = await context.supabase
      .from("schedule_activities" as any)
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder = rest.sort_order ?? (((last as any)?.sort_order as number | undefined) ?? 0) + 1;
    const activityId = rest.activity_id || `A-${String(sortOrder).padStart(3, "0")}`;
    const { error } = await context.supabase.from("schedule_activities" as any).insert({
      project_id: projectId,
      ...rest,
      activity_id: activityId,
      sort_order: sortOrder,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateScheduleActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof activityPatch> }) =>
    z.object({ id: z.string().uuid(), patch: activityPatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_activities" as any)
      .update(data.patch as any)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScheduleActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedule_activities" as any).delete().eq("id", data.id);
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
