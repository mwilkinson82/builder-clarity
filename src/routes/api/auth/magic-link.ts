import { sendLovableEmail } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { buildMagicLinkConfirmationUrl } from "@/lib/auth/magic-link-url";
import { resolveMagicLinkRedirect } from "@/lib/auth/magic-link-origins";

const SITE_NAME = "Overwatch";
const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
const RECENT_SEND_WINDOW_MS = 30_000;

const magicLinkInput = z.object({
  email: z.string().trim().email(),
  next: z.string().max(500).optional(),
  redirectTo: z.string().url().max(1000).optional(),
  context: z.enum(["login", "company_invite", "portfolio_invite", "client_portal"]).optional(),
  inviteId: z.string().uuid().optional(),
});

const INVITE_CONTEXTS = new Set(["company_invite", "portfolio_invite"] as const);

function jsonError(message: string, status = 400) {
  return Response.json({ success: false, error: message }, { status });
}

function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
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

        const email = normalizeEmail(parsed.data.email);
        const isProd = process.env.NODE_ENV === "production";
        const resolved = resolveMagicLinkRedirect({
          requestUrl: request.url,
          redirectTo: parsed.data.redirectTo,
          next: parsed.data.next,
          isProd,
        });
        if (!resolved.ok) {
          // Do not mint or send anything for an untrusted redirect target.
          return jsonError(resolved.reason, 400);
        }
        const redirectTo = resolved.redirectTo;
        const messageId = crypto.randomUUID();
        const label = "auth-magic-link";
        const idempotencyKey = `auth-magic-link:${email}:${messageId}`;
        const contextValue = parsed.data.context ?? "login";
        const isInviteContext = INVITE_CONTEXTS.has(
          contextValue as "company_invite" | "portfolio_invite",
        );

        // ---------------------------------------------------------------
        // P0 invite-context containment (finding 1):
        //
        // Before ANY createUser / generateLink / email-log / email-send,
        // an invite context MUST prove:
        //   1. The caller holds a valid Supabase session (Bearer token).
        //   2. `inviteId` names an EXACT organization_invites row.
        //   3. The invite email matches the requested email.
        //   4. The invite is still pending and not expired.
        //   5. The authenticated caller is authorized for the invitation
        //      (invited_by OR currently holds company.manage_team on the
        //      invited organization).
        //
        // On any failure we return a safe 401/403/409 and do ZERO side
        // effects: no admin.createUser, no generateLink, no email send,
        // no email_send_log insert.
        //
        // login and client_portal are UNCHANGED — they never provision.
        // ---------------------------------------------------------------
        if (isInviteContext) {
          if (!parsed.data.inviteId) {
            return jsonError("This invite request is missing its invite id.", 400);
          }

          const authHeader = request.headers.get("authorization");
          if (!authHeader?.startsWith("Bearer ")) {
            return jsonError("You must be signed in to send an invite.", 401);
          }
          const bearer = authHeader.slice("Bearer ".length).trim();
          if (!bearer) {
            return jsonError("You must be signed in to send an invite.", 401);
          }

          try {
            const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

            const { data: authData, error: authError } =
              await supabaseAdmin.auth.getUser(bearer);
            if (authError || !authData.user) {
              return jsonError("Your session expired. Sign in again.", 401);
            }
            const callerId = authData.user.id;

            const { data: inviteRow, error: inviteError } = await supabaseAdmin
              .from("organization_invites")
              .select("id, organization_id, email, status, expires_at, invited_by, role")
              .eq("id", parsed.data.inviteId)
              .maybeSingle();
            if (inviteError) throw inviteError;
            if (!inviteRow) {
              return jsonError("That invitation could not be found.", 409);
            }
            if (normalizeEmail(inviteRow.email as string) !== email) {
              return jsonError("This invite belongs to a different email address.", 409);
            }
            if (inviteRow.status !== "pending") {
              return jsonError("This invitation is no longer pending.", 409);
            }
            const expiresAt = inviteRow.expires_at
              ? Date.parse(inviteRow.expires_at as string)
              : NaN;
            if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
              return jsonError("This invitation has expired.", 409);
            }

            // Caller is authorized if they issued the invite OR currently
            // hold company.manage_team on the invited organization. Both
            // paths run under the RLS-scoped authed client (bearer token
            // routes the RPC to the caller's identity).
            const { createClient } = await import("@supabase/supabase-js");
            const authedForCap = createClient(
              process.env.SUPABASE_URL!,
              process.env.SUPABASE_PUBLISHABLE_KEY!,
              {
                global: { headers: { Authorization: `Bearer ${bearer}` } },
                auth: {
                  storage: undefined,
                  persistSession: false,
                  autoRefreshToken: false,
                },
              },
            );

            let callerAuthorized = inviteRow.invited_by === callerId;
            if (!callerAuthorized) {
              const { data: canManage, error: capError } = await authedForCap.rpc(
                "has_org_capability",
                {
                  p_org_id: inviteRow.organization_id as string,
                  p_capability: "company.manage_team",
                },
              );
              if (capError) throw new Error(capError.message);
              callerAuthorized = Boolean(canManage);
            }
            if (!callerAuthorized) {
              return jsonError(
                "You do not have permission to send this invitation.",
                403,
              );
            }
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Invite validation failed.";
            console.error("Overwatch magic link invite validation failed", {
              recipient_redacted: redactEmail(email),
              error: message,
            });
            return jsonError(message, 500);
          }
        }

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

          // Company/portfolio invites can target a brand-new email with no auth
          // user yet. A magic link can only be minted for an EXISTING user, so
          // a new invitee never got one ("invite not sending"). For invite
          // contexts, provision the account first (email marked confirmed so
          // the link signs them straight in); the on_auth_user_account_created
          // trigger then consumes their pending organization invite. If they
          // already have an account, ignore and just send a normal sign-in
          // link. Provisioning is ONLY reached after the invite-context
          // authorization gate above has validated the caller and the invite.
          if (isInviteContext) {
            const { error: createError } = await supabaseAdmin.auth.admin.createUser({
              email,
              email_confirm: true,
            });
            if (createError && !/already|registered|exist/i.test(createError.message ?? "")) {
              throw createError;
            }
          }

          const { data, error } = await supabaseAdmin.auth.admin.generateLink({
            type: "magiclink",
            email,
            options: { redirectTo },
          });

          if (error) throw error;

          const tokenHash = data.properties?.hashed_token;
          const confirmationLink = buildMagicLinkConfirmationUrl(redirectTo, tokenHash ?? "");

          await supabaseAdmin.from("email_send_log").insert({
            message_id: messageId,
            template_name: label,
            recipient_email: email,
            status: "pending",
            metadata: {
              context: contextValue,
              redirect_to: redirectTo,
              provider: "lovable-email",
            },
          });

          await sendLovableEmail(
            {
              to: email,
              from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
              sender_domain: SENDER_DOMAIN,
              subject: isInviteContext
                ? "You've been invited to Overwatch"
                : "Sign in to Overwatch",
              html: loginHtml(confirmationLink, contextValue),
              text: loginText(confirmationLink, contextValue),
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
            context: contextValue,
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
                context: contextValue,
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
