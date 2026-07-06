// Symbol discovery orchestration (SYMBOLDISCOVERY Stage 0).
// The identification-library front half, as a QA-flagged action: render the
// current sheet, propose candidate crops (ink-density peaks — no exemplar
// needed), embed + cluster them server-side, and show the estimator "the
// kinds of symbols on this sheet." No counting, no labeling yet — Stage 0
// exists to put real clusters in front of real eyes before any product UI
// is built on top (the AITAKEOFF14 lesson: only the live sheet gates).
//
// Credits ride the EXISTING scan machinery: beginAiCountScan charges 1
// credit and opens the operation (failure refunds included), discovery runs,
// completeAiCountScan closes it. The shipped pick-one-symbol flow is not
// touched anywhere here.

import { useServerFn } from "@tanstack/react-start";
import { useCallback, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  beginAiCountScan,
  completeAiCountScan,
  failAiCountScan,
} from "@/lib/ai-takeoff/ai-takeoff.functions";
import { discoverSheetSymbols } from "@/lib/ai-takeoff/ai-discover.functions";
import { detectCandidatePeaks } from "@/lib/ai-takeoff/embedding-match/embedding-candidates-domain";
import type { EmbeddingCluster } from "@/lib/ai-takeoff/embedding-match/embedding-cluster-domain";
import { planRoomBucket, type PlanSetRow, type PlanSheetRow } from "@/lib/plan-room.functions";
import {
  cropPeaksToBase64,
  grayscaleFromRaster,
  renderDetectionSheet,
  type DiscoveryCandidateCrop,
} from "./aiDetectionRender";

// No exemplar exists at discovery time, so the proposer runs on a fixed
// footprint guess: ~2% of the 3800px detection long edge ≈ 80px — the same
// scale the offline A-100 proof used (NMS 80px) when it self-grouped the
// brushes. Stage 0 calibration knob, alongside the server-side threshold.
export const DISCOVERY_FOOTPRINT_PX = 80;
const DISCOVERY_CROP_SIDE_PX = Math.round(DISCOVERY_FOOTPRINT_PX * 1.4);

export type SymbolDiscoveryPhase = "idle" | "running" | "done";

export interface SymbolDiscoveryResult {
  clusters: EmbeddingCluster[];
  crops: DiscoveryCandidateCrop[];
  candidateCount: number;
  embeddingDim: number;
  similarityThreshold: number;
  embedElapsedMs: number;
  totalElapsedMs: number;
  sheetLabel: string;
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

  const planSetById = useMemo(
    () => new Map(planSets.map((planSet) => [planSet.id, planSet])),
    [planSets],
  );

  const start = useCallback(async () => {
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
    const startedAt = Date.now();
    let operationId: string | null = null;
    try {
      setProgress("Reserving the scan credit…");
      const begin = await beginScanFn({
        data: { estimate_id: estimateId, sheet_ids: [sheet.id] },
      });
      operationId = begin.operationId;

      setProgress("Rendering the sheet…");
      const { data: signed } = await supabase.storage
        .from(planRoomBucket)
        .createSignedUrl(planSet.file_path, 60 * 10);
      if (!signed?.signedUrl) throw new Error("The drawing file could not be opened.");
      const raster = await renderDetectionSheet(signed.signedUrl, sheet.page_number);

      setProgress("Finding candidate symbols…");
      const gray = grayscaleFromRaster(raster);
      if (!gray) throw new Error("The sheet could not be read for discovery.");
      const peaks = detectCandidatePeaks(
        gray,
        raster.widthPx,
        raster.heightPx,
        DISCOVERY_FOOTPRINT_PX,
      );
      if (peaks.length === 0) throw new Error("No candidate symbols were found on this sheet.");
      const crops = cropPeaksToBase64(raster, peaks, DISCOVERY_CROP_SIDE_PX);

      setProgress(`Grouping ${crops.length} candidates by what they look like…`);
      const discovered = await discoverFn({
        data: {
          candidates: crops.map((crop) => ({
            x: crop.x,
            y: crop.y,
            base64: crop.base64,
            mediaType: "image/png",
          })),
        },
      });

      await completeScanFn({ data: { operation_id: operationId } });
      operationId = null;
      setResult({
        clusters: discovered.clusters,
        crops,
        candidateCount: discovered.candidateCount,
        embeddingDim: discovered.embeddingDim,
        similarityThreshold: discovered.similarityThreshold,
        embedElapsedMs: discovered.elapsedMs,
        totalElapsedMs: Date.now() - startedAt,
        sheetLabel: `${sheet.sheet_number || `Page ${sheet.page_number}`}`.trim(),
      });
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

  const close = useCallback(() => {
    if (phase === "running") return; // let the run finish; credits are honest
    setOpen(false);
    setPhase("idle");
    setError("");
  }, [phase]);

  return { phase, open, progress, error, result, start, close };
}

export type SymbolDiscoveryController = ReturnType<typeof useSymbolDiscovery>;
