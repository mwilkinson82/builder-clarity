-- P0 organization-authority raw-mutation lockdown.
-- TRACKED FORWARD MIGRATION: intentionally unapplied. Apply only through the
-- Lovable Interconnector during the approved sign-in maintenance window.
--
-- RLS remains the first gate; invoker triggers are the final invariant against
-- self-promotion, Owner minting, forged acceptance, and over-delegation.

-- The only browser-callable membership authority mutation. Raw authenticated
-- INSERT/UPDATE/DELETE is revoked below; invite acceptance remains the only
-- ordinary-user membership INSERT path.
CREATE OR REPLACE FUNCTION public.update_organization_membership_authority(
  p_membership_id uuid,
  p_role public.account_role DEFAULT NULL,
  p_status public.member_status DEFAULT NULL,
  p_capabilities jsonb DEFAULT NULL
)
RETURNS public.organization_memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_is_super boolean;
  v_target public.organization_memberships%ROWTYPE;
  v_caller_seat public.organization_memberships%ROWTYPE;
  v_next_role public.account_role;
  v_next_status public.member_status;
  v_next_capabilities jsonb;
  v_result public.organization_memberships%ROWTYPE;
  v_rows integer;
  v_now timestamptz;
BEGIN
  IF v_caller IS NULL OR p_membership_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Authentication and a company membership are required.';
  END IF;
  IF p_role IS NULL AND p_status IS NULL AND p_capabilities IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Choose a company access change.';
  END IF;
  IF p_status = 'pending'::public.member_status THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Pending access is created only by an invitation.';
  END IF;

  SELECT * INTO v_target
  FROM public.organization_memberships AS target
  WHERE target.id = p_membership_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002',
      MESSAGE = 'Company membership was not found.';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_target.organization_id::text, 3)
  );
  SELECT * INTO v_target
  FROM public.organization_memberships AS target
  WHERE target.id = p_membership_id
  FOR UPDATE OF target;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Company membership changed before the update began.';
  END IF;
  IF v_target.status = 'pending'::public.member_status THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Pending company access requires exact invite acceptance.';
  END IF;

  v_is_super := public.is_super_admin();
  IF NOT v_is_super THEN
    SELECT * INTO v_caller_seat
    FROM public.organization_memberships AS caller_seat
    WHERE caller_seat.organization_id = v_target.organization_id
      AND caller_seat.user_id = v_caller
      AND caller_seat.status = 'active'
    FOR SHARE OF caller_seat;
    IF NOT FOUND
      OR NOT (
        v_caller_seat.capabilities
          @> '{"company.manage_team":true}'::jsonb
      ) THEN
      RAISE EXCEPTION USING ERRCODE = '42501',
        MESSAGE = 'Company membership mutation is not allowed.';
    END IF;
  END IF;

  IF v_target.user_id = v_caller THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Self-directed authority changes are not allowed.';
  END IF;
  IF v_target.role = 'owner'::public.account_role THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Existing Owner access requires a dedicated transfer workflow.';
  END IF;

  v_next_role := coalesce(p_role, v_target.role);
  v_next_status := coalesce(p_status, v_target.status);
  v_next_capabilities := CASE
    WHEN v_next_role = 'owner'::public.account_role
      THEN public.role_preset_capabilities('owner'::public.account_role)
    WHEN p_capabilities IS NOT NULL
      THEN p_capabilities
    WHEN p_role IS NOT NULL
      THEN public.role_preset_capabilities(p_role)
    ELSE v_target.capabilities
  END;

  IF pg_catalog.jsonb_typeof(v_next_capabilities) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_next_capabilities) AS requested(key, value)
      WHERE pg_catalog.jsonb_typeof(requested.value) <> 'boolean'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Capabilities must be a boolean object.';
  END IF;
  IF v_next_role = 'owner'::public.account_role
    AND v_next_status <> 'active'::public.member_status THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Owner access must remain active.';
  END IF;

  IF NOT v_is_super
    AND v_caller_seat.role <> 'owner'::public.account_role
    AND (
      v_next_role = 'owner'::public.account_role
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_each(v_target.capabilities) AS existing(key, value)
        WHERE existing.value = 'true'::jsonb
          AND v_caller_seat.capabilities -> existing.key
            IS DISTINCT FROM 'true'::jsonb
      )
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_each(v_next_capabilities) AS requested(key, value)
        WHERE requested.value = 'true'::jsonb
          AND v_caller_seat.capabilities -> requested.key
            IS DISTINCT FROM 'true'::jsonb
      )
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501',
      MESSAGE = 'Delegated authority exceeds the caller.';
  END IF;

  v_now := pg_catalog.clock_timestamp();
  UPDATE public.organization_memberships
  SET role = v_next_role,
      status = v_next_status,
      capabilities = v_next_capabilities,
      updated_at = v_now
  WHERE id = v_target.id
    AND organization_id = v_target.organization_id
    AND user_id = v_target.user_id
  RETURNING * INTO v_result;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = '40001',
      MESSAGE = 'Company membership changed before the update completed.';
  END IF;

  RETURN v_result;
END;
$fn$;

-- Invoker triggers keep defense in depth if table grants drift later. Invite
-- lifecycle writes remain trigger-guarded; membership authority writes are
-- RPC-only after the explicit revocation near the end of this migration.
CREATE OR REPLACE FUNCTION public.tg_guard_organization_membership_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_role public.account_role;
  v_caller_caps jsonb;
  v_requested_caps jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_user <> 'authenticated' OR v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Membership mutation is not allowed.';
  END IF;
  IF public.is_super_admin() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT member.role, member.capabilities
  INTO v_caller_role, v_caller_caps
  FROM public.organization_memberships AS member
  WHERE member.organization_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END
    AND member.user_id = v_caller
    AND member.status = 'active';

  IF NOT FOUND OR NOT (v_caller_caps @> '{"company.manage_team":true}'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Membership mutation is not allowed.';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.user_id IS DISTINCT FROM OLD.user_id
    OR NEW.invited_by IS DISTINCT FROM OLD.invited_by
    OR NEW.invited_email IS DISTINCT FROM OLD.invited_email
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Membership identity fields are immutable.';
  END IF;

  IF TG_OP <> 'INSERT' AND OLD.role = 'owner'::public.account_role
    AND (
      TG_OP = 'DELETE'
      OR NEW.role <> 'owner'::public.account_role
      OR NEW.status <> 'active'::public.member_status
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.organization_memberships AS other_owner
      WHERE other_owner.organization_id = OLD.organization_id
        AND other_owner.user_id <> OLD.user_id
        AND other_owner.role = 'owner'::public.account_role
        AND other_owner.status = 'active'
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'The last active Owner cannot be removed.';
  END IF;

  IF TG_OP = 'UPDATE'
    AND OLD.user_id = v_caller
    AND (
      NEW.role IS DISTINCT FROM OLD.role
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.capabilities IS DISTINCT FROM OLD.capabilities
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Self-directed authority changes are not allowed.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.user_id = v_caller OR (OLD.role = 'owner' AND v_caller_role <> 'owner') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Membership deletion is not allowed.';
    END IF;
    RETURN OLD;
  END IF;

  v_requested_caps := CASE
    WHEN NEW.capabilities IS NULL OR NEW.capabilities = '{}'::jsonb
      THEN public.role_preset_capabilities(NEW.role)
    ELSE NEW.capabilities
  END;
  IF pg_catalog.jsonb_typeof(v_requested_caps) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_requested_caps) AS requested(key, value)
      WHERE pg_catalog.jsonb_typeof(requested.value) <> 'boolean'
    )
    OR (NEW.role = 'owner'::public.account_role AND v_caller_role <> 'owner'::public.account_role)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_requested_caps) AS requested(key, value)
      WHERE requested.value = 'true'::jsonb
        AND v_caller_caps -> requested.key IS DISTINCT FROM 'true'::jsonb
    )
    OR (
      TG_OP = 'UPDATE'
      AND v_caller_role <> 'owner'::public.account_role
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_each(OLD.capabilities) AS existing(key, value)
        WHERE existing.value = 'true'::jsonb
          AND v_caller_caps -> existing.key IS DISTINCT FROM 'true'::jsonb
      )
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Delegated authority exceeds the caller.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zz_organization_memberships_authority_guard
  ON public.organization_memberships;
CREATE TRIGGER zz_organization_memberships_authority_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_organization_membership_authority();

CREATE OR REPLACE FUNCTION public.tg_guard_organization_invite_authority()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
DECLARE
  v_caller uuid := auth.uid();
  v_caller_role public.account_role;
  v_caller_caps jsonb;
  v_requested_caps jsonb;
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_user <> 'authenticated' OR v_caller IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite mutation is not allowed.';
  END IF;
  IF public.is_super_admin() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT member.role, member.capabilities
  INTO v_caller_role, v_caller_caps
  FROM public.organization_memberships AS member
  WHERE member.organization_id = CASE WHEN TG_OP = 'DELETE' THEN OLD.organization_id ELSE NEW.organization_id END
    AND member.user_id = v_caller
    AND member.status = 'active';
  IF NOT FOUND OR NOT (v_caller_caps @> '{"company.manage_team":true}'::jsonb) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite mutation is not allowed.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'pending'::public.invite_status THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Accepted invite history is immutable.';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.status <> 'pending'::public.invite_status
    OR NEW.invited_by IS DISTINCT FROM v_caller
    OR NEW.accepted_by IS NOT NULL
    OR NEW.accepted_at IS NOT NULL
    OR pg_catalog.btrim(NEW.email) = ''
    OR NEW.expires_at <= pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite binding is invalid.';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    OLD.status <> 'pending'::public.invite_status
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.email IS DISTINCT FROM OLD.email
    OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR NEW.status NOT IN ('pending'::public.invite_status, 'revoked'::public.invite_status)
    OR (
      NEW.status = 'pending'::public.invite_status
      AND (
        NEW.accepted_by IS NOT NULL
        OR NEW.accepted_at IS NOT NULL
        OR NEW.expires_at IS NULL
        OR NEW.expires_at <= pg_catalog.clock_timestamp()
      )
    )
    OR (
      NEW.invited_by IS DISTINCT FROM OLD.invited_by
      AND (
        NEW.status <> 'pending'::public.invite_status
        OR NEW.invited_by IS DISTINCT FROM v_caller
      )
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite authority fields are immutable.';
  END IF;

  v_requested_caps := CASE
    WHEN NEW.capabilities IS NULL OR NEW.capabilities = '{}'::jsonb
      THEN public.role_preset_capabilities(NEW.role)
    ELSE NEW.capabilities
  END;
  IF pg_catalog.jsonb_typeof(v_requested_caps) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_requested_caps) AS requested(key, value)
      WHERE pg_catalog.jsonb_typeof(requested.value) <> 'boolean'
    )
    OR (NEW.role = 'owner'::public.account_role AND v_caller_role <> 'owner'::public.account_role)
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(v_requested_caps) AS requested(key, value)
      WHERE requested.value = 'true'::jsonb
        AND v_caller_caps -> requested.key IS DISTINCT FROM 'true'::jsonb
    ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Invite authority exceeds the caller.';
  END IF;

  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS zz_organization_invites_authority_guard
  ON public.organization_invites;
CREATE TRIGGER zz_organization_invites_authority_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.organization_invites
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_organization_invite_authority();

-- Trigger functions are never direct RPC endpoints.
DROP POLICY IF EXISTS organization_memberships_manage_insert
  ON public.organization_memberships;
DROP POLICY IF EXISTS organization_memberships_manage_update
  ON public.organization_memberships;
DROP POLICY IF EXISTS organization_memberships_manage_delete
  ON public.organization_memberships;
REVOKE INSERT, UPDATE, DELETE ON public.organization_memberships
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.update_organization_membership_authority(
  uuid, public.account_role, public.member_status, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_organization_membership_authority(
  uuid, public.account_role, public.member_status, jsonb
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.tg_guard_organization_membership_authority()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_guard_organization_invite_authority()
  FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION '
      || 'public.update_organization_membership_authority('
      || 'uuid,public.account_role,public.member_status,jsonb'
      || ') FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION '
      || 'public.tg_guard_organization_membership_authority() '
      || 'FROM sandbox_exec';
    EXECUTE 'REVOKE ALL ON FUNCTION '
      || 'public.tg_guard_organization_invite_authority() '
      || 'FROM sandbox_exec';
  END IF;

  IF pg_catalog.has_table_privilege(
    'authenticated', 'public.organization_memberships', 'INSERT'
  ) OR pg_catalog.has_table_privilege(
    'authenticated', 'public.organization_memberships', 'UPDATE'
  ) OR pg_catalog.has_table_privilege(
    'authenticated', 'public.organization_memberships', 'DELETE'
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.update_organization_membership_authority(uuid,public.account_role,public.member_status,jsonb)',
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'authenticated',
    'public.update_organization_membership_authority(uuid,public.account_role,public.member_status,jsonb)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Organization membership mutation privilege containment failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_memberships'::regclass
      AND tgname = 'zz_organization_memberships_authority_guard'
      AND NOT tgisinternal
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.organization_invites'::regclass
      AND tgname = 'zz_organization_invites_authority_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Organization authority mutation guards are missing';
  END IF;
END;
$verify$;

NOTIFY pgrst, 'reload schema';