-- Company symbol identification library for estimator-reviewed AI markups.
--
-- The AI may suggest a visual label from accepted examples, but a library
-- example is written only after an estimator accepts at least one proposed
-- count. Tables are read-only through the Data API; the authenticated save RPC
-- rebuilds organization, estimate, sheet, operation, and cost-library context.

CREATE TABLE IF NOT EXISTS public.ai_symbol_library_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label text NOT NULL,
  normalized_label text NOT NULL,
  trade text NOT NULL DEFAULT '',
  unit text NOT NULL DEFAULT 'EA',
  cost_library_item_id uuid REFERENCES public.cost_library_items(id) ON DELETE SET NULL,
  active boolean NOT NULL DEFAULT true,
  use_count integer NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_symbol_library_items_label_check CHECK (
    char_length(btrim(label)) BETWEEN 1 AND 240
  ),
  CONSTRAINT ai_symbol_library_items_normalized_label_check CHECK (
    char_length(btrim(normalized_label)) BETWEEN 1 AND 240
  ),
  CONSTRAINT ai_symbol_library_items_trade_check CHECK (char_length(trade) <= 80),
  CONSTRAINT ai_symbol_library_items_unit_check CHECK (
    char_length(btrim(unit)) BETWEEN 1 AND 16
  ),
  CONSTRAINT ai_symbol_library_items_use_count_check CHECK (use_count >= 0),
  CONSTRAINT ai_symbol_library_items_org_label_unique UNIQUE (
    organization_id,
    normalized_label
  )
);

CREATE TABLE IF NOT EXISTS public.ai_symbol_library_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  library_item_id uuid NOT NULL
    REFERENCES public.ai_symbol_library_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_estimate_id uuid REFERENCES public.estimates(id) ON DELETE SET NULL,
  source_plan_sheet_id uuid REFERENCES public.estimate_plan_sheets(id) ON DELETE SET NULL,
  source_ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  source_point jsonb NOT NULL,
  source_point_key text NOT NULL,
  exemplar_storage_path text NOT NULL,
  embedding jsonb NOT NULL,
  accepted_count integer NOT NULL,
  rejected_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_symbol_library_examples_point_object_check CHECK (
    jsonb_typeof(source_point) = 'object'
  ),
  CONSTRAINT ai_symbol_library_examples_embedding_array_check CHECK (
    jsonb_typeof(embedding) = 'array'
    AND jsonb_array_length(embedding) BETWEEN 64 AND 4096
  ),
  CONSTRAINT ai_symbol_library_examples_storage_path_check CHECK (
    char_length(btrim(exemplar_storage_path)) BETWEEN 1 AND 1000
  ),
  CONSTRAINT ai_symbol_library_examples_counts_check CHECK (
    accepted_count > 0
    AND accepted_count <= 96
    AND rejected_count >= 0
    AND rejected_count <= 96
  ),
  CONSTRAINT ai_symbol_library_examples_source_unique UNIQUE (
    source_ai_operation_id,
    source_plan_sheet_id,
    source_point_key
  )
);

CREATE INDEX IF NOT EXISTS ai_symbol_library_items_org_active_idx
  ON public.ai_symbol_library_items(organization_id, active, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_symbol_library_items_cost_item_idx
  ON public.ai_symbol_library_items(cost_library_item_id)
  WHERE cost_library_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_symbol_library_items_created_by_idx
  ON public.ai_symbol_library_items(created_by)
  WHERE created_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_library_idx
  ON public.ai_symbol_library_examples(library_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_org_idx
  ON public.ai_symbol_library_examples(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_estimate_idx
  ON public.ai_symbol_library_examples(source_estimate_id)
  WHERE source_estimate_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_sheet_idx
  ON public.ai_symbol_library_examples(source_plan_sheet_id)
  WHERE source_plan_sheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_operation_idx
  ON public.ai_symbol_library_examples(source_ai_operation_id)
  WHERE source_ai_operation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ai_symbol_library_examples_created_by_idx
  ON public.ai_symbol_library_examples(created_by)
  WHERE created_by IS NOT NULL;

DO $$
BEGIN
  IF to_regprocedure('public.tg_set_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS ai_symbol_library_items_set_updated_at
      ON public.ai_symbol_library_items;
    CREATE TRIGGER ai_symbol_library_items_set_updated_at
      BEFORE UPDATE ON public.ai_symbol_library_items
      FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
  END IF;
END
$$;

ALTER TABLE public.ai_symbol_library_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_symbol_library_examples ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_symbol_library_items FROM anon;
REVOKE ALL ON TABLE public.ai_symbol_library_items FROM authenticated;
REVOKE ALL ON TABLE public.ai_symbol_library_examples FROM anon;
REVOKE ALL ON TABLE public.ai_symbol_library_examples FROM authenticated;
GRANT SELECT ON TABLE public.ai_symbol_library_items TO authenticated;
GRANT SELECT ON TABLE public.ai_symbol_library_examples TO authenticated;
GRANT ALL ON TABLE public.ai_symbol_library_items TO service_role;
GRANT ALL ON TABLE public.ai_symbol_library_examples TO service_role;

DROP POLICY IF EXISTS ai_symbol_library_items_org_select
  ON public.ai_symbol_library_items;
CREATE POLICY ai_symbol_library_items_org_select
  ON public.ai_symbol_library_items
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS ai_symbol_library_examples_org_select
  ON public.ai_symbol_library_examples;
CREATE POLICY ai_symbol_library_examples_org_select
  ON public.ai_symbol_library_examples
  FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('ai-symbol-library', 'ai-symbol-library', false)
    ON CONFLICT (id) DO UPDATE SET public = false;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.save_ai_symbol_library_example(
  p_estimate_id uuid,
  p_plan_sheet_id uuid,
  p_ai_operation_id uuid,
  p_label text,
  p_trade text,
  p_unit text,
  p_cost_library_item_id uuid,
  p_source_point jsonb,
  p_exemplar_storage_path text,
  p_embedding jsonb,
  p_accepted_count integer,
  p_rejected_count integer
)
RETURNS TABLE(library_item_id uuid, example_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_operation public.ai_operations%ROWTYPE;
  v_label text := pg_catalog.btrim(COALESCE(p_label, ''));
  v_normalized_label text;
  v_trade text := pg_catalog.btrim(COALESCE(p_trade, ''));
  v_unit text := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_unit, 'EA')));
  v_x numeric;
  v_y numeric;
  v_source_point_key text;
  v_library_item_id uuid;
  v_example_id uuid;
  v_expected_path_prefix text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT e.organization_id
  INTO v_organization_id
  FROM public.estimates AS e
  WHERE e.id = p_estimate_id
    AND public.can_manage_estimate(e.id);

  IF v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Estimate management access is required.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.estimate_plan_sheets AS s
    WHERE s.id = p_plan_sheet_id
      AND s.estimate_id = p_estimate_id
  ) THEN
    RAISE EXCEPTION 'The source sheet does not belong to this estimate.';
  END IF;

  SELECT *
  INTO v_operation
  FROM public.ai_operations AS operation
  WHERE operation.id = p_ai_operation_id;

  IF NOT FOUND
    OR v_operation.created_by IS DISTINCT FROM v_user_id
    OR v_operation.organization_id IS DISTINCT FROM v_organization_id
    OR v_operation.estimate_id IS DISTINCT FROM p_estimate_id
    OR v_operation.operation_type <> 'ai_count_scan'
    OR v_operation.status <> 'succeeded'
    OR NOT (p_plan_sheet_id = ANY(v_operation.sheet_ids)) THEN
    RAISE EXCEPTION 'A completed count discovery owned by this estimator is required.';
  END IF;

  IF char_length(v_label) NOT BETWEEN 1 AND 240 THEN
    RAISE EXCEPTION 'Enter a symbol label between 1 and 240 characters.';
  END IF;
  IF char_length(v_trade) > 80 THEN
    RAISE EXCEPTION 'Trade may not exceed 80 characters.';
  END IF;
  IF char_length(v_unit) NOT BETWEEN 1 AND 16 THEN
    RAISE EXCEPTION 'Unit may not exceed 16 characters.';
  END IF;
  IF p_accepted_count IS NULL OR p_accepted_count NOT BETWEEN 1 AND 96
    OR COALESCE(p_rejected_count, 0) NOT BETWEEN 0 AND 96 THEN
    RAISE EXCEPTION 'Only an estimator-reviewed group with accepted counts can be learned.';
  END IF;

  IF pg_catalog.jsonb_typeof(p_source_point) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The accepted source point is required.';
  END IF;
  BEGIN
    v_x := (p_source_point ->> 'x')::numeric;
    v_y := (p_source_point ->> 'y')::numeric;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'The accepted source point is invalid.';
  END;
  IF v_x NOT BETWEEN 0 AND 1 OR v_y NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'The accepted source point must be on the drawing.';
  END IF;

  IF pg_catalog.jsonb_typeof(p_embedding) IS DISTINCT FROM 'array'
    OR pg_catalog.jsonb_array_length(p_embedding) NOT BETWEEN 64 AND 4096
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_embedding) AS element(value)
      WHERE pg_catalog.jsonb_typeof(element.value) <> 'number'
    ) THEN
    RAISE EXCEPTION 'The visual example embedding is invalid.';
  END IF;

  v_expected_path_prefix := v_organization_id::text || '/' || p_estimate_id::text || '/'
    || p_ai_operation_id::text || '/';
  IF p_exemplar_storage_path IS NULL
    OR p_exemplar_storage_path NOT LIKE v_expected_path_prefix || '%'
    OR char_length(p_exemplar_storage_path) > 1000 THEN
    RAISE EXCEPTION 'The visual example storage path is invalid.';
  END IF;

  IF p_cost_library_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.cost_library_items AS item
    WHERE item.id = p_cost_library_item_id
      AND item.organization_id = v_organization_id
  ) THEN
    RAISE EXCEPTION 'The selected cost library item is not available to this company.';
  END IF;

  v_normalized_label := pg_catalog.lower(
    pg_catalog.regexp_replace(v_label, '[[:space:]]+', ' ', 'g')
  );
  v_source_point_key := pg_catalog.round(v_x * 100000)::integer::text || ':'
    || pg_catalog.round(v_y * 100000)::integer::text;

  INSERT INTO public.ai_symbol_library_items (
    organization_id,
    label,
    normalized_label,
    trade,
    unit,
    cost_library_item_id,
    active,
    created_by,
    last_used_at
  ) VALUES (
    v_organization_id,
    v_label,
    v_normalized_label,
    v_trade,
    v_unit,
    p_cost_library_item_id,
    true,
    v_user_id,
    pg_catalog.now()
  )
  ON CONFLICT (organization_id, normalized_label)
  DO UPDATE SET
    label = EXCLUDED.label,
    trade = CASE
      WHEN EXCLUDED.trade <> '' THEN EXCLUDED.trade
      ELSE public.ai_symbol_library_items.trade
    END,
    unit = EXCLUDED.unit,
    cost_library_item_id = COALESCE(
      EXCLUDED.cost_library_item_id,
      public.ai_symbol_library_items.cost_library_item_id
    ),
    active = true,
    last_used_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  RETURNING id INTO v_library_item_id;

  INSERT INTO public.ai_symbol_library_examples (
    library_item_id,
    organization_id,
    source_estimate_id,
    source_plan_sheet_id,
    source_ai_operation_id,
    source_point,
    source_point_key,
    exemplar_storage_path,
    embedding,
    accepted_count,
    rejected_count,
    created_by
  ) VALUES (
    v_library_item_id,
    v_organization_id,
    p_estimate_id,
    p_plan_sheet_id,
    p_ai_operation_id,
    pg_catalog.jsonb_build_object('x', v_x, 'y', v_y),
    v_source_point_key,
    p_exemplar_storage_path,
    p_embedding,
    p_accepted_count,
    COALESCE(p_rejected_count, 0),
    v_user_id
  )
  ON CONFLICT (source_ai_operation_id, source_plan_sheet_id, source_point_key)
  DO UPDATE SET
    library_item_id = EXCLUDED.library_item_id,
    exemplar_storage_path = EXCLUDED.exemplar_storage_path,
    embedding = EXCLUDED.embedding,
    accepted_count = EXCLUDED.accepted_count,
    rejected_count = EXCLUDED.rejected_count
  RETURNING id INTO v_example_id;

  UPDATE public.ai_symbol_library_items AS item
  SET
    use_count = (
      SELECT pg_catalog.count(*)::integer
      FROM public.ai_symbol_library_examples AS example
      WHERE example.library_item_id = v_library_item_id
    ),
    last_used_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  WHERE item.id = v_library_item_id;

  RETURN QUERY SELECT v_library_item_id, v_example_id;
END
$$;

REVOKE ALL ON FUNCTION public.save_ai_symbol_library_example(
  uuid, uuid, uuid, text, text, text, uuid, jsonb, text, jsonb, integer, integer
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_ai_symbol_library_example(
  uuid, uuid, uuid, text, text, text, uuid, jsonb, text, jsonb, integer, integer
) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_ai_symbol_library_example(
  uuid, uuid, uuid, text, text, text, uuid, jsonb, text, jsonb, integer, integer
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_ai_symbol_library_example(
  uuid, uuid, uuid, text, text, text, uuid, jsonb, text, jsonb, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';
