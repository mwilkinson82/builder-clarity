-- Cost-actual command integrity.
--
-- Cost actuals remain dollar-denominated for compatibility with existing
-- reports/triggers, but integer cents are now the canonical write contract.
-- Authenticated/service clients can read the ledger and may mutate it only
-- through the six audited RPCs at the bottom of this migration. Every command
-- has a caller-stable operation key, an immutable payload fingerprint/result,
-- and transaction-scoped locks. A PostgreSQL function call is one transaction,
-- so import batches, rows, settlements, lifecycle stamps, and retry receipts
-- either all commit or all roll back.

-- Refuse to silently round historical financial facts. Correct the offending
-- record explicitly before retrying the Lovable-managed migration.
DO $cost_actual_cent_audit$
DECLARE
  v_cost_actual_id uuid;
BEGIN
  SELECT actual.id
    INTO v_cost_actual_id
  FROM public.cost_actuals actual
  WHERE actual.amount * 100 <> trunc(actual.amount * 100)
     OR actual.daily_wip_offset * 100 <> trunc(actual.daily_wip_offset * 100)
     OR abs(actual.amount * 100) > 9007199254740991
     OR abs(actual.daily_wip_offset * 100) > 9007199254740991
  ORDER BY actual.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = format('Cost actual %s contains fractional-cent money.', v_cost_actual_id),
      hint = 'Correct amount and daily WIP offset to exact cents before retrying this migration.';
  END IF;
END;
$cost_actual_cent_audit$;

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS amount_cents bigint,
  ADD COLUMN IF NOT EXISTS daily_wip_offset_cents bigint;

ALTER TABLE public.cost_actual_payments
  ADD COLUMN IF NOT EXISTS operation_key text;

UPDATE public.cost_actuals
SET amount_cents = round(amount * 100)::bigint,
    daily_wip_offset_cents = round(daily_wip_offset * 100)::bigint
WHERE amount_cents IS NULL
   OR daily_wip_offset_cents IS NULL;

ALTER TABLE public.cost_actuals
  ALTER COLUMN amount_cents SET DEFAULT 0,
  ALTER COLUMN amount_cents SET NOT NULL,
  ALTER COLUMN daily_wip_offset_cents SET DEFAULT 0,
  ALTER COLUMN daily_wip_offset_cents SET NOT NULL;

UPDATE public.cost_actual_payments
SET operation_key = 'legacy:' || id::text
WHERE operation_key IS NULL OR length(btrim(operation_key)) = 0;

ALTER TABLE public.cost_actual_payments
  ALTER COLUMN operation_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS cost_actual_payments_project_operation_unique
  ON public.cost_actual_payments (project_id, operation_key);

ALTER TABLE public.cost_actual_payments
  DROP CONSTRAINT IF EXISTS cost_actual_payments_operation_key_present;
ALTER TABLE public.cost_actual_payments
  ADD CONSTRAINT cost_actual_payments_operation_key_present CHECK (
    length(btrim(operation_key)) BETWEEN 1 AND 240
  );

COMMENT ON COLUMN public.cost_actual_payments.operation_key IS
  'Stable settlement command key; retries return the original append-only payment.';

-- Name the offending row for each daily-WIP invariant the constraint below
-- enforces, instead of aborting other environments with an anonymous check
-- violation: a non-positive cost cannot carry a daily-WIP settlement, and a
-- positive cost cannot settle more daily WIP than its own amount.
DO $cost_actual_wip_offset_audit$
DECLARE
  v_cost_actual_id uuid;
BEGIN
  SELECT actual.id
    INTO v_cost_actual_id
  FROM public.cost_actuals actual
  WHERE actual.amount_cents <= 0
    AND actual.daily_wip_offset_cents <> 0
  ORDER BY actual.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = format('Cost actual %s is a non-positive cost carrying a daily WIP offset.', v_cost_actual_id),
      hint = 'Zero the daily WIP offset on credit and zero-amount rows before retrying this migration.';
  END IF;

  SELECT actual.id
    INTO v_cost_actual_id
  FROM public.cost_actuals actual
  WHERE actual.amount_cents > 0
    AND actual.daily_wip_offset_cents > actual.amount_cents
  ORDER BY actual.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = format('Cost actual %s settles more daily WIP than its own amount.', v_cost_actual_id),
      hint = 'Reduce the daily WIP offset to at most the cost amount before retrying this migration.';
  END IF;
END;
$cost_actual_wip_offset_audit$;

ALTER TABLE public.cost_actuals
  DROP CONSTRAINT IF EXISTS cost_actuals_exact_cents_check;
ALTER TABLE public.cost_actuals
  ADD CONSTRAINT cost_actuals_exact_cents_check CHECK (
    amount = amount_cents::numeric / 100.0
    AND daily_wip_offset = daily_wip_offset_cents::numeric / 100.0
    AND daily_wip_offset_cents >= 0
    AND abs(amount_cents::numeric) <= 9007199254740991
    AND daily_wip_offset_cents::numeric <= 9007199254740991
    AND (
      amount_cents > 0
      OR daily_wip_offset_cents = 0
    )
    AND (
      amount_cents <= 0
      OR daily_wip_offset_cents <= amount_cents
    )
  );

DO $cost_actual_payment_safe_audit$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.cost_actual_payments payment
    WHERE payment.amount_cents <= 0
      OR payment.amount_cents::numeric > 9007199254740991
  ) THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = 'Cost payment integrity migration blocked: payment cents exceed the supported safe money domain.';
  END IF;
END;
$cost_actual_payment_safe_audit$;

ALTER TABLE public.cost_actual_payments
  DROP CONSTRAINT IF EXISTS cost_actual_payments_safe_cents_check;
ALTER TABLE public.cost_actual_payments
  ADD CONSTRAINT cost_actual_payments_safe_cents_check CHECK (
    amount_cents > 0
    AND amount_cents::numeric <= 9007199254740991
  );

COMMENT ON COLUMN public.cost_actuals.amount_cents IS
  'Canonical signed cost amount. Public command inputs must use integer cents.';
COMMENT ON COLUMN public.cost_actuals.daily_wip_offset_cents IS
  'Canonical nonnegative daily-WIP settlement amount in integer cents.';

-- Keep the legacy credit-link trigger aligned with the command lifecycle. An
-- existing linked draft must be able to move to void even if its same-project
-- target was paid, voided, or removed before this migration. Inserts and every
-- recognized-credit reversal retain strict target validation.
CREATE OR REPLACE FUNCTION public.validate_cost_actual_credit_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_target_project_id uuid;
  v_target_amount_cents bigint;
  v_target_status text;
  v_payment_cents bigint;
  v_other_credit_cents bigint;
BEGIN
  IF NEW.credit_applies_to_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id = NEW.credit_applies_to_id THEN
    RAISE EXCEPTION 'A credit cannot be applied to itself.';
  END IF;

  SELECT target.project_id, target.amount_cents, target.status
    INTO v_target_project_id, v_target_amount_cents, v_target_status
  FROM public.cost_actuals target
  WHERE target.id = NEW.credit_applies_to_id;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'draft' AND NEW.status = 'void' THEN
      IF FOUND AND v_target_project_id <> NEW.project_id THEN
        RAISE EXCEPTION 'A supplier-credit draft cannot link across projects.';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF NOT FOUND
     OR v_target_project_id <> NEW.project_id
     OR v_target_amount_cents <= 0
     OR v_target_status IN ('draft', 'paid', 'void') THEN
    RAISE EXCEPTION 'Pick an approved or committed positive cost from this project for the credit.';
  END IF;

  -- Draft credits reserve no balance. Recognition must still remain within the
  -- invoice after append-only cash and every other recognized supplier credit.
  IF NEW.status IN ('committed', 'approved', 'paid') THEN
    SELECT COALESCE(sum(payment.amount_cents), 0)::bigint
      INTO v_payment_cents
    FROM public.cost_actual_payments payment
    WHERE payment.cost_actual_id = NEW.credit_applies_to_id;

    SELECT COALESCE(sum(abs(credit.amount_cents)), 0)::bigint
      INTO v_other_credit_cents
    FROM public.cost_actuals credit
    WHERE credit.credit_applies_to_id = NEW.credit_applies_to_id
      AND credit.id <> NEW.id
      AND credit.status IN ('committed', 'approved', 'paid');

    IF v_payment_cents + v_other_credit_cents + abs(NEW.amount_cents) >
       v_target_amount_cents THEN
      RAISE EXCEPTION 'Credit exceeds the invoice remaining balance.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_cost_actual_credit_link()
  FROM PUBLIC, anon, authenticated, service_role;

-- The retry journal is deliberately outside the Data API schema. Only the
-- SECURITY DEFINER command boundary can append to it; rows cannot be rewritten.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.cost_actual_command_operations (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  operation_key text NOT NULL,
  command_type text NOT NULL,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, operation_key),
  CONSTRAINT cost_actual_command_operation_key_present
    CHECK (length(btrim(operation_key)) BETWEEN 1 AND 200),
  CONSTRAINT cost_actual_command_type_present
    CHECK (length(btrim(command_type)) BETWEEN 1 AND 80),
  CONSTRAINT cost_actual_command_fingerprint_present
    CHECK (length(payload_fingerprint) = 32)
);

ALTER TABLE private.cost_actual_command_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.cost_actual_command_operations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.tg_keep_cost_command_journal_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.projects project WHERE project.id = OLD.project_id
  ) THEN
    -- Allow the project's FK cascade to remove its private retry metadata.
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    errcode = '23514',
    message = 'Cost command receipts are immutable.';
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent factual edit
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_cost_actual_atomic(
  p_cost_actual_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_project_id uuid;
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_bucket public.cost_buckets%ROWTYPE;
  v_result jsonb;
  v_amount_cents bigint;
  v_offset_cents bigint;
  v_bucket_id uuid;
  v_credit_id uuid;
  v_exposure_id uuid;
  v_subcontract_change_order_id uuid;
  v_subcontract_payment_id uuid;
  v_cost_date date;
  v_cost_code text;
  v_attachment_size bigint;
BEGIN
  IF p_cost_actual_id IS NULL THEN
    RAISE EXCEPTION 'A cost actual is required.';
  END IF;
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to edit a cost actual.';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Cost details must be a JSON object.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid cost operation key is required.';
  END IF;

  SELECT actual.project_id
    INTO v_project_id
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost actual not found.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(v_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'update_cost_actual_atomic', p_cost_actual_id, p_payload
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_project_id::text || ':' || v_operation_key, 0
  ));

  SELECT operation.*
    INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = v_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'update_cost_actual_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This cost operation key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT actual.*
    INTO v_actual
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost actual not found.';
  END IF;
  IF v_actual.project_id <> v_project_id THEN
    RAISE EXCEPTION 'Cost actual project changed while the command was waiting. Retry with a new operation key.';
  END IF;
  IF v_actual.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Paid and void cost actuals cannot be edited. Enter a correcting cost instead.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cost_actual_payments payment
    WHERE payment.cost_actual_id = p_cost_actual_id
  ) THEN
    RAISE EXCEPTION 'A partially settled cost cannot be edited. Complete or correct it through the settlement workflow.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cost_actuals credit
    WHERE credit.credit_applies_to_id = p_cost_actual_id
      AND credit.status <> 'void'
  ) THEN
    RAISE EXCEPTION 'A cost with a linked supplier credit cannot be edited until every linked credit is voided.';
  END IF;

  IF COALESCE(p_payload ->> 'amount_cents', '') !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION 'Cost amount_cents must be a signed integer.';
  END IF;
  v_amount_cents := (p_payload ->> 'amount_cents')::bigint;
  IF v_amount_cents = 0 OR abs(v_amount_cents::numeric) > 9007199254740991 THEN
    RAISE EXCEPTION 'Cost amount must be nonzero safe integer cents.';
  END IF;
  IF COALESCE(p_payload ->> 'daily_wip_offset_cents', v_actual.daily_wip_offset_cents::text) !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Daily WIP offset must be nonnegative integer cents.';
  END IF;
  v_offset_cents := COALESCE(
    p_payload ->> 'daily_wip_offset_cents',
    v_actual.daily_wip_offset_cents::text
  )::bigint;
  IF v_offset_cents::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Daily WIP offset exceeds the safe integer-cent domain.';
  END IF;
  IF (v_amount_cents < 0 AND v_offset_cents <> 0)
     OR (v_amount_cents > 0 AND v_offset_cents > v_amount_cents) THEN
    RAISE EXCEPTION 'Daily WIP offset cannot exceed a positive cost and must be zero for a credit.';
  END IF;

  IF length(btrim(COALESCE(p_payload ->> 'description', ''))) = 0
     OR length(p_payload ->> 'description') > 500 THEN
    RAISE EXCEPTION 'A cost description between 1 and 500 characters is required.';
  END IF;
  IF COALESCE(p_payload ->> 'category', v_actual.category) NOT IN
     ('direct', 'labor', 'material', 'equipment', 'subcontract', 'overhead') THEN
    RAISE EXCEPTION 'Invalid cost category.';
  END IF;
  IF length(COALESCE(p_payload ->> 'vendor', v_actual.vendor)) > 200
     OR length(COALESCE(p_payload ->> 'reference_number', v_actual.reference_number)) > 200
     OR length(COALESCE(p_payload ->> 'notes', v_actual.notes)) > 2000
     OR length(COALESCE(p_payload ->> 'invoice_attachment_path', v_actual.invoice_attachment_path)) > 1000
     OR length(COALESCE(p_payload ->> 'invoice_attachment_name', v_actual.invoice_attachment_name)) > 500
     OR length(COALESCE(p_payload ->> 'invoice_attachment_type', v_actual.invoice_attachment_type)) > 200 THEN
    RAISE EXCEPTION 'One or more cost details exceed their allowed length.';
  END IF;

  BEGIN
    v_cost_date := COALESCE(NULLIF(p_payload ->> 'cost_date', '')::date, v_actual.cost_date);
    v_bucket_id := CASE WHEN p_payload ? 'cost_bucket_id'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'cost_bucket_id', '')), '')::uuid
      ELSE v_actual.cost_bucket_id END;
    v_credit_id := CASE WHEN p_payload ? 'credit_applies_to_id'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'credit_applies_to_id', '')), '')::uuid
      ELSE v_actual.credit_applies_to_id END;
    v_exposure_id := CASE WHEN p_payload ? 'exposure_id'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'exposure_id', '')), '')::uuid
      ELSE v_actual.exposure_id END;
    v_subcontract_change_order_id := CASE WHEN p_payload ? 'subcontract_change_order_id'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'subcontract_change_order_id', '')), '')::uuid
      ELSE v_actual.subcontract_change_order_id END;
    v_subcontract_payment_id := CASE WHEN p_payload ? 'subcontract_payment_id'
      THEN NULLIF(btrim(COALESCE(p_payload ->> 'subcontract_payment_id', '')), '')::uuid
      ELSE v_actual.subcontract_payment_id END;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'A cost date or linked identifier is invalid.';
  END;

  IF v_subcontract_change_order_id IS NOT NULL AND v_subcontract_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Link a cost to either a subcontract change order or a progress payment, not both.';
  END IF;
  IF v_credit_id IS NOT NULL AND v_amount_cents >= 0 THEN
    RAISE EXCEPTION 'Only a negative supplier credit may link to another cost.';
  END IF;
  IF v_credit_id IS NOT NULL THEN
    PERFORM 1
    FROM public.cost_actuals target
    WHERE target.id = v_credit_id
      AND target.project_id = v_project_id
      AND target.amount_cents > 0
      AND target.status NOT IN ('draft', 'paid', 'void')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The supplier-credit target is unavailable, nonpositive, unapproved, paid, void, or belongs to another project.';
    END IF;
  END IF;

  IF v_bucket_id IS NOT NULL THEN
    SELECT bucket.*
      INTO v_bucket
    FROM public.cost_buckets bucket
    WHERE bucket.id = v_bucket_id
      AND bucket.project_id = v_project_id
    FOR SHARE;
  ELSIF length(btrim(COALESCE(p_payload ->> 'cost_code', ''))) > 0 THEN
    SELECT bucket.*
      INTO v_bucket
    FROM public.cost_buckets bucket
    WHERE bucket.project_id = v_project_id
      AND lower(btrim(bucket.cost_code)) = lower(btrim(p_payload ->> 'cost_code'))
    FOR SHARE;
  END IF;
  IF NOT FOUND OR v_bucket.id IS NULL THEN
    RAISE EXCEPTION 'A valid project cost bucket or exact project-local cost code is required.';
  END IF;
  IF length(btrim(v_bucket.cost_code)) > 0
     AND length(btrim(COALESCE(p_payload ->> 'cost_code', v_actual.cost_code))) > 0
     AND lower(btrim(v_bucket.cost_code)) <>
       lower(btrim(COALESCE(p_payload ->> 'cost_code', v_actual.cost_code))) THEN
    RAISE EXCEPTION 'The supplied cost code does not match the selected cost bucket.';
  END IF;
  v_bucket_id := v_bucket.id;
  v_cost_code := left(CASE
    WHEN length(btrim(v_bucket.cost_code)) > 0 THEN btrim(v_bucket.cost_code)
    ELSE btrim(COALESCE(p_payload ->> 'cost_code', v_actual.cost_code))
  END, 64);

  IF v_exposure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exposures exposure
    WHERE exposure.id = v_exposure_id AND exposure.project_id = v_project_id
  ) THEN
    RAISE EXCEPTION 'The linked risk is unavailable or belongs to another project.';
  END IF;
  IF v_subcontract_change_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontract_change_orders change_order
    WHERE change_order.id = v_subcontract_change_order_id
      AND change_order.project_id = v_project_id
      AND (change_order.cost_bucket_id IS NULL OR change_order.cost_bucket_id = v_bucket_id)
  ) THEN
    RAISE EXCEPTION 'The linked subcontract change order is unavailable, belongs to another project, or uses another cost bucket.';
  END IF;
  IF v_subcontract_payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontract_payments payment
    WHERE payment.id = v_subcontract_payment_id AND payment.project_id = v_project_id
  ) THEN
    RAISE EXCEPTION 'The linked subcontract payment is unavailable or belongs to another project.';
  END IF;

  IF p_payload ? 'invoice_attachment_size' THEN
    IF COALESCE(p_payload ->> 'invoice_attachment_size', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invoice attachment size must be a nonnegative integer.';
    END IF;
    v_attachment_size := (p_payload ->> 'invoice_attachment_size')::bigint;
  ELSE
    v_attachment_size := v_actual.invoice_attachment_size;
  END IF;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  UPDATE public.cost_actuals actual
  SET cost_bucket_id = v_bucket_id,
      cost_code = v_cost_code,
      description = btrim(p_payload ->> 'description'),
      category = COALESCE(p_payload ->> 'category', v_actual.category),
      amount = v_amount_cents::numeric / 100.0,
      amount_cents = v_amount_cents,
      vendor = COALESCE(p_payload ->> 'vendor', v_actual.vendor),
      reference_number = COALESCE(p_payload ->> 'reference_number', v_actual.reference_number),
      cost_date = v_cost_date,
      notes = COALESCE(p_payload ->> 'notes', v_actual.notes),
      daily_wip_offset = v_offset_cents::numeric / 100.0,
      daily_wip_offset_cents = v_offset_cents,
      invoice_attachment_path = COALESCE(p_payload ->> 'invoice_attachment_path', v_actual.invoice_attachment_path),
      invoice_attachment_name = COALESCE(p_payload ->> 'invoice_attachment_name', v_actual.invoice_attachment_name),
      invoice_attachment_type = COALESCE(p_payload ->> 'invoice_attachment_type', v_actual.invoice_attachment_type),
      invoice_attachment_size = v_attachment_size,
      credit_applies_to_id = CASE WHEN v_amount_cents < 0 THEN v_credit_id ELSE NULL END,
      exposure_id = v_exposure_id,
      subcontract_change_order_id = v_subcontract_change_order_id,
      subcontract_payment_id = v_subcontract_payment_id
  WHERE actual.id = p_cost_actual_id
  RETURNING actual.* INTO v_actual;

  v_result := jsonb_build_object(
    'ok', true,
    'cost_actual_id', v_actual.id,
    'project_id', v_actual.project_id,
    'cost_bucket_id', v_actual.cost_bucket_id,
    'amount_cents', v_actual.amount_cents,
    'status', v_actual.status
  );

  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    v_project_id, v_operation_key, 'update_cost_actual_atomic', v_fingerprint, v_result, v_actor
  );

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent void (audit-preserving reversal)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.void_cost_actual_atomic(
  p_cost_actual_id uuid,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_project_id uuid;
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to void a cost actual.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid void idempotency key is required.';
  END IF;
  IF length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'Void notes cannot exceed 2000 characters.';
  END IF;

  SELECT actual.project_id INTO v_project_id
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost actual not found.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(v_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'void_cost_actual_atomic', p_cost_actual_id, COALESCE(p_notes, '')
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_project_id::text || ':' || v_operation_key, 0
  ));
  SELECT operation.* INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = v_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'void_cost_actual_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This void idempotency key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT actual.* INTO v_actual
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id
  FOR UPDATE;
  IF NOT FOUND OR v_actual.project_id <> v_project_id THEN
    RAISE EXCEPTION 'Cost actual changed while the void was waiting. Retry with a new idempotency key.';
  END IF;
  IF v_actual.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Paid and void cost actuals are terminal and cannot be voided again.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cost_actual_payments payment
    WHERE payment.cost_actual_id = v_actual.id
  ) THEN
    RAISE EXCEPTION 'A cost with cash settlements cannot be voided. Use an auditable correction/refund workflow.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.cost_actuals credit
    WHERE credit.credit_applies_to_id = v_actual.id
      AND credit.status <> 'void'
  ) THEN
    RAISE EXCEPTION 'A cost with a linked supplier credit cannot be voided until every linked credit is voided.';
  END IF;
  IF v_actual.credit_applies_to_id IS NOT NULL THEN
    IF v_actual.status = 'draft' THEN
      -- A stale draft must always remain closable. Lock its target when the
      -- same-project row still exists, but do not require the target to remain
      -- positive or nonterminal merely to discard an unrecognized draft.
      PERFORM 1
      FROM public.cost_actuals target
      WHERE target.id = v_actual.credit_applies_to_id
        AND target.project_id = v_project_id
      FOR UPDATE;
    ELSE
      PERFORM 1
      FROM public.cost_actuals target
      WHERE target.id = v_actual.credit_applies_to_id
        AND target.project_id = v_project_id
        AND target.amount_cents > 0
        AND target.status NOT IN ('draft', 'paid', 'void')
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The supplier-credit target is no longer eligible for a credit reversal.';
      END IF;
    END IF;
  END IF;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  UPDATE public.cost_actuals actual
  SET status = 'void',
      voided_at = now(),
      voided_by = v_actor,
      notes = concat_ws(E'\n', NULLIF(actual.notes, ''), NULLIF(COALESCE(p_notes, ''), ''))
  WHERE actual.id = v_actual.id
  RETURNING actual.* INTO v_actual;

  v_result := jsonb_build_object(
    'ok', true,
    'cost_actual_id', v_actual.id,
    'status', v_actual.status,
    'voided_at', v_actual.voided_at
  );
  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    v_project_id, v_operation_key, 'void_cost_actual_atomic', v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent partial/full settlement
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.record_cost_actual_payment_atomic(
  p_cost_actual_id uuid,
  p_amount_cents bigint,
  p_payment_date date,
  p_payment_method text,
  p_payment_reference text,
  p_notes text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_project_id uuid;
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_result jsonb;
  v_payment_id uuid := gen_random_uuid();
  v_cash_paid_cents bigint;
  v_credit_cents bigint;
  v_settled_cents bigint;
  v_remaining_cents bigint;
  v_next_status text;
  v_effective_date date := COALESCE(p_payment_date, CURRENT_DATE);
BEGIN
  IF p_cost_actual_id IS NULL THEN
    RAISE EXCEPTION 'A cost actual is required.';
  END IF;
  IF p_amount_cents IS NULL
     OR p_amount_cents <= 0
     OR p_amount_cents::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Payment amount must be positive safe integer cents.';
  END IF;
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to record a cost payment.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid payment idempotency key is required.';
  END IF;
  IF length(COALESCE(p_payment_method, '')) > 40
     OR length(COALESCE(p_payment_reference, '')) > 200
     OR length(COALESCE(p_notes, '')) > 2000 THEN
    RAISE EXCEPTION 'Payment details exceed their allowed length.';
  END IF;

  SELECT actual.project_id
    INTO v_project_id
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost actual not found.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(v_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'record_cost_actual_payment_atomic',
    p_cost_actual_id,
    p_amount_cents,
    v_effective_date,
    COALESCE(p_payment_method, ''),
    COALESCE(p_payment_reference, ''),
    COALESCE(p_notes, '')
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_project_id::text || ':' || v_operation_key, 0
  ));

  SELECT operation.*
    INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = v_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'record_cost_actual_payment_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This payment idempotency key was already used for different settlement details.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT actual.*
    INTO v_actual
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id
  FOR UPDATE;
  IF NOT FOUND OR v_actual.project_id <> v_project_id THEN
    RAISE EXCEPTION 'Cost actual changed while the payment was waiting. Retry with a new idempotency key.';
  END IF;
  IF v_actual.cost_bucket_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cost_buckets bucket
    WHERE bucket.id = v_actual.cost_bucket_id
      AND bucket.project_id = v_actual.project_id
  ) THEN
    RAISE EXCEPTION 'Assign this cost to a valid project cost bucket before recording payment.';
  END IF;
  IF v_actual.amount_cents <= 0 OR v_actual.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Payments can only be recorded against an active positive cost with a remaining balance.';
  END IF;

  SELECT COALESCE(sum(payment.amount_cents), 0)::bigint
    INTO v_cash_paid_cents
  FROM public.cost_actual_payments payment
  WHERE payment.cost_actual_id = v_actual.id;

  SELECT COALESCE(sum(abs(credit.amount_cents)), 0)::bigint
    INTO v_credit_cents
  FROM public.cost_actuals credit
  WHERE credit.credit_applies_to_id = v_actual.id
    AND credit.status IN ('committed', 'approved', 'paid');

  v_remaining_cents := greatest(
    0,
    v_actual.amount_cents - v_cash_paid_cents - v_credit_cents
  );
  IF p_amount_cents > v_remaining_cents THEN
    RAISE EXCEPTION 'Payment exceeds the remaining balance of % cents.', v_remaining_cents;
  END IF;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  INSERT INTO public.cost_actual_payments (
    id,
    project_id,
    cost_actual_id,
    amount_cents,
    payment_date,
    payment_method,
    payment_reference,
    notes,
    operation_key,
    created_by
  ) VALUES (
    v_payment_id,
    v_project_id,
    v_actual.id,
    p_amount_cents,
    v_effective_date,
    COALESCE(p_payment_method, ''),
    COALESCE(p_payment_reference, ''),
    COALESCE(p_notes, ''),
    v_operation_key,
    v_actor
  );

  v_cash_paid_cents := v_cash_paid_cents + p_amount_cents;
  v_settled_cents := least(v_actual.amount_cents, v_cash_paid_cents + v_credit_cents);
  v_remaining_cents := greatest(0, v_actual.amount_cents - v_settled_cents);
  v_next_status := CASE WHEN v_remaining_cents = 0 THEN 'paid' ELSE 'approved' END;

  UPDATE public.cost_actuals actual
  SET status = v_next_status,
      approved_at = COALESCE(actual.approved_at, now()),
      approved_by = COALESCE(actual.approved_by, v_actor),
      paid_at = CASE WHEN v_next_status = 'paid' THEN COALESCE(actual.paid_at, now()) ELSE actual.paid_at END,
      paid_date = CASE WHEN v_next_status = 'paid' THEN v_effective_date ELSE actual.paid_date END,
      payment_method = CASE WHEN v_next_status = 'paid' THEN COALESCE(p_payment_method, '') ELSE actual.payment_method END,
      payment_reference = CASE WHEN v_next_status = 'paid' THEN COALESCE(p_payment_reference, '') ELSE actual.payment_reference END
  WHERE actual.id = v_actual.id
  RETURNING actual.* INTO v_actual;

  v_result := jsonb_build_object(
    'ok', true,
    'payment_id', v_payment_id,
    'cost_actual_id', v_actual.id,
    'invoice_cents', v_actual.amount_cents,
    'cash_paid_cents', v_cash_paid_cents,
    'credit_cents', v_credit_cents,
    'settled_cents', v_settled_cents,
    'remaining_cents', v_remaining_cents,
    'status', v_actual.status
  );

  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    v_project_id,
    v_operation_key,
    'record_cost_actual_payment_atomic',
    v_fingerprint,
    v_result,
    v_actor
  );

  RETURN v_result;
END;
$$;

DROP TRIGGER IF EXISTS cost_actual_command_operations_immutable
  ON private.cost_actual_command_operations;
CREATE TRIGGER cost_actual_command_operations_immutable
  BEFORE UPDATE OR DELETE ON private.cost_actual_command_operations
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_keep_cost_command_journal_immutable();

REVOKE ALL ON FUNCTION private.tg_keep_cost_command_journal_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

-- Direct writes are blocked even if a future grant/policy accidentally widens.
-- The transaction-local marker is set only inside the audited RPCs below.
CREATE OR REPLACE FUNCTION private.tg_require_cost_actual_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
BEGIN
  IF (SELECT auth.uid()) IS NULL
     AND COALESCE((SELECT auth.role()), '') NOT IN ('anon', 'authenticated') THEN
    -- Preserve trusted migration/backfill and service maintenance paths. Data
    -- API callers still need the command marker and table grants below.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF COALESCE(current_setting('overwatch.cost_actual_command_write', true), '') = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.projects project WHERE project.id = v_project_id
  ) THEN
    -- Preserve project deletion/cascade behavior.
    RETURN OLD;
  END IF;

  RAISE EXCEPTION USING
    errcode = '23514',
    message = 'Cost ledger writes must use an atomic cost command.';
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_require_command ON public.cost_actuals;
CREATE TRIGGER cost_actuals_require_command
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_require_cost_actual_command();

DROP TRIGGER IF EXISTS cost_actual_payments_require_command ON public.cost_actual_payments;
CREATE TRIGGER cost_actual_payments_require_command
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_actual_payments
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_require_cost_actual_command();

DROP TRIGGER IF EXISTS cost_actual_import_batches_require_command
  ON public.cost_actual_import_batches;
CREATE TRIGGER cost_actual_import_batches_require_command
  BEFORE INSERT OR UPDATE OR DELETE ON public.cost_actual_import_batches
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_require_cost_actual_command();

REVOKE ALL ON FUNCTION private.tg_require_cost_actual_command()
  FROM PUBLIC, anon, authenticated, service_role;

-- Database-level lifecycle law applies even inside commands. Paid and void are
-- terminal. Draft/committed/approved may only move forward or be voided.
CREATE OR REPLACE FUNCTION private.tg_enforce_cost_actual_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.project_id IS DISTINCT FROM NEW.project_id THEN
    RAISE EXCEPTION 'A cost actual cannot move to another project.';
  END IF;

  IF OLD.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Paid and void cost actuals are immutable terminal financial records.';
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('committed', 'approved', 'paid', 'void'))
    OR (OLD.status = 'committed' AND NEW.status IN ('approved', 'paid', 'void'))
    OR (OLD.status = 'approved' AND NEW.status IN ('paid', 'void'))
  ) THEN
    RAISE EXCEPTION 'Cost actual status cannot move backward from % to %.', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_enforce_lifecycle ON public.cost_actuals;
CREATE TRIGGER cost_actuals_enforce_lifecycle
  BEFORE UPDATE ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_enforce_cost_actual_lifecycle();

REVOKE ALL ON FUNCTION private.tg_enforce_cost_actual_lifecycle()
  FROM PUBLIC, anon, authenticated, service_role;

-- No command may create or advance an unattributed cost. Historical unmatched
-- imports remain readable, but they must be assigned before any mutation.
CREATE OR REPLACE FUNCTION private.tg_require_cost_actual_attribution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_bucket_code text;
BEGIN
  IF NEW.cost_bucket_id IS NULL THEN
    RAISE EXCEPTION 'A valid project cost bucket is required for every cost actual.';
  END IF;

  SELECT bucket.cost_code
    INTO v_bucket_code
  FROM public.cost_buckets bucket
  WHERE bucket.id = NEW.cost_bucket_id
    AND bucket.project_id = NEW.project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected cost bucket is unavailable or belongs to another project.';
  END IF;

  IF length(btrim(COALESCE(v_bucket_code, ''))) > 0
     AND lower(btrim(NEW.cost_code)) <> lower(btrim(v_bucket_code)) THEN
    RAISE EXCEPTION 'The cost code must match the selected project cost bucket.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_require_attribution ON public.cost_actuals;
CREATE TRIGGER cost_actuals_require_attribution
  BEFORE INSERT OR UPDATE OF project_id, cost_bucket_id, cost_code
  ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION private.tg_require_cost_actual_attribution();

REVOKE ALL ON FUNCTION private.tg_require_cost_actual_attribution()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent cost creation
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_cost_actual_atomic(
  p_project_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_bucket public.cost_buckets%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_result jsonb;
  v_amount_cents bigint;
  v_offset_cents bigint;
  v_bucket_id uuid;
  v_credit_id uuid;
  v_exposure_id uuid;
  v_subcontract_change_order_id uuid;
  v_subcontract_payment_id uuid;
  v_cost_document_id uuid;
  v_cost_date date;
  v_requested_status text;
  v_initial_status text;
  v_cost_code text;
  v_payment_id uuid;
  v_paid_date date;
  v_attachment_size bigint;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'A project is required.';
  END IF;
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to create a cost actual.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  PERFORM 1 FROM public.projects project WHERE project.id = p_project_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Cost details must be a JSON object.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid cost operation key is required.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'create_cost_actual_atomic', p_project_id, p_payload
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || v_operation_key, 0
  ));

  SELECT operation.*
    INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = p_project_id
    AND operation.operation_key = v_operation_key;

  IF FOUND THEN
    IF v_existing.command_type <> 'create_cost_actual_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This cost operation key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  IF COALESCE(p_payload ->> 'amount_cents', '') !~ '^-?[0-9]+$' THEN
    RAISE EXCEPTION 'Cost amount_cents must be a signed integer.';
  END IF;
  v_amount_cents := (p_payload ->> 'amount_cents')::bigint;
  IF v_amount_cents = 0 OR abs(v_amount_cents::numeric) > 9007199254740991 THEN
    RAISE EXCEPTION 'Cost amount must be nonzero safe integer cents.';
  END IF;

  IF COALESCE(p_payload ->> 'daily_wip_offset_cents', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Daily WIP offset must be nonnegative integer cents.';
  END IF;
  v_offset_cents := COALESCE(p_payload ->> 'daily_wip_offset_cents', '0')::bigint;
  IF v_offset_cents::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Daily WIP offset exceeds the safe integer-cent domain.';
  END IF;
  IF (v_amount_cents < 0 AND v_offset_cents <> 0)
     OR (v_amount_cents > 0 AND v_offset_cents > v_amount_cents) THEN
    RAISE EXCEPTION 'Daily WIP offset cannot exceed a positive cost and must be zero for a credit.';
  END IF;

  IF length(btrim(COALESCE(p_payload ->> 'description', ''))) = 0
     OR length(p_payload ->> 'description') > 500 THEN
    RAISE EXCEPTION 'A cost description between 1 and 500 characters is required.';
  END IF;
  IF COALESCE(p_payload ->> 'category', 'direct') NOT IN
     ('direct', 'labor', 'material', 'equipment', 'subcontract', 'overhead') THEN
    RAISE EXCEPTION 'Invalid cost category.';
  END IF;
  IF length(COALESCE(p_payload ->> 'vendor', '')) > 200
     OR length(COALESCE(p_payload ->> 'reference_number', '')) > 200
     OR length(COALESCE(p_payload ->> 'notes', '')) > 2000
     OR length(COALESCE(p_payload ->> 'invoice_attachment_path', '')) > 1000
     OR length(COALESCE(p_payload ->> 'invoice_attachment_name', '')) > 500
     OR length(COALESCE(p_payload ->> 'invoice_attachment_type', '')) > 200 THEN
    RAISE EXCEPTION 'One or more cost details exceed their allowed length.';
  END IF;
  IF COALESCE(p_payload ->> 'invoice_attachment_size', '0') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Invoice attachment size must be a nonnegative integer.';
  END IF;
  v_attachment_size := COALESCE(p_payload ->> 'invoice_attachment_size', '0')::bigint;

  BEGIN
    v_cost_date := (p_payload ->> 'cost_date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'A valid cost date is required.';
  END;
  IF v_cost_date IS NULL THEN
    RAISE EXCEPTION 'A valid cost date is required.';
  END IF;

  v_requested_status := COALESCE(NULLIF(p_payload ->> 'status', ''), 'committed');
  IF v_requested_status NOT IN ('draft', 'committed', 'approved', 'paid') THEN
    RAISE EXCEPTION 'Cost status must be draft, committed, approved, or paid.';
  END IF;
  IF v_requested_status = 'paid' AND v_amount_cents < 0 THEN
    RAISE EXCEPTION 'A supplier credit cannot be created as paid without a cash settlement. Create it as committed or approved.';
  END IF;

  BEGIN
    v_bucket_id := NULLIF(btrim(COALESCE(p_payload ->> 'cost_bucket_id', '')), '')::uuid;
    v_credit_id := NULLIF(btrim(COALESCE(p_payload ->> 'credit_applies_to_id', '')), '')::uuid;
    v_exposure_id := NULLIF(btrim(COALESCE(p_payload ->> 'exposure_id', '')), '')::uuid;
    v_subcontract_change_order_id := NULLIF(btrim(COALESCE(p_payload ->> 'subcontract_change_order_id', '')), '')::uuid;
    v_subcontract_payment_id := NULLIF(btrim(COALESCE(p_payload ->> 'subcontract_payment_id', '')), '')::uuid;
    v_cost_document_id := NULLIF(btrim(COALESCE(p_payload ->> 'cost_document_id', '')), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'A linked cost identifier is not a valid UUID.';
  END;
  IF v_subcontract_change_order_id IS NOT NULL AND v_subcontract_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Link a cost to either a subcontract change order or a progress payment, not both.';
  END IF;

  IF v_bucket_id IS NOT NULL THEN
    SELECT bucket.*
      INTO v_bucket
    FROM public.cost_buckets bucket
    WHERE bucket.id = v_bucket_id
      AND bucket.project_id = p_project_id
    FOR SHARE;
  ELSIF length(btrim(COALESCE(p_payload ->> 'cost_code', ''))) > 0 THEN
    SELECT bucket.*
      INTO v_bucket
    FROM public.cost_buckets bucket
    WHERE bucket.project_id = p_project_id
      AND lower(btrim(bucket.cost_code)) = lower(btrim(p_payload ->> 'cost_code'))
    FOR SHARE;
  END IF;
  IF NOT FOUND OR v_bucket.id IS NULL THEN
    RAISE EXCEPTION 'A valid project cost bucket or exact project-local cost code is required.';
  END IF;

  IF length(btrim(v_bucket.cost_code)) > 0
     AND length(btrim(COALESCE(p_payload ->> 'cost_code', ''))) > 0
     AND lower(btrim(v_bucket.cost_code)) <> lower(btrim(p_payload ->> 'cost_code')) THEN
    RAISE EXCEPTION 'The supplied cost code does not match the selected cost bucket.';
  END IF;
  v_bucket_id := v_bucket.id;
  v_cost_code := left(CASE
    WHEN length(btrim(v_bucket.cost_code)) > 0 THEN btrim(v_bucket.cost_code)
    ELSE btrim(COALESCE(p_payload ->> 'cost_code', ''))
  END, 64);

  IF v_exposure_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exposures exposure
    WHERE exposure.id = v_exposure_id AND exposure.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'The linked risk is unavailable or belongs to another project.';
  END IF;
  IF v_subcontract_change_order_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontract_change_orders change_order
    WHERE change_order.id = v_subcontract_change_order_id
      AND change_order.project_id = p_project_id
      AND (change_order.cost_bucket_id IS NULL OR change_order.cost_bucket_id = v_bucket_id)
  ) THEN
    RAISE EXCEPTION 'The linked subcontract change order is unavailable, belongs to another project, or uses another cost bucket.';
  END IF;
  IF v_subcontract_payment_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontract_payments payment
    WHERE payment.id = v_subcontract_payment_id AND payment.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'The linked subcontract payment is unavailable or belongs to another project.';
  END IF;
  IF v_credit_id IS NOT NULL AND v_amount_cents >= 0 THEN
    RAISE EXCEPTION 'Only a negative supplier credit may link to another cost.';
  END IF;
  IF v_credit_id IS NOT NULL THEN
    PERFORM 1
    FROM public.cost_actuals target
    WHERE target.id = v_credit_id
      AND target.project_id = p_project_id
      AND target.amount_cents > 0
      AND target.status NOT IN ('draft', 'paid', 'void')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The supplier-credit target is unavailable, nonpositive, unapproved, paid, void, or belongs to another project.';
    END IF;
  END IF;

  v_initial_status := CASE
    WHEN v_requested_status IN ('approved', 'paid') THEN 'draft'
    ELSE v_requested_status
  END;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  INSERT INTO public.cost_actuals (
    project_id,
    cost_bucket_id,
    cost_code,
    description,
    category,
    amount,
    amount_cents,
    vendor,
    reference_number,
    cost_date,
    status,
    notes,
    daily_wip_offset,
    daily_wip_offset_cents,
    invoice_attachment_path,
    invoice_attachment_name,
    invoice_attachment_type,
    invoice_attachment_size,
    credit_applies_to_id,
    cost_document_id,
    exposure_id,
    subcontract_change_order_id,
    subcontract_payment_id,
    created_by
  ) VALUES (
    p_project_id,
    v_bucket_id,
    v_cost_code,
    btrim(p_payload ->> 'description'),
    COALESCE(p_payload ->> 'category', 'direct'),
    v_amount_cents::numeric / 100.0,
    v_amount_cents,
    btrim(COALESCE(p_payload ->> 'vendor', '')),
    btrim(COALESCE(p_payload ->> 'reference_number', '')),
    v_cost_date,
    v_initial_status,
    COALESCE(p_payload ->> 'notes', ''),
    v_offset_cents::numeric / 100.0,
    v_offset_cents,
    COALESCE(p_payload ->> 'invoice_attachment_path', ''),
    COALESCE(p_payload ->> 'invoice_attachment_name', ''),
    COALESCE(p_payload ->> 'invoice_attachment_type', ''),
    v_attachment_size,
    v_credit_id,
    COALESCE(v_cost_document_id, gen_random_uuid()),
    v_exposure_id,
    v_subcontract_change_order_id,
    v_subcontract_payment_id,
    v_actor
  )
  RETURNING * INTO v_actual;

  IF v_requested_status = 'approved' THEN
    UPDATE public.cost_actuals actual
    SET status = 'approved',
        approved_at = now(),
        approved_by = v_actor
    WHERE actual.id = v_actual.id
    RETURNING actual.* INTO v_actual;
  ELSIF v_requested_status = 'paid' THEN
    v_paid_date := COALESCE(NULLIF(p_payload ->> 'paid_date', '')::date, v_cost_date);
    v_payment_id := gen_random_uuid();
    INSERT INTO public.cost_actual_payments (
      id,
      project_id,
      cost_actual_id,
      amount_cents,
      payment_date,
      payment_method,
      payment_reference,
      notes,
      operation_key,
      created_by
    ) VALUES (
      v_payment_id,
      p_project_id,
      v_actual.id,
      v_amount_cents,
      v_paid_date,
      left(COALESCE(p_payload ->> 'payment_method', ''), 40),
      left(COALESCE(p_payload ->> 'payment_reference', ''), 200),
      left(COALESCE(p_payload ->> 'payment_notes', ''), 2000),
      v_operation_key || ':paid',
      v_actor
    );

    UPDATE public.cost_actuals actual
    SET status = 'paid',
        approved_at = now(),
        approved_by = v_actor,
        paid_at = now(),
        paid_date = v_paid_date,
        payment_method = left(COALESCE(p_payload ->> 'payment_method', ''), 40),
        payment_reference = left(COALESCE(p_payload ->> 'payment_reference', ''), 200)
    WHERE actual.id = v_actual.id
    RETURNING actual.* INTO v_actual;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'cost_actual_id', v_actual.id,
    'project_id', p_project_id,
    'cost_bucket_id', v_actual.cost_bucket_id,
    'amount_cents', v_actual.amount_cents,
    'status', v_actual.status,
    'payment_id', v_payment_id,
    'remaining_cents', CASE WHEN v_actual.status = 'paid' THEN 0 ELSE v_actual.amount_cents END
  );

  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    p_project_id, v_operation_key, 'create_cost_actual_atomic', v_fingerprint, v_result, v_actor
  );

  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent approval / legacy mark-paid transition
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.transition_cost_actual_atomic(
  p_cost_actual_id uuid,
  p_target_status text,
  p_payment_details jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_payload jsonb := COALESCE(p_payment_details, '{}'::jsonb);
  v_project_id uuid;
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_result jsonb;
  v_payment_id uuid;
  v_cash_paid_cents bigint := 0;
  v_credit_cents bigint := 0;
  v_remaining_cents bigint := 0;
  v_paid_date date;
BEGIN
  IF p_target_status NOT IN ('approved', 'paid') THEN
    RAISE EXCEPTION 'Cost status can only move forward to approved or paid.';
  END IF;
  IF jsonb_typeof(v_payload) <> 'object' THEN
    RAISE EXCEPTION 'Transition details must be a JSON object.';
  END IF;
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to change a cost status.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid status idempotency key is required.';
  END IF;
  IF length(COALESCE(v_payload ->> 'payment_method', '')) > 40
     OR length(COALESCE(v_payload ->> 'payment_reference', '')) > 200 THEN
    RAISE EXCEPTION 'Payment details exceed their allowed length.';
  END IF;

  SELECT actual.project_id INTO v_project_id
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cost actual not found.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(v_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'transition_cost_actual_atomic', p_cost_actual_id, p_target_status, v_payload
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    v_project_id::text || ':' || v_operation_key, 0
  ));
  SELECT operation.* INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = v_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'transition_cost_actual_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This status idempotency key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT actual.* INTO v_actual
  FROM public.cost_actuals actual
  WHERE actual.id = p_cost_actual_id
  FOR UPDATE;
  IF NOT FOUND OR v_actual.project_id <> v_project_id THEN
    RAISE EXCEPTION 'Cost actual changed while the transition was waiting. Retry with a new idempotency key.';
  END IF;
  IF v_actual.status IN ('paid', 'void') THEN
    RAISE EXCEPTION 'Paid and void cost actuals are terminal.';
  END IF;
  IF v_actual.cost_bucket_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cost_buckets bucket
    WHERE bucket.id = v_actual.cost_bucket_id AND bucket.project_id = v_project_id
  ) THEN
    RAISE EXCEPTION 'Assign this cost to a valid project cost bucket before changing its status.';
  END IF;
  IF v_actual.credit_applies_to_id IS NOT NULL THEN
    PERFORM 1
    FROM public.cost_actuals target
    WHERE target.id = v_actual.credit_applies_to_id
      AND target.project_id = v_project_id
      AND target.amount_cents > 0
      AND target.status NOT IN ('draft', 'paid', 'void')
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The supplier-credit target is no longer eligible for recognition.';
    END IF;
  END IF;
  IF p_target_status = 'approved' AND v_actual.status = 'approved' THEN
    NULL;
  ELSIF p_target_status = 'approved' AND v_actual.status NOT IN ('draft', 'committed') THEN
    RAISE EXCEPTION 'This cost cannot move to approved from its current state.';
  ELSIF p_target_status = 'paid' AND v_actual.amount_cents <= 0 THEN
    RAISE EXCEPTION 'Only a positive cost can be marked paid through a cash settlement.';
  END IF;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  IF p_target_status = 'approved' THEN
    UPDATE public.cost_actuals actual
    SET status = 'approved',
        approved_at = COALESCE(actual.approved_at, now()),
        approved_by = COALESCE(actual.approved_by, v_actor)
    WHERE actual.id = v_actual.id
    RETURNING actual.* INTO v_actual;
  ELSE
    BEGIN
      v_paid_date := COALESCE(NULLIF(v_payload ->> 'paid_date', '')::date, CURRENT_DATE);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'A valid paid date is required.';
    END;

    SELECT COALESCE(sum(payment.amount_cents), 0)::bigint
      INTO v_cash_paid_cents
    FROM public.cost_actual_payments payment
    WHERE payment.cost_actual_id = v_actual.id;
    SELECT COALESCE(sum(abs(credit.amount_cents)), 0)::bigint
      INTO v_credit_cents
    FROM public.cost_actuals credit
    WHERE credit.credit_applies_to_id = v_actual.id
      AND credit.status IN ('committed', 'approved', 'paid');
    v_remaining_cents := greatest(
      0,
      v_actual.amount_cents - v_cash_paid_cents - v_credit_cents
    );

    IF v_remaining_cents > 0 THEN
      v_payment_id := gen_random_uuid();
      INSERT INTO public.cost_actual_payments (
        id, project_id, cost_actual_id, amount_cents, payment_date,
        payment_method, payment_reference, notes, operation_key, created_by
      ) VALUES (
        v_payment_id, v_project_id, v_actual.id, v_remaining_cents, v_paid_date,
        COALESCE(v_payload ->> 'payment_method', ''),
        COALESCE(v_payload ->> 'payment_reference', ''),
        'Full settlement from mark-paid transition.',
        left(v_operation_key || ':transition-paid', 240),
        v_actor
      );
      v_cash_paid_cents := v_cash_paid_cents + v_remaining_cents;
    END IF;

    UPDATE public.cost_actuals actual
    SET status = 'paid',
        approved_at = COALESCE(actual.approved_at, now()),
        approved_by = COALESCE(actual.approved_by, v_actor),
        paid_at = COALESCE(actual.paid_at, now()),
        paid_date = v_paid_date,
        payment_method = COALESCE(v_payload ->> 'payment_method', ''),
        payment_reference = COALESCE(v_payload ->> 'payment_reference', '')
    WHERE actual.id = v_actual.id
    RETURNING actual.* INTO v_actual;
    v_remaining_cents := 0;
  END IF;

  v_result := jsonb_build_object(
    'ok', true,
    'cost_actual_id', v_actual.id,
    'status', v_actual.status,
    'payment_id', v_payment_id,
    'invoice_cents', v_actual.amount_cents,
    'cash_paid_cents', v_cash_paid_cents,
    'credit_cents', v_credit_cents,
    'remaining_cents', v_remaining_cents
  );
  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    v_project_id, v_operation_key, 'transition_cost_actual_atomic', v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Atomic, idempotent CSV batch + rows import
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.import_cost_actuals_atomic(
  p_project_id uuid,
  p_source_name text,
  p_rows jsonb,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_service_role boolean := COALESCE((SELECT auth.role()), '') = 'service_role';
  v_operation_key text := btrim(COALESCE(p_idempotency_key, ''));
  v_source_name text := btrim(COALESCE(p_source_name, 'CSV import'));
  v_fingerprint text;
  v_existing private.cost_actual_command_operations%ROWTYPE;
  v_batch_id uuid := gen_random_uuid();
  v_bucket public.cost_buckets%ROWTYPE;
  v_actual public.cost_actuals%ROWTYPE;
  v_item jsonb;
  v_ordinality bigint;
  v_row_count integer;
  v_imported_count integer := 0;
  v_skipped_count integer := 0;
  v_amount_cents bigint;
  v_offset_cents bigint;
  v_bucket_id uuid;
  v_cost_date date;
  v_status text;
  v_cost_code text;
  v_source_id text;
  v_row_hash text;
  v_payment_id uuid;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL AND NOT v_service_role THEN
    RAISE EXCEPTION 'You must be signed in to import cost actuals.';
  END IF;
  IF NOT v_service_role AND NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  PERFORM 1 FROM public.projects project WHERE project.id = p_project_id FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid import idempotency key is required.';
  END IF;
  IF length(v_source_name) = 0 OR length(v_source_name) > 200 THEN
    RAISE EXCEPTION 'Import source name must be between 1 and 200 characters.';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'Cost import rows must be a JSON array.';
  END IF;
  v_row_count := jsonb_array_length(p_rows);
  IF v_row_count < 1 OR v_row_count > 500 THEN
    RAISE EXCEPTION 'Cost imports must contain between 1 and 500 rows.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'import_cost_actuals_atomic', p_project_id, v_source_name, p_rows
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || v_operation_key, 0
  ));
  SELECT operation.* INTO v_existing
  FROM private.cost_actual_command_operations operation
  WHERE operation.project_id = p_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'import_cost_actuals_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This import idempotency key was already used for different rows or source.';
    END IF;
    RETURN v_existing.result;
  END IF;

  -- Serialize all CSV imports for one project, even when callers accidentally
  -- generate different operation keys for the same file.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'cost-import:' || p_project_id::text, 0
  ));

  -- Validate every row and lock every referenced bucket before the first write.
  -- Any malformed/unattributed row rejects the entire batch.
  FOR v_item, v_ordinality IN
    SELECT item.value, item.ordinality
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    IF jsonb_typeof(v_item) <> 'object' THEN
      RAISE EXCEPTION 'Import row % must be an object.', v_ordinality;
    END IF;
    IF COALESCE(v_item ->> 'amount_cents', '') !~ '^-?[0-9]+$' THEN
      RAISE EXCEPTION 'Import row % amount_cents must be a signed integer.', v_ordinality;
    END IF;
    v_amount_cents := (v_item ->> 'amount_cents')::bigint;
    IF v_amount_cents = 0 OR abs(v_amount_cents::numeric) > 9007199254740991 THEN
      RAISE EXCEPTION 'Import row % amount must be nonzero safe integer cents.', v_ordinality;
    END IF;
    IF COALESCE(v_item ->> 'daily_wip_offset_cents', '0') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Import row % daily WIP offset must be nonnegative integer cents.', v_ordinality;
    END IF;
    v_offset_cents := COALESCE(v_item ->> 'daily_wip_offset_cents', '0')::bigint;
    IF v_offset_cents::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'Import row % daily WIP offset exceeds the safe integer-cent domain.', v_ordinality;
    END IF;
    IF (v_amount_cents < 0 AND v_offset_cents <> 0)
       OR (v_amount_cents > 0 AND v_offset_cents > v_amount_cents) THEN
      RAISE EXCEPTION 'Import row % has an invalid daily WIP offset.', v_ordinality;
    END IF;
    IF length(btrim(COALESCE(v_item ->> 'description', ''))) = 0
       OR length(v_item ->> 'description') > 500 THEN
      RAISE EXCEPTION 'Import row % requires a description between 1 and 500 characters.', v_ordinality;
    END IF;
    IF COALESCE(v_item ->> 'category', 'direct') NOT IN
       ('direct', 'labor', 'material', 'equipment', 'subcontract', 'overhead') THEN
      RAISE EXCEPTION 'Import row % has an invalid category.', v_ordinality;
    END IF;
    IF length(COALESCE(v_item ->> 'vendor', '')) > 200
       OR length(COALESCE(v_item ->> 'reference_number', '')) > 200
       OR length(COALESCE(v_item ->> 'notes', '')) > 2000
       OR length(btrim(COALESCE(v_item ->> 'source_external_id', ''))) > 500 THEN
      RAISE EXCEPTION 'Import row % contains text beyond an allowed length.', v_ordinality;
    END IF;
    v_status := COALESCE(NULLIF(v_item ->> 'status', ''), 'committed');
    IF v_status NOT IN ('committed', 'paid') THEN
      RAISE EXCEPTION 'Import row % status must be committed or paid.', v_ordinality;
    END IF;
    IF v_status = 'paid' AND v_amount_cents < 0 THEN
      RAISE EXCEPTION 'Import row % is a negative credit and cannot be marked paid without a cash settlement.', v_ordinality;
    END IF;
    BEGIN
      v_cost_date := (v_item ->> 'cost_date')::date;
      v_bucket_id := NULLIF(btrim(COALESCE(v_item ->> 'cost_bucket_id', '')), '')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Import row % has an invalid date or cost bucket identifier.', v_ordinality;
    END;
    IF v_cost_date IS NULL THEN
      RAISE EXCEPTION 'Import row % requires a cost date.', v_ordinality;
    END IF;

    v_bucket.id := NULL;
    IF v_bucket_id IS NOT NULL THEN
      SELECT bucket.* INTO v_bucket
      FROM public.cost_buckets bucket
      WHERE bucket.id = v_bucket_id AND bucket.project_id = p_project_id
      FOR SHARE;
    ELSIF length(btrim(COALESCE(v_item ->> 'cost_code', ''))) > 0 THEN
      SELECT bucket.* INTO v_bucket
      FROM public.cost_buckets bucket
      WHERE bucket.project_id = p_project_id
        AND lower(btrim(bucket.cost_code)) = lower(btrim(v_item ->> 'cost_code'))
      FOR SHARE;
    END IF;
    IF v_bucket.id IS NULL THEN
      RAISE EXCEPTION 'Import row % does not resolve to a valid project cost bucket.', v_ordinality;
    END IF;
    IF length(btrim(v_bucket.cost_code)) > 0
       AND length(btrim(COALESCE(v_item ->> 'cost_code', ''))) > 0
       AND lower(btrim(v_bucket.cost_code)) <> lower(btrim(v_item ->> 'cost_code')) THEN
      RAISE EXCEPTION 'Import row % cost code does not match its selected bucket.', v_ordinality;
    END IF;
  END LOOP;

  PERFORM set_config('overwatch.cost_actual_command_write', 'on', true);
  INSERT INTO public.cost_actual_import_batches (
    id, project_id, source_type, source_name, file_hash, row_count,
    matched_count, unmatched_count, status, created_by
  ) VALUES (
    v_batch_id, p_project_id, 'csv', v_source_name,
    pg_catalog.md5(p_rows::text), v_row_count, 0, 0, 'imported', v_actor
  );

  FOR v_item, v_ordinality IN
    SELECT item.value, item.ordinality
    FROM jsonb_array_elements(p_rows) WITH ORDINALITY AS item(value, ordinality)
  LOOP
    v_amount_cents := (v_item ->> 'amount_cents')::bigint;
    v_offset_cents := COALESCE(v_item ->> 'daily_wip_offset_cents', '0')::bigint;
    v_cost_date := (v_item ->> 'cost_date')::date;
    v_status := COALESCE(NULLIF(v_item ->> 'status', ''), 'committed');
    v_bucket_id := NULLIF(btrim(COALESCE(v_item ->> 'cost_bucket_id', '')), '')::uuid;
    v_bucket.id := NULL;
    IF v_bucket_id IS NOT NULL THEN
      SELECT bucket.* INTO v_bucket FROM public.cost_buckets bucket
      WHERE bucket.id = v_bucket_id AND bucket.project_id = p_project_id;
    ELSE
      SELECT bucket.* INTO v_bucket FROM public.cost_buckets bucket
      WHERE bucket.project_id = p_project_id
        AND lower(btrim(bucket.cost_code)) = lower(btrim(v_item ->> 'cost_code'));
    END IF;
    v_cost_code := left(CASE
      WHEN length(btrim(v_bucket.cost_code)) > 0 THEN btrim(v_bucket.cost_code)
      ELSE btrim(COALESCE(v_item ->> 'cost_code', ''))
    END, 64);
    v_row_hash := 'cost-v2:' || pg_catalog.md5(jsonb_build_array(
      p_project_id,
      v_bucket.id,
      v_cost_code,
      btrim(v_item ->> 'description'),
      COALESCE(v_item ->> 'category', 'direct'),
      v_amount_cents,
      btrim(COALESCE(v_item ->> 'vendor', '')),
      btrim(COALESCE(v_item ->> 'reference_number', '')),
      v_cost_date,
      COALESCE(v_item ->> 'notes', '')
    )::text);
    -- Identity is source + stable row identity only. Financial values remain
    -- in source_row_hash so correcting an amount/date/description for the same
    -- source row is detected as a conflict rather than booked a second time.
    v_source_id := 'source-row-v1:' || pg_catalog.md5(jsonb_build_array(
      v_source_name,
      CASE
        WHEN length(btrim(COALESCE(v_item ->> 'source_external_id', ''))) > 0
          THEN btrim(v_item ->> 'source_external_id')
        ELSE 'row:' || v_ordinality::text
      END
    )::text);

    IF EXISTS (
      SELECT 1
      FROM public.cost_actuals existing
      WHERE existing.project_id = p_project_id
        AND existing.source_external_id = v_source_id
        AND existing.source_row_hash <> v_row_hash
    ) THEN
      RAISE EXCEPTION
        'Import row % reuses a source identifier for different financial details.',
        v_ordinality;
    END IF;

    INSERT INTO public.cost_actuals (
      project_id, cost_bucket_id, import_batch_id, cost_code, description,
      category, amount, amount_cents, vendor, reference_number,
      source_row_hash, source_external_id, cost_date, status, notes,
      daily_wip_offset, daily_wip_offset_cents, created_by
    ) VALUES (
      p_project_id, v_bucket.id, v_batch_id, v_cost_code,
      btrim(v_item ->> 'description'), COALESCE(v_item ->> 'category', 'direct'),
      v_amount_cents::numeric / 100.0, v_amount_cents,
      btrim(COALESCE(v_item ->> 'vendor', '')),
      btrim(COALESCE(v_item ->> 'reference_number', '')),
      v_row_hash, v_source_id, v_cost_date,
      CASE WHEN v_status = 'paid' THEN 'committed' ELSE v_status END,
      COALESCE(v_item ->> 'notes', ''),
      v_offset_cents::numeric / 100.0, v_offset_cents, v_actor
    )
    ON CONFLICT DO NOTHING
    RETURNING * INTO v_actual;

    IF NOT FOUND THEN
      v_skipped_count := v_skipped_count + 1;
      CONTINUE;
    END IF;

    v_imported_count := v_imported_count + 1;
    IF v_status = 'paid' THEN
      v_payment_id := gen_random_uuid();
      INSERT INTO public.cost_actual_payments (
        id, project_id, cost_actual_id, amount_cents, payment_date,
        payment_method, payment_reference, notes, operation_key, created_by
      ) VALUES (
        v_payment_id, p_project_id, v_actual.id, v_amount_cents, v_cost_date,
        left(COALESCE(v_item ->> 'payment_method', ''), 40),
        left(COALESCE(v_item ->> 'payment_reference', ''), 200),
        'Imported paid-cost settlement.',
        left(v_operation_key || ':row:' || v_ordinality::text, 240),
        v_actor
      );
      UPDATE public.cost_actuals actual
      SET status = 'paid',
          approved_at = now(),
          approved_by = v_actor,
          paid_at = now(),
          paid_date = v_cost_date,
          payment_method = left(COALESCE(v_item ->> 'payment_method', ''), 40),
          payment_reference = left(COALESCE(v_item ->> 'payment_reference', ''), 200)
      WHERE actual.id = v_actual.id;
    END IF;
  END LOOP;

  UPDATE public.cost_actual_import_batches batch
  SET matched_count = v_imported_count,
      unmatched_count = 0,
      status = 'imported'
  WHERE batch.id = v_batch_id;

  v_result := jsonb_build_object(
    'ok', true,
    'import_batch_id', v_batch_id,
    'row_count', v_row_count,
    'imported_count', v_imported_count,
    'skipped_count', v_skipped_count,
    'unmatched_count', 0
  );
  INSERT INTO private.cost_actual_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    p_project_id, v_operation_key, 'import_cost_actuals_atomic', v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- Privilege boundary
-- ---------------------------------------------------------------------------

-- The former settlement RPC is not idempotent and must not remain callable.
REVOKE ALL ON FUNCTION public.record_cost_actual_payment(
  uuid, bigint, date, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;

-- Clients retain project-scoped SELECT through existing RLS policies. All
-- writes use the command RPCs, including service-role application paths.
REVOKE INSERT, UPDATE, DELETE ON public.cost_actuals
  FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.cost_actual_payments
  FROM authenticated, service_role;
REVOKE INSERT, UPDATE, DELETE ON public.cost_actual_import_batches
  FROM authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_cost_actual_atomic(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_cost_actual_atomic(uuid, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.transition_cost_actual_atomic(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.void_cost_actual_atomic(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_cost_actual_payment_atomic(
  uuid, bigint, date, text, text, text, text
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.import_cost_actuals_atomic(uuid, text, jsonb, text)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_cost_actual_atomic(uuid, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_cost_actual_atomic(uuid, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_cost_actual_atomic(uuid, text, jsonb, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.void_cost_actual_atomic(uuid, text, text)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_cost_actual_payment_atomic(
  uuid, bigint, date, text, text, text, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_cost_actuals_atomic(uuid, text, jsonb, text)
  TO authenticated, service_role;

REVOKE ALL ON SCHEMA private FROM service_role;

NOTIFY pgrst, 'reload schema';
