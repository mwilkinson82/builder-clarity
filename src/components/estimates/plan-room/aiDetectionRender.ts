// Client-side detection rendering for AI-assisted counts (AITAKEOFF1 Task 1).
// The pdfjs render machinery lives in the browser (same machinery the viewer
// and thumbnails use), so the client renders the sheet at detection
// resolution, slices tiles, and crops the exemplar; the server meters credits
// and talks to the model. Nothing here touches the network besides the
// signed-URL PDF fetch pdfjs performs.

import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  DETECTION_LONG_EDGE_PX,
  EXEMPLAR_CROP_PX,
  planDetectionTiles,
  type DetectionTileRect,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { SheetPoint } from "@/lib/ai-takeoff/ai-takeoff-domain";

const configurePdfWorker = (pdfjs: unknown) => {
  const workerSrc = String(pdfWorkerUrl || "");
  if (!workerSrc) throw new Error("PDF worker is not available.");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerSrc;
};

export interface DetectionSheetRaster {
  canvas: HTMLCanvasElement;
  widthPx: number;
  heightPx: number;
}

export interface DetectionTileImage {
  rect: DetectionTileRect;
  base64: string;
  mediaType: "image/png";
}

export interface DetectionExemplarImage {
  base64: string;
  mediaType: "image/png";
}

/** Render one PDF page at detection resolution (long edge ~3800px). */
export async function renderDetectionSheet(
  signedUrl: string,
  pageNumber: number,
): Promise<DetectionSheetRaster> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ url: signedUrl }).promise;
  const page = await pdf.getPage(Math.max(1, pageNumber));
  const baseViewport = page.getViewport({ scale: 1 });
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) {
    throw new Error("This sheet could not be rendered for scanning.");
  }
  const viewport = page.getViewport({ scale: DETECTION_LONG_EDGE_PX / longEdge });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the sheet for scanning.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return { canvas, widthPx: canvas.width, heightPx: canvas.height };
}

function canvasRegionToBase64Png(
  source: HTMLCanvasElement,
  left: number,
  top: number,
  width: number,
  height: number,
): string {
  const region = document.createElement("canvas");
  region.width = Math.max(1, Math.round(width));
  region.height = Math.max(1, Math.round(height));
  const context = region.getContext("2d");
  if (!context) throw new Error("This browser could not prepare the sheet for scanning.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, region.width, region.height);
  context.drawImage(
    source,
    left,
    top,
    region.width,
    region.height,
    0,
    0,
    region.width,
    region.height,
  );
  const dataUrl = region.toDataURL("image/png");
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Tile image could not be encoded.");
  return dataUrl.slice(commaIndex + 1);
}

/** Slice the detection raster into overlapping tiles for the model. */
export function sliceDetectionTiles(raster: DetectionSheetRaster): DetectionTileImage[] {
  return planDetectionTiles(raster.widthPx, raster.heightPx).map((rect) => ({
    rect,
    base64: canvasRegionToBase64Png(raster.canvas, rect.left, rect.top, rect.width, rect.height),
    mediaType: "image/png" as const,
  }));
}

/** Crop the exemplar box around a human-placed count point (normalized coords). */
export function cropDetectionExemplar(
  raster: DetectionSheetRaster,
  point: SheetPoint,
): DetectionExemplarImage {
  const half = EXEMPLAR_CROP_PX / 2;
  const centerX = point.x * raster.widthPx;
  const centerY = point.y * raster.heightPx;
  const left = Math.min(
    Math.max(0, centerX - half),
    Math.max(0, raster.widthPx - EXEMPLAR_CROP_PX),
  );
  const top = Math.min(
    Math.max(0, centerY - half),
    Math.max(0, raster.heightPx - EXEMPLAR_CROP_PX),
  );
  return {
    base64: canvasRegionToBase64Png(
      raster.canvas,
      left,
      top,
      Math.min(EXEMPLAR_CROP_PX, raster.widthPx),
      Math.min(EXEMPLAR_CROP_PX, raster.heightPx),
    ),
    mediaType: "image/png",
  };
}
