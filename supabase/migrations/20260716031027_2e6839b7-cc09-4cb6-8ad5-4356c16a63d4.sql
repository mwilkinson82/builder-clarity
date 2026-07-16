-- Direct provenance from an estimator-drawn LF/SF takeoff to the exact
-- immutable Scope Brief decision that launched it. Count provenance remains
-- attached through ai_operations.request_context and ai_operation_id.

ALTER TABLE public.estimate_takeoff_measurements
  ADD COLUMN IF NOT EXISTS scope_brief_review_id uuid
    REFERENCES public.estimate_scope_brief_reviews(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_scope_brief_review_idx
  ON public.estimate_takeoff_measurements(scope_brief_review_id)
  WHERE scope_brief_review_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_takeoff_scope_brief_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_review public.estimate_scope_brief_reviews%ROWTYPE;
  v_latest_review_id uuid;
  v_expected_action text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.scope_brief_review_id IS DISTINCT FROM OLD.scope_brief_review_id THEN
      RAISE EXCEPTION 'Scope Brief takeoff provenance is immutable.' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.scope_brief_review_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT review.*
  INTO v_review
  FROM public.estimate_scope_brief_reviews AS review
  WHERE review.id = NEW.scope_brief_review_id;

  IF v_review.id IS NULL THEN
    RAISE EXCEPTION 'The cited Scope Brief decision was not found.' USING ERRCODE = '23503';
  END IF;
  IF v_review.estimate_id <> NEW.estimate_id OR v_review.plan_sheet_id <> NEW.plan_sheet_id THEN
    RAISE EXCEPTION 'The cited Scope Brief decision does not belong to this estimate sheet.'
      USING ERRCODE = '22023';
  END IF;

  SELECT latest.id
  INTO v_latest_review_id
  FROM public.estimate_scope_brief_reviews AS latest
  WHERE latest.estimate_id = v_review.estimate_id
    AND latest.item_id = v_review.item_id
  ORDER BY latest.version DESC
  LIMIT 1;

  IF v_latest_review_id IS DISTINCT FROM v_review.id THEN
    RAISE EXCEPTION 'The cited Scope Brief decision changed. Reopen the current decision before measuring.'
      USING ERRCODE = '22023';
  END IF;
  IF v_review.status <> 'accepted' THEN
    RAISE EXCEPTION 'Only a currently kept Scope Brief decision can create cited takeoff provenance.'
      USING ERRCODE = '22023';
  END IF;
  IF NEW.tool_type = 'count' THEN
    RAISE EXCEPTION 'Cited count provenance must come through the reviewed AI count operation.'
      USING ERRCODE = '22023';
  END IF;

  v_expected_action := CASE NEW.tool_type
    WHEN 'linear' THEN 'length_review'
    WHEN 'area' THEN 'area_review'
    ELSE NULL
  END;
  IF v_expected_action IS NULL OR v_review.next_action <> v_expected_action THEN
    RAISE EXCEPTION 'The Scope Brief decision is not routed to this takeoff tool.'
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimate_takeoff_measurements_scope_brief_provenance
  ON public.estimate_takeoff_measurements;
CREATE TRIGGER estimate_takeoff_measurements_scope_brief_provenance
  BEFORE INSERT OR UPDATE OF scope_brief_review_id
  ON public.estimate_takeoff_measurements
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_takeoff_scope_brief_provenance();

REVOKE ALL ON FUNCTION public.tg_takeoff_scope_brief_provenance() FROM PUBLIC;

COMMENT ON COLUMN public.estimate_takeoff_measurements.scope_brief_review_id IS
  'Immutable provenance for estimator-drawn LF/SF takeoffs launched from a current kept Scope Brief decision. Count provenance remains on the linked AI operation.';

COMMENT ON FUNCTION public.tg_takeoff_scope_brief_provenance() IS
  'Validates same-estimate, same-sheet, latest kept LF/SF Scope Brief provenance on insert and prevents provenance reassignment.';

NOTIFY pgrst, 'reload schema';