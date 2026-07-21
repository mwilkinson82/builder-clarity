-- ============================================================================
-- ROLES PHASE 3: capability split — module capabilities become server-enforced
-- ============================================================================
-- docs/ROLES.md §5 named this migration: retarget module policies and command
-- bodies onto their own capabilities instead of the coarse Phase 2 helpers.
-- After this file:
--   * estimating writes  -> estimating.write   (via the can_manage_estimate lever)
--   * CRM/pipeline writes -> crm.manage        (can_write_crm)
--   * cost library + markup defaults -> cost_library.write (can_write_cost_library)
--   * billing-family commands -> billing.manage (can_manage_billing)
--   * schedule writes    -> schedule.manage    (can_manage_schedule)
--   * client-access management -> client_portal.manage (can_manage_client_access)
--   * financial SELECTs  -> can_view_financials (helper shipped idle in Phase 2)
--   * org row / memberships / invites / credit ledger reads -> company.* split
--   * notifications.url  -> same-origin relative-path only (write-side guard for
--     the NotificationBell open-redirect)
--
-- Where the 2026-07-20 financial batch already revoked raw client DML, RLS can
-- no longer see those writes: SECURITY DEFINER commands are the only write
-- path, so the capability checks in section 4 are edits to the COMMAND BODIES
-- themselves. Style decision (used consistently below): the command's existing
-- public.can_manage_project(...) authorization call is REPLACED with the
-- module helper (can_manage_billing / can_manage_schedule). The module helpers
-- are strict subsets of can_manage_project's pass set plus the project-owner
-- and super-admin branches, so every replacement only tightens.
--
-- Decisions the founder has not explicitly ruled on are applied as defaults and
-- tagged `-- FOUNDER-DEFAULT:` so the PR can list every one of them.
--
-- Replay safety: every statement is CREATE OR REPLACE / DROP POLICY IF EXISTS /
-- DO-block guarded; the command rewrites detect an already-retargeted body and
-- no-op. The whole file re-applies cleanly over itself.

-- ============================================================================
-- 1. New module helpers (Phase 2 appendix B style: SECURITY DEFINER, STABLE,
--    search_path = public, EXECUTE only for authenticated + service_role)
-- ============================================================================

-- Run billing: pay applications, invoices, payments, cost actuals — and, by
-- founder-default below, budget/SOV bucket authority. Project owner and super
-- admin always pass; everyone else needs projects.manage scope on the project
-- (can_manage_project) AND the billing.manage capability.
CREATE OR REPLACE FUNCTION public.can_manage_billing(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR (
            public.can_manage_project(p_project_id)
            AND public.has_org_capability(p.organization_id, 'billing.manage')
          )
        )
    )
  );
$$;

-- Build schedules: same shape with schedule.manage.
CREATE OR REPLACE FUNCTION public.can_manage_schedule(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR (
            public.can_manage_project(p_project_id)
            AND public.has_org_capability(p.organization_id, 'schedule.manage')
          )
        )
    )
  );
$$;

-- Manage client access: same shape with client_portal.manage.
CREATE OR REPLACE FUNCTION public.can_manage_client_access(p_project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.projects p
      WHERE p.id = p_project_id
        AND (
          p.owner_id = (SELECT auth.uid())
          OR (
            public.can_manage_project(p_project_id)
            AND public.has_org_capability(p.organization_id, 'client_portal.manage')
          )
        )
    )
  );
$$;

-- Work the pipeline: org-scoped CRM writes.
CREATE OR REPLACE FUNCTION public.can_write_crm(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR public.has_org_capability(p_org_id, 'crm.manage')
  );
$$;

-- Edit cost library: shared library + markup defaults everyone prices from.
CREATE OR REPLACE FUNCTION public.can_write_cost_library(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL AND (
    public.is_super_admin()
    OR public.has_org_capability(p_org_id, 'cost_library.write')
  );
$$;

REVOKE ALL ON FUNCTION public.can_manage_billing(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_schedule(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_manage_client_access(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_crm(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_write_cost_library(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_billing(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_schedule(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_client_access(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_crm(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_write_cost_library(uuid) TO authenticated, service_role;

-- Is (p_user) an ACTIVE member of (p_org)? SECURITY DEFINER so the existence
-- check does NOT re-enter the tightened organization_memberships SELECT policy
-- (3g: self-or-manage_team). Same pattern as shares_org_with (Section G): the
-- recreated CRM WITH CHECKs below prove owner/assignee membership with a raw
-- EXISTS that, post-3g, can only see the caller's OWN row — so a crm.manage
-- holder without company.manage_team could not assign work to a TEAMMATE. This
-- helper exposes exactly the boolean, nothing else.
CREATE OR REPLACE FUNCTION public.user_is_active_org_member(p_org uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_memberships m
    WHERE m.organization_id = p_org
      AND m.user_id = p_user
      AND m.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.user_is_active_org_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_is_active_org_member(uuid, uuid) TO authenticated, service_role;

-- ============================================================================
-- 2. The one-helper lever: can_manage_estimate drops its any-member branch
-- ============================================================================
-- The Phase 2 body (20260717172553) passed for ANY active member via an
-- is_org_member OR-branch — the documented ROLES.md §2 gap. Replacing that one
-- branch with estimating.write converts every plan-room/commercial RLS policy,
-- the plan-room storage bucket, and ~20 estimate/takeoff SECURITY DEFINER
-- commands in one move. The super-admin, can_manage_org, canonical-demo-lock,
-- and project-linked can_manage_project branches are kept exactly as they were.
--
-- can_read_estimate was reviewed for this migration and is left unchanged on
-- purpose: its branches (is_org_member / super / can_read_project) are all
-- read-level — module reads stay member-level per ROLES.md.
CREATE OR REPLACE FUNCTION public.can_manage_estimate(p_estimate_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.estimates estimate
      WHERE estimate.id = p_estimate_id
        AND NOT estimate.is_canonical_demo
        AND (
          public.has_org_capability(estimate.organization_id, 'estimating.write')
          OR public.is_super_admin()
          OR public.can_manage_org(estimate.organization_id)
          OR (
            estimate.project_id IS NOT NULL
            AND public.can_manage_project(estimate.project_id)
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_manage_estimate(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_estimate(uuid) TO authenticated, service_role;

-- ============================================================================
-- 3. Policy split (drop-if-exists + recreate, latest wins)
-- ============================================================================

-- 3a. Cost library + markup defaults -> cost_library.write ---------------------
-- Closes the ROLES.md Finding 3 inconsistency (any member could INSERT library
-- items while UPDATE/DELETE needed the company-manage bundle). The
-- source <> 'system' guard on update/delete is kept verbatim. SELECT stays
-- is_org_member (module read every member keeps).

DROP POLICY IF EXISTS cost_library_items_org_insert ON public.cost_library_items;
CREATE POLICY cost_library_items_org_insert
  ON public.cost_library_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_cost_library(organization_id));

DROP POLICY IF EXISTS cost_library_items_user_update ON public.cost_library_items;
CREATE POLICY cost_library_items_user_update
  ON public.cost_library_items
  FOR UPDATE
  TO authenticated
  USING (public.can_write_cost_library(organization_id) AND source <> 'system')
  WITH CHECK (public.can_write_cost_library(organization_id) AND source <> 'system');

DROP POLICY IF EXISTS cost_library_items_user_delete ON public.cost_library_items;
CREATE POLICY cost_library_items_user_delete
  ON public.cost_library_items
  FOR DELETE
  TO authenticated
  USING (public.can_write_cost_library(organization_id) AND source <> 'system');

DROP POLICY IF EXISTS estimate_markup_defaults_org_insert ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_insert
  ON public.estimate_markup_defaults
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_cost_library(organization_id));

DROP POLICY IF EXISTS estimate_markup_defaults_org_update ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_update
  ON public.estimate_markup_defaults
  FOR UPDATE
  TO authenticated
  USING (public.can_write_cost_library(organization_id))
  WITH CHECK (public.can_write_cost_library(organization_id));

DROP POLICY IF EXISTS estimate_markup_defaults_org_delete ON public.estimate_markup_defaults;
CREATE POLICY estimate_markup_defaults_org_delete
  ON public.estimate_markup_defaults
  FOR DELETE
  TO authenticated
  USING (public.can_write_cost_library(organization_id));

-- cost_library price-history side table: the SECURITY INVOKER trigger
-- tg_cost_library_price_history (20260717165130) fires BEFORE UPDATE on
-- cost_library_items and INSERTs the prior row into cost_library_price_history
-- whenever a price field changes. Its only INSERT policy was can_manage_org, so
-- a cost_library.write holder WITHOUT the company-manage bundle — exactly the
-- audience 3a's item-update policy now admits — passed the item UPDATE but had
-- the trigger's history INSERT denied by RLS, aborting the whole statement
-- (price edits failed, non-price edits succeeded). The trigger carries full org
-- context (organization_id = OLD.organization_id), so retargeting this policy to
-- the same audience as the item-update policy is the minimal correct fix; the
-- trigger stays SECURITY INVOKER.
DROP POLICY IF EXISTS cost_library_price_history_org_insert ON public.cost_library_price_history;
CREATE POLICY cost_library_price_history_org_insert
  ON public.cost_library_price_history
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_write_cost_library(organization_id));

-- 3a-bis. estimates base-table UPDATE -> can_manage_estimate --------------------
-- estimates_org_update (20260630035606) was is_org_member — ANY active member,
-- including the read-only Viewer preset, could UPDATE any org estimate. The
-- section-2 lever converts the estimate *commands* onto estimating.write but the
-- base-table UPDATE policy was never routed through it. Live escape:
-- 20260720191111 revoked table-wide UPDATE on estimates but re-granted
-- column-level UPDATE on every non-financial column to authenticated — including
-- name/description/region AND is_canonical_demo — so a raw PATCH could
-- rename/deface any estimate, or flip a real draft into the canonical-demo lock
-- (a permanent, non-self-reversible DoS: can_manage_estimate then returns false
-- for everyone and tg_lock_canonical_estimate blocks all client edits).
-- Retarget the policy onto the estimating.write lever, and pull the canonical
-- bookkeeping columns out of the authenticated column-UPDATE grant so only the
-- SECURITY DEFINER canonical-seed path can set them.
DROP POLICY IF EXISTS estimates_org_update ON public.estimates;
CREATE POLICY estimates_org_update
  ON public.estimates
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_estimate(id))
  WITH CHECK (public.can_manage_estimate(id));

REVOKE UPDATE (
  is_canonical_demo,
  canonical_demo_key,
  canonical_demo_version,
  canonical_expected_total_cents
) ON public.estimates FROM authenticated;

-- 3b. CRM / pipeline writes -> crm.manage --------------------------------------
-- Every additional predicate the current policies carry (created_by self-or-
-- null, opportunity-belongs-to-org, owner/assignee-is-active-member) is kept;
-- only the is_org_member gate becomes can_write_crm. The owner/assignee active-
-- member proof is routed through the SECURITY DEFINER helper
-- public.user_is_active_org_member(org,user) instead of a raw EXISTS on
-- organization_memberships: after 3g tightens that table's SELECT to
-- self-or-manage_team, a raw in-policy EXISTS can only see the caller's own row,
-- so a crm.manage holder without company.manage_team could not assign work to a
-- teammate (blocker finding). SELECTs stay is_org_member. No DELETE policies
-- exist by design (delete-as-archive, ROLES.md Finding 4) — none are added.

DROP POLICY IF EXISTS pipeline_opportunities_member_insert ON public.pipeline_opportunities;
CREATE POLICY pipeline_opportunities_member_insert
  ON public.pipeline_opportunities
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS pipeline_opportunities_member_update ON public.pipeline_opportunities;
CREATE POLICY pipeline_opportunities_member_update
  ON public.pipeline_opportunities
  FOR UPDATE
  TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS pipeline_activity_log_member_insert ON public.pipeline_activity_log;
CREATE POLICY pipeline_activity_log_member_insert
  ON public.pipeline_activity_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.pipeline_opportunities o
      WHERE o.id = opportunity_id
        AND o.organization_id = pipeline_activity_log.organization_id
    )
  );

DROP POLICY IF EXISTS pipeline_accounts_member_insert ON public.pipeline_accounts;
CREATE POLICY pipeline_accounts_member_insert
  ON public.pipeline_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_accounts_member_update ON public.pipeline_accounts;
CREATE POLICY pipeline_accounts_member_update
  ON public.pipeline_accounts
  FOR UPDATE
  TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS pipeline_contacts_member_insert ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_member_insert
  ON public.pipeline_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_contacts_member_update ON public.pipeline_contacts;
CREATE POLICY pipeline_contacts_member_update
  ON public.pipeline_contacts
  FOR UPDATE
  TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS pipeline_next_actions_member_insert ON public.pipeline_next_actions;
CREATE POLICY pipeline_next_actions_member_insert
  ON public.pipeline_next_actions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS pipeline_next_actions_member_update ON public.pipeline_next_actions;
CREATE POLICY pipeline_next_actions_member_update
  ON public.pipeline_next_actions
  FOR UPDATE
  TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS crm_value_assets_member_insert ON public.crm_value_assets;
CREATE POLICY crm_value_assets_member_insert ON public.crm_value_assets
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_value_assets_member_update ON public.crm_value_assets;
CREATE POLICY crm_value_assets_member_update ON public.crm_value_assets
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS crm_followup_playbooks_member_insert ON public.crm_followup_playbooks;
CREATE POLICY crm_followup_playbooks_member_insert ON public.crm_followup_playbooks
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_followup_playbooks_member_update ON public.crm_followup_playbooks;
CREATE POLICY crm_followup_playbooks_member_update ON public.crm_followup_playbooks
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS crm_followup_playbook_steps_member_insert
  ON public.crm_followup_playbook_steps;
CREATE POLICY crm_followup_playbook_steps_member_insert
  ON public.crm_followup_playbook_steps
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
  );

DROP POLICY IF EXISTS crm_followup_playbook_steps_member_update
  ON public.crm_followup_playbook_steps;
CREATE POLICY crm_followup_playbook_steps_member_update
  ON public.crm_followup_playbook_steps
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (public.can_write_crm(organization_id));

DROP POLICY IF EXISTS crm_followup_enrollments_member_insert
  ON public.crm_followup_enrollments;
CREATE POLICY crm_followup_enrollments_member_insert
  ON public.crm_followup_enrollments
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      owner_user_id IS NULL
      OR owner_user_id = (SELECT auth.uid())
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_followup_enrollments_member_update
  ON public.crm_followup_enrollments;
CREATE POLICY crm_followup_enrollments_member_update
  ON public.crm_followup_enrollments
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (
    public.can_write_crm(organization_id)
    -- covers the update arm that lacks a self-branch: the definer helper sees
    -- teammate rows a raw in-policy EXISTS could not, post-3g.
    AND (
      owner_user_id IS NULL
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_meeting_briefs_member_insert ON public.crm_meeting_briefs;
CREATE POLICY crm_meeting_briefs_member_insert ON public.crm_meeting_briefs
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      owner_user_id IS NULL
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_meeting_briefs_member_update ON public.crm_meeting_briefs;
CREATE POLICY crm_meeting_briefs_member_update ON public.crm_meeting_briefs
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      owner_user_id IS NULL
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_onboarding_plans_member_insert ON public.crm_onboarding_plans;
CREATE POLICY crm_onboarding_plans_member_insert ON public.crm_onboarding_plans
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      owner_user_id IS NULL
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_onboarding_plans_member_update ON public.crm_onboarding_plans;
CREATE POLICY crm_onboarding_plans_member_update ON public.crm_onboarding_plans
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      owner_user_id IS NULL
      OR public.user_is_active_org_member(organization_id, owner_user_id)
    )
  );

DROP POLICY IF EXISTS crm_onboarding_tasks_member_insert ON public.crm_onboarding_tasks;
CREATE POLICY crm_onboarding_tasks_member_insert ON public.crm_onboarding_tasks
  FOR INSERT TO authenticated WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      assigned_to IS NULL
      OR public.user_is_active_org_member(organization_id, assigned_to)
    )
  );

DROP POLICY IF EXISTS crm_onboarding_tasks_member_update ON public.crm_onboarding_tasks;
CREATE POLICY crm_onboarding_tasks_member_update ON public.crm_onboarding_tasks
  FOR UPDATE TO authenticated
  USING (public.can_write_crm(organization_id))
  WITH CHECK (
    public.can_write_crm(organization_id)
    AND (created_by IS NULL OR created_by = (SELECT auth.uid()))
    AND (
      assigned_to IS NULL
      OR public.user_is_active_org_member(organization_id, assigned_to)
    )
  );

-- crm-assets storage bucket: uploads/deletes are CRM work; reads stay member.
DROP POLICY IF EXISTS crm_assets_storage_insert ON storage.objects;
CREATE POLICY crm_assets_storage_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'crm-assets'
    AND public.can_write_crm(((storage.foldername(name))[1])::uuid)
  );

DROP POLICY IF EXISTS crm_assets_storage_delete ON storage.objects;
CREATE POLICY crm_assets_storage_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'crm-assets'
    AND public.can_write_crm(((storage.foldername(name))[1])::uuid)
  );

-- 3c. Schedule writes -> schedule.manage ---------------------------------------
-- Eleven tables, one predicate swap: can_manage_project -> can_manage_schedule.
-- can_manage_project itself is NOT touched (it also guards risks / change
-- orders / daily logs). Self-attribution predicates on the progress tables are
-- kept verbatim. SELECTs stay can_read_project.

DROP POLICY IF EXISTS schedule_milestones_team_insert ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_insert ON public.schedule_milestones
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_milestones_team_update ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_update ON public.schedule_milestones
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_milestones_team_delete ON public.schedule_milestones;
CREATE POLICY schedule_milestones_team_delete ON public.schedule_milestones
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_risks_team_insert ON public.schedule_risks;
CREATE POLICY schedule_risks_team_insert ON public.schedule_risks
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_risks_team_update ON public.schedule_risks;
CREATE POLICY schedule_risks_team_update ON public.schedule_risks
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_risks_team_delete ON public.schedule_risks;
CREATE POLICY schedule_risks_team_delete ON public.schedule_risks
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_updates_team_insert ON public.schedule_updates;
CREATE POLICY schedule_updates_team_insert ON public.schedule_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_updates_team_update ON public.schedule_updates;
CREATE POLICY schedule_updates_team_update ON public.schedule_updates
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_updates_team_delete ON public.schedule_updates;
CREATE POLICY schedule_updates_team_delete ON public.schedule_updates
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_milestone_updates_team_insert ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_insert ON public.schedule_milestone_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_milestone_updates_team_update ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_update ON public.schedule_milestone_updates
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_milestone_updates_team_delete ON public.schedule_milestone_updates;
CREATE POLICY schedule_milestone_updates_team_delete ON public.schedule_milestone_updates
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_activities_team_insert ON public.schedule_activities;
CREATE POLICY schedule_activities_team_insert ON public.schedule_activities
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_activities_team_update ON public.schedule_activities;
CREATE POLICY schedule_activities_team_update ON public.schedule_activities
  FOR UPDATE TO authenticated
  USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_activities_team_delete ON public.schedule_activities;
CREATE POLICY schedule_activities_team_delete ON public.schedule_activities
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_wbs_sections_team_insert ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_insert ON public.schedule_wbs_sections
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_wbs_sections_team_update ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_update ON public.schedule_wbs_sections
  FOR UPDATE TO authenticated
  USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_wbs_sections_team_delete ON public.schedule_wbs_sections;
CREATE POLICY schedule_wbs_sections_team_delete ON public.schedule_wbs_sections
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_delay_fragments_team_insert ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_insert ON public.schedule_delay_fragments
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_delay_fragments_team_update ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_update ON public.schedule_delay_fragments
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_delay_fragments_team_delete ON public.schedule_delay_fragments;
CREATE POLICY schedule_delay_fragments_team_delete ON public.schedule_delay_fragments
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_cpm_templates_team_insert ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_insert ON public.schedule_cpm_templates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_cpm_templates_team_update ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_update ON public.schedule_cpm_templates
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_cpm_templates_team_delete ON public.schedule_cpm_templates;
CREATE POLICY schedule_cpm_templates_team_delete ON public.schedule_cpm_templates
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_activity_updates_team_insert ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_insert ON public.schedule_activity_updates
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_activity_updates_team_update ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_update ON public.schedule_activity_updates
  FOR UPDATE TO authenticated USING (public.can_manage_schedule(project_id))
  WITH CHECK (public.can_manage_schedule(project_id));
DROP POLICY IF EXISTS schedule_activity_updates_team_delete ON public.schedule_activity_updates;
CREATE POLICY schedule_activity_updates_team_delete ON public.schedule_activity_updates
  FOR DELETE TO authenticated USING (public.can_manage_schedule(project_id));

DROP POLICY IF EXISTS schedule_activity_progress_controls_team_insert
  ON public.schedule_activity_progress_controls;
CREATE POLICY schedule_activity_progress_controls_team_insert
  ON public.schedule_activity_progress_controls
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_schedule(project_id)
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS schedule_activity_progress_controls_team_update
  ON public.schedule_activity_progress_controls;
CREATE POLICY schedule_activity_progress_controls_team_update
  ON public.schedule_activity_progress_controls
  FOR UPDATE TO authenticated
  USING (public.can_manage_schedule(project_id))
  WITH CHECK (
    public.can_manage_schedule(project_id)
    AND updated_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS schedule_activity_progress_reviews_team_insert
  ON public.schedule_activity_progress_reviews;
CREATE POLICY schedule_activity_progress_reviews_team_insert
  ON public.schedule_activity_progress_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.can_manage_schedule(project_id)
    AND reviewed_by = (SELECT auth.uid())
  );

-- 3d. Client-portal management -> client_portal.manage (+ crm.manage on the
--     shared contact book) -----------------------------------------------------
-- client_contacts writes were gated by can_create_project_in_org, which the
-- 2026-06-22 relaxation reduced to bare `auth.uid() IS NOT NULL` — ANY
-- authenticated user of ANY company could write any org's client contacts.
-- These policies also close that cross-org hole: the capability pair implies an
-- ACTIVE membership in the row's organization.

DROP POLICY IF EXISTS client_contacts_org_read ON public.client_contacts;
CREATE POLICY client_contacts_org_read ON public.client_contacts
  FOR SELECT TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND (
      public.has_org_capability(organization_id, 'crm.manage')
      OR public.has_org_capability(organization_id, 'client_portal.manage')
    )
  );

DROP POLICY IF EXISTS client_contacts_org_insert ON public.client_contacts;
CREATE POLICY client_contacts_org_insert ON public.client_contacts
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (
      public.has_org_capability(organization_id, 'crm.manage')
      OR public.has_org_capability(organization_id, 'client_portal.manage')
    )
  );

DROP POLICY IF EXISTS client_contacts_org_update ON public.client_contacts;
CREATE POLICY client_contacts_org_update ON public.client_contacts
  FOR UPDATE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND (
      public.has_org_capability(organization_id, 'crm.manage')
      OR public.has_org_capability(organization_id, 'client_portal.manage')
    )
  )
  WITH CHECK (
    public.is_org_member(organization_id)
    AND (
      public.has_org_capability(organization_id, 'crm.manage')
      OR public.has_org_capability(organization_id, 'client_portal.manage')
    )
  );

DROP POLICY IF EXISTS client_contacts_org_delete ON public.client_contacts;
CREATE POLICY client_contacts_org_delete ON public.client_contacts
  FOR DELETE TO authenticated
  USING (
    public.is_org_member(organization_id)
    AND (
      public.has_org_capability(organization_id, 'crm.manage')
      OR public.has_org_capability(organization_id, 'client_portal.manage')
    )
  );

-- project_client_access rows carry the per-project portal switches
-- (billing / change orders / daily reports / selections), so this single gate
-- is what controls granting clients visibility. SELECT is unchanged (project
-- readers see share state; clients read their own row for the portal).
DROP POLICY IF EXISTS project_client_access_project_insert ON public.project_client_access;
CREATE POLICY project_client_access_project_insert ON public.project_client_access
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_client_access(project_id));

DROP POLICY IF EXISTS project_client_access_project_update ON public.project_client_access;
CREATE POLICY project_client_access_project_update ON public.project_client_access
  FOR UPDATE TO authenticated
  USING (public.can_manage_client_access(project_id))
  WITH CHECK (public.can_manage_client_access(project_id));

DROP POLICY IF EXISTS project_client_access_project_delete ON public.project_client_access;
CREATE POLICY project_client_access_project_delete ON public.project_client_access
  FOR DELETE TO authenticated
  USING (public.can_manage_client_access(project_id));

-- 3e. Financial SELECT retarget -> can_view_financials --------------------------
-- Dollar reads follow financials.view on a readable project (project owner and
-- super admin always pass). Client-portal SELECT policies (separate mechanism)
-- and service-role/audit-journal policies are deliberately untouched.

DROP POLICY IF EXISTS billing_applications_team_select ON public.billing_applications;
CREATE POLICY billing_applications_team_select ON public.billing_applications
  FOR SELECT TO authenticated USING (public.can_view_financials(project_id));

-- billing_applications_owner_via_project was FOR ALL with no TO clause. Its
-- write arms are inert (raw DML revoked 20260720170500) and its read arm is
-- redundant: can_view_financials passes for the project owner explicitly.
-- Dropped rather than rescoped.
DROP POLICY IF EXISTS billing_applications_owner_via_project ON public.billing_applications;

DROP POLICY IF EXISTS billing_invoices_team_select ON public.billing_invoices;
CREATE POLICY billing_invoices_team_select ON public.billing_invoices
  FOR SELECT TO authenticated
  USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS billing_line_items_team_select ON public.billing_line_items;
CREATE POLICY billing_line_items_team_select ON public.billing_line_items
  FOR SELECT TO authenticated USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS payment_ledger_team_select ON public.payment_ledger;
CREATE POLICY payment_ledger_team_select ON public.payment_ledger
  FOR SELECT TO authenticated
  USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS cost_actuals_team_select ON public.cost_actuals;
CREATE POLICY cost_actuals_team_select ON public.cost_actuals
  FOR SELECT TO authenticated USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS cost_actual_payments_team_select ON public.cost_actual_payments;
CREATE POLICY cost_actual_payments_team_select
  ON public.cost_actual_payments
  FOR SELECT TO authenticated
  USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS cost_actual_import_batches_team_select ON public.cost_actual_import_batches;
CREATE POLICY cost_actual_import_batches_team_select ON public.cost_actual_import_batches
  FOR SELECT TO authenticated USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS cost_buckets_team_select ON public.cost_buckets;
CREATE POLICY cost_buckets_team_select ON public.cost_buckets
  FOR SELECT TO authenticated USING (public.can_view_financials(project_id));

-- cost_budget_items keeps live raw RLS writes (its siblings all went
-- command-only on 2026-07-20), so the write split is load-bearing here, and its
-- SELECT carries the same dollar data as the retargeted siblings. (cost_buckets
-- also keeps a live raw column-UPDATE path for its presentation columns — gated
-- onto billing.manage just below — so it is not the *only* billing-family table
-- with live writes.)
DROP POLICY IF EXISTS cost_budget_items_team_select ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_select
  ON public.cost_budget_items
  FOR SELECT TO authenticated
  USING (public.can_view_financials(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_insert ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_insert
  ON public.cost_budget_items
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_billing(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_update ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_update
  ON public.cost_budget_items
  FOR UPDATE TO authenticated
  USING (public.can_manage_billing(project_id))
  WITH CHECK (public.can_manage_billing(project_id));

DROP POLICY IF EXISTS cost_budget_items_team_delete ON public.cost_budget_items;
CREATE POLICY cost_budget_items_team_delete
  ON public.cost_budget_items
  FOR DELETE TO authenticated
  USING (public.can_manage_billing(project_id));

-- cost_buckets: bucket authority moved to billing.manage (the FOUNDER-DEFAULT
-- bucket commands in section 4), but 20260720191111 revoked table-wide
-- INSERT/UPDATE/DELETE then re-granted column-level UPDATE on every non-money
-- presentation column (cost_code, bucket, source_type/date/note, sort_order,
-- updated_at) to authenticated — a live raw-UPDATE path still gated only on
-- can_manage_project (projects.manage), letting a projects.manage holder without
-- billing.manage mutate bucket presentation. Retarget the write policies onto
-- can_manage_billing so the live column-UPDATE path (and any future re-GRANT of
-- INSERT/DELETE) rides billing.manage like the rest of the bucket family.
-- Also drop the redundant cost_buckets_owner_via_project policy: it is FOR ALL
-- with no TO clause (the twin of billing_applications_owner_via_project this file
-- already dropped) — its write arms are covered by the owner branch inside
-- can_manage_billing and its read arm by can_view_financials.
DROP POLICY IF EXISTS cost_buckets_owner_via_project ON public.cost_buckets;

DROP POLICY IF EXISTS cost_buckets_team_insert ON public.cost_buckets;
CREATE POLICY cost_buckets_team_insert ON public.cost_buckets
  FOR INSERT TO authenticated WITH CHECK (public.can_manage_billing(project_id));
DROP POLICY IF EXISTS cost_buckets_team_update ON public.cost_buckets;
CREATE POLICY cost_buckets_team_update ON public.cost_buckets
  FOR UPDATE TO authenticated USING (public.can_manage_billing(project_id))
  WITH CHECK (public.can_manage_billing(project_id));
DROP POLICY IF EXISTS cost_buckets_team_delete ON public.cost_buckets;
CREATE POLICY cost_buckets_team_delete ON public.cost_buckets
  FOR DELETE TO authenticated USING (public.can_manage_billing(project_id));

-- FOUNDER-DEFAULT: sov_mapping_profiles steer how estimate->SOV conversion maps
-- money onto SOV codes (consumed by convert_estimate_to_sov_atomic, itself moved
-- to billing.manage above). Writes were bare is_org_member (any member could
-- mutate org SOV mappings); retarget onto billing.manage. SOV mapping is
-- billing-adjacent money authority — billing.manage is the money-authority
-- default (revisit if the founder wants estimating.write instead). SELECT stays
-- member-level; the insert self-attribution (created_by) is kept; is_super_admin
-- is preserved for Overwatch staff.
DROP POLICY IF EXISTS sov_mapping_profiles_member_insert ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_insert
  ON public.sov_mapping_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (public.is_super_admin() OR public.has_org_capability(organization_id, 'billing.manage'))
    AND created_by = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS sov_mapping_profiles_member_update ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_update
  ON public.sov_mapping_profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin() OR public.has_org_capability(organization_id, 'billing.manage'))
  WITH CHECK (public.is_super_admin() OR public.has_org_capability(organization_id, 'billing.manage'));

DROP POLICY IF EXISTS sov_mapping_profiles_member_delete ON public.sov_mapping_profiles;
CREATE POLICY sov_mapping_profiles_member_delete
  ON public.sov_mapping_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin() OR public.has_org_capability(organization_id, 'billing.manage'));

-- 3f. organizations: commercial row is no longer an every-member read ----------
-- The org row carries Stripe customer/subscription/Connect ids, entitlement and
-- Contractor Circle fields (including a personal email), billing contacts, and
-- the tax identifier. Base SELECT now requires a company capability; members
-- get the safe projection through organizations_directory() below.

DROP POLICY IF EXISTS organizations_member_read ON public.organizations;
CREATE POLICY organizations_member_read
  ON public.organizations
  FOR SELECT
  TO authenticated
  USING (
    public.has_org_capability(id, 'company.manage_settings')
    OR public.has_org_capability(id, 'billing.manage')
    OR public.has_org_capability(id, 'company.manage_team')
  );

-- Member-safe projection for every active member: identity + plan + quota
-- fields only. SECURITY DEFINER so it can read past the tightened base policy;
-- the is_org_member check inside is the gate.
CREATE OR REPLACE FUNCTION public.organizations_directory(p_org_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  logo_url text,
  logo_path text,
  plan_code text,
  billing_status text,
  seat_limit integer,
  project_limit integer,
  storage_limit_mb integer,
  daily_report_limit_per_month integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    o.id, o.name, o.slug, o.logo_url, o.logo_path,
    o.plan_code, o.billing_status,
    o.seat_limit, o.project_limit, o.storage_limit_mb,
    o.daily_report_limit_per_month
  FROM public.organizations o
  WHERE o.id = p_org_id
    AND public.is_org_member(o.id);
$$;

REVOKE ALL ON FUNCTION public.organizations_directory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organizations_directory(uuid) TO authenticated, service_role;

-- Org profile edits are manage_settings work (matches updateOrganization's
-- app-layer check since Phase 2).
DROP POLICY IF EXISTS organizations_manage ON public.organizations;
CREATE POLICY organizations_manage
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (public.has_org_capability(id, 'company.manage_settings'))
  WITH CHECK (public.has_org_capability(id, 'company.manage_settings'));

-- FOUNDER-DEFAULT: organizations DELETE moves with UPDATE onto
-- company.manage_settings (a people-only manager should not be able to delete
-- the company it cannot even edit). ROLES.md only names "org settings" for the
-- split; revisit if the founder wants delete owner-only.
DROP POLICY IF EXISTS organizations_delete ON public.organizations;
CREATE POLICY organizations_delete
  ON public.organizations
  FOR DELETE
  TO authenticated
  USING (public.has_org_capability(id, 'company.manage_settings'));

-- Column-level UPDATE split: the table-wide grant let any UPDATE-policy passer
-- patch stripe_*/entitlement_*/plan columns via PostgREST. Those columns are
-- legitimately written only by webhooks / server flows (service_role, which
-- keeps ALL). authenticated keeps exactly the company-profile surface that
-- updateOrganization writes with the user's client.
REVOKE UPDATE ON public.organizations FROM authenticated;
GRANT UPDATE (
  name,
  slug,
  legal_name,
  website_url,
  office_phone,
  address_line1,
  address_line2,
  city,
  state,
  postal_code,
  country,
  license_number,
  tax_identifier,
  logo_url,
  logo_path,
  billing_email,
  billing_contact_name,
  updated_at
) ON public.organizations TO authenticated;

-- 3g. Memberships + invites: the company.manage_team side of the unbundle ------
-- Roster rows (with capability flags and invited emails) and pending invites are
-- manage_team data. Members keep their own row for reads. BOTH reads AND writes
-- retarget onto company.manage_team: ROLES.md §5 names "membership/invite
-- policies -> company.manage_team" with no read-only qualifier, and the pre-Phase
-- 3 write policies gated on can_manage_org (= manage_team OR manage_settings), so
-- a member holding ONLY company.manage_settings could PATCH any membership row's
-- capabilities (granting itself company.manage_team/billing.manage/... straight
-- off the row that has_org_capability reads) — a write-side privilege escalation
-- that defeats the entire capability split. Retargeting the writes to
-- company.manage_team closes it. is_super_admin is kept (can_manage_org passed
-- super admin). Invite acceptance is unaffected: it runs inside SECURITY DEFINER
-- ensure_user_account, which bypasses RLS entirely; and the guarded team server
-- functions (updateTeamMember/createTeamInvite) already require
-- company.manage_team at the app layer before writing via the user client, so the
-- legitimate manage_team path still passes.

DROP POLICY IF EXISTS organization_memberships_member_read ON public.organization_memberships;
CREATE POLICY organization_memberships_member_read
  ON public.organization_memberships
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_memberships_manage_insert ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_insert
  ON public.organization_memberships
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_memberships_manage_update ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_update
  ON public.organization_memberships
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_memberships_manage_delete ON public.organization_memberships;
CREATE POLICY organization_memberships_manage_delete
  ON public.organization_memberships
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_invites_member_read ON public.organization_invites;
CREATE POLICY organization_invites_member_read
  ON public.organization_invites
  FOR SELECT
  TO authenticated
  USING (public.has_org_capability(organization_id, 'company.manage_team'));

DROP POLICY IF EXISTS organization_invites_manage_insert ON public.organization_invites;
CREATE POLICY organization_invites_manage_insert
  ON public.organization_invites
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_invites_manage_update ON public.organization_invites;
CREATE POLICY organization_invites_manage_update
  ON public.organization_invites
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

DROP POLICY IF EXISTS organization_invites_manage_delete ON public.organization_invites;
CREATE POLICY organization_invites_manage_delete
  ON public.organization_invites
  FOR DELETE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.has_org_capability(organization_id, 'company.manage_team')
  );

-- 3h. credit_ledger: raw rows -> company.manage_settings; members keep the
--     balance through a definer sum ------------------------------------------
-- Ledger rows expose Stripe checkout session references and who bought what.
-- Members only ever needed the SUM (they spend credits in takeoff flows).

DROP POLICY IF EXISTS credit_ledger_members_read ON public.credit_ledger;
CREATE POLICY credit_ledger_members_read ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.has_org_capability(organization_id, 'company.manage_settings'));

CREATE OR REPLACE FUNCTION public.get_org_credit_balance(p_org_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_org_member(p_org_id) THEN
    RAISE EXCEPTION USING errcode = '42501',
      message = 'You are not a member of this company.';
  END IF;
  RETURN COALESCE((
    SELECT SUM(l.delta)
    FROM public.credit_ledger l
    WHERE l.organization_id = p_org_id
  ), 0)::integer;
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_credit_balance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_credit_balance(uuid) TO authenticated, service_role;

-- 3i. company-assets storage bucket -> company.manage_settings -----------------
-- The company logo/branding upload lives in the company-assets bucket. Its
-- storage.objects write policies gated on can_manage_org (= manage_team OR
-- manage_settings), but the batch moved branding to company.manage_settings at
-- the API layer (src/routes/api/company/assets/logo.ts -> requireManageSettings).
-- Retarget the bucket writes to match, so a company.manage_team-only holder can
-- no longer replace/delete the company logo. is_super_admin preserved (was in
-- can_manage_org). Reads are unchanged (public bucket / existing read policy).
DROP POLICY IF EXISTS company_assets_team_insert ON storage.objects;
CREATE POLICY company_assets_team_insert
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'company-assets'
    AND (
      public.is_super_admin()
      OR public.has_org_capability(public.storage_organization_id(name), 'company.manage_settings')
    )
  );

DROP POLICY IF EXISTS company_assets_team_update ON storage.objects;
CREATE POLICY company_assets_team_update
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (
      public.is_super_admin()
      OR public.has_org_capability(public.storage_organization_id(name), 'company.manage_settings')
    )
  )
  WITH CHECK (
    bucket_id = 'company-assets'
    AND (
      public.is_super_admin()
      OR public.has_org_capability(public.storage_organization_id(name), 'company.manage_settings')
    )
  );

DROP POLICY IF EXISTS company_assets_team_delete ON storage.objects;
CREATE POLICY company_assets_team_delete
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'company-assets'
    AND (
      public.is_super_admin()
      OR public.has_org_capability(public.storage_organization_id(name), 'company.manage_settings')
    )
  );

-- ============================================================================
-- 4. Command-body capability checks
-- ============================================================================
-- The 2026-07-20 batch revoked raw client DML on the billing/invoice/payment/
-- cost-actual/subcontract tables, so their SECURITY DEFINER commands are the
-- ONLY write path and RLS never sees those writes. Each command below has its
-- public.can_manage_project(...) authorization call replaced with the module
-- helper — the single consistent style for this migration (see header).
--
-- The rewrite works from the live catalog (pg_get_functiondef) instead of
-- pasting thousands of lines of function bodies back in: the final body of
-- each command is taken as-is and only the authorization helper is swapped.
-- Replay-safe: an already-retargeted body is detected and skipped; a command
-- whose shape drifted (no can_manage_project call left) fails loudly instead
-- of guessing.
--
-- Estimate-family commands are NOT in this list: they call can_manage_estimate
-- (verified: create_estimate_line_items_atomic, the line/header/duplicate
-- commands in 20260720191111, and the takeoff commands in 20260720202000) and
-- inherit estimating.write through the section 2 helper retarget.
--
-- Kept on can_manage_project on purpose (projects.manage covers risks and
-- change orders per ROLES.md §1): create/update/delete_change_order_atomic,
-- link/unlink_change_order_exposure_atomic, link_claim_change_order_atomic,
-- create/update/delete_exposure_allocation_atomic, and
-- update_project_financial_header_atomic (its money keys already demand a
-- logged override reason after lifecycle start).

DO $phase3_swap$
DECLARE
  v_target record;
  v_fn record;
  v_def text;
  v_new_call text;
  v_found boolean;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      -- Billing lines / applications / invoices / payments / cost actuals:
      -- the canonical billing.manage surface.
      ('generate_billing_line_items_atomic',            'can_manage_billing'),
      ('apply_billing_line_item_mutations_atomic',      'can_manage_billing'),
      ('update_billing_application_retainage_atomic',   'can_manage_billing'),
      ('create_billing_application_atomic',             'can_manage_billing'),
      ('update_billing_application_atomic',             'can_manage_billing'),
      ('transition_billing_application_atomic',         'can_manage_billing'),
      ('delete_billing_application_draft_atomic',       'can_manage_billing'),
      ('create_billing_invoice_atomic',                 'can_manage_billing'),
      ('update_billing_invoice_atomic',                 'can_manage_billing'),
      ('transition_billing_invoice_atomic',             'can_manage_billing'),
      ('delete_billing_invoice_draft_atomic',           'can_manage_billing'),
      ('correct_billing_invoice_atomic',                'can_manage_billing'),
      ('append_invoice_collections_note_atomic',        'can_manage_billing'),
      ('record_invoice_payment_atomic',                 'can_manage_billing'),
      ('void_invoice_payment_atomic',                   'can_manage_billing'),
      ('refund_invoice_payment_atomic',                 'can_manage_billing'),
      ('reconcile_invoice_payment_rollup',              'can_manage_billing'),
      ('create_cost_actual_atomic',                     'can_manage_billing'),
      ('update_cost_actual_atomic',                     'can_manage_billing'),
      ('transition_cost_actual_atomic',                 'can_manage_billing'),
      ('void_cost_actual_atomic',                       'can_manage_billing'),
      ('record_cost_actual_payment_atomic',             'can_manage_billing'),
      ('import_cost_actuals_atomic',                    'can_manage_billing'),
      ('apply_production_sov_certification_to_billing', 'can_manage_billing'),
      -- FOUNDER-DEFAULT: budget/SOV bucket authority (bucket CRUD, imports,
      -- estimate->budget/SOV carries, budget lock) rides billing.manage.
      -- ROLES.md defines billing.manage as pay apps/invoices/cost actuals and
      -- never assigns "budget"; billing.manage is the money-authority default.
      ('update_cost_bucket_atomic',                     'can_manage_billing'),
      ('create_cost_bucket_atomic',                     'can_manage_billing'),
      ('delete_cost_bucket_atomic',                     'can_manage_billing'),
      ('import_cost_buckets_atomic',                    'can_manage_billing'),
      ('build_budget_from_estimate_atomic',             'can_manage_billing'),
      ('convert_estimate_to_sov_atomic',                'can_manage_billing'),
      ('lock_project_budget_atomic',                    'can_manage_billing'),
      -- FOUNDER-DEFAULT: CO allocation moves money onto SOV codes -> billing.
      -- (The CO create/edit lifecycle itself stays projects.manage.)
      ('allocate_change_order_atomic',                  'can_manage_billing'),
      ('delete_change_order_allocation_atomic',         'can_manage_billing'),
      -- FOUNDER-DEFAULT: subcontract commitments + payments are cost-side
      -- money movement -> billing.manage (transition_subcontract_payment pays
      -- real money against compliance gates — the strongest case in the set).
      ('record_subcontract_payment_atomic',             'can_manage_billing'),
      ('transition_subcontract_payment_atomic',         'can_manage_billing'),
      ('replace_subcontract_payment_allocations_atomic','can_manage_billing'),
      ('attach_lien_waiver_to_payment_atomic',          'can_manage_billing'),
      ('detach_lien_waiver_from_payment_atomic',        'can_manage_billing'),
      ('update_subcontract_payment_draft_atomic',       'can_manage_billing'),
      ('delete_subcontract_payment_draft_atomic',       'can_manage_billing'),
      ('save_subcontract_atomic',                       'can_manage_billing'),
      ('delete_untouched_subcontract_draft_atomic',     'can_manage_billing'),
      ('mutate_subcontract_allocation_atomic',          'can_manage_billing'),
      ('mutate_subcontract_change_order_atomic',        'can_manage_billing'),
      -- Schedule commands -> schedule.manage.
      ('apply_wip_schedule_progress_review',            'can_manage_schedule'),
      ('reorder_schedule_wbs_sections',                 'can_manage_schedule')
    ) AS t(fn_name, helper)
  LOOP
    v_found := false;
    v_new_call := 'public.' || v_target.helper || '(';
    FOR v_fn IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_target.fn_name
    LOOP
      v_found := true;
      v_def := pg_get_functiondef(v_fn.oid);
      IF position(v_new_call IN v_def) > 0 THEN
        CONTINUE; -- replay: this overload is already retargeted
      END IF;
      IF position('public.can_manage_project(' IN v_def) = 0 THEN
        RAISE EXCEPTION
          'authz phase 3: public.% has no public.can_manage_project( call to retarget — command shape drifted, refusing to guess',
          v_target.fn_name;
      END IF;
      EXECUTE replace(v_def, 'public.can_manage_project(', v_new_call);
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'authz phase 3: expected command public.% was not found', v_target.fn_name;
    END IF;
  END LOOP;
END
$phase3_swap$;

-- reconcile_invoice_payment_rollup grant-chain note: 20260720174000 already
-- converted the singular wrapper to SECURITY DEFINER (its own comment block,
-- "Keep the batch helper private and expose only the single-invoice,
-- capability-checked wrapper as a definer command"), which is what lets it
-- call the revoked plural batch helper. Re-asserted here so a replay of the
-- earlier files can never strand it as INVOKER after this file has run.
ALTER FUNCTION public.reconcile_invoice_payment_rollup(uuid) SECURITY DEFINER;

-- The four commands the audit flagged as having NO capability check at all.
-- These need a check ADDED (not swapped), so each gets a targeted snippet
-- rewrite of its final body — same catalog-based mechanics as above, same
-- loud failure if the body drifted.
DO $phase3_add$
DECLARE
  v_target record;
  v_fn record;
  v_def text;
  v_found boolean;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      -- create_project_financial_atomic: any active member — including a
      -- Viewer preset — could create a project carrying contract/budget
      -- dollars. Project creation is projects.manage (ROLES.md §1: "Create
      -- projects and change project data").
      ('create_project_financial_atomic',
       $old1$  if not public.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create a project in this organization.';
  end if;$old1$,
       $new1$  if not public.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create a project in this organization.';
  end if;
  -- authz phase 3: creating a project requires projects.manage, not bare membership.
  if not public.has_org_capability(p_organization_id, 'projects.manage') then
    raise exception using errcode = '42501', message = 'You do not have permission to create a project in this organization.';
  end if;$new1$,
       'has_org_capability(p_organization_id, ''projects.manage'')'),
      -- create_estimate_atomic: any active member could create estimates.
      -- Building estimates is estimating.write; the can_manage_org and
      -- super-admin branches are kept, mirroring the can_manage_estimate shape.
      ('create_estimate_atomic',
       $old2$    public.is_org_member(p_organization_id)
    or public.can_manage_org(p_organization_id)$old2$,
       $new2$    public.has_org_capability(p_organization_id, 'estimating.write')
    or public.can_manage_org(p_organization_id)$new2$,
       'has_org_capability(p_organization_id, ''estimating.write'')'),
      -- convert_pipeline_opportunity_to_project: consumes the pipeline AND
      -- creates a live project, so it requires both crm.manage and
      -- projects.manage (the task-mandated pairing).
      ('convert_pipeline_opportunity_to_project',
       $old3$  IF NOT public.is_org_member(v_opportunity.organization_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;$old3$,
       $new3$  -- authz phase 3: conversion consumes the pipeline (crm.manage) and creates a project (projects.manage).
  IF NOT (
    public.has_org_capability(v_opportunity.organization_id, 'crm.manage')
    AND public.has_org_capability(v_opportunity.organization_id, 'projects.manage')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;$new3$,
       'has_org_capability(v_opportunity.organization_id, ''crm.manage'')'),
      -- FOUNDER-DEFAULT: seed_project_award_contingency writes an IOR exposure
      -- (award contingency reserve). Exposures ride projects.manage per
      -- ROLES.md §1, so the gate is can_manage_project on the target project —
      -- which the just-created project's owner passes during conversion.
      -- service_role callers (server seams) stay allowed. Previously it had NO
      -- caller check at all: any authenticated user could seed exposure rows
      -- into any project.
      ('seed_project_award_contingency',
       $old4$  IF p_project_id IS NULL OR COALESCE(p_contract, 0) <= 0 OR COALESCE(p_pct, 0) <= 0 THEN
    RETURN;
  END IF;$old4$,
       $new4$  IF p_project_id IS NULL OR COALESCE(p_contract, 0) <= 0 OR COALESCE(p_pct, 0) <= 0 THEN
    RETURN;
  END IF;
  -- authz phase 3: exposures are project work — require projects.manage scope
  -- on the target project (or a trusted service_role caller).
  IF NOT public.can_manage_project(p_project_id)
     AND COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;$new4$,
       'can_manage_project(p_project_id)')
    ) AS t(fn_name, old_snippet, new_snippet, marker)
  LOOP
    v_found := false;
    FOR v_fn IN
      SELECT p.oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_target.fn_name
    LOOP
      v_found := true;
      v_def := pg_get_functiondef(v_fn.oid);
      IF position(v_target.marker IN v_def) > 0 THEN
        CONTINUE; -- replay: check already present
      END IF;
      IF position(v_target.old_snippet IN v_def) = 0 THEN
        RAISE EXCEPTION
          'authz phase 3: public.% no longer matches the expected authorization block — command shape drifted, refusing to guess',
          v_target.fn_name;
      END IF;
      EXECUTE replace(v_def, v_target.old_snippet, v_target.new_snippet);
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'authz phase 3: expected command public.% was not found', v_target.fn_name;
    END IF;
  END LOOP;
END
$phase3_add$;

-- ============================================================================
-- 5. Open-redirect write-side: notifications.url must be an in-app path
-- ============================================================================
-- NotificationBell navigates to notifications.url verbatim, and
-- create_notification let any org member store an arbitrary URL into a
-- teammate's inbox (authenticated open-redirect / phishing pivot). The rule,
-- enforced at write time AND as a table constraint: empty, or a single-leading-
-- slash relative path — no '//', no backslashes, no 'scheme:' prefix, and no
-- ASCII control characters (browsers strip embedded tab/CR/LF during URL parsing,
-- so '/\t/evil.com' would resolve protocol-relative — matches the app-layer
-- safeInternalPath rejection).

-- Pre-audit + repair: notification URLs are navigation hints, not evidence.
-- Any existing row that violates the rule is reported and cleared to ''.
DO $phase3_url_audit$
DECLARE
  v_bad integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.notifications
  WHERE NOT (
    url = ''
    OR (
      left(url, 1) = '/'
      AND left(url, 2) <> '//'
      AND strpos(url, chr(92)) = 0
      AND url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:'
      AND url !~ '[[:cntrl:]]'
    )
  );
  IF v_bad > 0 THEN
    RAISE NOTICE
      'authz phase 3 pre-audit: % notification row(s) carry a non-relative url; clearing to '''' (urls are navigation hints, not evidence)',
      v_bad;
    UPDATE public.notifications
    SET url = ''
    WHERE NOT (
      url = ''
      OR (
        left(url, 1) = '/'
        AND left(url, 2) <> '//'
        AND strpos(url, chr(92)) = 0
        AND url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:'
        AND url !~ '[[:cntrl:]]'
      )
    );
  ELSE
    RAISE NOTICE 'authz phase 3 pre-audit: all notification urls already conform to the relative-path rule';
  END IF;
END
$phase3_url_audit$;

DO $phase3_url_check$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_url_relative_path'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_url_relative_path CHECK (
        url = ''
        OR (
          left(url, 1) = '/'
          AND left(url, 2) <> '//'
          AND strpos(url, chr(92)) = 0
          AND url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:'
          AND url !~ '[[:cntrl:]]'
        )
      );
  END IF;
END
$phase3_url_check$;

-- Same body as 20260709120000 with exactly one addition: p_url is validated
-- against the relative-path rule before the INSERT (RAISE on violation), so a
-- forged absolute/javascript: URL is rejected at the RPC even before the
-- constraint would catch it.
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
  v_url text := COALESCE(p_url, '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_organization_id IS NULL THEN
    RAISE EXCEPTION 'org-scoped notifications only; system notices go through service_role';
  END IF;
  -- deep links are in-app paths only: empty, or a single-leading-slash
  -- relative path (no '//', no backslashes, no 'scheme:' prefix, no control chars)
  IF NOT (
    v_url = ''
    OR (
      left(v_url, 1) = '/'
      AND left(v_url, 2) <> '//'
      AND strpos(v_url, chr(92)) = 0
      AND v_url !~ '^[a-zA-Z][a-zA-Z0-9+.-]*:'
      AND v_url !~ '[[:cntrl:]]'
    )
  ) THEN
    RAISE EXCEPTION 'notification url must be an in-app path starting with a single ''/''';
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
    v_url, COALESCE(p_data, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ============================================================================
-- 6. Verification: fail the migration if any retarget silently missed
-- ============================================================================
DO $phase3_verify$
DECLARE
  v_def text;
  v_fn text;
  v_found boolean;
  v_swapped text[] := ARRAY[
    'generate_billing_line_items_atomic',
    'apply_billing_line_item_mutations_atomic',
    'update_billing_application_retainage_atomic',
    'create_billing_application_atomic',
    'update_billing_application_atomic',
    'transition_billing_application_atomic',
    'delete_billing_application_draft_atomic',
    'create_billing_invoice_atomic',
    'update_billing_invoice_atomic',
    'transition_billing_invoice_atomic',
    'delete_billing_invoice_draft_atomic',
    'correct_billing_invoice_atomic',
    'append_invoice_collections_note_atomic',
    'record_invoice_payment_atomic',
    'void_invoice_payment_atomic',
    'refund_invoice_payment_atomic',
    'reconcile_invoice_payment_rollup',
    'create_cost_actual_atomic',
    'update_cost_actual_atomic',
    'transition_cost_actual_atomic',
    'void_cost_actual_atomic',
    'record_cost_actual_payment_atomic',
    'import_cost_actuals_atomic',
    'apply_production_sov_certification_to_billing',
    'update_cost_bucket_atomic',
    'create_cost_bucket_atomic',
    'delete_cost_bucket_atomic',
    'import_cost_buckets_atomic',
    'build_budget_from_estimate_atomic',
    'convert_estimate_to_sov_atomic',
    'lock_project_budget_atomic',
    'allocate_change_order_atomic',
    'delete_change_order_allocation_atomic',
    'record_subcontract_payment_atomic',
    'transition_subcontract_payment_atomic',
    'replace_subcontract_payment_allocations_atomic',
    'attach_lien_waiver_to_payment_atomic',
    'detach_lien_waiver_from_payment_atomic',
    'update_subcontract_payment_draft_atomic',
    'delete_subcontract_payment_draft_atomic',
    'save_subcontract_atomic',
    'delete_untouched_subcontract_draft_atomic',
    'mutate_subcontract_allocation_atomic',
    'mutate_subcontract_change_order_atomic',
    'apply_wip_schedule_progress_review',
    'reorder_schedule_wbs_sections'
  ];
BEGIN
  -- 6a. every swapped command lost its can_manage_project call
  FOREACH v_fn IN ARRAY v_swapped LOOP
    v_found := false;
    FOR v_def IN
      SELECT pg_get_functiondef(p.oid)
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_fn
    LOOP
      v_found := true;
      IF position('public.can_manage_project(' IN v_def) > 0 THEN
        RAISE EXCEPTION 'authz phase 3 verify: public.% still calls can_manage_project', v_fn;
      END IF;
    END LOOP;
    IF NOT v_found THEN
      RAISE EXCEPTION 'authz phase 3 verify: public.% is missing', v_fn;
    END IF;
  END LOOP;

  -- 6b. the estimating lever really moved
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'can_manage_estimate';
  IF v_def IS NULL
     OR position('estimating.write' IN v_def) = 0
     OR position('is_org_member' IN v_def) > 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: can_manage_estimate was not retargeted onto estimating.write';
  END IF;

  -- 6c. the four added checks are present
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_project_financial_atomic';
  IF v_def IS NULL OR position('projects.manage' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: create_project_financial_atomic lacks the projects.manage check';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_estimate_atomic';
  IF v_def IS NULL OR position('estimating.write' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: create_estimate_atomic lacks the estimating.write check';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'convert_pipeline_opportunity_to_project';
  IF v_def IS NULL
     OR position('crm.manage' IN v_def) = 0
     OR position('projects.manage' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: convert_pipeline_opportunity_to_project lacks the crm.manage + projects.manage pair';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'seed_project_award_contingency';
  IF v_def IS NULL OR position('can_manage_project(p_project_id)' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: seed_project_award_contingency lacks its caller check';
  END IF;

  -- 6d. the reconcile wrapper is a definer command (grant-chain fix)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'reconcile_invoice_payment_rollup'
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: reconcile_invoice_payment_rollup is not SECURITY DEFINER';
  END IF;

  -- 6e. the notification url constraint exists
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_url_relative_path'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: notifications_url_relative_path constraint is missing';
  END IF;

  -- 6f. the notification url rule rejects ASCII control characters
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'create_notification';
  IF v_def IS NULL OR position('[[:cntrl:]]' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: create_notification does not reject control-char urls';
  END IF;

  -- 6g. the CRM teammate-assignment definer helper exists (blocker fix)
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'user_is_active_org_member' AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: user_is_active_org_member SECURITY DEFINER helper is missing';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('crm_followup_enrollments','crm_meeting_briefs','crm_onboarding_plans','crm_onboarding_tasks')
      AND coalesce(with_check, '') LIKE '%organization_memberships%'
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: a CRM write policy still probes organization_memberships directly (starves post-3g)';
  END IF;

  -- 6h. membership/invite writes moved onto company.manage_team (priv-esc fix)
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN ('organization_memberships','organization_invites')
      AND cmd <> 'SELECT'
      AND (coalesce(qual, '') LIKE '%can_manage_org%' OR coalesce(with_check, '') LIKE '%can_manage_org%')
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: a membership/invite write policy still gates on can_manage_org (manage_settings escalation open)';
  END IF;

  -- 6i. estimates base-table UPDATE rides the estimating.write lever
  SELECT coalesce(qual, '') INTO v_def FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'estimates' AND policyname = 'estimates_org_update';
  IF v_def IS NULL OR position('can_manage_estimate' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: estimates_org_update was not retargeted onto can_manage_estimate';
  END IF;

  -- 6j. cost_library price-history INSERT rides cost_library.write
  SELECT coalesce(with_check, '') INTO v_def FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'cost_library_price_history'
    AND policyname = 'cost_library_price_history_org_insert';
  IF v_def IS NULL OR position('can_write_cost_library' IN v_def) = 0 THEN
    RAISE EXCEPTION 'authz phase 3 verify: cost_library_price_history INSERT was not retargeted onto can_write_cost_library';
  END IF;

  -- 6k. the redundant cost_buckets owner FOR-ALL policy is gone
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'cost_buckets'
      AND policyname = 'cost_buckets_owner_via_project'
  ) THEN
    RAISE EXCEPTION 'authz phase 3 verify: redundant cost_buckets_owner_via_project policy was not dropped';
  END IF;
END
$phase3_verify$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- G. profiles co-member visibility repair.
--
-- profiles_self_read proved co-membership with a plain EXISTS join on
-- organization_memberships. Section C tightened memberships SELECT to
-- self-or-manage_team, and RLS applies inside policy subqueries — so the
-- co-member branch silently starved for plain members, hiding teammate names
-- across daily reports, decisions, and rosters. Co-membership is not
-- sensitive; the flags on the membership row are. A SECURITY DEFINER
-- existence check exposes exactly the boolean and nothing else.
-- ============================================================================

create or replace function public.shares_org_with (target_user uuid) returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = target_user
      and theirs.status = 'active'
  );
$$;

revoke all on function public.shares_org_with (uuid)
from public, anon;

grant execute on function public.shares_org_with (uuid)
to authenticated, service_role;

drop policy if exists profiles_self_read on public.profiles;

create policy profiles_self_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or public.shares_org_with (id)
  or public.is_super_admin ()
);
