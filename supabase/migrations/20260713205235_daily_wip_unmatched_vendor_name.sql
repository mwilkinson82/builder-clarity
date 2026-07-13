-- Preserve a field-entered vendor name when the superintendent cannot find the
-- company among the subcontractors already bought out on this project. The PM
-- can later replace this text with the canonical subcontractor_id from the
-- project buyout directory; both values must never be set at the same time.
--
-- Idempotent + portable. Lovable or the designated migration runner applies
-- this separately from the application-code deployment.

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS unmatched_vendor_name text NOT NULL DEFAULT '';

-- Make a rerun repair a partially-created column as well as a clean install.
ALTER TABLE public.daily_wip_entries
  ALTER COLUMN unmatched_vendor_name SET DEFAULT '';

UPDATE public.daily_wip_entries
SET unmatched_vendor_name = ''
WHERE unmatched_vendor_name IS NULL;

ALTER TABLE public.daily_wip_entries
  ALTER COLUMN unmatched_vendor_name SET NOT NULL;

ALTER TABLE public.daily_wip_entries
  DROP CONSTRAINT IF EXISTS daily_wip_entries_performed_by_check;

ALTER TABLE public.daily_wip_entries
  ADD CONSTRAINT daily_wip_entries_performed_by_check
  CHECK (
    length(trim(unmatched_vendor_name)) <= 200
    AND NOT (
      subcontractor_id IS NOT NULL
      AND length(trim(unmatched_vendor_name)) > 0
    )
  ) NOT VALID;

ALTER TABLE public.daily_wip_entries
  VALIDATE CONSTRAINT daily_wip_entries_performed_by_check;

COMMENT ON COLUMN public.daily_wip_entries.unmatched_vendor_name IS
  'Field-entered vendor name when no bought-out project subcontractor can be selected; clear when subcontractor_id is assigned.';
