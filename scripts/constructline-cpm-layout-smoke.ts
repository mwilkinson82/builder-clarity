import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (filePath: string) => {
  const target = resolve(rootDir, filePath);
  if (!statSync(target).isDirectory()) return readFileSync(target, "utf8");
  return readdirSync(target)
    .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
    .sort()
    .map((entry) => readFileSync(resolve(target, entry), "utf8"))
    .join("\n");
};

const scheduleRiskSource = readProjectFile("src/components/schedule");
const scheduleRouteSource = readProjectFile(
  "src/routes/_authenticated/projects.$projectId.schedule.tsx",
);
const stylesSource = readProjectFile("src/styles.css");

function assertIncludes(source: string, text: string, message: string) {
  assert.ok(source.includes(text), message);
}

function assertMatches(source: string, pattern: RegExp, message: string) {
  assert.ok(pattern.test(source), message);
}

// Full-width workspace shell: CPM work should not be constrained by the project side rail.
for (const requiredRouteLayoutText of [
  "constructline-schedule-page min-h-screen overflow-x-clip",
  "max-w-[1840px]",
  'href="#cpm-grid" tone="primary"',
  "CPM table + Gantt",
  "constructline-workspace-status",
  '<WorkspaceNavLink href="#schedule-update-history">Updates</WorkspaceNavLink>',
  '<WorkspaceNavLink href="#interim-milestones">Milestones</WorkspaceNavLink>',
  '<WorkspaceNavLink href="#critical-delayed-decisions">Decisions</WorkspaceNavLink>',
  '<WorkspaceNavLink href="#procurement-risks">Procurement</WorkspaceNavLink>',
  '<WorkspaceNavLink href="#trade-performance-risks">Trades</WorkspaceNavLink>',
  "Print 11x17",
  "ScheduleWorkspaceOperations",
  "onSuccess: async",
  "await refreshSchedule();",
  "Activity updated",
  "The CPM row and logic ties were saved.",
]) {
  assertIncludes(
    scheduleRouteSource,
    requiredRouteLayoutText,
    `Schedule route missing full-workspace layout contract: ${requiredRouteLayoutText}`,
  );
}

// Matrix sizing and scrolling: the table and Gantt must share one horizontal and vertical scroll
// surface, with fit mode using the available viewport instead of leaving a clipped timeline.
for (const requiredMatrixLayoutText of [
  "constructline-cpm-matrix scroll-mt-24 min-w-0 overflow-hidden",
  "const matrixScrollRef = useRef<HTMLDivElement | null>(null);",
  "const [matrixViewportWidth, setMatrixViewportWidth] = useState(0);",
  "const [columnWidths, setColumnWidths] = useState<ConstructLineTableColumnWidths>",
  'const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION = "v7"',
  'const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_NAMESPACE = "constructline:cpm-grid-layout"',
  "const CONSTRUCTLINE_FOCUS_MATRIX_STICKY_TOP = 8",
  "CONSTRUCTLINE_TABLE_COLUMN_SPECS",
  'type ConstructLineGridLayoutPreset = "gantt" | "balanced" | "detail"',
  "buildTableColumnWidthsForPreset",
  "buildTableColumnTemplate(columnWidths)",
  "getTableColumnWidth(columnWidths)",
  "getCpmGridLayoutStorageKey",
  "getTableColumnLayoutStorageKeys",
  "readStoredGridLayoutRecord",
  "parseStoredTableColumnWidths",
  "readStoredGridDayPx",
  "writeStoredGridLayout",
  "writeStoredGridLayout(cpmGridLayoutStorageKey, { dayPx })",
  "readTableColumnWidths(layoutStorageKey, isFocusMode)",
  "writeTableColumnWidths(layoutStorageKey, columnWidths)",
  "getTableColumnMinWidth",
  "getTableColumnMaxWidth",
  "resizeTableColumnWidthsToTarget",
  "readTableColumnWidths(layoutStorageKey, isFocusMode)",
  "readStoredGridDayPx",
  "estimateActivityNameLines",
  "getActivityMatrixTaskRowHeight",
  '<div className="mt-0.5 flex flex-wrap gap-1">',
  "window.localStorage.setItem",
  "resetGridLayout",
  "Reset grid",
  "applyGridLayoutPreset",
  "Gantt first",
  "Balanced",
  "Details",
  "startColumnResize",
  "Resize column",
  "group-hover:bg-foreground/70",
  "startTableSplitResize",
  "Resize activity table and Gantt split",
  "group-hover:bg-foreground/65",
  "Drag to give more space to the activity table or Gantt chart",
  "Drag left or right to compress or expand the Gantt timeline.",
  "cursor-grab select-none active:cursor-grabbing",
  "startTimelineScaleDrag",
  "ResizeObserver",
  "measuredMatrixWidth - tableWidth - 1",
  "CONSTRUCTLINE_MIN_DAY_PX",
  "CONSTRUCTLINE_MAX_DAY_PX",
  "const fitDayPx = Math.max(",
  "clampNumber(dayPx, CONSTRUCTLINE_MIN_DAY_PX, CONSTRUCTLINE_MAX_DAY_PX)",
  "Math.max(fitTimelineTargetWidth, Math.ceil(model.totalTimelineDays * activeDayPx))",
  "constructline-cpm-matrix-scroll",
  "constructline-cpm-matrix-editor",
  "bg-card text-[9px] font-semibold uppercase tracking-normal",
  'isFocusMode ? "sticky z-20" : "relative z-0"',
  "top: isFocusMode ? CONSTRUCTLINE_FOCUS_MATRIX_STICKY_TOP : undefined",
  "overflow-auto overscroll-contain print:max-h-none print:overflow-visible",
  "max-h-[clamp(520px,calc(100vh-260px),900px)]",
  'style={{ width: tableWidth + timelineWidth, minWidth: "100%" }}',
  "Activity description",
  "Planned dates",
  "Actual / current dates",
  "Percent complete",
  "Total float",
  "Original planned duration and remaining duration",
  "Current start and expected finish.",
  "showBaselineBars",
  "onToggleBaselineBars",
  "Baseline",
  "activityColumnWidth",
  "estimateActivityNameLines(name, isPrintMode, activityColumnWidth)",
  "formatTaskStatusBasisLabel",
  "formatTaskStatusBasisTitle",
  'band.width >= 46 ? band.label : ""',
  "showLogicLines &&",
  "ConstructLineLogicOverlay",
  "Activity form opened",
  "Milestone form opened",
  "border border-accent/35 bg-accent/10",
  "showTemplateTools",
  "aria-pressed={showTemplateTools}",
  "isDenseHeader={isFullWorkspace}",
  "compact={isFullWorkspace}",
  "const useDenseHeader = isFocusMode || isDenseHeader;",
  "useDenseHeader ?",
  "max-h-[clamp(640px,calc(100vh-205px),1120px)]",
]) {
  assertIncludes(
    scheduleRiskSource,
    requiredMatrixLayoutText,
    `Activity matrix missing layout contract: ${requiredMatrixLayoutText}`,
  );
}

assertMatches(
  scheduleRiskSource,
  /style=\{\{ width: tableWidth, gridTemplateColumns: tableColumns \}\}/,
  "CPM table header must use the same width and columns contract as activity rows.",
);

// Print 11x17 contract: the printed report always carries logic lines and
// baseline bars regardless of the on-screen toggles.
assertMatches(
  scheduleRiskSource,
  /showLogicLines\s+showBaselineBars\s+isPrintMode/,
  "The print-mode matrix must force logic lines and baseline bars on.",
);
assertIncludes(stylesSource, "size: 17in 11in;", "Print output must target 11x17 landscape.");
assertIncludes(
  stylesSource,
  ".constructline-schedule-page main > :not(.constructline-cpm-print-shell)",
  "Printing must hide everything except the CPM print shell.",
);
assertMatches(
  scheduleRiskSource,
  /id: "activity",[\s\S]*?label: "Activity description",[\s\S]*?align: "left",/,
  "Only the Activity Description column should opt into left-aligned CPM table text.",
);
assertMatches(
  scheduleRiskSource,
  /const CONSTRUCTLINE_TABLE_SPLIT_GROW_ORDER: ConstructLineTableColumnId\[\] = \[[\s\S]*?"current",[\s\S]*?"plan",[\s\S]*?"logic",[\s\S]*?"activity",[\s\S]*?\];/,
  "Dragging the table/Gantt split wider should prioritize technical columns before Activity Description.",
);
assert.equal(
  scheduleRiskSource.match(/align: "left"/g)?.length ?? 0,
  1,
  "Only one CPM table column should be left aligned; all technical columns should stay centered.",
);
assertMatches(
  scheduleRiskSource,
  /style=\{\{ width: tableWidth, gridTemplateColumns: tableColumns \}\}[\s\S]*onClick=\{onOpen\}/,
  "CPM activity rows must use the shared table column contract and remain clickable.",
);
assertMatches(
  scheduleRiskSource,
  /isFocusOpen &&[\s\S]*onClick=\{toggleActivityDraft\}[\s\S]*onClick=\{openMilestoneDraft\}/,
  "Expanded CPM workspace must keep Add activity and Add milestone controls available.",
);
assertMatches(
  scheduleRiskSource,
  /isFocusOpen &&[\s\S]*scrollActivityDraftIntoView\(draftFormRef\)/,
  "Expanded CPM workspace must expose a jump-to-form action when an activity form is open.",
);

// Text-fit and modal guardrails: activity detail and WBS manager must not force horizontal modal
// scrolling when dependency rows, WBS names, or delay fragments get longer.
for (const requiredModalLayoutText of [
  "sm:w-[min(calc(100vw-2rem),80rem)] sm:max-w-[80rem]",
  "overflow-y-auto overflow-x-hidden",
  "xl:grid-cols-[150px_minmax(0,1.6fr)_minmax(0,1fr)]",
  "xl:grid-cols-[145px_145px_150px_145px_145px_105px]",
  "constructline-task-name break-words",
  "Update basis",
  "saved update basis",
  "inferred, not saved",
  "Predecessors - work before this activity",
  "Successors - work after this activity",
  "Dependency readout",
  "ActivityRelationshipRows",
  "d lag",
  "Baseline plan",
  "Current update",
  "Save & next update row",
  "disabled={!updateQueueContext || !draft.name.trim() || saving}",
  "Baseline start",
  "Remaining duration",
  "Expected finish",
  "Baseline finish",
  "Schedule slip",
  "buildActivityUpdateImpact",
  "Apply delay to forecast",
  "ActivityDelayFragmentPanel",
  "sm:w-[min(calc(100vw-2rem),72rem)] sm:max-w-[72rem]",
  "overflow-y-auto px-4 py-4 sm:px-6",
  "Drag rows to reorder. Drop onto a parent to build child areas",
]) {
  assertIncludes(
    scheduleRiskSource,
    requiredModalLayoutText,
    `CPM modal/WBS manager missing layout contract: ${requiredModalLayoutText}`,
  );
}

const minWidthGuardCount = (scheduleRiskSource.match(/min-w-0/g) ?? []).length;
assert.ok(
  minWidthGuardCount >= 55,
  `Expected many min-w-0 guards for responsive text fit; found ${minWidthGuardCount}.`,
);

const truncateGuardCount = (scheduleRiskSource.match(/truncate/g) ?? []).length;
assert.ok(
  truncateGuardCount >= 19,
  `Expected truncation guards for compact schedule and WBS text; found ${truncateGuardCount}.`,
);

assertIncludes(
  stylesSource,
  ".constructline-task-name",
  "CPM activity names must have a wrapping style hook for long printed activity labels.",
);
assertIncludes(
  stylesSource,
  "overflow-wrap: anywhere;",
  "CPM activity names must wrap instead of truncating in the schedule grid.",
);

// Print contract: 11x17 landscape should carry report identity, fit text in report cells, and keep
// the CPM matrix on the printed page rather than reverting to a browser-like scrolling grid.
for (const requiredPrintLayoutText of [
  "size: 17in 11in;",
  ".constructline-cpm-print-report-strip",
  "grid-template-columns: 1.28in 1.45in 1.1in 1.05in 1.05in minmax(0, 1fr);",
  "overflow: hidden;",
  "text-overflow: ellipsis;",
  "white-space: nowrap;",
  ".constructline-cpm-print-status-critical",
  "border-left-width: 0.055in;",
  ".constructline-cpm-print-report-strip-report",
  "background: #221f1b !important;",
  ".constructline-cpm-print-report-strip-basis",
  "border-left: 0.035in solid #d53c31;",
  ".constructline-cpm-print-footer",
  "flex-wrap: wrap;",
  ".constructline-cpm-print-footer-report",
  ".constructline-cpm-matrix-print",
  "overflow: hidden !important;",
  ".constructline-cpm-matrix-print .constructline-cpm-matrix-scroll",
  "overflow: visible !important;",
]) {
  assertIncludes(
    stylesSource,
    requiredPrintLayoutText,
    `Print styles missing layout contract: ${requiredPrintLayoutText}`,
  );
}

for (const requiredStatusedCpmText of [
  "task.statusStartDate",
  "task.statusFinishDate",
  "task.slippageDays > 0",
  "remaining_duration_days",
  "updateDraftRemainingDuration",
  "updateDraftForecastFinishDate",
  "applyOpenDelayToDraftForecast",
  "carriedDelayDays",
  "uncarriedDelayDays",
  "getDelayPeriodLabel",
  "carried inside the current expected finish",
]) {
  assertIncludes(
    scheduleRiskSource,
    requiredStatusedCpmText,
    `CPM statused update workflow missing source contract: ${requiredStatusedCpmText}`,
  );
}

console.log("ConstructLine CPM layout smoke checks passed.");
