import assert from "node:assert/strict";
import {
  buildActivityUpdateSnapshotRows,
  buildMilestoneUpdateSnapshotRows,
  buildScheduleUpdateRecord,
  resolveScheduleUpdateWriteMode,
} from "../src/lib/schedule-update-spine.ts";
import {
  selectCanonicalLogicTieCount,
  selectCpmForecastStatus,
  selectLatestScheduleUpdate,
  selectSavedScheduleForecast,
  selectSavedScheduleMovementWeeks,
  selectSavedScheduleVarianceWeeks,
} from "../src/lib/schedule-selectors.ts";
import {
  shouldFlagMissingRemainingDuration,
  taskIsInDataDateUpdateWindow,
  taskNeedsUpdateQueueAction,
} from "../src/lib/schedule-update-queue.ts";
import { buildConstructLineCpmModel } from "../src/lib/constructline-cpm.ts";
import { computeScheduleVarianceWeeks } from "../src/lib/ior.ts";
import type {
  MilestoneRow,
  ScheduleActivityRow,
  ScheduleUpdateRow,
} from "../src/lib/schedule.functions.ts";

let activitySeq = 0;
function makeActivity(overrides: Partial<ScheduleActivityRow> = {}): ScheduleActivityRow {
  activitySeq += 1;
  return {
    id: `a-${activitySeq}`,
    project_id: "p-1",
    activity_id: `A-${String(activitySeq).padStart(3, "0")}`,
    name: `Activity ${activitySeq}`,
    division: "General",
    wbs_section_id: null,
    start_date: null,
    finish_date: null,
    baseline_start_date: null,
    baseline_finish_date: null,
    forecast_start_date: null,
    forecast_finish_date: null,
    actual_start_date: null,
    actual_finish_date: null,
    remaining_duration_days: null,
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: activitySeq * 10,
    ...overrides,
  };
}

let updateSeq = 0;
function makeUpdate(overrides: Partial<ScheduleUpdateRow> = {}): ScheduleUpdateRow {
  updateSeq += 1;
  return {
    id: `u-${updateSeq}`,
    project_id: "p-1",
    update_number: updateSeq,
    update_date: "2026-06-30",
    data_date: "2026-06-30",
    baseline_completion_date: "2026-12-01",
    forecast_completion_date: "2026-12-15",
    variance_weeks: 2,
    movement_weeks: 1,
    schedule_money_exposure: 0,
    schedule_money_recovery: 0,
    schedule_money_net: 0,
    money_notes: "",
    notes: "",
    ...overrides,
  };
}

// ---------- Amend-vs-duplicate guard ----------
assert.equal(
  resolveScheduleUpdateWriteMode({ existingUpdateNumber: null, replaceExisting: false }),
  "create",
  "No existing update on the data date must create a new update.",
);
assert.equal(
  resolveScheduleUpdateWriteMode({ existingUpdateNumber: 4, replaceExisting: false }),
  "duplicate_blocked",
  "An unconfirmed save on an already-covered data date must be blocked, never duplicated.",
);
assert.equal(
  resolveScheduleUpdateWriteMode({ existingUpdateNumber: 4, replaceExisting: true }),
  "amend",
  "A confirmed save on an already-covered data date must amend the existing update.",
);

// ---------- Update record creation from a snapshot save ----------
const record = buildScheduleUpdateRecord({
  projectId: "p-1",
  updateNumber: 5,
  dataDate: "2026-06-30",
  baselineCompletionDate: "2026-11-01",
  previousCompletionDate: "2026-12-01",
  forecastCompletionDate: "2026-12-15",
  scheduleMoneyExposure: 2500,
  scheduleMoneyRecovery: 500,
  moneyNotes: "GC overtime",
  notes: "CPM signal text",
});
assert.equal(record.project_id, "p-1");
assert.equal(record.update_number, 5);
assert.equal(record.data_date, "2026-06-30", "The record carries the data date.");
assert.equal(record.update_date, "2026-06-30", "update_date and data_date are the same moment.");
assert.equal(record.forecast_completion_date, "2026-12-15");
assert.equal(
  record.variance_weeks,
  computeScheduleVarianceWeeks("2026-11-01", "2026-12-15") ?? 0,
  "Variance is always derived from baseline vs the saved forecast.",
);
assert.equal(
  record.movement_weeks,
  computeScheduleVarianceWeeks("2026-12-01", "2026-12-15") ?? 0,
  "Movement is always derived vs the prior update's forecast.",
);
assert.ok(record.variance_weeks > 0, "A later forecast shows positive variance weeks.");
assert.equal(record.schedule_money_exposure, 2500);
assert.equal(record.schedule_money_recovery, 500);
assert.equal(record.money_notes, "GC overtime");
assert.equal(record.notes, "CPM signal text");

// ---------- Activity snapshot row persistence shape ----------
const snapshotActivities = [
  makeActivity({
    activity_id: "S-001",
    baseline_start_date: "2026-06-01",
    baseline_finish_date: "2026-06-10",
    actual_start_date: "2026-06-01",
    actual_finish_date: "2026-06-10",
    percent_complete: 100,
    successor_activity_ids: ["S-002|FS|0"],
  }),
  makeActivity({
    activity_id: "S-002",
    baseline_start_date: "2026-06-11",
    baseline_finish_date: "2026-07-10",
    actual_start_date: "2026-06-11",
    remaining_duration_days: 8,
    percent_complete: 60,
    predecessor_activity_ids: ["S-001|FS|0"],
    successor_activity_ids: ["S-003|FS|0"],
  }),
  makeActivity({
    activity_id: "S-003",
    baseline_start_date: "2026-07-11",
    baseline_finish_date: "2026-08-01",
    predecessor_activity_ids: ["S-002|FS|0"],
  }),
];
const snapshotContext = {
  projectId: "p-1",
  scheduleUpdateId: "u-99",
  updateNumber: 9,
  dataDate: "2026-06-30",
};
const snapshotRows = buildActivityUpdateSnapshotRows(snapshotActivities, snapshotContext);
assert.equal(
  snapshotRows.length,
  snapshotActivities.length,
  "Every activity gets a snapshot row on a saved update.",
);
const expectedSnapshotColumns = [
  "project_id",
  "schedule_update_id",
  "schedule_activity_id",
  "update_number",
  "data_date",
  "activity_id",
  "name",
  "division",
  "wbs_section_id",
  "baseline_start_date",
  "baseline_finish_date",
  "current_start_date",
  "current_finish_date",
  "actual_start_date",
  "actual_finish_date",
  "planned_duration_days",
  "remaining_duration_days",
  "status_basis",
  "percent_complete",
  "total_float_days",
  "free_float_days",
  "slippage_days",
  "is_critical",
  "is_near_critical",
  "is_late",
  "is_out_of_sequence",
  "is_open_start",
  "is_open_finish",
  "is_milestone",
  "predecessor_activity_ids",
  "successor_activity_ids",
  "notes",
].sort();
for (const row of snapshotRows) {
  assert.deepEqual(
    Object.keys(row).sort(),
    expectedSnapshotColumns,
    "Snapshot rows persist the full schedule_activity_updates column set.",
  );
  assert.equal(row.project_id, "p-1");
  assert.equal(row.schedule_update_id, "u-99");
  assert.equal(row.update_number, 9);
  assert.equal(row.data_date, "2026-06-30");
  assert.ok(row.remaining_duration_days >= 0);
  assert.ok(row.planned_duration_days >= 0);
  assert.ok(row.percent_complete >= 0 && row.percent_complete <= 100);
  assert.equal(typeof row.is_critical, "boolean");
  assert.equal(typeof row.status_basis, "string");
}
const completeRow = snapshotRows.find((row) => row.activity_id === "S-001");
const inProgressRow = snapshotRows.find((row) => row.activity_id === "S-002");
const notStartedRow = snapshotRows.find((row) => row.activity_id === "S-003");
assert.ok(completeRow && inProgressRow && notStartedRow);
assert.equal(completeRow.remaining_duration_days, 0, "Complete work snapshots zero remaining.");
assert.ok(
  inProgressRow.remaining_duration_days > 0,
  "In-progress work with an actual start snapshots its remaining duration.",
);
assert.equal(
  notStartedRow.remaining_duration_days,
  0,
  "Remaining duration applies to in-progress work only — none before an actual start.",
);
assert.equal(
  buildActivityUpdateSnapshotRows([], snapshotContext).length,
  0,
  "No activities means no snapshot rows, not an error.",
);

const milestoneRows: MilestoneRow[] = [
  {
    id: "m-1",
    project_id: "p-1",
    name: "Dry-in",
    baseline_date: "2026-08-01",
    forecast_date: "2026-08-15",
    status: "at_risk",
    delay_reason: "Roof truss delivery",
    owner: "PM",
    sort_order: 10,
  },
];
const milestoneSnapshots = buildMilestoneUpdateSnapshotRows(milestoneRows, snapshotContext);
assert.equal(milestoneSnapshots.length, 1, "Every milestone gets a snapshot row.");
assert.equal(milestoneSnapshots[0].milestone_id, "m-1");
assert.equal(milestoneSnapshots[0].schedule_update_id, "u-99");
assert.equal(milestoneSnapshots[0].update_number, 9);
assert.equal(
  milestoneSnapshots[0].variance_weeks,
  computeScheduleVarianceWeeks("2026-08-01", "2026-08-15") ?? 0,
);
assert.equal(milestoneSnapshots[0].status, "at_risk");
assert.equal(milestoneSnapshots[0].notes, "Roof truss delivery");

// ---------- Canonical logic-tie count ----------
const tieA = makeActivity({ activity_id: "T-001", successor_activity_ids: ["T-002|FS|0"] });
const tieB = makeActivity({ activity_id: "T-002", predecessor_activity_ids: ["T-001|FS|0"] });
assert.equal(
  selectCanonicalLogicTieCount([tieA, tieB]),
  1,
  "A reciprocal predecessor/successor pair is ONE directed tie, not two.",
);
const oneSidedB = makeActivity({ activity_id: "T-004" });
const oneSidedA = makeActivity({
  activity_id: "T-003",
  successor_activity_ids: ["T-004|FS|0"],
});
assert.equal(
  selectCanonicalLogicTieCount([oneSidedA, oneSidedB]),
  1,
  "A tie recorded on only one side still counts once.",
);
const danglingTie = makeActivity({
  activity_id: "T-005",
  predecessor_activity_ids: ["ZZ-999|FS|0"],
});
assert.equal(
  selectCanonicalLogicTieCount([danglingTie]),
  0,
  "Ties pointing at unknown activity IDs never count.",
);
const multiRelA = makeActivity({
  activity_id: "T-006",
  successor_activity_ids: ["T-007|FS|0", "T-007|SS|5"],
});
const multiRelB = makeActivity({ activity_id: "T-007" });
assert.equal(
  selectCanonicalLogicTieCount([multiRelA, multiRelB]),
  2,
  "Distinct relationship types or lags between the same pair are distinct ties.",
);

// ---------- Variance / forecast selectors ----------
const olderUpdate = makeUpdate({
  update_number: 3,
  data_date: "2026-06-15",
  forecast_completion_date: "2026-12-01",
  variance_weeks: 4,
  movement_weeks: 2,
});
const latestUpdate = makeUpdate({
  update_number: 4,
  data_date: "2026-06-30",
  forecast_completion_date: "2026-12-20",
  variance_weeks: 7,
  movement_weeks: 3,
});
assert.equal(
  selectLatestScheduleUpdate([olderUpdate, latestUpdate])?.update_number,
  4,
  "The latest update wins by update number.",
);
assert.equal(
  selectLatestScheduleUpdate([latestUpdate, olderUpdate])?.update_number,
  4,
  "Latest-update selection does not depend on input order.",
);
assert.equal(
  selectSavedScheduleForecast([olderUpdate, latestUpdate], "2026-11-01"),
  "2026-12-20",
  "The forecast of record is the latest saved update's forecast.",
);
assert.equal(
  selectSavedScheduleForecast([], "2026-11-01"),
  "2026-11-01",
  "Before the first saved update, the project forecast is the fallback.",
);
assert.equal(
  selectSavedScheduleVarianceWeeks([olderUpdate, latestUpdate], "2026-10-01", "2026-10-15"),
  7,
  "Variance of record comes from the latest saved update, not live fields.",
);
assert.equal(
  selectSavedScheduleVarianceWeeks([], "2026-10-01", "2026-10-15"),
  computeScheduleVarianceWeeks("2026-10-01", "2026-10-15"),
  "Before the first saved update, variance derives from project-level fields.",
);
assert.equal(
  selectSavedScheduleMovementWeeks([olderUpdate, latestUpdate]),
  3,
  "Movement of record comes from the latest saved update.",
);
const unsavedStatus = selectCpmForecastStatus({
  savedForecast: "2026-12-20",
  liveCpmForecast: "2027-01-04",
});
assert.equal(unsavedStatus.isUnsaved, true, "A diverging live CPM forecast is unsaved.");
assert.equal(unsavedStatus.unsavedForecast, "2027-01-04");
assert.equal(unsavedStatus.forecastOfRecord, "2026-12-20");
assert.equal(
  selectCpmForecastStatus({ savedForecast: "2026-12-20", liveCpmForecast: "2026-12-20" }).isUnsaved,
  false,
  "A live forecast matching the record is not flagged.",
);
assert.equal(
  selectCpmForecastStatus({ savedForecast: "2026-12-20", liveCpmForecast: null }).isUnsaved,
  false,
  "No live forecast means nothing to flag.",
);

// ---------- Needs-update queue membership ----------
const DATA_DATE = "2026-06-30";
const queueActivities = [
  makeActivity({
    activity_id: "Q-001", // complete before the data date
    baseline_start_date: "2026-06-01",
    baseline_finish_date: "2026-06-10",
    actual_start_date: "2026-06-01",
    actual_finish_date: "2026-06-10",
    percent_complete: 100,
  }),
  makeActivity({
    activity_id: "Q-002", // started, not finished — spans the data date
    baseline_start_date: "2026-06-15",
    baseline_finish_date: "2026-07-15",
    actual_start_date: "2026-06-15",
    remaining_duration_days: 10,
    percent_complete: 40,
  }),
  makeActivity({
    activity_id: "Q-003", // planned to have started, no actual start
    baseline_start_date: "2026-06-20",
    baseline_finish_date: "2026-07-05",
  }),
  makeActivity({
    activity_id: "Q-004", // future window — never in the queue
    baseline_start_date: "2026-08-01",
    baseline_finish_date: "2026-08-20",
  }),
  makeActivity({
    activity_id: "Q-005", // late: planned finish behind the data date, unfinished
    baseline_start_date: "2026-05-01",
    baseline_finish_date: "2026-06-01",
    actual_start_date: "2026-05-01",
    percent_complete: 80,
  }),
];
const queueModel = buildConstructLineCpmModel(queueActivities, { dataDate: DATA_DATE });
const taskById = new Map(queueModel.tasks.map((task) => [task.activity.activity_id, task]));
const completeTask = taskById.get("Q-001")!;
const inProgressTask = taskById.get("Q-002")!;
const plannedNoActualTask = taskById.get("Q-003")!;
const futureTask = taskById.get("Q-004")!;
const lateTask = taskById.get("Q-005")!;

assert.equal(
  taskIsInDataDateUpdateWindow(completeTask, DATA_DATE),
  false,
  "Complete activities never appear in the needs-update queue.",
);
assert.equal(
  taskIsInDataDateUpdateWindow(inProgressTask, DATA_DATE),
  true,
  "Started-but-not-finished work spanning the data date is in the queue window.",
);
assert.equal(
  taskIsInDataDateUpdateWindow(plannedNoActualTask, DATA_DATE),
  true,
  "Rows planned to have started with no actual start are in the queue window.",
);
assert.equal(
  taskIsInDataDateUpdateWindow(futureTask, DATA_DATE),
  false,
  "Future-window rows never appear in the needs-update queue.",
);
assert.equal(
  taskIsInDataDateUpdateWindow(lateTask, DATA_DATE),
  true,
  "Late unfinished work is in the queue window.",
);
assert.equal(
  taskNeedsUpdateQueueAction(completeTask, DATA_DATE),
  false,
  "Complete activities never need queue action.",
);
assert.equal(
  taskNeedsUpdateQueueAction(futureTask, DATA_DATE),
  false,
  "Future rows never need queue action even if their status is unreviewed.",
);
assert.equal(
  taskNeedsUpdateQueueAction(lateTask, DATA_DATE),
  true,
  "Late unfinished work needs action at the data date.",
);

// ---------- Remaining-duration rule ----------
const progressedNoActualStart = makeActivity({
  activity_id: "R-001",
  baseline_start_date: "2026-06-01",
  baseline_finish_date: "2026-07-15",
  percent_complete: 30,
});
assert.equal(
  shouldFlagMissingRemainingDuration(progressedNoActualStart),
  false,
  "Remaining duration is never demanded before an actual start exists.",
);
const startedMissingRemaining = makeActivity({
  activity_id: "R-002",
  baseline_start_date: "2026-06-01",
  actual_start_date: "2026-06-01",
  percent_complete: 30,
});
assert.equal(
  shouldFlagMissingRemainingDuration(startedMissingRemaining),
  true,
  "Started work without remaining duration or an expected finish is flagged.",
);
const startedWithExpectedFinish = makeActivity({
  activity_id: "R-003",
  baseline_start_date: "2026-06-01",
  actual_start_date: "2026-06-01",
  forecast_finish_date: "2026-07-20",
  percent_complete: 30,
});
assert.equal(
  shouldFlagMissingRemainingDuration(startedWithExpectedFinish),
  false,
  "Current expected finish stays a valid alternative to remaining duration.",
);

console.log("Schedule spine smoke checks passed.");
