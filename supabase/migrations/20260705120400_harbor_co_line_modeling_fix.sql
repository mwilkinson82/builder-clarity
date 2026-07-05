-- GETTINGPAID3 Task 2: correct Harbor demo data that modeled change orders
-- as their own SOV lines instead of through the CO module.
--
-- Verified in code: generateBillingLineItems (via buildBillingLinesFrom
-- buckets) routes an approved, allocated change order into a line's
-- change_order_value_cents (G702 line 2) and never into scheduled_value_cents
-- (line 1). The flow is correct. The Harbor demo package showed CO-named SOV
-- lines with their value in scheduled_value_cents (folding into line 1) while
-- line 2 / the CO summary read $0 — a data problem, not a code problem.
--
-- This reclassifies any Harbor-demo billing line whose cost code marks it as a
-- change order (CO-...) so its value rides the change-order column instead of
-- the scheduled-value column: the value moves from G702 line 1 to line 2,
-- and column C (scheduled + CO) is unchanged, so the G703 grand total still
-- reconciles to line 4.
--
-- Guarded + idempotent: touches only the Harbor demo, only CO-coded lines
-- that still carry scheduled value, and no-ops on fresh installs (which never
-- had these rows) and on re-runs (scheduled_value_cents is 0 afterward).

UPDATE public.billing_line_items bli
SET
  change_order_value_cents = bli.scheduled_value_cents + bli.change_order_value_cents,
  scheduled_value_cents = 0
FROM public.projects p
WHERE bli.project_id = p.id
  AND (p.name = 'Harbor Residence' OR p.job_number = 'DEMO-HARBOR')
  AND bli.cost_code ~* '^CO-?[0-9]'
  AND bli.scheduled_value_cents > 0;
