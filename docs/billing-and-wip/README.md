# Billing & WIP — the money system of Overwatch

This folder is the durable reference for how Overwatch handles **money on a
construction job**: the schedule of values, the budget, billing (pay
applications / invoices), retainage, change orders, the WIP schedule, the
standard reports, and the daily WIP the PM records. It exists so any future
model, agent, or engineer can understand **what is built, how it fits together,
and — most importantly — what we are trying to achieve**, without having to
reverse-engineer it from the code.

Written 2026-07-06, after the Billing & Reporting build-out. It documents the
system as it actually ships, and is honest about what is deferred.

> Companion documents already in the repo:
> [`docs/BILLINGDESIGN.md`](../BILLINGDESIGN.md) (the authoritative design
> record and roadmap) and [`docs/BUDGETENGINE.md`](../BUDGETENGINE.md) (the
> budget-vs-cost ledger). This folder ties them together with the code that
> now implements them.

---

## What we are trying to achieve

**Overwatch is the job-cost and receivables _truth_ for a builder — not their
books.** QuickBooks (or Sage, or whatever GL the company runs) stays the
accounting-of-record for the corporate ledger and payroll. Overwatch owns the
one thing those tools are bad at: **the live, per-job picture of what was
contracted, what it costs, what has been earned, what has been billed, and what
is still owed.**

Everything here serves four goals:

1. **One spine, many speeds.** A job's money lives on one structure — **SOV
   lines + cost codes**. The PM's _daily_ labor entry, the biller's _monthly_
   pay application, and the IOR's _forecasted-final_ are the **same numbers seen
   at different speeds**. We never keep two disagreeing copies of the truth.

2. **Accurate to the cent, honest by construction.** All money is integer cents
   internally (see [cents-safety](05-data-model-and-code-map.md#cents-safety));
   derived numbers are derived, never stored, so they can't drift. Where we
   don't know something (e.g. earned % on an un-assessed cost code) we **exclude
   it and say so** rather than fabricate it (the WIPHONESTY1 principle).

3. **Intuitive, sequential, and it remembers.** Billing is a guided path
   (Format → SOV → this-period → bill the owner), not a maze. Each new pay
   application **carries forward** the previous one's to-date so the biller
   never re-keys history. Reports read the **same engine** as the screen they
   summarize, so they can never contradict the app.

4. **Billing never waits on the PM — and the bill comes from the SOV.** Daily
   WIP is project tracking: it informs the PM, who updates the SOV's percent
   complete and hands it to accounting; accounting builds the pay application
   from the SOV. A pay app is **never** generated from daily tracking (founder
   decision 2026-07-06 — daily numbers may not be accurate enough to bill
   from), and billing works exactly the same whether or not the PM records
   daily WIP at all.

---

## The mental model (read this first)

```
   ESTIMATE  ──frozen──►  BUDGET (your cost)        SOV (the contract you bill)
   (markup = margin)      = cost codes / buckets    = scheduled values
                                │                          │
                                │  budget ≠ SOV.           │
                                │  SOV is larger; the      │
                                │  gap is your margin.     │
                                ▼                          ▼
                          ┌─────────────────── THE SPINE ──────────────────┐
                          │  cost_buckets (cost codes)  +  SOV line values  │
                          └───────┬───────────────┬───────────────┬────────┘
                                  │               │               │
                       ┌──────────▼───┐   ┌───────▼───────┐   ┌───▼──────────┐
                       │ DAILY WIP    │   │ BILLING       │   │ WIP SCHEDULE │
                       │ (Workspace B)│   │ (pay apps /   │   │ (accounting: │
                       │ crew×hrs×rate│   │  invoices,    │   │  billed vs   │
                       │ per day,     │   │  AIA G702/703,│   │  earned vs   │
                       │ per code     │   │  retainage,   │   │  cost →      │
                       │              │   │  change orders│   │  over/under) │
                       └──────────────┘   └───────────────┘   └──────────────┘
                          informs the PM;      bills from the      summarized by
                          NEVER becomes        SOV the PM fills    the REPORTS suite
                          the bill             out (% complete)
```

- **Budget = your cost.** Comes from the frozen estimate's line costs. It is
  **less** than the contract.
- **SOV (Schedule of Values) = the contract you bill from.** What the owner
  agreed to pay. You bill against this, **not** against cost.
- **Cost codes / cost buckets** are the shared rows both hang on.
- **Change orders** grow the contract (original → revised) and, when approved,
  are allocated onto cost codes so they show up in billing and cost.
- **Retainage** is the slice the owner withholds until closeout.

The single most important business rule, stated plainly:
**bill the contract (SOV), track your cost (budget), and never confuse the two.**

---

## The documents

| Doc | Covers |
|-----|--------|
| [01 — The spine: SOV & Budget](01-the-spine-sov-and-budget.md) | Schedule of values, cost codes, Budget ≠ SOV, the budget-vs-cost ledger, estimate→budget carry, exposures/At-Risk. |
| [02 — Billing](02-billing.md) | The pay-app builder, AIA G702/G703, carry-forward memory, retainage, change orders in billing, invoices & payments, transactional email. |
| [03 — WIP schedule & the reports suite](03-wip-schedule-and-reports.md) | The accounting WIP (billed vs earned vs cost → over/under), and the four standard reports (WIP, Job cost, Billing history, Retainage & change orders). |
| [04 — Daily WIP (Workspace B)](04-daily-wip-workspace-b.md) | The PM's daily work-in-place recording (crew×hours×rate, materials, equipment), the daily report shown alongside, production rates, and the dependency rule. |
| [05 — Data model & code map](05-data-model-and-code-map.md) | Every table, the server functions, the key files, the cents-safety convention — the navigation aid for the next agent. |

## How this was built (traceability)

The system was delivered across a series of reviewed PRs in mid-2026. The
roadmap and per-phase intent live in [`docs/BILLINGDESIGN.md`](../BILLINGDESIGN.md);
the phase docs in [`docs/phases/`](../phases/) (GETTINGPAID1–3, BILLINGBATCH1–2,
BILLINGRAIL1, WIPHONESTY1, PHASE4) hold the batch-by-batch record. This folder
is the **synthesis** — the "how it all fits" that those per-batch docs don't
give you on their own.
