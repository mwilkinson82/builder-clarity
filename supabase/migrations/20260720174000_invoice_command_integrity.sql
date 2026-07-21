-- Billing-invoice command integrity.
--
-- Client invoices are financial documents. Create, draft correction, issue,
-- void, and eligible deletion therefore run as serialized, retry-safe database
-- commands with an immutable tombstone journal. The database derives total_due
-- and rejects stale browser writes instead of allowing last-response-wins races.

lock table public.billing_invoices in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.billing_invoices invoice
    left join public.billing_applications application
      on application.id = invoice.billing_application_id
    where invoice.subtotal < 0
      or invoice.retainage < 0
      or invoice.retainage > invoice.subtotal
      or invoice.total_due <> round(invoice.subtotal - invoice.retainage, 2)
      or invoice.paid_amount < 0
      or invoice.paid_amount > invoice.total_due
      or invoice.subtotal * 100 <> trunc(invoice.subtotal * 100)
      or invoice.retainage * 100 <> trunc(invoice.retainage * 100)
      or invoice.total_due * 100 <> trunc(invoice.total_due * 100)
      or invoice.paid_amount * 100 <> trunc(invoice.paid_amount * 100)
      or greatest(
        abs(invoice.subtotal * 100),
        abs(invoice.retainage * 100),
        abs(invoice.total_due * 100),
        abs(invoice.paid_amount * 100)
      ) > 9007199254740991
      or (application.id is not null and invoice.subtotal > application.amount_billed)
  ) then
    raise exception using
      errcode = '23514',
      message = 'Invoice integrity migration blocked: repair invalid derived totals, retainage, paid cash, or linked application caps first.';
  end if;
end
$$;

alter table public.billing_invoices
  add column if not exists correction_of_invoice_id uuid
    references public.billing_invoices(id) on delete restrict;

create index if not exists billing_invoices_correction_of_idx
  on public.billing_invoices (correction_of_invoice_id)
  where correction_of_invoice_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_invoices_derived_money_integrity_check'
      and conrelid = 'public.billing_invoices'::regclass
  ) then
    alter table public.billing_invoices
      add constraint billing_invoices_derived_money_integrity_check
      check (
        subtotal >= 0
        and retainage >= 0
        and retainage <= subtotal
        and total_due = round(subtotal - retainage, 2)
        and paid_amount >= 0
        and paid_amount <= total_due
        and subtotal * 100 = trunc(subtotal * 100)
        and retainage * 100 = trunc(retainage * 100)
        and total_due * 100 = trunc(total_due * 100)
        and paid_amount * 100 = trunc(paid_amount * 100)
        and greatest(
          abs(subtotal * 100), abs(retainage * 100),
          abs(total_due * 100), abs(paid_amount * 100)
        ) <= 9007199254740991
      );
  end if;
end
$$;

-- Intentionally no foreign key to the target invoice: a successful draft
-- delete must retain an auditable, idempotent tombstone.
create table if not exists public.billing_invoice_commands (
  id uuid primary key default gen_random_uuid(),
  -- Financial command evidence outlives the UI record. Projects with invoice
  -- command history must be archived, not hard-deleted with a cascade.
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_invoice_id uuid not null,
  command_type text not null
    check (command_type in ('create', 'update', 'transition', 'correct', 'delete', 'collections_note')),
  idempotency_key text not null,
  idempotency_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint billing_invoice_commands_project_key_unique
    unique (project_id, idempotency_key)
);

create index if not exists billing_invoice_commands_invoice_idx
  on public.billing_invoice_commands (billing_invoice_id, created_at desc);

alter table public.billing_invoice_commands enable row level security;
revoke all on public.billing_invoice_commands from public, anon, authenticated, service_role;

comment on table public.billing_invoice_commands is
  'Immutable retry and audit journal for invoice create, edit, issue, void, correction, and draft deletion.';

-- Production contained a small number of rows written before invoice and
-- pay-application lifecycles were coupled. Preserve exact before/after
-- evidence instead of inventing recipients or silently treating those states
-- as valid forever.
create table if not exists public.billing_invoice_legacy_repairs (
  id uuid primary key default gen_random_uuid(),
  repair_type text not null check (repair_type in (
    'issued_draft_application',
    'issued_hidden_invoice',
    'grandfathered_delivery_evidence'
  )),
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_invoice_id uuid not null,
  billing_application_id uuid,
  before_state jsonb not null,
  after_state jsonb not null,
  reason text not null,
  created_at timestamptz not null default transaction_timestamp(),
  constraint billing_invoice_legacy_repairs_once
    unique (repair_type, billing_invoice_id)
);

alter table public.billing_invoice_legacy_repairs enable row level security;
revoke all on public.billing_invoice_legacy_repairs
  from public, anon, authenticated, service_role;

create or replace function public.tg_billing_invoice_legacy_repairs_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Legacy invoice repair evidence is immutable.';
end;
$$;

drop trigger if exists billing_invoice_legacy_repairs_immutable
  on public.billing_invoice_legacy_repairs;
create trigger billing_invoice_legacy_repairs_immutable
  before update or delete on public.billing_invoice_legacy_repairs
  for each row execute function public.tg_billing_invoice_legacy_repairs_immutable();

insert into public.billing_invoice_legacy_repairs (
  repair_type, project_id, billing_invoice_id, billing_application_id,
  before_state, after_state, reason
)
select
  'issued_draft_application', invoice.project_id, invoice.id, application.id,
  jsonb_build_object(
    'invoice_status', invoice.status,
    'invoice_sent_at', invoice.sent_at,
    'application_status', application.status,
    'application_submitted_date', application.submitted_date
  ),
  jsonb_build_object(
    'invoice_status', invoice.status,
    'invoice_sent_at', invoice.sent_at,
    'application_status', 'submitted',
    'application_submitted_date', coalesce(
      application.submitted_date, invoice.sent_at::date, invoice.issue_date
    )
  ),
  'One-time compatibility repair: an already-issued invoice is authoritative evidence that its linked draft pay application was submitted.'
from public.billing_invoices invoice
join public.billing_applications application
  on application.id = invoice.billing_application_id
where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
  and application.status = 'draft'
on conflict (repair_type, billing_invoice_id) do nothing;

update public.billing_applications application
set status = 'submitted',
    submitted_date = coalesce(
      application.submitted_date,
      evidence.first_sent_at::date,
      evidence.first_issue_date
    )
from (
  select
    invoice.billing_application_id,
    min(invoice.sent_at) as first_sent_at,
    min(invoice.issue_date) as first_issue_date
  from public.billing_invoices invoice
  where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
    and invoice.billing_application_id is not null
  group by invoice.billing_application_id
) evidence
where application.id = evidence.billing_application_id
  and application.status = 'draft';

insert into public.billing_invoice_legacy_repairs (
  repair_type, project_id, billing_invoice_id, billing_application_id,
  before_state, after_state, reason
)
select
  'issued_hidden_invoice', invoice.project_id, invoice.id,
  invoice.billing_application_id,
  jsonb_build_object(
    'status', invoice.status,
    'client_visible', invoice.client_visible,
    'sent_at', invoice.sent_at
  ),
  jsonb_build_object(
    'status', invoice.status,
    'client_visible', true,
    'sent_at', invoice.sent_at
  ),
  'One-time compatibility repair: issued invoices must remain visible to the client.'
from public.billing_invoices invoice
where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
  and not invoice.client_visible
on conflict (repair_type, billing_invoice_id) do nothing;

update public.billing_invoices invoice
set client_visible = true
where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
  and not invoice.client_visible;

insert into public.billing_invoice_legacy_repairs (
  repair_type, project_id, billing_invoice_id, billing_application_id,
  before_state, after_state, reason
)
select
  'grandfathered_delivery_evidence', invoice.project_id, invoice.id,
  invoice.billing_application_id,
  jsonb_build_object(
    'status', invoice.status,
    'sent_at', invoice.sent_at,
    'sent_recipients', coalesce(invoice.sent_recipients, '[]'::jsonb)
  ),
  jsonb_build_object(
    'status', invoice.status,
    'sent_at', invoice.sent_at,
    'sent_recipients', coalesce(invoice.sent_recipients, '[]'::jsonb),
    'delivery_evidence', 'grandfathered_existing_sent_at'
  ),
  'Existing issue timestamp is retained as delivery evidence; no recipient is fabricated.'
from public.billing_invoices invoice
where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
  and jsonb_array_length(coalesce(invoice.sent_recipients, '[]'::jsonb)) = 0
on conflict (repair_type, billing_invoice_id) do nothing;

-- One-time compatibility repair: an invoice issued before delivery evidence
-- was captured can carry a null sent_at. Upgrade it from its creation
-- timestamp so the issued-evidence constraint below documents the rule
-- instead of aborting on legacy rows.
update public.billing_invoices invoice
set sent_at = coalesce(invoice.sent_at, invoice.created_at)
where invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
  and invoice.sent_at is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_invoices_issued_evidence_check'
      and conrelid = 'public.billing_invoices'::regclass
  ) then
    alter table public.billing_invoices
      add constraint billing_invoices_issued_evidence_check
      check (
        status not in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
        or (client_visible and sent_at is not null)
      );
  end if;
end
$$;

create or replace function public.tg_enforce_billing_invoice_command_path()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_command_mode text := coalesce(
    current_setting('overwatch.billing_invoice_command', true),
    ''
  );
  v_payment_mode text := coalesce(
    current_setting('overwatch.payment_rollup_mode', true),
    ''
  );
begin
  if current_user in ('postgres', 'supabase_admin')
    or pg_trigger_depth() > 1
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if (tg_op = 'INSERT' and v_command_mode = 'creating')
    or (tg_op = 'UPDATE' and (
      v_command_mode in ('updating', 'transitioning', 'correcting', 'processor', 'portal_view')
      or v_payment_mode in ('deferred', 'reconciling')
    ))
    or (tg_op = 'DELETE' and v_command_mode = 'deleting')
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Invoices must be changed through an atomic invoice command.';
end;
$$;

create or replace function public.update_billing_invoice_atomic(
  p_billing_invoice_id uuid,
  p_patch jsonb,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_application public.billing_applications%rowtype;
  v_existing public.billing_invoice_commands%rowtype;
  v_patch jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_subtotal numeric;
  v_retainage numeric;
  v_total_due numeric;
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to update an invoice.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid invoice command idempotency key is required.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'A nonempty invoice patch is required.';
  end if;
  if (p_patch - array[
    'invoice_number', 'title', 'issue_date', 'due_date', 'subtotal',
    'retainage', 'total_due', 'notes', 'enabled_payment_methods'
  ]::text[]) <> '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'Invoice edits cannot directly change status, cash, visibility, project, or Stripe provenance.';
  end if;

  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update this invoice.';
  end if;

  v_patch := p_patch;
  v_fingerprint := md5(jsonb_build_object(
    'command', 'update', 'invoice_id', p_billing_invoice_id, 'patch', v_patch
  )::text);
  select * into v_existing
  from public.billing_invoice_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'update'
      or v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This invoice command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if p_expected_updated_at is null
    or v_invoice.updated_at is distinct from p_expected_updated_at
  then
    raise exception using
      errcode = '40001',
      message = 'This invoice changed after you opened it. Refresh before saving your edit.';
  end if;

  -- Once issued, only operational collection/payment-method metadata may be
  -- changed. The number, dates, source, and money remain immutable history.
  if v_invoice.status <> 'draft'
    or v_invoice.client_visible
    or v_invoice.sent_at is not null
    or v_invoice.paid_amount <> 0
  then
    if (p_patch - array['enabled_payment_methods']::text[]) <> '{}'::jsonb
      or v_invoice.status in ('paid', 'void')
    then
      raise exception using
        errcode = '23514',
        message = 'Issued, paid, and void invoice financial history is immutable. Void or correct it instead.';
    end if;
  end if;

  if (p_patch ? 'invoice_number' and length(coalesce(p_patch->>'invoice_number', '')) > 100)
    or (p_patch ? 'title' and length(coalesce(p_patch->>'title', '')) > 200)
    or (p_patch ? 'notes' and length(coalesce(p_patch->>'notes', '')) > 4000)
    or (p_patch ? 'enabled_payment_methods'
      and jsonb_typeof(p_patch->'enabled_payment_methods') <> 'object')
  then
    raise exception using errcode = '22023', message = 'Invoice text or payment methods are invalid.';
  end if;

  v_retainage := case when p_patch ? 'retainage'
    then (p_patch->>'retainage')::numeric else v_invoice.retainage end;
  v_subtotal := case
    when p_patch ? 'subtotal' then (p_patch->>'subtotal')::numeric
    when p_patch ? 'total_due' then (p_patch->>'total_due')::numeric + v_retainage
    else v_invoice.subtotal
  end;
  v_total_due := round(v_subtotal - v_retainage, 2);
  if v_subtotal < 0
    or v_retainage < 0
    or v_retainage > v_subtotal
    or greatest(v_subtotal, v_retainage) * 100 > 9007199254740991
    or v_subtotal * 100 <> trunc(v_subtotal * 100)
    or v_retainage * 100 <> trunc(v_retainage * 100)
    or (p_patch ? 'total_due'
      and (p_patch->>'total_due')::numeric is distinct from v_total_due)
  then
    raise exception using
      errcode = '23514',
      message = 'Invoice money must be safe exact cents and retainage cannot exceed subtotal.';
  end if;

  if v_invoice.billing_application_id is not null then
    select * into v_application
    from public.billing_applications application
    where application.id = v_invoice.billing_application_id
      and application.project_id = v_project_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'The linked pay application is missing.';
    end if;
    if v_subtotal > v_application.amount_billed then
      raise exception using
        errcode = '23514',
        message = 'A linked invoice cannot exceed its pay application amount.';
    end if;
  end if;

  perform set_config('overwatch.billing_invoice_command', 'updating', true);
  update public.billing_invoices invoice
  set invoice_number = case when p_patch ? 'invoice_number'
        then btrim(coalesce(p_patch->>'invoice_number', '')) else invoice.invoice_number end,
      title = case when p_patch ? 'title'
        then btrim(coalesce(p_patch->>'title', '')) else invoice.title end,
      issue_date = case when p_patch ? 'issue_date'
        then nullif(p_patch->>'issue_date', '')::date else invoice.issue_date end,
      due_date = case when p_patch ? 'due_date'
        then nullif(p_patch->>'due_date', '')::date else invoice.due_date end,
      subtotal = v_subtotal,
      retainage = v_retainage,
      total_due = v_total_due,
      notes = case when p_patch ? 'notes'
        then coalesce(p_patch->>'notes', '') else invoice.notes end,
      enabled_payment_methods = case when p_patch ? 'enabled_payment_methods'
        then p_patch->'enabled_payment_methods' else invoice.enabled_payment_methods end
  where invoice.id = p_billing_invoice_id
  returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'status', v_invoice.status,
    'totalDue', v_invoice.total_due,
    'updatedAt', v_invoice.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_invoice.id, 'update', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;


drop trigger if exists billing_invoices_enforce_command_path
  on public.billing_invoices;
create trigger billing_invoices_enforce_command_path
  before insert or update or delete on public.billing_invoices
  for each row execute function public.tg_enforce_billing_invoice_command_path();

revoke all on function public.tg_enforce_billing_invoice_command_path()
  from public, anon, authenticated, service_role;

create or replace function public.create_billing_invoice_atomic(
  p_project_id uuid,
  p_payload jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.billing_invoice_commands%rowtype;
  v_invoice public.billing_invoices%rowtype;
  v_application public.billing_applications%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_application_id uuid := nullif(p_payload->>'billing_application_id', '')::uuid;
  v_invoice_number text := btrim(coalesce(p_payload->>'invoice_number', ''));
  v_title text := btrim(coalesce(p_payload->>'title', ''));
  v_issue_date date := nullif(p_payload->>'issue_date', '')::date;
  v_due_date date := nullif(p_payload->>'due_date', '')::date;
  v_subtotal numeric := coalesce(nullif(p_payload->>'subtotal', '')::numeric, 0);
  v_retainage numeric := coalesce(nullif(p_payload->>'retainage', '')::numeric, 0);
  v_total_due numeric;
  v_status text := coalesce(nullif(p_payload->>'status', ''), 'draft');
  v_notes text := coalesce(p_payload->>'notes', '');
  v_methods jsonb := coalesce(p_payload->'enabled_payment_methods', '{}'::jsonb);
  v_recipients jsonb := coalesce(p_payload->'sent_recipients', '[]'::jsonb);
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create an invoice.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid invoice command idempotency key is required.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Invoice payload must be a JSON object.';
  end if;
  if (p_payload - array[
    'billing_application_id', 'invoice_number', 'title', 'issue_date',
    'due_date', 'subtotal', 'retainage', 'total_due', 'paid_amount', 'status',
    'client_visible', 'sent_recipients', 'notes', 'enabled_payment_methods'
  ]::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Invoice payload contains unsupported fields.';
  end if;
  -- Validate JSON container types before calling array helpers so malformed
  -- payloads fail with a controlled command error instead of an opaque
  -- jsonb_array_length exception.
  if jsonb_typeof(v_methods) <> 'object'
    or jsonb_typeof(v_recipients) <> 'array'
  then
    raise exception using errcode = '22023', message = 'Invoice payment methods and recipients are invalid.';
  end if;
  if coalesce(nullif(p_payload->>'paid_amount', '')::numeric, 0) <> 0
    or v_status <> 'draft'
    or coalesce((p_payload->>'client_visible')::boolean, false)
    or jsonb_array_length(v_recipients) <> 0
  then
    raise exception using
      errcode = '23514',
      message = 'Invoices must be created as hidden, cash-free drafts. Send is a separate audited command.';
  end if;
  if length(v_invoice_number) > 100
    or length(v_title) > 200
    or length(v_notes) > 4000
    or jsonb_array_length(v_recipients) > 50
  then
    raise exception using errcode = '22023', message = 'Invoice text, recipients, or payment methods are invalid.';
  end if;

  v_total_due := round(v_subtotal - v_retainage, 2);
  if v_subtotal < 0
    or v_retainage < 0
    or v_retainage > v_subtotal
    or greatest(v_subtotal, v_retainage) * 100 > 9007199254740991
    or v_subtotal * 100 <> trunc(v_subtotal * 100)
    or v_retainage * 100 <> trunc(v_retainage * 100)
    or (p_payload ? 'total_due'
      and (p_payload->>'total_due')::numeric is distinct from v_total_due)
  then
    raise exception using
      errcode = '23514',
      message = 'Invoice money must be safe exact cents and retainage cannot exceed subtotal.';
  end if;

  perform 1 from public.projects project where project.id = p_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create this invoice.';
  end if;

  if v_application_id is not null then
    select * into v_application
    from public.billing_applications application
    where application.id = v_application_id
      and application.project_id = p_project_id
    for update;
    if not found then
      raise exception using errcode = '23503', message = 'The linked pay application is not on this project.';
    end if;
    if v_subtotal > v_application.amount_billed then
      raise exception using
        errcode = '23514',
        message = 'A linked invoice cannot exceed its pay application amount.';
    end if;
  end if;

  v_payload := jsonb_build_object(
    'billing_application_id', v_application_id,
    'invoice_number', v_invoice_number,
    'title', v_title,
    'issue_date', v_issue_date,
    'due_date', v_due_date,
    'subtotal', v_subtotal,
    'retainage', v_retainage,
    'total_due', v_total_due,
    'status', v_status,
    'client_visible', false,
    'sent_recipients', v_recipients,
    'notes', v_notes,
    'enabled_payment_methods', v_methods
  );
  v_fingerprint := md5(jsonb_build_object(
    'command', 'create', 'project_id', p_project_id, 'payload', v_payload
  )::text);

  select * into v_existing
  from public.billing_invoice_commands command
  where command.project_id = p_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'create'
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This invoice command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  perform set_config('overwatch.billing_invoice_command', 'creating', true);
  insert into public.billing_invoices (
    project_id, billing_application_id, invoice_number, title, issue_date,
    due_date, subtotal, retainage, total_due, paid_amount, status,
    client_visible, sent_at, sent_recipients, notes, enabled_payment_methods
  ) values (
    p_project_id, v_application_id, v_invoice_number, v_title, v_issue_date,
    v_due_date, v_subtotal, v_retainage, v_total_due, 0, v_status,
    false, null, v_recipients, v_notes, v_methods
  ) returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'status', v_invoice.status,
    'totalDue', v_invoice.total_due,
    'updatedAt', v_invoice.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    p_project_id, v_invoice.id, 'create', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.transition_billing_invoice_atomic(
  p_billing_invoice_id uuid,
  p_to_status text,
  p_sent_recipients jsonb,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_application public.billing_applications%rowtype;
  v_existing public.billing_invoice_commands%rowtype;
  v_application_transition jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_target text := lower(btrim(coalesce(p_to_status, '')));
  v_delivery jsonb := coalesce(p_sent_recipients, '[]'::jsonb);
  v_delivery_mode text := case
    when jsonb_typeof(coalesce(p_sent_recipients, '[]'::jsonb)) = 'object'
      then lower(btrim(coalesce(p_sent_recipients->>'mode', '')))
    else 'email'
  end;
  v_recipients jsonb := case
    when jsonb_typeof(coalesce(p_sent_recipients, '[]'::jsonb)) = 'object'
      then coalesce(p_sent_recipients->'recipients', '[]'::jsonb)
    else coalesce(p_sent_recipients, '[]'::jsonb)
  end;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to transition an invoice.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid invoice command idempotency key is required.';
  end if;
  if v_target not in ('sent', 'overdue', 'void') then
    raise exception using
      errcode = '22023',
      message = 'Invoice lifecycle commands support send, overdue, and void. Paid state comes only from receipts.';
  end if;
  if jsonb_typeof(v_delivery) not in ('array', 'object')
    or v_delivery_mode not in ('email', 'manual', 'external')
    or jsonb_typeof(v_recipients) <> 'array'
    or jsonb_array_length(v_recipients) > 50
    or exists (
      select 1
      from jsonb_array_elements(v_recipients) recipient(value)
      where jsonb_typeof(recipient.value) <> 'string'
        or length(btrim(recipient.value #>> '{}')) not between 3 and 254
        or (
          v_delivery_mode = 'email'
          and btrim(recipient.value #>> '{}') !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
        )
    )
    or length(v_reason) > 2000
  then
    raise exception using errcode = '22023', message = 'Invoice recipients or transition reason are invalid.';
  end if;
  if v_target = 'sent'
    and v_delivery_mode = 'email'
    and jsonb_array_length(v_recipients) = 0
  then
    raise exception using errcode = '22023', message = 'Email delivery requires at least one valid audited recipient.';
  end if;
  if v_target = 'sent'
    and v_delivery_mode in ('manual', 'external')
    and length(v_reason) < 3
  then
    raise exception using errcode = '22023', message = 'Manual or external delivery requires an audited delivery note.';
  end if;
  if v_target = 'void' and length(v_reason) < 3 then
    raise exception using errcode = '22023', message = 'Voiding an invoice requires a reason.';
  end if;

  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to transition this invoice.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'command', 'transition',
    'invoice_id', p_billing_invoice_id,
    'to_status', v_target,
    'delivery_mode', v_delivery_mode,
    'sent_recipients', v_recipients,
    'reason', v_reason
  )::text);
  select * into v_existing
  from public.billing_invoice_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'transition'
      or v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This invoice command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if p_expected_updated_at is null
    or v_invoice.updated_at is distinct from p_expected_updated_at
  then
    raise exception using
      errcode = '40001',
      message = 'This invoice changed after you opened it. Refresh before changing its lifecycle.';
  end if;

  if v_target = 'sent' then
    if v_invoice.status not in ('draft', 'sent', 'viewed', 'overdue')
      or v_invoice.paid_amount <> 0
      or v_invoice.total_due <= 0
    then
      raise exception using errcode = '23514', message = 'Only a positive, cash-free open invoice can be sent.';
    end if;

    if v_invoice.billing_application_id is not null then
      select * into v_application
      from public.billing_applications application
      where application.id = v_invoice.billing_application_id
        and application.project_id = v_project_id
      for update;
      if not found then
        raise exception using errcode = '23503', message = 'The linked pay application no longer exists.';
      end if;
      if v_application.status = 'rejected' then
        raise exception using
          errcode = '23514',
          message = 'An invoice linked to a rejected pay application cannot be issued.';
      end if;
      if v_invoice.status = 'draft' then
        if v_application.status = 'draft' then
          v_application_transition := public.transition_billing_application_atomic(
            v_application.id,
            'submitted',
            'Submitted atomically with initial invoice issuance.',
            'invoice-issue:' || md5(v_invoice.id::text || ':' || v_key)
          );
          select * into v_application
          from public.billing_applications application
          where application.id = v_invoice.billing_application_id;
        end if;
        if v_application.status <> 'submitted' then
          raise exception using
            errcode = '23514',
            message = 'Initial invoice issuance requires an authoritative submitted pay application.';
        end if;
      end if;
    end if;
  elsif v_target = 'overdue' then
    if v_invoice.status not in ('sent', 'viewed', 'overdue')
      or not v_invoice.client_visible
      or v_invoice.paid_amount <> 0
    then
      raise exception using errcode = '23514', message = 'Only a sent, cash-free invoice can be marked overdue.';
    end if;
  else
    if v_invoice.status not in ('draft', 'sent', 'viewed', 'overdue')
      or v_invoice.paid_amount <> 0
      or v_invoice.online_payment_status = 'pending'
      or nullif(btrim(v_invoice.stripe_checkout_session_id), '') is not null
        and v_invoice.online_payment_status = 'pending'
      or exists (
        select 1 from public.payment_ledger ledger
        where ledger.invoice_id = v_invoice.id and ledger.status = 'pending'
      )
    then
      raise exception using
        errcode = '23514',
        message = 'An invoice with cash or a pending checkout cannot be voided. Resolve payment state first.';
    end if;
  end if;

  perform set_config('overwatch.billing_invoice_command', 'transitioning', true);
  update public.billing_invoices invoice
  set status = case
        when v_target = 'sent' and invoice.status <> 'draft' then invoice.status
        else v_target
      end,
      client_visible = case when v_target = 'sent' then true else invoice.client_visible end,
      sent_at = case when v_target = 'sent' then coalesce(invoice.sent_at, now()) else invoice.sent_at end,
      sent_recipients = case when v_target = 'sent' then v_recipients else invoice.sent_recipients end,
      notes = case
        when v_target = 'sent' and v_delivery_mode in ('manual', 'external') then
          concat_ws(
            E'\n', nullif(invoice.notes, ''),
            upper(v_delivery_mode) || ' DELIVERY: ' || v_reason
          )
        when v_target = 'void' and v_reason <> '' then
          concat_ws(E'\n', nullif(invoice.notes, ''), 'VOID: ' || v_reason)
        else invoice.notes
      end
  where invoice.id = p_billing_invoice_id
  returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'status', v_invoice.status,
    'clientVisible', v_invoice.client_visible,
    'deliveryMode', case when v_target = 'sent' then v_delivery_mode else null end,
    'updatedAt', v_invoice.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_invoice.id, 'transition', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.delete_billing_invoice_draft_atomic(
  p_billing_invoice_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_existing public.billing_invoice_commands%rowtype;
  v_result jsonb;
  v_fingerprint text := md5(jsonb_build_object(
    'command', 'delete', 'invoice_id', p_billing_invoice_id
  )::text);
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to delete an invoice draft.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid invoice command idempotency key is required.';
  end if;

  -- This lookup deliberately precedes the invoice lookup. A successful delete
  -- leaves no parent row, so its immutable command is the retry tombstone.
  select * into v_existing
  from public.billing_invoice_commands command
  where command.billing_invoice_id = p_billing_invoice_id
    and command.idempotency_key = v_key
  order by command.created_at desc
  limit 1
  for update;
  if found then
    if v_existing.command_type <> 'delete'
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '23505', message = 'This invoice command idempotency key was already used.';
    end if;
    if not public.can_manage_project(v_existing.project_id) then
      raise exception using errcode = '42501', message = 'You do not have permission to delete this invoice draft.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  -- Follow the same project -> invoice lock order as create, update, and
  -- transition. Locking the invoice first can deadlock a concurrent edit that
  -- already owns the project serialization row.
  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to delete this invoice draft.';
  end if;
  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if v_invoice.status <> 'draft'
    or v_invoice.client_visible
    or v_invoice.sent_at is not null
    or v_invoice.paid_amount <> 0
    or v_invoice.online_payment_status <> 'not_enabled'
    or nullif(btrim(v_invoice.stripe_checkout_session_id), '') is not null
    or exists (select 1 from public.payment_ledger ledger where ledger.invoice_id = v_invoice.id)
    or exists (
      select 1 from public.billing_invoices correction
      where correction.correction_of_invoice_id = v_invoice.id
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Only an unsent, cash-free invoice draft without payment or correction history can be deleted.';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'status', v_invoice.status,
    'invoiceNumber', v_invoice.invoice_number,
    'totalDue', v_invoice.total_due,
    'deleted', true,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_invoice.id, 'delete', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  perform set_config('overwatch.billing_invoice_command', 'deleting', true);
  delete from public.billing_invoices invoice where invoice.id = p_billing_invoice_id;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );
  return v_result;
end;
$$;

create or replace function public.correct_billing_invoice_atomic(
  p_billing_invoice_id uuid,
  p_replacement_payload jsonb,
  p_reason text,
  p_expected_updated_at timestamptz,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invoice public.billing_invoices%rowtype;
  v_existing public.billing_invoice_commands%rowtype;
  v_replacement public.billing_invoices%rowtype;
  v_void_result jsonb;
  v_create_result jsonb;
  v_result jsonb;
  v_payload jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to correct an invoice.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 or length(v_reason) < 3 or length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'A valid correction key and reason are required.';
  end if;
  if p_replacement_payload is null or jsonb_typeof(p_replacement_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'A replacement invoice payload is required.';
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  perform 1 from public.projects project where project.id = v_invoice.project_id for update;
  if not public.can_manage_project(v_invoice.project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to correct this invoice.';
  end if;

  v_payload := p_replacement_payload || jsonb_build_object(
    'billing_application_id', v_invoice.billing_application_id,
    'paid_amount', 0,
    'status', 'draft',
    'client_visible', false,
    'sent_recipients', '[]'::jsonb
  );
  v_fingerprint := md5(jsonb_build_object(
    'command', 'correct', 'invoice_id', p_billing_invoice_id,
    'replacement', v_payload, 'reason', v_reason
  )::text);
  select * into v_existing
  from public.billing_invoice_commands command
  where command.project_id = v_invoice.project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'correct'
      or v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '23505', message = 'This invoice command idempotency key was already used.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if p_expected_updated_at is null
    or v_invoice.updated_at is distinct from p_expected_updated_at
  then
    raise exception using errcode = '40001', message = 'This invoice changed after you opened it. Refresh before correcting it.';
  end if;
  if v_invoice.status = 'draft'
    or v_invoice.status in ('partially_paid', 'paid', 'void')
    or v_invoice.paid_amount <> 0
    or v_invoice.online_payment_status = 'pending'
  then
    raise exception using
      errcode = '23514',
      message = 'Only an issued, cash-free invoice can be corrected. Resolve payment state or edit the draft instead.';
  end if;

  v_void_result := public.transition_billing_invoice_atomic(
    v_invoice.id, 'void', '[]'::jsonb,
    'Superseded by correction: ' || v_reason,
    v_invoice.updated_at,
    'correct-void:' || md5(v_invoice.project_id::text || ':' || v_key)
  );
  v_create_result := public.create_billing_invoice_atomic(
    v_invoice.project_id,
    v_payload,
    'correct-create:' || md5(v_invoice.project_id::text || ':' || v_key)
  );
  select * into v_replacement
  from public.billing_invoices replacement
  where replacement.id = (v_create_result->>'billingInvoiceId')::uuid
  for update;
  perform set_config('overwatch.billing_invoice_command', 'correcting', true);
  update public.billing_invoices
  set correction_of_invoice_id = v_invoice.id
  where id = v_replacement.id
  returning * into v_replacement;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'replacementInvoiceId', v_replacement.id,
    'status', 'void',
    'replacementStatus', v_replacement.status,
    'updatedAt', v_replacement.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_invoice.project_id, v_invoice.id, 'correct', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.append_invoice_collections_note_atomic(
  p_billing_invoice_id uuid,
  p_note text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_existing public.billing_invoice_commands%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_note text := regexp_replace(btrim(coalesce(p_note, '')), '\s+', ' ', 'g');
  v_entry text;
  v_next_log text;
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to append a collections note.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid collections-note idempotency key is required.';
  end if;
  if length(v_note) = 0 or length(v_note) > 500 then
    raise exception using errcode = '22023', message = 'A collections note must be between 1 and 500 characters.';
  end if;

  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update collections for this invoice.';
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'command', 'collections_note',
    'invoice_id', p_billing_invoice_id,
    'note', v_note
  )::text);
  select * into v_existing
  from public.billing_invoice_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'collections_note'
      or v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using errcode = '23505', message = 'This collections-note idempotency key was already used.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if v_invoice.status = 'void' then
    raise exception using errcode = '23514', message = 'Collections activity cannot be added to a void invoice.';
  end if;

  v_entry := to_char(timezone('UTC', clock_timestamp())::date, 'YYYY-MM-DD') || ' — ' || v_note;
  v_next_log := left(concat_ws(E'\n', v_entry, nullif(btrim(v_invoice.collections_log), '')), 20000);
  perform set_config('overwatch.billing_invoice_command', 'updating', true);
  update public.billing_invoices invoice
  set collections_log = v_next_log
  where invoice.id = p_billing_invoice_id
  returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'collectionsLog', v_invoice.collections_log,
    'updatedAt', v_invoice.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_commands (
    project_id, billing_invoice_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_invoice.id, 'collections_note', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

-- Preserve a server-generated payment timestamp across a lost-response retry.
-- The previous function's `default now()` is evaluated again for each RPC,
-- which made an otherwise identical retry conflict with the committed receipt.
do $$
begin
  -- Preserve the prior wrapper once. Exact migration replays must keep that
  -- delegate in place instead of attempting to rename the current outer
  -- wrapper onto an already occupied function name.
  if to_regprocedure(
    'public.record_invoice_payment_atomic_pre_invoice_commands(uuid,bigint,bigint,bigint,timestamptz,text,text,text,text,text,text)'
  ) is null then
    alter function public.record_invoice_payment_atomic(
      uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
    ) rename to record_invoice_payment_atomic_pre_invoice_commands;
  end if;
end;
$$;

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
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_existing_paid_at timestamptz;
  v_effective_paid_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to record an invoice payment.';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null or length(p_idempotency_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid payment idempotency key is required.';
  end if;
  if p_amount_cents is null
    or p_amount_cents <= 0
    or p_amount_cents > 9007199254740991
    or p_processor_fee_cents is null
    or p_processor_fee_cents < 0
    or p_processor_fee_cents > 9007199254740991
    or p_overwatch_fee_cents is null
    or p_overwatch_fee_cents < 0
    or p_overwatch_fee_cents > 9007199254740991
    or p_processor_fee_cents::numeric + p_overwatch_fee_cents::numeric > p_amount_cents
  then
    raise exception using
      errcode = '22003',
      message = 'Payment and fee cents must remain within the safe integer money domain.';
  end if;
  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to record this payment.';
  end if;

  perform 1 from public.billing_invoices invoice where invoice.id = p_invoice_id for update;
  select ledger.paid_at into v_existing_paid_at
  from public.payment_ledger ledger
  where ledger.invoice_id = p_invoice_id
    and ledger.idempotency_key = btrim(p_idempotency_key)
  for update;
  v_effective_paid_at := coalesce(v_existing_paid_at, p_paid_at, clock_timestamp());

  return public.record_invoice_payment_atomic_pre_invoice_commands(
    p_invoice_id, p_amount_cents, p_processor_fee_cents,
    p_overwatch_fee_cents, v_effective_paid_at, p_payment_method,
    p_processor, p_processor_payment_id, p_reference, p_notes,
    p_idempotency_key
  );
end;
$$;

-- Client portal opens are operational invoice evidence, but service-role
-- callers still receive no raw invoice UPDATE. Each explicit open has one
-- caller-stable event key, immutable evidence, and one monotonic counter
-- increment even when the server response is lost and retried.
create table if not exists public.billing_invoice_portal_view_commands (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_invoice_id uuid not null,
  event_key text not null,
  request_fingerprint text not null,
  viewer_user_id uuid not null,
  viewer_email text not null default '',
  user_agent text not null default '',
  viewed_at timestamptz not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint billing_invoice_portal_view_commands_event_length
    check (length(btrim(event_key)) between 8 and 200),
  constraint billing_invoice_portal_view_commands_project_event_unique
    unique (project_id, event_key)
);

create index if not exists billing_invoice_portal_view_commands_invoice_idx
  on public.billing_invoice_portal_view_commands (billing_invoice_id, viewed_at desc);

alter table public.billing_invoice_portal_view_commands enable row level security;
revoke all on public.billing_invoice_portal_view_commands
  from public, anon, authenticated, service_role;

create or replace function public.tg_billing_invoice_portal_view_commands_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Invoice portal-view evidence is immutable.';
end;
$$;

drop trigger if exists billing_invoice_portal_view_commands_immutable
  on public.billing_invoice_portal_view_commands;
create trigger billing_invoice_portal_view_commands_immutable
  before update or delete on public.billing_invoice_portal_view_commands
  for each row execute function public.tg_billing_invoice_portal_view_commands_immutable();

create or replace function public.record_billing_invoice_portal_view_atomic(
  p_billing_invoice_id uuid,
  p_viewer_user_id uuid,
  p_viewer_email text,
  p_event_key text,
  p_user_agent text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_organization_id uuid;
  v_project_owner_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_existing public.billing_invoice_portal_view_commands%rowtype;
  v_event_key text := btrim(coalesce(p_event_key, ''));
  v_viewer_email text := lower(btrim(coalesce(p_viewer_email, '')));
  v_user_agent text := left(coalesce(p_user_agent, ''), 1000);
  v_fingerprint text;
  v_viewed_at timestamptz;
  v_result jsonb;
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Only the trusted portal service may record an invoice view.';
  end if;
  if p_viewer_user_id is null
    or length(v_event_key) not between 8 and 200
    or length(v_viewer_email) > 320
    or length(coalesce(p_user_agent, '')) > 1000
  then
    raise exception using errcode = '22023', message = 'Portal-view evidence is invalid.';
  end if;

  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  select project.organization_id, project.owner_id
  into v_organization_id, v_project_owner_id
  from public.projects project
  where project.id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;

  v_fingerprint := encode(extensions.digest(jsonb_build_object(
    'invoice_id', p_billing_invoice_id,
    'viewer_user_id', p_viewer_user_id,
    'viewer_email', v_viewer_email,
    'user_agent', v_user_agent
  )::text, 'sha256'), 'hex');

  select * into v_existing
  from public.billing_invoice_portal_view_commands command
  where command.project_id = v_project_id
    and command.event_key = v_event_key
  for update;
  if found then
    if v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This portal-view event key was already used for different evidence.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  if v_invoice.status not in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
    or not v_invoice.client_visible
    or v_invoice.sent_at is null
  then
    raise exception using
      errcode = '23514',
      message = 'Only an issued, client-visible invoice can record a portal view.';
  end if;
  if not exists (
    select 1
    from public.project_client_access client_access
    where client_access.project_id = v_project_id
      and client_access.status in ('pending', 'active')
      and client_access.can_view_billing
      and (
        client_access.client_user_id = p_viewer_user_id
        or (length(v_viewer_email) > 0 and lower(client_access.email) = v_viewer_email)
      )
  )
  then
    raise exception using
      errcode = '42501',
      message = 'The viewer does not have client billing access to this invoice.';
  end if;
  if p_viewer_user_id = v_project_owner_id
    or exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = v_organization_id
        and membership.user_id = p_viewer_user_id
        and membership.status = 'active'
    )
    or exists (
      select 1 from public.project_memberships membership
      where membership.project_id = v_project_id
        and membership.user_id = p_viewer_user_id
        and membership.status = 'active'
    )
  then
    raise exception using
      errcode = '23514',
      message = 'Internal team invoice opens are not client-view evidence.';
  end if;
  if v_invoice.view_count < 0 or v_invoice.view_count >= 2147483647 then
    raise exception using errcode = '22003', message = 'Invoice view count is outside its safe range.';
  end if;

  v_viewed_at := clock_timestamp();
  perform set_config('overwatch.billing_invoice_command', 'portal_view', true);
  update public.billing_invoices invoice
  set status = case when invoice.status = 'sent' then 'viewed' else invoice.status end,
      first_viewed_at = case
        when invoice.first_viewed_at is null then v_viewed_at
        else least(invoice.first_viewed_at, v_viewed_at)
      end,
      last_viewed_at = greatest(
        coalesce(invoice.last_viewed_at, invoice.first_viewed_at, v_viewed_at),
        v_viewed_at
      ),
      view_count = invoice.view_count + 1
  where invoice.id = p_billing_invoice_id
  returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'status', v_invoice.status,
    'firstViewedAt', v_invoice.first_viewed_at,
    'lastViewedAt', v_invoice.last_viewed_at,
    'viewCount', v_invoice.view_count,
    'deduplicated', false
  );
  insert into public.billing_invoice_portal_view_commands (
    project_id, billing_invoice_id, event_key, request_fingerprint,
    viewer_user_id, viewer_email, user_agent, viewed_at, result
  ) values (
    v_project_id, v_invoice.id, v_event_key, v_fingerprint,
    p_viewer_user_id, v_viewer_email, v_user_agent, v_viewed_at, v_result
  );
  return v_result;
end;
$$;

-- Processor integrations receive one narrow, audited command surface. They do
-- not get raw invoice DML and cannot issue, reveal, void, or change money on an
-- invoice.
create table if not exists public.billing_invoice_processor_commands (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_invoice_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint billing_invoice_processor_commands_project_key_unique
    unique (project_id, idempotency_key)
);

create index if not exists billing_invoice_processor_commands_invoice_idx
  on public.billing_invoice_processor_commands (billing_invoice_id, created_at desc);

alter table public.billing_invoice_processor_commands enable row level security;
revoke all on public.billing_invoice_processor_commands
  from public, anon, authenticated, service_role;

create or replace function public.tg_billing_invoice_processor_commands_immutable()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Invoice processor command evidence is immutable.';
end;
$$;

drop trigger if exists billing_invoice_processor_commands_immutable
  on public.billing_invoice_processor_commands;
create trigger billing_invoice_processor_commands_immutable
  before update or delete on public.billing_invoice_processor_commands
  for each row execute function public.tg_billing_invoice_processor_commands_immutable();

create or replace function public.update_billing_invoice_processor_state_atomic(
  p_billing_invoice_id uuid,
  p_online_payment_status text,
  p_checkout_session_id text default '',
  p_payment_intent_id text default '',
  p_payment_url text default '',
  p_payment_enabled boolean default null,
  p_payment_link_sent_at timestamptz default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_invoice public.billing_invoices%rowtype;
  v_existing public.billing_invoice_processor_commands%rowtype;
  v_target text := lower(btrim(coalesce(p_online_payment_status, '')));
  v_session_id text := btrim(coalesce(p_checkout_session_id, ''));
  v_intent_id text := btrim(coalesce(p_payment_intent_id, ''));
  v_payment_url text := btrim(coalesce(p_payment_url, ''));
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_fingerprint text;
  v_result jsonb;
  v_previous_mode text := current_setting('overwatch.billing_invoice_command', true);
begin
  if coalesce(auth.jwt()->>'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'Only the trusted payment processor service may update processor state.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid processor idempotency key is required.';
  end if;
  if v_target not in ('not_enabled', 'pending', 'paid', 'expired', 'failed', 'refunded')
    or length(v_session_id) > 255
    or length(v_intent_id) > 255
    or length(v_payment_url) > 2000
  then
    raise exception using errcode = '22023', message = 'Processor state payload is invalid.';
  end if;

  select invoice.project_id into v_project_id
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;

  v_fingerprint := md5(jsonb_build_object(
    'invoice_id', p_billing_invoice_id,
    'online_payment_status', v_target,
    'checkout_session_id', v_session_id,
    'payment_intent_id', v_intent_id,
    'payment_url', v_payment_url,
    'payment_enabled', p_payment_enabled,
    'payment_link_sent_at', p_payment_link_sent_at
  )::text);

  select * into v_existing
  from public.billing_invoice_processor_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.billing_invoice_id is distinct from p_billing_invoice_id
      or v_existing.request_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This processor idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_invoice
  from public.billing_invoices invoice
  where invoice.id = p_billing_invoice_id
    and invoice.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Invoice not found.'; end if;

  if v_target = 'pending' then
    if v_invoice.status not in ('sent', 'viewed', 'overdue', 'partially_paid')
      or not v_invoice.client_visible
      or v_invoice.sent_at is null
      or v_invoice.total_due - v_invoice.paid_amount <= 0
      or length(v_session_id) = 0
    then
      raise exception using
        errcode = '23514',
        message = 'Checkout can only be opened for an issued, visible invoice with an outstanding balance.';
    end if;
    if v_invoice.online_payment_status = 'pending'
      and nullif(btrim(v_invoice.stripe_checkout_session_id), '') is not null
      and v_invoice.stripe_checkout_session_id <> v_session_id
    then
      raise exception using
        errcode = '23505',
        message = 'A different checkout session is already pending for this invoice.';
    end if;
  elsif v_target in ('expired', 'failed') then
    if v_invoice.online_payment_status not in ('pending', v_target)
      or (length(v_session_id) > 0
        and nullif(btrim(v_invoice.stripe_checkout_session_id), '') is not null
        and v_invoice.stripe_checkout_session_id <> v_session_id)
      or (length(v_intent_id) > 0
        and nullif(btrim(v_invoice.stripe_payment_intent_id), '') is not null
        and v_invoice.stripe_payment_intent_id <> v_intent_id)
    then
      raise exception using
        errcode = '23514',
        message = 'Only the matching pending checkout can fail or expire.';
    end if;
  elsif v_target = 'paid' then
    if v_invoice.paid_amount <= 0
      or v_invoice.status not in ('partially_paid', 'paid')
      or not exists (
        select 1
        from public.payment_ledger ledger
        where ledger.invoice_id = v_invoice.id
          and ledger.status = 'succeeded'
          and (
            length(v_session_id) = 0
            or btrim(ledger.stripe_checkout_session_id) = v_session_id
          )
          and (
            length(v_intent_id) = 0
            or btrim(ledger.stripe_payment_intent_id) = v_intent_id
          )
      )
    then
      raise exception using
        errcode = '23514',
        message = 'Processor paid state requires a committed matching payment receipt.';
    end if;
  elsif v_target = 'refunded' then
    if not exists (
      select 1
      from public.payment_refund_events refund
      where refund.invoice_id = v_invoice.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'Processor refunded state requires a committed refund event.';
    end if;
  elsif v_target = 'not_enabled' and v_invoice.online_payment_status <> 'not_enabled' then
    raise exception using
      errcode = '23514',
      message = 'Processor state cannot erase established payment history.';
  end if;

  perform set_config('overwatch.billing_invoice_command', 'processor', true);
  update public.billing_invoices invoice
  set online_payment_status = v_target,
      stripe_checkout_session_id = case
        when v_target = 'pending' then v_session_id
        when length(v_session_id) > 0 then coalesce(
          nullif(invoice.stripe_checkout_session_id, ''), v_session_id
        )
        else invoice.stripe_checkout_session_id
      end,
      stripe_payment_intent_id = case
        when length(v_intent_id) > 0 then coalesce(
          nullif(invoice.stripe_payment_intent_id, ''), v_intent_id
        )
        else invoice.stripe_payment_intent_id
      end,
      payment_url = case
        when v_target = 'pending' and length(v_payment_url) > 0 then v_payment_url
        else invoice.payment_url
      end,
      payment_enabled = case
        when v_target = 'pending' then coalesce(p_payment_enabled, true)
        when v_target in ('paid', 'expired', 'failed', 'refunded') then false
        else coalesce(p_payment_enabled, invoice.payment_enabled)
      end,
      payment_link_sent_at = case
        when v_target = 'pending' then coalesce(
          p_payment_link_sent_at, invoice.payment_link_sent_at, clock_timestamp()
        )
        else invoice.payment_link_sent_at
      end
  where invoice.id = p_billing_invoice_id
  returning * into v_invoice;
  perform set_config(
    'overwatch.billing_invoice_command', coalesce(v_previous_mode, ''), true
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingInvoiceId', v_invoice.id,
    'onlinePaymentStatus', v_invoice.online_payment_status,
    'checkoutSessionId', v_invoice.stripe_checkout_session_id,
    'paymentIntentId', v_invoice.stripe_payment_intent_id,
    'updatedAt', v_invoice.updated_at,
    'deduplicated', false
  );
  insert into public.billing_invoice_processor_commands (
    project_id, billing_invoice_id, idempotency_key,
    request_fingerprint, result
  ) values (
    v_project_id, v_invoice.id, v_key, v_fingerprint, v_result
  );
  return v_result;
end;
$$;

revoke insert, update, delete on public.billing_invoices from authenticated, service_role;

-- Raw invoice DML is closed above, so the old SECURITY INVOKER repair wrapper
-- would otherwise lose the UPDATE privilege it needs. Keep the batch helper
-- private and expose only the single-invoice, capability-checked wrapper as a
-- definer command. Payment functions and ledger triggers continue to call the
-- private batch helper as their owning database role.
alter function public.reconcile_invoice_payment_rollup(uuid) security definer;
revoke all on function public.reconcile_invoice_payment_rollups(uuid[], uuid[])
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_invoice_payment_rollup(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_invoice_payment_rollup(uuid)
  to authenticated;

revoke all on function public.create_billing_invoice_atomic(uuid, jsonb, text)
  from public, anon, service_role;
revoke all on function public.update_billing_invoice_atomic(uuid, jsonb, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.transition_billing_invoice_atomic(uuid, text, jsonb, text, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.delete_billing_invoice_draft_atomic(uuid, text)
  from public, anon, service_role;
revoke all on function public.correct_billing_invoice_atomic(uuid, jsonb, text, timestamptz, text)
  from public, anon, service_role;
revoke all on function public.append_invoice_collections_note_atomic(uuid, text, text)
  from public, anon, service_role;
revoke all on function public.record_invoice_payment_atomic_pre_invoice_commands(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) from public, anon, service_role;
revoke all on function public.update_billing_invoice_processor_state_atomic(
  uuid, text, text, text, text, boolean, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.tg_billing_invoice_processor_commands_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.tg_billing_invoice_legacy_repairs_immutable()
  from public, anon, authenticated, service_role;
revoke all on function public.record_billing_invoice_portal_view_atomic(
  uuid, uuid, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.tg_billing_invoice_portal_view_commands_immutable()
  from public, anon, authenticated, service_role;

grant execute on function public.create_billing_invoice_atomic(uuid, jsonb, text)
  to authenticated;
grant execute on function public.update_billing_invoice_atomic(uuid, jsonb, timestamptz, text)
  to authenticated;
grant execute on function public.transition_billing_invoice_atomic(uuid, text, jsonb, text, timestamptz, text)
  to authenticated;
grant execute on function public.delete_billing_invoice_draft_atomic(uuid, text)
  to authenticated;
grant execute on function public.correct_billing_invoice_atomic(uuid, jsonb, text, timestamptz, text)
  to authenticated;
grant execute on function public.append_invoice_collections_note_atomic(uuid, text, text)
  to authenticated;
grant execute on function public.record_invoice_payment_atomic(
  uuid, bigint, bigint, bigint, timestamptz, text, text, text, text, text, text
) to authenticated;
grant execute on function public.update_billing_invoice_processor_state_atomic(
  uuid, text, text, text, text, boolean, timestamptz, text
) to service_role;
grant execute on function public.record_billing_invoice_portal_view_atomic(
  uuid, uuid, text, text, text
) to service_role;

notify pgrst, 'reload schema';
