import { supabase } from "@/integrations/supabase/client";

export type MagicLinkContext =
  | "login"
  | "company_invite"
  | "portfolio_invite"
  | "client_portal";

export type SendMagicLinkInput = {
  email: string;
  next?: string;
  redirectTo?: string;
  context?: MagicLinkContext;
  /**
   * P0 invite containment: company_invite and portfolio_invite MUST supply
   * the id of the organization_invites row that was just created by
   * createTeamInvite. The API route rejects the request if this is missing
   * or does not match a pending, unexpired invite for the same email that
   * the authenticated caller is authorized to send.
   *
   * login and client_portal do NOT provision accounts and do not require it.
   */
  inviteId?: string;
};

type MagicLinkResponse = {
  success?: boolean;
  error?: string;
};

const INVITE_CONTEXTS: ReadonlySet<MagicLinkContext> = new Set([
  "company_invite",
  "portfolio_invite",
]);

export async function sendOverwatchMagicLink(input: SendMagicLinkInput) {
  const isInvite = input.context ? INVITE_CONTEXTS.has(input.context) : false;

  if (isInvite && !input.inviteId) {
    // Fail loud client-side rather than firing an ambiguous invite context at
    // the server. The server also rejects this case; this check keeps the
    // contract honest for every caller.
    throw new Error("An invite id is required to send an invite magic link.");
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isInvite) {
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
