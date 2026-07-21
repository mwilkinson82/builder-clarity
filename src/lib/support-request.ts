import { z } from "zod";

/**
 * Pure, dependency-light core for the in-app "Report an issue / feedback"
 * intake. Kept separate from the server function so the schema and the email
 * composition can be unit-tested without pulling in the auth middleware or the
 * outbound email client.
 */

export const REPORT_CATEGORIES = ["issue", "idea", "question"] as const;
export type SupportReportCategory = (typeof REPORT_CATEGORIES)[number];

export const REPORT_CATEGORY_LABEL: Record<SupportReportCategory, string> = {
  issue: "Something's broken",
  idea: "Idea or feedback",
  question: "A question",
};

export const supportRequestSchema = z.object({
  category: z.enum(REPORT_CATEGORIES).default("issue"),
  message: z
    .string()
    .trim()
    .min(1, "Add a short description so we can help.")
    .max(5000, "Keep it under 5,000 characters."),
  // Everything below is auto-captured context — never required, always bounded.
  routePath: z.string().max(600).default(""),
  organizationId: z.string().max(100).default(""),
  organizationName: z.string().max(200).default(""),
  appVersion: z.string().max(120).default(""),
  userAgent: z.string().max(600).default(""),
});

export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the internal support email from a validated request plus the reporter's
 * profile. Deterministic and side-effect free so it can be asserted directly.
 */
export function composeSupportEmail(
  input: SupportRequestInput,
  reporter: { name: string; email: string },
): { subject: string; html: string; text: string } {
  const categoryLabel = REPORT_CATEGORY_LABEL[input.category];
  const company = input.organizationName.trim();
  const subject = `OverWatch support · ${categoryLabel}${company ? ` · ${company}` : ""}`;

  const fromLine = `${reporter.name || "Unknown user"}${
    reporter.email ? ` <${reporter.email}>` : ""
  }`;

  const contextRows: Array<[string, string]> = [
    ["From", fromLine],
    ["Company", company || "—"],
    ["Company ID", input.organizationId || "—"],
    ["Page", input.routePath || "—"],
    ["App version", input.appVersion || "—"],
    ["Browser", input.userAgent || "—"],
  ];

  const rowsHtml = contextRows
    .map(
      ([key, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#76736b;white-space:nowrap;vertical-align:top">${escapeHtml(
          key,
        )}</td><td style="padding:4px 0;color:#1f1e1b">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const messageHtml = escapeHtml(input.message).replace(/\n/g, "<br/>");

  const html = `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:Arial,sans-serif;color:#1f1e1b"><div style="max-width:640px;margin:0 auto;padding:40px 20px"><div style="font-size:22px;font-weight:700;margin-bottom:28px">OverWatch <span style="color:#d97757">▪</span></div><div style="background:#fff;border:1px solid #e4e1d6;border-radius:14px;padding:28px"><div style="font-family:Georgia,serif;font-size:26px;line-height:1.15;margin-bottom:8px">${escapeHtml(
    categoryLabel,
  )}</div><table style="font-size:13px;line-height:1.5;border-collapse:collapse;margin:16px 0 20px">${rowsHtml}</table><div style="border-top:1px solid #e4e1d6;padding-top:16px;font-size:15px;line-height:1.65;color:#1f1e1b">${messageHtml}</div></div><p style="font-size:12px;line-height:1.5;color:#76736b;margin-top:18px">Sent from the in-app Help &amp; support form. Reply to reach the reporter directly.</p></div></body></html>`;

  const text = [
    `OverWatch support — ${categoryLabel}`,
    "",
    ...contextRows.map(([key, value]) => `${key}: ${value}`),
    "",
    "Message:",
    input.message,
  ].join("\n");

  return { subject, html, text };
}
