// AI-assisted count domain logic (AITAKEOFF1 Phase A).
// Pure functions only: no Supabase, no fetch, no env reads, no DOM.
// Measurement authority never belongs to the model — everything here treats
// model output as untrusted suggestions that a human verifies at accept time.

export type SheetPoint = { x: number; y: number };

/** A tile of the sheet rendered at detection resolution, in detection pixels. */
export interface DetectionTileRect {
  index: number;
  left: number;
  top: number;
  width: number;
  height: number;
}

/** A raw model match inside one tile, in tile pixel coordinates. */
export interface TileCountCandidate {
  x: number;
  y: number;
  confidence: number;
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
// Exemplar crop box (detection pixels) around the human-placed count marker.
export const EXEMPLAR_CROP_PX = 180;
// Below this confidence a proposal gets the warning tint and sorts last.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
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

/** Map a candidate from tile pixel coordinates to normalized sheet coordinates. */
export function tileCandidateToSheet(
  candidate: TileCountCandidate,
  tile: Pick<DetectionTileRect, "left" | "top">,
  sheetWidthPx: number,
  sheetHeightPx: number,
): AiCountCandidate {
  const x = (tile.left + candidate.x) / Math.max(1, sheetWidthPx);
  const y = (tile.top + candidate.y) / Math.max(1, sheetHeightPx);
  return {
    x: clamp01(x),
    y: clamp01(y),
    confidence: clamp01(candidate.confidence),
  };
}

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Parse the model's strict-JSON candidate list. The instruction demands a
 * bare JSON array, but responses are still untrusted text: tolerate code
 * fences and prose around the array, validate every entry, and drop anything
 * outside the tile. Returns [] when no valid array is present.
 */
export function parseTileCandidates(
  text: string,
  tileWidthPx: number,
  tileHeightPx: number,
): TileCountCandidate[] {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const candidates: TileCountCandidate[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const raw = entry as Record<string, unknown>;
    const x = Number(raw.x);
    const y = Number(raw.y);
    const confidence = Number(raw.confidence);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || y < 0 || x > tileWidthPx || y > tileHeightPx) continue;
    candidates.push({
      x,
      y,
      confidence: Number.isFinite(confidence) ? clamp01(confidence) : 0,
    });
  }
  return candidates;
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

/** The tight per-tile instruction sent with the exemplar crop and tile image. */
export function buildScanInstruction(input: {
  label: string;
  tileWidthPx: number;
  tileHeightPx: number;
}): string {
  const label = input.label.trim() || "the marked symbol";
  return [
    `The first image is a cropped exemplar of one plan symbol the estimator marked: "${label}".`,
    `The second image is a ${input.tileWidthPx}x${input.tileHeightPx} pixel region of the same construction drawing.`,
    "Find every occurrence of the same symbol in the second image.",
    "Respond with ONLY a JSON array, no prose, no code fences. Each element:",
    '{"x": <center x in pixels of the second image>, "y": <center y in pixels>, "confidence": <0 to 1>}',
    "Rules: report visually matching symbols only; ignore text labels, dimension marks, and different symbol types.",
    "If there are no matches, respond with [].",
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
