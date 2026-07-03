-- ============================================================================
-- ROLES PHASE 2 (2 of 2): enforcement reads capabilities, not role labels
-- ============================================================================
-- Requires 20260703070000_roles_capabilities_foundation.sql (column, presets,
-- default-fill trigger, seed) to be applied first.
--
-- The access helpers keep their EXACT signatures, so every existing RLS
-- policy stands unchanged; only the helper bodies switch from role-label
-- checks to capability checks. Behavior at cutover is identical to the seeded
-- role behavior (proven by scripts/roles-capability-parity-smoke.ts), with
-- two deliberate, documented exceptions:
--   * project_manager members can now SEE every project they could already
--     WRITE to (seeded projects.view_all closes audit Finding 1 in the
--     widening direction; the founder tightens individuals in the UI).
--   * a DISABLED company member no longer keeps project access through a
--     leftover active project assignment. The old helpers skipped the company
--     membership check on the assignment branch; the capability lookup
--     requires an ACTIVE membership row. Disabled means locked out.
--
-- Enforcement granularity note (documented in docs/ROLES.md): module policies
-- still call is_org_member / can_manage_project / can_manage_org exactly as
-- before, so estimating.write, crm.manage, cost_library.write, billing.manage,
-- schedule.manage, financials.view, and client_portal.manage are recorded and
-- shown in the UI but are NOT yet independently enforced by RLS. Splitting
-- those policies onto per-module helpers is the named Phase 3 follow-up.
-- ============================================================================

-- 1. The capability lookup -------------------------------------------------

CREATE OR REPLACE FUNCTION public.has_org_capability(p_org_id uuid, p_capability text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = p_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND m.capabilities @> jsonb_build_object(p_capability, true)
    )
  );
$$;

REVOKE ALL ON FUNCTION public.has_org_capability(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_org_capability(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_org_capability(uuid, text) TO service_role;

-- 2. is_org_member stays a membership check, on purpose ----------------------
-- It gates module READS (estimates, CRM, cost library) and those tables'
-- writes until the Phase 3 policy split; tying it to any single capability
-- would knock members out of reads they must keep. Restated verbatim so this
-- migration records the deliberate decision.

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.organization_id = p_org_id
        AND m.user_id = auth.uid()
        AND m.status = 'active'
    )
  );
$$;

-- 3. Company management reads capabilities ----------------------------------
-- The organizations / organization_memberships / organization_invites /
-- cost-library policies all call this one helper, so at the DB layer the two
-- company.* capabilities are enforced as a bundle this phase (either one
-- passes). The app layer distinguishes them: team edits require
-- company.manage_team, company-profile edits require company.manage_settings
-- (via has_org_capability). Per-policy split is Phase 3.

CREATE OR REPLACE FUNCTION public.can_manage_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.organization_memberships m
      WHERE m.organization_id = p_org_id
        AND m.user_id = (SELECT auth.uid())
        AND m.status = 'active'
        AND (
          m.capabilities @> '{"company.manage_team": true}'::jsonb
          OR m.capabilities @> '{"company.manage_settings": true}'::jsonb
        )
    )
  );
$$;

-- 4. Project read: view_all, or view_assigned + an active assignment ---------

CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR public.has_org_capability(p.organization_id, 'projects.view_all')
          OR (
            public.has_org_capability(p.organization_id, 'projects.view_assigned')
            AND EXISTS (
              SELECT 1
              FROM public.project_memberships pm
              WHERE pm.project_id = p.id
                AND pm.user_id = (SELECT auth.uid())
                AND pm.status = 'active'
            )
          )
        )
    )
  );
$$;

-- 5. Project manage: projects.manage scoped by visibility, or a per-project
--    editor role on an assigned project ---------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR (
            public.has_org_capability(p.organization_id, 'projects.manage')
            AND (
              public.has_org_capability(p.organization_id, 'projects.view_all')
              OR EXISTS (
                SELECT 1
                FROM public.project_memberships pm
                WHERE pm.project_id = p.id
                  AND pm.user_id = (SELECT auth.uid())
                  AND pm.status = 'active'
              )
            )
          )
          OR (
            public.has_org_capability(p.organization_id, 'projects.view_assigned')
            AND EXISTS (
              SELECT 1
              FROM public.project_memberships pm
              WHERE pm.project_id = p.id
                AND pm.user_id = (SELECT auth.uid())
                AND pm.status = 'active'
                AND pm.role IN ('owner', 'manager', 'editor')
            )
          )
        )
    )
  );
$$;

-- 6. Financial visibility (new, distinct) -------------------------------------
-- No policy calls this yet: billing/IOR SELECTs still ride on
-- can_read_project this phase. It exists so the app can gate dollar displays
-- and so the Phase 3 policy split has its helper ready.

CREATE OR REPLACE FUNCTION public.can_view_financials(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR (
            public.has_org_capability(p.organization_id, 'financials.view')
            AND public.can_read_project(p_project_id)
          )
        )
    )
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_financials(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_financials(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_financials(uuid) TO service_role;

-- 7. Invite acceptance copies the capabilities chosen at invite time ----------
-- Same function as 20260624191500_company_admin_and_grant_limits.sql with
-- exactly three changes, all in membership writes: (a) the invite-loop insert
-- carries the invite's capabilities (falling back to the role preset),
-- (b) its conflict branch updates capabilities with the same owner/admin
-- guard the role column already had, (c) the email-key owner repairs set the
-- owner preset when they promote a row. Everything else is byte-identical.

CREATE OR REPLACE FUNCTION public.ensure_user_account(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_invite record;
  v_org_name text;
  v_email_key text;
BEGIN
  v_email_key := public.overwatch_access_email_key(p_email);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, coalesce(p_email, ''), coalesce(p_full_name, ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  IF v_email_key <> '' THEN
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_email
    )
    SELECT DISTINCT
      m.organization_id,
      p_user_id,
      'owner'::public.account_role,
      'active'::public.member_status,
      coalesce(p_email, '')
    FROM public.organization_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE public.overwatch_access_email_key(p.email) = v_email_key
      AND m.status = 'active'
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE
        WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.role
        ELSE 'owner'
      END,
      capabilities = CASE
        WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.capabilities
        ELSE public.role_preset_capabilities('owner'::public.account_role)
      END,
      status = 'active',
      invited_email = COALESCE(NULLIF(public.organization_memberships.invited_email, ''), EXCLUDED.invited_email),
      updated_at = now();

    SELECT m.organization_id
    INTO v_org_id
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.status = 'active'
    ORDER BY (m.role = 'owner') DESC, m.created_at ASC
    LIMIT 1;
  END IF;

  FOR v_invite IN
    SELECT *
    FROM public.organization_invites i
    WHERE public.overwatch_access_email_key(i.email) = v_email_key
      AND i.status = 'pending'
      AND i.expires_at > now()
  LOOP
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      capabilities,
      invited_by,
      invited_email
    )
    VALUES (
      v_invite.organization_id,
      p_user_id,
      v_invite.role,
      'active',
      COALESCE(NULLIF(v_invite.capabilities, '{}'::jsonb), public.role_preset_capabilities(v_invite.role)),
      v_invite.invited_by,
      v_invite.email
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE
        WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.role
        ELSE EXCLUDED.role
      END,
      capabilities = CASE
        WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.capabilities
        ELSE EXCLUDED.capabilities
      END,
      status = 'active',
      invited_by = COALESCE(public.organization_memberships.invited_by, EXCLUDED.invited_by),
      invited_email = COALESCE(NULLIF(public.organization_memberships.invited_email, ''), EXCLUDED.invited_email),
      updated_at = now();

    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_email
    )
    SELECT
      p.organization_id,
      p.owner_id,
      'owner'::public.account_role,
      'active'::public.member_status,
      ''
    FROM public.projects p
    WHERE p.organization_id = v_invite.organization_id
      AND p.owner_id IS NOT NULL
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    UPDATE public.organization_invites
    SET status = 'accepted',
        accepted_by = p_user_id,
        accepted_at = now(),
        updated_at = now()
    WHERE id = v_invite.id;

    IF v_org_id IS NULL THEN
      v_org_id := v_invite.organization_id;
    END IF;
  END LOOP;

  IF v_org_id IS NULL THEN
    SELECT m.organization_id
    INTO v_org_id
    FROM public.organization_memberships m
    WHERE m.user_id = p_user_id
      AND m.status = 'active'
    ORDER BY (m.role = 'owner') DESC, m.created_at ASC
    LIMIT 1;
  END IF;

  IF v_org_id IS NULL AND v_email_key <> '' THEN
    SELECT m.organization_id
    INTO v_org_id
    FROM public.organization_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE public.overwatch_access_email_key(p.email) = v_email_key
      AND m.status = 'active'
    ORDER BY (m.role = 'owner') DESC, m.created_at ASC
    LIMIT 1;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.organization_memberships (
        organization_id,
        user_id,
        role,
        status,
        invited_email
      )
      VALUES (
        v_org_id,
        p_user_id,
        'owner',
        'active',
        coalesce(p_email, '')
      )
      ON CONFLICT (organization_id, user_id) DO UPDATE SET
        role = CASE
          WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.role
          ELSE 'owner'
        END,
        capabilities = CASE
          WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.capabilities
          ELSE public.role_preset_capabilities('owner'::public.account_role)
        END,
        status = 'active',
        invited_email = COALESCE(NULLIF(public.organization_memberships.invited_email, ''), EXCLUDED.invited_email),
        updated_at = now();
    END IF;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_name := trim(coalesce(nullif(split_part(coalesce(p_email, ''), '@', 2), ''), 'Overwatch Company'));
    IF v_org_name = '' THEN
      v_org_name := 'Overwatch Company';
    END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (initcap(replace(v_org_name, '.', ' ')), p_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_memberships (organization_id, user_id, role, status)
    VALUES (v_org_id, p_user_id, 'owner', 'active')
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.organizations
  SET contractor_circle_grant = true,
      billing_status = 'contractor_circle_grant',
      project_limit = GREATEST(COALESCE(project_limit, 0), 10),
      seat_limit = 10,
      storage_limit_mb = GREATEST(COALESCE(storage_limit_mb, 0), 10240),
      daily_report_limit_per_month = GREATEST(COALESCE(daily_report_limit_per_month, 0), 1000),
      updated_at = now()
  WHERE id = v_org_id;

  UPDATE public.profiles
  SET default_organization_id = COALESCE(default_organization_id, v_org_id),
      updated_at = now()
  WHERE id = p_user_id;

  RETURN v_org_id;
END;
$$;

-- 8. Ask PostgREST to reload so the new column and RPCs are visible ------------
NOTIFY pgrst, 'reload schema';
