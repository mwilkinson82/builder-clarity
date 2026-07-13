-- (A) percent_basis: does the line's % complete describe the SOV line or the CPM
--     schedule activity? Stored + displayed LABEL for now (no math change).
-- (B) quantity_items: a repeatable list of installed quantities/counts on one line
--     (e.g. 500 LF conduit, 24 junction boxes). The scalar quantity/unit is kept as
--     the primary/roll-up for the existing productionRate read-out.
ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS percent_basis text NOT NULL DEFAULT 'sov',
  ADD COLUMN IF NOT EXISTS quantity_items jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE public.daily_wip_entries
    ADD CONSTRAINT daily_wip_entries_percent_basis_check CHECK (percent_basis IN ('sov','cpm'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
NOTIFY pgrst, 'reload schema';
