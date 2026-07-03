# ROLESPHASE2.md — Capabilities with Role Presets (Claude Code task spec)

Read AGENTS.md. You are on the **auth/membership** seam plus the team
management UI. Branch: `auth/roles-phase2-capabilities`. Estimating/CPM/CRM
feature code stays untouched. **This phase WILL carry migrations — file only,
flagged loudly, applied via the established protocol BEFORE merge. Do not
merge without that step.**

Founder decisions this implements (from docs/ROLES.md open questions):
- Permissions become explicit per-member CAPABILITIES (checkboxes) grouped by
  module; role labels remain as PRESETS that pre-fill the checkboxes and as
  display labels. Admins see exactly what a label grants and can adjust any
  individual.
- PM preset defaults to ASSIGNED projects (manage + read assigned), with an
  "Access all company projects" capability for broader PMs — this fixes
  Finding: PMs could write org-wide but read only assigned.
- Executive preset = view everything including financials, edit nothing.
  Viewer preset = read-only on assigned projects, no financials.
- Estimating write and Cost Library write are separate capabilities.
- Finding 8: the client /admin gate must ask is_super_admin() — delete the
  client-side email list.

## Task 0 — The capability model (keep it small)
Define ~12 capabilities, grouped, with plain-contractor-language names and
one-line descriptions (these render in the UI):
projects.view_assigned, projects.view_all, projects.manage,
financials.view (costs/margins/IOR dollars), billing.manage,
estimating.write, cost_library.write, schedule.manage, crm.manage,
company.manage_team, company.manage_settings, client_portal.manage.
Derive the exact list from docs/ROLES.md's capability matrix — every
distinct thing the helpers actually gate today must map to a capability.
Document the model at the top of an updated docs/ROLES.md.

## Task 1 — Storage + behavior-preserving seed (MIGRATION)
- `capabilities jsonb NOT NULL DEFAULT '{}'` on organization_memberships
  (project_memberships keeps assignment; capabilities are org-level).
- Seed migration: every existing member's capabilities = what their CURRENT
  role effectively grants per the audit (owner/admin/executive → full set;
  project_manager → today's actual behavior INCLUDING projects.view_all+
  manage to preserve behavior — the founder will tighten individuals in the
  UI afterward; member/viewer → today's read set). The cutover must change
  NOBODY's effective access. State this invariant in the PR.
- Role label column stays (display + preset identity).

## Task 2 — Enforcement swap (MIGRATION)
Rewrite the ~5 helper functions (is_org_member, can_manage_org,
can_manage_project, can_read_project, and financial-view checks if distinct)
to read capabilities, preserving signatures so all existing RLS policies
stand unchanged. Server functions that check roles directly switch to the
same helpers. Add a policy test file asserting the seeded capabilities
produce identical access to the pre-migration role behavior for each role
value (the behavior-preservation proof).

## Task 3 — Team management UI
On the company team screen: each member shows role preset dropdown (Owner,
Admin, Executive, Project Manager, Member, Viewer) + the capability
checkboxes with their plain-language descriptions. Choosing a preset fills
the boxes (visibly); any manual change marks the member "Custom (based on
PM)". Only company.manage_team holders can edit; nobody can edit the owner
or remove their own manage_team. Invite flow gets the same picker.

## Task 4 — Finding 8: one admin list
The /admin client gate calls is_super_admin() (via a server check) instead
of its hardcoded email. Delete the client-side list.

## Task 5 — Documentation + validate
Regenerate docs/ROLES.md sections to describe the capability model, preset
definitions, and the (now empty or reduced) findings list. Full gate +
phase0 smoke + the new policy tests. PR titled `Roles Phase 2: capabilities
with role presets`, ALL migrations listed loudly for pre-merge application.
Commit this file to docs/phases/.
