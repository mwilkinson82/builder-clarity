// Embedding-match smoke (AITAKEOFF12 Task 0). The SELECTION math that turns a
// learned-embedding space into candidates, proven on synthetic vectors that
// reproduce the measured A-100 geometry: a blower exemplar sits at cosine 0.76
// to its twin and 0.22-0.36 to the brushes. The real embeddings come from
// DINOv2 in the worker; this locks the math that ships around them — above all
// the regression that this separation yields 2 matches, not the pixel engine's
// 32. No model, no ONNX: pure node --experimental-strip-types.
// Run: npm run test:ai

import assert from "node:assert/strict";
import {
  cosineSimilarity,
  l2Normalize,
  planEmbeddingSweep,
  sweepWindowCenters,
  selectEmbeddingMatches,
  suppressEmbeddingNonMaxima,
  topEmbeddingScores,
  resolveEmbeddingMatchThreshold,
  embeddingDedupeRadius,
  embeddingMatchDownscaleFor,
  describeEmbeddingOrigin,
  DEFAULT_EMBEDDING_MATCH_THRESHOLD,
  EMBEDDING_WINDOW_SCALES,
  EMBEDDING_MATCH_MAX_LONG_EDGE_PX,
  type EmbeddingMatchCandidate,
} from "../src/lib/ai-takeoff/embedding-match/embedding-match-domain.ts";

let checks = 0;
const ok = (cond: unknown, msg: string) => {
  assert.ok(cond, msg);
  checks += 1;
};

// --- 1. cosine / normalize fundamentals ------------------------------------
ok(Math.abs(cosineSimilarity([1, 0, 0], [1, 0, 0]) - 1) < 1e-9, "identical → 1");
ok(Math.abs(cosineSimilarity([1, 0, 0], [0, 1, 0])) < 1e-9, "orthogonal → 0");
ok(cosineSimilarity([1, 0, 0], [0, 0, 0]) === 0, "degenerate (empty edge crop) → 0, never a match");
ok(Math.abs(cosineSimilarity([3, 0], [5, 0]) - 1) < 1e-9, "cosine ignores magnitude");
const unit = l2Normalize([3, 4]);
ok(Math.abs(Math.hypot(unit[0], unit[1]) - 1) < 1e-9, "l2Normalize → unit length");
ok(
  l2Normalize([0, 0]).every((v) => v === 0),
  "l2Normalize of zero → zero (no NaN)",
);

// --- 2. THE REGRESSION: clean embedding gap → 2 matches, not 32 -------------
// Vectors in a 6-d toy feature space. e0 = the blower direction (exemplar).
// A blower instance keeps a high e0 component (cosine == that component);
// a brush keeps a small e0 component and spreads the rest elsewhere; the site
// logo (the pixel engine's top false positive) sits in between. This is the
// A-100 measurement, made deterministic.
const D = 6;
const axis = (i: number, c = 1): number[] => Array.from({ length: D }, (_, k) => (k === i ? c : 0));
const withE0 = (e0: number, spread: number[]): number[] => {
  const r = Math.sqrt(Math.max(0, 1 - e0 * e0));
  const s = l2Normalize(spread);
  return Array.from({ length: D }, (_, k) => (k === 0 ? e0 : r * (s[k] ?? 0)));
};
const exemplar = axis(0); // a tagged blower

// Two real blowers (its twins): cosine 0.78 and 0.74 to the exemplar.
const blowers = [withE0(0.78, [0, 1, 0, 0, 0, 0]), withE0(0.74, [0, 0.6, 0.4, 0, 0, 0])];
// Thirty brushes: cosine 0.25-0.38 (deterministic spread), far below the floor.
const brushes = Array.from({ length: 30 }, (_, j) =>
  withE0(0.25 + (j % 7) * 0.02, [0, 0, (j % 3) + 1, (j % 5) + 1, (j % 2) + 1, 1]),
);
// The CESO logo — a round emblem the pixel engine scored HIGHEST (0.63). Here
// it is a mid distractor at 0.50, safely under the 0.62 floor.
const logo = withE0(0.5, [0, 0, 0, 0, 1, 0.3]);

const simTwin = cosineSimilarity(exemplar, blowers[0]);
const simBrush = Math.max(...brushes.map((b) => cosineSimilarity(exemplar, b)));
const simLogo = cosineSimilarity(exemplar, logo);
ok(simTwin > 0.7, `twin blower similarity high (${simTwin.toFixed(3)})`);
ok(simBrush < 0.45, `brushes stay low (max ${simBrush.toFixed(3)})`);
ok(simTwin - simBrush > 0.15, `clean separation gap (${(simTwin - simBrush).toFixed(3)})`);
ok(
  simLogo < DEFAULT_EMBEDDING_MATCH_THRESHOLD,
  `logo below floor (${simLogo.toFixed(3)}) — pixel engine's top FP is gone`,
);

// Lay the scene out on the sheet (distinct positions so NMS keeps every symbol)
// and select. The pixel engine returned 32 ghosts on this exact scene; the
// embedding selector must return exactly the 2 blowers.
const radius = embeddingDedupeRadius(40, 2000, 1500);
const scene: EmbeddingMatchCandidate[] = [
  ...blowers.map((v, i) => ({
    x: 0.2 + i * 0.5,
    y: 0.2,
    score: cosineSimilarity(exemplar, v),
    scale: 1.3,
  })),
  ...brushes.map((v, j) => ({
    x: 0.05 + (j % 10) * 0.09,
    y: 0.5 + Math.floor(j / 10) * 0.15,
    score: cosineSimilarity(exemplar, v),
    scale: 1.3,
  })),
  { x: 0.9, y: 0.05, score: simLogo, scale: 1.3 },
];
const matches = selectEmbeddingMatches(scene, DEFAULT_EMBEDDING_MATCH_THRESHOLD, radius);
ok(
  matches.length === 2,
  `REGRESSION: blower exemplar → ${matches.length} matches (pixel engine gave 32); must be 2`,
);
ok(
  matches.every((m) => m.score > 0.7),
  "the 2 matches are the high-scoring blowers",
);

// --- 3. NMS collapses co-located hits to one -------------------------------
const stacked = suppressEmbeddingNonMaxima(
  [
    { x: 0.5, y: 0.5, score: 0.9 },
    { x: 0.502, y: 0.5, score: 0.8 }, // same symbol, one raster over
    { x: 0.5, y: 0.503, score: 0.85 },
  ],
  radius,
);
ok(stacked.length === 1 && stacked[0].score === 0.9, "NMS keeps the single best per symbol");

// --- 4. sweep plan covers every symbol center ------------------------------
const plan = planEmbeddingSweep(60, 2400, 1600);
ok(
  plan.scales.length >= 1 && plan.scales.length <= EMBEDDING_WINDOW_SCALES.length,
  "sweep has scales",
);
ok(
  plan.scales.every((s) => s.coarseStridePx <= s.windowPx && s.fineStridePx <= s.coarseStridePx),
  "coarse stride ≤ window, fine ≤ coarse",
);
const coarse = plan.scales[0];
const centers = sweepWindowCenters(2400, 1600, coarse.windowPx, coarse.coarseStridePx);
// every interior point is within half a stride of some window center on each axis
const half = coarse.coarseStridePx;
const covered = (px: number, py: number) =>
  centers.some((c) => Math.abs(c.x - px) <= half && Math.abs(c.y - py) <= half);
ok(covered(1200, 800) && covered(300, 300), "stride grid covers interior symbol centers");

// --- 5. resolvers / helpers -------------------------------------------------
ok(
  resolveEmbeddingMatchThreshold(undefined) === DEFAULT_EMBEDDING_MATCH_THRESHOLD,
  "threshold default",
);
ok(resolveEmbeddingMatchThreshold("0.7") === 0.7, "threshold env override");
ok(
  resolveEmbeddingMatchThreshold("nonsense") === DEFAULT_EMBEDDING_MATCH_THRESHOLD,
  "bad env → default",
);
ok(embeddingMatchDownscaleFor(1000, 800) === 1, "no upscale when already small");
ok(
  Math.abs(embeddingMatchDownscaleFor(4800, 3200) - EMBEDDING_MATCH_MAX_LONG_EDGE_PX / 4800) < 1e-9,
  "downscale to the long-edge budget",
);
const top = topEmbeddingScores(scene, 3);
ok(
  top.length === 3 && top[0].score >= top[1].score && top[1].score >= top[2].score,
  "top scores sorted desc",
);
ok(
  describeEmbeddingOrigin({ score: 0.76, scale: 1.3 }) === "embedding 0.76 ×1.30",
  "origin string",
);
ok(
  describeEmbeddingOrigin({ score: 0.9, scale: 1 }) === "embedding 0.90",
  "origin string, scale 1 omitted",
);

console.log(`ai-embedding-match smoke: ${checks} checks passed`);
