-- Notifications foundation — targeted, per-user in-app notifications.
--
-- Context: the profile menu (the M avatar) and per-user notifications were the
-- backend gate on the Portfolio/Home redesign. Per-user PROFILES
-- (public.profiles) and ROLES/INVITES/CAPABILITIES
-- (organization_memberships.capabilities, organization_invites) already exist —
-- see docs/ROLES.md. The one missing piece is notifications, added here.
--
-- Notifications are addressed to a single recipient (a specific user), optionally
-- scoped to an organization and deep-linked to a source entity. "Who gets what"
-- is decided by the event producers wired in Phase 2 (using existing memberships
-- + project assignments), not by broadcast — this migration only stands up the
-- store, the RLS, the create/read helpers, and a per-user preferences column.
--
-- Portability: every statement is guarded (IF NOT EXISTS / DROP POLICY IF EXISTS
-- / CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS). No seed data, no enum casts.
-- Agents do not apply migrations — application is handled via Lovable.

-- ------------------------------------------------------------------ table
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- the one user this notification is for
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- the company context (null for account-level / cross-org system notices)
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- who/what triggered it (null for system-generated)
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- event slug, e.g. 'risk.flagged', 'change_order.pending', 'billing.paid',
  -- 'invite.accepted', 'mention', 'assignment'. Free text so the taxonomy can
  -- grow without an enum migration each time.
  type text NOT NULL,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  -- deep-link target so the bell can route to the source
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  entity_type text NOT NULL DEFAULT '',
  entity_id uuid,
  url text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}',
  -- null = unread
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The bell reads the recipient's newest unread-first; keep that path indexed.
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_recipient_unread_idx
  ON public.notifications (recipient_id)
  WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_org_idx
  ON public.notifications (organization_id);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipients see, mark-read, and dismiss ONLY their own notifications. There is
-- deliberately no INSERT policy for authenticated: rows are created through
-- public.create_notification() (SECURITY DEFINER, org-guarded) or by
-- service_role, so a user can never forge a notification to someone else.
DROP POLICY IF EXISTS notifications_recipient_read ON public.notifications;
CREATE POLICY notifications_recipient_read
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid());

DROP POLICY IF EXISTS notifications_recipient_update ON public.notifications;
CREATE POLICY notifications_recipient_update
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

DROP POLICY IF EXISTS notifications_recipient_delete ON public.notifications;
CREATE POLICY notifications_recipient_delete
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (recipient_id = auth.uid());

GRANT SELECT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

-- ------------------------------------------------------------------ create helper
-- Enqueue a notification for another user. SECURITY DEFINER so it can write a row
-- the recipient (not the caller) owns, but guarded: the caller must be an active
-- member of the target org AND the recipient must be an active member of that org
-- too. This lets any app action notify teammates in a shared company without
-- letting anyone spam arbitrary users or cross org boundaries. Account-level or
-- cross-org system notices (p_organization_id IS NULL) are service_role-only.
CREATE OR REPLACE FUNCTION public.create_notification(
  p_recipient_id uuid,
  p_organization_id uuid,
  p_type text,
  p_title text DEFAULT '',
  p_body text DEFAULT '',
  p_project_id uuid DEFAULT NULL,
  p_entity_type text DEFAULT '',
  p_entity_id uuid DEFAULT NULL,
  p_url text DEFAULT '',
  p_data jsonb DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'org-scoped notifications only; system notices go through service_role';
  END IF;
  -- caller must belong to the org
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'caller is not an active member of the target organization';
  END IF;
  -- recipient must belong to the same org
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = p_organization_id
      AND m.user_id = p_recipient_id
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'recipient is not an active member of the target organization';
  END IF;

  INSERT INTO public.notifications (
    recipient_id, organization_id, actor_id, type, title, body,
    project_id, entity_type, entity_id, url, data
  ) VALUES (
    p_recipient_id, p_organization_id, auth.uid(), p_type, COALESCE(p_title, ''),
    COALESCE(p_body, ''), p_project_id, COALESCE(p_entity_type, ''), p_entity_id,
    COALESCE(p_url, ''), COALESCE(p_data, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_notification(
  uuid, uuid, text, text, text, uuid, text, uuid, text, jsonb
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_notification(
  uuid, uuid, text, text, text, uuid, text, uuid, text, jsonb
) TO authenticated, service_role;

-- ------------------------------------------------------------------ mark-all-read helper
-- Convenience for the "mark all read" affordance. Per-row read toggling already
-- works through the recipient UPDATE policy; this clears the whole (optionally
-- org-scoped) inbox in one call, only ever touching the caller's own rows.
CREATE OR REPLACE FUNCTION public.mark_all_notifications_read(p_organization_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  UPDATE public.notifications
    SET read_at = now()
  WHERE recipient_id = auth.uid()
    AND read_at IS NULL
    AND (p_organization_id IS NULL OR organization_id = p_organization_id);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_all_notifications_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_all_notifications_read(uuid) TO authenticated, service_role;

-- ------------------------------------------------------------------ per-user prefs
-- Per-user notification preferences live on the profile (the "your profile"
-- surface the avatar menu opens). Object of booleans keyed by type/category,
-- e.g. {"risk.flagged": true, "billing": false}; empty = "receive everything".
-- Phase 2 producers consult this before enqueueing an in-app row.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}';
