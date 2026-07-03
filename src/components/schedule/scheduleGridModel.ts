import { type ScheduleActivityRow, type ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import {
  offsetFromTimelineStart,
  type ConstructLineCpmModel,
  type ConstructLineCpmTask,
  type ConstructLineRelationshipType,
} from "@/lib/constructline-cpm";
import {
  compareWbsDivision,
  joinWbsPath,
  normalizeWbsDivisionName,
  splitWbsPath,
} from "@/lib/constructline-wbs";
import {
  type ActivityMatrixRow,
  DAY_MS,
  SCHEDULE_LOOKAHEAD_DAYS,
  type ScheduleActivityOrder,
  type ScheduleGridView,
  naturalScheduleCompare,
  shortDate,
  todayIsoDate,
} from "./scheduleShared";
import {
  getDelayFragmentsForActivity,
  groupDelayFragmentsByActivity,
  isOpenDelayFragment,
} from "./scheduleUpdateDraft";
import {
  shouldFlagMissingActualStart,
  shouldFlagMissingExpectedFinish,
  shouldFlagMissingRemainingDuration,
  taskIsInDataDateUpdateWindow,
  taskNeedsStatusUpdateBasis,
} from "./scheduleUpdateReadiness";
import { isoDateFromMs, parseDateMs } from "./ScheduleSnapshotTimeline";

export function getDelayPeriodLabel(days: number, width: number, isPrintMode: boolean) {
  if (days <= 0 || width <= 0) return null;
  if (width >= (isPrintMode ? 42 : 76)) return `${days}d delay`;
  if (width >= (isPrintMode ? 24 : 48)) return "delay";
  return null;
}

export function getTaskFinishVarianceDays(task: ConstructLineCpmTask) {
  const baselineFinishMs = parseDateMs(task.baselineFinishDate);
  const expectedFinishMs = parseDateMs(task.statusFinishDate);
  if (baselineFinishMs == null || expectedFinishMs == null) return null;
  return Math.round((expectedFinishMs - baselineFinishMs) / DAY_MS);
}

export function formatTaskStatusBasisLabel(task: ConstructLineCpmTask) {
  switch (task.statusBasis) {
    case "actual":
      return "actual";
    case "remaining_duration":
      return "remain";
    case "expected_finish":
      return "forecast";
    case "needs_update":
      return "update";
    case "planned_dates":
    default:
      return "plan";
  }
}

export function formatTaskStatusBasisTitle(task: ConstructLineCpmTask) {
  switch (task.statusBasis) {
    case "actual":
      return "Current schedule is based on actual finish or completed status.";
    case "remaining_duration":
      return "Current schedule is based on entered remaining duration from the data date.";
    case "expected_finish":
      return "Current schedule is based on the expected finish forecast.";
    case "needs_update":
      return "This incomplete activity is past its expected finish. Review actual status and update the current forecast.";
    case "planned_dates":
    default:
      return "Current schedule is still carrying the planned baseline dates.";
  }
}

export function getTaskStatusBasisClass(task: ConstructLineCpmTask) {
  switch (task.statusBasis) {
    case "actual":
      return "text-success";
    case "remaining_duration":
      return "text-foreground";
    case "expected_finish":
      return "text-accent";
    case "needs_update":
      return "text-danger";
    case "planned_dates":
    default:
      return "text-muted-foreground";
  }
}

export function buildConstructLineMonthBands(startDate: string, totalDays: number, dayPx: number) {
  const start = parseDateMs(startDate);
  if (start == null) return [];
  const bands: Array<{ x: number; width: number; label: string }> = [];
  let cursor = 0;
  while (cursor < totalDays) {
    const cursorMs = start + cursor * 24 * 60 * 60 * 1000;
    const d = new Date(cursorMs);
    const month = d.getUTCMonth();
    const year = d.getUTCFullYear();
    let length = 0;
    while (cursor + length < totalDays) {
      const next = new Date(start + (cursor + length) * 24 * 60 * 60 * 1000);
      if (next.getUTCMonth() !== month || next.getUTCFullYear() !== year) break;
      length += 1;
    }
    bands.push({
      x: cursor * dayPx,
      width: Math.max(dayPx, length * dayPx),
      label: `${MONTH_LABELS[month]} ${String(year).slice(2)}`,
    });
    cursor += Math.max(1, length);
  }
  return bands;
}

export function getLogicLineEndpointOffsets(
  predecessor: ConstructLineCpmTask,
  successor: ConstructLineCpmTask,
  relationshipType: ConstructLineRelationshipType,
  timelineStartDate: string,
) {
  const fromDate =
    relationshipType === "SS" || relationshipType === "SF"
      ? predecessor.visualStartDate
      : predecessor.visualFinishDate;
  const toDate =
    relationshipType === "FF" || relationshipType === "SF"
      ? successor.visualFinishDate
      : successor.visualStartDate;
  const fromOffset =
    offsetFromTimelineStart(fromDate, timelineStartDate) +
    (relationshipType === "FS" || relationshipType === "FF"
      ? predecessor.isMilestone
        ? 0
        : 1
      : 0);
  const toOffset =
    offsetFromTimelineStart(toDate, timelineStartDate) +
    (relationshipType === "FF" || relationshipType === "SF" ? (successor.isMilestone ? 0 : 1) : 0);
  return { fromOffset, toOffset };
}

export function orderConstructLineCpmModel(
  model: ConstructLineCpmModel,
  order: ScheduleActivityOrder,
  wbsDivisionOrder: string[] = [],
): ConstructLineCpmModel {
  const orderedTasks = [...model.tasks].sort(
    order === "start"
      ? compareCpmTasksByStart
      : (a, b) => compareCpmTasksByWbsThenStart(a, b, wbsDivisionOrder),
  );

  return {
    ...model,
    tasks: orderedTasks,
    groups:
      order === "start"
        ? [{ division: "Start date order", tasks: orderedTasks }]
        : groupCpmTasksByWbsDivision(orderedTasks, wbsDivisionOrder),
  };
}

export function buildActivityMatrixRows(
  groups: Array<{ division: string; tasks: ConstructLineCpmTask[] }>,
): ActivityMatrixRow[] {
  const parentRollups = new Map<string, ConstructLineCpmTask[]>();
  for (const group of groups) {
    const parts = splitWbsPath(group.division);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parentPath = joinWbsPath(parts.slice(0, depth));
      parentRollups.set(parentPath, [...(parentRollups.get(parentPath) ?? []), ...group.tasks]);
    }
  }

  const insertedParents = new Set<string>();
  const rows: ActivityMatrixRow[] = [];
  for (const group of groups) {
    const parts = splitWbsPath(group.division);
    for (let depth = 1; depth < parts.length; depth += 1) {
      const parentPath = joinWbsPath(parts.slice(0, depth));
      if (insertedParents.has(parentPath)) continue;
      const parentTasks = parentRollups.get(parentPath) ?? [];
      if (parentTasks.length > 0) {
        rows.push({ kind: "parent", division: parentPath, tasks: parentTasks });
      }
      insertedParents.add(parentPath);
    }
    rows.push({ kind: "group", division: group.division, tasks: group.tasks });
    rows.push(...group.tasks.map((task) => ({ kind: "task" as const, task })));
  }
  return rows;
}

export function getActivityMatrixTaskRowHeight(
  task: ConstructLineCpmTask,
  isPrintMode: boolean,
  delayFragmentsByActivity: Map<string, ScheduleDelayFragmentRow[]>,
  activityColumnWidth: number,
) {
  const name = task.activity.name.trim() || task.activity.activity_id || "Activity";
  const estimatedNameLines = estimateActivityNameLines(name, isPrintMode, activityColumnWidth);
  const flagCount = countActivityMatrixFlags(
    task,
    getDelayFragmentsForActivity(task.activity, delayFragmentsByActivity).some(isOpenDelayFragment),
  );
  const flagsPerRow = Math.max(1, Math.floor(activityColumnWidth / (isPrintMode ? 42 : 76)));
  const estimatedFlagRows = flagCount === 0 ? 0 : Math.ceil(flagCount / flagsPerRow);

  if (isPrintMode) {
    return Math.min(84, Math.max(31, 22 + estimatedNameLines * 7 + estimatedFlagRows * 8));
  }

  return Math.min(220, Math.max(72, 44 + estimatedNameLines * 16 + estimatedFlagRows * 21));
}

function estimateActivityNameLines(
  name: string,
  isPrintMode: boolean,
  activityColumnWidth: number,
) {
  const charsPerLine = Math.max(isPrintMode ? 18 : 16, Math.floor(activityColumnWidth / 7));
  const maxLines = isPrintMode ? 6 : 5;
  return Math.max(1, Math.min(maxLines, Math.ceil(name.length / charsPerLine)));
}

function countActivityMatrixFlags(task: ConstructLineCpmTask, hasOpenDelay: boolean) {
  return [
    task.isMilestone,
    task.isCritical,
    task.isNearCritical,
    task.isLate,
    task.isOutOfSequence,
    task.isOpenStart,
    task.isOpenFinish,
    task.hasMissingDates,
    task.statusBasis === "needs_update",
    shouldFlagMissingRemainingDuration(task.activity),
    shouldFlagMissingExpectedFinish(task.activity),
    shouldFlagMissingActualStart(task.activity),
    task.slippageDays > 0,
    hasOpenDelay,
  ].filter(Boolean).length;
}

export function filterConstructLineCpmModel(
  model: ConstructLineCpmModel,
  view: ScheduleGridView,
  referenceDate: string,
  delayFragments: ScheduleDelayFragmentRow[],
): ConstructLineCpmModel {
  if (view === "all") return model;
  const delayFragmentsByActivity = groupDelayFragmentsByActivity(delayFragments);
  const tasks = model.tasks.filter((task) =>
    taskMatchesScheduleGridView(task, view, referenceDate, delayFragmentsByActivity),
  );
  const visibleTaskKeys = new Set(tasks.map((task) => task.activityKey));
  return {
    ...model,
    tasks,
    groups: model.groups
      .map((group) => ({
        ...group,
        tasks: group.tasks.filter((task) => visibleTaskKeys.has(task.activityKey)),
      }))
      .filter((group) => group.tasks.length > 0),
  };
}

function taskMatchesScheduleGridView(
  task: ConstructLineCpmTask,
  view: ScheduleGridView,
  referenceDate: string,
  delayFragmentsByActivity: Map<string, ScheduleDelayFragmentRow[]>,
) {
  const percent = Math.max(0, Math.min(100, task.activity.percent_complete));
  const isIncomplete = percent < 100;
  const isActive = isIncomplete && taskIntersectsDateWindow(task, referenceDate, referenceDate);
  const hasStartedButIncomplete = percent > 0 && isIncomplete;

  if (view === "active") return isActive || hasStartedButIncomplete;
  if (view === "update_queue") {
    // Mirrors the needs-update queue exactly: rows in the data-date update
    // window that still need action. Complete and future rows never appear.
    return (
      taskIsInDataDateUpdateWindow(task, referenceDate) &&
      (taskNeedsStatusUpdateBasis(task) || task.isLate || task.isOutOfSequence)
    );
  }
  const lookaheadDays = SCHEDULE_LOOKAHEAD_DAYS[view];
  if (lookaheadDays) {
    const referenceMs = parseDateMs(referenceDate) ?? parseDateMs(todayIsoDate()) ?? Date.now();
    const finishDate = isoDateFromMs(referenceMs + lookaheadDays * DAY_MS);
    return isIncomplete && taskIntersectsDateWindow(task, referenceDate, finishDate);
  }
  if (view === "recovery") {
    return (
      isIncomplete &&
      (task.totalFloat < 0 ||
        task.isLate ||
        task.isOutOfSequence ||
        getDelayFragmentsForActivity(task.activity, delayFragmentsByActivity).some(
          isOpenDelayFragment,
        ))
    );
  }
  if (view === "critical") return task.isCritical || task.isNearCritical;
  if (view === "issues") {
    return (
      task.isLate ||
      task.isOutOfSequence ||
      task.isOpenStart ||
      task.isOpenFinish ||
      task.hasMissingDates ||
      taskNeedsStatusUpdateBasis(task) ||
      getDelayFragmentsForActivity(task.activity, delayFragmentsByActivity).some(
        isOpenDelayFragment,
      )
    );
  }
  if (view === "milestones") return task.isMilestone;
  return true;
}

export function taskIntersectsDateWindow(
  task: ConstructLineCpmTask,
  windowStartDate: string,
  windowFinishDate: string,
) {
  const taskStart = parseDateMs(task.visualStartDate);
  const taskFinish = parseDateMs(task.visualFinishDate);
  const windowStart = parseDateMs(windowStartDate);
  const windowFinish = parseDateMs(windowFinishDate);
  if (taskStart == null || taskFinish == null || windowStart == null || windowFinish == null) {
    return false;
  }
  return taskFinish >= windowStart && taskStart <= windowFinish;
}

export function describeScheduleGridView(
  view: ScheduleGridView,
  visibleCount: number,
  totalCount: number,
  referenceDate: string,
) {
  const countText =
    visibleCount === totalCount
      ? `${visibleCount} ${visibleCount === 1 ? "activity" : "activities"} shown`
      : `${visibleCount} of ${totalCount} activities shown`;
  if (view === "all") return `All activities · ${countText}`;
  if (view === "active") return `Active as of ${shortDate(referenceDate)} · ${countText}`;
  if (view === "update_queue") {
    return `Needs data-date update as of ${shortDate(referenceDate)} · ${countText}`;
  }
  const lookaheadDays = SCHEDULE_LOOKAHEAD_DAYS[view];
  if (lookaheadDays) {
    const lookaheadLabel =
      lookaheadDays % 7 === 0 ? `${lookaheadDays / 7}-week` : `${lookaheadDays}-day`;
    return `${lookaheadLabel} lookahead from ${shortDate(referenceDate)} · ${countText}`;
  }
  if (view === "recovery")
    return `Recovery needed · negative float, delay, or status exceptions · ${countText}`;
  if (view === "critical") return `Critical and near-critical path · ${countText}`;
  if (view === "issues") return `Schedule issues · ${countText}`;
  if (view === "milestones") return `Milestones only · ${countText}`;
  return countText;
}

export function getScheduleReportTitle(view: ScheduleGridView) {
  if (view === "recovery") return "Recovery Schedule Report";
  if (view === "critical") return "Critical Path Report";
  if (view === "lookahead_1w") return "1-Week Lookahead Report";
  if (view === "lookahead_2w") return "2-Week Lookahead Report";
  if (view === "lookahead_6w") return "6-Week Lookahead Report";
  if (view === "update_queue") return "CPM Update Queue Report";
  if (view === "issues") return "Schedule Issues Report";
  if (view === "milestones") return "Milestone Report";
  if (view === "active") return "Active Schedule Report";
  return "Full CPM Schedule Report";
}

function compareCpmTasksByStart(a: ConstructLineCpmTask, b: ConstructLineCpmTask) {
  return (
    a.visualStartDate.localeCompare(b.visualStartDate) ||
    a.visualFinishDate.localeCompare(b.visualFinishDate) ||
    naturalScheduleCompare(a.dependencyKey, b.dependencyKey) ||
    naturalScheduleCompare(a.activity.name, b.activity.name)
  );
}

export function compareScheduleActivitiesByStart(a: ScheduleActivityRow, b: ScheduleActivityRow) {
  const aStart = a.start_date ?? a.finish_date ?? "9999-12-31";
  const bStart = b.start_date ?? b.finish_date ?? "9999-12-31";
  const aFinish = a.finish_date ?? a.start_date ?? "9999-12-31";
  const bFinish = b.finish_date ?? b.start_date ?? "9999-12-31";
  return (
    aStart.localeCompare(bStart) ||
    aFinish.localeCompare(bFinish) ||
    naturalScheduleCompare(a.activity_id || a.name, b.activity_id || b.name) ||
    naturalScheduleCompare(a.name, b.name)
  );
}

function compareCpmTasksByWbsThenStart(
  a: ConstructLineCpmTask,
  b: ConstructLineCpmTask,
  wbsDivisionOrder: string[] = [],
) {
  return (
    compareWbsDivision(a.activity.division, b.activity.division, wbsDivisionOrder) ||
    compareCpmTasksByStart(a, b)
  );
}

function groupCpmTasksByWbsDivision(
  tasks: ConstructLineCpmTask[],
  wbsDivisionOrder: string[] = [],
) {
  const groups = new Map<string, ConstructLineCpmTask[]>();
  for (const task of tasks) {
    const division = normalizeWbsDivisionName(task.activity.division);
    groups.set(division, [...(groups.get(division) ?? []), task]);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => compareWbsDivision(a, b, wbsDivisionOrder))
    .map(([division, rows]) => ({ division, tasks: rows.sort(compareCpmTasksByStart) }));
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
