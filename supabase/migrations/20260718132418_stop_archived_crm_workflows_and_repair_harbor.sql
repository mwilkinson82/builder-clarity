-- CRM lifecycle hardening and Harbor demo schema-cache repair.
--
-- Archiving an opportunity is a terminal CRM action. Stop any active cadence,
-- skip its unfinished work, and stop an incomplete post-award onboarding plan.
-- The trigger covers every write path, not only the current application UI.

alter table public.pipeline_next_actions
  add column if not exists due_date date;

create or replace function public.tg_stop_crm_workflows_on_opportunity_archive()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.archived is true and old.archived is distinct from true then
    update public.crm_followup_enrollments
       set status = 'stopped',
           stop_reason = case
             when length(trim(stop_reason)) > 0 then stop_reason
             else 'Opportunity archived'
           end,
           updated_at = now()
     where organization_id = new.organization_id
       and opportunity_id = new.id
       and status in ('active', 'paused');

    update public.pipeline_next_actions
       set skipped_at = coalesce(skipped_at, now()),
           outcome = case when length(trim(outcome)) > 0 then outcome else 'skipped' end,
           outcome_notes = case
             when length(trim(outcome_notes)) > 0 then outcome_notes
             else 'Opportunity archived; future action closed automatically.'
           end,
           updated_at = now()
     where organization_id = new.organization_id
       and opportunity_id = new.id
       and completed_at is null
       and skipped_at is null;

    update public.crm_onboarding_plans
       set status = 'stopped',
           updated_at = now()
     where organization_id = new.organization_id
       and opportunity_id = new.id
       and status = 'active';
  end if;

  return new;
end;
$$;

revoke all on function public.tg_stop_crm_workflows_on_opportunity_archive() from public, anon, authenticated;
grant execute on function public.tg_stop_crm_workflows_on_opportunity_archive() to service_role;

drop trigger if exists pipeline_opportunities_stop_crm_workflows_on_archive
  on public.pipeline_opportunities;
create trigger pipeline_opportunities_stop_crm_workflows_on_archive
  after update of archived on public.pipeline_opportunities
  for each row
  when (new.archived is true and old.archived is distinct from true)
  execute function public.tg_stop_crm_workflows_on_opportunity_archive();

-- Repair existing orphaned workflows created before the trigger existed.
update public.crm_followup_enrollments enrollment
   set status = 'stopped',
       stop_reason = case
         when length(trim(enrollment.stop_reason)) > 0 then enrollment.stop_reason
         else 'Opportunity archived'
       end,
       updated_at = now()
  from public.pipeline_opportunities opportunity
 where opportunity.id = enrollment.opportunity_id
   and opportunity.organization_id = enrollment.organization_id
   and opportunity.archived is true
   and enrollment.status in ('active', 'paused');

update public.pipeline_next_actions action
   set skipped_at = coalesce(action.skipped_at, now()),
       outcome = case when length(trim(action.outcome)) > 0 then action.outcome else 'skipped' end,
       outcome_notes = case
         when length(trim(action.outcome_notes)) > 0 then action.outcome_notes
         else 'Opportunity archived; future action closed automatically.'
       end,
       updated_at = now()
  from public.pipeline_opportunities opportunity
 where opportunity.id = action.opportunity_id
   and opportunity.organization_id = action.organization_id
   and opportunity.archived is true
   and action.completed_at is null
   and action.skipped_at is null;

update public.crm_onboarding_plans plan
   set status = 'stopped',
       updated_at = now()
  from public.pipeline_opportunities opportunity
 where opportunity.id = plan.opportunity_id
   and opportunity.organization_id = plan.organization_id
   and opportunity.archived is true
   and plan.status = 'active';

-- Harbor's versioned CRM seed previously failed while PostgREST had a stale
-- pipeline_next_actions column cache. Reload it in the same Lovable migration.
notify pgrst, 'reload schema';
