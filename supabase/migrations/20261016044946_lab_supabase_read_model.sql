-- Google Sheets remains authoritative. Publish rows, source order and overview atomically.
-- Additive: legacy feed/read/import endpoints remain available for deployment rollback.
-- Deploy migration -> worker -> Apps Script + successful initial sync -> Pilot assets.
-- Recovery: revert Pilot assets to the live feed and stop the new Apps Script trigger.
-- Keep these additive objects; do not drop the existing results table or source sheet.

alter table public.lab_mooney_results add column source_order integer;
-- The old live feed retained raw numeric precision; do not round those readings
-- to the legacy table's fixed 1/2 decimal places during the switch to database reads.
alter table public.lab_mooney_results
  alter column temperature_c type numeric,
  alter column test_minutes type numeric,
  alter column mh type numeric,
  alter column mv type numeric,
  alter column avg_mh type numeric,
  alter column sd_mh type numeric,
  alter column avg_mv type numeric,
  alter column sd_mv type numeric;
alter table public.lab_mooney_results add constraint lab_mooney_finite_readings check (
  mh < 1000000 and mv < 1000000 and avg_mh < 1000000 and sd_mh < 1000000
  and avg_mv < 1000000 and sd_mv < 1000000
);
create index lab_mooney_results_source_order_idx
  on public.lab_mooney_results (material, source_order);

create table private.lab_mooney_snapshot (
  singleton boolean primary key default true check (singleton),
  source_read_at timestamptz not null,
  synced_at timestamptz not null,
  row_hash text not null,
  materials jsonb not null check (jsonb_typeof(materials) = 'array')
);
alter table private.lab_mooney_snapshot enable row level security;
revoke all on private.lab_mooney_snapshot from public, anon, authenticated, service_role;

-- Restore the exact importer from the latest main: production has the table/read RPCs
-- but this service-only function was never installed during the live-feed rollout.
create or replace function public.app_lab_mooney_import(p_rows jsonb, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_count integer;
  v_inserted integer;
  v_updated integer;
  v_stale integer;
  v_deleted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;
  v_count := jsonb_array_length(p_rows);
  -- แถวว่างไม่ใช่ "ชีตว่าง": กันการอ่านชีตพลาดแล้วล้างตารางทั้งก้อน
  if v_count not between 1 and 20000 then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;

  -- นำเข้าทีละครั้ง ไม่ให้สองรอบลบแถวของกันและกัน
  perform pg_advisory_xact_lock(hashtext('lab_mooney_import'));

  begin
    with incoming as (
      select btrim(r.source_sheet) as source_sheet,
             btrim(r.sample_id) as sample_id,
             btrim(r.material) as material,
             r.test_date::date as test_date,
             r.test_time::time as test_time,
             r.temperature_c, r.test_minutes, r.mh, r.mv,
             r.avg_mh, r.sd_mh, r.avg_mv, r.sd_mv
      from jsonb_to_recordset(p_rows) as r(
        source_sheet text, sample_id text, material text, test_date text, test_time text,
        temperature_c numeric, test_minutes numeric, mh numeric, mv numeric,
        avg_mh numeric, sd_mh numeric, avg_mv numeric, sd_mv numeric
      )
      -- รูปแบบวันที่/เวลาตายตัว ไม่พึ่งการตั้งค่า DateStyle ของ session
      where r.test_date ~ '^\d{4}-\d{2}-\d{2}$' and r.test_time ~ '^\d{1,2}:\d{2}(:\d{2})?$'
    ), upserted as (
      insert into public.lab_mooney_results (
        source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
        mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, imported_at
      )
      select source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
             mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, v_started
      from incoming
      on conflict (source_sheet, sample_id, test_date, test_time) do update set
        material = excluded.material,
        temperature_c = excluded.temperature_c,
        test_minutes = excluded.test_minutes,
        mh = excluded.mh,
        mv = excluded.mv,
        avg_mh = excluded.avg_mh,
        sd_mh = excluded.sd_mh,
        avg_mv = excluded.avg_mv,
        sd_mv = excluded.sd_mv,
        imported_at = excluded.imported_at
      returning (xmax = 0) as was_inserted
    )
    select count(*) filter (where was_inserted)::integer,
           count(*) filter (where not was_inserted)::integer
    into v_inserted, v_updated
    from upserted;

    -- แถวที่ถูกกรองทิ้งเพราะรูปแบบวันที่/เวลาผิด = ข้อมูลไม่ถูกต้อง ไม่ใช่ "แถวที่หายไป"
    if v_inserted + v_updated <> v_count then
      raise exception 'LAB_INVALID_ROW';
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation
      or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
      or string_data_right_truncation or cardinality_violation then
      -- ข้อความกลางๆ ไม่คืนค่าในแถวที่ผิดกลับไป
      raise exception 'LAB_INVALID_ROW';
  end;

  select count(*)::integer into v_stale
  from public.lab_mooney_results
  where imported_at < v_started;

  -- ด่านกันลบเกินครึ่ง: ชีตที่อ่านมาไม่ครบ (เช่นขาดหลายแท็บ) จะไม่ล้างข้อมูลที่มีอยู่
  if not coalesce(p_force, false) and v_stale >= 10 and v_stale * 2 > v_stale + v_updated then
    raise exception 'LAB_IMPORT_TOO_DESTRUCTIVE';
  end if;

  delete from public.lab_mooney_results where imported_at < v_started;
  get diagnostics v_deleted = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null, 'IMPORT', 'lab_mooney_results', null,
    jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated,
                       'deleted', v_deleted, 'forced', coalesce(p_force, false))
  );

  return jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted);
end;
$$;
revoke all on function public.app_lab_mooney_import(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.app_lab_mooney_import(jsonb, boolean) to service_role;

-- Only the worker holds service_role. It derives summaries with the shared JS model.
-- Never accept force-delete from the HTTP integration. A rejected large deletion
-- requires an operator to review the sheet and use the legacy import explicitly.
create function public.app_lab_mooney_publish(
  p_rows jsonb, p_materials jsonb, p_source_read_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous private.lab_mooney_snapshot%rowtype;
  v_hash text;
  v_result jsonb;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array'
    or jsonb_array_length(p_rows) not between 1 and 20000
    or p_materials is null or jsonb_typeof(p_materials) <> 'array'
    or p_source_read_at is null or not isfinite(p_source_read_at)
    or p_source_read_at > clock_timestamp() + interval '5 minutes' then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;
  -- Same lock as the existing import; prevents snapshots overwriting newer reads.
  perform pg_advisory_xact_lock(hashtext('lab_mooney_import'));
  select * into v_previous from private.lab_mooney_snapshot where singleton;
  if v_previous.source_read_at is not null and p_source_read_at <= v_previous.source_read_at then
    return jsonb_build_object('applied', false, 'reason', 'OLDER_SNAPSHOT');
  end if;
  -- Summaries must describe exactly the same materials and counts as the rows.
  if exists (
    (select btrim(r->>'material'), count(*)::integer
       from jsonb_array_elements(p_rows) r group by btrim(r->>'material')
     except
     select m->>'material', (m->>'resultCount')::integer from jsonb_array_elements(p_materials) m)
    union all
    (select m->>'material', (m->>'resultCount')::integer from jsonb_array_elements(p_materials) m
     except
     select btrim(r->>'material'), count(*)::integer
       from jsonb_array_elements(p_rows) r group by btrim(r->>'material'))
  ) or jsonb_array_length(p_materials) <> (
    select count(distinct btrim(r->>'material')) from jsonb_array_elements(p_rows) r
  ) then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;
  v_hash := md5(p_rows::text);
  -- Confirm unchanged reads without rewriting rows or adding an audit record every minute.
  if v_previous.row_hash is distinct from v_hash then
    v_result := public.app_lab_mooney_import(p_rows, false);
    update public.lab_mooney_results r set source_order = i.ordinality::integer
    from jsonb_array_elements(p_rows) with ordinality as i(item, ordinality)
    where r.source_sheet = btrim(i.item->>'source_sheet')
      and r.sample_id = btrim(i.item->>'sample_id')
      and r.test_date = (i.item->>'test_date')::date
      and r.test_time = (i.item->>'test_time')::time;
  end if;
  insert into private.lab_mooney_snapshot(singleton, source_read_at, synced_at, row_hash, materials)
  values (true, p_source_read_at, clock_timestamp(), v_hash, p_materials)
  on conflict (singleton) do update set
    source_read_at = excluded.source_read_at, synced_at = excluded.synced_at,
    row_hash = excluded.row_hash, materials = excluded.materials;
  return jsonb_build_object('applied', true, 'changed', v_previous.row_hash is distinct from v_hash,
                           'rows', jsonb_array_length(p_rows));
end;
$$;
revoke all on function public.app_lab_mooney_publish(jsonb, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.app_lab_mooney_publish(jsonb, jsonb, timestamptz) to service_role;

-- One RPC/statement snapshot: overview never transfers raw measurements;
-- a material page gets all of that material, without a silent 2,000-row cutoff.
create function public.app_lab_mooney_feed(p_material text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_material text := nullif(btrim(p_material), '');
  v_snapshot private.lab_mooney_snapshot%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.can_access_lab() then raise exception 'NOT_AUTHORIZED'; end if;
  if v_material is not null and char_length(v_material) > 60 then
    raise exception 'LAB_INVALID_MATERIAL';
  end if;
  select * into v_snapshot from private.lab_mooney_snapshot where singleton;
  if not found then raise exception 'LAB_SYNC_NOT_READY'; end if;
  return jsonb_build_object(
    'generated_at', v_snapshot.source_read_at,
    'synced_at', v_snapshot.synced_at,
    'materials', v_snapshot.materials,
    'rows', case when v_material is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(r) - 'imported_at' - 'source_order' order by r.source_order)
      from public.lab_mooney_results r where r.material = v_material
    ), '[]'::jsonb) end
  );
end;
$$;
revoke all on function public.app_lab_mooney_feed(text) from public, anon;
grant execute on function public.app_lab_mooney_feed(text) to authenticated;
