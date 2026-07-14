export interface SelectionDecisionEmailInput {
  decision: "approved" | "revision_requested";
  projectName: string;
  jobNumber: string;
  selectionNumber: string;
  selectionTitle: string;
  optionTitle: string;
  clientDisplay: string;
  notes: string;
  needOnSiteDate: string | null;
  selectionsUrl: string;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function selectionDecisionSubject(input: SelectionDecisionEmailInput) {
  return input.decision === "approved"
    ? `Selection approved: ${input.selectionTitle}`
    : `Selection revision requested: ${input.selectionTitle}`;
}

export function selectionDecisionText(input: SelectionDecisionEmailInput) {
  const decisionLine =
    input.decision === "approved"
      ? `${input.clientDisplay} approved ${input.selectionNumber} · ${input.selectionTitle}.`
      : `${input.clientDisplay} requested a revision to ${input.selectionNumber} · ${input.selectionTitle}.`;
  const optionLine =
    input.decision === "approved" && input.optionTitle
      ? `Approved option: ${input.optionTitle}\n`
      : "";
  const notesLine = input.notes ? `Comments: ${input.notes}\n` : "";

  return `Overwatch Selections\n\n${decisionLine}\n\nProject: ${input.projectName}${input.jobNumber ? ` (${input.jobNumber})` : ""}\n${optionLine}Needed on site: ${formatDate(input.needOnSiteDate)}\n${notesLine}\nOpen Selections: ${input.selectionsUrl}`;
}

export function selectionDecisionHtml(input: SelectionDecisionEmailInput) {
  const approved = input.decision === "approved";
  const heading = approved ? "A selection was approved" : "A selection needs revision";
  const decisionLine = approved
    ? `${input.clientDisplay} approved this selection in the client portal.`
    : `${input.clientDisplay} requested a revision in the client portal.`;
  const row = (label: string, value: string, strong = false) => `
    <div style="border-bottom:1px solid #eee7df;padding:11px 0;">
      <p style="font-size:10px;letter-spacing:.14em;color:#7d7168;margin:0 0 4px;text-transform:uppercase;font-weight:700;">${escapeHtml(label)}</p>
      <p style="font-size:${strong ? "17" : "14"}px;color:#1e1713;margin:0;font-weight:${strong ? "700" : "400"};">${escapeHtml(value)}</p>
    </div>`;

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#f8f5ee;font-family:Arial,sans-serif;color:#1e1713;">
    <div style="max-width:600px;margin:0 auto;padding:34px 28px;">
      <p style="font-size:11px;letter-spacing:.18em;color:#7d7168;margin:0 0 12px;font-weight:700;">OVERWATCH SELECTIONS</p>
      <h1 style="font-family:Georgia,serif;font-size:30px;line-height:1.15;margin:0 0 14px;font-weight:400;">${heading}</h1>
      <p style="font-size:14px;line-height:1.6;color:#5e554e;margin:0 0 18px;">${escapeHtml(decisionLine)}</p>
      <div style="background:#fff;border:1px solid #e5ddd3;border-radius:8px;padding:8px 18px;margin:18px 0;">
        ${row("Project", input.jobNumber ? `${input.projectName} · ${input.jobNumber}` : input.projectName)}
        ${row("Selection", `${input.selectionNumber} · ${input.selectionTitle}`, true)}
        ${approved && input.optionTitle ? row("Approved option", input.optionTitle, true) : ""}
        ${row("Needed on site", formatDate(input.needOnSiteDate))}
        ${input.notes ? row("Client comments", input.notes) : ""}
      </div>
      <a href="${escapeHtml(input.selectionsUrl)}" style="display:inline-block;background:#1e1713;border-radius:7px;color:#fff;font-size:14px;font-weight:700;padding:12px 18px;text-decoration:none;">Open Selections</a>
      <p style="font-size:12px;line-height:1.6;color:#7d7168;margin-top:24px;">The approval record, selected option, package version, and client comments are stored in Overwatch.</p>
    </div>
  </body>
</html>`;
}
