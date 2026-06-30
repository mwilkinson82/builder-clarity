-- Verification for supabase/migrations/20260629222000_estimating_module.sql.
-- Run after applying the migration to the target Supabase project.

WITH expected_tables(table_name) AS (
  VALUES
    ('cost_library_items'),
    ('estimates'),
    ('estimate_line_items'),
    ('estimate_markup_defaults')
)
SELECT
  expected_tables.table_name,
  to_regclass('public.' || expected_tables.table_name) IS NOT NULL AS exists_in_public
FROM expected_tables
ORDER BY expected_tables.table_name;

SELECT
  cls.relname AS table_name,
  cls.relrowsecurity AS rls_enabled,
  cls.relforcerowsecurity AS force_rls
FROM pg_class cls
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname IN (
    'cost_library_items',
    'estimates',
    'estimate_line_items',
    'estimate_markup_defaults'
  )
ORDER BY cls.relname;

SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual IS NOT NULL AS has_using,
  with_check IS NOT NULL AS has_with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'cost_library_items',
    'estimates',
    'estimate_line_items',
    'estimate_markup_defaults'
  )
ORDER BY tablename, policyname;

SELECT
  table_name,
  grantee,
  string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name IN (
    'cost_library_items',
    'estimates',
    'estimate_line_items',
    'estimate_markup_defaults'
  )
  AND grantee IN ('authenticated', 'service_role')
GROUP BY table_name, grantee
ORDER BY table_name, grantee;

SELECT
  table_name,
  column_name,
  is_generated,
  generation_expression
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'estimate_line_items'
  AND column_name IN (
    'material_extended_cents',
    'labor_extended_cents',
    'total_extended_cents'
  )
ORDER BY column_name;

SELECT
  indexname,
  tablename
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'cost_library_items',
    'estimates',
    'estimate_line_items',
    'estimate_markup_defaults'
  )
ORDER BY tablename, indexname;
