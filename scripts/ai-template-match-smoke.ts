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
  MIN_MASK_COVERAGE,
  UNMASKED_TEMPLATE_MATCH_THRESHOLD,
  TEMPLATE_TOP_SCORE_COUNT,
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
  buildVerifyInstruction,
  capProposalsPerSheet,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  DETECTION_LONG_EDGE_PX,
  excludeNearExistingPoints,
  exemplarSheetGeometry,
  inkMaskFromRgba,
  MAX_DEDUPE_RADIUS_LONG_EDGE,
  measureInkFootprintPx,
  parseVerifyResponse,
  sheetRadiusFromLongEdge,
  tileLocalPxToNormalized,
  verifyWindowRect,
  type SheetRadius,
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
// AITAKEOFF8: the default floor is for MASKED correlation, which scores
// higher than the old whole-rectangle CCOEFF; the unmasked fallback keeps
// the AITAKEOFF6 floor.
assert.equal(DEFAULT_TEMPLATE_MATCH_THRESHOLD, 0.75, "masked-correlation floor per AITAKEOFF8");
assert.equal(UNMASKED_TEMPLATE_MATCH_THRESHOLD, 0.55, "unmasked fallback keeps the old floor");
assert.equal(MIN_MASK_COVERAGE, 0.03, "masks under 3% ink coverage are degenerate");
assert.equal(TEMPLATE_TOP_SCORE_COUNT, 5, "top-5 sweep scores always reported");

assert.equal(resolveTemplateMatchThreshold(undefined), 0.75, "no env override uses the default");
assert.equal(resolveTemplateMatchThreshold("0.7"), 0.7, "env override wins when sane");
assert.equal(resolveTemplateMatchThreshold("1.5"), 0.75, "out-of-range overrides are ignored");
assert.equal(resolveTemplateMatchThreshold("garbage"), 0.75, "garbage overrides are ignored");

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
// Radii are SheetRadius now (AITAKEOFF7 Task 0) — raw scalars stopped
// compiling when raster pixels leaked into sheet space in production.

const domainRadius = sheetRadiusFromLongEdge(0.008, 1000, 1000);
const nmsKept = suppressNonMaxima(
  [
    { x: 0.5, y: 0.5, score: 0.9 },
    { x: 0.502, y: 0.5, score: 0.7 },
    { x: 0.8, y: 0.8, score: 0.6 },
  ],
  domainRadius,
);
assert.equal(nmsKept.length, 2, "NMS collapses hits within the radius");
assert.equal(nmsKept[0].score, 0.9, "the best score wins the NMS");
assert.equal(
  suppressNonMaxima(
    [
      { x: 0.5, y: 0.5, score: 0.7 },
      { x: 0.5, y: 0.52, score: 0.9 },
    ],
    domainRadius,
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
  domainRadius,
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

/** Canonical radius for a synthetic raster (1pt = 1px, so footprintPt = px). */
const syntheticRadius = (footprintPx: number, width: number, height: number): SheetRadius =>
  exemplarSheetGeometry({
    footprintPt: footprintPx,
    pageLongEdgePt: Math.max(width, height),
    rasterWidthPx: width,
    rasterHeightPx: height,
  }).radius;

// NCC correctness: one L-shape, no rotation/scale sweep — one exact hit.
{
  const raster = blankRgba(400, 300);
  paintL(raster, 140, 80, 0);
  const template = cropRgba(raster, 140 - 32, 80 - 32, 64);
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.8,
    footprintPx: 48,
    radius: syntheticRadius(48, 400, 300),
    rotationStepDeg: 360,
    scales: [1],
  });
  assert.equal(output.downscale, 1, "small rasters match at native resolution");
  assert.equal(output.sweepCount, 1, "no-rotation sweep is a single pass");
  assert.equal(output.candidates.length, 1, "NCC PROOF: exactly one candidate, plateau collapsed");
  const hit = output.candidates[0];
  // AITAKEOFF8: the tightened template centers hits on the symbol's INK
  // BBOX (the L's bbox center sits ~(151.5, 79.5)), not the crop center.
  assert.ok(
    Math.hypot(hit.x * 400 - 151.5, hit.y * 300 - 79.5) <= 3,
    "NCC PROOF: the hit lands on the symbol's ink-bbox center",
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
  // 0.85: masked CCORR scores wrong rotations of the SAME instance up to
  // ~0.78 (ink self-overlap), true rotations 0.96+ — the threshold sits in
  // the gap so each instance proposes exactly once.
  const output = matchTemplateSweep(cv, raster, template, {
    threshold: 0.85,
    footprintPx: 48,
    radius: syntheticRadius(48, 600, 400),
    rotationStepDeg: 30,
    scales: [1],
  });
  assert.equal(output.sweepCount, 12, "full default rotation sweep ran");
  assert.equal(output.candidates.length, 2, "both instances propose exactly once");
  // Hits land on the ink-bbox center (AITAKEOFF8), which sits ~11.5px from
  // the L's paint origin and rotates with the instance — search generously.
  const upright = output.candidates.find((c) => Math.hypot(c.x * 600 - 120, c.y * 400 - 100) < 18);
  const turned = output.candidates.find((c) => Math.hypot(c.x * 600 - 420, c.y * 400 - 250) < 18);
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
    threshold: 0.8,
    footprintPx: 48,
    radius: syntheticRadius(48, 600, 400),
    rotationStepDeg: 360,
    scales: [0.85, 1, 1.15],
  });
  const grown = output.candidates.find((c) => Math.hypot(c.x * 600 - 420, c.y * 400 - 250) < 20);
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
    radius: syntheticRadius(48, 4000, 3000),
    rotationStepDeg: 360,
    scales: [1],
  });
  assert.equal(output.downscale, 0.5, "a 4000px raster matches at half resolution");
  assert.equal(output.matchWidthPx, 2000, "match raster width follows the downscale");
  const hit = output.candidates.find((c) => Math.hypot(c.x * 4000 - 1000, c.y * 3000 - 750) < 20);
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
    radius: syntheticRadius(48, 800, 600),
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
// Canonical geometry (AITAKEOFF7 Task 0): the one derivation every consumer
// shares — footprint at raster scale plus the floored+capped radius.
const fixtureGeometry = exemplarSheetGeometry({
  footprintPt,
  pageLongEdgePt: Math.max(PAGE.widthPt, PAGE.heightPt),
  rasterWidthPx,
  rasterHeightPx,
});
const footprintRasterPx = fixtureGeometry.footprintRasterPx!;
assert.ok(
  Math.abs(footprintRasterPx - footprintPt * detectionScale) < 1e-9,
  "canonical footprint equals the crop measurement at raster scale",
);

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
  {
    threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD,
    footprintPx: footprintRasterPx,
    radius: fixtureGeometry.radius,
  },
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
const g0Hit = candidateRasterPx.find((entry) =>
  near(entry, glyphRasterPx[0], footprintRasterPx / 2),
);
assert.ok(g0Hit, "the exemplar's own instance lands on its symbol (ink-bbox center)");
assert.equal(g0Hit!.candidate.rotationDeg, 0, "the exemplar instance matches the 0° variant");
const seamHit = candidateRasterPx.find((entry) =>
  near(entry, glyphRasterPx[2], footprintRasterPx / 2),
);
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
const dedupeRadius = fixtureGeometry.radius;
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

// --- AITAKEOFF7: the production root cause, reproduced and made impossible ---
// A-100 pass 1/2 collapsed 12+ symbols to 7-9 stage-B candidates because the
// exemplar's ink FUSED with surrounding linework: measureInkFootprintPx
// (fused-linework cap lifted in AITAKEOFF5) measured the whole connected
// network, and the radius derived from it — floor but no ceiling — swallowed
// legitimate neighbors. This fixture builds exactly that exemplar and proves
// both defenses: the measurement clamp and the radius cap.

{
  const fusedDoc = await pdfLib.PDFDocument.create();
  const fusedPage = fusedDoc.addPage([PAGE.widthPt, PAGE.heightPt]);
  fusedPage.drawSvgPath(lollipopPath(0), { x: 700, y: 500, color: pdfLib.rgb(0, 0, 0) });
  // The wall line straight through the symbol — one connected ink network.
  fusedPage.drawRectangle({
    x: 550,
    y: 498,
    width: 450,
    height: 4,
    color: pdfLib.rgb(0, 0, 0),
  });
  const fusedPdf = await pdfjs.getDocument({ data: await fusedDoc.save() }).promise;
  const fusedPdfPage = await fusedPdf.getPage(1);
  const fusedSheetPoint = pdfPointToSheetPoint({ xPt: 700, yPt: 500 }, PAGE);
  const fusedPlan = exemplarCropPlan(fusedSheetPoint, PAGE);
  const fusedCanvas = napi.createCanvas(fusedPlan.widthPx, fusedPlan.heightPx);
  const fusedContext = fusedCanvas.getContext("2d");
  fusedContext.fillStyle = "#ffffff";
  fusedContext.fillRect(0, 0, fusedPlan.widthPx, fusedPlan.heightPx);
  await fusedPdfPage.render({
    canvasContext: fusedContext,
    viewport: fusedPdfPage.getViewport({
      scale: fusedPlan.scale,
      offsetX: fusedPlan.offsetX,
      offsetY: fusedPlan.offsetY,
    }),
  }).promise;
  const fusedImage = fusedContext.getImageData(0, 0, fusedPlan.widthPx, fusedPlan.heightPx);
  const fusedMask = inkMaskFromRgba(fusedImage.data, fusedPlan.widthPx, fusedPlan.heightPx);
  const fusedFootprintCropPx = measureInkFootprintPx(fusedMask, {
    x: fusedPlan.markerInCropPx.px,
    y: fusedPlan.markerInCropPx.py,
  });
  assert.ok(fusedFootprintCropPx, "the fused exemplar still measures");
  const measurementCap = Math.floor(Math.max(fusedPlan.widthPx, fusedPlan.heightPx) / 2);
  assert.equal(
    fusedFootprintCropPx,
    measurementCap,
    `MEASUREMENT CLAMP: a symbol fused to a wall line measures the clamp (${measurementCap} crop px), never the whole network`,
  );
  const fusedGeometry7 = exemplarSheetGeometry({
    footprintPt: fusedFootprintCropPx! / fusedPlan.scale,
    pageLongEdgePt: Math.max(PAGE.widthPt, PAGE.heightPt),
    rasterWidthPx,
    rasterHeightPx,
  });
  assert.ok(
    Math.abs(fusedGeometry7.radius.x - MAX_DEDUPE_RADIUS_LONG_EDGE) < 1e-12,
    "RADIUS CAP: even the clamped fused footprint hits the radius ceiling, never beyond",
  );
  assert.ok(
    fusedGeometry7.radius.x * rasterWidthPx <= 152.001,
    "the capped radius is ≤152 raster px — under any 2-footprint symbol spacing",
  );
  console.log(
    `Fused-exemplar proof passed: footprint clamps to ${fusedFootprintCropPx} crop px, radius caps at ${(fusedGeometry7.radius.x * rasterWidthPx).toFixed(0)}px.`,
  );
}

// --- AITAKEOFF7 Task 2: dense-band candidate-collapse regression ---
// 12 glyphs in a realistic band (~2.8 footprints apart, like the A-100 brush
// row), 2 pre-existing marks, run at TWO raster sizes so any px/normalized
// confusion diverges between runs and fails. Task 1 (verify-crop geometry)
// and Task 3 (negatives never raise the bar) prove inside the same flow.

const DENSE_GLYPHS_PDF = Array.from({ length: 12 }, (_, index) => ({
  xPt: 109.2 + index * 100, // glyph 3 sits at xPt 409.2 — raster x=1023 @2.5
  yPt: 500,
}));
const DENSE_MARKED = [2, 7];
const DENSE_HALLUCINATION_PDF = { xPt: 1300, yPt: 200 }; // blank paper
const denseDoc = await pdfLib.PDFDocument.create();
const densePage = denseDoc.addPage([PAGE.widthPt, PAGE.heightPt]);
for (const glyph of DENSE_GLYPHS_PDF) {
  densePage.drawSvgPath(lollipopPath(0), {
    x: glyph.xPt,
    y: glyph.yPt,
    color: pdfLib.rgb(0, 0, 0),
  });
}
const densePdf = await pdfjs.getDocument({ data: await denseDoc.save() }).promise;
const densePdfPage = await densePdf.getPage(1);

// Exemplar (glyph 0) measured once from its clean crop — scale-independent.
const denseExemplarSheet = pdfPointToSheetPoint(
  { xPt: DENSE_GLYPHS_PDF[0].xPt, yPt: DENSE_GLYPHS_PDF[0].yPt },
  PAGE,
);
const densePlan = exemplarCropPlan(denseExemplarSheet, PAGE);
const denseCropCanvas = napi.createCanvas(densePlan.widthPx, densePlan.heightPx);
const denseCropContext = denseCropCanvas.getContext("2d");
denseCropContext.fillStyle = "#ffffff";
denseCropContext.fillRect(0, 0, densePlan.widthPx, densePlan.heightPx);
await densePdfPage.render({
  canvasContext: denseCropContext,
  viewport: densePdfPage.getViewport({
    scale: densePlan.scale,
    offsetX: densePlan.offsetX,
    offsetY: densePlan.offsetY,
  }),
}).promise;
const denseCropImage = denseCropContext.getImageData(0, 0, densePlan.widthPx, densePlan.heightPx);
const denseFootprintCropPx = measureInkFootprintPx(
  inkMaskFromRgba(denseCropImage.data, densePlan.widthPx, densePlan.heightPx),
  { x: densePlan.markerInCropPx.px, y: densePlan.markerInCropPx.py },
);
assert.ok(denseFootprintCropPx, "the dense-band exemplar measures");
const denseFootprintPt = denseFootprintCropPx! / densePlan.scale;

/** Ink within a small search box around a point on the rendered raster? */
const hasInkAround = (
  context: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8Array } },
  centerPx: { px: number; py: number },
  searchRadiusPx: number,
) => {
  for (let dy = -searchRadiusPx; dy <= searchRadiusPx; dy += 3) {
    for (let dx = -searchRadiusPx; dx <= searchRadiusPx; dx += 3) {
      if (darknessAt(context, centerPx.px + dx, centerPx.py + dy) < 200) return true;
    }
  }
  return false;
};

async function runDenseBand(longEdgePx: number): Promise<Array<{ xPt: number; yPt: number }>> {
  const scale = longEdgePx / Math.max(PAGE.widthPt, PAGE.heightPt);
  const denseW = Math.round(PAGE.widthPt * scale);
  const denseH = Math.round(PAGE.heightPt * scale);
  const denseCanvas = napi.createCanvas(denseW, denseH);
  const denseContext = denseCanvas.getContext("2d");
  denseContext.fillStyle = "#ffffff";
  denseContext.fillRect(0, 0, denseW, denseH);
  await densePdfPage.render({
    canvasContext: denseContext,
    viewport: densePdfPage.getViewport({ scale }),
  }).promise;

  const geometry = exemplarSheetGeometry({
    footprintPt: denseFootprintPt,
    pageLongEdgePt: Math.max(PAGE.widthPt, PAGE.heightPt),
    rasterWidthPx: denseW,
    rasterHeightPx: denseH,
  });
  const footprintPx = geometry.footprintRasterPx!;
  const glyphPx = DENSE_GLYPHS_PDF.map((glyph) =>
    pdfPointToRenderPixel({ xPt: glyph.xPt, yPt: glyph.yPt }, PAGE, scale),
  );
  const spacingPx = glyphPx[1].px - glyphPx[0].px;
  assert.ok(
    spacingPx > 2 * footprintPx && spacingPx < 3 * footprintPx,
    `the band spacing is 2-3 footprints (${(spacingPx / footprintPx).toFixed(2)}x)`,
  );
  assert.ok(
    Math.max(geometry.radius.x * denseW, geometry.radius.y * denseH) < spacingPx / 2,
    "REGRESSION GUARD: the capped radius can never reach a neighboring symbol",
  );

  const markerPx = { x: glyphPx[0].px, y: glyphPx[0].py };
  const rect = templateCropRect(markerPx, footprintPx, denseW, denseH);
  const template = denseContext.getImageData(rect.left, rect.top, rect.width, rect.height);
  const sweep = matchTemplateSweep(
    cv,
    { data: denseContext.getImageData(0, 0, denseW, denseH).data, width: denseW, height: denseH },
    { data: template.data, width: rect.width, height: rect.height },
    { threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD, footprintPx, radius: geometry.radius },
  );
  const hitsPx = sweep.candidates.map((candidate) => ({
    candidate,
    px: candidate.x * denseW,
    py: candidate.y * denseH,
  }));
  for (const [index, spot] of glyphPx.entries()) {
    assert.equal(
      hitsPx.filter((hit) => Math.hypot(hit.px - spot.px, hit.py - spot.py) < footprintPx / 2)
        .length,
      1,
      `DENSE BAND @${longEdgePx}px: glyph ${index} proposes exactly once${index === 3 ? " (the AITAKEOFF5 seam column)" : ""}`,
    );
  }

  // Mock stage A finds every glyph too (slightly off), plus one blank-paper
  // hallucination — the union must collapse duplicates, keep the model-only.
  const modelCandidates = [
    ...glyphPx.map((spot) => ({
      x: (spot.px + 4) / denseW,
      y: (spot.py - 3) / denseH,
      confidence: 0.5,
    })),
    {
      x: pdfPointToRenderPixel(DENSE_HALLUCINATION_PDF, PAGE, scale).px / denseW,
      y: pdfPointToRenderPixel(DENSE_HALLUCINATION_PDF, PAGE, scale).py / denseH,
      confidence: 0.5,
    },
  ];
  const unioned = unionProposalCandidates(sweep.candidates, modelCandidates, geometry.radius);
  assert.equal(
    unioned.length,
    13,
    "UNION: 12 cross-engine duplicates collapse, the model-only hallucination survives",
  );
  assert.ok(
    unioned.length >= sweep.candidates.length,
    "PANEL INVARIANT: the union never outputs fewer candidates than the NMS'd template hits",
  );

  // Near-existing suppression removes EXACTLY the two marked glyphs.
  const marks = DENSE_MARKED.map((index) =>
    pdfPointToSheetPoint(
      { xPt: DENSE_GLYPHS_PDF[index].xPt, yPt: DENSE_GLYPHS_PDF[index].yPt },
      PAGE,
    ),
  );
  const fresh = excludeNearExistingPoints(unioned, marks, geometry.radius) as typeof unioned;
  assert.equal(fresh.length, 11, "SUPPRESSION: exactly the 2 marked glyphs drop (10 glyphs + 1)");
  for (const index of DENSE_MARKED) {
    assert.ok(
      !fresh.some(
        (entry) =>
          Math.hypot(entry.x * denseW - glyphPx[index].px, entry.y * denseH - glyphPx[index].py) <
          footprintPx / 2,
      ),
      `the marked glyph ${index} is suppressed`,
    );
  }
  assert.ok(
    fresh.filter((entry) => entry.source === "template").length >= 10,
    "COLLAPSE REGRESSION: at least 10 candidates reach stage B on a 12-symbol band",
  );

  // Task 1 — verify-crop geometry: for BOTH engines' candidates the 256px
  // window contains the center, and glyph-sourced crops have ink at the
  // center region. A blank-center crop on a glyph candidate fails here.
  const hallucinationPx = pdfPointToRenderPixel(DENSE_HALLUCINATION_PDF, PAGE, scale);
  for (const entry of fresh) {
    const centerPx = { px: entry.x * denseW, py: entry.y * denseH };
    const windowRect = verifyWindowRect({ x: centerPx.px, y: centerPx.py }, denseW, denseH);
    assert.ok(
      centerPx.px >= windowRect.left &&
        centerPx.px < windowRect.left + windowRect.width &&
        centerPx.py >= windowRect.top &&
        centerPx.py < windowRect.top + windowRect.height,
      "VERIFY-CROP GEOMETRY: the window contains the candidate center (both engines)",
    );
    const isHallucination =
      Math.hypot(centerPx.px - hallucinationPx.px, centerPx.py - hallucinationPx.py) <
      footprintPx / 2;
    assert.equal(
      hasInkAround(denseContext, centerPx, Math.ceil(footprintPx / 2)),
      !isHallucination,
      isHallucination
        ? "the planted hallucination window is blank paper"
        : "VERIFY-CROP GEOMETRY: a glyph candidate's crop has ink at its center region",
    );
  }

  // Task 3 — one negative reference present: the rubric says negatives never
  // raise the bar, and the mocked stage B verifies all 10 unmarked glyphs.
  const verifyWithNegative = buildVerifyInstruction({
    label: "brush",
    positiveCount: 1,
    negativeCount: 1,
  });
  assert.match(
    verifyWithNegative,
    /never raise the bar: a clear match of the positive references is still true/i,
    "STRICTNESS GUARD: the verify rubric with a negative present keeps clear matches true",
  );
  const verifiedPdfPoints: Array<{ xPt: number; yPt: number }> = [];
  let denseRejections = 0;
  for (const entry of capProposalsPerSheet(fresh, DEFAULT_MAX_PROPOSALS_PER_SHEET)) {
    const centerPx = { x: entry.x * denseW, y: entry.y * denseH };
    const windowRect = verifyWindowRect(centerPx, denseW, denseH);
    const frame = tileFrameFor(windowRect, denseW, denseH);
    const glyphHit = glyphPx.find(
      (spot) => Math.hypot(spot.px - centerPx.x, spot.py - centerPx.y) < footprintPx / 2,
    );
    const verdictText = glyphHit
      ? JSON.stringify({
          observed: "a filled circle with one straight tail, matching the exemplar",
          match: true,
          center: {
            x:
              Math.round(
                tileLocalPxToNormalized(glyphHit.px - windowRect.left, windowRect.width) * 10,
              ) / 10,
            y:
              Math.round(
                tileLocalPxToNormalized(glyphHit.py - windowRect.top, windowRect.height) * 10,
              ) / 10,
          },
        })
      : JSON.stringify({ observed: "blank drawing paper with no symbol", match: false });
    const verdict = parseVerifyResponse(verdictText, windowRect.width, windowRect.height);
    if (verdict.match && verdict.center) {
      const point = tileLocalToSheetPoint(frame, verdict.center.x, verdict.center.y);
      verifiedPdfPoints.push(sheetPointToPdfPoint(point, PAGE));
    } else {
      assert.ok(verdict.observed.length > 0, "rejections carry the observed sentence");
      denseRejections += 1;
    }
  }
  assert.equal(
    verifiedPdfPoints.length,
    10,
    "TWO-STAGE PROOF: all 10 unmarked glyphs verify with a negative reference present",
  );
  assert.equal(denseRejections, 1, "only the hallucination dies in stage B");
  const matched = new Set<number>();
  for (const point of verifiedPdfPoints) {
    let best = -1;
    let bestErr = Number.POSITIVE_INFINITY;
    for (const [index, truth] of DENSE_GLYPHS_PDF.entries()) {
      const err = Math.hypot(truth.xPt - point.xPt, truth.yPt - point.yPt);
      if (err < bestErr) {
        bestErr = err;
        best = index;
      }
    }
    assert.ok(bestErr < 0.1, `verified point lands on its glyph (got ${bestErr.toFixed(4)}pt)`);
    matched.add(best);
  }
  assert.equal(matched.size, 10, "each verified point maps to a distinct unmarked glyph");

  // The old-bug canary: the fixture DETECTS the uncapped-radius class. With
  // the A-100 balloon radius (0.083 of the long edge), the same band
  // collapses below 10 — remove the cap and this smoke fails.
  const balloonRadius = sheetRadiusFromLongEdge(0.0833, denseW, denseH);
  const collapsed = unionProposalCandidates(sweep.candidates, [], balloonRadius);
  assert.ok(
    collapsed.length < 10,
    `BUG-CLASS CANARY: the uncapped A-100 radius collapses the band (${collapsed.length} of 12 survive)`,
  );
  const swallowed = excludeNearExistingPoints(unioned, marks, balloonRadius);
  assert.ok(
    swallowed.length < unioned.length - 2,
    "BUG-CLASS CANARY: with the balloon radius, marks swallow unmarked neighbors too",
  );

  return verifiedPdfPoints.sort((a, b) => a.xPt - b.xPt);
}

const denseLarge = await runDenseBand(3800);
// 1824 on purpose, not 1900: at 1900 the canvas height rounds 1187.5 → 1188
// and the half-row canvas/content mismatch shows up as a systematic ~0.2pt
// offset — sub-pixel render quantization, not a units bug. Integral dims at
// both sizes (3800×2375, 1824×1140) keep this detector sharp at 0.1pt, so
// only a REAL px/normalized confusion can trip it.
const denseSmall = await runDenseBand(1824);
// Any px/normalized confusion diverges between raster sizes; agreeing PDF
// positions prove the whole chain is unit-clean at both.
assert.equal(denseLarge.length, denseSmall.length, "both raster sizes verify the same count");
for (const [index, point] of denseLarge.entries()) {
  const other = denseSmall[index];
  assert.ok(
    Math.hypot(point.xPt - other.xPt, point.yPt - other.yPt) < 0.1,
    `TWO-SIZE PROOF: verified point ${index} agrees across raster sizes within 0.1pt`,
  );
}

console.log(
  `Dense-band regression passed at 3800px and 1824px: 12 proposed, 2 suppressed by marks, 10 verified, hallucination rejected; cross-size agreement < 0.1pt; balloon-radius canary still detects the bug class.`,
);

// --- AITAKEOFF8 Task 2: the dense-background variant (kill the blank-paper
// blindspot). Production A-100 returned ZERO template hits on a sheet
// covered in its symbol because the template carried fused rail linework and
// forced-white rotation padding, and whole-rectangle CCOEFF penalized every
// true site's differing context — a failure no blank-paper fixture could
// see. This variant embeds the glyphs in linework: a rail through EACH
// glyph (the rotated glyph's rail rotates with it), hatching and a
// dimension string nearby, and a text block within a footprint of the
// rotated glyph. The exemplar is the FUSED G0 — exactly the production
// template composition.

const denseBgDoc = await pdfLib.PDFDocument.create();
const denseBgPage = denseBgDoc.addPage([PAGE.widthPt, PAGE.heightPt]);
const denseBgFont = await denseBgDoc.embedFont(pdfLib.StandardFonts.Helvetica);
for (const glyph of GLYPHS_PDF) {
  denseBgPage.drawSvgPath(lollipopPath(glyph.rotationDeg), {
    x: glyph.xPt,
    y: glyph.yPt,
    color: pdfLib.rgb(0, 0, 0),
  });
  const railRad = (glyph.rotationDeg * Math.PI) / 180;
  const railDx = Math.cos(railRad) * 150;
  const railDy = Math.sin(railRad) * 150;
  denseBgPage.drawLine({
    start: { x: glyph.xPt - railDx, y: glyph.yPt - railDy },
    end: { x: glyph.xPt + railDx, y: glyph.yPt + railDy },
    thickness: 1.5,
    color: pdfLib.rgb(0, 0, 0),
  });
}
for (let index = 0; index < 12; index += 1) {
  denseBgPage.drawLine({
    start: { x: 360 + index * 8, y: 740 },
    end: { x: 380 + index * 8, y: 790 },
    thickness: 1,
    color: pdfLib.rgb(0, 0, 0),
  });
}
denseBgPage.drawLine({
  start: { x: 340, y: 870 },
  end: { x: 480, y: 870 },
  thickness: 1,
  color: pdfLib.rgb(0, 0, 0),
});
denseBgPage.drawText("12'-6\"", {
  x: 390,
  y: 875,
  size: 10,
  font: denseBgFont,
  color: pdfLib.rgb(0, 0, 0),
});
for (const [index, line] of ["BRUSH ASSEMBLY", "SEE DETAIL 4/A-500", "TYP. 12 PLCS"].entries()) {
  denseBgPage.drawText(line, {
    x: GLYPHS_PDF[1].xPt + 28,
    y: GLYPHS_PDF[1].yPt + 10 - index * 12,
    size: 9,
    font: denseBgFont,
    color: pdfLib.rgb(0, 0, 0),
  });
}
const standardFontDataUrl = require
  .resolve("pdfjs-dist/package.json")
  .replace("package.json", "standard_fonts/");
const denseBgPdf = await pdfjs.getDocument({ data: await denseBgDoc.save(), standardFontDataUrl })
  .promise;
const denseBgPdfPage = await denseBgPdf.getPage(1);
const denseBgCanvas = napi.createCanvas(rasterWidthPx, rasterHeightPx);
const denseBgContext = denseBgCanvas.getContext("2d");
denseBgContext.fillStyle = "#ffffff";
denseBgContext.fillRect(0, 0, rasterWidthPx, rasterHeightPx);
await denseBgPdfPage.render({
  canvasContext: denseBgContext,
  viewport: denseBgPdfPage.getViewport({ scale: detectionScale }),
}).promise;
// The text block really rendered — a silently-blank text layer would turn
// the "glyph within a footprint of text" case back into blank paper.
assert.ok(
  (() => {
    const near = pdfPointToRenderPixel(
      { xPt: GLYPHS_PDF[1].xPt + 40, yPt: GLYPHS_PDF[1].yPt + 13 },
      PAGE,
      detectionScale,
    );
    for (let dy = -10; dy <= 10; dy += 2) {
      for (let dx = -40; dx <= 40; dx += 2) {
        if (darknessAt(denseBgContext, near.px + dx, near.py + dy) < 200) return true;
      }
    }
    return false;
  })(),
  "the text block near the rotated glyph actually rendered",
);

// Exemplar = the FUSED G0 (rail through it), measured exactly as the client
// measures it: clamped footprint, capped radius (AITAKEOFF7 defenses).
const denseBgPlan = exemplarCropPlan(exemplarSheetPoint, PAGE);
const denseBgCropCanvas = napi.createCanvas(denseBgPlan.widthPx, denseBgPlan.heightPx);
const denseBgCropContext = denseBgCropCanvas.getContext("2d");
denseBgCropContext.fillStyle = "#ffffff";
denseBgCropContext.fillRect(0, 0, denseBgPlan.widthPx, denseBgPlan.heightPx);
await denseBgPdfPage.render({
  canvasContext: denseBgCropContext,
  viewport: denseBgPdfPage.getViewport({
    scale: denseBgPlan.scale,
    offsetX: denseBgPlan.offsetX,
    offsetY: denseBgPlan.offsetY,
  }),
}).promise;
const denseBgCropImage = denseBgCropContext.getImageData(
  0,
  0,
  denseBgPlan.widthPx,
  denseBgPlan.heightPx,
);
const denseBgFootprintCropPx = measureInkFootprintPx(
  inkMaskFromRgba(denseBgCropImage.data, denseBgPlan.widthPx, denseBgPlan.heightPx),
  { x: denseBgPlan.markerInCropPx.px, y: denseBgPlan.markerInCropPx.py },
);
assert.ok(denseBgFootprintCropPx, "the fused dense exemplar measures");
const denseBgGeometry = exemplarSheetGeometry({
  footprintPt: denseBgFootprintCropPx! / denseBgPlan.scale,
  pageLongEdgePt: Math.max(PAGE.widthPt, PAGE.heightPt),
  rasterWidthPx,
  rasterHeightPx,
});
const denseBgMarker = sheetPointToRenderPixel(exemplarSheetPoint, PAGE, detectionScale);
const denseBgRect = templateCropRect(
  { x: denseBgMarker.px, y: denseBgMarker.py },
  denseBgGeometry.footprintRasterPx!,
  rasterWidthPx,
  rasterHeightPx,
);
const denseBgTemplate = denseBgContext.getImageData(
  denseBgRect.left,
  denseBgRect.top,
  denseBgRect.width,
  denseBgRect.height,
);
const denseBgRaster = denseBgContext.getImageData(0, 0, rasterWidthPx, rasterHeightPx);
const denseBgGlyphPx = GLYPHS_PDF.map((glyph) =>
  pdfPointToRenderPixel({ xPt: glyph.xPt, yPt: glyph.yPt }, PAGE, detectionScale),
);
const denseBgFoundGlyphs = (candidates: TemplateMatchCandidate[]) =>
  denseBgGlyphPx.map((spot) =>
    candidates.some(
      (candidate) =>
        Math.hypot(candidate.x * rasterWidthPx - spot.px, candidate.y * rasterHeightPx - spot.py) <
        denseBgGeometry.footprintRasterPx! / 2,
    ),
  );

// MASKED run at the calibrated default: every glyph proposes — the rotated
// one on its rotated rail and the seam-column one included.
const denseBgMasked = matchTemplateSweep(
  cv,
  { data: denseBgRaster.data, width: rasterWidthPx, height: rasterHeightPx },
  { data: denseBgTemplate.data, width: denseBgRect.width, height: denseBgRect.height },
  {
    threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD,
    footprintPx: denseBgGeometry.footprintRasterPx!,
    radius: denseBgGeometry.radius,
  },
);
assert.equal(denseBgMasked.maskedMatching, true, "the masked metric ran on the dense variant");
assert.ok(
  denseBgMasked.maskCoverage > MIN_MASK_COVERAGE,
  "the fused template's mask coverage is healthy",
);
assert.deepEqual(
  denseBgFoundGlyphs(denseBgMasked.candidates),
  [true, true, true],
  "DENSE PROOF: the masked matcher proposes every glyph — rotated-on-rail and seam included",
);
assert.equal(
  denseBgMasked.appliedThreshold,
  DEFAULT_TEMPLATE_MATCH_THRESHOLD,
  "the applied threshold is reported",
);
// Score transparency (Task 1): the top list is populated, sorted, and led by
// the exemplar's own instance.
assert.ok(denseBgMasked.topScores.length >= 3, "top scores are recorded");
assert.ok(
  denseBgMasked.topScores.every(
    (top, index) => index === 0 || top.score <= denseBgMasked.topScores[index - 1].score,
  ),
  "top scores are sorted best-first",
);
assert.ok(
  denseBgMasked.topScores[0].score > 0.9,
  "the exemplar's own instance leads the top scores",
);

// UNMASKED comparison (the spec's regression documentation): the legacy
// whole-rectangle metric is ALLOWED to fail on the dense variant — and it
// does: fused context + white padding sink the rotated glyph. If this ever
// starts passing, celebrate and delete the comment.
const denseBgUnmasked = matchTemplateSweep(
  cv,
  { data: denseBgRaster.data, width: rasterWidthPx, height: rasterHeightPx },
  { data: denseBgTemplate.data, width: denseBgRect.width, height: denseBgRect.height },
  {
    threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD,
    footprintPx: denseBgGeometry.footprintRasterPx!,
    radius: denseBgGeometry.radius,
    maskedMatching: false,
  },
);
assert.equal(denseBgUnmasked.maskedMatching, false, "the comparison flag forces unmasked");
assert.equal(
  denseBgUnmasked.appliedThreshold,
  UNMASKED_TEMPLATE_MATCH_THRESHOLD,
  "unmasked applies its own floor",
);
const maskedFound = denseBgFoundGlyphs(denseBgMasked.candidates).filter(Boolean).length;
const unmaskedFound = denseBgFoundGlyphs(denseBgUnmasked.candidates).filter(Boolean).length;
assert.ok(
  maskedFound >= unmaskedFound,
  "masked never finds fewer glyphs than unmasked on the dense variant",
);
assert.equal(
  denseBgFoundGlyphs(denseBgUnmasked.candidates)[1],
  false,
  "REGRESSION DOCUMENTATION: whole-rectangle correlation misses the rotated glyph in dense context — the A-100 zero-hit failure mode, pinned",
);
console.log(
  `Dense-background variant: masked found ${maskedFound}/3 glyphs (top ${denseBgMasked.topScores
    .slice(0, 3)
    .map((top) => top.score.toFixed(2))
    .join(
      "/",
    )}, thr ${denseBgMasked.appliedThreshold}), unmasked found ${unmaskedFound}/3 (thr ${denseBgUnmasked.appliedThreshold}).`,
);

// Zero-hit transparency (Task 1): an impossible threshold produces zero
// candidates but NEVER an opaque zero — the top list still says what the
// best scores were. (The dense template against the BLANK dense-band raster:
// no exemplar self-match, so nothing reaches 0.9999.)
{
  const bandCanvas = napi.createCanvas(rasterWidthPx, rasterHeightPx);
  const bandContext = bandCanvas.getContext("2d");
  bandContext.fillStyle = "#ffffff";
  bandContext.fillRect(0, 0, rasterWidthPx, rasterHeightPx);
  await densePdfPage.render({
    canvasContext: bandContext,
    viewport: densePdfPage.getViewport({ scale: detectionScale }),
  }).promise;
  const bandRaster = bandContext.getImageData(0, 0, rasterWidthPx, rasterHeightPx);
  const zeroHit = matchTemplateSweep(
    cv,
    { data: bandRaster.data, width: rasterWidthPx, height: rasterHeightPx },
    { data: denseBgTemplate.data, width: denseBgRect.width, height: denseBgRect.height },
    {
      threshold: 0.9999,
      footprintPx: denseBgGeometry.footprintRasterPx!,
      radius: denseBgGeometry.radius,
    },
  );
  assert.equal(zeroHit.candidates.length, 0, "an impossible threshold yields zero candidates");
  assert.ok(
    zeroHit.topScores.length >= 3,
    "ZERO-HIT TRANSPARENCY: the top-score list is populated even with zero hits",
  );
  assert.ok(
    zeroHit.topScores[0].score > 0.5 && zeroHit.topScores[0].score < 0.9999,
    `the best score is visible and explains the zero (got ${zeroHit.topScores[0].score.toFixed(3)})`,
  );
}

// Degenerate-mask guard: a blank template (no ink at all) must fall back to
// unmasked — reported, never silent — and still propose nothing.
{
  const blankTemplate = denseBgContext.getImageData(10, 10, 120, 120);
  const degenerate = matchTemplateSweep(
    cv,
    { data: denseBgRaster.data, width: rasterWidthPx, height: rasterHeightPx },
    { data: blankTemplate.data, width: 120, height: 120 },
    {
      threshold: DEFAULT_TEMPLATE_MATCH_THRESHOLD,
      footprintPx: denseBgGeometry.footprintRasterPx!,
      radius: denseBgGeometry.radius,
    },
  );
  assert.equal(degenerate.maskedMatching, false, "DEGENERATE MASK: falls back to unmasked");
  assert.ok(degenerate.maskCoverage < MIN_MASK_COVERAGE, "the coverage that caused it is reported");
  assert.equal(degenerate.candidates.length, 0, "a blank template proposes nothing");
}

console.log(
  "Masked-correlation fixtures passed: dense variant fully proposed, unmasked failure pinned, zero-hit transparency and degenerate-mask guard verified.",
);
