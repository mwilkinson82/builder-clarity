# PHASE25.md — Sheet Identity & Takeoff Ergonomics (Claude Code task spec)

Read `AGENTS.md` first and follow it. You are the **Estimating** agent. Branch:
`estimating/phase25-sheet-identity`. Every item below comes from founder QA on
the live Crystal Carwash 24-sheet permit set. All work in
`src/components/estimates/plan-room/` and `src/lib/plan-room.functions.ts`
unless stated. **One migration file is expected (Task 1); anything beyond that,
flag loudly in the PR.** Never connect to a database.

## Task 0 — Hotfix: stop generating plumbing-flavored page names

Auto-generated sheet numbers currently use a "P-" prefix ("P-001"..."P-024").
In construction numbering P means plumbing, so the app is mislabeling
architectural sheets in the language every contractor reads. Change the
auto-generated prefix to "PG-" (page) at upload time. Do not rename existing
sheets in data — Task 3's extraction and Task 4's rename handle those.

## Task 1 — Sheet thumbnails

Contractors currently page blindly through sets to find a drawing.

- **At upload:** while pages are being processed, render each page to a small
  raster (~240px long edge, JPEG or WebP, quality tuned for < ~40KB each) using
  the already-loaded pdfjs machinery, and upload to the existing `plan-room`
  storage bucket under the plan set's folder (e.g.
  `{estimateId}/{planSetId}/thumbs/{sheetId}.webp`).
- **Migration (the one expected):** `ALTER TABLE public.estimate_plan_sheets
  ADD COLUMN IF NOT EXISTS thumbnail_path text NOT NULL DEFAULT '';` — file
  only, do not apply.
- **Lazy backfill for existing sets:** when a plan set opens and any sheet has
  an empty `thumbnail_path`, generate missing thumbnails in the background from
  the already-fetched PDF (throttled, current sheet first), upload, and save
  paths. The founder's existing 27 sheets must gain thumbnails without
  re-uploading anything.
- **Display:** thumbnail in each sidebar sheet row (left of the number, ~64px),
  larger hover/preview optional but not required. Sheet map/minimap unchanged.
- RLS note: the plan-room bucket policies scope by the estimate-id path prefix
  (see `storage_estimate_id`); keep thumb paths under the same prefix so no
  policy changes are needed.

## Task 2 — Title-block sheet number & name extraction (vector PDFs)

The real identity ("A-700 — Door, Window Types & Schedules") lives in the
title block, almost always the bottom-right region of the page.

- Using pdfjs `getTextContent`, collect text items whose coordinates fall in
  roughly the right 25% x bottom 30% of the page (tune against the Crystal
  Carwash set).
- **Sheet number:** match tokens against construction sheet-number patterns:
  letters (1-3) + optional separator + digits with optional dot suffix —
  `A-101`, `A1.1`, `E-201`, `M-1.1`, `FP-102`, `A-700`. Prefer the largest/
  bottom-most match in the region (title blocks put the sheet number big, in
  the corner).
- **Sheet name:** the nearest multi-word text line(s) above/beside the number
  in the same region; join wrapped lines; sentence-case is not required — keep
  the drawing's own casing.
- **At upload:** apply automatically (these sheets have placeholder names, so
  overwriting is safe), falling back to `PG-{n}` / `Page {n}` when nothing
  matches.
- **Existing sets:** add a "Detect sheet names" action on the plan set (sits in
  the Drawings panel header). It runs extraction across all sheets, then shows
  a compact confirm list — current name → detected name per sheet, each row
  individually uncheckable — and applies on confirm. Never silently rename
  sheets the user may already reference; suggest, don't force.
- Scanned/raster PDFs: extraction simply finds nothing; rows keep their names
  and the rename affordance (Task 3) is the path. No OCR in this phase.

## Task 3 — Inline rename

Pencil affordance on the sheet row (hover) and in the sheet header: edit
`sheet_number` and `sheet_name` in place. Plain server update, optimistic UI.

## Task 4 — Discipline grouping in the sidebar

- Derive `discipline` from the sheet-number prefix with a standard map:
  A/AD architectural, S structural, M mechanical, E electrical, P plumbing,
  C civil, L landscape, FP fire protection, T/LV low voltage, G general.
  Write it to the existing `discipline` column whenever sheet_number is set or
  changed (upload extraction, detect action, manual rename).
- Sidebar: when a set has 2+ disciplines, group sheets under collapsible
  discipline headers (count badges), defaulting open. Sets with placeholder
  names or one discipline render exactly as today. Search and the
  needs-scale/marked filters operate across groups.

## Task 5 — Linear tool closeout (founder-QA finding)

Today the only way to end a linear run is the toolbar "Finish Linear" button;
every canvas click adds another vertex, forcing undo of stray points. Match
the conventions of every drawing tool contractors know:

- **Double-click** plants the final point and finishes the run (guard: the
  double-click must not add two vertices — the second click of the pair
  finishes instead of planting).
- **Enter** finishes the run with the vertices placed so far.
- **Right-click** finishes (suppress the context menu inside the canvas while
  a run is active).
- **Esc** abandons the in-progress run entirely (current draft-point undo
  behavior stays for single-point removal).
- Same treatment for the area tool's closeout if it shares the code path;
  count tool unaffected.
- Update the in-canvas hint text to say so ("double-click or press Enter to
  finish").

## Task 6 — Kill the decimal-feet trap (founder-QA finding)

The founder verified a 12'-8" dimension by typing "12.8" — a silent ~1% error
the tool happily accepted. Anywhere a real-world distance is entered
(calibration distance, verify-scale expected value):

- Feet-and-inches entry is the prominent, first-class path (the existing
  parser accepts `12' 8"` — surface it in the placeholder and label).
- When the user types a bare decimal, show a live conversion line under the
  field: `12.8 ft = 12'-9 5/8"` with a one-tap suggestion when the decimal
  looks like a feet-inches typo (fractional part ≤ 0.11 x an inch value, i.e.
  `.8` → "did you mean 12'-8\"?"). Accepting the suggestion rewrites the value;
  ignoring it keeps the decimal. Never block entry — inform and offer.
- Unit-test the parser and the suggestion heuristic (12.8 → 12'-8" suggested;
  12.5 → shows 12'-6" conversion, no typo suggestion needed; 12' 8" parses to
  12.6667).

## Task 7 — Validate and ship

Full AGENTS.md gate + `npm run test:estimating` + new unit tests (sheet-number
pattern matcher, discipline map, feet-inches suggestion heuristic). Browser QA
on the dev server: upload a small vector PDF (thumbnails + extracted names +
grouping), the detect-names confirm flow, inline rename, double-click/Enter/
right-click/Esc closeout, decimal conversion hints. Expect one final rebase to
absorb Lovable's types-regen commit after the migration is applied to
production (per release checklist). Rebase, push, PR titled `Estimating Phase
2.5: sheet identity, thumbnails, takeoff ergonomics`, listing the single
migration file in the description.
