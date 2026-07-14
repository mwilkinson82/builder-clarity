-- Correct the July 14 field workflow in two places:
--
-- 1. A recognized DIRECT cost consumes the cost code's remaining Open forecast.
--    Drafts do nothing; voiding/restaging restores the exact amount previously
--    consumed. The stored relief makes amount edits and cost-code moves fully
--    reversible. Costs historically linked to a subcontract commitment keep
--    using the subcontract ledger's committed-minus-paid calculation instead,
--    so they are not relieved twice.
--
-- 2. Subcontract change orders and progress payments link DIRECTLY to a risk
--    tally item. A CO is committed exposure; only a paid progress payment is
--    actual incurred cost. This keeps subcontract accounting in the
--    Subcontractors workspace rather than routing it through Add Cost.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS budget_open_relief numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.cost_actuals.budget_open_relief IS
  'Signed amount of cost_buckets.ftc automatically consumed by this recognized direct cost; restored on void/delete/move.';

ALTER TABLE public.cost_actuals
  DROP CONSTRAINT IF EXISTS cost_actuals_budget_open_relief_check;
ALTER TABLE public.cost_actuals
  ADD CONSTRAINT cost_actuals_budget_open_relief_check
    CHECK (abs(budget_open_relief) <= abs(amount));

ALTER TABLE public.subcontract_change_orders
  ADD COLUMN IF NOT EXISTS exposure_id uuid;
ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS exposure_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subcontract_change_orders_exposure_id_fkey'
      AND conrelid = 'public.subcontract_change_orders'::regclass
  ) THEN
    ALTER TABLE public.subcontract_change_orders
      ADD CONSTRAINT subcontract_change_orders_exposure_id_fkey
      FOREIGN KEY (exposure_id) REFERENCES public.exposures(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subcontract_payments_exposure_id_fkey'
      AND conrelid = 'public.subcontract_payments'::regclass
  ) THEN
    ALTER TABLE public.subcontract_payments
      ADD CONSTRAINT subcontract_payments_exposure_id_fkey
      FOREIGN KEY (exposure_id) REFERENCES public.exposures(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS subcontract_change_orders_exposure_idx
  ON public.subcontract_change_orders (exposure_id)
  WHERE exposure_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS subcontract_payments_exposure_idx
  ON public.subcontract_payments (exposure_id)
  WHERE exposure_id IS NOT NULL;

COMMENT ON COLUMN public.subcontract_change_orders.exposure_id IS
  'Optional Risk Tally attribution for this subcontract commitment.';
COMMENT ON COLUMN public.subcontract_payments.exposure_id IS
  'Optional Risk Tally attribution; paid rows count as actual incurred on the risk.';

-- Keep the attribution inside the same project even if a caller bypasses the
-- application server. This is both an accounting invariant and a BOLA guard.
CREATE OR REPLACE FUNCTION public.tg_validate_subcontract_exposure_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.exposure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.exposures
    WHERE id = NEW.exposure_id
      AND project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'Risk Tally item must belong to the same project.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subcontract_change_orders_validate_exposure_project
  ON public.subcontract_change_orders;
CREATE TRIGGER subcontract_change_orders_validate_exposure_project
  BEFORE INSERT OR UPDATE OF exposure_id, project_id
  ON public.subcontract_change_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_subcontract_exposure_project();

DROP TRIGGER IF EXISTS subcontract_payments_validate_exposure_project
  ON public.subcontract_payments;
CREATE TRIGGER subcontract_payments_validate_exposure_project
  BEFORE INSERT OR UPDATE OF exposure_id, project_id
  ON public.subcontract_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_subcontract_exposure_project();

-- Prepare a recognized cost's reversible relief before the existing rollup
-- trigger updates its bucket. SELECT ... FOR UPDATE serializes simultaneous
-- costs on the same code so two invoices cannot consume the same Open dollars.
CREATE OR REPLACE FUNCTION public.tg_prepare_cost_actual_open_relief()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  available_open numeric := 0;
  restored_old_relief numeric := 0;
BEGIN
  IF NEW.cost_bucket_id IS NULL
     OR NEW.status IN ('draft', 'void')
     OR NEW.subcontract_change_order_id IS NOT NULL
     OR NEW.subcontract_payment_id IS NOT NULL THEN
    NEW.budget_open_relief := 0;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.cost_bucket_id IS NOT DISTINCT FROM NEW.cost_bucket_id THEN
    restored_old_relief := COALESCE(OLD.budget_open_relief, 0);
  END IF;

  SELECT GREATEST(0, COALESCE(ftc, 0) + restored_old_relief)
    INTO available_open
  FROM public.cost_buckets
  WHERE id = NEW.cost_bucket_id
  FOR UPDATE;

  IF NOT FOUND THEN
    NEW.budget_open_relief := 0;
    RETURN NEW;
  END IF;

  NEW.budget_open_relief := CASE
    WHEN COALESCE(NEW.amount, 0) >= 0
      THEN LEAST(COALESCE(NEW.amount, 0), available_open)
    ELSE COALESCE(NEW.amount, 0)
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_prepare_open_relief_insert ON public.cost_actuals;
CREATE TRIGGER cost_actuals_prepare_open_relief_insert
  BEFORE INSERT ON public.cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.tg_prepare_cost_actual_open_relief();

DROP TRIGGER IF EXISTS cost_actuals_prepare_open_relief_update ON public.cost_actuals;
CREATE TRIGGER cost_actuals_prepare_open_relief_update
  BEFORE UPDATE OF amount, status, cost_bucket_id,
    subcontract_change_order_id, subcontract_payment_id
  ON public.cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.tg_prepare_cost_actual_open_relief();

-- Extend the established actual-to-date rollup with the matching Open movement.
-- The old relief is restored before the new relief is applied, which makes every
-- status transition, amount edit, bucket move, void, and delete symmetric.
CREATE OR REPLACE FUNCTION public.tg_apply_cost_actual_to_bucket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  old_amount numeric := 0;
  new_amount numeric := 0;
  old_relief numeric := 0;
  new_relief numeric := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_bucket_id IS NOT NULL THEN
      new_amount := public.cost_actual_rollup_amount(NEW.status, NEW.amount);
      new_relief := COALESCE(NEW.budget_open_relief, 0);
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date + new_amount,
          ftc = GREATEST(0, ftc - new_relief)
      WHERE id = NEW.cost_bucket_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_amount := public.cost_actual_rollup_amount(OLD.status, OLD.amount);
    new_amount := public.cost_actual_rollup_amount(NEW.status, NEW.amount);
    old_relief := COALESCE(OLD.budget_open_relief, 0);
    new_relief := COALESCE(NEW.budget_open_relief, 0);

    IF OLD.cost_bucket_id IS NOT NULL
       AND OLD.cost_bucket_id IS DISTINCT FROM NEW.cost_bucket_id THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date - old_amount,
          ftc = GREATEST(0, ftc + old_relief)
      WHERE id = OLD.cost_bucket_id;
    END IF;

    IF NEW.cost_bucket_id IS NOT NULL THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date + CASE
            WHEN OLD.cost_bucket_id IS DISTINCT FROM NEW.cost_bucket_id
              THEN new_amount
            ELSE new_amount - old_amount
          END,
          ftc = GREATEST(
            0,
            ftc + CASE
              WHEN OLD.cost_bucket_id IS DISTINCT FROM NEW.cost_bucket_id
                THEN -new_relief
              ELSE old_relief - new_relief
            END
          )
      WHERE id = NEW.cost_bucket_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.cost_bucket_id IS NOT NULL THEN
      old_amount := public.cost_actual_rollup_amount(OLD.status, OLD.amount);
      old_relief := COALESCE(OLD.budget_open_relief, 0);
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date - old_amount,
          ftc = GREATEST(0, ftc + old_relief)
      WHERE id = OLD.cost_bucket_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

NOTIFY pgrst, 'reload schema';
