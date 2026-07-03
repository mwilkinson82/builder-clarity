# CPMIMPORT.md — Bring Your Schedule In (Claude Code task spec)

Read AGENTS.md. **CPM/Schedule** agent, schedule territory only. Branch:
`schedule/cpm-import`. Other agents may run in parallel. No migrations
expected (imports create rows in existing schedule tables); flag loudly
otherwise.

Founder evidence: a Contractor Circle member ("I already have it in Excel —
I don't want to recreate it in Overwatch") and the founder's dictated design:
import gives them every activity and duration as a STARTING POINT; they tag
logic in Overwatch afterward. Guiding principle, verbatim intent: intuitive,
not templatized — the import is a beginning the PM tweaks, never a cage.

## Task 0 — Excel/CSV schedule import
"Import schedule" action beside Build from milestones / Templates in Schedule
actions:
- Accepts .xlsx/.csv (SheetJS is available). Column-mapping step: the wizard
  shows detected headers and lets the user map to Activity ID (optional),
  Description (required), Duration (days), Start, Finish, WBS/Area (all
  optional). Smart defaults by header-name matching; nothing imports without
  the user seeing the mapping.
- Preview step: parsed rows in a table with per-row validation (blank
  descriptions, unparseable durations/dates flagged, includable/excludable per
  row). Duration derived from Start/Finish when only dates are given; default
  duration (1d, editable in the preview) when neither exists.
- Import creates schedule_activities with NO logic ties (by design), ordered
  as imported, WBS sections created/matched when mapped. IDs auto-generated
  when not supplied, honoring the existing numbering style.
- Result lands on the CPM grid with a clear next step (Task 2).

## Task 1 — Build schedule from SOV
For the estimate-first path: "Build from SOV" action that reads the project's
schedule of values lines and proposes one activity per SOV line (description
from the line, WBS from cost-code grouping, duration blank→default), shown in
the same preview/confirm table (per-row uncheckable — suggest, never force).
Creates activities with no logic, same as Task 0. If the project has no SOV,
the action explains that instead of hiding.

## Task 2 — The "needs logic" runway
Imported schedules have activities but no ties — make finishing the job
guided, not archaeological:
- A "No logic" view filter (activities with zero predecessors AND zero
  successors, excluding designated start/finish milestones).
- A post-import banner on the grid: "N activities imported · 0 logic ties —
  tag predecessors to activate CPM" linking to that filter.
- CPM basis honesty: the existing CPM BASIS badge must read appropriately
  (not "Reliable") while the network is substantially untied; forecasts
  labeled accordingly. Never present untied dates as a CPM result.

## Task 3 — Validate and ship
Gate + both CPM smokes + unit tests (column auto-mapping, duration/date
parsing incl. feet-and-inches-style oddities like "10d"/"2w", SOV grouping,
no-logic filter membership). Fixtures: a realistic messy Excel export and a
clean one. PR titled `CPM: import schedule from Excel/CSV + build from SOV`.
Commit this file to docs/phases/.
