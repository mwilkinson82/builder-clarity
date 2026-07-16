-- CRMACTION1 — outbound delivery, AI meeting prep, and post-award onboarding.
--
-- The shipped Follow-Up Studio remains the source of prepared actions and value
-- assets. This migration adds the durable execution/audit records around it.

CREATE UNIQUE INDEX IF NOT EXISTS pipeline_next_actions_id_org_uidx
  ON public.pipeline_next_actions(id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS ai_operations_id_org_uidx
  ON public.ai_operations(id, organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS projects_id_org_uidx
  ON public.projects(id, organization_id);

CREATE TABLE IF NOT EXISTS public.crm_outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  next_action_id uuid,
  value_asset_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_request_id uuid NOT NULL,
  recipient_email text NOT NULL CHECK (length(trim(recipient_email)) > 3),
  reply_to_email text NOT NULL DEFAULT '',
  subject text NOT NULL CHECK (length(trim(subject)) > 0),
  body_text text NOT NULL CHECK (length(trim(body_text)) > 0),
  provider text NOT NULL DEFAULT 'lovable_email'
    CHECK (provider IN ('lovable_email')),
  provider_message_id text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed')),
  error_message text NOT NULL DEFAULT '',
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, client_request_id),
  FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES public.pipeline_opportunities(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (next_action_id, organization_id)
    REFERENCES public.pipeline_next_actions(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (value_asset_id, organization_id)
    REFERENCES public.crm_value_assets(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.crm_meeting_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ai_operation_id uuid,
  meeting_type text NOT NULL DEFAULT 'sales'
    CHECK (meeting_type IN ('sales', 'handoff', 'kickoff', 'client_onboarding')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  meeting_at timestamptz,
  attendee_names text[] NOT NULL DEFAULT '{}',
  meeting_goal text NOT NULL DEFAULT '',
  source_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  brief_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'final', 'archived')),
  model_used text NOT NULL DEFAULT '',
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES public.pipeline_opportunities(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (ai_operation_id, organization_id)
    REFERENCES public.ai_operations(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.crm_onboarding_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL,
  project_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (length(trim(title)) > 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'stopped')),
  kickoff_date date,
  handoff_summary text NOT NULL DEFAULT '',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (opportunity_id, organization_id)
    REFERENCES public.pipeline_opportunities(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, organization_id)
    REFERENCES public.projects(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS public.crm_onboarding_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  step_order integer NOT NULL CHECK (step_order > 0),
  category text NOT NULL DEFAULT 'handoff'
    CHECK (category IN ('contract', 'client', 'handoff', 'scope', 'schedule', 'billing', 'risk', 'kickoff')),
  title text NOT NULL CHECK (length(trim(title)) > 0),
  description text NOT NULL DEFAULT '',
  due_offset_days integer NOT NULL DEFAULT 0
    CHECK (due_offset_days >= 0 AND due_offset_days <= 365),
  due_date date,
  status text NOT NULL DEFAULT 'todo'
    CHECK (status IN ('todo', 'done', 'skipped')),
  completed_at timestamptz,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  UNIQUE (plan_id, step_order),
  FOREIGN KEY (plan_id, organization_id)
    REFERENCES public.crm_onboarding_plans(id, organization_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_onboarding_one_active_plan_per_opportunity
  ON public.crm_onboarding_plans(opportunity_id)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS crm_outbound_messages_org_created_idx
  ON public.crm_outbound_messages(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_outbound_messages_action_idx
  ON public.crm_outbound_messages(next_action_id, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_meeting_briefs_opportunity_idx
  ON public.crm_meeting_briefs(opportunity_id, meeting_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_onboarding_plans_org_status_idx
  ON public.crm_onboarding_plans(organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS crm_onboarding_tasks_plan_status_idx
  ON public.crm_onboarding_tasks(plan_id, status, step_order);

DROP TRIGGER IF EXISTS crm_outbound_messages_set_updated_at ON public.crm_outbound_messages;
CREATE TRIGGER crm_outbound_messages_set_updated_at
  BEFORE UPDATE ON public.crm_outbound_messages
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_meeting_briefs_set_updated_at ON public.crm_meeting_briefs;
CREATE TRIGGER crm_meeting_briefs_set_updated_at
  BEFORE UPDATE ON public.crm_meeting_briefs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_onboarding_plans_set_updated_at ON public.crm_onboarding_plans;
CREATE TRIGGER crm_onboarding_plans_set_updated_at
  BEFORE UPDATE ON public.crm_onboarding_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
DROP TRIGGER IF EXISTS crm_onboarding_tasks_set_updated_at ON public.crm_onboarding_tasks;
CREATE TRIGGER crm_onboarding_tasks_set_updated_at
  BEFORE UPDATE ON public.crm_onboarding_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

ALTER TABLE public.crm_outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_meeting_briefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_onboarding_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_onboarding_tasks ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.crm_outbound_messages FROM anon, authenticated;
REVOKE ALL ON public.crm_meeting_briefs FROM anon, authenticated;
REVOKE ALL ON public.crm_onboarding_plans FROM anon, authenticated;
REVOKE ALL ON public.crm_onboarding_tasks FROM anon, authenticated;
GRANT SELECT ON public.crm_outbound_messages TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_meeting_briefs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_onboarding_plans TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.crm_onboarding_tasks TO authenticated;
GRANT ALL ON public.crm_outbound_messages TO service_role;
GRANT ALL ON public.crm_meeting_briefs TO service_role;
GRANT ALL ON public.crm_onboarding_plans TO service_role;
GRANT ALL ON public.crm_onboarding_tasks TO service_role;

DROP POLICY IF EXISTS crm_outbound_messages_member_select ON public.crm_outbound_messages;
CREATE POLICY crm_outbound_messages_member_select ON public.crm_outbound_messages
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS crm_meeting_briefs_member_select ON public.crm_meeting_briefs;
CREATE POLICY crm_meeting_briefs_member_select ON public.crm_meeting_briefs
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_meeting_briefs_member_insert ON public.crm_meeting_briefs;
CREATE POLICY crm_meeting_briefs_member_insert ON public.crm_meeting_briefs
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (owner_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_meeting_briefs.organization_id
        AND membership.user_id = crm_meeting_briefs.owner_user_id
        AND membership.status = 'active'
    ))
  );
DROP POLICY IF EXISTS crm_meeting_briefs_member_update ON public.crm_meeting_briefs;
CREATE POLICY crm_meeting_briefs_member_update ON public.crm_meeting_briefs
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (owner_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_meeting_briefs.organization_id
        AND membership.user_id = crm_meeting_briefs.owner_user_id
        AND membership.status = 'active'
    ))
  );

DROP POLICY IF EXISTS crm_onboarding_plans_member_select ON public.crm_onboarding_plans;
CREATE POLICY crm_onboarding_plans_member_select ON public.crm_onboarding_plans
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_onboarding_plans_member_insert ON public.crm_onboarding_plans;
CREATE POLICY crm_onboarding_plans_member_insert ON public.crm_onboarding_plans
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (owner_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_onboarding_plans.organization_id
        AND membership.user_id = crm_onboarding_plans.owner_user_id
        AND membership.status = 'active'
    ))
  );
DROP POLICY IF EXISTS crm_onboarding_plans_member_update ON public.crm_onboarding_plans;
CREATE POLICY crm_onboarding_plans_member_update ON public.crm_onboarding_plans
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (owner_user_id IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_onboarding_plans.organization_id
        AND membership.user_id = crm_onboarding_plans.owner_user_id
        AND membership.status = 'active'
    ))
  );

DROP POLICY IF EXISTS crm_onboarding_tasks_member_select ON public.crm_onboarding_tasks;
CREATE POLICY crm_onboarding_tasks_member_select ON public.crm_onboarding_tasks
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
DROP POLICY IF EXISTS crm_onboarding_tasks_member_insert ON public.crm_onboarding_tasks;
CREATE POLICY crm_onboarding_tasks_member_insert ON public.crm_onboarding_tasks
  FOR INSERT TO authenticated WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (assigned_to IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_onboarding_tasks.organization_id
        AND membership.user_id = crm_onboarding_tasks.assigned_to
        AND membership.status = 'active'
    ))
  );
DROP POLICY IF EXISTS crm_onboarding_tasks_member_update ON public.crm_onboarding_tasks;
CREATE POLICY crm_onboarding_tasks_member_update ON public.crm_onboarding_tasks
  FOR UPDATE TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (assigned_to IS NULL OR EXISTS (
      SELECT 1 FROM public.organization_memberships membership
      WHERE membership.organization_id = crm_onboarding_tasks.organization_id
        AND membership.user_id = crm_onboarding_tasks.assigned_to
        AND membership.status = 'active'
    ))
  );

-- One CRM generation consumes one existing AI credit and is retained in the
-- same auditable operation/margin ledger as estimating AI.
DO $$
BEGIN
  IF to_regclass('public.credit_ledger') IS NOT NULL THEN
    ALTER TABLE public.credit_ledger
      DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
    ALTER TABLE public.credit_ledger
      ADD CONSTRAINT credit_ledger_reason_check CHECK (
        reason IN (
          'signup_grant',
          'monthly_plan_grant',
          'purchase',
          'ai_count_scan',
          'ai_measurement_plan',
          'ai_scope_brief',
          'ai_assembly_assumptions',
          'ai_revision_match',
          'ai_revision_scope_review',
          'ai_crm_assist',
          'refund',
          'admin_adjustment'
        )
      );
  END IF;
  IF to_regclass('public.ai_operations') IS NOT NULL THEN
    ALTER TABLE public.ai_operations
      DROP CONSTRAINT IF EXISTS ai_operations_operation_type_check;
    ALTER TABLE public.ai_operations
      ADD CONSTRAINT ai_operations_operation_type_check CHECK (
        operation_type IN (
          'ai_count_scan',
          'ai_measurement_plan',
          'ai_scope_brief',
          'ai_assembly_assumptions',
          'ai_revision_match',
          'ai_revision_scope_review',
          'ai_crm_assist'
        )
      );
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
