// Pure schedule-update spine math — how a saved CPM snapshot becomes the one
// schedule update record, and what per-activity / per-milestone snapshot rows
// it persists. No env-dependent imports so node-based smoke tests can load it.
import type { MilestoneRow, ScheduleActivityRow } from "@/lib/schedule.functions";
import { computeScheduleVarianceWeeks } from "./ior.ts";
import { buildConstructLineCpmModel, type ConstructLineCpmTask } from "./constructline-cpm.ts";

export type ScheduleUpdateWriteMode = "create" | "amend" | "duplicate_blocked";

// One update per data date: saving again on a data date that already has an
// update amends that update (after the caller confirms), never duplicates.
export function resolveScheduleUpdateWriteMode({
  existingUpdateNumber,
  replaceExisting,
}: {
  existingUpdateNumber: number | null;
  replaceExisting: boolean;
}): ScheduleUpdateWriteMode {
  if (existingUpdateNumber == null) return "create";
  return replaceExisting ? "amend" : "duplicate_blocked";
}

export type ScheduleUpdateRecordInput = {
  projectId: string;
  updateNumber: number;
  dataDate: string;
  baselineCompletionDate: string | null;
  previousCompletionDate: string | null;
  forecastCompletionDate: string;
  scheduleMoneyExposure: number;
  scheduleMoneyRecovery: number;
  moneyNotes: string;
  notes: string;
};

// The one schedule update record: data date, completion forecast, variance vs
// baseline, movement vs the prior update — one object, one moment in time.
export function buildScheduleUpdateRecord(input: ScheduleUpdateRecordInput) {
  return {
    project_id: input.projectId,
    update_number: input.updateNumber,
    update_date: input.dataDate,
    data_date: input.dataDate,
    baseline_completion_date: input.baselineCompletionDate,
    forecast_completion_date: input.forecastCompletionDate,
    variance_weeks:
      computeScheduleVarianceWeeks(input.baselineCompletionDate, input.forecastCompletionDate) ?? 0,
    movement_weeks:
      computeScheduleVarianceWeeks(input.previousCompletionDate, input.forecastCompletionDate) ?? 0,
    schedule_money_exposure: input.scheduleMoneyExposure,
    schedule_money_recovery: input.scheduleMoneyRecovery,
    money_notes: input.moneyNotes,
    notes: input.notes,
  };
}

export function hasActivityActualStartBasisForSnapshot(activity: ScheduleActivityRow) {
  return Boolean(activity.actual_start_date) || Boolean(activity.actual_finish_date);
}

export function getActivityUpdateSnapshotRemainingDurationDays(task: ConstructLineCpmTask) {
  if (task.isMilestone) return 0;
  if (task.activity.actual_finish_date || task.activity.percent_complete >= 100) return 0;
  if (!hasActivityActualStartBasisForSnapshot(task.activity)) return 0;
  return Math.max(0, Math.round(task.remainingDurationDays));
}

export type ScheduleUpdateSnapshotContext = {
  projectId: string;
  scheduleUpdateId: string;
  updateNumber: number;
  dataDate: string;
};

// Per-activity snapshot rows for a saved update: status, percent, actual
// dates, remaining duration, total float, critical flag, expected finish.
export function buildActivityUpdateSnapshotRows(
  activities: ScheduleActivityRow[],
  context: ScheduleUpdateSnapshotContext,
) {
  if (activities.length === 0) return [];
  const cpmModel = buildConstructLineCpmModel(activities, { dataDate: context.dataDate });
  return cpmModel.tasks.map((task) => ({
    project_id: context.projectId,
    schedule_update_id: context.scheduleUpdateId,
    schedule_activity_id: task.activity.id,
    update_number: context.updateNumber,
    data_date: context.dataDate,
    activity_id: task.activity.activity_id,
    name: task.activity.name,
    division: task.activity.division,
    wbs_section_id: task.activity.wbs_section_id,
    baseline_start_date: task.baselineStartDate || task.activity.baseline_start_date,
    baseline_finish_date: task.baselineFinishDate || task.activity.baseline_finish_date,
    current_start_date: task.statusStartDate || task.activity.forecast_start_date,
    current_finish_date: task.statusFinishDate || task.activity.forecast_finish_date,
    actual_start_date: task.activity.actual_start_date,
    actual_finish_date: task.activity.actual_finish_date,
    planned_duration_days: Math.max(0, Math.round(task.durationDays)),
    remaining_duration_days: getActivityUpdateSnapshotRemainingDurationDays(task),
    status_basis: task.statusBasis,
    percent_complete: task.activity.percent_complete,
    total_float_days: Math.round(task.totalFloat),
    free_float_days: Math.round(task.freeFloat),
    slippage_days: Math.round(task.slippageDays),
    is_critical: task.isCritical,
    is_near_critical: task.isNearCritical,
    is_late: task.isLate,
    is_out_of_sequence: task.isOutOfSequence,
    is_open_start: task.isOpenStart,
    is_open_finish: task.isOpenFinish,
    is_milestone: task.isMilestone,
    predecessor_activity_ids: task.activity.predecessor_activity_ids,
    successor_activity_ids: task.activity.successor_activity_ids,
    notes: task.activity.notes,
  }));
}

// Per-milestone snapshot rows for a saved update.
export function buildMilestoneUpdateSnapshotRows(
  milestones: MilestoneRow[],
  context: ScheduleUpdateSnapshotContext,
) {
  return milestones.map((milestone) => ({
    project_id: context.projectId,
    milestone_id: milestone.id,
    schedule_update_id: context.scheduleUpdateId,
    update_number: context.updateNumber,
    baseline_date: milestone.baseline_date,
    forecast_date: milestone.forecast_date,
    variance_weeks:
      computeScheduleVarianceWeeks(milestone.baseline_date, milestone.forecast_date) ?? 0,
    status: milestone.status,
    notes: milestone.delay_reason ?? "",
  }));
}
