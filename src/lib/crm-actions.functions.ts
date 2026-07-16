import { sendLovableEmail } from "@lovable.dev/email-js";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  CRM_ONBOARDING_TASK_TEMPLATES,
  datePlusDays,
  followupEmailHtml,
} from "@/lib/crm-action-suite-domain";
import {
  currentOrganizationId,
  missingCrmActionSchema,
  nullableStr,
  num,
  str,
  table,
  type DynamicError,
} from "@/lib/crm-actions-server-shared";

const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";

export type CrmOutboundMessage = {
  id: string;
  opportunity_id: string;
  next_action_id: string | null;
  recipient_email: string;
  subject: string;
  status: "pending" | "sent" | "failed";
  error_message: string;
  sent_at: string | null;
  created_at: string;
};

export type CrmMeetingBrief = {
  id: string;
  opportunity_id: string;
  meeting_type: "sales" | "handoff" | "kickoff" | "client_onboarding";
  title: string;
  meeting_at: string | null;
  attendee_names: string[];
  meeting_goal: string;
  brief_data: Record<string, unknown>;
  status: "draft" | "final" | "archived";
  model_used: string;
  generated_at: string | null;
  created_at: string;
};

export type CrmOnboardingTask = {
  id: string;
  plan_id: string;
  assigned_to: string | null;
  step_order: number;
  category: string;
  title: string;
  description: string;
  due_offset_days: number;
  due_date: string | null;
  status: "todo" | "done" | "skipped";
  completed_at: string | null;
};

export type CrmOnboardingPlan = {
  id: string;
  opportunity_id: string;
  project_id: string | null;
  owner_user_id: string | null;
  title: string;
  status: "active" | "completed" | "stopped";
  kickoff_date: string | null;
  handoff_summary: string;
  completed_at: string | null;
  created_at: string;
  tasks: CrmOnboardingTask[];
};

export type CrmActionSuiteSnapshot = {
  enabled: boolean;
  outboundMessages: CrmOutboundMessage[];
  meetingBriefs: CrmMeetingBrief[];
  onboardingPlans: CrmOnboardingPlan[];
};

const row = (value: unknown) => value as Record<string, unknown>;
const rows = (value: unknown) => (Array.isArray(value) ? value.map(row) : []);

export const listCrmActionSuite = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CrmActionSuiteSnapshot> => {
    const organizationId = await currentOrganizationId(context);
    const [messages, briefs, plans, tasks] = await Promise.all([
      table(context.supabase, "crm_outbound_messages")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100),
      table(context.supabase, "crm_meeting_briefs")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100),
      table(context.supabase, "crm_onboarding_plans")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(100),
      table(context.supabase, "crm_onboarding_tasks")
        .select("*")
        .eq("organization_id", organizationId)
        .order("step_order", { ascending: true })
        .limit(1000),
    ]);
    const error = messages.error ?? briefs.error ?? plans.error ?? tasks.error;
    if (error) {
      if (missingCrmActionSchema(error)) {
        return { enabled: false, outboundMessages: [], meetingBriefs: [], onboardingPlans: [] };
      }
      throw new Error(error.message);
    }
    const normalizedTasks = rows(tasks.data).map((task): CrmOnboardingTask => ({
      id: str(task.id),
      plan_id: str(task.plan_id),
      assigned_to: nullableStr(task.assigned_to),
      step_order: num(task.step_order),
      category: str(task.category),
      title: str(task.title),
      description: str(task.description),
      due_offset_days: num(task.due_offset_days),
      due_date: nullableStr(task.due_date),
      status: str(task.status, "todo") as CrmOnboardingTask["status"],
      completed_at: nullableStr(task.completed_at),
    }));
    return {
      enabled: true,
      outboundMessages: rows(messages.data).map((message): CrmOutboundMessage => ({
        id: str(message.id),
        opportunity_id: str(message.opportunity_id),
        next_action_id: nullableStr(message.next_action_id),
        recipient_email: str(message.recipient_email),
        subject: str(message.subject),
        status: str(message.status, "pending") as CrmOutboundMessage["status"],
        error_message: str(message.error_message),
        sent_at: nullableStr(message.sent_at),
        created_at: str(message.created_at),
      })),
      meetingBriefs: rows(briefs.data).map((brief): CrmMeetingBrief => ({
        id: str(brief.id),
        opportunity_id: str(brief.opportunity_id),
        meeting_type: str(brief.meeting_type, "sales") as CrmMeetingBrief["meeting_type"],
        title: str(brief.title),
        meeting_at: nullableStr(brief.meeting_at),
        attendee_names: Array.isArray(brief.attendee_names)
          ? brief.attendee_names.map((name) => str(name)).filter(Boolean)
          : [],
        meeting_goal: str(brief.meeting_goal),
        brief_data:
          brief.brief_data && typeof brief.brief_data === "object" ? row(brief.brief_data) : {},
        status: str(brief.status, "draft") as CrmMeetingBrief["status"],
        model_used: str(brief.model_used),
        generated_at: nullableStr(brief.generated_at),
        created_at: str(brief.created_at),
      })),
      onboardingPlans: rows(plans.data).map((plan): CrmOnboardingPlan => ({
        id: str(plan.id),
        opportunity_id: str(plan.opportunity_id),
        project_id: nullableStr(plan.project_id),
        owner_user_id: nullableStr(plan.owner_user_id),
        title: str(plan.title),
        status: str(plan.status, "active") as CrmOnboardingPlan["status"],
        kickoff_date: nullableStr(plan.kickoff_date),
        handoff_summary: str(plan.handoff_summary),
        completed_at: nullableStr(plan.completed_at),
        created_at: str(plan.created_at),
        tasks: normalizedTasks.filter((task) => task.plan_id === str(plan.id)),
      })),
    };
  });

const sendInput = z.object({
  action_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(500),
  body: z.string().trim().min(1).max(20_000),
  value_asset_id: z.string().uuid().nullable().optional(),
  client_request_id: z.string().uuid(),
  test_mode: z.boolean().default(false),
});

async function assetDeliveryUrl(admin: unknown, asset: Record<string, unknown>) {
  const external = str(asset.external_url).trim();
  if (external) return external;
  const path = str(asset.storage_path).trim();
  if (!path) return "";
  const client = admin as {
    storage: {
      from(bucket: string): {
        createSignedUrl(
          path: string,
          seconds: number,
        ): Promise<{ data: { signedUrl?: string } | null; error: DynamicError | null }>;
      };
    };
  };
  const signed = await client.storage.from("crm-assets").createSignedUrl(path, 7 * 24 * 60 * 60);
  if (signed.error) throw new Error(signed.error.message);
  return signed.data?.signedUrl ?? "";
}

async function completeEnrollmentIfFinished(
  admin: unknown,
  organizationId: string,
  enrollmentId: string,
  completedAt: string,
) {
  if (!enrollmentId) return false;
  const result = await table(admin, "pipeline_next_actions")
    .select("id,completed_at,skipped_at")
    .eq("organization_id", organizationId)
    .eq("playbook_enrollment_id", enrollmentId)
    .limit(100);
  if (result.error) throw new Error(result.error.message);
  const hasOpen = rows(result.data).some(
    (action) => !nullableStr(action.completed_at) && !nullableStr(action.skipped_at),
  );
  if (hasOpen) return false;
  const completed = await table(admin, "crm_followup_enrollments")
    .update({ status: "completed", completed_at: completedAt })
    .eq("id", enrollmentId)
    .eq("organization_id", organizationId);
  if (completed.error) throw new Error(completed.error.message);
  return true;
}

function emailDisplayName(value: string) {
  return value
    .replace(/[<>"\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

async function finalizeSentFollowup(input: {
  admin: unknown;
  organizationId: string;
  userId: string;
  action: Record<string, unknown>;
  completedAt: string;
  providerMessageId: string;
  draft?: { subject: string; body: string; assetId: string | null; testMode: boolean };
}) {
  const values: Record<string, unknown> = {
    completed_at: input.completedAt,
    completed_by: input.userId,
    outcome: "sent",
    outcome_notes: input.draft?.testMode
      ? "Sent through Lovable email in test mode."
      : "Sent through OverWatch CRM.",
    sent_at: input.completedAt,
    sent_message_id: input.providerMessageId,
  };
  if (input.draft) {
    values.subject = input.draft.subject;
    values.body = input.draft.body;
    values.value_asset_id = input.draft.assetId;
  }
  const actionUpdate = await table(input.admin, "pipeline_next_actions")
    .update(values)
    .eq("id", str(input.action.id))
    .eq("organization_id", input.organizationId);
  if (actionUpdate.error) throw new Error(actionUpdate.error.message);
  return completeEnrollmentIfFinished(
    input.admin,
    input.organizationId,
    str(input.action.playbook_enrollment_id),
    input.completedAt,
  );
}

export const sendCrmFollowupEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => sendInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const actionResult = await table(context.supabase, "pipeline_next_actions")
      .select("*")
      .eq("id", data.action_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (actionResult.error) throw new Error(actionResult.error.message);
    if (!actionResult.data) throw new Error("That prepared follow-up was not found.");
    const action = row(actionResult.data);
    if (!nullableStr(action.playbook_enrollment_id)) {
      throw new Error("Only reviewed playbook follow-ups can be sent from OverWatch.");
    }
    const priorDelivery = await table(supabaseAdmin, "crm_outbound_messages")
      .select("id,status,provider_message_id,sent_at")
      .eq("organization_id", organizationId)
      .eq("next_action_id", data.action_id)
      .order("created_at", { ascending: false })
      .limit(1);
    if (priorDelivery.error && !missingCrmActionSchema(priorDelivery.error)) {
      throw new Error(priorDelivery.error.message);
    }
    const previous = rows(priorDelivery.data)[0];
    if (previous && str(previous.status) === "sent") {
      const sentAt = str(previous.sent_at) || new Date().toISOString();
      const playbookCompleted = await finalizeSentFollowup({
        admin: supabaseAdmin,
        organizationId,
        userId: context.userId,
        action,
        completedAt: sentAt,
        providerMessageId: str(previous.provider_message_id),
      });
      return {
        id: str(previous.id),
        providerMessageId: str(previous.provider_message_id),
        sentAt,
        idempotent: true,
        playbookCompleted,
      };
    }
    if (previous && str(previous.status) === "pending") {
      throw new Error(
        "A previous delivery is still reconciling. Check delivery history before trying again.",
      );
    }
    if (nullableStr(action.completed_at) || nullableStr(action.skipped_at)) {
      throw new Error("That follow-up is already closed.");
    }
    const opportunityResult = await table(context.supabase, "pipeline_opportunities")
      .select("id,name,client_contact_email,client_contact_name,archived")
      .eq("id", str(action.opportunity_id))
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (opportunityResult.error) throw new Error(opportunityResult.error.message);
    if (!opportunityResult.data || row(opportunityResult.data).archived === true) {
      throw new Error("The opportunity is no longer available.");
    }
    const recipientResult = z
      .string()
      .email()
      .safeParse(str(row(opportunityResult.data).client_contact_email).trim().toLowerCase());
    if (!recipientResult.success) {
      throw new Error("Add a valid contact email before sending this follow-up.");
    }
    const recipient = recipientResult.data;
    const suppression = await table(supabaseAdmin, "suppressed_emails")
      .select("id")
      .eq("email", recipient)
      .maybeSingle();
    if (suppression.error) throw new Error(suppression.error.message);
    if (suppression.data)
      throw new Error("That address has opted out or cannot receive OverWatch email.");

    let body = data.body.trim();
    let assetId: string | null = null;
    if (data.value_asset_id) {
      const assetResult = await table(context.supabase, "crm_value_assets")
        .select("*")
        .eq("id", data.value_asset_id)
        .eq("organization_id", organizationId)
        .eq("archived", false)
        .maybeSingle();
      if (assetResult.error) throw new Error(assetResult.error.message);
      if (!assetResult.data || row(assetResult.data).approved_for_external !== true) {
        throw new Error("That value resource is not approved for external sharing.");
      }
      assetId = data.value_asset_id;
      const url = await assetDeliveryUrl(supabaseAdmin, row(assetResult.data));
      if (!url) throw new Error("That value resource does not have a usable file or link.");
      body = `${body}\n\n${str(row(assetResult.data).title)}: ${url}`;
    }

    const profileResult = await table(context.supabase, "profiles")
      .select("email,full_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileResult.error) throw new Error(profileResult.error.message);
    const sender = profileResult.data ? row(profileResult.data) : {};
    const replyToResult = z.string().email().safeParse(str(sender.email).trim());
    if (!replyToResult.success) {
      throw new Error("Add a valid email to your OverWatch profile so the contact can reply.");
    }
    const replyTo = replyToResult.data;
    const senderName = emailDisplayName(
      str(sender.full_name).trim() || str(action.owner_name).trim() || "OverWatch CRM",
    );
    const messageId = crypto.randomUUID();
    const created = await table(supabaseAdmin, "crm_outbound_messages")
      .insert({
        organization_id: organizationId,
        opportunity_id: str(action.opportunity_id),
        next_action_id: data.action_id,
        value_asset_id: assetId,
        created_by: context.userId,
        sent_by: context.userId,
        client_request_id: data.client_request_id,
        recipient_email: recipient,
        reply_to_email: replyTo,
        subject: data.subject.trim(),
        body_text: body,
        provider_message_id: messageId,
        status: "pending",
      })
      .select("id")
      .single();
    if (created.error || !created.data) {
      throw new Error(
        missingCrmActionSchema(created.error)
          ? "Native CRM email is waiting for its Lovable database migration."
          : (created.error?.message ?? "The delivery record could not be created."),
      );
    }
    const outboundId = str(row(created.data).id);
    await table(supabaseAdmin, "email_send_log").insert({
      message_id: messageId,
      template_name: "crm-followup",
      recipient_email: recipient,
      status: "pending",
      metadata: {
        organization_id: organizationId,
        opportunity_id: str(action.opportunity_id),
        action_id: data.action_id,
        test_mode: data.test_mode,
      },
    });

    let providerDelivered = false;
    try {
      const apiKey = process.env.LOVABLE_API_KEY;
      if (!apiKey) throw new Error("Lovable email delivery is not configured.");
      const response = await sendLovableEmail(
        {
          to: recipient,
          from: `${senderName} via OverWatch <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          reply_to: replyTo || undefined,
          subject: data.subject.trim(),
          html: followupEmailHtml(body),
          text: body,
          purpose: "transactional",
          label: "crm-followup",
          idempotency_key: `crm-followup:${organizationId}:${data.client_request_id}`,
          message_id: messageId,
          unsubscribe_token: crypto.randomUUID(),
          test_mode: data.test_mode,
        },
        { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
      );
      if (!response.success) throw new Error("Lovable did not accept the email for delivery.");
      providerDelivered = true;
      const completedAt = new Date().toISOString();
      const providerMessageId = response.message_id || messageId;
      const deliveryUpdate = await table(supabaseAdmin, "crm_outbound_messages")
        .update({
          status: "sent",
          provider_message_id: providerMessageId,
          sent_at: completedAt,
          error_message: "",
        })
        .eq("id", outboundId);
      if (deliveryUpdate.error) throw new Error(deliveryUpdate.error.message);
      await table(supabaseAdmin, "email_send_log")
        .update({ status: "sent" })
        .eq("message_id", messageId);
      const playbookCompleted = await finalizeSentFollowup({
        admin: supabaseAdmin,
        organizationId,
        userId: context.userId,
        action,
        completedAt,
        providerMessageId,
        draft: {
          subject: data.subject.trim(),
          body: data.body.trim(),
          assetId,
          testMode: data.test_mode,
        },
      });
      await table(supabaseAdmin, "pipeline_activity_log").insert({
        opportunity_id: str(action.opportunity_id),
        organization_id: organizationId,
        event_type: "note_added",
        from_value: "",
        to_value: "sent",
        notes: `Follow-up sent to ${recipient}: ${data.subject.trim()}`,
        created_by: context.userId,
      });
      return {
        id: outboundId,
        providerMessageId,
        sentAt: completedAt,
        idempotent: false,
        playbookCompleted,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      if (!providerDelivered) {
        await table(supabaseAdmin, "crm_outbound_messages")
          .update({ status: "failed", error_message: message.slice(0, 2000) })
          .eq("id", outboundId);
        await table(supabaseAdmin, "email_send_log")
          .update({ status: "failed", error_message: message.slice(0, 1000) })
          .eq("message_id", messageId);
        throw new Error(message);
      }
      const recovery = await table(supabaseAdmin, "crm_outbound_messages")
        .update({
          status: "sent",
          provider_message_id: messageId,
          sent_at: new Date().toISOString(),
          error_message: "CRM close-out needs reconciliation.",
        })
        .eq("id", outboundId);
      if (recovery.error) {
        throw new Error(
          "The email was delivered, but delivery history is still reconciling. Do not resend while it shows Pending.",
        );
      }
      throw new Error(
        "The email was delivered, but the CRM close-out needs to reconcile. Try once more; OverWatch will not resend it.",
      );
    }
  });

const createPlanInput = z.object({
  opportunity_id: z.string().uuid(),
  owner_user_id: z.string().uuid().nullable().optional(),
  kickoff_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  handoff_summary: z.string().max(10_000).default(""),
});

export const createCrmOnboardingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createPlanInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const opportunity = await table(context.supabase, "pipeline_opportunities")
      .select("id,name,client,stage,converted_project_id,assigned_to")
      .eq("id", data.opportunity_id)
      .eq("organization_id", organizationId)
      .eq("archived", false)
      .maybeSingle();
    if (opportunity.error) throw new Error(opportunity.error.message);
    if (!opportunity.data) throw new Error("That won opportunity was not found.");
    const opportunityRow = row(opportunity.data);
    if (str(opportunityRow.stage) !== "won") {
      throw new Error("Start onboarding after the opportunity is marked Won.");
    }
    const ownerUserId = data.owner_user_id ?? context.userId;
    const membership = await table(context.supabase, "organization_memberships")
      .select("user_id")
      .eq("organization_id", organizationId)
      .eq("user_id", ownerUserId)
      .eq("status", "active")
      .maybeSingle();
    if (membership.error) throw new Error(membership.error.message);
    if (!membership.data) throw new Error("Choose an active company member as onboarding owner.");
    const plan = await table(context.supabase, "crm_onboarding_plans")
      .insert({
        organization_id: organizationId,
        opportunity_id: data.opportunity_id,
        project_id: nullableStr(opportunityRow.converted_project_id),
        created_by: context.userId,
        owner_user_id: ownerUserId,
        title: `${str(opportunityRow.name)} · Contract-to-kickoff`,
        kickoff_date: data.kickoff_date ?? null,
        handoff_summary: data.handoff_summary.trim(),
      })
      .select("id")
      .single();
    if (plan.error || !plan.data) {
      if (plan.error?.code === "23505")
        throw new Error("This opportunity already has an active onboarding plan.");
      throw new Error(
        missingCrmActionSchema(plan.error)
          ? "Onboarding is waiting for its Lovable database migration."
          : (plan.error?.message ?? "The onboarding plan could not be created."),
      );
    }
    const planId = str(row(plan.data).id);
    const taskInsert = await table(context.supabase, "crm_onboarding_tasks").insert(
      CRM_ONBOARDING_TASK_TEMPLATES.map((task) => ({
        organization_id: organizationId,
        plan_id: planId,
        created_by: context.userId,
        assigned_to: ownerUserId,
        step_order: task.stepOrder,
        category: task.category,
        title: task.title,
        description: task.description,
        due_offset_days: task.dueOffsetDays,
        due_date: datePlusDays(null, task.dueOffsetDays),
      })),
    );
    if (taskInsert.error) throw new Error(taskInsert.error.message);
    await table(context.supabase, "pipeline_activity_log").insert({
      opportunity_id: data.opportunity_id,
      organization_id: organizationId,
      event_type: "field_update",
      from_value: "won",
      to_value: "onboarding",
      notes: "Contract-to-kickoff onboarding plan created with eight prepared steps.",
      created_by: context.userId,
    });
    return { id: planId, taskCount: CRM_ONBOARDING_TASK_TEMPLATES.length };
  });

const taskInput = z.object({
  task_id: z.string().uuid(),
  status: z.enum(["todo", "done", "skipped"]),
});

export const updateCrmOnboardingTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => taskInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await currentOrganizationId(context);
    const task = await table(context.supabase, "crm_onboarding_tasks")
      .select("id,plan_id,status")
      .eq("id", data.task_id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (task.error) throw new Error(task.error.message);
    if (!task.data) throw new Error("That onboarding step was not found.");
    const completedAt = data.status === "done" ? new Date().toISOString() : null;
    const updated = await table(context.supabase, "crm_onboarding_tasks")
      .update({
        status: data.status,
        completed_at: completedAt,
        completed_by: completedAt ? context.userId : null,
      })
      .eq("id", data.task_id)
      .eq("organization_id", organizationId);
    if (updated.error) throw new Error(updated.error.message);
    const planId = str(row(task.data).plan_id);
    const allTasks = await table(context.supabase, "crm_onboarding_tasks")
      .select("id,status")
      .eq("plan_id", planId)
      .eq("organization_id", organizationId)
      .limit(100);
    if (allTasks.error) throw new Error(allTasks.error.message);
    const complete = rows(allTasks.data).every((candidate) => str(candidate.status) !== "todo");
    if (complete) {
      const planUpdate = await table(context.supabase, "crm_onboarding_plans")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", planId)
        .eq("organization_id", organizationId);
      if (planUpdate.error) throw new Error(planUpdate.error.message);
    }
    return { ok: true, planCompleted: complete };
  });
