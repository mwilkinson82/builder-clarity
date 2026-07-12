-- IOR report PDF delivery (Option A: signed-URL download link in the client email).
-- Adds a stamp on the review row (which PDF was sent, when) and a new PRIVATE
-- 'ior-reports' storage bucket that mirrors the existing 'daily-reports' bucket,
-- scoped owner-via-project by the first path segment (= project_id).
-- Reviews already carry RLS (reviews_owner_via_project) — no new table policy needed.

-- 1. Review stamp columns (idempotent; safe to replay)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS pdf_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

-- 2. Private 'ior-reports' bucket (mirror of the 'daily-reports' bucket block)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ior-reports',
  'ior-reports',
  false,
  26214400,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = 26214400,
  allowed_mime_types = ARRAY['application/pdf']::text[];

-- 3. storage.objects policies for bucket_id='ior-reports'
--    (owner-via-project, scoped by first path segment = project_id) —
--    copied verbatim in predicate style from the daily-reports storage policies.

DROP POLICY IF EXISTS ior_reports_storage_read ON storage.objects;
CREATE POLICY ior_reports_storage_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ior_reports_storage_insert ON storage.objects;
CREATE POLICY ior_reports_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ior-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ior_reports_storage_update ON storage.objects;
CREATE POLICY ior_reports_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'ior-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ior_reports_storage_delete ON storage.objects;
CREATE POLICY ior_reports_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id::text = (storage.foldername(name))[1]
        AND p.owner_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
