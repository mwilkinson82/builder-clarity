-- Post-apply verification for CRMFOLLOWUP1.
-- Run in the Supabase SQL editor after applying the matching migration.
-- Every block raises an exception when a required security or schema property
-- is missing, so a successful run ends with one CRMFOLLOWUP1 VERIFIED row.

DO $$
DECLARE
  required_table text;
  required_column text;
  required_policy text;
BEGIN
  FOREACH required_table IN ARRAY ARRAY[
    'crm_value_assets',
    'crm_followup_playbooks',
    'crm_followup_playbook_steps',
    'crm_followup_enrollments'
  ]
  LOOP
    IF to_regclass('public.' || required_table) IS NULL THEN
      RAISE EXCEPTION 'Missing CRM follow-up table: %', required_table;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = required_table
        AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%', required_table;
    END IF;

    IF NOT has_table_privilege('authenticated', 'public.' || required_table, 'SELECT')
      OR NOT has_table_privilege('authenticated', 'public.' || required_table, 'INSERT')
      OR NOT has_table_privilege('authenticated', 'public.' || required_table, 'UPDATE')
    THEN
      RAISE EXCEPTION 'Authenticated role is missing CRM privileges on public.%', required_table;
    END IF;

    IF has_table_privilege('anon', 'public.' || required_table, 'SELECT') THEN
      RAISE EXCEPTION 'Anon unexpectedly has SELECT on public.%', required_table;
    END IF;
  END LOOP;

  FOREACH required_column IN ARRAY ARRAY[
    'owner_user_id',
    'playbook_enrollment_id',
    'playbook_step_id',
    'value_asset_id',
    'subject',
    'body',
    'value_angle',
    'outcome',
    'outcome_notes',
    'skipped_at',
    'skipped_by',
    'sent_at',
    'sent_message_id'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pipeline_next_actions'
        AND column_name = required_column
    ) THEN
      RAISE EXCEPTION 'Missing pipeline_next_actions column: %', required_column;
    END IF;
  END LOOP;

  FOREACH required_policy IN ARRAY ARRAY[
    'crm_value_assets_member_select',
    'crm_value_assets_member_insert',
    'crm_value_assets_member_update',
    'crm_followup_playbooks_member_select',
    'crm_followup_playbooks_member_insert',
    'crm_followup_playbooks_member_update',
    'crm_followup_playbook_steps_member_select',
    'crm_followup_playbook_steps_member_insert',
    'crm_followup_playbook_steps_member_update',
    'crm_followup_enrollments_member_select',
    'crm_followup_enrollments_member_insert',
    'crm_followup_enrollments_member_update'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'public'
        AND policyname = required_policy
    ) THEN
      RAISE EXCEPTION 'Missing CRM RLS policy: %', required_policy;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_next_actions_followup_enrollment_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_next_actions_followup_step_fk'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pipeline_next_actions_value_asset_fk'
  ) THEN
    RAISE EXCEPTION 'One or more organization-scoped pipeline foreign keys are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'crm-assets'
      AND public = false
      AND file_size_limit = 26214400
  ) THEN
    RAISE EXCEPTION 'Private crm-assets bucket is missing or incorrectly configured';
  END IF;

  FOREACH required_policy IN ARRAY ARRAY[
    'crm_assets_storage_select',
    'crm_assets_storage_insert',
    'crm_assets_storage_delete'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_policies
      WHERE schemaname = 'storage'
        AND tablename = 'objects'
        AND policyname = required_policy
    ) THEN
      RAISE EXCEPTION 'Missing CRM Storage policy: %', required_policy;
    END IF;
  END LOOP;
END $$;

SELECT 'CRMFOLLOWUP1 VERIFIED' AS verification_result;
