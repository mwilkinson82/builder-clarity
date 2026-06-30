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
