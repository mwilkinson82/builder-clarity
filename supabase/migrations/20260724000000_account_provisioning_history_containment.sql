-- =====================================================================
-- P0 SIGN-IN CONTAINMENT — tracked forward migration.
--
-- UNAPPLIED. Do not execute against the live DB outside the maintenance
-- window checklist in docs/RELEASE_GATE.md (§6 Sign-In P0).
--
-- Landing purpose (single narrow forward step):
--
--   Finding 2 (disabled-seat refresh): a fresh Team Viewer whose sole
--     internal seat was later disabled saw ensure_current_user_account()
--     find no active seat, fall into the generic zero-history bootstrap
--     branch, and mint a brand-new personal company + Owner membership.
--     ensure_user_account() below returns NULL — with the caller's stale
--     profile default cleared — for ANY identity that has prior
--     Overwatch association history, INCLUDING alternate profile/auth
--     UUIDs that share the same overwatch_access_email_key. A disabled
--     historical alias must never look like a zero-history identity.
--
--   Auth demo trigger: on_auth_user_created ran seed_demo_project()
--     against every fresh auth.users row. Dropped here. seed data is
--     preserved on disk (function body untouched); no rows deleted.
--
--   Related bypass: `projects_owner_all` RLS policy let any authenticated
--     identity insert a projects row with owner_id = auth.uid() and
--     organization_id = NULL, then read/update/delete it as "owner",
--     effectively minting an org-null workspace. Dropped here.
--     tg_projects_ensure_organization() is hardened to RAISE when
--     ensure_user_account() returns NULL, so a no-company identity can
--     never insert an org-null project row through any policy path.
--
--   Multi-invite landing default: when the magic-link handler validates
--     an exact invite for provisioning, it may set the transaction-local
--     GUC `overwatch.preferred_invite_id` before invoking
--     ensure_user_account. The pending-invite loop is now ORDERed so the
--     preferred invite is processed FIRST, and v_invited_org_id captures
--     that invite's org so the profile default lands on the exact org
--     matching the link the user clicked. Absent the GUC, prior
--     oldest-first behavior is preserved.
--
-- Preserves everything the 20260722233000 hardening established:
--   pending-invite-first acceptance with the exact invited role/caps;
--   creator-remains-Owner within the invite path;
--   active/default fallback for existing multi-org users;
--   alias reconciliation copying the source role (not Owner);
--   EXECUTE revocations and browser/sandbox_exec assertions.
--
-- Explicit non-goals: no broad data delete, no cross-user default
-- rewrite, no demo/seed sweep, no touch to commercial entitlements,
-- no projects.organization_id global NOT NULL, no old-project rewrite.
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
AS $fn$
DECLARE
  v_org_id uuid;
  v_invited_org_id uuid;
  v_invite record;
  v_org_name text;
  v_email_key text;
  v_has_history boolean := false;
  v_current_default uuid;
  v_preferred_invite_id uuid;
  v_preferred_setting text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_email_key := public.overwatch_access_email_key(p_email);

  -- Optional preferred-invite GUC. When set by the caller (magic-link
  -- handler) it names the exact invite whose organization must become
  -- the landing default. Bad/missing GUC quietly falls back to
  -- oldest-first behavior.
  BEGIN
    v_preferred_setting := current_setting('overwatch.preferred_invite_id', true);
    IF v_preferred_setting IS NOT NULL AND v_preferred_setting <> '' THEN
      v_preferred_invite_id := v_preferred_setting::uuid;
    END IF;
  EXCEPTION WHEN others THEN
    v_preferred_invite_id := NULL;
  END;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, coalesce(p_email, ''), coalesce(p_full_name, ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  -- ----------------- Pending-invite-first acceptance -----------------
  -- Preferred invite (if it matches this identity's email + pending +
  -- unexpired) is processed FIRST so v_invited_org_id captures its org.
  FOR v_invite IN
    SELECT i.*
    FROM public.organization_invites i
    WHERE public.overwatch_access_email_key(i.email) = v_email_key
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY
      CASE WHEN v_preferred_invite_id IS NOT NULL AND i.id = v_preferred_invite_id
           THEN 0 ELSE 1 END ASC,
      i.created_at ASC,
      i.id ASC
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
  -- P0 disabled-seat + client-only + alias-UUID containment.
  --
  -- If we still have no active internal org for this identity, we may
  -- only create a new company + Owner membership when the identity is
  -- TRULY new to Overwatch. Any of the following counts as prior
  -- history and blocks bootstrap (returns NULL; clears the caller's
  -- own stale default only):
  --
  --   For p_user_id itself:
  --     * any organization_memberships row, any status;
  --     * any accepted organization_invites row (accepted_by = user);
  --     * any organization created_by = user;
  --     * a non-NULL profiles.default_organization_id even if the
  --       referenced org/membership has since been removed;
  --     * any project_client_access row for this user
  --       (client_user_id OR accepted_by), ANY status;
  --     * any projects.owner_id = user;
  --     * any project_memberships.user_id = user.
  --
  --   For ANY alternate profile/auth UUID sharing this identity's
  --   overwatch_access_email_key (i.e. the same email in profiles.email
  --   OR the same normalized invite/client-access email), the SAME
  --   history checks apply, plus:
  --     * any project_client_access row whose normalized `email`
  --       (real column) matches v_email_key, ANY status —
  --       client-only, revoked, or pending — so a client identity
  --       can NEVER self-bootstrap an internal Owner company.
  --
  -- A disabled historical alias therefore never looks like zero
  -- history and never mints Owner.
  -- =====================================================================
  IF v_org_id IS NULL THEN
    WITH alias_users AS (
      SELECT id
        FROM public.profiles
       WHERE v_email_key <> ''
         AND public.overwatch_access_email_key(email) = v_email_key
      UNION
      SELECT p_user_id
    )
    SELECT
      EXISTS (
        SELECT 1 FROM public.organization_memberships m
        WHERE m.user_id IN (SELECT id FROM alias_users)
      )
      OR EXISTS (
        SELECT 1 FROM public.organization_invites i
        WHERE i.accepted_by IN (SELECT id FROM alias_users)
      )
      OR EXISTS (
        SELECT 1 FROM public.organizations o
        WHERE o.created_by IN (SELECT id FROM alias_users)
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id IN (SELECT id FROM alias_users)
          AND p.default_organization_id IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.project_client_access pca
        WHERE pca.client_user_id IN (SELECT id FROM alias_users)
           OR pca.accepted_by IN (SELECT id FROM alias_users)
           OR (
             v_email_key <> ''
             AND public.overwatch_access_email_key(pca.email) = v_email_key
           )
      )
      OR EXISTS (
        SELECT 1 FROM public.projects pr
        WHERE pr.owner_id IN (SELECT id FROM alias_users)
      )
      OR EXISTS (
        SELECT 1 FROM public.project_memberships pm
        WHERE pm.user_id IN (SELECT id FROM alias_users)
      )
    INTO v_has_history;

    IF v_has_history THEN
      -- Only clear the CURRENT caller's stale default. Never touch
      -- alias-UUID rows here — those belong to other identities and
      -- must be repaired through explicit admin flows.
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
$fn$;

-- =====================================================================
-- Drop the per-auth.users demo trigger. seed_demo_project() itself is
-- preserved for other callers/tests. seedDemoIfEmpty (organization-
-- scoped, idempotent) becomes the single seed path and only runs after
-- an active internal workspace resolves.
-- =====================================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- =====================================================================
-- Related-bypass closure on public.projects.
--
-- projects_owner_all let (auth.uid() = owner_id) grant ALL. Combined
-- with the org-null insert path, a no-company identity could mint an
-- org-null project workspace and treat it as an Owner surface. Drop
-- the legacy blanket policy — projects_team_* + projects_client_select
-- + Super admin policies fully cover the intended access model.
--
-- Then tighten tg_projects_ensure_organization: if ensure_user_account
-- returns NULL (i.e. history-blocked, no active org), RAISE so the
-- INSERT fails atomically instead of persisting an org-null row.
-- =====================================================================
DROP POLICY IF EXISTS projects_owner_all ON public.projects;

CREATE OR REPLACE FUNCTION public.tg_projects_ensure_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $tg$
DECLARE
  v_email text;
  v_full_name text;
  v_org uuid;
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT
      u.email,
      COALESCE(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')
    INTO v_email, v_full_name
    FROM auth.users u
    WHERE u.id = NEW.owner_id;

    v_org := public.ensure_user_account(NEW.owner_id, v_email, v_full_name);

    IF v_org IS NULL THEN
      RAISE EXCEPTION 'No active company access for this user; project cannot be created.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;

    NEW.organization_id := v_org;
  END IF;

  RETURN NEW;
END;
$tg$;

-- =====================================================================
-- Privilege containment matrix.
--
-- ensure_user_account(uuid, text, text):
--   PUBLIC / anon / authenticated / sandbox_exec DENIED.
--   service_role ALLOWED.
--
-- ensure_current_user_account():
--   PUBLIC / anon / sandbox_exec DENIED.
--   authenticated / service_role ALLOWED.
--   Wrapper body must remain auth.uid()-bound.
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
DECLARE
  v_wrapper_def text;
BEGIN
  IF has_function_privilege('anon', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account lost service_role EXECUTE';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    IF has_function_privilege('sandbox_exec', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'ensure_user_account remains executable by sandbox_exec';
    END IF;
    IF has_function_privilege('sandbox_exec', 'public.ensure_current_user_account()', 'EXECUTE') THEN
      RAISE EXCEPTION 'ensure_current_user_account remains executable by sandbox_exec';
    END IF;
  END IF;

  IF has_function_privilege('anon', 'public.ensure_current_user_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_current_user_account remains executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.ensure_current_user_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_current_user_account lost authenticated EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ensure_current_user_account()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_current_user_account lost service_role EXECUTE';
  END IF;

  SELECT pg_get_functiondef(p.oid)
    INTO v_wrapper_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'ensure_current_user_account';
  IF v_wrapper_def IS NULL OR position('auth.uid()' IN v_wrapper_def) = 0 THEN
    RAISE EXCEPTION 'ensure_current_user_account no longer references auth.uid()';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'projects' AND policyname = 'projects_owner_all'
  ) THEN
    RAISE EXCEPTION 'legacy policy projects_owner_all remains on public.projects';
  END IF;
END;
$$;

-- Structural assertion: a no-company identity cannot create an
-- org-null project through the ensure-organization trigger path.
-- Best-effort probe; skipped when the migrating role lacks auth.users
-- insert privilege.
DO $$
DECLARE
  v_probe_user uuid := gen_random_uuid();
  v_project_id uuid := gen_random_uuid();
  v_email text := 'containment-probe+' || v_probe_user::text || '@overwatch.internal';
  v_created boolean := false;
  v_raised boolean := false;
BEGIN
  BEGIN
    INSERT INTO auth.users (id, email, created_at, updated_at, aud, role)
    VALUES (v_probe_user, v_email, now(), now(), 'authenticated', 'authenticated');
  EXCEPTION WHEN others THEN
    RETURN;
  END;

  INSERT INTO public.profiles (id, email, default_organization_id)
  VALUES (v_probe_user, v_email, NULL)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, status, capabilities, invited_email
  )
  SELECT gen_random_uuid(), v_probe_user, 'member'::public.account_role,
         'disabled'::public.member_status,
         public.role_preset_capabilities('member'::public.account_role), v_email;

  BEGIN
    INSERT INTO public.projects (id, owner_id, name)
    VALUES (v_project_id, v_probe_user, 'containment-probe');
    v_created := true;
  EXCEPTION WHEN others THEN
    v_raised := true;
  END;

  DELETE FROM public.projects WHERE id = v_project_id;
  DELETE FROM public.organization_memberships WHERE user_id = v_probe_user;
  DELETE FROM public.profiles WHERE id = v_probe_user;
  DELETE FROM auth.users WHERE id = v_probe_user;

  IF v_created AND NOT v_raised THEN
    RAISE EXCEPTION
      'containment probe: no-company identity persisted an org-null project';
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';
