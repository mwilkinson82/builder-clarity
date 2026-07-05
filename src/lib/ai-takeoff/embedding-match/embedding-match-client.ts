// Client session for the embedding-match worker (AITAKEOFF12 Task 1).
// One session per scan: the worker (and its onnxruntime-web wasm + DINOv2
// model) spins up lazily on the first match, is reused across the scan's
// sheets so the model compiles once, and dies with dispose(). Browser-only —
// the worker is constructed inside functions that only run from user gestures,
// so SSR never touches it. Mirrors the template-match session shape.

import type { EmbeddingMatchCandidate, EmbeddingTopScore } from "./embedding-match-domain.ts";
import type { EmbeddingMatchRequest, EmbeddingMatchResponse } from "./embedding-match-protocol.ts";

export interface EmbeddingMatchSheetInput {
  /** Detection raster pixels for the sheet being scanned. */
  raster: ImageData;
  /** The tagged exemplar crop. */
  exemplar: ImageData;
  /** Measured ink footprint of the exemplar, raster px. */
  footprintPx: number;
  /** Cosine floor (resolved from the env-tunable default by the caller). */
  threshold: number;
}

export interface EmbeddingMatchSheetResult {
  candidates: EmbeddingMatchCandidate[];
  topScores: EmbeddingTopScore[];
  downscale: number;
  windowCount: number;
  appliedThreshold: number;
  embeddingDim: number;
  elapsedMs: number;
}

/** First match pays the model compile + fetch; keep the ceiling generous. */
const MATCH_TIMEOUT_MS = 300_000;

export interface EmbeddingMatchSession {
  match(input: EmbeddingMatchSheetInput): Promise<EmbeddingMatchSheetResult>;
  dispose(): void;
}

export function createEmbeddingMatchSession(): EmbeddingMatchSession {
  let worker: Worker | null = null;
  let disposed = false;
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();

  const ensureWorker = () => {
    if (disposed) throw new Error("The symbol matcher session was closed.");
    worker ??= new Worker(new URL("./embedding-match.worker.ts", import.meta.url), {
      type: "module",
    });
    return worker;
  };

  const matchOnce = (input: EmbeddingMatchSheetInput): Promise<EmbeddingMatchSheetResult> =>
    new Promise((resolve, reject) => {
      const target = ensureWorker();
      const id = nextId;
      nextId += 1;
      // Self-heal: any failure retires THIS worker so the next sheet spawns a
      // fresh one — a wasm runtime that died mid-scan costs one sheet, not the rest.
      const retireWorker = () => {
        if (worker === target) {
          worker.terminate();
          worker = null;
        }
      };
      const timer = setTimeout(() => {
        cleanup();
        retireWorker();
        reject(new Error("The symbol matcher timed out."));
      }, MATCH_TIMEOUT_MS);
      const onMessage = (event: MessageEvent<EmbeddingMatchResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok) {
          const { id: _id, ok: _ok, ...result } = event.data;
          resolve(result);
        } else {
          retireWorker();
          reject(new Error(event.data.error));
        }
      };
      const onError = (errorEvent: ErrorEvent) => {
        cleanup();
        retireWorker();
        reject(new Error(errorEvent.message || "The symbol matcher failed to load."));
      };
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("error", onError);
      };
      target.addEventListener("message", onMessage);
      target.addEventListener("error", onError);
      const request: EmbeddingMatchRequest = {
        id,
        rasterRgba: input.raster.data.buffer as ArrayBuffer,
        rasterWidth: input.raster.width,
        rasterHeight: input.raster.height,
        // Copied, not transferred: the exemplar serves every sheet of the scan.
        exemplarRgba: input.exemplar.data.slice().buffer as ArrayBuffer,
        exemplarWidth: input.exemplar.width,
        exemplarHeight: input.exemplar.height,
        footprintPx: input.footprintPx,
        threshold: input.threshold,
      };
      // The raster IS transferred — read once by the worker; the caller's
      // raster ImageData is detached afterward.
      target.postMessage(request, [request.rasterRgba, request.exemplarRgba]);
    });

  return {
    match(input) {
      const run = queue.then(() => matchOnce(input));
      queue = run.catch(() => undefined);
      return run;
    },
    dispose() {
      disposed = true;
      worker?.terminate();
      worker = null;
    },
  };
}
