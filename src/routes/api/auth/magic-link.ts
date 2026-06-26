import * as React from "react";
import { sendLovableEmail } from "@lovable.dev/email-js";
import { createClient } from "@supabase/supabase-js";
import { createFileRoute } from "@tanstack/react-router";
import { render } from "react-email";
import { z } from "zod";

import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";

const SITE_NAME = "Overwatch";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const ROOT_DOMAIN = "overwatch.alpcontractorcircle.com";

const inputSchema = z.object({
  email: z.string().trim().email(),
  redirectTo: z.string().url(),
  kind: z.enum(["login", "invite", "client"]).optional().default("login"),
});

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function allowedRedirect(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") return false;
  if (parsed.hostname === ROOT_DOMAIN) return true;
  if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return true;
  if (parsed.hostname.endsWith(".lovable.app")) return true;
  return false;
}

function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export const Route = createFileRoute("/api/auth/magic-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        const lovableApiKey = process.env.LOVABLE_API_KEY;

        if (!supabaseUrl || !supabaseServiceKey || !lovableApiKey) {
          console.error("Missing magic-link email configuration");
          return jsonError("Email service is not configured.", 500);
        }

        let body: z.infer<typeof inputSchema>;
        try {
          body = inputSchema.parse(await request.json());
        } catch {
          return jsonError("Enter a valid email address.");
        }

        if (!allowedRedirect(body.redirectTo)) {
          return jsonError("That sign-in redirect is not allowed.", 400);
        }

        const email = body.email.toLowerCase();
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        const { data, error } = await supabase.auth.admin.generateLink({
          type: "magiclink",
          email,
          options: { redirectTo: body.redirectTo },
        });

        if (error || !data.properties?.action_link) {
          console.error("Could not generate magic link", { error });
          return jsonError("Could not generate magic link.", 500);
        }

        const isInvite = body.kind === "invite";
        const subject = isInvite ? "You've been invited to Overwatch" : "Your Overwatch login link";
        const component = isInvite ? InviteEmail : MagicLinkEmail;
        const element = React.createElement(component, {
          siteName: SITE_NAME,
          siteUrl: `https://${ROOT_DOMAIN}`,
          confirmationUrl: data.properties.action_link,
        });
        const html = await render(element);
        const text = await render(element, { plainText: true });
        const messageId = crypto.randomUUID();

        try {
          await sendLovableEmail(
            {
              to: email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject,
              html,
              text,
              purpose: "transactional",
              label: `auth-${body.kind}`,
              idempotency_key: `${email}:${body.kind}:${Date.now()}`,
              unsubscribe_token: randomToken(),
              message_id: messageId,
            },
            { apiKey: lovableApiKey, sendUrl: process.env.LOVABLE_SEND_URL },
          );
        } catch (sendError) {
          console.error("Direct magic-link email failed", { sendError });
          await supabase.from("email_send_log").insert({
            message_id: messageId,
            template_name: `auth-${body.kind}`,
            recipient_email: email,
            status: "failed",
            error_message: sendError instanceof Error ? sendError.message.slice(0, 1000) : "Email send failed",
          });
          return jsonError("Magic link was created, but the email did not send.", 502);
        }

        await supabase.from("email_send_log").insert({
          message_id: messageId,
          template_name: `auth-${body.kind}`,
          recipient_email: email,
          status: "sent",
        });

        return Response.json({ success: true });
      },
    },
  },
});
