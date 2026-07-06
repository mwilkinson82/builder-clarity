// Exemplar isolation (AITAKEOFF14).
// Root cause of the A-100 recall collapse: the exemplar footprint came from
// the connected ink component's bbox (measureInkFootprintPx, fused-linework
// cap deliberately lifted in AITAKEOFF7), so on densely-packed sheets the
// measurement — and the template crop built from it (footprint ×
// TEMPLATE_MARGIN_RATIO) — swallowed the NEIGHBORING symbol too. A two-symbol
// template matches single symbols weakly (top NCC ~0.6 vs ~0.96 for a clean
// single-symbol crop; the model echo literally read "two circular brush
// symbols, side by side" and the match mask was only ~51% symbol).
//
// Fix: measure the symbol's RADIAL extent instead of its component bbox.
// Per annulus around the (re-centered) hub we track two things: ink density,
// and the ANGULAR SPREAD of that ink. Ink that belongs to the picked symbol
// wraps around its own hub — an outer ring covers the whole circle, spokes
// are distributed — so its mean resultant direction is weak. A neighbor's
// ink sits in ONE concentrated arc, so its resultant is strong. The symbol
// extent is the outermost annulus that still looks like "mine" (dense enough
// AND angularly spread); everything concentrated beyond it is a neighbor and
// never grows the footprint. A straight conveyor/wall line through the hub
// crosses each annulus in two OPPOSITE arcs whose directions cancel — and is
// too thin to clear the density floor anyway — so fused linework cannot
// balloon the measurement the way it ballooned the component bbox.
//
// Pure functions only: no canvas, no fetch, no React. The exemplar render
// (aiDetectionRender) applies this at measurement time; every downstream
// consumer (template crop, dedupe radius, tile overlap, verify windows)
// already derives from the footprint, so isolation tightens them all.

import { inkMaskGet, type InkMask } from "./ai-takeoff-domain.ts";
import { TEMPLATE_MIN_SIDE_PX } from "./template-match/template-match-domain.ts";

/** Annulus width for the radial profile, in mask px. */
export const ISOLATION_BIN_PX = 3;
/** Ink below this absolute annulus density is background/linework noise. */
export const ISOLATION_DENSITY_FLOOR = 0.03;
/** ...or below this fraction of the hub peak, whichever is higher. */
export const ISOLATION_DENSITY_FLOOR_OF_PEAK = 0.02;
/**
 * Mean-resultant length above which an annulus's ink is a single
 * concentrated arc — a NEIGHBOR, not structure wrapped around this hub.
 */
export const ISOLATION_CONCENTRATION_LIMIT = 0.55;
/** Slack applied to the measured radial extent (hub-anchor asymmetry). */
export const ISOLATION_EXTENT_SLACK = 1.05;
/** Never clamp the footprint below the smallest usable template side. */
export const MIN_ISOLATED_FOOTPRINT_PX = TEMPLATE_MIN_SIDE_PX;
/** Window for re-centering the profile onto the symbol hub, in mask px. */
export const ISOLATION_RECENTER_WINDOW_PX = 24;

/**
 * Centroid of the ink inside a square window around `center` — the human (or
 * a prior accept) placed the marker NEAR the hub, not necessarily on it, and
 * an off-hub profile blurs every annulus. Local on purpose: the centroid of
 * the whole component on a fused pair sits BETWEEN the symbols, which is
 * exactly the wrong center.
 */
export function localInkCentroid(
  mask: InkMask,
  center: { x: number; y: number },
  windowPx: number = ISOLATION_RECENTER_WINDOW_PX,
): { x: number; y: number } {
  const half = Math.max(1, Math.round(windowPx / 2));
  const cx = Math.round(center.x);
  const cy = Math.round(center.y);
  const left = Math.max(0, cx - half);
  const right = Math.min(mask.width - 1, cx + half);
  const top = Math.max(0, cy - half);
  const bottom = Math.min(mask.height - 1, cy + half);
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (inkMaskGet(mask, x, y)) {
        sumX += x;
        sumY += y;
        count += 1;
      }
    }
  }
  if (count === 0) return { x: center.x, y: center.y };
  return { x: sumX / count, y: sumY / count };
}

export interface AnnulusInkStats {
  /** Ink px / annulus px, in-bounds pixels only. */
  density: number;
  /**
   * Mean resultant length of the ink pixels' angles around the center
   * (0 = spread all around the hub, 1 = one concentrated arc).
   */
  concentration: number;
  /** Ink pixels counted in this annulus. */
  inkCount: number;
}

/**
 * Per-annulus ink density + angular concentration around `center`. Only
 * in-bounds pixels count toward annulus area, so a center near the mask edge
 * reads correctly instead of diluting toward zero.
 */
export function annulusInkStats(
  mask: InkMask,
  center: { x: number; y: number },
  maxRadiusPx: number,
  binPx: number = ISOLATION_BIN_PX,
): AnnulusInkStats[] {
  const bins = Math.max(1, Math.ceil(Math.max(1, maxRadiusPx) / Math.max(1, binPx)));
  const ink = new Array<number>(bins).fill(0);
  const area = new Array<number>(bins).fill(0);
  const sumCos = new Array<number>(bins).fill(0);
  const sumSin = new Array<number>(bins).fill(0);
  const maxR = bins * binPx;
  const left = Math.max(0, Math.floor(center.x - maxR));
  const right = Math.min(mask.width - 1, Math.ceil(center.x + maxR));
  const top = Math.max(0, Math.floor(center.y - maxR));
  const bottom = Math.min(mask.height - 1, Math.ceil(center.y + maxR));
  for (let y = top; y <= bottom; y += 1) {
    const dy = y - center.y;
    for (let x = left; x <= right; x += 1) {
      const dx = x - center.x;
      const r = Math.sqrt(dx * dx + dy * dy);
      if (r >= maxR) continue;
      const bin = Math.min(bins - 1, Math.floor(r / binPx));
      area[bin] += 1;
      if (inkMaskGet(mask, x, y)) {
        ink[bin] += 1;
        if (r > 0) {
          sumCos[bin] += dx / r;
          sumSin[bin] += dy / r;
        }
      }
    }
  }
  return ink.map((count, i) => ({
    density: area[i] > 0 ? count / area[i] : 0,
    concentration: count > 0 ? Math.hypot(sumCos[i], sumSin[i]) / count : 0,
    inkCount: count,
  }));
}

/**
 * The symbol's radial extent: the outermost annulus whose ink is both dense
 * enough and angularly SPREAD around the hub. Concentrated-arc annuli beyond
 * it (a neighbor) never extend it; sub-floor annuli (background linework)
 * never extend it.
 */
export function symbolExtentPx(
  stats: AnnulusInkStats[],
  binPx: number = ISOLATION_BIN_PX,
  options: {
    densityFloor?: number;
    densityFloorOfPeak?: number;
    concentrationLimit?: number;
  } = {},
): number | null {
  if (stats.length === 0) return null;
  const peak = stats.reduce((best, s) => Math.max(best, s.density), 0);
  if (peak <= 0) return null;
  const floor = Math.max(
    options.densityFloor ?? ISOLATION_DENSITY_FLOOR,
    (options.densityFloorOfPeak ?? ISOLATION_DENSITY_FLOOR_OF_PEAK) * peak,
  );
  const concentrationLimit = options.concentrationLimit ?? ISOLATION_CONCENTRATION_LIMIT;
  let extentBin = -1;
  for (let i = 0; i < stats.length; i += 1) {
    const s = stats[i];
    if (s.density >= floor && s.concentration < concentrationLimit) extentBin = i;
  }
  if (extentBin < 0) return null;
  return (extentBin + 1) * binPx;
}

export interface ExemplarFootprintIsolation {
  /** The footprint to use downstream (never larger than the measurement). */
  footprintPx: number;
  /** The raw connected-component measurement (diagnostics/comparison). */
  measuredPx: number;
  /** The symbol's own radial extent, px (null = no readable structure). */
  extentPx: number | null;
  /** True when the extent tightened the component measurement. */
  clamped: boolean;
  /** The hub-recentered profile center. */
  center: { x: number; y: number };
}

/**
 * Replace the component-bbox footprint with the symbol's own radial extent
 * whenever the extent is smaller — one symbol per template, never the pair,
 * never the fused conveyor line. An isolated symbol measures the same both
 * ways, so nothing changes for the cases that already worked.
 */
export function isolateExemplarFootprintPx(
  mask: InkMask,
  markerCenter: { x: number; y: number },
  measuredPx: number,
): ExemplarFootprintIsolation {
  // Two recenter passes: an off-hub marker sees an asymmetric window slice,
  // so one pass only pulls partway; the second, seeded from the first,
  // converges onto the hub.
  const center = localInkCentroid(mask, localInkCentroid(mask, markerCenter));
  const measured = Math.max(1, Math.round(measuredPx));
  // Profile out past the measured extent: the measurement may already span
  // the pair, and the boundary we want sits inside it.
  const maxRadius = Math.max(MIN_ISOLATED_FOOTPRINT_PX, measured);
  const stats = annulusInkStats(mask, center, maxRadius);
  const extent = symbolExtentPx(stats);
  if (extent === null) {
    return { footprintPx: measured, measuredPx: measured, extentPx: null, clamped: false, center };
  }
  const fromExtent = Math.round(2 * extent * ISOLATION_EXTENT_SLACK);
  const footprintPx = Math.max(MIN_ISOLATED_FOOTPRINT_PX, Math.min(measured, fromExtent));
  return {
    footprintPx,
    measuredPx: measured,
    extentPx: extent,
    clamped: footprintPx < measured,
    center,
  };
}
