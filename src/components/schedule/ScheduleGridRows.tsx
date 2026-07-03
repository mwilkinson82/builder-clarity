import { type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import {
  offsetFromTimelineStart,
  type ConstructLineCpmModel,
  type ConstructLineCpmTask,
} from "@/lib/constructline-cpm";
import { formatFinishVarianceDays, shortDate, shortPrintDate } from "./scheduleShared";
import { buildDelayFragmentSummary } from "./scheduleUpdateDraft";
import {
  hasScheduleActivityStarted,
  shouldFlagMissingActualStart,
  shouldFlagMissingExpectedFinish,
  shouldFlagMissingRemainingDuration,
} from "./scheduleUpdateReadiness";
import {
  buildConstructLineMonthBands,
  formatTaskStatusBasisLabel,
  formatTaskStatusBasisTitle,
  getDelayPeriodLabel,
  getTaskFinishVarianceDays,
  getTaskStatusBasisClass,
} from "./scheduleGridModel";

export function CpmNetworkBasisStrip({
  model,
  dataDate,
}: {
  model: ConstructLineCpmModel;
  dataDate: string | null;
}) {
  const openStartTasks = model.tasks.filter((task) => task.isOpenStart);
  const openFinishTasks = model.tasks.filter((task) => task.isOpenFinish);
  const negativeFloatCount = model.tasks.filter((task) => task.totalFloat < 0).length;
  const basisTone = model.criticalPathReliable ? "success" : "warning";
  // Honesty over optimism: a mostly-untied network (fresh import) never reads
  // Reliable, and says so in words a PM can act on.
  const basisValue = model.isSubstantiallyUntied
    ? "Untied — logic needed"
    : model.criticalPathReliable
      ? "Reliable"
      : "Provisional";
  return (
    <div className="constructline-cpm-basis-strip flex flex-wrap gap-1.5 text-[11px]">
      <CpmBasisPill
        label="CPM basis"
        value={basisValue}
        tone={basisTone}
        title={model.criticalPathReliabilityNote}
        icon={
          model.criticalPathReliable ? (
            <CheckCircle2 className="h-3.5 w-3.5" />
          ) : (
            <AlertTriangle className="h-3.5 w-3.5" />
          )
        }
      />
      <CpmBasisPill
        label="Open starts"
        value={String(model.openStartCount)}
        tone={model.openStartCount <= 1 ? "default" : "warning"}
        title={formatCpmEndpointTitle(openStartTasks, "open start")}
      />
      <CpmBasisPill
        label="Open finishes"
        value={String(model.openFinishCount)}
        tone={
          model.openFinishCount <= 1 && model.unanchoredOpenFinishCount === 0
            ? "default"
            : "warning"
        }
        title={formatCpmEndpointTitle(openFinishTasks, "open finish")}
      />
      <CpmBasisPill
        label="Finish anchor"
        value={model.unanchoredOpenFinishCount === 0 ? "Set" : "Needed"}
        tone={model.unanchoredOpenFinishCount === 0 ? "success" : "warning"}
        title={
          model.unanchoredOpenFinishCount === 0
            ? "The completion path terminates at a milestone."
            : "Tie the final open finish to a finish milestone before treating the critical path as reliable."
        }
      />
      <CpmBasisPill
        label="Critical / near"
        value={`${model.criticalCount}/${model.nearCriticalCount}`}
        tone={model.criticalCount > 0 ? "danger" : "default"}
      />
      <CpmBasisPill
        label="Negative float"
        value={String(negativeFloatCount)}
        tone={negativeFloatCount > 0 ? "danger" : "default"}
      />
      <CpmBasisPill
        label="Data date"
        value={dataDate ? shortDate(dataDate) : "Not set"}
        tone={dataDate ? "default" : "warning"}
      />
    </div>
  );
}

function CpmBasisPill({
  label,
  value,
  tone = "default",
  title,
  icon,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
  title?: string;
  icon?: ReactNode;
}) {
  const toneClass =
    tone === "success"
      ? "border-success/25 bg-success/10 text-success"
      : tone === "warning"
        ? "border-warning/25 bg-warning/10 text-warning"
        : tone === "danger"
          ? "border-danger/20 bg-danger/10 text-danger"
          : "border-hairline bg-surface text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold",
        toneClass,
      )}
      title={title}
    >
      {icon}
      <span className="uppercase tracking-normal">{label}</span>
      <span className="tabular text-foreground">{value}</span>
    </span>
  );
}

function formatCpmEndpointTitle(tasks: ConstructLineCpmTask[], label: string) {
  if (tasks.length === 0) return `No ${label} activities.`;
  return `${tasks.length} ${label} ${tasks.length === 1 ? "activity" : "activities"}: ${tasks
    .slice(0, 6)
    .map((task) => task.dependencyKey || task.activity.name)
    .join(", ")}${tasks.length > 6 ? ", ..." : ""}`;
}

export function ConstructLineLogicOverlay({
  lines,
  tableWidth,
  timelineWidth,
  headerHeight,
  bodyHeight,
}: {
  lines: Array<{
    id: string;
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
    isCritical: boolean;
    isOutOfSequence: boolean;
  }>;
  tableWidth: number;
  timelineWidth: number;
  headerHeight: number;
  bodyHeight: number;
}) {
  if (lines.length === 0) return null;

  return (
    <svg
      className="pointer-events-none absolute z-10 overflow-visible"
      style={{
        left: tableWidth,
        top: headerHeight,
        width: timelineWidth,
        height: bodyHeight,
      }}
      viewBox={`0 0 ${timelineWidth} ${bodyHeight}`}
      aria-hidden="true"
    >
      <defs>
        <marker
          id="constructline-logic-arrow"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#6f675c" />
        </marker>
        <marker
          id="constructline-logic-arrow-critical"
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="#d53c31" />
        </marker>
      </defs>
      {lines.map((line) => {
        const distance = line.toX - line.fromX;
        const bend = Math.max(24, Math.min(96, Math.abs(distance) / 2));
        const midX = distance >= 0 ? line.fromX + bend : line.fromX - bend;
        const stroke = line.isCritical ? "#d53c31" : line.isOutOfSequence ? "#c68a18" : "#6f675c";
        const opacity = line.isCritical ? 0.72 : line.isOutOfSequence ? 0.58 : 0.36;
        return (
          <path
            key={line.id}
            d={`M ${line.fromX} ${line.fromY} C ${midX} ${line.fromY}, ${midX} ${line.toY}, ${line.toX} ${line.toY}`}
            fill="none"
            stroke={stroke}
            strokeWidth={line.isCritical ? 1.8 : 1.25}
            strokeDasharray={line.isOutOfSequence ? "5 4" : undefined}
            opacity={opacity}
            markerEnd={`url(#${
              line.isCritical ? "constructline-logic-arrow-critical" : "constructline-logic-arrow"
            })`}
          />
        );
      })}
    </svg>
  );
}

export function ConstructLineTaskRow({
  task,
  delayFragments,
  rowHeight,
  tableWidth,
  tableColumns,
  timelineWidth,
  timelineStartDate,
  dayPx,
  isPrintMode,
  showBaselineBars,
  monthBands,
  dataDateX,
  onOpen,
  onDelete,
}: {
  task: ConstructLineCpmTask;
  delayFragments: ScheduleDelayFragmentRow[];
  rowHeight: number;
  tableWidth: number;
  tableColumns: string;
  timelineWidth: number;
  timelineStartDate: string;
  dayPx: number;
  isPrintMode: boolean;
  showBaselineBars: boolean;
  monthBands: ReturnType<typeof buildConstructLineMonthBands>;
  dataDateX: number | null;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const activity = task.activity;
  const percent = Math.max(0, Math.min(100, activity.percent_complete));
  const needsRemainingDuration = shouldFlagMissingRemainingDuration(activity);
  const needsExpectedFinish = shouldFlagMissingExpectedFinish(activity);
  const needsActualStart = shouldFlagMissingActualStart(activity);
  const startOffset = offsetFromTimelineStart(task.visualStartDate, timelineStartDate);
  const finishOffset = offsetFromTimelineStart(task.visualFinishDate, timelineStartDate);
  const baselineStartOffset = offsetFromTimelineStart(task.baselineStartDate, timelineStartDate);
  const baselineFinishOffset = offsetFromTimelineStart(task.baselineFinishDate, timelineStartDate);
  const barLeft = startOffset * dayPx;
  const barWidth = Math.max(8, (finishOffset - startOffset + 1) * dayPx);
  const baselineLeft = baselineStartOffset * dayPx;
  const baselineWidth = Math.max(8, (baselineFinishOffset - baselineStartOffset + 1) * dayPx);
  const baselineTop = Math.max(4, rowHeight / 2 - (isPrintMode ? 9 : 19));
  const logicCount = task.predecessorKeys.length + task.successorKeys.length;
  const delaySummary = buildDelayFragmentSummary(delayFragments);
  const hasOpenDelay = delaySummary.openCount > 0;
  const carriedDelayDays =
    hasOpenDelay && !task.isMilestone
      ? Math.max(0, Math.min(delaySummary.openDays, task.slippageDays))
      : 0;
  const uncarriedDelayDays =
    hasOpenDelay && !task.isMilestone ? Math.max(0, delaySummary.openDays - carriedDelayDays) : 0;
  const delayMarkerLeft = Math.min(
    timelineWidth - 10,
    Math.max(10, barLeft + Math.min(barWidth, Math.max(12, delaySummary.openDays * dayPx))),
  );
  const embeddedDelayWidth =
    carriedDelayDays > 0 ? Math.max(6, Math.min(barWidth, carriedDelayDays * dayPx)) : 0;
  const embeddedDelayLeft = Math.max(barLeft, barLeft + barWidth - embeddedDelayWidth);
  const embeddedDelayLabel = getDelayPeriodLabel(carriedDelayDays, embeddedDelayWidth, isPrintMode);
  const delayExtensionLeft = barLeft + barWidth;
  const delayExtensionAvailableWidth = Math.max(0, timelineWidth - delayExtensionLeft);
  const delayExtensionWidth =
    uncarriedDelayDays > 0 && delayExtensionAvailableWidth > 0
      ? Math.max(6, Math.min(delayExtensionAvailableWidth, uncarriedDelayDays * dayPx))
      : 0;
  const delayExtensionLabel = getDelayPeriodLabel(
    uncarriedDelayDays,
    delayExtensionWidth,
    isPrintMode,
  );
  const visualDelayMarkerLeft =
    delayExtensionWidth > 0
      ? Math.min(timelineWidth - 8, Math.max(8, delayExtensionLeft))
      : embeddedDelayWidth > 0
        ? Math.min(timelineWidth - 8, Math.max(8, embeddedDelayLeft))
        : delayMarkerLeft;
  const finishVarianceDays = getTaskFinishVarianceDays(task);
  const finishVarianceLabel = formatFinishVarianceDays(finishVarianceDays);
  const finishVarianceClass =
    finishVarianceDays == null || finishVarianceDays === 0
      ? "text-muted-foreground"
      : finishVarianceDays > 0
        ? "text-danger"
        : "text-success";
  const barClass = task.isCritical
    ? "bg-danger"
    : task.isNearCritical
      ? "bg-warning"
      : percent >= 100
        ? "bg-success"
        : "bg-accent";
  const milestoneClass = task.isCritical
    ? "border-danger bg-danger"
    : task.isNearCritical
      ? "border-warning bg-warning"
      : percent >= 100
        ? "border-success bg-success"
        : "border-accent bg-card";

  return (
    <div
      className="flex border-b border-hairline bg-card hover:bg-muted/30"
      style={{ height: rowHeight }}
    >
      <div
        role="button"
        tabIndex={0}
        className="sticky left-0 z-20 grid shrink-0 cursor-pointer border-r border-hairline bg-card text-xs hover:bg-muted/45"
        style={{ width: tableWidth, gridTemplateColumns: tableColumns }}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        <div className="flex min-w-0 items-center justify-center px-2 text-center font-semibold leading-tight tabular text-foreground">
          {activity.activity_id || "No ID"}
        </div>
        <div className="flex min-w-0 flex-col justify-center px-3 text-left">
          <div className="constructline-task-name break-words text-sm font-semibold leading-snug text-foreground">
            {activity.name}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1">
            {task.isMilestone && <ScheduleFlag tone="warning">milestone</ScheduleFlag>}
            {task.isCritical && <ScheduleFlag tone="danger">critical</ScheduleFlag>}
            {task.isNearCritical && <ScheduleFlag tone="warning">near critical</ScheduleFlag>}
            {task.totalFloat < 0 && (
              <ScheduleFlag tone="danger">{task.totalFloat}d TF</ScheduleFlag>
            )}
            {task.isLate && <ScheduleFlag tone="danger">late</ScheduleFlag>}
            {task.isOutOfSequence && <ScheduleFlag tone="warning">out of seq</ScheduleFlag>}
            {task.isOpenStart && <ScheduleFlag tone="warning">open start</ScheduleFlag>}
            {task.isOpenFinish && <ScheduleFlag tone="warning">open finish</ScheduleFlag>}
            {task.hasMissingDates && <ScheduleFlag tone="warning">missing dates</ScheduleFlag>}
            {task.statusBasis === "needs_update" && (
              <ScheduleFlag tone="danger">needs update</ScheduleFlag>
            )}
            {needsRemainingDuration && <ScheduleFlag tone="warning">needs remaining</ScheduleFlag>}
            {needsExpectedFinish && <ScheduleFlag tone="danger">needs finish</ScheduleFlag>}
            {needsActualStart && <ScheduleFlag tone="warning">needs actual start</ScheduleFlag>}
            {task.slippageDays > 0 && (
              <ScheduleFlag tone="danger">+{task.slippageDays}d slip</ScheduleFlag>
            )}
            {hasOpenDelay && (
              <ScheduleFlag tone="danger">{delaySummary.openDays}d delay</ScheduleFlag>
            )}
          </div>
        </div>
        <div
          className="flex min-w-0 flex-col items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] tabular text-muted-foreground"
          title="Original planned duration and remaining duration for the current update."
        >
          <span className="font-semibold text-foreground">
            {task.isMilestone ? "M" : `${task.durationDays}d`}
          </span>
          <span className="mt-0.5 max-w-full truncate text-[9px] uppercase tracking-[0.08em]">
            {task.isMilestone
              ? percent >= 100
                ? "met"
                : "point"
              : percent >= 100
                ? "done"
                : !hasScheduleActivityStarted(activity)
                  ? "not started"
                  : `${task.remainingDurationDays} rem`}
          </span>
        </div>
        <div
          className="flex min-w-0 flex-col items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] tabular text-muted-foreground"
          title="Original planned baseline start and baseline finish."
        >
          <span className="truncate">{shortPrintDate(task.baselineStartDate)}</span>
          <span className="mt-0.5 truncate">{shortPrintDate(task.baselineFinishDate)}</span>
        </div>
        <div
          className="flex min-w-0 flex-col items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] tabular text-muted-foreground"
          title={`Current start and expected finish. ${formatTaskStatusBasisTitle(task)}`}
        >
          <span className="truncate">{shortPrintDate(task.statusStartDate)}</span>
          <span className="truncate">{shortPrintDate(task.statusFinishDate)}</span>
          <span
            className={cn(
              "mt-0.5 max-w-full truncate text-[9px] font-semibold uppercase tracking-[0.08em]",
              getTaskStatusBasisClass(task),
            )}
          >
            {formatTaskStatusBasisLabel(task)}
          </span>
        </div>
        <div
          className={cn(
            "flex min-w-0 items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] font-semibold tabular",
            finishVarianceClass,
          )}
        >
          <span className="truncate">{finishVarianceLabel}</span>
        </div>
        <div className="flex min-w-0 items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] font-semibold tabular text-foreground">
          <span className="truncate">{percent}%</span>
        </div>
        <div
          className={cn(
            "flex min-w-0 items-center justify-center overflow-hidden border-l border-hairline/50 px-1.5 text-center text-[11px] font-semibold tabular",
            task.isCritical
              ? "text-danger"
              : task.isNearCritical
                ? "text-warning"
                : "text-muted-foreground",
          )}
        >
          <span className="truncate">{task.totalFloat}</span>
        </div>
        <div className="flex items-center justify-center gap-1 border-l border-hairline/50 px-1.5 text-center tabular text-muted-foreground">
          <span>{logicCount}</span>
          {!isPrintMode && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-danger"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              aria-label={`Delete activity ${activity.activity_id || activity.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        className="relative shrink-0 text-left"
        style={{ width: timelineWidth }}
        onClick={onOpen}
      >
        {monthBands.map((band) => (
          <div
            key={`${activity.id}-${band.label}-${band.x}`}
            className="absolute inset-y-0 border-l border-hairline/50"
            style={{ left: band.x }}
          />
        ))}
        {dataDateX != null && (
          <div
            className="absolute inset-y-0 z-10 w-px bg-foreground/35"
            style={{ left: dataDateX }}
          />
        )}
        {task.isMilestone ? (
          <>
            {showBaselineBars && (
              <div
                className="constructline-baseline-diamond absolute h-3 w-3 -translate-x-1/2 rotate-45 rounded-[1px] border border-foreground/35 bg-card"
                style={{ left: baselineLeft, top: baselineTop }}
                title={`Baseline milestone ${shortDate(task.baselineFinishDate)}`}
                aria-label={`Baseline milestone ${shortDate(task.baselineFinishDate)}`}
              />
            )}
            <div
              className={cn(
                "absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] border-2 shadow-sm",
                milestoneClass,
              )}
              style={{ left: barLeft }}
            />
          </>
        ) : (
          <>
            {showBaselineBars && (
              <div
                className="constructline-baseline-bar absolute h-1.5 rounded-full bg-foreground/35"
                style={{ left: baselineLeft, top: baselineTop, width: baselineWidth }}
                title={`Baseline ${shortDate(task.baselineStartDate)} to ${shortDate(task.baselineFinishDate)}`}
                aria-label={`Baseline ${shortDate(task.baselineStartDate)} to ${shortDate(task.baselineFinishDate)}`}
              />
            )}
            <div
              className={cn(
                "absolute top-1/2 h-4 -translate-y-1/2 rounded-full border",
                task.isCritical
                  ? "border-danger/40 bg-danger/20"
                  : task.isNearCritical
                    ? "border-warning/40 bg-warning/20"
                    : "border-accent/30 bg-accent/15",
              )}
              style={{ left: barLeft, width: barWidth }}
            >
              <div
                className={cn("h-full rounded-full", barClass)}
                style={{ width: `${percent}%` }}
              />
            </div>
            {embeddedDelayWidth > 0 && (
              <div
                className="constructline-delay-extension absolute top-1/2 flex h-4 -translate-y-1/2 items-center justify-center overflow-hidden rounded-full border border-danger/45 text-[9px] font-bold uppercase tracking-[0.08em] text-danger"
                style={{ left: embeddedDelayLeft, width: embeddedDelayWidth }}
                title={`${carriedDelayDays} delay days are carried inside the current expected finish`}
                aria-label={`${carriedDelayDays} day delay period carried in forecast`}
              >
                {embeddedDelayLabel && (
                  <span className="constructline-delay-label">{embeddedDelayLabel}</span>
                )}
              </div>
            )}
            {delayExtensionWidth > 0 && (
              <div
                className="constructline-delay-extension absolute top-1/2 flex h-4 -translate-y-1/2 items-center justify-center overflow-hidden rounded-r-full border border-danger/40 text-[9px] font-bold uppercase tracking-[0.08em] text-danger"
                style={{ left: delayExtensionLeft, width: delayExtensionWidth }}
                title={`${uncarriedDelayDays} delay days are not yet carried into the current expected finish`}
                aria-label={`${uncarriedDelayDays} day delay period not yet carried in forecast`}
              >
                {delayExtensionLabel && (
                  <span className="constructline-delay-label">{delayExtensionLabel}</span>
                )}
              </div>
            )}
          </>
        )}
        {hasOpenDelay && (
          <span
            className="constructline-delay-marker absolute top-1/2 z-20 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-danger bg-danger shadow-sm ring-4 ring-danger/15"
            style={{ left: visualDelayMarkerLeft }}
            title={`${delaySummary.openDays} open delay days on ${activity.activity_id || activity.name}`}
          />
        )}
      </button>
    </div>
  );
}

function ScheduleFlag({ children, tone }: { children: ReactNode; tone: "danger" | "warning" }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        tone === "danger"
          ? "border-danger/25 bg-danger/10 text-danger"
          : "border-warning/25 bg-warning/10 text-warning",
      )}
    >
      {children}
    </span>
  );
}

export function StackingMiniMap({ model }: { model: ConstructLineCpmModel }) {
  const max = Math.max(1, model.maxStack);
  const buckets = model.stackBuckets.slice(0, 18);
  if (buckets.length === 0) {
    return <div className="mt-4 text-sm text-muted-foreground">No dated activities to stack.</div>;
  }
  return (
    <div className="mt-4 flex h-24 items-end gap-1">
      {buckets.map((bucket) => (
        <div key={bucket.key} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className={cn(
              "w-full rounded-t",
              bucket.criticalCount > 0
                ? "bg-danger"
                : bucket.count >= 4
                  ? "bg-warning"
                  : "bg-accent",
            )}
            style={{ height: `${Math.max(10, (bucket.count / max) * 72)}px` }}
            title={`${bucket.label}: ${bucket.count} active`}
          />
          <div className="w-full truncate text-center text-[10px] text-muted-foreground">
            {bucket.label.replace(" wk", "")}
          </div>
        </div>
      ))}
    </div>
  );
}
