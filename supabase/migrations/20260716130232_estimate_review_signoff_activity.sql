-- Immutable estimator sign-off and release-override activity.
--
-- AI and deterministic checks can surface evidence, but they never sign an
-- estimate. A manager records the human decision against a server-built
-- snapshot. The latest sign-off is current only while that exact estimate,
-- worksheet, takeoff, scale, assembly, and drawing-review state remains
-- unchanged. Export/push overrides are separate audited events and never make
-- an estimate appear signed off.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.estimate_review_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  activity_type text NOT NULL,
  note text NOT NULL,
  snapshot_hash text NOT NULL,
  snapshot jsonb NOT NULL,
  blocker_count integer NOT NULL,
  follow_up_count integer NOT NULL,
  total_cents bigint NOT NULL,
  reviewed_by uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_review_activities_sequence_check CHECK (sequence > 0),
  CONSTRAINT estimate_review_activities_type_check CHECK (
    activity_type IN (
      'signoff',
      'override_export_csv',
      'override_export_pdf',
      'override_push_project'
    )
  ),
  CONSTRAINT estimate_review_activities_note_check CHECK (
    char_length(note) BETWEEN 3 AND 2000
  ),
  CONSTRAINT estimate_review_activities_hash_check CHECK (
    snapshot_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT estimate_review_activities_snapshot_check CHECK (
    jsonb_typeof(snapshot) = 'object'
  ),
  CONSTRAINT estimate_review_activities_counts_check CHECK (
    blocker_count >= 0 AND follow_up_count >= 0 AND total_cents >= 0
  ),
  CONSTRAINT estimate_review_activities_estimate_sequence_unique UNIQUE (
    estimate_id,
    sequence
  )
);

CREATE INDEX IF NOT EXISTS estimate_review_activities_estimate_idx
  ON public.estimate_review_activities(estimate_id, sequence DESC);
CREATE INDEX IF NOT EXISTS estimate_review_activities_signoff_idx
  ON public.estimate_review_activities(estimate_id, sequence DESC)
  WHERE activity_type = 'signoff';
CREATE INDEX IF NOT EXISTS estimate_review_activities_reviewer_idx
  ON public.estimate_review_activities(reviewed_by, reviewed_at DESC);

ALTER TABLE public.estimate_review_activities ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_review_activities FROM anon, authenticated;
GRANT SELECT ON TABLE public.estimate_review_activities TO authenticated;
GRANT ALL ON TABLE public.estimate_review_activities TO service_role;

DROP POLICY IF EXISTS estimate_review_activities_team_select
  ON public.estimate_review_activities;
CREATE POLICY estimate_review_activities_team_select
  ON public.estimate_review_activities
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.build_estimate_review_snapshot(
  p_estimate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_estimate public.estimates%ROWTYPE;
  v_linked_takeoff_blockers integer;
  v_stale_assembly_links integer;
  v_unpriced_rows integer;
  v_zero_rows integer;
  v_plan_room_follow_ups integer;
BEGIN
  SELECT * INTO v_estimate
  FROM public.estimates
  WHERE id = p_estimate_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Estimate not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer INTO v_linked_takeoff_blockers
  FROM public.estimate_takeoff_measurements measurement
  WHERE measurement.estimate_id = p_estimate_id
    AND measurement.estimate_line_item_id IS NOT NULL
    AND measurement.calculation_status <> 'current';

  SELECT count(*)::integer INTO v_stale_assembly_links
  FROM public.estimate_takeoff_assembly_output_links link
  WHERE link.estimate_id = p_estimate_id
    AND link.status <> 'current';

  SELECT count(*)::integer INTO v_unpriced_rows
  FROM public.estimate_line_items line
  WHERE line.estimate_id = p_estimate_id
    AND line.quantity > 0
    AND line.material_unit_cost_cents = 0
    AND line.labor_unit_cost_cents = 0;

  SELECT count(*)::integer INTO v_zero_rows
  FROM public.estimate_line_items line
  WHERE line.estimate_id = p_estimate_id
    AND line.quantity = 0;

  SELECT count(*)::integer INTO v_plan_room_follow_ups
  FROM public.estimate_takeoff_measurements measurement
  WHERE measurement.estimate_id = p_estimate_id
    AND measurement.estimate_line_item_id IS NULL
    AND measurement.calculation_status <> 'current';

  RETURN jsonb_build_object(
    'schema_version', 1,
    'estimate', jsonb_build_object(
      'id', v_estimate.id,
      'name', v_estimate.name,
      'description', v_estimate.description,
      'opportunity_id', v_estimate.opportunity_id,
      'project_id', v_estimate.project_id,
      'project_type', v_estimate.project_type,
      'kind', v_estimate.kind,
      'region', v_estimate.region,
      'region_multiplier', v_estimate.region_multiplier,
      'overhead_pct', v_estimate.overhead_pct,
      'profit_pct', v_estimate.profit_pct,
      'contingency_pct', v_estimate.contingency_pct,
      'bond_pct', v_estimate.bond_pct,
      'tax_pct', v_estimate.tax_pct,
      'general_conditions_pct', v_estimate.general_conditions_pct,
      'custom_markups', v_estimate.custom_markups,
      'subtotal_material_cents', v_estimate.subtotal_material_cents,
      'subtotal_labor_cents', v_estimate.subtotal_labor_cents,
      'subtotal_cents', v_estimate.subtotal_cents,
      'total_with_markups_cents', v_estimate.total_with_markups_cents,
      'status', v_estimate.status,
      'folder', v_estimate.folder,
      'updated_at', v_estimate.updated_at
    ),
    'review_gate', jsonb_build_object(
      'blocker_count',
        v_linked_takeoff_blockers + v_stale_assembly_links + v_unpriced_rows,
      'follow_up_count', v_zero_rows + v_plan_room_follow_ups,
      'linked_quantity_blockers', v_linked_takeoff_blockers + v_stale_assembly_links,
      'unpriced_active_rows', v_unpriced_rows,
      'zero_quantity_rows', v_zero_rows,
      'plan_room_follow_ups', v_plan_room_follow_ups,
      'drawing_source_count', (
        SELECT count(*)::integer
        FROM public.estimate_takeoff_measurements measurement
        WHERE measurement.estimate_id = p_estimate_id
      ) + (
        SELECT count(*)::integer
        FROM public.estimate_takeoff_assembly_output_links link
        WHERE link.estimate_id = p_estimate_id
      ),
      'current_drawing_source_count', (
        SELECT count(*)::integer
        FROM public.estimate_takeoff_measurements measurement
        WHERE measurement.estimate_id = p_estimate_id
          AND measurement.calculation_status = 'current'
      ) + (
        SELECT count(*)::integer
        FROM public.estimate_takeoff_assembly_output_links link
        WHERE link.estimate_id = p_estimate_id
          AND link.status = 'current'
      )
    ),
    'line_items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', line.id,
          'csi_division', line.csi_division,
          'cost_code', line.cost_code,
          'description', line.description,
          'unit', line.unit,
          'quantity', line.quantity,
          'quantity_source', line.quantity_source,
          'takeoff_quantity', line.takeoff_quantity,
          'takeoff_synced_at', line.takeoff_synced_at,
          'assembly_output_quantity', line.assembly_output_quantity,
          'assembly_output_synced_at', line.assembly_output_synced_at,
          'material_unit_cost_cents', line.material_unit_cost_cents,
          'labor_unit_cost_cents', line.labor_unit_cost_cents,
          'library_item_id', line.library_item_id,
          'scope_group', line.scope_group,
          'sort_order', line.sort_order,
          'notes', line.notes,
          'updated_at', line.updated_at
        )
        ORDER BY line.sort_order, line.id
      )
      FROM public.estimate_line_items line
      WHERE line.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'plan_sets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', plan_set.id,
          'name', plan_set.name,
          'description', plan_set.description,
          'source_file_name', plan_set.source_file_name,
          'file_path', plan_set.file_path,
          'file_size_bytes', plan_set.file_size_bytes,
          'page_count', plan_set.page_count,
          'status', plan_set.status,
          'updated_at', plan_set.updated_at
        )
        ORDER BY plan_set.created_at, plan_set.id
      )
      FROM public.estimate_plan_sets plan_set
      WHERE plan_set.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'plan_sheets', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', sheet.id,
          'plan_set_id', sheet.plan_set_id,
          'sheet_number', sheet.sheet_number,
          'sheet_name', sheet.sheet_name,
          'discipline', sheet.discipline,
          'page_number', sheet.page_number,
          'sort_order', sheet.sort_order,
          'scale_label', sheet.scale_label,
          'scale_feet_per_pixel', sheet.scale_feet_per_pixel,
          'scale_revision', sheet.scale_revision,
          'scale_changed_at', sheet.scale_changed_at,
          'width_px', sheet.width_px,
          'height_px', sheet.height_px,
          'updated_at', sheet.updated_at
        )
        ORDER BY sheet.plan_set_id, sheet.sort_order, sheet.id
      )
      FROM public.estimate_plan_sheets sheet
      WHERE sheet.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'takeoff_measurements', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', measurement.id,
          'plan_sheet_id', measurement.plan_sheet_id,
          'estimate_line_item_id', measurement.estimate_line_item_id,
          'tool_type', measurement.tool_type,
          'label', measurement.label,
          'unit', measurement.unit,
          'quantity', measurement.quantity,
          'waste_pct', measurement.waste_pct,
          'geometry', measurement.geometry,
          'notes', measurement.notes,
          'calculation_method', measurement.calculation_method,
          'calculation_status', measurement.calculation_status,
          'calculated_quantity', measurement.calculated_quantity,
          'calculation_scale_revision', measurement.calculation_scale_revision,
          'calculated_at', measurement.calculated_at,
          'override_reason', measurement.override_reason,
          'ai_operation_id', measurement.ai_operation_id,
          'ai_review_action', measurement.ai_review_action,
          'ai_reviewed_at', measurement.ai_reviewed_at,
          'updated_at', measurement.updated_at
        )
        ORDER BY measurement.plan_sheet_id, measurement.created_at, measurement.id
      )
      FROM public.estimate_takeoff_measurements measurement
      WHERE measurement.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'assemblies', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', assembly.id,
          'takeoff_measurement_id', assembly.takeoff_measurement_id,
          'template_id', assembly.template_id,
          'formula_version', assembly.formula_version,
          'geometry_quantity', assembly.geometry_quantity,
          'geometry_unit', assembly.geometry_unit,
          'geometry_calculation_scale_revision', assembly.geometry_calculation_scale_revision,
          'confirmed_inputs', assembly.confirmed_inputs,
          'source_citations', assembly.source_citations,
          'derived_outputs', assembly.derived_outputs,
          'status', assembly.status,
          'confirmed_by', assembly.confirmed_by,
          'confirmed_at', assembly.confirmed_at,
          'updated_at', assembly.updated_at
        )
        ORDER BY assembly.created_at, assembly.id
      )
      FROM public.estimate_takeoff_assemblies assembly
      WHERE assembly.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'assembly_output_links', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', link.id,
          'assembly_id', link.assembly_id,
          'output_key', link.output_key,
          'estimate_line_item_id', link.estimate_line_item_id,
          'formula_version', link.formula_version,
          'output_label', link.output_label,
          'output_unit', link.output_unit,
          'output_quantity', link.output_quantity,
          'status', link.status,
          'last_synced_at', link.last_synced_at,
          'stale_at', link.stale_at,
          'updated_at', link.updated_at
        )
        ORDER BY link.created_at, link.id
      )
      FROM public.estimate_takeoff_assembly_output_links link
      WHERE link.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'revision_matches', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', match.id,
          'revision_plan_set_id', match.revision_plan_set_id,
          'revision_sheet_id', match.revision_sheet_id,
          'base_sheet_id', match.base_sheet_id,
          'proposal_method', match.proposal_method,
          'confidence', match.confidence,
          'review_action', match.review_action,
          'reviewed_at', match.reviewed_at,
          'updated_at', match.updated_at
        )
        ORDER BY match.reviewed_at, match.id
      )
      FROM public.estimate_plan_revision_matches match
      WHERE match.estimate_id = p_estimate_id
    ), '[]'::jsonb),
    'revision_impact_reviews', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', review.id,
          'revision_match_id', review.revision_match_id,
          'version', review.version,
          'disposition', review.disposition,
          'summary_notes', review.summary_notes,
          'impacts', review.impacts,
          'reviewed_by', review.reviewed_by,
          'reviewed_at', review.reviewed_at
        )
        ORDER BY review.reviewed_at, review.id
      )
      FROM public.estimate_plan_revision_impact_reviews review
      WHERE review.estimate_id = p_estimate_id
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.estimate_review_snapshot_hash(
  p_snapshot jsonb
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(COALESCE(p_snapshot, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
$$;

CREATE OR REPLACE FUNCTION public.get_estimate_review_state(
  p_estimate_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_snapshot jsonb;
  v_hash text;
  v_signoff public.estimate_review_activities%ROWTYPE;
  v_status text := 'unsigned';
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_read_estimate(p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate read access is required.' USING ERRCODE = '42501';
  END IF;

  v_snapshot := public.build_estimate_review_snapshot(p_estimate_id);
  v_hash := public.estimate_review_snapshot_hash(v_snapshot);

  SELECT * INTO v_signoff
  FROM public.estimate_review_activities activity
  WHERE activity.estimate_id = p_estimate_id
    AND activity.activity_type = 'signoff'
  ORDER BY activity.sequence DESC
  LIMIT 1;

  IF FOUND THEN
    v_status := CASE
      WHEN v_signoff.snapshot_hash = v_hash THEN 'current'
      ELSE 'stale'
    END;
  END IF;

  RETURN jsonb_build_object(
    'status', v_status,
    'current_snapshot_hash', v_hash,
    'blocker_count', (v_snapshot -> 'review_gate' ->> 'blocker_count')::integer,
    'follow_up_count', (v_snapshot -> 'review_gate' ->> 'follow_up_count')::integer,
    'latest_signoff_id', v_signoff.id,
    'latest_signoff_sequence', v_signoff.sequence,
    'latest_signoff_hash', v_signoff.snapshot_hash,
    'latest_signoff_reviewed_by', v_signoff.reviewed_by,
    'latest_signoff_reviewed_at', v_signoff.reviewed_at,
    'latest_signoff_note', v_signoff.note
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_estimate_review_activity(
  p_estimate_id uuid,
  p_activity_type text,
  p_note text
)
RETURNS SETOF public.estimate_review_activities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%ROWTYPE;
  v_snapshot jsonb;
  v_hash text;
  v_note text := btrim(COALESCE(p_note, ''));
  v_sequence integer;
  v_activity public.estimate_review_activities%ROWTYPE;
  v_latest_signoff_hash text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_estimate
  FROM public.estimates
  WHERE id = p_estimate_id
  FOR SHARE;

  IF NOT FOUND OR v_estimate.kind <> 'estimate'
    OR NOT public.can_manage_estimate(p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate management access is required.' USING ERRCODE = '42501';
  END IF;

  IF p_activity_type IS NULL OR p_activity_type NOT IN (
    'signoff',
    'override_export_csv',
    'override_export_pdf',
    'override_push_project'
  ) THEN
    RAISE EXCEPTION 'Choose a supported estimate review activity.' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_note) > 2000 THEN
    RAISE EXCEPTION 'Review notes may not exceed 2,000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_activity_type = 'signoff' AND char_length(v_note) < 3 THEN
    RAISE EXCEPTION 'Add a short estimator sign-off note.' USING ERRCODE = '22023';
  END IF;
  IF p_activity_type <> 'signoff' AND char_length(v_note) < 10 THEN
    RAISE EXCEPTION 'Explain why this unsigned or stale estimate may proceed.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_estimate_id::text || ':estimate-review', 0)
  );

  v_snapshot := public.build_estimate_review_snapshot(p_estimate_id);
  v_hash := public.estimate_review_snapshot_hash(v_snapshot);

  IF p_activity_type = 'signoff'
    AND (v_snapshot -> 'review_gate' ->> 'blocker_count')::integer > 0 THEN
    RAISE EXCEPTION 'Resolve every blocking review item before signing off this estimate.'
      USING ERRCODE = '23514';
  END IF;

  IF p_activity_type = 'signoff' THEN
    SELECT activity.snapshot_hash INTO v_latest_signoff_hash
    FROM public.estimate_review_activities activity
    WHERE activity.estimate_id = p_estimate_id
      AND activity.activity_type = 'signoff'
    ORDER BY activity.sequence DESC
    LIMIT 1;

    IF v_latest_signoff_hash = v_hash THEN
      RAISE EXCEPTION 'This exact estimate version already has a current sign-off.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  SELECT COALESCE(max(activity.sequence), 0) + 1 INTO v_sequence
  FROM public.estimate_review_activities activity
  WHERE activity.estimate_id = p_estimate_id;

  INSERT INTO public.estimate_review_activities (
    organization_id,
    estimate_id,
    sequence,
    activity_type,
    note,
    snapshot_hash,
    snapshot,
    blocker_count,
    follow_up_count,
    total_cents,
    reviewed_by,
    reviewed_at
  ) VALUES (
    v_estimate.organization_id,
    p_estimate_id,
    v_sequence,
    p_activity_type,
    v_note,
    v_hash,
    v_snapshot,
    (v_snapshot -> 'review_gate' ->> 'blocker_count')::integer,
    (v_snapshot -> 'review_gate' ->> 'follow_up_count')::integer,
    (v_snapshot -> 'estimate' ->> 'total_with_markups_cents')::bigint,
    v_user_id,
    now()
  )
  RETURNING * INTO v_activity;

  RETURN NEXT v_activity;
END;
$$;

REVOKE ALL ON FUNCTION public.build_estimate_review_snapshot(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.estimate_review_snapshot_hash(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_estimate_review_state(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_estimate_review_activity(uuid, text, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_estimate_review_state(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_estimate_review_activity(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_estimate_review_state(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_estimate_review_activity(uuid, text, text) TO service_role;

COMMENT ON TABLE public.estimate_review_activities IS
  'Append-only estimator sign-offs and audited unsigned/stale release overrides.';
COMMENT ON FUNCTION public.get_estimate_review_state(uuid) IS
  'Compares the latest human sign-off with the current deterministic estimate snapshot.';
COMMENT ON FUNCTION public.record_estimate_review_activity(uuid, text, text) IS
  'Manager-only writer for estimator sign-offs and explicit release overrides.';

NOTIFY pgrst, 'reload schema';
