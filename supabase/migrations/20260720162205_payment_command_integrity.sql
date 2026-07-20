-- Controlled payment commands and immutable financial history.
--
-- This follows payment_ledger_rollup_integrity. Authenticated clients no
-- longer mutate ledger rows directly: carefully checked SECURITY DEFINER RPCs
-- take parent locks first, while the Stripe service role retains constrained
-- INSERT/UPDATE access for webhook delivery. Payment history cannot be deleted.

alter table public.payment_ledger
  add column if not exists processor_fee_cents bigint not null default 0,
  add column if not exists overwatch_fee_cents bigint not null default 0,
  add column if not exists surcharge numeric not null default 0,
  add column if not exists surcharge_cents bigint not null default 0,
  add column if not exists gross_received numeric not null default 0,
  add column if not exists gross_received_cents bigint not null default 0,
  add column if not exists net_payout_cents bigint not null default 0,
  add column if not exists refunded_amount_cents bigint not null default 0,
  add column if not exists refunded_surcharge_cents bigint not null default 0,
  add column if not exists refunded_gross_cents bigint not null default 0;

do $$
declare
  v_payment_id uuid;
begin
  select ledger.id into v_payment_id
  from public.payment_ledger ledger
  where ledger.status = 'succeeded'
    and ledger.notes ilike '%partially refunded%'
  order by ledger.id
  limit 1;
  if found then
    raise exception using
      errcode = '23514',
      message = format('Payment %s contains a legacy destructive partial refund.', v_payment_id),
      hint = 'Recover its original gross/applied receipt and cumulative Stripe refund before retrying this migration.';
  end if;
end;
$$;

do $$
declare
  v_payment_id uuid;
begin
  select ledger.id into v_payment_id
  from public.payment_ledger ledger
  where ledger.status = 'succeeded'
    and coalesce(nullif(ledger.amount_cents, 0), round(ledger.amount * 100)::bigint) <= 0
  order by ledger.id
  limit 1;
  if found then
    raise exception using
      errcode = '23514',
      message = format('Succeeded payment %s has no positive applied amount.', v_payment_id),
      hint = 'Void the empty receipt or restore its real applied cents before retrying this migration.';
  end if;
end;
$$;

-- The guard trigger installed later in this file survives an exact replay and
-- rejects direct money writes, so this one deterministic normalization runs
-- under the controlled-command GUC the guard honors and touches only rows
-- whose gross cents were never derived. A second run is a clean no-op.
select set_config('overwatch.payment_ledger_command', 'refund', true);

update public.payment_ledger
set processor_fee_cents = round(processor_fee * 100)::bigint,
    overwatch_fee_cents = round(overwatch_fee * 100)::bigint,
    surcharge_cents = greatest(
      0,
      greatest(
        coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
        round(net_payout * 100)::bigint
          + round(processor_fee * 100)::bigint
          + round(overwatch_fee * 100)::bigint
      ) - coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)
    ),
    gross_received_cents = greatest(
      coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
      round(net_payout * 100)::bigint
        + round(processor_fee * 100)::bigint
        + round(overwatch_fee * 100)::bigint
    ),
    net_payout_cents = greatest(
      coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
      round(net_payout * 100)::bigint
        + round(processor_fee * 100)::bigint
        + round(overwatch_fee * 100)::bigint
    ) - round(processor_fee * 100)::bigint - round(overwatch_fee * 100)::bigint,
    amount_cents = coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
    amount = coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)::numeric / 100.0,
    processor_fee = round(processor_fee * 100)::bigint::numeric / 100.0,
    overwatch_fee = round(overwatch_fee * 100)::bigint::numeric / 100.0,
    surcharge = greatest(
      0,
      greatest(
        coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
        round(net_payout * 100)::bigint
          + round(processor_fee * 100)::bigint
          + round(overwatch_fee * 100)::bigint
      ) - coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)
    )::numeric / 100.0,
    gross_received = greatest(
      coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
      round(net_payout * 100)::bigint
        + round(processor_fee * 100)::bigint
        + round(overwatch_fee * 100)::bigint
    )::numeric / 100.0,
    net_payout = (
      greatest(
        coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
        round(net_payout * 100)::bigint
          + round(processor_fee * 100)::bigint
          + round(overwatch_fee * 100)::bigint
      ) - round(processor_fee * 100)::bigint - round(overwatch_fee * 100)::bigint
    )::numeric / 100.0,
    refunded_amount_cents = case
      when status = 'refunded'
        then coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)
      else 0
    end,
    refunded_surcharge_cents = case
      when status = 'refunded' then greatest(
        0,
        greatest(
          coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
          round(net_payout * 100)::bigint
            + round(processor_fee * 100)::bigint
            + round(overwatch_fee * 100)::bigint
        ) - coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint)
      )
      else 0
    end,
    refunded_gross_cents = case
      when status = 'refunded' then greatest(
        coalesce(nullif(amount_cents, 0), round(amount * 100)::bigint),
        round(net_payout * 100)::bigint
          + round(processor_fee * 100)::bigint
          + round(overwatch_fee * 100)::bigint
      )
      else 0
    end
where gross_received_cents = 0;

select set_config('overwatch.payment_ledger_command', '', true);

do $$
declare
  v_payment_id uuid;
begin
  select ledger.id
  into v_payment_id
  from public.payment_ledger ledger
  where ledger.amount_cents < 0
    or ledger.processor_fee_cents < 0
    or ledger.overwatch_fee_cents < 0
    or ledger.surcharge_cents < 0
    or ledger.gross_received_cents <> ledger.amount_cents + ledger.surcharge_cents
    or ledger.processor_fee_cents + ledger.overwatch_fee_cents > ledger.gross_received_cents
  order by ledger.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format('Payment %s has invalid applied, surcharge, gross, or fee cents.', v_payment_id),
      hint = 'Correct the ledger receipt equation before retrying this migration.';
  end if;
end;
$$;

do $$
declare
  v_invoice_id uuid;
begin
  select invoice.id
  into v_invoice_id
  from public.billing_invoices invoice
  where invoice.subtotal < 0
    or invoice.retainage < 0
    or invoice.total_due < 0
    or invoice.paid_amount < 0
    or invoice.paid_amount > invoice.total_due
    or invoice.subtotal <> round(invoice.subtotal, 2)
    or invoice.retainage <> round(invoice.retainage, 2)
    or invoice.total_due <> round(invoice.total_due, 2)
    or invoice.paid_amount <> round(invoice.paid_amount, 2)
  order by invoice.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format('Invoice %s contains invalid money or paid cash above total due.', v_invoice_id),
      hint = 'Correct invoice money to nonnegative whole cents and resolve overpayment before retrying this migration.';
  end if;
end;
$$;

do $$
declare
  v_invoice_id uuid;
begin
  select invoice.id
  into v_invoice_id
  from public.billing_invoices invoice
  join public.payment_ledger ledger on ledger.invoice_id = invoice.id
  group by invoice.id, invoice.total_due
  having coalesce(
    sum(ledger.amount_cents - ledger.refunded_amount_cents)
      filter (where ledger.status in ('succeeded', 'refunded')),
    0
  ) > round(invoice.total_due * 100)::bigint
  order by invoice.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format('Succeeded payment cash exceeds invoice %s total due.', v_invoice_id),
      hint = 'Resolve the overpayment through an explicit refund or unapplied-credit workflow before retrying this migration.';
  end if;
end;
$$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'payment_ledger_exact_cents_check'
      and conrelid = 'public.payment_ledger'::regclass
  ) then
    alter table public.payment_ledger
      add constraint payment_ledger_exact_cents_check check (
        amount_cents >= 0
        and surcharge_cents >= 0
        and gross_received_cents = amount_cents + surcharge_cents
        and processor_fee_cents >= 0
        and overwatch_fee_cents >= 0
        and processor_fee_cents + overwatch_fee_cents <= gross_received_cents
        and net_payout_cents = gross_received_cents - processor_fee_cents - overwatch_fee_cents
        and refunded_amount_cents between 0 and amount_cents
        and refunded_surcharge_cents between 0 and surcharge_cents
        and refunded_gross_cents = refunded_amount_cents + refunded_surcharge_cents
        and (
          (status = 'refunded' and refunded_gross_cents = gross_received_cents)
          or (
            status <> 'refunded'
            and (refunded_gross_cents < gross_received_cents or gross_received_cents = 0)
          )
        )
        and amount = amount_cents::numeric / 100.0
        and surcharge = surcharge_cents::numeric / 100.0
        and gross_received = gross_received_cents::numeric / 100.0
        and processor_fee = processor_fee_cents::numeric / 100.0
        and overwatch_fee = overwatch_fee_cents::numeric / 100.0
        and net_payout = net_payout_cents::numeric / 100.0
      );
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'billing_invoices_exact_cents_check'
      and conrelid = 'public.billing_invoices'::regclass
  ) then
    alter table public.billing_invoices
      add constraint billing_invoices_exact_cents_check check (
        subtotal >= 0 and subtotal = round(subtotal, 2)
        and retainage >= 0 and retainage = round(retainage, 2)
        and total_due >= 0 and total_due = round(total_due, 2)
        and paid_amount >= 0 and paid_amount = round(paid_amount, 2)
        and paid_amount <= total_due
      );
  end if;
end $$;

-- Replace the first migration's scope validator with exact fee/net and
-- immutable provenance enforcement. Partial refunds must use the refund RPC,
-- which adjusts fees if necessary before this check runs.
create or replace function public.tg_validate_payment_ledger_scope()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_application_id uuid;
  v_organization_id uuid;
  v_amount_cents bigint;
  v_surcharge_cents bigint;
  v_gross_received_cents bigint;
  v_processor_fee_cents bigint;
  v_overwatch_fee_cents bigint;
begin
  select invoice.project_id, invoice.billing_application_id, project.organization_id
  into v_project_id, v_application_id, v_organization_id
  from public.billing_invoices invoice
  join public.projects project on project.id = invoice.project_id
  where invoice.id = new.invoice_id;

  if not found then
    raise exception using errcode = '23503', message = 'Payment invoice was not found or is not accessible.';
  end if;
  if new.project_id is distinct from v_project_id then
    raise exception using errcode = '23514', message = 'Payment project must match the invoice project.';
  end if;
  if new.billing_application_id is distinct from v_application_id then
    raise exception using errcode = '23514', message = 'Payment pay application must match the invoice pay application.';
  end if;
  if new.organization_id is distinct from v_organization_id then
    raise exception using errcode = '23514', message = 'Payment organization must match the invoice project organization.';
  end if;

  v_amount_cents := case
    when new.amount_cents = 0 and new.amount <> 0 then round(new.amount * 100)::bigint
    else new.amount_cents
  end;
  v_processor_fee_cents := case
    when new.processor_fee_cents = 0 and new.processor_fee <> 0
      then round(new.processor_fee * 100)::bigint
    else new.processor_fee_cents
  end;
  v_overwatch_fee_cents := case
    when new.overwatch_fee_cents = 0 and new.overwatch_fee <> 0
      then round(new.overwatch_fee * 100)::bigint
    else new.overwatch_fee_cents
  end;
  v_surcharge_cents := case
    when new.surcharge_cents = 0 and new.surcharge <> 0
      then round(new.surcharge * 100)::bigint
    else new.surcharge_cents
  end;
  v_gross_received_cents := case
    when new.gross_received_cents = 0 and new.gross_received <> 0
      then round(new.gross_received * 100)::bigint
    when new.gross_received_cents = 0
      then v_amount_cents + v_surcharge_cents
    else new.gross_received_cents
  end;

  if v_amount_cents < 0
    or v_surcharge_cents < 0
    or v_processor_fee_cents < 0
    or v_overwatch_fee_cents < 0
  then
    raise exception using errcode = '23514', message = 'Payment amount, surcharge, and fees cannot be negative.';
  end if;
  if v_gross_received_cents <> v_amount_cents + v_surcharge_cents then
    raise exception using
      errcode = '23514',
      message = 'Payment gross received must equal invoice-applied cash plus surcharge.';
  end if;
  if v_processor_fee_cents + v_overwatch_fee_cents > v_gross_received_cents then
    raise exception using errcode = '23514', message = 'Payment fees cannot exceed gross received.';
  end if;
  if new.status = 'succeeded' and v_amount_cents <= 0 then
    raise exception using errcode = '23514', message = 'A succeeded payment must have a positive integer-cent amount.';
  end if;

  new.amount_cents := v_amount_cents;
  new.surcharge_cents := v_surcharge_cents;
  new.gross_received_cents := v_gross_received_cents;
  new.processor_fee_cents := v_processor_fee_cents;
  new.overwatch_fee_cents := v_overwatch_fee_cents;
  new.net_payout_cents := v_gross_received_cents - v_processor_fee_cents - v_overwatch_fee_cents;
  new.amount := v_amount_cents::numeric / 100.0;
  new.surcharge := v_surcharge_cents::numeric / 100.0;
  new.gross_received := v_gross_received_cents::numeric / 100.0;
  new.processor_fee := v_processor_fee_cents::numeric / 100.0;
  new.overwatch_fee := v_overwatch_fee_cents::numeric / 100.0;
  new.net_payout := new.net_payout_cents::numeric / 100.0;
  return new;
end;
$$;

drop trigger if exists payment_ledger_validate_scope on public.payment_ledger;
create trigger payment_ledger_validate_scope
  before insert or update of invoice_id, project_id, billing_application_id,
    organization_id, amount, amount_cents, processor_fee, processor_fee_cents,
    overwatch_fee, overwatch_fee_cents, surcharge, surcharge_cents,
    gross_received, gross_received_cents, net_payout, net_payout_cents,
    refunded_amount_cents, refunded_surcharge_cents, refunded_gross_cents, status
  on public.payment_ledger
  for each row
  execute function public.tg_validate_payment_ledger_scope();

create or replace function public.tg_guard_payment_ledger_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'Payment ledger history cannot be deleted. Void or refund the payment instead.';
  end if;

  if tg_op = 'INSERT' then
    if new.processor not in ('manual', 'stripe', 'stripe_connect') then
      raise exception using errcode = '23514', message = 'Payment processor provenance is invalid.';
    end if;
    if new.processor = 'manual' and new.status <> 'succeeded' then
      raise exception using errcode = '23514', message = 'A manual payment must start succeeded.';
    end if;
    if new.processor in ('stripe', 'stripe_connect') and new.status not in ('pending', 'succeeded') then
      raise exception using errcode = '23514', message = 'A Stripe payment must start pending or succeeded.';
    end if;
    return new;
  end if;

  if current_setting('overwatch.payment_ledger_command', true) = 'stripe_enrich' then
    if old.processor not in ('stripe', 'stripe_connect')
      or (
        new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
        and nullif(old.stripe_checkout_session_id, '') is not null
      )
      or (
        new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
        and nullif(old.stripe_payment_intent_id, '') is not null
      )
      or (
        new.processor_payment_id is distinct from old.processor_payment_id
        and nullif(old.processor_payment_id, '') is not null
      )
    then
      raise exception using
        errcode = '23514',
        message = 'Stripe identifiers can only fill previously blank receipt provenance.';
    end if;
    return new;
  end if;

  if new.project_id is distinct from old.project_id
    or new.invoice_id is distinct from old.invoice_id
    or new.billing_application_id is distinct from old.billing_application_id
    or new.organization_id is distinct from old.organization_id
    or new.processor is distinct from old.processor
    or new.payment_method is distinct from old.payment_method
    or new.processor_payment_id is distinct from old.processor_payment_id
    or new.currency is distinct from old.currency
    or new.reference is distinct from old.reference
    or new.paid_at is distinct from old.paid_at
    or new.idempotency_key is distinct from old.idempotency_key
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
    or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
    or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
  then
    raise exception using
      errcode = '23514',
      message = 'Payment ownership and processor provenance are immutable.';
  end if;

  if current_setting('overwatch.payment_ledger_command', true) in ('refund', 'void') then
    return new;
  end if;

  if old.processor not in ('stripe', 'stripe_connect') then
    raise exception using
      errcode = '23514',
      message = 'Manual payment corrections must use a controlled payment command.';
  end if;
  if new.amount is distinct from old.amount
    or new.amount_cents is distinct from old.amount_cents
    or new.surcharge is distinct from old.surcharge
    or new.surcharge_cents is distinct from old.surcharge_cents
    or new.gross_received is distinct from old.gross_received
    or new.gross_received_cents is distinct from old.gross_received_cents
    or new.processor_fee is distinct from old.processor_fee
    or new.processor_fee_cents is distinct from old.processor_fee_cents
    or new.overwatch_fee is distinct from old.overwatch_fee
    or new.overwatch_fee_cents is distinct from old.overwatch_fee_cents
    or new.net_payout is distinct from old.net_payout
    or new.net_payout_cents is distinct from old.net_payout_cents
    or new.refunded_amount_cents is distinct from old.refunded_amount_cents
    or new.refunded_surcharge_cents is distinct from old.refunded_surcharge_cents
    or new.refunded_gross_cents is distinct from old.refunded_gross_cents
  then
    raise exception using
      errcode = '23514',
      message = 'Stripe payment money can change only through a controlled payment command.';
  end if;
  if nullif(old.stripe_charge_id, '') is not null
    and new.stripe_charge_id is distinct from old.stripe_charge_id
  then
    raise exception using errcode = '23514', message = 'A Stripe charge ID is immutable once recorded.';
  end if;
  if nullif(old.receipt_url, '') is not null
    and new.receipt_url is distinct from old.receipt_url
  then
    raise exception using errcode = '23514', message = 'A Stripe receipt URL is immutable once recorded.';
  end if;
  if new.notes is distinct from old.notes
    and nullif(old.notes, '') is not null
    and new.notes not like old.notes || E'\n%'
  then
    raise exception using errcode = '23514', message = 'Payment notes are append-only.';
  end if;
  if old.status in ('failed', 'refunded', 'void') and new is distinct from old then
    raise exception using errcode = '23514', message = 'A terminal payment cannot be changed.';
  end if;
  if old.status = 'pending' and new.status not in ('pending', 'succeeded', 'failed') then
    raise exception using errcode = '23514', message = 'Invalid Stripe pending-payment transition.';
  end if;
  if old.status = 'succeeded' and new.status <> 'succeeded' then
    raise exception using
      errcode = '23514',
      message = 'Stripe refunds must use the parent-first refund payment command.';
  end if;
  return new;
end;
$$;

drop trigger if exists payment_ledger_guard_history on public.payment_ledger;
create trigger payment_ledger_guard_history
  before insert or update or delete on public.payment_ledger
  for each row
  execute function public.tg_guard_payment_ledger_history();

-- An invoice and its pay application must always share the same project. Once
-- ledger history exists, neither parent link can move; corrections preserve
-- provenance and are represented by payment state transitions.
create or replace function public.tg_validate_billing_invoice_parent_scope()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_application_project_id uuid;
begin
  if new.billing_application_id is not null then
    select application.project_id
    into v_application_project_id
    from public.billing_applications application
    where application.id = new.billing_application_id;

    if not found or v_application_project_id is distinct from new.project_id then
      raise exception using
        errcode = '23514',
        message = 'Invoice pay application must belong to the invoice project.';
    end if;
  end if;

  if tg_op = 'UPDATE'
    and (
      new.project_id is distinct from old.project_id
      or new.billing_application_id is distinct from old.billing_application_id
    )
    and exists (select 1 from public.payment_ledger ledger where ledger.invoice_id = old.id)
  then
    raise exception using
      errcode = '23514',
      message = 'An invoice with payment history cannot move to another project or pay application.';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_invoices_validate_parent_scope on public.billing_invoices;
create trigger billing_invoices_validate_parent_scope
  before insert or update of project_id, billing_application_id on public.billing_invoices
  for each row
  execute function public.tg_validate_billing_invoice_parent_scope();

create or replace function public.tg_protect_billing_parent_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'billing_invoices' then
    if exists (select 1 from public.payment_ledger ledger where ledger.invoice_id = old.id) then
      raise exception using
        errcode = '23514',
        message = 'An invoice with payment history cannot be deleted. Void it after reversing cash instead.';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    if exists (
      select 1 from public.billing_invoices invoice
      where invoice.billing_application_id = old.id
    ) or exists (
      select 1 from public.payment_ledger ledger
      where ledger.billing_application_id = old.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'A pay application with invoice history cannot move to another project.';
    end if;
    return new;
  end if;

  if exists (
    select 1 from public.billing_invoices invoice
    where invoice.billing_application_id = old.id
  ) or exists (
    select 1 from public.payment_ledger ledger
    where ledger.billing_application_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A pay application with invoice history cannot be deleted. Preserve the audit trail.';
  end if;
  return old;
end;
$$;

drop trigger if exists billing_invoices_protect_payment_history on public.billing_invoices;
create trigger billing_invoices_protect_payment_history
  before delete on public.billing_invoices
  for each row
  execute function public.tg_protect_billing_parent_history();

drop trigger if exists billing_applications_protect_project_history on public.billing_applications;
create trigger billing_applications_protect_project_history
  before update of project_id on public.billing_applications
  for each row
  execute function public.tg_protect_billing_parent_history();

drop trigger if exists billing_applications_protect_delete_history on public.billing_applications;
create trigger billing_applications_protect_delete_history
  before delete on public.billing_applications
  for each row
  execute function public.tg_protect_billing_parent_history();

-- Wrap the first financial-integrity payment RPC without editing its shipped
-- migration. The wrapper sets a transaction-local defer mode before the
-- internal INSERT, so the statement trigger does not preempt the RPC's own
-- rollup or corrupt its lifecycle-event from_status. The internal function
-- retains every validation and project authorization check.
do $$
begin
  -- On the first apply, preserve the previously shipped implementation under
  -- the private name used by the wrapper below. On an exact migration replay,
  -- that private implementation already exists and must remain the wrapper's
  -- stable delegate rather than colliding with another RENAME.
  if to_regprocedure(
    'public.record_invoice_payment_atomic_internal(uuid,bigint,bigint,bigint,timestamptz,text,text,text,text,text,text)'
  ) is null then
    alter function public.record_invoice_payment_atomic(
      uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
    ) rename to record_invoice_payment_atomic_internal;
  end if;
end;
$$;

create or replace function public.record_invoice_payment_atomic(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_processor_fee_cents bigint default 0,
  p_overwatch_fee_cents bigint default 0,
  p_paid_at timestamptz default now(),
  p_payment_method text default 'manual',
  p_processor text default 'manual',
  p_processor_payment_id text default '',
  p_reference text default '',
  p_notes text default '',
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice public.billing_invoices%rowtype;
  v_existing_payment_id uuid;
  v_succeeded_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_previous_mode text := current_setting('overwatch.payment_rollup_mode', true);
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to record an invoice payment.';
  end if;

  select *
  into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found.';
  end if;
  if not public.can_manage_project(v_invoice.project_id) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to record payments for this project.';
  end if;

  select ledger.id
  into v_existing_payment_id
  from public.payment_ledger ledger
  where ledger.invoice_id = v_invoice.id
    and ledger.idempotency_key = btrim(p_idempotency_key)
  for update;

  if v_existing_payment_id is null then
    select coalesce(sum(ledger.amount_cents - ledger.refunded_amount_cents), 0)::bigint
    into v_succeeded_cents
    from public.payment_ledger ledger
    where ledger.invoice_id = v_invoice.id
      and ledger.status in ('succeeded', 'refunded');

    v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
    if p_amount_cents > v_total_due_cents - v_succeeded_cents then
      raise exception using
        errcode = '23514',
        message = 'Payment would exceed the invoice total due.',
        hint = 'Record only the remaining balance or use an explicit unapplied-credit workflow.';
    end if;
  end if;

  perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
  v_result := public.record_invoice_payment_atomic_internal(
    p_invoice_id,
    p_amount_cents,
    p_processor_fee_cents,
    p_overwatch_fee_cents,
    p_paid_at,
    p_payment_method,
    p_processor,
    p_processor_payment_id,
    p_reference,
    p_notes,
    p_idempotency_key
  );
  perform set_config(
    'overwatch.payment_rollup_mode',
    coalesce(v_previous_mode, 'immediate'),
    true
  );
  return v_result;
end;
$$;

-- Authenticated users write only through parent-first commands. Stripe keeps
-- constrained service-role INSERT/UPDATE for webhook events; neither role can
-- delete the audit ledger.
revoke insert, update, delete on public.payment_ledger from authenticated;
revoke delete on public.payment_ledger from service_role;

revoke all on function public.record_invoice_payment_atomic_internal(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) to authenticated;

revoke all on function public.tg_guard_payment_ledger_history()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_validate_billing_invoice_parent_scope()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_protect_billing_parent_history()
  from public, anon, authenticated, service_role;

create or replace function public.void_invoice_payment_atomic(
  p_payment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_ledger%rowtype;
  v_invoice_id uuid;
  v_project_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to void a payment.';
  end if;
  if nullif(btrim(p_reason), '') is null or length(p_reason) > 1000 then
    raise exception using errcode = '22023', message = 'A concise payment-void reason is required.';
  end if;

  select ledger.invoice_id, ledger.project_id
  into v_invoice_id, v_project_id
  from public.payment_ledger ledger
  where ledger.id = p_payment_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Payment not found.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to void this payment.';
  end if;

  perform 1 from public.billing_invoices invoice where invoice.id = v_invoice_id for update;
  select * into v_payment
  from public.payment_ledger ledger
  where ledger.id = p_payment_id
  for update;
  if v_payment.status <> 'pending' then
    raise exception using
      errcode = '23514',
      message = 'Only a pending authorization can be voided. Reverse succeeded cash through a refund event.';
  end if;

  perform set_config('overwatch.payment_ledger_command', 'void', true);
  update public.payment_ledger
  set status = 'void',
      notes = concat_ws(E'\n', nullif(notes, ''), 'Voided: ' || btrim(p_reason))
  where id = v_payment.id;

  return jsonb_build_object(
    'paymentId', v_payment.id,
    'invoiceId', v_payment.invoice_id,
    'status', 'void'
  );
end;
$$;

revoke all on function public.void_invoice_payment_atomic(uuid, text)
  from public, anon, service_role;
grant execute on function public.void_invoice_payment_atomic(uuid, text)
  to authenticated;
