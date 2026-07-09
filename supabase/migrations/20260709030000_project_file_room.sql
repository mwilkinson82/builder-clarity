-- PROJECTFILEROOM1 — the project file room.
--
-- Every job accumulates paper that today has nowhere to live: the prime contract,
-- specifications, drawings, QC/QA docs, supplier invoices, receipts. This is the
-- single project-scoped document library — upload, categorize, find, review. It
-- generalizes the per-sub contract store (subcontract_documents) into one home
-- for the whole job.
--
-- Storage mirrors 'subcontract-docs': a private bucket, files at
-- <projectId>/<file>, team-based storage RLS keyed on the first path segment.
-- Idempotent + portable; the migration desk applies this.

CREATE TABLE IF NOT EXISTS public.project_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- One of: prime_contract | specifications | drawings | qc_qa | invoices |
  -- receipts | other. Kept as free text (not an enum) so categories can grow
  -- without a migration; the app supplies the vocabulary.
  category text NOT NULL DEFAULT 'other',
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  storage_path text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  size_bytes bigint NOT NULL DEFAULT 0,
  uploaded_by uuid,
  -- Soft delete: a removed document is kept (archived) so the paper trail is not
  -- silently lost; the app filters archived rows out of the room.
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_documents_project_idx
  ON public.project_documents(project_id, category);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_documents TO authenticated;
GRANT ALL ON public.project_documents TO service_role;

ALTER TABLE public.project_documents ENABLE ROW LEVEL SECURITY;

-- Team-based, matching subcontract_documents: read for anyone who can read the
-- project, manage for anyone who can manage it.
DROP POLICY IF EXISTS project_documents_select ON public.project_documents;
CREATE POLICY project_documents_select ON public.project_documents
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS project_documents_insert ON public.project_documents;
CREATE POLICY project_documents_insert ON public.project_documents
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS project_documents_update ON public.project_documents;
CREATE POLICY project_documents_update ON public.project_documents
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS project_documents_delete ON public.project_documents;
CREATE POLICY project_documents_delete ON public.project_documents
  FOR DELETE USING (public.can_manage_project(project_id));

-- Private bucket for the file room. allowed_mime_types is NULL (unrestricted) —
-- a general file room takes PDFs, images, office docs, CAD, anything the job
-- produces. 100 MB cap covers large drawing sets.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('project-docs', 'project-docs', false, 104857600, NULL)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Team storage RLS: the first folder segment of the object name is the project id
-- (path = <projectId>/<file>). Same can_* helpers as the table + subcontract-docs.
DROP POLICY IF EXISTS project_docs_storage_read ON storage.objects;
CREATE POLICY project_docs_storage_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'project-docs'
    AND public.can_read_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS project_docs_storage_insert ON storage.objects;
CREATE POLICY project_docs_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'project-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS project_docs_storage_update ON storage.objects;
CREATE POLICY project_docs_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'project-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'project-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS project_docs_storage_delete ON storage.objects;
CREATE POLICY project_docs_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'project-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
