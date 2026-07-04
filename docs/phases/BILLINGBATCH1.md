# BILLINGBATCH1.md — Founder QA Findings (Claude Code task spec)

Read AGENTS.md. **Billing** agent, billing/invoicing territory only. Branch:
`billing/batch1-qa-findings`. No migrations expected; flag loudly otherwise.

Every item below is from the founder's live payments QA (July 3, evening),
walking the money path with the database verified at each step. These are
surgical fixes — the deeper billing redesign (WIP tooling, accounting-space
review) is a separate, founder-led design phase. Do not expand scope.

## Task 0 — Cents-safe money derivation (the penny bug)
Live finding: invoice 2601-001 was created with total_due = 1,908,224.99
when the pay application intends 1,908,225.00 — fractional-cent drift from
floating-point math in the pay-app/SOV percent-complete rollup, inherited by
the invoice. The payment path downstream is penny-exact (verified); the
DERIVATION is the defect.
- Audit every money computation from SOV lines / percent complete through
  pay application totals to invoice total_due. Route them through integer
  cents (the payments-domain module's math or equivalent): round at each
  LINE first, sum in cents, never sum floats.
- Regression test with the live case's shape: scheduled values x percent
  complete across many lines must sum to the intended whole-dollar total.
- Do not silently alter existing stored invoice amounts; note in the PR that
  historical rows keep their values (correcting live invoices is a founder
  decision).

## Task 1 — Show the cents
UI money displays across billing round to whole dollars, which HID the penny
drift. Billing surfaces (invoice totals, paid, open, A/R, pay app rollups)
display cents. Compact stat cards may keep whole-dollar style ONLY where the
underlying value is verified whole; when in doubt, show cents. Drift must
never be able to hide behind rounding again.

## Task 2 — Remove the payment vestiges (founder-identified)
Three legacy surfaces from the pre-Phase-1 Stripe era now contradict the
shipped design:
- "Finish payment setup" affordance in Billing — remove; setup lives in
  Getting Paid.
- Per-invoice "Enable online pay" button — remove; the payment-method
  toggles in the Send flow are the real control.
- The "Client payment readiness" banner reads a STALE status source: it
  still said "online pay links unlock after Stripe Connect is finished" an
  hour after Connect was active. Rewire it to the live connect status
  (stripe_connect_status) or remove it in favor of the Getting Paid status
  card. No surface may report payment readiness from anywhere except the
  live status.

## Task 3 — Validate and ship
Gate + test:billing + new unit tests (line-first cents rollup, drift
regression). PR titled `Billing: cents-exact derivation + vestige removal`.
Commit this file to docs/phases/.
