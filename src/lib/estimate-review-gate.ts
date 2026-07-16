import type { EstimateQuantitySourceReview } from "@/lib/estimate-quantity-source-review";

export interface EstimateReviewLine {
  id: string;
  description: string;
  quantity: number;
  material_unit_cost_cents: number;
  labor_unit_cost_cents: number;
}

export interface EstimateReviewGate {
  review_clear: boolean;
  blocker_count: number;
  follow_up_count: number;
  linked_quantity_blockers: number;
  unpriced_active_rows: EstimateReviewLine[];
  zero_quantity_rows: EstimateReviewLine[];
  plan_room_follow_ups: number;
  current_drawing_sources: number;
  total_drawing_sources: number;
}

const isZero = (value: number) => Math.abs(value) <= 0.000001;

export function buildEstimateReviewGate({
  lines,
  quantitySourceReview,
}: {
  lines: EstimateReviewLine[];
  quantitySourceReview: EstimateQuantitySourceReview;
}): EstimateReviewGate {
  const zeroQuantityRows = lines.filter((line) => isZero(line.quantity));
  const unpricedActiveRows = lines.filter(
    (line) =>
      !isZero(line.quantity) &&
      line.material_unit_cost_cents === 0 &&
      line.labor_unit_cost_cents === 0,
  );
  const linkedQuantityBlockers = quantitySourceReview.ready
    ? quantitySourceReview.linked_review_count
    : 0;
  const planRoomFollowUps = quantitySourceReview.ready
    ? quantitySourceReview.unlinked_review_count
    : 0;
  const blockerCount = linkedQuantityBlockers + unpricedActiveRows.length;
  const followUpCount = zeroQuantityRows.length + planRoomFollowUps;

  return {
    review_clear: blockerCount === 0 && followUpCount === 0,
    blocker_count: blockerCount,
    follow_up_count: followUpCount,
    linked_quantity_blockers: linkedQuantityBlockers,
    unpriced_active_rows: unpricedActiveRows,
    zero_quantity_rows: zeroQuantityRows,
    plan_room_follow_ups: planRoomFollowUps,
    current_drawing_sources: quantitySourceReview.ready ? quantitySourceReview.current_count : 0,
    total_drawing_sources: quantitySourceReview.ready ? quantitySourceReview.total_source_count : 0,
  };
}
