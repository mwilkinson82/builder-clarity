-- Budget / SOV authority hardening.
--
-- Every user-authored budget mutation is one project-serialized, retry-safe
-- database command. A failed replace import can no longer delete the current
-- SOV, a saved bucket edit can no longer lose its override audit, and a stale
-- browser retry cannot apply the same intent twice. Direct table writes remain
-- protected by exact-cent and locked-baseline triggers.
alter table public.projects
add column if not exists budget_locked_at timestamptz;

alter table public.budget_line_overrides
add column if not exists operation_key text,
add column if not exists request_fingerprint text;

-- Preserve the audit when a deliberately empty/unlocked budget line is
-- deleted. The project relationship remains authoritative after the line is
-- gone.
alter table public.budget_line_overrides
drop constraint if exists budget_line_overrides_cost_bucket_id_fkey;

alter table public.budget_line_overrides
add constraint budget_line_overrides_cost_bucket_id_fkey foreign key (cost_bucket_id) references public.cost_buckets (id) on delete set null;

create unique index if not exists budget_line_overrides_operation_unique on public.budget_line_overrides (project_id, cost_bucket_id, field, operation_key)
where
  operation_key is not null;

-- Override history is evidence, not an editable user table. New rows can only
-- be written by update_cost_bucket_atomic together with the bucket commit.
revoke insert,
update,
delete on table public.budget_line_overrides
from
  public,
  anon,
  authenticated;

drop policy if exists budget_line_overrides_team_insert on public.budget_line_overrides;

alter table public.sov_imports
add column if not exists operation_key text,
add column if not exists request_fingerprint text;

create unique index if not exists sov_imports_project_operation_unique on public.sov_imports (project_id, operation_key)
where
  operation_key is not null;

-- Import history is proof of an SOV commit and cannot be authored separately
-- from the atomic replace/append or estimate-conversion command.
revoke insert,
update,
delete on table public.sov_imports
from
  public,
  anon,
  authenticated;

drop policy if exists sov_imports_team_insert on public.sov_imports;

create table if not exists public.budget_command_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  operation_key text not null,
  operation_type text not null,
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint budget_command_operations_key_length_check check (length(btrim(operation_key)) between 1 and 200),
  constraint budget_command_operations_type_check check (
    operation_type in (
      'bucket_create',
      'bucket_update',
      'bucket_delete',
      'sov_import',
      'estimate_budget_build',
      'estimate_sov_conversion'
    )
  ),
  constraint budget_command_operations_project_key_unique unique (project_id, operation_key)
);

create index if not exists budget_command_operations_project_created_idx on public.budget_command_operations (project_id, created_at desc);

alter table public.budget_command_operations enable row level security;

revoke all on table public.budget_command_operations
from
  public,
  anon,
  authenticated;

grant
select
  on table public.budget_command_operations to authenticated;

grant all on table public.budget_command_operations to service_role;

drop policy if exists budget_command_operations_project_select on public.budget_command_operations;

create policy budget_command_operations_project_select on public.budget_command_operations for
select
  to authenticated using (public.can_read_project (project_id));

create table if not exists public.estimate_sov_conversion_operations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  operation_key text not null,
  request_fingerprint text not null,
  result jsonb not null,
  changed_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint estimate_sov_conversion_operation_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint estimate_sov_conversion_estimate_key_unique unique (estimate_id, operation_key)
);

alter table public.estimate_sov_conversion_operations enable row level security;

revoke all on table public.estimate_sov_conversion_operations
from
  public,
  anon,
  authenticated;

grant
select
  on table public.estimate_sov_conversion_operations to authenticated;

grant all on table public.estimate_sov_conversion_operations to service_role;

drop policy if exists estimate_sov_conversion_operations_select on public.estimate_sov_conversion_operations;

create policy estimate_sov_conversion_operations_select on public.estimate_sov_conversion_operations for
select
  to authenticated using (public.can_manage_estimate (estimate_id));

create table if not exists public.budget_money_repairs (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  target_key text not null,
  project_id uuid not null references public.projects (id) on delete cascade,
  cost_bucket_id uuid references public.cost_buckets (id) on delete set null,
  field text not null,
  old_value numeric not null,
  new_value numeric not null,
  created_at timestamptz not null default now(),
  constraint budget_money_repairs_field_check check (
    field in (
      'contract_value',
      'original_budget',
      'actual_to_date',
      'ftc',
      'original_cost_budget'
    )
  ),
  constraint budget_money_repairs_migration_target_unique unique (migration_key, target_key)
);

alter table public.budget_money_repairs enable row level security;

revoke all on table public.budget_money_repairs
from
  public,
  anon,
  authenticated;

grant
select
  on table public.budget_money_repairs to authenticated;

grant all on table public.budget_money_repairs to service_role;

drop policy if exists budget_money_repairs_project_select on public.budget_money_repairs;

create policy budget_money_repairs_project_select on public.budget_money_repairs for
select
  to authenticated using (public.can_read_project (project_id));

comment on table public.budget_money_repairs is 'Immutable per-field old/new evidence for deterministic budget-money repairs performed before exact-cent constraints were installed.';

-- Missing or negative authority cannot be repaired by rounding and remains a
-- hard migration stop. Legacy fractional cents are repaired below with a
-- deterministic largest-remainder allocation and immutable evidence.
do $$
begin
  if exists (
    select 1
    from public.cost_buckets bucket
    where bucket.contract_value is null
       or bucket.original_budget is null
       or bucket.actual_to_date is null
       or bucket.ftc is null
       or bucket.contract_value < 0
       or bucket.original_budget < 0
       or bucket.actual_to_date < 0
       or bucket.ftc < 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'Budget authority upgrade blocked: cost-bucket money is negative or missing.',
      hint = 'Correct the affected SOV rows before applying budget command hardening.';
  end if;

  if exists (
    select 1
    from public.projects project
    where project.original_cost_budget is null
       or project.original_cost_budget < 0
  ) then
    raise exception using
      errcode = '23514',
      message = 'Budget authority upgrade blocked: project original cost budget is negative or missing.',
      hint = 'Correct the affected project baseline before applying budget command hardening.';
  end if;
end;
$$;

-- BEGIN budget-cent-largest-remainder-repair
-- Repair all four bucket money columns by project/column. Each project's
-- rounded aggregate cents are preserved exactly. Rows with the largest
-- fractional remainders receive the residual cents; sort order and UUID make
-- ties deterministic. This avoids the +$0.02 drift from independently rounding
-- a six-way split.
with
  raw as (
    select
      bucket.id as bucket_id,
      bucket.project_id,
      bucket.sort_order,
      'contract_value'::text as field,
      bucket.contract_value as old_value
    from
      public.cost_buckets bucket
    union all
    select
      bucket.id,
      bucket.project_id,
      bucket.sort_order,
      'original_budget',
      bucket.original_budget
    from
      public.cost_buckets bucket
    union all
    select
      bucket.id,
      bucket.project_id,
      bucket.sort_order,
      'actual_to_date',
      bucket.actual_to_date
    from
      public.cost_buckets bucket
    union all
    select
      bucket.id,
      bucket.project_id,
      bucket.sort_order,
      'ftc',
      bucket.ftc
    from
      public.cost_buckets bucket
  ),
  scored as (
    select
      raw.*,
      floor(raw.old_value * 100)::bigint as floor_cents,
      raw.old_value * 100 - floor(raw.old_value * 100) as fractional_cents,
      round(
        sum(raw.old_value * 100) over (
          partition by
            raw.project_id,
            raw.field
        )
      )::bigint as target_cents,
      sum(floor(raw.old_value * 100)::bigint) over (
        partition by
          raw.project_id,
          raw.field
      ) as floor_total_cents
    from
      raw
  ),
  ranked as (
    select
      scored.*,
      row_number() over (
        partition by
          scored.project_id,
          scored.field
        order by
          scored.fractional_cents desc,
          scored.sort_order,
          scored.bucket_id
      ) as remainder_rank
    from
      scored
  ),
  repairs as (
    select
      ranked.bucket_id,
      ranked.project_id,
      ranked.field,
      ranked.old_value,
      (
        ranked.floor_cents + case
          when ranked.remainder_rank <= ranked.target_cents - ranked.floor_total_cents then 1
          else 0
        end
      ) / 100.0 as new_value
    from
      ranked
  ),
  evidence as (
    insert into
      public.budget_money_repairs (
        migration_key,
        target_key,
        project_id,
        cost_bucket_id,
        field,
        old_value,
        new_value
      )
    select
      '20260720183243-budget-sov-cent-normalization-v1',
      'cost_bucket:' || repairs.bucket_id::text || ':' || repairs.field,
      repairs.project_id,
      repairs.bucket_id,
      repairs.field,
      repairs.old_value,
      repairs.new_value
    from
      repairs
    where
      repairs.old_value is distinct from repairs.new_value
    on conflict (migration_key, target_key) do nothing
    returning
      id
  ),
  per_bucket as (
    select
      repairs.bucket_id,
      max(repairs.new_value) filter (
        where
          repairs.field = 'contract_value'
      ) as contract_value,
      max(repairs.new_value) filter (
        where
          repairs.field = 'original_budget'
      ) as original_budget,
      max(repairs.new_value) filter (
        where
          repairs.field = 'actual_to_date'
      ) as actual_to_date,
      max(repairs.new_value) filter (
        where
          repairs.field = 'ftc'
      ) as ftc
    from
      repairs
    group by
      repairs.bucket_id
  ),
  applied as (
    update public.cost_buckets bucket
    set
      contract_value = per_bucket.contract_value,
      original_budget = per_bucket.original_budget,
      actual_to_date = per_bucket.actual_to_date,
      ftc = per_bucket.ftc
    from
      per_bucket
    where
      bucket.id = per_bucket.bucket_id
    returning
      bucket.id
  )
select
  (
    select
      count(*)
    from
      evidence
  ) as evidence_rows,
  (
    select
      count(*)
    from
      applied
  ) as normalized_rows;

with
  repairs as (
    select
      project.id as project_id,
      project.original_cost_budget as old_value,
      round(project.original_cost_budget * 100) / 100.0 as new_value
    from
      public.projects project
  ),
  evidence as (
    insert into
      public.budget_money_repairs (
        migration_key,
        target_key,
        project_id,
        cost_bucket_id,
        field,
        old_value,
        new_value
      )
    select
      '20260720183243-budget-sov-cent-normalization-v1',
      'project:' || repairs.project_id::text || ':original_cost_budget',
      repairs.project_id,
      null,
      'original_cost_budget',
      repairs.old_value,
      repairs.new_value
    from
      repairs
    where
      repairs.old_value is distinct from repairs.new_value
    on conflict (migration_key, target_key) do nothing
    returning
      id
  ),
  applied as (
    update public.projects project
    set
      original_cost_budget = repairs.new_value
    from
      repairs
    where
      project.id = repairs.project_id
    returning
      project.id
  )
select
  (
    select
      count(*)
    from
      evidence
  ) as evidence_rows,
  (
    select
      count(*)
    from
      applied
  ) as normalized_projects;

-- END budget-cent-largest-remainder-repair
-- Post-repair verification is the authority boundary: the trigger definitions
-- below are installed only after every persisted value is cent exact.
do $$
begin
  if exists (
    select 1
    from public.cost_buckets bucket
    where bucket.contract_value * 100 <> trunc(bucket.contract_value * 100)
       or bucket.original_budget * 100 <> trunc(bucket.original_budget * 100)
       or bucket.actual_to_date * 100 <> trunc(bucket.actual_to_date * 100)
       or bucket.ftc * 100 <> trunc(bucket.ftc * 100)
  ) or exists (
    select 1
    from public.projects project
    where project.original_cost_budget * 100 <> trunc(project.original_cost_budget * 100)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Budget cent normalization did not produce exact-cent authority.';
  end if;
end;
$$;

alter table public.cost_buckets
drop constraint if exists cost_buckets_money_exact_cent_check;

alter table public.cost_buckets
add constraint cost_buckets_money_exact_cent_check check (
  contract_value >= 0
  and original_budget >= 0
  and actual_to_date >= 0
  and ftc >= 0
  and contract_value * 100 = trunc(contract_value * 100)
  and original_budget * 100 = trunc(original_budget * 100)
  and actual_to_date * 100 = trunc(actual_to_date * 100)
  and ftc * 100 = trunc(ftc * 100)
);

alter table public.projects
drop constraint if exists projects_original_cost_budget_exact_cent_check;

alter table public.projects
add constraint projects_original_cost_budget_exact_cent_check check (
  original_cost_budget >= 0
  and original_cost_budget * 100 = trunc(original_cost_budget * 100)
);

create or replace function public.validate_cost_bucket_budget_authority () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_project_id uuid;
  v_budget_locked_at timestamptz;
begin
  v_project_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;

  if tg_op = 'UPDATE' and old.project_id is distinct from new.project_id then
    raise exception using
      errcode = '22023',
      message = 'A budget line cannot be moved to another project.';
  end if;

  if tg_op <> 'DELETE' then
    if new.contract_value is null
       or new.original_budget is null
       or new.actual_to_date is null
       or new.ftc is null
       or new.contract_value < 0
       or new.original_budget < 0
       or new.actual_to_date < 0
       or new.ftc < 0
    then
      raise exception using
        errcode = '23514',
        message = 'Budget and SOV money cannot be missing or negative.';
    end if;

    if new.contract_value * 100 <> trunc(new.contract_value * 100)
       or new.original_budget * 100 <> trunc(new.original_budget * 100)
       or new.actual_to_date * 100 <> trunc(new.actual_to_date * 100)
       or new.ftc * 100 <> trunc(new.ftc * 100)
    then
      raise exception using
        errcode = '23514',
        message = 'Budget and SOV money must be exact to the cent.';
    end if;
  end if;

  select project.budget_locked_at
    into v_budget_locked_at
  from public.projects project
  where project.id = v_project_id;

  -- A parent-project cascade can reach the child after the parent row is no
  -- longer visible. It is not an independent budget edit and may continue.
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception using errcode = '23503', message = 'Budget project not found.';
  end if;

  if v_budget_locked_at is not null then
    if tg_op = 'INSERT' and (new.original_budget <> 0 or new.contract_value <> 0) then
      raise exception using
        errcode = '55000',
        message = 'The budget is locked. New lines must begin with zero budget and zero contract value.';
    elsif tg_op = 'UPDATE'
      and (
        old.original_budget is distinct from new.original_budget
        or old.contract_value is distinct from new.contract_value
      )
    then
      raise exception using
        errcode = '55000',
        message = 'The budget is locked. Baseline money changes must flow through approved change orders.';
    elsif tg_op = 'DELETE' and (old.original_budget <> 0 or old.contract_value <> 0) then
      raise exception using
        errcode = '55000',
        message = 'The budget is locked. A priced or budgeted SOV line cannot be deleted.';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.validate_cost_bucket_budget_authority ()
from
  public,
  anon,
  authenticated,
  service_role;

drop trigger if exists cost_buckets_validate_budget_authority on public.cost_buckets;

create trigger cost_buckets_validate_budget_authority
before insert or update or delete on public.cost_buckets for each row
execute function public.validate_cost_bucket_budget_authority ();

create or replace function public.validate_project_budget_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  if new.original_cost_budget is null
     or new.original_cost_budget < 0
     or new.original_cost_budget * 100 <> trunc(new.original_cost_budget * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Project original cost budget must be nonnegative and exact to the cent.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_project_budget_money ()
from
  public,
  anon,
  authenticated,
  service_role;

drop trigger if exists projects_validate_budget_money on public.projects;

create trigger projects_validate_budget_money
before insert or update of original_cost_budget on public.projects for each row
execute function public.validate_project_budget_money ();

create or replace function public.update_cost_bucket_atomic (
  p_bucket_id uuid,
  p_patch jsonb,
  p_operation_key text,
  p_note text default ''
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_before public.cost_buckets%rowtype;
  v_after public.cost_buckets%rowtype;
  v_existing public.budget_command_operations%rowtype;
  v_project_id uuid;
  v_fingerprint text;
  v_result jsonb;
  v_override_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to edit a budget line.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid budget operation key is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'A non-empty budget-line patch is required.';
  end if;
  if length(coalesce(p_note, '')) > 500 then
    raise exception using errcode = '22023', message = 'Budget override note is too long.';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_patch) key
    where key not in (
      'cost_code', 'bucket', 'contract_value', 'original_budget',
      'actual_to_date', 'ftc', 'source_type', 'source_date', 'source_note'
    )
  ) then
    raise exception using errcode = '22023', message = 'The budget-line patch contains unsupported fields.';
  end if;

  select bucket.project_id
    into v_project_id
  from public.cost_buckets bucket
  where bucket.id = p_bucket_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget line not found.';
  end if;

  select project.*
    into v_project
  from public.projects project
  where project.id = v_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget project not found.';
  end if;
  if not public.can_manage_project(v_project.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this project budget.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'bucket_update|' || p_bucket_id::text || '|' || p_patch::text || '|' || coalesce(p_note, ''),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select operation.*
    into v_existing
  from public.budget_command_operations operation
  where operation.project_id = v_project.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'bucket_update'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'This budget operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select bucket.*
    into v_before
  from public.cost_buckets bucket
  where bucket.id = p_bucket_id
    and bucket.project_id = v_project.id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget line changed or was removed. Refresh and try again.';
  end if;

  if p_patch ? 'bucket'
     and nullif(btrim(p_patch ->> 'bucket'), '') is null
  then
    raise exception using errcode = '22023', message = 'Budget-line name is required.';
  end if;
  if p_patch ? 'bucket' and length(p_patch ->> 'bucket') > 100 then
    raise exception using errcode = '22023', message = 'Budget-line name is too long.';
  end if;
  if p_patch ? 'cost_code' and length(p_patch ->> 'cost_code') > 80 then
    raise exception using errcode = '22023', message = 'Cost code is too long.';
  end if;
  if p_patch ? 'source_note' and length(p_patch ->> 'source_note') > 500 then
    raise exception using errcode = '22023', message = 'Budget source note is too long.';
  end if;
  if p_patch ? 'source_type'
     and (p_patch ->> 'source_type') not in ('original_sov', 'change_order', 'added_cost')
  then
    raise exception using errcode = '22023', message = 'Budget source type is invalid.';
  end if;

  if v_project.budget_locked_at is not null
     and (
       (p_patch ? 'original_budget'
        and (p_patch ->> 'original_budget')::numeric is distinct from v_before.original_budget)
       or
       (p_patch ? 'contract_value'
        and (p_patch ->> 'contract_value')::numeric is distinct from v_before.contract_value)
     )
  then
    raise exception using
      errcode = '55000',
      message = 'The budget is locked. Baseline money changes must flow through approved change orders.';
  end if;

  update public.cost_buckets bucket
  set
    cost_code = case when p_patch ? 'cost_code' then btrim(p_patch ->> 'cost_code') else bucket.cost_code end,
    bucket = case when p_patch ? 'bucket' then btrim(p_patch ->> 'bucket') else bucket.bucket end,
    contract_value = case when p_patch ? 'contract_value' then (p_patch ->> 'contract_value')::numeric else bucket.contract_value end,
    original_budget = case when p_patch ? 'original_budget' then (p_patch ->> 'original_budget')::numeric else bucket.original_budget end,
    actual_to_date = case when p_patch ? 'actual_to_date' then (p_patch ->> 'actual_to_date')::numeric else bucket.actual_to_date end,
    ftc = case when p_patch ? 'ftc' then (p_patch ->> 'ftc')::numeric else bucket.ftc end,
    source_type = case when p_patch ? 'source_type' then p_patch ->> 'source_type' else bucket.source_type end,
    source_date = case
      when p_patch ? 'source_date' and p_patch -> 'source_date' = 'null'::jsonb then null
      when p_patch ? 'source_date' then (p_patch ->> 'source_date')::date
      else bucket.source_date
    end,
    source_note = case when p_patch ? 'source_note' then p_patch ->> 'source_note' else bucket.source_note end
  where bucket.id = p_bucket_id
  returning bucket.* into v_after;

  insert into public.budget_line_overrides (
    project_id,
    cost_bucket_id,
    field,
    old_value,
    new_value,
    note,
    changed_by,
    operation_key,
    request_fingerprint
  )
  select
    v_project.id,
    v_after.id,
    changed.field,
    changed.old_value,
    changed.new_value,
    nullif(btrim(p_note), ''),
    v_user_id,
    p_operation_key,
    v_fingerprint
  from (
    values
      ('contract_value', v_before.contract_value, v_after.contract_value),
      ('original_budget', v_before.original_budget, v_after.original_budget),
      ('actual_to_date', v_before.actual_to_date, v_after.actual_to_date),
      ('ftc', v_before.ftc, v_after.ftc)
  ) as changed(field, old_value, new_value)
  where changed.old_value is distinct from changed.new_value;
  get diagnostics v_override_count = row_count;

  v_result := jsonb_build_object(
    'ok', true,
    'bucketId', v_after.id,
    'overrideCount', v_override_count,
    'deduplicated', false
  );
  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'bucket_update', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.create_cost_bucket_atomic (
  p_project_id uuid,
  p_payload jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_existing public.budget_command_operations%rowtype;
  v_bucket public.cost_buckets%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_sort_order integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create a budget line.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid budget operation key is required.';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Budget-line details are required.';
  end if;
  if exists (
    select 1
    from jsonb_object_keys(p_payload) key
    where key not in (
      'cost_code', 'bucket', 'contract_value', 'original_budget',
      'actual_to_date', 'ftc', 'source_type', 'source_date', 'source_note'
    )
  ) then
    raise exception using errcode = '22023', message = 'Budget-line details contain unsupported fields.';
  end if;

  select project.*
    into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget project not found.';
  end if;
  if not public.can_manage_project(v_project.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create a budget line.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('bucket_create|' || coalesce(p_payload, '{}'::jsonb)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select operation.*
    into v_existing
  from public.budget_command_operations operation
  where operation.project_id = v_project.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'bucket_create'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'This budget operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  if nullif(btrim(p_payload ->> 'bucket'), '') is null then
    raise exception using errcode = '22023', message = 'Budget-line name is required.';
  end if;
  if length(p_payload ->> 'bucket') > 100
     or length(coalesce(p_payload ->> 'cost_code', '')) > 80
     or length(coalesce(p_payload ->> 'source_note', '')) > 500
  then
    raise exception using errcode = '22023', message = 'Budget-line details exceed their allowed length.';
  end if;
  if coalesce(p_payload ->> 'source_type', 'added_cost') not in ('original_sov', 'change_order', 'added_cost') then
    raise exception using errcode = '22023', message = 'Budget source type is invalid.';
  end if;
  if v_project.budget_locked_at is not null
     and (
       coalesce((p_payload ->> 'original_budget')::numeric, 0) <> 0
       or coalesce((p_payload ->> 'contract_value')::numeric, 0) <> 0
     )
  then
    raise exception using
      errcode = '55000',
      message = 'The budget is locked. New lines must begin with zero budget and zero contract value.';
  end if;

  select coalesce(max(bucket.sort_order), 0) + 1
    into v_sort_order
  from public.cost_buckets bucket
  where bucket.project_id = v_project.id;

  insert into public.cost_buckets (
    project_id,
    cost_code,
    bucket,
    contract_value,
    original_budget,
    actual_to_date,
    ftc,
    source_type,
    source_date,
    source_note,
    sort_order
  ) values (
    v_project.id,
    btrim(coalesce(p_payload ->> 'cost_code', '')),
    btrim(p_payload ->> 'bucket'),
    coalesce((p_payload ->> 'contract_value')::numeric, 0),
    coalesce((p_payload ->> 'original_budget')::numeric, 0),
    coalesce((p_payload ->> 'actual_to_date')::numeric, 0),
    coalesce((p_payload ->> 'ftc')::numeric, 0),
    coalesce(p_payload ->> 'source_type', 'added_cost'),
    case
      when p_payload -> 'source_date' = 'null'::jsonb then null
      when nullif(p_payload ->> 'source_date', '') is not null then (p_payload ->> 'source_date')::date
      else current_date
    end,
    coalesce(p_payload ->> 'source_note', ''),
    v_sort_order
  ) returning * into v_bucket;

  v_result := jsonb_build_object(
    'ok', true,
    'bucketId', v_bucket.id,
    'sortOrder', v_bucket.sort_order,
    'deduplicated', false
  );
  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'bucket_create', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.delete_cost_bucket_atomic (
  p_project_id uuid,
  p_bucket_id uuid,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_bucket public.cost_buckets%rowtype;
  v_existing public.budget_command_operations%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to delete a budget line.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid budget operation key is required.';
  end if;

  select project.*
    into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget project not found.';
  end if;
  if not public.can_manage_project(v_project.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to delete this budget line.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('bucket_delete|' || p_bucket_id::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select operation.*
    into v_existing
  from public.budget_command_operations operation
  where operation.project_id = v_project.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'bucket_delete'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'This budget operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select bucket.*
    into v_bucket
  from public.cost_buckets bucket
  where bucket.id = p_bucket_id
    and bucket.project_id = v_project.id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget line changed or was removed. Refresh and try again.';
  end if;

  delete from public.cost_buckets bucket where bucket.id = v_bucket.id;

  v_result := jsonb_build_object(
    'ok', true,
    'bucketId', v_bucket.id,
    'deletedBucket', jsonb_build_object(
      'costCode', v_bucket.cost_code,
      'name', v_bucket.bucket,
      'contractValue', v_bucket.contract_value,
      'originalBudget', v_bucket.original_budget,
      'actualToDate', v_bucket.actual_to_date,
      'ftc', v_bucket.ftc
    ),
    'deduplicated', false
  );
  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'bucket_delete', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.import_cost_buckets_atomic (
  p_project_id uuid,
  p_mode text,
  p_rows jsonb,
  p_metadata jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_existing public.budget_command_operations%rowtype;
  v_match public.cost_buckets%rowtype;
  v_row jsonb;
  v_fingerprint text;
  v_result jsonb;
  v_seen_keys text[] := array[]::text[];
  v_key text;
  v_code text;
  v_name text;
  v_source_type text;
  v_source_date date;
  v_original_budget numeric;
  v_actual_to_date numeric;
  v_ftc numeric;
  v_actual_provided boolean;
  v_ftc_provided boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_next_order integer := 1;
  v_total_cents bigint := 0;
  v_import_budget_cents bigint := 0;
  v_metadata_total numeric := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to import a budget.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid budget import operation key is required.';
  end if;
  if p_mode not in ('replace', 'append') then
    raise exception using errcode = '22023', message = 'Budget import mode must be replace or append.';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > 500
  then
    raise exception using errcode = '22023', message = 'Budget import requires between 1 and 500 rows.';
  end if;
  if p_metadata is null then
    p_metadata := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_metadata) is distinct from 'object' then
    raise exception using errcode = '22023', message = 'Budget import metadata must be an object.';
  end if;
  begin
    v_metadata_total := coalesce((p_metadata ->> 'total_budget')::numeric, 0);
  exception when others then
    raise exception using errcode = '22023', message = 'Budget import history total must be numeric.';
  end;
  if v_metadata_total < 0
     or v_metadata_total * 100 <> trunc(v_metadata_total * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Budget import history total must be nonnegative and exact to the cent.';
  end if;

  select project.*
    into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget project not found.';
  end if;
  if not public.can_manage_project(v_project.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to import this project budget.';
  end if;
  if v_project.budget_locked_at is not null then
    raise exception using
      errcode = '55000',
      message = 'The budget is locked. Replace or append imports cannot rewrite the frozen baseline.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'sov_import|' || p_mode || '|' || p_rows::text || '|' || p_metadata::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  select operation.*
    into v_existing
  from public.budget_command_operations operation
  where operation.project_id = v_project.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'sov_import'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'This budget operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  -- Validate the entire payload before touching the current SOV. The enclosing
  -- function transaction then makes delete/update/insert/project/history one
  -- indivisible commit.
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if jsonb_typeof(v_row) is distinct from 'object' then
      raise exception using errcode = '22023', message = 'Every budget import row must be an object.';
    end if;
    v_code := btrim(coalesce(v_row ->> 'cost_code', ''));
    v_name := btrim(coalesce(v_row ->> 'bucket', ''));
    if v_name = '' then
      raise exception using errcode = '22023', message = 'Every budget import row needs a description.';
    end if;
    if length(v_code) > 80 or length(v_name) > 200
       or length(coalesce(v_row ->> 'source_note', '')) > 500
    then
      raise exception using errcode = '22023', message = 'A budget import row exceeds its allowed length.';
    end if;

    v_source_type := coalesce(v_row ->> 'source_type', 'original_sov');
    if v_source_type not in ('original_sov', 'change_order', 'added_cost') then
      raise exception using errcode = '22023', message = 'A budget import row has an invalid source type.';
    end if;

    begin
      v_original_budget := (v_row ->> 'original_budget')::numeric;
      v_actual_to_date := (v_row ->> 'actual_to_date')::numeric;
      v_ftc := (v_row ->> 'ftc')::numeric;
    exception when others then
      raise exception using
        errcode = '22023',
        message = 'Budget import money must be numeric.';
    end;
    if v_original_budget is null or v_actual_to_date is null or v_ftc is null
       or v_original_budget < 0 or v_actual_to_date < 0 or v_ftc < 0
       or v_original_budget * 100 <> trunc(v_original_budget * 100)
       or v_actual_to_date * 100 <> trunc(v_actual_to_date * 100)
       or v_ftc * 100 <> trunc(v_ftc * 100)
    then
      raise exception using
        errcode = '23514',
        message = 'Budget import money must be nonnegative and exact to the cent.';
    end if;

    v_key := case
      when v_code <> '' then 'code:' || lower(v_code)
      else 'bucket:' || lower(v_name)
    end;
    if v_key = any(v_seen_keys) then
      raise exception using
        errcode = '23505',
        message = format('Duplicate budget import key: %s.', coalesce(nullif(v_code, ''), v_name));
    end if;
    v_seen_keys := array_append(v_seen_keys, v_key);
    v_import_budget_cents := v_import_budget_cents + round(v_original_budget * 100)::bigint;
  end loop;

  if p_mode = 'replace' then
    delete from public.cost_buckets bucket where bucket.project_id = v_project.id;
    v_next_order := 1;
  else
    select coalesce(max(bucket.sort_order), 0) + 1
      into v_next_order
    from public.cost_buckets bucket
    where bucket.project_id = v_project.id;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_code := btrim(coalesce(v_row ->> 'cost_code', ''));
    v_name := btrim(v_row ->> 'bucket');
    v_original_budget := (v_row ->> 'original_budget')::numeric;
    v_actual_to_date := (v_row ->> 'actual_to_date')::numeric;
    v_ftc := (v_row ->> 'ftc')::numeric;
    v_actual_provided := coalesce((v_row ->> 'actual_to_date_provided')::boolean, false);
    v_ftc_provided := coalesce((v_row ->> 'ftc_provided')::boolean, false);
    v_source_type := coalesce(v_row ->> 'source_type', 'original_sov');
    v_source_date := case
      when v_row -> 'source_date' = 'null'::jsonb then current_date
      when nullif(v_row ->> 'source_date', '') is not null then (v_row ->> 'source_date')::date
      else current_date
    end;

    v_match := null;
    if p_mode = 'append' then
      if v_code <> '' then
        select bucket.*
          into v_match
        from public.cost_buckets bucket
        where bucket.project_id = v_project.id
          and lower(btrim(bucket.cost_code)) = lower(v_code)
        limit 1
        for update;
      else
        select bucket.*
          into v_match
        from public.cost_buckets bucket
        where bucket.project_id = v_project.id
          and btrim(bucket.cost_code) = ''
          and lower(btrim(bucket.bucket)) = lower(v_name)
        limit 1
        for update;
      end if;
    end if;

    if v_match.id is not null then
      update public.cost_buckets bucket
      set
        cost_code = v_code,
        bucket = v_name,
        original_budget = v_original_budget,
        actual_to_date = case when v_actual_provided then v_actual_to_date else bucket.actual_to_date end,
        ftc = case when v_ftc_provided then v_ftc else bucket.ftc end,
        source_type = v_source_type,
        source_date = v_source_date,
        source_note = coalesce(nullif(v_row ->> 'source_note', ''), 'Updated from SOV import')
      where bucket.id = v_match.id;
      v_updated := v_updated + 1;
    else
      insert into public.cost_buckets (
        project_id,
        cost_code,
        bucket,
        original_budget,
        actual_to_date,
        ftc,
        source_type,
        source_date,
        source_note,
        sort_order
      ) values (
        v_project.id,
        v_code,
        v_name,
        v_original_budget,
        v_actual_to_date,
        v_ftc,
        v_source_type,
        v_source_date,
        coalesce(v_row ->> 'source_note', ''),
        v_next_order
      );
      v_inserted := v_inserted + 1;
      v_next_order := v_next_order + 1;
    end if;
  end loop;

  select coalesce(sum(
    round(bucket.actual_to_date * 100)::bigint
    + round(bucket.ftc * 100)::bigint
  ), 0)
    into v_total_cents
  from public.cost_buckets bucket
  where bucket.project_id = v_project.id;

  -- The projects authority guard (installed later in this batch) only admits
  -- original_cost_budget changes from audited commands; this import command
  -- identifies itself before rolling the imported buckets into the baseline.
  perform set_config('overwatch.project_financial_command_write', 'on', true);
  update public.projects project
  set original_cost_budget = v_total_cents / 100.0
  where project.id = v_project.id;

  insert into public.sov_imports (
    project_id,
    imported_by,
    mode,
    source_type,
    source_name,
    source_sheet,
    profile,
    confidence,
    has_header,
    raw_rows,
    staged_rows,
    inserted_count,
    updated_count,
    skipped_count,
    merged_rows,
    total_budget,
    original_cost_budget,
    selected_budget_column,
    selected_budget_label,
    column_map,
    amount_choices,
    warnings,
    operation_key,
    request_fingerprint
  ) values (
    v_project.id,
    v_user_id,
    p_mode,
    coalesce(p_metadata ->> 'source_type', ''),
    coalesce(p_metadata ->> 'source_name', ''),
    coalesce(p_metadata ->> 'source_sheet', ''),
    coalesce(p_metadata ->> 'profile', ''),
    coalesce(p_metadata ->> 'confidence', 'unknown'),
    coalesce((p_metadata ->> 'has_header')::boolean, true),
    coalesce((p_metadata ->> 'raw_rows')::integer, jsonb_array_length(p_rows)),
    coalesce((p_metadata ->> 'staged_rows')::integer, jsonb_array_length(p_rows)),
    v_inserted,
    v_updated,
    coalesce((p_metadata ->> 'skipped_rows')::integer, 0),
    coalesce((p_metadata ->> 'merged_rows')::integer, 0),
    case
      when v_metadata_total > 0 then v_metadata_total
      else v_import_budget_cents / 100.0
    end,
    v_total_cents / 100.0,
    nullif(p_metadata ->> 'selected_budget_column', '')::integer,
    coalesce(p_metadata ->> 'selected_budget_label', ''),
    coalesce(p_metadata -> 'column_map', '{}'::jsonb),
    coalesce(p_metadata -> 'amount_choices', '[]'::jsonb),
    coalesce(p_metadata -> 'warnings', '[]'::jsonb),
    p_operation_key,
    v_fingerprint
  );

  v_result := jsonb_build_object(
    'ok', true,
    'inserted', v_inserted,
    'updated', v_updated,
    'originalCostBudget', v_total_cents / 100.0,
    'importHistorySaved', true,
    'deduplicated', false
  );
  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'sov_import', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.build_budget_from_estimate_atomic (
  p_project_id uuid,
  p_pricing text,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_estimate public.estimates%rowtype;
  v_existing public.budget_command_operations%rowtype;
  v_match public.cost_buckets%rowtype;
  v_line record;
  v_fingerprint text;
  v_result jsonb;
  v_subtotal_cents bigint := 0;
  v_contract_total_cents bigint := 0;
  v_assigned_cents bigint := 0;
  v_contract_cents bigint := 0;
  v_remainder_cents bigint := 0;
  v_last_priced_key text;
  v_priced boolean := false;
  v_updated integer := 0;
  v_created integer := 0;
  v_codes integer := 0;
  v_next_order integer := 1;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to build a budget from an estimate.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-to-budget operation key is required.';
  end if;
  if p_pricing not in ('unpriced', 'auto') then
    raise exception using errcode = '22023', message = 'Estimate budget pricing must be unpriced or auto.';
  end if;

  select project.*
    into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Budget project not found.';
  end if;
  if not public.can_manage_project(v_project.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to build this project budget.';
  end if;
  if v_project.budget_locked_at is not null then
    raise exception using
      errcode = '55000',
      message = 'The budget is locked. An estimate carry cannot rewrite the frozen baseline.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to('estimate_budget_build|' || p_pricing, 'UTF8'),
      'sha256'
    ),
    'hex'
  );
  select operation.*
    into v_existing
  from public.budget_command_operations operation
  where operation.project_id = v_project.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'estimate_budget_build'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using
        errcode = '22023',
        message = 'This budget operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  -- The estimate-line mutation trigger locks this same parent estimate before
  -- every insert/update/delete. Holding the parent row therefore gives this
  -- command one stable, authoritative set of lines for the whole carry.
  select estimate.*
    into v_estimate
  from public.estimates estimate
  where estimate.project_id = v_project.id
  order by estimate.updated_at desc, estimate.id desc
  limit 1
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'No Overwatch estimate is linked to this project. Enter the budget manually.';
  end if;

  select
    coalesce(sum(line.total_extended_cents), 0)::bigint,
    count(distinct coalesce(nullif(btrim(line.cost_code), ''), '__uncoded__'))::integer
    into v_subtotal_cents, v_codes
  from public.estimate_line_items line
  where line.estimate_id = v_estimate.id;

  if v_codes = 0 then
    raise exception using
      errcode = '22023',
      message = 'The linked estimate has no line items to carry into the budget.';
  end if;
  if v_subtotal_cents < 0 then
    raise exception using errcode = '23514', message = 'Estimate line cost cannot produce a negative budget.';
  end if;

  v_contract_total_cents := v_estimate.total_with_markups_cents;
  v_priced := p_pricing = 'auto'
    and v_contract_total_cents > v_subtotal_cents
    and v_subtotal_cents > 0;

  if v_priced then
    with raw as (
      select
        coalesce(nullif(btrim(line.cost_code), ''), '__uncoded__') as group_key,
        sum(line.total_extended_cents)::bigint as budget_cents
      from public.estimate_line_items line
      where line.estimate_id = v_estimate.id
      group by coalesce(nullif(btrim(line.cost_code), ''), '__uncoded__')
    )
    select
      coalesce(sum(round(raw.budget_cents::numeric * v_contract_total_cents / v_subtotal_cents)::bigint), 0),
      (
        select priced.group_key
        from raw priced
        where priced.budget_cents > 0
        order by case when priced.group_key = '__uncoded__' then '' else priced.group_key end desc,
                 priced.group_key desc
        limit 1
      )
      into v_assigned_cents, v_last_priced_key
    from raw
    where raw.budget_cents > 0;
    v_remainder_cents := v_contract_total_cents - v_assigned_cents;
  end if;

  select coalesce(max(bucket.sort_order), 0) + 1
    into v_next_order
  from public.cost_buckets bucket
  where bucket.project_id = v_project.id;

  for v_line in
    with raw as (
      select
        coalesce(nullif(btrim(line.cost_code), ''), '__uncoded__') as group_key,
        btrim(line.cost_code) as cost_code,
        line.total_extended_cents,
        row_number() over (
          partition by coalesce(nullif(btrim(line.cost_code), ''), '__uncoded__')
          order by line.sort_order, line.id
        ) as group_row,
        case
          when nullif(btrim(line.scope_group), '') is not null then btrim(line.scope_group)
          when nullif(btrim(line.description), '') is not null then btrim(line.description)
          when nullif(btrim(line.csi_division), '') is not null then 'Division ' || btrim(line.csi_division)
          else 'Estimated scope'
        end as line_description
      from public.estimate_line_items line
      where line.estimate_id = v_estimate.id
    ), grouped as (
      select
        raw.group_key,
        max(raw.cost_code) as cost_code,
        sum(raw.total_extended_cents)::bigint as budget_cents,
        max(raw.line_description) filter (where raw.group_row = 1) as description
      from raw
      group by raw.group_key
    )
    select grouped.*
    from grouped
    order by grouped.cost_code, grouped.group_key
  loop
    v_contract_cents := 0;
    if v_priced and v_line.budget_cents > 0 then
      v_contract_cents := round(
        v_line.budget_cents::numeric * v_contract_total_cents / v_subtotal_cents
      )::bigint;
      if v_line.group_key = v_last_priced_key then
        v_contract_cents := v_contract_cents + v_remainder_cents;
      end if;
    end if;

    v_match := null;
    if v_line.cost_code <> '' then
      select bucket.*
        into v_match
      from public.cost_buckets bucket
      where bucket.project_id = v_project.id
        and lower(btrim(bucket.cost_code)) = lower(v_line.cost_code)
      order by bucket.sort_order, bucket.id
      limit 1
      for update;
    else
      select bucket.*
        into v_match
      from public.cost_buckets bucket
      where bucket.project_id = v_project.id
        and btrim(bucket.cost_code) = ''
        and lower(btrim(bucket.bucket)) = lower(v_line.description)
      order by bucket.sort_order, bucket.id
      limit 1
      for update;
    end if;

    if v_match.id is not null then
      update public.cost_buckets bucket
      set
        original_budget = v_line.budget_cents / 100.0,
        contract_value = case
          when v_priced then v_contract_cents / 100.0
          else bucket.contract_value
        end
      where bucket.id = v_match.id;
      v_updated := v_updated + 1;
    else
      insert into public.cost_buckets (
        project_id,
        bucket,
        cost_code,
        contract_value,
        original_budget,
        actual_to_date,
        ftc,
        source_type,
        source_date,
        source_note,
        sort_order
      ) values (
        v_project.id,
        v_line.description,
        v_line.cost_code,
        case when v_priced then v_contract_cents / 100.0 else 0 end,
        v_line.budget_cents / 100.0,
        0,
        v_line.budget_cents / 100.0,
        'original_sov',
        current_date,
        'Built from Overwatch estimate ' || v_estimate.id::text,
        v_next_order
      );
      v_created := v_created + 1;
      v_next_order := v_next_order + 1;
    end if;
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'estimateId', v_estimate.id,
    'updated', v_updated,
    'created', v_created,
    'codes', v_codes,
    'priced', v_priced,
    'pricingRequested', p_pricing = 'auto',
    'deduplicated', false
  );
  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'estimate_budget_build', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.convert_estimate_to_sov_atomic (
  p_estimate_id uuid,
  p_project_id uuid,
  p_client text,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_project public.projects%rowtype;
  v_existing public.estimate_sov_conversion_operations%rowtype;
  v_budget_existing public.budget_command_operations%rowtype;
  v_group record;
  v_totals jsonb;
  v_fingerprint text;
  v_result jsonb;
  v_material_cents bigint := 0;
  v_labor_cents bigint := 0;
  v_adjusted_material_cents bigint := 0;
  v_adjusted_labor_cents bigint := 0;
  v_adjusted_direct_cents bigint := 0;
  v_contract_cents bigint := 0;
  v_line_count integer := 0;
  v_group_count integer := 0;
  v_raw_total numeric := 0;
  v_group_budget_cents bigint := 0;
  v_assigned_cents bigint := 0;
  v_remainder_cents bigint := 0;
  v_last_group_key text;
  v_project_limit integer := 0;
  v_active_project_count integer := 0;
  v_sort_order integer := 1;
  v_created_project boolean := false;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to push an estimate to a project.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-to-project operation key is required.';
  end if;
  if length(coalesce(p_client, '')) > 200 then
    raise exception using errcode = '22023', message = 'Project client is too long.';
  end if;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'Estimate not found or you do not have permission to push it.';
  end if;

  -- Existing-project pushes use project -> estimate, matching every other
  -- project-budget command. New-project pushes have no project row yet and
  -- serialize on the estimate operation ledger instead.
  if p_project_id is not null then
    select project.*
      into v_project
    from public.projects project
    where project.id = p_project_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Target project not found.';
    end if;
    if not public.can_manage_project(v_project.id) then
      raise exception using errcode = '42501', message = 'You do not have permission to replace this project budget.';
    end if;
  end if;

  select estimate.*
    into v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;

  v_fingerprint := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        'estimate_sov_conversion|'
          || p_estimate_id::text || '|'
          || coalesce(p_project_id::text, 'new') || '|'
          || btrim(coalesce(p_client, '')),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select operation.*
    into v_existing
  from public.estimate_sov_conversion_operations operation
  where operation.estimate_id = v_estimate.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This estimate-to-project operation key was already used for a different target or request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  if p_project_id is null and v_estimate.project_id is not null then
    raise exception using
      errcode = '55000',
      message = 'This estimate is already linked to a project. Refresh before pushing it again.';
  end if;
  if p_project_id is not null
     and v_estimate.project_id is not null
     and v_estimate.project_id <> p_project_id
  then
    raise exception using
      errcode = '55000',
      message = 'This estimate is linked to a different project and cannot replace this SOV.';
  end if;

  if p_project_id is not null and v_project.budget_locked_at is not null then
    raise exception using errcode = '55000', message = 'The budget is locked. An estimate cannot replace the frozen SOV.';
  end if;

  select count(*)::integer
    into v_line_count
  from public.estimate_line_items line
  where line.estimate_id = v_estimate.id;
  if v_line_count = 0 then
    raise exception using errcode = '22023', message = 'Add at least one line item before pushing this estimate.';
  end if;

  -- Recalculate inside this transaction from locked authoritative lines. The
  -- existing derived-total function mirrors calculateEstimateTotals and keeps
  -- the estimate header consistent with the SOV being created.
  v_totals := public.recalculate_estimate_totals_from_lines(v_estimate.id);
  if v_totals is null then
    raise exception using errcode = 'P0002', message = 'Estimate totals could not be recalculated.';
  end if;
  v_material_cents := (v_totals ->> 'subtotal_material_cents')::bigint;
  v_labor_cents := (v_totals ->> 'subtotal_labor_cents')::bigint;
  v_contract_cents := (v_totals ->> 'total_with_markups_cents')::bigint;
  v_adjusted_material_cents := round(
    v_material_cents * greatest(0, coalesce(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_labor_cents := round(
    v_labor_cents * greatest(0, coalesce(v_estimate.region_multiplier, 1))
  )::bigint;
  v_adjusted_direct_cents := v_adjusted_material_cents + v_adjusted_labor_cents;

  if p_project_id is null then
    -- Serialize plan enforcement for new project creation. Zero means
    -- unlimited, matching the ordinary create-project flow.
    select coalesce(organization.project_limit, 0)
      into v_project_limit
    from public.organizations organization
    where organization.id = v_estimate.organization_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Estimate company workspace not found.';
    end if;
    if v_project_limit > 0 then
      select count(*)::integer
        into v_active_project_count
      from public.projects project
      where project.organization_id = v_estimate.organization_id
        and project.archived_at is null
        and project.job_number <> 'DEMO-HARBOR';
      if v_active_project_count >= v_project_limit then
        raise exception using
          errcode = '23514',
          message = format('This OverWatch company is at its %s-active-project limit.', v_project_limit);
      end if;
    end if;

    insert into public.projects (
      owner_id,
      organization_id,
      name,
      job_number,
      client,
      project_manager,
      phase,
      original_contract,
      original_cost_budget
    ) values (
      v_user_id,
      v_estimate.organization_id,
      v_estimate.name,
      '',
      coalesce(nullif(btrim(p_client), ''), nullif(btrim(v_estimate.description), ''), v_estimate.name),
      '',
      'Early',
      v_contract_cents / 100.0,
      v_adjusted_direct_cents / 100.0
    ) returning * into v_project;
    v_created_project := true;
  else
    select operation.*
      into v_budget_existing
    from public.budget_command_operations operation
    where operation.project_id = v_project.id
      and operation.operation_key = p_operation_key;
    if found then
      raise exception using
        errcode = '22023',
        message = 'This project budget operation key was already used for a different request.';
    end if;
  end if;

  with grouped as (
    select
      coalesce(
        nullif(btrim(line.scope_group), ''),
        nullif(btrim(line.csi_division), ''),
        'Uncoded'
      ) as group_key,
      case
        when nullif(btrim(line.scope_group), '') is not null then btrim(line.scope_group)
        when nullif(btrim(line.csi_division), '') is not null then 'CSI ' || btrim(line.csi_division)
        else 'Uncoded Estimate Scope'
      end as label,
      case
        when nullif(btrim(line.scope_group), '') is not null then ''
        else coalesce(nullif(btrim(line.csi_division), ''), '00')
      end as cost_code,
      sum(line.quantity * (line.material_unit_cost_cents + line.labor_unit_cost_cents)) as raw_cost
    from public.estimate_line_items line
    where line.estimate_id = v_estimate.id
    group by 1, 2, 3
  )
  select
    count(*)::integer,
    coalesce(sum(grouped.raw_cost), 0),
    max(grouped.group_key)
    into v_group_count, v_raw_total, v_last_group_key
  from grouped;

  if v_group_count = 0 then
    raise exception using errcode = '22023', message = 'The estimate did not produce any budget groups.';
  end if;

  if v_raw_total > 0 then
    with grouped as (
      select
        coalesce(
          nullif(btrim(line.scope_group), ''),
          nullif(btrim(line.csi_division), ''),
          'Uncoded'
        ) as group_key,
        sum(line.quantity * (line.material_unit_cost_cents + line.labor_unit_cost_cents)) as raw_cost
      from public.estimate_line_items line
      where line.estimate_id = v_estimate.id
      group by 1
    )
    select coalesce(sum(round(grouped.raw_cost * v_adjusted_direct_cents / v_raw_total)), 0)::bigint
      into v_assigned_cents
    from grouped;
    v_remainder_cents := v_adjusted_direct_cents - v_assigned_cents;
  end if;

  -- Delete, replace, project-baseline update, estimate link, and immutable
  -- history all live in this one transaction. Any error restores the prior SOV.
  delete from public.cost_buckets bucket where bucket.project_id = v_project.id;

  for v_group in
    select
      coalesce(
        nullif(btrim(line.scope_group), ''),
        nullif(btrim(line.csi_division), ''),
        'Uncoded'
      ) as group_key,
      case
        when nullif(btrim(line.scope_group), '') is not null then btrim(line.scope_group)
        when nullif(btrim(line.csi_division), '') is not null then 'CSI ' || btrim(line.csi_division)
        else 'Uncoded Estimate Scope'
      end as label,
      case
        when nullif(btrim(line.scope_group), '') is not null then ''
        else coalesce(nullif(btrim(line.csi_division), ''), '00')
      end as cost_code,
      sum(line.quantity * (line.material_unit_cost_cents + line.labor_unit_cost_cents)) as raw_cost
    from public.estimate_line_items line
    where line.estimate_id = v_estimate.id
    group by 1, 2, 3
    order by 1
  loop
    v_group_budget_cents := case
      when v_raw_total > 0
        then round(v_group.raw_cost * v_adjusted_direct_cents / v_raw_total)::bigint
      else 0
    end;
    if v_group.group_key = v_last_group_key then
      v_group_budget_cents := v_group_budget_cents + v_remainder_cents;
    end if;

    insert into public.cost_buckets (
      project_id,
      cost_code,
      bucket,
      contract_value,
      original_budget,
      actual_to_date,
      ftc,
      source_type,
      source_date,
      source_note,
      sort_order
    ) values (
      v_project.id,
      v_group.cost_code,
      v_group.label,
      0,
      v_group_budget_cents / 100.0,
      0,
      v_group_budget_cents / 100.0,
      'original_sov',
      current_date,
      'Estimate: ' || v_estimate.name,
      v_sort_order
    );
    v_sort_order := v_sort_order + 1;
  end loop;

  -- Conversion is the ONE audited path allowed to move the project baseline
  -- and to stamp the estimate as converted (project link + final status). It
  -- identifies itself to the projects authority guard and to the estimate
  -- freeze trigger (both installed later in this batch).
  perform set_config('overwatch.project_financial_command_write', 'on', true);
  update public.projects project
  set
    original_cost_budget = v_adjusted_direct_cents / 100.0,
    original_contract = v_contract_cents / 100.0
  where project.id = v_project.id;

  perform set_config('overwatch.estimate_conversion_write', 'on', true);
  update public.estimates estimate
  set
    project_id = v_project.id,
    status = case when estimate.status = 'draft' then 'final' else estimate.status end
  where estimate.id = v_estimate.id;

  if v_estimate.opportunity_id is not null then
    update public.pipeline_opportunities opportunity
    set
      converted_project_id = v_project.id,
      converted_at = now(),
      estimated_contract = v_contract_cents / 100.0,
      estimated_cost = v_adjusted_direct_cents / 100.0
    where opportunity.id = v_estimate.opportunity_id;
  end if;

  insert into public.sov_imports (
    project_id,
    imported_by,
    mode,
    source_type,
    source_name,
    source_sheet,
    profile,
    confidence,
    has_header,
    raw_rows,
    staged_rows,
    inserted_count,
    updated_count,
    skipped_count,
    merged_rows,
    total_budget,
    original_cost_budget,
    selected_budget_column,
    selected_budget_label,
    column_map,
    amount_choices,
    warnings,
    operation_key,
    request_fingerprint
  ) values (
    v_project.id,
    v_user_id,
    'replace',
    'estimate',
    v_estimate.name,
    'Estimate',
    'estimate',
    'high',
    true,
    v_line_count,
    v_group_count,
    v_group_count,
    0,
    0,
    greatest(0, v_line_count - v_group_count),
    v_adjusted_direct_cents / 100.0,
    v_adjusted_direct_cents / 100.0,
    null,
    'Estimate total',
    '{}'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    p_operation_key,
    v_fingerprint
  );

  v_result := jsonb_build_object(
    'ok', true,
    'project_id', v_project.id,
    'bucket_count', v_group_count,
    'original_cost_budget', v_adjusted_direct_cents / 100.0,
    'original_contract', v_contract_cents / 100.0,
    'created_project', v_created_project,
    'import_history_saved', true,
    'deduplicated', false
  );

  insert into public.budget_command_operations (
    project_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'estimate_sov_conversion', v_fingerprint, v_result, v_user_id
  );
  insert into public.estimate_sov_conversion_operations (
    estimate_id, project_id, operation_key, request_fingerprint, result, changed_by
  ) values (
    v_estimate.id, v_project.id, p_operation_key, v_fingerprint, v_result, v_user_id
  );

  return v_result;
end;
$$;

revoke all on function public.update_cost_bucket_atomic (uuid, jsonb, text, text)
from
  public,
  anon,
  authenticated;

revoke all on function public.create_cost_bucket_atomic (uuid, jsonb, text)
from
  public,
  anon,
  authenticated;

revoke all on function public.delete_cost_bucket_atomic (uuid, uuid, text)
from
  public,
  anon,
  authenticated;

revoke all on function public.import_cost_buckets_atomic (uuid, text, jsonb, jsonb, text)
from
  public,
  anon,
  authenticated;

revoke all on function public.build_budget_from_estimate_atomic (uuid, text, text)
from
  public,
  anon,
  authenticated;

revoke all on function public.convert_estimate_to_sov_atomic (uuid, uuid, text, text)
from
  public,
  anon,
  authenticated;

grant
execute on function public.update_cost_bucket_atomic (uuid, jsonb, text, text) to authenticated,
service_role;

grant
execute on function public.create_cost_bucket_atomic (uuid, jsonb, text) to authenticated,
service_role;

grant
execute on function public.delete_cost_bucket_atomic (uuid, uuid, text) to authenticated,
service_role;

grant
execute on function public.import_cost_buckets_atomic (uuid, text, jsonb, jsonb, text) to authenticated,
service_role;

grant
execute on function public.build_budget_from_estimate_atomic (uuid, text, text) to authenticated,
service_role;

grant
execute on function public.convert_estimate_to_sov_atomic (uuid, uuid, text, text) to authenticated,
service_role;

comment on table public.budget_command_operations is 'Immutable retry/audit ledger for project budget and SOV commands. One stable operation key per user intent.';

comment on column public.budget_line_overrides.operation_key is 'Stable operation key of the atomic bucket edit that produced this immutable override row.';

comment on column public.sov_imports.operation_key is 'Stable operation key of the atomic replace/append import. History and SOV commit together.';

comment on table public.estimate_sov_conversion_operations is 'Immutable retry ledger for estimate-to-existing-project and estimate-to-new-project SOV conversion.';
