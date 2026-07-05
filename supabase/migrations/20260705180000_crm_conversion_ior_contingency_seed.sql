-- CRMCARRY1 (audit 2.1): winning a job should FILL the project, not empty it.
-- Conversion already carries name/client/PM/contract/cost-budget and seeds default cost
-- buckets, but it drops the IOR risk register on the floor — the methodology differentiator.
-- This seeds an award-time contingency reserve (a C-Hold exposure) so the risk register is
-- alive from day one. Factored into a reusable helper so the estimate->project seam can call
-- the same logic later (CRMCARRY1 Task 3).
--
-- Contingency policy: 5% of contract at award, matching the estimating module's default
-- contingency_pct (500 = 5.00%). This is a founder-methodology default — review the % before
-- applying. It seeds a starting reserve the estimator refines; it is not a hard rule.

-- Reusable IOR contingency seeder. Idempotent (skips if the reserve already exists), no-ops
-- on missing/zero contract. SECURITY DEFINER so both the CRM and estimate conversion paths
-- can seed regardless of the caller's direct table grants.
CREATE OR REPLACE FUNCTION public.seed_project_award_contingency(
  p_project_id uuid,
  p_contract numeric,
  p_pct numeric DEFAULT 5
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_project_id IS NULL OR COALESCE(p_contract, 0) <= 0 OR COALESCE(p_pct, 0) <= 0 THEN
    RETURN;
  END IF;

  -- Enum literals are cast explicitly: bare strings in INSERT ... SELECT are typed as text
  -- and will not implicitly cast to the enum columns (AGENTS.md enum trap).
  INSERT INTO public.exposures (
    project_id,
    title,
    description,
    category,
    dollar_exposure,
    probability,
    owner,
    response_path,
    release_condition,
    hold_class,
    status,
    notes
  )
  SELECT
    p_project_id,
    'Award contingency reserve',
    format(
      'Starting contingency reserve set aside at award — %s%% of contract. This is a starting point, not a fixed rule: adjust the amount to match your estimate, price real exposures against it as scope firms, and release what is not consumed at closeout.',
      p_pct
    ),
    'other'::public.exposure_category,
    round(p_contract * p_pct / 100.0, 2),
    100,
    '',
    'accept'::public.response_path,
    'Substantial completion + closeout',
    'C-Hold'::public.hold_class,
    'active'::public.exposure_status,
    'Seeded on project creation (CRMCARRY1). Adjust the amount to match your estimate''s contingency.'
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.exposures e
    WHERE e.project_id = p_project_id
      AND e.title = 'Award contingency reserve'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.seed_project_award_contingency(uuid, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.seed_project_award_contingency(uuid, numeric, numeric) TO authenticated;

-- Extend conversion to seed the IOR register. Body is unchanged except the single PERFORM
-- after the cost buckets are created.
CREATE OR REPLACE FUNCTION public.convert_pipeline_opportunity_to_project(
  p_opportunity_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opportunity public.pipeline_opportunities%ROWTYPE;
  v_project_id uuid;
  v_bucket_budget numeric;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT *
  INTO v_opportunity
  FROM public.pipeline_opportunities
  WHERE id = p_opportunity_id
  FOR UPDATE;

  IF NOT FOUND OR v_opportunity.archived THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  IF NOT public.is_org_member(v_opportunity.organization_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF v_opportunity.converted_project_id IS NOT NULL THEN
    RETURN v_opportunity.converted_project_id;
  END IF;

  IF v_opportunity.stage <> 'won' THEN
    RAISE EXCEPTION 'Opportunity must be won before conversion';
  END IF;

  INSERT INTO public.projects (
    owner_id,
    organization_id,
    source_opportunity_id,
    name,
    client,
    project_manager,
    phase,
    original_contract,
    original_cost_budget
  )
  VALUES (
    auth.uid(),
    v_opportunity.organization_id,
    v_opportunity.id,
    v_opportunity.name,
    v_opportunity.client,
    v_opportunity.assigned_to,
    'Early',
    COALESCE(v_opportunity.estimated_contract, 0),
    COALESCE(v_opportunity.estimated_cost, 0)
  )
  RETURNING id INTO v_project_id;

  v_bucket_budget := COALESCE(v_opportunity.estimated_cost, 0) / 6;

  INSERT INTO public.cost_buckets (
    project_id,
    cost_code,
    bucket,
    original_budget,
    actual_to_date,
    ftc,
    sort_order
  )
  SELECT
    v_project_id,
    '',
    bucket_name,
    v_bucket_budget,
    0,
    v_bucket_budget,
    sort_order
  FROM unnest(ARRAY['Sitework', 'Structure', 'Envelope', 'MEP', 'Finishes', 'GC/OH'])
    WITH ORDINALITY AS default_buckets(bucket_name, sort_order);

  -- Seed the IOR risk register with an award contingency so the project is not born empty.
  PERFORM public.seed_project_award_contingency(
    v_project_id,
    COALESCE(v_opportunity.estimated_contract, 0)
  );

  UPDATE public.pipeline_opportunities
  SET
    converted_project_id = v_project_id,
    converted_at = now(),
    last_activity_at = now()
  WHERE id = v_opportunity.id;

  INSERT INTO public.pipeline_activity_log (
    opportunity_id,
    organization_id,
    event_type,
    to_value,
    notes,
    created_by
  )
  VALUES (
    v_opportunity.id,
    v_opportunity.organization_id,
    'converted',
    v_project_id::text,
    'Converted to Overwatch project',
    auth.uid()
  );

  RETURN v_project_id;
END;
$$;
