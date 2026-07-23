// P0 sign-in containment — injectable magic-link handler.
//
// Contract summary (behavioral tests pin every branch):
//
//   * `login` (public). MUST NOT provision an unknown auth user.
//     The handler first calls `lookupExistingAuthUser`. If the email
//     is unknown, the handler returns the generic success response
//     with ZERO side effects: no createUser, no generateLink, no
//     send reservation, no sendEmail, no audit rows, no leaked
//     information about existence.
//     For an existing user, generateLink runs with type:"magiclink"
//     (no user creation because the user already exists).
//
//   * `company_invite` / `portfolio_invite` (authenticated).
//     REQUIRES inviteId, a valid Bearer, an exact organization_invites
//     row that (a) matches the requested normalized email, (b) is
//     `pending` with `expires_at > now()` strictly, (c) was originally
//     issued by the caller (`invited_by === auth.uid()`), AND (d) the
//     caller currently holds `company.manage_team` on the invite's
//     organization. All four are AND-ed. Any failure returns a safe
//     JSON error with ZERO side effects. An existing Auth user receives
//     a magiclink; only a genuinely new user reaches generateLink with
//     type:"invite". A duplicate-user race retries once as magiclink.
//
//   * `client_portal` (authenticated). REQUIRES clientAccessId, a
//     valid Bearer, an exact `project_client_access` row that
//     (a) matches the requested normalized email, (b) has status in
//     {'active','pending'} — a `revoked` row returns 409 with zero
//     side effects, AND (c) the caller currently holds
//     `client_portal.manage` on the access row's project organization.
//     Existing/new/race behavior matches the organization invite path.
//
//   * Every Supabase adapter that returns `.error` MUST throw at the
//     adapter layer — the handler treats absence of error as truth and
//     will not silently continue on a broken persistence layer.
//
//   * generateLink MUST return a nonempty `hashedToken` AND a nonempty
//     `userId`. Missing either fails after the atomic reservation but
//     BEFORE sendEmail; the reserved row is then marked failed.
//
//   * `sendLovableEmail` returning `{success:false}` MUST be thrown at
//     the adapter layer.
//
//   * Dedupe identity = (normalizedEmail, context, inviteId|clientAccessId|"login").
//     A different org invite / different client access can never be
//     suppressed by a recent send for another row.
//
//   * Failure path: the ORIGINAL pending email_send_log row (created
//     before the send attempt) is UPDATEd to `failed`; the handler
//     never inserts a second row that could leave the retry-suppressor
//     pending.
//
//   * Audit metadata carries safe provenance only (context, invite_id,
//     organization_id, inviter_id, client_access_id, project_id).
//     Bearer tokens, provider messages, and provider codes are NEVER
//     returned to the client — provider codes go to logs/audit only.
//
//   * Redirect and hashed-token confirmation URL construction is
//     unchanged; the hashed token is scanner-safe and requires an
//     explicit human confirmation click.

import { z } from "zod";
import { buildMagicLinkConfirmationUrl } from "@/lib/auth/magic-link-url";
import {
  resolveMagicLinkRedirect,
  type ResolveRedirectResult,
} from "@/lib/auth/magic-link-origins";

export const SITE_NAME = "Overwatch";
export const SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
export const FROM_DOMAIN = "overwatch.alpcontractorcircle.com";
export const RECENT_SEND_WINDOW_MS = 30_000;

/**
 * Documented Supabase auth-admin duplicate codes. Message-based
 * matching is explicitly rejected — it false-positives on
 * "database instance does not exist" and similar unrelated errors.
 */
export const DUPLICATE_USER_CODES = new Set(["email_exists", "user_already_exists"]);

export const magicLinkInput = z
  .object({
    email: z.string().trim().email(),
    next: z.string().max(500).optional(),
    redirectTo: z.string().url().max(1000).optional(),
    context: z.enum(["login", "company_invite", "portfolio_invite", "client_portal"]).optional(),
    inviteId: z.string().uuid().optional(),
    clientAccessId: z.string().uuid().optional(),
  })
  .superRefine((val, ctx) => {
    const isInvite = val.context === "company_invite" || val.context === "portfolio_invite";
    const isClient = val.context === "client_portal";
    if (!isInvite && val.inviteId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inviteId"],
        message: "inviteId is only valid for invite contexts.",
      });
    }
    if (isInvite && !val.inviteId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["inviteId"],
        message: "inviteId is required for invite contexts.",
      });
    }
    if (!isClient && val.clientAccessId !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientAccessId"],
        message: "clientAccessId is only valid for the client_portal context.",
      });
    }
    if (isClient && !val.clientAccessId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clientAccessId"],
        message: "clientAccessId is required for the client_portal context.",
      });
    }
  });

export type MagicLinkRequestBody = z.infer<typeof magicLinkInput>;

export type MagicLinkResult =
  | { ok: true; status: number; body: { success: true; recentlySent?: boolean } }
  | {
      ok: false;
      status: number;
      body: { success: false; error: string };
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
  }) => ResolveRedirectResult;

  // Auth
  getAuthUserFromBearer: (bearer: string) => Promise<{
    user: { id: string } | null;
    error: unknown;
  }>;

  // Invite path
  fetchInviteById: (inviteId: string) => Promise<{
    id: string;
    organization_id: string;
    email: string;
    status: string;
    expires_at: string | null;
    invited_by: string | null;
    role: string;
  } | null>;
  callerHasManageTeam: (args: { bearer: string; organizationId: string }) => Promise<boolean>;

  // Client portal path
  fetchClientAccessById: (accessId: string) => Promise<{
    id: string;
    project_id: string;
    organization_id: string;
    email: string;
    status: string;
    client_user_id: string | null;
  } | null>;
  callerHasClientAccessManagement: (args: {
    bearer: string;
    organizationId: string;
  }) => Promise<boolean>;

  // Fail-closed exact Auth lookup. All contexts use this before link
  // generation so only a genuinely new invitee can reach type:"invite".
  lookupExistingAuthUser: (
    email: string,
  ) => Promise<{ id: string; emailConfirmed: boolean } | null>;

  // Atomic dedupe reservation includes context + exact target id. The
  // database serializes requests for the same key and inserts the original
  // pending log row before any one-time Auth token is generated.
  reserveSend: (args: {
    messageId: string;
    email: string;
    label: string;
    dedupeKey: string;
    metadata: Record<string, unknown>;
  }) => Promise<{ reserved: boolean; messageId: string }>;

  // generateLink is the sole auth-user creation boundary for a genuinely
  // new invite/client user (type:"invite"). Existing users and duplicate
  // creation races use type:"magiclink".
  generateMagicLink: (args: {
    email: string;
    redirectTo: string;
    kind: "invite" | "magiclink";
  }) => Promise<{
    hashedToken: string | null;
    userId: string | null;
    verificationType?: "invite" | "magiclink" | null;
    error?: { message?: string; code?: string } | null;
  }>;

  updateEmailSendLogStatus: (
    messageId: string,
    status: "sent",
    metadata: Record<string, unknown>,
  ) => Promise<void>;
  // Failure path updates the ORIGINAL pending row (matched by
  // messageId) to `failed`, folding error_message + error_code into
  // metadata so no second row is inserted.
  updateEmailSendLogFailed: (
    messageId: string,
    errorMessage: string,
    metadata: Record<string, unknown>,
  ) => Promise<void>;
  sendEmail: (payload: SendLovableEmailPayload) => Promise<void>;
  logInfo?: (msg: string, meta?: Record<string, unknown>) => void;
  logError?: (msg: string, meta?: Record<string, unknown>) => void;
};

const INVITE_CONTEXTS = new Set(["company_invite", "portfolio_invite"] as const);
const REVOKED_STATUSES = new Set(["revoked", "disabled", "expired"]);

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

type Audit = Record<string, unknown>;

const GENERIC_PROVISIONING_ERROR = "Could not send magic link.";
const SAFE_ERROR_CODE = /^[a-z0-9_.-]{1,64}$/i;

function operationalErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code = (error as Error & { code?: string }).code;
  return code && SAFE_ERROR_CODE.test(code) ? code : undefined;
}

export async function handleMagicLinkRequest(args: {
  requestUrl: string;
  body: unknown;
  authorizationHeader: string | null;
  deps: MagicLinkDeps;
}): Promise<MagicLinkResult> {
  const { requestUrl, body, authorizationHeader, deps } = args;

  const parsed = magicLinkInput.safeParse(body);
  if (!parsed.success) {
    const idIssue = parsed.error.issues.find(
      (i) => i.path[0] === "inviteId" || i.path[0] === "clientAccessId",
    );
    if (idIssue) return jsonError(idIssue.message, 400);
    return jsonError("Enter a valid email address.");
  }

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
  let redirectTo = resolved.redirectTo;

  const contextValue = parsed.data.context ?? "login";
  const isInviteContext = INVITE_CONTEXTS.has(
    contextValue as "company_invite" | "portfolio_invite",
  );
  const isClientPortal = contextValue === "client_portal";

  let audit: Audit = { context: contextValue, redirect_to: redirectTo, provider: "lovable-email" };
  let bearer: string | null = null;
  let dedupeKey = `login:${email}`;
  let linkKind: "invite" | "magiclink" = "magiclink";
  let clientAccessStatus: string | null = null;
  let clientAccessUserId: string | null = null;

  // ---------------- Invite gate ----------------
  if (isInviteContext) {
    if (!parsed.data.inviteId) {
      return jsonError("This invite request is missing its invite id.", 400);
    }
    if (!authorizationHeader?.startsWith("Bearer ")) {
      return jsonError("You must be signed in to send an invite.", 401);
    }
    bearer = authorizationHeader.slice("Bearer ".length).trim();
    if (!bearer) return jsonError("You must be signed in to send an invite.", 401);

    let callerId: string;
    try {
      const authResult = await deps.getAuthUserFromBearer(bearer);
      if (authResult.error || !authResult.user) {
        return jsonError("Your session expired. Sign in again.", 401);
      }
      callerId = authResult.user.id;
    } catch {
      deps.logError?.("magic-link auth verify failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Your session could not be verified.", 401);
    }

    let inviteRow: Awaited<ReturnType<typeof deps.fetchInviteById>>;
    try {
      inviteRow = await deps.fetchInviteById(parsed.data.inviteId);
    } catch {
      deps.logError?.("magic-link invite lookup failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Invite validation failed.", 500);
    }
    if (!inviteRow) return jsonError("That invitation could not be found.", 409);
    if (normalizeEmail(inviteRow.email) !== email) {
      return jsonError("This invite belongs to a different email address.", 409);
    }
    if (inviteRow.status === "accepted") {
      return jsonError("This invitation has already been accepted.", 409);
    }
    if (inviteRow.status === "revoked") {
      return jsonError("This invitation has been revoked.", 409);
    }
    if (inviteRow.status !== "pending") {
      return jsonError("This invitation is no longer pending.", 409);
    }
    const expiresAt = inviteRow.expires_at ? Date.parse(inviteRow.expires_at) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= deps.now()) {
      return jsonError("This invitation has expired.", 409);
    }

    if (inviteRow.invited_by !== callerId) {
      return jsonError(
        "Only the original inviter can resend this invitation. A current company manager can reissue it.",
        403,
      );
    }
    let hasManageTeam: boolean;
    try {
      hasManageTeam = await deps.callerHasManageTeam({
        bearer,
        organizationId: inviteRow.organization_id,
      });
    } catch {
      deps.logError?.("magic-link capability lookup failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Invite authorization check failed.", 500);
    }
    if (!hasManageTeam) {
      return jsonError("You no longer have permission to send this invitation.", 403);
    }

    audit = {
      ...audit,
      invite_id: inviteRow.id,
      organization_id: inviteRow.organization_id,
      inviter_id: inviteRow.invited_by,
    };
    dedupeKey = `${contextValue}:${inviteRow.id}:${email}`;
  }

  // ---------------- Client portal gate ----------------
  if (isClientPortal) {
    if (!parsed.data.clientAccessId) {
      return jsonError("This client portal request is missing its access id.", 400);
    }
    if (!authorizationHeader?.startsWith("Bearer ")) {
      return jsonError("You must be signed in to send a client portal link.", 401);
    }
    bearer = authorizationHeader.slice("Bearer ".length).trim();
    if (!bearer) {
      return jsonError("You must be signed in to send a client portal link.", 401);
    }

    try {
      const authResult = await deps.getAuthUserFromBearer(bearer);
      if (authResult.error || !authResult.user) {
        return jsonError("Your session expired. Sign in again.", 401);
      }
    } catch {
      deps.logError?.("magic-link auth verify failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Your session could not be verified.", 401);
    }

    let accessRow: Awaited<ReturnType<typeof deps.fetchClientAccessById>>;
    try {
      accessRow = await deps.fetchClientAccessById(parsed.data.clientAccessId);
    } catch {
      deps.logError?.("magic-link client access lookup failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Client access validation failed.", 500);
    }
    if (!accessRow) return jsonError("That client access could not be found.", 409);
    if (normalizeEmail(accessRow.email) !== email) {
      return jsonError("This client access belongs to a different email address.", 409);
    }
    if (
      REVOKED_STATUSES.has(accessRow.status) ||
      !["active", "pending"].includes(accessRow.status)
    ) {
      return jsonError("This client access is no longer active.", 409);
    }
    clientAccessStatus = accessRow.status;
    clientAccessUserId = accessRow.client_user_id;

    let hasClientMgmt: boolean;
    try {
      hasClientMgmt = await deps.callerHasClientAccessManagement({
        bearer,
        organizationId: accessRow.organization_id,
      });
    } catch {
      deps.logError?.("magic-link client capability lookup failed", {
        recipient_redacted: redactEmail(email),
      });
      return jsonError("Client access authorization check failed.", 500);
    }
    if (!hasClientMgmt) {
      return jsonError("You no longer have permission to send this client portal link.", 403);
    }

    audit = {
      ...audit,
      client_access_id: accessRow.id,
      project_id: accessRow.project_id,
      organization_id: accessRow.organization_id,
    };
    dedupeKey = `client_portal:${accessRow.id}:${email}`;
  }

  // ---------------- Exact Auth-user classification ----------------
  // MUST run BEFORE any generateLink/sendEmail/audit. Existing users
  // always receive type:"magiclink"; only a proven-absent invitee may
  // reach type:"invite". Public login remains enumeration-safe and
  // performs no side effects for an unknown email.
  let existingAuthUser: { id: string; emailConfirmed: boolean } | null;
  try {
    existingAuthUser = await deps.lookupExistingAuthUser(email);
    if (!existingAuthUser && !isInviteContext && !isClientPortal) {
      deps.logInfo?.("magic-link login for unknown email — generic OK, zero side effects", {
        recipient_redacted: redactEmail(email),
      });
      return ok({ success: true });
    }
    linkKind = existingAuthUser ? "magiclink" : "invite";
  } catch (error) {
    deps.logError?.("magic-link Auth user lookup failed", {
      recipient_redacted: redactEmail(email),
      context: contextValue,
      ...(operationalErrorCode(error) ? { code: operationalErrorCode(error) } : {}),
    });
    return jsonError(GENERIC_PROVISIONING_ERROR, 503);
  }

  // An already-bound client row may only issue a link for that exact Auth
  // identity. Pending rows with a pre-bound different identity also fail
  // before token generation rather than emailing a callback that must reject.
  if (
    isClientPortal &&
    ((clientAccessUserId !== null && clientAccessUserId !== existingAuthUser?.id) ||
      (clientAccessStatus === "active" && !existingAuthUser))
  ) {
    return jsonError("This client access is no longer available.", 409);
  }

  let messageId = deps.randomUUID();
  const label = "auth-magic-link";
  const idempotencyWindow = Math.floor(deps.now() / RECENT_SEND_WINDOW_MS);
  const idempotencyKey = `auth-magic-link:${dedupeKey}:${idempotencyWindow}`;

  // ---------------- Provisioning + send (post-authorization) ----------------
  let reservationRecorded = false;
  let failureRowRecorded = false;
  let failureMessage = "Magic link generation failed.";
  try {
    // Carry the exact clicked invite/client-access id through the app-owned
    // callback URL before reserving the send. No caller-supplied callback
    // pathname/query survives resolveMagicLinkRedirect.
    const inviteId =
      parsed.data.context === "company_invite" || parsed.data.context === "portfolio_invite"
        ? parsed.data.inviteId
        : null;
    if (inviteId || parsed.data.context === "client_portal") {
      const url = new URL(redirectTo);
      if (inviteId) url.searchParams.set("invite_id", inviteId);
      if (parsed.data.context === "client_portal" && parsed.data.clientAccessId) {
        url.searchParams.set("client_access_id", parsed.data.clientAccessId);
      }
      redirectTo = url.toString();
    }

    const reservation = await deps.reserveSend({
      messageId,
      email,
      label,
      dedupeKey,
      metadata: audit,
    });
    if (!reservation.reserved) return ok({ success: true, recentlySent: true });
    reservationRecorded = true;
    messageId = reservation.messageId;

    let issuedLinkKind = linkKind;
    let linkResult = await deps.generateMagicLink({
      email,
      redirectTo,
      kind: issuedLinkKind,
    });

    // Between the exact lookup and type:"invite", another request can
    // create the same Auth user. Supabase returns a documented duplicate
    // code without a usable invite token in that race. Retry exactly once
    // as type:"magiclink"; never swallow the error or send an unusable URL.
    const firstErrorCode = linkResult.error?.code ?? "";
    if (linkKind === "invite" && DUPLICATE_USER_CODES.has(firstErrorCode)) {
      deps.logInfo?.("magic-link duplicate-user race; retrying as existing user", {
        recipient_redacted: redactEmail(email),
        context: contextValue,
      });
      linkResult = await deps.generateMagicLink({
        email,
        redirectTo,
        kind: "magiclink",
      });
      issuedLinkKind = "magiclink";
    }

    if (linkResult.error) {
      const code =
        linkResult.error.code && SAFE_ERROR_CODE.test(linkResult.error.code)
          ? linkResult.error.code
          : undefined;
      const err = new Error("Authentication link generation failed.");
      (err as Error & { code?: string }).code = code;
      throw err;
    }
    if (!linkResult.hashedToken || !linkResult.userId) {
      const err = new Error("Provider did not return a usable magic-link token or user id");
      (err as Error & { code?: string }).code = "provider_incomplete";
      throw err;
    }

    const confirmationLink = buildMagicLinkConfirmationUrl(
      redirectTo,
      linkResult.hashedToken,
      linkResult.verificationType ?? issuedLinkKind,
    );

    try {
      failureMessage = "Email delivery failed.";
      await deps.sendEmail({
        to: email,
        from: `${SITE_NAME} <noreply@${FROM_DOMAIN}>`,
        sender_domain: SENDER_DOMAIN,
        subject: isInviteContext
          ? "You've been invited to Overwatch"
          : isClientPortal
            ? "Open your Overwatch client portal"
            : "Sign in to Overwatch",
        html: loginHtml(confirmationLink, contextValue),
        text: loginText(confirmationLink, contextValue),
        purpose: "transactional",
        label,
        idempotency_key: idempotencyKey,
        message_id: messageId,
        unsubscribe_token: deps.randomUUID(),
      });
    } catch (sendErr) {
      // Update the atomically reserved ORIGINAL pending row to failed; never
      // persist or log a raw provider diagnostic.
      const sendCode = operationalErrorCode(sendErr);
      const failureMeta: Record<string, unknown> = {
        ...audit,
        dedupe_key: dedupeKey,
        auth_user_id: linkResult.userId,
      };
      if (sendCode) failureMeta.error_code = sendCode;
      try {
        await deps.updateEmailSendLogFailed(messageId, failureMessage, failureMeta);
        failureRowRecorded = true;
      } catch {
        deps.logError?.("magic-link failure log update failed", {
          recipient_redacted: redactEmail(email),
        });
      }
      throw sendErr;
    }

    try {
      await deps.updateEmailSendLogStatus(messageId, "sent", {
        ...audit,
        dedupe_key: dedupeKey,
        auth_user_id: linkResult.userId,
      });
    } catch {
      // Delivery already succeeded. Keep the reserved row pending (which
      // suppresses an immediate duplicate) and return success rather than
      // telling the user to click again and issuing a competing token.
      deps.logError?.("magic-link sent-status update failed", {
        recipient_redacted: redactEmail(email),
      });
    }

    deps.logInfo?.("Overwatch magic link sent", {
      recipient_redacted: redactEmail(email),
      context: contextValue,
      ...(audit.invite_id ? { invite_id: audit.invite_id as string } : {}),
      ...(audit.client_access_id ? { client_access_id: audit.client_access_id as string } : {}),
    });
    return ok({ success: true });
  } catch (error) {
    const code = operationalErrorCode(error);
    deps.logError?.("Overwatch magic link failed", {
      recipient_redacted: redactEmail(email),
      ...(code ? { code } : {}),
      ...(audit.invite_id ? { invite_id: audit.invite_id as string } : {}),
      ...(audit.client_access_id ? { client_access_id: audit.client_access_id as string } : {}),
    });
    // The reservation is the only audit-row creation path. If generation or
    // callback-link construction failed after reservation, mark that exact
    // row failed. A reservation failure creates no ad hoc row that could race.
    if (reservationRecorded && !failureRowRecorded) {
      try {
        const failureMeta: Record<string, unknown> = { ...audit, dedupe_key: dedupeKey };
        if (code) failureMeta.error_code = code;
        await deps.updateEmailSendLogFailed(messageId, failureMessage, failureMeta);
      } catch {
        // Never mask the original failure.
      }
    }
    // Never leak provider message/code to the client — the audit
    // trail carries the provider detail; the response is generic.
    return jsonError(GENERIC_PROVISIONING_ERROR, 500);
  }
}
