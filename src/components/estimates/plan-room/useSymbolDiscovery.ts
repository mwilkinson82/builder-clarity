// Symbol discovery orchestration (SYMBOLDISCOVERY Stages 0-1).
// The identification-library flow, QA-flagged: render the current sheet,
// propose candidate crops (ink-density peaks — no exemplar needed), embed +
// cluster them server-side, and show the estimator "the kinds of symbols on
// this sheet." Stage 1 closes the loop: naming a group hands its members to
// the AI-review machinery (useAiAssist.beginExternalReview) where they are
// accepted/rejected/nudged into a counted takeoff — the AI discovers, the
// human names, the existing review counts.
//
// Credits ride the EXISTING scan machinery: beginAiCountScan charges 1
// credit and opens the operation (failure refunds included), discovery runs,
// completeAiCountScan closes it. Kept results REOPEN free — only an explicit
// re-scan charges again. The shipped pick-one-symbol flow is not touched.

import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  beginAiCountScan,
  completeAiCountScan,
  failAiCountScan,
} from "@/lib/ai-takeoff/ai-takeoff.functions";
import { discoverSheetSymbols } from "@/lib/ai-takeoff/ai-discover.functions";
import { detectCandidatePeaks } from "@/lib/ai-takeoff/embedding-match/embedding-candidates-domain";
import type { EmbeddingCluster } from "@/lib/ai-takeoff/embedding-match/embedding-cluster-domain";
import {
  DETECTION_LONG_EDGE_PX,
  sheetRadiusFromLongEdge,
  type SheetRadius,
} from "@/lib/ai-takeoff/ai-takeoff-domain";
import { planRoomBucket, type PlanSetRow, type PlanSheetRow } from "@/lib/plan-room.functions";
import {
  cropPeaksToBase64,
  grayscaleFromRaster,
  renderDetectionSheet,
  type DetectionSheetRaster,
  type DiscoveryCandidateCrop,
} from "./aiDetectionRender";
import { loadCachedDiscoveryRaster, saveCachedDiscoveryRaster } from "./discoveryRasterCache";
import { requestServerSheetRender } from "./discoveryServerRender";
import type { SymbolLibrarySuggestion } from "@/lib/ai-takeoff/symbol-library-domain";

// No exemplar exists at discovery time, so the proposer runs on a fixed
// footprint guess: ~2% of the sheet's long edge (80px at the 3800px detection
// scale) — the scale the offline A-100 proof used (NMS 80px) when it
// self-grouped the brushes. Stored as a FRACTION so it stays physically the
// same symbol size at any render resolution.
export const DISCOVERY_FOOTPRINT_PX = 80;
const DISCOVERY_FOOTPRINT_FRACTION = DISCOVERY_FOOTPRINT_PX / DETECTION_LONG_EDGE_PX;

// Discovery renders LIGHTER than the scan (SYMBOLDISCOVERY Stage 2a): its
// coords are normalized so ghost placement is identical, only the embed-crop
// resolution drops. Far fewer pixels than 3800 = a faster raster that no
// longer wedges a session-worn browser. Tunable; re-QA the cluster if changed.
const DISCOVERY_RENDER_LONG_EDGE_PX = 2400;

// One render can rasterize a vector-dense sheet for a long time; bound it so a
// slow/wedged browser fails at the cap (→ refund) instead of hanging for
// minutes. Cleared by the caller's try/catch → failAiCountScan → credit back.
const DISCOVERY_RENDER_TIMEOUT_MS = 90_000;

/** Race the sheet render against a timeout so it can never hang the flow. */
function renderWithTimeout(
  signedUrl: string,
  pageNumber: number,
  longEdgePx: number,
): Promise<DetectionSheetRaster> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            "The sheet took too long to render. Your credit was refunded — try again, or use a lighter browser tab.",
          ),
        ),
      DISCOVERY_RENDER_TIMEOUT_MS,
    );
  });
  return Promise.race([renderDetectionSheet(signedUrl, pageNumber, longEdgePx), timeout]).finally(
    () => {
      if (timer) clearTimeout(timer);
    },
  ) as Promise<DetectionSheetRaster>;
}

export type SymbolDiscoveryPhase = "idle" | "running" | "done";

export interface SymbolDiscoveryResult {
  clusters: EmbeddingCluster[];
  librarySuggestions: SymbolLibrarySuggestion[];
  libraryExampleCount: number;
  crops: DiscoveryCandidateCrop[];
  candidateCount: number;
  embeddingDim: number;
  similarityThreshold: number;
  embedElapsedMs: number;
  totalElapsedMs: number;
  sheetLabel: string;
  /** The sheet the discovery ran on — labels seed reviews on THIS sheet. */
  sheetId: string;
  /** The discovery-op id, so review rejections tie to it in diagnostics. */
  operationId: string | null;
  /**
   * The footprint-derived dedupe radius on this sheet's raster — the same
   * near-existing exclusion rule the scan applies, so a labeled member
   * sitting on an already-counted mark never double-counts.
   */
  dedupeRadius: SheetRadius;
}

export interface DiscoveryMarkup {
  id: string;
  clusterIndex: number;
  memberIndex: number;
  groupNumber: number;
  groupCount: number;
  x: number;
  y: number;
  libraryLabel: string;
}

export interface DiscoveryGroupReviewOutcome {
  label: string;
  accepted: number;
  rejected: number;
}

export interface UseSymbolDiscoveryArgs {
  estimateId: string;
  sheets: PlanSheetRow[];
  planSets: PlanSetRow[];
  currentSheetId: string | null;
}

export function useSymbolDiscovery({
  estimateId,
  sheets,
  planSets,
  currentSheetId,
}: UseSymbolDiscoveryArgs) {
  const beginScanFn = useServerFn(beginAiCountScan);
  const completeScanFn = useServerFn(completeAiCountScan);
  const failScanFn = useServerFn(failAiCountScan);
  const discoverFn = useServerFn(discoverSheetSymbols);

  const [phase, setPhase] = useState<SymbolDiscoveryPhase>("idle");
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<SymbolDiscoveryResult | null>(null);
  const [selectedClusterIndex, setSelectedClusterIndex] = useState<number | null>(null);
  const [ignoredClusterIndexes, setIgnoredClusterIndexes] = useState<number[]>([]);
  const [reviewedGroups, setReviewedGroups] = useState<Record<number, DiscoveryGroupReviewOutcome>>(
    {},
  );
  // Single-entry render cache (Stage 2a): re-scanning the same sheet reuses
  // the raster instead of paying the render again. One entry keeps the big
  // canvas from piling up in memory.
  const rasterCacheRef = useRef<{ key: string; raster: DetectionSheetRaster } | null>(null);

  const planSetById = useMemo(
    () => new Map(planSets.map((planSet) => [planSet.id, planSet])),
    [planSets],
  );

  const runDiscovery = useCallback(async () => {
    if (phase === "running") return;
    const sheet = sheets.find((item) => item.id === currentSheetId) ?? null;
    const planSet = sheet ? planSetById.get(sheet.plan_set_id) : null;
    if (!sheet || !planSet?.file_path || planSet.file_mime_type !== "application/pdf") {
      setError("Open a PDF sheet first — discovery scans the current sheet.");
      setOpen(true);
      setPhase("idle");
      return;
    }
    setOpen(true);
    setPhase("running");
    setError("");
    setResult(null);
    setSelectedClusterIndex(null);
    setIgnoredClusterIndexes([]);
    setReviewedGroups({});
    const startedAt = Date.now();
    let operationId: string | null = null;
    try {
      setProgress("Reserving the scan credit…");
      const begin = await beginScanFn({
        data: { estimate_id: estimateId, sheet_ids: [sheet.id] },
      });
      operationId = begin.operationId;

      // Reuse the raster when re-scanning the same sheet in-session; else load
      // the persisted render cache (Rung 1) before paying the render again.
      const cacheKey = `${sheet.id}|${DISCOVERY_RENDER_LONG_EDGE_PX}`;
      let raster = rasterCacheRef.current?.key === cacheKey ? rasterCacheRef.current.raster : null;
      if (!raster) {
        // The finished raster is cached in storage after the first render, so
        // later discoveries — any session, any user on this estimate — download
        // it (~1-2s) instead of re-rasterizing the vector-dense sheet. This is
        // the fix for the multi-minute render/wedge.
        setProgress("Loading the sheet…");
        raster = await loadCachedDiscoveryRaster(
          estimateId,
          planSet.id,
          sheet.id,
          DISCOVERY_RENDER_LONG_EDGE_PX,
        );
        if (!raster) {
          // Rung 2: first time for this sheet — have the SERVER rasterize it
          // (MuPDF, ~1-2s) and seed the same cache, so even a weak browser
          // skips the slow local rasterize. Then read the freshly seeded cache.
          setProgress("Preparing the sheet…");
          const seeded = await requestServerSheetRender({
            estimateId,
            planSetId: planSet.id,
            sheetId: sheet.id,
            filePath: planSet.file_path,
            pageNumber: sheet.page_number,
            longEdgePx: DISCOVERY_RENDER_LONG_EDGE_PX,
          });
          if (seeded) {
            raster = await loadCachedDiscoveryRaster(
              estimateId,
              planSet.id,
              sheet.id,
              DISCOVERY_RENDER_LONG_EDGE_PX,
            );
          }
        }
        if (!raster) {
          // Fallback — the server render was unavailable: render in-browser
          // (bounded so a slow browser refunds instead of hanging), then
          // persist for everyone after. This is the pre-Rung-2 path, kept so
          // discovery never depends on the edge function being reachable.
          setProgress("Rendering the sheet…");
          const { data: signed } = await supabase.storage
            .from(planRoomBucket)
            .createSignedUrl(planSet.file_path, 60 * 10);
          if (!signed?.signedUrl) throw new Error("The drawing file could not be opened.");
          raster = await renderWithTimeout(
            signed.signedUrl,
            sheet.page_number,
            DISCOVERY_RENDER_LONG_EDGE_PX,
          );
          // Fire-and-forget: never blocks or fails the flow.
          void saveCachedDiscoveryRaster(
            estimateId,
            planSet.id,
            sheet.id,
            DISCOVERY_RENDER_LONG_EDGE_PX,
            raster,
          );
        }
        rasterCacheRef.current = { key: cacheKey, raster };
      }

      setProgress("Finding candidate symbols…");
      const gray = grayscaleFromRaster(raster);
      if (!gray) throw new Error("The sheet could not be read for discovery.");
      // Footprint tracks the render resolution so the SAME physical symbol size
      // is detected whatever the raster scale (the 3800px gate and a 2400px
      // run find the same symbols; only crop pixels differ).
      const footprintPx = Math.max(
        16,
        Math.round(DISCOVERY_FOOTPRINT_FRACTION * Math.max(raster.widthPx, raster.heightPx)),
      );
      const peaks = detectCandidatePeaks(gray, raster.widthPx, raster.heightPx, footprintPx);
      if (peaks.length === 0) throw new Error("No candidate symbols were found on this sheet.");
      const crops = cropPeaksToBase64(raster, peaks, Math.round(footprintPx * 1.4));

      setProgress(`Grouping ${crops.length} candidates by what they look like…`);
      const discovered = await discoverFn({
        data: {
          estimate_id: estimateId,
          sheet_id: sheet.id,
          operation_id: operationId,
          candidates: crops.map((crop) => ({
            x: crop.x,
            y: crop.y,
            base64: crop.base64,
            mediaType: "image/png",
          })),
        },
      });

      const completedOperationId = operationId;
      await completeScanFn({ data: { operation_id: completedOperationId } });
      operationId = null;
      setResult({
        clusters: discovered.clusters,
        librarySuggestions: discovered.librarySuggestions,
        libraryExampleCount: discovered.libraryExampleCount,
        crops,
        candidateCount: discovered.candidateCount,
        embeddingDim: discovered.embeddingDim,
        similarityThreshold: discovered.similarityThreshold,
        embedElapsedMs: discovered.elapsedMs,
        totalElapsedMs: Date.now() - startedAt,
        sheetLabel: `${sheet.sheet_number || `Page ${sheet.page_number}`}`.trim(),
        sheetId: sheet.id,
        operationId: completedOperationId,
        dedupeRadius: sheetRadiusFromLongEdge(
          (0.75 * footprintPx) / Math.max(raster.widthPx, raster.heightPx),
          raster.widthPx,
          raster.heightPx,
        ),
      });
      const firstGroupIndex = discovered.clusters.findIndex(
        (cluster) => cluster.memberIndexes.length >= 2,
      );
      setSelectedClusterIndex(firstGroupIndex >= 0 ? firstGroupIndex : null);
      setPhase("done");
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : "Discovery failed.";
      if (operationId) {
        try {
          await failScanFn({
            data: { operation_id: operationId, reason: message.slice(0, 400) },
          });
        } catch {
          // Already failed server-side (and refunded) — nothing left to do.
        }
      }
      setError(message);
      setPhase("idle");
    }
  }, [
    phase,
    sheets,
    currentSheetId,
    planSetById,
    estimateId,
    beginScanFn,
    completeScanFn,
    failScanFn,
    discoverFn,
  ]);

  /**
   * The panel button: REOPEN the kept result for this sheet free of charge;
   * only run (and charge) when there is nothing to show yet. An explicit
   * re-scan is its own button in the dialog.
   */
  const start = useCallback(async () => {
    if (phase === "running") return;
    if (result && result.sheetId === currentSheetId) {
      setError("");
      setPhase("done");
      if (selectedClusterIndex == null) {
        const firstGroupIndex = result.clusters.findIndex(
          (cluster, index) =>
            cluster.memberIndexes.length >= 2 &&
            !ignoredClusterIndexes.includes(index) &&
            !reviewedGroups[index],
        );
        setSelectedClusterIndex(firstGroupIndex >= 0 ? firstGroupIndex : null);
      }
      setOpen(true);
      return;
    }
    await runDiscovery();
  }, [
    currentSheetId,
    ignoredClusterIndexes,
    phase,
    result,
    reviewedGroups,
    runDiscovery,
    selectedClusterIndex,
  ]);

  const selectGroup = useCallback((clusterIndex: number) => {
    setSelectedClusterIndex(clusterIndex);
    setOpen(true);
  }, []);
  const clearSelection = useCallback(() => setSelectedClusterIndex(null), []);

  const nextUnreviewedGroup = useCallback(
    (afterIndex: number, additionallyDone: number[] = []) => {
      if (!result) return null;
      const unavailable = new Set([
        ...ignoredClusterIndexes,
        ...Object.keys(reviewedGroups).map(Number),
        ...additionallyDone,
      ]);
      const eligible = result.clusters
        .map((cluster, index) => ({ cluster, index }))
        .filter(
          ({ cluster, index }) => cluster.memberIndexes.length >= 2 && !unavailable.has(index),
        );
      return eligible.find(({ index }) => index > afterIndex)?.index ?? eligible[0]?.index ?? null;
    },
    [ignoredClusterIndexes, result, reviewedGroups],
  );

  const ignoreGroup = useCallback(
    (clusterIndex: number) => {
      setIgnoredClusterIndexes((current) =>
        current.includes(clusterIndex) ? current : [...current, clusterIndex],
      );
      setSelectedClusterIndex(nextUnreviewedGroup(clusterIndex, [clusterIndex]));
    },
    [nextUnreviewedGroup],
  );

  const completeGroupReview = useCallback(
    (clusterIndex: number, outcome: DiscoveryGroupReviewOutcome) => {
      setReviewedGroups((current) => ({ ...current, [clusterIndex]: outcome }));
      setSelectedClusterIndex(nextUnreviewedGroup(clusterIndex, [clusterIndex]));
      setOpen(true);
    },
    [nextUnreviewedGroup],
  );

  const markupsForSheet = useCallback(
    (sheetId: string | null): DiscoveryMarkup[] => {
      if (!open || phase !== "done" || !result || result.sheetId !== sheetId) return [];
      return result.clusters.flatMap((cluster, clusterIndex): DiscoveryMarkup[] => {
        if (
          cluster.memberIndexes.length < 2 ||
          ignoredClusterIndexes.includes(clusterIndex) ||
          reviewedGroups[clusterIndex]
        ) {
          return [];
        }
        const suggestion = result.librarySuggestions.find(
          (item) => item.clusterIndex === clusterIndex,
        );
        return cluster.memberIndexes.flatMap((memberIndex): DiscoveryMarkup[] => {
          const crop = result.crops[memberIndex];
          if (!crop) return [];
          return [
            {
              id: `${result.operationId ?? result.sheetId}:${clusterIndex}:${memberIndex}`,
              clusterIndex,
              memberIndex,
              groupNumber: clusterIndex + 1,
              groupCount: cluster.memberIndexes.length,
              x: crop.x,
              y: crop.y,
              libraryLabel: suggestion?.label ?? "",
            },
          ];
        });
      });
    },
    [ignoredClusterIndexes, open, phase, result, reviewedGroups],
  );

  const close = useCallback(() => {
    if (phase === "running") return; // let the run finish; credits are honest
    setOpen(false);
    setError("");
  }, [phase]);

  return {
    phase,
    open,
    progress,
    error,
    result,
    selectedClusterIndex,
    ignoredClusterIndexes,
    reviewedGroups,
    start,
    rescan: runDiscovery,
    close,
    selectGroup,
    clearSelection,
    ignoreGroup,
    completeGroupReview,
    markupsForSheet,
  };
}

export type SymbolDiscoveryController = ReturnType<typeof useSymbolDiscovery>;
