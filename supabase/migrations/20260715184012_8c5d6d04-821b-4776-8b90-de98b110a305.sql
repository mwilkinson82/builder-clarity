-- Phase 5: bridge the PM's certified production position into Billing without
-- auto-creating, submitting, or approving a pay application. Billing remains
-- an explicit accounting workflow: a biller chooses an existing draft and
-- applies one PM certification to its matching G703/SOV line.

create table if not exists public.production_sov_billing_handoffs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  production_sov_certification_id uuid not null
    references public.production_sov_certifications(id) on delete restrict,
  billing_application_id uuid references public.billing_applications(id) on delete set null,
  billing_line_item_id uuid references public.billing_line_items(id) on delete set null,
  cost_bucket_id uuid not null references public.cost_buckets(id) on delete restrict,
  application_number_snapshot text not null default '',
  cost_code_snapshot text not null default '',
  description_snapshot text not null default '',
  certified_percent numeric(5,2) not null,
  contract_value_cents bigint not null,
  prior_completed_and_stored_cents bigint not null,
  prior_draft_work_cents bigint not null,
  retained_draft_materials_cents bigint not null,
  applied_work_this_period_cents bigint not null,
  applied_total_completed_and_stored_cents bigint not null,
  applied_by uuid not null default auth.uid(),
  applied_at timestamptz not null default now(),
  constraint production_sov_billing_handoffs_certification_unique
    unique (production_sov_certification_id),
  constraint production_sov_billing_handoffs_percent_check
    check (certified_percent >= 0 and certified_percent <= 100),
  constraint production_sov_billing_handoffs_money_check
    check (
      contract_value_cents >= 0
      and prior_completed_and_stored_cents >= 0
      and prior_draft_work_cents >= 0
      and retained_draft_materials_cents >= 0
      and applied_work_this_period_cents >= 0
      and applied_total_completed_and_stored_cents >= 0
    )
);

create index if not exists production_sov_billing_handoffs_project_applied_idx
  on public.production_sov_billing_handoffs(project_id, applied_at desc);

create index if not exists production_sov_billing_handoffs_application_idx
  on public.production_sov_billing_handoffs(billing_application_id, applied_at desc)
  where billing_application_id is not null;

alter table public.production_sov_billing_handoffs enable row level security;

drop policy if exists production_sov_billing_handoffs_team_select
  on public.production_sov_billing_handoffs;
create policy production_sov_billing_handoffs_team_select
  on public.production_sov_billing_handoffs
  for select
  to authenticated
  using (public.can_read_project(project_id));

revoke all on table public.production_sov_billing_handoffs from anon;
revoke all on table public.production_sov_billing_handoffs from authenticated;
grant select on table public.production_sov_billing_handoffs to authenticated;
grant all on table public.production_sov_billing_handoffs to service_role;

comment on table public.production_sov_billing_handoffs is
  'Append-only audit of an accounting user applying a PM-certified SOV position to an existing draft billing application.';
comment on column public.production_sov_billing_handoffs.prior_draft_work_cents is
  'Work-completed amount already entered in the draft before the certified position replaced it.';
comment on column public.production_sov_billing_handoffs.retained_draft_materials_cents is
  'Current-period stored materials preserved when the certified cumulative billing position was applied.';

create or replace function public.apply_production_sov_certification_to_billing(
  p_certification_id uuid,
  p_billing_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_cert public.production_sov_certifications%rowtype;
  v_app public.billing_applications%rowtype;
  v_line public.billing_line_items%rowtype;
  v_handoff_id uuid;
  v_contract_value_cents bigint;
  v_target_total_cents bigint;
  v_prior_total_cents bigint;
  v_minimum_with_current_stored_cents bigint;
  v_applied_work_cents bigint;
  v_delta_cents bigint;
begin
  if v_user_id is null then
    raise exception 'Sign in before applying a certified billing position.';
  end if;

  select * into v_cert
  from public.production_sov_certifications
  where id = p_certification_id
  for update;

  if not found then
    raise exception 'The PM certification was not found.';
  end if;

  if not public.can_manage_project(v_cert.project_id) then
    raise exception 'You do not have permission to manage billing for this project.';
  end if;

  if exists (
    select 1
    from public.production_sov_billing_handoffs
    where production_sov_certification_id = v_cert.id
  ) then
    raise exception 'This PM certification has already been handed off to Billing.';
  end if;

  if exists (
    select 1
    from public.production_sov_certifications newer
    where newer.project_id = v_cert.project_id
      and newer.cost_bucket_id = v_cert.cost_bucket_id
      and newer.certified_at > v_cert.certified_at
  ) then
    raise exception 'A newer PM certification exists for this SOV line. Apply the latest decision.';
  end if;

  if exists (
    select 1
    from public.daily_wip_entries wip
    where wip.project_id = v_cert.project_id
      and wip.cost_bucket_id = v_cert.cost_bucket_id
      and wip.percent_basis = 'sov'
      and wip.wip_reviewed_at is not null
      and wip.wip_reviewed_at > v_cert.certified_at
  ) then
    raise exception 'Newer reviewed Daily WIP exists for this SOV line. The PM must certify the current position before Billing applies it.';
  end if;

  select * into v_app
  from public.billing_applications
  where id = p_billing_application_id
  for update;

  if not found or v_app.project_id <> v_cert.project_id then
    raise exception 'The selected billing application does not belong to this certification project.';
  end if;

  if v_app.status <> 'draft' then
    raise exception 'Certified positions can only be applied to an existing draft billing application.';
  end if;

  select * into v_line
  from public.billing_line_items
  where billing_application_id = v_app.id
    and project_id = v_cert.project_id
    and cost_bucket_id = v_cert.cost_bucket_id
  for update;

  if not found then
    raise exception 'Import the project SOV into this draft before applying the PM certification.';
  end if;

  v_contract_value_cents := v_line.scheduled_value_cents + v_line.change_order_value_cents;
  if v_contract_value_cents <= 0 then
    raise exception 'This SOV line has no billable contract value.';
  end if;

  v_target_total_cents := round(
    v_contract_value_cents::numeric * v_cert.certified_percent / 100
  )::bigint;
  v_prior_total_cents :=
    v_line.work_completed_previous_cents + v_line.materials_stored_previous_cents;
  v_minimum_with_current_stored_cents :=
    v_prior_total_cents + v_line.materials_stored_this_period_cents;

  if v_target_total_cents < v_prior_total_cents then
    raise exception 'The PM-certified position is below the amount certified on prior applications.';
  end if;

  if v_target_total_cents < v_minimum_with_current_stored_cents then
    raise exception 'Current stored materials already exceed the PM-certified position. Adjust stored materials or obtain a new PM certification.';
  end if;

  v_applied_work_cents := v_target_total_cents - v_minimum_with_current_stored_cents;
  v_delta_cents := v_applied_work_cents - v_line.work_completed_this_period_cents;

  update public.billing_line_items
  set work_completed_this_period_cents = v_applied_work_cents
  where id = v_line.id;

  insert into public.production_sov_billing_handoffs (
    project_id,
    production_sov_certification_id,
    billing_application_id,
    billing_line_item_id,
    cost_bucket_id,
    application_number_snapshot,
    cost_code_snapshot,
    description_snapshot,
    certified_percent,
    contract_value_cents,
    prior_completed_and_stored_cents,
    prior_draft_work_cents,
    retained_draft_materials_cents,
    applied_work_this_period_cents,
    applied_total_completed_and_stored_cents,
    applied_by
  ) values (
    v_cert.project_id,
    v_cert.id,
    v_app.id,
    v_line.id,
    v_cert.cost_bucket_id,
    v_app.application_number,
    v_line.cost_code,
    v_line.description,
    v_cert.certified_percent,
    v_contract_value_cents,
    v_prior_total_cents,
    v_line.work_completed_this_period_cents,
    v_line.materials_stored_this_period_cents,
    v_applied_work_cents,
    v_target_total_cents,
    v_user_id
  )
  returning id into v_handoff_id;

  perform public.sync_billing_application_from_lines(v_app.id);

  insert into public.billing_application_events (
    billing_application_id,
    project_id,
    event_type,
    from_status,
    to_status,
    amount,
    notes,
    created_by
  ) values (
    v_app.id,
    v_cert.project_id,
    'pm_certification_applied',
    'draft',
    'draft',
    v_delta_cents::numeric / 100,
    format(
      'Billing applied PM-certified SOV position %s%% to %s. Draft remains unsubmitted.',
      trim(to_char(v_cert.certified_percent, '990D00')),
      coalesce(nullif(v_line.cost_code, ''), v_line.description)
    ),
    v_user_id
  );

  return jsonb_build_object(
    'handoff_id', v_handoff_id,
    'billing_application_id', v_app.id,
    'billing_line_item_id', v_line.id,
    'certified_percent', v_cert.certified_percent,
    'applied_work_this_period_cents', v_applied_work_cents,
    'applied_total_completed_and_stored_cents', v_target_total_cents,
    'delta_cents', v_delta_cents,
    'application_status', 'draft'
  );
end;
$$;

revoke all on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  from public;
grant execute on function public.apply_production_sov_certification_to_billing(uuid, uuid)
  to authenticated, service_role;

comment on function public.apply_production_sov_certification_to_billing(uuid, uuid) is
  'Explicit accounting handoff: applies the latest non-stale PM certification to one matching line in an existing draft, preserves stored materials, syncs the application, and writes an append-only audit event.';

notify pgrst, 'reload schema';