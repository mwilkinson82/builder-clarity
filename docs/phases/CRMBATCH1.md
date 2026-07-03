# CRMBATCH1.md — Two Evidenced Fixes (Claude Code task spec)

Read AGENTS.md. You are the **CRM** agent; CRM/pipeline territory only
(pipeline components and functions). Other agents run in parallel overnight —
do not touch estimating, schedule, billing, or auth files. No migrations
expected; flag loudly otherwise.

Both items are from tonight's live beta and PR #76's flags — nothing
speculative.

## Task 0 — Delete on CRM opportunities (beta request)
Tester: "delete feature on CRM opportunities would be nice as well." Add
delete to opportunities matching the app's existing destructive-action
pattern (confirm dialog naming the record; hard delete unless the pipeline
schema already carries an archive state — if it does, prefer archive for
consistency with projects and say so in the PR). Respect existing RLS; if
the delete needs a policy that does not exist, STOP and flag loudly instead
of writing a migration.

## Task 1 — CRM demo seeder respects the demo tombstone (PR #76 flag)
The CRM demo seeder still links its seed opportunities to the Harbor demo
project even when the org has archived the demo. Route it through the
demo-seed skip logic shipped in PR #76 (demo-seed module): archived demo →
seed nothing. Unit test both branches.

## Task 2 — Validate and ship
Gate + relevant tests. PR titled `CRM: opportunity delete + demo-seed skip`.
Commit this file to docs/phases/.
