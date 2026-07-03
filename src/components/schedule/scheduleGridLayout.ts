import {
  CONSTRUCTLINE_FIT_DAY_PX,
  CONSTRUCTLINE_MAX_DAY_PX,
  CONSTRUCTLINE_MIN_DAY_PX,
  CONSTRUCTLINE_TABLE_COLUMN_SPECS,
  CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_NAMESPACE,
  CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION,
  type ConstructLineGridLayoutPreset,
  type ConstructLineStoredGridLayout,
  type ConstructLineTableColumnId,
  type ConstructLineTableColumnWidths,
  clampNumber,
} from "./scheduleShared";

export function buildDefaultTableColumnWidths(
  isFocusMode: boolean,
): ConstructLineTableColumnWidths {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((widths, column) => {
    widths[column.id] =
      column.id === "activity" && isFocusMode ? Math.min(column.max, 132) : column.default;
    return widths;
  }, {} as ConstructLineTableColumnWidths);
}

export function buildTableColumnWidthsForPreset(
  preset: ConstructLineGridLayoutPreset,
): ConstructLineTableColumnWidths {
  const widths = buildDefaultTableColumnWidths(false);
  if (preset === "gantt") {
    widths.id = 42;
    widths.activity = 104;
    widths.dur = 38;
    widths.plan = 58;
    widths.current = 62;
    widths.slip = 36;
    widths.done = 34;
    widths.tf = 38;
    widths.logic = 48;
  } else if (preset === "balanced") {
    widths.id = 46;
    widths.activity = 132;
    widths.dur = 42;
    widths.plan = 64;
    widths.current = 70;
    widths.slip = 40;
    widths.done = 38;
    widths.tf = 42;
    widths.logic = 52;
  } else if (preset === "detail") {
    widths.id = 52;
    widths.activity = 190;
    widths.dur = 48;
    widths.plan = 82;
    widths.current = 92;
    widths.slip = 48;
    widths.done = 48;
    widths.tf = 48;
    widths.logic = 58;
  }
  return widths;
}

export function buildTableColumnTemplate(widths: ConstructLineTableColumnWidths) {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.map((column) => `${widths[column.id]}px`).join(" ");
}

export function getTableColumnWidth(widths: ConstructLineTableColumnWidths) {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((sum, column) => sum + widths[column.id], 0);
}

export function getTableColumnMinWidth() {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((sum, column) => sum + column.min, 0);
}

export function getTableColumnMaxWidth() {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((sum, column) => sum + column.max, 0);
}

function getTableColumnSpec(columnId: ConstructLineTableColumnId) {
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.find((column) => column.id === columnId);
}

const CONSTRUCTLINE_TABLE_SPLIT_SHRINK_ORDER: ConstructLineTableColumnId[] = [
  "activity",
  "current",
  "plan",
  "logic",
  "tf",
  "slip",
  "done",
  "dur",
  "id",
];

const CONSTRUCTLINE_TABLE_SPLIT_GROW_ORDER: ConstructLineTableColumnId[] = [
  "current",
  "plan",
  "logic",
  "tf",
  "dur",
  "slip",
  "done",
  "id",
  "activity",
];

export function resizeTableColumnWidthsToTarget(
  widths: ConstructLineTableColumnWidths,
  targetTableWidth: number,
) {
  const target = Math.round(
    clampNumber(targetTableWidth, getTableColumnMinWidth(), getTableColumnMaxWidth()),
  );
  let remainingDelta = target - getTableColumnWidth(widths);
  const next = { ...widths };
  const order =
    remainingDelta < 0
      ? CONSTRUCTLINE_TABLE_SPLIT_SHRINK_ORDER
      : CONSTRUCTLINE_TABLE_SPLIT_GROW_ORDER;

  for (const columnId of order) {
    if (remainingDelta === 0) break;
    const spec = getTableColumnSpec(columnId);
    if (!spec) continue;
    if (remainingDelta < 0) {
      const capacity = Math.max(0, next[columnId] - spec.min);
      const adjustment = Math.min(capacity, Math.abs(remainingDelta));
      next[columnId] -= adjustment;
      remainingDelta += adjustment;
    } else {
      const capacity = Math.max(0, spec.max - next[columnId]);
      const adjustment = Math.min(capacity, remainingDelta);
      next[columnId] += adjustment;
      remainingDelta -= adjustment;
    }
  }

  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((normalized, column) => {
    normalized[column.id] = Math.round(clampNumber(next[column.id], column.min, column.max));
    return normalized;
  }, {} as ConstructLineTableColumnWidths);
}

export function getCpmGridLayoutStorageKey(projectId: string) {
  return `${CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_NAMESPACE}:${projectId}`;
}

function getTableColumnLayoutStorageKeys(storageKey: string | undefined) {
  if (!storageKey) return [];
  const versionSuffix = `:${CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION}`;
  const stableKey = storageKey.endsWith(versionSuffix)
    ? storageKey.slice(0, -versionSuffix.length)
    : storageKey;
  return Array.from(new Set([stableKey, `${stableKey}${versionSuffix}`, storageKey]));
}

function readStoredGridLayoutRecord(storageKey: string | undefined) {
  if (!storageKey || typeof window === "undefined") return null;
  for (const key of getTableColumnLayoutStorageKeys(storageKey)) {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as ConstructLineStoredGridLayout;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Ignore one bad saved layout and keep looking for a legacy key before falling back.
    }
  }
  return null;
}

function parseStoredTableColumnWidths(
  layout: ConstructLineStoredGridLayout,
  fallback: ConstructLineTableColumnWidths,
): ConstructLineTableColumnWidths | null {
  if (!layout.widths) return null;
  return CONSTRUCTLINE_TABLE_COLUMN_SPECS.reduce((widths, column) => {
    const storedWidth = layout.widths?.[column.id];
    widths[column.id] =
      typeof storedWidth === "number"
        ? Math.round(clampNumber(storedWidth, column.min, column.max))
        : fallback[column.id];
    return widths;
  }, {} as ConstructLineTableColumnWidths);
}

export function readTableColumnWidths(
  storageKey: string | undefined,
  isFocusMode: boolean,
): ConstructLineTableColumnWidths {
  const fallback = buildDefaultTableColumnWidths(isFocusMode);
  if (!storageKey || typeof window === "undefined") return fallback;
  const storedLayout = readStoredGridLayoutRecord(storageKey);
  if (!storedLayout) return fallback;
  return parseStoredTableColumnWidths(storedLayout, fallback) ?? fallback;
}

export function readStoredGridDayPx(storageKey: string | undefined) {
  const storedDayPx = readStoredGridLayoutRecord(storageKey)?.dayPx;
  return typeof storedDayPx === "number" && Number.isFinite(storedDayPx)
    ? clampNumber(storedDayPx, CONSTRUCTLINE_MIN_DAY_PX, CONSTRUCTLINE_MAX_DAY_PX)
    : CONSTRUCTLINE_FIT_DAY_PX;
}

export function writeStoredGridLayout(
  storageKey: string | undefined,
  patch: Partial<Pick<ConstructLineStoredGridLayout, "widths" | "dayPx">>,
) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    const [primaryStorageKey] = getTableColumnLayoutStorageKeys(storageKey);
    if (!primaryStorageKey) return;
    const current = readStoredGridLayoutRecord(storageKey) ?? {};
    window.localStorage.setItem(
      primaryStorageKey,
      JSON.stringify({
        ...current,
        ...patch,
        version: CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Browser storage can be unavailable in private sessions; the grid still works in memory.
  }
}

export function writeTableColumnWidths(
  storageKey: string | undefined,
  widths: ConstructLineTableColumnWidths,
) {
  writeStoredGridLayout(storageKey, { widths });
}
