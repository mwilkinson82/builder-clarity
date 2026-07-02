import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildReciprocalActivityLogicPatches,
  buildConstructLineCpmModel,
  describeConstructLineDependencyToken,
  formatConstructLineDependencyToken,
  parseConstructLineDependencyToken,
} from "../src/lib/constructline-cpm.ts";
import {
  updateScheduleStatusActualFinishDate,
  updateScheduleStatusActualStartDate,
  updateScheduleStatusForecastFinishDate,
  updateScheduleStatusForecastStartDate,
  updateScheduleStatusPercentComplete,
  updateScheduleStatusRemainingDuration,
} from "../src/lib/schedule-status.ts";
import {
  buildWbsDivisionOrder,
  buildWbsDivisionRows,
  buildWbsSectionPathMap,
  getImmediateChildWbsTitle,
  getWbsChildRows,
  moveWbsDivisionInOrder,
  replaceWbsPathInDivision,
} from "../src/lib/constructline-wbs.ts";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (filePath: string) => readFileSync(resolve(rootDir, filePath), "utf8");
const withScheduleActivityStatus = <
  T extends {
    start_date: string | null;
    finish_date: string | null;
    percent_complete: number;
  },
>(
  activity: T,
) => ({
  ...activity,
  baseline_start_date: activity.start_date,
  baseline_finish_date: activity.finish_date,
  forecast_start_date: activity.start_date,
  forecast_finish_date: activity.finish_date,
  actual_start_date: activity.percent_complete > 0 ? activity.start_date : null,
  actual_finish_date: activity.percent_complete >= 100 ? activity.finish_date : null,
  remaining_duration_days: activity.percent_complete >= 100 ? 0 : null,
});

const parsed = parseConstructLineDependencyToken("A-010 FF +2d");
assert.deepEqual(parsed, {
  activityId: "A-010",
  relationshipType: "FF",
  lagDays: 2,
});
assert.equal(
  formatConstructLineDependencyToken({ activityId: "A-020", relationshipType: "SS", lagDays: -1 }),
  "A-020|SS|-1",
);
assert.equal(describeConstructLineDependencyToken("A-030|FS|3"), "A-030 FS+3d");

const startedStatusDraft = {
  start_date: "2026-06-17",
  finish_date: "2026-08-07",
  baseline_start_date: "2026-06-17",
  forecast_start_date: "2026-06-17",
  forecast_finish_date: "2026-08-07",
  actual_start_date: "2026-06-17",
  actual_finish_date: "",
  remaining_duration_days: "",
  percent_complete: "30",
};
assert.equal(
  updateScheduleStatusForecastFinishDate(startedStatusDraft, "2026-07-10", "2026-06-30")
    .remaining_duration_days,
  "11",
  "Started CPM status rows should count remaining duration from the data date when expected finish changes.",
);
assert.equal(
  updateScheduleStatusRemainingDuration(startedStatusDraft, "12", "2026-06-30")
    .forecast_finish_date,
  "2026-07-11",
  "Started CPM status rows should move expected finish when remaining duration changes.",
);
assert.equal(
  updateScheduleStatusActualStartDate(
    { ...startedStatusDraft, actual_start_date: "", forecast_finish_date: "2026-07-10" },
    "2026-06-20",
    "2026-06-30",
  ).remaining_duration_days,
  "11",
  "Adding actual start should recalculate remaining duration against the data date.",
);
assert.equal(
  updateScheduleStatusForecastStartDate(
    {
      ...startedStatusDraft,
      actual_start_date: "",
      percent_complete: "0",
      forecast_start_date: "2026-07-06",
      remaining_duration_days: "5",
    },
    "2026-07-08",
    "2026-06-30",
  ).remaining_duration_days,
  "",
  "Unstarted future work should clear stale remaining duration and keep current start/finish as the forecast basis.",
);
assert.equal(
  updateScheduleStatusForecastFinishDate(
    {
      ...startedStatusDraft,
      actual_start_date: "",
      percent_complete: "0",
      remaining_duration_days: "7",
    },
    "2026-07-20",
    "2026-06-30",
  ).remaining_duration_days,
  "",
  "Unstarted forecast-finish changes should not create a remaining-duration requirement.",
);
assert.equal(
  updateScheduleStatusPercentComplete(startedStatusDraft, "100", "2026-06-30")
    .remaining_duration_days,
  "0",
  "Completed CPM status rows should carry zero remaining duration.",
);
const actualFinishDraft = updateScheduleStatusActualFinishDate(
  { ...startedStatusDraft, percent_complete: "40", remaining_duration_days: "18" },
  "2026-07-02",
  "2026-06-30",
);
assert.equal(
  actualFinishDraft.remaining_duration_days,
  "0",
  "Entering actual finish should clear stale remaining duration.",
);
assert.equal(
  actualFinishDraft.percent_complete,
  "100",
  "Entering actual finish should mark the activity complete.",
);
assert.equal(
  actualFinishDraft.forecast_finish_date,
  "2026-07-02",
  "Entering actual finish should make the current expected finish match the actual finish.",
);

const activities = [
  {
    id: "a",
    project_id: "project",
    activity_id: "A",
    name: "Start work",
    division: "01 - General",
    start_date: "2026-01-01",
    finish_date: "2026-01-03",
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: 10,
  },
  {
    id: "b",
    project_id: "project",
    activity_id: "B",
    name: "Critical follow-on",
    division: "02 - Structure",
    start_date: "2026-01-04",
    finish_date: "2026-01-07",
    percent_complete: 0,
    predecessor_activity_ids: ["A|FS|0"],
    successor_activity_ids: [],
    notes: "",
    sort_order: 20,
  },
  {
    id: "c",
    project_id: "project",
    activity_id: "C",
    name: "Parallel follow-on",
    division: "02 - Structure",
    start_date: "2026-01-03",
    finish_date: "2026-01-05",
    percent_complete: 0,
    predecessor_activity_ids: ["A|SS|2"],
    successor_activity_ids: [],
    notes: "",
    sort_order: 30,
  },
  {
    id: "finish",
    project_id: "project",
    activity_id: "MS-001",
    name: "Substantial completion milestone",
    division: "Milestones",
    start_date: "2026-01-08",
    finish_date: "2026-01-08",
    percent_complete: 0,
    predecessor_activity_ids: ["B|FS|0", "C|FS|0"],
    successor_activity_ids: [],
    notes: "ConstructLine milestone",
    sort_order: 40,
  },
].map(withScheduleActivityStatus);

const model = buildConstructLineCpmModel(activities, {
  dataDate: "2026-01-01",
  nearCriticalFloat: 5,
});
const byId = new Map(model.tasks.map((task) => [task.dependencyKey, task]));

assert.equal(model.criticalPathReliable, true);
assert.equal(model.openStartCount, 1);
assert.equal(model.openFinishCount, 1);
assert.equal(byId.get("A")?.totalFloat, 0);
assert.equal(byId.get("B")?.totalFloat, 0);
assert.equal(byId.get("C")?.totalFloat, 2);
assert.equal(byId.get("MS-001")?.isMilestone, true);
assert.equal(byId.get("MS-001")?.durationDays, 0);
assert.equal(byId.get("MS-001")?.remainingDurationDays, 0);
assert.equal(byId.get("MS-001")?.statusBasis, "planned_dates");
assert.equal(byId.get("MS-001")?.totalFloat, 0);
assert.equal(byId.get("C")?.isNearCritical, true);
assert.equal(byId.get("C")?.isCritical, false);

const relationshipActivities = [
  {
    id: "rel-a",
    project_id: "project",
    activity_id: "A",
    name: "Primary sequence",
    division: "01 - General",
    start_date: "2026-02-01",
    finish_date: "2026-02-05",
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: 10,
  },
  {
    id: "rel-b",
    project_id: "project",
    activity_id: "B",
    name: "Finish-to-finish lagged work",
    division: "02 - Finish",
    start_date: "2026-02-01",
    finish_date: "2026-02-04",
    percent_complete: 0,
    predecessor_activity_ids: ["A|FF|2"],
    successor_activity_ids: [],
    notes: "",
    sort_order: 20,
  },
  {
    id: "rel-c",
    project_id: "project",
    activity_id: "C",
    name: "Start-to-finish handoff",
    division: "02 - Finish",
    start_date: "2026-02-02",
    finish_date: "2026-02-03",
    percent_complete: 0,
    predecessor_activity_ids: ["A|SF|3"],
    successor_activity_ids: [],
    notes: "",
    sort_order: 30,
  },
  {
    id: "rel-finish",
    project_id: "project",
    activity_id: "MS-REL",
    name: "Relationship completion milestone",
    division: "Milestones",
    start_date: "2026-02-08",
    finish_date: "2026-02-08",
    percent_complete: 0,
    predecessor_activity_ids: ["B|FS|0", "C|FS|0"],
    successor_activity_ids: [],
    notes: "ConstructLine milestone",
    sort_order: 40,
  },
].map(withScheduleActivityStatus);

const relationshipModel = buildConstructLineCpmModel(relationshipActivities, {
  dataDate: "2026-02-01",
  nearCriticalFloat: 5,
});
const relationshipById = new Map(relationshipModel.tasks.map((task) => [task.dependencyKey, task]));
assert.equal(relationshipModel.criticalPathReliable, true);
assert.equal(relationshipById.get("B")?.statusStartDate, "2026-02-04");
assert.equal(relationshipById.get("B")?.statusFinishDate, "2026-02-07");
assert.equal(relationshipById.get("B")?.totalFloat, 0);
assert.equal(relationshipById.get("C")?.statusStartDate, "2026-02-03");
assert.equal(relationshipById.get("C")?.statusFinishDate, "2026-02-04");
assert.equal(relationshipById.get("A")?.totalFloat, 0);
assert.equal(relationshipById.get("MS-REL")?.totalFloat, 0);

const statusedActivities = [
  withScheduleActivityStatus({
    id: "status-a",
    project_id: "project",
    activity_id: "A",
    name: "Started activity",
    division: "01 - General",
    start_date: "2026-01-01",
    finish_date: "2026-01-10",
    percent_complete: 50,
    predecessor_activity_ids: [],
    successor_activity_ids: ["B|FS|0"],
    notes: "",
    sort_order: 10,
  }),
  withScheduleActivityStatus({
    id: "status-b",
    project_id: "project",
    activity_id: "B",
    name: "Follow-on activity",
    division: "02 - Finish",
    start_date: "2026-01-11",
    finish_date: "2026-01-15",
    percent_complete: 0,
    predecessor_activity_ids: ["A|FS|0"],
    successor_activity_ids: [],
    notes: "",
    sort_order: 20,
  }),
].map((activity) =>
  activity.activity_id === "A"
    ? {
        ...activity,
        actual_start_date: "2026-01-01",
        forecast_finish_date: "2026-01-13",
        remaining_duration_days: 5,
      }
    : activity,
);
const unstartedStatusRow = statusedActivities.find((activity) => activity.activity_id === "B");
if (unstartedStatusRow) {
  unstartedStatusRow.remaining_duration_days = 99;
}
const statusedModel = buildConstructLineCpmModel(statusedActivities, {
  dataDate: "2026-01-09",
});
const statusedById = new Map(statusedModel.tasks.map((task) => [task.dependencyKey, task]));
assert.equal(statusedById.get("A")?.remainingDurationDays, 5);
assert.equal(statusedById.get("A")?.statusStartDate, "2026-01-01");
assert.equal(statusedById.get("A")?.statusFinishDate, "2026-01-13");
assert.equal(statusedById.get("A")?.statusBasis, "remaining_duration");
assert.equal(statusedById.get("A")?.slippageDays, 3);
assert.equal(statusedById.get("B")?.statusStartDate, "2026-01-14");
assert.equal(statusedById.get("B")?.statusBasis, "planned_dates");
assert.equal(
  statusedById.get("B")?.statusFinishDate,
  "2026-01-18",
  "Unstarted activities should ignore stale remaining duration in CPM status math.",
);
assert.equal(statusedById.get("B")?.isCritical, true);
assert.equal(statusedById.get("A")?.totalFloat, -3);
assert.equal(statusedById.get("B")?.totalFloat, -3);
assert.equal(statusedModel.cpmFinishDate, "2026-01-18");
assert.equal(statusedModel.criticalPathReliable, false);
assert.equal(statusedModel.unanchoredOpenFinishCount, 1);
assert.equal(
  statusedModel.criticalPathReliabilityNote.includes(
    "Terminate the completion path at a finish milestone.",
  ),
  true,
);
assert.equal(
  statusedModel.recommendations.includes("Recover 2 activities with negative total float."),
  true,
);

const staleStatusModel = buildConstructLineCpmModel(statusedActivities, {
  dataDate: "2026-01-20",
});
const staleStatusById = new Map(staleStatusModel.tasks.map((task) => [task.dependencyKey, task]));
assert.equal(staleStatusById.get("B")?.statusBasis, "needs_update");

const actualFinishedStatusModel = buildConstructLineCpmModel(
  statusedActivities.map((activity) =>
    activity.activity_id === "A"
      ? {
          ...activity,
          actual_finish_date: "2026-01-08",
          percent_complete: 50,
          remaining_duration_days: 12,
        }
      : activity,
  ),
  { dataDate: "2026-01-09" },
);
const actualFinishedStatusById = new Map(
  actualFinishedStatusModel.tasks.map((task) => [task.dependencyKey, task]),
);
assert.equal(actualFinishedStatusById.get("A")?.statusBasis, "actual");
assert.equal(
  actualFinishedStatusById.get("A")?.remainingDurationDays,
  0,
  "Actual-finished activities should ignore stale remaining duration in CPM status math.",
);

const reciprocalPatches = buildReciprocalActivityLogicPatches(
  {
    id: "b",
    activity_id: "B",
    predecessor_activity_ids: ["A|FS|0"],
    successor_activity_ids: [],
  },
  {
    id: "b",
    activity_id: "B-REV",
    predecessor_activity_ids: ["A|SS|2"],
    successor_activity_ids: ["C|FF|-1"],
  },
  [
    {
      id: "a",
      activity_id: "A",
      predecessor_activity_ids: [],
      successor_activity_ids: ["B|FS|0"],
    },
    {
      id: "b",
      activity_id: "B-REV",
      predecessor_activity_ids: ["A|SS|2"],
      successor_activity_ids: ["C|FF|-1"],
    },
    {
      id: "c",
      activity_id: "C",
      predecessor_activity_ids: [],
      successor_activity_ids: [],
    },
  ],
);
assert.deepEqual(reciprocalPatches, [
  {
    id: "a",
    predecessor_activity_ids: [],
    successor_activity_ids: ["B-REV|SS|2"],
  },
  {
    id: "c",
    predecessor_activity_ids: ["B-REV|FF|-1"],
    successor_activity_ids: [],
  },
]);

const deleteReciprocalPatches = buildReciprocalActivityLogicPatches(
  {
    id: "b",
    activity_id: "B-REV",
    predecessor_activity_ids: ["A|SS|2"],
    successor_activity_ids: ["C|FF|-1"],
  },
  {
    id: "b",
    activity_id: "",
    predecessor_activity_ids: [],
    successor_activity_ids: [],
  },
  [
    {
      id: "a",
      activity_id: "A",
      predecessor_activity_ids: [],
      successor_activity_ids: ["B-REV|SS|2"],
    },
    {
      id: "c",
      activity_id: "C",
      predecessor_activity_ids: ["B-REV|FF|-1"],
      successor_activity_ids: [],
    },
  ],
);
assert.deepEqual(deleteReciprocalPatches, [
  {
    id: "a",
    predecessor_activity_ids: [],
    successor_activity_ids: [],
  },
  {
    id: "c",
    predecessor_activity_ids: [],
    successor_activity_ids: [],
  },
]);

const wbsSections = [
  {
    id: "wbs-milestones",
    project_id: "project",
    name: "Milestones",
    code: "milestones",
    parent_id: null,
    sort_order: 10,
  },
  {
    id: "wbs-concrete",
    project_id: "project",
    name: "03 - Concrete",
    code: "03",
    parent_id: null,
    sort_order: 20,
  },
  {
    id: "wbs-northwest",
    project_id: "project",
    name: "Northwest corner",
    code: "nw",
    parent_id: "wbs-concrete",
    sort_order: 10,
  },
  {
    id: "wbs-southwest",
    project_id: "project",
    name: "Southwest corner",
    code: "sw",
    parent_id: "wbs-concrete",
    sort_order: 20,
  },
  {
    id: "wbs-eastern",
    project_id: "project",
    name: "Eastern corner",
    code: "east",
    parent_id: "wbs-concrete",
    sort_order: 30,
  },
];
const wbsActivities = [
  {
    id: "cnw",
    project_id: "project",
    activity_id: "03-110",
    name: "Pour northwest corner",
    division: "03 - Concrete / Northwest corner",
    start_date: "2026-02-03",
    finish_date: "2026-02-07",
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: 10,
  },
  {
    id: "csw",
    project_id: "project",
    activity_id: "03-120",
    name: "Pour southwest corner",
    division: "03 - Concrete / Southwest corner",
    start_date: "2026-02-10",
    finish_date: "2026-02-14",
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: 20,
  },
  {
    id: "ce",
    project_id: "project",
    activity_id: "03-130",
    name: "Pour eastern corner",
    division: "03 - Concrete / Eastern corner",
    start_date: "2026-02-17",
    finish_date: "2026-02-21",
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: 30,
  },
];
const wbsOrder = buildWbsDivisionOrder(wbsActivities, wbsSections);
assert.deepEqual(wbsOrder.slice(0, 5), [
  "Milestones",
  "03 - Concrete",
  "03 - Concrete / Northwest corner",
  "03 - Concrete / Southwest corner",
  "03 - Concrete / Eastern corner",
]);

const wbsRows = buildWbsDivisionRows(wbsActivities, wbsSections, wbsOrder);
const concreteRow = wbsRows.find((row) => row.division === "03 - Concrete");
assert.equal(concreteRow?.activityCount, 3);
assert.equal(concreteRow?.directActivityCount, 0);
assert.equal(concreteRow?.childCount, 3);
assert.equal(concreteRow?.firstStart, "2026-02-03");
assert.equal(concreteRow?.lastFinish, "2026-02-21");

const concreteChildren = getWbsChildRows(wbsRows, "wbs-concrete").map((row) => row.division);
assert.deepEqual(concreteChildren, [
  "03 - Concrete / Northwest corner",
  "03 - Concrete / Southwest corner",
  "03 - Concrete / Eastern corner",
]);
const wbsPathMap = buildWbsSectionPathMap(wbsSections);
assert.equal(wbsPathMap.get("wbs-concrete"), "03 - Concrete");
assert.equal(wbsPathMap.get("wbs-northwest"), "03 - Concrete / Northwest corner");
assert.equal(
  getImmediateChildWbsTitle("03 - Concrete", "03 - Concrete / Northwest corner / Level 2"),
  "Northwest corner",
);
assert.equal(
  replaceWbsPathInDivision(
    "03 - Concrete / Northwest corner / Level 2",
    "03 - Concrete / Northwest corner",
    "03 - Concrete / North Pour",
  ),
  "03 - Concrete / North Pour / Level 2",
);

const reorderedConcreteChildren = moveWbsDivisionInOrder(
  wbsRows,
  "03 - Concrete / Eastern corner",
  -1,
).map((row) => row.division);
assert.deepEqual(reorderedConcreteChildren, [
  "03 - Concrete / Northwest corner",
  "03 - Concrete / Eastern corner",
  "03 - Concrete / Southwest corner",
]);

const pathFallbackWbsSections = [
  {
    id: "path-concrete",
    project_id: "project",
    name: "03 - Concrete",
    code: "03",
    parent_id: null,
    sort_order: 10,
  },
  {
    id: "path-northwest",
    project_id: "project",
    name: "03 - Concrete / Northwest corner",
    code: "",
    parent_id: null,
    sort_order: 20,
  },
  {
    id: "path-southwest",
    project_id: "project",
    name: "03 - Concrete / Southwest corner",
    code: "",
    parent_id: null,
    sort_order: 30,
  },
];
const pathFallbackRows = buildWbsDivisionRows(
  [],
  pathFallbackWbsSections,
  buildWbsDivisionOrder([], pathFallbackWbsSections),
);
assert.deepEqual(
  getWbsChildRows(pathFallbackRows, "path-concrete").map((row) => row.division),
  ["03 - Concrete / Northwest corner", "03 - Concrete / Southwest corner"],
);
assert.deepEqual(
  moveWbsDivisionInOrder(pathFallbackRows, "03 - Concrete / Southwest corner", -1).map(
    (row) => row.division,
  ),
  ["03 - Concrete / Southwest corner", "03 - Concrete / Northwest corner"],
);

const scheduleRiskSource = readProjectFile("src/components/outcome/ScheduleRisk.tsx");
const scheduleStatusSource = readProjectFile("src/lib/schedule-status.ts");
const scheduleRouteSource = readProjectFile(
  "src/routes/_authenticated/projects.$projectId.schedule.tsx",
);
const scheduleFunctionsSource = readProjectFile("src/lib/schedule.functions.ts");
const templateMigrationSource = readProjectFile(
  "supabase/migrations/20260701012000_schedule_cpm_templates.sql",
);
const nestedWbsRepairMigrationSource = readProjectFile(
  "supabase/migrations/20260701020148_repair_nested_schedule_wbs_sections.sql",
);
const activityUpdateSnapshotsMigrationSource = readProjectFile(
  "supabase/migrations/20260701162000_schedule_activity_update_snapshots.sql",
);
const activityUpdateStatusBasisMigrationSource = readProjectFile(
  "supabase/migrations/20260701183000_schedule_activity_update_status_basis.sql",
);
const stylesSource = readProjectFile("src/styles.css");

for (const requiredScheduleRiskText of [
  "Open full schedule workspace",
  "Critical Path Report",
  "Company: {contractorName}",
  "{printReportLabel} · {criticalBasisLabel} · Finish",
  "constructline-cpm-print-status-critical",
  "constructline-cpm-print-status-recovery",
  "Critical path finish {shortDate(displayedCpmModel.cpmFinishDate)}",
  "Legend: critical red",
  "Schedule snapshot",
  "CpmNetworkBasisStrip",
  "CPM basis",
  "Provisional",
  "Open starts",
  "Open finishes",
  "Finish anchor",
  "finish anchor needed",
  "Finish anchor missing",
  "Create a finish milestone",
  "Negative float",
  "formatCpmEndpointTitle",
  "View filters",
  "Schedule actions",
  "CONSTRUCTLINE_TABLE_COLUMN_SPECS",
  "resizeTableColumnWidthsToTarget",
  "startTableSplitResize",
  "Resize activity table and Gantt split",
  "Drag to give more space to the activity table or Gantt chart",
  "Drag left or right to compress or expand the Gantt timeline.",
  "Needs update",
  "Show needs update",
  "Open next update row",
  "Data-date update queue",
  "Save & next update row",
  "Save & close queue",
  "Needs data-date update",
  "CPM Update Queue Report",
  "Work this queue row by row",
  "taskIsInDataDateUpdateWindow",
  "Concrete / Northwest corner",
  "Southwest corner",
  "Eastern corner",
  "WBS / areas",
  "WBS / area manager",
  "Add child area",
  "scrollActivityDraftIntoView",
  "draftFormRef",
  "scroll-mt-28",
  "Substantial completion milestone",
  "Completion milestone created from the CPM workspace",
  "Open-finish activities were tied to this milestone",
  "Nest under",
  "Drop here to make top-level WBS",
  "Custom WBS / child area path",
  "Use activity WBS fields for now",
  "Activity-path WBS mode is active",
  "Schedule update history",
  "Activity snapshots will appear on the next saved CPM update.",
  "ACTIVITY_UPDATE_SNAPSHOT_COLUMNS",
  "buildActivityUpdateSnapshotSummaries",
  "groupActivityUpdateSnapshots",
  "View activity snapshot",
  "formatActivityUpdateSnapshotStatus",
  "formatActivityUpdateStatusBasisLabel",
  "formatActivityUpdateStatusBasisTitle",
  "getActivityUpdateStatusBasisClass",
  "needs update basis",
  "Showing 10 of",
  "Data-date update readiness",
  "buildScheduleUpdateReadiness",
  "updateWindowCount",
  "Update window",
  "open total",
  "Set the data date",
  "Save the CPM update snapshot",
  "Remaining duration missing",
  "Expected finish missing",
  "isConstructLineMilestoneActivity(activity)",
  "hasScheduleActivityStarted(activity)",
  "Start or forecast needed",
  "remaining duration not required",
  "Remaining duration is only required after an actual start",
  "Progress is entered but actual start is missing",
  "remaining duration unlocks after actual start",
  "Current forecast",
  "not started",
  "forecast dates control",
  "Forecast point",
  "zero-duration point",
  "Milestones are zero-duration schedule points.",
  "Milestones stay at zero duration.",
  "Milestone duration",
  '? "met"',
  ': "point"',
  "needs remaining",
  "needs finish",
  "needs actual start",
  "needs update",
  "shouldFlagMissingRemainingDuration",
  "shouldFlagMissingExpectedFinish",
  "shouldFlagMissingActualStart",
  "taskNeedsStatusUpdateBasis",
  "Needs update basis",
  "Update actuals, current start, or expected finish",
  "formatTaskStatusBasisLabel",
  'return "remain";',
  'return "forecast";',
  "formatTaskStatusBasisTitle",
  "getTaskStatusBasisClass",
  "Current schedule is based on entered remaining duration from the data date.",
  "This incomplete activity is past its expected finish.",
  "Show active rows",
  "status fields present",
  "CPM update has status gaps",
  "Click Save snapshot to save anyway",
  "Status gaps acknowledged",
  "Save again after activity changes",
  "hasSameDateReadinessWarning",
  "Update rule:",
  "updateDraftActualStartDate",
  "updateDraftActualFinishDate",
  "updateDraftForecastStartDate",
  "updateDraftPercentComplete",
  "setDraft(updateDraftActualStartDate(draft, e.target.value, dataDate))",
  "setDraft(updateDraftActualFinishDate(draft, e.target.value, dataDate))",
  "setDraft(updateDraftForecastStartDate(draft, e.target.value, dataDate))",
  "setDraft(updateDraftPercentComplete(draft, e.target.value, dataDate))",
  "Unstarted work is forecast with current start and current expected finish",
  "Schedule variance",
  "Duration",
  "Activity description",
  "Planned dates",
  "Actual / current dates",
  "Percent complete",
  "Total float",
  "Original planned duration and remaining duration",
  "Current start and expected finish.",
  "MatrixHeaderCell",
  'const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION = "v7"',
  'const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_NAMESPACE = "constructline:cpm-grid-layout"',
  'type ConstructLineGridLayoutPreset = "gantt" | "balanced" | "detail"',
  "buildDefaultTableColumnWidths",
  "buildTableColumnWidthsForPreset",
  "buildTableColumnTemplate(columnWidths)",
  "getCpmGridLayoutStorageKey",
  "getTableColumnLayoutStorageKeys",
  "readStoredGridLayoutRecord",
  "parseStoredTableColumnWidths",
  "readStoredGridDayPx",
  "writeStoredGridLayout",
  "writeStoredGridLayout(cpmGridLayoutStorageKey, { dayPx })",
  "readTableColumnWidths(layoutStorageKey, isFocusMode)",
  "writeTableColumnWidths(layoutStorageKey, columnWidths)",
  "resetGridLayout",
  "Reset grid",
  "applyGridLayoutPreset",
  "Gantt first",
  "Balanced",
  "Details",
  "startColumnResize",
  "Resize column",
  "startTableSplitResize",
  "Resize activity table and Gantt split",
  "showBaselineBars",
  "onToggleBaselineBars",
  "Baseline",
  "activityColumnWidth",
  "estimateActivityNameLines(name, isPrintMode, activityColumnWidth)",
  "showTemplateTools",
  "draftEditor",
  "constructline-cpm-matrix-editor",
  "New completion milestone",
  "Milestone form opened",
  "Milestone form is open.",
  "Jump to form",
  "Saving milestone...",
  "activityDraftMode",
  "onFocusActivityDraft",
  "Save milestone",
  "Update basis",
  "saved update basis",
  "inferred, not saved",
  "Missing",
  "Data date",
  "Original planned baseline start and baseline finish.",
  "constructline-baseline-legend-swatch",
  "constructline-baseline-bar",
  "constructline-baseline-diamond",
  "Baseline milestone",
  "Slip",
  "Drivers:",
  "Negative float drivers:",
  "slipped activities",
  "worst ${formatFinishVarianceDays(activitySummary.worstSlippageDays)}",
  "negative-float activities",
  "worst ${activitySummary.worstTotalFloatDays}d TF",
  "Interim milestones",
  "Critical delayed decisions",
  "Procurement risks",
  "Trade performance risks",
  "1 week lookahead",
  "2 week lookahead",
  "6 week lookahead",
  "Recovery",
  "recovery",
  "1-Week Lookahead Report",
  "2-Week Lookahead Report",
  "6-Week Lookahead Report",
  "Recovery Schedule Report",
  "Recovery needed",
  "lookahead_1w: 7",
  "lookahead_2w: 14",
  "lookahead_6w: 42",
  "filterConstructLineCpmModel",
  "useState(true)",
  'useState<ScheduleActivityOrder>("start")',
  'useState<ScheduleGridView>("all")',
  "Planned",
  "Baseline finish",
  "Remaining",
  "Basis",
  "Current start",
  "Expected finish",
  "Variance",
  "getActivityMatrixTaskRowHeight",
  "estimateActivityNameLines",
  "countActivityMatrixFlags",
  "CONSTRUCTLINE_FIT_DAY_PX",
  "CpmDataDateControl",
  "Review gaps",
  "Save snapshot",
  "Runs the update view",
  "Save the snapshot after status review",
  "Snapshot saved",
  "updates = EMPTY_SCHEDULE_UPDATES",
  "const workbenchDraft = buildCpmScheduleUpdateDraft",
  "previousUpdate: latestScheduleUpdate",
  "milestone_forecasts: workbenchDraft.milestone_forecasts",
  "Save current CPM as template",
  "Use template",
  "BROWSER_CPM_TEMPLATE_STORAGE_KEY",
  "saveBrowserTemplate",
  "buildBrowserCpmTemplateWbsSections",
  "normalizeBrowserCpmTemplateWbsSections",
  "saved WBS paths and logic ties",
  "templateSave",
  "templateImport",
  "Private browser templates are active",
  "Template saved in this browser",
  "Send to Risk Tally",
  "createActivityExposureFn",
  "activityRiskCreate",
  "buildActivityRiskDescription",
  "schedule_impact_weeks: scheduleImpactWeeks",
  "dollar_exposure: 0",
  "Logged open delay",
  "Carried in forecast",
  "Still not carried",
  "Delay fragments document why time was lost",
  "carried inside the current expected finish",
  "not yet carried into the current expected finish",
  "buildDelayExtensionFinishDates",
  "delayExtensionFinishDates",
  "constructline-delay-extension",
  "constructline-delay-marker",
  "constructline-delay-label",
  "constructline-delay-legend-swatch",
  "hatched delay",
  "delay period",
  'matrixId="cpm-grid"',
  "isFocusOpen",
  "WBS order",
  "Order already changed in the grid; final save is confirming in the background.",
]) {
  assert.ok(
    scheduleRiskSource.includes(requiredScheduleRiskText),
    `ScheduleRisk is missing required CPM workspace text: ${requiredScheduleRiskText}`,
  );
}

for (const requiredScheduleStatusText of [
  "getScheduleStatusAnchorDate",
  "updateScheduleStatusRemainingDuration",
  "updateScheduleStatusForecastFinishDate",
  "updateScheduleStatusActualStartDate",
  "updateScheduleStatusActualFinishDate",
  "updateScheduleStatusForecastStartDate",
  "updateScheduleStatusPercentComplete",
  "Math.max(dataDateMs, currentStartMs)",
  "percentComplete > 0 || draft.actual_start_date",
]) {
  assert.ok(
    scheduleStatusSource.includes(requiredScheduleStatusText),
    `Schedule status helper is missing required CPM update math: ${requiredScheduleStatusText}`,
  );
}

assert.match(
  scheduleRiskSource,
  /setScheduleView\("update_queue"\);[\s\S]{0,500}toast\.warning\("CPM update has status gaps"/,
  "Data-date status-gap warning should switch directly to the Needs update queue.",
);

assert.match(
  scheduleRiskSource,
  /const updateWindowTasks = openTasks\.filter\(\(task\) =>[\s\S]{0,180}taskIsInDataDateUpdateWindow\(task, referenceDate\)/,
  "CPM update readiness should filter rows through the data-date update window.",
);
assert.match(
  scheduleRiskSource,
  /readyTaskCount: Math\.max\(0, updateWindowTasks\.length - sortedItems\.length\)/,
  "CPM update readiness should calculate ready rows from the same data-date update window as status-gap rows.",
);

assert.match(
  scheduleRiskSource,
  /function shouldFlagMissingRemainingDuration\(activity: ScheduleActivityRow\) \{[\s\S]*?isConstructLineMilestoneActivity\(activity\)[\s\S]*?!hasScheduleActivityActualStartBasis\(activity\)[\s\S]*?activity\.remaining_duration_days == null[\s\S]*?!activity\.forecast_finish_date/s,
  "Missing remaining duration should only be flagged after actual start and when no current expected finish exists.",
);
assert.match(
  scheduleRiskSource,
  /const percentComplete = parsePercent\(draft\.percent_complete\);[\s\S]*?const draftHasActualStartBasis =[\s\S]*?remaining_duration_days: draft\.is_milestone[\s\S]*?\? 0[\s\S]*?: draftHasActualStartBasis[\s\S]*?\? parseRemainingDuration\(draft\.remaining_duration_days\)[\s\S]*?: null/s,
  "New CPM activities should not save remaining duration until the activity has an actual-start basis.",
);

for (const removedScheduleRiskText of [
  "function ConstructLinePrintReport",
  "constructline-print-summary",
  "constructline-print-kpis",
  "disabled={!value || isSaving || !isDirty}",
]) {
  assert.ok(
    !scheduleRiskSource.includes(removedScheduleRiskText),
    `ScheduleRisk still contains removed legacy print surface: ${removedScheduleRiskText}`,
  );
}

for (const removedStyleText of [
  "constructline-print-report",
  "constructline-print-summary",
  "constructline-print-kpis",
  "constructline-print-grid",
]) {
  assert.ok(
    !stylesSource.includes(removedStyleText),
    `Styles still contain removed legacy print selector: ${removedStyleText}`,
  );
}

for (const requiredScheduleRouteText of [
  "queueWbsReorder",
  "wbsOrderSaveTimerRef",
  "applyOptimisticWbsOrderChange",
  "applyWbsOrderToSections",
  "const queuedOrder = wbsQueuedOrderRef.current;",
  "WBS_ORDER_SAVE_DEBOUNCE_MS = 75",
  "WBS order applied",
  'toast.success("WBS order applied"',
  "Final save is confirming in the background.",
  'void qc.cancelQueries({ queryKey: ["schedule", projectId] });',
  "Child WBS added",
  "WBS title applied",
  "WBS nested",
  "The grid moved immediately. Saving in the background.",
  "applyOptimisticWbsPathChange",
  'await qc.cancelQueries({ queryKey: ["schedule", projectId] });',
  "Schedule operations",
  "constructline-workspace-status",
  "CPM table + Gantt",
  "Logic ties",
  "Open risks",
  "overflow-x-clip",
  "scroll-mt-28",
  "Critical delayed decisions",
  "Procurement risks",
  "Trade performance risks",
  "Use Notes / Constraint for the delay narrative",
  'workspaceMode="full"',
  "activityCreate.mutateAsync(activity)",
  "onSuccess: async",
  "await refreshSchedule();",
  "Activity updated",
  "The CPM row and logic ties were saved.",
  "activityCreate.isPending || activityUpdate.isPending",
  "updates={updates}",
  "activityUpdates={activityUpdates}",
  "activity snapshots",
  "The CPM update fields did not save. Refresh once and save again; baseline dates, WBS, notes, and logic can still save normally.",
]) {
  assert.ok(
    scheduleRouteSource.includes(requiredScheduleRouteText),
    `Schedule route is missing required CPM workspace text: ${requiredScheduleRouteText}`,
  );
}

for (const requiredScheduleFunctionText of [
  "const uniqueActivityDivisions = Array.from(",
  "await ensureScheduleWbsPath(context.supabase, data.projectId, division);",
  '.select("id,parent_id,sort_order,name")',
  "name: row.name",
  '.from("schedule_wbs_sections")',
  '.upsert(payload, { onConflict: "id" })',
  '{ onConflict: "id" }',
  "listScheduleCpmTemplates",
  "saveCurrentScheduleAsCpmTemplate",
  "importScheduleCpmTemplate",
  "schedule_cpm_templates",
  "path_fallback",
  "ensureScheduleWbsPathLabel",
  "syncPathBasedWbsSectionNamesForPathChange",
  "path: str(row.path, name)",
  "scheduleWbsTemplatePayload(section, wbsPathMap.get(section.id) ?? section.name)",
  "section.path || section.name",
  '.select("parent_id")',
  "wbsNestedColumnsMissing",
  "snapshotScheduleActivityUpdates",
  "schedule_activity_updates",
  "normalizeScheduleActivityUpdate",
  "activityUpdates",
  "status_basis",
  "normalizeActivityUpdateStatusBasis",
  "total_float_days",
  "is_out_of_sequence",
  "is_open_finish",
  "const { wbs_section_id: requestedWbsSectionId, ...activityFields } = rest;",
  "insertScheduleActivityRowWithSchemaFallback(",
  "basePayload as Record<string, unknown>",
  "const { error: wbsLinkError } = await context.supabase",
  "update({ wbs_section_id: wbsSectionId })",
  "stripScheduleActivityMissingColumns(",
  "includesScheduleActivityStatusColumn",
  "requestedStatusUpdate && isMissingScheduleActivityStatusColumn(error)",
  "constructline:activity-status-v1",
  "readScheduleActivityStatusFallback",
  "writeScheduleActivityStatusFallback",
  "fallbackPatch.notes = writeScheduleActivityStatusFallback",
  "fallback.notes",
  "isScheduleActivitySchemaFallbackError",
  "insertScheduleActivityRowsWithSchemaFallback",
  "insertScheduleActivityRowWithSchemaFallback",
  "updateScheduleActivityWithSchemaFallback",
  "while (result.error && attempts < 3 && isScheduleActivitySchemaFallbackError(result.error))",
  "while (error && attempts < 3 && isScheduleActivitySchemaFallbackError(error))",
  "shouldWriteStatusFallback",
  "writeScheduleActivityStatusFallback(fallbackRow.notes, originalRow)",
]) {
  assert.ok(
    scheduleFunctionsSource.includes(requiredScheduleFunctionText),
    `Schedule functions are missing required WBS persistence contract: ${requiredScheduleFunctionText}`,
  );
}

for (const requiredActivityUpdateSnapshotMigrationText of [
  "CREATE TABLE IF NOT EXISTS public.schedule_activity_updates",
  "schedule_update_id uuid NOT NULL REFERENCES public.schedule_updates(id) ON DELETE CASCADE",
  "total_float_days integer NOT NULL DEFAULT 0",
  "is_out_of_sequence boolean NOT NULL DEFAULT false",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_activity_updates TO authenticated",
  "public.can_read_project(project_id)",
  "public.can_manage_project(project_id)",
]) {
  assert.ok(
    activityUpdateSnapshotsMigrationSource.includes(requiredActivityUpdateSnapshotMigrationText),
    `Activity update snapshot migration is missing required contract: ${requiredActivityUpdateSnapshotMigrationText}`,
  );
}

for (const requiredActivityUpdateStatusBasisMigrationText of [
  "ADD COLUMN IF NOT EXISTS status_basis",
  "schedule_activity_updates_status_basis_check",
  "'remaining_duration'",
  "'expected_finish'",
  "'needs_update'",
  "schedule_activity_updates_status_basis_idx",
]) {
  assert.ok(
    activityUpdateStatusBasisMigrationSource.includes(
      requiredActivityUpdateStatusBasisMigrationText,
    ),
    `Activity update status-basis migration is missing required contract: ${requiredActivityUpdateStatusBasisMigrationText}`,
  );
}

for (const requiredTemplateMigrationText of [
  "CREATE TABLE IF NOT EXISTS public.schedule_cpm_templates",
  "activities jsonb NOT NULL DEFAULT '[]'::jsonb",
  "wbs_sections jsonb NOT NULL DEFAULT '[]'::jsonb",
  "public.can_read_project(project_id)",
  "public.can_manage_project(project_id)",
]) {
  assert.ok(
    templateMigrationSource.includes(requiredTemplateMigrationText),
    `Template migration is missing required CPM template contract: ${requiredTemplateMigrationText}`,
  );
}

for (const requiredNestedWbsRepairText of [
  "ADD COLUMN IF NOT EXISTS parent_id",
  "ADD COLUMN IF NOT EXISTS wbs_section_id",
  "CREATE OR REPLACE FUNCTION public.reorder_schedule_wbs_sections",
  "GRANT EXECUTE ON FUNCTION public.reorder_schedule_wbs_sections",
  "CREATE TABLE IF NOT EXISTS public.schedule_cpm_templates",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_cpm_templates TO authenticated",
  "CREATE POLICY schedule_cpm_templates_team_insert",
]) {
  assert.ok(
    nestedWbsRepairMigrationSource.includes(requiredNestedWbsRepairText),
    `Nested WBS repair migration is missing required contract: ${requiredNestedWbsRepairText}`,
  );
}

assert.equal(
  scheduleFunctionsSource.includes(".filter((section) => section.parent_id == null)"),
  false,
  "Derived WBS seeding must persist child sections, not only top-level sections.",
);

assert.equal(
  /Promise\.all\(\s*changedRows\.map/.test(scheduleFunctionsSource),
  false,
  "WBS reorder fallback must batch save changed rows instead of firing one update per row.",
);

const printMatrixIndex = scheduleRiskSource.indexOf("isPrintMode");
const screenGridAnchorIndex = scheduleRiskSource.indexOf('matrixId="cpm-grid"');
assert.ok(
  screenGridAnchorIndex > printMatrixIndex,
  "The visible screen CPM matrix must own the cpm-grid anchor, not the print-only matrix.",
);

assert.ok(
  scheduleRiskSource.includes("const [showLogicLines, setShowLogicLines] = useState(true);"),
  "Logic lines must be on by default in the CPM schedule.",
);

assert.ok(
  scheduleRiskSource.includes(
    "useState<number>(() => readStoredGridDayPx(cpmGridLayoutStorageKey))",
  ) && scheduleRiskSource.includes(": CONSTRUCTLINE_FIT_DAY_PX"),
  "The CPM schedule must open in Fit scale by default when no saved layout exists.",
);

assert.ok(
  scheduleRiskSource.includes(
    'const [activityOrder, setActivityOrder] = useState<ScheduleActivityOrder>("start");',
  ),
  "The CPM schedule must open in start-date order by default.",
);

for (const requiredPrintStyle of [
  ".constructline-cpm-print-footer",
  ".constructline-cpm-print-report-strip",
  ".constructline-cpm-print-footer-report",
  ".constructline-delay-extension",
  ".constructline-delay-marker",
  ".constructline-delay-label",
  ".constructline-delay-legend-swatch",
  ".constructline-schedule-page main > :not(.constructline-cpm-print-shell)",
  "repeating-linear-gradient",
  "size: 17in 11in",
]) {
  assert.ok(
    stylesSource.includes(requiredPrintStyle),
    `Print styles are missing required CPM report contract: ${requiredPrintStyle}`,
  );
}

assert.equal(
  /Lovable still needs|Lovable needs delay|schedule_delay_fragments migration/i.test(
    `${scheduleRiskSource}\n${scheduleRouteSource}`,
  ),
  false,
  "CPM schedule UI must not expose Lovable migration wording to users.",
);

assert.equal(
  /being enabled|hierarchy upgrade is applied|after setup is complete|WBS setup is not enabled|schedule database needs/i.test(
    `${scheduleRiskSource}\n${scheduleRouteSource}\n${scheduleFunctionsSource}`,
  ),
  false,
  "CPM schedule UI must not expose setup or migration-state wording to users.",
);

assert.equal(
  /shared template library is enabled|enable the template table/i.test(
    `${scheduleRiskSource}\n${scheduleFunctionsSource}`,
  ),
  false,
  "CPM template fallback must use user-facing browser template language, not backend setup wording.",
);

console.log("ConstructLine CPM smoke checks passed.");
