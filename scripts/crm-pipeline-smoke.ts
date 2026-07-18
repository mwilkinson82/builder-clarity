// CRM pipeline smoke checks. Run with: npm run test:crm
// Exercises the pure CRM demo-seed plan (PR #76 follow-up): the Harbor demo
// project row is the company's demo opt-out tombstone, and an archived demo
// means the CRM seeder seeds nothing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planCrmDemoSeed } from "../src/lib/pipeline-demo-seed.ts";
import { harborDemoSeedAction } from "../src/lib/demo-seed.ts";
import {
  computePipelineMetrics,
  opportunityPricingState,
  pruneRemovedDemoCrm,
} from "../src/components/pipeline/pipeline-ui.ts";
import {
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK,
  appendValueAssetToBody,
  followupDueDate,
  followupTiming,
  personalizeFollowupTemplate,
  shouldShowPreparedFollowup,
} from "../src/lib/crm-followup-domain.ts";
import {
  CRM_ONBOARDING_TASK_TEMPLATES,
  datePlusDays,
  parseCrmAiFollowupDraft,
  parseCrmMeetingBrief,
} from "../src/lib/crm-action-suite-domain.ts";
import {
  HARBOR_CRM_DEMO_FIXTURES,
  HARBOR_CRM_DEMO_MODULE_KEY,
  HARBOR_CRM_DEMO_VERSION,
  isHarborCrmDemoOpportunityName,
} from "../src/lib/crm-demo-domain.ts";
import {
  crmEmailActionLabel,
  isCrmDemoRecipientEmail,
  resolveCrmEmailSenderConfig,
  shouldSimulateCrmEmail,
} from "../src/lib/crm-email-policy.ts";

// ---------- Versioned Harbor CRM walkthrough ----------
assert.equal(HARBOR_CRM_DEMO_MODULE_KEY, "crm-workflow");
assert.equal(HARBOR_CRM_DEMO_VERSION, 1);
assert.equal(HARBOR_CRM_DEMO_FIXTURES.length, 6);
assert.equal(
  HARBOR_CRM_DEMO_FIXTURES.filter((fixture) => fixture.linkToHarborProject).length,
  1,
  "Exactly one CRM opportunity is the project handoff into Harbor Residence.",
);
assert.equal(
  HARBOR_CRM_DEMO_FIXTURES.filter((fixture) => fixture.enrollInFollowup).length,
  1,
  "The walkthrough includes one prepared value-first follow-up story.",
);
assert.ok(isHarborCrmDemoOpportunityName("Harbor Residence Preconstruction"));
assert.ok(
  HARBOR_CRM_DEMO_FIXTURES.every((fixture) => isCrmDemoRecipientEmail(fixture.contactEmail)),
  "Every Harbor walkthrough recipient is locked to the non-delivering demo domain.",
);

// ---------- CRM email safety and provider choice ----------
assert.ok(shouldSimulateCrmEmail({ recipient: "person@demo.overwatch.example" }));
assert.ok(shouldSimulateCrmEmail({ recipient: "person@example.com", testMode: true }));
assert.equal(crmEmailActionLabel("person@demo.overwatch.example"), "Run demo send");
assert.equal(
  resolveCrmEmailSenderConfig({
    RESEND_API_KEY: "test-key",
    CRM_EMAIL_FROM_ADDRESS: "followup@send.overwatch.example",
    CRM_EMAIL_SENDER_DOMAIN: "send.overwatch.example",
  }).provider,
  "resend",
);
assert.equal(
  resolveCrmEmailSenderConfig({
    LOVABLE_API_KEY: "test-key",
    CRM_EMAIL_FROM_ADDRESS: "followup@send.overwatch.example",
    CRM_EMAIL_SENDER_DOMAIN: "send.overwatch.example",
  }).provider,
  "lovable_email",
);
assert.deepEqual(resolveCrmEmailSenderConfig({ RESEND_API_KEY: "test-key" }), {
  provider: "resend",
  fromAddress: "notifications@alpoverwatch.com",
  replyToAddress: "support@alpoverwatch.com",
  senderDomain: "alpoverwatch.com",
});
assert.throws(
  () =>
    resolveCrmEmailSenderConfig({
      CRM_EMAIL_FROM_ADDRESS: "not-an-email",
      CRM_EMAIL_SENDER_DOMAIN: "send.overwatch.example",
    }),
  /complete email address/,
);

assert.equal(
  shouldShowPreparedFollowup({
    opportunityActive: true,
    enrollmentStatus: "active",
    completedAt: null,
    skippedAt: null,
  }),
  true,
  "An open step on an active opportunity and enrollment stays in the prepared queue.",
);
for (const hidden of [
  {
    opportunityActive: false,
    enrollmentStatus: "active" as const,
    completedAt: null,
    skippedAt: null,
  },
  {
    opportunityActive: true,
    enrollmentStatus: "stopped" as const,
    completedAt: null,
    skippedAt: null,
  },
  {
    opportunityActive: true,
    enrollmentStatus: "active" as const,
    completedAt: "2026-07-18T12:00:00.000Z",
    skippedAt: null,
  },
]) {
  assert.equal(
    shouldShowPreparedFollowup(hidden),
    false,
    "Archived, stopped, or completed follow-up work must stay out of the prepared queue.",
  );
}

const lifecycleMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260718132418_stop_archived_crm_workflows_and_repair_harbor.sql",
    import.meta.url,
  ),
  "utf8",
);
assert.match(lifecycleMigration, /tg_stop_crm_workflows_on_opportunity_archive/);
assert.match(lifecycleMigration, /crm_followup_enrollments[\s\S]*status = 'stopped'/);
assert.match(lifecycleMigration, /pipeline_next_actions[\s\S]*skipped_at = coalesce/);
assert.match(lifecycleMigration, /crm_onboarding_plans[\s\S]*status = 'stopped'/);
assert.match(lifecycleMigration, /notify pgrst, 'reload schema'/i);
assert.throws(
  () =>
    resolveCrmEmailSenderConfig({
      CRM_EMAIL_REPLY_TO_ADDRESS: "not-an-email",
    }),
  /CRM_EMAIL_REPLY_TO_ADDRESS/,
);

const emailDeliverySource = readFileSync(
  new URL("../src/lib/crm-email-delivery.server.ts", import.meta.url),
  "utf8",
);
assert.match(emailDeliverySource, /https:\/\/api\.resend\.com\/emails/);
assert.match(emailDeliverySource, /"Idempotency-Key": input\.idempotencyKey/);
assert.match(emailDeliverySource, /reply_to: input\.replyTo/);

const providerMigration = readFileSync(
  new URL("../supabase/migrations/20260717165334_allow_resend_crm_provider.sql", import.meta.url),
  "utf8",
);
assert.match(providerMigration, /'lovable_email', 'resend', 'demo'/);

const pipelineServerSource = readFileSync(
  new URL("../src/lib/pipeline.functions.ts", import.meta.url),
  "utf8",
);
assert.doesNotMatch(
  pipelineServerSource,
  /if \(opportunities\.length === 0[\s\S]{0,160}return demoOpportunities/,
  "An empty live CRM must reach the persistent Harbor seeder instead of masking it with temporary cards.",
);
assert.doesNotMatch(
  pipelineServerSource,
  /if \(baseAccounts\.length === 0[\s\S]{0,200}return demoCrmSnapshot/,
  "An empty CRM snapshot must not resurrect an in-memory sample directory.",
);

const followupUiSource = readFileSync(
  new URL("../src/components/pipeline/FollowUpStudioParts.tsx", import.meta.url),
  "utf8",
);
assert.match(followupUiSource, /no external email will leave the application/);
assert.match(followupUiSource, /crmEmailActionLabel/);

const demoControlSource = readFileSync(
  new URL("../src/components/pipeline/CrmDemoControl.tsx", import.meta.url),
  "utf8",
);
assert.match(demoControlSource, /Restore Harbor CRM/);
assert.match(demoControlSource, /Your real CRM records are not\s+touched/);

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

// ---------- Financial metrics distinguish unknown from zero ----------
const pipelineMetrics = computePipelineMetrics([
  {
    id: "unpriced",
    stage: "estimating",
    archived: false,
    estimated_contract: 0,
    estimated_cost: 0,
    estimated_gp_pct: 0,
    probability: 30,
    days_until_bid_due: null,
    updated_at: "2026-07-16T00:00:00Z",
  },
  {
    id: "margin-ready",
    stage: "estimating",
    archived: false,
    estimated_contract: 100_000,
    estimated_cost: 80_000,
    estimated_gp_pct: 20,
    probability: 50,
    days_until_bid_due: 4,
    updated_at: "2026-07-16T00:00:00Z",
  },
  {
    id: "contract-only",
    stage: "bid_submitted",
    archived: false,
    estimated_contract: 100_000,
    estimated_cost: 0,
    estimated_gp_pct: 100,
    probability: 30,
    days_until_bid_due: 8,
    updated_at: "2026-07-16T00:00:00Z",
  },
] as never);
assert.equal(
  pipelineMetrics.activeCount,
  3,
  "Unpriced work remains visible in active pipeline count.",
);
assert.equal(
  pipelineMetrics.weighted,
  80_000,
  "Weighted pipeline sums priced value; $0 placeholders do not dilute it.",
);
assert.equal(
  pipelineMetrics.pricedCount,
  2,
  "Pricing coverage counts contract values that are actually entered.",
);
assert.equal(
  pipelineMetrics.marginReadyCount,
  1,
  "GP includes only rows with contract and cost entered.",
);
assert.equal(
  pipelineMetrics.avgGp,
  20,
  "Portfolio GP is contract-dollar weighted and excludes incomplete pricing.",
);
assert.equal(
  pipelineMetrics.weightedGp,
  10_000,
  "Weighted GP combines actual margin dollars with stage probability.",
);
assert.deepEqual(
  opportunityPricingState({ estimated_contract: 0, estimated_cost: 0 } as never),
  { priced: false, marginReady: false },
  "$0 placeholders display as unpriced and GP pending.",
);

// ---------- AI parsing and contract-to-kickoff defaults ----------
assert.equal(
  CRM_ONBOARDING_TASK_TEMPLATES.length,
  8,
  "Won work gets eight prepared onboarding steps.",
);
assert.equal(datePlusDays("2026-07-16", 5), "2026-07-21");
assert.equal(
  parseCrmAiFollowupDraft(
    '{"subject":"A useful next step","body":"Hi Sam,\\n\\nHere is one practical question to settle.","value_angle":"Reduce decision friction.","resource_idea":"A one-page decision checklist."}',
  ).resource_idea,
  "A one-page decision checklist.",
);
assert.equal(
  parseCrmMeetingBrief(
    '{"executive_summary":"Pricing is incomplete.","relationship_context":[],"desired_outcomes":["Agree on scope."],"questions_to_ask":["Who approves changes?"],"risks_to_surface":["Cost is missing."],"value_to_bring":["A scope checklist."],"next_step_options":["Schedule scope review."]}',
  ).risks_to_surface[0],
  "Cost is missing.",
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

const actionSuiteMigration = readFileSync(
  new URL("../supabase/migrations/20260716124626_crm_action_suite.sql", import.meta.url),
  "utf8",
);
for (const requiredFragment of [
  "CREATE TABLE IF NOT EXISTS public.crm_outbound_messages",
  "CREATE TABLE IF NOT EXISTS public.crm_meeting_briefs",
  "CREATE TABLE IF NOT EXISTS public.crm_onboarding_plans",
  "CREATE TABLE IF NOT EXISTS public.crm_onboarding_tasks",
  "REVOKE ALL ON public.crm_outbound_messages FROM anon, authenticated",
  "REFERENCES public.pipeline_opportunities(id, organization_id)",
  "'ai_crm_assist'",
]) {
  assert.ok(
    actionSuiteMigration.includes(requiredFragment),
    `CRM action-suite migration must contain: ${requiredFragment}`,
  );
}

const actionSuiteVerifier = readFileSync(
  new URL("../supabase/verification/20260716124626_crm_action_suite.sql", import.meta.url),
  "utf8",
);
assert.ok(actionSuiteVerifier.includes("CRMACTION1 VERIFIED"));

console.log("CRM pipeline smoke checks passed.");
