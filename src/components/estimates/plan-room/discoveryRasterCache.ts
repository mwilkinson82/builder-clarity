// Persisted render cache for symbol discovery (SYMBOLDISCOVERY "Rung 1").
//
// The identification-library flow (discover → group → name → count) has exactly
// one slow step: rasterizing a vector-dense PDF sheet in the browser. On a heavy
// architectural sheet that render runs 30s to minutes, and it is the source of
// the multi-minute wedge on a session-worn tab. The render output is
// deterministic per (sheet, resolution), so we pay it ONCE: the first discovery
// on a sheet renders as before and uploads the finished raster as a PNG to
// plan-room storage; every later discovery — any session, any user on the
// estimate — downloads that PNG (a ~1-2s fetch) instead of re-rasterizing.
//
// Nothing about the discovery RESULT changes. PNG is lossless, so the grayscale,
// candidate peaks, crops, and embeddings computed off a cached raster are
// byte-identical to a fresh render. This is purely a speed cache: a miss, a
// decode error, or any storage error simply falls back to rendering, so it can
// never break — or alter — the flow.
//
// Client-side by design: the plan-room bucket already accepts direct client
// uploads (plan files + sheet thumbnails in PlanRoomWorkspace), so this needs no
// new server surface, no migration, and no new dependency.

import { supabase } from "@/integrations/supabase/client";
import { planRoomBucket } from "@/lib/plan-room.functions";
import type { DetectionSheetRaster } from "./aiDetectionRender";

/**
 * Storage key for a cached discovery raster. Lives inside the
 * `${estimateId}/${planSetId}/` namespace — the same RLS prefix as the sheet
 * thumbnails the client already writes — keyed by the immutable sheet id and the
 * render long-edge. Re-uploading a drawing set mints new sheet ids, so this key
 * can never serve a stale sheet; a resolution change gets its own object.
 */
export function discoveryRasterCachePath(
  estimateId: string,
  planSetId: string,
  sheetId: string,
  longEdgePx: number,
): string {
  return `${estimateId}/${planSetId}/discovery-cache/${sheetId}.e${Math.round(longEdgePx)}.png`;
}

/** Decode a stored PNG blob back into a raster the discovery path can consume. */
async function rasterFromBlob(blob: Blob): Promise<DetectionSheetRaster | null> {
  if (typeof createImageBitmap !== "function") return null;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(bitmap, 0, 0);
    return {
      canvas,
      widthPx: canvas.width,
      heightPx: canvas.height,
      // Discovery consumes only canvas + width/height (grayscale, peak
      // detection, crops, dedupe radius). pageSize is never read on this path,
      // so a cached raster reconstructs it from pixels. This raster is NOT valid
      // for the scan/tile path, which needs true PDF points and always renders
      // fresh — discovery is the only consumer of the cache.
      pageSize: { widthPt: canvas.width, heightPt: canvas.height },
    };
  } finally {
    bitmap.close?.();
  }
}

/**
 * Load a previously cached discovery raster for this sheet, or null on a miss /
 * any error. Never throws — the caller renders on null.
 */
export async function loadCachedDiscoveryRaster(
  estimateId: string,
  planSetId: string,
  sheetId: string,
  longEdgePx: number,
): Promise<DetectionSheetRaster | null> {
  try {
    const path = discoveryRasterCachePath(estimateId, planSetId, sheetId, longEdgePx);
    const { data, error } = await supabase.storage.from(planRoomBucket).download(path);
    if (error || !data) return null;
    return await rasterFromBlob(data);
  } catch {
    return null;
  }
}

/** Encode a rendered canvas to a PNG blob (async, never throws). */
function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

/**
 * Persist a freshly rendered raster for next time. Best-effort: a failed encode
 * or upload just means the next discovery re-renders, so all errors are
 * swallowed and this never blocks or fails the flow. Fire-and-forget.
 */
export async function saveCachedDiscoveryRaster(
  estimateId: string,
  planSetId: string,
  sheetId: string,
  longEdgePx: number,
  raster: DetectionSheetRaster,
): Promise<void> {
  try {
    const blob = await canvasToPngBlob(raster.canvas);
    if (!blob) return;
    const path = discoveryRasterCachePath(estimateId, planSetId, sheetId, longEdgePx);
    await supabase.storage
      .from(planRoomBucket)
      .upload(path, blob, { upsert: true, contentType: "image/png" });
  } catch {
    // Best-effort cache write — a miss next time simply re-renders.
  }
}
