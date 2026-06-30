-- Billing and WIP foundation.
-- Adds line-level pay applications, cost actuals, CO allocations, and explicit
-- RLS/grants for Supabase Data API compatibility.

ALTER TABLE public.cost_buckets
  ADD COLUMN IF NOT EXISTS retainage_pct numeric(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS billing_method text NOT NULL DEFAULT 'percent',
  ADD COLUMN IF NOT EXISTS contract_quantity numeric(14,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS earned_percent_complete numeric(5,2) NOT NULL DEFAULT 0;

UPDATE public.cost_buckets cb
SET earned_percent_complete = COALESCE(p.percent_complete, 0)
FROM public.projects p
WHERE p.id = cb.project_id
  AND cb.earned_percent_complete = 0;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_buckets_retainage_pct_check'
  ) THEN
    ALTER TABLE public.cost_buckets
      ADD CONSTRAINT cost_buckets_retainage_pct_check
      CHECK (retainage_pct >= 0 AND retainage_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_buckets_billing_method_check'
  ) THEN
    ALTER TABLE public.cost_buckets
      ADD CONSTRAINT cost_buckets_billing_method_check
      CHECK (billing_method IN ('percent', 'unit', 'material'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cost_buckets_earned_percent_complete_check'
  ) THEN
    ALTER TABLE public.cost_buckets
      ADD CONSTRAINT cost_buckets_earned_percent_complete_check
      CHECK (earned_percent_complete >= 0 AND earned_percent_complete <= 100);
  END IF;
END $$;

ALTER TABLE public.billing_applications
  ADD COLUMN IF NOT EXISTS has_line_detail boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS total_retainage_held numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS retainage_released_this_period numeric NOT NULL DEFAULT 0;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS default_retainage_pct numeric(5,2) NOT NULL DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS billing_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_contact_email text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS billing_frequency text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS next_billing_date date;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_default_retainage_pct_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_default_retainage_pct_check
      CHECK (default_retainage_pct >= 0 AND default_retainage_pct <= 100);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'projects_billing_frequency_check'
  ) THEN
    ALTER TABLE public.projects
      ADD CONSTRAINT projects_billing_frequency_check
      CHECK (billing_frequency IN ('monthly', 'biweekly', 'milestone'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.change_order_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  change_order_id uuid NOT NULL REFERENCES public.change_orders(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  contract_amount numeric NOT NULL DEFAULT 0,
  cost_amount numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT change_order_allocations_amounts_check
    CHECK (contract_amount >= 0 AND cost_amount >= 0)
);

CREATE INDEX IF NOT EXISTS change_order_allocations_project_idx
  ON public.change_order_allocations(project_id, cost_bucket_id);
CREATE INDEX IF NOT EXISTS change_order_allocations_change_order_idx
  ON public.change_order_allocations(change_order_id);

DROP TRIGGER IF EXISTS change_order_allocations_set_updated_at
  ON public.change_order_allocations;
CREATE TRIGGER change_order_allocations_set_updated_at
  BEFORE UPDATE ON public.change_order_allocations
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.billing_line_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  billing_application_id uuid NOT NULL REFERENCES public.billing_applications(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL,
  billing_method text NOT NULL DEFAULT 'percent',
  scheduled_value_cents bigint NOT NULL DEFAULT 0,
  change_order_value_cents bigint NOT NULL DEFAULT 0,
  work_completed_previous_cents bigint NOT NULL DEFAULT 0,
  materials_stored_previous_cents bigint NOT NULL DEFAULT 0,
  work_completed_this_period_cents bigint NOT NULL DEFAULT 0,
  materials_stored_this_period_cents bigint NOT NULL DEFAULT 0,
  work_completed_to_date_cents bigint GENERATED ALWAYS AS (
    work_completed_previous_cents + work_completed_this_period_cents
  ) STORED,
  materials_stored_to_date_cents bigint GENERATED ALWAYS AS (
    materials_stored_previous_cents + materials_stored_this_period_cents
  ) STORED,
  total_completed_and_stored_cents bigint GENERATED ALWAYS AS (
    work_completed_previous_cents + work_completed_this_period_cents +
    materials_stored_previous_cents + materials_stored_this_period_cents
  ) STORED,
  billing_percent_complete numeric(7,2) GENERATED ALWAYS AS (
    CASE WHEN (scheduled_value_cents + change_order_value_cents) > 0 THEN
      round(
        (
          (work_completed_previous_cents + work_completed_this_period_cents +
           materials_stored_previous_cents + materials_stored_this_period_cents)::numeric /
          (scheduled_value_cents + change_order_value_cents)::numeric
        ) * 100,
        2
      )
    ELSE 0 END
  ) STORED,
  balance_to_finish_cents bigint GENERATED ALWAYS AS (
    (scheduled_value_cents + change_order_value_cents) -
    (work_completed_previous_cents + work_completed_this_period_cents +
     materials_stored_previous_cents + materials_stored_this_period_cents)
  ) STORED,
  retainage_pct numeric(5,2) NOT NULL DEFAULT 10.00,
  retainage_held_cents bigint GENERATED ALWAYS AS (
    round(
      (
        work_completed_previous_cents + work_completed_this_period_cents +
        materials_stored_previous_cents + materials_stored_this_period_cents
      )::numeric * retainage_pct / 100
    )::bigint
  ) STORED,
  retainage_released_cents bigint NOT NULL DEFAULT 0,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_line_items_billing_method_check
    CHECK (billing_method IN ('percent', 'unit', 'material')),
  CONSTRAINT billing_line_items_nonnegative_check CHECK (
    scheduled_value_cents >= 0 AND
    change_order_value_cents >= 0 AND
    work_completed_previous_cents >= 0 AND
    materials_stored_previous_cents >= 0 AND
    work_completed_this_period_cents >= 0 AND
    materials_stored_this_period_cents >= 0 AND
    retainage_released_cents >= 0 AND
    retainage_pct >= 0 AND retainage_pct <= 100
  ),
  CONSTRAINT billing_line_items_release_check CHECK (
    retainage_released_cents <= round(
      (
        work_completed_previous_cents + work_completed_this_period_cents +
        materials_stored_previous_cents + materials_stored_this_period_cents
      )::numeric * retainage_pct / 100
    )::bigint
  )
);

CREATE INDEX IF NOT EXISTS billing_line_items_app_idx
  ON public.billing_line_items(billing_application_id, sort_order);
CREATE INDEX IF NOT EXISTS billing_line_items_project_idx
  ON public.billing_line_items(project_id, cost_bucket_id);
CREATE UNIQUE INDEX IF NOT EXISTS billing_line_items_app_bucket_unique
  ON public.billing_line_items(billing_application_id, cost_bucket_id)
  WHERE cost_bucket_id IS NOT NULL;

DROP TRIGGER IF EXISTS billing_line_items_set_updated_at ON public.billing_line_items;
CREATE TRIGGER billing_line_items_set_updated_at
  BEFORE UPDATE ON public.billing_line_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.cost_actual_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'manual',
  source_name text NOT NULL DEFAULT '',
  file_hash text NOT NULL DEFAULT '',
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'reviewed',
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_actual_import_batches_status_check
    CHECK (status IN ('draft', 'review', 'reviewed', 'imported', 'failed'))
);

CREATE INDEX IF NOT EXISTS cost_actual_import_batches_project_idx
  ON public.cost_actual_import_batches(project_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.cost_actuals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  import_batch_id uuid REFERENCES public.cost_actual_import_batches(id) ON DELETE SET NULL,
  cost_code text NOT NULL DEFAULT '',
  description text NOT NULL,
  category text NOT NULL DEFAULT 'direct',
  amount numeric NOT NULL DEFAULT 0,
  vendor text NOT NULL DEFAULT '',
  reference_number text NOT NULL DEFAULT '',
  source_row_hash text NOT NULL DEFAULT '',
  source_external_id text NOT NULL DEFAULT '',
  cost_date date NOT NULL,
  status text NOT NULL DEFAULT 'committed',
  notes text NOT NULL DEFAULT '',
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_actuals_status_check CHECK (status IN ('committed', 'paid', 'void')),
  CONSTRAINT cost_actuals_category_check
    CHECK (category IN ('direct', 'labor', 'material', 'equipment', 'subcontract', 'overhead')),
  CONSTRAINT cost_actuals_amount_check CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS cost_actuals_project_idx
  ON public.cost_actuals(project_id, cost_bucket_id, cost_date DESC);
CREATE INDEX IF NOT EXISTS cost_actuals_status_idx
  ON public.cost_actuals(project_id, status, cost_date DESC);
CREATE INDEX IF NOT EXISTS cost_actuals_unmatched_idx
  ON public.cost_actuals(project_id, cost_date DESC)
  WHERE cost_bucket_id IS NULL AND status <> 'void';
CREATE UNIQUE INDEX IF NOT EXISTS cost_actuals_project_source_unique
  ON public.cost_actuals(project_id, source_external_id)
  WHERE source_external_id <> '';
CREATE UNIQUE INDEX IF NOT EXISTS cost_actuals_project_source_hash_unique
  ON public.cost_actuals(project_id, source_row_hash)
  WHERE source_row_hash <> '';

DROP TRIGGER IF EXISTS cost_actuals_set_updated_at ON public.cost_actuals;
CREATE TRIGGER cost_actuals_set_updated_at
  BEFORE UPDATE ON public.cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.cost_actual_rollup_amount(p_status text, p_amount numeric)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_status = 'void' THEN 0 ELSE COALESCE(p_amount, 0) END;
$$;

CREATE OR REPLACE FUNCTION public.tg_apply_cost_actual_to_bucket()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  old_amount numeric;
  new_amount numeric;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.cost_bucket_id IS NOT NULL THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date + public.cost_actual_rollup_amount(NEW.status, NEW.amount)
      WHERE id = NEW.cost_bucket_id;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    old_amount := public.cost_actual_rollup_amount(OLD.status, OLD.amount);
    new_amount := public.cost_actual_rollup_amount(NEW.status, NEW.amount);

    IF OLD.cost_bucket_id IS NOT NULL AND OLD.cost_bucket_id IS DISTINCT FROM NEW.cost_bucket_id THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date - old_amount
      WHERE id = OLD.cost_bucket_id;
    END IF;

    IF NEW.cost_bucket_id IS NOT NULL THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date +
        CASE WHEN OLD.cost_bucket_id IS DISTINCT FROM NEW.cost_bucket_id
          THEN new_amount
          ELSE new_amount - old_amount
        END
      WHERE id = NEW.cost_bucket_id;
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.cost_bucket_id IS NOT NULL THEN
      UPDATE public.cost_buckets
      SET actual_to_date = actual_to_date - public.cost_actual_rollup_amount(OLD.status, OLD.amount)
      WHERE id = OLD.cost_bucket_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS cost_actuals_apply_to_bucket ON public.cost_actuals;
CREATE TRIGGER cost_actuals_apply_to_bucket
  AFTER INSERT OR UPDATE OR DELETE ON public.cost_actuals
  FOR EACH ROW EXECUTE FUNCTION public.tg_apply_cost_actual_to_bucket();

CREATE OR REPLACE FUNCTION public.sync_billing_application_from_lines(p_billing_application_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_amount numeric;
  v_current_retainage numeric;
  v_total_retainage_held numeric;
  v_retainage_released numeric;
BEGIN
  SELECT project_id INTO v_project_id
  FROM public.billing_applications
  WHERE id = p_billing_application_id;

  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'Billing application % was not found', p_billing_application_id;
  END IF;

  SELECT
    COALESCE(SUM((work_completed_this_period_cents + materials_stored_this_period_cents)::numeric / 100), 0),
    COALESCE(SUM(round(
      (work_completed_this_period_cents + materials_stored_this_period_cents)::numeric *
      retainage_pct / 100
    ) / 100), 0),
    COALESCE(SUM((retainage_held_cents - retainage_released_cents)::numeric / 100), 0),
    COALESCE(SUM(retainage_released_cents::numeric / 100), 0)
  INTO v_amount, v_current_retainage, v_total_retainage_held, v_retainage_released
  FROM public.billing_line_items
  WHERE billing_application_id = p_billing_application_id
    AND project_id = v_project_id;

  UPDATE public.billing_applications
  SET amount_billed = v_amount,
      retainage = v_current_retainage,
      total_retainage_held = v_total_retainage_held,
      retainage_released_this_period = v_retainage_released,
      has_line_detail = true
  WHERE id = p_billing_application_id;
END;
$$;

REVOKE ALL ON FUNCTION public.cost_actual_rollup_amount(text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tg_apply_cost_actual_to_bucket() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_billing_application_from_lines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_billing_application_from_lines(uuid) TO authenticated, service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.change_order_allocations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.billing_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_actual_import_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cost_actuals TO authenticated;
GRANT ALL ON public.change_order_allocations TO service_role;
GRANT ALL ON public.billing_line_items TO service_role;
GRANT ALL ON public.cost_actual_import_batches TO service_role;
GRANT ALL ON public.cost_actuals TO service_role;

ALTER TABLE public.change_order_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_actual_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cost_actuals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS change_order_allocations_team_select ON public.change_order_allocations;
CREATE POLICY change_order_allocations_team_select ON public.change_order_allocations
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS change_order_allocations_team_insert ON public.change_order_allocations;
CREATE POLICY change_order_allocations_team_insert ON public.change_order_allocations
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS change_order_allocations_team_update ON public.change_order_allocations;
CREATE POLICY change_order_allocations_team_update ON public.change_order_allocations
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS change_order_allocations_team_delete ON public.change_order_allocations;
CREATE POLICY change_order_allocations_team_delete ON public.change_order_allocations
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS billing_line_items_team_select ON public.billing_line_items;
CREATE POLICY billing_line_items_team_select ON public.billing_line_items
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS billing_line_items_team_insert ON public.billing_line_items;
CREATE POLICY billing_line_items_team_insert ON public.billing_line_items
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS billing_line_items_team_update ON public.billing_line_items;
CREATE POLICY billing_line_items_team_update ON public.billing_line_items
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS billing_line_items_team_delete ON public.billing_line_items;
CREATE POLICY billing_line_items_team_delete ON public.billing_line_items
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
DROP POLICY IF EXISTS billing_line_items_client_select ON public.billing_line_items;
CREATE POLICY billing_line_items_client_select ON public.billing_line_items
  FOR SELECT TO authenticated USING (public.can_view_client_billing(project_id));

DROP POLICY IF EXISTS cost_actual_import_batches_team_select ON public.cost_actual_import_batches;
CREATE POLICY cost_actual_import_batches_team_select ON public.cost_actual_import_batches
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS cost_actual_import_batches_team_insert ON public.cost_actual_import_batches;
CREATE POLICY cost_actual_import_batches_team_insert ON public.cost_actual_import_batches
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_actual_import_batches_team_update ON public.cost_actual_import_batches;
CREATE POLICY cost_actual_import_batches_team_update ON public.cost_actual_import_batches
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_actual_import_batches_team_delete ON public.cost_actual_import_batches;
CREATE POLICY cost_actual_import_batches_team_delete ON public.cost_actual_import_batches
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));

DROP POLICY IF EXISTS cost_actuals_team_select ON public.cost_actuals;
CREATE POLICY cost_actuals_team_select ON public.cost_actuals
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS cost_actuals_team_insert ON public.cost_actuals;
CREATE POLICY cost_actuals_team_insert ON public.cost_actuals
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_actuals_team_update ON public.cost_actuals;
CREATE POLICY cost_actuals_team_update ON public.cost_actuals
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS cost_actuals_team_delete ON public.cost_actuals;
CREATE POLICY cost_actuals_team_delete ON public.cost_actuals
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
