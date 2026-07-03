-- ============================================================================
-- ROLES PHASE 2 (1 of 2): capability storage + behavior-preserving seed
-- ============================================================================
-- Permissions become explicit per-member CAPABILITIES stored as jsonb on the
-- company membership row. Role labels stay as display labels and as PRESETS
-- that pre-fill the capability set. This migration only adds storage, the
-- preset source of truth, a default-fill trigger, and the seed for existing
-- rows. Enforcement swaps to capabilities in the companion migration
-- 20260703070100_roles_capability_enforcement.sql.
--
-- SEED INVARIANT (stated in the PR): for every capability that is enforced
-- in this phase (projects.view_assigned / view_all / manage and the two
-- company.* capabilities), the seeded values grant EXACTLY what each row's
-- current role grants today — nobody's effective access changes at cutover.
-- Two deliberate, documented exceptions to note:
--   * project_manager rows are seeded WITH projects.view_all so that PMs who
--     today can WRITE to every company project (audit Finding 1) can now also
--     SEE them — the founder tightens individual PMs in the UI afterward.
--   * estimating.write / crm.manage / cost_library.write / billing.manage /
--     schedule.manage / financials.view / client_portal.manage are NOT yet
--     enforced by RLS in this phase (their tables still gate on
--     is_org_member / can_manage_project as before), so their seeded values
--     encode the new preset INTENT for member/viewer rows without changing
--     anyone's live access.
-- ============================================================================

-- 1. Capability storage --------------------------------------------------------

ALTER TABLE public.organization_memberships
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.organization_invites
  ADD COLUMN IF NOT EXISTS capabilities jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.organization_memberships.capabilities IS
  'Explicit per-member capability flags (jsonb object of booleans). The role column remains as the display label / preset identity. Keys: projects.view_assigned, projects.view_all, projects.manage, financials.view, billing.manage, estimating.write, cost_library.write, schedule.manage, crm.manage, company.manage_team, company.manage_settings, client_portal.manage.';

COMMENT ON COLUMN public.organization_invites.capabilities IS
  'Capability flags chosen at invite time; copied onto the membership on acceptance. Empty object means "use the role preset".';

-- 2. Role presets: the single source of truth for what a role label pre-fills --

CREATE OR REPLACE FUNCTION public.role_preset_capabilities(p_role public.account_role)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_role
    -- Owner / Admin: everything.
    WHEN 'owner' THEN jsonb_build_object(
      'projects.view_assigned', true,
      'projects.view_all', true,
      'projects.manage', true,
      'financials.view', true,
      'billing.manage', true,
      'estimating.write', true,
      'cost_library.write', true,
      'schedule.manage', true,
      'crm.manage', true,
      'company.manage_team', true,
      'company.manage_settings', true,
      'client_portal.manage', true
    )
    WHEN 'admin' THEN jsonb_build_object(
      'projects.view_assigned', true,
      'projects.view_all', true,
      'projects.manage', true,
      'financials.view', true,
      'billing.manage', true,
      'estimating.write', true,
      'cost_library.write', true,
      'schedule.manage', true,
      'crm.manage', true,
      'company.manage_team', true,
      'company.manage_settings', true,
      'client_portal.manage', true
    )
    -- Executive (founder decision): sees everything including financials,
    -- edits nothing.
    WHEN 'executive' THEN jsonb_build_object(
      'projects.view_assigned', true,
      'projects.view_all', true,
      'financials.view', true
    )
    -- Project Manager (founder decision): manages ASSIGNED projects by
    -- default; "Access all company projects" (projects.view_all) is a
    -- separate checkbox for broader PMs.
    WHEN 'project_manager' THEN jsonb_build_object(
      'projects.view_assigned', true,
      'projects.manage', true,
      'financials.view', true,
      'billing.manage', true,
      'estimating.write', true,
      'schedule.manage', true,
      'crm.manage', true,
      'client_portal.manage', true
    )
    -- Member: works estimating and the pipeline, sees assigned projects with
    -- their financials; project-level edit rights come from per-project
    -- assignments (project owner/manager/editor).
    WHEN 'member' THEN jsonb_build_object(
      'projects.view_assigned', true,
      'financials.view', true,
      'estimating.write', true,
      'crm.manage', true
    )
    -- Viewer (founder decision): read-only on assigned projects, no
    -- financials.
    WHEN 'viewer' THEN jsonb_build_object(
      'projects.view_assigned', true
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.role_preset_capabilities(public.account_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.role_preset_capabilities(public.account_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.role_preset_capabilities(public.account_role) TO service_role;

-- 3. Default-fill trigger -------------------------------------------------------
-- Every code path that inserts a membership row without explicit capabilities
-- (project-owner triggers, ensure_user_account, email-key repairs, future
-- seeders) gets the role preset automatically, so no row can end up with an
-- empty capability set by accident. On UPDATE only a NULL is repaired: an
-- explicit empty object chosen through the UI means "no capabilities".

CREATE OR REPLACE FUNCTION public.tg_membership_capabilities_default()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.capabilities IS NULL OR NEW.capabilities = '{}'::jsonb THEN
      NEW.capabilities := public.role_preset_capabilities(NEW.role);
    END IF;
  ELSIF NEW.capabilities IS NULL THEN
    NEW.capabilities := public.role_preset_capabilities(NEW.role);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS organization_memberships_capabilities_default
  ON public.organization_memberships;
CREATE TRIGGER organization_memberships_capabilities_default
  BEFORE INSERT OR UPDATE ON public.organization_memberships
  FOR EACH ROW EXECUTE FUNCTION public.tg_membership_capabilities_default();

-- 4. Behavior-preserving seed for existing memberships --------------------------
-- Only rows still carrying the empty default are touched, so a replay of this
-- migration never overwrites capability edits made after cutover.

UPDATE public.organization_memberships
SET capabilities = CASE
  -- Today owner, admin, and executive are indistinguishable in every policy
  -- (all three are the can_manage_org set): seed all three with the FULL set.
  -- Existing executives therefore keep today's full access and will show as
  -- "Custom (based on Executive)" until the founder re-applies the narrower
  -- Executive preset per person.
  WHEN role IN ('owner', 'admin', 'executive')
    THEN public.role_preset_capabilities('owner'::public.account_role)
  -- Today PMs can write to EVERY company project (audit Finding 1): seed the
  -- PM preset PLUS projects.view_all so cutover changes nobody's access. The
  -- founder tightens individual PMs from the team screen afterward.
  WHEN role = 'project_manager'
    THEN public.role_preset_capabilities('project_manager'::public.account_role)
         || jsonb_build_object('projects.view_all', true)
  -- Member / viewer: seed the presets. Their DB-enforced access (read
  -- assigned projects; project-level edit via per-project roles) is identical
  -- before and after.
  ELSE public.role_preset_capabilities(role)
END
WHERE capabilities = '{}'::jsonb;
