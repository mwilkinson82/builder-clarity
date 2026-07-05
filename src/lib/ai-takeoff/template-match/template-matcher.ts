// The template-match sweep (AITAKEOFF6 Task 0, masked in AITAKEOFF8). CV
// proposes, the model verifies: masked normalized cross-correlation of the
// exemplar's INK — not its neighborhood — against the whole detection
// raster. The A-100 zero-hit incident proved whole-rectangle correlation
// structurally wrong on real sheets: the template crop carries fused context
// linework and forced-white rotation padding, and at true match sites the
// differing context dragged every score under the threshold. With the
// dilated ink mask, padding and context stop mattering by construction.
//
// The opencv.js module arrives by injection so this file runs identically in
// the Web Worker (browser wasm) and under plain node in the smoke suite —
// the fixture proof exercises the REAL matcher, not a stand-in.

import {
  matchDownscaleFor,
  MIN_MASK_COVERAGE,
  suppressNonMaxima,
  TEMPLATE_MATCH_SCALES,
  TEMPLATE_ROTATION_STEP_DEG,
  TEMPLATE_TOP_SCORE_COUNT,
  UNMASKED_TEMPLATE_MATCH_THRESHOLD,
  planRotationSweep,
  type TemplateMatchCandidate,
  type TemplateTopScore,
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
  /** Recall-biased masked-score floor — candidates below never reach stage B. */
  threshold: number;
  /** Exemplar ink footprint on the detection raster, in raster pixels. */
  footprintPx: number;
  /**
   * The canonical NMS radius from exemplarSheetGeometry (AITAKEOFF7): the
   * matcher no longer derives its own — one derivation site, capped, shared
   * with every other dedupe/suppression consumer.
   */
  radius: SheetRadius;
  /**
   * Fixture comparison flag (AITAKEOFF8 Task 2): false forces the legacy
   * unmasked CCOEFF path. Production always masks (unless the mask is
   * degenerate, which falls back automatically and says so).
   */
  maskedMatching?: boolean;
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
  /** Whether the masked metric actually ran (false = degenerate fallback). */
  maskedMatching: boolean;
  /** Mask ink fraction of the tightened template crop. */
  maskCoverage: number;
  /** The score floor the sweep actually applied. */
  appliedThreshold: number;
  /**
   * Best sweep scores regardless of the threshold (AITAKEOFF8 Task 1) — a
   * zero-hit sheet reports 0.41-vs-0.78, never an opaque nothing.
   */
  topScores: TemplateTopScore[];
}

// Binarization: CAD ink on white. Mean-adaptive with a fixed block keeps
// thin linework solid regardless of local paper tone; INV puts ink at 255.
const BINARIZE_BLOCK_PX = 31;
const BINARIZE_DELTA = 10;
// Mask growth around the template's ink: ±2px tolerance for antialiasing and
// slight misalignment without letting the neighborhood back in.
const MASK_DILATE_KERNEL_PX = 5;
// Margin kept around the mask's ink bbox when tightening the template crop.
const TIGHTEN_MARGIN_PX = 3;
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

/** Bounding box of non-zero pixels, or null for an all-blank mat. */
function inkBoundingBox(
  mat: CvMat,
): { left: number; top: number; width: number; height: number } | null {
  let minX = mat.cols;
  let minY = mat.rows;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < mat.rows; y += 1) {
    const row = y * mat.cols;
    for (let x = 0; x < mat.cols; x += 1) {
      if (mat.data[row + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

interface SweepHit {
  x: number;
  y: number;
  score: number;
  rotationDeg: number;
  scale: number;
}

/**
 * Rolling top-N sweep scores across ALL sweeps, threshold or not
 * (AITAKEOFF8 Task 1). Entries keep a minimum separation so the list shows
 * N distinct places, not N pixels of one plateau.
 */
function makeTopTracker(count: number, minSeparationPx: number) {
  const entries: SweepHit[] = [];
  const separation = Math.max(2, minSeparationPx);
  return {
    entries,
    floor: Number.NEGATIVE_INFINITY,
    offer(x: number, y: number, score: number, rotationDeg: number, scale: number) {
      const nearIndex = entries.findIndex(
        (entry) => Math.abs(entry.x - x) < separation && Math.abs(entry.y - y) < separation,
      );
      if (nearIndex >= 0) {
        if (score <= entries[nearIndex].score) return;
        entries[nearIndex] = { x, y, score, rotationDeg, scale };
      } else if (entries.length < count) {
        entries.push({ x, y, score, rotationDeg, scale });
      } else {
        let worst = 0;
        for (let index = 1; index < entries.length; index += 1) {
          if (entries[index].score < entries[worst].score) worst = index;
        }
        if (score <= entries[worst].score) {
          this.floor = entries[worst].score;
          return;
        }
        entries[worst] = { x, y, score, rotationDeg, scale };
      }
      entries.sort((a, b) => b.score - a.score);
      this.floor =
        entries.length < count ? Number.NEGATIVE_INFINITY : entries[entries.length - 1].score;
    },
  };
}

/**
 * Grid-max peak collection over one matchTemplate result: one pass, keeping
 * the best score per footprint-half cell, feeding the top tracker with every
 * finite score along the way. The plateau around a genuine hit collapses
 * here cheaply; cross-sweep duplicates collapse in the final NMS.
 */
function collectPeaks(
  result: CvMat,
  threshold: number,
  cellPx: number,
  offsetX: number,
  offsetY: number,
  rotationDeg: number,
  scale: number,
  topTracker: ReturnType<typeof makeTopTracker>,
): SweepHit[] {
  const cell = Math.max(2, Math.round(cellPx));
  const best = new Map<number, SweepHit>();
  const { rows, cols } = result;
  const values = result.data32F;
  for (let y = 0; y < rows; y += 1) {
    const rowOffset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const score = values[rowOffset + x];
      // Guard normalization pathologies: masked CCORR emits NaN on blank
      // regions (0/0) and CCOEFF can emit garbage on flat ones — only
      // finite, in-range scores count anywhere below.
      if (!Number.isFinite(score) || score > 1.0001) continue;
      if (score > topTracker.floor) {
        topTracker.offer(x + offsetX, y + offsetY, score, rotationDeg, scale);
      }
      if (score < threshold) continue;
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

    // Template + mask at native resolution (AITAKEOFF8 Task 0): the mask is
    // the template's own binarized ink dilated ~2px — only symbol ink
    // participates in the correlation. Both tighten to the ink bbox (+small
    // margin): smaller template, faster sweep, less garbage.
    const templateGrayFull = rgbaToGray(cv, template, scope);
    const templateBinFull = binarize(cv, templateGrayFull, scope);
    const maskFull = scope.track(new cv.Mat());
    const dilateKernel = scope.track(
      cv.Mat.ones(MASK_DILATE_KERNEL_PX, MASK_DILATE_KERNEL_PX, cv.CV_8UC1),
    );
    cv.dilate(templateBinFull, maskFull, dilateKernel);

    const inkBox = inkBoundingBox(maskFull);
    let templateGray = templateGrayFull;
    let maskTight = maskFull;
    if (inkBox) {
      const left = Math.max(0, inkBox.left - TIGHTEN_MARGIN_PX);
      const top = Math.max(0, inkBox.top - TIGHTEN_MARGIN_PX);
      const width = Math.min(template.width - left, inkBox.width + 2 * TIGHTEN_MARGIN_PX);
      const height = Math.min(template.height - top, inkBox.height + 2 * TIGHTEN_MARGIN_PX);
      const roi = new cv.Rect(left, top, width, height);
      templateGray = scope.track(templateGrayFull.roi(roi).clone());
      maskTight = scope.track(maskFull.roi(roi).clone());
    }
    const maskCoverage = inkBox
      ? cv.countNonZero(maskTight) / Math.max(1, maskTight.cols * maskTight.rows)
      : 0;
    // A template with NO ink at all can never match a symbol — and feeding a
    // zero-variance template to CCOEFF emits garbage scores everywhere.
    // Empty in, empty out, reported through the same funnel fields.
    if (!inkBox) {
      return {
        candidates: [],
        matchWidthPx,
        matchHeightPx,
        downscale,
        sweepCount: 0,
        truncated: false,
        maskedMatching: false,
        maskCoverage: 0,
        appliedThreshold: UNMASKED_TEMPLATE_MATCH_THRESHOLD,
        topScores: [],
      };
    }
    // Degenerate-mask guard: a nearly-empty mask matches everything, so the
    // sweep falls back to the legacy unmasked metric — reported, never
    // silent (the funnel shows masked=false + the coverage that caused it).
    const masked = options.maskedMatching !== false && maskCoverage >= MIN_MASK_COVERAGE;
    const appliedThreshold = masked ? options.threshold : UNMASKED_TEMPLATE_MATCH_THRESHOLD;

    // Pad for rotation headroom: template with white paper, mask with BLACK
    // — the pad zone never participates in a masked correlation.
    const pad =
      Math.ceil((Math.SQRT2 - 1) * Math.max(templateGray.cols, templateGray.rows) * 0.5) + 1;
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
    const maskPadded = scope.track(new cv.Mat());
    cv.copyMakeBorder(
      maskTight,
      maskPadded,
      pad,
      pad,
      pad,
      pad,
      cv.BORDER_CONSTANT,
      new cv.Scalar(0),
    );

    const rotations = planRotationSweep(options.rotationStepDeg ?? TEMPLATE_ROTATION_STEP_DEG);
    const scales = options.scales ?? TEMPLATE_MATCH_SCALES;
    const hits: SweepHit[] = [];
    const topTracker = makeTopTracker(TEMPLATE_TOP_SCORE_COUNT, footprintMatchPx);
    let sweepCount = 0;

    for (const rotationDeg of rotations) {
      // Rotate once per angle at native resolution (opencv angles are
      // counter-clockwise-positive; recovery only needs the same convention
      // both ways). The mask rotates with the SAME matrix, nearest-neighbor
      // so it stays binary, black border so nothing new joins it.
      let rotated = templatePadded;
      let rotatedMask = maskPadded;
      if (rotationDeg !== 0) {
        const center = new cv.Point(templatePadded.cols / 2, templatePadded.rows / 2);
        const rotation = scope.track(cv.getRotationMatrix2D(center, rotationDeg, 1));
        rotated = scope.track(new cv.Mat());
        cv.warpAffine(
          templatePadded,
          rotated,
          rotation,
          new cv.Size(templatePadded.cols, templatePadded.rows),
          cv.INTER_LINEAR,
          cv.BORDER_CONSTANT,
          new cv.Scalar(255),
        );
        rotatedMask = scope.track(new cv.Mat());
        cv.warpAffine(
          maskPadded,
          rotatedMask,
          rotation,
          new cv.Size(maskPadded.cols, maskPadded.rows),
          cv.INTER_NEAREST,
          cv.BORDER_CONSTANT,
          new cv.Scalar(0),
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
          if (masked) {
            // Scale the mask alongside; re-binarize generously (≥64) so the
            // dilation ring survives INTER_AREA at half resolution.
            const maskResized = sweepScope.track(new cv.Mat());
            cv.resize(rotatedMask, maskResized, new cv.Size(scaledW, scaledH), 0, 0, cv.INTER_AREA);
            const maskScaled = sweepScope.track(new cv.Mat());
            cv.threshold(maskResized, maskScaled, 63, 255, cv.THRESH_BINARY);
            cv.matchTemplate(rasterBin, templateBin, result, cv.TM_CCORR_NORMED, maskScaled);
          } else {
            cv.matchTemplate(rasterBin, templateBin, result, cv.TM_CCOEFF_NORMED);
          }
          hits.push(
            ...collectPeaks(
              result,
              appliedThreshold,
              footprintMatchPx / 2,
              scaledW / 2,
              scaledH / 2,
              rotationDeg,
              scale,
              topTracker,
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
    const topScores: TemplateTopScore[] = topTracker.entries.map((hit) => ({
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
      maskedMatching: masked,
      maskCoverage,
      appliedThreshold,
      topScores,
    };
  } finally {
    scope.release();
  }
}
