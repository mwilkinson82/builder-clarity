-- =====================================================================
-- P0 SIGN-IN CONTAINMENT — tracked forward migration (UNAPPLIED).
--
-- Do not execute against the live DB outside the maintenance window
-- checklist in docs/RELEASE_GATE.md (§6 Sign-In P0).
--
-- Scope (atomic contract, all-or-nothing at apply time):
--
--   * Harden ensure_user_account():
--       - REMOVES the same-email invite auto-accept loop entirely.
--         Normal sign-in / repeat login must NOT consume every same-
--         email pending invite (nor any). The ONLY invite acceptance
--         boundary is finalize_invite_acceptance(), called from the
--         auth callback with the EXACT invite id the user clicked.
--       - REMOVES the alias-clone block that copied membership /
--         role / capabilities from any other UUID that shares a
--         mutable profile email. Email overlap MUST NOT transfer
--         authority.
--       - History guard now counts ALL organization_invites rows by
--         normalized email regardless of status (pending, accepted,
--         revoked, expired) as prior identity history so a same-email
--         alias cannot fall through to Owner bootstrap.
--       - History guard inspects alias UUIDs by BOTH public.profiles
--         AND auth.users normalized email.
--       - Bootstrap path (org creation) still serialized under a
--         per-email advisory transaction lock.
--
--   * Drop demo/seed trigger on_auth_user_created (idempotent).
--
--   * Drop auto-accept-oldest trigger on_auth_user_account_created.
--     The client-clicked invite must win; the callback owns
--     finalization exclusively.
--
--   * Drop legacy projects_owner_all RLS + tighten
--     tg_projects_ensure_organization to RAISE when
--     ensure_user_account() returns NULL (no org-null project rows).
--
--   * Add finalize_invite_acceptance(p_invite_id uuid) — the exact
--     invite finalization RPC. auth.uid()-bound, email-matching,
--     status/expiry-validated under FOR UPDATE, uses
--     clock_timestamp() for the expiry check AFTER the FOR UPDATE
--     wait so a row that expires while we blocked is rejected, and
--     verifies exactly one row transitioned pending -> accepted via
--     GET DIAGNOSTICS. Idempotent for the same accepted_by user,
--     revoked from anon / PUBLIC / sandbox_exec, granted to
--     authenticated + service_role only.
--
--   * Add finalize_client_access(p_access_id uuid) — the exact
--     project_client_access finalizer with the same guarantees:
--     auth.uid()-bound, exact-email match, status in {pending,active},
--     unexpired, non-revoked; binds client_user_id + accepted_by to
--     auth.uid() and returns project_id. Every other status returns
--     NULL (fail closed).
--
--   * Complete PUBLIC / anon / authenticated / service_role /
--     sandbox_exec privilege assertions for every SECURITY DEFINER
--     function; every function pins search_path.
--
-- Explicit non-goals in THIS migration: no data delete, no cross-user
-- default rewrite outside exact-invite/exact-client finalization, no
-- commercial-entitlement touch, no structural live probe, and no full
-- audit of `projects.owner_id = auth.uid()` RLS bypasses across the
-- ~10 project-scoped tables — that swap is scoped as a separate
-- follow-up migration (`user_has_active_project_access` helper plus
-- per-policy DROP+CREATE) and MUST land before this migration is
-- applied to production.
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

  -- No same-email invite auto-accept here. Every invite MUST go
  -- through finalize_invite_acceptance() with the exact invite id
  -- the caller clicked. See docs/RELEASE_GATE.md §6.

  -- Resolve default org from the caller's OWN active memberships only.
  -- Never from same-email aliases — that would clone authority across
  -- UUIDs based purely on a mutable profile email.
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

  -- History guard: alias UUIDs found via BOTH profiles AND auth.users
  -- by normalized email. Any organization_invites row by email —
  -- pending / accepted / revoked / expired — counts as prior identity
  -- history and blocks Owner bootstrap.
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
           OR (
             v_email_key <> ''
             AND public.overwatch_access_email_key(i.email) = v_email_key
           )
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
      -- Do not bootstrap. Clear the caller's stale default if it
      -- points at a membership they no longer hold, and return NULL
      -- so the layout renders "No active company access" instead of
      -- silently minting an Owner org.
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
  SET default_organization_id = v_org_id,
      updated_at = now()
  WHERE id = p_user_id
    AND (default_organization_id IS NULL OR default_organization_id <> v_org_id);

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
  v_now timestamptz;
  v_updated int;
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

  -- Serialize same-email races so a concurrent revoke/expiry cannot
  -- be overwritten and two callers can't both accept the same row.
  PERFORM pg_advisory_xact_lock(hashtextextended(v_email_key, 1));

  SELECT * INTO v_invite
  FROM public.organization_invites
  WHERE id = p_invite_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Same-user replay: already-accepted for THIS caller is idempotent
  -- and does NOT reactivate a later-disabled membership.
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

  -- Expiry check uses clock_timestamp() AFTER the FOR UPDATE wait so
  -- a row that expires while we blocked on the lock is rejected.
  -- now() returns the transaction start time, which would falsely
  -- accept a just-expired invite.
  v_now := clock_timestamp();
  IF v_invite.expires_at IS NULL OR v_invite.expires_at <= v_now THEN
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
    -- Same-user replay MUST NOT reactivate a later-disabled seat:
    -- if the current row is not active, we leave it as-is.
    status = CASE
      WHEN public.organization_memberships.status = 'active'
        THEN public.organization_memberships.status
      ELSE public.organization_memberships.status
    END,
    role = CASE
      WHEN public.organization_memberships.status = 'active'
        AND public.organization_memberships.role IN ('owner', 'admin')
        THEN public.organization_memberships.role
      WHEN public.organization_memberships.status = 'active'
        THEN EXCLUDED.role
      ELSE public.organization_memberships.role
    END,
    capabilities = CASE
      WHEN public.organization_memberships.status = 'active'
        AND public.organization_memberships.role IN ('owner', 'admin')
        THEN public.organization_memberships.capabilities
      WHEN public.organization_memberships.status = 'active'
        THEN EXCLUDED.capabilities
      ELSE public.organization_memberships.capabilities
    END,
    invited_email = COALESCE(
      NULLIF(public.organization_memberships.invited_email, ''),
      EXCLUDED.invited_email
    ),
    updated_at = now();

  UPDATE public.organization_invites
  SET status = 'accepted',
      accepted_by = v_caller,
      accepted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_invite.id
    AND status = 'pending'
    AND expires_at > clock_timestamp();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    -- The row we hold under FOR UPDATE is no longer pending / not
    -- expired at commit time. Fail closed — zero writes must remain.
    RAISE EXCEPTION 'finalize_invite_acceptance: expected exactly 1 invite update, got %', v_updated
      USING ERRCODE = 'serialization_failure';
  END IF;

  -- Only set default org if the seat we just landed is truly active.
  -- A same-user replay against a disabled seat returned early above;
  -- the fresh accept path guarantees status='active' via INSERT.
  UPDATE public.profiles
  SET default_organization_id = v_invite.organization_id,
      updated_at = now()
  WHERE id = v_caller
    AND EXISTS (
      SELECT 1 FROM public.organization_memberships m
      WHERE m.user_id = v_caller
        AND m.organization_id = v_invite.organization_id
        AND m.status = 'active'
    );

  RETURN v_invite.organization_id;
END;
$fn$;

-- =====================================================================
-- finalize_client_access — exact project_client_access finalizer.
-- Called from the auth callback with the exact clicked access id.
-- Binds the row to auth.uid() and returns project_id on success.
-- Every reject path returns NULL and performs zero writes.
-- =====================================================================
CREATE OR REPLACE FUNCTION public.finalize_client_access(p_access_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_email text;
  v_email_key text;
  v_row record;
  v_now timestamptz;
  v_updated int;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'finalize_client_access requires an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_access_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT email INTO v_caller_email FROM auth.users WHERE id = v_caller;
  v_email_key := public.overwatch_access_email_key(v_caller_email);
  IF v_email_key = '' THEN
    RETURN NULL;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_email_key, 2));

  SELECT * INTO v_row
  FROM public.project_client_access
  WHERE id = p_access_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Idempotent replay for the SAME caller on an already-active row.
  IF v_row.status = 'active'
     AND v_row.client_user_id = v_caller
     AND public.overwatch_access_email_key(v_row.email) = v_email_key THEN
    RETURN v_row.project_id;
  END IF;

  IF public.overwatch_access_email_key(v_row.email) <> v_email_key THEN
    RETURN NULL;
  END IF;

  -- Fail closed on revoked / expired / non-pending-or-active state.
  IF v_row.status NOT IN ('pending', 'active') THEN
    RETURN NULL;
  END IF;

  v_now := clock_timestamp();
  IF v_row.expires_at IS NOT NULL AND v_row.expires_at <= v_now THEN
    RETURN NULL;
  END IF;

  -- A different UUID already claimed this exact access row (rare
  -- race). Fail closed — do NOT rebind ownership silently.
  IF v_row.client_user_id IS NOT NULL AND v_row.client_user_id <> v_caller THEN
    RETURN NULL;
  END IF;

  UPDATE public.project_client_access
  SET status = 'active',
      client_user_id = v_caller,
      accepted_by = v_caller,
      accepted_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE id = v_row.id
    AND status IN ('pending', 'active')
    AND (client_user_id IS NULL OR client_user_id = v_caller);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'finalize_client_access: expected exactly 1 access update, got %', v_updated
      USING ERRCODE = 'serialization_failure';
  END IF;

  RETURN v_row.project_id;
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

REVOKE ALL ON FUNCTION public.finalize_client_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finalize_client_access(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.finalize_client_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_client_access(uuid) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_user_account(uuid, text, text) FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.ensure_current_user_account() FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.finalize_invite_acceptance(uuid) FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION public.finalize_client_access(uuid) FROM sandbox_exec';
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

  IF has_function_privilege('anon', 'public.finalize_client_access(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_client_access remains executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.finalize_client_access(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_client_access lost authenticated EXECUTE';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.finalize_client_access(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'finalize_client_access lost service_role EXECUTE';
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
    IF has_function_privilege('sandbox_exec', 'public.finalize_client_access(uuid)', 'EXECUTE') THEN
      RAISE EXCEPTION 'finalize_client_access remains executable by sandbox_exec';
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
