-- Daily WIP — split the superintendent's field % from the PM's reviewed %.
--
-- Founder model (2026-07-08): percent complete is a physical fact the super logs
-- in the daily log; it flows into the WIP where the PM reviews it and may adjust
-- it (typically capping it for billing reasons). The super's field number must be
-- kept — a historical look-back has to show "field said 30%, PM billed 25%, on
-- this date". So:
--   field_percent_complete  = the super's number, set from the daily log, not
--                             touched by the PM. Immutable field truth.
--   percent_complete        = the PM's reviewed / effective value (already exists;
--                             drives the WIP earned value and, later, billing).
--   percent_overridden_at   = when the PM last set percent_complete to a value
--                             different from the field number (null = never
--                             overridden, or re-aligned back to the field).
--
-- Portable + additive: new columns default so every existing row keeps working,
-- and the backfill seeds field_percent_complete from the value already logged (no
-- override yet — the current number IS the field number).

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS field_percent_complete numeric NOT NULL DEFAULT 0
    CONSTRAINT daily_wip_field_percent_complete_check
    CHECK (field_percent_complete >= 0 AND field_percent_complete <= 100),
  ADD COLUMN IF NOT EXISTS percent_overridden_at timestamptz;

-- Seed the field number from the value already recorded: existing rows carry the
-- super's number in percent_complete, and no PM override has happened yet.
UPDATE public.daily_wip_entries
  SET field_percent_complete = percent_complete
  WHERE field_percent_complete = 0
    AND percent_complete <> 0;

COMMENT ON COLUMN public.daily_wip_entries.field_percent_complete IS
  'The superintendent''s field-reported percent complete (0-100), set from the daily log and not changed by the PM. percent_complete is the PM''s reviewed value; a difference means the PM adjusted it (see percent_overridden_at).';
COMMENT ON COLUMN public.daily_wip_entries.percent_overridden_at IS
  'When the PM last set percent_complete to a value different from field_percent_complete (null = never overridden, or re-aligned to the field number).';
