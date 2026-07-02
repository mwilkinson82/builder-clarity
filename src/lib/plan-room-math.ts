import type { TakeoffToolType } from "@/lib/plan-room.functions";

export type PlanRoomPoint = { x: number; y: number };
export type PlanRoomViewSize = { width: number; height: number };

export function distancePx(points: PlanRoomPoint[], size: PlanRoomViewSize) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    total += Math.hypot((b.x - a.x) * size.width, (b.y - a.y) * size.height);
  }
  return total;
}

export function areaPx(points: PlanRoomPoint[], size: PlanRoomViewSize) {
  if (points.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * size.width * (next.y * size.height);
    total -= next.x * size.width * (current.y * size.height);
  }
  return Math.abs(total) / 2;
}

export function calculateTakeoffQuantity({
  tool,
  points,
  scaleFeetPerPixel,
  viewSize,
}: {
  tool: TakeoffToolType;
  points: PlanRoomPoint[];
  scaleFeetPerPixel: number;
  viewSize: PlanRoomViewSize;
}) {
  if (tool === "count") return points.length || 1;
  if (scaleFeetPerPixel <= 0) return 0;
  if (tool === "linear") return distancePx(points, viewSize) * scaleFeetPerPixel;
  return areaPx(points, viewSize) * scaleFeetPerPixel * scaleFeetPerPixel;
}

// --- Takeoff unit families -------------------------------------------------
// Sync and link flows must never treat 4.83 LF as 4.83 SF. Units are compared
// by family after alias normalization; unknown units only match themselves.

const TAKEOFF_UNIT_ALIASES: Record<string, string> = {
  LF: "LF",
  LNFT: "LF",
  "LIN FT": "LF",
  LINFT: "LF",
  "LINEAR FEET": "LF",
  "LINEAR FT": "LF",
  FT: "LF",
  FEET: "LF",
  FOOT: "LF",
  SF: "SF",
  SQFT: "SF",
  "SQ FT": "SF",
  SQF: "SF",
  "SQUARE FEET": "SF",
  "SQUARE FOOT": "SF",
  SY: "SY",
  SQYD: "SY",
  "SQ YD": "SY",
  "SQUARE YARD": "SY",
  "SQUARE YARDS": "SY",
  CY: "CY",
  CUYD: "CY",
  "CU YD": "CY",
  "CUBIC YARD": "CY",
  "CUBIC YARDS": "CY",
  EA: "EA",
  EACH: "EA",
  CT: "EA",
  COUNT: "EA",
};

export function normalizeTakeoffUnit(unit: string): string {
  const cleaned = unit.trim().toUpperCase().replace(/\./g, "").replace(/\s+/g, " ");
  if (!cleaned) return "";
  return TAKEOFF_UNIT_ALIASES[cleaned] ?? cleaned;
}

export function takeoffUnitsCompatible(a: string, b: string): boolean {
  const unitA = normalizeTakeoffUnit(a);
  const unitB = normalizeTakeoffUnit(b);
  // A blank unit on either side has nothing to contradict.
  if (!unitA || !unitB) return true;
  return unitA === unitB;
}

// --- Stated-scale conversion -----------------------------------------------
// A stated scale like 1/4" = 1'-0" converts directly for vector PDFs because
// the page has known physical dimensions (72 pdf points = 1 paper inch):
//   feet per paper inch = statedFeet / statedInches   (1/4" = 1'-0" -> 4)
//   feet per pdf point  = feet per paper inch / 72
//   feet per stored px  = feet per pdf point * (page points / rendered px)

export function statedScaleFeetPerPixel({
  statedInches,
  statedFeet,
  pageWidthPoints,
  renderedWidthPx,
}: {
  statedInches: number;
  statedFeet: number;
  pageWidthPoints: number;
  renderedWidthPx: number;
}): number {
  if (statedInches <= 0 || statedFeet <= 0 || pageWidthPoints <= 0 || renderedWidthPx <= 0) {
    return 0;
  }
  const feetPerPaperInch = statedFeet / statedInches;
  const feetPerPdfPoint = feetPerPaperInch / 72;
  return feetPerPdfPoint * (pageWidthPoints / renderedWidthPx);
}

// Parses contractor distance entry: 12' 6", 12ft 6in, 12.5, 6" all work.
export function parseFeetInches(input: string): number | null {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const plain = Number(text);
  if (Number.isFinite(plain)) return plain > 0 ? plain : null;
  const match = text.match(
    /^(?:(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot))?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in|inch|inches))?$/,
  );
  if (!match || (!match[1] && !match[2])) return null;
  const feet = match[1] ? Number(match[1]) : 0;
  const inches = match[2] ? Number(match[2]) : 0;
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
  const total = feet + inches / 12;
  return total > 0 ? total : null;
}

// --- Linear angle guide ("the level") ---------------------------------------
// Guides the segment from the last vertex to the cursor. Within the snap
// tolerance of a 45-degree increment the point snaps to the exact angle
// (Shift hard-constrains to the nearest increment). Works in screen pixel
// space so the guide matches the eye regardless of sheet aspect ratio.

export const ANGLE_GUIDE_SNAP_TOLERANCE_DEG = 2;

export function snapLinearPoint({
  anchor,
  cursor,
  viewSize,
  shiftKey = false,
  snapToleranceDeg = ANGLE_GUIDE_SNAP_TOLERANCE_DEG,
}: {
  anchor: PlanRoomPoint;
  cursor: PlanRoomPoint;
  viewSize: PlanRoomViewSize;
  shiftKey?: boolean;
  snapToleranceDeg?: number;
}): { point: PlanRoomPoint; angleDeg: number; snapped: boolean } {
  const dx = (cursor.x - anchor.x) * viewSize.width;
  const dy = (cursor.y - anchor.y) * viewSize.height;
  const length = Math.hypot(dx, dy);
  if (length <= 0 || viewSize.width <= 0 || viewSize.height <= 0) {
    return { point: cursor, angleDeg: 0, snapped: false };
  }
  const angleDeg = ((Math.atan2(-dy, dx) * 180) / Math.PI + 360) % 360;
  const nearest = Math.round(angleDeg / 45) * 45;
  const snapped = shiftKey || Math.abs(angleDeg - nearest) <= snapToleranceDeg;
  if (!snapped) {
    return { point: cursor, angleDeg, snapped: false };
  }
  const snappedAngle = nearest % 360;
  const theta = (snappedAngle * Math.PI) / 180;
  return {
    point: {
      x: Math.min(1, Math.max(0, anchor.x + (length * Math.cos(theta)) / viewSize.width)),
      y: Math.min(1, Math.max(0, anchor.y - (length * Math.sin(theta)) / viewSize.height)),
    },
    angleDeg: snappedAngle,
    snapped: true,
  };
}

// --- Sheet identity ----------------------------------------------------------
// Construction sheet numbers: 1-3 letters + optional separator + digits with
// an optional dot suffix (A-101, A1.1, E-201, M-1.1, FP-102, A-700).

const SHEET_NUMBER_PATTERN = /^([A-Za-z]{1,3})[-–—.\s]?(\d{1,3}(?:\.\d{1,2})?)$/;

export function matchSheetNumber(token: string): string | null {
  const cleaned = token.trim();
  if (!cleaned) return null;
  const match = cleaned.match(SHEET_NUMBER_PATTERN);
  if (!match) return null;
  return cleaned.replace(/\s+/g, "");
}

// Standard discipline map keyed by the sheet-number letter prefix. "PG" is the
// app's own page placeholder and deliberately maps to nothing — P alone is
// plumbing, and mislabeling pages as plumbing is the exact bug this fixes.
const DISCIPLINE_BY_PREFIX: Record<string, string> = {
  A: "Architectural",
  AD: "Architectural",
  S: "Structural",
  M: "Mechanical",
  E: "Electrical",
  P: "Plumbing",
  C: "Civil",
  L: "Landscape",
  FP: "Fire Protection",
  T: "Low Voltage",
  LV: "Low Voltage",
  G: "General",
};

export function disciplineForSheetNumber(sheetNumber: string): string {
  const match = sheetNumber.trim().match(/^([A-Za-z]{1,3})/);
  if (!match) return "";
  return DISCIPLINE_BY_PREFIX[match[1].toUpperCase()] ?? "";
}

// Title-block text extraction. Works on positioned text items (pdf points,
// origin bottom-left). The sheet number and name live almost always in the
// bottom-right title block: roughly the right 25% x bottom 30% of the page.

export type SheetTextItem = {
  text: string;
  x: number;
  y: number;
  height?: number;
};

const TITLE_BLOCK_FIELD_LABELS =
  /^(scale|date|drawn|checked|approved|designed|project\s*(no|number)?|job\s*(no|number)?|sheet\s*(no|number)?|rev(ision)?|of|as\s+noted|as\s+shown)\b/i;

export function extractSheetIdentity({
  items,
  pageWidth,
  pageHeight,
}: {
  items: SheetTextItem[];
  pageWidth: number;
  pageHeight: number;
}): { sheetNumber: string | null; sheetName: string | null } {
  if (pageWidth <= 0 || pageHeight <= 0) return { sheetNumber: null, sheetName: null };
  const region = items.filter(
    (item) =>
      item.text.trim().length > 0 && item.x >= pageWidth * 0.72 && item.y <= pageHeight * 0.32,
  );
  if (region.length === 0) return { sheetNumber: null, sheetName: null };

  // Cluster items into lines by y, then read each line left to right.
  const sorted = [...region].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ text: string; y: number; height: number }> = [];
  for (const item of sorted) {
    const height = item.height ?? 8;
    const line = lines.find((candidate) => Math.abs(candidate.y - item.y) <= height * 0.6);
    if (line) {
      line.text = `${line.text} ${item.text.trim()}`.trim();
      line.height = Math.max(line.height, height);
    } else {
      lines.push({ text: item.text.trim(), y: item.y, height });
    }
  }

  // Sheet number: bottom-most match wins; title blocks put it big in the
  // corner. Ties go to the taller text.
  let sheetNumber: { value: string; y: number; height: number } | null = null;
  for (const line of lines) {
    const candidates = [line.text, ...line.text.split(/\s+/)];
    for (const candidate of candidates) {
      const value = matchSheetNumber(candidate);
      if (!value) continue;
      if (
        !sheetNumber ||
        line.y < sheetNumber.y - 1 ||
        (Math.abs(line.y - sheetNumber.y) <= 1 && line.height > sheetNumber.height)
      ) {
        sheetNumber = { value, y: line.y, height: line.height };
      }
    }
  }

  // Sheet name: the nearest multi-word line(s) above the number in the same
  // region; wrapped lines join. The drawing's own casing is kept.
  let sheetName: string | null = null;
  if (sheetNumber) {
    const numberY = sheetNumber.y;
    const nameLines = lines
      .filter(
        (line) =>
          line.y > numberY + 1 &&
          !matchSheetNumber(line.text.replace(/\s+/g, "")) &&
          !TITLE_BLOCK_FIELD_LABELS.test(line.text) &&
          /[A-Za-z]{3,}/.test(line.text) &&
          (line.text.trim().split(/\s+/).length >= 2 || line.text.trim().length >= 6),
      )
      .sort((a, b) => a.y - b.y)
      .slice(0, 2)
      .sort((a, b) => b.y - a.y);
    if (nameLines.length > 0) {
      sheetName = nameLines
        .map((line) => line.text.trim())
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 200);
    }
  }

  return { sheetNumber: sheetNumber?.value ?? null, sheetName };
}

// --- Decimal-feet trap -------------------------------------------------------
// Typing "12.8" for a 12'-8" dimension is a silent ~1% error. These helpers
// power the live conversion line and the one-tap "did you mean" suggestion.

export function formatFeetInches(feet: number): string {
  if (!Number.isFinite(feet) || feet < 0) return "";
  const totalEighths = Math.round(feet * 12 * 8);
  let wholeFeet = Math.floor(totalEighths / (12 * 8));
  const remainingEighths = totalEighths - wholeFeet * 12 * 8;
  let inches = Math.floor(remainingEighths / 8);
  const eighths = remainingEighths - inches * 8;
  if (inches === 12) {
    wholeFeet += 1;
    inches = 0;
  }
  const fraction =
    eighths === 0
      ? ""
      : eighths % 4 === 0
        ? " 1/2"
        : eighths % 2 === 0
          ? ` ${eighths / 2}/4`
          : ` ${eighths}/8`;
  if (inches === 0 && !fraction) return `${wholeFeet}'`;
  return `${wholeFeet}'-${inches}${fraction}"`;
}

export type DecimalFeetHint = {
  decimalFeet: number;
  conversionLabel: string;
  suggestion: { label: string; value: string } | null;
};

// Returns a hint only for bare decimal entries with a fractional part. The
// suggestion fires when the digits after the point read as a whole inch count
// (0-11) that the decimal itself does not land on — ".8" is 9.6 inches, so it
// was probably a typo for 8 inches; ".5" is exactly 6 inches, so it was
// probably meant as a true decimal.
export function decimalFeetHint(input: string): DecimalFeetHint | null {
  const text = input.trim();
  if (!/^\d+\.\d+$/.test(text)) return null;
  const decimalFeet = Number(text);
  if (!Number.isFinite(decimalFeet) || decimalFeet <= 0) return null;
  const [wholePart, fractionPart] = text.split(".");
  const inchesFromFraction = (decimalFeet - Number(wholePart)) * 12;
  const landsOnWholeInch = Math.abs(inchesFromFraction - Math.round(inchesFromFraction)) < 1e-9;
  const digitsAsInches = Number(fractionPart);
  let suggestion: DecimalFeetHint["suggestion"] = null;
  if (!landsOnWholeInch && Number.isInteger(digitsAsInches) && digitsAsInches <= 11) {
    suggestion = {
      label: `Did you mean ${wholePart}'-${digitsAsInches}"?`,
      value: `${wholePart}' ${digitsAsInches}"`,
    };
  }
  return {
    decimalFeet,
    conversionLabel: `${text} ft = ${formatFeetInches(decimalFeet)}`,
    suggestion,
  };
}

// --- Takeoff-first estimating ------------------------------------------------
// Groups unlinked takeoffs into would-be estimate rows and suggests matches
// against existing rows. Pure so the smoke tests can drive them.

export function normalizeTakeoffLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type TakeoffGroupInput = {
  id: string;
  label: string;
  unit: string;
  quantity: number;
  waste_pct: number;
  library_item_id: string | null;
};

export type TakeoffGroup = {
  key: string;
  label: string;
  unit: string;
  library_item_id: string | null;
  measurement_ids: string[];
  // Waste-applied rollup, matching the sync formula.
  quantity: number;
  measurement_count: number;
};

// Groups by library item when recorded, else by normalized label + canonical
// unit. Mixed-unit labels split into separate groups rather than merging —
// the Phase 2 unit guard extends to rollups.
export function groupUnlinkedTakeoffs(measurements: TakeoffGroupInput[]): TakeoffGroup[] {
  const groups = new Map<string, TakeoffGroup>();
  for (const measurement of measurements) {
    const canonicalUnit = normalizeTakeoffUnit(measurement.unit);
    const key = measurement.library_item_id
      ? `library:${measurement.library_item_id}:${canonicalUnit}`
      : `label:${normalizeTakeoffLabel(measurement.label) || "unlabeled"}:${canonicalUnit}`;
    const rollup = measurement.quantity * (1 + measurement.waste_pct / 100);
    const existing = groups.get(key);
    if (existing) {
      existing.measurement_ids.push(measurement.id);
      existing.quantity = Math.round((existing.quantity + rollup) * 10000) / 10000;
      existing.measurement_count += 1;
    } else {
      groups.set(key, {
        key,
        label: measurement.label.trim() || "Unlabeled takeoff",
        unit: measurement.unit.trim().toUpperCase() || canonicalUnit || "EA",
        library_item_id: measurement.library_item_id,
        measurement_ids: [measurement.id],
        quantity: Math.round(rollup * 10000) / 10000,
        measurement_count: 1,
      });
    }
  }
  return Array.from(groups.values());
}

export type MatchCandidateRow = {
  id: string;
  cost_code: string;
  description: string;
  unit: string;
};

export type TakeoffRowMatch = {
  measurement_id: string;
  line_id: string;
  score: number;
};

// Suggests takeoff -> row matches on cost code and/or normalized description
// with compatible units. One best candidate per takeoff; never auto-applied.
export function suggestTakeoffMatches(
  measurements: Array<Pick<TakeoffGroupInput, "id" | "label" | "unit">>,
  rows: MatchCandidateRow[],
): TakeoffRowMatch[] {
  const matches: TakeoffRowMatch[] = [];
  for (const measurement of measurements) {
    const label = normalizeTakeoffLabel(measurement.label);
    if (!label) continue;
    let best: TakeoffRowMatch | null = null;
    for (const row of rows) {
      if (!takeoffUnitsCompatible(measurement.unit, row.unit)) continue;
      const description = normalizeTakeoffLabel(row.description);
      const costCode = row.cost_code.trim().toLowerCase();
      let score = 0;
      if (description && description === label) score = 100;
      else if (costCode && measurement.label.toLowerCase().includes(costCode)) score = 80;
      else if (description && (description.includes(label) || label.includes(description))) {
        score = 60;
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { measurement_id: measurement.id, line_id: row.id, score };
      }
    }
    if (best) matches.push(best);
  }
  return matches;
}
