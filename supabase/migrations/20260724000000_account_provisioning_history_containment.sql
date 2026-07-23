-- =====================================================================
-- P0 SIGN-IN CONTAINMENT — tracked forward migration (UNAPPLIED).
--
-- Do not execute against the live DB outside the maintenance window
-- checklist in docs/RELEASE_GATE.md (§6 Sign-In P0).
--
-- Scope (atomic contract, all-or-nothing at apply time):
--
--   * Harden ensure_user_account():
--       - History guard inspects alternate auth.users UUIDs by
--         normalized email (not just profiles), so a disabled alias
--         with no profiles row cannot look like zero-history and
--         self-bootstrap an internal Owner company.
--       - Uses project_client_access.email (real column).
--       - Uses SELECT ... FOR UPDATE on the pending invite row plus
--         a per-email advisory transaction lock so same-email aliases
--         serialize and a concurrent revoke/expiry cannot be
--         overwritten.
--       - The unusable transaction-local preferred_invite_id GUC
--         mechanism is REMOVED. Multi-invite landing default is now
--         handled by finalize_invite_acceptance() called from the
--         auth callback with the exact clicked invite id.
--
--   * Drop demo/seed trigger on_auth_user_created (idempotent).
--
--   * Drop auto-accept-oldest trigger on_auth_user_account_created.
--     This trigger PERFORMed ensure_user_account(NEW.id, ...) on
--     every fresh auth.users row and would accept the oldest pending
--     invite before the callback finalized the exact invite the user
--     clicked. The client-clicked invite must win; the callback owns
--     finalization.
--
--   * Drop legacy projects_owner_all RLS + tighten
--     tg_projects_ensure_organization to RAISE when
--     ensure_user_account() returns NULL (no org-null project rows).
--
--   * Add finalize_invite_acceptance(p_invite_id uuid) — the exact
--     invite finalization RPC. auth.uid()-bound, email-matching,
--     status/expiry-validated under FOR UPDATE, idempotent for the
--     same accepted_by user, revoked from anon/PUBLIC/sandbox_exec,
--     granted to authenticated + service_role only.
--
--   * Complete PUBLIC / anon / authenticated / service_role /
--     sandbox_exec privilege assertions for every SECURITY DEFINER
--     function; every function pins search_path.
--
-- Explicit non-goals: no data delete, no cross-user default rewrite
-- outside invite finalization, no commercial-entitlement touch, no
-- structural live probe (deterministic behavioral coverage lives in
-- scripts/, not in a probe that runs as migration owner).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.ensure_user_account(
  p_user_id uuid,
  p_email text,
  p_full_name text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
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
  IF v_email_key <> '' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(v_email_key, 1));
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (p_user_id, coalesce(p_email, ''), coalesce(p_full_name, ''))
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name, ''), EXCLUDED.full_name),
    updated_at = now();

  -- Pending-invite-first acceptance under FOR UPDATE so a concurrent
  -- revoke/expiry cannot be overwritten. Recheck under the lock.
  FOR v_invite IN
    SELECT i.*
    FROM public.organization_invites i
    WHERE public.overwatch_access_email_key(i.email) = v_email_key
      AND i.status = 'pending'
      AND i.expires_at > now()
    ORDER BY i.created_at ASC, i.id ASC
    FOR UPDATE OF i
  LOOP
    IF v_invite.status <> 'pending' OR v_invite.expires_at <= now() THEN
      CONTINUE;
    END IF;

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
    WHERE id = v_invite.id
      AND status = 'pending'
      AND expires_at > now();

    v_invited_org_id := COALESCE(v_invited_org_id, v_invite.organization_id);
  END LOOP;

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

  -- History guard: alias UUIDs found via BOTH profiles AND auth.users
  -- by normalized email.
  IF v_org_id IS NULL THEN
    WITH alias_users AS (
      SELECT id FROM public.profiles
       WHERE v_email_key <> ''
         AND public.overwatch_access_email_key(email) = v_email_key
      UNION
      SELECT id FROM auth.users
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
-- finalize_invite_acceptance — exact-invite RPC called from the
-- auth callback after verifyOtp/exchange succeeds.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_invite_acceptance(p_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_email_key text;
  v_invite record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'finalize_invite_acceptance requires an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_invite_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  v_email_key := public.overwatch_access_email_key(v_caller_email);
  IF v_email_key = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_email_key, 1));

  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_invite.status = 'accepted'
     AND v_invite.accepted_by = v_caller
     AND public.overwatch_access_email_key(v_invite.email) = v_email_key THEN
    RETURN v_invite.organization_id;
  END IF;

  IF public.overwatch_access_email_key(v_invite.email) <> v_email_key THEN
    RETURN NULL;
  END IF;
  IF v_invite.status <> 'pending' THEN
    RETURN NULL;
  END IF;
  IF v_invite.expires_at IS NULL OR v_invite.expires_at <= now() THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.organization_memberships (
    organization_id, user_id, role, status, capabilities, invited_by, invited_email
  )
  VALUES (
    v_invite.organization_id, v_caller, v_invite.role, 'active',
    COALESCE(
      NULLIF(v_invite.capabilities, '{}'::jsonb),
      public.role_preset_capabilities(v_invite.role)
    ),
    v_invite.invited_by, v_invite.email
  )
  ON CONFLICT (organization_id, user_id) DO UPDATE SET
    status = 'active',
    role = CASE
      WHEN public.organization_memberships.status = 'active'
        AND public.organization_memberships.role IN ('owner', 'admin')
        THEN public.organization_memberships.role
      ELSE EXCLUDED.role
    END,
    capabilities = CASE
      WHEN public.organization_memberships.status = 'active'
        AND public.organization_memberships.role IN ('owner', 'admin')
        THEN public.organization_memberships.capabilities
      ELSE EXCLUDED.capabilities
    END,
    invited_email = COALESCE(
      NULLIF(public.organization_memberships.invited_email, ''),
      EXCLUDED.invited_email
    ),
    updated_at = now();

  UPDATE public.organization_invites
  SET status = 'accepted',
      accepted_by = v_caller,
      accepted_at = now(),
      updated_at = now()
  WHERE id = v_invite.id
    AND status = 'pending'
    AND expires_at > now();

  UPDATE public.profiles
  SET default_organization_id = v_invite.organization_id,
      updated_at = now()
  WHERE id = v_caller;

  RETURN v_invite.organization_id;
END;
$fn$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_account_created ON auth.users;

DROP POLICY IF EXISTS projects_owner_all ON public.projects;

CREATE OR REPLACE FUNCTION public.tg_projects_ensure_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
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

REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_user_account(uuid, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM anon;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_current_user_account() TO service_role;

REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_invite_acceptance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_invite_acceptance(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid) FROM sandbox_exec';
  END IF;
END;
$$;

DO $$
DECLARE
  v_wrapper_def text;
BEGIN
  IF has_function_privilege('anon', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by a browser role: anon';
  END IF;
  IF has_function_privilege('authenticated', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account remains executable by a browser role: authenticated';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ensure_user_account lost service_role EXECUTE';
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

  IF has_function_privilege('anon', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_invite_acceptance remains executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_invite_acceptance lost authenticated EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_invite_acceptance lost service_role EXECUTE';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    IF has_function_privilege('sandbox_exec', 'public.ensure_user_account(uuid,text,text)', 'EXECUTE') THEN
      RAISE EXCEPTION 'ensure_user_account remains executable by sandbox_exec';
    END IF;
    IF has_function_privilege('sandbox_exec', 'public.ensure_current_user_account()', 'EXECUTE') THEN
      RAISE EXCEPTION 'ensure_current_user_account remains executable by sandbox_exec';
    END IF;
    IF has_function_privilege('sandbox_exec', 'public.finalize_invite_acceptance(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'finalize_invite_acceptance remains executable by sandbox_exec';
    END IF;
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

NOTIFY pgrst, 'reload schema';
