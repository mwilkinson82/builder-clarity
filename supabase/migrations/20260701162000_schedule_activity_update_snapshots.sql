CREATE TABLE IF NOT EXISTS public.schedule_activity_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  schedule_update_id uuid NOT NULL REFERENCES public.schedule_updates(id) ON DELETE CASCADE,
  schedule_activity_id uuid REFERENCES public.schedule_activities(id) ON DELETE SET NULL,
  update_number integer NOT NULL,
  data_date date NOT NULL,
  activity_id text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  division text NOT NULL DEFAULT 'General',
  wbs_section_id uuid REFERENCES public.schedule_wbs_sections(id) ON DELETE SET NULL,
  baseline_start_date date,
  baseline_finish_date date,
  current_start_date date,
  current_finish_date date,
  actual_start_date date,
  actual_finish_date date,
  planned_duration_days integer NOT NULL DEFAULT 0,
  remaining_duration_days integer NOT NULL DEFAULT 0,
  percent_complete numeric NOT NULL DEFAULT 0,
  total_float_days integer NOT NULL DEFAULT 0,
  free_float_days integer NOT NULL DEFAULT 0,
  slippage_days integer NOT NULL DEFAULT 0,
  is_critical boolean NOT NULL DEFAULT false,
  is_near_critical boolean NOT NULL DEFAULT false,
  is_late boolean NOT NULL DEFAULT false,
  is_out_of_sequence boolean NOT NULL DEFAULT false,
  is_open_start boolean NOT NULL DEFAULT false,
  is_open_finish boolean NOT NULL DEFAULT false,
  is_milestone boolean NOT NULL DEFAULT false,
  predecessor_activity_ids text[] NOT NULL DEFAULT '{}',
  successor_activity_ids text[] NOT NULL DEFAULT '{}',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (schedule_update_id, schedule_activity_id),
  CONSTRAINT schedule_activity_updates_percent_check
    CHECK (percent_complete >= 0 AND percent_complete <= 100),
  CONSTRAINT schedule_activity_updates_duration_check
    CHECK (planned_duration_days >= 0 AND remaining_duration_days >= 0)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_activity_updates TO authenticated;
GRANT ALL ON public.schedule_activity_updates TO service_role;

ALTER TABLE public.schedule_activity_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_activity_updates_team_select ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_select ON public.schedule_activity_updates
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_activity_updates_team_insert ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_insert ON public.schedule_activity_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_activity_updates_team_update ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_update ON public.schedule_activity_updates
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_activity_updates_team_delete ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_delete ON public.schedule_activity_updates
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_activity_updates_set_updated_at ON public.schedule_activity_updates;
CREATE TRIGGER schedule_activity_updates_set_updated_at
  BEFORE UPDATE ON public.schedule_activity_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS schedule_activity_updates_project_update_idx
  ON public.schedule_activity_updates(project_id, update_number DESC);

CREATE INDEX IF NOT EXISTS schedule_activity_updates_schedule_update_idx
  ON public.schedule_activity_updates(schedule_update_id);

CREATE INDEX IF NOT EXISTS schedule_activity_updates_activity_idx
  ON public.schedule_activity_updates(project_id, schedule_activity_id, activity_id);

CREATE INDEX IF NOT EXISTS schedule_activity_updates_data_date_idx
  ON public.schedule_activity_updates(project_id, data_date DESC);
