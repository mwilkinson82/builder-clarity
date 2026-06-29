CREATE TABLE IF NOT EXISTS public.schedule_wbs_sections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_wbs_sections_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS schedule_wbs_sections_project_sort_idx
  ON public.schedule_wbs_sections(project_id, sort_order, name);

CREATE UNIQUE INDEX IF NOT EXISTS schedule_wbs_sections_project_name_unique_idx
  ON public.schedule_wbs_sections(project_id, lower(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_wbs_sections TO authenticated;
GRANT ALL ON public.schedule_wbs_sections TO service_role;

ALTER TABLE public.schedule_wbs_sections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_wbs_sections_team_select ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_select ON public.schedule_wbs_sections
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_wbs_sections_team_insert ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_insert ON public.schedule_wbs_sections
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_wbs_sections_team_update ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_update ON public.schedule_wbs_sections
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_wbs_sections_team_delete ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_delete ON public.schedule_wbs_sections
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_wbs_sections_updated_at ON public.schedule_wbs_sections;
CREATE TRIGGER schedule_wbs_sections_updated_at
  BEFORE UPDATE ON public.schedule_wbs_sections
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

WITH activity_divisions AS (
  SELECT
    project_id,
    COALESCE(NULLIF(trim(division), ''), 'General') AS name,
    MIN(sort_order) AS first_sort_order
  FROM public.schedule_activities
  GROUP BY project_id, COALESCE(NULLIF(trim(division), ''), 'General')
),
ranked_divisions AS (
  SELECT
    project_id,
    name,
    row_number() OVER (
      PARTITION BY project_id
      ORDER BY first_sort_order, name
    ) * 10 AS sort_order
  FROM activity_divisions
)
INSERT INTO public.schedule_wbs_sections (project_id, name, sort_order)
SELECT project_id, name, sort_order
FROM ranked_divisions d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.schedule_wbs_sections s
  WHERE s.project_id = d.project_id
    AND lower(s.name) = lower(d.name)
);
