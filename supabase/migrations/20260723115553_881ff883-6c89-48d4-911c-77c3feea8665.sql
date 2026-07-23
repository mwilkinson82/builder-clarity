-- Production SOV certification integrity.
--
-- A certification may only snapshot the absolute latest active, PM-reviewed
-- SOV-basis Daily WIP row for the project/cost bucket. The caller supplies the
-- source identity and review version it displayed; the database locks and
-- re-resolves authority before appending the decision. Existing bad decisions
-- are never rewritten or deleted: an immutable invalidation row explains why
-- they cannot be handed to Billing.

ALTER TABLE public.production_sov_certifications
  ADD COLUMN IF NOT EXISTS source_wip_review_version bigint,
  ADD COLUMN IF NOT EXISTS source_wip_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS source_wip_reviewed_at timestamptz;

UPDATE public.production_sov_certifications certification
SET source_wip_review_version = source.review_version,
    source_wip_updated_at = source.updated_at,
    source_wip_reviewed_at = source.wip_reviewed_at
FROM public.daily_wip_entries source
WHERE source.id = certification.source_wip_entry_id
  AND (
    certification.source_wip_review_version IS NULL
    OR certification.source_wip_updated_at IS NULL
    OR certification.source_wip_reviewed_at IS NULL
  );

COMMENT ON COLUMN public.production_sov_certifications.source_wip_review_version IS
  'PM-review concurrency version snapshotted by the atomic certification command.';
COMMENT ON COLUMN public.production_sov_certifications.source_wip_updated_at IS
  'Daily WIP updated_at snapshotted when the PM certified.';
COMMENT ON COLUMN public.production_sov_certifications.source_wip_reviewed_at IS
  'Daily WIP PM-review timestamp snapshotted when the PM certified.';

CREATE TABLE IF NOT EXISTS public.production_sov_certification_invalidations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  production_sov_certification_id uuid NOT NULL
    REFERENCES public.production_sov_certifications(id) ON DELETE CASCADE,
  reason_code text NOT NULL,
  reason_detail text NOT NULL DEFAULT '',
  invalidated_by uuid,
  invalidated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT production_sov_certification_invalidations_cert_unique
    UNIQUE (production_sov_certification_id),
  CONSTRAINT production_sov_certification_invalidations_reason_check
    CHECK (reason_code IN (
      'source_missing',
      'source_not_reviewed_sov',
      'source_changed_after_certification',
      'source_not_latest_at_certification',
      'source_superseded_after_certification',
      'manual_correction'
    )),
  CONSTRAINT production_sov_certification_invalidations_detail_check
    CHECK (length(reason_detail) <= 2000)
);

CREATE INDEX IF NOT EXISTS production_sov_certification_invalidations_project_idx
  ON public.production_sov_certification_invalidations (project_id, invalidated_at DESC);

ALTER TABLE public.production_sov_certification_invalidations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_sov_certification_invalidations_team_select
  ON public.production_sov_certification_invalidations;
CREATE POLICY production_sov_certification_invalidations_team_select
  ON public.production_sov_certification_invalidations
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

REVOKE ALL ON TABLE public.production_sov_certification_invalidations
  FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.production_sov_certification_invalidations TO authenticated;
GRANT ALL ON TABLE public.production_sov_certification_invalidations TO service_role;

CREATE OR REPLACE FUNCTION public.tg_keep_production_sov_invalidation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.projects project WHERE project.id = OLD.project_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    errcode = '23514',
    message = 'Production SOV certification invalidations are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS production_sov_certification_invalidations_immutable
  ON public.production_sov_certification_invalidations;
CREATE TRIGGER production_sov_certification_invalidations_immutable
  BEFORE UPDATE OR DELETE ON public.production_sov_certification_invalidations
  FOR EACH ROW EXECUTE FUNCTION public.tg_keep_production_sov_invalidation_immutable();

REVOKE ALL ON FUNCTION public.tg_keep_production_sov_invalidation_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

-- Repair without destroying history. A certification is invalid at creation
-- when its source is missing/not reviewed, changed after certification, or was
-- already behind another reviewed SOV row at the time it was appended.
INSERT INTO public.production_sov_certification_invalidations (
  project_id,
  production_sov_certification_id,
  reason_code,
  reason_detail,
  invalidated_by,
  invalidated_at
)
SELECT
  certification.project_id,
  certification.id,
  CASE
    WHEN source.id IS NULL THEN 'source_missing'
    WHEN source.percent_basis <> 'sov'
      OR source.wip_reviewed_at IS NULL
      OR source.project_id <> certification.project_id
      OR source.cost_bucket_id <> certification.cost_bucket_id
      OR source.voided_at IS NOT NULL
      THEN 'source_not_reviewed_sov'
    WHEN source.wip_reviewed_at > certification.certified_at
      OR source.updated_at > certification.certified_at
      THEN 'source_changed_after_certification'
    ELSE 'source_not_latest_at_certification'
  END,
  CASE
    WHEN source.id IS NULL
      THEN 'The certification source Daily WIP row is no longer available.'
    WHEN source.percent_basis <> 'sov'
      OR source.wip_reviewed_at IS NULL
      OR source.project_id <> certification.project_id
      OR source.cost_bucket_id <> certification.cost_bucket_id
      OR source.voided_at IS NOT NULL
      THEN 'The certification source is not active PM-reviewed SOV evidence for this project and cost code.'
    WHEN source.wip_reviewed_at > certification.certified_at
      OR source.updated_at > certification.certified_at
      THEN 'The source Daily WIP row changed after the certification timestamp.'
    ELSE 'A newer reviewed SOV Daily WIP row already existed when this certification was created.'
  END,
  certification.certified_by,
  now()
FROM public.production_sov_certifications certification
LEFT JOIN public.daily_wip_entries source
  ON source.id = certification.source_wip_entry_id
WHERE source.id IS NULL
   OR source.percent_basis <> 'sov'
   OR source.wip_reviewed_at IS NULL
   OR source.project_id <> certification.project_id
   OR source.cost_bucket_id <> certification.cost_bucket_id
   OR source.voided_at IS NOT NULL
   OR source.wip_reviewed_at > certification.certified_at
   OR source.updated_at > certification.certified_at
   OR EXISTS (
     SELECT 1
     FROM public.daily_wip_entries candidate
     WHERE candidate.project_id = certification.project_id
       AND candidate.cost_bucket_id = certification.cost_bucket_id
       AND candidate.percent_basis = 'sov'
       AND candidate.wip_reviewed_at IS NOT NULL
       AND (candidate.voided_at IS NULL OR candidate.voided_at > certification.certified_at)
       AND candidate.wip_reviewed_at <= certification.certified_at
       AND ROW(
         candidate.entry_date,
         candidate.wip_reviewed_at,
         candidate.updated_at,
         candidate.id
       ) > ROW(
         source.entry_date,
         source.wip_reviewed_at,
         source.updated_at,
         source.id
       )
   )
ON CONFLICT (production_sov_certification_id) DO NOTHING;

-- Keep the invalidation ledger current after migration day. A certification
-- remains immutable, but any later WIP edit, void, delete, or newer reviewed
-- SOV row appends the reason that the old decision is no longer authoritative.
CREATE OR REPLACE FUNCTION public.tg_invalidate_production_sov_after_wip_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  -- Project deletion intentionally cascades the project's financial records.
  -- Do not manufacture invalidations while that parent cascade is underway.
  IF NOT EXISTS (
    SELECT 1
    FROM public.projects project
    WHERE project.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.production_sov_certification_invalidations (
      project_id, production_sov_certification_id, reason_code,
      reason_detail, invalidated_by
    )
    SELECT
      certification.project_id,
      certification.id,
      'source_missing',
      'The certification source Daily WIP row was deleted after certification.',
      v_actor
    FROM public.production_sov_certifications certification
    WHERE certification.source_wip_entry_id = OLD.id
    ON CONFLICT (production_sov_certification_id) DO NOTHING;
    RETURN OLD;
  END IF;

  INSERT INTO public.production_sov_certification_invalidations (
    project_id, production_sov_certification_id, reason_code,
    reason_detail, invalidated_by
  )
  SELECT
    certification.project_id,
    certification.id,
    CASE
      WHEN NEW.voided_at IS NOT NULL
        OR NEW.percent_basis <> 'sov'
        OR NEW.wip_reviewed_at IS NULL
        OR NEW.project_id <> certification.project_id
        OR NEW.cost_bucket_id IS DISTINCT FROM certification.cost_bucket_id
        THEN 'source_not_reviewed_sov'
      ELSE 'source_changed_after_certification'
    END,
    CASE
      WHEN NEW.voided_at IS NOT NULL
        THEN 'The certification source Daily WIP row was voided after certification.'
      WHEN NEW.percent_basis <> 'sov'
        OR NEW.wip_reviewed_at IS NULL
        OR NEW.project_id <> certification.project_id
        OR NEW.cost_bucket_id IS DISTINCT FROM certification.cost_bucket_id
        THEN 'The source is no longer active PM-reviewed SOV evidence for this project and cost code.'
      ELSE 'The source Daily WIP evidence changed after certification.'
    END,
    v_actor
  FROM public.production_sov_certifications certification
  WHERE certification.source_wip_entry_id = NEW.id
    AND (
      NEW.voided_at IS NOT NULL
      OR NEW.percent_basis <> 'sov'
      OR NEW.wip_reviewed_at IS NULL
      OR NEW.project_id <> certification.project_id
      OR NEW.cost_bucket_id IS DISTINCT FROM certification.cost_bucket_id
      OR certification.source_wip_review_version IS NULL
      OR certification.source_wip_updated_at IS NULL
      OR certification.source_wip_reviewed_at IS NULL
      OR NEW.review_version <> certification.source_wip_review_version
      OR NEW.updated_at IS DISTINCT FROM certification.source_wip_updated_at
      OR NEW.wip_reviewed_at IS DISTINCT FROM certification.source_wip_reviewed_at
    )
  ON CONFLICT (production_sov_certification_id) DO NOTHING;

  IF NEW.voided_at IS NULL
     AND NEW.percent_basis = 'sov'
     AND NEW.wip_reviewed_at IS NOT NULL
     AND NEW.cost_bucket_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.daily_wip_entries candidate
       WHERE candidate.project_id = NEW.project_id
         AND candidate.cost_bucket_id = NEW.cost_bucket_id
         AND candidate.percent_basis = 'sov'
         AND candidate.wip_reviewed_at IS NOT NULL
         AND candidate.voided_at IS NULL
         AND ROW(
           candidate.entry_date,
           candidate.wip_reviewed_at,
           candidate.updated_at,
           candidate.id
         ) > ROW(NEW.entry_date, NEW.wip_reviewed_at, NEW.updated_at, NEW.id)
     ) THEN
    INSERT INTO public.production_sov_certification_invalidations (
      project_id, production_sov_certification_id, reason_code,
      reason_detail, invalidated_by
    )
    SELECT
      certification.project_id,
      certification.id,
      'source_superseded_after_certification',
      'Newer PM-reviewed SOV evidence superseded this certification.',
      v_actor
    FROM public.production_sov_certifications certification
    WHERE certification.project_id = NEW.project_id
      AND certification.cost_bucket_id = NEW.cost_bucket_id
      AND certification.source_wip_entry_id IS DISTINCT FROM NEW.id
    ON CONFLICT (production_sov_certification_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_wip_entries_invalidate_production_sov
  ON public.daily_wip_entries;
CREATE TRIGGER daily_wip_entries_invalidate_production_sov
  AFTER INSERT OR UPDATE OR DELETE ON public.daily_wip_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_invalidate_production_sov_after_wip_change();

REVOKE ALL ON FUNCTION public.tg_invalidate_production_sov_after_wip_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tg_keep_production_sov_certification_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.projects project WHERE project.id = OLD.project_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    errcode = '23514',
    message = 'Production SOV certifications are append-only. Append an invalidation or a new certification.';
END;
$$;

DROP TRIGGER IF EXISTS production_sov_certifications_immutable
  ON public.production_sov_certifications;
CREATE TRIGGER production_sov_certifications_immutable
  BEFORE UPDATE OR DELETE ON public.production_sov_certifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_keep_production_sov_certification_immutable();

REVOKE ALL ON FUNCTION public.tg_keep_production_sov_certification_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS private.production_sov_certification_operations (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  operation_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, operation_key),
  CONSTRAINT production_sov_certification_operation_key_present
    CHECK (length(btrim(operation_key)) BETWEEN 1 AND 200),
  CONSTRAINT production_sov_certification_fingerprint_present
    CHECK (length(payload_fingerprint) = 32)
);

ALTER TABLE private.production_sov_certification_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.production_sov_certification_operations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.tg_keep_production_sov_operation_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.projects project WHERE project.id = OLD.project_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION USING
    errcode = '23514',
    message = 'Production SOV certification command receipts are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS production_sov_certification_operations_immutable
  ON private.production_sov_certification_operations;
CREATE TRIGGER production_sov_certification_operations_immutable
  BEFORE UPDATE OR DELETE ON private.production_sov_certification_operations
  FOR EACH ROW EXECUTE FUNCTION private.tg_keep_production_sov_operation_immutable();

REVOKE ALL ON FUNCTION private.tg_keep_production_sov_operation_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.certify_production_sov_position_atomic(
  p_project_id uuid,
  p_cost_bucket_id uuid,
  p_expected_source_wip_entry_id uuid,
  p_expected_source_review_version bigint,
  p_expected_current_sov_percent numeric,
  p_payload jsonb,
  p_operation_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_operation_key text := btrim(coalesce(p_operation_key, ''));
  v_fingerprint text;
  v_existing private.production_sov_certification_operations%ROWTYPE;
  v_source public.daily_wip_entries%ROWTYPE;
  v_bucket public.cost_buckets%ROWTYPE;
  v_certification public.production_sov_certifications%ROWTYPE;
  v_source_period_start date;
  v_source_period_end date;
  v_certified_percent numeric;
  v_target_date date;
  v_planned_quantity numeric;
  v_installed_quantity numeric;
  v_recent_daily_pace numeric;
  v_required_daily_pace numeric;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to certify an SOV position.';
  END IF;
  IF p_project_id IS NULL OR NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'SOV certification details must be a JSON object.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid SOV certification operation key is required.';
  END IF;
  IF p_expected_source_wip_entry_id IS NULL OR p_expected_source_review_version IS NULL THEN
    RAISE EXCEPTION 'The reviewed Daily WIP source and version are required.';
  END IF;
  IF p_expected_current_sov_percent IS NULL
     OR p_expected_current_sov_percent < 0
     OR p_expected_current_sov_percent > 100 THEN
    RAISE EXCEPTION 'The expected current SOV percent must be 0-100.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'certify_production_sov_position_atomic', p_project_id,
    p_cost_bucket_id, p_expected_source_wip_entry_id,
    p_expected_source_review_version, p_expected_current_sov_percent,
    p_payload
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || p_cost_bucket_id::text, 0
  ));
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || v_operation_key, 0
  ));

  SELECT operation.* INTO v_existing
  FROM private.production_sov_certification_operations operation
  WHERE operation.project_id = p_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This certification operation key was already used for different evidence or values.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT bucket.* INTO v_bucket
  FROM public.cost_buckets bucket
  WHERE bucket.id = p_cost_bucket_id
    AND bucket.project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The selected SOV cost code does not belong to this project.';
  END IF;
  IF abs(coalesce(v_bucket.earned_percent_complete, 0) - p_expected_current_sov_percent) > 0.01 THEN
    RAISE EXCEPTION 'The SOV position changed while you were reviewing it. Refresh before certifying.';
  END IF;

  SELECT source.* INTO v_source
  FROM public.daily_wip_entries source
  WHERE source.project_id = p_project_id
    AND source.cost_bucket_id = p_cost_bucket_id
    AND source.percent_basis = 'sov'
    AND source.wip_reviewed_at IS NOT NULL
    AND source.voided_at IS NULL
  ORDER BY source.entry_date DESC,
           source.wip_reviewed_at DESC,
           source.updated_at DESC,
           source.id DESC
  LIMIT 1
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review this cost code in Daily WIP before certifying its SOV position.';
  END IF;
  IF v_source.id <> p_expected_source_wip_entry_id
     OR v_source.review_version <> p_expected_source_review_version THEN
    RAISE EXCEPTION 'Newer or changed reviewed Daily WIP exists for this SOV line. Refresh and certify the current evidence.';
  END IF;

  BEGIN
    v_source_period_start := (p_payload ->> 'source_period_start')::date;
    v_source_period_end := (p_payload ->> 'source_period_end')::date;
    v_certified_percent := (p_payload ->> 'certified_percent')::numeric;
    v_target_date := nullif(btrim(coalesce(p_payload ->> 'target_date', '')), '')::date;
    v_planned_quantity := nullif(btrim(coalesce(p_payload ->> 'planned_quantity', '')), '')::numeric;
    v_installed_quantity := nullif(btrim(coalesce(p_payload ->> 'installed_quantity', '')), '')::numeric;
    v_recent_daily_pace := nullif(btrim(coalesce(p_payload ->> 'recent_daily_pace', '')), '')::numeric;
    v_required_daily_pace := nullif(btrim(coalesce(p_payload ->> 'required_daily_pace', '')), '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'One or more SOV certification dates, percentages, or quantities are invalid.';
  END;

  IF v_source_period_end < v_source_period_start
     OR v_source.entry_date < v_source_period_start
     OR v_source.entry_date > v_source_period_end THEN
    RAISE EXCEPTION 'The evidence period must include the latest reviewed Daily WIP date.';
  END IF;
  IF v_certified_percent < 0 OR v_certified_percent > 100
     OR v_certified_percent * 100 <> trunc(v_certified_percent * 100) THEN
    RAISE EXCEPTION 'The certified percent must be 0-100 with no more than two decimal places.';
  END IF;
  IF coalesce(v_planned_quantity, 0) < 0
     OR coalesce(v_installed_quantity, 0) < 0
     OR coalesce(v_recent_daily_pace, 0) < 0
     OR coalesce(v_required_daily_pace, 0) < 0 THEN
    RAISE EXCEPTION 'Certification quantities and production pace cannot be negative.';
  END IF;
  IF length(coalesce(p_payload ->> 'unit', '')) > 60
     OR length(coalesce(p_payload ->> 'note', '')) > 2000 THEN
    RAISE EXCEPTION 'The certification unit or note exceeds its allowed length.';
  END IF;

  INSERT INTO public.production_sov_certifications (
    project_id, cost_bucket_id, source_wip_entry_id,
    source_wip_review_version, source_wip_updated_at, source_wip_reviewed_at,
    source_period_start, source_period_end, current_sov_percent,
    recommended_percent, certified_percent, target_date, planned_quantity,
    installed_quantity, unit, recent_daily_pace, required_daily_pace,
    calculation_version, certification_note, certified_by
  ) VALUES (
    p_project_id, p_cost_bucket_id, v_source.id,
    v_source.review_version, v_source.updated_at, v_source.wip_reviewed_at,
    v_source_period_start, v_source_period_end,
    round(coalesce(v_bucket.earned_percent_complete, 0), 2),
    round(v_source.percent_complete, 2), v_certified_percent,
    v_target_date, v_planned_quantity, v_installed_quantity,
    btrim(coalesce(p_payload ->> 'unit', '')),
    v_recent_daily_pace, v_required_daily_pace,
    'production-pace-v2-atomic', btrim(coalesce(p_payload ->> 'note', '')), v_actor
  )
  RETURNING * INTO v_certification;

  v_result := jsonb_build_object('certification', to_jsonb(v_certification));
  INSERT INTO private.production_sov_certification_operations (
    project_id, operation_key, payload_fingerprint, result, created_by
  ) VALUES (
    p_project_id, v_operation_key, v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.certify_production_sov_position_atomic(
  uuid, uuid, uuid, bigint, numeric, jsonb, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.certify_production_sov_position_atomic(
  uuid, uuid, uuid, bigint, numeric, jsonb, text
) TO authenticated, service_role;

COMMENT ON FUNCTION public.certify_production_sov_position_atomic(
  uuid, uuid, uuid, bigint, numeric, jsonb, text
) IS
  'Atomic and idempotent PM certification of the absolute latest active reviewed SOV Daily WIP source, with optimistic evidence and SOV concurrency checks.';

-- This trigger is the final financial boundary. Even if a future caller skips
-- the current application helper, an invalidated, superseded, changed, or
-- void-sourced certification cannot alter a Billing draft.
CREATE OR REPLACE FUNCTION public.tg_validate_production_sov_handoff_current()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_certification public.production_sov_certifications%ROWTYPE;
  v_source public.daily_wip_entries%ROWTYPE;
BEGIN
  SELECT certification.* INTO v_certification
  FROM public.production_sov_certifications certification
  WHERE certification.id = NEW.production_sov_certification_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'The PM certification was not found.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.production_sov_certification_invalidations invalidation
    WHERE invalidation.production_sov_certification_id = v_certification.id
  ) THEN
    RAISE EXCEPTION 'This PM certification was invalidated and cannot be applied to Billing.';
  END IF;

  SELECT source.* INTO v_source
  FROM public.daily_wip_entries source
  WHERE source.project_id = v_certification.project_id
    AND source.cost_bucket_id = v_certification.cost_bucket_id
    AND source.percent_basis = 'sov'
    AND source.wip_reviewed_at IS NOT NULL
    AND source.voided_at IS NULL
  ORDER BY source.entry_date DESC,
           source.wip_reviewed_at DESC,
           source.updated_at DESC,
           source.id DESC
  LIMIT 1;

  IF NOT FOUND
     OR v_certification.source_wip_review_version IS NULL
     OR v_certification.source_wip_updated_at IS NULL
     OR v_certification.source_wip_reviewed_at IS NULL
     OR v_source.id <> v_certification.source_wip_entry_id
     OR v_source.review_version <> v_certification.source_wip_review_version
     OR v_source.updated_at IS DISTINCT FROM v_certification.source_wip_updated_at
     OR v_source.wip_reviewed_at IS DISTINCT FROM v_certification.source_wip_reviewed_at THEN
    RAISE EXCEPTION 'Reviewed Daily WIP changed after this PM certification. Certify the current position before applying it to Billing.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_sov_billing_handoffs_current_certification
  ON public.production_sov_billing_handoffs;
CREATE TRIGGER production_sov_billing_handoffs_current_certification
  BEFORE INSERT ON public.production_sov_billing_handoffs
  FOR EACH ROW EXECUTE FUNCTION public.tg_validate_production_sov_handoff_current();

REVOKE ALL ON FUNCTION public.tg_validate_production_sov_handoff_current()
  FROM PUBLIC, anon, authenticated, service_role;

-- Direct client inserts were the stale-source hole. Reads remain available;
-- only the atomic command (or service-role repair tooling) can append a new
-- production certification.
REVOKE ALL ON TABLE public.production_sov_certifications FROM authenticated;
GRANT SELECT ON TABLE public.production_sov_certifications TO authenticated;

NOTIFY pgrst, 'reload schema';
