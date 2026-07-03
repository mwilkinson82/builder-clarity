// Schedule import smoke: column auto-mapping, duration/date parsing (incl.
// "10d"/"2w" oddities), waterfall date placement, ID style continuation,
// SOV cost-code grouping, and no-logic membership. Fixtures are real .xlsx
// workbooks built and re-read through SheetJS so the Excel path (including
// serial dates) is exercised end to end.
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildScheduleImportActivityInputs,
  buildScheduleImportPreviewRows,
  buildSovSchedulePreviewRows,
  createScheduleImportIdAllocator,
  getScheduleImportDateSpanDays,
  getSovCostCodeWbsLabel,
  guessScheduleImportColumnMap,
  parseScheduleImportDate,
  parseScheduleImportDuration,
} from "../src/lib/schedule-import.ts";
import {
  buildConstructLineCpmModel,
  isUntiedConstructLineTask,
} from "../src/lib/constructline-cpm.ts";
import type { ScheduleActivityRow } from "../src/lib/schedule.functions.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

let activitySeq = 0;
function makeActivity(overrides: Partial<ScheduleActivityRow> = {}): ScheduleActivityRow {
  activitySeq += 1;
  return {
    id: `a-${activitySeq}`,
    project_id: "p-1",
    activity_id: `A-${String(activitySeq).padStart(3, "0")}`,
    name: `Activity ${activitySeq}`,
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
    sort_order: activitySeq * 10,
    ...overrides,
  };
}

// Mirrors parseXlsx in src/lib/sov-import.ts: workbook -> string matrix.
function matrixFromWorkbook(rows: unknown[][]): string[][] {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Schedule");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const readBack = XLSX.read(buffer, { type: "buffer" });
  const sheet = readBack.Sheets[readBack.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
  return raw
    .map((row) => (row ?? []).map((cell) => (cell == null ? "" : String(cell))))
    .filter((row) => row.some((cell) => cell.trim() !== ""));
}

function excelSerialFor(isoDate: string): number {
  const [year, month, day] = isoDate.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / DAY_MS);
}

// ---------- Column auto-mapping ----------
const cleanMap = guessScheduleImportColumnMap([
  "Activity ID",
  "Description",
  "Duration",
  "Start",
  "Finish",
  "WBS",
]);
assert.deepEqual(
  cleanMap,
  { activity_id: 0, description: 1, duration_days: 2, start_date: 3, finish_date: 4, wbs: 5 },
  "Clean headers map every field by exact name.",
);

const messyMap = guessScheduleImportColumnMap([
  "No.",
  "Task Name",
  "Orig. Duration",
  "Early Start",
  "Early Finish",
  "Area",
  "Total Cost",
]);
assert.deepEqual(
  messyMap,
  { activity_id: 0, description: 1, duration_days: 2, start_date: 3, finish_date: 4, wbs: 5 },
  "P6-style headers (No., Task Name, Orig. Duration, Early Start/Finish, Area) auto-map.",
);

const containsMap = guessScheduleImportColumnMap([
  "Activity Description",
  "Act ID",
  "Duration (days)",
  "Act. Start Date",
  "Act. Finish Date",
]);
assert.equal(containsMap.description, 0, "Exact alias claims the description column.");
assert.equal(containsMap.activity_id, 1, "Act ID maps to the activity ID.");
assert.equal(containsMap.duration_days, 2, "Duration (days) maps to duration.");
assert.equal(containsMap.start_date, 3, "A header containing 'start date' maps to start.");
assert.equal(containsMap.finish_date, 4, "A header containing 'finish date' maps to finish.");

const unmappable = guessScheduleImportColumnMap(["Alpha", "Beta"]);
assert.equal(unmappable.description, -1, "Unrecognized headers stay unmapped, never guessed.");

// ---------- Duration parsing ----------
assert.equal(parseScheduleImportDuration("10"), 10, "Plain number reads as days.");
assert.equal(parseScheduleImportDuration("10d"), 10, "'10d' reads as 10 days.");
assert.equal(parseScheduleImportDuration("10 days"), 10, "'10 days' reads as 10 days.");
assert.equal(parseScheduleImportDuration("2w"), 14, "'2w' converts at 7 calendar days a week.");
assert.equal(parseScheduleImportDuration("2 wks"), 14, "'2 wks' converts to 14 days.");
assert.equal(parseScheduleImportDuration("1.5w"), 11, "Fractional weeks round up to whole days.");
assert.equal(parseScheduleImportDuration("3 wd"), 3, "'wd' means workdays, not weeks.");
assert.equal(parseScheduleImportDuration("TBD"), null, "Unreadable duration returns null.");
assert.equal(parseScheduleImportDuration(""), null, "Blank duration returns null.");
assert.equal(parseScheduleImportDuration("-5"), null, "Negative durations are rejected.");

// ---------- Date parsing ----------
assert.equal(parseScheduleImportDate("2026-08-03"), "2026-08-03", "ISO dates pass through.");
assert.equal(
  parseScheduleImportDate("2026-08-03T00:00:00"),
  "2026-08-03",
  "Datetime strings drop the time part.",
);
assert.equal(parseScheduleImportDate("8/3/2026"), "2026-08-03", "US slash dates read m/d/y.");
assert.equal(parseScheduleImportDate("8/3/26"), "2026-08-03", "Two-digit years expand to 20xx.");
assert.equal(parseScheduleImportDate("05-Jan-26"), "2026-01-05", "P6-style dd-Mon-yy reads.");
assert.equal(parseScheduleImportDate("Jan 5, 2026"), "2026-01-05", "Month-name dates read.");
assert.equal(
  parseScheduleImportDate(String(excelSerialFor("2026-08-03"))),
  "2026-08-03",
  "Excel serial numbers convert to the calendar date.",
);
assert.equal(parseScheduleImportDate("13/45/2026"), null, "Impossible dates return null.");
assert.equal(parseScheduleImportDate("soon"), null, "Unreadable dates return null.");
assert.equal(
  getScheduleImportDateSpanDays("2026-08-03", "2026-08-07"),
  5,
  "Duration derives inclusively from start/finish.",
);

// ---------- Clean Excel fixture end to end ----------
const cleanMatrix = matrixFromWorkbook([
  ["Activity ID", "Description", "Duration", "Start", "Finish", "WBS"],
  ["A-101", "Mobilize and set up site", 5, "2026-08-03", "2026-08-07", "General Conditions"],
  ["A-102", "Excavate foundations", "10d", "2026-08-10", "", "Sitework"],
  ["A-103", "Form and pour footings", "2w", "", "", "Concrete"],
]);
const cleanGuess = guessScheduleImportColumnMap(cleanMatrix[0]);
const cleanRows = buildScheduleImportPreviewRows(cleanMatrix, true, cleanGuess);
assert.equal(cleanRows.length, 3, "Clean fixture yields three rows.");
assert.equal(cleanRows[0].startDate, "2026-08-03", "Clean fixture keeps its start dates.");
assert.equal(cleanRows[0].finishDate, "2026-08-07", "Clean fixture keeps its finish dates.");
assert.equal(cleanRows[1].durationDays, 10, "'10d' in a cell parses inside the pipeline.");
assert.equal(
  cleanRows.every((row) => row.include),
  true,
  "Every clean row is included by default.",
);

const existing = [
  makeActivity({ activity_id: "A-001", sort_order: 10 }),
  makeActivity({ activity_id: "A-002", sort_order: 20 }),
];
const cleanInputs = buildScheduleImportActivityInputs(cleanRows, existing, {
  defaultDurationDays: 1,
  anchorDate: "2026-08-01",
  sourceLabel: "clean-schedule.xlsx",
});
assert.equal(cleanInputs.length, 3, "All included rows become activity inputs.");
assert.equal(cleanInputs[0].activity_id, "A-101", "Supplied activity IDs are honored.");
assert.equal(cleanInputs[0].start_date, "2026-08-03", "Dated rows keep their dates.");
assert.equal(
  cleanInputs[1].finish_date,
  "2026-08-19",
  "Start plus 10-day duration computes the finish inclusively.",
);
assert.equal(
  cleanInputs[2].start_date,
  "2026-08-20",
  "A dateless row is placed right after the previous row.",
);
assert.equal(cleanInputs[2].finish_date, "2026-09-02", "The placed row spans its 2-week duration.");
assert.ok(
  (cleanInputs[2].notes ?? "").includes("placed from the import order"),
  "Placed dates are labeled as placeholders in the row notes.",
);
assert.deepEqual(
  [cleanInputs[0].predecessor_activity_ids, cleanInputs[0].successor_activity_ids],
  [[], []],
  "Imported rows carry NO logic ties by design.",
);
assert.deepEqual(
  cleanInputs.map((input) => input.sort_order),
  [21, 22, 23],
  "Imported rows keep their file order after the existing schedule.",
);
assert.equal(cleanInputs[1].division, "Sitework", "The mapped WBS column becomes the division.");

// ---------- Messy Excel fixture end to end ----------
const messyMatrix = matrixFromWorkbook([
  ["No.", "Task Name", "Orig. Duration", "Early Start", "Early Finish", "Area"],
  [
    10,
    "Demo existing finishes",
    "TBD",
    excelSerialFor("2026-08-03"),
    excelSerialFor("2026-08-05"),
    "Interior",
  ],
  // Finish lands before start: the import swaps them instead of failing.
  [20, "Rough plumbing", "1w", excelSerialFor("2026-08-14"), excelSerialFor("2026-08-10"), ""],
  [30, "", 5, "", "", "Interior"],
  [40, "Hang and finish drywall", "3 wks", "", "", "Interior"],
]);
const messyGuess = guessScheduleImportColumnMap(messyMatrix[0]);
const messyRows = buildScheduleImportPreviewRows(messyMatrix, true, messyGuess);
assert.equal(messyRows.length, 4, "Messy fixture keeps every non-empty row visible.");
assert.equal(
  messyRows[0].startDate,
  "2026-08-03",
  "Excel serial dates from the workbook parse to calendar dates.",
);
assert.ok(
  messyRows[0].issues.some((issue) => issue.message.includes("TBD")),
  "An unreadable duration is flagged on the row.",
);
assert.equal(messyRows[1].startDate, "2026-08-10", "Swapped dates put the start first.");
assert.equal(messyRows[1].finishDate, "2026-08-14", "Swapped dates put the finish last.");
assert.ok(
  messyRows[1].issues.some((issue) => issue.message.includes("swapped")),
  "The swap is called out on the row.",
);
assert.equal(messyRows[2].include, false, "A blank description excludes the row by default.");
assert.equal(
  messyRows[2].issues.some((issue) => issue.level === "error"),
  true,
  "A blank description is an error, not a silent skip.",
);
assert.equal(messyRows[3].durationDays, 21, "'3 wks' parses inside the pipeline.");

const messyInputs = buildScheduleImportActivityInputs(messyRows, existing, {
  defaultDurationDays: 2,
  anchorDate: "2026-08-01",
  sourceLabel: "messy-schedule.xlsx",
});
assert.equal(messyInputs.length, 3, "The excluded blank row does not import.");
assert.equal(messyInputs[0].activity_id, "10", "Numeric IDs from the file are kept as supplied.");
assert.equal(
  getScheduleImportDateSpanDays(messyInputs[0].start_date, messyInputs[0].finish_date),
  3,
  "Dates win over the unreadable duration.",
);

// ---------- ID allocation honors the numbering style ----------
const autoStyle = createScheduleImportIdAllocator(["A-001", "A-002", "A-011"]);
assert.equal(autoStyle.next(""), "A-012", "A-### numbering continues from the highest number.");
assert.equal(autoStyle.next("A-001"), "A-001-2", "A supplied duplicate ID gets a suffix.");

const numericStyle = createScheduleImportIdAllocator(["100", "110", "120"]);
assert.equal(numericStyle.next(""), "130", "Pure-numeric schedules continue in steps of 10.");
assert.equal(numericStyle.next(""), "140", "Numeric numbering keeps stepping.");

const emptySchedule = createScheduleImportIdAllocator([]);
assert.equal(emptySchedule.next(""), "A-001", "An empty schedule starts at A-001.");

// ---------- SOV grouping ----------
assert.equal(getSovCostCodeWbsLabel("03-300"), "03 Concrete", "CSI 03 groups as Concrete.");
assert.equal(getSovCostCodeWbsLabel("31-220"), "31 Earthwork", "CSI 31 groups as Earthwork.");
assert.equal(getSovCostCodeWbsLabel("1-500"), "01 General Requirements", "Codes pad to CSI 01.");
assert.equal(getSovCostCodeWbsLabel("99-000"), "Division 99", "Unknown divisions keep the code.");
assert.equal(getSovCostCodeWbsLabel(""), "General", "No cost code lands in General.");

const sovRows = buildSovSchedulePreviewRows(
  [
    { cost_code: "03-300", bucket: "Slab on grade", sort_order: 20 },
    { cost_code: "01-500", bucket: "Temporary fence", sort_order: 10 },
    { cost_code: "06-100", bucket: "Rough framing package", sort_order: 30 },
    { cost_code: "", bucket: "", sort_order: 40 },
  ],
  [makeActivity({ name: "Rough framing package" })],
);
assert.equal(sovRows.length, 4, "Every SOV line shows in the preview.");
assert.deepEqual(
  sovRows.map((row) => row.description),
  ["Temporary fence", "Slab on grade", "Rough framing package", ""],
  "SOV lines keep their SOV sort order.",
);
assert.equal(sovRows[0].wbs, "01 General Requirements", "SOV WBS comes from the cost code.");
assert.equal(sovRows[1].wbs, "03 Concrete", "Cost-code grouping labels the concrete line.");
assert.equal(
  sovRows[2].include,
  false,
  "A line whose name already exists is suggested unchecked, never forced.",
);
assert.equal(sovRows[3].include, false, "A blank SOV line cannot import.");
assert.equal(
  sovRows[0].durationDays,
  null,
  "SOV lines leave duration blank so the default applies.",
);

// ---------- No-logic membership and CPM basis honesty ----------
const tiedA = makeActivity({
  activity_id: "T-001",
  name: "Tied A",
  baseline_start_date: "2026-08-03",
  baseline_finish_date: "2026-08-07",
  successor_activity_ids: ["T-002|FS|0"],
});
const tiedB = makeActivity({
  activity_id: "T-002",
  name: "Tied B",
  baseline_start_date: "2026-08-10",
  baseline_finish_date: "2026-08-14",
  predecessor_activity_ids: ["T-001|FS|0"],
});
const untied = makeActivity({
  activity_id: "U-001",
  name: "Untied row",
  baseline_start_date: "2026-08-03",
  baseline_finish_date: "2026-08-05",
});
const milestone = makeActivity({
  activity_id: "MS-001",
  name: "Substantial completion",
  division: "Milestones",
  baseline_start_date: "2026-09-01",
  baseline_finish_date: "2026-09-01",
});
const mixedModel = buildConstructLineCpmModel([tiedA, tiedB, untied, milestone], {
  dataDate: "2026-08-01",
});
const byKey = new Map(mixedModel.tasks.map((task) => [task.dependencyKey, task]));
assert.equal(
  isUntiedConstructLineTask(byKey.get("T-001")!),
  false,
  "An activity with a successor is not in the no-logic set.",
);
assert.equal(
  isUntiedConstructLineTask(byKey.get("T-002")!),
  false,
  "An activity with a predecessor is not in the no-logic set.",
);
assert.equal(
  isUntiedConstructLineTask(byKey.get("U-001")!),
  true,
  "Zero predecessors and zero successors puts a row in the no-logic set.",
);
assert.equal(
  isUntiedConstructLineTask(byKey.get("MS-001")!),
  false,
  "Designated milestones are excluded from the no-logic set.",
);
assert.equal(mixedModel.untiedActivityCount, 1, "The model counts untied activities.");
assert.equal(
  mixedModel.isSubstantiallyUntied,
  false,
  "One untied row out of three does not mark the network substantially untied.",
);

const importedActivities = Array.from({ length: 5 }, (_, index) =>
  makeActivity({
    activity_id: `I-${index + 1}`,
    name: `Imported ${index + 1}`,
    baseline_start_date: "2026-08-03",
    baseline_finish_date: "2026-08-07",
  }),
);
const importedModel = buildConstructLineCpmModel(importedActivities, { dataDate: "2026-08-01" });
assert.equal(importedModel.untiedActivityCount, 5, "A fresh import is fully untied.");
assert.equal(
  importedModel.isSubstantiallyUntied,
  true,
  "A fully untied network is substantially untied.",
);
assert.equal(
  importedModel.criticalPathReliable,
  false,
  "An untied network never reads as a reliable CPM basis.",
);
assert.ok(
  importedModel.criticalPathReliabilityNote.includes("no logic ties"),
  "The reliability note says the dates are not a CPM result.",
);

console.log("Schedule import smoke checks passed.");
