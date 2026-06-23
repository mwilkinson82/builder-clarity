CREATE OR REPLACE FUNCTION public.can_view_client_change_orders(p_project_id uuid)
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
        AND a.can_view_change_orders = true
        AND (
          a.client_user_id = auth.uid()
          OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_view_client_daily_reports(p_project_id uuid)
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
        AND a.can_view_daily_reports = true
        AND (
          a.client_user_id = auth.uid()
          OR lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_approve_client_change_order(p_change_order_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.change_orders co
      WHERE co.id = p_change_order_id
        AND co.client_visible = true
        AND public.can_view_client_change_orders(co.project_id)
    );
$$;

REVOKE ALL ON FUNCTION public.can_view_client_change_orders(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_client_daily_reports(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_view_client_change_orders(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_client_daily_reports(uuid) TO authenticated;

DROP POLICY IF EXISTS change_order_approvals_project_read ON public.change_order_approvals;
CREATE POLICY change_order_approvals_project_read ON public.change_order_approvals
  FOR SELECT TO authenticated
  USING (public.can_read_project(project_id) OR public.can_view_client_change_orders(project_id));

DROP POLICY IF EXISTS change_orders_client_select ON public.change_orders;
CREATE POLICY change_orders_client_select ON public.change_orders
  FOR SELECT TO authenticated
  USING (client_visible = true AND public.can_view_client_change_orders(project_id));

DROP POLICY IF EXISTS daily_reports_client_select ON public.daily_reports;
CREATE POLICY daily_reports_client_select ON public.daily_reports
  FOR SELECT TO authenticated
  USING (client_visible = true AND public.can_view_client_daily_reports(project_id));

DROP POLICY IF EXISTS daily_reports_storage_client_read ON storage.objects;
CREATE POLICY daily_reports_storage_client_read ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'daily-reports'
    AND EXISTS (
      SELECT 1
      FROM public.daily_reports dr
      WHERE dr.project_id = public.storage_project_id(name)
        AND dr.client_visible = true
        AND public.can_view_client_daily_reports(dr.project_id)
    )
  );
