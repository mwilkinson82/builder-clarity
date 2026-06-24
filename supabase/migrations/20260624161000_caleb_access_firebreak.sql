-- Emergency onboarding firebreak for Caleb Morrow.
-- Both email spellings appeared during live onboarding; treat them as the same
-- Overwatch account key so magic-link signup cannot strand him in a fresh silo.

CREATE OR REPLACE FUNCTION public.overwatch_access_email_key(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE lower(trim(coalesce(p_email, '')))
    WHEN 'caleb@morrows-builds.com' THEN 'caleb@morrow-builds.com'
    WHEN 'caleb@morrow-builds.com' THEN 'caleb@morrow-builds.com'
    ELSE lower(trim(coalesce(p_email, '')))
  END;
$$;

REVOKE ALL ON FUNCTION public.overwatch_access_email_key(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.overwatch_access_email_key(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.overwatch_access_email_key(text) TO service_role;

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
      'owner',
      'active',
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
      invited_by,
      invited_email
    )
    VALUES (
      v_invite.organization_id,
      p_user_id,
      v_invite.role,
      'active',
      v_invite.invited_by,
      v_invite.email
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE
        WHEN public.organization_memberships.role IN ('owner', 'admin') THEN public.organization_memberships.role
        ELSE EXCLUDED.role
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
      'owner',
      'active',
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
        status = 'active',
        invited_email = COALESCE(NULLIF(public.organization_memberships.invited_email, ''), EXCLUDED.invited_email),
        updated_at = now();
    END IF;
  END IF;

  IF v_org_id IS NULL THEN
    v_org_name := trim(coalesce(nullif(split_part(coalesce(p_email, ''), '@', 2), ''), 'Overwatch Team'));
    IF v_org_name = '' THEN
      v_org_name := 'Overwatch Team';
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
      seat_limit = GREATEST(COALESCE(seat_limit, 0), 25),
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

REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;

DO $$
DECLARE
  v_user record;
  v_org_id uuid;
BEGIN
  FOR v_user IN
    SELECT
      u.id,
      u.email,
      COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', 'Caleb Morrow') AS full_name
    FROM auth.users u
    WHERE public.overwatch_access_email_key(u.email) = 'caleb@morrow-builds.com'
  LOOP
    v_org_id := public.ensure_user_account(v_user.id, v_user.email, v_user.full_name);

    UPDATE public.profiles
    SET full_name = COALESCE(NULLIF(full_name, ''), 'Caleb Morrow'),
        default_organization_id = COALESCE(default_organization_id, v_org_id),
        updated_at = now()
    WHERE id = v_user.id;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
