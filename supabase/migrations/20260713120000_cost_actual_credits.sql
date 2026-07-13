-- Supplier credits & refunds on costs (field feedback 2026-07-13).
--
-- A material supplier can issue a credit memo — a negative-dollar "cost" that
-- gives money back (e.g. the White Cap credit invoice with a -$51.74 remaining
-- amount). The only thing stopping us from recording that as a negative cost
-- actual was the non-negative CHECK on cost_actuals.amount. Drop it.
--
-- Nothing else needs to change for the money to roll up correctly:
--   * cost_actual_rollup_amount(status, amount) already returns the signed amount
--     (0 only for 'void'/'draft'), so a credit subtracts from the code's actuals.
--   * tg_apply_cost_actual_to_bucket applies signed deltas on INSERT/UPDATE/DELETE.
--   * There is no CHECK forcing cost_buckets.actual_to_date >= 0, so a credit that
--     pushes a code's actuals down (even below zero) is allowed.
--
-- Portable: guarded with IF EXISTS so it no-ops where the constraint was never
-- created. The bulk-import path keeps its own positive-amount validation — this
-- only unblocks the manual "Add cost actual" credit/refund entry.

ALTER TABLE public.cost_actuals DROP CONSTRAINT IF EXISTS cost_actuals_amount_check;
