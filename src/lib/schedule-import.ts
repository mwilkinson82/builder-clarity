// Schedule import core: Excel/CSV column mapping, duration/date parsing, and
// SOV-line conversion into CPM activity rows. The import is a starting point —
// rows come in with NO logic ties by design; the PM tags predecessors in
// Overwatch afterward. Pure module (no env-dependent imports) so node-based
// smoke tests can load it. File/worksheet parsing lives in sov-import.ts;
// this module starts from the string matrix those parsers produce.
import type { ScheduleActivityRow } from "@/lib/schedule.functions";

const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleImportField =
  "activity_id" | "description" | "duration_days" | "start_date" | "finish_date" | "wbs";

// -1 means "not mapped". Description is the only required mapping.
export type ScheduleImportColumnMap = Record<ScheduleImportField, number>;

export const SCHEDULE_IMPORT_FIELD_ORDER: ScheduleImportField[] = [
  "description",
  "activity_id",
  "duration_days",
  "start_date",
  "finish_date",
  "wbs",
];

export const SCHEDULE_IMPORT_FIELD_LABELS: Record<ScheduleImportField, string> = {
  activity_id: "Activity ID",
  description: "Description",
  duration_days: "Duration (days)",
  start_date: "Start",
  finish_date: "Finish",
  wbs: "WBS / area",
};

export const SCHEDULE_IMPORT_DEFAULT_DURATION_DAYS = 1;

// Header aliases, matched after normalizing case/punctuation. Exact alias
// matches claim a column first; contains-matches fill remaining fields.
const SCHEDULE_IMPORT_HEADER_ALIASES: Record<ScheduleImportField, string[]> = {
  description: [
    "description",
    "activity description",
    "task description",
    "activity name",
    "task name",
    "activity",
    "task",
    "name",
    "scope",
    "work item",
    "title",
  ],
  activity_id: [
    "activity id",
    "act id",
    "task id",
    "id",
    "uid",
    "activity code",
    "task code",
    "code",
    "row id",
    "no",
    "num",
    "line",
    "line no",
  ],
  duration_days: [
    "duration",
    "duration days",
    "dur",
    "dur days",
    "original duration",
    "orig duration",
    "orig dur",
    "od",
    "days",
    "workdays",
    "work days",
  ],
  start_date: [
    "start",
    "start date",
    "planned start",
    "baseline start",
    "early start",
    "scheduled start",
    "begin",
    "begin date",
    "from",
  ],
  finish_date: [
    "finish",
    "finish date",
    "end",
    "end date",
    "planned finish",
    "baseline finish",
    "early finish",
    "scheduled finish",
    "completion",
    "complete date",
    "due",
    "due date",
    "to",
  ],
  wbs: [
    "wbs",
    "wbs area",
    "wbs code",
    "area",
    "phase",
    "division",
    "section",
    "zone",
    "stage",
    "trade",
    "group",
    "category",
  ],
};

function normalizeImportHeader(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function guessScheduleImportColumnMap(headerRow: string[]): ScheduleImportColumnMap {
  const map: ScheduleImportColumnMap = {
    activity_id: -1,
    description: -1,
    duration_days: -1,
    start_date: -1,
    finish_date: -1,
    wbs: -1,
  };
  const headers = headerRow.map(normalizeImportHeader);
  const claimed = new Set<number>();

  // Pass 1: exact alias match, in field priority order, in alias order.
  for (const field of SCHEDULE_IMPORT_FIELD_ORDER) {
    for (const alias of SCHEDULE_IMPORT_HEADER_ALIASES[field]) {
      const column = headers.findIndex((header, index) => !claimed.has(index) && header === alias);
      if (column !== -1) {
        map[field] = column;
        claimed.add(column);
        break;
      }
    }
  }

  // Pass 2: the header contains an alias as a whole word ("Act. Start Date").
  for (const field of SCHEDULE_IMPORT_FIELD_ORDER) {
    if (map[field] !== -1) continue;
    for (const alias of SCHEDULE_IMPORT_HEADER_ALIASES[field]) {
      const column = headers.findIndex(
        (header, index) =>
          !claimed.has(index) && header.length > 0 && ` ${header} `.includes(` ${alias} `),
      );
      if (column !== -1) {
        map[field] = column;
        claimed.add(column);
        break;
      }
    }
  }

  return map;
}

// Durations arrive as "10", "10d", "10 days", "2w", "2 wks", "1.5w". Weeks
// convert at 7 calendar days to stay consistent with how the grid derives
// durations from date spans. Unreadable input returns null so the preview can
// flag the row and let the default apply.
export function parseScheduleImportDuration(value: string): number | null {
  const cleaned = value.trim().toLowerCase().replace(/,/g, "");
  if (!cleaned) return null;
  const match = cleaned.match(
    /^(\d+(?:\.\d+)?)\s*(d|day|days|wd|wds|workday|workdays|w|wk|wks|week|weeks)?\.?$/,
  );
  if (!match) return null;
  const amount = Number.parseFloat(match[1]);
  if (!Number.isFinite(amount)) return null;
  const unit = match[2] ?? "";
  const days = unit.startsWith("w") && unit !== "wd" && unit !== "wds" ? amount * 7 : amount;
  const rounded = Math.ceil(days);
  if (rounded < 0 || rounded > 3650) return null;
  return rounded;
}

const IMPORT_MONTH_NAMES: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

function toIsoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  const date = new Date(ms);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date.toISOString().slice(0, 10);
}

function expandTwoDigitYear(year: number) {
  return year >= 70 ? 1900 + year : 2000 + year;
}

// Accepts ISO dates, US slash/dash dates, P6-style "05-Jan-26", "Jan 5 2026",
// and Excel serial numbers (SheetJS emits those when a sheet stores real
// dates). Returns an ISO yyyy-mm-dd string or null when unreadable.
export function parseScheduleImportDate(value: string): string | null {
  const cleaned = value.trim();
  if (!cleaned) return null;

  const iso = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = cleaned.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/);
  if (slash) {
    const year = slash[3].length === 2 ? expandTwoDigitYear(Number(slash[3])) : Number(slash[3]);
    return toIsoDate(year, Number(slash[1]), Number(slash[2]));
  }

  const dayMonth = cleaned.match(/^(\d{1,2})[\s-]([A-Za-z]{3,})[\s-,]*(\d{2}|\d{4})$/);
  if (dayMonth) {
    const month = IMPORT_MONTH_NAMES[dayMonth[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    const year =
      dayMonth[3].length === 2 ? expandTwoDigitYear(Number(dayMonth[3])) : Number(dayMonth[3]);
    return toIsoDate(year, month, Number(dayMonth[1]));
  }

  const monthDay = cleaned.match(/^([A-Za-z]{3,})[\s-]+(\d{1,2}),?\s*(\d{2}|\d{4})$/);
  if (monthDay) {
    const month = IMPORT_MONTH_NAMES[monthDay[1].slice(0, 3).toLowerCase()];
    if (!month) return null;
    const year =
      monthDay[3].length === 2 ? expandTwoDigitYear(Number(monthDay[3])) : Number(monthDay[3]);
    return toIsoDate(year, month, Number(monthDay[2]));
  }

  // Excel serial date: days since 1899-12-30. 20000 ≈ 1954, 80000 ≈ 2119.
  const serial = cleaned.match(/^\d{5}(?:\.\d+)?$/);
  if (serial) {
    const serialDays = Math.floor(Number(cleaned));
    if (serialDays >= 20000 && serialDays <= 80000) {
      const ms = Date.UTC(1899, 11, 30) + serialDays * DAY_MS;
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  return null;
}

export type ScheduleImportRowIssue = { level: "error" | "warning"; message: string };

export type ScheduleImportPreviewRow = {
  rowNumber: number;
  include: boolean;
  description: string;
  activityId: string;
  wbs: string;
  durationRaw: string;
  durationDays: number | null;
  startRaw: string;
  startDate: string | null;
  finishRaw: string;
  finishDate: string | null;
  issues: ScheduleImportRowIssue[];
};

function parseImportDateMs(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

function isoFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function getScheduleImportDateSpanDays(startDate: string | null, finishDate: string | null) {
  const start = parseImportDateMs(startDate);
  const finish = parseImportDateMs(finishDate);
  if (start == null || finish == null) return null;
  return Math.max(1, Math.round((finish - start) / DAY_MS) + 1);
}

function getMappedCell(row: string[], column: number) {
  if (column < 0 || column >= row.length) return "";
  return (row[column] ?? "").trim();
}

export function buildScheduleImportPreviewRows(
  matrix: string[][],
  hasHeader: boolean,
  map: ScheduleImportColumnMap,
): ScheduleImportPreviewRow[] {
  const dataRows = hasHeader ? matrix.slice(1) : matrix;
  return dataRows
    .map((row, index) => {
      const issues: ScheduleImportRowIssue[] = [];
      const description = getMappedCell(row, map.description);
      const durationRaw = getMappedCell(row, map.duration_days);
      const startRaw = getMappedCell(row, map.start_date);
      const finishRaw = getMappedCell(row, map.finish_date);

      const durationDays = durationRaw ? parseScheduleImportDuration(durationRaw) : null;
      if (durationRaw && durationDays == null) {
        issues.push({
          level: "warning",
          message: `Couldn't read duration "${durationRaw}" — the default duration will apply.`,
        });
      }

      let startDate = startRaw ? parseScheduleImportDate(startRaw) : null;
      if (startRaw && !startDate) {
        issues.push({
          level: "warning",
          message: `Couldn't read start date "${startRaw}".`,
        });
      }
      let finishDate = finishRaw ? parseScheduleImportDate(finishRaw) : null;
      if (finishRaw && !finishDate) {
        issues.push({
          level: "warning",
          message: `Couldn't read finish date "${finishRaw}".`,
        });
      }
      const startMs = parseImportDateMs(startDate);
      const finishMs = parseImportDateMs(finishDate);
      if (startMs != null && finishMs != null && finishMs < startMs) {
        issues.push({
          level: "warning",
          message: "Finish was before start — the dates were swapped.",
        });
        [startDate, finishDate] = [finishDate, startDate];
      }

      if (!description) {
        issues.push({ level: "error", message: "Description is blank — this row needs one." });
      }

      return {
        rowNumber: index + 1,
        include: Boolean(description),
        description,
        activityId: getMappedCell(row, map.activity_id),
        wbs: getMappedCell(row, map.wbs),
        durationRaw,
        durationDays,
        startRaw,
        startDate,
        finishRaw,
        finishDate,
        issues,
      };
    })
    .filter(
      (row) =>
        row.description ||
        row.activityId ||
        row.durationRaw ||
        row.startRaw ||
        row.finishRaw ||
        row.wbs,
    );
}

// The activity fields an import creates. Structurally assignable to the
// workbench's ActivityCreateInput; kept here so node smoke tests avoid
// importing React component modules.
export type ScheduleImportActivityInput = { name: string } & Partial<
  Pick<
    ScheduleActivityRow,
    | "activity_id"
    | "division"
    | "start_date"
    | "finish_date"
    | "baseline_start_date"
    | "baseline_finish_date"
    | "forecast_start_date"
    | "forecast_finish_date"
    | "remaining_duration_days"
    | "percent_complete"
    | "predecessor_activity_ids"
    | "successor_activity_ids"
    | "notes"
    | "sort_order"
  >
>;

// Honors the schedule's numbering style: continues A-### when that pattern is
// in use (or nothing is), and continues plain-number IDs in steps of 10 when
// the schedule numbers rows the P6 way. Always dedupes against existing IDs.
export function createScheduleImportIdAllocator(existingIds: Iterable<string>) {
  const used = new Set<string>();
  let maxAutoNumber = 0;
  let maxNumeric = 0;
  let numericCount = 0;
  let numericWidth = 0;
  let total = 0;
  for (const raw of existingIds) {
    const id = raw.trim();
    if (!id) continue;
    used.add(id.toLowerCase());
    total += 1;
    const auto = id.match(/^A-(\d+)$/i);
    if (auto) maxAutoNumber = Math.max(maxAutoNumber, Number.parseInt(auto[1], 10) || 0);
    const numeric = id.match(/^\d+$/);
    if (numeric) {
      numericCount += 1;
      numericWidth = Math.max(numericWidth, id.length);
      maxNumeric = Math.max(maxNumeric, Number.parseInt(id, 10) || 0);
    }
  }
  const usesNumericStyle = total > 0 && numericCount * 2 > total && maxAutoNumber === 0;

  const claim = (candidate: string) => {
    let next = candidate;
    let suffix = 2;
    while (used.has(next.toLowerCase())) {
      next = `${candidate}-${suffix}`;
      suffix += 1;
    }
    used.add(next.toLowerCase());
    return next;
  };

  return {
    // Uses the supplied ID when the file has one; otherwise generates the next
    // ID in the schedule's own style.
    next(suppliedId: string) {
      const supplied = suppliedId.trim();
      if (supplied) return claim(supplied);
      if (usesNumericStyle) {
        maxNumeric += 10;
        return claim(String(maxNumeric).padStart(numericWidth, "0"));
      }
      maxAutoNumber += 1;
      return claim(`A-${String(maxAutoNumber).padStart(3, "0")}`);
    },
  };
}

export type ScheduleImportBuildOptions = {
  defaultDurationDays: number;
  // Anchor for rows that arrive with no dates: the first such row starts here
  // (or right after the previous row), reading the file top to bottom.
  anchorDate: string;
  sourceLabel: string;
};

export function buildScheduleImportActivityInputs(
  rows: ScheduleImportPreviewRow[],
  existingActivities: Pick<ScheduleActivityRow, "activity_id" | "sort_order">[],
  options: ScheduleImportBuildOptions,
): ScheduleImportActivityInput[] {
  const allocator = createScheduleImportIdAllocator(
    existingActivities.map((activity) => activity.activity_id),
  );
  const maxSortOrder = existingActivities.reduce(
    (max, activity) => Math.max(max, activity.sort_order ?? 0),
    0,
  );
  const defaultDuration = Math.max(1, Math.round(options.defaultDurationDays) || 1);
  const anchorMs = parseImportDateMs(options.anchorDate);
  let cursorMs = anchorMs;

  const inputs: ScheduleImportActivityInput[] = [];
  for (const row of rows) {
    if (!row.include || !row.description) continue;
    const spanDays = getScheduleImportDateSpanDays(row.startDate, row.finishDate);
    const durationDays = spanDays ?? row.durationDays ?? defaultDuration;

    let startDate = row.startDate;
    let finishDate = row.finishDate;
    let datesWerePlaced = false;
    if (startDate && !finishDate) {
      const startMs = parseImportDateMs(startDate);
      if (startMs != null) finishDate = isoFromMs(startMs + (durationDays - 1) * DAY_MS);
    } else if (!startDate && finishDate) {
      const finishMs = parseImportDateMs(finishDate);
      if (finishMs != null) startDate = isoFromMs(finishMs - (durationDays - 1) * DAY_MS);
    } else if (!startDate && !finishDate && cursorMs != null) {
      startDate = isoFromMs(cursorMs);
      finishDate = isoFromMs(cursorMs + (durationDays - 1) * DAY_MS);
      datesWerePlaced = true;
    }
    const finishMs = parseImportDateMs(finishDate);
    if (finishMs != null) cursorMs = finishMs + DAY_MS;

    const notes = [
      `Imported from ${options.sourceLabel}.`,
      datesWerePlaced
        ? "Dates were placed from the import order — adjust them or tag logic ties to let CPM place this row."
        : "",
    ]
      .filter(Boolean)
      .join(" ");

    inputs.push({
      activity_id: allocator.next(row.activityId),
      name: row.description,
      division: row.wbs || "General",
      start_date: startDate,
      finish_date: finishDate,
      baseline_start_date: startDate,
      baseline_finish_date: finishDate,
      forecast_start_date: startDate,
      forecast_finish_date: finishDate,
      percent_complete: 0,
      predecessor_activity_ids: [],
      successor_activity_ids: [],
      notes,
      sort_order: maxSortOrder + inputs.length + 1,
    });
  }
  return inputs;
}

// --- Build from SOV -------------------------------------------------------

// CSI MasterFormat division names contractors already know. Used to turn a
// cost code like 03-300 into a WBS label like "03 Concrete".
const CSI_DIVISION_NAMES: Record<string, string> = {
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood & Composites",
  "07": "Thermal & Moisture",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "25": "Integrated Automation",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
};

export function getSovCostCodeWbsLabel(costCode: string): string {
  const prefix = costCode.trim().match(/^(\d{1,2})/)?.[1];
  if (!prefix) return "General";
  const padded = prefix.padStart(2, "0");
  const name = CSI_DIVISION_NAMES[padded];
  return name ? `${padded} ${name}` : `Division ${padded}`;
}

export type SovScheduleLine = {
  cost_code: string;
  bucket: string;
  sort_order: number;
};

// One proposed activity per SOV line: description from the line, WBS from the
// cost-code division, duration left to the default. Lines whose description
// already matches an activity name come in unchecked — suggest, never force.
export function buildSovSchedulePreviewRows(
  lines: SovScheduleLine[],
  existingActivities: Pick<ScheduleActivityRow, "name">[],
): ScheduleImportPreviewRow[] {
  const existingNames = new Set(
    existingActivities.map((activity) => activity.name.trim().toLowerCase().replace(/\s+/g, " ")),
  );
  return [...lines]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((line, index) => {
      const description = line.bucket.trim();
      const issues: ScheduleImportRowIssue[] = [];
      let include = Boolean(description);
      if (!description) {
        issues.push({ level: "error", message: "This SOV line has no description." });
      } else if (existingNames.has(description.toLowerCase().replace(/\s+/g, " "))) {
        include = false;
        issues.push({
          level: "warning",
          message: "An activity with this name is already in the schedule.",
        });
      }
      return {
        rowNumber: index + 1,
        include,
        description,
        activityId: "",
        wbs: getSovCostCodeWbsLabel(line.cost_code),
        durationRaw: "",
        durationDays: null,
        startRaw: "",
        startDate: null,
        finishRaw: "",
        finishDate: null,
        issues,
      };
    });
}
