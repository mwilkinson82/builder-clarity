-- Project-money integrity hardening.
--
-- 1. Manual invoice payments are one atomic, idempotent database operation.
-- 2. Change-order allocations are serialized on the parent CO and cannot
--    exceed its approved contract/cost value, even through direct REST writes.
--
-- Application is intentionally handled by the Lovable release path. This file
-- is portable and contains no environment-specific seed data.

alter table public.payment_ledger
  add column if not exists idempotency_key text;

create unique index if not exists payment_ledger_invoice_idempotency_unique
  on public.payment_ledger (invoice_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.payment_ledger.idempotency_key is
  'Caller-stable key for retry-safe payment recording. Unique within one invoice.';

alter table public.change_order_allocations
  add column if not exists idempotency_key text,
  add column if not exists idempotency_fingerprint text;

create unique index if not exists change_order_allocations_co_idempotency_unique
  on public.change_order_allocations (change_order_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.change_order_allocations.idempotency_key is
  'Caller-stable key for retry-safe change-order allocation.';
comment on column public.change_order_allocations.idempotency_fingerprint is
  'Canonical request fingerprint used to reject reuse of an allocation key with different details.';

-- Direction is the sole economic authority. A zero owner side with a negative
-- cost side is a supported vendor-only credit; the inverse is an owner-only
-- credit. Mixed signs are never a valid single change order.
do $$
begin
  if exists (
    select 1
    from public.change_orders change_order
    where (
      change_order.financial_direction = 'credit'
      and (change_order.contract_amount > 0 or change_order.cost_amount > 0)
    ) or (
      change_order.financial_direction = 'addition'
      and (change_order.contract_amount < 0 or change_order.cost_amount < 0)
    )
  ) then
    raise exception using
      errcode = '23514',
      message = 'Change-order upgrade blocked: direction and signed financial values disagree.',
      hint = 'Resolve mixed-sign legacy economics before applying financial-integrity hardening.';
  end if;
end;
$$;

alter table public.change_orders
  drop constraint if exists change_orders_direction_signed_amounts_check;
alter table public.change_orders
  add constraint change_orders_direction_signed_amounts_check
  check (
    (
      financial_direction = 'credit'
      and contract_amount <= 0
      and cost_amount <= 0
    ) or (
      financial_direction = 'addition'
      and contract_amount >= 0
      and cost_amount >= 0
    )
  );

-- The browser and server keep cents in JavaScript numbers. Preserve one shared
-- upper bound at every database entry point so a direct RPC cannot create a
-- value that Postgres stores exactly but the application later rounds.
alter table public.change_orders
  drop constraint if exists change_orders_safe_cent_range_check;
alter table public.change_orders
  add constraint change_orders_safe_cent_range_check
  check (
    abs(contract_amount * 100) <= 9007199254740991
    and abs(cost_amount * 100) <= 9007199254740991
  );

alter table public.change_order_allocations
  drop constraint if exists change_order_allocations_safe_cent_range_check;
alter table public.change_order_allocations
  add constraint change_order_allocations_safe_cent_range_check
  check (
    abs(contract_amount * 100) <= 9007199254740991
    and abs(cost_amount * 100) <= 9007199254740991
  );

create or replace function public.validate_change_order_money_precision()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.contract_amount * 100 <> trunc(new.contract_amount * 100)
     or new.cost_amount * 100 <> trunc(new.cost_amount * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Change-order contract and cost values must be exact to the cent.';
  end if;
  if (new.financial_direction = 'credit'
      and (new.contract_amount > 0 or new.cost_amount > 0))
    or (new.financial_direction = 'addition'
      and (new.contract_amount < 0 or new.cost_amount < 0))
  then
    raise exception using
      errcode = '23514',
      message = 'Change-order direction and signed financial values must agree.';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_change_order_money_precision()
  from public, anon, authenticated, service_role;

drop trigger if exists change_orders_validate_money_precision
  on public.change_orders;
create trigger change_orders_validate_money_precision
  before insert or update of contract_amount, cost_amount, financial_direction
  on public.change_orders
  for each row execute function public.validate_change_order_money_precision();

-- p_paid_at defaults to null, not now(): a volatile default would stamp each
-- retry of the same lost command with a fresh timestamp and break the
-- idempotent-retry comparison below. An omitted paid_at still records now()
-- at insert time.
create or replace function public.record_invoice_payment_atomic(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_processor_fee_cents bigint default 0,
  p_overwatch_fee_cents bigint default 0,
  p_paid_at timestamptz default null,
  p_payment_method text default 'manual',
  p_processor text default 'manual',
  p_processor_payment_id text default '',
  p_reference text default '',
  p_notes text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice public.billing_invoices%rowtype;
  v_existing public.payment_ledger%rowtype;
  v_payment_id uuid;
  v_organization_id uuid;
  v_paid_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_status text := 'sent';
  v_application_previous_status text := '';
  v_inserted boolean := false;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to record an invoice payment.';
  end if;

  if p_amount_cents <= 0 then
    raise exception using errcode = '22023', message = 'Payment amount must be greater than zero.';
  end if;
  if p_processor_fee_cents < 0 or p_overwatch_fee_cents < 0 then
    raise exception using errcode = '22023', message = 'Payment fees cannot be negative.';
  end if;
  if p_processor_fee_cents + p_overwatch_fee_cents > p_amount_cents then
    raise exception using errcode = '22023', message = 'Payment fees cannot exceed the payment amount.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null then
    raise exception using errcode = '22023', message = 'A payment idempotency key is required.';
  end if;
  if length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'Payment idempotency key is too long.';
  end if;
  if length(coalesce(p_payment_method, '')) > 100
    or length(coalesce(p_processor, '')) > 100
    or length(coalesce(p_processor_payment_id, '')) > 200
    or length(coalesce(p_reference, '')) > 200
    or length(coalesce(p_notes, '')) > 4000
  then
    raise exception using errcode = '22023', message = 'Payment details exceed their allowed length.';
  end if;

  -- Serializes every payment/retry for one invoice. The ledger insert, invoice
  -- rollup, pay-app rollup, and lifecycle event all commit or all roll back.
  select *
    into v_invoice
  from public.billing_invoices
  where id = p_invoice_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found.';
  end if;
  if not public.can_manage_project(v_invoice.project_id) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to record payments for this project.';
  end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = '22023', message = 'A void invoice cannot receive a payment.';
  end if;

  select organization_id
    into v_organization_id
  from public.projects
  where id = v_invoice.project_id;

  insert into public.payment_ledger (
    project_id,
    invoice_id,
    billing_application_id,
    amount,
    amount_cents,
    currency,
    organization_id,
    processor_fee,
    overwatch_fee,
    net_payout,
    payment_method,
    processor,
    processor_payment_id,
    reference,
    status,
    paid_at,
    notes,
    idempotency_key,
    created_by
  ) values (
    v_invoice.project_id,
    v_invoice.id,
    v_invoice.billing_application_id,
    p_amount_cents / 100.0,
    p_amount_cents,
    'usd',
    v_organization_id,
    p_processor_fee_cents / 100.0,
    p_overwatch_fee_cents / 100.0,
    greatest(0, p_amount_cents - p_processor_fee_cents - p_overwatch_fee_cents) / 100.0,
    coalesce(nullif(btrim(p_payment_method), ''), 'manual'),
    coalesce(nullif(btrim(p_processor), ''), 'manual'),
    coalesce(p_processor_payment_id, ''),
    coalesce(p_reference, ''),
    'succeeded',
    coalesce(p_paid_at, now()),
    coalesce(p_notes, ''),
    btrim(p_idempotency_key),
    auth.uid()
  )
  on conflict (invoice_id, idempotency_key)
    where idempotency_key is not null
  do nothing
  returning id into v_payment_id;

  v_inserted := v_payment_id is not null;

  if not v_inserted then
    select *
      into v_existing
    from public.payment_ledger
    where invoice_id = v_invoice.id
      and idempotency_key = btrim(p_idempotency_key)
    for update;

    if not found then
      raise exception using
        errcode = '40001',
        message = 'The payment retry could not be reconciled. Please retry.';
    end if;

    -- Reusing a key with different money or provenance is an error, never an
    -- accidental acknowledgement of a different payment. An absent paid_at is
    -- normalized to the null sentinel: the retry acknowledges whatever
    -- server-defaulted timestamp the committed receipt already carries.
    if coalesce(nullif(v_existing.amount_cents, 0), round(v_existing.amount * 100)::bigint)
         <> p_amount_cents
      or round(v_existing.processor_fee * 100)::bigint <> p_processor_fee_cents
      or round(v_existing.overwatch_fee * 100)::bigint <> p_overwatch_fee_cents
      or v_existing.payment_method <> coalesce(nullif(btrim(p_payment_method), ''), 'manual')
      or v_existing.processor <> coalesce(nullif(btrim(p_processor), ''), 'manual')
      or v_existing.processor_payment_id <> coalesce(p_processor_payment_id, '')
      or v_existing.reference <> coalesce(p_reference, '')
      or v_existing.notes <> coalesce(p_notes, '')
      or (p_paid_at is not null and v_existing.paid_at is distinct from p_paid_at)
    then
      raise exception using
        errcode = '22023',
        message = 'This payment idempotency key was already used for different payment details.';
    end if;

    v_payment_id := v_existing.id;
  end if;

  select coalesce(
           sum(coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)),
           0
         )::bigint
    into v_paid_cents
  from public.payment_ledger
  where invoice_id = v_invoice.id
    and status = 'succeeded';

  v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
  v_status := case
    when v_total_due_cents > 0 and v_paid_cents >= v_total_due_cents then 'paid'
    when v_paid_cents > 0 then 'partially_paid'
    else 'sent'
  end;

  update public.billing_invoices
  set paid_amount = v_paid_cents / 100.0,
      status = v_status,
      paid_at = case
        when v_status = 'paid' then coalesce(v_invoice.paid_at, p_paid_at, now())
        else null
      end
  where id = v_invoice.id;

  if v_invoice.billing_application_id is not null then
    select status
      into v_application_previous_status
    from public.billing_applications
    where id = v_invoice.billing_application_id
    for update;

    if not found then
      raise exception using
        errcode = 'P0002',
        message = 'The invoice pay application no longer exists.';
    end if;

    update public.billing_applications
    set paid_to_date = v_paid_cents / 100.0,
        status = case when v_status = 'paid' then 'paid' else 'partial' end
    where id = v_invoice.billing_application_id;

    -- A network retry returns the original result without duplicating the
    -- lifecycle event.
    if v_inserted then
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
        v_invoice.billing_application_id,
        v_invoice.project_id,
        'payment_update',
        coalesce(v_application_previous_status, ''),
        case when v_status = 'paid' then 'paid' else 'partial' end,
        v_paid_cents / 100.0,
        'Invoice payment recorded: ' || coalesce(nullif(p_notes, ''), 'manual payment'),
        auth.uid()
      );
    end if;
  end if;

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'paidAmount', v_paid_cents / 100.0,
    'status', v_status,
    'deduplicated', not v_inserted
  );
end;
$$;

revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public;
revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from anon;
revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from service_role;
grant execute on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) to authenticated, service_role;

create or replace function public.validate_change_order_allocation_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_change_order public.change_orders%rowtype;
  v_bucket_project_id uuid;
  v_bucket_cost_code text;
  v_existing_contract_cents bigint := 0;
  v_existing_cost_cents bigint := 0;
  v_contract_cap_cents bigint := 0;
  v_cost_cap_cents bigint := 0;
  v_new_contract_cents bigint := 0;
  v_new_cost_cents bigint := 0;
  v_is_credit boolean := false;
begin
  select *
    into v_change_order
  from public.change_orders
  where id = new.change_order_id
  for update;

  if not found then
    raise exception using errcode = '23503', message = 'Change order not found.';
  end if;
  if current_user not in ('postgres', 'service_role')
     and not public.can_manage_project(v_change_order.project_id)
  then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to allocate this change order.';
  end if;
  if v_change_order.project_id <> new.project_id then
    raise exception using errcode = '23514', message = 'Change order and allocation project do not match.';
  end if;
  if v_change_order.status <> 'Approved' then
    raise exception using
      errcode = '23514',
      message = 'Only an approved change order can be allocated.';
  end if;

  select project_id, cost_code
    into v_bucket_project_id, v_bucket_cost_code
  from public.cost_buckets
  where id = new.cost_bucket_id;

  if not found or v_bucket_project_id <> new.project_id then
    raise exception using errcode = '23514', message = 'Cost code not found on this project.';
  end if;

  v_is_credit := v_change_order.financial_direction = 'credit';
  if new.contract_amount * 100 <> trunc(new.contract_amount * 100)
     or new.cost_amount * 100 <> trunc(new.cost_amount * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Allocation contract and cost values must be exact to the cent.';
  end if;
  if abs(new.contract_amount * 100) > 9007199254740991
     or abs(new.cost_amount * 100) > 9007199254740991
  then
    raise exception using
      errcode = '22003',
      message = 'Allocation value exceeds the supported accounting range.';
  end if;
  v_new_contract_cents := round(new.contract_amount * 100)::bigint;
  v_new_cost_cents := round(new.cost_amount * 100)::bigint;

  if v_is_credit and (v_new_contract_cents > 0 or v_new_cost_cents > 0) then
    raise exception using errcode = '23514', message = 'Credit allocations must be zero or negative.';
  end if;
  if not v_is_credit and (v_new_contract_cents < 0 or v_new_cost_cents < 0) then
    raise exception using errcode = '23514', message = 'Additive allocations must be zero or positive.';
  end if;
  if v_new_contract_cents = 0 and v_new_cost_cents = 0 then
    raise exception using errcode = '23514', message = 'An allocation must include contract or cost value.';
  end if;

  select
    coalesce(sum(abs(round(contract_amount * 100)::bigint)), 0)::bigint,
    coalesce(sum(abs(round(cost_amount * 100)::bigint)), 0)::bigint
  into v_existing_contract_cents, v_existing_cost_cents
  from public.change_order_allocations
  where change_order_id = new.change_order_id
    and (tg_op = 'INSERT' or id <> new.id);

  v_contract_cap_cents := abs(round(v_change_order.contract_amount * 100)::bigint);
  v_cost_cap_cents := abs(round(v_change_order.cost_amount * 100)::bigint);

  if v_existing_contract_cents + abs(v_new_contract_cents) > v_contract_cap_cents then
    raise exception using
      errcode = '23514',
      message = 'Contract allocation exceeds the approved change-order contract value.';
  end if;
  if v_existing_cost_cents + abs(v_new_cost_cents) > v_cost_cap_cents then
    raise exception using
      errcode = '23514',
      message = 'Cost allocation exceeds the approved change-order cost value.';
  end if;

  new.cost_code := coalesce(v_bucket_cost_code, '');
  return new;
end;
$$;

revoke all on function public.validate_change_order_allocation_integrity()
  from public;
revoke all on function public.validate_change_order_allocation_integrity()
  from anon;
revoke all on function public.validate_change_order_allocation_integrity()
  from authenticated;
revoke all on function public.validate_change_order_allocation_integrity()
  from service_role;

drop trigger if exists change_order_allocations_validate_integrity
  on public.change_order_allocations;
create trigger change_order_allocations_validate_integrity
  before insert or update
  on public.change_order_allocations
  for each row execute function public.validate_change_order_allocation_integrity();

create or replace function public.protect_change_order_allocation_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_atomic_write text := coalesce(
    current_setting('overwatch.change_order_allocation_write', true),
    ''
  );
begin
  if tg_op = 'INSERT' then
    if v_atomic_write <> 'inserting' then
      raise exception using
        errcode = '23514',
        message = 'Change-order allocations must be created through the atomic allocation command.';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'Change-order allocations are immutable. Remove an uncaptured allocation and create a corrected one.';
  end if;

  if v_atomic_write <> 'deleting' then
    raise exception using
      errcode = '23514',
      message = 'Change-order allocations must be removed through the atomic allocation command.';
  end if;

  if exists (
    select 1
    from public.billing_line_change_order_allocations snapshot
    where snapshot.change_order_allocation_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'This allocation is already part of a billing snapshot and cannot be removed.';
  end if;

  return old;
end;
$$;

revoke all on function public.protect_change_order_allocation_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists change_order_allocations_protect_authority
  on public.change_order_allocations;
create trigger change_order_allocations_protect_authority
  before insert or update or delete
  on public.change_order_allocations
  for each row execute function public.protect_change_order_allocation_authority();

-- An allocation cannot remain valid if its parent CO is later de-approved,
-- changes financial direction, or is reduced below the amount already
-- allocated. Protect the parent mutation as well as allocation writes.
create or replace function public.validate_allocated_change_order_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allocation_count integer := 0;
  v_contract_allocated_cents bigint := 0;
  v_cost_allocated_cents bigint := 0;
  v_has_positive_contract boolean := false;
  v_has_negative_contract boolean := false;
  v_has_positive_cost boolean := false;
  v_has_negative_cost boolean := false;
  v_is_credit boolean := false;
begin
  select
    count(*)::integer,
    coalesce(sum(abs(round(contract_amount * 100)::bigint)), 0)::bigint,
    coalesce(sum(abs(round(cost_amount * 100)::bigint)), 0)::bigint,
    coalesce(bool_or(round(contract_amount * 100)::bigint > 0), false),
    coalesce(bool_or(round(contract_amount * 100)::bigint < 0), false),
    coalesce(bool_or(round(cost_amount * 100)::bigint > 0), false),
    coalesce(bool_or(round(cost_amount * 100)::bigint < 0), false)
  into
    v_allocation_count,
    v_contract_allocated_cents,
    v_cost_allocated_cents,
    v_has_positive_contract,
    v_has_negative_contract,
    v_has_positive_cost,
    v_has_negative_cost
  from public.change_order_allocations
  where change_order_id = old.id;

  -- Once approved, a change order is financial history even before allocation.
  -- Corrections belong in a new offsetting change order, not a rewritten row.
  if old.status = 'Approved' and (
    new.status is distinct from old.status
    or new.financial_direction is distinct from old.financial_direction
    or new.contract_amount is distinct from old.contract_amount
    or new.cost_amount is distinct from old.cost_amount
  ) then
    raise exception using
      errcode = '23514',
      message = 'An approved change order is immutable. Create an offsetting correction instead.';
  end if;

  if v_allocation_count = 0 then
    return new;
  end if;

  if new.status <> 'Approved' then
    raise exception using
      errcode = '23514',
      message = 'Remove this change order from billing before changing it from Approved.';
  end if;

  v_is_credit := new.financial_direction = 'credit';

  if v_is_credit and (v_has_positive_contract or v_has_positive_cost) then
    raise exception using
      errcode = '23514',
      message = 'Allocated additions cannot be converted to a credit.';
  end if;
  if not v_is_credit and (v_has_negative_contract or v_has_negative_cost) then
    raise exception using
      errcode = '23514',
      message = 'Allocated credits cannot be converted to an addition.';
  end if;
  if v_contract_allocated_cents > abs(round(new.contract_amount * 100)::bigint) then
    raise exception using
      errcode = '23514',
      message = 'The change-order contract value cannot be reduced below its allocated amount.';
  end if;
  if v_cost_allocated_cents > abs(round(new.cost_amount * 100)::bigint) then
    raise exception using
      errcode = '23514',
      message = 'The change-order cost value cannot be reduced below its allocated amount.';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_allocated_change_order_update()
  from public, anon, authenticated, service_role;

drop trigger if exists change_orders_validate_allocated_update on public.change_orders;
create trigger change_orders_validate_allocated_update
  before update of status, financial_direction, contract_amount, cost_amount
  on public.change_orders
  for each row execute function public.validate_allocated_change_order_update();

create or replace function public.prevent_allocated_change_order_delete()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if old.status = 'Approved' then
    raise exception using
      errcode = '23514',
      message = 'An approved change order is immutable. Create an offsetting correction instead.';
  end if;
  if exists (
    select 1
    from public.change_order_allocations allocation
    where allocation.change_order_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'An allocated change order is a financial record and cannot be deleted.';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_allocated_change_order_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists change_orders_prevent_allocated_delete on public.change_orders;
create trigger change_orders_prevent_allocated_delete
  before delete on public.change_orders
  for each row execute function public.prevent_allocated_change_order_delete();

create or replace function public.allocate_change_order_atomic(
  p_project_id uuid,
  p_change_order_id uuid,
  p_cost_bucket_id uuid,
  p_contract_amount_cents bigint,
  p_cost_amount_cents bigint default 0,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_change_order public.change_orders%rowtype;
  v_bucket record;
  v_allocation public.change_order_allocations%rowtype;
  v_existing public.change_order_allocations%rowtype;
  v_sign integer := 1;
  v_idempotency_key text := btrim(coalesce(p_idempotency_key, ''));
  v_idempotency_fingerprint text;
  v_previous_atomic_write text :=
    current_setting('overwatch.change_order_allocation_write', true);
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to allocate a change order.';
  end if;
  if p_contract_amount_cents is null or p_cost_amount_cents is null
    or p_contract_amount_cents < 0 or p_cost_amount_cents < 0
    or p_contract_amount_cents > 9007199254740991
    or p_cost_amount_cents > 9007199254740991
  then
    raise exception using
      errcode = '22003',
      message = 'Enter allocation values within the supported positive-cent accounting range; credits are signed automatically.';
  end if;
  if p_contract_amount_cents = 0 and p_cost_amount_cents = 0 then
    raise exception using
      errcode = '22023',
      message = 'An allocation must include contract or cost value.';
  end if;
  if v_idempotency_key = '' or length(v_idempotency_key) > 200 then
    raise exception using
      errcode = '22023',
      message = 'A valid allocation idempotency key is required.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to allocate change orders for this project.';
  end if;

  select *
    into v_change_order
  from public.change_orders
  where id = p_change_order_id
    and project_id = p_project_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found on this project.';
  end if;
  if v_change_order.status <> 'Approved' then
    raise exception using
      errcode = '23514',
      message = 'Only an approved change order can be allocated.';
  end if;

  v_idempotency_fingerprint := md5(jsonb_build_array(
    p_project_id,
    p_change_order_id,
    p_cost_bucket_id,
    p_contract_amount_cents,
    p_cost_amount_cents
  )::text);

  select *
    into v_existing
  from public.change_order_allocations
  where change_order_id = p_change_order_id
    and idempotency_key = v_idempotency_key
  for update;

  if found then
    if v_existing.idempotency_fingerprint is distinct from v_idempotency_fingerprint then
      raise exception using
        errcode = '22023',
        message = 'This allocation idempotency key was already used for different details.';
    end if;
    return jsonb_build_object(
      'allocationId', v_existing.id,
      'contractAmount', v_existing.contract_amount,
      'costAmount', v_existing.cost_amount,
      'deduplicated', true
    );
  end if;

  select id, project_id, cost_code, bucket
    into v_bucket
  from public.cost_buckets
  where id = p_cost_bucket_id
    and project_id = p_project_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Cost code not found on this project.';
  end if;

  if v_change_order.financial_direction = 'credit' then
    v_sign := -1;
  end if;

  perform set_config('overwatch.change_order_allocation_write', 'inserting', true);
  insert into public.change_order_allocations (
    project_id,
    change_order_id,
    cost_bucket_id,
    cost_code,
    description,
    contract_amount,
    cost_amount,
    idempotency_key,
    idempotency_fingerprint
  ) values (
    p_project_id,
    p_change_order_id,
    p_cost_bucket_id,
    coalesce(v_bucket.cost_code, ''),
    concat_ws(' - ', coalesce(nullif(v_change_order.number, ''), 'CO'), nullif(v_change_order.description, '')),
    v_sign * p_contract_amount_cents / 100.0,
    v_sign * p_cost_amount_cents / 100.0,
    v_idempotency_key,
    v_idempotency_fingerprint
  )
  returning * into v_allocation;
  perform set_config(
    'overwatch.change_order_allocation_write',
    coalesce(v_previous_atomic_write, ''),
    true
  );

  return jsonb_build_object(
    'allocationId', v_allocation.id,
    'contractAmount', v_allocation.contract_amount,
    'costAmount', v_allocation.cost_amount,
    'deduplicated', false
  );
end;
$$;

create or replace function public.delete_change_order_allocation_atomic(
  p_allocation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_change_order_id uuid;
  v_allocation public.change_order_allocations%rowtype;
  v_previous_atomic_write text :=
    current_setting('overwatch.change_order_allocation_write', true);
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to remove a change-order allocation.';
  end if;

  select allocation.project_id, allocation.change_order_id
  into v_project_id, v_change_order_id
  from public.change_order_allocations allocation
  where allocation.id = p_allocation_id;

  if not found then
    return jsonb_build_object('ok', true, 'deleted', false, 'deduplicated', true);
  end if;

  if not public.can_manage_project(v_project_id) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to remove this change-order allocation.';
  end if;

  perform 1
  from public.change_orders change_order
  where change_order.id = v_change_order_id
    and change_order.project_id = v_project_id
  for update;

  select *
  into v_allocation
  from public.change_order_allocations allocation
  where allocation.id = p_allocation_id
  for update;

  if not found then
    return jsonb_build_object('ok', true, 'deleted', false, 'deduplicated', true);
  end if;

  if exists (
    select 1
    from public.billing_line_change_order_allocations snapshot
    where snapshot.change_order_allocation_id = p_allocation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'This allocation is already part of a billing snapshot and cannot be removed.';
  end if;

  perform set_config('overwatch.change_order_allocation_write', 'deleting', true);
  delete from public.change_order_allocations
  where id = p_allocation_id;
  perform set_config(
    'overwatch.change_order_allocation_write',
    coalesce(v_previous_atomic_write, ''),
    true
  );

  return jsonb_build_object('ok', true, 'deleted', true, 'deduplicated', false);
end;
$$;

revoke all on function public.allocate_change_order_atomic(uuid, uuid, uuid, bigint, bigint, text)
  from public;
revoke all on function public.allocate_change_order_atomic(uuid, uuid, uuid, bigint, bigint, text)
  from anon;
revoke all on function public.allocate_change_order_atomic(uuid, uuid, uuid, bigint, bigint, text)
  from service_role;
grant execute on function public.allocate_change_order_atomic(uuid, uuid, uuid, bigint, bigint, text)
  to authenticated, service_role;

revoke all on function public.delete_change_order_allocation_atomic(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_change_order_allocation_atomic(uuid)
  to authenticated, service_role;

revoke insert, update, delete on public.change_order_allocations
  from authenticated, service_role;

-- A change order changes both contract and forecast economics. Treat every
-- create/edit/delete as a database command, not a collection of browser-side
-- writes. The operation journal makes retries deterministic and gives stale
-- editors an explicit conflict instead of silently overwriting newer work.
create table if not exists public.change_order_operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  change_order_id uuid,
  operation_key text not null,
  operation_type text not null
    check (operation_type in ('create', 'update', 'delete')),
  request_fingerprint jsonb not null,
  result jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, operation_key)
);

alter table public.change_order_operations enable row level security;
revoke all on public.change_order_operations
  from public, anon, authenticated, service_role;

create or replace function public.protect_change_order_command_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_mode text := coalesce(current_setting('overwatch.change_order_write', true), '');
  v_link_mode text := coalesce(current_setting('overwatch.change_order_link_write', true), '');
begin
  if tg_op = 'INSERT' then
    if v_mode <> 'creating' then
      raise exception using
        errcode = '23514',
        message = 'Change orders must be created through the atomic change-order command.';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if v_mode <> 'deleting' then
      raise exception using
        errcode = '23514',
        message = 'Change orders must be removed through the atomic change-order command.';
    end if;
    return old;
  end if;

  -- Client-sharing state remains mutable reference metadata. Every field that
  -- defines the financial record itself must use the atomic command; the
  -- relationship pointers are separately guarded by the link mode below.
  if (
    new.project_id is distinct from old.project_id
    or new.number is distinct from old.number
    or new.description is distinct from old.description
    or new.contract_amount is distinct from old.contract_amount
    or new.cost_amount is distinct from old.cost_amount
    or new.financial_direction is distinct from old.financial_direction
    or new.status is distinct from old.status
    or new.probability is distinct from old.probability
    or new.owner is distinct from old.owner
    or new.notes is distinct from old.notes
    or new.co_type is distinct from old.co_type
    or new.pricing_method is distinct from old.pricing_method
    or new.schedule_impact_days is distinct from old.schedule_impact_days
    or new.requested_by is distinct from old.requested_by
    or new.date_initiated is distinct from old.date_initiated
    or new.created_at is distinct from old.created_at
  ) and v_mode <> 'updating' then
    raise exception using
      errcode = '23514',
      message = 'Change-order financial details must be edited through the atomic change-order command.';
  end if;

  -- The link FKs are ON DELETE SET NULL: deleting an exposure/claim fires a
  -- system UPDATE that detaches the pointer. That referential detach runs
  -- inside the RI trigger (pg_trigger_depth() > 1) and only moves the link to
  -- null — admit exactly that; every direct link edit stays command-only.
  if (
    new.linked_exposure_id is distinct from old.linked_exposure_id
    or new.linked_claim_id is distinct from old.linked_claim_id
  ) and v_link_mode <> 'linking'
    and not (
      pg_trigger_depth() > 1
      and (
        new.linked_exposure_id is null
        or new.linked_exposure_id is not distinct from old.linked_exposure_id
      )
      and (
        new.linked_claim_id is null
        or new.linked_claim_id is not distinct from old.linked_claim_id
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Change-order risk and claim links must be edited through an atomic link command.';
  end if;

  return new;
end;
$$;

revoke all on function public.protect_change_order_command_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists change_orders_protect_command_authority on public.change_orders;
create trigger change_orders_protect_command_authority
  before insert or update or delete on public.change_orders
  for each row execute function public.protect_change_order_command_authority();

-- Freeze the complete business record once it reaches a final decision. Client
-- sharing metadata and cross-module pointers may still advance independently.
create or replace function public.validate_allocated_change_order_update()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_allocation_count integer := 0;
  v_contract_allocated_cents bigint := 0;
  v_cost_allocated_cents bigint := 0;
  v_has_positive_contract boolean := false;
  v_has_negative_contract boolean := false;
  v_has_positive_cost boolean := false;
  v_has_negative_cost boolean := false;
  v_is_credit boolean := false;
begin
  select
    count(*)::integer,
    coalesce(sum(abs(round(contract_amount * 100)::bigint)), 0)::bigint,
    coalesce(sum(abs(round(cost_amount * 100)::bigint)), 0)::bigint,
    coalesce(bool_or(round(contract_amount * 100)::bigint > 0), false),
    coalesce(bool_or(round(contract_amount * 100)::bigint < 0), false),
    coalesce(bool_or(round(cost_amount * 100)::bigint > 0), false),
    coalesce(bool_or(round(cost_amount * 100)::bigint < 0), false)
  into
    v_allocation_count,
    v_contract_allocated_cents,
    v_cost_allocated_cents,
    v_has_positive_contract,
    v_has_negative_contract,
    v_has_positive_cost,
    v_has_negative_cost
  from public.change_order_allocations
  where change_order_id = old.id;

  if old.status in ('Approved', 'Denied') and (
    new.number is distinct from old.number
    or new.description is distinct from old.description
    or new.contract_amount is distinct from old.contract_amount
    or new.cost_amount is distinct from old.cost_amount
    or new.financial_direction is distinct from old.financial_direction
    or new.status is distinct from old.status
    or new.probability is distinct from old.probability
    or new.owner is distinct from old.owner
    or new.notes is distinct from old.notes
    or new.co_type is distinct from old.co_type
    or new.pricing_method is distinct from old.pricing_method
    or new.schedule_impact_days is distinct from old.schedule_impact_days
    or new.requested_by is distinct from old.requested_by
    or new.date_initiated is distinct from old.date_initiated
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'A finalized change order is immutable. Create an offsetting correction instead.';
  end if;

  if v_allocation_count = 0 then
    return new;
  end if;
  if new.status <> 'Approved' then
    raise exception using
      errcode = '23514',
      message = 'Remove this change order from billing before changing it from Approved.';
  end if;

  v_is_credit := new.financial_direction = 'credit';
  if v_is_credit and (v_has_positive_contract or v_has_positive_cost) then
    raise exception using errcode = '23514', message = 'Allocated additions cannot be converted to a credit.';
  end if;
  if not v_is_credit and (v_has_negative_contract or v_has_negative_cost) then
    raise exception using errcode = '23514', message = 'Allocated credits cannot be converted to an addition.';
  end if;
  if v_contract_allocated_cents > abs(round(new.contract_amount * 100)::bigint) then
    raise exception using
      errcode = '23514',
      message = 'The change-order contract value cannot be reduced below its allocated amount.';
  end if;
  if v_cost_allocated_cents > abs(round(new.cost_amount * 100)::bigint) then
    raise exception using
      errcode = '23514',
      message = 'The change-order cost value cannot be reduced below its allocated amount.';
  end if;

  return new;
end;
$$;

drop trigger if exists change_orders_validate_allocated_update on public.change_orders;
create trigger change_orders_validate_allocated_update
  before update on public.change_orders
  for each row execute function public.validate_allocated_change_order_update();

create or replace function public.create_change_order_atomic(
  p_project_id uuid,
  p_number text,
  p_description text,
  p_contract_amount_cents bigint,
  p_cost_amount_cents bigint,
  p_financial_direction text,
  p_status text,
  p_probability numeric,
  p_owner text,
  p_notes text,
  p_co_type text,
  p_pricing_method text,
  p_schedule_impact_days integer,
  p_requested_by text,
  p_date_initiated date,
  p_operation_key text,
  p_requested_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_operation_key, ''));
  v_fingerprint jsonb;
  v_existing public.change_order_operations%rowtype;
  v_change_order public.change_orders%rowtype;
  v_sign integer := case when p_financial_direction = 'credit' then -1 else 1 end;
  v_previous_mode text := current_setting('overwatch.change_order_write', true);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create a change order.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create change orders for this project.';
  end if;
  if v_key = '' or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid change-order operation key is required.';
  end if;
  if p_contract_amount_cents is null or p_cost_amount_cents is null
    or p_contract_amount_cents < 0 or p_cost_amount_cents < 0
    or p_contract_amount_cents > 9007199254740991
    or p_cost_amount_cents > 9007199254740991
  then
    raise exception using errcode = '22003', message = 'Enter change-order values within the supported positive-cent accounting range; credits are signed automatically.';
  end if;
  if p_financial_direction not in ('addition', 'credit')
    or p_status not in ('Approved', 'Pending', 'Denied')
    or p_co_type not in ('owner_change', 'design_error', 'design_omission', 'unforeseen_condition', 'missed_scope', 'sub_issued', 'other')
    or p_pricing_method not in ('lump_sum', 'time_and_materials', 'unit_price', 'allowance', 'other')
  then
    raise exception using errcode = '22023', message = 'Change-order classification is invalid.';
  end if;
  if p_probability < 0 or p_probability > 100
    or p_schedule_impact_days < 0 or p_schedule_impact_days > 36500
  then
    raise exception using errcode = '22023', message = 'Change-order probability or schedule impact is out of range.';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null
    or length(p_description) > 500
    or length(coalesce(p_number, '')) > 50
    or length(coalesce(p_owner, '')) > 200
    or length(coalesce(p_notes, '')) > 2000
    or length(coalesce(p_requested_by, '')) > 200
  then
    raise exception using errcode = '22023', message = 'Change-order details are missing or exceed their allowed length.';
  end if;

  perform 1 from public.projects where id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;

  v_fingerprint := jsonb_build_object(
    'requestedId', p_requested_id,
    'number', coalesce(p_number, ''),
    'description', p_description,
    'contractAmountCents', p_contract_amount_cents,
    'costAmountCents', p_cost_amount_cents,
    'financialDirection', p_financial_direction,
    'status', p_status,
    'probability', p_probability,
    'owner', coalesce(p_owner, ''),
    'notes', coalesce(p_notes, ''),
    'coType', p_co_type,
    'pricingMethod', p_pricing_method,
    'scheduleImpactDays', p_schedule_impact_days,
    'requestedBy', coalesce(p_requested_by, ''),
    'dateInitiated', p_date_initiated
  );

  select * into v_existing
  from public.change_order_operations
  where project_id = p_project_id and operation_key = v_key
  for update;
  if found then
    if v_existing.operation_type <> 'create'
      or v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This change-order operation key was already used for different details.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  perform set_config('overwatch.change_order_write', 'creating', true);
  insert into public.change_orders (
    id, project_id, number, description, contract_amount, cost_amount,
    financial_direction, status, probability, owner, notes, co_type,
    pricing_method, schedule_impact_days, requested_by, date_initiated
  ) values (
    coalesce(p_requested_id, gen_random_uuid()), p_project_id, coalesce(p_number, ''),
    p_description, v_sign * p_contract_amount_cents / 100.0,
    v_sign * p_cost_amount_cents / 100.0, p_financial_direction, p_status,
    p_probability, coalesce(p_owner, ''), coalesce(p_notes, ''), p_co_type,
    p_pricing_method, p_schedule_impact_days, coalesce(p_requested_by, ''), p_date_initiated
  ) returning * into v_change_order;
  perform set_config('overwatch.change_order_write', coalesce(v_previous_mode, ''), true);

  v_result := jsonb_build_object(
    'changeOrderId', v_change_order.id,
    'updatedAt', v_change_order.updated_at,
    'deduplicated', false
  );
  insert into public.change_order_operations (
    project_id, change_order_id, operation_key, operation_type,
    request_fingerprint, result, created_by
  ) values (
    p_project_id, v_change_order.id, v_key, 'create', v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.update_change_order_atomic(
  p_project_id uuid,
  p_change_order_id uuid,
  p_expected_updated_at timestamptz,
  p_number text,
  p_description text,
  p_contract_amount_cents bigint,
  p_cost_amount_cents bigint,
  p_financial_direction text,
  p_status text,
  p_probability numeric,
  p_owner text,
  p_notes text,
  p_co_type text,
  p_pricing_method text,
  p_schedule_impact_days integer,
  p_requested_by text,
  p_date_initiated date,
  p_operation_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_operation_key, ''));
  v_fingerprint jsonb;
  v_existing public.change_order_operations%rowtype;
  v_change_order public.change_orders%rowtype;
  v_sign integer := case when p_financial_direction = 'credit' then -1 else 1 end;
  v_previous_mode text := current_setting('overwatch.change_order_write', true);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to edit a change order.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit change orders for this project.';
  end if;
  if v_key = '' or length(v_key) > 200 or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'A valid operation key and record version are required.';
  end if;
  if p_contract_amount_cents is null or p_cost_amount_cents is null
    or p_contract_amount_cents < 0 or p_cost_amount_cents < 0
    or p_contract_amount_cents > 9007199254740991
    or p_cost_amount_cents > 9007199254740991
  then
    raise exception using errcode = '22003', message = 'Enter change-order values within the supported positive-cent accounting range; credits are signed automatically.';
  end if;
  if p_financial_direction not in ('addition', 'credit')
    or p_status not in ('Approved', 'Pending', 'Denied')
    or p_co_type not in ('owner_change', 'design_error', 'design_omission', 'unforeseen_condition', 'missed_scope', 'sub_issued', 'other')
    or p_pricing_method not in ('lump_sum', 'time_and_materials', 'unit_price', 'allowance', 'other')
    or p_probability < 0 or p_probability > 100
    or p_schedule_impact_days < 0 or p_schedule_impact_days > 36500
  then
    raise exception using errcode = '22023', message = 'Change-order values or classification are invalid.';
  end if;
  if nullif(btrim(coalesce(p_description, '')), '') is null
    or length(p_description) > 500
    or length(coalesce(p_number, '')) > 50
    or length(coalesce(p_owner, '')) > 200
    or length(coalesce(p_notes, '')) > 2000
    or length(coalesce(p_requested_by, '')) > 200
  then
    raise exception using errcode = '22023', message = 'Change-order details are missing or exceed their allowed length.';
  end if;

  perform 1 from public.projects where id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;

  v_fingerprint := jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'expectedUpdatedAt', p_expected_updated_at,
    'number', coalesce(p_number, ''),
    'description', p_description,
    'contractAmountCents', p_contract_amount_cents,
    'costAmountCents', p_cost_amount_cents,
    'financialDirection', p_financial_direction,
    'status', p_status,
    'probability', p_probability,
    'owner', coalesce(p_owner, ''),
    'notes', coalesce(p_notes, ''),
    'coType', p_co_type,
    'pricingMethod', p_pricing_method,
    'scheduleImpactDays', p_schedule_impact_days,
    'requestedBy', coalesce(p_requested_by, ''),
    'dateInitiated', p_date_initiated
  );

  select * into v_existing
  from public.change_order_operations
  where project_id = p_project_id and operation_key = v_key
  for update;
  if found then
    if v_existing.operation_type <> 'update'
      or v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This change-order operation key was already used for different details.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select * into v_change_order
  from public.change_orders
  where id = p_change_order_id and project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found on this project.';
  end if;
  if v_change_order.updated_at is distinct from p_expected_updated_at then
    raise exception using
      errcode = '40001',
      message = 'This change order changed after you opened it. Refresh before saving.';
  end if;

  perform set_config('overwatch.change_order_write', 'updating', true);
  update public.change_orders
  set number = coalesce(p_number, ''),
      description = p_description,
      contract_amount = v_sign * p_contract_amount_cents / 100.0,
      cost_amount = v_sign * p_cost_amount_cents / 100.0,
      financial_direction = p_financial_direction,
      status = p_status,
      probability = p_probability,
      owner = coalesce(p_owner, ''),
      notes = coalesce(p_notes, ''),
      co_type = p_co_type,
      pricing_method = p_pricing_method,
      schedule_impact_days = p_schedule_impact_days,
      requested_by = coalesce(p_requested_by, ''),
      date_initiated = p_date_initiated
  where id = p_change_order_id
  returning * into v_change_order;
  perform set_config('overwatch.change_order_write', coalesce(v_previous_mode, ''), true);

  v_result := jsonb_build_object(
    'changeOrderId', v_change_order.id,
    'updatedAt', v_change_order.updated_at,
    'deduplicated', false
  );
  insert into public.change_order_operations (
    project_id, change_order_id, operation_key, operation_type,
    request_fingerprint, result, created_by
  ) values (
    p_project_id, v_change_order.id, v_key, 'update', v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.delete_change_order_atomic(
  p_project_id uuid,
  p_change_order_id uuid,
  p_expected_updated_at timestamptz,
  p_operation_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_key text := btrim(coalesce(p_operation_key, ''));
  v_fingerprint jsonb;
  v_existing public.change_order_operations%rowtype;
  v_change_order public.change_orders%rowtype;
  v_previous_mode text := current_setting('overwatch.change_order_write', true);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to remove a change order.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to remove change orders for this project.';
  end if;
  if v_key = '' or length(v_key) > 200 or p_expected_updated_at is null then
    raise exception using errcode = '22023', message = 'A valid operation key and record version are required.';
  end if;

  perform 1 from public.projects where id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  v_fingerprint := jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'expectedUpdatedAt', p_expected_updated_at
  );

  select * into v_existing
  from public.change_order_operations
  where project_id = p_project_id and operation_key = v_key
  for update;
  if found then
    if v_existing.operation_type <> 'delete'
      or v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This change-order operation key was already used for different details.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  select * into v_change_order
  from public.change_orders
  where id = p_change_order_id and project_id = p_project_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found on this project.';
  end if;
  if v_change_order.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = '40001', message = 'This change order changed after you opened it. Refresh before deleting.';
  end if;
  if v_change_order.status <> 'Pending' then
    raise exception using
      errcode = '23514',
      message = 'Approved or denied change orders are finalized financial history. Create a correction instead.';
  end if;

  perform set_config('overwatch.change_order_write', 'deleting', true);
  delete from public.change_orders where id = p_change_order_id;
  perform set_config('overwatch.change_order_write', coalesce(v_previous_mode, ''), true);

  v_result := jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'deleted', true,
    'deduplicated', false
  );
  insert into public.change_order_operations (
    project_id, change_order_id, operation_key, operation_type,
    request_fingerprint, result, created_by
  ) values (
    p_project_id, p_change_order_id, v_key, 'delete', v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

-- Cross-module links are one relationship, not two independent REST writes.
-- Guard the reverse-pointer tables as well as change_orders so a caller cannot
-- leave one side linked, cross project boundaries, or mistake an RLS-filtered
-- zero-row update for success.
create or replace function public.protect_exposure_change_order_link_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (
    (tg_op = 'INSERT' and new.linked_change_order_id is not null)
    or (
      tg_op = 'UPDATE'
      and new.linked_change_order_id is distinct from old.linked_change_order_id
      -- Admit the FK's ON DELETE SET NULL detach (system update inside the RI
      -- trigger); direct link edits stay command-only.
      and not (pg_trigger_depth() > 1 and new.linked_change_order_id is null)
    )
  ) and coalesce(current_setting('overwatch.change_order_link_write', true), '') <> 'linking'
  then
    raise exception using
      errcode = '23514',
      message = 'Exposure change-order links must be edited through an atomic link command.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_exposure_change_order_link_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists exposures_protect_change_order_link on public.exposures;
create trigger exposures_protect_change_order_link
  before insert or update on public.exposures
  for each row execute function public.protect_exposure_change_order_link_authority();

create or replace function public.protect_claim_change_order_link_authority()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if (
    (tg_op = 'INSERT' and new.change_order_id is not null)
    or (
      tg_op = 'UPDATE'
      and new.change_order_id is distinct from old.change_order_id
      -- Admit the FK's ON DELETE SET NULL detach (system update inside the RI
      -- trigger); direct link edits stay command-only.
      and not (pg_trigger_depth() > 1 and new.change_order_id is null)
    )
  ) and coalesce(current_setting('overwatch.change_order_link_write', true), '') <> 'linking'
  then
    raise exception using
      errcode = '23514',
      message = 'Claim change-order links must be edited through an atomic link command.';
  end if;
  return new;
end;
$$;

revoke all on function public.protect_claim_change_order_link_authority()
  from public, anon, authenticated, service_role;

drop trigger if exists project_claims_protect_change_order_link on public.project_claims;
create trigger project_claims_protect_change_order_link
  before insert or update on public.project_claims
  for each row execute function public.protect_claim_change_order_link_authority();

create or replace function public.link_change_order_exposure_atomic(
  p_change_order_id uuid,
  p_exposure_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_exposure_project_id uuid;
  v_current_exposure_id uuid;
  v_current_change_order_id uuid;
  v_updated_at timestamptz;
  v_previous_link_mode text := current_setting('overwatch.change_order_link_write', true);
  v_row_count integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to link a change order.';
  end if;

  select project_id, linked_exposure_id, updated_at
    into v_project_id, v_current_exposure_id, v_updated_at
  from public.change_orders
  where id = p_change_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to link this change order.';
  end if;

  select project_id, linked_change_order_id
    into v_exposure_project_id, v_current_change_order_id
  from public.exposures
  where id = p_exposure_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exposure not found.';
  end if;
  if v_exposure_project_id is distinct from v_project_id then
    raise exception using errcode = '23514', message = 'Change order and exposure must belong to the same project.';
  end if;
  if v_current_exposure_id = p_exposure_id
    and v_current_change_order_id = p_change_order_id
  then
    return jsonb_build_object(
      'changeOrderId', p_change_order_id,
      'exposureId', p_exposure_id,
      'updatedAt', v_updated_at,
      'deduplicated', true
    );
  end if;
  if v_current_exposure_id is not null and v_current_exposure_id <> p_exposure_id then
    raise exception using errcode = '23514', message = 'Change order is already linked to another exposure.';
  end if;
  if v_current_change_order_id is not null and v_current_change_order_id <> p_change_order_id then
    raise exception using errcode = '23514', message = 'Exposure is already linked to another change order.';
  end if;

  perform set_config('overwatch.change_order_link_write', 'linking', true);
  update public.change_orders
  set linked_exposure_id = p_exposure_id
  where id = p_change_order_id
  returning updated_at into v_updated_at;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Change-order link update affected no row.';
  end if;

  update public.exposures
  set linked_change_order_id = p_change_order_id
  where id = p_exposure_id;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Exposure link update affected no row.';
  end if;
  perform set_config(
    'overwatch.change_order_link_write',
    coalesce(v_previous_link_mode, ''),
    true
  );

  return jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'exposureId', p_exposure_id,
    'updatedAt', v_updated_at,
    'deduplicated', false
  );
end;
$$;

create or replace function public.unlink_change_order_exposure_atomic(
  p_change_order_id uuid,
  p_exposure_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_exposure_project_id uuid;
  v_current_exposure_id uuid;
  v_current_change_order_id uuid;
  v_updated_at timestamptz;
  v_previous_link_mode text := current_setting('overwatch.change_order_link_write', true);
  v_row_count integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to unlink a change order.';
  end if;

  select project_id, linked_exposure_id, updated_at
    into v_project_id, v_current_exposure_id, v_updated_at
  from public.change_orders
  where id = p_change_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to unlink this change order.';
  end if;

  select project_id, linked_change_order_id
    into v_exposure_project_id, v_current_change_order_id
  from public.exposures
  where id = p_exposure_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Exposure not found.';
  end if;
  if v_exposure_project_id is distinct from v_project_id then
    raise exception using errcode = '23514', message = 'Change order and exposure must belong to the same project.';
  end if;
  if v_current_exposure_id is null and v_current_change_order_id is null then
    return jsonb_build_object(
      'changeOrderId', p_change_order_id,
      'exposureId', p_exposure_id,
      'updatedAt', v_updated_at,
      'deduplicated', true
    );
  end if;
  if v_current_exposure_id is distinct from p_exposure_id
    or v_current_change_order_id is distinct from p_change_order_id
  then
    raise exception using errcode = '23514', message = 'Change order and exposure are not linked to each other.';
  end if;

  perform set_config('overwatch.change_order_link_write', 'linking', true);
  update public.change_orders
  set linked_exposure_id = null
  where id = p_change_order_id
  returning updated_at into v_updated_at;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Change-order unlink affected no row.';
  end if;

  update public.exposures
  set linked_change_order_id = null
  where id = p_exposure_id;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Exposure unlink affected no row.';
  end if;
  perform set_config(
    'overwatch.change_order_link_write',
    coalesce(v_previous_link_mode, ''),
    true
  );

  return jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'exposureId', p_exposure_id,
    'updatedAt', v_updated_at,
    'deduplicated', false
  );
end;
$$;

create or replace function public.link_claim_change_order_atomic(
  p_claim_id uuid,
  p_change_order_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_claim_project_id uuid;
  v_current_claim_id uuid;
  v_current_change_order_id uuid;
  v_updated_at timestamptz;
  v_previous_link_mode text := current_setting('overwatch.change_order_link_write', true);
  v_row_count integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to link a claim.';
  end if;

  select project_id, linked_claim_id, updated_at
    into v_project_id, v_current_claim_id, v_updated_at
  from public.change_orders
  where id = p_change_order_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Change order not found.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to link this change order.';
  end if;

  select project_id, change_order_id
    into v_claim_project_id, v_current_change_order_id
  from public.project_claims
  where id = p_claim_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Claim not found.';
  end if;
  if v_claim_project_id is distinct from v_project_id then
    raise exception using errcode = '23514', message = 'Change order and claim must belong to the same project.';
  end if;
  if v_current_claim_id = p_claim_id and v_current_change_order_id = p_change_order_id then
    return jsonb_build_object(
      'changeOrderId', p_change_order_id,
      'claimId', p_claim_id,
      'updatedAt', v_updated_at,
      'deduplicated', true
    );
  end if;
  if v_current_claim_id is not null and v_current_claim_id <> p_claim_id then
    raise exception using errcode = '23514', message = 'Change order is already linked to another claim.';
  end if;
  if v_current_change_order_id is not null and v_current_change_order_id <> p_change_order_id then
    raise exception using errcode = '23514', message = 'Claim is already linked to another change order.';
  end if;

  perform set_config('overwatch.change_order_link_write', 'linking', true);
  update public.change_orders
  set linked_claim_id = p_claim_id
  where id = p_change_order_id
  returning updated_at into v_updated_at;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Change-order claim link affected no row.';
  end if;

  update public.project_claims
  set change_order_id = p_change_order_id
  where id = p_claim_id;
  get diagnostics v_row_count = row_count;
  if v_row_count <> 1 then
    raise exception using errcode = 'P0002', message = 'Claim link affected no row.';
  end if;
  perform set_config(
    'overwatch.change_order_link_write',
    coalesce(v_previous_link_mode, ''),
    true
  );

  return jsonb_build_object(
    'changeOrderId', p_change_order_id,
    'claimId', p_claim_id,
    'updatedAt', v_updated_at,
    'deduplicated', false
  );
end;
$$;

revoke all on function public.link_change_order_exposure_atomic(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.link_change_order_exposure_atomic(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.unlink_change_order_exposure_atomic(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.unlink_change_order_exposure_atomic(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.link_claim_change_order_atomic(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.link_claim_change_order_atomic(uuid, uuid)
  to authenticated, service_role;

revoke all on function public.create_change_order_atomic(
  uuid, text, text, bigint, bigint, text, text, numeric, text, text,
  text, text, integer, text, date, text, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.create_change_order_atomic(
  uuid, text, text, bigint, bigint, text, text, numeric, text, text,
  text, text, integer, text, date, text, uuid
) to authenticated, service_role;

revoke all on function public.update_change_order_atomic(
  uuid, uuid, timestamptz, text, text, bigint, bigint, text, text, numeric,
  text, text, text, text, integer, text, date, text
) from public, anon, authenticated, service_role;
grant execute on function public.update_change_order_atomic(
  uuid, uuid, timestamptz, text, text, bigint, bigint, text, text, numeric,
  text, text, text, text, integer, text, date, text
) to authenticated, service_role;

revoke all on function public.delete_change_order_atomic(uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_change_order_atomic(uuid, uuid, timestamptz, text)
  to authenticated, service_role;

revoke insert, update, delete on public.change_orders from authenticated, service_role;
revoke update (linked_exposure_id, linked_claim_id)
  on public.change_orders from authenticated, service_role;
revoke update (linked_change_order_id)
  on public.exposures from authenticated, service_role;
revoke update (change_order_id)
  on public.project_claims from authenticated, service_role;
grant update (
  client_visible,
  client_status,
  client_notes,
  client_sent_at,
  client_decided_at
) on public.change_orders to authenticated, service_role;

notify pgrst, 'reload schema';
