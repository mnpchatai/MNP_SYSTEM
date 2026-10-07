-- ============================================================================
-- ฝ่ายโรงงาน: ขั้น 3 ของ workflow การผลิต — งานสั่งวัตถุดิบ แผนก ST (โหมดทดสอบเท่านั้น)
--   3.1 สั่งวัตถุดิบที่เกี่ยวข้องกับการผลิตตามความต้องการของงาน
--
-- ต่อจากขั้น 1–2 (20261007030000) ซึ่งออกใบสั่งงานให้ฝ่ายผลิตแล้ว (factory_production_orders.status = released) แผนก ST เห็นว่า
-- ใบสั่งงานใดต้องใช้วัตถุดิบอะไรเพิ่ม (คำนวณในหน้าเว็บจากสูตรที่อนุมัติ หักคงเหลือ) แล้วออก "ใบสั่งวัตถุดิบ" ผูกกับใบสั่งผลิตนั้น
-- เมื่อของมาถึงให้ยืนยันรับ ระบบเพิ่มยอดคงคลังจริง (factory_inventory_movements ชนิด receipt เข้าคลัง RM พร้อมล็อตถ้า Item ติดตามล็อต)
-- ยอดสำรวจคงคลังของใบสั่งผลิต/หน้าสินค้าคงคลังจึงเห็นของที่รับเข้ามาแล้ว
--
-- สถานะของใบสั่งวัตถุดิบ (factory_material_orders.status)
--   draft ──สั่ง (ST)──▶ ordered ──ยืนยันรับของ (ST)──▶ received   · draft/ordered ──ยกเลิก+เหตุผล (ST)──▶ cancelled
--   * แก้ไขได้เฉพาะ draft (แทนที่บรรทัดทั้งชุดในธุรกรรมเดียว) สั่งแล้วแก้ไม่ได้ ต้องยกเลิกแล้วออกใบใหม่
--   * รับของทั้งใบในครั้งเดียว (ตามปริมาณที่สั่ง) ยังไม่มีรับบางส่วน/ใบรับของแยก/ตรวจรับคุณภาพ
--
-- สิทธิ์ (ทุก RPC เรียก private.factory_actor() ก่อน จึงใช้ได้เฉพาะ admin ในโหมดทดสอบ) และจำกัดตามแผนกของ persona
--   * สร้าง/แก้/สั่ง/ยกเลิก/รับของ: แผนก ST เท่านั้น (MATERIAL_STORES_ONLY) เพิ่มบัญชีทดสอบ SBX-ST-STAFF
--   * ก่อนเปิดกับข้อมูลจริงต้องกำหนดตัวบทบาทจริง (ผู้สั่ง/ผู้รับของ/ผู้อนุมัติวงเงิน) และช่องทางแจ้งเตือน เช่นเดียวกับขั้นก่อนหน้า
--
-- กฎที่ฐานข้อมูลบังคับ
--   * ใบสั่งผลิตที่อ้างต้องอยู่ในสถานะ released หรือ in_progress (ออกใบสั่งงานแล้ว) ตอนบันทึกและตอนสั่ง (MATERIAL_WORK_ORDER_NOT_RELEASED)
--   * บรรทัด: 1–100 บรรทัด Item ที่ใช้งานอยู่และจัดซื้อได้ (procurement buy/both) ไม่ซ้ำในใบเดียว ปริมาณ > 0 ไม่เกิน 1,000,000,000
--     (ปัด 4 ทศนิยม) หน่วยเป็นหน่วยนับฐานของ Item นั้น · วันที่คาดว่าจะได้รับไม่ก่อนวันนี้ (Asia/Bangkok) ไม่เกิน 10 ปี
--   * ทุกขั้นล็อกแถว (for update) เทียบ version ตรวจสถานะปัจจุบันในธุรกรรมเดียวกับการเปลี่ยน กันกดซ้ำ/ทับกัน (รับของซ้ำไม่ได้ จึงไม่เพิ่มยอดสองครั้ง)
--     แล้วเขียน factory_material_order_history (พร้อม snapshot) และ audit_logs (ผู้กระทำคือ admin ตัวจริง)
--   * เลขที่ใบสั่งวัตถุดิบ TEST-MR-yy-nnn จากตัวนับแยกชุดทดสอบ (document_counters 'FACTORY-MR-TEST') รีเซ็ตตอนล้างข้อมูลทดสอบฝ่ายโรงงาน
--   * โหมดทดสอบไม่ส่งอีเมล/LINE (กติกาข้อ 4)
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_material_orders / factory_material_order_lines / factory_material_order_history ใช้แบบเดียวกับ
-- factory_* ทุกตาราง (is_test จาก trigger, foreign key คู่ (id, is_test), RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables())
--
-- เริ่มจากนิยามล่าสุดของ private.factory_order_actor / private.next_factory_doc_number / private.sandbox_unguarded_tables /
-- app_factory_master_data / app_sandbox_purge_factory (20261007030000) แล้วเพิ่มเฉพาะส่วนของใบสั่งวัตถุดิบ
--
-- Rollback (ตารางเหล่านี้มีแต่ข้อมูลทดสอบ): drop function public.app_factory_save_material_order(...), app_factory_place_material_order(...),
--   app_factory_cancel_material_order(...), app_factory_receive_material_order(...); drop function private.factory_material_lock(uuid, integer),
--   factory_material_log(...), factory_material_snapshot(uuid); drop table factory_material_order_history, factory_material_order_lines,
--   factory_material_orders (ลูกก่อนแม่); ลบแถว employees SBX-ST-STAFF; แล้ว create or replace private.factory_order_actor /
--   private.next_factory_doc_number / private.sandbox_unguarded_tables / app_factory_master_data / app_sandbox_purge_factory ด้วยนิยามเดิมจาก
--   20261007030000 (ยอดคงคลังที่เกิดจากการรับของเป็นข้อมูลทดสอบ ล้างด้วยปุ่ม "ล้างข้อมูลทดสอบฝ่ายโรงงาน")
-- ============================================================================

-- 1. ตาราง -----------------------------------------------------------------------------
create table public.factory_material_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
  production_order_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'ordered', 'received', 'cancelled')),
  supplier text not null default '' check (char_length(supplier) <= 200),
  expected_date date not null check (expected_date between date '2000-01-01' and date '2100-12-31'),
  note text not null default '' check (char_length(note) <= 1000),
  cancel_note text not null default '' check (char_length(cancel_note) <= 1000),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ordered_by uuid references public.employees(id) on delete set null,
  ordered_at timestamptz,
  received_by uuid references public.employees(id) on delete set null,
  received_at timestamptz,
  cancelled_by uuid references public.employees(id) on delete set null,
  cancelled_at timestamptz,
  foreign key (production_order_id, is_test) references public.factory_production_orders(id, is_test),
  unique (id, is_test),
  unique (is_test, code)
);
create index factory_material_orders_production_idx on public.factory_material_orders(production_order_id);
comment on table public.factory_material_orders is 'ใบสั่งวัตถุดิบของแผนก ST ผูกกับใบสั่งผลิตที่ออกใบสั่งงานแล้ว (ขั้น 3.1)';

create table public.factory_material_order_lines (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  order_id uuid not null,
  line_no integer not null check (line_no > 0),
  item_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  foreign key (order_id, is_test) references public.factory_material_orders(id, is_test),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  unique (order_id, line_no),
  unique (order_id, item_id)
);
comment on table public.factory_material_order_lines is 'บรรทัดของใบสั่งวัตถุดิบ: ปริมาณเป็นหน่วยนับฐานของ Item';

create table public.factory_material_order_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  order_id uuid not null,
  action text not null check (action in ('create', 'update', 'place', 'receive', 'cancel')),
  version integer not null check (version >= 1),
  status_after text not null check (status_after in ('draft', 'ordered', 'received', 'cancelled')),
  note text not null default '' check (char_length(note) <= 1000),
  snapshot jsonb not null,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, is_test) references public.factory_material_orders(id, is_test)
);
create index factory_material_order_history_order_idx on public.factory_material_order_history(order_id, created_at desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['factory_material_orders', 'factory_material_order_lines', 'factory_material_order_history'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.factory_sandbox_scope()', v_table || '_sandbox_scope', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;
revoke all on sequence public.factory_material_order_history_id_seq from anon, authenticated;

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261007030000 ทุกชื่อ แล้วเพิ่มตารางของใบสั่งวัตถุดิบ)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history']
$$;

-- 2. บัญชีทดสอบของแผนก ST ---------------------------------------------------------------
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.employee_no, 'ทดสอบ', v.last_name, lower(v.employee_no) || '@sandbox.local', v.last_name || ' (ทดสอบ)',
       d.id, r.id, false, true
from (values ('SBX-ST-STAFF', 'พนักงาน ST', 'ST', 'staff')) as v(employee_no, last_name, dept_code, role_code)
join public.departments d on d.code = v.dept_code
join public.roles r on r.code = v.role_code
on conflict (employee_no) do nothing;

-- 3. ตัวช่วย (private) -------------------------------------------------------------------
-- ผู้ทำรายการตามแผนก: SA ฝ่ายขาย · PP ฝ่ายวางแผน · ST สั่งวัตถุดิบ (เพิ่ม ST จากนิยามของ 20261007030000)
create or replace function private.factory_order_actor(p_dept text)
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  v_actor := private.factory_actor();
  if not exists (select 1 from public.departments d where d.id = v_actor.department_id and d.code = p_dept) then
    raise exception '%', case p_dept
      when 'SA' then 'PRODUCTION_SALES_ONLY'
      when 'PP' then 'PRODUCTION_PLANNING_ONLY'
      when 'ST' then 'MATERIAL_STORES_ONLY'
      else 'NOT_AUTHORIZED' end;
  end if;
  return v_actor;
end;
$$;
revoke all on function private.factory_order_actor(text) from public, anon, authenticated;

-- เลขที่เอกสารของโหมดทดสอบ (เพิ่มชนิด 'MR' ใบสั่งวัตถุดิบ จากนิยามของ 20261007030000)
create or replace function private.next_factory_doc_number(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_next integer;
begin
  if p_kind not in ('MO', 'WO', 'MR') then raise exception 'INVALID_FACTORY_DOC_KIND'; end if;
  insert into public.document_counters (department_code, year_key, last_number)
  values ('FACTORY-' || p_kind || '-TEST', v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1, updated_at = now()
  returning last_number into v_next;
  return 'TEST-' || p_kind || '-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;
revoke all on function private.next_factory_doc_number(text) from public, anon, authenticated;

create or replace function private.factory_material_lock(p_id uuid, p_version integer)
returns public.factory_material_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.factory_material_orders%rowtype;
begin
  select * into v_order from public.factory_material_orders where id = p_id and is_test for update;
  if v_order.id is null then raise exception 'MATERIAL_ORDER_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_order.version then raise exception 'MATERIAL_ORDER_VERSION_CONFLICT'; end if;
  return v_order;
end;
$$;
revoke all on function private.factory_material_lock(uuid, integer) from public, anon, authenticated;

create or replace function private.factory_material_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', m.id, 'code', m.code, 'status', m.status, 'version', m.version, 'production_code', p.code,
    'supplier', m.supplier, 'expected_date', m.expected_date, 'note', m.note, 'cancel_note', m.cancel_note,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object('line_no', l.line_no, 'item_code', i.code, 'item_name', i.name,
                                          'unit_code', i.unit_code, 'quantity', l.quantity) order by l.line_no)
      from public.factory_material_order_lines l join public.factory_items i on i.id = l.item_id
      where l.order_id = m.id), '[]'::jsonb))
  from public.factory_material_orders m
  join public.factory_production_orders p on p.id = m.production_order_id
  where m.id = p_id
$$;
revoke all on function private.factory_material_snapshot(uuid) from public, anon, authenticated;

create or replace function private.factory_material_log(p_order_id uuid, p_action text, p_note text, p_actor public.employees)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.factory_material_orders%rowtype;
  v_admin_id uuid;
begin
  select * into v_order from public.factory_material_orders where id = p_order_id;
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.factory_material_order_history (order_id, action, version, status_after, note, snapshot, changed_by)
  values (v_order.id, p_action, v_order.version, v_order.status, coalesce(p_note, ''), private.factory_material_snapshot(v_order.id), p_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_MATERIAL_' || upper(p_action), 'factory_material_orders', v_order.id::text,
          jsonb_build_object('code', v_order.code, 'version', v_order.version, 'status', v_order.status,
                             'is_test', v_order.is_test, 'persona_employee_no', p_actor.employee_no));
  return jsonb_build_object('id', v_order.id, 'version', v_order.version, 'code', v_order.code, 'status', v_order.status);
end;
$$;
revoke all on function private.factory_material_log(uuid, text, text, public.employees) from public, anon, authenticated;

-- ใบสั่งผลิตที่ออกใบสั่งงานแล้ว (released / in_progress) เท่านั้นที่สั่งวัตถุดิบได้
create or replace function private.factory_assert_released_order(p_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.factory_production_orders where id = p_id and is_test;
  if v_status is null then raise exception 'MATERIAL_WORK_ORDER_UNKNOWN'; end if;
  if v_status not in ('released', 'in_progress') then raise exception 'MATERIAL_WORK_ORDER_NOT_RELEASED'; end if;
end;
$$;
revoke all on function private.factory_assert_released_order(uuid) from public, anon, authenticated;

-- 4. สร้าง/แก้ฉบับร่าง · สั่ง · ยกเลิก · รับของ ---------------------------------------------
create or replace function public.app_factory_save_material_order(
  p_id uuid, p_version integer, p_production_order_id uuid, p_supplier text, p_expected_date date, p_note text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_old public.factory_material_orders%rowtype;
  v_new public.factory_material_orders%rowtype;
  v_supplier text := btrim(coalesce(p_supplier, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_line jsonb;
  v_item public.factory_items%rowtype;
  v_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_id uuid;
  v_qty numeric;
begin
  v_actor := private.factory_order_actor('ST');
  if p_expected_date is null or p_expected_date < v_today or p_expected_date > v_today + 3650 then raise exception 'INVALID_MATERIAL_ORDER_DATE'; end if;
  if char_length(v_supplier) > 200 then raise exception 'INVALID_MATERIAL_ORDER_SUPPLIER'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_MATERIAL_ORDER_NOTE'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) > 100 then raise exception 'INVALID_MATERIAL_ORDER_LINES'; end if;
  if jsonb_array_length(p_lines) = 0 then raise exception 'MATERIAL_ORDER_NO_LINES'; end if;
  perform private.factory_assert_released_order(p_production_order_id);

  if p_id is not null then
    v_old := private.factory_material_lock(p_id, p_version);
    if v_old.status <> 'draft' then raise exception 'MATERIAL_ORDER_NOT_EDITABLE'; end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'INVALID_MATERIAL_ORDER_LINES'; end if;
    begin
      v_id := (v_line ->> 'item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'INVALID_MATERIAL_ORDER_LINES';
    end;
    if v_id is null then raise exception 'INVALID_MATERIAL_ORDER_LINES'; end if;
    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_MATERIAL_ORDER_QTY';
    end;
    if v_qty is null or v_qty = 'NaN'::numeric then raise exception 'INVALID_MATERIAL_ORDER_QTY'; end if;
    v_qty := round(v_qty, 4);
    if v_qty <= 0 or v_qty > 1000000000 then raise exception 'INVALID_MATERIAL_ORDER_QTY'; end if;
    if v_id = any (v_ids) then raise exception 'MATERIAL_ORDER_LINE_DUPLICATE'; end if;
    select * into v_item from public.factory_items where id = v_id and is_test;
    if v_item.id is null then raise exception 'MATERIAL_ORDER_LINE_UNKNOWN'; end if;
    if v_item.status <> 'active' or v_item.procurement not in ('buy', 'both') then raise exception 'MATERIAL_ORDER_LINE_INVALID'; end if;
    v_ids := v_ids || v_id;
    v_qtys := v_qtys || v_qty;
  end loop;

  if p_id is null then
    insert into public.factory_material_orders (code, production_order_id, supplier, expected_date, note, created_by, updated_by)
    values (private.next_factory_doc_number('MR'), p_production_order_id, v_supplier, p_expected_date, v_note, v_actor.id, v_actor.id)
    returning * into v_new;
  else
    update public.factory_material_orders
    set production_order_id = p_production_order_id, supplier = v_supplier, expected_date = p_expected_date, note = v_note,
        version = v_old.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_old.id
    returning * into v_new;
    delete from public.factory_material_order_lines where order_id = v_new.id;
  end if;

  insert into public.factory_material_order_lines (order_id, line_no, item_id, quantity)
  select v_new.id, t.n::integer, t.item_id, t.quantity
  from unnest(v_ids, v_qtys) with ordinality as t(item_id, quantity, n);

  return private.factory_material_log(v_new.id, case when p_id is null then 'create' else 'update' end, '', v_actor);
end;
$$;

-- สั่งวัตถุดิบ: ตรวจใบสั่งงานและ Item ซ้ำ (Item อาจถูกหยุดใช้งานหรือเปลี่ยนวิธีจัดหาหลังบันทึกฉบับร่าง)
create or replace function public.app_factory_place_material_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_material_orders%rowtype;
begin
  v_actor := private.factory_order_actor('ST');
  v_order := private.factory_material_lock(p_id, p_version);
  if v_order.status <> 'draft' then raise exception 'MATERIAL_ORDER_NOT_DRAFT'; end if;
  perform private.factory_assert_released_order(v_order.production_order_id);
  if not exists (select 1 from public.factory_material_order_lines where order_id = v_order.id) then raise exception 'MATERIAL_ORDER_NO_LINES'; end if;
  if exists (select 1 from public.factory_material_order_lines l join public.factory_items i on i.id = l.item_id
             where l.order_id = v_order.id and (i.status <> 'active' or i.procurement not in ('buy', 'both'))) then
    raise exception 'MATERIAL_ORDER_LINE_INVALID';
  end if;
  update public.factory_material_orders
  set status = 'ordered', version = v_order.version + 1, ordered_by = v_actor.id, ordered_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_material_log(v_order.id, 'place', '', v_actor);
end;
$$;

create or replace function public.app_factory_cancel_material_order(p_id uuid, p_version integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_material_orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_actor := private.factory_order_actor('ST');
  if v_note = '' then raise exception 'MATERIAL_CANCEL_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_MATERIAL_ORDER_NOTE'; end if;
  v_order := private.factory_material_lock(p_id, p_version);
  if v_order.status not in ('draft', 'ordered') then raise exception 'MATERIAL_ORDER_NOT_CANCELLABLE'; end if;
  update public.factory_material_orders
  set status = 'cancelled', cancel_note = v_note, version = v_order.version + 1, cancelled_by = v_actor.id, cancelled_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_material_log(v_order.id, 'cancel', v_note, v_actor);
end;
$$;

-- ยืนยันรับของ: เพิ่มยอดคงคลังจริงเข้าคลัง RM (สร้างคลังถ้ายังไม่มี) ล็อตละบรรทัดสำหรับ Item ที่ติดตามล็อต ทั้งหมดในธุรกรรมเดียวกับการเปลี่ยนสถานะ
-- การรับซ้ำถูกกันด้วยสถานะ (ordered → received) จึงไม่เพิ่มยอดสองครั้ง
create or replace function public.app_factory_receive_material_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_material_orders%rowtype;
  v_warehouse uuid;
  v_line record;
  v_lot uuid;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  v_actor := private.factory_order_actor('ST');
  v_order := private.factory_material_lock(p_id, p_version);
  if v_order.status <> 'ordered' then raise exception 'MATERIAL_ORDER_NOT_ORDERED'; end if;

  select id into v_warehouse from public.factory_warehouses where is_test and code = 'RM';
  if v_warehouse is null then
    insert into public.factory_warehouses (code, name) values ('RM', 'คลังวัตถุดิบ') returning id into v_warehouse;
  end if;

  for v_line in
    select l.line_no, l.item_id, l.quantity, i.lot_tracking
    from public.factory_material_order_lines l join public.factory_items i on i.id = l.item_id
    where l.order_id = v_order.id
    order by l.line_no
  loop
    v_lot := null;
    if v_line.lot_tracking then
      insert into public.factory_lots (item_id, lot_number, received_date)
      values (v_line.item_id, v_order.code || '-' || v_line.line_no, v_today)
      returning id into v_lot;
    end if;
    insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, production_order_id, created_by)
    values (v_line.item_id, v_warehouse, v_lot, v_line.quantity, 'receipt', 'รับตามใบสั่งวัตถุดิบ ' || v_order.code,
            v_order.production_order_id, v_actor.id);
  end loop;

  update public.factory_material_orders
  set status = 'received', version = v_order.version + 1, received_by = v_actor.id, received_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_material_log(v_order.id, 'receive', '', v_actor);
end;
$$;

-- 5. อ่านข้อมูลทั้งหมดของโมดูล: เพิ่ม material_orders และ material_history ----------------------------
create or replace function public.app_factory_master_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_test boolean;
begin
  perform private.factory_actor();
  v_test := (private.sandbox_persona()).id is not null;
  return jsonb_build_object(
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('code', u.code, 'name_th', u.name_th) order by u.sort_order, u.code)
      from public.factory_units u), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name_th', c.name_th) order by c.sort_order, c.code)
      from public.factory_categories c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'code', i.code, 'name', i.name, 'name_en', i.name_en, 'item_type', i.item_type,
          'category_code', i.category_code, 'category_name', c.name_th, 'brand', i.brand,
          'unit_code', i.unit_code, 'procurement', i.procurement, 'status', i.status,
          'lot_tracking', i.lot_tracking, 'min_stock', i.min_stock, 'specification', i.specification,
          'version', i.version, 'created_at', i.created_at, 'updated_at', i.updated_at,
          'updated_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = i.updated_by),
          'stock', coalesce((select sum(m.quantity) from public.factory_inventory_movements m
                             where m.item_id = i.id and m.is_test = v_test), 0)
        ) order by i.code)
      from public.factory_items i
      join public.factory_categories c on c.code = i.category_code
      where i.is_test = v_test), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'item_id', b.item_id, 'code', i.code, 'name', i.name, 'unit_code', i.unit_code,
          'revision', b.revision, 'output_qty', b.output_qty, 'status', b.status, 'effective_date', b.effective_date,
          'version', b.version, 'note', b.note, 'created_at', b.created_at, 'updated_at', b.updated_at,
          'submitted_at', b.submitted_at, 'decided_at', b.decided_at, 'decision_note', b.decision_note,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.created_by),
          'submitted_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.submitted_by),
          'decided_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.decided_by)
        ) order by i.code, b.revision)
      from public.factory_boms b join public.factory_items i on i.id = b.item_id
      where b.is_test = v_test), '[]'::jsonb),
    'bom_lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id, 'bom_id', l.bom_id, 'line_no', l.line_no, 'component_id', l.component_id,
          'code', i.code, 'name', i.name, 'unit_code', i.unit_code, 'quantity', l.quantity,
          'scrap_percent', l.scrap_percent
        ) order by l.bom_id, l.line_no)
      from public.factory_bom_lines l join public.factory_items i on i.id = l.component_id
      where l.is_test = v_test), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'item_id', r.item_id, 'code', i.code, 'name', i.name,
          'revision', r.revision, 'status', r.status
        ) order by i.code, r.revision)
      from public.factory_routings r join public.factory_items i on i.id = r.item_id
      where r.is_test = v_test), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'routing_id', s.routing_id, 'sequence', s.sequence, 'name', s.name,
          'work_center', w.name, 'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes,
          'instruction', s.instruction
        ) order by s.routing_id, s.sequence)
      from public.factory_routing_steps s join public.factory_work_centers w on w.id = s.work_center_id
      where s.is_test = v_test), '[]'::jsonb),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) order by w.code)
      from public.factory_warehouses w where w.is_test = v_test), '[]'::jsonb),
    -- คงเหลือต่อ Item × คลัง × ล็อต ของ Item ที่ใช้งาน (Item ที่ยังไม่มีรายการเคลื่อนไหวแสดง 0 ไม่ระบุคลัง)
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
          'item_id', x.item_id, 'code', x.code, 'name', x.name, 'unit_code', x.unit_code, 'min_stock', x.min_stock,
          'warehouse', x.warehouse, 'lot_number', x.lot_number, 'quantity', x.quantity
        ) order by x.code, x.warehouse, x.lot_number)
      from (
        select i.id as item_id, i.code, i.name, i.unit_code, i.min_stock,
               coalesce(w.name, 'ยังไม่ระบุคลัง') as warehouse, l.lot_number,
               coalesce(sum(m.quantity), 0) as quantity
        from public.factory_items i
        left join public.factory_inventory_movements m on m.item_id = i.id and m.is_test = v_test
        left join public.factory_warehouses w on w.id = m.warehouse_id
        left join public.factory_lots l on l.id = m.lot_id
        where i.is_test = v_test and i.status = 'active'
        group by i.id, i.code, i.name, i.unit_code, i.min_stock, w.name, l.lot_number
      ) x), '[]'::jsonb),
    'production', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'code', p.code, 'item_id', p.item_id, 'item_code', i.code, 'name', i.name, 'unit_code', i.unit_code,
          'bom_id', p.bom_id, 'routing_id', p.routing_id, 'planned_qty', p.planned_qty,
          'completed_qty', p.completed_qty, 'status', p.status, 'due_date', p.due_date,
          'customer', p.customer, 'note', p.note, 'survey_note', p.survey_note, 'return_note', p.return_note,
          'work_order_no', p.work_order_no, 'version', p.version,
          'bom_revision', b.revision, 'bom_status', b.status, 'routing_revision', r.revision,
          'created_at', p.created_at, 'updated_at', p.updated_at, 'submitted_at', p.submitted_at,
          'received_at', p.received_at, 'planned_at', p.planned_at, 'released_at', p.released_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.created_by),
          'submitted_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.submitted_by),
          'received_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.received_by),
          'planned_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.planned_by),
          'released_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.released_by)
        ) order by p.code)
      from public.factory_production_orders p
      join public.factory_items i on i.id = p.item_id
      left join public.factory_boms b on b.id = p.bom_id
      left join public.factory_routings r on r.id = p.routing_id
      where p.is_test = v_test), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'item_id', x.item_id, 'code', i.code, 'name', i.name, 'action', x.action,
            'version', x.version, 'before_data', x.before_data, 'after_data', x.after_data,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_item_history x join public.factory_items i on i.id = x.item_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 50
      ) h), '[]'::jsonb),
    -- ประวัติของ BOM ทุกฉบับ (300 รายการล่าสุด) ไม่รวม snapshot เพื่อไม่ให้ข้อมูลหนักเกินไป
    'bom_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'bom_id', x.bom_id, 'code', i.code, 'name', i.name, 'revision', b.revision,
            'action', x.action, 'version', x.version, 'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_bom_history x
        join public.factory_boms b on b.id = x.bom_id
        join public.factory_items i on i.id = b.item_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb),
    -- ประวัติของใบสั่งผลิตทุกใบ (300 รายการล่าสุด) ไม่รวม snapshot
    'production_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'order_id', x.order_id, 'code', p.code, 'action', x.action, 'version', x.version,
            'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_production_order_history x
        join public.factory_production_orders p on p.id = x.order_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb),
    -- ใบสั่งวัตถุดิบของแผนก ST พร้อมบรรทัด (ขั้น 3.1)
    'material_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'code', m.code, 'status', m.status, 'version', m.version,
          'production_order_id', m.production_order_id, 'production_code', p.code,
          'item_code', fi.code, 'item_name', fi.name,
          'supplier', m.supplier, 'expected_date', m.expected_date, 'note', m.note, 'cancel_note', m.cancel_note,
          'created_at', m.created_at, 'ordered_at', m.ordered_at, 'received_at', m.received_at, 'cancelled_at', m.cancelled_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.created_by),
          'ordered_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.ordered_by),
          'received_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.received_by),
          'cancelled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.cancelled_by),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
                'line_no', l.line_no, 'item_id', l.item_id, 'code', ci.code, 'name', ci.name,
                'unit_code', ci.unit_code, 'quantity', l.quantity) order by l.line_no)
            from public.factory_material_order_lines l join public.factory_items ci on ci.id = l.item_id
            where l.order_id = m.id), '[]'::jsonb)
        ) order by m.code desc)
      from public.factory_material_orders m
      join public.factory_production_orders p on p.id = m.production_order_id
      join public.factory_items fi on fi.id = p.item_id
      where m.is_test = v_test), '[]'::jsonb),
    -- ประวัติของใบสั่งวัตถุดิบทุกใบ (300 รายการล่าสุด) ไม่รวม snapshot
    'material_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'order_id', x.order_id, 'code', m.code, 'action', x.action, 'version', x.version,
            'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_material_order_history x
        join public.factory_material_orders m on m.id = x.order_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb)
  );
end;
$$;

-- 6. ล้างข้อมูลทดสอบของฝ่ายโรงงาน: เพิ่มใบสั่งวัตถุดิบและตัวนับเลข MR -----------------------------
create or replace function public.app_sandbox_purge_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_items integer;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ใบสั่งวัตถุดิบอ้างใบสั่งผลิต ต้องลบก่อน (ลูกก่อนแม่)
  delete from public.factory_material_order_history where is_test;
  delete from public.factory_material_order_lines where is_test;
  delete from public.factory_material_orders where is_test;
  delete from public.factory_inventory_movements where is_test;
  delete from public.factory_lots where is_test;
  delete from public.factory_production_order_history where is_test;
  delete from public.factory_production_orders where is_test;
  delete from public.factory_routing_steps where is_test;
  delete from public.factory_routings where is_test;
  delete from public.factory_bom_history where is_test;
  delete from public.factory_bom_lines where is_test;
  delete from public.factory_boms where is_test;
  delete from public.factory_item_unit_conversions where is_test;
  delete from public.factory_item_history where is_test;
  delete from public.factory_items where is_test;
  get diagnostics v_items = row_count;
  delete from public.factory_work_centers where is_test;
  delete from public.factory_warehouses where is_test;
  -- เริ่มนับเลขใบสั่งผลิต/ใบสั่งงานของโหมดทดสอบใหม่
  delete from public.document_counters where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST', 'FACTORY-MR-TEST');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;

revoke all on function public.app_factory_save_material_order(uuid, integer, uuid, text, date, text, jsonb) from public, anon;
revoke all on function public.app_factory_place_material_order(uuid, integer) from public, anon;
revoke all on function public.app_factory_cancel_material_order(uuid, integer, text) from public, anon;
revoke all on function public.app_factory_receive_material_order(uuid, integer) from public, anon;
grant execute on function public.app_factory_save_material_order(uuid, integer, uuid, text, date, text, jsonb) to authenticated;
grant execute on function public.app_factory_place_material_order(uuid, integer) to authenticated;
grant execute on function public.app_factory_cancel_material_order(uuid, integer, text) to authenticated;
grant execute on function public.app_factory_receive_material_order(uuid, integer) to authenticated;
