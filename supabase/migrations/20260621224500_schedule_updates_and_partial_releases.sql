ALTER TABLE public.exposures
  ADD COLUMN IF NOT EXISTS released_amount numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS release_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS release_updated_at timestamptz;

UPDATE public.exposures
SET released_amount = 0
WHERE released_amount IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exposures_released_amount_nonnegative'
  ) THEN
    ALTER TABLE public.exposures
      ADD CONSTRAINT exposures_released_amount_nonnegative CHECK (released_amount >= 0);
  END IF;
END $$;

ALTER TABLE public.schedule_risks
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inactive_reason text NOT NULL DEFAULT '';

UPDATE public.schedule_risks
SET status = 'active'
WHERE status IS NULL OR status = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'schedule_risks_status_check'
  ) THEN
    ALTER TABLE public.schedule_risks
      ADD CONSTRAINT schedule_risks_status_check
      CHECK (status IN ('active', 'inactive', 'completed'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.schedule_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  update_number integer NOT NULL,
  update_date date NOT NULL DEFAULT current_date,
  baseline_completion_date date,
  forecast_completion_date date NOT NULL,
  variance_weeks numeric NOT NULL DEFAULT 0,
  movement_weeks numeric NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, update_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_updates TO authenticated;
GRANT ALL ON public.schedule_updates TO service_role;

ALTER TABLE public.schedule_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_updates_team_select ON public.schedule_updates;
CREATE POLICY schedule_updates_team_select ON public.schedule_updates
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_updates_team_insert ON public.schedule_updates;
CREATE POLICY schedule_updates_team_insert ON public.schedule_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_updates_team_update ON public.schedule_updates;
CREATE POLICY schedule_updates_team_update ON public.schedule_updates
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_updates_team_delete ON public.schedule_updates;
CREATE POLICY schedule_updates_team_delete ON public.schedule_updates
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_updates_set_updated_at ON public.schedule_updates;
CREATE TRIGGER schedule_updates_set_updated_at
  BEFORE UPDATE ON public.schedule_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS schedule_updates_project_id_update_number_idx
  ON public.schedule_updates(project_id, update_number DESC);

CREATE TABLE IF NOT EXISTS public.schedule_milestone_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  milestone_id uuid NOT NULL REFERENCES public.schedule_milestones(id) ON DELETE CASCADE,
  schedule_update_id uuid REFERENCES public.schedule_updates(id) ON DELETE SET NULL,
  update_number integer NOT NULL,
  baseline_date date,
  forecast_date date,
  variance_weeks numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'on_track',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (milestone_id, update_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_milestone_updates TO authenticated;
GRANT ALL ON public.schedule_milestone_updates TO service_role;

ALTER TABLE public.schedule_milestone_updates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_milestone_updates_team_select ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_select ON public.schedule_milestone_updates
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_milestone_updates_team_insert ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_insert ON public.schedule_milestone_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_milestone_updates_team_update ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_update ON public.schedule_milestone_updates
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_milestone_updates_team_delete ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_delete ON public.schedule_milestone_updates
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_milestone_updates_set_updated_at ON public.schedule_milestone_updates;
CREATE TRIGGER schedule_milestone_updates_set_updated_at
  BEFORE UPDATE ON public.schedule_milestone_updates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS schedule_milestone_updates_project_id_update_number_idx
  ON public.schedule_milestone_updates(project_id, update_number DESC);

INSERT INTO public.schedule_updates (
  project_id,
  update_number,
  update_date,
  baseline_completion_date,
  forecast_completion_date,
  variance_weeks,
  movement_weeks,
  notes
)
SELECT
  p.id,
  1,
  COALESCE(p.last_reviewed_at::date, current_date),
  p.baseline_completion_date,
  p.forecast_completion_date,
  COALESCE(p.schedule_variance_weeks, 0),
  0,
  'Initial schedule update created from current project dates.'
FROM public.projects p
WHERE p.forecast_completion_date IS NOT NULL
ON CONFLICT (project_id, update_number) DO NOTHING;

INSERT INTO public.schedule_milestone_updates (
  project_id,
  milestone_id,
  schedule_update_id,
  update_number,
  baseline_date,
  forecast_date,
  variance_weeks,
  status,
  notes
)
SELECT
  m.project_id,
  m.id,
  su.id,
  su.update_number,
  m.baseline_date,
  m.forecast_date,
  CASE
    WHEN m.baseline_date IS NULL OR m.forecast_date IS NULL THEN 0
    ELSE round((m.forecast_date - m.baseline_date)::numeric / 7)
  END,
  m.status,
  m.delay_reason
FROM public.schedule_milestones m
JOIN public.schedule_updates su
  ON su.project_id = m.project_id
 AND su.update_number = 1
ON CONFLICT (milestone_id, update_number) DO NOTHING;
