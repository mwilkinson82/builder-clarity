-- Plan Room measurement authority.
--
-- A takeoff and the estimate quantity it drives are one accounting command.
-- Geometry is recalculated from normalized points against the authoritative
-- sheet dimensions/scale in Postgres; the browser never supplies the trusted
-- quantity. Deliberate unit, scale, or hand-entered-quantity conflicts remain
-- visible draft review states, but cannot pass estimate finalization.

alter table public.estimate_takeoff_measurements
  add column if not exists version integer not null default 1;

alter table public.estimate_takeoff_measurements
  drop constraint if exists estimate_takeoff_measurements_version_positive,
  drop constraint if exists estimate_takeoff_measurements_waste_supported;

alter table public.estimate_takeoff_measurements
  add constraint estimate_takeoff_measurements_version_positive check (version >= 1),
  add constraint estimate_takeoff_measurements_waste_supported check (waste_pct between 0 and 1000);

create table if not exists public.estimate_takeoff_operations (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  measurement_id uuid,
  operation_key text not null,
  operation_type text not null check (
    operation_type in (
      'measurement_create', 'measurement_update', 'measurement_delete',
      'sheet_recalculate', 'group_link', 'line_create', 'line_sync'
    )
  ),
  request_fingerprint text not null,
  result jsonb not null,
  changed_by uuid not null,
  created_at timestamptz not null default now(),
  constraint estimate_takeoff_operations_key_length check (
    length(btrim(operation_key)) between 1 and 200
  )
);

create unique index if not exists estimate_takeoff_operations_actor_key_unique
  on public.estimate_takeoff_operations(changed_by, operation_key);
create index if not exists estimate_takeoff_operations_estimate_created_idx
  on public.estimate_takeoff_operations(estimate_id, created_at desc);

alter table public.estimate_takeoff_operations enable row level security;
revoke all on table public.estimate_takeoff_operations from public, anon, authenticated, service_role;
grant select on table public.estimate_takeoff_operations to authenticated;

drop policy if exists estimate_takeoff_operations_team_select
  on public.estimate_takeoff_operations;
create policy estimate_takeoff_operations_team_select
  on public.estimate_takeoff_operations
  for select to authenticated
  using (public.can_read_estimate(estimate_id));

drop trigger if exists estimate_takeoff_operations_immutable
  on public.estimate_takeoff_operations;
create trigger estimate_takeoff_operations_immutable
  before update or delete on public.estimate_takeoff_operations
  for each row execute function public.reject_financial_journal_mutation();

create or replace function public.takeoff_unit_family(p_unit text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case upper(regexp_replace(replace(coalesce(p_unit, ''), '.', ''), '\s+', ' ', 'g'))
    when 'LF' then 'LF' when 'LNFT' then 'LF' when 'LIN FT' then 'LF'
    when 'LINFT' then 'LF' when 'LINEAR FEET' then 'LF' when 'LINEAR FT' then 'LF'
    when 'FT' then 'LF' when 'FEET' then 'LF' when 'FOOT' then 'LF'
    when 'SF' then 'SF' when 'SQFT' then 'SF' when 'SQ FT' then 'SF'
    when 'SQF' then 'SF' when 'SQUARE FEET' then 'SF' when 'SQUARE FOOT' then 'SF'
    when 'SY' then 'SY' when 'SQYD' then 'SY' when 'SQ YD' then 'SY'
    when 'SQUARE YARD' then 'SY' when 'SQUARE YARDS' then 'SY'
    when 'EA' then 'EA' when 'EACH' then 'EA' when 'CT' then 'EA'
    when 'COUNT' then 'EA'
    else upper(btrim(coalesce(p_unit, '')))
  end;
$$;

create or replace function public.calculate_estimate_takeoff_geometry(
  p_tool_type text,
  p_unit text,
  p_geometry jsonb,
  p_sheet public.estimate_plan_sheets
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_points jsonb := coalesce(p_geometry -> 'points', '[]'::jsonb);
  v_count integer;
  v_index integer;
  v_x numeric;
  v_y numeric;
  v_prev_x numeric;
  v_prev_y numeric;
  v_first_x numeric;
  v_first_y numeric;
  v_pixels numeric := 0;
  v_signed_double_area numeric := 0;
  v_quantity numeric;
  v_family text := public.takeoff_unit_family(p_unit);
  v_status text;
  v_method text;
  v_scale_revision integer;
begin
  if p_tool_type not in ('linear', 'area', 'count') then
    raise exception using errcode = '22023', message = 'Choose a supported takeoff tool.';
  end if;
  if jsonb_typeof(v_points) is distinct from 'array' then
    raise exception using errcode = '22023', message = 'Takeoff geometry must contain a points array.';
  end if;
  v_count := jsonb_array_length(v_points);
  if (p_tool_type = 'count' and v_count < 1)
     or (p_tool_type = 'linear' and v_count < 2)
     or (p_tool_type = 'area' and v_count < 3)
  then
    raise exception using errcode = '22023', message = case p_tool_type
      when 'count' then 'A count takeoff requires at least one marker.'
      when 'linear' then 'A linear takeoff requires at least two points.'
      else 'An area takeoff requires at least three points.' end;
  end if;
  if (p_tool_type = 'count' and v_family <> 'EA')
     or (p_tool_type = 'linear' and v_family <> 'LF')
     or (p_tool_type = 'area' and v_family not in ('SF', 'SY'))
  then
    raise exception using errcode = '22023', message = 'The takeoff unit does not match its measurement tool.';
  end if;

  for v_index in 0..v_count - 1 loop
    begin
      v_x := (v_points -> v_index ->> 'x')::numeric;
      v_y := (v_points -> v_index ->> 'y')::numeric;
    exception when others then
      raise exception using errcode = '22023', message = 'Every takeoff point needs numeric x and y coordinates.';
    end;
    if v_x is null or v_y is null or v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then
      raise exception using errcode = '22023', message = 'Takeoff points must stay inside the normalized drawing bounds.';
    end if;
    if v_index = 0 then
      v_first_x := v_x;
      v_first_y := v_y;
    else
      if p_tool_type = 'linear' then
        v_pixels := v_pixels + sqrt(
          power((v_x - v_prev_x) * p_sheet.width_px, 2)
          + power((v_y - v_prev_y) * p_sheet.height_px, 2)
        );
      elsif p_tool_type = 'area' then
        v_signed_double_area := v_signed_double_area
          + (v_prev_x * p_sheet.width_px * v_y * p_sheet.height_px)
          - (v_x * p_sheet.width_px * v_prev_y * p_sheet.height_px);
      end if;
    end if;
    v_prev_x := v_x;
    v_prev_y := v_y;
  end loop;

  if p_tool_type = 'count' then
    v_quantity := v_count;
    v_method := 'count';
    v_status := 'current';
    v_scale_revision := null;
  else
    if p_sheet.scale_feet_per_pixel <= 0 or p_sheet.width_px <= 0 or p_sheet.height_px <= 0 then
      raise exception using errcode = '22023', message = 'Set a valid sheet scale and drawing size before measuring.';
    end if;
    if p_tool_type = 'area' then
      v_signed_double_area := v_signed_double_area
        + (v_prev_x * p_sheet.width_px * v_first_y * p_sheet.height_px)
        - (v_first_x * p_sheet.width_px * v_prev_y * p_sheet.height_px);
      v_pixels := abs(v_signed_double_area) / 2;
      v_quantity := v_pixels * p_sheet.scale_feet_per_pixel * p_sheet.scale_feet_per_pixel;
      if v_family = 'SY' then v_quantity := v_quantity / 9; end if;
    else
      v_quantity := v_pixels * p_sheet.scale_feet_per_pixel;
    end if;
    v_quantity := round(v_quantity, 4);
    if v_quantity <= 0 then
      raise exception using errcode = '22023', message = 'The takeoff geometry does not produce a measurable quantity.';
    end if;
    v_method := 'geometry';
    v_status := case when p_sheet.scale_verified_at is null then 'unverified_scale' else 'current' end;
    v_scale_revision := p_sheet.scale_revision;
  end if;

  return jsonb_build_object(
    'quantity', v_quantity,
    'calculation_method', v_method,
    'calculation_status', v_status,
    'calculation_scale_revision', v_scale_revision,
    'calculation_context', jsonb_build_object(
      'algorithm', 'normalized-geometry-postgres-v1',
      'point_count', v_count,
      'view_size', jsonb_build_object('width', p_sheet.width_px, 'height', p_sheet.height_px),
      'view_size_source', 'sheet',
      'scale_feet_per_pixel', case when p_tool_type = 'count' then null else p_sheet.scale_feet_per_pixel end,
      'scale_revision', v_scale_revision,
      'unit_family', v_family
    )
  );
end;
$$;

create or replace function public.link_estimate_takeoff_group_atomic(
  p_estimate_id uuid,
  p_measurement_ids uuid[],
  p_expected_versions integer[],
  p_line_item_id uuid,
  p_operation_key text,
  p_force_manual boolean default false,
  p_force_unit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_line public.estimate_line_items%rowtype;
  v_existing public.estimate_takeoff_operations%rowtype;
  -- plpgsql's FOR-over-query target list is scalar-only once a row/record
  -- variable leads it, so the measurement row and its requested version travel
  -- together in one record variable.
  v_measurement_row record;
  v_fingerprint text;
  v_old_line_ids uuid[] := '{}'::uuid[];
  v_line_id uuid;
  v_syncs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to link takeoffs.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid group-link operation key is required.';
  end if;
  if coalesce(cardinality(p_measurement_ids), 0) = 0
     or cardinality(p_measurement_ids) <> cardinality(p_expected_versions)
     or (select count(*) <> count(distinct item.id) from unnest(p_measurement_ids) item(id))
  then
    raise exception using errcode = '22023', message = 'Link each unique takeoff with its expected version.';
  end if;
  select estimate.* into v_estimate from public.estimates estimate
  where estimate.id = p_estimate_id for update;
  if not found or not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to link this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate takeoffs are immutable.';
  end if;
  v_fingerprint := md5(jsonb_build_array(
    p_estimate_id, to_jsonb(p_measurement_ids), to_jsonb(p_expected_versions),
    p_line_item_id, coalesce(p_force_manual, false), coalesce(p_force_unit, false)
  )::text);
  select operation.* into v_existing from public.estimate_takeoff_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This group-link key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  if p_line_item_id is not null then
    select line.* into v_line from public.estimate_line_items line
    where line.id = p_line_item_id and line.estimate_id = p_estimate_id for update;
    if not found then
      raise exception using errcode = '23503', message = 'The target line belongs to another estimate.';
    end if;
  end if;

  for v_measurement_row in
    select measurement.*, requested.expected_version as requested_expected_version
    from unnest(p_measurement_ids, p_expected_versions) requested(id, expected_version)
    join public.estimate_takeoff_measurements measurement on measurement.id = requested.id
    order by measurement.id
    for update of measurement
  loop
    if v_measurement_row.estimate_id <> p_estimate_id then
      raise exception using errcode = '23503', message = 'Every linked takeoff must belong to this estimate.';
    end if;
    if v_measurement_row.version <> v_measurement_row.requested_expected_version then
      raise exception using errcode = '40001', message = 'A takeoff in this group changed. Refresh and try again.';
    end if;
    if v_measurement_row.estimate_line_item_id is not null then
      v_old_line_ids := array_append(v_old_line_ids, v_measurement_row.estimate_line_item_id);
    end if;
  end loop;
  if (select count(*) from public.estimate_takeoff_measurements measurement
      where measurement.id = any(p_measurement_ids)) <> cardinality(p_measurement_ids) then
    raise exception using errcode = 'P0002', message = 'One or more takeoffs were not found.';
  end if;

  update public.estimate_takeoff_measurements measurement set
    estimate_line_item_id = p_line_item_id,
    library_item_id = case when p_line_item_id is null then null else v_line.library_item_id end
  where measurement.id = any(p_measurement_ids)
    and measurement.estimate_id = p_estimate_id;

  for v_line_id in
    select distinct linked_id from unnest(v_old_line_ids || array[p_line_item_id]) linked(linked_id)
    where linked_id is not null order by linked_id
  loop
    v_syncs := v_syncs || jsonb_build_array(
      public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_line_id, p_force_manual, p_force_unit
      )
    );
  end loop;
  v_result := jsonb_build_object(
    'ok', true, 'measurement_ids', to_jsonb(p_measurement_ids),
    'line_item_id', p_line_item_id,
    'measurements', (select coalesce(jsonb_agg(to_jsonb(measurement) order by measurement.id), '[]'::jsonb)
      from public.estimate_takeoff_measurements measurement where measurement.id = any(p_measurement_ids)),
    'syncs', v_syncs, 'sync', case when jsonb_array_length(v_syncs) > 0 then v_syncs -> -1 else null end,
    'deduplicated', false
  );
  insert into public.estimate_takeoff_operations (
    estimate_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, p_operation_key, 'group_link', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.recalculate_estimate_takeoff_sheet_atomic(
  p_estimate_id uuid,
  p_plan_sheet_id uuid,
  p_expected_scale_revision integer,
  p_operation_key text,
  p_force_manual boolean default false,
  p_force_unit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_sheet public.estimate_plan_sheets%rowtype;
  v_measurement public.estimate_takeoff_measurements%rowtype;
  v_existing public.estimate_takeoff_operations%rowtype;
  v_calc jsonb;
  v_fingerprint text;
  v_line_ids uuid[] := '{}'::uuid[];
  v_line_id uuid;
  v_skipped uuid[] := '{}'::uuid[];
  v_syncs jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to recalculate takeoffs.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200
     or p_expected_scale_revision is null then
    raise exception using errcode = '22023', message = 'A valid recalculation key and expected scale revision are required.';
  end if;
  select estimate.* into v_estimate from public.estimates estimate
  where estimate.id = p_estimate_id for update;
  if not found or not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to recalculate this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate takeoffs are immutable.';
  end if;
  v_fingerprint := md5(jsonb_build_array(
    p_estimate_id, p_plan_sheet_id, p_expected_scale_revision,
    coalesce(p_force_manual, false), coalesce(p_force_unit, false)
  )::text);
  select operation.* into v_existing from public.estimate_takeoff_operations operation
  where operation.changed_by = v_user_id and operation.operation_key = p_operation_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This recalculation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;
  select sheet.* into v_sheet from public.estimate_plan_sheets sheet
  where sheet.id = p_plan_sheet_id and sheet.estimate_id = p_estimate_id for update;
  if not found then
    raise exception using errcode = '23503', message = 'The takeoff sheet belongs to another estimate.';
  end if;
  if v_sheet.scale_revision <> p_expected_scale_revision then
    raise exception using errcode = '40001', message = 'The sheet scale changed. Refresh before recalculating takeoffs.';
  end if;

  for v_measurement in
    select measurement.* from public.estimate_takeoff_measurements measurement
    where measurement.estimate_id = p_estimate_id
      and measurement.plan_sheet_id = p_plan_sheet_id
    order by measurement.id for update
  loop
    if v_measurement.calculation_method = 'manual_override' then
      v_skipped := array_append(v_skipped, v_measurement.id);
      continue;
    end if;
    v_calc := public.calculate_estimate_takeoff_geometry(
      v_measurement.tool_type, v_measurement.unit, v_measurement.geometry, v_sheet
    );
    update public.estimate_takeoff_measurements measurement set
      quantity = (v_calc ->> 'quantity')::numeric,
      calculation_method = v_calc ->> 'calculation_method',
      calculation_status = v_calc ->> 'calculation_status',
      calculated_quantity = (v_calc ->> 'quantity')::numeric,
      calculation_scale_revision = (v_calc ->> 'calculation_scale_revision')::integer,
      calculated_at = now(),
      calculation_context = v_calc -> 'calculation_context',
      override_reason = ''
    where measurement.id = v_measurement.id;
    if v_measurement.estimate_line_item_id is not null then
      v_line_ids := array_append(v_line_ids, v_measurement.estimate_line_item_id);
    end if;
  end loop;
  for v_line_id in select distinct id from unnest(v_line_ids) linked(id) order by id loop
    v_syncs := v_syncs || jsonb_build_array(
      public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_line_id, p_force_manual, p_force_unit
      )
    );
  end loop;
  v_result := jsonb_build_object(
    'ok', true,
    'measurements', (select coalesce(jsonb_agg(to_jsonb(measurement) order by measurement.id), '[]'::jsonb)
      from public.estimate_takeoff_measurements measurement
      where measurement.estimate_id = p_estimate_id and measurement.plan_sheet_id = p_plan_sheet_id
        and measurement.id <> all(v_skipped)),
    'skipped_manual_overrides', to_jsonb(v_skipped),
    'syncs', v_syncs, 'deduplicated', false
  );
  insert into public.estimate_takeoff_operations (
    estimate_id, operation_key, operation_type, request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, p_operation_key, 'sheet_recalculate', v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.mutate_estimate_takeoff_measurement_atomic(
  p_estimate_id uuid,
  p_measurement_id uuid,
  p_expected_version integer,
  p_action text,
  p_patch jsonb,
  p_recalculate_from_geometry boolean,
  p_operation_key text,
  p_force_manual boolean default false,
  p_force_unit boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_estimate public.estimates%rowtype;
  v_sheet public.estimate_plan_sheets%rowtype;
  v_before public.estimate_takeoff_measurements%rowtype;
  v_after public.estimate_takeoff_measurements%rowtype;
  v_existing public.estimate_takeoff_operations%rowtype;
  v_fingerprint text;
  v_operation_type text;
  v_calc jsonb;
  v_tool text;
  v_unit text;
  v_geometry jsonb;
  v_override_reason text;
  v_previous_line_id uuid;
  v_next_line_id uuid;
  v_syncs jsonb := '[]'::jsonb;
  v_sync jsonb;
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication is required to edit a takeoff.';
  end if;
  if nullif(btrim(p_operation_key), '') is null or length(p_operation_key) > 200 then
    raise exception using errcode = '22023', message = 'A valid takeoff operation key is required.';
  end if;
  if p_action not in ('create', 'update', 'delete') then
    raise exception using errcode = '22023', message = 'Choose a supported takeoff command.';
  end if;
  if jsonb_typeof(coalesce(p_patch, '{}'::jsonb)) is distinct from 'object'
     or exists (
       select 1 from jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) key
       where key not in (
         'plan_sheet_id', 'estimate_line_item_id', 'library_item_id',
         'tool_type', 'label', 'unit', 'quantity', 'waste_pct', 'color',
         'geometry', 'notes', 'override_reason', 'created_by_ai',
         'ai_operation_id', 'ai_proposal_source', 'ai_confidence',
         'ai_original_geometry', 'ai_review_action', 'scope_brief_review_id'
       )
     )
  then
    raise exception using errcode = '22023', message = 'The takeoff request contains unsupported fields.';
  end if;
  if p_action = 'create' and (
       p_measurement_id is not null or p_expected_version is not null
       or not (coalesce(p_patch, '{}'::jsonb) ?& array[
         'plan_sheet_id', 'tool_type', 'label', 'unit', 'geometry'
       ])
     )
  then
    raise exception using errcode = '22023', message = 'A new takeoff needs one sheet, tool, label, unit, and geometry.';
  end if;
  if p_action in ('update', 'delete') and (
       p_measurement_id is null or p_expected_version is null
     )
  then
    raise exception using errcode = '22023', message = 'The expected takeoff version is required.';
  end if;
  if p_action = 'update' and coalesce(p_patch, '{}'::jsonb) = '{}'::jsonb
     and not p_recalculate_from_geometry then
    raise exception using errcode = '22023', message = 'No takeoff changes were provided.';
  end if;

  select estimate.* into v_estimate from public.estimates estimate
  where estimate.id = p_estimate_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate not found.';
  end if;
  if not public.can_manage_estimate(p_estimate_id) then
    raise exception using errcode = '42501', message = 'You do not have permission to edit this estimate.';
  end if;
  if v_estimate.status = 'final' or v_estimate.project_id is not null then
    raise exception using errcode = '55000', message = 'Final or converted estimate takeoffs are immutable. Clone the estimate to create a revision.';
  end if;

  v_fingerprint := md5(jsonb_build_array(
    p_estimate_id, p_measurement_id, p_expected_version, p_action,
    coalesce(p_patch, '{}'::jsonb), coalesce(p_recalculate_from_geometry, false),
    coalesce(p_force_manual, false), coalesce(p_force_unit, false)
  )::text);
  select operation.* into v_existing
  from public.estimate_takeoff_operations operation
  where operation.changed_by = v_user_id
    and operation.operation_key = p_operation_key;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      raise exception using errcode = '22023', message = 'This takeoff operation key was already used for different changes.';
    end if;
    return v_existing.result || jsonb_build_object('deduplicated', true);
  end if;

  if p_action in ('update', 'delete') then
    select measurement.* into v_before
    from public.estimate_takeoff_measurements measurement
    where measurement.id = p_measurement_id
      and measurement.estimate_id = p_estimate_id
    for update;
    if not found then
      raise exception using errcode = 'P0002', message = 'Takeoff not found in the expected estimate.';
    end if;
    if v_before.version <> p_expected_version then
      raise exception using errcode = '40001', message = 'The takeoff changed before this edit committed. Refresh and try again.';
    end if;
    v_previous_line_id := v_before.estimate_line_item_id;
  end if;

  if p_action = 'delete' then
    delete from public.estimate_takeoff_measurements measurement
    where measurement.id = p_measurement_id;
    if v_previous_line_id is not null then
      v_sync := public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_previous_line_id, p_force_manual, p_force_unit
      );
      v_syncs := v_syncs || jsonb_build_array(v_sync);
    end if;
    v_result := jsonb_build_object(
      'ok', true, 'measurement_id', p_measurement_id,
      'measurement', null, 'syncs', v_syncs, 'deduplicated', false
    );
    v_operation_type := 'measurement_delete';
  elsif p_action = 'create' then
    select sheet.* into v_sheet from public.estimate_plan_sheets sheet
    where sheet.id = (p_patch ->> 'plan_sheet_id')::uuid
      and sheet.estimate_id = p_estimate_id
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'The takeoff sheet belongs to another estimate.';
    end if;
    v_tool := p_patch ->> 'tool_type';
    v_unit := upper(left(btrim(p_patch ->> 'unit'), 16));
    v_geometry := p_patch -> 'geometry';
    v_calc := public.calculate_estimate_takeoff_geometry(v_tool, v_unit, v_geometry, v_sheet);
    if nullif(btrim(p_patch ->> 'label'), '') is null then
      raise exception using errcode = '22023', message = 'A takeoff label is required.';
    end if;
    if coalesce((p_patch ->> 'waste_pct')::integer, 0) not between 0 and 1000 then
      raise exception using errcode = '22023', message = 'Takeoff waste must be between 0% and 1000%.';
    end if;

    insert into public.estimate_takeoff_measurements (
      estimate_id, plan_sheet_id, estimate_line_item_id, library_item_id, created_by,
      tool_type, label, unit, quantity, waste_pct, color, geometry, notes,
      created_by_ai, calculation_method, calculation_status, calculated_quantity,
      calculation_scale_revision, calculated_at, calculation_context, override_reason,
      ai_operation_id, ai_proposal_source, ai_confidence, ai_original_geometry,
      ai_review_action, ai_reviewed_by, ai_reviewed_at, scope_brief_review_id
    ) values (
      p_estimate_id,
      (p_patch ->> 'plan_sheet_id')::uuid,
      case when p_patch -> 'estimate_line_item_id' = 'null'::jsonb then null
        else (p_patch ->> 'estimate_line_item_id')::uuid end,
      case when p_patch -> 'library_item_id' = 'null'::jsonb then null
        else (p_patch ->> 'library_item_id')::uuid end,
      v_user_id,
      v_tool,
      left(btrim(p_patch ->> 'label'), 240),
      v_unit,
      (v_calc ->> 'quantity')::numeric,
      coalesce((p_patch ->> 'waste_pct')::integer, 0),
      coalesce(nullif(left(btrim(p_patch ->> 'color'), 40), ''), '#1b7a6e'),
      v_geometry,
      left(coalesce(p_patch ->> 'notes', ''), 2000),
      coalesce((p_patch ->> 'created_by_ai')::boolean, false),
      v_calc ->> 'calculation_method',
      v_calc ->> 'calculation_status',
      (v_calc ->> 'quantity')::numeric,
      (v_calc ->> 'calculation_scale_revision')::integer,
      now(),
      v_calc -> 'calculation_context',
      '',
      case when p_patch -> 'ai_operation_id' = 'null'::jsonb then null
        else (p_patch ->> 'ai_operation_id')::uuid end,
      nullif(left(p_patch ->> 'ai_proposal_source', 32), ''),
      (p_patch ->> 'ai_confidence')::numeric,
      p_patch -> 'ai_original_geometry',
      nullif(p_patch ->> 'ai_review_action', ''),
      case when coalesce((p_patch ->> 'created_by_ai')::boolean, false) then v_user_id else null end,
      case when coalesce((p_patch ->> 'created_by_ai')::boolean, false) then now() else null end,
      case when p_patch -> 'scope_brief_review_id' = 'null'::jsonb then null
        else (p_patch ->> 'scope_brief_review_id')::uuid end
    ) returning * into v_after;
    v_next_line_id := v_after.estimate_line_item_id;
    if v_next_line_id is not null then
      v_sync := public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_next_line_id, p_force_manual, p_force_unit
      );
      v_syncs := v_syncs || jsonb_build_array(v_sync);
    end if;
    v_result := jsonb_build_object(
      'ok', true, 'measurement_id', v_after.id,
      'measurement', to_jsonb(v_after), 'syncs', v_syncs,
      'sync', case when jsonb_array_length(v_syncs) > 0 then v_syncs -> -1 else null end,
      'deduplicated', false
    );
    v_operation_type := 'measurement_create';
  else
    v_tool := case when p_patch ? 'tool_type' then p_patch ->> 'tool_type' else v_before.tool_type end;
    v_unit := case when p_patch ? 'unit' then upper(left(btrim(p_patch ->> 'unit'), 16)) else v_before.unit end;
    v_geometry := case when p_patch ? 'geometry' then p_patch -> 'geometry' else v_before.geometry end;
    select sheet.* into strict v_sheet from public.estimate_plan_sheets sheet
    where sheet.id = v_before.plan_sheet_id and sheet.estimate_id = p_estimate_id
    for share;
    if p_patch ? 'waste_pct' and (p_patch ->> 'waste_pct')::integer not between 0 and 1000 then
      raise exception using errcode = '22023', message = 'Takeoff waste must be between 0% and 1000%.';
    end if;
    if p_patch ? 'label' and nullif(btrim(p_patch ->> 'label'), '') is null then
      raise exception using errcode = '22023', message = 'A takeoff label is required.';
    end if;

    if p_recalculate_from_geometry
       or p_patch ? 'geometry' or p_patch ? 'tool_type' or p_patch ? 'unit' then
      v_calc := public.calculate_estimate_takeoff_geometry(v_tool, v_unit, v_geometry, v_sheet);
    elsif p_patch ? 'quantity'
       and (p_patch ->> 'quantity')::numeric is distinct from v_before.quantity then
      if (p_patch ->> 'quantity')::numeric < 0
         or (p_patch ->> 'quantity')::numeric * 10000 <> trunc((p_patch ->> 'quantity')::numeric * 10000) then
        raise exception using errcode = '22003', message = 'Manual takeoff quantities must be nonnegative and exact to four decimals.';
      end if;
      v_override_reason := btrim(coalesce(p_patch ->> 'override_reason', ''));
      if length(v_override_reason) < 3 then
        raise exception using errcode = '22023', message = 'Explain why this takeoff quantity is being manually overridden.';
      end if;
      v_calc := public.calculate_estimate_takeoff_geometry(v_tool, v_unit, v_geometry, v_sheet)
        || jsonb_build_object(
          'quantity', (p_patch ->> 'quantity')::numeric,
          'calculation_method', 'manual_override',
          'calculation_status', 'current',
          'override_reason', v_override_reason
        );
    else
      v_calc := null;
    end if;

    update public.estimate_takeoff_measurements measurement set
      estimate_line_item_id = case
        when p_patch -> 'estimate_line_item_id' = 'null'::jsonb then null
        when p_patch ? 'estimate_line_item_id' then (p_patch ->> 'estimate_line_item_id')::uuid
        else measurement.estimate_line_item_id end,
      library_item_id = case
        when p_patch -> 'library_item_id' = 'null'::jsonb then null
        when p_patch ? 'library_item_id' then (p_patch ->> 'library_item_id')::uuid
        else measurement.library_item_id end,
      tool_type = v_tool,
      label = case when p_patch ? 'label' then left(btrim(p_patch ->> 'label'), 240) else measurement.label end,
      unit = v_unit,
      quantity = case when v_calc is not null then (v_calc ->> 'quantity')::numeric else measurement.quantity end,
      waste_pct = case when p_patch ? 'waste_pct' then (p_patch ->> 'waste_pct')::integer else measurement.waste_pct end,
      color = case when p_patch ? 'color' then coalesce(nullif(left(btrim(p_patch ->> 'color'), 40), ''), '#1b7a6e') else measurement.color end,
      geometry = v_geometry,
      notes = case when p_patch ? 'notes' then left(p_patch ->> 'notes', 2000) else measurement.notes end,
      calculation_method = case when v_calc is not null then v_calc ->> 'calculation_method' else measurement.calculation_method end,
      calculation_status = case when v_calc is not null then v_calc ->> 'calculation_status' else measurement.calculation_status end,
      calculated_quantity = case when v_calc is not null
        then coalesce((v_calc ->> 'calculated_quantity')::numeric, (v_calc ->> 'quantity')::numeric)
        else measurement.calculated_quantity end,
      calculation_scale_revision = case when v_calc is not null
        then (v_calc ->> 'calculation_scale_revision')::integer
        else measurement.calculation_scale_revision end,
      calculated_at = case when v_calc is not null then now() else measurement.calculated_at end,
      calculation_context = case when v_calc is not null then v_calc -> 'calculation_context' else measurement.calculation_context end,
      override_reason = case when v_calc is not null
        then coalesce(v_calc ->> 'override_reason', '')
        when measurement.calculation_method = 'manual_override' and p_patch ? 'override_reason'
          then btrim(p_patch ->> 'override_reason')
        else measurement.override_reason end,
      ai_operation_id = case
        when p_patch -> 'ai_operation_id' = 'null'::jsonb then null
        when p_patch ? 'ai_operation_id' then (p_patch ->> 'ai_operation_id')::uuid
        else measurement.ai_operation_id end,
      ai_proposal_source = case when p_patch ? 'ai_proposal_source'
        then nullif(left(p_patch ->> 'ai_proposal_source', 32), '') else measurement.ai_proposal_source end,
      ai_confidence = case when p_patch ? 'ai_confidence'
        then (p_patch ->> 'ai_confidence')::numeric else measurement.ai_confidence end,
      ai_original_geometry = case when p_patch ? 'ai_original_geometry'
        then p_patch -> 'ai_original_geometry' else measurement.ai_original_geometry end,
      ai_review_action = case when p_patch ? 'ai_review_action'
        then nullif(p_patch ->> 'ai_review_action', '') else measurement.ai_review_action end,
      ai_reviewed_by = case when measurement.created_by_ai and (
        p_patch ? 'geometry' or p_patch ? 'ai_operation_id' or p_patch ? 'ai_confidence'
        or p_patch ? 'ai_review_action'
      ) then v_user_id else measurement.ai_reviewed_by end,
      ai_reviewed_at = case when measurement.created_by_ai and (
        p_patch ? 'geometry' or p_patch ? 'ai_operation_id' or p_patch ? 'ai_confidence'
        or p_patch ? 'ai_review_action'
      ) then now() else measurement.ai_reviewed_at end
    where measurement.id = p_measurement_id
    returning * into v_after;
    v_next_line_id := v_after.estimate_line_item_id;
    if v_previous_line_id is not null and v_previous_line_id is distinct from v_next_line_id then
      v_sync := public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_previous_line_id, p_force_manual, p_force_unit
      );
      v_syncs := v_syncs || jsonb_build_array(v_sync);
    end if;
    if v_next_line_id is not null then
      v_sync := public.apply_estimate_takeoff_line_rollup_internal(
        p_estimate_id, v_next_line_id, p_force_manual, p_force_unit
      );
      v_syncs := v_syncs || jsonb_build_array(v_sync);
    end if;
    v_result := jsonb_build_object(
      'ok', true, 'measurement_id', v_after.id,
      'measurement', to_jsonb(v_after), 'syncs', v_syncs,
      'sync', case when jsonb_array_length(v_syncs) > 0 then v_syncs -> -1 else null end,
      'deduplicated', false
    );
    v_operation_type := 'measurement_update';
  end if;

  insert into public.estimate_takeoff_operations (
    estimate_id, measurement_id, operation_key, operation_type,
    request_fingerprint, result, changed_by
  ) values (
    p_estimate_id, coalesce(v_after.id, p_measurement_id), p_operation_key,
    v_operation_type, v_fingerprint, v_result, v_user_id
  );
  return v_result;
end;
$$;

create or replace function public.tg_validate_estimate_takeoff_measurement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_estimate public.estimates%rowtype;
  v_sheet public.estimate_plan_sheets%rowtype;
  v_line public.estimate_line_items%rowtype;
  v_library public.cost_library_items%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.estimate_id is distinct from old.estimate_id
       or new.plan_sheet_id is distinct from old.plan_sheet_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at
       or new.scope_brief_review_id is distinct from old.scope_brief_review_id
    then
      raise exception using errcode = '22023', message = 'Takeoff ownership and source provenance are immutable.';
    end if;
    new.version := old.version + 1;
  end if;
  select estimate.* into strict v_estimate
  from public.estimates estimate where estimate.id = new.estimate_id;
  select sheet.* into strict v_sheet
  from public.estimate_plan_sheets sheet where sheet.id = new.plan_sheet_id;
  if v_sheet.estimate_id <> new.estimate_id then
    raise exception using errcode = '23503', message = 'The takeoff sheet belongs to another estimate.';
  end if;
  if new.estimate_line_item_id is not null then
    select line.* into v_line from public.estimate_line_items line
    where line.id = new.estimate_line_item_id;
    if not found or v_line.estimate_id <> new.estimate_id then
      raise exception using errcode = '23503', message = 'The takeoff line belongs to another estimate.';
    end if;
  end if;
  if new.library_item_id is not null then
    select item.* into v_library from public.cost_library_items item
    where item.id = new.library_item_id;
    if not found or v_library.organization_id <> v_estimate.organization_id then
      raise exception using errcode = '23503', message = 'The takeoff library item belongs to another company.';
    end if;
    if new.estimate_line_item_id is not null
       and v_line.library_item_id is distinct from new.library_item_id then
      raise exception using errcode = '23503', message = 'The takeoff and linked estimate line cite different library items.';
    end if;
  end if;
  if new.quantity < 0 or new.quantity * 10000 <> trunc(new.quantity * 10000)
     or (new.calculated_quantity is not null and (
       new.calculated_quantity < 0
       or new.calculated_quantity * 10000 <> trunc(new.calculated_quantity * 10000)
     ))
  then
    raise exception using errcode = '22003', message = 'Takeoff quantities must be nonnegative and exact to four decimals.';
  end if;
  if new.calculation_method = 'manual_override'
     and length(btrim(coalesce(new.override_reason, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Explain every manual takeoff quantity override.';
  end if;
  return new;
end;
$$;

drop trigger if exists estimate_takeoff_measurements_command_integrity
  on public.estimate_takeoff_measurements;
create trigger estimate_takeoff_measurements_command_integrity
  before insert or update on public.estimate_takeoff_measurements
  for each row execute function public.tg_validate_estimate_takeoff_measurement();

-- Internal rollup. Callers lock the estimate first, which serializes every
-- takeoff command and makes the measurement set itself the concurrency token.
create or replace function public.apply_estimate_takeoff_line_rollup_internal(
  p_estimate_id uuid,
  p_line_item_id uuid,
  p_force_manual boolean default false,
  p_force_unit boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_line public.estimate_line_items%rowtype;
  v_quantity numeric(14,4) := 0;
  v_measurement_count integer := 0;
  v_untrusted jsonb := '[]'::jsonb;
  v_families text[] := '{}'::text[];
  v_takeoff_unit text;
  v_line_unit text;
  v_manual_differs boolean;
  v_after public.estimate_line_items%rowtype;
  v_totals jsonb;
begin
  select line.* into v_line from public.estimate_line_items line
  where line.id = p_line_item_id and line.estimate_id = p_estimate_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Estimate line not found.';
  end if;

  select
    count(*)::integer,
    coalesce(round(sum(round(measurement.quantity * (1 + measurement.waste_pct::numeric / 100), 4)), 4), 0),
    coalesce(jsonb_agg(
      jsonb_build_object('id', measurement.id, 'status', measurement.calculation_status)
    ) filter (where measurement.calculation_status <> 'current'), '[]'::jsonb),
    coalesce(array_agg(distinct public.takeoff_unit_family(measurement.unit)), '{}'::text[])
  into v_measurement_count, v_quantity, v_untrusted, v_families
  from public.estimate_takeoff_measurements measurement
  where measurement.estimate_id = p_estimate_id
    and measurement.estimate_line_item_id = p_line_item_id;

  v_takeoff_unit := case when cardinality(v_families) = 1 then v_families[1] else null end;
  v_line_unit := public.takeoff_unit_family(v_line.unit);
  if jsonb_array_length(v_untrusted) > 0 then
    return jsonb_build_object(
      'conflict', false, 'unit_conflict', false, 'calculation_conflict', true,
      'quantity', v_line.quantity, 'takeoff_quantity', null,
      'takeoff_unit', coalesce(v_takeoff_unit, ''), 'line_unit', v_line.unit,
      'measurement_count', v_measurement_count, 'blocked_measurements', v_untrusted
    );
  end if;
  if (cardinality(v_families) > 1 or (
        v_takeoff_unit is not null and v_takeoff_unit <> v_line_unit
      )) and not p_force_unit then
    return jsonb_build_object(
      'conflict', false, 'unit_conflict', true, 'calculation_conflict', false,
      'quantity', v_line.quantity, 'takeoff_quantity', v_quantity,
      'takeoff_unit', coalesce(v_takeoff_unit, array_to_string(v_families, '/'), ''),
      'line_unit', v_line.unit, 'measurement_count', v_measurement_count,
      'blocked_measurements', '[]'::jsonb
    );
  end if;

  v_manual_differs := case
    when v_line.takeoff_quantity is null then v_line.quantity > 0
    else v_line.quantity is distinct from v_line.takeoff_quantity end;
  if not p_force_manual
     and v_line.quantity_source = 'manual'
     and v_line.quantity is distinct from v_quantity
     and v_manual_differs then
    return jsonb_build_object(
      'conflict', true, 'unit_conflict', false, 'calculation_conflict', false,
      'quantity', v_line.quantity, 'takeoff_quantity', v_quantity,
      'takeoff_unit', coalesce(v_takeoff_unit, ''), 'line_unit', v_line.unit,
      'measurement_count', v_measurement_count, 'blocked_measurements', '[]'::jsonb
    );
  end if;

  perform set_config('overwatch.estimate_revision_write', 'on', true);
  update public.estimate_line_items line set
    quantity = v_quantity,
    quantity_source = 'takeoff',
    takeoff_quantity = v_quantity,
    takeoff_synced_at = now(),
    takeoff_unit = v_takeoff_unit
  where line.id = p_line_item_id and line.estimate_id = p_estimate_id
  returning line.* into v_after;
  v_totals := public.recalculate_estimate_totals_from_lines(p_estimate_id);
  return jsonb_build_object(
    'conflict', false, 'unit_conflict', false, 'calculation_conflict', false,
    'quantity', v_after.quantity, 'takeoff_quantity', v_after.takeoff_quantity,
    'takeoff_unit', coalesce(v_takeoff_unit, ''), 'line_unit', v_after.unit,
    'measurement_count', v_measurement_count, 'blocked_measurements', '[]'::jsonb,
    'line_item', to_jsonb(v_after), 'totals', v_totals
  );
end;
$$;

-- Function privilege hygiene (batch standard): the three takeoff commands are
-- the supported client surface; the geometry/unit helpers and the internal
-- rollup are implementation details no role may call directly. Raw
-- estimate_takeoff_measurements DML is NOT yet revoked — remaining direct
-- writers are being moved onto these commands first (tracked follow-up), and
-- revoking early would break Plan Room editing.
revoke all on function public.takeoff_unit_family (text)
from public, anon, authenticated, service_role;

revoke all on function public.calculate_estimate_takeoff_geometry (text, text, jsonb, public.estimate_plan_sheets)
from public, anon, authenticated, service_role;

revoke all on function public.apply_estimate_takeoff_line_rollup_internal (uuid, uuid, boolean, boolean)
from public, anon, authenticated, service_role;

revoke all on function public.tg_validate_estimate_takeoff_measurement ()
from public, anon, authenticated, service_role;

revoke all on function public.link_estimate_takeoff_group_atomic (uuid, uuid[], integer[], uuid, text, boolean, boolean)
from public, anon, authenticated, service_role;

grant execute on function public.link_estimate_takeoff_group_atomic (uuid, uuid[], integer[], uuid, text, boolean, boolean)
to authenticated, service_role;

revoke all on function public.recalculate_estimate_takeoff_sheet_atomic (uuid, uuid, integer, text, boolean, boolean)
from public, anon, authenticated, service_role;

grant execute on function public.recalculate_estimate_takeoff_sheet_atomic (uuid, uuid, integer, text, boolean, boolean)
to authenticated, service_role;

revoke all on function public.mutate_estimate_takeoff_measurement_atomic (uuid, uuid, integer, text, jsonb, boolean, text, boolean, boolean)
from public, anon, authenticated, service_role;

grant execute on function public.mutate_estimate_takeoff_measurement_atomic (uuid, uuid, integer, text, jsonb, boolean, text, boolean, boolean)
to authenticated, service_role;
