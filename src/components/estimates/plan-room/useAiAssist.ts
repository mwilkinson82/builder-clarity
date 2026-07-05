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
  capProposalsPerSheet,
  excludeNearExistingPoints,
  exemplarSheetGeometry,
  sortProposalsForReview,
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
import { geometryFromPoints, geometryPoints, type ViewSize } from "./planRoomShared";

export type AiAssistPhase = "idle" | "scanning" | "review";
export type { AiExemplar } from "./aiReferenceHarvest";
export type AiScanScope = "sheet" | "all";

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
  const createMeasurementFn = useServerFn(createTakeoffMeasurement);
  const updateMeasurementFn = useServerFn(updateTakeoffMeasurement);

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
  // Rejections the user made this session, keyed by sheet + exemplar label —
  // they become negative references on the next scan (AITAKEOFF5 Task 1).
  const sessionRejectionsRef = useRef(new Map<string, SheetPoint[]>());

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
      let templateImage: ImageData | null = null;
      // Hub anchor (AITAKEOFF9 Task 0): where the estimator's marker sits
      // relative to the template crop's center — recovered hits land on the
      // hub, not on the ink bbox's center (the constant ~45px A-100 drift).
      let templateAnchor = { x: 0, y: 0 };
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
        const templateRect = templateCropRect(
          {
            x: exemplar.point.x * exemplarRaster.widthPx,
            y: exemplar.point.y * exemplarRaster.heightPx,
          },
          exemplarGeometry.footprintRasterPx ?? 0,
          exemplarRaster.widthPx,
          exemplarRaster.heightPx,
        );
        templateImage =
          exemplarRaster.canvas
            .getContext("2d")
            ?.getImageData(
              templateRect.left,
              templateRect.top,
              templateRect.width,
              templateRect.height,
            ) ?? null;
        templateAnchor = {
          x:
            exemplar.point.x * exemplarRaster.widthPx -
            (templateRect.left + templateRect.width / 2),
          y:
            exemplar.point.y * exemplarRaster.heightPx -
            (templateRect.top + templateRect.height / 2),
        };
        exemplarRasterReuse = exemplarRaster;
        if (templateImage) templateSession = createTemplateMatchSession();
      }
      if (proposalSource === "template" && !templateSession) {
        throw new Error(
          "Template matching needs a measurable symbol under the exemplar marker. Pick a marker centered on the symbol, or unset AI_PROPOSAL_SOURCE.",
        );
      }

      const found: AiCountProposal[] = [];
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
        let rejectedPoints = sessionRejectionsRef.current.get(rejectionKey) ?? [];
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
        if (templateSession && templateImage && geometry.footprintRasterPx !== null) {
          try {
            const rasterPixels = raster.canvas
              .getContext("2d")
              ?.getImageData(0, 0, raster.widthPx, raster.heightPx);
            if (!rasterPixels) throw new Error("The sheet could not be read for matching.");
            const matched = await templateSession.match({
              raster: rasterPixels,
              template: templateImage,
              options: {
                threshold: begin.templateMatchThreshold ?? DEFAULT_TEMPLATE_MATCH_THRESHOLD,
                footprintPx: geometry.footprintRasterPx,
                radius: geometry.radius,
                anchor: templateAnchor,
              },
            });
            templateHits = matched.candidates;
            templateEngine = "ok";
            templateElapsedMs = matched.elapsedMs;
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

        // Stage A (AITAKEOFF3 Task 1): coarse, recall-biased candidates in
        // sheet space. Leads only — nothing here becomes a ghost. Skipped
        // entirely when the template engine is the sole proposal source.
        const sheetCoarse: AiCountCandidate[] = [];

        for (let index = 0; index < tiles.length; index += 1) {
          if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
          const tile = tiles[index];
          const result = await scanTileFn({
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
          });
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
        }

        // Stage B (AITAKEOFF3 Task 2, union in AITAKEOFF6): both engines'
        // candidates merge and dedupe by the canonical footprint radius
        // FIRST — a symbol both engines found never buys two verification
        // calls — template hits ranking by NCC score for the per-sheet cap.
        // The near-existing suppression the server applies to model
        // candidates covers template hits here, same helper, same radius.
        const unioned = unionProposalCandidates(templateHits, sheetCoarse, geometry.radius);
        const fresh = excludeNearExistingPoints(
          unioned,
          existingPoints,
          geometry.radius,
          // excludeNearExistingPoints filters without mapping, so the union
          // entries' engine metadata survives the narrower parameter type.
        ) as typeof unioned;
        const toVerify = capProposalsPerSheet(fresh, begin.maxProposalsPerSheet);
        let sheetVerified = 0;
        let sheetCenterMismatch = 0;
        for (let index = 0; index < toVerify.length; index += 1) {
          if (cancelRequestedRef.current) throw new Error("Scan cancelled.");
          setScanProgress({
            sheetsDone,
            sheetsTotal: targetSheets.length,
            currentSheetLabel: sheetLabel,
            found: found.length,
            verifying: { done: index, total: toVerify.length },
            references: progressReferences,
            exemplarDescription: echo,
          });
          const candidate = toVerify[index];
          const window = renderVerifyWindow(raster, candidate);
          const verdict = await verifyCandidateFn({
            data: {
              operation_id: begin.operationId,
              sheet_id: sheet.id,
              candidate_index: index,
              candidate: { x: candidate.x, y: candidate.y },
              // Which engine proposed it (AITAKEOFF6): rides into the verify
              // diagnostics as "template 0.78 @ 30°" vs "model".
              candidate_origin:
                candidate.source === "template" && candidate.templateHit
                  ? {
                      source: "template" as const,
                      score: Math.min(1, candidate.templateHit.score),
                      rotation_deg: candidate.templateHit.rotationDeg,
                      scale: candidate.templateHit.scale,
                    }
                  : { source: "model" as const, score: null, rotation_deg: null, scale: null },
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
          });
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
          }
          setScanProgress({
            sheetsDone,
            sheetsTotal: targetSheets.length,
            currentSheetLabel: sheetLabel,
            found: found.length,
            verifying: { done: index + 1, total: toVerify.length },
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
                sent_to_verify: toVerify.length,
                verified: sheetVerified,
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

  const rejectActiveProposal = useCallback(() => {
    if (!activeProposal || isAccepting) return;
    // Remember what was rejected: it teaches the next scan what NOT to find.
    if (exemplar) {
      const key = `${activeProposal.sheetId}|${exemplar.label.trim().toLowerCase()}`;
      const rejected = sessionRejectionsRef.current.get(key) ?? [];
      rejected.unshift({ x: activeProposal.x, y: activeProposal.y });
      sessionRejectionsRef.current.set(key, rejected.slice(0, 10));
    }
    const index = proposals.findIndex((p) => p.id === activeProposal.id);
    const updated = proposals.map((p) =>
      p.id === activeProposal.id ? { ...p, status: "rejected" as const } : p,
    );
    setProposals(updated);
    if (!advanceToNextPending(index, updated)) {
      setTimeout(() => endReviewWithProposals(updated), 0);
    }
  }, [
    activeProposal,
    advanceToNextPending,
    endReviewWithProposals,
    exemplar,
    isAccepting,
    proposals,
  ]);

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
    (sheetId: string | null) =>
      sheetId && phase === "review"
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
