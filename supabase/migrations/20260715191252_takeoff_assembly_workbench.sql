-- Estimator-controlled takeoff Assembly Workbench.
--
-- AI may extract explicit candidate inputs from already accepted, cited scope
-- notes. It never measures geometry and it never calculates an assembly. The
-- estimator confirms every input, and this migration's deterministic formula
-- function recomputes the authoritative outputs inside Postgres. Changes to
-- the underlying takeoff invalidate the confirmation without deleting history.

DO $$
BEGIN
  IF to_regclass('public.credit_ledger') IS NOT NULL THEN
    ALTER TABLE public.credit_ledger
      DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;

    ALTER TABLE public.credit_ledger
      ADD CONSTRAINT credit_ledger_reason_check CHECK (
        reason IN (
          'signup_grant',
          'monthly_plan_grant',
          'purchase',
          'ai_count_scan',
          'ai_measurement_plan',
          'ai_assembly_assumptions',
          'refund',
          'admin_adjustment'
        )
      );
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.ai_operations') IS NOT NULL THEN
    ALTER TABLE public.ai_operations
      DROP CONSTRAINT IF EXISTS ai_operations_operation_type_check;

    ALTER TABLE public.ai_operations
      ADD CONSTRAINT ai_operations_operation_type_check CHECK (
        operation_type IN (
          'ai_count_scan',
          'ai_measurement_plan',
          'ai_assembly_assumptions'
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_assemblies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  takeoff_measurement_id uuid NOT NULL UNIQUE
    REFERENCES public.estimate_takeoff_measurements(id) ON DELETE CASCADE,
  template_id text NOT NULL,
  formula_version text NOT NULL DEFAULT 'assembly-engine-v1',
  geometry_quantity numeric(16,4) NOT NULL,
  geometry_unit text NOT NULL,
  geometry_calculation_scale_revision integer,
  confirmed_inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_citations jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  ai_proposals jsonb NOT NULL DEFAULT '[]'::jsonb,
  derived_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'draft',
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_assemblies_template_check CHECK (
    template_id IN ('interior_wall', 'continuous_footing', 'mep_linear_run', 'surface_finish')
  ),
  CONSTRAINT estimate_takeoff_assemblies_geometry_unit_check CHECK (
    geometry_unit IN ('LF', 'SF')
  ),
  CONSTRAINT estimate_takeoff_assemblies_geometry_quantity_check CHECK (
    geometry_quantity > 0
  ),
  CONSTRAINT estimate_takeoff_assemblies_scale_revision_check CHECK (
    geometry_calculation_scale_revision IS NULL OR geometry_calculation_scale_revision >= 1
  ),
  CONSTRAINT estimate_takeoff_assemblies_inputs_object_check CHECK (
    jsonb_typeof(confirmed_inputs) = 'object'
  ),
  CONSTRAINT estimate_takeoff_assemblies_citations_array_check CHECK (
    jsonb_typeof(source_citations) = 'array'
  ),
  CONSTRAINT estimate_takeoff_assemblies_proposals_array_check CHECK (
    jsonb_typeof(ai_proposals) = 'array'
  ),
  CONSTRAINT estimate_takeoff_assemblies_outputs_array_check CHECK (
    jsonb_typeof(derived_outputs) = 'array'
  ),
  CONSTRAINT estimate_takeoff_assemblies_status_check CHECK (
    status IN ('draft', 'confirmed', 'stale')
  ),
  CONSTRAINT estimate_takeoff_assemblies_confirmation_check CHECK (
    (status = 'confirmed' AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL)
    OR status <> 'confirmed'
  )
);

CREATE INDEX IF NOT EXISTS estimate_takeoff_assemblies_estimate_idx
  ON public.estimate_takeoff_assemblies(estimate_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assemblies_status_idx
  ON public.estimate_takeoff_assemblies(estimate_id, status);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assemblies_ai_operation_idx
  ON public.estimate_takeoff_assemblies(ai_operation_id)
  WHERE ai_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_takeoff_assemblies_confirmed_by_idx
  ON public.estimate_takeoff_assemblies(confirmed_by)
  WHERE confirmed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_takeoff_assemblies_created_by_idx
  ON public.estimate_takeoff_assemblies(created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_assembly_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid NOT NULL REFERENCES public.estimate_takeoff_assemblies(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  output_key text NOT NULL,
  label text NOT NULL,
  unit text NOT NULL,
  quantity numeric(16,4) NOT NULL,
  rounding_method text NOT NULL,
  formula text NOT NULL,
  sort_order integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_assembly_outputs_unique UNIQUE (assembly_id, output_key),
  CONSTRAINT estimate_takeoff_assembly_outputs_unit_check CHECK (
    unit IN ('LF', 'SF', 'CY', 'EA', 'HR')
  ),
  CONSTRAINT estimate_takeoff_assembly_outputs_quantity_check CHECK (quantity >= 0),
  CONSTRAINT estimate_takeoff_assembly_outputs_rounding_check CHECK (
    rounding_method IN ('nearest_0.01', 'whole_up')
  ),
  CONSTRAINT estimate_takeoff_assembly_outputs_sort_check CHECK (sort_order >= 1)
);

CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_outputs_estimate_idx
  ON public.estimate_takeoff_assembly_outputs(estimate_id, assembly_id);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_outputs_assembly_idx
  ON public.estimate_takeoff_assembly_outputs(assembly_id, sort_order);

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_assembly_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assembly_id uuid NOT NULL REFERENCES public.estimate_takeoff_assemblies(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  formula_version text NOT NULL,
  geometry_quantity numeric(16,4) NOT NULL,
  geometry_unit text NOT NULL,
  geometry_calculation_scale_revision integer,
  confirmed_inputs jsonb NOT NULL,
  source_citations jsonb NOT NULL,
  ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  ai_proposals jsonb NOT NULL,
  derived_outputs jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_assembly_events_action_check CHECK (
    action IN ('saved_draft', 'confirmed', 'invalidated')
  ),
  CONSTRAINT estimate_takeoff_assembly_events_geometry_unit_check CHECK (
    geometry_unit IN ('LF', 'SF')
  ),
  CONSTRAINT estimate_takeoff_assembly_events_geometry_quantity_check CHECK (
    geometry_quantity > 0
  )
);

CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_events_assembly_idx
  ON public.estimate_takeoff_assembly_events(assembly_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_events_estimate_idx
  ON public.estimate_takeoff_assembly_events(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_events_actor_idx
  ON public.estimate_takeoff_assembly_events(actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_events_ai_operation_idx
  ON public.estimate_takeoff_assembly_events(ai_operation_id)
  WHERE ai_operation_id IS NOT NULL;

ALTER TABLE public.estimate_takeoff_assemblies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_takeoff_assembly_outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_takeoff_assembly_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_takeoff_assemblies FROM anon;
REVOKE ALL ON TABLE public.estimate_takeoff_assemblies FROM authenticated;
GRANT SELECT ON TABLE public.estimate_takeoff_assemblies TO authenticated;
GRANT ALL ON TABLE public.estimate_takeoff_assemblies TO service_role;
REVOKE ALL ON TABLE public.estimate_takeoff_assembly_outputs FROM anon;
REVOKE ALL ON TABLE public.estimate_takeoff_assembly_outputs FROM authenticated;
GRANT SELECT ON TABLE public.estimate_takeoff_assembly_outputs TO authenticated;
GRANT ALL ON TABLE public.estimate_takeoff_assembly_outputs TO service_role;
REVOKE ALL ON TABLE public.estimate_takeoff_assembly_events FROM anon;
REVOKE ALL ON TABLE public.estimate_takeoff_assembly_events FROM authenticated;
GRANT SELECT ON TABLE public.estimate_takeoff_assembly_events TO authenticated;
GRANT ALL ON TABLE public.estimate_takeoff_assembly_events TO service_role;

DROP POLICY IF EXISTS estimate_takeoff_assemblies_team_select
  ON public.estimate_takeoff_assemblies;
CREATE POLICY estimate_takeoff_assemblies_team_select
  ON public.estimate_takeoff_assemblies
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_takeoff_assembly_outputs_team_select
  ON public.estimate_takeoff_assembly_outputs;
CREATE POLICY estimate_takeoff_assembly_outputs_team_select
  ON public.estimate_takeoff_assembly_outputs
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_takeoff_assembly_events_team_select
  ON public.estimate_takeoff_assembly_events;
CREATE POLICY estimate_takeoff_assembly_events_team_select
  ON public.estimate_takeoff_assembly_events
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.calculate_takeoff_assembly_outputs(
  p_template_id text,
  p_geometry_quantity numeric,
  p_inputs jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_height numeric;
  v_sides numeric;
  v_board_layers numeric;
  v_board_sheet_area numeric;
  v_stud_spacing numeric;
  v_plate_runs numeric;
  v_insulation_layers numeric;
  v_width numeric;
  v_depth numeric;
  v_formed_sides numeric;
  v_rebar_runs numeric;
  v_rebar_lap numeric;
  v_parallel_runs numeric;
  v_support_spacing numeric;
  v_lap numeric;
  v_finish_layers numeric;
  v_coverage numeric;
  v_waste numeric;
  v_productivity numeric;
  v_wall_face numeric;
  v_board_area numeric;
  v_net_concrete numeric;
  v_concrete_with_waste numeric;
  v_base_run numeric;
  v_material numeric;
  v_installed_finish numeric;
BEGIN
  IF p_geometry_quantity IS NULL OR p_geometry_quantity <= 0 THEN
    RAISE EXCEPTION 'A positive trusted takeoff quantity is required.' USING ERRCODE = '22023';
  END IF;
  IF p_inputs IS NULL OR jsonb_typeof(p_inputs) <> 'object' THEN
    RAISE EXCEPTION 'Assembly inputs must be a JSON object.' USING ERRCODE = '22023';
  END IF;

  IF p_template_id = 'interior_wall' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_inputs) AS keys(input_key)
      WHERE input_key <> ALL (ARRAY[
        'height_ft', 'sides', 'board_layers_per_side', 'board_sheet_area_sf',
        'stud_spacing_in', 'plate_runs', 'insulation_layers', 'waste_pct',
        'productivity_sf_per_hour'
      ]::text[])
    ) THEN
      RAISE EXCEPTION 'Interior wall inputs contain an unsupported key.' USING ERRCODE = '22023';
    END IF;
    v_height := (p_inputs ->> 'height_ft')::numeric;
    v_sides := (p_inputs ->> 'sides')::numeric;
    v_board_layers := (p_inputs ->> 'board_layers_per_side')::numeric;
    v_board_sheet_area := (p_inputs ->> 'board_sheet_area_sf')::numeric;
    v_stud_spacing := (p_inputs ->> 'stud_spacing_in')::numeric;
    v_plate_runs := (p_inputs ->> 'plate_runs')::numeric;
    v_insulation_layers := (p_inputs ->> 'insulation_layers')::numeric;
    v_waste := (p_inputs ->> 'waste_pct')::numeric;
    v_productivity := (p_inputs ->> 'productivity_sf_per_hour')::numeric;
    IF v_height IS NULL OR v_height NOT BETWEEN 1 AND 50
      OR v_sides IS NULL OR v_sides NOT BETWEEN 1 AND 2
      OR v_sides <> trunc(v_sides)
      OR v_board_layers IS NULL OR v_board_layers NOT BETWEEN 1 AND 6
      OR v_board_layers <> trunc(v_board_layers)
      OR v_board_sheet_area IS NULL OR v_board_sheet_area NOT BETWEEN 8 AND 80
      OR v_stud_spacing IS NULL OR v_stud_spacing NOT BETWEEN 4 AND 48
      OR v_plate_runs IS NULL OR v_plate_runs NOT BETWEEN 1 AND 8
      OR v_plate_runs <> trunc(v_plate_runs)
      OR v_insulation_layers IS NULL OR v_insulation_layers NOT BETWEEN 0 AND 4
      OR v_insulation_layers <> trunc(v_insulation_layers)
      OR v_waste IS NULL OR v_waste NOT BETWEEN 0 AND 50
      OR v_productivity IS NULL OR v_productivity NOT BETWEEN 1 AND 500 THEN
      RAISE EXCEPTION 'Interior wall inputs are incomplete or outside allowed ranges.'
        USING ERRCODE = '22023';
    END IF;
    v_wall_face := p_geometry_quantity * v_height * v_sides;
    v_board_area := v_wall_face * v_board_layers * (1 + v_waste / 100);
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'wall_face_area_sf', 'label', 'Wall face area', 'unit', 'SF',
        'quantity', round(v_wall_face, 2), 'rounding', 'nearest_0.01',
        'formula', 'measured LF × wall height × finished sides'),
      jsonb_build_object('key', 'board_area_sf', 'label', 'Board including waste', 'unit', 'SF',
        'quantity', round(v_board_area, 2), 'rounding', 'nearest_0.01',
        'formula', 'wall face area × board layers per side × (1 + waste %)'),
      jsonb_build_object('key', 'board_sheets_ea', 'label', 'Board sheets', 'unit', 'EA',
        'quantity', ceil(v_board_area / v_board_sheet_area), 'rounding', 'whole_up',
        'formula', 'board including waste ÷ sheet coverage, rounded up'),
      jsonb_build_object('key', 'studs_ea', 'label', 'Studs', 'unit', 'EA',
        'quantity', ceil((p_geometry_quantity * 12) / v_stud_spacing + 1),
        'rounding', 'whole_up',
        'formula', 'measured inches ÷ stud spacing + one end stud, rounded up'),
      jsonb_build_object('key', 'plate_track_lf', 'label', 'Plate / track including waste', 'unit', 'LF',
        'quantity', round(p_geometry_quantity * v_plate_runs * (1 + v_waste / 100), 2),
        'rounding', 'nearest_0.01',
        'formula', 'measured LF × plate / track runs × (1 + waste %)'),
      jsonb_build_object('key', 'insulation_area_sf', 'label', 'Insulation including waste', 'unit', 'SF',
        'quantity', round(p_geometry_quantity * v_height * v_insulation_layers * (1 + v_waste / 100), 2),
        'rounding', 'nearest_0.01',
        'formula', 'measured LF × wall height × insulation layers × (1 + waste %)'),
      jsonb_build_object('key', 'labor_hours', 'label', 'Board labor', 'unit', 'HR',
        'quantity', round((v_wall_face * v_board_layers) / v_productivity, 2),
        'rounding', 'nearest_0.01',
        'formula', 'wall face area × board layers per side ÷ board productivity')
    );
  ELSIF p_template_id = 'continuous_footing' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_inputs) AS keys(input_key)
      WHERE input_key <> ALL (ARRAY[
        'width_in', 'depth_in', 'formed_sides', 'rebar_runs', 'rebar_lap_pct',
        'waste_pct', 'productivity_cy_per_hour'
      ]::text[])
    ) THEN
      RAISE EXCEPTION 'Continuous footing inputs contain an unsupported key.' USING ERRCODE = '22023';
    END IF;
    v_width := (p_inputs ->> 'width_in')::numeric;
    v_depth := (p_inputs ->> 'depth_in')::numeric;
    v_formed_sides := (p_inputs ->> 'formed_sides')::numeric;
    v_rebar_runs := (p_inputs ->> 'rebar_runs')::numeric;
    v_rebar_lap := (p_inputs ->> 'rebar_lap_pct')::numeric;
    v_waste := (p_inputs ->> 'waste_pct')::numeric;
    v_productivity := (p_inputs ->> 'productivity_cy_per_hour')::numeric;
    IF v_width IS NULL OR v_width NOT BETWEEN 1 AND 120
      OR v_depth IS NULL OR v_depth NOT BETWEEN 1 AND 120
      OR v_formed_sides IS NULL OR v_formed_sides NOT BETWEEN 0 AND 2
      OR v_formed_sides <> trunc(v_formed_sides)
      OR v_rebar_runs IS NULL OR v_rebar_runs NOT BETWEEN 0 AND 20
      OR v_rebar_runs <> trunc(v_rebar_runs)
      OR v_rebar_lap IS NULL OR v_rebar_lap NOT BETWEEN 0 AND 50
      OR v_waste IS NULL OR v_waste NOT BETWEEN 0 AND 50
      OR v_productivity IS NULL OR v_productivity NOT BETWEEN 0.01 AND 100 THEN
      RAISE EXCEPTION 'Continuous footing inputs are incomplete or outside allowed ranges.'
        USING ERRCODE = '22023';
    END IF;
    v_net_concrete := (p_geometry_quantity * (v_width / 12) * (v_depth / 12)) / 27;
    v_concrete_with_waste := v_net_concrete * (1 + v_waste / 100);
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'net_concrete_cy', 'label', 'Net concrete', 'unit', 'CY',
        'quantity', round(v_net_concrete, 2), 'rounding', 'nearest_0.01',
        'formula', 'measured LF × footing width FT × footing depth FT ÷ 27'),
      jsonb_build_object('key', 'concrete_with_waste_cy', 'label', 'Concrete including waste', 'unit', 'CY',
        'quantity', round(v_concrete_with_waste, 2), 'rounding', 'nearest_0.01',
        'formula', 'net concrete CY × (1 + waste %)'),
      jsonb_build_object('key', 'formwork_sf', 'label', 'Vertical formwork', 'unit', 'SF',
        'quantity', round(p_geometry_quantity * (v_depth / 12) * v_formed_sides, 2),
        'rounding', 'nearest_0.01',
        'formula', 'measured LF × footing depth FT × formed sides'),
      jsonb_build_object('key', 'rebar_lf', 'label', 'Continuous rebar including laps', 'unit', 'LF',
        'quantity', round(p_geometry_quantity * v_rebar_runs * (1 + v_rebar_lap / 100), 2),
        'rounding', 'nearest_0.01',
        'formula', 'measured LF × rebar runs × (1 + lap %)'),
      jsonb_build_object('key', 'labor_hours', 'label', 'Concrete placement labor', 'unit', 'HR',
        'quantity', round(v_concrete_with_waste / v_productivity, 2),
        'rounding', 'nearest_0.01',
        'formula', 'concrete including waste ÷ placement productivity')
    );
  ELSIF p_template_id = 'mep_linear_run' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_inputs) AS keys(input_key)
      WHERE input_key <> ALL (ARRAY[
        'parallel_runs', 'support_spacing_ft', 'lap_pct', 'waste_pct',
        'productivity_lf_per_hour'
      ]::text[])
    ) THEN
      RAISE EXCEPTION 'MEP linear run inputs contain an unsupported key.' USING ERRCODE = '22023';
    END IF;
    v_parallel_runs := (p_inputs ->> 'parallel_runs')::numeric;
    v_support_spacing := (p_inputs ->> 'support_spacing_ft')::numeric;
    v_lap := (p_inputs ->> 'lap_pct')::numeric;
    v_waste := (p_inputs ->> 'waste_pct')::numeric;
    v_productivity := (p_inputs ->> 'productivity_lf_per_hour')::numeric;
    IF v_parallel_runs IS NULL OR v_parallel_runs NOT BETWEEN 1 AND 50
      OR v_parallel_runs <> trunc(v_parallel_runs)
      OR v_support_spacing IS NULL OR v_support_spacing NOT BETWEEN 0.25 AND 100
      OR v_lap IS NULL OR v_lap NOT BETWEEN 0 AND 50
      OR v_waste IS NULL OR v_waste NOT BETWEEN 0 AND 50
      OR v_productivity IS NULL OR v_productivity NOT BETWEEN 0.1 AND 1000 THEN
      RAISE EXCEPTION 'MEP linear run inputs are incomplete or outside allowed ranges.'
        USING ERRCODE = '22023';
    END IF;
    v_base_run := p_geometry_quantity * v_parallel_runs;
    v_material := v_base_run * (1 + v_lap / 100 + v_waste / 100);
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'base_run_lf', 'label', 'Base run length', 'unit', 'LF',
        'quantity', round(v_base_run, 2), 'rounding', 'nearest_0.01',
        'formula', 'measured LF × parallel runs'),
      jsonb_build_object('key', 'material_lf', 'label', 'Run material including laps and waste', 'unit', 'LF',
        'quantity', round(v_material, 2), 'rounding', 'nearest_0.01',
        'formula', 'base run LF × (1 + lap % + waste %)'),
      jsonb_build_object('key', 'supports_ea', 'label', 'Supports', 'unit', 'EA',
        'quantity', ceil(p_geometry_quantity / v_support_spacing + 1),
        'rounding', 'whole_up',
        'formula', 'measured LF ÷ support spacing + one end support, rounded up'),
      jsonb_build_object('key', 'labor_hours', 'label', 'Installation labor', 'unit', 'HR',
        'quantity', round(v_material / v_productivity, 2), 'rounding', 'nearest_0.01',
        'formula', 'run material including laps and waste ÷ installation productivity')
    );
  ELSIF p_template_id = 'surface_finish' THEN
    IF EXISTS (
      SELECT 1 FROM jsonb_object_keys(p_inputs) AS keys(input_key)
      WHERE input_key <> ALL (ARRAY[
        'finish_layers', 'coverage_sf_per_unit', 'waste_pct',
        'productivity_sf_per_hour'
      ]::text[])
    ) THEN
      RAISE EXCEPTION 'Surface finish inputs contain an unsupported key.' USING ERRCODE = '22023';
    END IF;
    v_finish_layers := (p_inputs ->> 'finish_layers')::numeric;
    v_coverage := (p_inputs ->> 'coverage_sf_per_unit')::numeric;
    v_waste := (p_inputs ->> 'waste_pct')::numeric;
    v_productivity := (p_inputs ->> 'productivity_sf_per_hour')::numeric;
    IF v_finish_layers IS NULL OR v_finish_layers NOT BETWEEN 1 AND 10
      OR v_finish_layers <> trunc(v_finish_layers)
      OR v_coverage IS NULL OR v_coverage NOT BETWEEN 0.1 AND 10000
      OR v_waste IS NULL OR v_waste NOT BETWEEN 0 AND 50
      OR v_productivity IS NULL OR v_productivity NOT BETWEEN 1 AND 5000 THEN
      RAISE EXCEPTION 'Surface finish inputs are incomplete or outside allowed ranges.'
        USING ERRCODE = '22023';
    END IF;
    v_installed_finish := p_geometry_quantity * v_finish_layers * (1 + v_waste / 100);
    RETURN jsonb_build_array(
      jsonb_build_object('key', 'base_area_sf', 'label', 'Measured surface area', 'unit', 'SF',
        'quantity', round(p_geometry_quantity, 2), 'rounding', 'nearest_0.01',
        'formula', 'trusted measured SF'),
      jsonb_build_object('key', 'installed_finish_sf', 'label', 'Finish including layers and waste', 'unit', 'SF',
        'quantity', round(v_installed_finish, 2), 'rounding', 'nearest_0.01',
        'formula', 'measured SF × finish layers × (1 + waste %)'),
      jsonb_build_object('key', 'material_units_ea', 'label', 'Material units', 'unit', 'EA',
        'quantity', ceil(v_installed_finish / v_coverage), 'rounding', 'whole_up',
        'formula', 'finish including layers and waste ÷ material coverage, rounded up'),
      jsonb_build_object('key', 'labor_hours', 'label', 'Installation labor', 'unit', 'HR',
        'quantity', round((p_geometry_quantity * v_finish_layers) / v_productivity, 2),
        'rounding', 'nearest_0.01',
        'formula', 'measured SF × finish layers ÷ installation productivity')
    );
  END IF;

  RAISE EXCEPTION 'Assembly template is not supported.' USING ERRCODE = '22023';
END;
$$;

CREATE OR REPLACE FUNCTION public.save_estimate_takeoff_assembly(
  p_takeoff_measurement_id uuid,
  p_template_id text,
  p_inputs jsonb,
  p_ai_operation_id uuid,
  p_status text
)
RETURNS SETOF public.estimate_takeoff_assemblies
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_measurement public.estimate_takeoff_measurements%ROWTYPE;
  v_assembly public.estimate_takeoff_assemblies%ROWTYPE;
  v_outputs jsonb;
  v_citations jsonb := '[]'::jsonb;
  v_ai_proposals jsonb := '[]'::jsonb;
  v_action text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('draft', 'confirmed') THEN
    RAISE EXCEPTION 'Assembly status must be draft or confirmed.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_measurement
  FROM public.estimate_takeoff_measurements
  WHERE id = p_takeoff_measurement_id
  FOR UPDATE;

  IF v_measurement.id IS NULL OR NOT public.can_manage_estimate(v_measurement.estimate_id) THEN
    RAISE EXCEPTION 'Takeoff assembly access is required.' USING ERRCODE = '42501';
  END IF;
  IF v_measurement.tool_type NOT IN ('linear', 'area')
    OR v_measurement.calculation_status <> 'current'
    OR v_measurement.quantity <= 0 THEN
    RAISE EXCEPTION 'A current trusted linear or area takeoff is required.' USING ERRCODE = '22023';
  END IF;
  IF (p_template_id IN ('interior_wall', 'continuous_footing', 'mep_linear_run')
      AND v_measurement.unit <> 'LF')
    OR (p_template_id = 'surface_finish' AND v_measurement.unit <> 'SF') THEN
    RAISE EXCEPTION 'Assembly template does not match the takeoff unit.' USING ERRCODE = '22023';
  END IF;

  v_outputs := public.calculate_takeoff_assembly_outputs(
    p_template_id,
    v_measurement.quantity,
    p_inputs
  );

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'plan_sheet_id', scope.plan_sheet_id,
        'sheet_number', sheet.sheet_number,
        'source_line', scope.source_line,
        'source_excerpt', scope.source_excerpt
      ) ORDER BY scope.decision_at
    ),
    '[]'::jsonb
  ) INTO v_citations
  FROM public.estimate_measurement_scope_items scope
  JOIN public.estimate_plan_sheets sheet ON sheet.id = scope.plan_sheet_id
  WHERE scope.takeoff_measurement_id = v_measurement.id
    AND scope.status = 'completed';

  IF p_ai_operation_id IS NOT NULL THEN
    SELECT coalesce(operation.result -> 'proposals', '[]'::jsonb)
      INTO v_ai_proposals
    FROM public.ai_operations operation
    WHERE operation.id = p_ai_operation_id
      AND operation.estimate_id = v_measurement.estimate_id
      AND operation.operation_type = 'ai_assembly_assumptions'
      AND operation.status = 'succeeded'
      AND operation.request_context ->> 'takeoff_measurement_id' = v_measurement.id::text
      AND operation.result ->> 'template_id' = p_template_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'The cited AI assembly review is not valid for this estimate.'
        USING ERRCODE = '23503';
    END IF;
  END IF;

  INSERT INTO public.estimate_takeoff_assemblies (
    estimate_id,
    takeoff_measurement_id,
    template_id,
    formula_version,
    geometry_quantity,
    geometry_unit,
    geometry_calculation_scale_revision,
    confirmed_inputs,
    source_citations,
    ai_operation_id,
    ai_proposals,
    derived_outputs,
    status,
    confirmed_by,
    confirmed_at,
    created_by,
    updated_at
  ) VALUES (
    v_measurement.estimate_id,
    v_measurement.id,
    p_template_id,
    'assembly-engine-v1',
    v_measurement.quantity,
    v_measurement.unit,
    v_measurement.calculation_scale_revision,
    p_inputs,
    v_citations,
    p_ai_operation_id,
    v_ai_proposals,
    v_outputs,
    p_status,
    CASE WHEN p_status = 'confirmed' THEN v_user_id ELSE NULL END,
    CASE WHEN p_status = 'confirmed' THEN now() ELSE NULL END,
    v_user_id,
    now()
  )
  ON CONFLICT (takeoff_measurement_id)
  DO UPDATE SET
    template_id = EXCLUDED.template_id,
    formula_version = EXCLUDED.formula_version,
    geometry_quantity = EXCLUDED.geometry_quantity,
    geometry_unit = EXCLUDED.geometry_unit,
    geometry_calculation_scale_revision = EXCLUDED.geometry_calculation_scale_revision,
    confirmed_inputs = EXCLUDED.confirmed_inputs,
    source_citations = EXCLUDED.source_citations,
    ai_operation_id = EXCLUDED.ai_operation_id,
    ai_proposals = EXCLUDED.ai_proposals,
    derived_outputs = EXCLUDED.derived_outputs,
    status = EXCLUDED.status,
    confirmed_by = EXCLUDED.confirmed_by,
    confirmed_at = EXCLUDED.confirmed_at,
    updated_at = now()
  RETURNING * INTO v_assembly;

  DELETE FROM public.estimate_takeoff_assembly_outputs
  WHERE assembly_id = v_assembly.id;

  INSERT INTO public.estimate_takeoff_assembly_outputs (
    assembly_id,
    estimate_id,
    output_key,
    label,
    unit,
    quantity,
    rounding_method,
    formula,
    sort_order
  )
  SELECT
    v_assembly.id,
    v_assembly.estimate_id,
    output ->> 'key',
    output ->> 'label',
    output ->> 'unit',
    (output ->> 'quantity')::numeric,
    output ->> 'rounding',
    output ->> 'formula',
    ordinal::integer
  FROM jsonb_array_elements(v_outputs) WITH ORDINALITY AS rows(output, ordinal);

  v_action := CASE WHEN p_status = 'confirmed' THEN 'confirmed' ELSE 'saved_draft' END;
  INSERT INTO public.estimate_takeoff_assembly_events (
    assembly_id,
    estimate_id,
    action,
    actor_id,
    formula_version,
    geometry_quantity,
    geometry_unit,
    geometry_calculation_scale_revision,
    confirmed_inputs,
    source_citations,
    ai_operation_id,
    ai_proposals,
    derived_outputs
  ) VALUES (
    v_assembly.id,
    v_assembly.estimate_id,
    v_action,
    v_user_id,
    v_assembly.formula_version,
    v_assembly.geometry_quantity,
    v_assembly.geometry_unit,
    v_assembly.geometry_calculation_scale_revision,
    v_assembly.confirmed_inputs,
    v_assembly.source_citations,
    v_assembly.ai_operation_id,
    v_assembly.ai_proposals,
    v_assembly.derived_outputs
  );

  RETURN QUERY SELECT v_assembly.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_invalidate_takeoff_assembly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.quantity IS DISTINCT FROM OLD.quantity
    OR NEW.calculation_status IS DISTINCT FROM OLD.calculation_status
    OR NEW.calculation_scale_revision IS DISTINCT FROM OLD.calculation_scale_revision THEN
    WITH invalidated AS (
      UPDATE public.estimate_takeoff_assemblies
      SET status = 'stale',
          confirmed_by = NULL,
          confirmed_at = NULL,
          updated_at = now()
      WHERE takeoff_measurement_id = NEW.id
        AND status <> 'stale'
      RETURNING *
    )
    INSERT INTO public.estimate_takeoff_assembly_events (
      assembly_id,
      estimate_id,
      action,
      actor_id,
      formula_version,
      geometry_quantity,
      geometry_unit,
      geometry_calculation_scale_revision,
      confirmed_inputs,
      source_citations,
      ai_operation_id,
      ai_proposals,
      derived_outputs
    )
    SELECT
      assembly.id,
      assembly.estimate_id,
      'invalidated',
      (SELECT auth.uid()),
      assembly.formula_version,
      assembly.geometry_quantity,
      assembly.geometry_unit,
      assembly.geometry_calculation_scale_revision,
      assembly.confirmed_inputs,
      assembly.source_citations,
      assembly.ai_operation_id,
      assembly.ai_proposals,
      assembly.derived_outputs
    FROM invalidated assembly;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimate_takeoff_assembly_invalidate
  ON public.estimate_takeoff_measurements;
CREATE TRIGGER estimate_takeoff_assembly_invalidate
  AFTER UPDATE OF quantity, calculation_status, calculation_scale_revision
  ON public.estimate_takeoff_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_invalidate_takeoff_assembly();

REVOKE ALL ON FUNCTION public.calculate_takeoff_assembly_outputs(text, numeric, jsonb)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_estimate_takeoff_assembly(uuid, text, jsonb, uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_invalidate_takeoff_assembly()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate_takeoff_assembly(uuid, text, jsonb, uuid, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.estimate_takeoff_assemblies IS
  'Current estimator-controlled assembly state for a trusted takeoff; AI proposals are evidence only.';
COMMENT ON TABLE public.estimate_takeoff_assembly_outputs IS
  'Normalized deterministic assembly outputs recomputed by Postgres from confirmed inputs.';
COMMENT ON TABLE public.estimate_takeoff_assembly_events IS
  'Append-only snapshots of assembly drafts, confirmations, and invalidations.';
COMMENT ON COLUMN public.estimate_takeoff_assemblies.formula_version IS
  'Immutable calculation contract identifier used for every derived output.';
COMMENT ON COLUMN public.estimate_takeoff_assemblies.geometry_quantity IS
  'Trusted takeoff quantity captured when this assembly version was saved.';

NOTIFY pgrst, 'reload schema';
