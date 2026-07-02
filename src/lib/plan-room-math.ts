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
