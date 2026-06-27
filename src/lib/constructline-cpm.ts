import type { ScheduleActivityRow } from "@/lib/schedule.functions";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ConstructLineCpmTask {
  activity: ScheduleActivityRow;
  activityKey: string;
  dependencyKey: string;
  durationDays: number;
  visualStartDate: string;
  visualFinishDate: string;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  predecessorKeys: string[];
  successorKeys: string[];
  missingPredecessorKeys: string[];
  missingSuccessorKeys: string[];
  isMilestone: boolean;
  isCritical: boolean;
  isNearCritical: boolean;
  isLate: boolean;
  isOutOfSequence: boolean;
  isOpenStart: boolean;
  isOpenFinish: boolean;
  hasMissingDates: boolean;
}

export interface ConstructLineStackBucket {
  key: string;
  label: string;
  startDate: string;
  finishDate: string;
  count: number;
  criticalCount: number;
}

export interface ConstructLineCpmModel {
  tasks: ConstructLineCpmTask[];
  groups: Array<{ division: string; tasks: ConstructLineCpmTask[] }>;
  diagnostics: string[];
  healthScore: number;
  healthTone: "success" | "warning" | "danger";
  projectStartDate: string;
  projectFinishDate: string;
  timelineStartDate: string;
  timelineFinishDate: string;
  totalTimelineDays: number;
  criticalCount: number;
  nearCriticalCount: number;
  criticalPathReliable: boolean;
  criticalPathReliabilityNote: string;
  openStartCount: number;
  openFinishCount: number;
  missingDateCount: number;
  missingLogicCount: number;
  lateCount: number;
  outOfSequenceCount: number;
  maxStack: number;
  maxStackLabel: string;
  stackBuckets: ConstructLineStackBucket[];
  recommendations: string[];
}

interface BuildOptions {
  dataDate?: string | null;
  nearCriticalFloat?: number;
}

interface WorkingTask {
  activity: ScheduleActivityRow;
  activityKey: string;
  dependencyKey: string;
  durationDays: number;
  startOffset: number | null;
  finishOffset: number | null;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  totalFloat: number;
  freeFloat: number;
  predecessorKeys: string[];
  successorKeys: string[];
  missingPredecessorKeys: string[];
  missingSuccessorKeys: string[];
  isMilestone: boolean;
}

export function buildConstructLineCpmModel(
  activities: ScheduleActivityRow[],
  options: BuildOptions = {},
): ConstructLineCpmModel {
  const nearCriticalFloat = options.nearCriticalFloat ?? 5;
  const dataDateMs = parseDateMs(options.dataDate);
  const sorted = [...activities].sort(sortActivities);
  const dateValues = sorted.flatMap((activity) => [activity.start_date, activity.finish_date]);
  const parsedDates = dateValues
    .map((value) => parseDateMs(value))
    .filter((value): value is number => value != null);
  const todayMs = parseDateMs(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const projectStartMs = parsedDates.length > 0 ? Math.min(...parsedDates) : todayMs;
  const projectFinishMs = parsedDates.length > 0 ? Math.max(...parsedDates) : projectStartMs;
  const projectStartDate = isoDateFromMs(projectStartMs);
  const projectFinishDate = isoDateFromMs(projectFinishMs);
  const diagnostics: string[] = [];

  const keyLookup = new Map<string, string>();
  const tasks: WorkingTask[] = sorted.map((activity, index) => {
    const activityKey = activity.id;
    const dependencyKey = activity.activity_id?.trim() || `A-${String(index + 1).padStart(3, "0")}`;
    const isMilestone = isConstructLineMilestoneActivity(activity);
    keyLookup.set(normalizeDependencyKey(activity.id), activityKey);
    keyLookup.set(normalizeDependencyKey(dependencyKey), activityKey);
    return {
      activity,
      activityKey,
      dependencyKey,
      durationDays: isMilestone ? 1 : getDurationDays(activity),
      startOffset: getDayOffset(projectStartMs, activity.start_date),
      finishOffset: getDayOffset(projectStartMs, activity.finish_date),
      earlyStart: 0,
      earlyFinish: 0,
      lateStart: 0,
      lateFinish: 0,
      totalFloat: 0,
      freeFloat: 0,
      predecessorKeys: [],
      successorKeys: [],
      missingPredecessorKeys: [],
      missingSuccessorKeys: [],
      isMilestone,
    };
  });
  const taskMap = new Map(tasks.map((task) => [task.activityKey, task]));
  const dependencySet = new Set<string>();

  const addDependency = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const key = `${fromKey}->${toKey}`;
    if (dependencySet.has(key)) return;
    dependencySet.add(key);
    taskMap.get(fromKey)?.successorKeys.push(toKey);
    taskMap.get(toKey)?.predecessorKeys.push(fromKey);
  };

  for (const task of tasks) {
    for (const predecessor of task.activity.predecessor_activity_ids) {
      const resolved = keyLookup.get(normalizeDependencyKey(predecessor));
      if (resolved) addDependency(resolved, task.activityKey);
      else task.missingPredecessorKeys.push(predecessor);
    }
    for (const successor of task.activity.successor_activity_ids) {
      const resolved = keyLookup.get(normalizeDependencyKey(successor));
      if (resolved) addDependency(task.activityKey, resolved);
      else task.missingSuccessorKeys.push(successor);
    }
  }

  for (const task of tasks) {
    if (task.missingPredecessorKeys.length > 0) {
      diagnostics.push(
        `${task.dependencyKey} references missing predecessor ${task.missingPredecessorKeys.join(
          ", ",
        )}.`,
      );
    }
    if (task.missingSuccessorKeys.length > 0) {
      diagnostics.push(
        `${task.dependencyKey} references missing successor ${task.missingSuccessorKeys.join(
          ", ",
        )}.`,
      );
    }
  }

  const topo = topologicalSort(tasks);
  const ordered = topo.ok ? topo.tasks : [...tasks].sort(sortWorkingTasksByDate);
  if (!topo.ok) diagnostics.push("Schedule logic contains a cycle; CPM float is date-order only.");

  for (const task of ordered) {
    const logicStart = Math.max(
      0,
      ...task.predecessorKeys.map((key) => (taskMap.get(key)?.earlyFinish ?? -1) + 1),
    );
    const constrainedStart = Math.max(logicStart, task.startOffset ?? 0);
    task.earlyStart = constrainedStart;
    task.earlyFinish = constrainedStart + task.durationDays - 1;
  }

  const projectFinishOffset = Math.max(0, ...tasks.map((task) => task.earlyFinish));
  for (const task of [...ordered].reverse()) {
    const successorLateStart = task.successorKeys
      .map((key) => taskMap.get(key)?.lateStart)
      .filter((value): value is number => typeof value === "number");
    task.lateFinish =
      successorLateStart.length > 0 ? Math.min(...successorLateStart) - 1 : projectFinishOffset;
    task.lateStart = task.lateFinish - task.durationDays + 1;
    task.totalFloat = Math.max(0, task.lateStart - task.earlyStart);
    const successorEarlyStart = task.successorKeys
      .map((key) => taskMap.get(key)?.earlyStart)
      .filter((value): value is number => typeof value === "number");
    task.freeFloat =
      successorEarlyStart.length > 0
        ? Math.max(0, Math.min(...successorEarlyStart) - task.earlyFinish - 1)
        : task.totalFloat;
  }

  const modelTasks: ConstructLineCpmTask[] = tasks.map((task) => {
    const visualStartOffset = task.startOffset ?? task.earlyStart;
    const visualFinishOffset = task.finishOffset ?? task.earlyFinish;
    const isLate =
      dataDateMs != null &&
      task.activity.percent_complete < 100 &&
      parseDateMs(task.activity.finish_date) != null &&
      parseDateMs(task.activity.finish_date)! < dataDateMs;
    const isOutOfSequence =
      task.activity.percent_complete > 0 &&
      task.predecessorKeys.some((key) => (taskMap.get(key)?.activity.percent_complete ?? 0) < 100);

    return {
      activity: task.activity,
      activityKey: task.activityKey,
      dependencyKey: task.dependencyKey,
      durationDays: task.durationDays,
      visualStartDate: isoDateFromMs(projectStartMs + visualStartOffset * DAY_MS),
      visualFinishDate: isoDateFromMs(projectStartMs + visualFinishOffset * DAY_MS),
      earlyStart: task.earlyStart,
      earlyFinish: task.earlyFinish,
      lateStart: task.lateStart,
      lateFinish: task.lateFinish,
      totalFloat: task.totalFloat,
      freeFloat: task.freeFloat,
      predecessorKeys: task.predecessorKeys,
      successorKeys: task.successorKeys,
      missingPredecessorKeys: task.missingPredecessorKeys,
      missingSuccessorKeys: task.missingSuccessorKeys,
      isMilestone: task.isMilestone,
      isCritical: task.totalFloat <= 0,
      isNearCritical: task.totalFloat > 0 && task.totalFloat <= nearCriticalFloat,
      isLate,
      isOutOfSequence,
      isOpenStart: task.predecessorKeys.length === 0,
      isOpenFinish: task.successorKeys.length === 0,
      hasMissingDates: !task.activity.start_date || !task.activity.finish_date,
    };
  });

  const timelineStartMs = Math.min(
    projectStartMs,
    dataDateMs ?? projectStartMs,
    ...modelTasks.map((task) => parseDateMs(task.visualStartDate) ?? projectStartMs),
  );
  const timelineFinishMs = Math.max(
    projectFinishMs,
    dataDateMs ?? projectFinishMs,
    ...modelTasks.map((task) => parseDateMs(task.visualFinishDate) ?? projectFinishMs),
  );
  const timelineStartDate = isoDateFromMs(timelineStartMs - 7 * DAY_MS);
  const timelineFinishDate = isoDateFromMs(timelineFinishMs + 7 * DAY_MS);
  const totalTimelineDays = Math.max(
    14,
    Math.round(
      ((parseDateMs(timelineFinishDate) ?? timelineFinishMs) -
        (parseDateMs(timelineStartDate) ?? timelineStartMs)) /
        DAY_MS,
    ) + 1,
  );
  const groups = groupTasksByDivision(modelTasks);
  const stackBuckets = buildStackBuckets(modelTasks, timelineStartDate);
  const maxStackBucket = stackBuckets.reduce<ConstructLineStackBucket | null>(
    (max, bucket) => (!max || bucket.count > max.count ? bucket : max),
    null,
  );
  const criticalCount = modelTasks.filter((task) => task.isCritical).length;
  const nearCriticalCount = modelTasks.filter((task) => task.isNearCritical).length;
  const openStartCount = modelTasks.filter((task) => task.isOpenStart).length;
  const openFinishCount = modelTasks.filter((task) => task.isOpenFinish).length;
  const criticalPathReliabilityIssues = buildCriticalPathReliabilityIssues({
    topoOk: topo.ok,
    diagnosticsCount: diagnostics.length,
    openStartCount,
    openFinishCount,
  });
  const criticalPathReliable = modelTasks.length > 0 && criticalPathReliabilityIssues.length === 0;
  const criticalPathReliabilityNote = criticalPathReliable
    ? "Forward and backward pass complete."
    : criticalPathReliabilityIssues.join(" ");
  const missingDateCount = modelTasks.filter((task) => task.hasMissingDates).length;
  const missingLogicCount = modelTasks.filter(
    (task) => task.predecessorKeys.length === 0 && task.successorKeys.length === 0,
  ).length;
  const lateCount = modelTasks.filter((task) => task.isLate).length;
  const outOfSequenceCount = modelTasks.filter((task) => task.isOutOfSequence).length;
  const healthScore = scoreSchedule({
    taskCount: modelTasks.length,
    missingDateCount,
    missingLogicCount,
    openStartCount,
    openFinishCount,
    lateCount,
    outOfSequenceCount,
    diagnosticsCount: diagnostics.length,
  });

  return {
    tasks: modelTasks,
    groups,
    diagnostics,
    healthScore,
    healthTone: healthScore >= 82 ? "success" : healthScore >= 62 ? "warning" : "danger",
    projectStartDate,
    projectFinishDate,
    timelineStartDate,
    timelineFinishDate,
    totalTimelineDays,
    criticalCount,
    nearCriticalCount,
    criticalPathReliable,
    criticalPathReliabilityNote,
    openStartCount,
    openFinishCount,
    missingDateCount,
    missingLogicCount,
    lateCount,
    outOfSequenceCount,
    maxStack: maxStackBucket?.count ?? 0,
    maxStackLabel: maxStackBucket?.label ?? "No stacking",
    stackBuckets,
    recommendations: buildRecommendations({
      taskCount: modelTasks.length,
      missingDateCount,
      missingLogicCount,
      openStartCount,
      openFinishCount,
      lateCount,
      outOfSequenceCount,
      diagnostics,
      criticalPathReliable,
      criticalPathReliabilityNote,
      maxStack: maxStackBucket?.count ?? 0,
      maxStackLabel: maxStackBucket?.label ?? "No stacking",
    }),
  };
}

export function parseCpmDateMs(value?: string | null) {
  return parseDateMs(value);
}

export function isConstructLineMilestoneActivity(
  activity: Pick<ScheduleActivityRow, "activity_id" | "division" | "name" | "notes">,
) {
  const division = activity.division.trim().toLowerCase();
  const activityId = activity.activity_id.trim().toLowerCase();
  const name = activity.name.trim().toLowerCase();
  const notes = activity.notes.trim().toLowerCase();
  return (
    division === "milestones" ||
    division === "milestone" ||
    activityId.startsWith("ms-") ||
    notes.includes("constructline milestone") ||
    notes.includes("created from interim milestone") ||
    (name.includes("milestone") && activityId.startsWith("m"))
  );
}

export function offsetFromTimelineStart(value: string, timelineStartDate: string) {
  const start = parseDateMs(timelineStartDate);
  const valueMs = parseDateMs(value);
  if (start == null || valueMs == null) return 0;
  return Math.max(0, Math.round((valueMs - start) / DAY_MS));
}

function sortActivities(a: ScheduleActivityRow, b: ScheduleActivityRow) {
  const division = (a.division || "General").localeCompare(b.division || "General");
  if (division !== 0) return division;
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  return (a.activity_id || a.name).localeCompare(b.activity_id || b.name);
}

function sortWorkingTasksByDate(a: WorkingTask, b: WorkingTask) {
  return (
    (a.startOffset ?? Number.MAX_SAFE_INTEGER) - (b.startOffset ?? Number.MAX_SAFE_INTEGER) ||
    a.dependencyKey.localeCompare(b.dependencyKey)
  );
}

function normalizeDependencyKey(value: string) {
  return value.trim().toLowerCase();
}

function parseDateMs(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

function getDurationDays(activity: ScheduleActivityRow) {
  const start = parseDateMs(activity.start_date);
  const finish = parseDateMs(activity.finish_date);
  if (start == null || finish == null) return 1;
  return Math.max(1, Math.round((finish - start) / DAY_MS) + 1);
}

function getDayOffset(projectStartMs: number, value?: string | null) {
  const ms = parseDateMs(value);
  if (ms == null) return null;
  return Math.max(0, Math.round((ms - projectStartMs) / DAY_MS));
}

function topologicalSort(tasks: WorkingTask[]): { ok: true; tasks: WorkingTask[] } | { ok: false } {
  const inbound = new Map(tasks.map((task) => [task.activityKey, task.predecessorKeys.length]));
  const queue = tasks.filter((task) => (inbound.get(task.activityKey) ?? 0) === 0);
  const ordered: WorkingTask[] = [];

  while (queue.length > 0) {
    const task = queue.shift()!;
    ordered.push(task);
    for (const successorKey of task.successorKeys) {
      const nextInbound = (inbound.get(successorKey) ?? 0) - 1;
      inbound.set(successorKey, nextInbound);
      if (nextInbound === 0) {
        const successor = tasks.find((candidate) => candidate.activityKey === successorKey);
        if (successor) queue.push(successor);
      }
    }
  }

  return ordered.length === tasks.length ? { ok: true, tasks: ordered } : { ok: false };
}

function groupTasksByDivision(tasks: ConstructLineCpmTask[]) {
  const groups = new Map<string, ConstructLineCpmTask[]>();
  for (const task of tasks) {
    const division = task.activity.division || "General";
    groups.set(division, [...(groups.get(division) ?? []), task]);
  }
  return Array.from(groups.entries()).map(([division, rows]) => ({ division, tasks: rows }));
}

function buildStackBuckets(tasks: ConstructLineCpmTask[], timelineStartDate: string) {
  const timelineStart = parseDateMs(timelineStartDate);
  if (timelineStart == null) return [];
  const buckets = new Map<string, ConstructLineStackBucket>();

  for (const task of tasks) {
    const start = parseDateMs(task.visualStartDate);
    const finish = parseDateMs(task.visualFinishDate);
    if (start == null || finish == null) continue;
    const startWeek = Math.floor((start - timelineStart) / DAY_MS / 7);
    const finishWeek = Math.floor((finish - timelineStart) / DAY_MS / 7);
    for (let week = startWeek; week <= finishWeek; week += 1) {
      const bucketStart = timelineStart + week * 7 * DAY_MS;
      const bucketFinish = bucketStart + 6 * DAY_MS;
      const key = String(week);
      const existing =
        buckets.get(key) ??
        ({
          key,
          label: `${shortDate(isoDateFromMs(bucketStart))} wk`,
          startDate: isoDateFromMs(bucketStart),
          finishDate: isoDateFromMs(bucketFinish),
          count: 0,
          criticalCount: 0,
        } satisfies ConstructLineStackBucket);
      existing.count += 1;
      if (task.isCritical) existing.criticalCount += 1;
      buckets.set(key, existing);
    }
  }

  return Array.from(buckets.values()).sort((a, b) => Number(a.key) - Number(b.key));
}

function scoreSchedule({
  taskCount,
  missingDateCount,
  missingLogicCount,
  openStartCount,
  openFinishCount,
  lateCount,
  outOfSequenceCount,
  diagnosticsCount,
}: {
  taskCount: number;
  missingDateCount: number;
  missingLogicCount: number;
  openStartCount: number;
  openFinishCount: number;
  lateCount: number;
  outOfSequenceCount: number;
  diagnosticsCount: number;
}) {
  if (taskCount === 0) return 0;
  const extraOpenStarts = Math.max(0, openStartCount - 1);
  const extraOpenFinishes = Math.max(0, openFinishCount - 1);
  const score =
    100 -
    missingDateCount * 8 -
    missingLogicCount * 7 -
    extraOpenStarts * 4 -
    extraOpenFinishes * 4 -
    lateCount * 5 -
    outOfSequenceCount * 6 -
    diagnosticsCount * 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildCriticalPathReliabilityIssues({
  topoOk,
  diagnosticsCount,
  openStartCount,
  openFinishCount,
}: {
  topoOk: boolean;
  diagnosticsCount: number;
  openStartCount: number;
  openFinishCount: number;
}) {
  const issues: string[] = [];
  if (!topoOk) issues.push("Logic cycle blocks a reliable backward pass.");
  if (diagnosticsCount > 0) issues.push("Missing dependency references must be resolved.");
  if (openStartCount > 1)
    issues.push(`Reduce open starts from ${openStartCount} to one project start.`);
  if (openFinishCount > 1)
    issues.push(`Reduce open finishes from ${openFinishCount} to one project finish.`);
  return issues;
}

function buildRecommendations({
  taskCount,
  missingDateCount,
  missingLogicCount,
  openStartCount,
  openFinishCount,
  lateCount,
  outOfSequenceCount,
  diagnostics,
  criticalPathReliable,
  criticalPathReliabilityNote,
  maxStack,
  maxStackLabel,
}: {
  taskCount: number;
  missingDateCount: number;
  missingLogicCount: number;
  openStartCount: number;
  openFinishCount: number;
  lateCount: number;
  outOfSequenceCount: number;
  diagnostics: string[];
  criticalPathReliable: boolean;
  criticalPathReliabilityNote: string;
  maxStack: number;
  maxStackLabel: string;
}) {
  const items: string[] = [];
  if (taskCount > 0 && !criticalPathReliable)
    items.push(`Treat critical path as provisional. ${criticalPathReliabilityNote}`);
  if (missingDateCount > 0) items.push(`Add start/finish dates to ${missingDateCount} activities.`);
  if (missingLogicCount > 0)
    items.push(`Tie ${missingLogicCount} isolated activities into the plan.`);
  if (openStartCount > 1)
    items.push(`Reduce open starts from ${openStartCount} to a controlled launch path.`);
  if (openFinishCount > 1)
    items.push(`Reduce open finishes from ${openFinishCount} to a clear completion path.`);
  if (lateCount > 0) items.push(`Review ${lateCount} incomplete activities beyond the data date.`);
  if (outOfSequenceCount > 0)
    items.push(`Resolve ${outOfSequenceCount} out-of-sequence progress conditions.`);
  if (diagnostics.length > 0)
    items.push("Fix missing dependency references before relying on float.");
  if (maxStack >= 4) items.push(`Review activity stacking around ${maxStackLabel}.`);
  return items.length > 0 ? items : ["Schedule logic is ready for a deeper CPM update review."];
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}`;
}
