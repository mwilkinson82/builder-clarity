-- Auditable, metered AI fallback for image-only plan-sheet title blocks.
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
          'ai_scope_brief',
          'ai_assembly_assumptions',
          'ai_revision_match',
          'ai_revision_scope_review',
          'ai_sheet_identity',
          'ai_crm_assist',
          'refund',
          'admin_adjustment'
        )
      );
  END IF;

  IF to_regclass('public.ai_operations') IS NOT NULL THEN
    ALTER TABLE public.ai_operations
      DROP CONSTRAINT IF EXISTS ai_operations_operation_type_check;
    ALTER TABLE public.ai_operations
      ADD CONSTRAINT ai_operations_operation_type_check CHECK (
        operation_type IN (
          'ai_count_scan',
          'ai_measurement_plan',
          'ai_scope_brief',
          'ai_assembly_assumptions',
          'ai_revision_match',
          'ai_revision_scope_review',
          'ai_sheet_identity',
          'ai_crm_assist'
        )
      );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';