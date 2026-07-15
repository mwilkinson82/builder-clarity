-- Guided Measurement Assistant + Scale Assurance least-privilege verification.

DO $$
DECLARE
  v_credit_constraint text;
  v_operation_constraint text;
BEGIN
  IF to_regclass('public.estimate_scale_assessments') IS NULL THEN
    RAISE EXCEPTION 'estimate_scale_assessments is missing';
  END IF;

  IF NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'SELECT')
    OR NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'INSERT')
  THEN
    RAISE EXCEPTION 'authenticated is missing SELECT or INSERT on estimate_scale_assessments';
  END IF;

  IF has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'DELETE')
    OR has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'TRUNCATE')
    OR has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'REFERENCES')
    OR has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'TRIGGER')
  THEN
    RAISE EXCEPTION 'authenticated has mutable privileges on append-only scale evidence';
  END IF;

  IF has_table_privilege('anon', 'public.estimate_scale_assessments', 'SELECT')
    OR has_table_privilege('anon', 'public.estimate_scale_assessments', 'INSERT')
  THEN
    RAISE EXCEPTION 'anon can reach estimate_scale_assessments';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_operations'
      AND column_name = 'request_context'
      AND data_type = 'jsonb'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_operations'
      AND column_name = 'result'
      AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'ai_operations audit columns are missing';
  END IF;

  SELECT pg_get_constraintdef(oid)
  INTO v_credit_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.credit_ledger'::regclass
    AND conname = 'credit_ledger_reason_check';

  SELECT pg_get_constraintdef(oid)
  INTO v_operation_constraint
  FROM pg_constraint
  WHERE conrelid = 'public.ai_operations'::regclass
    AND conname = 'ai_operations_operation_type_check';

  IF position('ai_measurement_plan' IN coalesce(v_credit_constraint, '')) = 0 THEN
    RAISE EXCEPTION 'credit_ledger does not allow ai_measurement_plan';
  END IF;

  IF position('ai_measurement_plan' IN coalesce(v_operation_constraint, '')) = 0 THEN
    RAISE EXCEPTION 'ai_operations does not allow ai_measurement_plan';
  END IF;
END
$$;

SELECT
  has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'SELECT') AS scale_select,
  has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'INSERT') AS scale_insert,
  NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'UPDATE') AS scale_no_update,
  NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'DELETE') AS scale_no_delete,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_operations'
      AND column_name = 'request_context'
  ) AS operation_context_ready,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'ai_operations'
      AND column_name = 'result'
  ) AS operation_result_ready;
