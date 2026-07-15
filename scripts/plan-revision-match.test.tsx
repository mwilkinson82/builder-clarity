// Pure revision identity tests. TSX matches this repository's focused Vitest include.
import { describe, expect, it } from "vitest";
import {
  deterministicRevisionProposal,
  parseAiRevisionMatches,
  rankRevisionCandidates,
  revisionMatchCredits,
  scoreRevisionMatch,
  type RevisionSheetIdentity,
} from "@/lib/plan-revision-match";

const sheet = (
  overrides: Partial<RevisionSheetIdentity> & Pick<RevisionSheetIdentity, "id">,
): RevisionSheetIdentity => ({
  id: overrides.id,
  plan_set_id: "set-1",
  plan_set_name: "Issued for Bid",
  plan_set_created_at: "2026-07-01T12:00:00.000Z",
  sheet_number: "A1.1",
  sheet_name: "Foundation Plan",
  discipline: "Architectural",
  page_number: 4,
  ...overrides,
});

describe("plan revision metadata matching", () => {
  it("auto-proposes one strong normalized sheet identity match", () => {
    const revision = sheet({
      id: "revision",
      plan_set_id: "set-2",
      plan_set_name: "Revision 2",
      plan_set_created_at: "2026-07-15T12:00:00.000Z",
      sheet_number: "A-1.1 REV 2",
    });
    const base = sheet({ id: "base" });

    const proposal = deterministicRevisionProposal(revision, [base]);

    expect(proposal).toEqual(
      expect.objectContaining({
        revision_sheet_id: "revision",
        base_sheet_id: "base",
        method: "deterministic",
      }),
    );
    expect(proposal?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("refuses deterministic matching when two prior sheets are equally plausible", () => {
    const revision = sheet({ id: "revision", plan_set_id: "set-3" });
    const first = sheet({ id: "base-1" });
    const second = sheet({
      id: "base-2",
      plan_set_id: "set-2",
      plan_set_created_at: "2026-07-08T12:00:00.000Z",
    });

    expect(deterministicRevisionProposal(revision, [first, second])).toBeNull();
  });

  it("does not treat title, discipline, and PDF page order as an exact identity", () => {
    const revision = sheet({ id: "revision", sheet_number: "" });
    const base = sheet({ id: "base", sheet_number: "" });

    expect(scoreRevisionMatch(revision, base).confidence).toBeLessThan(0.85);
    expect(deterministicRevisionProposal(revision, [base])).toBeNull();
  });

  it("withholds weak title-word and PDF-position coincidences from AI", () => {
    const revision = sheet({
      id: "revision",
      sheet_number: "A-100",
      sheet_name: "Floor &",
      discipline: "",
      page_number: 3,
    });
    const unrelatedBase = sheet({
      id: "base",
      sheet_number: "A2.1",
      sheet_name: "Floor Plan",
      discipline: "",
      page_number: 3,
    });

    expect(scoreRevisionMatch(revision, unrelatedBase).confidence).toBe(0.14);
    expect(rankRevisionCandidates(revision, [unrelatedBase])).toEqual([]);
  });

  it("accepts only supplied AI candidates, prevents duplicate base use, and caps confidence", () => {
    const revisions = [sheet({ id: "revision-1" }), sheet({ id: "revision-2" })];
    const candidateMap = new Map([
      [
        "revision-1",
        [{ base_sheet_id: "base-1", confidence: 0.63, evidence: ["Title words overlap"] }],
      ],
      [
        "revision-2",
        [{ base_sheet_id: "base-1", confidence: 0.7, evidence: ["Sheet number matches"] }],
      ],
    ]);

    const matches = parseAiRevisionMatches({
      revisionSheets: revisions,
      candidateMap,
      raw: JSON.stringify({
        matches: [
          {
            revision_sheet_id: "revision-1",
            base_sheet_id: "unknown-base",
            confidence: 0.99,
          },
          {
            revision_sheet_id: "revision-1",
            base_sheet_id: "base-1",
            confidence: 0.95,
            reason: "Best supplied metadata candidate.",
          },
          {
            revision_sheet_id: "revision-2",
            base_sheet_id: "base-1",
            confidence: 0.7,
          },
        ],
      }),
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual(
      expect.objectContaining({
        revision_sheet_id: "revision-1",
        base_sheet_id: "base-1",
        confidence: 0.63,
      }),
    );
  });

  it("quotes a bounded one-credit-per-100-pages maximum", () => {
    expect(revisionMatchCredits(0)).toBe(0);
    expect(revisionMatchCredits(1)).toBe(1);
    expect(revisionMatchCredits(100)).toBe(1);
    expect(revisionMatchCredits(101)).toBe(2);
    expect(revisionMatchCredits(500)).toBe(5);
    expect(revisionMatchCredits(900)).toBe(5);
  });
});
