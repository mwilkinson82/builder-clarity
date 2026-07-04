// Coordinate transforms for the AI takeoff pipeline (AITAKEOFF2 Tasks 0/1).
// Pure functions only — no pdfjs, no DOM, no env. Every hop in the chain is
// explicit so the two Y-axis regressions (PDF's bottom-up origin, tile offset
// dropped on the way back) are impossible to reintroduce silently: the smoke
// suite round-trips these against a real rendered PDF.
//
// The three spaces:
// - SHEET space: normalized [0,1], origin TOP-LEFT — what takeoff geometry
//   stores and what the viewer overlay draws in.
// - PDF POINT space: 1/72in units, origin BOTTOM-LEFT (Y grows upward) — what
//   lives inside the PDF file.
// - RENDER PIXEL space: pixels at a given scale, origin TOP-LEFT — what a
//   pdfjs viewport canvas (and every crop/tile we send the model) uses.

export interface PdfPageSize {
  /** Page width in PDF points (viewport-at-scale-1 width). */
  widthPt: number;
  /** Page height in PDF points (viewport-at-scale-1 height). */
  heightPt: number;
}

export interface SheetPointNorm {
  x: number;
  y: number;
}

export interface PdfPoint {
  xPt: number;
  yPt: number;
}

export interface RenderPixel {
  px: number;
  py: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const clamp01 = (value: number) => (Number.isFinite(value) ? clamp(value, 0, 1) : 0);

// --- Sheet ⇄ PDF points (the Y flip lives HERE and only here) ---

/** Normalized sheet point (top-left origin) → PDF point (bottom-up origin). */
export function sheetPointToPdfPoint(point: SheetPointNorm, page: PdfPageSize): PdfPoint {
  return {
    xPt: clamp01(point.x) * page.widthPt,
    yPt: (1 - clamp01(point.y)) * page.heightPt,
  };
}

/** PDF point (bottom-up origin) → normalized sheet point (top-left origin). */
export function pdfPointToSheetPoint(pt: PdfPoint, page: PdfPageSize): SheetPointNorm {
  if (page.widthPt <= 0 || page.heightPt <= 0) return { x: 0, y: 0 };
  return {
    x: clamp01(pt.xPt / page.widthPt),
    y: clamp01(1 - pt.yPt / page.heightPt),
  };
}

// --- PDF points ⇄ render pixels (top-down raster at `scale`) ---

/** PDF point → pixel position on a top-down raster rendered at `scale`. */
export function pdfPointToRenderPixel(pt: PdfPoint, page: PdfPageSize, scale: number): RenderPixel {
  return {
    px: pt.xPt * scale,
    py: (page.heightPt - pt.yPt) * scale,
  };
}

/** Pixel on a top-down raster rendered at `scale` → PDF point. */
export function renderPixelToPdfPoint(
  pixel: RenderPixel,
  page: PdfPageSize,
  scale: number,
): PdfPoint {
  if (scale <= 0) return { xPt: 0, yPt: 0 };
  return {
    xPt: pixel.px / scale,
    yPt: page.heightPt - pixel.py / scale,
  };
}

// --- Compositions (what the pipeline actually calls) ---

/** Sheet point straight to raster pixels. Equals the two-hop path exactly. */
export function sheetPointToRenderPixel(
  point: SheetPointNorm,
  page: PdfPageSize,
  scale: number,
): RenderPixel {
  return pdfPointToRenderPixel(sheetPointToPdfPoint(point, page), page, scale);
}

/** Raster pixel straight back to a sheet point. Inverse of the above. */
export function renderPixelToSheetPoint(
  pixel: RenderPixel,
  page: PdfPageSize,
  scale: number,
): SheetPointNorm {
  return pdfPointToSheetPoint(renderPixelToPdfPoint(pixel, page, scale), page);
}

// --- Exemplar crop plan (Task 0) ---
// The marker sits at the symbol's center; plan symbols can be inches wide at
// sheet scale, so the crop region is generous and the render DPI keeps
// linework legible (512-768px long side).

/** Square region side captured around the marker, in sheet inches. */
export const EXEMPLAR_REGION_INCHES = 4;
/** Target long-side pixels for the rendered exemplar crop. */
export const EXEMPLAR_TARGET_LONG_EDGE_PX = 640;
const PDF_POINTS_PER_INCH = 72;

export interface ExemplarCropPlan {
  /** pdfjs render scale that maps the region to the target pixel size. */
  scale: number;
  /** Crop window on the full-page raster at `scale`, top-down pixels. */
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
  /** pdfjs viewport offsets that place the window at the canvas origin. */
  offsetX: number;
  offsetY: number;
  /** Where the marker lands inside the crop (pixels) — test hook. */
  markerInCropPx: RenderPixel;
}

/**
 * Plan a clean region render around a marker. The region is a square
 * EXEMPLAR_REGION_INCHES on a side (clamped to the page), rendered so its
 * long side hits EXEMPLAR_TARGET_LONG_EDGE_PX. The window shifts (never
 * shrinks) when the marker sits near a page edge.
 */
export function exemplarCropPlan(marker: SheetPointNorm, page: PdfPageSize): ExemplarCropPlan {
  const regionSidePt = Math.min(
    EXEMPLAR_REGION_INCHES * PDF_POINTS_PER_INCH,
    Math.max(1, Math.min(page.widthPt, page.heightPt)),
  );
  const scale = EXEMPLAR_TARGET_LONG_EDGE_PX / regionSidePt;
  const pageWidthPx = page.widthPt * scale;
  const pageHeightPx = page.heightPt * scale;
  const sidePx = Math.round(regionSidePt * scale);
  const widthPx = Math.min(sidePx, Math.max(1, Math.floor(pageWidthPx)));
  const heightPx = Math.min(sidePx, Math.max(1, Math.floor(pageHeightPx)));

  const center = sheetPointToRenderPixel(marker, page, scale);
  const leftPx = Math.round(clamp(center.px - widthPx / 2, 0, Math.max(0, pageWidthPx - widthPx)));
  const topPx = Math.round(
    clamp(center.py - heightPx / 2, 0, Math.max(0, pageHeightPx - heightPx)),
  );

  return {
    scale,
    leftPx,
    topPx,
    widthPx,
    heightPx,
    offsetX: -leftPx,
    offsetY: -topPx,
    markerInCropPx: { px: center.px - leftPx, py: center.py - topPx },
  };
}

// --- Detection tiles (Task 1) ---
// Every tile carries its sheet-space origin and per-pixel scale; response
// mapping goes tile-local pixel → sheet space through this one path.

export interface DetectionTileFrame {
  /** Tile's top-left corner in normalized sheet space. */
  originSheetX: number;
  originSheetY: number;
  /** Normalized sheet units per tile pixel. */
  sheetPerPxX: number;
  sheetPerPxY: number;
}

/** Frame for a tile sliced from a full-page raster of rasterW × rasterH px. */
export function tileFrameFor(
  tile: { left: number; top: number },
  rasterWidthPx: number,
  rasterHeightPx: number,
): DetectionTileFrame {
  const safeW = Math.max(1, rasterWidthPx);
  const safeH = Math.max(1, rasterHeightPx);
  return {
    originSheetX: tile.left / safeW,
    originSheetY: tile.top / safeH,
    sheetPerPxX: 1 / safeW,
    sheetPerPxY: 1 / safeH,
  };
}

/** Tile-local pixel → normalized sheet point, through the tile's frame. */
export function tileLocalToSheetPoint(
  frame: DetectionTileFrame,
  localX: number,
  localY: number,
): SheetPointNorm {
  return {
    x: clamp01(frame.originSheetX + localX * frame.sheetPerPxX),
    y: clamp01(frame.originSheetY + localY * frame.sheetPerPxY),
  };
}

// --- Bounding boxes (Task 2: matches come back as small boxes) ---

export interface TileBoundingBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  confidence: number;
}

/** Center of a match box in tile-local pixels (derived server-side). */
export function bboxCenter(box: Pick<TileBoundingBox, "x0" | "y0" | "x1" | "y1">): {
  x: number;
  y: number;
} {
  return { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
}
