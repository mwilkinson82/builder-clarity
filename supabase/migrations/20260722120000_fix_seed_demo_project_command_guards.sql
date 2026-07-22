-- ============================================================================
-- HOTFIX: seed_demo_project() rolled back EVERY new-user creation
-- ============================================================================
-- seed_demo_project() runs AFTER INSERT on auth.users to give each new user the
-- Harbor Residence demo. It writes change_orders (and a change-order allocation)
-- with raw INSERTs. The 2026-07-20 financial-integrity batch added command-
-- authority guards on those tables that raise unless the atomic-command GUCs are
-- set (protect_change_order_command_authority requires
-- overwatch.change_order_write = 'creating';
-- protect_change_order_allocation_authority requires
-- overwatch.change_order_allocation_write = 'inserting'). The seed set neither,
-- so its raw change-order insert raised 23514 -> the whole auth.users insert
-- rolled back -> EVERY sign-up and team invite failed with an opaque error
-- ("invite not sending" — Preston, DB3T). No new user could be created at all.
--
-- Fix: set the two atomic-command GUCs transaction-locally around exactly the
-- guarded change-order inserts, then reset them. The exposure/decision/review/
-- project/cost_bucket inserts are not command-guarded (the exposure link guard
-- only fires when linked_change_order_id is set, which the seed never does), so
-- they are untouched. Body is otherwise byte-identical to the live function.
-- ============================================================================

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

  INSERT INTO public.cost_buckets (project_id, bucket, cost_code, contract_value, original_budget, actual_to_date, ftc, sort_order) VALUES
    (p_id, 'Sitework',  '0200', 260000, 220000,  215000,   8000, 1),
    (p_id, 'Structure', '0300', 635000, 540000,  520000,  35000, 2),
    (p_id, 'Envelope',  '0700', 505000, 430000,  300000, 160000, 3),
    (p_id, 'MEP',       '1500', 565000, 480000,  260000, 240000, 4),
    (p_id, 'Finishes',  '0900', 915000, 780000,  180000, 690000, 5),
    (p_id, 'GC/OH',     '0100', 320000, 270000,  150000, 142000, 6);

  SELECT id INTO finishes_id FROM public.cost_buckets WHERE project_id = p_id AND cost_code = '0900' LIMIT 1;

  -- Financial-integrity command guards: set the atomic-command GUCs transaction-
  -- locally so these raw change-order inserts pass instead of rolling back the
  -- new user's auth.users row (which was breaking ALL sign-ups and invites).
  PERFORM set_config('overwatch.change_order_write', 'creating', true);
  PERFORM set_config('overwatch.change_order_allocation_write', 'inserting', true);

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

  IF finishes_id IS NOT NULL AND co2_id IS NOT NULL THEN
    INSERT INTO public.change_order_allocations
      (project_id, change_order_id, cost_bucket_id, cost_code, description, contract_amount, cost_amount)
    VALUES
      (p_id, co2_id, finishes_id, '0900', 'CO-002 - Upgraded primary bath stone package', 65000, 58000);
  END IF;

  PERFORM set_config('overwatch.change_order_write', '', true);
  PERFORM set_config('overwatch.change_order_allocation_write', '', true);

  INSERT INTO public.exposures
    (project_id, title, description, category, dollar_exposure, probability, schedule_impact_weeks,
     owner, response_path, release_condition, hold_class, status, opened_at, next_review_at, notes)
  VALUES
    (p_id, 'Window delivery delay', 'Manufacturer pushed ship date 5 weeks; risk of acceleration cost.',
     'procurement', 18000, 80, 3, 'K. Alvarez', 'recover', 'Windows delivered and inspected on site', 'E-Hold', 'active',
     now() - INTERVAL '14 days', (CURRENT_DATE + INTERVAL '7 days')::date, ''),
    (p_id, 'Lighting allowance overrun', 'Owner selections trending 30% over allowance.',
     'allowance_overrun', 22000, 90, 0, 'M. Chen', 'offset', 'Final lighting package signed and POs issued', 'E-Hold', 'active',
     now() - INTERVAL '21 days', (CURRENT_DATE + INTERVAL '5 days')::date, ''),
    (p_id, 'Unapproved electrical changes', 'Field changes not yet captured in COs.',
     'field_change', 9500, 100, 0, 'J. Patel', 'recover', 'CO package submitted and approved', 'E-Hold', 'escalated',
     now() - INTERVAL '35 days', (CURRENT_DATE + INTERVAL '3 days')::date, ''),
    (p_id, 'Weak drywall subcontractor', 'Quality issues may require supplemental crew.',
     'trade_performance', 15000, 60, 1, 'R. Singh', 'eliminate', 'Punchlist cleared on level 2 hangs', 'E-Hold', 'active',
     now() - INTERVAL '10 days', (CURRENT_DATE + INTERVAL '14 days')::date, ''),
    (p_id, 'Late appliance selection', 'Selection delay threatens MEP rough-in sequence.',
     'owner_decision', 12000, 70, 2, 'K. Alvarez', 'recover', 'Appliance package locked & released', 'E-Hold', 'active',
     now() - INTERVAL '5 days', (CURRENT_DATE + INTERVAL '7 days')::date, ''),
    (p_id, 'Remaining finish-phase uncertainty', 'General contingency for trim, paint, and closeout variability.',
     'closeout_punch', 65000, 100, 0, 'PM', 'accept', 'Substantial completion + punch', 'C-Hold', 'active',
     now() - INTERVAL '30 days', (CURRENT_DATE + INTERVAL '30 days')::date, '');

  INSERT INTO public.decisions (project_id, decision, impact, owner, due_date, status) VALUES
    (p_id, 'Lock final lighting package',           'Releases $22k E-Hold and unblocks ceiling rough-in', 'Owner',    (CURRENT_DATE + INTERVAL '5 days')::date,  'open'),
    (p_id, 'Approve CO-003 (pool equipment)',       '$85k contract / $72k cost — affects site sequencing', 'Owner',    (CURRENT_DATE + INTERVAL '10 days')::date, 'in_progress'),
    (p_id, 'Confirm appliance package',             'Holds up MEP rough-in if not resolved this week',     'Owner',    (CURRENT_DATE + INTERVAL '7 days')::date,  'open'),
    (p_id, 'Issue formal CO for electrical adds',   'Recovers $9.5k currently un-billed',                  'PM',       (CURRENT_DATE - INTERVAL '2 days')::date,  'overdue');

  INSERT INTO public.reviews (project_id, reviewer, forecast_completion_date_before, forecast_completion_date_after, summary_notes)
  VALUES (p_id, 'PM', (CURRENT_DATE + INTERVAL '215 days')::date, (CURRENT_DATE + INTERVAL '222 days')::date,
    'Window delay added 1 week to forecast; new exposure logged for appliance selection.');

  RETURN NEW;
END $function$;
