// Client session for the template-match worker (AITAKEOFF6 Task 0).
// One session per scan: the worker (and its opencv.js wasm chunk) spins up
// lazily on the first match, is reused across the scan's sheets so the wasm
// compiles once, and dies with dispose(). Browser-only — the worker is
// constructed inside functions that only run from user gestures, so SSR
// never touches it.

import type { TemplateMatchCandidate } from "./template-match-domain.ts";
import type { TemplateMatchRequest, TemplateMatchResponse } from "./template-match-protocol.ts";
import type { TemplateMatchOptions } from "./template-matcher.ts";

export interface TemplateMatchSheetInput {
  /** Detection raster pixels for the sheet being scanned. */
  raster: ImageData;
  /** Template crop around the exemplar marker (templateCropRect sized). */
  template: ImageData;
  options: TemplateMatchOptions;
}

export interface TemplateMatchSheetResult {
  candidates: TemplateMatchCandidate[];
  matchWidthPx: number;
  matchHeightPx: number;
  downscale: number;
  sweepCount: number;
  truncated: boolean;
  elapsedMs: number;
}

/** First match pays the wasm compile; keep the ceiling generous. */
const MATCH_TIMEOUT_MS = 180_000;

export interface TemplateMatchSession {
  match(input: TemplateMatchSheetInput): Promise<TemplateMatchSheetResult>;
  dispose(): void;
}

export function createTemplateMatchSession(): TemplateMatchSession {
  let worker: Worker | null = null;
  let disposed = false;
  let nextId = 1;
  // One scan runs one sheet at a time; the chain still serializes calls so
  // a racing caller can never interleave messages on the shared worker.
  let queue: Promise<unknown> = Promise.resolve();

  const ensureWorker = () => {
    if (disposed) throw new Error("The symbol matcher session was closed.");
    worker ??= new Worker(new URL("./template-match.worker.ts", import.meta.url), {
      type: "module",
    });
    return worker;
  };

  const matchOnce = (input: TemplateMatchSheetInput): Promise<TemplateMatchSheetResult> =>
    new Promise((resolve, reject) => {
      const target = ensureWorker();
      const id = nextId;
      nextId += 1;
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("The symbol matcher timed out."));
      }, MATCH_TIMEOUT_MS);
      const onMessage = (event: MessageEvent<TemplateMatchResponse>) => {
        if (event.data.id !== id) return;
        cleanup();
        if (event.data.ok) {
          const { id: _id, ok: _ok, ...result } = event.data;
          resolve(result);
        } else {
          reject(new Error(event.data.error));
        }
      };
      const onError = (event: ErrorEvent) => {
        cleanup();
        reject(new Error(event.message || "The symbol matcher failed to load."));
      };
      const cleanup = () => {
        clearTimeout(timer);
        target.removeEventListener("message", onMessage);
        target.removeEventListener("error", onError);
      };
      target.addEventListener("message", onMessage);
      target.addEventListener("error", onError);
      const request: TemplateMatchRequest = {
        id,
        rasterRgba: input.raster.data.buffer as ArrayBuffer,
        rasterWidth: input.raster.width,
        rasterHeight: input.raster.height,
        // Copied, not transferred: one template serves every sheet of the
        // scan, so the caller's buffer must survive this call.
        templateRgba: input.template.data.slice().buffer as ArrayBuffer,
        templateWidth: input.template.width,
        templateHeight: input.template.height,
        options: input.options,
      };
      // The raster IS transferred — ~38MB of RGBA per sheet, read once by
      // the worker; the caller's raster ImageData is detached afterward.
      target.postMessage(request, [request.rasterRgba, request.templateRgba]);
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
