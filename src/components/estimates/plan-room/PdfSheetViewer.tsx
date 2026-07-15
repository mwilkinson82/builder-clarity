import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { ExternalLink, Hand, Map as MapIcon, Target, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  planRoomBucket,
  type PlanSetRow,
  type PlanSheetRow,
  type TakeoffMeasurementRow,
} from "@/lib/plan-room.functions";
import {
  DEFAULT_PDF_DETAIL_MODE,
  EMPTY_VIEWPORT_FRAME,
  MAX_PLAN_ZOOM,
  MIN_PLAN_ZOOM,
  PDF_BASE_LONG_EDGE,
  PDF_DETAIL_OPTION_BY_MODE,
  PDF_DETAIL_OPTIONS,
  PDF_HIGH_DETAIL_RENDER_MAX_EDGE,
  PDF_HIGH_DETAIL_RENDER_MAX_PIXELS,
  PDF_INSPECTION_RENDER_MULTIPLIER,
  PDF_STANDARD_RENDER_MAX_EDGE,
  PDF_STANDARD_RENDER_MAX_PIXELS,
  PLAN_ZOOM_STEP,
  RULER_COLOR,
  ZOOM_SLIDER_MAX,
  ZOOM_SLIDER_MIN,
  geometryPoints,
  toolLabel,
  type DraftCommandStatus,
  type GeometryEditDraft,
  type MiniMapDock,
  type MiniMapPosition,
  type PdfDetailMode,
  type PdfRenderPlan,
  type PdfViewportLike,
  type Point,
  type RenderQualityStatus,
  type RevisionOverlayMode,
  type ToolMode,
  type ViewSize,
  type ViewportFrame,
  type ZoomWindowDraft,
} from "./planRoomShared";
import {
  extractSheetIdentities,
  normalizePdfTextItemForSheetIdentity,
  resolveTakeoffDrawPoint,
  statedScaleFeetPerPixel,
  type SheetIdentityPage,
} from "@/lib/plan-room-math";
import { inkSnapOnCanvas } from "@/lib/plan-room-ink-snap-raster";
import { DraftShape, MeasurementShape, TakeoffDraftHud } from "./TakeoffTools";
import { TakeoffRunPreview, type RunCursorState } from "./TakeoffRunPreview";
import { PlanMiniMap } from "./SheetSidebar";
import { AiGhostLayer, type AiGhostRender } from "./AiGhostLayer";

const isDirectPlanFileUrl = (filePath: string) =>
  /^(https?:|blob:|data:)/i.test(filePath) || filePath.startsWith("/");

const directPlanFileUrl = (filePath: string) => {
  if (!filePath.startsWith("/")) return filePath;
  if (typeof window === "undefined") return filePath;
  return `${window.location.origin}${filePath}`;
};

const devicePixelRatioForPdf = () => {
  if (typeof window === "undefined") return 1;
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
};

const pdfRenderLimits = () => {
  if (typeof navigator === "undefined") {
    return {
      maxEdge: PDF_STANDARD_RENDER_MAX_EDGE,
      maxPixels: PDF_STANDARD_RENDER_MAX_PIXELS,
    };
  }
  const deviceMemory =
    Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8;
  if (deviceMemory >= 4) {
    return {
      maxEdge: PDF_HIGH_DETAIL_RENDER_MAX_EDGE,
      maxPixels: PDF_HIGH_DETAIL_RENDER_MAX_PIXELS,
    };
  }
  return {
    maxEdge: PDF_STANDARD_RENDER_MAX_EDGE,
    maxPixels: PDF_STANDARD_RENDER_MAX_PIXELS,
  };
};

const pdfCssScaleFor = (viewport: PdfViewportLike) => {
  const longEdge = Math.max(viewport.width, viewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) return 1;
  return Math.min(3, Math.max(0.2, PDF_BASE_LONG_EDGE / longEdge));
};

const pdfRenderPlanFor = (
  viewport: PdfViewportLike,
  cssScale: number,
  zoom: number,
  detailMultiplier = 1,
): PdfRenderPlan => {
  const pagePixels = Math.max(1, viewport.width * viewport.height);
  const longEdge = Math.max(1, viewport.width, viewport.height);
  const desiredScale =
    cssScale * Math.max(1, zoom) * devicePixelRatioForPdf() * Math.max(1, detailMultiplier);
  const limits = pdfRenderLimits();
  const maxPixelScale = Math.sqrt(limits.maxPixels / pagePixels);
  const maxEdgeScale = limits.maxEdge / longEdge;
  const renderScale = Math.max(0.2, Math.min(desiredScale, maxPixelScale, maxEdgeScale));
  return {
    renderScale,
    desiredScale,
    capped: renderScale + 0.01 < desiredScale,
    maxEdge: limits.maxEdge,
    maxPixels: limits.maxPixels,
  };
};

const pdfRenderScaleFor = (
  viewport: PdfViewportLike,
  cssScale: number,
  zoom: number,
  detailMultiplier = 1,
) => pdfRenderPlanFor(viewport, cssScale, zoom, detailMultiplier).renderScale;

const configurePdfWorker = (pdfjs: unknown) => {
  const workerSrc = String(pdfWorkerUrl || "");
  if (!workerSrc) throw new Error("PDF worker is not available.");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerSrc;
};

const isPdfRenderCancelled = (error: unknown) =>
  error instanceof Error && error.name === "RenderingCancelledException";

const dataUrlToArrayBuffer = (url: string) => {
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid PDF data URL.");
  const meta = url.slice(0, commaIndex);
  const payload = url.slice(commaIndex + 1);
  const binary =
    meta.includes(";base64") && typeof atob !== "undefined"
      ? atob(payload)
      : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const pdfDocumentSourceFor = async (url: string) => {
  if (!url.startsWith("data:")) return { url };
  return { data: dataUrlToArrayBuffer(url) };
};

export async function getPdfPageCount(file: File) {
  if (file.type !== "application/pdf") return 1;
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  return Math.max(1, pdf.numPages);
}

// Computes stated-scale sheet patches for a whole drawing set in one pass.
// Each page can have its own paper size, so feet-per-pixel is derived per
// sheet from that page's pdf point dimensions and the same base render rule
// (pdfCssScaleFor) the viewer uses.
export async function computeStatedScalePatches({
  fileUrl,
  sheets,
  statedInches,
  statedFeet,
  scaleLabel,
}: {
  fileUrl: string;
  sheets: Array<Pick<PlanSheetRow, "id" | "page_number">>;
  statedInches: number;
  statedFeet: number;
  scaleLabel: string;
}) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(fileUrl)).promise;
  const patches: Array<{
    sheet_id: string;
    scale_feet_per_pixel: number;
    scale_label: string;
    width_px: number;
    height_px: number;
  }> = [];
  for (const sheet of sheets) {
    const page = await pdf.getPage(Math.max(1, sheet.page_number));
    const viewport = page.getViewport({ scale: 1 });
    const cssScale = pdfCssScaleFor(viewport);
    const widthPx = Math.round(viewport.width * cssScale);
    const heightPx = Math.round(viewport.height * cssScale);
    const feetPerPixel = statedScaleFeetPerPixel({
      statedInches,
      statedFeet,
      pageWidthPoints: viewport.width,
      renderedWidthPx: widthPx,
    });
    if (feetPerPixel <= 0) continue;
    patches.push({
      sheet_id: sheet.id,
      scale_feet_per_pixel: feetPerPixel,
      scale_label: scaleLabel,
      width_px: widthPx,
      height_px: heightPx,
    });
  }
  return patches;
}

const THUMBNAIL_LONG_EDGE_PX = 240;

// Renders a page thumbnail (~240px long edge, webp with jpeg fallback, small
// enough for sidebar rows) from an already-loaded pdfjs page.
async function renderPageThumbnail(page: {
  getViewport: (options: { scale: number }) => PdfViewportLike;
  // pdfjs's own RenderParameters type; kept loose so the helper accepts the
  // dynamically imported page object.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  render: (options: any) => { promise: Promise<unknown> };
}): Promise<Blob | null> {
  const baseViewport = page.getViewport({ scale: 1 });
  const longEdge = Math.max(baseViewport.width, baseViewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) return null;
  const viewport = page.getViewport({ scale: THUMBNAIL_LONG_EDGE_PX / longEdge });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  const toBlob = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  const webp = await toBlob("image/webp", 0.72);
  if (webp && webp.type === "image/webp") return webp;
  return toBlob("image/jpeg", 0.72);
}

export type ProcessedSheetPage = {
  sheet_id: string;
  page_number: number;
  sheet_number: string | null;
  sheet_name: string | null;
  thumbnail: Blob | null;
};

export interface PlanEvidenceFocus {
  id: string;
  sourceLine: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Walks a plan set's pages once with the already-loaded pdfjs machinery,
// optionally extracting title-block identity (vector text only; scanned PDFs
// simply find nothing) and rendering sidebar thumbnails. `throttleMs` keeps
// background backfills polite.
export async function processPlanSetSheets({
  source,
  sheets,
  extractIdentityText = false,
  renderThumbnails = false,
  throttleMs = 0,
}: {
  source: { url: string } | { data: ArrayBuffer };
  sheets: Array<Pick<PlanSheetRow, "id" | "page_number">>;
  extractIdentityText?: boolean;
  renderThumbnails?: boolean;
  throttleMs?: number;
}): Promise<ProcessedSheetPage[]> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const documentSource = "url" in source ? await pdfDocumentSourceFor(source.url) : source;
  const pdf = await pdfjs.getDocument(documentSource).promise;
  const results: ProcessedSheetPage[] = [];
  // Identity extraction is two-pass: collect every page's text first so the
  // cross-sheet frequency filter can spot repeated project-block fields, then
  // extract identities with those fields excluded from title candidates.
  const identityPages: Array<{ resultIndex: number; page: SheetIdentityPage }> = [];
  for (const sheet of sheets) {
    const result: ProcessedSheetPage = {
      sheet_id: sheet.id,
      page_number: sheet.page_number,
      sheet_number: null,
      sheet_name: null,
      thumbnail: null,
    };
    try {
      const page = await pdf.getPage(Math.max(1, sheet.page_number));
      if (extractIdentityText) {
        const viewport = page.getViewport({ scale: 1 });
        const textContent = (await page.getTextContent()) as {
          items: Array<{ str?: string; transform?: number[] }>;
        };
        const items = textContent.items
          .filter((item) => typeof item.str === "string" && Array.isArray(item.transform))
          .map((item) =>
            normalizePdfTextItemForSheetIdentity({
              text: item.str as string,
              textTransform: item.transform as number[],
              viewportTransform: viewport.transform,
              pageHeight: viewport.height,
            }),
          );
        identityPages.push({
          resultIndex: results.length,
          page: { items, pageWidth: viewport.width, pageHeight: viewport.height },
        });
      }
      if (renderThumbnails) {
        result.thumbnail = await renderPageThumbnail(page);
      }
    } catch {
      // A single unreadable page must not sink the rest of the set.
    }
    results.push(result);
    if (throttleMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, throttleMs));
    }
  }
  if (identityPages.length > 0) {
    const identities = extractSheetIdentities(identityPages.map((entry) => entry.page));
    identityPages.forEach((entry, index) => {
      results[entry.resultIndex].sheet_number = identities[index].sheetNumber;
      results[entry.resultIndex].sheet_name = identities[index].sheetName;
    });
  }
  return results;
}

export function PlanCanvas({
  planSet,
  sheet,
  overlayPlanSet,
  overlaySheet,
  overlayOpacity,
  overlayMode,
  measurements,
  pendingPoints,
  calibrationPoints,
  draftCommand,
  draftUnit,
  draftActionDisabled,
  onFinishDraft,
  onFinishRun,
  onAbandonDraft,
  finishPopover,
  finishPopoverAnchor,
  onFinishPopoverDismiss,
  tool,
  viewSize,
  onViewSizeChange,
  onPageMetrics,
  onPoint,
  isCockpitMode,
  selectedMeasurementId,
  onMeasurementSelect,
  onMeasurementGeometryChange,
  isGeometrySaving,
  showFloatingControls = true,
  roomControls,
  sheetControls,
  toolControls,
  aiGhosts = [],
  activeAiGhostId = null,
  onAiGhostSelect,
  aiPanel,
  aiReviewBar,
  evidenceFocus = null,
  hasPreviousSheet = false,
  hasNextSheet = false,
  onPreviousSheet,
  onNextSheet,
}: {
  planSet: PlanSetRow | null;
  sheet: PlanSheetRow | null;
  overlayPlanSet: PlanSetRow | null;
  overlaySheet: PlanSheetRow | null;
  overlayOpacity: number;
  overlayMode: RevisionOverlayMode;
  measurements: TakeoffMeasurementRow[];
  pendingPoints: Point[];
  calibrationPoints: Point[];
  draftCommand: DraftCommandStatus | null;
  draftUnit: string;
  draftActionDisabled: boolean;
  onFinishDraft: () => void;
  // Finishes an in-progress linear/area/count run with the vertices placed so
  // far (double-click, Enter, right-click closeout).
  onFinishRun?: () => void;
  // Abandons the in-progress run entirely (Esc).
  onAbandonDraft?: () => void;
  // Post-finish classification popover, anchored near the final markup point.
  // Portaled to the document root (above every floating panel) with Radix
  // collision handling so it always fits fully on screen.
  finishPopover?: ReactNode;
  finishPopoverAnchor?: Point | null;
  onFinishPopoverDismiss?: () => void;
  tool: ToolMode;
  viewSize: ViewSize;
  onViewSizeChange: (size: ViewSize) => void;
  // Reports the current pdf page's physical dimensions in pdf points (72 per
  // paper inch), or null when the sheet is not pdf-sourced. Stated-scale
  // presets are only offered when these are known.
  onPageMetrics?: (metrics: { widthPoints: number; heightPoints: number } | null) => void;
  onPoint: (point: Point) => void;
  isCockpitMode: boolean;
  selectedMeasurementId: string;
  onMeasurementSelect: (measurementId: string) => void;
  onMeasurementGeometryChange: (measurementId: string, points: Point[]) => Promise<void>;
  isGeometrySaving: boolean;
  showFloatingControls?: boolean;
  roomControls?: ReactNode;
  sheetControls?: ReactNode;
  toolControls?: ReactNode;
  // AI-assisted count ghosts on the current sheet (AITAKEOFF1). The review
  // flow owns the list; the canvas only draws them and pans to the active one.
  aiGhosts?: AiGhostRender[];
  activeAiGhostId?: string | null;
  onAiGhostSelect?: (ghostId: string) => void;
  // Floating AI Assist surfaces rendered over the canvas in both standard and
  // cockpit modes (same overlay discipline as the command decks).
  aiPanel?: ReactNode;
  aiReviewBar?: ReactNode;
  // Normalized PDF text evidence. Selecting a cited note zooms to this box;
  // the overlay never creates or modifies takeoff geometry.
  evidenceFocus?: PlanEvidenceFocus | null;
  hasPreviousSheet?: boolean;
  hasNextSheet?: boolean;
  onPreviousSheet?: () => void;
  onNextSheet?: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [signedUrl, setSignedUrl] = useState("");
  // Signed URLs expire mid-session. Any fetch failure first requests a fresh
  // URL and retries once automatically (bumping the nonce); only a second
  // failure surfaces — and then only as the contractor-language retry notice.
  // Raw error strings (they can carry the full signed URL and token) never
  // reach the canvas.
  const [renderFailed, setRenderFailed] = useState(false);
  const [signedUrlNonce, setSignedUrlNonce] = useState(0);
  const fetchAttemptRef = useRef(0);
  // Tracks what the last pdf render drew, so zoom-only changes can debounce:
  // the canvas css-scales instantly and the expensive pdfjs re-render waits
  // for the wheel to settle.
  const lastRenderSignatureRef = useRef("");
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isZoomWindowMode, setIsZoomWindowMode] = useState(false);
  const [zoomWindowDraft, setZoomWindowDraft] = useState<ZoomWindowDraft | null>(null);
  // The resolved rubber-band cursor for an active linear/area run, plus the
  // hover snap indicator before the first vertex (beta batch 1 Tasks 0/1).
  const [runCursor, setRunCursor] = useState<RunCursorState | null>(null);
  // Space-bar-hold turns any tool into the pan hand without leaving the run.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [miniMapDock, setMiniMapDock] = useState<MiniMapDock>("bottom-left");
  const [miniMapPosition, setMiniMapPosition] = useState<MiniMapPosition | null>(null);
  const [isMiniMapCollapsed, setIsMiniMapCollapsed] = useState(false);
  const [hasMiniMapPreference, setHasMiniMapPreference] = useState(false);
  const [viewportFrame, setViewportFrame] = useState<ViewportFrame>(EMPTY_VIEWPORT_FRAME);
  const [renderQuality, setRenderQuality] = useState<RenderQualityStatus | null>(null);
  const [pdfDetailMode, setPdfDetailMode] = useState<PdfDetailMode>(DEFAULT_PDF_DETAIL_MODE);
  const [geometryEditDraft, setGeometryEditDraft] = useState<GeometryEditDraft | null>(null);
  const [geometryPreview, setGeometryPreview] = useState<{
    measurementId: string;
    points: Point[];
  } | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, dragged: false });
  // Right-button drag pans the sheet mid-run; a right click without drag
  // (travel <= 4px) finishes the run on pointer up (beta batch 1 Task 3).
  const rightPanRef = useRef({
    active: false,
    pointerId: 0,
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    dragged: false,
  });
  // macOS raises the context menu at press time, so suppression is decided
  // at pointer down and consumed by the next contextmenu event.
  const suppressContextMenuRef = useRef(false);
  // Last pointer position over the canvas, so the rubber-band preview can
  // re-resolve after pans and zooms move the sheet under a still cursor.
  const lastPointerRef = useRef<{ x: number; y: number; alt: boolean; shift: boolean } | null>(
    null,
  );
  const zoomWindowClickBlockRef = useRef(false);
  const geometryEditClickBlockRef = useRef(false);
  const hasRevisionOverlay = Boolean(overlayPlanSet && overlaySheet);
  const overlayBlendMode = overlayMode === "compare" ? "multiply" : "normal";
  const selectedMeasurement =
    measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null;

  useEffect(() => {
    if (!evidenceFocus) return;
    const nextZoom = Math.max(zoom, 2.25);
    if (nextZoom !== zoom) setZoom(nextZoom);
    const centerEvidence = () => {
      const stage = scrollRef.current;
      if (!stage) return;
      const centerX = (evidenceFocus.x + evidenceFocus.width / 2) * viewSize.width * nextZoom;
      const centerY = (evidenceFocus.y + evidenceFocus.height / 2) * viewSize.height * nextZoom;
      stage.scrollTo({
        left: Math.max(0, centerX - stage.clientWidth / 2),
        top: Math.max(0, centerY - stage.clientHeight / 2),
        behavior: "smooth",
      });
    };
    let innerFrame = 0;
    const frame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(centerEvidence);
    });
    return () => {
      cancelAnimationFrame(frame);
      if (innerFrame) cancelAnimationFrame(innerFrame);
    };
  }, [evidenceFocus, viewSize.height, viewSize.width, zoom]);

  useEffect(() => {
    if (hasMiniMapPreference) return;
    setIsMiniMapCollapsed(isCockpitMode);
    if (isCockpitMode) {
      setMiniMapDock("bottom-left");
      setMiniMapPosition(null);
    }
  }, [hasMiniMapPreference, isCockpitMode]);

  const setMiniMapCollapsedByUser = useCallback((collapsed: boolean) => {
    setHasMiniMapPreference(true);
    setIsMiniMapCollapsed(collapsed);
  }, []);
  const pdfDetailOption = PDF_DETAIL_OPTION_BY_MODE[pdfDetailMode];
  const pdfDetailMultiplier = pdfDetailOption.multiplier;

  // Fresh drawing file, fresh retry budget.
  useEffect(() => {
    fetchAttemptRef.current = 0;
  }, [planSet?.file_path, sheet?.id]);

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderFailed(false);
    setRenderQuality(null);
    if (!planSet?.file_path) return;
    if (isDirectPlanFileUrl(planSet.file_path)) {
      setSignedUrl(directPlanFileUrl(planSet.file_path));
      return;
    }
    supabase.storage
      .from(planRoomBucket)
      .createSignedUrl(planSet.file_path, 60 * 30)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.signedUrl) {
          if (fetchAttemptRef.current < 1) {
            fetchAttemptRef.current += 1;
            setSignedUrlNonce((nonce) => nonce + 1);
          } else {
            setRenderFailed(true);
          }
          return;
        }
        setSignedUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [planSet?.file_path, signedUrlNonce]);

  useEffect(() => {
    if (planSet?.sample_key === "harbor-residence" || !planSet?.file_path) {
      setRenderQuality({
        label: "Vector sample",
        details: "Sample sheets render as vector training drawings.",
      });
    }
  }, [planSet?.file_path, planSet?.sample_key]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    const renderPdf = async () => {
      if (!signedUrl || planSet?.file_mime_type !== "application/pdf" || !canvasRef.current) {
        onPageMetrics?.(null);
        return;
      }
      try {
        const pdfjs = await import("pdfjs-dist");
        configurePdfWorker(pdfjs);
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet?.page_number ?? 1);
        const viewport = page.getViewport({ scale: 1 });
        if (!cancelled) {
          onPageMetrics?.({ widthPoints: viewport.width, heightPoints: viewport.height });
        }
        const cssScale = pdfCssScaleFor(viewport);
        const renderPlan = pdfRenderPlanFor(viewport, cssScale, zoom, pdfDetailMultiplier);
        const renderScale = renderPlan.renderScale;
        const cssViewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(renderViewport.width);
        canvas.height = Math.round(renderViewport.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        canvas.dataset.pdfDetailMode = pdfDetailMode;
        setRenderQuality({
          label: renderPlan.capped ? "Device Max" : pdfDetailOption.badge,
          details: `${pdfDetailOption.label} mode: ${canvas.width.toLocaleString()} x ${canvas.height.toLocaleString()} PDF render at ${renderScale.toFixed(
            2,
          )}x. Device limit: ${renderPlan.maxEdge.toLocaleString()}px edge / ${(
            renderPlan.maxPixels / 1_000_000
          ).toFixed(0)}M pixels.`,
          capped: renderPlan.capped,
        });
        onViewSizeChange({
          width: Math.round(cssViewport.width),
          height: Math.round(cssViewport.height),
        });
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: renderViewport,
        });
        await renderTask.promise;
        if (!cancelled) fetchAttemptRef.current = 0;
      } catch (error) {
        if (cancelled || isPdfRenderCancelled(error)) return;
        // Most mid-session failures are an expired signed URL: request a
        // fresh one and retry once before surfacing anything.
        if (fetchAttemptRef.current < 1) {
          fetchAttemptRef.current += 1;
          setSignedUrlNonce((nonce) => nonce + 1);
        } else {
          setRenderFailed(true);
        }
      }
    };
    const signature = `${signedUrl}|${sheet?.page_number ?? 1}|${pdfDetailMode}`;
    const zoomOnlyChange = lastRenderSignatureRef.current === signature;
    lastRenderSignatureRef.current = signature;
    const timer = window.setTimeout(() => void renderPdf(), zoomOnlyChange ? 160 : 0);
    return () => {
      window.clearTimeout(timer);
      cancelled = true;
      renderTask?.cancel();
    };
  }, [
    onPageMetrics,
    onViewSizeChange,
    pdfDetailMode,
    pdfDetailMultiplier,
    pdfDetailOption.badge,
    pdfDetailOption.label,
    planSet?.file_mime_type,
    sheet?.page_number,
    signedUrl,
    zoom,
  ]);

  const retryPlanRender = () => {
    fetchAttemptRef.current = 0;
    setRenderFailed(false);
    setSignedUrlNonce((nonce) => nonce + 1);
  };

  useEffect(() => {
    setZoom(1);
    setIsZoomWindowMode(false);
    setZoomWindowDraft(null);
    setGeometryEditDraft(null);
    setGeometryPreview(null);
    setRunCursor(null);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    });
  }, [sheet?.id]);

  useEffect(() => {
    setIsZoomWindowMode(false);
    setZoomWindowDraft(null);
    setGeometryEditDraft(null);
  }, [tool]);

  useEffect(() => {
    setGeometryEditDraft(null);
    setGeometryPreview(null);
  }, [selectedMeasurementId]);

  const clampZoom = (nextZoom: number) =>
    Math.min(MAX_PLAN_ZOOM, Math.max(MIN_PLAN_ZOOM, nextZoom));

  useEffect(() => {
    if (tool !== "linear" && tool !== "area" && tool !== "ruler") setRunCursor(null);
  }, [tool]);

  const updateViewportFrame = useCallback(() => {
    const stage = scrollRef.current;
    if (!stage || stage.scrollWidth <= 0 || stage.scrollHeight <= 0) {
      setViewportFrame(EMPTY_VIEWPORT_FRAME);
      return;
    }
    const scrollableWidth = Math.max(1, stage.scrollWidth);
    const scrollableHeight = Math.max(1, stage.scrollHeight);
    setViewportFrame({
      x: Math.min(1, Math.max(0, stage.scrollLeft / scrollableWidth)),
      y: Math.min(1, Math.max(0, stage.scrollTop / scrollableHeight)),
      width: Math.min(1, Math.max(0.05, stage.clientWidth / scrollableWidth)),
      height: Math.min(1, Math.max(0.05, stage.clientHeight / scrollableHeight)),
    });
  }, []);

  const setClampedZoom = (nextZoom: number) => {
    setZoom(clampZoom(nextZoom));
  };

  const zoomBy = (delta: number) => {
    setClampedZoom(Number((zoom + delta).toFixed(2)));
  };

  const setZoomAndScroll = (nextZoom: number, scrollLeft = 0, scrollTop = 0) => {
    const clampedZoom = clampZoom(nextZoom);
    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = Math.max(0, scrollLeft);
      scrollRef.current.scrollTop = Math.max(0, scrollTop);
      updateViewportFrame();
    });
    return clampedZoom;
  };

  const fitToStage = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0 || viewSize.height <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = Math.min(
      (stage.clientWidth - 32) / viewSize.width,
      (stage.clientHeight - 32) / viewSize.height,
    );
    setZoomAndScroll(Number(Math.min(1, fitZoom).toFixed(2)));
  };

  const fitToWidth = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = (stage.clientWidth - 32) / viewSize.width;
    setZoomAndScroll(Number(fitZoom.toFixed(2)), 0, stage.scrollTop);
  };

  const fitToHeight = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.height <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = (stage.clientHeight - 32) / viewSize.height;
    setZoomAndScroll(Number(fitZoom.toFixed(2)), stage.scrollLeft, 0);
  };

  const setActualSize = () => {
    setZoomAndScroll(1);
  };

  const zoomToWindow = (draft: ZoomWindowDraft) => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0 || viewSize.height <= 0) return;
    const minX = Math.min(draft.start.x, draft.end.x);
    const minY = Math.min(draft.start.y, draft.end.y);
    const maxX = Math.max(draft.start.x, draft.end.x);
    const maxY = Math.max(draft.start.y, draft.end.y);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width * viewSize.width < 24 || height * viewSize.height < 24) {
      toast.warning("Drag a larger box around the area you want to inspect.");
      return;
    }
    const targetZoom = Math.min(
      (stage.clientWidth - 48) / (width * viewSize.width),
      (stage.clientHeight - 48) / (height * viewSize.height),
    );
    const nextZoom = clampZoom(Number(targetZoom.toFixed(2)));
    const focusedWidth = width * viewSize.width * nextZoom;
    const focusedHeight = height * viewSize.height * nextZoom;
    const scrollLeft = minX * viewSize.width * nextZoom - (stage.clientWidth - focusedWidth) / 2;
    const scrollTop = minY * viewSize.height * nextZoom - (stage.clientHeight - focusedHeight) / 2;
    setZoomAndScroll(nextZoom, scrollLeft, scrollTop);
  };

  const panBy = (left: number, top: number) => {
    scrollRef.current?.scrollBy({ left, top });
    requestAnimationFrame(updateViewportFrame);
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,button,[role='combobox']")) return;

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(PLAN_ZOOM_STEP);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(-PLAN_ZOOM_STEP);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setActualSize();
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitToStage();
      return;
    }
    if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      fitToWidth();
      return;
    }
    // Bare Z toggles zoom-window mode. Cmd/Ctrl+Z is takeoff undo — let it
    // bubble to the workspace's window-level handler untouched.
    if (event.key.toLowerCase() === "z" && !event.metaKey && !event.ctrlKey) {
      event.preventDefault();
      setIsZoomWindowMode((current) => !current);
      setZoomWindowDraft(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsZoomWindowMode(false);
      setZoomWindowDraft(null);
      setGeometryEditDraft(null);
      setGeometryPreview(null);
      if (
        (tool === "linear" || tool === "area" || tool === "count" || tool === "ruler") &&
        pendingPoints.length > 0
      ) {
        onAbandonDraft?.();
        setRunCursor(null);
      }
      return;
    }
    if (event.key === "Enter" && draftCommand?.ready && !draftActionDisabled) {
      event.preventDefault();
      onFinishDraft();
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      if (hasPreviousSheet) onPreviousSheet?.();
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      if (hasNextSheet) onNextSheet?.();
      return;
    }

    const panDistance = event.shiftKey ? 260 : 90;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      panBy(-panDistance, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      panBy(panDistance, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      panBy(0, -panDistance);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      panBy(0, panDistance);
    }
  };

  const jumpViewport = useCallback(
    (point: Point) => {
      const stage = scrollRef.current;
      if (!stage) return;
      stage.scrollLeft = Math.max(0, point.x * stage.scrollWidth - stage.clientWidth / 2);
      stage.scrollTop = Math.max(0, point.y * stage.scrollHeight - stage.clientHeight / 2);
      requestAnimationFrame(updateViewportFrame);
    },
    [updateViewportFrame],
  );

  useEffect(() => {
    if (!selectedMeasurement) return;
    const points = geometryPoints(selectedMeasurement.geometry);
    if (points.length === 0) return;
    const center =
      points.length === 1
        ? points[0]
        : {
            x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
            y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
          };
    requestAnimationFrame(() => jumpViewport(center));
  }, [jumpViewport, selectedMeasurement, sheet?.id, viewSize.height, viewSize.width, zoom]);

  // AI review: pan (and zoom in enough to read the symbol) to the active
  // ghost so the human always sees what they are accepting or rejecting.
  useEffect(() => {
    if (!activeAiGhostId) return;
    const ghost = aiGhosts.find((item) => item.id === activeAiGhostId);
    if (!ghost) return;
    setZoom((current) => (current < 1.5 ? 1.5 : current));
    requestAnimationFrame(() => jumpViewport({ x: ghost.x, y: ghost.y }));
  }, [activeAiGhostId, aiGhosts, jumpViewport, sheet?.id, viewSize.height, viewSize.width, zoom]);

  useEffect(() => {
    requestAnimationFrame(updateViewportFrame);
  }, [updateViewportFrame, viewSize.height, viewSize.width, zoom]);

  useEffect(() => {
    const stage = scrollRef.current;
    if (!stage) return;
    stage.addEventListener("scroll", updateViewportFrame, { passive: true });
    window.addEventListener("resize", updateViewportFrame);
    updateViewportFrame();
    return () => {
      stage.removeEventListener("scroll", updateViewportFrame);
      window.removeEventListener("resize", updateViewportFrame);
    };
  }, [updateViewportFrame]);

  const pointFromClient = useCallback((clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  }, []);

  // Geometry-snap candidates: every vertex of every visible takeoff on this
  // sheet, so a new run can start or finish exactly where a prior one ended.
  const snapCandidates = useMemo(
    () => measurements.flatMap((measurement) => geometryPoints(measurement.geometry)),
    [measurements],
  );

  // Where the next click will land: Alt bypasses snapping, a nearby committed
  // vertex beats the ortho magnet, Shift hard-constrains to 45s.
  const resolveDrawCursor = useCallback(
    (cursor: Point, altKey: boolean, shiftKey: boolean): RunCursorState => {
      const base = resolveTakeoffDrawPoint({
        anchor: pendingPoints.length > 0 ? pendingPoints[pendingPoints.length - 1] : null,
        cursor,
        viewSize,
        zoom,
        candidates: snapCandidates,
        altKey,
        shiftKey,
      });
      // Magnetic ink-snap (SMARTTRACE Slice 1): while tracing linear/area, snap
      // the point onto the nearest wall line in the drawing. Alt bypasses it, a
      // committed-vertex snap always wins, otherwise the wall beats the ortho
      // magnet. Falls back to `base` when nothing wall-like is near the cursor.
      if (!altKey && (tool === "linear" || tool === "area") && !base.geometrySnapped) {
        const canvas = canvasRef.current;
        const inked = canvas ? inkSnapOnCanvas(canvas, cursor) : null;
        if (inked) return { ...base, point: inked, orthoSnapped: false };
      }
      return base;
    },
    [pendingPoints, snapCandidates, viewSize, zoom, tool],
  );

  // Re-resolves the rubber band from the last known pointer position after
  // the sheet moves under a still cursor (pan, wheel zoom, placed vertex).
  const refreshRunCursorFromLastPointer = useCallback(() => {
    if (tool !== "linear" && tool !== "area" && tool !== "ruler") return;
    const last = lastPointerRef.current;
    if (!last) return;
    const cursor = pointFromClient(last.x, last.y);
    if (cursor) setRunCursor(resolveDrawCursor(cursor, last.alt, last.shift));
  }, [pointFromClient, resolveDrawCursor, tool]);

  useEffect(() => {
    refreshRunCursorFromLastPointer();
  }, [refreshRunCursorFromLastPointer]);

  // Wheel/pinch zoom anchored to the cursor: the sheet point under the
  // pointer stays under the pointer, so zooming mid-run never loses the
  // place being drawn (beta batch 1 Task 4).
  const zoomAtCursor = (nextZoomRaw: number, clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const nextZoom = clampZoom(Number(nextZoomRaw.toFixed(2)));
    if (!svg || nextZoom === zoom) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      setClampedZoom(nextZoom);
      return;
    }
    const fractionX = (clientX - rect.left) / rect.width;
    const fractionY = (clientY - rect.top) / rect.height;
    setZoom(nextZoom);
    requestAnimationFrame(() => {
      const stage = scrollRef.current;
      const svgAfter = svgRef.current;
      if (!stage || !svgAfter) return;
      const after = svgAfter.getBoundingClientRect();
      stage.scrollLeft += after.left + fractionX * after.width - clientX;
      stage.scrollTop += after.top + fractionY * after.height - clientY;
      updateViewportFrame();
      refreshRunCursorFromLastPointer();
    });
  };

  // Plain wheel zooms the sheet (trackpad pinch arrives as a ctrlKey wheel);
  // panels outside this viewport keep native scrolling. A native non-passive
  // listener is required — React root wheel listeners are passive, and the
  // browser must not also scroll the stage or page-zoom.
  const wheelHandlerRef = useRef<(event: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheelHandlerRef.current = (event: WheelEvent) => {
      event.preventDefault();
      const deltaScale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1;
      const factor = Math.exp(-event.deltaY * deltaScale * (event.ctrlKey ? 0.01 : 0.0022));
      lastPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        alt: event.altKey,
        shift: event.shiftKey,
      };
      zoomAtCursor(zoom * factor, event.clientX, event.clientY);
    };
  });
  useEffect(() => {
    const stage = scrollRef.current;
    if (!stage) return;
    const listener = (event: WheelEvent) => wheelHandlerRef.current(event);
    stage.addEventListener("wheel", listener, { passive: false });
    return () => stage.removeEventListener("wheel", listener);
  }, []);

  // Space-bar-hold + drag pans with any tool active, without disturbing an
  // in-progress run (CAD muscle memory). Window-level so it works no matter
  // what has focus, guarded so typing and buttons keep their space.
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest("input,textarea,select,button,a,[contenteditable='true'],[role='combobox']")
      ) {
        return;
      }
      event.preventDefault();
      setSpaceHeld(true);
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") setSpaceHeld(false);
    };
    const clear = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const pointsForMeasurement = (measurement: TakeoffMeasurementRow) => {
    if (geometryPreview?.measurementId === measurement.id) return geometryPreview.points;
    return geometryPoints(measurement.geometry);
  };

  const beginGeometryEdit = (
    event: ReactPointerEvent<SVGCircleElement>,
    measurement: TakeoffMeasurementRow,
    pointIndex: number,
  ) => {
    if (tool !== "select" || isGeometrySaving) return;
    event.stopPropagation();
    event.preventDefault();
    const points = pointsForMeasurement(measurement);
    if (!points[pointIndex]) return;
    onMeasurementSelect(measurement.id);
    setGeometryEditDraft({ measurementId: measurement.id, pointIndex, points });
    setGeometryPreview({ measurementId: measurement.id, points });
    geometryEditClickBlockRef.current = true;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const isDrawTool = tool === "linear" || tool === "area" || tool === "count" || tool === "ruler";

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (geometryEditDraft) return;
    // Right button on a draw tool: drag pans the sheet mid-run, a click
    // without drag finishes the run on pointer up. The context menu is
    // suppressed from here because macOS raises it at press time.
    if (event.button === 2 && isDrawTool && scrollRef.current) {
      event.preventDefault();
      suppressContextMenuRef.current = true;
      rightPanRef.current = {
        active: true,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: scrollRef.current.scrollLeft,
        top: scrollRef.current.scrollTop,
        dragged: false,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    if (isZoomWindowMode && !spaceHeld) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setZoomWindowDraft({ start: point, end: point });
      zoomWindowClickBlockRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if ((tool !== "select" && !spaceHeld) || !scrollRef.current) return;
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
      dragged: false,
    };
    setIsPanning(true);
    // Deliberately NO pointer capture here (AITAKEOFF4 Task 0): capturing at
    // press time retargets the eventual click to this svg, which silently
    // eats clicks on measurement markers in select mode — arming an AI
    // exemplar from a saved marker did nothing. The pan takes capture only
    // once movement proves the gesture is a drag (see handlePointerMove).
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (rightPanRef.current.active) {
      const dx = event.clientX - rightPanRef.current.x;
      const dy = event.clientY - rightPanRef.current.y;
      // 4px of travel separates a pan from a finish-run click.
      if (!rightPanRef.current.dragged && Math.hypot(dx, dy) > 4) {
        rightPanRef.current.dragged = true;
      }
      if (rightPanRef.current.dragged && scrollRef.current) {
        scrollRef.current.scrollLeft = rightPanRef.current.left - dx;
        scrollRef.current.scrollTop = rightPanRef.current.top - dy;
        lastPointerRef.current = {
          x: event.clientX,
          y: event.clientY,
          alt: event.altKey,
          shift: event.shiftKey,
        };
        refreshRunCursorFromLastPointer();
      }
      return;
    }
    if (geometryEditDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const nextPoints = geometryEditDraft.points.map((current, index) =>
        index === geometryEditDraft.pointIndex ? point : current,
      );
      setGeometryEditDraft((current) => (current ? { ...current, points: nextPoints } : current));
      setGeometryPreview({ measurementId: geometryEditDraft.measurementId, points: nextPoints });
      return;
    }
    if (isZoomWindowMode && zoomWindowDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setZoomWindowDraft((current) => (current ? { ...current, end: point } : current));
      return;
    }
    if (isPanning && scrollRef.current) {
      const dx = event.clientX - panStartRef.current.x;
      const dy = event.clientY - panStartRef.current.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        panStartRef.current.dragged = true;
        // The gesture is now provably a drag: take capture so the pan keeps
        // tracking outside the svg. Never earlier — capture at press time
        // retargets the click and eats marker selection (AITAKEOFF4 Task 0).
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.setPointerCapture(event.pointerId);
        }
      }
      scrollRef.current.scrollLeft = panStartRef.current.left - dx;
      scrollRef.current.scrollTop = panStartRef.current.top - dy;
      lastPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        alt: event.altKey,
        shift: event.shiftKey,
      };
      refreshRunCursorFromLastPointer();
      return;
    }
    if (tool === "linear" || tool === "area" || tool === "ruler") {
      const cursor = pointFromClient(event.clientX, event.clientY);
      if (cursor) {
        lastPointerRef.current = {
          x: event.clientX,
          y: event.clientY,
          alt: event.altKey,
          shift: event.shiftKey,
        };
        setRunCursor(resolveDrawCursor(cursor, event.altKey, event.shiftKey));
      }
    }
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (rightPanRef.current.active && event.pointerId === rightPanRef.current.pointerId) {
      const wasDrag = rightPanRef.current.dragged;
      rightPanRef.current.active = false;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // Right click without drag keeps its shipped finish-run behavior.
      if (!wasDrag && event.button === 2 && pendingPoints.length > 0) {
        onFinishRun?.();
      }
      return;
    }
    if (geometryEditDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      const completedPoints = point
        ? geometryEditDraft.points.map((current, index) =>
            index === geometryEditDraft.pointIndex ? point : current,
          )
        : geometryEditDraft.points;
      const measurementId = geometryEditDraft.measurementId;
      setGeometryEditDraft(null);
      setGeometryPreview({ measurementId, points: completedPoints });
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
      void onMeasurementGeometryChange(measurementId, completedPoints).catch((error) => {
        setGeometryPreview(null);
        toast.error(error instanceof Error ? error.message : "Takeoff geometry did not save");
      });
      return;
    }
    if (isZoomWindowMode && zoomWindowDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      const completedDraft = point ? { ...zoomWindowDraft, end: point } : zoomWindowDraft;
      setZoomWindowDraft(null);
      setIsZoomWindowMode(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      zoomToWindow(completedDraft);
      return;
    }
    if (!isPanning) return;
    setIsPanning(false);
    // Capture only exists when the pan actually dragged.
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const pointFromEvent = (event: ReactMouseEvent<SVGSVGElement>): Point | null => {
    return pointFromClient(event.clientX, event.clientY);
  };

  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (geometryEditClickBlockRef.current) {
      geometryEditClickBlockRef.current = false;
      return;
    }
    if (zoomWindowClickBlockRef.current || isZoomWindowMode) {
      zoomWindowClickBlockRef.current = false;
      return;
    }
    if (panStartRef.current.dragged) {
      panStartRef.current.dragged = false;
      return;
    }
    if (spaceHeld) return;
    const point = pointFromEvent(event);
    if (!point) return;
    // The second click of a double-click finishes the run (via onDoubleClick)
    // instead of planting a duplicate vertex.
    if ((tool === "linear" || tool === "area" || tool === "ruler") && event.detail > 1) return;
    // The committed click obeys the same snaps as the rubber-band preview:
    // geometry snap first, then the ortho magnet; Alt places the raw point.
    if (tool === "linear" || tool === "area" || tool === "ruler") {
      onPoint(resolveDrawCursor(point, event.altKey, event.shiftKey).point);
      return;
    }
    onPoint(point);
  };

  const viewBox = `0 0 ${viewSize.width} ${viewSize.height}`;
  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const zoomSliderValue = Math.round(zoom * 100);
  const canOpenOriginalPdf =
    Boolean(signedUrl) && planSet?.file_mime_type === "application/pdf" && !planSet?.sample_key;
  const renderPlanControlBar = (className: string, testId: string, compact = false) => (
    <div className={className} data-testid={testId}>
      <div className="flex min-w-0 items-center gap-2">
        <Badge variant={tool === "select" ? "secondary" : "outline"} className="gap-1.5">
          {tool === "select" ? <Hand className="h-3 w-3" /> : <Target className="h-3 w-3" />}
          {toolLabel(tool)}
        </Badge>
        <Badge variant="outline">{zoomPercent}</Badge>
        {renderQuality && (
          <Badge
            variant={renderQuality.capped ? "secondary" : "outline"}
            title={renderQuality.details}
            data-testid="plan-render-quality"
          >
            {renderQuality.label}
          </Badge>
        )}
        {planSet?.file_mime_type === "application/pdf" && !planSet?.sample_key && (
          <Badge
            variant="outline"
            title="Uploaded PDFs render at a higher backing resolution so plan notes stay readable while you zoom."
            data-testid="plan-pdf-inspection-mode"
          >
            Inspection render
          </Badge>
        )}
        {hasRevisionOverlay && (
          <Badge variant="secondary" data-testid="plan-revision-overlay-active">
            Revision overlay
          </Badge>
        )}
        <span className="hidden truncate text-xs text-muted-foreground lg:inline">
          {Math.round(viewSize.width)} x {Math.round(viewSize.height)}
        </span>
      </div>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={isZoomWindowMode ? "default" : "outline"}
          className={cn(compact && "h-8 gap-1.5 px-2 text-xs")}
          title="Zoom to area"
          onClick={() => {
            setIsZoomWindowMode((current) => !current);
            setZoomWindowDraft(null);
          }}
          data-testid="plan-zoom-window"
        >
          <ZoomIn className="h-3.5 w-3.5" />
          <span className={cn(compact && "hidden 2xl:inline")}>Zoom Area</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant={isMiniMapCollapsed ? "outline" : "default"}
          className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
          title={isMiniMapCollapsed ? "Show sheet map" : "Hide sheet map"}
          aria-pressed={!isMiniMapCollapsed}
          onClick={() => {
            setHasMiniMapPreference(true);
            setIsMiniMapCollapsed((current) => !current);
          }}
          data-testid="plan-minimap-toggle"
        >
          <MapIcon className="h-3.5 w-3.5" />
          <span className={cn(compact && "hidden 2xl:inline")}>Map</span>
        </Button>
        {canOpenOriginalPdf && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
            title="Open the untouched source PDF in a new tab"
            asChild
            data-testid="plan-open-original-pdf"
          >
            <a href={signedUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
              <span className={cn(compact && "hidden 2xl:inline")}>Open Source PDF</span>
            </a>
          </Button>
        )}
        {canOpenOriginalPdf && (
          <div
            className="flex items-center rounded-md border border-hairline bg-surface p-0.5"
            data-testid="plan-pdf-detail-controls"
            title="PDF render detail"
          >
            {PDF_DETAIL_OPTIONS.map((option) => {
              const selected = option.mode === pdfDetailMode;
              return (
                <button
                  key={option.mode}
                  type="button"
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition",
                    selected
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-background hover:text-foreground",
                  )}
                  title={option.title}
                  aria-pressed={selected}
                  onClick={() => setPdfDetailMode(option.mode)}
                  data-testid={option.testId}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        )}
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          title="Zoom out"
          onClick={() => zoomBy(-PLAN_ZOOM_STEP)}
          disabled={zoom <= MIN_PLAN_ZOOM}
          data-testid="plan-zoom-out"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(compact && "h-8 px-2 text-xs")}
          title="Fit sheet"
          onClick={fitToStage}
          data-testid="plan-fit-sheet"
        >
          Fit
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(compact && "h-8 px-2 text-xs")}
          title="Fit width"
          onClick={fitToWidth}
          data-testid="plan-fit-width"
        >
          Width
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(compact && "h-8 px-2 text-xs")}
          title="Fit height"
          onClick={fitToHeight}
          data-testid="plan-fit-height"
        >
          Height
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(compact && "h-8 px-2 text-xs")}
          title="Actual size"
          onClick={setActualSize}
          data-testid="plan-actual-size"
        >
          100%
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          title="Zoom in"
          onClick={() => zoomBy(PLAN_ZOOM_STEP)}
          disabled={zoom >= MAX_PLAN_ZOOM}
          data-testid="plan-zoom-in"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </Button>
        <div
          className={cn("flex w-36 items-center px-2", compact && "hidden 2xl:flex")}
          data-testid="plan-zoom-slider"
        >
          <Slider
            className="[&>span:first-child]:bg-muted [&>span:first-child>span]:bg-clay [&_[role=slider]]:border-clay [&_[role=slider]]:bg-surface"
            min={ZOOM_SLIDER_MIN}
            max={ZOOM_SLIDER_MAX}
            step={5}
            value={[zoomSliderValue]}
            onValueChange={(value) => setClampedZoom((value[0] ?? 100) / 100)}
            aria-label="Plan zoom percentage"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex flex-col bg-background",
        isCockpitMode ? "min-h-0 flex-1 p-0" : "p-4",
      )}
    >
      {!isCockpitMode &&
        renderPlanControlBar(
          "mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2",
          "plan-canvas-controls",
        )}

      {!isCockpitMode && (
        <TakeoffDraftHud
          draftCommand={draftCommand}
          activePointCount={
            tool === "calibrate" || tool === "verify"
              ? calibrationPoints.length
              : pendingPoints.length
          }
          disabled={draftActionDisabled}
          onFinishDraft={onFinishDraft}
        />
      )}

      {isCockpitMode && showFloatingControls && (
        <div
          className="pointer-events-none absolute inset-x-2 top-2 z-30 flex flex-wrap items-start justify-between gap-2"
          data-testid="plan-cockpit-command-deck"
        >
          {roomControls}
          {toolControls && (
            <div
              className="pointer-events-auto rounded-md border border-hairline bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur"
              data-testid="plan-cockpit-floating-takeoff-tools"
            >
              {toolControls}
            </div>
          )}
          {sheetControls && (
            <div
              className="pointer-events-auto rounded-md border border-hairline bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur"
              data-testid="plan-cockpit-sheet-controls"
            >
              {sheetControls}
            </div>
          )}
        </div>
      )}

      {isCockpitMode && showFloatingControls && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center">
          {renderPlanControlBar(
            "pointer-events-auto flex max-w-[min(680px,calc(100vw-2rem))] flex-wrap items-center justify-between gap-2 rounded-md border border-hairline bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur",
            "plan-cockpit-floating-controls",
            true,
          )}
        </div>
      )}

      {isCockpitMode && draftCommand && (
        <div className="pointer-events-none absolute bottom-4 left-4 z-30 w-[min(560px,calc(100vw-2rem))]">
          <TakeoffDraftHud
            draftCommand={draftCommand}
            activePointCount={
              tool === "calibrate" || tool === "verify"
                ? calibrationPoints.length
                : pendingPoints.length
            }
            disabled={draftActionDisabled}
            onFinishDraft={onFinishDraft}
            className="pointer-events-auto"
          />
        </div>
      )}

      {aiPanel && (
        // Full-canvas positioning context: the panel drags anywhere over the
        // canvas and clamps itself to this box (AITAKEOFF2 Task 3). The
        // wrapper ignores pointer events; the panel re-enables its own.
        <div className="pointer-events-none absolute inset-0 z-40 [&>*]:pointer-events-auto">
          {aiPanel}
        </div>
      )}
      {aiReviewBar && (
        <div className="pointer-events-none absolute inset-x-3 bottom-16 z-40 flex justify-center">
          <div className="pointer-events-auto">{aiReviewBar}</div>
        </div>
      )}

      <div
        ref={scrollRef}
        tabIndex={0}
        className={cn(
          "relative min-h-0 overflow-auto bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isCockpitMode
            ? "flex-1 rounded-none border-0"
            : "h-[min(72vh,760px)] rounded-md border border-hairline shadow-inner",
        )}
        onKeyDown={handleKeyboard}
        aria-label="Plan drawing viewport"
        title="Plan viewport: scroll wheel zooms at the cursor (+/- keys too), right-drag or hold Space to pan, arrows pan, PageUp/PageDown for sheets, F to fit, W for width, Z for zoom area, Esc to cancel."
        data-testid="plan-viewport"
      >
        <div
          className={cn(
            "inline-flex min-h-full min-w-full items-start justify-center",
            isCockpitMode ? "p-2" : "p-4",
          )}
        >
          <div
            className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-sm"
            style={{
              width: `${Math.max(1, viewSize.width * zoom)}px`,
              height: `${Math.max(1, viewSize.height * zoom)}px`,
            }}
          >
            {planSet?.sample_key === "harbor-residence" || !planSet?.file_path ? (
              <SamplePlanBackground sheet={sheet} viewSize={viewSize} />
            ) : planSet.file_mime_type === "application/pdf" ? (
              <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-white" />
            ) : signedUrl ? (
              <img
                ref={imageRef}
                src={signedUrl}
                alt={sheet?.sheet_name || "Plan sheet"}
                className="absolute inset-0 h-full w-full object-contain"
                onLoad={() => {
                  const img = imageRef.current;
                  if (!img) return;
                  const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
                  const width = Math.min(1600, Math.max(960, img.naturalWidth));
                  setRenderQuality({
                    label: "Image source",
                    details: `${img.naturalWidth.toLocaleString()} x ${img.naturalHeight.toLocaleString()} uploaded image source.`,
                  });
                  onViewSizeChange({ width, height: Math.round(width / ratio) });
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-muted-foreground">
                Loading drawing...
              </div>
            )}

            {overlayPlanSet && overlaySheet && (
              <div
                className="pointer-events-none absolute inset-0"
                data-testid="plan-revision-overlay-layer"
                style={{
                  opacity: Math.min(0.9, Math.max(0.2, overlayOpacity / 100)),
                  mixBlendMode: overlayBlendMode,
                }}
              >
                <PlanSheetOverlayLayer
                  planSet={overlayPlanSet}
                  sheet={overlaySheet}
                  viewSize={viewSize}
                  zoom={zoom}
                />
              </div>
            )}

            {renderFailed && <PlanRenderRetryNotice onRetry={retryPlanRender} />}

            {evidenceFocus && (
              <div
                className="pointer-events-none absolute z-20 rounded-sm border-2 border-clay bg-clay/15 shadow-lg ring-2 ring-clay/30"
                style={{
                  left: `${evidenceFocus.x * 100}%`,
                  top: `${evidenceFocus.y * 100}%`,
                  width: `${evidenceFocus.width * 100}%`,
                  height: `${evidenceFocus.height * 100}%`,
                  minHeight: "10px",
                }}
                role="note"
                aria-label={`${evidenceFocus.sourceLine} evidence for ${evidenceFocus.label}`}
                data-testid="measurement-evidence-highlight"
              >
                <span className="absolute -top-6 left-0 whitespace-nowrap rounded-sm bg-foreground px-1.5 py-0.5 text-[10px] text-background shadow-sm">
                  {evidenceFocus.sourceLine} cited note
                </span>
              </div>
            )}

            <svg
              ref={svgRef}
              viewBox={viewBox}
              className={cn(
                "absolute inset-0 h-full w-full",
                spaceHeld || tool === "select"
                  ? isPanning
                    ? "cursor-grabbing"
                    : "cursor-grab"
                  : isZoomWindowMode
                    ? "cursor-zoom-in"
                    : "cursor-crosshair",
              )}
              data-testid="plan-canvas"
              onClick={handleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onPointerLeave={() => {
                setRunCursor(null);
                lastPointerRef.current = null;
              }}
              onDoubleClick={() => {
                if (
                  (tool === "linear" || tool === "area" || tool === "ruler") &&
                  pendingPoints.length > 0
                ) {
                  onFinishRun?.();
                }
              }}
              onContextMenu={(event) => {
                // Right-button gestures own the menu while a draw tool is
                // active: click finishes the run (decided on pointer up),
                // drag pans. Finishing happens there, not here — macOS fires
                // contextmenu at press time, before a drag can be told apart.
                if (suppressContextMenuRef.current) {
                  suppressContextMenuRef.current = false;
                  event.preventDefault();
                  return;
                }
                if (
                  (tool === "linear" || tool === "area" || tool === "count" || tool === "ruler") &&
                  pendingPoints.length > 0
                ) {
                  event.preventDefault();
                }
              }}
            >
              <rect
                x="0"
                y="0"
                width={viewSize.width}
                height={viewSize.height}
                fill="transparent"
              />
              {measurements.map((measurement) => (
                <MeasurementShape
                  key={measurement.id}
                  measurement={measurement}
                  viewSize={viewSize}
                  selected={measurement.id === selectedMeasurementId}
                  pointsOverride={
                    geometryPreview?.measurementId === measurement.id
                      ? geometryPreview.points
                      : null
                  }
                  editable={
                    tool === "select" &&
                    selectedMeasurement?.id === measurement.id &&
                    !isGeometrySaving
                  }
                  onSelect={onMeasurementSelect}
                  onPointDragStart={beginGeometryEdit}
                />
              ))}
              <DraftShape
                points={pendingPoints}
                viewSize={viewSize}
                color={tool === "ruler" ? RULER_COLOR : "#1b7a6e"}
                dashed
                closed={tool === "area"}
                scaleFeetPerPixel={sheet?.scale_feet_per_pixel ?? 0}
                unit={draftUnit}
                tool={tool}
                command={draftCommand}
              />
              <DraftShape
                points={calibrationPoints}
                viewSize={viewSize}
                color="#111827"
                dashed
                closed={false}
                scaleFeetPerPixel={0}
                unit="px"
                tool={tool === "calibrate" || tool === "verify" ? tool : "select"}
                command={tool === "calibrate" || tool === "verify" ? draftCommand : null}
              />
              {(tool === "linear" || tool === "area" || tool === "ruler") && runCursor && (
                <TakeoffRunPreview
                  pendingPoints={pendingPoints}
                  cursor={runCursor}
                  tool={tool}
                  viewSize={viewSize}
                  zoom={zoom}
                  scaleFeetPerPixel={sheet?.scale_feet_per_pixel ?? 0}
                  unit={draftUnit}
                />
              )}
              <AiGhostLayer
                ghosts={aiGhosts}
                activeGhostId={activeAiGhostId}
                viewSize={viewSize}
                onGhostSelect={onAiGhostSelect}
              />
              <ZoomWindowShape draft={zoomWindowDraft} viewSize={viewSize} />
            </svg>
            {finishPopover && finishPopoverAnchor && (
              <Popover open modal={false}>
                <PopoverAnchor asChild>
                  <span
                    className="pointer-events-none absolute h-px w-px"
                    style={{
                      left: `${finishPopoverAnchor.x * 100}%`,
                      top: `${finishPopoverAnchor.y * 100}%`,
                    }}
                    data-testid="takeoff-popover-anchor"
                  />
                </PopoverAnchor>
                <PopoverContent
                  side="right"
                  align="start"
                  sideOffset={12}
                  collisionPadding={12}
                  className="z-[80] w-auto rounded-none border-0 bg-transparent p-0 shadow-none"
                  onEscapeKeyDown={() => onFinishPopoverDismiss?.()}
                  onInteractOutside={() => onFinishPopoverDismiss?.()}
                  onOpenAutoFocus={(event) => event.preventDefault()}
                  data-testid="takeoff-popover-overlay"
                >
                  {finishPopover}
                </PopoverContent>
              </Popover>
            )}
          </div>
        </div>
        <PlanMiniMap
          viewSize={viewSize}
          measurements={measurements}
          viewportFrame={viewportFrame}
          onJump={jumpViewport}
          dock={miniMapDock}
          onDockChange={(dock) => {
            setMiniMapDock(dock);
            setMiniMapPosition(null);
          }}
          position={miniMapPosition}
          onPositionChange={setMiniMapPosition}
          collapsed={isMiniMapCollapsed}
          onCollapsedChange={setMiniMapCollapsedByUser}
        />
      </div>
    </div>
  );
}

function ZoomWindowShape({
  draft,
  viewSize,
}: {
  draft: ZoomWindowDraft | null;
  viewSize: ViewSize;
}) {
  if (!draft) return null;
  const minX = Math.min(draft.start.x, draft.end.x) * viewSize.width;
  const minY = Math.min(draft.start.y, draft.end.y) * viewSize.height;
  const width = Math.abs(draft.start.x - draft.end.x) * viewSize.width;
  const height = Math.abs(draft.start.y - draft.end.y) * viewSize.height;
  return (
    <g pointerEvents="none" data-testid="plan-zoom-window-draft">
      <rect
        x={minX}
        y={minY}
        width={width}
        height={height}
        fill="#1b7a6e18"
        stroke="#1b7a6e"
        strokeWidth="3"
        strokeDasharray="10 8"
      />
      <rect
        x={minX + 4}
        y={minY + 4}
        width={Math.max(0, width - 8)}
        height={Math.max(0, height - 8)}
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        strokeDasharray="10 8"
      />
    </g>
  );
}

// The only thing a failed drawing fetch is allowed to put on the canvas.
// Raw fetch errors carry the full signed storage URL and token — those never
// render. pointer-events-auto keeps the button clickable inside the
// revision overlay's pointer-events-none wrapper.
function PlanRenderRetryNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="absolute inset-x-8 top-8 z-10 flex justify-center">
      <button
        type="button"
        className="pointer-events-auto rounded-md border border-hairline bg-card px-4 py-2 text-sm font-medium shadow-lg transition hover:bg-surface"
        onClick={onRetry}
        data-testid="plan-render-retry"
      >
        This drawing needs to reload — click to retry
      </button>
    </div>
  );
}

function PlanSheetOverlayLayer({
  planSet,
  sheet,
  viewSize,
  zoom,
}: {
  planSet: PlanSetRow;
  sheet: PlanSheetRow;
  viewSize: ViewSize;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [signedUrl, setSignedUrl] = useState("");
  // Same expired-signed-URL story as the main canvas: refresh and retry once
  // automatically, then show only the contractor-language retry notice.
  const [renderFailed, setRenderFailed] = useState(false);
  const [signedUrlNonce, setSignedUrlNonce] = useState(0);
  const fetchAttemptRef = useRef(0);

  useEffect(() => {
    fetchAttemptRef.current = 0;
  }, [planSet.file_path, sheet.id]);

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderFailed(false);
    if (!planSet.file_path) return;
    if (isDirectPlanFileUrl(planSet.file_path)) {
      setSignedUrl(directPlanFileUrl(planSet.file_path));
      return;
    }
    supabase.storage
      .from(planRoomBucket)
      .createSignedUrl(planSet.file_path, 60 * 30)
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data?.signedUrl) {
          if (fetchAttemptRef.current < 1) {
            fetchAttemptRef.current += 1;
            setSignedUrlNonce((nonce) => nonce + 1);
          } else {
            setRenderFailed(true);
          }
          return;
        }
        setSignedUrl(data.signedUrl);
      });
    return () => {
      active = false;
    };
  }, [planSet.file_path, signedUrlNonce]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    const renderPdf = async () => {
      if (!signedUrl || planSet.file_mime_type !== "application/pdf" || !canvasRef.current) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        configurePdfWorker(pdfjs);
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet.page_number || 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(viewSize.width / viewport.width, viewSize.height / viewport.height);
        const cssScale = Math.max(0.1, scale);
        const renderScale = pdfRenderScaleFor(
          viewport,
          cssScale,
          zoom,
          PDF_INSPECTION_RENDER_MULTIPLIER,
        );
        const scaled = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(scaled.width);
        canvas.height = Math.round(scaled.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        canvas.dataset.pdfDetailMode = "inspection";
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: scaled,
        });
        await renderTask.promise;
        if (!cancelled) fetchAttemptRef.current = 0;
      } catch (error) {
        if (cancelled || isPdfRenderCancelled(error)) return;
        if (fetchAttemptRef.current < 1) {
          fetchAttemptRef.current += 1;
          setSignedUrlNonce((nonce) => nonce + 1);
        } else {
          setRenderFailed(true);
        }
      }
    };
    renderPdf();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [planSet.file_mime_type, sheet.page_number, signedUrl, viewSize.height, viewSize.width, zoom]);

  const retryOverlayRender = () => {
    fetchAttemptRef.current = 0;
    setRenderFailed(false);
    setSignedUrlNonce((nonce) => nonce + 1);
  };

  if (planSet.sample_key === "harbor-residence" || !planSet.file_path) {
    return <SamplePlanBackground sheet={sheet} viewSize={viewSize} overlay />;
  }

  if (planSet.file_mime_type === "application/pdf") {
    return (
      <>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-white" />
        {renderFailed && <PlanRenderRetryNotice onRetry={retryOverlayRender} />}
      </>
    );
  }

  if (signedUrl) {
    return (
      <img
        ref={imageRef}
        src={signedUrl}
        alt={`${sheet.sheet_name || "Revision sheet"} overlay`}
        className="absolute inset-0 h-full w-full object-contain"
      />
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-muted-foreground">
      Loading revision overlay...
    </div>
  );
}

function SamplePlanBackground({
  sheet,
  viewSize,
  overlay = false,
}: {
  sheet: PlanSheetRow | null;
  viewSize: ViewSize;
  overlay?: boolean;
}) {
  const title = `${sheet?.sheet_number || "A1.1"} ${sheet?.sheet_name || "Sample Plan"}`.trim();
  const patternId = overlay ? "plan-grid-overlay" : "plan-grid";
  const offset = overlay ? 18 : 0;
  const lineColor = overlay ? "#b35035" : "#28231d";
  return (
    <svg
      viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
      className={cn("absolute inset-0 h-full w-full", overlay ? "bg-transparent" : "bg-white")}
    >
      <defs>
        <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e8e2d7" strokeWidth="1" />
        </pattern>
      </defs>
      {!overlay && <rect width={viewSize.width} height={viewSize.height} fill="#fffefa" />}
      <rect width={viewSize.width} height={viewSize.height} fill={`url(#${patternId})`} />
      <rect
        x={viewSize.width * 0.14 + offset}
        y={viewSize.height * 0.18 + offset * 0.4}
        width={viewSize.width * 0.7}
        height={viewSize.height * 0.58}
        fill="none"
        stroke={lineColor}
        strokeWidth="3"
      />
      <rect
        x={viewSize.width * 0.2 + offset}
        y={viewSize.height * 0.3 + offset * 0.4}
        width={viewSize.width * 0.56}
        height={viewSize.height * 0.34}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
      />
      <line
        x1={viewSize.width * 0.48 + offset}
        y1={viewSize.height * 0.18 + offset * 0.4}
        x2={viewSize.width * 0.48 + offset}
        y2={viewSize.height * 0.76 + offset * 0.4}
        stroke={overlay ? "#b35035" : "#928779"}
        strokeDasharray="8 8"
        strokeWidth="1.5"
      />
      <line
        x1={viewSize.width * 0.14 + offset}
        y1={viewSize.height * 0.47 + offset * 0.4}
        x2={viewSize.width * 0.84 + offset}
        y2={viewSize.height * 0.47 + offset * 0.4}
        stroke={overlay ? "#b35035" : "#928779"}
        strokeDasharray="8 8"
        strokeWidth="1.5"
      />
      <text
        x="32"
        y="42"
        fill="#28231d"
        fontFamily="Inter, sans-serif"
        fontSize="18"
        fontWeight="700"
      >
        {title}
      </text>
      <text x="32" y="66" fill="#7d7469" fontFamily="Inter, sans-serif" fontSize="12">
        Sample drawing for Plan Room takeoff training
      </text>
      <rect
        x={viewSize.width - 260}
        y={viewSize.height - 92}
        width="220"
        height="58"
        fill="none"
        stroke="#28231d"
      />
      <text
        x={viewSize.width - 244}
        y={viewSize.height - 62}
        fill="#28231d"
        fontFamily="Inter, sans-serif"
        fontSize="12"
        fontWeight="700"
      >
        HARBOR RESIDENCE
      </text>
      <text
        x={viewSize.width - 244}
        y={viewSize.height - 42}
        fill="#7d7469"
        fontFamily="Inter, sans-serif"
        fontSize="11"
      >
        Overwatch sample plan sheet
      </text>
    </svg>
  );
}
