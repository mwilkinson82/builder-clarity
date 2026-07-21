-- Financial-integrity hardening for subcontract payments and estimate imports.
--
-- 1. Subcontract compliance is evaluated in the same database transaction that
--    records/advances a payment and consumes its waiver. Row locks serialize
--    concurrent attempts against the same subcontract/payment/waiver.
-- 2. Direct payment writes are protected by a database trigger, so a caller
--    cannot mark a gated payment approved/paid without a valid COI plus an
--    attached waiver (or a complete, audited override).
-- 3. Estimate append/replace import, line replacement, and total recalculation
--    are one transaction. Any parse, insert, trigger, or total-update failure
--    rolls the entire operation back to the original worksheet.
--
-- This migration is intentionally schema-only. It contains no environment-
-- specific data and is portable across Lovable-managed databases.

ALTER TABLE public.subcontract_payments
  ADD COLUMN IF NOT EXISTS idempotency_key text,
  ADD COLUMN IF NOT EXISTS idempotency_fingerprint text;

CREATE UNIQUE INDEX IF NOT EXISTS subcontract_payments_subcontract_idempotency_unique
  ON public.subcontract_payments (subcontract_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN public.subcontract_payments.idempotency_key IS
  'Caller-stable key that makes subcontract-payment creation safe to retry.';
COMMENT ON COLUMN public.subcontract_payments.idempotency_fingerprint IS
  'Canonical request fingerprint used to reject reuse of an idempotency key with different payment details.';

CREATE TABLE IF NOT EXISTS public.estimate_import_operations (
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  idempotency_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (estimate_id, idempotency_key)
);

-- This is an internal transaction journal, not a client data surface. Only the
-- SECURITY DEFINER import RPC below may read or write it.
ALTER TABLE public.estimate_import_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.estimate_import_operations
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Lien-waiver assignment invariants
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_enforce_lien_waiver_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_payment public.subcontract_payments%ROWTYPE;
  v_atomic_write boolean := COALESCE(
    current_setting('overwatch.lien_waiver_atomic_write', true),
    ''
  ) = 'on';
BEGIN
  IF TG_OP = 'DELETE' AND OLD.payment_id IS NOT NULL AND NOT v_atomic_write THEN
    RAISE EXCEPTION
      'An attached lien waiver must be removed through the atomic payment workflow.';
  END IF;
  IF TG_OP = 'UPDATE'
     AND NOT v_atomic_write
     AND (
       OLD.payment_id IS DISTINCT FROM NEW.payment_id
       OR (
         OLD.payment_id IS NOT NULL
         AND (
           OLD.project_id IS DISTINCT FROM NEW.project_id
           OR OLD.subcontract_id IS DISTINCT FROM NEW.subcontract_id
           OR OLD.waiver_type IS DISTINCT FROM NEW.waiver_type
           OR OLD.through_date IS DISTINCT FROM NEW.through_date
           OR OLD.amount IS DISTINCT FROM NEW.amount
           OR OLD.signed_date IS DISTINCT FROM NEW.signed_date
           OR OLD.storage_path IS DISTINCT FROM NEW.storage_path
           OR OLD.file_name IS DISTINCT FROM NEW.file_name
           OR OLD.notes IS DISTINCT FROM NEW.notes
         )
       )
     ) THEN
    RAISE EXCEPTION
      'An attached lien waiver must be changed through the atomic payment workflow.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.payment_id IS NOT NULL THEN
      SELECT payment.*
        INTO v_payment
      FROM public.subcontract_payments payment
      WHERE payment.id = OLD.payment_id
      FOR UPDATE;

      IF FOUND AND v_payment.status IN ('approved', 'paid') THEN
        RAISE EXCEPTION
          'This lien waiver is part of an approved or paid pay app and cannot be deleted.';
      END IF;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.payment_id IS NOT NULL
     AND NEW.payment_id IS DISTINCT FROM OLD.payment_id THEN
    SELECT payment.*
      INTO v_payment
    FROM public.subcontract_payments payment
    WHERE payment.id = OLD.payment_id
    FOR UPDATE;

    IF FOUND AND v_payment.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION
        'This lien waiver is part of an approved or paid pay app and cannot be detached or reused.';
    END IF;

    IF NEW.payment_id IS NOT NULL THEN
      RAISE EXCEPTION
        'That lien waiver already covers another payment. Collect a new waiver.';
    END IF;
  END IF;

  IF NEW.payment_id IS NOT NULL THEN
    SELECT payment.*
      INTO v_payment
    FROM public.subcontract_payments payment
    WHERE payment.id = NEW.payment_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'The pay app selected for this lien waiver was not found.';
    END IF;
    IF v_payment.project_id <> NEW.project_id
       OR v_payment.subcontract_id <> NEW.subcontract_id THEN
      RAISE EXCEPTION
        'A lien waiver and pay app must belong to the same project and subcontract.';
    END IF;
    IF NEW.signed_date IS NULL
       OR NEW.signed_date > CURRENT_DATE
       OR length(trim(COALESCE(NEW.storage_path, ''))) = 0
       OR length(trim(COALESCE(NEW.file_name, ''))) = 0
       OR NEW.through_date IS NULL
       OR NEW.through_date < v_payment.payment_date
       OR NEW.amount < v_payment.amount
       OR NEW.amount * 100 <> trunc(NEW.amount * 100) THEN
      RAISE EXCEPTION
        'An attached lien waiver requires a signed document, exact-cent amount, and coverage through the payment date.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lien_waivers_enforce_assignment ON public.lien_waivers;
CREATE TRIGGER lien_waivers_enforce_assignment
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.lien_waivers
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_lien_waiver_assignment();

-- ---------------------------------------------------------------------------
-- Database-enforced compliance gate
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_payment_compliance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_gating_enabled boolean;
  v_certificate_id uuid;
  v_waiver_id uuid;
  v_has_override boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.project_id IS DISTINCT FROM NEW.project_id
       OR OLD.subcontract_id IS DISTINCT FROM NEW.subcontract_id THEN
      RAISE EXCEPTION 'A pay app cannot be moved to another project or subcontract.';
    END IF;
    IF OLD.status = 'paid' AND NEW.status <> 'paid' THEN
      RAISE EXCEPTION 'A paid pay app cannot move backward.';
    END IF;
    IF OLD.status = 'approved' AND NEW.status = 'draft' THEN
      RAISE EXCEPTION 'An approved pay app cannot move backward to draft.';
    END IF;
    IF OLD.status IN ('approved', 'paid')
       AND OLD.status = NEW.status
       AND (
         OLD.compliance_override_reason IS DISTINCT FROM NEW.compliance_override_reason
         OR OLD.compliance_overridden_by IS DISTINCT FROM NEW.compliance_overridden_by
         OR OLD.compliance_overridden_at IS DISTINCT FROM NEW.compliance_overridden_at
       ) THEN
      RAISE EXCEPTION 'A finalized compliance-override audit cannot be changed.';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.subcontracts subcontract
    WHERE subcontract.id = NEW.subcontract_id
      AND subcontract.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION 'That subcontract does not belong to this project.';
  END IF;

  v_has_override := length(trim(COALESCE(NEW.compliance_override_reason, ''))) > 0
    OR NEW.compliance_overridden_by IS NOT NULL
    OR NEW.compliance_overridden_at IS NOT NULL;
  IF v_has_override AND NOT (
    length(trim(COALESCE(NEW.compliance_override_reason, ''))) > 0
    AND NEW.compliance_overridden_by IS NOT NULL
    AND NEW.compliance_overridden_at IS NOT NULL
    AND ((SELECT auth.uid()) IS NULL OR NEW.compliance_overridden_by = (SELECT auth.uid()))
  ) THEN
    RAISE EXCEPTION
      'A compliance override requires a reason, the signed-in actor, and a timestamp.';
  END IF;

  IF NEW.status NOT IN ('approved', 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT project.require_compliance_gating
    INTO STRICT v_gating_enabled
  FROM public.projects project
  WHERE project.id = NEW.project_id;

  IF NOT v_gating_enabled THEN
    RETURN NEW;
  END IF;

  -- An override is valid only when all three audit fields are present. For an
  -- authenticated request, the recorded actor must be the caller.
  IF v_has_override THEN
    RETURN NEW;
  END IF;

  SELECT certificate.id
    INTO v_certificate_id
  FROM public.insurance_certificates certificate
  WHERE certificate.project_id = NEW.project_id
    AND certificate.subcontract_id = NEW.subcontract_id
    AND certificate.verified
    AND (certificate.effective_date IS NULL OR certificate.effective_date <= NEW.payment_date)
    AND (certificate.expiry_date IS NULL OR certificate.expiry_date >= NEW.payment_date)
  ORDER BY certificate.expiry_date DESC NULLS FIRST, certificate.id
  FOR SHARE
  LIMIT 1;

  IF v_certificate_id IS NULL THEN
    RAISE EXCEPTION
      'Compliance not met: a verified certificate of insurance must be in force on the payment date.';
  END IF;

  -- Lock the attached waiver while the payment status changes. A concurrent
  -- detach/reassignment must wait and then re-evaluate against the committed
  -- payment state instead of leaving a paid record without its paper trail.
  SELECT waiver.id
    INTO v_waiver_id
  FROM public.lien_waivers waiver
  WHERE waiver.project_id = NEW.project_id
    AND waiver.subcontract_id = NEW.subcontract_id
    AND waiver.payment_id = NEW.id
    AND waiver.signed_date IS NOT NULL
    AND waiver.signed_date <= CURRENT_DATE
    AND length(trim(COALESCE(waiver.storage_path, ''))) > 0
    AND length(trim(COALESCE(waiver.file_name, ''))) > 0
    AND waiver.through_date IS NOT NULL
    AND waiver.through_date >= NEW.payment_date
    AND waiver.amount >= NEW.amount
  ORDER BY waiver.created_at, waiver.id
  FOR UPDATE
  LIMIT 1;

  IF v_waiver_id IS NULL THEN
    RAISE EXCEPTION
      'Compliance not met: a signed lien waiver must be attached to this pay app.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subcontract_payments_enforce_compliance
  ON public.subcontract_payments;
CREATE TRIGGER subcontract_payments_enforce_compliance
  BEFORE INSERT OR UPDATE OF
    status,
    payment_date,
    project_id,
    subcontract_id,
    compliance_override_reason,
    compliance_overridden_by,
    compliance_overridden_at
  ON public.subcontract_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_payment_compliance();

-- ---------------------------------------------------------------------------
-- Subcontract-payment financial-record invariants
-- ---------------------------------------------------------------------------

-- A subcontract's legal commitment is its original buyout plus the signed
-- change-order/credit trail. Approved pay apps reserve that commitment and
-- paid pay apps consume it. Keep the invariant in the database so concurrent
-- approvals, direct REST writes, base-contract edits, and credit deletion all
-- agree on the same exact-cent ceiling.

DO $commitment_audit$
DECLARE
  v_bad_subcontract_id uuid;
BEGIN
  SELECT subcontract.id
    INTO v_bad_subcontract_id
  FROM public.subcontracts subcontract
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(round(change_order.amount * 100)::bigint), 0)::bigint AS cents
    FROM public.subcontract_change_orders change_order
    WHERE change_order.subcontract_id = subcontract.id
      AND change_order.project_id = subcontract.project_id
  ) changes ON true
  LEFT JOIN LATERAL (
    SELECT COALESCE(sum(round(payment.amount * 100)::bigint), 0)::bigint AS cents
    FROM public.subcontract_payments payment
    WHERE payment.subcontract_id = subcontract.id
      AND payment.project_id = subcontract.project_id
      AND payment.status IN ('approved', 'paid')
  ) finalized ON true
  WHERE round(subcontract.contract_value * 100)::bigint + changes.cents < 0
     OR finalized.cents > round(subcontract.contract_value * 100)::bigint + changes.cents
     OR subcontract.contract_value * 100 <> trunc(subcontract.contract_value * 100)
  ORDER BY subcontract.id
  LIMIT 1;

  IF v_bad_subcontract_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Subcontract % has an invalid revised commitment or approved payments above commitment. Correct it before applying financial-integrity hardening.',
      v_bad_subcontract_id;
  END IF;

  SELECT change_order.subcontract_id
    INTO v_bad_subcontract_id
  FROM public.subcontract_change_orders change_order
  LEFT JOIN public.subcontracts subcontract
    ON subcontract.id = change_order.subcontract_id
  WHERE subcontract.id IS NULL
     OR subcontract.project_id <> change_order.project_id
     OR change_order.amount * 100 <> trunc(change_order.amount * 100)
  ORDER BY change_order.subcontract_id
  LIMIT 1;

  IF v_bad_subcontract_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A subcontract change order has mismatched project scope or fractional-cent money. Correct subcontract % before applying financial-integrity hardening.',
      v_bad_subcontract_id;
  END IF;

  SELECT payment.subcontract_id
    INTO v_bad_subcontract_id
  FROM public.subcontract_payments payment
  LEFT JOIN public.subcontracts subcontract
    ON subcontract.id = payment.subcontract_id
  WHERE subcontract.id IS NULL
     OR subcontract.project_id <> payment.project_id
  ORDER BY payment.subcontract_id
  LIMIT 1;

  IF v_bad_subcontract_id IS NOT NULL THEN
    RAISE EXCEPTION
      'A subcontract payment has mismatched project scope. Correct subcontract % before applying financial-integrity hardening.',
      v_bad_subcontract_id;
  END IF;
END;
$commitment_audit$;

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_commitment_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_change_order_cents bigint := 0;
  v_finalized_payment_cents bigint := 0;
  v_has_financial_activity boolean := false;
  v_revised_commitment_cents bigint := 0;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1
      FROM public.subcontract_change_orders change_order
      WHERE change_order.subcontract_id = OLD.id
    ) OR EXISTS (
      SELECT 1
      FROM public.subcontract_payments payment
      WHERE payment.subcontract_id = OLD.id
        AND payment.status IN ('approved', 'paid')
    ) THEN
      RAISE EXCEPTION
        'A subcontract with signed change orders or finalized pay apps is a permanent financial record and cannot be deleted.';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.contract_value IS NULL
     OR NEW.contract_value < 0
     OR NEW.contract_value * 100 <> trunc(NEW.contract_value * 100) THEN
    RAISE EXCEPTION 'Subcontract value must be nonnegative and exact to the cent.';
  END IF;

  IF TG_OP = 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.subcontract_change_orders change_order
    WHERE change_order.subcontract_id = OLD.id
    UNION ALL
    SELECT 1
    FROM public.subcontract_payments payment
    WHERE payment.subcontract_id = OLD.id
    UNION ALL
    SELECT 1
    FROM public.subcontract_allocations allocation
    WHERE allocation.subcontract_id = OLD.id
  ) INTO v_has_financial_activity;

  IF v_has_financial_activity AND (
    NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.subcontractor_id IS DISTINCT FROM OLD.subcontractor_id
  ) THEN
    RAISE EXCEPTION
      'A subcontract with payment or change-order history cannot move projects or change trade partners.';
  END IF;

  SELECT COALESCE(sum(round(change_order.amount * 100)::bigint), 0)::bigint
    INTO v_change_order_cents
  FROM public.subcontract_change_orders change_order
  WHERE change_order.subcontract_id = OLD.id
    AND change_order.project_id = OLD.project_id;

  SELECT COALESCE(sum(round(payment.amount * 100)::bigint), 0)::bigint
    INTO v_finalized_payment_cents
  FROM public.subcontract_payments payment
  WHERE payment.subcontract_id = OLD.id
    AND payment.project_id = OLD.project_id
    AND payment.status IN ('approved', 'paid');

  v_revised_commitment_cents :=
    round(NEW.contract_value * 100)::bigint + v_change_order_cents;

  IF v_revised_commitment_cents < 0 THEN
    RAISE EXCEPTION
      'The base subcontract and signed credits cannot produce a negative revised commitment.';
  END IF;
  IF v_finalized_payment_cents > v_revised_commitment_cents THEN
    RAISE EXCEPTION
      'Subcontract value cannot be reduced below approved and paid pay apps.';
  END IF;
  IF OLD.status = 'executed'
     AND NEW.status = 'draft'
     AND v_has_financial_activity THEN
    RAISE EXCEPTION
      'An executed subcontract with financial activity cannot move backward to draft.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_commitment_record()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subcontracts_enforce_commitment_record
  ON public.subcontracts;
CREATE TRIGGER subcontracts_enforce_commitment_record
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.subcontracts
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_commitment_record();

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_change_order_commitment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subcontract public.subcontracts%ROWTYPE;
  v_change_order_id uuid;
  v_existing_change_cents bigint := 0;
  v_finalized_payment_cents bigint := 0;
  v_revised_commitment_cents bigint := 0;
BEGIN
  v_change_order_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.id ELSE OLD.id END;

  IF TG_OP = 'UPDATE' AND (
    NEW.subcontract_id IS DISTINCT FROM OLD.subcontract_id
    OR NEW.project_id IS DISTINCT FROM OLD.project_id
  ) THEN
    RAISE EXCEPTION
      'A subcontract change order cannot move to another subcontract or project.';
  END IF;

  SELECT subcontract.*
    INTO v_subcontract
  FROM public.subcontracts subcontract
  WHERE subcontract.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.subcontract_id ELSE NEW.subcontract_id END
  FOR UPDATE;

  -- The parent is already being removed during an ON DELETE CASCADE. The parent
  -- trigger above has separately blocked deletion when finalized payments exist.
  IF NOT FOUND AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That subcontract was not found.';
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.project_id <> v_subcontract.project_id THEN
      RAISE EXCEPTION 'A subcontract change order must share its subcontract project.';
    END IF;
    IF NEW.amount IS NULL
       OR NEW.amount = 0
       OR NEW.amount * 100 <> trunc(NEW.amount * 100) THEN
      RAISE EXCEPTION 'Subcontract change orders require a nonzero exact-cent amount.';
    END IF;
    IF NEW.cost_bucket_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM public.cost_buckets bucket
      WHERE bucket.id = NEW.cost_bucket_id
        AND bucket.project_id = NEW.project_id
    ) THEN
      RAISE EXCEPTION 'The subcontract change-order cost code belongs to another project.';
    END IF;
  END IF;

  SELECT COALESCE(sum(round(change_order.amount * 100)::bigint), 0)::bigint
    INTO v_existing_change_cents
  FROM public.subcontract_change_orders change_order
  WHERE change_order.subcontract_id = v_subcontract.id
    AND change_order.project_id = v_subcontract.project_id
    AND change_order.id <> v_change_order_id;

  SELECT COALESCE(sum(round(payment.amount * 100)::bigint), 0)::bigint
    INTO v_finalized_payment_cents
  FROM public.subcontract_payments payment
  WHERE payment.subcontract_id = v_subcontract.id
    AND payment.project_id = v_subcontract.project_id
    AND payment.status IN ('approved', 'paid');

  v_revised_commitment_cents :=
    round(v_subcontract.contract_value * 100)::bigint
    + v_existing_change_cents
    + CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE round(NEW.amount * 100)::bigint END;

  IF v_revised_commitment_cents < 0 THEN
    RAISE EXCEPTION
      'This credit would make the subcontract revised commitment negative.';
  END IF;
  IF v_finalized_payment_cents > v_revised_commitment_cents THEN
    RAISE EXCEPTION
      'This change would reduce subcontract commitment below approved and paid pay apps.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_change_order_commitment()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subcontract_change_orders_enforce_commitment
  ON public.subcontract_change_orders;
CREATE TRIGGER subcontract_change_orders_enforce_commitment
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.subcontract_change_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_change_order_commitment();

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_payment_commitment_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_subcontract public.subcontracts%ROWTYPE;
  v_change_order_cents bigint := 0;
  v_existing_finalized_cents bigint := 0;
  v_revised_commitment_cents bigint := 0;
BEGIN
  SELECT subcontract.*
    INTO v_subcontract
  FROM public.subcontracts subcontract
  WHERE subcontract.id = NEW.subcontract_id
  FOR UPDATE;

  IF NOT FOUND OR v_subcontract.project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'A subcontract payment must share its subcontract project.';
  END IF;

  IF NEW.status NOT IN ('approved', 'paid') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(sum(round(change_order.amount * 100)::bigint), 0)::bigint
    INTO v_change_order_cents
  FROM public.subcontract_change_orders change_order
  WHERE change_order.subcontract_id = v_subcontract.id
    AND change_order.project_id = v_subcontract.project_id;

  SELECT COALESCE(sum(round(payment.amount * 100)::bigint), 0)::bigint
    INTO v_existing_finalized_cents
  FROM public.subcontract_payments payment
  WHERE payment.subcontract_id = v_subcontract.id
    AND payment.project_id = v_subcontract.project_id
    AND payment.status IN ('approved', 'paid')
    AND payment.id <> NEW.id;

  v_revised_commitment_cents :=
    round(v_subcontract.contract_value * 100)::bigint + v_change_order_cents;

  IF v_existing_finalized_cents + round(NEW.amount * 100)::bigint
       > v_revised_commitment_cents THEN
    RAISE EXCEPTION
      'Approved and paid pay apps cannot exceed the subcontract revised commitment.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_payment_commitment_capacity()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subcontract_payments_enforce_commitment_capacity
  ON public.subcontract_payments;
CREATE TRIGGER subcontract_payments_enforce_commitment_capacity
  BEFORE INSERT OR UPDATE OF status, amount, project_id, subcontract_id
  ON public.subcontract_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_payment_commitment_capacity();

-- Existing split rows become permanent financial attribution once this
-- migration lands. Refuse to install the command boundary over corrupt scope,
-- fractional cents, or totals that disagree with their parent payment.
DO $payment_allocation_audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.subcontract_payment_allocations allocation
    JOIN public.subcontract_payments payment ON payment.id = allocation.payment_id
    LEFT JOIN public.cost_buckets bucket ON bucket.id = allocation.cost_bucket_id
    WHERE allocation.project_id <> payment.project_id
       OR allocation.subcontract_id <> payment.subcontract_id
       OR (
         allocation.cost_bucket_id IS NOT NULL
         AND (bucket.id IS NULL OR bucket.project_id <> payment.project_id)
       )
  ) THEN
    RAISE EXCEPTION
      'Financial-integrity migration blocked: a subcontract payment split crosses project or subcontract scope.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subcontract_payment_allocations allocation
    WHERE allocation.amount IS NULL
       OR allocation.amount <= 0
       OR allocation.amount * 100 <> trunc(allocation.amount * 100)
  ) THEN
    RAISE EXCEPTION
      'Financial-integrity migration blocked: subcontract payment split amounts must be positive exact cents.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subcontract_payment_allocations allocation
    JOIN public.subcontract_payments payment ON payment.id = allocation.payment_id
    GROUP BY payment.id, payment.amount
    HAVING round(sum(allocation.amount) * 100)::bigint
      <> round(payment.amount * 100)::bigint
  ) THEN
    RAISE EXCEPTION
      'Financial-integrity migration blocked: a subcontract payment split does not equal its payment.';
  END IF;
END;
$payment_allocation_audit$;

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_payment_allocation_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_atomic_write boolean := COALESCE(
    current_setting('overwatch.subcontract_payment_allocation_atomic_write', true),
    ''
  ) = 'on';
  v_project_id uuid;
  v_subcontract_id uuid;
  v_status text;
BEGIN
  -- Cascades from deleting a draft parent payment/subcontract are legitimate;
  -- a direct allocation DELETE enters at trigger depth 1 and remains blocked.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  IF NOT v_atomic_write THEN
    RAISE EXCEPTION
      'Subcontract payment splits must be replaced through the atomic allocation workflow.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.amount IS NULL
     OR NEW.amount <= 0
     OR NEW.amount * 100 <> trunc(NEW.amount * 100) THEN
    RAISE EXCEPTION
      'Subcontract payment split amounts must be positive exact cents.';
  END IF;
  IF length(COALESCE(NEW.cost_code, '')) > 80
     OR length(COALESCE(NEW.description, '')) > 300 THEN
    RAISE EXCEPTION 'Subcontract payment split details exceed their allowed length.';
  END IF;

  SELECT payment.project_id, payment.subcontract_id, payment.status
    INTO v_project_id, v_subcontract_id, v_status
  FROM public.subcontract_payments payment
  WHERE payment.id = NEW.payment_id;

  IF NOT FOUND
     OR NEW.project_id <> v_project_id
     OR NEW.subcontract_id <> v_subcontract_id THEN
    RAISE EXCEPTION
      'A subcontract payment split must share its payment project and subcontract.';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION
      'Approved or paid subcontract payment coding is a permanent financial record.';
  END IF;
  IF NEW.cost_bucket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.cost_buckets bucket
    WHERE bucket.id = NEW.cost_bucket_id
      AND bucket.project_id = v_project_id
  ) THEN
    RAISE EXCEPTION 'That payment cost code belongs to a different project.';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_payment_allocation_record()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS subcontract_payment_allocations_enforce_financial_record
  ON public.subcontract_payment_allocations;
CREATE TRIGGER subcontract_payment_allocations_enforce_financial_record
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.subcontract_payment_allocations
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_payment_allocation_record();

CREATE OR REPLACE FUNCTION public.tg_enforce_subcontract_payment_financial_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_atomic_write boolean := COALESCE(
    current_setting('overwatch.subcontract_payment_atomic_write', true),
    ''
  ) = 'on';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'paid') THEN
      RAISE EXCEPTION
        'An approved or paid subcontract payment is a permanent financial record and cannot be deleted.';
    END IF;
    -- Permit the FK cascade to remove this draft's coding. The allocation table
    -- itself has no direct authenticated write grant.
    PERFORM set_config(
      'overwatch.subcontract_payment_allocation_atomic_write',
      'on',
      true
    );
    RETURN OLD;
  END IF;

  IF NEW.amount IS NULL
     OR NEW.retainage_held IS NULL
     OR NEW.amount <= 0
     OR NEW.retainage_held < 0 THEN
    RAISE EXCEPTION
      'Payment must be positive and retainage must be nonnegative.';
  END IF;
  IF NEW.retainage_held > NEW.amount THEN
    RAISE EXCEPTION
      'Retainage held cannot exceed the gross payment amount.';
  END IF;
  IF NEW.amount * 100 <> trunc(NEW.amount * 100)
     OR NEW.retainage_held * 100 <> trunc(NEW.retainage_held * 100) THEN
    RAISE EXCEPTION
      'Payment and retainage must be exact to the cent.';
  END IF;
  IF length(COALESCE(NEW.reference, '')) > 200
     OR length(COALESCE(NEW.notes, '')) > 4000
     OR length(COALESCE(NEW.payment_method, '')) > 40 THEN
    RAISE EXCEPTION 'Payment details exceed their allowed length.';
  END IF;

  -- All new rows and every lifecycle transition must use the audited atomic
  -- RPCs. Draft corrections remain ordinary RLS-protected updates.
  IF TG_OP = 'INSERT' AND NOT v_atomic_write THEN
    RAISE EXCEPTION
      'Subcontract payments must be recorded through the atomic payment workflow.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.created_at IS DISTINCT FROM NEW.created_at THEN
      RAISE EXCEPTION
        'Subcontract payment creation history is immutable.';
    END IF;

    IF OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
       OR OLD.idempotency_fingerprint IS DISTINCT FROM NEW.idempotency_fingerprint THEN
      RAISE EXCEPTION
        'Subcontract payment idempotency provenance is immutable.';
    END IF;

    IF NOT v_atomic_write AND (
      OLD.approved_at IS DISTINCT FROM NEW.approved_at
      OR OLD.compliance_override_reason IS DISTINCT FROM NEW.compliance_override_reason
      OR OLD.compliance_overridden_by IS DISTINCT FROM NEW.compliance_overridden_by
      OR OLD.compliance_overridden_at IS DISTINCT FROM NEW.compliance_overridden_at
    ) THEN
      RAISE EXCEPTION
        'Approval and compliance audit fields must be changed through the atomic payment workflow.';
    END IF;

    IF OLD.status IS DISTINCT FROM NEW.status AND NOT v_atomic_write THEN
      RAISE EXCEPTION
        'Subcontract payment status must be changed through the atomic payment workflow.';
    END IF;

    IF OLD.status IN ('approved', 'paid') THEN
      IF OLD.amount IS DISTINCT FROM NEW.amount
         OR OLD.retainage_held IS DISTINCT FROM NEW.retainage_held
         OR OLD.notes IS DISTINCT FROM NEW.notes
         OR OLD.exposure_id IS DISTINCT FROM NEW.exposure_id
         OR OLD.approved_at IS DISTINCT FROM NEW.approved_at THEN
        RAISE EXCEPTION
          'Approved or paid subcontract payment amounts and attribution cannot be changed.';
      END IF;

      IF OLD.status = NEW.status AND (
        OLD.payment_date IS DISTINCT FROM NEW.payment_date
        OR OLD.reference IS DISTINCT FROM NEW.reference
        OR OLD.payment_method IS DISTINCT FROM NEW.payment_method
      ) THEN
        RAISE EXCEPTION
          'Approved or paid subcontract payment details cannot be edited in place.';
      END IF;
    END IF;
  END IF;

  -- No explicit rows means the established automatic pro-rata attribution.
  -- Once explicit coding exists, approval is blocked unless it balances to the
  -- gross payment exactly. This is checked again on every finalized update.
  IF NEW.status IN ('approved', 'paid') AND EXISTS (
    SELECT 1
    FROM public.subcontract_payment_allocations allocation
    WHERE allocation.payment_id = NEW.id
  ) AND (
    SELECT round(sum(allocation.amount) * 100)::bigint
    FROM public.subcontract_payment_allocations allocation
    WHERE allocation.payment_id = NEW.id
  ) <> round(NEW.amount * 100)::bigint THEN
    RAISE EXCEPTION
      'Payment coding must equal the payment amount exactly before approval.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subcontract_payments_enforce_financial_record
  ON public.subcontract_payments;
CREATE TRIGGER subcontract_payments_enforce_financial_record
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.subcontract_payments
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_enforce_subcontract_payment_financial_record();

-- ---------------------------------------------------------------------------
-- Atomic draft-only subcontract-payment allocation replacement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.replace_subcontract_payment_allocations_atomic(
  p_payment_id uuid,
  p_rows jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_project_id uuid;
  v_subcontract_id uuid;
  v_payment public.subcontract_payments%ROWTYPE;
  v_row jsonb;
  v_amount_text text;
  v_amount_cents bigint;
  v_payment_amount_cents bigint;
  v_total_cents numeric := 0;
  v_bucket_text text;
  v_bucket_id uuid;
  v_cost_code text;
  v_description text;
  v_normalized_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to code a subcontract payment.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Payment coding rows must be a JSON array.';
  END IF;
  IF jsonb_array_length(p_rows) > 40 THEN
    RAISE EXCEPTION 'A payment can have at most 40 coding rows.';
  END IF;

  -- Match the global financial lock order: subcontract, then payment.
  SELECT payment.project_id, payment.subcontract_id
    INTO v_project_id, v_subcontract_id
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That pay app was not found.';
  END IF;

  PERFORM 1
  FROM public.subcontracts subcontract
  WHERE subcontract.id = v_subcontract_id
    AND subcontract.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The pay app subcontract was not found.';
  END IF;

  SELECT payment.*
    INTO STRICT v_payment
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id
  FOR UPDATE;

  IF v_payment.project_id <> v_project_id
     OR v_payment.subcontract_id <> v_subcontract_id THEN
    RAISE EXCEPTION 'The pay app changed while its coding was being opened. Try again.';
  END IF;
  IF NOT public.can_manage_project(v_payment.project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF v_payment.status <> 'draft' THEN
    RAISE EXCEPTION
      'Approved or paid subcontract payment coding is a permanent financial record.';
  END IF;

  v_payment_amount_cents := round(v_payment.amount * 100)::bigint;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_rows) AS rows(value)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Every payment coding row must be an object.';
    END IF;

    v_amount_text := COALESCE(v_row ->> 'amount_cents', '');
    IF v_amount_text !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Every payment coding amount must be integer cents.';
    END IF;
    v_amount_cents := v_amount_text::bigint;
    IF v_amount_cents <= 0 OR v_amount_cents > v_payment_amount_cents THEN
      RAISE EXCEPTION
        'Every payment coding amount must be positive and no greater than the payment.';
    END IF;

    v_bucket_text := nullif(trim(COALESCE(v_row ->> 'cost_bucket_id', '')), '');
    v_bucket_id := NULL;
    IF v_bucket_text IS NOT NULL THEN
      BEGIN
        v_bucket_id := v_bucket_text::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'A payment cost-code id is invalid.';
      END;

      SELECT left(COALESCE(bucket.cost_code, ''), 80),
             left(COALESCE(bucket.bucket, ''), 300)
        INTO v_cost_code, v_description
      FROM public.cost_buckets bucket
      WHERE bucket.id = v_bucket_id
        AND bucket.project_id = v_payment.project_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'That payment cost code belongs to a different project.';
      END IF;
    ELSE
      v_cost_code := trim(COALESCE(v_row ->> 'cost_code', ''));
      v_description := trim(COALESCE(v_row ->> 'description', ''));
      IF length(v_cost_code) > 80 OR length(v_description) > 300 THEN
        RAISE EXCEPTION 'Payment coding details exceed their allowed length.';
      END IF;
    END IF;

    v_total_cents := v_total_cents + v_amount_cents;
    v_normalized_rows := v_normalized_rows || jsonb_build_array(jsonb_build_object(
      'cost_bucket_id', v_bucket_id,
      'cost_code', v_cost_code,
      'description', v_description,
      'amount_cents', v_amount_cents
    ));
  END LOOP;

  IF jsonb_array_length(v_normalized_rows) > 0
     AND v_total_cents <> v_payment_amount_cents THEN
    RAISE EXCEPTION
      'The split must add up to the payment amount exactly.';
  END IF;

  PERFORM set_config(
    'overwatch.subcontract_payment_allocation_atomic_write',
    'on',
    true
  );
  DELETE FROM public.subcontract_payment_allocations allocation
  WHERE allocation.payment_id = v_payment.id;

  FOR v_row IN SELECT value FROM jsonb_array_elements(v_normalized_rows) AS rows(value)
  LOOP
    INSERT INTO public.subcontract_payment_allocations (
      project_id,
      subcontract_id,
      payment_id,
      cost_bucket_id,
      cost_code,
      description,
      amount
    ) VALUES (
      v_payment.project_id,
      v_payment.subcontract_id,
      v_payment.id,
      NULLIF(v_row ->> 'cost_bucket_id', '')::uuid,
      COALESCE(v_row ->> 'cost_code', ''),
      COALESCE(v_row ->> 'description', ''),
      (v_row ->> 'amount_cents')::bigint::numeric / 100.0
    );
  END LOOP;

  RETURN jsonb_build_object(
    'payment_id', v_payment.id,
    'row_count', jsonb_array_length(v_normalized_rows),
    'total_cents', v_total_cents
  );
END;
$$;

-- Authenticated and service clients can read coding, but all mutation flows
-- through the audited SECURITY DEFINER command above.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.subcontract_payment_allocations
  FROM authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic subcontract-payment creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_subcontract_payment_atomic(
  p_project_id uuid,
  p_subcontract_id uuid,
  p_amount_cents bigint,
  p_retainage_held_cents bigint,
  p_payment_date date,
  p_reference text DEFAULT '',
  p_notes text DEFAULT '',
  p_status text DEFAULT 'paid',
  p_exposure_id uuid DEFAULT NULL,
  p_override_reason text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_subcontract_project_id uuid;
  v_gating_enabled boolean;
  v_certificate_id uuid;
  v_waiver_id uuid;
  v_payment_id uuid := gen_random_uuid();
  v_payment public.subcontract_payments%ROWTYPE;
  v_existing public.subcontract_payments%ROWTYPE;
  v_override_reason text := trim(COALESCE(p_override_reason, ''));
  v_idempotency_key text := trim(COALESCE(p_idempotency_key, ''));
  v_idempotency_fingerprint text;
  v_overriding boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to record a subcontract payment.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'approved', 'paid') THEN
    RAISE EXCEPTION 'Payment status must be draft, approved, or paid.';
  END IF;
  IF p_amount_cents IS NULL OR p_retainage_held_cents IS NULL
     OR p_amount_cents <= 0 OR p_retainage_held_cents < 0 THEN
    RAISE EXCEPTION 'Payment must be positive and retainage must be nonnegative integer cents.';
  END IF;
  IF p_retainage_held_cents > p_amount_cents THEN
    RAISE EXCEPTION 'Retainage held cannot exceed the gross payment amount.';
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'A payment date is required.';
  END IF;
  IF length(v_idempotency_key) = 0 OR length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid payment idempotency key is required.';
  END IF;
  IF length(COALESCE(p_reference, '')) > 200
     OR length(COALESCE(p_notes, '')) > 4000
     OR length(v_override_reason) > 500 THEN
    RAISE EXCEPTION 'Payment details exceed their allowed length.';
  END IF;

  v_idempotency_fingerprint := md5(jsonb_build_array(
    p_project_id,
    p_subcontract_id,
    p_amount_cents,
    p_retainage_held_cents,
    p_payment_date,
    COALESCE(p_reference, ''),
    COALESCE(p_notes, ''),
    p_status,
    p_exposure_id,
    v_override_reason
  )::text);

  -- One lock per subcontract serializes waiver-pool consumption. The lock is
  -- acquired before any compliance reads and held only for this short RPC.
  SELECT subcontract.project_id
    INTO v_subcontract_project_id
  FROM public.subcontracts subcontract
  WHERE subcontract.id = p_subcontract_id
  FOR UPDATE;

  IF NOT FOUND OR v_subcontract_project_id <> p_project_id THEN
    RAISE EXCEPTION 'That subcontract was not found on this project.';
  END IF;
  IF NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  -- A network retry returns the first committed payment. Reusing the key for
  -- different money, dates, provenance, or lifecycle intent is rejected.
  SELECT payment.*
    INTO v_existing
  FROM public.subcontract_payments payment
  WHERE payment.subcontract_id = p_subcontract_id
    AND payment.idempotency_key = v_idempotency_key
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.idempotency_fingerprint IS DISTINCT FROM v_idempotency_fingerprint THEN
      RAISE EXCEPTION
        'This payment idempotency key was already used for different payment details.';
    END IF;
    RETURN to_jsonb(v_existing);
  END IF;

  SELECT project.require_compliance_gating
    INTO STRICT v_gating_enabled
  FROM public.projects project
  WHERE project.id = p_project_id
  FOR SHARE;

  IF p_exposure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.exposures exposure
    WHERE exposure.id = p_exposure_id
      AND exposure.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'That risk belongs to a different project or is no longer available.';
  END IF;

  PERFORM set_config('overwatch.subcontract_payment_atomic_write', 'on', true);

  -- Draft first. If any later check/write fails, PostgreSQL rolls this insert
  -- back together with the entire function call.
  INSERT INTO public.subcontract_payments (
    id,
    project_id,
    subcontract_id,
    amount,
    retainage_held,
    payment_date,
    reference,
    notes,
    status,
    exposure_id,
    idempotency_key,
    idempotency_fingerprint
  ) VALUES (
    v_payment_id,
    p_project_id,
    p_subcontract_id,
    p_amount_cents::numeric / 100.0,
    p_retainage_held_cents::numeric / 100.0,
    p_payment_date,
    COALESCE(p_reference, ''),
    COALESCE(p_notes, ''),
    'draft',
    p_exposure_id,
    v_idempotency_key,
    v_idempotency_fingerprint
  );

  IF p_status = 'draft' THEN
    SELECT payment.*
      INTO STRICT v_payment
    FROM public.subcontract_payments payment
    WHERE payment.id = v_payment_id;
    RETURN to_jsonb(v_payment);
  END IF;

  IF v_gating_enabled THEN
    SELECT certificate.id
      INTO v_certificate_id
    FROM public.insurance_certificates certificate
    WHERE certificate.project_id = p_project_id
      AND certificate.subcontract_id = p_subcontract_id
      AND certificate.verified
      AND (certificate.effective_date IS NULL OR certificate.effective_date <= p_payment_date)
      AND (certificate.expiry_date IS NULL OR certificate.expiry_date >= p_payment_date)
    ORDER BY certificate.expiry_date DESC NULLS FIRST, certificate.id
    FOR SHARE
    LIMIT 1;

    SELECT waiver.id
      INTO v_waiver_id
    FROM public.lien_waivers waiver
    WHERE waiver.project_id = p_project_id
      AND waiver.subcontract_id = p_subcontract_id
      AND waiver.payment_id IS NULL
      AND waiver.signed_date IS NOT NULL
      AND waiver.signed_date <= CURRENT_DATE
      AND length(trim(COALESCE(waiver.storage_path, ''))) > 0
      AND length(trim(COALESCE(waiver.file_name, ''))) > 0
      AND waiver.through_date IS NOT NULL
      AND waiver.through_date >= p_payment_date
      AND waiver.amount >= p_amount_cents::numeric / 100.0
    ORDER BY waiver.created_at, waiver.id
    FOR UPDATE
    LIMIT 1;

    v_overriding := (v_certificate_id IS NULL OR v_waiver_id IS NULL)
      AND length(v_override_reason) > 0;

    IF (v_certificate_id IS NULL OR v_waiver_id IS NULL) AND NOT v_overriding THEN
      RAISE EXCEPTION '%', concat_ws(
        ' ',
        'Compliance not met:',
        CASE
          WHEN v_certificate_id IS NULL
            THEN 'No verified certificate of insurance is in force on the payment date.'
        END,
        CASE
          WHEN v_waiver_id IS NULL
            THEN 'A signed lien waiver for this payment is required.'
        END
      );
    END IF;

    IF NOT v_overriding THEN
      PERFORM set_config('overwatch.lien_waiver_atomic_write', 'on', true);
      UPDATE public.lien_waivers waiver
      SET payment_id = v_payment_id
      WHERE waiver.id = v_waiver_id
        AND waiver.payment_id IS NULL;

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Payment blocked: the selected lien waiver was consumed by another payment. Try again.';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('overwatch.subcontract_payment_atomic_write', 'on', true);

  UPDATE public.subcontract_payments payment
  SET status = p_status,
      approved_at = now(),
      compliance_override_reason = CASE WHEN v_overriding THEN v_override_reason ELSE '' END,
      compliance_overridden_by = CASE WHEN v_overriding THEN v_user_id ELSE NULL END,
      compliance_overridden_at = CASE WHEN v_overriding THEN now() ELSE NULL END
  WHERE payment.id = v_payment_id
  RETURNING payment.* INTO STRICT v_payment;

  RETURN to_jsonb(v_payment);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic subcontract-payment transition
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transition_subcontract_payment_atomic(
  p_payment_id uuid,
  p_status text,
  p_override_reason text DEFAULT NULL,
  p_payment_method text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_paid_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_project_id uuid;
  v_subcontract_id uuid;
  v_payment public.subcontract_payments%ROWTYPE;
  v_gating_enabled boolean;
  v_gate_date date;
  v_certificate_id uuid;
  v_waiver_id uuid;
  v_override_reason text := trim(COALESCE(p_override_reason, ''));
  v_overriding boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to update a subcontract payment.';
  END IF;
  IF p_status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'A pay app can only move forward to approved or paid.';
  END IF;

  -- Read the lock key, then acquire locks in subcontract -> payment -> waiver
  -- order in every RPC to avoid lock-order inversions under concurrency.
  SELECT payment.project_id, payment.subcontract_id
    INTO v_project_id, v_subcontract_id
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'That pay app was not found.';
  END IF;

  PERFORM 1
  FROM public.subcontracts subcontract
  WHERE subcontract.id = v_subcontract_id
    AND subcontract.project_id = v_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The pay app subcontract was not found.';
  END IF;

  SELECT payment.*
    INTO STRICT v_payment
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id
  FOR UPDATE;

  IF NOT public.can_manage_project(v_payment.project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  -- Retried requests are idempotent once the requested transition landed.
  IF v_payment.status = p_status THEN
    IF (
      p_status = 'paid'
      AND (
        (p_payment_method IS NOT NULL AND left(p_payment_method, 40) <> v_payment.payment_method)
        OR (p_payment_reference IS NOT NULL AND left(p_payment_reference, 200) <> v_payment.reference)
        OR (p_paid_date IS NOT NULL AND p_paid_date <> v_payment.payment_date)
      )
    ) OR (
      length(v_override_reason) > 0
      AND v_override_reason <> COALESCE(v_payment.compliance_override_reason, '')
    ) THEN
      RAISE EXCEPTION
        'That transition already completed with different payment details. Refresh before making a correction.';
    END IF;
    RETURN to_jsonb(v_payment);
  END IF;
  IF v_payment.status = 'paid' THEN
    RAISE EXCEPTION 'A paid pay app cannot move backward to approved.';
  END IF;

  SELECT project.require_compliance_gating
    INTO STRICT v_gating_enabled
  FROM public.projects project
  WHERE project.id = v_payment.project_id
  FOR SHARE;

  v_gate_date := CASE
    WHEN p_status = 'paid' THEN COALESCE(p_paid_date, v_payment.payment_date)
    ELSE v_payment.payment_date
  END;

  IF v_gating_enabled THEN
    SELECT certificate.id
      INTO v_certificate_id
    FROM public.insurance_certificates certificate
    WHERE certificate.project_id = v_payment.project_id
      AND certificate.subcontract_id = v_payment.subcontract_id
      AND certificate.verified
      AND (certificate.effective_date IS NULL OR certificate.effective_date <= v_gate_date)
      AND (certificate.expiry_date IS NULL OR certificate.expiry_date >= v_gate_date)
    ORDER BY certificate.expiry_date DESC NULLS FIRST, certificate.id
    FOR SHARE
    LIMIT 1;

    -- Prefer the waiver already attached to this pay app. If none exists, lock
    -- one unconsumed waiver from the subcontract pool for an atomic assignment.
    SELECT waiver.id
      INTO v_waiver_id
    FROM public.lien_waivers waiver
    WHERE waiver.project_id = v_payment.project_id
      AND waiver.subcontract_id = v_payment.subcontract_id
      AND waiver.payment_id = v_payment.id
      AND waiver.signed_date IS NOT NULL
      AND waiver.signed_date <= CURRENT_DATE
      AND length(trim(COALESCE(waiver.storage_path, ''))) > 0
      AND length(trim(COALESCE(waiver.file_name, ''))) > 0
      AND waiver.through_date IS NOT NULL
      AND waiver.through_date >= v_gate_date
      AND waiver.amount >= v_payment.amount
    ORDER BY waiver.created_at, waiver.id
    FOR UPDATE
    LIMIT 1;

    IF v_waiver_id IS NULL THEN
      SELECT waiver.id
        INTO v_waiver_id
      FROM public.lien_waivers waiver
      WHERE waiver.project_id = v_payment.project_id
        AND waiver.subcontract_id = v_payment.subcontract_id
        AND waiver.payment_id IS NULL
        AND waiver.signed_date IS NOT NULL
        AND waiver.signed_date <= CURRENT_DATE
        AND length(trim(COALESCE(waiver.storage_path, ''))) > 0
        AND length(trim(COALESCE(waiver.file_name, ''))) > 0
        AND waiver.through_date IS NOT NULL
        AND waiver.through_date >= v_gate_date
        AND waiver.amount >= v_payment.amount
      ORDER BY waiver.created_at, waiver.id
      FOR UPDATE
      LIMIT 1;
    END IF;

    v_overriding := (v_certificate_id IS NULL OR v_waiver_id IS NULL)
      AND length(v_override_reason) > 0;

    IF (v_certificate_id IS NULL OR v_waiver_id IS NULL) AND NOT v_overriding THEN
      RAISE EXCEPTION '%', concat_ws(
        ' ',
        'Compliance not met:',
        CASE
          WHEN v_certificate_id IS NULL
            THEN 'No verified certificate of insurance is in force on the payment date.'
        END,
        CASE
          WHEN v_waiver_id IS NULL
            THEN 'A signed lien waiver must be attached to this pay app.'
        END
      );
    END IF;

    IF NOT v_overriding THEN
      PERFORM set_config('overwatch.lien_waiver_atomic_write', 'on', true);
      UPDATE public.lien_waivers waiver
      SET payment_id = v_payment.id
      WHERE waiver.id = v_waiver_id
        AND (waiver.payment_id IS NULL OR waiver.payment_id = v_payment.id);

      IF NOT FOUND THEN
        RAISE EXCEPTION
          'Payment blocked: the selected lien waiver was consumed by another payment. Try again.';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('overwatch.subcontract_payment_atomic_write', 'on', true);
  UPDATE public.subcontract_payments payment
  SET status = p_status,
      approved_at = COALESCE(payment.approved_at, now()),
      payment_method = CASE
        WHEN p_status = 'paid' AND p_payment_method IS NOT NULL
          THEN left(p_payment_method, 40)
        ELSE payment.payment_method
      END,
      reference = CASE
        WHEN p_status = 'paid' AND p_payment_reference IS NOT NULL
          THEN left(p_payment_reference, 200)
        ELSE payment.reference
      END,
      payment_date = CASE
        WHEN p_status = 'paid' AND p_paid_date IS NOT NULL THEN p_paid_date
        ELSE payment.payment_date
      END,
      compliance_override_reason = CASE
        WHEN v_overriding THEN v_override_reason
        ELSE payment.compliance_override_reason
      END,
      compliance_overridden_by = CASE
        WHEN v_overriding THEN v_user_id
        ELSE payment.compliance_overridden_by
      END,
      compliance_overridden_at = CASE
        WHEN v_overriding THEN now()
        ELSE payment.compliance_overridden_at
      END
  WHERE payment.id = v_payment.id
  RETURNING payment.* INTO STRICT v_payment;

  RETURN to_jsonb(v_payment);
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic manual waiver attach/detach
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.attach_lien_waiver_to_payment_atomic(
  p_waiver_id uuid,
  p_payment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_subcontract_id uuid;
  v_payment public.subcontract_payments%ROWTYPE;
  v_waiver public.lien_waivers%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to attach a lien waiver.';
  END IF;

  SELECT payment.project_id, payment.subcontract_id
    INTO v_project_id, v_subcontract_id
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That pay app was not found.';
  END IF;

  PERFORM 1
  FROM public.subcontracts subcontract
  WHERE subcontract.id = v_subcontract_id
    AND subcontract.project_id = v_project_id
  FOR UPDATE;

  SELECT payment.*
    INTO STRICT v_payment
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id
  FOR UPDATE;
  SELECT waiver.*
    INTO STRICT v_waiver
  FROM public.lien_waivers waiver
  WHERE waiver.id = p_waiver_id
  FOR UPDATE;

  IF NOT public.can_manage_project(v_payment.project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF v_waiver.project_id <> v_payment.project_id
     OR v_waiver.subcontract_id <> v_payment.subcontract_id THEN
    RAISE EXCEPTION 'That lien waiver belongs to a different subcontract.';
  END IF;
  IF v_waiver.signed_date IS NULL
     OR v_waiver.signed_date > CURRENT_DATE
     OR length(trim(COALESCE(v_waiver.storage_path, ''))) = 0
     OR length(trim(COALESCE(v_waiver.file_name, ''))) = 0
     OR v_waiver.through_date IS NULL
     OR v_waiver.through_date < v_payment.payment_date
     OR v_waiver.amount < v_payment.amount THEN
    RAISE EXCEPTION
      'Attach a signed waiver file that covers the payment date before approving this pay app.';
  END IF;
  IF v_waiver.payment_id = v_payment.id THEN
    RETURN true;
  END IF;
  IF v_waiver.payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'That lien waiver already covers another payment. Collect a new waiver.';
  END IF;

  PERFORM set_config('overwatch.lien_waiver_atomic_write', 'on', true);
  UPDATE public.lien_waivers waiver
  SET payment_id = v_payment.id
  WHERE waiver.id = v_waiver.id
    AND waiver.payment_id IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That lien waiver was consumed by another payment. Refresh and try again.';
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.detach_lien_waiver_from_payment_atomic(
  p_waiver_id uuid,
  p_payment_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid;
  v_subcontract_id uuid;
  v_payment public.subcontract_payments%ROWTYPE;
  v_waiver public.lien_waivers%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to detach a lien waiver.';
  END IF;

  SELECT payment.project_id, payment.subcontract_id
    INTO v_project_id, v_subcontract_id
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'That pay app was not found.';
  END IF;

  PERFORM 1
  FROM public.subcontracts subcontract
  WHERE subcontract.id = v_subcontract_id
    AND subcontract.project_id = v_project_id
  FOR UPDATE;

  SELECT payment.*
    INTO STRICT v_payment
  FROM public.subcontract_payments payment
  WHERE payment.id = p_payment_id
  FOR UPDATE;
  SELECT waiver.*
    INTO STRICT v_waiver
  FROM public.lien_waivers waiver
  WHERE waiver.id = p_waiver_id
  FOR UPDATE;

  IF NOT public.can_manage_project(v_payment.project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF v_waiver.project_id <> v_payment.project_id
     OR v_waiver.subcontract_id <> v_payment.subcontract_id
     OR v_waiver.payment_id IS DISTINCT FROM v_payment.id THEN
    RAISE EXCEPTION 'That lien waiver is not attached to this pay app.';
  END IF;
  IF v_payment.status <> 'draft' THEN
    RAISE EXCEPTION
      'An approved or paid pay app must retain its lien waiver; it cannot be detached.';
  END IF;

  PERFORM set_config('overwatch.lien_waiver_atomic_write', 'on', true);
  UPDATE public.lien_waivers waiver
  SET payment_id = NULL
  WHERE waiver.id = v_waiver.id
    AND waiver.payment_id = v_payment.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The lien waiver attachment changed. Refresh and try again.';
  END IF;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- Serialize estimate-line mutations and import/recalculate atomically
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_lock_estimate_line_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_estimate_ids uuid[];
BEGIN
  v_estimate_ids := CASE
    WHEN TG_OP = 'DELETE' THEN ARRAY[OLD.estimate_id]
    WHEN TG_OP = 'UPDATE' AND OLD.estimate_id IS DISTINCT FROM NEW.estimate_id
      THEN ARRAY[OLD.estimate_id, NEW.estimate_id]
    ELSE ARRAY[NEW.estimate_id]
  END;

  -- This row lock makes direct line edits wait for an import transaction and
  -- makes concurrent imports run one at a time per estimate. Ordering the IDs
  -- also prevents two cross-estimate moves from taking locks in reverse order.
  PERFORM 1
  FROM public.estimates estimate
  WHERE estimate.id = ANY(v_estimate_ids)
  ORDER BY estimate.id
  FOR UPDATE;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS estimate_line_items_lock_parent
  ON public.estimate_line_items;
CREATE TRIGGER estimate_line_items_lock_parent
  BEFORE INSERT OR UPDATE OR DELETE
  ON public.estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_lock_estimate_line_parent();

CREATE OR REPLACE FUNCTION public.import_estimate_line_items_atomic(
  p_estimate_id uuid,
  p_mode text,
  p_rows jsonb,
  p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate public.estimates%ROWTYPE;
  v_row_count integer;
  v_next_sort_order integer;
  v_material_cents bigint;
  v_labor_cents bigint;
  v_direct_cents bigint;
  v_adjusted_material_cents bigint;
  v_adjusted_labor_cents bigint;
  v_adjusted_direct_cents bigint;
  v_tax_cents bigint;
  v_overhead_cents bigint;
  v_profit_cents bigint;
  v_contingency_cents bigint;
  v_bond_cents bigint;
  v_general_conditions_cents bigint;
  v_custom_markup_cents bigint := 0;
  v_total_cents bigint;
  v_markup jsonb;
  v_markup_pct numeric;
  v_markup_base bigint;
  v_idempotency_key text := trim(COALESCE(p_idempotency_key, ''));
  v_idempotency_fingerprint text;
  v_existing_fingerprint text;
  v_existing_result jsonb;
  v_result jsonb;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to import estimate rows.';
  END IF;
  IF p_mode NOT IN ('append', 'replace') THEN
    RAISE EXCEPTION 'Import mode must be append or replace.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Estimate import rows must be a JSON array.';
  END IF;
  IF length(v_idempotency_key) = 0 OR length(v_idempotency_key) > 200 THEN
    RAISE EXCEPTION 'A valid estimate-import idempotency key is required.';
  END IF;

  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count < 1 OR v_row_count > 500 THEN
    RAISE EXCEPTION 'Estimate imports must contain between 1 and 500 rows.';
  END IF;

  IF NOT public.can_manage_estimate(p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate not found or you do not have permission to edit it.';
  END IF;

  -- Direct row edits acquire a line lock before their parent-lock trigger.
  -- Take existing line locks in deterministic order before the parent so an
  -- import cannot form a parent -> child / child -> parent deadlock cycle.
  PERFORM line.id
  FROM public.estimate_line_items line
  WHERE line.estimate_id = p_estimate_id
  ORDER BY line.id
  FOR UPDATE;

  SELECT estimate.*
    INTO v_estimate
  FROM public.estimates estimate
  WHERE estimate.id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found or you do not have permission to edit it.';
  END IF;

  v_idempotency_fingerprint := md5(jsonb_build_array(
    p_estimate_id,
    p_mode,
    p_rows
  )::text);

  SELECT operation.idempotency_fingerprint, operation.result
    INTO v_existing_fingerprint, v_existing_result
  FROM public.estimate_import_operations operation
  WHERE operation.estimate_id = p_estimate_id
    AND operation.idempotency_key = v_idempotency_key;

  IF FOUND THEN
    IF v_existing_fingerprint IS DISTINCT FROM v_idempotency_fingerprint THEN
      RAISE EXCEPTION
        'This estimate-import idempotency key was already used for different rows or mode.';
    END IF;
    RETURN v_existing_result;
  END IF;

  -- Validate the raw JSON contract before touching the existing worksheet.
  -- Costs may legitimately be zero, but quantities must be positive and every
  -- money input must be a nonnegative integer-cent value.
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    WHERE jsonb_typeof(item.value) <> 'object'
      OR length(trim(COALESCE(item.value ->> 'description', ''))) = 0
      OR length(trim(COALESCE(item.value ->> 'unit', ''))) = 0
      OR CASE
        WHEN COALESCE(item.value ->> 'quantity', '') ~ '^\d+(\.\d{1,4})?$'
          THEN (item.value ->> 'quantity')::numeric <= 0
            OR (item.value ->> 'quantity')::numeric > 999999999
        ELSE true
      END
      OR CASE
        WHEN COALESCE(item.value ->> 'material_unit_cost_cents', '') ~ '^\d+$'
          THEN (item.value ->> 'material_unit_cost_cents')::numeric > 999999999
        ELSE true
      END
      OR CASE
        WHEN COALESCE(item.value ->> 'labor_unit_cost_cents', '') ~ '^\d+$'
          THEN (item.value ->> 'labor_unit_cost_cents')::numeric > 999999999
        ELSE true
      END
  ) THEN
    RAISE EXCEPTION
      'Each estimate row requires a description, unit, positive quantity, and nonnegative integer-cent unit costs.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    WHERE NULLIF(item.value ->> 'library_item_id', '') IS NOT NULL
      AND COALESCE(item.value ->> 'library_item_id', '') !~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) THEN
    RAISE EXCEPTION 'An imported cost-library reference is not a valid identifier.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_rows) item(value)
    WHERE NULLIF(item.value ->> 'library_item_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.cost_library_items library_item
        WHERE library_item.id = (item.value ->> 'library_item_id')::uuid
          AND library_item.organization_id = v_estimate.organization_id
      )
  ) THEN
    RAISE EXCEPTION
      'An imported cost-library item is unavailable or belongs to another organization.';
  END IF;

  IF p_mode = 'replace' THEN
    DELETE FROM public.estimate_line_items line
    WHERE line.estimate_id = p_estimate_id;
    v_next_sort_order := 1;
  ELSE
    SELECT COALESCE(max(line.sort_order), 0) + 1
      INTO v_next_sort_order
    FROM public.estimate_line_items line
    WHERE line.estimate_id = p_estimate_id;
  END IF;

  INSERT INTO public.estimate_line_items (
    estimate_id,
    csi_division,
    cost_code,
    description,
    unit,
    quantity,
    material_unit_cost_cents,
    labor_unit_cost_cents,
    library_item_id,
    scope_group,
    notes,
    sort_order,
    quantity_source
  )
  SELECT
    p_estimate_id,
    left(trim(COALESCE(item.value ->> 'csi_division', '')), 8),
    left(trim(COALESCE(item.value ->> 'cost_code', '')), 32),
    left(trim(COALESCE(item.value ->> 'description', '')), 500),
    upper(left(trim(COALESCE(item.value ->> 'unit', '')), 16)),
    CASE
      WHEN upper(left(trim(COALESCE(item.value ->> 'unit', '')), 16)) = 'LS' THEN 1
      ELSE (item.value ->> 'quantity')::numeric
    END,
    (item.value ->> 'material_unit_cost_cents')::integer,
    (item.value ->> 'labor_unit_cost_cents')::integer,
    NULLIF(item.value ->> 'library_item_id', '')::uuid,
    left(trim(COALESCE(item.value ->> 'scope_group', '')), 200),
    left(trim(COALESCE(item.value ->> 'notes', '')), 2000),
    v_next_sort_order + item.ordinality::integer - 1,
    'manual'
  FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality);

  -- Recalculate from authoritative line quantities/costs inside this same
  -- transaction. The formulas mirror calculateEstimateTotals in the app.
  SELECT
    round(COALESCE(sum(line.quantity * line.material_unit_cost_cents), 0))::bigint,
    round(COALESCE(sum(line.quantity * line.labor_unit_cost_cents), 0))::bigint
    INTO v_material_cents, v_labor_cents
  FROM public.estimate_line_items line
  WHERE line.estimate_id = p_estimate_id;

  v_direct_cents := v_material_cents + v_labor_cents;
  v_adjusted_material_cents := round(
    v_material_cents * greatest(0, COALESCE(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_labor_cents := round(
    v_labor_cents * greatest(0, COALESCE(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_direct_cents := v_adjusted_material_cents + v_adjusted_labor_cents;
  v_tax_cents := round(
    v_adjusted_material_cents * greatest(0, v_estimate.tax_pct) / 10000.0
  )::bigint;
  v_overhead_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.overhead_pct) / 10000.0
  )::bigint;
  v_profit_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.profit_pct) / 10000.0
  )::bigint;
  v_contingency_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.contingency_pct) / 10000.0
  )::bigint;
  v_bond_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.bond_pct) / 10000.0
  )::bigint;
  v_general_conditions_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.general_conditions_pct) / 10000.0
  )::bigint;

  FOR v_markup IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_estimate.custom_markups, '[]'::jsonb))
  LOOP
    v_markup_pct := CASE
      WHEN COALESCE(v_markup ->> 'pct', '') ~ '^\d+(\.\d+)?$'
        THEN greatest(0, (v_markup ->> 'pct')::numeric)
      ELSE 0
    END;
    v_markup_base := CASE v_markup ->> 'applies_to'
      WHEN 'material' THEN v_adjusted_material_cents
      WHEN 'labor' THEN v_adjusted_labor_cents
      ELSE v_adjusted_direct_cents
    END;
    v_custom_markup_cents := v_custom_markup_cents
      + round(v_markup_base * v_markup_pct / 10000.0)::bigint;
  END LOOP;

  v_total_cents :=
    v_adjusted_direct_cents
    + v_tax_cents
    + v_overhead_cents
    + v_profit_cents
    + v_contingency_cents
    + v_bond_cents
    + v_general_conditions_cents
    + v_custom_markup_cents;

  PERFORM set_config('overwatch.estimate_derived_totals_write', 'on', true);
  UPDATE public.estimates estimate
  SET subtotal_material_cents = v_material_cents,
      subtotal_labor_cents = v_labor_cents,
      subtotal_cents = v_direct_cents,
      total_with_markups_cents = v_total_cents
  WHERE estimate.id = p_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate totals could not be updated.';
  END IF;

  v_result := jsonb_build_object(
    'created_count', v_row_count,
    'subtotal_material_cents', v_material_cents,
    'subtotal_labor_cents', v_labor_cents,
    'subtotal_cents', v_direct_cents,
    'total_with_markups_cents', v_total_cents
  );

  INSERT INTO public.estimate_import_operations (
    estimate_id,
    idempotency_key,
    idempotency_fingerprint,
    result,
    created_by
  ) VALUES (
    p_estimate_id,
    v_idempotency_key,
    v_idempotency_fingerprint,
    v_result,
    (SELECT auth.uid())
  );

  RETURN v_result;
END;
$$;

-- Every direct line mutation and every markup change must keep the persisted
-- estimate totals in the same transaction. Application-side recalculation is
-- still useful for returning fresh data, but it is no longer the integrity
-- boundary.
CREATE OR REPLACE FUNCTION public.recalculate_estimate_totals_from_lines(
  p_estimate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate public.estimates%ROWTYPE;
  v_material_cents bigint;
  v_labor_cents bigint;
  v_direct_cents bigint;
  v_adjusted_material_cents bigint;
  v_adjusted_labor_cents bigint;
  v_adjusted_direct_cents bigint;
  v_tax_cents bigint;
  v_overhead_cents bigint;
  v_profit_cents bigint;
  v_contingency_cents bigint;
  v_bond_cents bigint;
  v_general_conditions_cents bigint;
  v_custom_markup_cents bigint := 0;
  v_total_cents bigint;
  v_markup jsonb;
  v_markup_pct numeric;
  v_markup_base bigint;
BEGIN
  SELECT estimate.*
    INTO v_estimate
  FROM public.estimates estimate
  WHERE estimate.id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT
    round(COALESCE(sum(line.quantity * line.material_unit_cost_cents), 0))::bigint,
    round(COALESCE(sum(line.quantity * line.labor_unit_cost_cents), 0))::bigint
    INTO v_material_cents, v_labor_cents
  FROM public.estimate_line_items line
  WHERE line.estimate_id = p_estimate_id;

  v_direct_cents := v_material_cents + v_labor_cents;
  v_adjusted_material_cents := round(
    v_material_cents * greatest(0, COALESCE(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_labor_cents := round(
    v_labor_cents * greatest(0, COALESCE(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_direct_cents := v_adjusted_material_cents + v_adjusted_labor_cents;
  v_tax_cents := round(
    v_adjusted_material_cents * greatest(0, v_estimate.tax_pct) / 10000.0
  )::bigint;
  v_overhead_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.overhead_pct) / 10000.0
  )::bigint;
  v_profit_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.profit_pct) / 10000.0
  )::bigint;
  v_contingency_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.contingency_pct) / 10000.0
  )::bigint;
  v_bond_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.bond_pct) / 10000.0
  )::bigint;
  v_general_conditions_cents := round(
    v_adjusted_direct_cents * greatest(0, v_estimate.general_conditions_pct) / 10000.0
  )::bigint;

  FOR v_markup IN
    SELECT value
    FROM jsonb_array_elements(COALESCE(v_estimate.custom_markups, '[]'::jsonb))
  LOOP
    v_markup_pct := CASE
      WHEN COALESCE(v_markup ->> 'pct', '') ~ '^\d+(\.\d+)?$'
        THEN greatest(0, (v_markup ->> 'pct')::numeric)
      ELSE 0
    END;
    v_markup_base := CASE v_markup ->> 'applies_to'
      WHEN 'material' THEN v_adjusted_material_cents
      WHEN 'labor' THEN v_adjusted_labor_cents
      ELSE v_adjusted_direct_cents
    END;
    v_custom_markup_cents := v_custom_markup_cents
      + round(v_markup_base * v_markup_pct / 10000.0)::bigint;
  END LOOP;

  v_total_cents :=
    v_adjusted_direct_cents
    + v_tax_cents
    + v_overhead_cents
    + v_profit_cents
    + v_contingency_cents
    + v_bond_cents
    + v_general_conditions_cents
    + v_custom_markup_cents;

  PERFORM set_config('overwatch.estimate_derived_totals_write', 'on', true);
  UPDATE public.estimates estimate
  SET subtotal_material_cents = v_material_cents,
      subtotal_labor_cents = v_labor_cents,
      subtotal_cents = v_direct_cents,
      total_with_markups_cents = v_total_cents
  WHERE estimate.id = p_estimate_id;

  RETURN jsonb_build_object(
    'subtotal_material_cents', v_material_cents,
    'subtotal_labor_cents', v_labor_cents,
    'subtotal_cents', v_direct_cents,
    'total_with_markups_cents', v_total_cents
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.recalculate_estimate_totals_atomic(
  p_estimate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to recalculate an estimate.';
  END IF;
  IF NOT public.can_manage_estimate(p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate not found or you do not have permission to edit it.';
  END IF;
  RETURN public.recalculate_estimate_totals_from_lines(p_estimate_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_protect_estimate_derived_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF (
    OLD.subtotal_material_cents IS DISTINCT FROM NEW.subtotal_material_cents
    OR OLD.subtotal_labor_cents IS DISTINCT FROM NEW.subtotal_labor_cents
    OR OLD.subtotal_cents IS DISTINCT FROM NEW.subtotal_cents
    OR OLD.total_with_markups_cents IS DISTINCT FROM NEW.total_with_markups_cents
  ) AND COALESCE(
    current_setting('overwatch.estimate_derived_totals_write', true),
    ''
  ) <> 'on' THEN
    RAISE EXCEPTION
      'Estimate totals are derived from worksheet lines and cannot be edited directly.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimates_protect_derived_totals ON public.estimates;
CREATE TRIGGER estimates_protect_derived_totals
  BEFORE UPDATE OF
    subtotal_material_cents,
    subtotal_labor_cents,
    subtotal_cents,
    total_with_markups_cents
  ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_protect_estimate_derived_totals();

CREATE OR REPLACE FUNCTION public.tg_recalculate_estimate_line_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate_ids uuid[];
  v_estimate_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT row.estimate_id ORDER BY row.estimate_id)
      INTO v_estimate_ids
    FROM new_estimate_lines row;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT row.estimate_id ORDER BY row.estimate_id)
      INTO v_estimate_ids
    FROM old_estimate_lines row;
  ELSE
    SELECT array_agg(DISTINCT changed.estimate_id ORDER BY changed.estimate_id)
      INTO v_estimate_ids
    FROM (
      SELECT row.estimate_id FROM new_estimate_lines row
      UNION
      SELECT row.estimate_id FROM old_estimate_lines row
    ) changed;
  END IF;

  FOREACH v_estimate_id IN ARRAY COALESCE(v_estimate_ids, ARRAY[]::uuid[])
  LOOP
    PERFORM public.recalculate_estimate_totals_from_lines(v_estimate_id);
  END LOOP;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS estimate_line_items_recalculate_insert
  ON public.estimate_line_items;
CREATE TRIGGER estimate_line_items_recalculate_insert
  AFTER INSERT ON public.estimate_line_items
  REFERENCING NEW TABLE AS new_estimate_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_recalculate_estimate_line_totals();

DROP TRIGGER IF EXISTS estimate_line_items_recalculate_update
  ON public.estimate_line_items;
CREATE TRIGGER estimate_line_items_recalculate_update
  AFTER UPDATE ON public.estimate_line_items
  REFERENCING OLD TABLE AS old_estimate_lines NEW TABLE AS new_estimate_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_recalculate_estimate_line_totals();

DROP TRIGGER IF EXISTS estimate_line_items_recalculate_delete
  ON public.estimate_line_items;
CREATE TRIGGER estimate_line_items_recalculate_delete
  AFTER DELETE ON public.estimate_line_items
  REFERENCING OLD TABLE AS old_estimate_lines
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.tg_recalculate_estimate_line_totals();

CREATE OR REPLACE FUNCTION public.tg_recalculate_estimate_markup_totals()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM public.recalculate_estimate_totals_from_lines(NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS estimates_recalculate_markup_totals ON public.estimates;
CREATE TRIGGER estimates_recalculate_markup_totals
  AFTER UPDATE OF
    region_multiplier,
    overhead_pct,
    profit_pct,
    contingency_pct,
    bond_pct,
    tax_pct,
    general_conditions_pct,
    custom_markups
  ON public.estimates
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_recalculate_estimate_markup_totals();

-- Postgres grants function execution to PUBLIC by default. Restrict every
-- financial-integrity RPC/trigger explicitly, then expose only the user
-- entry points needed by the authenticated application.
REVOKE ALL ON FUNCTION public.tg_enforce_lien_waiver_assignment()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_payment_compliance()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_enforce_subcontract_payment_financial_record()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_lock_estimate_line_parent()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalculate_estimate_totals_from_lines(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.recalculate_estimate_totals_atomic(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_protect_estimate_derived_totals()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_recalculate_estimate_line_totals()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_recalculate_estimate_markup_totals()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.record_subcontract_payment_atomic(
  uuid, uuid, bigint, bigint, date, text, text, text, uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_subcontract_payment_atomic(
  uuid, text, text, text, text, date
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_subcontract_payment_allocations_atomic(uuid, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.attach_lien_waiver_to_payment_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.detach_lien_waiver_from_payment_atomic(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_estimate_line_items_atomic(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.record_subcontract_payment_atomic(
  uuid, uuid, bigint, bigint, date, text, text, text, uuid, text, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_subcontract_payment_atomic(
  uuid, text, text, text, text, date
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.replace_subcontract_payment_allocations_atomic(uuid, jsonb)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_lien_waiver_to_payment_atomic(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detach_lien_waiver_from_payment_atomic(uuid, uuid)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_estimate_line_items_atomic(uuid, text, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recalculate_estimate_totals_atomic(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
