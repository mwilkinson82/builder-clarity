-- TRANSMITTAL REGISTER (docs/compliance arc). Until now a Letter of Transmittal
-- was generate-and-download only — nothing was recorded. This gives every
-- generated cover letter a durable record + an authoritative per-project
-- transmittal number + a browsable log. One row per generated transmittal;
-- `kind` splits the RFI cover letters from the submittal ones (plain text CHECK,
-- not an enum — no cast trap). The generated PDF lives in the shared
-- 'project-docs' bucket (storage_path) so the log can re-download it. Team RLS
-- mirrors submittal_log_entries EXACTLY. Persistence is best-effort additive:
-- the existing PDF generation keeps working whether or not this table exists.
-- Idempotent + portable; migration desk applies this. Backfill: none.

CREATE TABLE IF NOT EXISTS public.transmittals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'submittal' CHECK (kind IN ('rfi','submittal')),
  number text NOT NULL DEFAULT '',
  to_party text NOT NULL DEFAULT '',
  attn text NOT NULL DEFAULT '',
  re text NOT NULL DEFAULT '',
  sent_by text NOT NULL DEFAULT '',
  sent_at date,
  entry_ids uuid[] NOT NULL DEFAULT '{}',
  storage_path text NOT NULL DEFAULT '',
  file_name text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS transmittals_project_kind_idx
  ON public.transmittals(project_id, kind, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.transmittals TO authenticated;
GRANT ALL ON public.transmittals TO service_role;

ALTER TABLE public.transmittals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS transmittals_select ON public.transmittals;
CREATE POLICY transmittals_select ON public.transmittals
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS transmittals_insert ON public.transmittals;
CREATE POLICY transmittals_insert ON public.transmittals
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS transmittals_update ON public.transmittals;
CREATE POLICY transmittals_update ON public.transmittals
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS transmittals_delete ON public.transmittals;
CREATE POLICY transmittals_delete ON public.transmittals
  FOR DELETE USING (public.can_manage_project(project_id));

NOTIFY pgrst, 'reload schema';
