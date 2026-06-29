import assert from "node:assert/strict";
import {
  buildConstructLineCpmModel,
  describeConstructLineDependencyToken,
  formatConstructLineDependencyToken,
  parseConstructLineDependencyToken,
} from "../src/lib/constructline-cpm.ts";

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
];

const model = buildConstructLineCpmModel(activities, {
  dataDate: "2026-01-04",
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
assert.equal(byId.get("MS-001")?.totalFloat, 0);
assert.equal(byId.get("C")?.isNearCritical, true);
assert.equal(byId.get("C")?.isCritical, false);

console.log("ConstructLine CPM smoke checks passed.");
