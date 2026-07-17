-- Estimating pilot readiness: protect the canonical sample from shared-workspace
-- edits and make every estimator start from an isolated working copy.

ALTER TABLE public.estimates
  ADD COLUMN IF NOT EXISTS is_canonical_demo boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS canonical_demo_key text,
  ADD COLUMN IF NOT EXISTS canonical_demo_version integer,
  ADD COLUMN IF NOT EXISTS canonical_expected_total_cents bigint;

COMMENT ON COLUMN public.estimates.is_canonical_demo IS
  'Read-only product-owned sample. Estimators must duplicate it before editing.';
COMMENT ON COLUMN public.estimates.canonical_demo_key IS
  'Stable product sample identifier, unique inside one organization.';
COMMENT ON COLUMN public.estimates.canonical_expected_total_cents IS
  'Golden total used to detect sample-data drift before users rely on the demo.';

CREATE UNIQUE INDEX IF NOT EXISTS estimates_canonical_demo_org_key
  ON public.estimates(organization_id, canonical_demo_key)
  WHERE is_canonical_demo AND canonical_demo_key IS NOT NULL;

UPDATE public.estimates
SET
  is_canonical_demo = true,
  canonical_demo_key = 'harbor-residence-v1',
  canonical_demo_version = 1,
  canonical_expected_total_cents = 160613700,
  name = 'Harbor Residence — Canonical Sample',
  description = 'Read-only estimating workbench sample. Create a working copy before changing quantities, pricing, takeoffs, or drawings.'
WHERE lower(name) = lower('Harbor Residence - Sample Estimate')
  AND project_id IS NULL
  AND description ILIKE 'Sample reusable master sheet seeded from Harbor Residence%'
  AND (
    SELECT count(*)
    FROM public.estimate_line_items line
    WHERE line.estimate_id = estimates.id
  ) = 15;

UPDATE public.estimate_line_items line
SET material_unit_cost_cents = 1632523
FROM public.estimates estimate
WHERE estimate.id = line.estimate_id
  AND estimate.is_canonical_demo
  AND estimate.canonical_demo_key = 'harbor-residence-v1'
  AND line.cost_code = '31-220'
  AND line.quantity = 1
  AND line.material_unit_cost_cents = 1800000
  AND line.labor_unit_cost_cents = 3200000;

WITH rolled AS (
  SELECT
    estimate.id,
    coalesce(sum(line.material_extended_cents), 0)::bigint AS material_cents,
    coalesce(sum(line.labor_extended_cents), 0)::bigint AS labor_cents
  FROM public.estimates estimate
  LEFT JOIN public.estimate_line_items line ON line.estimate_id = estimate.id
  WHERE estimate.is_canonical_demo
    AND estimate.canonical_demo_key = 'harbor-residence-v1'
  GROUP BY estimate.id
), priced AS (
  SELECT
    estimate.id,
    rolled.material_cents,
    rolled.labor_cents,
    (rolled.material_cents + rolled.labor_cents)::bigint AS direct_cents,
    round((rolled.material_cents + rolled.labor_cents) * estimate.region_multiplier)::bigint AS adjusted_direct_cents,
    round(rolled.material_cents * estimate.region_multiplier)::bigint AS adjusted_material_cents
  FROM public.estimates estimate
  JOIN rolled ON rolled.id = estimate.id
)
UPDATE public.estimates estimate
SET
  subtotal_material_cents = priced.material_cents,
  subtotal_labor_cents = priced.labor_cents,
  subtotal_cents = priced.direct_cents,
  total_with_markups_cents =
    priced.adjusted_direct_cents
    + round(priced.adjusted_material_cents * estimate.tax_pct / 10000.0)::bigint
    + round(priced.adjusted_direct_cents * estimate.overhead_pct / 10000.0)::bigint
    + round(priced.adjusted_direct_cents * estimate.profit_pct / 10000.0)::bigint
    + round(priced.adjusted_direct_cents * estimate.contingency_pct / 10000.0)::bigint
    + round(priced.adjusted_direct_cents * estimate.bond_pct / 10000.0)::bigint
    + round(priced.adjusted_direct_cents * estimate.general_conditions_pct / 10000.0)::bigint
FROM priced
WHERE estimate.id = priced.id;

UPDATE public.estimates estimate
SET name = 'Harbor Residence — Working Copy'
WHERE lower(name) = lower('Harbor Residence - Sample Estimate')
  AND NOT estimate.is_canonical_demo
  AND EXISTS (
    SELECT 1
    FROM public.estimates canonical
    WHERE canonical.organization_id = estimate.organization_id
      AND canonical.is_canonical_demo
      AND canonical.canonical_demo_key = 'harbor-residence-v1'
  );

CREATE OR REPLACE FUNCTION public.tg_lock_canonical_estimate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_canonical_demo THEN
    RAISE EXCEPTION 'The canonical sample is read-only. Create a working copy first.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS estimates_lock_canonical_demo ON public.estimates;
CREATE TRIGGER estimates_lock_canonical_demo
  BEFORE UPDATE OR DELETE ON public.estimates
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_canonical_estimate();

CREATE OR REPLACE FUNCTION public.tg_lock_canonical_estimate_line()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_estimate_id uuid;
BEGIN
  v_estimate_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.estimate_id ELSE NEW.estimate_id END;
  IF EXISTS (
    SELECT 1 FROM public.estimates estimate
    WHERE estimate.id = v_estimate_id
      AND estimate.is_canonical_demo
  ) THEN
    RAISE EXCEPTION 'The canonical sample is read-only. Create a working copy first.';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS estimate_lines_lock_canonical_demo ON public.estimate_line_items;
CREATE TRIGGER estimate_lines_lock_canonical_demo
  BEFORE INSERT OR UPDATE OR DELETE ON public.estimate_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_lock_canonical_estimate_line();

CREATE OR REPLACE FUNCTION public.can_manage_estimate(p_estimate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.estimates estimate
      WHERE estimate.id = p_estimate_id
        AND NOT estimate.is_canonical_demo
        AND (
          public.is_org_member(estimate.organization_id)
          OR public.is_super_admin()
          OR public.can_manage_org(estimate.organization_id)
          OR (
            estimate.project_id IS NOT NULL
            AND public.can_manage_project(estimate.project_id)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.tg_lock_canonical_estimate() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_lock_canonical_estimate_line() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_estimate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_estimate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_estimate(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';