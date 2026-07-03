# CPMPHASE1.md — One Schedule Spine (Claude Code task spec)

Read AGENTS.md (repo root) and follow it. You are the **CPM/Schedule** agent —
your territory is the schedule module ONLY (`src/lib/constructline-cpm.ts`,
`src/lib/schedule.functions.ts`, `src/lib/schedule-status.ts`,
`src/components/outcome/ScheduleRisk.tsx`, the project schedule route, and the
CPM smoke scripts). Do not touch estimating, CRM, billing, or auth. An
estimating agent may be active in parallel — never rebase onto or merge
anyone's branch but your own from main.

Branch: `schedule/cpm-phase1-update-spine`.

**Context from live founder review (screenshots on the real Harbor Residence
project):** the CPM engine and the delay→risk→IOR money flow work and are the
product's differentiator. What is broken is the *spine*: the schedule has two
competing update surfaces, saved updates never capture activity snapshots, and
the same page shows three different logic-tie counts. This phase makes the
schedule a single trustworthy record. **No migrations are expected** — the full
schema (schedule_activities, schedule_activity_updates [35 cols],
schedule_updates, schedule_milestones, schedule_milestone_updates,
schedule_wbs_sections, schedule_cpm_templates, schedule_delay_fragments,
schedule_risks) is verified live in production as of tonight. If you need one,
flag loudly in the PR.

## Task 0 — Split the monolith (mechanical, zero behavior change)

`src/components/outcome/ScheduleRisk.tsx` is 10,686 lines. Split it into a
`src/components/schedule/` module along its natural seams (IOR schedule tab,
update assistant, update history, milestones, CPM workbench shell, grid/Gantt
pieces, shared hooks/types) — same approach as the estimating plan-room split:
verbatim moves, no refactors, no renames beyond imports. Run the full gate
before and after; behavior must be pixel-identical. Commit the split alone
before starting Task 1 so review diffs stay readable.

## Task 1 — One update spine (the core of this phase)

Today two surfaces author schedule updates and they disagree: the CPM
workbench (set data date → needs-update queue → save snapshot) and the IOR
Schedule tab's update assistant (its own data date field, its own forecast,
its own save). Live evidence: workbench data date 06/30 vs tab 07/03; saved
update +14 wk vs assistant +16 wk; forecast 08/21 vs 09/04. Fix by making one
place author and one place consume:

- **The workbench authors.** The canonical flow is: set data date → work the
  needs-update queue → save CPM update snapshot. Saving the snapshot CREATES
  the schedule update record — data date, completion forecast, variance,
  movement vs prior, CPM signal text, activity snapshots (Task 2), milestone
  snapshots — one object, one moment in time.
- **The IOR Schedule tab consumes.** The update assistant becomes "review and
  annotate the latest CPM update": it displays the newest snapshot's numbers
  read-only and lets the PM add the schedule narrative and money fields
  (money exposure, recovered/offset, money note) onto the SAME record. Remove
  the tab's independent data-date entry and its ability to create a separate
  update. "Use CPM forecast" disappears as a concept — the update IS the CPM
  forecast; there is nothing to adopt.
- Manual-only projects (no CPM activities yet): the tab keeps a simple
  create-update path, clearly labeled as manual, which the workbench flow
  supersedes the moment activities exist.
- **One update per data date:** saving again on the same data date amends the
  existing update after a confirm ("Update #4 already covers 06/30 — replace
  its snapshot?"), never silently duplicates. Live data shows #1/#2 and #3/#4
  are duplicate pairs; migrate nothing, but the duplicate path must close.

## Task 2 — Activity snapshots must actually snapshot

Every saved update on the live project shows "0 activity snapshots" and
`schedule_activity_updates` is empty — the promise "activity snapshots will
appear on the next saved CPM update" has never been kept. On snapshot save,
persist a per-activity row (status, percent, actual dates, remaining duration,
total float, critical flag, expected finish) and a per-milestone row for the
update. Update history renders real counts ("22 activity snapshots") and a
compact viewer showing what a past update recorded — that dated record is the
defensibility this tool sells.

## Task 3 — One number everywhere

Same live screen shows LOGIC TIES 61 (header), 33 ties shown (Gantt legend),
22 pred/succ (metrics card). Variance shows +14 wk and +16 wk simultaneously.
Centralize the math: one selector module for tie count (define the canonical
semantics — unique directed relationships; the Gantt legend may additionally
say how many are drawn in view, labeled as such), one for variance/forecast
(always derived from the latest saved update vs baseline; live CPM state may
be shown but labeled "unsaved forecast" when it differs). Unit-test the
selectors. No surface computes these independently anymore.

## Task 4 — Queue correctness and the remaining-duration rule

- The needs-update queue must contain only rows genuinely needing action for
  the current data date (started-not-finished spanning the data date, or
  planned-to-have-started-but-no-actual). Complete activities and
  future-window rows never appear.
- The remaining-duration field is disabled with helper text until an actual
  start exists ("record an actual start first — remaining duration applies to
  in-progress work"); current-expected-finish stays the alternative entry and
  the two stay reciprocal as already built.
- Out-of-sequence rows keep their flag in the queue with the existing "review
  progress against predecessor completion" guidance — resolving OOS is
  analysis, not this phase.

## Task 5 — Tear down the schema-fallback scaffolding

The WBS, template, and milestone code paths carry fallbacks and messaging for
"schema not available." The full schedule schema is verified live in
production (all nine tables listed above). Remove the fallback branches and
their messaging; plain error toasts on genuine failures remain. Less code,
fewer states, no more hedging in the UI.

## Task 6 — Validate and ship

Full AGENTS.md gate + `constructline-cpm-smoke` + `constructline-cpm-layout-
smoke` + new unit tests (update-record creation from snapshot, amend-vs-
duplicate guard, snapshot row persistence shape, tie-count and variance
selectors, queue membership rules). Interactive verification happens
post-deploy in the founder's browser per the established release protocol — do
not request credentials or sign-ins. PR titled `CPM Phase 1: one schedule
spine`, any migration flagged loudly for pre-merge application.
