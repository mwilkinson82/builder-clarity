-- Portfolio visibility needs PMs to see assigned projects while owner/admin/executive
-- users can review the full company rollup.
CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.organization_memberships m
            WHERE m.organization_id = p.organization_id
              AND m.user_id = auth.uid()
              AND m.status = 'active'
              AND m.role IN ('owner', 'admin', 'executive')
          )
          OR EXISTS (
            SELECT 1
            FROM public.project_memberships pm
            WHERE pm.project_id = p.id
              AND pm.user_id = auth.uid()
              AND pm.status = 'active'
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_project(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_project(uuid) TO authenticated;
