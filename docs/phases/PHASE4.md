# PHASE4.md — Beta Hardening (Claude Code task spec)

Read AGENTS.md (repo root) and follow it. You are the **Estimating** agent.
Branch: `estimating/phase4-beta-hardening`. **Context: real contractors are
using production RIGHT NOW.** This phase removes the failures they will hit
first. Speed matters; scope discipline matters more — ship these tasks, nothing

else. One small migration is expected (Task 4); flag anything beyond it loudly.

## Task 0 — Undo / redo for takeoff operations (the guaranteed collision)

There is no undo stack. The first mis-drawn takeoff by a beta user ends in a
delete-and-redraw or a support message. Implement a per-sheet command stack:

- Undoable: add measurement, delete measurement, vertex add/move/remove,
  label/waste/color edits, link/unlink. Scale changes and estimate-row
  creation are NOT undoable through this stack (server-side, multi-user
  consequences) — exclude them cleanly.
- Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z redo, toolbar buttons with disabled
  states. Stack survives sheet switches within the session (per-sheet stacks),
  resets on reload. Depth 50 is plenty.
- Server sync: undo of a persisted op issues the inverse mutation; if it
  fails, drop the stack entry and toast plainly ("Couldn't undo — the change
  already synced"). Never leave UI and server disagreeing.

## Task 1 — Extraction v3: the two known misses

Live results on the founder's set: architectural sheets 12/12 after v2,
consultant sheets (structural/MEP/plumbing, pages 13-24) 0/12, and titles
contaminated by project-block fields ("NBS 365M LLC", "MIAMI GARDENS, FL").

- **Cross-sheet frequency filter:** any candidate title line whose normalized
  text appears in the same region on 3+ sheets of the set is a project field
  (owner, address, project name), not a sheet title. Drop it. This kills the
  LLC/city contamination with one rule.
- **Consultant layouts:** consultant title blocks commonly run the full right
  edge as a vertical strip or use a bottom-band layout with the number in a
  boxed cell. Add those candidate regions; score as in v2 (size x corner
  proximity). Test fixtures modeled on both layouts.
- Known truths remain: A-000..A-700 must all still hit with clean titles
  post-filter. Target: meaningful hits on pages 13-24 of the founder's set.

## Task 2 — Default current set papercut

On Plan Room load, the current sheet can resolve to the sample set (mime
`sample/overwatch`), which hides PDF-only actions (Detect) and confuses.
Default the current sheet to: last-viewed sheet for this user+estimate if
known, else the first sheet of the first real PDF set, else whatever exists.

## Task 3 — Worksheet classify parity

Remote QA found takeoff cards in the worksheet whose action buttons rendered
empty, and the unified link-or-create picker was unreachable from the
worksheet panel. Verify and fix: every unlinked takeoff card in the worksheet
exposes the same link-or-create picker as the popover/inspector, with visible
labeled actions. A beta user who dismissed the popover must have an obvious
second chance to classify from the worksheet.

## Task 4 — "Flag an issue" (beta feedback with context)

Founders can't watch every session. Lightweight in-app capture:

- Small "Flag an issue" affordance in the Plan Room command bar and the
  estimate workspace header. Opens a dialog: one text field, a screenshot-free
  context blob captured automatically (route, estimate id, sheet id + number,
  active tool, app commit sha), submit.
- **Migration (the one expected), file only:** `beta_feedback` table —
  id, organization_id, created_by, created_at, route text, context jsonb,
  message text. RLS: insert for authenticated members of the org; select for
  org admins and super admin. Follow existing table conventions.
- No email/notification wiring in this phase — rows in the table are enough;
  they get read directly from the database.

## Task 5 — Validate and ship

Full gate + `test:estimating` + new unit tests (undo stack inverse ops,
frequency filter, consultant-layout fixtures). Dev-server QA: undo/redo across
all three tools, worksheet classification, feedback submit. PR titled
`Estimating Phase 4: beta hardening`, migration listed for pre-merge
application per protocol.
