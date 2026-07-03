// SSR entry for the 11x17 print smoke. Bundled by esbuild (alias @ -> src),
// then run under node: renders the REAL CpmPrintSheet for two fixtures and
// writes self-contained HTML files plus the pagination predictions the smoke
// asserts PDF page counts against.
//
// Usage: node print-fixture-entry.bundle.mjs <outDir> <compiledCssPath>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { CpmPrintSheet, computeCpmPrintChunks } from "@/components/schedule/CpmPrintSheet";
import {
  getActivityMatrixTaskRowHeight,
  orderConstructLineCpmModel,
} from "@/components/schedule/scheduleGridModel";
import { buildConstructLineCpmModel } from "@/lib/constructline-cpm";
import type { ProjectRow } from "@/lib/projects.functions";
import type { ScheduleActivityRow, ScheduleDelayFragmentRow } from "@/lib/schedule.functions";

const [, , outDirArg, cssPathArg] = process.argv;
if (!outDirArg || !cssPathArg) {
  console.error("Usage: print-fixture-entry <outDir> <compiledCssPath>");
  process.exit(1);
}
const outDir = resolve(outDirArg);
mkdirSync(outDir, { recursive: true });
const compiledCss = readFileSync(resolve(cssPathArg), "utf8");

let seq = 0;
function activity(overrides: Partial<ScheduleActivityRow>): ScheduleActivityRow {
  seq += 1;
  return {
    id: `fixture-${seq}`,
    project_id: "fixture-project",
    activity_id: `A-${String(seq).padStart(3, "0")}`,
    name: `Activity ${seq}`,
    division: "General",
    wbs_section_id: null,
    start_date: null,
    finish_date: null,
    baseline_start_date: null,
    baseline_finish_date: null,
    forecast_start_date: null,
    forecast_finish_date: null,
    actual_start_date: null,
    actual_finish_date: null,
    remaining_duration_days: null,
    percent_complete: 0,
    predecessor_activity_ids: [],
    successor_activity_ids: [],
    notes: "",
    sort_order: seq * 10,
    ...overrides,
  };
}

function isoDate(dayOffset: number) {
  const base = Date.UTC(2026, 2, 2); // 2026-03-02, a Monday
  return new Date(base + dayOffset * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 22-activity fixture mirroring the live Harbor print check: six divisions,
// FS chains, two milestones, mixed progress, one open delay, wrapping names.
function buildHarborLikeActivities(): ScheduleActivityRow[] {
  const divisions = [
    "01 - General Conditions",
    "03 - Concrete",
    "06 - Framing",
    "07 - Roofing",
    "08 - Openings",
    "09 - Finishes",
  ];
  const rows: ScheduleActivityRow[] = [];
  const perDivision = [4, 4, 4, 3, 3, 2];
  let idNumber = 10;
  divisions.forEach((division, divisionIndex) => {
    // Parallel trades: each division runs its own FS chain, offset like real
    // sequencing, so only one path is critical — not every row.
    let day = divisionIndex * 14;
    let previousInDivision: string | null = null;
    for (let i = 0; i < perDivision[divisionIndex]; i += 1) {
      const id = `${division.slice(0, 2)}-${String(idNumber).padStart(3, "0")}`;
      idNumber += 10;
      const duration = 8 + ((i + divisionIndex) % 4) * 4;
      // Statused like a well-kept schedule at data date day 52: finished work
      // has actuals, in-progress work has an actual start plus a current
      // forecast finish, future work carries clean baseline dates.
      const finished = day + duration < 45;
      const started = !finished && day < 52;
      rows.push(
        activity({
          activity_id: id,
          name:
            i === 1 && divisionIndex % 3 === 0
              ? `${division.split(" - ")[1]} scope with a deliberately long descriptive name that wraps on paper`
              : `${division.split(" - ")[1]} work package ${i + 1}`,
          division,
          baseline_start_date: isoDate(day),
          baseline_finish_date: isoDate(day + duration),
          forecast_start_date: isoDate(day),
          forecast_finish_date: started
            ? isoDate(Math.max(day + duration, 56))
            : isoDate(day + duration),
          actual_start_date: started || finished ? isoDate(day) : null,
          actual_finish_date: finished ? isoDate(day + duration) : null,
          remaining_duration_days: started ? Math.max(2, Math.round(duration / 2)) : null,
          percent_complete: finished ? 100 : started ? 40 + ((i * 17) % 40) : 0,
          predecessor_activity_ids: previousInDivision ? [`${previousInDivision}|FS|0`] : [],
        }),
      );
      previousInDivision = id;
      day += Math.max(4, Math.round(duration * 0.7));
    }
  });
  rows.push(
    activity({
      activity_id: "MS-001",
      name: "Dry-in milestone",
      division: "07 - Roofing",
      baseline_start_date: isoDate(95),
      baseline_finish_date: isoDate(95),
      predecessor_activity_ids: [`${rows[14].activity_id}|FS|0`],
    }),
  );
  // Substantial completion closes every trade chain — realistic logic, and
  // no dangling open-finish rows.
  const divisionEnds = divisions
    .map((division) => rows.filter((row) => row.division === division).at(-1)?.activity_id)
    .filter((id): id is string => Boolean(id));
  rows.push(
    activity({
      activity_id: "MS-002",
      name: "Substantial completion",
      division: "09 - Finishes",
      baseline_start_date: isoDate(150),
      baseline_finish_date: isoDate(150),
      predecessor_activity_ids: [...divisionEnds, "MS-001"].map((id) => `${id}|FS|0`),
    }),
  );
  return rows;
}

// 60-activity synthetic fixture: multi-page behavior, repeated headers,
// orphan control, balanced pages.
function buildSixtyActivities(): ScheduleActivityRow[] {
  const rows: ScheduleActivityRow[] = [];
  for (let d = 0; d < 6; d += 1) {
    const division = `${String((d + 1) * 10).padStart(2, "0")} - Division ${d + 1}`;
    for (let i = 0; i < 10; i += 1) {
      const index = d * 10 + i;
      const start = d * 24 + i * 6;
      rows.push(
        activity({
          activity_id: `S-${String(index + 1).padStart(3, "0")}`,
          name:
            i % 4 === 2
              ? `Division ${d + 1} long-form activity name written the way a field PM writes them ${i + 1}`
              : `Division ${d + 1} activity ${i + 1}`,
          division,
          baseline_start_date: isoDate(start),
          baseline_finish_date: isoDate(start + 8),
          percent_complete: index < 12 ? 100 : index < 20 ? 50 : 0,
          actual_start_date: index < 20 ? isoDate(start) : null,
          actual_finish_date: index < 12 ? isoDate(start + 8) : null,
          remaining_duration_days: index >= 12 && index < 20 ? 4 : null,
          predecessor_activity_ids: i > 0 ? [`S-${String(index).padStart(3, "0")}|FS|0`] : [],
        }),
      );
    }
  }
  return rows;
}

const project = {
  id: "fixture-project",
  name: "Harbor Residence",
  job_number: "24-118",
  client: "Harbor family",
  project_manager: "M. Wilkinson",
  organization_name: "Overwatch",
  organization_logo_url: null,
} as unknown as ProjectRow;

const fixtures = [
  { key: "fixture-22", activities: buildHarborLikeActivities(), dataDate: isoDate(52) },
  { key: "fixture-60", activities: buildSixtyActivities(), dataDate: isoDate(80) },
];

const delayFragments: ScheduleDelayFragmentRow[] = [];
const predictions: Record<
  string,
  { pages: number; chunkTaskCounts: number[]; chunkContentHeights: number[] }
> = {};

for (const fixture of fixtures) {
  const baseModel = buildConstructLineCpmModel(fixture.activities, {
    dataDate: fixture.dataDate,
    nearCriticalFloat: 5,
  });
  const model = orderConstructLineCpmModel(baseModel, "wbs", []);
  const chunks = computeCpmPrintChunks(model, delayFragments);
  if (process.env.PRINT_FIXTURE_DEBUG) {
    const byActivity = new Map<string, ScheduleDelayFragmentRow[]>();
    for (const task of model.tasks) {
      console.error(
        [
          task.activity.activity_id,
          `h=${getActivityMatrixTaskRowHeight(task, true, byActivity, 130)}`,
          `crit=${task.isCritical ? 1 : 0}`,
          `late=${task.isLate ? 1 : 0}`,
          `oos=${task.isOutOfSequence ? 1 : 0}`,
          `openS=${task.isOpenStart ? 1 : 0}`,
          `openF=${task.isOpenFinish ? 1 : 0}`,
          `basis=${task.statusBasis}`,
          `slip=${task.slippageDays}`,
          `name=${task.activity.name.length}ch`,
        ].join(" "),
      );
    }
  }
  predictions[fixture.key] = {
    pages: chunks.length,
    chunkTaskCounts: chunks.map((chunk) => chunk.taskCount),
    chunkContentHeights: chunks.map((chunk) => chunk.contentHeight),
  };
  const markup = renderToStaticMarkup(
    <CpmPrintSheet
      project={project}
      model={model}
      delayFragments={delayFragments}
      delaySummary={{
        totalCount: 0,
        openCount: 0,
        openDays: 0,
        activeCount: 0,
        mitigatedCount: 0,
        recoveredCount: 0,
        driverLabels: [],
      }}
      effectiveDataDate={fixture.dataDate}
      activityOrder="wbs"
      scheduleViewSummary={`${model.tasks.length} of ${model.tasks.length} activities shown`}
      printReportLabel="Full schedule"
      criticalBasisLabel="Critical basis valid"
      isCriticalPathReport={false}
      isRecoveryReport={false}
      contractorName="Overwatch"
      printedLogicTieCount={model.tasks.length - 1}
    />,
  );
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${fixture.key}</title>
<style>${compiledCss}</style>
</head>
<body class="constructline-schedule-page"><main>${markup}</main></body>
</html>`;
  writeFileSync(resolve(outDir, `${fixture.key}.html`), html);
}

writeFileSync(resolve(outDir, "predictions.json"), JSON.stringify(predictions, null, 2));
console.log(JSON.stringify(predictions));
