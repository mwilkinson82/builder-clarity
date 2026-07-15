-- Append-only, estimator-authored revision impact register.
--
-- An accepted sheet pair may be visually compared in the existing overlay.
-- This register records the estimator's conclusion and follow-up work, but it
-- never modifies sheet geometry, scale, takeoffs, or estimate quantities.

CREATE TABLE public.estimate_plan_revision_impact_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  revision_match_id uuid NOT NULL
    REFERENCES public.estimate_plan_revision_matches(id) ON DELETE CASCADE,
  revision_sheet_id uuid NOT NULL
    REFERENCES public.estimate_plan_sheets(id) ON DELETE RESTRICT,
  base_sheet_id uuid NOT NULL
    REFERENCES public.estimate_plan_sheets(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  disposition text NOT NULL,
  summary_notes text NOT NULL DEFAULT '',
  impacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_plan_revision_impact_reviews_version_check CHECK (version > 0),
  CONSTRAINT estimate_plan_revision_impact_reviews_disposition_check CHECK (
    disposition IN ('no_estimate_impact', 'impacts_logged', 'needs_follow_up')
  ),
  CONSTRAINT estimate_plan_revision_impact_reviews_notes_check CHECK (
    char_length(summary_notes) <= 1500
  ),
  CONSTRAINT estimate_plan_revision_impact_reviews_impacts_check CHECK (
    jsonb_typeof(impacts) = 'array' AND jsonb_array_length(impacts) <= 100
  ),
  CONSTRAINT estimate_plan_revision_impact_reviews_match_version_unique UNIQUE (
    revision_match_id,
    version
  )
);

CREATE INDEX estimate_plan_revision_impact_reviews_estimate_idx
  ON public.estimate_plan_revision_impact_reviews(estimate_id, reviewed_at DESC);
CREATE INDEX estimate_plan_revision_impact_reviews_match_idx
  ON public.estimate_plan_revision_impact_reviews(revision_match_id, version DESC);
CREATE INDEX estimate_plan_revision_impact_reviews_revision_sheet_idx
  ON public.estimate_plan_revision_impact_reviews(revision_sheet_id);
CREATE INDEX estimate_plan_revision_impact_reviews_base_sheet_idx
  ON public.estimate_plan_revision_impact_reviews(base_sheet_id);
CREATE INDEX estimate_plan_revision_impact_reviews_reviewer_idx
  ON public.estimate_plan_revision_impact_reviews(reviewed_by, reviewed_at DESC)
  WHERE reviewed_by IS NOT NULL;

ALTER TABLE public.estimate_plan_revision_impact_reviews ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_plan_revision_impact_reviews FROM anon;
REVOKE ALL ON TABLE public.estimate_plan_revision_impact_reviews FROM authenticated;
GRANT SELECT ON TABLE public.estimate_plan_revision_impact_reviews TO authenticated;
GRANT ALL ON TABLE public.estimate_plan_revision_impact_reviews TO service_role;

CREATE POLICY estimate_plan_revision_impact_reviews_team_select
  ON public.estimate_plan_revision_impact_reviews
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.save_estimate_plan_revision_impact_review(
  p_revision_match_id uuid,
  p_disposition text,
  p_summary_notes text,
  p_impacts jsonb
)
RETURNS SETOF public.estimate_plan_revision_impact_reviews
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_match public.estimate_plan_revision_matches%ROWTYPE;
  v_impact jsonb;
  v_impact_id uuid;
  v_category text;
  v_title text;
  v_required_action text;
  v_status text;
  v_notes text;
  v_impacts jsonb := COALESCE(p_impacts, 'null'::jsonb);
  v_normalized_impacts jsonb := '[]'::jsonb;
  v_summary_notes text := btrim(COALESCE(p_summary_notes, ''));
  v_version integer;
  v_review public.estimate_plan_revision_impact_reviews%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT * INTO v_match
  FROM public.estimate_plan_revision_matches
  WHERE id = p_revision_match_id
  FOR UPDATE;

  IF NOT FOUND
    OR v_match.review_action <> 'accepted'
    OR v_match.base_sheet_id IS NULL
    OR NOT public.can_manage_estimate(v_match.estimate_id) THEN
    RAISE EXCEPTION 'An accepted revision pair and estimate management access are required.';
  END IF;

  IF p_disposition IS NULL
    OR p_disposition NOT IN ('no_estimate_impact', 'impacts_logged', 'needs_follow_up') THEN
    RAISE EXCEPTION 'Choose a supported revision impact disposition.';
  END IF;
  IF char_length(v_summary_notes) > 1500 THEN
    RAISE EXCEPTION 'Revision review notes may not exceed 1500 characters.';
  END IF;
  IF jsonb_typeof(v_impacts) IS DISTINCT FROM 'array'
    OR jsonb_array_length(v_impacts) > 100 THEN
    RAISE EXCEPTION 'Revision impacts must be an array of no more than 100 items.';
  END IF;
  IF p_disposition = 'no_estimate_impact' AND jsonb_array_length(v_impacts) <> 0 THEN
    RAISE EXCEPTION 'A no-impact review cannot include estimating impacts.';
  END IF;
  IF p_disposition = 'impacts_logged' AND jsonb_array_length(v_impacts) = 0 THEN
    RAISE EXCEPTION 'Log at least one estimating impact for this disposition.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(v_impacts) AS item(value)
    GROUP BY value ->> 'id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each revision impact identifier may appear only once.';
  END IF;

  FOR v_impact IN SELECT value FROM jsonb_array_elements(v_impacts)
  LOOP
    IF jsonb_typeof(v_impact) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'Every revision impact must be a structured object.';
    END IF;

    BEGIN
      v_impact_id := (v_impact ->> 'id')::uuid;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Every revision impact requires a valid identifier.';
    END;

    v_category := COALESCE(v_impact ->> 'category', '');
    v_title := btrim(COALESCE(v_impact ->> 'title', ''));
    v_required_action := COALESCE(v_impact ->> 'required_action', '');
    v_status := COALESCE(v_impact ->> 'status', '');
    v_notes := btrim(COALESCE(v_impact ->> 'notes', ''));

    IF v_impact_id IS NULL
      OR v_category NOT IN ('added', 'removed', 'modified', 'clarification', 'coordination', 'unknown')
      OR char_length(v_title) < 3 OR char_length(v_title) > 160
      OR v_required_action NOT IN ('remeasure', 'recount', 'reprice', 'scope_review', 'no_quantity_change')
      OR v_status NOT IN ('open', 'resolved')
      OR char_length(v_notes) > 1000 THEN
      RAISE EXCEPTION 'A revision impact contains an invalid title, type, action, status, or note.';
    END IF;

    v_normalized_impacts := v_normalized_impacts || jsonb_build_array(
      jsonb_build_object(
        'id', v_impact_id,
        'category', v_category,
        'title', v_title,
        'required_action', v_required_action,
        'status', v_status,
        'notes', v_notes
      )
    );
  END LOOP;

  SELECT COALESCE(max(version), 0) + 1 INTO v_version
  FROM public.estimate_plan_revision_impact_reviews
  WHERE revision_match_id = v_match.id;

  INSERT INTO public.estimate_plan_revision_impact_reviews (
    estimate_id,
    revision_match_id,
    revision_sheet_id,
    base_sheet_id,
    version,
    disposition,
    summary_notes,
    impacts,
    reviewed_by,
    reviewed_at
  ) VALUES (
    v_match.estimate_id,
    v_match.id,
    v_match.revision_sheet_id,
    v_match.base_sheet_id,
    v_version,
    p_disposition,
    v_summary_notes,
    v_normalized_impacts,
    v_user_id,
    now()
  )
  RETURNING * INTO v_review;

  RETURN QUERY
  SELECT review.*
  FROM public.estimate_plan_revision_impact_reviews review
  WHERE review.id = v_review.id;
END;
$$;

REVOKE ALL ON FUNCTION public.save_estimate_plan_revision_impact_review(uuid, text, text, jsonb)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_estimate_plan_revision_impact_review(uuid, text, text, jsonb)
  FROM anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_plan_revision_impact_review(uuid, text, text, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate_plan_revision_impact_review(uuid, text, text, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';
