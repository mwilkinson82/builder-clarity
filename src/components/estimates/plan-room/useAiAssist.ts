// AI Assist orchestration (AITAKEOFF1 Tasks 1-3).
// Owns the panel/scan/review state machine on the client: exemplar pick,
// tile rendering, sequential per-sheet scanning through the server functions,
// and the accept/reject review that converts ghosts into ordinary count
// markers. Proposals are session-scoped on purpose — the ai_operations row is
// the durable record.

import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  beginAiCountScan,
  completeAiCountScan,
  failAiCountScan,
  recordAiGhostRejection,
  recordAiScanSheetSummary,
  scanSheetTileForAiCounts,
  verifyAiCountCandidate,
} from "@/lib/ai-takeoff/ai-takeoff.functions";
import { listPriorSheetRejections } from "@/lib/ai-takeoff/ai-scan-diagnostics.functions";
import {
  buildNegativeReferences,
  buildPositiveReferences,
  exemplarFromMeasurement,
  harvestPositivePoints,
  type AiExemplar,
} from "./aiReferenceHarvest";
import { useAiCredits } from "./useAiCredits";
import {
  appendAcceptedPoint,
  excludeNearExistingPoints,
  exemplarSheetGeometry,
  inkMaskFromBase64,
  negativeEligiblePoints,
  snapToInkCentroid,
  sortProposalsForReview,
  type GhostRejectionReason,
  VERIFIED_PROPOSAL_CONFIDENCE,
  VERIFY_WINDOW_PX,
  type AiCountCandidate,
  type AiCountProposal,
  type SheetPoint,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import {
  DEFAULT_TEMPLATE_MATCH_THRESHOLD,
  templateCropRect,
  unionProposalCandidates,
  type TemplateMatchCandidate,
  type TemplateTopScore,
} from "@/lib/ai-takeoff/template-match/template-match-domain";
import {
  createTemplateMatchSession,
  type TemplateMatchSession,
} from "@/lib/ai-takeoff/template-match/template-match-client";
import {
  DEFAULT_EMBEDDING_MATCH_THRESHOLD,
  selectEmbeddingMatches,
  topEmbeddingScores,
} from "@/lib/ai-takeoff/embedding-match/embedding-match-domain";
import { detectCandidatePeaks } from "@/lib/ai-takeoff/embedding-match/embedding-candidates-domain";
import { embedCropsForAiCounts } from "@/lib/ai-takeoff/ai-embed.functions";
import { planModelToVerify, planTemplateGhosts } from "@/lib/ai-takeoff/incremental-placement";
import { activeAiEngine } from "@/lib/ai-takeoff/embedding-match/ai-engine-flag";
import { DEFAULT_MAX_SHEETS_PER_SCAN, quoteScanCredits } from "@/lib/credits/credits-domain";
import {
  createTakeoffMeasurement,
  updateTakeoffMeasurement,
  planRoomBucket,
  type PlanSetRow,
  type PlanSheetRow,
  type TakeoffMeasurementRow,
} from "@/lib/plan-room.functions";
import {
  renderDetectionSheet,
  renderExemplarCrop,
  renderVerifyWindow,
  sliceDetectionTiles,
} from "./aiDetectionRender";
import { clamp01, tileLocalToSheetPoint } from "@/lib/ai-takeoff/coord-transforms";
import { geometryFromPoints, geometryPoints, type ViewSize } from "./planRoomShared";

export type AiAssistPhase = "idle" | "scanning" | "review";
export type { AiExemplar } from "./aiReferenceHarvest";
export type AiScanScope = "sheet" | "all";

// Fast first paint (AITAKEOFF13): the template ghosts render in ~12s, so the
// model tile/verify calls that follow are best-effort enrichment. A single
// vendor call must never hang the scan behind the results already on screen —
// bound each one and let the loop skip a straggler. 90s clears any healthy call
// (gpt-4o ~10s, Claude ~10s, OpenAI's own cap is 75s) while catching the
// >170s hangs that motivated this. After this many consecutive model failures
// the enrichment gives up for the rest of the scan instead of stalling.
const MODEL_CALL_TIMEOUT_MS = 90_000;
const MAX_CONSECUTIVE_MODEL_FAILURES = 3;

/** Race a model server-fn call against a timeout so a hung vendor can't stall. */
function withModelTimeout<T>(promise: Promise<T>, ms = MODEL_CALL_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("The model call timed out.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  }) as Promise<T>;
}

export interface AiScanProgress {
  sheetsDone: number;
  sheetsTotal: number;
  currentSheetLabel: string;
  /** Confirmed matches so far — stage-B verified, never coarse candidates. */
  found: number;
  /**
   * Stage-B progress (AITAKEOFF3): each coarse candidate gets double-checked
   * on a zoomed crop; null while stage A is still tiling the sheet.
   */
  verifying: { done: number; total: number } | null;
  /**
   * The teaching loop (AITAKEOFF5): how many harvested accepted matches and
   * rejections ride along as references for the current sheet.
   */
  references: { extraPositives: number; negatives: number } | null;
  /**
   * Echo check (AITAKEOFF2): the model's own one-line description of the
   * exemplar it received — "Looking for: circular brush with radial spokes".
   * A wrong echo exposes a corrupted crop instantly.
   */
  exemplarDescription: string;
}

export interface UseAiAssistArgs {
  estimateId: string;
  sheets: PlanSheetRow[];
  planSets: PlanSetRow[];
  measurements: TakeoffMeasurementRow[];
  currentSheetId: string | null;
  viewSize: ViewSize;
  openSheet: (sheetId: string) => void;
  onTakeoffsChanged: () => void;
}

export function useAiAssist({
  estimateId,
  sheets,
  planSets,
  measurements,
  currentSheetId,
  viewSize,
  openSheet,
  onTakeoffsChanged,
}: UseAiAssistArgs) {
  const beginScanFn = useServerFn(beginAiCountScan);
  const scanTileFn = useServerFn(scanSheetTileForAiCounts);
  const verifyCandidateFn = useServerFn(verifyAiCountCandidate);
  const priorRejectionsFn = useServerFn(listPriorSheetRejections);
  const completeScanFn = useServerFn(completeAiCountScan);
  const failScanFn = useServerFn(failAiCountScan);
  const recordSummaryFn = useServerFn(recordAiScanSheetSummary);
  const recordRejectionFn = useServerFn(recordAiGhostRejection);
  const createMeasurementFn = useServerFn(createTakeoffMeasurement);
  const updateMeasurementFn = useServerFn(updateTakeoffMeasurement);
  const embedCropsFn = useServerFn(embedCropsForAiCounts);

  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<AiAssistPhase>("idle");
  const [pickingExemplar, setPickingExemplar] = useState(false);
  const [exemplar, setExemplar] = useState<AiExemplar | null>(null);
  const [scope, setScope] = useState<AiScanScope>("sheet");
  const [scanProgress, setScanProgress] = useState<AiScanProgress | null>(null);
  const [scanError, setScanError] = useState("");
  const [proposals, setProposals] = useState<AiCountProposal[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [isAccepting, setIsAccepting] = useState(false);
  // Survives scan completion so the diagnostics view can open on it.
  const [lastOperationId, setLastOperationId] = useState<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const operationIdRef = useRef<string | null>(null);
  // AI measurement created per sheet during this review (id + points so far).
  const aiMeasurementsRef = useRef(new Map<string, { id: string; points: SheetPoint[] }>());
  // Rejections the user made this session, keyed by sheet + exemplar label.
  // Each carries the user's REASON (AITAKEOFF10 Task 0): only explicit
  // "wrong_symbol" verdicts may ever become stage-B negatives — placement
  // complaints are never identity evidence.
  const sessionRejectionsRef = useRef(
    new Map<string, Array<{ x: number; y: number; reason: GhostRejectionReason }>>(),
  );
  // Counts rejections recorded during review, per sheet, for the funnel.
  const rejectionTallyRef = useRef(new Map<string, { wrongSymbol: number; wrongSpot: number }>());

  const credits = useAiCredits(open);
  const { refreshCredits } = credits;

  const sheetById = useMemo(() => new Map(sheets.map((sheet) => [sheet.id, sheet])), [sheets]);
  const planSetById = useMemo(
    () => new Map(planSets.map((planSet) => [planSet.id, planSet])),
    [planSets],
  );

  const isSheetScannable = useCallback(
    (sheet: PlanSheetRow) => {
      const planSet = planSetById.get(sheet.plan_set_id);
      return Boolean(
        planSet &&
        planSet.file_mime_type === "application/pdf" &&
        planSet.file_path &&
        !planSet.sample_key &&
        planSet.status !== "superseded" &&
        planSet.status !== "archive",
      );
    },
    [planSetById],
  );

  const targetSheets = useMemo(() => {
    if (scope === "sheet") {
      const sheet = currentSheetId ? sheetById.get(currentSheetId) : null;
      return sheet && isSheetScannable(sheet) ? [sheet] : [];
    }
    return sheets.filter(isSheetScannable).slice(0, DEFAULT_MAX_SHEETS_PER_SCAN);
  }, [scope, sheets, sheetById, currentSheetId, isSheetScannable]);

  const quoteCredits = quoteScanCredits(targetSheets.length);

  // Existing count points per sheet: the model never re-proposes symbols the
  // estimator already counted.
  const existingCountPointsForSheet = useCallback(
    (sheetId: string): SheetPoint[] =>
      measurements
        .filter((m) => m.plan_sheet_id === sheetId && m.tool_type === "count")
        .flatMap((m) => geometryPoints(m.geometry)),
    [measurements],
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    // Re-arm the teaching flow each open, keeping any exemplar already picked.
    setScanError("");
  }, []);

  const closePanel = useCallback(() => {
    setOpen(false);
    setPickingExemplar(false);
  }, []);

  /** Canvas clicks flow through here while the panel is arming an exemplar. */
  const handleMeasurementSelected = useCallback(
    (measurement: TakeoffMeasurementRow) => {
      if (!open || !pickingExemplar) return false;
      const next = exemplarFromMeasurement(measurement);
      if (!next) {
        toast.error("Pick a count marker — linear and area takeoffs can't seed a count scan.");
        return true;
      }
      setExemplar(next);
      setPickingExemplar(false);
      toast.success(`Exemplar set: ${next.label || "count marker"}`);
      return true;
    },
    [open, pickingExemplar],
  );

  const endReview = useCallback(
    (options: { silent?: boolean } = {}) => {
      const accepted = proposals.filter((p) => p.status === "accepted").length;
      setPhase("idle");
      setProposals([]);
      setReviewIndex(0);
      aiMeasurementsRef.current = new Map();
      if (accepted > 0) {
        onTakeoffsChanged();
        if (!options.silent) {
          toast.success(
            `${accepted} AI-assisted count${accepted === 1 ? "" : "s"} added to the takeoff.`,
          );
        }
      }
    },
    [onTakeoffsChanged, proposals],
  );

  const runScan = useCallback(async () => {
    if (phase === "scanning") return;
    if (!exemplar) return;
    const exemplarSheet = sheetById.get(exemplar.sheetId);
    if (!exemplarSheet || !isSheetScannable(exemplarSheet)) {
      setScanError("The exemplar's sheet is no longer available to scan.");
      return;
    }
    if (targetSheets.length === 0) {
      setScanError("There is no PDF-backed sheet to scan here yet.");
      return;
    }

    setPhase("scanning");
    setScanError("");
    setProposals([]);
    aiMeasurementsRef.current = new Map();
    cancelRequestedRef.current = false;
    operationIdRef.current = null;
    // The template-match worker session (AITAKEOFF6): one per scan so the
    // opencv.js wasm compiles once; disposed in the finally below.
    let templateSession: TemplateMatchSession | null = null;
    // Embedding engine (AITAKEOFF12): the learned-identity alternative to the
    // pixel matcher, selected by VITE_AI_ENGINE (default "pixel"). One session
    // per scan. When on it replaces the pixel sweep — candidate crops are
    // embedded server-side (Replicate) and the hits ride the exact same
    // auto-ghost path, so there is no client worker to dispose here.
    const aiEngine = activeAiEngine();
    let echo = "";
    setScanProgress({
      sheetsDone: 0,
      sheetsTotal: targetSheets.length,
      currentSheetLabel: "",
      found: 0,
      verifying: null,
      references: null,
      exemplarDescription: "",
    });

    const signedUrlFor = async (planSetId: string) => {
      const planSet = planSetById.get(planSetId);
      if (!planSet?.file_path) throw new Error("This drawing set has no PDF file.");
      const { data, error } = await supabase.storage
        .from(planRoomBucket)
        .createSignedUrl(planSet.file_path, 60 * 10);
      if (error || !data?.signedUrl) {
        throw new Error("The drawing file could not be opened for scanning.");
      }
      return data.signedUrl;
    };

    try {
      const begin = await beginScanFn({
        data: {
          estimate_id: estimateId,
          sheet_ids: targetSheets.map((sheet) => sheet.id),
        },
      });
      operationIdRef.current = begin.operationId;
      setLastOperationId(begin.operationId);

      // Clean region render straight from the PDF around the marker — the
      // human's marker dot lives on the SVG overlay and can never leak in
      // (AITAKEOFF2 Task 0). ~4 sheet-inches square at ~640px.
      const exemplarSheetUrl = await signedUrlFor(exemplarSheet.plan_set_id);
      const exemplarImage = await renderExemplarCrop(
        exemplarSheetUrl,
        exemplarSheet.page_number,
        exemplar.point,
      );
      // The teaching loop (AITAKEOFF5 Task 1): other same-label markers on
      // the exemplar's sheet — accepted AI counts and hand-placed alike —
      // become additional positive references (capped at 3 total).
      const harvestPoints = harvestPositivePoints({
        measurements,
        exemplar: {
          measurementId: exemplar.measurementId,
          sheetId: exemplar.sheetId,
          label: exemplar.label,
          estimateLineItemId: exemplar.estimateLineItemId,
          libraryItemId: exemplar.libraryItemId,
          point: exemplar.point,
        },
      });
      const positives = await buildPositiveReferences({
        primary: exemplarImage,
        exemplarSheetSignedUrl: exemplarSheetUrl,
        exemplarSheetPageNumber: exemplarSheet.page_number,
        harvestPoints,
      });

      // Template engine prep (AITAKEOFF6 Task 1): the exemplar the user
      // picked IS a template. Crop it once from the exemplar sheet's
      // detection raster (footprint-sized, same scale matching runs at);
      // the worker unions its hits with stage A on every sheet.
      const proposalSource = begin.proposalSource ?? "both";
      // Templates (AITAKEOFF10 Task 3): the exemplar first, then every
      // harvested same-label positive (accepted marks incl. nudged ones) as
      // its own template with its own hub anchor — different symbol variants
      // get covered by their own accepted instances within one session.
      let templates: Array<{ image: ImageData; anchor: { x: number; y: number } }> = [];
      let exemplarRasterReuse: Awaited<ReturnType<typeof renderDetectionSheet>> | null = null;
      if (proposalSource !== "model" && exemplarImage.footprintPt !== null) {
        const exemplarRaster = await renderDetectionSheet(
          exemplarSheetUrl,
          exemplarSheet.page_number,
        );
        // Canonical derivation (AITAKEOFF7 Task 0) — the same helper every
        // dedupe/suppression consumer uses; nothing re-derives footprints.
        const exemplarGeometry = exemplarSheetGeometry({
          footprintPt: exemplarImage.footprintPt,
          pageLongEdgePt: Math.max(
            exemplarRaster.pageSize.widthPt,
            exemplarRaster.pageSize.heightPt,
          ),
          rasterWidthPx: exemplarRaster.widthPx,
          rasterHeightPx: exemplarRaster.heightPx,
        });
        const exemplarContext = exemplarRaster.canvas.getContext("2d");
        const templateFromPoint = (point: SheetPoint) => {
          const markerPx = {
            x: point.x * exemplarRaster.widthPx,
            y: point.y * exemplarRaster.heightPx,
          };
          const rect = templateCropRect(
            markerPx,
            exemplarGeometry.footprintRasterPx ?? 0,
            exemplarRaster.widthPx,
            exemplarRaster.heightPx,
          );
          const image = exemplarContext?.getImageData(rect.left, rect.top, rect.width, rect.height);
          if (!image) return null;
          return {
            image,
            anchor: {
              x: markerPx.x - (rect.left + rect.width / 2),
              y: markerPx.y - (rect.top + rect.height / 2),
            },
          };
        };
        const primaryTemplate = templateFromPoint(exemplar.point);
        templates = primaryTemplate
          ? [
              primaryTemplate,
              ...harvestPoints
                .map((point) => templateFromPoint(point))
                .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
            ]
          : [];
        exemplarRasterReuse = exemplarRaster;
        if (templates.length > 0) {
          // Embedding mode embeds candidate crops server-side (Replicate) and
          // needs no client worker; only the pixel engine spins one up.
          if (aiEngine !== "embedding") templateSession = createTemplateMatchSession();
        }
      }
      if (proposalSource === "template" && !templateSession) {
        throw new Error(
          "Template matching needs a measurable symbol under the exemplar marker. Pick a marker centered on the symbol, or unset AI_PROPOSAL_SOURCE.",
        );
      }

      const found: AiCountProposal[] = [];
      // Paint whatever the scan has found so far onto the canvas mid-scan.
      // Safe to replace the whole list because ghostsForSheet renders during
      // "scanning" but the accept/reject bar only appears in "review", so the
      // estimator can't be editing these while the scan is still appending.
      const publishFound = () => setProposals(sortProposalsForReview(found.slice()));
      // A model call somewhere failed/timed out (best-effort stage). Only
      // matters if the scan ends up delivering nothing — then it earns a refund
      // instead of charging for an empty result.
      let sawModelFailure = false;
      let sheetsDone = 0;
      for (const sheet of targetSheets) {
        if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
        const sheetLabel = `${sheet.sheet_number || `Page ${sheet.page_number}`}`.trim();
        setScanProgress({
          sheetsDone,
          sheetsTotal: targetSheets.length,
          currentSheetLabel: sheetLabel,
          found: found.length,
          verifying: null,
          references: null,
          exemplarDescription: echo,
        });

        // The exemplar's own sheet was already rendered for the template
        // crop — render every other sheet fresh.
        const raster =
          exemplarRasterReuse && sheet.id === exemplar.sheetId
            ? exemplarRasterReuse
            : await renderDetectionSheet(await signedUrlFor(sheet.plan_set_id), sheet.page_number);
        // Exemplar-derived geometry (AITAKEOFF5 Task 0, canonical since
        // AITAKEOFF7): ONE derivation of footprint, tile overlap, and the
        // floored+capped per-axis dedupe/suppression radius for this sheet.
        // The A-100 collapse came from re-derived, uncapped radii — every
        // consumer below takes THESE values.
        const geometry = exemplarSheetGeometry({
          footprintPt: exemplarImage.footprintPt,
          pageLongEdgePt: Math.max(raster.pageSize.widthPt, raster.pageSize.heightPt),
          rasterWidthPx: raster.widthPx,
          rasterHeightPx: raster.heightPx,
        });
        // Template-only scans never slice tiles — stage A is skipped whole.
        const tiles =
          proposalSource === "template" ? [] : sliceDetectionTiles(raster, geometry.tileOverlapPx);
        const existingPoints = existingCountPointsForSheet(sheet.id);
        // Negative references (AITAKEOFF5 Task 1): this session's rejections
        // for this sheet + exemplar first; otherwise the previous scan's
        // stage-B rejections (from diagnostics). Never manufactured.
        const rejectionKey = `${sheet.id}|${exemplar.label.trim().toLowerCase()}`;
        // Only explicit identity rejections feed negatives (AITAKEOFF10):
        // the prior-scan source applies the same rule server-side.
        let rejectedPoints = negativeEligiblePoints(
          sessionRejectionsRef.current.get(rejectionKey) ?? [],
        );
        if (rejectedPoints.length === 0) {
          try {
            const prior = await priorRejectionsFn({
              data: {
                estimate_id: estimateId,
                sheet_id: sheet.id,
                exemplar_label: exemplar.label,
              },
            });
            rejectedPoints = prior.points;
          } catch {
            rejectedPoints = [];
          }
        }
        const negatives = buildNegativeReferences(raster, rejectedPoints);
        const references = { label: exemplar.label, positives, negatives };
        const progressReferences = {
          extraPositives: positives.length - 1,
          negatives: negatives.length,
        };
        // Template engine (AITAKEOFF6 Task 1): NCC of the exemplar template
        // against the WHOLE raster in the worker — deterministic, seam-free
        // proposals. In "both" mode a matcher failure degrades to the model
        // engine alone — but never silently anymore (AITAKEOFF7): the
        // per-sheet summary records engine status, error, and timing.
        let templateHits: TemplateMatchCandidate[] = [];
        let templateSweeps: number | null = null;
        let templateEngine: "ok" | "failed" | "skipped" = "skipped";
        let templateError = "";
        let templateElapsedMs: number | null = null;
        // Score transparency (AITAKEOFF8 Task 1): the sweep's best scores,
        // the threshold it applied, and whether the masked metric ran — a
        // zero-hit sheet must explain itself in the funnel.
        let templateTopScores: TemplateTopScore[] = [];
        let templateMasked: boolean | null = null;
        let templateMaskCoverage: number | null = null;
        let templateThreshold: number | null = null;
        if (
          aiEngine === "embedding" &&
          templates.length > 0 &&
          geometry.footprintRasterPx !== null
        ) {
          // Server embedding engine (AITAKEOFF12): propose candidate crops from
          // ink-density peaks on the client (cheap), embed exemplar + candidates
          // on Replicate's GPUs (uniform speed, any device), score by cosine, and
          // select client-side with the sheet geometry. Learned-identity hits ride
          // the shared template-hit path so they auto-ghost like pixel hits.
          try {
            const footprintPx = geometry.footprintRasterPx;
            const rasterCtx = raster.canvas.getContext("2d");
            const rasterPixels = rasterCtx?.getImageData(0, 0, raster.widthPx, raster.heightPx);
            if (!rasterCtx || !rasterPixels) {
              throw new Error("The sheet could not be read for matching.");
            }
            // Grayscale for the density proposer (luma-ish average is enough).
            const rgba = rasterPixels.data;
            const gray = new Uint8Array(raster.widthPx * raster.heightPx);
            for (let p = 0; p < gray.length; p += 1) {
              gray[p] = (rgba[p * 4] + rgba[p * 4 + 1] + rgba[p * 4 + 2]) / 3;
            }
            const peaks = detectCandidatePeaks(gray, raster.widthPx, raster.heightPx, footprintPx);

            // Crop each peak to a footprint box on a white ground (edge crops
            // stay opaque). One reused canvas keeps allocation flat.
            const cropSide = Math.max(24, Math.round(footprintPx * 1.4));
            const cropHalf = Math.round(cropSide / 2);
            const cropCanvas = document.createElement("canvas");
            cropCanvas.width = cropSide;
            cropCanvas.height = cropSide;
            const cropCtx = cropCanvas.getContext("2d");
            if (!cropCtx) throw new Error("The sheet could not be cropped for matching.");
            const toCropBase64 = (cx: number, cy: number): string => {
              cropCtx.fillStyle = "#ffffff";
              cropCtx.fillRect(0, 0, cropSide, cropSide);
              cropCtx.drawImage(
                raster.canvas,
                cx - cropHalf,
                cy - cropHalf,
                cropSide,
                cropSide,
                0,
                0,
                cropSide,
                cropSide,
              );
              return cropCanvas.toDataURL("image/png").split(",")[1] ?? "";
            };
            const candidates = peaks.map((peak) => ({
              // Normalized [0,1] sheet-space center so cosine selection dedupes
              // in the same space the pixel engine uses (geometry.radius).
              x: peak.x / raster.widthPx,
              y: peak.y / raster.heightPx,
              scale: 1,
              base64: toCropBase64(peak.x, peak.y),
              mediaType: "image/png",
            }));

            // Exemplar crop → base64 PNG.
            const exemplarCanvas = document.createElement("canvas");
            exemplarCanvas.width = templates[0].image.width;
            exemplarCanvas.height = templates[0].image.height;
            exemplarCanvas.getContext("2d")?.putImageData(templates[0].image, 0, 0);
            const exemplarBase64 = exemplarCanvas.toDataURL("image/png").split(",")[1] ?? "";

            const embedResult = await embedCropsFn({
              data: {
                exemplar: { base64: exemplarBase64, mediaType: "image/png" },
                candidates,
              },
            });
            const scored = embedResult.scored;
            const matched = selectEmbeddingMatches(
              scored,
              DEFAULT_EMBEDDING_MATCH_THRESHOLD,
              geometry.radius,
            );
            templateHits = matched.map((candidate) => ({
              x: candidate.x,
              y: candidate.y,
              score: candidate.score,
              rotationDeg: 0,
              scale: candidate.scale,
              templateIndex: 0,
            }));
            templateEngine = "ok";
            templateElapsedMs = embedResult.elapsedMs ?? null;
            templateSweeps = candidates.length;
            templateTopScores = topEmbeddingScores(scored).map((top) => ({
              x: top.x,
              y: top.y,
              score: top.score,
              rotationDeg: 0,
              scale: top.scale,
              templateIndex: 0,
            }));
            templateThreshold = DEFAULT_EMBEDDING_MATCH_THRESHOLD;
          } catch (error) {
            if (proposalSource === "template") throw error;
            templateEngine = "failed";
            templateError = error instanceof Error ? error.message : "The symbol matcher failed.";
            templateHits = [];
          }
        } else if (templateSession && templates.length > 0 && geometry.footprintRasterPx !== null) {
          try {
            const rasterPixels = raster.canvas
              .getContext("2d")
              ?.getImageData(0, 0, raster.widthPx, raster.heightPx);
            if (!rasterPixels) throw new Error("The sheet could not be read for matching.");
            const matched = await templateSession.match({
              raster: rasterPixels,
              templates,
              options: {
                threshold: begin.templateMatchThreshold ?? DEFAULT_TEMPLATE_MATCH_THRESHOLD,
                footprintPx: geometry.footprintRasterPx,
                radius: geometry.radius,
              },
            });
            templateHits = matched.candidates;
            templateEngine = "ok";
            templateElapsedMs = matched.elapsedMs;
            templateSweeps = matched.sweepCount;
            templateTopScores = matched.topScores;
            templateMasked = matched.maskedMatching;
            templateMaskCoverage = matched.maskCoverage;
            templateThreshold = matched.appliedThreshold;
          } catch (error) {
            if (proposalSource === "template") throw error;
            templateEngine = "failed";
            templateError = error instanceof Error ? error.message : "The symbol matcher failed.";
            templateHits = [];
          }
        }
        if (cancelRequestedRef.current) throw new Error("Scan cancelled.");

        let sheetVerified = 0;
        let sheetCenterMismatch = 0;
        let sheetTemplateGhosts = 0;

        // Fast first paint (AITAKEOFF13): a template hit is a deterministic
        // same-shape match with a hub-anchored center (AITAKEOFF9) that becomes
        // a review ghost DIRECTLY (AITAKEOFF11) — no model call, no verify cost.
        // Place these BEFORE the model tile-scan below so the estimator sees
        // results in ~12s instead of after ~20 sequential model calls (2-3 min).
        // A free client-side ink-centroid snap centers each ghost on the actual
        // symbol. The model stage that follows only enriches around what is now
        // already on the canvas.
        const templateGhosts = planTemplateGhosts({
          templateHits,
          existingPoints,
          radius: geometry.radius,
          maxPerSheet: begin.maxProposalsPerSheet,
        });
        const placedGhostPoints: SheetPoint[] = [];
        for (const candidate of templateGhosts) {
          if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
          const window = renderVerifyWindow(raster, candidate, { upscale: false });
          const mask = inkMaskFromBase64(
            window.inkMaskBase64,
            window.rect.width,
            window.rect.height,
          );
          const candidateInWindow = {
            x: candidate.x * raster.widthPx - window.rect.left,
            y: candidate.y * raster.heightPx - window.rect.top,
          };
          const snapped = mask ? snapToInkCentroid(mask, candidateInWindow) : null;
          const point = snapped
            ? tileLocalToSheetPoint(window.frame, snapped.x, snapped.y)
            : { x: candidate.x, y: candidate.y };
          sheetTemplateGhosts += 1;
          placedGhostPoints.push({ x: point.x, y: point.y });
          found.push({
            id: crypto.randomUUID(),
            sheetId: sheet.id,
            x: point.x,
            y: point.y,
            confidence: VERIFIED_PROPOSAL_CONFIDENCE,
            status: "pending",
          });
        }
        // Paint the template ghosts NOW — they render during "scanning" too, so
        // the estimator can look at real results while the model keeps searching.
        if (sheetTemplateGhosts > 0) publishFound();
        setScanProgress({
          sheetsDone,
          sheetsTotal: targetSheets.length,
          currentSheetLabel: sheetLabel,
          found: found.length,
          verifying: null,
          references: progressReferences,
          exemplarDescription: echo,
        });

        // Model enrichment (best-effort). Stage A tiles + stage B verify run
        // AFTER the ghosts are on screen. Each call is bounded and non-fatal: a
        // hang or error skips that call, and after a short streak of failures
        // the enrichment gives up for the rest of the scan — the template
        // ghosts the estimator already has are never thrown away.
        let consecutiveModelFailures = 0;

        // Stage A (AITAKEOFF3 Task 1): coarse, recall-biased candidates in
        // sheet space. Leads only — nothing here becomes a ghost. Skipped
        // entirely when the template engine is the sole proposal source.
        const sheetCoarse: AiCountCandidate[] = [];

        for (let index = 0; index < tiles.length; index += 1) {
          if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
          const tile = tiles[index];
          try {
            const result = await withModelTimeout(
              scanTileFn({
                data: {
                  operation_id: begin.operationId,
                  sheet_id: sheet.id,
                  sheet_width_px: raster.widthPx,
                  sheet_height_px: raster.heightPx,
                  references,
                  tile: {
                    index: tile.rect.index,
                    left: tile.rect.left,
                    top: tile.rect.top,
                    width: tile.rect.width,
                    height: tile.rect.height,
                    frame: tile.frame,
                    media_type: tile.mediaType,
                    base64: tile.base64,
                  },
                  is_last_tile_of_sheet: index === tiles.length - 1,
                  existing_points: existingPoints,
                  dedupe_radius: { x: geometry.radius.x, y: geometry.radius.y },
                },
              }),
            );
            consecutiveModelFailures = 0;
            if (!echo && result.exemplarDescription) {
              echo = result.exemplarDescription;
            }
            sheetCoarse.push(...result.candidates);
            setScanProgress({
              sheetsDone,
              sheetsTotal: targetSheets.length,
              currentSheetLabel: sheetLabel,
              found: found.length,
              verifying: null,
              references: progressReferences,
              exemplarDescription: echo,
            });
          } catch (tileError) {
            if (cancelRequestedRef.current) throw tileError;
            // Non-fatal: skip this tile. After a streak of failures, stop the
            // model stage — the template ghosts already on screen carry it.
            sawModelFailure = true;
            consecutiveModelFailures += 1;
            if (consecutiveModelFailures >= MAX_CONSECUTIVE_MODEL_FAILURES) break;
          }
        }

        // Stage B (AITAKEOFF3 Task 2, union in AITAKEOFF6): the funnel still
        // reports the combined dedupe/suppression counts so diagnostics read
        // exactly as before. Placement is split now (AITAKEOFF13): the template
        // ghosts were already painted above, so only MODEL candidates that
        // DON'T land on one of them still buy a stage-B verify — a symbol both
        // engines found is still verified at most once, same radius as the
        // union guaranteed before.
        const unioned = unionProposalCandidates(templateHits, sheetCoarse, geometry.radius);
        const fresh = excludeNearExistingPoints(
          unioned,
          existingPoints,
          geometry.radius,
          // excludeNearExistingPoints filters without mapping, so the union
          // entries' engine metadata survives the narrower parameter type.
        ) as typeof unioned;
        const modelToVerify = planModelToVerify({
          modelCandidates: sheetCoarse,
          placedGhostPoints,
          existingPoints,
          radius: geometry.radius,
          maxPerSheet: begin.maxProposalsPerSheet,
          templateGhostCount: sheetTemplateGhosts,
        });

        for (let index = 0; index < modelToVerify.length; index += 1) {
          if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
          setScanProgress({
            sheetsDone,
            sheetsTotal: targetSheets.length,
            currentSheetLabel: sheetLabel,
            found: found.length,
            verifying: { done: index, total: modelToVerify.length },
            references: progressReferences,
            exemplarDescription: echo,
          });
          const candidate = modelToVerify[index];
          const window = renderVerifyWindow(raster, candidate);
          try {
            const verdict = await withModelTimeout(
              verifyCandidateFn({
                data: {
                  operation_id: begin.operationId,
                  sheet_id: sheet.id,
                  candidate_index: index,
                  candidate: { x: candidate.x, y: candidate.y },
                  // Only MODEL candidates reach stage B now (AITAKEOFF11):
                  // template hits ghosted directly above.
                  candidate_origin: {
                    source: "model" as const,
                    score: null,
                    rotation_deg: null,
                    scale: null,
                    template_index: null,
                  },
                  references,
                  window: {
                    left: window.rect.left,
                    top: window.rect.top,
                    width: window.rect.width,
                    height: window.rect.height,
                    frame: window.frame,
                    media_type: window.mediaType,
                    base64: window.base64,
                    ink_mask_base64: window.inkMaskBase64,
                  },
                },
              }),
            );
            consecutiveModelFailures = 0;
            // Verify-center sanity band (AITAKEOFF9 Task 3): a stage-B center
            // more than half a footprint from the candidate means the crop
            // caught a NEIGHBOR — accepting it would silently relocate a
            // marker. Rejected and counted in the funnel.
            const mismatchLimitPx = (geometry.footprintRasterPx ?? VERIFY_WINDOW_PX) / 2;
            const centerMismatch =
              verdict.match && verdict.point
                ? Math.hypot(
                    (verdict.point.x - candidate.x) * raster.widthPx,
                    (verdict.point.y - candidate.y) * raster.heightPx,
                  ) > mismatchLimitPx
                : false;
            if (centerMismatch) {
              sheetCenterMismatch += 1;
            } else if (verdict.match && verdict.point) {
              sheetVerified += 1;
              found.push({
                id: crypto.randomUUID(),
                sheetId: sheet.id,
                x: verdict.point.x,
                y: verdict.point.y,
                confidence: verdict.confidence,
                status: "pending",
              });
              // A bonus find — drop it onto the canvas alongside the ghosts
              // already there instead of waiting for the whole scan to end.
              publishFound();
            }
          } catch (verifyError) {
            if (cancelRequestedRef.current) throw verifyError;
            // Non-fatal: a failed verify just doesn't add this bonus candidate.
            sawModelFailure = true;
            consecutiveModelFailures += 1;
            if (consecutiveModelFailures >= MAX_CONSECUTIVE_MODEL_FAILURES) break;
          }
          setScanProgress({
            sheetsDone,
            sheetsTotal: targetSheets.length,
            currentSheetLabel: sheetLabel,
            found: found.length,
            verifying: { done: index + 1, total: modelToVerify.length },
            references: progressReferences,
            exemplarDescription: echo,
          });
        }
        // Per-sheet funnel summary (AITAKEOFF7 Task 4): the "N proposed → M
        // after dedupe → K after suppression" record that makes a candidate
        // collapse visible in diagnostics — plus footprint/radius values and
        // template-engine status. Best-effort; in template-only mode this is
        // also what advances sheets_completed for honest failure refunds.
        try {
          await recordSummaryFn({
            data: {
              operation_id: begin.operationId,
              sheet_id: sheet.id,
              summary: {
                proposed_template: templateHits.length,
                proposed_model: sheetCoarse.length,
                after_union_dedupe: unioned.length,
                after_suppression: fresh.length,
                sent_to_verify: modelToVerify.length,
                verified: sheetVerified + sheetTemplateGhosts,
                template_autoghosted: sheetTemplateGhosts,
                center_mismatch_rejected: sheetCenterMismatch,
                stage_a_tiles: tiles.length,
                footprint_raster_px: geometry.footprintRasterPx,
                radius: { x: geometry.radius.x, y: geometry.radius.y },
                template_engine: templateEngine,
                template_error: templateError.slice(0, 500),
                template_elapsed_ms: templateElapsedMs,
                // Score transparency (AITAKEOFF8 Task 1): zero hits must
                // read as "top 0.41 vs threshold 0.78", never as a mystery.
                template_threshold: templateThreshold,
                template_sweeps: templateSweeps,
                template_count: templates.length,
                template_masked: templateMasked,
                template_mask_coverage: templateMaskCoverage,
                template_top_scores: templateTopScores.map((top) => ({
                  x: top.x,
                  y: top.y,
                  score: Math.min(1, top.score),
                  rotation_deg: top.rotationDeg,
                  scale: top.scale,
                })),
              },
            },
          });
        } catch {
          // Diagnostics only — a summary failure never fails the scan.
        }
        sheetsDone += 1;
      }

      // The template engine already renders instantly and the model stage is
      // best-effort — but if the WHOLE scan delivered nothing AND the reason
      // was a model-service failure (not simply an empty sheet), fail the
      // operation so the credit is refunded rather than charging for nothing.
      if (found.length === 0 && sawModelFailure) {
        throw new Error(
          "The AI search couldn't reach the model service, so nothing was found. Your credits were refunded — please try again in a moment.",
        );
      }

      await completeScanFn({ data: { operation_id: begin.operationId } });
      operationIdRef.current = null;
      refreshCredits();

      const ordered = sortProposalsForReview(found);
      setProposals(ordered);
      setReviewIndex(0);
      setScanProgress(null);
      if (ordered.length === 0) {
        setPhase("idle");
        toast.info("The scan finished but found no new matches on the scanned sheets.");
        return;
      }
      setPhase("review");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The AI scan failed.";
      // Server-side failures already refunded; only an operation this client
      // opened and abandoned locally still needs the cancel + refund call.
      if (operationIdRef.current) {
        try {
          await failScanFn({
            data: { operation_id: operationIdRef.current, reason: message.slice(0, 400) },
          });
        } catch {
          // Already failed server-side (and refunded) — nothing left to do.
        }
        operationIdRef.current = null;
      }
      refreshCredits();
      setScanProgress(null);
      setPhase("idle");
      setScanError(message);
    } finally {
      // The worker (and its wasm heap) never outlives the scan.
      templateSession?.dispose();
    }
  }, [
    beginScanFn,
    completeScanFn,
    embedCropsFn,
    estimateId,
    exemplar,
    existingCountPointsForSheet,
    failScanFn,
    isSheetScannable,
    phase,
    planSetById,
    measurements,
    priorRejectionsFn,
    refreshCredits,
    recordSummaryFn,
    scanTileFn,
    sheetById,
    targetSheets,
    verifyCandidateFn,
  ]);

  const cancelScan = useCallback(() => {
    cancelRequestedRef.current = true;
  }, []);

  const pendingProposals = useMemo(
    () => proposals.filter((p) => p.status === "pending"),
    [proposals],
  );
  const acceptedCount = useMemo(
    () => proposals.filter((p) => p.status === "accepted").length,
    [proposals],
  );
  const activeProposal =
    phase === "review"
      ? proposals[reviewIndex]?.status === "pending"
        ? proposals[reviewIndex]
        : (pendingProposals[0] ?? null)
      : null;

  // The review always shows the symbol it is asking about: switch sheets when
  // the active proposal lives on another one.
  useEffect(() => {
    if (!activeProposal) return;
    if (activeProposal.sheetId !== currentSheetId) openSheet(activeProposal.sheetId);
  }, [activeProposal, currentSheetId, openSheet]);

  const advanceToNextPending = useCallback((fromIndex: number, updated: AiCountProposal[]) => {
    const after = updated.findIndex((p, i) => i > fromIndex && p.status === "pending");
    if (after >= 0) {
      setReviewIndex(after);
      return true;
    }
    const before = updated.findIndex((p) => p.status === "pending");
    if (before >= 0) {
      setReviewIndex(before);
      return true;
    }
    return false;
  }, []);

  /** Accept proposals into the per-sheet AI count measurement. */
  const persistAccepted = useCallback(
    async (accepted: AiCountProposal[]) => {
      const bySheet = new Map<string, AiCountProposal[]>();
      for (const proposal of accepted) {
        const list = bySheet.get(proposal.sheetId) ?? [];
        list.push(proposal);
        bySheet.set(proposal.sheetId, list);
      }
      for (const [sheetId, sheetProposals] of bySheet) {
        const existing = aiMeasurementsRef.current.get(sheetId);
        if (!existing) {
          let points: SheetPoint[] = [];
          for (const proposal of sheetProposals) {
            points = appendAcceptedPoint(points, proposal).points;
          }
          const sheet = sheetById.get(sheetId);
          const sheetTag = sheet?.sheet_number || `page ${sheet?.page_number ?? "?"}`;
          const result = await createMeasurementFn({
            data: {
              estimate_id: estimateId,
              plan_sheet_id: sheetId,
              estimate_line_item_id: exemplar?.estimateLineItemId ?? null,
              library_item_id: exemplar?.libraryItemId ?? null,
              tool_type: "count",
              label: exemplar?.label || "AI-assisted count",
              unit: exemplar?.unit || "EA",
              quantity: points.length,
              waste_pct: exemplar?.wastePct ?? 0,
              color: exemplar?.color || "#d97706",
              geometry: geometryFromPoints(points, viewSize),
              notes: `AI-assisted count — sheet ${sheetTag}. Every point was reviewed and accepted by hand.`,
              created_by_ai: true,
            },
          });
          aiMeasurementsRef.current.set(sheetId, {
            id: result.measurement.id,
            points,
          });
        } else {
          let points = existing.points;
          for (const proposal of sheetProposals) {
            points = appendAcceptedPoint(points, proposal).points;
          }
          await updateMeasurementFn({
            data: {
              id: existing.id,
              patch: {
                geometry: geometryFromPoints(points, viewSize),
                quantity: points.length,
              },
            },
          });
          aiMeasurementsRef.current.set(sheetId, { id: existing.id, points });
        }
      }
    },
    [createMeasurementFn, estimateId, exemplar, sheetById, updateMeasurementFn, viewSize],
  );

  // endReview closes over `proposals`; reviews that decide the final item via
  // accept/reject already hold the updated array, so finish from that copy.
  const endReviewWithProposals = useCallback(
    (finalProposals: AiCountProposal[]) => {
      const accepted = finalProposals.filter((p) => p.status === "accepted").length;
      setPhase("idle");
      setProposals([]);
      setReviewIndex(0);
      aiMeasurementsRef.current = new Map();
      if (accepted > 0) {
        onTakeoffsChanged();
        toast.success(
          `${accepted} AI-assisted count${accepted === 1 ? "" : "s"} added to the takeoff.`,
        );
      } else {
        toast.info("Review finished — no proposals were accepted.");
      }
    },
    [onTakeoffsChanged],
  );

  const acceptActiveProposal = useCallback(async () => {
    if (!activeProposal || isAccepting) return;
    setIsAccepting(true);
    try {
      await persistAccepted([activeProposal]);
      const index = proposals.findIndex((p) => p.id === activeProposal.id);
      const updated = proposals.map((p) =>
        p.id === activeProposal.id ? { ...p, status: "accepted" as const } : p,
      );
      setProposals(updated);
      if (!advanceToNextPending(index, updated)) {
        // Last one reviewed: finish up.
        setTimeout(() => endReviewWithProposals(updated), 0);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That count did not save.");
    } finally {
      setIsAccepting(false);
    }
  }, [
    activeProposal,
    advanceToNextPending,
    endReviewWithProposals,
    isAccepting,
    persistAccepted,
    proposals,
  ]);

  /**
   * Reject the active ghost with an explicit REASON (AITAKEOFF10 Task 1).
   * "wrong_spot" is the default single-click semantic — a mistaken
   * positive-suppression costs less than a poisoned negative. Only
   * "wrong_symbol" teaches the next scan what NOT to find. This handler is
   * the ONLY code path that ever creates a rejection record; every cleanup
   * path (cancel, supersede, navigation) discards ghosts verdict-free.
   */
  const rejectActiveProposal = useCallback(
    (reason: GhostRejectionReason = "wrong_spot") => {
      if (!activeProposal || isAccepting) return;
      if (exemplar) {
        const key = `${activeProposal.sheetId}|${exemplar.label.trim().toLowerCase()}`;
        const rejected = sessionRejectionsRef.current.get(key) ?? [];
        rejected.unshift({ x: activeProposal.x, y: activeProposal.y, reason });
        sessionRejectionsRef.current.set(key, rejected.slice(0, 10));
        const tally = rejectionTallyRef.current.get(activeProposal.sheetId) ?? {
          wrongSymbol: 0,
          wrongSpot: 0,
        };
        if (reason === "wrong_symbol") tally.wrongSymbol += 1;
        else tally.wrongSpot += 1;
        rejectionTallyRef.current.set(activeProposal.sheetId, tally);
        // Durable record for the next scan's negative harvest + the funnel's
        // placement metric. Best-effort — review never blocks on it.
        if (lastOperationId) {
          const rejectionIndex = tally.wrongSymbol + tally.wrongSpot - 1;
          void recordRejectionFn({
            data: {
              operation_id: lastOperationId,
              sheet_id: activeProposal.sheetId,
              index: rejectionIndex,
              point: { x: activeProposal.x, y: activeProposal.y },
              reason,
              exemplar_label: exemplar.label,
            },
          }).catch(() => undefined);
        }
      }
      const index = proposals.findIndex((p) => p.id === activeProposal.id);
      const updated = proposals.map((p) =>
        p.id === activeProposal.id ? { ...p, status: "rejected" as const } : p,
      );
      setProposals(updated);
      if (!advanceToNextPending(index, updated)) {
        setTimeout(() => endReviewWithProposals(updated), 0);
      }
    },
    [
      activeProposal,
      advanceToNextPending,
      endReviewWithProposals,
      exemplar,
      isAccepting,
      lastOperationId,
      proposals,
      recordRejectionFn,
    ],
  );

  /**
   * Nudge the active ghost onto the hub before accepting (AITAKEOFF10
   * Task 2). The corrected point is what persists to the measurement AND
   * what the next scan harvests as a positive template with its own anchor
   * — placement imperfection stops zeroing the positive set.
   */
  const nudgeActiveProposal = useCallback(
    (dx: number, dy: number) => {
      if (!activeProposal || isAccepting) return;
      setProposals((current) =>
        current.map((p) =>
          p.id === activeProposal.id ? { ...p, x: clamp01(p.x + dx), y: clamp01(p.y + dy) } : p,
        ),
      );
    },
    [activeProposal, isAccepting],
  );

  /** "Accept all remaining" — deliberately behind the per-item flow. */
  const acceptAllRemaining = useCallback(async () => {
    if (isAccepting || pendingProposals.length === 0) return;
    setIsAccepting(true);
    try {
      await persistAccepted(pendingProposals);
      const updated = proposals.map((p) =>
        p.status === "pending" ? { ...p, status: "accepted" as const } : p,
      );
      setProposals(updated);
      setTimeout(() => endReviewWithProposals(updated), 0);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The remaining counts did not save.");
    } finally {
      setIsAccepting(false);
    }
  }, [endReviewWithProposals, isAccepting, pendingProposals, persistAccepted, proposals]);

  const navigateReview = useCallback(
    (direction: 1 | -1) => {
      if (pendingProposals.length === 0) return;
      const currentPendingIndex = activeProposal
        ? pendingProposals.findIndex((p) => p.id === activeProposal.id)
        : 0;
      const nextPendingIndex = Math.min(
        pendingProposals.length - 1,
        Math.max(0, currentPendingIndex + direction),
      );
      const target = pendingProposals[nextPendingIndex];
      const absoluteIndex = proposals.findIndex((p) => p.id === target.id);
      if (absoluteIndex >= 0) setReviewIndex(absoluteIndex);
    },
    [activeProposal, pendingProposals, proposals],
  );

  const selectProposal = useCallback(
    (proposalId: string) => {
      const index = proposals.findIndex((p) => p.id === proposalId && p.status === "pending");
      if (index >= 0) setReviewIndex(index);
    },
    [proposals],
  );

  const ghostsForSheet = useCallback(
    // Render ghosts during "scanning" too (AITAKEOFF13): template hits paint in
    // ~12s and the model appends more while the estimator watches — the
    // accept/reject bar still only arms in "review", so mid-scan ghosts are
    // look-only until the scan finishes.
    (sheetId: string | null) =>
      sheetId && (phase === "review" || phase === "scanning")
        ? proposals.filter((p) => p.sheetId === sheetId && p.status !== "rejected")
        : [],
    [phase, proposals],
  );

  return {
    open,
    openPanel,
    closePanel,
    phase,
    pickingExemplar,
    setPickingExemplar,
    exemplar,
    clearExemplar: () => setExemplar(null),
    scope,
    setScope,
    targetSheetCount: targetSheets.length,
    quoteCredits,
    creditSummary: credits.creditSummary,
    creditSummaryLoading: credits.creditSummaryLoading,
    scanProgress,
    scanError,
    runScan,
    cancelScan,
    proposals,
    pendingCount: pendingProposals.length,
    acceptedCount,
    activeProposal,
    acceptActiveProposal,
    rejectActiveProposal,
    nudgeActiveProposal,
    acceptAllRemaining,
    navigateReview,
    selectProposal,
    endReview,
    isAccepting,
    purchasePack: credits.purchasePack,
    isPurchasing: credits.isPurchasing,
    handleMeasurementSelected,
    ghostsForSheet,
    lastOperationId,
  };
}

export type AiAssistController = ReturnType<typeof useAiAssist>;
