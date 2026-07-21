-- Payment-ledger and invoice rollup integrity.
--
-- The ledger is the only authority for received cash. Direct Data API writes,
-- Stripe webhook writes, refunds, voids, and deletes all reconcile the owning
-- invoice and pay application in the same database transaction. Derived cash
-- fields cannot be written independently. Active invoice identity is also
-- enforced in PostgreSQL so concurrent requests cannot bypass application
-- preflight checks.

-- Fail with an actionable message before unique-index creation. CREATE UNIQUE
-- INDEX remains the final race-safe check after these diagnostics run.
do $$
declare
  v_application_id uuid;
  v_invoice_ids text;
begin
  select duplicate.billing_application_id, duplicate.invoice_ids
  into v_application_id, v_invoice_ids
  from (
    select
      invoice.billing_application_id,
      string_agg(invoice.id::text, ', ' order by invoice.id) as invoice_ids
    from public.billing_invoices invoice
    where invoice.billing_application_id is not null
      and invoice.status <> 'void'
    group by invoice.billing_application_id
    having count(*) > 1
    order by invoice.billing_application_id
    limit 1
  ) duplicate;

  if found then
    raise exception using
      errcode = '23505',
      message = format(
        'Cannot enforce one active invoice per pay application: application %s has multiple non-void invoices.',
        v_application_id
      ),
      detail = 'Conflicting invoice ids: ' || v_invoice_ids,
      hint = 'Void or consolidate the duplicate invoices, then retry this migration.';
  end if;
end;
$$;

do $$
declare
  v_project_id uuid;
  v_invoice_number text;
  v_invoice_ids text;
begin
  select duplicate.project_id, duplicate.invoice_number, duplicate.invoice_ids
  into v_project_id, v_invoice_number, v_invoice_ids
  from (
    select
      invoice.project_id,
      lower(btrim(invoice.invoice_number)) as invoice_number,
      string_agg(invoice.id::text, ', ' order by invoice.id) as invoice_ids
    from public.billing_invoices invoice
    where invoice.status <> 'void'
      and nullif(btrim(invoice.invoice_number), '') is not null
    group by invoice.project_id, lower(btrim(invoice.invoice_number))
    having count(*) > 1
    order by invoice.project_id, lower(btrim(invoice.invoice_number))
    limit 1
  ) duplicate;

  if found then
    raise exception using
      errcode = '23505',
      message = format(
        'Cannot enforce unique active invoice numbers: project %s has duplicate invoice number "%s".',
        v_project_id,
        v_invoice_number
      ),
      detail = 'Conflicting invoice ids: ' || v_invoice_ids,
      hint = 'Rename or void the duplicate invoice, then retry this migration.';
  end if;
end;
$$;

create unique index if not exists billing_invoices_one_active_per_application_unique
  on public.billing_invoices (billing_application_id)
  where billing_application_id is not null
    and status <> 'void';

create unique index if not exists billing_invoices_active_number_per_project_unique
  on public.billing_invoices (project_id, lower(btrim(invoice_number)))
  where status <> 'void'
    and nullif(btrim(invoice_number), '') is not null;

comment on index public.billing_invoices_one_active_per_application_unique is
  'A pay application can have only one non-void invoice. Voided history is retained.';
comment on index public.billing_invoices_active_number_per_project_unique is
  'Nonblank invoice numbers are case-insensitively unique among non-void invoices in one project.';

-- Do not reconcile corrupt legacy parentage into otherwise valid invoices.
-- The following migration rewrites every receipt into exact cents, so surface
-- mismatched ownership, impossible void cash, and overpayment first.
do $$
declare
  v_payment_id uuid;
begin
  select ledger.id
  into v_payment_id
  from public.payment_ledger ledger
  join public.billing_invoices invoice on invoice.id = ledger.invoice_id
  join public.projects project on project.id = invoice.project_id
  where ledger.project_id is distinct from invoice.project_id
    or ledger.billing_application_id is distinct from invoice.billing_application_id
    or ledger.organization_id is distinct from project.organization_id
  order by ledger.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format('Payment %s does not match its invoice, project, pay application, and organization.', v_payment_id),
      hint = 'Correct the ledger parentage before retrying this migration.';
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
  group by invoice.id, invoice.status, invoice.total_due
  having (
    invoice.status = 'void'
    and coalesce(sum(
      coalesce(nullif(ledger.amount_cents, 0), round(ledger.amount * 100)::bigint)
    ) filter (where ledger.status = 'succeeded'), 0) > 0
  ) or coalesce(sum(
    coalesce(nullif(ledger.amount_cents, 0), round(ledger.amount * 100)::bigint)
  ) filter (where ledger.status = 'succeeded'), 0) > round(invoice.total_due * 100)::bigint
  order by invoice.id
  limit 1;

  if found then
    raise exception using
      errcode = '23514',
      message = format('Invoice %s has succeeded cash that cannot be reconciled safely.', v_invoice_id),
      hint = 'Resolve void-invoice cash or overpayment through an explicit refund or unapplied-credit workflow, then retry this migration.';
  end if;
end;
$$;

-- Direct ledger writes must point to the exact same invoice, project, pay app,
-- and organization. amount_cents is canonical; the legacy dollar amount is
-- normalized from it so readers cannot observe two different cash values.
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
begin
  select invoice.project_id, invoice.billing_application_id, project.organization_id
  into v_project_id, v_application_id, v_organization_id
  from public.billing_invoices invoice
  join public.projects project on project.id = invoice.project_id
  where invoice.id = new.invoice_id;

  if not found then
    raise exception using
      errcode = '23503',
      message = 'Payment invoice was not found or is not accessible.';
  end if;
  if new.project_id is distinct from v_project_id then
    raise exception using
      errcode = '23514',
      message = 'Payment project must match the invoice project.';
  end if;
  if new.billing_application_id is distinct from v_application_id then
    raise exception using
      errcode = '23514',
      message = 'Payment pay application must match the invoice pay application.';
  end if;
  if new.organization_id is distinct from v_organization_id then
    raise exception using
      errcode = '23514',
      message = 'Payment organization must match the invoice project organization.';
  end if;

  v_amount_cents := case
    when new.amount_cents = 0 and new.amount <> 0
      then round(new.amount * 100)::bigint
    else new.amount_cents
  end;
  if v_amount_cents < 0 then
    raise exception using errcode = '23514', message = 'Payment amount cannot be negative.';
  end if;
  if new.status = 'succeeded' and v_amount_cents <= 0 then
    raise exception using
      errcode = '23514',
      message = 'A succeeded payment must have a positive integer-cent amount.';
  end if;

  new.amount_cents := v_amount_cents;
  new.amount := v_amount_cents::numeric / 100.0;
  return new;
end;
$$;

drop trigger if exists payment_ledger_validate_scope on public.payment_ledger;
create trigger payment_ledger_validate_scope
  before insert or update of invoice_id, project_id, billing_application_id,
    organization_id, amount, amount_cents, status
  on public.payment_ledger
  for each row
  execute function public.tg_validate_payment_ledger_scope();

-- Batch reconciler used by the statement trigger and the explicit repair RPC.
-- All invoice parents are locked in UUID order, then all application parents
-- are locked in UUID order. That prevents two multi-row ledger statements from
-- taking the same parent set in opposite order.
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

  -- Parent-first callers may already hold one invoice lock. Re-locking it in
  -- this transaction is safe; every additional parent is acquired in one
  -- deterministic order.
  perform 1
  from public.billing_invoices invoice
  where invoice.id = any(v_invoice_ids)
  order by invoice.id
  for update;

  select coalesce(array_agg(distinct id order by id), array[]::uuid[])
  into v_application_ids
  from (
    select id
    from unnest(coalesce(p_application_ids, array[]::uuid[])) id
    where id is not null
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
    select *
    into v_invoice
    from public.billing_invoices invoice
    where invoice.id = v_invoice_id;

    if found then
      select
        coalesce(
          sum(
            case
              when ledger.status = 'succeeded'
                then coalesce(
                  nullif(ledger.amount_cents, 0),
                  round(ledger.amount * 100)::bigint
                )
              else 0
            end
          ),
          0
        )::bigint,
        max(ledger.paid_at) filter (where ledger.status = 'succeeded')
      into v_paid_cents, v_paid_at
      from public.payment_ledger ledger
      where ledger.invoice_id = v_invoice.id;

      v_total_due_cents := round(v_invoice.total_due * 100)::bigint;
      v_invoice_status := case
        when v_invoice.status = 'void' then 'void'
        when v_total_due_cents > 0 and v_paid_cents >= v_total_due_cents then 'paid'
        when v_paid_cents > 0 then 'partially_paid'
        when v_invoice.status = 'draft' then 'draft'
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
    select *
    into v_application
    from public.billing_applications application
    where application.id = v_application_id;

    if found then
      select
        invoice.status,
        coalesce(
          sum(
            case
              when ledger.status = 'succeeded'
                then coalesce(
                  nullif(ledger.amount_cents, 0),
                  round(ledger.amount * 100)::bigint
                )
              else 0
            end
          ),
          0
        )::bigint
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

create or replace function public.reconcile_invoice_payment_rollup(p_invoice_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_application_id uuid;
begin
  if auth.uid() is null then
    raise exception using
      errcode = '42501',
      message = 'Authentication is required to reconcile an invoice.';
  end if;

  select invoice.project_id, invoice.billing_application_id
  into v_project_id, v_application_id
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Invoice not found.';
  end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using
      errcode = '42501',
      message = 'You do not have permission to reconcile this invoice.';
  end if;

  return public.reconcile_invoice_payment_rollups(
    array[p_invoice_id],
    case when v_application_id is null then array[]::uuid[] else array[v_application_id] end
  );
end;
$$;

create or replace function public.tg_reconcile_payment_ledger_statement()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_invoice_ids uuid[] := array[]::uuid[];
  v_application_ids uuid[] := array[]::uuid[];
begin
  -- record_invoice_payment_atomic owns its reconciliation and lifecycle event.
  -- The private transaction-local mode prevents duplicate rollup work and
  -- preserves the event's true pre-payment status.
  if current_setting('overwatch.payment_rollup_mode', true) = 'deferred' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    select
      coalesce(array_agg(distinct invoice_id order by invoice_id), array[]::uuid[]),
      coalesce(
        array_agg(distinct billing_application_id order by billing_application_id)
          filter (where billing_application_id is not null),
        array[]::uuid[]
      )
    into v_invoice_ids, v_application_ids
    from new_rows;
  elsif tg_op = 'DELETE' then
    select
      coalesce(array_agg(distinct invoice_id order by invoice_id), array[]::uuid[]),
      coalesce(
        array_agg(distinct billing_application_id order by billing_application_id)
          filter (where billing_application_id is not null),
        array[]::uuid[]
      )
    into v_invoice_ids, v_application_ids
    from old_rows;
  else
    select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_invoice_ids
    from (
      select invoice_id as id from old_rows
      union
      select invoice_id as id from new_rows
    ) affected;

    select coalesce(array_agg(id order by id), array[]::uuid[])
    into v_application_ids
    from (
      select billing_application_id as id from old_rows where billing_application_id is not null
      union
      select billing_application_id as id from new_rows where billing_application_id is not null
    ) affected;
  end if;

  if cardinality(v_invoice_ids) > 0 or cardinality(v_application_ids) > 0 then
    perform public.reconcile_invoice_payment_rollups(v_invoice_ids, v_application_ids);
  end if;
  return null;
end;
$$;

drop trigger if exists payment_ledger_reconcile_after_insert on public.payment_ledger;
create trigger payment_ledger_reconcile_after_insert
  after insert on public.payment_ledger
  referencing new table as new_rows
  for each statement
  execute function public.tg_reconcile_payment_ledger_statement();

drop trigger if exists payment_ledger_reconcile_after_update on public.payment_ledger;
create trigger payment_ledger_reconcile_after_update
  after update on public.payment_ledger
  referencing old table as old_rows new table as new_rows
  for each statement
  execute function public.tg_reconcile_payment_ledger_statement();

drop trigger if exists payment_ledger_reconcile_after_delete on public.payment_ledger;
create trigger payment_ledger_reconcile_after_delete
  after delete on public.payment_ledger
  referencing old table as old_rows
  for each statement
  execute function public.tg_reconcile_payment_ledger_statement();

-- paid_amount/status/paid_at are ledger-derived. The guard canonicalizes a
-- redundant webhook/RPC update to current ledger truth, so a stale follow-up
-- request cannot overwrite the statement-trigger result. With no cash, normal
-- draft/sent/viewed/overdue/void lifecycle changes remain available.
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
      or new.status in ('paid', 'partially_paid') then
      raise exception using
        errcode = '23514',
        message = 'New invoice payment fields must start empty; record received cash in the payment ledger.';
    end if;
    return new;
  end if;

  select
    coalesce(
      sum(
        case
          when ledger.status = 'succeeded'
            then coalesce(
              nullif(ledger.amount_cents, 0),
              round(ledger.amount * 100)::bigint
            )
          else 0
        end
      ),
      0
    )::bigint,
    max(ledger.paid_at) filter (where ledger.status = 'succeeded')
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
    -- Preserve the requested non-payment lifecycle state. paid fields remain
    -- canonical even if a direct REST payload tried to include different data.
    new.paid_amount := 0;
    new.paid_at := null;
    return new;
  end if;

  -- There is cash: the financial state overrides any stale or forged direct
  -- values. This also makes the webhook's separate follow-up update harmless.
  new.paid_amount := v_paid_cents::numeric / 100.0;
  new.status := v_canonical_status;
  new.paid_at := case
    when v_canonical_status = 'paid' then coalesce(old.paid_at, v_latest_paid_at, now())
    else null
  end;
  return new;
end;
$$;

drop trigger if exists billing_invoices_guard_payment_rollup_insert
  on public.billing_invoices;
create trigger billing_invoices_guard_payment_rollup_insert
  before insert on public.billing_invoices
  for each row
  execute function public.tg_guard_billing_invoice_payment_rollup();

drop trigger if exists billing_invoices_guard_payment_rollup_update
  on public.billing_invoices;
create trigger billing_invoices_guard_payment_rollup_update
  before update of paid_amount, status, paid_at, total_due on public.billing_invoices
  for each row
  execute function public.tg_guard_billing_invoice_payment_rollup();

-- Pay-application cash is derived from its one active invoice. Direct updates
-- are normalized to ledger truth; only non-payment lifecycle statuses survive
-- when no succeeded cash exists.
create or replace function public.tg_guard_billing_application_payment_rollup()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_paid_cents bigint := 0;
  v_active_invoice_status text;
begin
  if current_setting('overwatch.payment_rollup_mode', true) in ('deferred', 'reconciling') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if round(new.paid_to_date * 100)::bigint <> 0 or new.status in ('paid', 'partial') then
      raise exception using
        errcode = '23514',
        message = 'New pay-application cash fields must start empty; record received cash in the payment ledger.';
    end if;
    return new;
  end if;

  select
    invoice.status,
    coalesce(
      sum(
        case
          when ledger.status = 'succeeded'
            then coalesce(
              nullif(ledger.amount_cents, 0),
              round(ledger.amount * 100)::bigint
            )
          else 0
        end
      ),
      0
    )::bigint
  into v_active_invoice_status, v_paid_cents
  from public.billing_invoices invoice
  left join public.payment_ledger ledger on ledger.invoice_id = invoice.id
  where invoice.billing_application_id = new.id
    and invoice.status <> 'void'
  group by invoice.id, invoice.status;

  if not found then
    v_active_invoice_status := null;
    v_paid_cents := 0;
  end if;

  if v_paid_cents = 0 and new.status in ('paid', 'partial') then
    raise exception using
      errcode = '23514',
      message = 'Pay-application paid status must come from succeeded payment ledger entries.';
  end if;

  new.paid_to_date := v_paid_cents::numeric / 100.0;
  if v_paid_cents > 0 then
    new.status := case when v_active_invoice_status = 'paid' then 'paid' else 'partial' end;
  end if;
  return new;
end;
$$;

drop trigger if exists billing_applications_guard_payment_rollup_insert
  on public.billing_applications;
create trigger billing_applications_guard_payment_rollup_insert
  before insert on public.billing_applications
  for each row
  execute function public.tg_guard_billing_application_payment_rollup();

drop trigger if exists billing_applications_guard_payment_rollup_update
  on public.billing_applications;
create trigger billing_applications_guard_payment_rollup_update
  before update of paid_to_date, status on public.billing_applications
  for each row
  execute function public.tg_guard_billing_application_payment_rollup();

-- Repair every existing derived rollup once, with EVIDENCE. Paid state that
-- has no succeeded-ledger backing (legacy direct writes — e.g. demo seeds
-- setting paid_to_date without a receipt) is about to be demoted to its
-- ledger truth. Nothing is silently rewritten: the full before-state of
-- every such row is journaled immutably first, so the change is auditable
-- and recoverable.
create table if not exists public.payment_rollup_backfill_evidence (
  id uuid primary key default gen_random_uuid(),
  migration_key text not null,
  record_kind text not null check (record_kind in ('invoice', 'application')),
  record_id uuid not null,
  project_id uuid,
  before_state jsonb not null,
  created_at timestamptz not null default now(),
  constraint payment_rollup_backfill_evidence_unique unique (migration_key, record_kind, record_id)
);

alter table public.payment_rollup_backfill_evidence enable row level security;
revoke all on table public.payment_rollup_backfill_evidence
  from public, anon, authenticated, service_role;
grant select on table public.payment_rollup_backfill_evidence
  to authenticated, service_role;
drop policy if exists payment_rollup_backfill_evidence_select
  on public.payment_rollup_backfill_evidence;
create policy payment_rollup_backfill_evidence_select
  on public.payment_rollup_backfill_evidence
  for select to authenticated
  using (project_id is null or public.can_read_project(project_id));

insert into public.payment_rollup_backfill_evidence
  (migration_key, record_kind, record_id, project_id, before_state)
select
  '20260720160258-ledger-rollup-backfill-v1',
  'invoice',
  invoice.id,
  invoice.project_id,
  to_jsonb(invoice)
from public.billing_invoices invoice
where (invoice.status in ('paid', 'partial') or coalesce(invoice.paid_amount, 0) > 0)
  and not exists (
    select 1 from public.payment_ledger ledger
    where ledger.invoice_id = invoice.id and ledger.status = 'succeeded'
  )
on conflict (migration_key, record_kind, record_id) do nothing;

insert into public.payment_rollup_backfill_evidence
  (migration_key, record_kind, record_id, project_id, before_state)
select
  '20260720160258-ledger-rollup-backfill-v1',
  'application',
  application.id,
  application.project_id,
  to_jsonb(application)
from public.billing_applications application
where (application.status in ('paid', 'partial') or coalesce(application.paid_to_date, 0) > 0)
  and not exists (
    select 1
    from public.billing_invoices invoice
    join public.payment_ledger ledger
      on ledger.invoice_id = invoice.id and ledger.status = 'succeeded'
    where invoice.billing_application_id = application.id
      and invoice.status <> 'void'
  )
on conflict (migration_key, record_kind, record_id) do nothing;

select public.reconcile_invoice_payment_rollups(
  coalesce((select array_agg(invoice.id order by invoice.id) from public.billing_invoices invoice), array[]::uuid[]),
  coalesce((select array_agg(application.id order by application.id) from public.billing_applications application), array[]::uuid[])
);

-- Trigger functions are internal implementation details. The batch reconciler
-- is safe to invoke but the single-invoice wrapper is the supported UI RPC.
revoke all on function public.tg_validate_payment_ledger_scope() from public, anon, authenticated, service_role;
revoke all on function public.tg_reconcile_payment_ledger_statement() from public, anon, authenticated, service_role;
revoke all on function public.tg_guard_billing_invoice_payment_rollup() from public, anon, authenticated, service_role;
revoke all on function public.tg_guard_billing_application_payment_rollup() from public, anon, authenticated, service_role;

revoke all on function public.reconcile_invoice_payment_rollups(uuid[], uuid[]) from public, anon;
grant execute on function public.reconcile_invoice_payment_rollups(uuid[], uuid[])
  to authenticated, service_role;
revoke all on function public.reconcile_invoice_payment_rollup(uuid) from public, anon;
grant execute on function public.reconcile_invoice_payment_rollup(uuid)
  to authenticated, service_role;
