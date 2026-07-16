import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  ListChecks,
  PencilRuler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EstimateReviewGate as EstimateReviewGateData } from "@/lib/estimate-review-gate";

interface EstimateReviewGateProps {
  estimateId: string;
  review: EstimateReviewGateData;
}

function ReviewCheck({ clear, label, detail }: { clear: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-md border border-hairline bg-surface px-3 py-2.5">
      {clear ? (
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
      ) : (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
      )}
      <div className="min-w-0">
        <p className="text-xs font-medium">{label}</p>
        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

export function EstimateReviewGate({ estimateId, review }: EstimateReviewGateProps) {
  const unpricedCount = review.unpriced_active_rows.length;
  const zeroQuantityCount = review.zero_quantity_rows.length;

  return (
    <section
      className="border-b border-hairline bg-card px-4 py-4"
      data-testid="estimate-review-gate"
      aria-labelledby="estimate-review-gate-title"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="max-w-3xl">
          <div className="flex flex-wrap items-center gap-2">
            <p className="eyebrow">Pre-bid control</p>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                review.review_clear
                  ? "border-success/25 bg-success/5 text-success"
                  : "border-warning/30 bg-warning/5 text-warning"
              }`}
            >
              {review.review_clear ? "Review inputs clear" : "Estimator review needed"}
            </span>
          </div>
          <h3 id="estimate-review-gate-title" className="mt-1 font-serif text-xl">
            Estimate Review Gate
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Check saved quantities and pricing before this estimate advances. This does not certify
            scope completeness, price accuracy, subcontractor coverage, or readiness to submit.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded-full border border-danger/25 bg-danger/5 px-2.5 py-1 font-medium text-danger">
            {review.blocker_count} blocking
          </span>
          <span className="rounded-full border border-warning/30 bg-warning/5 px-2.5 py-1 font-medium text-warning">
            {review.follow_up_count} follow-up
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <ReviewCheck
          clear={review.linked_quantity_blockers === 0}
          label="Worksheet quantity trust"
          detail={
            review.total_drawing_sources === 0
              ? "No drawing-derived quantities are saved. This check is worksheet-only."
              : review.linked_quantity_blockers === 0
                ? `${review.current_drawing_sources} of ${review.total_drawing_sources} saved drawing sources are current; no flagged source blocks a worksheet row.`
                : `${review.linked_quantity_blockers} linked drawing ${review.linked_quantity_blockers === 1 ? "source needs" : "sources need"} review before worksheet quantities can be trusted.`
          }
        />
        <ReviewCheck
          clear={unpricedCount === 0}
          label="Active-row pricing"
          detail={
            unpricedCount === 0
              ? "Every nonzero row has a material or labor unit cost."
              : `${unpricedCount} nonzero ${unpricedCount === 1 ? "row has" : "rows have"} no material or labor unit cost.`
          }
        />
        <ReviewCheck
          clear={zeroQuantityCount === 0}
          label="Zero quantities"
          detail={
            zeroQuantityCount === 0
              ? "Every worksheet row carries a nonzero quantity."
              : `${zeroQuantityCount} ${zeroQuantityCount === 1 ? "row remains" : "rows remain"} at zero. Zero can be intentional; confirm it.`
          }
        />
        <ReviewCheck
          clear={review.plan_room_follow_ups === 0}
          label="Plan Room-only review"
          detail={
            review.plan_room_follow_ups === 0
              ? "No flagged drawing quantity is waiting outside the worksheet."
              : `${review.plan_room_follow_ups} flagged drawing ${review.plan_room_follow_ups === 1 ? "quantity does" : "quantities do"} not feed this estimate.`
          }
        />
      </div>

      {!review.review_clear && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <a href="#estimate-line-items">
              <CircleDollarSign className="h-3.5 w-3.5" /> Review worksheet
            </a>
          </Button>
          <Button asChild size="sm" variant="outline" className="gap-1.5">
            <Link to="/estimates/$estimateId/plan-room" params={{ estimateId }}>
              <PencilRuler className="h-3.5 w-3.5" /> Open Plan Room
            </Link>
          </Button>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <ListChecks className="h-3.5 w-3.5" /> Human sign-off remains required.
          </span>
        </div>
      )}
    </section>
  );
}
