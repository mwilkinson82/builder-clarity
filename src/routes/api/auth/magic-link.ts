import { sendLovableEmail } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const LIVE_AUTH_ORIGIN = "https://overwatch.alpcontractorcircle.com";
const SITE_NAME = "Overwatch";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const RECENT_SEND_WINDOW_MS = 30_000;

const magicLinkInput = z.object({
  email: z.string().trim().email(),
  next: z.string().max(500).optional(),
  redirectTo: z.string().url().max(1000).optional(),
  context: z
    .enum(["login", "company_invite", "portfolio_invite", "client_portal"])
    .optional(),
});

function jsonError(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status });
}

function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

function normalizeNext(next: string | undefined) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

function requestOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) return origin;
  return new URL(request.url).origin;
}

function appOrigin(request: Request) {
  const origin = requestOrigin(request);
  const hostname = new URL(origin).hostname;
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname.endsWith(".lovable.app")
  ) {
    return origin;
  }
  return LIVE_AUTH_ORIGIN;
}

function normalizeRedirectTo(request: Request, next: string | undefined, redirectTo: string | undefined) {
  const origin = appOrigin(request);
  if (redirectTo) {
    const url = new URL(redirectTo);
    const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const isLovablePreview = url.hostname.endsWith(".lovable.app");
    if (url.origin === LIVE_AUTH_ORIGIN || isLocal || isLovablePreview) return url.toString();
  }

  return new URL(`/auth/callback?next=${encodeURIComponent(normalizeNext(next))}`, origin).toString();
}

function loginHtml(actionLink: string, context: string | undefined) {
  const intro =
    context === "client_portal"
      ? "Use this secure link to open the Overwatch client portal."
      : "Use this secure link to sign in to Overwatch.";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#211a16;">
    <div style="max-width:560px;margin:0 auto;padding:36px 24px;">
      <p style="margin:0 0 10px;text-transform:uppercase;letter-spacing:0.16em;font-size:11px;color:#776e66;">Overwatch</p>
      <h1 style="margin:0 0 12px;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:400;">Sign in to your account</h1>
      <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5750;">${intro}</p>
      <a href="${actionLink}" style="display:inline-block;background:#211a16;color:#fff;text-decoration:none;border-radius:6px;padding:12px 20px;font-size:14px;font-weight:700;">Open Overwatch</a>
      <p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#776e66;">This link can only be used once. If you did not request it, you can ignore this email.</p>
    </div>
  </body>
</html>`;
}

function loginText(actionLink: string, context: string | undefined) {
  const intro =
    context === "client_portal"
      ? "Use this secure link to open the Overwatch client portal."
      : "Use this secure link to sign in to Overwatch.";

  return `Overwatch\n\n${intro}\n\n${actionLink}\n\nThis link can only be used once. If you did not request it, you can ignore this email.`;
}

export const Route = createFileRoute("/api/auth/magic-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = magicLinkInput.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return jsonError("Enter a valid email address.");

        const apiKey = process.env.LOVABLE_API_KEY;
        if (!apiKey) {
          return jsonError("Overwatch email is not configured in this environment.", 503);
        }

        const email = parsed.data.email.toLowerCase();
        const redirectTo = normalizeRedirectTo(request, parsed.data.next, parsed.data.redirectTo);
        const messageId = crypto.randomUUID();
        const label = "auth-magic-link";
        const idempotencyKey = `auth-magic-link:${email}:${messageId}`;

        try {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

          const recentSince = new Date(Date.now() - RECENT_SEND_WINDOW_MS).toISOString();
          const { data: recentSend } = await supabaseAdmin
            .from("email_send_log")
            .select("id,status")
            .eq("recipient_email", email)
            .eq("template_name", label)
            .in("status", ["pending", "sent"])
            .gte("created_at", recentSince)
            .limit(1)
            .maybeSingle();

          if (recentSend) {
            return Response.json({ success: true, recentlySent: true });
          }

          const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo },
          });

          if (error) throw error;

          const actionLink = data.properties?.action_link;
          if (!actionLink) throw new Error("Supabase did not return a magic-link URL.");

          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: label,
            recipient_email: email,
            status: "pending",
            metadata: {
              context: parsed.data.context ?? "login",
              redirect_to: redirectTo,
              provider: "lovable-email",
            },
          });

          await sendLovableEmail(
            {
              to: email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject: "Sign in to Overwatch",
              html: loginHtml(actionLink, parsed.data.context),
              text: loginText(actionLink, parsed.data.context),
              purpose: "transactional",
              label,
              idempotency_key: idempotencyKey,
              message_id: messageId,
              unsubscribe_token: crypto.randomUUID(),
            } as Parameters<typeof sendLovableEmail>[0],
            { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
          );

          await supabaseAdmin
            .from("email_send_log")
            .update({ status: "sent" })
            .eq("message_id", messageId);

          console.log("Overwatch magic link sent", {
            recipient_redacted: redactEmail(email),
            context: parsed.data.context ?? "login",
          });

          return Response.json({ success: true });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not send magic link.";
          console.error("Overwatch magic link failed", {
            recipient_redacted: redactEmail(email),
            error: message,
          });

          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
            await supabaseAdmin.from("email_send_log").insert({
              message_id: messageId,
              template_name: label,
              recipient_email: email,
              status: "failed",
              error_message: message.slice(0, 1000),
              metadata: {
                context: parsed.data.context ?? "login",
                redirect_to: redirectTo,
                provider: "lovable-email",
              },
            });
          } catch {
            // Logging must never mask the actual send failure returned to the UI.
          }

          return jsonError(message, 500);
        }
      },
    },
  },
});
