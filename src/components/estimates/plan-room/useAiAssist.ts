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
  dedupeCandidates,
  dedupeRadiusForFootprint,
  DETECTION_LONG_EDGE_PX,
  overlapForFootprintPx,
  sortProposalsForReview,
  type AiCountCandidate,
  type AiCountProposal,
  type SheetPoint,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
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

        const raster = await renderDetectionSheet(
          await signedUrlFor(sheet.plan_set_id),
          sheet.page_number,
        );
        // Exemplar-derived geometry (AITAKEOFF5 Task 0): the symbol footprint
        // sizes the tile overlap (whole symbol always fits ≥1 tile) and the
        // dedupe/exclusion radius (seam duplicates + already-marked symbols
        // collapse at symbol scale, not at a fixed 0.008).
        const pageLongEdgePt = Math.max(raster.pageSize.widthPt, raster.pageSize.heightPt);
        const footprintRasterPx =
          exemplarImage.footprintPt !== null && pageLongEdgePt > 0
            ? exemplarImage.footprintPt * (DETECTION_LONG_EDGE_PX / pageLongEdgePt)
            : null;
        const tileOverlapPx = overlapForFootprintPx(footprintRasterPx);
        const dedupeRadius = dedupeRadiusForFootprint(
          footprintRasterPx,
          Math.max(raster.widthPx, raster.heightPx),
        );
        const tiles = sliceDetectionTiles(raster, tileOverlapPx);
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
        // Stage A (AITAKEOFF3 Task 1): coarse, recall-biased candidates in
        // sheet space. Leads only — nothing here becomes a ghost.
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
              dedupe_radius_normalized: dedupeRadius,
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

        // Stage B (AITAKEOFF3 Task 2): dedupe across tile overlap in sheet
        // space FIRST so seam duplicates never buy two verification calls,
        // then the per-sheet cap brakes runaway candidate lists before they
        // spend anything. Each survivor is judged on a zoomed crop; only a
        // verified match becomes a ghost, positioned by the stage-B center.
        const toVerify = capProposalsPerSheet(
          dedupeCandidates(sheetCoarse, dedupeRadius),
          begin.maxProposalsPerSheet,
        );
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
          if (verdict.match && verdict.point) {
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
