// Reference-set building for AI count scans (AITAKEOFF5 Task 1).
// Positives teach the model what the symbol IS: the picked exemplar plus up
// to two more crops auto-harvested from same-sheet accepted/hand-placed
// markers of the same cost-code/label. Negatives teach what it is NOT: crops
// around candidates the estimator rejected. Negatives are never manufactured
// — none exist until a human rejects something.

import {
  DEDUPE_RADIUS_NORMALIZED,
  REFERENCE_MAX_NEGATIVES,
  REFERENCE_MAX_POSITIVES,
  type SheetPoint,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import {
  renderExemplarCrop,
  renderVerifyWindow,
  type DetectionExemplarImage,
  type DetectionSheetRaster,
} from "./aiDetectionRender";
import { geometryPoints } from "./planRoomShared";

/** One reference image as the scan/verify server functions expect it. */
export interface ReferenceImagePayload {
  media_type: "image/png" | "image/webp" | "image/jpeg";
  base64: string;
  width_px: number;
  height_px: number;
}

export interface ExemplarIdentity {
  measurementId: string;
  sheetId: string;
  label: string;
  estimateLineItemId: string | null;
  libraryItemId: string | null;
  point: SheetPoint;
}

/** The picked exemplar: identity plus the styling a new AI count inherits. */
export interface AiExemplar extends ExemplarIdentity {
  unit: string;
  color: string;
  wastePct: number;
}

/** A count marker becomes an exemplar; anything else can't seed a scan. */
export function exemplarFromMeasurement(measurement: TakeoffMeasurementRow): AiExemplar | null {
  if (measurement.tool_type !== "count") return null;
  const points = geometryPoints(measurement.geometry);
  if (points.length === 0) return null;
  return {
    measurementId: measurement.id,
    sheetId: measurement.plan_sheet_id,
    label: measurement.label,
    unit: measurement.unit || "EA",
    color: measurement.color,
    wastePct: measurement.waste_pct,
    estimateLineItemId: measurement.estimate_line_item_id,
    libraryItemId: measurement.library_item_id,
    point: points[0],
  };
}

const sameIdentity = (measurement: TakeoffMeasurementRow, exemplar: ExemplarIdentity) => {
  if (exemplar.estimateLineItemId && measurement.estimate_line_item_id) {
    return measurement.estimate_line_item_id === exemplar.estimateLineItemId;
  }
  if (exemplar.libraryItemId && measurement.library_item_id) {
    return measurement.library_item_id === exemplar.libraryItemId;
  }
  return (
    measurement.label.trim().toLowerCase() === exemplar.label.trim().toLowerCase() &&
    measurement.label.trim() !== ""
  );
};

/**
 * Points on the exemplar's sheet that carry the same identity — accepted AI
 * counts and hand-placed markers alike. The exemplar's own point is
 * excluded; near-duplicates collapse so two crops never show the same spot.
 */
export function harvestPositivePoints(input: {
  measurements: TakeoffMeasurementRow[];
  exemplar: ExemplarIdentity;
  cap?: number;
}): SheetPoint[] {
  const cap = input.cap ?? REFERENCE_MAX_POSITIVES - 1;
  const harvested: SheetPoint[] = [];
  const tooClose = (a: SheetPoint, b: SheetPoint) =>
    Math.hypot(a.x - b.x, a.y - b.y) < DEDUPE_RADIUS_NORMALIZED;
  for (const measurement of input.measurements) {
    if (measurement.plan_sheet_id !== input.exemplar.sheetId) continue;
    if (measurement.tool_type !== "count") continue;
    if (!sameIdentity(measurement, input.exemplar)) continue;
    for (const point of geometryPoints(measurement.geometry)) {
      if (harvested.length >= cap) return harvested;
      if (tooClose(point, input.exemplar.point)) continue;
      if (harvested.some((existing) => tooClose(existing, point))) continue;
      harvested.push(point);
    }
  }
  return harvested;
}

/** The positive stack: primary exemplar crop first, harvested crops after. */
export async function buildPositiveReferences(input: {
  primary: DetectionExemplarImage;
  exemplarSheetSignedUrl: string;
  exemplarSheetPageNumber: number;
  harvestPoints: SheetPoint[];
}): Promise<ReferenceImagePayload[]> {
  const positives: ReferenceImagePayload[] = [
    {
      media_type: input.primary.mediaType,
      base64: input.primary.base64,
      width_px: input.primary.widthPx,
      height_px: input.primary.heightPx,
    },
  ];
  for (const point of input.harvestPoints.slice(0, REFERENCE_MAX_POSITIVES - 1)) {
    const crop = await renderExemplarCrop(
      input.exemplarSheetSignedUrl,
      input.exemplarSheetPageNumber,
      point,
    );
    positives.push({
      media_type: crop.mediaType,
      base64: crop.base64,
      width_px: crop.widthPx,
      height_px: crop.heightPx,
    });
  }
  return positives;
}

/**
 * Negative crops around rejected points on THIS sheet's detection raster —
 * native window resolution (~256px), no upscale: they only need to show what
 * the wrong symbol looks like, cheaply.
 */
export function buildNegativeReferences(
  raster: DetectionSheetRaster,
  rejectedPoints: SheetPoint[],
): ReferenceImagePayload[] {
  return rejectedPoints.slice(0, REFERENCE_MAX_NEGATIVES).map((point) => {
    const window = renderVerifyWindow(raster, point, { upscale: false });
    return {
      media_type: window.mediaType,
      base64: window.base64,
      width_px: window.widthPx,
      height_px: window.heightPx,
    };
  });
}
