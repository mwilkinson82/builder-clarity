-- Daily WIP — percent complete on a work line.
--
-- Founder intent: the superintendent logs a % complete for the activity in the
-- daily log (field data — the CPM schedule is a laggard, so this is the PM's
-- ammunition to update it later). It extracts into the Daily WIP like the other
-- physical fields, and the PM can adjust it there. One number per work line,
-- 0–100.
--
-- Portable + additive: defaults to 0, so every existing row keeps working.

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS percent_complete numeric NOT NULL DEFAULT 0
    CONSTRAINT daily_wip_percent_complete_check CHECK (percent_complete >= 0 AND percent_complete <= 100);

COMMENT ON COLUMN public.daily_wip_entries.percent_complete IS
  'Field-reported percent complete (0–100) for this work line, entered by the super in the daily log.';
