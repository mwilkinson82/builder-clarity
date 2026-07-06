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
