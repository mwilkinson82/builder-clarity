// CRM pipeline smoke checks. Run with: npm run test:crm
// Exercises the pure CRM demo-seed plan (PR #76 follow-up): the Harbor demo
// project row is the company's demo opt-out tombstone, and an archived demo
// means the CRM seeder seeds nothing.
import assert from "node:assert/strict";
import { planCrmDemoSeed } from "../src/lib/pipeline-demo-seed.ts";
import { harborDemoSeedAction } from "../src/lib/demo-seed.ts";

// ---------- Archived demo tombstone → seed nothing ----------
const archivedDemo = { id: "project-1", archived_at: "2026-07-01T00:00:00Z" };
assert.deepEqual(
  planCrmDemoSeed(archivedDemo),
  { action: "skip", harborProjectId: null },
  "An archived Harbor demo project means the CRM demo seeder seeds nothing.",
);
assert.equal(
  harborDemoSeedAction(archivedDemo),
  "skip",
  "The CRM plan defers to the shared demo-seed opt-out decision.",
);

// ---------- Active demo project → seed and link ----------
assert.deepEqual(
  planCrmDemoSeed({ id: "project-1", archived_at: null }),
  { action: "seed", harborProjectId: "project-1" },
  "A live Harbor demo project seeds CRM samples linked to that project.",
);

// ---------- No demo project at all → seed without a project link ----------
assert.deepEqual(
  planCrmDemoSeed(null),
  { action: "seed", harborProjectId: null },
  "No Harbor demo project row seeds CRM samples without a project link.",
);
assert.deepEqual(
  planCrmDemoSeed(undefined),
  { action: "seed", harborProjectId: null },
  "An absent lookup result behaves like no demo project.",
);

// ---------- Malformed ids never leak into the link ----------
assert.deepEqual(
  planCrmDemoSeed({ id: 42, archived_at: null }),
  { action: "seed", harborProjectId: null },
  "A non-string project id seeds without a project link instead of crashing.",
);
assert.deepEqual(
  planCrmDemoSeed({ id: "", archived_at: null }),
  { action: "seed", harborProjectId: null },
  "An empty project id seeds without a project link.",
);

console.log("CRM pipeline smoke checks passed.");
