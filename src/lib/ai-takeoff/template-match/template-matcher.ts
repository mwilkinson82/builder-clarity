// The template-match sweep (AITAKEOFF6; masked in AITAKEOFF8; hub-anchored
// in AITAKEOFF9; multi-template + coarse-to-fine in AITAKEOFF10). CV
// proposes, the model verifies: masked normalized cross-correlation of each
// positive reference's INK — the estimator's exemplar plus harvested
// accepted marks, each with its own mask and anchor — against the whole
// detection raster. A coarse 30°/3-scale pass finds promise; a fine
// 10°/±7.5% refinement on small ROIs decides at the real threshold, so thin
// radial symbols sitting between coarse steps stop slipping away without
// paying a 7× flat-sweep bill.
//
// The opencv.js module arrives by injection so this file runs identically in
// the Web Worker (browser wasm) and under plain node in the smoke suite —
// the fixture proof exercises the REAL matcher, not a stand-in.

import {
  fineRotationsFor,
  ladderNeighborsFor,
  LADDER_RECALL_MARGIN,
  matchDownscaleFor,
  MIN_MASK_COVERAGE,
  SECONDARY_TEMPLATE_FLOOR,
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

/** One template: pixels + the marker's offset from the crop center. */
export interface TemplateInput {
  image: RgbaImage;
  /** Hub anchor (AITAKEOFF9): marker − crop center, template-native px. */
  anchor: { x: number; y: number };
}

export interface TemplateMatchOptions {
  /** Recall-biased masked-score floor for the PRIMARY template. */
  threshold: number;
  /** Exemplar ink footprint on the detection raster, in raster pixels. */
  footprintPx: number;
  /** The canonical NMS radius from exemplarSheetGeometry (AITAKEOFF7). */
  radius: SheetRadius;
  /** Fixture comparison flag (AITAKEOFF8): false = legacy unmasked CCOEFF. */
  maskedMatching?: boolean;
  /** Fixture flag: skip the fine refinement, coarse grid decides directly. */
  coarseOnly?: boolean;
  rotationStepDeg?: number;
  scales?: readonly number[];
  maxLongEdgePx?: number;
}

export interface TemplateMatchOutput {
  candidates: TemplateMatchCandidate[];
  matchWidthPx: number;
  matchHeightPx: number;
  downscale: number;
  /** Every matchTemplate invocation — coarse full-raster and fine ROI alike. */
  sweepCount: number;
  templateCount: number;
  /** True when the safety cap dropped hits — never silently. */
  truncated: boolean;
  /** Whether the masked metric ran (false = degenerate fallback). */
  maskedMatching: boolean;
  /** Mask ink fraction of the PRIMARY template's tightened crop. */
  maskCoverage: number;
  /** The score floor applied to the primary template. */
  appliedThreshold: number;
  /** Best sweep scores regardless of threshold (AITAKEOFF8 Task 1). */
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
// Fine-refinement ROI slack per side, in match-space footprints.
const REFINE_MARGIN_FOOTPRINTS = 0.5;
// At most this many coarse seeds refine — the fine pass must stay ROI-cheap
// even on pathological sheets.
const MAX_REFINE_CANDIDATES = 128;
// Safety cap on hits leaving the matcher. Reported, never silent.
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
type MatScope = ReturnType<typeof matScope>;

function rgbaToGray(cv: OpenCvApi, image: RgbaImage, scope: MatScope): CvMat {
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

function binarize(cv: OpenCvApi, gray: CvMat, scope: MatScope): CvMat {
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
  templateIndex: number;
}

/** Rolling top-N sweep scores across everything, threshold or not. */
function makeTopTracker(count: number, minSeparationPx: number) {
  const entries: SweepHit[] = [];
  const separation = Math.max(2, minSeparationPx);
  return {
    entries,
    floor: Number.NEGATIVE_INFINITY,
    offer(hit: SweepHit) {
      const nearIndex = entries.findIndex(
        (entry) => Math.abs(entry.x - hit.x) < separation && Math.abs(entry.y - hit.y) < separation,
      );
      if (nearIndex >= 0) {
        if (hit.score <= entries[nearIndex].score) return;
        entries[nearIndex] = hit;
      } else if (entries.length < count) {
        entries.push(hit);
      } else {
        let worst = 0;
        for (let index = 1; index < entries.length; index += 1) {
          if (entries[index].score < entries[worst].score) worst = index;
        }
        if (hit.score <= entries[worst].score) {
          this.floor = entries[worst].score;
          return;
        }
        entries[worst] = hit;
      }
      entries.sort((a, b) => b.score - a.score);
      this.floor =
        entries.length < count ? Number.NEGATIVE_INFINITY : entries[entries.length - 1].score;
    },
  };
}
type TopTracker = ReturnType<typeof makeTopTracker>;

/** Grid-max peak collection over one matchTemplate result. */
function collectPeaks(
  result: CvMat,
  threshold: number,
  cellPx: number,
  offsetX: number,
  offsetY: number,
  rotationDeg: number,
  scale: number,
  templateIndex: number,
  topTracker: TopTracker | null,
): SweepHit[] {
  const cell = Math.max(2, Math.round(cellPx));
  const best = new Map<number, SweepHit>();
  const { rows, cols } = result;
  const values = result.data32F;
  for (let y = 0; y < rows; y += 1) {
    const rowOffset = y * cols;
    for (let x = 0; x < cols; x += 1) {
      const score = values[rowOffset + x];
      // Guard normalization pathologies (NaN on blank, garbage on flat).
      if (!Number.isFinite(score) || score > 1.0001) continue;
      if (topTracker && score > topTracker.floor) {
        topTracker.offer({
          x: x + offsetX,
          y: y + offsetY,
          score,
          rotationDeg,
          scale,
          templateIndex,
        });
      }
      if (score < threshold) continue;
      const key = Math.floor(y / cell) * 65536 + Math.floor(x / cell);
      const existing = best.get(key);
      if (!existing || score > existing.score) {
        best.set(key, { x: x + offsetX, y: y + offsetY, score, rotationDeg, scale, templateIndex });
      }
    }
  }
  return [...best.values()];
}

/** One template prepared for sweeping: padded gray + mask + anchor. */
interface PreparedTemplate {
  padded: CvMat;
  maskPadded: CvMat;
  anchorVsCenter: { x: number; y: number };
  maskCoverage: number;
  hasInk: boolean;
  /** Per-angle warp cache — fine angles reuse across ROI refinements. */
  rotationCache: Map<number, { rotated: CvMat; rotatedMask: CvMat }>;
}

function prepareTemplate(
  cv: OpenCvApi,
  template: TemplateInput,
  scope: MatScope,
): PreparedTemplate {
  const grayFull = rgbaToGray(cv, template.image, scope);
  const binFull = binarize(cv, grayFull, scope);
  const maskFull = scope.track(new cv.Mat());
  const dilateKernel = scope.track(
    cv.Mat.ones(MASK_DILATE_KERNEL_PX, MASK_DILATE_KERNEL_PX, cv.CV_8UC1),
  );
  cv.dilate(binFull, maskFull, dilateKernel);

  const inkBox = inkBoundingBox(maskFull);
  const markerInCrop = {
    x: template.image.width / 2 + template.anchor.x,
    y: template.image.height / 2 + template.anchor.y,
  };
  let gray = grayFull;
  let maskTight = maskFull;
  let anchorVsCenter = { x: 0, y: 0 };
  if (inkBox) {
    const left = Math.max(0, inkBox.left - TIGHTEN_MARGIN_PX);
    const top = Math.max(0, inkBox.top - TIGHTEN_MARGIN_PX);
    const width = Math.min(template.image.width - left, inkBox.width + 2 * TIGHTEN_MARGIN_PX);
    const height = Math.min(template.image.height - top, inkBox.height + 2 * TIGHTEN_MARGIN_PX);
    const roi = new cv.Rect(left, top, width, height);
    gray = scope.track(grayFull.roi(roi).clone());
    maskTight = scope.track(maskFull.roi(roi).clone());
    anchorVsCenter = {
      x: markerInCrop.x - (left + width / 2),
      y: markerInCrop.y - (top + height / 2),
    };
  }
  const maskCoverage = inkBox
    ? cv.countNonZero(maskTight) / Math.max(1, maskTight.cols * maskTight.rows)
    : 0;

  const pad = Math.ceil((Math.SQRT2 - 1) * Math.max(gray.cols, gray.rows) * 0.5) + 1;
  const padded = scope.track(new cv.Mat());
  cv.copyMakeBorder(gray, padded, pad, pad, pad, pad, cv.BORDER_CONSTANT, new cv.Scalar(255));
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

  return {
    padded,
    maskPadded,
    anchorVsCenter,
    maskCoverage,
    hasInk: Boolean(inkBox),
    rotationCache: new Map(),
  };
}

/** Rotated template + mask for one angle, cached (opencv CCW convention). */
function rotatedVariant(
  cv: OpenCvApi,
  prepared: PreparedTemplate,
  rotationDeg: number,
  scope: MatScope,
): { rotated: CvMat; rotatedMask: CvMat } {
  const cached = prepared.rotationCache.get(rotationDeg);
  if (cached) return cached;
  if (rotationDeg === 0) {
    const entry = { rotated: prepared.padded, rotatedMask: prepared.maskPadded };
    prepared.rotationCache.set(0, entry);
    return entry;
  }
  const center = new cv.Point(prepared.padded.cols / 2, prepared.padded.rows / 2);
  const rotation = scope.track(cv.getRotationMatrix2D(center, rotationDeg, 1));
  const rotated = scope.track(new cv.Mat());
  cv.warpAffine(
    prepared.padded,
    rotated,
    rotation,
    new cv.Size(prepared.padded.cols, prepared.padded.rows),
    cv.INTER_LINEAR,
    cv.BORDER_CONSTANT,
    new cv.Scalar(255),
  );
  const rotatedMask = scope.track(new cv.Mat());
  cv.warpAffine(
    prepared.maskPadded,
    rotatedMask,
    rotation,
    new cv.Size(prepared.maskPadded.cols, prepared.maskPadded.rows),
    cv.INTER_NEAREST,
    cv.BORDER_CONSTANT,
    new cv.Scalar(0),
  );
  const entry = { rotated, rotatedMask };
  prepared.rotationCache.set(rotationDeg, entry);
  return entry;
}

/** The anchor offset for one rotation, in padded-template native px. */
function rotatedAnchor(prepared: PreparedTemplate, rotationDeg: number): { x: number; y: number } {
  // opencv angle a rotates content by −a in y-down pixel algebra (pinned
  // empirically in the AITAKEOFF6 fixtures) — the anchor transforms with it.
  const rad = (-rotationDeg * Math.PI) / 180;
  return {
    x: Math.cos(rad) * prepared.anchorVsCenter.x - Math.sin(rad) * prepared.anchorVsCenter.y,
    y: Math.sin(rad) * prepared.anchorVsCenter.x + Math.cos(rad) * prepared.anchorVsCenter.y,
  };
}

/**
 * Run the coarse-to-fine multi-template sweep against one detection raster.
 * Hits map through the SAME tested tile transform the model pipeline uses:
 * the downscaled raster is one whole-sheet tile at origin, so tileFrameFor +
 * tileLocalToSheetPoint is the single conversion out of match space.
 */
export function matchTemplatesSweep(
  cv: OpenCvApi,
  raster: RgbaImage,
  templates: TemplateInput[],
  options: TemplateMatchOptions,
): TemplateMatchOutput {
  const scope = matScope();
  try {
    const downscale = matchDownscaleFor(raster.width, raster.height, options.maxLongEdgePx);
    const matchWidthPx = Math.max(1, Math.round(raster.width * downscale));
    const matchHeightPx = Math.max(1, Math.round(raster.height * downscale));
    const footprintMatchPx = Math.max(2, options.footprintPx * downscale);

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

    const prepared = templates.map((template) => prepareTemplate(cv, template, scope));
    const primary = prepared[0];
    if (!primary || !primary.hasInk) {
      // A primary template with NO ink can never match — empty in, empty out.
      return {
        candidates: [],
        matchWidthPx,
        matchHeightPx,
        downscale,
        sweepCount: 0,
        templateCount: templates.length,
        truncated: false,
        maskedMatching: false,
        maskCoverage: 0,
        appliedThreshold: UNMASKED_TEMPLATE_MATCH_THRESHOLD,
        topScores: [],
      };
    }
    const masked = options.maskedMatching !== false && primary.maskCoverage >= MIN_MASK_COVERAGE;
    const appliedThreshold = masked ? options.threshold : UNMASKED_TEMPLATE_MATCH_THRESHOLD;
    /** Secondary templates are unvetted crops — they earn a higher floor. */
    const thresholdFor = (templateIndex: number) =>
      templateIndex === 0 ? appliedThreshold : Math.max(appliedThreshold, SECONDARY_TEMPLATE_FLOOR);

    const coarseRotations = planRotationSweep(
      options.rotationStepDeg ?? TEMPLATE_ROTATION_STEP_DEG,
    );
    const coarseScales = options.scales ?? TEMPLATE_MATCH_SCALES;
    const topTracker = makeTopTracker(TEMPLATE_TOP_SCORE_COUNT, footprintMatchPx);
    let sweepCount = 0;

    /** One matchTemplate pass of one template variant over a target mat. */
    const sweepVariant = (
      target: CvMat,
      templateIndex: number,
      rotationDeg: number,
      scale: number,
      threshold: number,
      regionOffset: { x: number; y: number },
      sweepScope: MatScope,
    ): SweepHit[] => {
      const preparedTemplate = prepared[templateIndex];
      if (!preparedTemplate.hasInk) return [];
      const variant = rotatedVariant(cv, preparedTemplate, rotationDeg, scope);
      const factor = downscale * scale;
      const scaledW = Math.round(variant.rotated.cols * factor);
      const scaledH = Math.round(variant.rotated.rows * factor);
      if (scaledW < 4 || scaledH < 4 || scaledW > target.cols || scaledH > target.rows) return [];
      const templateScaled = sweepScope.track(new cv.Mat());
      cv.resize(
        variant.rotated,
        templateScaled,
        new cv.Size(scaledW, scaledH),
        0,
        0,
        cv.INTER_AREA,
      );
      const templateBin = binarize(cv, templateScaled, sweepScope);
      const result = sweepScope.track(new cv.Mat());
      if (masked) {
        const maskResized = sweepScope.track(new cv.Mat());
        cv.resize(
          variant.rotatedMask,
          maskResized,
          new cv.Size(scaledW, scaledH),
          0,
          0,
          cv.INTER_AREA,
        );
        const maskScaled = sweepScope.track(new cv.Mat());
        cv.threshold(maskResized, maskScaled, 63, 255, cv.THRESH_BINARY);
        cv.matchTemplate(target, templateBin, result, cv.TM_CCORR_NORMED, maskScaled);
      } else {
        cv.matchTemplate(target, templateBin, result, cv.TM_CCOEFF_NORMED);
      }
      sweepCount += 1;
      const anchor = rotatedAnchor(preparedTemplate, rotationDeg);
      return collectPeaks(
        result,
        threshold,
        footprintMatchPx / 2,
        regionOffset.x + scaledW / 2 + anchor.x * factor,
        regionOffset.y + scaledH / 2 + anchor.y * factor,
        rotationDeg,
        scale,
        templateIndex,
        topTracker,
      );
    };

    // COARSE PASS: full raster, recall-pool threshold, every template.
    const coarsePool: SweepHit[] = [];
    for (let templateIndex = 0; templateIndex < prepared.length; templateIndex += 1) {
      const poolThreshold = Math.max(0.05, thresholdFor(templateIndex) - LADDER_RECALL_MARGIN);
      for (const rotationDeg of coarseRotations) {
        for (const scale of coarseScales) {
          const sweepScope = matScope();
          try {
            coarsePool.push(
              ...sweepVariant(
                rasterBin,
                templateIndex,
                rotationDeg,
                scale,
                poolThreshold,
                { x: 0, y: 0 },
                sweepScope,
              ),
            );
          } finally {
            sweepScope.release();
          }
        }
      }
    }

    // Promising coarse cells, NMS'd (normalized space, the canonical radius)
    // so one symbol refines at most once per winning template.
    const refineSeeds = suppressNonMaxima(
      coarsePool.map((hit) => ({ ...hit, x: hit.x / matchWidthPx, y: hit.y / matchHeightPx })),
      options.radius,
    )
      .slice(0, MAX_REFINE_CANDIDATES)
      .map((hit) => ({ ...hit, x: hit.x * matchWidthPx, y: hit.y * matchHeightPx }));

    // FINE PASS: ±10° / ladder-neighbor scales on a small ROI per seed; the
    // refined best decides at the REAL threshold. (coarseOnly = fixture flag
    // for comparing grids; seeds then decide directly.)
    const finalHits: SweepHit[] = [];
    for (const seed of refineSeeds) {
      const threshold = thresholdFor(seed.templateIndex);
      if (options.coarseOnly) {
        if (seed.score >= threshold) finalHits.push(seed);
        continue;
      }
      const preparedTemplate = prepared[seed.templateIndex];
      const seedVariant = rotatedVariant(cv, preparedTemplate, seed.rotationDeg, scope);
      const maxSide = Math.ceil(
        Math.max(seedVariant.rotated.cols, seedVariant.rotated.rows) *
          downscale *
          seed.scale *
          1.16 +
          REFINE_MARGIN_FOOTPRINTS * footprintMatchPx * 2,
      );
      const half = Math.ceil(maxSide / 2);
      const left = Math.max(0, Math.min(matchWidthPx - maxSide, Math.round(seed.x) - half));
      const top = Math.max(0, Math.min(matchHeightPx - maxSide, Math.round(seed.y) - half));
      const width = Math.min(maxSide, matchWidthPx - left);
      const height = Math.min(maxSide, matchHeightPx - top);
      if (width < 8 || height < 8) continue;
      const roiScope = matScope();
      try {
        const roi = roiScope.track(rasterBin.roi(new cv.Rect(left, top, width, height)).clone());
        let best: SweepHit | null = null;
        for (const rotationDeg of fineRotationsFor(seed.rotationDeg)) {
          for (const scale of ladderNeighborsFor(seed.scale)) {
            const sweepScope = matScope();
            try {
              // Collect everything in the tiny ROI; the best decides below.
              const hits = sweepVariant(
                roi,
                seed.templateIndex,
                rotationDeg,
                scale,
                0.05,
                { x: left, y: top },
                sweepScope,
              );
              for (const hit of hits) {
                if (!best || hit.score > best.score) best = hit;
              }
            } finally {
              sweepScope.release();
            }
          }
        }
        if (best && best.score >= threshold) finalHits.push(best);
      } finally {
        roiScope.release();
      }
    }

    // Blank-window guard, then match space → sheet space, NMS, cap.
    const inked = finalHits.filter((hit) =>
      hasInkNear(rasterBin, hit.x, hit.y, footprintMatchPx / 2),
    );
    const frame = tileFrameFor({ left: 0, top: 0 }, matchWidthPx, matchHeightPx);
    const mapped: TemplateMatchCandidate[] = inked.map((hit) => ({
      ...tileLocalToSheetPoint(frame, hit.x, hit.y),
      score: hit.score,
      rotationDeg: hit.rotationDeg,
      scale: hit.scale,
      templateIndex: hit.templateIndex,
    }));
    const topScores: TemplateTopScore[] = topTracker.entries.map((hit) => ({
      ...tileLocalToSheetPoint(frame, hit.x, hit.y),
      score: hit.score,
      rotationDeg: hit.rotationDeg,
      scale: hit.scale,
      templateIndex: hit.templateIndex,
    }));
    const suppressed = suppressNonMaxima(mapped, options.radius);
    const truncated = suppressed.length > TEMPLATE_MATCH_MAX_HITS;
    return {
      candidates: truncated ? suppressed.slice(0, TEMPLATE_MATCH_MAX_HITS) : suppressed,
      matchWidthPx,
      matchHeightPx,
      downscale,
      sweepCount,
      templateCount: templates.length,
      truncated,
      maskedMatching: masked,
      maskCoverage: primary.maskCoverage,
      appliedThreshold,
      topScores,
    };
  } finally {
    scope.release();
  }
}

/** Single-template compatibility wrapper (fixtures + probes). */
export function matchTemplateSweep(
  cv: OpenCvApi,
  raster: RgbaImage,
  template: RgbaImage,
  options: TemplateMatchOptions & { anchor?: { x: number; y: number } },
): TemplateMatchOutput {
  const { anchor, ...rest } = options;
  return matchTemplatesSweep(
    cv,
    raster,
    [{ image: template, anchor: anchor ?? { x: 0, y: 0 } }],
    rest,
  );
}
