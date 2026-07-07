# BUDGETENGINE.md — Budget-vs-Cost accounting ledger (design record)

Founder design session, 2026-07-05. Companion to [BILLINGDESIGN.md](./BILLINGDESIGN.md).
This is the "why + shape" for the budget-vs-cost accounting view. Draft for
founder sign-off; build follows the phases below.

## The one-sentence model

**Contract value − Budget = margin.** The estimate produces the Budget (your
cost). The contract produces the SOV (what the owner pays). You **bill from the
SOV** and **project-manage from the Budget**, and the whole job is watching cost
(Budget → Actuals → At-Risk) stay under contract.

## Budget and SOV are two different schedules

|                | **Budget**                        | **SOV**                          |
| -------------- | --------------------------------- | -------------------------------- |
| Comes from     | the **estimate**                  | the **contract**                 |
| Represents     | your **cost** to build            | what the owner **pays**          |
| Total          | **less** than the SOV             | = contract value                 |
| Used to        | **project-manage** (cost vs risk) | **bill** (pay apps / AIA)        |
| Lives (today)  | `cost_buckets` (the "SOV/Costs" project tab — misnamed) | `billing_line_items` (billing) |

They share the same cost-code grain but are distinct numbers. The project-level
"SOV / Costs" tab is really the **Budget** and should be renamed; Billing owns
the real (contract) SOV.

## "At Risk" is the differentiator: it is the IOR

Every off-the-shelf tool's "At Risk" column is a manual guess. In Overwatch it
is **live** — it is the IOR risk register:

- **At Risk** column = **E-Holds** (`exposures.hold_class = 'E-Hold'`) — **emergent
  risk** you see as the job runs; never in the bid. Pure risk *against* the
  locked budget.
- **Contingency** column = **C-Holds** (`exposures.hold_class = 'C-Hold'`) —
  contingency, either a % carried in the **bid** (the only place risk touches the
  estimate) or money set aside mid-project for something you see coming.

allocated to cost codes. No Procore/Sage report can read a live risk register;
this is what makes the accounting view *ours*. IOR is the source of the risk
truth; **Billing pulls from it** and renders the complete ledger.

## What already exists (≈80% of it)

| Ledger column        | Source (already in the schema)                                   |
| -------------------- | ---------------------------------------------------------------- |
| Budget               | `cost_buckets.original_budget` (by cost code)                    |
| Actuals              | `cost_buckets.actual_to_date` / `cost_actuals` rollup            |
| Open                 | `cost_buckets.ftc` (forecast-to-complete)                        |
| At Risk              | `exposures` where `hold_class='E-Hold'` — **needs cost-code link** |
| Contingency          | `exposures` where `hold_class='C-Hold'` — **needs cost-code link** |
| Customer Contract Value (Original / CO's / Current) | `billing_line_items.scheduled_value_cents` + `change_order_value_cents`, CO allocations |
| Estimate             | `estimate_line_items` — **needs carry into budget**              |
| EAC / Complete / (Over)Under | computed rollup                                          |

## What is genuinely new

1. **Exposure → cost-code allocation (splittable).** Today exposures are
   project-level. Add a **splittable** link — one E/C hold can spread across
   several cost codes, and any unallocated remainder shows as **general job
   risk** (no code). Mirror the change-order → cost-code pattern we shipped
   (`change_order_allocations`, `src/lib/change-order-allocation.ts`) — an
   `exposure_allocations` table, not a single FK.
2. **Estimate → Budget carry.** Populate the Budget (cost by cost code) from the
   estimate; plus manual budget entry for jobs not estimated in Overwatch (the
   SOV/Costs editor already allows manual entry).
3. **The unified ledger view** in Billing — the two-sided report (Contract Value
   | Estimate-at-Complete + Savings/(Loss)), grouped as in the founder mockups
   (Contract SOV lines / PC not linked to SOV / proposals / unlinked scopes /
   OH&P). Mostly a *view* over the above.
4. **Rename & consolidate:** project "SOV / Costs" tab → **Budget**; Billing owns
   the contract SOV; the accounting report lives in Billing.

## Schema plan (all migrations via the desk)

- **Migration A — `exposure_allocations` (splittable):**
  ```sql
  CREATE TABLE public.exposure_allocations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    exposure_id uuid NOT NULL REFERENCES public.exposures(id) ON DELETE CASCADE,
    cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
    cost_code text NOT NULL DEFAULT '',
    amount numeric NOT NULL DEFAULT 0,   -- portion of dollar_exposure on this code
    created_at timestamptz NOT NULL DEFAULT now()
  );
  -- RLS via can_read/can_manage_project, same as change_order_allocations.
  ```
  Unallocated remainder (`dollar_exposure − Σ allocations`) = general job risk.
- **Estimate is read from the estimating module** (`estimate_line_items`); Budget
  is `cost_buckets.original_budget` (frozen once created from the estimate). No
  new Estimate column needed on `cost_buckets` — the ledger shows Estimate from
  the estimate source and Budget from the bucket.
- Estimate→Budget carry and the ledger rollup are **server fns + pure math**
  (no migration): read `estimate_line_items`, write `cost_buckets.original_budget`
  once; compute the ledger from buckets + exposure_allocations + billing lines.

## The math (exact-cents rollup)

Per cost code:
- **Budget** = `cost_buckets.original_budget` (frozen baseline)
- **Actuals** = paid to vendors/subs (`cost_actuals` where paid / `actual_to_date`)
- **Open** = committed-but-unpaid (`ftc` / committed cost actuals)
- **EAC = Actuals + Open**
- **(Over)/Under = Budget − EAC**
- **At Risk** = Σ E-Hold `exposure_allocations.amount` on this code
- **Contingency** = Σ C-Hold `exposure_allocations.amount` on this code
- **Contract Value (SOV)** = `billing_line_items.scheduled_value_cents` (+ CO value)
- **Savings/(Loss)** = margin movement (Contract − EAC, vs Contract − Budget)

## Phasing (each its own PR, agents stop at PR-open, migrations → desk)

- **Phase 1 — At Risk goes live.** Exposure → cost-code allocation (Migration A)
  + reuse the CO-allocation UI so E/C holds attach to cost codes. Now the At
  Risk & Contingency columns are real.
- **Phase 2 — The ledger view.** Build the budget-vs-cost report in Billing (pure
  rollup over buckets + exposures + billing lines), grouped per the mockups.
- **Phase 3 — Estimate → Budget.** Carry estimate line items into the budget
  (+ manual entry, + the Estimate column if distinct).
- **Phase 4 — Rename & consolidate.** "SOV / Costs" → "Budget"; fold into Billing;
  retire the redundant standalone tab (coordinate with the project route).

## Resolved decisions (founder, 2026-07-05)

1. **Exposure split → YES, splittable.** One E/C hold can spread across several
   cost codes; unallocated remainder = general job risk. → `exposure_allocations`
   table (Migration A above).
2. **Estimate → Budget, then frozen.** The estimator + PM turn the estimate into
   the Budget once; **the budget never changes** — it's the locked baseline the
   PM steers against. The report's "Estimate" column *is* the budget for most
   users (Darian's report proves it). Budget = `cost_buckets.original_budget`,
   set once, immutable.
3. **EAC = Actuals + Open.** Actuals = paid; Open = committed-but-unpaid.
   `(Over)/Under = Budget − EAC`. At Risk/Contingency are a risk overlay, not
   inside EAC.
4. **One budget number, sourced from the estimate; IOR and Billing both read
   it.** Budget is created from the estimate (estimator + PM) and lives in
   `cost_buckets`. IOR's cost figure and Billing's ledger both read the same
   locked number — no conflicting writes.

**E-Hold vs C-Hold semantics (confirmed):** E-Hold = emergent risk seen as the
job runs, never in the bid → **At Risk** column. C-Hold = contingency, either a
bid % (the only estimate touch-point) or a mid-project set-aside → **Contingency**
column.

## Addendum — the budget lock is enforced (founder decision, 2026-07-06)

Resolved decision #2 ("the budget never changes") was, until BUDGETLOCK1, a
convention the UI did not enforce — `original_budget` was editable at any time.
The founder confirmed the hard rule and it is now enforced in code:

> **The budget is locked and frozen. The ONLY way the budget changes —
> increases or decreases — is through change orders.** A change order is
> priced with its own budget; that budgeted cost adds to (or deducts from)
> the locked contract budget. Change orders change the budget because they
> add or deduct scope.

Implementation (BUDGETLOCK1):
- `projects.budget_locked_at` (migration `20260706233000_project_budget_lock.sql`)
  records when the baseline froze. Locking happens **explicitly** ("Lock
  budget" on the Budget tab) or **automatically when the first pay application
  is created** — you don't bill against an unfrozen baseline. There is no
  unlock in the product; unwinding a lock is a desk operation.
- Server-enforced once locked: `original_budget` edits, budgeted-line deletes,
  nonzero-budget line creation, and the estimate→budget carry are all refused
  (`updateBucket` / `createBucket` / `deleteBucket` / `buildBudgetFromEstimate`).
  Zero-budget lines can still be added (they receive CO allocations or track
  added cost). Actuals and FTC stay editable — they are cost, not budget.
- The ledger's **Budget column = frozen original + approved CO cost
  allocations** (`computeBudgetLedger`, change-order layer). Approved CO money
  not yet allocated to a code appears as its own "Change orders (unallocated)"
  line so the total never lies. Deductive COs carry negative cost and reduce
  the budget. Pending/denied COs never touch it.

## Addendum — line-level contract value (BUDGETVSCONTRACT1, 2026-07-06)

A live user report exposed the gap: at the line level, `cost_buckets` had only
`original_budget`, so every view that needed per-line contract value reused the
budget — collapsing margin to zero, and worse, **the pay-app SOV import billed
the owner at cost** (`billing-line-generation` seeded `scheduled_value` from
`original_budget`; the WIP engine likewise defined contract = budget + COs).
The founder's framing is the acceptance test:

> "The budget is what we drive the job on. The contract's what they pay us.
> The difference between the two, the delta, is our profit. The budget and the
> contract value can't be the same."

Implemented (spec: [`docs/phases/BUDGETVSCONTRACT1.md`](./phases/BUDGETVSCONTRACT1.md)):
- **`cost_buckets.contract_value`** (migration `20260707003000`) — the billable
  value of the line, independent of `original_budget`. **Line margin =
  contract_value − budget** ($ and % of contract), derived, never stored.
- **Backfill:** real projects stay `0` = **unpriced** — an explicit
  "needs contract value" state; we never seed a client's contract from their
  budget (that recreates the zero-margin bug). The Harbor demo seeds realistic
  per-line contract values (Σ = its $3.2M contract vs $2.72M budget).
- **Ledger + Job Cost report** show Contract value | Budget | … | **Margin**,
  each side carrying its own CO layer (`contract_amount` → contract,
  `cost_amount` → budget), so an approved CO's own margin flows into the delta.
  Unpriced lines render a chip and a **null** margin — never $0.
- **SOV import / billing generation** bills the line's contract value; unpriced
  legacy lines fall back to budget so existing jobs keep billing (and the grid
  cues pricing them). The WIP engine uses the same priced-or-fallback basis.
- **Locks:** contract_value shares `budget_locked_at` — after lock, both
  baselines move only through approved change orders.
- **Estimate→budget carry** still populates cost only: estimate markups are
  estimate-level, so distributing them to a per-line *price* would be a guess.
  Lines arrive unpriced; the user enters the contract SOV. (Founder call if a
  distribution rule is ever wanted.)
