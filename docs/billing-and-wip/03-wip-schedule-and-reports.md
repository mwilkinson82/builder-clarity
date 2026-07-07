# 03 — WIP schedule & the reports suite

## The accounting WIP schedule

"WIP" is overloaded in construction. There are **two** distinct things, and
keeping them separate matters:

1. **The accounting WIP schedule** (this section) — the classic
   over/under-billing statement a lender, CFO, or bonding agent asks for:
   billed-to-date vs earned vs cost, per job. Computed from contract, cost, and
   billing data that already exists.
2. **Daily WIP** ([04 — Workspace B](04-daily-wip-workspace-b.md)) — the PM's
   record of what was put in place on a given day. Different data, different
   purpose.

The accounting WIP is computed by [`wip.ts`](../../src/lib/wip.ts)
(`computeProjectWIP`) over each cost bucket. Per job it produces:

```
total_contract          revised contract (original + approved COs)
total_cost              actual cost to date
total_cost_to_complete  remaining forecast cost
estimated_gross_profit  contract − (cost + cost_to_complete)
total_earned            Σ over assessed buckets of contract_value × earned%
total_billed            Σ amount_billed across applications
total_over_under        total_billed − total_earned   (+ overbilled, − underbilled)
total_retainage_net     net retainage the owner is holding
open_receivable         billed − paid − retainage (≥ 0)
cash_position           paid − cost
```

### The honesty rule (WIPHONESTY1)

Earned revenue is summed **only over buckets that have an explicit
`earned_percent_complete`**. A bucket with `null` percent is **"not assessed"**
and is excluded — we do **not** borrow the project roll-up and present a guess
as fact. The result carries `assessed_bucket_count` vs `bucket_count` so the UI
can flag a total as **partial** rather than pretend it is whole. Every report
that shows earned/over-under respects this and shows a `partial*` marker.

`over/under billed` sign convention: **positive = overbilled** (you've invoiced
ahead of the work — a borrowed position, drawn in amber in the UI); **negative =
underbilled** (you've earned more than you've billed — an asset).

## The reports suite

Four standard reports, all reachable from a top-level **Reports** area
(`/reports`, route [`reports.tsx`](../../src/routes/_authenticated/reports.tsx)).
The reports rail is switchable and each report **lazy-loads** its own data.

**The unifying principle: every report reuses the exact engine of the screen it
summarizes, so a report can never disagree with the app.** Shared presentation
helpers live in
[`ColHead.tsx`](../../src/components/reports/ColHead.tsx) and
[`reportFormat.ts`](../../src/components/reports/reportFormat.ts) (CSV/download).
Every report has plain-English columns with hover help, **CSV export**, and
**print-to-PDF** (landscape print CSS scoped to `.constructline-reports-page`).

| Report | Component | Server fn | Reads / matches |
|--------|-----------|-----------|-----------------|
| **WIP schedule** | [`WipReport.tsx`](../../src/components/reports/WipReport.tsx) | `listPortfolioBilling` | The Billing portfolio. Per-job contract, cost, % complete, earned, billed, over/(under) billed, backlog, est. gross profit. |
| **Job cost** | [`JobCostReport.tsx`](../../src/components/reports/JobCostReport.tsx) | `listPortfolioJobCost` | The project **Budget tab** (`computeBudgetLedger`). Pick a job → per cost code: **contract value**, budget, actual, committed, projected (EAC), over/(under) budget, **margin ($ and %)**, at risk, contingency, % used. Unpriced lines show "Needs contract value", never $0 margin (BUDGETVSCONTRACT1). |
| **Billing history** | [`BillingHistoryReport.tsx`](../../src/components/reports/BillingHistoryReport.tsx) | `listPortfolioBillingHistory` | The billing workspace. Pick a job → every requisition in order: app #, submitted, billed this app, retainage held, **running billed-to-date**, paid, status. |
| **Retainage & change orders** | [`RetainageChangeOrderReport.tsx`](../../src/components/reports/RetainageChangeOrderReport.tsx) | `listPortfolioChangeOrders` (+ retainage reused from `listPortfolioBilling`) | Pick a job → contract roll-up (original → approved → revised) + net retainage held + the full CO log with contract/cost impact and status. |

All server functions live in
[`billing.functions.ts`](../../src/lib/billing.functions.ts). They are
RLS-scoped: a normal user sees only projects they own; a super-admin sees the
whole portfolio (which is why the demo shows many projects at once).

### What is deliberately NOT here

- **GL and payroll** — those stay in QuickBooks. Overwatch is job-cost and
  receivables truth, not the accounting-of-record.
- **A date-reconstructed earned %** — earned is a current assessment, not a
  historical series, so we don't fabricate "earned as of date X".

---

**Next:** [04 — Daily WIP (Workspace B)](04-daily-wip-workspace-b.md).
