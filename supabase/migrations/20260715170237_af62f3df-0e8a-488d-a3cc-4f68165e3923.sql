-- Guided Measurement Assistant foundation.
--
-- 1. Preserves the production least-privilege correction found during live
--    Scale Assurance QA. Supabase projects with legacy default privileges can
--    grant authenticated more than the migration intended, so revoke first
--    and then grant only the append-only surface.
-- 2. Adds a separately metered AI operation for drawing-note measurement
--    planning. The model proposes scope; the estimator remains the geometry
--    and quantity authority.
-- 3. Keeps the operation's source context and structured result auditable.

DO $$
BEGIN
  IF to_regclass('public.estimate_scale_assessments') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.estimate_scale_assessments FROM anon;
    REVOKE ALL ON TABLE public.estimate_scale_assessments FROM authenticated;
    GRANT SELECT, INSERT ON TABLE public.estimate_scale_assessments TO authenticated;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.credit_ledger') IS NOT NULL THEN
    ALTER TABLE public.credit_ledger
      DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;

    ALTER TABLE public.credit_ledger
      ADD CONSTRAINT credit_ledger_reason_check CHECK (
        reason IN (
          'signup_grant',
          'monthly_plan_grant',
          'purchase',
          'ai_count_scan',
          'ai_measurement_plan',
          'refund',
          'admin_adjustment'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.ai_operations') IS NOT NULL THEN
    ALTER TABLE public.ai_operations
      DROP CONSTRAINT IF EXISTS ai_operations_operation_type_check;

    ALTER TABLE public.ai_operations
      ADD CONSTRAINT ai_operations_operation_type_check CHECK (
        operation_type IN ('ai_count_scan', 'ai_measurement_plan')
      );

    ALTER TABLE public.ai_operations
      ADD COLUMN IF NOT EXISTS request_context jsonb NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS result jsonb NOT NULL DEFAULT '{}'::jsonb;

    COMMENT ON COLUMN public.ai_operations.request_context IS
      'Non-secret source metadata used for an AI operation, including cited drawing-note lines.';
    COMMENT ON COLUMN public.ai_operations.result IS
      'Structured AI result retained for audit; model suggestions never become quantities without estimator action.';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';