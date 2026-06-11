
-- 1. Enums
CREATE TYPE public.exposure_category AS ENUM (
  'owner_decision','design_drift','trade_performance','procurement',
  'schedule_compression','allowance_overrun','field_change','closeout_punch','other'
);
CREATE TYPE public.response_path AS ENUM ('eliminate','recover','offset','accept');
CREATE TYPE public.hold_class AS ENUM ('E-Hold','C-Hold','Both','None');
CREATE TYPE public.exposure_status AS ENUM ('active','escalated','recovered','eliminated','accepted','released');
CREATE TYPE public.decision_status AS ENUM ('open','in_progress','resolved','overdue');

-- 2. projects additions
ALTER TABLE public.projects
  ADD COLUMN forecast_completion_date date,
  ADD COLUMN baseline_completion_date date,
  ADD COLUMN last_review_summary text NOT NULL DEFAULT '';

-- 3. exposures
CREATE TABLE public.exposures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  category public.exposure_category NOT NULL DEFAULT 'other',
  dollar_exposure numeric NOT NULL DEFAULT 0,
  probability numeric NOT NULL DEFAULT 100,
  schedule_impact_weeks numeric,
  owner text NOT NULL DEFAULT '',
  response_path public.response_path NOT NULL DEFAULT 'accept',
  release_condition text NOT NULL DEFAULT '',
  hold_class public.hold_class NOT NULL DEFAULT 'E-Hold',
  status public.exposure_status NOT NULL DEFAULT 'active',
  due_date date,
  next_review_at date,
  opened_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.exposures TO authenticated;
GRANT ALL ON public.exposures TO service_role;

ALTER TABLE public.exposures ENABLE ROW LEVEL SECURITY;

CREATE POLICY exposures_owner_via_project ON public.exposures
  FOR ALL TO public
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = exposures.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = exposures.project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER exposures_set_updated_at
  BEFORE UPDATE ON public.exposures
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 4. decisions
CREATE TABLE public.decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  decision text NOT NULL DEFAULT '',
  impact text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT '',
  due_date date,
  status public.decision_status NOT NULL DEFAULT 'open',
  linked_exposure_id uuid REFERENCES public.exposures(id) ON DELETE SET NULL,
  linked_co_id uuid REFERENCES public.change_orders(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.decisions TO authenticated;
GRANT ALL ON public.decisions TO service_role;

ALTER TABLE public.decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY decisions_owner_via_project ON public.decisions
  FOR ALL TO public
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = decisions.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = decisions.project_id AND p.owner_id = auth.uid()));

CREATE TRIGGER decisions_set_updated_at
  BEFORE UPDATE ON public.decisions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5. reviews
CREATE TABLE public.reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  reviewer text NOT NULL DEFAULT '',
  forecast_completion_date_before date,
  forecast_completion_date_after date,
  summary_notes text NOT NULL DEFAULT '',
  rollup_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT ALL ON public.reviews TO service_role;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY reviews_owner_via_project ON public.reviews
  FOR ALL TO public
  USING (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = reviews.project_id AND p.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.projects p WHERE p.id = reviews.project_id AND p.owner_id = auth.uid()));

-- 6. Backfill holds → exposures
INSERT INTO public.exposures
  (project_id, title, description, category, dollar_exposure, probability, owner,
   response_path, release_condition, hold_class, status, notes)
SELECT
  h.project_id,
  h.description AS title,
  h.reason AS description,
  'other'::public.exposure_category,
  h.amount,
  100,
  h.owner,
  'accept'::public.response_path,
  h.release_condition,
  (CASE WHEN h.type = 'C-Hold' THEN 'C-Hold' ELSE 'E-Hold' END)::public.hold_class,
  (CASE
     WHEN h.status = 'Released' THEN 'released'
     WHEN h.status = 'Escalated' THEN 'escalated'
     ELSE 'active'
   END)::public.exposure_status,
  ''
FROM public.holds h;

-- 7. Drop holds
DROP TABLE public.holds;

-- 8. Rewrite seed_demo_project
CREATE OR REPLACE FUNCTION public.seed_demo_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p_id uuid;
  co3_id uuid;
BEGIN
  INSERT INTO public.projects (owner_id, name, client, original_contract, original_cost_budget,
    schedule_variance_weeks, phase, percent_complete,
    baseline_completion_date, forecast_completion_date)
  VALUES (NEW.id, 'Harbor Residence', 'Private Luxury Residence',
    3200000, 2720000, 6, 'Middle', 60,
    (CURRENT_DATE + INTERVAL '180 days')::date,
    (CURRENT_DATE + INTERVAL '222 days')::date)
  RETURNING id INTO p_id;

  -- Cost buckets
  INSERT INTO public.cost_buckets (project_id, bucket, original_budget, actual_to_date, ftc, sort_order) VALUES
    (p_id, 'Sitework',  220000,  215000,   8000, 1),
    (p_id, 'Structure', 540000,  520000,  35000, 2),
    (p_id, 'Envelope',  430000,  300000, 160000, 3),
    (p_id, 'MEP',       480000,  260000, 240000, 4),
    (p_id, 'Finishes',  780000,  180000, 690000, 5),
    (p_id, 'GC/OH',     270000,  150000, 142000, 6);

  -- Change orders
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner) VALUES
    (p_id, 'CO-001', 'Owner-requested wine room expansion', 145000, 122000, 'Approved', 100, 'PM'),
    (p_id, 'CO-002', 'Upgraded primary bath stone package',  65000,  58000, 'Approved', 100, 'PM');
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner)
    VALUES (p_id, 'CO-003', 'Pool equipment relocation', 85000, 72000, 'Pending', 75, 'PM')
    RETURNING id INTO co3_id;
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner) VALUES
    (p_id, 'CO-004', 'Outdoor kitchen scope add', 120000, 98000, 'Pending', 50, 'PM');

  -- Exposures (6, varied)
  INSERT INTO public.exposures
    (project_id, title, description, category, dollar_exposure, probability, schedule_impact_weeks,
     owner, response_path, release_condition, hold_class, status, opened_at, next_review_at, notes)
  VALUES
    (p_id, 'Window delivery delay',
     'Manufacturer pushed ship date 5 weeks; risk of acceleration cost.',
     'procurement', 18000, 80, 3, 'K. Alvarez', 'recover',
     'Windows delivered and inspected on site', 'E-Hold', 'active',
     now() - INTERVAL '14 days', (CURRENT_DATE + INTERVAL '7 days')::date, ''),
    (p_id, 'Lighting allowance overrun',
     'Owner selections trending 30% over allowance.',
     'allowance_overrun', 22000, 90, 0, 'M. Chen', 'offset',
     'Final lighting package signed and POs issued', 'E-Hold', 'active',
     now() - INTERVAL '21 days', (CURRENT_DATE + INTERVAL '5 days')::date, ''),
    (p_id, 'Unapproved electrical changes',
     'Field changes not yet captured in COs.',
     'field_change', 9500, 100, 0, 'J. Patel', 'recover',
     'CO package submitted and approved', 'E-Hold', 'escalated',
     now() - INTERVAL '35 days', (CURRENT_DATE + INTERVAL '3 days')::date, ''),
    (p_id, 'Weak drywall subcontractor',
     'Quality issues may require supplemental crew.',
     'trade_performance', 15000, 60, 1, 'R. Singh', 'eliminate',
     'Punchlist cleared on level 2 hangs', 'E-Hold', 'active',
     now() - INTERVAL '10 days', (CURRENT_DATE + INTERVAL '14 days')::date, ''),
    (p_id, 'Late appliance selection',
     'Selection delay threatens MEP rough-in sequence.',
     'owner_decision', 12000, 70, 2, 'K. Alvarez', 'recover',
     'Appliance package locked & released', 'E-Hold', 'active',
     now() - INTERVAL '5 days', (CURRENT_DATE + INTERVAL '7 days')::date, ''),
    (p_id, 'Remaining finish-phase uncertainty',
     'General contingency for trim, paint, and closeout variability.',
     'closeout_punch', 65000, 100, 0, 'PM', 'accept',
     'Substantial completion + punch', 'C-Hold', 'active',
     now() - INTERVAL '30 days', (CURRENT_DATE + INTERVAL '30 days')::date, '');

  -- Decisions
  INSERT INTO public.decisions (project_id, decision, impact, owner, due_date, status) VALUES
    (p_id, 'Lock final lighting package',           'Releases $22k E-Hold and unblocks ceiling rough-in', 'Owner',    (CURRENT_DATE + INTERVAL '5 days')::date,  'open'),
    (p_id, 'Approve CO-003 (pool equipment)',       '$85k contract / $72k cost — affects site sequencing', 'Owner',    (CURRENT_DATE + INTERVAL '10 days')::date, 'in_progress'),
    (p_id, 'Confirm appliance package',             'Holds up MEP rough-in if not resolved this week',     'Owner',    (CURRENT_DATE + INTERVAL '7 days')::date,  'open'),
    (p_id, 'Issue formal CO for electrical adds',   'Recovers $9.5k currently un-billed',                  'PM',       (CURRENT_DATE - INTERVAL '2 days')::date,  'overdue');

  -- One prior review row
  INSERT INTO public.reviews (project_id, reviewer, forecast_completion_date_before, forecast_completion_date_after, summary_notes)
  VALUES (p_id, 'PM',
    (CURRENT_DATE + INTERVAL '215 days')::date,
    (CURRENT_DATE + INTERVAL '222 days')::date,
    'Window delay added 1 week to forecast; new exposure logged for appliance selection.');

  RETURN NEW;
END $function$;
