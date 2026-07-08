-- SUBCONTRACTORS Slice 3 — versioned contract documents (paper trail).
--
-- A subcontract's paper isn't one file — it's the original plus amendments and
-- re-negotiated versions over the life of the job. This replaces the single
-- executed_contract_* file on the subcontracts row with a LIST of documents, one
-- of which is flagged active (the current contract). Nothing is overwritten:
-- uploading an amendment adds a row and flips the prior to inactive but keeps it,
-- so you can always open what a previous version said. Single-active is enforced
-- in the server fns (add/setActive deactivate the siblings first).
--
-- Storage is unchanged: files still live in the private 'subcontract-docs' bucket
-- (path <projectId>/<subcontractId>/<file>, team-based storage RLS from Slice 2).
-- The legacy executed_contract_* columns on subcontracts are left in place but
-- unused by the UI; any existing file is migrated into this table below.
--
-- Idempotent + portable. Migration desk applies this.

CREATE TABLE IF NOT EXISTS public.subcontract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontract_documents_subcontract_idx
  ON public.subcontract_documents(subcontract_id);
CREATE INDEX IF NOT EXISTS subcontract_documents_project_idx
  ON public.subcontract_documents(project_id);

ALTER TABLE public.subcontract_documents ENABLE ROW LEVEL SECURITY;

-- Team-based, matching the subcontracts row RLS: anyone who can read the project
-- can see the paper trail; anyone who can manage it can add/re-tag/remove.
DROP POLICY IF EXISTS subcontract_documents_select ON public.subcontract_documents;
CREATE POLICY subcontract_documents_select ON public.subcontract_documents
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS subcontract_documents_insert ON public.subcontract_documents;
CREATE POLICY subcontract_documents_insert ON public.subcontract_documents
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_documents_update ON public.subcontract_documents;
CREATE POLICY subcontract_documents_update ON public.subcontract_documents
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_documents_delete ON public.subcontract_documents;
CREATE POLICY subcontract_documents_delete ON public.subcontract_documents
  FOR DELETE USING (public.can_manage_project(project_id));

-- Carry any existing single executed contract into the paper trail as the active
-- version. Guarded so re-running never double-inserts.
INSERT INTO public.subcontract_documents
  (subcontract_id, project_id, storage_path, file_name, uploaded_at, is_active)
SELECT s.id, s.project_id, s.executed_contract_path, s.executed_contract_name,
       COALESCE(s.executed_contract_uploaded_at, now()), true
FROM public.subcontracts s
WHERE s.executed_contract_path <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.subcontract_documents d
    WHERE d.subcontract_id = s.id AND d.storage_path = s.executed_contract_path
  );
