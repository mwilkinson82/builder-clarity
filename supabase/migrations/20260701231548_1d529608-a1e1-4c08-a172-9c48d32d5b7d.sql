-- Nested WBS + wbs_section_id on activities + reorder_schedule_wbs_sections RPC
ALTER TABLE public.schedule_wbs_sections
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.schedule_wbs_sections(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS code text NOT NULL DEFAULT '';

ALTER TABLE public.schedule_activities
  ADD COLUMN IF NOT EXISTS wbs_section_id uuid REFERENCES public.schedule_wbs_sections(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'schedule_wbs_sections_parent_not_self') THEN
    ALTER TABLE public.schedule_wbs_sections
      ADD CONSTRAINT schedule_wbs_sections_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
  END IF;
END $$;

DROP INDEX IF EXISTS public.schedule_wbs_sections_project_name_unique_idx;
CREATE UNIQUE INDEX IF NOT EXISTS schedule_wbs_sections_project_parent_name_unique_idx
  ON public.schedule_wbs_sections (project_id, COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
CREATE INDEX IF NOT EXISTS schedule_wbs_sections_project_parent_sort_idx
  ON public.schedule_wbs_sections(project_id, parent_id, sort_order, name);
CREATE INDEX IF NOT EXISTS schedule_activities_wbs_section_idx
  ON public.schedule_activities(project_id, wbs_section_id);

CREATE OR REPLACE FUNCTION public.reorder_schedule_wbs_sections(p_project_id uuid, p_parent_id uuid, p_ordered_ids uuid[])
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_expected integer := cardinality(p_ordered_ids); v_matched integer := 0; v_changed integer := 0;
BEGIN
  IF p_project_id IS NULL THEN RAISE EXCEPTION 'Project is required.'; END IF;
  IF p_ordered_ids IS NULL OR cardinality(p_ordered_ids) = 0 THEN RETURN 0; END IF;
  IF NOT public.can_manage_project(p_project_id) THEN RAISE EXCEPTION 'You do not have permission to manage this project schedule.'; END IF;
  SELECT count(*) INTO v_matched FROM public.schedule_wbs_sections s
    WHERE s.project_id = p_project_id AND s.id = ANY(p_ordered_ids) AND s.parent_id IS NOT DISTINCT FROM p_parent_id;
  IF v_matched <> v_expected THEN RAISE EXCEPTION 'WBS order can only be saved for sections under the same parent.'; END IF;
  WITH ordered AS (
    SELECT item.id, (item.ordinality::integer * 10) AS sort_order
    FROM unnest(p_ordered_ids) WITH ORDINALITY AS item(id, ordinality)
  ), updated AS (
    UPDATE public.schedule_wbs_sections s SET sort_order = ordered.sort_order
    FROM ordered WHERE s.project_id = p_project_id AND s.id = ordered.id
      AND s.parent_id IS NOT DISTINCT FROM p_parent_id AND s.sort_order IS DISTINCT FROM ordered.sort_order
    RETURNING s.id
  ) SELECT count(*) INTO v_changed FROM updated;
  RETURN v_changed;
END; $$;
GRANT EXECUTE ON FUNCTION public.reorder_schedule_wbs_sections(uuid, uuid, uuid[]) TO authenticated;

-- CPM templates
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
CREATE INDEX IF NOT EXISTS schedule_cpm_templates_project_updated_idx ON public.schedule_cpm_templates(project_id, updated_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_cpm_templates TO authenticated;
GRANT ALL ON public.schedule_cpm_templates TO service_role;
ALTER TABLE public.schedule_cpm_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_cpm_templates_team_select ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_select ON public.schedule_cpm_templates FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_cpm_templates_team_insert ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_insert ON public.schedule_cpm_templates FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_cpm_templates_team_update ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_update ON public.schedule_cpm_templates FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_cpm_templates_team_delete ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_delete ON public.schedule_cpm_templates FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP TRIGGER IF EXISTS schedule_cpm_templates_updated_at ON public.schedule_cpm_templates;
CREATE TRIGGER schedule_cpm_templates_updated_at BEFORE UPDATE ON public.schedule_cpm_templates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Activity status fields
ALTER TABLE public.schedule_activities
  ADD COLUMN IF NOT EXISTS baseline_start_date date,
  ADD COLUMN IF NOT EXISTS baseline_finish_date date,
  ADD COLUMN IF NOT EXISTS forecast_start_date date,
  ADD COLUMN IF NOT EXISTS forecast_finish_date date,
  ADD COLUMN IF NOT EXISTS actual_start_date date,
  ADD COLUMN IF NOT EXISTS actual_finish_date date,
  ADD COLUMN IF NOT EXISTS remaining_duration_days integer;
ALTER TABLE public.schedule_activities DROP CONSTRAINT IF EXISTS schedule_activities_remaining_duration_days_check;
ALTER TABLE public.schedule_activities ADD CONSTRAINT schedule_activities_remaining_duration_days_check
  CHECK (remaining_duration_days IS NULL OR (remaining_duration_days >= 0 AND remaining_duration_days <= 5000));
UPDATE public.schedule_activities SET
  baseline_start_date = COALESCE(baseline_start_date, start_date),
  baseline_finish_date = COALESCE(baseline_finish_date, finish_date),
  forecast_start_date = COALESCE(forecast_start_date, start_date),
  forecast_finish_date = COALESCE(forecast_finish_date, finish_date),
  actual_start_date = CASE WHEN percent_complete > 0 THEN COALESCE(actual_start_date, start_date) ELSE actual_start_date END,
  actual_finish_date = CASE WHEN percent_complete >= 100 THEN COALESCE(actual_finish_date, finish_date) ELSE actual_finish_date END,
  remaining_duration_days = CASE WHEN percent_complete >= 100 THEN COALESCE(remaining_duration_days, 0) ELSE remaining_duration_days END;
CREATE INDEX IF NOT EXISTS schedule_activities_project_forecast_idx ON public.schedule_activities(project_id, forecast_start_date, forecast_finish_date);
CREATE INDEX IF NOT EXISTS schedule_activities_project_status_idx ON public.schedule_activities(project_id, percent_complete, remaining_duration_days);

-- Delay fragments
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
  CONSTRAINT schedule_delay_fragments_source_check CHECK (source IN ('field','trade','owner','design','procurement','weather','other')),
  CONSTRAINT schedule_delay_fragments_status_check CHECK (status IN ('active','mitigated','accepted','recovered'))
);
CREATE INDEX IF NOT EXISTS schedule_delay_fragments_project_status_idx ON public.schedule_delay_fragments(project_id, status, identified_on DESC);
CREATE INDEX IF NOT EXISTS schedule_delay_fragments_project_activity_idx ON public.schedule_delay_fragments(project_id, schedule_activity_id, activity_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_delay_fragments TO authenticated;
GRANT ALL ON public.schedule_delay_fragments TO service_role;
ALTER TABLE public.schedule_delay_fragments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_delay_fragments_team_select ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_select ON public.schedule_delay_fragments FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_delay_fragments_team_insert ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_insert ON public.schedule_delay_fragments FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_delay_fragments_team_update ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_update ON public.schedule_delay_fragments FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_delay_fragments_team_delete ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_delete ON public.schedule_delay_fragments FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP TRIGGER IF EXISTS schedule_delay_fragments_updated_at ON public.schedule_delay_fragments;
CREATE TRIGGER schedule_delay_fragments_updated_at BEFORE UPDATE ON public.schedule_delay_fragments FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Activity update snapshots
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
  CONSTRAINT schedule_activity_updates_percent_check CHECK (percent_complete >= 0 AND percent_complete <= 100),
  CONSTRAINT schedule_activity_updates_duration_check CHECK (planned_duration_days >= 0 AND remaining_duration_days >= 0)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedule_activity_updates TO authenticated;
GRANT ALL ON public.schedule_activity_updates TO service_role;
ALTER TABLE public.schedule_activity_updates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS schedule_activity_updates_team_select ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_select ON public.schedule_activity_updates FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS schedule_activity_updates_team_insert ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_insert ON public.schedule_activity_updates FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_activity_updates_team_update ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_update ON public.schedule_activity_updates FOR UPDATE TO authenticated USING (public.can_manage_project(project_id)) WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS schedule_activity_updates_team_delete ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_delete ON public.schedule_activity_updates FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP TRIGGER IF EXISTS schedule_activity_updates_set_updated_at ON public.schedule_activity_updates;
CREATE TRIGGER schedule_activity_updates_set_updated_at BEFORE UPDATE ON public.schedule_activity_updates FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS schedule_activity_updates_project_update_idx ON public.schedule_activity_updates(project_id, update_number DESC);
CREATE INDEX IF NOT EXISTS schedule_activity_updates_schedule_update_idx ON public.schedule_activity_updates(schedule_update_id);
CREATE INDEX IF NOT EXISTS schedule_activity_updates_activity_idx ON public.schedule_activity_updates(project_id, schedule_activity_id, activity_id);
CREATE INDEX IF NOT EXISTS schedule_activity_updates_data_date_idx ON public.schedule_activity_updates(project_id, data_date DESC);

-- Status basis
ALTER TABLE public.schedule_activity_updates ADD COLUMN IF NOT EXISTS status_basis text NOT NULL DEFAULT 'planned_dates';
ALTER TABLE public.schedule_activity_updates DROP CONSTRAINT IF EXISTS schedule_activity_updates_status_basis_check;
ALTER TABLE public.schedule_activity_updates ADD CONSTRAINT schedule_activity_updates_status_basis_check
  CHECK (status_basis IN ('actual','remaining_duration','expected_finish','planned_dates','needs_update'));
CREATE INDEX IF NOT EXISTS schedule_activity_updates_status_basis_idx ON public.schedule_activity_updates(project_id, status_basis, data_date DESC);

NOTIFY pgrst, 'reload schema';