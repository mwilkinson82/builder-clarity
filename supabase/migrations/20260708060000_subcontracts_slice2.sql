-- SUBCONTRACTORS Slice 2 — executed-contract upload + daily-WIP × subs link.
--
--   1. subcontracts gains executed-contract file columns (path/name/uploaded_at)
--      + a private 'subcontract-docs' storage bucket: files live in storage, the
--      row records the path, and access is team-based via the first path segment
--      = project id (can_read/can_manage_project — same model as the row RLS).
--   2. daily_wip_entries gains subcontractor_id so a daily-WIP line can be tagged
--      to a sub (self-perform ↔ sub), for per-sub production/cost data.
--
-- Idempotent + portable. Migration desk applies this.

-- ── 1a. subcontracts: executed-contract file reference ──────────────────────
ALTER TABLE public.subcontracts
  ADD COLUMN IF NOT EXISTS executed_contract_path text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS executed_contract_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS executed_contract_uploaded_at timestamptz;

-- ── 1b. private storage bucket for executed contracts ───────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'subcontract-docs',
  'subcontract-docs',
  false,
  26214400,
  ARRAY['application/pdf','image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Access is TEAM-based, matching the subcontracts row RLS (see 20260708000000):
-- the first folder segment of the object name is the project id
-- (path = <projectId>/<subcontractId>/<file>), and anyone who can_read_project
-- may view while anyone who can_manage_project may upload/replace/remove. This
-- deliberately uses the same can_* helpers as the table policies so a PM with
-- can_manage_project — who can already see and manage the subcontract row — can
-- also open and upload the executed-contract PDF. (An earlier draft gated on
-- projects.owner_id, which would have locked non-owner PMs out of the file.)
DROP POLICY IF EXISTS subcontract_docs_storage_read ON storage.objects;
CREATE POLICY subcontract_docs_storage_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'subcontract-docs'
    AND public.can_read_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS subcontract_docs_storage_insert ON storage.objects;
CREATE POLICY subcontract_docs_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'subcontract-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS subcontract_docs_storage_update ON storage.objects;
CREATE POLICY subcontract_docs_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'subcontract-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'subcontract-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS subcontract_docs_storage_delete ON storage.objects;
CREATE POLICY subcontract_docs_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'subcontract-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

-- ── 2. daily_wip_entries × subcontractor ────────────────────────────────────
ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS subcontractor_id uuid REFERENCES public.subcontractors(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS daily_wip_entries_subcontractor_idx
  ON public.daily_wip_entries(subcontractor_id);
