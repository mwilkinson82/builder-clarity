// Needs-update queue membership rules. Pure module (no env-dependent imports)
// so node-based smoke tests can load it; the schedule components re-export
// these so every surface shares one queue definition.
import type { ScheduleActivityRow } from "@/lib/schedule.functions";
import {
  isConstructLineMilestoneActivity,
  type ConstructLineCpmTask,
} from "./constructline-cpm.ts";

export function parseScheduleQueueDateMs(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function hasScheduleActivityStarted(activity: ScheduleActivityRow) {
  return (
    activity.percent_complete > 0 ||
    Boolean(activity.actual_start_date) ||
    Boolean(activity.actual_finish_date)
  );
}

export function hasScheduleActivityActualStartBasis(activity: ScheduleActivityRow) {
  return Boolean(activity.actual_start_date) || Boolean(activity.actual_finish_date);
}

export function shouldFlagMissingRemainingDuration(activity: ScheduleActivityRow) {
  if (isConstructLineMilestoneActivity(activity)) return false;
  const hasActualStartBasis = hasScheduleActivityActualStartBasis(activity);
  if (!hasActualStartBasis) return false;
  return (
    activity.percent_complete < 100 &&
    activity.remaining_duration_days == null &&
    !activity.forecast_finish_date &&
    !activity.actual_finish_date
  );
}

export function shouldFlagMissingExpectedFinish(activity: ScheduleActivityRow) {
  return (
    activity.percent_complete < 100 &&
    !activity.actual_finish_date &&
    !activity.forecast_finish_date &&
    !activity.finish_date &&
    !activity.baseline_finish_date
  );
}

export function shouldFlagMissingActualStart(activity: ScheduleActivityRow) {
  if (isConstructLineMilestoneActivity(activity)) return false;
  return (
    activity.percent_complete > 0 && activity.percent_complete < 100 && !activity.actual_start_date
  );
}

export function taskNeedsStatusUpdateBasis(task: ConstructLineCpmTask) {
  return (
    task.statusBasis === "needs_update" ||
    shouldFlagMissingRemainingDuration(task.activity) ||
    shouldFlagMissingExpectedFinish(task.activity) ||
    shouldFlagMissingActualStart(task.activity)
  );
}

// The needs-update queue contains only rows genuinely needing action for the
// current data date: started-but-not-finished work spanning the data date, or
// rows planned to have started by the data date with no actual start recorded.
// Complete activities and future-window rows never appear.
export function taskIsInDataDateUpdateWindow(task: ConstructLineCpmTask, referenceDate: string) {
  const activity = task.activity;
  if (activity.percent_complete >= 100 || activity.actual_finish_date) return false;
  if (hasScheduleActivityStarted(activity)) return true;
  const referenceMs =
    parseScheduleQueueDateMs(referenceDate) ?? parseScheduleQueueDateMs(todayIsoDate());
  const plannedStartMs = parseScheduleQueueDateMs(
    activity.forecast_start_date ?? activity.start_date ?? activity.baseline_start_date,
  );
  return referenceMs != null && plannedStartMs != null && plannedStartMs <= referenceMs;
}

// A queue row is a window row that still needs action. This is the exact
// membership rule for both the needs-update queue and the grid's
// "Needs update" view.
export function taskNeedsUpdateQueueAction(task: ConstructLineCpmTask, referenceDate: string) {
  return (
    taskIsInDataDateUpdateWindow(task, referenceDate) &&
    (taskNeedsStatusUpdateBasis(task) || task.isLate || task.isOutOfSequence)
  );
}
