import { sendLovableEmail } from "@lovable.dev/email-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  selectionDecisionHtml,
  selectionDecisionSubject,
  selectionDecisionText,
  type SelectionDecisionEmailInput,
} from "@/lib/selection-decision-notification";

const SITE_NAME = "Overwatch";
const APP_ORIGIN = "https://overwatch.alpcontractorcircle.com";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const TEMPLATE_NAME = "selection-decision-notification";

type DbError = { message?: string } | null;
type DbResult<T> = { data: T; error: DbError };
type DbQuery<T> = PromiseLike<DbResult<T[]>> & {
  select: (...args: unknown[]) => DbQuery<T>;
  insert: (...args: unknown[]) => DbQuery<T>;
  update: (...args: unknown[]) => DbQuery<T>;
  eq: (...args: unknown[]) => DbQuery<T>;
  in: (...args: unknown[]) => DbQuery<T>;
  single: () => Promise<DbResult<T>>;
  maybeSingle: () => Promise<DbResult<T | null>>;
};
type AdminClient = {
  from: <T>(name: string) => DbQuery<T>;
};

interface DecisionRow {
  id: string;
  project_id: string;
  selection_id: string;
  client_user_id: string | null;
  client_email: string;
  decision: "approved" | "revision_requested";
  notes: string;
  selection_snapshot: unknown;
  option_snapshot: unknown;
}

interface ProjectRow {
  id: string;
  name: string;
  job_number: string;
  organization_id: string | null;
  owner_id: string;
}

interface MembershipRow {
  user_id: string;
  role: string;
}

interface ProfileRow {
  id: string;
  email: string;
  full_name: string;
  notification_prefs: unknown;
}

interface SuppressionRow {
  id: string;
}

export interface SelectionDecisionDelivery {
  inAppCount: number;
  emailSentCount: number;
  emailFailedCount: number;
  emailSkippedCount: number;
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown) => (typeof value === "string" ? value : "");

function isEnabled(preferences: unknown, eventType: string) {
  const prefs = record(preferences);
  return prefs.selections !== false && prefs[eventType] !== false;
}

function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

export async function notifyProjectTeamOfSelectionDecision(
  decisionId: string,
): Promise<SelectionDecisionDelivery> {
  const admin = supabaseAdmin as unknown as AdminClient;
  const decisionResult = await admin
    .from<DecisionRow>("project_selection_decisions")
    .select(
      "id,project_id,selection_id,client_user_id,client_email,decision,notes,selection_snapshot,option_snapshot",
    )
    .eq("id", decisionId)
    .single();
  if (decisionResult.error) throw new Error(decisionResult.error.message ?? "Decision not found.");

  const decision = decisionResult.data;
  const [projectResult, membershipResult] = await Promise.all([
    admin
      .from<ProjectRow>("projects")
      .select("id,name,job_number,organization_id,owner_id")
      .eq("id", decision.project_id)
      .single(),
    admin
      .from<MembershipRow>("project_memberships")
      .select("user_id,role")
      .eq("project_id", decision.project_id)
      .eq("status", "active")
      .in("role", ["owner", "manager"]),
  ]);
  if (projectResult.error) throw new Error(projectResult.error.message ?? "Project not found.");

  const selection = record(decision.selection_snapshot);
  const option = record(decision.option_snapshot);
  const recipientIds = new Set<string>([
    projectResult.data.owner_id,
    text(selection.created_by),
    text(selection.updated_by),
    ...(membershipResult.data ?? []).map((membership) => membership.user_id),
  ]);
  recipientIds.delete("");

  if (recipientIds.size === 0) {
    return { inAppCount: 0, emailSentCount: 0, emailFailedCount: 0, emailSkippedCount: 0 };
  }

  const profilesResult = await admin
    .from<ProfileRow>("profiles")
    .select("id,email,full_name,notification_prefs")
    .in("id", [...recipientIds]);
  if (profilesResult.error)
    throw new Error(profilesResult.error.message ?? "Team profiles failed.");

  const eventType =
    decision.decision === "approved" ? "selection.approved" : "selection.revision_requested";
  const selectionTitle = text(selection.title) || "Project selection";
  const selectionNumber = text(selection.selection_number) || "Selection";
  const optionTitle = text(option.title);
  const clientDisplay = decision.client_email || "The client";
  const approved = decision.decision === "approved";
  const body = approved
    ? `${clientDisplay} approved ${selectionNumber} · ${selectionTitle}${optionTitle ? ` — ${optionTitle}` : ""}.`
    : `${clientDisplay} requested a revision to ${selectionNumber} · ${selectionTitle}.`;
  const title = approved ? "Selection approved" : "Selection revision requested";
  const selectionsUrl = `${APP_ORIGIN}/projects/${decision.project_id}?tab=selections`;
  const enabledProfiles = (profilesResult.data ?? []).filter((profile) =>
    isEnabled(profile.notification_prefs, eventType),
  );

  let inAppCount = 0;
  if (enabledProfiles.length > 0) {
    const notificationResult = await admin.from<Record<string, unknown>>("notifications").insert(
      enabledProfiles.map((profile) => ({
        recipient_id: profile.id,
        organization_id: projectResult.data.organization_id,
        actor_id: decision.client_user_id,
        type: eventType,
        title,
        body,
        project_id: decision.project_id,
        entity_type: "project_selection",
        entity_id: decision.selection_id,
        url: `/projects/${decision.project_id}?tab=selections`,
        data: {
          decision_id: decision.id,
          decision: decision.decision,
          selection_number: selectionNumber,
          selection_title: selectionTitle,
          option_title: optionTitle,
        },
      })),
    );
    if (notificationResult.error) {
      console.error("Selection decision in-app notification failed", {
        decision_id: decision.id,
        error: notificationResult.error.message,
      });
    } else {
      inAppCount = enabledProfiles.length;
    }
  }

  let emailSentCount = 0;
  let emailFailedCount = 0;
  let emailSkippedCount = 0;
  const apiKey = process.env.LOVABLE_API_KEY;
  const emailInput: SelectionDecisionEmailInput = {
    decision: decision.decision,
    projectName: projectResult.data.name,
    jobNumber: projectResult.data.job_number,
    selectionNumber,
    selectionTitle,
    optionTitle,
    clientDisplay,
    notes: decision.notes,
    needOnSiteDate: text(selection.need_on_site_date) || null,
    selectionsUrl,
  };

  for (const profile of enabledProfiles) {
    const email = profile.email.trim().toLowerCase();
    if (!email) {
      emailSkippedCount += 1;
      continue;
    }
    if (!apiKey) {
      emailFailedCount += 1;
      console.error("Selection decision email is not configured", { recipient_id: profile.id });
      continue;
    }

    const suppressionResult = await admin
      .from<SuppressionRow>("suppressed_emails")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (suppressionResult.error || suppressionResult.data) {
      emailSkippedCount += 1;
      continue;
    }

    const messageId = crypto.randomUUID();
    const metadata = {
      decision_id: decision.id,
      project_id: decision.project_id,
      selection_id: decision.selection_id,
      recipient_id: profile.id,
      provider: "lovable-email",
    };
    await admin.from<Record<string, unknown>>("email_send_log").insert({
      message_id: messageId,
      template_name: TEMPLATE_NAME,
      recipient_email: email,
      status: "pending",
      metadata,
    });

    try {
      await sendLovableEmail(
        {
          to: email,
          from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject: selectionDecisionSubject(emailInput),
          html: selectionDecisionHtml(emailInput),
          text: selectionDecisionText(emailInput),
          purpose: "transactional",
          label: TEMPLATE_NAME,
          idempotency_key: `selection-decision:${decision.id}:${profile.id}`,
          message_id: messageId,
          unsubscribe_token: crypto.randomUUID(),
        } as Parameters<typeof sendLovableEmail>[0],
        { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
      );
      await admin
        .from<Record<string, unknown>>("email_send_log")
        .update({ status: "sent" })
        .eq("message_id", messageId);
      emailSentCount += 1;
      console.log("Selection decision email sent", {
        decision_id: decision.id,
        recipient_redacted: redactEmail(email),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await admin
        .from<Record<string, unknown>>("email_send_log")
        .update({ status: "failed", error_message: message.slice(0, 1000) })
        .eq("message_id", messageId);
      emailFailedCount += 1;
      console.error("Selection decision email failed", {
        decision_id: decision.id,
        recipient_redacted: redactEmail(email),
        error: message,
      });
    }
  }

  return { inAppCount, emailSentCount, emailFailedCount, emailSkippedCount };
}
