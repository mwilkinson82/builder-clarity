// Exemplar-isolation smoke (AITAKEOFF14).
// Pins the fix for the A-100 recall collapse: the exemplar footprint must be
// the picked symbol's OWN radial extent, not the connected component's bbox —
// which swallowed the touching neighbor ("two circular brush symbols, side by
// side") and produced a weak two-symbol template (top NCC ~0.6 vs ~0.96).
// Glyphs here mirror the real A-100 brushes: filled hub + radial spokes +
// outer ring, packed close enough to touch. Run: npm run test:ai

import assert from "node:assert/strict";
import {
  annulusInkStats,
  isolateExemplarFootprintPx,
  localInkCentroid,
  symbolExtentPx,
} from "../src/lib/ai-takeoff/exemplar-isolation-domain.ts";
import { measureInkFootprintPx, type InkMask } from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";
import { templateCropRect } from "../src/lib/ai-takeoff/template-match/template-match-domain.ts";

// --- Synthetic glyph helpers (pure bit arrays, no canvas) ---

function makeMask(width: number, height: number): InkMask {
  // InkMask is BIT-PACKED (8 pixels per byte) — same layout inkMaskFromRgba
  // produces and inkMaskGet reads.
  return { width, height, bits: new Uint8Array(Math.ceil((width * height) / 8)) };
}

function setInk(mask: InkMask, x: number, y: number) {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;
  const index = y * mask.width + x;
  mask.bits[index >> 3] |= 1 << (index & 7);
}

/** Filled disk (the brush hub). */
function drawDisk(mask: InkMask, cx: number, cy: number, r: number) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      if (Math.hypot(x - cx, y - cy) <= r) setInk(mask, x, y);
    }
  }
}

/** Circle outline ~2px thick (the brush's outer ring). */
function drawRing(mask: InkMask, cx: number, cy: number, r: number) {
  for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y += 1) {
    for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x += 1) {
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r) <= 1) setInk(mask, x, y);
    }
  }
}

/** Radial spokes from hub edge to the ring (the brush bristle lines). */
function drawSpokes(mask: InkMask, cx: number, cy: number, r: number, count: number) {
  for (let s = 0; s < count; s += 1) {
    const angle = (2 * Math.PI * s) / count;
    for (let d = 4; d <= r; d += 0.5) {
      const x = Math.round(cx + d * Math.cos(angle));
      const y = Math.round(cy + d * Math.sin(angle));
      setInk(mask, x, y);
      setInk(mask, x + 1, y);
    }
  }
}

/** A brush glyph like A-100's: hub disk + 16 spokes + outer ring. */
function drawBrush(mask: InkMask, cx: number, cy: number, r: number) {
  drawDisk(mask, cx, cy, Math.max(3, Math.round(r * 0.18)));
  drawSpokes(mask, cx, cy, r, 16);
  drawRing(mask, cx, cy, r);
}

/** Horizontal ~2px line (conveyor/wall linework). */
function drawHLine(mask: InkMask, y: number, fromX: number, toX: number) {
  for (let x = fromX; x <= toX; x += 1) {
    setInk(mask, x, y);
    setInk(mask, x, y + 1);
  }
}

// --- Case 1: the killer regression — an ISOLATED brush must NOT be truncated.
// Hub → sparse spokes → dense ring: a naive valley-then-rise profile reads
// the ring as a "neighbor" and clamps inside the symbol. The angular-spread
// extent must reach the ring.
{
  const mask = makeMask(400, 400);
  drawBrush(mask, 200, 200, 55);
  const measured = measureInkFootprintPx(mask, { x: 200, y: 200 });
  assert.ok(
    measured !== null && measured >= 105 && measured <= 120,
    `isolated measured ${measured}`,
  );
  const iso = isolateExemplarFootprintPx(mask, { x: 200, y: 200 }, measured as number);
  assert.ok(
    iso.extentPx !== null && iso.extentPx >= 52 && iso.extentPx <= 62,
    `extent reaches the ring: ${iso.extentPx}`,
  );
  assert.ok(
    iso.footprintPx >= (measured as number) * 0.95,
    `isolated brush keeps its full footprint (${iso.footprintPx} vs measured ${measured})`,
  );
}

// --- Case 2: the A-100 failure — a TOUCHING pair (one connected component).
// The component bbox spans both brushes; the isolated footprint must cover
// ONE brush, and the template crop it produces must not reach the neighbor's
// hub.
{
  const mask = makeMask(500, 400);
  const hubA = { x: 190, y: 200 };
  const hubB = { x: 295, y: 200 }; // 105 apart, rings r=55 → tips overlap
  drawBrush(mask, hubA.x, hubA.y, 55);
  drawBrush(mask, hubB.x, hubB.y, 55);
  const measured = measureInkFootprintPx(mask, hubA);
  assert.ok(measured !== null && measured >= 180, `pair component spans both: ${measured}`);
  const iso = isolateExemplarFootprintPx(mask, hubA, measured as number);
  assert.ok(iso.clamped, "touching pair clamps");
  assert.ok(
    iso.footprintPx >= 100 && iso.footprintPx <= 135,
    `pair isolates to one brush diameter (~110): ${iso.footprintPx}`,
  );
  const crop = templateCropRect(hubA, iso.footprintPx, mask.width, mask.height);
  const cropRight = crop.left + crop.width;
  assert.ok(
    cropRight < hubB.x - 8,
    `template crop ends before the neighbor's hub (crop right ${cropRight}, neighbor hub ${hubB.x})`,
  );
}

// --- Case 3: pair FUSED by linework through both hubs (the case the
// component measure can never split — its cap was lifted for exactly this).
{
  const mask = makeMask(500, 400);
  const hubA = { x: 190, y: 200 };
  const hubB = { x: 295, y: 200 };
  drawBrush(mask, hubA.x, hubA.y, 55);
  drawBrush(mask, hubB.x, hubB.y, 55);
  drawHLine(mask, 200, 40, 460); // conveyor line through both hubs
  const measured = measureInkFootprintPx(mask, hubA);
  assert.ok(measured !== null && measured >= 180, `fused component balloons: ${measured}`);
  const iso = isolateExemplarFootprintPx(mask, hubA, measured as number);
  assert.ok(iso.clamped, "fused pair still clamps");
  assert.ok(
    iso.footprintPx >= 100 && iso.footprintPx <= 140,
    `fused pair isolates to one brush (~110): ${iso.footprintPx}`,
  );
}

// --- Case 4: off-hub pick — the marker sits 8px off the hub center; the
// local-centroid recenter must still find the same extent.
{
  const mask = makeMask(400, 400);
  drawBrush(mask, 200, 200, 55);
  const onePass = localInkCentroid(mask, { x: 208, y: 194 });
  assert.ok(
    Math.hypot(onePass.x - 200, onePass.y - 200) <= 7,
    `one recenter pass pulls toward the hub: (${onePass.x.toFixed(1)}, ${onePass.y.toFixed(1)})`,
  );
  const measured = measureInkFootprintPx(mask, { x: 208, y: 194 });
  const iso = isolateExemplarFootprintPx(mask, { x: 208, y: 194 }, measured as number);
  // The orchestrator's two-pass recenter converges onto the hub.
  assert.ok(
    Math.hypot(iso.center.x - 200, iso.center.y - 200) <= 5,
    `two-pass recenter lands on the hub: (${iso.center.x.toFixed(1)}, ${iso.center.y.toFixed(1)})`,
  );
  assert.ok(
    iso.extentPx !== null && iso.extentPx >= 52 && iso.extentPx <= 62,
    `off-hub extent: ${iso.extentPx}`,
  );
}

// --- Case 5: solid glyph (no internal structure) — the extent path must
// never GROW a footprint past the component measurement.
{
  const mask = makeMask(300, 300);
  drawDisk(mask, 150, 150, 40);
  const measured = measureInkFootprintPx(mask, { x: 150, y: 150 });
  const iso = isolateExemplarFootprintPx(mask, { x: 150, y: 150 }, measured as number);
  assert.ok(
    iso.footprintPx <= (measured as number),
    `solid disk never grows (${iso.footprintPx} vs ${measured})`,
  );
  assert.ok(
    !iso.clamped || iso.footprintPx >= 76,
    `solid disk keeps ~its size: ${iso.footprintPx}`,
  );
}

// --- Case 6: degenerate inputs stay safe.
{
  const empty = makeMask(100, 100);
  const iso = isolateExemplarFootprintPx(empty, { x: 50, y: 50 }, 60);
  assert.equal(iso.footprintPx, 60, "empty mask keeps the given measurement");
  assert.equal(iso.clamped, false, "empty mask never claims a clamp");
}

// --- Pin the annulus stats primitives directly (angular-spread separation).
{
  const mask = makeMask(400, 400);
  drawRing(mask, 200, 200, 50); // my ring: full-circle ink at r≈50
  drawDisk(mask, 320, 200, 10); // neighbor blob at distance 120
  const stats = annulusInkStats(mask, { x: 200, y: 200 }, 140);
  const ringBin = Math.floor(50 / 3);
  const blobBin = Math.floor(120 / 3);
  assert.ok(
    stats[ringBin].concentration < 0.2,
    `own ring is spread: ${stats[ringBin].concentration.toFixed(2)}`,
  );
  assert.ok(
    stats[blobBin].concentration > 0.8,
    `neighbor blob is concentrated: ${stats[blobBin].concentration.toFixed(2)}`,
  );
  const extent = symbolExtentPx(stats);
  assert.ok(extent !== null && extent >= 45 && extent <= 57, `extent stops at own ring: ${extent}`);
}

// --- End-to-end: the REAL matcher (opencv.js wasm) proves the fix.
// Same pick point, two templates: one cropped by the OLD component-bbox
// footprint (the pair — today's production failure) and one by the ISOLATED
// footprint. The isolated template must find every brush on the sheet.

import { createRequire } from "node:module";
import {
  DEFAULT_TEMPLATE_MATCH_THRESHOLD,
  templateCropRect as cropRectFor,
} from "../src/lib/ai-takeoff/template-match/template-match-domain.ts";
import { matchTemplateSweep } from "../src/lib/ai-takeoff/template-match/template-matcher.ts";
import { openCvReady } from "../src/lib/ai-takeoff/template-match/opencv-runtime.ts";
import {
  inkMaskFromRgba,
  sheetRadiusFromLongEdge,
} from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";

const require = createRequire(import.meta.url);
const { cv } = await openCvReady(require("@techstark/opencv-js"));

interface RgbaFixture {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

function blankRgba(width: number, height: number): RgbaFixture {
  return { data: new Uint8ClampedArray(width * height * 4).fill(255), width, height };
}

function paintBrushRgba(image: RgbaFixture, cx: number, cy: number, r: number) {
  const hubR = Math.max(3, Math.round(r * 0.18));
  const spokes = 16;
  for (let y = Math.floor(cy - r - 2); y <= Math.ceil(cy + r + 2); y += 1) {
    for (let x = Math.floor(cx - r - 2); x <= Math.ceil(cx + r + 2); x += 1) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.hypot(dx, dy);
      let ink = d <= hubR || Math.abs(d - r) <= 1;
      if (!ink && d <= r && d >= 4) {
        // On a spoke: angular distance to the nearest spoke ray ≤ 1px arc.
        const angle = ((Math.atan2(dy, dx) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const step = (2 * Math.PI) / spokes;
        const nearest = Math.round(angle / step) * step;
        let delta = Math.abs(angle - nearest);
        delta = Math.min(delta, 2 * Math.PI - delta);
        ink = d * Math.sin(delta) <= 1;
      }
      if (!ink) continue;
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
    }
  }
}

function cropFixture(source: RgbaFixture, left: number, top: number, side: number): RgbaFixture {
  const crop = blankRgba(side, side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const sx = left + x;
      const sy = top + y;
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;
      const from = (sy * source.width + sx) * 4;
      const to = (y * side + x) * 4;
      crop.data[to] = source.data[from];
      crop.data[to + 1] = source.data[from + 1];
      crop.data[to + 2] = source.data[from + 2];
    }
  }
  return crop;
}

{
  const raster = blankRgba(900, 300);
  const r = 28;
  // A touching pair (the A-100 arrangement) plus three spaced singles.
  const hubs = [
    { x: 120, y: 150 }, // A — the pick
    { x: 172, y: 150 }, // B — fused with A (52 apart, tips overlap)
    { x: 350, y: 150 },
    { x: 550, y: 150 },
    { x: 750, y: 150 },
  ];
  for (const hub of hubs) paintBrushRgba(raster, hub.x, hub.y, r);
  const mask = inkMaskFromRgba(raster.data, raster.width, raster.height);
  const pick = hubs[0];

  const measured = measureInkFootprintPx(mask, pick);
  assert.ok(measured !== null && measured >= 95, `e2e pair component spans both: ${measured}`);
  const iso = isolateExemplarFootprintPx(mask, pick, measured as number);
  assert.ok(iso.clamped, "e2e isolation clamps the pair");
  assert.ok(
    iso.footprintPx >= 48 && iso.footprintPx <= 72,
    `e2e isolated footprint ≈ one brush (2r=56): ${iso.footprintPx}`,
  );

  const sweepFor = (footprintPx: number) => {
    const rect = cropRectFor(pick, footprintPx, raster.width, raster.height);
    const template = cropFixture(raster, rect.left, rect.top, rect.width);
    return matchTemplateSweep(cv, raster, template, {
      threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD,
      footprintPx,
      radius: sheetRadiusFromLongEdge(
        (0.75 * footprintPx) / raster.width,
        raster.width,
        raster.height,
      ),
      rotationStepDeg: 360,
      scales: [1],
      coarseOnly: true,
    });
  };

  const hubsFound = (candidates: Array<{ x: number; y: number }>) =>
    hubs.filter((hub) =>
      candidates.some(
        (c) => Math.hypot(c.x * raster.width - hub.x, c.y * raster.height - hub.y) <= 8,
      ),
    ).length;

  const oldSweep = sweepFor(measured as number);
  const newSweep = sweepFor(iso.footprintPx);
  const oldHubs = hubsFound(oldSweep.candidates);
  const newHubs = hubsFound(newSweep.candidates);
  console.log(
    `e2e old(pair) footprint=${measured}: ${oldSweep.candidates.length} hits, ${oldHubs}/5 hubs, top=${oldSweep.candidates
      .slice(0, 3)
      .map((c) => c.score.toFixed(2))
      .join("/")}`,
  );
  console.log(
    `e2e new(isolated) footprint=${iso.footprintPx}: ${newSweep.candidates.length} hits, ${newHubs}/5 hubs, top=${newSweep.candidates
      .slice(0, 3)
      .map((c) => c.score.toFixed(2))
      .join("/")}`,
  );
  assert.ok(newHubs === 5, `isolated template finds ALL 5 brushes (found ${newHubs})`);
  const newMin = Math.min(...newSweep.candidates.map((c) => c.score));
  assert.ok(newMin >= 0.7, `isolated hits are strong (min ${newMin.toFixed(2)})`);
  assert.ok(
    oldHubs < 5,
    `the pair template misses brushes the isolated one finds (${oldHubs}/5) — the production bug, pinned`,
  );
}

console.log("ai-exemplar-isolation-smoke: OK");
