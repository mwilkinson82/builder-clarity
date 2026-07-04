// AI takeoff + credits smoke (AITAKEOFF1 Task 4).
// Pure-function unit checks: ledger balance math + refund compensation, API
// cost from the config price table, proposal→marker conversion, confidence
// sort, tile planning/parsing. Model calls are never made here — the domain
// modules are pure by design.
// Run: npm run test:ai

import assert from "node:assert/strict";
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
  buildScanInstruction,
  dedupeCandidates,
  DETECTION_TILE_OVERLAP_PX,
  DETECTION_TILE_PX,
  excludeNearExistingPoints,
  LOW_CONFIDENCE_THRESHOLD,
  parseTileCandidates,
  planDetectionTiles,
  sortProposalsForReview,
  tileCandidateToSheet,
} from "../src/lib/ai-takeoff/ai-takeoff-domain.ts";

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

// 1M input + 1M output on sonnet-4-6 = $3 + $15 = $18.00
assert.equal(
  computeApiCostCents("claude-sonnet-4-6", 1_000_000, 1_000_000),
  1800,
  "cost math: full MTok on both sides",
);
// A realistic sheet scan: ~25k input, ~2k output → ceil(7.5 + 3.0) = 11 cents
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

// --- Detection tiles ---

const tiles = planDetectionTiles(3800, 2600);
assert.ok(tiles.length >= 4, "a full sheet needs multiple tiles");
assert.ok(
  tiles.every((tile) => tile.width <= DETECTION_TILE_PX && tile.height <= DETECTION_TILE_PX),
  "no tile exceeds the detection tile size",
);
assert.ok(
  tiles.every(
    (tile) =>
      tile.left >= 0 &&
      tile.top >= 0 &&
      tile.left + tile.width <= 3800 &&
      tile.top + tile.height <= 2600,
  ),
  "tiles stay inside the sheet",
);
// Coverage: every probe point on the sheet falls inside at least one tile.
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
// Adjacent tiles overlap so seam symbols appear whole somewhere.
const firstRow = tiles.filter((tile) => tile.top === tiles[0].top);
if (firstRow.length > 1) {
  assert.ok(
    firstRow[1].left < firstRow[0].left + firstRow[0].width,
    "adjacent tiles overlap horizontally",
  );
  assert.equal(
    firstRow[0].left + firstRow[0].width - firstRow[1].left,
    DETECTION_TILE_OVERLAP_PX,
    "horizontal overlap matches the configured seam",
  );
}
const smallSheet = planDetectionTiles(900, 700);
assert.equal(smallSheet.length, 1, "a sheet smaller than one tile plans a single tile");
assert.equal(smallSheet[0].width, 900, "single tile clamps to sheet width");
assert.equal(smallSheet[0].height, 700, "single tile clamps to sheet height");

// --- Strict-JSON candidate parsing ---

const parsed = parseTileCandidates(
  '[{"x": 120, "y": 340.5, "confidence": 0.92}, {"x": 900, "y": 100, "confidence": 0.4}]',
  1400,
  1400,
);
assert.equal(parsed.length, 2, "clean JSON array parses");
assert.equal(parsed[0].x, 120, "x preserved");
assert.equal(parsed[0].confidence, 0.92, "confidence preserved");

const fenced = parseTileCandidates(
  'Here are the matches:\n```json\n[{"x": 10, "y": 20, "confidence": 1.4}]\n```\nDone.',
  1400,
  1400,
);
assert.equal(fenced.length, 1, "fenced/prosy responses still yield the array");
assert.equal(fenced[0].confidence, 1, "confidence clamps to [0,1]");

assert.deepEqual(parseTileCandidates("no matches found", 1400, 1400), [], "prose only → empty");
assert.deepEqual(parseTileCandidates("[]", 1400, 1400), [], "empty array → empty");
assert.deepEqual(parseTileCandidates("[{broken", 1400, 1400), [], "malformed JSON → empty");
assert.equal(
  parseTileCandidates('[{"x": 5000, "y": 20, "confidence": 0.9}]', 1400, 1400).length,
  0,
  "candidates outside the tile bounds are dropped",
);
assert.equal(
  parseTileCandidates('[{"x": "left", "y": 20, "confidence": 0.9}]', 1400, 1400).length,
  0,
  "non-numeric coordinates are dropped",
);

// --- Tile → sheet coordinate mapping ---

const mapped = tileCandidateToSheet(
  { x: 700, y: 350, confidence: 0.8 },
  { left: 1304, top: 0 },
  3800,
  2600,
);
assert.ok(Math.abs(mapped.x - (1304 + 700) / 3800) < 1e-9, "x maps through the tile origin");
assert.ok(Math.abs(mapped.y - 350 / 2600) < 1e-9, "y maps through the tile origin");
assert.equal(
  tileCandidateToSheet({ x: 99999, y: 0, confidence: 0.5 }, { left: 0, top: 0 }, 3800, 2600).x,
  1,
  "mapped coordinates clamp into [0,1]",
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
assert.equal(excludeNearExistingPoints(filtered, []).length, 1, "no existing points → passthrough");

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
const sameRow = sortProposalsForReview([
  { x: 0.8, y: 0.5, confidence: 0.9 },
  { x: 0.2, y: 0.502, confidence: 0.9 },
]);
assert.equal(sameRow[0].x, 0.2, "near-identical y reads left to right");

// --- Proposal → marker conversion ---

const firstAccept = appendAcceptedPoint([], { x: 0.4, y: 0.6 });
assert.equal(firstAccept.points.length, 1, "first accept creates the first point");
assert.equal(firstAccept.quantity, 1, "count quantity equals point count");

const secondAccept = appendAcceptedPoint(firstAccept.points, { x: 0.5, y: 0.7 });
assert.equal(secondAccept.points.length, 2, "accepts accumulate points");
assert.equal(secondAccept.quantity, 2, "quantity tracks every accepted point");
assert.deepEqual(
  secondAccept.points[0],
  { x: 0.4, y: 0.6 },
  "existing points are preserved in order",
);
assert.equal(firstAccept.points.length, 1, "conversion never mutates its input");
const clampedAccept = appendAcceptedPoint([], { x: 1.7, y: -0.2 });
assert.deepEqual(clampedAccept.points[0], { x: 1, y: 0 }, "accepted points clamp into the sheet");

// --- Scan instruction ---

const instruction = buildScanInstruction({
  label: "Duplex outlet",
  tileWidthPx: 1400,
  tileHeightPx: 1200,
});
assert.match(instruction, /Duplex outlet/, "instruction names the exemplar label");
assert.match(instruction, /ONLY a JSON array/, "instruction demands strict JSON");
assert.match(instruction, /1400x1200/, "instruction states the tile pixel frame");
assert.match(
  buildScanInstruction({ label: "  ", tileWidthPx: 100, tileHeightPx: 100 }),
  /the marked symbol/,
  "blank labels fall back to a generic description",
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
assert.match(broke.message, /3 credits/, "out-of-credits message quotes the cost");
const ready = aiAssistAvailability({
  configured: true,
  hasExemplar: true,
  balanceCredits: 10,
  quoteCredits: 10,
});
assert.equal(ready.state, "ready", "exact balance is enough to scan");

console.log(
  "AI takeoff + credits smoke: all assertions passed (ledger math, refunds, price table, tiles, parsing, review order, conversion).",
);
