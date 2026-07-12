-- IOR report PDF delivery (Option A: signed-URL download link in the client email).
-- Adds a stamp on the review row (which PDF was sent, when) and a new PRIVATE
-- 'ior-reports' storage bucket.
--
-- Storage access is TEAM-based (can_read_project / can_manage_project), scoped by
-- the first path segment (= project_id) — the same predicate style as the co-docs
-- / claim-docs buckets. NB: 'daily-reports' can use an owner-only storage policy
-- ONLY because it ALSO has a per-verb team policy that RLS ORs in; this bucket has
-- a single policy per verb, so it MUST be team-based or a non-owner PM with project
-- access is denied on IOR report read + upload.
-- Reviews already carry RLS (reviews_owner_via_project) — no new table policy needed.

-- 1. Review stamp columns (idempotent; safe to replay)
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS pdf_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_sent_at timestamptz;

-- 2. Private 'ior-reports' bucket
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
--    Team-based, scoped by first path segment = project_id (path = <projectId>/<reviewId>/<file>).
--    Read = can_read_project; insert/update/delete = can_manage_project. Same helpers
--    and predicate style as #291's co-docs storage policies.

DROP POLICY IF EXISTS ior_reports_storage_read ON storage.objects;
CREATE POLICY ior_reports_storage_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND public.can_read_project((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS ior_reports_storage_insert ON storage.objects;
CREATE POLICY ior_reports_storage_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'ior-reports'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS ior_reports_storage_update ON storage.objects;
CREATE POLICY ior_reports_storage_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'ior-reports'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

DROP POLICY IF EXISTS ior_reports_storage_delete ON storage.objects;
CREATE POLICY ior_reports_storage_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'ior-reports'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

NOTIFY pgrst, 'reload schema';
