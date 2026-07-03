# AGENTS.md — Multi-Agent Working Agreement for builder-clarity (Overwatch)

Every AI agent (Claude Code, Codex, or otherwise) working in this repo follows this
contract. It exists because multiple agents work in parallel and **main deploys to
production, where paying contractors run live projects.**

## The one rule that overrides everything

**Main is production.** Lovable deploys from `main` to
`overwatch.alpcontractorcircle.com`. Never commit directly to main. Never merge
anything that has not passed the validation gate below.

## Branch discipline

1. At task start: branch from the latest `origin/main`. Name it
   `<module>/<short-task-name>` (e.g. `estimating/quantity-source-schema`).
2. **Do not pull, fetch, merge, or inspect main again until your task is complete.**
   Movement on main mid-task is not your concern. Do not stall, re-plan, or
   investigate new commits. Your branch is your world.
3. When done: rebase once onto latest `origin/main`, resolve conflicts, re-run the
   validation gate, push, open a PR.
4. One PR merges at a time. If another PR merged after your rebase, rebase again
   before merging. Never merge on a stale base.

## Module ownership

Work only inside your module's territory. If a task requires touching another
module's files, stop and flag it in the PR description instead of editing.

| Module      | Owns                                                                                                    |
|-------------|---------------------------------------------------------------------------------------------------------|
| Estimating  | `src/components/estimates/`, `src/lib/estimates.functions.ts`, `src/lib/plan-room.functions.ts`, `src/lib/estimate-import.ts`, `src/routes/_authenticated/estimates*.tsx`, `src/routes/_authenticated/estimate-masters.tsx`, `src/routes/_authenticated/cost-library.tsx` |
| CPM/Schedule| `src/routes/_authenticated/projects.$projectId.schedule.tsx`, schedule-related functions in `src/lib/`   |
| CRM         | `src/components/pipeline/`, pipeline-related functions in `src/lib/`                                     |
| Billing     | `src/components/billing/`, billing-related functions in `src/lib/`                                       |
| IOR/Project | `src/routes/_authenticated/projects.$projectId.tsx`, `src/components/outcome/`                            |
| Shared      | `src/components/ui/`, `src/lib/auth/`, `src/routes/__root.tsx`, config files                              |

Shared territory: only with an explicit task assignment, and never concurrently
with another active agent. UI/UX polish tasks cut across territories — they run in
dedicated windows when no other agent is active, or are scoped to a single module's
files.

`src/routeTree.gen.ts` is generated. Never hand-edit; regenerate via the build.

## Database changes

- Schema changes are **migration files** in `supabase/migrations/`, named
  `YYYYMMDDHHMMSS_snake_case_description.sql`, timestamped at creation time.
- Migrations must be **portable**: guard every seed/data statement so it no-ops on
  environments where referenced rows do not exist (`INSERT ... SELECT ... WHERE
  EXISTS`, `ON CONFLICT DO NOTHING`, `IF NOT EXISTS` everywhere).
- **Enum trap (caused a real production failure):** in `INSERT ... SELECT`, bare
  string literals are typed as `text` and will not implicitly cast to enum columns.
  Always write `'value'::public.enum_type` inside SELECT lists targeting enum
  columns. Plain `VALUES (...)` inserts are exempt.
- Agents do **not** apply migrations to any database. Application to production is
  handled outside the repo (Lovable pickup or direct application by Marshall/Claude
  chat with DB access). Your job ends at the migration file.
- Never edit an already-merged migration file except for replay-portability fixes
  explicitly assigned as a task.

## Validation gate (before every PR)

```
npx eslint <changed files>
npm run smoke:phase0
npm run build
```

Plus module-specific suites where they exist: `npm run test:estimating`,
`npm run test:cpm`, `npm run test:cpm:layout`. Browser-QA any changed user flow.
A PR that has not passed the gate does not get opened.

## Code standards

- No new files over ~800 lines. If your change would push a file past that, split
  it first (mechanical split, zero behavior change, separate commit).
- Money is integer cents. Quantities are numeric. Never float dollars.
- Every user-facing label must be understandable by a contractor who has never
  seen the app. When in doubt: say what it does, not what it is.
