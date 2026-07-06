// Embedding-cluster smoke (SYMBOLDISCOVERY Stage 0).
// Pins the identification-library front half's math: average-linkage cosine
// clustering must group same-symbol vectors, keep distinct symbols apart,
// let junk self-segregate, and stay deterministic. Structure-only proof —
// the REAL gate is the live A-100 run (AITAKEOFF14's lesson: synthetic green
// never gates a stage by itself). Run: npm run test:ai

import assert from "node:assert/strict";
import {
  clusterEmbeddings,
  DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
} from "../src/lib/ai-takeoff/embedding-match/embedding-cluster-domain.ts";

/** Deterministic pseudo-random unit-ish jitter (no Math.random in fixtures). */
function jitter(seed: number, dims: number, scale: number): number[] {
  const out = new Array<number>(dims);
  let state = seed;
  for (let i = 0; i < dims; i += 1) {
    state = (state * 1103515245 + 12345) % 2147483648;
    out[i] = ((state / 2147483648) * 2 - 1) * scale;
  }
  return out;
}

/** A cluster member = base direction + small jitter. */
function member(base: number[], seed: number, noise = 0.08): number[] {
  const j = jitter(seed, base.length, noise);
  return base.map((v, i) => v + j[i]);
}

const DIMS = 32;
const axis = (i: number): number[] => {
  const v = new Array<number>(DIMS).fill(0);
  v[i] = 1;
  return v;
};

// Three symbol groups on distinct axes + junk vectors scattered broadly.
const brushes = [1, 2, 3, 4, 5].map((s) => member(axis(0), s));
const blowers = [6, 7, 8].map((s) => member(axis(1), s));
const tanks = [9, 10].map((s) => member(axis(2), s));
// Junk: near a shared "linework" direction but noisier — mimics the offline
// proof where fragments self-segregated into one amorphous cluster.
const junk = [11, 12, 13, 14].map((s) => member(axis(3), s, 0.3));

const vectors = [...brushes, ...blowers, ...tanks, ...junk];
const clusters = clusterEmbeddings(vectors);

// Group recovery: the 5 brushes together, 3 blowers together, 2 tanks together.
const clusterOf = (index: number) => clusters.find((c) => c.memberIndexes.includes(index))!;
assert.deepEqual(clusterOf(0).memberIndexes, [0, 1, 2, 3, 4], "brushes self-group");
assert.deepEqual(clusterOf(5).memberIndexes, [5, 6, 7], "blowers self-group");
assert.deepEqual(clusterOf(8).memberIndexes, [8, 9], "tanks self-group");

// Junk never contaminates a symbol group.
for (let j = 10; j < 14; j += 1) {
  const c = clusterOf(j);
  assert.ok(
    c.memberIndexes.every((i) => i >= 10),
    `junk vector ${j} stays out of symbol groups (landed with ${c.memberIndexes})`,
  );
}

// Display order: largest first.
assert.equal(clusters[0].memberIndexes.length, 5, "largest cluster leads");
assert.ok(
  clusters[0].cohesion > 0.9,
  `tight group reads cohesive (${clusters[0].cohesion.toFixed(3)})`,
);

// Medoid is a member of its own cluster and the most central one.
const brushCluster = clusterOf(0);
assert.ok(
  brushCluster.memberIndexes.includes(brushCluster.medoidIndex),
  "medoid belongs to its cluster",
);

// Determinism: identical input → identical output.
const rerun = clusterEmbeddings(vectors);
assert.deepEqual(rerun, clusters, "clustering is deterministic");

// Threshold semantics: an impossible threshold yields all singletons.
const singletons = clusterEmbeddings(vectors, { similarityThreshold: 1.01 });
assert.equal(singletons.length, vectors.length, "threshold 1+ keeps everything apart");
assert.ok(
  singletons.every((c) => c.memberIndexes.length === 1 && c.cohesion === 1),
  "singletons carry cohesion 1",
);

// Degenerate inputs stay safe.
assert.deepEqual(clusterEmbeddings([]), [], "empty input → empty output");
const one = clusterEmbeddings([axis(0)]);
assert.equal(one.length, 1, "single vector → single cluster");
assert.equal(one[0].medoidIndex, 0, "single vector is its own medoid");
const zeros = clusterEmbeddings([new Array<number>(DIMS).fill(0), axis(1)]);
assert.ok(zeros.length >= 1, "zero vectors do not crash the linkage");

// The default threshold constant is what the server fn falls back to.
assert.ok(
  DEFAULT_CLUSTER_SIMILARITY_THRESHOLD > 0.5 && DEFAULT_CLUSTER_SIMILARITY_THRESHOLD < 1,
  "default threshold stays a sane cosine similarity",
);

console.log("ai-embedding-cluster-smoke: OK");
