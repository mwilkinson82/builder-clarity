-- Project selections: CPM-linked decision deadlines, client approvals, and
-- procurement handoff. This migration is schema-only; Lovable applies it to
-- the connected Supabase project after the code is merged.

ALTER TABLE public.project_client_access
  ADD COLUMN IF NOT EXISTS can_view_selections boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.project_selections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  selection_number text NOT NULL DEFAULT '',
  title text NOT NULL,
  category text NOT NULL DEFAULT '',
  room_area text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  decision_status text NOT NULL DEFAULT 'draft'
    CHECK (decision_status IN ('draft', 'sent', 'revision_requested', 'approved')),
  procurement_status text NOT NULL DEFAULT 'not_released'
    CHECK (procurement_status IN ('not_released', 'ordered', 'shipped', 'received', 'installed')),
  schedule_activity_id uuid REFERENCES public.schedule_activities(id) ON DELETE SET NULL,
  schedule_override_acknowledged boolean NOT NULL DEFAULT false,
  need_on_site_date date,
  procurement_lead_days integer NOT NULL DEFAULT 0 CHECK (procurement_lead_days >= 0),
  delivery_buffer_days integer NOT NULL DEFAULT 0 CHECK (delivery_buffer_days >= 0),
  client_review_days integer NOT NULL DEFAULT 7 CHECK (client_review_days >= 0),
  order_by_date date,
  client_decision_due_date date,
  assigned_client_contact_id uuid REFERENCES public.client_contacts(id) ON DELETE SET NULL,
  selected_option_id uuid,
  allowance_cents bigint NOT NULL DEFAULT 0 CHECK (allowance_cents >= 0),
  client_visible boolean NOT NULL DEFAULT false,
  client_sent_at timestamptz,
  client_decided_at timestamptz,
  approved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (schedule_activity_id IS NOT NULL OR schedule_override_acknowledged = true)
);

CREATE TABLE IF NOT EXISTS public.project_selection_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  selection_id uuid NOT NULL REFERENCES public.project_selections(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  manufacturer text NOT NULL DEFAULT '',
  model_number text NOT NULL DEFAULT '',
  finish text NOT NULL DEFAULT '',
  price_cents bigint NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  is_recommended boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_selections_selected_option_id_fkey'
      AND conrelid = 'public.project_selections'::regclass
  ) THEN
    ALTER TABLE public.project_selections
      ADD CONSTRAINT project_selections_selected_option_id_fkey
      FOREIGN KEY (selected_option_id)
      REFERENCES public.project_selection_options(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.project_selection_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  selection_id uuid NOT NULL REFERENCES public.project_selections(id) ON DELETE CASCADE,
  option_id uuid REFERENCES public.project_selection_options(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES public.client_contacts(id) ON DELETE SET NULL,
  client_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_email text NOT NULL DEFAULT '',
  decision text NOT NULL CHECK (decision IN ('approved', 'revision_requested')),
  notes text NOT NULL DEFAULT '',
  selection_version integer NOT NULL CHECK (selection_version > 0),
  selection_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  option_snapshot jsonb,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_selections_project_status_idx
  ON public.project_selections(project_id, decision_status, procurement_status);
CREATE INDEX IF NOT EXISTS project_selections_schedule_activity_idx
  ON public.project_selections(schedule_activity_id);
CREATE INDEX IF NOT EXISTS project_selections_assigned_contact_idx
  ON public.project_selections(assigned_client_contact_id);
CREATE INDEX IF NOT EXISTS project_selections_selected_option_idx
  ON public.project_selections(selected_option_id);
CREATE INDEX IF NOT EXISTS project_selections_created_by_idx
  ON public.project_selections(created_by);
CREATE INDEX IF NOT EXISTS project_selections_updated_by_idx
  ON public.project_selections(updated_by);
CREATE INDEX IF NOT EXISTS project_selections_decision_due_idx
  ON public.project_selections(project_id, client_decision_due_date);
CREATE INDEX IF NOT EXISTS project_selection_options_selection_idx
  ON public.project_selection_options(selection_id, sort_order);
CREATE INDEX IF NOT EXISTS project_selection_options_project_idx
  ON public.project_selection_options(project_id, sort_order);
CREATE INDEX IF NOT EXISTS project_selection_decisions_selection_idx
  ON public.project_selection_decisions(selection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_selection_decisions_project_idx
  ON public.project_selection_decisions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_selection_decisions_option_idx
  ON public.project_selection_decisions(option_id);
CREATE INDEX IF NOT EXISTS project_selection_decisions_contact_idx
  ON public.project_selection_decisions(contact_id);
CREATE INDEX IF NOT EXISTS project_selection_decisions_client_user_idx
  ON public.project_selection_decisions(client_user_id);

DROP TRIGGER IF EXISTS project_selections_set_updated_at ON public.project_selections;
CREATE TRIGGER project_selections_set_updated_at
  BEFORE UPDATE ON public.project_selections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS project_selection_options_set_updated_at ON public.project_selection_options;
CREATE TRIGGER project_selection_options_set_updated_at
  BEFORE UPDATE ON public.project_selection_options
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.can_view_client_selections(p_project_id uuid)
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
        AND a.can_view_selections = true
        AND (
          a.client_user_id = auth.uid()
          OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_client_selection(p_selection_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_selections s
    WHERE s.id = p_selection_id
      AND s.client_visible = true
      AND public.can_view_client_selections(s.project_id)
  );
$$;

REVOKE ALL ON FUNCTION public.can_view_client_selections(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_client_selection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_client_selections(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_client_selection(uuid) TO authenticated;

ALTER TABLE public.project_selections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_selection_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_selection_decisions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_selections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_selection_options TO authenticated;
GRANT SELECT ON public.project_selection_decisions TO authenticated;
GRANT ALL ON public.project_selections TO service_role;
GRANT ALL ON public.project_selection_options TO service_role;
GRANT ALL ON public.project_selection_decisions TO service_role;

DROP POLICY IF EXISTS project_selections_read ON public.project_selections;
CREATE POLICY project_selections_read ON public.project_selections
  FOR SELECT TO authenticated
  USING (
    public.can_read_project(project_id)
    OR (client_visible = true AND public.can_view_client_selections(project_id))
  );

DROP POLICY IF EXISTS project_selections_insert ON public.project_selections;
CREATE POLICY project_selections_insert ON public.project_selections
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selections_update ON public.project_selections;
CREATE POLICY project_selections_update ON public.project_selections
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selections_delete ON public.project_selections;
CREATE POLICY project_selections_delete ON public.project_selections
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selection_options_read ON public.project_selection_options;
CREATE POLICY project_selection_options_read ON public.project_selection_options
  FOR SELECT TO authenticated
  USING (
    public.can_read_project(project_id)
    OR public.can_view_client_selection(selection_id)
  );

DROP POLICY IF EXISTS project_selection_options_insert ON public.project_selection_options;
CREATE POLICY project_selection_options_insert ON public.project_selection_options
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selection_options_update ON public.project_selection_options;
CREATE POLICY project_selection_options_update ON public.project_selection_options
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selection_options_delete ON public.project_selection_options;
CREATE POLICY project_selection_options_delete ON public.project_selection_options
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_selection_decisions_read ON public.project_selection_decisions;
CREATE POLICY project_selection_decisions_read ON public.project_selection_decisions
  FOR SELECT TO authenticated
  USING (
    public.can_read_project(project_id)
    OR public.can_view_client_selection(selection_id)
  );

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
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text := coalesce(auth.jwt() ->> 'email', '');
  v_selection public.project_selections%ROWTYPE;
  v_option public.project_selection_options%ROWTYPE;
  v_contact_id uuid;
  v_access_id uuid;
  v_decision_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF p_decision NOT IN ('approved', 'revision_requested') THEN
    RAISE EXCEPTION 'Decision must be approved or revision_requested.';
  END IF;

  SELECT * INTO v_selection
  FROM public.project_selections
  WHERE id = p_selection_id
    AND client_visible = true;
  IF v_selection.id IS NULL OR NOT public.can_view_client_selections(v_selection.project_id) THEN
    RAISE EXCEPTION 'This selection is not available for your approval.';
  END IF;

  IF p_decision = 'approved' THEN
    IF p_option_id IS NULL THEN
      RAISE EXCEPTION 'Choose an option before approving.';
    END IF;
    SELECT * INTO v_option
    FROM public.project_selection_options
    WHERE id = p_option_id
      AND selection_id = p_selection_id;
    IF v_option.id IS NULL THEN
      RAISE EXCEPTION 'The selected option does not belong to this selection.';
    END IF;
  END IF;

  SELECT a.id, a.contact_id
  INTO v_access_id, v_contact_id
  FROM public.project_client_access a
  WHERE a.project_id = v_selection.project_id
    AND a.status IN ('pending', 'active')
    AND a.can_view_selections = true
    AND (
      a.client_user_id = v_user_id
      OR lower(a.email) = lower(v_email)
    )
  ORDER BY a.created_at ASC
  LIMIT 1;
  IF v_access_id IS NULL THEN
    RAISE EXCEPTION 'You do not have selection approval access for this project.';
  END IF;

  UPDATE public.project_client_access
  SET status = 'active',
      client_user_id = coalesce(client_user_id, v_user_id),
      accepted_by = coalesce(accepted_by, v_user_id),
      accepted_at = coalesce(accepted_at, now()),
      updated_at = now()
  WHERE id = v_access_id;

  INSERT INTO public.project_selection_decisions (
    project_id,
    selection_id,
    option_id,
    contact_id,
    client_user_id,
    client_email,
    decision,
    notes,
    selection_version,
    selection_snapshot,
    option_snapshot,
    user_agent
  ) VALUES (
    v_selection.project_id,
    v_selection.id,
    CASE WHEN p_decision = 'approved' THEN v_option.id ELSE NULL END,
    v_contact_id,
    v_user_id,
    v_email,
    p_decision,
    left(coalesce(p_notes, ''), 4000),
    v_selection.version,
    to_jsonb(v_selection),
    CASE WHEN p_decision = 'approved' THEN to_jsonb(v_option) ELSE NULL END,
    left(coalesce(p_user_agent, ''), 1000)
  ) RETURNING id INTO v_decision_id;

  UPDATE public.project_selections
  SET decision_status = p_decision,
      selected_option_id = CASE WHEN p_decision = 'approved' THEN v_option.id ELSE NULL END,
      client_decided_at = now(),
      approved_at = CASE WHEN p_decision = 'approved' THEN now() ELSE NULL END,
      updated_by = v_user_id,
      updated_at = now()
  WHERE id = v_selection.id;

  RETURN v_decision_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_client_selection_decision(uuid, uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_client_selection_decision(uuid, uuid, text, text, text) TO authenticated;

NOTIFY pgrst, 'reload schema';
