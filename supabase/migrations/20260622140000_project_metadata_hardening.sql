-- Project metadata must be dependable before contractors can onboard jobs.
-- Keep variance derived from dates so the dashboard, portfolio, and reports agree.

alter table public.projects
  add column if not exists job_number text default '',
  add column if not exists project_manager text default '',
  add column if not exists baseline_completion_date date,
  add column if not exists forecast_completion_date date,
  add column if not exists schedule_variance_weeks integer default 0,
  add column if not exists hold_variance_note text default '';

update public.projects
set
  job_number = coalesce(job_number, ''),
  project_manager = coalesce(project_manager, ''),
  schedule_variance_weeks = coalesce(schedule_variance_weeks, 0),
  hold_variance_note = coalesce(hold_variance_note, '');

alter table public.projects
  alter column job_number set default '',
  alter column job_number set not null,
  alter column project_manager set default '',
  alter column project_manager set not null,
  alter column schedule_variance_weeks set default 0,
  alter column schedule_variance_weeks set not null,
  alter column hold_variance_note set default '',
  alter column hold_variance_note set not null;

create or replace function public.tg_projects_calculate_schedule_variance()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.baseline_completion_date is null or new.forecast_completion_date is null then
    new.schedule_variance_weeks := 0;
  else
    new.schedule_variance_weeks :=
      round(((new.forecast_completion_date - new.baseline_completion_date)::numeric) / 7.0)::integer;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_calculate_schedule_variance on public.projects;

create trigger projects_calculate_schedule_variance
before insert or update of baseline_completion_date, forecast_completion_date
on public.projects
for each row
execute function public.tg_projects_calculate_schedule_variance();

update public.projects
set schedule_variance_weeks =
  case
    when baseline_completion_date is null or forecast_completion_date is null then 0
    else round(((forecast_completion_date - baseline_completion_date)::numeric) / 7.0)::integer
  end;
