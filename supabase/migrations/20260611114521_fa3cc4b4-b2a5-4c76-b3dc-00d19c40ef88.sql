
CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  client text NOT NULL DEFAULT '',
  original_contract numeric NOT NULL DEFAULT 0,
  original_cost_budget numeric NOT NULL DEFAULT 0,
  forecasted_final_contract numeric NOT NULL DEFAULT 0,
  forecasted_final_cost numeric NOT NULL DEFAULT 0,
  approved_cos numeric NOT NULL DEFAULT 0,
  pending_cos numeric NOT NULL DEFAULT 0,
  schedule_variance_weeks integer NOT NULL DEFAULT 0,
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "projects_owner_all" ON public.projects FOR ALL
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE INDEX projects_owner_id_idx ON public.projects(owner_id);

CREATE TABLE public.holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('E-Hold','C-Hold')),
  description text NOT NULL DEFAULT '',
  amount numeric NOT NULL DEFAULT 0,
  reason text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  release_condition text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Released','Escalated')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holds TO authenticated;
GRANT ALL ON public.holds TO service_role;
ALTER TABLE public.holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "holds_owner_via_project" ON public.holds FOR ALL
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = holds.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = holds.project_id AND p.owner_id = auth.uid()));
CREATE INDEX holds_project_id_idx ON public.holds(project_id);

CREATE OR REPLACE FUNCTION public.tg_set_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER projects_updated_at BEFORE UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE TRIGGER holds_updated_at BEFORE UPDATE ON public.holds
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.seed_demo_project()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p_id uuid;
BEGIN
  INSERT INTO public.projects (owner_id, name, client, original_contract, original_cost_budget,
    forecasted_final_contract, forecasted_final_cost, approved_cos, pending_cos, schedule_variance_weeks)
  VALUES (NEW.id, 'Harbor Residence', 'Private Luxury Residence',
    3200000, 2720000, 3545000, 3140000, 210000, 135000, 6)
  RETURNING id INTO p_id;

  INSERT INTO public.holds (project_id, type, description, amount, reason, owner, release_condition, status) VALUES
    (p_id,'E-Hold','Window delivery delay',18000,'Manufacturer pushed ship date 5 weeks; risk of acceleration cost.','K. Alvarez','Windows delivered and inspected on site','Active'),
    (p_id,'E-Hold','Lighting allowance overrun',22000,'Owner selections trending 30% over allowance.','M. Chen','Final lighting package signed and POs issued','Active'),
    (p_id,'E-Hold','Unapproved electrical changes',9500,'Field changes not yet captured in COs.','J. Patel','CO package submitted and approved','Escalated'),
    (p_id,'E-Hold','Weak drywall subcontractor',15000,'Quality issues may require supplemental crew.','R. Singh','Punchlist cleared on level 2 hangs','Active'),
    (p_id,'E-Hold','Late appliance selection',12000,'Selection delay threatens MEP rough-in sequence.','K. Alvarez','Appliance package locked & released','Active'),
    (p_id,'C-Hold','Remaining finish-phase uncertainty',65000,'General contingency for trim, paint, and closeout variability.','PM','Substantial completion + punch','Active');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.seed_demo_project();
