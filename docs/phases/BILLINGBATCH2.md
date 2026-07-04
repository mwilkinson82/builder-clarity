# BILLINGBATCH2.md — Payments That Misbehave (Claude Code task spec)

Read AGENTS.md. **Billing** agent territory. Branch: `billing/batch2`. An
estimating agent (AI takeoff) is active in parallel — stay out of estimating
and the new credits/ai modules. No migrations expected; flag loudly
otherwise. Every item is from tonight's live production QA.

## Task 0 — Refunds reverse the invoice (live bug: invoice 2601-3)
charge.refunded currently flips the payment_ledger row but leaves the
invoice untouched — 2601-3 is fully refunded yet still shows status paid,
paid_amount 1000. On refund: decrement the invoice's paid_amount by the
refunded amount (cents-safe), recompute status (paid → sent/open when a
balance reopens), update A/R. Handle partial refunds. Add a
reconcile-invoice-from-ledger server function (recomputes paid_amount/status
from the ledger's succeeded-minus-refunded truth) and use it in the webhook
path; after deploy the founder can trigger it on 2601-3 to correct the live
row through the honest code path — no manual SQL.

## Task 1 — Pay-button lock while a payment is pending (the double-collection class)
Live incident: a $708K ACH settled on Stripe while the invoice still showed
open, and a second $708K card payment was collected against the same
invoice. While an invoice has a Stripe payment in pending/processing state
(checkout session created and neither resolved nor expired), the client
surface replaces Pay buttons with "Payment processing — started {date}".
checkout.session.expired clears the lock. The contractor's invoice row shows
the same pending state.

## Task 2 — Unmatched-payment reconciliation (on demand)
A "Check Stripe for unmatched payments" action in Getting Paid: server
function lists recent payments on the org's connected account via the Stripe
API and flags any succeeded payment with no corresponding ledger row
(orphans like tonight's pre-subscription ACH). Results render as a simple
list with amount, date, Stripe id, and a "record to invoice…" affordance
that books it through the existing manual-record path with the stripe id as
reference. On-demand only for v1 — no cron.

## Task 3 — SOV edits: visible saves, honest rollups (live bug tonight)
Cost-bucket edits persist (verified in DB) but the page lies: group headers
and summary cards keep stale sums until reload, and mid-refetch the cell can
eat a second edit. On commit: recompute/invalidate every rollup on the page
(group headers, summary cards, IOR-facing forecast numbers), show a brief
saved-tick on the committed cell, and make in-flight edits survive refetch
(don't reset focused inputs). The founder must never again wonder whether a
save happened.

## Task 4 — Validate and ship
Gate + test:billing + unit tests (refund reversal full/partial,
reconcile-from-ledger math, pending-lock state machine, rollup recompute).
PR titled `Billing: refund reversal, pending lock, reconciliation, SOV save
feedback`. Commit this file to docs/phases/.
