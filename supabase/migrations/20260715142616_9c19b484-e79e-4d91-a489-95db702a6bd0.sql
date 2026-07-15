-- Enterprise takeoff trust layer.
ALTER TABLE public.estimate_plan_sheets
  ADD COLUMN IF NOT EXISTS scale_revision integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS scale_changed_at timestamptz;

ALTER TABLE public.estimate_plan_sheets
  DROP CONSTRAINT IF EXISTS estimate_plan_sheets_scale_revision_positive;
ALTER TABLE public.estimate_plan_sheets
  ADD CONSTRAINT estimate_plan_sheets_scale_revision_positive
  CHECK (scale_revision >= 1);

ALTER TABLE public.estimate_takeoff_measurements
  ADD COLUMN IF NOT EXISTS calculation_method varchar(32) NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS calculation_status varchar(32) NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS calculated_quantity numeric(14,4),
  ADD COLUMN IF NOT EXISTS calculation_scale_revision integer,
  ADD COLUMN IF NOT EXISTS calculated_at timestamptz,
  ADD COLUMN IF NOT EXISTS calculation_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS override_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ai_operation_id uuid REFERENCES public.ai_operations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_proposal_source varchar(32),
  ADD COLUMN IF NOT EXISTS ai_confidence numeric(6,5),
  ADD COLUMN IF NOT EXISTS ai_original_geometry jsonb,
  ADD COLUMN IF NOT EXISTS ai_review_action varchar(24),
  ADD COLUMN IF NOT EXISTS ai_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_reviewed_at timestamptz;

ALTER TABLE public.estimate_takeoff_measurements
  DROP CONSTRAINT IF EXISTS estimate_takeoff_calculation_method_valid,
  DROP CONSTRAINT IF EXISTS estimate_takeoff_calculation_status_valid,
  DROP CONSTRAINT IF EXISTS estimate_takeoff_calculated_quantity_nonnegative,
  DROP CONSTRAINT IF EXISTS estimate_takeoff_calculation_scale_revision_positive,
  DROP CONSTRAINT IF EXISTS estimate_takeoff_ai_confidence_valid,
  DROP CONSTRAINT IF EXISTS estimate_takeoff_ai_review_action_valid;

ALTER TABLE public.estimate_takeoff_measurements
  ADD CONSTRAINT estimate_takeoff_calculation_method_valid CHECK (
    calculation_method IN ('legacy', 'geometry', 'count', 'manual_override')
  ),
  ADD CONSTRAINT estimate_takeoff_calculation_status_valid CHECK (
    calculation_status IN ('current', 'unverified_scale', 'stale', 'review_required')
  ),
  ADD CONSTRAINT estimate_takeoff_calculated_quantity_nonnegative CHECK (
    calculated_quantity IS NULL OR calculated_quantity >= 0
  ),
  ADD CONSTRAINT estimate_takeoff_calculation_scale_revision_positive CHECK (
    calculation_scale_revision IS NULL OR calculation_scale_revision >= 1
  ),
  ADD CONSTRAINT estimate_takeoff_ai_confidence_valid CHECK (
    ai_confidence IS NULL OR (ai_confidence >= 0 AND ai_confidence <= 1)
  ),
  ADD CONSTRAINT estimate_takeoff_ai_review_action_valid CHECK (
    ai_review_action IS NULL OR ai_review_action IN ('accepted', 'nudged')
  );

UPDATE public.estimate_takeoff_measurements
SET
  calculation_method = CASE WHEN tool_type = 'count' THEN 'count' ELSE 'legacy' END,
  calculation_status = CASE WHEN tool_type = 'count' THEN 'current' ELSE 'review_required' END,
  calculated_quantity = CASE WHEN tool_type = 'count' THEN quantity ELSE NULL END,
  calculation_scale_revision = NULL,
  calculated_at = CASE WHEN tool_type = 'count' THEN COALESCE(updated_at, created_at, now()) ELSE NULL END,
  calculation_context = CASE
    WHEN tool_type = 'count' THEN jsonb_build_object('algorithm', 'legacy-count-backfill-v1')
    ELSE jsonb_build_object('algorithm', 'legacy-unverified-v1')
  END
WHERE calculation_method = 'legacy';

UPDATE public.estimate_takeoff_measurements
SET
  ai_proposal_source = COALESCE(ai_proposal_source, 'legacy'),
  ai_review_action = COALESCE(ai_review_action, 'accepted'),
  ai_reviewed_by = COALESCE(ai_reviewed_by, created_by),
  ai_reviewed_at = COALESCE(ai_reviewed_at, created_at)
WHERE created_by_ai = true;

CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_calculation_status_idx
  ON public.estimate_takeoff_measurements(estimate_id, calculation_status)
  WHERE calculation_status <> 'current';

CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_ai_operation_idx
  ON public.estimate_takeoff_measurements(ai_operation_id)
  WHERE ai_operation_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_plan_sheet_takeoff_trust()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  scale_changed boolean;
BEGIN
  scale_changed :=
    NEW.scale_feet_per_pixel IS DISTINCT FROM OLD.scale_feet_per_pixel OR
    NEW.width_px IS DISTINCT FROM OLD.width_px OR
    NEW.height_px IS DISTINCT FROM OLD.height_px;

  IF scale_changed THEN
    NEW.scale_revision := OLD.scale_revision + 1;
    NEW.scale_changed_at := now();
    NEW.scale_verified_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_invalidate_takeoffs_for_sheet_scale()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.scale_revision IS DISTINCT FROM OLD.scale_revision THEN
    UPDATE public.estimate_takeoff_measurements
    SET
      calculation_status = CASE
        WHEN calculation_method = 'manual_override' THEN 'review_required'
        ELSE 'stale'
      END,
      updated_at = now()
    WHERE plan_sheet_id = NEW.id
      AND tool_type IN ('linear', 'area');
  ELSIF NEW.scale_verified_at IS NOT NULL
    AND OLD.scale_verified_at IS NULL THEN
    UPDATE public.estimate_takeoff_measurements
    SET
      calculation_status = 'current',
      updated_at = now()
    WHERE plan_sheet_id = NEW.id
      AND tool_type IN ('linear', 'area')
      AND calculation_status = 'unverified_scale'
      AND calculation_scale_revision = NEW.scale_revision;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimate_plan_sheets_takeoff_trust_before ON public.estimate_plan_sheets;
CREATE TRIGGER estimate_plan_sheets_takeoff_trust_before
  BEFORE UPDATE OF scale_feet_per_pixel, width_px, height_px, scale_verified_at
  ON public.estimate_plan_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_plan_sheet_takeoff_trust();

DROP TRIGGER IF EXISTS estimate_plan_sheets_takeoff_trust_after ON public.estimate_plan_sheets;
CREATE TRIGGER estimate_plan_sheets_takeoff_trust_after
  AFTER UPDATE OF scale_feet_per_pixel, width_px, height_px, scale_verified_at
  ON public.estimate_plan_sheets
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_invalidate_takeoffs_for_sheet_scale();

REVOKE EXECUTE ON FUNCTION public.tg_plan_sheet_takeoff_trust() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tg_invalidate_takeoffs_for_sheet_scale() FROM PUBLIC, anon, authenticated;

COMMENT ON COLUMN public.estimate_plan_sheets.scale_revision IS
  'Monotonic revision of the pixel-to-feet measurement basis. Linear and area takeoffs record the revision used.';
COMMENT ON COLUMN public.estimate_takeoff_measurements.calculation_status IS
  'Whether the stored quantity is safe to sync: current, unverified_scale, stale, or review_required.';
COMMENT ON COLUMN public.estimate_takeoff_measurements.calculation_context IS
  'Auditable inputs and algorithm version used to derive the quantity.';
COMMENT ON COLUMN public.estimate_takeoff_measurements.override_reason IS
  'Estimator explanation required when a geometry-derived quantity is manually overridden.';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_plan_sheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_takeoff_measurements TO authenticated;
GRANT ALL ON public.estimate_plan_sheets TO service_role;
GRANT ALL ON public.estimate_takeoff_measurements TO service_role;

NOTIFY pgrst, 'reload schema';