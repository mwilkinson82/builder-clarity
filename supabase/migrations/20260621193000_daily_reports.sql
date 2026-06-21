CREATE TABLE IF NOT EXISTS public.daily_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  report_date date NOT NULL DEFAULT current_date,
  author text NOT NULL DEFAULT '',
  weather text NOT NULL DEFAULT '',
  crew_count integer NOT NULL DEFAULT 0 CHECK (crew_count >= 0),
  work_performed text NOT NULL DEFAULT '',
  delays text NOT NULL DEFAULT '',
  safety_notes text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  attachment_name text NOT NULL DEFAULT '',
  attachment_path text NOT NULL DEFAULT '',
  attachment_type text NOT NULL DEFAULT '',
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, report_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_reports TO authenticated;
GRANT ALL ON public.daily_reports TO service_role;

ALTER TABLE public.daily_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_reports_owner_via_project ON public.daily_reports;
CREATE POLICY daily_reports_owner_via_project
  ON public.daily_reports
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = daily_reports.project_id
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = daily_reports.project_id
        AND p.owner_id = auth.uid()
    )
  );

DROP TRIGGER IF EXISTS daily_reports_set_updated_at ON public.daily_reports;
CREATE TRIGGER daily_reports_set_updated_at
  BEFORE UPDATE ON public.daily_reports
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE INDEX IF NOT EXISTS daily_reports_project_date_idx
  ON public.daily_reports(project_id, report_date DESC);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'daily-reports',
  'daily-reports',
  false,
  26214400,
  ARRAY['application/pdf','image/png','image/jpeg','image/webp','image/heic']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY['application/pdf','image/png','image/jpeg','image/webp','image/heic']::text[];

DROP POLICY IF EXISTS daily_reports_storage_read ON storage.objects;
CREATE POLICY daily_reports_storage_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS daily_reports_storage_insert ON storage.objects;
CREATE POLICY daily_reports_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS daily_reports_storage_update ON storage.objects;
CREATE POLICY daily_reports_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS daily_reports_storage_delete ON storage.objects;
CREATE POLICY daily_reports_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );
