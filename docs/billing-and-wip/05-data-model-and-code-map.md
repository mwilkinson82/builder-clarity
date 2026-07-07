# 05 — Data model & code map

The navigation aid: what to read, in what order, when you (human or agent) need
to change something in the money system. Paths are from the repo root.

## Tables (Postgres / Supabase, all RLS-scoped by project)

### The spine
| Table | Holds |
|-------|-------|
| `projects` | Job header — `original_contract`, `percent_complete`, `job_number`, `client`, `project_manager`. |
| `cost_buckets` | **Cost codes** — `contract_value` (billable; 0 = unpriced), `original_budget` (cost), `actual_to_date`, `ftc`, `earned_percent_complete` (nullable), billing settings. The shared rows budget and SOV both hang on. **Line margin = contract_value − original_budget** (BUDGETVSCONTRACT1). |
| `projects.budget_locked_at` | When the budget baseline froze (BUDGETLOCK1). null = unlocked. Once set, `original_budget` + `contract_value` edits are refused server-side — both move only through approved change orders. |
| `sov_imports`, `sov_mapping_profiles` | Imported schedule-of-values files and column mappings. |

### Billing
| Table | Holds |
|-------|-------|
| `billing_applications` | Pay applications (requisitions). `amount_billed` is **per-application**; carry-forward pulls the prior app. |
| `billing_application_events` | Status history for an application. |
| `billing_line_items` | Per-SOV-line detail on an application (G703 columns, retainage). |
| `billing_invoices` | Client-facing invoice/requisition records. |
| `payment_ledger` | Recorded payments (reconciled against invoices). |

### Change orders & risk
| Table | Holds |
|-------|-------|
| `change_orders` | COs — `contract_amount`, `cost_amount`, `status` (Approved/Pending/Denied), `co_type`. |
| `change_order_allocations` | Approved-CO contract/cost spread onto cost codes. |
| `change_order_approvals` | CO approval trail. |
| `exposures` | IOR exposures — `dollar_exposure`, `hold_class` (E-Hold / C-Hold). |
| `exposure_allocations` | Exposures spread onto cost codes → At Risk / Contingency. |

### Cost & daily
| Table | Holds |
|-------|-------|
| `cost_actuals`, `cost_actual_import_batches` | Booked cost (has `cost_date` — date-stamped). |
| `daily_reports` | Narrative daily log — crew, weather, work performed, delays. |
| `daily_wip_entries` | **Daily WIP** — per activity per day: crew/hours/rate, materials, equipment, quantity/unit. Migration `supabase/migrations/20260706120000_daily_wip_entries.sql`. |

## Library modules (`src/lib/`)

### Engines (pure, node-loadable, cents-safe)
- [`wip.ts`](../../src/lib/wip.ts) — `computeProjectWIP` (the accounting WIP: billed vs earned vs cost → over/under, retainage, receivable).
- [`budget-ledger.ts`](../../src/lib/budget-ledger.ts) — `computeBudgetLedger` (**contract** vs budget vs actual vs open → EAC, over/under, **margin**; At Risk / Contingency; approved-CO layer on both contract and budget sides) + `ledgerLineMargin`.
- [`exposure-allocation.ts`](../../src/lib/exposure-allocation.ts) — exposure → cost-code math (E/C hold split).
- [`daily-wip.ts`](../../src/lib/daily-wip.ts) — daily work-in-place math (labor = crew×hours×rate, day roll-up, production rate).
- [`aia-math.ts`](../../src/lib/aia-math.ts) — G703 columns D/E/F/G, overbilled-line detection.
- [`billing-line-generation.ts`](../../src/lib/billing-line-generation.ts) — generate billing lines from cost buckets (SOV, not cost).
- [`estimate-budget.ts`](../../src/lib/estimate-budget.ts) — estimate line costs → budget by cost code + `estimateHasDistributableMarkup` (auto-price the contract by pro-rata markup distribution, BUDGETVSCONTRACT2).
- [`sov-rollup.ts`](../../src/lib/sov-rollup.ts) / [`sov-import.ts`](../../src/lib/sov-import.ts) — SOV totals & import parsing.
- [`payments-domain.ts`](../../src/lib/payments-domain.ts) — cents helpers, invoice/ledger reconciliation, refund reversal, Stripe readiness.

### Utility
- [`download-file.ts`](../../src/lib/download-file.ts) — **the one safe browser-download path** (`downloadFileBytes` / `downloadTextFile`). Delayed blob-URL revoke; never hand-roll `createObjectURL` + `revokeObjectURL` (a synchronous revoke silently cancels downloads in Safari/iOS). Phase0-pinned.

### Server functions (`createServerFn`, RLS-scoped)
- [`billing.functions.ts`](../../src/lib/billing.functions.ts) — the big one. `listPortfolioBilling` (WIP data), `listPortfolioJobCost`, `listPortfolioBillingHistory`, `listPortfolioChangeOrders` (the four reports), plus pay-app CRUD, cost-actual CRUD, cost-bucket billing settings.
- [`daily-wip.functions.ts`](../../src/lib/daily-wip.functions.ts) — `listDailyWipEntries`, `saveDailyWipEntry`, `deleteDailyWipEntry`.
- [`daily-reports.functions.ts`](../../src/lib/daily-reports.functions.ts) — daily report CRUD.
- [`projects.functions.ts`](../../src/lib/projects.functions.ts) — project loader, `buildBudgetFromEstimate`, exposure/CO/bucket mutations.

### Presentation
- [`billing-format.ts`](../../src/lib/billing-format.ts) — `fmtUSDCents` (renders a **dollar** value at cents precision — does NOT divide by 100), date/status labels.
- [`aia-pdf.ts`](../../src/lib/aia-pdf.ts) — G702/G703 PDF (`pdf-lib`).
- [`aia-builder-steps.ts`](../../src/lib/aia-builder-steps.ts) — the pay-app builder step/gate logic.

## Components (`src/components/`)
- `reports/` — `WipReport`, `JobCostReport`, `BillingHistoryReport`, `RetainageChangeOrderReport`, `ColHead` (shared header + hover help), `reportFormat` (shared CSV/download).
- `billing/` — `AiaApplicationStepper` (the 4-step builder), `BillingEnhancements` (carry-forward banner, email), `ReceivablesCockpit` (Workspace A).
- `project/BudgetLedgerTable.tsx` + `project/billing/BillingWorkspace.tsx` (the project Billing tab) + `billing-workspace-atoms.tsx` (`WorkspaceHeader`).
- `outcome/DailyWipWorkspace.tsx` (Workspace B) + `outcome/DailyReportsWorkspace.tsx`.

## Routes (`src/routes/_authenticated/`)
- [`billing.tsx`](../../src/routes/_authenticated/billing.tsx) — portfolio billing / receivables cockpit.
- [`reports.tsx`](../../src/routes/_authenticated/reports.tsx) — the Reports suite (rail + 4 reports).
- [`projects.$projectId.tsx`](../../src/routes/_authenticated/projects.$projectId.tsx) — project tabs: Budget (`sov`), **Billing**, **Change Orders**, **Daily Reports**, **Daily WIP**, etc.

## Conventions

### Cents-safety
All money is **integer cents** internally. Convert once at the boundary with
`dollarsToCents` / `centsToDollars` (from `payments-domain.ts`). Sum in cents,
convert back once. Never round mid-calculation. Derived money (labor cost,
EAC, work-in-place) is **computed, not stored**, so it can't drift from its
inputs.

### Honesty
Never fabricate a number you don't have. Unassessed cost codes are excluded from
earned totals and the total is flagged **partial**, not silently completed
(WIPHONESTY1). An **unpriced** line (no contract value) shows "needs contract
value" and a null margin — never a $0-margin line (BUDGETVSCONTRACT1). Reports
reuse the source screen's engine so they can't disagree.

### Contract ≠ budget (BUDGETVSCONTRACT1)
Contract value (what the owner pays) and budget (your cost) are two independent
per-line numbers; the delta is margin. Nothing may reuse `original_budget` as a
contract/scheduled/sell value — the only allowed fallback is the explicit
"unpriced legacy line → budget" one in the WIP engine and billing-line
generation, and it exists solely so pre-migration jobs keep working.

### Budget lock (BUDGETLOCK1)
Once `projects.budget_locked_at` is set, `original_budget` and `contract_value`
are frozen server-side; they move only through approved change orders. New
mutation paths on those columns must call `isProjectBudgetLocked`.

### Downloads
Every file download (PDF/CSV/text) goes through `src/lib/download-file.ts`.
Never hand-roll `URL.createObjectURL` + a synchronous `revokeObjectURL` — it
silently cancels downloads in Safari/iOS. The revoke must stay on a delay
(phase0-pinned).

### Graceful degradation before a migration
Agents don't apply migrations (a separate desk does). New-table code must
tolerate the table's absence — reads return empty, writes explain "not enabled
yet" — mirroring `exposure_allocations` / `daily_wip_entries`
(`isMissingRestRelation` / `isMissingDailyWipTable`).

### Validation gate (run before every billing/WIP change)
```
find . -name "*.tsbuildinfo" -delete
npx tsc --noEmit | grep -v onnxruntime-web        # must be clean
npx eslint <changed files>                        # 0 errors, 0 warnings
npm run smoke:phase0                              # source-pinned smokes
npm run test:billing                              # billing/payments math
npm run test:wip                                  # daily WIP math
npm run test:billing:aia                          # renders the AIA PDF
npm run build                                     # SSR/bundle
```

## Where to start reading, by task
- **Change how a bill is built** → `AiaApplicationStepper.tsx` +
  `aia-builder-steps.ts` + `billing.functions.ts`.
- **Change WIP / over-under math** → `wip.ts` (+ its consumers in
  `billing.functions.ts`).
- **Change the budget/job-cost math** → `budget-ledger.ts`.
- **Add or change a report** → `src/components/reports/` + the matching
  `listPortfolio*` server fn in `billing.functions.ts`.
- **Change daily WIP** → `daily-wip.ts` (math) + `daily-wip.functions.ts`
  (CRUD) + `DailyWipWorkspace.tsx` (UI).
- **Understand the intent** → [`../BILLINGDESIGN.md`](../BILLINGDESIGN.md) and
  this folder's [README](README.md).
