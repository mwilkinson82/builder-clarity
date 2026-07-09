-- RFI & SUBMITTALS LOG (docs/compliance arc, module 3). Two Excel-style logs —
-- one for RFIs, one for submittals — sharing one table via `kind`. Columns match
-- how GCs already run these in Excel: number, spec section, sub/rev, item,
-- description, manufacturer/supplier, date submitted, date returned, status, and
-- comments. Status ladder: A (Approved) / AAN (Approved As Noted) / RAR (Revise &
-- Resubmit) / UR (Under Review). Attached PDFs live in the shared 'project-docs'
-- bucket. Team RLS. Idempotent + portable; migration desk applies this.

CREATE TABLE IF NOT EXISTS public.submittal_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'submittal' CHECK (kind IN ('rfi', 'submittal')),
  number text NOT NULL DEFAULT '',
  spec_section text NOT NULL DEFAULT '',
  sub_rev text NOT NULL DEFAULT '',
  item text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  mfgr_supplier text NOT NULL DEFAULT '',
  date_submitted date,
  date_returned date,
  -- '' = not yet returned / no action. Otherwise the reviewer's action.
  status text NOT NULL DEFAULT '' CHECK (status IN ('', 'a', 'aan', 'rar', 'ur')),
  comments text NOT NULL DEFAULT '',
  storage_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS submittal_log_entries_project_kind_idx
  ON public.submittal_log_entries(project_id, kind, sort_order);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.submittal_log_entries TO authenticated;
GRANT ALL ON public.submittal_log_entries TO service_role;

ALTER TABLE public.submittal_log_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS submittal_log_entries_select ON public.submittal_log_entries;
CREATE POLICY submittal_log_entries_select ON public.submittal_log_entries
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS submittal_log_entries_insert ON public.submittal_log_entries;
CREATE POLICY submittal_log_entries_insert ON public.submittal_log_entries
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS submittal_log_entries_update ON public.submittal_log_entries;
CREATE POLICY submittal_log_entries_update ON public.submittal_log_entries
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS submittal_log_entries_delete ON public.submittal_log_entries;
CREATE POLICY submittal_log_entries_delete ON public.submittal_log_entries
  FOR DELETE USING (public.can_manage_project(project_id));
