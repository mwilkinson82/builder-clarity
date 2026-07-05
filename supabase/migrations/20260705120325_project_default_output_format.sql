-- GETTINGPAID3 Task 3: per-project default output format.
--
-- A project marked AIA-native births every new pay application as
-- 'aia_g702' instead of 'invoice', so a lender-driven job stops making the
-- biller flip the format on every application (founder friction 2026-07-05).
--
-- Portable: additive column only, IF NOT EXISTS, guarded CHECK. Mirrors the
-- billing_applications.output_format contract so the two never drift.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS default_output_format text NOT NULL DEFAULT 'invoice';

COMMENT ON COLUMN public.projects.default_output_format IS
  'Default output document for new pay applications on this project: invoice (default) or aia_g702 (AIA-native).';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_default_output_format_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_default_output_format_check
      CHECK (default_output_format IN ('invoice', 'aia_g702'));
  END IF;
END $$;
