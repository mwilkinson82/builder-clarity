-- Beta feedback capture: contractors flag issues in-app with automatic context.
-- Rows are read directly from the database; no notification wiring in this phase.

CREATE TABLE IF NOT EXISTS public.beta_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  route text NOT NULL DEFAULT '',
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS beta_feedback_org_created_idx
  ON public.beta_feedback (organization_id, created_at DESC);

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.beta_feedback TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beta_feedback TO service_role;

DROP POLICY IF EXISTS beta_feedback_insert_member ON public.beta_feedback;
CREATE POLICY beta_feedback_insert_member
  ON public.beta_feedback
  FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND public.is_org_member(organization_id)
  );

DROP POLICY IF EXISTS beta_feedback_select_admin ON public.beta_feedback;
CREATE POLICY beta_feedback_select_admin
  ON public.beta_feedback
  FOR SELECT
  TO authenticated
  USING (
    public.can_manage_org(organization_id)
    OR public.is_super_admin()
  );

NOTIFY pgrst, 'reload schema';
