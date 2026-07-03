# HOTFIX-DEMO-RESEED.md (Claude Code task spec)

Read AGENTS.md (repo root). Estimating-session hotfix; run AFTER
darian-batch-1 merges, BEFORE darian-batch-2. Branch:
`hotfix/demo-hide-not-delete`. A CPM agent is active — do not touch the
schedule module.

Bug (live beta report): deleting the seeded "Harbor Residence" demo project
succeeds, then the project reappears. Cause: the demo seeders
(`projects.functions.ts` DEMO SEED section, `ensureHarborDemoEstimate` /
`ensureHarborSampleMasterSheet` in `estimates.functions.ts`,
`ensureHarborPlanRoomDemo` in `plan-room.functions.ts`) run ensure-on-load and
recreate anything missing.

Founder's chosen design (stated to the beta tester): **hidden, not deleted.**
`projects.archived_at` already exists — NO migration.

## Task 0 — Hide, don't delete; never reseed

- Deleting the demo project (job number DEMO-HARBOR) archives it
  (`archived_at = now()`) instead of hard-deleting, with confirm copy: "This
  hides the Harbor Residence training project for your whole company."
- EVERY demo ensure-path (project, estimate, master sheet, plan-room set, CPM
  demo activities, inspection demo) checks for the demo project's existence
  INCLUDING archived rows — an archived demo means the org opted out; seed
  nothing, for any of the demo artifacts.
- Archived demo stays out of all default project lists (verify the existing
  archived filter already handles this; fix if any surface leaks it).
- Demo estimate deletion follows the same rule if it has its own path: hide or
  allow, but never re-seed once the demo project is archived.
- Restore path: the existing unarchive affordance (if present) simply works —
  unarchiving the demo project resumes normal behavior. Build nothing new.

## Task 1 — Validate and ship

Gate + unit test: archived demo → all ensure functions no-op; active demo →
unchanged. PR titled `Hotfix: demo project hides on delete, never reseeds`.
No migrations; flag loudly if that changes. Commit this file to docs/phases/.
