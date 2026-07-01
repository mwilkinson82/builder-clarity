CREATE OR REPLACE FUNCTION public.storage_estimate_id(p_name text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE v_first text;
BEGIN
  v_first := split_part(coalesce(p_name, ''), '/', 1);
  IF v_first ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN v_first::uuid;
  END IF;
  RETURN NULL;
END; $$;

REVOKE ALL ON FUNCTION public.storage_estimate_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_estimate_id(text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.estimate_plan_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  source_file_name text NOT NULL DEFAULT '',
  file_path text NOT NULL DEFAULT '',
  file_mime_type text NOT NULL DEFAULT '',
  file_size_bytes bigint NOT NULL DEFAULT 0 CHECK (file_size_bytes >= 0),
  page_count integer NOT NULL DEFAULT 1 CHECK (page_count >= 1),
  sample_key text NOT NULL DEFAULT '',
  status varchar(24) NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'superseded', 'archive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_plan_sets_name_not_blank CHECK (length(trim(name)) > 0)
);
CREATE INDEX IF NOT EXISTS estimate_plan_sets_estimate_idx ON public.estimate_plan_sets(estimate_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS estimate_plan_sets_org_idx ON public.estimate_plan_sets(organization_id, updated_at DESC);
DROP TRIGGER IF EXISTS estimate_plan_sets_set_updated_at ON public.estimate_plan_sets;
CREATE TRIGGER estimate_plan_sets_set_updated_at BEFORE UPDATE ON public.estimate_plan_sets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.estimate_plan_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_set_id uuid NOT NULL REFERENCES public.estimate_plan_sets(id) ON DELETE CASCADE,
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  sheet_number text NOT NULL DEFAULT '',
  sheet_name text NOT NULL DEFAULT '',
  discipline text NOT NULL DEFAULT '',
  page_number integer NOT NULL DEFAULT 1 CHECK (page_number >= 1),
  sort_order integer NOT NULL DEFAULT 1,
  scale_label text NOT NULL DEFAULT '',
  scale_feet_per_pixel numeric(18,8) NOT NULL DEFAULT 0 CHECK (scale_feet_per_pixel >= 0),
  width_px integer NOT NULL DEFAULT 0 CHECK (width_px >= 0),
  height_px integer NOT NULL DEFAULT 0 CHECK (height_px >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_plan_sheets_name_or_number CHECK (length(trim(sheet_number)) > 0 OR length(trim(sheet_name)) > 0)
);
CREATE INDEX IF NOT EXISTS estimate_plan_sheets_set_idx ON public.estimate_plan_sheets(plan_set_id, sort_order);
CREATE INDEX IF NOT EXISTS estimate_plan_sheets_estimate_idx ON public.estimate_plan_sheets(estimate_id, sort_order);
DROP TRIGGER IF EXISTS estimate_plan_sheets_set_updated_at ON public.estimate_plan_sheets;
CREATE TRIGGER estimate_plan_sheets_set_updated_at BEFORE UPDATE ON public.estimate_plan_sheets FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE IF NOT EXISTS public.estimate_takeoff_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  estimate_id uuid NOT NULL REFERENCES public.estimates(id) ON DELETE CASCADE,
  plan_sheet_id uuid NOT NULL REFERENCES public.estimate_plan_sheets(id) ON DELETE CASCADE,
  estimate_line_item_id uuid REFERENCES public.estimate_line_items(id) ON DELETE SET NULL,
  library_item_id uuid REFERENCES public.cost_library_items(id) ON DELETE SET NULL,
  created_by uuid DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  tool_type varchar(16) NOT NULL CHECK (tool_type IN ('linear', 'area', 'count')),
  label text NOT NULL,
  unit varchar(16) NOT NULL,
  quantity numeric(14,4) NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  waste_pct integer NOT NULL DEFAULT 0 CHECK (waste_pct >= 0),
  color text NOT NULL DEFAULT '#1b7a6e',
  geometry jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT estimate_takeoff_label_not_blank CHECK (length(trim(label)) > 0),
  CONSTRAINT estimate_takeoff_unit_not_blank CHECK (length(trim(unit)) > 0)
);
CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_estimate_idx ON public.estimate_takeoff_measurements(estimate_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_sheet_idx ON public.estimate_takeoff_measurements(plan_sheet_id, created_at);
CREATE INDEX IF NOT EXISTS estimate_takeoff_measurements_line_idx ON public.estimate_takeoff_measurements(estimate_line_item_id) WHERE estimate_line_item_id IS NOT NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_plan_sets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_plan_sheets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estimate_takeoff_measurements TO authenticated;
GRANT ALL ON public.estimate_plan_sets TO service_role;
GRANT ALL ON public.estimate_plan_sheets TO service_role;
GRANT ALL ON public.estimate_takeoff_measurements TO service_role;

ALTER TABLE public.estimate_plan_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_plan_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.estimate_takeoff_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS estimate_plan_sets_org_select ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_select ON public.estimate_plan_sets FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS estimate_plan_sets_org_insert ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_insert ON public.estimate_plan_sets FOR INSERT TO authenticated WITH CHECK (
  public.is_org_member(organization_id) AND created_by = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_plan_sets.estimate_id AND e.organization_id = estimate_plan_sets.organization_id)
);
DROP POLICY IF EXISTS estimate_plan_sets_org_update ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_update ON public.estimate_plan_sets FOR UPDATE TO authenticated USING (public.is_org_member(organization_id)) WITH CHECK (public.is_org_member(organization_id));
DROP POLICY IF EXISTS estimate_plan_sets_org_delete ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_delete ON public.estimate_plan_sets FOR DELETE TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS estimate_plan_sheets_org_select ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_select ON public.estimate_plan_sheets FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.estimate_plan_sets ps WHERE ps.id = estimate_plan_sheets.plan_set_id AND public.is_org_member(ps.organization_id))
);
DROP POLICY IF EXISTS estimate_plan_sheets_org_insert ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_insert ON public.estimate_plan_sheets FOR INSERT TO authenticated WITH CHECK (
  EXISTS (SELECT 1 FROM public.estimate_plan_sets ps WHERE ps.id = estimate_plan_sheets.plan_set_id AND ps.estimate_id = estimate_plan_sheets.estimate_id AND public.is_org_member(ps.organization_id))
);
DROP POLICY IF EXISTS estimate_plan_sheets_org_update ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_update ON public.estimate_plan_sheets FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimate_plan_sets ps WHERE ps.id = estimate_plan_sheets.plan_set_id AND public.is_org_member(ps.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimate_plan_sets ps WHERE ps.id = estimate_plan_sheets.plan_set_id AND ps.estimate_id = estimate_plan_sheets.estimate_id AND public.is_org_member(ps.organization_id)));
DROP POLICY IF EXISTS estimate_plan_sheets_org_delete ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_delete ON public.estimate_plan_sheets FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.estimate_plan_sets ps WHERE ps.id = estimate_plan_sheets.plan_set_id AND public.is_org_member(ps.organization_id))
);

DROP POLICY IF EXISTS estimate_takeoff_measurements_org_select ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_select ON public.estimate_takeoff_measurements FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_takeoff_measurements.estimate_id AND public.is_org_member(e.organization_id))
);
DROP POLICY IF EXISTS estimate_takeoff_measurements_org_insert ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_insert ON public.estimate_takeoff_measurements FOR INSERT TO authenticated WITH CHECK (
  created_by = (SELECT auth.uid())
  AND EXISTS (SELECT 1 FROM public.estimate_plan_sheets ps JOIN public.estimates e ON e.id = ps.estimate_id WHERE ps.id = estimate_takeoff_measurements.plan_sheet_id AND ps.estimate_id = estimate_takeoff_measurements.estimate_id AND public.is_org_member(e.organization_id))
);
DROP POLICY IF EXISTS estimate_takeoff_measurements_org_update ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_update ON public.estimate_takeoff_measurements FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_takeoff_measurements.estimate_id AND public.is_org_member(e.organization_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.estimate_plan_sheets ps JOIN public.estimates e ON e.id = ps.estimate_id WHERE ps.id = estimate_takeoff_measurements.plan_sheet_id AND ps.estimate_id = estimate_takeoff_measurements.estimate_id AND public.is_org_member(e.organization_id)));
DROP POLICY IF EXISTS estimate_takeoff_measurements_org_delete ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_delete ON public.estimate_takeoff_measurements FOR DELETE TO authenticated USING (
  EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = estimate_takeoff_measurements.estimate_id AND public.is_org_member(e.organization_id))
);

DROP POLICY IF EXISTS plan_room_storage_team_read ON storage.objects;
CREATE POLICY plan_room_storage_team_read ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'plan-room' AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = public.storage_estimate_id(name) AND public.is_org_member(e.organization_id))
);
DROP POLICY IF EXISTS plan_room_storage_team_insert ON storage.objects;
CREATE POLICY plan_room_storage_team_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'plan-room' AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = public.storage_estimate_id(name) AND public.is_org_member(e.organization_id))
);
DROP POLICY IF EXISTS plan_room_storage_team_update ON storage.objects;
CREATE POLICY plan_room_storage_team_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plan-room' AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = public.storage_estimate_id(name) AND public.is_org_member(e.organization_id)))
  WITH CHECK (bucket_id = 'plan-room' AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = public.storage_estimate_id(name) AND public.is_org_member(e.organization_id)));
DROP POLICY IF EXISTS plan_room_storage_team_delete ON storage.objects;
CREATE POLICY plan_room_storage_team_delete ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'plan-room' AND EXISTS (SELECT 1 FROM public.estimates e WHERE e.id = public.storage_estimate_id(name) AND public.is_org_member(e.organization_id))
);

NOTIFY pgrst, 'reload schema';