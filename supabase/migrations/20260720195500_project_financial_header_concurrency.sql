-- Project header optimistic concurrency.
--
-- The audited command introduced in 20260720191111 serialized writers, but it
-- did not prove that the editor was saving the version the user actually
-- reviewed. A later writer could therefore silently overwrite a newer header.
-- This replacement requires the exact projects.updated_at observed when the
-- editor opened, includes it in retry evidence, and keeps same-key replays
-- idempotent even after the first command advances the row version.

drop function if exists public.update_project_financial_header_atomic(
  uuid, jsonb, text, text
);

create or replace function public.update_project_financial_header_atomic (
  p_project_id uuid,
  p_patch jsonb,
  p_override_reason text,
  p_expected_updated_at timestamptz,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.projects%rowtype;
  v_after public.projects%rowtype;
  v_existing public.project_financial_operations%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_reason text := btrim(coalesce(p_override_reason, ''));
  v_lifecycle_started boolean := false;
  v_authority_changed boolean := false;
  v_baseline date;
  v_forecast date;
  v_schedule_weeks integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to update a project.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid project operation key is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'The project version you reviewed is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) key
       where key not in (
         'name', 'job_number', 'client', 'project_manager',
         'original_contract', 'original_cost_budget',
         'phase', 'percent_complete', 'hold_variance_note',
         'baseline_completion_date', 'forecast_completion_date',
         'last_review_summary', 'default_output_format'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The project patch is empty or contains unsupported fields.';
  end if;
  if length(v_reason) > 500 then
    raise exception using errcode = '22023', message = 'The project override reason is too long.';
  end if;

  select project.* into v_before
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update this project.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_project_id, p_patch, v_reason, p_expected_updated_at
  )::text);
  select operation.* into v_existing
  from public.project_financial_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'project_header_update'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This project operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'This project changed after you opened it. Refresh the project before saving your edits.';
  end if;

  if p_patch ? 'original_contract' then
    perform public.assert_safe_accounting_cents(
      (p_patch ->> 'original_contract')::numeric * 100,
      'Project original contract'
    );
  end if;
  if p_patch ? 'original_cost_budget' then
    perform public.assert_safe_accounting_cents(
      (p_patch ->> 'original_cost_budget')::numeric * 100,
      'Project original cost budget'
    );
  end if;
  if p_patch ? 'name' and (
    nullif(btrim(p_patch ->> 'name'), '') is null
    or length(p_patch ->> 'name') > 200
  ) then
    raise exception using errcode = '22023', message = 'Project name is required and cannot exceed 200 characters.';
  end if;
  if p_patch ? 'job_number' and length(p_patch ->> 'job_number') > 100
     or p_patch ? 'client' and length(p_patch ->> 'client') > 200
     or p_patch ? 'project_manager' and length(p_patch ->> 'project_manager') > 200
     or p_patch ? 'hold_variance_note' and length(p_patch ->> 'hold_variance_note') > 2000
     or p_patch ? 'last_review_summary' and length(p_patch ->> 'last_review_summary') > 4000
  then
    raise exception using errcode = '22023', message = 'A project header value exceeds its allowed length.';
  end if;
  if p_patch ? 'phase' and (p_patch ->> 'phase') not in ('Early', 'Middle', 'Late') then
    raise exception using errcode = '22023', message = 'Project phase is invalid.';
  end if;
  if p_patch ? 'default_output_format'
     and (p_patch ->> 'default_output_format') not in ('invoice', 'aia_g702')
  then
    raise exception using errcode = '22023', message = 'Default billing output format is invalid.';
  end if;

  v_authority_changed :=
    (p_patch ? 'name' and btrim(p_patch ->> 'name') is distinct from v_before.name)
    or (p_patch ? 'job_number' and btrim(p_patch ->> 'job_number') is distinct from v_before.job_number)
    or (p_patch ? 'client' and btrim(p_patch ->> 'client') is distinct from v_before.client)
    or (p_patch ? 'project_manager' and btrim(p_patch ->> 'project_manager') is distinct from v_before.project_manager)
    or (p_patch ? 'original_contract' and (p_patch ->> 'original_contract')::numeric is distinct from v_before.original_contract)
    or (p_patch ? 'original_cost_budget' and (p_patch ->> 'original_cost_budget')::numeric is distinct from v_before.original_cost_budget);

  v_lifecycle_started := v_before.budget_locked_at is not null
    or coalesce(v_before.percent_complete, 0) > 0
    or v_before.phase <> 'Early'
    or exists (
      select 1 from public.subcontract_payments payment
      where payment.project_id = p_project_id
        and payment.status in ('approved', 'paid')
    )
    or exists (
      select 1 from public.cost_actuals actual
      where actual.project_id = p_project_id
    );

  if v_lifecycle_started and v_authority_changed and length(v_reason) = 0 then
    raise exception using
      errcode = '22023',
      message = 'This project lifecycle has begun. Give an explicit reason to revise a protected project header.';
  end if;

  v_baseline := case
    when p_patch ? 'baseline_completion_date'
      then nullif(p_patch ->> 'baseline_completion_date', '')::date
    else v_before.baseline_completion_date
  end;
  v_forecast := case
    when p_patch ? 'forecast_completion_date'
      then nullif(p_patch ->> 'forecast_completion_date', '')::date
    else v_before.forecast_completion_date
  end;
  v_schedule_weeks := case
    when v_baseline is null or v_forecast is null then 0
    else round((v_forecast - v_baseline)::numeric / 7.0)::integer
  end;

  perform set_config('overwatch.project_financial_command_write', 'on', true);
  update public.projects project set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else project.name end,
    job_number = case when p_patch ? 'job_number' then btrim(p_patch ->> 'job_number') else project.job_number end,
    client = case when p_patch ? 'client' then btrim(p_patch ->> 'client') else project.client end,
    project_manager = case when p_patch ? 'project_manager' then btrim(p_patch ->> 'project_manager') else project.project_manager end,
    original_contract = case when p_patch ? 'original_contract' then (p_patch ->> 'original_contract')::numeric else project.original_contract end,
    original_cost_budget = case when p_patch ? 'original_cost_budget' then (p_patch ->> 'original_cost_budget')::numeric else project.original_cost_budget end,
    phase = case when p_patch ? 'phase' then (p_patch ->> 'phase')::public.project_phase else project.phase end,
    percent_complete = case when p_patch ? 'percent_complete' then (p_patch ->> 'percent_complete')::numeric else project.percent_complete end,
    hold_variance_note = case when p_patch ? 'hold_variance_note' then p_patch ->> 'hold_variance_note' else project.hold_variance_note end,
    baseline_completion_date = v_baseline,
    forecast_completion_date = v_forecast,
    schedule_variance_weeks = v_schedule_weeks,
    last_review_summary = case when p_patch ? 'last_review_summary' then p_patch ->> 'last_review_summary' else project.last_review_summary end,
    default_output_format = case when p_patch ? 'default_output_format' then p_patch ->> 'default_output_format' else project.default_output_format end
  where project.id = p_project_id
    and project.updated_at = p_expected_updated_at
  returning project.* into v_after;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'This project changed before your edits committed. Refresh the project before saving again.';
  end if;

  if v_lifecycle_started and v_authority_changed then
    insert into public.project_financial_overrides (
      project_id, operation_key, field, old_value, new_value,
      reason, changed_by
    )
    select
      p_project_id,
      p_operation_key,
      changed.field,
      changed.old_value,
      changed.new_value,
      v_reason,
      v_user_id
    from (
      values
        ('name', to_jsonb(v_before.name), to_jsonb(v_after.name)),
        ('job_number', to_jsonb(v_before.job_number), to_jsonb(v_after.job_number)),
        ('client', to_jsonb(v_before.client), to_jsonb(v_after.client)),
        ('project_manager', to_jsonb(v_before.project_manager), to_jsonb(v_after.project_manager)),
        ('original_contract', to_jsonb(v_before.original_contract), to_jsonb(v_after.original_contract)),
        ('original_cost_budget', to_jsonb(v_before.original_cost_budget), to_jsonb(v_after.original_cost_budget))
    ) as changed(field, old_value, new_value)
    where changed.old_value is distinct from changed.new_value;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'project', to_jsonb(v_after),
    'overrideRecorded', v_lifecycle_started and v_authority_changed,
    'deduplicated', false
  );
  insert into public.project_financial_operations (
    project_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_project_id, p_operation_key, 'project_header_update',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.update_project_financial_header_atomic(
  uuid, jsonb, text, timestamptz, text
) from public, anon, authenticated, service_role;

grant execute on function public.update_project_financial_header_atomic(
  uuid, jsonb, text, timestamptz, text
) to authenticated;
