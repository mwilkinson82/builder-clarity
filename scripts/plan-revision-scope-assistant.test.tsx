import { describe, expect, it } from "vitest";
import {
  parseRevisionScopeCandidates,
  revisionScopeCandidateToImpact,
} from "@/lib/plan-revision-scope-assistant";

const revisionLines = [
  { line_number: "L001", text: "PROVIDE 2 HOUR GWB PARTITION AT ELECTRICAL ROOM" },
  { line_number: "L002", text: "ISSUED FOR PERMIT" },
  { line_number: "L003", text: "RELOCATE FLOOR DRAIN TO NORTH WALL" },
];

const baseLines = [
  { line_number: "L001", text: "PROVIDE 1 HOUR GWB PARTITION AT ELECTRICAL ROOM" },
  { line_number: "L002", text: "ISSUED FOR BID" },
];

describe("revision scope assistant", () => {
  it("keeps grounded construction-note differences and creates deterministic review tasks", () => {
    const result = parseRevisionScopeCandidates({
      revisionLines,
      baseLines,
      raw: JSON.stringify({
        candidates: [
          {
            revision_line: "L001",
            revision_excerpt: "2 HOUR GWB PARTITION AT ELECTRICAL ROOM",
            base_line: "L001",
            base_excerpt: "1 HOUR GWB PARTITION AT ELECTRICAL ROOM",
          },
        ],
      }),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        id: "revision-scope-candidate-1",
        title: "Review: 2 HOUR GWB PARTITION AT ELECTRICAL ROOM",
      }),
    );

    const impact = revisionScopeCandidateToImpact({
      candidate: result.candidates[0],
      operationId: "00000000-0000-4000-8000-000000000010",
      impactId: "00000000-0000-4000-8000-000000000011",
    });
    expect(impact).toEqual(
      expect.objectContaining({
        category: "unknown",
        required_action: "scope_review",
        status: "open",
        ai_provenance: expect.objectContaining({
          source: "ai_revision_scope_review",
          candidate_id: "revision-scope-candidate-1",
        }),
      }),
    );
  });

  it("allows a cited revision-only scope note when the full line is absent from the prior sheet", () => {
    const result = parseRevisionScopeCandidates({
      revisionLines,
      baseLines,
      raw: JSON.stringify({
        candidates: [
          {
            revision_line: "L003",
            revision_excerpt: "RELOCATE FLOOR DRAIN TO NORTH WALL",
            base_line: "",
            base_excerpt: "",
          },
        ],
      }),
    });
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].base_citation).toBeNull();
  });

  it("drops hallucinated citations, unchanged text, and administrative-only issue notes", () => {
    const result = parseRevisionScopeCandidates({
      revisionLines,
      baseLines: [...baseLines, revisionLines[2]],
      raw: JSON.stringify({
        candidates: [
          {
            revision_line: "L001",
            revision_excerpt: "ADD CONCRETE FOUNDATION",
            base_line: "",
            base_excerpt: "",
          },
          {
            revision_line: "L003",
            revision_excerpt: "RELOCATE FLOOR DRAIN TO NORTH WALL",
            base_line: "",
            base_excerpt: "",
          },
          {
            revision_line: "L002",
            revision_excerpt: "ISSUED FOR PERMIT",
            base_line: "L002",
            base_excerpt: "ISSUED FOR BID",
          },
        ],
      }),
    });
    expect(result.candidates).toEqual([]);
    expect(result.warnings[0]).toContain("3 AI candidates");
  });
});
