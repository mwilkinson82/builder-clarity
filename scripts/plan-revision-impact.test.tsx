import { describe, expect, it } from "vitest";
import {
  normalizeRevisionImpactItems,
  revisionImpactDraftError,
  revisionImpactReviewInputSchema,
  type RevisionImpactItem,
} from "@/lib/plan-revision-impact";

const impact: RevisionImpactItem = {
  id: "00000000-0000-4000-8000-000000000001",
  category: "modified",
  title: "East wall increased four feet",
  required_action: "remeasure",
  status: "open",
  notes: "Estimator verified the changed wall line in the overlay.",
};

const baseReview = {
  estimate_id: "00000000-0000-4000-8000-000000000002",
  revision_match_id: "00000000-0000-4000-8000-000000000003",
  summary_notes: "Estimator compared the accepted pair.",
};

describe("revision impact review", () => {
  it("accepts a no-impact certification only when no impacts are attached", () => {
    expect(
      revisionImpactReviewInputSchema.parse({
        ...baseReview,
        disposition: "no_estimate_impact",
        impacts: [],
      }),
    ).toEqual(expect.objectContaining({ disposition: "no_estimate_impact", impacts: [] }));

    expect(
      revisionImpactReviewInputSchema.safeParse({
        ...baseReview,
        disposition: "no_estimate_impact",
        impacts: [impact],
      }).success,
    ).toBe(false);
  });

  it("requires at least one structured item when impacts are logged", () => {
    expect(
      revisionImpactReviewInputSchema.safeParse({
        ...baseReview,
        disposition: "impacts_logged",
        impacts: [],
      }).success,
    ).toBe(false);

    expect(
      revisionImpactReviewInputSchema.parse({
        ...baseReview,
        disposition: "impacts_logged",
        impacts: [impact],
      }).impacts,
    ).toEqual([impact]);
  });

  it("allows follow-up review with or without a classified impact", () => {
    for (const impacts of [[], [impact]]) {
      expect(
        revisionImpactReviewInputSchema.safeParse({
          ...baseReview,
          disposition: "needs_follow_up",
          impacts,
        }).success,
      ).toBe(true);
    }
  });

  it("drops malformed persisted impact arrays and explains incomplete drafts", () => {
    expect(normalizeRevisionImpactItems([{ ...impact, status: "invented" }])).toEqual([]);
    expect(revisionImpactDraftError({ disposition: "impacts_logged", impacts: [] })).toContain(
      "at least one impact",
    );
    expect(
      revisionImpactDraftError({
        disposition: "needs_follow_up",
        impacts: [{ ...impact, title: "" }],
      }),
    ).toContain("specific title");
  });
});
