import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { GitBranch, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleActivityRow, type ScheduleDelayFragmentRow } from "@/lib/schedule.functions";
import { offsetFromTimelineStart, type ConstructLineCpmModel } from "@/lib/constructline-cpm";
import { getImmediateChildWbsTitle, getWbsDisplayMeta } from "@/lib/constructline-wbs";
import {
  CONSTRUCTLINE_FIT_DAY_PX,
  CONSTRUCTLINE_FOCUS_MATRIX_STICKY_TOP,
  CONSTRUCTLINE_MAX_DAY_PX,
  CONSTRUCTLINE_MIN_DAY_PX,
  CONSTRUCTLINE_PRINT_TABLE_WIDTH,
  CONSTRUCTLINE_PRINT_TIMELINE_WIDTH,
  CONSTRUCTLINE_TABLE_COLUMN_SPECS,
  CONSTRUCTLINE_TABLE_PRINT_COLUMNS,
  type ConstructLineGridLayoutPreset,
  type ConstructLineTableColumnId,
  type ConstructLineTableColumnWidths,
  clampNumber,
  shortDate,
} from "./scheduleShared";
import {
  getDelayFragmentsForActivity,
  groupDelayFragmentsByActivity,
  isOpenDelayFragment,
} from "./scheduleUpdateDraft";
import {
  buildDefaultTableColumnWidths,
  buildTableColumnTemplate,
  buildTableColumnWidthsForPreset,
  getTableColumnMaxWidth,
  getTableColumnMinWidth,
  getTableColumnWidth,
  readTableColumnWidths,
  resizeTableColumnWidthsToTarget,
  writeTableColumnWidths,
} from "./scheduleGridLayout";
import {
  buildActivityMatrixRows,
  buildConstructLineMonthBands,
  getActivityMatrixTaskRowHeight,
  getLogicLineEndpointOffsets,
} from "./scheduleGridModel";
import {
  ConstructLineLogicOverlay,
  ConstructLineTaskRow,
  CpmNetworkBasisStrip,
} from "./ScheduleGridRows";

function MatrixHeaderCell({
  children,
  align = "center",
  title,
  onResizeStart,
}: {
  children: ReactNode;
  align?: "left" | "center" | "right";
  title?: string;
  onResizeStart?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 select-none items-center border-l border-hairline/70 px-1.5 pr-3 leading-tight",
        align === "left"
          ? "justify-start text-left first:border-l-0"
          : align === "right"
            ? "justify-end text-right"
            : "justify-center text-center",
      )}
      title={title}
    >
      <span className="min-w-0 whitespace-normal break-words">{children}</span>
      {onResizeStart && (
        <button
          type="button"
          aria-label="Resize column"
          className="group absolute inset-y-0 right-0 z-10 flex w-4 translate-x-1 cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
          onPointerDown={onResizeStart}
        >
          <span className="h-7 w-1 rounded-full bg-foreground/25 transition-colors group-hover:bg-foreground/70" />
        </button>
      )}
    </div>
  );
}

export function ActivityScheduleMatrix({
  matrixId,
  model,
  delayFragments,
  layoutStorageKey,
  toolbar,
  draftEditor,
  viewSummary,
  emptyTitle = "No CPM activities yet.",
  emptyDescription = "Add the first activity to start building the working schedule.",
  dayPx,
  dataDate,
  showLogicLines = false,
  showBaselineBars = true,
  isDenseHeader = false,
  isFocusMode = false,
  isPrintMode = false,
  onDayPxChange,
  onOpenActivity,
  onDeleteActivity,
}: {
  matrixId?: string;
  model: ConstructLineCpmModel;
  delayFragments: ScheduleDelayFragmentRow[];
  layoutStorageKey?: string;
  toolbar?: ReactNode;
  draftEditor?: ReactNode;
  viewSummary?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  dayPx: number;
  dataDate: string | null;
  showLogicLines?: boolean;
  showBaselineBars?: boolean;
  isDenseHeader?: boolean;
  isFocusMode?: boolean;
  isPrintMode?: boolean;
  onDayPxChange?: (dayPx: number) => void;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = model.tasks.length;
  const isFitZoom = !isPrintMode && dayPx === CONSTRUCTLINE_FIT_DAY_PX;
  const useDenseHeader = isFocusMode || isDenseHeader;
  const matrixScrollRef = useRef<HTMLDivElement | null>(null);
  const lastLayoutStorageKeyRef = useRef(layoutStorageKey);
  const pendingLayoutStorageKeyRef = useRef<string | undefined>(undefined);
  const [matrixViewportWidth, setMatrixViewportWidth] = useState(0);
  const [columnWidths, setColumnWidths] = useState<ConstructLineTableColumnWidths>(() =>
    readTableColumnWidths(layoutStorageKey, isFocusMode),
  );
  const measuredMatrixWidth =
    matrixViewportWidth > 0 ? matrixViewportWidth : isFocusMode ? 1320 : 1180;
  const tableWidth = isPrintMode
    ? CONSTRUCTLINE_PRINT_TABLE_WIDTH
    : getTableColumnWidth(columnWidths);
  const activityColumnWidth = isPrintMode ? 130 : columnWidths.activity;
  const fitTimelineTargetWidth =
    matrixViewportWidth > 0
      ? Math.max(isFocusMode ? 520 : 480, measuredMatrixWidth - tableWidth - 1)
      : isFocusMode
        ? 760
        : 560;
  const printDayPx = CONSTRUCTLINE_PRINT_TIMELINE_WIDTH / Math.max(1, model.totalTimelineDays);
  const fitDayPx = Math.max(
    CONSTRUCTLINE_MIN_DAY_PX,
    fitTimelineTargetWidth / Math.max(1, model.totalTimelineDays),
  );
  const activeDayPx = isPrintMode
    ? printDayPx
    : isFitZoom
      ? fitDayPx
      : clampNumber(dayPx, CONSTRUCTLINE_MIN_DAY_PX, CONSTRUCTLINE_MAX_DAY_PX);
  const tableColumns = isPrintMode
    ? CONSTRUCTLINE_TABLE_PRINT_COLUMNS
    : buildTableColumnTemplate(columnWidths);
  const baseRowHeight = isPrintMode ? 31 : 72;
  const groupHeight = isPrintMode ? 16 : 32;
  const headerHeight = isPrintMode ? 30 : 44;
  const timelineWidth = isPrintMode
    ? CONSTRUCTLINE_PRINT_TIMELINE_WIDTH
    : isFitZoom
      ? Math.max(fitTimelineTargetWidth, Math.ceil(model.totalTimelineDays * activeDayPx))
      : Math.max(720, model.totalTimelineDays * activeDayPx);
  useEffect(() => {
    if (isPrintMode || model.groups.length === 0 || typeof ResizeObserver === "undefined") return;
    const element = matrixScrollRef.current;
    if (!element) return;

    const updateWidth = () => setMatrixViewportWidth(Math.round(element.clientWidth));
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);
    return () => observer.disconnect();
  }, [isPrintMode, model.groups.length]);
  useEffect(() => {
    if (isPrintMode || lastLayoutStorageKeyRef.current === layoutStorageKey) return;
    pendingLayoutStorageKeyRef.current = layoutStorageKey;
    setColumnWidths(readTableColumnWidths(layoutStorageKey, isFocusMode));
  }, [isFocusMode, isPrintMode, layoutStorageKey]);
  useEffect(() => {
    if (isPrintMode) return;
    if (pendingLayoutStorageKeyRef.current === layoutStorageKey) {
      pendingLayoutStorageKeyRef.current = undefined;
      lastLayoutStorageKeyRef.current = layoutStorageKey;
      return;
    }
    lastLayoutStorageKeyRef.current = layoutStorageKey;
    writeTableColumnWidths(layoutStorageKey, columnWidths);
  }, [columnWidths, isPrintMode, layoutStorageKey]);
  const startColumnResize = useCallback(
    (columnId: ConstructLineTableColumnId, event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isPrintMode || typeof window === "undefined") return;
      const spec = CONSTRUCTLINE_TABLE_COLUMN_SPECS.find((column) => column.id === columnId);
      if (!spec) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidth = columnWidths[columnId];
      const originalCursor = document.body.style.cursor;
      const originalSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = clampNumber(startWidth + moveEvent.clientX - startX, spec.min, spec.max);
        setColumnWidths((current) => ({ ...current, [columnId]: Math.round(nextWidth) }));
      };
      const onPointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [columnWidths, isPrintMode],
  );
  const startTableSplitResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (isPrintMode || typeof window === "undefined") return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidths = { ...columnWidths };
      const startTableWidth = getTableColumnWidth(startWidths);
      const minTimelineWidth = isFocusMode ? 520 : 480;
      const maxTableWidthForViewport =
        matrixViewportWidth > 0
          ? Math.max(
              getTableColumnMinWidth(),
              Math.min(getTableColumnMaxWidth(), measuredMatrixWidth - minTimelineWidth),
            )
          : getTableColumnMaxWidth();
      const originalCursor = document.body.style.cursor;
      const originalSelect = document.body.style.userSelect;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const targetTableWidth = clampNumber(
          startTableWidth + moveEvent.clientX - startX,
          getTableColumnMinWidth(),
          maxTableWidthForViewport,
        );
        setColumnWidths(resizeTableColumnWidthsToTarget(startWidths, targetTableWidth));
      };
      const onPointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [columnWidths, isFocusMode, isPrintMode, matrixViewportWidth, measuredMatrixWidth],
  );
  const startTimelineScaleDrag = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (isPrintMode || !onDayPxChange || typeof window === "undefined") return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startDayPx = activeDayPx;
      const originalCursor = document.body.style.cursor;
      const originalSelect = document.body.style.userSelect;
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";

      const onPointerMove = (moveEvent: PointerEvent) => {
        const nextDayPx = clampNumber(
          startDayPx + (moveEvent.clientX - startX) / 28,
          CONSTRUCTLINE_MIN_DAY_PX,
          CONSTRUCTLINE_MAX_DAY_PX,
        );
        onDayPxChange(Number(nextDayPx.toFixed(2)));
      };
      const onPointerUp = () => {
        document.body.style.cursor = originalCursor;
        document.body.style.userSelect = originalSelect;
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
      };

      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
      window.addEventListener("pointercancel", onPointerUp);
    },
    [activeDayPx, isPrintMode, onDayPxChange],
  );
  const resetGridLayout = useCallback(() => {
    if (isPrintMode) return;
    const defaultWidths = buildDefaultTableColumnWidths(isFocusMode);
    setColumnWidths(defaultWidths);
    if (onDayPxChange) onDayPxChange(CONSTRUCTLINE_FIT_DAY_PX);
    writeTableColumnWidths(layoutStorageKey, defaultWidths);
  }, [isFocusMode, isPrintMode, layoutStorageKey, onDayPxChange]);
  const applyGridLayoutPreset = useCallback(
    (preset: ConstructLineGridLayoutPreset) => {
      if (isPrintMode) return;
      const presetWidths = buildTableColumnWidthsForPreset(preset);
      setColumnWidths(presetWidths);
      if (onDayPxChange) onDayPxChange(CONSTRUCTLINE_FIT_DAY_PX);
      writeTableColumnWidths(layoutStorageKey, presetWidths);
    },
    [isPrintMode, layoutStorageKey, onDayPxChange],
  );
  const monthBands = buildConstructLineMonthBands(
    model.timelineStartDate,
    model.totalTimelineDays,
    activeDayPx,
  );
  const dataDateX =
    dataDate == null
      ? null
      : offsetFromTimelineStart(dataDate, model.timelineStartDate) * activeDayPx;
  const delayFragmentsByActivity = useMemo(
    () => groupDelayFragmentsByActivity(delayFragments),
    [delayFragments],
  );
  const activeDelayFragmentCount = delayFragments.filter(isOpenDelayFragment).length;
  const rows = useMemo(() => buildActivityMatrixRows(model.groups), [model.groups]);
  const { bodyHeight, rowPositions } = useMemo(() => {
    const positions = new Map<string, number>();
    let height = 0;
    for (const row of rows) {
      if (row.kind === "parent" || row.kind === "group") {
        height += groupHeight;
      } else {
        const taskRowHeight = getActivityMatrixTaskRowHeight(
          row.task,
          isPrintMode,
          delayFragmentsByActivity,
          activityColumnWidth,
        );
        positions.set(row.task.activityKey, height + taskRowHeight / 2);
        height += taskRowHeight;
      }
    }
    return { bodyHeight: height, rowPositions: positions };
  }, [activityColumnWidth, delayFragmentsByActivity, groupHeight, isPrintMode, rows]);
  const taskByKey = useMemo(
    () => new Map(model.tasks.map((task) => [task.activityKey, task])),
    [model.tasks],
  );
  const logicLines = useMemo(() => {
    if (!showLogicLines) return [];
    return model.tasks.flatMap((task) =>
      task.predecessorLinks.flatMap((link) => {
        const predecessor = taskByKey.get(link.predecessorKey);
        const fromY = predecessor ? rowPositions.get(predecessor.activityKey) : null;
        const toY = rowPositions.get(task.activityKey);
        if (!predecessor || fromY == null || toY == null) return [];
        const { fromOffset, toOffset } = getLogicLineEndpointOffsets(
          predecessor,
          task,
          link.relationshipType,
          model.timelineStartDate,
        );
        const fromX = fromOffset * activeDayPx;
        const toX = toOffset * activeDayPx;
        return [
          {
            id: `${predecessor.activityKey}->${task.activityKey}-${link.relationshipType}-${link.lagDays}`,
            fromX,
            fromY,
            toX,
            toY,
            isCritical: predecessor.isCritical && task.isCritical,
            isOutOfSequence: toX < fromX,
          },
        ];
      }),
    );
  }, [activeDayPx, model.tasks, model.timelineStartDate, rowPositions, showLogicLines, taskByKey]);

  return (
    <div
      id={matrixId}
      className={cn(
        "constructline-cpm-matrix scroll-mt-24 min-w-0 overflow-hidden rounded-md border border-hairline bg-card",
        isPrintMode && "constructline-cpm-matrix-print",
        isFocusMode ? "mt-0 flex min-h-0 flex-1 flex-col" : isPrintMode ? "mt-0" : "mt-2",
      )}
    >
      <div
        className={cn(
          "constructline-cpm-matrix-head flex flex-col border-b border-hairline bg-card",
          useDenseHeader ? "gap-1 px-2 py-1.5" : "gap-2 px-3 py-2",
        )}
      >
        <div
          className={cn(
            "flex flex-col xl:flex-row xl:justify-between",
            useDenseHeader ? "gap-1 xl:items-center" : "gap-2 xl:items-start",
          )}
        >
          <div
            className={cn(
              "constructline-cpm-matrix-title",
              isFocusMode && "sr-only",
              useDenseHeader && !isFocusMode && "min-w-0",
            )}
          >
            {useDenseHeader && !isFocusMode ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  ConstructLine CPM grid
                </span>
                <span className="font-serif text-base text-foreground">Activity table + Gantt</span>
                <span className="text-xs text-muted-foreground">
                  {shortDate(model.timelineStartDate)} to {shortDate(model.timelineFinishDate)}
                </span>
                {viewSummary && (
                  <span className="text-xs font-semibold text-foreground">{viewSummary}</span>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  ConstructLine CPM grid
                </div>
                <div className="mt-0.5 font-serif text-lg text-foreground">
                  Activity table + Gantt
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {shortDate(model.timelineStartDate)} to {shortDate(model.timelineFinishDate)}
                </div>
                {viewSummary && (
                  <div className="mt-1 text-xs font-semibold text-foreground">{viewSummary}</div>
                )}
              </>
            )}
          </div>
          <div
            className={cn(
              "flex min-w-0 flex-1 flex-col xl:items-end",
              useDenseHeader ? "gap-1" : "gap-2",
            )}
          >
            <div
              className={cn(
                "constructline-cpm-matrix-legend flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground xl:justify-end",
                useDenseHeader ? "text-[11px]" : "text-[12px]",
              )}
            >
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-5 rounded-full bg-danger" />
                Critical
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-5 rounded-full bg-warning" />
                Near critical
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-5 rounded-full bg-success" />
                Complete
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-2.5 rotate-45 rounded-[1px] border border-foreground/45 bg-card" />
                Milestone
              </span>
              {showBaselineBars && (
                <span className="inline-flex items-center gap-1">
                  <span className="constructline-baseline-legend-swatch h-1.5 w-8 rounded-full bg-foreground/35" />
                  Baseline
                </span>
              )}
              {activeDelayFragmentCount > 0 && (
                <span className="inline-flex items-center gap-1">
                  <span className="constructline-delay-legend-swatch h-3 w-8 rounded-full border border-danger/40" />
                  Delay period
                </span>
              )}
              <span className="font-semibold tabular text-foreground">
                {totalActivities} {totalActivities === 1 ? "activity" : "activities"}
              </span>
              {showLogicLines && (
                <span className="inline-flex items-center gap-1 font-semibold text-foreground">
                  <GitBranch className="h-3.5 w-3.5" />
                  {logicLines.length} ties drawn in view
                </span>
              )}
              {!isPrintMode && (
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => applyGridLayoutPreset("gantt")}
                  >
                    Gantt first
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => applyGridLayoutPreset("balanced")}
                  >
                    Balanced
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => applyGridLayoutPreset("detail")}
                  >
                    Details
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-[11px]"
                    onClick={resetGridLayout}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Reset grid
                  </Button>
                </div>
              )}
            </div>
            <div className="flex flex-wrap justify-start gap-1 xl:justify-end">
              <CpmNetworkBasisStrip model={model} dataDate={dataDate} />
            </div>
          </div>
        </div>
        {toolbar && <div className="constructline-cpm-matrix-toolbar print:hidden">{toolbar}</div>}
        {draftEditor && (
          <div className="constructline-cpm-matrix-editor print:hidden">{draftEditor}</div>
        )}
      </div>

      {model.groups.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="font-serif text-xl text-foreground">{emptyTitle}</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">{emptyDescription}</p>
        </div>
      ) : (
        <div
          ref={matrixScrollRef}
          className={cn(
            "constructline-cpm-matrix-scroll bg-card",
            isPrintMode
              ? "overflow-visible"
              : "overflow-auto overscroll-contain print:max-h-none print:overflow-visible",
            isFocusMode
              ? "min-h-0 flex-1"
              : isPrintMode
                ? ""
                : isDenseHeader
                  ? "max-h-[clamp(640px,calc(100vh-205px),1120px)]"
                  : "max-h-[clamp(520px,calc(100vh-260px),900px)]",
          )}
        >
          <div
            className="constructline-cpm-matrix-inner relative min-h-full"
            style={{ width: tableWidth + timelineWidth, minWidth: "100%" }}
          >
            <div
              className={cn(
                "flex border-b border-hairline bg-card text-[9px] font-semibold uppercase tracking-normal text-muted-foreground shadow-sm",
                isFocusMode ? "sticky z-20" : "relative z-0",
              )}
              style={{
                height: headerHeight,
                top: isFocusMode ? CONSTRUCTLINE_FOCUS_MATRIX_STICKY_TOP : undefined,
              }}
            >
              <div
                className="sticky left-0 z-30 grid shrink-0 border-r border-hairline bg-card"
                style={{ width: tableWidth, gridTemplateColumns: tableColumns }}
              >
                {CONSTRUCTLINE_TABLE_COLUMN_SPECS.map((column) => (
                  <MatrixHeaderCell
                    key={column.id}
                    align={"align" in column && column.align === "left" ? "left" : "center"}
                    title={column.label}
                    onResizeStart={
                      isPrintMode ? undefined : (event) => startColumnResize(column.id, event)
                    }
                  >
                    {column.compactLabel}
                  </MatrixHeaderCell>
                ))}
              </div>
              <div
                className={cn(
                  "relative shrink-0 bg-card",
                  !isPrintMode && "cursor-grab select-none active:cursor-grabbing",
                )}
                style={{ width: timelineWidth }}
                title="Drag left or right to compress or expand the Gantt timeline."
                onPointerDown={startTimelineScaleDrag}
              >
                {monthBands.map((band) => (
                  <div
                    key={`${band.label}-${band.x}`}
                    className="absolute inset-y-0 border-l border-hairline/80 px-2"
                    title={band.label}
                    style={{ left: band.x, width: band.width }}
                  >
                    <div className="flex h-full items-center text-muted-foreground">
                      {band.width >= 46 ? band.label : ""}
                    </div>
                  </div>
                ))}
                {dataDateX != null && (
                  <>
                    <div
                      className="absolute inset-y-0 z-10 w-px bg-foreground/50"
                      style={{ left: dataDateX }}
                    />
                    <div
                      className="absolute top-1 z-20 -translate-x-1/2 whitespace-nowrap rounded-sm bg-foreground px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.1em] text-background"
                      style={{ left: dataDateX }}
                    >
                      Data date
                    </div>
                  </>
                )}
              </div>
            </div>

            {!isPrintMode && (
              <button
                type="button"
                aria-label="Resize activity table and Gantt split"
                title="Drag to give more space to the activity table or Gantt chart"
                className="group absolute z-30 flex w-4 -translate-x-1/2 cursor-col-resize items-start justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground"
                style={{ left: tableWidth, top: headerHeight, height: bodyHeight }}
                onPointerDown={startTableSplitResize}
              >
                <span className="mt-2 h-[calc(100%-16px)] w-1 rounded-full bg-foreground/20 transition-colors group-hover:bg-foreground/65" />
              </button>
            )}

            {rows.map((row) => {
              if (row.kind === "parent") {
                const groupMeta = getWbsDisplayMeta(row.division);
                const groupStart = Math.min(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualStartDate, model.timelineStartDate),
                  ),
                );
                const groupFinish = Math.max(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualFinishDate, model.timelineStartDate),
                  ),
                );
                const childCount = new Set(
                  row.tasks
                    .map((task) => getImmediateChildWbsTitle(row.division, task.activity.division))
                    .filter(Boolean),
                ).size;
                return (
                  <div
                    key={`parent-${row.division}`}
                    className="flex border-b border-hairline bg-foreground/[0.045]"
                    style={{ height: groupHeight }}
                  >
                    <div
                      className="sticky left-0 z-20 flex shrink-0 items-center border-r border-hairline bg-muted/75 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-foreground"
                      style={{ width: tableWidth }}
                    >
                      <div
                        className="min-w-0"
                        style={{ paddingLeft: `${Math.min(groupMeta.level, 4) * 14}px` }}
                      >
                        <div className="truncate">
                          {groupMeta.title} · {childCount} child{" "}
                          {childCount === 1 ? "area" : "areas"} · {row.tasks.length} activities
                        </div>
                      </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: timelineWidth }}>
                      <div
                        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-foreground/45"
                        style={{
                          left: groupStart * activeDayPx,
                          width: Math.max(8, (groupFinish - groupStart + 1) * activeDayPx),
                        }}
                      />
                    </div>
                  </div>
                );
              }

              if (row.kind === "group") {
                const groupMeta = getWbsDisplayMeta(row.division);
                const groupStart = Math.min(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualStartDate, model.timelineStartDate),
                  ),
                );
                const groupFinish = Math.max(
                  ...row.tasks.map((task) =>
                    offsetFromTimelineStart(task.visualFinishDate, model.timelineStartDate),
                  ),
                );
                return (
                  <div
                    key={`group-${row.division}`}
                    className="flex border-b border-hairline bg-muted/35"
                    style={{ height: groupHeight }}
                  >
                    <div
                      className="sticky left-0 z-20 flex shrink-0 items-center border-r border-hairline bg-muted/55 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
                      style={{ width: tableWidth }}
                    >
                      <div
                        className="min-w-0"
                        style={{ paddingLeft: `${Math.min(groupMeta.level, 4) * 14}px` }}
                      >
                        {groupMeta.parentPath && (
                          <div className="truncate normal-case tracking-normal text-muted-foreground/80">
                            {groupMeta.parentPath}
                          </div>
                        )}
                        <div className="truncate">
                          {groupMeta.title} · {row.tasks.length} activities
                        </div>
                      </div>
                    </div>
                    <div className="relative shrink-0" style={{ width: timelineWidth }}>
                      <div
                        className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-foreground/35"
                        style={{
                          left: groupStart * activeDayPx,
                          width: Math.max(8, (groupFinish - groupStart + 1) * activeDayPx),
                        }}
                      />
                    </div>
                  </div>
                );
              }

              const taskRowHeight = getActivityMatrixTaskRowHeight(
                row.task,
                isPrintMode,
                delayFragmentsByActivity,
                activityColumnWidth,
              );
              return (
                <ConstructLineTaskRow
                  key={row.task.activity.id}
                  task={row.task}
                  rowHeight={Math.max(baseRowHeight, taskRowHeight)}
                  tableWidth={tableWidth}
                  tableColumns={tableColumns}
                  timelineWidth={timelineWidth}
                  timelineStartDate={model.timelineStartDate}
                  dayPx={activeDayPx}
                  isPrintMode={isPrintMode}
                  showBaselineBars={showBaselineBars}
                  monthBands={monthBands}
                  dataDateX={dataDateX}
                  delayFragments={getDelayFragmentsForActivity(
                    row.task.activity,
                    delayFragmentsByActivity,
                  )}
                  onOpen={() => onOpenActivity(row.task.activity)}
                  onDelete={() => onDeleteActivity(row.task.activity.id)}
                />
              );
            })}
            {showLogicLines && (
              <ConstructLineLogicOverlay
                lines={logicLines}
                tableWidth={tableWidth}
                timelineWidth={timelineWidth}
                headerHeight={headerHeight}
                bodyHeight={bodyHeight}
              />
            )}
          </div>
        </div>
      )}

      <div className="flex justify-between border-t border-hairline px-4 py-2 text-[11px] text-muted-foreground">
        <span>{shortDate(model.timelineStartDate)}</span>
        <span>{shortDate(model.timelineFinishDate)}</span>
      </div>
    </div>
  );
}
