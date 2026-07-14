-- Material procurement approval gates.
--
-- Residential packages continue to clear through an owner/client decision.
-- Commercial and public-works packages may instead link to the existing RFI /
-- submittal log. Approved (A), approved-as-noted (AAN), and answered records
-- clear the package for procurement; open/under-review records hold it; RAR
-- returns it for revision. Existing selections remain owner-selection gates.

ALTER TABLE public.project_selections
  ADD COLUMN IF NOT EXISTS approval_gate_type text NOT NULL DEFAULT 'owner_selection',
  ADD COLUMN IF NOT EXISTS approval_gate_entry_id uuid,
  ADD COLUMN IF NOT EXISTS approval_gate_override_acknowledged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approval_gate_override_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approval_gate_overridden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_gate_overridden_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_selections_approval_gate_type_check'
      AND conrelid = 'public.project_selections'::regclass
  ) THEN
    ALTER TABLE public.project_selections
      ADD CONSTRAINT project_selections_approval_gate_type_check
      CHECK (approval_gate_type IN ('owner_selection', 'submittal', 'rfi'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_selections_gate_override_reason_check'
      AND conrelid = 'public.project_selections'::regclass
  ) THEN
    ALTER TABLE public.project_selections
      ADD CONSTRAINT project_selections_gate_override_reason_check
      CHECK (
        approval_gate_override_acknowledged = false
        OR length(btrim(approval_gate_override_reason)) >= 10
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_selections_approval_gate_entry_id_fkey'
      AND conrelid = 'public.project_selections'::regclass
  ) THEN
    ALTER TABLE public.project_selections
      ADD CONSTRAINT project_selections_approval_gate_entry_id_fkey
      FOREIGN KEY (approval_gate_entry_id)
      REFERENCES public.submittal_log_entries(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_selections_approval_gate_entry_idx
  ON public.project_selections(approval_gate_entry_id)
  WHERE approval_gate_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_material_package_procurement_gate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.procurement_status <> 'not_released'
     AND OLD.procurement_status = 'not_released'
     AND NEW.decision_status <> 'approved' THEN
    RAISE EXCEPTION 'Material package cannot enter procurement until its approval gate has cleared.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_selections_enforce_procurement_gate
  ON public.project_selections;
CREATE TRIGGER project_selections_enforce_procurement_gate
  BEFORE UPDATE OF procurement_status ON public.project_selections
  FOR EACH ROW EXECUTE FUNCTION public.enforce_material_package_procurement_gate();

CREATE OR REPLACE FUNCTION public.sync_material_package_approval_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.project_selections
  SET decision_status = CASE
        WHEN NEW.status IN ('a', 'aan') THEN 'approved'
        WHEN NEW.status = 'rar' THEN 'revision_requested'
        ELSE 'sent'
      END,
      approved_at = CASE
        WHEN NEW.status IN ('a', 'aan') THEN coalesce(approved_at, now())
        ELSE NULL
      END,
      client_visible = false,
      client_decided_at = NULL,
      updated_at = now()
  WHERE approval_gate_entry_id = NEW.id
    AND approval_gate_type = NEW.kind
    AND approval_gate_override_acknowledged = false;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS submittal_log_sync_material_package_gate
  ON public.submittal_log_entries;
CREATE TRIGGER submittal_log_sync_material_package_gate
  AFTER INSERT OR UPDATE OF status ON public.submittal_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_material_package_approval_gate();

REVOKE ALL ON FUNCTION public.sync_material_package_approval_gate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_material_package_approval_gate() TO service_role;

NOTIFY pgrst, 'reload schema';
