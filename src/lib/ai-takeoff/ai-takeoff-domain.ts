// AI-assisted count domain logic (AITAKEOFF1 Phase A, hardened in AITAKEOFF2).
// Pure functions only: no Supabase, no fetch, no env reads, no DOM.
// Measurement authority never belongs to the model — everything here treats
// model output as untrusted suggestions that a human verifies at accept time.
// Coordinate transforms live in coord-transforms.ts; this module owns tile
// planning, response parsing, and proposal hygiene.

// Relative import on purpose: the smoke suite runs this module under plain
// node --experimental-strip-types, which cannot resolve the @/ alias.
import { bboxCenter, clamp01, type TileBoundingBox } from "./coord-transforms.ts";

export type SheetPoint = { x: number; y: number };

/** A tile of the sheet rendered at detection resolution, in detection pixels. */
export interface DetectionTileRect {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A match candidate in normalized [0,1] sheet coordinates. */
export interface AiCountCandidate {
  x: number;
  y: number;
  confidence: number;
}

export type AiProposalStatus = "pending" | "accepted" | "rejected";

/** A session-scoped ghost proposal awaiting human review. */
export interface AiCountProposal {
  id: string;
  sheetId: string;
  x: number;
  y: number;
  confidence: number;
  status: AiProposalStatus;
}

// Detection raster: the sheet's long edge renders at this many pixels before
// being sliced into tiles the model can actually read symbols on.
export const DETECTION_LONG_EDGE_PX = 3800;
export const DETECTION_TILE_PX = 1400;
export const DETECTION_TILE_OVERLAP_PX = 96;
// Below this confidence a proposal gets the warning tint and sorts last.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
// Guardrails (AITAKEOFF2 Task 2): matches under the floor never become
// ghosts; the per-sheet cap is the runaway brake. Both env-overridable
// (AI_MIN_CONFIDENCE / AI_MAX_PROPOSALS_PER_SHEET) server-side.
export const DEFAULT_MIN_PROPOSAL_CONFIDENCE = 0.5;
export const DEFAULT_MAX_PROPOSALS_PER_SHEET = 60;
// Two detections closer than this (normalized sheet distance) are the same
// symbol; the higher-confidence one wins.
export const DEDUPE_RADIUS_NORMALIZED = 0.008;

/**
 * Plan the tile grid covering a sheet rendered at detection resolution.
 * Tiles overlap so symbols on a seam appear whole in at least one tile;
 * duplicates from the overlap are collapsed later by dedupeCandidates.
 */
export function planDetectionTiles(
  sheetWidthPx: number,
  sheetHeightPx: number,
  tilePx: number = DETECTION_TILE_PX,
  overlapPx: number = DETECTION_TILE_OVERLAP_PX,
): DetectionTileRect[] {
  const width = Math.max(1, Math.floor(sheetWidthPx));
  const height = Math.max(1, Math.floor(sheetHeightPx));
  const step = Math.max(1, tilePx - overlapPx);
  const tiles: DetectionTileRect[] = [];
  let index = 0;
  for (let top = 0; top < height; top += step) {
    const tileTop = Math.min(top, Math.max(0, height - tilePx));
    for (let left = 0; left < width; left += step) {
      const tileLeft = Math.min(left, Math.max(0, width - tilePx));
      tiles.push({
        index,
        left: tileLeft,
        top: tileTop,
        width: Math.min(tilePx, width - tileLeft),
        height: Math.min(tilePx, height - tileTop),
      });
      index += 1;
      if (tileLeft + tilePx >= width) break;
    }
    if (tileTop + tilePx >= height) break;
  }
  return tiles;
}

/**
 * Parsed scan response (AITAKEOFF2): the echo line comes first — the model
 * must describe the exemplar before matching — then matches as small
 * bounding boxes in tile pixels. Centers are derived server-side.
 */
export interface ParsedScanResponse {
  exemplarDescription: string;
  matches: TileBoundingBox[];
}

/**
 * Parse the model's strict-JSON scan object. The instruction demands a bare
 * JSON object, but responses are still untrusted text: tolerate code fences
 * and prose around the object, validate every box, and drop anything outside
 * the tile or degenerate (inverted/absurdly large boxes are model confusion,
 * not matches). A missing echo comes back as "" so callers can surface it.
 */
export function parseScanResponse(
  text: string,
  tileWidthPx: number,
  tileHeightPx: number,
): ParsedScanResponse {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const empty: ParsedScanResponse = { exemplarDescription: "", matches: [] };
  if (start < 0 || end <= start) return empty;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
  const raw = parsed as Record<string, unknown>;
  const exemplarDescription =
    typeof raw.exemplar_description === "string"
      ? raw.exemplar_description.trim().slice(0, 500)
      : "";
  const rawMatches = Array.isArray(raw.matches) ? raw.matches : [];
  const matches: TileBoundingBox[] = [];
  // A match box wider/taller than half the tile is not a symbol match.
  const maxBoxEdge = Math.max(tileWidthPx, tileHeightPx) / 2;
  for (const entry of rawMatches) {
    if (!entry || typeof entry !== "object") continue;
    const box = entry as Record<string, unknown>;
    const x0 = Number(box.x0);
    const y0 = Number(box.y0);
    const x1 = Number(box.x1);
    const y1 = Number(box.y1);
    const confidence = Number(box.confidence);
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    if (x1 <= x0 || y1 <= y0) continue;
    if (x0 < 0 || y0 < 0 || x1 > tileWidthPx || y1 > tileHeightPx) continue;
    if (x1 - x0 > maxBoxEdge || y1 - y0 > maxBoxEdge) continue;
    matches.push({
      x0,
      y0,
      x1,
      y1,
      confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0,
    });
  }
  return { exemplarDescription, matches };
}

/** Centers of parsed match boxes, in tile-local pixels. */
export function matchCenters(
  matches: TileBoundingBox[],
): Array<{ x: number; y: number; confidence: number }> {
  return matches.map((box) => ({ ...bboxCenter(box), confidence: box.confidence }));
}

/** Drop candidates under the confidence floor before they become ghosts. */
export function applyConfidenceFloor<T extends { confidence: number }>(
  candidates: T[],
  minConfidence: number = DEFAULT_MIN_PROPOSAL_CONFIDENCE,
): T[] {
  const floor = clamp01(minConfidence);
  return candidates.filter((candidate) => candidate.confidence >= floor);
}

/** Runaway guard: keep at most `cap` proposals per sheet, best-confidence first. */
export function capProposalsPerSheet<T extends { confidence: number }>(
  candidates: T[],
  cap: number = DEFAULT_MAX_PROPOSALS_PER_SHEET,
): T[] {
  const limit = Math.max(1, Math.trunc(cap));
  if (candidates.length <= limit) return candidates;
  return [...candidates].sort((a, b) => b.confidence - a.confidence).slice(0, limit);
}

/**
 * Collapse duplicate detections (tile-overlap seams, repeated model output).
 * Highest confidence wins within the radius.
 */
export function dedupeCandidates(
  candidates: AiCountCandidate[],
  radius: number = DEDUPE_RADIUS_NORMALIZED,
): AiCountCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const kept: AiCountCandidate[] = [];
  for (const candidate of sorted) {
    const duplicate = kept.some(
      (existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < radius,
    );
    if (!duplicate) kept.push(candidate);
  }
  return kept;
}

/**
 * Drop candidates that sit on top of already-counted markers (including the
 * exemplar itself) — the model re-finding a symbol the human already counted
 * is noise, not a proposal.
 */
export function excludeNearExistingPoints(
  candidates: AiCountCandidate[],
  existingPoints: SheetPoint[],
  radius: number = DEDUPE_RADIUS_NORMALIZED,
): AiCountCandidate[] {
  if (existingPoints.length === 0) return candidates;
  return candidates.filter(
    (candidate) =>
      !existingPoints.some(
        (point) => Math.hypot(point.x - candidate.x, point.y - candidate.y) < radius,
      ),
  );
}

/**
 * Review order: confident proposals first in reading order (top-to-bottom,
 * then left-to-right), low-confidence proposals LAST so the human ends on
 * the ones needing the hardest look.
 */
export function sortProposalsForReview<T extends { x: number; y: number; confidence: number }>(
  proposals: T[],
  lowConfidenceThreshold: number = LOW_CONFIDENCE_THRESHOLD,
): T[] {
  const readingOrder = (a: T, b: T) => {
    // Band rows so slight y jitter doesn't zigzag the review path.
    const rowA = Math.round(a.y * 40);
    const rowB = Math.round(b.y * 40);
    if (rowA !== rowB) return rowA - rowB;
    return a.x - b.x;
  };
  const confident = proposals.filter((p) => p.confidence >= lowConfidenceThreshold);
  const risky = proposals.filter((p) => p.confidence < lowConfidenceThreshold);
  return [...confident.sort(readingOrder), ...risky.sort(readingOrder)];
}

/**
 * Proposal → marker conversion: accepting appends the proposal's point to the
 * AI count measurement's geometry. Count quantity is always the point count —
 * countable by the human eye at accept time.
 */
export function appendAcceptedPoint(
  existingPoints: SheetPoint[],
  proposal: { x: number; y: number },
): { points: SheetPoint[]; quantity: number } {
  const points = [...existingPoints, { x: clamp01(proposal.x), y: clamp01(proposal.y) }];
  return { points, quantity: points.length };
}

/**
 * The per-tile instruction (AITAKEOFF2 Task 2, hardened against eager
 * matching). The echo requirement comes first: the model must describe the
 * exemplar before it may match anything — a corrupted crop announces itself.
 */
export function buildScanInstruction(input: {
  label: string;
  tileWidthPx: number;
  tileHeightPx: number;
}): string {
  const label = input.label.trim() || "the marked symbol";
  return [
    `The first image is a cropped region of a construction drawing. At its center is one plan symbol the estimator marked as "${label}". Surrounding linework is context, not the symbol.`,
    `The second image is a ${input.tileWidthPx}x${input.tileHeightPx} pixel region of the same drawing set.`,
    "Task: find occurrences of that SAME symbol type in the second image.",
    "",
    "Respond with ONLY this JSON object — no prose, no code fences:",
    '{"exemplar_description": "<one line describing the symbol at the center of the first image>", "matches": [{"x0": <left px>, "y0": <top px>, "x1": <right px>, "y1": <bottom px>, "confidence": <0 to 1>}]}',
    "",
    "Hard rules:",
    "- Write exemplar_description FIRST, from the first image alone, before looking for matches.",
    "- A match must be the same symbol TYPE: same shape, same construction. Similar-looking but different symbols are not matches.",
    "- Empty regions, ambiguous linework, text labels, dimension marks, and title-block art are NEVER matches.",
    '- If you are not sure, leave it out. An empty "matches" list is a correct and expected answer.',
    "- Each match is a SMALL bounding box tightly around one symbol, in pixel coordinates of the second image.",
    "- Every match needs its own confidence between 0 and 1.",
  ].join("\n");
}

/** Availability state for the AI Assist panel — pure so the copy is testable. */
export type AiAssistAvailability =
  | { state: "not_configured"; message: string }
  | { state: "no_exemplar"; message: string }
  | { state: "out_of_credits"; message: string }
  | { state: "ready"; message: string };

export const AI_ASSIST_NOT_CONFIGURED_MESSAGE = "AI assist not configured";
export const AI_ASSIST_FIRST_RUN_MESSAGE =
  "Count one yourself, then let AI find the rest — you approve every match.";

export function aiAssistAvailability(input: {
  configured: boolean;
  hasExemplar: boolean;
  balanceCredits: number;
  quoteCredits: number;
}): AiAssistAvailability {
  if (!input.configured) {
    return { state: "not_configured", message: AI_ASSIST_NOT_CONFIGURED_MESSAGE };
  }
  if (!input.hasExemplar) {
    return { state: "no_exemplar", message: AI_ASSIST_FIRST_RUN_MESSAGE };
  }
  if (input.quoteCredits > input.balanceCredits) {
    return {
      state: "out_of_credits",
      message: `This scan needs ${input.quoteCredits} credit${input.quoteCredits === 1 ? "" : "s"} and your company has ${input.balanceCredits}. Buy a credit pack to continue.`,
    };
  }
  return {
    state: "ready",
    message: `Scanning uses ${input.quoteCredits} credit${input.quoteCredits === 1 ? "" : "s"} (1 per sheet).`,
  };
}
