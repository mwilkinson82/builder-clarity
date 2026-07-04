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
}

/** Where a stage-B candidate came from — the two proposal engines. */
export type AiCandidateSource = "template" | "model";

/** Which proposal engine(s) feed stage-B verification. */
export type AiProposalSource = "template" | "model" | "both";

// The sweep: same-scale symbols dominate plan sheets, but blocks get placed
// rotated, so the template rotates through a full turn at a coarse step;
// the scale band absorbs modest render-scale drift between sheets.
export const TEMPLATE_ROTATION_STEP_DEG = 30;
export const TEMPLATE_MATCH_SCALES = [0.85, 1.0, 1.15] as const;
// Recall-biased NCC floor (stage B is the precision gate). Env-tunable
// server-side via AI_TEMPLATE_MATCH_THRESHOLD, resolved with the helper
// below and handed to the client by beginAiCountScan.
export const DEFAULT_TEMPLATE_MATCH_THRESHOLD = 0.55;
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

/** Human-readable origin line for diagnostics: "template 0.78 @ 30°". */
export function describeCandidateOrigin(origin: {
  source: AiCandidateSource;
  score?: number | null;
  rotationDeg?: number | null;
  scale?: number | null;
}): string {
  if (origin.source !== "template") return "model";
  const score = Number.isFinite(origin.score ?? NaN) ? (origin.score as number).toFixed(2) : "?";
  const rotation = Number.isFinite(origin.rotationDeg ?? NaN)
    ? ` @ ${Math.round(origin.rotationDeg as number)}°`
    : "";
  const scale =
    Number.isFinite(origin.scale ?? NaN) && origin.scale !== 1
      ? ` ×${(origin.scale as number).toFixed(2)}`
      : "";
  return `template ${score}${rotation}${scale}`;
}
