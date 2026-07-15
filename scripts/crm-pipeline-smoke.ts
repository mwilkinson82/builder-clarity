// CRM pipeline smoke checks. Run with: npm run test:crm
// Exercises the pure CRM demo-seed plan (PR #76 follow-up): the Harbor demo
// project row is the company's demo opt-out tombstone, and an archived demo
// means the CRM seeder seeds nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCrmDemoSeed } from "../src/lib/pipeline-demo-seed.ts";
import { harborDemoSeedAction } from "../src/lib/demo-seed.ts";
import { pruneRemovedDemoCrm } from "../src/components/pipeline/pipeline-ui.ts";
import {
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK,
  appendValueAssetToBody,
  followupDueDate,
  followupTiming,
  personalizeFollowupTemplate,
} from "../src/lib/crm-followup-domain.ts";

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

// ---------- Deleting a sample opportunity prunes its rollup rows ----------
// Removing a sample opportunity is local-only (the CRM is not seeded to the
// database yet), so the server snapshot that feeds the CRM command-center
// rollup still carries that sample's account, contact, and next action. The
// rollup must reflect the deletion instead of showing stale sample totals.
const makeSnapshot = () => ({
  accounts: [
    { id: "00000000-0000-4000-8000-000000000201", name: "Sample One" },
    { id: "00000000-0000-4000-8000-000000000202", name: "Sample Two" },
    { id: "11111111-2222-4333-8444-555555555555", name: "Real Account" },
  ],
  contacts: [
    { id: "00000000-0000-4000-8000-000000000301", name: "Contact One" },
    { id: "00000000-0000-4000-8000-000000000302", name: "Contact Two" },
    { id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", name: "Real Contact" },
  ],
  openActions: [
    {
      id: "00000000-0000-4000-8000-000000000401",
      opportunity_id: "00000000-0000-4000-8000-000000000101",
    },
    {
      id: "00000000-0000-4000-8000-000000000402",
      opportunity_id: "00000000-0000-4000-8000-000000000102",
    },
    {
      id: "99999999-8888-4777-8666-555555555555",
      opportunity_id: "77777777-8888-4999-8000-111111111111",
    },
  ],
});

// No removals → snapshot passes through unchanged (real data is never touched).
assert.deepEqual(
  pruneRemovedDemoCrm(makeSnapshot() as never, []),
  makeSnapshot(),
  "With nothing removed the snapshot is returned unchanged.",
);

// Remove sample opportunity #1 → its account, contact, and action all drop,
// while sample #2 and the real rows survive.
const pruned = pruneRemovedDemoCrm(makeSnapshot() as never, [
  "00000000-0000-4000-8000-000000000101",
]);
assert.deepEqual(
  pruned.accounts.map((a) => a.id),
  ["00000000-0000-4000-8000-000000000202", "11111111-2222-4333-8444-555555555555"],
  "Deleting a sample opportunity drops its rollup account.",
);
assert.deepEqual(
  pruned.contacts.map((c) => c.id),
  ["00000000-0000-4000-8000-000000000302", "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"],
  "Deleting a sample opportunity drops its rollup contact.",
);
assert.deepEqual(
  pruned.openActions.map((a) => a.id),
  ["00000000-0000-4000-8000-000000000402", "99999999-8888-4777-8666-555555555555"],
  "Deleting a sample opportunity drops its open next action.",
);

// A non-demo (real) opportunity id never prunes sample rows by coincidence.
assert.deepEqual(
  pruneRemovedDemoCrm(makeSnapshot() as never, ["77777777-8888-4999-8000-111111111111"]),
  makeSnapshot(),
  "Removing a real opportunity leaves the sample rollup untouched.",
);

// ---------- Value-first follow-up playbook ----------
assert.deepEqual(
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.steps.map((step) => step.dayOffset),
  [1, 3, 5, 8],
  "The default value-first cadence prepares Day 1, 3, 5, and 8 follow-ups.",
);
assert.ok(
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.steps.every(
    (step) => step.purpose.trim() && step.valueAngle.trim() && step.bodyTemplate.trim(),
  ),
  "Every follow-up step explains its purpose, value angle, and prepared message.",
);

const personalized = personalizeFollowupTemplate(
  "Hi {{contact_first_name}}, {{owner_name}} is ready to discuss {{opportunity_name}}.",
  {
    contactName: "Sarah Contractor",
    opportunityName: "Oak Street Addition",
    clientName: "Contractor Family",
    ownerName: "Alex Builder",
  },
);
assert.equal(
  personalized,
  "Hi Sarah, Alex Builder is ready to discuss Oak Street Addition.",
  "Prepared messages personalize the contact, opportunity, and owner without AI.",
);
assert.equal(
  followupDueDate(new Date("2026-07-15T20:00:00.000Z"), 3),
  "2026-07-18",
  "Playbook offsets produce deterministic due dates.",
);
const fixedNow = new Date("2026-07-15T13:00:00.000Z");
assert.equal(followupTiming("2026-07-14", fixedNow), "overdue");
assert.equal(followupTiming("2026-07-15", fixedNow), "today");
assert.equal(followupTiming("2026-07-16", fixedNow), "upcoming");
assert.equal(followupTiming(null, fixedNow), "unscheduled");
assert.equal(
  appendValueAssetToBody("Here is the guide.", "Decision checklist", "https://example.com/guide"),
  "Here is the guide.\n\nDecision checklist: https://example.com/guide",
  "Prepared email bodies include the selected value resource link.",
);

const followupMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260715222809_crm_followup_studio_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
for (const requiredFragment of [
  "CREATE TABLE IF NOT EXISTS public.crm_value_assets",
  "CREATE TABLE IF NOT EXISTS public.crm_followup_playbooks",
  "CREATE TABLE IF NOT EXISTS public.crm_followup_enrollments",
  "ADD COLUMN IF NOT EXISTS playbook_enrollment_id",
  "ALTER TABLE public.crm_value_assets ENABLE ROW LEVEL SECURITY",
  "'crm-assets'",
]) {
  assert.ok(
    followupMigration.includes(requiredFragment),
    `CRM follow-up migration must contain: ${requiredFragment}`,
  );
}

const followupVerifier = readFileSync(
  new URL(
    "../supabase/verification/20260715222809_crm_followup_studio_foundation.sql",
    import.meta.url,
  ),
  "utf8",
);
for (const requiredFragment of [
  "RLS is not enabled",
  "has_table_privilege('authenticated'",
  "Anon unexpectedly has SELECT",
  "pipeline_next_actions_followup_enrollment_fk",
  "public = false",
  "CRMFOLLOWUP1 VERIFIED",
]) {
  assert.ok(
    followupVerifier.includes(requiredFragment),
    `CRM follow-up verifier must contain: ${requiredFragment}`,
  );
}

const followupAnonRevoke = readFileSync(
  new URL("../supabase/migrations/20260715230236_crm_followup_revoke_anon.sql", import.meta.url),
  "utf8",
);
for (const table of [
  "crm_value_assets",
  "crm_followup_playbooks",
  "crm_followup_playbook_steps",
  "crm_followup_enrollments",
]) {
  assert.ok(
    followupAnonRevoke.includes(`REVOKE ALL PRIVILEGES ON TABLE public.${table} FROM anon`),
    `CRM follow-up must explicitly deny anonymous Data API access to public.${table}.`,
  );
}

console.log("CRM pipeline smoke checks passed.");
