CREATE TABLE IF NOT EXISTS public.user_activity_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_session_id text NOT NULL,
  email text NOT NULL DEFAULT '',
  full_name text NOT NULL DEFAULT '',
  route_path text NOT NULL DEFAULT '/',
  page_title text NOT NULL DEFAULT '',
  user_agent text NOT NULL DEFAULT '',
  login_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_activity_presence_session_unique UNIQUE (
    organization_id,
    user_id,
    client_session_id
  )
);

CREATE INDEX IF NOT EXISTS user_activity_presence_org_last_seen_idx
  ON public.user_activity_presence (organization_id, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS user_activity_presence_user_last_seen_idx
  ON public.user_activity_presence (user_id, last_seen_at DESC);

DROP TRIGGER IF EXISTS user_activity_presence_set_updated_at ON public.user_activity_presence;
CREATE TRIGGER user_activity_presence_set_updated_at
  BEFORE UPDATE ON public.user_activity_presence
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.user_activity_presence ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activity_presence TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_activity_presence TO service_role;

DROP POLICY IF EXISTS user_activity_presence_insert_own ON public.user_activity_presence;
CREATE POLICY user_activity_presence_insert_own
  ON public.user_activity_presence
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.is_org_member(organization_id)
  );

DROP POLICY IF EXISTS user_activity_presence_update_own ON public.user_activity_presence;
CREATE POLICY user_activity_presence_update_own
  ON public.user_activity_presence
  FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND public.is_org_member(organization_id)
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.is_org_member(organization_id)
  );

DROP POLICY IF EXISTS user_activity_presence_select_company ON public.user_activity_presence;
CREATE POLICY user_activity_presence_select_company
  ON public.user_activity_presence
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.can_manage_org(organization_id)
  );

DROP POLICY IF EXISTS user_activity_presence_delete_own ON public.user_activity_presence;
CREATE POLICY user_activity_presence_delete_own
  ON public.user_activity_presence
  FOR DELETE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND public.is_org_member(organization_id)
  );

NOTIFY pgrst, 'reload schema';
