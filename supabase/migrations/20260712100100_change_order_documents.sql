-- CHANGE ORDER DOCUMENTS (CO enhancements).
--
-- A change order carries paper: the proposal/quote, cost backup, and
-- correspondence with the owner. change_order_documents is that attachment list
-- — a flat set per change order (NOT versioned; every attachment stands on its
-- own). doc_type tags what each file is (backup vs. quote vs. correspondence).
--
-- Bytes live in a private 'co-docs' storage bucket; the row records the
-- storage_path + display name. Path = <projectId>/<changeOrderId>/<file> so the
-- same team storage RLS (keyed on the first folder segment = project id)
-- applies, exactly like 'claim-docs'.
--
-- Team RLS mirrors change_orders' project team access; ON DELETE CASCADE from
-- the change order.
--
-- Idempotent + portable. Migration desk applies this.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.change_order_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  change_order_id uuid NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  doc_type text NOT NULL DEFAULT 'backup',
  note text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE public.change_order_documents
    ADD CONSTRAINT change_order_documents_type_check
    CHECK (doc_type IN ('backup', 'quote', 'correspondence', 'other'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS change_order_documents_change_order_idx
  ON public.change_order_documents(change_order_id);
CREATE INDEX IF NOT EXISTS change_order_documents_project_idx
  ON public.change_order_documents(project_id);

ALTER TABLE public.change_order_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS change_order_documents_team_select ON public.change_order_documents;
CREATE POLICY change_order_documents_team_select ON public.change_order_documents
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS change_order_documents_team_insert ON public.change_order_documents;
CREATE POLICY change_order_documents_team_insert ON public.change_order_documents
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS change_order_documents_team_update ON public.change_order_documents;
CREATE POLICY change_order_documents_team_update ON public.change_order_documents
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS change_order_documents_team_delete ON public.change_order_documents;
CREATE POLICY change_order_documents_team_delete ON public.change_order_documents
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_order_documents TO authenticated;
GRANT ALL ON public.change_order_documents TO service_role;

-- Private bucket for the bytes. Same shape as 'claim-docs'.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'co-docs',
  'co-docs',
  false,
  26214400,
  ARRAY['application/pdf','image/png','image/jpeg','image/webp']::text[]
)
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Team-based storage access: the first folder segment of the object name is the
-- project id (path = <projectId>/<changeOrderId>/<file>). Anyone who
-- can_read_project may view; anyone who can_manage_project may upload/replace/
-- remove. Same helpers as the table policies, matching 'claim-docs'.
DROP POLICY IF EXISTS co_docs_storage_read ON storage.objects;
CREATE POLICY co_docs_storage_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'co-docs'
    AND public.can_read_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS co_docs_storage_insert ON storage.objects;
CREATE POLICY co_docs_storage_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'co-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS co_docs_storage_update ON storage.objects;
CREATE POLICY co_docs_storage_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'co-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  )
  WITH CHECK (
    bucket_id = 'co-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );
DROP POLICY IF EXISTS co_docs_storage_delete ON storage.objects;
CREATE POLICY co_docs_storage_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'co-docs'
    AND public.can_manage_project((storage.foldername(name))[1]::uuid)
  );

NOTIFY pgrst, 'reload schema';
