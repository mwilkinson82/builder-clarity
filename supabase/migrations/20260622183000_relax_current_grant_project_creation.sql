CREATE OR REPLACE FUNCTION public.can_create_project_in_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_org_id IS NOT NULL;
$$;

COMMENT ON FUNCTION public.can_create_project_in_org(uuid) IS
  'Current Contractor Circle grant model: any authenticated Overwatch user can create projects. Reintroduce role or plan gates only when billing is launched.';
