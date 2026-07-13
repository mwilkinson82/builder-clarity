ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS unmatched_vendor_name text NOT NULL DEFAULT '';

UPDATE public.daily_wip_entries
  SET unmatched_vendor_name = ''
  WHERE unmatched_vendor_name IS NULL;

ALTER TABLE public.daily_wip_entries
  DROP CONSTRAINT IF EXISTS daily_wip_entries_performed_by_check;

ALTER TABLE public.daily_wip_entries
  ADD CONSTRAINT daily_wip_entries_performed_by_check
  CHECK (
    char_length(btrim(unmatched_vendor_name)) <= 200
    AND NOT (
      subcontractor_id IS NOT NULL
      AND btrim(unmatched_vendor_name) <> ''
    )
  );