// Worker wire protocol (AITAKEOFF6 Task 0): plain structured-clone shapes,
// shared by the worker and the client session so the two sides cannot drift.

import type { TemplateMatchCandidate, TemplateTopScore } from "./template-match-domain.ts";
import type { TemplateMatchOptions } from "./template-matcher.ts";

export interface TemplateMatchRequest {
  id: number;
  /** Detection raster RGBA, transferred (the ArrayBuffer moves, no copy). */
  rasterRgba: ArrayBuffer;
  rasterWidth: number;
  rasterHeight: number;
  /** Exemplar template RGBA, transferred. */
  templateRgba: ArrayBuffer;
  templateWidth: number;
  templateHeight: number;
  options: TemplateMatchOptions;
}

export type TemplateMatchResponse =
  | {
      id: number;
      ok: true;
      candidates: TemplateMatchCandidate[];
      matchWidthPx: number;
      matchHeightPx: number;
      downscale: number;
      sweepCount: number;
      truncated: boolean;
      /** Masked metric ran (false = degenerate-mask fallback, AITAKEOFF8). */
      maskedMatching: boolean;
      maskCoverage: number;
      appliedThreshold: number;
      /** Best sweep scores regardless of threshold (AITAKEOFF8 Task 1). */
      topScores: TemplateTopScore[];
      elapsedMs: number;
    }
  | { id: number; ok: false; error: string };
