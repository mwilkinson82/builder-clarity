-- P0 runtime repair for Auth/company-access SECURITY DEFINER functions.
--
-- Migration 01000 incorrectly schema-qualified COALESCE and NULLIF. Those are
-- SQL conditional-expression grammar, not pg_catalog functions. PostgreSQL
-- accepts the PL/pgSQL bodies at migration time but fails when an affected
-- statement executes, which blocks a valid signed-in user at company-access
-- resolution.
--
-- The repair is deliberately narrow and idempotent. It rewrites only the five
-- affected function definitions, preserves ownership/signatures/attributes,
-- restores the intended grants, and then re-seals the connector execution
-- role. It writes no business data and changes no Owner memberships.

DO $repair_runtime_sql_expressions$
DECLARE
  v_function regprocedure;
  v_definition text;
  v_repaired text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.ensure_user_account(uuid,text,text)'::regprocedure,
    'public.ensure_current_user_account()'::regprocedure,
    'public.finalize_invite_acceptance(uuid)'::regprocedure,
    'public.finalize_client_access_acceptance(uuid)'::regprocedure,
    'public.tg_projects_ensure_organization()'::regprocedure
  ]
  LOOP
    v_definition := pg_catalog.pg_get_functiondef(v_function);
    v_repaired := pg_catalog.replace(
      pg_catalog.replace(
        v_definition,
        'pg_catalog.coalesce',
        'coalesce'
      ),
      'pg_catalog.nullif',
      'nullif'
    );

    IF v_repaired IS DISTINCT FROM v_definition THEN
      EXECUTE v_repaired;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_function);
    IF pg_catalog.strpos(v_definition, 'pg_catalog.coalesce') > 0
      OR pg_catalog.strpos(v_definition, 'pg_catalog.nullif') > 0 THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = pg_catalog.format(
          'Runtime SQL expression repair did not converge for %s',
          v_function
        );
    END IF;
  END LOOP;
END;
$repair_runtime_sql_expressions$;

-- Reassert the exact intended application grants after CREATE OR REPLACE.
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_account(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.ensure_current_user_account()
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account()
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_invite_acceptance(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.finalize_client_access_acceptance(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_client_access_acceptance(uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tg_projects_ensure_organization()
  FROM PUBLIC, anon, authenticated;

DO $verify_runtime_grants$
BEGIN
  IF pg_catalog.has_function_privilege(
    'anon',
    'public.ensure_current_user_account()',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.ensure_current_user_account()',
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.ensure_user_account(uuid,text,text)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.ensure_user_account(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'P0 runtime repair grant verification failed';
  END IF;
END;
$verify_runtime_grants$;

-- This remains the final database operation. Do not call Lovable
-- query_database after it; doing so would reopen connector role grants.
DO $seal_and_verify$
DECLARE
  v_function regprocedure;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'sandbox_exec'
  ) THEN
    RETURN;
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.ensure_user_account(uuid,text,text)'::regprocedure,
    'public.ensure_current_user_account()'::regprocedure,
    'public.finalize_invite_acceptance(uuid)'::regprocedure,
    'public.finalize_client_access_acceptance(uuid)'::regprocedure,
    'public.can_create_project_in_org(uuid)'::regprocedure,
    'public.can_read_project(uuid)'::regprocedure,
    'public.can_manage_project(uuid)'::regprocedure,
    'public.can_view_financials(uuid)'::regprocedure,
    'public.can_manage_billing(uuid)'::regprocedure,
    'public.can_manage_schedule(uuid)'::regprocedure,
    'public.can_manage_client_access(uuid)'::regprocedure,
    'public.can_read_client_project(uuid)'::regprocedure,
    'public.can_view_client_change_orders(uuid)'::regprocedure,
    'public.can_view_client_daily_reports(uuid)'::regprocedure,
    'public.can_view_client_billing(uuid)'::regprocedure,
    'public.can_view_client_selections(uuid)'::regprocedure,
    'public.can_view_client_selection(uuid)'::regprocedure,
    'public.can_approve_client_change_order(uuid)'::regprocedure,
    'public.record_client_change_order_decision(uuid,public.client_approval_decision,text,text)'::regprocedure,
    'public.record_client_selection_decision(uuid,uuid,text,text,text)'::regprocedure,
    'public.update_organization_membership_authority(uuid,public.account_role,public.member_status,jsonb)'::regprocedure,
    'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)'::regprocedure,
    'public.lookup_auth_user_by_email_exact(text)'::regprocedure,
    'public.tg_projects_ensure_organization()'::regprocedure,
    'public.tg_projects_creator_assignment()'::regprocedure,
    'public.tg_guard_project_client_access_binding()'::regprocedure,
    'public.tg_guard_organization_membership_authority()'::regprocedure,
    'public.tg_guard_organization_invite_authority()'::regprocedure
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM sandbox_exec',
      v_function
    );
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.ensure_user_account(uuid,text,text)'::regprocedure,
    'public.ensure_current_user_account()'::regprocedure,
    'public.finalize_invite_acceptance(uuid)'::regprocedure,
    'public.finalize_client_access_acceptance(uuid)'::regprocedure,
    'public.can_create_project_in_org(uuid)'::regprocedure,
    'public.can_read_project(uuid)'::regprocedure,
    'public.can_manage_project(uuid)'::regprocedure,
    'public.can_view_financials(uuid)'::regprocedure,
    'public.can_manage_billing(uuid)'::regprocedure,
    'public.can_manage_schedule(uuid)'::regprocedure,
    'public.can_manage_client_access(uuid)'::regprocedure,
    'public.can_read_client_project(uuid)'::regprocedure,
    'public.can_view_client_change_orders(uuid)'::regprocedure,
    'public.can_view_client_daily_reports(uuid)'::regprocedure,
    'public.can_view_client_billing(uuid)'::regprocedure,
    'public.can_view_client_selections(uuid)'::regprocedure,
    'public.can_view_client_selection(uuid)'::regprocedure,
    'public.can_approve_client_change_order(uuid)'::regprocedure,
    'public.record_client_change_order_decision(uuid,public.client_approval_decision,text,text)'::regprocedure,
    'public.record_client_selection_decision(uuid,uuid,text,text,text)'::regprocedure,
    'public.update_organization_membership_authority(uuid,public.account_role,public.member_status,jsonb)'::regprocedure,
    'public.reserve_auth_magic_link_send(text,text,text,text,jsonb)'::regprocedure,
    'public.lookup_auth_user_by_email_exact(text)'::regprocedure,
    'public.tg_projects_ensure_organization()'::regprocedure,
    'public.tg_projects_creator_assignment()'::regprocedure,
    'public.tg_guard_project_client_access_binding()'::regprocedure,
    'public.tg_guard_organization_membership_authority()'::regprocedure,
    'public.tg_guard_organization_invite_authority()'::regprocedure
  ]
  LOOP
    IF pg_catalog.has_function_privilege(
      'sandbox_exec',
      v_function,
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '42501',
        MESSAGE = pg_catalog.format(
          'sandbox_exec retains Auth capability %s',
          v_function
        );
    END IF;
  END LOOP;
END;
$seal_and_verify$;