import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HARBOR_DEMO_COMMERCIAL_WORKFLOW,
  HARBOR_DEMO_MODULES,
  planHarborDemoModules,
} from "../src/lib/demo-seed.ts";
import {
  HARBOR_DEMO_PRODUCTION_DAYS,
  HARBOR_DEMO_TOMORROW_PLAN_DATE,
} from "../src/lib/harbor-production-demo.ts";

const moduleKeys = HARBOR_DEMO_MODULES.map((module) => module.key);
assert.equal(new Set(moduleKeys).size, moduleKeys.length, "Demo module keys must be unique.");

for (const [index, module] of HARBOR_DEMO_MODULES.entries()) {
  assert.ok(module.version > 0, `${module.key} must have a positive version.`);
  for (const dependency of module.dependsOn) {
    assert.ok(
      moduleKeys.indexOf(dependency) < index,
      `${module.key} must run after its dependency ${dependency}.`,
    );
  }
}

const emptyPlan = planHarborDemoModules([]);
assert.ok(emptyPlan.every((module) => module.status === "missing"));

const mixedPlan = planHarborDemoModules([
  { module_key: "project-foundation", applied_version: 1, status: "ready" },
  { module_key: "cpm-schedule", applied_version: 0, status: "ready" },
  { module_key: "daily-wip-cpm-evidence", applied_version: 1, status: "failed" },
]);
assert.equal(mixedPlan.find((module) => module.key === "project-foundation")?.status, "current");
assert.equal(mixedPlan.find((module) => module.key === "cpm-schedule")?.status, "upgrade");
assert.equal(mixedPlan.find((module) => module.key === "daily-wip-cpm-evidence")?.status, "failed");
assert.equal(mixedPlan.find((module) => module.key === "claims")?.status, "missing");

assert.deepEqual(
  HARBOR_DEMO_COMMERCIAL_WORKFLOW.subcontractors.map((subcontractor) => subcontractor.costCode),
  ["1500", "0300", "0900"],
);
assert.equal(HARBOR_DEMO_COMMERCIAL_WORKFLOW.productionMeasure, "LF");
assert.equal(HARBOR_DEMO_COMMERCIAL_WORKFLOW.productionTargetRate, 7.5);
assert.equal(HARBOR_DEMO_COMMERCIAL_WORKFLOW.productionPeriod.start, "2026-06-02");
assert.equal(HARBOR_DEMO_PRODUCTION_DAYS.length, 30);
assert.equal(HARBOR_DEMO_TOMORROW_PLAN_DATE, "2026-07-14");
assert.ok(
  HARBOR_DEMO_PRODUCTION_DAYS.every((day) => {
    const weekday = new Date(`${day.date}T12:00:00Z`).getUTCDay();
    return weekday !== 0 && weekday !== 6;
  }),
  "The Harbor production history must contain working days only.",
);
assert.deepEqual(
  Array.from(
    new Set(HARBOR_DEMO_PRODUCTION_DAYS.flatMap((day) => day.lines.map((line) => line.key))),
  ).sort(),
  ["concrete", "drywall", "electrical"],
);
assert.equal(HARBOR_DEMO_MODULES.find((module) => module.key === "daily-reports-wip")?.version, 2);
assert.equal(HARBOR_DEMO_MODULES.find((module) => module.key === "production-control")?.version, 2);
assert.equal(
  HARBOR_DEMO_MODULES.find((module) => module.key === "tomorrow-plan")?.dependsOn.includes(
    "daily-reports-wip",
  ),
  true,
);
assert.equal(
  HARBOR_DEMO_MODULES.find((module) => module.key === "billing-workspace")?.dependsOn.includes(
    "production-control",
  ),
  true,
);

const projectsSource = readFileSync("src/lib/projects.functions.ts", "utf8");
assert.match(projectsSource, /ensureVersionedHarborDemoModules/);
assert.match(projectsSource, /export const resetHarborDemoModule/);
assert.match(projectsSource, /resetHarborDemoModuleFixtures/);
assert.match(projectsSource, /satisfies Record<HarborDemoModuleKey/);
assert.match(projectsSource, /status: warnings\.length === 0 \? "ready" : "failed"/);
assert.match(
  projectsSource,
  /if \(registryAvailable && !moduleNeedsUpgrade\(module\.key\)\)/,
  "Current Harbor module versions must not rerun their write-heavy adapters on every visit.",
);
assert.match(projectsSource, /harborDemoSeedAction\(existingDemo\) === "skip"/);
assert.match(projectsSource, /\.in\("project_manager", \["", "Overwatch Demo PM"\]\)/);
assert.doesNotMatch(
  projectsSource,
  /const alreadySeeded = existingActivityIds\.has\(HARBOR_DEMO_FIRST_CPM_ACTIVITY_ID\)/,
  "The CPM adapter must fill any missing canonical activity instead of trusting one sentinel row.",
);
assert.match(projectsSource, /last_operation: "reset"/);
assert.match(projectsSource, /Only Harbor Residence demo modules can be reset/);
assert.match(projectsSource, /can_manage_project/);

const getProjectSource = projectsSource.slice(
  projectsSource.indexOf("export const getProject"),
  projectsSource.indexOf("// ---------------- PROJECT CRUD ----------------"),
);
assert.doesNotMatch(
  getProjectSource,
  /ensureVersionedHarborDemoModules/,
  "Opening a project must not execute Harbor fixture maintenance in the render-critical loader.",
);
assert.match(projectsSource, /ensureHarborDemoBudgetSov/);
assert.match(projectsSource, /ensureHarborDemoSubcontractBuyout/);
assert.match(projectsSource, /ensureHarborDemoDailyReportsWip/);
assert.match(projectsSource, /ensureHarborDemoTomorrowPlan/);
assert.match(projectsSource, /ensureHarborDemoBillingWorkspace/);
assert.match(projectsSource, /Progress payment #1/);
assert.match(projectsSource, /Supplemental finishing crew/);
assert.match(projectsSource, /the PM certifies production in Daily WIP; accounting chooses/);
assert.match(projectsSource, /Production measure: \$\{line\.unit\} installed per labor-hour/);

const migrationSource = readFileSync(
  "supabase/migrations/20260715221232_harbor_demo_module_versions.sql",
  "utf8",
);
assert.match(migrationSource, /create table if not exists public\.demo_seed_module_versions/i);
assert.match(migrationSource, /primary key \(project_id, module_key\)/i);
assert.match(migrationSource, /enable row level security/i);
assert.match(migrationSource, /can_read_project\(project_id\)/i);
assert.match(migrationSource, /can_manage_project\(project_id\)/i);
assert.match(
  migrationSource,
  /revoke all on table public\.demo_seed_module_versions from public, anon/i,
);

const tomorrowPlanMigration = readFileSync(
  "supabase/migrations/20260719172142_tomorrow_plan.sql",
  "utf8",
);
assert.match(tomorrowPlanMigration, /create table if not exists public\.tomorrow_plan_items/i);
assert.match(tomorrowPlanMigration, /enable row level security/i);
assert.match(tomorrowPlanMigration, /to authenticated[\s\S]*can_read_project\(project_id\)/i);
assert.match(tomorrowPlanMigration, /can_manage_project\(project_id\)/i);
assert.match(
  tomorrowPlanMigration,
  /revoke all on table public\.tomorrow_plan_items from public, anon/i,
);

console.log("Harbor demo engine smoke passed.");
