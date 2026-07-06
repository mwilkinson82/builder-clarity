// Candidate proposal for the SERVER embedding engine (AITAKEOFF12 server path).
// Pure functions only — no DOM, no network — so the node smoke covers the whole
// proposer. Symbols are where ink is locally DENSE; we rank a coarse grid of
// windows by ink density and keep the densest few dozen. Those crops (not a
// thousand grid windows) are what get shipped to the embedding endpoint, which
// is what keeps a server-side scan cheap and fast.
//
// Relative .ts import so the smoke can run this under node --experimental-strip-types.

export interface CandidatePeak {
  /** Raster-px center of a candidate region. */
  x: number;
  y: number;
  /** Ink density in the window (0-1) — the ranking key, kept for diagnostics. */
  density: number;
}

// Cap on crops sent to the embedding API — the cost/latency lever. ~64 covers a
// dense equipment sheet's symbols while keeping the API calls bounded.
export const CANDIDATE_MAX = 64;
// Ink threshold: a pixel darker than this counts as ink.
export const CANDIDATE_INK_LEVEL = 140;
// A window with less than this ink fraction is blank linework, never a symbol.
export const CANDIDATE_MIN_DENSITY = 0.06;
// Density window ≈ the exemplar footprint; the grid stride is a third of it so a
// symbol lands near a sampled cell; NMS keeps one candidate per footprint.
export const CANDIDATE_WINDOW_RATIO = 1.0;
export const CANDIDATE_STRIDE_RATIO = 0.34;
export const CANDIDATE_NMS_RATIO = 0.8;
export const CANDIDATE_MIN_WINDOW_PX = 16;

/** Integral image of an ink mask so any box sum is O(1). Row-major, (w+1)×(h+1). */
export function inkIntegralImage(
  gray: Uint8Array | number[],
  width: number,
  height: number,
  inkLevel: number = CANDIDATE_INK_LEVEL,
): Float64Array {
  const stride = width + 1;
  const sum = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += gray[y * width + x] < inkLevel ? 1 : 0;
      sum[(y + 1) * stride + (x + 1)] = sum[y * stride + (x + 1)] + rowSum;
    }
  }
  return sum;
}

/** Ink fraction inside [x0,x1)×[y0,y1) using the integral image. */
export function boxDensity(
  integral: Float64Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const stride = width + 1;
  const cx0 = Math.max(0, Math.min(width, x0));
  const cy0 = Math.max(0, Math.min(height, y0));
  const cx1 = Math.max(0, Math.min(width, x1));
  const cy1 = Math.max(0, Math.min(height, y1));
  const area = (cx1 - cx0) * (cy1 - cy0);
  if (area <= 0) return 0;
  const ink =
    integral[cy1 * stride + cx1] -
    integral[cy0 * stride + cx1] -
    integral[cy1 * stride + cx0] +
    integral[cy0 * stride + cx0];
  return ink / area;
}

/**
 * Rank a coarse grid of footprint-sized windows by ink density, drop blank ones,
 * NMS to one-per-footprint, and return the densest up to maxCandidates. These
 * are the crops we embed.
 */
export function detectCandidatePeaks(
  gray: Uint8Array | number[],
  width: number,
  height: number,
  footprintPx: number,
  maxCandidates: number = CANDIDATE_MAX,
): CandidatePeak[] {
  const win = Math.max(CANDIDATE_MIN_WINDOW_PX, Math.round(footprintPx * CANDIDATE_WINDOW_RATIO));
  const half = Math.floor(win / 2);
  const stride = Math.max(1, Math.round(win * CANDIDATE_STRIDE_RATIO));
  const nms = Math.max(1, win * CANDIDATE_NMS_RATIO);
  const integral = inkIntegralImage(gray, width, height);

  const grid: CandidatePeak[] = [];
  for (let y = half; y <= Math.max(half, height - half); y += stride) {
    for (let x = half; x <= Math.max(half, width - half); x += stride) {
      const density = boxDensity(integral, width, height, x - half, y - half, x + half, y + half);
      if (density >= CANDIDATE_MIN_DENSITY) grid.push({ x, y, density });
    }
  }
  grid.sort((a, b) => b.density - a.density);

  const kept: CandidatePeak[] = [];
  const nmsSq = nms * nms;
  for (const peak of grid) {
    if (kept.length >= maxCandidates) break;
    if (kept.every((k) => (k.x - peak.x) ** 2 + (k.y - peak.y) ** 2 > nmsSq)) kept.push(peak);
  }
  return kept;
}
