ALTER TABLE public.subcontract_allocations
  ADD COLUMN IF NOT EXISTS planned_quantity numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS benchmark_labor_rate numeric NOT NULL DEFAULT 0;

ALTER TABLE public.subcontract_allocations
  DROP CONSTRAINT IF EXISTS subcontract_allocations_planned_quantity_check;
ALTER TABLE public.subcontract_allocations
  ADD CONSTRAINT subcontract_allocations_planned_quantity_check
  CHECK (planned_quantity >= 0) NOT VALID;
ALTER TABLE public.subcontract_allocations
  VALIDATE CONSTRAINT subcontract_allocations_planned_quantity_check;

ALTER TABLE public.subcontract_allocations
  DROP CONSTRAINT IF EXISTS subcontract_allocations_benchmark_labor_rate_check;
ALTER TABLE public.subcontract_allocations
  ADD CONSTRAINT subcontract_allocations_benchmark_labor_rate_check
  CHECK (benchmark_labor_rate >= 0) NOT VALID;
ALTER TABLE public.subcontract_allocations
  VALIDATE CONSTRAINT subcontract_allocations_benchmark_labor_rate_check;

COMMENT ON COLUMN public.subcontract_allocations.planned_quantity IS
  'Physical quantity the bought-out allocation is expected to deliver.';
COMMENT ON COLUMN public.subcontract_allocations.unit IS
  'Physical unit for the production benchmark, such as SF, LF, CY, or EA.';
COMMENT ON COLUMN public.subcontract_allocations.benchmark_labor_rate IS
  'GC-selected loaded labor-equivalent dollars per observed labor-hour; not the subcontractor payroll rate.';

NOTIFY pgrst, 'reload schema';