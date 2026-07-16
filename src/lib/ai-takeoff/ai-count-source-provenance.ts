export interface ScopeBriefCountReviewSource {
  id: string;
  estimate_id: string;
  plan_set_id: string;
  ai_operation_id: string;
  item_id: string;
  version: number;
  scope_label: string;
  plan_sheet_id: string;
  source_line: string;
  source_excerpt: string;
  status: string;
  next_action: string;
}

export interface AiCountScopeBriefSource {
  reviewId: string;
  version: number;
  label: string;
  sheetNumber: string;
  sourceLine: string;
  sourceExcerpt: string;
}

export function scopeBriefCountReviewSourceError({
  review,
  latestReviewId,
  estimateId,
  sheetIds,
}: {
  review: ScopeBriefCountReviewSource;
  latestReviewId: string;
  estimateId: string;
  sheetIds: string[];
}) {
  if (review.estimate_id !== estimateId) {
    return "The cited Scope Brief decision does not belong to this estimate.";
  }
  if (review.id !== latestReviewId) {
    return "The Scope Brief decision changed. Reopen the cited brief before starting this scan.";
  }
  if (review.status !== "accepted" || review.next_action !== "count_review") {
    return "This Scope Brief item is no longer kept for Count review.";
  }
  if (sheetIds.length !== 1 || sheetIds[0] !== review.plan_sheet_id) {
    return "A Scope Brief count review can scan only its cited sheet.";
  }
  return null;
}

export function scopeBriefCountRequestContext(review: ScopeBriefCountReviewSource) {
  return {
    source_kind: "scope_brief",
    scope_brief_review_id: review.id,
    scope_brief_item_id: review.item_id,
    scope_brief_review_version: Math.max(1, Math.trunc(review.version)),
    scope_brief_plan_set_id: review.plan_set_id,
    scope_brief_operation_id: review.ai_operation_id,
    scope_label: review.scope_label.trim().slice(0, 120),
    source_line: review.source_line,
    source_excerpt: review.source_excerpt.trim().slice(0, 260),
  } as const;
}
