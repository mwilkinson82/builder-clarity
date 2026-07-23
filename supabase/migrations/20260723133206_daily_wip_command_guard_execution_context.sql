-- The audited Daily WIP RPCs are SECURITY DEFINER functions owned by postgres.
-- Run the row trigger as the invoking execution context so it can distinguish
-- those commands from raw Data API writes. A SECURITY DEFINER trigger always
-- sees its own owner as current_user, which erases that distinction.
CREATE OR REPLACE FUNCTION public.tg_guard_daily_wip_command_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_project_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.project_id ELSE NEW.project_id END;
  v_is_demo boolean;
BEGIN
  -- save_daily_wip_entry_atomic / void_daily_wip_entry_atomic execute as their
  -- postgres owner after completing auth, project permission, concurrency,
  -- exact-cent, idempotency, and audit checks. Requiring both the definer
  -- execution context and its transaction-local marker prevents a raw role
  -- from self-authorizing by setting the custom GUC.
  IF current_user = 'postgres'
     AND current_setting('overwatch.daily_wip_command_write', true) = 'on' THEN
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

-- Trigger functions are invoked by PostgreSQL, never as public RPCs.
REVOKE ALL ON FUNCTION public.tg_guard_daily_wip_command_write()
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON FUNCTION public.tg_guard_daily_wip_command_write() IS
  'Allows postgres-owned audited Daily WIP commands and the DEMO-HARBOR fixture path while rejecting raw authenticated/service-role writes for real projects.';

-- TRUNCATE bypasses row policies and this row trigger. Daily WIP never needs an
-- unauthenticated table path, and the authenticated/service roles only need the
-- row-level verbs retained for the current DEMO-HARBOR fixture reset.
REVOKE ALL ON TABLE public.daily_wip_entries FROM PUBLIC, anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON TABLE public.daily_wip_entries
  FROM authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.daily_wip_entries
  TO authenticated, service_role;

DO $$
BEGIN
  IF has_table_privilege('anon', 'public.daily_wip_entries', 'SELECT')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'INSERT')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'UPDATE')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'DELETE')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'TRUNCATE')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'REFERENCES')
     OR has_table_privilege('anon', 'public.daily_wip_entries', 'TRIGGER') THEN
    RAISE EXCEPTION 'Anonymous Daily WIP table privileges remain after hardening.';
  END IF;

  IF has_table_privilege('authenticated', 'public.daily_wip_entries', 'TRUNCATE')
     OR has_table_privilege('authenticated', 'public.daily_wip_entries', 'REFERENCES')
     OR has_table_privilege('authenticated', 'public.daily_wip_entries', 'TRIGGER')
     OR has_table_privilege('service_role', 'public.daily_wip_entries', 'TRUNCATE')
     OR has_table_privilege('service_role', 'public.daily_wip_entries', 'REFERENCES')
     OR has_table_privilege('service_role', 'public.daily_wip_entries', 'TRIGGER') THEN
    RAISE EXCEPTION 'Unsafe Daily WIP table privileges remain after hardening.';
  END IF;

  IF NOT (
    has_table_privilege('authenticated', 'public.daily_wip_entries', 'SELECT')
    AND has_table_privilege('authenticated', 'public.daily_wip_entries', 'INSERT')
    AND has_table_privilege('authenticated', 'public.daily_wip_entries', 'UPDATE')
    AND has_table_privilege('authenticated', 'public.daily_wip_entries', 'DELETE')
    AND has_table_privilege('service_role', 'public.daily_wip_entries', 'SELECT')
    AND has_table_privilege('service_role', 'public.daily_wip_entries', 'INSERT')
    AND has_table_privilege('service_role', 'public.daily_wip_entries', 'UPDATE')
    AND has_table_privilege('service_role', 'public.daily_wip_entries', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'Required Daily WIP row-level privileges are missing after hardening.';
  END IF;
END;
$$;
