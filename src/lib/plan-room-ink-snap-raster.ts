// Canvas bridge for magnetic ink-snap (SMARTTRACE Slice 1 integration).
//
// The pure snap engine (plan-room-ink-snap) works on a grayscale window; this
// reads that window off the live PDF canvas around the cursor and maps the
// result back to normalized [0,1] sheet coordinates — the space the plan-room
// tracing tools use. Kept out of both the pure module (no DOM there) and the
// 1900-line viewer (no pixel plumbing there).

import { snapToInkLine, type InkPoint } from "./plan-room-ink-snap";

export interface NormPoint {
  x: number;
  y: number;
}

/**
 * Snap a normalized cursor onto the nearest wall line in the rendered sheet.
 *
 * `canvas` is the pdfjs render of the whole page (normalized [0,1] maps across
 * its full pixel size, independent of zoom/pan since zoom is a CSS transform).
 * The search radius is a fraction of the sheet so it's a fixed real-world
 * distance regardless of render resolution. Returns a normalized snapped point,
 * or null when nothing wall-like sits near the cursor (fall back to the cursor).
 * Never throws.
 */
export function inkSnapOnCanvas(
  canvas: HTMLCanvasElement,
  cursorNorm: NormPoint,
  radiusFraction = 0.006,
): NormPoint | null {
  const W = canvas.width;
  const H = canvas.height;
  if (W < 4 || H < 4) return null;

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const radiusPx = Math.min(40, Math.max(8, Math.round(W * radiusFraction)));
  const cx = cursorNorm.x * W;
  const cy = cursorNorm.y * H;

  // Window generous enough for the perpendicular offset sweep (±radius) plus the
  // along-line run scan (±radius) in any direction.
  const pad = 2 * radiusPx;
  const x0 = Math.max(0, Math.round(cx - pad));
  const y0 = Math.max(0, Math.round(cy - pad));
  const x1 = Math.min(W, Math.round(cx + pad));
  const y1 = Math.min(H, Math.round(cy + pad));
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 * radiusPx || h < 2 * radiusPx) return null; // too close to the sheet edge

  let image: ImageData;
  try {
    image = ctx.getImageData(x0, y0, w, h);
  } catch {
    return null; // tainted or unsupported canvas — degrade to no snap
  }

  const rgba = image.data;
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < gray.length; i += 1) {
    const j = i * 4;
    gray[i] = (rgba[j] + rgba[j + 1] + rgba[j + 2]) / 3;
  }

  const local: InkPoint = { x: cx - x0, y: cy - y0 };
  const result = snapToInkLine({ gray, width: w, height: h }, local, {
    searchRadiusPx: radiusPx,
    inkThreshold: 110,
    minRunPx: radiusPx, // a wall fills the window; hatch/ticked lines do not
    angleStepDeg: 3,
    offsetStepPx: 1,
    gapTolerancePx: 2,
  });
  if (!result) return null;

  return { x: (x0 + result.point.x) / W, y: (y0 + result.point.y) / H };
}
