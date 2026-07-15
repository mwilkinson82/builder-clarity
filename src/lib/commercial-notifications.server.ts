import { sendLovableEmail } from "@lovable.dev/email-js";

const APP_ORIGIN = "https://overwatch.alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";

export type CommercialNoticeKind = "pro_activated" | "payment_past_due" | "subscription_ended";

type DbResult = { data: Record<string, unknown>[] | null; error: { message: string } | null };
type DbQuery = PromiseLike<DbResult> & {
  select(columns?: string): DbQuery;
  insert(values: unknown): DbQuery;
  update(values: unknown): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  in(column: string, values: string[]): DbQuery;
  maybeSingle(): Promise<{
    data: Record<string, unknown> | null;
    error: { message: string } | null;
  }>;
};
type AdminClient = { from(relation: string): DbQuery };

const from = (admin: unknown, relation: string) => (admin as AdminClient).from(relation);
const text = (value: unknown) => (typeof value === "string" ? value : "");

function content(kind: CommercialNoticeKind, companyName: string, graceEndsAt?: string) {
  if (kind === "pro_activated") {
    return {
      subject: `OverWatch Pro is active for ${companyName}`,
      title: "OverWatch Pro is active",
      body: `${companyName} now has 25 active projects, 10 internal seats, 25 GB of daily-report storage, and 500 AI estimating credits each month.`,
      cta: "Open plan and usage",
    };
  }
  if (kind === "payment_past_due") {
    const grace = graceEndsAt
      ? ` Update payment details before ${new Date(graceEndsAt).toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
          timeZone: "UTC",
        })} to avoid new-work limits.`
      : " Update payment details to keep Pro active.";
    return {
      subject: `Action needed: OverWatch Pro payment for ${companyName}`,
      title: "Your OverWatch Pro payment needs attention",
      body: `Stripe could not complete the latest subscription payment.${grace} Existing company data remains available.`,
      cta: "Manage subscription",
    };
  }
  return {
    subject: `OverWatch Pro ended for ${companyName}`,
    title: "OverWatch Pro has ended",
    body: `${companyName} is now on OverWatch Free. Existing data remains available, while new projects and seats follow the Free plan limits.`,
    cta: "Review plan and usage",
  };
}

function htmlEmail(title: string, body: string, cta: string) {
  return `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:Arial,sans-serif;color:#1f1e1b"><div style="max-width:600px;margin:0 auto;padding:40px 20px"><div style="font-size:22px;font-weight:700;margin-bottom:32px">OverWatch <span style="color:#d97757">▪</span></div><div style="background:#fff;border:1px solid #e4e1d6;border-radius:14px;padding:32px"><div style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin-bottom:16px">${title}</div><p style="font-size:15px;line-height:1.65;color:#5f5c55;margin:0 0 24px">${body}</p><a href="${APP_ORIGIN}/team?section=plan" style="display:inline-block;background:#1f1e1b;color:#fff;text-decoration:none;border-radius:9px;padding:13px 18px;font-weight:700">${cta}</a></div><p style="font-size:12px;line-height:1.5;color:#76736b;margin-top:20px">OverWatch is an ALP product. This is a transactional account notice.</p></div></body></html>`;
}

export async function sendCommercialNotice(
  admin: unknown,
  input: {
    organizationId: string;
    kind: CommercialNoticeKind;
    eventId: string;
    graceEndsAt?: string;
  },
) {
  const organizationResult = await from(admin, "organizations")
    .select("id,name,billing_email")
    .eq("id", input.organizationId)
    .maybeSingle();
  if (organizationResult.error || !organizationResult.data) return;

  const memberships = await from(admin, "organization_memberships")
    .select("user_id,role,status")
    .eq("organization_id", input.organizationId)
    .eq("status", "active");
  const recipientIds = (memberships.data ?? [])
    .filter((row) => row.role === "owner" || row.role === "admin")
    .map((row) => text(row.user_id))
    .filter(Boolean);
  const profiles =
    recipientIds.length > 0
      ? await from(admin, "profiles").select("id,email,notification_prefs").in("id", recipientIds)
      : { data: [], error: null };

  const emailRecipients = new Set<string>();
  const billingEmail = text(organizationResult.data.billing_email).trim().toLowerCase();
  if (billingEmail) emailRecipients.add(billingEmail);
  for (const profile of profiles.data ?? []) {
    const preferences =
      profile.notification_prefs && typeof profile.notification_prefs === "object"
        ? (profile.notification_prefs as Record<string, unknown>)
        : {};
    if (preferences.billing === false) continue;
    const email = text(profile.email).trim().toLowerCase();
    if (email) emailRecipients.add(email);
  }

  const notice = content(
    input.kind,
    text(organizationResult.data.name) || "your company",
    input.graceEndsAt,
  );
  if (recipientIds.length > 0) {
    await from(admin, "notifications").insert(
      recipientIds.map((recipientId) => ({
        recipient_id: recipientId,
        organization_id: input.organizationId,
        actor_id: null,
        type: `subscription.${input.kind}`,
        title: notice.title,
        body: notice.body,
        entity_type: "organization_subscription",
        entity_id: input.organizationId,
        url: "/team?section=plan",
        dedupe_key: `subscription.${input.kind}:${input.eventId}`,
        data: { stripe_event_id: input.eventId },
      })),
    );
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return;
  for (const email of emailRecipients) {
    const suppression = await from(admin, "suppressed_emails")
      .select("id")
      .eq("email", email)
      .maybeSingle();
    if (suppression.data) continue;

    const messageId = crypto.randomUUID();
    await from(admin, "email_send_log").insert({
      message_id: messageId,
      template_name: `subscription-${input.kind}`,
      recipient_email: email,
      status: "pending",
      metadata: { organization_id: input.organizationId, stripe_event_id: input.eventId },
    });
    try {
      await sendLovableEmail(
        {
          to: email,
          from: `OverWatch <noreply@${FROM_DOMAIN}>`,
          sender_domain: SENDER_DOMAIN,
          subject: notice.subject,
          html: htmlEmail(notice.title, notice.body, notice.cta),
          text: `OverWatch\n\n${notice.title}\n\n${notice.body}\n\n${APP_ORIGIN}/team?section=plan`,
          purpose: "transactional",
          label: `subscription-${input.kind}`,
          idempotency_key: `subscription:${input.kind}:${input.eventId}:${email}`,
          message_id: messageId,
          unsubscribe_token: crypto.randomUUID(),
        } as Parameters<typeof sendLovableEmail>[0],
        { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
      );
      await from(admin, "email_send_log").update({ status: "sent" }).eq("message_id", messageId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Email delivery failed.";
      await from(admin, "email_send_log")
        .update({ status: "failed", error_message: message.slice(0, 1000) })
        .eq("message_id", messageId);
      console.error("Commercial notice delivery failed", {
        organization_id: input.organizationId,
        kind: input.kind,
        error: message,
      });
    }
  }
}
