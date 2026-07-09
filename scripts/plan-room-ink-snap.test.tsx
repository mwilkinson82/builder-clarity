import { describe, it, expect } from "vitest";
import {
  snapToInkLine,
  measureLongestRun,
  DEFAULT_INK_SNAP_OPTIONS,
  type GrayRaster,
} from "../src/lib/plan-room-ink-snap";

// --- synthetic raster helpers (white ground = 255, ink = 0) ---
function blank(width: number, height: number): GrayRaster {
  return { gray: new Uint8Array(width * height).fill(255), width, height };
}
function hLine(r: GrayRaster, y: number, x0: number, x1: number, gapEvery = 0, gapWidth = 0) {
  const g = r.gray as Uint8Array;
  for (let x = x0; x <= x1; x++) {
    if (gapEvery && x % gapEvery < gapWidth) continue; // tick gaps (dimension line)
    g[y * r.width + x] = 0;
  }
}
function vLine(r: GrayRaster, x: number, y0: number, y1: number) {
  const g = r.gray as Uint8Array;
  for (let y = y0; y <= y1; y++) g[y * r.width + x] = 0;
}
function diagBand(r: GrayRaster, x0: number, y0: number, n: number) {
  const g = r.gray as Uint8Array;
  for (let k = 0; k < n; k++)
    for (let d = -1; d <= 1; d++) {
      const x = x0 + k + d;
      const y = y0 + k;
      if (x >= 0 && x < r.width && y >= 0 && y < r.height) g[y * r.width + x] = 0;
    }
}

describe("measureLongestRun", () => {
  it("returns the full length of a solid line and bridges tiny gaps", () => {
    const r = blank(120, 20);
    hLine(r, 10, 10, 100); // 91px solid
    const run = measureLongestRun(r, 55, 10, 1, 0, 60, 110, 2);
    expect(run).toBeGreaterThan(80);
  });

  it("stays short on a line chopped by tick gaps (a dimension line)", () => {
    const r = blank(120, 20);
    hLine(r, 10, 0, 119, 12, 4); // solid 8px, 4px gap — repeating
    const run = measureLongestRun(r, 55, 10, 1, 0, 60, 110, 2);
    expect(run).toBeLessThan(20); // never accumulates into a wall-length run
  });
});

describe("snapToInkLine — grounded in the A-100 wall probe", () => {
  it("snaps the cursor onto a long horizontal wall face", () => {
    const r = blank(200, 80);
    hLine(r, 40, 10, 190);
    const hit = snapToInkLine(r, { x: 100, y: 34 });
    expect(hit).not.toBeNull();
    expect(hit!.point.x).toBe(100); // perpendicular foot preserves the along-axis position
    expect(Math.abs(hit!.point.y - 40)).toBeLessThanOrEqual(1);
    expect(hit!.angleDeg).toBe(0);
    expect(hit!.runLengthPx).toBeGreaterThan(44); // fills the search window (well above the 40px wall gate)
    expect(Math.abs(hit!.distancePx - 6)).toBeLessThanOrEqual(1);
  });

  it("snaps a vertical wall and reports ~90°", () => {
    const r = blank(80, 200);
    vLine(r, 50, 10, 190);
    const hit = snapToInkLine(r, { x: 56, y: 100 });
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.point.x - 50)).toBeLessThanOrEqual(1);
    expect(hit!.angleDeg).toBe(90);
  });

  it("detects a diagonal wall at ~45°", () => {
    const r = blank(160, 160);
    diagBand(r, 20, 20, 110); // 45° band
    const hit = snapToInkLine(r, { x: 78, y: 82 });
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.angleDeg - 45)).toBeLessThanOrEqual(3);
  });

  it("KEY: a ticked dimension line is disqualified — the wall wins even though it is farther", () => {
    const r = blank(200, 80);
    hLine(r, 20, 0, 199, 12, 4); // dimension line at y=20 (ticked → short runs), 4px from cursor
    hLine(r, 44, 5, 195); // solid masonry wall face at y=44, 20px from cursor
    const hit = snapToInkLine(r, { x: 100, y: 24 });
    expect(hit).not.toBeNull();
    // must latch onto the WALL (y≈44), not the nearer dimension line (y=20)
    expect(Math.abs(hit!.point.y - 44)).toBeLessThanOrEqual(1);
    expect(hit!.runLengthPx).toBeGreaterThan(44); // fills the search window (well above the 40px wall gate)
  });

  it("prefers the nearest wall when two qualify", () => {
    const r = blank(200, 120);
    hLine(r, 40, 5, 195);
    hLine(r, 64, 5, 195);
    const hit = snapToInkLine(r, { x: 100, y: 58 });
    expect(hit).not.toBeNull();
    expect(Math.abs(hit!.point.y - 64)).toBeLessThanOrEqual(1); // 64 is nearer than 40
  });

  it("returns null on short hatch strokes (nothing wall-like)", () => {
    const r = blank(120, 120);
    diagBand(r, 40, 40, 14); // ~14px stroke — below minRunPx
    diagBand(r, 55, 45, 14);
    diagBand(r, 70, 50, 14);
    const hit = snapToInkLine(r, { x: 62, y: 60 });
    expect(hit).toBeNull();
  });

  it("returns null on a blank region", () => {
    const r = blank(100, 100);
    expect(snapToInkLine(r, { x: 50, y: 50 })).toBeNull();
  });

  it("does not reach past the search radius", () => {
    const r = blank(200, 200);
    hLine(r, 20, 5, 195);
    // cursor 100px below the only line, well beyond the 24px default window
    const hit = snapToInkLine(r, { x: 100, y: 120 }, DEFAULT_INK_SNAP_OPTIONS);
    expect(hit).toBeNull();
  });
});
