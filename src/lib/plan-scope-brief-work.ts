import {
  planScopeBriefReviewIsActionable,
  type PlanScopeBriefReview,
} from "@/lib/plan-scope-brief-review";

export type ScopeBriefWorkOperationStatus = "pending" | "succeeded" | "failed";

export interface ScopeBriefWorkOperation {
  id: string;
  reviewId: string;
  status: ScopeBriefWorkOperationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeBriefWorkTakeoff {
  id: string;
  reviewId: string | null;
  aiOperationId: string | null;
  quantity: number;
  unit: string;
  calculationStatus: string;
  estimateLineItemId: string | null;
  updatedAt: string;
}

export type ScopeBriefWorkState =
  | "decision_only"
  | "ready"
  | "ai_pending"
  | "ai_failed"
  | "ai_complete"
  | "takeoff_current"
  | "takeoff_review"
  | "prior_work";

export interface ScopeBriefWorkStatus {
  state: ScopeBriefWorkState;
  takeoffCount: number;
  quantity: number | null;
  unit: string;
  linkedCount: number;
  operationId: string | null;
  updatedAt: string | null;
}

type ScopeBriefTakeoffReview = Pick<
  PlanScopeBriefReview,
  "id" | "estimate_id" | "item_id" | "plan_sheet_id" | "status" | "next_action"
>;

const time = (value: string) => {
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

function workForReview({
  reviewId,
  operations,
  takeoffs,
}: {
  reviewId: string;
  operations: ScopeBriefWorkOperation[];
  takeoffs: ScopeBriefWorkTakeoff[];
}) {
  const matchingOperations = operations
    .filter((operation) => operation.reviewId === reviewId)
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  const operationIds = new Set(matchingOperations.map((operation) => operation.id));
  const matchingTakeoffs = takeoffs
    .filter(
      (takeoff) =>
        takeoff.reviewId === reviewId ||
        Boolean(takeoff.aiOperationId && operationIds.has(takeoff.aiOperationId)),
    )
    .sort((a, b) => time(b.updatedAt) - time(a.updatedAt));
  return { matchingOperations, matchingTakeoffs };
}

export function derivePlanScopeBriefWorkStatus({
  review,
  itemReviews,
  operations,
  takeoffs,
}: {
  review: ScopeBriefTakeoffReview;
  itemReviews: PlanScopeBriefReview[];
  operations: ScopeBriefWorkOperation[];
  takeoffs: ScopeBriefWorkTakeoff[];
}): ScopeBriefWorkStatus {
  const exact = workForReview({ reviewId: review.id, operations, takeoffs });
  if (exact.matchingTakeoffs.length > 0) {
    const units = new Set(
      exact.matchingTakeoffs.map((takeoff) => takeoff.unit.trim().toUpperCase()),
    );
    const unit = units.size === 1 ? [...units][0] : "";
    const quantity =
      unit.length > 0
        ? exact.matchingTakeoffs.reduce((sum, takeoff) => sum + takeoff.quantity, 0)
        : null;
    const needsReview = exact.matchingTakeoffs.some(
      (takeoff) => takeoff.calculationStatus !== "current",
    );
    return {
      state: needsReview ? "takeoff_review" : "takeoff_current",
      takeoffCount: exact.matchingTakeoffs.length,
      quantity,
      unit,
      linkedCount: exact.matchingTakeoffs.filter((takeoff) => takeoff.estimateLineItemId).length,
      operationId: exact.matchingOperations[0]?.id ?? null,
      updatedAt: exact.matchingTakeoffs[0]?.updatedAt ?? null,
    };
  }

  const latestOperation = exact.matchingOperations[0] ?? null;
  if (latestOperation) {
    return {
      state:
        latestOperation.status === "pending"
          ? "ai_pending"
          : latestOperation.status === "failed"
            ? "ai_failed"
            : "ai_complete",
      takeoffCount: 0,
      quantity: null,
      unit: "",
      linkedCount: 0,
      operationId: latestOperation.id,
      updatedAt: latestOperation.updatedAt,
    };
  }

  const priorHasWork = itemReviews
    .filter((candidate) => candidate.id !== review.id)
    .some((candidate) => {
      const prior = workForReview({ reviewId: candidate.id, operations, takeoffs });
      return prior.matchingOperations.length > 0 || prior.matchingTakeoffs.length > 0;
    });
  if (priorHasWork) {
    return {
      state: "prior_work",
      takeoffCount: 0,
      quantity: null,
      unit: "",
      linkedCount: 0,
      operationId: null,
      updatedAt: null,
    };
  }

  return {
    state: planScopeBriefReviewIsActionable(review) ? "ready" : "decision_only",
    takeoffCount: 0,
    quantity: null,
    unit: "",
    linkedCount: 0,
    operationId: null,
    updatedAt: null,
  };
}

export function scopeBriefWorkStatusLabel(status: ScopeBriefWorkStatus) {
  return (
    {
      decision_only: "Decision recorded",
      ready: "Ready to start",
      ai_pending: "AI review in progress",
      ai_failed: "AI review needs retry",
      ai_complete: "Review complete · no takeoff accepted",
      takeoff_current: "Takeoff recorded",
      takeoff_review: "Takeoff needs review",
      prior_work: "Earlier decision has work",
    } satisfies Record<ScopeBriefWorkState, string>
  )[status.state];
}

export function scopeBriefWorkStatusDetail(status: ScopeBriefWorkStatus) {
  if (status.state === "takeoff_current" || status.state === "takeoff_review") {
    const quantity =
      status.quantity == null
        ? `${status.takeoffCount} takeoff${status.takeoffCount === 1 ? "" : "s"}`
        : `${Number(status.quantity.toFixed(4))} ${status.unit}`;
    const link =
      status.linkedCount === status.takeoffCount
        ? "linked to the estimate"
        : status.linkedCount > 0
          ? `${status.linkedCount} of ${status.takeoffCount} linked`
          : "not linked to an estimate row";
    return `${quantity} · ${link}.`;
  }
  if (status.state === "ai_pending") {
    return "No count becomes a takeoff until the estimator accepts proposed marks.";
  }
  if (status.state === "ai_complete") {
    return "The cited scan finished, but no accepted count takeoff is linked to this decision.";
  }
  if (status.state === "ai_failed") {
    return "The prior cited scan failed without creating a takeoff; the estimator may retry.";
  }
  if (status.state === "prior_work") {
    return "This decision version has no linked work; an earlier version remains retained for audit.";
  }
  if (status.state === "ready") {
    return "No downstream takeoff or cited count operation is linked to this decision yet.";
  }
  return "This decision is retained as scope evidence and has no active work route.";
}

export function scopeBriefTakeoffSourceError({
  review,
  latestReviewId,
  estimateId,
  sheetId,
  tool,
}: {
  review: ScopeBriefTakeoffReview;
  latestReviewId: string;
  estimateId: string;
  sheetId: string;
  tool: "linear" | "area" | "count";
}) {
  if (review.estimate_id !== estimateId || review.plan_sheet_id !== sheetId) {
    return "The cited Scope Brief decision does not belong to this estimate sheet.";
  }
  if (review.id !== latestReviewId) {
    return "The cited Scope Brief decision changed. Reopen the current decision before measuring.";
  }
  if (review.status !== "accepted") {
    return "Only a currently kept Scope Brief decision can create cited takeoff provenance.";
  }
  if (tool === "count") {
    return "Cited count provenance must come through the reviewed AI count operation.";
  }
  const expectedAction = tool === "linear" ? "length_review" : "area_review";
  if (review.next_action !== expectedAction) {
    return `This Scope Brief decision is not routed to a ${tool} takeoff.`;
  }
  return null;
}
