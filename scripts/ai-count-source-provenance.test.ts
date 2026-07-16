import { describe, expect, it } from "vitest";
import {
  scopeBriefCountRequestContext,
  scopeBriefCountReviewSourceError,
  type ScopeBriefCountReviewSource,
} from "@/lib/ai-takeoff/ai-count-source-provenance";

const review: ScopeBriefCountReviewSource = {
  id: "11111111-1111-4111-8111-111111111111",
  estimate_id: "22222222-2222-4222-8222-222222222222",
  plan_set_id: "33333333-3333-4333-8333-333333333333",
  ai_operation_id: "44444444-4444-4444-8444-444444444444",
  item_id: "scope-brief-exteriorlight",
  version: 7,
  scope_label: "exterior light fixture",
  plan_sheet_id: "55555555-5555-4555-8555-555555555555",
  source_line: "L066",
  source_excerpt: "EXTERIOR LIGHT FIXTURE",
  status: "accepted",
  next_action: "count_review",
};

const validInput = {
  review,
  latestReviewId: review.id,
  estimateId: review.estimate_id,
  sheetIds: [review.plan_sheet_id],
};

describe("Scope Brief count provenance", () => {
  it("accepts only the current kept Count review on its one cited sheet", () => {
    expect(scopeBriefCountReviewSourceError(validInput)).toBeNull();
    expect(
      scopeBriefCountReviewSourceError({ ...validInput, latestReviewId: crypto.randomUUID() }),
    ).toContain("decision changed");
    expect(
      scopeBriefCountReviewSourceError({
        ...validInput,
        review: { ...review, status: "deferred" },
      }),
    ).toContain("no longer kept");
    expect(
      scopeBriefCountReviewSourceError({
        ...validInput,
        sheetIds: [review.plan_sheet_id, crypto.randomUUID()],
      }),
    ).toContain("only its cited sheet");
  });

  it("builds the durable operation context from the stored review", () => {
    expect(scopeBriefCountRequestContext(review)).toEqual({
      source_kind: "scope_brief",
      scope_brief_review_id: review.id,
      scope_brief_item_id: review.item_id,
      scope_brief_review_version: 7,
      scope_brief_plan_set_id: review.plan_set_id,
      scope_brief_operation_id: review.ai_operation_id,
      scope_label: "exterior light fixture",
      source_line: "L066",
      source_excerpt: "EXTERIOR LIGHT FIXTURE",
    });
  });
});
