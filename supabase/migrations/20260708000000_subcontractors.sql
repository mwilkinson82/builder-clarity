-- SUBCONTRACTORS — Slice 1 (buyout + progress payments).
--
-- Four tables:
--   subcontractors          org-level directory (reusable across jobs; mirrors
--                           cost_library_items — is_org_member / can_manage_org)
--   subcontracts            per-project buyout (contract_value = the GC's cost)
--   subcontract_allocations buyout split across cost codes (mirrors
--                           change_order_allocations — can_read/can_manage_project)
--   subcontract_payments    progress payments against a buyout (gross + retainage)
--
-- The additive budget layer (committed → forecast-to-complete, paid →
-- actual-to-date) is computed in the app (src/lib/subcontract-budget.ts) and
-- folded into computeBudgetLedger — NOTHING here touches cost_actuals or the
-- shared budget trigger. Money is numeric dollars at the DB edge; the app keeps
-- it cents-exact.
--
-- Idempotent + portable (IF NOT EXISTS, guarded seed). Founder-approved
-- 2026-07-07 (additive layer). Migration desk applies this.

-- ── 1. subcontractors (org directory) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subcontractors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  trade text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  source varchar(32) NOT NULL DEFAULT 'user' CHECK (source IN ('system','user','imported')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontractors_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS subcontractors_org_idx ON public.subcontractors(organization_id);
CREATE INDEX IF NOT EXISTS subcontractors_org_trade_idx ON public.subcontractors(organization_id, trade);

DROP TRIGGER IF EXISTS subcontractors_set_updated_at ON public.subcontractors;
CREATE TRIGGER subcontractors_set_updated_at
  BEFORE UPDATE ON public.subcontractors
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontractors TO authenticated;
GRANT ALL ON public.subcontractors TO service_role;
ALTER TABLE public.subcontractors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontractors_org_select ON public.subcontractors;
CREATE POLICY subcontractors_org_select ON public.subcontractors
  FOR SELECT USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS subcontractors_org_insert ON public.subcontractors;
CREATE POLICY subcontractors_org_insert ON public.subcontractors
  FOR INSERT WITH CHECK (public.is_org_member(organization_id));
DROP POLICY IF EXISTS subcontractors_user_update ON public.subcontractors;
CREATE POLICY subcontractors_user_update ON public.subcontractors
  FOR UPDATE USING (public.can_manage_org(organization_id) AND source <> 'system')
  WITH CHECK (public.can_manage_org(organization_id) AND source <> 'system');
DROP POLICY IF EXISTS subcontractors_user_delete ON public.subcontractors;
CREATE POLICY subcontractors_user_delete ON public.subcontractors
  FOR DELETE USING (public.can_manage_org(organization_id) AND source <> 'system');

-- ── 2. subcontracts (per-project buyout) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subcontracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontractor_id uuid NOT NULL REFERENCES public.subcontractors(id) ON DELETE RESTRICT,
  title text NOT NULL DEFAULT '',
  scope text NOT NULL DEFAULT '',
  contract_value numeric NOT NULL DEFAULT 0,
  retainage_pct numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','executed')),
  executed_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontracts_amounts_check CHECK (contract_value >= 0 AND retainage_pct >= 0 AND retainage_pct <= 100)
);
CREATE INDEX IF NOT EXISTS subcontracts_project_idx ON public.subcontracts(project_id);
CREATE INDEX IF NOT EXISTS subcontracts_subcontractor_idx ON public.subcontracts(subcontractor_id);

DROP TRIGGER IF EXISTS subcontracts_set_updated_at ON public.subcontracts;
CREATE TRIGGER subcontracts_set_updated_at
  BEFORE UPDATE ON public.subcontracts
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontracts TO authenticated;
GRANT ALL ON public.subcontracts TO service_role;
ALTER TABLE public.subcontracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontracts_team_select ON public.subcontracts;
CREATE POLICY subcontracts_team_select ON public.subcontracts
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS subcontracts_team_insert ON public.subcontracts;
CREATE POLICY subcontracts_team_insert ON public.subcontracts
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontracts_team_update ON public.subcontracts;
CREATE POLICY subcontracts_team_update ON public.subcontracts
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontracts_team_delete ON public.subcontracts;
CREATE POLICY subcontracts_team_delete ON public.subcontracts
  FOR DELETE USING (public.can_manage_project(project_id));

-- ── 3. subcontract_allocations (buyout → cost code, splittable) ──────────────
CREATE TABLE IF NOT EXISTS public.subcontract_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontract_allocations_amount_check CHECK (amount >= 0)
);
CREATE INDEX IF NOT EXISTS subcontract_allocations_project_idx
  ON public.subcontract_allocations(project_id, cost_bucket_id);
CREATE INDEX IF NOT EXISTS subcontract_allocations_subcontract_idx
  ON public.subcontract_allocations(subcontract_id);

DROP TRIGGER IF EXISTS subcontract_allocations_set_updated_at ON public.subcontract_allocations;
CREATE TRIGGER subcontract_allocations_set_updated_at
  BEFORE UPDATE ON public.subcontract_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontract_allocations TO authenticated;
GRANT ALL ON public.subcontract_allocations TO service_role;
ALTER TABLE public.subcontract_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontract_allocations_team_select ON public.subcontract_allocations;
CREATE POLICY subcontract_allocations_team_select ON public.subcontract_allocations
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS subcontract_allocations_team_insert ON public.subcontract_allocations;
CREATE POLICY subcontract_allocations_team_insert ON public.subcontract_allocations
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_allocations_team_update ON public.subcontract_allocations;
CREATE POLICY subcontract_allocations_team_update ON public.subcontract_allocations
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_allocations_team_delete ON public.subcontract_allocations;
CREATE POLICY subcontract_allocations_team_delete ON public.subcontract_allocations
  FOR DELETE USING (public.can_manage_project(project_id));

-- ── 4. subcontract_payments (progress payments) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.subcontract_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,          -- gross progress (work value in place)
  retainage_held numeric NOT NULL DEFAULT 0,  -- retention held from this payment
  payment_date date NOT NULL DEFAULT current_date,
  reference text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT subcontract_payments_amounts_check CHECK (amount >= 0 AND retainage_held >= 0)
);
CREATE INDEX IF NOT EXISTS subcontract_payments_project_idx ON public.subcontract_payments(project_id);
CREATE INDEX IF NOT EXISTS subcontract_payments_subcontract_idx ON public.subcontract_payments(subcontract_id);

DROP TRIGGER IF EXISTS subcontract_payments_set_updated_at ON public.subcontract_payments;
CREATE TRIGGER subcontract_payments_set_updated_at
  BEFORE UPDATE ON public.subcontract_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontract_payments TO authenticated;
GRANT ALL ON public.subcontract_payments TO service_role;
ALTER TABLE public.subcontract_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontract_payments_team_select ON public.subcontract_payments;
CREATE POLICY subcontract_payments_team_select ON public.subcontract_payments
  FOR SELECT USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS subcontract_payments_team_insert ON public.subcontract_payments;
CREATE POLICY subcontract_payments_team_insert ON public.subcontract_payments
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_payments_team_update ON public.subcontract_payments;
CREATE POLICY subcontract_payments_team_update ON public.subcontract_payments
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS subcontract_payments_team_delete ON public.subcontract_payments;
CREATE POLICY subcontract_payments_team_delete ON public.subcontract_payments
  FOR DELETE USING (public.can_manage_project(project_id));

-- ── Demo seed (Harbor Residence / ALP) ──────────────────────────────────────
-- One executed buyout ($145k Concrete) allocated to the Structure code with a
-- $20k progress payment (10% retainage), so the feature demonstrates the
-- committed→forecast, paid→actual flow live. Fixed UUIDs + guards = idempotent;
-- no-ops cleanly if Harbor / its Structure bucket isn't present in an env.
INSERT INTO public.subcontractors (id, organization_id, name, trade, contact_name, source)
SELECT '5b0c0001-0000-4000-8000-000000000001', p.organization_id,
       'Ironclad Concrete Co.', 'Concrete', 'Ray Delgado', 'user'
FROM public.projects p
WHERE p.id = '1d31d1ad-af18-40d2-9b1c-ec55db3b3e45'
  AND p.organization_id IS NOT NULL
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subcontracts (id, project_id, subcontractor_id, title, scope, contract_value, retainage_pct, status, executed_at)
SELECT '5b0c0002-0000-4000-8000-000000000001', '1d31d1ad-af18-40d2-9b1c-ec55db3b3e45',
       '5b0c0001-0000-4000-8000-000000000001',
       'Concrete — foundations & structure', 'Foundations, footings, and structural concrete per plans and the executed proposal.',
       145000, 10, 'executed', current_date
WHERE EXISTS (SELECT 1 FROM public.subcontractors s WHERE s.id = '5b0c0001-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subcontract_allocations (id, project_id, subcontract_id, cost_bucket_id, cost_code, description, amount)
SELECT '5b0c0003-0000-4000-8000-000000000001', '1d31d1ad-af18-40d2-9b1c-ec55db3b3e45',
       '5b0c0002-0000-4000-8000-000000000001', b.id, b.cost_code, b.bucket, 145000
FROM public.cost_buckets b
WHERE b.project_id = '1d31d1ad-af18-40d2-9b1c-ec55db3b3e45'
  AND b.cost_code = '0300'
  AND EXISTS (SELECT 1 FROM public.subcontracts sc WHERE sc.id = '5b0c0002-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.subcontract_payments (id, project_id, subcontract_id, amount, retainage_held, payment_date, reference)
SELECT '5b0c0004-0000-4000-8000-000000000001', '1d31d1ad-af18-40d2-9b1c-ec55db3b3e45',
       '5b0c0002-0000-4000-8000-000000000001', 20000, 2000, current_date, 'Progress payment #1'
WHERE EXISTS (SELECT 1 FROM public.subcontracts sc WHERE sc.id = '5b0c0002-0000-4000-8000-000000000001')
ON CONFLICT (id) DO NOTHING;
