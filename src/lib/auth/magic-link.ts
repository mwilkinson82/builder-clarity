import { supabase } from "@/integrations/supabase/client";

export type MagicLinkContext =
  | "login"
  | "company_invite"
  | "portfolio_invite"
  | "client_portal";

type BaseMagicLinkInput = {
  email: string;
  next?: string;
  redirectTo?: string;
};

/**
 * Public login. Never provisions an unknown auth user: the server
 * performs a service-role existing-user lookup first and silently
 * returns the same generic success response for an unknown email.
 * No inviteId, no clientAccessId.
 */
export type LoginMagicLinkInput = BaseMagicLinkInput & {
  context?: "login";
  inviteId?: never;
  clientAccessId?: never;
};

/**
 * Company / portfolio invite. REQUIRES the exact organization_invites
 * row id. The server re-fetches the invite under the caller's Bearer,
 * enforces (invited_by === caller) AND (caller currently holds
 * company.manage_team on the invite's org) before any auth-user
 * creation, link generation, log insert, or email send.
 */
export type InviteMagicLinkInput = BaseMagicLinkInput & {
  context: "company_invite" | "portfolio_invite";
  inviteId: string;
  clientAccessId?: never;
};

/**
 * Client portal. REQUIRES the exact project_client_access row id. The
 * server re-fetches the access row under the caller's Bearer, enforces
 * email match + status not-revoked + caller currently holds
 * client_portal.manage on the access row's project organization
 * before any auth-user creation, link generation, log insert, or email
 * send.
 */
export type ClientPortalMagicLinkInput = BaseMagicLinkInput & {
  context: "client_portal";
  clientAccessId: string;
  inviteId?: never;
};

export type SendMagicLinkInput =
  | LoginMagicLinkInput
  | InviteMagicLinkInput
  | ClientPortalMagicLinkInput;

type MagicLinkResponse = {
  success?: boolean;
  error?: string;
  code?: string;
};

const INVITE_CONTEXTS: ReadonlySet<MagicLinkContext> = new Set([
  "company_invite",
  "portfolio_invite",
]);

function isInviteInput(input: SendMagicLinkInput): input is InviteMagicLinkInput {
  return input.context ? INVITE_CONTEXTS.has(input.context) : false;
}

function isClientPortalInput(
  input: SendMagicLinkInput,
): input is ClientPortalMagicLinkInput {
  return input.context === "client_portal";
}

export async function sendOverwatchMagicLink(input: SendMagicLinkInput) {
  const invite = isInviteInput(input);
  const clientPortal = isClientPortalInput(input);

  if (invite && !input.inviteId) {
    throw new Error("An invite id is required to send an invite magic link.");
  }
  if (clientPortal && !input.clientAccessId) {
    throw new Error("A client access id is required to send a client portal magic link.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  // Invite AND client_portal both require a signed-in caller so the
  // server can re-authorize the exact row against the caller identity.
  if (invite || clientPortal) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      throw new Error(
        clientPortal
          ? "You must be signed in to send a client portal link."
          : "You must be signed in to send an invite.",
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as MagicLinkResponse;

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || "Could not send magic link.");
  }

  return payload;
}
