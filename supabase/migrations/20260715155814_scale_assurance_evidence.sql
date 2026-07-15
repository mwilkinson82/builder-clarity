-- Scale Assurance: two independent dimension checks are required before a
-- drawing scale can become trusted. Assessments are append-only evidence;
-- the active plan-sheet row keeps the current verified/unverified state.

CREATE TABLE IF NOT EXISTS public.estimate_scale_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  plan_sheet_id uuid NOT NULL REFERENCES public.estimate_plan_sheets(id) ON DELETE CASCADE,
  scale_revision integer NOT NULL,
  outcome varchar(16) NOT NULL,
  tolerance_pct numeric(6,3) NOT NULL DEFAULT 1.5,
  max_variance_pct numeric(10,4) NOT NULL,
  scale_spread_pct numeric(10,4) NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.estimate_scale_assessments
  DROP CONSTRAINT IF EXISTS estimate_scale_assessments_revision_positive,
  DROP CONSTRAINT IF EXISTS estimate_scale_assessments_outcome_valid,
  DROP CONSTRAINT IF EXISTS estimate_scale_assessments_tolerance_valid,
  DROP CONSTRAINT IF EXISTS estimate_scale_assessments_variance_nonnegative,
  DROP CONSTRAINT IF EXISTS estimate_scale_assessments_evidence_valid;

ALTER TABLE public.estimate_scale_assessments
  ADD CONSTRAINT estimate_scale_assessments_revision_positive
    CHECK (scale_revision >= 1),
  ADD CONSTRAINT estimate_scale_assessments_outcome_valid
    CHECK (outcome IN ('verified', 'conflict')),
  ADD CONSTRAINT estimate_scale_assessments_tolerance_valid
    CHECK (tolerance_pct > 0 AND tolerance_pct <= 10),
  ADD CONSTRAINT estimate_scale_assessments_variance_nonnegative
    CHECK (max_variance_pct >= 0 AND scale_spread_pct >= 0),
  ADD CONSTRAINT estimate_scale_assessments_evidence_valid
    CHECK (
      jsonb_typeof(evidence) = 'array'
      AND jsonb_array_length(evidence) = 2
    );

CREATE INDEX IF NOT EXISTS estimate_scale_assessments_sheet_created_idx
  ON public.estimate_scale_assessments(plan_sheet_id, created_at DESC);

CREATE INDEX IF NOT EXISTS estimate_scale_assessments_estimate_created_idx
  ON public.estimate_scale_assessments(estimate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS estimate_scale_assessments_created_by_idx
  ON public.estimate_scale_assessments(created_by)
  WHERE created_by IS NOT NULL;

ALTER TABLE public.estimate_scale_assessments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_scale_assessments_org_select
  ON public.estimate_scale_assessments;
CREATE POLICY estimate_scale_assessments_org_select
  ON public.estimate_scale_assessments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.estimate_plan_sheets sheet
      JOIN public.estimate_plan_sets plan_set ON plan_set.id = sheet.plan_set_id
      WHERE sheet.id = estimate_scale_assessments.plan_sheet_id
        AND sheet.estimate_id = estimate_scale_assessments.estimate_id
        AND public.is_org_member(plan_set.organization_id)
    )
  );

DROP POLICY IF EXISTS estimate_scale_assessments_org_insert
  ON public.estimate_scale_assessments;
CREATE POLICY estimate_scale_assessments_org_insert
  ON public.estimate_scale_assessments
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND current_setting('app.scale_assurance_sheet_id', true) = plan_sheet_id::text
    AND current_setting('app.scale_assurance_scale_revision', true) = scale_revision::text
    AND EXISTS (
      SELECT 1
      FROM public.estimate_plan_sheets sheet
      JOIN public.estimate_plan_sets plan_set ON plan_set.id = sheet.plan_set_id
      WHERE sheet.id = estimate_scale_assessments.plan_sheet_id
        AND sheet.estimate_id = estimate_scale_assessments.estimate_id
        AND public.is_org_member(plan_set.organization_id)
    )
  );

-- Scale trust is database-owned. A client may clear verification or change a
-- scale (which also clears it), but only the assessment transaction below can
-- set a non-null verification timestamp.
CREATE OR REPLACE FUNCTION public.tg_plan_sheet_takeoff_trust()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  scale_changed boolean;
  assurance_sheet_id text;
  assurance_scale_revision text;
BEGIN
  scale_changed :=
    NEW.scale_feet_per_pixel IS DISTINCT FROM OLD.scale_feet_per_pixel OR
    NEW.width_px IS DISTINCT FROM OLD.width_px OR
    NEW.height_px IS DISTINCT FROM OLD.height_px;

  IF scale_changed THEN
    NEW.scale_revision := OLD.scale_revision + 1;
    NEW.scale_changed_at := now();
    NEW.scale_verified_at := NULL;
  ELSIF NEW.scale_verified_at IS DISTINCT FROM OLD.scale_verified_at
    AND NEW.scale_verified_at IS NOT NULL THEN
    assurance_sheet_id := current_setting('app.scale_assurance_sheet_id', true);
    assurance_scale_revision := current_setting('app.scale_assurance_scale_revision', true);
    IF assurance_sheet_id IS DISTINCT FROM NEW.id::text
      OR assurance_scale_revision IS DISTINCT FROM NEW.scale_revision::text THEN
      RAISE EXCEPTION 'Use Scale Assurance to verify a sheet with two dimension checks.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- This SECURITY INVOKER function keeps the evidence insert and sheet trust
-- update in one transaction. RLS on both tables remains the authorization
-- boundary. The server calculates every variance from authoritative sheet
-- dimensions and scale; the browser cannot declare its own passing result.
CREATE OR REPLACE FUNCTION public.record_estimate_scale_assessment(
  p_estimate_id uuid,
  p_plan_sheet_id uuid,
  p_scale_revision integer,
  p_checks jsonb,
  p_notes text DEFAULT ''
)
RETURNS TABLE (
  assessment_id uuid,
  outcome varchar,
  max_variance_pct numeric,
  scale_spread_pct numeric,
  verified_at timestamptz,
  evidence jsonb
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_sheet record;
  v_check jsonb;
  v_points jsonb;
  v_check_number integer := 0;
  v_x1 numeric;
  v_y1 numeric;
  v_x2 numeric;
  v_y2 numeric;
  v_first_x1 numeric;
  v_first_y1 numeric;
  v_first_x2 numeric;
  v_first_y2 numeric;
  v_labeled_feet numeric;
  v_pixel_distance numeric;
  v_measured_feet numeric;
  v_variance_pct numeric;
  v_implied_scale numeric;
  v_implied_min numeric;
  v_implied_max numeric;
  v_max_variance numeric := 0;
  v_scale_spread numeric := 0;
  v_evidence jsonb := '[]'::jsonb;
  v_outcome varchar(16);
  v_assessment_id uuid;
  v_verified_at timestamptz;
  v_updated_sheet_id uuid;
  v_tolerance_pct CONSTANT numeric := 1.5;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'Sign in before recording scale evidence.';
  END IF;

  IF jsonb_typeof(p_checks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Two independent dimension checks are required.';
  END IF;
  IF jsonb_array_length(p_checks) <> 2 THEN
    RAISE EXCEPTION 'Two independent dimension checks are required.';
  END IF;

  SELECT
    sheet.id,
    sheet.estimate_id,
    sheet.scale_revision,
    sheet.scale_feet_per_pixel,
    sheet.width_px,
    sheet.height_px
  INTO v_sheet
  FROM public.estimate_plan_sheets sheet
  WHERE sheet.id = p_plan_sheet_id
    AND sheet.estimate_id = p_estimate_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Plan sheet was not found or is not available to this user.';
  END IF;

  IF v_sheet.scale_revision IS DISTINCT FROM p_scale_revision THEN
    RAISE EXCEPTION 'The sheet scale changed while it was being checked. Start the assurance review again.';
  END IF;

  IF COALESCE(v_sheet.scale_feet_per_pixel, 0) <= 0
    OR COALESCE(v_sheet.width_px, 0) <= 0
    OR COALESCE(v_sheet.height_px, 0) <= 0 THEN
    RAISE EXCEPTION 'Set the drawing scale and sheet dimensions before verifying it.';
  END IF;

  FOR v_check IN SELECT value FROM jsonb_array_elements(p_checks)
  LOOP
    v_check_number := v_check_number + 1;
    v_points := v_check -> 'points';
    IF jsonb_typeof(v_points) IS DISTINCT FROM 'array' THEN
      RAISE EXCEPTION 'Scale check % must contain exactly two points.', v_check_number;
    END IF;
    IF jsonb_array_length(v_points) <> 2 THEN
      RAISE EXCEPTION 'Scale check % must contain exactly two points.', v_check_number;
    END IF;

    BEGIN
      v_x1 := (v_points -> 0 ->> 'x')::numeric;
      v_y1 := (v_points -> 0 ->> 'y')::numeric;
      v_x2 := (v_points -> 1 ->> 'x')::numeric;
      v_y2 := (v_points -> 1 ->> 'y')::numeric;
      v_labeled_feet := (v_check ->> 'labeled_distance_feet')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Scale check % contains an invalid point or distance.', v_check_number;
    END;

    IF v_x1 IS NULL OR v_y1 IS NULL OR v_x2 IS NULL OR v_y2 IS NULL
      OR v_x1 NOT BETWEEN 0 AND 1 OR v_y1 NOT BETWEEN 0 AND 1
      OR v_x2 NOT BETWEEN 0 AND 1 OR v_y2 NOT BETWEEN 0 AND 1 THEN
      RAISE EXCEPTION 'Scale check % points must stay inside the drawing.', v_check_number;
    END IF;
    IF v_labeled_feet IS NULL OR v_labeled_feet <= 0 THEN
      RAISE EXCEPTION 'Scale check % needs a positive labeled distance.', v_check_number;
    END IF;

    IF v_check_number = 1 THEN
      v_first_x1 := v_x1;
      v_first_y1 := v_y1;
      v_first_x2 := v_x2;
      v_first_y2 := v_y2;
    ELSIF (
      abs(v_x1 - v_first_x1) < 0.0001
      AND abs(v_y1 - v_first_y1) < 0.0001
      AND abs(v_x2 - v_first_x2) < 0.0001
      AND abs(v_y2 - v_first_y2) < 0.0001
    ) OR (
      abs(v_x1 - v_first_x2) < 0.0001
      AND abs(v_y1 - v_first_y2) < 0.0001
      AND abs(v_x2 - v_first_x1) < 0.0001
      AND abs(v_y2 - v_first_y1) < 0.0001
    ) THEN
      RAISE EXCEPTION 'Use a different printed dimension for the second scale check.';
    END IF;

    v_pixel_distance := sqrt(
      power((v_x2 - v_x1) * v_sheet.width_px, 2)
      + power((v_y2 - v_y1) * v_sheet.height_px, 2)
    );
    IF v_pixel_distance <= 0.5 THEN
      RAISE EXCEPTION 'Scale check % is too short to verify.', v_check_number;
    END IF;

    v_measured_feet := v_pixel_distance * v_sheet.scale_feet_per_pixel;
    v_variance_pct := ((v_measured_feet - v_labeled_feet) / v_labeled_feet) * 100;
    v_implied_scale := v_labeled_feet / v_pixel_distance;
    v_max_variance := GREATEST(v_max_variance, abs(v_variance_pct));
    v_implied_min := LEAST(COALESCE(v_implied_min, v_implied_scale), v_implied_scale);
    v_implied_max := GREATEST(COALESCE(v_implied_max, v_implied_scale), v_implied_scale);

    v_evidence := v_evidence || jsonb_build_array(
      jsonb_build_object(
        'check_number', v_check_number,
        'points', v_points,
        'labeled_distance_feet', round(v_labeled_feet, 4),
        'pixel_distance', round(v_pixel_distance, 4),
        'measured_distance_feet', round(v_measured_feet, 4),
        'variance_pct', round(v_variance_pct, 4),
        'implied_scale_feet_per_pixel', round(v_implied_scale, 10)
      )
    );
  END LOOP;

  IF (v_implied_min + v_implied_max) > 0 THEN
    v_scale_spread := ((v_implied_max - v_implied_min)
      / ((v_implied_max + v_implied_min) / 2)) * 100;
  END IF;

  v_outcome := CASE
    WHEN v_max_variance <= v_tolerance_pct
      AND v_scale_spread <= v_tolerance_pct THEN 'verified'
    ELSE 'conflict'
  END;

  PERFORM set_config('app.scale_assurance_sheet_id', p_plan_sheet_id::text, true);
  PERFORM set_config('app.scale_assurance_scale_revision', p_scale_revision::text, true);

  INSERT INTO public.estimate_scale_assessments (
    estimate_id,
    plan_sheet_id,
    scale_revision,
    outcome,
    tolerance_pct,
    max_variance_pct,
    scale_spread_pct,
    evidence,
    notes,
    created_by
  ) VALUES (
    p_estimate_id,
    p_plan_sheet_id,
    p_scale_revision,
    v_outcome,
    v_tolerance_pct,
    round(v_max_variance, 4),
    round(v_scale_spread, 4),
    v_evidence,
    left(COALESCE(p_notes, ''), 2000),
    (SELECT auth.uid())
  )
  RETURNING id INTO v_assessment_id;

  IF v_outcome = 'verified' THEN
    v_verified_at := now();
    UPDATE public.estimate_plan_sheets
    SET scale_verified_at = v_verified_at
    WHERE id = p_plan_sheet_id
      AND estimate_id = p_estimate_id
      AND scale_revision = p_scale_revision
    RETURNING id INTO v_updated_sheet_id;
  ELSE
    v_verified_at := NULL;
    UPDATE public.estimate_plan_sheets
    SET scale_verified_at = NULL
    WHERE id = p_plan_sheet_id
      AND estimate_id = p_estimate_id
      AND scale_revision = p_scale_revision
    RETURNING id INTO v_updated_sheet_id;
  END IF;

  IF v_updated_sheet_id IS NULL THEN
    RAISE EXCEPTION 'The sheet scale changed while the assurance result was saving.';
  END IF;

  RETURN QUERY SELECT
    v_assessment_id,
    v_outcome::varchar,
    round(v_max_variance, 4),
    round(v_scale_spread, 4),
    v_verified_at,
    v_evidence;
END;
$$;

-- A failed assurance review revokes trust just as a changed scale does. This
-- keeps a previously verified sheet from feeding the estimate after a later
-- cross-check proves that its active scale is unreliable.
CREATE OR REPLACE FUNCTION public.tg_invalidate_takeoffs_for_sheet_scale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.scale_revision IS DISTINCT FROM OLD.scale_revision THEN
    UPDATE public.estimate_takeoff_measurements
    SET
      calculation_status = CASE
        WHEN calculation_method = 'manual_override' THEN 'review_required'
        ELSE 'stale'
      END,
      updated_at = now()
    WHERE plan_sheet_id = NEW.id
      AND tool_type IN ('linear', 'area');
  ELSIF NEW.scale_verified_at IS NOT NULL
    AND OLD.scale_verified_at IS NULL THEN
    UPDATE public.estimate_takeoff_measurements
    SET
      calculation_status = 'current',
      updated_at = now()
    WHERE plan_sheet_id = NEW.id
      AND tool_type IN ('linear', 'area')
      AND calculation_status = 'unverified_scale'
      AND calculation_scale_revision = NEW.scale_revision;
  ELSIF NEW.scale_verified_at IS NULL
    AND OLD.scale_verified_at IS NOT NULL THEN
    UPDATE public.estimate_takeoff_measurements
    SET
      calculation_status = 'unverified_scale',
      updated_at = now()
    WHERE plan_sheet_id = NEW.id
      AND tool_type IN ('linear', 'area')
      AND calculation_status = 'current'
      AND calculation_scale_revision = NEW.scale_revision;
  END IF;

  RETURN NEW;
END;
$$;

-- Older builds allowed one dimension to set scale_verified_at. Preserve the
-- scale itself, but require honest two-check evidence before it remains
-- trusted under Scale Assurance. On replay, already-assured current revisions
-- are left alone.
UPDATE public.estimate_plan_sheets sheet
SET scale_verified_at = NULL
WHERE sheet.scale_verified_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.estimate_scale_assessments assessment
    WHERE assessment.plan_sheet_id = sheet.id
      AND assessment.scale_revision = sheet.scale_revision
      AND assessment.outcome = 'verified'
  );

REVOKE ALL ON TABLE public.estimate_scale_assessments FROM PUBLIC, anon;
GRANT SELECT, INSERT ON TABLE public.estimate_scale_assessments TO authenticated;
GRANT ALL ON TABLE public.estimate_scale_assessments TO service_role;

REVOKE EXECUTE ON FUNCTION public.record_estimate_scale_assessment(
  uuid, uuid, integer, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_estimate_scale_assessment(
  uuid, uuid, integer, jsonb, text
) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.tg_plan_sheet_takeoff_trust()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_invalidate_takeoffs_for_sheet_scale()
  FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.estimate_scale_assessments IS
  'Append-only, server-calculated evidence for two-check plan scale assurance.';
COMMENT ON COLUMN public.estimate_scale_assessments.evidence IS
  'Two normalized point pairs with labeled, measured, variance, and implied-scale values.';
COMMENT ON FUNCTION public.record_estimate_scale_assessment(
  uuid, uuid, integer, jsonb, text
) IS 'Records two scale checks atomically and applies or revokes sheet verification.';

NOTIFY pgrst, 'reload schema';
