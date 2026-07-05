-- Backfill cost codes onto billing artifacts from their parent SOV line.
--
-- Cost codes live on cost_buckets (the SOV lines). Billing line items, the
-- cost-actuals ledger, and change-order allocations each carry their own
-- cost_code, stamped from the bucket at creation time. Rows created BEFORE a
-- bucket had a code froze blank (e.g. the Harbor demo: buckets were coded
-- after its pay apps and sample cost actuals were generated), so billing and
-- the cost ledger read "No code" even though the SOV line is coded.
--
-- This mirrors each row's code from its own bucket. Fully guarded:
--   * only fills BLANK codes — never overwrites a code the user set,
--   * only when the linked bucket actually HAS a code,
--   * no-op on every environment where the data is already coherent.
--
-- Global by design (not demo-scoped): any real project whose lines were coded
-- after billing was generated gets the same repair. cost_actuals has an
-- actual_to_date rollup trigger, but changing only cost_code leaves amount,
-- status, and cost_bucket_id untouched, so the trigger nets zero.

-- Billing line items (the per-application SOV rows shown in billing).
UPDATE public.billing_line_items li
SET cost_code = cb.cost_code
FROM public.cost_buckets cb
WHERE li.cost_bucket_id = cb.id
  AND COALESCE(NULLIF(TRIM(li.cost_code), ''), '') = ''
  AND COALESCE(NULLIF(TRIM(cb.cost_code), ''), '') <> '';

-- Cost-actuals ledger (job-cost backup shown in the Cost Ledger tab).
UPDATE public.cost_actuals ca
SET cost_code = cb.cost_code
FROM public.cost_buckets cb
WHERE ca.cost_bucket_id = cb.id
  AND COALESCE(NULLIF(TRIM(ca.cost_code), ''), '') = ''
  AND COALESCE(NULLIF(TRIM(cb.cost_code), ''), '') <> '';

-- Change-order allocations (defensive — allocateChangeOrder already stamps
-- the bucket's code, but any pre-existing blank rows get repaired too).
UPDATE public.change_order_allocations coa
SET cost_code = cb.cost_code
FROM public.cost_buckets cb
WHERE coa.cost_bucket_id = cb.id
  AND COALESCE(NULLIF(TRIM(coa.cost_code), ''), '') = ''
  AND COALESCE(NULLIF(TRIM(cb.cost_code), ''), '') <> '';
