-- Verified Stripe fee economics and immutable receipt provenance.
--
-- A card surcharge is a customer-facing estimate. It is never treated as the
-- processor's actual fee. For Stripe Connect direct charges, actual fee and
-- net-to-balance truth comes from the connected account's charge balance
-- transaction. Historical Stripe rows remain explicitly unverified until a
-- verified webhook retry supplies that evidence.

alter table public.payment_ledger
  add column if not exists processor_fee_source text not null default 'legacy_unverified',
  add column if not exists stripe_balance_transaction_id text not null default '',
  add column if not exists processor_fee_observed_at timestamptz;

-- The preceding migration's immutable-history trigger correctly rejects
-- ordinary provenance edits. Disable only that trigger for this one
-- deterministic, transaction-scoped classification backfill; any migration
-- failure rolls the trigger state and data back together. The backfill is
-- strictly additive: it classifies only manual rows still missing their
-- provenance value, and never touches a Stripe row, so a replay can never
-- rewrite verified balance-transaction fee evidence. Stripe rows keep the
-- legacy_unverified column default until a verified webhook retry upgrades
-- them.
alter table public.payment_ledger disable trigger payment_ledger_guard_history;

update public.payment_ledger
set processor_fee_source = 'manual_record',
    stripe_balance_transaction_id = '',
    processor_fee_observed_at = null
where processor = 'manual'
  and (
    processor_fee_source <> 'manual_record'
    or btrim(stripe_balance_transaction_id) <> ''
    or processor_fee_observed_at is not null
  );

alter table public.payment_ledger enable trigger payment_ledger_guard_history;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'payment_ledger_fee_provenance_check'
      and conrelid = 'public.payment_ledger'::regclass
  ) then
    alter table public.payment_ledger
      add constraint payment_ledger_fee_provenance_check check (
        processor_fee_source in (
          'manual_record',
          'stripe_balance_transaction',
          'legacy_unverified'
        )
        and (
          (
            processor in ('stripe', 'stripe_connect')
            and (
              (
                processor_fee_source = 'legacy_unverified'
                and btrim(stripe_balance_transaction_id) = ''
                and processor_fee_observed_at is null
              )
              or (
                processor_fee_source = 'stripe_balance_transaction'
                and btrim(stripe_balance_transaction_id) <> ''
                and processor_fee_observed_at is not null
              )
            )
          )
          or (
            processor = 'manual'
            and processor_fee_source = 'manual_record'
            and btrim(stripe_balance_transaction_id) = ''
            and processor_fee_observed_at is null
          )
        )
      );
  end if;
end $$;

create unique index if not exists payment_ledger_stripe_balance_transaction_unique
  on public.payment_ledger (btrim(stripe_balance_transaction_id))
  where btrim(stripe_balance_transaction_id) <> '';

comment on column public.payment_ledger.surcharge_cents is
  'Customer-paid surcharge cents. For cards this is an estimate and is not the processor actual fee.';
comment on column public.payment_ledger.processor_fee_cents is
  'Actual processor deductions in cents. Stripe values require connected-account balance-transaction evidence.';
comment on column public.payment_ledger.overwatch_fee_cents is
  'Actual application-fee cents from the same Stripe balance transaction, or the recorded manual fee.';
comment on column public.payment_ledger.net_payout_cents is
  'Net receipt to the connected Stripe balance (gross less all Stripe and application fees), not a bank payout.';
comment on column public.payment_ledger.processor_fee_source is
  'Fee provenance: manual_record, stripe_balance_transaction, or legacy_unverified.';

-- Harden the history trigger's controlled paths. Identifier enrichment may
-- only fill blank identifiers. Fee observation may only make a one-way
-- legacy-unverified -> verified transition while changing fee projections.
create or replace function public.tg_guard_payment_ledger_history()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_command text := current_setting('overwatch.payment_ledger_command', true);
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
    if new.processor = 'manual' then
      if new.status <> 'succeeded' then
        raise exception using errcode = '23514', message = 'A manual payment must start succeeded.';
      end if;
      new.processor_fee_source := 'manual_record';
      new.stripe_balance_transaction_id := '';
      new.processor_fee_observed_at := null;
    else
      if new.status not in ('pending', 'succeeded') then
        raise exception using errcode = '23514', message = 'A Stripe payment must start pending or succeeded.';
      end if;
      if new.processor_fee_source <> 'stripe_balance_transaction'
        or nullif(btrim(new.stripe_balance_transaction_id), '') is null
        or new.processor_fee_observed_at is null
      then
        raise exception using
          errcode = '23514',
          message = 'A Stripe payment requires verified balance-transaction fee evidence.';
      end if;
    end if;
    return new;
  end if;

  if v_command = 'stripe_enrich' then
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
      or (
        new.stripe_charge_id is distinct from old.stripe_charge_id
        and nullif(old.stripe_charge_id, '') is not null
      )
      or (
        new.receipt_url is distinct from old.receipt_url
        and nullif(old.receipt_url, '') is not null
      )
      or new.project_id is distinct from old.project_id
      or new.invoice_id is distinct from old.invoice_id
      or new.billing_application_id is distinct from old.billing_application_id
      or new.organization_id is distinct from old.organization_id
      or new.amount is distinct from old.amount
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
      or new.processor_fee_source is distinct from old.processor_fee_source
      or new.stripe_balance_transaction_id is distinct from old.stripe_balance_transaction_id
      or new.processor_fee_observed_at is distinct from old.processor_fee_observed_at
      or new.processor is distinct from old.processor
      or new.payment_method is distinct from old.payment_method
      or new.currency is distinct from old.currency
      or new.reference is distinct from old.reference
      or new.paid_at is distinct from old.paid_at
      or new.idempotency_key is distinct from old.idempotency_key
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.status is distinct from old.status
      or new.notes is distinct from old.notes
    then
      raise exception using
        errcode = '23514',
        message = 'Stripe identifiers can only fill previously blank receipt provenance.';
    end if;
    return new;
  end if;

  if v_command = 'stripe_fee_observation' then
    if old.processor not in ('stripe', 'stripe_connect')
      or old.processor_fee_source <> 'legacy_unverified'
      or new.processor_fee_source <> 'stripe_balance_transaction'
      or nullif(btrim(new.stripe_balance_transaction_id), '') is null
      or new.processor_fee_observed_at is null
      or new.project_id is distinct from old.project_id
      or new.invoice_id is distinct from old.invoice_id
      or new.billing_application_id is distinct from old.billing_application_id
      or new.organization_id is distinct from old.organization_id
      or new.amount is distinct from old.amount
      or new.amount_cents is distinct from old.amount_cents
      or new.surcharge is distinct from old.surcharge
      or new.surcharge_cents is distinct from old.surcharge_cents
      or new.gross_received is distinct from old.gross_received
      or new.gross_received_cents is distinct from old.gross_received_cents
      or new.refunded_amount_cents is distinct from old.refunded_amount_cents
      or new.refunded_surcharge_cents is distinct from old.refunded_surcharge_cents
      or new.refunded_gross_cents is distinct from old.refunded_gross_cents
      or new.processor is distinct from old.processor
      or new.payment_method is distinct from old.payment_method
      or new.processor_payment_id is distinct from old.processor_payment_id
      or new.currency is distinct from old.currency
      or new.reference is distinct from old.reference
      or new.paid_at is distinct from old.paid_at
      or new.idempotency_key is distinct from old.idempotency_key
      or new.created_by is distinct from old.created_by
      or new.created_at is distinct from old.created_at
      or new.status is distinct from old.status
      or new.notes is distinct from old.notes
      or new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id
      or new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id
      or new.stripe_charge_id is distinct from old.stripe_charge_id
      or new.receipt_url is distinct from old.receipt_url
    then
      raise exception using
        errcode = '23514',
        message = 'Stripe fee evidence can only verify a legacy unverified receipt.';
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
    or (
      nullif(old.stripe_charge_id, '') is not null
      and new.stripe_charge_id is distinct from old.stripe_charge_id
    )
    or (
      nullif(old.receipt_url, '') is not null
      and new.receipt_url is distinct from old.receipt_url
    )
    or new.processor_fee_source is distinct from old.processor_fee_source
    or new.stripe_balance_transaction_id is distinct from old.stripe_balance_transaction_id
    or new.processor_fee_observed_at is distinct from old.processor_fee_observed_at
  then
    raise exception using
      errcode = '23514',
      message = 'Payment ownership and processor provenance are immutable.';
  end if;

  if v_command in ('refund', 'void') then
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

-- Remove the pre-evidence overload so PostgREST has one unambiguous Stripe
-- booking command. The new leading required arguments are the connected
-- account balance transaction evidence.
drop function if exists public.record_stripe_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz,
  text, text, text, text, text, text, text, text
);

create or replace function public.record_stripe_invoice_payment_atomic(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_stripe_balance_transaction_id text,
  p_balance_transaction_gross_cents bigint,
  p_balance_transaction_fee_cents bigint,
  p_balance_transaction_net_cents bigint,
  p_balance_transaction_currency text,
  p_surcharge_cents bigint default 0,
  p_gross_received_cents bigint default null,
  p_overwatch_fee_cents bigint default 0,
  p_paid_at timestamptz default now(),
  p_payment_method text default 'stripe_checkout',
  p_processor_payment_id text default '',
  p_reference text default '',
  p_notes text default '',
  p_checkout_session_id text default '',
  p_payment_intent_id text default '',
  p_charge_id text default '',
  p_receipt_url text default '',
  p_cumulative_refunded_gross_cents bigint default 0,
  p_refund_processor_event_id text default '',
  p_refund_idempotency_key text default ''
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
  v_checkout_payment_id uuid;
  v_intent_payment_id uuid;
  v_processor_payment_row_id uuid;
  v_balance_payment_id uuid;
  v_organization_id uuid;
  v_external_key text;
  v_idempotency_key text;
  v_processor_fee_cents bigint;
  v_recovery_refunded_amount_cents bigint := 0;
  v_net_applied_amount_cents bigint := 0;
  v_succeeded_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_previous_mode text := current_setting('overwatch.payment_rollup_mode', true);
  v_previous_command text := current_setting('overwatch.payment_ledger_command', true);
  v_inserted boolean := false;
  v_refund_result jsonb;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Stripe payment booking requires the service role.';
  end if;
  if p_amount_cents <= 0
    or p_amount_cents::numeric > 9007199254740991
    or p_surcharge_cents < 0
    or p_surcharge_cents::numeric > 9007199254740991
    or p_gross_received_cents is null
    or p_gross_received_cents::numeric > 9007199254740991
    or p_gross_received_cents::numeric
       <> p_amount_cents::numeric + p_surcharge_cents::numeric
    or p_balance_transaction_gross_cents < 0
    or p_balance_transaction_gross_cents::numeric > 9007199254740991
    or p_balance_transaction_gross_cents <> p_gross_received_cents
    or p_balance_transaction_fee_cents < 0
    or p_balance_transaction_fee_cents::numeric > 9007199254740991
    or p_overwatch_fee_cents < 0
    or p_overwatch_fee_cents::numeric > 9007199254740991
    or p_balance_transaction_fee_cents < p_overwatch_fee_cents
    or p_balance_transaction_fee_cents > p_balance_transaction_gross_cents
    or p_balance_transaction_net_cents < 0
    or p_balance_transaction_net_cents::numeric > 9007199254740991
    or p_balance_transaction_net_cents
       <> p_balance_transaction_gross_cents - p_balance_transaction_fee_cents
    or lower(btrim(coalesce(p_balance_transaction_currency, ''))) <> 'usd'
    or p_cumulative_refunded_gross_cents < 0
    or p_cumulative_refunded_gross_cents::numeric > 9007199254740991
    or p_cumulative_refunded_gross_cents > p_balance_transaction_gross_cents
    or p_paid_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Stripe balance-transaction gross, fee, net, currency, or application fee is invalid.';
  end if;
  v_processor_fee_cents := p_balance_transaction_fee_cents - p_overwatch_fee_cents;
  if nullif(btrim(p_stripe_balance_transaction_id), '') is null
    or length(p_stripe_balance_transaction_id) > 300
    or nullif(btrim(p_payment_method), '') is null
    or length(p_payment_method) > 100
    or length(coalesce(p_processor_payment_id, '')) > 200
    or length(coalesce(p_reference, '')) > 200
    or length(coalesce(p_notes, '')) > 4000
    or length(coalesce(p_checkout_session_id, '')) > 300
    or length(coalesce(p_payment_intent_id, '')) > 300
    or length(coalesce(p_charge_id, '')) > 300
    or length(coalesce(p_receipt_url, '')) > 2000
    or length(coalesce(p_refund_processor_event_id, '')) > 300
    or length(coalesce(p_refund_idempotency_key, '')) > 200
  then
    raise exception using errcode = '22023', message = 'Stripe payment evidence is missing or exceeds its allowed length.';
  end if;
  if p_cumulative_refunded_gross_cents > 0 and (
    nullif(btrim(p_refund_processor_event_id), '') is null
    or nullif(btrim(p_refund_idempotency_key), '') is null
  ) then
    raise exception using
      errcode = '22023',
      message = 'Refund-aware Stripe recovery requires stable event and idempotency keys.';
  end if;
  v_recovery_refunded_amount_cents := p_amount_cents
    - least(
        p_amount_cents,
        p_gross_received_cents - p_cumulative_refunded_gross_cents
      );
  v_net_applied_amount_cents := p_amount_cents - v_recovery_refunded_amount_cents;

  v_external_key := coalesce(
    nullif(btrim(p_checkout_session_id), ''),
    nullif(btrim(p_payment_intent_id), ''),
    nullif(btrim(p_processor_payment_id), ''),
    nullif(btrim(p_stripe_balance_transaction_id), '')
  );
  if v_external_key is null or length(v_external_key) > 193 then
    raise exception using
      errcode = '22023',
      message = 'A stable Stripe payment identifier of at most 193 characters is required.';
  end if;
  v_idempotency_key := 'stripe:' || v_external_key;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if v_invoice.status not in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
    or not v_invoice.client_visible
    or v_invoice.sent_at is null
  then
    raise exception using
      errcode = '22023',
      message = 'Only an issued, client-visible invoice can receive a Stripe payment.';
  end if;
  select project.organization_id into v_organization_id
  from public.projects project where project.id = v_invoice.project_id;

  if nullif(btrim(p_checkout_session_id), '') is not null then
    select ledger.id into v_checkout_payment_id
    from public.payment_ledger ledger
    where btrim(ledger.stripe_checkout_session_id) = btrim(p_checkout_session_id);
  end if;
  if nullif(btrim(p_payment_intent_id), '') is not null then
    select ledger.id into v_intent_payment_id
    from public.payment_ledger ledger
    where btrim(ledger.stripe_payment_intent_id) = btrim(p_payment_intent_id);
  end if;
  if nullif(btrim(p_processor_payment_id), '') is not null then
    select ledger.id into v_processor_payment_row_id
    from public.payment_ledger ledger
    where ledger.processor in ('stripe', 'stripe_connect')
      and btrim(ledger.processor_payment_id) = btrim(p_processor_payment_id);
  end if;
  select ledger.id into v_balance_payment_id
  from public.payment_ledger ledger
  where btrim(ledger.stripe_balance_transaction_id) = btrim(p_stripe_balance_transaction_id);

  if (v_checkout_payment_id is not null and v_intent_payment_id is not null
       and v_checkout_payment_id <> v_intent_payment_id)
    or (v_checkout_payment_id is not null and v_processor_payment_row_id is not null
       and v_checkout_payment_id <> v_processor_payment_row_id)
    or (v_checkout_payment_id is not null and v_balance_payment_id is not null
       and v_checkout_payment_id <> v_balance_payment_id)
    or (v_intent_payment_id is not null and v_processor_payment_row_id is not null
       and v_intent_payment_id <> v_processor_payment_row_id)
    or (v_intent_payment_id is not null and v_balance_payment_id is not null
       and v_intent_payment_id <> v_balance_payment_id)
    or (v_processor_payment_row_id is not null and v_balance_payment_id is not null
       and v_processor_payment_row_id <> v_balance_payment_id)
  then
    raise exception using errcode = '23514', message = 'Stripe identifiers resolve to different payment receipts.';
  end if;

  v_payment_id := coalesce(
    v_checkout_payment_id,
    v_intent_payment_id,
    v_processor_payment_row_id,
    v_balance_payment_id
  );
  if v_payment_id is not null then
    select * into v_existing
    from public.payment_ledger ledger where ledger.id = v_payment_id for update;
  else
    select * into v_existing
    from public.payment_ledger ledger
    where ledger.invoice_id = v_invoice.id
      and ledger.idempotency_key = v_idempotency_key
    for update;
  end if;

  if found then
    if v_existing.invoice_id <> v_invoice.id
      or v_existing.status not in ('succeeded', 'refunded')
      or v_existing.amount_cents <> p_amount_cents
      or v_existing.surcharge_cents <> p_surcharge_cents
      or v_existing.gross_received_cents <> p_gross_received_cents
      or v_existing.payment_method <> btrim(p_payment_method)
      or v_existing.processor not in ('stripe', 'stripe_connect')
      or lower(v_existing.currency) <> lower(btrim(p_balance_transaction_currency))
      or v_existing.reference <> coalesce(p_reference, '')
      or v_existing.notes <> coalesce(p_notes, '')
      or v_existing.paid_at is distinct from p_paid_at
      or (
        nullif(v_existing.processor_payment_id, '') is not null
        and nullif(btrim(p_processor_payment_id), '') is not null
        and v_existing.processor_payment_id <> btrim(p_processor_payment_id)
      )
      or (
        nullif(v_existing.stripe_checkout_session_id, '') is not null
        and nullif(btrim(p_checkout_session_id), '') is not null
        and v_existing.stripe_checkout_session_id <> btrim(p_checkout_session_id)
      )
      or (
        nullif(v_existing.stripe_payment_intent_id, '') is not null
        and nullif(btrim(p_payment_intent_id), '') is not null
        and v_existing.stripe_payment_intent_id <> btrim(p_payment_intent_id)
      )
      or (
        nullif(v_existing.stripe_charge_id, '') is not null
        and nullif(btrim(p_charge_id), '') is not null
        and v_existing.stripe_charge_id <> btrim(p_charge_id)
      )
      or (
        nullif(v_existing.receipt_url, '') is not null
        and nullif(btrim(p_receipt_url), '') is not null
        and v_existing.receipt_url <> btrim(p_receipt_url)
      )
      or (
        v_existing.processor_fee_source = 'stripe_balance_transaction'
        and (
          v_existing.processor_fee_cents <> v_processor_fee_cents
          or v_existing.overwatch_fee_cents <> p_overwatch_fee_cents
          or v_existing.net_payout_cents <> p_balance_transaction_net_cents
          or btrim(v_existing.stripe_balance_transaction_id)
             <> btrim(p_stripe_balance_transaction_id)
        )
      )
    then
      raise exception using
        errcode = '22023',
        message = 'This Stripe payment identifier was already used for different payment details.';
    end if;
    v_payment_id := v_existing.id;

    if (
      nullif(v_existing.stripe_checkout_session_id, '') is null
      and nullif(btrim(p_checkout_session_id), '') is not null
    ) or (
      nullif(v_existing.stripe_payment_intent_id, '') is null
      and nullif(btrim(p_payment_intent_id), '') is not null
    ) or (
      nullif(v_existing.processor_payment_id, '') is null
      and nullif(btrim(p_processor_payment_id), '') is not null
    ) or (
      nullif(v_existing.stripe_charge_id, '') is null
      and nullif(btrim(p_charge_id), '') is not null
    ) or (
      nullif(v_existing.receipt_url, '') is null
      and nullif(btrim(p_receipt_url), '') is not null
    ) then
      perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
      perform set_config('overwatch.payment_ledger_command', 'stripe_enrich', true);
      update public.payment_ledger
      set stripe_checkout_session_id = coalesce(
            nullif(stripe_checkout_session_id, ''), btrim(coalesce(p_checkout_session_id, ''))
          ),
          stripe_payment_intent_id = coalesce(
            nullif(stripe_payment_intent_id, ''), btrim(coalesce(p_payment_intent_id, ''))
          ),
          processor_payment_id = coalesce(
            nullif(processor_payment_id, ''), btrim(coalesce(p_processor_payment_id, ''))
          ),
          stripe_charge_id = coalesce(
            nullif(stripe_charge_id, ''), btrim(coalesce(p_charge_id, ''))
          ),
          receipt_url = coalesce(
            nullif(receipt_url, ''), btrim(coalesce(p_receipt_url, ''))
          )
      where id = v_existing.id;
      perform set_config('overwatch.payment_ledger_command', coalesce(v_previous_command, 'none'), true);
    end if;

    if v_existing.processor_fee_source = 'legacy_unverified' then
      perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
      perform set_config('overwatch.payment_ledger_command', 'stripe_fee_observation', true);
      update public.payment_ledger
      set processor_fee = v_processor_fee_cents::numeric / 100.0,
          processor_fee_cents = v_processor_fee_cents,
          overwatch_fee = p_overwatch_fee_cents::numeric / 100.0,
          overwatch_fee_cents = p_overwatch_fee_cents,
          net_payout = p_balance_transaction_net_cents::numeric / 100.0,
          net_payout_cents = p_balance_transaction_net_cents,
          processor_fee_source = 'stripe_balance_transaction',
          stripe_balance_transaction_id = btrim(p_stripe_balance_transaction_id),
          processor_fee_observed_at = now()
      where id = v_existing.id;
      perform set_config('overwatch.payment_ledger_command', coalesce(v_previous_command, 'none'), true);
    end if;
  else
    select coalesce(sum(ledger.amount_cents - ledger.refunded_amount_cents), 0)::bigint
    into v_succeeded_cents
    from public.payment_ledger ledger
    where ledger.invoice_id = v_invoice.id
      and ledger.status in ('succeeded', 'refunded');
    v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
    if v_net_applied_amount_cents > v_total_due_cents - v_succeeded_cents then
      raise exception using
        errcode = '23514',
        message = 'Stripe payment would exceed the invoice total due.',
        hint = 'Cancel the duplicate checkout or book the excess through an explicit unapplied-credit workflow.';
    end if;

    perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
    insert into public.payment_ledger (
      project_id, invoice_id, billing_application_id, organization_id,
      amount, amount_cents, surcharge, surcharge_cents,
      gross_received, gross_received_cents, processor_fee, processor_fee_cents,
      overwatch_fee, overwatch_fee_cents, net_payout, net_payout_cents,
      processor_fee_source, stripe_balance_transaction_id, processor_fee_observed_at,
      currency, payment_method, processor, processor_payment_id, reference,
      status, paid_at, notes, idempotency_key, stripe_checkout_session_id,
      stripe_payment_intent_id, stripe_charge_id, receipt_url
    ) values (
      v_invoice.project_id, v_invoice.id, v_invoice.billing_application_id, v_organization_id,
      p_amount_cents::numeric / 100.0, p_amount_cents,
      p_surcharge_cents::numeric / 100.0, p_surcharge_cents,
      p_gross_received_cents::numeric / 100.0, p_gross_received_cents,
      v_processor_fee_cents::numeric / 100.0, v_processor_fee_cents,
      p_overwatch_fee_cents::numeric / 100.0, p_overwatch_fee_cents,
      p_balance_transaction_net_cents::numeric / 100.0, p_balance_transaction_net_cents,
      'stripe_balance_transaction', btrim(p_stripe_balance_transaction_id), now(),
      'usd', btrim(p_payment_method), 'stripe',
      coalesce(nullif(btrim(p_processor_payment_id), ''), v_external_key),
      coalesce(p_reference, ''), 'succeeded', coalesce(p_paid_at, now()),
      coalesce(p_notes, ''), v_idempotency_key,
      btrim(coalesce(p_checkout_session_id, '')),
      btrim(coalesce(p_payment_intent_id, '')),
      btrim(coalesce(p_charge_id, '')),
      btrim(coalesce(p_receipt_url, ''))
    ) returning id into v_payment_id;
    v_inserted := true;
  end if;

  if p_cumulative_refunded_gross_cents > 0 then
    select public.refund_invoice_payment_atomic(
      v_payment_id,
      p_cumulative_refunded_gross_cents,
      'Stripe reconciliation recovered the original receipt and linked refund history.',
      btrim(p_refund_processor_event_id),
      btrim(p_refund_idempotency_key),
      btrim(coalesce(p_charge_id, '')),
      btrim(coalesce(p_receipt_url, ''))
    ) into v_refund_result;
  end if;

  perform public.reconcile_invoice_payment_rollups(
    array[v_invoice.id],
    case when v_invoice.billing_application_id is null
      then array[]::uuid[] else array[v_invoice.billing_application_id] end
  );
  perform set_config('overwatch.payment_rollup_mode', coalesce(v_previous_mode, 'immediate'), true);
  select * into v_invoice from public.billing_invoices where id = v_invoice.id;
  return jsonb_build_object(
    'paymentId', v_payment_id,
    'paidAmount', v_invoice.paid_amount,
    'status', v_invoice.status,
    'netToStripeBalanceCents', p_balance_transaction_net_cents,
    'refundedGrossCents', p_cumulative_refunded_gross_cents,
    'netAppliedAmountCents', v_net_applied_amount_cents,
    'deduplicated', not v_inserted
  );
end;
$$;

revoke all on function public.record_stripe_invoice_payment_atomic(
  uuid, bigint, text, bigint, bigint, bigint, text,
  bigint, bigint, bigint, timestamptz,
  text, text, text, text, text, text, text, text,
  bigint, text, text
) from public, anon, authenticated;
grant execute on function public.record_stripe_invoice_payment_atomic(
  uuid, bigint, text, bigint, bigint, bigint, text,
  bigint, bigint, bigint, timestamptz,
  text, text, text, text, text, text, text, text,
  bigint, text, text
) to service_role;

revoke insert, update, delete on public.payment_ledger from service_role;
