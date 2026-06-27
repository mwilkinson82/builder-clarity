-- Combined: schedule_cpm_activities + seed + reseed for Harbor Residence demos.

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

-- Backfill placeholder activities from existing milestones (only for projects with none).
INSERT INTO public.schedule_activities (
  project_id, activity_id, name, division, start_date, finish_date,
  percent_complete, notes, sort_order
)
SELECT
  m.project_id,
  'A-' || lpad(row_number() OVER (
    PARTITION BY m.project_id ORDER BY m.sort_order, m.name
  )::text, 3, '0'),
  m.name,
  'Milestones',
  COALESCE(m.baseline_date, m.forecast_date),
  COALESCE(m.forecast_date, m.baseline_date),
  CASE WHEN m.status = 'complete' THEN 100 ELSE 0 END,
  m.delay_reason,
  m.sort_order
FROM public.schedule_milestones m
WHERE NOT EXISTS (
  SELECT 1 FROM public.schedule_activities a WHERE a.project_id = m.project_id
);

-- Seed Harbor Residence demo projects with the full CPM activity plan (broad match).
WITH demo_projects AS (
  SELECT id FROM public.projects
  WHERE lower(coalesce(name, '')) LIKE '%harbor residence%'
     OR lower(coalesce(job_number, '')) LIKE '%harbor%'
     OR lower(coalesce(client, '')) LIKE '%private luxury residence%'
),
placeholder_cleanup AS (
  DELETE FROM public.schedule_activities a
  USING demo_projects p
  WHERE a.project_id = p.id
    AND a.activity_id LIKE 'A-%'
    AND a.division = 'Milestones'
    AND NOT EXISTS (
      SELECT 1 FROM public.schedule_activities seeded
      WHERE seeded.project_id = a.project_id AND seeded.activity_id = '01-010'
    )
  RETURNING a.project_id
),
demo_activities (
  activity_id, name, division, start_date, finish_date, percent_complete,
  predecessor_activity_ids, successor_activity_ids, notes, sort_order
) AS (
  VALUES
    ('01-010','Contract award and preconstruction complete','00 - Procurement / Preconstruction',
      DATE '2026-02-03', DATE '2026-02-07', 100,
      ARRAY[]::text[], ARRAY['01-020','12-010']::text[],
      'Baseline launch activity. Anchors the CPM network before mobilization and long-lead procurement.', 1),
    ('01-020','Site mobilization and layout','01 - General Requirements',
      DATE '2026-02-10', DATE '2026-02-14', 100,
      ARRAY['01-010']::text[], ARRAY['31-010']::text[],
      'Mobilization, layout, temporary protection, and trade coordination before field production begins.', 2),
    ('31-010','Sitework, utilities, and erosion control','31 - Earthwork / Sitework',
      DATE '2026-02-17', DATE '2026-02-28', 100,
      ARRAY['01-020']::text[], ARRAY['03-010']::text[],
      'Site readiness activity. Completing this cleanly protects foundation start and early project momentum.', 3),
    ('03-010','Foundations and slab','03 - Concrete',
      DATE '2026-03-03', DATE '2026-03-21', 100,
      ARRAY['31-010']::text[], ARRAY['06-010']::text[],
      'Foundation and slab work complete. Drives the structural shell.', 4),
    ('06-010','Framing and structural shell','06 - Wood / Framing',
      DATE '2026-03-24', DATE '2026-04-18', 100,
      ARRAY['03-010']::text[], ARRAY['07-010','22-010','23-010','26-010']::text[],
      'Structural shell complete. Multiple rough-in and dry-in paths start once released.', 5),
    ('07-010','Dry-in envelope and roof','07 - Thermal / Moisture',
      DATE '2026-04-21', DATE '2026-05-09', 100,
      ARRAY['06-010']::text[], ARRAY['08-010','32-010']::text[],
      'Dry-in finished one week later than baseline, contributing to later rough-in and finish pressure.', 6),
    ('08-010','Windows and exterior doors','08 - Openings',
      DATE '2026-05-12', DATE '2026-06-02', 80,
      ARRAY['07-010']::text[], ARRAY['09-010']::text[],
      'Window delivery moved five weeks. PM tracking resequencing before acceleration costs hit.', 7),
    ('22-010','Plumbing rough-in','22 - Plumbing',
      DATE '2026-04-28', DATE '2026-05-16', 100,
      ARRAY['06-010']::text[], ARRAY['09-010']::text[],
      'Plumbing rough-in complete and ready for inspection closeout.', 8),
    ('23-010','HVAC rough-in','23 - HVAC',
      DATE '2026-04-28', DATE '2026-05-16', 100,
      ARRAY['06-010']::text[], ARRAY['09-010']::text[],
      'HVAC rough-in complete. Coordination hold is now on appliance and opening decisions.', 9),
    ('26-010','Electrical rough-in','26 - Electrical',
      DATE '2026-04-29', DATE '2026-05-20', 100,
      ARRAY['06-010']::text[], ARRAY['09-010']::text[],
      'Electrical rough-in complete. Lighting allowance exposure remains in the IOR.', 10),
    ('09-010','Rough inspections and insulation','09 - Finishes',
      DATE '2026-05-23', DATE '2026-06-05', 65,
      ARRAY['08-010','22-010','23-010','26-010']::text[], ARRAY['09-020']::text[],
      'Current handoff point into drywall — where late appliance and window issues surface in the schedule.', 11),
    ('09-020','Drywall hang and finish','09 - Finishes',
      DATE '2026-06-06', DATE '2026-06-28', 40,
      ARRAY['09-010']::text[], ARRAY['09-030','12-020']::text[],
      'Drywall active and under performance watch. Quality slips trigger trade-performance recovery action.', 12),
    ('09-030','Tile and interior finish start','09 - Finishes',
      DATE '2026-06-24', DATE '2026-07-15', 20,
      ARRAY['09-020']::text[], ARRAY['09-040']::text[],
      'Interior finish overlaps late drywall to claw back schedule without full acceleration cost.', 13),
    ('12-010','Cabinet fabrication and delivery','12 - Furnishings / Casework',
      DATE '2026-04-20', DATE '2026-07-03', 50,
      ARRAY['01-010']::text[], ARRAY['12-020']::text[],
      'Cabinets misassembled and damaged. Long-lead procurement tied directly to a recoverable E-Hold.', 14),
    ('12-020','Cabinet install and built-ins','12 - Furnishings / Casework',
      DATE '2026-07-06', DATE '2026-07-17', 0,
      ARRAY['09-020','12-010']::text[], ARRAY['22-020','26-020','09-040']::text[],
      'Install cannot start until drywall areas and replacement cabinet delivery are released.', 15),
    ('22-020','Trim plumbing and fixtures','22 - Plumbing',
      DATE '2026-07-20', DATE '2026-07-28', 0,
      ARRAY['12-020']::text[], ARRAY['99-010']::text[],
      'Trim plumbing follows cabinet and finish release. Watch for owner-furnished fixture decisions.', 16),
    ('26-020','Trim electrical and lighting package','26 - Electrical',
      DATE '2026-07-20', DATE '2026-07-31', 0,
      ARRAY['12-020']::text[], ARRAY['99-010']::text[],
      'Lighting selections drove allowance exposure. Where financial exposure and CPM logic meet.', 17),
    ('09-040','Paint, final finishes, and punch prep','09 - Finishes',
      DATE '2026-07-18', DATE '2026-08-01', 0,
      ARRAY['09-030','12-020']::text[], ARRAY['99-010']::text[],
      'Final finishes — where the finish-phase C-Hold should be gardened and then released.', 18),
    ('32-010','Exterior hardscape and pool coordination','32 - Exterior Improvements',
      DATE '2026-06-17', DATE '2026-08-07', 30,
      ARRAY['07-010']::text[], ARRAY['99-010']::text[],
      'Pool equipment relocation and outdoor kitchen change orders shown as schedule-adjacent exposure.', 19),
    ('99-010','Final punch, owner walk, and substantial completion','99 - Closeout',
      DATE '2026-08-10', DATE '2026-08-21', 0,
      ARRAY['22-020','26-020','09-040','32-010']::text[], ARRAY[]::text[],
      'Closeout milestone. Rolls the CPM story into the IOR.', 20)
)
INSERT INTO public.schedule_activities (
  project_id, activity_id, name, division, start_date, finish_date,
  percent_complete, predecessor_activity_ids, successor_activity_ids, notes, sort_order
)
SELECT p.id, a.activity_id, a.name, a.division, a.start_date, a.finish_date,
       a.percent_complete, a.predecessor_activity_ids, a.successor_activity_ids,
       a.notes, a.sort_order
FROM demo_projects p
CROSS JOIN demo_activities a
WHERE NOT EXISTS (
  SELECT 1 FROM public.schedule_activities existing
  WHERE existing.project_id = p.id AND existing.activity_id = a.activity_id
);