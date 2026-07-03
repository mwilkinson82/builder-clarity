# PHASE3.md — Takeoff-First Estimating (Claude Code task spec)

Read `AGENTS.md` first and follow it. You are the **Estimating** agent. Branch:
`estimating/phase3-takeoff-first`. This phase removes the Plan Room's founding
assumption that estimate rows exist before takeoffs do. Every requirement below
was hit live by the founder doing real takeoff on the Crystal Carwash set.

Design principle for everything here: **never force, always invite.** Measuring
must never stall on classification; classification must always be one gesture
away.

All work in `src/components/estimates/plan-room/`,
`src/components/estimates/EstimateWorkspace.tsx`, and
`src/lib/plan-room.functions.ts` / `estimates.functions.ts`. **No migration is
expected** — `estimate_takeoff_measurements.library_item_id` already exists and
is unused; it is this phase's foundation. If you find you need one, flag loudly
in the PR.

## Task 0 — The takeoff comes to you (post-finish popover)

Today, finishing a takeoff leaves the user hunting: scroll the worksheet panel,
find the row, link it. Founder quote: "a box doesn't pop up... it's not
intuitive."

- On finishing ANY takeoff (linear double-click/Enter, area close, count
  finish): auto-select the new measurement and show a compact popover anchored
  near the final markup point (fallback: auto-scroll + focus the inspector if
  the popover would leave the viewport).
- Popover contents: label field (pre-focused, prefilled with the tool default
  e.g. "Linear 3"), the link-or-create picker (Task 1), waste %, and Done.
- Enter in the label commits and moves to the picker; Esc dismisses the popover
  without discarding the takeoff (classification stays available in the
  worksheet). Measuring flow never blocks: the user can immediately start the
  next takeoff and the popover yields.

## Task 1 — Link-or-create: one picker, three answers

Replace the link dropdown (in the popover, the inspector, and the worksheet)
with a single searchable picker that answers "what is this measurement?" three
ways, in one list:

1. **Existing estimate rows** — current behavior, with the unit tags shipped in
   Phase 2 ("per SF"); the Phase 2 unit guard applies on link and sync.
2. **Cost library items** (searched across Overwatch + My Cost Library) —
   selecting one creates a new estimate row from the item (description, unit,
   material/labor unit costs per its labor_basis), links the takeoff, records
   `library_item_id` on the measurement, and syncs quantity (waste applied).
3. **"Create '<typed text>' as a new row"** — always the last option once the
   user has typed. Creates a row in the open estimate with the takeoff's label
   as description, the takeoff's unit, quantity synced, and **$0 pricing with a
   visible "Needs pricing" badge** on the row in the estimate grid. The
   contractor labels now, prices later.

Empty estimate = the same picker, minus section 1. A blank estimate is a
starting point, not a dead end. Empty-state copy at the top of a rowless
estimate (grid side): "Measure it in the Plan Room, price it from your Cost
Library, or import your master sheet — start wherever you like."

## Task 2 — "Build estimate from takeoffs" (worksheet action)

For the batch-minded: measure everything first, classify after.

- Worksheet header action, enabled when unlinked takeoffs exist: groups
  unlinked takeoffs by (library_item_id, else normalized label + unit), shows a
  confirm list (group → row to be created, quantity rollup with waste, priced /
  needs-pricing), creates rows and links on confirm. Same suggest-don't-force
  pattern as Detect sheet names.
- Rollups respect the Phase 2 unit guard: mixed-unit groups split rather than
  merge.

## Task 3 — Suggest takeoff↔row matches after master sheet import

When a master sheet is imported (or rows otherwise appear) while unlinked
takeoffs exist, offer — never auto-apply — a match list: takeoff → candidate
row, matched on cost code and/or normalized description + compatible unit.
Confirm list, per-row uncheckable, exactly the Detect pattern.

## Task 4 — Count tool ergonomics

- Counts get the Task 0 popover too — founder counted 4 wash brushes with no
  way to say "these are brushes" at creation.
- **Enter and Esc finish/abandon a count run** like the linear closeout;
  toolbar Finish stays. Right-click finishes and suppresses the context menu
  mid-run.

## Task 5 — Panel collision fix

The floating takeoff tool deck and the right worksheet panel can overlap the
top command bar and each other, forcing manual dragging for "clarity of
vision." Constrain floating panels to a layout region that excludes the top
deck's bounds; on viewport changes re-clamp; persist the user's dragged
position per device (localStorage is unavailable in some embeds — use the
existing user-preference persistence if present, else in-memory per session).

## Task 6 — Title-block extraction tuning (Phase 2.5 known gap)

Live result on the real 24-sheet set: 3/24 sheet numbers found (all correct),
titles contaminated by adjacent caption text ("DOOR JAMB AT GWB PARTITION"
bled into A-700's name).

- Try multiple candidate regions per page (bottom-right band, right-edge
  vertical strip, bottom strip), scoring matches by text size and proximity to
  the page corner; take the best-scoring sheet-number candidate.
- Title assembly: prefer the largest-font multi-word line(s) adjacent to the
  number; exclude lines that also appear elsewhere on the page body (caption
  dedupe) and known field labels (SCALE/DATE/DRAWN/PROJECT NO).
- Keep unit tests synthetic but add fixture text layouts modeled on the Crystal
  Carwash geometry (number bottom-right corner, rotated title strip). Known
  truths for manual QA: A-300, A-401, A-700 must still hit; target is a
  visibly higher hit rate on the founder's set, not perfection.

## Task 7 — Validate and ship

Full gate + `test:estimating` + new unit tests (group-rollup with mixed units,
label normalization, match suggester, extraction scoring). Browser QA on dev:
finish-takeoff popover for all three tools, create-row path on an EMPTY
estimate (create a throwaway estimate locally, not in production), needs-pricing
badge, build-from-takeoffs confirm, Enter/Esc on counts, panel clamping.
Expect the Lovable types-regen rebase only if a migration sneaks in (none
should). PR titled `Estimating Phase 3: takeoff-first estimating`, flag any
migration loudly.
