// Client-side detection rendering for AI-assisted counts (AITAKEOFF1 Task 1,
// pipeline rebuilt in AITAKEOFF2). The pdfjs render machinery lives in the
// browser (same machinery the viewer and thumbnails use), so the client
// renders the sheet at detection resolution, slices tiles, and renders the
// exemplar region; the server meters credits and talks to the model.
//
// The exemplar crop is a CLEAN region render straight from the PDF —
// takeoff markers live on the SVG overlay, never in these canvases — and all
// geometry goes through the pure transforms in coord-transforms.ts so the
// crop window and the response mapping share one tested path.

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  DETECTION_LONG_EDGE_PX,
  DETECTION_TILE_OVERLAP_PX,
  inkMaskFromRgba,
  inkMaskToBase64,
  measureInkFootprintPx,
  planDetectionTiles,
  VERIFY_IMAGE_PX,
  verifyWindowRect,
  type DetectionTileRect,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { SheetPoint } from "@/lib/ai-takeoff/ai-takeoff-domain";
import { isolateExemplarFootprintPx } from "@/lib/ai-takeoff/exemplar-isolation-domain";
import { TEMPLATE_MARGIN_RATIO } from "@/lib/ai-takeoff/template-match/template-match-domain";
import {
  exemplarCropPlan,
  tileFrameFor,
  type DetectionTileFrame,
  type PdfPageSize,
} from "@/lib/ai-takeoff/coord-transforms";

const configurePdfWorker = (pdfjs: unknown) => {
  const workerSrc = String(pdfWorkerUrl || "");
  if (!workerSrc) throw new Error("PDF worker is not available.");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerSrc;
};

type PdfJsPage = {
  getViewport: (options: { scale: number; offsetX?: number; offsetY?: number }) => {
    width: number;
    height: number;
  };
  // pdfjs's own RenderParameters type; kept loose for the dynamic import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (options: any) => { promise: Promise<unknown> };
};

async function loadPdfPage(signedUrl: string, pageNumber: number): Promise<PdfJsPage> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ url: signedUrl }).promise;
  return (await pdf.getPage(Math.max(1, pageNumber))) as unknown as PdfJsPage;
}

function pageSizeOf(page: PdfJsPage): PdfPageSize {
  // Viewport at scale 1 is the page in PDF points with rotation applied —
  // the same space the viewer normalizes marker geometry against.
  const viewport = page.getViewport({ scale: 1 });
  if (!Number.isFinite(viewport.width) || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error("This sheet could not be measured for scanning.");
  }
  return { widthPt: viewport.width, heightPt: viewport.height };
}

function renderToCanvas(
  page: PdfJsPage,
  widthPx: number,
  heightPx: number,
  viewport: unknown,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(widthPx));
  canvas.height = Math.max(1, Math.round(heightPx));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the sheet for scanning.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  return page.render({ canvas, canvasContext: context, viewport }).promise.then(() => canvas);
}

function canvasToBase64Png(canvas: HTMLCanvasElement): string {
  const dataUrl = canvas.toDataURL("image/png");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Scan image could not be encoded.");
  return dataUrl.slice(commaIndex + 1);
}

export interface DetectionSheetRaster {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
  pageSize: PdfPageSize;
}

export interface DetectionTileImage {
  rect: DetectionTileRect;
  /** Sheet-space origin + per-pixel scale — travels with the tile (Task 1). */
  frame: DetectionTileFrame;
  base64: string;
  mediaType: "image/png";
}

export interface DetectionExemplarImage {
  base64: string;
  mediaType: "image/png";
  widthPx: number;
  heightPx: number;
  /**
   * The symbol's measured ink footprint under the marker, in PDF points
   * (AITAKEOFF5 Task 0) — drives tile overlap and dedupe radius per sheet.
   * ISOLATED since AITAKEOFF14: the connected-component measurement is
   * clamped to the symbol's own radial extent, so a touching neighbor or
   * fused linework can no longer balloon it (the A-100 pair-template bug).
   * Null when nothing measurable sits under the marker.
   */
  footprintPt: number | null;
  /**
   * What the pixel engine will actually hunt with (AITAKEOFF14 Task 2): the
   * isolated, footprint-sized crop as a PNG — shown in the panel at pick
   * time so a bad exemplar costs a 2-second re-pick, not a scanned credit.
   * Null when the footprint is unmeasurable.
   */
  previewBase64: string | null;
  /** True when isolation tightened the raw component measurement. */
  footprintClamped: boolean;
}

/** Render one PDF page at detection resolution (long edge ~3800px). */
export async function renderDetectionSheet(
  signedUrl: string,
  pageNumber: number,
): Promise<DetectionSheetRaster> {
  const page = await loadPdfPage(signedUrl, pageNumber);
  const pageSize = pageSizeOf(page);
  const longEdge = Math.max(pageSize.widthPt, pageSize.heightPt);
  const viewport = page.getViewport({ scale: DETECTION_LONG_EDGE_PX / longEdge });
  const canvas = await renderToCanvas(page, viewport.width, viewport.height, viewport);
  return { canvas, widthPx: canvas.width, heightPx: canvas.height, pageSize };
}

/** Slice the detection raster into overlapping tiles, each with its frame. */
export function sliceDetectionTiles(
  raster: DetectionSheetRaster,
  overlapPx: number = DETECTION_TILE_OVERLAP_PX,
): DetectionTileImage[] {
  return planDetectionTiles(raster.widthPx, raster.heightPx, undefined, overlapPx).map((rect) => {
    const region = document.createElement("canvas");
    region.width = Math.max(1, Math.round(rect.width));
    region.height = Math.max(1, Math.round(rect.height));
    const context = region.getContext("2d");
    if (!context) throw new Error("This browser could not prepare the sheet for scanning.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, region.width, region.height);
    context.drawImage(
      raster.canvas,
      rect.left,
      rect.top,
      region.width,
      region.height,
      0,
      0,
      region.width,
      region.height,
    );
    return {
      rect,
      frame: tileFrameFor(rect, raster.widthPx, raster.heightPx),
      base64: canvasToBase64Png(region),
      mediaType: "image/png" as const,
    };
  });
}

export interface DetectionVerifyWindowImage {
  /** The window on the detection raster, in raster pixels. */
  rect: { left: number; top: number; width: number; height: number };
  /** The window's sheet-space origin + per-pixel scale (tile semantics). */
  frame: DetectionTileFrame;
  base64: string;
  mediaType: "image/png";
  /** Size of the upscaled image actually sent to the model. */
  widthPx: number;
  heightPx: number;
  /**
   * Bit-packed dark-pixel mask of the window at WINDOW resolution
   * (AITAKEOFF4 Task 1): the server snaps the verdict center to the nearest
   * ink blob's centroid without ever decoding the PNG.
   */
  inkMaskBase64: string;
}

/**
 * Crop the stage-B verification window around one stage-A candidate from the
 * already-rendered detection raster and upscale it (AITAKEOFF3 Task 2): the
 * model judges a zoomed symbol instead of localizing on a dense sheet. The
 * window's frame reuses the tile transform semantics — the normalized
 * verdict center maps back through the same tested path with a smaller
 * denominator, so the absolute error shrinks proportionally.
 */
export function renderVerifyWindow(
  raster: DetectionSheetRaster,
  candidate: SheetPoint,
  options: { upscale?: boolean } = {},
): DetectionVerifyWindowImage {
  const rect = verifyWindowRect(
    { x: candidate.x * raster.widthPx, y: candidate.y * raster.heightPx },
    raster.widthPx,
    raster.heightPx,
  );
  const canvas = document.createElement("canvas");
  // Negative reference crops skip the 3x upscale (AITAKEOFF5 Task 1): they
  // only show what the wrong symbol looks like, at ~a tenth of the tokens.
  const scale = (options.upscale ?? true) ? VERIFY_IMAGE_PX / Math.max(rect.width, rect.height) : 1;
  canvas.width = Math.max(1, Math.round(rect.width * scale));
  canvas.height = Math.max(1, Math.round(rect.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the sheet for scanning.");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    raster.canvas,
    rect.left,
    rect.top,
    rect.width,
    rect.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );
  // The snap mask reads the UNSCALED window straight off the raster — same
  // pixel basis as the window frame, so a snapped center maps through it.
  const rasterContext = raster.canvas.getContext("2d");
  if (!rasterContext) throw new Error("This browser could not prepare the sheet for scanning.");
  const windowPixels = rasterContext.getImageData(rect.left, rect.top, rect.width, rect.height);
  const inkMask = inkMaskFromRgba(windowPixels.data, rect.width, rect.height);
  return {
    rect,
    frame: tileFrameFor(rect, raster.widthPx, raster.heightPx),
    base64: canvasToBase64Png(canvas),
    mediaType: "image/png",
    widthPx: canvas.width,
    heightPx: canvas.height,
    inkMaskBase64: inkMaskToBase64(inkMask),
  };
}

/**
 * Render the exemplar crop as a CLEAN region render of the PDF around the
 * marker (AITAKEOFF2 Task 0): ~4 sheet-inches on a side, ~640px long edge,
 * no overlay layer, window planned by the tested transform chain.
 */
export async function renderExemplarCrop(
  signedUrl: string,
  pageNumber: number,
  marker: SheetPoint,
): Promise<DetectionExemplarImage> {
  const page = await loadPdfPage(signedUrl, pageNumber);
  const pageSize = pageSizeOf(page);
  const plan = exemplarCropPlan(marker, pageSize);
  const viewport = page.getViewport({
    scale: plan.scale,
    offsetX: plan.offsetX,
    offsetY: plan.offsetY,
  });
  const canvas = await renderToCanvas(page, plan.widthPx, plan.heightPx, viewport);
  // Measure the symbol's ink footprint under the marker (AITAKEOFF5 Task 0):
  // crop px → PDF points through the crop's own render scale, so each
  // sheet's detection raster can size its tile overlap from it. ISOLATED
  // since AITAKEOFF14: the component bbox swallowed touching neighbors on
  // dense sheets ("two circular brush symbols, side by side"), collapsing
  // template recall — the footprint is clamped to the symbol's own radial
  // extent before anything downstream derives from it.
  let footprintPt: number | null = null;
  let previewBase64: string | null = null;
  let footprintClamped = false;
  const cropContext = canvas.getContext("2d");
  if (cropContext && plan.scale > 0) {
    const cropPixels = cropContext.getImageData(0, 0, canvas.width, canvas.height);
    const cropMask = inkMaskFromRgba(cropPixels.data, canvas.width, canvas.height);
    const markerInCrop = { x: plan.markerInCropPx.px, y: plan.markerInCropPx.py };
    const measuredCropPx = measureInkFootprintPx(cropMask, markerInCrop);
    if (measuredCropPx !== null) {
      const isolation = isolateExemplarFootprintPx(cropMask, markerInCrop, measuredCropPx);
      footprintPt = isolation.footprintPx / plan.scale;
      footprintClamped = isolation.clamped;
      // The pick-time preview (Task 2): the SAME window the template crop
      // will use — footprint × margin around the recentered hub — so what
      // the user approves is literally what the matcher hunts with.
      const side = Math.max(
        24,
        Math.min(320, Math.round(isolation.footprintPx * TEMPLATE_MARGIN_RATIO)),
      );
      const preview = document.createElement("canvas");
      preview.width = side;
      preview.height = side;
      const previewContext = preview.getContext("2d");
      if (previewContext) {
        previewContext.fillStyle = "#ffffff";
        previewContext.fillRect(0, 0, side, side);
        previewContext.drawImage(
          canvas,
          Math.round(isolation.center.x - side / 2),
          Math.round(isolation.center.y - side / 2),
          side,
          side,
          0,
          0,
          side,
          side,
        );
        previewBase64 = canvasToBase64Png(preview);
      }
    }
  }
  return {
    base64: canvasToBase64Png(canvas),
    mediaType: "image/png",
    widthPx: canvas.width,
    heightPx: canvas.height,
    footprintPt,
    previewBase64,
    footprintClamped,
  };
}

// --- Symbol discovery helpers (SYMBOLDISCOVERY Stage 0) ---

/** One discovery candidate: normalized sheet center + its crop as PNG. */
export interface DiscoveryCandidateCrop {
  x: number;
  y: number;
  base64: string;
}

/** Grayscale (luma-ish average) of a detection raster for the peak proposer. */
export function grayscaleFromRaster(raster: DetectionSheetRaster): Uint8Array | null {
  const context = raster.canvas.getContext("2d");
  const pixels = context?.getImageData(0, 0, raster.widthPx, raster.heightPx);
  if (!pixels) return null;
  const rgba = pixels.data;
  const gray = new Uint8Array(raster.widthPx * raster.heightPx);
  for (let p = 0; p < gray.length; p += 1) {
    gray[p] = (rgba[p * 4] + rgba[p * 4 + 1] + rgba[p * 4 + 2]) / 3;
  }
  return gray;
}

/**
 * Crop each candidate peak (raster px) to a white-ground square PNG, centers
 * normalized to [0,1] sheet space. One reused canvas keeps allocation flat —
 * the same crop shape the embedding scan sends, shared so discovery and the
 * scan can never drift apart.
 */
export function cropPeaksToBase64(
  raster: DetectionSheetRaster,
  peaks: Array<{ x: number; y: number }>,
  cropSidePx: number,
): DiscoveryCandidateCrop[] {
  const side = Math.max(24, Math.round(cropSidePx));
  const half = Math.round(side / 2);
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = side;
  cropCanvas.height = side;
  const context = cropCanvas.getContext("2d");
  if (!context) return [];
  return peaks.map((peak) => {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, side, side);
    context.drawImage(raster.canvas, peak.x - half, peak.y - half, side, side, 0, 0, side, side);
    return {
      x: peak.x / raster.widthPx,
      y: peak.y / raster.heightPx,
      base64: cropCanvas.toDataURL("image/png").split(",")[1] ?? "",
    };
  });
}
