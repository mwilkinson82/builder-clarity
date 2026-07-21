-- Adversarial financial-authority hardening.
--
-- This migration closes the remaining raw-table escape hatches after the
-- atomic budget, subcontract-payment, and estimate-import commands landed.
-- Financial mutations are command-only, cent arithmetic stays inside
-- JavaScript's exact integer range, final/converted estimates are immutable,
-- and audit/retry journals cannot be edited or cascade-deleted.
create or replace function public.assert_safe_accounting_cents (
  p_cents numeric,
  p_label text,
  p_allow_negative boolean default false
) returns numeric language plpgsql immutable
set
  search_path = '' as $$
begin
  if p_cents is null
     or p_cents <> trunc(p_cents)
     or abs(p_cents) > 9007199254740991
     or (not p_allow_negative and p_cents < 0)
  then
    raise exception using
      errcode = '22003',
      message = format(
        '%s must be exact integer cents between %s and %s.',
        coalesce(nullif(p_label, ''), 'Money'),
        case when p_allow_negative then '-9007199254740991' else '0' end,
        '9007199254740991'
      );
  end if;
  return p_cents;
end;
$$;

revoke all on function public.assert_safe_accounting_cents (numeric, text, boolean)
from
  public,
  anon,
  authenticated,
  service_role;

-- Row triggers run under the mutating role and call this pure validator. It is
-- intentionally executable by application roles but cannot read or write data.
grant
execute on function public.assert_safe_accounting_cents (numeric, text, boolean) to authenticated,
service_role;

create or replace function public.reject_financial_journal_mutation () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%s is immutable financial evidence.', tg_table_name);
end;
$$;

revoke all on function public.reject_financial_journal_mutation ()
from
  public,
  anon,
  authenticated,
  service_role;

-- Existing journals previously had ON DELETE CASCADE/SET NULL foreign keys.
-- Parent project/estimate/cost-bucket references are replaced with ON DELETE
-- RESTRICT so evidence cannot be orphaned or erased. Actor/user foreign keys
-- are intentionally removed so account deletion cannot rewrite audit rows.
alter table public.budget_command_operations
drop constraint if exists budget_command_operations_project_id_fkey,
drop constraint if exists budget_command_operations_changed_by_fkey;

alter table public.estimate_sov_conversion_operations
drop constraint if exists estimate_sov_conversion_operations_estimate_id_fkey,
drop constraint if exists estimate_sov_conversion_operations_project_id_fkey,
drop constraint if exists estimate_sov_conversion_operations_changed_by_fkey;

alter table public.budget_money_repairs
drop constraint if exists budget_money_repairs_project_id_fkey,
drop constraint if exists budget_money_repairs_cost_bucket_id_fkey;

alter table public.estimate_import_operations
drop constraint if exists estimate_import_operations_estimate_id_fkey,
drop constraint if exists estimate_import_operations_created_by_fkey;

alter table public.budget_command_operations
add constraint budget_command_operations_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict;

alter table public.estimate_sov_conversion_operations
add constraint estimate_sov_conversion_operations_estimate_id_fkey foreign key (estimate_id) references public.estimates (id) on delete restrict,
add constraint estimate_sov_conversion_operations_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict;

alter table public.budget_money_repairs
add constraint budget_money_repairs_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict,
-- Deliberately SET NULL (matching how the journal was created): repair
-- evidence must OUTLIVE a later legitimate bucket delete (delete command,
-- replace import, estimate conversion). RESTRICT here would make every
-- cent-repaired bucket permanently undeletable, breaking this batch's own
-- delete/replace commands; the immutable row keeps its target_key text.
add constraint budget_money_repairs_cost_bucket_id_fkey foreign key (cost_bucket_id) references public.cost_buckets (id) on delete set null;

alter table public.estimate_import_operations
add constraint estimate_import_operations_estimate_id_fkey foreign key (estimate_id) references public.estimates (id) on delete restrict;

revoke all on table public.budget_command_operations,
public.estimate_sov_conversion_operations,
public.budget_money_repairs,
public.estimate_import_operations
from
  public,
  anon,
  authenticated,
  service_role;

grant
select
  on table public.budget_command_operations,
  public.estimate_sov_conversion_operations,
  public.budget_money_repairs,
  public.estimate_import_operations to authenticated,
  service_role;

drop trigger if exists budget_command_operations_immutable on public.budget_command_operations;

create trigger budget_command_operations_immutable
before update or delete on public.budget_command_operations for each row
execute function public.reject_financial_journal_mutation ();

drop trigger if exists estimate_sov_conversion_operations_immutable on public.estimate_sov_conversion_operations;

create trigger estimate_sov_conversion_operations_immutable
before update or delete on public.estimate_sov_conversion_operations for each row
execute function public.reject_financial_journal_mutation ();

-- budget_money_repairs is immutable evidence with ONE sanctioned exception:
-- when a repaired cost bucket is later legitimately deleted (delete command,
-- replace import, estimate conversion), the FK's ON DELETE SET NULL detaches
-- the pointer. That system-generated UPDATE changes cost_bucket_id to null and
-- nothing else; the row's target_key text keeps identifying what was repaired.
create or replace function public.reject_budget_money_repair_mutation () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and old.cost_bucket_id is not null
     and new.cost_bucket_id is null
     and (to_jsonb(old) - 'cost_bucket_id') = (to_jsonb(new) - 'cost_bucket_id')
  then
    return new;
  end if;
  raise exception using
    errcode = '55000',
    message = format('%s is immutable financial evidence.', tg_table_name);
end;
$$;

revoke all on function public.reject_budget_money_repair_mutation ()
from
  public,
  anon,
  authenticated,
  service_role;

drop trigger if exists budget_money_repairs_immutable on public.budget_money_repairs;

create trigger budget_money_repairs_immutable
before update or delete on public.budget_money_repairs for each row
execute function public.reject_budget_money_repair_mutation ();

drop trigger if exists estimate_import_operations_immutable on public.estimate_import_operations;

create trigger estimate_import_operations_immutable
before update or delete on public.estimate_import_operations for each row
execute function public.reject_financial_journal_mutation ();

create table if not exists public.project_financial_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  operation_key text not null,
  operation_type text not null check (
    operation_type in (
      'project_create',
      'project_header_update',
      'project_budget_lock'
    )
  ),
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint project_financial_operations_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint project_financial_operations_actor_key_unique unique (changed_by, operation_key)
);

alter table public.project_financial_operations
drop constraint if exists project_financial_operations_project_id_fkey,
add constraint project_financial_operations_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict;

create index if not exists project_financial_operations_project_created_idx on public.project_financial_operations (project_id, created_at desc);

alter table public.project_financial_operations enable row level security;

revoke all on table public.project_financial_operations
from
  public,
  anon,
  authenticated,
  service_role;

grant
select
  on table public.project_financial_operations to authenticated,
  service_role;

drop policy if exists project_financial_operations_select on public.project_financial_operations;

create policy project_financial_operations_select on public.project_financial_operations for
select
  to authenticated using (public.can_read_project (project_id));

drop trigger if exists project_financial_operations_immutable on public.project_financial_operations;

create trigger project_financial_operations_immutable
before update or delete on public.project_financial_operations for each row
execute function public.reject_financial_journal_mutation ();

create table if not exists public.project_financial_overrides (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  operation_key text not null,
  field text not null,
  old_value jsonb,
  new_value jsonb,
  reason text not null,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint project_financial_overrides_reason_required check (length(btrim(reason)) between 1 and 500),
  constraint project_financial_overrides_operation_field_unique unique (project_id, operation_key, field)
);

alter table public.project_financial_overrides
drop constraint if exists project_financial_overrides_project_id_fkey,
add constraint project_financial_overrides_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict;

alter table public.project_financial_overrides enable row level security;

revoke all on table public.project_financial_overrides
from
  public,
  anon,
  authenticated,
  service_role;

grant
select
  on table public.project_financial_overrides to authenticated,
  service_role;

drop policy if exists project_financial_overrides_select on public.project_financial_overrides;

create policy project_financial_overrides_select on public.project_financial_overrides for
select
  to authenticated using (public.can_read_project (project_id));

drop trigger if exists project_financial_overrides_immutable on public.project_financial_overrides;

create trigger project_financial_overrides_immutable
before update or delete on public.project_financial_overrides for each row
execute function public.reject_financial_journal_mutation ();

create table if not exists public.subcontract_payment_draft_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  payment_id uuid not null,
  operation_key text not null,
  operation_type text not null check (operation_type in ('draft_update', 'draft_delete')),
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint subcontract_payment_draft_operations_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint subcontract_payment_draft_operations_payment_key_unique unique (payment_id, operation_key)
);

alter table public.subcontract_payment_draft_operations
drop constraint if exists subcontract_payment_draft_operations_project_id_fkey,
add constraint subcontract_payment_draft_operations_project_id_fkey foreign key (project_id) references public.projects (id) on delete restrict;

create index if not exists subcontract_payment_draft_operations_project_created_idx
on public.subcontract_payment_draft_operations (project_id, created_at desc);

alter table public.subcontract_payment_draft_operations enable row level security;

revoke all on table public.subcontract_payment_draft_operations
from public, anon, authenticated, service_role;

grant select on table public.subcontract_payment_draft_operations to authenticated, service_role;

drop policy if exists subcontract_payment_draft_operations_select on public.subcontract_payment_draft_operations;

create policy subcontract_payment_draft_operations_select
on public.subcontract_payment_draft_operations for select
to authenticated using (public.can_read_project(project_id));

drop trigger if exists subcontract_payment_draft_operations_immutable on public.subcontract_payment_draft_operations;

create trigger subcontract_payment_draft_operations_immutable
before update or delete on public.subcontract_payment_draft_operations for each row
execute function public.reject_financial_journal_mutation ();

create table if not exists public.estimate_line_operations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null,
  line_item_id uuid,
  operation_key text not null,
  operation_type text not null check (
    operation_type in ('line_update', 'line_delete', 'line_reorder')
  ),
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint estimate_line_operations_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint estimate_line_operations_estimate_key_unique unique (estimate_id, operation_key)
);

alter table public.estimate_line_operations
drop constraint if exists estimate_line_operations_estimate_id_fkey,
add constraint estimate_line_operations_estimate_id_fkey foreign key (estimate_id) references public.estimates (id) on delete restrict;

alter table public.estimate_line_operations enable row level security;

revoke all on table public.estimate_line_operations
from
  public,
  anon,
  authenticated,
  service_role;

grant
select
  on table public.estimate_line_operations to authenticated,
  service_role;

drop policy if exists estimate_line_operations_select on public.estimate_line_operations;

create policy estimate_line_operations_select on public.estimate_line_operations for
select
  to authenticated using (public.can_manage_estimate (estimate_id));

drop trigger if exists estimate_line_operations_immutable on public.estimate_line_operations;

create trigger estimate_line_operations_immutable
before update or delete on public.estimate_line_operations for each row
execute function public.reject_financial_journal_mutation ();

-- Safe-range guards run at the storage boundary, so RPCs, legacy SECURITY
-- DEFINER paths, imports, and direct SQL all receive identical protection.
create or replace function public.tg_validate_project_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(
    new.original_contract * 100,
    'Project original contract'
  );
  perform public.assert_safe_accounting_cents(
    new.original_cost_budget * 100,
    'Project original cost budget'
  );
  return new;
end;
$$;

drop trigger if exists projects_validate_safe_money on public.projects;

create trigger projects_validate_safe_money
before insert or update of original_contract,
original_cost_budget on public.projects for each row
execute function public.tg_validate_project_safe_money ();

create or replace function public.tg_validate_cost_bucket_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(new.contract_value * 100, 'SOV contract value');
  perform public.assert_safe_accounting_cents(new.original_budget * 100, 'Budget baseline');
  perform public.assert_safe_accounting_cents(new.actual_to_date * 100, 'Budget actual to date');
  perform public.assert_safe_accounting_cents(new.ftc * 100, 'Budget forecast to complete');
  return new;
end;
$$;

drop trigger if exists cost_buckets_validate_safe_money on public.cost_buckets;

create trigger cost_buckets_validate_safe_money
before insert or update of contract_value,
original_budget,
actual_to_date,
ftc on public.cost_buckets for each row
execute function public.tg_validate_cost_bucket_safe_money ();

create or replace function public.tg_validate_cost_bucket_safe_aggregate () returns trigger language plpgsql security definer
set
  search_path = '' as $$
declare
  v_project_id uuid := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  v_contract numeric;
  v_budget numeric;
  v_actual numeric;
  v_ftc numeric;
  v_forecast numeric;
begin
  select
    coalesce(sum(bucket.contract_value * 100), 0),
    coalesce(sum(bucket.original_budget * 100), 0),
    coalesce(sum(bucket.actual_to_date * 100), 0),
    coalesce(sum(bucket.ftc * 100), 0),
    coalesce(sum((bucket.actual_to_date + bucket.ftc) * 100), 0)
  into v_contract, v_budget, v_actual, v_ftc, v_forecast
  from public.cost_buckets bucket
  where bucket.project_id = v_project_id;

  perform public.assert_safe_accounting_cents(v_contract, 'Project SOV aggregate');
  perform public.assert_safe_accounting_cents(v_budget, 'Project budget aggregate');
  perform public.assert_safe_accounting_cents(v_actual, 'Project actual aggregate');
  perform public.assert_safe_accounting_cents(v_ftc, 'Project FTC aggregate');
  perform public.assert_safe_accounting_cents(v_forecast, 'Project forecast aggregate');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists cost_buckets_validate_safe_aggregate on public.cost_buckets;

create constraint trigger cost_buckets_validate_safe_aggregate
after insert or update or delete on public.cost_buckets
deferrable initially immediate for each row
execute function public.tg_validate_cost_bucket_safe_aggregate ();

create or replace function public.tg_validate_subcontract_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(new.contract_value * 100, 'Subcontract value');
  return new;
end;
$$;

drop trigger if exists subcontracts_validate_safe_money on public.subcontracts;

create trigger subcontracts_validate_safe_money
before insert or update of contract_value on public.subcontracts for each row
execute function public.tg_validate_subcontract_safe_money ();

create or replace function public.tg_validate_subcontract_payment_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(new.amount * 100, 'Subcontract payment');
  perform public.assert_safe_accounting_cents(new.retainage_held * 100, 'Payment retainage');
  return new;
end;
$$;

drop trigger if exists subcontract_payments_validate_safe_money on public.subcontract_payments;

create trigger subcontract_payments_validate_safe_money
before insert or update of amount,
retainage_held on public.subcontract_payments for each row
execute function public.tg_validate_subcontract_payment_safe_money ();

create or replace function public.tg_validate_subcontract_payment_safe_aggregate () returns trigger language plpgsql security definer
set
  search_path = '' as $$
declare
  v_subcontract_id uuid := case when tg_op = 'DELETE' then old.subcontract_id else new.subcontract_id end;
  v_payment_cents numeric;
  v_retainage_cents numeric;
begin
  select
    coalesce(sum(payment.amount * 100), 0),
    coalesce(sum(payment.retainage_held * 100), 0)
  into v_payment_cents, v_retainage_cents
  from public.subcontract_payments payment
  where payment.subcontract_id = v_subcontract_id;

  perform public.assert_safe_accounting_cents(v_payment_cents, 'Subcontract payment aggregate');
  perform public.assert_safe_accounting_cents(v_retainage_cents, 'Subcontract retainage aggregate');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists subcontract_payments_validate_safe_aggregate on public.subcontract_payments;

create constraint trigger subcontract_payments_validate_safe_aggregate
after insert or update or delete on public.subcontract_payments
deferrable initially immediate for each row
execute function public.tg_validate_subcontract_payment_safe_aggregate ();

create or replace function public.tg_validate_subcontract_allocation_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(new.amount * 100, tg_table_name || ' amount');
  return new;
end;
$$;

drop trigger if exists subcontract_allocations_validate_safe_money on public.subcontract_allocations;

create trigger subcontract_allocations_validate_safe_money
before insert or update of amount on public.subcontract_allocations for each row
execute function public.tg_validate_subcontract_allocation_safe_money ();

drop trigger if exists subcontract_payment_allocations_validate_safe_money on public.subcontract_payment_allocations;

create trigger subcontract_payment_allocations_validate_safe_money
before insert or update of amount on public.subcontract_payment_allocations for each row
execute function public.tg_validate_subcontract_allocation_safe_money ();

drop trigger if exists subcontract_change_orders_validate_safe_money on public.subcontract_change_orders;

create trigger subcontract_change_orders_validate_safe_money
before insert or update of amount on public.subcontract_change_orders for each row
execute function public.tg_validate_subcontract_allocation_safe_money ();

-- A keyed payment row is the durable result behind its request fingerprint.
-- It cannot be edited or deleted after creation; lifecycle transitions still
-- use the audited atomic transition command and do not alter request inputs.
create or replace function public.tg_enforce_keyed_subcontract_payment_immutability () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_atomic_write boolean := coalesce(
    current_setting('overwatch.subcontract_payment_atomic_write', true),
    ''
  ) = 'on';
begin
  if tg_op = 'DELETE' and old.idempotency_key is not null and not v_atomic_write then
    raise exception using
      errcode = '55000',
      message = 'A keyed subcontract payment is immutable. Create a correction or replacement record instead.';
  end if;

  if tg_op = 'UPDATE'
     and old.idempotency_key is not null
     and not v_atomic_write
     and (
       old.project_id is distinct from new.project_id
       or old.subcontract_id is distinct from new.subcontract_id
       or old.amount is distinct from new.amount
       or old.retainage_held is distinct from new.retainage_held
       or old.payment_date is distinct from new.payment_date
       or old.reference is distinct from new.reference
       or old.notes is distinct from new.notes
       or old.exposure_id is distinct from new.exposure_id
       or old.status is distinct from new.status
     )
  then
    raise exception using
      errcode = '55000',
      message = 'A keyed subcontract payment is immutable. Create a correction or replacement record instead.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists subcontract_payments_keyed_immutable on public.subcontract_payments;

create trigger subcontract_payments_keyed_immutable
before update or delete on public.subcontract_payments for each row
execute function public.tg_enforce_keyed_subcontract_payment_immutability ();

create or replace function public.update_subcontract_payment_draft_atomic (
  p_payment_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.subcontract_payments%rowtype;
  v_after public.subcontract_payments%rowtype;
  v_existing public.subcontract_payment_draft_operations%rowtype;
  v_fingerprint text;
  v_amount numeric;
  v_retainage numeric;
  v_exposure_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to edit a payment draft.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid payment-draft operation key is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'The expected payment-draft version is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) key
       where key not in (
         'amount', 'retainage_held', 'payment_date', 'reference', 'notes', 'exposure_id'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The payment-draft patch is empty or contains unsupported fields.';
  end if;

  v_fingerprint := md5(
    jsonb_build_array(p_payment_id, p_expected_updated_at, p_patch)::text
  );
  select operation.* into v_existing
  from public.subcontract_payment_draft_operations operation
  where operation.payment_id = p_payment_id
    and operation.operation_key = p_operation_key;
  if found then
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to edit this payment draft.';
    end if;
    if v_existing.operation_type <> 'draft_update'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This payment-draft operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select payment.* into v_before
  from public.subcontract_payments payment
  where payment.id = p_payment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payment draft not found.';
  end if;
  if not public.can_manage_project(v_before.project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this payment draft.';
  end if;
  if v_before.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Approved or paid subcontract payments are permanent financial records and cannot be edited.';
  end if;
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'The payment draft changed before your edit committed. Refresh and try again.';
  end if;

  begin
    v_amount := case when p_patch ? 'amount' then (p_patch ->> 'amount')::numeric else v_before.amount end;
    v_retainage := case when p_patch ? 'retainage_held' then (p_patch ->> 'retainage_held')::numeric else v_before.retainage_held end;
  exception when others then
    raise exception using errcode = '22023', message = 'Payment draft money must be numeric.';
  end;
  perform public.assert_safe_accounting_cents(v_amount * 100, 'Payment amount');
  perform public.assert_safe_accounting_cents(v_retainage * 100, 'Payment retainage');
  if v_amount <= 0 or v_retainage > v_amount then
    raise exception using errcode = '23514', message = 'Payment must be positive and retainage cannot exceed the gross amount.';
  end if;
  if p_patch ? 'payment_date' and nullif(p_patch ->> 'payment_date', '') is null then
    raise exception using errcode = '22023', message = 'A payment date is required.';
  end if;
  if length(coalesce(p_patch ->> 'reference', '')) > 200
     or length(coalesce(p_patch ->> 'notes', '')) > 4000
  then
    raise exception using errcode = '22023', message = 'Payment draft details exceed their allowed length.';
  end if;

  v_exposure_id := case
    when p_patch -> 'exposure_id' = 'null'::jsonb then null
    when p_patch ? 'exposure_id' then (p_patch ->> 'exposure_id')::uuid
    else v_before.exposure_id
  end;
  if v_exposure_id is not null and not exists (
    select 1 from public.exposures exposure
    where exposure.id = v_exposure_id
      and exposure.project_id = v_before.project_id
  ) then
    raise exception using errcode = '23503', message = 'That risk belongs to a different project or is no longer available.';
  end if;

  perform set_config('overwatch.subcontract_payment_atomic_write', 'on', true);
  update public.subcontract_payments payment set
    amount = v_amount,
    retainage_held = v_retainage,
    payment_date = case when p_patch ? 'payment_date' then (p_patch ->> 'payment_date')::date else payment.payment_date end,
    reference = case when p_patch ? 'reference' then p_patch ->> 'reference' else payment.reference end,
    notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else payment.notes end,
    exposure_id = v_exposure_id
  where payment.id = p_payment_id
  returning payment.* into v_after;

  v_result := to_jsonb(v_after) || jsonb_build_object('deduplicated', false);
  insert into public.subcontract_payment_draft_operations (
    project_id, payment_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_before.project_id, p_payment_id, p_operation_key, 'draft_update',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.delete_subcontract_payment_draft_atomic (
  p_payment_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_payment public.subcontract_payments%rowtype;
  v_existing public.subcontract_payment_draft_operations%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to remove a payment draft.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid payment-draft operation key is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'The expected payment-draft version is required.';
  end if;

  v_fingerprint := md5(
    jsonb_build_array(p_payment_id, p_expected_updated_at, 'delete')::text
  );
  select operation.* into v_existing
  from public.subcontract_payment_draft_operations operation
  where operation.payment_id = p_payment_id
    and operation.operation_key = p_operation_key;
  if found then
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to remove this payment draft.';
    end if;
    if v_existing.operation_type <> 'draft_delete'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This payment-draft operation key was already used for a different change.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select payment.* into v_payment
  from public.subcontract_payments payment
  where payment.id = p_payment_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payment draft not found.';
  end if;
  if not public.can_manage_project(v_payment.project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to remove this payment draft.';
  end if;
  if v_payment.status <> 'draft' then
    raise exception using errcode = '55000', message = 'Approved or paid subcontract payments are permanent financial records and cannot be deleted.';
  end if;
  if v_payment.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'The payment draft changed before removal committed. Refresh and try again.';
  end if;

  perform set_config('overwatch.subcontract_payment_atomic_write', 'on', true);
  perform set_config('overwatch.lien_waiver_atomic_write', 'on', true);
  delete from public.subcontract_payments payment where payment.id = p_payment_id;

  v_result := jsonb_build_object(
    'ok', true,
    'id', p_payment_id,
    'deleted_payment', to_jsonb(v_payment),
    'deduplicated', false
  );
  insert into public.subcontract_payment_draft_operations (
    project_id, payment_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_payment.project_id, p_payment_id, p_operation_key, 'draft_delete',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.update_subcontract_payment_draft_atomic (uuid, timestamptz, jsonb, text)
from public, anon, authenticated, service_role;

revoke all on function public.delete_subcontract_payment_draft_atomic (uuid, timestamptz, text)
from public, anon, authenticated, service_role;

grant execute on function public.update_subcontract_payment_draft_atomic (uuid, timestamptz, jsonb, text) to authenticated;

grant execute on function public.delete_subcontract_payment_draft_atomic (uuid, timestamptz, text) to authenticated;

-- Raw cost-bucket baseline/forecast writes are no longer user or service-role
-- capabilities. Atomic SECURITY DEFINER commands retain authority; billing-only
-- presentation columns remain directly editable by their existing workflow.
revoke insert,
update,
delete on table public.cost_buckets
from
  authenticated,
  service_role;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'cost_buckets'
    and column_name not in (
      'id', 'project_id', 'contract_value', 'original_budget',
      'actual_to_date', 'ftc', 'created_at'
    );
  if v_columns is not null then
    execute 'grant update (' || v_columns || ') on public.cost_buckets to authenticated, service_role';
  end if;
end;
$$;

create or replace function public.tg_protect_project_financial_authority () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_command_write boolean := coalesce(
    current_setting('overwatch.project_financial_command_write', true),
    ''
  ) = 'on';
begin
  if tg_op = 'UPDATE' then
    if old.owner_id is distinct from new.owner_id
       or old.organization_id is distinct from new.organization_id
    then
      raise exception using
        errcode = '55000',
        message = 'Project ownership and organization authority are immutable.';
    end if;

    if not v_command_write and (
      old.name is distinct from new.name
      or old.job_number is distinct from new.job_number
      or old.client is distinct from new.client
      or old.project_manager is distinct from new.project_manager
      or old.original_contract is distinct from new.original_contract
      or old.original_cost_budget is distinct from new.original_cost_budget
      or old.budget_locked_at is distinct from new.budget_locked_at
    ) then
      raise exception using
        errcode = '55000',
        message = 'Project financial headers and budget locks must be changed through the audited project command.';
    end if;

    if old.budget_locked_at is not null and new.budget_locked_at is null then
      raise exception using
        errcode = '55000',
        message = 'A project budget lock is permanent.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists projects_protect_financial_authority on public.projects;

create trigger projects_protect_financial_authority
before update on public.projects for each row
execute function public.tg_protect_project_financial_authority ();

-- Remove the broad table grants that defeated column-level authority. Legacy
-- feature paths keep access to non-authority project fields; protected headers,
-- baseline money, and lock state are command-only.
revoke insert,
update on table public.projects
from
  authenticated,
  service_role;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'projects'
    and column_name not in (
      'id', 'owner_id', 'organization_id', 'name', 'job_number', 'client',
      'project_manager', 'original_contract', 'original_cost_budget',
      'budget_locked_at', 'created_at'
    );
  if v_columns is not null then
    execute 'grant update (' || v_columns || ') on public.projects to authenticated, service_role';
  end if;
end;
$$;

create or replace function public.create_project_financial_atomic (
  p_organization_id uuid,
  p_header jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.project_financial_operations%rowtype;
  v_project public.projects%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_contract numeric;
  v_budget numeric;
  v_contract_cents numeric;
  v_budget_cents numeric;
  v_base_cents bigint;
  v_remainder_cents bigint;
  v_index integer;
  v_names text[] := array['Sitework', 'Structure', 'Envelope', 'MEP', 'Finishes', 'GC/OH'];
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create a project.';
  end if;
  if not public.is_org_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create a project in this organization.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid project operation key is required.';
  end if;
  if jsonb_typeof(p_header) is distinct from 'object'
     or exists (
       select 1 from jsonb_object_keys(p_header) key
       where key not in (
         'name', 'job_number', 'client', 'project_manager', 'phase',
         'original_contract', 'original_cost_budget',
         'baseline_completion_date', 'forecast_completion_date',
         'schedule_variance_weeks'
       )
     )
  then
    raise exception using errcode = '22023', message = 'Project header details are invalid.';
  end if;
  if nullif(btrim(p_header ->> 'name'), '') is null
     or length(p_header ->> 'name') > 200
     or length(coalesce(p_header ->> 'job_number', '')) > 100
     or length(coalesce(p_header ->> 'client', '')) > 200
     or length(coalesce(p_header ->> 'project_manager', '')) > 200
  then
    raise exception using errcode = '22023', message = 'Project header details are missing or too long.';
  end if;
  if coalesce(p_header ->> 'phase', 'Early') not in ('Early', 'Middle', 'Late') then
    raise exception using errcode = '22023', message = 'Project phase is invalid.';
  end if;

  begin
    v_contract := coalesce((p_header ->> 'original_contract')::numeric, 0);
    v_budget := coalesce((p_header ->> 'original_cost_budget')::numeric, 0);
  exception when others then
    raise exception using errcode = '22023', message = 'Project contract and budget must be numeric.';
  end;
  v_contract_cents := public.assert_safe_accounting_cents(v_contract * 100, 'Project original contract');
  v_budget_cents := public.assert_safe_accounting_cents(v_budget * 100, 'Project original cost budget');

  v_fingerprint := md5(jsonb_build_array(p_organization_id, p_header)::text);
  select operation.* into v_existing
  from public.project_financial_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'project_create'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This project operation key was already used for different details.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  perform set_config('overwatch.project_financial_command_write', 'on', true);
  insert into public.projects (
    owner_id,
    organization_id,
    name,
    job_number,
    client,
    project_manager,
    phase,
    original_contract,
    original_cost_budget,
    baseline_completion_date,
    forecast_completion_date,
    schedule_variance_weeks
  ) values (
    v_user_id,
    p_organization_id,
    btrim(p_header ->> 'name'),
    btrim(coalesce(p_header ->> 'job_number', '')),
    btrim(coalesce(p_header ->> 'client', '')),
    btrim(coalesce(p_header ->> 'project_manager', '')),
    coalesce(p_header ->> 'phase', 'Early')::public.project_phase,
    v_contract,
    v_budget,
    nullif(p_header ->> 'baseline_completion_date', '')::date,
    nullif(p_header ->> 'forecast_completion_date', '')::date,
    coalesce((p_header ->> 'schedule_variance_weeks')::integer, 0)
  ) returning * into v_project;

  v_base_cents := floor(v_budget_cents / array_length(v_names, 1))::bigint;
  v_remainder_cents := (v_budget_cents - v_base_cents * array_length(v_names, 1))::bigint;
  for v_index in 1..array_length(v_names, 1)
  loop
    insert into public.cost_buckets (
      project_id, cost_code, bucket, original_budget,
      actual_to_date, ftc, source_type, source_date, source_note, sort_order
    ) values (
      v_project.id,
      '',
      v_names[v_index],
      (v_base_cents + case when v_index <= v_remainder_cents then 1 else 0 end) / 100.0,
      0,
      (v_base_cents + case when v_index <= v_remainder_cents then 1 else 0 end) / 100.0,
      'original_sov',
      current_date,
      'Created with the project financial baseline.',
      v_index
    );
  end loop;

  v_result := jsonb_build_object(
    'ok', true,
    'projectId', v_project.id,
    'deduplicated', false
  );
  insert into public.project_financial_operations (
    project_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_project.id, p_operation_key, 'project_create',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.update_project_financial_header_atomic (
  p_project_id uuid,
  p_patch jsonb,
  p_override_reason text,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
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

  v_fingerprint := md5(jsonb_build_array(p_project_id, p_patch, v_reason)::text);
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
  returning project.* into v_after;

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

create or replace function public.lock_project_budget_atomic (p_project_id uuid, p_operation_key text) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_project public.projects%rowtype;
  v_existing public.project_financial_operations%rowtype;
  v_fingerprint text := md5(jsonb_build_array(p_project_id, 'budget_lock')::text);
  v_result jsonb;
  v_was_locked boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to lock a budget.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid budget-lock operation key is required.';
  end if;

  select project.* into v_project
  from public.projects project
  where project.id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to lock this project budget.';
  end if;

  select operation.* into v_existing
  from public.project_financial_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'project_budget_lock'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This project operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  v_was_locked := v_project.budget_locked_at is not null;
  if not v_was_locked then
    perform set_config('overwatch.project_financial_command_write', 'on', true);
    update public.projects project
    set budget_locked_at = now()
    where project.id = p_project_id
    returning project.* into v_project;
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'locked', true,
    'lockedAt', v_project.budget_locked_at,
    'alreadyLocked', v_was_locked,
    'deduplicated', false
  );
  insert into public.project_financial_operations (
    project_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_project_id, p_operation_key, 'project_budget_lock',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.create_project_financial_atomic (uuid, jsonb, text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.update_project_financial_header_atomic (uuid, jsonb, text, text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.lock_project_budget_atomic (uuid, text)
from
  public,
  anon,
  authenticated,
  service_role;

grant
execute on function public.create_project_financial_atomic (uuid, jsonb, text) to authenticated;

grant
execute on function public.update_project_financial_header_atomic (uuid, jsonb, text, text) to authenticated;

grant
execute on function public.lock_project_budget_atomic (uuid, text) to authenticated;

-- Estimate safe range and lifecycle freeze. Existing final rows need no data
-- rewrite: the rule is forward-only and blocks subsequent financial edits.
create or replace function public.tg_validate_estimate_line_safe_money () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_material numeric;
  v_labor numeric;
  v_total numeric;
begin
  perform public.assert_safe_accounting_cents(
    new.material_unit_cost_cents,
    'Estimate material unit cost'
  );
  perform public.assert_safe_accounting_cents(
    new.labor_unit_cost_cents,
    'Estimate labor unit cost'
  );
  v_material := round(new.quantity * new.material_unit_cost_cents);
  v_labor := round(new.quantity * new.labor_unit_cost_cents);
  v_total := round(new.quantity * (
    new.material_unit_cost_cents::numeric + new.labor_unit_cost_cents::numeric
  ));
  perform public.assert_safe_accounting_cents(v_material, 'Estimate material extension');
  perform public.assert_safe_accounting_cents(v_labor, 'Estimate labor extension');
  perform public.assert_safe_accounting_cents(v_total, 'Estimate line extension');
  return new;
end;
$$;

drop trigger if exists estimate_line_items_validate_safe_money on public.estimate_line_items;

create trigger estimate_line_items_validate_safe_money
before insert or update of quantity,
material_unit_cost_cents,
labor_unit_cost_cents on public.estimate_line_items for each row
execute function public.tg_validate_estimate_line_safe_money ();

create or replace function public.recalculate_estimate_totals_from_lines (p_estimate_id uuid) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_estimate public.estimates%rowtype;
  v_material numeric;
  v_labor numeric;
  v_direct numeric;
  v_adjusted_material numeric;
  v_adjusted_labor numeric;
  v_adjusted_direct numeric;
  v_tax numeric;
  v_overhead numeric;
  v_profit numeric;
  v_contingency numeric;
  v_bond numeric;
  v_general_conditions numeric;
  v_custom numeric := 0;
  v_total numeric;
  v_markup jsonb;
  v_markup_pct numeric;
  v_markup_base numeric;
  v_markup_amount numeric;
begin
  select estimate.* into v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    return null;
  end if;

  select
    round(coalesce(sum(line.quantity * line.material_unit_cost_cents), 0)),
    round(coalesce(sum(line.quantity * line.labor_unit_cost_cents), 0))
  into v_material, v_labor
  from public.estimate_line_items line
  where line.estimate_id = p_estimate_id;

  perform public.assert_safe_accounting_cents(v_material, 'Estimate material aggregate');
  perform public.assert_safe_accounting_cents(v_labor, 'Estimate labor aggregate');
  v_direct := v_material + v_labor;
  perform public.assert_safe_accounting_cents(v_direct, 'Estimate direct aggregate');

  v_adjusted_material := round(
    v_material * greatest(0, coalesce(v_estimate.region_multiplier, 1))
  );
  v_adjusted_labor := round(
    v_labor * greatest(0, coalesce(v_estimate.region_multiplier, 1))
  );
  perform public.assert_safe_accounting_cents(v_adjusted_material, 'Regional material aggregate');
  perform public.assert_safe_accounting_cents(v_adjusted_labor, 'Regional labor aggregate');
  v_adjusted_direct := v_adjusted_material + v_adjusted_labor;
  perform public.assert_safe_accounting_cents(v_adjusted_direct, 'Regional direct aggregate');

  v_tax := round(v_adjusted_material * greatest(0, v_estimate.tax_pct) / 10000.0);
  v_overhead := round(v_adjusted_direct * greatest(0, v_estimate.overhead_pct) / 10000.0);
  v_profit := round(v_adjusted_direct * greatest(0, v_estimate.profit_pct) / 10000.0);
  v_contingency := round(v_adjusted_direct * greatest(0, v_estimate.contingency_pct) / 10000.0);
  v_bond := round(v_adjusted_direct * greatest(0, v_estimate.bond_pct) / 10000.0);
  v_general_conditions := round(
    v_adjusted_direct * greatest(0, v_estimate.general_conditions_pct) / 10000.0
  );
  perform public.assert_safe_accounting_cents(v_tax, 'Estimate tax');
  perform public.assert_safe_accounting_cents(v_overhead, 'Estimate overhead');
  perform public.assert_safe_accounting_cents(v_profit, 'Estimate profit');
  perform public.assert_safe_accounting_cents(v_contingency, 'Estimate contingency');
  perform public.assert_safe_accounting_cents(v_bond, 'Estimate bond');
  perform public.assert_safe_accounting_cents(v_general_conditions, 'Estimate general conditions');

  for v_markup in
    select value
    from jsonb_array_elements(coalesce(v_estimate.custom_markups, '[]'::jsonb))
  loop
    v_markup_pct := case
      when coalesce(v_markup ->> 'pct', '') ~ '^\d+(\.\d+)?$'
        then greatest(0, (v_markup ->> 'pct')::numeric)
      else 0
    end;
    v_markup_base := case v_markup ->> 'applies_to'
      when 'material' then v_adjusted_material
      when 'labor' then v_adjusted_labor
      else v_adjusted_direct
    end;
    v_markup_amount := round(v_markup_base * v_markup_pct / 10000.0);
    perform public.assert_safe_accounting_cents(v_markup_amount, 'Estimate custom markup');
    if v_custom > 9007199254740991 - v_markup_amount then
      raise exception using errcode = '22003', message = 'Estimate custom markup aggregate exceeds the supported accounting range.';
    end if;
    v_custom := v_custom + v_markup_amount;
  end loop;

  v_total := v_adjusted_direct;
  foreach v_markup_amount in array array[
    v_tax, v_overhead, v_profit, v_contingency,
    v_bond, v_general_conditions, v_custom
  ]::numeric[]
  loop
    if v_total > 9007199254740991 - v_markup_amount then
      raise exception using errcode = '22003', message = 'Estimate total exceeds the supported accounting range.';
    end if;
    v_total := v_total + v_markup_amount;
  end loop;
  perform public.assert_safe_accounting_cents(v_total, 'Estimate total');

  perform set_config('overwatch.estimate_derived_totals_write', 'on', true);
  update public.estimates estimate set
    subtotal_material_cents = v_material::bigint,
    subtotal_labor_cents = v_labor::bigint,
    subtotal_cents = v_direct::bigint,
    total_with_markups_cents = v_total::bigint
  where estimate.id = p_estimate_id;

  return jsonb_build_object(
    'subtotal_material_cents', v_material::bigint,
    'subtotal_labor_cents', v_labor::bigint,
    'subtotal_cents', v_direct::bigint,
    'total_with_markups_cents', v_total::bigint
  );
end;
$$;

create or replace function public.tg_lock_estimate_line_parent () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_estimate_ids uuid[];
  v_frozen record;
  v_revision_write boolean := coalesce(
    current_setting('overwatch.estimate_revision_write', true),
    ''
  ) = 'on';
begin
  v_estimate_ids := case
    when tg_op = 'DELETE' then array[old.estimate_id]
    when tg_op = 'UPDATE' and old.estimate_id is distinct from new.estimate_id
      then array[old.estimate_id, new.estimate_id]
    else array[new.estimate_id]
  end;

  for v_frozen in
    select estimate.id, estimate.status, estimate.project_id
    from public.estimates estimate
    where estimate.id = any(v_estimate_ids)
    order by estimate.id
    for update
  loop
    if not v_revision_write
       and (v_frozen.status = 'final' or v_frozen.project_id is not null)
    then
      raise exception using
        errcode = '55000',
        message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
    end if;
  end loop;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.tg_freeze_estimate_financial_content () returns trigger language plpgsql security invoker
set
  search_path = '' as $$
declare
  v_frozen boolean := old.status = 'final' or old.project_id is not null;
  -- The SOV conversion command is the ONE audited path allowed to stamp a
  -- frozen estimate with its project link (and draft->final status). It
  -- announces itself via a transaction-local flag; even then, only the link
  -- and status may move — financial content stays immutable.
  v_conversion_write boolean := coalesce(
    current_setting('overwatch.estimate_conversion_write', true),
    ''
  ) = 'on';
begin
  if tg_op = 'DELETE' then
    if v_frozen then
      raise exception using
        errcode = '55000',
        message = 'Final or converted estimates are permanent financial records. Clone the estimate to create a revision.';
    end if;
    return old;
  end if;

  if v_frozen and (
    (
      not v_conversion_write
      and (
        old.project_id is distinct from new.project_id
        -- Status is bid lifecycle, not financial content: an unconverted
        -- final estimate may still record its outcome (Awarded/Lost). A
        -- CONVERTED estimate is evidence and its status locks with it.
        or (old.status is distinct from new.status and old.project_id is not null)
      )
    )
    or old.region_multiplier is distinct from new.region_multiplier
    or old.overhead_pct is distinct from new.overhead_pct
    or old.profit_pct is distinct from new.profit_pct
    or old.contingency_pct is distinct from new.contingency_pct
    or old.bond_pct is distinct from new.bond_pct
    or old.tax_pct is distinct from new.tax_pct
    or old.general_conditions_pct is distinct from new.general_conditions_pct
    or old.custom_markups is distinct from new.custom_markups
    or old.subtotal_material_cents is distinct from new.subtotal_material_cents
    or old.subtotal_labor_cents is distinct from new.subtotal_labor_cents
    or old.subtotal_cents is distinct from new.subtotal_cents
    or old.total_with_markups_cents is distinct from new.total_with_markups_cents
  ) then
    raise exception using
      errcode = '55000',
      message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;
  return new;
end;
$$;

-- Legacy repair before the freeze installs: master sheets are org-level
-- pricing libraries and must stay editable, but old seeding left a few with a
-- meaningless project link. Under the freeze model (project link = converted)
-- they would be frozen from birth. Detach the link so live master sheets keep
-- working; estimate-kind rows with a project link were genuinely converted
-- and correctly freeze.
update public.estimates
set project_id = null
where kind = 'master_sheet'
  and project_id is not null;

drop trigger if exists estimates_freeze_financial_content on public.estimates;

create trigger estimates_freeze_financial_content
before update or delete on public.estimates for each row
execute function public.tg_freeze_estimate_financial_content ();

create or replace function public.update_estimate_line_item_atomic (
  p_line_item_id uuid,
  p_patch jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.estimate_line_items%rowtype;
  v_after public.estimate_line_items%rowtype;
  v_estimate public.estimates%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to edit an estimate line.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-line operation key is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) key
       where key not in (
         'csi_division', 'cost_code', 'description', 'unit', 'quantity',
         'material_unit_cost_cents', 'labor_unit_cost_cents', 'library_item_id',
         'scope_group', 'notes', 'sort_order', 'quantity_source'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The estimate-line patch is empty or contains unsupported fields.';
  end if;

  select line.* into v_before
  from public.estimate_line_items line
  where line.id = p_line_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate line not found.';
  end if;
  select estimate.* into strict v_estimate
  from public.estimates estimate
  where estimate.id = v_before.estimate_id
  for update;
  if not public.can_manage_estimate(v_estimate.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  v_fingerprint := md5(jsonb_build_array(p_line_item_id, p_patch)::text);
  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = v_estimate.id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type not in ('line_update', 'line_reorder')
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This estimate-line operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  if p_patch ? 'description' and nullif(btrim(p_patch ->> 'description'), '') is null
     or p_patch ? 'unit' and nullif(btrim(p_patch ->> 'unit'), '') is null
  then
    raise exception using errcode = '22023', message = 'Estimate-line description and unit are required.';
  end if;
  if p_patch ? 'quantity' and (
    (p_patch ->> 'quantity')::numeric < 0
    or (p_patch ->> 'quantity')::numeric > 999999999
  ) then
    raise exception using errcode = '22003', message = 'Estimate-line quantity is outside the supported range.';
  end if;
  if p_patch ? 'material_unit_cost_cents' then
    perform public.assert_safe_accounting_cents(
      (p_patch ->> 'material_unit_cost_cents')::numeric,
      'Estimate material unit cost'
    );
  end if;
  if p_patch ? 'labor_unit_cost_cents' then
    perform public.assert_safe_accounting_cents(
      (p_patch ->> 'labor_unit_cost_cents')::numeric,
      'Estimate labor unit cost'
    );
  end if;

  perform set_config('overwatch.estimate_revision_write', 'on', true);
  update public.estimate_line_items line set
    csi_division = case when p_patch ? 'csi_division' then left(btrim(p_patch ->> 'csi_division'), 8) else line.csi_division end,
    cost_code = case when p_patch ? 'cost_code' then left(btrim(p_patch ->> 'cost_code'), 32) else line.cost_code end,
    description = case when p_patch ? 'description' then left(btrim(p_patch ->> 'description'), 500) else line.description end,
    unit = case when p_patch ? 'unit' then upper(left(btrim(p_patch ->> 'unit'), 16)) else line.unit end,
    quantity = case when p_patch ? 'quantity' then (p_patch ->> 'quantity')::numeric else line.quantity end,
    material_unit_cost_cents = case when p_patch ? 'material_unit_cost_cents' then (p_patch ->> 'material_unit_cost_cents')::bigint else line.material_unit_cost_cents end,
    labor_unit_cost_cents = case when p_patch ? 'labor_unit_cost_cents' then (p_patch ->> 'labor_unit_cost_cents')::bigint else line.labor_unit_cost_cents end,
    library_item_id = case
      when p_patch -> 'library_item_id' = 'null'::jsonb then null
      when p_patch ? 'library_item_id' then (p_patch ->> 'library_item_id')::uuid
      else line.library_item_id
    end,
    scope_group = case when p_patch ? 'scope_group' then left(p_patch ->> 'scope_group', 200) else line.scope_group end,
    notes = case when p_patch ? 'notes' then left(p_patch ->> 'notes', 2000) else line.notes end,
    sort_order = case when p_patch ? 'sort_order' then (p_patch ->> 'sort_order')::integer else line.sort_order end,
    quantity_source = case when p_patch ? 'quantity_source' then p_patch ->> 'quantity_source' else line.quantity_source end
  where line.id = p_line_item_id
  returning line.* into v_after;

  v_result := jsonb_build_object(
    'ok', true,
    'line_item', to_jsonb(v_after),
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_estimate.id,
    v_after.id,
    p_operation_key,
    case when p_patch ? 'sort_order' and jsonb_object_length(p_patch) = 1
      then 'line_reorder' else 'line_update' end,
    v_fingerprint,
    v_result,
    v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.delete_estimate_line_item_atomic (
  p_estimate_id uuid,
  p_line_item_id uuid,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_line public.estimate_line_items%rowtype;
  v_estimate public.estimates%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_fingerprint text := md5(jsonb_build_array(p_line_item_id, 'delete')::text);
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to delete an estimate line.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-line operation key is required.';
  end if;
  select estimate.* into strict v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not public.can_manage_estimate(v_estimate.id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = p_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'line_delete'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This estimate-line operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select line.* into v_line
  from public.estimate_line_items line
  where line.id = p_line_item_id
    and line.estimate_id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate line not found in the expected estimate.';
  end if;

  perform set_config('overwatch.estimate_revision_write', 'on', true);
  delete from public.estimate_line_items line where line.id = p_line_item_id;
  v_result := jsonb_build_object(
    'ok', true,
    'lineItemId', p_line_item_id,
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    v_estimate.id, p_line_item_id, p_operation_key, 'line_delete',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.reorder_estimate_line_items_atomic (
  p_estimate_id uuid,
  p_expected_item_ids uuid[],
  p_item_ids uuid[],
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_current_item_ids uuid[];
  v_fingerprint text;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to reorder estimate lines.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-line operation key is required.';
  end if;
  if p_expected_item_ids is null
     or p_item_ids is null
     or cardinality(p_expected_item_ids) > 500
     or cardinality(p_item_ids) > 500
     or cardinality(p_expected_item_ids) <> cardinality(p_item_ids)
     or exists (select 1 from unnest(p_expected_item_ids) expected(id) where expected.id is null)
     or exists (select 1 from unnest(p_item_ids) requested(id) where requested.id is null)
     or (select count(*) <> count(distinct expected.id) from unnest(p_expected_item_ids) expected(id))
     or (select count(*) <> count(distinct requested.id) from unnest(p_item_ids) requested(id))
  then
    raise exception using errcode = '22023', message = 'Estimate reorder input must contain one unique identifier for every line.';
  end if;

  select estimate.* into strict v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to reorder this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  v_fingerprint := md5(
    jsonb_build_array(
      p_estimate_id,
      to_jsonb(p_expected_item_ids),
      to_jsonb(p_item_ids)
    )::text
  );
  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = p_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'line_reorder'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This estimate-line operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  -- Lock every line before comparing the client's expected sequence. The
  -- sequence is the optimistic-concurrency version: any intervening insert,
  -- delete, or reorder forces the caller to refresh instead of overwriting it.
  perform line.id
  from public.estimate_line_items line
  where line.estimate_id = p_estimate_id
  order by line.id
  for update;

  select coalesce(
    array_agg(line.id order by line.sort_order, line.id),
    '{}'::uuid[]
  ) into v_current_item_ids
  from public.estimate_line_items line
  where line.estimate_id = p_estimate_id;

  if v_current_item_ids is distinct from p_expected_item_ids then
    raise exception using
      errcode = '40001',
      message = 'Estimate rows changed before the reorder committed. Refresh the estimate and try again.';
  end if;
  if not (p_item_ids @> v_current_item_ids and p_item_ids <@ v_current_item_ids) then
    raise exception using errcode = '22023', message = 'A reorder must include every current estimate line exactly once.';
  end if;

  perform set_config('overwatch.estimate_revision_write', 'on', true);
  update public.estimate_line_items line
  set sort_order = requested.ordinality::integer
  from unnest(p_item_ids) with ordinality requested(id, ordinality)
  where line.id = requested.id
    and line.estimate_id = p_estimate_id;

  v_result := jsonb_build_object(
    'ok', true,
    'estimateId', p_estimate_id,
    'itemIds', to_jsonb(p_item_ids),
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, null, p_operation_key, 'line_reorder',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.sync_estimate_takeoff_quantity_atomic (
  p_estimate_id uuid,
  p_line_item_id uuid,
  p_expected_updated_at timestamptz,
  p_quantity numeric,
  p_takeoff_unit text,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_before public.estimate_line_items%rowtype;
  v_after public.estimate_line_items%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_fingerprint text;
  v_totals jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to sync a takeoff quantity.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid takeoff-sync operation key is required.';
  end if;
  if p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'The expected estimate-line version is required.';
  end if;
  if p_quantity is null
     or p_quantity < 0
     or p_quantity > 999999999
     or p_quantity * 10000 <> trunc(p_quantity * 10000)
  then
    raise exception using errcode = '22003', message = 'Takeoff quantity is outside the supported four-decimal range.';
  end if;
  if length(coalesce(p_takeoff_unit, '')) > 16 then
    raise exception using errcode = '22023', message = 'Takeoff unit cannot exceed 16 characters.';
  end if;

  select estimate.* into v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to sync this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  v_fingerprint := md5(
    jsonb_build_array(
      p_estimate_id,
      p_line_item_id,
      p_expected_updated_at,
      p_quantity,
      nullif(upper(btrim(coalesce(p_takeoff_unit, ''))), '')
    )::text
  );
  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = p_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'takeoff_sync'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This takeoff-sync operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select line.* into v_before
  from public.estimate_line_items line
  where line.id = p_line_item_id
    and line.estimate_id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate line not found.';
  end if;
  if v_before.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'The estimate line changed before the takeoff sync committed. Refresh and try again.';
  end if;

  perform set_config('overwatch.estimate_revision_write', 'on', true);
  update public.estimate_line_items line set
    quantity = p_quantity,
    quantity_source = 'takeoff',
    takeoff_quantity = p_quantity,
    takeoff_synced_at = now(),
    takeoff_unit = nullif(upper(btrim(coalesce(p_takeoff_unit, ''))), '')
  where line.id = p_line_item_id
    and line.estimate_id = p_estimate_id
  returning line.* into v_after;

  v_totals := public.recalculate_estimate_totals_from_lines(p_estimate_id);
  v_result := jsonb_build_object(
    'ok', true,
    'line_item', to_jsonb(v_after),
    'totals', v_totals,
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, p_line_item_id, p_operation_key, 'takeoff_sync',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

alter table public.estimate_line_operations
drop constraint if exists estimate_line_operations_operation_type_check;

alter table public.estimate_line_operations
add constraint estimate_line_operations_operation_type_check check (
  operation_type in ('header_update', 'line_update', 'line_delete', 'line_reorder', 'takeoff_sync')
);

create or replace function public.update_estimate_header_atomic (
  p_estimate_id uuid,
  p_patch jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set
  search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_before public.estimates%rowtype;
  v_after public.estimates%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_fingerprint text;
  v_result jsonb;
  v_frozen boolean;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to update an estimate.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate operation key is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object'
     or p_patch = '{}'::jsonb
     or exists (
       select 1 from jsonb_object_keys(p_patch) key
       where key not in (
         'name', 'description', 'opportunity_id', 'project_id', 'project_type',
         'region', 'region_multiplier', 'status', 'folder',
         'overhead_pct', 'profit_pct', 'contingency_pct', 'bond_pct',
         'tax_pct', 'general_conditions_pct', 'custom_markups'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The estimate patch is empty or contains unsupported fields.';
  end if;

  select estimate.* into v_before
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update this estimate.';
  end if;

  v_fingerprint := md5(jsonb_build_array(p_estimate_id, p_patch)::text);
  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = p_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'header_update'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This estimate operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  v_frozen := v_before.status = 'final' or v_before.project_id is not null;
  -- Status is a bid-lifecycle field, not financial content: an unconverted
  -- final estimate may still be marked Awarded/Lost (the outcome of the bid).
  -- Once CONVERTED (project-linked), the whole record is evidence and the
  -- status locks with it.
  if v_frozen and (
    p_patch ? 'project_id'
    or p_patch ? 'region_multiplier'
    or (p_patch ? 'status' and v_before.project_id is not null)
    or p_patch ? 'overhead_pct'
    or p_patch ? 'profit_pct'
    or p_patch ? 'contingency_pct'
    or p_patch ? 'bond_pct'
    or p_patch ? 'tax_pct'
    or p_patch ? 'general_conditions_pct'
    or p_patch ? 'custom_markups'
  ) then
    raise exception using
      errcode = '55000',
      message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;
  if p_patch ? 'name' and (
    nullif(btrim(p_patch ->> 'name'), '') is null
    or length(p_patch ->> 'name') > 200
  ) then
    raise exception using errcode = '22023', message = 'Estimate name is required and cannot exceed 200 characters.';
  end if;
  if (p_patch ? 'description' and length(p_patch ->> 'description') > 2000)
     or (p_patch ? 'project_type' and length(p_patch ->> 'project_type') > 32)
     or (p_patch ? 'region' and length(p_patch ->> 'region') > 64)
  then
    raise exception using errcode = '22023', message = 'An estimate header value exceeds its allowed length.';
  end if;
  if p_patch ? 'region_multiplier' and (
    (p_patch ->> 'region_multiplier')::numeric < 0
    or (p_patch ->> 'region_multiplier')::numeric > 10
  ) then
    raise exception using errcode = '22023', message = 'Estimate region multiplier is invalid.';
  end if;
  if p_patch ? 'status'
     and (p_patch ->> 'status') not in ('draft', 'final', 'awarded', 'lost')
  then
    raise exception using errcode = '22023', message = 'Estimate status is invalid.';
  end if;
  if p_patch ? 'status'
     and (p_patch ->> 'status') = 'final'
     and not exists (
       select 1 from public.estimate_line_items line
       where line.estimate_id = p_estimate_id
     )
  then
    raise exception using errcode = '22023', message = 'An empty estimate cannot be finalized.';
  end if;

  update public.estimates estimate
  set
    name = case when p_patch ? 'name' then btrim(p_patch ->> 'name') else estimate.name end,
    description = case when p_patch ? 'description' then p_patch ->> 'description' else estimate.description end,
    opportunity_id = case
      when p_patch -> 'opportunity_id' = 'null'::jsonb then null
      when p_patch ? 'opportunity_id' then (p_patch ->> 'opportunity_id')::uuid
      else estimate.opportunity_id
    end,
    project_id = case
      when p_patch -> 'project_id' = 'null'::jsonb then null
      when p_patch ? 'project_id' then (p_patch ->> 'project_id')::uuid
      else estimate.project_id
    end,
    project_type = case when p_patch ? 'project_type' then p_patch ->> 'project_type' else estimate.project_type end,
    region = case when p_patch ? 'region' then p_patch ->> 'region' else estimate.region end,
    region_multiplier = case when p_patch ? 'region_multiplier' then (p_patch ->> 'region_multiplier')::numeric else estimate.region_multiplier end,
    overhead_pct = case when p_patch ? 'overhead_pct' then (p_patch ->> 'overhead_pct')::integer else estimate.overhead_pct end,
    profit_pct = case when p_patch ? 'profit_pct' then (p_patch ->> 'profit_pct')::integer else estimate.profit_pct end,
    contingency_pct = case when p_patch ? 'contingency_pct' then (p_patch ->> 'contingency_pct')::integer else estimate.contingency_pct end,
    bond_pct = case when p_patch ? 'bond_pct' then (p_patch ->> 'bond_pct')::integer else estimate.bond_pct end,
    tax_pct = case when p_patch ? 'tax_pct' then (p_patch ->> 'tax_pct')::integer else estimate.tax_pct end,
    general_conditions_pct = case when p_patch ? 'general_conditions_pct' then (p_patch ->> 'general_conditions_pct')::integer else estimate.general_conditions_pct end,
    custom_markups = case when p_patch ? 'custom_markups' then p_patch -> 'custom_markups' else estimate.custom_markups end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else estimate.status end,
    folder = case when p_patch ? 'folder' then p_patch ->> 'folder' else estimate.folder end
  where estimate.id = p_estimate_id
  returning estimate.* into v_after;

  v_result := jsonb_build_object(
    'ok', true,
    'estimate', to_jsonb(v_after),
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, null, p_operation_key, 'header_update',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.update_estimate_line_item_atomic (uuid, jsonb, text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.delete_estimate_line_item_atomic (uuid, uuid, text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.reorder_estimate_line_items_atomic (uuid, uuid[], uuid[], text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.sync_estimate_takeoff_quantity_atomic (uuid, uuid, timestamptz, numeric, text, text)
from
  public,
  anon,
  authenticated,
  service_role;

revoke all on function public.update_estimate_header_atomic (uuid, jsonb, text)
from
  public,
  anon,
  authenticated,
  service_role;

grant
execute on function public.update_estimate_line_item_atomic (uuid, jsonb, text) to authenticated;

grant
execute on function public.delete_estimate_line_item_atomic (uuid, uuid, text) to authenticated;

grant
execute on function public.reorder_estimate_line_items_atomic (uuid, uuid[], uuid[], text) to authenticated;

grant
execute on function public.sync_estimate_takeoff_quantity_atomic (uuid, uuid, timestamptz, numeric, text, text) to authenticated;

grant
execute on function public.update_estimate_header_atomic (uuid, jsonb, text) to authenticated;

revoke
update,
delete on table public.estimate_line_items
from
  authenticated,
  service_role;

revoke update on table public.estimates
from
  authenticated,
  service_role;

do $$
declare
  v_columns text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into v_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'estimates'
    and column_name not in (
      'id', 'organization_id', 'created_by', 'project_id', 'region_multiplier',
      'overhead_pct', 'profit_pct', 'contingency_pct', 'bond_pct', 'tax_pct',
      'general_conditions_pct', 'custom_markups', 'subtotal_material_cents',
      'subtotal_labor_cents', 'subtotal_cents', 'total_with_markups_cents',
      'status', 'created_at'
    );
  if v_columns is not null then
    execute 'grant update (' || v_columns || ') on public.estimates to authenticated, service_role';
  end if;
end;
$$;

-- Trigger functions are not application RPCs. PostgreSQL executes them through
-- their trigger bindings; no client role needs direct EXECUTE authority.
revoke all on function public.tg_validate_project_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_cost_bucket_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_cost_bucket_safe_aggregate ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_subcontract_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_subcontract_payment_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_subcontract_payment_safe_aggregate ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_subcontract_allocation_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_enforce_keyed_subcontract_payment_immutability ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_protect_project_financial_authority ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_estimate_line_safe_money ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_lock_estimate_line_parent ()
from public, anon, authenticated, service_role;
revoke all on function public.tg_freeze_estimate_financial_content ()
from public, anon, authenticated, service_role;

comment on table public.project_financial_operations is 'Immutable command/retry journal for project creation, protected header revisions, and budget locks.';

comment on table public.project_financial_overrides is 'Immutable before/after evidence for explicit protected-header overrides after project lifecycle begins.';

comment on table public.estimate_line_operations is 'Immutable command/retry journal for draft estimate line revisions, takeoff syncs, reorders, and deletes.';

create table if not exists public.estimate_duplicate_operations (
  id uuid primary key default gen_random_uuid(),
  source_estimate_id uuid not null,
  result_estimate_id uuid not null,
  operation_key text not null,
  mode text not null check (mode in ('same_kind', 'project_estimate')),
  source_revision_fingerprint text not null,
  result jsonb not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint estimate_duplicate_operations_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint estimate_duplicate_operations_source_key_unique unique (source_estimate_id, operation_key)
);

alter table public.estimate_duplicate_operations
drop constraint if exists estimate_duplicate_operations_source_estimate_id_fkey,
add constraint estimate_duplicate_operations_source_estimate_id_fkey
foreign key (source_estimate_id) references public.estimates (id) on delete restrict;

create index if not exists estimate_duplicate_operations_source_created_idx
on public.estimate_duplicate_operations (source_estimate_id, created_at desc);

alter table public.estimate_duplicate_operations enable row level security;

revoke all on table public.estimate_duplicate_operations
from public, anon, authenticated, service_role;

grant select on table public.estimate_duplicate_operations to authenticated, service_role;

drop policy if exists estimate_duplicate_operations_select on public.estimate_duplicate_operations;
create policy estimate_duplicate_operations_select
on public.estimate_duplicate_operations for select to authenticated
using (public.can_manage_estimate(source_estimate_id));

drop trigger if exists estimate_duplicate_operations_immutable on public.estimate_duplicate_operations;
create trigger estimate_duplicate_operations_immutable
before update or delete on public.estimate_duplicate_operations for each row
execute function public.reject_financial_journal_mutation ();

create or replace function public.duplicate_estimate_atomic (
  p_source_estimate_id uuid,
  p_mode text,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.estimates%rowtype;
  v_existing public.estimate_duplicate_operations%rowtype;
  v_result_estimate_id uuid := gen_random_uuid();
  v_source_revision_fingerprint text;
  v_result jsonb;
  v_copy_name text;
  v_line_map jsonb := '{}'::jsonb;
  v_plan_set_map jsonb := '{}'::jsonb;
  v_sheet_map jsonb := '{}'::jsonb;
  v_new_id uuid;
  v_totals jsonb;
  r_line record;
  r_plan_set record;
  r_sheet record;
  r_measurement record;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to copy an estimate.';
  end if;
  if p_mode not in ('same_kind', 'project_estimate') then
    raise exception using errcode = '22023', message = 'Estimate copy mode is invalid.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate copy operation key is required.';
  end if;

  -- The parent lock is also the serialization boundary for operation-key
  -- creation. FK checks on newly inserted child rows conflict with this lock,
  -- while the explicit child locks make the revision fingerprint a complete,
  -- stable database snapshot.
  select estimate.* into v_source
  from public.estimates estimate
  where estimate.id = p_source_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if not public.can_manage_estimate(p_source_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to copy this estimate.';
  end if;

  select operation.* into v_existing
  from public.estimate_duplicate_operations operation
  where operation.source_estimate_id = p_source_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.created_by <> v_user_id or v_existing.mode <> p_mode then
      raise exception using errcode = '22023', message = 'This estimate copy operation key was already used for a different request.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  perform 1 from public.estimate_line_items line
  where line.estimate_id = p_source_estimate_id
  order by line.id for update;
  perform 1 from public.estimate_plan_sets plan_set
  where plan_set.estimate_id = p_source_estimate_id
  order by plan_set.id for update;
  perform 1 from public.estimate_plan_sheets sheet
  where sheet.estimate_id = p_source_estimate_id
  order by sheet.id for update;
  perform 1 from public.estimate_takeoff_measurements measurement
  where measurement.estimate_id = p_source_estimate_id
  order by measurement.id for update;

  v_source_revision_fingerprint := md5(jsonb_build_object(
    'estimate', jsonb_build_array(v_source.id, v_source.updated_at),
    'lines', coalesce((
      select jsonb_agg(jsonb_build_array(line.id, line.updated_at) order by line.id)
      from public.estimate_line_items line where line.estimate_id = p_source_estimate_id
    ), '[]'::jsonb),
    'plan_sets', coalesce((
      select jsonb_agg(jsonb_build_array(plan_set.id, plan_set.updated_at) order by plan_set.id)
      from public.estimate_plan_sets plan_set where plan_set.estimate_id = p_source_estimate_id
    ), '[]'::jsonb),
    'sheets', coalesce((
      select jsonb_agg(jsonb_build_array(sheet.id, sheet.updated_at) order by sheet.id)
      from public.estimate_plan_sheets sheet where sheet.estimate_id = p_source_estimate_id
    ), '[]'::jsonb),
    'measurements', coalesce((
      select jsonb_agg(jsonb_build_array(measurement.id, measurement.updated_at) order by measurement.id)
      from public.estimate_takeoff_measurements measurement where measurement.estimate_id = p_source_estimate_id
    ), '[]'::jsonb)
  )::text);

  v_copy_name := case
    when v_source.is_canonical_demo then 'Harbor Residence — Working Copy'
    when p_mode = 'project_estimate' then left(
      coalesce(
        nullif(btrim(regexp_replace(v_source.name, '\\s*master\\s*(estimate|sheet)?\\s*', ' ', 'gi')), ''),
        'Estimate from ' || v_source.name
      ) || ' Estimate',
      200
    )
    else left('Copy of ' || v_source.name, 200)
  end;

  insert into public.estimates (
    id, organization_id, created_by, name, description, opportunity_id,
    project_id, project_type, kind, region, region_multiplier,
    overhead_pct, profit_pct, contingency_pct, bond_pct, tax_pct,
    general_conditions_pct, custom_markups, status, folder,
    is_canonical_demo, canonical_demo_key, canonical_demo_version,
    canonical_expected_total_cents
  ) values (
    v_result_estimate_id, v_source.organization_id, v_user_id, v_copy_name,
    v_source.description, v_source.opportunity_id, null,
    case when p_mode = 'project_estimate' or v_source.project_type = '__master_estimate__'
      then 'commercial' else v_source.project_type end,
    case when p_mode = 'project_estimate' then 'estimate' else v_source.kind end,
    v_source.region, v_source.region_multiplier,
    v_source.overhead_pct, v_source.profit_pct, v_source.contingency_pct,
    v_source.bond_pct, v_source.tax_pct, v_source.general_conditions_pct,
    v_source.custom_markups, 'draft', 'sales_process',
    false, null, null, null
  );

  for r_line in
    select line.* from public.estimate_line_items line
    where line.estimate_id = p_source_estimate_id order by line.sort_order, line.id
  loop
    v_new_id := gen_random_uuid();
    v_line_map := v_line_map || jsonb_build_object(r_line.id::text, v_new_id::text);
    insert into public.estimate_line_items (
      id, estimate_id, csi_division, cost_code, description, unit, quantity,
      material_unit_cost_cents, labor_unit_cost_cents, library_item_id,
      scope_group, sort_order, notes
    ) values (
      v_new_id, v_result_estimate_id, r_line.csi_division, r_line.cost_code,
      r_line.description, r_line.unit, r_line.quantity,
      r_line.material_unit_cost_cents, r_line.labor_unit_cost_cents,
      r_line.library_item_id, r_line.scope_group, r_line.sort_order, r_line.notes
    );
  end loop;

  for r_plan_set in
    select plan_set.* from public.estimate_plan_sets plan_set
    where plan_set.estimate_id = p_source_estimate_id order by plan_set.created_at, plan_set.id
  loop
    v_new_id := gen_random_uuid();
    v_plan_set_map := v_plan_set_map || jsonb_build_object(r_plan_set.id::text, v_new_id::text);
    insert into public.estimate_plan_sets (
      id, organization_id, estimate_id, created_by, name, description,
      source_file_name, file_path, file_mime_type, file_size_bytes,
      page_count, sample_key, status
    ) values (
      v_new_id, v_source.organization_id, v_result_estimate_id, v_user_id,
      r_plan_set.name, r_plan_set.description, r_plan_set.source_file_name,
      r_plan_set.file_path, r_plan_set.file_mime_type, r_plan_set.file_size_bytes,
      r_plan_set.page_count, '', r_plan_set.status
    );
  end loop;

  for r_sheet in
    select sheet.* from public.estimate_plan_sheets sheet
    where sheet.estimate_id = p_source_estimate_id order by sheet.sort_order, sheet.id
  loop
    v_new_id := gen_random_uuid();
    v_sheet_map := v_sheet_map || jsonb_build_object(r_sheet.id::text, v_new_id::text);
    insert into public.estimate_plan_sheets (
      id, plan_set_id, estimate_id, sheet_number, sheet_name, discipline,
      page_number, sort_order, scale_label, scale_feet_per_pixel,
      scale_source, scale_verified_at, thumbnail_path, width_px, height_px,
      scale_revision, scale_changed_at
    ) values (
      v_new_id, (v_plan_set_map ->> r_sheet.plan_set_id::text)::uuid,
      v_result_estimate_id, r_sheet.sheet_number, r_sheet.sheet_name,
      r_sheet.discipline, r_sheet.page_number, r_sheet.sort_order,
      r_sheet.scale_label, r_sheet.scale_feet_per_pixel,
      r_sheet.scale_source, null, r_sheet.thumbnail_path, r_sheet.width_px,
      r_sheet.height_px, r_sheet.scale_revision, r_sheet.scale_changed_at
    );
  end loop;

  for r_measurement in
    select measurement.* from public.estimate_takeoff_measurements measurement
    where measurement.estimate_id = p_source_estimate_id order by measurement.created_at, measurement.id
  loop
    insert into public.estimate_takeoff_measurements (
      id, estimate_id, plan_sheet_id, estimate_line_item_id, library_item_id,
      created_by, tool_type, label, unit, quantity, waste_pct, color,
      geometry, notes, created_by_ai, calculation_method, calculation_status,
      calculated_quantity, calculation_scale_revision, calculated_at,
      calculation_context, override_reason, ai_operation_id,
      ai_proposal_source, ai_confidence, ai_original_geometry,
      ai_review_action, ai_reviewed_by, ai_reviewed_at, scope_brief_review_id
    ) values (
      gen_random_uuid(), v_result_estimate_id,
      (v_sheet_map ->> r_measurement.plan_sheet_id::text)::uuid,
      case when r_measurement.estimate_line_item_id is null then null
        else (v_line_map ->> r_measurement.estimate_line_item_id::text)::uuid end,
      r_measurement.library_item_id, v_user_id, r_measurement.tool_type,
      r_measurement.label, r_measurement.unit, r_measurement.quantity,
      r_measurement.waste_pct, r_measurement.color, r_measurement.geometry,
      r_measurement.notes, r_measurement.created_by_ai,
      case when r_measurement.tool_type = 'count' then 'count' else 'geometry' end,
      case when r_measurement.tool_type = 'count' then 'current' else 'unverified_scale' end,
      case when r_measurement.tool_type = 'count' then r_measurement.quantity else null end,
      case when r_measurement.tool_type = 'count' then null else r_measurement.calculation_scale_revision end,
      case when r_measurement.tool_type = 'count' then now() else null end,
      coalesce(r_measurement.calculation_context, '{}'::jsonb) || jsonb_build_object(
        'source', 'estimate_atomic_copy',
        'copied_from_measurement_id', r_measurement.id
      ),
      '', null,
      case when r_measurement.created_by_ai then 'estimate_atomic_copy' else null end,
      r_measurement.ai_confidence, r_measurement.ai_original_geometry,
      r_measurement.ai_review_action, r_measurement.ai_reviewed_by,
      r_measurement.ai_reviewed_at, null
    );
  end loop;

  v_totals := public.recalculate_estimate_totals_from_lines(v_result_estimate_id);
  v_result := jsonb_build_object(
    'ok', true,
    'id', v_result_estimate_id,
    'source_estimate_id', p_source_estimate_id,
    'source_revision_fingerprint', v_source_revision_fingerprint,
    'mode', p_mode,
    'deduplicated', false
  );

  insert into public.estimate_duplicate_operations (
    source_estimate_id, result_estimate_id, operation_key, mode,
    source_revision_fingerprint, result, created_by
  ) values (
    p_source_estimate_id, v_result_estimate_id, p_operation_key, p_mode,
    v_source_revision_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.duplicate_estimate_atomic (uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.duplicate_estimate_atomic (uuid, text, text) to authenticated;

comment on table public.estimate_duplicate_operations is 'Immutable idempotency journal for all-or-nothing estimate, line, and Plan Room snapshot copies.';

-- Subcontract commitments, allocation coding, change-order revisions, and
-- payment facts are financial authority. Every mutation below is versioned,
-- replay-safe, and permanently journaled before raw Data API DML is revoked.
create table if not exists public.subcontract_authority_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null,
  subcontract_id uuid,
  resource_id uuid not null,
  operation_key text not null,
  operation_type text not null check (operation_type in (
    'subcontract_create', 'subcontract_update', 'subcontract_delete',
    'allocation_create', 'allocation_update', 'allocation_delete',
    'change_order_create', 'change_order_update', 'change_order_delete'
  )),
  request_fingerprint text not null,
  result jsonb not null,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint subcontract_authority_operations_key_length check (length(btrim(operation_key)) between 1 and 200),
  constraint subcontract_authority_operations_actor_key_unique unique (changed_by, operation_key)
);

alter table public.subcontract_authority_operations
drop constraint if exists subcontract_authority_operations_project_id_fkey,
add constraint subcontract_authority_operations_project_id_fkey
foreign key (project_id) references public.projects (id) on delete restrict;

create index if not exists subcontract_authority_operations_subcontract_created_idx
on public.subcontract_authority_operations (subcontract_id, created_at desc);

alter table public.subcontract_authority_operations enable row level security;
revoke all on table public.subcontract_authority_operations
from public, anon, authenticated, service_role;
grant select on table public.subcontract_authority_operations to authenticated, service_role;
drop policy if exists subcontract_authority_operations_select on public.subcontract_authority_operations;
create policy subcontract_authority_operations_select
on public.subcontract_authority_operations for select to authenticated
using (public.can_read_project(project_id));
drop trigger if exists subcontract_authority_operations_immutable on public.subcontract_authority_operations;
create trigger subcontract_authority_operations_immutable
before update or delete on public.subcontract_authority_operations for each row
execute function public.reject_financial_journal_mutation ();

create or replace function public.save_subcontract_atomic (
  p_project_id uuid,
  p_subcontract_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.subcontract_authority_operations%rowtype;
  v_before public.subcontracts%rowtype;
  v_after public.subcontracts%rowtype;
  v_operation_type text;
  v_resource_id uuid := coalesce(p_subcontract_id, gen_random_uuid());
  v_fingerprint text;
  v_contract_cents numeric;
  v_result jsonb;
  v_project_org uuid;
  v_allocated numeric;
  v_change_orders numeric;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication is required to save a subcontract.'; end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid subcontract operation key is required.';
  end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or exists (
    select 1 from jsonb_object_keys(p_patch) key where key not in (
      'subcontractor_id', 'title', 'scope', 'contract_value_cents',
      'retainage_pct', 'status', 'executed_at'
    )
  ) then raise exception using errcode = '22023', message = 'Subcontract details are invalid.'; end if;

  v_operation_type := case when p_subcontract_id is null then 'subcontract_create' else 'subcontract_update' end;
  v_fingerprint := md5(jsonb_build_array(p_project_id, p_subcontract_id, p_expected_updated_at, p_patch)::text);
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This subcontract operation key was already used for different changes.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to save this subcontract.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select project.organization_id into v_project_org from public.projects project
  where project.id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(p_project_id) then raise exception using errcode = '42501', message = 'You do not have permission to save this subcontract.'; end if;
  -- The project row is the create/update serialization point. A simultaneous
  -- retry can miss the optimistic journal lookup above while the first request
  -- is still open, so re-read after the lock instead of surfacing a 23505 from
  -- the journal's unique constraint.
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This subcontract operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  if nullif(btrim(p_patch ->> 'subcontractor_id'), '') is null or not exists (
    select 1 from public.subcontractors directory
    where directory.id = (p_patch ->> 'subcontractor_id')::uuid
      and directory.organization_id = v_project_org
  ) then raise exception using errcode = '23503', message = 'The subcontractor is not in this project company directory.'; end if;
  begin v_contract_cents := (p_patch ->> 'contract_value_cents')::numeric;
  exception when others then raise exception using errcode = '22023', message = 'Subcontract value must be exact cents.'; end;
  perform public.assert_safe_accounting_cents(v_contract_cents, 'Subcontract value');
  if length(coalesce(p_patch ->> 'title', '')) > 300 or length(coalesce(p_patch ->> 'scope', '')) > 8000 then
    raise exception using errcode = '22023', message = 'Subcontract title or scope is too long.';
  end if;
  if coalesce((p_patch ->> 'retainage_pct')::numeric, 0) < 0 or coalesce((p_patch ->> 'retainage_pct')::numeric, 0) > 100 then
    raise exception using errcode = '23514', message = 'Subcontract retainage must be between 0 and 100 percent.';
  end if;
  if coalesce(p_patch ->> 'status', 'draft') not in ('draft', 'executed') then
    raise exception using errcode = '22023', message = 'Subcontract status is invalid.';
  end if;

  if p_subcontract_id is null then
    insert into public.subcontracts (
      id, project_id, subcontractor_id, title, scope, contract_value,
      retainage_pct, status, executed_at
    ) values (
      v_resource_id, p_project_id, (p_patch ->> 'subcontractor_id')::uuid,
      coalesce(p_patch ->> 'title', ''), coalesce(p_patch ->> 'scope', ''),
      v_contract_cents / 100.0, coalesce((p_patch ->> 'retainage_pct')::numeric, 0),
      coalesce(p_patch ->> 'status', 'draft'),
      case when p_patch -> 'executed_at' = 'null'::jsonb then null else (p_patch ->> 'executed_at')::date end
    ) returning * into v_after;
  else
    if p_expected_updated_at is null then raise exception using errcode = '22023', message = 'The expected subcontract version is required.'; end if;
    select subcontract.* into v_before from public.subcontracts subcontract
    where subcontract.id = p_subcontract_id for update;
    if not found or v_before.project_id <> p_project_id then raise exception using errcode = 'P0002', message = 'Subcontract not found.'; end if;
    if v_before.updated_at is distinct from p_expected_updated_at then raise exception using errcode = '40001', message = 'The subcontract changed before your save committed. Refresh and try again.'; end if;
    perform 1 from public.subcontract_allocations allocation
    where allocation.subcontract_id = p_subcontract_id order by allocation.id for update;
    perform 1 from public.subcontract_change_orders change_order
    where change_order.subcontract_id = p_subcontract_id order by change_order.id for update;
    select coalesce(sum(allocation.amount), 0) into v_allocated
    from public.subcontract_allocations allocation where allocation.subcontract_id = p_subcontract_id;
    select coalesce(sum(change_order.amount), 0) into v_change_orders
    from public.subcontract_change_orders change_order where change_order.subcontract_id = p_subcontract_id;
    if v_contract_cents / 100.0 + v_change_orders < v_allocated then
      raise exception using errcode = '23514', message = 'The revised subcontract commitment cannot be lower than its current allocations.';
    end if;
    update public.subcontracts subcontract set
      subcontractor_id = (p_patch ->> 'subcontractor_id')::uuid,
      title = coalesce(p_patch ->> 'title', ''), scope = coalesce(p_patch ->> 'scope', ''),
      contract_value = v_contract_cents / 100.0,
      retainage_pct = coalesce((p_patch ->> 'retainage_pct')::numeric, 0),
      status = coalesce(p_patch ->> 'status', 'draft'),
      executed_at = case when p_patch -> 'executed_at' = 'null'::jsonb then null else (p_patch ->> 'executed_at')::date end
    where subcontract.id = p_subcontract_id returning * into v_after;
  end if;
  v_result := to_jsonb(v_after) || jsonb_build_object('deduplicated', false);
  insert into public.subcontract_authority_operations (
    project_id, subcontract_id, resource_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (p_project_id, v_after.id, v_after.id, p_operation_key, v_operation_type, v_fingerprint, v_result, v_user_id);
  return v_result;
end;
$$;

create or replace function public.delete_untouched_subcontract_draft_atomic (
  p_subcontract_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.subcontract_authority_operations%rowtype;
  v_subcontract public.subcontracts%rowtype;
  v_fingerprint text := md5(jsonb_build_array(p_subcontract_id, p_expected_updated_at, 'delete_untouched_draft')::text);
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication is required to remove a subcontract draft.'; end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'A valid subcontract draft version and operation key are required.';
  end if;
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'subcontract_delete' or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This subcontract operation key was already used for different changes.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to remove this subcontract draft.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  select subcontract.* into v_subcontract from public.subcontracts subcontract
  where subcontract.id = p_subcontract_id for update;
  if not found then
    -- A simultaneous retry waits for the first delete, then no longer sees the
    -- row. The immutable result is still authoritative and must be replayed.
    select operation.* into v_existing from public.subcontract_authority_operations operation
    where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
    if found then
      if v_existing.operation_type <> 'subcontract_delete' or v_existing.request_fingerprint <> v_fingerprint then
        raise exception using errcode = '22023', message = 'This subcontract operation key was already used for different changes.';
      end if;
      if not public.can_manage_project(v_existing.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to remove this subcontract draft.'; end if;
      return v_existing.result || jsonb_build_object('deduplicated', true);
    end if;
    raise exception using errcode = 'P0002', message = 'Subcontract draft not found.';
  end if;
  if not public.can_manage_project(v_subcontract.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to remove this subcontract draft.'; end if;
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'subcontract_delete' or v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This subcontract operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  if v_subcontract.status <> 'draft' or v_subcontract.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '55000', message = 'Only the current, untouched subcontract draft can be removed.';
  end if;
  if exists (select 1 from public.subcontract_allocations where subcontract_id = p_subcontract_id)
    or exists (select 1 from public.subcontract_change_orders where subcontract_id = p_subcontract_id)
    or exists (select 1 from public.subcontract_payments where subcontract_id = p_subcontract_id)
    or exists (select 1 from public.subcontract_documents where subcontract_id = p_subcontract_id)
    or exists (select 1 from public.insurance_certificates where subcontract_id = p_subcontract_id)
    or exists (select 1 from public.lien_waivers where subcontract_id = p_subcontract_id)
    or exists (
      select 1 from public.subcontract_authority_operations operation
      where operation.subcontract_id = p_subcontract_id
        and operation.operation_type <> 'subcontract_create'
    )
  then raise exception using errcode = '55000', message = 'This subcontract has financial or compliance history and cannot be removed. Keep the record for audit history.';
  end if;
  delete from public.subcontracts where id = p_subcontract_id;
  v_result := jsonb_build_object('ok', true, 'id', p_subcontract_id, 'deleted_subcontract', to_jsonb(v_subcontract), 'deduplicated', false);
  insert into public.subcontract_authority_operations (
    project_id, subcontract_id, resource_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (v_subcontract.project_id, p_subcontract_id, p_subcontract_id, p_operation_key, 'subcontract_delete', v_fingerprint, v_result, v_user_id);
  return v_result;
end;
$$;

create or replace function public.mutate_subcontract_allocation_atomic (
  p_subcontract_id uuid,
  p_allocation_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_delete boolean,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.subcontract_authority_operations%rowtype;
  v_subcontract public.subcontracts%rowtype;
  v_before public.subcontract_allocations%rowtype;
  v_after public.subcontract_allocations%rowtype;
  v_resource_id uuid := coalesce(p_allocation_id, gen_random_uuid());
  v_operation_type text;
  v_fingerprint text;
  v_amount_cents numeric;
  v_rate_cents numeric;
  v_revised numeric;
  v_other_allocated numeric;
  v_bucket public.cost_buckets%rowtype;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication is required to change a subcontract allocation.'; end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then raise exception using errcode = '22023', message = 'A valid allocation operation key is required.'; end if;
  if p_delete is null
    or (p_delete and (p_allocation_id is null or p_expected_updated_at is null or coalesce(p_patch, '{}'::jsonb) <> '{}'::jsonb))
    or (not p_delete and p_allocation_id is null and p_expected_updated_at is not null)
    or (not p_delete and p_allocation_id is not null and p_expected_updated_at is null)
  then
    raise exception using errcode = '22023', message = 'Allocation create, update, or delete arguments are malformed.';
  end if;
  v_operation_type := case when p_delete then 'allocation_delete' when p_allocation_id is null then 'allocation_create' else 'allocation_update' end;
  v_fingerprint := md5(jsonb_build_array(p_subcontract_id, p_allocation_id, p_expected_updated_at, p_patch, p_delete)::text);
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then raise exception using errcode = '22023', message = 'This allocation operation key was already used for different changes.'; end if;
    if not public.can_manage_project(v_existing.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to change this allocation.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  select subcontract.* into v_subcontract from public.subcontracts subcontract
  where subcontract.id = p_subcontract_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Subcontract not found.'; end if;
  if not public.can_manage_project(v_subcontract.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to change this allocation.'; end if;
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then raise exception using errcode = '22023', message = 'This allocation operation key was already used for different changes.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  perform 1 from public.subcontract_allocations allocation where allocation.subcontract_id = p_subcontract_id order by allocation.id for update;
  perform 1 from public.subcontract_change_orders change_order where change_order.subcontract_id = p_subcontract_id order by change_order.id for update;
  select v_subcontract.contract_value + coalesce(sum(change_order.amount), 0) into v_revised
  from public.subcontract_change_orders change_order where change_order.subcontract_id = p_subcontract_id;
  select coalesce(sum(allocation.amount), 0) into v_other_allocated
  from public.subcontract_allocations allocation
  where allocation.subcontract_id = p_subcontract_id and allocation.id is distinct from p_allocation_id;

  if p_allocation_id is not null then
    if p_expected_updated_at is null then raise exception using errcode = '22023', message = 'The expected allocation version is required.'; end if;
    select allocation.* into v_before from public.subcontract_allocations allocation where allocation.id = p_allocation_id for update;
    if not found or v_before.subcontract_id <> p_subcontract_id then raise exception using errcode = 'P0002', message = 'Allocation not found.'; end if;
    if v_before.updated_at is distinct from p_expected_updated_at then raise exception using errcode = '40001', message = 'The allocation changed before your save committed. Refresh and try again.'; end if;
  end if;
  if p_delete then
    delete from public.subcontract_allocations where id = p_allocation_id;
    v_result := jsonb_build_object('ok', true, 'id', p_allocation_id, 'deleted_allocation', to_jsonb(v_before), 'deduplicated', false);
  else
    if jsonb_typeof(p_patch) is distinct from 'object' or exists (
      select 1 from jsonb_object_keys(p_patch) key where key not in (
        'cost_bucket_id', 'amount_cents', 'planned_quantity', 'unit', 'benchmark_labor_rate_cents'
      )
    ) then raise exception using errcode = '22023', message = 'Allocation details are invalid.'; end if;
    begin
      v_amount_cents := case when p_patch ? 'amount_cents' then (p_patch ->> 'amount_cents')::numeric else v_before.amount * 100 end;
      v_rate_cents := case when p_patch ? 'benchmark_labor_rate_cents' then (p_patch ->> 'benchmark_labor_rate_cents')::numeric else coalesce(v_before.benchmark_labor_rate, 0) * 100 end;
    exception when others then raise exception using errcode = '22023', message = 'Allocation money must be exact cents.'; end;
    perform public.assert_safe_accounting_cents(v_amount_cents, 'Subcontract allocation');
    perform public.assert_safe_accounting_cents(v_rate_cents, 'Production benchmark rate');
    if v_other_allocated + v_amount_cents / 100.0 > v_revised then
      raise exception using errcode = '23514', message = 'Total allocation cannot exceed the revised subcontract commitment.';
    end if;
    select bucket.* into v_bucket from public.cost_buckets bucket
    where bucket.id = coalesce((p_patch ->> 'cost_bucket_id')::uuid, v_before.cost_bucket_id) for update;
    if not found or v_bucket.project_id <> v_subcontract.project_id then raise exception using errcode = '23503', message = 'That cost code belongs to a different project.'; end if;
    if p_allocation_id is null then
      insert into public.subcontract_allocations (
        id, project_id, subcontract_id, cost_bucket_id, cost_code, description,
        amount, planned_quantity, unit, benchmark_labor_rate
      ) values (
        v_resource_id, v_subcontract.project_id, p_subcontract_id, v_bucket.id,
        v_bucket.cost_code, v_bucket.bucket, v_amount_cents / 100.0,
        coalesce((p_patch ->> 'planned_quantity')::numeric, 0),
        coalesce(p_patch ->> 'unit', ''), v_rate_cents / 100.0
      ) returning * into v_after;
    else
      update public.subcontract_allocations allocation set
        cost_bucket_id = v_bucket.id, cost_code = v_bucket.cost_code,
        description = case when p_patch ? 'cost_bucket_id' then v_bucket.bucket else allocation.description end,
        amount = v_amount_cents / 100.0,
        planned_quantity = case when p_patch ? 'planned_quantity' then (p_patch ->> 'planned_quantity')::numeric else allocation.planned_quantity end,
        unit = case when p_patch ? 'unit' then p_patch ->> 'unit' else allocation.unit end,
        benchmark_labor_rate = v_rate_cents / 100.0
      where allocation.id = p_allocation_id returning * into v_after;
    end if;
    v_result := to_jsonb(v_after) || jsonb_build_object('deduplicated', false);
  end if;
  insert into public.subcontract_authority_operations (
    project_id, subcontract_id, resource_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (v_subcontract.project_id, p_subcontract_id, v_resource_id, p_operation_key, v_operation_type, v_fingerprint, v_result, v_user_id);
  return v_result;
end;
$$;

-- Credits are valid signed amounts. The previous shared nonnegative trigger
-- accidentally rejected them; retain exact-cent/range validation while allowing
-- the negative side of the signed change-order ledger.
create or replace function public.tg_validate_subcontract_change_order_safe_money () returns trigger language plpgsql security invoker
set search_path = '' as $$
begin
  perform public.assert_safe_accounting_cents(new.amount * 100, 'Subcontract change order amount', true);
  return new;
end;
$$;
drop trigger if exists subcontract_change_orders_validate_safe_money on public.subcontract_change_orders;
create trigger subcontract_change_orders_validate_safe_money
before insert or update of amount on public.subcontract_change_orders for each row
execute function public.tg_validate_subcontract_change_order_safe_money ();

create or replace function public.mutate_subcontract_change_order_atomic (
  p_subcontract_id uuid,
  p_change_order_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_delete boolean,
  p_operation_key text
) returns jsonb language plpgsql security definer
set search_path = '' as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.subcontract_authority_operations%rowtype;
  v_subcontract public.subcontracts%rowtype;
  v_before public.subcontract_change_orders%rowtype;
  v_after public.subcontract_change_orders%rowtype;
  v_resource_id uuid := coalesce(p_change_order_id, gen_random_uuid());
  v_operation_type text;
  v_fingerprint text;
  v_amount_cents numeric;
  v_existing_co_total numeric;
  v_allocated numeric;
  v_bucket public.cost_buckets%rowtype;
  v_exposure_id uuid;
  v_result jsonb;
begin
  if v_user_id is null then raise exception using errcode = '42501', message = 'Authentication is required to change a subcontract change order.'; end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then raise exception using errcode = '22023', message = 'A valid change-order operation key is required.'; end if;
  if p_delete is null
    or (p_delete and (p_change_order_id is null or p_expected_updated_at is null or coalesce(p_patch, '{}'::jsonb) <> '{}'::jsonb))
    or (not p_delete and p_change_order_id is null and p_expected_updated_at is not null)
    or (not p_delete and p_change_order_id is not null and p_expected_updated_at is null)
  then
    raise exception using errcode = '22023', message = 'Change-order create, update, or delete arguments are malformed.';
  end if;
  v_operation_type := case when p_delete then 'change_order_delete' when p_change_order_id is null then 'change_order_create' else 'change_order_update' end;
  v_fingerprint := md5(jsonb_build_array(p_subcontract_id, p_change_order_id, p_expected_updated_at, p_patch, p_delete)::text);
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then raise exception using errcode = '22023', message = 'This change-order operation key was already used for different changes.'; end if;
    if not public.can_manage_project(v_existing.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to change this subcontract change order.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  select subcontract.* into v_subcontract from public.subcontracts subcontract where subcontract.id = p_subcontract_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Subcontract not found.'; end if;
  if not public.can_manage_project(v_subcontract.project_id) then raise exception using errcode = '42501', message = 'You do not have permission to change this subcontract change order.'; end if;
  select operation.* into v_existing from public.subcontract_authority_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> v_operation_type or v_existing.request_fingerprint <> v_fingerprint then raise exception using errcode = '22023', message = 'This change-order operation key was already used for different changes.'; end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  perform 1 from public.subcontract_change_orders change_order where change_order.subcontract_id = p_subcontract_id order by change_order.id for update;
  perform 1 from public.subcontract_allocations allocation where allocation.subcontract_id = p_subcontract_id order by allocation.id for update;
  select coalesce(sum(amount), 0) into v_existing_co_total from public.subcontract_change_orders
  where subcontract_id = p_subcontract_id and id is distinct from p_change_order_id;
  select coalesce(sum(amount), 0) into v_allocated from public.subcontract_allocations where subcontract_id = p_subcontract_id;
  if p_change_order_id is not null then
    if p_expected_updated_at is null then raise exception using errcode = '22023', message = 'The expected change-order version is required.'; end if;
    select change_order.* into v_before from public.subcontract_change_orders change_order where change_order.id = p_change_order_id for update;
    if not found or v_before.subcontract_id <> p_subcontract_id then raise exception using errcode = 'P0002', message = 'Subcontract change order not found.'; end if;
    if v_before.updated_at is distinct from p_expected_updated_at then raise exception using errcode = '40001', message = 'The change order changed before your save committed. Refresh and try again.'; end if;
  end if;
  if p_delete then
    if v_subcontract.contract_value + v_existing_co_total < v_allocated then raise exception using errcode = '23514', message = 'Removing this change order would leave allocations above the revised commitment.'; end if;
    delete from public.subcontract_change_orders where id = p_change_order_id;
    v_result := jsonb_build_object('ok', true, 'id', p_change_order_id, 'deleted_change_order', to_jsonb(v_before), 'deduplicated', false);
  else
    if jsonb_typeof(p_patch) is distinct from 'object' or exists (
      select 1 from jsonb_object_keys(p_patch) key where key not in (
        'cost_bucket_id', 'description', 'amount_cents', 'co_date', 'exposure_id'
      )
    ) then raise exception using errcode = '22023', message = 'Change-order details are invalid.'; end if;
    begin v_amount_cents := case when p_patch ? 'amount_cents' then (p_patch ->> 'amount_cents')::numeric else v_before.amount * 100 end;
    exception when others then raise exception using errcode = '22023', message = 'Change-order amount must be exact cents.'; end;
    perform public.assert_safe_accounting_cents(v_amount_cents, 'Subcontract change order amount', true);
    if v_amount_cents = 0 then raise exception using errcode = '23514', message = 'A change order or credit cannot be zero.'; end if;
    if v_subcontract.contract_value + v_existing_co_total + v_amount_cents / 100.0 < v_allocated then
      raise exception using errcode = '23514', message = 'This credit would leave allocations above the revised commitment.';
    end if;
    if p_patch -> 'cost_bucket_id' = 'null'::jsonb then v_bucket.id := null;
    elsif p_patch ? 'cost_bucket_id' then
      select bucket.* into v_bucket from public.cost_buckets bucket where bucket.id = (p_patch ->> 'cost_bucket_id')::uuid for update;
      if not found or v_bucket.project_id <> v_subcontract.project_id then raise exception using errcode = '23503', message = 'That cost code belongs to a different project.'; end if;
    elsif p_change_order_id is not null and v_before.cost_bucket_id is not null then
      select bucket.* into v_bucket from public.cost_buckets bucket where bucket.id = v_before.cost_bucket_id;
    end if;
    v_exposure_id := case when p_patch -> 'exposure_id' = 'null'::jsonb then null when p_patch ? 'exposure_id' then (p_patch ->> 'exposure_id')::uuid else v_before.exposure_id end;
    if v_exposure_id is not null and not exists (select 1 from public.exposures exposure where exposure.id = v_exposure_id and exposure.project_id = v_subcontract.project_id) then
      raise exception using errcode = '23503', message = 'That risk belongs to a different project or is no longer available.';
    end if;
    if p_change_order_id is null then
      insert into public.subcontract_change_orders (
        id, project_id, subcontract_id, cost_bucket_id, cost_code, description,
        amount, co_date, exposure_id
      ) values (
        v_resource_id, v_subcontract.project_id, p_subcontract_id, v_bucket.id,
        coalesce(v_bucket.cost_code, ''), coalesce(nullif(p_patch ->> 'description', ''), v_bucket.bucket, ''),
        v_amount_cents / 100.0, (p_patch ->> 'co_date')::date, v_exposure_id
      ) returning * into v_after;
    else
      update public.subcontract_change_orders change_order set
        cost_bucket_id = case when p_patch ? 'cost_bucket_id' then v_bucket.id else change_order.cost_bucket_id end,
        cost_code = case when p_patch ? 'cost_bucket_id' then coalesce(v_bucket.cost_code, '') else change_order.cost_code end,
        description = case when p_patch ? 'description' then p_patch ->> 'description' else change_order.description end,
        amount = v_amount_cents / 100.0,
        co_date = case when p_patch ? 'co_date' then (p_patch ->> 'co_date')::date else change_order.co_date end,
        exposure_id = v_exposure_id
      where change_order.id = p_change_order_id returning * into v_after;
    end if;
    v_result := to_jsonb(v_after) || jsonb_build_object('deduplicated', false);
  end if;
  insert into public.subcontract_authority_operations (
    project_id, subcontract_id, resource_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (v_subcontract.project_id, p_subcontract_id, v_resource_id, p_operation_key, v_operation_type, v_fingerprint, v_result, v_user_id);
  return v_result;
end;
$$;

revoke all on function public.save_subcontract_atomic (uuid, uuid, timestamptz, jsonb, text),
public.delete_untouched_subcontract_draft_atomic (uuid, timestamptz, text),
public.mutate_subcontract_allocation_atomic (uuid, uuid, timestamptz, jsonb, boolean, text),
public.mutate_subcontract_change_order_atomic (uuid, uuid, timestamptz, jsonb, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.save_subcontract_atomic (uuid, uuid, timestamptz, jsonb, text),
public.delete_untouched_subcontract_draft_atomic (uuid, timestamptz, text),
public.mutate_subcontract_allocation_atomic (uuid, uuid, timestamptz, jsonb, boolean, text),
public.mutate_subcontract_change_order_atomic (uuid, uuid, timestamptz, jsonb, boolean, text)
to authenticated;

revoke insert, update, delete on table public.subcontracts,
public.subcontract_allocations, public.subcontract_change_orders,
public.subcontract_payments from authenticated, service_role;
revoke delete on table public.projects, public.estimates from authenticated, service_role;
revoke all on function public.tg_validate_subcontract_change_order_safe_money ()
from public, anon, authenticated, service_role;

comment on table public.subcontract_authority_operations is 'Immutable command/retry journal for subcontract commitments, allocations, change orders, credits, and safe draft removal.';

notify pgrst,
'reload schema';
