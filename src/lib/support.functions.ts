import { createServerFn } from "@tanstack/react-start";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { composeSupportEmail, supportRequestSchema } from "@/lib/support-request";

/**
 * In-app support intake. Replaces the old founder `mailto:` (which dead-ends on
 * mobile web) with a real server round-trip: the report is delivered to the
 * support inbox through the same outbound email path used by billing and CRM
 * notifications (`sendLovableEmail`). No new table, no migration — the message
 * plus auto-captured context is sent straight to the desk.
 */

const SUPPORT_INBOX = "support@alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";

const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const submitSupportRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => supportRequestSchema.parse(data))
  .handler(async ({ data, context }) => {
    // Reporter identity is taken from the authenticated session, never trusted
    // from the client payload.
    const profileRes = await context.supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", context.userId)
      .maybeSingle();
    const reporterEmail = str(profileRes.data?.email).trim();
    const reporterName = str(profileRes.data?.full_name).trim();

    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      // Prod has this configured (billing + CRM email rely on it). If it is
      // missing we do not silently swallow the report — surface an honest
      // failure so the user can fall back to email.
      console.error("[support] LOVABLE_API_KEY missing — support report not delivered", {
        userId: context.userId,
        category: data.category,
        routePath: data.routePath,
      });
      throw new Error("Support intake is not configured on this environment.");
    }

    const { subject, html, text } = composeSupportEmail(data, {
      name: reporterName,
      email: reporterEmail,
    });

    const messageId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `support-${Date.now()}`;

    const response = await sendLovableEmail(
      {
        to: SUPPORT_INBOX,
        from: `OverWatch <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        reply_to: reporterEmail || undefined,
        subject,
        html,
        text,
        purpose: "transactional",
        label: `support-${data.category}`,
        idempotency_key: `support:${messageId}`,
        message_id: messageId,
        unsubscribe_token: messageId,
        test_mode: false,
      },
      { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
    );

    if (!response.success) {
      throw new Error("We couldn't send that just now. Please try again.");
    }

    return { ok: true as const, messageId: response.message_id || messageId };
  });
