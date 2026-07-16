import { cosineSimilarity, type EmbeddingVector } from "./embedding-match/embedding-match-domain";
import type { EmbeddingCluster } from "./embedding-match/embedding-cluster-domain";

export const DEFAULT_SYMBOL_LIBRARY_MATCH_THRESHOLD = 0.8;

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
}: {
  clusters: EmbeddingCluster[];
  embeddings: EmbeddingVector[];
  examples: SymbolLibraryExample[];
  threshold?: number;
}): SymbolLibrarySuggestion[] {
  if (!(threshold > 0 && threshold <= 1)) return [];
  const suggestions: SymbolLibrarySuggestion[] = [];
  clusters.forEach((cluster, clusterIndex) => {
    const medoid = embeddings[cluster.medoidIndex];
    if (!medoid) return;
    let best: SymbolLibraryExample | null = null;
    let bestScore = -1;
    for (const example of examples) {
      const score = cosineSimilarity(medoid, example.embedding);
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
