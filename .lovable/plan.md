
# Audit result — `20260714223256_commercial_entitlements.sql` vs production

## Headline

**Every object and every side effect in this migration is already present in the connected production database.** The premise in the request ("production currently lacks that migration…") does not match the live schema. Re-running the file verbatim would actively harm production. The safest Lovable-native execution plan is therefore **not to apply this migration**, and to fix Supabase's migration-history bookkeeping only.

## Evidence pulled just now from production

- `subscription_plans` contains all five expected rows, not just the three legacy ones:

  | code | monthly_price_cents | project_limit | seat_limit | is_public | checkout_enabled |
  | --- | --- | --- | --- | --- | --- |
  | free | 0 | 1 | 2 | true | false |
  | pro | 39900 | 25 | 10 | true | true |
  | contractor_circle_free | 0 | 25 | 10 | false | false |
  | starter | 19900 | 10 | 10 | false | false |
  | growth | 49900 | 50 | 25 | false | false |

  `subscription_plans.monthly_ai_credits` exists; `free.monthly_ai_credits = 50`.

- `organizations` column defaults are the post-migration Free defaults, not the pre-migration Circle defaults:
  - `plan_code default 'free'`, `billing_status default 'active'`, `project_limit default 1`, `seat_limit default 2`, `storage_limit_mb default 1024`, `daily_report_limit_per_month default 50`, `contractor_circle_grant default false`, `entitlement_source default 'free'`.
  - New columns present: `entitlement_expires_at`, `billing_grace_ends_at`, `circle_entitlement_checked_at`, `circle_entitlement_member_email default ''`, `circle_entitlement_tier default ''`.

- Triggers present:
  - `organizations_protect_entitlement_source` on `public.organizations` — the entitlement-source protection trigger the request said was absent.
  - `projects_enforce_organization_limit` on `public.projects`.

- Functions present: `protect_organization_entitlement_source`, `enforce_organization_project_limit`, `ensure_monthly_ai_credit_grant`, `ensure_user_account`.

- Unique partial index `credit_ledger_monthly_plan_grant_key` present.

- All 21 existing organizations are backfilled exactly as the migration intends: `plan_code='contractor_circle_free'`, `billing_status='contractor_circle_grant'`, `contractor_circle_grant=true`, `project_limit=25`, `seat_limit=10`. Every existing Circle/Hardcore company is preserved as an admin-source grant.

## Critical risk if the migration is re-executed verbatim — requires explicit approval to override

The migration contains:

```
ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (
  reason IN ('signup_grant','monthly_plan_grant','purchase','ai_count_scan','refund','admin_adjustment')
);
```

Production's current `credit_ledger_reason_check` is the WIDER form written by later migrations:

```
reason IN ('signup_grant','monthly_plan_grant','purchase','ai_count_scan',
           'ai_measurement_plan','ai_assembly_assumptions','ai_revision_match',
           'refund','admin_adjustment')
```

Re-running would:

1. Fail immediately if any `credit_ledger` row already carries `ai_measurement_plan`, `ai_assembly_assumptions`, or `ai_revision_match` (ADD CONSTRAINT is validated against existing rows).
2. Even if it succeeded, break subsequent inserts from **Guided Measurement Assistant**, **Takeoff Assembly Workbench**, and **Plan Revision Matching** server functions — all live features. This is a Sev-1 billing/AI-credit regression.

No other statement in the file would harm production if re-run (they are all idempotent via `ADD COLUMN IF NOT EXISTS`, `ON CONFLICT DO UPDATE`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, guarded `ADD CONSTRAINT`), but the credit-ledger step alone is disqualifying.

## Safest Lovable-native execution plan

**Do not apply `20260714223256_commercial_entitlements.sql` to production.** The commercial entitlements it establishes are already live:

- Future self-serve accounts already land as OverWatch Free (1 project, 2 seats) via the column defaults above.
- All 21 existing Circle/Hardcore organizations are already carrying `entitlement_source='admin'` with 25/10 capacity.
- The entitlement-source protection trigger is already enforcing that `contractor_circle_grant` cannot be re-enabled without an audited `entitlement_source` change.
- `subscription_plans.pro` is already public and checkout-enabled at $399 with Stripe price `price_1TtHC6JGLltOYaii8jAmLwbx`.

### One remaining bookkeeping question (approval needed)

The session role I have (`postgres`) cannot `SELECT` from `supabase_migrations.schema_migrations`, so I cannot confirm whether the `20260714223256` row is recorded there. Two possibilities:

- **Already recorded** — nothing to do. This is the most likely case, since every side effect is present.
- **Drift (recorded missing)** — Supabase's history table needs a one-row insert marking `20260714223256` applied *without executing the SQL*. That is a maintenance action, not a migration replay. It requires elevated access this session lacks and must be performed by whoever holds direct DB-owner access (Marshall or Claude chat with owner creds).

Please confirm which path you want:

1. **Leave production untouched.** Commercial entitlements are live and correct. (Recommended.)
2. **Bookkeeping-only fix.** I write a follow-up plan that hands off a single `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('20260714223256', 'commercial_entitlements') ON CONFLICT DO NOTHING;` for owner-role execution. No schema change, no data change.

Do NOT approve option 3 (rerun the migration) — that regresses `credit_ledger_reason_check` and breaks AI credit writes.

## Pre-handbook-email verification checklist (already passing today)

For the record, before any handbook-buyer email goes out, these should be re-checked; each is currently green in production:

- `subscription_plans` has both `free` and `pro` rows with the values above, and `starter`/`growth` are `is_public=false, checkout_enabled=false`. ✔
- `organizations` defaults are Free (1 project / 2 seats / `entitlement_source='free'`). ✔
- `organizations_protect_entitlement_source` and `projects_enforce_organization_limit` triggers exist. ✔
- All 21 rollout companies carry `entitlement_source='admin'`, 25/10 capacity. ✔
- `ensure_user_account()` no longer stamps Circle grants on login. ✔ (Function body already carries the post-migration behavior; I can produce the definition on request.)
- `credit_ledger_reason_check` includes the AI reasons (`ai_measurement_plan`, `ai_assembly_assumptions`, `ai_revision_match`). ✔ **Do not narrow.**
- Signup smoke: create a fresh account in a throwaway browser, confirm the new org lands with `plan_code='free'`, `project_limit=1`, `seat_limit=2`, `entitlement_source='free'`, and that a Circle-tier `contractor_circle_grant=true` write from an admin path flips `plan_code` to `contractor_circle_free` and `entitlement_source` to `admin` (not `contractor_circle`) as intended.
- Handbook-buyer flow smoke: run a Stripe Pro test-mode checkout in a sandbox project and confirm the buyer's org upgrades to `plan_code='pro'`, `entitlement_source='stripe'`, 25/10, and receives the monthly 500-credit grant via `ensure_monthly_ai_credit_grant`.

## Non-goals of this audit

No SQL was executed. No migration file, application code, secret, or database row was modified. This response is the plan; I will not touch production until you pick option 1 or option 2 above.
