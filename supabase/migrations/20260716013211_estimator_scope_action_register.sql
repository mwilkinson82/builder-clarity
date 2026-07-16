-- Append-only estimator decisions for cited plan-set Scope Brief prompts.
--
-- The register records what a human chose to review next. It never creates
-- geometry, quantities, assemblies, pricing, takeoffs, or estimate rows.

CREATE TABLE IF NOT EXISTS public.estimate_scope_brief_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  plan_set_id uuid NOT NULL REFERENCES public.estimate_plan_sets(id) ON DELETE CASCADE,
  ai_operation_id uuid NOT NULL REFERENCES public.ai_operations(id) ON DELETE RESTRICT,
  item_id text NOT NULL,
  version integer NOT NULL,
  trade text NOT NULL,
  review_kind text NOT NULL,
  scope_label text NOT NULL,
  plan_sheet_id uuid NOT NULL REFERENCES public.estimate_plan_sheets(id) ON DELETE RESTRICT,
  source_line text NOT NULL,
  source_excerpt text NOT NULL,
  status text NOT NULL,
  next_action text NOT NULL,
  review_notes text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_scope_brief_reviews_item_id_check CHECK (
    item_id ~ '^scope-brief-[a-z0-9]+$' AND char_length(item_id) <= 80
  ),
  CONSTRAINT estimate_scope_brief_reviews_version_check CHECK (version > 0),
  CONSTRAINT estimate_scope_brief_reviews_trade_check CHECK (
    trade IN (
      'General Requirements',
      'Site / Civil',
      'Concrete / Masonry',
      'Metals / Wood',
      'Envelope / Roofing',
      'Openings',
      'Finishes',
      'Equipment / Furnishings',
      'Fire Protection',
      'Plumbing',
      'Mechanical',
      'Electrical',
      'Other'
    )
  ),
  CONSTRAINT estimate_scope_brief_reviews_kind_check CHECK (
    review_kind IN ('count', 'linear', 'area', 'assembly', 'allowance', 'coordination')
  ),
  CONSTRAINT estimate_scope_brief_reviews_label_check CHECK (
    char_length(scope_label) BETWEEN 1 AND 120
  ),
  CONSTRAINT estimate_scope_brief_reviews_source_line_check CHECK (
    source_line ~ '^L[0-9]{3}$'
  ),
  CONSTRAINT estimate_scope_brief_reviews_excerpt_check CHECK (
    char_length(source_excerpt) BETWEEN 3 AND 260
  ),
  CONSTRAINT estimate_scope_brief_reviews_status_check CHECK (
    status IN ('accepted', 'deferred', 'excluded')
  ),
  CONSTRAINT estimate_scope_brief_reviews_next_action_check CHECK (
    next_action IN (
      'count_review',
      'length_review',
      'area_review',
      'assembly_review',
      'pricing_review',
      'scope_coordination',
      'none'
    )
  ),
  CONSTRAINT estimate_scope_brief_reviews_status_action_check CHECK (
    (status = 'excluded' AND next_action = 'none')
    OR (status IN ('accepted', 'deferred') AND next_action <> 'none')
  ),
  CONSTRAINT estimate_scope_brief_reviews_notes_check CHECK (
    char_length(review_notes) <= 1000
  ),
  CONSTRAINT estimate_scope_brief_reviews_item_version_unique UNIQUE (
    estimate_id,
    item_id,
    version
  )
);

CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_estimate_idx
  ON public.estimate_scope_brief_reviews(estimate_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_plan_set_idx
  ON public.estimate_scope_brief_reviews(plan_set_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_item_idx
  ON public.estimate_scope_brief_reviews(estimate_id, item_id, version DESC);
CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_sheet_idx
  ON public.estimate_scope_brief_reviews(plan_sheet_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_operation_idx
  ON public.estimate_scope_brief_reviews(ai_operation_id);
CREATE INDEX IF NOT EXISTS estimate_scope_brief_reviews_reviewer_idx
  ON public.estimate_scope_brief_reviews(reviewed_by, reviewed_at DESC)
  WHERE reviewed_by IS NOT NULL;

ALTER TABLE public.estimate_scope_brief_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_scope_brief_reviews FROM anon;
REVOKE ALL ON TABLE public.estimate_scope_brief_reviews FROM authenticated;
GRANT SELECT ON TABLE public.estimate_scope_brief_reviews TO authenticated;
GRANT ALL ON TABLE public.estimate_scope_brief_reviews TO service_role;

DROP POLICY IF EXISTS estimate_scope_brief_reviews_team_select
  ON public.estimate_scope_brief_reviews;
CREATE POLICY estimate_scope_brief_reviews_team_select
  ON public.estimate_scope_brief_reviews
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.save_estimate_scope_brief_review(
  p_ai_operation_id uuid,
  p_item_id text,
  p_status text,
  p_next_action text,
  p_review_notes text
)
RETURNS SETOF public.estimate_scope_brief_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_operation public.ai_operations%ROWTYPE;
  v_item jsonb;
  v_plan_set_id uuid;
  v_plan_sheet_id uuid;
  v_review_kind text;
  v_default_action text;
  v_notes text := btrim(COALESCE(p_review_notes, ''));
  v_version integer;
  v_review public.estimate_scope_brief_reviews%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_operation
  FROM public.ai_operations
  WHERE id = p_ai_operation_id
  FOR SHARE;

  IF NOT FOUND
    OR v_operation.operation_type <> 'ai_scope_brief'
    OR v_operation.status <> 'succeeded'
    OR NOT public.can_manage_estimate(v_operation.estimate_id) THEN
    RAISE EXCEPTION 'A completed Scope Brief and estimate management access are required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_item_id IS NULL
    OR p_item_id !~ '^scope-brief-[a-z0-9]+$'
    OR char_length(p_item_id) > 80 THEN
    RAISE EXCEPTION 'Choose a valid cited Scope Brief prompt.' USING ERRCODE = '22023';
  END IF;

  SELECT item.value INTO v_item
  FROM jsonb_array_elements(COALESCE(v_operation.result -> 'items', '[]'::jsonb)) AS item(value)
  WHERE item.value ->> 'id' = p_item_id
  LIMIT 1;

  IF v_item IS NULL OR jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'The cited prompt is not retained in this completed Scope Brief.'
      USING ERRCODE = '23503';
  END IF;

  BEGIN
    v_plan_set_id := (v_operation.request_context ->> 'plan_set_id')::uuid;
    v_plan_sheet_id := (v_item ->> 'plan_sheet_id')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'The cited Scope Brief provenance is invalid.' USING ERRCODE = '23503';
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.estimate_plan_sheets sheet
    WHERE sheet.id = v_plan_sheet_id
      AND sheet.estimate_id = v_operation.estimate_id
      AND sheet.plan_set_id = v_plan_set_id
  ) THEN
    RAISE EXCEPTION 'The cited sheet does not belong to this Scope Brief drawing set.'
      USING ERRCODE = '23503';
  END IF;

  v_review_kind := COALESCE(v_item ->> 'review_kind', '');
  v_default_action := CASE v_review_kind
    WHEN 'count' THEN 'count_review'
    WHEN 'linear' THEN 'length_review'
    WHEN 'area' THEN 'area_review'
    WHEN 'assembly' THEN 'assembly_review'
    WHEN 'allowance' THEN 'pricing_review'
    WHEN 'coordination' THEN 'scope_coordination'
    ELSE ''
  END;

  IF COALESCE(v_item ->> 'trade', '') NOT IN (
      'General Requirements', 'Site / Civil', 'Concrete / Masonry', 'Metals / Wood',
      'Envelope / Roofing', 'Openings', 'Finishes', 'Equipment / Furnishings',
      'Fire Protection', 'Plumbing', 'Mechanical', 'Electrical', 'Other'
    )
    OR v_default_action = ''
    OR char_length(btrim(COALESCE(v_item ->> 'scope_label', ''))) NOT BETWEEN 1 AND 120
    OR COALESCE(v_item ->> 'source_line', '') !~ '^L[0-9]{3}$'
    OR char_length(btrim(COALESCE(v_item ->> 'source_excerpt', ''))) NOT BETWEEN 3 AND 260 THEN
    RAISE EXCEPTION 'The retained Scope Brief prompt is malformed.' USING ERRCODE = '22023';
  END IF;

  IF p_status IS NULL OR p_status NOT IN ('accepted', 'deferred', 'excluded') THEN
    RAISE EXCEPTION 'Choose Keep, Later, or Exclude.' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'excluded' AND COALESCE(p_next_action, '') <> 'none' THEN
    RAISE EXCEPTION 'Excluded scope cannot be routed to a next action.' USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('accepted', 'deferred')
    AND COALESCE(p_next_action, '') NOT IN (
      'count_review', 'length_review', 'area_review', 'assembly_review',
      'pricing_review', 'scope_coordination'
    ) THEN
    RAISE EXCEPTION 'Choose a supported estimator next action.' USING ERRCODE = '22023';
  END IF;
  IF char_length(v_notes) > 1000 THEN
    RAISE EXCEPTION 'Review notes may not exceed 1000 characters.' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'excluded' AND char_length(v_notes) < 3 THEN
    RAISE EXCEPTION 'Explain why this cited scope is excluded.' USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('accepted', 'deferred')
    AND p_next_action <> v_default_action
    AND char_length(v_notes) < 3 THEN
    RAISE EXCEPTION 'Explain why the next action differs from the cited review type.'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_operation.estimate_id::text || ':' || p_item_id, 0)
  );

  SELECT COALESCE(max(review.version), 0) + 1 INTO v_version
  FROM public.estimate_scope_brief_reviews review
  WHERE review.estimate_id = v_operation.estimate_id
    AND review.item_id = p_item_id;

  INSERT INTO public.estimate_scope_brief_reviews (
    estimate_id,
    plan_set_id,
    ai_operation_id,
    item_id,
    version,
    trade,
    review_kind,
    scope_label,
    plan_sheet_id,
    source_line,
    source_excerpt,
    status,
    next_action,
    review_notes,
    reviewed_by,
    reviewed_at
  ) VALUES (
    v_operation.estimate_id,
    v_plan_set_id,
    v_operation.id,
    p_item_id,
    v_version,
    v_item ->> 'trade',
    v_review_kind,
    btrim(v_item ->> 'scope_label'),
    v_plan_sheet_id,
    v_item ->> 'source_line',
    btrim(v_item ->> 'source_excerpt'),
    p_status,
    p_next_action,
    v_notes,
    v_user_id,
    now()
  )
  RETURNING * INTO v_review;

  RETURN QUERY
  SELECT review.*
  FROM public.estimate_scope_brief_reviews review
  WHERE review.id = v_review.id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_estimate_scope_brief_review(uuid, text, text, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_scope_brief_review(uuid, text, text, text, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.estimate_scope_brief_reviews IS
  'Append-only human decisions for cited plan-set Scope Brief prompts; never a quantity path.';
COMMENT ON COLUMN public.estimate_scope_brief_reviews.next_action IS
  'Estimator-selected review route only; it does not create or complete downstream work.';
COMMENT ON COLUMN public.estimate_scope_brief_reviews.version IS
  'Monotonic decision version for one stable cited prompt within an estimate.';

NOTIFY pgrst, 'reload schema';
