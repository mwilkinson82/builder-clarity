CREATE TABLE IF NOT EXISTS public.schedule_delay_fragments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  schedule_activity_id uuid REFERENCES public.schedule_activities(id) ON DELETE SET NULL,
  activity_id text NOT NULL DEFAULT '',
  title text NOT NULL,
  reason text NOT NULL DEFAULT '',
  delay_days integer NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'field',
  status text NOT NULL DEFAULT 'active',
  owner text NOT NULL DEFAULT '',
  identified_on date NOT NULL DEFAULT current_date,
  resolved_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_delay_fragments_title_not_blank CHECK (length(trim(title)) > 0),
  CONSTRAINT schedule_delay_fragments_delay_days_check CHECK (delay_days >= 0 AND delay_days <= 365),
  CONSTRAINT schedule_delay_fragments_source_check
    CHECK (source IN ('field', 'trade', 'owner', 'design', 'procurement', 'weather', 'other')),
  CONSTRAINT schedule_delay_fragments_status_check
    CHECK (status IN ('active', 'mitigated', 'accepted', 'recovered'))
);

CREATE INDEX IF NOT EXISTS schedule_delay_fragments_project_status_idx
  ON public.schedule_delay_fragments(project_id, status, identified_on DESC);

CREATE INDEX IF NOT EXISTS schedule_delay_fragments_project_activity_idx
  ON public.schedule_delay_fragments(project_id, schedule_activity_id, activity_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_delay_fragments TO authenticated;
GRANT ALL ON public.schedule_delay_fragments TO service_role;

ALTER TABLE public.schedule_delay_fragments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_delay_fragments_team_select ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_select ON public.schedule_delay_fragments
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_delay_fragments_team_insert ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_insert ON public.schedule_delay_fragments
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_delay_fragments_team_update ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_update ON public.schedule_delay_fragments
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_delay_fragments_team_delete ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_delete ON public.schedule_delay_fragments
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_delay_fragments_updated_at ON public.schedule_delay_fragments;
CREATE TRIGGER schedule_delay_fragments_updated_at
  BEFORE UPDATE ON public.schedule_delay_fragments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
