-- SUBCONTRACTORS — per-payment cost-code split (field request, DB3T 2026-07-09:
-- "for progress payments i dont see where to add which cost code it goes to").
--
-- #252 shipped a DISPLAY-ONLY pro-rata split derived from the buyout's
-- allocations. This adds the editable version: one row per (payment, cost code)
-- with an explicit amount. A payment WITH rows here uses them verbatim in the
-- budget's paid-per-code math; a payment with NO rows keeps the pro-rata
-- derivation (so existing payments behave exactly as before). Rows must sum to
-- the payment — the server fn enforces it cents-exact.
--
-- RLS mirrors subcontract_allocations (team-based, all four verbs). ON DELETE
-- CASCADE from the payment so deleting a payment takes its split with it.
--
-- Idempotent + portable. Migration desk applies this.

CREATE TABLE IF NOT EXISTS public.subcontract_payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  subcontract_id uuid NOT NULL REFERENCES public.subcontracts(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL REFERENCES public.subcontract_payments(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS subcontract_payment_allocations_payment_idx
  ON public.subcontract_payment_allocations(payment_id);
CREATE INDEX IF NOT EXISTS subcontract_payment_allocations_project_idx
  ON public.subcontract_payment_allocations(project_id);

ALTER TABLE public.subcontract_payment_allocations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subcontract_payment_allocations_team_select
  ON public.subcontract_payment_allocations;
CREATE POLICY subcontract_payment_allocations_team_select
  ON public.subcontract_payment_allocations
  FOR SELECT USING (public.can_read_project(project_id));

DROP POLICY IF EXISTS subcontract_payment_allocations_team_insert
  ON public.subcontract_payment_allocations;
CREATE POLICY subcontract_payment_allocations_team_insert
  ON public.subcontract_payment_allocations
  FOR INSERT WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS subcontract_payment_allocations_team_update
  ON public.subcontract_payment_allocations;
CREATE POLICY subcontract_payment_allocations_team_update
  ON public.subcontract_payment_allocations
  FOR UPDATE USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));

DROP POLICY IF EXISTS subcontract_payment_allocations_team_delete
  ON public.subcontract_payment_allocations;
CREATE POLICY subcontract_payment_allocations_team_delete
  ON public.subcontract_payment_allocations
  FOR DELETE USING (public.can_manage_project(project_id));

DROP TRIGGER IF EXISTS subcontract_payment_allocations_set_updated_at
  ON public.subcontract_payment_allocations;
CREATE TRIGGER subcontract_payment_allocations_set_updated_at
  BEFORE UPDATE ON public.subcontract_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.subcontract_payment_allocations TO authenticated;
GRANT ALL ON public.subcontract_payment_allocations TO service_role;

NOTIFY pgrst, 'reload schema';
