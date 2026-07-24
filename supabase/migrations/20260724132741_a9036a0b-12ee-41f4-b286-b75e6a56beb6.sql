-- P0 final sandbox execution revocation.
--
-- Lovable's managed migration executor can retain explicit sandbox_exec grants
-- on functions touched by earlier migrations. This final migration changes no
-- function bodies or business data. It removes that operational role from the
-- complete Auth/authorization surface and fails atomically if any capability
-- remains reachable through either an explicit or inherited grant.

DO $revoke_and_verify$
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
$revoke_and_verify$;
