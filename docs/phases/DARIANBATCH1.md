# DARIANBATCH1.md — Drawing-Hand Ergonomics (Claude Code task spec)

Read AGENTS.md (repo root). You are the **Estimating** agent. Branch:
`estimating/darian-batch-1`. A CPM/Schedule agent is active in parallel — stay
strictly inside the estimating territory (plan-room module and its libs).

Context: first external beta tester (a contractor, tonight, live) reported
four friction points that are one family — the takeoff drawing hand doesn't
behave like the CAD/Bluebeam hand he owns. His words are quoted. His accuracy
report ("dimensions almost exact... difference is definitely due to margins of
clicking different lines") means click precision is now the dominant
measurement error — Task 1 attacks it directly. No migrations.

## Task 0 — Rubber-band preview ("see the line moving while dragging")

During an active linear/area run, render a live preview segment from the last
placed vertex to the current cursor position, updating on pointer move — the
measurement readout and the angle guide ride the preview segment live, not
only after the click. On click the preview becomes the committed segment.
Same for the first vertex→cursor before any second point exists. Counts
unaffected.

## Task 1 — Real snapping ("a snap to line... a snap when line is straight")

The angle guide currently indicates square; make it assist:

- **Ortho snap:** while drawing, when the cursor is within ~3° of 0/45/90°
  from the last vertex, magnetically snap the preview (and the committed
  click) to the exact angle. Visual state already exists (guide turns green) —
  now the geometry obeys it. Holding Alt/Option temporarily disables snapping
  for intentional off-angle runs; Shift keeps its existing hard-constrain
  behavior.
- **Geometry snap:** snap the cursor to existing takeoff vertices and segment
  endpoints on the current sheet within a small pixel tolerance (~8px screen
  space), with a subtle snap indicator dot, so runs can start/finish exactly
  where a prior run ended. Snapping to the PDF's own vector linework is
  explicitly OUT of scope for this batch (that is a later, larger feature) —
  do not attempt it.

## Task 2 — Undo mid-run ("Can't CTRL Z just a point while still laying out")

While a run is active, Cmd/Ctrl+Z removes the last placed vertex (repeatable
down to zero, at which point the run is abandoned like Esc). Only when no run
is active does Cmd/Ctrl+Z fall through to the Phase 4 committed-takeoff undo
stack. Redo mid-run is not required.

## Task 3 — Pan while plotting ("right click to move the drawings")

Right-button DRAG (pointer travel beyond ~4px) pans the sheet mid-run without
disturbing placed vertices; right-button CLICK without drag keeps its shipped
finish-run behavior. Context menu stays suppressed during a run either way.
Also verify space-bar-hold + drag pans mid-run if that affordance exists for
the select tool; add it for draw tools if trivial, skip if not.

## Task 4 — Mouse-wheel zoom, run-safe ("mouse wheel should zoom in and out... you shouldn't have to click away and come back")

The viewer currently wants +/- keys or the zoom-area tool. Make the mouse
wheel (and trackpad pinch) zoom the sheet, centered on the cursor position —
and critically, make it work DURING an active run without canceling it or
disturbing placed vertices, exactly like the pan in Task 3. The rubber-band
preview (Task 0) re-anchors correctly after zoom. Plain wheel = zoom (no
modifier required); if the worksheet panel is under the cursor it scrolls as
normal — zoom applies only over the canvas.

## Task 5 — Validate and ship

Gate + `test:estimating` + unit tests for the snap math (ortho angle windows,
Alt bypass, vertex-proximity resolution order: geometry snap beats ortho when
both apply). Dev-server QA: draw with preview, snap on/off feel, mid-run
Cmd+Z, right-drag pan vs right-click finish on all three tools, wheel-zoom mid-run on the canvas vs normal scroll over panels. PR titled
`Estimating: drawing-hand ergonomics (beta batch 1)`. No migrations expected;
flag loudly otherwise. Also commit this file to docs/phases/DARIANBATCH1.md.
