import { type ConstructLineCpmModel, type ConstructLineCpmTask } from "@/lib/constructline-cpm";
import {
  hasScheduleActivityActualStartBasis,
  hasScheduleActivityStarted,
  shouldFlagMissingActualStart,
  shouldFlagMissingExpectedFinish,
  shouldFlagMissingRemainingDuration,
  taskIsInDataDateUpdateWindow,
  taskNeedsStatusUpdateBasis,
} from "@/lib/schedule-update-queue";
import {
  type ScheduleQualityQueueItem,
  type ScheduleUpdateReadinessItem,
  type ScheduleUpdateReadinessSummary,
  shortDate,
  todayIsoDate,
} from "./scheduleShared";

export {
  hasScheduleActivityActualStartBasis,
  hasScheduleActivityStarted,
  shouldFlagMissingActualStart,
  shouldFlagMissingExpectedFinish,
  shouldFlagMissingRemainingDuration,
  taskIsInDataDateUpdateWindow,
  taskNeedsStatusUpdateBasis,
};

export function buildScheduleQualityQueue(
  model: ConstructLineCpmModel,
): ScheduleQualityQueueItem[] {
  const items = model.tasks.flatMap((task) => {
    const reasons: string[] = [];
    let severity: ScheduleQualityQueueItem["severity"] = "warning";
    let sort = 90;

    if (task.hasMissingDates) {
      reasons.push("Missing start or finish date");
      severity = "danger";
      sort = Math.min(sort, 10);
    }
    if (task.missingPredecessorKeys.length > 0 || task.missingSuccessorKeys.length > 0) {
      reasons.push("Missing logic reference");
      severity = "danger";
      sort = Math.min(sort, 12);
    }
    if (model.openStartCount > 1 && task.isOpenStart) {
      reasons.push("Open start");
      sort = Math.min(sort, 20);
    }
    if (model.openFinishCount > 1 && task.isOpenFinish) {
      reasons.push("Open finish");
      sort = Math.min(sort, 22);
    }
    if (
      model.openFinishCount === 1 &&
      model.unanchoredOpenFinishCount > 0 &&
      task.isOpenFinish &&
      !task.isMilestone
    ) {
      reasons.push("Finish anchor missing");
      sort = Math.min(sort, 24);
    }
    if (task.isOutOfSequence) {
      reasons.push("Out-of-sequence progress");
      severity = "danger";
      sort = Math.min(sort, 30);
    }
    if (task.isLate) {
      reasons.push("Late against data date");
      severity = "danger";
      sort = Math.min(sort, 34);
    }
    if (taskNeedsStatusUpdateBasis(task)) {
      reasons.push("Needs update basis");
      severity = task.statusBasis === "needs_update" ? "danger" : severity;
      sort = Math.min(sort, task.statusBasis === "needs_update" ? 32 : 36);
    }
    if (
      task.predecessorKeys.length === 0 &&
      task.successorKeys.length === 0 &&
      !task.isMilestone &&
      !reasons.some((reason) => reason.startsWith("Open"))
    ) {
      reasons.push("No logic ties");
      sort = Math.min(sort, 42);
    }

    if (reasons.length === 0) return [];
    return [
      {
        task,
        severity,
        reasons,
        guidance: buildScheduleQualityGuidance(task, reasons),
        sort,
      },
    ];
  });

  return items.sort((a, b) => {
    const severity = a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1;
    if (severity !== 0) return severity;
    return a.sort - b.sort || a.task.totalFloat - b.task.totalFloat;
  });
}

export function buildScheduleUpdateReadiness(
  model: ConstructLineCpmModel,
  dataDate: string | null,
): ScheduleUpdateReadinessSummary {
  const openTasks = model.tasks.filter((task) => task.activity.percent_complete < 100);
  const referenceDate = dataDate || todayIsoDate();
  const updateWindowTasks = openTasks.filter((task) =>
    taskIsInDataDateUpdateWindow(task, referenceDate),
  );

  const items = updateWindowTasks.flatMap((task) => {
    const activity = task.activity;
    const reasons: string[] = [];
    let severity: ScheduleUpdateReadinessItem["severity"] = "warning";
    let sort = 80;

    if (shouldFlagMissingExpectedFinish(activity)) {
      reasons.push("Expected finish missing");
      severity = "danger";
      sort = Math.min(sort, 10);
    }
    if (shouldFlagMissingActualStart(activity)) {
      reasons.push("Actual start missing");
      sort = Math.min(sort, 12);
    }
    if (shouldFlagMissingRemainingDuration(activity)) {
      reasons.push("Remaining duration missing");
      sort = Math.min(sort, 16);
    }
    if (task.statusBasis === "needs_update") {
      reasons.push(
        task.isMilestone
          ? "Milestone update needed"
          : hasScheduleActivityActualStartBasis(activity)
            ? "Current forecast needed"
            : "Current dates need review",
      );
      severity = "danger";
      sort = Math.min(sort, hasScheduleActivityActualStartBasis(activity) ? 14 : 18);
    }
    if (task.isLate) {
      reasons.push("Past data date");
      severity = "danger";
      sort = Math.min(sort, 6);
    }
    if (task.isOutOfSequence) {
      reasons.push("Out of sequence");
      sort = Math.min(sort, 28);
    }

    if (reasons.length === 0) return [];
    return [{ task, reasons, severity, sort }];
  });

  const sortedItems = items.sort((a, b) => {
    const severity = a.severity === b.severity ? 0 : a.severity === "danger" ? -1 : 1;
    if (severity !== 0) return severity;
    return a.sort - b.sort || a.task.earlyStart - b.task.earlyStart;
  });
  const missingRemainingCount = sortedItems.filter((item) =>
    item.reasons.includes("Remaining duration missing"),
  ).length;
  const missingExpectedFinishCount = sortedItems.filter((item) =>
    item.reasons.includes("Expected finish missing"),
  ).length;
  const lateCount = sortedItems.filter((item) => item.reasons.includes("Past data date")).length;

  return {
    openTaskCount: openTasks.length,
    updateWindowCount: updateWindowTasks.length,
    readyTaskCount: Math.max(0, updateWindowTasks.length - sortedItems.length),
    needsStatusCount: sortedItems.length,
    missingRemainingCount,
    missingExpectedFinishCount,
    lateCount,
    items: sortedItems,
  };
}

function buildScheduleQualityGuidance(task: ConstructLineCpmTask, reasons: string[]) {
  if (reasons.some((reason) => reason.includes("Missing start"))) {
    return "Add dates so the row can participate in CPM math.";
  }
  if (reasons.some((reason) => reason.includes("Missing logic reference"))) {
    const missingIds = [...task.missingPredecessorKeys, ...task.missingSuccessorKeys];
    return `Replace ${missingIds.join(", ")} with an existing activity from the picker.`;
  }
  if (reasons.includes("Open start")) {
    return "Tie this row to the launch path or mark it as an intentional start milestone.";
  }
  if (reasons.includes("Open finish")) {
    return "Tie this row to a downstream completion path.";
  }
  if (reasons.includes("Finish anchor missing")) {
    return "Create a finish milestone and tie this row to it before relying on the critical path.";
  }
  if (reasons.includes("Out-of-sequence progress")) {
    return "Review progress against predecessor completion before the next update.";
  }
  if (reasons.includes("Late against data date")) {
    return "Update progress, add a delay impact, or revise the recovery path.";
  }
  if (reasons.includes("Needs update basis")) {
    if (task.isMilestone) {
      return "Confirm the milestone date or mark the milestone met before relying on this snapshot.";
    }
    if (!hasScheduleActivityActualStartBasis(task.activity)) {
      return "Confirm the actual start if work has begun; otherwise adjust current start and expected finish. Remaining duration is only required after an actual start.";
    }
    return "Enter actual start, remaining duration, or expected finish before saving the data-date snapshot.";
  }
  if (reasons.includes("No logic ties")) {
    return task.totalFloat <= 0
      ? "Add predecessor and successor logic before relying on this as critical."
      : "Connect this row so the schedule is not just a date list.";
  }
  return "Open the activity and clean up dates, logic, or progress.";
}

export function formatUpdateReadinessQueueLine(item: ScheduleUpdateReadinessItem) {
  if (item.task.isMilestone) {
    const status = item.task.activity.percent_complete >= 100 ? "met" : "not met";
    return `Forecast point ${shortDate(item.task.statusFinishDate)} · ${status} · TF ${item.task.totalFloat}d`;
  }
  if (!hasScheduleActivityActualStartBasis(item.task.activity)) {
    if (item.task.activity.percent_complete > 0) {
      return `Progress entered without actual start · set actual start first · no remaining duration until actual start is saved · TF ${item.task.totalFloat}d`;
    }
    return `Current forecast ${shortDate(item.task.statusStartDate)} to ${shortDate(
      item.task.statusFinishDate,
    )} · not started · review current dates only · remaining duration not required · TF ${item.task.totalFloat}d`;
  }
  return `Expected finish ${shortDate(item.task.statusFinishDate)} · remaining ${
    item.task.remainingDurationDays
  }d · TF ${item.task.totalFloat}d`;
}
