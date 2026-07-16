# ESTIMATEREVIEW1 — Deterministic estimate review gate

## Outcome

The estimate workspace opens with one honest review gate for saved worksheet and drawing-source
conditions that can be checked deterministically before a bid advances.

## Trust contract

- A stale or unverified drawing source blocks the gate only when it feeds a worksheet row.
- A nonzero worksheet row with no material or labor unit cost is blocking.
- Zero-quantity rows are follow-ups, not automatic errors; an allowance can intentionally remain at
  zero until the estimator confirms it.
- A flagged Plan Room quantity that does not feed the worksheet is a follow-up, not an asserted bid
  impact.
- The gate is derived from the existing estimate rows and quantity-source review. It writes nothing
  and requires no database migration.
- The gate never claims that AI certified scope completeness, price accuracy, subcontractor
  coverage, or readiness to submit. Human sign-off remains required.

## Release gate

1. Open Harbor and confirm the gate reports zero linked quantity blockers, five zero-quantity
   follow-ups, and one Plan Room-only follow-up.
2. Confirm the saved stale Crystal quantity does not appear as a worksheet blocker because it is
   unlinked.
3. On a disposable estimate, confirm a linked stale takeoff and an active unpriced row each count as
   a blocker.
4. Confirm **Review worksheet** moves to the line-item grid and **Open Plan Room** enters the existing
   evidence workflow.
5. Confirm opening or navigating the gate creates no AI operation, takeoff, link, event, estimate
   change, or credit charge.
6. Delete disposable data and confirm Harbor remains exactly `$1,606,136.70`.
