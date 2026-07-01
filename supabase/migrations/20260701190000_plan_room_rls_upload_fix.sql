-- Make Plan Room uploads use estimate-level access instead of a brittle storage-only check.
-- The first Plan Room release could read/seed sheets, but browser storage uploads could still
-- fail RLS when the storage object path or estimate access route did not match the narrow policy.

CREATE OR REPLACE FUNCTION public.storage_estimate_id(p_name text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_part text;
BEGIN
  FOREACH v_part IN ARRAY regexp_split_to_array(coalesce(p_name, ''), '/')
  LOOP
    IF v_part ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN v_part::uuid;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.storage_estimate_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_estimate_id(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.storage_estimate_id(text) TO service_role;

CREATE OR REPLACE FUNCTION public.can_read_estimate(p_estimate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = p_estimate_id
        AND (
          public.is_org_member(e.organization_id)
          OR public.is_super_admin()
          OR (e.project_id IS NOT NULL AND public.can_read_project(e.project_id))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_estimate(p_estimate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = p_estimate_id
        AND (
          public.is_org_member(e.organization_id)
          OR public.is_super_admin()
          OR public.can_manage_org(e.organization_id)
          OR (e.project_id IS NOT NULL AND public.can_manage_project(e.project_id))
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_estimate(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_estimate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_estimate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_estimate(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_estimate(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_estimate(uuid) TO service_role;

DROP POLICY IF EXISTS estimate_plan_sets_org_select ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_select
  ON public.estimate_plan_sets
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_plan_sets_org_insert ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_insert
  ON public.estimate_plan_sets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_estimate(estimate_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.estimates e
      WHERE e.id = estimate_plan_sets.estimate_id
        AND e.organization_id = estimate_plan_sets.organization_id
    )
  );

DROP POLICY IF EXISTS estimate_plan_sets_org_update ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_update
  ON public.estimate_plan_sets
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (public.can_manage_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_plan_sets_org_delete ON public.estimate_plan_sets;
CREATE POLICY estimate_plan_sets_org_delete
  ON public.estimate_plan_sets
  FOR DELETE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_plan_sheets_org_select ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_select
  ON public.estimate_plan_sheets
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_plan_sheets_org_insert ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_insert
  ON public.estimate_plan_sheets
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_estimate(estimate_id)
    AND EXISTS (
      SELECT 1
      FROM public.estimate_plan_sets ps
      WHERE ps.id = estimate_plan_sheets.plan_set_id
        AND ps.estimate_id = estimate_plan_sheets.estimate_id
    )
  );

DROP POLICY IF EXISTS estimate_plan_sheets_org_update ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_update
  ON public.estimate_plan_sheets
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (
    public.can_manage_estimate(estimate_id)
    AND EXISTS (
      SELECT 1
      FROM public.estimate_plan_sets ps
      WHERE ps.id = estimate_plan_sheets.plan_set_id
        AND ps.estimate_id = estimate_plan_sheets.estimate_id
    )
  );

DROP POLICY IF EXISTS estimate_plan_sheets_org_delete ON public.estimate_plan_sheets;
CREATE POLICY estimate_plan_sheets_org_delete
  ON public.estimate_plan_sheets
  FOR DELETE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_takeoff_measurements_org_select ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_select
  ON public.estimate_takeoff_measurements
  FOR SELECT
  TO authenticated
  USING (public.can_read_estimate(estimate_id));

DROP POLICY IF EXISTS estimate_takeoff_measurements_org_insert ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_insert
  ON public.estimate_takeoff_measurements
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_manage_estimate(estimate_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.estimate_plan_sheets ps
      WHERE ps.id = estimate_takeoff_measurements.plan_sheet_id
        AND ps.estimate_id = estimate_takeoff_measurements.estimate_id
    )
  );

DROP POLICY IF EXISTS estimate_takeoff_measurements_org_update ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_update
  ON public.estimate_takeoff_measurements
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id))
  WITH CHECK (
    public.can_manage_estimate(estimate_id)
    AND EXISTS (
      SELECT 1
      FROM public.estimate_plan_sheets ps
      WHERE ps.id = estimate_takeoff_measurements.plan_sheet_id
        AND ps.estimate_id = estimate_takeoff_measurements.estimate_id
    )
  );

DROP POLICY IF EXISTS estimate_takeoff_measurements_org_delete ON public.estimate_takeoff_measurements;
CREATE POLICY estimate_takeoff_measurements_org_delete
  ON public.estimate_takeoff_measurements
  FOR DELETE
  TO authenticated
  USING (public.can_manage_estimate(estimate_id));

DROP POLICY IF EXISTS plan_room_storage_team_read ON storage.objects;
CREATE POLICY plan_room_storage_team_read
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'plan-room'
    AND public.can_read_estimate(public.storage_estimate_id(name))
  );

DROP POLICY IF EXISTS plan_room_storage_team_insert ON storage.objects;
CREATE POLICY plan_room_storage_team_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'plan-room'
    AND public.can_manage_estimate(public.storage_estimate_id(name))
  );

DROP POLICY IF EXISTS plan_room_storage_team_update ON storage.objects;
CREATE POLICY plan_room_storage_team_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'plan-room'
    AND public.can_manage_estimate(public.storage_estimate_id(name))
  )
  WITH CHECK (
    bucket_id = 'plan-room'
    AND public.can_manage_estimate(public.storage_estimate_id(name))
  );

DROP POLICY IF EXISTS plan_room_storage_team_delete ON storage.objects;
CREATE POLICY plan_room_storage_team_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'plan-room'
    AND public.can_manage_estimate(public.storage_estimate_id(name))
  );

NOTIFY pgrst, 'reload schema';
