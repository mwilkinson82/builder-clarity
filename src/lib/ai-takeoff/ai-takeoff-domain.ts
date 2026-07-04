// AI-assisted count domain logic (AITAKEOFF1 Phase A, hardened in AITAKEOFF2).
// Pure functions only: no Supabase, no fetch, no env reads, no DOM.
// Measurement authority never belongs to the model — everything here treats
// model output as untrusted suggestions that a human verifies at accept time.
// Coordinate transforms live in coord-transforms.ts; this module owns tile
// planning, response parsing, and proposal hygiene.

// Relative import on purpose: the smoke suite runs this module under plain
// node --experimental-strip-types, which cannot resolve the @/ alias.
import { clamp01 } from "./coord-transforms.ts";

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
// Tile size is bounded by what the vision API passes through UNRESIZED:
// ≤ ~1.15 megapixels and ≤ 1568px on the long edge. The 1400px tiles of
// AITAKEOFF2 (1.96 MP) were silently downscaled server-side to ~1072px,
// making every pixel coordinate ambiguous between two bases (the proven
// AITAKEOFF3 displacement bug). 1024×1024 = 1.05 MP stays under both caps.
export const DETECTION_TILE_PX = 1024;
export const DETECTION_TILE_OVERLAP_PX = 128;
// Model coordinates are 0–1000 normalized relative to the image the model
// actually sees — invariant to any server-side resize, so the coordinate
// basis can never silently drift again.
export const NORMALIZED_COORD_MAX = 1000;
// Below this confidence a proposal gets the warning tint and sorts last.
export const LOW_CONFIDENCE_THRESHOLD = 0.5;
// Guardrails (AITAKEOFF2 Task 2, reshaped by AITAKEOFF3): the per-sheet cap
// now brakes runaway stage-A candidate lists BEFORE they buy verification
// calls; the confidence floor gates the stage-derived confidence, not the
// model's self-reported numbers. Both env-overridable (AI_MIN_CONFIDENCE /
// AI_MAX_PROPOSALS_PER_SHEET) server-side.
export const DEFAULT_MIN_PROPOSAL_CONFIDENCE = 0.5;
export const DEFAULT_MAX_PROPOSALS_PER_SHEET = 60;
// Stage-derived confidences (AITAKEOFF3 Task 2): the model's self-reported
// confidence proved non-discriminating on dense sheets, so proposals carry
// values derived from which stage they passed instead. A coarse candidate is
// a lead, not a match; only stage-B verification makes it a ghost.
export const COARSE_CANDIDATE_CONFIDENCE = 0.5;
export const VERIFIED_PROPOSAL_CONFIDENCE = 0.9;
// Stage-B verification window: a small crop of the detection raster around
// one candidate, upscaled so the model judges a zoomed symbol instead of
// localizing on a dense sheet.
export const VERIFY_WINDOW_PX = 256;
export const VERIFY_IMAGE_PX = 768;
// Reference set caps (AITAKEOFF5 Task 1): the picked exemplar plus up to two
// harvested positives teach what the symbol IS; up to two rejection crops
// teach what it is NOT. Negatives are never manufactured — none exist until
// the user rejects something.
export const REFERENCE_MAX_POSITIVES = 3;
export const REFERENCE_MAX_NEGATIVES = 2;

/** Vision input cost estimate for one image: ~(w x h) / 750 tokens. */
export function imageTokenEstimate(widthPx: number, heightPx: number): number {
  return Math.round((Math.max(0, widthPx) * Math.max(0, heightPx)) / 750);
}
// Two detections closer than this (normalized sheet distance) are the same
// symbol; the higher-confidence one wins. This is the FLOOR — when the
// exemplar's footprint is known, the radius scales with it (AITAKEOFF5
// Task 0) so seam double-proposals and same-symbol duplicates collapse.
export const DEDUPE_RADIUS_NORMALIZED = 0.008;
// Tile overlap bounds (AITAKEOFF5 Task 0): overlap derives from the
// exemplar's measured ink footprint so a whole symbol always fits inside at
// least one tile — 128px overlap vs a ~130px brush was a coin flip at every
// seam. 1024px tiles stand (the ≤1.15MP resize cap).
export const MIN_TILE_OVERLAP_PX = 128;
export const MAX_TILE_OVERLAP_PX = 384;

/** Tile overlap for a symbol footprint (detection-raster px). */
export function overlapForFootprintPx(footprintRasterPx: number | null): number {
  if (!footprintRasterPx || !Number.isFinite(footprintRasterPx) || footprintRasterPx <= 0) {
    return DETECTION_TILE_OVERLAP_PX;
  }
  return Math.min(
    MAX_TILE_OVERLAP_PX,
    Math.max(MIN_TILE_OVERLAP_PX, Math.ceil(1.5 * footprintRasterPx)),
  );
}

/** Dedupe/exclusion radius scaled to the symbol footprint (sheet units). */
export function dedupeRadiusForFootprint(
  footprintRasterPx: number | null,
  rasterLongEdgePx: number,
): number {
  if (!footprintRasterPx || footprintRasterPx <= 0 || rasterLongEdgePx <= 0) {
    return DEDUPE_RADIUS_NORMALIZED;
  }
  return Math.max(DEDUPE_RADIUS_NORMALIZED, (0.75 * footprintRasterPx) / rasterLongEdgePx);
}

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
 * Parsed stage-A scan response: the echo line comes first — the model must
 * describe the exemplar before matching — then candidate centers, converted
 * here to tile-local pixels. Stage A is recall-biased (AITAKEOFF3 Task 1):
 * these are leads for stage-B verification, never ghosts by themselves.
 */
export interface ParsedScanResponse {
  exemplarDescription: string;
  candidates: Array<{ x: number; y: number }>;
}

/** 0–1000 normalized model coordinate → tile-local pixel (one conversion). */
export function normalizedToTileLocalPx(value: number, tileEdgePx: number): number {
  return (value / NORMALIZED_COORD_MAX) * tileEdgePx;
}

/** Tile-local pixel → 0–1000 normalized. Inverse of the above. */
export function tileLocalPxToNormalized(value: number, tileEdgePx: number): number {
  return tileEdgePx > 0 ? (value / tileEdgePx) * NORMALIZED_COORD_MAX : 0;
}

/**
 * Parse the model's strict-JSON stage-A scan object. The instruction demands
 * a bare JSON object, but responses are still untrusted text: tolerate code
 * fences and prose around the object, validate every center, and drop
 * anything outside the image. A missing echo comes back as "" so callers can
 * surface it.
 *
 * Coordinates arrive 0–1000 normalized relative to whatever image the model
 * saw (AITAKEOFF3 Task 0) and convert to tile-local pixels HERE, in exactly
 * one place, before the tileLocalToSheetPoint path. A server-side resize
 * changes nothing: normalized coordinates are invariant.
 */
export function parseScanResponse(
  text: string,
  tileWidthPx: number,
  tileHeightPx: number,
): ParsedScanResponse {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const empty: ParsedScanResponse = { exemplarDescription: "", candidates: [] };
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
  const rawCandidates = Array.isArray(raw.candidates) ? raw.candidates : [];
  const candidates: Array<{ x: number; y: number }> = [];
  for (const entry of rawCandidates) {
    if (!entry || typeof entry !== "object") continue;
    const point = entry as Record<string, unknown>;
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < 0 || x > NORMALIZED_COORD_MAX || y < 0 || y > NORMALIZED_COORD_MAX) continue;
    candidates.push({
      x: normalizedToTileLocalPx(x, tileWidthPx),
      y: normalizedToTileLocalPx(y, tileHeightPx),
    });
  }
  return { exemplarDescription, candidates };
}

// --- Stage B: zoomed verification (AITAKEOFF3 Task 2) ---
// Never ask the model for coordinates on a large image. Stage A collects
// coarse candidates; each one gets a small window cropped from the detection
// raster, upscaled, and judged on its own. The stage-B verdict is the real
// confidence, and the final point re-derives through the window's frame —
// same tested transform, smaller denominator, proportionally smaller error.

/**
 * The verification window around a candidate, on the detection raster:
 * VERIFY_WINDOW_PX square, shifted (never shrunk) at sheet edges, exactly
 * like the exemplar crop plan.
 */
export function verifyWindowRect(
  centerPx: { x: number; y: number },
  rasterWidthPx: number,
  rasterHeightPx: number,
  windowPx: number = VERIFY_WINDOW_PX,
): { left: number; top: number; width: number; height: number } {
  const rasterW = Math.max(1, Math.floor(rasterWidthPx));
  const rasterH = Math.max(1, Math.floor(rasterHeightPx));
  const width = Math.min(windowPx, rasterW);
  const height = Math.min(windowPx, rasterH);
  const clampRange = (value: number, min: number, max: number) =>
    Math.min(max, Math.max(min, value));
  return {
    left: Math.round(clampRange(centerPx.x - width / 2, 0, rasterW - width)),
    top: Math.round(clampRange(centerPx.y - height / 2, 0, rasterH - height)),
    width,
    height,
  };
}

/** The stage-B instruction: judge one zoomed crop, hallucinations die here. */
export function buildVerifyInstruction(input: {
  label: string;
  positiveCount?: number;
  negativeCount?: number;
}): string {
  const label = input.label.trim() || "the marked symbol";
  const positives = Math.max(1, input.positiveCount ?? 1);
  const negatives = Math.max(0, input.negativeCount ?? 0);
  const positiveLine =
    positives === 1
      ? `Image 1 is an exemplar: at its center is one plan symbol from a construction drawing, marked as "${label}". Surrounding linework is context, not the symbol.`
      : `Images 1-${positives} are exemplars, each showing the SAME plan symbol marked as "${label}" at its center (the first is the primary). Surrounding linework is context, not the symbol.`;
  const negativeLine =
    negatives > 0
      ? `Image${negatives === 1 ? "" : "s"} ${positives + 1}${negatives === 1 ? "" : `-${positives + negatives}`} show${negatives === 1 ? "s" : ""} similar-looking symbols the estimator REJECTED — they are NOT the target.`
      : "";
  return [
    positiveLine,
    ...(negativeLine ? [negativeLine] : []),
    "The final image is a small zoomed-in crop of a drawing, taken around one possible occurrence of that symbol.",
    "Question: does the final image contain the same symbol type, roughly centered?",
    "",
    "Respond with ONLY this JSON object — no prose, no code fences:",
    '{"match": true or false, "center": {"x": <0-1000>, "y": <0-1000>}}',
    "",
    "Hard rules:",
    '- "match" is false if the symbol is absent, only partially inside the crop, or a DIFFERENT symbol type. Same shape, same construction only.',
    '- If it looks like one of the REJECTED reference symbols, "match" is false.',
    "- Plain text labels, dimension marks, hatching, and title-block art are never a match.",
    '- "center" is the center of the matched symbol, normalized 0-1000 relative to the FINAL image (0 is its left/top edge, 1000 its right/bottom edge). Decimals are allowed. Never answer in pixels.',
    '- Omit "center" when "match" is false.',
  ].join("\n");
}

/**
 * Parsed stage-B verdict. Anything but a literal `match: true` is a
 * rejection — malformed JSON, prose, hedging all fail closed. A confirmed
 * match whose center is missing or out of range still verifies with
 * `center: null`; the caller falls back to the stage-A candidate point.
 */
export interface ParsedVerifyResponse {
  match: boolean;
  /** Verified symbol center in window-local pixels, when the model gave one. */
  center: { x: number; y: number } | null;
}

export function parseVerifyResponse(
  text: string,
  windowWidthPx: number,
  windowHeightPx: number,
): ParsedVerifyResponse {
  const rejected: ParsedVerifyResponse = { match: false, center: null };
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return rejected;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return rejected;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return rejected;
  const raw = parsed as Record<string, unknown>;
  if (raw.match !== true) return rejected;
  const center =
    raw.center && typeof raw.center === "object" && !Array.isArray(raw.center)
      ? (raw.center as Record<string, unknown>)
      : null;
  const x = Number(center?.x);
  const y = Number(center?.y);
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    x < 0 ||
    x > NORMALIZED_COORD_MAX ||
    y < 0 ||
    y > NORMALIZED_COORD_MAX
  ) {
    return { match: true, center: null };
  }
  return {
    match: true,
    center: {
      x: normalizedToTileLocalPx(x, windowWidthPx),
      y: normalizedToTileLocalPx(y, windowHeightPx),
    },
  };
}

// --- Ink-centroid snap (AITAKEOFF4 Task 1) ---
// Verified ghosts land on-symbol but off-center: after a match, the final
// point snaps deterministically — no extra model call — to the centroid of
// the connected dark-pixel blob nearest the stage-B center. Conservative on
// purpose: anything that doesn't look like an isolated symbol (too small =
// dust, too large = fused linework) falls back to the stage-B center.

/** A pixel this dark (simple RGB average) counts as ink on white paper. */
export const INK_LUMINANCE_THRESHOLD = 160;
/** Only blobs with a pixel within this radius of the center are considered. */
export const SNAP_SEARCH_RADIUS_PX = 40;
/** A blob spanning more than this on either axis is linework, not a symbol. */
export const SNAP_MAX_COMPONENT_EDGE_PX = 160;
/** Blobs smaller than this are dust/noise, never a symbol. */
export const SNAP_MIN_COMPONENT_PIXELS = 12;

/** Bit-packed dark-pixel mask of a verification window (row-major). */
export interface InkMask {
  width: number;
  height: number;
  bits: Uint8Array;
}

/** Threshold raw RGBA pixels (canvas ImageData layout) into an ink mask. */
export function inkMaskFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  threshold: number = INK_LUMINANCE_THRESHOLD,
): InkMask {
  const pixelCount = Math.max(0, width) * Math.max(0, height);
  const bits = new Uint8Array(Math.ceil(pixelCount / 8));
  for (let index = 0; index < pixelCount; index += 1) {
    const offset = index * 4;
    const luminance = (rgba[offset] + rgba[offset + 1] + rgba[offset + 2]) / 3;
    if (luminance < threshold) bits[index >> 3] |= 1 << (index & 7);
  }
  return { width, height, bits };
}

export function inkMaskGet(mask: InkMask, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return false;
  const index = y * mask.width + x;
  return (mask.bits[index >> 3] & (1 << (index & 7))) !== 0;
}

/** Transport encoding: bits only — width/height travel beside it. */
export function inkMaskToBase64(mask: InkMask): string {
  let binary = "";
  const CHUNK = 8192;
  for (let offset = 0; offset < mask.bits.length; offset += CHUNK) {
    binary += String.fromCharCode(...mask.bits.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function inkMaskFromBase64(base64: string, width: number, height: number): InkMask | null {
  const expectedBytes = Math.ceil((Math.max(0, width) * Math.max(0, height)) / 8);
  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    return null;
  }
  if (binary.length !== expectedBytes) return null;
  const bits = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bits[index] = binary.charCodeAt(index);
  }
  return { width, height, bits };
}

/** A connected dark-pixel blob near a probe point. */
export interface InkComponent {
  /** Continuous (pixel-center) centroid of the whole component. */
  centroid: { x: number; y: number };
  bboxWidthPx: number;
  bboxHeightPx: number;
  pixelCount: number;
  /** Distance from the probe center to the component's nearest pixel. */
  nearestDistance: number;
}

/**
 * The connected dark-pixel component nearest the center, searched within a
 * radius. Components smaller than minComponentPixels (dust) or spanning more
 * than maxComponentEdgePx (fused linework) are skipped and the next-nearest
 * considered. The component itself may extend past the radius — centroid and
 * bbox cover the WHOLE blob.
 */
export function nearestInkComponent(
  mask: InkMask,
  center: { x: number; y: number },
  options: {
    searchRadiusPx?: number;
    maxComponentEdgePx?: number;
    minComponentPixels?: number;
  } = {},
): InkComponent | null {
  const radius = options.searchRadiusPx ?? SNAP_SEARCH_RADIUS_PX;
  const maxEdge = options.maxComponentEdgePx ?? SNAP_MAX_COMPONENT_EDGE_PX;
  const minPixels = options.minComponentPixels ?? SNAP_MIN_COMPONENT_PIXELS;
  const { width, height } = mask;
  if (width <= 0 || height <= 0) return null;

  const visited = new Uint8Array(width * height);
  let best: InkComponent | null = null;

  const x0 = Math.max(0, Math.floor(center.x - radius));
  const x1 = Math.min(width - 1, Math.ceil(center.x + radius));
  const y0 = Math.max(0, Math.floor(center.y - radius));
  const y1 = Math.min(height - 1, Math.ceil(center.y + radius));

  for (let seedY = y0; seedY <= y1; seedY += 1) {
    for (let seedX = x0; seedX <= x1; seedX += 1) {
      if (visited[seedY * width + seedX]) continue;
      if (Math.hypot(seedX - center.x, seedY - center.y) > radius) continue;
      if (!inkMaskGet(mask, seedX, seedY)) continue;
      // Flood-fill this component (4-connected) across the whole mask.
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      let minX = seedX;
      let maxX = seedX;
      let minY = seedY;
      let maxY = seedY;
      let nearestDistance = Number.POSITIVE_INFINITY;
      const stack: number[] = [seedY * width + seedX];
      visited[seedY * width + seedX] = 1;
      while (stack.length > 0) {
        const index = stack.pop()!;
        const px = index % width;
        const py = (index - px) / width;
        sumX += px;
        sumY += py;
        count += 1;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
        const distance = Math.hypot(px - center.x, py - center.y);
        if (distance < nearestDistance) nearestDistance = distance;
        const neighbors = [
          px > 0 ? index - 1 : -1,
          px < width - 1 ? index + 1 : -1,
          py > 0 ? index - width : -1,
          py < height - 1 ? index + width : -1,
        ];
        for (const neighbor of neighbors) {
          if (neighbor < 0 || visited[neighbor]) continue;
          const nx = neighbor % width;
          const ny = (neighbor - nx) / width;
          if (!inkMaskGet(mask, nx, ny)) continue;
          visited[neighbor] = 1;
          stack.push(neighbor);
        }
      }
      if (count < minPixels) continue;
      if (maxX - minX > maxEdge || maxY - minY > maxEdge) continue;
      if (nearestDistance > radius) continue;
      if (!best || nearestDistance < best.nearestDistance) {
        // +0.5: a pixel at index (x, y) is CENTERED at (x+0.5, y+0.5) in the
        // continuous window coordinates the frame transform expects — without
        // it every centroid lands a systematic half pixel up-left.
        best = {
          centroid: { x: sumX / count + 0.5, y: sumY / count + 0.5 },
          bboxWidthPx: maxX - minX + 1,
          bboxHeightPx: maxY - minY + 1,
          pixelCount: count,
          nearestDistance,
        };
      }
    }
  }
  return best;
}

/**
 * Snap a stage-B center onto the symbol it verified: centroid of the
 * connected dark-pixel component nearest the center. Returns null (caller
 * keeps the stage-B center) when nothing nearby looks like a symbol.
 */
export function snapToInkCentroid(
  mask: InkMask,
  center: { x: number; y: number },
  options: {
    searchRadiusPx?: number;
    maxComponentEdgePx?: number;
    minComponentPixels?: number;
  } = {},
): { x: number; y: number } | null {
  const component = nearestInkComponent(mask, center, options);
  return component ? { x: component.centroid.x, y: component.centroid.y } : null;
}

/**
 * Measure the exemplar symbol's ink footprint (longest bbox edge, mask px):
 * the component under/nearest the marker, with the fused-linework cap
 * lifted — oversized results are handled by the overlap clamp instead.
 */
export function measureInkFootprintPx(
  mask: InkMask,
  center: { x: number; y: number },
): number | null {
  const component = nearestInkComponent(mask, center, {
    maxComponentEdgePx: Number.POSITIVE_INFINITY,
  });
  return component ? Math.max(component.bboxWidthPx, component.bboxHeightPx) : null;
}

// --- Token-implied resize check (AITAKEOFF3 Task 3, isolated in AITAKEOFF4
// Task 2) ---
// Vision input costs roughly (width × height) / 750 tokens. The exemplar
// image and the prompt text ride along in every call, so the TILE's own
// perceived size is inputTokens minus those — converting the raw total made
// every healthy tile read oversized and drowned the signal. A tile whose
// isolated share comes in well below its own cost means the API downscaled
// it before the model saw it — the exact regression Task 0 killed.

/** Fixed allowance for the instruction text riding along with the images. */
export const PROMPT_TOKEN_ALLOWANCE = 350;
/** Tile-implied tokens below this fraction of the expected cost flag. */
export const TILE_TOKEN_RESIZE_SLACK = 0.85;

export interface TileTokenCheck {
  inputTokens: number;
  expectedTileTokens: number;
  /** Estimated tokens of ALL reference crops (positives + negatives). */
  referenceTokens: number;
  promptAllowance: number;
  /** Input tokens attributable to the tile alone. */
  tileImpliedTokens: number;
  /** The tile's perceived size, isolated from references + prompt. */
  tileImpliedMegapixels: number;
  tileMegapixels: number;
  suspectedResize: boolean;
}

export function tileTokenCheck(
  inputTokens: number,
  tileWidthPx: number,
  tileHeightPx: number,
  referenceTokens = 0,
): TileTokenCheck {
  const tilePixels = Math.max(0, tileWidthPx) * Math.max(0, tileHeightPx);
  const expectedTileTokens = Math.round(tilePixels / 750);
  const tileImpliedTokens = Math.max(
    0,
    Math.round(inputTokens - Math.max(0, referenceTokens) - PROMPT_TOKEN_ALLOWANCE),
  );
  const round2 = (value: number) => Math.round(value * 100) / 100;
  return {
    inputTokens,
    expectedTileTokens,
    referenceTokens: Math.max(0, referenceTokens),
    promptAllowance: PROMPT_TOKEN_ALLOWANCE,
    tileImpliedTokens,
    tileImpliedMegapixels: round2((tileImpliedTokens * 750) / 1_000_000),
    tileMegapixels: round2(tilePixels / 1_000_000),
    suspectedResize:
      inputTokens > 0 && tileImpliedTokens < expectedTileTokens * TILE_TOKEN_RESIZE_SLACK,
  };
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
 * The stage-A per-tile instruction. The echo requirement comes first: the
 * model must describe the exemplar before it may match anything — a
 * corrupted crop announces itself.
 *
 * AITAKEOFF3: recall over precision. The model classifies crops well but
 * localizes poorly on dense sheets, so stage A only collects candidate
 * centers — every one is re-judged on a zoomed crop in stage B, where
 * hallucinations die. Coordinates are 0–1000 normalized relative to the
 * image the model SEES and the prompt never declares pixel dimensions, so a
 * server-side resize can never put the response in a different basis than
 * the tile we sliced (Task 0).
 */
export function buildScanInstruction(input: {
  label: string;
  positiveCount?: number;
  negativeCount?: number;
}): string {
  const label = input.label.trim() || "the marked symbol";
  const positives = Math.max(1, input.positiveCount ?? 1);
  const negatives = Math.max(0, input.negativeCount ?? 0);
  const positiveLine =
    positives === 1
      ? `The first image is a cropped region of a construction drawing. At its center is one plan symbol the estimator marked as "${label}". Surrounding linework is context, not the symbol.`
      : `Images 1-${positives} are cropped regions of a construction drawing, each showing the SAME plan symbol the estimator marked as "${label}" at its center (the first is the primary exemplar). Surrounding linework is context, not the symbol.`;
  const negativeLine =
    negatives > 0
      ? `Image${negatives === 1 ? "" : "s"} ${positives + 1}${negatives === 1 ? "" : `-${positives + negatives}`} show${negatives === 1 ? "s" : ""} similar-looking symbols the estimator REJECTED — they are NOT the target. Never list a location that looks like these.`
      : "";
  return [
    positiveLine,
    ...(negativeLine ? [negativeLine] : []),
    "The final image is a region of the same drawing set.",
    "Task: list EVERY location in the final image that might be the same symbol type. This is a coarse first pass — each location you list is verified afterward on a zoomed-in crop, so err toward including uncertain ones.",
    "",
    "Respond with ONLY this JSON object — no prose, no code fences:",
    '{"exemplar_description": "<one line describing the symbol at the center of the first image>", "candidates": [{"x": <center x>, "y": <center y>}]}',
    "",
    "Hard rules:",
    "- Write exemplar_description FIRST, from the first image alone, before listing candidates.",
    "- Each candidate is the CENTER of one possible occurrence, normalized 0-1000 relative to the FINAL image: 0 is its left/top edge, 1000 is its right/bottom edge. Decimals are allowed. Never answer in pixels.",
    "- Err toward including uncertain candidates — a later step rejects them safely. Plain text labels, dimension marks, and title-block art are still never candidates.",
    '- An empty "candidates" list is a correct and expected answer when nothing resembles the symbol.',
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
