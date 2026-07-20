-- Estimate creation is a financial command, not a sequence of browser writes.
--
-- This migration makes estimate + initial-line creation one transaction,
-- serializes concurrent line appends through the estimate row, journals every
-- retryable operation, and removes raw authenticated/service-role INSERT
-- authority from the two financial tables.

-- PostgreSQL will not change an input type while stored generated extensions
-- depend on it. They contain no independent data, so rebuild them around the
-- widening instead of narrowing application validation to int4.
drop trigger if exists estimate_line_items_validate_safe_money
on public.estimate_line_items;

alter table public.estimate_line_items
  drop column material_extended_cents,
  drop column labor_extended_cents,
  drop column total_extended_cents;

alter table public.estimate_line_items
  alter column material_unit_cost_cents type bigint using material_unit_cost_cents::bigint,
  alter column labor_unit_cost_cents type bigint using labor_unit_cost_cents::bigint;

alter table public.estimate_line_items
  add column material_extended_cents bigint generated always as (
    round(quantity * material_unit_cost_cents)::bigint
  ) stored,
  add column labor_extended_cents bigint generated always as (
    round(quantity * labor_unit_cost_cents)::bigint
  ) stored,
  add column total_extended_cents bigint generated always as (
    round(quantity * (material_unit_cost_cents + labor_unit_cost_cents))::bigint
  ) stored;

create trigger estimate_line_items_validate_safe_money
before insert or update of quantity, material_unit_cost_cents, labor_unit_cost_cents
on public.estimate_line_items for each row
execute function public.tg_validate_estimate_line_safe_money();

alter table public.cost_library_items
  alter column material_cost_cents type bigint using material_cost_cents::bigint,
  alter column labor_cost_cents type bigint using labor_cost_cents::bigint;

create table if not exists public.estimate_create_operations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  operation_key text not null,
  request_fingerprint text not null,
  result jsonb not null default '{}'::jsonb,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint estimate_create_operations_key_length
    check (length(btrim(operation_key)) between 1 and 200),
  constraint estimate_create_operations_user_key_unique
    unique (changed_by, operation_key)
);

alter table public.estimate_create_operations enable row level security;

revoke all on table public.estimate_create_operations
from public, anon, authenticated, service_role;

grant select on table public.estimate_create_operations to authenticated, service_role;

drop policy if exists estimate_create_operations_select on public.estimate_create_operations;
create policy estimate_create_operations_select
on public.estimate_create_operations for select
to authenticated using (
  public.is_org_member(organization_id)
  or public.can_manage_org(organization_id)
  or public.is_super_admin()
);

drop trigger if exists estimate_create_operations_immutable
on public.estimate_create_operations;
create trigger estimate_create_operations_immutable
before update or delete on public.estimate_create_operations
for each row execute function public.reject_financial_journal_mutation();

alter table public.estimate_line_operations
drop constraint if exists estimate_line_operations_operation_type_check;

alter table public.estimate_line_operations
add constraint estimate_line_operations_operation_type_check check (
  operation_type in (
    'header_update', 'line_create', 'line_update', 'line_delete',
    'line_reorder', 'takeoff_sync', 'takeoff_create', 'takeoff_update',
    'takeoff_delete', 'takeoff_recalculate', 'takeoff_link',
    'takeoff_create_line'
  )
);

create or replace function public.insert_estimate_lines_authoritative(
  p_estimate_id uuid,
  p_lines jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_item record;
  v_line jsonb;
  v_description text;
  v_unit text;
  v_quantity numeric;
  v_material numeric;
  v_labor numeric;
  v_library_id uuid;
  v_base_order integer;
  v_created jsonb := '[]'::jsonb;
  v_row public.estimate_line_items%rowtype;
begin
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) > 500
  then
    raise exception using errcode = '22023', message = 'Estimate lines must be an array of at most 500 rows.';
  end if;

  select estimate.* into v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  select coalesce(max(line.sort_order), 0) into v_base_order
  from public.estimate_line_items line
  where line.estimate_id = p_estimate_id;

  for v_item in
    select value as line, ordinality
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality
  loop
    v_line := v_item.line;
    if jsonb_typeof(v_line) is distinct from 'object'
       or exists (
         select 1 from jsonb_object_keys(v_line) key
         where key not in (
           'csi_division', 'cost_code', 'description', 'unit', 'quantity',
           'material_unit_cost_cents', 'labor_unit_cost_cents',
           'library_item_id', 'scope_group', 'notes'
         )
       )
    then
      raise exception using errcode = '22023', message = 'An estimate line contains unsupported fields.';
    end if;

    v_description := btrim(coalesce(v_line ->> 'description', ''));
    v_unit := upper(btrim(coalesce(v_line ->> 'unit', '')));
    if v_description = '' or length(v_description) > 500
       or v_unit = '' or length(v_unit) > 16
    then
      raise exception using errcode = '22023', message = 'Every estimate line requires a valid description and unit.';
    end if;
    if length(coalesce(v_line ->> 'csi_division', '')) > 8
       or length(coalesce(v_line ->> 'cost_code', '')) > 32
       or length(coalesce(v_line ->> 'scope_group', '')) > 200
       or length(coalesce(v_line ->> 'notes', '')) > 2000
    then
      raise exception using errcode = '22023', message = 'An estimate-line value exceeds its allowed length.';
    end if;

    v_quantity := coalesce((v_line ->> 'quantity')::numeric, 0);
    if v_unit = 'LS' then v_quantity := 1; end if;
    if v_quantity < 0 or v_quantity > 999999999
       or v_quantity * 10000 <> trunc(v_quantity * 10000)
    then
      raise exception using errcode = '22003', message = 'Estimate-line quantity is outside the supported four-decimal range.';
    end if;

    v_material := coalesce((v_line ->> 'material_unit_cost_cents')::numeric, 0);
    v_labor := coalesce((v_line ->> 'labor_unit_cost_cents')::numeric, 0);
    perform public.assert_safe_accounting_cents(v_material, 'Estimate material unit cost');
    perform public.assert_safe_accounting_cents(v_labor, 'Estimate labor unit cost');
    perform public.assert_safe_accounting_cents(round(v_quantity * v_material), 'Estimate material extension');
    perform public.assert_safe_accounting_cents(round(v_quantity * v_labor), 'Estimate labor extension');
    perform public.assert_safe_accounting_cents(
      round(v_quantity * (v_material + v_labor)),
      'Estimate total extension'
    );

    v_library_id := nullif(v_line ->> 'library_item_id', '')::uuid;
    if v_library_id is not null and not exists (
      select 1 from public.cost_library_items library
      where library.id = v_library_id
        and library.organization_id = v_estimate.organization_id
    ) then
      raise exception using errcode = '23503', message = 'The cost-library item does not belong to this company.';
    end if;

    perform set_config('overwatch.estimate_revision_write', 'on', true);
    insert into public.estimate_line_items (
      estimate_id, csi_division, cost_code, description, unit, quantity,
      material_unit_cost_cents, labor_unit_cost_cents, library_item_id,
      scope_group, sort_order, notes
    ) values (
      p_estimate_id,
      left(btrim(coalesce(v_line ->> 'csi_division', '')), 8),
      left(btrim(coalesce(v_line ->> 'cost_code', '')), 32),
      v_description,
      v_unit,
      v_quantity,
      v_material::bigint,
      v_labor::bigint,
      v_library_id,
      left(coalesce(v_line ->> 'scope_group', ''), 200),
      v_base_order + v_item.ordinality::integer,
      left(coalesce(v_line ->> 'notes', ''), 2000)
    ) returning * into v_row;
    v_created := v_created || jsonb_build_array(to_jsonb(v_row));
  end loop;

  return v_created;
end;
$$;

revoke all on function public.insert_estimate_lines_authoritative(uuid, jsonb)
from public, anon, authenticated, service_role;

create or replace function public.create_estimate_atomic(
  p_organization_id uuid,
  p_header jsonb,
  p_initial_lines jsonb,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing public.estimate_create_operations%rowtype;
  v_defaults public.estimate_markup_defaults%rowtype;
  v_estimate public.estimates%rowtype;
  v_opportunity_id uuid;
  v_name text;
  v_kind text;
  v_project_type text;
  v_region text;
  v_region_multiplier numeric;
  v_custom_markups jsonb;
  v_fingerprint text;
  v_lines jsonb;
  v_totals jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to create an estimate.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid estimate-create operation key is required.';
  end if;
  if jsonb_typeof(p_header) is distinct from 'object'
     or exists (
       select 1 from jsonb_object_keys(p_header) key
       -- project_id is deliberately absent: an estimate acquires its project
       -- link ONLY through SOV conversion, which is what the freeze triggers
       -- treat as "converted". Creating a project-linked estimate would be
       -- frozen from birth and un-editable — a self-contradiction.
       where key not in (
         'name', 'description', 'opportunity_id', 'project_type',
         'kind', 'region', 'region_multiplier', 'overhead_pct', 'profit_pct',
         'contingency_pct', 'bond_pct', 'tax_pct', 'general_conditions_pct',
         'custom_markups'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The estimate-create header contains unsupported fields.';
  end if;
  if jsonb_typeof(coalesce(p_initial_lines, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(p_initial_lines, '[]'::jsonb)) > 500
  then
    raise exception using errcode = '22023', message = 'Initial estimate lines must be an array of at most 500 rows.';
  end if;

  -- The organization row is the serialization point for same-key retries.
  perform 1 from public.organizations organization
  where organization.id = p_organization_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Company workspace not found.';
  end if;
  if not (
    public.is_org_member(p_organization_id)
    or public.can_manage_org(p_organization_id)
    or public.is_super_admin()
  ) then
    raise exception using errcode = '42501', message = 'You do not have permission to create an estimate for this company.';
  end if;

  v_fingerprint := md5(
    jsonb_build_array(p_organization_id, p_header, coalesce(p_initial_lines, '[]'::jsonb))::text
  );
  select operation.* into v_existing
  from public.estimate_create_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This estimate-create operation key was already used for different content.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  v_name := btrim(coalesce(p_header ->> 'name', ''));
  if v_name = '' or length(v_name) > 200 then
    raise exception using errcode = '22023', message = 'Estimate name is required and cannot exceed 200 characters.';
  end if;
  if length(coalesce(p_header ->> 'description', '')) > 2000
     or length(coalesce(p_header ->> 'project_type', 'commercial')) > 32
     or length(coalesce(p_header ->> 'region', '')) > 64
  then
    raise exception using errcode = '22023', message = 'An estimate header value exceeds its allowed length.';
  end if;

  v_opportunity_id := nullif(p_header ->> 'opportunity_id', '')::uuid;
  if v_opportunity_id is not null and not exists (
    select 1 from public.pipeline_opportunities opportunity
    where opportunity.id = v_opportunity_id
      and opportunity.organization_id = p_organization_id
  ) then
    raise exception using errcode = '23503', message = 'The selected opportunity is unavailable in this company.';
  end if;

  select defaults.* into v_defaults
  from public.estimate_markup_defaults defaults
  where defaults.organization_id = p_organization_id;

  v_kind := coalesce(nullif(p_header ->> 'kind', ''), 'estimate');
  if v_kind not in ('estimate', 'master_sheet') then
    raise exception using errcode = '22023', message = 'Estimate kind is invalid.';
  end if;
  v_project_type := coalesce(nullif(btrim(p_header ->> 'project_type'), ''), 'commercial');
  v_region := coalesce(
    nullif(btrim(p_header ->> 'region'), ''),
    nullif(btrim(v_defaults.default_region), ''),
    ''
  );
  v_region_multiplier := coalesce(
    nullif(p_header ->> 'region_multiplier', '')::numeric,
    v_defaults.default_region_multiplier,
    1
  );
  if v_region_multiplier < 0 or v_region_multiplier > 10 then
    raise exception using errcode = '22023', message = 'Estimate region multiplier is invalid.';
  end if;

  v_custom_markups := coalesce(p_header -> 'custom_markups', v_defaults.custom_markups, '[]'::jsonb);
  if jsonb_typeof(v_custom_markups) is distinct from 'array'
     or jsonb_array_length(v_custom_markups) > 20
     or exists (
       select 1
       from jsonb_array_elements(v_custom_markups) markup
       where jsonb_typeof(markup) is distinct from 'object'
         or nullif(btrim(markup ->> 'name'), '') is null
         or length(markup ->> 'name') > 80
         or coalesce(markup ->> 'applies_to', 'subtotal') not in ('subtotal', 'material', 'labor')
         or coalesce((markup ->> 'pct')::numeric, 0) < 0
         or coalesce((markup ->> 'pct')::numeric, 0) > 100000
     )
  then
    raise exception using errcode = '22023', message = 'Estimate custom markups are invalid.';
  end if;

  insert into public.estimates (
    organization_id, created_by, name, description, opportunity_id,
    project_type, kind, region, region_multiplier,
    overhead_pct, profit_pct, contingency_pct, bond_pct, tax_pct,
    general_conditions_pct, custom_markups, status
  ) values (
    p_organization_id,
    v_user_id,
    v_name,
    coalesce(p_header ->> 'description', ''),
    v_opportunity_id,
    v_project_type,
    v_kind,
    v_region,
    v_region_multiplier,
    coalesce(nullif(p_header ->> 'overhead_pct', '')::integer, v_defaults.overhead_pct, 1000),
    coalesce(nullif(p_header ->> 'profit_pct', '')::integer, v_defaults.profit_pct, 1000),
    coalesce(nullif(p_header ->> 'contingency_pct', '')::integer, v_defaults.contingency_pct, 500),
    coalesce(nullif(p_header ->> 'bond_pct', '')::integer, v_defaults.bond_pct, 150),
    coalesce(nullif(p_header ->> 'tax_pct', '')::integer, v_defaults.tax_pct, 0),
    coalesce(nullif(p_header ->> 'general_conditions_pct', '')::integer, v_defaults.general_conditions_pct, 0),
    v_custom_markups,
    'draft'
  ) returning * into v_estimate;

  v_lines := public.insert_estimate_lines_authoritative(v_estimate.id, coalesce(p_initial_lines, '[]'::jsonb));
  v_totals := public.recalculate_estimate_totals_from_lines(v_estimate.id);
  select estimate.* into strict v_estimate from public.estimates estimate where estimate.id = v_estimate.id;

  v_result := jsonb_build_object(
    'ok', true,
    'id', v_estimate.id,
    'estimate', to_jsonb(v_estimate),
    'line_items', v_lines,
    'totals', v_totals,
    'deduplicated', false
  );
  insert into public.estimate_create_operations (
    organization_id, estimate_id, operation_key, request_fingerprint,
    result, changed_by
  ) values (
    p_organization_id, v_estimate.id, p_operation_key, v_fingerprint,
    v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.create_estimate_line_items_atomic(
  p_estimate_id uuid,
  p_lines jsonb,
  p_operation_key text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_existing public.estimate_line_operations%rowtype;
  v_fingerprint text;
  v_lines jsonb;
  v_totals jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to add estimate lines.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid line-create operation key is required.';
  end if;
  if jsonb_typeof(p_lines) is distinct from 'array'
     or jsonb_array_length(p_lines) not between 1 and 500
  then
    raise exception using errcode = '22023', message = 'Add between 1 and 500 estimate lines.';
  end if;

  select estimate.* into v_estimate
  from public.estimates estimate
  where estimate.id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate financial content is immutable. Clone the estimate to create a revision.';
  end if;

  v_fingerprint := md5(jsonb_build_array(p_estimate_id, p_lines)::text);
  select operation.* into v_existing
  from public.estimate_line_operations operation
  where operation.estimate_id = p_estimate_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.operation_type <> 'line_create'
       or v_existing.request_fingerprint <> v_fingerprint
    then
      raise exception using errcode = '22023', message = 'This line-create operation key was already used for different rows.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  v_lines := public.insert_estimate_lines_authoritative(p_estimate_id, p_lines);
  v_totals := public.recalculate_estimate_totals_from_lines(p_estimate_id);
  v_result := jsonb_build_object(
    'ok', true,
    'estimateId', p_estimate_id,
    'line_items', v_lines,
    'created_count', jsonb_array_length(v_lines),
    'totals', v_totals,
    'deduplicated', false
  );
  insert into public.estimate_line_operations (
    estimate_id, line_item_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, null, p_operation_key, 'line_create',
    v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

revoke all on function public.create_estimate_atomic(uuid, jsonb, jsonb, text)
from public, anon, authenticated, service_role;
revoke all on function public.create_estimate_line_items_atomic(uuid, jsonb, text)
from public, anon, authenticated, service_role;

grant execute on function public.create_estimate_atomic(uuid, jsonb, jsonb, text)
to authenticated;
grant execute on function public.create_estimate_line_items_atomic(uuid, jsonb, text)
to authenticated;

revoke insert on table public.estimates from authenticated, service_role;
revoke insert on table public.estimate_line_items from authenticated, service_role;

notify pgrst, 'reload schema';
