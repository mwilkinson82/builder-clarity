// Magnetic ink-snap for smart-assist tracing (SMARTTRACE Slice 1).
//
// Given the sheet's grayscale raster and a cursor point, find the nearest
// SIGNIFICANT straight line — a wall face — and snap the cursor onto it,
// returning the line's direction so the linear/area tracing tools can follow it.
//
// Grounded in a real-ink probe of A-100's masonry wall: the wall face was the
// longest UNBROKEN ink run in its neighborhood by ~7× (1,580px vs ~220px),
// while the hatch fill is short diagonal strokes and the dimension line is
// chopped at every tick mark. So the discriminator that separates a wall from
// its neighbors is simple and robust: the longest continuous ink run along a
// candidate line. Walls clear the bar; hatch and ticked dimension lines do not.
//
// Pure and deterministic on purpose — no canvas, no DOM — so it unit-tests
// headlessly against synthetic rasters that encode exactly those three cases
// (long wall, ticked dimension, short hatch). Integration (reading the sheet
// raster, wiring into the linear/area tools) lands in a later slice.

export interface InkPoint {
  x: number;
  y: number;
}

export interface InkSnapOptions {
  /** Half-size of the search window around the cursor, in px. */
  searchRadiusPx: number;
  /** Grayscale value at/below which a pixel counts as ink (0=black … 255=white). */
  inkThreshold: number;
  /**
   * A candidate line must have a continuous ink run at least this long to count
   * as a wall. This is the wall-vs-noise gate: it rejects short hatch strokes
   * and dimension lines (which are chopped into short segments by their ticks).
   */
  minRunPx: number;
  /** Angle sampling step in degrees. Finer = more accurate direction, slower. */
  angleStepDeg: number;
  /** Perpendicular-offset sampling step in px. */
  offsetStepPx: number;
  /**
   * Consecutive non-ink px tolerated inside one run (bridges anti-alias gaps).
   * Kept small so a dimension line's tick gaps still break its run.
   */
  gapTolerancePx: number;
}

export const DEFAULT_INK_SNAP_OPTIONS: InkSnapOptions = {
  searchRadiusPx: 24,
  inkThreshold: 110, // matches the threshold used in the real-ink probe
  minRunPx: 40,
  angleStepDeg: 3,
  offsetStepPx: 1,
  gapTolerancePx: 2,
};

export interface InkSnapResult {
  /** The cursor projected onto the detected line (the snap target). */
  point: InkPoint;
  /** Detected line direction, degrees in [0, 180). */
  angleDeg: number;
  /** Longest continuous ink run found along the line (confidence signal). */
  runLengthPx: number;
  /** Perpendicular distance from the original cursor to the line, px. */
  distancePx: number;
}

export interface GrayRaster {
  /** One byte per pixel, row-major, 0=black … 255=white. */
  gray: Uint8Array | Uint8ClampedArray | number[];
  width: number;
  height: number;
}

function isInk(r: GrayRaster, x: number, y: number, threshold: number): boolean {
  const xi = Math.round(x);
  const yi = Math.round(y);
  if (xi < 0 || yi < 0 || xi >= r.width || yi >= r.height) return false;
  return r.gray[yi * r.width + xi] <= threshold;
}

/**
 * Longest continuous ink run along the line through (cx,cy) in unit direction
 * (dx,dy), scanned ±halfLen either way. Gaps up to `gapTol` are bridged (so
 * anti-aliasing doesn't split a solid line); a larger gap — e.g. a dimension
 * tick — ends the run. Returned length is in scan steps (≈ px).
 */
export function measureLongestRun(
  r: GrayRaster,
  cx: number,
  cy: number,
  dx: number,
  dy: number,
  halfLen: number,
  threshold: number,
  gapTol: number,
): number {
  let best = 0;
  let run = 0;
  let gap = 0;
  for (let t = -halfLen; t <= halfLen; t += 1) {
    if (isInk(r, cx + dx * t, cy + dy * t, threshold)) {
      run += gap + 1; // absorb any bridged gap, then this ink step
      gap = 0;
      if (run > best) best = run;
    } else {
      gap += 1;
      if (gap > gapTol) {
        run = 0;
        gap = 0;
      }
    }
  }
  return best;
}

/**
 * Snap `cursor` onto the nearest significant straight line in the raster.
 *
 * Sweeps candidate line directions and perpendicular offsets around the cursor;
 * a line qualifies only if its longest continuous ink run clears `minRunPx`
 * (the wall gate). Among qualifying lines it picks the one nearest the cursor
 * (tie broken by the longer run), and returns the perpendicular foot — the
 * point on that line closest to the cursor — plus the line's angle. Returns
 * null when nothing wall-like sits within the search window.
 */
export function snapToInkLine(
  raster: GrayRaster,
  cursor: InkPoint,
  options: InkSnapOptions = DEFAULT_INK_SNAP_OPTIONS,
): InkSnapResult | null {
  const {
    searchRadiusPx: R,
    inkThreshold,
    minRunPx,
    angleStepDeg,
    offsetStepPx,
    gapTolerancePx,
  } = options;
  const halfLen = R;

  let best: { dist: number; run: number; angleDeg: number; footX: number; footY: number } | null =
    null;

  for (let a = 0; a < 180; a += angleStepDeg) {
    const rad = (a * Math.PI) / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    // Perpendicular to the line direction — offsets slide the line off the cursor.
    const nx = -dy;
    const ny = dx;
    for (let o = -R; o <= R; o += offsetStepPx) {
      const px = cursor.x + nx * o;
      const py = cursor.y + ny * o;
      const run = measureLongestRun(raster, px, py, dx, dy, halfLen, inkThreshold, gapTolerancePx);
      if (run < minRunPx) continue; // not wall-like — hatch or a ticked line
      const dist = Math.abs(o); // (px,py) is the perpendicular foot, so |o| is the distance
      if (
        !best ||
        dist < best.dist - 0.5 ||
        (Math.abs(dist - best.dist) <= 0.5 && run > best.run)
      ) {
        best = { dist, run, angleDeg: a, footX: px, footY: py };
      }
    }
  }

  if (!best) return null;
  return {
    point: { x: best.footX, y: best.footY },
    angleDeg: best.angleDeg,
    runLengthPx: best.run,
    distancePx: best.dist,
  };
}
