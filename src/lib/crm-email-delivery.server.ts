import { sendLovableEmail } from "@lovable.dev/email-js";
import { resolveCrmEmailSenderConfig, type CrmEmailEnvironment } from "./crm-email-policy";

type DeliverCrmEmailInput = {
  to: string;
  senderName: string;
  replyTo: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey: string;
  messageId: string;
};

type ResendResponse = {
  id?: string;
  message?: string;
  name?: string;
};

export async function deliverCrmEmail(
  input: DeliverCrmEmailInput,
  env: CrmEmailEnvironment = process.env,
) {
  const config = resolveCrmEmailSenderConfig(env);
  const from = `${input.senderName} via OverWatch <${config.fromAddress}>`;
  if (config.provider === "resend") {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        to: [input.to],
        reply_to: input.replyTo,
        subject: input.subject,
        html: input.html,
        text: input.text,
      }),
    });
    const body = (await response.json().catch(() => ({}))) as ResendResponse;
    if (!response.ok || !body.id) {
      throw new Error(
        body.message || body.name || `Resend rejected the email (${response.status}).`,
      );
    }
    return { provider: "resend" as const, messageId: body.id };
  }

  if (!env.LOVABLE_API_KEY) throw new Error("Email delivery is not configured.");
  const response = await sendLovableEmail(
    {
      to: input.to,
      from,
      sender_domain: config.senderDomain,
      reply_to: input.replyTo,
      subject: input.subject,
      html: input.html,
      text: input.text,
      purpose: "transactional",
      label: "crm-followup",
      idempotency_key: input.idempotencyKey,
      message_id: input.messageId,
      unsubscribe_token: crypto.randomUUID(),
      test_mode: false,
    },
    { apiKey: env.LOVABLE_API_KEY, sendUrl: env.LOVABLE_SEND_URL },
  );
  if (!response.success) throw new Error("The email could not be sent. Try again.");
  return {
    provider: "lovable_email" as const,
    messageId: response.message_id || input.messageId,
  };
}
