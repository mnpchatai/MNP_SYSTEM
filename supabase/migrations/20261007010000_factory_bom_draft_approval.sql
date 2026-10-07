-- ============================================================================
-- ฝ่ายโรงงาน: สร้างโครงสร้างสินค้า (BOM) ใหม่ → ฉบับร่าง → ส่งขออนุมัติ → admin อนุมัติ/ไม่อนุมัติ
--
-- ต่อจาก 20261006050000_factory_item_master.sql ซึ่งมี BOM แบบอ่านอย่างเดียว (README ระบุว่า "สร้าง/แก้ BOM ยังไม่เปิด
-- ต้องมีกฎห้ามสูตรวนซ้ำ ตรวจหน่วย และอนุมัติ Revision ก่อน") migration นี้ทำครบสามข้อนั้น
--
-- ขั้นตอนของโครงสร้างสินค้า (factory_boms.status)
--   draft ──ส่งขออนุมัติ──▶ pending_approval ──อนุมัติ──▶ approved ──(Revision ใหม่อนุมัติ)──▶ obsolete
--     ▲                          │
--     └──── ถอนกลับ / ไม่อนุมัติ ◀┘   (ไม่อนุมัติต้องระบุเหตุผล เหตุผลเก็บที่ decision_note และประวัติ)
--   * แก้ไขเนื้อหาได้เฉพาะ draft ส่วน pending_approval / approved / obsolete ห้ามแก้ (ต้องถอนกลับเป็นฉบับร่างก่อน)
--   * Item หนึ่งมีฉบับที่ยังเปิดอยู่ (draft หรือ pending_approval) ได้ครั้งละ 1 ฉบับ และมีฉบับ approved ได้ 1 ฉบับ
--     (unique index บางส่วน) เมื่ออนุมัติฉบับใหม่ ฉบับ approved เดิมของ Item เดียวกันเป็น obsolete ในธุรกรรมเดียวกัน
--   * Revision เป็นตัวอักษร A, B, C… ระบบกำหนดให้เอง (ตัวแรกที่ Item นั้นยังไม่เคยใช้) ผู้ใช้กรอกเองไม่ได้
--
-- กฎของโครงสร้างที่ฐานข้อมูลบังคับ (หน้าเว็บตรวจซ้ำเพื่อความสะดวกเท่านั้น)
--   * สินค้าหลัก: Item ที่ใช้งานอยู่ ประเภท WIP/FG วิธีจัดหา ผลิตเอง/ซื้อ-ผลิต (BOM_PARENT_INVALID)
--   * ส่วนประกอบ: Item ที่ใช้งานอยู่ ไม่ซ้ำในสูตรเดียวกัน (BOM_DUPLICATE_COMPONENT) ไม่ใช่สินค้าหลักเอง (BOM_SELF_REFERENCE)
--   * ห้ามสูตรวนซ้ำ (BOM_CIRCULAR): สินค้าหลักต้องไม่ถูกอ้างถึงย้อนกลับผ่านสูตรอื่นที่ยังไม่เลิกใช้ ตรวจตอนบันทึก ส่งขออนุมัติ
--     และอนุมัติ โดยล็อก advisory ระดับธุรกรรมกัน 2 ธุรกรรมสร้างวงจากคนละฝั่งพร้อมกัน
--   * หน่วย: ปริมาณของแต่ละบรรทัดเป็น "หน่วยนับฐานของส่วนประกอบนั้น" และผลผลิตเป็น "หน่วยนับฐานของสินค้าหลัก" เสมอ
--     (หน่วยฐานของ Item ล็อกหลังสร้างตาม ITEM_LOCKED_FIELDS) จึงไม่มีการแปลงหน่วยในสูตร หน้าเว็บแสดงหน่วยกำกับทุกบรรทัด
--   * ปริมาณ/ผลผลิต > 0 (ปัดเป็น 4 ทศนิยมก่อนตรวจ) ≤ 1,000,000,000 · เผื่อสูญเสีย 0 ≤ x < 100 · ไม่เกิน 100 บรรทัด
--   * ส่งขออนุมัติต้องมีอย่างน้อย 1 บรรทัด (ฉบับร่างเว้นว่างได้เพื่อบันทึกระหว่างทาง)
--
-- สิทธิ์ (ยังเป็นโหมดทดสอบอย่างเดียวเหมือน Item master — ทุก RPC เรียก private.factory_actor() ก่อน)
--   * สร้าง/แก้/ส่งขออนุมัติ/ถอนกลับ: persona ใดก็ได้ในโหมดทดสอบ (เข้าโหมดทดสอบได้เฉพาะ admin)
--   * อนุมัติ/ไม่อนุมัติ: เฉพาะผู้ดูแลระบบตัวจริงที่อยู่เบื้องหลัง persona (private.sandbox_admin()) บันทึกเป็นผู้อนุมัติ
--     ไม่ใช่ persona และห้ามอนุมัติใบที่ตัวเองส่ง (BOM_SELF_APPROVAL — ปกติผู้ส่งเป็น persona จึงไม่ชน แต่กันไว้ที่ฐานข้อมูล)
--   * การอนุมัติผูกกับ version ที่ผู้อนุมัติเห็น: ถ้าใบถูกถอน/แก้/ส่งใหม่ระหว่างนั้น = BOM_VERSION_CONFLICT ต้องเปิดดูใหม่
--   * โหมดทดสอบไม่ส่งแจ้งเตือน (กติกาข้อ 4) การ "ส่งให้ admin" จึงเห็นในหน้า โครงสร้างสินค้า-อนุมัติ และแบนเนอร์ในหน้าโครงสร้าง
--     ไม่มีอีเมล/LINE ก่อนเปิดใช้กับข้อมูลจริงต้องกำหนดผู้อนุมัติจริงและช่องทางแจ้งเตือน (ดู README)
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_bom_history ใช้ pattern เดียวกับ factory_* ทุกตาราง (is_test ที่ trigger กำหนด
-- foreign key คู่ (id, is_test) RLS deny-all ถอนสิทธิ์ตรง ลงทะเบียนใน private.sandbox_unguarded_tables())
-- ทุกการเปลี่ยนสถานะเขียนประวัติ (factory_bom_history พร้อม snapshot) และ audit_logs ในธุรกรรมเดียวกับการเปลี่ยน
--
-- เริ่มจากนิยามล่าสุดของ app_factory_master_data / app_sandbox_purge_factory / private.sandbox_unguarded_tables
-- (20261006050000) แล้วเพิ่มเฉพาะส่วนของ BOM
--
-- Rollback (ตารางเหล่านี้มีแต่ข้อมูลทดสอบ): drop function public.app_factory_save_bom_draft(...),
--   public.app_factory_submit_bom(...), public.app_factory_withdraw_bom(...), public.app_factory_decide_bom(...),
--   private.factory_bom_snapshot(uuid), private.factory_bom_check_graph(boolean, uuid, uuid, uuid[]),
--   private.factory_assert_bom_parent(uuid), private.factory_bom_revalidate(uuid); drop table factory_bom_history;
--   drop index factory_boms_one_open_revision, factory_boms_one_approved_revision; ลบ constraint/คอลัมน์ที่เพิ่มใน factory_boms
--   (ต้องเปลี่ยน pending_approval กลับเป็น draft ก่อน แล้วคืน check เดิม status in ('draft','approved','obsolete'));
--   แล้ว create or replace app_factory_master_data / app_sandbox_purge_factory / private.sandbox_unguarded_tables
--   ด้วยนิยามเดิมจาก 20261006050000_factory_item_master.sql
-- ============================================================================

-- 1. ขยาย factory_boms ------------------------------------------------------------
alter table public.factory_boms drop constraint if exists factory_boms_status_check;
alter table public.factory_boms
  add constraint factory_boms_status_check check (status in ('draft', 'pending_approval', 'approved', 'obsolete'));

alter table public.factory_boms
  add column note text not null default '' check (char_length(note) <= 1000),
  add column version integer not null default 1 check (version >= 1),
  add column created_by uuid references public.employees(id) on delete set null,
  add column updated_by uuid references public.employees(id) on delete set null,
  add column updated_at timestamptz not null default now(),
  add column submitted_by uuid references public.employees(id) on delete set null,
  add column submitted_at timestamptz,
  add column decided_by uuid references public.employees(id) on delete set null,
  add column decided_at timestamptz,
  add column decision_note text not null default '' check (char_length(decision_note) <= 1000);

alter table public.factory_boms
  add constraint factory_boms_effective_date_range check (effective_date between date '2000-01-01' and date '2100-12-31'),
  add constraint factory_boms_pending_has_submit_time check (status <> 'pending_approval' or submitted_at is not null),
  add constraint factory_boms_approved_has_decision_time check (status <> 'approved' or decided_at is not null);

create unique index factory_boms_one_open_revision on public.factory_boms (item_id)
  where status in ('draft', 'pending_approval');
create unique index factory_boms_one_approved_revision on public.factory_boms (item_id)
  where status = 'approved';

comment on column public.factory_boms.version is 'เพิ่มทุกครั้งที่แก้ไขหรือเปลี่ยนสถานะ ใช้กันบันทึก/อนุมัติทับของหน้าต่างที่เปิดค้าง';
comment on column public.factory_boms.decided_by is 'ผู้ดูแลระบบตัวจริงที่อนุมัติ/ไม่อนุมัติ (ไม่ใช่ persona ของโหมดทดสอบ)';
comment on column public.factory_boms.decision_note is 'เหตุผลล่าสุดที่ไม่อนุมัติ/หมายเหตุการอนุมัติ ล้างเมื่อส่งขออนุมัติใหม่ (ประวัติยังอยู่ใน factory_bom_history)';

-- 2. ประวัติการเปลี่ยนแปลงของ BOM -----------------------------------------------------
create table public.factory_bom_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  bom_id uuid not null,
  action text not null check (action in ('create', 'update', 'submit', 'withdraw', 'approve', 'reject', 'obsolete')),
  version integer not null check (version >= 1),
  status_after text not null check (status_after in ('draft', 'pending_approval', 'approved', 'obsolete')),
  note text not null default '' check (char_length(note) <= 1000),
  snapshot jsonb not null,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (bom_id, is_test) references public.factory_boms(id, is_test)
);
create index factory_bom_history_bom_idx on public.factory_bom_history(bom_id, created_at desc);
comment on table public.factory_bom_history is
  'ประวัติสร้าง/แก้ไข/ส่งอนุมัติ/ถอนกลับ/อนุมัติ/ไม่อนุมัติ/เลิกใช้ของ BOM พร้อม snapshot หัวสูตรและบรรทัด เขียนในธุรกรรมเดียวกับการเปลี่ยน';

create trigger factory_bom_history_sandbox_scope before insert or update or delete on public.factory_bom_history
  for each row execute function private.factory_sandbox_scope();

revoke all on public.factory_bom_history from anon, authenticated;
alter table public.factory_bom_history enable row level security;
create policy factory_bom_history_no_direct_access on public.factory_bom_history
  for all to authenticated using (false) with check (false);
revoke all on sequence public.factory_bom_history_id_seq from anon, authenticated;

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261006050000 ทุกชื่อ แล้วเพิ่ม factory_bom_history)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history']
$$;

-- 3. ตัวช่วย (private) ---------------------------------------------------------------
-- snapshot หัวสูตร + บรรทัด ใช้ในประวัติ
create or replace function private.factory_bom_snapshot(p_bom_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', b.id, 'item_code', i.code, 'item_name', i.name, 'revision', b.revision, 'status', b.status,
    'version', b.version, 'output_qty', b.output_qty, 'unit_code', i.unit_code,
    'effective_date', b.effective_date, 'note', b.note,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'line_no', l.line_no, 'component_code', c.code, 'component_name', c.name, 'unit_code', c.unit_code,
          'quantity', l.quantity, 'scrap_percent', l.scrap_percent) order by l.line_no)
      from public.factory_bom_lines l join public.factory_items c on c.id = l.component_id
      where l.bom_id = b.id), '[]'::jsonb))
  from public.factory_boms b join public.factory_items i on i.id = b.item_id
  where b.id = p_bom_id
$$;
revoke all on function private.factory_bom_snapshot(uuid) from public, anon, authenticated;

-- สินค้าหลักของ BOM ต้องเป็น Item ที่ใช้งานอยู่ ประเภท WIP/FG และผลิตเองได้
create or replace function private.factory_assert_bom_parent(p_item_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item public.factory_items%rowtype;
begin
  select * into v_item from public.factory_items where id = p_item_id;
  if v_item.id is null then
    raise exception 'BOM_PARENT_NOT_FOUND';
  end if;
  if v_item.status <> 'active' or v_item.item_type not in ('WIP', 'FG') or v_item.procurement not in ('make', 'both') then
    raise exception 'BOM_PARENT_INVALID';
  end if;
end;
$$;
revoke all on function private.factory_assert_bom_parent(uuid) from public, anon, authenticated;

-- ห้ามสูตรวนซ้ำ: เริ่มจากส่วนประกอบแล้วไล่ตามสูตรที่ยังไม่เลิกใช้ (ร่าง/รออนุมัติ/อนุมัติ) ถ้าไปถึงสินค้าหลัก = วงจร
-- p_bom_id = สูตรที่กำลังตรวจ (ไม่นับบรรทัดเดิมของมัน เพราะ p_components คือบรรทัดใหม่) UNION ตัดตัวซ้ำจึงจบเสมอแม้ข้อมูลเดิมมีวง
create or replace function private.factory_bom_check_graph(p_test boolean, p_bom_id uuid, p_parent uuid, p_components uuid[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    with recursive reach(item_id) as (
      select c from unnest(p_components) as c
      union
      select l.component_id
      from reach r
      join public.factory_boms b on b.item_id = r.item_id and b.is_test = p_test
           and b.status in ('draft', 'pending_approval', 'approved')
           and b.id is distinct from p_bom_id
      join public.factory_bom_lines l on l.bom_id = b.id
    )
    select 1 from reach where item_id = p_parent
  ) then
    raise exception 'BOM_CIRCULAR';
  end if;
end;
$$;
revoke all on function private.factory_bom_check_graph(boolean, uuid, uuid, uuid[]) from public, anon, authenticated;

-- ตรวจ BOM ที่บันทึกไว้แล้วอีกครั้งก่อนส่งขออนุมัติ/อนุมัติ: Item อาจถูกหยุดใช้งาน หรือมีสูตรอื่นเพิ่มวงจรหลังบันทึก
create or replace function private.factory_bom_revalidate(p_bom_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bom public.factory_boms%rowtype;
  v_components uuid[];
begin
  select * into v_bom from public.factory_boms where id = p_bom_id;
  perform private.factory_assert_bom_parent(v_bom.item_id);
  select coalesce(array_agg(l.component_id order by l.line_no), '{}'::uuid[]) into v_components
  from public.factory_bom_lines l where l.bom_id = p_bom_id;
  if cardinality(v_components) = 0 then
    raise exception 'BOM_NO_LINES';
  end if;
  if exists (select 1 from public.factory_bom_lines l join public.factory_items c on c.id = l.component_id
             where l.bom_id = p_bom_id and c.status <> 'active') then
    raise exception 'BOM_COMPONENT_INACTIVE';
  end if;
  perform private.factory_bom_check_graph(v_bom.is_test, v_bom.id, v_bom.item_id, v_components);
end;
$$;
revoke all on function private.factory_bom_revalidate(uuid) from public, anon, authenticated;

-- 4. สร้าง/แก้ไขฉบับร่าง ---------------------------------------------------------------
-- p_id ว่าง = สร้างใหม่ (ระบบกำหนด Revision) มีค่า = แก้ฉบับร่างเดิม (ต้องส่ง p_version ที่เปิดฟอร์มมา)
-- p_lines = [{"component_id": uuid, "quantity": n, "scrap_percent": n}, ...] แทนที่บรรทัดเดิมทั้งชุด
create or replace function public.app_factory_save_bom_draft(
  p_id uuid,
  p_version integer,
  p_item_id uuid,
  p_output_qty numeric,
  p_effective_date date,
  p_note text,
  p_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_admin_id uuid;
  v_test boolean := true;  -- factory_actor ยืนยันแล้วว่าอยู่ในโหมดทดสอบ
  v_note text := btrim(coalesce(p_note, ''));
  v_output numeric;
  v_item public.factory_items%rowtype;
  v_component public.factory_items%rowtype;
  v_old public.factory_boms%rowtype;
  v_new public.factory_boms%rowtype;
  v_line jsonb;
  v_ids uuid[] := '{}';
  v_qtys numeric[] := '{}';
  v_scraps numeric[] := '{}';
  v_id uuid;
  v_qty numeric;
  v_scrap numeric;
  v_revision text;
  v_constraint text;
begin
  v_actor := private.factory_actor();
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();

  -- ค่าที่รับเข้ามา: ตรวจทุกช่องก่อนแตะข้อมูล (numeric รับ NaN/Infinity ได้ จึงตรวจตรงๆ)
  if p_output_qty is null or p_output_qty = 'NaN'::numeric then raise exception 'INVALID_BOM_OUTPUT_QTY'; end if;
  v_output := round(p_output_qty, 4);
  if v_output <= 0 or v_output > 1000000000 then raise exception 'INVALID_BOM_OUTPUT_QTY'; end if;
  if p_effective_date is null or p_effective_date not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'INVALID_BOM_EFFECTIVE_DATE';
  end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_BOM_NOTE'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'INVALID_BOM_LINES'; end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'INVALID_BOM_LINES'; end if;

  -- ล็อกการแก้ BOM ทั้งระบบทีละธุรกรรม เพื่อให้การตรวจวงจรเห็นสภาพล่าสุดเสมอ
  perform pg_advisory_xact_lock(7261007);

  select * into v_item from public.factory_items where id = p_item_id and is_test = v_test;
  if v_item.id is null then
    raise exception 'BOM_PARENT_NOT_FOUND';
  end if;
  perform private.factory_assert_bom_parent(v_item.id);

  if p_id is null then
    if exists (select 1 from public.factory_boms
               where item_id = v_item.id and is_test = v_test and status in ('draft', 'pending_approval')) then
      raise exception 'BOM_OPEN_REVISION_EXISTS';
    end if;
  else
    select * into v_old from public.factory_boms where id = p_id and is_test = v_test for update;
    if v_old.id is null then
      raise exception 'BOM_NOT_FOUND';
    end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'BOM_VERSION_CONFLICT';
    end if;
    if v_old.status <> 'draft' then
      raise exception 'BOM_NOT_EDITABLE';
    end if;
    if v_old.item_id <> v_item.id then
      raise exception 'BOM_LOCKED_FIELDS';
    end if;
  end if;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'INVALID_BOM_LINE'; end if;
    begin
      v_id := (v_line ->> 'component_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'INVALID_BOM_LINE';
    end;
    if v_id is null then raise exception 'INVALID_BOM_LINE'; end if;

    begin
      v_qty := (v_line ->> 'quantity')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_BOM_LINE_QUANTITY';
    end;
    if v_qty is null or v_qty = 'NaN'::numeric then raise exception 'INVALID_BOM_LINE_QUANTITY'; end if;
    v_qty := round(v_qty, 4);
    if v_qty <= 0 or v_qty > 1000000000 then raise exception 'INVALID_BOM_LINE_QUANTITY'; end if;

    begin
      v_scrap := coalesce(nullif(btrim(v_line ->> 'scrap_percent'), ''), '0')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_BOM_LINE_SCRAP';
    end;
    if v_scrap = 'NaN'::numeric then raise exception 'INVALID_BOM_LINE_SCRAP'; end if;
    v_scrap := round(v_scrap, 2);
    if v_scrap < 0 or v_scrap >= 100 then raise exception 'INVALID_BOM_LINE_SCRAP'; end if;

    if v_id = v_item.id then raise exception 'BOM_SELF_REFERENCE'; end if;
    if v_id = any (v_ids) then raise exception 'BOM_DUPLICATE_COMPONENT'; end if;
    select * into v_component from public.factory_items where id = v_id and is_test = v_test;
    if v_component.id is null then raise exception 'BOM_COMPONENT_NOT_FOUND'; end if;
    if v_component.status <> 'active' then raise exception 'BOM_COMPONENT_INACTIVE'; end if;

    v_ids := v_ids || v_id;
    v_qtys := v_qtys || v_qty;
    v_scraps := v_scraps || v_scrap;
  end loop;

  perform private.factory_bom_check_graph(v_test, v_old.id, v_item.id, v_ids);

  if p_id is null then
    -- Revision: ตัวอักษรแรก A–Z ที่ Item นี้ยังไม่เคยใช้ (ไม่ลบ BOM จึงไม่วนกลับมาใช้ซ้ำ)
    select chr(64 + n) into v_revision
    from generate_series(1, 26) n
    where not exists (select 1 from public.factory_boms b where b.item_id = v_item.id and b.revision = chr(64 + n))
    order by n limit 1;
    if v_revision is null then
      raise exception 'BOM_REVISION_EXHAUSTED';
    end if;
    insert into public.factory_boms (item_id, revision, output_qty, status, effective_date, note, created_by, updated_by)
    values (v_item.id, v_revision, v_output, 'draft', p_effective_date, v_note, v_actor.id, v_actor.id)
    returning * into v_new;
  else
    update public.factory_boms
    set output_qty = v_output, effective_date = p_effective_date, note = v_note,
        version = v_old.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_old.id
    returning * into v_new;
    delete from public.factory_bom_lines where bom_id = v_new.id;
  end if;

  insert into public.factory_bom_lines (bom_id, line_no, component_id, quantity, scrap_percent)
  select v_new.id, t.n::integer, t.component_id, t.quantity, t.scrap_percent
  from unnest(v_ids, v_qtys, v_scraps) with ordinality as t(component_id, quantity, scrap_percent, n);

  insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
  values (v_new.id, case when p_id is null then 'create' else 'update' end, v_new.version, v_new.status, v_note,
          private.factory_bom_snapshot(v_new.id), v_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, case when p_id is null then 'FACTORY_BOM_CREATE' else 'FACTORY_BOM_UPDATE' end,
          'factory_boms', v_new.id::text,
          jsonb_build_object('item_code', v_item.code, 'revision', v_new.revision, 'version', v_new.version,
                             'lines', cardinality(v_ids), 'is_test', v_new.is_test,
                             'persona_employee_no', v_actor.employee_no));
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'revision', v_new.revision,
                            'status', v_new.status, 'code', v_item.code);
exception
  when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'factory_boms_one_open_revision' then
      raise exception 'BOM_OPEN_REVISION_EXISTS';
    end if;
    raise;
end;
$$;

-- 5. ส่งขออนุมัติ / ถอนกลับ ---------------------------------------------------------------
create or replace function public.app_factory_submit_bom(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_admin_id uuid;
  v_test boolean := true;
  v_bom public.factory_boms%rowtype;
  v_new public.factory_boms%rowtype;
  v_code text;
begin
  v_actor := private.factory_actor();
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  perform pg_advisory_xact_lock(7261007);

  select * into v_bom from public.factory_boms where id = p_id and is_test = v_test for update;
  if v_bom.id is null then raise exception 'BOM_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_bom.version then raise exception 'BOM_VERSION_CONFLICT'; end if;
  if v_bom.status <> 'draft' then raise exception 'BOM_NOT_DRAFT'; end if;
  perform private.factory_bom_revalidate(v_bom.id);

  update public.factory_boms
  set status = 'pending_approval', version = v_bom.version + 1, submitted_by = v_actor.id, submitted_at = now(),
      decided_by = null, decided_at = null, decision_note = '', updated_by = v_actor.id, updated_at = now()
  where id = v_bom.id
  returning * into v_new;
  select code into v_code from public.factory_items where id = v_new.item_id;

  insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
  values (v_new.id, 'submit', v_new.version, v_new.status, '', private.factory_bom_snapshot(v_new.id), v_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_BOM_SUBMIT', 'factory_boms', v_new.id::text,
          jsonb_build_object('item_code', v_code, 'revision', v_new.revision, 'version', v_new.version,
                             'is_test', v_new.is_test, 'persona_employee_no', v_actor.employee_no));
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'revision', v_new.revision,
                            'status', v_new.status, 'code', v_code);
end;
$$;

-- ถอนกลับมาเป็นฉบับร่างเพื่อแก้ไข (ก่อนที่ admin จะตัดสิน)
create or replace function public.app_factory_withdraw_bom(p_id uuid, p_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_admin_id uuid;
  v_test boolean := true;
  v_bom public.factory_boms%rowtype;
  v_new public.factory_boms%rowtype;
  v_code text;
begin
  v_actor := private.factory_actor();
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  perform pg_advisory_xact_lock(7261007);

  select * into v_bom from public.factory_boms where id = p_id and is_test = v_test for update;
  if v_bom.id is null then raise exception 'BOM_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_bom.version then raise exception 'BOM_VERSION_CONFLICT'; end if;
  if v_bom.status <> 'pending_approval' then raise exception 'BOM_NOT_PENDING'; end if;

  update public.factory_boms
  set status = 'draft', version = v_bom.version + 1, submitted_by = null, submitted_at = null,
      updated_by = v_actor.id, updated_at = now()
  where id = v_bom.id
  returning * into v_new;
  select code into v_code from public.factory_items where id = v_new.item_id;

  insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
  values (v_new.id, 'withdraw', v_new.version, v_new.status, '', private.factory_bom_snapshot(v_new.id), v_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_BOM_WITHDRAW', 'factory_boms', v_new.id::text,
          jsonb_build_object('item_code', v_code, 'revision', v_new.revision, 'version', v_new.version,
                             'is_test', v_new.is_test, 'persona_employee_no', v_actor.employee_no));
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'revision', v_new.revision,
                            'status', v_new.status, 'code', v_code);
end;
$$;

-- 6. อนุมัติ / ไม่อนุมัติ (ผู้ดูแลระบบตัวจริงเท่านั้น) ---------------------------------------
-- approve: ฉบับ approved เดิมของ Item เดียวกันเป็น obsolete ในธุรกรรมเดียวกัน
-- reject: กลับเป็น draft พร้อมเหตุผล (ต้องระบุ) ผู้ส่งแก้แล้วส่งใหม่ได้
create or replace function public.app_factory_decide_bom(p_id uuid, p_version integer, p_decision text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_test boolean := true;
  v_note text := btrim(coalesce(p_note, ''));
  v_bom public.factory_boms%rowtype;
  v_prev public.factory_boms%rowtype;
  v_new public.factory_boms%rowtype;
  v_code text;
begin
  perform private.factory_actor();           -- ต้องอยู่ในโหมดทดสอบ (FACTORY_TEST_MODE_ONLY)
  v_admin := private.sandbox_admin();        -- ต้องเป็นผู้ดูแลระบบตัวจริง ไม่ใช่ persona (NOT_AUTHORIZED)

  if p_decision is null or p_decision not in ('approve', 'reject') then raise exception 'INVALID_BOM_DECISION'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_BOM_NOTE'; end if;
  if p_decision = 'reject' and v_note = '' then raise exception 'BOM_REJECT_NOTE_REQUIRED'; end if;
  perform pg_advisory_xact_lock(7261007);

  select * into v_bom from public.factory_boms where id = p_id and is_test = v_test for update;
  if v_bom.id is null then raise exception 'BOM_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_bom.version then raise exception 'BOM_VERSION_CONFLICT'; end if;
  if v_bom.status <> 'pending_approval' then raise exception 'BOM_NOT_PENDING'; end if;
  if v_bom.submitted_by = v_admin.id then raise exception 'BOM_SELF_APPROVAL'; end if;
  select code into v_code from public.factory_items where id = v_bom.item_id;

  if p_decision = 'approve' then
    perform private.factory_bom_revalidate(v_bom.id);
    select * into v_prev from public.factory_boms
    where item_id = v_bom.item_id and is_test = v_test and status = 'approved' and id <> v_bom.id for update;
    if v_prev.id is not null then
      update public.factory_boms
      set status = 'obsolete', version = v_prev.version + 1, updated_by = v_admin.id, updated_at = now()
      where id = v_prev.id
      returning * into v_prev;
      insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
      values (v_prev.id, 'obsolete', v_prev.version, v_prev.status, 'แทนที่ด้วย Rev. ' || v_bom.revision,
              private.factory_bom_snapshot(v_prev.id), v_admin.id);
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (v_admin.id, 'FACTORY_BOM_OBSOLETE', 'factory_boms', v_prev.id::text,
              jsonb_build_object('item_code', v_code, 'revision', v_prev.revision, 'superseded_by', v_bom.revision,
                                 'is_test', v_prev.is_test));
    end if;
    update public.factory_boms
    set status = 'approved', version = v_bom.version + 1, decided_by = v_admin.id, decided_at = now(),
        decision_note = v_note, updated_by = v_admin.id, updated_at = now()
    where id = v_bom.id
    returning * into v_new;
  else
    update public.factory_boms
    set status = 'draft', version = v_bom.version + 1, decided_by = v_admin.id, decided_at = now(),
        decision_note = v_note, updated_by = v_admin.id, updated_at = now()
    where id = v_bom.id
    returning * into v_new;
  end if;

  insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
  values (v_new.id, p_decision, v_new.version, v_new.status, v_note, private.factory_bom_snapshot(v_new.id), v_admin.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, case when p_decision = 'approve' then 'FACTORY_BOM_APPROVE' else 'FACTORY_BOM_REJECT' end,
          'factory_boms', v_new.id::text,
          jsonb_build_object('item_code', v_code, 'revision', v_new.revision, 'version', v_new.version,
                             'is_test', v_new.is_test, 'note', v_note));
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'revision', v_new.revision,
                            'status', v_new.status, 'code', v_code);
end;
$$;

-- 7. อ่านข้อมูลทั้งหมดของโมดูล: เพิ่มฟิลด์ของ BOM และ bom_history (ส่วนอื่นคงตามนิยามเดิมใน 20261006050000) ---
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
          'id', p.id, 'code', p.code, 'item_id', p.item_id, 'name', i.name, 'unit_code', i.unit_code,
          'bom_id', p.bom_id, 'routing_id', p.routing_id, 'planned_qty', p.planned_qty,
          'completed_qty', p.completed_qty, 'status', p.status, 'due_date', p.due_date
        ) order by p.code)
      from public.factory_production_orders p join public.factory_items i on i.id = p.item_id
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
      ) h), '[]'::jsonb)
  );
end;
$$;

-- 8. ล้างข้อมูลทดสอบของฝ่ายโรงงาน: เพิ่มประวัติ BOM (ลบลูกก่อนแม่) ---------------------------
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

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;

revoke all on function public.app_factory_save_bom_draft(uuid, integer, uuid, numeric, date, text, jsonb) from public, anon;
revoke all on function public.app_factory_submit_bom(uuid, integer) from public, anon;
revoke all on function public.app_factory_withdraw_bom(uuid, integer) from public, anon;
revoke all on function public.app_factory_decide_bom(uuid, integer, text, text) from public, anon;
grant execute on function public.app_factory_save_bom_draft(uuid, integer, uuid, numeric, date, text, jsonb) to authenticated;
grant execute on function public.app_factory_submit_bom(uuid, integer) to authenticated;
grant execute on function public.app_factory_withdraw_bom(uuid, integer) to authenticated;
grant execute on function public.app_factory_decide_bom(uuid, integer, text, text) to authenticated;
