CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.project_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  parent_inspection_id uuid REFERENCES public.project_inspections(id) ON DELETE SET NULL,
  seed_key text NOT NULL DEFAULT '',
  inspection_type text NOT NULL DEFAULT '',
  authority text NOT NULL DEFAULT '',
  location text NOT NULL DEFAULT '',
  responsible_party text NOT NULL DEFAULT '',
  inspector text NOT NULL DEFAULT '',
  requested_date date,
  scheduled_date date,
  completed_date date,
  status text NOT NULL DEFAULT 'planned',
  result text NOT NULL DEFAULT 'pending',
  attempt_number integer NOT NULL DEFAULT 1,
  required_reinspection boolean NOT NULL DEFAULT false,
  cost_impact numeric NOT NULL DEFAULT 0,
  schedule_impact_weeks numeric,
  notes text NOT NULL DEFAULT '',
  corrective_action text NOT NULL DEFAULT '',
  risk_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_inspections
  ADD COLUMN IF NOT EXISTS parent_inspection_id uuid REFERENCES public.project_inspections(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS seed_key text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS inspection_type text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS authority text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responsible_party text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS inspector text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS requested_date date,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS completed_date date,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'planned',
  ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS attempt_number integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS required_reinspection boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cost_impact numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS schedule_impact_weeks numeric,
  ADD COLUMN IF NOT EXISTS notes text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS corrective_action text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS risk_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public.project_inspections
    ADD CONSTRAINT project_inspections_status_check
    CHECK (status IN ('planned', 'requested', 'scheduled', 'passed', 'failed', 'partial', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.project_inspections
    ADD CONSTRAINT project_inspections_result_check
    CHECK (result IN ('pending', 'pass', 'fail', 'partial', 'cancelled'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.project_inspections
    ADD CONSTRAINT project_inspections_attempt_positive
    CHECK (attempt_number > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_inspections_project_scheduled_idx
  ON public.project_inspections(project_id, scheduled_date);

CREATE INDEX IF NOT EXISTS project_inspections_project_status_idx
  ON public.project_inspections(project_id, status);

CREATE INDEX IF NOT EXISTS project_inspections_risk_exposure_idx
  ON public.project_inspections(risk_exposure_id);

CREATE UNIQUE INDEX IF NOT EXISTS project_inspections_project_seed_key_idx
  ON public.project_inspections(project_id, seed_key)
  WHERE seed_key <> '';

DROP TRIGGER IF EXISTS project_inspections_set_updated_at ON public.project_inspections;
CREATE TRIGGER project_inspections_set_updated_at
  BEFORE UPDATE ON public.project_inspections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.project_inspections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_inspections_team_select ON public.project_inspections;
CREATE POLICY project_inspections_team_select ON public.project_inspections
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS project_inspections_team_insert ON public.project_inspections;
CREATE POLICY project_inspections_team_insert ON public.project_inspections
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_inspections_team_update ON public.project_inspections;
CREATE POLICY project_inspections_team_update ON public.project_inspections
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_inspections_team_delete ON public.project_inspections;
CREATE POLICY project_inspections_team_delete ON public.project_inspections
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_inspections TO authenticated;
GRANT ALL ON public.project_inspections TO service_role;

WITH harbor_projects AS (
  SELECT id
  FROM public.projects
  WHERE job_number = 'DEMO-HARBOR'
     OR lower(coalesce(name, '')) LIKE '%harbor residence%'
     OR lower(coalesce(job_number, '')) LIKE '%harbor%'
     OR lower(coalesce(client, '')) LIKE '%private luxury residence%'
),
demo_inspections (
  seed_key,
  inspection_type,
  authority,
  location,
  responsible_party,
  inspector,
  requested_date,
  scheduled_date,
  completed_date,
  status,
  result,
  attempt_number,
  required_reinspection,
  cost_impact,
  schedule_impact_weeks,
  notes,
  corrective_action
) AS (
  VALUES
    (
      'harbor-demo:inspection:plumbing-rough-pass',
      'Rough plumbing inspection',
      'City Building Department',
      'Level 1 bath groups and equipment room',
      'J. Patel',
      'M. Ortiz',
      DATE '2026-05-22',
      DATE '2026-05-27',
      DATE '2026-05-27',
      'passed',
      'pass',
      1,
      false,
      0,
      NULL::numeric,
      'Passed first inspection. Photos and pressure test record are retained in the project file.',
      ''
    ),
    (
      'harbor-demo:inspection:electrical-rough-fail',
      'Electrical rough-in inspection',
      'City Building Department',
      'Kitchen, service entry, and pool equipment feeders',
      'BMB Electric',
      'T. Reeves',
      DATE '2026-05-29',
      DATE '2026-06-03',
      DATE '2026-06-03',
      'failed',
      'fail',
      1,
      true,
      9500,
      1,
      'Failed for missing panel directory, unsupported low-voltage runs, and pool equipment bonding corrections.',
      'Electrical subcontractor must correct bonding, support low-voltage runs, update panel directory, and request reinspection.'
    ),
    (
      'harbor-demo:inspection:electrical-rough-reinspection-pass',
      'Electrical rough-in reinspection',
      'City Building Department',
      'Kitchen, service entry, and pool equipment feeders',
      'BMB Electric',
      'T. Reeves',
      DATE '2026-06-04',
      DATE '2026-06-07',
      DATE '2026-06-07',
      'passed',
      'pass',
      2,
      false,
      0,
      NULL::numeric,
      'Reinspection passed after corrective work. Keep original failure in the log because it drove the schedule and cost risk discussion.',
      'Corrections accepted by inspector.'
    ),
    (
      'harbor-demo:inspection:framing-partial',
      'Framing and shear inspection',
      'County Structural Inspector',
      'Main residence structural shell',
      'R. Singh',
      'A. Keller',
      DATE '2026-06-10',
      DATE '2026-06-14',
      NULL::date,
      'scheduled',
      'pending',
      1,
      false,
      0,
      0.5,
      'Scheduled before drywall release. Any failed item should become an IOR exposure and a schedule recovery action.',
      ''
    )
)
INSERT INTO public.project_inspections (
  project_id,
  seed_key,
  inspection_type,
  authority,
  location,
  responsible_party,
  inspector,
  requested_date,
  scheduled_date,
  completed_date,
  status,
  result,
  attempt_number,
  required_reinspection,
  cost_impact,
  schedule_impact_weeks,
  notes,
  corrective_action
)
SELECT
  hp.id,
  di.seed_key,
  di.inspection_type,
  di.authority,
  di.location,
  di.responsible_party,
  di.inspector,
  di.requested_date,
  di.scheduled_date,
  di.completed_date,
  di.status,
  di.result,
  di.attempt_number,
  di.required_reinspection,
  di.cost_impact,
  di.schedule_impact_weeks,
  di.notes,
  di.corrective_action
FROM harbor_projects hp
CROSS JOIN demo_inspections di
ON CONFLICT DO NOTHING;

UPDATE public.project_inspections child
SET parent_inspection_id = parent.id
FROM public.project_inspections parent
WHERE child.project_id = parent.project_id
  AND child.seed_key = 'harbor-demo:inspection:electrical-rough-reinspection-pass'
  AND parent.seed_key = 'harbor-demo:inspection:electrical-rough-fail'
  AND child.parent_inspection_id IS DISTINCT FROM parent.id;

NOTIFY pgrst, 'reload schema';
