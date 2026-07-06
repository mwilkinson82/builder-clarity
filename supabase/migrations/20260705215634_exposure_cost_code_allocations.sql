-- Exposure → cost-code allocation (BUDGETENGINE Phase 1: "At Risk goes live").
--
-- An IOR exposure (an E-Hold = emergent risk, or a C-Hold = contingency) can be
-- spread across one or more SOV cost codes; whatever isn't allocated to a code
-- is general job risk. Summing allocations by cost code and hold_class gives the
-- live At Risk (E-Hold) and Contingency (C-Hold) columns of the budget-vs-cost
-- ledger — the number no off-the-shelf accounting tool can produce.
--
-- Mirrors public.change_order_allocations (same shape, RLS, grants, trigger).

CREATE TABLE IF NOT EXISTS public.exposure_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  exposure_id uuid NOT NULL REFERENCES public.exposures(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  -- Portion of the exposure's dollar_exposure carried on this cost code.
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exposure_allocations_amount_check CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS exposure_allocations_project_idx
  ON public.exposure_allocations(project_id, cost_bucket_id);
CREATE INDEX IF NOT EXISTS exposure_allocations_exposure_idx
  ON public.exposure_allocations(exposure_id);

DROP TRIGGER IF EXISTS exposure_allocations_set_updated_at
  ON public.exposure_allocations;
CREATE TRIGGER exposure_allocations_set_updated_at
  BEFORE UPDATE ON public.exposure_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exposure_allocations TO authenticated;
GRANT ALL ON public.exposure_allocations TO service_role;

ALTER TABLE public.exposure_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS exposure_allocations_team_select ON public.exposure_allocations;
CREATE POLICY exposure_allocations_team_select ON public.exposure_allocations
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS exposure_allocations_team_insert ON public.exposure_allocations;
CREATE POLICY exposure_allocations_team_insert ON public.exposure_allocations
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS exposure_allocations_team_update ON public.exposure_allocations;
CREATE POLICY exposure_allocations_team_update ON public.exposure_allocations
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS exposure_allocations_team_delete ON public.exposure_allocations;
CREATE POLICY exposure_allocations_team_delete ON public.exposure_allocations
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
