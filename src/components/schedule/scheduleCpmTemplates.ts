import {
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleWbsSectionRow,
} from "@/lib/schedule.functions";
import { type ProjectRow } from "@/lib/projects.functions";
import { buildWbsSectionPathMap, splitWbsPath } from "@/lib/constructline-wbs";
import {
  type ActivityCreateInput,
  BROWSER_CPM_TEMPLATE_STORAGE_KEY,
  type BrowserCpmTemplate,
  type BrowserCpmTemplateWbsSection,
} from "./scheduleShared";
import {
  milestoneActivityNotes,
  normalizeActivityName,
  uniqueActivityId,
} from "./scheduleActivityDraft";

export function groupActivitiesByDivision(activities: ScheduleActivityRow[]) {
  const groups = new Map<string, ScheduleActivityRow[]>();
  for (const activity of activities) {
    const division = activity.division || "General";
    groups.set(division, [...(groups.get(division) ?? []), activity]);
  }
  return Array.from(groups.entries()).map(([division, rows]) => ({ division, activities: rows }));
}

export function buildActivityRowsFromMilestones(
  milestones: MilestoneRow[],
  activities: ScheduleActivityRow[],
): ActivityCreateInput[] {
  const existingNames = new Set(activities.map((activity) => normalizeActivityName(activity.name)));
  const existingIds = new Set(activities.map((activity) => activity.activity_id).filter(Boolean));

  return milestones
    .map((milestone, index) => ({ milestone, index }))
    .filter(({ milestone }) => {
      const name = milestone.name.trim();
      return name && !existingNames.has(normalizeActivityName(name));
    })
    .map(({ milestone, index }) => {
      const activityId = uniqueActivityId(`MS-${String(index + 1).padStart(3, "0")}`, existingIds);
      const finishDate = milestone.forecast_date || milestone.baseline_date || null;
      return {
        activity_id: activityId,
        name: milestone.name.trim(),
        division: "Milestones",
        start_date: finishDate,
        finish_date: finishDate,
        baseline_start_date: finishDate,
        baseline_finish_date: finishDate,
        forecast_start_date: finishDate,
        forecast_finish_date: finishDate,
        actual_start_date: milestone.status === "complete" ? finishDate : null,
        actual_finish_date: milestone.status === "complete" ? finishDate : null,
        remaining_duration_days: 0,
        percent_complete: milestone.status === "complete" ? 100 : 0,
        predecessor_activity_ids: [],
        successor_activity_ids: [],
        notes: milestoneActivityNotes(milestone),
      };
    });
}

function scheduleActivityToTemplateCreateInput(activity: ScheduleActivityRow): ActivityCreateInput {
  return {
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
    percent_complete: 0,
    predecessor_activity_ids: activity.predecessor_activity_ids,
    successor_activity_ids: activity.successor_activity_ids,
    notes: activity.notes,
    sort_order: activity.sort_order,
  };
}

export function buildBrowserCpmTemplate(
  project: ProjectRow,
  name: string,
  activities: ScheduleActivityRow[],
  wbsSections: ScheduleWbsSectionRow[],
): BrowserCpmTemplate {
  const now = new Date().toISOString();
  const templateId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: `browser-${templateId}`,
    project_id: project.id,
    name,
    description: `Browser template saved from ${project.name}.`,
    activity_count: activities.length,
    created_at: now,
    updated_at: now,
    source: "browser",
    activities: activities.map(scheduleActivityToTemplateCreateInput),
    wbsSections: buildBrowserCpmTemplateWbsSections(wbsSections),
  };
}

function buildBrowserCpmTemplateWbsSections(
  wbsSections: ScheduleWbsSectionRow[],
): BrowserCpmTemplateWbsSection[] {
  const pathMap = buildWbsSectionPathMap(wbsSections);
  return wbsSections
    .map((section) => {
      const path = pathMap.get(section.id) ?? section.name;
      const parentPath = section.parent_id ? (pathMap.get(section.parent_id) ?? null) : null;
      return {
        path,
        name: section.name,
        parentPath,
        sort_order: section.sort_order,
      };
    })
    .filter((section) => section.path.trim().length > 0);
}

export function readBrowserCpmTemplates(): BrowserCpmTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(BROWSER_CPM_TEMPLATE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(coerceBrowserCpmTemplate)
      .filter((template): template is BrowserCpmTemplate => Boolean(template))
      .slice(0, 25);
  } catch {
    return [];
  }
}

function coerceBrowserCpmTemplate(item: unknown): BrowserCpmTemplate | null {
  const row = item as Partial<BrowserCpmTemplate>;
  if (!row?.id || !row.name || !Array.isArray(row.activities)) return null;
  return {
    ...row,
    id: String(row.id),
    project_id: String(row.project_id ?? ""),
    name: String(row.name),
    description: String(row.description ?? ""),
    activity_count: Number(row.activity_count ?? row.activities.length) || row.activities.length,
    created_at: String(row.created_at ?? new Date().toISOString()),
    updated_at: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
    source: "browser",
    activities: row.activities,
    wbsSections: normalizeBrowserCpmTemplateWbsSections(row.wbsSections),
  };
}

function normalizeBrowserCpmTemplateWbsSections(value: unknown): BrowserCpmTemplateWbsSection[] {
  if (!Array.isArray(value)) return [];
  const legacyRows = value.filter((item): item is Partial<ScheduleWbsSectionRow> =>
    Boolean(item && typeof item === "object"),
  );
  const pathMap = buildWbsSectionPathMap(
    legacyRows
      .filter((row) => row.id && row.name)
      .map((row) => ({
        id: String(row.id),
        project_id: String(row.project_id ?? ""),
        parent_id: row.parent_id ? String(row.parent_id) : null,
        name: String(row.name),
        code: String(row.code ?? ""),
        sort_order: Number(row.sort_order ?? 0) || 0,
      })),
  );
  return legacyRows
    .map((row) => {
      const path =
        "path" in row && typeof row.path === "string"
          ? row.path
          : row.id
            ? (pathMap.get(String(row.id)) ?? "")
            : "";
      const name =
        typeof row.name === "string" ? row.name : path ? splitWbsPath(path).at(-1) || path : "";
      const parentPath =
        "parentPath" in row && typeof row.parentPath === "string"
          ? row.parentPath
          : row.parent_id
            ? (pathMap.get(String(row.parent_id)) ?? null)
            : null;
      return {
        path,
        name,
        parentPath,
        sort_order: Number(row.sort_order ?? 0) || 0,
      };
    })
    .filter((row) => row.path.trim().length > 0);
}

export function writeBrowserCpmTemplates(templates: BrowserCpmTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    BROWSER_CPM_TEMPLATE_STORAGE_KEY,
    JSON.stringify(templates.slice(0, 25)),
  );
}
