// Template-match Web Worker (AITAKEOFF6 Task 0). The opencv.js wasm bundle
// lives in THIS chunk: the browser only fetches it when the client
// constructs the worker, which happens when a scan starts — the main bundle
// never pays for it. The sweep itself runs off the UI thread.

import cvModule from "@techstark/opencv-js";
import { openCvReady, type OpenCvApi } from "./opencv-runtime.ts";
import { matchTemplateSweep } from "./template-matcher.ts";
import type { TemplateMatchRequest, TemplateMatchResponse } from "./template-match-protocol.ts";

let cvPromise: Promise<{ cv: OpenCvApi }> | null = null;

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<TemplateMatchRequest>) => void) | null;
  postMessage(message: TemplateMatchResponse): void;
};

workerScope.onmessage = async (event) => {
  const request = event.data;
  try {
    cvPromise ??= openCvReady(cvModule);
    const { cv } = await cvPromise;
    const startedAt = Date.now();
    const output = matchTemplateSweep(
      cv,
      {
        data: new Uint8Array(request.rasterRgba),
        width: request.rasterWidth,
        height: request.rasterHeight,
      },
      {
        data: new Uint8Array(request.templateRgba),
        width: request.templateWidth,
        height: request.templateHeight,
      },
      request.options,
    );
    workerScope.postMessage({
      id: request.id,
      ok: true,
      candidates: output.candidates,
      matchWidthPx: output.matchWidthPx,
      matchHeightPx: output.matchHeightPx,
      downscale: output.downscale,
      sweepCount: output.sweepCount,
      truncated: output.truncated,
      maskedMatching: output.maskedMatching,
      maskCoverage: output.maskCoverage,
      appliedThreshold: output.appliedThreshold,
      topScores: output.topScores,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    workerScope.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "The symbol matcher failed.",
    });
  }
};
