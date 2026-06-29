## Lovable-managed Supabase migration plan

Overwatch uses the Supabase/database environment managed by Lovable. A GitHub push can deliver the migration files, but the live database still needs Lovable to apply the migrations in order.

## Required migration order

1. Confirm the CPM activity foundation is already applied:
   - `20260626153000_schedule_cpm_activities.sql`
   - `20260626170000_seed_harbor_residence_cpm_demo.sql`
   - `20260626232000_reseed_harbor_residence_cpm_demo.sql`
2. Apply the WBS persistence migration:
   - `20260629130000_schedule_wbs_sections.sql`
3. Apply the schedule delay-fragment migration:
   - `20260629165311_schedule_delay_fragments.sql`

The WBS migration creates `public.schedule_wbs_sections`, enables RLS, grants authenticated access, uses the existing `can_read_project` / `can_manage_project` policies, and seeds each project from the existing `schedule_activities.division` values.

The delay-fragment migration creates `public.schedule_delay_fragments`, enables RLS, grants authenticated access, and stores activity-linked delay records with days, source, status, owner, identified date, and resolved date. The CPM workspace degrades safely until this table exists, but activity-level delay records will not save without it.

## Why this matters

The CPM workspace now saves WBS add, rename, and drag/drop reorder operations through server functions. Without `schedule_wbs_sections`, the UI can still derive sections from activity divisions as a safe fallback, but WBS order/title changes will not persist in the Lovable-managed database.

## Verification SQL

Run after applying the migrations:

```sql
select to_regclass('public.schedule_activities') as schedule_activities_table;
select to_regclass('public.schedule_wbs_sections') as schedule_wbs_sections_table;
select to_regclass('public.schedule_delay_fragments') as schedule_delay_fragments_table;

select
  project_id,
  count(*) as activity_count
from public.schedule_activities
group by project_id
order by activity_count desc;

select
  project_id,
  count(*) as wbs_section_count
from public.schedule_wbs_sections
group by project_id
order by wbs_section_count desc;

select
  project_id,
  count(*) as delay_fragment_count,
  sum(delay_days) filter (where status in ('active', 'accepted')) as open_delay_days
from public.schedule_delay_fragments
group by project_id
order by delay_fragment_count desc;
```

Expected result: all `to_regclass` checks return table names, Harbor/demo projects have CPM activity rows, projects with CPM activities have seeded WBS sections, and the delay-fragment count query runs even when no delay records exist yet.
