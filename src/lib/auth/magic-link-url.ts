import type { EmailOtpType } from "@supabase/supabase-js";

const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

export function safeAuthNext(url: URL) {
  const next = url.searchParams.get("next") ?? "/";
  if (!next.startsWith("/") || next.startsWith("//")) return "/";
  return next;
}

export function emailOtpTypeFromUrl(type: string | null): EmailOtpType {
  if (type && EMAIL_OTP_TYPES.has(type as EmailOtpType)) return type as EmailOtpType;
  return "email";
}

export function requiresExplicitMagicLinkConfirmation(url: URL) {
  return Boolean(url.searchParams.get("token_hash") && url.searchParams.get("confirm") === "1");
}

export function buildMagicLinkConfirmationUrl(redirectTo: string, tokenHash: string) {
  if (!tokenHash.trim()) throw new Error("Supabase did not return a magic-link token hash.");

  const url = new URL(redirectTo);
  url.hash = "";
  url.searchParams.set("token_hash", tokenHash);
  url.searchParams.set("type", "email");
  // Email security scanners may open links. The callback renders a button for
  // this marker and consumes the one-time token only after a human click.
  url.searchParams.set("confirm", "1");
  return url.toString();
}
