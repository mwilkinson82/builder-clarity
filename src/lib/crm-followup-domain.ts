export type FollowupChannel = "email" | "call" | "text" | "meeting" | "task";
export type FollowupTiming = "overdue" | "today" | "upcoming" | "unscheduled";

export type FollowupPlaybookStepTemplate = {
  stepOrder: number;
  dayOffset: number;
  channel: FollowupChannel;
  title: string;
  purpose: string;
  valueAngle: string;
  subjectTemplate: string;
  bodyTemplate: string;
};

export const DEFAULT_VALUE_FOLLOWUP_PLAYBOOK = {
  systemKey: "value_first_estimate_followup_v1",
  name: "Value-first estimate follow-up",
  description:
    "A four-touch Day 1, 3, 5, and 8 cadence that earns attention by being useful—not by asking whether the prospect has decided yet.",
  audience: "Prospects considering an estimate or preconstruction engagement",
  triggerStage: "estimating",
  steps: [
    {
      stepOrder: 1,
      dayOffset: 1,
      channel: "email",
      title: "Recap the conversation and remove friction",
      purpose: "Confirm what matters to the prospect and make the next step feel easy.",
      valueAngle:
        "Clarity: show that you heard their priorities and will keep the process organized.",
      subjectTemplate: "Next steps for {{opportunity_name}}",
      bodyTemplate:
        "Hi {{contact_first_name}},\n\nThank you again for the conversation about {{opportunity_name}}. I wrote down the priorities we discussed and wanted to make the next step easy. We will keep the process clear and share anything that helps you make a good decision.\n\nIs there anything you want us to address before we move forward?\n\nBest,\n{{owner_name}}",
    },
    {
      stepOrder: 2,
      dayOffset: 3,
      channel: "email",
      title: "Send a useful planning resource",
      purpose: "Add value with a checklist, article, guide, or PDF tied to the prospect's concern.",
      valueAngle: "Education: help them make a better decision even before they hire you.",
      subjectTemplate: "A useful resource for {{opportunity_name}}",
      bodyTemplate:
        "Hi {{contact_first_name}},\n\nI wanted to send something useful rather than simply ask whether you had made a decision. I selected a planning resource that should help as you think through {{opportunity_name}}.\n\nThe biggest value is knowing the questions to settle early, before they become expensive changes later. I am happy to walk through any part of it with you.\n\nBest,\n{{owner_name}}",
    },
    {
      stepOrder: 3,
      dayOffset: 5,
      channel: "email",
      title: "Share proof or a risk-reduction idea",
      purpose: "Use a case study, process explanation, or field lesson to demonstrate judgment.",
      valueAngle:
        "Confidence: make your expertise tangible without turning the message into a sales pitch.",
      subjectTemplate: "One way to reduce surprises on {{opportunity_name}}",
      bodyTemplate:
        "Hi {{contact_first_name}},\n\nOne thought that may help with {{opportunity_name}}: the strongest projects usually resolve scope, allowances, and decision responsibility before work accelerates. That is where many avoidable surprises begin.\n\nI have included a resource that explains how we approach that discipline. If it raises a question about your project, send it my way and I will give you a direct answer.\n\nBest,\n{{owner_name}}",
    },
    {
      stepOrder: 4,
      dayOffset: 8,
      channel: "email",
      title: "Create an easy next conversation",
      purpose: "Invite a useful conversation without manufacturing pressure.",
      valueAngle:
        "Movement: give the prospect a low-friction way to surface concerns or choose a next step.",
      subjectTemplate: "Worth a quick conversation about {{opportunity_name}}?",
      bodyTemplate:
        "Hi {{contact_first_name}},\n\nI wanted to close the loop on {{opportunity_name}} without crowding your inbox. If you are still evaluating the project, I would be glad to spend a few minutes answering questions or pressure-testing the next step with you.\n\nWould a quick conversation be useful, or is there a better time for me to reconnect?\n\nBest,\n{{owner_name}}",
    },
  ] satisfies FollowupPlaybookStepTemplate[],
} as const;

export type FollowupTemplateContext = {
  contactName?: string | null;
  opportunityName: string;
  clientName?: string | null;
  ownerName?: string | null;
};

export function contactFirstName(name: string | null | undefined) {
  const trimmed = (name ?? "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "there";
}

export function personalizeFollowupTemplate(template: string, context: FollowupTemplateContext) {
  const tokens: Record<string, string> = {
    contact_first_name: contactFirstName(context.contactName),
    opportunity_name: context.opportunityName.trim() || "your project",
    client_name: context.clientName?.trim() || "your team",
    owner_name: context.ownerName?.trim() || "Your project team",
  };
  return template.replace(/{{\s*([a-z_]+)\s*}}/gi, (_match, key: string) => tokens[key] ?? "");
}

export function followupDueDate(startDate: Date, dayOffset: number) {
  const due = new Date(startDate);
  due.setUTCHours(12, 0, 0, 0);
  due.setUTCDate(due.getUTCDate() + Math.max(0, Math.trunc(dayOffset)));
  return due.toISOString().slice(0, 10);
}

export function followupTiming(dueDate: string | null, now = new Date()): FollowupTiming {
  if (!dueDate || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return "unscheduled";
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  if (dueDate < today) return "overdue";
  if (dueDate === today) return "today";
  return "upcoming";
}

export function appendValueAssetToBody(body: string, title: string, url: string) {
  const cleanTitle = title.trim() || "Resource";
  const cleanUrl = url.trim();
  if (!cleanUrl) return body.trim();
  return `${body.trim()}\n\n${cleanTitle}: ${cleanUrl}`;
}
