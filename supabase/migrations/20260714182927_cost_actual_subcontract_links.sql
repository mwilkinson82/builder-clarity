-- A supplier invoice/cost document may represent dollars incurred against an
-- existing subcontract commitment. Linking the accounting line to either the
-- subcontract change order or the subcontract progress payment lets Budget
-- relieve "Open" (unpaid committed cost) as the actual is recognized, without
-- creating a second cost or changing risk-tally exposure.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS subcontract_change_order_id uuid,
  ADD COLUMN IF NOT EXISTS subcontract_payment_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cost_actuals_subcontract_change_order_id_fkey'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_subcontract_change_order_id_fkey
      FOREIGN KEY (subcontract_change_order_id)
      REFERENCES public.subcontract_change_orders(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cost_actuals_subcontract_payment_id_fkey'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_subcontract_payment_id_fkey
      FOREIGN KEY (subcontract_payment_id)
      REFERENCES public.subcontract_payments(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cost_actuals_one_subcontract_link_check'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_one_subcontract_link_check
      CHECK (num_nonnulls(subcontract_change_order_id, subcontract_payment_id) <= 1);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cost_actuals_subcontract_change_order_idx
  ON public.cost_actuals (subcontract_change_order_id)
  WHERE subcontract_change_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS cost_actuals_subcontract_payment_idx
  ON public.cost_actuals (subcontract_payment_id)
  WHERE subcontract_payment_id IS NOT NULL;

COMMENT ON COLUMN public.cost_actuals.subcontract_change_order_id IS
  'Optional subcontract change-order commitment relieved by this recognized actual.';
COMMENT ON COLUMN public.cost_actuals.subcontract_payment_id IS
  'Optional subcontract progress payment represented by this cost actual; prevents duplicate actual cost.';

-- Foreign keys prove the target exists. This trigger also proves that the
-- linked target belongs to the same project, and that a coded subcontract CO
-- is relieved only by an actual posted to the same cost bucket.
CREATE OR REPLACE FUNCTION public.validate_cost_actual_subcontract_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  linked_project_id uuid;
  linked_bucket_id uuid;
BEGIN
  IF NEW.subcontract_change_order_id IS NOT NULL THEN
    SELECT project_id, cost_bucket_id
      INTO linked_project_id, linked_bucket_id
    FROM public.subcontract_change_orders
    WHERE id = NEW.subcontract_change_order_id;

    IF NOT FOUND OR linked_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'The linked subcontract change order must belong to the same project as the cost.';
    END IF;
    IF linked_bucket_id IS NOT NULL AND NEW.cost_bucket_id IS DISTINCT FROM linked_bucket_id THEN
      RAISE EXCEPTION 'The cost code must match the linked subcontract change order.';
    END IF;
  END IF;

  IF NEW.subcontract_payment_id IS NOT NULL THEN
    SELECT project_id
      INTO linked_project_id
    FROM public.subcontract_payments
    WHERE id = NEW.subcontract_payment_id;

    IF NOT FOUND OR linked_project_id <> NEW.project_id THEN
      RAISE EXCEPTION 'The linked subcontract progress payment must belong to the same project as the cost.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_validate_subcontract_link ON public.cost_actuals;
CREATE TRIGGER cost_actuals_validate_subcontract_link
  BEFORE INSERT OR UPDATE OF
    project_id,
    cost_bucket_id,
    subcontract_change_order_id,
    subcontract_payment_id
  ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cost_actual_subcontract_link();

REVOKE ALL ON FUNCTION public.validate_cost_actual_subcontract_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_cost_actual_subcontract_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_cost_actual_subcontract_link() TO service_role;

NOTIFY pgrst, 'reload schema';
