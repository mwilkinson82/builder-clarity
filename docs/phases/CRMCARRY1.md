# CRMCARRY1 — Winning the job fills the project, it doesn't empty it

**Territory (AGENTS.md):** CRM (`src/lib/pipeline.functions.ts`) and the conversion seam into
Project/IOR. The change is a migration to the SECURITY DEFINER conversion function — **migration
to the desk; agents do not apply it.** Agents stop at PR-open.

Source: Overwatch product audit 2.1 (2026-07-05). The conversion function exists and is solid,
but it drops you into a project that is mostly empty. The win-the-job moment should *fill* the
project — most importantly, seed the IOR risk register (the methodology differentiator), which
the April note flagged as missing on estimate→project and which is equally missing here.

## Task 0 — Trace what conversion carries today
Confirmed against `convert_pipeline_opportunity_to_project`: it carries name, client,
project_manager (from `assigned_to`), `original_contract`/`original_cost_budget`, and
`source_opportunity_id`, and seeds **6 generic even-split cost buckets** (estimated_cost / 6).
It does **not** seed the IOR register. There is **no estimate/SOV FK on the opportunity**, so
there is no detailed SOV to carry beyond those generic buckets.

## Task 1 — Carry everything the win already knows
Client, PM, and contract/cost budget already transfer. No estimate/SOV link exists to carry.
The generic buckets remain the best available starting SOV. (No change required here beyond
what conversion already does.)

## Task 2 — Seed the IOR register with contingency
On conversion, seed an **award contingency C-Hold exposure** so the risk register is alive from
day one: 5% of contract at award (matching the estimating module's `contingency_pct` default),
clearly labeled as a starting reserve to refine. Founder-methodology default — review the % at
the desk.

## Task 3 — Reusable for the estimate→project seam
The IOR-seed logic is a standalone helper (`seed_project_award_contingency`) so the
estimate→project path can call the same logic later, rather than a conversion-only inline.

## Proof
Gate: eslint, phase0 (structural assertion on the migration), build. The migration cannot be
executed by the agent; desk applies it. Post-deploy QA: win + convert an opportunity, open the
new project's IOR register, confirm the award contingency reserve is present and sized at 5% of
contract.

---

## As built (2026-07-05, PR)

Delivered as a single migration: reusable SECURITY DEFINER helper
`seed_project_award_contingency(project_id, contract, pct=5)` (idempotent; skips if the reserve
exists; no-ops on zero contract; enum literals cast per the enum trap) + `CREATE OR REPLACE` of
the conversion function adding one `PERFORM` after bucket seeding. Atomic inside the conversion
transaction. Plus a phase0 structural assertion.

**Deliberately NOT built — client-contact carry.** `client_contacts` is an org rolodex;
attaching to a project needs a `project_client_access` row, which *is* the client-portal access
grant. Auto-creating it on conversion would silently grant portal access — a controls change we
won't make implicitly. Follow-up needs an explicit founder decision on portal-access behavior.
