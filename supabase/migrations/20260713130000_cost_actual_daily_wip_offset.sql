-- Per-line "settles daily WIP" offset so a recorded cost DISPLACES the daily-WIP
-- it covers instead of double-counting it in the bucket actual. Existing rows
-- default to 0 (no-op -> old additive behavior preserved). Non-negative.
ALTER TABLE public.cost_actuals
  ADD COLUMN IF NOT EXISTS daily_wip_offset numeric NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.cost_actuals
    ADD CONSTRAINT cost_actuals_daily_wip_offset_check CHECK (daily_wip_offset >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
NOTIFY pgrst, 'reload schema';
