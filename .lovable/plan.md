
# Phase 1 — Make Project Outcome Review a real tool

Goal: turn the single-project demo into a persistent, multi-project system a builder's team can actually log into and use. This phase delivers the foundation that every later feature (review history, PDF export, CO workflow, notifications) builds on.

## What the user will get

1. **Login** — email/password sign-in. One account = one builder company.
2. **Portfolio landing page** — replaces the current single-project home. Shows every project in one table with Original Contract, Forecasted Final, Indicated GP $, Indicated GP %, GP At Risk, and a status pill (Healthy / Watch / At Risk based on GP erosion thresholds). Sortable; click a row to open that project.
3. **Project switcher** — header dropdown to jump between projects without going back to the portfolio.
4. **"New Project" flow** — modal capturing name, client, original contract, original cost budget. Creates the project and drops the user into its Outcome Review.
5. **Persistent edits** — Holds (add/edit/release) save to the database instead of resetting on refresh. Indicated GP is computed from saved holds on every load.
6. **Editable project header** — original contract, forecasted final contract, forecasted final cost, approved/pending COs become editable fields (inline or via an "Edit project financials" dialog) and persist.

Out of scope for Phase 1 (queued for Phase 2/3): review history & sign-off, PDF export, CO approval workflow, hold aging, CSV import, roles/permissions, notifications, schedule import. Buyout / Change Orders / Decisions / Schedule tabs stay on demo data this phase and get wired to the DB in Phase 3.

## Data model

Lovable Cloud (Postgres + Auth + RLS). All tables scoped by `owner_id = auth.uid()` so each account only sees its own projects.

```text
projects
  id, owner_id, name, client, status,
  original_contract, original_cost_budget,
  forecasted_final_contract, forecasted_final_cost,
  approved_cos, pending_cos,
  schedule_variance_weeks,
  last_reviewed_at, next_review_at,
  created_at, updated_at

holds
  id, project_id, type ('E-Hold'|'C-Hold'),
  amount, reason, owner, release_condition,
  status ('Active'|'Monitoring'|'Released'),
  created_at, updated_at
```

RLS: owner-only select/insert/update/delete on both tables, joined through `projects.owner_id` for holds. Standard grants to `authenticated` + `service_role`.

Indicated GP, GP At Risk, Forecasted GP Before Holds remain **computed in the client** from these stored fields — same formulas as today, just sourced from the DB instead of `data.ts`.

## Routes

- `/auth` — sign in / sign up (public).
- `/_authenticated/` — protected subtree (managed gate).
  - `/` — Portfolio (replaces current index).
  - `/projects/new` — handled as a modal on the portfolio, not a separate page.
  - `/projects/$projectId` — the existing Outcome Review dashboard, now reading one project from the DB.

The current `src/routes/index.tsx` becomes `src/routes/_authenticated/projects/$projectId.tsx` with minimal changes — its props come from a loader instead of `data.ts` constants. A new `src/routes/_authenticated/index.tsx` is the portfolio.

## Server functions

- `listProjects` — portfolio rows + computed indicators.
- `getProject(id)` — project + holds for the dashboard.
- `createProject(input)` — returns new id; redirect to it.
- `updateProjectFinancials(id, patch)` — header edits.
- `createHold / updateHold / releaseHold / deleteHold` — drive the Holds tab.

All use `requireSupabaseAuth`; RLS enforces ownership.

## UI changes

- New `PortfolioTable` component with status pills using existing color tokens (`accent`, `danger`, `muted`) — no new visual language.
- Header gets a project switcher (shadcn `Select`) and a "Portfolio" link.
- `HoldsPanel` swapped from local `useState` to server-fn mutations + query invalidation; UI stays identical.
- Project header values become editable via a single "Edit financials" dialog to keep the executive aesthetic intact.
- Empty states: portfolio with zero projects shows a calm prompt to create the first one.

## Aesthetic guardrails

Keep the current serif/off-white/charcoal system. No new colors, no new fonts, no dashboard chrome. Portfolio table reuses the same hairline borders and tabular numbers as the existing tables.

## What I'll ask you before building

1. Sign-up: open (anyone can register) or invite-only for now?
2. Should the demo "Harbor Residence" data seed automatically into a new account so the dashboard isn't empty on first login?

Approve this and I'll enable Lovable Cloud, run the migration, and ship Phase 1.
