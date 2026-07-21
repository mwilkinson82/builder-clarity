-- Billing-application command integrity.
--
-- A pay application is a financial document, not a loose collection of REST
-- writes. Creation, lifecycle transitions, draft edits, and eligible deletion
-- are therefore serialized per project, retry-safe, and audited in the same
-- database transaction.

-- Hold off application writes for the entire upgrade transaction. Production
-- already contains a duplicate sort position, so the repair and replacement
-- unique index must be one race-free operation.
lock table public.billing_applications in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.billing_applications application
    where application.contract_amount < 0
      or application.contract_amount + application.change_order_amount < 0
      or application.amount_billed < 0
      or application.paid_to_date < 0
      or application.retainage < 0
      or application.retainage > application.amount_billed
      or application.contract_amount * 100 <> trunc(application.contract_amount * 100)
      or application.change_order_amount * 100 <> trunc(application.change_order_amount * 100)
      or application.amount_billed * 100 <> trunc(application.amount_billed * 100)
      or application.paid_to_date * 100 <> trunc(application.paid_to_date * 100)
      or application.retainage * 100 <> trunc(application.retainage * 100)
      or greatest(
        abs(application.contract_amount * 100),
        abs(application.change_order_amount * 100),
        abs((application.contract_amount + application.change_order_amount) * 100),
        abs(application.amount_billed * 100),
        abs(application.paid_to_date * 100),
        abs(application.retainage * 100)
      ) > 9007199254740991
      or application.status not in ('draft', 'submitted', 'rejected', 'partial', 'paid')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Billing-application integrity migration blocked: repair invalid status, revised contract, retainage, or fractional-cent money first.';
  end if;
end
$$;

-- A project lock serializes the following deterministic resequence and every
-- future create command. Historical relative order is preserved.
drop index if exists public.billing_applications_project_sort_order_unique;

with ranked as (
  select
    application.id,
    row_number() over (
      partition by application.project_id
      order by application.sort_order, application.created_at, application.id
    )::integer as next_sort_order
  from public.billing_applications application
)
update public.billing_applications application
set sort_order = ranked.next_sort_order
from ranked
where application.id = ranked.id
  and application.sort_order is distinct from ranked.next_sort_order;

create unique index billing_applications_project_sort_order_unique
  on public.billing_applications (project_id, sort_order);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_applications_status_integrity_check'
  ) then
    alter table public.billing_applications
      add constraint billing_applications_status_integrity_check
      check (status in ('draft', 'submitted', 'rejected', 'partial', 'paid'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_applications_sort_order_positive_check'
  ) then
    alter table public.billing_applications
      add constraint billing_applications_sort_order_positive_check
      check (sort_order > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'billing_applications_money_integrity_check'
  ) then
    alter table public.billing_applications
      add constraint billing_applications_money_integrity_check
      check (
        contract_amount >= 0
        and contract_amount + change_order_amount >= 0
        and amount_billed >= 0
        and paid_to_date >= 0
        and retainage >= 0
        and retainage <= amount_billed
        and contract_amount * 100 = trunc(contract_amount * 100)
        and change_order_amount * 100 = trunc(change_order_amount * 100)
        and amount_billed * 100 = trunc(amount_billed * 100)
        and paid_to_date * 100 = trunc(paid_to_date * 100)
        and retainage * 100 = trunc(retainage * 100)
        and greatest(
          abs(contract_amount * 100),
          abs(change_order_amount * 100),
          abs((contract_amount + change_order_amount) * 100),
          abs(amount_billed * 100),
          abs(paid_to_date * 100),
          abs(retainage * 100)
        ) <= 9007199254740991
      );
  end if;
end
$$;

-- This command journal deliberately does not foreign-key the target
-- application. A successful delete must leave an idempotency tombstone and an
-- operator-auditable copy of what was deleted.
create table if not exists public.billing_application_commands (
  id uuid primary key default gen_random_uuid(),
  -- Financial command evidence must outlive the mutable UI document. A
  -- project with pay-application history is archived, not hard-deleted.
  project_id uuid not null references public.projects(id) on delete restrict,
  billing_application_id uuid not null,
  command_type text not null check (command_type in ('create', 'update', 'transition', 'delete')),
  idempotency_key text not null,
  idempotency_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  constraint billing_application_commands_project_key_unique
    unique (project_id, idempotency_key)
);

create index if not exists billing_application_commands_application_idx
  on public.billing_application_commands (billing_application_id, created_at desc);

alter table public.billing_application_commands enable row level security;
revoke all on public.billing_application_commands from public, anon, authenticated, service_role;

comment on table public.billing_application_commands is
  'Immutable retry journal for atomic pay-application create, edit, transition, and delete commands.';

-- Direct authenticated updates previously bypassed lifecycle events. Preserve
-- internal line/payment reconciliation modes, project cascades, migrations,
-- and trusted service work while forcing ordinary authenticated writes through
-- the command RPCs below.
create or replace function public.tg_enforce_billing_application_command_path()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_command_mode text := coalesce(
    current_setting('overwatch.billing_application_command', true),
    ''
  );
  v_line_rollup_mode text := coalesce(
    current_setting('overwatch.billing_application_line_rollup_write', true),
    ''
  );
  v_line_generation_mode text := coalesce(
    current_setting('overwatch.billing_line_authoritative_write', true),
    ''
  );
  v_payment_rollup_mode text := coalesce(
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
      v_command_mode = 'updating'
      or v_line_rollup_mode = 'reconciling'
      or v_line_generation_mode = 'generating'
      or v_payment_rollup_mode in ('deferred', 'reconciling')
    ))
    or (tg_op = 'DELETE' and v_command_mode = 'deleting')
  then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception using
    errcode = '42501',
    message = 'Pay applications must be changed through an atomic billing command.';
end;
$$;

drop trigger if exists billing_applications_enforce_command_path
  on public.billing_applications;
create trigger billing_applications_enforce_command_path
  before insert or update or delete on public.billing_applications
  for each row execute function public.tg_enforce_billing_application_command_path();

revoke all on function public.tg_enforce_billing_application_command_path()
  from public, anon, authenticated, service_role;

-- Events are audit records. Validate their application/project identity and
-- make them immutable except an application/project cascade or the safe-draft
-- delete command below.
create or replace function public.tg_enforce_billing_application_event_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_application_project_id uuid;
  v_delete_mode text := coalesce(
    current_setting('overwatch.billing_application_event_delete', true),
    ''
  );
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1
      or (v_delete_mode = 'deleting_draft' and old.event_type in ('created', 'draft_updated'))
    then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'Billing application events are immutable audit records.';
  end if;

  if tg_op = 'UPDATE' then
    raise exception using
      errcode = '23514',
      message = 'Billing application events are immutable audit records.';
  end if;

  select application.project_id
  into v_application_project_id
  from public.billing_applications application
  where application.id = new.billing_application_id;

  if not found or new.project_id is distinct from v_application_project_id then
    raise exception using
      errcode = '23514',
      message = 'Billing application event scope must match its pay application.';
  end if;

  if new.amount * 100 <> trunc(new.amount * 100) then
    raise exception using
      errcode = '23514',
      message = 'Billing application event amounts must be exact to the cent.';
  end if;

  return new;
end;
$$;

drop trigger if exists billing_application_events_enforce_integrity
  on public.billing_application_events;
create trigger billing_application_events_enforce_integrity
  before insert or update or delete on public.billing_application_events
  for each row execute function public.tg_enforce_billing_application_event_integrity();

revoke all on function public.tg_enforce_billing_application_event_integrity()
  from public, anon, authenticated, service_role;
revoke insert, update, delete on public.billing_application_events from authenticated;
revoke insert, update, delete on public.billing_applications from authenticated, service_role;

create or replace function public.create_billing_application_atomic(
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
  v_existing public.billing_application_commands%rowtype;
  v_application public.billing_applications%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_application_number text;
  v_invoice_number text;
  v_billing_period text;
  v_notes text;
  v_submitted_date date;
  v_due_date date;
  v_output_format text;
  v_contract_amount numeric;
  v_change_order_amount numeric;
  v_amount_billed numeric;
  v_retainage numeric;
  v_cumulative_billed numeric;
  v_next_sort_order integer;
  v_previous_command_mode text := current_setting('overwatch.billing_application_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create a pay application.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid billing command idempotency key is required.';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'Pay-application payload must be a JSON object.';
  end if;
  if (p_payload - array[
    'application_number', 'invoice_number', 'submitted_date', 'due_date',
    'billing_period', 'contract_amount', 'change_order_amount', 'amount_billed',
    'paid_to_date', 'retainage', 'status', 'output_format', 'notes', 'sort_order'
  ]::text[]) <> '{}'::jsonb then
    raise exception using errcode = '22023', message = 'Pay-application payload contains unsupported fields.';
  end if;
  if coalesce(p_payload->>'status', 'draft') <> 'draft'
    or coalesce(nullif(p_payload->>'paid_to_date', '')::numeric, 0) <> 0
  then
    raise exception using
      errcode = '23514',
      message = 'A pay application must be created as a cash-free draft, then transitioned separately.';
  end if;

  v_application_number := coalesce(p_payload->>'application_number', '');
  v_invoice_number := coalesce(p_payload->>'invoice_number', '');
  v_billing_period := coalesce(p_payload->>'billing_period', '');
  v_notes := coalesce(p_payload->>'notes', '');
  v_submitted_date := nullif(p_payload->>'submitted_date', '')::date;
  v_due_date := nullif(p_payload->>'due_date', '')::date;
  v_output_format := coalesce(nullif(p_payload->>'output_format', ''), 'invoice');
  v_contract_amount := coalesce(nullif(p_payload->>'contract_amount', '')::numeric, 0);
  v_change_order_amount := coalesce(nullif(p_payload->>'change_order_amount', '')::numeric, 0);
  v_amount_billed := coalesce(nullif(p_payload->>'amount_billed', '')::numeric, 0);
  v_retainage := coalesce(nullif(p_payload->>'retainage', '')::numeric, 0);

  if length(v_application_number) > 100
    or length(v_invoice_number) > 100
    or length(v_billing_period) > 100
    or length(v_notes) > 2000
    or v_output_format not in ('invoice', 'aia_g702')
  then
    raise exception using errcode = '22023', message = 'Pay-application text or output format is invalid.';
  end if;
  if v_contract_amount < 0
    or v_contract_amount + v_change_order_amount < 0
    or v_amount_billed < 0
    or v_retainage < 0
    or v_retainage > v_amount_billed
    or greatest(abs(v_contract_amount), abs(v_change_order_amount), v_amount_billed, v_retainage) * 100 > 9007199254740991
    or v_contract_amount * 100 <> trunc(v_contract_amount * 100)
    or v_change_order_amount * 100 <> trunc(v_change_order_amount * 100)
    or v_amount_billed * 100 <> trunc(v_amount_billed * 100)
    or v_retainage * 100 <> trunc(v_retainage * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Pay-application money must be safe exact cents with a nonnegative revised contract, and retainage cannot exceed the billed amount.';
  end if;

  v_payload := jsonb_build_object(
    'application_number', v_application_number,
    'invoice_number', v_invoice_number,
    'submitted_date', v_submitted_date,
    'due_date', v_due_date,
    'billing_period', v_billing_period,
    'contract_amount', v_contract_amount,
    'change_order_amount', v_change_order_amount,
    'amount_billed', v_amount_billed,
    'retainage', v_retainage,
    'status', 'draft',
    'output_format', v_output_format,
    'notes', v_notes
  );
  v_fingerprint := md5(jsonb_build_object(
    'command', 'create', 'project_id', p_project_id, 'payload', v_payload
  )::text);

  perform 1 from public.projects project where project.id = p_project_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Project not found.';
  end if;
  if not public.can_manage_project(p_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to create this pay application.';
  end if;

  select * into v_existing
  from public.billing_application_commands command
  where command.project_id = p_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'create'
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This billing command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  -- Contract authority is never accepted from a browser payload. Lock every
  -- owner-change-order row after the project row so approval and pay-app
  -- commands cannot race, then derive the exact revised contract from the
  -- project and approved CO ledger.
  perform 1
  from public.change_orders change_order
  where change_order.project_id = p_project_id
  order by change_order.id
  for update;

  select
    project.original_contract,
    coalesce(sum(change_order.contract_amount) filter (
      where change_order.status = 'Approved'
    ), 0)
  into v_contract_amount, v_change_order_amount
  from public.projects project
  left join public.change_orders change_order
    on change_order.project_id = project.id
  where project.id = p_project_id
  group by project.id, project.original_contract;

  if (p_payload ? 'contract_amount'
      and (p_payload->>'contract_amount')::numeric is distinct from v_contract_amount)
    or (p_payload ? 'change_order_amount'
      and (p_payload->>'change_order_amount')::numeric is distinct from v_change_order_amount)
  then
    raise exception using
      errcode = '40001',
      message = 'The project contract changed. Refresh before creating the pay application.';
  end if;
  if v_contract_amount < 0
    or v_contract_amount + v_change_order_amount < 0
    or greatest(
      abs(v_contract_amount),
      abs(v_change_order_amount),
      abs(v_contract_amount + v_change_order_amount)
    ) * 100 > 9007199254740991
    or v_contract_amount * 100 <> trunc(v_contract_amount * 100)
    or v_change_order_amount * 100 <> trunc(v_change_order_amount * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'The authoritative revised contract is not representable as safe exact cents.';
  end if;

  -- The project row lock above serializes this capacity read with every other
  -- header command. Drafts count because the product ledger counts them as
  -- consumed billing capacity; a second browser cannot manufacture two drafts
  -- that collectively exceed the current revised contract.
  select coalesce(sum(application.amount_billed), 0)
  into v_cumulative_billed
  from public.billing_applications application
  where application.project_id = p_project_id;
  if v_cumulative_billed + v_amount_billed > v_contract_amount + v_change_order_amount then
    raise exception using
      errcode = '23514',
      message = 'Cumulative pay applications cannot exceed the revised contract.';
  end if;

  select coalesce(max(application.sort_order), 0) + 1
  into v_next_sort_order
  from public.billing_applications application
  where application.project_id = p_project_id;

  perform set_config('overwatch.billing_application_command', 'creating', true);
  insert into public.billing_applications (
    project_id, application_number, invoice_number, submitted_date, due_date,
    billing_period, contract_amount, change_order_amount, amount_billed,
    paid_to_date, retainage, status, output_format, notes, sort_order
  ) values (
    p_project_id, v_application_number, v_invoice_number, v_submitted_date, v_due_date,
    v_billing_period, v_contract_amount, v_change_order_amount, v_amount_billed,
    0, v_retainage, 'draft', v_output_format, v_notes, v_next_sort_order
  ) returning * into v_application;
  perform set_config(
    'overwatch.billing_application_command', coalesce(v_previous_command_mode, ''), true
  );

  insert into public.billing_application_events (
    billing_application_id, project_id, event_type, from_status, to_status,
    amount, notes, created_by
  ) values (
    v_application.id, p_project_id, 'created', '', 'draft',
    v_application.amount_billed,
    coalesce(nullif(v_application.notes, ''), 'Pay application created.'),
    auth.uid()
  );

  -- The first pay application freezes the budget baseline. The projects
  -- authority guard (installed later in this batch) only admits
  -- budget_locked_at changes from audited commands, so this command
  -- identifies itself before the update.
  perform set_config('overwatch.project_financial_command_write', 'on', true);
  update public.projects
  set budget_locked_at = coalesce(budget_locked_at, now())
  where id = p_project_id;

  v_result := jsonb_build_object(
    'ok', true,
    'billingApplicationId', v_application.id,
    'status', v_application.status,
    'sortOrder', v_application.sort_order,
    'deduplicated', false
  );
  insert into public.billing_application_commands (
    project_id, billing_application_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    p_project_id, v_application.id, 'create', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.update_billing_application_atomic(
  p_billing_application_id uuid,
  p_patch jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_application public.billing_applications%rowtype;
  v_existing public.billing_application_commands%rowtype;
  v_patch jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_previous_command_mode text := current_setting('overwatch.billing_application_command', true);
  v_contract_amount numeric;
  v_change_order_amount numeric;
  v_amount_billed numeric;
  v_retainage numeric;
  v_cumulative_billed numeric;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to update a pay application.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid billing command idempotency key is required.';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'A nonempty pay-application patch is required.';
  end if;
  if (p_patch - array[
    'application_number', 'invoice_number', 'submitted_date', 'due_date',
    'billing_period', 'contract_amount', 'change_order_amount', 'amount_billed',
    'retainage', 'output_format', 'notes'
  ]::text[]) <> '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'Draft updates cannot change status, order, cash, project, or derived billing fields.';
  end if;

  select application.project_id into v_project_id
  from public.billing_applications application
  where application.id = p_billing_application_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Pay application not found.';
  end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to update this pay application.';
  end if;

  perform 1
  from public.change_orders change_order
  where change_order.project_id = v_project_id
  order by change_order.id
  for update;

  select * into v_application
  from public.billing_applications application
  where application.id = p_billing_application_id
    and application.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pay application not found.'; end if;

  v_patch := jsonb_strip_nulls(jsonb_build_object(
    'application_number', case when p_patch ? 'application_number' then to_jsonb(coalesce(p_patch->>'application_number', '')) end,
    'invoice_number', case when p_patch ? 'invoice_number' then to_jsonb(coalesce(p_patch->>'invoice_number', '')) end,
    'submitted_date', case when p_patch ? 'submitted_date' then to_jsonb(nullif(p_patch->>'submitted_date', '')::date) end,
    'due_date', case when p_patch ? 'due_date' then to_jsonb(nullif(p_patch->>'due_date', '')::date) end,
    'billing_period', case when p_patch ? 'billing_period' then to_jsonb(coalesce(p_patch->>'billing_period', '')) end,
    'contract_amount', case when p_patch ? 'contract_amount' then to_jsonb((p_patch->>'contract_amount')::numeric) end,
    'change_order_amount', case when p_patch ? 'change_order_amount' then to_jsonb((p_patch->>'change_order_amount')::numeric) end,
    'amount_billed', case when p_patch ? 'amount_billed' then to_jsonb((p_patch->>'amount_billed')::numeric) end,
    'retainage', case when p_patch ? 'retainage' then to_jsonb((p_patch->>'retainage')::numeric) end,
    'output_format', case when p_patch ? 'output_format' then to_jsonb(coalesce(p_patch->>'output_format', '')) end,
    'notes', case when p_patch ? 'notes' then to_jsonb(coalesce(p_patch->>'notes', '')) end
  ));

  -- jsonb_strip_nulls would otherwise erase an intentional SQL NULL date. Put
  -- those date keys back so clearing a date remains a real update.
  if p_patch ? 'submitted_date' and nullif(p_patch->>'submitted_date', '') is null then
    v_patch := v_patch || jsonb_build_object('submitted_date', null);
  end if;
  if p_patch ? 'due_date' and nullif(p_patch->>'due_date', '') is null then
    v_patch := v_patch || jsonb_build_object('due_date', null);
  end if;

  v_fingerprint := md5(jsonb_build_object(
    'command', 'update', 'application_id', p_billing_application_id, 'patch', v_patch
  )::text);
  select * into v_existing
  from public.billing_application_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'update'
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This billing command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  if v_application.status not in ('draft', 'rejected') then
    raise exception using
      errcode = '23514',
      message = 'Submitted and payment-controlled pay applications are immutable financial history.';
  end if;
  if v_application.has_line_detail and (
    p_patch ? 'amount_billed' or p_patch ? 'retainage'
  ) then
    raise exception using
      errcode = '23514',
      message = 'A line-detail pay application derives billed amount and retainage from its billing lines.';
  end if;

  select
    project.original_contract,
    coalesce(sum(change_order.contract_amount) filter (
      where change_order.status = 'Approved'
    ), 0)
  into v_contract_amount, v_change_order_amount
  from public.projects project
  left join public.change_orders change_order
    on change_order.project_id = project.id
  where project.id = v_project_id
  group by project.id, project.original_contract;

  if (p_patch ? 'contract_amount'
      and (p_patch->>'contract_amount')::numeric is distinct from v_contract_amount)
    or (p_patch ? 'change_order_amount'
      and (p_patch->>'change_order_amount')::numeric is distinct from v_change_order_amount)
  then
    raise exception using
      errcode = '40001',
      message = 'The project contract changed. Refresh before saving the pay application.';
  end if;
  v_amount_billed := case when p_patch ? 'amount_billed'
    then (p_patch->>'amount_billed')::numeric else v_application.amount_billed end;
  v_retainage := case when p_patch ? 'retainage'
    then (p_patch->>'retainage')::numeric else v_application.retainage end;

  if v_contract_amount < 0
    or v_contract_amount + v_change_order_amount < 0
    or v_amount_billed < 0
    or v_retainage < 0
    or v_retainage > v_amount_billed
    or greatest(
      abs(v_contract_amount), abs(v_change_order_amount),
      abs(v_contract_amount + v_change_order_amount),
      v_amount_billed, v_retainage
    ) * 100 > 9007199254740991
    or v_contract_amount * 100 <> trunc(v_contract_amount * 100)
    or v_change_order_amount * 100 <> trunc(v_change_order_amount * 100)
    or v_amount_billed * 100 <> trunc(v_amount_billed * 100)
    or v_retainage * 100 <> trunc(v_retainage * 100)
  then
    raise exception using
      errcode = '23514',
      message = 'Pay-application money must be safe exact cents with a nonnegative revised contract, and retainage cannot exceed the billed amount.';
  end if;

  select coalesce(sum(application.amount_billed), 0)
  into v_cumulative_billed
  from public.billing_applications application
  where application.project_id = v_project_id
    and application.id <> p_billing_application_id;
  if v_cumulative_billed + v_amount_billed > v_contract_amount + v_change_order_amount then
    raise exception using
      errcode = '23514',
      message = 'Cumulative pay applications cannot exceed the revised contract.';
  end if;
  if (p_patch ? 'application_number' and length(coalesce(p_patch->>'application_number', '')) > 100)
    or (p_patch ? 'invoice_number' and length(coalesce(p_patch->>'invoice_number', '')) > 100)
    or (p_patch ? 'billing_period' and length(coalesce(p_patch->>'billing_period', '')) > 100)
    or (p_patch ? 'notes' and length(coalesce(p_patch->>'notes', '')) > 2000)
    or (p_patch ? 'output_format' and coalesce(p_patch->>'output_format', '') not in ('invoice', 'aia_g702'))
  then
    raise exception using errcode = '22023', message = 'Pay-application text or output format is invalid.';
  end if;

  perform set_config('overwatch.billing_application_command', 'updating', true);
  update public.billing_applications application
  set application_number = case when p_patch ? 'application_number' then coalesce(p_patch->>'application_number', '') else application.application_number end,
      invoice_number = case when p_patch ? 'invoice_number' then coalesce(p_patch->>'invoice_number', '') else application.invoice_number end,
      submitted_date = case when p_patch ? 'submitted_date' then nullif(p_patch->>'submitted_date', '')::date else application.submitted_date end,
      due_date = case when p_patch ? 'due_date' then nullif(p_patch->>'due_date', '')::date else application.due_date end,
      billing_period = case when p_patch ? 'billing_period' then coalesce(p_patch->>'billing_period', '') else application.billing_period end,
      contract_amount = v_contract_amount,
      change_order_amount = v_change_order_amount,
      amount_billed = v_amount_billed,
      retainage = v_retainage,
      output_format = case when p_patch ? 'output_format' then p_patch->>'output_format' else application.output_format end,
      notes = case when p_patch ? 'notes' then coalesce(p_patch->>'notes', '') else application.notes end
  where application.id = p_billing_application_id
  returning * into v_application;
  perform set_config(
    'overwatch.billing_application_command', coalesce(v_previous_command_mode, ''), true
  );

  insert into public.billing_application_events (
    billing_application_id, project_id, event_type, from_status, to_status,
    amount, notes, created_by
  ) values (
    v_application.id, v_project_id, 'draft_updated', v_application.status,
    v_application.status, v_application.amount_billed,
    'Draft pay application details updated.', auth.uid()
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingApplicationId', v_application.id,
    'status', v_application.status,
    'deduplicated', false
  );
  insert into public.billing_application_commands (
    project_id, billing_application_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_application.id, 'update', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.transition_billing_application_atomic(
  p_billing_application_id uuid,
  p_to_status text,
  p_reason text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_application public.billing_applications%rowtype;
  v_existing public.billing_application_commands%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_to_status text := btrim(coalesce(p_to_status, ''));
  v_reason text := coalesce(p_reason, '');
  v_previous_status text;
  v_cumulative_billed numeric;
  v_contract_amount numeric;
  v_change_order_amount numeric;
  v_previous_command_mode text := current_setting('overwatch.billing_application_command', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to transition a pay application.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid billing command idempotency key is required.';
  end if;
  if length(v_reason) > 2000 then
    raise exception using errcode = '22023', message = 'Pay-application transition reason is too long.';
  end if;

  select application.project_id into v_project_id
  from public.billing_applications application
  where application.id = p_billing_application_id;
  if not found then raise exception using errcode = 'P0002', message = 'Pay application not found.'; end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to transition this pay application.';
  end if;
  perform 1
  from public.change_orders change_order
  where change_order.project_id = v_project_id
  order by change_order.id
  for update;
  select * into v_application
  from public.billing_applications application
  where application.id = p_billing_application_id
    and application.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pay application not found.'; end if;

  v_fingerprint := md5(jsonb_build_object(
    'command', 'transition', 'application_id', p_billing_application_id,
    'to_status', v_to_status, 'reason', v_reason
  )::text);
  select * into v_existing
  from public.billing_application_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'transition'
      or v_existing.billing_application_id is distinct from p_billing_application_id
      or v_existing.idempotency_fingerprint is distinct from v_fingerprint
    then
      raise exception using
        errcode = '23505',
        message = 'This billing command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  if not (
    (v_application.status = 'draft' and v_to_status in ('submitted', 'rejected'))
    or (v_application.status = 'submitted' and v_to_status = 'rejected')
    or (v_application.status = 'rejected' and v_to_status = 'draft')
  ) then
    raise exception using
      errcode = '23514',
      message = 'That pay-application lifecycle transition is not allowed. Payment statuses come only from the ledger.';
  end if;
  if v_to_status = 'rejected' and exists (
    select 1
    from public.billing_invoices invoice
    where invoice.billing_application_id = v_application.id
      and (
        invoice.status in ('sent', 'viewed', 'overdue', 'partially_paid', 'paid')
        or invoice.sent_at is not null
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A pay application with an issued invoice cannot be rejected; correct or void the invoice first.';
  end if;
  if v_to_status = 'submitted' and v_application.amount_billed <= 0 then
    raise exception using
      errcode = '23514',
      message = 'A pay application must have a positive billed amount before submission.';
  end if;
  if v_to_status = 'submitted' and v_application.retainage > v_application.amount_billed then
    raise exception using
      errcode = '23514',
      message = 'Retainage held cannot exceed the billed amount.';
  end if;
  if v_to_status = 'submitted' then
    -- This is also the final gate for line-detail drafts. Their header totals
    -- are database-derived from immutable SOV lines, including signed
    -- deductive change orders, but two concurrent drafts can share the same
    -- prior-certified snapshot. The project lock makes certification capacity
    -- deterministic across both header-only and line-detail applications.
    select
      project.original_contract,
      coalesce(sum(change_order.contract_amount) filter (
        where change_order.status = 'Approved'
      ), 0)
    into v_contract_amount, v_change_order_amount
    from public.projects project
    left join public.change_orders change_order
      on change_order.project_id = project.id
    where project.id = v_project_id
    group by project.id, project.original_contract;

    if v_contract_amount < 0
      or v_contract_amount + v_change_order_amount < 0
      or greatest(
        abs(v_contract_amount),
        abs(v_change_order_amount),
        abs(v_contract_amount + v_change_order_amount)
      ) * 100 > 9007199254740991
      or v_contract_amount * 100 <> trunc(v_contract_amount * 100)
      or v_change_order_amount * 100 <> trunc(v_change_order_amount * 100)
    then
      raise exception using
        errcode = '23514',
        message = 'The authoritative revised contract is not representable as safe exact cents.';
    end if;

    select coalesce(sum(application.amount_billed), 0)
    into v_cumulative_billed
    from public.billing_applications application
    where application.project_id = v_project_id;
    if v_cumulative_billed > v_contract_amount + v_change_order_amount then
      raise exception using
        errcode = '23514',
        message = 'Cumulative pay applications cannot exceed the revised contract.';
    end if;
  end if;

  v_previous_status := v_application.status;
  perform set_config('overwatch.billing_application_command', 'updating', true);
  update public.billing_applications application
  set status = v_to_status,
      contract_amount = case
        when v_to_status = 'submitted' then v_contract_amount
        else application.contract_amount
      end,
      change_order_amount = case
        when v_to_status = 'submitted' then v_change_order_amount
        else application.change_order_amount
      end,
      submitted_date = case
        when v_to_status = 'submitted' then coalesce(application.submitted_date, current_date)
        else application.submitted_date
      end
  where application.id = p_billing_application_id
  returning * into v_application;
  perform set_config(
    'overwatch.billing_application_command', coalesce(v_previous_command_mode, ''), true
  );

  insert into public.billing_application_events (
    billing_application_id, project_id, event_type, from_status, to_status,
    amount, notes, created_by
  ) values (
    v_application.id, v_project_id, 'status_change', v_previous_status,
    v_application.status, v_application.amount_billed,
    coalesce(nullif(v_reason, ''), format(
      '%s moved from %s to %s.',
      coalesce(nullif(v_application.application_number, ''), 'Pay application'),
      v_previous_status,
      v_application.status
    )),
    auth.uid()
  );

  v_result := jsonb_build_object(
    'ok', true,
    'billingApplicationId', v_application.id,
    'fromStatus', v_previous_status,
    'toStatus', v_application.status,
    'reason', v_reason,
    'deduplicated', false
  );
  insert into public.billing_application_commands (
    project_id, billing_application_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_application.id, 'transition', v_key,
    v_fingerprint, v_result, auth.uid()
  );
  return v_result;
end;
$$;

create or replace function public.delete_billing_application_draft_atomic(
  p_billing_application_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_project_id uuid;
  v_application public.billing_applications%rowtype;
  v_existing public.billing_application_commands%rowtype;
  v_result jsonb;
  v_fingerprint text;
  v_key text := btrim(coalesce(p_idempotency_key, ''));
  v_previous_command_mode text := current_setting('overwatch.billing_application_command', true);
  v_previous_event_delete text := current_setting('overwatch.billing_application_event_delete', true);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required to delete a draft pay application.';
  end if;
  if length(v_key) = 0 or length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid billing command idempotency key is required.';
  end if;

  select application.project_id into v_project_id
  from public.billing_applications application
  where application.id = p_billing_application_id;

  if not found then
    select * into v_existing
    from public.billing_application_commands command
    where command.billing_application_id = p_billing_application_id
      and command.command_type = 'delete'
      and command.idempotency_key = v_key
    order by command.created_at desc
    limit 1;
    if found then
      if not public.can_manage_project(v_existing.project_id) then
        raise exception using errcode = '42501', message = 'You do not have permission to delete this pay application.';
      end if;
      return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
    end if;
    raise exception using errcode = 'P0002', message = 'Pay application not found.';
  end if;

  perform 1 from public.projects project where project.id = v_project_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Project not found.'; end if;
  if not public.can_manage_project(v_project_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to delete this pay application.';
  end if;

  select * into v_existing
  from public.billing_application_commands command
  where command.project_id = v_project_id
    and command.idempotency_key = v_key
  for update;
  if found then
    if v_existing.command_type <> 'delete'
      or v_existing.billing_application_id is distinct from p_billing_application_id
    then
      raise exception using
        errcode = '23505',
        message = 'This billing command idempotency key was already used for different details.';
    end if;
    return jsonb_set(v_existing.result, '{deduplicated}', 'true'::jsonb, true);
  end if;

  select * into v_application
  from public.billing_applications application
  where application.id = p_billing_application_id
    and application.project_id = v_project_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Pay application not found.'; end if;

  v_fingerprint := md5(jsonb_build_object(
    'command', 'delete', 'application_id', p_billing_application_id
  )::text);
  if v_application.status <> 'draft' then
    raise exception using
      errcode = '23514',
      message = 'Only a draft pay application without certification or payment history can be deleted.';
  end if;
  if exists (
    select 1 from public.billing_application_events event
    where event.billing_application_id = v_application.id
      and event.event_type not in ('created', 'draft_updated')
  ) or exists (
    select 1 from public.production_sov_billing_handoffs handoff
    where handoff.billing_application_id = v_application.id
  ) or exists (
    select 1 from public.billing_invoices invoice
    where invoice.billing_application_id = v_application.id
  ) or exists (
    select 1 from public.payment_ledger ledger
    where ledger.billing_application_id = v_application.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Only a draft pay application without certification, invoice, or payment history can be deleted.';
  end if;

  v_result := jsonb_build_object(
    'ok', true,
    'billingApplicationId', v_application.id,
    'deleted', true,
    'deletedSnapshot', to_jsonb(v_application),
    'deduplicated', false
  );
  insert into public.billing_application_commands (
    project_id, billing_application_id, command_type, idempotency_key,
    idempotency_fingerprint, result, actor_id
  ) values (
    v_project_id, v_application.id, 'delete', v_key,
    v_fingerprint, v_result, auth.uid()
  );

  perform set_config('overwatch.billing_application_event_delete', 'deleting_draft', true);
  delete from public.billing_application_events
  where billing_application_id = v_application.id;
  perform set_config(
    'overwatch.billing_application_event_delete', coalesce(v_previous_event_delete, ''), true
  );

  perform set_config('overwatch.billing_application_command', 'deleting', true);
  delete from public.billing_applications
  where id = v_application.id;
  perform set_config(
    'overwatch.billing_application_command', coalesce(v_previous_command_mode, ''), true
  );
  return v_result;
end;
$$;

revoke all on function public.create_billing_application_atomic(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.create_billing_application_atomic(uuid, jsonb, text)
  to authenticated;

revoke all on function public.update_billing_application_atomic(uuid, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.update_billing_application_atomic(uuid, jsonb, text)
  to authenticated;

revoke all on function public.transition_billing_application_atomic(uuid, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.transition_billing_application_atomic(uuid, text, text, text)
  to authenticated;

revoke all on function public.delete_billing_application_draft_atomic(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_billing_application_draft_atomic(uuid, text)
  to authenticated;

notify pgrst, 'reload schema';
