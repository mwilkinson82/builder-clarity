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
};

type MagicLinkResponse = {
  success?: boolean;
  error?: string;
};

export async function sendOverwatchMagicLink(input: SendMagicLinkInput) {
  const response = await fetch("/api/auth/magic-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json().catch(() => ({}))) as MagicLinkResponse;

  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || "Could not send magic link.");
  }

  return payload;
}
