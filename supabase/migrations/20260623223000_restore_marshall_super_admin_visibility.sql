-- Restore Marshall's app-wide visibility even if he signs in with a newer Supabase user id.
-- The previous super-admin seed used one fixed user id, which can miss alternate emails or
-- regenerated auth users and make projects look like they disappeared behind RLS.

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.app_super_admins
        WHERE user_id = (SELECT auth.uid())
      )
      OR EXISTS (
        SELECT 1
        FROM auth.users u
        WHERE u.id = (SELECT auth.uid())
          AND lower(u.email) IN (
            'wilkinson.marshall@gmail.com',
            'marshall@marshallwilkinson.com'
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.is_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_super_admin() TO service_role;

INSERT INTO public.app_super_admins (user_id)
SELECT u.id
FROM auth.users u
WHERE lower(u.email) IN (
  'wilkinson.marshall@gmail.com',
  'marshall@marshallwilkinson.com'
)
ON CONFLICT (user_id) DO NOTHING;
