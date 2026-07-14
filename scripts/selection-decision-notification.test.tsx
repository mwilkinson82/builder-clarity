import { describe, expect, it } from "vitest";
import {
  selectionDecisionHtml,
  selectionDecisionSubject,
  selectionDecisionText,
  type SelectionDecisionEmailInput,
} from "../src/lib/selection-decision-notification";

const input: SelectionDecisionEmailInput = {
  decision: "approved",
  projectName: "Harbor Residence",
  jobNumber: "2601",
  selectionNumber: "SEL-101",
  selectionTitle: "Living room fireplace surround",
  optionTitle: "Honed limestone",
  clientDisplay: "owner@example.com",
  notes: "Approved as shown.",
  needOnSiteDate: "2026-06-24",
  selectionsUrl: "https://overwatch.alpcontractorcircle.com/projects/project-id?tab=selections",
};

describe("selection decision notification", () => {
  it("identifies the approved option in the subject, HTML, and plain text", () => {
    expect(selectionDecisionSubject(input)).toBe(
      "Selection approved: Living room fireplace surround",
    );
    expect(selectionDecisionText(input)).toContain("Approved option: Honed limestone");
    expect(selectionDecisionHtml(input)).toContain("Honed limestone");
    expect(selectionDecisionHtml(input)).toContain("Open Selections");
  });

  it("escapes client-provided content in HTML", () => {
    const html = selectionDecisionHtml({
      ...input,
      notes: '<script>alert("x")</script>',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses revision language when the client requests changes", () => {
    const revisionInput = { ...input, decision: "revision_requested" as const };

    expect(selectionDecisionSubject(revisionInput)).toContain("revision requested");
    expect(selectionDecisionText(revisionInput)).toContain("requested a revision");
    expect(selectionDecisionHtml(revisionInput)).toContain("needs revision");
  });
});
