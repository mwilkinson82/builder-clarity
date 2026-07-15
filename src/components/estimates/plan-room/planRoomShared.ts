import type {
  PlanSetRow,
  PlanSheetRow,
  TakeoffMeasurementRow,
  TakeoffToolType,
} from "@/lib/plan-room.functions";
import {
  calculateTakeoffQuantity,
  distancePx,
  formatFeetInches,
  type PlanRoomPoint,
  type PlanRoomViewSize,
  normalizeTakeoffUnit,
} from "@/lib/plan-room-math";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates.functions";
import { downloadTextFile as downloadTextFileShared } from "@/lib/download-file";

// "ruler" is a question, not a takeoff: quick two-point (or chained) distance
// checks that are never persisted and never reach the worksheet.
export type ToolMode = "select" | "calibrate" | "verify" | "ruler" | TakeoffToolType;
export type RevisionOverlayMode = "compare" | "ghost";
export type CockpitPanelKey = "drawings" | "tools";
export type CockpitPanelAnchor = "left" | "right";
export type CockpitPanelLayout = {
  anchor: CockpitPanelAnchor;
  x: number | null;
  y: number;
  width: number;
  height: number;
};
export type CockpitPanelInteraction = {
  key: CockpitPanelKey;
  mode: "move" | "resize";
  offsetX: number;
  offsetY: number;
  startWidth: number;
  startHeight: number;
};
export type MiniMapDock = "bottom-left" | "bottom-right" | "top-left" | "top-right";
export type MiniMapPosition = { x: number; y: number };
export type SheetFilterMode = "all" | "current" | "needs-scale" | "has-takeoff";
export type TakeoffFilterMode = "all" | "sheet" | "unlinked" | "linked";
export type TakeoffLayerKey = TakeoffToolType | "linked" | "unlinked";
export type TakeoffLayerVisibility = Record<TakeoffLayerKey, boolean>;
export type Point = PlanRoomPoint;
export type ViewSize = PlanRoomViewSize;
export type ZoomWindowDraft = { start: Point; end: Point };
export type ViewportFrame = { x: number; y: number; width: number; height: number };
export type PdfRenderPlan = {
  renderScale: number;
  desiredScale: number;
  capped: boolean;
  maxEdge: number;
  maxPixels: number;
};
export type PdfDetailMode = "fast" | "sharp" | "max";
export type PdfDetailOption = {
  mode: PdfDetailMode;
  label: string;
  badge: string;
  testId: string;
  multiplier: number;
  title: string;
};
export type RenderQualityStatus = {
  label: string;
  details: string;
  capped?: boolean;
};
export type DraftCommandStatus = {
  title: string;
  value: string;
  detail: string;
  ready: boolean;
  actionLabel: string;
};
export type GeometryEditDraft = {
  measurementId: string;
  pointIndex: number;
  points: Point[];
};

export const DEFAULT_VIEW_SIZE: ViewSize = { width: 960, height: 620 };
// Sixteen drawing-legible markup colors (beta batch 2): dark, saturated tones
// that hold contrast on white paper and against dense linework — no pale
// pastels that vanish on a sheet. The original five lead so existing takeoffs
// keep their swatch position.
export const TAKEOFF_COLORS = [
  "#1b7a6e", // teal
  "#b35035", // rust
  "#946a21", // ochre
  "#375d8a", // steel blue
  "#5d5f6f", // slate
  "#b91c1c", // red
  "#15803d", // green
  "#1d4ed8", // royal blue
  "#c2410c", // orange
  "#7c3aed", // violet
  "#be185d", // magenta
  "#0e7490", // cyan
  "#4d7c0f", // olive
  "#78350f", // brown
  "#6b21a8", // deep purple
  "#1f2937", // charcoal
];
// The ruler draws in a color outside the takeoff palette so a quick check
// never reads as a saved markup.
export const RULER_COLOR = "#0369a1";
export const TAKEOFF_LAYER_KEYS: TakeoffLayerKey[] = [
  "linear",
  "area",
  "count",
  "linked",
  "unlinked",
];
export const DEFAULT_TAKEOFF_LAYER_VISIBILITY: TakeoffLayerVisibility = {
  linear: true,
  area: true,
  count: true,
  linked: true,
  unlinked: true,
};
export const TAKEOFF_LAYER_COPY: Record<TakeoffLayerKey, { label: string; detail: string }> = {
  linear: { label: "Linear", detail: "LF runs" },
  area: { label: "Area", detail: "SF zones" },
  count: { label: "Count", detail: "EA markers" },
  linked: { label: "Linked", detail: "feeding rows" },
  unlinked: { label: "Unlinked", detail: "not assigned" },
};
export const TAKEOFF_LAYER_TEST_IDS: Record<TakeoffLayerKey, string> = {
  linear: "takeoff-layer-linear",
  area: "takeoff-layer-area",
  count: "takeoff-layer-count",
  linked: "takeoff-layer-linked",
  unlinked: "takeoff-layer-unlinked",
};
// Quick two-point calibration distances. Detail-scale calibration needs
// short runs, so these start at one foot; the field accepts feet + inches.
export const QUICK_CALIBRATION_FEET = [1, 5, 10];

// Stated-scale presets for vector PDFs (X paper inches = Y real feet).
export type StatedScalePreset = {
  id: string;
  label: string;
  statedInches: number;
  statedFeet: number;
};

export const ARCHITECTURAL_SCALE_PRESETS: StatedScalePreset[] = [
  { id: "arch-3-32", label: '3/32" = 1\'-0"', statedInches: 3 / 32, statedFeet: 1 },
  { id: "arch-1-8", label: '1/8" = 1\'-0"', statedInches: 1 / 8, statedFeet: 1 },
  { id: "arch-3-16", label: '3/16" = 1\'-0"', statedInches: 3 / 16, statedFeet: 1 },
  { id: "arch-1-4", label: '1/4" = 1\'-0"', statedInches: 1 / 4, statedFeet: 1 },
  { id: "arch-3-8", label: '3/8" = 1\'-0"', statedInches: 3 / 8, statedFeet: 1 },
  { id: "arch-1-2", label: '1/2" = 1\'-0"', statedInches: 1 / 2, statedFeet: 1 },
  { id: "arch-3-4", label: '3/4" = 1\'-0"', statedInches: 3 / 4, statedFeet: 1 },
  { id: "arch-1", label: '1" = 1\'-0"', statedInches: 1, statedFeet: 1 },
  { id: "arch-1-1-2", label: '1-1/2" = 1\'-0"', statedInches: 1.5, statedFeet: 1 },
  { id: "arch-3", label: '3" = 1\'-0"', statedInches: 3, statedFeet: 1 },
];

export const ENGINEERING_SCALE_PRESETS: StatedScalePreset[] = [10, 20, 30, 40, 50, 60, 100].map(
  (feet) => ({
    id: `eng-${feet}`,
    label: `1" = ${feet}'`,
    statedInches: 1,
    statedFeet: feet,
  }),
);

export const STATED_SCALE_PRESETS: StatedScalePreset[] = [
  ...ARCHITECTURAL_SCALE_PRESETS,
  ...ENGINEERING_SCALE_PRESETS,
];

// Trust states for a sheet's scale: no scale at all, a scale that has not
// been checked against a labeled dimension, or a verified scale.
export function sheetScaleStatus(
  sheet: Pick<PlanSheetRow, "scale_feet_per_pixel" | "scale_verified_at"> | null,
): "none" | "unverified" | "verified" {
  if (!sheet || !sheet.scale_feet_per_pixel) return "none";
  return sheet.scale_verified_at ? "verified" : "unverified";
}
export const MIN_PLAN_ZOOM = 0.25;
export const MAX_PLAN_ZOOM = 4;
export const PLAN_ZOOM_STEP = 0.25;
export const ZOOM_SLIDER_MIN = MIN_PLAN_ZOOM * 100;
export const ZOOM_SLIDER_MAX = MAX_PLAN_ZOOM * 100;
export const PDF_BASE_LONG_EDGE = 1800;
export const PDF_STANDARD_RENDER_MAX_EDGE = 8192;
export const PDF_STANDARD_RENDER_MAX_PIXELS = 24_000_000;
export const PDF_HIGH_DETAIL_RENDER_MAX_EDGE = 12_288;
export const PDF_HIGH_DETAIL_RENDER_MAX_PIXELS = 72_000_000;
export const PDF_INSPECTION_RENDER_MULTIPLIER = 2;
export const DEFAULT_PDF_DETAIL_MODE: PdfDetailMode = "max";
export const PDF_DETAIL_OPTIONS: PdfDetailOption[] = [
  {
    mode: "fast",
    label: "Fast",
    badge: "Fast PDF",
    testId: "plan-pdf-detail-fast",
    multiplier: 1,
    title: "Fast render for quick sheet navigation.",
  },
  {
    mode: "sharp",
    label: "Sharp",
    badge: "Sharp PDF",
    testId: "plan-pdf-detail-sharp",
    multiplier: PDF_INSPECTION_RENDER_MULTIPLIER,
    title: "Sharper render for reading notes while you estimate.",
  },
  {
    mode: "max",
    label: "Max",
    badge: "Max Detail",
    testId: "plan-pdf-detail-max",
    multiplier: 3,
    title: "Highest available render detail for zoomed-in plan review.",
  },
];
export const PDF_DETAIL_OPTION_BY_MODE = PDF_DETAIL_OPTIONS.reduce(
  (options, option) => ({ ...options, [option.mode]: option }),
  {} as Record<PdfDetailMode, PdfDetailOption>,
);
export const EMPTY_VIEWPORT_FRAME: ViewportFrame = { x: 0, y: 0, width: 1, height: 1 };
export const COCKPIT_PANEL_EDGE_GAP = 8;
export const COCKPIT_PANEL_MIN_WIDTH = 280;
export const COCKPIT_PANEL_MAX_WIDTH = 540;
export const COCKPIT_PANEL_MIN_HEIGHT = 280;
export const COCKPIT_PANEL_MAX_HEIGHT = 920;
export const COCKPIT_CHROME_PANEL_TOP_GAP = 72;
export const COCKPIT_PANEL_LAYOUT_STORAGE_KEY = "overwatch.plan-room.cockpit-panels.v2";
export const DEFAULT_COCKPIT_PANEL_LAYOUTS: Record<CockpitPanelKey, CockpitPanelLayout> = {
  drawings: {
    anchor: "left",
    x: null,
    y: COCKPIT_CHROME_PANEL_TOP_GAP,
    width: 360,
    height: 680,
  },
  tools: {
    anchor: "right",
    x: null,
    y: COCKPIT_CHROME_PANEL_TOP_GAP,
    width: 390,
    height: 720,
  },
};

export type PdfViewportLike = { width: number; height: number };

// Some embedded browsers throw on any localStorage access. Panel layout
// persistence falls back to this in-memory copy so dragged positions still
// survive for the rest of the session when persistent storage is unavailable.
let cockpitPanelLayoutMemoryStore: string | null = null;

export const readCockpitPanelLayoutStorage = (): string | null => {
  if (typeof window === "undefined") return cockpitPanelLayoutMemoryStore;
  try {
    return (
      window.localStorage.getItem(COCKPIT_PANEL_LAYOUT_STORAGE_KEY) ?? cockpitPanelLayoutMemoryStore
    );
  } catch {
    return cockpitPanelLayoutMemoryStore;
  }
};

export const writeCockpitPanelLayoutStorage = (value: string) => {
  cockpitPanelLayoutMemoryStore = value;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COCKPIT_PANEL_LAYOUT_STORAGE_KEY, value);
  } catch {
    // Storage is blocked; the in-memory copy above keeps the session working.
  }
};

export const clearCockpitPanelLayoutStorage = () => {
  cockpitPanelLayoutMemoryStore = null;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(COCKPIT_PANEL_LAYOUT_STORAGE_KEY);
  } catch {
    // Storage is blocked; there is nothing persistent left to clear.
  }
};

// Last-viewed sheet per estimate, so reopening the Plan Room lands where the
// contractor left off. Same storage-blocked fallback story as the panel
// layouts: an in-memory copy keeps the session working.
const LAST_VIEWED_SHEET_STORAGE_PREFIX = "overwatch.plan-room.last-sheet.v1.";
const lastViewedSheetMemoryStore = new Map<string, string>();

export const readLastViewedSheetStorage = (estimateId: string): string | null => {
  if (typeof window === "undefined") return lastViewedSheetMemoryStore.get(estimateId) ?? null;
  try {
    return (
      window.localStorage.getItem(`${LAST_VIEWED_SHEET_STORAGE_PREFIX}${estimateId}`) ??
      lastViewedSheetMemoryStore.get(estimateId) ??
      null
    );
  } catch {
    return lastViewedSheetMemoryStore.get(estimateId) ?? null;
  }
};

export const writeLastViewedSheetStorage = (estimateId: string, sheetId: string) => {
  lastViewedSheetMemoryStore.set(estimateId, sheetId);
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${LAST_VIEWED_SHEET_STORAGE_PREFIX}${estimateId}`, sheetId);
  } catch {
    // Storage is blocked; the in-memory copy above keeps the session working.
  }
};

export const cockpitPanelLayoutsEqual = (a: CockpitPanelLayout, b: CockpitPanelLayout) =>
  a.anchor === b.anchor &&
  a.x === b.x &&
  a.y === b.y &&
  a.width === b.width &&
  a.height === b.height;

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const coerceCockpitPanelLayout = (
  value: unknown,
  fallback: CockpitPanelLayout,
): CockpitPanelLayout => {
  if (!value || typeof value !== "object") return fallback;
  const raw = value as Partial<CockpitPanelLayout>;
  const anchor =
    raw.anchor === "right" ? "right" : raw.anchor === "left" ? "left" : fallback.anchor;
  const x = typeof raw.x === "number" && Number.isFinite(raw.x) ? Math.max(0, raw.x) : fallback.x;
  const y =
    typeof raw.y === "number" && Number.isFinite(raw.y)
      ? Math.max(COCKPIT_PANEL_EDGE_GAP, raw.y)
      : fallback.y;
  return {
    anchor,
    x,
    y,
    width: clampNumber(
      typeof raw.width === "number" && Number.isFinite(raw.width) ? raw.width : fallback.width,
      COCKPIT_PANEL_MIN_WIDTH,
      COCKPIT_PANEL_MAX_WIDTH,
    ),
    height: clampNumber(
      typeof raw.height === "number" && Number.isFinite(raw.height) ? raw.height : fallback.height,
      COCKPIT_PANEL_MIN_HEIGHT,
      COCKPIT_PANEL_MAX_HEIGHT,
    ),
  };
};

export const planSetStatusLabel = (status: PlanSetRow["status"]) => {
  if (status === "superseded") return "Superseded";
  if (status === "archive") return "Archived";
  return "Current";
};

export const sheetDisplayName = (sheet: PlanSheetRow, planSet?: PlanSetRow | null) => {
  const sheetName =
    `${sheet.sheet_number || `Page ${sheet.page_number}`} ${sheet.sheet_name}`.trim();
  return planSet ? `${sheetName} - ${planSet.name}` : sheetName;
};

export const formatQty = (value: number, unit: string) =>
  `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)}${unit ? ` ${unit}` : ""}`;

export const centsToDollars = (value: number) => Math.round(value) / 100;

export const normalizeSearch = (value: string) => value.trim().toLowerCase();

export const searchMatches = (query: string, values: Array<string | number | null | undefined>) => {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedQuery),
  );
};

export const safeReportFileName = (value: string, ext: string) =>
  `${
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "plan-room-takeoffs"
  }.${ext}`;

export function toCsvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Delegates to the shared safe download path (delayed blob-URL revoke —
// synchronous/0ms revoke can cancel the download in Safari/iOS).
export function downloadTextFile(filename: string, content: string, type: string) {
  downloadTextFileShared(filename, content, type);
}

export async function copyTextToClipboard(text: string) {
  if (typeof window === "undefined" || typeof document === "undefined") {
    throw new Error("Clipboard is not available in this browser.");
  }
  if (window.navigator.clipboard?.writeText) {
    try {
      await window.navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea copy path for locked-down browser contexts.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard access was blocked by the browser.");
}

export const reportDate = (value: string) => {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export type TakeoffCsvRow = Array<string | number>;

export function buildTakeoffCsvRows({
  estimate,
  companyName,
  lineItems,
  planSets,
  sheets,
  measurements,
}: {
  estimate: EstimateRow;
  companyName: string;
  lineItems: EstimateLineItemRow[];
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
}): TakeoffCsvRow[] {
  const planSetById = new Map(planSets.map((planSet) => [planSet.id, planSet]));
  const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const lineById = new Map(lineItems.map((line) => [line.id, line]));
  const sheetOrder = new Map(sheets.map((sheet, index) => [sheet.id, index]));
  const sortedMeasurements = [...measurements].sort((a, b) => {
    const sheetSort =
      (sheetOrder.get(a.plan_sheet_id) ?? 9999) - (sheetOrder.get(b.plan_sheet_id) ?? 9999);
    if (sheetSort !== 0) return sheetSort;
    return a.label.localeCompare(b.label);
  });

  return [
    [
      "Company",
      "Estimate",
      "Drawing Set",
      "Sheet Number",
      "Sheet Name",
      "Takeoff Label",
      "Type",
      "Quantity",
      "Unit",
      "Linked Cost Code",
      "Linked Estimate Row",
      "Scope Group",
      "Notes",
      "Created",
      "Updated",
    ],
    ...sortedMeasurements.map((measurement) => {
      const sheet = sheetById.get(measurement.plan_sheet_id);
      const planSet = sheet ? planSetById.get(sheet.plan_set_id) : null;
      const line = measurement.estimate_line_item_id
        ? lineById.get(measurement.estimate_line_item_id)
        : null;
      return [
        companyName,
        estimate.name,
        planSet?.name ?? "",
        sheet?.sheet_number ?? "",
        sheet?.sheet_name ?? "",
        measurement.label,
        toolLabel(measurement.tool_type),
        Number(measurement.quantity.toFixed(3)),
        measurement.unit,
        line?.cost_code ?? "",
        line?.description ?? "",
        line?.scope_group ?? "",
        measurement.notes,
        reportDate(measurement.created_at),
        reportDate(measurement.updated_at),
      ];
    }),
  ];
}

export function buildTakeoffCsv(args: Parameters<typeof buildTakeoffCsvRows>[0]) {
  return buildTakeoffCsvRows(args)
    .map((row) => row.map(toCsvCell).join(","))
    .join("\n");
}

export function buildTakeoffSummary({
  estimate,
  lineItems,
  planSets,
  sheets,
  measurements,
  companyName,
}: {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  companyName: string;
}) {
  const lineById = new Map(lineItems.map((line) => [line.id, line]));
  const planSetById = new Map(planSets.map((planSet) => [planSet.id, planSet]));
  const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
  const linked = measurements.filter((measurement) => measurement.estimate_line_item_id);
  const unlinkedCount = measurements.length - linked.length;
  const toolCounts = TAKEOFF_LAYER_KEYS.slice(0, 3)
    .map(
      (key) =>
        `${TAKEOFF_LAYER_COPY[key].label}: ${measurements.filter((item) => item.tool_type === key).length}`,
    )
    .join(", ");
  const sheetCounts = new Map<string, number>();
  const lineTotals = new Map<string, number>();

  for (const measurement of measurements) {
    sheetCounts.set(
      measurement.plan_sheet_id,
      (sheetCounts.get(measurement.plan_sheet_id) ?? 0) + 1,
    );
    if (measurement.estimate_line_item_id) {
      lineTotals.set(
        measurement.estimate_line_item_id,
        (lineTotals.get(measurement.estimate_line_item_id) ?? 0) + measurement.quantity,
      );
    }
  }

  const sheetSummary = [...sheetCounts.entries()]
    .map(([sheetId, count]) => {
      const sheet = sheetById.get(sheetId);
      const planSet = sheet ? planSetById.get(sheet.plan_set_id) : null;
      return {
        count,
        label: sheet ? `${sheet.sheet_number} ${sheet.sheet_name}`.trim() : "Unknown sheet",
        planSet: planSet?.name ?? "",
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((item) => `- ${item.label}${item.planSet ? ` (${item.planSet})` : ""}: ${item.count}`)
    .join("\n");

  const linkedRowSummary = [...lineTotals.entries()]
    .map(([lineId, quantity]) => {
      const line = lineById.get(lineId);
      if (!line) return null;
      const costCode = line.cost_code ? `${line.cost_code} - ` : "";
      return `- ${costCode}${line.description}: ${formatQty(quantity, line.unit)}`;
    })
    .filter((item): item is string => Boolean(item))
    .slice(0, 12)
    .join("\n");

  return [
    "Plan Room Takeoff Summary",
    `${companyName} - ${estimate.name}`,
    `${measurements.length} takeoffs: ${linked.length} linked, ${unlinkedCount} unlinked`,
    `By type: ${toolCounts}`,
    "",
    "Sheets with takeoffs:",
    sheetSummary || "- None",
    "",
    "Linked estimate rows:",
    linkedRowSummary || "- No takeoffs linked to estimate rows yet",
  ].join("\n");
}

export const slugFileName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 160) || "drawing";

export function geometryPoints(geometry: unknown): Point[] {
  if (!geometry || typeof geometry !== "object") return [];
  const points = (geometry as { points?: unknown }).points;
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const raw = point as { x?: unknown; y?: unknown };
      const x = Number(raw.x);
      const y = Number(raw.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    })
    .filter((point): point is Point => Boolean(point));
}

export function calculateQuantity(
  tool: TakeoffToolType,
  points: Point[],
  sheet: PlanSheetRow,
  size: ViewSize,
) {
  return calculateTakeoffQuantity({
    tool,
    points,
    scaleFeetPerPixel: sheet.scale_feet_per_pixel,
    viewSize: size,
  });
}

export function geometryFromPoints(points: Point[], size: ViewSize) {
  return {
    points,
    view_size: {
      width: Math.round(size.width),
      height: Math.round(size.height),
    },
  };
}

export function draftCommandFor({
  tool,
  points,
  sheet,
  viewSize,
  unit,
}: {
  tool: ToolMode;
  points: Point[];
  sheet: PlanSheetRow | null;
  viewSize: ViewSize;
  unit: string;
}): DraftCommandStatus | null {
  if (tool === "select") return null;

  if (tool === "calibrate") {
    const spanPx = distancePx(points, viewSize);
    return {
      title: "Scale calibration",
      value:
        points.length === 2
          ? `${Math.round(spanPx).toLocaleString()} px`
          : `${points.length}/2 points`,
      detail:
        points.length === 2
          ? "Type the real field distance, then save the sheet scale."
          : "Click both ends of a known dimension on the drawing.",
      ready: points.length === 2 && spanPx > 0,
      actionLabel: "Save Scale",
    };
  }

  if (tool === "verify") {
    const spanPx = distancePx(points, viewSize);
    const measuredFeet = (sheet?.scale_feet_per_pixel ?? 0) * spanPx;
    return {
      title: "Scale check",
      value: points.length === 2 ? formatQty(measuredFeet, "FT") : `${points.length}/2 points`,
      detail:
        points.length === 2
          ? "Type the labeled dimension, then record this assurance check."
          : "Click both ends of a printed dimension. Two checks are required.",
      ready: points.length === 2 && spanPx > 0 && (sheet?.scale_feet_per_pixel ?? 0) > 0,
      actionLabel: "Check Scale",
    };
  }

  if (tool === "ruler") {
    // A question, not a takeoff: reads distance in feet-inches off the active
    // scale and saves nothing. actionLabel stays empty so no finish button
    // renders — there is nothing to finish.
    const scale = sheet?.scale_feet_per_pixel ?? 0;
    const spanFeet = scale > 0 ? distancePx(points, viewSize) * scale : 0;
    const unverifiedCaveat =
      scale > 0 && sheetScaleStatus(sheet) === "unverified"
        ? " Scale is unverified — complete two labeled-dimension checks."
        : "";
    return {
      title: "Ruler check",
      value:
        scale <= 0
          ? "Needs scale"
          : points.length >= 2
            ? formatFeetInches(spanFeet)
            : `${points.length}/2 points`,
      detail:
        scale <= 0
          ? "Set the sheet scale before the ruler can read distances."
          : points.length >= 2
            ? `Keep clicking to chain segments and total them. Nothing is saved — Esc clears.${unverifiedCaveat}`
            : `Click two points to read a distance the drawing doesn't give you.${unverifiedCaveat}`,
      ready: false,
      actionLabel: "",
    };
  }

  if (tool === "count") {
    return {
      title: "Count takeoff",
      value: formatQty(points.length, unit || "EA"),
      detail:
        points.length > 0
          ? "Keep clicking matching items, then finish this grouped count."
          : "Click each matching item on the plan. One saved takeoff will hold the total count.",
      ready: points.length > 0,
      actionLabel: "Finish Count",
    };
  }

  const hasScale = Boolean(sheet?.scale_feet_per_pixel);
  const quantity = sheet ? calculateQuantity(tool, points, sheet, viewSize) : 0;
  const value =
    hasScale && quantity > 0
      ? formatQty(quantity, unit)
      : tool === "linear"
        ? `${points.length}/2+ points`
        : `${points.length}/3+ points`;

  if (tool === "linear") {
    return {
      title: "Linear takeoff",
      value,
      detail: !hasScale
        ? "Set the sheet scale before linear quantities can calculate."
        : points.length >= 2
          ? "Click more turns, then double-click or press Enter to finish (right-click works too)."
          : "Click the start point, then the next point on the run. Esc abandons the run.",
      ready: hasScale && points.length >= 2 && quantity > 0,
      actionLabel: "Finish Linear",
    };
  }

  return {
    title: "Area takeoff",
    value,
    detail: !hasScale
      ? "Set the sheet scale before area quantities can calculate."
      : points.length >= 3
        ? "Keep clicking corners, then double-click or press Enter to close and save."
        : "Click at least three corners around the area.",
    ready: hasScale && points.length >= 3 && quantity > 0,
    actionLabel: "Finish Area",
  };
}

export function unitFor(tool: TakeoffToolType, selectedLine?: EstimateLineItemRow) {
  if (selectedLine?.unit) return selectedLine.unit;
  if (tool === "linear") return "LF";
  if (tool === "area") return "SF";
  return "EA";
}

const UNIT_LONG_NAMES: Record<string, string> = {
  LF: "linear feet",
  SF: "square feet",
  SY: "square yards",
  CY: "cubic yards",
  EA: "each",
};

export function unitLongName(unit: string) {
  const canonical = normalizeTakeoffUnit(unit);
  const longName = UNIT_LONG_NAMES[canonical];
  return longName ? `${longName} (${canonical})` : canonical || "no unit";
}

export function toolLabel(tool: ToolMode) {
  if (tool === "select") return "Select";
  if (tool === "calibrate") return "Set Scale";
  if (tool === "verify") return "Verify Scale";
  if (tool === "ruler") return "Ruler";
  if (tool === "linear") return "Linear";
  if (tool === "area") return "Area";
  return "Count";
}

export function measurementMatchesTakeoffLayers(
  measurement: TakeoffMeasurementRow,
  visibility: TakeoffLayerVisibility,
) {
  const toolVisible = visibility[measurement.tool_type];
  const linkVisible = measurement.estimate_line_item_id ? visibility.linked : visibility.unlinked;
  return toolVisible && linkVisible;
}
