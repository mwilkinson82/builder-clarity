-- DRAFT MIGRATION — NOT YET APPLIED.
--
-- Move to supabase/migrations/20260723200000_account_provisioning_disabled_seat_containment.sql
-- when ready to apply. Left in supabase/verification/ so this repository can
-- carry the reviewed SQL without the platform picking it up in a release.
--
-- P0 disabled-seat containment for account provisioning.
--
-- Finding 2 in production: a fresh Team Viewer whose sole ALP membership was
-- later disabled saw ensure_current_user_account() find no active seat, fall
-- into the generic zero-history bootstrap branch, and mint a brand-new
-- personal company + Owner membership. This is disabled-seat fallback
-- semantics — not trigger order — and it self-bootstraps Owner access every
-- time a locked-out identity refreshes.
--
-- This migration replaces ensure_user_account() so that ONLY a truly
-- zero-history, uninvited identity may receive the bootstrap company/Owner
-- membership. Any identity with prior association history (any membership
-- regardless of status, any accepted invite for accepted_by=user, or any
-- organization created_by=user) that currently has no active seat returns
-- NULL, has any stale/invalid default_organization_id cleared, and no
-- organization/Owner row is created.
--
-- Preserves everything the 20260722233000 hardening established:
--   - pending-invite-first acceptance with the exact invited role/capabilities
--   - creator-remains-Owner within the invite path
--   - active/default fallback for existing multi-org users
--   - the narrow, historical accepted-invite Owner corruption repair
--   - the alias / access-email reconciliation copying source role, not Owner
--   - EXECUTE revocations and browser/sandbox_exec assertions
--
-- No broad data deletion, no default rewrite for arbitrary rows: only the
-- caller's own default is cleared when it names a seat that is no longer
-- active.

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
  v_invited_org_id uuid;
  v_invite record;
  v_org_name text;
  v_email_key text;
  v_has_history boolean := false;
  v_current_default uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  -- Serialize provisioning for one auth identity so two concurrent first-page
  -- loads cannot create two separate companies for the same user.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_email_key := public.overwatch_access_email_key(p_email);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, coalesce(p_email, ''), coalesce(p_full_name, ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  -- Pending invitations are the authority for a newly accepted company seat.
  -- Process them before looking at an existing/default organization so an
  -- existing user invited to a second company lands in the invited company.
  FOR v_invite IN
    SELECT i.*
    FROM public.organization_invites i
    WHERE public.overwatch_access_email_key(i.email) = v_email_key
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at ASC, i.id ASC
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
      COALESCE(
        NULLIF(v_invite.capabilities, '{}'::jsonb),
        public.role_preset_capabilities(v_invite.role)
      ),
      v_invite.invited_by,
      v_invite.email
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.id = EXCLUDED.organization_id
            AND o.created_by = p_user_id
        ) THEN 'owner'::public.account_role
        WHEN public.organization_memberships.status = 'active'
          AND public.organization_memberships.role IN ('owner', 'admin')
          THEN public.organization_memberships.role
        ELSE EXCLUDED.role
      END,
      capabilities = CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.organizations o
          WHERE o.id = EXCLUDED.organization_id
            AND o.created_by = p_user_id
        ) THEN public.role_preset_capabilities('owner'::public.account_role)
        WHEN public.organization_memberships.status = 'active'
          AND public.organization_memberships.role IN ('owner', 'admin')
          THEN public.organization_memberships.capabilities
        ELSE EXCLUDED.capabilities
      END,
      status = 'active',
      invited_by = COALESCE(public.organization_memberships.invited_by, EXCLUDED.invited_by),
      invited_email = COALESCE(
        NULLIF(public.organization_memberships.invited_email, ''),
        EXCLUDED.invited_email
      ),
      updated_at = now();

    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      capabilities,
      invited_email
    )
    SELECT
      o.id,
      o.created_by,
      'owner'::public.account_role,
      'active'::public.member_status,
      public.role_preset_capabilities('owner'::public.account_role),
      ''
    FROM public.organizations o
    WHERE o.id = v_invite.organization_id
      AND o.created_by IS NOT NULL
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = 'owner'::public.account_role,
      status = 'active'::public.member_status,
      capabilities = public.role_preset_capabilities('owner'::public.account_role),
      updated_at = now();

    UPDATE public.organization_invites
    SET status = 'accepted',
        accepted_by = p_user_id,
        accepted_at = now(),
        updated_at = now()
    WHERE id = v_invite.id;

    v_invited_org_id := COALESCE(v_invited_org_id, v_invite.organization_id);
  END LOOP;

  IF v_invited_org_id IS NOT NULL THEN
    v_org_id := v_invited_org_id;
  ELSE
    SELECT m.organization_id
    INTO v_org_id
    FROM public.profiles p
    JOIN public.organization_memberships m
      ON m.organization_id = p.default_organization_id
     AND m.user_id = p.id
     AND m.status = 'active'
    WHERE p.id = p_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
      SELECT m.organization_id
      INTO v_org_id
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id
        AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, m.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  IF v_org_id IS NULL AND v_email_key <> '' THEN
    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      capabilities,
      invited_by,
      invited_email
    )
    SELECT DISTINCT ON (m.organization_id)
      m.organization_id,
      p_user_id,
      m.role,
      m.status,
      m.capabilities,
      m.invited_by,
      coalesce(p_email, '')
    FROM public.organization_memberships m
    JOIN public.profiles p ON p.id = m.user_id
    WHERE m.user_id <> p_user_id
      AND public.overwatch_access_email_key(p.email) = v_email_key
      AND m.status = 'active'
    ORDER BY m.organization_id, m.created_at ASC
    ON CONFLICT (organization_id, user_id) DO NOTHING;

    WITH alias_source AS (
      SELECT DISTINCT ON (m.organization_id)
        m.organization_id,
        m.role,
        m.capabilities
      FROM public.organization_memberships m
      JOIN public.profiles p ON p.id = m.user_id
      WHERE m.user_id <> p_user_id
        AND public.overwatch_access_email_key(p.email) = v_email_key
        AND m.status = 'active'
      ORDER BY m.organization_id, m.created_at ASC
    )
    UPDATE public.organization_memberships target
    SET role = source.role,
        capabilities = source.capabilities,
        updated_at = now()
    FROM alias_source source
    WHERE target.organization_id = source.organization_id
      AND target.user_id = p_user_id
      AND target.status = 'active'
      AND public.overwatch_access_email_key(target.invited_email) = v_email_key;

    SELECT m.organization_id
    INTO v_org_id
    FROM public.profiles p
    JOIN public.organization_memberships m
      ON m.organization_id = p.default_organization_id
     AND m.user_id = p.id
     AND m.status = 'active'
    WHERE p.id = p_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
      SELECT m.organization_id
      INTO v_org_id
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id
        AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, m.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- ------------------------------------------------------------------
  -- P0 disabled-seat containment.
  --
  -- If we still have no active org for this identity, the ONLY way we may
  -- create a new company + Owner membership is if the identity is truly
  -- new to Overwatch: no membership rows (any status), no accepted invite
  -- history, and no organizations they created. Any prior association is
  -- treated as a locked-out or in-transition seat — we return NULL and
  -- leave organization/membership state alone. UX handles the "no active
  -- company" screen and sign-out.
  -- ------------------------------------------------------------------
  IF v_org_id IS NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.organization_memberships m WHERE m.user_id = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.organization_invites i
      WHERE i.accepted_by = p_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.organizations o WHERE o.created_by = p_user_id
    )
    INTO v_has_history;

    IF v_has_history THEN
      -- Repair a stale default that points at a seat no longer active for
      -- this user. Do NOT touch any other row's default.
      SELECT p.default_organization_id INTO v_current_default
      FROM public.profiles p WHERE p.id = p_user_id;

      IF v_current_default IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id = p_user_id
          AND m.organization_id = v_current_default
          AND m.status = 'active'
      ) THEN
        UPDATE public.profiles
        SET default_organization_id = NULL,
            updated_at = now()
        WHERE id = p_user_id;
      END IF;

      RETURN NULL;
    END IF;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_name := trim(
      coalesce(nullif(split_part(coalesce(p_email, ''), '@', 2), ''), 'Overwatch Company')
    );
    IF v_org_name = '' THEN
      v_org_name := 'Overwatch Company';
    END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (initcap(replace(v_org_name, '.', ' ')), p_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      capabilities
    )
    VALUES (
      v_org_id,
      p_user_id,
      'owner',
      'active',
      public.role_preset_capabilities('owner'::public.account_role)
    )
    ON CONFLICT (organization_id, user_id) DO NOTHING;
  END IF;

  UPDATE public.profiles
  SET default_organization_id = CASE
        WHEN v_invited_org_id IS NOT NULL THEN v_invited_org_id
        ELSE v_org_id
      END,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN v_org_id;
END;
$$;

-- Preserve the internal/wrapper privilege boundary from 20260722233000. The
-- parameterized function is service-role/trigger only; browsers use the
-- auth.uid()-bound wrapper.
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_account(uuid, text, text) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM sandbox_exec';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO service_role;

-- Atomic privilege assertions.
DO $$
BEGIN
  IF has_function_privilege(
    'anon',
    'public.ensure_user_account(uuid,text,text)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.ensure_user_account(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by a browser role';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    IF has_function_privilege(
      'sandbox_exec',
      'public.ensure_user_account(uuid,text,text)',
      'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'ensure_user_account remains executable by sandbox_exec';
    END IF;
  END IF;

  IF NOT has_function_privilege(
    'service_role',
    'public.ensure_user_account(uuid,text,text)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'ensure_user_account lost service_role EXECUTE';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
