import type { EmailOtpType } from "@supabase/supabase-js";
import { safeInternalPath } from "@/lib/safe-internal-path";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

const AUTHENTICATED_NEXT_ROOTS = [
  "/admin",
  "/billing",
  "/client/projects",
  "/cost-library",
  "/estimate-masters",
  "/estimates",
  "/home-preview",
  "/projects",
  "/reports",
  "/support",
  "/team",
] as const;

export function safeAuthNext(url: URL) {
  const next = safeInternalPath(url.searchParams.get("next") ?? "/");
  if (next === "/") return next;

  let pathname: string;
  try {
    pathname = new URL(next, "https://overwatch.invalid").pathname;
  } catch {
    return "/";
  }

  return AUTHENTICATED_NEXT_ROOTS.some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  )
    ? next
    : "/";
}

export function emailOtpTypeFromUrl(type: string | null): EmailOtpType {
  if (type && EMAIL_OTP_TYPES.has(type as EmailOtpType)) return type as EmailOtpType;
  return "email";
}

export function requiresExplicitMagicLinkConfirmation(url: URL) {
  return Boolean(url.searchParams.get("token_hash") && url.searchParams.get("confirm") === "1");
}

export function buildMagicLinkConfirmationUrl(
  redirectTo: string,
  tokenHash: string,
  type: Extract<EmailOtpType, "email" | "invite" | "magiclink"> = "email",
) {
  if (!tokenHash.trim()) throw new Error("Supabase did not return a magic-link token hash.");

  const url = new URL(redirectTo);
  url.hash = "";
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", type);
  // Email security scanners may open links. The callback renders a button for
  // this marker and consumes the one-time token only after a human click.
  url.searchParams.set("confirm", "1");
  return url.toString();
}

/**
 * Params that carry auth credentials or auth error details in the callback URL.
 * Any of these MUST be removed from the visible address bar / browser history
 * before we render UI or perform a network exchange.
 */
const CALLBACK_CREDENTIAL_PARAMS = [
  "token_hash",
  "type",
  "confirm",
  "code",
  "error",
  "error_code",
  "error_description",
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "expires_in",
  "expires_at",
  "token_type",
] as const;

/**
 * Produce a scrubbed callback URL (path + only a normalized `next` param, no
 * hash) suitable for `history.replaceState`. The original URL is never mutated.
 */
export function scrubbedCallbackUrl(originalHref: string): string {
  const original = new URL(originalHref);
  const scrubbed = new URL(original.pathname, original.origin);
  const next = safeAuthNext(original);
  if (next && next !== "/") scrubbed.searchParams.set("next", next);
  // pathname + search only; drop the hash entirely.
  return `${scrubbed.pathname}${scrubbed.search}`;
}

/** True iff the URL still carries any auth credential/error param or hash. */
export function callbackUrlHasSecrets(url: URL): boolean {
  if (url.hash && url.hash !== "#") return true;
  for (const param of CALLBACK_CREDENTIAL_PARAMS) {
    if (url.searchParams.has(param)) return true;
  }
  return false;
}
