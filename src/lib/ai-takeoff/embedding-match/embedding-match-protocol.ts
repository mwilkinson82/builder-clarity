// Worker wire protocol (AITAKEOFF12 Task 1): plain structured-clone shapes,
// shared by the embedding worker and the client session so the two cannot drift.

import type { EmbeddingMatchCandidate, EmbeddingTopScore } from "./embedding-match-domain.ts";

export interface EmbeddingMatchRequest {
  id: number;
  /** Detection raster RGBA, transferred (the ArrayBuffer moves, no copy). */
  rasterRgba: ArrayBuffer;
  rasterWidth: number;
  rasterHeight: number;
  /** The tagged exemplar crop RGBA (copied — it serves every sheet of a scan). */
  exemplarRgba: ArrayBuffer;
  exemplarWidth: number;
  exemplarHeight: number;
  /** Measured ink footprint of the exemplar, raster px — sizes the sweep windows. */
  footprintPx: number;
  /** Cosine floor; the caller resolves it from the env-tunable default. */
  threshold: number;
}

export type EmbeddingMatchResponse =
  | {
      id: number;
      ok: true;
      candidates: EmbeddingMatchCandidate[];
      /** Best sweep scores regardless of threshold — zero-hit transparency. */
      topScores: EmbeddingTopScore[];
      /** Working-raster downscale the sweep ran at (1 = native). */
      downscale: number;
      /** Windows actually embedded (coarse + refined) — the compute receipt. */
      windowCount: number;
      appliedThreshold: number;
      embeddingDim: number;
      elapsedMs: number;
    }
  | { id: number; ok: false; error: string };
