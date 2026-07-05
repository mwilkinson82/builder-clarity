-- Coherent Harbor demo: cost-coded SOV lines + one approved CO already
-- allocated to a cost code, so a freshly seeded demo behaves like real
-- construction accounting (G702 line 2 is non-zero out of the box, and every
-- SOV line carries a cost code an approved change order can be allocated to).
--
-- Two parts:
--   1. CREATE OR REPLACE seed_demo_project() so FRESH demos are coherent.
--   2. Idempotent backfill so EXISTING Harbor demos get the same cost codes
--      and the CO-002 -> Finishes allocation (guarded by NOT EXISTS / no-op
--      when already present).
--
-- The demo seed never created invoices, so there is nothing to de-duplicate
-- here — duplicate INV-HR-2601 rows on the live demo are runtime test debris
-- and are cleaned up separately by the migration desk.

-- ---------------------------------------------------------------------------
-- 1. Fresh demos: cost-coded buckets + CO-002 allocated to Finishes.
-- ---------------------------------------------------------------------------
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
  -- orders can be allocated to a real line.
  INSERT INTO public.cost_buckets (project_id, bucket, cost_code, original_budget, actual_to_date, ftc, sort_order) VALUES
    (p_id, 'Sitework',  '0200', 220000,  215000,   8000, 1),
    (p_id, 'Structure', '0300', 540000,  520000,  35000, 2),
    (p_id, 'Envelope',  '0700', 430000,  300000, 160000, 3),
    (p_id, 'MEP',       '1500', 480000,  260000, 240000, 4),
    (p_id, 'Finishes',  '0900', 780000,  180000, 690000, 5),
    (p_id, 'GC/OH',     '0100', 270000,  150000, 142000, 6);

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

-- ---------------------------------------------------------------------------
-- 2. Existing demos: backfill cost codes + the CO-002 allocation, idempotently.
--    Scoped to the Harbor Residence demo project only. Every statement is a
--    no-op on a demo that already has the coherent shape.
-- ---------------------------------------------------------------------------
DO $backfill$
DECLARE
  demo RECORD;
  b_finishes uuid;
  b_co2 uuid;
BEGIN
  FOR demo IN
    SELECT id AS project_id
    FROM public.projects
    WHERE name = 'Harbor Residence' AND client = 'Private Luxury Residence'
  LOOP
    -- Cost codes on the six known SOV lines (only fills blanks; never
    -- overwrites a code the user already set).
    UPDATE public.cost_buckets SET cost_code = '0200'
      WHERE project_id = demo.project_id AND bucket = 'Sitework'  AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';
    UPDATE public.cost_buckets SET cost_code = '0300'
      WHERE project_id = demo.project_id AND bucket = 'Structure' AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';
    UPDATE public.cost_buckets SET cost_code = '0700'
      WHERE project_id = demo.project_id AND bucket = 'Envelope'  AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';
    UPDATE public.cost_buckets SET cost_code = '1500'
      WHERE project_id = demo.project_id AND bucket = 'MEP'       AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';
    UPDATE public.cost_buckets SET cost_code = '0900'
      WHERE project_id = demo.project_id AND bucket = 'Finishes'  AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';
    UPDATE public.cost_buckets SET cost_code = '0100'
      WHERE project_id = demo.project_id AND bucket = 'GC/OH'     AND COALESCE(NULLIF(TRIM(cost_code), ''), '') = '';

    -- Allocate CO-002 -> Finishes if the pieces exist and it isn't allocated yet.
    SELECT id INTO b_finishes
    FROM public.cost_buckets
    WHERE project_id = demo.project_id AND bucket = 'Finishes'
    LIMIT 1;

    SELECT id INTO b_co2
    FROM public.change_orders
    WHERE project_id = demo.project_id AND number = 'CO-002' AND status = 'Approved'
    LIMIT 1;

    IF b_finishes IS NOT NULL AND b_co2 IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.change_order_allocations
         WHERE project_id = demo.project_id AND change_order_id = b_co2
       )
    THEN
      INSERT INTO public.change_order_allocations
        (project_id, change_order_id, cost_bucket_id, cost_code, description, contract_amount, cost_amount)
      VALUES
        (demo.project_id, b_co2, b_finishes, '0900', 'CO-002 - Upgraded primary bath stone package', 65000, 58000);
    END IF;
  END LOOP;
END $backfill$;
