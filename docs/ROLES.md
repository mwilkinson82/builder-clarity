# Overwatch Roles & Privileges — Capabilities with Role Presets

**Audience:** beta testers and the founder, plus a technical appendix for engineers.
**Status:** describes the system as of Roles Phase 2 (2026-07-03). Phase 1 was a
read-only audit of what the role labels actually enforced; Phase 2 implements the
founder's decisions from that audit. History: `docs/phases/ROLESPHASE2.md`; the full
Phase 1 audit text lives in this file's git history at merge `343e56d`.

**One-sentence summary:** permissions are now explicit per-person **capabilities**
(checkboxes on the Company screen); role names like "Project Manager" are **presets**
that pre-fill those checkboxes and remain as display labels — an admin can see exactly
what a label grants and can adjust any individual.

---

## 1. The capability model

Every company member carries an explicit set of capability flags, stored on their
membership row (`organization_memberships.capabilities`). What a person can do is
decided by their flags — not by their role name.

| Group | Capability | Plain meaning |
|---|---|---|
| **Projects** | `projects.view_assigned` — *See assigned projects* | Open the projects this person has been added to. |
| | `projects.view_all` — *Access all company projects* | See every project in the company, not just assigned ones. |
| | `projects.manage` — *Edit project work* | Create projects and change project data: risks, change orders, daily logs, decisions. |
| **Money** | `financials.view` — *See financials* | See dollar amounts: contract values, cost budgets, margins, billing totals. |
| | `billing.manage` — *Run billing* | Create and edit pay applications, invoices, and cost actuals. |
| **Estimating** | `estimating.write` — *Build estimates* | Create and edit estimates, takeoffs, and plan room drawings. |
| | `cost_library.write` — *Edit cost library* | Change the shared cost library and markup defaults everyone prices from. |
| **Schedule & sales** | `schedule.manage` — *Build schedules* | Create and update project schedules and delay records. |
| | `crm.manage` — *Work the pipeline* | Add and edit leads, opportunities, and follow-ups in the sales pipeline. |
| **Company** | `company.manage_team` — *Manage people* | Invite people, change roles and access, disable accounts. |
| | `company.manage_settings` — *Manage company settings* | Edit the company profile, logo, and billing setup. |
| | `client_portal.manage` — *Manage client access* | Give clients read-only access to their project, or take it away. |

Source of truth: `public.role_preset_capabilities()` in
`supabase/migrations/20260703070000_roles_capabilities_foundation.sql`, mirrored by
`src/lib/capabilities.ts` (kept in lockstep by `npm run test:roles`).

### Role presets

Choosing a role in the UI **pre-fills** the checkboxes with that role's preset. Any
manual change afterward marks the member **"Custom (based on \<preset\>)"** so nobody
has to guess what a label means.

| Preset | Pre-fills |
|---|---|
| **Owner** | Everything. Owner access can't be edited on the Company screen. |
| **Admin** | Everything. |
| **Executive** | See assigned + all projects, see financials — **edit nothing** (founder decision). |
| **Project manager** | See assigned projects, edit project work, see financials, run billing, build estimates, build schedules, work the pipeline, manage client access. **Assigned projects only** by default — "Access all company projects" is the explicit extra checkbox for broader PMs (founder decision). |
| **Company member** | See assigned projects, see financials, build estimates, work the pipeline. Project-level edit rights come from per-project assignments. |
| **Viewer** | See assigned projects. **Read-only, no financials** (founder decision). |

### Per-project roles (unchanged)

Project assignments still exist and still matter: someone added to a project as
project **owner / manager / editor** can edit that project; a project **viewer** can
only read it. Capabilities are company-level; assignments are per-project. A person
needs *See assigned projects* for an assignment to grant anything.

### What existing people got at cutover (the seed)

The migration seeded every existing member's capabilities to **what their role
actually granted before** — the cutover changes nobody's effective access. That means
two groups intentionally hold more than their new preset until the founder tightens
them person-by-person from the Company screen (they display as "Custom (based on …)"):

- **Existing executives** kept the full set (their role behaved exactly like
  owner/admin before), while the new Executive preset is view-only.
- **Existing project managers** kept *Access all company projects* — before Phase 2,
  PMs could **write** to every company project (audit Finding 1), so the seed also
  grants the matching read. New PM invites default to assigned-only.

Two deliberate, documented behavior notes at cutover (proven and pinned by
`npm run test:roles`):

1. **PMs gained read** on unassigned company projects — they could already write to
   them; write-without-read was the Phase 1 headline finding, closed here in the
   widening direction with the founder tightening afterward.
2. **Disabled company members no longer keep access** through leftover active project
   assignments. The old helpers skipped the company-membership check on the
   assignment branch; the capability lookup requires an ACTIVE membership row.
   Disabled now means locked out, matching what the Team screen always displayed.

---

## 2. How enforcement works

Every table sits behind Postgres Row-Level Security (RLS). The policies call a small
set of helper functions, and in Phase 2 those helpers read **capabilities** instead of
role names — with unchanged signatures, so **no policy was touched**:

- `can_read_project` → *Access all company projects*, or *See assigned projects* +
  an active assignment (project owner and super admin always pass).
- `can_manage_project` → *Edit project work* scoped by the person's visibility, or a
  per-project owner/manager/editor assignment.
- `can_manage_org` → *Manage people* **or** *Manage company settings* (see
  granularity note below).
- `is_org_member` → still "is an active member of the company," on purpose — it
  gates module reads that every member keeps.
- `can_view_financials` (new) → *See financials* on a readable project. Not yet
  called by any policy; ready for Phase 3.
- `has_org_capability(org, capability)` (new) → the generic check the app calls for
  capability-specific gating (e.g. the Company screen).

### Enforcement granularity this phase (important, honest note)

The database enforces at the resolution of those shared helpers. Because module
policies still call `is_org_member` / `can_manage_project` / `can_manage_org` exactly
as before, these capabilities are **recorded, shown, and used by the app UI, but not
yet independently enforced by RLS**:

- `estimating.write`, `crm.manage` — any active member can still write those modules
  at the DB level (as before Phase 2), whatever the checkbox says.
- `cost_library.write` — cost-library edits still follow `can_manage_org`.
- `billing.manage`, `schedule.manage`, `client_portal.manage` — these ride on
  `projects.manage` (via `can_manage_project`) at the DB level.
- `financials.view` — dollar visibility still follows project read at the DB level.
- `company.manage_team` vs `company.manage_settings` — the DB treats them as one
  bundle (either passes `can_manage_org`); the app distinguishes them (team edits
  require *Manage people*, company-profile edits require *Manage company settings*).

Unchecking one of those boxes is a statement of intent the app respects, but a
determined user with API access is still bounded only by the coarser helper until the
**Phase 3 policy split** retargets each module's policies onto its own capability.
This is the main open item — see §5.

---

## 3. Capability matrix (what each flag opens today)

"App" = enforced by the screens and server functions. "DB" = enforced by RLS for any
API access. ✅ = enforced at that layer today; 🔶 = follows a coarser flag at that
layer until Phase 3 (noted).

| Capability | App | DB | DB notes |
|---|---|---|---|
| See assigned projects | ✅ | ✅ | assignment + this flag; includes IOR, schedule, billing reads on those projects |
| Access all company projects | ✅ | ✅ | company-wide read |
| Edit project work | ✅ | ✅ | scoped to visible projects; per-project editor assignments also grant it per project |
| See financials | ✅ | 🔶 | DB: follows project read until Phase 3 |
| Run billing | ✅ | 🔶 | DB: follows *Edit project work* |
| Build estimates | ✅ | 🔶 | DB: any active member (as pre-Phase-2) |
| Edit cost library | ✅ | 🔶 | DB: follows the company-manage bundle |
| Build schedules | ✅ | 🔶 | DB: follows *Edit project work* |
| Work the pipeline | ✅ | 🔶 | DB: any active member (as pre-Phase-2) |
| Manage people | ✅ | 🔶 | DB: bundled with *Manage company settings* |
| Manage company settings | ✅ | 🔶 | DB: bundled with *Manage people* |
| Manage client access | ✅ | 🔶 | DB: follows *Edit project work* |

### Guard rails on the Company screen

- Only people with *Manage people* can change access; everyone else sees the roster
  read-only with a banner explaining why.
- **Nobody can edit an Owner's access** (server-enforced, not just hidden).
- **Nobody can remove their own *Manage people*** — no locking yourself out from the
  screen you're standing on (server-enforced).
- Every company keeps at least one active owner (unchanged rule).
- The invite form carries the same preset picker + checkboxes; the chosen flags are
  copied onto the membership when the invite is accepted.

### Super Admin and clients (unchanged)

- **Super admin** (Overwatch staff): `is_super_admin()` — the `app_super_admins`
  table or the two recovery emails. Passes every helper. The `/admin` page now asks
  this same database function — the separate client-side email list is deleted
  (Phase 1 Finding 8, resolved).
- **Clients** see a single project read-only through the Client Portal, controlled by
  three per-project switches (Change orders / Daily reports / Billing) — a separate
  mechanism from company capabilities, unchanged in Phase 2.

---

## 4. Findings status (from the Phase 1 audit)

| # | Finding | Status |
|---|---|---|
| 1 | PM could write projects it couldn't see | **Resolved.** Read/write now share one scoping rule; existing PMs seeded to all-projects (matching their real prior access), new PMs default to assigned-only; founder tightens individuals in the UI. |
| 2 | `member` ≡ `viewer`; viewer wasn't read-only | **Resolved at the model + app layer.** Viewer preset is read-only-no-financials; DB-level estimating/CRM write enforcement lands with the Phase 3 policy split (§2 note). |
| 3 | Estimating write company-wide vs Cost Library manager-only | **Now explicit** as two separate capabilities (`estimating.write`, `cost_library.write`); DB split lands in Phase 3. |
| 4 | CRM had no DELETE policy | **Confirmed by design** — CRM batch 1 shipped delete-as-archive deliberately. |
| 5 | Dead `holds` table with owner-only policy | **Still open** (IOR-territory cleanup; unused, no live impact). |
| 6, 7 | Append-only tables / service-role-only tables | **By design**, documented. |
| 8 | Two disagreeing admin lists | **Resolved.** `/admin` gate and admin server functions ask `is_super_admin()`; `src/lib/admin-access.ts` is deleted. |
| 9 | Super admin can't delete companies | **By design**, unchanged. |
| 10 | Founder emails hard-coded in `is_super_admin()` | **Still open** (deliberate recovery backdoor; revisit when `app_super_admins` tooling exists). |
| 11 | UI shows buttons RLS will reject | **Improved** on the Company screen (capability-aware gating); other modules unchanged until Phase 3. |

## 5. Phase 3 agenda

1. **Policy split** — retarget module policies onto their capabilities:
   estimating/plan-room writes → `estimating.write`; CRM writes → `crm.manage`;
   cost library → `cost_library.write`; billing writes → `billing.manage`; schedule
   writes → `schedule.manage`; client-access management → `client_portal.manage`;
   financial SELECTs → `can_view_financials`; membership/invite policies →
   `company.manage_team`; org settings → `company.manage_settings`. Each is a
   migration with a parity-test extension.
2. Decide the fate of the hard-coded recovery emails in `is_super_admin()`
   (Finding 10).
3. Drop the dead `holds` table (Finding 5, IOR territory).
4. Module UIs (estimating, CRM, billing, schedule) read the capability flags to
   hide/disable what the DB will start rejecting after the split.

---

## Appendix — technical detail

### A. Storage

- `organization_memberships.capabilities jsonb NOT NULL DEFAULT '{}'` — object of
  boolean flags; only `true` keys stored. `role public.account_role` stays as the
  preset identity / display label.
- `organization_invites.capabilities jsonb NOT NULL DEFAULT '{}'` — flags chosen at
  invite time; empty = "use the role preset on acceptance."
- `tg_membership_capabilities_default` (BEFORE INSERT OR UPDATE): any membership row
  inserted without explicit flags gets `role_preset_capabilities(role)`, so
  trigger-created rows (project owners, signup, email-key repairs) are never
  flag-less. On UPDATE only `NULL` is repaired — an explicit `{}` means "no
  capabilities."
- Seed (idempotent, `WHERE capabilities = '{}'`): owner/admin/executive → full set;
  project_manager → PM preset + `projects.view_all`; member/viewer → their presets.

### B. Helper functions (final definitions, Phase 2)

| Function | Returns true when (all require a signed-in user; super admin always passes) |
|---|---|
| `has_org_capability(org, cap)` | active membership whose `capabilities @> {cap: true}` |
| `is_org_member(org)` | active membership (any flags) — deliberately NOT capability-based this phase |
| `can_manage_org(org)` | active membership with `company.manage_team` OR `company.manage_settings` |
| `can_read_project(p)` | project owner; or `projects.view_all`; or `projects.view_assigned` + active `project_memberships` row |
| `can_manage_project(p)` | project owner; or `projects.manage` AND (`projects.view_all` OR assigned); or `projects.view_assigned` + assignment with project role owner/manager/editor |
| `can_view_financials(p)` | project owner; or `financials.view` AND `can_read_project(p)` — not yet used by any policy |
| `is_super_admin()` | unchanged: `app_super_admins` row or the two recovery emails |
| `role_preset_capabilities(role)` | IMMUTABLE preset map (see §1) |
| `ensure_user_account(...)` | unchanged except membership writes now carry capabilities: invite acceptance copies the invite's flags (falling back to the role preset); owner-repair conflict branches upgrade capabilities with the same owner/admin guard the role column already had |

All are `SECURITY DEFINER`, `STABLE`, `SET search_path = public`, `EXECUTE` granted
to `authenticated` only (plus `service_role`). **No RLS policy was created, dropped,
or altered in Phase 2** — `npm run test:roles` pins this.

### C. Behavior-preservation proof

`scripts/roles-capability-parity-smoke.ts` (`npm run test:roles`):

- replays old-helper vs new-helper logic across the full grid of role × org-status ×
  assignment × project-role × project-ownership (540 checks) and fails on any
  divergence outside the two declared exceptions (§1), asserting both exceptions
  occur exactly where declared;
- asserts the SQL presets in `role_preset_capabilities()` equal `ROLE_PRESETS` in
  `src/lib/capabilities.ts` key-for-key, per role;
- pins the seed's idempotence guard, the PM `view_all` seed, invite-capability
  propagation, and the no-policy-changes invariant.

### D. App-layer gating map

- `getTeamWorkspace` returns each member's effective capabilities (explicit flags,
  or the seed mapping as a fallback until the migration is applied), plus
  `canManageTeam` / `canManageSettings` / `isSuperAdmin` for the current user.
- `updateTeamMember`: requires `company.manage_team` (via `has_org_capability`,
  falling back to `can_manage_org` pre-migration); rejects edits to owner-role rows
  and self-removal of `company.manage_team`; a role change without explicit flags
  applies that role's preset.
- `createTeamInvite`: requires `company.manage_team`; stores the picker's flags on
  the invite (column-missing fallback keeps invites working pre-migration).
- `updateOrganization`: requires `company.manage_settings`.
- `/admin` route + `getOverwatchAdminWorkspace`: `is_super_admin()` via server check;
  `src/lib/admin-access.ts` deleted.
- Estimating, Schedule, CRM, Billing screens: unchanged this phase; they continue to
  rely on RLS and will adopt capability-aware gating with the Phase 3 split.

### E. RLS policy inventory

Unchanged from Phase 1 — see the per-table policy inventory in the Phase 1 version of
this file (git history, merge `343e56d`). Phase 2 changed helper *bodies* only.
