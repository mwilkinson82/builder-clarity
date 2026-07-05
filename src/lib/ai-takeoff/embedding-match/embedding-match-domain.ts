// Embedding-match domain logic (AITAKEOFF12 Task 0).
// Pure functions only: no ONNX, no DOM, no env reads beyond the resolvers —
// the worker and the node smoke share every decision made here.
//
// WHY THIS ENGINE EXISTS. Pixel template matching (AITAKEOFF6-11) matches
// shape-as-pixels, never symbol IDENTITY: on Crystal Carwash A-100 a brush
// exemplar under-counted (4 hits, contaminated 44%-mask template) while a
// blower exemplar OVER-counted (32 hits — a plain circle matches every circle,
// the site logo scored highest). A learned visual embedding (DINOv2) fixes
// both: measured offline on that exact sheet, a blower exemplar sits at cosine
// 0.76 to its twin and 0.22-0.36 to the brushes — a clean gap that turns "32
// ghosts" into "2 matches". This module owns the SELECTION math that converts a
// well-separated embedding space into the right candidates; the embeddings
// themselves come from the model in embedding-match.worker.ts.
//
// Relative import with .ts on purpose: the smoke suite runs this under plain
// node --experimental-strip-types, which cannot resolve the @/ alias.
import {
  withinSheetRadius,
  sheetRadiusFromLongEdge,
  type SheetRadius,
} from "../ai-takeoff-domain.ts";

/** A learned embedding: a fixed-length vector in a model's feature space. */
export type EmbeddingVector = readonly number[];

/** One embedding-match hit, in normalized [0,1] sheet space. */
export interface EmbeddingMatchCandidate {
  x: number;
  y: number;
  /** Cosine similarity to the exemplar embedding (−1..1; symbols land ~0.6-0.95). */
  score: number;
  /** Window scale (relative to the exemplar footprint) that produced the hit. */
  scale: number;
}

/** One of the best sweep scores, threshold or not — zero-hit transparency. */
export interface EmbeddingTopScore {
  x: number;
  y: number;
  score: number;
  scale: number;
}

// --- Thresholds -------------------------------------------------------------
// Cosine floor for a proposal. Calibrated on the A-100 measurement: the twin
// blower scored 0.76 and the nearest distractor family (brushes) 0.22-0.36, so
// 0.62 keeps real matches with wide margin while the plain-circle look-alikes
// that flooded the pixel engine stay out. Recall-first still applies — a template
// hit is a review GHOST the estimator accepts/rejects — but embedding identity
// keeps the anomaly VOLUME under the "review beats doing it by hand" line.
// Env-tunable via AI_EMBEDDING_MATCH_THRESHOLD.
export const DEFAULT_EMBEDDING_MATCH_THRESHOLD = 0.62;
// A quantized model (browser download budget) may shift scores slightly; the
// secondary floor is the lowest a match may fall to while a stronger neighbor
// on the same symbol clears the primary floor. Also the coarse-pass recall pool.
export const EMBEDDING_SECONDARY_FLOOR = 0.58;
// Coarse pool margin: windows within this of the threshold get a fine refine
// pass — the refinement decides, at the real threshold.
export const EMBEDDING_RECALL_MARGIN = 0.06;

// --- Sweep geometry ---------------------------------------------------------
// Symbols on one sheet vary in SIZE, and the window decides how much CONTEXT
// the model sees around a point (the crop is resized to the model's input
// regardless, so identity survives scaling — it's context, not resolution,
// that these scales control). One exemplar footprint, three window scales,
// covers a symbol drawn small-to-large without a second exemplar.
export const EMBEDDING_WINDOW_SCALES = [0.85, 1.3, 2.0] as const;
// Coarse stride = half the window (guarantees every symbol center is inside
// some window); fine refine stride = a quarter window, on ROIs only.
export const COARSE_STRIDE_RATIO = 0.5;
export const FINE_STRIDE_RATIO = 0.25;
// Window side in raster px is clamped so a tiny footprint still sees context
// and a huge one does not swallow the sheet.
export const EMBEDDING_MIN_WINDOW_PX = 48;
export const EMBEDDING_MAX_WINDOW_PX = 512;
// Top-of-sweep transparency: the best N scores are always reported.
export const EMBEDDING_TOP_SCORE_COUNT = 5;
// Matching runs on a downscaled detection raster to stay in the client's
// compute budget; hits map back through the tested transform.
export const EMBEDDING_MATCH_MAX_LONG_EDGE_PX = 2400;

export interface EmbeddingSweepScale {
  /** Window side length in raster px. */
  windowPx: number;
  /** Coarse stride in raster px. */
  coarseStridePx: number;
  /** Fine refine stride in raster px. */
  fineStridePx: number;
  /** Scale relative to the exemplar footprint (for provenance). */
  scale: number;
}

export interface EmbeddingSweepPlan {
  scales: EmbeddingSweepScale[];
}

/** L2-normalize a vector so cosine similarity is a plain dot product. */
export function l2Normalize(vec: EmbeddingVector): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (!(norm > 0)) return vec.map(() => 0);
  return vec.map((v) => v / norm);
}

/**
 * Cosine similarity of two embeddings. Robust to un-normalized input: divides
 * by both norms, returns 0 when either vector is degenerate (an empty edge
 * crop must never score as a match).
 */
export function cosineSimilarity(a: EmbeddingVector, b: EmbeddingVector): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let aSq = 0;
  let bSq = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    aSq += a[i] * a[i];
    bSq += b[i] * b[i];
  }
  const denom = Math.sqrt(aSq) * Math.sqrt(bSq);
  return denom > 0 ? dot / denom : 0;
}

/**
 * Plan the multi-scale window sweep from the exemplar footprint. Window sides
 * are footprint × EMBEDDING_WINDOW_SCALES, clamped to the raster and the
 * min/max window; strides derive from the window so the grid is self-similar
 * across scales.
 */
export function planEmbeddingSweep(
  footprintPx: number,
  rasterWidthPx: number,
  rasterHeightPx: number,
): EmbeddingSweepPlan {
  const maxWindow = Math.max(
    EMBEDDING_MIN_WINDOW_PX,
    Math.min(EMBEDDING_MAX_WINDOW_PX, Math.min(rasterWidthPx, rasterHeightPx)),
  );
  const base = Math.max(1, footprintPx);
  const scales: EmbeddingSweepScale[] = [];
  for (const scale of EMBEDDING_WINDOW_SCALES) {
    const windowPx = Math.round(
      Math.min(maxWindow, Math.max(EMBEDDING_MIN_WINDOW_PX, base * scale)),
    );
    const scaleEntry: EmbeddingSweepScale = {
      windowPx,
      coarseStridePx: Math.max(1, Math.round(windowPx * COARSE_STRIDE_RATIO)),
      fineStridePx: Math.max(1, Math.round(windowPx * FINE_STRIDE_RATIO)),
      scale,
    };
    // Collapse duplicate window sizes (tiny footprints clamp to the same px).
    if (!scales.some((s) => s.windowPx === scaleEntry.windowPx)) scales.push(scaleEntry);
  }
  return { scales };
}

/** Window center coordinates (raster px) for a stride grid, inset by half a window. */
export function sweepWindowCenters(
  rasterWidthPx: number,
  rasterHeightPx: number,
  windowPx: number,
  stridePx: number,
): Array<{ x: number; y: number }> {
  const half = Math.floor(windowPx / 2);
  const stride = Math.max(1, stridePx);
  const centers: Array<{ x: number; y: number }> = [];
  const maxX = Math.max(half, rasterWidthPx - half);
  const maxY = Math.max(half, rasterHeightPx - half);
  for (let y = half; y <= maxY; y += stride) {
    for (let x = half; x <= maxX; x += stride) centers.push({ x, y });
  }
  return centers;
}

/**
 * Non-max suppression: highest score wins within the footprint radius. Same
 * greedy shape as the template engine's, on the canonical SheetRadius so raster
 * pixels can never leak into sheet space.
 */
export function suppressEmbeddingNonMaxima<T extends { x: number; y: number; score: number }>(
  candidates: T[],
  radius: SheetRadius,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.some((existing) => withinSheetRadius(existing, candidate, radius));
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

/**
 * Turn scored windows into final matches: keep everything at or above the
 * threshold, then NMS by the footprint radius so one symbol yields one hit.
 * This is the whole precision story — a clean embedding gap (real 0.76 vs
 * look-alike 0.3) plus this filter is what makes "2 matches, not 32".
 */
export function selectEmbeddingMatches(
  scored: EmbeddingMatchCandidate[],
  threshold: number,
  radius: SheetRadius,
): EmbeddingMatchCandidate[] {
  const passing = scored.filter((c) => c.score >= threshold);
  return suppressEmbeddingNonMaxima(passing, radius);
}

/** The N highest sweep scores, always reported so a zero-hit sheet is never opaque. */
export function topEmbeddingScores(
  scored: EmbeddingMatchCandidate[],
  count: number = EMBEDDING_TOP_SCORE_COUNT,
): EmbeddingTopScore[] {
  return [...scored]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, count))
    .map(({ x, y, score, scale }) => ({ x, y, score, scale }));
}

/**
 * Downscale factor bringing the detection raster to matching resolution
 * (≤ EMBEDDING_MATCH_MAX_LONG_EDGE_PX). Never upscales.
 */
export function embeddingMatchDownscaleFor(
  rasterWidthPx: number,
  rasterHeightPx: number,
  maxLongEdgePx: number = EMBEDDING_MATCH_MAX_LONG_EDGE_PX,
): number {
  const longEdge = Math.max(1, rasterWidthPx, rasterHeightPx);
  return longEdge <= maxLongEdgePx ? 1 : maxLongEdgePx / longEdge;
}

/** AI_EMBEDDING_MATCH_THRESHOLD env value → usable threshold, else default. */
export function resolveEmbeddingMatchThreshold(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > -1 && value < 1
    ? value
    : DEFAULT_EMBEDDING_MATCH_THRESHOLD;
}

/**
 * A SheetRadius sized to the exemplar footprint for de-duping matches — the
 * same footprint-fraction the template engine dedupes on, so both engines
 * collapse a symbol to one hit the same way.
 */
export function embeddingDedupeRadius(
  footprintPx: number,
  rasterWidthPx: number,
  rasterHeightPx: number,
): SheetRadius {
  const longEdge = Math.max(1, rasterWidthPx, rasterHeightPx);
  const fraction = Math.min(0.04, Math.max(0.006, (footprintPx * 0.6) / longEdge));
  return sheetRadiusFromLongEdge(fraction, rasterWidthPx, rasterHeightPx);
}

/** Human-readable origin: "embedding 0.76 ×1.30". */
export function describeEmbeddingOrigin(origin: {
  score?: number | null;
  scale?: number | null;
}): string {
  const score = Number.isFinite(origin.score ?? NaN) ? (origin.score as number).toFixed(2) : "?";
  const scale =
    Number.isFinite(origin.scale ?? NaN) && origin.scale !== 1
      ? ` ×${(origin.scale as number).toFixed(2)}`
      : "";
  return `embedding ${score}${scale}`;
}
