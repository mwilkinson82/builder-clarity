import { describe, expect, it } from "vitest";
import { buildEstimateReviewGate } from "../src/lib/estimate-review-gate";
import type { EstimateQuantitySourceReview } from "../src/lib/estimate-quantity-source-review";

const quantityReview = (
  patch: Partial<EstimateQuantitySourceReview> = {},
): EstimateQuantitySourceReview => ({
  ready: true,
  total_source_count: 5,
  current_count: 4,
  review_count: 1,
  linked_review_count: 0,
  unlinked_review_count: 1,
  items: [],
  ...patch,
});

describe("estimate review gate", () => {
  it("keeps Plan Room-only issues and zero quantities as follow-ups, not blockers", () => {
    const review = buildEstimateReviewGate({
      lines: [
        {
          id: "priced",
          description: "Priced scope",
          quantity: 10,
          material_unit_cost_cents: 500,
          labor_unit_cost_cents: 0,
        },
        {
          id: "allowance",
          description: "Unconfirmed allowance",
          quantity: 0,
          material_unit_cost_cents: 200,
          labor_unit_cost_cents: 100,
        },
      ],
      quantitySourceReview: quantityReview(),
    });

    expect(review).toMatchObject({
      review_clear: false,
      blocker_count: 0,
      follow_up_count: 2,
      linked_quantity_blockers: 0,
      plan_room_follow_ups: 1,
      current_drawing_sources: 4,
    });
    expect(review.zero_quantity_rows.map((row) => row.id)).toEqual(["allowance"]);
  });

  it("blocks linked quantity issues and active rows without pricing", () => {
    const review = buildEstimateReviewGate({
      lines: [
        {
          id: "unpriced",
          description: "Measured but unpriced",
          quantity: 81.25,
          material_unit_cost_cents: 0,
          labor_unit_cost_cents: 0,
        },
      ],
      quantitySourceReview: quantityReview({
        review_count: 1,
        linked_review_count: 1,
        unlinked_review_count: 0,
      }),
    });

    expect(review.blocker_count).toBe(2);
    expect(review.follow_up_count).toBe(0);
    expect(review.unpriced_active_rows[0].id).toBe("unpriced");
  });

  it("reports clear only when every deterministic check is clear", () => {
    const review = buildEstimateReviewGate({
      lines: [
        {
          id: "ready",
          description: "Ready row",
          quantity: 1,
          material_unit_cost_cents: 100,
          labor_unit_cost_cents: 200,
        },
      ],
      quantitySourceReview: quantityReview({
        total_source_count: 1,
        current_count: 1,
        review_count: 0,
        linked_review_count: 0,
        unlinked_review_count: 0,
      }),
    });

    expect(review.review_clear).toBe(true);
    expect(review.blocker_count).toBe(0);
    expect(review.follow_up_count).toBe(0);
  });
});
