// Incremental placement (AITAKEOFF13 — fast first paint).
// The pixel/template engine finds symbols in ~12s, but the old flow rendered
// nothing until ~20 sequential model tile-calls (2-3 min) ALSO finished, and a
// single vendor hang in that stretch froze the whole scan. These pure helpers
// split placement into two ordered stages so template hits become review ghosts
// IMMEDIATELY — before any model call — and the model then enriches AROUND what
// is already on the canvas. The old code unioned both engines and split by
// source AFTER the model loop (template-match-domain.unionProposalCandidates);
// this keeps the exact same dedupe/suppression math, only the ORDER changes.
//
// Pure: no React, no fetch, no rendering. The client hook wires these to the
// canvas; the ai smoke harness pins the dedupe/budget invariants.

import {
  capProposalsPerSheet,
  excludeNearExistingPoints,
  type SheetPoint,
  type SheetRadius,
} from "./ai-takeoff-domain.ts";
import {
  unionProposalCandidates,
  type TemplateMatchCandidate,
} from "./template-match/template-match-domain.ts";

/** A placed-or-pending candidate carrying its engine origin (union output). */
export type PlacementCandidate = ReturnType<typeof unionProposalCandidates>[number];

/**
 * Stage 1 — the ghosts to paint NOW. Template hits are deterministic
 * same-shape matches with hub-anchored centers (AITAKEOFF9); they become review
 * ghosts directly (AITAKEOFF11), so they need no model call and can render the
 * instant the matcher returns. Deduped against already-counted markers, then
 * capped to the per-sheet ceiling.
 */
export function planTemplateGhosts(input: {
  templateHits: TemplateMatchCandidate[];
  existingPoints: SheetPoint[];
  radius: SheetRadius;
  maxPerSheet: number;
}): PlacementCandidate[] {
  const union = unionProposalCandidates(input.templateHits, [], input.radius);
  const fresh = excludeNearExistingPoints(
    union,
    input.existingPoints,
    input.radius,
  ) as PlacementCandidate[];
  return capProposalsPerSheet(fresh, input.maxPerSheet);
}

/**
 * Stage 2 — the model candidates that still deserve a stage-B verify AFTER the
 * template ghosts have claimed their spots. A symbol both engines found is
 * already on the canvas as a template ghost, so it is excluded here (same
 * radius, so verification is still bought at most once — the old union
 * guaranteed this too). Capped to whatever per-sheet budget the template ghosts
 * left, so a sheet never renders more than the ceiling regardless of order.
 */
export function planModelToVerify(input: {
  modelCandidates: Array<{ x: number; y: number; confidence: number }>;
  placedGhostPoints: SheetPoint[];
  existingPoints: SheetPoint[];
  radius: SheetRadius;
  maxPerSheet: number;
  templateGhostCount: number;
}): PlacementCandidate[] {
  const remaining = Math.max(
    0,
    Math.trunc(input.maxPerSheet) - Math.max(0, input.templateGhostCount),
  );
  // capProposalsPerSheet floors its limit at 1, so guard the zero-budget case
  // ourselves — a full sheet of template ghosts must leave the model none.
  if (remaining <= 0) return [];
  const union = unionProposalCandidates([], input.modelCandidates, input.radius);
  const blocked = [...input.existingPoints, ...input.placedGhostPoints];
  const fresh = excludeNearExistingPoints(union, blocked, input.radius) as PlacementCandidate[];
  return capProposalsPerSheet(fresh, remaining);
}
