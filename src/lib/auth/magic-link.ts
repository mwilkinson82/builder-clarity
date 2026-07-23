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
 * Non-provisioning contexts. `inviteId?: never` makes the discriminated
 * union unforgeable: TypeScript rejects any object literal that carries
 * an `inviteId` alongside a non-invite (or omitted) context, and the
 * server-side Zod schema mirrors the check at runtime so JSON callers
 * cannot smuggle one in either.
 */
export type NonInviteMagicLinkInput = BaseMagicLinkInput & {
  context?: "login" | "client_portal";
  inviteId?: never;
};

/**
 * P0 invite containment: company_invite and portfolio_invite are the
 * only contexts that can provision an auth user, and both are gated by
 * the API route on an exact organization_invites row that the
 * authenticated caller is authorized to send. Requires inviteId.
 */
export type InviteMagicLinkInput = BaseMagicLinkInput & {
  context: "company_invite" | "portfolio_invite";
  inviteId: string;
};

export type SendMagicLinkInput = NonInviteMagicLinkInput | InviteMagicLinkInput;

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

export async function sendOverwatchMagicLink(input: SendMagicLinkInput) {
  const invite = isInviteInput(input);

  // Runtime guard alongside the type-level union: an invite context
  // without an id can never reach the server.
  if (invite && !input.inviteId) {
    throw new Error("An invite id is required to send an invite magic link.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (invite) {
    // The API route re-verifies the token against the identity provider
    // and proves the caller is authorized for the specific invite
    // before it does anything else. Without a bearer here, the server
    // returns 401 and no account is provisioned or emailed.
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
