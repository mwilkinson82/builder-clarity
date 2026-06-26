CREATE TABLE IF NOT EXISTS public.schedule_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  activity_id text NOT NULL DEFAULT '',
  name text NOT NULL,
  division text NOT NULL DEFAULT 'General',
  start_date date,
  finish_date date,
  percent_complete numeric NOT NULL DEFAULT 0,
  predecessor_activity_ids text[] NOT NULL DEFAULT '{}'::text[],
  successor_activity_ids text[] NOT NULL DEFAULT '{}'::text[],
  notes text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_activities_percent_complete_check
    CHECK (percent_complete >= 0 AND percent_complete <= 100)
);

CREATE INDEX IF NOT EXISTS schedule_activities_project_sort_idx
  ON public.schedule_activities(project_id, sort_order, activity_id);

CREATE INDEX IF NOT EXISTS schedule_activities_project_division_idx
  ON public.schedule_activities(project_id, division);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_activities TO authenticated;
GRANT ALL ON public.schedule_activities TO service_role;

ALTER TABLE public.schedule_activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_activities_team_select ON public.schedule_activities;
CREATE POLICY schedule_activities_team_select ON public.schedule_activities
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_activities_team_insert ON public.schedule_activities;
CREATE POLICY schedule_activities_team_insert ON public.schedule_activities
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_activities_team_update ON public.schedule_activities;
CREATE POLICY schedule_activities_team_update ON public.schedule_activities
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_activities_team_delete ON public.schedule_activities;
CREATE POLICY schedule_activities_team_delete ON public.schedule_activities
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_activities_updated_at ON public.schedule_activities;
CREATE TRIGGER schedule_activities_updated_at
  BEFORE UPDATE ON public.schedule_activities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

INSERT INTO public.schedule_activities (
  project_id,
  activity_id,
  name,
  division,
  start_date,
  finish_date,
  percent_complete,
  notes,
  sort_order
)
SELECT
  m.project_id,
  'A-' || lpad(row_number() OVER (
    PARTITION BY m.project_id
    ORDER BY m.sort_order, m.name
  )::text, 3, '0') AS activity_id,
  m.name,
  'Milestones' AS division,
  COALESCE(m.baseline_date, m.forecast_date) AS start_date,
  COALESCE(m.forecast_date, m.baseline_date) AS finish_date,
  CASE WHEN m.status = 'complete' THEN 100 ELSE 0 END AS percent_complete,
  m.delay_reason AS notes,
  m.sort_order
FROM public.schedule_milestones m
WHERE NOT EXISTS (
  SELECT 1
  FROM public.schedule_activities a
  WHERE a.project_id = m.project_id
);
