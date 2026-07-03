# CPMPHASE2.md — Presentable Schedule (Claude Code task spec)

Read AGENTS.md. You are the **CPM/Schedule** agent; schedule territory only.
Branch: `schedule/cpm-phase2-surface`. Other agents may run in parallel
overnight — never touch estimating, CRM, billing, or auth files. No
migrations expected; flag loudly otherwise.

Evidence: the founder's CPM buildout inventory (docs/constructline-cpm docs)
items 3–5, plus two live founder-QA papercuts from tonight's Phase 1 session.

## Task 0 — Two papercuts from live QA
- The top nav stat card labeled "DATA DATE" shows the last SAVED update's
  date and confused the founder within a minute. Relabel it "LAST UPDATE"
  (value unchanged). The workbench's staged data date keeps its own label.
- The snapshot save button relabels itself "Review gaps" when status gaps
  exist — the founder could not find save. Keep the label "Save snapshot" at
  all times; move the gap warning to the helper text and amber-tint the
  button while unacknowledged. First click still routes to the queue and
  arms; second click saves. Same flow, honest label.

## Task 1 — Activity detail modal polish (inventory item 3)
All fields fit without horizontal scroll at common widths; group and title
the sections plainly ("Baseline plan" vs "Current update"); relationship rows
scannable (type, target, lag on one line each); Save / Save & next update row
/ Send to Risk Tally keep fixed positions and predictable behavior.

## Task 2 — Table/Gantt contracts (inventory item 4)
Headers and data columns aligned; layout (column sizing, split position,
timeline scale) survives refresh via the existing persistence approach;
technical columns centered, Activity Description left-aligned; rows wrap
description/tags instead of clipping; split-resize and scale controls behave.
Update the layout smoke to pin these contracts.

## Task 3 — Print 11x17 (inventory item 5)
Print shell contains ONLY title/status strip, activity table, Gantt with
logic lines, legend, footer. Verify at 11x17 landscape: logic lines render,
delay hatching and baseline bars legible, rows wrap, no clipped columns, page
count sane for 22 activities. Fix what fails. Founder does the physical
print check post-deploy.

## Task 4 — Validate and ship
Gate + both CPM smokes + updated layout pins. PR titled `CPM Phase 2:
presentable schedule`. Post-deploy browser QA is the founder's per protocol.
Commit this file to docs/phases/.
