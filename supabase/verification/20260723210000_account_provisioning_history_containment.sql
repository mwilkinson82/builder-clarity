-- =====================================================================
-- P0 SIGN-IN CONTAINMENT — forward migration draft (UNAPPLIED).
--
-- HOUSING NOTE: this repo's tooling blocks direct writes into
-- supabase/migrations/. Move this file to
--   supabase/migrations/20260723210000_account_provisioning_history_containment.sql
-- (or a later timestamp than every currently-applied migration) during
-- the maintenance-window apply step in docs/RELEASE_GATE.md
-- (Sign-In P0 section). The file is CREATE OR REPLACE / DROP IF EXISTS
-- only and is replay-safe.
--
-- Fixes two production incidents in one narrow forward step:
--
--   Finding 2 (disabled-seat refresh): a fresh Team Viewer whose sole
--     ALP membership was later disabled saw ensure_current_user_account()
--     find no active seat, fall into the generic zero-history bootstrap
--     branch, and mint a brand-new personal company + Owner membership.
--     The corrected ensure_user_account() below returns NULL — with the
--     stale profile default cleared — for ANY identity that has prior
--     association history but no active internal seat.
--
--   Auth demo trigger: on_auth_user_created ran seed_demo_project()
--     against every fresh auth.users row and could plant a Harbor
--     project against invited-user identities or identities with no
--     active internal organization at the moment the trigger fired.
--     The app now runs an idempotent, organization-scoped
--     seedDemoIfEmpty from the portfolio bootstrap AFTER an active
--     internal workspace resolves. This migration DROPS the auth-level
--     trigger. It does not touch or delete any existing project.
--
-- Preserves everything the 20260722233000 hardening established:
--   pending-invite-first acceptance with the exact invited role/caps;
--   creator-remains-Owner within the invite path;
--   active/default fallback for existing multi-org users;
--   alias reconciliation copying the source role (not Owner);
--   EXECUTE revocations and browser/sandbox_exec assertions.
--
-- Explicit non-goals: no broad data delete, no cross-user default
-- rewrite, no demo/seed sweep, no touch to commercial entitlements.
-- =====================================================================

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

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_email_key := public.overwatch_access_email_key(p_email);

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, coalesce(p_email, ''), coalesce(p_full_name, ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  -- ----------------- Pending-invite-first acceptance -----------------
  FOR v_invite IN
    SELECT i.*
    FROM public.organization_invites i
    WHERE public.overwatch_access_email_key(i.email) = v_email_key
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at ASC, i.id ASC
  LOOP
    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status, capabilities, invited_by, invited_email
    )
    VALUES (
      v_invite.organization_id, p_user_id, v_invite.role, 'active',
      COALESCE(
        NULLIF(v_invite.capabilities, '{}'::jsonb),
        public.role_preset_capabilities(v_invite.role)
      ),
      v_invite.invited_by, v_invite.email
    )
    ON CONFLICT (organization_id, user_id) DO UPDATE SET
      role = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = EXCLUDED.organization_id AND o.created_by = p_user_id
        ) THEN 'owner'::public.account_role
        WHEN public.organization_memberships.status = 'active'
          AND public.organization_memberships.role IN ('owner', 'admin')
          THEN public.organization_memberships.role
        ELSE EXCLUDED.role
      END,
      capabilities = CASE
        WHEN EXISTS (
          SELECT 1 FROM public.organizations o
          WHERE o.id = EXCLUDED.organization_id AND o.created_by = p_user_id
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
      organization_id, user_id, role, status, capabilities, invited_email
    )
    SELECT
      o.id, o.created_by, 'owner'::public.account_role,
      'active'::public.member_status,
      public.role_preset_capabilities('owner'::public.account_role), ''
    FROM public.organizations o
    WHERE o.id = v_invite.organization_id AND o.created_by IS NOT NULL
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

  -- ----------------- Existing valid default / active fallback -----------------
  IF v_invited_org_id IS NOT NULL THEN
    v_org_id := v_invited_org_id;
  ELSE
    SELECT m.organization_id INTO v_org_id
    FROM public.profiles p
    JOIN public.organization_memberships m
      ON m.organization_id = p.default_organization_id
     AND m.user_id = p.id
     AND m.status = 'active'
    WHERE p.id = p_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
      SELECT m.organization_id INTO v_org_id
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, m.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- ----------------- Alias / access-email reconciliation -----------------
  IF v_org_id IS NULL AND v_email_key <> '' THEN
    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status, capabilities, invited_by, invited_email
    )
    SELECT DISTINCT ON (m.organization_id)
      m.organization_id, p_user_id, m.role, m.status, m.capabilities, m.invited_by,
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
        m.organization_id, m.role, m.capabilities
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

    SELECT m.organization_id INTO v_org_id
    FROM public.profiles p
    JOIN public.organization_memberships m
      ON m.organization_id = p.default_organization_id
     AND m.user_id = p.id
     AND m.status = 'active'
    WHERE p.id = p_user_id
    LIMIT 1;

    IF v_org_id IS NULL THEN
      SELECT m.organization_id INTO v_org_id
      FROM public.organization_memberships m
      WHERE m.user_id = p_user_id AND m.status = 'active'
      ORDER BY (m.role = 'owner') DESC, m.created_at ASC
      LIMIT 1;
    END IF;
  END IF;

  -- =====================================================================
  -- P0 disabled-seat + client-only containment.
  --
  -- If we still have no active internal org for this identity, we may only
  -- create a new company + Owner membership when the identity is TRULY new
  -- to Overwatch. Any of the following counts as prior history and blocks
  -- bootstrap (returns NULL; clears the caller's own stale default only):
  --   * any organization_memberships row, any status;
  --   * any accepted organization_invites row (accepted_by = user);
  --   * any organization created_by = user;
  --   * a non-NULL profiles.default_organization_id even if referenced
  --     rows have since been removed;
  --   * any project_client_access row for this user (client_user_id OR
  --     accepted_by OR normalized email), ANY status — client-only,
  --     revoked, or pending — so client identities can NEVER self-
  --     bootstrap an internal Owner company;
  --   * any projects.owner_id = user;
  --   * any project_memberships.user_id = user.
  -- =====================================================================
  IF v_org_id IS NULL THEN
    SELECT
      EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.user_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.organization_invites i WHERE i.accepted_by = p_user_id
      )
      OR EXISTS (SELECT 1 FROM public.organizations o WHERE o.created_by = p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = p_user_id AND p.default_organization_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.project_client_access pca
        WHERE pca.client_user_id = p_user_id
           OR pca.accepted_by = p_user_id
           OR (
             v_email_key <> ''
             AND public.overwatch_access_email_key(pca.client_email) = v_email_key
           )
      )
      OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.owner_id = p_user_id)
      OR EXISTS (
        SELECT 1 FROM public.project_memberships pm WHERE pm.user_id = p_user_id
      )
    INTO v_has_history;

    IF v_has_history THEN
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

  -- ----------------- Zero-history bootstrap -----------------
  IF v_org_id IS NULL THEN
    v_org_name := trim(
      coalesce(nullif(split_part(coalesce(p_email, ''), '@', 2), ''), 'Overwatch Company')
    );
    IF v_org_name = '' THEN v_org_name := 'Overwatch Company'; END IF;

    INSERT INTO public.organizations (name, created_by)
    VALUES (initcap(replace(v_org_name, '.', ' ')), p_user_id)
    RETURNING id INTO v_org_id;

    INSERT INTO public.organization_memberships (
      organization_id, user_id, role, status, capabilities
    )
    VALUES (
      v_org_id, p_user_id, 'owner', 'active',
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

-- =====================================================================
-- Drop the per-auth.users demo trigger. seed_demo_project() itself is
-- preserved for other callers/tests. seedDemoIfEmpty (organization-
-- scoped, idempotent) becomes the single seed path and only runs after
-- an active internal workspace resolves.
-- =====================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- =====================================================================
-- Privilege containment.
-- =====================================================================
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

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM sandbox_exec';
  END IF;
END;
$$;

DO $$
BEGIN
  IF has_function_privilege('anon','public.ensure_user_account(uuid,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','public.ensure_user_account(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by a browser role';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    IF has_function_privilege('sandbox_exec','public.ensure_user_account(uuid,text,text)','EXECUTE') THEN
      RAISE EXCEPTION 'ensure_user_account remains executable by sandbox_exec';
    END IF;
    IF has_function_privilege('sandbox_exec','public.ensure_current_user_account()','EXECUTE') THEN
      RAISE EXCEPTION 'ensure_current_user_account remains executable by sandbox_exec';
    END IF;
  END IF;

  IF NOT has_function_privilege('service_role','public.ensure_user_account(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account lost service_role EXECUTE';
  END IF;
  IF NOT has_function_privilege('authenticated','public.ensure_current_user_account()','EXECUTE') THEN
    RAISE EXCEPTION 'ensure_current_user_account lost authenticated EXECUTE';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
