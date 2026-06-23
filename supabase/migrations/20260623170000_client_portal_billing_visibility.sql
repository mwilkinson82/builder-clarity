CREATE OR REPLACE FUNCTION public.can_view_client_billing(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.project_client_access a
      WHERE a.project_id = p_project_id
        AND a.status IN ('pending', 'active')
        AND a.can_view_billing = true
        AND (
          a.client_user_id = auth.uid()
          OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_client_billing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_client_billing(uuid) TO authenticated;

DROP POLICY IF EXISTS billing_applications_client_select ON public.billing_applications;
CREATE POLICY billing_applications_client_select ON public.billing_applications
  FOR SELECT TO authenticated
  USING (public.can_view_client_billing(project_id));
