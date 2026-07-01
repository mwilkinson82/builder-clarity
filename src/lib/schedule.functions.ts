import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database, Json, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
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
import { buildReciprocalActivityLogicPatches } from "@/lib/constructline-cpm";

export type MilestoneStatus = "on_track" | "at_risk" | "delayed" | "complete";
export type ScheduleRiskKind = "procurement" | "trade_performance" | "critical_decision";
export type ScheduleRiskStatus = "active" | "inactive" | "completed";
export type ScheduleDelayFragmentStatus = "active" | "mitigated" | "accepted" | "recovered";
export type ScheduleDelayFragmentSource =
  "field" | "trade" | "owner" | "design" | "procurement" | "weather" | "other";

type ScheduleSupabaseClient = SupabaseClient<Database>;
type ScheduleUpdateInsert = TablesInsert<"schedule_updates">;
type ScheduleDelayFragmentInsert = TablesInsert<"schedule_delay_fragments">;
type ScheduleDelayFragmentUpdate = TablesUpdate<"schedule_delay_fragments">;
type ScheduleActivityInsert = TablesInsert<"schedule_activities">;
type ScheduleActivityUpdate = TablesUpdate<"schedule_activities">;
type ScheduleWbsSectionInsert = TablesInsert<"schedule_wbs_sections">;
type ScheduleWbsSectionUpdate = TablesUpdate<"schedule_wbs_sections">;
type DynamicSupabaseError = { code?: string; message?: string } | null;
type DynamicSupabaseResult<T = Record<string, unknown>[]> = {
  data: T | null;
  error: DynamicSupabaseError;
};
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult<Record<string, unknown>>>;
  maybeSingle(): Promise<DynamicSupabaseResult<Record<string, unknown>>>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };

type ScheduleWbsParentFilterQuery<TQuery> = {
  eq: (column: string, value: string) => TQuery;
  is: (column: string, value: null) => TQuery;
};

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
  wbs_section_id: string | null;
  start_date: string | null;
  finish_date: string | null;
  baseline_start_date: string | null;
  baseline_finish_date: string | null;
  forecast_start_date: string | null;
  forecast_finish_date: string | null;
  actual_start_date: string | null;
  actual_finish_date: string | null;
  remaining_duration_days: number | null;
  percent_complete: number;
  predecessor_activity_ids: string[];
  successor_activity_ids: string[];
  notes: string;
  sort_order: number;
}

export interface ScheduleWbsSectionRow {
  id: string;
  project_id: string;
  parent_id: string | null;
  name: string;
  code: string;
  sort_order: number;
}

export interface ScheduleDelayFragmentRow {
  id: string;
  project_id: string;
  schedule_activity_id: string | null;
  activity_id: string;
  title: string;
  reason: string;
  delay_days: number;
  source: ScheduleDelayFragmentSource;
  status: ScheduleDelayFragmentStatus;
  owner: string;
  identified_on: string;
  resolved_on: string | null;
}

export interface ScheduleCpmTemplateRow {
  id: string;
  project_id: string;
  name: string;
  description: string;
  activity_count: number;
  created_at: string;
  updated_at: string;
}

export type ScheduleWbsPersistence = "ready" | "path_fallback" | "migration_required";

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
const DELAY_FRAGMENT_STATUSES = ["active", "mitigated", "accepted", "recovered"] as const;
const DELAY_FRAGMENT_SOURCES = [
  "field",
  "trade",
  "owner",
  "design",
  "procurement",
  "weather",
  "other",
] as const;
const RESPONSE_PATHS = ["eliminate", "recover", "offset", "accept"] as const;
const HOLD_CLASSES = ["E-Hold", "C-Hold", "Both", "None"] as const;
const RISK_EXPOSURE_CATEGORY: Record<ScheduleRiskKind, ExposureCategory> = {
  critical_decision: "owner_decision",
  procurement: "procurement",
  trade_performance: "trade_performance",
};

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);
const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    (error?.code === "PGRST204" && message.includes(`'${target}' column`)) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`.${target} does not exist`)
  );
};
const isMissingRestRelation = (
  error: { code?: string; message?: string } | null,
  relation: string,
) => {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" &&
    (message.includes(`'public.${relation}'`) ||
      message.includes(`'${relation}'`) ||
      message.includes("schema cache"))
  );
};
const isMissingRpcError = (error: DynamicSupabaseError, fnName: string) => {
  const message = (error?.message ?? "").toLowerCase();
  return (
    error?.code === "PGRST202" ||
    message.includes(fnName.toLowerCase()) ||
    message.includes("schema cache") ||
    message.includes("could not find the function") ||
    message.includes("function public.") ||
    message.includes("does not exist")
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
  wbs_section_id: (r.wbs_section_id as string | null) ?? null,
  start_date: (r.start_date as string | null) ?? null,
  finish_date: (r.finish_date as string | null) ?? null,
  baseline_start_date:
    (r.baseline_start_date as string | null) ?? (r.start_date as string | null) ?? null,
  baseline_finish_date:
    (r.baseline_finish_date as string | null) ?? (r.finish_date as string | null) ?? null,
  forecast_start_date:
    (r.forecast_start_date as string | null) ?? (r.start_date as string | null) ?? null,
  forecast_finish_date:
    (r.forecast_finish_date as string | null) ?? (r.finish_date as string | null) ?? null,
  actual_start_date: (r.actual_start_date as string | null) ?? null,
  actual_finish_date: (r.actual_finish_date as string | null) ?? null,
  remaining_duration_days:
    r.remaining_duration_days == null
      ? null
      : Math.max(0, Math.round(num(r.remaining_duration_days))),
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

const normalizeScheduleWbsSection = (r: Record<string, unknown>): ScheduleWbsSectionRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  parent_id: (r.parent_id as string | null) ?? null,
  name: str(r.name, "General"),
  code: str(r.code),
  sort_order: num(r.sort_order),
});

const normalizeScheduleDelayFragment = (r: Record<string, unknown>): ScheduleDelayFragmentRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  schedule_activity_id: (r.schedule_activity_id as string | null) ?? null,
  activity_id: str(r.activity_id),
  title: str(r.title),
  reason: str(r.reason),
  delay_days: num(r.delay_days),
  source: str(r.source, "field") as ScheduleDelayFragmentSource,
  status: str(r.status, "active") as ScheduleDelayFragmentStatus,
  owner: str(r.owner),
  identified_on: str(r.identified_on, new Date().toISOString().slice(0, 10)),
  resolved_on: (r.resolved_on as string | null) ?? null,
});

const normalizeScheduleCpmTemplate = (r: Record<string, unknown>): ScheduleCpmTemplateRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  name: str(r.name, "CPM template"),
  description: str(r.description),
  activity_count: num(r.activity_count),
  created_at: str(r.created_at),
  updated_at: str(r.updated_at),
});

const scheduleWbsSectionFromActivityDivision = (
  projectId: string,
  division: string,
  index: number,
  parentId: string | null = null,
): ScheduleWbsSectionRow => ({
  id: `derived-${projectId}-${division.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  project_id: projectId,
  parent_id: parentId,
  name: division,
  code: "",
  sort_order: (index + 1) * 10,
});

const WBS_PATH_SEPARATOR = " / ";

const splitScheduleWbsPath = (value?: string | null) =>
  (value || "General")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

const joinScheduleWbsPath = (parts: string[]) =>
  (parts.length > 0 ? parts : ["General"]).join(WBS_PATH_SEPARATOR);

const scheduleWbsPathKey = (value?: string | null) =>
  splitScheduleWbsPath(value).join("/").toLocaleLowerCase();

const scheduleWbsParentFilter = <TQuery extends ScheduleWbsParentFilterQuery<TQuery>>(
  query: TQuery,
  parentId: string | null,
) => (parentId ? query.eq("parent_id", parentId) : query.is("parent_id", null));

async function getScheduleWbsPersistenceMode(
  supabase: ScheduleSupabaseClient,
  projectId: string,
): Promise<ScheduleWbsPersistence> {
  const { error } = await supabase
    .from("schedule_wbs_sections")
    .select("parent_id")
    .eq("project_id", projectId)
    .limit(1);
  if (!error) return "ready";
  if (isMissingRestRelation(error, "schedule_wbs_sections")) return "migration_required";
  if (isMissingRestColumn(error, "parent_id")) return "path_fallback";
  throw new Error(error.message);
}

const buildDerivedWbsSectionsFromActivityDivisions = (
  projectId: string,
  divisions: string[],
): ScheduleWbsSectionRow[] => {
  const rows: ScheduleWbsSectionRow[] = [];
  const seen = new Map<string, ScheduleWbsSectionRow>();
  divisions.forEach((division) => {
    const parts = splitScheduleWbsPath(division);
    parts.forEach((part, index) => {
      const path = joinScheduleWbsPath(parts.slice(0, index + 1));
      const key = scheduleWbsPathKey(path);
      if (seen.has(key)) return;
      const parentPath = index === 0 ? null : joinScheduleWbsPath(parts.slice(0, index));
      const parent = parentPath ? seen.get(scheduleWbsPathKey(parentPath)) : null;
      const row = scheduleWbsSectionFromActivityDivision(
        projectId,
        part,
        rows.length,
        parent?.id ?? null,
      );
      seen.set(key, row);
      rows.push(row);
    });
  });
  return rows;
};

const buildWbsSectionPathMap = (sections: ScheduleWbsSectionRow[]) => {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const cache = new Map<string, string>();
  const buildPath = (section: ScheduleWbsSectionRow, trail = new Set<string>()): string => {
    if (cache.has(section.id)) return cache.get(section.id)!;
    if (!section.parent_id || trail.has(section.parent_id)) {
      cache.set(section.id, section.name);
      return section.name;
    }
    const parent = byId.get(section.parent_id);
    if (!parent) {
      cache.set(section.id, section.name);
      return section.name;
    }
    trail.add(section.id);
    const path = joinScheduleWbsPath([
      ...splitScheduleWbsPath(buildPath(parent, trail)),
      section.name,
    ]);
    cache.set(section.id, path);
    return path;
  };
  for (const section of sections) buildPath(section);
  return cache;
};

const buildPersistedWbsPathMaps = (
  rawRows: Array<Record<string, unknown>>,
  renamedId: string,
  previousName: string,
) => {
  const currentSections = rawRows.map((row) => normalizeScheduleWbsSection(row));
  const previousSections = currentSections.map((section) =>
    section.id === renamedId ? { ...section, name: previousName } : section,
  );
  return {
    previous: buildWbsSectionPathMap(previousSections),
    current: buildWbsSectionPathMap(currentSections),
  };
};

async function syncActivityDivisionsForWbsPathChange(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  oldPath: string,
  newPath: string,
) {
  if (!oldPath || !newPath || oldPath === newPath) return;
  const { data: activities, error: activitiesError } = await supabase
    .from("schedule_activities")
    .select("id,division")
    .eq("project_id", projectId);
  if (activitiesError) throw new Error(activitiesError.message);
  const patches = ((activities ?? []) as unknown as Array<Record<string, unknown>>)
    .map((activity) => {
      const division = str(activity.division, "General");
      if (division === oldPath) return { id: activity.id as string, division: newPath };
      if (division.startsWith(`${oldPath}${WBS_PATH_SEPARATOR}`)) {
        return {
          id: activity.id as string,
          division: `${newPath}${division.slice(oldPath.length)}`,
        };
      }
      return null;
    })
    .filter((patch): patch is { id: string; division: string } => Boolean(patch));
  if (patches.length === 0) return;
  const patchResults = await Promise.all(
    patches.map((patch) =>
      supabase
        .from("schedule_activities")
        .update({ division: patch.division })
        .eq("id", patch.id)
        .eq("project_id", projectId),
    ),
  );
  const patchError = patchResults.find((result) => result.error)?.error;
  if (patchError) throw new Error(patchError.message);
}

function isDescendantWbsSection(
  sections: ScheduleWbsSectionRow[],
  sectionId: string,
  candidateParentId: string | null,
) {
  if (!candidateParentId) return false;
  const byId = new Map(sections.map((section) => [section.id, section]));
  let cursor: string | null = candidateParentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === sectionId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parent_id ?? null;
  }
  return false;
}

// ---------- LIST ----------
export const listSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [mRes, rRes, aRes, wRes, wNestedRes, dRes] = await Promise.all([
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
        .from("schedule_activities")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("activity_id"),
      context.supabase
        .from("schedule_wbs_sections")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("name"),
      context.supabase
        .from("schedule_wbs_sections")
        .select("parent_id")
        .eq("project_id", data.projectId)
        .limit(1),
      context.supabase
        .from("schedule_delay_fragments")
        .select("*")
        .eq("project_id", data.projectId)
        .order("identified_on", { ascending: false })
        .order("created_at", { ascending: false }),
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
    const wbsSectionsMissing =
      wRes.error &&
      (wRes.error.message.includes("schedule_wbs_sections") ||
        wRes.error.message.includes("schema cache"));
    const wbsNestedColumnsMissing =
      !wbsSectionsMissing && wNestedRes.error && isMissingRestColumn(wNestedRes.error, "parent_id");
    const delayFragmentsMissing =
      dRes.error &&
      (dRes.error.message.includes("schedule_delay_fragments") ||
        dRes.error.message.includes("schema cache"));
    if (aRes.error && !activitiesMissing) throw new Error(aRes.error.message);
    if (wRes.error && !wbsSectionsMissing) throw new Error(wRes.error.message);
    if (wNestedRes.error && !wbsSectionsMissing && !wbsNestedColumnsMissing) {
      throw new Error(wNestedRes.error.message);
    }
    if (dRes.error && !delayFragmentsMissing) throw new Error(dRes.error.message);
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
          .from("schedule_activities")
          .select("*")
          .eq("project_id", data.projectId)
          .order("sort_order")
          .order("activity_id");
        if (refreshedActivities.error) throw new Error(refreshedActivities.error.message);
        activityRows = (refreshedActivities.data ?? []) as unknown as Array<
          Record<string, unknown>
        >;
        if (!activityRows.some((row) => row.activity_id === "01-010")) {
          activityRows = getHarborDemoCpmActivityRows(data.projectId);
        }
      }
    }

    const uniqueActivityDivisions = Array.from(
      new Set(activityRows.map((row) => str(row.division, "General").trim() || "General")),
    );
    const derivedWbsSections = buildDerivedWbsSectionsFromActivityDivisions(
      data.projectId,
      uniqueActivityDivisions,
    );
    let persistedWbsRows = wbsSectionsMissing
      ? []
      : ((wRes.data ?? []) as unknown as Array<Record<string, unknown>>);
    if (!wbsSectionsMissing && persistedWbsRows.length === 0 && derivedWbsSections.length > 0) {
      for (const division of uniqueActivityDivisions) {
        await ensureScheduleWbsPath(context.supabase, data.projectId, division);
      }
      const seededWbs = await context.supabase
        .from("schedule_wbs_sections")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("name");
      if (!seededWbs.error) {
        persistedWbsRows = (seededWbs.data ?? []) as unknown as Array<Record<string, unknown>>;
      }
    }
    const wbsSectionRows =
      wbsSectionsMissing || persistedWbsRows.length === 0
        ? derivedWbsSections
        : persistedWbsRows.map((r) => normalizeScheduleWbsSection(r));

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
      activities: activitiesMissing ? [] : activityRows.map((r) => normalizeScheduleActivity(r)),
      wbsSections: wbsSectionRows,
      wbsPersistence: wbsSectionsMissing
        ? "migration_required"
        : wbsNestedColumnsMissing
          ? "path_fallback"
          : "ready",
      delayFragments: delayFragmentsMissing
        ? []
        : (dRes.data ?? []).map((r) =>
            normalizeScheduleDelayFragment(r as unknown as Record<string, unknown>),
          ),
      delayFragmentPersistence: delayFragmentsMissing ? "migration_required" : "ready",
      risks,
      updates: updatesMissing
        ? []
        : (uRes.data ?? []).map((r) => normalizeScheduleUpdate(r as Record<string, unknown>)),
      milestoneUpdates: milestoneUpdatesMissing
        ? []
        : (muRes.data ?? []).map((r) => normalizeMilestoneUpdate(r as Record<string, unknown>)),
    };
  });

// ---------- CPM TEMPLATES ----------
const templateLibraryUnavailableMessage =
  "Use browser templates for this workspace. The live schedule still works, and reusable CPM templates can be saved privately in this browser.";

const scheduleActivityTemplatePayload = (activity: ScheduleActivityRow): Record<string, Json> => ({
  activity_id: activity.activity_id,
  name: activity.name,
  division: activity.division,
  start_date: activity.start_date,
  finish_date: activity.finish_date,
  baseline_start_date: activity.baseline_start_date,
  baseline_finish_date: activity.baseline_finish_date,
  forecast_start_date: activity.forecast_start_date,
  forecast_finish_date: activity.forecast_finish_date,
  actual_start_date: activity.actual_start_date,
  actual_finish_date: activity.actual_finish_date,
  remaining_duration_days: activity.remaining_duration_days,
  percent_complete: activity.percent_complete,
  predecessor_activity_ids: activity.predecessor_activity_ids,
  successor_activity_ids: activity.successor_activity_ids,
  notes: activity.notes,
  sort_order: activity.sort_order,
});

const scheduleWbsTemplatePayload = (
  section: ScheduleWbsSectionRow,
  path: string,
): Record<string, Json> => ({
  name: section.name,
  path,
  code: section.code,
  parent_id: section.parent_id,
  sort_order: section.sort_order,
});

const readTemplateActivities = (value: unknown): ScheduleActivityInsert[] => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    return {
      project_id: "",
      activity_id: str(row.activity_id, `T-${String(index + 1).padStart(3, "0")}`),
      name: str(row.name, "Template activity"),
      division: str(row.division, "General"),
      start_date: (row.start_date as string | null) ?? null,
      finish_date: (row.finish_date as string | null) ?? null,
      baseline_start_date: (row.baseline_start_date as string | null) ?? null,
      baseline_finish_date: (row.baseline_finish_date as string | null) ?? null,
      forecast_start_date: (row.forecast_start_date as string | null) ?? null,
      forecast_finish_date: (row.forecast_finish_date as string | null) ?? null,
      actual_start_date: (row.actual_start_date as string | null) ?? null,
      actual_finish_date: (row.actual_finish_date as string | null) ?? null,
      remaining_duration_days:
        row.remaining_duration_days == null
          ? null
          : Math.max(0, Math.round(num(row.remaining_duration_days))),
      percent_complete: num(row.percent_complete),
      predecessor_activity_ids: Array.isArray(row.predecessor_activity_ids)
        ? row.predecessor_activity_ids.map(String)
        : [],
      successor_activity_ids: Array.isArray(row.successor_activity_ids)
        ? row.successor_activity_ids.map(String)
        : [],
      notes: str(row.notes),
      sort_order: num(row.sort_order) || (index + 1) * 10,
    };
  });
};

const readTemplateWbsSections = (
  value: unknown,
): Array<
  Pick<ScheduleWbsSectionRow, "name" | "code" | "sort_order"> & {
    parent_id: string | null;
    path: string;
  }
> => {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const row = (item ?? {}) as Record<string, unknown>;
    const name = str(row.name, "General");
    return {
      name,
      path: str(row.path, name),
      code: str(row.code),
      parent_id: (row.parent_id as string | null) ?? null,
      sort_order: num(row.sort_order) || (index + 1) * 10,
    };
  });
};

export const listScheduleCpmTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId?: string } | undefined) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context }) => {
    const { data, error } = await dynamicTable(context.supabase, "schedule_cpm_templates")
      .select("id,project_id,name,description,activity_count,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (isMissingRestRelation(error, "schedule_cpm_templates")) {
      return { templates: [], persistence: "migration_required" as const };
    }
    if (error) throw new Error(error.message ?? "CPM template library did not load.");
    return {
      templates: ((data ?? []) as Record<string, unknown>[]).map(normalizeScheduleCpmTemplate),
      persistence: "ready" as const,
    };
  });

export const saveCurrentScheduleAsCpmTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; name: string; description?: string }) =>
    z
      .object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(160),
        description: z.string().max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const [activitiesRes, wbsRes] = await Promise.all([
      context.supabase
        .from("schedule_activities")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("activity_id"),
      context.supabase
        .from("schedule_wbs_sections")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order")
        .order("name"),
    ]);
    if (activitiesRes.error) throw new Error(activitiesRes.error.message);
    if (wbsRes.error && !isMissingRestRelation(wbsRes.error, "schedule_wbs_sections")) {
      throw new Error(wbsRes.error.message);
    }
    const activities = ((activitiesRes.data ?? []) as unknown as Record<string, unknown>[])
      .map(normalizeScheduleActivity)
      .map(scheduleActivityTemplatePayload);
    const persistedWbsSections = ((wbsRes.data ?? []) as unknown as Record<string, unknown>[]).map(
      normalizeScheduleWbsSection,
    );
    const wbsPathMap = buildWbsSectionPathMap(persistedWbsSections);
    const wbsSections = persistedWbsSections.map((section) =>
      scheduleWbsTemplatePayload(section, wbsPathMap.get(section.id) ?? section.name),
    );
    const { data: inserted, error } = await dynamicTable(context.supabase, "schedule_cpm_templates")
      .insert({
        project_id: data.projectId,
        name: data.name.trim(),
        description: data.description?.trim() ?? "",
        activities,
        wbs_sections: wbsSections,
        activity_count: activities.length,
      })
      .select("id")
      .single();
    if (isMissingRestRelation(error, "schedule_cpm_templates")) {
      throw new Error(templateLibraryUnavailableMessage);
    }
    if (error) throw new Error(error.message ?? "CPM template did not save.");
    return { ok: true, id: str(inserted?.id) };
  });

export const importScheduleCpmTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; templateId: string }) =>
    z.object({ projectId: z.string().uuid(), templateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const templateRes = await dynamicTable(context.supabase, "schedule_cpm_templates")
      .select("*")
      .eq("id", data.templateId)
      .maybeSingle();
    if (isMissingRestRelation(templateRes.error, "schedule_cpm_templates")) {
      throw new Error(templateLibraryUnavailableMessage);
    }
    if (templateRes.error)
      throw new Error(templateRes.error.message ?? "CPM template did not load.");
    if (!templateRes.data) throw new Error("CPM template was not found.");

    const template = templateRes.data as Record<string, unknown>;
    const activities = readTemplateActivities(template.activities);
    const wbsSections = readTemplateWbsSections(template.wbs_sections);
    if (activities.length === 0) throw new Error("This CPM template has no activities to import.");

    for (const section of wbsSections) {
      await ensureScheduleWbsPath(context.supabase, data.projectId, section.path || section.name);
    }

    const existingRes = await context.supabase
      .from("schedule_activities")
      .select("activity_id,sort_order")
      .eq("project_id", data.projectId);
    if (existingRes.error) throw new Error(existingRes.error.message);
    const existingRows = (existingRes.data ?? []) as unknown as Array<Record<string, unknown>>;
    const existingIds = new Set(existingRows.map((row) => str(row.activity_id)).filter(Boolean));
    const maxSortOrder = Math.max(0, ...existingRows.map((row) => num(row.sort_order)));
    const rows = activities
      .filter((activity) => !existingIds.has(str(activity.activity_id)))
      .map((activity, index) => ({
        ...activity,
        project_id: data.projectId,
        percent_complete: 0,
        sort_order: maxSortOrder + (index + 1) * 10,
      }));
    if (rows.length === 0) return { ok: true, inserted: 0, skipped: activities.length };

    const rowsWithWbs = [];
    for (const row of rows) {
      rowsWithWbs.push({
        ...row,
        wbs_section_id: await ensureScheduleWbsPath(
          context.supabase,
          data.projectId,
          str(row.division, "General"),
        ),
      });
    }

    let { error } = await context.supabase.from("schedule_activities").insert(rowsWithWbs);
    if (error && isMissingRestColumn(error, "wbs_section_id")) {
      ({ error } = await context.supabase.from("schedule_activities").insert(rows));
    }
    if (error) throw new Error(error.message);
    return { ok: true, inserted: rows.length, skipped: activities.length - rows.length };
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

    const baseUpdatePayload: TablesInsert<"schedule_updates"> = {
      project_id: data.projectId,
      update_number: updateNumber,
      update_date: dataDate,
      baseline_completion_date: baseline,
      forecast_completion_date: data.forecast_completion_date,
      variance_weeks: varianceWeeks,
      movement_weeks: movementWeeks,
      notes: data.notes,
    };
    const extendedUpdatePayload: ScheduleUpdateInsert = {
      ...baseUpdatePayload,
      data_date: dataDate,
      schedule_money_exposure: data.schedule_money_exposure,
      schedule_money_recovery: data.schedule_money_recovery,
      money_notes: data.money_notes,
    };

    let { data: update, error: insertError } = await context.supabase
      .from("schedule_updates")
      .insert(extendedUpdatePayload)
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
  wbs_section_id: z.string().uuid().nullable().optional(),
  start_date: z.string().nullable().optional(),
  finish_date: z.string().nullable().optional(),
  baseline_start_date: z.string().nullable().optional(),
  baseline_finish_date: z.string().nullable().optional(),
  forecast_start_date: z.string().nullable().optional(),
  forecast_finish_date: z.string().nullable().optional(),
  actual_start_date: z.string().nullable().optional(),
  actual_finish_date: z.string().nullable().optional(),
  remaining_duration_days: z.number().int().min(0).max(5000).nullable().optional(),
  percent_complete: z.number().min(0).max(100).optional(),
  predecessor_activity_ids: z.array(z.string().max(50)).optional(),
  successor_activity_ids: z.array(z.string().max(50)).optional(),
  notes: z.string().max(4000).optional(),
  sort_order: z.number().int().optional(),
});

const SCHEDULE_ACTIVITY_STATUS_COLUMNS = [
  "baseline_start_date",
  "baseline_finish_date",
  "forecast_start_date",
  "forecast_finish_date",
  "actual_start_date",
  "actual_finish_date",
  "remaining_duration_days",
] as const;

function isMissingScheduleActivityStatusColumn(error: DynamicSupabaseError) {
  return SCHEDULE_ACTIVITY_STATUS_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function stripScheduleActivityStatusColumns<T extends Record<string, unknown>>(payload: T) {
  const next = { ...payload };
  for (const column of SCHEDULE_ACTIVITY_STATUS_COLUMNS) delete next[column];
  return next;
}

function stripScheduleActivityMissingColumns<T extends Record<string, unknown>>(
  payload: T,
  error: DynamicSupabaseError,
) {
  let next = { ...payload };
  if (isMissingRestColumn(error, "wbs_section_id")) delete next.wbs_section_id;
  if (isMissingScheduleActivityStatusColumn(error)) {
    next = stripScheduleActivityStatusColumns(next);
  }
  return next;
}

async function ensureScheduleWbsSection(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  name: string,
  parentId: string | null = null,
) {
  const sectionName = name.trim() || "General";
  let existingQuery = supabase
    .from("schedule_wbs_sections")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", sectionName);
  existingQuery = scheduleWbsParentFilter(existingQuery, parentId);
  let existing = await existingQuery.maybeSingle();
  if (existing.error && isMissingRestColumn(existing.error, "parent_id")) {
    existing = await supabase
      .from("schedule_wbs_sections")
      .select("id")
      .eq("project_id", projectId)
      .eq("name", sectionName)
      .maybeSingle();
  }
  if (existing.error && !isMissingRestColumn(existing.error, "schedule_wbs_sections")) {
    const message = (existing.error.message ?? "").toLowerCase();
    if (!message.includes("schedule_wbs_sections") && !message.includes("schema cache")) {
      throw new Error(existing.error.message);
    }
  }
  if (existing.data?.id || existing.error) return (existing.data?.id as string | undefined) ?? null;

  let lastQuery = supabase
    .from("schedule_wbs_sections")
    .select("sort_order")
    .eq("project_id", projectId);
  lastQuery = scheduleWbsParentFilter(lastQuery, parentId);
  let { data: last, error: lastError } = await lastQuery
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError && isMissingRestColumn(lastError, "parent_id")) {
    const fallbackLast = await supabase
      .from("schedule_wbs_sections")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    last = fallbackLast.data;
    lastError = fallbackLast.error;
  }
  if (lastError) throw new Error(lastError.message);

  const payload: ScheduleWbsSectionInsert = {
    project_id: projectId,
    parent_id: parentId,
    name: sectionName,
    code: "",
    sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10,
  };
  let { data: inserted, error: insertError } = await supabase
    .from("schedule_wbs_sections")
    .insert(payload)
    .select("id")
    .single();
  if (
    insertError &&
    (isMissingRestColumn(insertError, "parent_id") || isMissingRestColumn(insertError, "code"))
  ) {
    const fallback = await supabase
      .from("schedule_wbs_sections")
      .insert({
        project_id: projectId,
        name: sectionName,
        sort_order: payload.sort_order,
      })
      .select("id")
      .single();
    inserted = fallback.data;
    insertError = fallback.error;
  }
  if (insertError) {
    const message = (insertError.message ?? "").toLowerCase();
    if (!message.includes("duplicate")) throw new Error(insertError.message);
  }
  return ((inserted as Record<string, unknown> | null)?.id as string | undefined) ?? null;
}

async function ensureScheduleWbsPathLabel(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  value: string,
) {
  const sectionName = joinScheduleWbsPath(splitScheduleWbsPath(value));
  const existing = await supabase
    .from("schedule_wbs_sections")
    .select("id")
    .eq("project_id", projectId)
    .eq("name", sectionName)
    .maybeSingle();
  if (isMissingRestRelation(existing.error, "schedule_wbs_sections")) return null;
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id as string;

  const { data: last, error: lastError } = await supabase
    .from("schedule_wbs_sections")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);

  const { data: inserted, error: insertError } = await supabase
    .from("schedule_wbs_sections")
    .insert({
      project_id: projectId,
      name: sectionName,
      sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10,
    })
    .select("id")
    .single();
  if (insertError) {
    const message = (insertError.message ?? "").toLowerCase();
    if (!message.includes("duplicate")) throw new Error(insertError.message);
  }
  return ((inserted as Record<string, unknown> | null)?.id as string | undefined) ?? null;
}

async function ensureScheduleWbsPath(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  value: string,
) {
  const mode = await getScheduleWbsPersistenceMode(supabase, projectId);
  if (mode === "migration_required") return null;
  if (mode === "path_fallback") {
    let sectionId: string | null = null;
    const parts = splitScheduleWbsPath(value);
    for (let depth = 1; depth <= parts.length; depth += 1) {
      sectionId = await ensureScheduleWbsPathLabel(
        supabase,
        projectId,
        joinScheduleWbsPath(parts.slice(0, depth)),
      );
    }
    return sectionId;
  }

  let parentId: string | null = null;
  for (const segment of splitScheduleWbsPath(value)) {
    parentId = await ensureScheduleWbsSection(supabase, projectId, segment, parentId);
  }
  return parentId;
}

function replaceScheduleWbsPath(value: string, oldPath: string, newPath: string) {
  const normalizedValue = joinScheduleWbsPath(splitScheduleWbsPath(value));
  const normalizedOldPath = joinScheduleWbsPath(splitScheduleWbsPath(oldPath));
  const normalizedNewPath = joinScheduleWbsPath(splitScheduleWbsPath(newPath));
  if (normalizedValue === normalizedOldPath) return normalizedNewPath;
  if (normalizedValue.startsWith(`${normalizedOldPath}${WBS_PATH_SEPARATOR}`)) {
    return `${normalizedNewPath}${normalizedValue.slice(normalizedOldPath.length)}`;
  }
  return value;
}

async function getPersistedScheduleWbsSections(
  supabase: ScheduleSupabaseClient,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("schedule_wbs_sections")
    .select("*")
    .eq("project_id", projectId);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
    normalizeScheduleWbsSection(row),
  );
}

async function getScheduleWbsPathContext(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  sectionId: string,
) {
  const sections = await getPersistedScheduleWbsSections(supabase, projectId);
  const section = sections.find((item) => item.id === sectionId);
  if (!section) throw new Error("Choose a WBS section from this project.");
  const pathMap = buildWbsSectionPathMap(sections);
  return {
    sections,
    section,
    pathMap,
    path: joinScheduleWbsPath(splitScheduleWbsPath(pathMap.get(section.id) ?? section.name)),
  };
}

async function syncPathBasedWbsSectionNamesForPathChange(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  oldPath: string,
  newPath: string,
) {
  const sections = await getPersistedScheduleWbsSections(supabase, projectId);
  const payload: ScheduleWbsSectionInsert[] = [];
  sections.forEach((section) => {
    const nextName = replaceScheduleWbsPath(section.name, oldPath, newPath);
    if (nextName === section.name) return;
    payload.push({
      id: section.id,
      project_id: projectId,
      name: nextName,
      code: section.code,
      sort_order: section.sort_order,
    });
  });
  if (payload.length === 0) return;
  const { error } = await supabase
    .from("schedule_wbs_sections")
    .upsert(payload, { onConflict: "id" });
  if (error) throw new Error(error.message);
}

async function syncReciprocalScheduleActivityLogic(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  beforeActivity: ScheduleActivityRow,
  afterActivity: ScheduleActivityRow,
) {
  const { data: activityRows, error: activityRowsError } = await supabase
    .from("schedule_activities")
    .select("*")
    .eq("project_id", projectId);
  if (activityRowsError) throw new Error(activityRowsError.message);
  const reciprocalPatches = buildReciprocalActivityLogicPatches(
    beforeActivity,
    afterActivity,
    ((activityRows ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      normalizeScheduleActivity(row),
    ),
  );
  if (reciprocalPatches.length === 0) return;

  const reciprocalResults = await Promise.all(
    reciprocalPatches.map((patch) =>
      supabase
        .from("schedule_activities")
        .update({
          predecessor_activity_ids: patch.predecessor_activity_ids,
          successor_activity_ids: patch.successor_activity_ids,
        })
        .eq("id", patch.id)
        .eq("project_id", projectId),
    ),
  );
  const reciprocalError = reciprocalResults.find((result) => result.error)?.error;
  if (reciprocalError) throw new Error(reciprocalError.message);
}

export const createScheduleWbsSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; name: string; parentId?: string | null }) =>
    z
      .object({
        projectId: z.string().uuid(),
        name: z.string().min(1).max(120),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const mode = await getScheduleWbsPersistenceMode(context.supabase, data.projectId);
    if (mode === "migration_required") {
      throw new Error(
        "Use activity WBS fields for now. The grid still groups by each activity WBS path.",
      );
    }
    if (mode === "path_fallback") {
      let sectionPath = data.name;
      if (data.parentId) {
        const parentContext = await getScheduleWbsPathContext(
          context.supabase,
          data.projectId,
          data.parentId,
        );
        sectionPath = joinScheduleWbsPath([...splitScheduleWbsPath(parentContext.path), data.name]);
      }
      await ensureScheduleWbsPath(context.supabase, data.projectId, sectionPath);
      return { ok: true };
    }

    await ensureScheduleWbsSection(
      context.supabase,
      data.projectId,
      data.name,
      data.parentId ?? null,
    );
    return { ok: true };
  });

export const renameScheduleWbsSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; name: string }) =>
    z.object({ id: z.string().uuid(), name: z.string().min(1).max(120) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: section, error: sectionError } = await context.supabase
      .from("schedule_wbs_sections")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sectionError) throw new Error(sectionError.message);
    const sectionRecord = section as unknown as Record<string, unknown>;
    const oldName = str(sectionRecord.name, "General");
    const projectId = sectionRecord.project_id as string;
    const mode = await getScheduleWbsPersistenceMode(context.supabase, projectId);
    if (mode === "path_fallback") {
      const pathContext = await getScheduleWbsPathContext(context.supabase, projectId, data.id);
      const oldPath = pathContext.path;
      const parentPath = joinScheduleWbsPath(splitScheduleWbsPath(oldPath).slice(0, -1));
      const newPath =
        splitScheduleWbsPath(oldPath).length > 1
          ? joinScheduleWbsPath([...splitScheduleWbsPath(parentPath), data.name])
          : data.name;
      await syncPathBasedWbsSectionNamesForPathChange(
        context.supabase,
        projectId,
        oldPath,
        newPath,
      );
      await syncActivityDivisionsForWbsPathChange(context.supabase, projectId, oldPath, newPath);
      return { ok: true };
    }

    const { error: updateError } = await context.supabase
      .from("schedule_wbs_sections")
      .update({ name: data.name })
      .eq("id", data.id);
    if (updateError) throw new Error(updateError.message);

    const { data: sectionRows } = await context.supabase
      .from("schedule_wbs_sections")
      .select("*")
      .eq("project_id", projectId);
    const pathMaps = buildPersistedWbsPathMaps(
      (sectionRows ?? []) as unknown as Array<Record<string, unknown>>,
      data.id,
      oldName,
    );
    const oldPath = pathMaps.previous.get(data.id) ?? oldName;
    const newPath = pathMaps.current.get(data.id) ?? data.name;
    await syncActivityDivisionsForWbsPathChange(context.supabase, projectId, oldPath, newPath);

    return { ok: true };
  });

export const moveScheduleWbsSectionParent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; parentId?: string | null }) =>
    z
      .object({
        id: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const nextParentId = data.parentId ?? null;
    if (nextParentId === data.id) throw new Error("A WBS section cannot be its own parent.");

    const { data: sectionRow, error: sectionError } = await context.supabase
      .from("schedule_wbs_sections")
      .select("*")
      .eq("id", data.id)
      .single();
    if (sectionError) throw new Error(sectionError.message);
    const section = normalizeScheduleWbsSection(sectionRow as unknown as Record<string, unknown>);
    if ((section.parent_id ?? null) === nextParentId) return { ok: true };

    const mode = await getScheduleWbsPersistenceMode(context.supabase, section.project_id);
    const { data: allRows, error: allRowsError } = await context.supabase
      .from("schedule_wbs_sections")
      .select("*")
      .eq("project_id", section.project_id);
    if (allRowsError) throw new Error(allRowsError.message);
    const sections = ((allRows ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      normalizeScheduleWbsSection(row),
    );
    const previousPaths = buildWbsSectionPathMap(sections);
    if (mode === "path_fallback") {
      const oldPath = joinScheduleWbsPath(
        splitScheduleWbsPath(previousPaths.get(section.id) ?? section.name),
      );
      const oldPathParts = splitScheduleWbsPath(oldPath);
      const title = oldPathParts[oldPathParts.length - 1] ?? section.name;
      const nextParentPath = nextParentId
        ? joinScheduleWbsPath(splitScheduleWbsPath(previousPaths.get(nextParentId) ?? ""))
        : null;
      if (nextParentId && !previousPaths.has(nextParentId)) {
        throw new Error("Choose a WBS parent from this project.");
      }
      if (
        nextParentPath &&
        (nextParentPath === oldPath || nextParentPath.startsWith(`${oldPath}${WBS_PATH_SEPARATOR}`))
      ) {
        throw new Error("A WBS section cannot be moved under one of its child sections.");
      }
      const newPath = nextParentPath
        ? joinScheduleWbsPath([...splitScheduleWbsPath(nextParentPath), title])
        : title;
      const siblingRows = sections.filter((item) => {
        if (item.id === section.id) return false;
        const path = joinScheduleWbsPath(
          splitScheduleWbsPath(previousPaths.get(item.id) ?? item.name),
        );
        const parentPath = splitScheduleWbsPath(path).slice(0, -1);
        const normalizedParentPath = parentPath.length ? joinScheduleWbsPath(parentPath) : null;
        return normalizedParentPath === nextParentPath;
      });
      const sortOrder = Math.max(0, ...siblingRows.map((item) => item.sort_order)) + 10;
      await syncPathBasedWbsSectionNamesForPathChange(
        context.supabase,
        section.project_id,
        oldPath,
        newPath,
      );
      const { error: sortOrderError } = await context.supabase
        .from("schedule_wbs_sections")
        .update({ sort_order: sortOrder })
        .eq("id", section.id)
        .eq("project_id", section.project_id);
      if (sortOrderError) throw new Error(sortOrderError.message);
      await syncActivityDivisionsForWbsPathChange(
        context.supabase,
        section.project_id,
        oldPath,
        newPath,
      );
      return { ok: true };
    }

    if (nextParentId) {
      const parent = sections.find((item) => item.id === nextParentId);
      if (!parent) throw new Error("Choose a WBS parent from this project.");
      if (parent.project_id !== section.project_id) {
        throw new Error("WBS sections can only move within the same project.");
      }
      if (isDescendantWbsSection(sections, section.id, nextParentId)) {
        throw new Error("A WBS section cannot be moved under one of its child sections.");
      }
    }

    let siblingQuery = context.supabase
      .from("schedule_wbs_sections")
      .select("sort_order")
      .eq("project_id", section.project_id);
    siblingQuery = scheduleWbsParentFilter(siblingQuery, nextParentId);
    const { data: lastSibling, error: lastSiblingError } = await siblingQuery
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastSiblingError) throw new Error(lastSiblingError.message);

    const sortOrder = ((lastSibling as { sort_order?: number } | null)?.sort_order ?? 0) + 10;
    const updatePayload: ScheduleWbsSectionUpdate = {
      parent_id: nextParentId,
      sort_order: sortOrder,
    };
    const { error: updateError } = await context.supabase
      .from("schedule_wbs_sections")
      .update(updatePayload)
      .eq("id", section.id)
      .eq("project_id", section.project_id);
    if (updateError) throw new Error(updateError.message);

    const nextSections = sections.map((item) =>
      item.id === section.id ? { ...item, parent_id: nextParentId, sort_order: sortOrder } : item,
    );
    const currentPaths = buildWbsSectionPathMap(nextSections);
    await syncActivityDivisionsForWbsPathChange(
      context.supabase,
      section.project_id,
      previousPaths.get(section.id) ?? section.name,
      currentPaths.get(section.id) ?? section.name,
    );

    return { ok: true };
  });

export const reorderScheduleWbsSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; parentId?: string | null; orderedIds: string[] }) =>
    z
      .object({
        projectId: z.string().uuid(),
        parentId: z.string().uuid().nullable().optional(),
        orderedIds: z.array(z.string().uuid()).min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const parentId = data.parentId ?? null;
    const reorderRpc = await context.supabase.rpc("reorder_schedule_wbs_sections", {
      p_project_id: data.projectId,
      p_parent_id: parentId,
      p_ordered_ids: data.orderedIds,
    });
    if (!reorderRpc.error) {
      return { ok: true, changed: num(reorderRpc.data), method: "rpc" };
    }
    if (!isMissingRpcError(reorderRpc.error, "reorder_schedule_wbs_sections")) {
      throw new Error(reorderRpc.error.message ?? "WBS order did not save.");
    }

    let canPersistParentId = true;
    let siblingQuery = context.supabase
      .from("schedule_wbs_sections")
      .select("id,parent_id,sort_order,name")
      .eq("project_id", data.projectId)
      .in("id", data.orderedIds);
    siblingQuery = scheduleWbsParentFilter(siblingQuery, parentId);
    let { data: siblingRows, error: siblingError } = await siblingQuery;
    if (siblingError && isMissingRestColumn(siblingError, "parent_id")) {
      canPersistParentId = false;
      const fallback = await context.supabase
        .from("schedule_wbs_sections")
        .select("id,sort_order,name")
        .eq("project_id", data.projectId)
        .in("id", data.orderedIds);
      siblingRows = fallback.data as typeof siblingRows;
      siblingError = fallback.error;
    }
    if (siblingError) throw new Error(siblingError.message);
    if ((siblingRows ?? []).length !== data.orderedIds.length) {
      throw new Error("WBS order can only be saved for sections under the same parent.");
    }

    const persistedRows = (siblingRows ?? []) as unknown as Array<Record<string, unknown>>;
    const rowsById = new Map(persistedRows.map((row) => [row.id as string, row]));
    const currentOrder = new Map(
      persistedRows.map((row) => [row.id as string, num(row.sort_order)]),
    );
    const changedRows = data.orderedIds
      .map((id, index) => {
        const row = rowsById.get(id);
        return {
          id,
          name: str(row?.name, "WBS Section"),
          sort_order: (index + 1) * 10,
        };
      })
      .filter((row) => currentOrder.get(row.id) !== row.sort_order);
    if (changedRows.length === 0) return { ok: true, changed: 0 };

    const payload = changedRows.map((row) => {
      const item: ScheduleWbsSectionInsert = {
        id: row.id,
        project_id: data.projectId,
        name: row.name,
        sort_order: row.sort_order,
      };
      if (canPersistParentId) item.parent_id = parentId;
      return item;
    });
    const { error } = await context.supabase
      .from("schedule_wbs_sections")
      .upsert(payload, { onConflict: "id" });
    if (error) throw new Error(error.message);
    return { ok: true, changed: changedRows.length, method: "batch" };
  });

// ---------- DELAY FRAGMENTS ----------
const delayFragmentPatch = z.object({
  schedule_activity_id: z.string().uuid().nullable().optional(),
  activity_id: z.string().max(50).optional(),
  title: z.string().min(1).max(200).optional(),
  reason: z.string().max(2000).optional(),
  delay_days: z.number().int().min(0).max(365).optional(),
  source: z.enum(DELAY_FRAGMENT_SOURCES).optional(),
  status: z.enum(DELAY_FRAGMENT_STATUSES).optional(),
  owner: z.string().max(200).optional(),
  identified_on: z.string().min(1).optional(),
  resolved_on: z.string().nullable().optional(),
});

export const createScheduleDelayFragment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { projectId: string; title: string } & Partial<z.input<typeof delayFragmentPatch>>) =>
      z
        .object({
          projectId: z.string().uuid(),
          title: z.string().min(1).max(200),
        })
        .merge(delayFragmentPatch.omit({ title: true }).partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const payload = {
      project_id: projectId,
      schedule_activity_id: rest.schedule_activity_id ?? null,
      activity_id: rest.activity_id ?? "",
      title: rest.title,
      reason: rest.reason ?? "",
      delay_days: rest.delay_days ?? 0,
      source: rest.source ?? "field",
      status: rest.status ?? "active",
      owner: rest.owner ?? "",
      identified_on: rest.identified_on ?? new Date().toISOString().slice(0, 10),
      resolved_on: rest.resolved_on ?? null,
    };
    const { data: row, error } = await context.supabase
      .from("schedule_delay_fragments")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true,
      delayFragment: normalizeScheduleDelayFragment(row as unknown as Record<string, unknown>),
    };
  });

export const updateScheduleDelayFragment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof delayFragmentPatch> }) =>
    z.object({ id: z.string().uuid(), patch: delayFragmentPatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_delay_fragments")
      .update(data.patch as ScheduleDelayFragmentUpdate)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScheduleDelayFragment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_delay_fragments")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
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
    const wbsSectionId = await ensureScheduleWbsPath(
      context.supabase,
      projectId,
      rest.division || "General",
    );
    const { data: last } = await context.supabase
      .from("schedule_activities")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder =
      rest.sort_order ?? ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
    const activityId = rest.activity_id || `A-${String(sortOrder).padStart(3, "0")}`;
    const basePayload: ScheduleActivityInsert = {
      project_id: projectId,
      ...rest,
      activity_id: activityId,
      sort_order: sortOrder,
    };
    const insertPayload = {
      ...basePayload,
      wbs_section_id: wbsSectionId,
    };
    let { data: createdRow, error } = await context.supabase
      .from("schedule_activities")
      .insert(insertPayload)
      .select("*")
      .single();
    if (
      error &&
      (isMissingRestColumn(error, "wbs_section_id") || isMissingScheduleActivityStatusColumn(error))
    ) {
      const fallbackPayload = stripScheduleActivityMissingColumns(insertPayload, error);
      ({ data: createdRow, error } = await context.supabase
        .from("schedule_activities")
        .insert(fallbackPayload as ScheduleActivityInsert)
        .select("*")
        .single());
    }
    if (error) throw new Error(error.message);
    const createdActivity = normalizeScheduleActivity(
      createdRow as unknown as Record<string, unknown>,
    );
    await syncReciprocalScheduleActivityLogic(
      context.supabase,
      projectId,
      {
        ...createdActivity,
        activity_id: "",
        predecessor_activity_ids: [],
        successor_activity_ids: [],
      },
      createdActivity,
    );
    return { ok: true };
  });

export const updateScheduleActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof activityPatch> }) =>
    z.object({ id: z.string().uuid(), patch: activityPatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: beforeRow, error: beforeError } = await context.supabase
      .from("schedule_activities")
      .select("*")
      .eq("id", data.id)
      .single();
    if (beforeError) throw new Error(beforeError.message);
    const beforeActivity = normalizeScheduleActivity(
      beforeRow as unknown as Record<string, unknown>,
    );

    let { error } = await context.supabase
      .from("schedule_activities")
      .update(data.patch as ScheduleActivityUpdate)
      .eq("id", data.id);
    if (error && isMissingScheduleActivityStatusColumn(error)) {
      const fallbackPatch = stripScheduleActivityStatusColumns(
        data.patch as Record<string, unknown>,
      );
      if (Object.keys(fallbackPatch).length === 0) {
        throw new Error("Schedule status fields need the database update before they can save.");
      }
      ({ error } = await context.supabase
        .from("schedule_activities")
        .update(fallbackPatch as ScheduleActivityUpdate)
        .eq("id", data.id));
    }
    if (error) throw new Error(error.message);

    const shouldSyncLogic =
      "activity_id" in data.patch ||
      "predecessor_activity_ids" in data.patch ||
      "successor_activity_ids" in data.patch;
    let afterActivity = beforeActivity;
    if ("division" in data.patch || shouldSyncLogic) {
      const { data: afterRow, error: afterError } = await context.supabase
        .from("schedule_activities")
        .select("*")
        .eq("id", data.id)
        .single();
      if (afterError) throw new Error(afterError.message);
      afterActivity = normalizeScheduleActivity(afterRow as unknown as Record<string, unknown>);
    }

    if ("division" in data.patch) {
      const wbsSectionId = await ensureScheduleWbsPath(
        context.supabase,
        afterActivity.project_id,
        afterActivity.division || "General",
      );
      const { error: wbsLinkError } = await context.supabase
        .from("schedule_activities")
        .update({ wbs_section_id: wbsSectionId })
        .eq("id", data.id);
      if (wbsLinkError && !isMissingRestColumn(wbsLinkError, "wbs_section_id")) {
        throw new Error(wbsLinkError.message);
      }
    }

    if (shouldSyncLogic) {
      await syncReciprocalScheduleActivityLogic(
        context.supabase,
        afterActivity.project_id,
        beforeActivity,
        afterActivity,
      );
    }

    return { ok: true };
  });

export const deleteScheduleActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: beforeRow, error: beforeError } = await context.supabase
      .from("schedule_activities")
      .select("*")
      .eq("id", data.id)
      .single();
    if (beforeError) throw new Error(beforeError.message);
    const beforeActivity = normalizeScheduleActivity(
      beforeRow as unknown as Record<string, unknown>,
    );

    const { error } = await context.supabase.from("schedule_activities").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    await syncReciprocalScheduleActivityLogic(
      context.supabase,
      beforeActivity.project_id,
      beforeActivity,
      {
        ...beforeActivity,
        activity_id: "",
        predecessor_activity_ids: [],
        successor_activity_ids: [],
      },
    );
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
