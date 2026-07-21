-- Exposure allocation financial integrity.
--
-- Risk dollars affect the live At Risk / Contingency budget columns. They are
-- therefore financial authority, not ordinary editable metadata. This layer
-- makes every allocation mutation atomic, replay-safe, cent-exact, versioned,
-- project-scoped, and permanently journaled.

alter table public.exposure_allocations
  add column if not exists version bigint not null default 1;

do $$
begin
  if exists (
    select 1
    from public.exposure_allocations allocation
    join public.exposures exposure on exposure.id = allocation.exposure_id
    left join public.cost_buckets bucket on bucket.id = allocation.cost_bucket_id
    where allocation.project_id <> exposure.project_id
       or allocation.cost_bucket_id is null
       or bucket.id is null
       or bucket.project_id <> allocation.project_id
       or allocation.amount < 0
       or allocation.amount * 100 <> trunc(allocation.amount * 100)
       or abs(allocation.amount * 100) > 9007199254740991
  ) then
    raise exception using
      errcode = '23514',
      message = 'Exposure allocation upgrade blocked: legacy rows have invalid project, cost-code, or cent values.';
  end if;

  if exists (
    select 1
    from public.exposures exposure
    where exposure.dollar_exposure < 0
       or exposure.dollar_exposure * 100 <> trunc(exposure.dollar_exposure * 100)
       or abs(exposure.dollar_exposure * 100) > 9007199254740991
  ) then
    raise exception using
      errcode = '23514',
      message = 'Exposure allocation upgrade blocked: legacy exposure values are not exact safe cents.';
  end if;

  if exists (
    select 1
    from public.exposures exposure
    join public.exposure_allocations allocation on allocation.exposure_id = exposure.id
    group by exposure.id, exposure.dollar_exposure
    having sum(allocation.amount * 100) > exposure.dollar_exposure * 100
  ) then
    raise exception using
      errcode = '23514',
      message = 'Exposure allocation upgrade blocked: a legacy exposure is over-allocated.';
  end if;
end;
$$;

alter table public.exposures
  drop constraint if exists exposures_dollar_exposure_safe_cents_check,
  add constraint exposures_dollar_exposure_safe_cents_check check (
    dollar_exposure >= 0
    and dollar_exposure * 100 = trunc(dollar_exposure * 100)
    and abs(dollar_exposure * 100) <= 9007199254740991
  );

alter table public.exposure_allocations
  drop constraint if exists exposure_allocations_safe_cents_check,
  drop constraint if exists exposure_allocations_version_check,
  add constraint exposure_allocations_safe_cents_check check (
    amount >= 0
    and amount * 100 = trunc(amount * 100)
    and abs(amount * 100) <= 9007199254740991
  ),
  add constraint exposure_allocations_version_check check (version > 0);

-- An allocated risk cannot be erased as a side effect of deleting a parent.
-- The user must remove each allocation through the journaled command first.
alter table public.exposure_allocations
  drop constraint if exists exposure_allocations_project_id_fkey,
  drop constraint if exists exposure_allocations_exposure_id_fkey,
  drop constraint if exists exposure_allocations_cost_bucket_id_fkey,
  add constraint exposure_allocations_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete restrict,
  add constraint exposure_allocations_exposure_id_fkey
    foreign key (exposure_id) references public.exposures (id) on delete restrict,
  add constraint exposure_allocations_cost_bucket_id_fkey
    foreign key (cost_bucket_id) references public.cost_buckets (id) on delete restrict;

-- EXCEPTION to the RESTRICT above, without weakening it: this batch's own
-- audited commands legitimately delete cost buckets (delete-line, replace
-- import, estimate conversion). Deleting a cost line must return its
-- allocated risk dollars to the unallocated pool — silently keeping (or
-- orphaning) the allocation would misstate remaining exposure. This BEFORE
-- DELETE trigger removes the bucket's allocations and journals each removal
-- as immutable evidence, so the RESTRICT never fires for a command delete
-- while direct child erasure stays impossible.
create or replace function public.tg_cascade_bucket_exposure_allocations()
returns trigger
language plpgsql
security definer
set search_path = '' as $$
declare
  v_allocation public.exposure_allocations%rowtype;
begin
  for v_allocation in
    select allocation.*
    from public.exposure_allocations allocation
    where allocation.cost_bucket_id = old.id
    order by allocation.id
    for update
  loop
    insert into public.exposure_allocation_operations (
      project_id, exposure_id, allocation_id, operation_key, operation_type,
      request_fingerprint, result, changed_by
    ) values (
      v_allocation.project_id,
      v_allocation.exposure_id,
      v_allocation.id,
      'bucket-cascade:' || v_allocation.id::text,
      'allocation_delete',
      md5(jsonb_build_array('bucket-cascade', old.id, v_allocation.id)::text),
      jsonb_build_object(
        'ok', true,
        'cascade', 'cost_bucket_delete',
        'cost_bucket_id', old.id,
        'removed_allocation', to_jsonb(v_allocation)
      ),
      coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    )
    on conflict (changed_by, operation_key) do nothing;

    delete from public.exposure_allocations allocation
    where allocation.id = v_allocation.id;
  end loop;
  return old;
end;
$$;

revoke all on function public.tg_cascade_bucket_exposure_allocations ()
  from public, anon, authenticated, service_role;

drop trigger if exists cost_buckets_cascade_exposure_allocations on public.cost_buckets;
create trigger cost_buckets_cascade_exposure_allocations
  before delete on public.cost_buckets
  for each row execute function public.tg_cascade_bucket_exposure_allocations();

create table if not exists public.exposure_allocation_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  exposure_id uuid not null,
  allocation_id uuid not null,
  operation_key text not null,
  operation_type text not null check (
    operation_type in ('allocation_create', 'allocation_update', 'allocation_delete')
  ),
  request_fingerprint text not null,
  result jsonb not null,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint exposure_allocation_operations_key_length
    check (length(btrim(operation_key)) between 1 and 200),
  constraint exposure_allocation_operations_actor_key_unique
    unique (changed_by, operation_key)
);

alter table public.exposure_allocation_operations
  drop constraint if exists exposure_allocation_operations_project_id_fkey,
  add constraint exposure_allocation_operations_project_id_fkey
    foreign key (project_id) references public.projects (id) on delete restrict;

create index if not exists exposure_allocation_operations_exposure_created_idx
  on public.exposure_allocation_operations (exposure_id, created_at desc);

alter table public.exposure_allocation_operations enable row level security;

revoke all on table public.exposure_allocation_operations
  from public, anon, authenticated, service_role;
grant select on table public.exposure_allocation_operations
  to authenticated, service_role;

drop policy if exists exposure_allocation_operations_select
  on public.exposure_allocation_operations;
create policy exposure_allocation_operations_select
  on public.exposure_allocation_operations
  for select to authenticated
  using (public.can_read_project(project_id));

drop trigger if exists exposure_allocation_operations_immutable
  on public.exposure_allocation_operations;
create trigger exposure_allocation_operations_immutable
  before update or delete on public.exposure_allocation_operations
  for each row execute function public.reject_financial_journal_mutation();

-- Parent exposure edits must preserve the same cap enforced by allocation
-- commands. Otherwise lowering a risk value could manufacture an invalid
-- over-allocation without touching the allocation table itself.
create or replace function public.validate_exposure_allocation_parent_integrity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_allocated_cents numeric := 0;
begin
  perform public.assert_safe_accounting_cents(
    new.dollar_exposure * 100,
    'Exposure value'
  );

  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    if exists (
      select 1
      from public.exposure_allocations allocation
      where allocation.exposure_id = old.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'An exposure with financial allocations cannot move to another project.';
    end if;
  end if;

  if tg_op = 'UPDATE' and new.dollar_exposure is distinct from old.dollar_exposure then
    perform 1
    from public.exposure_allocations allocation
    where allocation.exposure_id = old.id
    order by allocation.id
    for update;

    select coalesce(sum(allocation.amount * 100), 0)
      into v_allocated_cents
    from public.exposure_allocations allocation
    where allocation.exposure_id = old.id;

    if v_allocated_cents > new.dollar_exposure * 100 then
      raise exception using
        errcode = '23514',
        message = 'Exposure value cannot be lower than its current cost-code allocations.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.validate_exposure_allocation_parent_integrity()
  from public, anon, authenticated, service_role;

drop trigger if exists exposures_validate_allocation_parent_integrity
  on public.exposures;
create trigger exposures_validate_allocation_parent_integrity
  before insert or update of project_id, dollar_exposure on public.exposures
  for each row execute function public.validate_exposure_allocation_parent_integrity();

create or replace function public.create_exposure_allocation_atomic(
  p_project_id uuid,
  p_exposure_id uuid,
  p_cost_bucket_id uuid,
  p_amount_cents numeric,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.exposure_allocation_operations%rowtype;
  v_project_id uuid;
  v_exposure public.exposures%rowtype;
  v_bucket public.cost_buckets%rowtype;
  v_allocation public.exposure_allocations%rowtype;
  v_allocated_cents numeric := 0;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to allocate an exposure.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid exposure allocation operation key is required.';
  end if;

  perform public.assert_safe_accounting_cents(p_amount_cents, 'Exposure allocation');
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Exposure allocation must be greater than zero.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_project_id, p_exposure_id, p_cost_bucket_id, p_amount_cents
  )::text);

  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_create'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to allocate this exposure.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select project.id into v_project_id
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to allocate this exposure.';
  end if;

  select exposure.* into v_exposure
  from public.exposures exposure
  where exposure.id = p_exposure_id
  for update;
  if not found or v_exposure.project_id <> p_project_id then
    raise exception using errcode = '23503', message = 'Exposure not found on this project.';
  end if;
  if v_exposure.status not in ('active', 'escalated') then
    raise exception using errcode = '23514', message = 'Only a live exposure can be allocated.';
  end if;
  perform public.assert_safe_accounting_cents(v_exposure.dollar_exposure * 100, 'Exposure value');

  -- The parent lock serializes same-exposure commands. Recheck the journal
  -- after waiting so simultaneous retries cannot both mutate.
  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_create'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select bucket.* into v_bucket
  from public.cost_buckets bucket
  where bucket.id = p_cost_bucket_id
  for update;
  if not found or v_bucket.project_id <> p_project_id then
    raise exception using errcode = '23503', message = 'Cost code not found on this project.';
  end if;
  if nullif(btrim(v_bucket.cost_code), '') is null then
    raise exception using errcode = '23514', message = 'Risk can only be allocated to a coded budget line.';
  end if;

  perform 1
  from public.exposure_allocations allocation
  where allocation.exposure_id = p_exposure_id
  order by allocation.id
  for update;

  select coalesce(sum(allocation.amount * 100), 0)
    into v_allocated_cents
  from public.exposure_allocations allocation
  where allocation.exposure_id = p_exposure_id;

  if v_allocated_cents + p_amount_cents > v_exposure.dollar_exposure * 100 then
    raise exception using
      errcode = '23514',
      message = 'Total allocations cannot exceed the authoritative exposure value.';
  end if;

  insert into public.exposure_allocations (
    project_id, exposure_id, cost_bucket_id, cost_code, amount, version
  ) values (
    p_project_id, p_exposure_id, p_cost_bucket_id, v_bucket.cost_code,
    p_amount_cents / 100.0, 1
  ) returning * into v_allocation;

  v_result := jsonb_build_object(
    'ok', true,
    'allocationId', v_allocation.id,
    'projectId', v_allocation.project_id,
    'exposureId', v_allocation.exposure_id,
    'costBucketId', v_allocation.cost_bucket_id,
    'costCode', v_allocation.cost_code,
    'amountCents', v_allocation.amount * 100,
    'version', v_allocation.version,
    'updatedAt', v_allocation.updated_at,
    'deduplicated', false
  );

  insert into public.exposure_allocation_operations (
    project_id, exposure_id, allocation_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_project_id, p_exposure_id, v_allocation.id, btrim(p_operation_key),
    'allocation_create', v_fingerprint, v_result, v_user_id
  );

  return v_result;
end;
$$;

create or replace function public.update_exposure_allocation_atomic(
  p_allocation_id uuid,
  p_cost_bucket_id uuid,
  p_amount_cents numeric,
  p_expected_version bigint,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.exposure_allocation_operations%rowtype;
  v_locator record;
  v_project_id uuid;
  v_exposure public.exposures%rowtype;
  v_bucket public.cost_buckets%rowtype;
  v_before public.exposure_allocations%rowtype;
  v_after public.exposure_allocations%rowtype;
  v_other_allocated_cents numeric := 0;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to update an exposure allocation.';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'The expected exposure allocation version is required.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid exposure allocation operation key is required.';
  end if;
  perform public.assert_safe_accounting_cents(p_amount_cents, 'Exposure allocation');
  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Exposure allocation must be greater than zero.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_allocation_id, p_cost_bucket_id, p_amount_cents, p_expected_version
  )::text);

  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_update'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to update this allocation.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select allocation.project_id, allocation.exposure_id
    into v_locator
  from public.exposure_allocations allocation
  where allocation.id = p_allocation_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exposure allocation not found.';
  end if;

  select project.id into v_project_id
  from public.projects project
  where project.id = v_locator.project_id
  for update;
  if not found or not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update this allocation.';
  end if;

  select exposure.* into v_exposure
  from public.exposures exposure
  where exposure.id = v_locator.exposure_id
  for update;
  if not found or v_exposure.project_id <> v_project_id then
    raise exception using errcode = '23503', message = 'Exposure and allocation project do not match.';
  end if;
  if v_exposure.status not in ('active', 'escalated') then
    raise exception using errcode = '23514', message = 'Only a live exposure can be allocated.';
  end if;
  perform public.assert_safe_accounting_cents(v_exposure.dollar_exposure * 100, 'Exposure value');

  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_update'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  perform 1
  from public.exposure_allocations allocation
  where allocation.exposure_id = v_exposure.id
  order by allocation.id
  for update;

  select allocation.* into v_before
  from public.exposure_allocations allocation
  where allocation.id = p_allocation_id
  for update;
  if not found or v_before.exposure_id <> v_exposure.id then
    raise exception using errcode = 'P0002', message = 'Exposure allocation not found.';
  end if;
  if v_before.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'The exposure allocation changed before your save committed. Refresh and try again.';
  end if;

  select bucket.* into v_bucket
  from public.cost_buckets bucket
  where bucket.id = p_cost_bucket_id
  for update;
  if not found or v_bucket.project_id <> v_project_id then
    raise exception using errcode = '23503', message = 'Cost code not found on this project.';
  end if;
  if nullif(btrim(v_bucket.cost_code), '') is null then
    raise exception using errcode = '23514', message = 'Risk can only be allocated to a coded budget line.';
  end if;

  select coalesce(sum(allocation.amount * 100), 0)
    into v_other_allocated_cents
  from public.exposure_allocations allocation
  where allocation.exposure_id = v_exposure.id
    and allocation.id <> p_allocation_id;

  if v_other_allocated_cents + p_amount_cents > v_exposure.dollar_exposure * 100 then
    raise exception using
      errcode = '23514',
      message = 'Total allocations cannot exceed the authoritative exposure value.';
  end if;

  update public.exposure_allocations allocation
  set cost_bucket_id = v_bucket.id,
      cost_code = v_bucket.cost_code,
      amount = p_amount_cents / 100.0,
      version = allocation.version + 1,
      updated_at = clock_timestamp()
  where allocation.id = p_allocation_id
  returning * into v_after;

  v_result := jsonb_build_object(
    'ok', true,
    'allocationId', v_after.id,
    'projectId', v_after.project_id,
    'exposureId', v_after.exposure_id,
    'costBucketId', v_after.cost_bucket_id,
    'costCode', v_after.cost_code,
    'amountCents', v_after.amount * 100,
    'version', v_after.version,
    'updatedAt', v_after.updated_at,
    'deduplicated', false
  );

  insert into public.exposure_allocation_operations (
    project_id, exposure_id, allocation_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_after.project_id, v_after.exposure_id, v_after.id, btrim(p_operation_key),
    'allocation_update', v_fingerprint, v_result, v_user_id
  );

  return v_result;
end;
$$;

create or replace function public.delete_exposure_allocation_atomic(
  p_allocation_id uuid,
  p_expected_version bigint,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.exposure_allocation_operations%rowtype;
  v_locator record;
  v_project_id uuid;
  v_exposure public.exposures%rowtype;
  v_before public.exposure_allocations%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to remove an exposure allocation.';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'The expected exposure allocation version is required.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid exposure allocation operation key is required.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_allocation_id, p_expected_version, 'delete'
  )::text);

  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_delete'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to remove this allocation.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select allocation.project_id, allocation.exposure_id
    into v_locator
  from public.exposure_allocations allocation
  where allocation.id = p_allocation_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exposure allocation not found.';
  end if;

  select project.id into v_project_id
  from public.projects project
  where project.id = v_locator.project_id
  for update;
  if not found or not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to remove this allocation.';
  end if;

  select exposure.* into v_exposure
  from public.exposures exposure
  where exposure.id = v_locator.exposure_id
  for update;
  if not found or v_exposure.project_id <> v_project_id then
    raise exception using errcode = '23503', message = 'Exposure and allocation project do not match.';
  end if;

  select operation.* into v_existing
  from public.exposure_allocation_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = btrim(p_operation_key);
  if found then
    if v_existing.operation_type <> 'allocation_delete'
       or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This exposure allocation operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  perform 1
  from public.exposure_allocations allocation
  where allocation.exposure_id = v_exposure.id
  order by allocation.id
  for update;

  select allocation.* into v_before
  from public.exposure_allocations allocation
  where allocation.id = p_allocation_id
  for update;
  if not found or v_before.exposure_id <> v_exposure.id then
    -- A simultaneous lost-response retry can arrive after the first delete.
    select operation.* into v_existing
    from public.exposure_allocation_operations operation
    where operation.changed_by = v_user_id
      and operation.operation_key = btrim(p_operation_key);
    if found and v_existing.operation_type = 'allocation_delete'
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result || jsonb_build_object('deduplicated', true);
    end if;
    raise exception using errcode = 'P0002', message = 'Exposure allocation not found.';
  end if;
  if v_before.version <> p_expected_version then
    raise exception using
      errcode = '40001',
      message = 'The exposure allocation changed before your removal committed. Refresh and try again.';
  end if;

  delete from public.exposure_allocations allocation
  where allocation.id = p_allocation_id;

  v_result := jsonb_build_object(
    'ok', true,
    'allocationId', v_before.id,
    'projectId', v_before.project_id,
    'exposureId', v_before.exposure_id,
    'deletedAllocation', to_jsonb(v_before),
    'deduplicated', false
  );

  insert into public.exposure_allocation_operations (
    project_id, exposure_id, allocation_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_before.project_id, v_before.exposure_id, v_before.id, btrim(p_operation_key),
    'allocation_delete', v_fingerprint, v_result, v_user_id
  );

  return v_result;
end;
$$;

revoke all on function public.create_exposure_allocation_atomic(uuid, uuid, uuid, numeric, text),
  public.update_exposure_allocation_atomic(uuid, uuid, numeric, bigint, text),
  public.delete_exposure_allocation_atomic(uuid, bigint, text)
  from public, anon, authenticated, service_role;

grant execute on function public.create_exposure_allocation_atomic(uuid, uuid, uuid, numeric, text),
  public.update_exposure_allocation_atomic(uuid, uuid, numeric, bigint, text),
  public.delete_exposure_allocation_atomic(uuid, bigint, text)
  to authenticated;

-- Only command functions may author allocation facts. Service code must use a
-- reviewed command rather than bypassing caps, versions, or audit evidence.
revoke insert, update, delete on table public.exposure_allocations
  from authenticated, service_role;

comment on table public.exposure_allocation_operations is
  'Immutable idempotency and audit journal for exposure-to-cost-code allocation commands.';

notify pgrst, 'reload schema';
