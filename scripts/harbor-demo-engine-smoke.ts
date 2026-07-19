import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HARBOR_DEMO_COMMERCIAL_WORKFLOW,
  HARBOR_DEMO_MODULES,
  planHarborDemoModules,
} from "../src/lib/demo-seed.ts";
import { HARBOR_IOR_FLOW, HARBOR_ONBOARDING_LESSONS } from "../src/lib/harbor-onboarding.ts";

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
assert.equal(
  HARBOR_DEMO_MODULES.find((module) => module.key === "billing-workspace")?.dependsOn.includes(
    "production-control",
  ),
  true,
);

assert.equal(HARBOR_IOR_FLOW.length, 4, "The IOR explainer must keep one short four-part story.");
assert.equal(
  HARBOR_ONBOARDING_LESSONS.length,
  HARBOR_DEMO_MODULES.length,
  "Every registered Harbor module needs one guided lesson.",
);
assert.deepEqual(
  [...HARBOR_ONBOARDING_LESSONS.map((lesson) => lesson.moduleKey)].sort(),
  [...moduleKeys].sort(),
  "Guided lessons must cover each Harbor module exactly once.",
);
assert.equal(
  new Set(HARBOR_ONBOARDING_LESSONS.map((lesson) => lesson.moduleKey)).size,
  HARBOR_ONBOARDING_LESSONS.length,
  "A Harbor module cannot appear twice in the walkthrough.",
);
assert.ok(
  HARBOR_ONBOARDING_LESSONS.every((lesson) => lesson.steps.length === 3),
  "Each contractor lesson must stay to three short actions.",
);
assert.ok(
  HARBOR_ONBOARDING_LESSONS.every((lesson) => !lesson.target.tab.includes("estimat")),
  "Estimating remains outside guided onboarding until its workflow is stable.",
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
assert.match(projectsSource, /ensureHarborDemoBillingWorkspace/);
assert.match(projectsSource, /Progress payment #1/);
assert.match(projectsSource, /Supplemental finishing crew/);
assert.match(projectsSource, /the PM certifies production in Daily WIP; accounting chooses/);
assert.match(projectsSource, /Production measure: LF of conduit per labor-hour/);

const onboardingSource = readFileSync(
  "src/components/project/onboarding/HarborStartHere.tsx",
  "utf8",
);
assert.match(onboardingSource, /getHarborDemoModuleStatus/);
assert.match(onboardingSource, /resetHarborDemoModule/);
assert.match(onboardingSource, /overwatch:harbor-start-here:/);
assert.match(onboardingSource, /motion-safe:animate-in/);
assert.match(onboardingSource, /variant="signal"/);
assert.match(onboardingSource, /Nothing here bypasses normal permissions/);
assert.doesNotMatch(onboardingSource, /#[0-9a-f]{3,8}/i, "Onboarding must use theme tokens.");

const projectRouteSource = readFileSync(
  "src/routes/_authenticated/projects.$projectId.tsx",
  "utf8",
);
assert.match(projectRouteSource, /value="start-here"/);
assert.match(projectRouteSource, /isDemoProject \? \(/);
assert.match(projectRouteSource, /<HarborStartHere/);

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

console.log("Harbor demo engine smoke passed.");
