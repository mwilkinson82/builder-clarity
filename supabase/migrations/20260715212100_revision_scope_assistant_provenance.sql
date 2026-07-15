-- Cited revision-note assistant and durable impact provenance.
--
-- AI may select estimating-relevant text differences from an already accepted
-- sheet pair. It does not compare images or geometry and cannot save an impact
-- directly. The estimator must add, classify, verify, and save every item.

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
          'ai_revision_match',
          'ai_revision_scope_review',
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
          'ai_assembly_assumptions',
          'ai_revision_match',
          'ai_revision_scope_review'
        )
      );
  END IF;
END
$$;

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
  v_ai_provenance jsonb;
  v_ai_operation_id uuid;
  v_ai_candidate_id text;
  v_ai_candidate jsonb;
  v_citation jsonb;
  v_citations jsonb;
  v_normalized_ai_provenance jsonb;
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

    v_ai_provenance := v_impact -> 'ai_provenance';
    v_normalized_ai_provenance := 'null'::jsonb;
    IF v_ai_provenance IS NOT NULL AND jsonb_typeof(v_ai_provenance) <> 'null' THEN
      IF jsonb_typeof(v_ai_provenance) IS DISTINCT FROM 'object'
        OR COALESCE(v_ai_provenance ->> 'source', '') <> 'ai_revision_scope_review' THEN
        RAISE EXCEPTION 'AI impact provenance is malformed.';
      END IF;
      BEGIN
        v_ai_operation_id := (v_ai_provenance ->> 'operation_id')::uuid;
      EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'AI impact provenance requires a valid operation.';
      END;
      v_ai_candidate_id := COALESCE(v_ai_provenance ->> 'candidate_id', '');
      IF v_ai_operation_id IS NULL
        OR v_ai_candidate_id !~ '^revision-scope-candidate-[0-9]{1,2}$' THEN
        RAISE EXCEPTION 'AI impact provenance requires a valid operation and candidate.';
      END IF;

      SELECT candidate.value INTO v_ai_candidate
      FROM public.ai_operations operation
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE
          WHEN jsonb_typeof(operation.result -> 'candidates') = 'array'
            THEN operation.result -> 'candidates'
          ELSE '[]'::jsonb
        END
      ) AS candidate(value)
      WHERE operation.id = v_ai_operation_id
        AND operation.estimate_id = v_match.estimate_id
        AND operation.operation_type = 'ai_revision_scope_review'
        AND operation.status = 'succeeded'
        AND operation.sheet_ids @> ARRAY[v_match.revision_sheet_id, v_match.base_sheet_id]::uuid[]
        AND candidate.value ->> 'id' = v_ai_candidate_id
      LIMIT 1;

      IF v_ai_candidate IS NULL THEN
        RAISE EXCEPTION 'AI impact provenance does not match a completed review for this sheet pair.';
      END IF;

      v_citations := jsonb_build_array(v_ai_candidate -> 'revision_citation');
      IF v_ai_candidate -> 'base_citation' IS NOT NULL
        AND jsonb_typeof(v_ai_candidate -> 'base_citation') <> 'null' THEN
        v_citations := v_citations || jsonb_build_array(v_ai_candidate -> 'base_citation');
      END IF;
      IF jsonb_array_length(v_citations) < 1 OR jsonb_array_length(v_citations) > 2
        OR v_citations -> 0 ->> 'sheet_role' <> 'revision' THEN
        RAISE EXCEPTION 'AI impact provenance must retain its revision-note citation.';
      END IF;
      FOR v_citation IN SELECT value FROM jsonb_array_elements(v_citations)
      LOOP
        IF jsonb_typeof(v_citation) IS DISTINCT FROM 'object'
          OR COALESCE(v_citation ->> 'sheet_role', '') NOT IN ('revision', 'base')
          OR COALESCE(v_citation ->> 'line_number', '') !~ '^L[0-9]{3}$'
          OR char_length(btrim(COALESCE(v_citation ->> 'excerpt', ''))) < 3
          OR char_length(btrim(COALESCE(v_citation ->> 'excerpt', ''))) > 260 THEN
          RAISE EXCEPTION 'AI impact provenance contains an invalid citation.';
        END IF;
      END LOOP;
      v_normalized_ai_provenance := jsonb_build_object(
        'source', 'ai_revision_scope_review',
        'operation_id', v_ai_operation_id,
        'candidate_id', v_ai_candidate_id,
        'citations', v_citations
      );
    END IF;

    v_normalized_impacts := v_normalized_impacts || jsonb_build_array(
      jsonb_build_object(
        'id', v_impact_id,
        'category', v_category,
        'title', v_title,
        'required_action', v_required_action,
        'status', v_status,
        'notes', v_notes,
        'ai_provenance', v_normalized_ai_provenance
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
