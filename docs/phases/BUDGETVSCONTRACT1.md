# BUDGETVSCONTRACT1 — Budget and contract value are two numbers, and the delta is margin

**Territory (AGENTS.md):** `supabase/migrations/**` (one migration → desk), the SOV/budget ledger and Job Cost components, `cost_buckets` read/write path, estimate→project and CRM→project carry, tests. Agents stop at PR-open. Migration to the migration desk before merge.

---

## The problem (founder-identified 2026-07-06, code-confirmed)

At the **project** level Overwatch correctly separates the two numbers: `projects.original_contract` (what the client pays) and `projects.original_cost_budget` (what we drive the job on). Verified in `convert_pipeline_opportunity_to_project` — it seeds both from the opportunity.

At the **line** level it does NOT. `cost_buckets` has `original_budget` but **no contract-value column.** So any SOV/ledger view that needs per-line contract value has nowhere to read it and is being forced to reuse `original_budget` — making budget and contract value identical per line, which collapses the delta to zero. **That delta is the margin.** Without a distinct line-level contract value, the ledger cannot show profit per SOV line, which defeats the At-Risk / margin ledger work (BUDGETENGINE, exposure_allocations).

Founder's framing, verbatim, is the acceptance test: *"the budget is what we drive the job on. The contract's what they pay us. The difference between the two, the delta, is our profit. The budget and the contract value can't be the same."*

## The model to implement

Each SOV line (`cost_buckets` row) carries BOTH, independently:
- **`contract_value`** — the billable value of this line (what the owner pays for this scope). This is the SOV amount the client sees / bills against.
- **`original_budget`** — the internal cost budget for this scope (what we expect it to cost us). Already exists.
- **Line margin = `contract_value − original_budget`** (dollars) and `/ contract_value` (percent). This is the number that makes the ledger a profit tool instead of a cost tracker.

Roll-up: project contract value = Σ line `contract_value` (should reconcile to `projects.original_contract`); project budget = Σ line `original_budget` (reconciles to `projects.original_cost_budget`).

## Task 0 — Migration (to the desk)

- `ALTER TABLE public.cost_buckets ADD COLUMN IF NOT EXISTS contract_value numeric NOT NULL DEFAULT 0;` with `CHECK (contract_value >= 0)` guarded idempotently, and a COMMENT explaining it's the billable value of the line, distinct from `original_budget` (internal cost).
- **Backfill decision (founder must confirm — flag in PR, do not guess):** existing `cost_buckets` rows have only budget. Options: (a) leave `contract_value = 0` and surface an "unpriced line" state in the ledger until the user enters it; (b) seed `contract_value = original_budget` as a starting point (WRONG per founder — that recreates the exact zero-margin bug, so only if explicitly chosen); (c) for demo/seed projects only, set a realistic contract_value > budget so the ledger shows positive margin. **Recommend (a) for real data + (c) for the demo seed.** The migration ships the demo-seed values; real-data backfill is a founder call routed to the desk.
- Interaction with BUDGETLOCK1: locking freezes the **budget** baseline. `contract_value` is the SOV/billing side — decide and document whether it locks on the same `budget_locked_at` event or is independently editable (contract value changes via approved COs too, so likely mirrors the budget-lock rule: frozen original + approved CO contract_amount layered on). Keep consistent with how `change_order_allocations.contract_amount` vs `.cost_amount` already split.

## Task 1 — Ledger shows both + the delta

- The SOV/budget ledger and Job Cost report render, per line: **Contract Value | Budget | Cost-to-date | Margin ($ and %)**. Margin is derived, never stored (same discipline as AIA cents and daily-WIP labor).
- Any line where `contract_value = 0` (unpriced) renders in a distinct "needs contract value" state, not as $0 margin — so an unpriced line can't masquerade as a zero-profit line.
- The CO layer already tracks `contract_amount` vs `cost_amount` separately in `change_order_allocations` — the ledger's Contract Value and Budget columns each inherit their own CO layer (contract_amount onto contract_value, cost_amount onto budget), so an approved CO moves both sides correctly and the delta reflects the CO's own margin.

## Task 2 — Entry + carry

- SOV line entry captures contract_value and budget as two fields, clearly labeled ("Contract value — what the client pays" / "Budget — what we expect it to cost").
- estimate→project and CRM→project carry must populate line-level contract_value where the source has it (estimate line pricing), not just budget. If the source only has a lump contract value, distribute or leave lines unpriced per Task 1's unpriced state — founder call, flag it.

## Task 3 — Proof

- Migration idempotent, guarded, to the desk. Unit: line margin math ($ and %), roll-up reconciliation (Σ line contract_value = project contract; Σ budget = project budget) within cents tolerance. Fixture: a project where contract ≠ budget per line asserts a non-zero, correct margin per line and in total. Regression: an unpriced line (contract_value=0) never reports as zero-margin — it reports unpriced.
- Gate: eslint, tsc, phase0, billing tests, build, bun frozen-lockfile. QA in PR body: on a demo project, ledger shows Contract | Budget | Margin per line with a real positive delta that reconciles to the project-level contract-minus-budget.

## Why this is worth stopping for
Every downstream margin feature — At Risk, contingency, WIP profitability, the "indicated profit any given day" promise — is only true if per-line contract and budget are distinct. Building more on a schema where they're the same column means every margin number is silently zero or wrong. This is the foundation the rest of the billing/IOR ledger stands on.
