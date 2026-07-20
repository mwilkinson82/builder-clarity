-- Billing financial-integrity boundary.
--
-- Public mutation commands explicitly require an authenticated project manager.
-- Most remain SECURITY INVOKER so project-scoped RLS still applies. Snapshot
-- generation is SECURITY DEFINER only because the immutable provenance table is
-- intentionally not client-writable; it repeats the auth/capability checks
-- before touching any row. Row locks serialize generation and edits for one pay
-- app. A function call is one Postgres transaction: if any line write or rollup
-- sync fails, every write in that call rolls back.

-- A billing snapshot is compared with the bucket manifest it captured, not
-- with today's mutable project bucket list. Otherwise adding a later cost code
-- makes every historical application look partially deleted.
alter table public.billing_applications
  add column if not exists billing_snapshot_bucket_count integer not null default 0;

-- Every cent value crosses the browser boundary as a JavaScript number. Keep
-- stored and generated values inside Number.MAX_SAFE_INTEGER so an exact
-- database integer can never be rounded before it reaches the biller.
do $$
begin
  if exists (
    select 1
    from public.billing_line_items line
    where line.scheduled_value_cents not between -9007199254740991 and 9007199254740991
       or line.change_order_value_cents not between -9007199254740991 and 9007199254740991
       or line.work_completed_previous_cents not between -9007199254740991 and 9007199254740991
       or line.materials_stored_previous_cents not between -9007199254740991 and 9007199254740991
       or line.work_completed_this_period_cents not between -9007199254740991 and 9007199254740991
       or line.materials_stored_this_period_cents not between -9007199254740991 and 9007199254740991
       or line.work_completed_to_date_cents not between -9007199254740991 and 9007199254740991
       or line.materials_stored_to_date_cents not between -9007199254740991 and 9007199254740991
       or line.total_completed_and_stored_cents not between -9007199254740991 and 9007199254740991
       or line.balance_to_finish_cents not between -9007199254740991 and 9007199254740991
       or line.retainage_held_cents not between -9007199254740991 and 9007199254740991
       or line.retainage_released_cents not between -9007199254740991 and 9007199254740991
  ) then
    raise exception using
      errcode = '22003',
      message = 'Existing billing line cents exceed the exact JavaScript accounting range.';
  end if;
end;
$$;

alter table public.billing_line_items
  drop constraint if exists billing_line_items_safe_integer_cents_check;
alter table public.billing_line_items
  add constraint billing_line_items_safe_integer_cents_check check (
    scheduled_value_cents between -9007199254740991 and 9007199254740991
    and change_order_value_cents between -9007199254740991 and 9007199254740991
    and work_completed_previous_cents between -9007199254740991 and 9007199254740991
    and materials_stored_previous_cents between -9007199254740991 and 9007199254740991
    and work_completed_this_period_cents between -9007199254740991 and 9007199254740991
    and materials_stored_this_period_cents between -9007199254740991 and 9007199254740991
    and work_completed_to_date_cents between -9007199254740991 and 9007199254740991
    and materials_stored_to_date_cents between -9007199254740991 and 9007199254740991
    and total_completed_and_stored_cents between -9007199254740991 and 9007199254740991
    and balance_to_finish_cents between -9007199254740991 and 9007199254740991
    and retainage_held_cents between -9007199254740991 and 9007199254740991
    and retainage_released_cents between -9007199254740991 and 9007199254740991
  );

drop trigger if exists billing_line_items_set_updated_at
  on public.billing_line_items;
create trigger billing_line_items_set_updated_at
  before update on public.billing_line_items
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_reject_billing_line_command_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'Billing line command evidence is immutable.';
end;
$$;

revoke all on function public.tg_reject_billing_line_command_mutation()
  from public, anon, authenticated, service_role;

create table if not exists public.billing_line_item_commands (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  operation_key text not null,
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint billing_line_item_commands_key_length
    check (length(btrim(operation_key)) between 1 and 200),
  constraint billing_line_item_commands_project_key_unique
    unique (project_id, operation_key)
);

create index if not exists billing_line_item_commands_project_created_idx
  on public.billing_line_item_commands(project_id, created_at desc);

alter table public.billing_line_item_commands enable row level security;

revoke all on table public.billing_line_item_commands
  from public, anon, authenticated, service_role;
grant select on table public.billing_line_item_commands
  to authenticated, service_role;

drop policy if exists billing_line_item_commands_select
  on public.billing_line_item_commands;
create policy billing_line_item_commands_select
  on public.billing_line_item_commands for select to authenticated
  using (public.can_read_project(project_id));

drop trigger if exists billing_line_item_commands_immutable
  on public.billing_line_item_commands;
create trigger billing_line_item_commands_immutable
  before update or delete on public.billing_line_item_commands
  for each row execute function public.tg_reject_billing_line_command_mutation();

-- The generation command caps a snapshot manifest at 500 buckets. Name the
-- offending application if legacy line data exceeds that cap, instead of
-- letting the backfill below abort with an anonymous check violation.
do $$
declare
  v_application_id uuid;
begin
  select application.id
  into v_application_id
  from public.billing_applications application
  join public.billing_line_items line
    on line.billing_application_id = application.id
  where application.billing_snapshot_bucket_count = 0
  group by application.id
  having count(*) > 500
  order by application.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Billing application %s has more than 500 line items and cannot record a snapshot bucket count.',
        v_application_id
      );
  end if;
end;
$$;

alter table public.billing_applications
  drop constraint if exists billing_applications_snapshot_bucket_count_check;
alter table public.billing_applications
  add constraint billing_applications_snapshot_bucket_count_check check (
    billing_snapshot_bucket_count between 0 and 500
  );

update public.billing_applications application
set billing_snapshot_bucket_count = snapshot.line_count
from (
  select billing_application_id, count(*)::integer as line_count
  from public.billing_line_items
  group by billing_application_id
) snapshot
where application.id = snapshot.billing_application_id
  and application.billing_snapshot_bucket_count = 0;

comment on column public.billing_applications.billing_snapshot_bucket_count is
  'Immutable count of project cost buckets captured when this application line snapshot was first generated.';

-- Once line detail exists, the four application totals below are a cache of
-- billing_line_items, never independent user input. Keep the existing public
-- sync function as the one canonical writer and mark only its UPDATE as an
-- internal reconciliation.
create or replace function public.sync_billing_application_from_lines(
  p_billing_application_id uuid
)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_line_count integer;
  v_amount numeric;
  v_current_retainage numeric;
  v_total_retainage_held numeric;
  v_retainage_released numeric;
  v_previous_rollup_write text :=
    current_setting('overwatch.billing_application_line_rollup_write', true);
begin
  select project_id
  into v_project_id
  from public.billing_applications
  where id = p_billing_application_id;

  if not found then
    raise exception 'Billing application % was not found', p_billing_application_id;
  end if;

  select
    count(*)::integer,
    coalesce(sum((work_completed_this_period_cents + materials_stored_this_period_cents)::numeric / 100), 0),
    coalesce(sum(round(
      (work_completed_this_period_cents + materials_stored_this_period_cents)::numeric
        * retainage_pct / 100
    ) / 100), 0),
    coalesce(sum((retainage_held_cents - retainage_released_cents)::numeric / 100), 0),
    coalesce(sum(retainage_released_cents::numeric / 100), 0)
  into
    v_line_count,
    v_amount,
    v_current_retainage,
    v_total_retainage_held,
    v_retainage_released
  from public.billing_line_items
  where billing_application_id = p_billing_application_id
    and project_id = v_project_id;

  perform set_config(
    'overwatch.billing_application_line_rollup_write',
    'reconciling',
    true
  );
  update public.billing_applications
  set amount_billed = v_amount,
      retainage = v_current_retainage,
      total_retainage_held = v_total_retainage_held,
      retainage_released_this_period = v_retainage_released,
      has_line_detail = v_line_count > 0
  where id = p_billing_application_id;
  perform set_config(
    'overwatch.billing_application_line_rollup_write',
    coalesce(v_previous_rollup_write, 'direct'),
    true
  );
end;
$$;

create or replace function public.tg_guard_billing_application_line_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_has_lines boolean := false;
  v_internal_rollup boolean := coalesce(
    current_setting('overwatch.billing_application_line_rollup_write', true),
    ''
  ) = 'reconciling';
  v_generation_write boolean := coalesce(
    current_setting('overwatch.billing_line_authoritative_write', true),
    ''
  ) = 'generating';
begin
  if tg_op = 'INSERT' then
    if new.has_line_detail
      or new.billing_snapshot_bucket_count <> 0
      or new.total_retainage_held <> 0
      or new.retainage_released_this_period <> 0 then
      raise exception using
        errcode = '23514',
        message = 'Line-detail flags and cumulative retainage are derived from billing lines.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft'
      or exists (
        select 1
        from public.billing_application_events event
        where event.billing_application_id = old.id
      )
      or exists (
        select 1
        from public.production_sov_billing_handoffs handoff
        where handoff.billing_application_id = old.id
      )
    then
      raise exception using
        errcode = '23514',
        message = 'Only a draft pay application without certification history can be deleted.';
    end if;
    return old;
  end if;

  if new.project_id is distinct from old.project_id and (
    exists (
      select 1 from public.billing_line_items line
      where line.billing_application_id = old.id
    )
    or exists (
      select 1 from public.billing_application_events event
      where event.billing_application_id = old.id
    )
    or exists (
      select 1 from public.production_sov_billing_handoffs handoff
      where handoff.billing_application_id = old.id
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A pay application with line or certification history cannot move to another project.';
  end if;

  select exists (
    select 1
    from public.billing_line_items line
    where line.billing_application_id = old.id
  ) into v_has_lines;

  if not v_internal_rollup then
    if new.has_line_detail is distinct from old.has_line_detail then
      raise exception using
        errcode = '23514',
        message = 'Pay-application line-detail state is maintained from billing lines.';
    end if;

    if (old.has_line_detail or v_has_lines) and (
      new.amount_billed is distinct from old.amount_billed
      or new.retainage is distinct from old.retainage
      or new.total_retainage_held is distinct from old.total_retainage_held
      or new.retainage_released_this_period is distinct from old.retainage_released_this_period
    ) then
      raise exception using
        errcode = '23514',
        message = 'Pay-application billed and retainage totals are derived from billing lines.';
    end if;
  end if;

  if new.billing_snapshot_bucket_count is distinct from old.billing_snapshot_bucket_count
    and not v_generation_write
  then
    raise exception using
      errcode = '23514',
      message = 'Pay-application billing snapshot size is database-derived and immutable.';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_applications_guard_line_integrity_insert
  on public.billing_applications;
create trigger billing_applications_guard_line_integrity_insert
  before insert on public.billing_applications
  for each row
  execute function public.tg_guard_billing_application_line_integrity();

drop trigger if exists billing_applications_guard_line_integrity_update
  on public.billing_applications;
create trigger billing_applications_guard_line_integrity_update
  before update of
    project_id,
    amount_billed,
    retainage,
    total_retainage_held,
    retainage_released_this_period,
    has_line_detail,
    billing_snapshot_bucket_count
  on public.billing_applications
  for each row
  execute function public.tg_guard_billing_application_line_integrity();

drop trigger if exists billing_applications_guard_line_integrity_delete
  on public.billing_applications;
create trigger billing_applications_guard_line_integrity_delete
  before delete on public.billing_applications
  for each row
  execute function public.tg_guard_billing_application_line_integrity();

create or replace function public.tg_sync_billing_applications_from_line_statement()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_application_ids uuid[] := array[]::uuid[];
  v_application_id uuid;
begin
  -- Bulk RPCs reconcile once after every requested line has been written. The
  -- transaction-local flag avoids doing the same rollup once per UPDATE in a
  -- Save All loop. Direct table writes cannot use that private RPC boundary and
  -- therefore always reconcile through this trigger.
  if current_setting('overwatch.billing_line_rollup_mode', true) = 'deferred' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select coalesce(array_agg(distinct billing_application_id order by billing_application_id), array[]::uuid[])
    into v_application_ids
    from new_rows;
  elsif tg_op = 'DELETE' then
    select coalesce(array_agg(distinct billing_application_id order by billing_application_id), array[]::uuid[])
    into v_application_ids
    from old_rows;
  else
    select coalesce(array_agg(application_id order by application_id), array[]::uuid[])
    into v_application_ids
    from (
      select billing_application_id as application_id from old_rows
      union
      select billing_application_id as application_id from new_rows
    ) affected;
  end if;

  if cardinality(v_application_ids) = 0 then
    return null;
  end if;

  -- Lock every still-existing application in deterministic order before the
  -- first rollup query. After a concurrent writer releases its lock, the next
  -- statement gets a fresh READ COMMITTED snapshot that includes its line
  -- changes. Missing applications are intentionally skipped for ON DELETE
  -- CASCADE from billing_applications.
  perform 1
  from public.billing_applications app
  where app.id = any(v_application_ids)
  order by app.id
  for update;

  foreach v_application_id in array v_application_ids
  loop
    if exists (
      select 1
      from public.billing_applications app
      where app.id = v_application_id
    ) then
      perform public.sync_billing_application_from_lines(v_application_id);
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.tg_validate_billing_line_scope()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_application_project_id uuid;
  v_bucket_project_id uuid;
begin
  select app.project_id
  into v_application_project_id
  from public.billing_applications app
  where app.id = new.billing_application_id;

  if not found or v_application_project_id is distinct from new.project_id then
    raise exception 'Billing line application and project must belong to the same project.'
      using errcode = '23514';
  end if;

  if new.cost_bucket_id is not null then
    select bucket.project_id
    into v_bucket_project_id
    from public.cost_buckets bucket
    where bucket.id = new.cost_bucket_id;

    if not found or v_bucket_project_id is distinct from new.project_id then
      raise exception 'Billing line cost bucket must belong to the same project.'
        using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.tg_protect_billing_line_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_application_status text;
  v_generation_write boolean := coalesce(
    current_setting('overwatch.billing_line_authoritative_write', true),
    ''
  ) = 'generating';
begin
  if tg_op = 'INSERT' then
    if not v_generation_write then
      raise exception using
        errcode = '23514',
        message = 'Billing lines must be generated from locked project financial records.';
    end if;
    return new;
  end if;

  select app.status
  into v_application_status
  from public.billing_applications app
  where app.id = old.billing_application_id;

  if tg_op = 'DELETE' then
    -- The only supported deletion path is ON DELETE CASCADE after the parent
    -- application has already been removed. Deleting even one draft child
    -- would leave a permanently incomplete SOV snapshot and make generation
    -- retries falsely appear successful.
    if v_application_status is not null then
      raise exception using
        errcode = '23514',
        message = 'Billing lines are an indivisible financial snapshot. Delete the draft pay application instead of individual lines.';
    end if;
    return old;
  end if;

  if not v_generation_write and (
    new.billing_application_id is distinct from old.billing_application_id
    or new.project_id is distinct from old.project_id
    or new.cost_bucket_id is distinct from old.cost_bucket_id
    or new.cost_code is distinct from old.cost_code
    or new.description is distinct from old.description
    or new.billing_method is distinct from old.billing_method
    or new.scheduled_value_cents is distinct from old.scheduled_value_cents
    or new.change_order_value_cents is distinct from old.change_order_value_cents
    or new.work_completed_previous_cents is distinct from old.work_completed_previous_cents
    or new.materials_stored_previous_cents is distinct from old.materials_stored_previous_cents
    or new.sort_order is distinct from old.sort_order
  ) then
    raise exception using
      errcode = '23514',
      message = 'Billing-line identity, contract, change-order, and prior-certified values are database-derived.';
  end if;

  if v_application_status is distinct from 'draft' and (
    new.work_completed_this_period_cents is distinct from old.work_completed_this_period_cents
    or new.materials_stored_this_period_cents is distinct from old.materials_stored_this_period_cents
    or new.retainage_pct is distinct from old.retainage_pct
    or new.retainage_released_cents is distinct from old.retainage_released_cents
  ) then
    raise exception using
      errcode = '23514',
      message = 'Only draft billing lines can be edited.';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_line_items_validate_scope
  on public.billing_line_items;
create trigger billing_line_items_validate_scope
  before insert or update on public.billing_line_items
  for each row
  execute function public.tg_validate_billing_line_scope();

drop trigger if exists billing_line_items_protect_authoritative_fields
  on public.billing_line_items;
create trigger billing_line_items_protect_authoritative_fields
  before insert or update or delete on public.billing_line_items
  for each row
  execute function public.tg_protect_billing_line_authority();

drop trigger if exists billing_line_items_sync_applications_after_insert
  on public.billing_line_items;
create trigger billing_line_items_sync_applications_after_insert
  after insert on public.billing_line_items
  referencing new table as new_rows
  for each statement
  execute function public.tg_sync_billing_applications_from_line_statement();

drop trigger if exists billing_line_items_sync_applications_after_update
  on public.billing_line_items;
create trigger billing_line_items_sync_applications_after_update
  after update on public.billing_line_items
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.tg_sync_billing_applications_from_line_statement();

drop trigger if exists billing_line_items_sync_applications_after_delete
  on public.billing_line_items;
create trigger billing_line_items_sync_applications_after_delete
  after delete on public.billing_line_items
  referencing old table as old_rows
  for each statement
  execute function public.tg_sync_billing_applications_from_line_statement();

-- Approved credits are signed on their CO allocation. Preserve that sign on
-- G702 line 2 while requiring the resulting line contract to stay nonnegative.
--
-- One historical Harbor demo draft was seeded before the cumulative-cap rule
-- existed and claims more current work than its remaining line contract. Repair
-- only that class of disposable demo draft data. Any production, certified, or
-- otherwise unrepairable violation aborts the migration instead of rewriting
-- financial history.
do $$
declare
  v_line record;
  v_is_demo_project boolean;
  v_remaining_before_current_cents bigint;
begin
  for v_line in
    select
      line.id,
      line.project_id,
      line.billing_application_id,
      app.status,
      line.scheduled_value_cents,
      line.change_order_value_cents,
      line.work_completed_previous_cents,
      line.materials_stored_previous_cents,
      line.work_completed_this_period_cents,
      line.materials_stored_this_period_cents
    from public.billing_line_items line
    join public.billing_applications app
      on app.id = line.billing_application_id
     and app.project_id = line.project_id
    where (
      line.work_completed_previous_cents::numeric
      + line.materials_stored_previous_cents::numeric
      + line.work_completed_this_period_cents::numeric
      + line.materials_stored_this_period_cents::numeric
    ) > (
      line.scheduled_value_cents::numeric
      + line.change_order_value_cents::numeric
    )
    order by line.id
    for update of line, app
  loop
    v_is_demo_project := false;
    if to_regclass('public.demo_seed_module_versions') is not null then
      execute
        'select exists (
           select 1
           from public.demo_seed_module_versions registry
           where registry.project_id = $1
         )'
      into v_is_demo_project
      using v_line.project_id;
    end if;

    v_remaining_before_current_cents :=
      v_line.scheduled_value_cents
      + v_line.change_order_value_cents
      - v_line.work_completed_previous_cents
      - v_line.materials_stored_previous_cents;

    if v_line.status <> 'draft'
      or not v_is_demo_project
      or v_remaining_before_current_cents < 0
      or v_line.materials_stored_this_period_cents > v_remaining_before_current_cents
    then
      raise exception using
        errcode = '23514',
        message = format(
          'Billing line %s exceeds its contract and cannot be repaired automatically.',
          v_line.id
        );
    end if;

    update public.billing_line_items
    set work_completed_this_period_cents =
      v_remaining_before_current_cents - v_line.materials_stored_this_period_cents
    where id = v_line.id;
  end loop;

  if exists (
    select 1
    from public.billing_line_items line
    where (
      line.work_completed_previous_cents::numeric
      + line.materials_stored_previous_cents::numeric
      + line.work_completed_this_period_cents::numeric
      + line.materials_stored_this_period_cents::numeric
    ) > (
      line.scheduled_value_cents::numeric
      + line.change_order_value_cents::numeric
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Billing-line contract violations remain after scoped demo repair.';
  end if;
end;
$$;

-- The cumulative-cap component of the constraint below was audited and
-- repaired just above, and the safe-integer domain was audited at the top of
-- this file. Name the offending row for the remaining nonnegativity and
-- retainage-range components instead of an anonymous check violation.
do $$
declare
  v_line_id uuid;
begin
  select line.id
  into v_line_id
  from public.billing_line_items line
  where line.scheduled_value_cents < 0
     or line.scheduled_value_cents + line.change_order_value_cents < 0
     or line.work_completed_previous_cents < 0
     or line.materials_stored_previous_cents < 0
     or line.work_completed_this_period_cents < 0
     or line.materials_stored_this_period_cents < 0
     or line.retainage_released_cents < 0
     or line.retainage_pct < 0
     or line.retainage_pct > 100
  order by line.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format(
        'Billing line %s has negative money or an out-of-range retainage percent.',
        v_line_id
      );
  end if;
end;
$$;

alter table public.billing_line_items
  drop constraint if exists billing_line_items_nonnegative_check;
alter table public.billing_line_items
  add constraint billing_line_items_nonnegative_check check (
    scheduled_value_cents >= 0
    and scheduled_value_cents + change_order_value_cents >= 0
    and work_completed_previous_cents >= 0
    and materials_stored_previous_cents >= 0
    and work_completed_this_period_cents >= 0
    and materials_stored_this_period_cents >= 0
    and retainage_released_cents >= 0
    and retainage_pct >= 0
    and retainage_pct <= 100
    and (
      work_completed_previous_cents::numeric
      + materials_stored_previous_cents::numeric
      + work_completed_this_period_cents::numeric
      + materials_stored_this_period_cents::numeric
    ) <= (
      scheduled_value_cents::numeric + change_order_value_cents::numeric
    )
  );

-- Preserve the exact approved change-order allocations that were folded into
-- each generated SOV line. The snapshot row is immutable, disappears only
-- when its draft billing application is deleted, and prevents a captured
-- allocation from being rewritten or removed later.
create table if not exists public.billing_line_change_order_allocations (
  billing_line_item_id uuid not null
    references public.billing_line_items(id) on delete cascade,
  change_order_allocation_id uuid not null
    references public.change_order_allocations(id) on delete restrict,
  billing_application_id uuid not null
    references public.billing_applications(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cost_bucket_id uuid references public.cost_buckets(id) on delete set null,
  contract_amount_cents bigint not null,
  cost_amount_cents bigint not null,
  captured_at timestamptz not null default now(),
  primary key (billing_line_item_id, change_order_allocation_id)
);

create index if not exists billing_line_co_allocations_allocation_idx
  on public.billing_line_change_order_allocations(change_order_allocation_id);

alter table public.billing_line_change_order_allocations enable row level security;

drop policy if exists billing_line_co_allocations_team_select
  on public.billing_line_change_order_allocations;
create policy billing_line_co_allocations_team_select
  on public.billing_line_change_order_allocations
  for select to authenticated
  using (public.can_read_project(project_id));

revoke all on public.billing_line_change_order_allocations
  from public, anon, authenticated, service_role;
grant select on public.billing_line_change_order_allocations to authenticated;
grant select on public.billing_line_change_order_allocations to service_role;

-- Legacy rows predate authoritative allocation snapshots. A same-project,
-- same-bucket, earlier-created allocation is only a candidate; it is not proof
-- that the allocation was approved and captured for this exact billing line.
-- Never fabricate an immutable relationship from that heuristic. Preserve the
-- ambiguity as a review finding and let all new snapshots record exact evidence
-- inside generate_billing_line_items_atomic below.
create table if not exists public.billing_line_co_provenance_findings (
  billing_line_item_id uuid primary key
    references public.billing_line_items(id) on delete cascade,
  billing_application_id uuid not null
    references public.billing_applications(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  cost_bucket_id uuid references public.cost_buckets(id) on delete set null,
  captured_change_order_value_cents bigint not null,
  candidate_allocation_ids uuid[] not null default array[]::uuid[],
  candidate_contract_amount_cents bigint not null default 0,
  candidate_count integer not null default 0,
  finding_status text not null default 'unresolved',
  finding_reason text not null,
  detected_at timestamptz not null default now(),
  constraint billing_line_co_provenance_finding_status_check
    check (finding_status in ('unresolved', 'resolved', 'not_applicable'))
);

alter table public.billing_line_co_provenance_findings enable row level security;

drop policy if exists billing_line_co_provenance_findings_team_select
  on public.billing_line_co_provenance_findings;
create policy billing_line_co_provenance_findings_team_select
  on public.billing_line_co_provenance_findings
  for select to authenticated
  using (public.can_read_project(project_id));

revoke all on public.billing_line_co_provenance_findings
  from public, anon, authenticated, service_role;
grant select on public.billing_line_co_provenance_findings to authenticated, service_role;

insert into public.billing_line_co_provenance_findings (
  billing_line_item_id,
  billing_application_id,
  project_id,
  cost_bucket_id,
  captured_change_order_value_cents,
  candidate_allocation_ids,
  candidate_contract_amount_cents,
  candidate_count,
  finding_reason
)
select
  line.id,
  line.billing_application_id,
  line.project_id,
  line.cost_bucket_id,
  line.change_order_value_cents,
  coalesce(candidate.allocation_ids, array[]::uuid[]),
  coalesce(candidate.contract_amount_cents, 0),
  coalesce(candidate.candidate_count, 0),
  'Legacy line has no approved-at-capture allocation manifest; candidate relationships are intentionally not asserted.'
from public.billing_line_items line
left join lateral (
  select
    array_agg(allocation.id order by allocation.created_at, allocation.id) as allocation_ids,
    coalesce(sum(round(allocation.contract_amount * 100)::bigint), 0)::bigint
      as contract_amount_cents,
    count(*)::integer as candidate_count
  from public.change_order_allocations allocation
  join public.change_orders change_order on change_order.id = allocation.change_order_id
  where allocation.project_id = line.project_id
    and allocation.cost_bucket_id = line.cost_bucket_id
    and allocation.created_at <= line.created_at
    and change_order.status = 'Approved'
) candidate on true
where line.change_order_value_cents <> 0
  and not exists (
    select 1
    from public.billing_line_change_order_allocations snapshot
    where snapshot.billing_line_item_id = line.id
  )
on conflict (billing_line_item_id) do nothing;

create or replace function public.tg_protect_billing_line_co_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if coalesce(
      current_setting('overwatch.billing_line_authoritative_write', true),
      ''
    ) <> 'generating' then
      raise exception using
        errcode = '23514',
        message = 'Billing change-order provenance can be created only with its locked billing snapshot.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'Billing change-order provenance is immutable.';
  end if;

  -- Permit only FK cascade after the owning line or application has already
  -- been removed. Ordinary DELETE keeps both parents visible and is rejected.
  if exists (
      select 1 from public.billing_line_items line
      where line.id = old.billing_line_item_id
    ) and exists (
      select 1 from public.billing_applications application
      where application.id = old.billing_application_id
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Billing change-order provenance is immutable.';
  end if;
  return old;
end;
$$;

revoke all on function public.tg_protect_billing_line_co_provenance()
  from public, anon, authenticated, service_role;

drop trigger if exists billing_line_co_allocations_protect_provenance
  on public.billing_line_change_order_allocations;
create trigger billing_line_co_allocations_protect_provenance
  before insert or update or delete
  on public.billing_line_change_order_allocations
  for each row
  execute function public.tg_protect_billing_line_co_provenance();

drop function if exists public.generate_billing_line_items_atomic(uuid, uuid, jsonb);
create or replace function public.generate_billing_line_items_atomic(
  p_project_id uuid,
  p_billing_application_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.billing_applications%rowtype;
  v_default_retainage_pct numeric;
  v_previous_application_id uuid;
  v_bucket_count integer;
  v_cross_project_count integer;
  v_existing_count integer;
  v_existing_distinct_bucket_count integer;
  v_expected_snapshot_count integer;
  v_created_count integer;
  v_target_this_period_cents bigint;
  v_previous_rollup_mode text := current_setting('overwatch.billing_line_rollup_mode', true);
  v_previous_authoritative_write text :=
    current_setting('overwatch.billing_line_authoritative_write', true);
begin
  if auth.uid() is null then
    raise exception 'Sign in before generating billing line items.' using errcode = '42501';
  end if;

  if not public.can_manage_project(p_project_id) then
    raise exception 'You do not have permission to manage billing for this project.'
      using errcode = '42501';
  end if;

  -- One project lock serializes first-generation snapshots. Besides preventing
  -- competing generators from holding different application rows, the parent
  -- lock blocks new FK children while the existing source rows are locked.
  select project.default_retainage_pct
  into v_default_retainage_pct
  from public.projects project
  where project.id = p_project_id
  for update;

  if not found then
    raise exception 'Project % was not found.', p_project_id;
  end if;

  -- The application row is the concurrency lock for both first generation and
  -- retry reconciliation. Two callers cannot both observe an empty line set.
  select *
  into v_application
  from public.billing_applications
  where id = p_billing_application_id
  for update;

  if not found then
    raise exception 'Billing application % was not found.', p_billing_application_id;
  end if;

  if v_application.project_id <> p_project_id then
    raise exception 'The billing application does not belong to this project.';
  end if;

  select
    count(*)::integer,
    count(distinct cost_bucket_id) filter (where cost_bucket_id is not null)::integer,
    count(*) filter (where project_id <> p_project_id)::integer
  into v_existing_count, v_existing_distinct_bucket_count, v_cross_project_count
  from public.billing_line_items
  where billing_application_id = p_billing_application_id;

  if v_cross_project_count > 0 then
    raise exception 'Existing billing lines do not share the application project.'
      using errcode = '23514';
  end if;

  select count(*)::integer
  into v_bucket_count
  from public.cost_buckets bucket
  where bucket.project_id = p_project_id;

  -- A caller may be retrying after the database committed but the response was
  -- lost. Compare with the immutable manifest captured at first generation,
  -- never today's bucket list: later cost-code additions cannot rewrite or
  -- invalidate historical snapshots.
  if v_existing_count > 0 then
    v_expected_snapshot_count := v_application.billing_snapshot_bucket_count;
    if v_expected_snapshot_count <= 0
      or v_existing_count <> v_expected_snapshot_count
      or v_existing_distinct_bucket_count <> v_expected_snapshot_count
    then
      raise exception using
        errcode = '23514',
        message = 'The existing billing snapshot is incomplete and cannot be treated as a successful generation retry.';
    end if;
    perform public.sync_billing_application_from_lines(p_billing_application_id);
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'line_count', v_existing_count
    );
  end if;

  if v_application.status <> 'draft' then
    raise exception 'Billing lines can only be generated for a draft application.'
      using errcode = '23514';
  end if;

  -- Lock every source row before deriving cents. CO allocation commands lock
  -- the CO parent before its allocations, so generation follows that order.
  -- UUID ordering makes concurrent generation deterministic.
  perform 1
  from public.cost_buckets bucket
  where bucket.project_id = p_project_id
  order by bucket.id
  for update;

  if v_bucket_count = 0 then
    raise exception 'Import or create SOV cost buckets before generating line detail.';
  end if;
  if v_bucket_count > 500 then
    raise exception 'Billing line generation supports at most 500 cost buckets.';
  end if;

  perform 1
  from public.change_orders change_order
  where change_order.project_id = p_project_id
  order by change_order.id
  for update;

  perform 1
  from public.change_order_allocations allocation
  where allocation.project_id = p_project_id
  order by allocation.id
  for update;

  -- The immediately preceding application is deterministic even when two
  -- applications share a sort_order. Its cumulative certified values are the
  -- only source for the new line's previous-period columns.
  select prior.id
  into v_previous_application_id
  from public.billing_applications prior
  where prior.project_id = p_project_id
    and prior.status in ('submitted', 'partial', 'paid')
    and (prior.sort_order, prior.id) < (v_application.sort_order, v_application.id)
  order by prior.sort_order desc, prior.id desc
  limit 1;

  if v_previous_application_id is not null then
    perform 1
    from public.billing_line_items line
    where line.billing_application_id = v_previous_application_id
    order by line.id
    for update;
  end if;

  if exists (
    select 1
    from public.cost_buckets bucket
    left join lateral (
      select coalesce(sum(round(allocation.contract_amount * 100)::bigint), 0)::bigint
        as change_cents
      from public.change_order_allocations allocation
      join public.change_orders change_order
        on change_order.id = allocation.change_order_id
       and change_order.project_id = p_project_id
       and change_order.status = 'Approved'
      where allocation.project_id = p_project_id
        and allocation.cost_bucket_id = bucket.id
    ) approved_change on true
    where bucket.project_id = p_project_id
      and (
        round(
          (case when coalesce(bucket.contract_value, 0) > 0
            then bucket.contract_value
            else bucket.original_budget
          end) * 100
        )::bigint < 0
        or round(
          (case when coalesce(bucket.contract_value, 0) > 0
            then bucket.contract_value
            else bucket.original_budget
          end) * 100
        )::bigint + approved_change.change_cents < 0
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A billing bucket or approved credit produces a negative line contract.';
  end if;

  v_target_this_period_cents := round(v_application.amount_billed * 100)::bigint;
  if v_target_this_period_cents < 0 then
    raise exception 'Billing amount cannot be negative.' using errcode = '23514';
  end if;

  perform set_config('overwatch.billing_line_rollup_mode', 'deferred', true);
  perform set_config('overwatch.billing_line_authoritative_write', 'generating', true);

  with bucket_values as materialized (
    select
      bucket.id as cost_bucket_id,
      bucket.cost_code,
      bucket.bucket as description,
      bucket.billing_method,
      round(
        (case when coalesce(bucket.contract_value, 0) > 0
          then bucket.contract_value
          else bucket.original_budget
        end) * 100
      )::bigint as scheduled_value_cents,
      coalesce(sum(
        case when change_order.status = 'Approved'
          then round(allocation.contract_amount * 100)::bigint
          else 0
        end
      ), 0)::bigint as change_order_value_cents,
      coalesce(previous_line.work_completed_to_date_cents, 0)::bigint
        as work_completed_previous_cents,
      coalesce(previous_line.materials_stored_to_date_cents, 0)::bigint
        as materials_stored_previous_cents,
      coalesce(nullif(bucket.retainage_pct, 0), v_default_retainage_pct) as retainage_pct,
      bucket.sort_order,
      row_number() over (order by bucket.sort_order, bucket.id)::integer as line_number,
      count(*) over ()::integer as line_count
    from public.cost_buckets bucket
    left join public.change_order_allocations allocation
      on allocation.project_id = p_project_id
     and allocation.cost_bucket_id = bucket.id
    left join public.change_orders change_order
      on change_order.id = allocation.change_order_id
     and change_order.project_id = p_project_id
    left join public.billing_line_items previous_line
      on previous_line.billing_application_id = v_previous_application_id
     and previous_line.project_id = p_project_id
     and previous_line.cost_bucket_id = bucket.id
    where bucket.project_id = p_project_id
    group by
      bucket.id,
      bucket.cost_code,
      bucket.bucket,
      bucket.billing_method,
      bucket.contract_value,
      bucket.original_budget,
      previous_line.work_completed_to_date_cents,
      previous_line.materials_stored_to_date_cents,
      bucket.retainage_pct,
      bucket.sort_order
  ), weighted as materialized (
    select
      bucket_values.*,
      (
        scheduled_value_cents
        + change_order_value_cents
        - work_completed_previous_cents
        - materials_stored_previous_cents
      )::bigint as remaining_capacity_cents,
      sum(
        scheduled_value_cents
        + change_order_value_cents
        - work_completed_previous_cents
        - materials_stored_previous_cents
      ) over ()::bigint as remaining_total_cents
    from bucket_values
  ), proportional as materialized (
    select
      weighted.*,
      case
        when remaining_capacity_cents < 0 then null
        when remaining_total_cents > 0 then
          v_target_this_period_cents::numeric
            * remaining_capacity_cents::numeric
            / remaining_total_cents::numeric
        else 0::numeric
      end as raw_this_period_cents
    from weighted
  ), ranked as materialized (
    select
      proportional.*,
      floor(raw_this_period_cents)::bigint as floored_this_period_cents,
      row_number() over (
        order by
          raw_this_period_cents - floor(raw_this_period_cents) desc,
          line_number
      )::bigint as remainder_rank,
      (
        v_target_this_period_cents
        - sum(floor(raw_this_period_cents)::bigint) over ()::bigint
      )::bigint as remainder_cents
    from proportional
    where raw_this_period_cents is not null
      and v_target_this_period_cents <= remaining_total_cents
  ), allocated as materialized (
    select
      ranked.*,
      (
        floored_this_period_cents
        + case when remainder_rank <= remainder_cents then 1 else 0 end
      )::bigint as allocated_this_period_cents
    from ranked
  )
  insert into public.billing_line_items (
    billing_application_id,
    project_id,
    cost_bucket_id,
    cost_code,
    description,
    billing_method,
    scheduled_value_cents,
    change_order_value_cents,
    work_completed_previous_cents,
    materials_stored_previous_cents,
    work_completed_this_period_cents,
    materials_stored_this_period_cents,
    retainage_pct,
    retainage_released_cents,
    sort_order
  )
  select
    p_billing_application_id,
    p_project_id,
    allocated.cost_bucket_id,
    allocated.cost_code,
    allocated.description,
    allocated.billing_method,
    allocated.scheduled_value_cents,
    allocated.change_order_value_cents,
    allocated.work_completed_previous_cents,
    allocated.materials_stored_previous_cents,
    allocated.allocated_this_period_cents,
    0,
    allocated.retainage_pct,
    0,
    case when allocated.sort_order <> 0
      then allocated.sort_order
      else allocated.line_number
    end
  from allocated
  order by allocated.line_number;

  get diagnostics v_created_count = row_count;
  if v_created_count <> v_bucket_count then
    raise exception using
      errcode = '23514',
      message = 'Billing amount exceeds the remaining contract capacity or prior certified values exceed a line contract.';
  end if;

  insert into public.billing_line_change_order_allocations (
    billing_line_item_id,
    change_order_allocation_id,
    billing_application_id,
    project_id,
    cost_bucket_id,
    contract_amount_cents,
    cost_amount_cents
  )
  select
    line.id,
    allocation.id,
    p_billing_application_id,
    p_project_id,
    allocation.cost_bucket_id,
    round(allocation.contract_amount * 100)::bigint,
    round(allocation.cost_amount * 100)::bigint
  from public.billing_line_items line
  join public.change_order_allocations allocation
    on allocation.project_id = p_project_id
   and allocation.cost_bucket_id = line.cost_bucket_id
  join public.change_orders change_order
    on change_order.id = allocation.change_order_id
   and change_order.project_id = p_project_id
   and change_order.status = 'Approved'
  where line.billing_application_id = p_billing_application_id
    and line.project_id = p_project_id
  on conflict do nothing;

  update public.billing_applications
  set billing_snapshot_bucket_count = v_created_count
  where id = p_billing_application_id;

  perform set_config(
    'overwatch.billing_line_authoritative_write',
    coalesce(v_previous_authoritative_write, 'direct'),
    true
  );
  perform set_config(
    'overwatch.billing_line_rollup_mode',
    coalesce(v_previous_rollup_mode, 'immediate'),
    true
  );
  perform public.sync_billing_application_from_lines(p_billing_application_id);

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'line_count', v_created_count
  );
end;
$$;

drop function if exists public.apply_billing_line_item_mutations_atomic(jsonb);
create or replace function public.apply_billing_line_item_mutations_atomic(
  p_items jsonb,
  p_operation_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_id uuid := auth.uid();
  v_item jsonb;
  v_normalized_items jsonb;
  v_fingerprint text;
  v_project_ids uuid[];
  v_project_id uuid;
  v_found_count integer;
  v_existing_command public.billing_line_item_commands%rowtype;
  v_line public.billing_line_items%rowtype;
  v_expected_updated_at timestamptz;
  v_new_updated_at timestamptz;
  v_work_this_period bigint;
  v_materials_this_period bigint;
  v_retainage_pct numeric;
  v_retainage_release bigint;
  v_retainage_cap numeric;
  v_contract_total numeric;
  v_completed_total numeric;
  v_application_ids uuid[] := array[]::uuid[];
  v_application_id uuid;
  v_saved_count integer := 0;
  v_saved_versions jsonb := '[]'::jsonb;
  v_result jsonb;
  v_previous_rollup_mode text := current_setting('overwatch.billing_line_rollup_mode', true);
begin
  if v_actor_id is null then
    raise exception 'Sign in before updating billing line items.' using errcode = '42501';
  end if;

  if p_operation_key is null
    or length(btrim(p_operation_key)) not between 1 and 200 then
    raise exception 'Billing line saves require a stable operation key.' using errcode = '22023';
  end if;

  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) = 0
    or jsonb_array_length(p_items) > 500 then
    raise exception 'Billing updates require between 1 and 500 line items.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as item(value)
    where jsonb_typeof(item.value) <> 'object'
       or nullif(btrim(item.value ->> 'id'), '') is null
       or nullif(btrim(item.value ->> 'expected_updated_at'), '') is null
  ) then
    raise exception 'Every billing update requires a line id and expected updated-at version.'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_items) as item(value)
  ) <> (
    select count(distinct item.value ->> 'id')
    from jsonb_array_elements(p_items) as item(value)
  ) then
    raise exception 'A billing line can only appear once in a Save All request.';
  end if;

  select
    array_agg(distinct line.project_id),
    count(*)::integer
  into v_project_ids, v_found_count
  from public.billing_line_items line
  join jsonb_array_elements(p_items) as item(value)
    on line.id = (item.value ->> 'id')::uuid;

  if v_found_count <> jsonb_array_length(p_items) then
    raise exception 'One or more billing lines were not found.' using errcode = 'P0002';
  end if;
  if coalesce(cardinality(v_project_ids), 0) <> 1 then
    raise exception 'One billing command cannot span multiple projects.' using errcode = '23514';
  end if;
  v_project_id := v_project_ids[1];

  if not public.can_manage_project(v_project_id) then
    raise exception 'You do not have permission to manage billing for this project.'
      using errcode = '42501';
  end if;

  select jsonb_agg(item.value order by item.value ->> 'id')
  into v_normalized_items
  from jsonb_array_elements(p_items) as item(value);
  v_fingerprint := encode(
    extensions.digest(jsonb_build_object('items', v_normalized_items)::text, 'sha256'),
    'hex'
  );

  -- All financial commands for this project start with the project lock. It
  -- also makes idempotency lookup + mutation one serialized decision.
  perform 1 from public.projects where id = v_project_id for update;
  if not found then
    raise exception 'Project % was not found.', v_project_id using errcode = 'P0002';
  end if;

  select *
  into v_existing_command
  from public.billing_line_item_commands command
  where command.project_id = v_project_id
    and command.operation_key = btrim(p_operation_key);
  if found then
    if v_existing_command.request_fingerprint <> v_fingerprint then
      raise exception using
        errcode = '23505',
        message = 'That billing operation key was already used for a different request.';
    end if;
    return v_existing_command.result;
  end if;

  -- Match generation's project -> application -> line lock order. Raw client
  -- DML is revoked below, so every supported editor follows this order.
  perform 1
  from public.billing_applications app
  where app.id in (
    select distinct line.billing_application_id
    from public.billing_line_items line
    join jsonb_array_elements(p_items) as item(value)
      on line.id = (item.value ->> 'id')::uuid
  )
  order by app.id
  for update;

  perform 1
  from public.billing_line_items line
  join jsonb_array_elements(p_items) as item(value)
    on line.id = (item.value ->> 'id')::uuid
  order by line.id
  for update of line;

  perform set_config('overwatch.billing_line_rollup_mode', 'deferred', true);

  for v_item in
    select item.value
    from jsonb_array_elements(v_normalized_items) as item(value)
  loop
    select *
    into v_line
    from public.billing_line_items
    where id = (v_item ->> 'id')::uuid;

    if not found then
      raise exception 'Billing line % was not found.', v_item ->> 'id' using errcode = 'P0002';
    end if;
    if v_line.project_id <> v_project_id then
      raise exception 'A billing line moved projects during the save.' using errcode = '40001';
    end if;

    begin
      v_expected_updated_at := (v_item ->> 'expected_updated_at')::timestamptz;
    exception when others then
      raise exception 'Billing line % has an invalid expected updated-at version.', v_line.id
        using errcode = '22007';
    end;
    if v_line.updated_at is distinct from v_expected_updated_at then
      raise exception using
        errcode = '40001',
        message = format(
          'Billing line %s changed after this screen loaded. Refresh before saving so another biller''s work is not overwritten.',
          v_line.id
        );
    end if;

    v_work_this_period := case
      when v_item ? 'work_completed_this_period_cents'
        then (v_item ->> 'work_completed_this_period_cents')::bigint
      else v_line.work_completed_this_period_cents
    end;
    v_materials_this_period := case
      when v_item ? 'materials_stored_this_period_cents'
        then (v_item ->> 'materials_stored_this_period_cents')::bigint
      else v_line.materials_stored_this_period_cents
    end;
    v_retainage_pct := case
      when v_item ? 'retainage_pct' then (v_item ->> 'retainage_pct')::numeric
      else v_line.retainage_pct
    end;

    if v_work_this_period is null or v_work_this_period < 0
      or v_work_this_period > 9007199254740991
      or v_materials_this_period is null or v_materials_this_period < 0
      or v_materials_this_period > 9007199254740991
      or v_retainage_pct is null or v_retainage_pct < 0 or v_retainage_pct > 100 then
      raise exception using
        errcode = '22003',
        message = 'Billing line values must be exact safe cents and retainage must be between 0 and 100 percent.';
    end if;

    v_completed_total :=
      v_line.work_completed_previous_cents::numeric
      + v_line.materials_stored_previous_cents::numeric
      + v_work_this_period::numeric
      + v_materials_this_period::numeric;
    v_contract_total :=
      v_line.scheduled_value_cents::numeric
      + v_line.change_order_value_cents::numeric;

    if abs(v_completed_total) > 9007199254740991
      or abs(v_contract_total) > 9007199254740991 then
      raise exception 'Billing line totals exceed the exact JavaScript accounting range.'
        using errcode = '22003';
    end if;
    if v_completed_total > v_contract_total then
      raise exception using
        errcode = '23514',
        message = 'Completed work and stored materials cannot exceed the line contract value.';
    end if;

    v_retainage_cap := greatest(0, round(v_completed_total * v_retainage_pct / 100));
    if v_retainage_cap > 9007199254740991 then
      raise exception 'Retainage exceeds the exact JavaScript accounting range.'
        using errcode = '22003';
    end if;
    v_retainage_release := case
      when v_item ? 'retainage_released_cents'
        then least((v_item ->> 'retainage_released_cents')::bigint, v_retainage_cap::bigint)
      when v_item ? 'retainage_pct'
        or v_item ? 'work_completed_this_period_cents'
        or v_item ? 'materials_stored_this_period_cents'
        then least(v_line.retainage_released_cents, v_retainage_cap::bigint)
      else v_line.retainage_released_cents
    end;

    if v_retainage_release is null or v_retainage_release < 0
      or v_retainage_release > 9007199254740991 then
      raise exception 'Retainage released must be nonnegative exact safe cents.'
        using errcode = '22003';
    end if;

    update public.billing_line_items
    set work_completed_this_period_cents = v_work_this_period,
        materials_stored_this_period_cents = v_materials_this_period,
        retainage_pct = v_retainage_pct,
        retainage_released_cents = v_retainage_release
    where id = v_line.id
    returning updated_at into v_new_updated_at;

    v_saved_versions := v_saved_versions || jsonb_build_array(jsonb_build_object(
      'id', v_line.id,
      'updated_at', v_new_updated_at
    ));
    if not (v_line.billing_application_id = any(v_application_ids)) then
      v_application_ids := array_append(v_application_ids, v_line.billing_application_id);
    end if;
    v_saved_count := v_saved_count + 1;
  end loop;

  perform set_config(
    'overwatch.billing_line_rollup_mode',
    coalesce(v_previous_rollup_mode, 'immediate'),
    true
  );
  foreach v_application_id in array v_application_ids
  loop
    perform public.sync_billing_application_from_lines(v_application_id);
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'saved_count', v_saved_count,
    'versions', v_saved_versions
  );
  insert into public.billing_line_item_commands (
    project_id,
    operation_key,
    request_fingerprint,
    result,
    changed_by
  ) values (
    v_project_id,
    btrim(p_operation_key),
    v_fingerprint,
    v_result,
    v_actor_id
  );

  return v_result;
end;
$$;

create or replace function public.update_billing_application_retainage_atomic(
  p_billing_application_id uuid,
  p_retainage_pct numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app public.billing_applications%rowtype;
  v_line_count integer;
  v_previous_rollup_mode text := current_setting('overwatch.billing_line_rollup_mode', true);
begin
  if auth.uid() is null then
    raise exception 'Sign in before updating billing retainage.' using errcode = '42501';
  end if;

  if p_retainage_pct is null or p_retainage_pct < 0 or p_retainage_pct > 100 then
    raise exception 'Retainage must be between 0 and 100 percent.';
  end if;

  select *
  into v_app
  from public.billing_applications
  where id = p_billing_application_id;

  if not found then
    raise exception 'Billing application % was not found.', p_billing_application_id;
  end if;

  if not public.can_manage_project(v_app.project_id) then
    raise exception 'You do not have permission to manage billing for this project.'
      using errcode = '42501';
  end if;

  -- Match generation and line-save command ordering now that raw client DML is
  -- closed: project -> application -> line.
  perform 1
  from public.projects project
  where project.id = v_app.project_id
  for update;
  select *
  into v_app
  from public.billing_applications
  where id = p_billing_application_id
  for update;

  if not found then
    raise exception 'Billing application % was not found.', p_billing_application_id;
  end if;

  if not public.can_manage_project(v_app.project_id) then
    raise exception 'You do not have permission to manage billing for this project.'
      using errcode = '42501';
  end if;

  perform 1
  from public.billing_line_items line
  where line.billing_application_id = p_billing_application_id
    and line.project_id = v_app.project_id
  order by line.id
  for update;

  perform set_config('overwatch.billing_line_rollup_mode', 'deferred', true);

  update public.billing_line_items
  set retainage_pct = p_retainage_pct,
      retainage_released_cents = least(
        retainage_released_cents,
        greatest(
          0,
          round(
            (
              work_completed_previous_cents
              + materials_stored_previous_cents
              + work_completed_this_period_cents
              + materials_stored_this_period_cents
            )::numeric * p_retainage_pct / 100
          )::bigint
        )
      )
  where billing_application_id = p_billing_application_id
    and project_id = v_app.project_id;

  get diagnostics v_line_count = row_count;
  perform set_config(
    'overwatch.billing_line_rollup_mode',
    coalesce(v_previous_rollup_mode, 'immediate'),
    true
  );
  perform public.sync_billing_application_from_lines(p_billing_application_id);

  return jsonb_build_object('ok', true, 'line_count', v_line_count);
end;
$$;

revoke all on function public.tg_sync_billing_applications_from_line_statement()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_billing_line_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_protect_billing_line_authority()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_guard_billing_application_line_integrity()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_protect_billing_line_co_provenance()
  from public, anon, authenticated, service_role;
revoke all on function public.sync_billing_application_from_lines(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.generate_billing_line_items_atomic(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_billing_line_item_mutations_atomic(jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.update_billing_application_retainage_atomic(uuid, numeric)
  from public, anon, authenticated, service_role;

-- Billing line money is command-only. Service processors do not need a raw
-- escape hatch; migrations still execute as the owning database role.
revoke insert, update, delete on table public.billing_line_items
  from authenticated, service_role;

grant execute on function public.generate_billing_line_items_atomic(uuid, uuid)
  to authenticated, service_role;
grant execute on function public.apply_billing_line_item_mutations_atomic(jsonb, text)
  to authenticated;
grant execute on function public.update_billing_application_retainage_atomic(uuid, numeric)
  to authenticated;

comment on function public.tg_sync_billing_applications_from_line_statement() is
  'Maintains billing-application rollups after direct statement-level line inserts, updates, and deletes.';
comment on function public.tg_validate_billing_line_scope() is
  'Rejects direct billing-line writes whose application, project, and cost bucket do not share one project.';
comment on function public.tg_protect_billing_line_authority() is
  'Protects generated and prior-certified billing-line fields and freezes non-draft line amounts.';
comment on function public.tg_guard_billing_application_line_integrity() is
  'Protects line-derived pay-application totals and project ownership once financial history exists.';
comment on function public.tg_protect_billing_line_co_provenance() is
  'Makes captured billing/change-order allocation provenance immutable except for parent snapshot cascade.';

comment on function public.generate_billing_line_items_atomic(uuid, uuid) is
  'Atomically derives locked project financial inputs, generates one billing line set, or retry-reconciles its totals.';
comment on function public.apply_billing_line_item_mutations_atomic(jsonb, text) is
  'Idempotently applies one optimistic-concurrency billing-line batch and synchronizes every affected application.';
comment on function public.update_billing_application_retainage_atomic(uuid, numeric) is
  'Atomically updates all line retainage rates for one application and synchronizes its totals.';

notify pgrst, 'reload schema';
