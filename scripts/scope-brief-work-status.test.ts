import { describe, expect, it } from "vitest";
import type { PlanScopeBriefReview } from "../src/lib/plan-scope-brief-review";
import {
  derivePlanScopeBriefWorkStatus,
  scopeBriefTakeoffSourceError,
  scopeBriefWorkStatusDetail,
  type ScopeBriefWorkOperation,
  type ScopeBriefWorkTakeoff,
} from "../src/lib/plan-scope-brief-work";

const review = (patch: Partial<PlanScopeBriefReview> = {}): PlanScopeBriefReview => ({
  id: "11111111-1111-4111-8111-111111111111",
  estimate_id: "22222222-2222-4222-8222-222222222222",
  plan_set_id: "33333333-3333-4333-8333-333333333333",
  ai_operation_id: "44444444-4444-4444-8444-444444444444",
  item_id: "scope-brief-exteriorlight",
  version: 7,
  trade: "Electrical",
  review_kind: "linear",
  scope_label: "exterior light fixture",
  plan_sheet_id: "55555555-5555-4555-8555-555555555555",
  source_line: "L066",
  source_excerpt: "EXTERIOR LIGHT FIXTURE",
  status: "accepted",
  next_action: "length_review",
  review_notes: "",
  reviewed_by: null,
  reviewed_by_name: "Estimator",
  reviewed_at: "2026-07-16T01:00:00.000Z",
  created_at: "2026-07-16T01:00:00.000Z",
  ...patch,
});

const takeoff = (patch: Partial<ScopeBriefWorkTakeoff> = {}): ScopeBriefWorkTakeoff => ({
  id: "66666666-6666-4666-8666-666666666666",
  reviewId: review().id,
  aiOperationId: null,
  quantity: 24,
  unit: "LF",
  calculationStatus: "current",
  estimateLineItemId: null,
  updatedAt: "2026-07-16T02:00:00.000Z",
  ...patch,
});

const operation = (patch: Partial<ScopeBriefWorkOperation> = {}): ScopeBriefWorkOperation => ({
  id: "77777777-7777-4777-8777-777777777777",
  reviewId: review().id,
  status: "pending",
  createdAt: "2026-07-16T02:00:00.000Z",
  updatedAt: "2026-07-16T02:00:00.000Z",
  ...patch,
});

describe("Scope Brief downstream work status", () => {
  it("starts a current kept decision at ready without implying work exists", () => {
    const status = derivePlanScopeBriefWorkStatus({
      review: review(),
      itemReviews: [review()],
      operations: [],
      takeoffs: [],
    });
    expect(status.state).toBe("ready");
    expect(scopeBriefWorkStatusDetail(status)).toContain("No downstream takeoff");
  });

  it("derives current and review-required takeoff state from direct provenance", () => {
    const current = derivePlanScopeBriefWorkStatus({
      review: review(),
      itemReviews: [review()],
      operations: [],
      takeoffs: [takeoff(), takeoff({ id: "88888888-8888-4888-8888-888888888888", quantity: 6 })],
    });
    expect(current).toMatchObject({
      state: "takeoff_current",
      takeoffCount: 2,
      quantity: 30,
      unit: "LF",
      linkedCount: 0,
    });

    const stale = derivePlanScopeBriefWorkStatus({
      review: review(),
      itemReviews: [review()],
      operations: [],
      takeoffs: [takeoff({ calculationStatus: "stale" })],
    });
    expect(stale.state).toBe("takeoff_review");
  });

  it("uses count-operation provenance without duplicating it on the takeoff", () => {
    const pending = derivePlanScopeBriefWorkStatus({
      review: review({ review_kind: "count", next_action: "count_review" }),
      itemReviews: [review()],
      operations: [operation()],
      takeoffs: [],
    });
    expect(pending.state).toBe("ai_pending");

    const accepted = derivePlanScopeBriefWorkStatus({
      review: review({ review_kind: "count", next_action: "count_review" }),
      itemReviews: [review()],
      operations: [operation({ status: "succeeded" })],
      takeoffs: [takeoff({ reviewId: null, aiOperationId: operation().id, unit: "EA" })],
    });
    expect(accepted).toMatchObject({ state: "takeoff_current", quantity: 24, unit: "EA" });
  });

  it("warns when work belongs to an earlier immutable decision version", () => {
    const prior = review({ id: "99999999-9999-4999-8999-999999999999", version: 6 });
    const current = review({ version: 7 });
    const status = derivePlanScopeBriefWorkStatus({
      review: current,
      itemReviews: [current, prior],
      operations: [],
      takeoffs: [takeoff({ reviewId: prior.id })],
    });
    expect(status.state).toBe("prior_work");
    expect(scopeBriefWorkStatusDetail(status)).toContain("earlier version");
  });
});

describe("Scope Brief manual takeoff provenance", () => {
  it("requires the current kept decision, cited sheet, and matching LF/SF route", () => {
    const source = review();
    const valid = scopeBriefTakeoffSourceError({
      review: source,
      latestReviewId: source.id,
      estimateId: source.estimate_id,
      sheetId: source.plan_sheet_id,
      tool: "linear",
    });
    expect(valid).toBeNull();

    expect(
      scopeBriefTakeoffSourceError({
        review: source,
        latestReviewId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        estimateId: source.estimate_id,
        sheetId: source.plan_sheet_id,
        tool: "linear",
      }),
    ).toMatch(/changed/i);
    expect(
      scopeBriefTakeoffSourceError({
        review: source,
        latestReviewId: source.id,
        estimateId: source.estimate_id,
        sheetId: source.plan_sheet_id,
        tool: "area",
      }),
    ).toMatch(/not routed/i);
    expect(
      scopeBriefTakeoffSourceError({
        review: review({ review_kind: "count", next_action: "count_review" }),
        latestReviewId: source.id,
        estimateId: source.estimate_id,
        sheetId: source.plan_sheet_id,
        tool: "count",
      }),
    ).toMatch(/AI count operation/i);
  });
});
