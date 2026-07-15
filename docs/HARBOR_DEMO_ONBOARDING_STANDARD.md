# Harbor Residence onboarding standard

Harbor Residence is OverWatch's product walkthrough and acceptance fixture. It is not decorative sample data. A module is not demo-complete until a contractor can open Harbor Residence, understand why the module exists, perform its primary workflow, and see the result flow into the connected modules.

## Definition of demo-complete

Every new capability must include:

1. Realistic Harbor seed data using the same records and permissions as a live project.
2. A clear starting state, including unfinished work where decisions must still be made.
3. Enabled primary actions produced by valid prerequisites—not UI bypasses or demo-only permission exceptions.
4. At least one complete upstream-to-downstream workflow.
5. Idempotent top-up behavior that fills missing demo data without overwriting onboarding edits.
6. An archived Harbor project remains opted out and must never be recreated or topped up.
7. Focused acceptance coverage proving the seeded state activates the real workflow.

## Required module walkthroughs

- CRM: qualified opportunity becomes the Harbor project.
- Estimating: sample drawings, takeoff evidence, scope measurements, estimate review, and estimate-to-budget handoff.
- Budget/SOV: estimate and buyout values become cost and billing lines with visible markup.
- Subcontractors: buyout, cost-code allocation, compliance, change order, progress payment, and risk attribution.
- Daily Reports: superintendent records crews, people per crew, hours, installed quantities, progress, delays, and evidence.
- Daily WIP: PM reviews field progress, production, cost, earned value, and target performance.
- CPM Schedule: reviewed Daily WIP recommends progress; PM may accept it, keep CPM unchanged without explanation, or apply a different value with a note.
- Production Control: day/week/month trends, benchmark comparison, subcontractor and self-perform views, project rollup, and portfolio rollup.
- Billing: PM recommendation becomes a controlled handoff to the accounting-oriented billing workspace; certification remains explicit.
- IOR/Risk: actual incurred cost, subcontract commitment, schedule effect, recovery path, and portfolio visibility remain connected but distinct.
- Procurement, RFIs, submittals, inspections, claims, files, client portal, payments, and reports: each needs a Harbor scenario that demonstrates its real operating loop.

## Current acceptance slice

The Daily WIP-to-CPM walkthrough uses the active `09-020 Drywall hang and finish` activity. CPM begins at 40%; PM-reviewed Harbor Daily WIP recommends 52%. This produces a meaningful choice among accept, keep, and override while preserving the same evidence gate used by customer projects.

## Versioned demo engine

Harbor is a per-company working copy of canonical fixture definitions stored in application code. Clicking, editing, or completing work in one company's Harbor project never changes the canonical fixture or another company's copy.

The engine manages one version per operational module in dependency order. The registry now covers:

1. Project foundation and demo identity.
2. Budget and owner SOV.
3. IOR commercial position and Risk Tally.
4. Subcontract buyouts, cost-code allocations, production benchmarks, a paid progress application, and risk-linked subcontract change order.
5. CPM schedule.
6. Daily Reports and three days of connected electrical Daily WIP.
7. Reviewed Daily WIP-to-CPM evidence.
8. Production-control prerequisites and target-rate evidence.
9. A line-level draft billing workspace ready for a PM-certified position.
10. Inspections.
11. Claims and the claim-cycle history.

## Canonical commercial walkthrough

Harbor's commercial lesson is one connected operating chain, not a collection of sample cards:

1. **Budget/SOV:** six cost codes carry both cost budget and owner-facing contract value. The total SOV is the project's original $3.2 million contract; approved change-order value remains separate.
2. **Subcontractors:** Electrical, Concrete, and Drywall buyouts land on their actual cost codes. Each allocation includes a planned production quantity, unit, and the GC's $110 labor-equivalent benchmark.
3. **Payables and risk:** Concrete includes a paid $20,000 progress application with a $2,000 retainage hold and explicit Structure allocation. Drywall includes an $8,000 subcontract change order linked to the Weak drywall subcontractor Risk Tally item.
4. **Daily Reports:** July 11–13 reports record the electrical crews, two people per crew, eight hours per person, narratives, quality, safety, and delays.
5. **Daily WIP:** those same field records carry installed conduit, wire, and junction-box quantities against the MEP SOV line and electrical subcontractor. The selected production measure is LF of conduit per labor-hour, with a 7.5 LF/labor-hour target.
6. **Production Control:** the three-day series produces real day/week/month and subcontractor trend evidence. Production prerequisites are seeded, but management decisions remain live actions.
7. **PM certification:** the PM reviews the production evidence and may certify or adjust the recommended MEP SOV completion position. Harbor does not auto-certify it.
8. **Billing:** `Pay App 2 — Draft` contains all six G703/SOV lines. Accounting may apply the latest PM certification to the matching MEP line, then continue its normal draft, review, submission, invoice, and collection workflow. Harbor does not auto-apply, submit, or approve billing.
9. **IOR:** budget movement, actual cost, subcontract commitment, risk exposure, billing position, and schedule effect remain connected but distinct in the project and portfolio rollups.

The initial state intentionally stops before PM certification and accounting application. That makes both roles' real controls available during onboarding while preserving the operating boundary: the PM recommends what is ready to bill; accounting owns the billing instrument and its lifecycle.

An **ensure** run is non-destructive. It fills missing stable demo records and records the module version only after the adapter succeeds. It must not overwrite a contractor's walkthrough edits merely because the project was opened again.

A **reset** run is explicit and destructive only to stable demo-owned records for the selected module. The current reset API restores dependencies first, rewrites canonical records by deterministic activity ID, record ID, or seed key, and leaves user-created/non-demo records untouched. The Start Here shell may expose Reset lesson only for a registered module with focused acceptance coverage.

The database registry is `demo_seed_module_versions`. It stores the applied version and latest result for each Harbor project copy. It is protected by the same `can_read_project` and `can_manage_project` rules as the project itself. The canonical fixture is never stored in that table.

## Onboarding build order

The Start Here shell follows the core project-management workflows first: project controls, budget/SOV, subcontractors, Daily Reports, Daily WIP, CPM, production, billing, IOR/risk, procurement, inspections, claims, and closeout records. Estimating remains a product-development sandbox and does not enter guided onboarding until its workflow and sample drawings are stable.
