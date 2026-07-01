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
const stylesSource = readProjectFile("src/styles.css");

for (const requiredScheduleRiskText of [
  "Open full schedule workspace",
  "Critical Path Report",
  "Company: {contractorName}",
  "Legend: critical red",
  "Schedule snapshot",
  "View filters",
  "Schedule actions",
  "Schedule operations bench",
  "Construction schedule workspace",
  "Concrete / Northwest corner",
  "Southwest corner",
  "Eastern corner",
  "WBS / areas",
  "WBS / area manager",
  "Add child area",
  "Nest under",
  "Drop here to make top-level WBS",
  "Custom WBS / child area path",
  "Saved WBS manager is unavailable",
  "WBS path mode is active",
  "Schedule update history",
  "Interim milestones",
  "Critical delayed decisions",
  "Procurement risks",
  "Trade performance risks",
  "1 week lookahead",
  "2 week lookahead",
  "6 week lookahead",
  "lookahead_1w: 7",
  "lookahead_2w: 14",
  "lookahead_6w: 42",
  "filterConstructLineCpmModel",
  "Save current CPM as template",
  "Use template",
  "BROWSER_CPM_TEMPLATE_STORAGE_KEY",
  "saveBrowserTemplate",
  "templateSave",
  "templateImport",
  "Browser template mode is active",
  "Template saved in this browser",
  "Send to Risk Tally",
  "createActivityExposureFn",
  "activityRiskCreate",
  "buildActivityRiskDescription",
  "schedule_impact_weeks: scheduleImpactWeeks",
  "dollar_exposure: 0",
  "delay days extend past the current activity bar",
  "buildDelayExtensionFinishDates",
  "delayExtensionFinishDates",
  "constructline-delay-extension",
  "constructline-delay-marker",
  "delay extension",
  "Order applied in the grid; final save is confirming now.",
]) {
  assert.ok(
    scheduleRiskSource.includes(requiredScheduleRiskText),
    `ScheduleRisk is missing required CPM workspace text: ${requiredScheduleRiskText}`,
  );
}

for (const requiredScheduleRouteText of [
  "queueWbsReorder",
  "wbsOrderSaveTimerRef",
  "applyOptimisticWbsOrderChange",
  "WBS_ORDER_SAVE_DEBOUNCE_MS = 75",
  "WBS order applied",
  "Saving the final order.",
  "Child WBS added",
  "WBS title applied",
  "WBS nested",
  "The grid moved immediately. Saving in the background.",
  "applyOptimisticWbsPathChange",
  'await qc.cancelQueries({ queryKey: ["schedule", projectId] });',
  "Schedule operations",
  "overflow-x-clip",
  "scroll-mt-28",
  "Critical delayed decisions",
  "Procurement risks",
  "Trade performance risks",
  "Use Notes / Constraint for the delay narrative",
  'workspaceMode="full"',
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
]) {
  assert.ok(
    scheduleFunctionsSource.includes(requiredScheduleFunctionText),
    `Schedule functions are missing required WBS persistence contract: ${requiredScheduleFunctionText}`,
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

for (const requiredPrintStyle of [
  ".constructline-cpm-print-footer",
  ".constructline-cpm-print-report-strip",
  ".constructline-cpm-print-footer-report",
  ".constructline-delay-extension",
  ".constructline-delay-marker",
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
  /being enabled|hierarchy upgrade is applied|after setup is complete/i.test(
    `${scheduleRiskSource}\n${scheduleRouteSource}`,
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
