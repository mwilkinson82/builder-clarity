-- Estimator-guided measurement scope queue.
--
-- AI may propose cited scope, but only an authenticated estimator can accept,
-- defer, reject, or complete it. Source evidence and review identity remain
-- durable across sheets and sessions. The table is read-only through the Data
-- API; narrowly scoped RPCs own every state transition.

CREATE TABLE IF NOT EXISTS public.estimate_measurement_scope_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  plan_sheet_id uuid NOT NULL REFERENCES public.estimate_plan_sheets(id) ON DELETE CASCADE,
  ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  suggestion_key text NOT NULL,
  scope_key text NOT NULL,
  label text NOT NULL,
  tool_type text NOT NULL,
  unit text NOT NULL,
  source_line text NOT NULL,
  source_excerpt text NOT NULL,
  source_anchor jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'accepted',
  decision_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_at timestamptz NOT NULL DEFAULT now(),
  takeoff_measurement_id uuid REFERENCES public.estimate_takeoff_measurements(id) ON DELETE SET NULL,
  estimate_line_item_id uuid REFERENCES public.estimate_line_items(id) ON DELETE SET NULL,
  library_item_id uuid REFERENCES public.cost_library_items(id) ON DELETE SET NULL,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  completed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_measurement_scope_items_suggestion_unique
    UNIQUE (estimate_id, plan_sheet_id, suggestion_key),
  CONSTRAINT estimate_measurement_scope_items_tool_check
    CHECK (tool_type IN ('linear', 'area')),
  CONSTRAINT estimate_measurement_scope_items_unit_check
    CHECK (unit IN ('LF', 'SF')),
  CONSTRAINT estimate_measurement_scope_items_status_check
    CHECK (status IN ('accepted', 'rejected', 'deferred', 'completed')),
  CONSTRAINT estimate_measurement_scope_items_anchor_check
    CHECK (
      source_anchor = '{}'::jsonb
      OR CASE
        WHEN jsonb_typeof(source_anchor) = 'object'
          AND jsonb_typeof(source_anchor -> 'x') = 'number'
          AND jsonb_typeof(source_anchor -> 'y') = 'number'
          AND jsonb_typeof(source_anchor -> 'width') = 'number'
          AND jsonb_typeof(source_anchor -> 'height') = 'number'
        THEN (source_anchor ->> 'x')::numeric BETWEEN 0 AND 1
          AND (source_anchor ->> 'y')::numeric BETWEEN 0 AND 1
          AND (source_anchor ->> 'width')::numeric > 0
          AND (source_anchor ->> 'width')::numeric <= 1
          AND (source_anchor ->> 'height')::numeric > 0
          AND (source_anchor ->> 'height')::numeric <= 1
          AND (source_anchor ->> 'x')::numeric + (source_anchor ->> 'width')::numeric <= 1
          AND (source_anchor ->> 'y')::numeric + (source_anchor ->> 'height')::numeric <= 1
        ELSE false
      END
    ),
  CONSTRAINT estimate_measurement_scope_items_suggestion_key_length
    CHECK (char_length(suggestion_key) BETWEEN 1 AND 160),
  CONSTRAINT estimate_measurement_scope_items_scope_key_length
    CHECK (char_length(scope_key) BETWEEN 1 AND 180),
  CONSTRAINT estimate_measurement_scope_items_label_length
    CHECK (char_length(label) BETWEEN 1 AND 120),
  CONSTRAINT estimate_measurement_scope_items_source_line_length
    CHECK (char_length(source_line) BETWEEN 1 AND 12),
  CONSTRAINT estimate_measurement_scope_items_excerpt_length
    CHECK (char_length(source_excerpt) BETWEEN 3 AND 260),
  CONSTRAINT estimate_measurement_scope_items_completion_check
    CHECK (
      (status = 'completed' AND takeoff_measurement_id IS NOT NULL AND completed_at IS NOT NULL)
      OR status <> 'completed'
    )
);

CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_queue_idx
  ON public.estimate_measurement_scope_items(estimate_id, status, decision_at DESC);
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_scope_idx
  ON public.estimate_measurement_scope_items(estimate_id, scope_key);
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_sheet_idx
  ON public.estimate_measurement_scope_items(plan_sheet_id, decision_at DESC);
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_takeoff_idx
  ON public.estimate_measurement_scope_items(takeoff_measurement_id)
  WHERE takeoff_measurement_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_ai_operation_idx
  ON public.estimate_measurement_scope_items(ai_operation_id)
  WHERE ai_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_line_idx
  ON public.estimate_measurement_scope_items(estimate_line_item_id)
  WHERE estimate_line_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_library_idx
  ON public.estimate_measurement_scope_items(library_item_id)
  WHERE library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_decision_by_idx
  ON public.estimate_measurement_scope_items(decision_by)
  WHERE decision_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_completed_by_idx
  ON public.estimate_measurement_scope_items(completed_by)
  WHERE completed_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_items_created_by_idx
  ON public.estimate_measurement_scope_items(created_by)
  WHERE created_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.estimate_measurement_scope_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_item_id uuid NOT NULL REFERENCES public.estimate_measurement_scope_items(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  takeoff_measurement_id uuid REFERENCES public.estimate_takeoff_measurements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_measurement_scope_events_action_check
    CHECK (action IN ('accepted', 'rejected', 'deferred', 'completed'))
);

CREATE INDEX IF NOT EXISTS estimate_measurement_scope_events_item_idx
  ON public.estimate_measurement_scope_events(scope_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_events_estimate_idx
  ON public.estimate_measurement_scope_events(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_events_actor_idx
  ON public.estimate_measurement_scope_events(actor_id)
  WHERE actor_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_measurement_scope_events_takeoff_idx
  ON public.estimate_measurement_scope_events(takeoff_measurement_id)
  WHERE takeoff_measurement_id IS NOT NULL;

ALTER TABLE public.estimate_measurement_scope_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_measurement_scope_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_measurement_scope_items FROM anon;
REVOKE ALL ON TABLE public.estimate_measurement_scope_items FROM authenticated;
GRANT SELECT ON TABLE public.estimate_measurement_scope_items TO authenticated;
GRANT ALL ON TABLE public.estimate_measurement_scope_items TO service_role;
REVOKE ALL ON TABLE public.estimate_measurement_scope_events FROM anon;
REVOKE ALL ON TABLE public.estimate_measurement_scope_events FROM authenticated;
GRANT SELECT ON TABLE public.estimate_measurement_scope_events TO authenticated;
GRANT ALL ON TABLE public.estimate_measurement_scope_events TO service_role;

DROP POLICY IF EXISTS estimate_measurement_scope_items_team_select
  ON public.estimate_measurement_scope_items;
CREATE POLICY estimate_measurement_scope_items_team_select
  ON public.estimate_measurement_scope_items
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_measurement_scope_events_team_select
  ON public.estimate_measurement_scope_events;
CREATE POLICY estimate_measurement_scope_events_team_select
  ON public.estimate_measurement_scope_events
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

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
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_item public.estimate_measurement_scope_items%ROWTYPE;
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
    actor_id
  ) VALUES (
    v_item.id,
    v_item.estimate_id,
    p_status,
    v_user_id
  );

  RETURN QUERY SELECT v_item.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_estimate_measurement_scope_item(
  p_scope_item_id uuid,
  p_takeoff_measurement_id uuid
)
RETURNS SETOF public.estimate_measurement_scope_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_scope public.estimate_measurement_scope_items%ROWTYPE;
  v_measurement public.estimate_takeoff_measurements%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_scope
  FROM public.estimate_measurement_scope_items
  WHERE id = p_scope_item_id
  FOR UPDATE;

  IF v_scope.id IS NULL OR NOT public.can_manage_estimate(v_scope.estimate_id) THEN
    RAISE EXCEPTION 'Scope item access is required.' USING ERRCODE = '42501';
  END IF;
  IF v_scope.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only queued scope can be completed.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_measurement
  FROM public.estimate_takeoff_measurements
  WHERE id = p_takeoff_measurement_id
    AND estimate_id = v_scope.estimate_id
    AND plan_sheet_id = v_scope.plan_sheet_id;

  IF v_measurement.id IS NULL THEN
    RAISE EXCEPTION 'The completed takeoff must belong to the cited sheet.' USING ERRCODE = '23503';
  END IF;

  UPDATE public.estimate_measurement_scope_items
  SET status = 'completed',
      decision_by = v_user_id,
      decision_at = now(),
      takeoff_measurement_id = v_measurement.id,
      estimate_line_item_id = v_measurement.estimate_line_item_id,
      library_item_id = v_measurement.library_item_id,
      completed_by = v_user_id,
      completed_at = now(),
      updated_at = now()
  WHERE id = v_scope.id
  RETURNING * INTO v_scope;

  INSERT INTO public.estimate_measurement_scope_events (
    scope_item_id,
    estimate_id,
    action,
    actor_id,
    takeoff_measurement_id
  ) VALUES (
    v_scope.id,
    v_scope.estimate_id,
    'completed',
    v_user_id,
    v_measurement.id
  );

  RETURN QUERY SELECT v_scope.*;
END;
$$;

REVOKE ALL ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.complete_estimate_measurement_scope_item(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_estimate_measurement_scope_decision(
  uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.complete_estimate_measurement_scope_item(uuid, uuid)
  TO authenticated, service_role;

COMMENT ON TABLE public.estimate_measurement_scope_items IS
  'Durable estimator decisions for AI-cited LF/SF scope; no row is a measured quantity.';
COMMENT ON TABLE public.estimate_measurement_scope_events IS
  'Append-only reviewer event trail for measurement-scope decisions and completion.';
COMMENT ON COLUMN public.estimate_measurement_scope_items.source_anchor IS
  'Normalized PDF evidence rectangle used only to navigate the estimator to the cited note.';
COMMENT ON COLUMN public.estimate_measurement_scope_items.scope_key IS
  'Normalized label/tool key used to warn about duplicate scope across sheets.';

NOTIFY pgrst, 'reload schema';
