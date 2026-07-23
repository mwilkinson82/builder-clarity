// P0 invite-context containment (finding 1) — injectable magic-link handler.
//
// The TanStack file-route wrapper (src/routes/api/auth/magic-link.ts) exists
// only to bind the transport (Request/Response, env, Supabase admin client,
// Lovable email sender). All authorization + provisioning logic lives here
// behind a dependency boundary so behavioral Vitest tests can invoke the
// same function with spies/mocks and assert exact call counts.
//
// Contract invariants proven by tests:
//   * login and client_portal never reach createUser / generateLink /
//     email_send_log / sendLovableEmail through this path unless the
//     redirect is allowlisted; they never accept inviteId.
//   * company_invite and portfolio_invite MUST prove, before any side
//     effect (recent-send lookup included):
//       - inviteId is present;
//       - the caller has a valid Bearer token;
//       - the invite row exists;
//       - the invite email matches the requested email;
//       - the invite is pending and not expired;
//       - the caller is the inviter OR holds company.manage_team.
//     Any failure returns a safe JSON error and performs ZERO admin calls
//     and ZERO email_send_log inserts.
//   * createUser is invoked for invite contexts only, and only its
//     documented duplicate-user error (message matches /already|registered
//     |exist/i) is treated as nonfatal. Any other createUser error stops
//     the flow before generateLink / email send.
//   * Bearer tokens are never returned or logged.

import { z } from "zod";
import { buildMagicLinkConfirmationUrl } from "@/lib/auth/magic-link-url";
import {
  resolveMagicLinkRedirect,
  type ResolveMagicLinkRedirectResult,
} from "@/lib/auth/magic-link-origins";

export const SITE_NAME = "Overwatch";
export const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
export const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
export const RECENT_SEND_WINDOW_MS = 30_000;

export const magicLinkInput = z.object({
  email: z.string().trim().email(),
  next: z.string().max(500).optional(),
  redirectTo: z.string().url().max(1000).optional(),
  context: z.enum(["login", "company_invite", "portfolio_invite", "client_portal"]).optional(),
  inviteId: z.string().uuid().optional(),
});

export type MagicLinkRequestBody = z.infer<typeof magicLinkInput>;

export type MagicLinkResult =
  | { ok: true; status: number; body: { success: true; recentlySent?: boolean } }
  | { ok: false; status: number; body: { success: false; error: string } };

export type EmailSendLogRow = {
  id?: string;
  message_id: string;
  template_name: string;
  recipient_email: string;
  status: "pending" | "sent" | "failed";
  error_message?: string;
  metadata?: Record<string, unknown>;
};

export type SendLovableEmailPayload = {
  to: string;
  from: string;
  sender_domain: string;
  subject: string;
  html: string;
  text: string;
  purpose: string;
  label: string;
  idempotency_key: string;
  message_id: string;
  unsubscribe_token: string;
};

export type MagicLinkDeps = {
  now: () => number;
  randomUUID: () => string;
  isProd: boolean;
  apiKey: string | undefined;
  supabaseUrl: string;
  supabasePublishableKey: string;
  sendUrl?: string;
  resolveRedirect?: (args: {
    requestUrl: string;
    redirectTo?: string;
    next?: string;
    isProd: boolean;
  }) => ResolveMagicLinkRedirectResult;

  // Admin / auth. All calls here talk to the service-role client on the
  // server route; tests inject spies.
  getAuthUserFromBearer: (bearer: string) => Promise<{
    user: { id: string } | null;
    error: unknown;
  }>;
  fetchInviteById: (inviteId: string) => Promise<
    | {
        id: string;
        organization_id: string;
        email: string;
        status: string;
        expires_at: string | null;
        invited_by: string | null;
        role: string;
      }
    | null
  >;
  callerHasManageTeam: (args: {
    bearer: string;
    organizationId: string;
  }) => Promise<boolean>;

  // Recent-send shortcut — MUST only run after the invite gate passes for
  // invite contexts.
  findRecentSend: (email: string, label: string, sinceIso: string) => Promise<
    { id: string; status: string } | null
  >;

  createAuthUser: (email: string) => Promise<{ error?: { message?: string } | null }>;
  generateMagicLink: (args: {
    email: string;
    redirectTo: string;
  }) => Promise<{ hashedToken: string | null; error?: { message?: string } | null }>;

  insertEmailSendLog: (row: EmailSendLogRow) => Promise<void>;
  updateEmailSendLogStatus: (messageId: string, status: "sent" | "failed") => Promise<void>;
  sendEmail: (payload: SendLovableEmailPayload) => Promise<void>;
  logInfo?: (msg: string, meta?: Record<string, unknown>) => void;
  logError?: (msg: string, meta?: Record<string, unknown>) => void;
};

const INVITE_CONTEXTS = new Set(["company_invite", "portfolio_invite"] as const);
const DUPLICATE_USER_ERROR = /already|registered|exist/i;

export function redactEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "***";
  return `${local[0]}***@${domain}`;
}

export function normalizeEmail(input: string) {
  return input.trim().toLowerCase();
}

function jsonError(message: string, status = 400): MagicLinkResult {
  return { ok: false, status, body: { success: false, error: message } };
}

function ok(body: { success: true; recentlySent?: boolean }, status = 200): MagicLinkResult {
  return { ok: true, status, body };
}

function loginHtml(actionLink: string, context: string | undefined) {
  const intro =
    context === "client_portal"
      ? "Use this secure link to open the Overwatch client portal."
      : "Use this secure link to sign in to Overwatch.";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f7f4ee;font-family:Arial,sans-serif;color:#211a16;"><div style="max-width:560px;margin:0 auto;padding:36px 24px;"><p style="margin:0 0 10px;text-transform:uppercase;letter-spacing:0.16em;font-size:11px;color:#776e66;">Overwatch</p><h1 style="margin:0 0 12px;font-size:30px;line-height:1.15;font-family:Georgia,serif;font-weight:400;">Sign in to your account</h1><p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:#5f5750;">${intro}</p><a href="${actionLink}" style="display:inline-block;background:#211a16;color:#fff;text-decoration:none;border-radius:6px;padding:12px 20px;font-size:14px;font-weight:700;">Open Overwatch</a><p style="margin:28px 0 0;font-size:12px;line-height:1.5;color:#776e66;">This link can only be used once. If you did not request it, you can ignore this email.</p></div></body></html>`;
}

function loginText(actionLink: string, context: string | undefined) {
  const intro =
    context === "client_portal"
      ? "Use this secure link to open the Overwatch client portal."
      : "Use this secure link to sign in to Overwatch.";
  return `Overwatch\n\n${intro}\n\n${actionLink}\n\nThis link can only be used once. If you did not request it, you can ignore this email.`;
}

export async function handleMagicLinkRequest(args: {
  requestUrl: string;
  body: unknown;
  authorizationHeader: string | null;
  deps: MagicLinkDeps;
}): Promise<MagicLinkResult> {
  const { requestUrl, body, authorizationHeader, deps } = args;

  const parsed = magicLinkInput.safeParse(body);
  if (!parsed.success) return jsonError("Enter a valid email address.");

  if (!deps.apiKey) {
    return jsonError("Overwatch email is not configured in this environment.", 503);
  }

  const email = normalizeEmail(parsed.data.email);
  const resolver = deps.resolveRedirect ?? resolveMagicLinkRedirect;
  const resolved = resolver({
    requestUrl,
    redirectTo: parsed.data.redirectTo,
    next: parsed.data.next,
    isProd: deps.isProd,
  });
  if (!resolved.ok) return jsonError(resolved.reason, 400);
  const redirectTo = resolved.redirectTo;

  const messageId = deps.randomUUID();
  const label = "auth-magic-link";
  const idempotencyKey = `auth-magic-link:${email}:${messageId}`;
  const contextValue = parsed.data.context ?? "login";
  const isInviteContext = INVITE_CONTEXTS.has(
    contextValue as "company_invite" | "portfolio_invite",
  );

  // ---------------- Invite-context authorization gate ----------------
  if (isInviteContext) {
    if (!parsed.data.inviteId) {
      return jsonError("This invite request is missing its invite id.", 400);
    }

    if (!authorizationHeader?.startsWith("Bearer ")) {
      return jsonError("You must be signed in to send an invite.", 401);
    }
    const bearer = authorizationHeader.slice("Bearer ".length).trim();
    if (!bearer) return jsonError("You must be signed in to send an invite.", 401);

    let callerId: string;
    try {
      const authResult = await deps.getAuthUserFromBearer(bearer);
      if (authResult.error || !authResult.user) {
        return jsonError("Your session expired. Sign in again.", 401);
      }
      callerId = authResult.user.id;
    } catch (error) {
      deps.logError?.("magic-link auth verify failed", {
        recipient_redacted: redactEmail(email),
        error: error instanceof Error ? error.message : "auth failed",
      });
      return jsonError("Your session could not be verified.", 401);
    }

    let inviteRow: Awaited<ReturnType<typeof deps.fetchInviteById>>;
    try {
      inviteRow = await deps.fetchInviteById(parsed.data.inviteId);
    } catch (error) {
      deps.logError?.("magic-link invite lookup failed", {
        recipient_redacted: redactEmail(email),
        error: error instanceof Error ? error.message : "invite lookup failed",
      });
      return jsonError("Invite validation failed.", 500);
    }
    if (!inviteRow) return jsonError("That invitation could not be found.", 409);
    if (normalizeEmail(inviteRow.email) !== email) {
      return jsonError("This invite belongs to a different email address.", 409);
    }
    if (inviteRow.status !== "pending") {
      return jsonError("This invitation is no longer pending.", 409);
    }
    const expiresAt = inviteRow.expires_at ? Date.parse(inviteRow.expires_at) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= deps.now()) {
      return jsonError("This invitation has expired.", 409);
    }

    let callerAuthorized = inviteRow.invited_by === callerId;
    if (!callerAuthorized) {
      try {
        callerAuthorized = await deps.callerHasManageTeam({
          bearer,
          organizationId: inviteRow.organization_id,
        });
      } catch (error) {
        deps.logError?.("magic-link capability lookup failed", {
          recipient_redacted: redactEmail(email),
          error: error instanceof Error ? error.message : "capability lookup failed",
        });
        return jsonError("Invite authorization check failed.", 500);
      }
    }
    if (!callerAuthorized) {
      return jsonError("You do not have permission to send this invitation.", 403);
    }
  }

  // -------------- Provisioning + send (post-authorization) ------------
  try {
    const recentSince = new Date(deps.now() - RECENT_SEND_WINDOW_MS).toISOString();
    const recentSend = await deps.findRecentSend(email, label, recentSince);
    if (recentSend) return ok({ success: true, recentlySent: true });

    if (isInviteContext) {
      const { error: createError } = await deps.createAuthUser(email);
      if (createError && !DUPLICATE_USER_ERROR.test(createError.message ?? "")) {
        throw new Error(createError.message ?? "Could not create invited user.");
      }
    }

    const linkResult = await deps.generateMagicLink({ email, redirectTo });
    if (linkResult.error) throw new Error(linkResult.error.message ?? "generateLink failed");
    const confirmationLink = buildMagicLinkConfirmationUrl(
      redirectTo,
      linkResult.hashedToken ?? "",
    );

    await deps.insertEmailSendLog({
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

    await deps.sendEmail({
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
      unsubscribe_token: deps.randomUUID(),
    });

    await deps.updateEmailSendLogStatus(messageId, "sent");
    deps.logInfo?.("Overwatch magic link sent", {
      recipient_redacted: redactEmail(email),
      context: contextValue,
    });
    return ok({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send magic link.";
    deps.logError?.("Overwatch magic link failed", {
      recipient_redacted: redactEmail(email),
      error: message,
    });
    try {
      await deps.insertEmailSendLog({
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
      // Never mask original failure.
    }
    return jsonError(message, 500);
  }
}
