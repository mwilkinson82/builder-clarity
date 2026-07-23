-- P0 sign-in provisioning and authorization lockdown.
-- TRACKED FORWARD MIGRATION: intentionally unapplied. Apply only through the
-- Lovable Interconnector during the approved sign-in maintenance window.
--
-- Ordinary login now only refreshes the caller's profile and resolves an
-- existing ACTIVE company seat. Company creation, Owner minting, same-email
-- alias cloning, and pending-invite sweeps are deliberately absent.
-- Abort before any P0 cutover change if an already-active client row cannot be
-- preserved by the deterministic same-user repair in the next migration.
DO $preflight$
DECLARE v_unsafe_client_rows bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_unsafe_client_rows
  FROM public.project_client_access AS access_row
  WHERE access_row.status = 'active'
    AND (
      access_row.client_user_id IS NULL
      OR (
        access_row.accepted_by IS NOT NULL
        AND access_row.accepted_by <> access_row.client_user_id
      )
    );
  IF v_unsafe_client_rows > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = pg_catalog.format(
      'Client-access preflight failed before P0 Auth cutover: %s unsafe active rows.',
      v_unsafe_client_rows
    );
  END IF;
END;
$preflight$;
CREATE OR REPLACE FUNCTION public.ensure_user_account(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_auth_email text;
  v_auth_name text;
  v_org_id uuid;
  v_rows integer;
  v_now timestamptz;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22004', MESSAGE = 'User id is required.';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_user_id::text, 0)
  );

  SELECT
    pg_catalog.coalesce(u.email, ''),
    pg_catalog.coalesce(
      pg_catalog.nullif(p_full_name, ''),
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )
  INTO v_auth_email, v_auth_name
  FROM auth.users AS u
  WHERE u.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Authenticated user was not found.';
  END IF;

  -- Never trust a service caller to transfer an account by supplying another
  -- email. The canonical auth.users email is the profile identity.
  IF pg_catalog.btrim(pg_catalog.coalesce(p_email, '')) <> ''
    AND pg_catalog.lower(pg_catalog.btrim(p_email))
      <> pg_catalog.lower(pg_catalog.btrim(v_auth_email)) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Account identity does not match.';
  END IF;
  v_now := pg_catalog.clock_timestamp();
  INSERT INTO public.profiles (id, email, full_name, updated_at)
  VALUES (p_user_id, v_auth_email, v_auth_name, v_now)
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = pg_catalog.coalesce(
      pg_catalog.nullif(public.profiles.full_name, ''),
      EXCLUDED.full_name
    ),
    updated_at = EXCLUDED.updated_at;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Profile provisioning did not converge.';
  END IF;
  SELECT m.organization_id
  INTO v_org_id
  FROM public.profiles AS p
  JOIN public.organization_memberships AS m
    ON m.organization_id = p.default_organization_id
   AND m.user_id = p.id
   AND m.status = 'active'
  WHERE p.id = p_user_id
  LIMIT 1;
  IF v_org_id IS NULL THEN
    SELECT m.organization_id
    INTO v_org_id
    FROM public.organization_memberships AS m
    WHERE m.user_id = p_user_id
      AND m.status = 'active'
    ORDER BY
      (m.role = 'owner'::public.account_role) DESC,
      m.created_at ASC,
      m.id ASC
    LIMIT 1;
  END IF;
  UPDATE public.profiles
  SET default_organization_id = v_org_id,
      updated_at = v_now
  WHERE id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Profile company resolution did not converge.';
  END IF;
  -- NULL is the intentional fail-closed answer for an unprovisioned or
  -- disabled-only account. No organization or membership is manufactured.
  RETURN v_org_id;
END;
$fn$;
CREATE OR REPLACE FUNCTION public.ensure_current_user_account()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_full_name text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required.';
  END IF;

  SELECT
    u.email,
    pg_catalog.coalesce(
      u.raw_user_meta_data ->> 'full_name',
      u.raw_user_meta_data ->> 'name',
      ''
    )
  INTO v_email, v_full_name
  FROM auth.users AS u
  WHERE u.id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Authenticated user was not found.';
  END IF;

  RETURN public.ensure_user_account(v_user_id, v_email, v_full_name);
END;
$fn$;
-- Auth-user creation must never manufacture a company, Owner seat, or demo
-- project. The authenticated callback performs the explicit profile/seat
-- resolution after the session is established.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_account_created ON auth.users;

-- Exact company-invite acceptance. The callback supplies the clicked invite
-- id; no other pending invite is read or accepted.
CREATE OR REPLACE FUNCTION public.finalize_invite_acceptance(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_invite public.organization_invites%ROWTYPE;
  v_membership public.organization_memberships%ROWTYPE;
  v_invite_caps jsonb;
  v_rows integer;
  v_now timestamptz;
BEGIN
  IF v_caller IS NULL OR p_invite_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A valid invite and sign-in are required.';
  END IF;

  SELECT u.email INTO v_caller_email
  FROM auth.users AS u
  WHERE u.id = v_caller;
  IF NOT FOUND OR pg_catalog.btrim(pg_catalog.coalesce(v_caller_email, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A verified email is required.';
  END IF;

  PERFORM public.ensure_user_account(v_caller, v_caller_email, '');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.lower(pg_catalog.btrim(v_caller_email)), 1)
  );

  SELECT * INTO v_invite
  FROM public.organization_invites AS i
  WHERE i.id = p_invite_id
  FOR UPDATE OF i;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Invite is unavailable.';
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_invite.email))
    <> pg_catalog.lower(pg_catalog.btrim(v_caller_email)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite is unavailable.';
  END IF;

  SELECT * INTO v_membership
  FROM public.organization_memberships AS m
  WHERE m.organization_id = v_invite.organization_id
    AND m.user_id = v_caller
  FOR UPDATE OF m;

  IF v_invite.status = 'accepted'
    AND v_invite.accepted_by = v_caller
    AND v_membership.id IS NOT NULL
    AND v_membership.status = 'active' THEN
    RETURN v_invite.organization_id;
  END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_invite.status <> 'pending'
    OR v_invite.expires_at IS NULL
    OR v_invite.expires_at <= v_now THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite is unavailable.';
  END IF;
  IF v_membership.id IS NOT NULL AND v_membership.status = 'disabled' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This company seat is disabled.';
  END IF;

  v_invite_caps := pg_catalog.coalesce(
    pg_catalog.nullif(v_invite.capabilities, '{}'::jsonb), public.role_preset_capabilities(v_invite.role)
  );
  IF pg_catalog.jsonb_typeof(v_invite_caps) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_invite_caps) AS requested(key, value)
      WHERE pg_catalog.jsonb_typeof(requested.value) <> 'boolean'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Invite authority is invalid.';
  END IF;

  -- Acceptance rechecks the exact inviter's current authority. A stale,
  -- disabled, or over-delegated pending row cannot mint access later.
  IF NOT EXISTS (
      SELECT 1
      FROM public.organization_memberships AS inviter
      WHERE inviter.organization_id = v_invite.organization_id
        AND inviter.user_id = v_invite.invited_by
        AND inviter.status = 'active'
        AND (
          inviter.role = 'owner'::public.account_role
          OR (
            v_invite.role <> 'owner'::public.account_role
            AND inviter.capabilities @> '{"company.manage_team":true}'::jsonb
            AND NOT EXISTS (
              SELECT 1
              FROM pg_catalog.jsonb_each(v_invite_caps) AS requested(key, value)
              WHERE requested.value = 'true'::jsonb
                AND inviter.capabilities -> requested.key
                  IS DISTINCT FROM 'true'::jsonb
            )
          )
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.app_super_admins AS super_admin
      WHERE super_admin.user_id = v_invite.invited_by
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite authority is invalid.';
  END IF;

  UPDATE public.organization_invites
  SET status = 'accepted',
      accepted_by = v_caller,
      accepted_at = v_now,
      updated_at = v_now
  WHERE id = p_invite_id
    AND status = 'pending'
    AND expires_at > v_now;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Invite changed before acceptance.';
  END IF;

  IF v_membership.id IS NULL THEN
    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status, capabilities,
      invited_by, invited_email, updated_at
    )
    VALUES (
      v_invite.organization_id, v_caller, v_invite.role, 'active',
      v_invite_caps,
      v_invite.invited_by, v_invite.email, v_now
    );
  ELSIF v_membership.status = 'pending' THEN
    UPDATE public.organization_memberships
    SET role = v_invite.role,
        status = 'active',
        capabilities = v_invite_caps,
        invited_by = v_invite.invited_by,
        invited_email = v_invite.email,
        updated_at = v_now
    WHERE id = v_membership.id
      AND status = 'pending';
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Company seat changed before acceptance.';
    END IF;
  END IF;

  -- A legitimate existing active membership, including an Owner, is preserved
  -- exactly. The invite does not demote or rewrite that seat.
  UPDATE public.profiles
  SET default_organization_id = v_invite.organization_id,
      updated_at = v_now
  WHERE id = v_caller;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'Invite profile finalization did not converge.';
  END IF;

  RETURN v_invite.organization_id;
END;
$fn$;

-- Exact client-access acceptance. Pending/email rows are never readable portal
-- authority; only this callback RPC binds one exact row to one exact auth user.
CREATE OR REPLACE FUNCTION public.finalize_client_access_acceptance(
  p_client_access_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_access public.project_client_access%ROWTYPE;
  v_rows integer;
  v_now timestamptz;
BEGIN
  IF v_caller IS NULL OR p_client_access_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Valid client access and sign-in are required.';
  END IF;

  SELECT u.email INTO v_caller_email
  FROM auth.users AS u
  WHERE u.id = v_caller;
  IF NOT FOUND OR pg_catalog.btrim(pg_catalog.coalesce(v_caller_email, '')) = '' THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'A verified email is required.';
  END IF;

  PERFORM public.ensure_user_account(v_caller, v_caller_email, '');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.lower(pg_catalog.btrim(v_caller_email)), 2)
  );

  SELECT * INTO v_access
  FROM public.project_client_access AS access_row
  WHERE access_row.id = p_client_access_id
  FOR UPDATE OF access_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Client access is unavailable.';
  END IF;

  IF pg_catalog.lower(pg_catalog.btrim(v_access.email))
    <> pg_catalog.lower(pg_catalog.btrim(v_caller_email)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Client access is unavailable.';
  END IF;

  v_now := pg_catalog.clock_timestamp();
  IF v_access.status = 'active'
    AND v_access.client_user_id = v_caller
    AND (v_access.accepted_by IS NULL OR v_access.accepted_by = v_caller) THEN
    UPDATE public.project_client_access
    SET accepted_by = v_caller,
        accepted_at = pg_catalog.coalesce(accepted_at, v_now),
        updated_at = v_now
    WHERE id = v_access.id
      AND status = 'active'
      AND client_user_id = v_caller
      AND (accepted_by IS NULL OR accepted_by = v_caller);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Client access changed before acceptance.';
    END IF;
    RETURN v_access.project_id;
  END IF;

  IF v_access.status <> 'pending'
    OR (v_access.client_user_id IS NOT NULL AND v_access.client_user_id <> v_caller)
    OR (v_access.accepted_by IS NOT NULL AND v_access.accepted_by <> v_caller) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Client access is unavailable.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.projects AS p
    JOIN public.organization_memberships AS m
      ON m.organization_id = p.organization_id
     AND m.user_id = v_caller
     AND m.status = 'disabled'
    WHERE p.id = v_access.project_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'This company seat is disabled.';
  END IF;

  UPDATE public.project_client_access
  SET status = 'active',
      client_user_id = v_caller,
      accepted_by = v_caller,
      accepted_at = v_now,
      updated_at = v_now
  WHERE id = v_access.id
    AND status = 'pending'
    AND pg_catalog.lower(pg_catalog.btrim(email))
      = pg_catalog.lower(pg_catalog.btrim(v_caller_email))
    AND (client_user_id IS NULL OR client_user_id = v_caller)
    AND (accepted_by IS NULL OR accepted_by = v_caller);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'Client access changed before acceptance.';
  END IF;

  RETURN v_access.project_id;
END;
$fn$;

-- Project access is membership/capability authority. projects.owner_id is
-- attribution only and never bypasses a disabled or missing company seat.
CREATE OR REPLACE FUNCTION public.can_create_project_in_org(p_org_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND p_org_id IS NOT NULL
    AND (
      public.is_super_admin()
      OR public.has_org_capability(p_org_id, 'projects.manage')
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.projects AS project_row
        WHERE project_row.id = p_project_id
          AND (
            public.has_org_capability(project_row.organization_id, 'projects.view_all')
            OR (
              public.has_org_capability(project_row.organization_id, 'projects.view_assigned')
              AND EXISTS (
                SELECT 1 FROM public.project_memberships AS assignment
                WHERE assignment.project_id = project_row.id
                  AND assignment.user_id = auth.uid()
                  AND assignment.status = 'active'
              )
            )
          )
      )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.projects AS project_row
        WHERE project_row.id = p_project_id
          AND public.has_org_capability(project_row.organization_id, 'projects.manage')
          AND (
            public.has_org_capability(project_row.organization_id, 'projects.view_all')
            OR EXISTS (
              SELECT 1 FROM public.project_memberships AS assignment
              WHERE assignment.project_id = project_row.id
                AND assignment.user_id = auth.uid()
                AND assignment.status = 'active'
                AND assignment.role IN ('owner', 'manager', 'editor')
            )
          )
      )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_financials(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_read_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project_row
      WHERE project_row.id = p_project_id
        AND (
          public.is_super_admin()
          OR public.has_org_capability(project_row.organization_id, 'financials.view')
        )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_billing(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_manage_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project_row
      WHERE project_row.id = p_project_id
        AND (
          public.is_super_admin()
          OR public.has_org_capability(project_row.organization_id, 'billing.manage')
        )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_schedule(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_manage_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project_row
      WHERE project_row.id = p_project_id
        AND (
          public.is_super_admin()
          OR public.has_org_capability(project_row.organization_id, 'schedule.manage')
        )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_manage_client_access(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_manage_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects AS project_row
      WHERE project_row.id = p_project_id
        AND (
          public.is_super_admin()
          OR public.has_org_capability(project_row.organization_id, 'client_portal.manage')
        )
    );
$fn$;

CREATE OR REPLACE FUNCTION public.tg_projects_ensure_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_email text;
  v_full_name text;
  v_org_id uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT
      u.email,
      pg_catalog.coalesce(
        u.raw_user_meta_data ->> 'full_name',
        u.raw_user_meta_data ->> 'name',
        ''
      )
    INTO v_email, v_full_name
    FROM auth.users AS u
    WHERE u.id = NEW.owner_id;

    v_org_id := public.ensure_user_account(NEW.owner_id, v_email, v_full_name);
    IF v_org_id IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Active company access is required to create a project.';
    END IF;
    NEW.organization_id := v_org_id;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Replace the Owner-minting trigger with a scoped project-manager assignment.
-- Project creation never mints either a company Owner or a project Owner.
DROP TRIGGER IF EXISTS projects_owner_membership ON public.projects;
DROP FUNCTION IF EXISTS public.tg_projects_owner_membership();

CREATE OR REPLACE FUNCTION public.tg_projects_creator_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF NEW.organization_id IS NOT NULL
    AND NEW.owner_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships AS member
      WHERE member.organization_id = NEW.organization_id
        AND member.user_id = NEW.owner_id
        AND member.status = 'active'
        AND member.capabilities @> '{"projects.manage":true}'::jsonb
    ) THEN
    INSERT INTO public.project_memberships (project_id, user_id, role, status)
    VALUES (NEW.id, NEW.owner_id, 'manager', 'active')
    ON CONFLICT (project_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS projects_creator_assignment ON public.projects;
CREATE TRIGGER projects_creator_assignment
  AFTER INSERT ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_projects_creator_assignment();

DROP POLICY IF EXISTS projects_team_insert ON public.projects;
CREATE POLICY projects_team_insert
  ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    AND organization_id IS NOT NULL
    AND public.can_create_project_in_org(organization_id)
  );

-- Remove every legacy direct owner_id bypass; capability/team policies remain.
DROP POLICY IF EXISTS projects_owner_all ON public.projects;
DROP POLICY IF EXISTS "projects_owner_all" ON public.projects;
DROP POLICY IF EXISTS "holds_owner_via_project" ON public.holds;
DROP POLICY IF EXISTS change_orders_owner_via_project ON public.change_orders;
DROP POLICY IF EXISTS daily_reports_owner_via_project ON public.daily_reports;
DROP POLICY IF EXISTS decisions_owner_via_project ON public.decisions;
DROP POLICY IF EXISTS exposures_owner_via_project ON public.exposures;
DROP POLICY IF EXISTS reviews_owner_via_project ON public.reviews;
DROP POLICY IF EXISTS "Owners manage their schedule milestones"
  ON public.schedule_milestones;
DROP POLICY IF EXISTS "Owners manage their schedule risks"
  ON public.schedule_risks;
DROP POLICY IF EXISTS daily_reports_storage_read ON storage.objects;
DROP POLICY IF EXISTS daily_reports_storage_insert ON storage.objects;
DROP POLICY IF EXISTS daily_reports_storage_update ON storage.objects;
DROP POLICY IF EXISTS daily_reports_storage_delete ON storage.objects;

DROP POLICY IF EXISTS holds_team_select ON public.holds;
CREATE POLICY holds_team_select ON public.holds
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS holds_team_insert ON public.holds;
CREATE POLICY holds_team_insert ON public.holds
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS holds_team_update ON public.holds;
CREATE POLICY holds_team_update ON public.holds
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS holds_team_delete ON public.holds;
CREATE POLICY holds_team_delete ON public.holds
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

-- SECURITY DEFINER RPCs are opt-in endpoints, not PUBLIC APIs.
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

DO $verify$
DECLARE
  v_function regprocedure;
  v_name text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.can_create_project_in_org(uuid)'::regprocedure,
    'public.can_read_project(uuid)'::regprocedure,
    'public.can_manage_project(uuid)'::regprocedure,
    'public.can_view_financials(uuid)'::regprocedure,
    'public.can_manage_billing(uuid)'::regprocedure,
    'public.can_manage_schedule(uuid)'::regprocedure,
    'public.can_manage_client_access(uuid)'::regprocedure
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon',
      v_function
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role',
      v_function
    );
  END LOOP;

  FOREACH v_function IN ARRAY ARRAY[
    'public.tg_projects_ensure_organization()'::regprocedure,
    'public.tg_projects_creator_assignment()'::regprocedure
  ]
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      v_function
    );
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec') THEN
    FOR v_name IN
      SELECT p.oid::regprocedure::text
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid = ANY (ARRAY[
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
        'public.can_manage_client_access(uuid)'::regprocedure
      ])
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION %s FROM sandbox_exec',
        v_name
      );
    END LOOP;
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'anon', 'public.finalize_client_access_acceptance(uuid)', 'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated', 'public.ensure_current_user_account()', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'P0 auth RPC grant containment failed';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec')
    AND (
      pg_catalog.has_function_privilege(
        'sandbox_exec', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege(
        'sandbox_exec', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE'
      )
      OR pg_catalog.has_function_privilege(
        'sandbox_exec', 'public.can_manage_project(uuid)', 'EXECUTE'
      )
    ) THEN
    RAISE EXCEPTION 'Sandbox execution remains enabled for a P0 auth function';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE policyname IN (
      'projects_owner_all', 'holds_owner_via_project',
      'change_orders_owner_via_project', 'daily_reports_owner_via_project',
      'decisions_owner_via_project', 'exposures_owner_via_project',
      'reviews_owner_via_project', 'Owners manage their schedule milestones',
      'Owners manage their schedule risks', 'daily_reports_storage_read',
      'daily_reports_storage_insert', 'daily_reports_storage_update',
      'daily_reports_storage_delete'
    )
  ) THEN
    RAISE EXCEPTION 'A legacy Owner bypass policy remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgname = 'projects_owner_membership'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The organization Owner-minting project trigger remains';
  END IF;
END;
$verify$;
