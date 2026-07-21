import { useMemo, useState } from "react";
import { ClipboardCheck, LocateFixed, Play, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  duplicateScopeCounts,
  measurementScopeStatusLabel,
  type MeasurementScopeDecisionStatus,
  type MeasurementScopeQueueItem,
} from "@/lib/plan-room-measurement-scope";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";

type QueueFilter = "open" | "completed" | "rejected" | "all";

const reviewedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Review time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
};

export function MeasurementScopeQueuePanel({
  expanded = false,
  items,
  sheets,
  measurements,
  lineItems,
  ready,
  pending,
  onLocate,
  onStart,
  onDecision,
}: {
  expanded?: boolean;
  items: MeasurementScopeQueueItem[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  lineItems: EstimateLineItemRow[];
  ready: boolean;
  pending: boolean;
  onLocate: (item: MeasurementScopeQueueItem) => void;
  onStart: (item: MeasurementScopeQueueItem) => void;
  onDecision: (item: MeasurementScopeQueueItem, status: MeasurementScopeDecisionStatus) => void;
}) {
  const [filter, setFilter] = useState<QueueFilter>("open");
  const duplicateCounts = useMemo(() => duplicateScopeCounts(items), [items]);
  const filtered = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "open") return item.status === "accepted" || item.status === "deferred";
    return item.status === filter;
  });
  const openCount = items.filter(
    (item) => item.status === "accepted" || item.status === "deferred",
  ).length;

  return (
    <div className="border-b border-hairline pb-4" data-testid="measurement-scope-queue">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="eyebrow flex items-center gap-1.5">
            <ClipboardCheck className="h-3 w-3" /> Scope queue
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Review cited scope across every sheet. Queue state and reviewer history stay with the
            estimate.
          </p>
        </div>
        <Badge className="shrink-0" variant={openCount > 0 ? "secondary" : "outline"}>
          {openCount} open
        </Badge>
      </div>

      {!ready ? (
        <p className="mt-3 rounded-md border border-dashed border-hairline px-3 py-2 text-xs text-muted-foreground">
          The durable scope queue isn't available yet.
        </p>
      ) : items.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-hairline px-3 py-3 text-xs text-muted-foreground">
          Review a vector-PDF sheet, then queue, defer, or reject its cited measurement scope.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-1" aria-label="Scope queue filters">
            {(
              [
                ["open", `Open ${openCount}`],
                [
                  "completed",
                  `Measured ${items.filter((item) => item.status === "completed").length}`,
                ],
                [
                  "rejected",
                  `Rejected ${items.filter((item) => item.status === "rejected").length}`,
                ],
                ["all", `All ${items.length}`],
              ] as Array<[QueueFilter, string]>
            ).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                className="h-7 px-2 text-[10px]"
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>

          <div
            className={expanded ? "mt-3 space-y-3" : "mt-3 max-h-80 space-y-3 overflow-y-auto pr-1"}
            data-testid="measurement-scope-queue-items"
          >
            {filtered.length === 0 ? (
              <p className="py-3 text-xs text-muted-foreground">No scope items in this view.</p>
            ) : (
              filtered.map((item) => {
                const sheet = sheets.find((candidate) => candidate.id === item.plan_sheet_id);
                const measurement = measurements.find(
                  (candidate) => candidate.id === item.takeoff_measurement_id,
                );
                const lineId = measurement?.estimate_line_item_id ?? item.estimate_line_item_id;
                const line = lineItems.find((candidate) => candidate.id === lineId);
                const libraryItemId = measurement?.library_item_id ?? item.library_item_id;
                const duplicateCount = duplicateCounts.get(item.scope_key) ?? 0;
                return (
                  <div
                    key={item.id}
                    className="border-t border-hairline pt-3 first:border-t-0 first:pt-0"
                    data-testid={`measurement-scope-item-${item.id}`}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="min-w-0 break-words text-xs font-medium text-foreground">
                        {item.label}
                      </span>
                      <Badge className="shrink-0" variant="outline">
                        {item.unit}
                      </Badge>
                      <Badge variant={item.status === "completed" ? "secondary" : "outline"}>
                        {measurementScopeStatusLabel(item.status)}
                      </Badge>
                      {duplicateCount > 1 && (
                        <Badge variant="outline">
                          Possible duplicate · {duplicateCount} sheets
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 break-words text-[11px] text-muted-foreground">
                      {sheet?.sheet_number || `Page ${sheet?.page_number ?? "?"}`} ·{" "}
                      {item.source_line}
                    </p>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                      “{item.source_excerpt}”
                    </p>
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      {item.status === "completed" && item.completed_at
                        ? `${item.completed_by_name} measured this ${reviewedAt(item.completed_at)}.`
                        : `${item.decision_by_name} marked this ${measurementScopeStatusLabel(item.status).toLowerCase()} ${reviewedAt(item.decision_at)}.`}
                    </p>
                    {item.status === "completed" && (
                      <p className="mt-1 text-[10px] text-foreground">
                        {line
                          ? `Feeds estimate row: ${line.description}`
                          : libraryItemId
                            ? "Feeds a cost-library item; no estimate row is linked yet."
                            : measurement
                              ? "Measured takeoff is not linked to an estimate row yet."
                              : "Completed takeoff destination is retained in the audit trail."}
                      </p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 px-2 text-[10px]"
                        onClick={() => onLocate(item)}
                      >
                        <LocateFixed className="h-3 w-3" /> Evidence
                      </Button>
                      {(item.status === "accepted" || item.status === "deferred") && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-[10px]"
                          onClick={() => onStart(item)}
                          disabled={pending}
                        >
                          <Play className="h-3 w-3" />
                          {item.status === "deferred" ? "Queue" : "Start"}
                        </Button>
                      )}
                      {item.status === "rejected" && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-[10px]"
                          onClick={() => onDecision(item, "accepted")}
                          disabled={pending}
                        >
                          <RotateCcw className="h-3 w-3" /> Reopen
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
