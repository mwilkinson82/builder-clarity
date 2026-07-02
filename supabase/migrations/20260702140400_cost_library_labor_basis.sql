-- cost_library_items.labor_basis: says what labor_cost_cents means so pricing
-- pulls can convert correctly instead of guessing.
--
--   per_unit  - labor_cost_cents is labor per takeoff unit (the current
--               implied meaning, hence the default)
--   per_hour  - labor_cost_cents is a crew-hour rate; pairs with crew_size
--               and productivity_per_hour to derive a per-unit cost
--   installed - material + labor combined per unit; material_cost_cents
--               must be 0 for these rows

ALTER TABLE public.cost_library_items
  ADD COLUMN IF NOT EXISTS labor_basis varchar(24) NOT NULL DEFAULT 'per_unit';

ALTER TABLE public.cost_library_items
  DROP CONSTRAINT IF EXISTS cost_library_items_labor_basis_check;
ALTER TABLE public.cost_library_items
  ADD CONSTRAINT cost_library_items_labor_basis_check
  CHECK (labor_basis IN ('per_unit', 'per_hour', 'installed'));
