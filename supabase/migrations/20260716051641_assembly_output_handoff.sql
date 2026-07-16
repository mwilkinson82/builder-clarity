-- Estimator-controlled handoff from a confirmed deterministic assembly output
-- to exactly one estimate row. The handoff is explicit, unit-checked, and
-- audited. AI never selects the destination, pricing, or quantity.

ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS assembly_output_quantity numeric(16,4);
ALTER TABLE public.estimate_line_items
  ADD COLUMN IF NOT EXISTS assembly_output_synced_at timestamptz;

ALTER TABLE public.estimate_line_items
  DROP CONSTRAINT IF EXISTS estimate_line_items_quantity_source_check;
ALTER TABLE public.estimate_line_items
  ADD CONSTRAINT estimate_line_items_quantity_source_check
  CHECK (quantity_source IN ('manual', 'takeoff', 'assembly'));

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_assembly_output_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  assembly_id uuid NOT NULL REFERENCES public.estimate_takeoff_assemblies(id) ON DELETE CASCADE,
  output_key text NOT NULL,
  estimate_line_item_id uuid NOT NULL
    REFERENCES public.estimate_line_items(id) ON DELETE CASCADE,
  formula_version text NOT NULL,
  output_label text NOT NULL,
  output_unit text NOT NULL,
  output_quantity numeric(16,4) NOT NULL,
  status text NOT NULL DEFAULT 'current',
  linked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  stale_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_assembly_output_links_output_unique
    UNIQUE (assembly_id, output_key),
  CONSTRAINT estimate_takeoff_assembly_output_links_line_unique
    UNIQUE (estimate_line_item_id),
  CONSTRAINT estimate_takeoff_assembly_output_links_key_not_blank
    CHECK (length(trim(output_key)) > 0),
  CONSTRAINT estimate_takeoff_assembly_output_links_label_not_blank
    CHECK (length(trim(output_label)) > 0),
  CONSTRAINT estimate_takeoff_assembly_output_links_unit_check
    CHECK (output_unit IN ('LF', 'SF', 'CY', 'EA', 'HR')),
  CONSTRAINT estimate_takeoff_assembly_output_links_quantity_check
    CHECK (output_quantity >= 0),
  CONSTRAINT estimate_takeoff_assembly_output_links_status_check
    CHECK (status IN ('current', 'stale')),
  CONSTRAINT estimate_takeoff_assembly_output_links_stale_check
    CHECK (
      (status = 'current' AND stale_at IS NULL)
      OR (status = 'stale' AND stale_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_links_estimate_idx
  ON public.estimate_takeoff_assembly_output_links(estimate_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_links_linked_by_idx
  ON public.estimate_takeoff_assembly_output_links(linked_by)
  WHERE linked_by IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_assembly_output_link_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id uuid REFERENCES public.estimate_takeoff_assembly_output_links(id) ON DELETE SET NULL,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  assembly_id uuid NOT NULL REFERENCES public.estimate_takeoff_assemblies(id) ON DELETE CASCADE,
  output_key text NOT NULL,
  estimate_line_item_id uuid REFERENCES public.estimate_line_items(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  formula_version text NOT NULL,
  output_label text NOT NULL,
  output_unit text NOT NULL,
  output_quantity numeric(16,4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_assembly_output_link_events_action_check
    CHECK (action IN ('linked', 'synced', 'stale', 'unlinked')),
  CONSTRAINT estimate_takeoff_assembly_output_link_events_unit_check
    CHECK (output_unit IN ('LF', 'SF', 'CY', 'EA', 'HR')),
  CONSTRAINT estimate_takeoff_assembly_output_link_events_quantity_check
    CHECK (output_quantity >= 0)
);

CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_link_events_estimate_idx
  ON public.estimate_takeoff_assembly_output_link_events(estimate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_link_events_link_idx
  ON public.estimate_takeoff_assembly_output_link_events(link_id, created_at DESC)
  WHERE link_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_link_events_assembly_idx
  ON public.estimate_takeoff_assembly_output_link_events(assembly_id, output_key, created_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_link_events_line_idx
  ON public.estimate_takeoff_assembly_output_link_events(estimate_line_item_id, created_at DESC)
  WHERE estimate_line_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS estimate_takeoff_assembly_output_link_events_actor_idx
  ON public.estimate_takeoff_assembly_output_link_events(actor_id)
  WHERE actor_id IS NOT NULL;

ALTER TABLE public.estimate_takeoff_assembly_output_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_takeoff_assembly_output_link_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.estimate_takeoff_assembly_output_links FROM anon, authenticated;
GRANT SELECT ON TABLE public.estimate_takeoff_assembly_output_links TO authenticated;
GRANT ALL ON TABLE public.estimate_takeoff_assembly_output_links TO service_role;
REVOKE ALL ON TABLE public.estimate_takeoff_assembly_output_link_events FROM anon, authenticated;
GRANT SELECT ON TABLE public.estimate_takeoff_assembly_output_link_events TO authenticated;
GRANT ALL ON TABLE public.estimate_takeoff_assembly_output_link_events TO service_role;

DROP POLICY IF EXISTS estimate_takeoff_assembly_output_links_team_select
  ON public.estimate_takeoff_assembly_output_links;
CREATE POLICY estimate_takeoff_assembly_output_links_team_select
  ON public.estimate_takeoff_assembly_output_links
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_takeoff_assembly_output_link_events_team_select
  ON public.estimate_takeoff_assembly_output_link_events;
CREATE POLICY estimate_takeoff_assembly_output_link_events_team_select
  ON public.estimate_takeoff_assembly_output_link_events
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

CREATE OR REPLACE FUNCTION public.normalize_assembly_output_unit(p_unit text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT CASE upper(regexp_replace(replace(trim(p_unit), '.', ''), '[[:space:]]+', ' ', 'g'))
    WHEN 'FT' THEN 'LF'
    WHEN 'FEET' THEN 'LF'
    WHEN 'FOOT' THEN 'LF'
    WHEN 'LNFT' THEN 'LF'
    WHEN 'LIN FT' THEN 'LF'
    WHEN 'LINFT' THEN 'LF'
    WHEN 'LINEAR FT' THEN 'LF'
    WHEN 'LINEAR FEET' THEN 'LF'
    WHEN 'LINEAR FOOT' THEN 'LF'
    WHEN 'SQ FT' THEN 'SF'
    WHEN 'SQFT' THEN 'SF'
    WHEN 'SQF' THEN 'SF'
    WHEN 'SQUARE FEET' THEN 'SF'
    WHEN 'SQUARE FOOT' THEN 'SF'
    WHEN 'EACH' THEN 'EA'
    WHEN 'CT' THEN 'EA'
    WHEN 'COUNT' THEN 'EA'
    WHEN 'HRS' THEN 'HR'
    WHEN 'HOUR' THEN 'HR'
    WHEN 'HOURS' THEN 'HR'
    WHEN 'CU YD' THEN 'CY'
    WHEN 'CUYD' THEN 'CY'
    WHEN 'CUBIC YARD' THEN 'CY'
    WHEN 'CUBIC YARDS' THEN 'CY'
    ELSE upper(regexp_replace(replace(trim(p_unit), '.', ''), '[[:space:]]+', ' ', 'g'))
  END;
$$;

CREATE OR REPLACE FUNCTION public.handoff_estimate_takeoff_assembly_output(
  p_assembly_id uuid,
  p_output_key text,
  p_destination_type text,
  p_estimate_line_item_id uuid DEFAULT NULL,
  p_library_item_id uuid DEFAULT NULL,
  p_label text DEFAULT NULL
)
RETURNS SETOF public.estimate_takeoff_assembly_output_links
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_assembly public.estimate_takeoff_assemblies%ROWTYPE;
  v_output public.estimate_takeoff_assembly_outputs%ROWTYPE;
  v_estimate public.estimates%ROWTYPE;
  v_line public.estimate_line_items%ROWTYPE;
  v_library public.cost_library_items%ROWTYPE;
  v_existing_link public.estimate_takeoff_assembly_output_links%ROWTYPE;
  v_link public.estimate_takeoff_assembly_output_links%ROWTYPE;
  v_sort_order integer;
  v_material_cost integer := 0;
  v_labor_cost integer := 0;
  v_action text := 'linked';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;
  IF p_destination_type NOT IN ('existing', 'library', 'label') THEN
    RAISE EXCEPTION 'Choose an existing estimate row, a cost-library item, or a new row label.'
      USING ERRCODE = '22023';
  END IF;
  IF length(trim(coalesce(p_output_key, ''))) = 0 THEN
    RAISE EXCEPTION 'Assembly output is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_assembly
  FROM public.estimate_takeoff_assemblies
  WHERE id = p_assembly_id
  FOR UPDATE;

  IF v_assembly.id IS NULL OR NOT public.can_manage_estimate(v_assembly.estimate_id) THEN
    RAISE EXCEPTION 'Assembly output access is required.' USING ERRCODE = '42501';
  END IF;
  IF v_assembly.status <> 'confirmed' OR v_assembly.confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm every assembly input before sending an output to the estimate.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_output
  FROM public.estimate_takeoff_assembly_outputs
  WHERE assembly_id = v_assembly.id
    AND estimate_id = v_assembly.estimate_id
    AND output_key = trim(p_output_key)
  FOR UPDATE;
  IF v_output.id IS NULL THEN
    RAISE EXCEPTION 'The deterministic assembly output was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_estimate
  FROM public.estimates
  WHERE id = v_assembly.estimate_id
  FOR UPDATE;
  IF v_estimate.id IS NULL THEN
    RAISE EXCEPTION 'Estimate was not found.' USING ERRCODE = '23503';
  END IF;

  SELECT * INTO v_existing_link
  FROM public.estimate_takeoff_assembly_output_links
  WHERE assembly_id = v_assembly.id
    AND output_key = v_output.output_key
  FOR UPDATE;

  IF p_destination_type = 'existing' THEN
    IF p_estimate_line_item_id IS NULL OR p_library_item_id IS NOT NULL OR p_label IS NOT NULL THEN
      RAISE EXCEPTION 'Choose exactly one existing estimate row.' USING ERRCODE = '22023';
    END IF;
    SELECT * INTO v_line
    FROM public.estimate_line_items
    WHERE id = p_estimate_line_item_id
      AND estimate_id = v_assembly.estimate_id
    FOR UPDATE;
    IF v_line.id IS NULL THEN
      RAISE EXCEPTION 'Estimate row was not found.' USING ERRCODE = '23503';
    END IF;
    IF public.normalize_assembly_output_unit(v_line.unit)
      <> public.normalize_assembly_output_unit(v_output.unit) THEN
      RAISE EXCEPTION 'Assembly output and estimate row units must match.' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.estimate_takeoff_measurements measurement
      WHERE measurement.estimate_line_item_id = v_line.id
    ) THEN
      RAISE EXCEPTION 'This row already receives a measured takeoff. Choose a separate row for the assembly output.'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_link.id IS NOT NULL
      AND v_existing_link.estimate_line_item_id <> v_line.id THEN
      RAISE EXCEPTION 'Detach this assembly output from its current estimate row before relinking it.'
        USING ERRCODE = '23505';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.estimate_takeoff_assembly_output_links other_link
      WHERE other_link.estimate_line_item_id = v_line.id
        AND other_link.id IS DISTINCT FROM v_existing_link.id
    ) THEN
      RAISE EXCEPTION 'This estimate row already receives another assembly output.'
        USING ERRCODE = '23505';
    END IF;
    IF v_existing_link.id IS NULL
      AND v_line.quantity_source = 'manual'
      AND v_line.quantity <> 0
      AND v_line.quantity <> v_output.quantity THEN
      RAISE EXCEPTION 'This row has a hand-entered quantity. Choose an empty row or create a new row so nothing is overwritten.'
        USING ERRCODE = '23505';
    END IF;
    IF v_line.quantity_source = 'takeoff' THEN
      RAISE EXCEPTION 'This row already receives a measured takeoff. Choose a separate row for the assembly output.'
        USING ERRCODE = '23505';
    END IF;
  ELSIF p_destination_type = 'library' THEN
    IF p_library_item_id IS NULL OR p_estimate_line_item_id IS NOT NULL OR p_label IS NOT NULL THEN
      RAISE EXCEPTION 'Choose exactly one cost-library item.' USING ERRCODE = '22023';
    END IF;
    IF v_existing_link.id IS NOT NULL THEN
      RAISE EXCEPTION 'Detach this assembly output before creating another estimate row.'
        USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_library
    FROM public.cost_library_items
    WHERE id = p_library_item_id
      AND organization_id = v_estimate.organization_id;
    IF v_library.id IS NULL THEN
      RAISE EXCEPTION 'Cost-library item was not found.' USING ERRCODE = '23503';
    END IF;
    IF public.normalize_assembly_output_unit(v_library.unit)
      <> public.normalize_assembly_output_unit(v_output.unit) THEN
      RAISE EXCEPTION 'Cost-library item and assembly output units must match.' USING ERRCODE = '22023';
    END IF;
    IF v_library.labor_basis = 'per_hour' THEN
      IF coalesce(v_library.crew_size, 0) <= 0
        OR coalesce(v_library.productivity_per_hour, 0) <= 0 THEN
        RAISE EXCEPTION 'Complete crew size and production per hour in the Cost Library before using this item.'
          USING ERRCODE = '22023';
      END IF;
      v_material_cost := v_library.material_cost_cents;
      v_labor_cost := round(
        (v_library.labor_cost_cents * v_library.crew_size) / v_library.productivity_per_hour
      );
    ELSIF v_library.labor_basis = 'installed' THEN
      v_material_cost := 0;
      v_labor_cost := v_library.labor_cost_cents;
    ELSE
      v_material_cost := v_library.material_cost_cents;
      v_labor_cost := v_library.labor_cost_cents;
    END IF;
  ELSE
    IF p_estimate_line_item_id IS NOT NULL OR p_library_item_id IS NOT NULL
      OR length(trim(coalesce(p_label, ''))) = 0
      OR length(trim(p_label)) > 500 THEN
      RAISE EXCEPTION 'Enter one new estimate-row label up to 500 characters.' USING ERRCODE = '22023';
    END IF;
    IF v_existing_link.id IS NOT NULL THEN
      RAISE EXCEPTION 'Detach this assembly output before creating another estimate row.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF p_destination_type IN ('library', 'label') THEN
    SELECT coalesce(max(sort_order), 0) + 1 INTO v_sort_order
    FROM public.estimate_line_items
    WHERE estimate_id = v_assembly.estimate_id;

    INSERT INTO public.estimate_line_items (
      estimate_id,
      csi_division,
      cost_code,
      description,
      unit,
      quantity,
      quantity_source,
      assembly_output_quantity,
      assembly_output_synced_at,
      material_unit_cost_cents,
      labor_unit_cost_cents,
      library_item_id,
      sort_order,
      notes
    ) VALUES (
      v_assembly.estimate_id,
      CASE WHEN p_destination_type = 'library' THEN v_library.csi_division ELSE '' END,
      CASE WHEN p_destination_type = 'library' THEN v_library.csi_code ELSE '' END,
      CASE WHEN p_destination_type = 'library' THEN v_library.description ELSE trim(p_label) END,
      v_output.unit,
      v_output.quantity,
      'assembly',
      v_output.quantity,
      now(),
      v_material_cost,
      v_labor_cost,
      CASE WHEN p_destination_type = 'library' THEN v_library.id ELSE NULL END,
      v_sort_order,
      CASE
        WHEN p_destination_type = 'library'
          THEN 'Created from a confirmed Plan Room assembly output.'
        ELSE 'Created from a confirmed Plan Room assembly output. Needs pricing.'
      END
    )
    RETURNING * INTO v_line;
  ELSE
    UPDATE public.estimate_line_items
    SET quantity = v_output.quantity,
        quantity_source = 'assembly',
        assembly_output_quantity = v_output.quantity,
        assembly_output_synced_at = now(),
        updated_at = now()
    WHERE id = v_line.id
    RETURNING * INTO v_line;
  END IF;

  IF v_existing_link.id IS NULL THEN
    INSERT INTO public.estimate_takeoff_assembly_output_links (
      estimate_id,
      assembly_id,
      output_key,
      estimate_line_item_id,
      formula_version,
      output_label,
      output_unit,
      output_quantity,
      status,
      linked_by,
      linked_at,
      last_synced_at,
      stale_at,
      updated_at
    ) VALUES (
      v_assembly.estimate_id,
      v_assembly.id,
      v_output.output_key,
      v_line.id,
      v_assembly.formula_version,
      v_output.label,
      v_output.unit,
      v_output.quantity,
      'current',
      v_user_id,
      now(),
      now(),
      NULL,
      now()
    )
    RETURNING * INTO v_link;
  ELSE
    v_action := 'synced';
    UPDATE public.estimate_takeoff_assembly_output_links
    SET formula_version = v_assembly.formula_version,
        output_label = v_output.label,
        output_unit = v_output.unit,
        output_quantity = v_output.quantity,
        status = 'current',
        linked_by = v_user_id,
        last_synced_at = now(),
        stale_at = NULL,
        updated_at = now()
    WHERE id = v_existing_link.id
    RETURNING * INTO v_link;
  END IF;

  INSERT INTO public.estimate_takeoff_assembly_output_link_events (
    link_id,
    estimate_id,
    assembly_id,
    output_key,
    estimate_line_item_id,
    action,
    actor_id,
    formula_version,
    output_label,
    output_unit,
    output_quantity
  ) VALUES (
    v_link.id,
    v_link.estimate_id,
    v_link.assembly_id,
    v_link.output_key,
    v_link.estimate_line_item_id,
    v_action,
    v_user_id,
    v_link.formula_version,
    v_link.output_label,
    v_link.output_unit,
    v_link.output_quantity
  );

  RETURN QUERY SELECT v_link.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.unlink_estimate_takeoff_assembly_output(
  p_assembly_id uuid,
  p_output_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_link public.estimate_takeoff_assembly_output_links%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link
  FROM public.estimate_takeoff_assembly_output_links
  WHERE assembly_id = p_assembly_id
    AND output_key = trim(p_output_key)
  FOR UPDATE;
  IF v_link.id IS NULL OR NOT public.can_manage_estimate(v_link.estimate_id) THEN
    RAISE EXCEPTION 'Assembly output link access is required.' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.estimate_takeoff_assembly_output_link_events (
    link_id,
    estimate_id,
    assembly_id,
    output_key,
    estimate_line_item_id,
    action,
    actor_id,
    formula_version,
    output_label,
    output_unit,
    output_quantity
  ) VALUES (
    v_link.id,
    v_link.estimate_id,
    v_link.assembly_id,
    v_link.output_key,
    v_link.estimate_line_item_id,
    'unlinked',
    v_user_id,
    v_link.formula_version,
    v_link.output_label,
    v_link.output_unit,
    v_link.output_quantity
  );

  DELETE FROM public.estimate_takeoff_assembly_output_links WHERE id = v_link.id;

  UPDATE public.estimate_line_items
  SET quantity_source = CASE
        WHEN quantity_source = 'assembly' THEN 'manual'
        ELSE quantity_source
      END,
      assembly_output_quantity = NULL,
      assembly_output_synced_at = NULL,
      updated_at = now()
  WHERE id = v_link.estimate_line_item_id;

  RETURN v_link.estimate_line_item_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.tg_stale_assembly_output_links_from_assembly()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
    OR NEW.formula_version IS DISTINCT FROM OLD.formula_version
    OR NEW.derived_outputs IS DISTINCT FROM OLD.derived_outputs
    OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at THEN
    WITH changed AS (
      UPDATE public.estimate_takeoff_assembly_output_links
      SET status = 'stale',
          stale_at = now(),
          updated_at = now()
      WHERE assembly_id = NEW.id
        AND status = 'current'
        AND (
          NEW.status <> 'confirmed'
          OR formula_version IS DISTINCT FROM NEW.formula_version
          OR NOT EXISTS (
            SELECT 1
            FROM jsonb_array_elements(NEW.derived_outputs) AS output(value)
            WHERE output.value ->> 'key' = estimate_takeoff_assembly_output_links.output_key
              AND output.value ->> 'label' = estimate_takeoff_assembly_output_links.output_label
              AND output.value ->> 'unit' = estimate_takeoff_assembly_output_links.output_unit
              AND (output.value ->> 'quantity')::numeric
                = estimate_takeoff_assembly_output_links.output_quantity
          )
        )
      RETURNING *
    )
    INSERT INTO public.estimate_takeoff_assembly_output_link_events (
      link_id,
      estimate_id,
      assembly_id,
      output_key,
      estimate_line_item_id,
      action,
      actor_id,
      formula_version,
      output_label,
      output_unit,
      output_quantity
    )
    SELECT
      changed.id,
      changed.estimate_id,
      changed.assembly_id,
      changed.output_key,
      changed.estimate_line_item_id,
      'stale',
      (SELECT auth.uid()),
      changed.formula_version,
      changed.output_label,
      changed.output_unit,
      changed.output_quantity
    FROM changed;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimate_takeoff_assembly_output_links_stale
  ON public.estimate_takeoff_assemblies;
CREATE TRIGGER estimate_takeoff_assembly_output_links_stale
  AFTER UPDATE OF status, formula_version, derived_outputs, confirmed_at
  ON public.estimate_takeoff_assemblies
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stale_assembly_output_links_from_assembly();

CREATE OR REPLACE FUNCTION public.tg_stale_assembly_output_links_from_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.quantity_source = 'assembly'
    AND (
      NEW.quantity_source <> 'assembly'
      OR NEW.quantity IS DISTINCT FROM OLD.assembly_output_quantity
      OR NEW.unit IS DISTINCT FROM OLD.unit
    ) THEN
    WITH changed AS (
      UPDATE public.estimate_takeoff_assembly_output_links
      SET status = 'stale',
          stale_at = now(),
          updated_at = now()
      WHERE estimate_line_item_id = NEW.id
        AND status = 'current'
      RETURNING *
    )
    INSERT INTO public.estimate_takeoff_assembly_output_link_events (
      link_id,
      estimate_id,
      assembly_id,
      output_key,
      estimate_line_item_id,
      action,
      actor_id,
      formula_version,
      output_label,
      output_unit,
      output_quantity
    )
    SELECT
      changed.id,
      changed.estimate_id,
      changed.assembly_id,
      changed.output_key,
      changed.estimate_line_item_id,
      'stale',
      (SELECT auth.uid()),
      changed.formula_version,
      changed.output_label,
      changed.output_unit,
      changed.output_quantity
    FROM changed;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS estimate_takeoff_assembly_output_line_stale
  ON public.estimate_line_items;
CREATE TRIGGER estimate_takeoff_assembly_output_line_stale
  AFTER UPDATE OF quantity, quantity_source, unit
  ON public.estimate_line_items
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_stale_assembly_output_links_from_line();

REVOKE ALL ON FUNCTION public.normalize_assembly_output_unit(text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handoff_estimate_takeoff_assembly_output(
  uuid, text, text, uuid, uuid, text
) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unlink_estimate_takeoff_assembly_output(uuid, text)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tg_stale_assembly_output_links_from_assembly()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tg_stale_assembly_output_links_from_line()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.handoff_estimate_takeoff_assembly_output(
  uuid, text, text, uuid, uuid, text
) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unlink_estimate_takeoff_assembly_output(uuid, text)
  TO authenticated, service_role;

COMMENT ON TABLE public.estimate_takeoff_assembly_output_links IS
  'Current estimator-approved mapping from one confirmed deterministic assembly output to one estimate row.';
COMMENT ON TABLE public.estimate_takeoff_assembly_output_link_events IS
  'Append-only audit trail for assembly-output estimate handoff, resync, stale, and unlink decisions.';
COMMENT ON COLUMN public.estimate_line_items.assembly_output_quantity IS
  'Last confirmed deterministic assembly output written to this estimate row.';

NOTIFY pgrst, 'reload schema';
