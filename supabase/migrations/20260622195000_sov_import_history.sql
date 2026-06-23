CREATE TABLE IF NOT EXISTS public.sov_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  mode text NOT NULL DEFAULT 'replace' CHECK (mode IN ('replace', 'append')),
  source_type text NOT NULL DEFAULT '',
  source_name text NOT NULL DEFAULT '',
  source_sheet text NOT NULL DEFAULT '',
  profile text NOT NULL DEFAULT '',
  confidence text NOT NULL DEFAULT 'unknown' CHECK (confidence IN ('high', 'medium', 'low', 'unknown')),
  has_header boolean NOT NULL DEFAULT true,
  raw_rows integer NOT NULL DEFAULT 0 CHECK (raw_rows >= 0),
  staged_rows integer NOT NULL DEFAULT 0 CHECK (staged_rows >= 0),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  merged_rows integer NOT NULL DEFAULT 0 CHECK (merged_rows >= 0),
  total_budget numeric NOT NULL DEFAULT 0,
  original_cost_budget numeric NOT NULL DEFAULT 0,
  selected_budget_column integer,
  selected_budget_label text NOT NULL DEFAULT '',
  column_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_choices jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sov_imports_project_created_idx
  ON public.sov_imports(project_id, created_at DESC);

GRANT SELECT, INSERT ON public.sov_imports TO authenticated;
GRANT ALL ON public.sov_imports TO service_role;

ALTER TABLE public.sov_imports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sov_imports_team_select ON public.sov_imports;
CREATE POLICY sov_imports_team_select
  ON public.sov_imports
  FOR SELECT
  TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS sov_imports_team_insert ON public.sov_imports;
CREATE POLICY sov_imports_team_insert
  ON public.sov_imports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_project(project_id)
    AND imported_by = (SELECT auth.uid())
  );

