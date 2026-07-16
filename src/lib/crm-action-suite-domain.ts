import { z } from "zod";

export const CRM_ASSIST_CREDITS = 1;

export const CRM_ONBOARDING_TASK_TEMPLATES = [
  {
    stepOrder: 1,
    category: "contract",
    title: "Confirm the signed contract and commercial terms",
    description:
      "Store the executed agreement, verify contract value, allowances, exclusions, payment terms, and the notice-to-proceed requirements.",
    dueOffsetDays: 0,
  },
  {
    stepOrder: 2,
    category: "client",
    title: "Confirm the client communication map",
    description:
      "Identify the decision maker, day-to-day contact, approval authority, meeting cadence, and preferred communication channels.",
    dueOffsetDays: 1,
  },
  {
    stepOrder: 3,
    category: "handoff",
    title: "Run the estimating-to-operations handoff",
    description:
      "Review estimate assumptions, clarifications, buyout risks, alternates, commitments made during sales, and unresolved questions with the delivery team.",
    dueOffsetDays: 1,
  },
  {
    stepOrder: 4,
    category: "scope",
    title: "Lock the scope baseline and responsibility matrix",
    description:
      "Confirm inclusions, exclusions, owner-furnished items, design responsibility, permit responsibility, and the change-management path.",
    dueOffsetDays: 2,
  },
  {
    stepOrder: 5,
    category: "schedule",
    title: "Prepare the milestone and procurement plan",
    description:
      "Set the target start, substantial completion, long-lead releases, decision deadlines, and the first look-ahead milestones.",
    dueOffsetDays: 3,
  },
  {
    stepOrder: 6,
    category: "billing",
    title: "Set up billing and cost controls",
    description:
      "Confirm schedule of values, billing contact, submission date, retainage, cost-code structure, budget ownership, and initial commitments.",
    dueOffsetDays: 3,
  },
  {
    stepOrder: 7,
    category: "risk",
    title: "Open the project risk register",
    description:
      "Capture known scope, design, procurement, staffing, access, cash-flow, and client-decision risks with owners and next actions.",
    dueOffsetDays: 4,
  },
  {
    stepOrder: 8,
    category: "kickoff",
    title: "Prepare and schedule the client kickoff",
    description:
      "Build the kickoff agenda, confirm attendees, collect unresolved decisions, and send the client a clear first-30-days roadmap.",
    dueOffsetDays: 5,
  },
] as const;

export function datePlusDays(baseDate: string | null | undefined, days: number) {
  const parsed =
    baseDate && /^\d{4}-\d{2}-\d{2}$/.test(baseDate)
      ? new Date(`${baseDate}T12:00:00Z`)
      : new Date();
  parsed.setUTCHours(12, 0, 0, 0);
  parsed.setUTCDate(parsed.getUTCDate() + Math.max(0, Math.trunc(days)));
  return parsed.toISOString().slice(0, 10);
}

const followupDraftSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(12_000),
  value_angle: z.string().trim().min(1).max(1_000),
  resource_idea: z.string().trim().min(1).max(1_000),
});

export type CrmAiFollowupDraft = z.infer<typeof followupDraftSchema>;

const meetingBriefSchema = z.object({
  executive_summary: z.string().trim().min(1).max(3_000),
  relationship_context: z.array(z.string().trim().min(1).max(700)).max(8),
  desired_outcomes: z.array(z.string().trim().min(1).max(700)).min(1).max(8),
  questions_to_ask: z.array(z.string().trim().min(1).max(700)).min(1).max(12),
  risks_to_surface: z.array(z.string().trim().min(1).max(700)).max(10),
  value_to_bring: z.array(z.string().trim().min(1).max(700)).max(8),
  next_step_options: z.array(z.string().trim().min(1).max(700)).min(1).max(8),
});

export type CrmMeetingBriefData = z.infer<typeof meetingBriefSchema>;

function extractJson(raw: string) {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("AI did not return a usable CRM draft.");
  return JSON.parse(trimmed.slice(first, last + 1)) as unknown;
}

export function parseCrmAiFollowupDraft(raw: string) {
  return followupDraftSchema.parse(extractJson(raw));
}

export function parseCrmMeetingBrief(raw: string) {
  return meetingBriefSchema.parse(extractJson(raw));
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function followupEmailHtml(body: string) {
  const paragraphs = body
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`,
    )
    .join("");
  return `<!doctype html><html><body style="margin:0;background:#faf9f5;font-family:Arial,sans-serif;color:#1f1e1b"><div style="max-width:640px;margin:0 auto;padding:32px 20px"><div style="background:#fff;border:1px solid #e4e1d6;border-radius:14px;padding:30px;font-size:15px;line-height:1.65">${paragraphs}</div><p style="font-size:11px;line-height:1.5;color:#76736b;margin:16px 4px 0">Sent with OverWatch CRM on behalf of the sender above.</p></div></body></html>`;
}
