-- Make SOV imports stable across contractor templates by giving each cost row
-- an optional project-local cost code. Blank codes are allowed for simple jobs.

alter table public.cost_buckets
  add column if not exists cost_code text not null default '';

update public.cost_buckets
set cost_code = coalesce(cost_code, '');

alter table public.cost_buckets
  alter column cost_code set default '',
  alter column cost_code set not null;

create unique index if not exists cost_buckets_project_cost_code_unique
  on public.cost_buckets (project_id, lower(cost_code))
  where cost_code <> '';
