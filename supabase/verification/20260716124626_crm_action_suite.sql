-- Post-apply verification for CRMACTION1.

DO $$
DECLARE
  required_table text;
  required_policy text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'crm_outbound_messages',
    'crm_meeting_briefs',
    'crm_onboarding_plans',
    'crm_onboarding_tasks'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Missing CRM action-suite table: %', required_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_class relation
      JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relname = required_table
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', required_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || required_table, 'SELECT') THEN
      RAISE EXCEPTION 'Anon unexpectedly has SELECT on public.%', required_table;
    END IF;
    IF NOT has_table_privilege('authenticated', 'public.' || required_table, 'SELECT') THEN
      RAISE EXCEPTION 'Authenticated role cannot read public.%', required_table;
    END IF;
  END LOOP;

  FOREACH required_policy IN ARRAY ARRAY[
    'crm_outbound_messages_member_select',
    'crm_meeting_briefs_member_select',
    'crm_meeting_briefs_member_insert',
    'crm_meeting_briefs_member_update',
    'crm_onboarding_plans_member_select',
    'crm_onboarding_plans_member_insert',
    'crm_onboarding_plans_member_update',
    'crm_onboarding_tasks_member_select',
    'crm_onboarding_tasks_member_insert',
    'crm_onboarding_tasks_member_update'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND policyname = required_policy
    ) THEN
      RAISE EXCEPTION 'Missing CRM action-suite policy: %', required_policy;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'credit_ledger_reason_check'
      AND pg_get_constraintdef(oid) LIKE '%ai_crm_assist%'
  ) THEN
    RAISE EXCEPTION 'credit_ledger does not allow ai_crm_assist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'ai_operations_operation_type_check'
      AND pg_get_constraintdef(oid) LIKE '%ai_crm_assist%'
  ) THEN
    RAISE EXCEPTION 'ai_operations does not allow ai_crm_assist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'crm_onboarding_one_active_plan_per_opportunity'
  ) THEN
    RAISE EXCEPTION 'CRM onboarding duplicate guard is missing';
  END IF;
END $$;

SELECT 'CRMACTION1 VERIFIED' AS verification_result;
