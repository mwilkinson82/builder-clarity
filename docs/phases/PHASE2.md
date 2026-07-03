# PHASE2.md — Scale Trust & Takeoff Guidance (Claude Code task spec)

Read `AGENTS.md` first and follow it. You are the **Estimating** agent. Branch:
`estimating/phase2-scale-trust`. Priorities in this phase come from live founder
QA on a real 24-sheet permit set (Crystal Carwash), not speculation. The
previously-planned tiled PDF viewer is **deferred** — real usage found zoom
clarity excellent; do not touch the renderer in this phase.

All work in `src/components/estimates/plan-room/` and
`src/lib/plan-room.functions.ts` unless stated. Migration files only for any
schema change; never connect to a database.

## Task 0 — HOTFIX: unit-mismatch guard on estimate sync

Found in production QA: a **4.83 LF** linear takeoff synced into a line item
priced per **SF** with no warning — the Estimate Sync panel displayed "4.83 SF".
Unit-blind sync mixes dimensions silently, which prices real bids wrong.

- In the sync path (`syncTakeoffQuantityToLine` and the link flow): compare the
  takeoff measurement `unit` to the estimate line `unit`, case-insensitively,
  with an alias table (LF/LNFT/LIN FT; SF/SQFT/SQ FT; EA/EACH/CT; SY, CY, etc.).
- On mismatch: do not sync. Return a `unit_conflict` payload (takeoff unit, line
  unit, quantity). The UI shows a clear in-app dialog: "This takeoff measures
  linear feet (LF), but the estimate row is priced per square foot (SF).
  Syncing would treat 4.83 LF as 4.83 SF." Allow an explicit override
  (`force_unit: true`) for intentional cases, recorded in the sync metadata.
- Same check at **link time** (linking a takeoff to a line), where it should be
  a warning badge on the link picker rather than a hard block.

## Task 1 — Replace browser confirm() with in-app dialogs

The quantity-conflict confirmation currently uses `window.confirm()` (the
"domain says" browser dialog). Replace with the app's dialog component showing:
old quantity + source ("typed by hand"), new quantity + source (sheet, takeoff
label, waste %), units, and Cancel / Replace actions. Reuse the same dialog
frame for Task 0's unit conflict. All copy in contractor language.

## Task 2 — Stated-scale presets (the big one)

Founder QA: drawings state "1/4\" = 1'-0\"" in the title block but have no
graphic scale bar, forcing an arbitrary two-point guess. For **vector PDFs the
guess is unnecessary**: the PDF page has known physical dimensions (72 pt =
1 paper inch). A stated scale converts directly:

```
feet_per_paper_inch = 12 / stated_inches   // 1/4" = 1'-0"  →  4 ft per paper inch
feet_per_pdf_point  = feet_per_paper_inch / 72
```

Map to the existing per-sheet scale storage via the sheet's known render
geometry (pdf points ↔ stored px). Add a conversion helper with unit tests
covering the full preset list.

**Preset lists** in the Set Scale flow:
- Architectural: 3/32, 1/8, 3/16, 1/4, 3/8, 1/2, 3/4, 1, 1-1/2, 3 (inches = 1'-0")
- Engineering: 1" = 10', 20', 30', 40', 50', 60', 100'
- Custom stated scale entry (X inches = Y feet)

**Apply to set:** after choosing a preset for one sheet, offer "Apply to all
unscaled sheets in this set" (founder had 23 identical-scale sheets to do one
by one). Per-sheet scale remains the storage model; this is a bulk write.

**Honesty guardrails:**
- Stated-scale presets are only offered for PDF-sourced sheets where page
  dimensions are available; image-sourced sheets get calibration only.
- Label preset-derived scale as "From stated scale — verify with a known
  dimension" until verified (see Task 3). Half-size prints are a known trap:
  a set plotted at 50% makes every stated scale wrong by 2x, which is exactly
  what verification catches.
- Note (do not build): per-detail viewport scales (e.g. a 3" = 1'-0" detail on
  a 1/4" sheet) are out of scope; measurements only trust the sheet scale.

## Task 3 — Calibration & verification improvements

- Two-point calibration quick distances: **1 ft, 5 ft, 10 ft** buttons plus
  free-entry field (feet + inches input, e.g. 12' 6"). Current minimum of 10 ft
  is too coarse for detail-scale calibration.
- **Verify scale** action: user measures a dimension they can read on the
  drawing and enters its labeled value; app compares against active scale and
  either marks the sheet "Scale verified" (badge, timestamp) or flags the
  discrepancy with the implied correction ("Measured 12.4' where you expected
  12' — off by 3%. Recalibrate?"). Verified state shows in the sheet list and
  readiness checklist.
- Readiness checklist: distinguish "no scale" from "scale set, unverified"
  from "verified".

## Task 4 — Linear tool angle guide ("the level")

Founder QA: getting a straight line freehand is hard; post-snap adjustment
works but guidance while drawing would be better. Implement:

- After the first point of a linear (and each subsequent vertex), render a live
  guide segment from the last point to the cursor.
- When the segment is within ~2° of 0°/90° (and 45°), snap it to exact and turn
  the guide **green** (level metaphor); otherwise neutral color. Small angle
  readout near the cursor.
- Holding Shift hard-constrains to the nearest 45° increment; Esc cancels the
  draft point as today.
- Keep it out of the way at high zoom; no changes to stored geometry format.

## Task 5 — Validate and ship

Full AGENTS.md gate + `npm run test:estimating` + new unit tests for the scale
conversion helper and unit-alias matcher. Browser QA on the dev server:
preset scale on a PDF sheet, apply-to-set, verify-scale pass and fail paths,
unit-mismatch dialog, angle guide. Rebase, push, PR titled
`Estimating Phase 2: scale trust, unit guard, takeoff guidance`. List any new
migration files in the PR description (none are expected; scale storage is
unchanged — flag loudly if you find you need one).
