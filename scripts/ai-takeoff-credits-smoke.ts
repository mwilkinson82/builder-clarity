// AI takeoff + credits smoke (AITAKEOFF1 Task 4, AITAKEOFF2 Tasks 1/2/5).
// Pure-function unit checks (ledger math, refunds, price table, parsing,
// review order, conversion) PLUS rendered round-trip fixtures: a generated
// PDF with a known glyph proves the exemplar crop contains the symbol (pixel
// sampling) and that a mock model response maps back to the true sheet
// position. Both Y-axis regressions fail loudly here — they cannot be
// reintroduced silently. Model calls are never made in tests.
// Run: npm run test:ai

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  AI_COUNT_SCAN_CREDITS_PER_SHEET,
  computeApiCostCents,
  creditBalance,
  creditPacksFromEnv,
  DEFAULT_AI_MODEL,
  DEFAULT_CREDIT_PACKS,
  DEFAULT_MAX_SHEETS_PER_SCAN,
  MODEL_PRICES_PER_MTOK,
  priceForModel,
  quoteScanCredits,
  refundEntryForFailedScan,
  resolveAiModel,
  SIGNUP_GRANT_CREDITS,
  UNKNOWN_MODEL_PRICE_PER_MTOK,
} from "../src/lib/credits/credits-domain.ts";
import {
  AI_ASSIST_FIRST_RUN_MESSAGE,
  AI_ASSIST_NOT_CONFIGURED_MESSAGE,
  aiAssistAvailability,
  appendAcceptedPoint,
  applyConfidenceFloor,
  buildScanInstruction,
  buildVerifyInstruction,
  capProposalsPerSheet,
  COARSE_CANDIDATE_CONFIDENCE,
  dedupeCandidates,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  DEFAULT_MIN_PROPOSAL_CONFIDENCE,
  dedupeRadiusForFootprint,
  DETECTION_LONG_EDGE_PX,
  DETECTION_TILE_OVERLAP_PX,
  DETECTION_TILE_PX,
  excludeNearExistingPoints,
  measureInkFootprintPx,
  overlapForFootprintPx,
  INK_LUMINANCE_THRESHOLD,
  inkMaskFromBase64,
  inkMaskFromRgba,
  inkMaskGet,
  inkMaskToBase64,
  LOW_CONFIDENCE_THRESHOLD,
  NORMALIZED_COORD_MAX,
  SNAP_SEARCH_RADIUS_PX,
  snapToInkCentroid,
  normalizedToTileLocalPx,
  parseScanResponse,
  parseVerifyResponse,
  planDetectionTiles,
  sortProposalsForReview,
  tileLocalPxToNormalized,
  tileTokenCheck,
  VERIFIED_PROPOSAL_CONFIDENCE,
  VERIFY_IMAGE_PX,
  VERIFY_WINDOW_PX,
  verifyWindowRect,
} from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";
import {
  bboxCenter,
  EXEMPLAR_TARGET_LONG_EDGE_PX,
  exemplarCropPlan,
  pdfPointToRenderPixel,
  pdfPointToSheetPoint,
  renderPixelToSheetPoint,
  sheetPointToPdfPoint,
  sheetPointToRenderPixel,
  tileFrameFor,
  tileLocalToSheetPoint,
  type PdfPageSize,
} from "../src/lib/ai-takeoff/coord-transforms.ts";

// --- Ledger balance math ---

assert.equal(creditBalance([]), 0, "empty ledger balances to zero");
assert.equal(
  creditBalance([{ delta: 50 }, { delta: -3 }, { delta: 100 }, { delta: -30 }]),
  117,
  "balance is SUM(delta) over grants, purchases, and spends",
);
assert.equal(SIGNUP_GRANT_CREDITS, 50, "signup grant is 50 credits (founder spec)");
assert.equal(
  creditBalance([{ delta: SIGNUP_GRANT_CREDITS }, { delta: -quoteScanCredits(30) }]),
  20,
  "a fresh org can afford a full 30-sheet scan on the signup grant",
);

// --- Scan quotes ---

assert.equal(AI_COUNT_SCAN_CREDITS_PER_SHEET, 1, "one credit per sheet scanned");
assert.equal(quoteScanCredits(1), 1, "single sheet scan quotes 1 credit");
assert.equal(quoteScanCredits(12), 12, "multi-sheet scan quotes 1 credit per sheet");
assert.equal(quoteScanCredits(0), 0, "zero sheets quote nothing");
assert.equal(quoteScanCredits(-4), 0, "negative sheet counts quote nothing");
assert.equal(DEFAULT_MAX_SHEETS_PER_SCAN, 30, "hard cap defaults to 30 sheets per scan");

// --- Refund compensation ---

const fullRefund = refundEntryForFailedScan({
  operationId: "op-1",
  creditsCharged: 10,
  sheetsCompleted: 0,
});
assert.ok(fullRefund, "a scan that failed before any sheet refunds");
assert.equal(fullRefund?.delta, 10, "total failure refunds the full charge");
assert.equal(fullRefund?.reason, "refund", "compensating entry carries the refund reason");
assert.equal(fullRefund?.reference, "op-1", "refund references the operation id");

const partialRefund = refundEntryForFailedScan({
  operationId: "op-2",
  creditsCharged: 10,
  sheetsCompleted: 4,
});
assert.equal(partialRefund?.delta, 6, "partial failure refunds only unscanned sheets");

assert.equal(
  refundEntryForFailedScan({ operationId: "op-3", creditsCharged: 5, sheetsCompleted: 5 }),
  null,
  "fully consumed operations refund nothing",
);
assert.equal(
  refundEntryForFailedScan({ operationId: "op-4", creditsCharged: 5, sheetsCompleted: 9 }),
  null,
  "over-reported completion never produces a negative refund",
);
assert.equal(
  refundEntryForFailedScan({ operationId: "op-5", creditsCharged: 0, sheetsCompleted: 0 }),
  null,
  "nothing charged means nothing to refund",
);

// Charge + refund round trip keeps the ledger whole.
const charged = [{ delta: 50 }, { delta: -10 }];
const compensation = refundEntryForFailedScan({
  operationId: "op-6",
  creditsCharged: 10,
  sheetsCompleted: 3,
});
assert.equal(
  creditBalance([...charged, { delta: compensation?.delta ?? 0 }]),
  47,
  "balance after failure = grant minus the 3 consumed sheets only",
);

// --- API cost from the config price table ---

assert.equal(DEFAULT_AI_MODEL, "claude-sonnet-4-6", "default model per founder spec");
assert.equal(resolveAiModel(undefined), DEFAULT_AI_MODEL, "no env override uses the default");
assert.equal(resolveAiModel("  "), DEFAULT_AI_MODEL, "blank env override uses the default");
assert.equal(
  resolveAiModel("claude-haiku-4-5"),
  "claude-haiku-4-5",
  "ANTHROPIC_MODEL override wins without code changes",
);

const sonnetPrice = MODEL_PRICES_PER_MTOK["claude-sonnet-4-6"];
assert.ok(sonnetPrice, "price table covers the default model");
assert.equal(sonnetPrice.inputCents, 300, "sonnet input $3/MTok = 300 cents");
assert.equal(sonnetPrice.outputCents, 1500, "sonnet output $15/MTok = 1500 cents");

assert.equal(
  computeApiCostCents("claude-sonnet-4-6", 1_000_000, 1_000_000),
  1800,
  "cost math: full MTok on both sides",
);
assert.equal(
  computeApiCostCents("claude-sonnet-4-6", 25_000, 2_000),
  11,
  "cost math: typical sheet scan lands in whole cents, rounded up",
);
assert.equal(computeApiCostCents("claude-sonnet-4-6", 1, 0), 1, "tiny calls round UP, never to 0");
assert.equal(computeApiCostCents("claude-sonnet-4-6", 0, 0), 0, "no tokens costs nothing");
assert.equal(
  computeApiCostCents("some-future-model", 1_000_000, 0),
  UNKNOWN_MODEL_PRICE_PER_MTOK.inputCents,
  "unknown models fall back to conservative pricing (no code change needed)",
);
assert.deepEqual(
  priceForModel("claude-opus-4-8"),
  { inputCents: 500, outputCents: 2500 },
  "opus tier priced at $5/$25 per MTok",
);
assert.equal(
  computeApiCostCents("claude-sonnet-4-6", -5, -5),
  0,
  "negative token counts clamp to zero cost",
);

// --- Credit packs (config-driven) ---

assert.equal(DEFAULT_CREDIT_PACKS.length, 1, "one default pack");
assert.equal(DEFAULT_CREDIT_PACKS[0].credits, 100, "default pack is 100 credits");
assert.equal(DEFAULT_CREDIT_PACKS[0].amountCents, 2500, "default pack is $25.00");
assert.deepEqual(creditPacksFromEnv(undefined), DEFAULT_CREDIT_PACKS, "no env → defaults");
assert.deepEqual(creditPacksFromEnv("not json"), DEFAULT_CREDIT_PACKS, "garbage env → defaults");
assert.deepEqual(
  creditPacksFromEnv('{"id":"x"}'),
  DEFAULT_CREDIT_PACKS,
  "non-array env → defaults",
);
const customPacks = creditPacksFromEnv(
  '[{"id":"pack_250","credits":250,"amountCents":5000},{"id":"bad","credits":0,"amountCents":100}]',
);
assert.equal(customPacks.length, 1, "invalid pack entries are dropped");
assert.equal(customPacks[0].id, "pack_250", "valid env packs override defaults");
assert.equal(customPacks[0].label, "250 credits", "missing labels derive from credits");

// --- Pure coordinate transforms (AITAKEOFF2 Task 1) ---
// The Y flip lives in exactly one place; these assertions make both known
// Y-axis regressions impossible to reintroduce silently.

// Page size chosen so the detection raster is exactly integral
// (3800 x 2375 at scale 2.5): canvas rounding then contributes zero error
// and the mapping assertions measure pure conversion quantization.
const PAGE: PdfPageSize = { widthPt: 1520, heightPt: 950 };

const topLeftPdf = sheetPointToPdfPoint({ x: 0, y: 0 }, PAGE);
assert.equal(topLeftPdf.xPt, 0, "sheet x=0 is PDF x=0");
assert.equal(
  topLeftPdf.yPt,
  PAGE.heightPt,
  "Y-FLIP GUARD: sheet TOP (y=0) is PDF yPt=pageHeight (bottom-up), never yPt=0",
);
const bottomLeftPdf = sheetPointToPdfPoint({ x: 0, y: 1 }, PAGE);
assert.equal(bottomLeftPdf.yPt, 0, "sheet BOTTOM (y=1) is PDF yPt=0");

const glyphPdf = { xPt: 900, yPt: 200 };
const glyphSheet = pdfPointToSheetPoint(glyphPdf, PAGE);
assert.ok(Math.abs(glyphSheet.x - 900 / PAGE.widthPt) < 1e-12, "pdf→sheet x");
assert.ok(Math.abs(glyphSheet.y - (1 - 200 / PAGE.heightPt)) < 1e-12, "pdf→sheet y flips");

// Round trips are identities.
const roundTripPdf = sheetPointToPdfPoint(pdfPointToSheetPoint(glyphPdf, PAGE), PAGE);
assert.ok(
  Math.abs(roundTripPdf.xPt - glyphPdf.xPt) < 1e-9 &&
    Math.abs(roundTripPdf.yPt - glyphPdf.yPt) < 1e-9,
  "pdf→sheet→pdf round trip is exact",
);
const somePixel = { px: 1234.5, py: 678.25 };
const pixelRoundTrip = sheetPointToRenderPixel(
  renderPixelToSheetPoint(somePixel, PAGE, 2.5),
  PAGE,
  2.5,
);
assert.ok(
  Math.abs(pixelRoundTrip.px - somePixel.px) < 1e-6 &&
    Math.abs(pixelRoundTrip.py - somePixel.py) < 1e-6,
  "pixel→sheet→pixel round trip is exact",
);

// The composition equals the two-hop path (no shortcut drift).
const viaHops = pdfPointToRenderPixel(sheetPointToPdfPoint(glyphSheet, PAGE), PAGE, 3.1);
const direct = sheetPointToRenderPixel(glyphSheet, PAGE, 3.1);
assert.ok(
  Math.abs(viaHops.px - direct.px) < 1e-9 && Math.abs(viaHops.py - direct.py) < 1e-9,
  "sheet→pixel composition equals sheet→pdf→pixel",
);
// Top-down pixel space: PDF yPt=200 sits near the sheet BOTTOM, so its
// raster py must land in the BOTTOM half. A dropped Y flip puts it top.
assert.ok(
  direct.py > (PAGE.heightPt * 3.1) / 2,
  "Y-FLIP GUARD: a point near the sheet bottom lands in the bottom half of the raster",
);

// --- Exemplar crop plan (AITAKEOFF2 Task 0) ---

const centerPlan = exemplarCropPlan({ x: 0.5, y: 0.5 }, PAGE);
assert.ok(
  centerPlan.widthPx >= 512 && centerPlan.widthPx <= 768,
  "exemplar crop long side lands in the 512-768px target band",
);
assert.equal(centerPlan.widthPx, EXEMPLAR_TARGET_LONG_EDGE_PX, "square page-center crop is 640px");
assert.ok(
  Math.abs(centerPlan.markerInCropPx.px - centerPlan.widthPx / 2) < 1.01 &&
    Math.abs(centerPlan.markerInCropPx.py - centerPlan.heightPx / 2) < 1.01,
  "the marker sits at the crop center away from edges",
);
assert.equal(centerPlan.offsetX, -centerPlan.leftPx, "viewport offsetX cancels the crop origin");
assert.equal(centerPlan.offsetY, -centerPlan.topPx, "viewport offsetY cancels the crop origin");

const cornerPlan = exemplarCropPlan({ x: 0.001, y: 0.999 }, PAGE);
assert.equal(cornerPlan.leftPx, 0, "edge markers shift the window instead of shrinking it");
assert.equal(cornerPlan.widthPx, centerPlan.widthPx, "edge crops keep the full region size");
assert.ok(
  cornerPlan.markerInCropPx.px >= 0 && cornerPlan.markerInCropPx.py <= cornerPlan.heightPx,
  "edge markers stay inside the crop",
);

// --- Detection tile size vs the vision API's silent-resize thresholds ---
// (AITAKEOFF3 Task 0: the proven basis bug — 1400px tiles were 1.96 MP and
// got downscaled server-side, putting every pixel coordinate in a different
// basis than the tile we sliced.)

assert.ok(
  (DETECTION_TILE_PX * DETECTION_TILE_PX) / 1_000_000 <= 1.15,
  "RESIZE GUARD: a full tile stays under the API's ~1.15 MP downscale threshold",
);
assert.ok(DETECTION_TILE_PX <= 1568, "RESIZE GUARD: tile long edge stays under the 1568px cap");
assert.ok(
  DETECTION_TILE_OVERLAP_PX >= 96,
  "tile overlap still covers a full exemplar symbol footprint",
);

// --- 0-1000 normalized coordinate conversion (both directions) ---

assert.equal(NORMALIZED_COORD_MAX, 1000, "model coordinates are normalized 0-1000");
assert.equal(
  normalizedToTileLocalPx(500, 1024),
  512,
  "normalized center of a 1024px tile is 512px",
);
assert.equal(
  tileLocalPxToNormalized(512, 1024),
  500,
  "pixel center of a 1024px tile is 500 normalized",
);
for (const value of [0, 1, 250.5, 999, 1000]) {
  assert.ok(
    Math.abs(tileLocalPxToNormalized(normalizedToTileLocalPx(value, 1024), 1024) - value) < 1e-9,
    `normalized -> px -> normalized round trip is exact (${value})`,
  );
  assert.ok(
    Math.abs(normalizedToTileLocalPx(tileLocalPxToNormalized(value, 777), 777) - value) < 1e-9,
    `px -> normalized -> px round trip is exact (${value})`,
  );
}
assert.equal(tileLocalPxToNormalized(10, 0), 0, "zero-size image normalizes to 0, never NaN");

// --- Detection tiles + frames ---

const tiles = planDetectionTiles(3800, 2600);
assert.ok(tiles.length >= 4, "a full sheet needs multiple tiles");
assert.ok(
  tiles.every((tile) => tile.width <= DETECTION_TILE_PX && tile.height <= DETECTION_TILE_PX),
  "no tile exceeds the detection tile size",
);
for (let px = 0; px < 3800; px += 190) {
  for (let py = 0; py < 2600; py += 130) {
    assert.ok(
      tiles.some(
        (tile) =>
          px >= tile.left &&
          px < tile.left + tile.width &&
          py >= tile.top &&
          py < tile.top + tile.height,
      ),
      `point ${px},${py} is covered by a tile`,
    );
  }
}
const firstRow = tiles.filter((tile) => tile.top === tiles[0].top);
if (firstRow.length > 1) {
  assert.equal(
    firstRow[0].left + firstRow[0].width - firstRow[1].left,
    DETECTION_TILE_OVERLAP_PX,
    "horizontal overlap matches the configured seam",
  );
}

// Bounding-box centers still derive in tile pixels (coord-transforms API).
assert.deepEqual(
  bboxCenter({ x0: 100, y0: 200, x1: 140, y1: 240 }),
  { x: 120, y: 220 },
  "bbox centers derive from the box",
);

// Tile frames: local → sheet through the frame preserves the tile offset.
const frame = tileFrameFor({ left: 1304, top: 1300 }, 3800, 2600);
const mappedViaFrame = tileLocalToSheetPoint(frame, 700, 350);
assert.ok(
  Math.abs(mappedViaFrame.x - (1304 + 700) / 3800) < 1e-12,
  "tile x maps through the tile's sheet-space origin",
);
assert.ok(
  Math.abs(mappedViaFrame.y - (1300 + 350) / 2600) < 1e-12,
  "tile y maps through the tile's sheet-space origin",
);
// TILE-OFFSET GUARD: dropping the origin (the Phase A near-miss class of
// bug) lands far away from the true position.
const mappedWithoutOffset = tileLocalToSheetPoint(
  { ...frame, originSheetX: 0, originSheetY: 0 },
  700,
  350,
);
assert.ok(
  Math.hypot(mappedWithoutOffset.x - mappedViaFrame.x, mappedWithoutOffset.y - mappedViaFrame.y) >
    0.3,
  "TILE-OFFSET GUARD: a mapping that drops the tile origin is wildly off, never a near-miss pass",
);

// --- Strict-JSON stage-A scan response parsing (AITAKEOFF3 Task 1) ---
// Stage A is recall-biased: candidate CENTERS only, no self-reported
// confidence — stage-B verification is the filter now.

const goodResponse = parseScanResponse(
  JSON.stringify({
    exemplar_description: "Circular brush with radial spokes",
    candidates: [
      { x: 120, y: 220 },
      { x: 930.5, y: 105 },
    ],
  }),
  // A 1000px tile makes the 0-1000 normalized -> pixel conversion an
  // identity, so the numbers below stay readable.
  1000,
  1000,
);
assert.equal(
  goodResponse.exemplarDescription,
  "Circular brush with radial spokes",
  "the echo line parses first-class",
);
assert.equal(goodResponse.candidates.length, 2, "valid candidate centers parse");
assert.deepEqual(
  goodResponse.candidates[0],
  { x: 120, y: 220 },
  "candidate centers convert to tile-local pixels",
);

// The one normalized->pixel conversion: the same response against a 500px
// tile lands at half the pixel positions — coordinates are resize-invariant.
const scaledResponse = parseScanResponse('{"candidates": [{"x": 100, "y": 200}]}', 500, 500);
assert.deepEqual(
  scaledResponse.candidates[0],
  { x: 50, y: 100 },
  "normalized coordinates convert against the ACTUAL tile size",
);

const fenced = parseScanResponse(
  'Here you go:\n```json\n{"exemplar_description": "duplex outlet", "candidates": [{"x": 10, "y": 10}]}\n```',
  1000,
  1000,
);
assert.equal(fenced.exemplarDescription, "duplex outlet", "fenced responses still parse");
assert.equal(fenced.candidates.length, 1, "fenced candidates parse");

assert.deepEqual(
  parseScanResponse("no matches here", 1000, 1000),
  { exemplarDescription: "", candidates: [] },
  "prose-only responses yield nothing",
);
assert.deepEqual(
  parseScanResponse('{"exemplar_description": "a symbol", "candidates": []}', 1000, 1000)
    .candidates,
  [],
  "an empty candidates list is a first-class answer",
);
assert.equal(
  parseScanResponse('{"candidates": [{"x": 1100, "y": 40}, {"x": -5, "y": 40}]}', 1000, 1000)
    .candidates.length,
  0,
  "centers outside the 0-1000 basis are dropped",
);
assert.equal(
  parseScanResponse('{"candidates": [{"x": "left", "y": 40}, {"y": 12}, "spurious"]}', 1000, 1000)
    .candidates.length,
  0,
  "non-numeric or shapeless candidates are dropped",
);

// --- Confidence floor + per-sheet cap (AITAKEOFF2 Task 2) ---

assert.equal(DEFAULT_MIN_PROPOSAL_CONFIDENCE, 0.5, "confidence floor defaults to 0.5");
assert.equal(DEFAULT_MAX_PROPOSALS_PER_SHEET, 60, "per-sheet cap defaults to 60");
const floored = applyConfidenceFloor(
  [{ confidence: 0.9 }, { confidence: 0.5 }, { confidence: 0.49 }, { confidence: 0.1 }],
  0.5,
);
assert.equal(floored.length, 2, "matches below the floor never become ghosts");
assert.ok(
  floored.every((candidate) => candidate.confidence >= 0.5),
  "the floor is inclusive at exactly 0.5",
);
const manyCandidates = Array.from({ length: 80 }, (_, index) => ({
  confidence: index / 100,
  id: index,
}));
const capped = capProposalsPerSheet(manyCandidates, 60);
assert.equal(capped.length, 60, "runaway scans cap at the per-sheet limit");
assert.ok(
  capped.every((candidate) => candidate.confidence >= 0.2),
  "the cap keeps the highest-confidence proposals",
);
assert.equal(
  capProposalsPerSheet(manyCandidates.slice(0, 10), 60).length,
  10,
  "under the cap nothing is dropped",
);

// --- Dedupe + existing-point exclusion ---

const deduped = dedupeCandidates([
  { x: 0.5, y: 0.5, confidence: 0.6 },
  { x: 0.502, y: 0.5, confidence: 0.9 },
  { x: 0.8, y: 0.8, confidence: 0.3 },
]);
assert.equal(deduped.length, 2, "overlap-seam duplicates collapse");
assert.equal(
  deduped.find((c) => Math.abs(c.x - 0.5) < 0.01)?.confidence,
  0.9,
  "highest confidence wins the dedupe",
);

const filtered = excludeNearExistingPoints(
  [
    { x: 0.25, y: 0.25, confidence: 0.9 },
    { x: 0.75, y: 0.75, confidence: 0.9 },
  ],
  [{ x: 0.251, y: 0.249 }],
);
assert.equal(filtered.length, 1, "candidates on already-counted points drop out");
assert.equal(filtered[0].x, 0.75, "fresh candidates survive");

// --- Confidence sort (review order) ---

assert.equal(LOW_CONFIDENCE_THRESHOLD, 0.5, "low-confidence line is 0.5");
const reviewOrder = sortProposalsForReview([
  { id: "low-first", x: 0.1, y: 0.1, confidence: 0.2 },
  { id: "high-bottom", x: 0.2, y: 0.9, confidence: 0.9 },
  { id: "high-top", x: 0.9, y: 0.1, confidence: 0.7 },
  { id: "low-late", x: 0.9, y: 0.9, confidence: 0.49 },
] as Array<{ id: string; x: number; y: number; confidence: number }>);
assert.deepEqual(
  reviewOrder.map((p) => p.id),
  ["high-top", "high-bottom", "low-first", "low-late"],
  "confident proposals first in reading order; low-confidence sort LAST",
);

// --- Proposal → marker conversion ---

const firstAccept = appendAcceptedPoint([], { x: 0.4, y: 0.6 });
assert.equal(firstAccept.points.length, 1, "first accept creates the first point");
assert.equal(firstAccept.quantity, 1, "count quantity equals point count");
const secondAccept = appendAcceptedPoint(firstAccept.points, { x: 0.5, y: 0.7 });
assert.equal(secondAccept.points.length, 2, "accepts accumulate points");
assert.equal(secondAccept.quantity, 2, "quantity tracks every accepted point");
assert.equal(firstAccept.points.length, 1, "conversion never mutates its input");

// --- Stage-A scan instruction (recall-biased, AITAKEOFF3 Task 1) ---

const instruction = buildScanInstruction({ label: "Brush wheel" });
assert.match(instruction, /Brush wheel/, "instruction names the exemplar label");
assert.match(instruction, /exemplar_description/, "instruction demands the echo line");
assert.match(instruction, /FIRST/, "the echo comes before any matching");
assert.match(instruction, /"candidates"/, "stage A returns candidate centers");
assert.match(
  instruction,
  /err toward including uncertain/i,
  "stage A is recall-biased — stage B is the filter",
);
assert.match(
  instruction,
  /normalized 0-1000/,
  "coordinates are requested 0-1000 normalized — invariant to any resize",
);
assert.ok(
  !/\d+\s*x\s*\d+\s*pixel/i.test(instruction),
  "RESIZE GUARD: the prompt never declares pixel dimensions the model might not actually see",
);
assert.match(instruction, /never candidates/i, "text labels and title-block art stay excluded");
assert.match(
  instruction,
  /empty "candidates" list is a correct/,
  "an empty answer stays first-class",
);

// --- Stage-B verification (AITAKEOFF3 Task 2) ---

assert.equal(VERIFY_WINDOW_PX, 256, "the verification window is a 256px crop");
assert.equal(VERIFY_IMAGE_PX, 768, "the window upscales 3x before the model judges it");
assert.ok(
  VERIFIED_PROPOSAL_CONFIDENCE >= DEFAULT_MIN_PROPOSAL_CONFIDENCE,
  "a verified ghost passes the default confidence floor",
);
assert.equal(
  applyConfidenceFloor([{ confidence: VERIFIED_PROPOSAL_CONFIDENCE }]).length,
  1,
  "minProposalConfidence gates the stage-derived confidence, not model numbers",
);
assert.ok(
  COARSE_CANDIDATE_CONFIDENCE < VERIFIED_PROPOSAL_CONFIDENCE,
  "a coarse lead never outranks a verified ghost",
);

const centeredWindow = verifyWindowRect({ x: 1900, y: 1300 }, 3800, 2600);
assert.deepEqual(
  centeredWindow,
  { left: 1772, top: 1172, width: 256, height: 256 },
  "the verification window centers on the candidate",
);
assert.deepEqual(
  verifyWindowRect({ x: 10, y: 2590 }, 3800, 2600),
  { left: 0, top: 2344, width: 256, height: 256 },
  "edge candidates shift the window instead of shrinking it",
);
assert.deepEqual(
  verifyWindowRect({ x: 50, y: 50 }, 100, 80),
  { left: 0, top: 0, width: 100, height: 80 },
  "rasters smaller than the window clamp to the raster",
);

const verifyInstruction = buildVerifyInstruction({ label: "Brush wheel" });
assert.match(verifyInstruction, /Brush wheel/, "verify instruction names the exemplar label");
assert.match(verifyInstruction, /"match"/, "verdict is a boolean match");
assert.match(
  verifyInstruction,
  /partially inside the crop/,
  "partial symbols at the crop edge are rejections",
);
assert.match(verifyInstruction, /DIFFERENT symbol type/, "decoy symbol types are rejections");
assert.match(
  verifyInstruction,
  /normalized 0-1000/,
  "the stage-B center is normalized too — same resize-proof basis",
);

const confirmedVerdict = parseVerifyResponse(
  '{"match": true, "center": {"x": 500, "y": 250}}',
  256,
  256,
);
assert.equal(confirmedVerdict.match, true, "a literal true verdict verifies");
assert.deepEqual(
  confirmedVerdict.center,
  { x: 128, y: 64 },
  "the stage-B center converts against the WINDOW size (smaller denominator)",
);
assert.deepEqual(
  parseVerifyResponse('{"match": false}', 256, 256),
  { match: false, center: null },
  "a false verdict is a rejection",
);
assert.deepEqual(
  parseVerifyResponse('{"match": "yes", "center": {"x": 500, "y": 250}}', 256, 256),
  { match: false, center: null },
  "anything but a literal true fails closed",
);
assert.deepEqual(
  parseVerifyResponse("the crop looks similar to the exemplar", 256, 256),
  { match: false, center: null },
  "prose fails closed",
);
assert.deepEqual(
  parseVerifyResponse('{"match": true, "center": {', 256, 256),
  { match: false, center: null },
  "malformed JSON fails closed",
);
assert.deepEqual(
  parseVerifyResponse('{"match": true}', 256, 256),
  { match: true, center: null },
  "a confirmed match without a center still verifies — caller falls back to the candidate point",
);
assert.deepEqual(
  parseVerifyResponse('{"match": true, "center": {"x": 1400, "y": 3}}', 256, 256),
  { match: true, center: null },
  "an out-of-range center degrades to the fallback, never a fake position",
);

// --- Ink-centroid snap (AITAKEOFF4 Task 1) ---

// Synthetic RGBA painter: white canvas, paint dark rectangles.
function paintRgba(width: number, height: number, rects: Array<[number, number, number, number]>) {
  const rgba = new Uint8Array(width * height * 4).fill(255);
  for (const [rx, ry, rw, rh] of rects) {
    for (let y = ry; y < ry + rh; y += 1) {
      for (let x = rx; x < rx + rw; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = 0;
        rgba[offset + 1] = 0;
        rgba[offset + 2] = 0;
      }
    }
  }
  return rgba;
}

assert.ok(INK_LUMINANCE_THRESHOLD > 0 && INK_LUMINANCE_THRESHOLD < 255, "threshold is sane");
assert.equal(SNAP_SEARCH_RADIUS_PX, 40, "snap searches a small radius around the stage-B center");

// Mask round trip: RGBA -> mask -> base64 -> mask.
const maskSource = paintRgba(64, 64, [[20, 24, 9, 9]]);
const mask = inkMaskFromRgba(maskSource, 64, 64);
assert.equal(inkMaskGet(mask, 24, 28), true, "painted pixels read as ink");
assert.equal(inkMaskGet(mask, 5, 5), false, "paper reads as blank");
assert.equal(inkMaskGet(mask, -1, 5), false, "out-of-bounds reads as blank, never throws");
const maskWire = inkMaskFromBase64(inkMaskToBase64(mask), 64, 64);
assert.ok(maskWire, "the wire encoding decodes");
assert.deepEqual(Array.from(maskWire!.bits), Array.from(mask.bits), "bits survive the wire");
assert.equal(inkMaskFromBase64("%%%not-base64%%%", 64, 64), null, "garbage base64 fails closed");
assert.equal(
  inkMaskFromBase64(inkMaskToBase64(mask), 128, 128),
  null,
  "a mask that does not match the declared window size fails closed",
);

// Snap semantics: nearest blob's centroid wins; dust and linework never do.
// The 9x9 blob painted at [20,24] covers [20,29)x[24,33): its continuous
// centroid is (24.5, 28.5) — pixel centers, not pixel indices.
const blobCentroid = { x: 24.5, y: 28.5 };
const snapMask = inkMaskFromRgba(
  paintRgba(256, 256, [
    [20, 24, 9, 9], // the symbol
    [50, 50, 2, 2], // dust: below SNAP_MIN_COMPONENT_PIXELS
    [0, 200, 256, 3], // wall-to-wall linework: bounding box far over the cap
  ]),
  256,
  256,
);
const snapped = snapToInkCentroid(snapMask, { x: 30, y: 20 });
assert.ok(snapped, "a blob near the center snaps");
assert.ok(
  Math.hypot(snapped!.x - blobCentroid.x, snapped!.y - blobCentroid.y) < 0.6,
  "the snap lands on the blob's centroid",
);
assert.equal(
  snapToInkCentroid(snapMask, { x: 70, y: 60 }),
  null,
  "dust alone within the radius is never a snap target",
);
assert.equal(
  snapToInkCentroid(snapMask, { x: 70, y: 190 }),
  null,
  "oversized linework next to the center is never a snap target",
);
assert.equal(
  snapToInkCentroid(inkMaskFromRgba(paintRgba(256, 256, []), 256, 256), { x: 128, y: 128 }),
  null,
  "a blank window has nothing to snap to",
);
assert.equal(
  snapToInkCentroid(snapMask, { x: 110, y: 20 }),
  null,
  "a blob outside the search radius stays out of reach",
);

// --- Token-implied resize check (AITAKEOFF3 Task 3) ---

const oldWorldTokens = tileTokenCheck(2377, 1400, 1400, 640, 640);
assert.equal(
  oldWorldTokens.expectedTileTokens,
  2613,
  "a full 1400px tile alone costs ~2613 input tokens",
);
assert.equal(oldWorldTokens.exemplarTokens, 546, "a 640px exemplar costs ~546 tokens");
assert.equal(
  oldWorldTokens.tileImpliedTokens,
  2377 - 546 - 350,
  "the tile's own share subtracts the exemplar and the prompt allowance",
);
assert.ok(
  oldWorldTokens.suspectedResize,
  "RESIZE CHECK: the real A-100 numbers (2377 tokens on a 1400px tile) flag at a glance",
);
const newWorldTokens = tileTokenCheck(2244, 1024, 1024, 640, 640);
assert.ok(
  !newWorldTokens.suspectedResize,
  "a healthy 1024px tile with exemplar + prompt subtracted reads ok",
);
assert.equal(
  newWorldTokens.tileImpliedMegapixels,
  1.01,
  "the ISOLATED tile-implied megapixels sit next to the tile's true size",
);
assert.equal(newWorldTokens.tileMegapixels, 1.05, "tile megapixels recorded for the glance check");
assert.equal(
  tileTokenCheck(0, 1024, 1024, 640, 640).suspectedResize,
  false,
  "zero reported tokens never flags",
);
assert.equal(
  tileTokenCheck(2027 + 350, 1400, 1400).suspectedResize,
  true,
  "exemplar dims defaulting to zero still catches genuine under-coverage",
);

// --- Panel availability states ---

const notConfigured = aiAssistAvailability({
  configured: false,
  hasExemplar: true,
  balanceCredits: 50,
  quoteCredits: 1,
});
assert.equal(notConfigured.state, "not_configured");
assert.equal(
  notConfigured.message,
  AI_ASSIST_NOT_CONFIGURED_MESSAGE,
  'config-disabled state renders "AI assist not configured"',
);
const firstRun = aiAssistAvailability({
  configured: true,
  hasExemplar: false,
  balanceCredits: 50,
  quoteCredits: 1,
});
assert.equal(firstRun.state, "no_exemplar");
assert.equal(firstRun.message, AI_ASSIST_FIRST_RUN_MESSAGE, "first-run teaches the loop");
const broke = aiAssistAvailability({
  configured: true,
  hasExemplar: true,
  balanceCredits: 0,
  quoteCredits: 3,
});
assert.equal(broke.state, "out_of_credits", "insufficient balance routes to the buy panel");
const ready = aiAssistAvailability({
  configured: true,
  hasExemplar: true,
  balanceCredits: 10,
  quoteCredits: 10,
});
assert.equal(ready.state, "ready", "exact balance is enough to scan");

console.log("AI takeoff + credits smoke: pure-function assertions passed.");

// --- Rendered round-trip fixtures (AITAKEOFF2 Task 1) ---
// A generated PDF with a known glyph, rasterized headlessly (pdfjs legacy +
// @napi-rs/canvas), proves the real pipeline end to end: the exemplar crop
// contains the glyph (pixel sampling), the crop is clean paper elsewhere,
// and a mock model response at the glyph's tile-local position maps back to
// within a few PDF points of the truth.

const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfLib = require("pdf-lib") as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const napi = require("@napi-rs/canvas") as any;
// pdfjs needs a few DOM globals in Node; @napi-rs/canvas provides them.
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

// 1. Build an ARCH-D-ish landscape page with one solid glyph at a known spot.
//    PDF coordinates are BOTTOM-UP: (900, 200) sits toward the bottom-right.
const GLYPH_PDF = { xPt: 900, yPt: 200 };
const GLYPH_RADIUS_PT = 18;
const doc = await pdfLib.PDFDocument.create();
const page = doc.addPage([PAGE.widthPt, PAGE.heightPt]);
page.drawCircle({
  x: GLYPH_PDF.xPt,
  y: GLYPH_PDF.yPt,
  size: GLYPH_RADIUS_PT,
  color: pdfLib.rgb(0, 0, 0),
});
const pdfBytes = await doc.save();

const loadedPdf = await pdfjs.getDocument({ data: pdfBytes }).promise;
const pdfPage = await loadedPdf.getPage(1);
const trueSheetPoint = pdfPointToSheetPoint(GLYPH_PDF, PAGE);

const darknessAt = (
  context: { getImageData: (x: number, y: number, w: number, h: number) => { data: Uint8Array } },
  x: number,
  y: number,
) => {
  const data = context.getImageData(Math.round(x), Math.round(y), 1, 1).data;
  return data[0] + data[1] + data[2]; // 0 = black ink, 765 = white paper
};

const renderViewport = async (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page: any,
  viewport: { width: number; height: number },
  w: number,
  h: number,
) => {
  const canvas = napi.createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport }).promise;
  return context;
};

// 2. Our page-size convention matches pdfjs's viewport at scale 1.
const scale1 = pdfPage.getViewport({ scale: 1 });
assert.equal(scale1.width, PAGE.widthPt, "viewport@1 width is the page width in points");
assert.equal(scale1.height, PAGE.heightPt, "viewport@1 height is the page height in points");

// 3. pdfjs is the oracle for our sheet→pixel transform (Y flip included).
const oracleViewport = pdfPage.getViewport({ scale: 2.5 });
const [oracleX, oracleY] = oracleViewport.convertToViewportPoint(GLYPH_PDF.xPt, GLYPH_PDF.yPt);
const ours = sheetPointToRenderPixel(trueSheetPoint, PAGE, 2.5);
assert.ok(
  Math.abs(ours.px - oracleX) < 0.01 && Math.abs(ours.py - oracleY) < 0.01,
  "our transform agrees with pdfjs convertToViewportPoint (Y flip included)",
);

// 4. EXEMPLAR CROP: the region render around the marker contains the glyph.
const plan = exemplarCropPlan(trueSheetPoint, PAGE);
const cropContext = await renderViewport(
  pdfPage,
  pdfPage.getViewport({ scale: plan.scale, offsetX: plan.offsetX, offsetY: plan.offsetY }),
  plan.widthPx,
  plan.heightPx,
);
assert.ok(
  darknessAt(cropContext, plan.markerInCropPx.px, plan.markerInCropPx.py) < 200,
  "EXEMPLAR PROOF: the glyph's ink is at the marker position inside the crop",
);
assert.ok(
  darknessAt(cropContext, 4, 4) > 700,
  "the crop's far corner is clean paper (no stray offset content)",
);
// FOOTPRINT MEASUREMENT (AITAKEOFF5 Task 0): the client measures the
// symbol's ink footprint on the exemplar crop and converts crop px -> PDF
// points -> per-sheet detection-raster px. The fixture glyph is a filled
// 18pt-radius circle: 36pt across, ~80px in the crop, 90px on the raster.
const cropImage = cropContext.getImageData(0, 0, plan.widthPx, plan.heightPx);
const cropMask = inkMaskFromRgba(cropImage.data, plan.widthPx, plan.heightPx);
const footprintCropPx = measureInkFootprintPx(cropMask, {
  x: plan.markerInCropPx.px,
  y: plan.markerInCropPx.py,
});
assert.ok(footprintCropPx, "the exemplar crop yields a measurable footprint");
const footprintPt = footprintCropPx! / plan.scale;
assert.ok(
  Math.abs(footprintPt - 2 * GLYPH_RADIUS_PT) < 3,
  `measured footprint is the glyph diameter in PDF points (got ${footprintPt.toFixed(1)}pt)`,
);
// Y-FLIP REGRESSION GUARD: planning the crop with a Y-mirrored marker (the
// exact Phase-A-suspect bug) must produce EMPTY paper at its center.
const mirroredPlan = exemplarCropPlan({ x: trueSheetPoint.x, y: 1 - trueSheetPoint.y }, PAGE);
const mirroredContext = await renderViewport(
  pdfPage,
  pdfPage.getViewport({
    scale: mirroredPlan.scale,
    offsetX: mirroredPlan.offsetX,
    offsetY: mirroredPlan.offsetY,
  }),
  mirroredPlan.widthPx,
  mirroredPlan.heightPx,
);
assert.ok(
  darknessAt(mirroredContext, mirroredPlan.markerInCropPx.px, mirroredPlan.markerInCropPx.py) > 700,
  "Y-FLIP GUARD: a crop planned with the mirrored Y lands on empty paper — the bug cannot hide",
);

// 5. DETECTION RASTER + TILE ROUND TRIP: a mock model response at the
//    glyph's tile-local position maps back to the true sheet position.
const detectionScale = DETECTION_LONG_EDGE_PX / Math.max(PAGE.widthPt, PAGE.heightPt);
const rasterWidthPx = Math.round(PAGE.widthPt * detectionScale);
const rasterHeightPx = Math.round(PAGE.heightPt * detectionScale);
const rasterContext = await renderViewport(
  pdfPage,
  pdfPage.getViewport({ scale: detectionScale }),
  rasterWidthPx,
  rasterHeightPx,
);
const glyphRasterPx = sheetPointToRenderPixel(trueSheetPoint, PAGE, detectionScale);
assert.ok(
  darknessAt(rasterContext, glyphRasterPx.px, glyphRasterPx.py) < 200,
  "the detection raster has the glyph exactly where the transform says it is",
);

const detectionTiles = planDetectionTiles(rasterWidthPx, rasterHeightPx);
// The seam overlap must make the WHOLE symbol visible in at least one tile —
// a glyph clipped at a tile edge is exactly what the prompt tells the model
// not to match, so the fixture (like the real pipeline) relies on the
// overlapping neighbor.
const glyphRadiusPx = GLYPH_RADIUS_PT * detectionScale;
const glyphTile = detectionTiles.find(
  (tile) =>
    glyphRasterPx.px - glyphRadiusPx >= tile.left &&
    glyphRasterPx.px + glyphRadiusPx <= tile.left + tile.width &&
    glyphRasterPx.py - glyphRadiusPx >= tile.top &&
    glyphRasterPx.py + glyphRadiusPx <= tile.top + tile.height,
);
assert.ok(glyphTile, "OVERLAP GUARD: some tile contains the whole glyph, not a clipped sliver");
const glyphLocal = { x: glyphRasterPx.px - glyphTile!.left, y: glyphRasterPx.py - glyphTile!.top };

// The mock model reports the glyph's CENTER in 0-1000 normalized
// coordinates of the tile — exactly what the AITAKEOFF3 stage-A prompt asks
// for. One-decimal rounding simulates realistic model output precision.
const round1 = (value: number) => Math.round(value * 10) / 10;
const mockResponse = JSON.stringify({
  exemplar_description: "A solid filled circle",
  candidates: [
    {
      x: round1(tileLocalPxToNormalized(glyphLocal.x, glyphTile!.width)),
      y: round1(tileLocalPxToNormalized(glyphLocal.y, glyphTile!.height)),
    },
  ],
});
const parsedMock = parseScanResponse(mockResponse, glyphTile!.width, glyphTile!.height);
assert.equal(parsedMock.candidates.length, 1, "the mock candidate parses");
const mockCenter = parsedMock.candidates[0];
const glyphFrame = tileFrameFor(glyphTile!, rasterWidthPx, rasterHeightPx);
const mappedSheet = tileLocalToSheetPoint(glyphFrame, mockCenter.x, mockCenter.y);

// Measure the miss in PDF points; the tolerance is the normalized-coordinate
// quantization bound, nothing looser.
const mappedPdf = sheetPointToPdfPoint(mappedSheet, PAGE);
const errPt = Math.hypot(mappedPdf.xPt - GLYPH_PDF.xPt, mappedPdf.yPt - GLYPH_PDF.yPt);
assert.ok(
  errPt < 0.042,
  `ROUND-TRIP PROOF: normalized mock response maps back within 0.042 PDF points of truth (got ${errPt.toFixed(4)}pt)`,
);

// DOWNSCALE-INVARIANCE REGRESSION (the point of normalized coordinates): a
// silent server-side resize of the tile must not move the mapped point. The
// model sees a 784px version of the 1024px tile and answers 0-1000 relative
// to WHAT IT SEES; the mapping still lands on the glyph.
const DOWNSCALED_TILE_PX = 784;
const downscale = DOWNSCALED_TILE_PX / glyphTile!.width;
const glyphOnDownscaled = { x: glyphLocal.x * downscale, y: glyphLocal.y * downscale };
const downscaledResponse = JSON.stringify({
  exemplar_description: "A solid filled circle",
  candidates: [
    {
      x: round1(tileLocalPxToNormalized(glyphOnDownscaled.x, DOWNSCALED_TILE_PX)),
      y: round1(tileLocalPxToNormalized(glyphOnDownscaled.y, DOWNSCALED_TILE_PX)),
    },
  ],
});
const parsedDownscaled = parseScanResponse(downscaledResponse, glyphTile!.width, glyphTile!.height);
assert.equal(parsedDownscaled.candidates.length, 1, "the downscaled-image mock candidate parses");
const downscaledCenter = parsedDownscaled.candidates[0];
const downscaledSheet = tileLocalToSheetPoint(glyphFrame, downscaledCenter.x, downscaledCenter.y);
const downscaledPdf = sheetPointToPdfPoint(downscaledSheet, PAGE);
const downscaledErrPt = Math.hypot(
  downscaledPdf.xPt - GLYPH_PDF.xPt,
  downscaledPdf.yPt - GLYPH_PDF.yPt,
);
assert.ok(
  downscaledErrPt < 0.06,
  `DOWNSCALE GUARD: coordinates from a resized image still map onto the glyph (got ${downscaledErrPt.toFixed(4)}pt)`,
);
// The AITAKEOFF2 failure mode for contrast: treating the downscaled image's
// PIXELS as tile-local pixels displaces the point toward the tile's
// top-left by the resize factor — never a quiet near-miss.
const wrongBasisSheet = tileLocalToSheetPoint(glyphFrame, glyphOnDownscaled.x, glyphOnDownscaled.y);
const wrongBasisPdf = sheetPointToPdfPoint(wrongBasisSheet, PAGE);
assert.ok(
  Math.hypot(wrongBasisPdf.xPt - GLYPH_PDF.xPt, wrongBasisPdf.yPt - GLYPH_PDF.yPt) > 20,
  "PIXEL-BASIS GUARD: the old pixel interpretation of a resized image misses by tens of points",
);

// 6. STAGE-B WINDOW PROOF: the verification window around the mapped
//    candidate contains the glyph's ink, and a normalized verdict center
//    maps back through the window's frame — the same tested transform with
//    a 256px denominator, so the absolute error shrinks proportionally.
const windowRect = verifyWindowRect(
  { x: glyphRasterPx.px, y: glyphRasterPx.py },
  rasterWidthPx,
  rasterHeightPx,
);
assert.equal(windowRect.width, 256, "the window is the full 256px on a real sheet");
const glyphInWindow = {
  x: glyphRasterPx.px - windowRect.left,
  y: glyphRasterPx.py - windowRect.top,
};
assert.ok(
  darknessAt(rasterContext, windowRect.left + glyphInWindow.x, windowRect.top + glyphInWindow.y) <
    200,
  "STAGE-B PROOF: the verification window is centered on the glyph's ink",
);
const verifyMock = JSON.stringify({
  match: true,
  center: {
    x: round1(tileLocalPxToNormalized(glyphInWindow.x, windowRect.width)),
    y: round1(tileLocalPxToNormalized(glyphInWindow.y, windowRect.height)),
  },
});
const verdict = parseVerifyResponse(verifyMock, windowRect.width, windowRect.height);
assert.equal(verdict.match, true, "the glyph window verifies");
assert.ok(verdict.center, "the verdict carries a usable center");
const windowFrame = tileFrameFor(windowRect, rasterWidthPx, rasterHeightPx);
const verifiedSheet = tileLocalToSheetPoint(windowFrame, verdict.center!.x, verdict.center!.y);
const verifiedPdf = sheetPointToPdfPoint(verifiedSheet, PAGE);
const verifiedErrPt = Math.hypot(verifiedPdf.xPt - GLYPH_PDF.xPt, verifiedPdf.yPt - GLYPH_PDF.yPt);
assert.ok(
  verifiedErrPt < 0.042,
  `STAGE-B PROOF: the verdict center maps back within 0.042 PDF points of truth (got ${verifiedErrPt.toFixed(4)}pt)`,
);

// Y-FLIP REGRESSION GUARD (mapping side): flipping the mapped Y misses badly.
const flippedErrPt = Math.hypot(
  mappedPdf.xPt - GLYPH_PDF.xPt,
  PAGE.heightPt - mappedPdf.yPt - GLYPH_PDF.yPt,
);
assert.ok(
  flippedErrPt > 50,
  "Y-FLIP GUARD: a Y-flipped mapping is off by hundreds of points, never a quiet near-miss",
);

console.log(
  `AI takeoff round-trip fixtures passed: exemplar crop verified by pixel sampling, tile mapping within ${errPt.toFixed(3)}pt of truth.`,
);

// --- Two-stage fixture (AITAKEOFF3 Task 5): 3 glyphs + 1 decoy + 1 ghost ---
// A second generated page: three circle glyphs at known spots, one filled
// SQUARE decoy (same size, different symbol type), and one deliberate
// hallucination on blank paper. Stage A mocks recall-biased candidate lists
// per tile; everything else is the real pipeline — tiling, frames,
// normalized parsing, cross-tile dedupe, the runaway cap, real verification
// windows pixel-sampled from the raster, and verdict mapping. The decoy and
// the hallucination MUST die in stage B; the three circles MUST verify
// within the stage-B quantization tolerance.

// Fractional PDF positions on purpose: raster pixels land off-grid, so the
// 0-1000 rounding actually quantizes and the tolerance assertion means it.
const CIRCLES_PDF = [
  { xPt: 380.3, yPt: 750.29 }, // raster ~(950.8, 499.3)
  { xPt: 1120.13, yPt: 230.17 }, // raster ~(2800.3, 1799.6) — covered by many tiles
  { xPt: 200.37, yPt: 150.41 }, // raster ~(500.9, 1999.0)
  // SEAM GLYPH (AITAKEOFF5 Task 0): center at raster x=1023 — one pixel
  // inside tile 0's right edge, so the whole 90px glyph only fits inside a
  // NEIGHBOR tile. The footprint-derived overlap must make that neighbor
  // exist; footprint-scaled dedupe must collapse the double proposal.
  { xPt: 409.2, yPt: 830 }, // raster (1023, 300)
];
const DECOY_PDF = { xPt: 600, yPt: 550 }; // raster (1500, 1000)
const doc2 = await pdfLib.PDFDocument.create();
const page2 = doc2.addPage([PAGE.widthPt, PAGE.heightPt]);
for (const spot of CIRCLES_PDF) {
  page2.drawCircle({
    x: spot.xPt,
    y: spot.yPt,
    size: GLYPH_RADIUS_PT,
    color: pdfLib.rgb(0, 0, 0),
  });
}
page2.drawRectangle({
  x: DECOY_PDF.xPt - GLYPH_RADIUS_PT,
  y: DECOY_PDF.yPt - GLYPH_RADIUS_PT,
  width: GLYPH_RADIUS_PT * 2,
  height: GLYPH_RADIUS_PT * 2,
  color: pdfLib.rgb(0, 0, 0),
});
const loadedPdf2 = await pdfjs.getDocument({ data: await doc2.save() }).promise;
const pdfPage2 = await loadedPdf2.getPage(1);
const raster2 = await renderViewport(
  pdfPage2,
  pdfPage2.getViewport({ scale: detectionScale }),
  rasterWidthPx,
  rasterHeightPx,
);

// Exemplar-derived tiling for this sheet (AITAKEOFF5 Task 0), exactly as the
// client computes it: measured footprint (PDF pt) -> raster px -> overlap.
const footprintRasterPx = footprintPt * detectionScale;
const tileOverlap2 = overlapForFootprintPx(footprintRasterPx);
assert.equal(tileOverlap2, 135, "the 90px fixture footprint sizes a 135px overlap");
assert.ok(
  tileOverlap2 >= 1.5 * footprintRasterPx - 1,
  "the overlap covers 1.5x the symbol footprint",
);
const detectionTiles2 = planDetectionTiles(rasterWidthPx, rasterHeightPx, undefined, tileOverlap2);
const dedupeRadius2 = dedupeRadiusForFootprint(
  footprintRasterPx,
  Math.max(rasterWidthPx, rasterHeightPx),
);

const circleRasterPx = CIRCLES_PDF.map((spot) => pdfPointToRenderPixel(spot, PAGE, detectionScale));
const decoyRasterPx = pdfPointToRenderPixel(DECOY_PDF, PAGE, detectionScale);
for (const [index, spot] of circleRasterPx.entries()) {
  assert.ok(darknessAt(raster2, spot.px, spot.py) < 200, `circle ${index} ink is where planned`);
}
assert.ok(
  darknessAt(raster2, decoyRasterPx.px, decoyRasterPx.py) < 200,
  "decoy ink is where planned",
);
const HALLUCINATION_RASTER = { px: 2200, py: 500 };
assert.ok(
  darknessAt(raster2, HALLUCINATION_RASTER.px, HALLUCINATION_RASTER.py) > 700,
  "the planted hallucination spot is blank paper",
);

// Stage A: per tile, the mock lists every shape center inside the tile
// (recall bias includes the decoy) plus the hallucination — then the REAL
// parse/frame/map path turns them into sheet-space coarse candidates.
// The whole-symbol guarantee the overlap provides: every planted glyph fits
// entirely inside at least one tile (the seam glyph forces the interesting
// case — it does NOT fit in the tile its center sits in).
const glyphHalf = GLYPH_RADIUS_PT * detectionScale;
for (const [index, spot] of circleRasterPx.entries()) {
  assert.ok(
    detectionTiles2.some(
      (tile) =>
        spot.px - glyphHalf >= tile.left &&
        spot.px + glyphHalf <= tile.left + tile.width &&
        spot.py - glyphHalf >= tile.top &&
        spot.py + glyphHalf <= tile.top + tile.height,
    ),
    `OVERLAP GUARD: glyph ${index} fits whole in at least one tile`,
  );
}
const seamGlyphPx = circleRasterPx[3];
const seamHomeTile = detectionTiles2.find(
  (tile) =>
    seamGlyphPx.px >= tile.left &&
    seamGlyphPx.px < tile.left + tile.width &&
    seamGlyphPx.py >= tile.top &&
    seamGlyphPx.py < tile.top + tile.height &&
    tile.left === 0,
);
assert.ok(seamHomeTile, "the seam glyph's center sits in the left-edge tile");
assert.ok(
  seamGlyphPx.px + glyphHalf > seamHomeTile!.left + seamHomeTile!.width,
  "SEAM CASE: the glyph spills past its home tile's right edge — only the overlap neighbor sees it whole",
);

const stageAShapes = [...circleRasterPx, decoyRasterPx, HALLUCINATION_RASTER];
const coarse2: Array<{ x: number; y: number; confidence: number }> = [];
for (const tile of detectionTiles2) {
  const entries = stageAShapes
    .filter(
      (spot) =>
        spot.px >= tile.left &&
        spot.px < tile.left + tile.width &&
        spot.py >= tile.top &&
        spot.py < tile.top + tile.height,
    )
    .map((spot) => ({
      x: round1(tileLocalPxToNormalized(spot.px - tile.left, tile.width)),
      y: round1(tileLocalPxToNormalized(spot.py - tile.top, tile.height)),
    }));
  const parsed2 = parseScanResponse(
    JSON.stringify({ exemplar_description: "A solid filled circle", candidates: entries }),
    tile.width,
    tile.height,
  );
  const tileFrame = tileFrameFor(tile, rasterWidthPx, rasterHeightPx);
  for (const candidate of parsed2.candidates) {
    coarse2.push({
      ...tileLocalToSheetPoint(tileFrame, candidate.x, candidate.y),
      confidence: COARSE_CANDIDATE_CONFIDENCE,
    });
  }
}
assert.ok(
  coarse2.length > stageAShapes.length,
  "tile overlap produced duplicate coarse candidates (the seam did its job)",
);
const toVerify2 = capProposalsPerSheet(
  dedupeCandidates(coarse2, dedupeRadius2),
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
);
assert.equal(
  toVerify2.length,
  stageAShapes.length,
  "cross-tile dedupe collapses seam duplicates before any verification is bought",
);
// The seam glyph specifically: proposed and surviving dedupe exactly ONCE —
// not zero (recall hole), not two (seam double-proposal).
assert.equal(
  toVerify2.filter(
    (candidate) =>
      Math.hypot(
        candidate.x * rasterWidthPx - seamGlyphPx.px,
        candidate.y * rasterHeightPx - seamGlyphPx.py,
      ) < 5,
  ).length,
  1,
  "SEAM PROOF: the seam glyph is proposed exactly once",
);

// Stage B: real windows, pixel-sampled; mock verdicts confirm circles only.
// Each circle's mocked verdict center is perturbed by up to 15px (AITAKEOFF4
// Task 1): the deterministic ink-centroid snap must recover the true center.
const SNAP_PERTURBATIONS = [
  { dx: 12, dy: -9 },
  { dx: -15, dy: 4 },
  { dx: 7, dy: 14 },
  { dx: -10, dy: -12 }, // the seam glyph gets perturbed too
];
const verified2: Array<{ x: number; y: number }> = [];
let rejected2 = 0;
let snapRecoveries = 0;
for (const candidate of toVerify2) {
  const centerPx = { x: candidate.x * rasterWidthPx, y: candidate.y * rasterHeightPx };
  const rect = verifyWindowRect(centerPx, rasterWidthPx, rasterHeightPx);
  const windowFrame2 = tileFrameFor(rect, rasterWidthPx, rasterHeightPx);
  const circleIndex = circleRasterPx.findIndex(
    (spot) => Math.hypot(spot.px - centerPx.x, spot.py - centerPx.y) < 5,
  );
  const circleHit = circleIndex >= 0 ? circleRasterPx[circleIndex] : undefined;
  const decoyHit = Math.hypot(decoyRasterPx.px - centerPx.x, decoyRasterPx.py - centerPx.y) < 5;
  if (circleHit || decoyHit) {
    // The window the model judges really contains the symbol's ink.
    const inkSpot = circleHit ?? decoyRasterPx;
    assert.ok(
      inkSpot.px >= rect.left &&
        inkSpot.px < rect.left + rect.width &&
        inkSpot.py >= rect.top &&
        inkSpot.py < rect.top + rect.height,
      "the verification window contains the shape it was cut for",
    );
    assert.ok(darknessAt(raster2, inkSpot.px, inkSpot.py) < 200, "window target has ink");
  } else {
    // The hallucination window is blank — exactly what stage B rejects.
    assert.ok(
      darknessAt(raster2, centerPx.x, centerPx.y) > 700,
      "the hallucination window is empty paper",
    );
  }
  const perturbation = circleHit ? SNAP_PERTURBATIONS[circleIndex] : { dx: 0, dy: 0 };
  const verdictText = circleHit
    ? JSON.stringify({
        match: true,
        center: {
          x: round1(
            tileLocalPxToNormalized(circleHit.px - rect.left + perturbation.dx, rect.width),
          ),
          y: round1(
            tileLocalPxToNormalized(circleHit.py - rect.top + perturbation.dy, rect.height),
          ),
        },
      })
    : JSON.stringify({ match: false });
  const verdict2 = parseVerifyResponse(verdictText, rect.width, rect.height);
  // The snap mask travels exactly as it does on the wire: RGBA from the
  // raster window -> bit-packed mask -> base64 -> decoded server-side.
  const windowImage = raster2.getImageData(rect.left, rect.top, rect.width, rect.height);
  const wireMask = inkMaskFromBase64(
    inkMaskToBase64(inkMaskFromRgba(windowImage.data, rect.width, rect.height)),
    rect.width,
    rect.height,
  );
  assert.ok(wireMask, "the window's ink mask survives the wire encoding");
  if (verdict2.match && verdict2.center) {
    const snapped2 = snapToInkCentroid(wireMask!, verdict2.center);
    if (circleHit) {
      assert.ok(snapped2, "SNAP PROOF: the glyph's ink blob is found from a perturbed center");
      const correction = Math.hypot(
        snapped2!.x - verdict2.center.x,
        snapped2!.y - verdict2.center.y,
      );
      assert.ok(
        correction > Math.hypot(perturbation.dx, perturbation.dy) - 2,
        `the snap actually corrected the perturbation (moved ${correction.toFixed(1)}px)`,
      );
      snapRecoveries += 1;
    }
    const finalCenter = snapped2 ?? verdict2.center;
    verified2.push(tileLocalToSheetPoint(windowFrame2, finalCenter.x, finalCenter.y));
  } else {
    // Rejected candidates never snap; the hallucination's window must also
    // have no blob at all — its mask is blank around the center.
    if (
      !circleHit &&
      Math.hypot(decoyRasterPx.px - centerPx.x, decoyRasterPx.py - centerPx.y) >= 5
    ) {
      assert.equal(
        snapToInkCentroid(wireMask!, {
          x: centerPx.x - rect.left,
          y: centerPx.y - rect.top,
        }),
        null,
        "the hallucination window has no ink blob to snap to",
      );
    }
    rejected2 += 1;
  }
}
assert.equal(snapRecoveries, 4, "every glyph went through the perturbed-center snap path");
assert.equal(verified2.length, 4, "TWO-STAGE PROOF: exactly the four true symbols verify");
assert.equal(rejected2, 2, "TWO-STAGE PROOF: the decoy and the hallucination die in stage B");

const matchedCircles = new Set<number>();
let worstVerifiedErrPt = 0;
for (const point of verified2) {
  const pdf = sheetPointToPdfPoint(point, PAGE);
  let bestIndex = -1;
  let bestErr = Number.POSITIVE_INFINITY;
  for (const [index, truth] of CIRCLES_PDF.entries()) {
    const err = Math.hypot(truth.xPt - pdf.xPt, truth.yPt - pdf.yPt);
    if (err < bestErr) {
      bestErr = err;
      bestIndex = index;
    }
  }
  assert.ok(
    bestErr < 0.042,
    `TWO-STAGE PROOF: verified point lands within 0.042pt of a true symbol (got ${bestErr.toFixed(4)}pt)`,
  );
  matchedCircles.add(bestIndex);
  worstVerifiedErrPt = Math.max(worstVerifiedErrPt, bestErr);
}
assert.equal(matchedCircles.size, 4, "each verified point maps to a DISTINCT true symbol");

console.log(
  `AI takeoff two-stage fixture passed: 4 glyphs (incl. seam) verified within ${worstVerifiedErrPt.toFixed(4)}pt, decoy and hallucination rejected in stage B.`,
);
