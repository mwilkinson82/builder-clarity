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
