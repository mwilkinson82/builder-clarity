// Template-match smoke (AITAKEOFF6 Tasks 0/2). CV proposes, the model
// verifies: these tests run the REAL matcher — opencv.js wasm under plain
// node — against synthetic patterns and a generated PDF fixture, so the
// proposal engine that ships is the one proven here. Model calls are never
// made; stage B is mocked exactly like the AITAKEOFF3/5 two-stage fixture.
// Run: npm run test:ai

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  DEFAULT_TEMPLATE_MATCH_THRESHOLD,
  describeCandidateOrigin,
  matchDownscaleFor,
  planRotationSweep,
  resolveProposalSource,
  resolveTemplateMatchThreshold,
  suppressNonMaxima,
  TEMPLATE_MATCH_MAX_LONG_EDGE_PX,
  TEMPLATE_MATCH_SCALES,
  TEMPLATE_ROTATION_STEP_DEG,
  templateCropRect,
  TEMPLATE_MAX_SIDE_PX,
  TEMPLATE_MIN_SIDE_PX,
  unionProposalCandidates,
} from "../src/lib/ai-takeoff/template-match/template-match-domain.ts";
import { matchTemplateSweep } from "../src/lib/ai-takeoff/template-match/template-matcher.ts";
import { openCvReady } from "../src/lib/ai-takeoff/template-match/opencv-runtime.ts";
import {
  capProposalsPerSheet,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  dedupeRadiusForFootprint,
  DETECTION_LONG_EDGE_PX,
  inkMaskFromRgba,
  measureInkFootprintPx,
  parseVerifyResponse,
  tileLocalPxToNormalized,
  verifyWindowRect,
} from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";
import {
  exemplarCropPlan,
  pdfPointToRenderPixel,
  pdfPointToSheetPoint,
  sheetPointToPdfPoint,
  sheetPointToRenderPixel,
  tileFrameFor,
  tileLocalToSheetPoint,
  type PdfPageSize,
} from "../src/lib/ai-takeoff/coord-transforms.ts";

// --- Pure domain: sweep planning + env resolvers ---

assert.deepEqual(
  planRotationSweep(90),
  [0, 90, 180, 270],
  "rotation sweep covers the full turn at the configured step",
);
assert.equal(planRotationSweep().length, 12, "default sweep is 0-330 at 30 degrees");
assert.equal(planRotationSweep()[11], 330, "default sweep never duplicates 0/360");
assert.deepEqual(planRotationSweep(0), [0], "a degenerate step degrades to no rotation");
assert.deepEqual(planRotationSweep(Number.NaN), [0], "a garbage step degrades to no rotation");

assert.equal(TEMPLATE_ROTATION_STEP_DEG, 30, "default rotation step per spec");
assert.deepEqual([...TEMPLATE_MATCH_SCALES], [0.85, 1.0, 1.15], "scale band per spec");
assert.equal(DEFAULT_TEMPLATE_MATCH_THRESHOLD, 0.55, "recall-biased NCC floor per spec");

assert.equal(resolveTemplateMatchThreshold(undefined), 0.55, "no env override uses the default");
assert.equal(resolveTemplateMatchThreshold("0.7"), 0.7, "env override wins when sane");
assert.equal(resolveTemplateMatchThreshold("1.5"), 0.55, "out-of-range overrides are ignored");
assert.equal(resolveTemplateMatchThreshold("garbage"), 0.55, "garbage overrides are ignored");

assert.equal(resolveProposalSource(undefined), "both", "proposal source defaults to both");
assert.equal(resolveProposalSource(" TEMPLATE "), "template", "source env is case/space tolerant");
assert.equal(resolveProposalSource("model"), "model", "model-only stays selectable");
assert.equal(resolveProposalSource("nonsense"), "both", "unknown source values fall back to both");

// --- Pure domain: downscale + template crop ---

assert.equal(matchDownscaleFor(1500, 1000), 1, "small rasters match at native resolution");
assert.equal(
  matchDownscaleFor(3800, 2533),
  TEMPLATE_MATCH_MAX_LONG_EDGE_PX / 3800,
  "large rasters downscale to the match ceiling",
);
assert.equal(matchDownscaleFor(1000, 3000), 2000 / 3000, "the LONG edge drives the downscale");

const cropCentered = templateCropRect({ x: 500, y: 400 }, 90, 3800, 2375);
assert.equal(cropCentered.width, Math.round(90 * 1.4), "template side is footprint x margin");
assert.equal(cropCentered.width, cropCentered.height, "template crop is square");
assert.equal(cropCentered.left, 500 - cropCentered.width / 2, "crop centers on the marker");
const cropEdge = templateCropRect({ x: 5, y: 5 }, 90, 3800, 2375);
assert.equal(cropEdge.left, 0, "edge markers shift the crop instead of shrinking it");
assert.equal(cropEdge.width, cropCentered.width, "edge crops keep the full size");
assert.equal(
  templateCropRect({ x: 100, y: 100 }, 4, 3800, 2375).width,
  TEMPLATE_MIN_SIDE_PX,
  "tiny footprints clamp up to the minimum template side",
);
assert.equal(
  templateCropRect({ x: 1000, y: 1000 }, 900, 3800, 2375).width,
  TEMPLATE_MAX_SIDE_PX,
  "huge footprints clamp down to the maximum template side",
);

// --- Pure domain: NMS + union + origin labels ---

const nmsKept = suppressNonMaxima(
  [
    { x: 0.5, y: 0.5, score: 0.9 },
    { x: 0.502, y: 0.5, score: 0.7 },
    { x: 0.8, y: 0.8, score: 0.6 },
  ],
  0.008,
);
assert.equal(nmsKept.length, 2, "NMS collapses hits within the radius");
assert.equal(nmsKept[0].score, 0.9, "the best score wins the NMS");
assert.equal(
  suppressNonMaxima(
    [
      { x: 0.5, y: 0.5, score: 0.7 },
      { x: 0.5, y: 0.52, score: 0.9 },
    ],
    0.008,
  ).length,
  2,
  "hits outside the radius both survive",
);

const union = unionProposalCandidates(
  [{ x: 0.5, y: 0.5, score: 0.8, rotationDeg: 30, scale: 1 }],
  [
    { x: 0.501, y: 0.5, confidence: 0.5 },
    { x: 0.2, y: 0.2, confidence: 0.5 },
  ],
  0.008,
);
assert.equal(union.length, 2, "union dedupes the two engines by footprint radius");
assert.equal(union[0].source, "template", "the higher-scoring template hit wins the collision");
assert.equal(union[0].confidence, 0.8, "template hits carry their NCC score as confidence");
assert.ok(union[0].templateHit, "the sweep metadata rides along for diagnostics");
assert.equal(union[1].source, "model", "model-only candidates survive the union");
assert.equal(
  capProposalsPerSheet(union, DEFAULT_MAX_PROPOSALS_PER_SHEET).length,
  2,
  "the union feeds the existing per-sheet verify cap unchanged",
);

assert.equal(
  describeCandidateOrigin({ source: "template", score: 0.78, rotationDeg: 30, scale: 1 }),
  "template 0.78 @ 30°",
  "diagnostics label matches the spec shape",
);
assert.equal(
  describeCandidateOrigin({ source: "template", score: 0.6, rotationDeg: 0, scale: 1.15 }),
  "template 0.60 @ 0° ×1.15",
  "off-unit scales show in the label",
);
assert.equal(describeCandidateOrigin({ source: "model" }), "model", "model origin stays terse");

console.log("Template-match domain assertions passed.");

// --- The real matcher: opencv.js wasm under node ---

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

/**
 * Paint an L-shape rotated so the MATCHER recovers `recoverDeg` (opencv's
 * convention, pinned empirically: content rotated +θ in y-down pixel algebra
 * comes back as 360-θ), optionally scaled.
 */
function paintL(image: RgbaFixture, cx: number, cy: number, recoverDeg: number, scale: number = 1) {
  const rad = (-recoverDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const inL = (u: number, v: number) =>
    (u >= -4 && u < 4 && v >= -20 && v < 20) || (u >= 4 && u < 28 && v >= 12 && v < 20);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const u = (cos * dx + sin * dy) / scale;
      const v = (-sin * dx + cos * dy) / scale;
      if (!inL(u, v)) continue;
      const offset = (y * image.width + x) * 4;
      image.data[offset] = 0;
      image.data[offset + 1] = 0;
      image.data[offset + 2] = 0;
    }
  }
}

function cropRgba(source: RgbaFixture, left: number, top: number, side: number): RgbaFixture {
  const crop = blankRgba(side, side);
  for (let y = 0; y < side; y += 1) {
    for (let x = 0; x < side; x += 1) {
      const from = ((top + y) * source.width + (left + x)) * 4;
      const to = (y * side + x) * 4;
      crop.data[to] = source.data[from];
      crop.data[to + 1] = source.data[from + 1];
      crop.data[to + 2] = source.data[from + 2];
    }
  }
  return crop;
}

// NCC correctness: one L-shape, no rotation/scale sweep — one exact hit.
{
  const raster = blankRgba(400, 300);
  paintL(raster, 140, 80, 0);
  const template = cropRgba(raster, 140 - 32, 80 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.8,
    footprintPx: 48,
    rotationStepDeg: 360,
    scales: [1],
  });
  assert.equal(output.downscale, 1, "small rasters match at native resolution");
  assert.equal(output.sweepCount, 1, "no-rotation sweep is a single pass");
  assert.equal(output.candidates.length, 1, "NCC PROOF: exactly one candidate, plateau collapsed");
  const hit = output.candidates[0];
  assert.ok(
    Math.hypot(hit.x * 400 - 140, hit.y * 300 - 80) <= 2,
    "NCC PROOF: the hit lands on the symbol center",
  );
  assert.ok(hit.score > 0.95, `a same-scale symbol scores near 1 (got ${hit.score.toFixed(3)})`);
  assert.equal(hit.rotationDeg, 0, "unrotated hit reports rotation 0");
  assert.equal(hit.scale, 1, "unrotated hit reports scale 1");
}

// Rotation recovery: two instances, one turned — the sweep finds both and
// reports which template variant matched.
{
  const raster = blankRgba(600, 400);
  paintL(raster, 120, 100, 0);
  paintL(raster, 420, 250, 300);
  const template = cropRgba(raster, 120 - 32, 100 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.6,
    footprintPx: 48,
    rotationStepDeg: 30,
    scales: [1],
  });
  assert.equal(output.sweepCount, 12, "full default rotation sweep ran");
  assert.equal(output.candidates.length, 2, "both instances propose exactly once");
  const upright = output.candidates.find((c) => Math.hypot(c.x * 600 - 120, c.y * 400 - 100) < 4);
  const turned = output.candidates.find((c) => Math.hypot(c.x * 600 - 420, c.y * 400 - 250) < 4);
  assert.ok(upright && turned, "ROTATION PROOF: both instances found at their true centers");
  assert.equal(upright!.rotationDeg, 0, "the upright instance matches the 0° variant");
  assert.equal(turned!.rotationDeg, 300, "ROTATION PROOF: the turned instance recovers its angle");
  assert.ok(
    turned!.score > 0.85,
    `an on-sweep rotation scores high (got ${turned!.score.toFixed(3)})`,
  );
}

// Scale recovery: a 1.15x instance matches the 1.15 template variant best.
{
  const raster = blankRgba(600, 400);
  paintL(raster, 120, 100, 0);
  paintL(raster, 420, 250, 0, 1.15);
  const template = cropRgba(raster, 120 - 32, 100 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.6,
    footprintPx: 48,
    rotationStepDeg: 360,
    scales: [0.85, 1, 1.15],
  });
  const grown = output.candidates.find((c) => Math.hypot(c.x * 600 - 420, c.y * 400 - 250) < 6);
  assert.ok(grown, "SCALE PROOF: the enlarged instance still proposes");
  assert.equal(grown!.scale, 1.15, "SCALE PROOF: the 1.15 template variant wins it");
}

// Coordinate round-trip through the downscale: a raster over the match
// ceiling maps hits back through tileFrameFor semantics, one conversion.
{
  const raster = blankRgba(4000, 3000);
  paintL(raster, 1000, 750, 0);
  const template = cropRgba(raster, 1000 - 32, 750 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.5,
    footprintPx: 48,
    rotationStepDeg: 360,
    scales: [1],
  });
  assert.equal(output.downscale, 0.5, "a 4000px raster matches at half resolution");
  assert.equal(output.matchWidthPx, 2000, "match raster width follows the downscale");
  const hit = output.candidates.find((c) => Math.hypot(c.x * 4000 - 1000, c.y * 3000 - 750) < 6);
  assert.ok(
    hit,
    "DOWNSCALE ROUND-TRIP: the hit maps back to the true raster position within quantization",
  );
  // The frame math itself, spelled out: a match-space point maps through
  // tileFrameFor exactly like a tile response (the downscaled raster IS one
  // whole-sheet tile at the origin).
  const frame = tileFrameFor({ left: 0, top: 0 }, output.matchWidthPx, output.matchHeightPx);
  const mapped = tileLocalToSheetPoint(frame, 500, 375);
  assert.ok(
    Math.abs(mapped.x - 0.25) < 1e-9 && Math.abs(mapped.y - 0.25) < 1e-9,
    "match space → sheet space is the one tested tile transform",
  );
}

// Flat-region pathology guard: blank paper proposes nothing, ever.
{
  const raster = blankRgba(800, 600);
  const templateSource = blankRgba(200, 200);
  paintL(templateSource, 100, 100, 0);
  const template = cropRgba(templateSource, 100 - 32, 100 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.55,
    footprintPx: 48,
    rotationStepDeg: 30,
    scales: [0.85, 1, 1.15],
  });
  assert.equal(
    output.candidates.length,
    0,
    "BLANK GUARD: an empty sheet yields zero candidates (no TM_CCOEFF_NORMED flat-region garbage)",
  );
}

console.log("Template-match synthetic matcher tests passed (real opencv.js wasm).");

// --- PDF fixture (AITAKEOFF6 Task 2): 3 glyphs (one rotated 45°, one at a
// tile seam), square decoy, radial decoy. The template stage must propose
// every glyph — the seam case is trivial for whole-raster matching, which is
// the point — and whatever it proposes beyond the glyphs must die in the
// mocked stage B, exactly like the AITAKEOFF5 fixture's decoys.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfLib = require("pdf-lib") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const napi = require("@napi-rs/canvas") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalAny = globalThis as any;
if (typeof globalAny.DOMMatrix === "undefined" && napi.DOMMatrix) {
  globalAny.DOMMatrix = napi.DOMMatrix;
}
if (typeof globalAny.ImageData === "undefined" && napi.ImageData) {
  globalAny.ImageData = napi.ImageData;
}
if (typeof globalAny.Path2D === "undefined" && napi.Path2D) {
  globalAny.Path2D = napi.Path2D;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as any;

const PAGE: PdfPageSize = { widthPt: 1520, heightPt: 950 };
const detectionScale = DETECTION_LONG_EDGE_PX / Math.max(PAGE.widthPt, PAGE.heightPt); // 2.5
const rasterWidthPx = Math.round(PAGE.widthPt * detectionScale);
const rasterHeightPx = Math.round(PAGE.heightPt * detectionScale);

// The fixture symbol is a "lollipop": a circle with one tail — asymmetric
// enough that rotation matters, compact enough to survive the 15° residual
// between a 45° instance and the 30°/60° sweep variants.
function lollipopPath(rotateContentDeg: number): string {
  // SVG path space is y-down like the raster; rotating points by -θ there
  // makes the matcher recover +θ (opencv angles, pinned by the unit test).
  const rad = (-rotateContentDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const rotate = (px: number, py: number): [number, number] => [
    cos * px - sin * py,
    sin * px + cos * py,
  ];
  const points: Array<[number, number]> = [];
  for (let index = 0; index < 24; index += 1) {
    const angle = (2 * Math.PI * index) / 24;
    points.push(rotate(12 * Math.cos(angle), 12 * Math.sin(angle)));
  }
  const circle =
    points
      .map(([px, py], index) => `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`)
      .join(" ") + " Z";
  const tailCorners: Array<[number, number]> = [
    [8, -4],
    [24, -4],
    [24, 4],
    [8, 4],
  ];
  const tail =
    tailCorners
      .map(([px, py], index) => {
        const [rx, ry] = rotate(px, py);
        return `${index === 0 ? "M" : "L"}${rx.toFixed(2)},${ry.toFixed(2)}`;
      })
      .join(" ") + " Z";
  return `${circle} ${tail}`;
}

// PDF positions (bottom-up y). G1 is the 45°-rotated instance; G2 sits so
// its raster center lands at x=1023 — the AITAKEOFF5 tile-seam spot that
// needed footprint-derived overlap in the tiled pipeline. Whole-raster
// matching has no tiles, so nothing special can happen there — the proof.
const GLYPHS_PDF = [
  { xPt: 300.4, yPt: 700.3, rotationDeg: 0 }, // G0 — the exemplar
  { xPt: 1100.6, yPt: 400.2, rotationDeg: 45 }, // G1 — rotated 45°
  { xPt: 409.2, yPt: 830.0, rotationDeg: 0 }, // G2 — raster x=1023, the seam
];
const SQUARE_DECOY_PDF = { xPt: 600, yPt: 550 }; // raster (1500, 1000)
const RADIAL_DECOY_PDF = { xPt: 760, yPt: 300 }; // raster (1900, 1625)

const doc = await pdfLib.PDFDocument.create();
const page = doc.addPage([PAGE.widthPt, PAGE.heightPt]);
for (const glyph of GLYPHS_PDF) {
  page.drawSvgPath(lollipopPath(glyph.rotationDeg), {
    x: glyph.xPt,
    y: glyph.yPt,
    color: pdfLib.rgb(0, 0, 0),
  });
}
page.drawRectangle({
  x: SQUARE_DECOY_PDF.xPt - 18,
  y: SQUARE_DECOY_PDF.yPt - 18,
  width: 36,
  height: 36,
  color: pdfLib.rgb(0, 0, 0),
});
const starPath =
  Array.from({ length: 16 }, (_, index) => {
    const angle = (Math.PI * index) / 8;
    const radius = index % 2 === 0 ? 18 : 7;
    const px = Math.cos(angle) * radius;
    const py = Math.sin(angle) * radius;
    return `${index === 0 ? "M" : "L"}${px.toFixed(2)},${py.toFixed(2)}`;
  }).join(" ") + " Z";
page.drawSvgPath(starPath, {
  x: RADIAL_DECOY_PDF.xPt,
  y: RADIAL_DECOY_PDF.yPt,
  color: pdfLib.rgb(0, 0, 0),
});

const loadedPdf = await pdfjs.getDocument({ data: await doc.save() }).promise;
const pdfPage = await loadedPdf.getPage(1);

const renderViewport = async (
  viewport: { width: number; height: number },
  width: number,
  height: number,
) => {
  const canvas = napi.createCanvas(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: context, viewport }).promise;
  return context;
};

const darknessAt = (
  context: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8Array } },
  x: number,
  y: number,
) => {
  const data = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return data[0] + data[1] + data[2];
};

const rasterContext = await renderViewport(
  pdfPage.getViewport({ scale: detectionScale }),
  rasterWidthPx,
  rasterHeightPx,
);

const glyphRasterPx = GLYPHS_PDF.map((glyph) =>
  pdfPointToRenderPixel({ xPt: glyph.xPt, yPt: glyph.yPt }, PAGE, detectionScale),
);
const squareRasterPx = pdfPointToRenderPixel(SQUARE_DECOY_PDF, PAGE, detectionScale);
const radialRasterPx = pdfPointToRenderPixel(RADIAL_DECOY_PDF, PAGE, detectionScale);
for (const [index, spot] of glyphRasterPx.entries()) {
  assert.ok(darknessAt(rasterContext, spot.px, spot.py) < 200, `glyph ${index} ink is planned`);
}
assert.ok(
  Math.abs(glyphRasterPx[2].px - 1023) < 0.01,
  "the seam glyph sits at the AITAKEOFF5 tile-seam raster column",
);

// Template extraction, exactly as the client derives it: measure the ink
// footprint on the exemplar crop, convert to raster pixels, crop the
// detection raster around the marker.
const exemplarSheetPoint = pdfPointToSheetPoint(
  { xPt: GLYPHS_PDF[0].xPt, yPt: GLYPHS_PDF[0].yPt },
  PAGE,
);
const cropPlan = exemplarCropPlan(exemplarSheetPoint, PAGE);
const cropContext = await renderViewport(
  pdfPage.getViewport({
    scale: cropPlan.scale,
    offsetX: cropPlan.offsetX,
    offsetY: cropPlan.offsetY,
  }),
  cropPlan.widthPx,
  cropPlan.heightPx,
);
const cropImage = cropContext.getImageData(0, 0, cropPlan.widthPx, cropPlan.heightPx);
const cropMask = inkMaskFromRgba(cropImage.data, cropPlan.widthPx, cropPlan.heightPx);
const footprintCropPx = measureInkFootprintPx(cropMask, {
  x: cropPlan.markerInCropPx.px,
  y: cropPlan.markerInCropPx.py,
});
assert.ok(footprintCropPx, "the exemplar crop yields a measurable footprint");
const footprintPt = footprintCropPx! / cropPlan.scale;
assert.ok(
  Math.abs(footprintPt - 36) < 3,
  `the lollipop bbox long edge is ~36pt (got ${footprintPt.toFixed(1)}pt)`,
);
const footprintRasterPx = footprintPt * detectionScale;

const markerRasterPx = sheetPointToRenderPixel(exemplarSheetPoint, PAGE, detectionScale);
const templateRect = templateCropRect(
  { x: markerRasterPx.px, y: markerRasterPx.py },
  footprintRasterPx,
  rasterWidthPx,
  rasterHeightPx,
);
const templateImage = rasterContext.getImageData(
  templateRect.left,
  templateRect.top,
  templateRect.width,
  templateRect.height,
);

// The real sweep, default config, recall-biased threshold.
const sweepStartedAt = Date.now();
const sweep = matchTemplateSweep(
  cv,
  {
    data: rasterContext.getImageData(0, 0, rasterWidthPx, rasterHeightPx).data,
    width: rasterWidthPx,
    height: rasterHeightPx,
  },
  { data: templateImage.data, width: templateRect.width, height: templateRect.height },
  { threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD, footprintPx: footprintRasterPx },
);
const sweepElapsedMs = Date.now() - sweepStartedAt;
assert.equal(sweep.sweepCount, 36, "12 rotations x 3 scales all ran");
assert.ok(!sweep.truncated, "the fixture sheet never hits the safety cap");
assert.ok(
  sweepElapsedMs < 20_000,
  `PERF BRAKE: the full sweep on a ${rasterWidthPx}x${rasterHeightPx} raster stays well inside budget (took ${sweepElapsedMs}ms; budget 10s typical)`,
);

const candidateRasterPx = sweep.candidates.map((candidate) => ({
  candidate,
  px: candidate.x * rasterWidthPx,
  py: candidate.y * rasterHeightPx,
}));
const near = (a: { px: number; py: number }, b: { px: number; py: number }, radius: number) =>
  Math.hypot(a.px - b.px, a.py - b.py) < radius;

// Every glyph proposes — including the rotated and the seam one.
for (const [index, spot] of glyphRasterPx.entries()) {
  const hits = candidateRasterPx.filter((entry) => near(entry, spot, footprintRasterPx / 2));
  assert.equal(
    hits.length,
    1,
    `TEMPLATE PROOF: glyph ${index} proposes exactly once (rotated + seam included)`,
  );
}
const g0Hit = candidateRasterPx.find((entry) => near(entry, glyphRasterPx[0], 10));
assert.ok(g0Hit, "the exemplar's own instance lands within a few pixels of truth");
assert.equal(g0Hit!.candidate.rotationDeg, 0, "the exemplar instance matches the 0° variant");
const seamHit = candidateRasterPx.find((entry) => near(entry, glyphRasterPx[2], 10));
assert.ok(
  seamHit,
  "SEAM PROOF: whole-raster matching proposes the seam glyph — no tiles, no seams",
);
const rotatedHit = candidateRasterPx.find((entry) =>
  near(entry, glyphRasterPx[1], footprintRasterPx / 2),
);
assert.ok(
  rotatedHit && [30, 60].includes(rotatedHit.candidate.rotationDeg),
  `ROTATION PROOF: the 45° instance matches a neighboring sweep variant (got ${rotatedHit?.candidate.rotationDeg}° at ${rotatedHit?.candidate.score.toFixed(3)})`,
);

// Nothing proposes on blank paper: every candidate is one of the 5 shapes.
const shapeSpots = [
  ...glyphRasterPx.map((spot) => ({ px: spot.px, py: spot.py })),
  { px: squareRasterPx.px, py: squareRasterPx.py },
  { px: radialRasterPx.px, py: radialRasterPx.py },
];
for (const entry of candidateRasterPx) {
  assert.ok(
    shapeSpots.some((spot) => near(entry, spot, footprintRasterPx)),
    `no candidate sits on blank paper (found one at ${entry.px.toFixed(0)},${entry.py.toFixed(0)})`,
  );
}
const decoyProposals = candidateRasterPx.filter(
  (entry) =>
    near(entry, squareRasterPx, footprintRasterPx) ||
    near(entry, radialRasterPx, footprintRasterPx),
);
console.log(
  `Template stage on the PDF fixture: ${sweep.candidates.length} candidates in ${sweepElapsedMs}ms (downscale ${sweep.downscale.toFixed(3)}), decoys proposed: ${decoyProposals.length}.`,
);

// Union with a mock model stage-A list: the model re-finding G0 must not buy
// a second verification; a model-only find elsewhere must survive.
const dedupeRadius = dedupeRadiusForFootprint(
  footprintRasterPx,
  Math.max(rasterWidthPx, rasterHeightPx),
);
const unionWithModel = unionProposalCandidates(
  sweep.candidates,
  [
    {
      x: (glyphRasterPx[0].px + 3) / rasterWidthPx,
      y: glyphRasterPx[0].py / rasterHeightPx,
      confidence: 0.5,
    },
  ],
  dedupeRadius,
);
assert.equal(
  unionWithModel.length,
  sweep.candidates.length,
  "UNION PROOF: a model duplicate of a template hit collapses in the union",
);
assert.ok(
  unionWithModel.every((candidate) =>
    candidate.source === "template" ? candidate.templateHit !== null : true,
  ),
  "union entries keep their engine metadata",
);

// Stage B, mocked like the AITAKEOFF5 fixture: glyphs verify (center mapped
// through the window frame), decoys and anything else die with an observed
// sentence. The template stage may propose decoys — stage B is the gate.
const toVerify = capProposalsPerSheet(unionWithModel, DEFAULT_MAX_PROPOSALS_PER_SHEET);
const round1 = (value: number) => Math.round(value * 10) / 10;
const verified: Array<{ x: number; y: number }> = [];
let rejections = 0;
for (const candidate of toVerify) {
  const centerPx = { x: candidate.x * rasterWidthPx, y: candidate.y * rasterHeightPx };
  const rect = verifyWindowRect(centerPx, rasterWidthPx, rasterHeightPx);
  const frame = tileFrameFor(rect, rasterWidthPx, rasterHeightPx);
  const glyphHit = glyphRasterPx.find((spot) =>
    near({ px: centerPx.x, py: centerPx.y }, spot, footprintRasterPx / 2),
  );
  if (glyphHit) {
    assert.ok(
      darknessAt(rasterContext, glyphHit.px, glyphHit.py) < 200,
      "the verification window contains the glyph it was cut for",
    );
  }
  const verdictText = glyphHit
    ? JSON.stringify({
        observed: "a filled circle with a single straight tail, matching the exemplars",
        match: true,
        center: {
          x: round1(tileLocalPxToNormalized(glyphHit.px - rect.left, rect.width)),
          y: round1(tileLocalPxToNormalized(glyphHit.py - rect.top, rect.height)),
        },
      })
    : JSON.stringify({
        observed: near({ px: centerPx.x, py: centerPx.y }, squareRasterPx, footprintRasterPx)
          ? "a solid filled square, not the circle-and-tail symbol"
          : "an eight-pointed star like an impeller, not the circle-and-tail symbol",
        match: false,
      });
  const verdict = parseVerifyResponse(verdictText, rect.width, rect.height);
  if (verdict.match && verdict.center) {
    verified.push(tileLocalToSheetPoint(frame, verdict.center.x, verdict.center.y));
  } else {
    assert.ok(verdict.observed.length > 0, "every rejection carries an observed sentence");
    rejections += 1;
  }
}
assert.equal(verified.length, 3, "TWO-STAGE PROOF: exactly the three true glyphs verify");
assert.equal(
  rejections,
  toVerify.length - 3,
  "TWO-STAGE PROOF: every non-glyph proposal (decoys included) dies in stage B",
);

// Each verified point lands on a DISTINCT glyph, within the stage-B
// quantization tolerance — the found-count reconciles with a manual count.
const matchedGlyphs = new Set<number>();
let worstErrPt = 0;
for (const point of verified) {
  const pdf = sheetPointToPdfPoint(point, PAGE);
  let bestIndex = -1;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const [index, truth] of GLYPHS_PDF.entries()) {
    const err = Math.hypot(truth.xPt - pdf.xPt, truth.yPt - pdf.yPt);
    if (err < bestErr) {
      bestErr = err;
      bestIndex = index;
    }
  }
  assert.ok(
    bestErr < 0.042,
    `verified point lands within 0.042pt of a true glyph (got ${bestErr.toFixed(4)}pt)`,
  );
  matchedGlyphs.add(bestIndex);
  worstErrPt = Math.max(worstErrPt, bestErr);
}
assert.equal(matchedGlyphs.size, 3, "each verified point maps to a distinct glyph");

console.log(
  `Template-match PDF fixture passed: 3 glyphs (incl. 45° rotation + seam) proposed and verified within ${worstErrPt.toFixed(4)}pt; ${rejections} non-glyph proposal(s) died in stage B.`,
);
