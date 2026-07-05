// Template-match domain logic (AITAKEOFF6 Task 0).
// Pure functions only: no opencv, no DOM, no env reads — the worker and the
// node smoke share every decision made here. Classical template matching
// PROPOSES candidates deterministically (near-perfect recall on same-scale
// symbols); stage-B verification stays the precision gate, so every constant
// here is recall-biased on purpose.

// Relative import on purpose: the smoke suite runs this module under plain
// node --experimental-strip-types, which cannot resolve the @/ alias.
import { withinSheetRadius, type SheetRadius } from "../ai-takeoff-domain.ts";

/** One template-match hit, in normalized [0,1] sheet space. */
export interface TemplateMatchCandidate {
  x: number;
  y: number;
  /** Normalized cross-correlation score of the best sweep hit (0-1). */
  score: number;
  /** Rotation of the best-matching template variant, degrees clockwise. */
  rotationDeg: number;
  /** Scale of the best-matching template variant (1 = exemplar size). */
  scale: number;
  /** Which template found it: 0 = the exemplar, 1+ = harvested positives. */
  templateIndex: number;
}

/**
 * One of the best sweep scores, threshold or not (AITAKEOFF8 Task 1): the
 * transparency record that distinguishes "threshold problem" from "matching
 * problem" the moment a sheet reports zero hits.
 */
export interface TemplateTopScore {
  x: number;
  y: number;
  score: number;
  rotationDeg: number;
  scale: number;
  templateIndex: number;
}

/** Where a stage-B candidate came from — the two proposal engines. */
export type AiCandidateSource = "template" | "model";

/** Which proposal engine(s) feed stage-B verification. */
export type AiProposalSource = "template" | "model" | "both";

// The sweep (coarse-to-fine since AITAKEOFF10 Task 3): a full flat sweep at
// 10°/7 scales would be ~7x the budget, so the coarse pass keeps the
// original 30°/3-scale grid with a recall-biased pool (threshold − margin),
// and only cells that show promise get the fine 10°/±7.5% refinement on a
// small ROI. Thin radial symbols land between 30° steps; the fine grid
// gets within 5°.
export const TEMPLATE_ROTATION_STEP_DEG = 30;
export const TEMPLATE_MATCH_SCALES = [0.85, 1.0, 1.15] as const;
export const FINE_ROTATION_STEP_DEG = 10;
export const TEMPLATE_SCALE_LADDER = [0.75, 0.85, 0.925, 1.0, 1.075, 1.15, 1.3] as const;
// Coarse pool margin: candidates scoring within this of the threshold get
// refined — the refinement decides, at the REAL threshold.
export const LADDER_RECALL_MARGIN = 0.15;
// Secondary templates (harvested accepted marks) are unvetted crops — they
// earn a slightly higher floor than the estimator's own exemplar.
// Calibrated on the variant fixture.
export const SECONDARY_TEMPLATE_FLOOR = 0.68;

/** Fine-scale neighbors of a coarse scale on the ladder (inclusive). */
export function ladderNeighborsFor(scale: number): number[] {
  const ladder = TEMPLATE_SCALE_LADDER as readonly number[];
  const index = ladder.findIndex((entry) => Math.abs(entry - scale) < 1e-9);
  if (index < 0) return [scale];
  return ladder.slice(Math.max(0, index - 1), Math.min(ladder.length, index + 2)) as number[];
}

/** Fine rotation neighbors of a coarse angle: ±FINE step, normalized 0-360. */
export function fineRotationsFor(coarseDeg: number): number[] {
  return [-FINE_ROTATION_STEP_DEG, 0, FINE_ROTATION_STEP_DEG].map(
    (delta) => (coarseDeg + delta + 360) % 360,
  );
}
// Recall-biased score floor for MASKED correlation (AITAKEOFF8, recall-
// biased further in AITAKEOFF9 Task 2 after a heavily-fused A-100 brush
// missed at 0.75). Calibrated on the dense fixtures: clean matches
// 0.87-1.0, fused instances (rail through the symbol + hatching over two
// arms) 0.66-0.82 depending on raster scale, hatching ~0.37. 0.62 keeps
// every legitimate fused case; a solid ink blob (~0.70) now proposes and
// dies in stage B — a lower floor costs pennies in verify calls, never
// accuracy. Env-tunable via AI_TEMPLATE_MATCH_THRESHOLD, resolved below,
// handed out by beginAiCountScan, and recorded in the per-sheet funnel.
export const DEFAULT_TEMPLATE_MATCH_THRESHOLD = 0.62;
// The unmasked CCOEFF fallback keeps the AITAKEOFF6 floor — it only runs
// when the mask is degenerate (below the coverage floor, or masking is
// switched off for the fixture comparison).
export const UNMASKED_TEMPLATE_MATCH_THRESHOLD = 0.55;
// A mask covering less than this fraction of the tightened template crop is
// degenerate — a nearly-empty mask matches everything — so the sweep falls
// back to unmasked matching and says so in the funnel.
export const MIN_MASK_COVERAGE = 0.03;
// Top-of-sweep transparency (AITAKEOFF8 Task 1): the best N sweep scores are
// always reported, threshold or not — a zero-hit sheet must never be opaque.
export const TEMPLATE_TOP_SCORE_COUNT = 5;
// Matching runs on a downscaled copy of the detection raster so the sweep
// stays inside the performance budget; hits map back through the one tested
// tile transform (tileFrameFor semantics on the whole downscaled raster).
export const TEMPLATE_MATCH_MAX_LONG_EDGE_PX = 2000;
// Template crop margin around the measured ink footprint: enough context to
// keep the correlation discriminating, little enough that neighbors' linework
// stays out of the template.
export const TEMPLATE_MARGIN_RATIO = 1.4;
export const TEMPLATE_MIN_SIDE_PX = 24;
export const TEMPLATE_MAX_SIDE_PX = 320;

/** Rotation sweep angles: 0° up to (but never including) a full turn. */
export function planRotationSweep(stepDeg: number = TEMPLATE_ROTATION_STEP_DEG): number[] {
  const step = Number.isFinite(stepDeg) && stepDeg > 0 ? Math.min(360, stepDeg) : 360;
  const angles: number[] = [];
  for (let angle = 0; angle < 360; angle += step) angles.push(angle);
  return angles;
}

/** AI_TEMPLATE_MATCH_THRESHOLD env value → usable threshold, else default. */
export function resolveTemplateMatchThreshold(raw: string | undefined): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value < 1
    ? value
    : DEFAULT_TEMPLATE_MATCH_THRESHOLD;
}

/** AI_PROPOSAL_SOURCE env value → proposal source, defaulting to both. */
export function resolveProposalSource(raw: string | undefined): AiProposalSource {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "template" || value === "model" ? value : "both";
}

/**
 * Downscale factor that brings the detection raster to the matching
 * resolution (≤ TEMPLATE_MATCH_MAX_LONG_EDGE_PX on the long edge). Never
 * upscales: a raster already small enough matches at native resolution.
 */
export function matchDownscaleFor(
  rasterWidthPx: number,
  rasterHeightPx: number,
  maxLongEdgePx: number = TEMPLATE_MATCH_MAX_LONG_EDGE_PX,
): number {
  const longEdge = Math.max(1, rasterWidthPx, rasterHeightPx);
  return longEdge <= maxLongEdgePx ? 1 : maxLongEdgePx / longEdge;
}

/**
 * Square template crop around the exemplar marker, sized from the measured
 * ink footprint, shifted (never shrunk) at raster edges — the same window
 * semantics verifyWindowRect uses.
 */
export function templateCropRect(
  centerPx: { x: number; y: number },
  footprintPx: number,
  rasterWidthPx: number,
  rasterHeightPx: number,
): { left: number; top: number; width: number; height: number } {
  const rasterW = Math.max(1, Math.floor(rasterWidthPx));
  const rasterH = Math.max(1, Math.floor(rasterHeightPx));
  const wanted = Math.round(Math.max(0, footprintPx) * TEMPLATE_MARGIN_RATIO);
  const side = Math.min(
    Math.min(rasterW, rasterH),
    Math.max(TEMPLATE_MIN_SIDE_PX, Math.min(TEMPLATE_MAX_SIDE_PX, wanted)),
  );
  const clampRange = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  return {
    left: Math.round(clampRange(centerPx.x - side / 2, 0, rasterW - side)),
    top: Math.round(clampRange(centerPx.y - side / 2, 0, rasterH - side)),
    width: side,
    height: side,
  };
}

/**
 * Non-max suppression: highest score wins within the radius (the canonical
 * footprint-derived SheetRadius — AITAKEOFF7 made raw numbers a tsc error
 * here after raster pixels leaked into sheet space in production). Same
 * greedy shape as dedupeCandidates, keyed on score instead of confidence so
 * sweep metadata survives.
 */
export function suppressNonMaxima<T extends { x: number; y: number; score: number }>(
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
 * Union the two proposal engines' candidates for stage-B verification:
 * template hits carry their NCC score as confidence (so the per-sheet verify
 * cap ranks them by score), model candidates keep their coarse placeholder.
 * Dedupe by the footprint radius — when both engines propose the same
 * symbol, the higher confidence entry survives and verification is bought
 * once. Every candidate keeps its source for diagnostics.
 */
export function unionProposalCandidates(
  templateHits: TemplateMatchCandidate[],
  modelCandidates: Array<{ x: number; y: number; confidence: number }>,
  radius: SheetRadius,
): Array<{
  x: number;
  y: number;
  confidence: number;
  source: AiCandidateSource;
  templateHit: TemplateMatchCandidate | null;
}> {
  const merged = [
    ...templateHits.map((hit) => ({
      x: hit.x,
      y: hit.y,
      confidence: hit.score,
      source: "template" as const,
      templateHit: hit,
      score: hit.score,
    })),
    ...modelCandidates.map((candidate) => ({
      x: candidate.x,
      y: candidate.y,
      confidence: candidate.confidence,
      source: "model" as const,
      templateHit: null,
      score: candidate.confidence,
    })),
  ];
  return suppressNonMaxima(merged, radius).map(({ score: _score, ...candidate }) => candidate);
}

/** Human-readable origin: "template 0.78 @ 30°" / "template#2 0.83" / "model". */
export function describeCandidateOrigin(origin: {
  source: AiCandidateSource;
  score?: number | null;
  rotationDeg?: number | null;
  scale?: number | null;
  templateIndex?: number | null;
}): string {
  if (origin.source !== "template") return "model";
  const index =
    Number.isFinite(origin.templateIndex ?? NaN) && (origin.templateIndex as number) > 0
      ? `#${origin.templateIndex}`
      : "";
  const score = Number.isFinite(origin.score ?? NaN) ? (origin.score as number).toFixed(2) : "?";
  const rotation = Number.isFinite(origin.rotationDeg ?? NaN)
    ? ` @ ${Math.round(origin.rotationDeg as number)}°`
    : "";
  const scale =
    Number.isFinite(origin.scale ?? NaN) && origin.scale !== 1
      ? ` ×${(origin.scale as number).toFixed(2)}`
      : "";
  return `template${index} ${score}${rotation}${scale}`;
}
