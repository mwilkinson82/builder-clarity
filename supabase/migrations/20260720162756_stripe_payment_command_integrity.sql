-- Parent-first Stripe payment booking.
--
-- The service role no longer writes payment_ledger directly. Webhook delivery
-- uses this idempotent command, and refunds use refund_invoice_payment_atomic.
-- That removes the ledger-row -> invoice lock order which could deadlock a
-- concurrent manual payment command that correctly locks invoice -> ledger.

do $$
declare
  v_identifier text;
begin
  select identifier
  into v_identifier
  from (
    select btrim(stripe_checkout_session_id) as identifier
    from public.payment_ledger
    where btrim(stripe_checkout_session_id) <> ''
    group by btrim(stripe_checkout_session_id)
    having count(*) > 1
    union all
    select btrim(stripe_payment_intent_id) as identifier
    from public.payment_ledger
    where btrim(stripe_payment_intent_id) <> ''
    group by btrim(stripe_payment_intent_id)
    having count(*) > 1
    union all
    select btrim(processor_payment_id) as identifier
    from public.payment_ledger
    where processor in ('stripe', 'stripe_connect')
      and btrim(processor_payment_id) <> ''
    group by btrim(processor_payment_id)
    having count(*) > 1
  ) duplicate
  order by identifier
  limit 1;

  if found then
    raise exception using
      errcode = '23505',
      message = format('Stripe payment identifier %s is attached to multiple ledger rows.', v_identifier),
      hint = 'Resolve duplicate Stripe checkout/payment-intent provenance before retrying this migration.';
  end if;
end;
$$;

create unique index if not exists payment_ledger_stripe_checkout_session_unique
  on public.payment_ledger (btrim(stripe_checkout_session_id))
  where btrim(stripe_checkout_session_id) <> '';

create unique index if not exists payment_ledger_stripe_payment_intent_unique
  on public.payment_ledger (btrim(stripe_payment_intent_id))
  where btrim(stripe_payment_intent_id) <> '';

create unique index if not exists payment_ledger_stripe_processor_payment_unique
  on public.payment_ledger (btrim(processor_payment_id))
  where processor in ('stripe', 'stripe_connect')
    and btrim(processor_payment_id) <> '';

create or replace function public.record_stripe_invoice_payment_atomic(
  p_invoice_id uuid,
  p_amount_cents bigint,
  p_surcharge_cents bigint default 0,
  p_gross_received_cents bigint default null,
  p_processor_fee_cents bigint default 0,
  p_overwatch_fee_cents bigint default 0,
  p_paid_at timestamptz default now(),
  p_payment_method text default 'stripe_checkout',
  p_processor_payment_id text default '',
  p_reference text default '',
  p_notes text default '',
  p_checkout_session_id text default '',
  p_payment_intent_id text default '',
  p_charge_id text default '',
  p_receipt_url text default ''
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
  v_organization_id uuid;
  v_external_key text;
  v_idempotency_key text;
  v_succeeded_cents bigint := 0;
  v_total_due_cents bigint := 0;
  v_previous_mode text := current_setting('overwatch.payment_rollup_mode', true);
  v_previous_command text := current_setting('overwatch.payment_ledger_command', true);
  v_inserted boolean := false;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'Stripe payment booking requires the service role.';
  end if;
  if p_amount_cents <= 0
    or p_surcharge_cents < 0
    or p_gross_received_cents is null
    or p_gross_received_cents <> p_amount_cents + p_surcharge_cents
    or p_processor_fee_cents < 0
    or p_overwatch_fee_cents < 0
    or p_processor_fee_cents + p_overwatch_fee_cents > p_gross_received_cents
  then
    raise exception using
      errcode = '22023',
      message = 'Stripe applied cash, surcharge, gross received, or fee cents are invalid.';
  end if;
  if nullif(btrim(p_payment_method), '') is null
    or length(p_payment_method) > 100
    or length(coalesce(p_processor_payment_id, '')) > 200
    or length(coalesce(p_reference, '')) > 200
    or length(coalesce(p_notes, '')) > 4000
    or length(coalesce(p_checkout_session_id, '')) > 300
    or length(coalesce(p_payment_intent_id, '')) > 300
    or length(coalesce(p_charge_id, '')) > 300
    or length(coalesce(p_receipt_url, '')) > 2000
  then
    raise exception using errcode = '22023', message = 'Stripe payment details exceed their allowed length.';
  end if;

  v_external_key := coalesce(
    nullif(btrim(p_checkout_session_id), ''),
    nullif(btrim(p_payment_intent_id), ''),
    nullif(btrim(p_processor_payment_id), '')
  );
  if v_external_key is null or length(v_external_key) > 193 then
    raise exception using
      errcode = '22023',
      message = 'A stable Stripe payment identifier of at most 193 characters is required.';
  end if;
  v_idempotency_key := 'stripe:' || v_external_key;

  select *
  into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found.';
  end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = '22023', message = 'A void invoice cannot receive a Stripe payment.';
  end if;

  select project.organization_id
  into v_organization_id
  from public.projects project
  where project.id = v_invoice.project_id;

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
  if (v_checkout_payment_id is not null and v_intent_payment_id is not null
       and v_checkout_payment_id <> v_intent_payment_id)
    or (v_checkout_payment_id is not null and v_processor_payment_row_id is not null
       and v_checkout_payment_id <> v_processor_payment_row_id)
    or (v_intent_payment_id is not null and v_processor_payment_row_id is not null
       and v_intent_payment_id <> v_processor_payment_row_id)
  then
    raise exception using
      errcode = '23514',
      message = 'Stripe identifiers resolve to different payment receipts.';
  end if;

  v_payment_id := coalesce(
    v_checkout_payment_id,
    v_intent_payment_id,
    v_processor_payment_row_id
  );
  if v_payment_id is not null then
    select * into v_existing
    from public.payment_ledger ledger
    where ledger.id = v_payment_id
    for update;
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
      or v_existing.processor_fee_cents <> p_processor_fee_cents
      or v_existing.overwatch_fee_cents <> p_overwatch_fee_cents
      or v_existing.payment_method <> btrim(p_payment_method)
      or v_existing.processor <> 'stripe'
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
    ) then
      perform set_config('overwatch.payment_rollup_mode', 'deferred', true);
      perform set_config('overwatch.payment_ledger_command', 'stripe_enrich', true);
      update public.payment_ledger
      set stripe_checkout_session_id = coalesce(
            nullif(stripe_checkout_session_id, ''),
            btrim(coalesce(p_checkout_session_id, ''))
          ),
          stripe_payment_intent_id = coalesce(
            nullif(stripe_payment_intent_id, ''),
            btrim(coalesce(p_payment_intent_id, ''))
          ),
          processor_payment_id = coalesce(
            nullif(processor_payment_id, ''),
            btrim(coalesce(p_processor_payment_id, ''))
          )
      where id = v_existing.id;
      perform set_config(
        'overwatch.payment_ledger_command',
        coalesce(v_previous_command, 'none'),
        true
      );
    end if;
  else
    select coalesce(sum(ledger.amount_cents - ledger.refunded_amount_cents), 0)::bigint
    into v_succeeded_cents
    from public.payment_ledger ledger
    where ledger.invoice_id = v_invoice.id
      and ledger.status in ('succeeded', 'refunded');
    v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
    if p_amount_cents > v_total_due_cents - v_succeeded_cents then
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
      currency, payment_method, processor, processor_payment_id, reference,
      status, paid_at, notes, idempotency_key, stripe_checkout_session_id,
      stripe_payment_intent_id, stripe_charge_id, receipt_url
    ) values (
      v_invoice.project_id, v_invoice.id, v_invoice.billing_application_id, v_organization_id,
      p_amount_cents::numeric / 100.0, p_amount_cents,
      p_surcharge_cents::numeric / 100.0, p_surcharge_cents,
      p_gross_received_cents::numeric / 100.0, p_gross_received_cents,
      p_processor_fee_cents::numeric / 100.0, p_processor_fee_cents,
      p_overwatch_fee_cents::numeric / 100.0, p_overwatch_fee_cents,
      (p_gross_received_cents - p_processor_fee_cents - p_overwatch_fee_cents)::numeric / 100.0,
      p_gross_received_cents - p_processor_fee_cents - p_overwatch_fee_cents,
      'usd', btrim(p_payment_method), 'stripe',
      coalesce(nullif(btrim(p_processor_payment_id), ''), v_external_key),
      coalesce(p_reference, ''), 'succeeded', coalesce(p_paid_at, now()),
      coalesce(p_notes, ''), v_idempotency_key,
      btrim(coalesce(p_checkout_session_id, '')),
      btrim(coalesce(p_payment_intent_id, '')),
      btrim(coalesce(p_charge_id, '')),
      btrim(coalesce(p_receipt_url, ''))
    )
    returning id into v_payment_id;
    v_inserted := true;
  end if;

  perform public.reconcile_invoice_payment_rollups(
    array[v_invoice.id],
    case
      when v_invoice.billing_application_id is null then array[]::uuid[]
      else array[v_invoice.billing_application_id]
    end
  );
  perform set_config(
    'overwatch.payment_rollup_mode',
    coalesce(v_previous_mode, 'immediate'),
    true
  );

  select * into v_invoice from public.billing_invoices where id = v_invoice.id;
  return jsonb_build_object(
    'paymentId', v_payment_id,
    'paidAmount', v_invoice.paid_amount,
    'status', v_invoice.status,
    'deduplicated', not v_inserted
  );
end;
$$;

revoke all on function public.record_stripe_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz,
  text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_stripe_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, bigint, bigint, timestamptz,
  text, text, text, text, text, text, text, text
) to service_role;

-- Every cash mutation now enters through an invoice-first command. Read
-- access remains unchanged for reporting and the client portal.
revoke insert, update, delete on public.payment_ledger from service_role;
