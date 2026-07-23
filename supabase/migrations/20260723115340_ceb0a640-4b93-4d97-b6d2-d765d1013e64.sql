-- Daily WIP command integrity.
--
-- Daily WIP is production and cost evidence. Authenticated clients may read
-- active rows, but real-project writes now cross one atomic, idempotent RPC.
-- Historical edits and removals are preserved as immutable events; a removal
-- voids the row instead of deleting the underlying fact.

DO $daily_wip_cent_audit$
DECLARE
  v_entry_id uuid;
BEGIN
  SELECT entry.id
    INTO v_entry_id
  FROM public.daily_wip_entries entry
  WHERE entry.labor_rate < 0
     OR entry.material_cost < 0
     OR entry.equipment_cost < 0
     OR entry.labor_rate * 100 <> trunc(entry.labor_rate * 100)
     OR entry.material_cost * 100 <> trunc(entry.material_cost * 100)
     OR entry.equipment_cost * 100 <> trunc(entry.equipment_cost * 100)
     OR entry.labor_rate * 100 > 9007199254740991
     OR entry.material_cost * 100 > 9007199254740991
     OR entry.equipment_cost * 100 > 9007199254740991
  ORDER BY entry.id
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION USING
      errcode = '23514',
      message = format('Daily WIP entry %s contains unsupported or fractional-cent money.', v_entry_id),
      hint = 'Correct labor rate, material cost, and equipment cost to exact cents before retrying this migration.';
  END IF;
END;
$daily_wip_cent_audit$;

ALTER TABLE public.daily_wip_entries
  ADD COLUMN IF NOT EXISTS labor_rate_cents bigint,
  ADD COLUMN IF NOT EXISTS material_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS equipment_cost_cents bigint,
  ADD COLUMN IF NOT EXISTS version bigint,
  ADD COLUMN IF NOT EXISTS review_version bigint,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

-- This is a representational backfill, not a factual WIP edit. Preserve the
-- original evidence timestamp so the certification repair that follows can
-- distinguish genuinely changed sources from rows merely converted to cents.
ALTER TABLE public.daily_wip_entries
  DISABLE TRIGGER daily_wip_entries_set_updated_at;

UPDATE public.daily_wip_entries
SET labor_rate_cents = round(labor_rate * 100)::bigint,
    material_cost_cents = round(material_cost * 100)::bigint,
    equipment_cost_cents = round(equipment_cost * 100)::bigint,
    version = coalesce(version, 1),
    review_version = coalesce(
      review_version,
      case when wip_reviewed_at is null then 0 else 1 end
    ),
    void_reason = coalesce(void_reason, '')
WHERE labor_rate_cents IS NULL
   OR material_cost_cents IS NULL
   OR equipment_cost_cents IS NULL
   OR version IS NULL
   OR review_version IS NULL
   OR void_reason IS NULL;

ALTER TABLE public.daily_wip_entries
  ENABLE TRIGGER daily_wip_entries_set_updated_at;

ALTER TABLE public.daily_wip_entries
  ALTER COLUMN labor_rate_cents SET DEFAULT 0,
  ALTER COLUMN labor_rate_cents SET NOT NULL,
  ALTER COLUMN material_cost_cents SET DEFAULT 0,
  ALTER COLUMN material_cost_cents SET NOT NULL,
  ALTER COLUMN equipment_cost_cents SET DEFAULT 0,
  ALTER COLUMN equipment_cost_cents SET NOT NULL,
  ALTER COLUMN version SET DEFAULT 1,
  ALTER COLUMN version SET NOT NULL,
  ALTER COLUMN review_version SET DEFAULT 0,
  ALTER COLUMN review_version SET NOT NULL,
  ALTER COLUMN void_reason SET DEFAULT '',
  ALTER COLUMN void_reason SET NOT NULL;

ALTER TABLE public.daily_wip_entries
  DROP CONSTRAINT IF EXISTS daily_wip_entries_command_money_check;
ALTER TABLE public.daily_wip_entries
  ADD CONSTRAINT daily_wip_entries_command_money_check CHECK (
    labor_rate_cents >= 0
    AND material_cost_cents >= 0
    AND equipment_cost_cents >= 0
    AND labor_rate = labor_rate_cents::numeric / 100.0
    AND material_cost = material_cost_cents::numeric / 100.0
    AND equipment_cost = equipment_cost_cents::numeric / 100.0
    AND labor_rate_cents::numeric <= 9007199254740991
    AND material_cost_cents::numeric <= 9007199254740991
    AND equipment_cost_cents::numeric <= 9007199254740991
  );

ALTER TABLE public.daily_wip_entries
  DROP CONSTRAINT IF EXISTS daily_wip_entries_command_version_check;
ALTER TABLE public.daily_wip_entries
  ADD CONSTRAINT daily_wip_entries_command_version_check CHECK (
    version > 0 AND review_version >= 0 AND review_version <= version
  );

ALTER TABLE public.daily_wip_entries
  DROP CONSTRAINT IF EXISTS daily_wip_entries_void_check;
ALTER TABLE public.daily_wip_entries
  ADD CONSTRAINT daily_wip_entries_void_check CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason = '')
    OR
    (voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(btrim(void_reason)) BETWEEN 1 AND 1000)
  );

COMMENT ON COLUMN public.daily_wip_entries.labor_rate_cents IS
  'Canonical blended labor rate in integer cents per person-hour.';
COMMENT ON COLUMN public.daily_wip_entries.material_cost_cents IS
  'Canonical material cost in integer cents.';
COMMENT ON COLUMN public.daily_wip_entries.equipment_cost_cents IS
  'Canonical equipment cost in integer cents.';
COMMENT ON COLUMN public.daily_wip_entries.version IS
  'Optimistic concurrency version incremented by every factual edit or void.';
COMMENT ON COLUMN public.daily_wip_entries.review_version IS
  'Version of PM-reviewed SOV or CPM evidence; certifications snapshot this value.';

CREATE TABLE IF NOT EXISTS public.daily_wip_entry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  daily_wip_entry_id uuid NOT NULL,
  operation_key text NOT NULL,
  event_type text NOT NULL,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_wip_entry_events_project_operation_unique
    UNIQUE (project_id, operation_key),
  CONSTRAINT daily_wip_entry_events_operation_key_present
    CHECK (length(btrim(operation_key)) BETWEEN 1 AND 200),
  CONSTRAINT daily_wip_entry_events_type_check
    CHECK (event_type IN ('created', 'updated', 'voided'))
);

CREATE INDEX IF NOT EXISTS daily_wip_entry_events_entry_created_idx
  ON public.daily_wip_entry_events (daily_wip_entry_id, created_at DESC);

ALTER TABLE public.daily_wip_entry_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_wip_entry_events_team_select
  ON public.daily_wip_entry_events;
CREATE POLICY daily_wip_entry_events_team_select
  ON public.daily_wip_entry_events
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id));

REVOKE ALL ON TABLE public.daily_wip_entry_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.daily_wip_entry_events TO authenticated;
GRANT ALL ON TABLE public.daily_wip_entry_events TO service_role;

CREATE OR REPLACE FUNCTION public.tg_keep_daily_wip_events_immutable()
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
  RAISE EXCEPTION USING errcode = '23514', message = 'Daily WIP audit events are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS daily_wip_entry_events_immutable
  ON public.daily_wip_entry_events;
CREATE TRIGGER daily_wip_entry_events_immutable
  BEFORE UPDATE OR DELETE ON public.daily_wip_entry_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_keep_daily_wip_events_immutable();

REVOKE ALL ON FUNCTION public.tg_keep_daily_wip_events_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.daily_wip_command_operations (
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  operation_key text NOT NULL,
  command_type text NOT NULL,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, operation_key),
  CONSTRAINT daily_wip_command_operation_key_present
    CHECK (length(btrim(operation_key)) BETWEEN 1 AND 200),
  CONSTRAINT daily_wip_command_type_present
    CHECK (length(btrim(command_type)) BETWEEN 1 AND 80),
  CONSTRAINT daily_wip_command_fingerprint_present
    CHECK (length(payload_fingerprint) = 32)
);

ALTER TABLE private.daily_wip_command_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.daily_wip_command_operations
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.tg_keep_daily_wip_command_journal_immutable()
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
  RAISE EXCEPTION USING errcode = '23514', message = 'Daily WIP command receipts are immutable.';
END;
$$;

DROP TRIGGER IF EXISTS daily_wip_command_operations_immutable
  ON private.daily_wip_command_operations;
CREATE TRIGGER daily_wip_command_operations_immutable
  BEFORE UPDATE OR DELETE ON private.daily_wip_command_operations
  FOR EACH ROW EXECUTE FUNCTION private.tg_keep_daily_wip_command_journal_immutable();

REVOKE ALL ON FUNCTION private.tg_keep_daily_wip_command_journal_immutable()
  FROM PUBLIC, anon, authenticated, service_role;

-- Block raw mutations for real projects. The versioned Harbor onboarding demo
-- still performs deterministic fixture maintenance through existing server
-- code; the guard normalizes those DEMO-HARBOR rows while rejecting every
-- other direct insert, update, or delete.
CREATE OR REPLACE FUNCTION public.tg_guard_daily_wip_command_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  v_is_demo boolean;
BEGIN
  IF current_setting('overwatch.daily_wip_command_write', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  SELECT project.job_number = 'DEMO-HARBOR'
    INTO v_is_demo
  FROM public.projects project
  WHERE project.id = v_project_id;

  IF NOT coalesce(v_is_demo, false) THEN
    RAISE EXCEPTION 'Daily WIP must be changed through the audited command workflow.';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.labor_rate * 100 <> trunc(NEW.labor_rate * 100)
     OR NEW.material_cost * 100 <> trunc(NEW.material_cost * 100)
     OR NEW.equipment_cost * 100 <> trunc(NEW.equipment_cost * 100) THEN
    RAISE EXCEPTION 'Daily WIP demo money must resolve to exact cents.';
  END IF;

  NEW.labor_rate_cents := round(NEW.labor_rate * 100)::bigint;
  NEW.material_cost_cents := round(NEW.material_cost * 100)::bigint;
  NEW.equipment_cost_cents := round(NEW.equipment_cost * 100)::bigint;
  NEW.version := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.version + 1 END;
  NEW.review_version := CASE
    WHEN TG_OP = 'INSERT' THEN CASE WHEN NEW.wip_reviewed_at IS NULL THEN 0 ELSE 1 END
    WHEN ROW(NEW.percent_complete, NEW.wip_reviewed_at, NEW.wip_reviewed_by)
         IS DISTINCT FROM ROW(OLD.percent_complete, OLD.wip_reviewed_at, OLD.wip_reviewed_by)
      THEN OLD.review_version + 1
    ELSE OLD.review_version
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS daily_wip_entries_command_guard
  ON public.daily_wip_entries;
CREATE TRIGGER daily_wip_entries_command_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.daily_wip_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_guard_daily_wip_command_write();

REVOKE ALL ON FUNCTION public.tg_guard_daily_wip_command_write()
  FROM PUBLIC, anon, authenticated, service_role;

-- Active rows remain available to the current application. Voided evidence is
-- retained for service-role/audit reads and exposed through its event history,
-- but it cannot keep feeding production or cost rollups.
DROP POLICY IF EXISTS daily_wip_entries_team_select ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_select ON public.daily_wip_entries
  FOR SELECT TO authenticated
  USING (voided_at IS NULL AND public.can_read_project(project_id));

DROP POLICY IF EXISTS daily_wip_entries_team_insert ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_insert ON public.daily_wip_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_project(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id = daily_wip_entries.project_id
        AND project.job_number = 'DEMO-HARBOR'
    )
  );

DROP POLICY IF EXISTS daily_wip_entries_team_update ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_update ON public.daily_wip_entries
  FOR UPDATE TO authenticated
  USING (
    public.can_manage_project(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id = daily_wip_entries.project_id
        AND project.job_number = 'DEMO-HARBOR'
    )
  )
  WITH CHECK (
    public.can_manage_project(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id = daily_wip_entries.project_id
        AND project.job_number = 'DEMO-HARBOR'
    )
  );

DROP POLICY IF EXISTS daily_wip_entries_team_delete ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_delete ON public.daily_wip_entries
  FOR DELETE TO authenticated
  USING (
    public.can_manage_project(project_id)
    AND EXISTS (
      SELECT 1 FROM public.projects project
      WHERE project.id = daily_wip_entries.project_id
        AND project.job_number = 'DEMO-HARBOR'
    )
  );

CREATE OR REPLACE FUNCTION public.save_daily_wip_entry_atomic(
  p_project_id uuid,
  p_entry_id uuid,
  p_expected_version bigint,
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
  v_existing private.daily_wip_command_operations%ROWTYPE;
  v_before public.daily_wip_entries%ROWTYPE;
  v_entry public.daily_wip_entries%ROWTYPE;
  v_entry_id uuid := coalesce(p_entry_id, gen_random_uuid());
  v_cost_bucket_id uuid;
  v_schedule_activity_id uuid;
  v_subcontractor_id uuid;
  v_entry_date date;
  v_people_per_crew smallint;
  v_labor_rate_cents bigint;
  v_material_cost_cents bigint;
  v_equipment_cost_cents bigint;
  v_material_sum_cents bigint := 0;
  v_equipment_sum_cents bigint := 0;
  v_percent_source text;
  v_percent numeric;
  v_field_percent numeric;
  v_reviewed_percent numeric;
  v_percent_overridden_at timestamptz;
  v_wip_reviewed_at timestamptz;
  v_wip_reviewed_by uuid;
  v_review_version bigint;
  v_item jsonb;
  v_item_cents bigint;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to save Daily WIP.';
  END IF;
  IF p_project_id IS NULL OR NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Daily WIP details must be a JSON object.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid Daily WIP operation key is required.';
  END IF;
  IF coalesce(p_expected_version, -1) < 0 THEN
    RAISE EXCEPTION 'A nonnegative expected Daily WIP version is required.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'save_daily_wip_entry_atomic', p_project_id, p_entry_id,
    p_expected_version, p_payload
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || v_operation_key, 0
  ));

  SELECT operation.*
    INTO v_existing
  FROM private.daily_wip_command_operations operation
  WHERE operation.project_id = p_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'save_daily_wip_entry_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This Daily WIP operation key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  IF p_entry_id IS NOT NULL THEN
    SELECT entry.*
      INTO v_before
    FROM public.daily_wip_entries entry
    WHERE entry.id = p_entry_id
      AND entry.project_id = p_project_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Daily WIP entry not found for this project.';
    END IF;
    IF v_before.voided_at IS NOT NULL THEN
      RAISE EXCEPTION 'A voided Daily WIP entry cannot be edited. Record a correcting line.';
    END IF;
    IF v_before.version <> p_expected_version THEN
      RAISE EXCEPTION 'Daily WIP changed while you were editing it. Refresh and review the current line.';
    END IF;
  ELSIF p_expected_version <> 0 THEN
    RAISE EXCEPTION 'A new Daily WIP entry must use expected version 0.';
  END IF;

  BEGIN
    v_cost_bucket_id := nullif(btrim(coalesce(p_payload ->> 'cost_bucket_id', '')), '')::uuid;
    v_schedule_activity_id := nullif(btrim(coalesce(p_payload ->> 'schedule_activity_id', '')), '')::uuid;
    v_subcontractor_id := nullif(btrim(coalesce(p_payload ->> 'subcontractor_id', '')), '')::uuid;
    v_entry_date := (p_payload ->> 'entry_date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'One or more Daily WIP identifiers or the entry date are invalid.';
  END;

  IF v_cost_bucket_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.cost_buckets bucket
    WHERE bucket.id = v_cost_bucket_id AND bucket.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'The selected cost code does not belong to this project.';
  END IF;
  IF v_schedule_activity_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.schedule_activities activity
    WHERE activity.id = v_schedule_activity_id AND activity.project_id = p_project_id
  ) THEN
    RAISE EXCEPTION 'The selected schedule activity does not belong to this project.';
  END IF;
  IF v_subcontractor_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.subcontracts subcontract
    WHERE subcontract.project_id = p_project_id
      AND subcontract.subcontractor_id = v_subcontractor_id
  ) THEN
    RAISE EXCEPTION 'The selected subcontractor is not attached to this project.';
  END IF;
  IF v_subcontractor_id IS NOT NULL
     AND length(btrim(coalesce(p_payload ->> 'unmatched_vendor_name', ''))) > 0 THEN
    RAISE EXCEPTION 'Choose a project subcontractor or enter an unlisted vendor name, not both.';
  END IF;

  IF coalesce(p_payload ->> 'labor_rate_cents', '') !~ '^[0-9]+$'
     OR coalesce(p_payload ->> 'material_cost_cents', '') !~ '^[0-9]+$'
     OR coalesce(p_payload ->> 'equipment_cost_cents', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Daily WIP money must use nonnegative integer cents.';
  END IF;
  v_labor_rate_cents := (p_payload ->> 'labor_rate_cents')::bigint;
  v_material_cost_cents := (p_payload ->> 'material_cost_cents')::bigint;
  v_equipment_cost_cents := (p_payload ->> 'equipment_cost_cents')::bigint;
  IF v_labor_rate_cents::numeric > 9007199254740991
     OR v_material_cost_cents::numeric > 9007199254740991
     OR v_equipment_cost_cents::numeric > 9007199254740991 THEN
    RAISE EXCEPTION 'Daily WIP money exceeds the safe integer-cent domain.';
  END IF;

  IF jsonb_typeof(coalesce(p_payload -> 'material_items', '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(coalesce(p_payload -> 'equipment_items', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_payload -> 'material_items', '[]'::jsonb)) > 100
     OR jsonb_array_length(coalesce(p_payload -> 'equipment_items', '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Daily WIP material and equipment details must each be a list of at most 100 items.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'material_items', '[]'::jsonb)) LOOP
    IF coalesce(v_item ->> 'amount_cents', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Every material item must use nonnegative integer cents.';
    END IF;
    v_item_cents := (v_item ->> 'amount_cents')::bigint;
    IF v_item_cents::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'A material item exceeds the safe integer-cent domain.';
    END IF;
    v_material_sum_cents := v_material_sum_cents + v_item_cents;
  END LOOP;
  FOR v_item IN SELECT value FROM jsonb_array_elements(coalesce(p_payload -> 'equipment_items', '[]'::jsonb)) LOOP
    IF coalesce(v_item ->> 'amount_cents', '') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Every equipment item must use nonnegative integer cents.';
    END IF;
    v_item_cents := (v_item ->> 'amount_cents')::bigint;
    IF v_item_cents::numeric > 9007199254740991 THEN
      RAISE EXCEPTION 'An equipment item exceeds the safe integer-cent domain.';
    END IF;
    v_equipment_sum_cents := v_equipment_sum_cents + v_item_cents;
  END LOOP;
  IF jsonb_array_length(coalesce(p_payload -> 'material_items', '[]'::jsonb)) > 0
     AND v_material_sum_cents <> v_material_cost_cents THEN
    RAISE EXCEPTION 'Material item cents do not match the material total.';
  END IF;
  IF jsonb_array_length(coalesce(p_payload -> 'equipment_items', '[]'::jsonb)) > 0
     AND v_equipment_sum_cents <> v_equipment_cost_cents THEN
    RAISE EXCEPTION 'Equipment item cents do not match the equipment total.';
  END IF;

  IF coalesce(p_payload ->> 'crew_count', '') !~ '^[0-9]+(\.[0-9]+)?$'
     OR coalesce(p_payload ->> 'hours', '') !~ '^[0-9]+(\.[0-9]+)?$'
     OR coalesce(p_payload ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]+)?$'
     OR coalesce(p_payload ->> 'percent_complete', '') !~ '^[0-9]+(\.[0-9]+)?$'
     OR coalesce(p_payload ->> 'people_per_crew', '') !~ '^[0-9]+$' THEN
    RAISE EXCEPTION 'Daily WIP quantities, hours, crew, and percent must be nonnegative numbers.';
  END IF;
  v_people_per_crew := (p_payload ->> 'people_per_crew')::smallint;
  v_percent := (p_payload ->> 'percent_complete')::numeric;
  IF v_people_per_crew < 1 OR v_people_per_crew > 100 OR v_percent < 0 OR v_percent > 100 THEN
    RAISE EXCEPTION 'People per crew must be 1-100 and percent complete must be 0-100.';
  END IF;
  IF coalesce(p_payload ->> 'percent_basis', '') NOT IN ('sov', 'cpm') THEN
    RAISE EXCEPTION 'Daily WIP percent basis must be SOV or CPM.';
  END IF;
  IF p_payload ->> 'percent_basis' = 'cpm' AND v_schedule_activity_id IS NULL THEN
    RAISE EXCEPTION 'CPM-basis progress requires a linked schedule activity.';
  END IF;
  IF jsonb_typeof(coalesce(p_payload -> 'quantity_items', '[]'::jsonb)) <> 'array'
     OR jsonb_array_length(coalesce(p_payload -> 'quantity_items', '[]'::jsonb)) > 100 THEN
    RAISE EXCEPTION 'Installed quantities must be a list of at most 100 items.';
  END IF;
  IF nullif(btrim(coalesce(p_payload ->> 'target_production_rate', '')), '') IS NOT NULL
     AND coalesce(p_payload ->> 'target_production_rate', '') !~ '^[0-9]+(\.[0-9]+)?$' THEN
    RAISE EXCEPTION 'Target production rate must be a positive number.';
  END IF;
  IF nullif(btrim(coalesce(p_payload ->> 'target_production_rate', '')), '')::numeric IS NOT NULL
     AND (
       (p_payload ->> 'target_production_rate')::numeric <= 0
       OR (p_payload ->> 'target_production_rate')::numeric > 1000000000
     ) THEN
    RAISE EXCEPTION 'Target production rate must be greater than zero and no more than 1,000,000,000.';
  END IF;

  IF length(coalesce(p_payload ->> 'activity', '')) > 500
     OR length(coalesce(p_payload ->> 'unit', '')) > 40
     OR length(coalesce(p_payload ->> 'unmatched_vendor_name', '')) > 200
     OR length(coalesce(p_payload ->> 'notes', '')) > 4000 THEN
    RAISE EXCEPTION 'One or more Daily WIP text fields exceed their allowed length.';
  END IF;

  v_percent_source := coalesce(p_payload ->> 'percent_source', 'field');
  IF v_percent_source NOT IN ('field', 'costing') THEN
    RAISE EXCEPTION 'Daily WIP percent source must be field or costing.';
  END IF;

  IF p_entry_id IS NULL THEN
    v_field_percent := v_percent;
    v_reviewed_percent := v_percent;
    v_percent_overridden_at := NULL;
    v_wip_reviewed_at := CASE WHEN v_percent_source = 'costing' THEN now() ELSE NULL END;
    v_wip_reviewed_by := CASE WHEN v_percent_source = 'costing' THEN v_actor ELSE NULL END;
    v_review_version := CASE WHEN v_percent_source = 'costing' THEN 1 ELSE 0 END;
  ELSIF v_percent_source = 'costing' THEN
    v_field_percent := v_before.field_percent_complete;
    v_reviewed_percent := v_percent;
    v_percent_overridden_at := CASE
      WHEN v_percent = v_before.field_percent_complete THEN NULL ELSE now() END;
    v_wip_reviewed_at := now();
    v_wip_reviewed_by := v_actor;
    v_review_version := v_before.review_version + 1;
  ELSE
    -- A field-side edit changes the evidence envelope even when the PM's
    -- override value is preserved. Clear the approval timestamp so the PM must
    -- review the current facts before a new certification can rely on them.
    v_field_percent := v_percent;
    IF v_before.percent_overridden_at IS NOT NULL THEN
      v_reviewed_percent := v_before.percent_complete;
      v_percent_overridden_at := v_before.percent_overridden_at;
      v_wip_reviewed_at := NULL;
      v_wip_reviewed_by := NULL;
      v_review_version := v_before.review_version + 1;
    ELSE
      v_reviewed_percent := v_percent;
      v_percent_overridden_at := NULL;
      v_wip_reviewed_at := NULL;
      v_wip_reviewed_by := NULL;
      v_review_version := v_before.review_version + 1;
    END IF;
  END IF;

  PERFORM set_config('overwatch.daily_wip_command_write', 'on', true);
  IF p_entry_id IS NULL THEN
    INSERT INTO public.daily_wip_entries (
      id, project_id, cost_bucket_id, schedule_activity_id, subcontractor_id,
      unmatched_vendor_name, entry_date, activity, crew_count, people_per_crew,
      hours, labor_rate, labor_rate_cents, material_cost, material_cost_cents,
      equipment_cost, equipment_cost_cents, material_items, equipment_items,
      quantity, unit, target_production_rate, quantity_items, percent_basis,
      percent_complete, field_percent_complete, percent_overridden_at,
      wip_reviewed_at, wip_reviewed_by, notes, created_by, version, review_version
    ) VALUES (
      v_entry_id, p_project_id, v_cost_bucket_id, v_schedule_activity_id, v_subcontractor_id,
      btrim(coalesce(p_payload ->> 'unmatched_vendor_name', '')), v_entry_date,
      btrim(coalesce(p_payload ->> 'activity', '')),
      (p_payload ->> 'crew_count')::numeric, v_people_per_crew,
      (p_payload ->> 'hours')::numeric,
      v_labor_rate_cents::numeric / 100.0, v_labor_rate_cents,
      v_material_cost_cents::numeric / 100.0, v_material_cost_cents,
      v_equipment_cost_cents::numeric / 100.0, v_equipment_cost_cents,
      coalesce(p_payload -> 'material_items', '[]'::jsonb),
      coalesce(p_payload -> 'equipment_items', '[]'::jsonb),
      (p_payload ->> 'quantity')::numeric, btrim(coalesce(p_payload ->> 'unit', '')),
      nullif(btrim(coalesce(p_payload ->> 'target_production_rate', '')), '')::numeric,
      coalesce(p_payload -> 'quantity_items', '[]'::jsonb),
      p_payload ->> 'percent_basis', v_reviewed_percent, v_field_percent,
      v_percent_overridden_at, v_wip_reviewed_at, v_wip_reviewed_by,
      coalesce(p_payload ->> 'notes', ''), v_actor, 1, v_review_version
    )
    RETURNING * INTO v_entry;
  ELSE
    UPDATE public.daily_wip_entries entry
    SET cost_bucket_id = v_cost_bucket_id,
        schedule_activity_id = v_schedule_activity_id,
        subcontractor_id = v_subcontractor_id,
        unmatched_vendor_name = btrim(coalesce(p_payload ->> 'unmatched_vendor_name', '')),
        entry_date = v_entry_date,
        activity = btrim(coalesce(p_payload ->> 'activity', '')),
        crew_count = (p_payload ->> 'crew_count')::numeric,
        people_per_crew = v_people_per_crew,
        hours = (p_payload ->> 'hours')::numeric,
        labor_rate = v_labor_rate_cents::numeric / 100.0,
        labor_rate_cents = v_labor_rate_cents,
        material_cost = v_material_cost_cents::numeric / 100.0,
        material_cost_cents = v_material_cost_cents,
        equipment_cost = v_equipment_cost_cents::numeric / 100.0,
        equipment_cost_cents = v_equipment_cost_cents,
        material_items = coalesce(p_payload -> 'material_items', '[]'::jsonb),
        equipment_items = coalesce(p_payload -> 'equipment_items', '[]'::jsonb),
        quantity = (p_payload ->> 'quantity')::numeric,
        unit = btrim(coalesce(p_payload ->> 'unit', '')),
        target_production_rate = nullif(btrim(coalesce(p_payload ->> 'target_production_rate', '')), '')::numeric,
        quantity_items = coalesce(p_payload -> 'quantity_items', '[]'::jsonb),
        percent_basis = p_payload ->> 'percent_basis',
        percent_complete = v_reviewed_percent,
        field_percent_complete = v_field_percent,
        percent_overridden_at = v_percent_overridden_at,
        wip_reviewed_at = v_wip_reviewed_at,
        wip_reviewed_by = v_wip_reviewed_by,
        notes = coalesce(p_payload ->> 'notes', ''),
        version = v_before.version + 1,
        review_version = v_review_version
    WHERE entry.id = p_entry_id
    RETURNING * INTO v_entry;
  END IF;

  v_result := jsonb_build_object('entry', to_jsonb(v_entry));
  INSERT INTO public.daily_wip_entry_events (
    project_id, daily_wip_entry_id, operation_key, event_type,
    before_snapshot, after_snapshot, created_by
  ) VALUES (
    p_project_id, v_entry.id, v_operation_key,
    CASE WHEN p_entry_id IS NULL THEN 'created' ELSE 'updated' END,
    CASE WHEN p_entry_id IS NULL THEN NULL ELSE to_jsonb(v_before) END,
    to_jsonb(v_entry), v_actor
  );
  INSERT INTO private.daily_wip_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    p_project_id, v_operation_key, 'save_daily_wip_entry_atomic',
    v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.void_daily_wip_entry_atomic(
  p_project_id uuid,
  p_entry_id uuid,
  p_expected_version bigint,
  p_reason text,
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
  v_reason text := btrim(coalesce(p_reason, ''));
  v_fingerprint text;
  v_existing private.daily_wip_command_operations%ROWTYPE;
  v_before public.daily_wip_entries%ROWTYPE;
  v_entry public.daily_wip_entries%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to void Daily WIP.';
  END IF;
  IF p_project_id IS NULL OR NOT public.can_manage_project(p_project_id) THEN
    RAISE EXCEPTION 'You do not have permission to manage this project.';
  END IF;
  IF length(v_operation_key) = 0 OR length(v_operation_key) > 200 THEN
    RAISE EXCEPTION 'A valid Daily WIP void operation key is required.';
  END IF;
  IF p_expected_version IS NULL OR p_expected_version < 1 THEN
    RAISE EXCEPTION 'A positive expected Daily WIP version is required.';
  END IF;
  IF length(v_reason) = 0 OR length(v_reason) > 1000 THEN
    RAISE EXCEPTION 'Explain why this Daily WIP entry is being voided.';
  END IF;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(
    'void_daily_wip_entry_atomic', p_project_id, p_entry_id,
    p_expected_version, v_reason
  )::text);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_project_id::text || ':' || v_operation_key, 0
  ));
  SELECT operation.* INTO v_existing
  FROM private.daily_wip_command_operations operation
  WHERE operation.project_id = p_project_id
    AND operation.operation_key = v_operation_key;
  IF FOUND THEN
    IF v_existing.command_type <> 'void_daily_wip_entry_atomic'
       OR v_existing.payload_fingerprint <> v_fingerprint THEN
      RAISE EXCEPTION 'This Daily WIP operation key was already used for a different command or payload.';
    END IF;
    RETURN v_existing.result;
  END IF;

  SELECT entry.* INTO v_before
  FROM public.daily_wip_entries entry
  WHERE entry.id = p_entry_id AND entry.project_id = p_project_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Daily WIP entry not found for this project.';
  END IF;
  IF v_before.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This Daily WIP entry is already voided.';
  END IF;
  IF v_before.version <> p_expected_version THEN
    RAISE EXCEPTION 'Daily WIP changed before it could be voided. Refresh and review the current line.';
  END IF;

  PERFORM set_config('overwatch.daily_wip_command_write', 'on', true);
  UPDATE public.daily_wip_entries entry
  SET voided_at = now(),
      voided_by = v_actor,
      void_reason = v_reason,
      version = v_before.version + 1,
      review_version = CASE
        WHEN v_before.wip_reviewed_at IS NULL THEN v_before.review_version
        ELSE v_before.review_version + 1
      END
  WHERE entry.id = p_entry_id
  RETURNING * INTO v_entry;

  v_result := jsonb_build_object(
    'entry_id', v_entry.id,
    'project_id', v_entry.project_id,
    'version', v_entry.version,
    'voided_at', v_entry.voided_at
  );
  INSERT INTO public.daily_wip_entry_events (
    project_id, daily_wip_entry_id, operation_key, event_type,
    before_snapshot, after_snapshot, created_by
  ) VALUES (
    p_project_id, v_entry.id, v_operation_key, 'voided',
    to_jsonb(v_before), to_jsonb(v_entry), v_actor
  );
  INSERT INTO private.daily_wip_command_operations (
    project_id, operation_key, command_type, payload_fingerprint, result, created_by
  ) VALUES (
    p_project_id, v_operation_key, 'void_daily_wip_entry_atomic',
    v_fingerprint, v_result, v_actor
  );
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_daily_wip_entry_atomic(uuid, uuid, bigint, jsonb, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_daily_wip_entry_atomic(uuid, uuid, bigint, jsonb, text)
  TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.void_daily_wip_entry_atomic(uuid, uuid, bigint, text, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_daily_wip_entry_atomic(uuid, uuid, bigint, text, text)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.save_daily_wip_entry_atomic(uuid, uuid, bigint, jsonb, text) IS
  'Atomic, idempotent Daily WIP create/update with exact cents, project-local links, optimistic concurrency, PM review semantics, and immutable before/after audit.';
COMMENT ON FUNCTION public.void_daily_wip_entry_atomic(uuid, uuid, bigint, text, text) IS
  'Audit-preserving Daily WIP removal: marks the row void, retains its facts, and writes an immutable command/event receipt.';

NOTIFY pgrst, 'reload schema';
