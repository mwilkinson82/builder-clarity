-- Payables approval lifecycle (field request, DB3T 2026-07-09): an invoice or
-- sub pay app lands as a DRAFT, gets marked APPROVED FOR PAYMENT, then PAID.
--
-- 1) cost_actuals gains 'draft' (logged but not vetted — must NOT move job cost)
--    and 'approved' (approved for payment — incurred cost, counts exactly like
--    'committed' does today). Plus who/when stamps for the approval trail.
-- 2) cost_actual_rollup_amount treats 'draft' like 'void' (contributes 0).
--    The existing bucket trigger handles every transition delta automatically.
-- 3) subcontract_payments gains a status lifecycle. Existing rows were recorded
--    as already-paid facts, so the column defaults/backfills to 'paid'.

ALTER TABLE public.cost_actuals
  DROP CONSTRAINT IF EXISTS cost_actuals_status_check;
ALTER TABLE public.cost_actuals
  ADD CONSTRAINT cost_actuals_status_check
    CHECK (status IN ('draft', 'committed', 'approved', 'paid', 'void'));

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;
ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id);
ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- A draft is an unvetted invoice — it must not move cost_buckets.actual_to_date.
-- Every other non-void status is incurred cost (committed/approved/paid behave
-- identically here, unchanged for existing rows).
CREATE OR REPLACE FUNCTION public.cost_actual_rollup_amount(p_status text, p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_status IN ('void', 'draft') THEN 0 ELSE COALESCE(p_amount, 0) END;
$$;

-- Sub pay apps: draft (sub submitted, logged) → approved (approved for payment)
-- → paid (money out; the only status the budget counts as actual cost).
ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'paid';
ALTER TABLE public.subcontract_payments
  DROP CONSTRAINT IF EXISTS subcontract_payments_status_check;
ALTER TABLE public.subcontract_payments
  ADD CONSTRAINT subcontract_payments_status_check
    CHECK (status IN ('draft', 'approved', 'paid'));
ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS approved_at timestamptz;

NOTIFY pgrst, 'reload schema';
