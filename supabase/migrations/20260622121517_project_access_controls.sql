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

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid)
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
              AND pm.role IN ('owner', 'manager', 'editor')
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_project(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_project(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.can_read_project(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_project(uuid) TO authenticated;
