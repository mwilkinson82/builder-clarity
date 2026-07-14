-- Group allocation rows from one supplier invoice into a single cost document,
-- and optionally attribute incurred cost to a project risk/exposure.
--
-- cost_actuals remains the accounting line table: every row still carries one
-- cost code and amount, so existing bucket/WIP triggers and reports are unchanged.

ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS cost_document_id uuid,
  ADD COLUMN IF NOT EXISTS exposure_id uuid;

-- Reunite historical split-entry rows only when they carry strong invoice
-- identity. Shared uploaded files are definitive; a nonblank vendor + invoice
-- reference + date is the conservative fallback. The oldest allocation id is
-- a stable UUID for the document, avoiding an extension dependency.
WITH attachment_groups AS (
  SELECT
    id,
    min(id::text) OVER (
      PARTITION BY project_id, btrim(invoice_attachment_path)
    )::uuid AS document_id
  FROM public.cost_actuals
  WHERE cost_document_id IS NULL
    AND nullif(btrim(invoice_attachment_path), '') IS NOT NULL
)
UPDATE public.cost_actuals AS actual
SET cost_document_id = grouped.document_id
FROM attachment_groups AS grouped
WHERE actual.id = grouped.id;

WITH reference_groups AS (
  SELECT
    id,
    min(id::text) OVER (
      PARTITION BY
        project_id,
        lower(btrim(vendor)),
        lower(btrim(reference_number)),
        cost_date
    )::uuid AS document_id
  FROM public.cost_actuals
  WHERE cost_document_id IS NULL
    AND nullif(btrim(vendor), '') IS NOT NULL
    AND nullif(btrim(reference_number), '') IS NOT NULL
)
UPDATE public.cost_actuals AS actual
SET cost_document_id = grouped.document_id
FROM reference_groups AS grouped
WHERE actual.id = grouped.id;

UPDATE public.cost_actuals
SET cost_document_id = id
WHERE cost_document_id IS NULL;

ALTER TABLE public.cost_actuals
  ALTER COLUMN cost_document_id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN cost_document_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cost_actuals_exposure_id_fkey'
      AND conrelid = 'public.cost_actuals'::regclass
  ) THEN
    ALTER TABLE public.cost_actuals
      ADD CONSTRAINT cost_actuals_exposure_id_fkey
      FOREIGN KEY (exposure_id)
      REFERENCES public.exposures(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS cost_actuals_document_idx
  ON public.cost_actuals (project_id, cost_document_id, cost_date DESC);

CREATE INDEX IF NOT EXISTS cost_actuals_exposure_idx
  ON public.cost_actuals (exposure_id)
  WHERE exposure_id IS NOT NULL;

COMMENT ON COLUMN public.cost_actuals.cost_document_id IS
  'Shared by every cost-code allocation line belonging to one supplier invoice/cost document.';
COMMENT ON COLUMN public.cost_actuals.exposure_id IS
  'Optional risk tally attribution for incurred cost; does not replace cost-code accounting.';

-- The foreign key proves the risk exists; this trigger also proves it belongs
-- to the same project as the cost. SECURITY INVOKER preserves the caller's RLS
-- context, while the server already requires can_manage_project(project_id).
CREATE OR REPLACE FUNCTION public.validate_cost_actual_exposure_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  linked_project_id uuid;
BEGIN
  IF NEW.exposure_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT project_id
    INTO linked_project_id
  FROM public.exposures
  WHERE id = NEW.exposure_id;

  IF NOT FOUND OR linked_project_id <> NEW.project_id THEN
    RAISE EXCEPTION 'The linked risk must belong to the same project as the cost.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_validate_exposure_link ON public.cost_actuals;
CREATE TRIGGER cost_actuals_validate_exposure_link
  BEFORE INSERT OR UPDATE OF project_id, exposure_id
  ON public.cost_actuals
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_cost_actual_exposure_link();

REVOKE ALL ON FUNCTION public.validate_cost_actual_exposure_link() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_cost_actual_exposure_link() TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_cost_actual_exposure_link() TO service_role;
