alter table public.daily_wip_entries
  add column if not exists people_per_crew smallint not null default 2,
  add column if not exists target_production_rate numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_wip_people_per_crew_check'
      and conrelid = 'public.daily_wip_entries'::regclass
  ) then
    alter table public.daily_wip_entries
      add constraint daily_wip_people_per_crew_check
      check (people_per_crew > 0 and people_per_crew <= 100);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'daily_wip_target_production_rate_check'
      and conrelid = 'public.daily_wip_entries'::regclass
  ) then
    alter table public.daily_wip_entries
      add constraint daily_wip_target_production_rate_check
      check (
        target_production_rate is null
        or (target_production_rate > 0 and target_production_rate <= 1000000000)
      );
  end if;
end $$;

comment on column public.daily_wip_entries.people_per_crew is
  'People assigned to each crew for this work line; legacy rows default to 2.';

comment on column public.daily_wip_entries.target_production_rate is
  'Optional target installed quantity per labor-hour for comparison with actual field production.';

notify pgrst, 'reload schema';