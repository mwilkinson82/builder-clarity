-- AI provenance on takeoff measurements (AITAKEOFF1 Task 2).
-- Accepted AI proposals become ordinary count markers, but the measurement
-- row remembers it was AI-assisted so the worksheet and inspector can show
-- the provenance chip. Human-placed takeoffs stay false.

ALTER TABLE public.estimate_takeoff_measurements
  ADD COLUMN IF NOT EXISTS created_by_ai boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.estimate_takeoff_measurements.created_by_ai IS
  'True when the marker was created by accepting an AI count proposal. The human accepted every point; the model only suggested locations.';
