// Embedding-match Web Worker (AITAKEOFF12 Task 1). The onnxruntime-web wasm and
// the DINOv2 session live in THIS chunk: the browser only fetches them when the
// client constructs the worker at scan start, so the main bundle never pays for
// the model. Everything runs off the UI thread.
//
// The sweep is coarse-to-fine so a client CPU is not asked to embed thousands of
// windows: a coarse grid finds where the exemplar's identity lights up, then only
// promising neighborhoods get the fine grid. Preprocessing (resize to 224²,
// ImageNet normalize) and the CLS-token slice match the offline proof exactly; the
// scoring/selection is the pure domain the node smoke covers.

// CPU-only wasm build on purpose. The default "onnxruntime-web" entry is the
// JSEP (WebGPU) build, which dynamically imports ort-wasm-simd-threaded.jsep.mjs
// — a file we do not self-host — and 404'd in production ("no available backend
// found"), silently degrading the scan to the model engine. The "/wasm" entry
// loads only the base ort-wasm-simd-threaded.wasm we DO bundle. (WebGPU accel is
// a later optimization: it would need the jsep wasm bundled too.)
import * as ort from "onnxruntime-web/wasm";
import {
  planEmbeddingSweep,
  sweepWindowCenters,
  scoreEmbeddingWindows,
  selectEmbeddingMatches,
  topEmbeddingScores,
  embeddingDedupeRadius,
  embeddingMatchDownscaleFor,
  clsEmbeddingAt,
  EMBEDDING_MODEL_URL,
  EMBEDDING_ORT_WASM_PATH,
  EMBEDDING_INPUT_PX,
  EMBEDDING_DIM,
  EMBEDDING_RECALL_MARGIN,
  IMAGENET_MEAN,
  IMAGENET_STD,
  type EmbeddingMatchCandidate,
  type ScoredWindow,
} from "./embedding-match-domain.ts";
import type { EmbeddingMatchRequest, EmbeddingMatchResponse } from "./embedding-match-protocol.ts";

// Self-hosted runtime (no CDN); single-threaded avoids the cross-origin-isolation
// (COOP/COEP) headers threaded wasm would require. WebGPU is a later optimization.
ort.env.wasm.wasmPaths = EMBEDDING_ORT_WASM_PATH;
ort.env.wasm.numThreads = 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;
const getSession = () => {
  sessionPromise ??= ort.InferenceSession.create(EMBEDDING_MODEL_URL, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
  return sessionPromise;
};

const AREA = EMBEDDING_INPUT_PX * EMBEDDING_INPUT_PX;

/** One RGBA crop → NCHW float tensor data, ImageNet-normalized (DINOv2 input). */
function toInput(imageData: ImageData): Float32Array {
  const { data } = imageData;
  const out = new Float32Array(3 * AREA);
  for (let i = 0; i < AREA; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    out[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[AREA + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * AREA + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return out;
}

/** Draw a source-rect of a canvas resized to 224² and read it back as ImageData. */
function cropToInputData(
  ctx: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  sx: number,
  sy: number,
  side: number,
): ImageData {
  ctx.clearRect(0, 0, EMBEDDING_INPUT_PX, EMBEDDING_INPUT_PX);
  ctx.drawImage(source, sx, sy, side, side, 0, 0, EMBEDDING_INPUT_PX, EMBEDDING_INPUT_PX);
  return ctx.getImageData(0, 0, EMBEDDING_INPUT_PX, EMBEDDING_INPUT_PX);
}

const EMBED_BATCH = 24;

/** Embed a list of 224² crops, returning one CLS vector each. */
async function embedCrops(inputs: Float32Array[]): Promise<number[][]> {
  const session = await getSession();
  const out: number[][] = [];
  for (let start = 0; start < inputs.length; start += EMBED_BATCH) {
    const batch = inputs.slice(start, start + EMBED_BATCH);
    const buffer = new Float32Array(batch.length * 3 * AREA);
    batch.forEach((input, i) => buffer.set(input, i * 3 * AREA));
    const tensor = new ort.Tensor("float32", buffer, [
      batch.length,
      3,
      EMBEDDING_INPUT_PX,
      EMBEDDING_INPUT_PX,
    ]);
    const result = await session.run({ pixel_values: tensor });
    const hidden = result.last_hidden_state.data as Float32Array;
    for (let i = 0; i < batch.length; i += 1) out.push(clsEmbeddingAt(hidden, i));
  }
  return out;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<EmbeddingMatchRequest>) => void) | null;
  postMessage(message: EmbeddingMatchResponse): void;
};

workerScope.onmessage = async (event) => {
  const request = event.data;
  try {
    const startedAt = Date.now();

    // Working raster: downscale into an OffscreenCanvas so the sweep stays in
    // the compute budget; all window coords normalize by these working dims.
    const downscale = embeddingMatchDownscaleFor(request.rasterWidth, request.rasterHeight);
    const workW = Math.max(1, Math.round(request.rasterWidth * downscale));
    const workH = Math.max(1, Math.round(request.rasterHeight * downscale));
    const rasterCanvas = new OffscreenCanvas(request.rasterWidth, request.rasterHeight);
    rasterCanvas
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(request.rasterRgba),
          request.rasterWidth,
          request.rasterHeight,
        ),
        0,
        0,
      );
    const work = new OffscreenCanvas(workW, workH);
    work.getContext("2d")!.drawImage(rasterCanvas, 0, 0, workW, workH);

    const cropCanvas = new OffscreenCanvas(EMBEDDING_INPUT_PX, EMBEDDING_INPUT_PX);
    const cropCtx = cropCanvas.getContext("2d", { willReadFrequently: true })!;

    // Exemplar embedding (the query vector).
    const exemplarCanvas = new OffscreenCanvas(request.exemplarWidth, request.exemplarHeight);
    exemplarCanvas
      .getContext("2d")!
      .putImageData(
        new ImageData(
          new Uint8ClampedArray(request.exemplarRgba),
          request.exemplarWidth,
          request.exemplarHeight,
        ),
        0,
        0,
      );
    const exemplarInput = cropToInputData(
      cropCtx,
      exemplarCanvas,
      0,
      0,
      Math.min(request.exemplarWidth, request.exemplarHeight),
    );
    const [exemplar] = await embedCrops([toInput(exemplarInput)]);

    const footprintWork = Math.max(1, request.footprintPx * downscale);
    const plan = planEmbeddingSweep(footprintWork, workW, workH);

    // Score a set of window centers at a given side; returns scored candidates
    // in normalized [0,1] sheet space plus their embeddings (for reuse).
    const embedWindows = async (
      centers: Array<{ x: number; y: number }>,
      side: number,
      scale: number,
    ): Promise<EmbeddingMatchCandidate[]> => {
      const inputs = centers.map((c) =>
        toInput(cropToInputData(cropCtx, work, c.x - side / 2, c.y - side / 2, side)),
      );
      const embeddings = await embedCrops(inputs);
      const windows: ScoredWindow[] = centers.map((c, i) => ({
        x: c.x / workW,
        y: c.y / workH,
        scale,
        embedding: embeddings[i],
      }));
      return scoreEmbeddingWindows(exemplar, windows);
    };

    // Coarse pass across every scale, then a fine pass only around windows that
    // came within the recall margin of the threshold.
    let windowCount = 0;
    const all: EmbeddingMatchCandidate[] = [];
    for (const scaleEntry of plan.scales) {
      const coarseCenters = sweepWindowCenters(
        workW,
        workH,
        scaleEntry.windowPx,
        scaleEntry.coarseStridePx,
      );
      windowCount += coarseCenters.length;
      const coarse = await embedWindows(coarseCenters, scaleEntry.windowPx, scaleEntry.scale);
      all.push(...coarse);

      const promising = coarse.filter(
        (c) => c.score >= request.threshold - EMBEDDING_RECALL_MARGIN,
      );
      const refineCenters: Array<{ x: number; y: number }> = [];
      const step = scaleEntry.fineStridePx;
      for (const hit of promising) {
        const hx = hit.x * workW;
        const hy = hit.y * workH;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) continue;
            refineCenters.push({ x: hx + dx * step, y: hy + dy * step });
          }
        }
      }
      if (refineCenters.length > 0) {
        windowCount += refineCenters.length;
        all.push(...(await embedWindows(refineCenters, scaleEntry.windowPx, scaleEntry.scale)));
      }
    }

    const radius = embeddingDedupeRadius(footprintWork, workW, workH);
    const candidates = selectEmbeddingMatches(all, request.threshold, radius);
    workerScope.postMessage({
      id: request.id,
      ok: true,
      candidates,
      topScores: topEmbeddingScores(all),
      downscale,
      windowCount,
      appliedThreshold: request.threshold,
      embeddingDim: EMBEDDING_DIM,
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
