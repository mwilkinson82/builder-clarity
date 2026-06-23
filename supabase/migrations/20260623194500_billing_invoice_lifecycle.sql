CREATE TABLE IF NOT EXISTS public.billing_application_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_application_id uuid NOT NULL REFERENCES public.billing_applications(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  event_type text NOT NULL DEFAULT 'status_change',
  from_status text NOT NULL DEFAULT '',
  to_status text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, DELETE ON public.billing_application_events TO authenticated;
GRANT ALL ON public.billing_application_events TO service_role;

ALTER TABLE public.billing_application_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS billing_application_events_billing_application_id_idx
  ON public.billing_application_events(billing_application_id, created_at DESC);

CREATE INDEX IF NOT EXISTS billing_application_events_project_id_idx
  ON public.billing_application_events(project_id, created_at DESC);

DROP POLICY IF EXISTS billing_application_events_team_select ON public.billing_application_events;
CREATE POLICY billing_application_events_team_select ON public.billing_application_events
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS billing_application_events_team_insert ON public.billing_application_events;
CREATE POLICY billing_application_events_team_insert ON public.billing_application_events
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_application_events_team_delete ON public.billing_application_events;
CREATE POLICY billing_application_events_team_delete ON public.billing_application_events
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_application_events_client_select ON public.billing_application_events;
CREATE POLICY billing_application_events_client_select ON public.billing_application_events
  FOR SELECT TO authenticated
  USING (public.can_view_client_billing(project_id));

INSERT INTO public.billing_application_events (
  billing_application_id,
  project_id,
  event_type,
  from_status,
  to_status,
  amount,
  notes,
  created_at
)
SELECT
  b.id,
  b.project_id,
  'created',
  '',
  b.status,
  b.amount_billed,
  COALESCE(NULLIF(b.notes, ''), 'Existing pay application imported into the lifecycle log.'),
  COALESCE(b.created_at, now())
FROM public.billing_applications b
WHERE NOT EXISTS (
  SELECT 1
  FROM public.billing_application_events e
  WHERE e.billing_application_id = b.id
);
