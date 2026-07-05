# BILLINGRAIL1 — Billing reads as a pipeline, and costs get a front door

**Territory (AGENTS.md):** Billing (`src/components/billing/*`, billing functions) plus a
bounded touch of IOR/Project (`src/routes/_authenticated/projects.$projectId.tsx` billing
workspace region). The project-route edit is confined to replacing the billing sub-tab
markup with the rail; call it out explicitly in the PR body per AGENTS.md module-ownership.
Agents stop at PR-open. See migration note in Task 2.

**Depends on:** WIPHONESTY1 (WIP is stage 4 on the rail; land the honesty fix first so the
rail's final stage isn't showing fabricated numbers).

---

## The problem (confirmed against `main`, 2026-07-05)

Billing is a top-level tab, and inside it `projects.$projectId.tsx` L3126–3146 renders a
second tab row of **seven** siblings: `billing / pay-app-detail / project-costs /
wip-analysis / invoice-ledger / pending-cos / pay-app-ledger` (the audit undercounted at
four), plus a separate top-level billing pane at L1991. These are **stages of one
workflow** — cost budget → costs land → bill against them → see over/under — presented as
peers you pick between, with no order and no state showing what's done. WIP and the cost
ledger, two of the four audited pain points, live two navigation levels down inside the
largest file in the app. Nobody finds them in the right order because the structure implies
no order. This is the GETTINGPAID3 Task 0 "visible progression, never hidden gates" pattern
promoted from the pay-app builder to the whole billing module.

Second confirmed gap: **there is no UI to add a cost actual by hand.** Nothing in
`src/components/billing/` writes `cost_actuals` interactively; costs enter only via
estimate-seed (`estimates.functions.ts` seeds `cost_buckets`) or import batch
(`billing.functions.ts` inserts `cost_actuals`). So the `project-costs` view shows buckets
with budgets but often no actuals, or actuals with no visible origin — it reads as noise
because it has no front door.

## Task 0 — The stage rail (audit 1.1)

Replace the seven-way sub-tab row with a **stage rail** that reads as a numbered pipeline:

```
1 Schedule of Values → 2 Costs → 3 Pay Applications → 4 WIP
```

- Each stage shows a **state chip**: empty / in progress / complete. Reuse the AIA stepper
  vocabulary from `AiaApplicationStepper.tsx` (GETTINGPAID3) — one visual language, not a
  new one. Factor the chip + rail into a small shared component
  (`src/components/billing/BillingStageRail.tsx` or a genuinely shared
  `src/components/ui/` primitive if ONBOARDING1 will reuse it — see note) so onboarding can
  reuse it.
- When a stage's prerequisite is unmet, the stage is **present but disabled with an inline
  reason**, never absent and never a dead screen: e.g. selecting Costs or Pay Applications
  before an SOV exists shows "Import your schedule of values first — pay apps and WIP are
  built from these lines." Out-of-order clicks route to the blocking stage.
- The three ledger/secondary panes that don't belong on the primary spine
  (`invoice-ledger`, `pending-cos`, `pay-app-ledger`) move into a secondary "Ledgers &
  history" group under the relevant stage (invoice/pay-app ledgers under Pay Applications;
  pending-cos surfaced near Costs/Change Orders) — not deleted, just demoted so the four-step
  spine is what a user sees first. Preserve all existing functionality and deep links.
- Preserve current URL/tab state params so existing links and the app's own navigation don't
  break; the rail is a re-presentation of the same panes, not a rewrite of their contents.

**Shared-component note:** if the rail is to be reused by ONBOARDING1 (it should be — same
chip vocabulary), put the presentational primitive in `src/components/ui/` (Shared
territory). Touching Shared concurrently needs the explicit assignment per AGENTS.md — so
either (a) land the primitive in this PR with Shared flagged, or (b) keep it billing-local
here and ONBOARDING1 lifts it to Shared later. Recommend (a) with a clear PR-body flag.

## Task 1 — The Costs stage states the model in one line (audit 1.3)

The Costs stage opens with the model in plain contractor language:
**"Budgets come from your estimate; actuals come from imports or manual entry."**

Per bucket, show the columns side by side: **Budget / Committed / Actual / FTC**. Make the
**source of every actual visible** — import-batch name, or "Manual — {user}, {date}." A
number with no provenance is what makes the ledger read as noise.

## Task 2 — Build the cost front door (audit 1.3)

Add the two actions the module is missing:
- **"Add actual"** — an inline/quick form writing a single `cost_actuals` row against a
  bucket, stamped as manual with the acting user (respect RLS/roles for who may write
  costs). This is net-new write UI; wire it through the existing billing functions layer,
  not raw DB from the component (AGENTS.md: agents never touch DB from the client directly —
  go through the functions module and RLS).
- **"Import batch"** — surface the existing import path as a first-class action here (it
  exists in `billing.functions.ts`; give it a visible door).

**[confirm] + migration:** verify whether `cost_actuals` already records provenance (an
import-batch id / manual flag / created_by). Inspect the table before writing UI. If a
`source` / `entered_by` column is missing, the migration to add it goes to the desk
(`supabase/migrations/`, portable, `IF NOT EXISTS`, enum-cast guarded) — agents write the
file, do not apply. Task 1's "show the source" depends on this column existing; if it can't
land this PR, Task 1 degrades gracefully to "Manual / Imported" without the batch name and a
follow-up is flagged.

## Task 3 — Stage state is honest

The chips must reflect real state, not guesses: SOV complete only when lines exist; Costs "in
progress" when any actual exists; Pay Applications by application count/status; WIP "complete"
only when all buckets are assessed (ties directly to WIPHONESTY1's `assessed_count`). Do not
paint a stage complete off a project-level roll-up — same disease this whole roadmap treats.

## Proof

Gate: `npx eslint <changed>`, `tsc` clean, `npm run smoke:phase0`, billing suite, `npm run
build`, bun frozen-lockfile if deps/migration touch the lock. Browser-QA in PR body on
Harbor: enter Billing on a project with no SOV and show every stage present with a reason,
not a blank; import/confirm an SOV and watch stage 1 flip to complete and stage 2 unlock; add
a manual cost actual and confirm it appears with "Manual — {user}" provenance and the Costs
chip moves to in-progress; open WIP and confirm it still reads honestly (WIPHONESTY1). Confirm
the demoted ledgers are all still reachable. Flag the project-route touch and any migration in
the PR body. Stop at PR-open.

---

## As built (2026-07-05, PR)

Two spec assumptions were corrected against `main` during implementation:
- **The cost front door already existed.** `ProjectCostTrackingPanel` already provides Add
  actual / Import / Void plus Budget/Committed/Actual/FTC/variance and states its model
  ("The SOV says what the owner can be billed. The Cost Ledger says what the job is costing
  you. WIP compares the two."). So Task 1/Task 2 were largely already satisfied; the only gap
  added here is a per-actual **Manual / Imported** provenance tag (from `import_batch_id`).
- **No migration needed.** `cost_actuals.import_batch_id` already distinguishes imported vs
  manual, so provenance is derivable without schema change.

Rail shape chosen by founder: **4 numbered stages** — 1 Overview → 2 Costs → 3 Pay
Applications → 4 WIP — with honest state chips, blocked-with-reason + route-to-blocker on
Pay Applications/WIP until an SOV exists, and the three ledgers (Invoices & Payments, Pending
COs, A/R Ledger) demoted to a secondary "Ledgers & history" group. The old competing
Application/Invoice/Payment 3-step card row was removed so the rail is the single sequence.
`BillingStageRail` is billing-local for now (not yet lifted to Shared); ONBOARDING1 can lift
it. WIP stage chip reads directly from WIPHONESTY1's `assessed_bucket_count`/`bucket_count`.
