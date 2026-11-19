-- ============================================================================
-- ใบสั่งงาน IT (IT01-FM06) ย้ายมาเป็นโมดูลของ MNP_SYSTEM — ส่วนฐานข้อมูล (ยังไม่มีหน้าเว็บ)
--
-- ที่มา: ระบบ Work-Order เดิม (repo mnpchatai/Work-Order) ใช้ใบสั่งงาน IT แทนฟอร์มกระดาษ IT01-FM06
--   ย้ายมาเป็นตารางของโมดูลนี้เอง (prefix itwo_) บนฐานข้อมูลเดียวกับ MNP_SYSTEM โดย "ไม่แก้" ตาราง/ฟังก์ชันกลาง
--   (requests, approval_steps, app_create_request ฯลฯ) และไม่ใช้ profiles/username auth ของระบบเดิม
--   ผู้ใช้ = public.employees ของ MNP_SYSTEM (ล็อกอินของ MNP_SYSTEM)
--
-- แมปบทบาท
--   ผู้แจ้ง                  = พนักงาน active ทุกคน (ผ่าน private.itwo_actor)
--   ผู้อนุมัติขั้นแผนก        = พนักงาน active ที่ผูกบัญชีล็อกอินแล้ว (auth_user_id ไม่ว่าง) ไม่ถูกลบ ไม่ใช่บัญชีทดสอบ/บัญชี lab-only
--                              และ "role_id" เป็น department_manager หรือ assistant_department_manager อยู่แผนกเดียวกับผู้แจ้ง ใครคนใดคนหนึ่งกดก็นับ
--                              ดู role_id เท่านั้น: "ไม่ใช้ acting_role_id" ของ admin และไม่นับ factory_manager / general_manager
--                              เหตุผล (แยกหน้าที่ ISO): บน production เจ้าของ IT3462 เป็น admin ที่ acting เป็น department_manager ของแผนก IT
--                              ถ้านับ acting ผู้ดูแลงาน IT จะกลายเป็นผู้อนุมัติขั้นแผนก IT ของใบที่ตัวเองต้องทำ ขัดการแยกหน้าที่
--                              แผนกที่มีแต่ factory_manager (เช่น FT) จึงถือว่า "ไม่มีผู้จัดการ" -> ผู้อนุมัติขั้น IT (FANG) กดครั้งเดียวนับทั้งสองขั้น (เจ้าของยืนยัน)
--   IT ผู้ดูแลงาน (it_admin) = แถวใน itwo_staff ที่ is_it_admin: เห็นทุกใบ รับงาน/เริ่ม/บันทึกส่วนสิทธิ์ในระบบ/ปิดงาน/จัดการ itwo_staff/ตั้งเลขถัดไป
--   ผู้อนุมัติขั้น IT         = แถวใน itwo_staff ที่ is_it_approver
--   admin คนอื่นของ MNP_SYSTEM (role admin) "ไม่ได้" สิทธิ์ IT อัตโนมัติ ต้องมีแถวใน itwo_staff
--   seed: IT3462 (it_admin) และ FANG (it_admin + ผู้อนุมัติขั้น IT) หาจาก employees.employee_no · ต้องใช้งานอยู่ (is_active) และไม่ถูกลบ
--   การแก้ itwo_staff (app_itwo_set_staff) แก้แถวของ "ตัวเอง" ไม่ได้ทุกกรณี (แยกหน้าที่: กันยกตัวเองเป็นผู้อนุมัติขั้น IT / กันล็อกตัวเองออก)
--     และต้องเหลือผู้ดูแลงาน IT กับผู้อนุมัติขั้น IT ที่ใช้งานอยู่ (ผูกบัญชีล็อกอินแล้ว) อย่างน้อยอย่างละ 1 คนเสมอ
--
-- กฎการอนุมัติ (ตรวจฝั่งฐานข้อมูลทั้งหมด)
--   - ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนกตัวเอง -> ข้ามขั้นแผนก: บันทึก dept_approved ในชื่อผู้แจ้งอัตโนมัติ แล้วรอขั้น IT
--   - แผนกที่ไม่มีผู้จัดการ/ผู้ช่วยเลย (ที่ใช้งานอยู่ ไม่นับผู้แจ้งเอง) -> ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียว นับทั้งสองขั้น
--     (บันทึก dept_approved + it_mgr_approved ในชื่อผู้อนุมัติ พร้อมเหตุผลว่าแผนกไม่มีผู้จัดการ) ไม่ปฏิเสธการแจ้ง
--     ตัดสินตอนกดอนุมัติ (ไม่ใช่ตอนแจ้ง): ถ้าตั้งผู้จัดการแผนกระหว่างรอ ผู้จัดการคนนั้นอนุมัติขั้นแผนกได้ และผู้อนุมัติขั้น IT ต้องรอ
--   - ผู้แจ้งอยู่แผนก IT (departments.code = 'IT') -> ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
--   - ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง (FANG) -> อนุมัติครบทันทีตอนแจ้ง (บันทึก created + dept_approved + it_mgr_approved)
--   - ผู้อนุมัติขั้น IT ที่เป็นผู้จัดการ/ผู้ช่วยของแผนกผู้แจ้งเองด้วย -> กดครั้งเดียวนับทั้งสองขั้น (เหมือนระบบเดิม)
--   - อนุมัติ/ไม่อนุมัติใบของตัวเองไม่ได้ · ไม่อนุมัติ = จบทันที (rejected) ต้องมีเหตุผล · ใบที่ยกเลิก/ไม่อนุมัติเปิดใหม่ไม่ได้
--   - งานด่วน: เริ่มได้ก่อนอนุมัติครบ แต่ปิดงานได้เมื่ออนุมัติครบทั้งสองขั้นแล้วเท่านั้น
--   "อนุมัติขั้นไหนแล้ว" ตัดสินจากตาราง itwo_events (แหล่งความจริง) ไม่ใช่จาก status อย่างเดียว
--
-- ISO: ประวัติการดำเนินการ (itwo_events) เพิ่มได้อย่างเดียว
--   trigger กัน UPDATE/DELETE/TRUNCATE บน itwo_events, itwo_admin_log และกัน DELETE/TRUNCATE บน itwo_work_orders
--   (ใบเปลี่ยนได้แค่คอลัมน์ status ตามตารางการเปลี่ยนสถานะที่ trigger บังคับ) ไม่มีสิทธิ์เขียนตรงให้ใครเลย
--   ทุกการเปลี่ยนผ่าน RPC SECURITY DEFINER ที่ตรวจบทบาทและลำดับขั้น · การลบมีทางเดียวคือ app_sandbox_purge_itwo (เฉพาะแถว is_test)
--   การแก้ itwo_staff และการตั้งเลขเอกสารถัดไปบันทึกลง itwo_admin_log (เพิ่มได้อย่างเดียว) แยกจาก itwo_events
--
-- เลขที่เอกสาร: IT06-<ปี ค.ศ. 2 หลักตามเวลา Asia/Bangkok>/<ลำดับ 3 หลัก> เช่น IT06-26/001 ออกฝั่งฐานข้อมูลแบบ lock แถวตัวนับ ไม่ซ้ำแม้กดพร้อมกัน
--   it_admin ตั้งเลขถัดไปได้ด้วย app_itwo_set_next_doc_seq (เดินหน้าอย่างเดียว ห้ามถอยหรือชนเลขที่ใช้แล้ว) พร้อมบันทึก log
--
-- ข้อมูลทดสอบก่อนใช้จริง: ใช้กลไก "โหมดทดสอบสำหรับผู้ดูแลระบบ" (Admin Sandbox) ของ MNP_SYSTEM ตามแบบ BOM
--   - ทุกตารางของโมดูลมี is_test ที่ trigger private.sandbox_row_scope กำหนดจากโหมดของผู้ทำรายการ (ไม่รับจาก client) · ข้อมูลสองโหมดแยกกันเด็ดขาด
--   - เลขเอกสารทดสอบใช้ตัวนับแยก ขึ้นต้น TEST- (เช่น TEST-IT06-26/001) ตัวนับจริงไม่ขยับ
--   - บัญชีทดสอบ (persona) เพิ่ม 3 บัญชี: SBX-IT-STAFF (ผู้แจ้งแผนก IT), SBX-IT-ADMIN (IT ผู้ดูแลงาน), SBX-IT-APPROVER (ผู้อนุมัติขั้น IT เหมือน FANG)
--     ใช้ร่วมกับ persona เดิม (ผู้แจ้ง/ผู้จัดการ/ผู้ช่วยของแผนกอื่น) ผู้อนุมัติแผนกในโหมดทดสอบหาจาก persona ที่ is_test เท่านั้น
--   - app_sandbox_purge_itwo ลบข้อมูลทดสอบทั้งหมด (รวมประวัติ) และเริ่มนับ TEST-…/001 ใหม่ โดยไม่แตะข้อมูลจริง และไม่ต้องลบประวัติ ISO ของจริงเลย
--   - itwo_staff ไม่รู้จักโหมดทดสอบ: ติดด่าน sandbox_guard (เขียนไม่ได้ระหว่างอยู่ในโหมดทดสอบ) แถวของ persona seed ใน migration นี้
--
-- ยังไม่ทำ (งานถัดไป): แนบรูป, โหมดดูแทนผู้ใช้ (_as), การแจ้งเตือน (อีเมล/Push/กระดิ่ง), หน้าเว็บ (ช่วงที่ 3)
--
-- รายการตารางโหมดทดสอบ: migration นี้ไม่ replace private.sandbox_unguarded_tables() (นิยามมาจาก 20261202010000_bom_sr_rod_store.sql ซึ่งรวม itwo_* 5 ตารางแบบมีเงื่อนไขไว้แล้ว)
-- หมายเหตุ production: migration นี้ถูก apply ไปแล้วในชื่อ version 20261118093030 (ก่อนเปลี่ยนชื่อไฟล์เป็น 20261203010000) เนื้อหาเหมือนกันยกเว้นส่วน sandbox_unguarded_tables
--   ที่ main ครอบให้แล้ว (ฟังก์ชันบน prod มาจาก bom_sr_rod_store ที่ apply ทับเป็น version 20261119015153)
-- ตาราง/ฟังก์ชันกลางของ MNP_SYSTEM ที่ "ไม่แตะ": employees, departments, roles, requests, approval_steps, app_create_request ฯลฯ
--   (เพิ่มแถว persona 3 แถวใน employees แบบ migration โหมดทดสอบรุ่นก่อน ๆ เท่านั้น)
--
-- ลำดับ deploy: migration นี้ไม่กระทบโมดูลอื่น (ตารางและ RPC ใหม่ล้วน) ยังไม่มีหน้าเว็บเรียก apply ก่อนหรือหลัง merge ได้
--   ก่อน apply ที่ production: ต้องมีพนักงาน IT3462 และ FANG ที่ใช้งานอยู่ (ไม่เช่นนั้น migration ล้มโดยตั้งใจ) · production apply ไปแล้ว ไม่ต้อง apply ซ้ำ
--   หลัง apply ตรวจ relrowsecurity ของตาราง itwo_* และ grant ของ RPC (anon เรียกไม่ได้) และ service_role ไม่มีสิทธิ์ตรงบนตาราง/sequence itwo_*
--
-- ฐานข้อมูลที่ถือว่า "จริง" (ตอนรัน seed ข้อ 6) = มีพนักงานจริง (not is_test) ที่ auth_user_id ไม่ว่างอย่างน้อย 1 คน
--   เหตุผล: production ต้องมีคนล็อกอินแล้วเสมอ ส่วน CI/local ที่เพิ่งรัน migration ครบมีแค่แถว pilot (MNP0101/0102/0201 จาก 20260917011719_github_pages_test_pilot.sql
--   ซึ่งเป็น not is_test แต่ไม่มี auth_user_id) การนับ "มีพนักงานจริงไหม" เฉยๆ จะจับแถว pilot แล้วทำให้ CI ล้มเพราะหา IT3462/FANG ไม่เจอ
--   (ไม่ใช้ is_master เป็นตัวตัดสิน เพราะผูกกับบัญชีเดียว THTWGOT ถ้าบัญชีนั้นถูกเปลี่ยนจะเผลอข้ามการตรวจบน production)
--
-- id ของ itwo_events / itwo_admin_log เป็น identity ตัวเดียวร่วมกันทั้งข้อมูลจริงและข้อมูลทดสอบ: หลัง app_sandbox_purge_itwo id ของข้อมูลจริงจะ "เว้นช่อง"
--   ซึ่งไม่ใช่การลบประวัติจริง (ลบได้เฉพาะแถว is_test) ผู้ตรวจ ISO ให้ใช้ created_at + เลขที่เอกสารอ้างอิงลำดับ ไม่ใช้ id
--
-- Rollback (ตารางใหม่ ยังไม่มีข้อมูลจริง): drop function app_itwo_*, app_sandbox_purge_itwo, private.itwo_*;
--   drop table itwo_admin_log, itwo_events, itwo_access_changes, itwo_work_orders, itwo_doc_counters, itwo_staff (ลูกก่อนแม่);
--   ลบ persona SBX-IT-* (employees.employee_no like 'SBX-IT-%')
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if not exists (select 1 from public.departments where code = 'IT') then
    raise exception 'ไม่พบแผนก IT (departments.code = ''IT'') ซึ่งโมดูลใบสั่งงาน IT ใช้กำหนดเส้นทางอนุมัติ';
  end if;
  if not exists (select 1 from public.roles where code = 'department_manager')
     or not exists (select 1 from public.roles where code = 'assistant_department_manager')
     or not exists (select 1 from public.roles where code = 'staff') then
    raise exception 'ไม่พบบทบาท staff / department_manager / assistant_department_manager';
  end if;
end;
$$;

-- 1. ตาราง -----------------------------------------------------------------------
-- สิทธิ์ฝั่ง IT ของโมดูลนี้ (แยกจากบทบาทของระบบกลาง) แก้ผ่าน app_itwo_set_staff เท่านั้น
create table public.itwo_staff (
  employee_id uuid primary key references public.employees(id),
  is_it_admin boolean not null default false,
  is_it_approver boolean not null default false,
  updated_by uuid references public.employees(id),
  updated_at timestamptz not null default now(),
  constraint itwo_staff_has_a_role check (is_it_admin or is_it_approver)
);
comment on table public.itwo_staff is
  'สิทธิ์ฝั่ง IT ของใบสั่งงาน IT: is_it_admin = เห็นทุกใบ/รับงาน/ปิดงาน/จัดการสิทธิ์ · is_it_approver = ผู้อนุมัติขั้น IT · แก้ผ่าน app_itwo_set_staff เท่านั้น';

-- ตัวนับเลขที่เอกสารรายปี แยกชุดของจริง/ทดสอบ (ใช้ผ่านฟังก์ชันเท่านั้น)
create table public.itwo_doc_counters (
  is_test boolean not null default false,
  doc_year integer not null check (doc_year between 2000 and 2999),
  last_seq integer not null default 0 check (last_seq between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (is_test, doc_year)
);

create table public.itwo_work_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  doc_no text not null unique,
  doc_year integer not null,
  doc_seq integer not null check (doc_seq >= 1),
  requester_id uuid not null references public.employees(id),
  department_id uuid not null references public.departments(id),
  request_type text not null check (request_type in ('design', 'system_access', 'misc')),
  order_ref text check (order_ref is null or char_length(order_ref) <= 100),
  attachment_flag text not null check (attachment_flag in ('yes', 'no', 'other')),
  attachment_note text check (attachment_note is null or char_length(attachment_note) <= 200),
  details text not null check (btrim(details) <> '' and char_length(details) <= 2000),
  needed_date date not null,
  is_urgent boolean not null default false,
  status text not null default 'pending_dept'
    check (status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'it_closed', 'received', 'rejected', 'cancelled')),
  created_at timestamptz not null default now(),
  unique (is_test, doc_year, doc_seq),
  unique (id, is_test)
);
create index itwo_work_orders_requester_idx on public.itwo_work_orders (requester_id);
create index itwo_work_orders_department_idx on public.itwo_work_orders (department_id);
create index itwo_work_orders_status_idx on public.itwo_work_orders (is_test, status);
comment on table public.itwo_work_orders is
  'ใบสั่งงาน IT (IT01-FM06) · ลบไม่ได้ เปลี่ยนได้แค่คอลัมน์ status ตามตารางการเปลี่ยนสถานะของ trigger · เขียนผ่าน app_itwo_* เท่านั้น';

-- ส่วน "สำหรับแผนก IT" (บันทึกสิทธิ์ในระบบ) แทนที่ทั้งชุดได้จนกว่า IT ปิดงาน (ไม่ใช่บันทึก ISO ของ itwo_events)
create table public.itwo_access_changes (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  work_order_id uuid not null,
  line_no smallint not null default 0,
  system text not null check (system in ('i_prime', 'express', 'email', 'other')),
  action text not null check (action in ('add', 'change', 'cancel')),
  new_username text check (new_username is null or char_length(new_username) <= 100),
  old_username text check (old_username is null or char_length(old_username) <= 100),
  note text check (note is null or char_length(note) <= 500),
  foreign key (work_order_id, is_test) references public.itwo_work_orders (id, is_test)
);
create index itwo_access_changes_wo_idx on public.itwo_access_changes (work_order_id, is_test);

-- ประวัติสำหรับ ISO (ลายเซ็นอิเล็กทรอนิกส์): เพิ่มได้อย่างเดียว id (identity) เรียงตามลำดับเหตุการณ์จริง
create table public.itwo_events (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  work_order_id uuid not null,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in (
    'created', 'dept_approved', 'dept_rejected', 'it_mgr_approved', 'it_mgr_rejected',
    'cancelled', 'started', 'completed', 'received')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (work_order_id, is_test) references public.itwo_work_orders (id, is_test)
);
create index itwo_events_wo_idx on public.itwo_events (work_order_id, is_test, id);
create index itwo_events_actor_idx on public.itwo_events (actor_id);
comment on table public.itwo_events is
  'ประวัติการดำเนินการของใบสั่งงาน IT สำหรับ ISO · เพิ่มได้อย่างเดียว ห้ามแก้/ลบ (trigger) · ถือเป็นลายเซ็นอิเล็กทรอนิกส์';

-- ประวัติการแก้สิทธิ์ IT และการตั้งเลขเอกสารถัดไป (เพิ่มได้อย่างเดียว)
create table public.itwo_admin_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in ('staff_added', 'staff_changed', 'staff_removed', 'doc_seq_set')),
  target_employee_id uuid references public.employees(id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index itwo_admin_log_actor_idx on public.itwo_admin_log (actor_id);
create index itwo_admin_log_target_idx on public.itwo_admin_log (target_employee_id) where target_employee_id is not null;

create index itwo_staff_updated_by_idx on public.itwo_staff (updated_by) where updated_by is not null;

-- 2. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itwo_staff', 'itwo_doc_counters', 'itwo_work_orders', 'itwo_access_changes', 'itwo_events', 'itwo_admin_log'
  ] loop
    -- ถอน service_role ด้วย: Supabase ให้สิทธิ์ตารางใหม่แก่ service_role อัตโนมัติ (default privileges) ซึ่งเลี่ยง RLS ได้
    -- ตารางบันทึก ISO จึงไม่ควรเปิดให้ secret key เขียนตรงโดยไม่ผ่าน RPC (RPC เป็น SECURITY DEFINER เจ้าของ postgres ไม่กระทบ)
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    -- identity sequence (id ของ itwo_events / itwo_admin_log) ก็ได้สิทธิ์ตาม default privileges เช่นกัน
    -- หา sequence ที่ผูกกับตารางจาก pg_depend (ตารางที่ไม่มี identity จะไม่มีแถว)
    for v_sequence in
      select format('%I.%I', n.nspname, s.relname)
      from pg_catalog.pg_class s
      join pg_catalog.pg_namespace n on n.oid = s.relnamespace
      join pg_catalog.pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
      where s.relkind = 'S' and d.refobjid = ('public.' || v_table)::regclass
    loop
      execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_sequence);
    end loop;
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
    -- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้
    execute format('select private.lab_only_guard_table(%L)', 'public.' || v_table);
  end loop;
end $$;

-- 3. ตัวช่วย trigger: แยกโหมดทดสอบ + ISO ----------------------------------------------
-- (ใช้ private.sandbox_row_scope เดิมของ MNP_SYSTEM: INSERT กำหนด is_test จากโหมดผู้ทำรายการ, UPDATE/DELETE ตรวจโหมดตรงกัน)
create trigger itwo_doc_counters_sandbox_scope before insert or update or delete on public.itwo_doc_counters
  for each row execute function private.sandbox_row_scope();
create trigger itwo_work_orders_sandbox_scope before insert or update or delete on public.itwo_work_orders
  for each row execute function private.sandbox_row_scope();
create trigger itwo_access_changes_sandbox_scope before insert or update or delete on public.itwo_access_changes
  for each row execute function private.sandbox_row_scope();
create trigger itwo_events_sandbox_scope before insert or update or delete on public.itwo_events
  for each row execute function private.sandbox_row_scope();
create trigger itwo_admin_log_sandbox_scope before insert or update or delete on public.itwo_admin_log
  for each row execute function private.sandbox_row_scope();

-- ลบได้เฉพาะแถวทดสอบ ภายใน app_sandbox_purge_itwo (ตั้ง itwo.purge = on แบบ transaction-local) แถวจริงลบไม่ได้เลย
create or replace function private.itwo_purge_allowed(p_is_test boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_is_test and coalesce(current_setting('itwo.purge', true), '') = 'on'
$$;
revoke all on function private.itwo_purge_allowed(boolean) from public, anon, authenticated;

-- กันแก้/ลบประวัติ (events และ admin_log)
create or replace function private.itwo_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if private.itwo_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
end;
$$;
revoke all on function private.itwo_append_only_guard() from public, anon, authenticated;

create trigger itwo_events_append_only before update or delete on public.itwo_events
  for each row execute function private.itwo_append_only_guard();
create trigger itwo_events_no_truncate before truncate on public.itwo_events
  for each statement execute function private.itwo_append_only_guard();
create trigger itwo_admin_log_append_only before update or delete on public.itwo_admin_log
  for each row execute function private.itwo_append_only_guard();
create trigger itwo_admin_log_no_truncate before truncate on public.itwo_admin_log
  for each statement execute function private.itwo_append_only_guard();

-- ใบสั่งงาน: ลบไม่ได้ · แก้ได้เฉพาะ status ตามตารางการเปลี่ยนสถานะ (ปลายทางคือ rejected / cancelled / received เปิดใหม่ไม่ได้)
create or replace function private.itwo_work_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itwo_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ใบสั่งงานลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ใบสั่งงานล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: ทุกคอลัมน์ยกเว้น status ต้องไม่เปลี่ยน
  if (new.id, new.is_test, new.doc_no, new.doc_year, new.doc_seq, new.requester_id, new.department_id,
      new.request_type, new.order_ref, new.attachment_flag, new.attachment_note, new.details,
      new.needed_date, new.is_urgent, new.created_at)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.department_id,
      old.request_type, old.order_ref, old.attachment_flag, old.attachment_note, old.details,
      old.needed_date, old.is_urgent, old.created_at) then
    raise exception 'ใบสั่งงานแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled'))
    or (old.status = 'it_closed' and new.status = 'received')
  ) then
    raise exception 'เปลี่ยนสถานะใบสั่งงานจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itwo_work_order_guard() from public, anon, authenticated;

create trigger itwo_work_orders_guard before update or delete on public.itwo_work_orders
  for each row execute function private.itwo_work_order_guard();
create trigger itwo_work_orders_no_truncate before truncate on public.itwo_work_orders
  for each statement execute function private.itwo_work_order_guard();

-- 4. ตารางใหม่รู้จักโหมดทดสอบแล้ว ------------------------------------------------------
-- ไม่ replace private.sandbox_unguarded_tables() ที่นี่: นิยามปัจจุบันมาจาก 20261202010000_bom_sr_rod_store.sql
-- ซึ่งต่อท้าย itwo_work_orders/itwo_events/itwo_access_changes/itwo_doc_counters/itwo_admin_log แบบมีเงื่อนไข (to_regclass) จึงเห็นตารางของ migration นี้เองหลังสร้าง
-- itwo_staff ไม่อยู่ในรายการ: ติดด่าน sandbox_guard แทน (แก้ไม่ได้ระหว่างอยู่ในโหมดทดสอบ กันแตะสิทธิ์จริงโดยไม่ตั้งใจ)
select private.sandbox_guard_table('public.itwo_staff');

-- 5. บัญชีทดสอบ (persona) ของโมดูลนี้ -----------------------------------------------
-- inactive + ไม่มี auth_user_id = ล็อกอินไม่ได้ (CHECK employees_test_persona_inert) ไม่ถูกเลือกเป็นผู้อนุมัติของโมดูลอื่น
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.employee_no, 'ทดสอบ', v.last_name, lower(v.employee_no) || '@sandbox.local', v.last_name || ' (ทดสอบ)',
       d.id, r.id, false, true
from (values
  ('SBX-IT-STAFF', 'ผู้แจ้งแผนก IT', 'IT', 'staff'),
  ('SBX-IT-ADMIN', 'IT ผู้ดูแลงาน', 'IT', 'staff'),
  ('SBX-IT-APPROVER', 'ผู้อนุมัติขั้น IT', 'MGT', 'staff')
) as v(employee_no, last_name, dept_code, role_code)
join public.departments d on d.code = v.dept_code
join public.roles r on r.code = v.role_code
on conflict (employee_no) do nothing;

do $$
begin
  if (select count(*) from public.employees where is_test and employee_no in ('SBX-IT-STAFF', 'SBX-IT-ADMIN', 'SBX-IT-APPROVER')) <> 3 then
    raise exception 'สร้างบัญชีทดสอบ SBX-IT-* ไม่ครบ (ต้องมีแผนก IT, MGT และบทบาท staff)';
  end if;
end;
$$;

insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, true, e.employee_no = 'SBX-IT-APPROVER'
from public.employees e
where e.is_test and e.employee_no in ('SBX-IT-ADMIN', 'SBX-IT-APPROVER');

-- 6. สิทธิ์ IT ของจริง (seed) ---------------------------------------------------------
-- IT3462 = it_admin · FANG = it_admin + ผู้อนุมัติขั้น IT · หาจาก employee_no
-- ถ้าเป็นฐานข้อมูลจริง (production) แต่หาสองบัญชีนี้ไม่เจอ หรือบัญชีถูกปิดใช้งาน ให้ migration ล้มชัดเจน (ไม่ปล่อยให้ไม่มีใครอนุมัติ/รับงานได้)
-- "ฐานข้อมูลจริง" = มีพนักงานจริง (not is_test) ที่ผูกบัญชีล็อกอินแล้ว (auth_user_id ไม่ว่าง) อย่างน้อย 1 คน
--   ไม่ใช้ "มีพนักงานจริงไหม" เฉยๆ เพราะ CI/local มีแถว pilot (MNP0101/0102/0201) ที่ not is_test แต่ไม่มี auth_user_id ซึ่งจะทำให้ CI ล้ม
--   ฐานข้อมูล CI/local ที่มีแค่แถว pilot จึงข้ามขั้นนี้ (แบบเดียวกับบัญชี THTWGOT ใน 20261113010000)
do $$
declare
  v_it_admin public.employees%rowtype;
  v_fang public.employees%rowtype;
  v_is_live_database boolean;
begin
  select exists (select 1 from public.employees e where not e.is_test and e.auth_user_id is not null)
    into v_is_live_database;

  select * into v_it_admin from public.employees e
  where e.employee_no = 'IT3462' and not e.is_test and e.deleted_at is null;
  select * into v_fang from public.employees e
  where e.employee_no = 'FANG' and not e.is_test and e.deleted_at is null;

  if v_is_live_database then
    if v_it_admin.id is null then
      raise exception 'ไม่พบพนักงานรหัส IT3462 สำหรับตั้งเป็นผู้ดูแลงาน IT (itwo_staff) (ฐานข้อมูลนี้มีพนักงานที่ผูกบัญชีล็อกอินแล้ว จึงถือเป็นฐานข้อมูลจริง)';
    end if;
    if v_fang.id is null then
      raise exception 'ไม่พบพนักงานรหัส FANG สำหรับตั้งเป็นผู้อนุมัติขั้น IT (itwo_staff) (ฐานข้อมูลนี้มีพนักงานที่ผูกบัญชีล็อกอินแล้ว จึงถือเป็นฐานข้อมูลจริง)';
    end if;
    if not v_it_admin.is_active then
      raise exception 'พนักงานรหัส IT3462 ถูกปิดการใช้งาน ตั้งเป็นผู้ดูแลงาน IT ไม่ได้ กรุณาเปิดใช้งานก่อน';
    end if;
    if not v_fang.is_active then
      raise exception 'พนักงานรหัส FANG ถูกปิดการใช้งาน ตั้งเป็นผู้อนุมัติขั้น IT ไม่ได้ กรุณาเปิดใช้งานก่อน';
    end if;
  end if;

  if v_it_admin.id is not null then
    insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver) values (v_it_admin.id, true, false);
  end if;
  if v_fang.id is not null then
    insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver) values (v_fang.id, true, true);
  end if;
end;
$$;

-- 7. ตัวช่วยภายใน (private) ----------------------------------------------------------
-- ผู้ทำรายการของโมดูล: persona (ถ้า admin อยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานจริงที่ใช้งานอยู่ของ session นี้
create or replace function private.itwo_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบ' using errcode = 'insufficient_privilege';
  end if;
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  select * into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.deleted_at is null and not e.is_test
  limit 1;
  if v_actor.id is null then
    raise exception 'ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT' using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;
revoke all on function private.itwo_actor() from public, anon, authenticated;

-- ผู้อนุมัติขั้นแผนกของแผนกหนึ่งในโหมดหนึ่ง
--   ของจริง: active + ผูกบัญชีล็อกอินแล้ว (auth_user_id ไม่ว่าง) + ไม่ถูกลบ + ไม่ใช่ persona + ไม่ใช่บัญชี lab-only
--     (แถวที่ล็อกอินไม่ได้ เช่น แถว pilot หรือบัญชีที่ยังไม่ผูก ไม่ควรถูกนับว่า "แผนกมีผู้จัดการ" เพราะจะไม่มีใครกดอนุมัติได้จริง ใบจะค้าง)
--   โหมดทดสอบ: persona ของแผนกนั้น (persona ล็อกอินไม่ได้ตามดีไซน์ จึงไม่ต้องมี auth_user_id)
-- ดู role_id เท่านั้น "ไม่ใช้ acting_role_id" และไม่นับ factory_manager / general_manager (เหตุผลดูหัวไฟล์: แยกหน้าที่ ISO)
create or replace function private.itwo_dept_approvers(p_department_id uuid, p_is_test boolean)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.department_id = p_department_id
    and r.code in ('department_manager', 'assistant_department_manager')
    and e.deleted_at is null
    and e.is_test = p_is_test
    and (
      p_is_test
      or (e.is_active
          and e.auth_user_id is not null
          and upper(e.employee_no) <> all (private.lab_only_employee_nos()))
    )
$$;
revoke all on function private.itwo_dept_approvers(uuid, boolean) from public, anon, authenticated;

-- ผู้ทำรายการเป็นผู้อนุมัติขั้นแผนกของแผนก p_department_id หรือไม่ (ใช้รายการเดียวกับ private.itwo_dept_approvers จึงตัดสินตรงกันทุกที่)
create or replace function private.itwo_is_dept_approver(p_employee_id uuid, p_department_id uuid, p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.itwo_dept_approvers(p_department_id, p_is_test) a(id) where a.id = p_employee_id)
$$;
revoke all on function private.itwo_is_dept_approver(uuid, uuid, boolean) from public, anon, authenticated;

create or replace function private.itwo_is_it_admin(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_admin)
$$;
revoke all on function private.itwo_is_it_admin(uuid) from public, anon, authenticated;

create or replace function private.itwo_is_it_approver(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_approver)
$$;
revoke all on function private.itwo_is_it_approver(uuid) from public, anon, authenticated;

create or replace function private.itwo_is_staff(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id)
$$;
revoke all on function private.itwo_is_staff(uuid) from public, anon, authenticated;

-- มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ในโหมดนี้หรือไม่ (กันใบค้างเพราะไม่มีใครอนุมัติได้)
-- ของจริงนับเฉพาะคนที่ active + ผูกบัญชีล็อกอินแล้ว + ไม่ใช่บัญชี lab-only (เงื่อนไขเดียวกับผู้อนุมัติขั้นแผนก)
create or replace function private.itwo_has_active_it_approver(p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.itwo_staff s
    join public.employees e on e.id = s.employee_id
    where s.is_it_approver and e.is_test = p_is_test and e.deleted_at is null
      and (
        p_is_test
        or (e.is_active
            and e.auth_user_id is not null
            and upper(e.employee_no) <> all (private.lab_only_employee_nos()))
      )
  )
$$;
revoke all on function private.itwo_has_active_it_approver(boolean) from public, anon, authenticated;

-- แผนก IT ของโมดูลนี้ = departments.code 'IT' (เหมือน IT_REPAIR)
create or replace function private.itwo_is_it_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.departments d where d.id = p_department_id and d.code = 'IT')
$$;
revoke all on function private.itwo_is_it_department(uuid) from public, anon, authenticated;

-- ผู้ทำรายการเห็นใบนี้ได้ไหม: ผู้แจ้ง / itwo_staff (ทุกคน) / ผู้อนุมัติขั้นแผนกของแผนกนั้น · ใบต้องอยู่โหมดเดียวกับผู้ทำรายการ
create or replace function private.itwo_can_view(p_wo public.itwo_work_orders, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_wo.is_test = p_actor.is_test
    and (
      p_wo.requester_id = p_actor.id
      or private.itwo_is_staff(p_actor.id)
      or exists (select 1 from private.itwo_dept_approvers(p_wo.department_id, p_wo.is_test) a(id) where a.id = p_actor.id)
    )
$$;
revoke all on function private.itwo_can_view(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- สถานะการอนุมัติของใบ (จาก events)
create or replace function private.itwo_event_state(p_work_order_id uuid, out dept_done boolean, out it_done boolean, out rejected boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_or(e.action = 'dept_approved'), false),
         coalesce(bool_or(e.action = 'it_mgr_approved'), false),
         coalesce(bool_or(e.action in ('dept_rejected', 'it_mgr_rejected')), false)
  from public.itwo_events e
  where e.work_order_id = p_work_order_id
$$;
revoke all on function private.itwo_event_state(uuid) from public, anon, authenticated;

-- สิทธิ์อนุมัติ/ไม่อนุมัติของผู้ทำรายการกับใบหนึ่ง (จุดตัดสินเดียว ใช้ทั้ง RPC อนุมัติ รายการรออนุมัติ และปุ่มในหน้ารายละเอียด)
--   can_dept = อนุมัติขั้นแผนกได้ · can_it = อนุมัติขั้น IT ได้ (ถ้า dept ยังไม่ผ่าน กดครั้งเดียวนับทั้งสองขั้น)
create or replace function private.itwo_approval_caps(
  p_work_order_id uuid,
  p_actor_id uuid,
  out can_dept boolean,
  out can_it boolean,
  out dept_done boolean,
  out it_done boolean,
  out rejected boolean,
  out dept_is_it boolean,
  out has_dept_approvers boolean,
  out actor_is_dept_role boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wo public.itwo_work_orders%rowtype;
  v_actor public.employees%rowtype;
  v_is_it_approver boolean;
  v_open boolean;
begin
  can_dept := false;
  can_it := false;
  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id;
  select * into v_actor from public.employees e where e.id = p_actor_id;
  if v_wo.id is null or v_actor.id is null or v_wo.is_test <> v_actor.is_test then
    return;
  end if;

  select s.dept_done, s.it_done, s.rejected into dept_done, it_done, rejected
  from private.itwo_event_state(v_wo.id) s;
  dept_is_it := private.itwo_is_it_department(v_wo.department_id);
  -- ไม่นับผู้แจ้งเอง: ผู้แจ้งอนุมัติใบตัวเองไม่ได้ (ถ้าเป็นผู้จัดการแผนก ขั้นแผนกผ่านอัตโนมัติตอนแจ้งอยู่แล้ว)
  has_dept_approvers := exists (
    select 1 from private.itwo_dept_approvers(v_wo.department_id, v_wo.is_test) a(id) where a.id <> v_wo.requester_id);
  actor_is_dept_role := exists (
    select 1 from private.itwo_dept_approvers(v_wo.department_id, v_wo.is_test) a(id) where a.id = p_actor_id);
  v_is_it_approver := private.itwo_is_it_approver(p_actor_id);

  -- in_progress อยู่ในรายการเพราะงานด่วนเริ่มทำก่อน แต่ผู้จัดการยังต้องอนุมัติตามหลัง
  v_open := v_wo.requester_id <> p_actor_id
    and v_wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$$;
revoke all on function private.itwo_approval_caps(uuid, uuid) from public, anon, authenticated;

-- การกระทำที่ผู้ทำรายการทำได้กับใบนี้ตอนนี้ (ให้หน้ารายละเอียดแสดงปุ่ม · ตรรกะเดียวกับ RPC แต่ละตัว)
create or replace function private.itwo_allowed_actions(p_wo public.itwo_work_orders, p_actor public.employees)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actions text[] := '{}';
  v_caps record;
  v_is_admin boolean;
  v_pending boolean := p_wo.status in ('pending_dept', 'pending_it_mgr');
begin
  if p_wo.id is null or p_wo.is_test <> p_actor.is_test then
    return v_actions;
  end if;
  v_is_admin := private.itwo_is_it_admin(p_actor.id);

  if p_wo.requester_id = p_actor.id and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
    v_actions := array_append(v_actions, 'cancel');
  end if;

  select * into v_caps from private.itwo_approval_caps(p_wo.id, p_actor.id);
  if v_caps.can_dept or v_caps.can_it then
    v_actions := v_actions || array['approve', 'reject'];
  end if;

  if v_is_admin and (p_wo.status = 'approved' or (p_wo.is_urgent and v_pending)) then
    v_actions := array_append(v_actions, 'start');
  end if;

  if v_is_admin and p_wo.status = 'in_progress' then
    -- ปิดงานได้เมื่ออนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนก็เช่นกัน)
    if (select s.dept_done and s.it_done from private.itwo_event_state(p_wo.id) s) then
      v_actions := array_append(v_actions, 'complete');
    end if;
  end if;

  if p_wo.requester_id = p_actor.id and p_wo.status = 'it_closed' then
    v_actions := array_append(v_actions, 'receive');
  end if;

  if v_is_admin and (p_wo.status in ('approved', 'in_progress') or (p_wo.is_urgent and v_pending)) then
    v_actions := array_append(v_actions, 'edit_access');
  end if;
  return v_actions;
end;
$$;
revoke all on function private.itwo_allowed_actions(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- ออกเลขที่เอกสาร (ฝั่งฐานข้อมูลเท่านั้น): ON CONFLICT DO UPDATE ล็อกแถวตัวนับของปีนั้น คนกดพร้อมกันจึงได้เลขไม่ซ้ำ
-- ปีคิดตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC · ใบทดสอบใช้ตัวนับแยกและเลขขึ้นต้น TEST- · p_now ไว้ให้เทสต์จำลองช่วงข้ามปี (การเรียกจริงใช้ now())
create or replace function private.itwo_next_doc_no(p_is_test boolean, p_now timestamptz default now(), out year_ce integer, out seq_no integer, out doc_no text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  year_ce := extract(year from (p_now at time zone 'Asia/Bangkok'))::integer;
  insert into public.itwo_doc_counters as c (is_test, doc_year, last_seq)
  values (p_is_test, year_ce, 1)
  on conflict (is_test, doc_year) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into seq_no;
  doc_no := private.itwo_format_doc_no(p_is_test, year_ce, seq_no);
end;
$$;
revoke all on function private.itwo_next_doc_no(boolean, timestamptz) from public, anon, authenticated;

-- รูปแบบเลขที่: IT06-YY/NNN (เกิน 999 แสดงเต็มตัวเลข ไม่ตัดทิ้ง) · ทดสอบขึ้นต้น TEST-
create or replace function private.itwo_format_doc_no(p_is_test boolean, p_year integer, p_seq integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_is_test then 'TEST-' else '' end
    || 'IT06-' || lpad((p_year % 100)::text, 2, '0') || '/'
    || case when p_seq < 1000 then lpad(p_seq::text, 3, '0') else p_seq::text end
$$;
revoke all on function private.itwo_format_doc_no(boolean, integer, integer) from public, anon, authenticated;

-- ข้อความใช้ซ้ำ: ตัดช่องว่างรวม tab / ขึ้นบรรทัดใหม่
create or replace function private.itwo_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '')
$$;
revoke all on function private.itwo_clean(text) from public, anon, authenticated;

-- ข้อความแจ้งเมื่อใบไม่อยู่ในสถานะที่ทำรายการได้
create or replace function private.itwo_status_message(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'cancelled' then 'ใบสั่งงานนี้ถูกยกเลิกแล้ว'
    when 'rejected' then 'ใบสั่งงานนี้ไม่อนุมัติไปแล้ว'
    when 'approved' then 'ใบสั่งงานนี้อนุมัติครบแล้ว'
    when 'in_progress' then 'ใบสั่งงานนี้เริ่มดำเนินการไปแล้ว'
    when 'it_closed' then 'ใบสั่งงานนี้ IT ปิดงานแล้ว'
    when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว)'
    else 'ใบสั่งงานนี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้'
  end
$$;
revoke all on function private.itwo_status_message(text) from public, anon, authenticated;

-- 8. RPC: ตัวช่วยบอกบทบาทของผู้ใช้ปัจจุบันในโมดูลนี้ (ให้หน้าเว็บตัดสินเมนู/ปุ่ม ไม่ใช่ตัวบังคับสิทธิ์) ----------
create or replace function public.app_itwo_my_role()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  return jsonb_build_object(
    'employee_id', v_actor.id,
    'employee_no', v_actor.employee_no,
    'full_name', v_actor.first_name || ' ' || v_actor.last_name,
    'is_test', v_actor.is_test,
    'department', (select jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th)
                   from public.departments d where d.id = v_actor.department_id),
    'is_it_department', private.itwo_is_it_department(v_actor.department_id),
    'is_dept_approver', private.itwo_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test),
    'is_it_admin', private.itwo_is_it_admin(v_actor.id),
    'is_it_approver', private.itwo_is_it_approver(v_actor.id)
  );
end;
$$;

-- 9. RPC: แจ้งงานใหม่ ----------------------------------------------------------------
create or replace function public.app_itwo_create(
  p_request_type text,
  p_order_ref text,
  p_attachment_flag text,
  p_attachment_note text,
  p_details text,
  p_needed_date date,
  p_is_urgent boolean
)
returns table (id uuid, doc_no text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_dept public.departments%rowtype;
  v_details text := private.itwo_clean(p_details);
  v_order_ref text := private.itwo_clean(p_order_ref);
  v_attach_note text := private.itwo_clean(p_attachment_note);
  v_is_urgent boolean := coalesce(p_is_urgent, false);
  v_today_th date := (now() at time zone 'Asia/Bangkok')::date;
  v_is_it_approver boolean;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_work_order_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_dept from public.departments d where d.id = v_actor.department_id;
  if v_dept.id is null or not v_dept.is_active then
    raise exception 'แผนกของคุณยังไม่ได้ตั้งค่าหรือถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  -- ตรวจข้อมูลที่กรอก (ข้อความภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ)
  if p_request_type is null or p_request_type not in ('design', 'system_access', 'misc') then
    raise exception 'กรุณาเลือกประเภทคำขอ' using errcode = 'check_violation';
  end if;
  if p_attachment_flag is null or p_attachment_flag not in ('yes', 'no', 'other') then
    raise exception 'กรุณาเลือกเอกสารแนบ (มี / ไม่มี / อื่นๆ)' using errcode = 'check_violation';
  end if;
  if v_details is null then
    raise exception 'กรุณากรอกรายละเอียดงาน' using errcode = 'check_violation';
  end if;
  if char_length(v_details) > 2000 then
    raise exception 'รายละเอียดงานต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_order_ref is not null and char_length(v_order_ref) > 100 then
    raise exception 'เลขที่ออเดอร์ต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_attachment_flag = 'other' then
    if v_attach_note is null then
      raise exception 'กรุณาระบุรายละเอียดเอกสารแนบ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_attach_note) > 200 then
      raise exception 'รายละเอียดเอกสารแนบต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- มี / ไม่มี ไม่ต้องมีหมายเหตุ ล้างทิ้งกันข้อมูลตกค้าง
    v_attach_note := null;
  end if;
  if p_needed_date is null then
    raise exception 'กรุณาระบุวันที่ต้องการงาน' using errcode = 'check_violation';
  end if;
  -- เทียบกับ "วันนี้ตามเวลาไทย" ไม่ใช่ UTC (วันนี้เลือกได้ แต่ย้อนหลังไม่ได้)
  if p_needed_date < v_today_th then
    raise exception 'วันที่ต้องการงานต้องไม่ใช่วันที่ผ่านมาแล้ว' using errcode = 'check_violation';
  end if;

  -- เลือกเส้นทางอนุมัติ
  v_is_it_approver := private.itwo_is_it_approver(v_actor.id);
  v_dept_is_it := private.itwo_is_it_department(v_dept.id);
  v_actor_is_dept_role := private.itwo_is_dept_approver(v_actor.id, v_dept.id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itwo_dept_approvers(v_dept.id, v_actor.is_test) a(id) where a.id <> v_actor.id);

  if v_is_it_approver then
    -- ผู้อนุมัติขั้น IT แจ้งเอง: อนุมัติในตัวทั้งสองขั้น ถือว่าอนุมัติครบทันที
    v_status := 'approved';
  else
    -- ต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ ไม่เช่นนั้นใบจะค้างโดยไม่มีใครอนุมัติได้
    if not private.itwo_has_active_it_approver(v_actor.is_test) then
      raise exception 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT' using errcode = 'check_violation';
    end if;
    if v_dept_is_it then
      -- ผู้แจ้งอยู่แผนก IT: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น (บันทึกตอนอนุมัติ)
      v_status := 'pending_it_mgr';
    elsif v_actor_is_dept_role then
      -- ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยของแผนกตัวเอง: ข้ามขั้นแผนก (บันทึก dept_approved ด้านล่าง)
      v_status := 'pending_it_mgr';
    elsif not v_has_dept_approvers then
      -- แผนกไม่มีผู้จัดการ/ผู้ช่วย: ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
      v_status := 'pending_it_mgr';
    else
      v_status := 'pending_dept';
    end if;
  end if;

  -- เลขที่เอกสาร: ล็อกแถวตัวนับของปีนั้นจนจบ transaction จึงไม่ซ้ำแม้กดพร้อมกัน
  select n.year_ce, n.seq_no, n.doc_no
    into v_doc_year, v_doc_seq, v_doc_no
  from private.itwo_next_doc_no(v_actor.is_test) n;

  insert into public.itwo_work_orders as wo (
    is_test, doc_no, doc_year, doc_seq, requester_id, department_id,
    request_type, order_ref, attachment_flag, attachment_note, details, needed_date, is_urgent, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    p_request_type, v_order_ref, p_attachment_flag, v_attach_note, v_details, p_needed_date, v_is_urgent, v_status
  ) returning wo.id into v_work_order_id;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved / it_mgr_approved)
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_work_order_id, v_actor.id, 'created',
    case when not v_is_it_approver and not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_is_it_approver then
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_actor.is_test, v_work_order_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งงาน');
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_actor.is_test, v_work_order_id, v_actor.id, 'it_mgr_approved', 'ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งงาน');
  elsif v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_actor.is_test, v_work_order_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งงาน');
  end if;

  id := v_work_order_id;
  doc_no := v_doc_no;
  return next;
end;
$$;

-- 10. RPC: อนุมัติ / ไม่อนุมัติ ---------------------------------------------------------
-- ฟังก์ชันภายในตัวเดียว (lock แถวใบ for update กันกดพร้อมกัน/กดซ้ำ ทุกอย่างอยู่ใน transaction เดียว)
create or replace function private.itwo_decide(p_work_order_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itwo_clean(p_reason);
  v_wo public.itwo_work_orders%rowtype;
  v_caps record;
  v_dept_done boolean;
  v_it_done boolean;
  v_new_status text;
begin
  v_actor := private.itwo_actor();

  -- ไม่อนุมัติต้องมีเหตุผล (ตรวจก่อนแตะข้อมูลใบ)
  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' using errcode = 'check_violation';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id = v_actor.id then
    raise exception 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบสั่งงานที่ตัวเองเป็นผู้แจ้งได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'in_progress') then
    raise exception '%', private.itwo_status_message(v_wo.status) using errcode = 'check_violation';
  end if;

  select * into v_caps from private.itwo_approval_caps(v_wo.id, v_actor.id);
  if v_caps.rejected then
    raise exception 'ใบสั่งงานนี้ไม่อนุมัติไปแล้ว' using errcode = 'check_violation';
  end if;

  if not v_caps.can_dept and not v_caps.can_it then
    -- บอกเหตุผลให้ตรงที่สุด
    if private.itwo_is_it_approver(v_actor.id) then
      if v_caps.it_done then
        raise exception 'ใบสั่งงานนี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว' using errcode = 'check_violation';
      end if;
      raise exception 'ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
    elsif v_caps.actor_is_dept_role and not v_caps.dept_is_it then
      raise exception 'ใบสั่งงานนี้ผู้จัดการแผนกพิจารณาไปแล้ว' using errcode = 'check_violation';
    end if;
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้' using errcode = 'insufficient_privilege';
  end if;

  v_dept_done := v_caps.dept_done;
  v_it_done := v_caps.it_done;

  if p_approve then
    if v_caps.can_it then
      -- ผู้อนุมัติขั้น IT: ถ้าขั้นแผนกยังไม่ผ่านและไม่ต้องรอใคร กดครั้งเดียวบันทึกทั้งสองขั้นในชื่อเขา
      if not v_dept_done then
        insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
        values (v_wo.is_test, v_wo.id, v_actor.id, 'dept_approved',
          case
            when v_caps.dept_is_it then 'ผู้แจ้งอยู่แผนก IT ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            when v_caps.actor_is_dept_role then 'ผู้อนุมัติเป็นผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้แจ้งและเป็นผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            else 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
          end);
        v_dept_done := true;
      end if;
      insert into public.itwo_events (is_test, work_order_id, actor_id, action)
      values (v_wo.is_test, v_wo.id, v_actor.id, 'it_mgr_approved');
      v_it_done := true;
    else
      insert into public.itwo_events (is_test, work_order_id, actor_id, action)
      values (v_wo.is_test, v_wo.id, v_actor.id, 'dept_approved');
      v_dept_done := true;
    end if;
  else
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_wo.is_test, v_wo.id, v_actor.id,
            case when v_caps.can_it then 'it_mgr_rejected' else 'dept_rejected' end, v_reason);
  end if;

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที (รวมงานด่วนที่ IT เริ่มทำแล้ว) · อนุมัติ = เลื่อนเฉพาะใบที่ยังรออนุมัติ
  -- (ใบที่เดินหน้าไปแล้ว in_progress บันทึก event อย่างเดียว ไม่ดึงสถานะถอยกลับ)
  if not p_approve then
    v_new_status := 'rejected';
  elsif v_wo.status in ('pending_dept', 'pending_it_mgr') then
    v_new_status := case
      when v_dept_done and v_it_done then 'approved'
      when v_dept_done then 'pending_it_mgr'
      else v_wo.status
    end;
  else
    v_new_status := v_wo.status;
  end if;
  if v_new_status is distinct from v_wo.status then
    update public.itwo_work_orders set status = v_new_status where id = v_wo.id;
  end if;
end;
$$;
revoke all on function private.itwo_decide(uuid, boolean, text) from public, anon, authenticated;

create or replace function public.app_itwo_approve(p_work_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itwo_decide(p_work_order_id, true, null);
end;
$$;

create or replace function public.app_itwo_reject(p_work_order_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itwo_decide(p_work_order_id, false, p_reason);
end;
$$;

-- 11. RPC: ยกเลิก / เริ่มงาน / ปิดงาน / ยืนยันรับงาน -----------------------------------
create or replace function public.app_itwo_cancel(p_work_order_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itwo_clean(p_reason);
  v_wo public.itwo_work_orders%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
    raise exception '%', case v_wo.status
      when 'it_closed' then 'IT ปิดงานแล้ว ไม่สามารถยกเลิกได้'
      when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
  end if;

  update public.itwo_work_orders set status = 'cancelled' where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'cancelled', v_reason);
end;
$$;

-- IT เริ่มทำงาน: ได้เมื่ออนุมัติครบ (approved) หรืองานด่วนที่ยังรออนุมัติ
create or replace function public.app_itwo_start(p_work_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if not (v_wo.status = 'approved' or (v_wo.is_urgent and v_wo.status in ('pending_dept', 'pending_it_mgr'))) then
    raise exception '%', case
      when v_wo.status in ('pending_dept', 'pending_it_mgr')
        then 'ใบสั่งงานปกติต้องอนุมัติครบทั้งสองขั้นก่อนจึงจะเริ่มทำได้ (เฉพาะงานด่วนเริ่มก่อนอนุมัติครบได้)'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;

  update public.itwo_work_orders set status = 'in_progress' where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'started');
end;
$$;

-- IT ปิดงาน (รอผู้แจ้งยืนยัน): ต้องกำลังดำเนินการ และอนุมัติครบทั้งสองขั้นแล้ว (งานด่วนจบได้เมื่ออนุมัติครบเท่านั้น)
create or replace function public.app_itwo_complete(p_work_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
  v_dept_done boolean;
  v_it_done boolean;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ปิดงานได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.status <> 'in_progress' then
    raise exception '%', case
      when v_wo.status in ('pending_dept', 'pending_it_mgr', 'approved')
        then 'ใบสั่งงานต้องอยู่ในสถานะกำลังดำเนินการ (กดเริ่มทำก่อน) จึงจะปิดงานได้'
      when v_wo.status = 'it_closed' then 'IT ปิดงานใบนี้ไปแล้ว'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;

  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itwo_event_state(v_wo.id) s;
  if not v_dept_done and not v_it_done then
    raise exception 'ปิดงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน' using errcode = 'check_violation';
  elsif not v_dept_done then
    raise exception 'ปิดงานไม่ได้ ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
  elsif not v_it_done then
    raise exception 'ปิดงานไม่ได้ ต้องรอผู้อนุมัติขั้น IT อนุมัติก่อน' using errcode = 'check_violation';
  end if;

  update public.itwo_work_orders set status = 'it_closed' where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'completed');
end;
$$;

-- ผู้แจ้งยืนยันว่าได้รับงานแล้ว (จบ)
create or replace function public.app_itwo_receive(p_work_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status <> 'it_closed' then
    raise exception '%', case
      when v_wo.status = 'received' then 'ใบสั่งงานนี้ยืนยันรับงานไปแล้ว'
      when v_wo.status in ('cancelled', 'rejected') then private.itwo_status_message(v_wo.status)
      else 'ยังยืนยันรับงานไม่ได้ เพราะ IT ยังไม่ปิดงาน'
    end using errcode = 'check_violation';
  end if;

  update public.itwo_work_orders set status = 'received' where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'received');
end;
$$;

-- 12. RPC: บันทึกส่วน "สำหรับแผนก IT" (แทนที่ชุดเดิมทั้งหมดของใบนั้น) ----------------------
-- p_changes = array ของ {system, action, new_username, old_username, note} · array ว่าง = ล้างรายการ · ผิดแถวไหนก็ไม่เปลี่ยนอะไรเลย
create or replace function public.app_itwo_save_access_changes(p_work_order_id uuid, p_changes jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
  v_row record;
  v_field text;
  v_system text;
  v_action text;
  v_new_user text;
  v_old_user text;
  v_note text;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกส่วนสำหรับแผนก IT ได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  -- แก้ได้เฉพาะใบที่ยังไม่ปิด: approved / in_progress / งานด่วนที่ยังรออนุมัติ
  if not (v_wo.status in ('approved', 'in_progress')
          or (v_wo.is_urgent and v_wo.status in ('pending_dept', 'pending_it_mgr'))) then
    raise exception '%', case v_wo.status
      when 'it_closed' then 'ใบสั่งงานนี้ IT ปิดงานแล้ว แก้ไขส่วนสำหรับแผนก IT ไม่ได้'
      when 'received' then 'ใบสั่งงานนี้ IT ปิดงานแล้ว แก้ไขส่วนสำหรับแผนก IT ไม่ได้'
      when 'cancelled' then 'ใบสั่งงานนี้ถูกยกเลิกแล้ว แก้ไขส่วนสำหรับแผนก IT ไม่ได้'
      when 'rejected' then 'ใบสั่งงานนี้ไม่อนุมัติ แก้ไขส่วนสำหรับแผนก IT ไม่ได้'
      else 'ต้องอนุมัติครบก่อนจึงจะบันทึกส่วนสำหรับแผนก IT ได้ (เฉพาะงานด่วนบันทึกได้ก่อน)'
    end using errcode = 'check_violation';
  end if;

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'ข้อมูลสิทธิ์ในระบบไม่ถูกต้อง (ต้องเป็นรายการ)' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_changes) > 20 then
    raise exception 'บันทึกสิทธิ์ในระบบได้ไม่เกิน 20 รายการต่อใบ' using errcode = 'check_violation';
  end if;

  delete from public.itwo_access_changes where work_order_id = v_wo.id and is_test = v_wo.is_test;

  for v_row in
    select e.value as item, e.ordinality as line_no
    from jsonb_array_elements(p_changes) with ordinality as e(value, ordinality)
  loop
    if jsonb_typeof(v_row.item) <> 'object' then
      raise exception 'รายการที่ % ของสิทธิ์ในระบบไม่ถูกต้อง', v_row.line_no using errcode = 'check_violation';
    end if;
    foreach v_field in array array['system', 'action', 'new_username', 'old_username', 'note'] loop
      if jsonb_typeof(v_row.item -> v_field) not in ('string', 'null') then
        raise exception 'รายการที่ %: ช่อง % ต้องเป็นข้อความ', v_row.line_no, v_field using errcode = 'check_violation';
      end if;
    end loop;

    v_system := v_row.item ->> 'system';
    v_action := v_row.item ->> 'action';
    v_new_user := private.itwo_clean(v_row.item ->> 'new_username');
    v_old_user := private.itwo_clean(v_row.item ->> 'old_username');
    v_note := private.itwo_clean(v_row.item ->> 'note');

    if v_system is null or v_system not in ('i_prime', 'express', 'email', 'other') then
      raise exception 'รายการที่ %: กรุณาเลือกระบบให้ถูกต้อง (I-Prime, Express, E-Mail, อื่นๆ)', v_row.line_no
        using errcode = 'check_violation';
    end if;
    if v_action is null or v_action not in ('add', 'change', 'cancel') then
      raise exception 'รายการที่ %: กรุณาเลือกการดำเนินการให้ถูกต้อง (เพิ่ม, เปลี่ยน, ยกเลิก)', v_row.line_no
        using errcode = 'check_violation';
    end if;
    if char_length(coalesce(v_new_user, '')) > 100 or char_length(coalesce(v_old_user, '')) > 100 then
      raise exception 'รายการที่ %: ชื่อผู้ใช้ต้องไม่เกิน 100 ตัวอักษร', v_row.line_no using errcode = 'check_violation';
    end if;
    if char_length(coalesce(v_note, '')) > 500 then
      raise exception 'รายการที่ %: หมายเหตุต้องไม่เกิน 500 ตัวอักษร', v_row.line_no using errcode = 'check_violation';
    end if;

    insert into public.itwo_access_changes
      (is_test, work_order_id, line_no, system, action, new_username, old_username, note)
    values
      (v_wo.is_test, v_wo.id, v_row.line_no::smallint, v_system, v_action, v_new_user, v_old_user, v_note);
  end loop;
end;
$$;

-- 13. RPC อ่าน: รายละเอียดใบ / ใบของฉัน / รออนุมัติ / งาน IT ------------------------------
-- รายละเอียดทั้งใบสำหรับหน้ารายละเอียดและพิมพ์ · ไม่มีสิทธิ์หรือไม่มีใบ = error เหมือนกัน (ไม่บอกว่าใบมีอยู่หรือไม่)
-- เป็นทางเดียวที่ผู้แจ้งเห็น "ชื่อผู้ทำ event" (ตาราง employees ของคนอื่นอ่านไม่ได้)
create or replace function public.app_itwo_get_detail(p_work_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id;
  if v_wo.id is null or not private.itwo_can_view(v_wo, v_actor) then
    raise exception 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_wo.id,
    'is_test', v_wo.is_test,
    'doc_no', v_wo.doc_no,
    'doc_year', v_wo.doc_year,
    'doc_seq', v_wo.doc_seq,
    'requester_id', v_wo.requester_id,
    'department_id', v_wo.department_id,
    'request_type', v_wo.request_type,
    'order_ref', v_wo.order_ref,
    'attachment_flag', v_wo.attachment_flag,
    'attachment_note', v_wo.attachment_note,
    'details', v_wo.details,
    'needed_date', v_wo.needed_date,
    'is_urgent', v_wo.is_urgent,
    'status', v_wo.status,
    'created_at', v_wo.created_at,
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_wo.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_wo.department_id),
    -- ประวัติ ISO เรียงตาม id (identity = ลำดับเหตุการณ์จริง) พร้อมชื่อผู้ทำ
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ev.id,
               'action', ev.action,
               'reason', ev.reason,
               'created_at', ev.created_at,
               'actor_employee_no', a.employee_no,
               'actor_full_name', a.first_name || ' ' || a.last_name
             ) order by ev.id), '[]'::jsonb)
      from public.itwo_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.work_order_id = v_wo.id),
    'access_changes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ac.id,
               'system', ac.system,
               'action', ac.action,
               'new_username', ac.new_username,
               'old_username', ac.old_username,
               'note', ac.note
             ) order by ac.line_no, ac.id), '[]'::jsonb)
      from public.itwo_access_changes ac
      where ac.work_order_id = v_wo.id),
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itwo_events ev join public.employees a on a.id = ev.actor_id
        where ev.work_order_id = v_wo.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itwo_events ev join public.employees a on a.id = ev.actor_id
        where ev.work_order_id = v_wo.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    'allowed_actions', to_jsonb(private.itwo_allowed_actions(v_wo, v_actor))
  );
end;
$$;

-- ใบของฉัน (ผู้แจ้ง = ผู้เรียก)
create or replace function public.app_itwo_list_mine()
returns table (
  id uuid,
  doc_no text,
  status text,
  is_urgent boolean,
  request_type text,
  details text,
  needed_date date,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  return query
  select wo.id, wo.doc_no, wo.status, wo.is_urgent, wo.request_type, wo.details, wo.needed_date, wo.created_at
  from public.itwo_work_orders wo
  where wo.requester_id = v_actor.id and wo.is_test = v_actor.is_test
  order by wo.created_at desc, wo.doc_year desc, wo.doc_seq desc;
end;
$$;

-- ใบที่ "รอผู้เรียกอนุมัติ" (เงื่อนไขชุดเดียวกับตอนอนุมัติ ผ่าน private.itwo_approval_caps)
-- เรียง: งานด่วนก่อน แล้ววันที่ต้องการงาน แล้วเวลาที่แจ้ง (เท่ากันเรียงตามเลขที่เอกสาร)
create or replace function public.app_itwo_list_pending_approvals()
returns table (
  id uuid,
  doc_no text,
  request_type text,
  details text,
  needed_date date,
  is_urgent boolean,
  status text,
  created_at timestamptz,
  requester_name text,
  department_name text,
  pending_step text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  return query
  select wo.id, wo.doc_no, wo.request_type, wo.details, wo.needed_date, wo.is_urgent, wo.status, wo.created_at,
         req.first_name || ' ' || req.last_name, d.name_th,
         case when caps.can_it then 'it_mgr' else 'dept' end
  from public.itwo_work_orders wo
  join public.departments d on d.id = wo.department_id
  join public.employees req on req.id = wo.requester_id
  cross join lateral private.itwo_approval_caps(wo.id, v_actor.id) caps
  where wo.is_test = v_actor.is_test
    and wo.requester_id <> v_actor.id
    and wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress')
    and (caps.can_dept or caps.can_it)
  order by wo.is_urgent desc, wo.needed_date, wo.created_at, wo.doc_year, wo.doc_seq;
end;
$$;

-- จำนวนใบที่รอผู้เรียกอนุมัติ (ป้ายตัวเลขบนเมนู)
create or replace function public.app_itwo_pending_count()
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_count integer;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  select count(*)::integer into v_count
  from public.itwo_work_orders wo
  cross join lateral private.itwo_approval_caps(wo.id, v_actor.id) caps
  where wo.is_test = v_actor.is_test
    and wo.requester_id <> v_actor.id
    and wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress')
    and (caps.can_dept or caps.can_it);
  return v_count;
end;
$$;

-- ทุกใบสำหรับหน้างาน IT (เฉพาะผู้อยู่ใน itwo_staff) เรียง: งานด่วนก่อน แล้ววันที่ต้องการงาน แล้วเวลาที่แจ้ง
create or replace function public.app_itwo_list_it()
returns table (
  id uuid,
  doc_no text,
  status text,
  is_urgent boolean,
  request_type text,
  details text,
  needed_date date,
  created_at timestamptz,
  requester_full_name text,
  department_name text,
  has_dept_approved boolean,
  has_it_mgr_approved boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_staff(v_actor.id) then
    raise exception 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select wo.id, wo.doc_no, wo.status, wo.is_urgent, wo.request_type, wo.details, wo.needed_date, wo.created_at,
         req.first_name || ' ' || req.last_name, d.name_th,
         exists (select 1 from public.itwo_events ev where ev.work_order_id = wo.id and ev.action = 'dept_approved'),
         exists (select 1 from public.itwo_events ev where ev.work_order_id = wo.id and ev.action = 'it_mgr_approved')
  from public.itwo_work_orders wo
  join public.departments d on d.id = wo.department_id
  join public.employees req on req.id = wo.requester_id
  where wo.is_test = v_actor.is_test
  order by wo.is_urgent desc, wo.needed_date, wo.created_at, wo.doc_year, wo.doc_seq;
end;
$$;

-- 14. RPC: เลขที่เอกสารถัดไป (it_admin) ---------------------------------------------------
-- ดูเลขปัจจุบันของปีหนึ่ง (ค่าเริ่มต้น = ปีปัจจุบันตามเวลาไทย)
create or replace function public.app_itwo_get_doc_counter(p_year integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Bangkok'))::integer);
  v_last integer;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(max(c.last_seq), 0) into v_last
  from public.itwo_doc_counters c where c.is_test = v_actor.is_test and c.doc_year = v_year;
  return jsonb_build_object(
    'year', v_year, 'last_seq', v_last, 'next_seq', v_last + 1,
    'next_doc_no', private.itwo_format_doc_no(v_actor.is_test, v_year, v_last + 1),
    'is_test', v_actor.is_test);
end;
$$;

-- ตั้งเลขถัดไป: เดินหน้าอย่างเดียว (ห้ามถอยหรือซ้ำเลขที่ใช้แล้ว) พร้อมบันทึก log ลบไม่ได้
--   เช่น ตอนใช้จริงให้นับต่อจากทะเบียนกระดาษ: ตั้ง p_next = 101 ใบถัดไปจะได้ IT06-26/101
create or replace function public.app_itwo_set_next_doc_seq(p_next integer, p_year integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_this_year integer := extract(year from (now() at time zone 'Asia/Bangkok'))::integer;
  v_year integer := coalesce(p_year, extract(year from (now() at time zone 'Asia/Bangkok'))::integer);
  v_last integer;
  v_max_used integer;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้' using errcode = 'insufficient_privilege';
  end if;
  if p_next is null or p_next < 1 or p_next > 9999 then
    raise exception 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999' using errcode = 'check_violation';
  end if;
  if v_year < v_this_year or v_year > v_this_year + 1 then
    raise exception 'ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า' using errcode = 'check_violation';
  end if;

  -- ล็อกแถวตัวนับ (สร้างถ้ายังไม่มี) กันชนกับการออกเลขที่กำลังเกิดขึ้น
  insert into public.itwo_doc_counters (is_test, doc_year, last_seq)
  values (v_actor.is_test, v_year, 0)
  on conflict (is_test, doc_year) do nothing;
  select c.last_seq into v_last
  from public.itwo_doc_counters c
  where c.is_test = v_actor.is_test and c.doc_year = v_year
  for update;
  select coalesce(max(wo.doc_seq), 0) into v_max_used
  from public.itwo_work_orders wo
  where wo.is_test = v_actor.is_test and wo.doc_year = v_year;
  v_last := greatest(v_last, v_max_used);

  if p_next < v_last + 1 then
    raise exception 'ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง %, เลขถัดไปต้องไม่น้อยกว่า %)', v_last, v_last + 1
      using errcode = 'check_violation';
  end if;

  if p_next > v_last + 1 then
    update public.itwo_doc_counters set last_seq = p_next - 1, updated_at = now()
    where is_test = v_actor.is_test and doc_year = v_year;
    insert into public.itwo_admin_log (is_test, actor_id, action, detail)
    values (v_actor.is_test, v_actor.id, 'doc_seq_set',
            jsonb_build_object('year', v_year, 'previous_next', v_last + 1, 'new_next', p_next));
  end if;
  return jsonb_build_object(
    'year', v_year, 'next_seq', p_next,
    'next_doc_no', private.itwo_format_doc_no(v_actor.is_test, v_year, p_next), 'is_test', v_actor.is_test);
end;
$$;

-- 15. RPC: จัดการสิทธิ์ IT (itwo_staff) เฉพาะ it_admin ของจริง -----------------------------
create or replace function public.app_itwo_list_staff()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  department_name text,
  is_it_admin boolean,
  is_it_approver boolean,
  is_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.name_th, s.is_it_admin, s.is_it_approver, e.is_active
  from public.itwo_staff s
  join public.employees e on e.id = s.employee_id
  join public.departments d on d.id = e.department_id
  where e.is_test = v_actor.is_test
  order by e.employee_no;
end;
$$;

-- ตั้งสิทธิ์ IT ของพนักงานหนึ่งคน (ทั้งสองเป็น false = ถอนสิทธิ์) · บันทึกลง itwo_admin_log ที่ลบไม่ได้
-- กฎ (ISO แยกหน้าที่):
--   1) แก้แถว itwo_staff ของ "ตัวเอง" ไม่ได้ทุกกรณี (ทั้งเพิ่ม เปลี่ยน และถอน) กันผู้ดูแลงาน IT ยกตัวเองเป็นผู้อนุมัติขั้น IT
--      (อนุมัติใบที่ตัวเองรับทำเอง) และกันล็อกตัวเองออก · ต้องให้ผู้ดูแลงาน IT คนอื่นเป็นผู้ตั้งให้
--   2) ต้องเหลือผู้ดูแลงาน IT และผู้อนุมัติขั้น IT ที่ใช้งานอยู่ (ผูกบัญชีล็อกอินแล้ว ไม่ใช่ lab-only) อย่างน้อยอย่างละ 1 คน
--      (ข้อ 1 ทำให้ผู้ตั้งซึ่งเป็น admin ที่ใช้งานอยู่ยังอยู่เสมอ ข้อ 2 จึงเป็นด่านซ้อน และกันกรณีผู้อนุมัติคนสุดท้ายถูกถอน)
create or replace function public.app_itwo_set_staff(p_employee_no text, p_is_it_admin boolean, p_is_it_approver boolean)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
  v_admin boolean := coalesce(p_is_it_admin, false);
  v_approver boolean := coalesce(p_is_it_approver, false);
  v_old public.itwo_staff%rowtype;
  v_action text;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if v_actor.is_test then
    raise exception 'ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้' using errcode = 'check_violation';
  end if;
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_target
  from public.employees e
  where e.employee_no = upper(btrim(coalesce(p_employee_no, ''))) and not e.is_test and e.deleted_at is null;
  if v_target.id is null then
    raise exception 'ไม่พบรหัสพนักงานนี้' using errcode = 'check_violation';
  end if;
  -- ห้ามแก้สิทธิ์ของตัวเอง (ตรวจก่อนทุกอย่าง รวมกรณีไม่มีอะไรเปลี่ยน เพื่อให้ผลเหมือนกันเสมอ)
  if v_target.id = v_actor.id then
    raise exception 'ไม่สามารถแก้สิทธิ์ทีม IT ของตัวเองได้ กรุณาให้ผู้ดูแลงาน IT คนอื่นเป็นผู้ตั้งให้' using errcode = 'insufficient_privilege';
  end if;
  if (v_admin or v_approver) and not v_target.is_active then
    raise exception 'พนักงานคนนี้ถูกปิดการใช้งาน ตั้งสิทธิ์ทีม IT ไม่ได้' using errcode = 'check_violation';
  end if;

  -- ล็อกทั้งตาราง (มีไม่กี่แถว) กันสองคนแก้พร้อมกันจนเหลือไม่ครบ
  lock table public.itwo_staff in exclusive mode;
  select * into v_old from public.itwo_staff s where s.employee_id = v_target.id;

  if v_old.employee_id is null and not (v_admin or v_approver) then
    return;
  end if;
  if v_old.employee_id is not null and v_old.is_it_admin = v_admin and v_old.is_it_approver = v_approver then
    return;
  end if;

  if not (v_admin or v_approver) then
    delete from public.itwo_staff where employee_id = v_target.id;
    v_action := 'staff_removed';
  elsif v_old.employee_id is null then
    insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, updated_by)
    values (v_target.id, v_admin, v_approver, v_actor.id);
    v_action := 'staff_added';
  else
    update public.itwo_staff
    set is_it_admin = v_admin, is_it_approver = v_approver, updated_by = v_actor.id, updated_at = now()
    where employee_id = v_target.id;
    v_action := 'staff_changed';
  end if;

  if not exists (
    select 1 from public.itwo_staff s join public.employees e on e.id = s.employee_id
    where s.is_it_admin and e.is_active and e.auth_user_id is not null and e.deleted_at is null and not e.is_test
      and upper(e.employee_no) <> all (private.lab_only_employee_nos())) then
    raise exception 'ต้องเหลือผู้ดูแลงาน IT ที่ใช้งานอยู่อย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;
  if not private.itwo_has_active_it_approver(false) then
    raise exception 'ต้องเหลือผู้อนุมัติขั้น IT ที่ใช้งานอยู่อย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;

  insert into public.itwo_admin_log (is_test, actor_id, action, target_employee_id, detail)
  values (false, v_actor.id, v_action, v_target.id, jsonb_build_object(
    'employee_no', v_target.employee_no,
    'old', case when v_old.employee_id is null then null
                else jsonb_build_object('is_it_admin', v_old.is_it_admin, 'is_it_approver', v_old.is_it_approver) end,
    'new', jsonb_build_object('is_it_admin', v_admin, 'is_it_approver', v_approver)));
end;
$$;

-- 16. ล้างข้อมูลทดสอบ (โหมดทดสอบของ admin) -----------------------------------------------
-- ลบเฉพาะแถว is_test ทั้งหมดของโมดูลนี้ (รวมประวัติ) และเริ่มนับเลข TEST-… ใหม่ · ข้อมูลจริงไม่ถูกแตะ
-- ต้องเป็น admin จริงและอยู่ในโหมดทดสอบ (เหมือน app_sandbox_purge_bom)
create or replace function public.app_sandbox_purge_itwo()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกตารางเขียนของโมดูลทั้งหมดไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นแจ้ง/อนุมัติใบทดสอบพร้อมกันระหว่างล้าง
  -- จนเหลือแถวลูกกำพร้า หรือได้เลข TEST- ที่ชนกับตัวนับที่กำลังถูกลบ · ถ้าสั่งพร้อมกัน ฝั่งที่มาทีหลังจะรอแล้วทำงานหลังล้างเสร็จ
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> ส่วนสิทธิ์ -> ประวัติ -> admin_log) กัน deadlock
  lock table public.itwo_doc_counters, public.itwo_work_orders, public.itwo_access_changes,
             public.itwo_events, public.itwo_admin_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itwo.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itwo.purge', 'on', true);

  foreach v_table in array array['itwo_events', 'itwo_access_changes', 'itwo_admin_log', 'itwo_work_orders', 'itwo_doc_counters'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform set_config('itwo.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITWO_SANDBOX_PURGE', 'itwo_work_orders', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- 17. สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจพนักงานและบทบาทซ้ำอีกชั้น) anon เรียกไม่ได้ ------
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itwo\_%' or p.proname = 'app_sandbox_purge_itwo')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
