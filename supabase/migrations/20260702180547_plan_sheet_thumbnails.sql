-- Sheet thumbnails: storage path of a small raster preview per sheet, kept
-- under the plan set's estimate-id folder in the existing plan-room bucket
-- ({estimateId}/{planSetId}/thumbs/{sheetId}.webp) so the bucket's
-- estimate-id path-prefix RLS policies apply unchanged.

ALTER TABLE public.estimate_plan_sheets
  ADD COLUMN IF NOT EXISTS thumbnail_path text NOT NULL DEFAULT '';
