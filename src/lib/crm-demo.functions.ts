import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CRM_ONBOARDING_TASK_TEMPLATES, datePlusDays } from "@/lib/crm-action-suite-domain";
import { currentOrganizationId, str } from "@/lib/crm-actions-server-shared";
import {
  HARBOR_CRM_DEMO_FIXTURES,
  HARBOR_CRM_DEMO_MARKER,
  HARBOR_CRM_DEMO_MEETING_BRIEF,
  HARBOR_CRM_DEMO_MODULE_KEY,
  HARBOR_CRM_DEMO_VERSION,
  harborCrmDemoDate,
  harborCrmDemoMarker,
  type HarborCrmDemoFixture,
} from "@/lib/crm-demo-domain";
import {
  DEFAULT_VALUE_FOLLOWUP_PLAYBOOK,
  followupDueDate,
  personalizeFollowupTemplate,
} from "@/lib/crm-followup-domain";
import { HARBOR_DEMO_CLIENT, HARBOR_DEMO_JOB_NUMBER, HARBOR_DEMO_NAME } from "@/lib/demo-seed";

type DemoError = { code?: string; message: string };
type DemoResult = { data: unknown; error: DemoError | null };
type DemoQuery = PromiseLike<DemoResult> & {
  select(columns?: string): DemoQuery;
  insert(values: unknown): DemoQuery;
  update(values: unknown): DemoQuery;
  upsert(values: unknown, options?: { onConflict?: string }): DemoQuery;
  delete(): DemoQuery;
  eq(column: string, value: unknown): DemoQuery;
  in(column: string, values: readonly unknown[]): DemoQuery;
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): DemoQuery;
  limit(count: number): DemoQuery;
  single(): Promise<DemoResult>;
  maybeSingle(): Promise<DemoResult>;
};
type DemoClient = {
  from(relation: string): DemoQuery;
  rpc(fn: string, args?: Record<string, unknown>): Promise<DemoResult>;
};
type DemoContext = { supabase: unknown; userId: string };

const demoTable = (client: unknown, relation: string) => (client as DemoClient).from(relation);
const record = (value: unknown) =>
  (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
const records = (value: unknown) => (Array.isArray(value) ? value.map(record) : []);

async function findHarborProject(client: unknown, organizationId: string) {
  const byJob = await demoTable(client, "projects")
    .select("id,name,client,job_number,archived_at")
    .eq("organization_id", organizationId)
    .eq("job_number", HARBOR_DEMO_JOB_NUMBER)
    .limit(1)
    .maybeSingle();
  if (byJob.error) throw new Error(byJob.error.message);
  if (byJob.data) return record(byJob.data);
  const byName = await demoTable(client, "projects")
    .select("id,name,client,job_number,archived_at")
    .eq("organization_id", organizationId)
    .eq("name", HARBOR_DEMO_NAME)
    .eq("client", HARBOR_DEMO_CLIENT)
    .limit(1)
    .maybeSingle();
  if (byName.error) throw new Error(byName.error.message);
  return byName.data ? record(byName.data) : null;
}

async function requireHarborManager(context: DemoContext, projectId: string) {
  const result = await (context.supabase as DemoClient).rpc("can_manage_project", {
    p_project_id: projectId,
  });
  if (result.error) throw new Error(result.error.message);
  if (!result.data) throw new Error("You need project-management access to restore Harbor CRM.");
}

async function profileName(client: unknown, userId: string) {
  const result = await demoTable(client, "profiles")
    .select("full_name,email")
    .eq("id", userId)
    .maybeSingle();
  if (result.error) throw new Error(result.error.message);
  const profile = record(result.data);
  return str(profile.full_name).trim() || str(profile.email).trim() || "Project team";
}

async function ensureDefaultPlaybook(client: unknown, organizationId: string, userId: string) {
  const current = await demoTable(client, "crm_followup_playbooks")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("system_key", DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.systemKey)
    .maybeSingle();
  if (current.error) throw new Error(current.error.message);
  let playbookId = str(record(current.data).id);
  if (!playbookId) {
    const inserted = await demoTable(client, "crm_followup_playbooks")
      .insert({
        organization_id: organizationId,
        created_by: userId,
        system_key: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.systemKey,
        name: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.name,
        description: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.description,
        audience: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.audience,
        trigger_stage: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.triggerStage,
        is_system: true,
        active: true,
      })
      .select("id")
      .single();
    if (inserted.error) throw new Error(inserted.error.message);
    playbookId = str(record(inserted.data).id);
  } else {
    const updated = await demoTable(client, "crm_followup_playbooks")
      .update({
        name: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.name,
        description: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.description,
        audience: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.audience,
        trigger_stage: DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.triggerStage,
        is_system: true,
        active: true,
      })
      .eq("id", playbookId)
      .eq("organization_id", organizationId);
    if (updated.error) throw new Error(updated.error.message);
  }

  const existing = await demoTable(client, "crm_followup_playbook_steps")
    .select("id,step_order")
    .eq("organization_id", organizationId)
    .eq("playbook_id", playbookId)
    .limit(100);
  if (existing.error) throw new Error(existing.error.message);
  const byOrder = new Map(records(existing.data).map((item) => [Number(item.step_order), item]));
  const steps: Array<Record<string, unknown>> = [];
  for (const step of DEFAULT_VALUE_FOLLOWUP_PLAYBOOK.steps) {
    const values = {
      organization_id: organizationId,
      playbook_id: playbookId,
      created_by: userId,
      step_order: step.stepOrder,
      day_offset: step.dayOffset,
      channel: step.channel,
      title: step.title,
      purpose: step.purpose,
      value_angle: step.valueAngle,
      subject_template: step.subjectTemplate,
      body_template: step.bodyTemplate,
      require_review: true,
      active: true,
    };
    const existingStep = byOrder.get(step.stepOrder);
    if (existingStep) {
      const updated = await demoTable(client, "crm_followup_playbook_steps")
        .update(values)
        .eq("id", str(existingStep.id))
        .eq("organization_id", organizationId)
        .select("*")
        .single();
      if (updated.error) throw new Error(updated.error.message);
      steps.push(record(updated.data));
    } else {
      const inserted = await demoTable(client, "crm_followup_playbook_steps")
        .insert(values)
        .select("*")
        .single();
      if (inserted.error) throw new Error(inserted.error.message);
      steps.push(record(inserted.data));
    }
  }
  return { playbookId, steps };
}

async function resetDemoActivity(client: unknown, organizationId: string) {
  const names = HARBOR_CRM_DEMO_FIXTURES.map((fixture) => fixture.name);
  const opportunities = await demoTable(client, "pipeline_opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .in("name", names);
  if (opportunities.error) throw new Error(opportunities.error.message);
  const ids = records(opportunities.data)
    .map((item) => str(item.id))
    .filter(Boolean);
  if (ids.length === 0) return;
  for (const relation of [
    "crm_outbound_messages",
    "crm_meeting_briefs",
    "crm_onboarding_plans",
    "pipeline_activity_log",
    "pipeline_next_actions",
    "crm_followup_enrollments",
  ]) {
    const removed = await demoTable(client, relation)
      .delete()
      .eq("organization_id", organizationId)
      .in("opportunity_id", ids);
    if (removed.error) throw new Error(removed.error.message);
  }
}

async function ensureAccount(
  client: unknown,
  organizationId: string,
  userId: string,
  ownerName: string,
  fixture: HarborCrmDemoFixture,
) {
  const existing = await demoTable(client, "pipeline_accounts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", fixture.client)
    .eq("archived", false)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const values = {
    organization_id: organizationId,
    created_by: userId,
    name: fixture.client,
    account_type: "client",
    market_sector: fixture.marketSector,
    relationship_stage: fixture.relationshipStage,
    relationship_health: fixture.accountHealth,
    email: fixture.contactEmail,
    phone: fixture.contactPhone,
    source: fixture.source,
    owner_name: ownerName,
    notes: harborCrmDemoMarker(`account:${fixture.key}`),
    last_touch_at: new Date().toISOString(),
    next_touch_at: `${harborCrmDemoDate(fixture.actionDueOffset)}T12:00:00.000Z`,
    archived: false,
  };
  const id = str(record(existing.data).id);
  const result = id
    ? await demoTable(client, "pipeline_accounts")
        .update(values)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id")
        .single()
    : await demoTable(client, "pipeline_accounts").insert(values).select("id").single();
  if (result.error) throw new Error(result.error.message);
  return str(record(result.data).id);
}

async function ensureContact(
  client: unknown,
  organizationId: string,
  userId: string,
  accountId: string,
  fixture: HarborCrmDemoFixture,
) {
  const existing = await demoTable(client, "pipeline_contacts")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("email", fixture.contactEmail)
    .eq("archived", false)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const values = {
    organization_id: organizationId,
    account_id: accountId,
    created_by: userId,
    name: fixture.contactName,
    title: fixture.contactTitle,
    email: fixture.contactEmail,
    phone: fixture.contactPhone,
    role: fixture.stage === "won" ? "Client decision maker" : "Pursuit contact",
    influence_level: fixture.stage === "won" ? "decision_maker" : "influencer",
    relationship_status: fixture.stage === "no_bid" ? "warm" : "active",
    notes: harborCrmDemoMarker(`contact:${fixture.key}`),
    last_touch_at: new Date().toISOString(),
    archived: false,
  };
  const id = str(record(existing.data).id);
  const result = id
    ? await demoTable(client, "pipeline_contacts")
        .update(values)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id")
        .single()
    : await demoTable(client, "pipeline_contacts").insert(values).select("id").single();
  if (result.error) throw new Error(result.error.message);
  return str(record(result.data).id);
}

async function ensureOpportunity(
  client: unknown,
  organizationId: string,
  userId: string,
  ownerName: string,
  harborProjectId: string,
  accountId: string,
  contactId: string,
  fixture: HarborCrmDemoFixture,
) {
  const existing = await demoTable(client, "pipeline_opportunities")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("name", fixture.name)
    .limit(1)
    .maybeSingle();
  if (existing.error) throw new Error(existing.error.message);
  const values = {
    organization_id: organizationId,
    created_by: userId,
    account_id: accountId,
    primary_contact_id: contactId,
    name: fixture.name,
    client: fixture.client,
    client_contact_name: fixture.contactName,
    client_contact_email: fixture.contactEmail,
    client_contact_phone: fixture.contactPhone,
    stage: fixture.stage,
    estimated_contract: fixture.contract,
    estimated_cost: fixture.cost,
    bid_due_date: harborCrmDemoDate(fixture.bidDueOffset),
    decision_date: harborCrmDemoDate(fixture.decisionOffset),
    probability: fixture.probability,
    source: fixture.source,
    project_type: fixture.projectType,
    scope_summary: fixture.scope,
    bid_decision: fixture.bidDecision,
    bid_decision_reason:
      fixture.bidDecision === "no_bid"
        ? "Drawings were incomplete, schedule penalties were heavy, and the margin profile was too thin."
        : "",
    bid_decision_date:
      fixture.bidDecision === "undecided" ? null : harborCrmDemoDate(fixture.decisionOffset),
    converted_project_id: fixture.linkToHarborProject ? harborProjectId : null,
    converted_at: fixture.linkToHarborProject ? new Date().toISOString() : null,
    assigned_to: ownerName,
    notes: harborCrmDemoMarker(`opportunity:${fixture.key}`),
    last_activity_at: new Date().toISOString(),
    archived: false,
  };
  const id = str(record(existing.data).id);
  const result = id
    ? await demoTable(client, "pipeline_opportunities")
        .update(values)
        .eq("id", id)
        .eq("organization_id", organizationId)
        .select("id")
        .single()
    : await demoTable(client, "pipeline_opportunities").insert(values).select("id").single();
  if (result.error) throw new Error(result.error.message);
  return str(record(result.data).id);
}

async function seedOpportunityActivity(input: {
  client: unknown;
  organizationId: string;
  userId: string;
  ownerName: string;
  opportunityId: string;
  accountId: string;
  contactId: string;
  fixture: HarborCrmDemoFixture;
}) {
  const activity = await demoTable(input.client, "pipeline_activity_log").insert([
    {
      opportunity_id: input.opportunityId,
      organization_id: input.organizationId,
      event_type: "created",
      to_value: input.fixture.name,
      notes: harborCrmDemoMarker(`activity:${input.fixture.key}:created`),
      created_by: input.userId,
    },
    {
      opportunity_id: input.opportunityId,
      organization_id: input.organizationId,
      event_type: "field_update",
      to_value: input.fixture.actionTitle,
      notes: `Next action prepared: ${input.fixture.actionTitle}`,
      created_by: input.userId,
    },
  ]);
  if (activity.error) throw new Error(activity.error.message);
  const action = await demoTable(input.client, "pipeline_next_actions").insert({
    organization_id: input.organizationId,
    opportunity_id: input.opportunityId,
    account_id: input.accountId,
    contact_id: input.contactId,
    created_by: input.userId,
    owner_user_id: input.userId,
    owner_name: input.ownerName,
    action_type: input.fixture.actionType,
    priority: input.fixture.actionPriority,
    title: input.fixture.actionTitle,
    notes: harborCrmDemoMarker(`action:${input.fixture.key}`),
    due_date: harborCrmDemoDate(input.fixture.actionDueOffset),
  });
  if (action.error) throw new Error(action.error.message);
}

async function seedFollowupStory(input: {
  client: unknown;
  deliveryClient: unknown;
  organizationId: string;
  userId: string;
  ownerName: string;
  opportunity: Record<string, string>;
  playbookId: string;
  steps: Array<Record<string, unknown>>;
}) {
  const enrollment = await demoTable(input.client, "crm_followup_enrollments")
    .insert({
      organization_id: input.organizationId,
      opportunity_id: input.opportunity.id,
      playbook_id: input.playbookId,
      created_by: input.userId,
      owner_user_id: input.userId,
      status: "active",
      started_at: `${harborCrmDemoDate(-2)}T12:00:00.000Z`,
    })
    .select("id,started_at")
    .single();
  if (enrollment.error) throw new Error(enrollment.error.message);
  const enrollmentId = str(record(enrollment.data).id);
  const startedAt = new Date(str(record(enrollment.data).started_at));
  const context = {
    contactName: input.opportunity.contactName,
    opportunityName: input.opportunity.name,
    clientName: input.opportunity.client,
    ownerName: input.ownerName,
  };
  const actionRows = input.steps.map((step, index) => {
    const sent = index === 0;
    return {
      organization_id: input.organizationId,
      opportunity_id: input.opportunity.id,
      account_id: input.opportunity.accountId,
      contact_id: input.opportunity.contactId,
      created_by: input.userId,
      completed_by: sent ? input.userId : null,
      owner_user_id: input.userId,
      owner_name: input.ownerName,
      action_type: str(step.channel, "email"),
      priority: index === 1 ? "high" : "normal",
      title: str(step.title),
      notes: str(step.purpose),
      due_date: followupDueDate(startedAt, Number(step.day_offset)),
      playbook_enrollment_id: enrollmentId,
      playbook_step_id: str(step.id),
      subject: personalizeFollowupTemplate(str(step.subject_template), context),
      body: personalizeFollowupTemplate(str(step.body_template), context),
      value_angle: str(step.value_angle),
      completed_at: sent ? new Date().toISOString() : null,
      outcome: sent ? "sent" : "",
      outcome_notes: sent ? "Harbor demo delivery recorded without sending externally." : "",
      sent_at: sent ? new Date().toISOString() : null,
      sent_message_id: sent ? `demo-seed-${crypto.randomUUID()}` : "",
    };
  });
  const actions = await demoTable(input.client, "pipeline_next_actions")
    .insert(actionRows)
    .select("id,subject,body,sent_at,sent_message_id");
  if (actions.error) throw new Error(actions.error.message);
  // The first demo touch is the only row marked sent. Select it from the
  // returned payload instead of asking PostgREST to order the mutation by
  // due_date. Some deployments can briefly retain an older relation cache
  // after the due_date migration, which made the otherwise-valid seed fail.
  const sentAction =
    records(actions.data).find((action) => Boolean(str(action.sent_at))) ??
    records(actions.data)[0];
  if (!sentAction) throw new Error("Harbor follow-up actions were not created.");
  const delivery = await demoTable(input.deliveryClient, "crm_outbound_messages").insert({
    organization_id: input.organizationId,
    opportunity_id: input.opportunity.id,
    next_action_id: str(sentAction.id),
    created_by: input.userId,
    sent_by: input.userId,
    client_request_id: crypto.randomUUID(),
    recipient_email: input.opportunity.contactEmail,
    reply_to_email: "demo@overwatch.example",
    subject: str(sentAction.subject),
    body_text: str(sentAction.body),
    provider: "demo",
    provider_message_id: str(sentAction.sent_message_id),
    status: "sent",
    sent_at: str(sentAction.sent_at),
  });
  if (delivery.error) throw new Error(delivery.error.message);
}

async function seedMeetingBrief(input: {
  client: unknown;
  organizationId: string;
  userId: string;
  opportunityId: string;
}) {
  const result = await demoTable(input.client, "crm_meeting_briefs").insert({
    organization_id: input.organizationId,
    opportunity_id: input.opportunityId,
    created_by: input.userId,
    owner_user_id: input.userId,
    meeting_type: "kickoff",
    title: HARBOR_CRM_DEMO_MEETING_BRIEF.title,
    meeting_at: `${harborCrmDemoDate(2)}T14:00:00.000Z`,
    attendee_names: ["Evelyn Harbor", "Project manager", "Superintendent"],
    meeting_goal: HARBOR_CRM_DEMO_MEETING_BRIEF.meetingGoal,
    source_context: { demo_fixture: HARBOR_CRM_DEMO_MARKER },
    brief_data: HARBOR_CRM_DEMO_MEETING_BRIEF.data,
    status: "final",
    model_used: "demo-fixture-v1",
    generated_at: new Date().toISOString(),
  });
  if (result.error) throw new Error(result.error.message);
}

async function seedOnboardingPlan(input: {
  client: unknown;
  organizationId: string;
  userId: string;
  opportunityId: string;
  projectId: string;
}) {
  const kickoffDate = harborCrmDemoDate(5);
  const plan = await demoTable(input.client, "crm_onboarding_plans")
    .insert({
      organization_id: input.organizationId,
      opportunity_id: input.opportunityId,
      project_id: input.projectId,
      created_by: input.userId,
      owner_user_id: input.userId,
      title: "Harbor Residence · contract-to-kickoff",
      status: "active",
      kickoff_date: kickoffDate,
      handoff_summary:
        "Protect the owner decision path, carry estimate assumptions into operations, and release long-lead selections before they affect the CPM.",
    })
    .select("id")
    .single();
  if (plan.error) throw new Error(plan.error.message);
  const planId = str(record(plan.data).id);
  const tasks = await demoTable(input.client, "crm_onboarding_tasks").insert(
    CRM_ONBOARDING_TASK_TEMPLATES.map((task, index) => ({
      organization_id: input.organizationId,
      plan_id: planId,
      created_by: input.userId,
      assigned_to: input.userId,
      step_order: task.stepOrder,
      category: task.category,
      title: task.title,
      description: task.description,
      due_offset_days: task.dueOffsetDays,
      due_date: datePlusDays(kickoffDate, task.dueOffsetDays),
      status: index < 2 ? "done" : "todo",
      completed_at: index < 2 ? new Date().toISOString() : null,
      completed_by: index < 2 ? input.userId : null,
    })),
  );
  if (tasks.error) throw new Error(tasks.error.message);
}

async function runHarborCrmSeed(input: {
  context: DemoContext;
  organizationId: string;
  harborProjectId: string;
  reset: boolean;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  // A version upgrade and a manual restore both rebuild the demo descendants.
  // This also makes deployment-order retries safe if the provider migration
  // lands after an initial page load partially seeded the walkthrough.
  await resetDemoActivity(supabaseAdmin, input.organizationId);
  const ownerName = await profileName(supabaseAdmin, input.context.userId);
  const playbook = await ensureDefaultPlaybook(
    supabaseAdmin,
    input.organizationId,
    input.context.userId,
  );
  const opportunities = new Map<string, Record<string, string>>();
  for (const fixture of HARBOR_CRM_DEMO_FIXTURES) {
    const accountId = await ensureAccount(
      supabaseAdmin,
      input.organizationId,
      input.context.userId,
      ownerName,
      fixture,
    );
    const contactId = await ensureContact(
      supabaseAdmin,
      input.organizationId,
      input.context.userId,
      accountId,
      fixture,
    );
    const opportunityId = await ensureOpportunity(
      supabaseAdmin,
      input.organizationId,
      input.context.userId,
      ownerName,
      input.harborProjectId,
      accountId,
      contactId,
      fixture,
    );
    opportunities.set(fixture.key, {
      id: opportunityId,
      accountId,
      contactId,
      name: fixture.name,
      client: fixture.client,
      contactName: fixture.contactName,
      contactEmail: fixture.contactEmail,
    });
    await seedOpportunityActivity({
      client: input.context.supabase,
      organizationId: input.organizationId,
      userId: input.context.userId,
      ownerName,
      opportunityId,
      accountId,
      contactId,
      fixture,
    });
  }

  const followupFixture = HARBOR_CRM_DEMO_FIXTURES.find((fixture) => fixture.enrollInFollowup);
  const followupOpportunity = followupFixture ? opportunities.get(followupFixture.key) : undefined;
  if (followupOpportunity) {
    await seedFollowupStory({
      client: input.context.supabase,
      deliveryClient: supabaseAdmin,
      organizationId: input.organizationId,
      userId: input.context.userId,
      ownerName,
      opportunity: followupOpportunity,
      playbookId: playbook.playbookId,
      steps: playbook.steps,
    });
  }
  const harborFixture = HARBOR_CRM_DEMO_FIXTURES.find((fixture) => fixture.linkToHarborProject);
  const harborOpportunity = harborFixture ? opportunities.get(harborFixture.key) : undefined;
  if (!harborOpportunity) throw new Error("Harbor CRM opportunity was not created.");
  await seedMeetingBrief({
    client: supabaseAdmin,
    organizationId: input.organizationId,
    userId: input.context.userId,
    opportunityId: harborOpportunity.id,
  });
  await seedOnboardingPlan({
    client: supabaseAdmin,
    organizationId: input.organizationId,
    userId: input.context.userId,
    opportunityId: harborOpportunity.id,
    projectId: input.harborProjectId,
  });
  const projectLink = await demoTable(supabaseAdmin, "projects")
    .update({ source_opportunity_id: harborOpportunity.id })
    .eq("id", input.harborProjectId)
    .eq("organization_id", input.organizationId);
  if (projectLink.error) throw new Error(projectLink.error.message);
  return { opportunityCount: opportunities.size };
}

async function seedOrReset(context: DemoContext, reset: boolean) {
  const organizationId = await currentOrganizationId(context);
  const harbor = await findHarborProject(context.supabase, organizationId);
  if (!harbor) return { seeded: false as const, reason: "harbor_missing" as const };
  if (harbor.archived_at) return { seeded: false as const, reason: "demo_opted_out" as const };
  const harborProjectId = str(harbor.id);
  await requireHarborManager(context, harborProjectId);
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const version = await demoTable(supabaseAdmin, "demo_seed_module_versions")
    .select("applied_version,status")
    .eq("project_id", harborProjectId)
    .eq("module_key", HARBOR_CRM_DEMO_MODULE_KEY)
    .maybeSingle();
  if (version.error) throw new Error(version.error.message);
  const versionRow = record(version.data);
  if (
    !reset &&
    Number(versionRow.applied_version) >= HARBOR_CRM_DEMO_VERSION &&
    versionRow.status === "ready"
  ) {
    return {
      seeded: false as const,
      reason: "current" as const,
      opportunityCount: HARBOR_CRM_DEMO_FIXTURES.length,
      harborProjectLinked: true,
    };
  }

  const now = new Date().toISOString();
  try {
    const result = await runHarborCrmSeed({
      context,
      organizationId,
      harborProjectId,
      reset,
    });
    const registry = await demoTable(supabaseAdmin, "demo_seed_module_versions").upsert(
      {
        project_id: harborProjectId,
        module_key: HARBOR_CRM_DEMO_MODULE_KEY,
        applied_version: HARBOR_CRM_DEMO_VERSION,
        status: "ready",
        last_operation: reset ? "reset" : "ensure",
        last_error: "",
        last_seeded_by: context.userId,
        last_seeded_at: now,
        ...(reset ? { last_reset_at: now } : {}),
        metadata: {
          canonical_source: "application-code",
          opportunity_count: result.opportunityCount,
          includes_followup: true,
          includes_meeting_brief: true,
          includes_onboarding: true,
        },
      },
      { onConflict: "project_id,module_key" },
    );
    if (registry.error) throw new Error(registry.error.message);
    return {
      seeded: true as const,
      reset,
      opportunityCount: result.opportunityCount,
      harborProjectLinked: true,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await demoTable(supabaseAdmin, "demo_seed_module_versions").upsert(
      {
        project_id: harborProjectId,
        module_key: HARBOR_CRM_DEMO_MODULE_KEY,
        applied_version: Number(versionRow.applied_version) || 0,
        status: "failed",
        last_operation: reset ? "reset" : "ensure",
        last_error: message.slice(0, 3000),
        last_seeded_by: context.userId,
        last_seeded_at: now,
      },
      { onConflict: "project_id,module_key" },
    );
    throw new Error(message);
  }
}

export const ensureHarborCrmDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => seedOrReset(context, false));

export const resetHarborCrmDemo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => seedOrReset(context, true));

export const getHarborCrmDemoStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await currentOrganizationId(context);
    const harbor = await findHarborProject(context.supabase, organizationId);
    if (!harbor) return { available: false as const, reason: "harbor_missing" as const };
    if (harbor.archived_at) return { available: false as const, reason: "demo_opted_out" as const };
    const projectId = str(harbor.id);
    const [version, opportunities] = await Promise.all([
      demoTable(context.supabase, "demo_seed_module_versions")
        .select("applied_version,status,last_operation,last_seeded_at,last_reset_at,last_error")
        .eq("project_id", projectId)
        .eq("module_key", HARBOR_CRM_DEMO_MODULE_KEY)
        .maybeSingle(),
      demoTable(context.supabase, "pipeline_opportunities")
        .select("id")
        .eq("organization_id", organizationId)
        .in(
          "name",
          HARBOR_CRM_DEMO_FIXTURES.map((fixture) => fixture.name),
        ),
    ]);
    if (version.error) throw new Error(version.error.message);
    if (opportunities.error) throw new Error(opportunities.error.message);
    const status = record(version.data);
    return {
      available: true as const,
      projectId,
      moduleKey: HARBOR_CRM_DEMO_MODULE_KEY,
      targetVersion: HARBOR_CRM_DEMO_VERSION,
      appliedVersion: Number(status.applied_version) || 0,
      status: str(status.status, "missing"),
      lastOperation: str(status.last_operation),
      lastSeededAt: str(status.last_seeded_at),
      lastResetAt: str(status.last_reset_at),
      lastError: str(status.last_error),
      opportunityCount: records(opportunities.data).length,
    };
  });
