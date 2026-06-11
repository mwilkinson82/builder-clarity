
-- 1. projects table changes
DO $$ BEGIN
  CREATE TYPE public.project_phase AS ENUM ('Early','Middle','Late');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS phase public.project_phase NOT NULL DEFAULT 'Early',
  ADD COLUMN IF NOT EXISTS percent_complete numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hold_variance_note text NOT NULL DEFAULT '';

ALTER TABLE public.projects
  DROP COLUMN IF EXISTS forecasted_final_contract,
  DROP COLUMN IF EXISTS forecasted_final_cost,
  DROP COLUMN IF EXISTS approved_cos,
  DROP COLUMN IF EXISTS pending_cos;

-- 2. change_orders
CREATE TABLE IF NOT EXISTS public.change_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  number text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  contract_amount numeric NOT NULL DEFAULT 0,
  cost_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'Pending',
  probability numeric NOT NULL DEFAULT 100,
  owner text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_orders TO authenticated;
GRANT ALL ON public.change_orders TO service_role;

ALTER TABLE public.change_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY change_orders_owner_via_project ON public.change_orders
  FOR ALL USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = change_orders.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = change_orders.project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER change_orders_set_updated_at BEFORE UPDATE ON public.change_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. cost_buckets
CREATE TABLE IF NOT EXISTS public.cost_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  bucket text NOT NULL,
  original_budget numeric NOT NULL DEFAULT 0,
  actual_to_date numeric NOT NULL DEFAULT 0,
  ftc numeric NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_buckets TO authenticated;
GRANT ALL ON public.cost_buckets TO service_role;

ALTER TABLE public.cost_buckets ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_buckets_owner_via_project ON public.cost_buckets
  FOR ALL USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = cost_buckets.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = cost_buckets.project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER cost_buckets_set_updated_at BEFORE UPDATE ON public.cost_buckets
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. rewrite seed_demo_project
CREATE OR REPLACE FUNCTION public.seed_demo_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE p_id uuid;
BEGIN
  INSERT INTO public.projects (owner_id, name, client, original_contract, original_cost_budget,
    schedule_variance_weeks, phase, percent_complete)
  VALUES (NEW.id, 'Harbor Residence', 'Private Luxury Residence',
    3200000, 2720000, 6, 'Middle', 60)
  RETURNING id INTO p_id;

  -- 6 cost buckets summing to 2,720,000 original
  INSERT INTO public.cost_buckets (project_id, bucket, original_budget, actual_to_date, ftc, sort_order) VALUES
    (p_id, 'Sitework',  220000,  215000,   8000, 1),
    (p_id, 'Structure', 540000,  520000,  35000, 2),
    (p_id, 'Envelope',  430000,  300000, 160000, 3),
    (p_id, 'MEP',       480000,  260000, 240000, 4),
    (p_id, 'Finishes',  780000,  180000, 690000, 5),
    (p_id, 'GC/OH',     270000,  150000, 142000, 6);

  -- 4 change orders: 2 approved (210k contract / 180k cost), 2 pending
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner) VALUES
    (p_id, 'CO-001', 'Owner-requested wine room expansion', 145000, 122000, 'Approved', 100, 'PM'),
    (p_id, 'CO-002', 'Upgraded primary bath stone package',  65000,  58000, 'Approved', 100, 'PM'),
    (p_id, 'CO-003', 'Pool equipment relocation',            85000,  72000, 'Pending',   75, 'PM'),
    (p_id, 'CO-004', 'Outdoor kitchen scope add',            120000, 98000, 'Pending',   50, 'PM');

  INSERT INTO public.holds (project_id, type, description, amount, reason, owner, release_condition, status) VALUES
    (p_id,'E-Hold','Window delivery delay',18000,'Manufacturer pushed ship date 5 weeks; risk of acceleration cost.','K. Alvarez','Windows delivered and inspected on site','Active'),
    (p_id,'E-Hold','Lighting allowance overrun',22000,'Owner selections trending 30% over allowance.','M. Chen','Final lighting package signed and POs issued','Active'),
    (p_id,'E-Hold','Unapproved electrical changes',9500,'Field changes not yet captured in COs.','J. Patel','CO package submitted and approved','Escalated'),
    (p_id,'E-Hold','Weak drywall subcontractor',15000,'Quality issues may require supplemental crew.','R. Singh','Punchlist cleared on level 2 hangs','Active'),
    (p_id,'E-Hold','Late appliance selection',12000,'Selection delay threatens MEP rough-in sequence.','K. Alvarez','Appliance package locked & released','Active'),
    (p_id,'C-Hold','Remaining finish-phase uncertainty',65000,'General contingency for trim, paint, and closeout variability.','PM','Substantial completion + punch','Active');
  RETURN NEW;
END $function$;
