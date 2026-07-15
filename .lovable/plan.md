# Audit — `20260714223256_commercial_entitlements.sql`

## Verdict

**Already fully applied to the production OverWatch database. Do not re-run as-is.** Re-executing would regress a later, load-bearing change to `credit_ledger_reason_check` and break AI features shipped in migrations dated after this one.

## Evidence of current state

Every object the migration would create is already present with the exact promised shape:

- `subscription_plans` rows: `free` (1 project / 2 seats / public / not checkout-enabled), `pro` (25 / 10 / public / checkout-enabled, price `price_1TtHC6JGLltOYaii8jAmLwbx`), `contractor_circle_free` (25 / 10 / private). Legacy `starter` and `growth` are already `is_public=false, checkout_enabled=false`. `monthly_ai_credits` column exists.
- `organizations` new columns present with the promised defaults: `entitlement_source default 'free'`, `entitlement_expires_at`, `billing_grace_ends_at`, `circle_entitlement_checked_at`, `circle_entitlement_member_email default ''`, `circle_entitlement_tier default ''`. Column defaults for `plan_code='free'`, `billing_status='active'`, `project_limit=1`, `seat_limit=2`, `storage_limit_mb=1024`, `daily_report_limit_per_month=50`, `contractor_circle_grant=false` are all in place. `organizations_entitlement_source_check` constraint present.
- Trigger `organizations_protect_entitlement_source` and function `protect_organization_entitlement_source()` present.
- Trigger `projects_enforce_organization_limit` and function `enforce_organization_project_limit()` present (Harbor Residence sample carve-out via `job_number='DEMO-HARBOR'`).
- Function `ensure_monthly_ai_credit_grant(uuid)` present; unique partial index `credit_ledger_monthly_plan_grant_key` in place.
- Signup-credit trigger already dropped.
- `ensure_user_account()` present and no longer stamps Circle grants.
- Backfill applied: all 21 existing organizations are `plan_code='contractor_circle_free'`, `billing_status='contractor_circle_grant'`, `entitlement_source='admin'`, `project_limit=25`, `seat_limit=10`. Existing Contractor Circle and Hardcore access is preserved as admin-source grants exactly as the migration intends.

## Blocker if re-applied verbatim

The migration contains:

```sql
ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_reason_check;
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_reason_check CHECK (
  reason IN ('signup_grant','monthly_plan_grant','purchase','ai_count_scan','refund','admin_adjustment')
);
```

Production's current `credit_ledger_reason_check` is the widened form written by later migrations:

```
reason IN ('signup_grant','monthly_plan_grant','purchase','ai_count_scan',
           'ai_measurement_plan','ai_assembly_assumptions','ai_revision_match',
           'refund','admin_adjustment')
```

Re-running this migration would replace that constraint with the older six-value list. That would:
- Immediately fail if any `credit_ledger` row already carries reason `ai_measurement_plan`, `ai_assembly_assumptions`, or `ai_revision_match` (the `ADD CONSTRAINT ... CHECK` is validated on existing rows).
- Even if it succeeded, break subsequent inserts from Guided Measurement Assistant, Takeoff Assembly Workbench, and Plan Revision Matching server functions, which write those reason codes.

Every other statement in the file is idempotent (`ADD COLUMN IF NOT EXISTS`, guarded `ADD CONSTRAINT`, `INSERT … ON CONFLICT DO UPDATE`, `CREATE OR REPLACE FUNCTION`, `DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, `CREATE UNIQUE INDEX IF NOT EXISTS`). Backfill `UPDATE` re-runs are harmless — all target rows already match.

## Migration-history conflicts

The `supabase_migrations.schema_migrations` table is not readable from this session's role, so I cannot confirm whether the recorded version `20260714223256` is present or missing from Supabase's history table. Given that every side effect is present, the migration was applied at least once. If Supabase's history table is missing the row (drift), that's a bookkeeping fix, not a re-execution.

## Safest apply instruction

**Do not re-run this migration file against production.** Choose one of:

1. **Preferred — leave production alone.** The commercial entitlements are already live and correct. No action needed.
2. **If Supabase's `schema_migrations` bookkeeping is missing the `20260714223256` row and needs to reflect reality**, mark it applied without executing SQL. That's a one-line insert into `supabase_migrations.schema_migrations` performed as a maintenance task — not a re-run of the file. Requires elevated access this audit session does not have; hand off to whoever ran the earlier applications (Marshall / Claude chat with DB owner access).
3. **If a code change requires re-declaring the migration for a fresh environment**, keep the file as-is for replay portability, but never `psql`-execute it against production where a wider `credit_ledger_reason_check` already exists.

## What I did not do

No SQL was executed. No code, migration file, secret, or database row was modified during this audit.
