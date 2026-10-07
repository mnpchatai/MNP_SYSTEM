-- ============================================================================
-- ฝ่ายโรงงาน: ใบสั่งผลิต ขั้น 1–2 ของ workflow การผลิต (โหมดทดสอบเท่านั้น)
--   1. งานสั่งผลิต — ฝ่ายขาย (SA): ออกใบสั่งผลิต → ส่งให้ฝ่ายวางแผน
--   2. งานวางแผน — ฝ่ายวางแผน (PP): รับใบ → สำรวจคงคลัง → เลือก BOM ที่อนุมัติแล้วและ Routing → ออกใบสั่งงานให้ฝ่ายผลิต
--
-- ต่อจากชุดข้อมูลทดลอง (20261007020000) ซึ่งสร้าง Item/BOM/Routing/ใบสั่งผลิตไว้แล้ว migration นี้ทำให้ "ใบสั่งผลิต" เดินตามขั้นได้จริง
--
-- สถานะของใบสั่งผลิต (factory_production_orders.status)
--   draft ──ส่ง (SA)──▶ submitted ──รับ (PP)──▶ planning ──วางแผน (PP)──▶ planned ──ออกใบสั่งงาน (PP)──▶ released ──▶ in_progress ▶ completed
--     ▲                    │ ถอนกลับ (SA)           │ ส่งกลับพร้อมเหตุผล (PP)               (วางแผนซ้ำได้ขณะ planning/planned)
--     └────────────────────┴────────────────────────┘
--   * draft/submitted/planning ยังไม่ผูก BOM/Routing (bom_id, routing_id เป็น NULL ได้) ตั้งแต่ planned ต้องมีทั้งคู่ (check constraint)
--   * planned เดิมของชุดข้อมูลตัวอย่าง (มี BOM/Routing แล้ว) ใช้ความหมายใหม่ว่า "วางแผนแล้ว รอออกใบสั่งงาน" ไม่ต้องแก้ข้อมูลเดิม
--   * in_progress / completed / cancelled ยังไม่มี RPC ที่เปลี่ยนไปสถานะเหล่านี้ (เป็นขั้นของฝ่ายผลิตรอบถัดไป)
--
-- สิทธิ์ (ทุก RPC เรียก private.factory_actor() ก่อน จึงใช้ได้เฉพาะ admin ในโหมดทดสอบ) และจำกัดตามแผนกของ persona ที่ทำหน้าที่อยู่
--   * สร้าง/แก้ฉบับร่าง/ส่ง/ถอนกลับ: แผนก SA เท่านั้น (PRODUCTION_SALES_ONLY)
--   * รับ/ส่งกลับ/วางแผน/ออกใบสั่งงาน: แผนก PP เท่านั้น (PRODUCTION_PLANNING_ONLY)
--   * รหัสแผนก SA = ฝ่ายขาย ตามที่ผู้ใช้ยืนยัน (ชื่อเต็มของแผนกในตาราง departments ยังเป็นตัวย่อ) ถ้าเปลี่ยนแผนกให้แก้ที่ private.factory_order_actor
--   * ก่อนเปิดกับข้อมูลจริงต้องกำหนดตัวบทบาทจริง (ผู้ออกใบ/ผู้รับ) และช่องทางแจ้งเตือน เช่นเดียวกับ Item master/BOM
--
-- กฎที่ฐานข้อมูลบังคับ
--   * สินค้า: Item FG ที่ใช้งานอยู่ ผลิตเอง/ซื้อ-ผลิต · จำนวน > 0 ไม่เกิน 1,000,000,000 (ปัด 4 ทศนิยม) · กำหนดเสร็จไม่ก่อนวันนี้ (เวลา Asia/Bangkok) ไม่เกิน 10 ปี
--   * วางแผน: ต้องบันทึกผลสำรวจคงคลัง (survey_note) · BOM ต้องเป็นของสินค้านั้นและ approved · Routing ต้องเป็นของสินค้านั้นและไม่ obsolete
--     ตอนออกใบสั่งงานตรวจ BOM/Routing ซ้ำ (BOM อาจถูกเลิกใช้หลังวางแผน)
--   * ทุกขั้นล็อกแถว (for update) เทียบ version (PRODUCTION_ORDER_VERSION_CONFLICT) และตรวจสถานะปัจจุบันในธุรกรรมเดียวกับการเปลี่ยน
--     กันกดซ้ำ/ทับกัน แล้วเขียน factory_production_order_history (พร้อม snapshot) และ audit_logs (ผู้กระทำคือ admin ตัวจริง)
--   * ใบสั่งผลิตที่ระบบออกเลขเอง: ตัวนับแยกในโหมดทดสอบ (document_counters 'FACTORY-MO-TEST' / 'FACTORY-WO-TEST') เลขขึ้นต้น TEST- ไม่ปนเลขจริง
--     ใบสั่งผลิต TEST-MO-yy-nnn · ใบสั่งงาน TEST-WO-yy-nnn รีเซ็ตตอนล้างข้อมูลทดสอบฝ่ายโรงงาน
--   * โหมดทดสอบไม่ส่งอีเมล/LINE (กติกาข้อ 4) ฝ่ายวางแผนเห็นใบที่ส่งมาจากคิวหน้า "ใบสั่งผลิต-ฝ่ายวางแผน"
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_production_order_history ใช้แบบเดียวกับ factory_* ทุกตาราง (is_test จาก trigger, foreign key คู่
-- (id, is_test), RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables()) เพิ่มบัญชีทดสอบ SBX-SA-STAFF และ SBX-PP-STAFF
--
-- เริ่มจากนิยามล่าสุดของ app_factory_master_data (20261007010000) / app_sandbox_purge_factory (20261007010000) /
-- private.sandbox_unguarded_tables (20261007010000) แล้วเพิ่มเฉพาะส่วนของใบสั่งผลิต
--
-- Rollback (ตารางเหล่านี้มีแต่ข้อมูลทดสอบ): ปรับใบสั่งผลิตที่ยังไม่ผูก BOM/Routing (draft/submitted/planning) ให้ลบก่อน แล้ว
--   drop function public.app_factory_save_production_order(...), app_factory_submit_production_order(...), app_factory_withdraw_production_order(...),
--   app_factory_receive_production_order(...), app_factory_return_production_order(...), app_factory_plan_production_order(...),
--   app_factory_release_production_order(...); drop function private.factory_order_actor(text), factory_order_lock(uuid, integer),
--   factory_order_log(...), factory_order_snapshot(uuid), factory_order_json(...), next_factory_doc_number(text);
--   drop table factory_production_order_history; ลบคอลัมน์/constraint ที่เพิ่มใน factory_production_orders แล้วคืน not null ของ bom_id/routing_id
--   และ check status เดิม ('planned','released','in_progress','completed','cancelled'); ลบแถว employees SBX-SA-STAFF/SBX-PP-STAFF;
--   แล้ว create or replace app_factory_master_data / app_sandbox_purge_factory / private.sandbox_unguarded_tables ด้วยนิยามเดิมจาก 20261007010000
-- ============================================================================

-- 1. ขยาย factory_production_orders ------------------------------------------------
alter table public.factory_production_orders alter column bom_id drop not null;
alter table public.factory_production_orders alter column routing_id drop not null;

alter table public.factory_production_orders drop constraint if exists factory_production_orders_status_check;
alter table public.factory_production_orders
  add constraint factory_production_orders_status_check
  check (status in ('draft', 'submitted', 'planning', 'planned', 'released', 'in_progress', 'completed', 'cancelled'));
alter table public.factory_production_orders
  add constraint factory_production_orders_plan_links
  check (status in ('draft', 'submitted', 'planning', 'cancelled') or (bom_id is not null and routing_id is not null));

alter table public.factory_production_orders
  add column customer text not null default '' check (char_length(customer) <= 200),
  add column note text not null default '' check (char_length(note) <= 1000),
  add column survey_note text not null default '' check (char_length(survey_note) <= 1000),
  add column return_note text not null default '' check (char_length(return_note) <= 1000),
  add column work_order_no text check (work_order_no is null or work_order_no ~ '^[A-Z0-9_-]{2,40}$'),
  add column version integer not null default 1 check (version >= 1),
  add column created_by uuid references public.employees(id) on delete set null,
  add column updated_by uuid references public.employees(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add column submitted_by uuid references public.employees(id) on delete set null,
  add column submitted_at timestamptz,
  add column received_by uuid references public.employees(id) on delete set null,
  add column received_at timestamptz,
  add column planned_by uuid references public.employees(id) on delete set null,
  add column planned_at timestamptz,
  add column released_by uuid references public.employees(id) on delete set null,
  add column released_at timestamptz;

create unique index factory_production_orders_work_order_no_idx
  on public.factory_production_orders (is_test, work_order_no) where work_order_no is not null;

comment on column public.factory_production_orders.version is 'เพิ่มทุกครั้งที่แก้ไขหรือเปลี่ยนสถานะ ใช้กันบันทึก/เปลี่ยนสถานะทับของหน้าต่างที่เปิดค้าง';
comment on column public.factory_production_orders.survey_note is 'ผลสำรวจคงคลังที่ฝ่ายวางแผนบันทึกตอนวางแผน (ขั้น 2.2)';
comment on column public.factory_production_orders.return_note is 'เหตุผลที่ฝ่ายวางแผนส่งกลับ ล้างเมื่อส่งใหม่';
comment on column public.factory_production_orders.work_order_no is 'เลขที่ใบสั่งงานที่ออกให้ฝ่ายผลิต (ขั้น 2.4) NULL จนกว่าจะออก';

-- 2. ประวัติของใบสั่งผลิต ----------------------------------------------------------------
create table public.factory_production_order_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  order_id uuid not null,
  action text not null check (action in ('create', 'update', 'submit', 'withdraw', 'receive', 'return', 'plan', 'release')),
  version integer not null check (version >= 1),
  status_after text not null check (status_after in ('draft', 'submitted', 'planning', 'planned', 'released', 'in_progress', 'completed', 'cancelled')),
  note text not null default '' check (char_length(note) <= 1000),
  snapshot jsonb not null,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (order_id, is_test) references public.factory_production_orders(id, is_test)
);
create index factory_production_order_history_order_idx on public.factory_production_order_history(order_id, created_at desc);
comment on table public.factory_production_order_history is
  'ประวัติสร้าง/แก้/ส่ง/ถอนกลับ/รับ/ส่งกลับ/วางแผน/ออกใบสั่งงานของใบสั่งผลิต พร้อม snapshot เขียนในธุรกรรมเดียวกับการเปลี่ยน';

create trigger factory_production_order_history_sandbox_scope before insert or update or delete on public.factory_production_order_history
  for each row execute function private.factory_sandbox_scope();

revoke all on public.factory_production_order_history from anon, authenticated;
alter table public.factory_production_order_history enable row level security;
create policy factory_production_order_history_no_direct_access on public.factory_production_order_history
  for all to authenticated using (false) with check (false);
revoke all on sequence public.factory_production_order_history_id_seq from anon, authenticated;

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261007010000 ทุกชื่อ แล้วเพิ่ม factory_production_order_history)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history']
$$;

-- 3. บัญชีทดสอบของฝ่ายขายและฝ่ายวางแผน --------------------------------------------------
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.employee_no, 'ทดสอบ', v.last_name, lower(v.employee_no) || '@sandbox.local', v.last_name || ' (ทดสอบ)',
       d.id, r.id, false, true
from (values
  ('SBX-SA-STAFF', 'พนักงานขาย', 'SA', 'staff'),
  ('SBX-PP-STAFF', 'พนักงานวางแผน', 'PP', 'staff')
) as v(employee_no, last_name, dept_code, role_code)
join public.departments d on d.code = v.dept_code
join public.roles r on r.code = v.role_code
on conflict (employee_no) do nothing;

-- 4. ตัวช่วย (private) ---------------------------------------------------------------
-- ผู้ทำรายการ: persona ในโหมดทดสอบ (private.factory_actor) ที่ต้องอยู่แผนกที่ขั้นนั้นกำหนด
-- p_dept = 'SA' (ฝ่ายขาย) หรือ 'PP' (ฝ่ายวางแผน)
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
    raise exception '%', case p_dept when 'SA' then 'PRODUCTION_SALES_ONLY' else 'PRODUCTION_PLANNING_ONLY' end;
  end if;
  return v_actor;
end;
$$;
revoke all on function private.factory_order_actor(text) from public, anon, authenticated;

-- ล็อกใบสั่งผลิตของโหมดทดสอบแล้วเทียบ version (ใบจริงมองไม่เห็น = ไม่พบ)
create or replace function private.factory_order_lock(p_id uuid, p_version integer)
returns public.factory_production_orders
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.factory_production_orders%rowtype;
begin
  select * into v_order from public.factory_production_orders where id = p_id and is_test for update;
  if v_order.id is null then raise exception 'PRODUCTION_ORDER_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_order.version then raise exception 'PRODUCTION_ORDER_VERSION_CONFLICT'; end if;
  return v_order;
end;
$$;
revoke all on function private.factory_order_lock(uuid, integer) from public, anon, authenticated;

create or replace function private.factory_order_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'status', p.status, 'version', p.version,
    'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code, 'planned_qty', p.planned_qty,
    'due_date', p.due_date, 'customer', p.customer, 'note', p.note,
    'bom_revision', b.revision, 'routing_revision', r.revision,
    'survey_note', p.survey_note, 'return_note', p.return_note, 'work_order_no', p.work_order_no)
  from public.factory_production_orders p
  join public.factory_items i on i.id = p.item_id
  left join public.factory_boms b on b.id = p.bom_id
  left join public.factory_routings r on r.id = p.routing_id
  where p.id = p_id
$$;
revoke all on function private.factory_order_snapshot(uuid) from public, anon, authenticated;

-- ประวัติ + audit ในธุรกรรมเดียวกับการเปลี่ยน (ผู้กระทำใน audit คือ admin ตัวจริงเบื้องหลัง persona)
create or replace function private.factory_order_log(p_order_id uuid, p_action text, p_note text, p_actor public.employees)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.factory_production_orders%rowtype;
  v_admin_id uuid;
begin
  select * into v_order from public.factory_production_orders where id = p_order_id;
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.factory_production_order_history (order_id, action, version, status_after, note, snapshot, changed_by)
  values (v_order.id, p_action, v_order.version, v_order.status, coalesce(p_note, ''), private.factory_order_snapshot(v_order.id), p_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_PRODUCTION_' || upper(p_action), 'factory_production_orders', v_order.id::text,
          jsonb_build_object('code', v_order.code, 'version', v_order.version, 'status', v_order.status,
                             'is_test', v_order.is_test, 'persona_employee_no', p_actor.employee_no));
  return jsonb_build_object('id', v_order.id, 'version', v_order.version, 'code', v_order.code,
                            'status', v_order.status, 'work_order_no', v_order.work_order_no);
end;
$$;
revoke all on function private.factory_order_log(uuid, text, text, public.employees) from public, anon, authenticated;

-- เลขที่เอกสารของโหมดทดสอบ: ตัวนับแยก ขึ้นต้น TEST- (p_kind = 'MO' ใบสั่งผลิต | 'WO' ใบสั่งงาน) ตัวนับรีเซ็ตตอนล้างข้อมูลทดสอบ
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
  if p_kind not in ('MO', 'WO') then raise exception 'INVALID_FACTORY_DOC_KIND'; end if;
  insert into public.document_counters (department_code, year_key, last_number)
  values ('FACTORY-' || p_kind || '-TEST', v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1, updated_at = now()
  returning last_number into v_next;
  return 'TEST-' || p_kind || '-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;
revoke all on function private.next_factory_doc_number(text) from public, anon, authenticated;

-- 5. ฝ่ายขาย: สร้าง/แก้ฉบับร่าง · ส่ง · ถอนกลับ ------------------------------------------
create or replace function public.app_factory_save_production_order(
  p_id uuid, p_version integer, p_item_id uuid, p_planned_qty numeric, p_due_date date, p_customer text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_item public.factory_items%rowtype;
  v_customer text := btrim(coalesce(p_customer, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_qty numeric;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_new_id uuid;
begin
  v_actor := private.factory_order_actor('SA');
  if p_planned_qty is null or p_planned_qty = 'NaN'::numeric then raise exception 'INVALID_PRODUCTION_QTY'; end if;
  v_qty := round(p_planned_qty, 4);
  if v_qty <= 0 or v_qty > 1000000000 then raise exception 'INVALID_PRODUCTION_QTY'; end if;
  if p_due_date is null or p_due_date < v_today or p_due_date > v_today + 3650 then raise exception 'INVALID_PRODUCTION_DUE_DATE'; end if;
  if char_length(v_customer) > 200 then raise exception 'INVALID_PRODUCTION_CUSTOMER'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_PRODUCTION_NOTE'; end if;

  select * into v_item from public.factory_items where id = p_item_id and is_test;
  if v_item.id is null then raise exception 'PRODUCTION_PRODUCT_NOT_FOUND'; end if;
  if v_item.status <> 'active' or v_item.item_type <> 'FG' or v_item.procurement not in ('make', 'both') then
    raise exception 'PRODUCTION_ITEM_INVALID';
  end if;

  if p_id is null then
    insert into public.factory_production_orders (code, item_id, planned_qty, status, due_date, customer, note, created_by, updated_by)
    values (private.next_factory_doc_number('MO'), v_item.id, v_qty, 'draft', p_due_date, v_customer, v_note, v_actor.id, v_actor.id)
    returning id into v_new_id;
    return private.factory_order_log(v_new_id, 'create', '', v_actor);
  end if;

  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status <> 'draft' then raise exception 'PRODUCTION_ORDER_NOT_EDITABLE'; end if;
  update public.factory_production_orders
  set item_id = v_item.id, planned_qty = v_qty, due_date = p_due_date, customer = v_customer, note = v_note,
      version = v_order.version + 1, updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'update', '', v_actor);
end;
$$;

create or replace function public.app_factory_submit_production_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
begin
  v_actor := private.factory_order_actor('SA');
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status <> 'draft' then raise exception 'PRODUCTION_ORDER_NOT_DRAFT'; end if;
  if not exists (select 1 from public.factory_items i where i.id = v_order.item_id and i.status = 'active') then
    raise exception 'PRODUCTION_ITEM_INVALID';
  end if;
  update public.factory_production_orders
  set status = 'submitted', version = v_order.version + 1, submitted_by = v_actor.id, submitted_at = now(),
      return_note = '', updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'submit', '', v_actor);
end;
$$;

-- ถอนกลับมาแก้ได้เฉพาะก่อนที่ฝ่ายวางแผนจะรับ
create or replace function public.app_factory_withdraw_production_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
begin
  v_actor := private.factory_order_actor('SA');
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status <> 'submitted' then raise exception 'PRODUCTION_ORDER_NOT_SUBMITTED'; end if;
  update public.factory_production_orders
  set status = 'draft', version = v_order.version + 1, submitted_by = null, submitted_at = null,
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'withdraw', '', v_actor);
end;
$$;

-- 6. ฝ่ายวางแผน: รับ · ส่งกลับ · วางแผน · ออกใบสั่งงาน --------------------------------------
create or replace function public.app_factory_receive_production_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
begin
  v_actor := private.factory_order_actor('PP');
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status <> 'submitted' then raise exception 'PRODUCTION_ORDER_NOT_SUBMITTED'; end if;
  update public.factory_production_orders
  set status = 'planning', version = v_order.version + 1, received_by = v_actor.id, received_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'receive', '', v_actor);
end;
$$;

-- ส่งกลับฝ่ายขายแก้ (ต้องระบุเหตุผล) ได้ทั้งตอนรอรับและตอนกำลังวางแผน ล้างผลวางแผนที่ผูกไว้
create or replace function public.app_factory_return_production_order(p_id uuid, p_version integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_actor := private.factory_order_actor('PP');
  if v_note = '' then raise exception 'PRODUCTION_RETURN_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_PRODUCTION_NOTE'; end if;
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status not in ('submitted', 'planning') then raise exception 'PRODUCTION_ORDER_NOT_RECEIVABLE'; end if;
  update public.factory_production_orders
  set status = 'draft', version = v_order.version + 1, return_note = v_note,
      submitted_by = null, submitted_at = null, received_by = null, received_at = null,
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'return', v_note, v_actor);
end;
$$;

-- วางแผน: บันทึกผลสำรวจคงคลัง + ผูก BOM ที่อนุมัติแล้ว + Routing (วางแผนซ้ำได้ขณะ planning/planned)
create or replace function public.app_factory_plan_production_order(
  p_id uuid, p_version integer, p_bom_id uuid, p_routing_id uuid, p_survey_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_survey text := btrim(coalesce(p_survey_note, ''));
begin
  v_actor := private.factory_order_actor('PP');
  if v_survey = '' then raise exception 'PRODUCTION_SURVEY_REQUIRED'; end if;
  if char_length(v_survey) > 1000 then raise exception 'INVALID_PRODUCTION_NOTE'; end if;
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status not in ('planning', 'planned') then raise exception 'PRODUCTION_ORDER_NOT_PLANNING'; end if;
  if not exists (select 1 from public.factory_boms b
                 where b.id = p_bom_id and b.is_test and b.item_id = v_order.item_id and b.status = 'approved') then
    raise exception 'PRODUCTION_BOM_INVALID';
  end if;
  if not exists (select 1 from public.factory_routings r
                 where r.id = p_routing_id and r.is_test and r.item_id = v_order.item_id and r.status <> 'obsolete') then
    raise exception 'PRODUCTION_ROUTING_INVALID';
  end if;
  update public.factory_production_orders
  set status = 'planned', bom_id = p_bom_id, routing_id = p_routing_id, survey_note = v_survey,
      version = v_order.version + 1, planned_by = v_actor.id, planned_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'plan', v_survey, v_actor);
end;
$$;

-- ออกใบสั่งงานให้ฝ่ายผลิต: ตรวจ BOM/Routing ซ้ำ (BOM อาจถูกเลิกใช้หลังวางแผน) แล้วออกเลขที่ใบสั่งงาน
create or replace function public.app_factory_release_production_order(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
begin
  v_actor := private.factory_order_actor('PP');
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status <> 'planned' then raise exception 'PRODUCTION_ORDER_NOT_PLANNED'; end if;
  if not exists (select 1 from public.factory_boms b
                 where b.id = v_order.bom_id and b.is_test and b.item_id = v_order.item_id and b.status = 'approved') then
    raise exception 'PRODUCTION_BOM_INVALID';
  end if;
  if not exists (select 1 from public.factory_routings r
                 where r.id = v_order.routing_id and r.is_test and r.item_id = v_order.item_id and r.status <> 'obsolete') then
    raise exception 'PRODUCTION_ROUTING_INVALID';
  end if;
  update public.factory_production_orders
  set status = 'released', work_order_no = private.next_factory_doc_number('WO'),
      version = v_order.version + 1, released_by = v_actor.id, released_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'release', '', v_actor);
end;
$$;

-- 7. อ่านข้อมูลทั้งหมดของโมดูล: ขยายส่วน production และเพิ่ม production_history -------------------
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
      ) h), '[]'::jsonb)
  );
end;
$$;

-- 8. ล้างข้อมูลทดสอบของฝ่ายโรงงาน: เพิ่มประวัติใบสั่งผลิตและตัวนับเลขเอกสาร ---------------------
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
  delete from public.document_counters where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;

revoke all on function public.app_factory_save_production_order(uuid, integer, uuid, numeric, date, text, text) from public, anon;
revoke all on function public.app_factory_submit_production_order(uuid, integer) from public, anon;
revoke all on function public.app_factory_withdraw_production_order(uuid, integer) from public, anon;
revoke all on function public.app_factory_receive_production_order(uuid, integer) from public, anon;
revoke all on function public.app_factory_return_production_order(uuid, integer, text) from public, anon;
revoke all on function public.app_factory_plan_production_order(uuid, integer, uuid, uuid, text) from public, anon;
revoke all on function public.app_factory_release_production_order(uuid, integer) from public, anon;
grant execute on function public.app_factory_save_production_order(uuid, integer, uuid, numeric, date, text, text) to authenticated;
grant execute on function public.app_factory_submit_production_order(uuid, integer) to authenticated;
grant execute on function public.app_factory_withdraw_production_order(uuid, integer) to authenticated;
grant execute on function public.app_factory_receive_production_order(uuid, integer) to authenticated;
grant execute on function public.app_factory_return_production_order(uuid, integer, text) to authenticated;
grant execute on function public.app_factory_plan_production_order(uuid, integer, uuid, uuid, text) to authenticated;
grant execute on function public.app_factory_release_production_order(uuid, integer) to authenticated;
