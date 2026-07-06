-- Workspace B — Daily WIP entries (BILLINGDESIGN P2). What the company expended
-- and earned on a job on a given day: self-perform crew (crew × hours × blended
-- rate), materials, and equipment, booked against a cost code (the SOV/budget
-- spine). Production quantity is captured so a production rate falls out as a
-- byproduct. One row = one activity's work-in-place for one day.
--
-- The dependency rule (see docs/BILLINGDESIGN.md): WIP FEEDS billing; billing
-- NEVER waits on WIP. This table is additive — nothing in the billing path
-- reads it as a precondition.
--
-- Subcontractor progress vs lump-sum commitments is a later slice (it rides the
-- procurement/buyout commitments object, which does not exist yet).
--
-- Mirrors public.exposure_allocations for RLS, grants, and the updated_at
-- trigger.

CREATE TABLE IF NOT EXISTS public.daily_wip_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  -- The cost code / SOV line this work-in-place lands on. Nullable so a PM can
  -- log a day before the work is coded.
  cost_bucket_id uuid REFERENCES public.cost_buckets(id) ON DELETE SET NULL,
  entry_date date NOT NULL,
  -- Free-text activity label when no cost bucket is chosen (or a note on top of
  -- the coded activity).
  activity text NOT NULL DEFAULT '',
  -- Self-perform labor: headcount, hours, and a blended $/hr. Labor cost is
  -- crew_count × hours × labor_rate (derived in app code, not stored, so it can
  -- never drift from its inputs).
  crew_count numeric NOT NULL DEFAULT 0,
  hours numeric NOT NULL DEFAULT 0,
  labor_rate numeric NOT NULL DEFAULT 0,
  material_cost numeric NOT NULL DEFAULT 0,
  equipment_cost numeric NOT NULL DEFAULT 0,
  -- Production placed this day (for the production rate byproduct).
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_wip_crew_check CHECK (crew_count >= 0),
  CONSTRAINT daily_wip_hours_check CHECK (hours >= 0),
  CONSTRAINT daily_wip_rate_check CHECK (labor_rate >= 0),
  CONSTRAINT daily_wip_material_check CHECK (material_cost >= 0),
  CONSTRAINT daily_wip_equipment_check CHECK (equipment_cost >= 0)
);

CREATE INDEX IF NOT EXISTS daily_wip_entries_project_date_idx
  ON public.daily_wip_entries(project_id, entry_date);
CREATE INDEX IF NOT EXISTS daily_wip_entries_bucket_idx
  ON public.daily_wip_entries(cost_bucket_id);

DROP TRIGGER IF EXISTS daily_wip_entries_set_updated_at
  ON public.daily_wip_entries;
CREATE TRIGGER daily_wip_entries_set_updated_at
  BEFORE UPDATE ON public.daily_wip_entries
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_wip_entries TO authenticated;
GRANT ALL ON public.daily_wip_entries TO service_role;

ALTER TABLE public.daily_wip_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_wip_entries_team_select ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_select ON public.daily_wip_entries
  FOR SELECT TO authenticated USING (public.can_read_project(project_id));
DROP POLICY IF EXISTS daily_wip_entries_team_insert ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_insert ON public.daily_wip_entries
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS daily_wip_entries_team_update ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_update ON public.daily_wip_entries
  FOR UPDATE TO authenticated USING (public.can_manage_project(project_id))
  WITH CHECK (public.can_manage_project(project_id));
DROP POLICY IF EXISTS daily_wip_entries_team_delete ON public.daily_wip_entries;
CREATE POLICY daily_wip_entries_team_delete ON public.daily_wip_entries
  FOR DELETE TO authenticated USING (public.can_manage_project(project_id));
