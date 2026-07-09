-- SUBCONTRACTORS — change orders & credits, kept SEPARATE from the contracted
-- amount (field request, DB3T 2026-07-09: "we should be able to add a change
-- order or credit to a sub and keep it separate from contracted amount").
--
-- One row per CO/credit against a subcontract: signed amount (change order
-- positive, credit negative), optional cost-code tag, date, description. The
-- base contract_value on public.subcontracts is untouched — the app derives
-- "revised contract" = base + sum(change orders).
--
-- Idempotent + portable. RLS mirrors subcontract_allocations exactly
-- (team-based: can_read_project / can_manage_project — ALL four verbs).

CREATE TABLE IF NOT EXISTS public.subcontract_change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  co_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontract_change_orders_project_idx
  ON public.subcontract_change_orders(project_id);
CREATE INDEX IF NOT EXISTS subcontract_change_orders_subcontract_idx
  ON public.subcontract_change_orders(subcontract_id);

ALTER TABLE public.subcontract_change_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontract_change_orders_team_select ON public.subcontract_change_orders;
CREATE POLICY subcontract_change_orders_team_select ON public.subcontract_change_orders
  FOR SELECT USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS subcontract_change_orders_team_insert ON public.subcontract_change_orders;
CREATE POLICY subcontract_change_orders_team_insert ON public.subcontract_change_orders
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS subcontract_change_orders_team_update ON public.subcontract_change_orders;
CREATE POLICY subcontract_change_orders_team_update ON public.subcontract_change_orders
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS subcontract_change_orders_team_delete ON public.subcontract_change_orders;
CREATE POLICY subcontract_change_orders_team_delete ON public.subcontract_change_orders
  FOR DELETE USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS subcontract_change_orders_set_updated_at
  ON public.subcontract_change_orders;
CREATE TRIGGER subcontract_change_orders_set_updated_at
  BEFORE UPDATE ON public.subcontract_change_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
