-- Contain account-provisioning privilege escalation and preserve invite intent.
--
-- The prior function copied the caller's own membership back onto itself as
-- `owner`, promoted every non-owner/admin conflict to `owner`, and rewrote the
-- organization's commercial entitlement during ordinary page loads. Because
-- ensure_current_user_account() is used throughout the app, a normal login or
-- workspace read could both escalate access and alter billing state.

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
      -- The organization creator remains its owner, and a duplicate invite
      -- cannot demote an already-active owner/admin. Every other accepted seat
      -- receives exactly the role/capabilities selected on the invitation.
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

    -- Keep the actual organization creator as Owner within this provisioning
    -- path; account bootstrap must never demote the creator.
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
    -- Respect the user's valid selected/default company before applying a
    -- deterministic fallback across their other active memberships.
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

  -- The access-email key exists only to reconcile a known, explicit alias.
  -- Never copy the row from the same user, and copy the source seat's actual
  -- role/capabilities rather than manufacturing Owner access.
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

    -- The membership INSERT trigger expands an explicit '{}' capability set to
    -- the role preset. Reapply the source value on UPDATE so an intentionally
    -- zero-capability alias remains zero-capability.
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

  -- A genuinely uninvited, unassociated account receives a new company and is
  -- its creator/owner. Commercial entitlement is deliberately not granted here;
  -- that belongs to the dedicated entitlement reconciler.
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
        -- v_org_id already prefers a valid active default. Assign it directly
        -- so a stale default is repaired when we fall back to another seat.
        ELSE v_org_id
      END,
      updated_at = now()
  WHERE id = p_user_id;

  RETURN v_org_id;
END;
$$;

-- The internal parameterized function is called by controlled trigger/service
-- paths only. Browser clients can call only the auth.uid()-bound wrapper.
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

-- Restore only the proven corruption signature: a non-creator accepted with a
-- non-owner invitation and subsequently promoted to Owner by the defective
-- resolver. The newest accepted invitation for that org/user is authoritative.
WITH accepted_seats AS (
  SELECT DISTINCT ON (m.id)
    m.id AS membership_id,
    m.user_id,
    m.organization_id,
    i.role AS invited_role,
    COALESCE(
      NULLIF(i.capabilities, '{}'::jsonb),
      public.role_preset_capabilities(i.role)
    ) AS invited_capabilities
  FROM public.organization_memberships m
  JOIN public.organization_invites i
    ON i.organization_id = m.organization_id
   AND i.accepted_by = m.user_id
   AND i.status = 'accepted'
  JOIN public.organizations o ON o.id = m.organization_id
  WHERE m.role = 'owner'
    AND i.role <> 'owner'
    AND o.created_by IS DISTINCT FROM m.user_id
    AND m.created_at = i.accepted_at
    AND public.overwatch_access_email_key(m.invited_email) =
        public.overwatch_access_email_key(i.email)
    -- Bound the one-time data repair to the observed incident window so a
    -- future legitimate co-owner promotion can never be reverted on replay.
    AND i.accepted_at >= timestamptz '2026-07-22 00:00:00+00'
    AND i.accepted_at < timestamptz '2026-07-23 00:00:00+00'
  ORDER BY m.id, i.accepted_at DESC NULLS LAST, i.updated_at DESC, i.id DESC
)
UPDATE public.organization_memberships m
SET role = a.invited_role,
    capabilities = a.invited_capabilities,
    updated_at = now()
FROM accepted_seats a
WHERE m.id = a.membership_id;

-- Fail the migration atomically if browser callers retained access or if the
-- narrowly identified incident records were not repaired as intended.
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

  IF EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    JOIN public.organization_invites i
      ON i.organization_id = m.organization_id
     AND i.accepted_by = m.user_id
     AND i.status = 'accepted'
    JOIN public.organizations o ON o.id = m.organization_id
    WHERE m.role = 'owner'
      AND i.role <> 'owner'
      AND o.created_by IS DISTINCT FROM m.user_id
      AND m.created_at = i.accepted_at
      AND public.overwatch_access_email_key(m.invited_email) =
          public.overwatch_access_email_key(i.email)
      AND i.accepted_at >= timestamptz '2026-07-22 00:00:00+00'
      AND i.accepted_at < timestamptz '2026-07-23 00:00:00+00'
  ) THEN
    RAISE EXCEPTION 'accepted invitation role repair did not converge';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';