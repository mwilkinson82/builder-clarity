import type { PlanScopeBriefReviewKind, PlanScopeBriefTrade } from "@/lib/plan-scope-brief";

export const PLAN_SCOPE_BRIEF_REVIEW_STATUSES = ["accepted", "deferred", "excluded"] as const;
export const PLAN_SCOPE_BRIEF_NEXT_ACTIONS = [
  "count_review",
  "length_review",
  "area_review",
  "assembly_review",
  "pricing_review",
  "scope_coordination",
  "none",
] as const;

export type PlanScopeBriefReviewStatus = (typeof PLAN_SCOPE_BRIEF_REVIEW_STATUSES)[number];
export type PlanScopeBriefNextAction = (typeof PLAN_SCOPE_BRIEF_NEXT_ACTIONS)[number];

export interface PlanScopeBriefReview {
  id: string;
  estimate_id: string;
  plan_set_id: string;
  ai_operation_id: string;
  item_id: string;
  version: number;
  trade: PlanScopeBriefTrade;
  review_kind: PlanScopeBriefReviewKind;
  scope_label: string;
  plan_sheet_id: string;
  source_line: string;
  source_excerpt: string;
  status: PlanScopeBriefReviewStatus;
  next_action: PlanScopeBriefNextAction;
  review_notes: string;
  reviewed_by: string | null;
  reviewed_by_name: string;
  reviewed_at: string;
  created_at: string;
}

export const defaultScopeBriefNextAction = (
  reviewKind: PlanScopeBriefReviewKind,
): Exclude<PlanScopeBriefNextAction, "none"> =>
  ({
    count: "count_review",
    linear: "length_review",
    area: "area_review",
    assembly: "assembly_review",
    allowance: "pricing_review",
    coordination: "scope_coordination",
  })[reviewKind];

export const planScopeBriefReviewStatusLabel = (status: PlanScopeBriefReviewStatus) =>
  ({ accepted: "Kept", deferred: "Later", excluded: "Excluded" })[status];

export const planScopeBriefNextActionLabel = (action: PlanScopeBriefNextAction) =>
  ({
    count_review: "Count review",
    length_review: "Length takeoff review",
    area_review: "Area takeoff review",
    assembly_review: "Assembly input review",
    pricing_review: "Pricing / allowance review",
    scope_coordination: "Scope coordination",
    none: "No next action",
  })[action];

/**
 * Reviews are append-only. Keep the newest version for each stable cited item
 * while leaving all earlier rows available to the audit trail.
 */
export function latestPlanScopeBriefReviews(reviews: PlanScopeBriefReview[]) {
  const latest = new Map<string, PlanScopeBriefReview>();
  for (const review of reviews) {
    const current = latest.get(review.item_id);
    if (!current || review.version > current.version) latest.set(review.item_id, review);
  }
  return latest;
}

export function planScopeBriefReviewDraftError({
  status,
  nextAction,
  defaultAction,
  notes,
}: {
  status: PlanScopeBriefReviewStatus;
  nextAction: PlanScopeBriefNextAction;
  defaultAction: Exclude<PlanScopeBriefNextAction, "none">;
  notes: string;
}) {
  const cleanNotes = notes.trim();
  if (status === "excluded" && cleanNotes.length < 3) {
    return "Explain why this cited scope is excluded.";
  }
  if (status !== "excluded" && nextAction === "none") {
    return "Choose the estimator's next review action.";
  }
  if (status !== "excluded" && nextAction !== defaultAction && cleanNotes.length < 3) {
    return "Explain why the next action differs from the cited review type.";
  }
  return null;
}
