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
  capProposalsPerSheet,
  dedupeCandidates,
  DEFAULT_MAX_PROPOSALS_PER_SHEET,
  DEFAULT_MIN_PROPOSAL_CONFIDENCE,
  DETECTION_LONG_EDGE_PX,
  DETECTION_TILE_OVERLAP_PX,
  DETECTION_TILE_PX,
  excludeNearExistingPoints,
  LOW_CONFIDENCE_THRESHOLD,
  matchCenters,
  NORMALIZED_COORD_MAX,
  normalizedToTileLocalPx,
  parseScanResponse,
  planDetectionTiles,
  sortProposalsForReview,
  tileLocalPxToNormalized,
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

const PAGE: PdfPageSize = { widthPt: 1224, heightPt: 792 };

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
assert.ok(Math.abs(glyphSheet.x - 900 / 1224) < 1e-12, "pdf→sheet x");
assert.ok(Math.abs(glyphSheet.y - (1 - 200 / 792)) < 1e-12, "pdf→sheet y flips");

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

// --- Strict-JSON scan response parsing (AITAKEOFF2 Task 2) ---

const goodResponse = parseScanResponse(
  JSON.stringify({
    exemplar_description: "Circular brush with radial spokes",
    matches: [
      { x0: 100, y0: 200, x1: 140, y1: 240, confidence: 0.92 },
      { x0: 900, y0: 80, x1: 960, y1: 130, confidence: 0.4 },
    ],
  }),
  // A 1000px tile makes the 0-1000 normalized -> pixel conversion an
  // identity, so the box math below stays readable.
  1000,
  1000,
);
assert.equal(
  goodResponse.exemplarDescription,
  "Circular brush with radial spokes",
  "the echo line parses first-class",
);
assert.equal(goodResponse.matches.length, 2, "valid boxes parse");
assert.deepEqual(
  bboxCenter(goodResponse.matches[0]),
  { x: 120, y: 220 },
  "centers derive server-side from the box",
);
assert.deepEqual(
  matchCenters(goodResponse.matches)[0],
  { x: 120, y: 220, confidence: 0.92 },
  "matchCenters carries confidence through",
);

// The one normalized->pixel conversion: the same response against a 500px
// tile lands at half the pixel positions — coordinates are resize-invariant.
const scaledResponse = parseScanResponse(
  '{"matches": [{"x0": 100, "y0": 200, "x1": 140, "y1": 240, "confidence": 0.9}]}',
  500,
  500,
);
assert.deepEqual(
  bboxCenter(scaledResponse.matches[0]),
  { x: 60, y: 110 },
  "normalized coordinates convert against the ACTUAL tile size",
);

const fenced = parseScanResponse(
  'Here you go:\n```json\n{"exemplar_description": "duplex outlet", "matches": [{"x0": 10, "y0": 10, "x1": 30, "y1": 30, "confidence": 1.7}]}\n```',
  1000,
  1000,
);
assert.equal(fenced.exemplarDescription, "duplex outlet", "fenced responses still parse");
assert.equal(fenced.matches[0].confidence, 1, "confidence clamps to [0,1]");

assert.deepEqual(
  parseScanResponse("no matches here", 1000, 1000),
  { exemplarDescription: "", matches: [] },
  "prose-only responses yield nothing",
);
assert.deepEqual(
  parseScanResponse('{"exemplar_description": "a symbol", "matches": []}', 1000, 1000).matches,
  [],
  "an empty matches list is a first-class answer",
);
assert.equal(
  parseScanResponse(
    '{"matches": [{"x0": 50, "y0": 50, "x1": 40, "y1": 60, "confidence": 1}]}',
    1000,
    1000,
  ).matches.length,
  0,
  "inverted boxes are dropped",
);
assert.equal(
  parseScanResponse(
    '{"matches": [{"x0": 0, "y0": 0, "x1": 900, "y1": 900, "confidence": 1}]}',
    1000,
    1000,
  ).matches.length,
  0,
  "boxes spanning more than half the image are model confusion, not matches",
);
assert.equal(
  parseScanResponse(
    '{"matches": [{"x0": 950, "y0": 10, "x1": 1100, "y1": 40, "confidence": 1}]}',
    1000,
    1000,
  ).matches.length,
  0,
  "boxes outside the 0-1000 basis are dropped",
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

// --- Hardened scan instruction (AITAKEOFF2 Task 2) ---

const instruction = buildScanInstruction({ label: "Brush wheel" });
assert.match(instruction, /Brush wheel/, "instruction names the exemplar label");
assert.match(instruction, /exemplar_description/, "instruction demands the echo line");
assert.match(instruction, /FIRST/, "the echo comes before any matching");
assert.match(instruction, /x0/, "matches come back as bounding boxes");
assert.match(
  instruction,
  /normalized 0-1000/,
  "coordinates are requested 0-1000 normalized — invariant to any resize",
);
assert.ok(
  !/\d+\s*x\s*\d+\s*pixel/i.test(instruction),
  "RESIZE GUARD: the prompt never declares pixel dimensions the model might not actually see",
);
assert.match(instruction, /NEVER matches/, "empty and ambiguous regions are never matches");
assert.match(instruction, /leave it out/i, "empty list beats guessing");
assert.match(instruction, /confidence between 0 and 1/, "per-match confidence required");
assert.match(instruction, /same symbol TYPE/, "same-symbol-type-only rule is explicit");

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
  viewport: { width: number; height: number },
  w: number,
  h: number,
) => {
  const canvas = napi.createCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await pdfPage.render({ canvasContext: context, viewport }).promise;
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
// Y-FLIP REGRESSION GUARD: planning the crop with a Y-mirrored marker (the
// exact Phase-A-suspect bug) must produce EMPTY paper at its center.
const mirroredPlan = exemplarCropPlan({ x: trueSheetPoint.x, y: 1 - trueSheetPoint.y }, PAGE);
const mirroredContext = await renderViewport(
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

// The mock model reports a small box around the glyph in 0-1000 normalized
// coordinates of the tile — exactly what the AITAKEOFF3 prompt asks for.
// One-decimal rounding simulates realistic model output precision.
const round1 = (value: number) => Math.round(value * 10) / 10;
const mockResponse = JSON.stringify({
  exemplar_description: "A solid filled circle",
  matches: [
    {
      x0: round1(tileLocalPxToNormalized(glyphLocal.x - glyphRadiusPx, glyphTile!.width)),
      y0: round1(tileLocalPxToNormalized(glyphLocal.y - glyphRadiusPx, glyphTile!.height)),
      x1: round1(tileLocalPxToNormalized(glyphLocal.x + glyphRadiusPx, glyphTile!.width)),
      y1: round1(tileLocalPxToNormalized(glyphLocal.y + glyphRadiusPx, glyphTile!.height)),
      confidence: 0.95,
    },
  ],
});
const parsedMock = parseScanResponse(mockResponse, glyphTile!.width, glyphTile!.height);
assert.equal(parsedMock.matches.length, 1, "the mock box parses");
const mockCenter = matchCenters(parsedMock.matches)[0];
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
  matches: [
    {
      x0: round1(tileLocalPxToNormalized(glyphOnDownscaled.x - 2, DOWNSCALED_TILE_PX)),
      y0: round1(tileLocalPxToNormalized(glyphOnDownscaled.y - 2, DOWNSCALED_TILE_PX)),
      x1: round1(tileLocalPxToNormalized(glyphOnDownscaled.x + 2, DOWNSCALED_TILE_PX)),
      y1: round1(tileLocalPxToNormalized(glyphOnDownscaled.y + 2, DOWNSCALED_TILE_PX)),
      confidence: 0.95,
    },
  ],
});
const parsedDownscaled = parseScanResponse(downscaledResponse, glyphTile!.width, glyphTile!.height);
assert.equal(parsedDownscaled.matches.length, 1, "the downscaled-image mock box parses");
const downscaledCenter = matchCenters(parsedDownscaled.matches)[0];
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
