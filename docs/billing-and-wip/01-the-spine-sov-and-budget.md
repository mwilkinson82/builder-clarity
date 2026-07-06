# 01 — The spine: SOV & Budget

Everything about money on a job hangs on one structure. Get this right and the
rest of the system is bookkeeping; get it wrong and every number downstream is
wrong.

## Cost codes / cost buckets — the shared rows

The atomic unit is the **cost bucket** (a.k.a. cost code), stored in
`public.cost_buckets`. Each bucket carries:

- `cost_code` + `bucket` (the code and its description, e.g. `03-300` /
  "Cast-in-place concrete"),
- `original_budget` — the budgeted **cost** for this code,
- `actual_to_date` — cost booked so far,
- `ftc` — forecast/cost-to-complete (the "open" commitment),
- `earned_percent_complete` — the bucket's own assessment of how complete it is
  (**nullable** — `null` means "not assessed", which is different from 0%),
- billing settings (`retainage_pct`, `billing_method`, `contract_quantity`,
  `unit`).

Both the **budget** view and the **SOV/billing** view read these same rows. That
is the "one spine" — there is no separate budget table and billing table that
can disagree.

## Budget ≠ SOV (the distinction everything depends on)

This is the single most important idea in the money system, and it is easy to
get wrong.

| | **Budget** | **SOV (Schedule of Values)** |
|---|---|---|
| What it is | **Your cost** to do the work | **The contract** — what the owner pays |
| Where it comes from | The frozen estimate's line **costs** | The contract's scheduled values |
| Relative size | Smaller | Larger (budget + your margin) |
| You use it to | Track spend, forecast profit | **Bill the owner** |
| The trap | — | Billing at cost = giving away your margin |

**You bill the SOV, not the budget.** The estimate's markup _is_ the margin, so
the budget (cost) sits below the SOV (contract). When billing lines are
generated from cost buckets, a guard-rail cue reminds the biller that the SOV is
the contract schedule, not the cost budget — see
[`AiaApplicationStepper.tsx`](../../src/components/billing/AiaApplicationStepper.tsx)
(the "This is what you bill the owner — set it to your contract schedule of
values, not your cost budget" cue) and
[`billing-line-generation.ts`](../../src/lib/billing-line-generation.ts).

The project's **Budget tab** deliberately leads with the budget (your cost) and
keeps SOV/contract content in the Billing surface, so a PM working day-to-day
sees cost, and a biller preparing a requisition sees the contract.

## The budget-vs-cost ledger

The per-cost-code accounting view — "where is the money going on this job" — is
computed by [`budget-ledger.ts`](../../src/lib/budget-ledger.ts)
(`computeBudgetLedger`). For each cost code it produces:

```
EAC (projected cost) = Actuals + Open        (paid + committed-but-unpaid)
(Over)/Under         = Budget − EAC          (positive = under budget)
```

Plus two columns no off-the-shelf accounting tool can produce, which come from
the IOR exposure register (see below): **At Risk** and **Contingency**.

This ledger is the data source for the **Job Cost report** (see
[03](03-wip-schedule-and-reports.md)) and for the project's Budget tab.

## Estimate → Budget carry

The budget is seeded from the company's Overwatch estimate.
`buildBudgetFromEstimate` in
[`projects.functions.ts`](../../src/lib/projects.functions.ts) aggregates the
estimate line **costs** (material + labor) by cost code and writes them onto the
cost buckets. **The estimate's markups are the margin, not the budget** — so
only the cost carries down. Matching cost codes update in place; new codes
create a bucket. The math lives in
[`estimate-budget.ts`](../../src/lib/estimate-budget.ts).

## Change orders grow the contract

Approved change orders increase the contract (original → revised). They live in
`public.change_orders` (number, description, `contract_amount`, `cost_amount`,
`status` = Approved | Pending | Denied, `co_type`). Only **Approved** COs move
the revised contract:

```
revised_contract = original_contract + Σ(approved CO contract_amount)
```

Approved COs are **allocated onto cost codes** via
`public.change_order_allocations`, so their contract value flows into the SOV /
billing (so G702 line 2 — change orders — is not $0) and their cost flows into
the budget. This is why a CO shows up in both the billing schedule and the cost
ledger.

## Exposures → At Risk / Contingency (the IOR overlay)

The IOR (Independent Оversight Role) tracks **exposures** — emergent risk that
isn't yet a committed cost — in `public.exposures` (each has a `dollar_exposure`
and a `hold_class`: `E-Hold` = at-risk, `C-Hold` = contingency). Those
exposures are spread across cost codes via `public.exposure_allocations`. Summed
by cost code and hold class (see
[`exposure-allocation.ts`](../../src/lib/exposure-allocation.ts)), they become
the live **At Risk** and **Contingency** columns of the budget ledger — the
forward-looking risk on top of committed cost. Whatever isn't allocated to a
specific code is "general job risk".

These columns are shown **for awareness** — they are risk, not committed cost,
and are **not** folded into the projected cost (EAC).

---

**Next:** [02 — Billing](02-billing.md) — how the SOV becomes a requisition the
owner pays.
