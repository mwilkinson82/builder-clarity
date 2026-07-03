# Overwatch Roles & Privileges — Phase 1 Audit

**Audience:** beta testers and the founder, plus a technical appendix for engineers.
**Status:** Audit of what the system *actually enforces* today (2026-07-03), read from
the database policies and server code — not from what any screen or spec says it
*should* do. Where the two disagree, that disagreement is written down in
[Findings](#findings), not smoothed over.

**One-sentence summary:** Overwatch has six company roles and four project roles on
paper, but the rules that actually run collapse them into **three real permission
levels for the company** and **two for a project** — and a handful of gaps and
surprises (listed in Findings) are the reason this phase exists.

> **How enforcement works.** Every table lives behind Postgres Row-Level Security
> (RLS). A signed-in user only ever sees or changes rows the database's policies
> allow, no matter what the app screen offers. A small set of helper functions
> (`is_org_member`, `can_manage_org`, `can_read_project`, `can_manage_project`,
> `is_super_admin`) decide those answers, and almost every policy calls one of them.
> The screens mostly do **not** hide buttons by role — they show the buttons and let
> the database reject the action. So "what a role can do" is decided in the database.

---

## 1. The roles, in plain language

### Company (account) roles
Every person belongs to a **company** (an "organization") with exactly one company
role. The enum has six values, but only three distinct privilege levels actually
exist once you follow the rules:

| Role you can be assigned | What it actually grants today | Real level |
|---|---|---|
| **Owner** | Full control of the company: edit company profile, invite/remove people, change anyone's role, see and manage **every** project in the company. | **Company Manager** |
| **Admin** | Identical to Owner in every database rule. (The only practical difference: the app won't let you remove the *last* owner.) | **Company Manager** |
| **Executive** | Identical to Owner/Admin in every database rule. | **Company Manager** |
| **Project Manager** | Can **create and change** work on **any** project in the company, but can only **see** projects they've been added to. (This split is a real inconsistency — see [Finding 1](#finding-1--project-manager-can-change-projects-it-cannot-see).) Can also use Estimating, Cost Library, and CRM like any member. | **Project Manager** (its own level) |
| **Member** | Can use Estimating, Cost Library, and CRM (create/edit), and can create new projects. Has **no** company-management power and **no** company-wide project access. | **Company Member** |
| **Viewer** | **Identical to Member in every database rule** — despite the name, a "viewer" can create and edit estimates, cost-library entries, CRM opportunities, and new projects. See [Finding 2](#finding-2--member-and-viewer-are-identical-viewer-is-not-read-only). | **Company Member** |

**The three real company levels:** Company Manager (owner = admin = executive) →
Project Manager → Company Member (member = viewer).

### Project (per-project) roles
Separately, a person can be added to an individual **project** with one of four
project roles. This is how someone who is only a "member" of the company gets access
to a specific job.

| Project role | What it grants on that one project | Real level |
|---|---|---|
| **Owner** | View + create/edit/delete everything on the project. | **Project Editor** |
| **Manager** | Same as Owner in every database rule. | **Project Editor** |
| **Editor** | Same as Owner/Manager in every database rule. | **Project Editor** |
| **Viewer** | **View only** — can open the project and read everything, but cannot change anything. | **Project Viewer** |

**The two real project levels:** Project Editor (owner = manager = editor) →
Project Viewer.

### Super Admin (Overwatch staff)
A separate, cross-company god-mode used by Overwatch itself (the founder). A super
admin can read and manage **every** company and **every** project. It is deliberately
kept *outside* the company-role system so that no company role can escalate into it.
Two things grant it (either one is enough): being listed in the `app_super_admins`
table, **or** signing in with one of two hard-coded founder emails. See
[Finding 8](#finding-8--two-different-admin-lists-that-disagree) and the appendix.

### Client (external, per project)
People outside the company — the building's owner/client — can be given **read-only**
access to a single project through the Client Portal. Their access is controlled by
three independent switches (Change Orders, Daily Reports, Billing) and they may
approve or reject a change order. They can never create or edit project data. This is
a separate mechanism from company/project roles (`project_client_access`), not a
company role.

---

## 2. Capability matrix (what actually happens)

Read this as: **can this role perform this verb, as enforced by the database today.**
"Company Manager" = owner/admin/executive. "Project Editor" = project owner/manager/editor.
Table and policy names backing every cell are in the [Appendix](#appendix--technical-detail).

Legend: ✅ yes · ⛔ no · 🔵 only on projects they're specifically assigned to · 🟡 see note.

### Projects / IOR (the project workspace: exposures, change orders, cost buckets, decisions, reviews, daily reports, inspections)

| | Company Manager | Project Manager | Company Member / Viewer | Project Editor* | Project Viewer* | Super Admin | Client |
|---|---|---|---|---|---|---|---|
| View a project | ✅ (all) | 🔵 assigned only | 🔵 assigned only | ✅ | ✅ | ✅ (all) | 🟡 read-only, if granted |
| Create a new project | ✅ | ✅ | ✅ | — | — | ✅ | ⛔ |
| Edit project data | ✅ (all) | 🟡 **all** (see Finding 1) | 🔵 assigned only | ✅ | ⛔ | ✅ | ⛔ |
| Delete / archive project | ✅ (all) | 🟡 **all** (see Finding 1) | 🔵 assigned only | ✅ | ⛔ | ✅ | ⛔ |

\*Project Editor/Viewer = the per-project role, which is how a Company Member gets
onto a specific job. A Company Member with no project assignment sees no projects.

### Estimating & Plan Room (estimates, line items, plan sheets, takeoffs)

| | Company Manager | Project Manager | Company Member / Viewer | Super Admin |
|---|---|---|---|---|
| View | ✅ | ✅ | ✅ | ✅ |
| Create | ✅ | ✅ | ✅ | ✅ |
| Edit | ✅ | ✅ | ✅ | ✅ |
| Delete | ✅ | ✅ | ✅ | ✅ |

Estimating is **fully collaborative for everyone in the company** — every company
role, viewer included, can create, edit, and delete estimates. (See
[Finding 3](#finding-3--estimating-write-access-is-company-wide-cost-library-is-not).)

### Cost Library (shared cost items + estimate markup defaults)

| | Company Manager | Project Manager | Company Member / Viewer | Super Admin |
|---|---|---|---|---|
| View | ✅ | ✅ | ✅ | ✅ |
| Create a cost item | ✅ | ✅ | ✅ | ✅ |
| Edit / delete a cost item | ✅ | ⛔ | ⛔ | ✅ |
| Edit markup defaults | ✅ | ⛔ | ⛔ | ✅ |
| Edit/delete a **system** cost item | ⛔ | ⛔ | ⛔ | ⛔ |

Anyone can add to the cost library; only Company Managers can change or remove
existing entries. Built-in "system" items are locked to everyone.

### Schedule (CPM activities, WBS, milestones, risks, updates, templates, delay fragments)

| | Company Manager | Project Manager | Company Member / Viewer | Project Editor | Project Viewer | Super Admin |
|---|---|---|---|---|---|---|
| View | ✅ (all) | 🔵 assigned | 🔵 assigned | ✅ | ✅ | ✅ |
| Create / Edit / Delete | ✅ (all) | 🟡 all (Finding 1) | 🔵 assigned | ✅ | ⛔ | ✅ |

### Billing (pay applications, line items, invoices, payment ledger, cost actuals)

| | Company Manager | Project Manager | Company Member / Viewer | Project Editor | Project Viewer | Super Admin | Client |
|---|---|---|---|---|---|---|---|
| View | ✅ (all) | 🔵 assigned | 🔵 assigned | ✅ | ✅ | ✅ | 🟡 if "Billing" granted |
| Create / Edit / Delete | ✅ (all) | 🟡 all (Finding 1) | 🔵 assigned | ✅ | ⛔ | ✅ | ⛔ |

### CRM / Pipeline (opportunities, accounts, contacts, next actions)

| | Company Manager | Project Manager | Company Member / Viewer | Super Admin |
|---|---|---|---|---|
| View | ✅ | ✅ | ✅ | ✅ |
| Create / Edit | ✅ | ✅ | ✅ | ✅ |
| Archive (soft delete) | ✅ | ✅ | ✅ | ✅ |
| Hard delete | ⛔ | ⛔ | ⛔ | ⛔ |
| Convert opportunity → project | ✅ | ✅ | ✅ | ✅ |

CRM is company-wide for every member. There is **no hard-delete** for anyone —
removal is an "archive" (a soft flag). See
[Finding 4](#finding-4--crm-has-no-delete-rule-removal-is-archive-only).

### Company Settings / Team

| | Company Manager | Project Manager | Company Member / Viewer | Super Admin |
|---|---|---|---|---|
| View company & member list | ✅ | ✅ | ✅ | ✅ (all companies) |
| Edit company profile | ✅ | ⛔ | ⛔ | ✅ (all companies) |
| Invite / remove people, change roles | ✅ | ⛔ | ⛔ | 🟡 read+update, not delete |
| Delete the company | ✅ | ⛔ | ⛔ | ⛔ (Finding 9) |
| Edit **own** profile | ✅ | ✅ | ✅ | ✅ |

The Team screen is the **one place the UI actually hides controls by role**: if you
are not a Company Manager, the invite/role/client-access controls render disabled,
with a banner explaining why (`team.tsx`).

### Admin workspace (`/admin`)

| | Reach the page | What it shows |
|---|---|---|
| Super Admin (founder email only) | ✅ | Read-only live activity stream (who's online, what page) |
| Everyone else | ⛔ redirected away | — |

### Client Portal

| Client can… | Enforced by |
|---|---|
| View change orders | the "Change Orders" switch on their access grant |
| View daily reports | the "Daily Reports" switch |
| View billing / invoices | the "Billing" switch |
| Approve / reject a change order | a dedicated server action; recorded as an approval |
| Anything else (create/edit/delete) | ⛔ never |

---

## 3. Findings

Every item below is either a real inconsistency, a gap, or a "this surprised the
auditor." Each is tagged:

- **[OPEN QUESTION]** — needs a product decision by the founder. **Not** changed in
  this phase (per the phase rule: *decided by the founder, not by an agent at 3 AM*).
- **[BY DESIGN]** — verified intentional; written down so it isn't rediscovered as a
  "bug" later.
- **[CLEANUP]** — safe, mechanical tidy-up, but out of this branch's file territory
  and/or not behavior-affecting; deferred with a note.

**No code or policy was changed in this phase.** The reasoning for that is in
[Section 4](#4--why-task-1-changed-no-code). The findings are the deliverable.

---

### Finding 1 — Project Manager can *change* projects it cannot *see*
**[OPEN QUESTION] — highest priority.**

A company **Project Manager** who has not been added to a specific project:

- **Cannot view** that project — `can_read_project`'s company branch only accepts
  `owner`/`admin`/`executive`, so a PM sees a project only via a direct project
  membership. (This matches the stated intent in
  `20260622152000_portfolio_project_visibility.sql`: "PMs see assigned projects; owner/admin/executive review the full company rollup.")
- **Can nonetheless create, edit, and delete** rows on that same project — because
  `can_manage_project`'s company branch **does** accept `project_manager`, for
  **every** project in the company.

So a freshly-invited Project Manager, before being assigned to anything, can write to
(and delete from) every project in the company while none of them appear in their
portfolio. Write-without-read, and company-wide write that contradicts the
"assigned-only" intent.

This is the single most important thing to resolve. It is **not** fixed here because
the fix is a product decision, not a mechanical one: the two defensible answers pull
in opposite directions —
  (a) *PMs should manage the whole company's projects* → then `can_read_project`
  should also grant PMs company-wide read (widen read); or
  (b) *PMs should only touch assigned projects* → then `can_manage_project` should
  drop the `project_manager` company branch (narrow write).
Either changes real behavior for real users. **Founder decides in Phase 2.**
Evidence: `can_manage_project` and `can_read_project` in
`20260623161515_*.sql` (latest definitions).

### Finding 2 — "Member" and "Viewer" are identical; "Viewer" is not read-only
**[OPEN QUESTION].**

The `account_role` enum offers `member` and `viewer`, but **no policy or function
anywhere distinguishes them.** Both resolve to "active org member" via
`is_org_member`, and that is the only thing either is ever checked for. A user
labeled **viewer** can therefore create/edit/delete estimates, add cost-library
items, create/edit CRM opportunities, and create new projects — exactly like a
member. The label promises read-only; the system grants read/write.

Likewise, `executive` is identical to `admin` and `owner` in every database rule
(all three are the `can_manage_org` set). So six enum values encode three real levels.

Open question for Phase 2: should `viewer` become a genuine read-only company role
(and should `executive` diverge from `admin`), or should the unused labels be
retired? Retiring enum values is not zero-risk (existing rows may hold them), so it
is deliberately **not** done here. Evidence: `account_role` enum in
`20260621213000_team_membership_foundation.sql`; `is_org_member` /`can_manage_org` in
`20260623161515_*.sql`.

### Finding 3 — Estimating write access is company-wide; Cost Library is not
**[OPEN QUESTION].**

Within the Estimating module the write rules are inconsistent:

- **Estimates, line items, plan sheets, takeoffs**: create/edit/delete gated by
  `is_org_member` — *any* company role, viewer included.
- **Cost library items & markup defaults**: edit/delete gated by `can_manage_org` —
  Company Managers only.

So the same person can freely delete a whole estimate but cannot edit a shared
cost-library rate. That may be intentional (estimates are working documents; the cost
library is shared reference data) — but it is undocumented and worth a conscious
decision. Not changed here. Evidence: `estimates_org_update`/`estimates_org_delete`
and `cost_library_items_user_update`/`_delete` in `20260630035606_*.sql`.

### Finding 4 — CRM has no delete rule; removal is archive-only
**[OPEN QUESTION / likely BY DESIGN].**

`pipeline_opportunities`, `pipeline_accounts`, `pipeline_contacts`, and
`pipeline_next_actions` have INSERT/SELECT/UPDATE policies but **no DELETE policy**,
so no company user (nor super admin) can hard-delete a CRM row through the app. The
UI's "delete/archive" is a soft archive (an UPDATE to an `archived` flag), so this is
consistent with the screens today. Flagged because: (a) it should be a stated
decision, not an accident, and (b) a CRM-module agent is concurrently touching CRM
delete/seed behavior — coordinate before adding any DELETE policy. **Out of this
branch's territory (CRM); not touched.** Evidence: pipeline policies in
`20260630032235_pipeline_crm.sql` and `20260630043000_pipeline_crm_relationships.sql`.

### Finding 5 — `holds` table is dead and has no team access rules
**[CLEANUP — deferred].**

The `holds` table (created in `20260611114521_*.sql`) still carries only the original
`holds_owner_via_project` (owner-only, FOR ALL) policy and never received the
`*_team_*` policies that every other project-scoped table got in the team-membership
rollout. It is **not queried anywhere in `src/`** — it was superseded by `exposures`
(all `holds` mentions in the UI are the words "before holds" in labels, not the
table). So the missing team policies have no live impact. The right cleanup is to
drop the dead table (a migration), but that touches IOR/Project territory and is not
a Phase-1 auth tightening. **Left as-is, flagged.** Evidence: `holds` policy in the
policy inventory (appendix); zero `from("holds")` usages in `src/`.

### Finding 6 — Append-only tables have no UPDATE/DELETE, on purpose
**[BY DESIGN — documented so it isn't "fixed" by mistake].**

`change_order_approvals` (client approval log), `billing_application_events`,
`sov_imports`, and `pipeline_activity_log` intentionally omit some of UPDATE/DELETE —
they are audit/history tables. `billing_application_events` even keeps DELETE but no
UPDATE. This is correct for an audit trail; recorded here only so a future reader
doesn't flag it as a missing policy and "repair" it.

### Finding 7 — Service-role-only tables have RLS on and zero policies, on purpose
**[BY DESIGN].**

`email_send_log`, `email_send_state`, `email_unsubscribe_tokens`,
`suppressed_emails`, plus write access to `app_super_admins` and
`subscription_plans`, have RLS enabled with **no** policy for signed-in users. That is
the intended lock: only the service role (edge functions / server) touches them, and
the service role bypasses RLS. Not a gap.

### Finding 8 — Two different "admin" lists that disagree
**[OPEN QUESTION].**

There are two independent notions of "Overwatch admin," and they don't match:

- **Database super admin** (`is_super_admin()`): the `app_super_admins` table **or**
  one of two hard-coded emails — `wilkinson.marshall@gmail.com` **and**
  `marshall@marshallwilkinson.com`.
- **Client-side admin gate** (`OVERWATCH_ADMIN_EMAIL` in `src/lib/admin-access.ts`):
  a **single** email — `wilkinson.marshall@gmail.com` — which alone decides who can
  open the `/admin` screen.

Consequence: if the founder signs in as `marshall@marshallwilkinson.com`, he has full
god-mode over all data (DB super admin) but the `/admin` page redirects him away
(client gate doesn't recognize that email). Aligning them is a one-line change, but
it changes *who is treated as an admin* — a security/product decision, so it is a
Phase-2 question, **not** a silent 3 AM edit. Evidence:
`is_super_admin()` in `20260623223000_restore_marshall_super_admin_visibility.sql`;
`OVERWATCH_ADMIN_EMAIL` in `src/lib/admin-access.ts:1`.

### Finding 9 — Super admin can read/update every company but cannot delete one
**[BY DESIGN — noted].**

The super-admin escalation adds `is_super_admin()` to read and update across all
orgs/projects, and there are explicit "Super admins can read/update all projects"
policies — but there is **no** super-admin DELETE policy on `organizations` or
`projects`. A super admin can delete a company only where they'd independently qualify
as its manager. Given how destructive company deletion is, the absence looks
intentional/conservative; recorded, not changed.

### Finding 10 — Founder emails are hard-coded into a security function
**[BY DESIGN — noted, with a caution].**

`is_super_admin()` embeds two literal email addresses as an OR branch. The migration
that introduced it explains why (a recovery path so the founder never gets locked out
behind RLS if his Supabase user id changes). It works, but it is an email-based
backdoor living in SQL: anyone who can create an auth user with one of those emails
would gain god-mode, and rotating it requires a migration. Worth a deliberate Phase-2
decision on whether to keep it or move fully to the `app_super_admins` table.
Evidence: `is_super_admin()` in
`20260623223000_restore_marshall_super_admin_visibility.sql`.

### Finding 11 — The app relies on the database, not the screens, to enforce roles
**[BY DESIGN — context for testers].**

Outside the Team screen and the `/admin` route guard, the UI generally does **not**
hide buttons by role — it shows the action and lets RLS reject it. The route guard
(`src/routes/_authenticated/route.tsx`) checks only that you're signed in; it does not
check role. This is a legitimate pattern (the database is the real gate), but it means
a beta tester may see a button that then errors on save. Testers should understand
"the button existing" ≠ "you're allowed"; the matrix above is the source of truth.

---

## 4 — Why Task 1 changed no code

The phase brief authorizes *only* "mechanical, obviously-correct tightenings that are
zero-risk to legitimate users," and sends everything requiring a product decision to
the findings as an open question. Applying that filter to the 11 findings:

- Findings **1, 2, 3, 8, 10** are product/security decisions → open questions by rule.
- Findings **6, 7, 9** are verified intentional → nothing to fix.
- Finding **4** (CRM delete) is out of this branch's module territory *and* has a
  concurrent CRM agent → must not touch.
- Finding **5** (dead `holds` table) has no live impact and its cleanup is a
  Project/IOR-territory migration → deferred.

That leaves **no change that is simultaneously a real fix, zero-risk, and inside the
auth/membership territory.** The honest, spec-aligned result is a documentation-only
phase: no migration, no source edit. This is a feature of the audit, not a shortfall —
the seam that touches everything was left byte-for-byte unchanged while the risks were
written down for a waking human to decide.

---

## 5 — Phase 2 agenda (for the founder)

1. **Project Manager scope (Finding 1):** should a PM manage *all* company projects or
   *only assigned* ones? Pick one; align `can_read_project` and `can_manage_project`.
2. **Viewer & Executive (Finding 2):** make `viewer` genuinely read-only? make
   `executive` distinct from `admin`? or retire the unused labels?
3. **Estimating vs Cost Library write rules (Finding 3):** intended, or should
   estimate delete be manager-gated too?
4. **CRM delete (Finding 4):** confirm archive-only is intended; coordinate with the
   CRM agent before adding any DELETE policy.
5. **Admin lists (Finding 8):** reconcile the `/admin` gate with the DB super-admin
   list.
6. **Super-admin backdoor (Finding 10):** keep the hard-coded emails or move fully to
   `app_super_admins`?
7. **Dead `holds` table (Finding 5):** confirm dead, then drop it (IOR-territory
   migration).

Any change from this agenda that alters an RLS policy is a **migration file** in
`supabase/migrations/`, flagged in its PR and applied through the established protocol
before merge.

---

## Appendix — technical detail

### A. Enums (`20260621213000_team_membership_foundation.sql`)
- `account_role` = `owner, admin, executive, project_manager, member, viewer`
- `project_member_role` = `owner, manager, editor, viewer`
- `member_status` = `pending, active, disabled` (only `active` counts in every helper)
- `invite_status` = `pending, accepted, revoked, expired`

### B. Helper functions — what each *actually* checks (final/latest definition)

| Function | Latest defined in | Returns true when (all require `auth.uid()` present) |
|---|---|---|
| `is_super_admin()` | `20260623223000_restore_marshall_super_admin_visibility.sql` | user is in `app_super_admins` **OR** their email ∈ {`wilkinson.marshall@gmail.com`, `marshall@marshallwilkinson.com`} |
| `is_org_member(org)` | `20260623161515_*.sql` | `is_super_admin()` **OR** an `active` `organization_memberships` row for this org (any role) |
| `can_manage_org(org)` | `20260623161515_*.sql` | `is_super_admin()` **OR** `active` membership with role ∈ {owner, admin, executive} |
| `can_create_project_in_org(org)` | `20260622183000_relax_current_grant_project_creation.sql` | **any** authenticated user with a non-null org — role check was intentionally removed for the Contractor Circle grant (comment in file) |
| `can_read_project(project)` | `20260623161515_*.sql` | `is_super_admin()` **OR** project `owner_id` = me **OR** company role ∈ {owner, admin, executive} **OR** *any* `active` `project_memberships` row |
| `can_manage_project(project)` | `20260623161515_*.sql` | `is_super_admin()` **OR** project `owner_id` = me **OR** company role ∈ {owner, admin, executive, **project_manager**} **OR** `project_memberships` role ∈ {owner, manager, editor} |
| `can_read_estimate(est)` | `20260701190000_plan_room_rls_upload_fix.sql` | `is_org_member(est.org)` **OR** `is_super_admin()` **OR** (est has project AND `can_read_project`) |
| `can_manage_estimate(est)` | `20260701190000_plan_room_rls_upload_fix.sql` | `is_org_member(est.org)` **OR** `is_super_admin()` **OR** `can_manage_org(est.org)` **OR** (est has project AND `can_manage_project`) — note `is_org_member` already makes the `can_manage_org` clause redundant |
| `can_read_client_project(project)` | `20260623150509_*.sql` | an `active`/`pending` `project_client_access` row matching my user id or JWT email |
| `can_view_client_billing / _change_orders / _daily_reports(project)` | `20260630033447_*` / `20260623162000_*` | as above **AND** the matching `can_view_*` flag on the access row is true |
| `can_approve_client_change_order(co)` | `20260623162000_client_portal_module_permissions.sql` | the change order is `client_visible` **AND** `can_view_client_change_orders(co.project)` |

Note the divergence that drives **Finding 1**: the company-role branch of
`can_read_project` is `{owner, admin, executive}` while `can_manage_project` is
`{owner, admin, executive, project_manager}`.

All helper functions are `SECURITY DEFINER`, `STABLE`, `SET search_path = public`
(super-admin also `auth`), with `EXECUTE` granted to `authenticated` and revoked from
`PUBLIC`. `reorder_schedule_wbs_sections` is `SECURITY INVOKER` and re-checks
`can_manage_project` itself.

### C. Policy inventory by module (table → verb → policy → guard)

**Auth / membership (this branch's territory)**
- `organizations`: SELECT `organizations_member_read` (`is_org_member`) + `Super admins can read all organizations` (`is_super_admin`); INSERT `organizations_create_own` (`created_by = auth.uid()`); UPDATE `organizations_manage` (`can_manage_org`) + `Super admins can update all organizations`; DELETE `organizations_delete` (`can_manage_org`). *No super-admin DELETE — Finding 9.*
- `organization_memberships`: SELECT `_member_read` (`user_id = me OR is_org_member`) + `Super admins can read all memberships`; INSERT/UPDATE/DELETE `_manage_*` (`can_manage_org`).
- `organization_invites`: SELECT `_member_read` (`is_org_member`); INSERT/UPDATE/DELETE `_manage_*` (`can_manage_org`).
- `project_memberships`: SELECT `_read` (`user_id = me OR can_read_project`); INSERT/UPDATE/DELETE `_manage_*` (`can_manage_project`).
- `profiles`: SELECT `profiles_self_read` (self, or same-org via membership join); INSERT/UPDATE self only. *No DELETE — cascades from `auth.users`.*
- `app_super_admins`: SELECT self-list only; **no** authenticated write (service-role only) — Finding 7.

**Projects / IOR** — `projects`: SELECT `projects_team_select` (`can_read_project`) + `projects_client_select` (`can_read_client_project`) + super-admin read; INSERT `projects_team_insert` (`owner = me AND can_create_project_in_org`); UPDATE `projects_team_update` (`can_manage_project`) + super-admin update; DELETE `projects_team_delete` (`can_manage_project`). Plus legacy `projects_owner_all` (FOR ALL, `owner_id = me`). Child tables `exposures, change_orders, cost_buckets, decisions, reviews, daily_reports, project_inspections` all follow `_team_select`=`can_read_project`, `_team_insert/update/delete`=`can_manage_project`, each also carrying a redundant legacy `*_owner_via_project` FOR ALL owner policy. `holds`: **only** `holds_owner_via_project` (Finding 5).

**Estimating** — `estimates`, `estimate_line_items`: all four verbs `is_org_member` (line items via an `estimates` join). `estimate_plan_sets`, `estimate_plan_sheets`, `estimate_takeoff_measurements`: SELECT `can_read_estimate`, INSERT/UPDATE/DELETE `can_manage_estimate`. Storage bucket `plan-room`: read `can_read_estimate`, write `can_manage_estimate` (via `storage_estimate_id(name)`).

**Cost Library** — `cost_library_items`: SELECT/INSERT `is_org_member`; UPDATE/DELETE `can_manage_org AND source <> 'system'`. `estimate_markup_defaults`: SELECT `is_org_member`; INSERT/UPDATE/DELETE `can_manage_org`.

**Schedule** — `schedule_activities, schedule_activity_updates, schedule_wbs_sections, schedule_milestones, schedule_milestone_updates, schedule_risks, schedule_updates, schedule_cpm_templates, schedule_delay_fragments`: SELECT `can_read_project`, INSERT/UPDATE/DELETE `can_manage_project`. `schedule_milestones`/`schedule_risks` also carry legacy owner FOR ALL policies.

**Billing** — `billing_applications, billing_line_items, billing_invoices, payment_ledger, cost_actuals, cost_actual_import_batches, change_order_allocations, billing_application_events`: team SELECT `can_read_project`, write `can_manage_project`; client SELECT variants gated by `can_view_client_billing` (invoices additionally require `client_visible`). `billing_application_events` has no UPDATE (Finding 6). `billing_applications` also has legacy owner FOR ALL.

**CRM / Pipeline** — `pipeline_opportunities, pipeline_accounts, pipeline_contacts, pipeline_next_actions`: SELECT/INSERT/UPDATE `is_org_member` (INSERT also `created_by` self); **no DELETE** (Finding 4). `pipeline_activity_log`: SELECT/INSERT `is_org_member`, append-only. RPC `convert_pipeline_opportunity_to_project` (`SECURITY DEFINER`) requires `is_org_member` and that the opportunity is `won`.

**Client Portal** — `project_client_access`: SELECT internal (`can_read_project`) or the client themselves; INSERT/UPDATE/DELETE `can_manage_project`. `change_orders_client_select` (`client_visible AND can_view_client_change_orders`), `daily_reports_client_select` (`client_visible AND can_view_client_daily_reports`), billing client selects as above. `change_order_approvals`: INSERT `can_approve_client_change_order`; SELECT `can_read_project OR can_view_client_change_orders`; no UPDATE/DELETE (append-only, Finding 6). RPC `record_client_change_order_decision` (`SECURITY DEFINER`) records approve/reject.

**Company assets / storage** — bucket `company-assets`: write `can_manage_org(storage_organization_id(name))`. Bucket `daily-reports`: team read `can_read_project`, write `can_manage_project`, client read `can_view_client_daily_reports`, plus legacy owner-path policies.

**Service-role-only (RLS on, no authenticated policy — Finding 7)** —
`email_send_log`, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`;
plus write on `app_super_admins`, `subscription_plans` (SELECT `true` for the latter).

### D. Admin surfaces
- DB super admin: `is_super_admin()` + `app_super_admins` table (writeable only by
  service role). Grants cross-company read/manage via the helper short-circuits and
  the explicit "Super admins can …" policies on `projects`, `organizations`,
  `organization_memberships`.
- App `/admin` route: guarded by `isOverwatchAdminEmail()` → single constant
  `OVERWATCH_ADMIN_EMAIL` (`src/lib/admin-access.ts:1`); read-only activity view built
  server-side with the service-role client (`admin.functions.ts`,
  `getOverwatchAdminWorkspace`). Mismatch with the DB list is **Finding 8**.

### E. Client-side gating (informational — the DB is the real gate)
- Route guard `src/routes/_authenticated/route.tsx`: session/user check only, **no role**.
- Team screen `team.tsx`: computes `canManageTeam = active AND role ∈ {owner, admin,
  executive}` (`team.functions.ts` `getTeamWorkspace`) and disables/hides invite,
  role, and client-access controls when false — the one module with real role-based UI.
- Server data functions (`team.functions.ts`, `client-portal.functions.ts`,
  `billing.functions.ts`, `stripe.server.ts`) call `can_manage_org` /
  `can_manage_project` via RPC before mutating, mirroring the RLS guard. Estimating,
  Schedule, CRM, and Projects functions rely on RLS alone for write authorization.
