# Phase 2: True IOR Model + Hold Guidance Engine

Move from typed forecast totals to a computed rollup driven by change orders and cost buckets, with conservative phase-sensitive hold guidance and a warning engine.

## Core philosophy (institutionalized in the app)
- Default posture is margin-protective.
- Forecasted Final Contract and Forecasted Final Cost are **derived**, never typed.
- Holds sit **below the line** against GP; they do not inflate Forecasted Final Cost.
- If the job is still exposed, the app assumes discipline before optimism.

## 1. Data model changes (one migration)

**`projects` table — remove typed totals, add phase**
- Drop: `forecasted_final_contract`, `forecasted_final_cost`, `approved_cos`, `pending_cos`
- Keep: `original_contract`, `original_cost_budget`, `schedule_variance_weeks`, review dates
- Add: `phase` enum (`Early` | `Middle` | `Late`), default `Early`
- Add: `percent_complete` numeric (PM-entered, used by guidance warnings)

**New table `change_orders`**
- `project_id`, `number` (text), `description`, `contract_amount`, `cost_amount`, `status` (`Approved`|`Pending`|`Denied`), `probability` (0–100, default 100), `owner`, `notes`

**New table `cost_buckets`** (six seeded per project: Sitework, Structure, MEP, Envelope, Finishes, GC/OH)
- `project_id`, `bucket` (text), `original_budget`, `actual_to_date`, `ftc`, `sort_order`

RLS: owner-via-project on both new tables, mirroring `holds`. Update `seed_demo_project` trigger and `seedDemoIfEmpty` server fn to populate buckets + COs for Harbor Residence.

## 2. Computed rollup (server-side in `getProject` / `listProjects`)

```
Forecasted Final Contract =
  Original Contract
  + Σ Approved CO contract_amount
  + Σ (Pending CO contract_amount × probability)

Forecasted Final Cost (before holds) =
  Σ bucket.actual_to_date
  + Σ bucket.ftc
  + Σ Approved CO cost_amount
  + Σ (Pending CO cost_amount × probability)

Forecasted GP Before Holds = FFContract − FFCost
Indicated GP = Forecasted GP Before Holds − ΣE-Holds − ΣC-Hold
```

KPI strip and Waterfall read these computed values; each line gets a tooltip showing the components.

## 3. Hold guidance engine (Conservative defaults)

Targets are % of **remaining cost** (= FFCost − Σ actual_to_date):
- Early phase: E 4% / C 3%
- Middle phase: E 3% / C 2.5% (only after buyout substantially complete + key selections locked — PM must advance phase manually)
- Late phase: E 2% / C 1.5% (only after finishes/millwork/long-leads resolved)

Each project shows guidance vs. actual. If actual < guidance, render warning chip and require a written justification on the project (`hold_variance_note` field on `projects`).

## 4. Warning engine (beyond percentages)

Surface a "Risks the system sees" panel on the project page when any of these fire:
1. Σ Pending CO cost_amount > $25k AND E-Holds < guidance target
2. Phase = Late AND any Finishes/Millwork bucket has `ftc > 0` AND C-Hold < guidance
3. `schedule_variance_weeks > 0` AND GC/OH bucket `ftc` increased since last review AND no new E-Hold added
4. Any bucket where `actual_to_date + ftc < original_budget × 0.95` AND `percent_complete > 50` (suspicious "savings" without justification)

Each warning is dismissible only with a note (stored in `risk_notes` table; out of scope for v1 — for now, just display).

## 5. UI changes

- **New tab: Change Orders** — table with inline add/edit/delete, status badges, probability slider for Pending.
- **New tab: Cost Buckets** — 6-row table, inline-edit `actual_to_date` and `ftc`, shows derived FAC and variance per bucket.
- **Edit Financials dialog** — strip to `name`, `client`, `original_contract`, `original_cost_budget`, `schedule_variance_weeks`, `phase`, `percent_complete`. Remove typed forecast fields.
- **KPI strip + Waterfall** — unchanged visual, but values come from rollup; tooltips expand "how this is calculated" with the component breakdown.
- **Holds panel** — add guidance vs. actual header with conservative target chips and warning state.
- **Portfolio cards** — show a small warning dot when any rule fires.

## 6. Demo seed update

Rewrite `seed_demo_project` and `seedDemoIfEmpty` so Harbor Residence seeds:
- 6 cost buckets summing to the original $2.72M budget with realistic FTC + actuals at ~60% complete
- 4 change orders (2 approved totaling $210k contract / $180k cost; 2 pending with probabilities)
- Same 6 holds as today
- `phase = Middle`, `percent_complete = 60`

Resulting computed FFContract / FFCost should land near the previous hardcoded $3.545M / $3.14M so the visuals stay recognizable.

## Out of scope for this pass
- Risk-note persistence and dismissal workflow (display-only warnings for now)
- Review history / PDF export (Phase 3)
- Multi-user roles / admin (later phase)

---

## Technical section

**Migration order:** add new tables + columns + grants + RLS first, backfill any existing project's buckets (single Harbor row, regenerate via trigger rewrite), then drop the obsolete columns.

**File changes:**
- `src/lib/projects.functions.ts` — extend `getProject` return shape; add `listChangeOrders`, `upsertChangeOrder`, `deleteChangeOrder`, `listBuckets`, `updateBucket`, `setProjectPhase`. Move rollup math into a shared `lib/ior.ts` pure helper so it can run both server-side and in the UI tooltips.
- `src/lib/ior.ts` — new pure module: `computeRollup({project, buckets, changeOrders, holds})`, `computeGuidance(phase, remainingCost)`, `evaluateWarnings(...)`.
- `src/components/outcome/ChangeOrdersTable.tsx` — replace placeholder with live editable table.
- `src/components/outcome/BuyoutTable.tsx` — repurpose into `CostBucketsTable.tsx` (live editable).
- `src/components/outcome/KpiStrip.tsx` + `OutcomeWaterfall.tsx` — accept new computed props + component breakdown for tooltips.
- `src/components/outcome/HoldsPanel.tsx` — add guidance header + warning chips.
- `src/routes/_authenticated/projects.$projectId.tsx` — wire new tabs, pass computed rollup down, render warnings panel.
- `src/routes/_authenticated/index.tsx` — show warning dot on cards.
