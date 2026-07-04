# GETTINGPAID1.md — The Biller's Cockpit (Claude Code task spec)

Read AGENTS.md and docs/BILLINGDESIGN.md (committed alongside this spec — it
is the authoritative design record; honor its dependency rule and scope
lines). **Billing** agent territory. Branch: `billing/getting-paid-1`. Run
AFTER billing/batch2 merges. Migrations possible (invoice send/view
tracking); file-only, flagged loudly, applied via protocol before merge.
Commit BOTH this file and BILLINGDESIGN.md to docs/.

This phase builds Workspace A for the person who bills for a living. No WIP,
no PM features — that is a later phase by founder decision.

## Task 0 — The receivables cockpit
The billing home for a company (and per project) becomes a working
receivables view:
- Every open invoice as a row: number, project, client recipients, amount,
  paid, open, due date, and the number that runs her day — days until due
  (or DAYS OVERDUE, visually loud past due).
- Aging buckets: Current / 1-30 / 31-60 / 61-90 / 90+, as summary cards
  that filter the list. Totals per bucket.
- Status chain per invoice: sent (when, to whom), paid (when, how,
  reference). If a lightweight viewed signal is feasible via the client
  portal (portal open recorded server-side), include it; do not build email
  open-tracking pixels.
- Collections cue: past a configurable overdue threshold (default 15 days)
  the row carries a "start collections" flag; a per-invoice note field logs
  collection activity (called 7/12, promised payment...). Simple text log,
  no CRM machinery.
- Payment activity feed: recorded and Stripe payments land as feed entries
  ("$23,858.27 received on 2601-4 · card · Jul 8") with an unread badge on
  the billing nav. In-app only; email notifications belong to the future
  notifications module.

## Task 1 — AIA G702/G703 to lender grade
A G702-style replica already exists in the app — find it and finish it.
Standard: an owner's rep or lender accepts it without comment.
- G702 face: application + certificate fields complete (original contract
  sum, net change by COs, contract sum to date, total completed and stored,
  retainage split [completed work vs stored material], total earned less
  retainage, less previous certificates, current payment due, balance to
  finish), signature/notary blocks laid out even where signing is manual.
- G703 continuation: the full column set (item, description, scheduled
  value, from previous application, this period, materials stored, total
  completed and stored, %, balance to finish, retainage), penny-exact via
  the payments-domain cents math, totals row reconciling to the G702 face.
- Print/PDF quality to the CPM one-pager standard: fits standard pages,
  repeats headers on continuation pages, no orphan rows (reuse the print
  pagination lessons).
- Application builder gains an explicit output choice: Invoice or AIA
  G702/G703 (companies that never use AIA never see AIA fields beyond the
  choice).

## Task 2 — Change orders in the billing flow
Approved COs carry their own billed-percent through applications (the
existing allocation model), visible in the cockpit: each approved CO shows
value, allocated-to-code status, billed to date, remaining. An unallocated
approved CO surfaces as a nudge ("CO-002 approved $45,000 — allocate to a
cost code to bill it"), reusing existing allocation flows.

## Task 3 — Validate and ship
Gate + test:billing + unit tests (aging bucket math incl. boundary days,
overdue day counts across months, G703 column arithmetic and totals
reconciliation, collections threshold). Print-to-PDF fixture check for the
G702/G703 at letter size. PR titled `Billing: the biller's cockpit
(Getting Paid 1)`. Founder QA: build one AIA application on Harbor and hold
the printed G702/G703 to the light.
