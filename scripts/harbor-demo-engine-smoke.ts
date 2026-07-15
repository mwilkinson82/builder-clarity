import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HARBOR_DEMO_MODULES, planHarborDemoModules } from "../src/lib/demo-seed.ts";

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

const projectsSource = readFileSync("src/lib/projects.functions.ts", "utf8");
assert.match(projectsSource, /ensureVersionedHarborDemoModules/);
assert.match(projectsSource, /export const resetHarborDemoModule/);
assert.match(projectsSource, /resetHarborDemoModuleFixtures/);
assert.match(projectsSource, /satisfies Record<HarborDemoModuleKey/);
assert.match(projectsSource, /status: warnings\.length === 0 \? "ready" : "failed"/);
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
