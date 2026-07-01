-- Repair migration for Lovable environments that have the base WBS table
-- but did not apply the nested parent/child WBS upgrade.
ALTER TABLE public.schedule_wbs_sections
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.schedule_wbs_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';

ALTER TABLE public.schedule_activities
  ADD COLUMN IF NOT EXISTS wbs_section_id uuid REFERENCES public.schedule_wbs_sections(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'schedule_wbs_sections_parent_not_self'
  ) THEN
    ALTER TABLE public.schedule_wbs_sections
      ADD CONSTRAINT schedule_wbs_sections_parent_not_self
      CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

DROP INDEX IF EXISTS public.schedule_wbs_sections_project_name_unique_idx;

CREATE UNIQUE INDEX IF NOT EXISTS schedule_wbs_sections_project_parent_name_unique_idx
  ON public.schedule_wbs_sections (
    project_id,
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name)
  );

CREATE INDEX IF NOT EXISTS schedule_wbs_sections_project_parent_sort_idx
  ON public.schedule_wbs_sections(project_id, parent_id, sort_order, name);

CREATE INDEX IF NOT EXISTS schedule_activities_wbs_section_idx
  ON public.schedule_activities(project_id, wbs_section_id);

CREATE OR REPLACE FUNCTION public.reorder_schedule_wbs_sections(
  p_project_id uuid,
  p_parent_id uuid,
  p_ordered_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_expected integer := cardinality(p_ordered_ids);
  v_matched integer := 0;
  v_changed integer := 0;
BEGIN
  IF p_project_id IS NULL THEN
    RAISE EXCEPTION 'Project is required.';
  END IF;

  IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN
    RETURN 0;
  END IF;

  IF NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project schedule.';
  END IF;

  SELECT count(*)
    INTO v_matched
  FROM public.schedule_wbs_sections section
  WHERE section.project_id = p_project_id
    AND section.id = ANY(p_ordered_ids)
    AND section.parent_id IS NOT DISTINCT FROM p_parent_id;

  IF v_matched <> v_expected THEN
    RAISE EXCEPTION 'WBS order can only be saved for sections under the same parent.';
  END IF;

  WITH ordered AS (
    SELECT
      item.id,
      (item.ordinality::integer * 10) AS sort_order
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS item(id, ordinality)
  ),
  updated AS (
    UPDATE public.schedule_wbs_sections section
    SET sort_order = ordered.sort_order
    FROM ordered
    WHERE section.project_id = p_project_id
      AND section.id = ordered.id
      AND section.parent_id IS NOT DISTINCT FROM p_parent_id
      AND section.sort_order IS DISTINCT FROM ordered.sort_order
    RETURNING section.id
  )
  SELECT count(*) INTO v_changed FROM updated;

  RETURN v_changed;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reorder_schedule_wbs_sections(uuid, uuid, uuid[]) TO authenticated;

-- Also repair the CPM template library in Lovable environments where the
-- original template migration did not reach the live database.
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
