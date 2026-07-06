// Embedding clustering (SYMBOLDISCOVERY Stage 0).
// The identification-library front half: candidate crops from a sheet are
// embedded (server-side, Replicate) and grouped here so the estimator can be
// SHOWN "the kinds of symbols on this sheet" and name the ones that matter.
// The offline proof on the real A-100 sheet (2026-07-05) validated exactly
// this shape: density-peak candidates + embeddings + cosine clustering
// self-grouped brushes/blowers/callouts/tanks unsupervised, with junk
// linework fragments self-segregating into an ignorable cluster.
//
// Greedy AVERAGE-LINKAGE agglomerative clustering, fully deterministic
// (ties broken by lowest cluster index) so live runs and fixtures reproduce.
// n is small by construction (candidate proposer caps ~64 crops/sheet), so
// the O(n^3) merge loop over a precomputed similarity matrix is fine.
//
// Pure functions only: no fetch, no env reads. The server function applies
// the env-tunable threshold; fixtures pin the math headlessly.

import { cosineSimilarity, type EmbeddingVector } from "./embedding-match-domain.ts";

/**
 * Default minimum average pairwise similarity for two clusters to merge.
 * Calibrated for CLIP-style embeddings (similarities compress high); the
 * offline DINOv2 proof merged at ~0.66. Stage 0's live A-100 run is the
 * calibration gate — the server fn can override per-run from env.
 */
export const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.8;

export interface EmbeddingCluster {
  /** Indexes into the input vector list (ascending). */
  memberIndexes: number[];
  /** The member most similar to its own cluster — the display exemplar. */
  medoidIndex: number;
  /** Mean pairwise similarity inside the cluster (1 for singletons). */
  cohesion: number;
}

/**
 * Cluster embedding vectors by average-linkage cosine similarity. Returns
 * clusters sorted for display: largest first, then most cohesive, then by
 * first member index (stable).
 */
export function clusterEmbeddings(
  vectors: EmbeddingVector[],
  options: { similarityThreshold?: number } = {},
): EmbeddingCluster[] {
  const threshold = options.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
  const n = vectors.length;
  if (n === 0) return [];

  // Precompute the symmetric similarity matrix once.
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(1));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = cosineSimilarity(vectors[i], vectors[j]);
      sim[i][j] = s;
      sim[j][i] = s;
    }
  }

  let clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);

  const averageLinkage = (a: number[], b: number[]): number => {
    let total = 0;
    for (const i of a) for (const j of b) total += sim[i][j];
    return total / (a.length * b.length);
  };

  // Greedy merge: always take the single best pair above threshold.
  for (;;) {
    let bestA = -1;
    let bestB = -1;
    let bestSim = threshold;
    for (let a = 0; a < clusters.length; a += 1) {
      for (let b = a + 1; b < clusters.length; b += 1) {
        const s = averageLinkage(clusters[a], clusters[b]);
        if (s > bestSim) {
          bestSim = s;
          bestA = a;
          bestB = b;
        }
      }
    }
    if (bestA < 0) break;
    clusters[bestA] = [...clusters[bestA], ...clusters[bestB]].sort((x, y) => x - y);
    clusters = clusters.filter((_, idx) => idx !== bestB);
  }

  const toCluster = (members: number[]): EmbeddingCluster => {
    if (members.length === 1) {
      return { memberIndexes: members, medoidIndex: members[0], cohesion: 1 };
    }
    let cohesionTotal = 0;
    let pairs = 0;
    let medoid = members[0];
    let medoidMean = -Infinity;
    for (const i of members) {
      let meanToOthers = 0;
      for (const j of members) {
        if (i === j) continue;
        meanToOthers += sim[i][j];
        if (i < j) {
          cohesionTotal += sim[i][j];
          pairs += 1;
        }
      }
      meanToOthers /= members.length - 1;
      if (meanToOthers > medoidMean) {
        medoidMean = meanToOthers;
        medoid = i;
      }
    }
    return {
      memberIndexes: members,
      medoidIndex: medoid,
      cohesion: pairs > 0 ? cohesionTotal / pairs : 1,
    };
  };

  return clusters.map(toCluster).sort((a, b) => {
    if (b.memberIndexes.length !== a.memberIndexes.length) {
      return b.memberIndexes.length - a.memberIndexes.length;
    }
    if (b.cohesion !== a.cohesion) return b.cohesion - a.cohesion;
    return a.memberIndexes[0] - b.memberIndexes[0];
  });
}
