-- CLAIM DOCUMENTS (Claims/CO/Risk arc — slice 4).
--
-- A claim carries paper: the claim package itself plus supporting docs
-- (schedule analysis, cost backup, correspondence). project_claim_documents is
-- that attachment list — a flat set per claim (NOT versioned like subcontract
-- contracts; every attachment stands on its own). doc_type tags what each file
-- is (the claim vs supporting vs correspondence).
--
-- Bytes live in a private 'claim-docs' storage bucket; the row records the
-- storage_path + display name. Path = <projectId>/<claimId>/<file> so the same
-- team storage RLS (keyed on the first folder segment = project id) applies,
-- exactly like 'subcontract-docs'.
--
-- Team RLS mirrors project_claims; ON DELETE CASCADE from the claim.
--
-- Idempotent + portable. Migration desk applies this.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.project_claim_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES public.project_claims(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  doc_type text NOT NULL DEFAULT 'supporting',
  note text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_claim_documents
  ADD COLUMN IF NOT EXISTS doc_type text NOT NULL DEFAULT 'supporting',
  ADD COLUMN IF NOT EXISTS note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  ALTER TABLE public.project_claim_documents
    ADD CONSTRAINT project_claim_documents_type_check
    CHECK (doc_type IN ('claim', 'supporting', 'correspondence', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS project_claim_documents_claim_idx
  ON public.project_claim_documents(claim_id);
CREATE INDEX IF NOT EXISTS project_claim_documents_project_idx
  ON public.project_claim_documents(project_id);

ALTER TABLE public.project_claim_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_claim_documents_team_select ON public.project_claim_documents;
CREATE POLICY project_claim_documents_team_select ON public.project_claim_documents
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS project_claim_documents_team_insert ON public.project_claim_documents;
CREATE POLICY project_claim_documents_team_insert ON public.project_claim_documents
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claim_documents_team_update ON public.project_claim_documents;
CREATE POLICY project_claim_documents_team_update ON public.project_claim_documents
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS project_claim_documents_team_delete ON public.project_claim_documents;
CREATE POLICY project_claim_documents_team_delete ON public.project_claim_documents
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_claim_documents TO authenticated;
GRANT ALL ON public.project_claim_documents TO service_role;

-- Private bucket for the bytes. Same shape as 'subcontract-docs'.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'claim-docs',
  'claim-docs',
  false,
  26214400,
  ARRAY['application/pdf','image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Team-based storage access: the first folder segment of the object name is the
-- project id (path = <projectId>/<claimId>/<file>). Anyone who can_read_project
-- may view; anyone who can_manage_project may upload/replace/remove. Same helpers
-- as the table policies, matching 'subcontract-docs'.
DROP POLICY IF EXISTS claim_docs_storage_read ON storage.objects;
CREATE POLICY claim_docs_storage_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'claim-docs'
    AND public.can_read_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS claim_docs_storage_insert ON storage.objects;
CREATE POLICY claim_docs_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'claim-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS claim_docs_storage_update ON storage.objects;
CREATE POLICY claim_docs_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'claim-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'claim-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS claim_docs_storage_delete ON storage.objects;
CREATE POLICY claim_docs_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'claim-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

NOTIFY pgrst, 'reload schema';
