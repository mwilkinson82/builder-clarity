-- Slice 3: reviewed Daily WIP recommends CPM activity progress, but never
-- changes the schedule without an explicit PM decision. Activity controls are
-- editable; progress reviews are append-only audit records.

create table if not exists public.schedule_activity_progress_controls (
  schedule_activity_id uuid primary key
    references public.schedule_activities(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  basis text not null default 'reviewed_percent',
  planned_quantity numeric,
  unit text not null default '',
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_activity_progress_controls_basis_check
    check (basis in ('reviewed_percent', 'installed_quantity')),
  constraint schedule_activity_progress_controls_quantity_check
    check (planned_quantity is null or planned_quantity > 0),
  constraint schedule_activity_progress_controls_quantity_basis_check
    check (
      basis <> 'installed_quantity'
      or (planned_quantity is not null and planned_quantity > 0 and btrim(unit) <> '')
    )
);

comment on table public.schedule_activity_progress_controls is
  'PM-selected evidence basis used to recommend CPM activity progress from reviewed Daily WIP.';

create table if not exists public.schedule_activity_progress_reviews (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  schedule_activity_id uuid not null
    references public.schedule_activities(id) on delete cascade,
  source_wip_entry_id uuid references public.daily_wip_entries(id) on delete set null,
  source_period_start date not null,
  source_period_end date not null,
  basis text not null,
  planned_quantity numeric,
  installed_quantity numeric,
  unit text not null default '',
  current_percent numeric(5,2) not null,
  recommended_percent numeric(5,2) not null,
  accepted_percent numeric(5,2) not null,
  decision text not null,
  review_note text not null default '',
  source_snapshot jsonb not null default '{}'::jsonb,
  calculation_version text not null default 'daily-wip-cpm-v1',
  reviewed_by uuid not null default auth.uid(),
  reviewed_at timestamptz not null default now(),
  constraint schedule_activity_progress_reviews_period_check
    check (source_period_end >= source_period_start),
  constraint schedule_activity_progress_reviews_basis_check
    check (basis in ('reviewed_percent', 'installed_quantity')),
  constraint schedule_activity_progress_reviews_decision_check
    check (decision in ('accepted', 'kept', 'overridden')),
  constraint schedule_activity_progress_reviews_current_check
    check (current_percent >= 0 and current_percent <= 100),
  constraint schedule_activity_progress_reviews_recommended_check
    check (recommended_percent >= 0 and recommended_percent <= 100),
  constraint schedule_activity_progress_reviews_accepted_check
    check (accepted_percent >= 0 and accepted_percent <= 100),
  constraint schedule_activity_progress_reviews_planned_check
    check (planned_quantity is null or planned_quantity > 0),
  constraint schedule_activity_progress_reviews_installed_check
    check (installed_quantity is null or installed_quantity >= 0),
  constraint schedule_activity_progress_reviews_quantity_basis_check
    check (
      basis <> 'installed_quantity'
      or (
        planned_quantity is not null
        and planned_quantity > 0
        and installed_quantity is not null
        and installed_quantity >= 0
        and btrim(unit) <> ''
      )
    ),
  constraint schedule_activity_progress_reviews_decision_value_check
    check (
      (decision = 'accepted' and abs(accepted_percent - recommended_percent) <= 0.01)
      or (decision = 'kept' and abs(accepted_percent - current_percent) <= 0.01)
      or (
        decision = 'overridden'
        and abs(accepted_percent - recommended_percent) > 0.01
        and abs(accepted_percent - current_percent) > 0.01
      )
    ),
  constraint schedule_activity_progress_reviews_override_note_check
    check (decision <> 'overridden' or btrim(review_note) <> '')
);

comment on table public.schedule_activity_progress_reviews is
  'Append-only CPM progress decisions showing the Daily WIP recommendation, accepted value, actor, and evidence snapshot.';

create index if not exists schedule_activity_progress_controls_project_idx
  on public.schedule_activity_progress_controls(project_id, schedule_activity_id);

create index if not exists schedule_activity_progress_reviews_project_reviewed_idx
  on public.schedule_activity_progress_reviews(project_id, reviewed_at desc);

create index if not exists schedule_activity_progress_reviews_activity_reviewed_idx
  on public.schedule_activity_progress_reviews(schedule_activity_id, reviewed_at desc);

create index if not exists schedule_activity_progress_reviews_source_wip_idx
  on public.schedule_activity_progress_reviews(source_wip_entry_id)
  where source_wip_entry_id is not null;

create or replace function public.tg_validate_schedule_activity_progress_project()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (
    select 1
    from public.schedule_activities
    where id = new.schedule_activity_id
      and project_id = new.project_id
  ) then
    raise exception 'CPM progress activity must belong to the same project.';
  end if;

  return new;
end;
$$;

create or replace function public.tg_validate_schedule_activity_progress_evidence()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.source_wip_entry_id is null then
    raise exception 'CPM progress decisions require reviewed Daily WIP evidence.';
  end if;

  if not exists (
    select 1
    from public.daily_wip_entries
    where id = new.source_wip_entry_id
      and project_id = new.project_id
      and schedule_activity_id = new.schedule_activity_id
      and wip_reviewed_at is not null
  ) then
    raise exception 'CPM progress evidence must be reviewed Daily WIP for the same project and activity.';
  end if;

  return new;
end;
$$;

drop trigger if exists schedule_activity_progress_controls_validate_project
  on public.schedule_activity_progress_controls;
create trigger schedule_activity_progress_controls_validate_project
  before insert or update of project_id, schedule_activity_id
  on public.schedule_activity_progress_controls
  for each row execute function public.tg_validate_schedule_activity_progress_project();

drop trigger if exists schedule_activity_progress_reviews_validate_project
  on public.schedule_activity_progress_reviews;
create trigger schedule_activity_progress_reviews_validate_project
  before insert on public.schedule_activity_progress_reviews
  for each row execute function public.tg_validate_schedule_activity_progress_project();

drop trigger if exists schedule_activity_progress_reviews_validate_evidence
  on public.schedule_activity_progress_reviews;
create trigger schedule_activity_progress_reviews_validate_evidence
  before insert on public.schedule_activity_progress_reviews
  for each row execute function public.tg_validate_schedule_activity_progress_evidence();

drop trigger if exists schedule_activity_progress_controls_set_updated_at
  on public.schedule_activity_progress_controls;
create trigger schedule_activity_progress_controls_set_updated_at
  before update on public.schedule_activity_progress_controls
  for each row execute function public.tg_set_updated_at();

alter table public.schedule_activity_progress_controls enable row level security;
alter table public.schedule_activity_progress_reviews enable row level security;

drop policy if exists schedule_activity_progress_controls_team_select
  on public.schedule_activity_progress_controls;
create policy schedule_activity_progress_controls_team_select
  on public.schedule_activity_progress_controls
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists schedule_activity_progress_controls_team_insert
  on public.schedule_activity_progress_controls;
create policy schedule_activity_progress_controls_team_insert
  on public.schedule_activity_progress_controls
  for insert to authenticated
  with check (
    public.can_manage_project(project_id)
    and updated_by = (select auth.uid())
  );

drop policy if exists schedule_activity_progress_controls_team_update
  on public.schedule_activity_progress_controls;
create policy schedule_activity_progress_controls_team_update
  on public.schedule_activity_progress_controls
  for update to authenticated
  using (public.can_manage_project(project_id))
  with check (
    public.can_manage_project(project_id)
    and updated_by = (select auth.uid())
  );

drop policy if exists schedule_activity_progress_reviews_team_select
  on public.schedule_activity_progress_reviews;
create policy schedule_activity_progress_reviews_team_select
  on public.schedule_activity_progress_reviews
  for select to authenticated
  using (public.can_read_project(project_id));

drop policy if exists schedule_activity_progress_reviews_team_insert
  on public.schedule_activity_progress_reviews;
create policy schedule_activity_progress_reviews_team_insert
  on public.schedule_activity_progress_reviews
  for insert to authenticated
  with check (
    public.can_manage_project(project_id)
    and reviewed_by = (select auth.uid())
  );

revoke all on table public.schedule_activity_progress_controls from public, anon;
revoke all on table public.schedule_activity_progress_controls from authenticated;
grant select, insert, update on table public.schedule_activity_progress_controls to authenticated;
grant all on table public.schedule_activity_progress_controls to service_role;

revoke all on table public.schedule_activity_progress_reviews from public, anon;
revoke all on table public.schedule_activity_progress_reviews from authenticated;
grant select, insert on table public.schedule_activity_progress_reviews to authenticated;
grant all on table public.schedule_activity_progress_reviews to service_role;

create or replace function public.apply_wip_schedule_progress_review(
  p_project_id uuid,
  p_schedule_activity_id uuid,
  p_source_wip_entry_id uuid,
  p_source_period_start date,
  p_source_period_end date,
  p_basis text,
  p_planned_quantity numeric,
  p_installed_quantity numeric,
  p_unit text,
  p_current_percent numeric,
  p_recommended_percent numeric,
  p_accepted_percent numeric,
  p_decision text,
  p_note text,
  p_source_snapshot jsonb
)
returns public.schedule_activity_progress_reviews
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current_percent numeric;
  v_review public.schedule_activity_progress_reviews;
begin
  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to change this project schedule.';
  end if;

  select percent_complete
  into v_current_percent
  from public.schedule_activities
  where id = p_schedule_activity_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception 'Schedule activity not found for this project.';
  end if;

  if abs(v_current_percent - p_current_percent) > 0.01 then
    raise exception 'Schedule progress changed while you were reviewing it. Refresh and review the new value.';
  end if;

  if not exists (
    select 1
    from public.daily_wip_entries
    where id = p_source_wip_entry_id
      and project_id = p_project_id
      and schedule_activity_id = p_schedule_activity_id
      and wip_reviewed_at is not null
  ) then
    raise exception 'Review the linked Daily WIP evidence before changing CPM progress.';
  end if;

  if p_decision not in ('accepted', 'kept', 'overridden') then
    raise exception 'Choose whether to accept the recommendation, keep CPM as-is, or apply a different value.';
  end if;

  insert into public.schedule_activity_progress_reviews (
    project_id,
    schedule_activity_id,
    source_wip_entry_id,
    source_period_start,
    source_period_end,
    basis,
    planned_quantity,
    installed_quantity,
    unit,
    current_percent,
    recommended_percent,
    accepted_percent,
    decision,
    review_note,
    source_snapshot,
    reviewed_by
  ) values (
    p_project_id,
    p_schedule_activity_id,
    p_source_wip_entry_id,
    p_source_period_start,
    p_source_period_end,
    p_basis,
    p_planned_quantity,
    p_installed_quantity,
    coalesce(p_unit, ''),
    v_current_percent,
    p_recommended_percent,
    p_accepted_percent,
    p_decision,
    coalesce(p_note, ''),
    coalesce(p_source_snapshot, '{}'::jsonb),
    auth.uid()
  )
  returning * into v_review;

  if p_decision <> 'kept' then
    update public.schedule_activities
    set percent_complete = p_accepted_percent,
        updated_at = now()
    where id = p_schedule_activity_id
      and project_id = p_project_id;
  end if;

  return v_review;
end;
$$;

revoke all on function public.apply_wip_schedule_progress_review(
  uuid, uuid, uuid, date, date, text, numeric, numeric, text,
  numeric, numeric, numeric, text, text, jsonb
) from public, anon;
grant execute on function public.apply_wip_schedule_progress_review(
  uuid, uuid, uuid, date, date, text, numeric, numeric, text,
  numeric, numeric, numeric, text, text, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';
