DO $$ BEGIN
  CREATE TYPE public.client_access_status AS ENUM ('pending', 'active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.client_change_order_status AS ENUM ('not_sent', 'sent', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.client_approval_decision AS ENUM ('approved', 'rejected', 'comment');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.change_orders
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS client_status public.client_change_order_status NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS client_notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS client_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_decided_at timestamptz;

CREATE TABLE IF NOT EXISTS public.client_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT '',
  email text NOT NULL,
  company text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS client_contacts_org_email_active_idx
  ON public.client_contacts(organization_id, lower(email))
  WHERE status <> 'inactive';

CREATE INDEX IF NOT EXISTS client_contacts_org_idx
  ON public.client_contacts(organization_id);

CREATE TABLE IF NOT EXISTS public.project_client_access (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.client_contacts(id) ON DELETE SET NULL,
  email text NOT NULL,
  client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  role text NOT NULL DEFAULT 'client',
  status public.client_access_status NOT NULL DEFAULT 'pending',
  can_view_change_orders boolean NOT NULL DEFAULT true,
  can_view_daily_reports boolean NOT NULL DEFAULT false,
  can_view_billing boolean NOT NULL DEFAULT false,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_client_access_project_email_active_idx
  ON public.project_client_access(project_id, lower(email))
  WHERE status <> 'revoked';

CREATE INDEX IF NOT EXISTS project_client_access_project_idx
  ON public.project_client_access(project_id);

CREATE INDEX IF NOT EXISTS project_client_access_contact_idx
  ON public.project_client_access(contact_id);

CREATE TABLE IF NOT EXISTS public.change_order_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_order_id uuid NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.client_contacts(id) ON DELETE SET NULL,
  client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_email text NOT NULL DEFAULT '',
  decision public.client_approval_decision NOT NULL,
  notes text NOT NULL DEFAULT '',
  document_version text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS change_order_approvals_project_idx
  ON public.change_order_approvals(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS change_order_approvals_change_order_idx
  ON public.change_order_approvals(change_order_id, created_at DESC);

DROP TRIGGER IF EXISTS client_contacts_set_updated_at ON public.client_contacts;
CREATE TRIGGER client_contacts_set_updated_at
  BEFORE UPDATE ON public.client_contacts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS project_client_access_set_updated_at ON public.project_client_access;
CREATE TRIGGER project_client_access_set_updated_at
  BEFORE UPDATE ON public.project_client_access
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.can_read_client_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_client_access a
      WHERE a.project_id = p_project_id
        AND a.status IN ('pending', 'active')
        AND (
          a.client_user_id = auth.uid()
          OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_approve_client_change_order(p_change_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.change_orders co
      WHERE co.id = p_change_order_id
        AND co.client_visible = true
        AND public.can_read_client_project(co.project_id)
    );
$$;

CREATE OR REPLACE FUNCTION public.record_client_change_order_decision(
  p_change_order_id uuid,
  p_decision public.client_approval_decision,
  p_notes text DEFAULT '',
  p_user_agent text DEFAULT ''
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_email text;
  v_project_id uuid;
  v_contact_id uuid;
  v_access_id uuid;
  v_approval_id uuid;
  v_client_status public.client_change_order_status;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := coalesce(auth.jwt() ->> 'email', '');

  SELECT co.project_id
  INTO v_project_id
  FROM public.change_orders co
  WHERE co.id = p_change_order_id
    AND co.client_visible = true;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Change order is not available for client approval.';
  END IF;

  SELECT a.id, a.contact_id
  INTO v_access_id, v_contact_id
  FROM public.project_client_access a
  WHERE a.project_id = v_project_id
    AND a.status IN ('pending', 'active')
    AND (
      a.client_user_id = v_user_id
      OR lower(a.email) = lower(coalesce(v_email, ''))
    )
  ORDER BY a.created_at ASC
  LIMIT 1;

  IF v_access_id IS NULL THEN
    RAISE EXCEPTION 'You do not have client access to this project.';
  END IF;

  UPDATE public.project_client_access
  SET
    status = 'active',
    client_user_id = coalesce(client_user_id, v_user_id),
    accepted_by = coalesce(accepted_by, v_user_id),
    accepted_at = coalesce(accepted_at, now()),
    updated_at = now()
  WHERE id = v_access_id;

  v_client_status := CASE
    WHEN p_decision = 'approved' THEN 'approved'::public.client_change_order_status
    WHEN p_decision = 'rejected' THEN 'rejected'::public.client_change_order_status
    ELSE 'sent'::public.client_change_order_status
  END;

  INSERT INTO public.change_order_approvals (
    project_id,
    change_order_id,
    contact_id,
    client_user_id,
    client_email,
    decision,
    notes,
    user_agent
  )
  VALUES (
    v_project_id,
    p_change_order_id,
    v_contact_id,
    v_user_id,
    coalesce(v_email, ''),
    p_decision,
    coalesce(p_notes, ''),
    coalesce(p_user_agent, '')
  )
  RETURNING id INTO v_approval_id;

  UPDATE public.change_orders
  SET
    client_status = v_client_status,
    client_notes = coalesce(p_notes, ''),
    client_decided_at = CASE
      WHEN p_decision IN ('approved', 'rejected') THEN now()
      ELSE client_decided_at
    END,
    updated_at = now()
  WHERE id = p_change_order_id;

  RETURN v_approval_id;
END;
$$;

REVOKE ALL ON FUNCTION public.can_read_client_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_approve_client_change_order(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_client_change_order_decision(
  uuid,
  public.client_approval_decision,
  text,
  text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_read_client_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_client_change_order(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_client_change_order_decision(
  uuid,
  public.client_approval_decision,
  text,
  text
) TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_contacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_client_access TO authenticated;
GRANT SELECT, INSERT ON public.change_order_approvals TO authenticated;
GRANT ALL ON public.client_contacts TO service_role;
GRANT ALL ON public.project_client_access TO service_role;
GRANT ALL ON public.change_order_approvals TO service_role;

ALTER TABLE public.client_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_client_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.change_order_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS client_contacts_org_read ON public.client_contacts;
CREATE POLICY client_contacts_org_read
  ON public.client_contacts
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS client_contacts_org_insert ON public.client_contacts;
CREATE POLICY client_contacts_org_insert
  ON public.client_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_create_project_in_org(organization_id));

DROP POLICY IF EXISTS client_contacts_org_update ON public.client_contacts;
CREATE POLICY client_contacts_org_update
  ON public.client_contacts
  FOR UPDATE
  TO authenticated
  USING (public.can_create_project_in_org(organization_id))
  WITH CHECK (public.can_create_project_in_org(organization_id));

DROP POLICY IF EXISTS client_contacts_org_delete ON public.client_contacts;
CREATE POLICY client_contacts_org_delete
  ON public.client_contacts
  FOR DELETE
  TO authenticated
  USING (public.can_create_project_in_org(organization_id));

DROP POLICY IF EXISTS project_client_access_internal_or_client_read ON public.project_client_access;
CREATE POLICY project_client_access_internal_or_client_read
  ON public.project_client_access
  FOR SELECT
  TO authenticated
  USING (
    public.can_read_project(project_id)
    OR (
      auth.uid() IS NOT NULL
      AND status IN ('pending', 'active')
      AND EXISTS (
        SELECT 1
        WHERE client_user_id = auth.uid()
          OR lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
    )
  );

DROP POLICY IF EXISTS project_client_access_project_insert ON public.project_client_access;
CREATE POLICY project_client_access_project_insert
  ON public.project_client_access
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_client_access_project_update ON public.project_client_access;
CREATE POLICY project_client_access_project_update
  ON public.project_client_access
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_client_access_project_delete ON public.project_client_access;
CREATE POLICY project_client_access_project_delete
  ON public.project_client_access
  FOR DELETE
  TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS change_order_approvals_project_read ON public.change_order_approvals;
CREATE POLICY change_order_approvals_project_read
  ON public.change_order_approvals
  FOR SELECT
  TO authenticated
  USING (public.can_read_project(project_id) OR public.can_read_client_project(project_id));

DROP POLICY IF EXISTS change_order_approvals_client_insert ON public.change_order_approvals;
CREATE POLICY change_order_approvals_client_insert
  ON public.change_order_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_approve_client_change_order(change_order_id)
    AND EXISTS (
      SELECT 1
      FROM public.change_orders co
      WHERE co.id = change_order_id
        AND co.project_id = project_id
    )
  );

DROP POLICY IF EXISTS change_orders_client_select ON public.change_orders;
CREATE POLICY change_orders_client_select
  ON public.change_orders
  FOR SELECT
  TO authenticated
  USING (client_visible = true AND public.can_read_client_project(project_id));

DROP POLICY IF EXISTS projects_client_select ON public.projects;
CREATE POLICY projects_client_select
  ON public.projects
  FOR SELECT
  TO authenticated
  USING (public.can_read_client_project(id));

DROP POLICY IF EXISTS daily_reports_client_select ON public.daily_reports;
CREATE POLICY daily_reports_client_select
  ON public.daily_reports
  FOR SELECT
  TO authenticated
  USING (client_visible = true AND public.can_read_client_project(project_id));

DROP POLICY IF EXISTS daily_reports_storage_client_read ON storage.objects;
CREATE POLICY daily_reports_storage_client_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.daily_reports dr
      WHERE dr.project_id = public.storage_project_id(name)
        AND dr.client_visible = true
        AND public.can_read_client_project(dr.project_id)
    )
  );
