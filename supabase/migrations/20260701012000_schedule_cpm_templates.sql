CREATE TABLE IF NOT EXISTS public.schedule_cpm_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  activities jsonb NOT NULL DEFAULT '[]'::jsonb,
  wbs_sections jsonb NOT NULL DEFAULT '[]'::jsonb,
  activity_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT schedule_cpm_templates_name_not_blank CHECK (length(trim(name)) > 0),
  CONSTRAINT schedule_cpm_templates_activity_count_check CHECK (activity_count >= 0),
  CONSTRAINT schedule_cpm_templates_activities_array_check CHECK (jsonb_typeof(activities) = 'array'),
  CONSTRAINT schedule_cpm_templates_wbs_sections_array_check CHECK (jsonb_typeof(wbs_sections) = 'array')
);

CREATE INDEX IF NOT EXISTS schedule_cpm_templates_project_updated_idx
  ON public.schedule_cpm_templates(project_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_cpm_templates TO authenticated;
GRANT ALL ON public.schedule_cpm_templates TO service_role;

ALTER TABLE public.schedule_cpm_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS schedule_cpm_templates_team_select ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_select ON public.schedule_cpm_templates
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS schedule_cpm_templates_team_insert ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_insert ON public.schedule_cpm_templates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_cpm_templates_team_update ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_update ON public.schedule_cpm_templates
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS schedule_cpm_templates_team_delete ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_delete ON public.schedule_cpm_templates
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS schedule_cpm_templates_updated_at ON public.schedule_cpm_templates;
CREATE TRIGGER schedule_cpm_templates_updated_at
  BEFORE UPDATE ON public.schedule_cpm_templates
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
