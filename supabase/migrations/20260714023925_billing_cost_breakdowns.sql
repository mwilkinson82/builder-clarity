-- Planned sub-costs inside a budget code. These rows explain what makes up the
-- code-level budget (labor, concrete, rebar, equipment, etc.) without changing
-- the locked budget total or rewriting actual job cost.

CREATE TABLE IF NOT EXISTS public.cost_budget_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_bucket_id uuid NOT NULL REFERENCES public.cost_buckets(id) ON DELETE CASCADE,
  description text NOT NULL,
  category text NOT NULL DEFAULT 'other',
  planned_amount_cents bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_budget_items_description_present CHECK (length(btrim(description)) > 0),
  CONSTRAINT cost_budget_items_category_check CHECK (
    category IN ('labor', 'material', 'equipment', 'subcontract', 'other')
  ),
  CONSTRAINT cost_budget_items_amount_nonnegative CHECK (planned_amount_cents >= 0)
);

CREATE INDEX IF NOT EXISTS cost_budget_items_bucket_idx
  ON public.cost_budget_items (cost_bucket_id, sort_order, created_at);
CREATE INDEX IF NOT EXISTS cost_budget_items_project_idx
  ON public.cost_budget_items (project_id, cost_bucket_id);

ALTER TABLE public.cost_budget_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cost_budget_items_team_select ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_select
  ON public.cost_budget_items
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_insert ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_insert
  ON public.cost_budget_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_update ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_update
  ON public.cost_budget_items
  FOR UPDATE TO authenticated
  USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_delete ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_delete
  ON public.cost_budget_items
  FOR DELETE TO authenticated
  USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS cost_budget_items_set_updated_at ON public.cost_budget_items;
CREATE TRIGGER cost_budget_items_set_updated_at
  BEFORE UPDATE ON public.cost_budget_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_budget_items TO authenticated;
GRANT ALL ON public.cost_budget_items TO service_role;

NOTIFY pgrst, 'reload schema';
