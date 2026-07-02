
-- Super admin role table (separate from any per-org role to avoid privilege escalation)
CREATE TABLE IF NOT EXISTS public.app_super_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_super_admins TO authenticated;
GRANT ALL ON public.app_super_admins TO service_role;

ALTER TABLE public.app_super_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Super admins can read super admin list" ON public.app_super_admins;
CREATE POLICY "Super admins can read super admin list"
  ON public.app_super_admins FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.app_super_admins a WHERE a.user_id = auth.uid()));

-- Helper
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.app_super_admins WHERE user_id = auth.uid()
  );
$$;

-- Grant Marshall super admin (guarded: only inserts if the user exists in this
-- environment, so this migration replays cleanly on fresh databases)
INSERT INTO public.app_super_admins (user_id)
SELECT id FROM auth.users WHERE id = 'f60c77bb-f6fa-4c03-8608-6f79575c11d5'
ON CONFLICT (user_id) DO NOTHING;

-- Expand project access functions to include super admins
CREATE OR REPLACE FUNCTION public.can_read_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND (
      p.owner_id=auth.uid()
      OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive'))
      OR EXISTS (SELECT 1 FROM public.project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=auth.uid() AND pm.status='active')
    ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_project(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_project_id AND (
      p.owner_id=auth.uid()
      OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p.organization_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive','project_manager'))
      OR EXISTS (SELECT 1 FROM public.project_memberships pm WHERE pm.project_id=p.id AND pm.user_id=auth.uid() AND pm.status='active' AND pm.role IN ('owner','manager','editor'))
    ))
  );
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_org_id AND m.user_id=auth.uid() AND m.status='active' AND m.role IN ('owner','admin','executive'))
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (SELECT 1 FROM public.organization_memberships m WHERE m.organization_id=p_org_id AND m.user_id=auth.uid() AND m.status='active')
  );
$$;

-- Allow super admins to see all projects directly through the projects table policy.
-- Add an additive policy so existing policies are untouched.
DROP POLICY IF EXISTS "Super admins can read all projects" ON public.projects;
CREATE POLICY "Super admins can read all projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins can update all projects" ON public.projects;
CREATE POLICY "Super admins can update all projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Allow super admins to see all organizations and memberships
DROP POLICY IF EXISTS "Super admins can read all organizations" ON public.organizations;
CREATE POLICY "Super admins can read all organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admins can read all memberships" ON public.organization_memberships;
CREATE POLICY "Super admins can read all memberships"
  ON public.organization_memberships FOR SELECT
  TO authenticated
  USING (public.is_super_admin());
