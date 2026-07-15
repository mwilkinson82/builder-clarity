-- Harbor Residence is a per-company working copy of a canonical training
-- project. This registry records which version of each demo module has been
-- successfully ensured for that copy. User edits never change the canonical
-- fixtures in code; future module adapters can explicitly reset only the
-- stable demo-owned records they manage.

create table if not exists public.demo_seed_module_versions (
  project_id uuid not null references public.projects(id) on delete cascade,
  module_key text not null,
  applied_version integer not null default 0,
  status text not null default 'ready',
  last_operation text not null default 'ensure',
  last_error text not null default '',
  last_seeded_by uuid not null default auth.uid(),
  first_seeded_at timestamptz not null default now(),
  last_seeded_at timestamptz not null default now(),
  last_reset_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, module_key),
  constraint demo_seed_module_versions_module_key_check
    check (btrim(module_key) <> ''),
  constraint demo_seed_module_versions_applied_version_check
    check (applied_version >= 0),
  constraint demo_seed_module_versions_status_check
    check (status in ('ready', 'failed')),
  constraint demo_seed_module_versions_operation_check
    check (last_operation in ('ensure', 'reset'))
);

comment on table public.demo_seed_module_versions is
  'Per-project Harbor demo module version registry. Canonical fixture definitions remain in application code.';
comment on column public.demo_seed_module_versions.applied_version is
  'Latest fixture version successfully ensured or reset for this Harbor project copy.';
comment on column public.demo_seed_module_versions.last_operation is
  'Whether the latest module run was a non-destructive ensure or an explicit reset.';

create index if not exists demo_seed_module_versions_project_status_idx
  on public.demo_seed_module_versions(project_id, status, module_key);

drop trigger if exists demo_seed_module_versions_set_updated_at
  on public.demo_seed_module_versions;
create trigger demo_seed_module_versions_set_updated_at
  before update on public.demo_seed_module_versions
  for each row execute function public.tg_set_updated_at();

alter table public.demo_seed_module_versions enable row level security;

drop policy if exists demo_seed_module_versions_team_select
  on public.demo_seed_module_versions;
create policy demo_seed_module_versions_team_select
  on public.demo_seed_module_versions
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists demo_seed_module_versions_team_insert
  on public.demo_seed_module_versions;
create policy demo_seed_module_versions_team_insert
  on public.demo_seed_module_versions
  for insert to authenticated
  with check (
    public.can_manage_project(project_id)
    and last_seeded_by = (select auth.uid())
  );

drop policy if exists demo_seed_module_versions_team_update
  on public.demo_seed_module_versions;
create policy demo_seed_module_versions_team_update
  on public.demo_seed_module_versions
  for update to authenticated
  using (public.can_manage_project(project_id))
  with check (
    public.can_manage_project(project_id)
    and last_seeded_by = (select auth.uid())
  );

drop policy if exists demo_seed_module_versions_team_delete
  on public.demo_seed_module_versions;
create policy demo_seed_module_versions_team_delete
  on public.demo_seed_module_versions
  for delete to authenticated
  using (public.can_manage_project(project_id));

revoke all on table public.demo_seed_module_versions from public, anon;
revoke all on table public.demo_seed_module_versions from authenticated;
grant select, insert, update, delete on table public.demo_seed_module_versions to authenticated;
grant all on table public.demo_seed_module_versions to service_role;

notify pgrst, 'reload schema';