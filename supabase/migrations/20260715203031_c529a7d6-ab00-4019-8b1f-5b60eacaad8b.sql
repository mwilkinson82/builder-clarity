-- Estimator-controlled revision-set matching.
--
-- Deterministic rules and AI may propose a prior sheet from metadata. They do
-- not compare drawing geometry, archive a plan set, move takeoffs, change a
-- scale, or alter an estimate. Every proposal is persisted only after an
-- estimator records an explicit decision through the server-owned RPC below.

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
          'ai_revision_match'
        )
      );
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.estimate_plan_revision_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  revision_plan_set_id uuid NOT NULL
    REFERENCES public.estimate_plan_sets(id) ON DELETE CASCADE,
  revision_sheet_id uuid NOT NULL UNIQUE
    REFERENCES public.estimate_plan_sheets(id) ON DELETE CASCADE,
  base_sheet_id uuid REFERENCES public.estimate_plan_sheets(id) ON DELETE RESTRICT,
  ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  proposal_method text NOT NULL,
  confidence numeric(5,4) NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text NOT NULL DEFAULT '',
  review_action text NOT NULL,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_plan_revision_matches_method_check CHECK (
    proposal_method IN ('deterministic', 'ai', 'manual', 'unmatched')
  ),
  CONSTRAINT estimate_plan_revision_matches_confidence_check CHECK (
    confidence >= 0 AND confidence <= 1
  ),
  CONSTRAINT estimate_plan_revision_matches_evidence_check CHECK (
    jsonb_typeof(evidence) = 'array'
  ),
  CONSTRAINT estimate_plan_revision_matches_action_check CHECK (
    review_action IN ('accepted', 'rejected', 'unmatched')
  ),
  CONSTRAINT estimate_plan_revision_matches_pair_check CHECK (
    (review_action = 'accepted' AND base_sheet_id IS NOT NULL)
    OR review_action = 'rejected'
    OR (review_action = 'unmatched' AND base_sheet_id IS NULL)
  ),
  CONSTRAINT estimate_plan_revision_matches_method_pair_check CHECK (
    proposal_method <> 'unmatched' OR base_sheet_id IS NULL
  )
);

CREATE INDEX IF NOT EXISTS estimate_plan_revision_matches_estimate_idx
  ON public.estimate_plan_revision_matches(estimate_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS estimate_plan_revision_matches_set_idx
  ON public.estimate_plan_revision_matches(revision_plan_set_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS estimate_plan_revision_matches_base_idx
  ON public.estimate_plan_revision_matches(base_sheet_id)
  WHERE base_sheet_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_plan_revision_matches_ai_operation_idx
  ON public.estimate_plan_revision_matches(ai_operation_id)
  WHERE ai_operation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS estimate_plan_revision_matches_accepted_base_unique
  ON public.estimate_plan_revision_matches(revision_plan_set_id, base_sheet_id)
  WHERE review_action = 'accepted' AND base_sheet_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.estimate_plan_revision_match_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL
    REFERENCES public.estimate_plan_revision_matches(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_plan_revision_match_events_action_check CHECK (
    action IN ('accepted', 'rejected', 'unmatched')
  ),
  CONSTRAINT estimate_plan_revision_match_events_snapshot_check CHECK (
    jsonb_typeof(snapshot) = 'object'
  )
);

CREATE INDEX IF NOT EXISTS estimate_plan_revision_match_events_match_idx
  ON public.estimate_plan_revision_match_events(match_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_plan_revision_match_events_estimate_idx
  ON public.estimate_plan_revision_match_events(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_plan_revision_match_events_actor_idx
  ON public.estimate_plan_revision_match_events(actor_id)
  WHERE actor_id IS NOT NULL;

DROP TRIGGER IF EXISTS estimate_plan_revision_matches_set_updated_at
  ON public.estimate_plan_revision_matches;
CREATE TRIGGER estimate_plan_revision_matches_set_updated_at
  BEFORE UPDATE ON public.estimate_plan_revision_matches
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.estimate_plan_revision_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_plan_revision_match_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_plan_revision_matches FROM anon;
REVOKE ALL ON TABLE public.estimate_plan_revision_matches FROM authenticated;
GRANT SELECT ON TABLE public.estimate_plan_revision_matches TO authenticated;
GRANT ALL ON TABLE public.estimate_plan_revision_matches TO service_role;
REVOKE ALL ON TABLE public.estimate_plan_revision_match_events FROM anon;
REVOKE ALL ON TABLE public.estimate_plan_revision_match_events FROM authenticated;
GRANT SELECT ON TABLE public.estimate_plan_revision_match_events TO authenticated;
GRANT ALL ON TABLE public.estimate_plan_revision_match_events TO service_role;

DROP POLICY IF EXISTS estimate_plan_revision_matches_team_select
  ON public.estimate_plan_revision_matches;
CREATE POLICY estimate_plan_revision_matches_team_select
  ON public.estimate_plan_revision_matches
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_plan_revision_match_events_team_select
  ON public.estimate_plan_revision_match_events;
CREATE POLICY estimate_plan_revision_match_events_team_select
  ON public.estimate_plan_revision_match_events
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.save_estimate_plan_revision_decisions(
  p_revision_plan_set_id uuid,
  p_decisions jsonb
)
RETURNS SETOF public.estimate_plan_revision_matches
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_set public.estimate_plan_sets%ROWTYPE;
  v_decision jsonb;
  v_revision_sheet public.estimate_plan_sheets%ROWTYPE;
  v_base_sheet public.estimate_plan_sheets%ROWTYPE;
  v_base_set public.estimate_plan_sets%ROWTYPE;
  v_ai_operation public.ai_operations%ROWTYPE;
  v_match public.estimate_plan_revision_matches%ROWTYPE;
  v_revision_sheet_id uuid;
  v_base_sheet_id uuid;
  v_ai_operation_id uuid;
  v_proposal_method text;
  v_review_action text;
  v_confidence numeric;
  v_evidence jsonb;
  v_reason text;
  v_sheet_count integer;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.';
  END IF;

  SELECT * INTO v_set
  FROM public.estimate_plan_sets
  WHERE id = p_revision_plan_set_id
  FOR SHARE;

  IF NOT FOUND OR NOT public.can_manage_estimate(v_set.estimate_id) THEN
    RAISE EXCEPTION 'Revision set was not found or estimate management access is required.';
  END IF;

  IF jsonb_typeof(COALESCE(p_decisions, 'null'::jsonb)) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_decisions) < 1
    OR jsonb_array_length(p_decisions) > 500 THEN
    RAISE EXCEPTION 'Submit between 1 and 500 revision decisions.';
  END IF;

  SELECT count(*) INTO v_sheet_count
  FROM public.estimate_plan_sheets
  WHERE plan_set_id = p_revision_plan_set_id
    AND estimate_id = v_set.estimate_id;

  IF jsonb_array_length(p_decisions) <> v_sheet_count THEN
    RAISE EXCEPTION 'Review every page in the revision set before saving decisions.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_decisions) AS item(value)
    GROUP BY value ->> 'revision_sheet_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Each revision page may appear only once in a review.';
  END IF;

  -- Free prior accepted pair keys inside this transaction so an estimator can
  -- safely swap two corrected counterparts. Every page is upserted below; if
  -- any decision fails, this temporary state rolls back with the transaction.
  UPDATE public.estimate_plan_revision_matches
  SET review_action = 'rejected'
  WHERE revision_plan_set_id = p_revision_plan_set_id
    AND review_action = 'accepted';

  FOR v_decision IN SELECT value FROM jsonb_array_elements(p_decisions)
  LOOP
    BEGIN
      v_revision_sheet_id := (v_decision ->> 'revision_sheet_id')::uuid;
      v_base_sheet_id := NULLIF(v_decision ->> 'base_sheet_id', '')::uuid;
      v_ai_operation_id := NULLIF(v_decision ->> 'ai_operation_id', '')::uuid;
      v_confidence := (v_decision ->> 'confidence')::numeric;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'A revision decision contains an invalid identifier or confidence.';
    END;

    v_proposal_method := COALESCE(v_decision ->> 'method', '');
    v_review_action := COALESCE(v_decision ->> 'review_action', '');
    v_evidence := COALESCE(v_decision -> 'evidence', '[]'::jsonb);
    v_reason := left(COALESCE(v_decision ->> 'reason', ''), 500);

    IF v_revision_sheet_id IS NULL
      OR v_proposal_method NOT IN ('deterministic', 'ai', 'manual', 'unmatched')
      OR v_review_action NOT IN ('accepted', 'rejected', 'unmatched')
      OR v_confidence IS NULL OR v_confidence < 0 OR v_confidence > 1
      OR jsonb_typeof(v_evidence) IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_evidence) > 12 THEN
      RAISE EXCEPTION 'A revision decision is malformed.';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_evidence) AS evidence(value)
      WHERE jsonb_typeof(value) IS DISTINCT FROM 'string'
        OR length(value #>> '{}') > 300
    ) THEN
      RAISE EXCEPTION 'Revision evidence must contain short text statements only.';
    END IF;

    IF v_proposal_method = 'ai' AND v_ai_operation_id IS NULL THEN
      RAISE EXCEPTION 'An AI proposal requires its completed operation record.';
    END IF;
    IF v_proposal_method IN ('deterministic', 'manual') AND v_ai_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'Only AI-assisted or unmatched decisions may cite an AI operation.';
    END IF;

    SELECT * INTO v_revision_sheet
    FROM public.estimate_plan_sheets
    WHERE id = v_revision_sheet_id
      AND plan_set_id = p_revision_plan_set_id
      AND estimate_id = v_set.estimate_id
    FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'A revision sheet is not part of the selected revision set.';
    END IF;

    IF v_review_action = 'accepted' AND v_base_sheet_id IS NULL THEN
      RAISE EXCEPTION 'An accepted revision match requires a prior sheet.';
    END IF;
    IF v_review_action = 'unmatched' AND v_base_sheet_id IS NOT NULL THEN
      RAISE EXCEPTION 'A no-match decision cannot retain a prior sheet.';
    END IF;
    IF v_proposal_method = 'unmatched' AND v_base_sheet_id IS NOT NULL THEN
      RAISE EXCEPTION 'An unmatched proposal cannot retain a prior sheet.';
    END IF;

    IF v_base_sheet_id IS NOT NULL THEN
      SELECT * INTO v_base_sheet
      FROM public.estimate_plan_sheets
      WHERE id = v_base_sheet_id
        AND estimate_id = v_set.estimate_id
        AND plan_set_id <> p_revision_plan_set_id
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A proposed prior sheet is not available on this estimate.';
      END IF;

      SELECT * INTO v_base_set
      FROM public.estimate_plan_sets
      WHERE id = v_base_sheet.plan_set_id
        AND estimate_id = v_set.estimate_id
        AND created_at < v_set.created_at
        AND status IN ('current', 'superseded')
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'A proposed prior sheet must come from an earlier retained drawing set.';
      END IF;
    END IF;

    IF v_ai_operation_id IS NOT NULL THEN
      SELECT * INTO v_ai_operation
      FROM public.ai_operations
      WHERE id = v_ai_operation_id
        AND estimate_id = v_set.estimate_id
        AND operation_type = 'ai_revision_match'
        AND status = 'succeeded'
        AND request_context ->> 'revision_plan_set_id' = p_revision_plan_set_id::text
      FOR SHARE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'The AI revision operation is not a completed review for this set.';
      END IF;
    END IF;

    INSERT INTO public.estimate_plan_revision_matches (
      estimate_id,
      revision_plan_set_id,
      revision_sheet_id,
      base_sheet_id,
      ai_operation_id,
      proposal_method,
      confidence,
      evidence,
      reason,
      review_action,
      reviewed_by,
      reviewed_at
    ) VALUES (
      v_set.estimate_id,
      p_revision_plan_set_id,
      v_revision_sheet_id,
      v_base_sheet_id,
      v_ai_operation_id,
      v_proposal_method,
      v_confidence,
      v_evidence,
      v_reason,
      v_review_action,
      v_user_id,
      now()
    )
    ON CONFLICT (revision_sheet_id) DO UPDATE SET
      estimate_id = EXCLUDED.estimate_id,
      revision_plan_set_id = EXCLUDED.revision_plan_set_id,
      base_sheet_id = EXCLUDED.base_sheet_id,
      ai_operation_id = EXCLUDED.ai_operation_id,
      proposal_method = EXCLUDED.proposal_method,
      confidence = EXCLUDED.confidence,
      evidence = EXCLUDED.evidence,
      reason = EXCLUDED.reason,
      review_action = EXCLUDED.review_action,
      reviewed_by = EXCLUDED.reviewed_by,
      reviewed_at = EXCLUDED.reviewed_at
    RETURNING * INTO v_match;

    INSERT INTO public.estimate_plan_revision_match_events (
      match_id,
      estimate_id,
      action,
      actor_id,
      snapshot
    ) VALUES (
      v_match.id,
      v_match.estimate_id,
      v_match.review_action,
      v_user_id,
      jsonb_build_object(
        'revision_plan_set_id', v_match.revision_plan_set_id,
        'revision_sheet_id', v_match.revision_sheet_id,
        'base_sheet_id', v_match.base_sheet_id,
        'ai_operation_id', v_match.ai_operation_id,
        'proposal_method', v_match.proposal_method,
        'confidence', v_match.confidence,
        'evidence', v_match.evidence,
        'reason', v_match.reason,
        'reviewed_at', v_match.reviewed_at
      )
    );
  END LOOP;

  RETURN QUERY
  SELECT match.*
  FROM public.estimate_plan_revision_matches match
  WHERE match.revision_plan_set_id = p_revision_plan_set_id
  ORDER BY match.reviewed_at DESC, match.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.save_estimate_plan_revision_decisions(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_estimate_plan_revision_decisions(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_estimate_plan_revision_decisions(uuid, jsonb)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_estimate_plan_revision_decisions(uuid, jsonb)
  TO service_role;

NOTIFY pgrst, 'reload schema';