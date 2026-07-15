-- Scale Assurance migration verification. Every row should return true or
-- the expected count before the feature is considered ready.

SELECT to_regclass('public.estimate_scale_assessments') IS NOT NULL AS table_exists;

SELECT relrowsecurity AS rls_enabled
FROM pg_class
WHERE oid = 'public.estimate_scale_assessments'::regclass;

SELECT count(*) = 2 AS authenticated_policy_count_is_two
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'estimate_scale_assessments'
  AND 'authenticated' = ANY(roles);

SELECT to_regprocedure(
  'public.record_estimate_scale_assessment(uuid,uuid,integer,jsonb,text)'
) IS NOT NULL AS record_function_exists;

SELECT NOT has_function_privilege(
  'anon',
  'public.record_estimate_scale_assessment(uuid,uuid,integer,jsonb,text)',
  'EXECUTE'
) AS anon_cannot_record_assurance;

SELECT has_function_privilege(
  'authenticated',
  'public.record_estimate_scale_assessment(uuid,uuid,integer,jsonb,text)',
  'EXECUTE'
) AS authenticated_can_record_assurance;

SELECT
  has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'SELECT')
    AS authenticated_can_read_evidence,
  has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'INSERT')
    AS authenticated_can_invoke_evidence_insert,
  NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'UPDATE')
    AS authenticated_cannot_rewrite_evidence,
  NOT has_table_privilege('authenticated', 'public.estimate_scale_assessments', 'DELETE')
    AS authenticated_cannot_delete_evidence,
  NOT has_table_privilege('anon', 'public.estimate_scale_assessments', 'SELECT')
    AS anon_cannot_read_evidence;

SELECT
  position(
    'app.scale_assurance_sheet_id'
    IN pg_get_functiondef(
      'public.tg_plan_sheet_takeoff_trust()'::regprocedure
    )
  ) > 0 AS direct_verification_is_guarded,
  position(
    'v_tolerance_pct CONSTANT numeric := 1.5'
    IN pg_get_functiondef(
      'public.record_estimate_scale_assessment(uuid,uuid,integer,jsonb,text)'::regprocedure
    )
  ) > 0 AS tolerance_is_database_owned;

SELECT count(*) = 5 AS assurance_constraint_count_is_five
FROM pg_constraint
WHERE conrelid = 'public.estimate_scale_assessments'::regclass
  AND contype = 'c'
  AND conname LIKE 'estimate_scale_assessments_%';
