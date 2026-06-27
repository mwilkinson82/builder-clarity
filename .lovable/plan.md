## Why the CPM data is missing

The `schedule_activities` table doesn't exist in the database. The three migrations that build the CPM feature were committed to `supabase/migrations/` but never applied:

- `20260626153000_schedule_cpm_activities.sql` — creates the table, RLS policies, GRANTs
- `20260626170000_seed_harbor_residence_cpm_demo.sql` — initial seed (exact name match)
- `20260626232000_reseed_harbor_residence_cpm_demo.sql` — broader seed (Harbor / demo number / "Private Luxury Residence")

Without #1 the seeds error out, and without the seeds none of the 10 Harbor Residence copies across orgs get any CPM activities.

## Plan

1. Apply the three migrations in order via the migration tool.
2. Verify: `select project_id, count(*) from schedule_activities group by 1` should return rows for the Harbor projects (the reseed targets all 10 matched copies).
3. If any Harbor copy still has zero rows after the reseed (e.g. renamed or stripped of the demo markers), run a targeted insert for those specific project IDs using the same activity set.

No app code changes — this is purely a missed migration apply.