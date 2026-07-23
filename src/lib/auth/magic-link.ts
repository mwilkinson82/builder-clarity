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
 * Non-provisioning contexts. Never accept an inviteId and never require a
 * bearer token; the API route does not run any admin.createUser path for
 * these.
 */
export type NonInviteMagicLinkInput = BaseMagicLinkInput & {
  context?: "login" | "client_portal";
};

/**
 * P0 invite containment: company_invite and portfolio_invite are the only
 * contexts that can provision an auth user, and both are gated by the API
 * route on an exact organization_invites row that the authenticated caller
 * is authorized to send. The discriminated union makes the contract
 * unforgeable at the type level.
 */
export type InviteMagicLinkInput = BaseMagicLinkInput & {
  context: "company_invite" | "portfolio_invite";
  inviteId: string;
};

export type SendMagicLinkInput = NonInviteMagicLinkInput | InviteMagicLinkInput;

type MagicLinkResponse = {
  success?: boolean;
  error?: string;
};

const INVITE_CONTEXTS: ReadonlySet<MagicLinkContext> = new Set([
  "company_invite",
  "portfolio_invite",
]);

function isInviteInput(input: SendMagicLinkInput): input is InviteMagicLinkInput {
  return input.context ? INVITE_CONTEXTS.has(input.context) : false;
}

export async function sendOverwatchMagicLink(input: SendMagicLinkInput) {
  const invite = isInviteInput(input);

  // Runtime guard: the discriminated union already enforces this at the type
  // layer, but a runtime check keeps JS callers and any dynamic construction
  // honest so an invite context can never reach the server without an id.
  if (invite && !input.inviteId) {
    throw new Error("An invite id is required to send an invite magic link.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (invite) {
    // The API route re-verifies the token against the identity provider and
    // proves the caller is authorized for the specific invite before it does
    // anything else. Without a bearer here, the server returns 401 and no
    // account is provisioned or emailed.
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) {
      throw new Error("You must be signed in to send an invite.");
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
