# SUBCONTRACTORS — subs get a home, the PM gets a view, billing gets its payable side

**Territory (AGENTS.md):** new `subcontractors` / `subcontracts` tables + a
Subcontractors project tab, an org-level directory, the `cost_actuals` payable
link, the budget/SOV ledger, `daily_wip_entries`, tests. Migrations → the
migration desk. Agents stop at PR-open; each slice is its own PR.

Founder design conversation, 2026-07-07. Working name **"Subcontractors"** —
🚩 *founder to confirm the tab label (Subcontractors / Subs / Trade Partners /
Vendors).*

---

## The problem (founder-identified 2026-07-07)

> A sub calls the PM: *"Hey man, you gotta do X, Y."* The PM **has no idea if
> that sub has been paid** — because payment lives in accounting and there's no
> view on it. He should have a view. And a GC's SOV is mostly scope performed by
> subs; subs have tentacles into billing on both sides.

General contractors (and self-performers on occasion) run everything through
subcontractors. Today Overwatch has **no home for a subcontractor** — you can't
load your subs, you can't attach their executed contract, and the PM can't see
what they've been paid. That's the gap.

## What we're building (founder's words, translated)

Three objects and one tie-in:

1. **Subcontractor directory** (company-level, reusable). Load your subs once;
   pick from a **dropdown** on any job instead of retyping the name. Name,
   trade, contact.
2. **Subcontract** (per job). Pick the sub, enter **contract value** + **scope**,
   **upload the executed contract** (the proposal is part of it, so the scope of
   work rides along in the PDF), and link it to the **cost code(s)** it covers.
3. **Sub payment status** (the PM's answer). Invoiced-to-date, paid-to-date,
   retainage held — per sub. Accounting records it; the **PM sees it**.
4. **Daily WIP → subcontractor tie-in.** A daily WIP entry can name the sub (it
   already links to an SOV line via cost code). That accrues **production rates
   and cost data per sub** over the job — you learn which subs actually perform.

## Founder decisions already made (2026-07-07)

- **v1 scope = directory + subcontracts + a paid/unpaid view.** Payment
  visibility is the whole point, so it's in the first cut (delivered across
  Slice 1 → Slice 2, below).
- **A subcontract informs the cost-code budget.** The sub's price *is* the GC's
  cost for that scope, so it flows into that code's budget (see "Buyout" below).
- Daily WIP entries should tie to a subcontractor (Slice 3).

## The load-bearing insight: the payable side mostly exists

`public.cost_actuals` already carries `category: 'subcontract'`, `vendor`,
`reference_number`, `amount`, `status: committed | paid | void`, `cost_date`,
and `cost_bucket_id`. **A sub invoice is already a cost actual.** What's missing
is (a) a *structured* subcontractor to link it to instead of a free-text vendor,
and (b) a PM-facing view that reads them back per sub. So the payment tracking is
mostly a **read** over existing data + a link, not a new ledger. Reuse it; don't
rebuild it.

Reused patterns:
- **Directory** mirrors `cost_library_items` (org-scoped, reusable across
  projects, RLS by organization).
- **Executed-contract upload** mirrors daily reports
  (`supabase.storage.from('subcontracts').upload(...)` + an attachment manifest).
- **Subcontract → cost-code allocation** mirrors `change_order_allocations` /
  `exposure_allocations` (a splittable amount per cost bucket; a sub can cover
  more than one code, and a code can be split across subs / self-perform).

## The model & tables (migrations → desk)

### `subcontractors` (org directory)
```
id uuid pk
organization_id uuid  -> organizations(id)   -- reusable across the org's jobs
name text not null
trade text            -- e.g. "Concrete", "Electrical" (CSI-friendly)
contact_name text, contact_email text, contact_phone text
notes text
created_at, updated_at
-- RLS: org members read/manage (mirror cost_library_items).
```

### `subcontracts` (per project)
```
id uuid pk
project_id uuid  -> projects(id) on delete cascade
subcontractor_id uuid -> subcontractors(id)
title text            -- e.g. "Concrete — foundations & flatwork"
scope text            -- free text; the executed PDF holds the authoritative scope
contract_value numeric not null default 0   -- what the GC pays the sub (the GC's cost)
status text           -- 'draft' | 'executed'
executed_at date
-- executed contract PDF via storage + a manifest column (mirror daily_reports
--   attachment_manifest / attachment_path / attachment_type).
attachment_manifest jsonb, attachment_path text, attachment_type text, attachment_name text
created_at, updated_at
-- RLS: can_read/can_manage_project.
```

### `subcontract_allocations` (subcontract → cost code, splittable)
```
id uuid pk
project_id uuid, subcontract_id uuid, cost_bucket_id uuid, cost_code text
amount numeric not null default 0   -- portion of contract_value on this code
-- mirror change_order_allocations exactly (shape, RLS, trigger).
```

### Extend the payable link
- `cost_actuals` gains `subcontractor_id uuid null` (+ optionally
  `subcontract_id uuid null`) so a sub invoice ties to the structured sub, not
  just a vendor string. The PM view reads `cost_actuals` where
  `subcontractor_id = …` (or `category = 'subcontract'`).

### Daily WIP tie-in
- `daily_wip_entries` gains `subcontractor_id uuid null` (it already has
  `cost_bucket_id`). Production rate per sub falls out of the existing
  `quantity ÷ labor-hours` (or a sub-progress measure) grouped by sub.

## The tentacles into billing

- **Budget (cost) — "Buyout."** A subcontract allocation to a cost code is the
  GC's *real* committed cost for that scope. The estimate was a guess; the
  subcontract is the number. So the ledger's **budget** for a subbed code =
  self-perform portion **+ Σ subcontract allocations** (layered like approved-CO
  cost already is in `computeBudgetLedger`). Owner SOV − sub contract = **the
  GC's margin on that sub** — the exact contract-vs-budget model from
  BUDGETVSCONTRACT1.
  - 🚩 **Founder decision — buyout vs the lock (BUDGETLOCK1).** Options:
    (a) a subcontract allocation *updates* the locked budget for its code
    (buyout is a legitimate budget mover, like a CO); or (b) buyout must happen
    before lock / only pre-lock. Recommend (a): buyout is exactly the kind of
    real-cost event the budget should reflect, so allow it to move a locked
    budget the way an approved CO does, with an audit trail.
- **Payable / AP (new view).** Overwatch tracks *receivables* (what the owner
  pays the GC) today. This adds the first *payable* view: per sub, invoiced /
  paid / retainage held, from `cost_actuals`. This is the PM's answer to the
  phone call.
- **Daily WIP.** Per-sub production and cost data.

## Slices (each its own PR; each needs a migration → desk)

- **Slice 1 — Subs exist.** `subcontractors` directory (org) +
  `subcontracts` (project) + `subcontract_allocations`. New **Subcontractors
  tab**: add/pick a sub from the directory, enter contract value + scope, upload
  the executed contract, link cost code(s). Buyout: allocations feed the
  cost-code budget (per the founder decision above).
- **Slice 2 — The PM sees payment.** `cost_actuals.subcontractor_id` link + the
  per-sub payment view: invoiced-to-date, paid-to-date, retainage held. Reads
  existing cost actuals; accounting records payments, the PM sees them. *This is
  the pain-killer — lands right after Slice 1.*
- **Slice 3 — Daily WIP × subs.** `daily_wip_entries.subcontractor_id` + a sub
  picker on the Daily WIP entry; per-sub production/cost rollups.
- **Later** — sub change orders, sub lien waivers, QB sync of sub payments
  (payables side of the existing "QB is the books, Overwatch is the truth, sync
  later" principle).

## Decisions for the founder (flag in each PR, don't guess)

1. **Tab name:** Subcontractors / Subs / Trade Partners / Vendors?
2. **Buyout vs the budget lock:** does a subcontract allocation move a *locked*
   budget (recommended), or must buyout precede the lock?
3. **Sub retainage:** GCs often hold retainage *from* subs (mirror of what the
   owner holds from the GC). In scope for Slice 2's view, or later?
4. **Directory sharing:** subcontractors are org-level (shared across the
   company's jobs). Confirm — vs per-project.

## Proof (per slice)
- Migrations idempotent, guarded, to the desk. Node smoke for any money math
  (subcontract allocation → budget; per-sub invoiced/paid rollups; production
  rate per sub), cents-safe. Graceful degradation before each migration lands
  (reads empty, writes explain "not enabled yet") — mirror
  `exposure_allocations` / `daily_wip_entries`.
- Gate: tsc, eslint, phase0 (+ pins), the billing/budget smokes, build.
- QA in the PR body: on the demo, add a sub, attach a contract, allocate it to a
  cost code, watch the budget reflect the buyout and the margin fall out; record
  a sub payment and see it on the PM view.

## Why this is worth a real arc
It closes the one thing a GC's PM can't do today — *see whether a sub got paid* —
and it completes the money model: Overwatch already knows what the **owner** owes
**you** (receivables); this adds what **you** owe your **subs** (payables), on
the same cost-code spine, with the buyout feeding the budget we just built.
