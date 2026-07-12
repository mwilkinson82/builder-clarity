import { Button } from "@/components/ui/button";
import { AlertTriangle, ClipboardList, Pencil, CheckCircle2, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleActivityRow } from "@/lib/schedule.functions";
import {
  type ScheduleQualityQueueItem,
  type ScheduleUpdateReadinessSummary,
  shortDate,
} from "./scheduleShared";
import { formatUpdateReadinessQueueLine } from "./scheduleUpdateReadiness";
import { ActivityUpdateImpactTile } from "./ActivityDetailDialog";

export function ScheduleWorkbenchStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";
  return (
    <div className="min-w-0 rounded-[10px] border border-hairline bg-background p-3">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 truncate font-serif text-xl tabular ${toneClass}`}>{value}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export function ScheduleUpdateReadinessPanel({
  summary,
  dataDate,
  onShowActive,
  onShowUpdateQueue,
  onOpenActivity,
}: {
  summary: ScheduleUpdateReadinessSummary;
  dataDate: string | null;
  onShowActive: () => void;
  onShowUpdateQueue: () => void;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
}) {
  const visibleItems = summary.items.slice(0, 5);
  const hiddenCount = Math.max(0, summary.items.length - visibleItems.length);
  const nextItem = summary.items[0] ?? null;
  const tone =
    summary.needsStatusCount === 0 ? "success" : summary.lateCount > 0 ? "danger" : "warning";

  return (
    <div
      className={cn(
        "mt-3.5 rounded-[10px] border bg-background p-4",
        tone === "success"
          ? "border-success/25"
          : tone === "danger"
            ? "border-danger/20"
            : "border-warning/25",
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            {summary.needsStatusCount === 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <AlertTriangle
                className={cn("h-3.5 w-3.5", tone === "danger" ? "text-danger" : "text-warning")}
              />
            )}
            Data-date update readiness
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {dataDate
              ? `Status basis ${shortDate(dataDate)}.`
              : "Set a data date before saving the next CPM update."}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="h-9 gap-2" onClick={onShowUpdateQueue}>
            <ClipboardList className="h-4 w-4" />
            Show needs update
          </Button>
          <Button
            type="button"
            className="h-9 gap-2"
            disabled={!nextItem}
            onClick={() => nextItem && onOpenActivity(nextItem.task.activity)}
          >
            <Pencil className="h-4 w-4" />
            Open next update row
          </Button>
          <Button type="button" variant="outline" className="h-9 gap-2" onClick={onShowActive}>
            <CalendarDays className="h-4 w-4" />
            Show active rows
          </Button>
        </div>
      </div>

      <div className="mt-3 grid gap-2 md:grid-cols-4">
        <ActivityUpdateImpactTile
          label="Update window"
          value={String(summary.updateWindowCount)}
          sub={`${summary.openTaskCount} open total`}
        />
        <ActivityUpdateImpactTile
          label="Ready"
          value={String(summary.readyTaskCount)}
          sub="status fields present"
          tone={summary.readyTaskCount > 0 ? "success" : "default"}
        />
        <ActivityUpdateImpactTile
          label="Need status"
          value={String(summary.needsStatusCount)}
          sub="update before snapshot"
          tone={summary.needsStatusCount > 0 ? "warning" : "success"}
        />
        <ActivityUpdateImpactTile
          label="Late rows"
          value={String(summary.lateCount)}
          sub="past data date"
          tone={summary.lateCount > 0 ? "danger" : "default"}
        />
      </div>

      <div className="mt-3 grid gap-2 rounded border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground lg:grid-cols-4">
        {[
          "1. Set the data date",
          "2. Open needs update",
          "3. Update actuals, current start, or expected finish",
          "4. Save the CPM update snapshot",
        ].map((step) => (
          <div key={step} className="min-w-0 font-semibold text-foreground">
            {step}
          </div>
        ))}
      </div>

      {summary.missingRemainingCount > 0 || summary.missingExpectedFinishCount > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {summary.missingRemainingCount > 0 && (
            <span className="rounded border border-warning/25 bg-warning/10 px-2 py-1 text-warning">
              {summary.missingRemainingCount} started{" "}
              {summary.missingRemainingCount === 1 ? "row" : "rows"} missing remaining duration
            </span>
          )}
          {summary.missingExpectedFinishCount > 0 && (
            <span className="rounded border border-danger/20 bg-danger/10 px-2 py-1 text-danger">
              {summary.missingExpectedFinishCount} missing expected finish
            </span>
          )}
        </div>
      ) : null}

      {visibleItems.length === 0 ? (
        <div className="mt-3 rounded border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          Open activities in the current update window have a status basis for this data date.
        </div>
      ) : (
        <div className="mt-3 grid gap-2">
          <div className="rounded border border-hairline bg-card px-3 py-2 text-xs text-muted-foreground">
            Work this queue row by row. Each saved activity updates the CPM forecast basis, then the
            data-date snapshot can be saved with a defensible status record.
          </div>
          {visibleItems.map((item) => (
            <div
              key={item.task.activity.id}
              className={cn(
                "grid gap-3 rounded border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                item.severity === "danger"
                  ? "border-danger/20 bg-danger/10"
                  : "border-warning/25 bg-warning/10",
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold tabular text-foreground">
                    {item.task.dependencyKey}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {item.task.activity.name}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      item.severity === "danger"
                        ? "bg-danger/15 text-danger"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    {item.reasons[0]}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatUpdateReadinessQueueLine(item)}
                </div>
                {item.reasons.length > 1 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Also: {item.reasons.slice(1).join(", ")}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 justify-self-start px-3 text-xs sm:justify-self-end"
                onClick={() => onOpenActivity(item.task.activity)}
              >
                Open
              </Button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-muted-foreground">
              {hiddenCount} more {hiddenCount === 1 ? "row" : "rows"} need status.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ScheduleQualityQueue({
  items,
  onShowIssues,
  onOpenActivity,
}: {
  items: ScheduleQualityQueueItem[];
  onShowIssues: () => void;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
}) {
  const visibleItems = items.slice(0, 6);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="mt-3.5 rounded-[10px] border border-hairline bg-background p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
            <AlertTriangle className="h-3.5 w-3.5" />
            Schedule quality queue
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Rows that need cleanup before the CPM path should be trusted.
          </div>
        </div>
        <Button type="button" variant="outline" className="h-9 gap-2" onClick={onShowIssues}>
          <AlertTriangle className="h-4 w-4" />
          Show issue rows
        </Button>
      </div>

      {items.length === 0 ? (
        <div className="mt-3 rounded border border-success/25 bg-success/10 px-3 py-2 text-sm text-success">
          No blocking schedule quality items detected.
        </div>
      ) : (
        <div className="mt-3 grid gap-2 xl:grid-cols-2">
          {visibleItems.map((item) => (
            <div
              key={item.task.activity.id}
              className={cn(
                "grid min-w-0 gap-3 rounded border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center",
                item.severity === "danger"
                  ? "border-danger/20 bg-danger/10"
                  : "border-warning/25 bg-warning/10",
              )}
            >
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <span className="font-semibold tabular text-foreground">
                    {item.task.dependencyKey}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">
                    {item.task.activity.name}
                  </span>
                  <span
                    className={cn(
                      "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      item.severity === "danger"
                        ? "bg-danger/15 text-danger"
                        : "bg-warning/15 text-warning",
                    )}
                  >
                    {item.reasons[0]}
                  </span>
                </div>
                <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                  {item.guidance}
                </div>
                {item.reasons.length > 1 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    Also: {item.reasons.slice(1).join(", ")}
                  </div>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-8 justify-self-start px-3 text-xs sm:justify-self-end"
                onClick={() => onOpenActivity(item.task.activity)}
              >
                Open
              </Button>
            </div>
          ))}
          {hiddenCount > 0 && (
            <div className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-muted-foreground">
              {hiddenCount} more {hiddenCount === 1 ? "item" : "items"} in the issue view.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
