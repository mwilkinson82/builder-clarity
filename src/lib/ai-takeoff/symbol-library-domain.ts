import { cosineSimilarity, type EmbeddingVector } from "./embedding-match/embedding-match-domain";
import type { EmbeddingCluster } from "./embedding-match/embedding-cluster-domain";

export const DEFAULT_SYMBOL_LIBRARY_MATCH_THRESHOLD = 0.9;
export const DEFAULT_SYMBOL_LIBRARY_MEMBER_MATCH_THRESHOLD = 0.95;

export interface SymbolLibraryExample {
  itemId: string;
  label: string;
  trade: string;
  unit: string;
  costLibraryItemId: string | null;
  embedding: EmbeddingVector;
}

export interface SymbolLibrarySuggestion {
  clusterIndex: number;
  itemId: string;
  label: string;
  trade: string;
  unit: string;
  costLibraryItemId: string | null;
  score: number;
}

export function parseSymbolEmbedding(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length < 64 || value.length > 4096) return null;
  if (!value.every((entry) => typeof entry === "number" && Number.isFinite(entry))) return null;
  return value;
}

/**
 * Suggest a company-library label for each visual cluster. Suggestions are
 * intentionally conservative and never become takeoffs: the estimator still
 * opens the group, confirms its label, and reviews every proposed location.
 */
export function resolveSymbolLibrarySuggestions({
  clusters,
  embeddings,
  examples,
  threshold = DEFAULT_SYMBOL_LIBRARY_MATCH_THRESHOLD,
  memberThreshold = DEFAULT_SYMBOL_LIBRARY_MEMBER_MATCH_THRESHOLD,
}: {
  clusters: EmbeddingCluster[];
  embeddings: EmbeddingVector[];
  examples: SymbolLibraryExample[];
  threshold?: number;
  memberThreshold?: number;
}): SymbolLibrarySuggestion[] {
  if (!(threshold > 0 && threshold <= 1) || !(memberThreshold > 0 && memberThreshold <= 1)) {
    return [];
  }
  const suggestions: SymbolLibrarySuggestion[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    const medoid = embeddings[cluster.medoidIndex];
    if (!medoid) return;
    const memberEmbeddings = cluster.memberIndexes.flatMap((index) => {
      const embedding = embeddings[index];
      return embedding ? [embedding] : [];
    });
    if (memberEmbeddings.length === 0) return;
    let best: SymbolLibraryExample | null = null;
    let bestScore = -1;
    for (const example of examples) {
      const representativeScore = cosineSimilarity(medoid, example.embedding);
      const strongestMemberScore = Math.max(
        ...memberEmbeddings.map((embedding) => cosineSimilarity(embedding, example.embedding)),
      );

      // A single broad CLIP similarity is not enough to name construction
      // symbols safely. Require both a strong cluster-wide representative and
      // a near-exact member before surfacing the estimator-approved label.
      if (strongestMemberScore < memberThreshold) continue;
      const score = (representativeScore + strongestMemberScore) / 2;
      if (score > bestScore) {
        best = example;
        bestScore = score;
      }
    }
    if (!best || bestScore < threshold) return;
    suggestions.push({
      clusterIndex,
      itemId: best.itemId,
      label: best.label,
      trade: best.trade,
      unit: best.unit,
      costLibraryItemId: best.costLibraryItemId,
      score: bestScore,
    });
  });
  return suggestions;
}
