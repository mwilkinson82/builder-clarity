export type RevisionPixelClass = "background" | "unchanged" | "new" | "removed";

export interface RevisionRedlineBenchmark {
  total: number;
  background: number;
  unchanged: number;
  new: number;
  removed: number;
  changed: number;
  changedPercent: number;
}

export function classifyRevisionPixel(currentInk: boolean, priorInk: boolean): RevisionPixelClass {
  if (currentInk && priorInk) return "unchanged";
  if (currentInk) return "new";
  if (priorInk) return "removed";
  return "background";
}

// Deterministic mask benchmark used before production revision-overlay releases.
// The renderer may be PDF, raster, or synthetic; after registration it only
// needs one normalized ink mask per sheet. This keeps the acceptance criterion
// independent from a vision model and makes red/green behavior repeatable.
export function benchmarkRevisionMasks(
  currentMask: readonly boolean[],
  priorMask: readonly boolean[],
): RevisionRedlineBenchmark {
  if (currentMask.length !== priorMask.length || currentMask.length === 0) {
    throw new Error("Revision benchmark masks must have the same non-zero dimensions.");
  }
  const counts: Record<RevisionPixelClass, number> = {
    background: 0,
    unchanged: 0,
    new: 0,
    removed: 0,
  };
  for (let index = 0; index < currentMask.length; index += 1) {
    counts[classifyRevisionPixel(Boolean(currentMask[index]), Boolean(priorMask[index]))] += 1;
  }
  const changed = counts.new + counts.removed;
  return {
    total: currentMask.length,
    ...counts,
    changed,
    changedPercent: Number(((changed / currentMask.length) * 100).toFixed(2)),
  };
}
