-- Billing cost settlements: partial cash payments plus supplier credits linked
-- to the invoice they reduce. Existing cost_actuals.amount remains signed
-- dollars for compatibility; every new payment is stored as integer cents.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS credit_applies_to_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_actuals_credit_applies_to_id_fkey'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_credit_applies_to_id_fkey
      FOREIGN KEY (credit_applies_to_id)
      REFERENCES public.cost_actuals(id)
      ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_actuals_credit_link_requires_negative_amount'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_credit_link_requires_negative_amount
      CHECK (credit_applies_to_id IS NULL OR amount < 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cost_actuals_credit_applies_to_idx
  ON public.cost_actuals (credit_applies_to_id)
  WHERE credit_applies_to_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.cost_actual_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_actual_id uuid NOT NULL REFERENCES public.cost_actuals(id) ON DELETE CASCADE,
  amount_cents bigint NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT '',
  payment_reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_actual_payments_amount_positive CHECK (amount_cents > 0)
);

CREATE INDEX IF NOT EXISTS cost_actual_payments_cost_actual_idx
  ON public.cost_actual_payments (cost_actual_id, payment_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS cost_actual_payments_project_idx
  ON public.cost_actual_payments (project_id, payment_date DESC);

ALTER TABLE public.cost_actual_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_actual_payments_team_select ON public.cost_actual_payments;
CREATE POLICY cost_actual_payments_team_select
  ON public.cost_actual_payments
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS cost_actual_payments_team_insert ON public.cost_actual_payments;
CREATE POLICY cost_actual_payments_team_insert
  ON public.cost_actual_payments
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

-- Cash settlement is append-only for normal users. Corrections stay auditable
-- instead of silently rewriting or deleting historical payments.
DROP POLICY IF EXISTS cost_actual_payments_team_update ON public.cost_actual_payments;
DROP POLICY IF EXISTS cost_actual_payments_team_delete ON public.cost_actual_payments;
REVOKE UPDATE, DELETE ON public.cost_actual_payments FROM authenticated;
GRANT SELECT, INSERT ON public.cost_actual_payments TO authenticated;
GRANT ALL ON public.cost_actual_payments TO service_role;

-- A linked credit must point to a positive invoice on the same project. Keeping
-- this invariant in the database prevents cross-project links through the API.
CREATE OR REPLACE FUNCTION public.validate_cost_actual_credit_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target_project_id uuid;
  target_amount numeric;
  target_status text;
  payment_cents bigint;
  other_credit_cents bigint;
BEGIN
  IF NEW.credit_applies_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id = NEW.credit_applies_to_id THEN
    RAISE EXCEPTION 'A credit cannot be applied to itself.';
  END IF;

  SELECT project_id, amount, status
    INTO target_project_id, target_amount, target_status
  FROM public.cost_actuals
  WHERE id = NEW.credit_applies_to_id;

  IF NOT FOUND OR target_project_id <> NEW.project_id OR target_amount <= 0 OR target_status IN ('draft', 'paid', 'void') THEN
    RAISE EXCEPTION 'Pick an approved or committed positive cost from this project for the credit.';
  END IF;

  -- Draft credits do not settle anything yet. When a credit becomes recognized,
  -- prevent it from pushing cash plus credits beyond the invoice total.
  IF NEW.status IN ('committed', 'approved', 'paid') THEN
    SELECT COALESCE(sum(amount_cents), 0)::bigint
      INTO payment_cents
    FROM public.cost_actual_payments
    WHERE cost_actual_id = NEW.credit_applies_to_id;

    SELECT COALESCE(sum(round(abs(amount) * 100)), 0)::bigint
      INTO other_credit_cents
    FROM public.cost_actuals
    WHERE credit_applies_to_id = NEW.credit_applies_to_id
      AND id <> NEW.id
      AND status IN ('committed', 'approved', 'paid');

    IF payment_cents + other_credit_cents + round(abs(NEW.amount) * 100)::bigint > round(target_amount * 100)::bigint THEN
      RAISE EXCEPTION 'Credit exceeds the invoice remaining balance.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_validate_credit_link ON public.cost_actuals;
CREATE TRIGGER cost_actuals_validate_credit_link
  BEFORE INSERT OR UPDATE OF credit_applies_to_id, amount, project_id, status
  ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cost_actual_credit_link();

-- Record one cash payment and advance the invoice lifecycle atomically. The
-- row is locked only while totals are checked and written, preventing two users
-- from overpaying the same invoice concurrently.
CREATE OR REPLACE FUNCTION public.record_cost_actual_payment(
  p_cost_actual_id uuid,
  p_amount_cents bigint,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_payment_method text DEFAULT '',
  p_payment_reference text DEFAULT '',
  p_notes text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  target public.cost_actuals%ROWTYPE;
  invoice_cents bigint;
  cash_paid_cents bigint;
  credit_cents bigint;
  settled_cents bigint;
  remaining_cents bigint;
  next_status text;
BEGIN
  IF p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than zero.';
  END IF;

  SELECT *
    INTO target
  FROM public.cost_actuals
  WHERE id = p_cost_actual_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost invoice not found.';
  END IF;
  IF NOT public.can_manage_project(target.project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF target.amount <= 0 OR target.status = 'void' THEN
    RAISE EXCEPTION 'Payments can only be recorded against an active positive cost.';
  END IF;

  invoice_cents := round(target.amount * 100)::bigint;

  SELECT COALESCE(sum(amount_cents), 0)::bigint
    INTO cash_paid_cents
  FROM public.cost_actual_payments
  WHERE cost_actual_id = target.id;

  SELECT COALESCE(sum(round(abs(amount) * 100)), 0)::bigint
    INTO credit_cents
  FROM public.cost_actuals
  WHERE credit_applies_to_id = target.id
    AND status IN ('committed', 'approved', 'paid');

  remaining_cents := greatest(0, invoice_cents - cash_paid_cents - credit_cents);
  IF p_amount_cents > remaining_cents THEN
    RAISE EXCEPTION 'Payment exceeds the remaining balance of % cents.', remaining_cents;
  END IF;

  INSERT INTO public.cost_actual_payments (
    project_id,
    cost_actual_id,
    amount_cents,
    payment_date,
    payment_method,
    payment_reference,
    notes,
    created_by
  ) VALUES (
    target.project_id,
    target.id,
    p_amount_cents,
    COALESCE(p_payment_date, CURRENT_DATE),
    left(COALESCE(p_payment_method, ''), 40),
    left(COALESCE(p_payment_reference, ''), 200),
    left(COALESCE(p_notes, ''), 2000),
    auth.uid()
  );

  cash_paid_cents := cash_paid_cents + p_amount_cents;
  settled_cents := least(invoice_cents, cash_paid_cents + credit_cents);
  next_status := CASE WHEN settled_cents >= invoice_cents THEN 'paid' ELSE 'approved' END;

  UPDATE public.cost_actuals
  SET status = next_status,
      approved_at = COALESCE(approved_at, now()),
      approved_by = COALESCE(approved_by, auth.uid()),
      paid_at = CASE WHEN next_status = 'paid' THEN COALESCE(paid_at, now()) ELSE paid_at END,
      paid_date = CASE WHEN next_status = 'paid' THEN COALESCE(p_payment_date, CURRENT_DATE) ELSE paid_date END,
      payment_method = CASE WHEN next_status = 'paid' THEN left(COALESCE(p_payment_method, ''), 40) ELSE payment_method END,
      payment_reference = CASE WHEN next_status = 'paid' THEN left(COALESCE(p_payment_reference, ''), 200) ELSE payment_reference END
  WHERE id = target.id;

  RETURN jsonb_build_object(
    'cost_actual_id', target.id,
    'invoice_cents', invoice_cents,
    'cash_paid_cents', cash_paid_cents,
    'credit_cents', credit_cents,
    'settled_cents', settled_cents,
    'remaining_cents', greatest(0, invoice_cents - settled_cents),
    'status', next_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_cost_actual_payment(uuid, bigint, date, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cost_actual_payment(uuid, bigint, date, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_cost_actual_payment(uuid, bigint, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cost_actual_payment(uuid, bigint, date, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
