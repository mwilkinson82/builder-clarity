-- BUDGETVSCONTRACT1 — each SOV line carries BOTH numbers (founder decision
-- 2026-07-06, from a live user report):
--
--   contract_value  = the billable value of this line (what the owner pays)
--   original_budget = the internal cost budget (what we drive the job on)
--   line margin     = contract_value − original_budget  (the delta = profit)
--
-- Until now cost_buckets had only original_budget, so every per-line view that
-- needed contract value reused the budget — collapsing margin to zero and, on
-- SOV import into a pay application, billing the owner at COST.
--
-- Backfill policy (founder-confirmed recommendation):
--   (a) REAL projects: contract_value stays 0 = "unpriced" — the ledger shows
--       an explicit needs-contract-value state; we never guess a client's
--       contract from their budget (that recreates the zero-margin bug).
--   (c) DEMO projects (Harbor Residence seed): realistic per-line contract
--       values that sum to the demo's $3.2M contract against its $2.72M
--       budget, so the ledger demonstrates real margin out of the box.

-- 1) The column: billable value of the line, distinct from cost budget.
ALTER TABLE public.cost_buckets
  ADD COLUMN IF NOT EXISTS contract_value numeric NOT NULL DEFAULT 0;

DO $check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cost_buckets_contract_value_check'
      AND conrelid = 'public.cost_buckets'::regclass
  ) THEN
    ALTER TABLE public.cost_buckets
      ADD CONSTRAINT cost_buckets_contract_value_check CHECK (contract_value >= 0);
  END IF;
END $check$;

COMMENT ON COLUMN public.cost_buckets.contract_value IS
  'Billable value of this SOV line — what the owner pays for this scope. Distinct from original_budget (internal cost). 0 = unpriced (surfaced as "needs contract value", never treated as zero margin). Line margin = contract_value − original_budget.';

-- 2) Fresh demos: seed_demo_project() now prices each SOV line. Faithful copy
--    of the 20260705134051 definition with contract_value added to the bucket
--    insert (values sum to the demo project's 3,200,000 contract).
CREATE OR REPLACE FUNCTION public.seed_demo_project()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  p_id uuid;
  co3_id uuid;
  co2_id uuid;
  finishes_id uuid;
BEGIN
  INSERT INTO public.projects (owner_id, name, client, original_contract, original_cost_budget,
    schedule_variance_weeks, phase, percent_complete,
    baseline_completion_date, forecast_completion_date)
  VALUES (NEW.id, 'Harbor Residence', 'Private Luxury Residence',
    3200000, 2720000, 6, 'Middle', 60,
    (CURRENT_DATE + INTERVAL '180 days')::date,
    (CURRENT_DATE + INTERVAL '222 days')::date)
  RETURNING id INTO p_id;

  -- Cost buckets (SOV lines) — each carries a cost code so approved change
  -- orders can be allocated to a real line, and BOTH money columns: the
  -- contract value the owner pays and the internal cost budget. The deltas
  -- are the line margins (total: 3.2M − 2.72M = 480k).
  INSERT INTO public.cost_buckets (project_id, bucket, cost_code, contract_value, original_budget, actual_to_date, ftc, sort_order) VALUES
    (p_id, 'Sitework',  '0200', 260000, 220000,  215000,   8000, 1),
    (p_id, 'Structure', '0300', 635000, 540000,  520000,  35000, 2),
    (p_id, 'Envelope',  '0700', 505000, 430000,  300000, 160000, 3),
    (p_id, 'MEP',       '1500', 565000, 480000,  260000, 240000, 4),
    (p_id, 'Finishes',  '0900', 915000, 780000,  180000, 690000, 5),
    (p_id, 'GC/OH',     '0100', 320000, 270000,  150000, 142000, 6);

  SELECT id INTO finishes_id
  FROM public.cost_buckets
  WHERE project_id = p_id AND cost_code = '0900'
  LIMIT 1;

  -- Change orders
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner)
    VALUES (p_id, 'CO-001', 'Owner-requested wine room expansion', 145000, 122000, 'Approved', 100, 'PM');
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner)
    VALUES (p_id, 'CO-002', 'Upgraded primary bath stone package',  65000,  58000, 'Approved', 100, 'PM')
    RETURNING id INTO co2_id;
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner)
    VALUES (p_id, 'CO-003', 'Pool equipment relocation', 85000, 72000, 'Pending', 75, 'PM')
    RETURNING id INTO co3_id;
  INSERT INTO public.change_orders (project_id, number, description, contract_amount, cost_amount, status, probability, owner) VALUES
    (p_id, 'CO-004', 'Outdoor kitchen scope add', 120000, 98000, 'Pending', 50, 'PM');

  -- CO-002 is approved and belongs to the Finishes stone scope — allocate it
  -- so the demo opens with a non-zero G702 line 2 on Finishes.
  IF finishes_id IS NOT NULL AND co2_id IS NOT NULL THEN
    INSERT INTO public.change_order_allocations
      (project_id, change_order_id, cost_bucket_id, cost_code, description, contract_amount, cost_amount)
    VALUES
      (p_id, co2_id, finishes_id, '0900', 'CO-002 - Upgraded primary bath stone package', 65000, 58000);
  END IF;

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

-- 3) EXISTING Harbor demos: price the six known SOV lines, idempotently
--    (only fills lines still at 0 — never overwrites a value a user set).
--    Real projects are deliberately untouched: unpriced until the user enters
--    their contract schedule.
DO $backfill$
DECLARE
  demo RECORD;
BEGIN
  FOR demo IN
    SELECT id AS project_id
    FROM public.projects
    WHERE name = 'Harbor Residence' AND client = 'Private Luxury Residence'
  LOOP
    UPDATE public.cost_buckets SET contract_value = 260000
      WHERE project_id = demo.project_id AND bucket = 'Sitework'  AND contract_value = 0;
    UPDATE public.cost_buckets SET contract_value = 635000
      WHERE project_id = demo.project_id AND bucket = 'Structure' AND contract_value = 0;
    UPDATE public.cost_buckets SET contract_value = 505000
      WHERE project_id = demo.project_id AND bucket = 'Envelope'  AND contract_value = 0;
    UPDATE public.cost_buckets SET contract_value = 565000
      WHERE project_id = demo.project_id AND bucket = 'MEP'       AND contract_value = 0;
    UPDATE public.cost_buckets SET contract_value = 915000
      WHERE project_id = demo.project_id AND bucket = 'Finishes'  AND contract_value = 0;
    UPDATE public.cost_buckets SET contract_value = 320000
      WHERE project_id = demo.project_id AND bucket = 'GC/OH'     AND contract_value = 0;
  END LOOP;
END $backfill$;
