// The template-match sweep (AITAKEOFF6 Task 0). CV proposes, the model
// verifies: normalized cross-correlation of the exemplar template against
// the whole detection raster finds every same-scale instance of a symbol
// deterministically — no tiles, so seams cannot exist here. Everything is
// recall-biased; stage-B verification stays the precision gate.
//
// The opencv.js module arrives by injection so this file runs identically in
// the Web Worker (browser wasm) and under plain node in the smoke suite —
// the fixture proof exercises the REAL matcher, not a stand-in.

import {
  matchDownscaleFor,
  suppressNonMaxima,
  TEMPLATE_MATCH_SCALES,
  TEMPLATE_ROTATION_STEP_DEG,
  planRotationSweep,
  type TemplateMatchCandidate,
} from "./template-match-domain.ts";
import type { SheetRadius } from "../ai-takeoff-domain.ts";
import { tileFrameFor, tileLocalToSheetPoint } from "../coord-transforms.ts";
import type { CvMat, OpenCvApi } from "./opencv-runtime.ts";

/** RGBA pixel buffer (canvas ImageData layout). */
export interface RgbaImage {
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface TemplateMatchOptions {
  /** Recall-biased NCC floor — candidates below never reach stage B. */
  threshold: number;
  /** Exemplar ink footprint on the detection raster, in raster pixels. */
  footprintPx: number;
  /**
   * The canonical NMS radius from exemplarSheetGeometry (AITAKEOFF7): the
   * matcher no longer derives its own — one derivation site, capped, shared
   * with every other dedupe/suppression consumer.
   */
  radius: SheetRadius;
  rotationStepDeg?: number;
  scales?: readonly number[];
  maxLongEdgePx?: number;
}

export interface TemplateMatchOutput {
  candidates: TemplateMatchCandidate[];
  /** Matching resolution actually used (diagnostics + tests). */
  matchWidthPx: number;
  matchHeightPx: number;
  downscale: number;
  sweepCount: number;
  /** True when the safety cap dropped hits — never silently. */
  truncated: boolean;
}

// Binarization: CAD ink on white. Mean-adaptive with a fixed block keeps
// thin linework solid regardless of local paper tone; INV puts ink at 255.
const BINARIZE_BLOCK_PX = 31;
const BINARIZE_DELTA = 10;
// Safety cap on hits leaving the matcher — a pathological sheet (hatching
// that correlates everywhere) must not flood stage B. Reported, never silent.
export const TEMPLATE_MATCH_MAX_HITS = 512;

/** Track-and-free helper: every Mat registered here dies in the finally. */
function matScope() {
  const mats: CvMat[] = [];
  return {
    track<T extends CvMat>(mat: T): T {
      mats.push(mat);
      return mat;
    },
    release() {
      for (const mat of mats) mat.delete();
      mats.length = 0;
    },
  };
}

function rgbaToGray(cv: OpenCvApi, image: RgbaImage, scope: ReturnType<typeof matScope>): CvMat {
  const rgba = scope.track(new cv.Mat(image.height, image.width, cv.CV_8UC4));
  rgba.data.set(
    image.data instanceof Uint8Array
      ? image.data
      : new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
  );
  const gray = scope.track(new cv.Mat());
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);
  return gray;
}

function binarize(cv: OpenCvApi, gray: CvMat, scope: ReturnType<typeof matScope>): CvMat {
  const bin = scope.track(new cv.Mat());
  cv.adaptiveThreshold(
    gray,
    bin,
    255,
    cv.ADAPTIVE_THRESH_MEAN_C,
    cv.THRESH_BINARY_INV,
    BINARIZE_BLOCK_PX,
    BINARIZE_DELTA,
  );
  return bin;
}

/** Any ink within `radiusPx` of a point on a binarized (ink=255) raster? */
function hasInkNear(bin: CvMat, centerX: number, centerY: number, radiusPx: number): boolean {
  const radius = Math.max(1, Math.round(radiusPx));
  const x0 = Math.max(0, Math.round(centerX) - radius);
  const x1 = Math.min(bin.cols - 1, Math.round(centerX) + radius);
  const y0 = Math.max(0, Math.round(centerY) - radius);
  const y1 = Math.min(bin.rows - 1, Math.round(centerY) + radius);
  for (let y = y0; y <= y1; y += 1) {
    const row = y * bin.cols;
    for (let x = x0; x <= x1; x += 1) {
      if (bin.data[row + x] !== 0) return true;
    }
  }
  return false;
}

interface SweepHit {
  x: number;
  y: number;
  score: number;
  rotationDeg: number;
  scale: number;
}

/**
 * Grid-max peak collection over one matchTemplate result: one pass, keeping
 * the best score per footprint-half cell. The plateau around a genuine hit
 * collapses here cheaply; cross-sweep and cross-cell duplicates collapse in
 * the final footprint-radius NMS.
 */
function collectPeaks(
  result: CvMat,
  threshold: number,
  cellPx: number,
  offsetX: number,
  offsetY: number,
  rotationDeg: number,
  scale: number,
): SweepHit[] {
  const cell = Math.max(2, Math.round(cellPx));
  const best = new Map<number, SweepHit>();
  const { rows, cols } = result;
  const values = result.data32F;
  for (let y = 0; y < rows; y += 1) {
    const rowOffset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const score = values[rowOffset + x];
      // Guard the TM_CCOEFF_NORMED flat-region pathology: near-zero variance
      // windows can emit garbage — only finite, in-range scores count.
      if (!(score >= threshold) || score > 1.0001) continue;
      const key = Math.floor(y / cell) * 65536 + Math.floor(x / cell);
      const existing = best.get(key);
      if (!existing || score > existing.score) {
        best.set(key, { x: x + offsetX, y: y + offsetY, score, rotationDeg, scale });
      }
    }
  }
  return [...best.values()];
}

/**
 * Run the full rotation × scale sweep of one exemplar template against one
 * detection raster. Returns candidates in normalized sheet space — mapped
 * through the SAME tested tile transform the model pipeline uses: the
 * downscaled raster is one whole-sheet tile at origin, so tileFrameFor +
 * tileLocalToSheetPoint is the single conversion out of match space.
 */
export function matchTemplateSweep(
  cv: OpenCvApi,
  raster: RgbaImage,
  template: RgbaImage,
  options: TemplateMatchOptions,
): TemplateMatchOutput {
  const scope = matScope();
  try {
    const downscale = matchDownscaleFor(raster.width, raster.height, options.maxLongEdgePx);
    const matchWidthPx = Math.max(1, Math.round(raster.width * downscale));
    const matchHeightPx = Math.max(1, Math.round(raster.height * downscale));
    const footprintMatchPx = Math.max(2, options.footprintPx * downscale);

    // Raster: gray → downscale → binarize (ink = 255).
    const rasterGray = rgbaToGray(cv, raster, scope);
    let rasterScaled = rasterGray;
    if (downscale !== 1) {
      rasterScaled = scope.track(new cv.Mat());
      cv.resize(
        rasterGray,
        rasterScaled,
        new cv.Size(matchWidthPx, matchHeightPx),
        0,
        0,
        cv.INTER_AREA,
      );
    }
    const rasterBin = binarize(cv, rasterScaled, scope);

    // Template: gray at native resolution, padded with white so every
    // rotation keeps the whole symbol (a square rotated 45° needs √2 sides).
    const templateGray = rgbaToGray(cv, template, scope);
    const pad = Math.ceil((Math.SQRT2 - 1) * Math.max(template.width, template.height) * 0.5) + 1;
    const templatePadded = scope.track(new cv.Mat());
    cv.copyMakeBorder(
      templateGray,
      templatePadded,
      pad,
      pad,
      pad,
      pad,
      cv.BORDER_CONSTANT,
      new cv.Scalar(255),
    );

    const rotations = planRotationSweep(options.rotationStepDeg ?? TEMPLATE_ROTATION_STEP_DEG);
    const scales = options.scales ?? TEMPLATE_MATCH_SCALES;
    const hits: SweepHit[] = [];
    let sweepCount = 0;

    for (const rotationDeg of rotations) {
      // Rotate once per angle at native resolution (white background —
      // opencv angles are counter-clockwise-positive; recovery only needs
      // the same convention both ways).
      let rotated = templatePadded;
      if (rotationDeg !== 0) {
        rotated = scope.track(new cv.Mat());
        const center = new cv.Point(templatePadded.cols / 2, templatePadded.rows / 2);
        const rotation = scope.track(cv.getRotationMatrix2D(center, rotationDeg, 1));
        cv.warpAffine(
          templatePadded,
          rotated,
          rotation,
          new cv.Size(templatePadded.cols, templatePadded.rows),
          cv.INTER_LINEAR,
          cv.BORDER_CONSTANT,
          new cv.Scalar(255),
        );
      }
      for (const scale of scales) {
        const factor = downscale * scale;
        const scaledW = Math.round(rotated.cols * factor);
        const scaledH = Math.round(rotated.rows * factor);
        // A template that no longer fits the match raster has no sweep.
        if (scaledW < 4 || scaledH < 4 || scaledW > matchWidthPx || scaledH > matchHeightPx) {
          continue;
        }
        // Per-sweep scope: the correlation result is raster-sized float32 —
        // 36 of them held to the end would be hundreds of MB of wasm heap.
        const sweepScope = matScope();
        try {
          const templateScaled = sweepScope.track(new cv.Mat());
          cv.resize(rotated, templateScaled, new cv.Size(scaledW, scaledH), 0, 0, cv.INTER_AREA);
          const templateBin = binarize(cv, templateScaled, sweepScope);
          const result = sweepScope.track(new cv.Mat());
          cv.matchTemplate(rasterBin, templateBin, result, cv.TM_CCOEFF_NORMED);
          hits.push(
            ...collectPeaks(
              result,
              options.threshold,
              footprintMatchPx / 2,
              scaledW / 2,
              scaledH / 2,
              rotationDeg,
              scale,
            ),
          );
          sweepCount += 1;
        } finally {
          sweepScope.release();
        }
      }
    }

    // Blank-window guard: a peak with no ink anywhere near it is correlation
    // pathology, not a symbol — deterministic to check, cheap to drop.
    const inked = hits.filter((hit) => hasInkNear(rasterBin, hit.x, hit.y, footprintMatchPx / 2));

    // Match space → normalized sheet space: the one tested transform.
    const frame = tileFrameFor({ left: 0, top: 0 }, matchWidthPx, matchHeightPx);
    const mapped: TemplateMatchCandidate[] = inked.map((hit) => ({
      ...tileLocalToSheetPoint(frame, hit.x, hit.y),
      score: hit.score,
      rotationDeg: hit.rotationDeg,
      scale: hit.scale,
    }));

    // Footprint-radius NMS with the caller's canonical radius, then the
    // safety cap — best scores first, truncation reported.
    const suppressed = suppressNonMaxima(mapped, options.radius);
    const truncated = suppressed.length > TEMPLATE_MATCH_MAX_HITS;
    return {
      candidates: truncated ? suppressed.slice(0, TEMPLATE_MATCH_MAX_HITS) : suppressed,
      matchWidthPx,
      matchHeightPx,
      downscale,
      sweepCount,
      truncated,
    };
  } finally {
    scope.release();
  }
}
