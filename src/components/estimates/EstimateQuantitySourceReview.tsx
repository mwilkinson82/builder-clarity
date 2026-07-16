import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  AlertTriangle,
  Calculator,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  PencilRuler,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  quantitySourceIssueDetail,
  quantitySourceIssueLabel,
  type EstimateQuantitySourceReview,
} from "@/lib/estimate-quantity-source-review";

interface EstimateQuantitySourceReviewProps {
  estimateId: string;
  review: EstimateQuantitySourceReview;
}

const formattedQuantity = (quantity: number, unit: string) =>
  `${quantity.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${unit}`;

const sheetLabel = (sheetNumber: string, sheetName: string) =>
  [sheetNumber, sheetName].filter(Boolean).join(" · ") || "Sheet details unavailable";

export function EstimateQuantitySourceReview({
  estimateId,
  review,
}: EstimateQuantitySourceReviewProps) {
  const [showAll, setShowAll] = useState(false);

  if (!review.ready || review.total_source_count === 0) return null;

  const visibleItems = showAll ? review.items : review.items.slice(0, 4);

  return (
    <div
      className="border-b border-hairline bg-background/55 px-4 py-4"
      data-testid="estimate-quantity-source-review"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <p className="eyebrow">Quantity trust</p>
          <h3 className="mt-1 font-serif text-xl">Quantity Source Review</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Check drawing-derived quantities before you trust this estimate. Nothing here changes or
            resyncs a worksheet row automatically.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          {review.review_count > 0 && (
            <span className="rounded-full border border-warning/30 bg-warning/5 px-2.5 py-1 font-medium text-warning">
              {review.review_count} {review.review_count === 1 ? "item" : "items"} to review
            </span>
          )}
          <span className="rounded-full border border-success/25 bg-success/5 px-2.5 py-1 font-medium text-success">
            {review.current_count} current
          </span>
          {review.linked_review_count > 0 && (
            <span className="rounded-full border border-hairline bg-surface px-2.5 py-1 text-muted-foreground">
              {review.linked_review_count} connected to worksheet rows
            </span>
          )}
        </div>
      </div>

      {review.review_count === 0 ? (
        <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-success" />
            <div>
              <p className="text-sm font-medium">All drawing quantities are current</p>
              <p className="text-xs text-muted-foreground">
                Open Plan Room to inspect the saved markups and calculation evidence.
              </p>
            </div>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/estimates/$estimateId/plan-room" params={{ estimateId }}>
              Open Plan Room
            </Link>
          </Button>
        </div>
      ) : (
        <div className="mt-4 space-y-2 border-t border-hairline pt-3">
          {visibleItems.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 rounded-lg border border-hairline bg-surface px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              data-testid="quantity-source-review-item"
            >
              <div className="flex min-w-0 items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
                  {item.source_type === "assembly" ? (
                    <Calculator className="h-3.5 w-3.5" />
                  ) : (
                    <PencilRuler className="h-3.5 w-3.5" />
                  )}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-medium">{item.source_label}</p>
                    <span className="rounded-full border border-warning/30 bg-warning/5 px-2 py-0.5 text-[10px] font-medium text-warning">
                      {quantitySourceIssueLabel(item.status)}
                    </span>
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {formattedQuantity(item.source_quantity, item.source_unit)}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {sheetLabel(item.sheet_number, item.sheet_name)} ·{" "}
                    {item.source_type === "assembly" ? "Assembly output" : "Takeoff"}
                    {item.formula_version ? ` · ${item.formula_version}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-foreground/80">
                    {quantitySourceIssueDetail(item.status)}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {item.estimate_line_item_id
                      ? `Worksheet row: ${item.line_description || "Unnamed row"}. Review before relying on this source.`
                      : "Plan Room only. This quantity does not feed the estimate."}
                  </p>
                </div>
              </div>
              <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
                <Link
                  to="/estimates/$estimateId/plan-room"
                  params={{ estimateId }}
                  search={{ measurement: item.measurement_id }}
                >
                  <AlertTriangle className="h-3.5 w-3.5" /> Review markup
                </Link>
              </Button>
            </div>
          ))}

          {review.items.length > 4 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="gap-1.5"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showAll ? "Show fewer" : `Show all ${review.items.length}`}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
