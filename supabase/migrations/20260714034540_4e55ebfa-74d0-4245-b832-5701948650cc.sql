-- Procurement-path bifurcation for residential, commercial, and public-work
-- material packages. The existing approval_gate_type remains the package-level
-- path. RFI-directed packages can now record what the answer authorizes and,
-- when required, chain to a follow-on submittal or client selection.

ALTER TABLE public.project_selections
  ADD COLUMN IF NOT EXISTS rfi_outcome text,
  ADD COLUMN IF NOT EXISTS follow_on_approval_gate_entry_id uuid,
  ADD COLUMN IF NOT EXISTS approving_party text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS spec_section text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS responsible_party text NOT NULL DEFAULT '';

ALTER TABLE public.project_selections
  ADD COLUMN IF NOT EXISTS rfi_response_days integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS follow_on_approval_due_date date;

ALTER TABLE public.project_selections
  DROP CONSTRAINT IF EXISTS project_selections_rfi_response_days_check;
ALTER TABLE public.project_selections
  ADD CONSTRAINT project_selections_rfi_response_days_check
  CHECK (rfi_response_days >= 0 AND rfi_response_days <= 365);

ALTER TABLE public.project_selections
  DROP CONSTRAINT IF EXISTS project_selections_rfi_outcome_check;
ALTER TABLE public.project_selections
  ADD CONSTRAINT project_selections_rfi_outcome_check
  CHECK (
    rfi_outcome IS NULL
    OR rfi_outcome IN (
      'direct_release',
      'requires_submittal',
      'requires_client_selection',
      'no_procurement'
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_selections_follow_on_gate_entry_id_fkey'
      AND conrelid = 'public.project_selections'::regclass
  ) THEN
    ALTER TABLE public.project_selections
      ADD CONSTRAINT project_selections_follow_on_gate_entry_id_fkey
      FOREIGN KEY (follow_on_approval_gate_entry_id)
      REFERENCES public.submittal_log_entries(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS project_selections_follow_on_gate_entry_idx
  ON public.project_selections(follow_on_approval_gate_entry_id)
  WHERE follow_on_approval_gate_entry_id IS NOT NULL;

ALTER TABLE public.project_selections
  DROP CONSTRAINT IF EXISTS project_selections_procurement_status_check;
ALTER TABLE public.project_selections
  ADD CONSTRAINT project_selections_procurement_status_check
  CHECK (
    procurement_status IN (
      'not_released',
      'ordered',
      'shipped',
      'received',
      'installed',
      'not_required'
    )
  );

CREATE OR REPLACE FUNCTION public.sync_material_package_approval_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.project_selections AS package
  SET decision_status = CASE
        WHEN package.approval_gate_override_acknowledged THEN 'approved'
        WHEN package.approval_gate_type = 'submittal' THEN
          CASE
            WHEN NEW.status IN ('a', 'aan') THEN 'approved'
            WHEN NEW.status = 'rar' THEN 'revision_requested'
            ELSE 'sent'
          END
        WHEN package.approval_gate_type = 'rfi'
          AND package.approval_gate_entry_id = NEW.id THEN
          CASE
            WHEN NEW.status = 'rar' THEN 'revision_requested'
            WHEN NEW.status NOT IN ('a', 'aan') THEN 'sent'
            WHEN package.rfi_outcome = 'requires_submittal' THEN
              CASE (
                SELECT follow_on.status
                FROM public.submittal_log_entries AS follow_on
                WHERE follow_on.id = package.follow_on_approval_gate_entry_id
                  AND follow_on.project_id = package.project_id
                  AND follow_on.kind = 'submittal'
              )
                WHEN 'a' THEN 'approved'
                WHEN 'aan' THEN 'approved'
                WHEN 'rar' THEN 'revision_requested'
                WHEN 'ur' THEN 'sent'
                WHEN 'pending' THEN 'sent'
                ELSE 'draft'
              END
            WHEN package.rfi_outcome = 'requires_client_selection' THEN
              CASE
                WHEN package.decision_status IN ('sent', 'revision_requested', 'approved')
                  THEN package.decision_status
                ELSE 'draft'
              END
            ELSE 'approved'
          END
        WHEN package.approval_gate_type = 'rfi'
          AND package.follow_on_approval_gate_entry_id = NEW.id THEN
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM public.submittal_log_entries AS primary_rfi
              WHERE primary_rfi.id = package.approval_gate_entry_id
                AND primary_rfi.project_id = package.project_id
                AND primary_rfi.kind = 'rfi'
                AND primary_rfi.status IN ('a', 'aan')
            ) THEN
              CASE
                WHEN NEW.status IN ('a', 'aan') THEN 'approved'
                WHEN NEW.status = 'rar' THEN 'revision_requested'
                ELSE 'sent'
              END
            ELSE 'sent'
          END
        ELSE package.decision_status
      END,
      approved_at = CASE
        WHEN package.approval_gate_override_acknowledged THEN package.approved_at
        WHEN package.approval_gate_type = 'submittal'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan') THEN coalesce(package.approved_at, now())
        WHEN package.approval_gate_type = 'rfi'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan')
          AND package.rfi_outcome IN ('direct_release', 'no_procurement')
          THEN coalesce(package.approved_at, now())
        WHEN package.approval_gate_type = 'rfi'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan')
          AND package.rfi_outcome = 'requires_submittal'
          AND EXISTS (
            SELECT 1
            FROM public.submittal_log_entries AS follow_on
            WHERE follow_on.id = package.follow_on_approval_gate_entry_id
              AND follow_on.project_id = package.project_id
              AND follow_on.kind = 'submittal'
              AND follow_on.status IN ('a', 'aan')
          ) THEN coalesce(package.approved_at, now())
        WHEN package.approval_gate_type = 'rfi'
          AND package.follow_on_approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan') THEN coalesce(package.approved_at, now())
        ELSE NULL
      END,
      procurement_status = CASE
        WHEN package.approval_gate_type = 'rfi'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan')
          AND package.rfi_outcome = 'no_procurement' THEN 'not_required'
        WHEN package.procurement_status = 'not_required'
          AND NOT (
            package.approval_gate_type = 'rfi'
            AND package.rfi_outcome = 'no_procurement'
            AND NEW.status IN ('a', 'aan')
          ) THEN 'not_released'
        ELSE package.procurement_status
      END,
      client_visible = CASE
        WHEN package.approval_gate_type = 'rfi'
          AND package.rfi_outcome = 'requires_client_selection'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan') THEN package.client_visible
        ELSE false
      END,
      client_decided_at = CASE
        WHEN package.approval_gate_type = 'rfi'
          AND package.rfi_outcome = 'requires_client_selection'
          AND package.approval_gate_entry_id = NEW.id
          AND NEW.status IN ('a', 'aan') THEN package.client_decided_at
        ELSE NULL
      END,
      updated_at = now()
  WHERE package.approval_gate_override_acknowledged = false
    AND (
      (package.approval_gate_entry_id = NEW.id AND package.approval_gate_type = NEW.kind)
      OR (
        package.follow_on_approval_gate_entry_id = NEW.id
        AND package.approval_gate_type = 'rfi'
        AND package.rfi_outcome = 'requires_submittal'
        AND NEW.kind = 'submittal'
      )
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_material_package_approval_gate()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_material_package_approval_gate() TO service_role;

NOTIFY pgrst, 'reload schema';