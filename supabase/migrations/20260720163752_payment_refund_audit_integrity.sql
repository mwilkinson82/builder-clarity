-- Immutable refund evidence and refund-aware invoice reconciliation.
--
-- payment_ledger preserves the original receipt: invoice-applied cash,
-- surcharge, gross received, and fees never shrink. Each refund appends an
-- exact-cent event, then advances cumulative refund counters on the receipt.

do $$
begin
  if exists (
    select 1
    from public.payment_ledger ledger
    where ledger.amount_cents not between 0 and 9007199254740991
       or ledger.surcharge_cents not between 0 and 9007199254740991
       or ledger.gross_received_cents not between 0 and 9007199254740991
       or ledger.processor_fee_cents not between 0 and 9007199254740991
       or ledger.overwatch_fee_cents not between 0 and 9007199254740991
       or ledger.net_payout_cents not between 0 and 9007199254740991
       or ledger.refunded_amount_cents not between 0 and 9007199254740991
       or ledger.refunded_surcharge_cents not between 0 and 9007199254740991
       or ledger.refunded_gross_cents not between 0 and 9007199254740991
  ) then
    raise exception using
      errcode = '22003',
      message = 'Existing payment cents exceed the exact JavaScript accounting range.';
  end if;
end;
$$;

alter table public.payment_ledger
  drop constraint if exists payment_ledger_safe_integer_cents_check;
alter table public.payment_ledger
  add constraint payment_ledger_safe_integer_cents_check check (
    amount_cents between 0 and 9007199254740991
    and surcharge_cents between 0 and 9007199254740991
    and gross_received_cents between 0 and 9007199254740991
    and processor_fee_cents between 0 and 9007199254740991
    and overwatch_fee_cents between 0 and 9007199254740991
    and net_payout_cents between 0 and 9007199254740991
    and refunded_amount_cents between 0 and 9007199254740991
    and refunded_surcharge_cents between 0 and 9007199254740991
    and refunded_gross_cents between 0 and 9007199254740991
  );

create table if not exists public.payment_refund_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payment_ledger(id) on delete restrict,
  invoice_id uuid not null references public.billing_invoices(id) on delete restrict,
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_application_id uuid references public.billing_applications(id) on delete restrict,
  organization_id uuid,
  refund_gross_cents bigint not null,
  refund_amount_cents bigint not null,
  refund_surcharge_cents bigint not null,
  cumulative_refunded_gross_cents bigint not null,
  processor text not null,
  processor_event_id text not null default '',
  idempotency_key text not null,
  stripe_charge_id text not null default '',
  receipt_url text not null default '',
  request_fingerprint text not null default '',
  notes text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint payment_refund_events_exact_cents_check check (
    refund_gross_cents > 0
    and refund_amount_cents >= 0
    and refund_surcharge_cents >= 0
    and refund_gross_cents = refund_amount_cents + refund_surcharge_cents
    and cumulative_refunded_gross_cents >= refund_gross_cents
  ),
  constraint payment_refund_events_payment_idempotency_unique
    unique (payment_id, idempotency_key)
);

alter table public.payment_refund_events
  add column if not exists stripe_charge_id text not null default '',
  add column if not exists receipt_url text not null default '',
  add column if not exists request_fingerprint text not null default '';

create unique index if not exists payment_refund_events_processor_event_unique
  on public.payment_refund_events (processor, btrim(processor_event_id))
  where btrim(processor_event_id) <> '';
create index if not exists payment_refund_events_payment_idx
  on public.payment_refund_events (payment_id, created_at, id);
create index if not exists payment_refund_events_invoice_idx
  on public.payment_refund_events (invoice_id, created_at, id);

-- Backfill immutable evidence for refunds recorded before this table existed.
-- The guard trigger installed below survives an exact replay and would reject
-- these historical rows before ON CONFLICT could no-op, so only payments that
-- still have no refund-event evidence at all are backfilled.
insert into public.payment_refund_events (
  payment_id, invoice_id, project_id, billing_application_id, organization_id,
  refund_gross_cents, refund_amount_cents, refund_surcharge_cents,
  cumulative_refunded_gross_cents, processor, processor_event_id,
  idempotency_key, stripe_charge_id, receipt_url, request_fingerprint,
  notes, created_by, created_at
)
select
  ledger.id, ledger.invoice_id, ledger.project_id,
  ledger.billing_application_id, ledger.organization_id,
  ledger.refunded_gross_cents, ledger.refunded_amount_cents,
  ledger.refunded_surcharge_cents, ledger.refunded_gross_cents,
  ledger.processor, 'historical-refund:' || ledger.id::text,
  'historical-refund:' || ledger.id::text,
  ledger.stripe_charge_id,
  ledger.receipt_url,
  md5(jsonb_build_array(
    ledger.id,
    ledger.refunded_gross_cents,
    'Backfilled immutable evidence for a refund recorded before refund-event history.',
    'historical-refund:' || ledger.id::text,
    ledger.stripe_charge_id,
    ledger.receipt_url
  )::text),
  'Backfilled immutable evidence for a refund recorded before refund-event history.',
  ledger.created_by, ledger.updated_at
from public.payment_ledger ledger
where ledger.status = 'refunded'
  and ledger.refunded_gross_cents > 0
  and not exists (
    select 1
    from public.payment_refund_events existing
    where existing.payment_id = ledger.id
  )
on conflict (payment_id, idempotency_key) do nothing;

update public.payment_refund_events event
set request_fingerprint = md5(jsonb_build_array(
  event.payment_id,
  event.cumulative_refunded_gross_cents,
  event.notes,
  event.processor_event_id,
  event.stripe_charge_id,
  event.receipt_url
)::text)
where event.request_fingerprint = '';

alter table public.payment_refund_events
  drop constraint if exists payment_refund_events_fingerprint_check,
  drop constraint if exists payment_refund_events_safe_integer_cents_check;
alter table public.payment_refund_events
  add constraint payment_refund_events_fingerprint_check
    check (length(request_fingerprint) = 32),
  add constraint payment_refund_events_safe_integer_cents_check check (
    refund_gross_cents between 1 and 9007199254740991
    and refund_amount_cents between 0 and 9007199254740991
    and refund_surcharge_cents between 0 and 9007199254740991
    and cumulative_refunded_gross_cents between 1 and 9007199254740991
  );

alter table public.payment_refund_events enable row level security;
grant select on public.payment_refund_events to authenticated, service_role;
revoke insert, update, delete on public.payment_refund_events
  from anon, authenticated, service_role;

drop policy if exists payment_refund_events_team_select on public.payment_refund_events;
create policy payment_refund_events_team_select on public.payment_refund_events
  for select to authenticated
  using (public.can_read_project(project_id));

create or replace function public.tg_guard_payment_refund_event()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_ledger%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '23514',
      message = 'Payment refund events are immutable and cannot be updated or deleted.';
  end if;

  select * into v_payment
  from public.payment_ledger ledger
  where ledger.id = new.payment_id;
  if not found then
    raise exception using errcode = '23503', message = 'Refund payment was not found.';
  end if;
  if new.invoice_id is distinct from v_payment.invoice_id
    or new.project_id is distinct from v_payment.project_id
    or new.billing_application_id is distinct from v_payment.billing_application_id
    or new.organization_id is distinct from v_payment.organization_id
    or new.processor is distinct from v_payment.processor
  then
    raise exception using errcode = '23514', message = 'Refund ownership must match its payment receipt.';
  end if;
  if new.cumulative_refunded_gross_cents
       <> v_payment.refunded_gross_cents + new.refund_gross_cents
    or new.refund_amount_cents
       > v_payment.amount_cents - v_payment.refunded_amount_cents
    or new.refund_surcharge_cents
       > v_payment.surcharge_cents - v_payment.refunded_surcharge_cents
  then
    raise exception using errcode = '23514', message = 'Refund event does not advance the receipt exactly.';
  end if;
  if nullif(btrim(new.idempotency_key), '') is null or length(new.idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'A refund idempotency key is required.';
  end if;
  new.idempotency_key := btrim(new.idempotency_key);
  new.processor_event_id := btrim(new.processor_event_id);
  return new;
end;
$$;

drop trigger if exists payment_refund_events_guard on public.payment_refund_events;
create trigger payment_refund_events_guard
  before insert or update or delete on public.payment_refund_events
  for each row
  execute function public.tg_guard_payment_refund_event();

-- All rollups use original applied cash less exact cumulative reversals. A
-- fully refunded row remains queryable and contributes zero, while its
-- original receipt and refund events remain intact.
create or replace function public.reconcile_invoice_payment_rollups(
  p_invoice_ids uuid[],
  p_application_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice_ids uuid[] := array[]::uuid[];
  v_application_ids uuid[] := array[]::uuid[];
  v_invoice_id uuid;
  v_application_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_application public.billing_applications%rowtype;
  v_paid_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_paid_at timestamptz;
  v_invoice_status text;
  v_active_invoice_status text;
  v_previous_mode text := current_setting('overwatch.payment_rollup_mode', true);
  v_reconciled_invoices integer := 0;
  v_reconciled_applications integer := 0;
begin
  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
  into v_invoice_ids
  from unnest(coalesce(p_invoice_ids, array[]::uuid[])) id
  where id is not null;

  perform 1
  from public.billing_invoices invoice
  where invoice.id = any(v_invoice_ids)
  order by invoice.id
  for update;

  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
  into v_application_ids
  from (
    select id from unnest(coalesce(p_application_ids, array[]::uuid[])) id where id is not null
    union
    select invoice.billing_application_id
    from public.billing_invoices invoice
    where invoice.id = any(v_invoice_ids)
      and invoice.billing_application_id is not null
  ) affected;

  perform 1
  from public.billing_applications application
  where application.id = any(v_application_ids)
  order by application.id
  for update;
  perform set_config('overwatch.payment_rollup_mode', 'reconciling', true);

  foreach v_invoice_id in array v_invoice_ids
  loop
    select * into v_invoice
    from public.billing_invoices invoice
    where invoice.id = v_invoice_id;
    if found then
      select
        coalesce(sum(
          case when ledger.status in ('succeeded', 'refunded')
            then ledger.amount_cents - ledger.refunded_amount_cents else 0 end
        ), 0)::bigint,
        max(ledger.paid_at) filter (
          where ledger.status in ('succeeded', 'refunded')
            and ledger.amount_cents > ledger.refunded_amount_cents
        )
      into v_paid_cents, v_paid_at
      from public.payment_ledger ledger
      where ledger.invoice_id = v_invoice.id;

      v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
      v_invoice_status := case
        when v_invoice.status = 'void' then 'void'
        when v_total_due_cents > 0 and v_paid_cents >= v_total_due_cents then 'paid'
        when v_paid_cents > 0 then 'partially_paid'
        when v_invoice.status = 'draft' then 'draft'
        when v_invoice.status in ('sent', 'viewed', 'overdue') then v_invoice.status
        -- A full refund reopens a formerly paid/partial invoice. Recover the
        -- most specific lifecycle state supported by immutable delivery/view
        -- evidence instead of flattening every reopened invoice back to sent.
        when v_invoice.due_date is not null and v_invoice.due_date < current_date then 'overdue'
        when v_invoice.first_viewed_at is not null then 'viewed'
        else 'sent'
      end;
      update public.billing_invoices
      set paid_amount = v_paid_cents::numeric / 100.0,
          status = v_invoice_status,
          paid_at = case
            when v_invoice_status = 'void' then v_invoice.paid_at
            when v_invoice_status = 'paid' then coalesce(v_invoice.paid_at, v_paid_at, now())
            else null
          end
      where id = v_invoice.id;
      v_reconciled_invoices := v_reconciled_invoices + 1;
    end if;
  end loop;

  foreach v_application_id in array v_application_ids
  loop
    select * into v_application
    from public.billing_applications application
    where application.id = v_application_id;
    if found then
      select invoice.status,
        coalesce(sum(
          case when ledger.status in ('succeeded', 'refunded')
            then ledger.amount_cents - ledger.refunded_amount_cents else 0 end
        ), 0)::bigint
      into v_active_invoice_status, v_paid_cents
      from public.billing_invoices invoice
      left join public.payment_ledger ledger on ledger.invoice_id = invoice.id
      where invoice.billing_application_id = v_application.id
        and invoice.status <> 'void'
      group by invoice.id, invoice.status;

      if not found then
        v_active_invoice_status := null;
        v_paid_cents := 0;
      end if;
      update public.billing_applications
      set paid_to_date = v_paid_cents::numeric / 100.0,
          status = case
            when v_active_invoice_status = 'paid' then 'paid'
            when v_paid_cents > 0 then 'partial'
            when v_application.status in ('paid', 'partial')
              then case when v_active_invoice_status = 'draft' then 'draft' else 'submitted' end
            else v_application.status
          end
      where id = v_application.id;
      v_reconciled_applications := v_reconciled_applications + 1;
    end if;
  end loop;

  perform set_config(
    'overwatch.payment_rollup_mode',
    coalesce(v_previous_mode, 'immediate'),
    true
  );
  return jsonb_build_object(
    'invoiceCount', v_reconciled_invoices,
    'applicationCount', v_reconciled_applications
  );
end;
$$;

-- The invoice guard must use the same refund-aware cash equation as the
-- statement reconciler. Editing commercial terms may never lower total due
-- below already-applied, non-refunded cash; excess belongs in an explicit
-- refund or unapplied-credit workflow.
create or replace function public.tg_guard_billing_invoice_payment_rollup()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_paid_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_latest_paid_at timestamptz;
  v_canonical_status text;
begin
  if current_setting('overwatch.payment_rollup_mode', true) in ('deferred', 'reconciling') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if round(new.paid_amount * 100)::bigint <> 0
      or new.paid_at is not null
      or new.status in ('paid', 'partially_paid')
    then
      raise exception using
        errcode = '23514',
        message = 'New invoice payment fields must start empty; record received cash in the payment ledger.';
    end if;
    return new;
  end if;

  select
    coalesce(
      sum(ledger.amount_cents - ledger.refunded_amount_cents)
        filter (where ledger.status in ('succeeded', 'refunded')),
      0
    )::bigint,
    max(ledger.paid_at) filter (
      where ledger.status in ('succeeded', 'refunded')
        and ledger.amount_cents > ledger.refunded_amount_cents
    )
  into v_paid_cents, v_latest_paid_at
  from public.payment_ledger ledger
  where ledger.invoice_id = new.id;

  if new.status = 'void' then
    if v_paid_cents > 0 then
      raise exception using
        errcode = '23514',
        message = 'An invoice with succeeded payment cash cannot be voided.',
        hint = 'Refund or void the payment ledger entries first; the ledger trigger will reopen the balance.';
    end if;
    new.paid_amount := 0;
    new.paid_at := null;
    return new;
  end if;

  v_total_due_cents := round(new.total_due * 100)::bigint;
  if v_paid_cents > v_total_due_cents then
    raise exception using
      errcode = '23514',
      message = 'Invoice total due cannot be reduced below applied payment cash.',
      hint = 'Refund the excess or move it through an explicit unapplied-credit workflow before changing the invoice total.';
  end if;
  v_canonical_status := case
    when v_total_due_cents > 0 and v_paid_cents >= v_total_due_cents then 'paid'
    when v_paid_cents > 0 then 'partially_paid'
    when new.status = 'draft' then 'draft'
    else 'sent'
  end;

  if v_paid_cents = 0 and new.status in ('paid', 'partially_paid') then
    raise exception using
      errcode = '23514',
      message = 'Invoice paid status must come from succeeded payment ledger entries.';
  end if;
  if v_paid_cents = 0 and new.status in ('draft', 'sent', 'viewed', 'overdue') then
    new.paid_amount := 0;
    new.paid_at := null;
    return new;
  end if;

  new.paid_amount := v_paid_cents::numeric / 100.0;
  new.status := v_canonical_status;
  new.paid_at := case
    when v_canonical_status = 'paid' then coalesce(old.paid_at, v_latest_paid_at, now())
    else null
  end;
  return new;
end;
$$;

-- Replace the compatibility wrapper with a refund-aware parent-first command.
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
  v_existing public.payment_ledger%rowtype;
  v_payment_id uuid;
  v_organization_id uuid;
  v_application_previous_status text := '';
  v_paid_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_inserted boolean := false;
  v_previous_mode text := current_setting('overwatch.payment_rollup_mode', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to record an invoice payment.';
  end if;
  if p_amount_cents <= 0
    or p_amount_cents::numeric > 9007199254740991
    or p_processor_fee_cents < 0
    or p_processor_fee_cents::numeric > 9007199254740991
    or p_overwatch_fee_cents < 0
    or p_overwatch_fee_cents::numeric > 9007199254740991
    or p_processor_fee_cents::numeric + p_overwatch_fee_cents::numeric > p_amount_cents
  then
    raise exception using
      errcode = '22003',
      message = 'Payment amount and fee cents must remain within the exact safe-integer domain.';
  end if;
  if coalesce(nullif(btrim(p_processor), ''), 'manual') <> 'manual' then
    raise exception using
      errcode = '23514',
      message = 'Authenticated payment recording cannot claim processor provenance. Stripe cash uses the service-only command.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid payment idempotency key is required.';
  end if;
  if length(coalesce(p_payment_method, '')) > 100
    or length(coalesce(p_processor, '')) > 100
    or length(coalesce(p_processor_payment_id, '')) > 200
    or length(coalesce(p_reference, '')) > 200
    or length(coalesce(p_notes, '')) > 4000
  then
    raise exception using errcode = '22023', message = 'Payment details exceed their allowed length.';
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if not public.can_manage_project(v_invoice.project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to record this payment.';
  end if;
  if v_invoice.status not in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
    or not v_invoice.client_visible
    or v_invoice.sent_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Only an issued, client-visible invoice can receive a payment.';
  end if;
  select project.organization_id into v_organization_id
  from public.projects project where project.id = v_invoice.project_id;

  select * into v_existing
  from public.payment_ledger ledger
  where ledger.invoice_id = v_invoice.id
    and ledger.idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.amount_cents <> p_amount_cents
      or v_existing.processor_fee_cents <> p_processor_fee_cents
      or v_existing.overwatch_fee_cents <> p_overwatch_fee_cents
      or v_existing.payment_method <> coalesce(nullif(btrim(p_payment_method), ''), 'manual')
      or v_existing.processor <> coalesce(nullif(btrim(p_processor), ''), 'manual')
      or v_existing.processor_payment_id <> coalesce(p_processor_payment_id, '')
      or v_existing.reference <> coalesce(p_reference, '')
      or v_existing.notes <> coalesce(p_notes, '')
      or v_existing.paid_at is distinct from p_paid_at
    then
      raise exception using errcode = '22023', message = 'Payment idempotency key has different details.';
    end if;
    v_payment_id := v_existing.id;
  else
    select coalesce(sum(ledger.amount_cents - ledger.refunded_amount_cents), 0)::bigint
    into v_paid_cents
    from public.payment_ledger ledger
    where ledger.invoice_id = v_invoice.id
      and ledger.status in ('succeeded', 'refunded');
    v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
    if p_amount_cents > v_total_due_cents - v_paid_cents then
      raise exception using
        errcode = '23514',
        message = 'Payment would exceed the invoice total due.',
        hint = 'Record the remaining balance or use an explicit unapplied-credit workflow.';
    end if;
    if v_invoice.billing_application_id is not null then
      select status into v_application_previous_status
      from public.billing_applications
      where id = v_invoice.billing_application_id
      for update;
    end if;

    perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
    insert into public.payment_ledger (
      project_id, invoice_id, billing_application_id, organization_id,
      amount, amount_cents, surcharge, surcharge_cents,
      gross_received, gross_received_cents, processor_fee, processor_fee_cents,
      overwatch_fee, overwatch_fee_cents, net_payout, net_payout_cents,
      currency, payment_method, processor, processor_payment_id, reference,
      status, paid_at, notes, idempotency_key, created_by
    ) values (
      v_invoice.project_id, v_invoice.id, v_invoice.billing_application_id, v_organization_id,
      p_amount_cents::numeric / 100.0, p_amount_cents, 0, 0,
      p_amount_cents::numeric / 100.0, p_amount_cents,
      p_processor_fee_cents::numeric / 100.0, p_processor_fee_cents,
      p_overwatch_fee_cents::numeric / 100.0, p_overwatch_fee_cents,
      (p_amount_cents - p_processor_fee_cents - p_overwatch_fee_cents)::numeric / 100.0,
      p_amount_cents - p_processor_fee_cents - p_overwatch_fee_cents,
      'usd', coalesce(nullif(btrim(p_payment_method), ''), 'manual'),
      coalesce(nullif(btrim(p_processor), ''), 'manual'), coalesce(p_processor_payment_id, ''),
      coalesce(p_reference, ''), 'succeeded', coalesce(p_paid_at, now()),
      coalesce(p_notes, ''), btrim(p_idempotency_key), auth.uid()
    ) returning id into v_payment_id;
    v_inserted := true;
  end if;

  perform public.reconcile_invoice_payment_rollups(
    array[v_invoice.id],
    case when v_invoice.billing_application_id is null
      then array[]::uuid[] else array[v_invoice.billing_application_id] end
  );
  select round(invoice.paid_amount * 100)::bigint
  into v_paid_cents from public.billing_invoices invoice where invoice.id = v_invoice.id;
  if v_inserted and v_invoice.billing_application_id is not null then
    insert into public.billing_application_events (
      billing_application_id, project_id, event_type, from_status, to_status,
      amount, notes, created_by
    ) select
      v_invoice.billing_application_id, v_invoice.project_id, 'payment_update',
      coalesce(v_application_previous_status, ''), application.status,
      v_paid_cents::numeric / 100.0,
      'Invoice payment recorded: ' || coalesce(nullif(p_notes, ''), 'manual payment'),
      auth.uid()
    from public.billing_applications application
    where application.id = v_invoice.billing_application_id;
  end if;
  perform set_config('overwatch.payment_rollup_mode', coalesce(v_previous_mode, 'immediate'), true);
  select * into v_invoice from public.billing_invoices where id = v_invoice.id;
  return jsonb_build_object(
    'paymentId', v_payment_id, 'paidAmount', v_invoice.paid_amount,
    'status', v_invoice.status, 'deduplicated', not v_inserted
  );
end;
$$;

-- Cumulative Stripe refund amounts become idempotent delta events. Surcharge
-- cash reverses before invoice-applied cash, matching the checkout model.
create or replace function public.refund_invoice_payment_atomic(
  p_payment_id uuid,
  p_cumulative_refunded_gross_cents bigint,
  p_notes text default '',
  p_processor_event_id text default '',
  p_idempotency_key text default null,
  p_stripe_charge_id text default '',
  p_receipt_url text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_payment public.payment_ledger%rowtype;
  v_existing public.payment_refund_events%rowtype;
  v_invoice_id uuid;
  v_project_id uuid;
  v_target_refunded_amount bigint;
  v_target_refunded_surcharge bigint;
  v_delta_gross bigint;
  v_delta_amount bigint;
  v_delta_surcharge bigint;
  v_remaining_gross bigint;
  v_status text;
  v_fingerprint text;
  v_is_service boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  v_previous_command text := current_setting('overwatch.payment_ledger_command', true);
begin
  if auth.uid() is null and not v_is_service then
    raise exception using errcode = '42501', message = 'Authentication is required to refund a payment.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid refund idempotency key is required.';
  end if;
  if p_cumulative_refunded_gross_cents is null
    or p_cumulative_refunded_gross_cents < 0
    or p_cumulative_refunded_gross_cents > 9007199254740991
  then
    raise exception using
      errcode = '22003',
      message = 'Cumulative refund must be exact cents within the safe accounting range.';
  end if;
  if length(coalesce(p_notes, '')) > 4000
    or length(coalesce(p_processor_event_id, '')) > 300
    or length(coalesce(p_stripe_charge_id, '')) > 300
    or length(coalesce(p_receipt_url, '')) > 2000
  then
    raise exception using errcode = '22023', message = 'Refund details exceed their allowed length.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_payment_id,
    p_cumulative_refunded_gross_cents,
    coalesce(p_notes, ''),
    btrim(coalesce(p_processor_event_id, '')),
    btrim(coalesce(p_stripe_charge_id, '')),
    btrim(coalesce(p_receipt_url, ''))
  )::text);

  select ledger.invoice_id, ledger.project_id
  into v_invoice_id, v_project_id
  from public.payment_ledger ledger where ledger.id = p_payment_id;
  if not found then raise exception using errcode = 'P0002', message = 'Payment not found.'; end if;
  if auth.uid() is not null and not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to refund this payment.';
  end if;

  perform 1 from public.billing_invoices invoice where invoice.id = v_invoice_id for update;
  select * into v_payment
  from public.payment_ledger ledger where ledger.id = p_payment_id for update;
  if v_payment.processor in ('stripe', 'stripe_connect') and not v_is_service then
    raise exception using
      errcode = '42501',
      message = 'Stripe receipt refunds require the service-role webhook command.';
  end if;
  if v_payment.processor not in ('stripe', 'stripe_connect') and v_is_service then
    raise exception using
      errcode = '42501',
      message = 'The Stripe webhook command cannot refund a manual receipt.';
  end if;
  if v_payment.processor not in ('stripe', 'stripe_connect') and (
    nullif(btrim(p_stripe_charge_id), '') is not null
    or nullif(btrim(p_receipt_url), '') is not null
  ) then
    raise exception using
      errcode = '23514',
      message = 'Manual refunds cannot attach Stripe receipt provenance.';
  end if;
  if nullif(v_payment.stripe_charge_id, '') is not null
    and nullif(btrim(p_stripe_charge_id), '') is not null
    and btrim(p_stripe_charge_id) <> v_payment.stripe_charge_id
  then
    raise exception using errcode = '23514', message = 'Stripe charge ID does not match the original receipt.';
  end if;
  if nullif(v_payment.receipt_url, '') is not null
    and nullif(btrim(p_receipt_url), '') is not null
    and btrim(p_receipt_url) <> v_payment.receipt_url
  then
    raise exception using errcode = '23514', message = 'Stripe receipt URL does not match the original receipt.';
  end if;

  -- A retry may enrich evidence that was genuinely absent, but it can never
  -- replace prior evidence. Perform this before all deduplicated/equal-current
  -- returns so those paths validate the same immutable provenance contract.
  if v_payment.processor in ('stripe', 'stripe_connect') and (
    (nullif(v_payment.stripe_charge_id, '') is null
      and nullif(btrim(p_stripe_charge_id), '') is not null)
    or (nullif(v_payment.receipt_url, '') is null
      and nullif(btrim(p_receipt_url), '') is not null)
  ) then
    perform set_config('overwatch.payment_ledger_command', 'refund', true);
    update public.payment_ledger
    set stripe_charge_id = coalesce(
          nullif(stripe_charge_id, ''), nullif(btrim(p_stripe_charge_id), ''), ''
        ),
        receipt_url = coalesce(
          nullif(receipt_url, ''), nullif(btrim(p_receipt_url), ''), ''
        )
    where id = v_payment.id;
    perform set_config(
      'overwatch.payment_ledger_command',
      coalesce(v_previous_command, 'none'),
      true
    );
    select * into v_payment
    from public.payment_ledger ledger where ledger.id = p_payment_id for update;
  end if;

  select * into v_existing
  from public.payment_refund_events event
  where event.payment_id = v_payment.id
    and event.idempotency_key = btrim(p_idempotency_key)
  for update;
  if found then
    if v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '22023', message = 'Refund idempotency key has different details.';
    end if;
    return jsonb_build_object(
      'paymentId', v_payment.id, 'refundEventId', v_existing.id,
      'status', v_payment.status,
      'remainingAmountCents', v_payment.amount_cents - v_payment.refunded_amount_cents,
      'deduplicated', true
    );
  end if;

  if p_cumulative_refunded_gross_cents < v_payment.refunded_gross_cents then
    raise exception using errcode = '22023', message = 'A stale cumulative refund cannot reverse newer history.';
  end if;
  if p_cumulative_refunded_gross_cents = v_payment.refunded_gross_cents then
    return jsonb_build_object(
      'paymentId', v_payment.id, 'status', v_payment.status,
      'remainingAmountCents', v_payment.amount_cents - v_payment.refunded_amount_cents,
      'deduplicated', true
    );
  end if;
  if p_cumulative_refunded_gross_cents <= 0
    or p_cumulative_refunded_gross_cents > v_payment.gross_received_cents
  then
    raise exception using errcode = '22023', message = 'Cumulative refund exceeds the original gross receipt.';
  end if;
  if v_payment.status not in ('succeeded', 'refunded') then
    raise exception using errcode = '23514', message = 'Only succeeded receipt cash can be refunded.';
  end if;
  v_remaining_gross := v_payment.gross_received_cents - p_cumulative_refunded_gross_cents;
  v_target_refunded_amount := v_payment.amount_cents - least(v_payment.amount_cents, v_remaining_gross);
  v_target_refunded_surcharge := p_cumulative_refunded_gross_cents - v_target_refunded_amount;
  v_delta_gross := p_cumulative_refunded_gross_cents - v_payment.refunded_gross_cents;
  v_delta_amount := v_target_refunded_amount - v_payment.refunded_amount_cents;
  v_delta_surcharge := v_target_refunded_surcharge - v_payment.refunded_surcharge_cents;
  v_status := case
    when p_cumulative_refunded_gross_cents = v_payment.gross_received_cents then 'refunded'
    else 'succeeded'
  end;

  insert into public.payment_refund_events (
    payment_id, invoice_id, project_id, billing_application_id, organization_id,
    refund_gross_cents, refund_amount_cents, refund_surcharge_cents,
    cumulative_refunded_gross_cents, processor, processor_event_id,
    idempotency_key, stripe_charge_id, receipt_url, request_fingerprint,
    notes, created_by
  ) values (
    v_payment.id, v_payment.invoice_id, v_payment.project_id,
    v_payment.billing_application_id, v_payment.organization_id,
    v_delta_gross, v_delta_amount, v_delta_surcharge,
    p_cumulative_refunded_gross_cents, v_payment.processor,
    btrim(coalesce(p_processor_event_id, '')), btrim(p_idempotency_key),
    btrim(coalesce(p_stripe_charge_id, '')),
    btrim(coalesce(p_receipt_url, '')),
    v_fingerprint,
    coalesce(p_notes, ''), auth.uid()
  );

  perform set_config('overwatch.payment_ledger_command', 'refund', true);
  update public.payment_ledger
  set status = v_status,
      refunded_amount_cents = v_target_refunded_amount,
      refunded_surcharge_cents = v_target_refunded_surcharge,
      refunded_gross_cents = p_cumulative_refunded_gross_cents,
      stripe_charge_id = coalesce(
        nullif(stripe_charge_id, ''), nullif(btrim(p_stripe_charge_id), ''), ''
      ),
      receipt_url = coalesce(
        nullif(receipt_url, ''), nullif(btrim(p_receipt_url), ''), ''
      )
  where id = v_payment.id;
  perform set_config(
    'overwatch.payment_ledger_command',
    coalesce(v_previous_command, 'none'),
    true
  );

  return jsonb_build_object(
    'paymentId', v_payment.id, 'status', v_status,
    'remainingAmountCents', v_payment.amount_cents - v_target_refunded_amount,
    'cumulativeRefundedGrossCents', p_cumulative_refunded_gross_cents,
    'deduplicated', false
  );
end;
$$;

revoke all on function public.tg_guard_payment_refund_event()
  from public, anon, authenticated, service_role;
revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public, anon, service_role;
grant execute on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) to authenticated;
revoke all on function public.refund_invoice_payment_atomic(
  uuid, bigint, text, text, text, text, text
) from public, anon;
grant execute on function public.refund_invoice_payment_atomic(
  uuid, bigint, text, text, text, text, text
) to authenticated, service_role;
