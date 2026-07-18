-- Durable provenance for AI attention-layer geometry.
--
-- A guide is an approximate visual callout tied to cited drawing evidence. It
-- is never a quantity and can never update an estimate row. The estimator's
-- accepted takeoff remains a separate, scaled measurement with its own final
-- geometry. This migration keeps the original guide and the decision snapshot
-- so later review can distinguish what AI suggested from what the estimator
-- ultimately measured.

ALTER TABLE public.estimate_measurement_scope_items
  ADD COLUMN IF NOT EXISTS guide_geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS guide_source text;

ALTER TABLE public.estimate_measurement_scope_events
  ADD COLUMN IF NOT EXISTS proposal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.estimate_measurement_scope_items
  DROP CONSTRAINT IF EXISTS estimate_measurement_scope_items_guide_check,
  DROP CONSTRAINT IF EXISTS estimate_measurement_scope_items_guide_source_check;

ALTER TABLE public.estimate_measurement_scope_items
  ADD CONSTRAINT estimate_measurement_scope_items_guide_check CHECK (
    guide_geometry = '{}'::jsonb
    OR (
      jsonb_typeof(guide_geometry) = 'object'
      AND guide_geometry ->> 'kind' IN ('linear_route', 'area_region')
      AND guide_geometry ->> 'source' = 'ai_visual_hint'
      AND jsonb_typeof(guide_geometry -> 'points') = 'array'
      AND jsonb_array_length(guide_geometry -> 'points') BETWEEN 2 AND 16
    )
  ),
  ADD CONSTRAINT estimate_measurement_scope_items_guide_source_check CHECK (
    (guide_geometry = '{}'::jsonb AND guide_source IS NULL)
    OR (guide_geometry <> '{}'::jsonb AND guide_source = 'ai_visual_hint')
  );

CREATE OR REPLACE FUNCTION public.record_estimate_measurement_scope_decision(
  p_estimate_id uuid,
  p_plan_sheet_id uuid,
  p_ai_operation_id uuid,
  p_suggestion_key text,
  p_scope_key text,
  p_label text,
  p_tool_type text,
  p_unit text,
  p_source_line text,
  p_source_excerpt text,
  p_source_anchor jsonb,
  p_guide_geometry jsonb,
  p_status text
)
RETURNS SETOF public.estimate_measurement_scope_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_item public.estimate_measurement_scope_items%ROWTYPE;
  v_guide jsonb := coalesce(p_guide_geometry, '{}'::jsonb);
  v_point jsonb;
BEGIN
  IF v_user_id IS NULL OR NOT public.can_manage_estimate(p_estimate_id) THEN
    RAISE EXCEPTION 'Estimate access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_status NOT IN ('accepted', 'rejected', 'deferred') THEN
    RAISE EXCEPTION 'Unsupported scope decision.' USING ERRCODE = '22023';
  END IF;
  IF p_tool_type NOT IN ('linear', 'area')
    OR (p_tool_type = 'linear' AND p_unit <> 'LF')
    OR (p_tool_type = 'area' AND p_unit <> 'SF') THEN
    RAISE EXCEPTION 'Measurement tool and unit do not agree.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.estimate_plan_sheets ps
    WHERE ps.id = p_plan_sheet_id
      AND ps.estimate_id = p_estimate_id
  ) THEN
    RAISE EXCEPTION 'The cited sheet does not belong to this estimate.' USING ERRCODE = '23503';
  END IF;
  IF p_ai_operation_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.ai_operations operation
    WHERE operation.id = p_ai_operation_id
      AND operation.estimate_id = p_estimate_id
      AND operation.operation_type = 'ai_measurement_plan'
  ) THEN
    RAISE EXCEPTION 'The AI review does not belong to this estimate.' USING ERRCODE = '23503';
  END IF;

  IF v_guide <> '{}'::jsonb THEN
    IF jsonb_typeof(v_guide) <> 'object'
      OR v_guide ->> 'source' <> 'ai_visual_hint'
      OR jsonb_typeof(v_guide -> 'points') <> 'array'
      OR jsonb_array_length(v_guide -> 'points') NOT BETWEEN 2 AND 16
      OR (p_tool_type = 'linear' AND v_guide ->> 'kind' <> 'linear_route')
      OR (p_tool_type = 'area' AND v_guide ->> 'kind' <> 'area_region')
      OR (p_tool_type = 'area' AND jsonb_array_length(v_guide -> 'points') < 3)
    THEN
      RAISE EXCEPTION 'The AI guide geometry does not match the measurement tool.'
        USING ERRCODE = '22023';
    END IF;

    FOR v_point IN SELECT value FROM jsonb_array_elements(v_guide -> 'points') LOOP
      IF jsonb_typeof(v_point) <> 'object'
        OR jsonb_typeof(v_point -> 'x') IS DISTINCT FROM 'number'
        OR jsonb_typeof(v_point -> 'y') IS DISTINCT FROM 'number'
        OR (v_point ->> 'x')::numeric NOT BETWEEN 0 AND 1
        OR (v_point ->> 'y')::numeric NOT BETWEEN 0 AND 1
      THEN
        RAISE EXCEPTION 'AI guide points must use normalized drawing coordinates.'
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  INSERT INTO public.estimate_measurement_scope_items (
    estimate_id,
    plan_sheet_id,
    ai_operation_id,
    suggestion_key,
    scope_key,
    label,
    tool_type,
    unit,
    source_line,
    source_excerpt,
    source_anchor,
    guide_geometry,
    guide_source,
    status,
    decision_by,
    decision_at,
    created_by
  ) VALUES (
    p_estimate_id,
    p_plan_sheet_id,
    p_ai_operation_id,
    left(trim(p_suggestion_key), 160),
    left(trim(p_scope_key), 180),
    left(trim(p_label), 120),
    p_tool_type,
    p_unit,
    left(trim(p_source_line), 12),
    left(trim(p_source_excerpt), 260),
    CASE WHEN jsonb_typeof(coalesce(p_source_anchor, '{}'::jsonb)) = 'object'
      THEN coalesce(p_source_anchor, '{}'::jsonb)
      ELSE '{}'::jsonb
    END,
    v_guide,
    CASE WHEN v_guide = '{}'::jsonb THEN NULL ELSE 'ai_visual_hint' END,
    p_status,
    v_user_id,
    now(),
    v_user_id
  )
  ON CONFLICT (estimate_id, plan_sheet_id, suggestion_key)
  DO UPDATE SET
    ai_operation_id = EXCLUDED.ai_operation_id,
    scope_key = EXCLUDED.scope_key,
    label = EXCLUDED.label,
    tool_type = EXCLUDED.tool_type,
    unit = EXCLUDED.unit,
    source_line = EXCLUDED.source_line,
    source_excerpt = EXCLUDED.source_excerpt,
    source_anchor = EXCLUDED.source_anchor,
    guide_geometry = EXCLUDED.guide_geometry,
    guide_source = EXCLUDED.guide_source,
    status = EXCLUDED.status,
    decision_by = v_user_id,
    decision_at = now(),
    takeoff_measurement_id = NULL,
    estimate_line_item_id = NULL,
    library_item_id = NULL,
    completed_by = NULL,
    completed_at = NULL,
    updated_at = now()
  RETURNING * INTO v_item;

  INSERT INTO public.estimate_measurement_scope_events (
    scope_item_id,
    estimate_id,
    action,
    actor_id,
    proposal_snapshot
  ) VALUES (
    v_item.id,
    v_item.estimate_id,
    p_status,
    v_user_id,
    jsonb_build_object(
      'label', v_item.label,
      'tool_type', v_item.tool_type,
      'unit', v_item.unit,
      'source_line', v_item.source_line,
      'source_excerpt', v_item.source_excerpt,
      'source_anchor', v_item.source_anchor,
      'guide_geometry', v_item.guide_geometry,
      'guide_source', v_item.guide_source,
      'ai_operation_id', v_item.ai_operation_id
    )
  );

  RETURN QUERY SELECT v_item.*;
END;
$$;

-- Keep the previous RPC signature working during the code/deploy transition.
-- It delegates to the provenance-aware overload with an empty visual guide.
CREATE OR REPLACE FUNCTION public.record_estimate_measurement_scope_decision(
  p_estimate_id uuid,
  p_plan_sheet_id uuid,
  p_ai_operation_id uuid,
  p_suggestion_key text,
  p_scope_key text,
  p_label text,
  p_tool_type text,
  p_unit text,
  p_source_line text,
  p_source_excerpt text,
  p_source_anchor jsonb,
  p_status text
)
RETURNS SETOF public.estimate_measurement_scope_items
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT *
  FROM public.record_estimate_measurement_scope_decision(
    p_estimate_id,
    p_plan_sheet_id,
    p_ai_operation_id,
    p_suggestion_key,
    p_scope_key,
    p_label,
    p_tool_type,
    p_unit,
    p_source_line,
    p_source_excerpt,
    p_source_anchor,
    '{}'::jsonb,
    p_status
  );
$$;

REVOKE ALL ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, jsonb, text
) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text
) TO authenticated, service_role;

COMMENT ON COLUMN public.estimate_measurement_scope_items.guide_geometry IS
  'Original normalized AI visual-callout geometry. It is never used to calculate a quantity.';
COMMENT ON COLUMN public.estimate_measurement_scope_items.guide_source IS
  'Origin of the visual callout; currently limited to ai_visual_hint.';
COMMENT ON COLUMN public.estimate_measurement_scope_events.proposal_snapshot IS
  'Immutable proposal evidence captured when the estimator accepted, deferred, or rejected scope.';

NOTIFY pgrst, 'reload schema';
