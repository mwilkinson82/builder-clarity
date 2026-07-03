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
import {
  buildReciprocalActivityLogicPatches,
  type ConstructLineStatusBasis,
} from "@/lib/constructline-cpm";
import {
  buildActivityUpdateSnapshotRows,
  buildMilestoneUpdateSnapshotRows,
  buildScheduleUpdateRecord,
  resolveScheduleUpdateWriteMode,
} from "@/lib/schedule-update-spine";

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

export type ScheduleWbsPersistence = "ready";

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

export interface ScheduleActivityUpdateRow {
  id: string;
  project_id: string;
  schedule_update_id: string;
  schedule_activity_id: string | null;
  update_number: number;
  data_date: string;
  activity_id: string;
  name: string;
  division: string;
  wbs_section_id: string | null;
  baseline_start_date: string | null;
  baseline_finish_date: string | null;
  current_start_date: string | null;
  current_finish_date: string | null;
  actual_start_date: string | null;
  actual_finish_date: string | null;
  planned_duration_days: number;
  remaining_duration_days: number;
  status_basis: ConstructLineStatusBasis;
  percent_complete: number;
  total_float_days: number;
  free_float_days: number;
  slippage_days: number;
  is_critical: boolean;
  is_near_critical: boolean;
  is_late: boolean;
  is_out_of_sequence: boolean;
  is_open_start: boolean;
  is_open_finish: boolean;
  is_milestone: boolean;
  predecessor_activity_ids: string[];
  successor_activity_ids: string[];
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
const SCHEDULE_ACTIVITY_STATUS_COLUMNS = [
  "baseline_start_date",
  "baseline_finish_date",
  "forecast_start_date",
  "forecast_finish_date",
  "actual_start_date",
  "actual_finish_date",
  "remaining_duration_days",
] as const;
type ScheduleActivityStatusColumn = (typeof SCHEDULE_ACTIVITY_STATUS_COLUMNS)[number];
type ScheduleActivityStatusFallback = Partial<
  Record<ScheduleActivityStatusColumn, string | number | null>
>;
const SCHEDULE_ACTIVITY_STATUS_NOTE_RE =
  /\n{0,2}<!-- constructline:activity-status-v1 ([\s\S]*?) -->/;
const SCHEDULE_ACTIVITY_NOTES_MAX_LENGTH = 4000;
const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);
const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    message.includes(`'${target}' column`) ||
    message.includes(`"${target}" column`) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`${target} column does not exist`) ||
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

function normalizeScheduleActivityStatusFallbackValue(
  column: ScheduleActivityStatusColumn,
  value: unknown,
) {
  if (value == null || value === "") return null;
  if (column === "remaining_duration_days") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

function normalizeScheduleActivityStatusFallback(value: unknown): ScheduleActivityStatusFallback {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  return SCHEDULE_ACTIVITY_STATUS_COLUMNS.reduce<ScheduleActivityStatusFallback>(
    (fallback, column) => {
      if (!(column in input)) return fallback;
      const normalized = normalizeScheduleActivityStatusFallbackValue(column, input[column]);
      if (normalized !== undefined) fallback[column] = normalized;
      return fallback;
    },
    {},
  );
}

function readScheduleActivityStatusFallback(notesValue: unknown): {
  notes: string;
  status: ScheduleActivityStatusFallback;
} {
  const notes = str(notesValue);
  const match = notes.match(SCHEDULE_ACTIVITY_STATUS_NOTE_RE);
  if (!match) return { notes, status: {} };

  let status: ScheduleActivityStatusFallback = {};
  try {
    status = normalizeScheduleActivityStatusFallback(JSON.parse(match[1] ?? "{}"));
  } catch {
    status = {};
  }

  return {
    notes: notes.replace(SCHEDULE_ACTIVITY_STATUS_NOTE_RE, "").trimEnd(),
    status,
  };
}

function buildScheduleActivityStatusFallbackPatch(payload: Record<string, unknown>) {
  return SCHEDULE_ACTIVITY_STATUS_COLUMNS.reduce<ScheduleActivityStatusFallback>(
    (fallback, column) => {
      if (!(column in payload)) return fallback;
      const normalized = normalizeScheduleActivityStatusFallbackValue(column, payload[column]);
      if (normalized !== undefined) fallback[column] = normalized;
      return fallback;
    },
    {},
  );
}

function writeScheduleActivityStatusFallback(
  notesValue: unknown,
  payload: Record<string, unknown>,
) {
  const { notes, status: currentStatus } = readScheduleActivityStatusFallback(notesValue);
  const nextStatus = {
    ...currentStatus,
    ...buildScheduleActivityStatusFallbackPatch(payload),
  };
  const marker = `<!-- constructline:activity-status-v1 ${JSON.stringify(nextStatus)} -->`;
  if (Object.keys(nextStatus).length === 0) return notes;

  const trimmedNotes = notes.trimEnd();
  const combined = trimmedNotes ? `${trimmedNotes}\n\n${marker}` : marker;
  if (combined.length <= SCHEDULE_ACTIVITY_NOTES_MAX_LENGTH) return combined;

  const maxNotesLength = Math.max(0, SCHEDULE_ACTIVITY_NOTES_MAX_LENGTH - marker.length - 2);
  const clippedNotes = trimmedNotes.slice(0, maxNotesLength).trimEnd();
  return clippedNotes ? `${clippedNotes}\n\n${marker}` : marker;
}

function getScheduleActivityStatusFallbackDate(
  row: Record<string, unknown>,
  fallback: ScheduleActivityStatusFallback,
  column: Exclude<ScheduleActivityStatusColumn, "remaining_duration_days">,
) {
  const value = row[column] ?? fallback[column] ?? null;
  return typeof value === "string" ? value : null;
}

function getScheduleActivityStatusFallbackDuration(
  row: Record<string, unknown>,
  fallback: ScheduleActivityStatusFallback,
) {
  const value = row.remaining_duration_days ?? fallback.remaining_duration_days ?? null;
  if (value == null || value === "") return null;
  return Math.max(0, Math.round(num(value)));
}

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

const ACTIVITY_UPDATE_STATUS_BASIS = new Set<ConstructLineStatusBasis>([
  "actual",
  "remaining_duration",
  "expected_finish",
  "planned_dates",
  "needs_update",
]);

function normalizeActivityUpdateStatusBasis(value: unknown): ConstructLineStatusBasis {
  const normalized = str(value, "planned_dates") as ConstructLineStatusBasis;
  return ACTIVITY_UPDATE_STATUS_BASIS.has(normalized) ? normalized : "planned_dates";
}

const normalizeScheduleActivityUpdate = (
  r: Record<string, unknown>,
): ScheduleActivityUpdateRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  schedule_update_id: r.schedule_update_id as string,
  schedule_activity_id: (r.schedule_activity_id as string | null) ?? null,
  update_number: num(r.update_number),
  data_date: str(r.data_date),
  activity_id: str(r.activity_id),
  name: str(r.name),
  division: str(r.division, "General"),
  wbs_section_id: (r.wbs_section_id as string | null) ?? null,
  baseline_start_date: (r.baseline_start_date as string | null) ?? null,
  baseline_finish_date: (r.baseline_finish_date as string | null) ?? null,
  current_start_date: (r.current_start_date as string | null) ?? null,
  current_finish_date: (r.current_finish_date as string | null) ?? null,
  actual_start_date: (r.actual_start_date as string | null) ?? null,
  actual_finish_date: (r.actual_finish_date as string | null) ?? null,
  planned_duration_days: Math.max(0, Math.round(num(r.planned_duration_days))),
  remaining_duration_days: Math.max(0, Math.round(num(r.remaining_duration_days))),
  status_basis: normalizeActivityUpdateStatusBasis(r.status_basis),
  percent_complete: num(r.percent_complete),
  total_float_days: Math.round(num(r.total_float_days)),
  free_float_days: Math.round(num(r.free_float_days)),
  slippage_days: Math.round(num(r.slippage_days)),
  is_critical: Boolean(r.is_critical),
  is_near_critical: Boolean(r.is_near_critical),
  is_late: Boolean(r.is_late),
  is_out_of_sequence: Boolean(r.is_out_of_sequence),
  is_open_start: Boolean(r.is_open_start),
  is_open_finish: Boolean(r.is_open_finish),
  is_milestone: Boolean(r.is_milestone),
  predecessor_activity_ids: Array.isArray(r.predecessor_activity_ids)
    ? r.predecessor_activity_ids.map(String)
    : [],
  successor_activity_ids: Array.isArray(r.successor_activity_ids)
    ? r.successor_activity_ids.map(String)
    : [],
  notes: str(r.notes),
});

const normalizeScheduleActivity = (r: Record<string, unknown>): ScheduleActivityRow => {
  const fallback = readScheduleActivityStatusFallback(r.notes);
  const startDate = (r.start_date as string | null) ?? null;
  const finishDate = (r.finish_date as string | null) ?? null;
  return {
    id: r.id as string,
    project_id: r.project_id as string,
    activity_id: str(r.activity_id),
    name: str(r.name),
    division: str(r.division, "General"),
    wbs_section_id: (r.wbs_section_id as string | null) ?? null,
    start_date: startDate,
    finish_date: finishDate,
    baseline_start_date:
      getScheduleActivityStatusFallbackDate(r, fallback.status, "baseline_start_date") ?? startDate,
    baseline_finish_date:
      getScheduleActivityStatusFallbackDate(r, fallback.status, "baseline_finish_date") ??
      finishDate,
    forecast_start_date:
      getScheduleActivityStatusFallbackDate(r, fallback.status, "forecast_start_date") ?? startDate,
    forecast_finish_date:
      getScheduleActivityStatusFallbackDate(r, fallback.status, "forecast_finish_date") ??
      finishDate,
    actual_start_date: getScheduleActivityStatusFallbackDate(
      r,
      fallback.status,
      "actual_start_date",
    ),
    actual_finish_date: getScheduleActivityStatusFallbackDate(
      r,
      fallback.status,
      "actual_finish_date",
    ),
    remaining_duration_days: getScheduleActivityStatusFallbackDuration(r, fallback.status),
    percent_complete: num(r.percent_complete),
    predecessor_activity_ids: Array.isArray(r.predecessor_activity_ids)
      ? r.predecessor_activity_ids.map(String)
      : [],
    successor_activity_ids: Array.isArray(r.successor_activity_ids)
      ? r.successor_activity_ids.map(String)
      : [],
    notes: fallback.notes,
    sort_order: num(r.sort_order),
  };
};

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
    const [mRes, rRes, aRes, wRes, dRes] = await Promise.all([
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
        .from("schedule_delay_fragments")
        .select("*")
        .eq("project_id", data.projectId)
        .order("identified_on", { ascending: false })
        .order("created_at", { ascending: false }),
    ]);
    const [uRes, muRes, auRes] = await Promise.all([
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
      context.supabase
        .from("schedule_activity_updates")
        .select("*")
        .eq("project_id", data.projectId)
        .order("update_number", { ascending: false })
        .order("activity_id"),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);
    if (aRes.error) throw new Error(aRes.error.message);
    if (wRes.error) throw new Error(wRes.error.message);
    if (dRes.error) throw new Error(dRes.error.message);
    if (uRes.error) throw new Error(uRes.error.message);
    if (muRes.error) throw new Error(muRes.error.message);
    if (auRes.error) throw new Error(auRes.error.message);

    let activityRows = (aRes.data ?? []) as unknown as Array<Record<string, unknown>>;
    const hasHarborDemoCpmRows = activityRows.some((row) => row.activity_id === "01-010");
    if (!hasHarborDemoCpmRows) {
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
    let persistedWbsRows = (wRes.data ?? []) as unknown as Array<Record<string, unknown>>;
    if (persistedWbsRows.length === 0 && derivedWbsSections.length > 0) {
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
      persistedWbsRows.length === 0
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
      activities: activityRows.map((r) => normalizeScheduleActivity(r)),
      wbsSections: wbsSectionRows,
      delayFragments: (dRes.data ?? []).map((r) =>
        normalizeScheduleDelayFragment(r as unknown as Record<string, unknown>),
      ),
      risks,
      updates: (uRes.data ?? []).map((r) => normalizeScheduleUpdate(r as Record<string, unknown>)),
      milestoneUpdates: (muRes.data ?? []).map((r) =>
        normalizeMilestoneUpdate(r as Record<string, unknown>),
      ),
      activityUpdates: (auRes.data ?? []).map((r) =>
        normalizeScheduleActivityUpdate(r as Record<string, unknown>),
      ),
    };
  });

// ---------- CPM TEMPLATES ----------
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

async function snapshotScheduleActivityUpdates(
  supabase: ScheduleSupabaseClient,
  projectId: string,
  scheduleUpdateId: string,
  updateNumber: number,
  dataDate: string,
) {
  const { data: activityRows, error: activityError } = await supabase
    .from("schedule_activities")
    .select("*")
    .eq("project_id", projectId);
  if (activityError) throw new Error(activityError.message);

  const activities = (activityRows ?? []).map((row) =>
    normalizeScheduleActivity(row as Record<string, unknown>),
  );
  const snapshots = buildActivityUpdateSnapshotRows(activities, {
    projectId,
    scheduleUpdateId,
    updateNumber,
    dataDate,
  });
  if (snapshots.length === 0) return 0;

  const { error: snapshotError } = await supabase
    .from("schedule_activity_updates")
    .insert(snapshots);
  if (snapshotError) {
    throw new Error(snapshotError.message ?? "Activity update snapshots did not save.");
  }
  return snapshots.length;
}

export const listScheduleCpmTemplates = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId?: string } | undefined) =>
    z.object({ projectId: z.string().uuid().optional() }).parse(input ?? {}),
  )
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("schedule_cpm_templates")
      .select("id,project_id,name,description,activity_count,created_at,updated_at")
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message ?? "CPM template library did not load.");
    return {
      templates: ((data ?? []) as unknown as Record<string, unknown>[]).map(
        normalizeScheduleCpmTemplate,
      ),
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
    if (wbsRes.error) throw new Error(wbsRes.error.message);
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
    const { data: inserted, error } = await context.supabase
      .from("schedule_cpm_templates")
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
    if (error) throw new Error(error.message ?? "CPM template did not save.");
    return { ok: true, id: str(inserted?.id) };
  });

export const importScheduleCpmTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; templateId: string }) =>
    z.object({ projectId: z.string().uuid(), templateId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const templateRes = await context.supabase
      .from("schedule_cpm_templates")
      .select("*")
      .eq("id", data.templateId)
      .maybeSingle();
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

    const error = await insertScheduleActivityRowsWithSchemaFallback(context.supabase, rowsWithWbs);
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
  replace_existing: z.boolean().default(false),
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

    const dataDate = data.data_date ?? data.update_date ?? new Date().toISOString().slice(0, 10);

    // One update per data date: a second save on the same data date amends the
    // existing update (after the client confirms), never silently duplicates.
    const { data: existingForDataDate, error: existingError } = await context.supabase
      .from("schedule_updates")
      .select("id, update_number")
      .eq("project_id", data.projectId)
      .eq("data_date", dataDate)
      .order("update_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    const writeMode = resolveScheduleUpdateWriteMode({
      existingUpdateNumber: (existingForDataDate?.update_number as number | undefined) ?? null,
      replaceExisting: data.replace_existing,
    });
    if (writeMode === "duplicate_blocked") {
      return {
        ok: false as const,
        duplicate: {
          update_number: existingForDataDate?.update_number as number,
          data_date: dataDate,
        },
      };
    }

    const previousUpdateQuery = context.supabase
      .from("schedule_updates")
      .select("update_number, forecast_completion_date")
      .eq("project_id", data.projectId)
      .order("update_number", { ascending: false })
      .limit(1);
    const { data: previousUpdate } =
      writeMode === "amend"
        ? await previousUpdateQuery
            .lt("update_number", existingForDataDate?.update_number as number)
            .maybeSingle()
        : await previousUpdateQuery.maybeSingle();

    const baseline = (project.baseline_completion_date as string | null) ?? null;
    const updateNumber =
      writeMode === "amend"
        ? (existingForDataDate?.update_number as number)
        : ((previousUpdate?.update_number as number | undefined) ?? 0) + 1;
    const updatePayload = buildScheduleUpdateRecord({
      projectId: data.projectId,
      updateNumber,
      dataDate,
      baselineCompletionDate: baseline,
      previousCompletionDate:
        (previousUpdate?.forecast_completion_date as string | null) ??
        (project.forecast_completion_date as string | null) ??
        null,
      forecastCompletionDate: data.forecast_completion_date,
      scheduleMoneyExposure: data.schedule_money_exposure,
      scheduleMoneyRecovery: data.schedule_money_recovery,
      moneyNotes: data.money_notes,
      notes: data.notes,
    }) as ScheduleUpdateInsert;
    const varianceWeeks = updatePayload.variance_weeks ?? 0;

    let update: Record<string, unknown> | null = null;
    if (writeMode === "amend") {
      const existingId = existingForDataDate?.id as string;
      const { data: amended, error: amendError } = await context.supabase
        .from("schedule_updates")
        .update(updatePayload)
        .eq("id", existingId)
        .eq("project_id", data.projectId)
        .select("*")
        .single();
      if (amendError) throw new Error(amendError.message);
      update = amended as Record<string, unknown>;
      // The amended update re-snapshots below; drop the superseded rows first.
      const { error: milestoneCleanupError } = await context.supabase
        .from("schedule_milestone_updates")
        .delete()
        .eq("schedule_update_id", existingId);
      if (milestoneCleanupError) throw new Error(milestoneCleanupError.message);
      const { error: activityCleanupError } = await context.supabase
        .from("schedule_activity_updates")
        .delete()
        .eq("schedule_update_id", existingId);
      if (activityCleanupError) throw new Error(activityCleanupError.message);
    } else {
      const { data: inserted, error: insertError } = await context.supabase
        .from("schedule_updates")
        .insert(updatePayload)
        .select("*")
        .single();
      if (insertError) throw new Error(insertError.message);
      update = inserted as Record<string, unknown>;
    }
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
    const milestoneSnapshots = buildMilestoneUpdateSnapshotRows(
      (milestones ?? []) as unknown as MilestoneRow[],
      {
        projectId: data.projectId,
        scheduleUpdateId: update.id as string,
        updateNumber,
        dataDate,
      },
    );
    if (milestoneSnapshots.length > 0) {
      const { error: snapshotError } = await context.supabase
        .from("schedule_milestone_updates")
        .insert(milestoneSnapshots);
      if (snapshotError) throw new Error(snapshotError.message);
    }

    const activitySnapshotCount = await snapshotScheduleActivityUpdates(
      context.supabase,
      data.projectId,
      update.id as string,
      updateNumber,
      dataDate,
    );

    return {
      ok: true as const,
      amended: writeMode === "amend",
      activitySnapshotCount,
      milestoneSnapshotCount: milestoneSnapshots.length,
      update: normalizeScheduleUpdate(update as Record<string, unknown>),
    };
  });

const annotateScheduleUpdateInput = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  notes: z.string().max(4000).optional(),
  schedule_money_exposure: z.number().min(0).optional(),
  schedule_money_recovery: z.number().min(0).optional(),
  money_notes: z.string().max(4000).optional(),
});

// The IOR Schedule tab consumes the latest CPM update: it annotates the saved
// record with narrative and money fields; it never authors a competing update.
export const annotateScheduleUpdate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof annotateScheduleUpdateInput>) =>
    annotateScheduleUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, projectId } = data;
    const cleanPatch: TablesUpdate<"schedule_updates"> = {};
    if (data.notes !== undefined) cleanPatch.notes = data.notes;
    if (data.schedule_money_exposure !== undefined) {
      cleanPatch.schedule_money_exposure = data.schedule_money_exposure;
    }
    if (data.schedule_money_recovery !== undefined) {
      cleanPatch.schedule_money_recovery = data.schedule_money_recovery;
    }
    if (data.money_notes !== undefined) cleanPatch.money_notes = data.money_notes;
    if (Object.keys(cleanPatch).length === 0) {
      throw new Error("Nothing to save on this schedule update.");
    }
    const { data: update, error } = await context.supabase
      .from("schedule_updates")
      .update(cleanPatch)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return {
      ok: true as const,
      update: normalizeScheduleUpdate(update as Record<string, unknown>),
    };
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

function isMissingScheduleActivityStatusColumn(error: DynamicSupabaseError) {
  return SCHEDULE_ACTIVITY_STATUS_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function stripScheduleActivityStatusColumns<T extends Record<string, unknown>>(payload: T) {
  const next = { ...payload };
  for (const column of SCHEDULE_ACTIVITY_STATUS_COLUMNS) delete next[column];
  return next;
}

function includesScheduleActivityStatusColumn(payload: Record<string, unknown>) {
  return SCHEDULE_ACTIVITY_STATUS_COLUMNS.some((column) => column in payload);
}

function isScheduleActivitySchemaFallbackError(error: DynamicSupabaseError) {
  return Boolean(
    error &&
    (isMissingRestColumn(error, "wbs_section_id") || isMissingScheduleActivityStatusColumn(error)),
  );
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

async function insertScheduleActivityRowsWithSchemaFallback(
  supabase: ScheduleSupabaseClient,
  rows: Array<Record<string, unknown>>,
) {
  let payloadRows = rows.map((row) => ({ ...row }));
  let { error } = await dynamicTable(supabase, "schedule_activities").insert(payloadRows);
  let attempts = 0;

  while (error && attempts < 3 && isScheduleActivitySchemaFallbackError(error)) {
    const shouldWriteStatusFallback = isMissingScheduleActivityStatusColumn(error);
    payloadRows = payloadRows.map((row, index) => {
      const originalRow = rows[index] ?? row;
      const fallbackRow = stripScheduleActivityMissingColumns(row, error);
      if (shouldWriteStatusFallback) {
        fallbackRow.notes = writeScheduleActivityStatusFallback(fallbackRow.notes, originalRow);
      }
      return fallbackRow;
    });
    ({ error } = await dynamicTable(supabase, "schedule_activities").insert(payloadRows));
    attempts += 1;
  }

  return error;
}

async function insertScheduleActivityRowWithSchemaFallback(
  supabase: ScheduleSupabaseClient,
  row: Record<string, unknown>,
) {
  let payload = { ...row };
  let result = await dynamicTable(supabase, "schedule_activities")
    .insert(payload)
    .select("*")
    .single();
  let attempts = 0;

  while (result.error && attempts < 3 && isScheduleActivitySchemaFallbackError(result.error)) {
    const fallbackPayload = stripScheduleActivityMissingColumns(payload, result.error);
    if (isMissingScheduleActivityStatusColumn(result.error)) {
      fallbackPayload.notes = writeScheduleActivityStatusFallback(fallbackPayload.notes, row);
    }
    payload = fallbackPayload;
    result = await dynamicTable(supabase, "schedule_activities")
      .insert(payload)
      .select("*")
      .single();
    attempts += 1;
  }

  return result;
}

async function updateScheduleActivityWithSchemaFallback(
  supabase: ScheduleSupabaseClient,
  activityId: string,
  patch: Record<string, unknown>,
  beforeNotes: string,
) {
  const requestedStatusUpdate = includesScheduleActivityStatusColumn(patch);
  let payload = { ...patch };
  let { error } = await dynamicTable(supabase, "schedule_activities")
    .update(payload)
    .eq("id", activityId);
  let attempts = 0;

  while (error && attempts < 3 && isScheduleActivitySchemaFallbackError(error)) {
    const fallbackPatch = stripScheduleActivityMissingColumns(payload, error);
    if (requestedStatusUpdate && isMissingScheduleActivityStatusColumn(error)) {
      fallbackPatch.notes = writeScheduleActivityStatusFallback(
        "notes" in patch ? patch.notes : beforeNotes,
        patch,
      );
    }
    if (Object.keys(fallbackPatch).length === 0) return null;

    payload = fallbackPatch;
    ({ error } = await dynamicTable(supabase, "schedule_activities")
      .update(payload)
      .eq("id", activityId));
    attempts += 1;
  }

  return error;
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
  const existing = await existingQuery.maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  if (existing.data?.id) return existing.data.id as string;

  let lastQuery = supabase
    .from("schedule_wbs_sections")
    .select("sort_order")
    .eq("project_id", projectId);
  lastQuery = scheduleWbsParentFilter(lastQuery, parentId);
  const { data: last, error: lastError } = await lastQuery
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw new Error(lastError.message);

  const payload = {
    project_id: projectId,
    parent_id: parentId,
    name: sectionName,
    code: "",
    sort_order: ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 10,
  } as ScheduleWbsSectionInsert;
  const { data: inserted, error: insertError } = await supabase
    .from("schedule_wbs_sections")
    .insert(payload)
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
  let parentId: string | null = null;
  for (const segment of splitScheduleWbsPath(value)) {
    parentId = await ensureScheduleWbsSection(supabase, projectId, segment, parentId);
  }
  return parentId;
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

    const { data: allRows, error: allRowsError } = await context.supabase
      .from("schedule_wbs_sections")
      .select("*")
      .eq("project_id", section.project_id);
    if (allRowsError) throw new Error(allRowsError.message);
    const sections = ((allRows ?? []) as unknown as Array<Record<string, unknown>>).map((row) =>
      normalizeScheduleWbsSection(row),
    );
    const previousPaths = buildWbsSectionPathMap(sections);

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
    const updatePayload = {
      parent_id: nextParentId,
      sort_order: sortOrder,
    } as ScheduleWbsSectionUpdate;
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
    const callRpc = context.supabase.rpc as unknown as (
      fnName: string,
      args: Record<string, unknown>,
    ) => Promise<DynamicSupabaseResult<number>>;
    const reorderRpc = await callRpc("reorder_schedule_wbs_sections", {
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

    let siblingQuery = context.supabase
      .from("schedule_wbs_sections")
      .select("id,parent_id,sort_order,name")
      .eq("project_id", data.projectId)
      .in("id", data.orderedIds);
    siblingQuery = scheduleWbsParentFilter(siblingQuery, parentId);
    const { data: siblingRows, error: siblingError } = await siblingQuery;
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
        parent_id: parentId,
      };
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
    const { wbs_section_id: requestedWbsSectionId, ...activityFields } = rest;
    const wbsSectionId =
      requestedWbsSectionId ??
      (await ensureScheduleWbsPath(
        context.supabase,
        projectId,
        activityFields.division || "General",
      ));
    const { data: last } = await context.supabase
      .from("schedule_activities")
      .select("sort_order")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sortOrder =
      activityFields.sort_order ?? ((last as { sort_order?: number } | null)?.sort_order ?? 0) + 1;
    const activityId = activityFields.activity_id || `A-${String(sortOrder).padStart(3, "0")}`;
    const basePayload: ScheduleActivityInsert = {
      project_id: projectId,
      ...activityFields,
      activity_id: activityId,
      sort_order: sortOrder,
    };
    const { data: createdRow, error } = await insertScheduleActivityRowWithSchemaFallback(
      context.supabase,
      basePayload as Record<string, unknown>,
    );
    if (error) throw new Error(error.message);
    const createdActivity = normalizeScheduleActivity(
      createdRow as unknown as Record<string, unknown>,
    );
    if (wbsSectionId) {
      const { error: wbsLinkError } = await context.supabase
        .from("schedule_activities")
        .update({ wbs_section_id: wbsSectionId })
        .eq("id", createdActivity.id);
      if (wbsLinkError) throw new Error(wbsLinkError.message);
    }
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
    const beforeNotes = str((beforeRow as unknown as Record<string, unknown>).notes);

    const error = await updateScheduleActivityWithSchemaFallback(
      context.supabase,
      data.id,
      data.patch as Record<string, unknown>,
      beforeNotes,
    );
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
      if (wbsLinkError) throw new Error(wbsLinkError.message);
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
