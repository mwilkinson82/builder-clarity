DROP POLICY IF EXISTS user_activity_presence_select_company ON public.user_activity_presence;
DROP POLICY IF EXISTS user_activity_presence_select_self_or_super_admin ON public.user_activity_presence;

CREATE POLICY user_activity_presence_select_self_or_super_admin
  ON public.user_activity_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_super_admin()
  );

NOTIFY pgrst, 'reload schema';
