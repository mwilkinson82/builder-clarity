import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (filePath: string) => readFileSync(resolve(rootDir, filePath), "utf8");

const scheduleRiskSource = readProjectFile("src/components/outcome/ScheduleRisk.tsx");
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
  "ResizeObserver",
  "measuredMatrixWidth - tableWidth - 1",
  "const fitDayPx = Math.max(0.85, fitTimelineTargetWidth / Math.max(1, model.totalTimelineDays));",
  "const activeDayPx = isPrintMode ? printDayPx : isFitZoom ? fitDayPx : dayPx;",
  "Math.max(fitTimelineTargetWidth, Math.ceil(model.totalTimelineDays * activeDayPx))",
  "const minimumTableWidth = isFocusMode ? 1160 : 1120;",
  "const preferredFitTableWidth = isFocusMode ? 1220 : 1160;",
  "Math.max(minimumTableWidth, measuredMatrixWidth * (isFocusMode ? 0.62 : 0.76))",
  "minmax(420px,1fr)",
  "constructline-cpm-matrix-scroll",
  "constructline-cpm-matrix-editor",
  "overflow-auto overscroll-contain print:max-h-none print:overflow-visible",
  "max-h-[clamp(460px,calc(100vh-330px),820px)]",
  'style={{ width: tableWidth + timelineWidth, minWidth: "100%" }}',
  "Planned dates",
  "Current dates",
  "Original planned duration and remaining duration",
  "Current start and expected finish.",
  "formatTaskStatusBasisLabel",
  "formatTaskStatusBasisTitle",
  'band.width >= 46 ? band.label : ""',
  "showLogicLines &&",
  "ConstructLineLogicOverlay",
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
assertMatches(
  scheduleRiskSource,
  /style=\{\{ width: tableWidth, gridTemplateColumns: tableColumns \}\}[\s\S]*onClick=\{onOpen\}/,
  "CPM activity rows must use the shared table column contract and remain clickable.",
);

// Text-fit and modal guardrails: activity detail and WBS manager must not force horizontal modal
// scrolling when dependency rows, WBS names, or delay fragments get longer.
for (const requiredModalLayoutText of [
  "sm:w-[min(calc(100vw-2rem),80rem)] sm:max-w-[80rem]",
  "overflow-y-auto overflow-x-hidden",
  "xl:grid-cols-[130px_minmax(0,1.4fr)_minmax(0,1fr)_145px_145px_105px]",
  "constructline-task-name break-words",
  "Update basis",
  "saved update basis",
  "inferred, not saved",
  "Predecessors - work before this activity",
  "Successors - work after this activity",
  "Dependency readout",
  "Status update",
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
