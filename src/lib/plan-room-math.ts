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
// origin bottom-left). Title blocks vary: the classic bottom-right block, a
// vertical strip running the full right edge, or a strip along the bottom.
// Candidates are collected from all three regions and scored — text size plus
// proximity to the bottom-right corner — so a big corner number beats a small
// stray detail reference that happens to match the sheet-number pattern.

export type SheetTextItem = {
  text: string;
  x: number;
  y: number;
  height?: number;
  // True when the pdf text runs vertically (rotated 90°) — common in
  // right-edge title strips. Vertical runs cluster by x instead of y.
  rotated?: boolean;
};

const TITLE_BLOCK_FIELD_LABELS =
  /^(scale|date|drawn|checked|approved|designed|reviewed|project\s*(no|number)?|job\s*(no|number)?|sheet\s*(no|number)?|rev(ision)?s?|of|as\s+noted|as\s+shown|issued?|plot\s*(date|by)|drawing\s*(no|number)|dwg|file\s*(no|name)?|copyright|key\s*plan|seal|stamp|phone|fax|e-?mail|consultants?)\b/i;

// Candidate regions, as fractions of the page. The union of the three covers
// the places real title blocks live.
const TITLE_REGION_BAND_X = 0.72; // bottom-right band: right 28% ...
const TITLE_REGION_BAND_Y = 0.32; // ... x bottom 32% (the original region)
const TITLE_REGION_RIGHT_STRIP_X = 0.86; // right-edge vertical strip, full height
const TITLE_REGION_BOTTOM_STRIP_Y = 0.14; // bottom strip, full width

const DEFAULT_TEXT_ITEM_HEIGHT = 8;
// Rough advance of a text run when pdfjs gives no width: chars x height x 0.55.
const APPROX_CHAR_WIDTH_RATIO = 0.55;
const MAX_TITLE_LINES = 3;

type NormalizedTextItem = {
  text: string;
  x: number;
  y: number;
  height: number;
  rotated: boolean;
};

type ExtractedLine = {
  text: string;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  height: number;
  items: NormalizedTextItem[];
};

function estimateAdvance(item: NormalizedTextItem): number {
  return Math.max(item.text.length, 1) * item.height * APPROX_CHAR_WIDTH_RATIO;
}

function segmentToLine(segment: NormalizedTextItem[], rotated: boolean): ExtractedLine {
  const height = Math.max(...segment.map((item) => item.height));
  if (rotated) {
    // Vertical run: text reads along y (bottom-up start), x is the strip position.
    const last = segment[segment.length - 1];
    return {
      text: segment.map((item) => item.text).join(" "),
      xMin: Math.min(...segment.map((item) => item.x)),
      xMax: Math.max(...segment.map((item) => item.x)),
      yMin: Math.min(...segment.map((item) => item.y)),
      yMax: last.y + estimateAdvance(last),
      height,
      items: segment,
    };
  }
  return {
    text: segment.map((item) => item.text).join(" "),
    xMin: Math.min(...segment.map((item) => item.x)),
    xMax: Math.max(...segment.map((item) => item.x + estimateAdvance(item))),
    yMin: Math.min(...segment.map((item) => item.y)),
    yMax: Math.max(...segment.map((item) => item.y)),
    height,
    items: segment,
  };
}

// Clusters items into visual lines: horizontal text groups by y then splits on
// large x gaps (so side-by-side title-block cells at the same baseline stay
// separate lines); rotated text groups by x and reads bottom-to-top.
function clusterTextLines(source: SheetTextItem[]): ExtractedLine[] {
  const items: NormalizedTextItem[] = source
    .filter((item) => item.text.trim().length > 0)
    .map((item) => ({
      text: item.text.trim(),
      x: item.x,
      y: item.y,
      height: item.height ?? DEFAULT_TEXT_ITEM_HEIGHT,
      rotated: item.rotated === true,
    }));
  const lines: ExtractedLine[] = [];

  const horizontalRows: Array<{ y: number; items: NormalizedTextItem[] }> = [];
  for (const item of items
    .filter((candidate) => !candidate.rotated)
    .sort((a, b) => b.y - a.y || a.x - b.x)) {
    const row = horizontalRows.find(
      (candidate) => Math.abs(candidate.y - item.y) <= item.height * 0.6,
    );
    if (row) row.items.push(item);
    else horizontalRows.push({ y: item.y, items: [item] });
  }
  for (const row of horizontalRows) {
    const ordered = [...row.items].sort((a, b) => a.x - b.x);
    let segment: NormalizedTextItem[] = [];
    let reach = 0;
    for (const item of ordered) {
      const gapLimit = Math.max(item.height * 2.5, 24);
      if (segment.length > 0 && item.x - reach > gapLimit) {
        lines.push(segmentToLine(segment, false));
        segment = [];
      }
      segment.push(item);
      reach = Math.max(reach, item.x + estimateAdvance(item));
    }
    if (segment.length > 0) lines.push(segmentToLine(segment, false));
  }

  const rotatedColumns: Array<{ x: number; items: NormalizedTextItem[] }> = [];
  for (const item of items
    .filter((candidate) => candidate.rotated)
    .sort((a, b) => a.x - b.x || a.y - b.y)) {
    const column = rotatedColumns.find(
      (candidate) => Math.abs(candidate.x - item.x) <= item.height * 0.6,
    );
    if (column) column.items.push(item);
    else rotatedColumns.push({ x: item.x, items: [item] });
  }
  for (const column of rotatedColumns) {
    const ordered = [...column.items].sort((a, b) => a.y - b.y);
    let segment: NormalizedTextItem[] = [];
    let reach = 0;
    for (const item of ordered) {
      const gapLimit = Math.max(item.height * 2.5, 24);
      if (segment.length > 0 && item.y - reach > gapLimit) {
        lines.push(segmentToLine(segment, true));
        segment = [];
      }
      segment.push(item);
      reach = Math.max(reach, item.y + estimateAdvance(item));
    }
    if (segment.length > 0) lines.push(segmentToLine(segment, true));
  }

  return lines;
}

type SheetNumberCandidate = {
  value: string;
  x: number;
  y: number;
  height: number;
  line: ExtractedLine;
};

function collectSheetNumberCandidates(lines: ExtractedLine[]): SheetNumberCandidate[] {
  const candidates: SheetNumberCandidate[] = [];
  for (const line of lines) {
    for (const item of line.items) {
      for (const token of [item.text, ...item.text.split(/\s+/)]) {
        const value = matchSheetNumber(token);
        if (value) {
          candidates.push({ value, x: item.x, y: item.y, height: item.height, line });
        }
      }
    }
    // Numbers split across adjacent items ("A-" + "700") join with no space.
    // "REV"/"NO" prefixes are field labels, not disciplines — never join them.
    for (let index = 1; index < line.items.length; index += 1) {
      const first = line.items[index - 1];
      const second = line.items[index];
      if (/^(rev|no)[-–—.]?$/i.test(first.text)) continue;
      const value = matchSheetNumber(`${first.text}${second.text}`);
      if (value) {
        candidates.push({
          value,
          x: first.x,
          y: Math.min(first.y, second.y),
          height: Math.max(first.height, second.height),
          line,
        });
      }
    }
    if (line.items.length >= 3) {
      const value = matchSheetNumber(line.text.replace(/\s+/g, ""));
      if (value) {
        candidates.push({ value, x: line.xMin, y: line.yMin, height: line.height, line });
      }
    }
  }
  return candidates;
}

// Score = normalized text size + proximity to the bottom-right page corner.
// A large number in the corner (~0.95) dwarfs a small detail-bubble reference
// mid-strip (~0.35), which is exactly the ordering real sheets need.
function scoreSheetNumberCandidate(
  candidate: SheetNumberCandidate,
  maxHeight: number,
  pageWidth: number,
  pageHeight: number,
): number {
  const size = maxHeight > 0 ? candidate.height / maxHeight : 0;
  const dx = Math.min(1, Math.max(0, (pageWidth - candidate.x) / pageWidth));
  const dy = Math.min(1, Math.max(0, candidate.y / pageHeight));
  const cornerProximity = 1 - Math.min(1, Math.hypot(dx, dy) / Math.SQRT2);
  return 0.55 * size + 0.45 * cornerProximity;
}

function intervalDistance(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  if (value > max) return value - max;
  return 0;
}

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
  const nonEmpty = items.filter((item) => item.text.trim().length > 0);
  const inTitleRegion = (item: SheetTextItem) =>
    (item.x >= pageWidth * TITLE_REGION_BAND_X && item.y <= pageHeight * TITLE_REGION_BAND_Y) ||
    item.x >= pageWidth * TITLE_REGION_RIGHT_STRIP_X ||
    item.y <= pageHeight * TITLE_REGION_BOTTOM_STRIP_Y;
  const regionItems = nonEmpty.filter(inTitleRegion);
  if (regionItems.length === 0) return { sheetNumber: null, sheetName: null };
  const lines = clusterTextLines(regionItems);

  const candidates = collectSheetNumberCandidates(lines);
  if (candidates.length === 0) return { sheetNumber: null, sheetName: null };
  const maxCandidateHeight = Math.max(...candidates.map((candidate) => candidate.height));
  let chosen = candidates[0];
  let chosenScore = -Infinity;
  for (const candidate of candidates) {
    const score = scoreSheetNumberCandidate(candidate, maxCandidateHeight, pageWidth, pageHeight);
    if (
      score > chosenScore ||
      (score === chosenScore &&
        (candidate.height > chosen.height ||
          (candidate.height === chosen.height && candidate.y < chosen.y)))
    ) {
      chosen = candidate;
      chosenScore = score;
    }
  }

  // Caption dedupe: text that also appears on the page body outside the title
  // regions is a detail caption, not a sheet name ("DOOR JAMB AT GWB
  // PARTITION" repeats under its detail view mid-page).
  const outsideTexts = new Set<string>();
  const normalizeForDedupe = (text: string) => text.replace(/\s+/g, " ").trim().toUpperCase();
  for (const line of clusterTextLines(nonEmpty.filter((item) => !inTitleRegion(item)))) {
    outsideTexts.add(normalizeForDedupe(line.text));
    for (const item of line.items) outsideTexts.add(normalizeForDedupe(item.text));
  }

  // Sheet name: the best multi-word line adjacent to the chosen number —
  // bigger text and shorter distance to the number both help — then wrapped
  // neighbors of similar size join. The drawing's own casing is kept.
  const eligible = lines.filter((line) => {
    if (line === chosen.line) return false;
    if (matchSheetNumber(line.text.replace(/\s+/g, ""))) return false;
    if (TITLE_BLOCK_FIELD_LABELS.test(line.text)) return false;
    if (!/[A-Za-z]{3,}/.test(line.text)) return false;
    if (line.text.split(/\s+/).length < 2 && line.text.length < 6) return false;
    if (outsideTexts.has(normalizeForDedupe(line.text))) return false;
    if (line.yMax < chosen.y - chosen.height * 2.5) return false; // beneath the number
    if (intervalDistance(chosen.y, line.yMin, line.yMax) > pageHeight * 0.5) return false;
    if (intervalDistance(chosen.x, line.xMin, line.xMax) > pageWidth * 0.45) return false;
    return true;
  });
  const nameScore = (line: ExtractedLine) => {
    const dyDist = intervalDistance(chosen.y, line.yMin, line.yMax) / pageHeight;
    const dxDist = intervalDistance(chosen.x, line.xMin, line.xMax) / pageWidth;
    const below = line.yMax < chosen.y;
    return line.height - dyDist * 30 * (below ? 2 : 1) - dxDist * 10;
  };
  let sheetName: string | null = null;
  if (eligible.length > 0) {
    const ranked = [...eligible].sort((a, b) => nameScore(b) - nameScore(a));
    const anchor = ranked[0];
    const block: ExtractedLine[] = [anchor];
    const pool = ranked.slice(1);
    while (block.length < MAX_TITLE_LINES) {
      const next = pool.find(
        (line) =>
          !block.includes(line) &&
          line.height >= anchor.height * 0.66 &&
          line.height <= anchor.height * 1.5 &&
          block.some(
            (member) =>
              Math.max(0, line.yMin - member.yMax, member.yMin - line.yMax) <=
                anchor.height * 2.2 &&
              Math.max(0, line.xMin - member.xMax, member.xMin - line.xMax) <= pageWidth * 0.1,
          ),
      );
      if (!next) break;
      block.push(next);
    }
    sheetName =
      block
        .sort((a, b) => b.yMax - a.yMax || a.xMin - b.xMin)
        .map((line) => line.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 200) || null;
  }

  return { sheetNumber: chosen.value, sheetName };
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
