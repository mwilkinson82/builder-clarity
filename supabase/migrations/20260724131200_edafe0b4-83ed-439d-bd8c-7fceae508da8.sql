-- P0 client-portal exact-binding lockdown.
-- TRACKED FORWARD MIGRATION: intentionally unapplied. Apply only through the
-- Lovable Interconnector during the approved sign-in maintenance window.
--
-- Portal authority requires an ACTIVE row bound to the exact authenticated
-- user. Pending rows and JWT/email matching never grant project access.

-- Preserve already-working, bound client access without trusting email as an
-- identity claim. A legacy active row with one bound Auth user and no
-- accepted_by value can be repaired deterministically. Any unbound or
-- conflicting active row aborts the cutover so it can be explicitly reissued
-- through the exact client-access acceptance workflow instead of silently
-- locking out a user or assigning authority by email.
DO $preflight$
DECLARE
  v_unbound_count bigint;
  v_conflict_count bigint;
BEGIN
  SELECT pg_catalog.count(*) INTO v_conflict_count
  FROM public.project_client_access AS access_row
  WHERE access_row.status = 'active'
    AND access_row.client_user_id IS NOT NULL
    AND access_row.accepted_by IS NOT NULL
    AND access_row.accepted_by <> access_row.client_user_id;

  IF v_conflict_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        'Client-access cutover blocked: %s active rows have conflicting Auth bindings.',
        v_conflict_count
      );
  END IF;

  SELECT pg_catalog.count(*) INTO v_unbound_count
  FROM public.project_client_access AS access_row
  WHERE access_row.status = 'active'
    AND access_row.client_user_id IS NULL;

  IF v_unbound_count > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '23514',
      MESSAGE = pg_catalog.format(
        'Client-access cutover blocked: %s active rows are not bound to an Auth user.',
        v_unbound_count
      );
  END IF;

  UPDATE public.project_client_access AS access_row
  SET accepted_by = access_row.client_user_id,
      accepted_at = coalesce(
        access_row.accepted_at,
        pg_catalog.clock_timestamp()
      ),
      updated_at = pg_catalog.clock_timestamp()
  WHERE access_row.status = 'active'
    AND access_row.client_user_id IS NOT NULL
    AND access_row.accepted_by IS NULL;

  IF EXISTS (
    SELECT 1
    FROM public.project_client_access AS access_row
    WHERE access_row.status = 'active'
      AND (
        access_row.client_user_id IS NULL
        OR access_row.accepted_by IS DISTINCT FROM access_row.client_user_id
      )
  ) THEN
    RAISE EXCEPTION 'Client-access active binding repair did not converge';
  END IF;
END;
$preflight$;

-- Portal authority is ACTIVE + exact bound user only. JWT email and pending
-- rows are intentionally excluded.
CREATE OR REPLACE FUNCTION public.can_read_client_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_client_access AS access_row
      WHERE access_row.project_id = p_project_id
        AND access_row.status = 'active'
        AND access_row.client_user_id = auth.uid()
        AND access_row.accepted_by = auth.uid()
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_client_change_orders(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_read_client_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.project_client_access AS access_row
      WHERE access_row.project_id = p_project_id
        AND access_row.status = 'active'
        AND access_row.client_user_id = auth.uid()
        AND access_row.accepted_by = auth.uid()
        AND access_row.can_view_change_orders
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_client_daily_reports(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_read_client_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.project_client_access AS access_row
      WHERE access_row.project_id = p_project_id
        AND access_row.status = 'active'
        AND access_row.client_user_id = auth.uid()
        AND access_row.accepted_by = auth.uid()
        AND access_row.can_view_daily_reports
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_client_billing(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_read_client_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.project_client_access AS access_row
      WHERE access_row.project_id = p_project_id
        AND access_row.status = 'active'
        AND access_row.client_user_id = auth.uid()
        AND access_row.accepted_by = auth.uid()
        AND access_row.can_view_billing
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_client_selections(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.can_read_client_project(p_project_id)
    AND EXISTS (
      SELECT 1 FROM public.project_client_access AS access_row
      WHERE access_row.project_id = p_project_id
        AND access_row.status = 'active'
        AND access_row.client_user_id = auth.uid()
        AND access_row.accepted_by = auth.uid()
        AND access_row.can_view_selections
    );
$fn$;

CREATE OR REPLACE FUNCTION public.can_view_client_selection(p_selection_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_selections AS selection_row
    WHERE selection_row.id = p_selection_id
      AND selection_row.client_visible
      AND public.can_view_client_selections(selection_row.project_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.can_approve_client_change_order(p_change_order_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.change_orders AS change_order
    WHERE change_order.id = p_change_order_id
      AND change_order.client_visible
      AND public.can_view_client_change_orders(change_order.project_id)
  );
$fn$;

CREATE OR REPLACE FUNCTION public.record_client_change_order_decision(
  p_change_order_id uuid,
  p_decision public.client_approval_decision,
  p_notes text DEFAULT '',
  p_user_agent text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_project_id uuid;
  v_contact_id uuid;
  v_approval_id uuid;
  v_client_status public.client_change_order_status;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required.';
  END IF;
  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;

  SELECT change_order.project_id INTO v_project_id
  FROM public.change_orders AS change_order
  WHERE change_order.id = p_change_order_id
    AND change_order.client_visible
  FOR SHARE OF change_order;
  IF v_project_id IS NULL OR NOT public.can_approve_client_change_order(p_change_order_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Change order is unavailable.';
  END IF;

  SELECT access_row.contact_id INTO v_contact_id
  FROM public.project_client_access AS access_row
  WHERE access_row.project_id = v_project_id
    AND access_row.status = 'active'
    AND access_row.client_user_id = v_user_id
    AND access_row.accepted_by = v_user_id
    AND access_row.can_view_change_orders
  ORDER BY access_row.created_at, access_row.id
  LIMIT 1
  FOR SHARE OF access_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Change order is unavailable.';
  END IF;

  v_client_status := CASE
    WHEN p_decision = 'approved' THEN 'approved'::public.client_change_order_status
    WHEN p_decision = 'rejected' THEN 'rejected'::public.client_change_order_status
    ELSE 'sent'::public.client_change_order_status
  END;

  INSERT INTO public.change_order_approvals (
    project_id, change_order_id, contact_id, client_user_id, client_email,
    decision, notes, user_agent
  )
  VALUES (
    v_project_id, p_change_order_id, v_contact_id, v_user_id,
    coalesce(v_email, ''), p_decision,
    coalesce(p_notes, ''), coalesce(p_user_agent, '')
  )
  RETURNING id INTO v_approval_id;

  UPDATE public.change_orders
  SET client_status = v_client_status,
      client_notes = coalesce(p_notes, ''),
      client_decided_at = CASE
        WHEN p_decision IN ('approved', 'rejected') THEN v_now
        ELSE client_decided_at
      END,
      updated_at = v_now
  WHERE id = p_change_order_id;

  RETURN v_approval_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.record_client_selection_decision(
  p_selection_id uuid,
  p_option_id uuid,
  p_decision text,
  p_notes text DEFAULT '',
  p_user_agent text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_selection public.project_selections%ROWTYPE;
  v_option public.project_selection_options%ROWTYPE;
  v_contact_id uuid;
  v_decision_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authentication is required.';
  END IF;
  IF p_decision NOT IN ('approved', 'revision_requested') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selection decision is invalid.';
  END IF;
  SELECT u.email INTO v_email FROM auth.users AS u WHERE u.id = v_user_id;

  SELECT * INTO v_selection
  FROM public.project_selections AS selection_row
  WHERE selection_row.id = p_selection_id
    AND selection_row.client_visible
  FOR SHARE OF selection_row;
  IF NOT FOUND OR NOT public.can_view_client_selections(v_selection.project_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Selection is unavailable.';
  END IF;

  IF p_decision = 'approved' THEN
    SELECT * INTO v_option
    FROM public.project_selection_options AS option_row
    WHERE option_row.id = p_option_id
      AND option_row.selection_id = p_selection_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Selection option is invalid.';
    END IF;
  END IF;

  SELECT access_row.contact_id INTO v_contact_id
  FROM public.project_client_access AS access_row
  WHERE access_row.project_id = v_selection.project_id
    AND access_row.status = 'active'
    AND access_row.client_user_id = v_user_id
    AND access_row.accepted_by = v_user_id
    AND access_row.can_view_selections
  ORDER BY access_row.created_at, access_row.id
  LIMIT 1
  FOR SHARE OF access_row;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Selection is unavailable.';
  END IF;

  INSERT INTO public.project_selection_decisions (
    project_id, selection_id, option_id, contact_id, client_user_id,
    client_email, decision, notes, selection_version, selection_snapshot,
    option_snapshot, user_agent
  )
  VALUES (
    v_selection.project_id, v_selection.id,
    CASE WHEN p_decision = 'approved' THEN v_option.id ELSE NULL END,
    v_contact_id, v_user_id, coalesce(v_email, ''), p_decision,
    pg_catalog.left(coalesce(p_notes, ''), 4000),
    v_selection.version, pg_catalog.to_jsonb(v_selection),
    CASE WHEN p_decision = 'approved' THEN pg_catalog.to_jsonb(v_option) ELSE NULL END,
    pg_catalog.left(coalesce(p_user_agent, ''), 1000)
  )
  RETURNING id INTO v_decision_id;

  UPDATE public.project_selections
  SET decision_status = p_decision,
      selected_option_id = CASE
        WHEN p_decision = 'approved' THEN v_option.id
        ELSE NULL
      END,
      client_decided_at = v_now,
      approved_at = CASE WHEN p_decision = 'approved' THEN v_now ELSE NULL END,
      updated_by = v_user_id,
      updated_at = v_now
  WHERE id = v_selection.id;

  RETURN v_decision_id;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.tg_guard_project_client_access_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $fn$
BEGIN
  IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF current_user <> 'authenticated' OR auth.uid() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Client access mutation is not allowed.';
  END IF;

  IF TG_OP = 'INSERT' AND (
    NEW.status <> 'pending'::public.client_access_status
    OR NEW.client_user_id IS NOT NULL
    OR NEW.accepted_by IS NOT NULL
    OR NEW.accepted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Client access must begin pending and unbound.';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW.project_id IS DISTINCT FROM OLD.project_id
    OR NEW.client_user_id IS DISTINCT FROM OLD.client_user_id
    OR NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
    OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
    OR OLD.status = 'revoked'::public.client_access_status
    OR NEW.status NOT IN (OLD.status, 'revoked'::public.client_access_status)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Client identity binding requires exact acceptance.';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$fn$;

DROP TRIGGER IF EXISTS zz_project_client_access_binding_guard
  ON public.project_client_access;
CREATE TRIGGER zz_project_client_access_binding_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_client_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_project_client_access_binding();

-- Exact active client row for portal reads; manager writes still require the
-- dedicated client_portal.manage capability and the binding trigger above.
DROP POLICY IF EXISTS project_client_access_internal_or_client_read
  ON public.project_client_access;
CREATE POLICY project_client_access_internal_or_client_read
  ON public.project_client_access
  FOR SELECT TO authenticated
  USING (
    public.can_read_project(project_id)
    OR (
      status = 'active'
      AND client_user_id = auth.uid()
      AND accepted_by = auth.uid()
    )
  );

-- SECURITY DEFINER helpers are explicit authenticated endpoints.
DO $verify$
DECLARE
  v_function regprocedure;
  v_name text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.can_read_client_project(uuid)'::regprocedure,
    'public.can_view_client_change_orders(uuid)'::regprocedure,
    'public.can_view_client_daily_reports(uuid)'::regprocedure,
    'public.can_view_client_billing(uuid)'::regprocedure,
    'public.can_view_client_selections(uuid)'::regprocedure,
    'public.can_view_client_selection(uuid)'::regprocedure,
    'public.can_approve_client_change_order(uuid)'::regprocedure,
    'public.record_client_change_order_decision(uuid,public.client_approval_decision,text,text)'::regprocedure,
    'public.record_client_selection_decision(uuid,uuid,text,text,text)'::regprocedure
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

  EXECUTE 'REVOKE ALL ON FUNCTION public.tg_guard_project_client_access_binding() '
    || 'FROM PUBLIC, anon, authenticated';

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec') THEN
    FOR v_name IN
      SELECT p.oid::regprocedure::text
      FROM pg_catalog.pg_proc AS p
      WHERE p.oid = ANY (ARRAY[
        'public.can_read_client_project(uuid)'::regprocedure,
        'public.can_view_client_change_orders(uuid)'::regprocedure,
        'public.can_view_client_daily_reports(uuid)'::regprocedure,
        'public.can_view_client_billing(uuid)'::regprocedure,
        'public.can_view_client_selections(uuid)'::regprocedure,
        'public.can_view_client_selection(uuid)'::regprocedure,
        'public.can_approve_client_change_order(uuid)'::regprocedure,
        'public.record_client_change_order_decision(uuid,public.client_approval_decision,text,text)'::regprocedure,
        'public.record_client_selection_decision(uuid,uuid,text,text,text)'::regprocedure
      ])
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON FUNCTION %s FROM sandbox_exec',
        v_name
      );
    END LOOP;
  END IF;

  IF pg_catalog.has_function_privilege(
    'anon', 'public.can_read_client_project(uuid)', 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'Anonymous client helper execution remains enabled';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sandbox_exec')
    AND pg_catalog.has_function_privilege(
      'sandbox_exec', 'public.can_read_client_project(uuid)', 'EXECUTE'
    ) THEN
    RAISE EXCEPTION 'Sandbox client helper execution remains enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.project_client_access'::regclass
      AND tgname = 'zz_project_client_access_binding_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Client access binding guard is missing';
  END IF;
END;
$verify$;