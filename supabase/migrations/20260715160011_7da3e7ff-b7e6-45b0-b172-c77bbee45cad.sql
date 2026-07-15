-- Phase 4: reviewed Daily WIP may recommend an SOV completion position, but
-- billing never changes until a PM explicitly certifies it. Certifications are
-- append-only audit records: a later decision creates a new row instead of
-- rewriting history.
alter table public.daily_wip_entries
  add column if not exists wip_reviewed_at timestamptz,
  add column if not exists wip_reviewed_by uuid;

comment on column public.daily_wip_entries.wip_reviewed_at is
  'Set when a PM saves the work line from Daily WIP. Field-only Daily Log percentages remain unreviewed.';
comment on column public.daily_wip_entries.wip_reviewed_by is
  'Authenticated PM who last reviewed the work line in Daily WIP.';

create table if not exists public.production_sov_certifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cost_bucket_id uuid not null references public.cost_buckets(id) on delete cascade,
  source_wip_entry_id uuid references public.daily_wip_entries(id) on delete set null,
  source_period_start date not null,
  source_period_end date not null,
  current_sov_percent numeric(5,2) not null,
  recommended_percent numeric(5,2) not null,
  certified_percent numeric(5,2) not null,
  target_date date,
  planned_quantity numeric,
  installed_quantity numeric,
  unit text,
  recent_daily_pace numeric,
  required_daily_pace numeric,
  calculation_version text not null default 'production-pace-v1',
  certification_note text not null default '',
  certified_by uuid not null default auth.uid(),
  certified_at timestamptz not null default now(),
  constraint production_sov_certifications_period_check
    check (source_period_end >= source_period_start),
  constraint production_sov_certifications_current_sov_percent_check
    check (current_sov_percent >= 0 and current_sov_percent <= 100),
  constraint production_sov_certifications_recommended_percent_check
    check (recommended_percent >= 0 and recommended_percent <= 100),
  constraint production_sov_certifications_certified_percent_check
    check (certified_percent >= 0 and certified_percent <= 100),
  constraint production_sov_certifications_planned_quantity_check
    check (planned_quantity is null or planned_quantity >= 0),
  constraint production_sov_certifications_installed_quantity_check
    check (installed_quantity is null or installed_quantity >= 0),
  constraint production_sov_certifications_recent_daily_pace_check
    check (recent_daily_pace is null or recent_daily_pace >= 0),
  constraint production_sov_certifications_required_daily_pace_check
    check (required_daily_pace is null or required_daily_pace >= 0)
);

create index if not exists production_sov_certifications_project_certified_idx
  on public.production_sov_certifications(project_id, certified_at desc);

create index if not exists production_sov_certifications_bucket_certified_idx
  on public.production_sov_certifications(cost_bucket_id, certified_at desc);

create or replace function public.tg_validate_production_sov_certification_project()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.source_wip_entry_id is not null and not exists (
    select 1
    from public.cost_buckets
    where id = new.cost_bucket_id
      and project_id = new.project_id
  ) then
    raise exception 'SOV certification cost code must belong to the same project.';
  end if;

  if not exists (
    select 1
    from public.daily_wip_entries
    where id = new.source_wip_entry_id
      and project_id = new.project_id
      and cost_bucket_id = new.cost_bucket_id
  ) then
    raise exception 'SOV certification evidence must belong to the same project and cost code.';
  end if;

  return new;
end;
$$;

drop trigger if exists production_sov_certifications_validate_project
  on public.production_sov_certifications;
create trigger production_sov_certifications_validate_project
  before insert or update of project_id, cost_bucket_id, source_wip_entry_id
  on public.production_sov_certifications
  for each row execute function public.tg_validate_production_sov_certification_project();

alter table public.production_sov_certifications enable row level security;

drop policy if exists production_sov_certifications_team_select
  on public.production_sov_certifications;
create policy production_sov_certifications_team_select
  on public.production_sov_certifications
  for select
  to authenticated
  using (public.can_read_project(project_id));

drop policy if exists production_sov_certifications_team_insert
  on public.production_sov_certifications;
create policy production_sov_certifications_team_insert
  on public.production_sov_certifications
  for insert
  to authenticated
  with check (
    public.can_manage_project(project_id)
    and certified_by = (select auth.uid())
  );

revoke all on table public.production_sov_certifications from anon;
revoke all on table public.production_sov_certifications from authenticated;
grant select, insert on table public.production_sov_certifications to authenticated;
grant all on table public.production_sov_certifications to service_role;

comment on table public.production_sov_certifications is
  'Append-only PM certifications of SOV completion positions recommended from reviewed Daily WIP. Does not modify billing.';
comment on column public.production_sov_certifications.recommended_percent is
  'System recommendation from the latest reviewed SOV-basis Daily WIP evidence in the source period.';
comment on column public.production_sov_certifications.current_sov_percent is
  'SOV earned-completion position that existed when the PM certified the recommendation.';
comment on column public.production_sov_certifications.certified_percent is
  'PM accepted or adjusted SOV completion position. Informational until separately entered into billing.';

notify pgrst, 'reload schema';