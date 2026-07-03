# DARIANBATCH2.md — Takeoff Groups (Claude Code task spec)

Read AGENTS.md (repo root). You are the **Estimating** agent. Branch:
`estimating/darian-batch-2-groups`. Run AFTER darian-batch-1 merges; a
CPM/Schedule agent may be active in parallel — stay in estimating territory.

Context: live beta finding. The tester measured "Demo Ramps and Landings" as
two area takeoffs (279 SF + 25.54 SF, same sheet) and got two separate
worksheet cards, each separately unlinked, each demanding its own
classification. His words: "it should recognize either by color or name, this
should be the same group." Contractors measure one quantity in pieces; the
system treats every markup as an island. Fix the model: same label + same
unit = same group. No migrations expected — grouping is derived from the
existing label/unit/link columns; flag loudly if that changes.

## Task 0 — Label-match inheritance at the popover (the magic moment)

When a takeoff is finished and its label (normalized: trim, case-insensitive,
collapse whitespace) matches an existing takeoff group on the estimate with a
compatible unit:

- The post-finish popover recognizes it: "Added to **Demo Ramps and
  Landings** — 3 takeoffs · 304.5 SF total" and **inherits the group's
  estimate-row link automatically** (including library_item_id). Linked
  quantity syncs the group rollup, waste per existing rules.
- Label autocomplete in the popover suggests existing group labels as the
  user types, so joining a group is the default gesture and typos don't fork
  groups.
- A visible "detach from group" affordance covers the rare intentional
  same-name-different-thing case; detaching clears the inherited link on that
  measurement only.
- Unit mismatch (same label, LF vs SF) does NOT auto-join — the popover warns
  per the Phase 2 guard and treats it as a new group candidate.

## Task 1 — Grouped worksheet

Worksheet cards group by (normalized label, unit): one card per group with
rollup quantity, member count, source sheets, ONE link-or-create control that
links every member, and an expander revealing individual measurements
(open/delete/detach per member). Ungrouped singletons render exactly as
today. Selecting a member on canvas highlights its group card. "Build
Estimate from Takeoffs" already groups this way — align its normalization
with this module so the two never disagree.

## Task 2 — Color as the secondary signal ("more color options... and a toggle on/off for them to be in the view or not")

Do NOT make color a grouping key (colors collide across trades). Instead:
- **Expanded palette:** grow the markup color picker to ~16 distinct,
  drawing-legible colors (avoid pale tones that vanish on white sheets; keep
  contrast against both white paper and dense linework). Persist per takeoff
  as today.
- New takeoffs default their markup color to the group's color when joining a
  group, so same-item-same-color happens by itself.
- **Per-color visibility toggles:** a color chip row (in the Takeoff Tools
  deck or worksheet header) where each chip toggles CANVAS visibility of all
  markups of that color on the current sheet — the layers-style workflow
  contractors know: hide the demo reds while measuring the new-work greens.
  Chips show only colors in use; state is per-session; the existing per-item
  and Show/Hide All controls still win when hidden individually.
- The worksheet group header shows the group's color swatch; the same chip
  row filters worksheet cards by color for the all-my-red-is-demo scan.

## Task 3 — Ruler ("is there a ruler feature for getting dimensions?")

A quick-measure tool for checking dimensions the drawings omit ("engineers
miss dimensions all the time... it helps fill in gaps") — a QUESTION, not a
takeoff:

- New "Ruler" tool in the takeoff toolbar. Click two points → the distance
  renders on the segment using the sheet's active scale (feet-inches format),
  with the live rubber-band preview and snapping from batch 1 applying.
  Additional clicks chain segments with a running total, like the linear tool.
- Ephemeral by design: ruler measurements are never persisted, never appear
  in the worksheet, never open the classification popover. Esc or switching
  tools clears them; they do not survive sheet changes or reload.
- Requires a scale like the other measure tools (same "set scale first"
  guard). Show the same unverified-scale caveat badge if applicable.
- NOTE: a partial ruler implementation may exist in the codebase from before
  the stated-scale work — reuse or replace it, whichever is less code. If
  remnants exist and are dead, delete them.

## Task 4 — Validate and ship

Gate + `test:estimating` + unit tests (label normalization/fork-prevention,
inheritance link propagation, unit-mismatch refusal, group rollup math,
detach semantics). Dev QA: measure three same-label areas across two sheets →
one card, one link, correct rollup; detach one; color inheritance; toggle a color off and confirm its markups hide on canvas while others stay; ruler two-point and chained measure, Esc clears, nothing lands in the worksheet. PR titled
`Estimating: takeoff groups (beta batch 2)`. Commit this file to
docs/phases/DARIANBATCH2.md.
