const DEFAULT_FROM_ADDRESS = "noreply@overwatch.alpcontractorcircle.com";
const DEFAULT_SENDER_DOMAIN = "notify.overwatch.alpcontractorcircle.com";
const DEMO_EMAIL_SUFFIX = "@demo.overwatch.example";

export type CrmEmailProvider = "resend" | "lovable_email" | "demo";

export type CrmEmailEnvironment = {
  RESEND_API_KEY?: string;
  LOVABLE_API_KEY?: string;
  LOVABLE_SEND_URL?: string;
  CRM_EMAIL_FROM_ADDRESS?: string;
  CRM_EMAIL_SENDER_DOMAIN?: string;
};

export function isCrmDemoRecipientEmail(value: string) {
  return value.trim().toLowerCase().endsWith(DEMO_EMAIL_SUFFIX);
}

export function shouldSimulateCrmEmail(input: { recipient: string; testMode?: boolean }) {
  return Boolean(input.testMode) || isCrmDemoRecipientEmail(input.recipient);
}

export function resolveCrmEmailSenderConfig(env: CrmEmailEnvironment) {
  const fromAddress = (env.CRM_EMAIL_FROM_ADDRESS || DEFAULT_FROM_ADDRESS).trim().toLowerCase();
  const senderDomain = (env.CRM_EMAIL_SENDER_DOMAIN || DEFAULT_SENDER_DOMAIN).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromAddress)) {
    throw new Error("CRM_EMAIL_FROM_ADDRESS must be a complete email address.");
  }
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(senderDomain)) {
    throw new Error("CRM_EMAIL_SENDER_DOMAIN must be a verified domain without a protocol.");
  }
  return {
    provider: env.RESEND_API_KEY ? ("resend" as const) : ("lovable_email" as const),
    fromAddress,
    senderDomain,
  };
}

export function crmEmailActionLabel(recipient: string) {
  return isCrmDemoRecipientEmail(recipient) ? "Run demo send" : "Send from OverWatch";
}
