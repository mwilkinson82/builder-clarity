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
  planDetectionTiles,
  type DetectionTileRect,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { SheetPoint } from "@/lib/ai-takeoff/ai-takeoff-domain";
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
export function sliceDetectionTiles(raster: DetectionSheetRaster): DetectionTileImage[] {
  return planDetectionTiles(raster.widthPx, raster.heightPx).map((rect) => {
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
  return {
    base64: canvasToBase64Png(canvas),
    mediaType: "image/png",
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
}
