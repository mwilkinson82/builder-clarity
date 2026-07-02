-- Quantity provenance on estimate lines: record where a quantity came from so
-- takeoff syncs never silently clobber a hand-typed number.
--
--   quantity_source   - 'manual' (typed in the grid) or 'takeoff' (synced
--                       from Plan Room measurements)
--   takeoff_quantity  - last synced takeoff rollup, waste applied
--   takeoff_synced_at - when that rollup was written

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS quantity_source varchar(16) NOT NULL DEFAULT 'manual';

ALTER TABLE public.estimate_line_items
  DROP CONSTRAINT IF EXISTS estimate_line_items_quantity_source_check;
ALTER TABLE public.estimate_line_items
  ADD CONSTRAINT estimate_line_items_quantity_source_check
  CHECK (quantity_source IN ('manual', 'takeoff'));

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS takeoff_quantity numeric(14,4);

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS takeoff_synced_at timestamptz;
