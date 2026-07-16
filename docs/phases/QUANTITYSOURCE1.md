# QUANTITYSOURCE1 — Estimate-wide quantity source review

## Outcome

The estimate worksheet exposes one read-only review queue for drawing quantities that cannot yet be
trusted. Stale takeoffs, unverified scales, legacy/manual-review takeoffs, and stale assembly output
links no longer remain hidden inside individual Plan Room records.

## Trust contract

- The queue derives from the existing RLS-readable takeoff, sheet, assembly-link, and estimate-line
  records. It creates no second task table and requires no migration.
- A source is current only when its stored database trust status is current.
- Scale changes, unverified scale, review-required takeoffs, and stale assemblies remain visibly
  blocked until the estimator opens the originating markup and uses the existing review workflow.
- Linked issues name their worksheet row. Unlinked issues say **Plan Room only** and do not imply an
  estimate impact.
- Selecting **Review markup** opens the immutable measurement id and its sheet. It does not
  recalculate, resync, relink, price, or change a quantity.
- The worksheet quantity badge warns when a currently takeoff-fed row has a non-current source.
- Environments waiting for the Plan Room trust migration continue loading the estimate without a
  false review queue.

## Release gate

1. Open Harbor and confirm the queue reports current drawing quantities separately from quantities
   needing review.
2. Confirm the known stale Crystal linear takeoff appears as **Scale changed**, says **Plan Room
   only**, and opens its exact markup.
3. On a disposable estimate, connect a stale takeoff to a worksheet row and confirm both the queue
   and quantity-cell badge warn without changing the row.
4. On a disposable stale assembly link, confirm the queue names the output, formula version, and
   worksheet row and opens the originating Assembly Workbench.
5. Confirm simply opening, filtering, or navigating the queue creates no AI operation, takeoff,
   assembly event, link event, or estimate change.
6. Delete all disposable QA data and confirm Harbor remains exactly `$1,606,136.70`.
