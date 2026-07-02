-- Scale provenance on plan sheets: says where a sheet's scale came from and
-- whether it has been verified against a known dimension. Half-size prints
-- make every stated scale wrong by 2x, which is exactly what verification
-- catches. The scale storage model (scale_feet_per_pixel per sheet) is
-- unchanged.
--
--   scale_source      - 'unset' (no scale), 'calibrated' (two-point
--                       calibration), or 'stated' (from a stated-scale preset,
--                       untrusted until verified)
--   scale_verified_at - when the user last verified the active scale against
--                       a labeled dimension

ALTER TABLE public.estimate_plan_sheets
  ADD COLUMN IF NOT EXISTS scale_source varchar(16) NOT NULL DEFAULT 'unset';

ALTER TABLE public.estimate_plan_sheets
  DROP CONSTRAINT IF EXISTS estimate_plan_sheets_scale_source_check;
ALTER TABLE public.estimate_plan_sheets
  ADD CONSTRAINT estimate_plan_sheets_scale_source_check
  CHECK (scale_source IN ('unset', 'calibrated', 'stated'));

ALTER TABLE public.estimate_plan_sheets
  ADD COLUMN IF NOT EXISTS scale_verified_at timestamptz;

-- Sheets scaled before this column existed were all two-point calibrations.
UPDATE public.estimate_plan_sheets
SET scale_source = 'calibrated'
WHERE scale_feet_per_pixel > 0
  AND scale_source = 'unset';
