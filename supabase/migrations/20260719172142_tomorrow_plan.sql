create table if not exists public.tomorrow_plan_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plan_date date not null,
  schedule_activity_id uuid references public.schedule_activities(id) on delete set null,
  cost_bucket_id uuid references public.cost_buckets(id) on delete set null,
  subcontractor_id uuid references public.subcontractors(id) on delete set null,
  activity text not null default '',
  work_area text not null default '',
  performer_type text not null default 'subcontractor'
    check (performer_type in ('self_perform', 'subcontractor', 'vendor', 'other')),
  performer_name text not null default '',
  crew_count numeric not null default 0 check (crew_count >= 0),
  people_per_crew numeric not null default 0 check (people_per_crew >= 0),
  hours_per_person numeric not null default 0 check (hours_per_person >= 0),
  planned_quantity numeric not null default 0 check (planned_quantity >= 0),
  unit text not null default '',
  target_rate numeric check (target_rate is null or target_rate >= 0),
  materials text not null default '',
  materials_ready boolean not null default false,
  equipment text not null default '',
  equipment_ready boolean not null default false,
  information text not null default '',
  information_ready boolean not null default false,
  inspection text not null default '',
  inspection_ready boolean not null default false,
  work_area_ready boolean not null default false,
  status text not null default 'at_risk'
    check (status in ('ready', 'at_risk', 'blocked')),
  constraint_summary text not null default '',
  constraint_owner text not null default '',
  confirmation_status text not null default 'planned'
    check (confirmation_status in ('planned', 'confirmed', 'cancelled')),
  confirmed_by uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tomorrow_plan_items_project_date_idx
  on public.tomorrow_plan_items(project_id, plan_date);
create index if not exists tomorrow_plan_items_project_status_idx
  on public.tomorrow_plan_items(project_id, status);

alter table public.tomorrow_plan_items enable row level security;

drop policy if exists tomorrow_plan_items_select on public.tomorrow_plan_items;
create policy tomorrow_plan_items_select
  on public.tomorrow_plan_items
  for select
  to authenticated
  using (public.can_read_project(project_id));

drop policy if exists tomorrow_plan_items_insert on public.tomorrow_plan_items;
create policy tomorrow_plan_items_insert
  on public.tomorrow_plan_items
  for insert
  to authenticated
  with check (public.can_manage_project(project_id));

drop policy if exists tomorrow_plan_items_update on public.tomorrow_plan_items;
create policy tomorrow_plan_items_update
  on public.tomorrow_plan_items
  for update
  to authenticated
  using (public.can_manage_project(project_id))
  with check (public.can_manage_project(project_id));

drop policy if exists tomorrow_plan_items_delete on public.tomorrow_plan_items;
create policy tomorrow_plan_items_delete
  on public.tomorrow_plan_items
  for delete
  to authenticated
  using (public.can_manage_project(project_id));

revoke all on table public.tomorrow_plan_items from public, anon;
grant select, insert, update, delete on table public.tomorrow_plan_items to authenticated;
grant all on table public.tomorrow_plan_items to service_role;

notify pgrst, 'reload schema';
