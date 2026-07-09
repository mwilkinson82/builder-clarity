# Home redesign — Phase 2 backend spec (profile menu + notifications + real data)

**Status:** desked, not applied. Migration `supabase/migrations/20260709120000_notifications_foundation.sql`.
**Context:** Phase 1 shipped the redesigned Portfolio/Home (option 6a) at `/home-preview`
with placeholder data (see [`overwatch-buildout-phases.md`] and PR #229). This spec covers
the backend that unblocks the **M-avatar profile menu**, **per-user notifications**, and the
**real-data** promotion of 6a onto `/`.

## 1. What already exists (no migration needed)

The audit turned up more than expected already in place:

- **Per-user profiles** — `public.profiles` (`full_name`, `avatar_url`, `phone`,
  `company_title`, `email`, `default_organization_id`). This backs the avatar
  identity and a "your profile" edit screen directly. RLS: self read/insert/update,
  plus read of same-org members.
- **Roles + invite-with-permission-checkboxes** — the whole capability system:
  `organization_memberships.capabilities` (jsonb flags), `organization_invites`
  (capabilities chosen at invite time), `account_role` presets, and the RLS helpers
  (`has_org_capability`, `can_manage_org`, …). See `docs/ROLES.md`. The Company/Team
  screen already invites people and sets per-person access checkboxes.

So the profile menu's **permissions** and **identity** are already supported. The only
missing backend was **notifications**.

## 2. What the migration adds

`20260709120000_notifications_foundation.sql` (portable, guarded, no seed):

- **`public.notifications`** — one row per (recipient, event). Columns: `recipient_id`
  (→ `auth.users`), `organization_id`, `actor_id`, `type` (free-text slug so the
  taxonomy grows without enum migrations), `title`, `body`, deep-link fields
  (`project_id`, `entity_type`, `entity_id`, `url`), `data jsonb`, `read_at`,
  `created_at`. Indexed for the recipient's newest-unread-first bell.
- **RLS** — recipients SELECT / UPDATE (mark read) / DELETE (dismiss) only their own
  rows. **No INSERT policy for `authenticated`** — rows are minted through the helper
  or by `service_role`, so no one can forge a notification to another user.
- **`create_notification(recipient, org, type, title, body, project, entity_type,
  entity_id, url, data)`** — `SECURITY DEFINER`, org-guarded: the caller and the
  recipient must both be active members of the target org. This lets any app action
  notify a teammate without allowing spam or cross-org leakage. Account-level/system
  notices (null org) are `service_role`-only.
- **`mark_all_notifications_read(org)`** — clears the caller's inbox in one call.
- **`profiles.notification_prefs jsonb`** — per-user opt-out map (`{type/category:
  bool}`, empty = receive everything), edited from the profile menu.

**Targeting is by relevance, not broadcast:** who receives an event is decided by the
Phase 2 producers using existing memberships + project assignments (e.g. the PM
assigned to a job gets that job's risk/CO notices; owners/admins get company-level
ones). The store just records and routes.

## 3. Apply → verify → merge

1. Marshall applies the migration through Lovable (agents don't apply migrations).
2. Sanity checks after apply:
   - `public.notifications` exists with RLS enabled; the three policies present.
   - `select public.create_notification(...)` as a member enqueues a row; as a
     non-member it raises.
   - `profiles.notification_prefs` column present, default `{}`.
3. Marshall tells the agent it's applied → **then** the Phase 2 app PR merges (its
   server functions reference these objects, so it must land after the DB is live).

## 4. Phase 2 app work (after apply)

- **Avatar profile menu** — replace the `/team`-link avatar with a real menu: shows
  the signed-in user's `profiles.full_name` / `avatar_url` (initial fallback); items:
  *Your profile* (edit name/photo/title/phone + notification prefs), *Company* (→
  `/team`, gated on `company.manage_*`), *Sign out* (real Supabase `signOut`).
- **Notifications bell** — header bell with unread count (`notifications` where
  `read_at is null`); dropdown list with deep-links; mark-read on open;
  *mark all read*. First producers to wire: risk flagged, change-order pending,
  daily-report stale/overdue, pay-app paid, invite accepted, project assignment.
- **Real home data** — replace `portfolio-home-data.ts` placeholders with live
  aggregates: pipeline weighted / avg GP / win rate from CRM; indicated GP,
  GP-at-risk, at-risk & overdue counts from active projects. Keep the up/down
  ticker's stock-logic (green = good direction). Wire the still-stubbed links
  (pipeline cards, worklist "Open →", pursuits, "+ New project", global search).
- **Owner⇄PM toggle → real role** — drive the view from the user's capabilities
  (`projects.view_all` / owner-ish vs assigned-only PM) instead of client state.
- **Promote 6a onto `/`** — swap `index.tsx` to render the new home once the data is
  live; retire `/home-preview`.

## 5. Open questions for Marshall

- **Notification delivery channels** — in-app only for v1, or also email? (The prefs
  column is channel-agnostic; email would add a queue + a send worker, a later phase.)
- **Digest vs per-event** — send every event, or batch low-priority ones into a daily
  digest? Affects the producer logic, not the schema.
- **Retention** — auto-expire read notifications after N days? (Add a scheduled
  cleanup later; not in the foundation.)
