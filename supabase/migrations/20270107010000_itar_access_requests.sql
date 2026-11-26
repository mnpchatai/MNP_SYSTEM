-- ============================================================================
-- ใบขอสิทธิ์ IT (ฟอร์มกระดาษ IT01-FM08 · USER-REQ + USER-Page · เลขที่ IT08-01-YY/NNN) — โมดูลของระบบสำนักงาน › IT SUPPORT
-- ขั้นที่ 4 ตามสเปก Work-Order/docs/it-user-access-spec.md (เจ้าของตอบ "ตามที่แนะนำ" 26/11/2026) · ส่วนฐานข้อมูลอย่างเดียว (ยังไม่มีหน้าเว็บ)
-- สัญญาสำหรับหน้าเว็บ: docs/itar-contract.md
--
-- โครงกับที่มา
--   คัดโครงจากใบแจ้งซ่อม (itrp_*) ฉบับล่าสุดบน main (20261212 + กติกาผู้อนุมัติขั้น IT 20261230) แล้วปรับเป็น "ใบขอสิทธิ์":
--     - ใบมี 3 ประเภท: new ขอใหม่ (ยังไม่มีในทะเบียน) / change เปลี่ยนแปลง / revoke_all ยกเลิกทั้งหมด (ลาออก/ย้าย) · เหตุผลรวมบังคับ · ไม่มีงานด่วน
--     - รายการสิทธิ์ที่ขอ (itar_request_items): kind = folder / internet / program / email · เก็บ "ค่าเดิม -> ค่าใหม่" ที่ผู้ยื่นเห็นตอนยื่น
--       IT ตัดสินทีละแถว (itar_item_results: applied / rejected + เหตุผลเมื่อ rejected) ตอนกด "บันทึกลงทะเบียน"
--     - ไม่มีรอบขอแก้ไขงาน · ไม่มีบันทึกการซ่อม/อะไหล่
--   ผู้ยื่น (requester) กับผู้รับสิทธิ์ (subject) แยกกัน: ผู้รับสิทธิ์ = พนักงานที่มีบัญชี (subject_employee_id) และ/หรือผู้ใช้ในทะเบียนสิทธิ์ itua_users (subject_user_id)
--     หรือคนที่ไม่มีบัญชี (เก็บเฉพาะชื่อ/แผนก/ฝ่ายเป็น snapshot) · แผนกที่ใช้เดินอนุมัติ (department_id) = แผนกของผู้รับสิทธิ์
--
-- กติกา (ตัดสินที่ฐานข้อมูล)
--   - ผู้ยื่น: พนักงานยื่นได้เฉพาะของตัวเอง · IT (itwo_staff.is_it_admin) ยื่นแทนใครก็ได้ รวมคนที่ไม่มีบัญชี ·
--     ผู้จัดการ/ผู้ช่วยผู้จัดการแผนก ยื่นแทนลูกน้องในแผนกตัวเองได้เฉพาะประเภท revoke_all
--   - อนุมัติ 2 ขั้นแบบใบสั่งงาน/ใบแจ้งซ่อม: ขั้นแผนก = ผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้รับสิทธิ์ (ใครกดก่อน) · แผนกไม่มีผู้จัดการ/ผู้ช่วย (ไม่นับผู้ยื่น/ผู้รับสิทธิ์)
--     -> ผู้อนุมัติขั้น IT กดครั้งเดียวนับสองขั้น · ผู้ยื่นเป็นผู้จัดการแผนกของผู้รับสิทธิ์เอง -> ข้ามขั้นแผนก (บันทึก dept_approved ในชื่อผู้ยื่น)
--   - ผู้อนุมัติขั้น IT = itwo_staff.is_it_approver (IT3462) · ใบที่ผู้ยื่นหรือผู้รับสิทธิ์เป็นผู้อนุมัติขั้น IT เอง -> หัวหน้า IT (is_it_viewer = FANG) อนุมัติแทน
--     ห้ามอนุมัติใบที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ · ไม่อนุมัติ = จบทันที (ต้องมีเหตุผล) · ถามผู้ยื่น -> รอผู้ยื่นตอบ ระหว่างรอห้ามอนุมัติ/ไม่อนุมัติ
--   - สถานะ: pending_dept -> pending_it_mgr -> approved -> in_progress (IT กดรับงาน) -> awaiting_ack (IT บันทึกลงทะเบียนแล้ว รอผู้ใช้รับทราบ) -> done
--     ปลายทางอื่น: rejected / cancelled · need_info (รอผู้ยื่นตอบ) · revoke_all หลังบันทึกลงทะเบียนไป done เลย (ไม่ต้องรอรับทราบ)
--   - ยกเลิก: ผู้ยื่น หรือ IT (ยกเลิกแทน ประวัติขึ้นต้น "IT ยกเลิกแทนผู้ยื่น: ") ได้ก่อนบันทึกลงทะเบียนเท่านั้น (เหตุผลบังคับ) · หลังบันทึกลงทะเบียนยกเลิกไม่ได้ (ต้องยื่นใบใหม่เพื่อย้อน)
--   - app_itar_apply (IT ที่เป็นทั้ง itwo_staff.is_it_admin และ itas_admins ของโหมดนั้น): atomic ทั้งใบ — ตรวจค่าเดิมทุกแถวตรงกับทะเบียนปัจจุบันก่อน (ไม่ตรง = 40001
--     ไม่เปลี่ยนอะไรเลย) แล้วเขียนทะเบียนผ่าน RPC app_itua_* เดิม (ประวัติ itua_log ครบ) พร้อมอ้างเลขใบ
--   - รับทราบ: ผู้รับสิทธิ์ที่มีบัญชีกดเอง (ลง itua_acknowledgements: snapshot สิทธิ์ทั้งหมดหลังเปลี่ยน + เวอร์ชันนโยบาย) · คนไม่มีบัญชี IT กด "รับทราบแล้ว (กระดาษ)"
--     ต้องแนบรูปใบที่เซ็นอย่างน้อย 1 ไฟล์
--
-- ที่มาของการเปลี่ยนในประวัติทะเบียน (itua_log.source_request_id / source_doc_no) — ปลอมไม่ได้
--   replace private.itua_log() (ฉบับเดิมของขั้นที่ 1 ตั้ง null เสมอ): อ่านค่าอ้างอิงจากตัวแปร transaction-local itua.source_event_id ซึ่งตั้งได้เฉพาะ
--   private.itar_begin_apply(event_id) (ถอนสิทธิ์จาก public/anon/authenticated · เรียกจาก app_itar_apply เท่านั้น) และ trigger ยอมรับก็ต่อเมื่อ event นั้นมีอยู่จริง
--   เป็น action 'applied' ของใบที่ status = in_progress ในโหมดเดียวกัน · เลขใบอ่านจากตาราง ไม่เชื่อค่าที่ส่งมา · ไม่ผ่านเงื่อนไข = null (ไม่ error)
--
-- ISO: itar_events / itar_admin_log / itar_comments / itar_attachments / itar_request_items / itar_item_results เพิ่มได้อย่างเดียว (trigger กัน UPDATE/DELETE/TRUNCATE)
--   ใบ (itar_requests) ลบไม่ได้ เปลี่ยนได้แค่ status (+ info_return_status คู่กับ need_info) และ subject_user_id/applied_summary ครั้งเดียว (null -> ค่า ตอนบันทึกลงทะเบียน)
--   การลบมีทางเดียวคือ app_sandbox_purge_itar (เฉพาะแถว is_test) · เลขที่เอกสารออกฝั่งฐานข้อมูลแบบ lock แถวตัวนับ
--   ไม่มีรหัสผ่าน/ความลับในตาราง itar_* และไม่มีใน RPC ใด (ช่องลับของทะเบียนรอ security-auditor)
--
-- โหมดทดสอบ (Admin Sandbox): ทุกตารางมี is_test + trigger private.sandbox_row_scope · เลขเอกสารทดสอบ TEST-IT08-01-YY/NNN · ใบทดสอบไม่ส่งแจ้งเตือน
--   persona = ของ itwo เดิม (SBX-IT-ADMIN อยู่ใน itas_admins โหมดทดสอบ) · bucket ไฟล์: itar-files (จริง) / itar-test-files (ทดสอบ) private 20 MB
--
-- สิ่งที่แตะ (นอกจากของใหม่ itar_* ทั้งหมด)
--   1) replace private.sandbox_unguarded_tables() — ฐานคือนิยามบน prod/main หลัง 20270105010000 (97 ชื่อ) + ต่อท้าย 8 ตาราง itar_*
--      md5(pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure)) บน prod 26/11/2026 = acfa6d1b47e0874f69f0f0140584b1f3
--      ก่อน apply ต้องเทียบ md5 ซ้ำ · ไม่ตรง = หยุดแล้วใช้ฉบับล่าสุดเป็นฐาน (migration ตรวจเองว่าชื่อเดิมครบ ถ้าขาดจะ raise)
--   2) replace private.itua_log() — เพิ่มการอ่านที่มา (ดูข้างบน) นอกนั้นคงเดิมทุกบรรทัด
--      md5(pg_get_functiondef('private.itua_log()'::regprocedure)) บน prod 26/11/2026 = fd8daa398d88d95ede085c272114903d
--   3) storage.buckets เพิ่ม itar-files / itar-test-files + storage.objects policy ชื่อ itar_* (ไม่แตะ policy ของบัคเก็ตอื่น)
--   4) อ่านอย่างเดียว: itwo_staff, itas_admins, itua_* , employees, departments, roles, notifications (ผ่าน private.office_notify เดิม ไม่ replace) · เขียน itua_* ผ่าน RPC app_itua_* เดิมเท่านั้น
--      และเขียน itua_acknowledgements โดยตรงใน app_itar_acknowledge / app_itar_acknowledge_paper (ตาราง append-only ที่ขั้นที่ 1 สร้างไว้ให้ขั้นนี้)
--   ไม่แตะ: ตาราง/ฟังก์ชัน/trigger ของ itwo, itrp, itas · ฟังก์ชัน app_itua_* · private.office_notify · ตัวกรองแผนก ID ของแจ้งเตือน
--      (พนักงานแผนก ID ยังไม่ได้รับแจ้งเตือนของ /office/access/ — ถ้าต้องการต้อง replace private.department_notification_allowed แยกต่างหาก)
--
-- ลำดับ deploy: ตารางและ RPC ใหม่ล้วน ยังไม่มีหน้าเว็บเรียก · apply ก่อน merge หน้าเว็บ (ขั้นที่ 5) · ต้อง deploy notify-email/notify-push ตอนเพิ่มเส้นทาง /office/access/ ที่ขั้นที่ 5
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod (ต้องไม่ใหม่กว่า 20270106010000 ที่ replace ฟังก์ชันด้านบน), md5 ทั้งสองค่า, itas_admins มี IT3462 (โหมดจริง),
--   itwo_staff มี IT3462 (admin+approver) กับ FANG (viewer) · หลัง apply ตรวจ: relrowsecurity ของ 8 ตาราง, ไม่มี grant ตรง, RPC anon เรียกไม่ได้, bucket private
--
-- Rollback (ยังไม่มีข้อมูลจริง): drop policy itar_* บน storage.objects · ลบ bucket itar-files/itar-test-files (ว่างเปล่า ผ่าน Storage API) · drop trigger itar_events_notify ·
--   drop function public.app_itar_*, public.app_sandbox_purge_itar, private.itar_* · drop table itar_item_results, itar_request_items, itar_attachments, itar_comments, itar_events,
--   itar_admin_log, itar_requests, itar_doc_counters (ลูกก่อนแม่) · create or replace private.itua_log() และ private.sandbox_unguarded_tables() กลับเป็นนิยามของ 20270105010000
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itua_users') is null or to_regclass('public.itua_acknowledgements') is null
     or to_regprocedure('private.itua_log()') is null or to_regprocedure('public.app_itua_set_grants(uuid, jsonb, text)') is null then
    raise exception 'ไม่พบทะเบียนสิทธิ์ผู้ใช้ (itua_*) กรุณา apply 20270105010000_itua_user_access_register.sql ก่อน';
  end if;
  if to_regclass('public.itwo_staff') is null
     or not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'itwo_staff' and c.column_name = 'is_it_viewer') then
    raise exception 'ไม่พบ itwo_staff.is_it_viewer (กติกาหัวหน้า IT) กรุณา apply 20261230010000_office_it_approver_worktime.sql ก่อน';
  end if;
  if to_regclass('public.itas_admins') is null then
    raise exception 'ไม่พบ itas_admins (ทะเบียนอุปกรณ์ IT) กรุณา apply 20261222010000_itas_asset_register.sql ก่อน';
  end if;
  if not exists (select 1 from public.departments where code = 'IT') then
    raise exception 'ไม่พบแผนก IT (departments.code = ''IT'') ซึ่งโมดูลใบขอสิทธิ์ใช้กำหนดเส้นทางอนุมัติ';
  end if;
  if not exists (select 1 from public.roles where code = 'department_manager')
     or not exists (select 1 from public.roles where code = 'assistant_department_manager') then
    raise exception 'ไม่พบบทบาท department_manager / assistant_department_manager';
  end if;
  if to_regprocedure('private.office_notify(uuid, text, text, text, uuid)') is null then
    raise exception 'ไม่พบ private.office_notify (migration แจ้งเตือนของระบบสำนักงาน) กรุณา apply ก่อน';
  end if;
  if not ('itua_acknowledgements' = any (private.sandbox_unguarded_tables())) then
    raise exception 'private.sandbox_unguarded_tables() ยังไม่ใช่ฉบับของ 20270105010000 กรุณา apply ก่อน (รายชื่อต้องต่อจากฉบับนั้น)';
  end if;
end;
$$;

-- เก็บรายชื่อเดิมไว้ตรวจหลัง replace ว่าไม่มีชื่อใดหาย (ตารางชั่วคราวของ session นี้ · ลบทิ้งท้ายขั้นที่ 5 · ไม่ใช้ on commit drop
-- เพราะถ้าตัวรันไม่ห่อทั้งไฟล์ใน transaction เดียว ตารางจะหายก่อนถึงขั้นตรวจ)
drop table if exists pg_temp.itar_old_unguarded;
create temp table itar_old_unguarded as
  select t from unnest(private.sandbox_unguarded_tables()) as t;

-- 1. ตาราง -----------------------------------------------------------------------
-- ตัวนับเลขที่เอกสารรายปี แยกชุดของจริง/ทดสอบ (ใช้ผ่านฟังก์ชันเท่านั้น)
create table public.itar_doc_counters (
  is_test boolean not null default false,
  doc_year integer not null check (doc_year between 2000 and 2999),
  last_seq integer not null default 0 check (last_seq between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (is_test, doc_year)
);

create table public.itar_requests (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  doc_no text not null unique,
  doc_year integer not null,
  doc_seq integer not null check (doc_seq >= 1),
  requester_id uuid not null references public.employees(id),
  request_type text not null check (request_type in ('new', 'change', 'revoke_all')),
  reason text not null check (btrim(reason) <> '' and char_length(reason) <= 2000),
  -- แผนกที่ใช้เดินอนุมัติขั้นแผนก = แผนกของผู้รับสิทธิ์
  department_id uuid not null references public.departments(id),
  -- ผู้รับสิทธิ์ที่มีบัญชีพนักงาน (รับทราบในเว็บได้) · null = ไม่มีบัญชี (รับทราบด้วยกระดาษ)
  subject_employee_id uuid references public.employees(id),
  -- ผู้ใช้ในทะเบียนสิทธิ์ (itua_users) · null = ยังไม่ผูก (ขอใหม่ หรือพนักงานที่ยังไม่มีในทะเบียน) · ตั้งได้ครั้งเดียวตอน IT บันทึกลงทะเบียน
  -- ไม่ใช้ FK: ผู้ใช้ทะเบียนลบไม่ได้อยู่แล้ว และไม่ให้ล้างข้อมูลทดสอบของทะเบียนติดขัดเพราะใบทดสอบอ้างอยู่
  subject_user_id uuid,
  -- snapshot ชื่อ/แผนก/ฝ่ายของผู้รับสิทธิ์ ณ ตอนยื่น (ใช้แสดง/พิมพ์ แม้ภายหลังข้อมูลทะเบียนเปลี่ยน)
  subject_name_th text check (subject_name_th is null or (btrim(subject_name_th) <> '' and char_length(subject_name_th) <= 200 and subject_name_th !~ '[[:cntrl:]]')),
  subject_name_en text check (subject_name_en is null or (btrim(subject_name_en) <> '' and char_length(subject_name_en) <= 200 and subject_name_en !~ '[[:cntrl:]]')),
  subject_department_code text check (subject_department_code is null or (btrim(subject_department_code) <> '' and char_length(subject_department_code) <= 50 and subject_department_code !~ '[[:cntrl:]]')),
  subject_division text check (subject_division is null or subject_division in ('office', 'factory', 'manager', 'office_indesign')),
  status text not null default 'pending_dept'
    check (status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'awaiting_ack', 'done', 'rejected', 'cancelled', 'need_info')),
  -- สถานะที่ใบจะกลับไปหลังผู้ยื่นตอบคำถาม (ใช้คู่กับ status = need_info เท่านั้น)
  info_return_status text,
  -- สรุป "ก่อน -> หลัง" ของสิทธิ์ที่ IT บันทึกลงทะเบียน (ตั้งครั้งเดียวพร้อมเปลี่ยนสถานะเป็น awaiting_ack/done)
  applied_summary jsonb,
  created_at timestamptz not null default now(),
  unique (is_test, doc_year, doc_seq),
  unique (id, is_test),
  constraint itar_requests_subject_name_ck check (subject_name_th is not null or subject_name_en is not null),
  -- ขอใหม่ต้องระบุฝ่าย (ใช้สร้างผู้ใช้ในทะเบียน)
  constraint itar_requests_new_division_ck check (request_type <> 'new' or subject_division is not null),
  constraint itar_requests_applied_summary_ck check (applied_summary is null or jsonb_typeof(applied_summary) = 'object'),
  -- ใบที่บันทึกลงทะเบียนแล้ว (awaiting_ack/done) ต้องมีสรุปสิทธิ์และผู้ใช้ในทะเบียนเสมอ
  constraint itar_requests_applied_ck check (status not in ('awaiting_ack', 'done') or (applied_summary is not null and subject_user_id is not null)),
  constraint itar_requests_info_return_status_check check (
    (status = 'need_info' and info_return_status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress'))
    or (status <> 'need_info' and info_return_status is null))
);
create index itar_requests_requester_idx on public.itar_requests (requester_id);
create index itar_requests_department_idx on public.itar_requests (department_id);
create index itar_requests_subject_employee_idx on public.itar_requests (subject_employee_id) where subject_employee_id is not null;
create index itar_requests_subject_user_idx on public.itar_requests (subject_user_id) where subject_user_id is not null;
create index itar_requests_status_idx on public.itar_requests (is_test, status);
comment on table public.itar_requests is
  'ใบขอสิทธิ์ IT (เลขที่ IT08-01-YY/NNN) · ลบไม่ได้ เปลี่ยนได้แค่ status (+ info_return_status) และ subject_user_id/applied_summary ครั้งเดียวตอนบันทึกลงทะเบียน · เขียนผ่าน app_itar_* เท่านั้น';

-- ประวัติสำหรับ ISO (ลายเซ็นอิเล็กทรอนิกส์): เพิ่มได้อย่างเดียว id (identity) เรียงตามลำดับเหตุการณ์จริง
create table public.itar_events (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  request_id uuid not null,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in (
    'created', 'dept_approved', 'dept_rejected', 'it_mgr_approved', 'it_mgr_rejected',
    'cancelled', 'started', 'applied', 'acknowledged', 'info_requested', 'info_provided')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itar_requests (id, is_test),
  unique (id, request_id)
);
create index itar_events_req_idx on public.itar_events (request_id, is_test, id);
create index itar_events_actor_idx on public.itar_events (actor_id);
comment on table public.itar_events is
  'ประวัติการดำเนินการของใบขอสิทธิ์สำหรับ ISO · เพิ่มได้อย่างเดียว ห้ามแก้/ลบ (trigger) · ถือเป็นลายเซ็นอิเล็กทรอนิกส์';

-- ประวัติการตั้งเลขเอกสารถัดไป (เพิ่มได้อย่างเดียว)
create table public.itar_admin_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in ('doc_seq_set')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index itar_admin_log_actor_idx on public.itar_admin_log (actor_id);
comment on table public.itar_admin_log is 'ประวัติการตั้งเลขที่เอกสารถัดไปของใบขอสิทธิ์ · เพิ่มได้อย่างเดียว (trigger)';

-- รายการสิทธิ์ที่ขอ (เพิ่มได้อย่างเดียว) · 1 แถวต่อ 1 สิ่งที่จะเปลี่ยน
--   kind = folder: target = รหัสโฟลเดอร์ (ตัวพิมพ์ใหญ่) · from/to = null (ไม่มีสิทธิ์) | R | F
--   kind = internet: target ว่าง · from/to = 'true' | 'false' · note = เหตุผลที่ขอใช้อินเทอร์เน็ต (บังคับเมื่อขอเพิ่ม ตรวจที่ RPC)
--   kind = program: target = รหัสโปรแกรม · from/to = 'true' | 'false' · note = ระบุโปรแกรม (บังคับเมื่อรหัส OTHER)
--   kind = email: target = ที่อยู่อีเมล (ตัวพิมพ์เล็ก) · to = 'add' | 'close' · email_kind = internal | extra เมื่อ add · from ว่างเสมอ
--   from_known = false: ผู้รับสิทธิ์ยังไม่ผูกกับผู้ใช้ในทะเบียนตอนยื่น จึงไม่รู้ค่าเดิม (from ว่าง) · IT เลือกผู้ใช้ตอนดำเนินการ แล้วระบบเทียบกับทะเบียนจริง
create table public.itar_request_items (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  line_no smallint not null check (line_no between 1 and 80),
  kind text not null check (kind in ('folder', 'internet', 'program', 'email')),
  target text check (target is null or (btrim(target) <> '' and char_length(target) <= 200 and target !~ '[[:cntrl:]]')),
  from_known boolean not null default true,
  from_value text,
  to_value text,
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500 and note !~ '[[:cntrl:]]')),
  email_kind text check (email_kind is null or email_kind in ('internal', 'extra')),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itar_requests (id, is_test),
  unique (request_id, line_no),
  unique (id, request_id),
  constraint itar_items_from_unknown_ck check (from_known or from_value is null),
  constraint itar_items_shape_ck check (
    (kind = 'folder' and target is not null and (from_value is null or from_value in ('R', 'F')) and (to_value is null or to_value in ('R', 'F'))
       and (from_value is distinct from to_value or not from_known) and email_kind is null)
    or (kind = 'internet' and target is null and to_value in ('true', 'false') and (from_value is null or from_value in ('true', 'false'))
       and from_value is distinct from to_value and email_kind is null and (from_known = (from_value is not null)))
    or (kind = 'program' and target is not null and to_value in ('true', 'false') and (from_value is null or from_value in ('true', 'false'))
       and from_value is distinct from to_value and email_kind is null and (from_known = (from_value is not null)))
    or (kind = 'email' and target is not null and to_value in ('add', 'close') and from_value is null
       and ((to_value = 'add') = (email_kind is not null)))
  )
);
-- 1 สิ่งที่ขอต่อ 1 แถว (โฟลเดอร์/โปรแกรม/อีเมลเดียวกันซ้ำไม่ได้)
create unique index itar_items_target_uk on public.itar_request_items (request_id, kind, coalesce(target, ''));
comment on table public.itar_request_items is
  'รายการสิทธิ์ที่ขอในใบขอสิทธิ์ (ก่อน -> หลัง) · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itar_create เท่านั้น';

-- ผลที่ IT ตัดสินทีละแถวตอนบันทึกลงทะเบียน (เพิ่มได้อย่างเดียว) · rejected ต้องมีเหตุผล
create table public.itar_item_results (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  item_id uuid not null unique,
  decision text not null check (decision in ('applied', 'rejected')),
  reason text check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 500)),
  decided_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itar_requests (id, is_test),
  foreign key (item_id, request_id) references public.itar_request_items (id, request_id),
  constraint itar_item_results_reason_ck check ((decision = 'rejected') = (reason is not null))
);
create index itar_item_results_req_idx on public.itar_item_results (request_id, is_test);
create index itar_item_results_decided_by_idx on public.itar_item_results (decided_by);
comment on table public.itar_item_results is
  'ผลที่ IT ตัดสินต่อรายการ (บันทึกลงทะเบียน/ไม่บันทึก + เหตุผล) · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itar_apply เท่านั้น';

-- คำถาม/คำตอบ "ถามกลับผู้ยื่น" (เพิ่มได้อย่างเดียว) id (identity) = ลำดับจริง
create table public.itar_comments (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  request_id uuid not null,
  kind text not null check (kind in ('question', 'answer')),
  -- ขั้นที่ถาม: dept = ผู้อนุมัติแผนก · it_mgr = ผู้อนุมัติขั้น IT · it = ทีม IT
  stage text not null check (stage in ('dept', 'it_mgr', 'it')),
  author_id uuid not null references public.employees(id),
  body text not null check (btrim(body) <> '' and char_length(body) <= 2000),
  reply_to bigint,
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itar_requests (id, is_test),
  unique (id, request_id),
  foreign key (reply_to, request_id) references public.itar_comments (id, request_id),
  constraint itar_comments_reply_kind check ((kind = 'question') = (reply_to is null))
);
-- คำถามหนึ่งข้อตอบได้ครั้งเดียว
create unique index itar_comments_one_answer_idx on public.itar_comments (reply_to) where reply_to is not null;
create index itar_comments_req_idx on public.itar_comments (request_id, is_test, id);
create index itar_comments_author_idx on public.itar_comments (author_id);
comment on table public.itar_comments is
  'คำถาม/คำตอบ "ถามกลับผู้ยื่น" ของใบขอสิทธิ์ · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itar_request_info / app_itar_provide_info เท่านั้น';

-- ทะเบียนไฟล์แนบ (เพิ่มได้อย่างเดียว) · comment_id ว่างและ is_paper_ack = false = แนบตอนยื่น · is_paper_ack = true = รูปใบรับทราบที่เซ็นด้วยกระดาษ (IT แนบ)
-- ตัวไฟล์อยู่ใน Storage (บัคเก็ตตามโหมดของใบ)
create table public.itar_attachments (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  comment_id bigint,
  is_paper_ack boolean not null default false,
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itar_requests (id, is_test),
  constraint itar_attachments_comment_fk foreign key (comment_id, request_id) references public.itar_comments (id, request_id),
  -- ผูกได้อย่างใดอย่างหนึ่ง (ข้อความ หรือใบรับทราบกระดาษ) ไม่ใช่ทั้งสอง
  constraint itar_attachments_one_owner check (comment_id is null or not is_paper_ack),
  -- ไฟล์ต้องอยู่ใต้โฟลเดอร์ของใบขอสิทธิ์ตัวเองเสมอ
  constraint itar_attachments_path_in_request_folder check (starts_with(storage_path, request_id::text || '/'))
);
create index itar_attachments_req_idx on public.itar_attachments (request_id, is_test, created_at);
create index itar_attachments_comment_idx on public.itar_attachments (comment_id) where comment_id is not null;
create index itar_attachments_uploaded_by_idx on public.itar_attachments (uploaded_by);
comment on table public.itar_attachments is
  'ทะเบียนไฟล์แนบของใบขอสิทธิ์ · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itar_add_attachment / app_itar_add_comment_attachment / app_itar_add_paper_attachment เท่านั้น';

-- 2. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itar_doc_counters', 'itar_requests', 'itar_events', 'itar_admin_log', 'itar_request_items', 'itar_item_results',
    'itar_comments', 'itar_attachments'
  ] loop
    -- ถอน service_role ด้วย: ตารางบันทึก ISO ต้องไม่ถูกเขียนตรงด้วย secret key (RPC เป็น SECURITY DEFINER เจ้าของ postgres ไม่กระทบ)
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    -- identity sequence ได้สิทธิ์ตาม default privileges เช่นกัน (หาจาก pg_depend · ตารางที่ไม่มี identity จะไม่มีแถว)
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

-- 3. ตัวช่วย trigger: ISO + กติกาของข้อมูล ---------------------------------------------
-- ลบได้เฉพาะแถวทดสอบ ภายใน app_sandbox_purge_itar (ตั้ง itar.purge = on แบบ transaction-local) แถวจริงลบไม่ได้เลย
create or replace function private.itar_purge_allowed(p_is_test boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_is_test and coalesce(current_setting('itar.purge', true), '') = 'on'
$$;

-- กันแก้/ลบประวัติ (events, admin_log, request_items, item_results, comments, attachments)
create or replace function private.itar_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if private.itar_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
end;
$$;

-- ใบขอสิทธิ์: ลบไม่ได้ · แก้ได้เฉพาะ status (+ info_return_status คู่กับ need_info) ตามตารางการเปลี่ยนสถานะ
--   subject_user_id (null -> ค่า) และ applied_summary (null -> ค่า) ตั้งได้ครั้งเดียวพร้อมการเปลี่ยน in_progress -> awaiting_ack/done เท่านั้น
--   ปลายทางคือ rejected / cancelled / done เปิดใหม่ไม่ได้
create or replace function private.itar_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itar_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ใบขอสิทธิ์ลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ใบขอสิทธิ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: ทุกคอลัมน์ยกเว้นที่ระบุด้านล่างต้องไม่เปลี่ยน
  if (new.id, new.is_test, new.doc_no, new.doc_year, new.doc_seq, new.requester_id, new.request_type, new.reason, new.department_id,
      new.subject_employee_id, new.subject_name_th, new.subject_name_en, new.subject_department_code, new.subject_division, new.created_at)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.request_type, old.reason, old.department_id,
      old.subject_employee_id, old.subject_name_th, old.subject_name_en, old.subject_department_code, old.subject_division, old.created_at) then
    raise exception 'ใบขอสิทธิ์แก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วยื่นใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled', 'need_info'))
    or (old.status = 'in_progress' and new.status in ('awaiting_ack', 'done', 'cancelled', 'need_info'))
    or (old.status = 'awaiting_ack' and new.status = 'done')
    -- need_info = รอผู้ยื่นตอบ: กลับสถานะเดิม (ตรวจต่อด้านล่าง) หรือจบด้วยยกเลิกเท่านั้น (ระหว่างรอคำตอบไม่อนุมัติไม่ได้)
    or (old.status = 'need_info' and new.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะใบขอสิทธิ์จาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- ถามกลับผู้ยื่น: ต้องบันทึกสถานะที่จะกลับไปให้ตรงกับสถานะก่อนถาม · ตอนกลับต้องเป็นสถานะที่บันทึกไว้เท่านั้น (ยกเว้นยกเลิก)
  if new.status = 'need_info' and old.status <> 'need_info' and new.info_return_status is distinct from old.status then
    raise exception 'ถามกลับผู้ยื่นต้องบันทึกสถานะเดิมของใบ (%) ไว้เป็นสถานะที่จะกลับไป', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'need_info' and new.status <> 'need_info'
     and new.status <> 'cancelled' and new.status is distinct from old.info_return_status then
    raise exception 'ใบที่รอผู้ยื่นตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (%) เท่านั้น', old.info_return_status using errcode = 'check_violation';
  end if;
  if new.status = old.status and new.info_return_status is distinct from old.info_return_status then
    raise exception 'แก้สถานะที่ใบจะกลับไปไม่ได้' using errcode = 'check_violation';
  end if;

  -- ผลการบันทึกลงทะเบียน: ตั้งได้ครั้งเดียว (null -> ค่า) พร้อมออกจาก in_progress ไป awaiting_ack/done เท่านั้น
  if new.applied_summary is distinct from old.applied_summary
     or new.subject_user_id is distinct from old.subject_user_id then
    if not (old.status = 'in_progress' and new.status in ('awaiting_ack', 'done')
            and old.applied_summary is null and (old.subject_user_id is null or new.subject_user_id = old.subject_user_id)) then
      raise exception 'แก้ผลการบันทึกลงทะเบียนหรือผู้ใช้ที่ผูกกับใบไม่ได้ (ตั้งได้ครั้งเดียวตอน IT บันทึกลงทะเบียน)' using errcode = 'insufficient_privilege';
    end if;
  end if;
  -- ออกจาก in_progress ไป awaiting_ack/done ได้ก็ต่อเมื่อมีเหตุการณ์ applied ของใบนี้แล้ว · ไป done จาก awaiting_ack ต้องมี acknowledged
  if old.status = 'in_progress' and new.status in ('awaiting_ack', 'done') and not exists (
       select 1 from public.itar_events e where e.request_id = old.id and e.action = 'applied') then
    raise exception 'ต้องบันทึกลงทะเบียน (applied) ก่อนเปลี่ยนสถานะเป็น %', new.status using errcode = 'check_violation';
  end if;
  if old.status = 'awaiting_ack' and new.status = 'done' and not exists (
       select 1 from public.itar_events e where e.request_id = old.id and e.action = 'acknowledged') then
    raise exception 'ต้องมีการรับทราบ (acknowledged) ก่อนจบใบ' using errcode = 'check_violation';
  end if;

  -- หลังบันทึกลงทะเบียนแล้วยกเลิกไม่ได้ (สิทธิ์เปลี่ยนไปแล้ว ต้องยื่นใบใหม่เพื่อย้อน)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
       select 1 from public.itar_events e where e.request_id = old.id and e.action = 'applied') then
    raise exception 'ใบนี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว ยกเลิกไม่ได้ (ต้องยื่นใบใหม่เพื่อย้อนสิทธิ์)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itar_request_guard() from public, anon, authenticated;

-- เหตุการณ์ที่เป็นหลักฐานบันทึกลงทะเบียน/รับทราบ ต้องเกิดในสถานะที่ถูกต้องเท่านั้น (ชั้นซ้อนของ RPC · ที่มาของ itua_log อ้างเหตุการณ์ applied)
create or replace function private.itar_events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
begin
  select r.status into v_status from public.itar_requests r where r.id = new.request_id and r.is_test = new.is_test;
  if new.action = 'applied' and v_status is distinct from 'in_progress' then
    raise exception 'บันทึกลงทะเบียนได้เฉพาะใบที่ IT กำลังดำเนินการ' using errcode = 'check_violation';
  end if;
  if new.action = 'acknowledged' and v_status is distinct from 'awaiting_ack' then
    raise exception 'รับทราบได้เฉพาะใบที่รอผู้ใช้รับทราบ' using errcode = 'check_violation';
  end if;
  if new.action = 'applied' and exists (
       select 1 from public.itar_events e where e.request_id = new.request_id and e.action = 'applied') then
    raise exception 'ใบนี้บันทึกลงทะเบียนไปแล้ว' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itar_events_guard() from public, anon, authenticated;

-- กติกาของข้อความที่ฐานข้อมูลบังคับเอง (ชั้นซ้อนของ RPC): คำถามเขียนโดยคนที่ไม่ใช่ผู้ยื่นและห้ามมีคำถามค้าง ·
-- คำตอบเขียนโดยผู้ยื่น อ้างคำถามจริงของใบเดียวกัน และใช้ขั้นเดียวกับคำถาม
create or replace function private.itar_comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_question public.itar_comments%rowtype;
begin
  select w.requester_id into v_requester_id from public.itar_requests w where w.id = new.request_id;
  if new.kind = 'question' then
    if new.author_id = v_requester_id then
      raise exception 'ผู้ยื่นถามกลับใบขอสิทธิ์ของตัวเองไม่ได้' using errcode = 'check_violation';
    end if;
    if exists (
         select 1 from public.itar_comments q
         where q.request_id = new.request_id and q.kind = 'question'
           and not exists (select 1 from public.itar_comments a where a.reply_to = q.id)) then
      raise exception 'ใบขอสิทธิ์นี้มีคำถามที่รอผู้ยื่นตอบอยู่แล้ว' using errcode = 'check_violation';
    end if;
  else
    if new.author_id is distinct from v_requester_id then
      raise exception 'เฉพาะผู้ยื่นเท่านั้นที่ตอบคำถามได้' using errcode = 'check_violation';
    end if;
    select * into v_question from public.itar_comments q
    where q.id = new.reply_to and q.request_id = new.request_id and q.kind = 'question';
    if v_question.id is null then
      raise exception 'คำตอบต้องอ้างถึงคำถามของใบขอสิทธิ์เดียวกัน' using errcode = 'check_violation';
    end if;
    if new.stage <> v_question.stage then
      raise exception 'คำตอบต้องใช้ขั้นเดียวกับคำถามที่ตอบ' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- ผลต่อรายการ (item_results) ต้องมาพร้อมเหตุการณ์ applied ของใบเดียวกันที่ผู้ตัดสินเป็นผู้กด (ชั้นซ้อนของ RPC)
create or replace function private.itar_item_results_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
       select 1 from public.itar_events e
       where e.request_id = new.request_id and e.is_test = new.is_test and e.action = 'applied' and e.actor_id = new.decided_by) then
    raise exception 'ผลต่อรายการต้องผูกกับเหตุการณ์บันทึกลงทะเบียนของใบเดียวกันและผู้กดคนเดียวกัน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itar_item_results_guard() from public, anon, authenticated;

-- 4. trigger: โหมดทดสอบ + เพิ่มได้อย่างเดียว + ด่านของแต่ละตาราง ------------------------------
-- (ใช้ private.sandbox_row_scope เดิมของ MNP_SYSTEM: INSERT กำหนด is_test จากโหมดผู้ทำรายการ ไม่รับจาก client, UPDATE/DELETE ตรวจโหมดตรงกัน)
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'itar_doc_counters', 'itar_requests', 'itar_events', 'itar_admin_log', 'itar_request_items', 'itar_item_results',
    'itar_comments', 'itar_attachments'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.sandbox_row_scope()',
                   v_table || '_sandbox_scope', v_table);
  end loop;
  -- เพิ่มได้อย่างเดียว: กัน UPDATE/DELETE (ยกเว้น purge แถวทดสอบ) และ TRUNCATE
  foreach v_table in array array[
    'itar_events', 'itar_admin_log', 'itar_request_items', 'itar_item_results', 'itar_comments', 'itar_attachments'
  ] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.itar_append_only_guard()',
                   v_table || '_append_only', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.itar_append_only_guard()',
                   v_table || '_no_truncate', v_table);
  end loop;
end $$;

create trigger itar_requests_guard before update or delete on public.itar_requests
  for each row execute function private.itar_request_guard();
create trigger itar_requests_no_truncate before truncate on public.itar_requests
  for each statement execute function private.itar_request_guard();
create trigger itar_events_insert_guard before insert on public.itar_events
  for each row execute function private.itar_events_guard();
create trigger itar_comments_insert_guard before insert on public.itar_comments
  for each row execute function private.itar_comments_guard();
create trigger itar_item_results_insert_guard before insert on public.itar_item_results
  for each row execute function private.itar_item_results_guard();

-- 5. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- เริ่มจากนิยามล่าสุดบน main/prod (20270105010000_itua_user_access_register.sql) ครบทุกชื่อ + เพิ่ม 8 ตาราง itar_* ในส่วน to_regclass (หลัง itua_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers','bom_order_requests',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions','itrp_part_changes',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log','itas_admins',
                                      'itua_users','itua_emails','itua_folders','itua_folder_grants','itua_programs',
                                      'itua_program_grants','itua_log','itua_acknowledgements',
                                      'itar_doc_counters','itar_requests','itar_events','itar_admin_log','itar_request_items',
                                      'itar_item_results','itar_comments','itar_attachments']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- ชื่อเดิมต้องไม่หายสักชื่อ (ถ้าหายแปลว่าฐานของ replace ไม่ใช่ฉบับล่าสุด)
do $$
declare
  v_missing text;
begin
  select string_agg(o.t, ', ' order by o.t) into v_missing
  from itar_old_unguarded o
  where not (o.t = any (private.sandbox_unguarded_tables()));
  if v_missing is not null then
    raise exception 'private.sandbox_unguarded_tables() ใหม่ทำชื่อเดิมหาย: % (ฐานไม่ใช่ฉบับล่าสุด หยุดแล้วตรวจ migration ของเพื่อน)', v_missing;
  end if;
end $$;
drop table pg_temp.itar_old_unguarded;

-- 6. ที่มาของการเปลี่ยนในประวัติทะเบียนสิทธิ์ (ปลอมไม่ได้) --------------------------------------
-- ตั้งตัวแปร transaction-local itua.source_event_id = id ของเหตุการณ์ applied ที่ app_itar_apply เพิ่งเพิ่ม · เรียกได้เฉพาะจากฟังก์ชัน SECURITY DEFINER (ถอนสิทธิ์ทุก role ท้ายไฟล์)
create or replace function private.itar_begin_apply(p_event_id bigint)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('itua.source_event_id', p_event_id::text, true);
end;
$$;

create or replace function private.itar_end_apply()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('itua.source_event_id', '', true);
end;
$$;

-- ฉบับเดิม: 20270105010000 (md5 บน prod fd8daa398d88d95ede085c272114903d) · แก้เฉพาะการหาที่มา v_source_id/v_source_doc และคอลัมน์ source_* ตอน insert
--   ที่มา = เหตุการณ์ applied (id จาก itua.source_event_id) ของใบที่ status = in_progress ในโหมดเดียวกับแถวที่เปลี่ยน · เลขใบอ่านจากตาราง ไม่รับจากผู้เรียก
--   ไม่ผ่านเงื่อนไข (หรือไม่ได้ตั้ง) = null ตามเดิม
create or replace function private.itua_log()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_is_test boolean;
  v_actor uuid;
  v_reason text;
  v_user_id uuid;
  v_entity_id uuid;
  v_code text;
  v_source_event bigint;
  v_source_id uuid;
  v_source_doc text;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);
  v_is_test := (v_row ->> 'is_test')::boolean;
  if private.itua_purge_allowed(v_is_test) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (v_new - 'updated_at' - 'updated_by') is not distinct from (v_old - 'updated_at' - 'updated_by') then
    return null;
  end if;

  v_actor := nullif(current_setting('itua.actor_id', true), '')::uuid;
  if tg_op <> 'DELETE' then
    v_actor := coalesce(v_actor, nullif(v_new ->> 'updated_by', '')::uuid);
  end if;
  if v_actor is null then
    if tg_op = 'INSERT' then
      return null;
    end if;
    raise exception 'ไม่ทราบผู้ทำรายการ จึงแก้หรือลบข้อมูลทะเบียนสิทธิ์ผู้ใช้ไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  v_reason := private.itua_clean(current_setting('itua.reason', true));
  if tg_op <> 'INSERT' and v_reason is null then
    raise exception 'ต้องระบุเหตุผลทุกครั้งที่แก้หรือถอดข้อมูลทะเบียนสิทธิ์ผู้ใช้ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
  end if;

  v_user_id := case
    when v_entity = 'user' then (v_row ->> 'id')::uuid
    when v_entity in ('folder', 'program') then null
    else (v_row ->> 'user_id')::uuid end;
  v_entity_id := case
    when v_entity = 'folder_grant' then (v_row ->> 'folder_id')::uuid
    when v_entity = 'program_grant' then (v_row ->> 'program_id')::uuid
    else (v_row ->> 'id')::uuid end;
  v_code := case
    when v_entity = 'user' then v_row ->> 'auth_id'
    when v_entity = 'email' then v_row ->> 'address'
    when v_entity in ('folder', 'program') then v_row ->> 'code'
    when v_entity = 'folder_grant' then (select f.code from public.itua_folders f where f.id = v_entity_id)
    else (select p.code from public.itua_programs p where p.id = v_entity_id) end;

  -- ที่มา: ใบขอสิทธิ์ที่กำลังบันทึกลงทะเบียน (ตั้งโดย private.itar_begin_apply เท่านั้น) · ตรวจกับตารางจริงทุกครั้ง
  begin
    v_source_event := nullif(current_setting('itua.source_event_id', true), '')::bigint;
  exception when others then
    v_source_event := null;
  end;
  if v_source_event is not null then
    select r.id, r.doc_no into v_source_id, v_source_doc
    from public.itar_events e
    join public.itar_requests r on r.id = e.request_id and r.is_test = e.is_test
    where e.id = v_source_event and e.action = 'applied' and e.is_test = v_is_test and r.status = 'in_progress';
  end if;

  insert into public.itua_log (is_test, user_id, entity, entity_id, entity_code, action, actor_id, reason, old_values, new_values,
                               source_request_id, source_doc_no)
  values (v_is_test, v_user_id, v_entity, v_entity_id, v_code,
          case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
          v_actor, v_reason, v_old, v_new, v_source_id, v_source_doc);
  return null;
end;
$$;

-- 7. เลขที่เอกสาร ------------------------------------------------------------------------
-- รูปแบบเลขที่: IT08-01-YY/NNN (เกิน 999 แสดงเต็มตัวเลข ไม่ตัดทิ้ง) · ทดสอบขึ้นต้น TEST-
create or replace function private.itar_format_doc_no(p_is_test boolean, p_year integer, p_seq integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_is_test then 'TEST-' else '' end
    || 'IT08-01-' || lpad((p_year % 100)::text, 2, '0') || '/'
    || case when p_seq < 1000 then lpad(p_seq::text, 3, '0') else p_seq::text end
$$;

-- ออกเลขที่เอกสาร (ฝั่งฐานข้อมูลเท่านั้น): ON CONFLICT DO UPDATE ล็อกแถวตัวนับของปีนั้น คนกดพร้อมกันจึงได้เลขไม่ซ้ำ
-- ปีคิดตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC · ใบทดสอบใช้ตัวนับแยก · p_now ไว้ให้เทสต์จำลองช่วงข้ามปี (การเรียกจริงใช้ now())
create or replace function private.itar_next_doc_no(p_is_test boolean, p_now timestamp with time zone default now(), out year_ce integer, out seq_no integer, out doc_no text)
returns record
language plpgsql
security definer
set search_path = ''
as $$
begin
  year_ce := extract(year from (p_now at time zone 'Asia/Bangkok'))::integer;
  insert into public.itar_doc_counters as c (is_test, doc_year, last_seq)
  values (p_is_test, year_ce, 1)
  on conflict (is_test, doc_year) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into seq_no;
  doc_no := private.itar_format_doc_no(p_is_test, year_ce, seq_no);
end;
$$;

-- 8. ตัวช่วยภายใน (private) ----------------------------------------------------------
-- ผู้ทำรายการของโมดูล: persona (ถ้า admin อยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานจริงที่ใช้งานอยู่ของ session นี้
create or replace function private.itar_actor()
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

-- เหมือน itar_actor แต่ไม่ raise (คืนแถวว่าง) ให้ policy ของ Storage ใช้
create or replace function private.itar_actor_quiet()
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
    return v_actor;
  end if;
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  select * into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.deleted_at is null and not e.is_test
  limit 1;
  return v_actor;
end;
$$;

-- ผู้อนุมัติขั้นแผนกของแผนกหนึ่งในโหมดหนึ่ง (เหมือน itwo/itrp)
--   ของจริง: active + ผูกบัญชีล็อกอินแล้ว + ไม่ถูกลบ + ไม่ใช่ persona + ไม่ใช่บัญชี lab-only · โหมดทดสอบ: persona ของแผนกนั้น
-- ดู role_id เท่านั้น "ไม่ใช้ acting_role_id" และไม่นับ factory_manager / general_manager
create or replace function private.itar_dept_approvers(p_department_id uuid, p_is_test boolean)
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

create or replace function private.itar_is_dept_approver(p_employee_id uuid, p_department_id uuid, p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.itar_dept_approvers(p_department_id, p_is_test) a(id) where a.id = p_employee_id)
$$;

-- สิทธิ์ทีม IT: "อ่านอย่างเดียว" จาก public.itwo_staff (ชุดเดียวกับใบสั่งงาน IT/ใบแจ้งซ่อม) · แก้สิทธิ์ที่ใบสั่งงาน IT เท่านั้น
create or replace function private.itar_is_it_admin(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_admin)
$$;

create or replace function private.itar_is_it_approver(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_approver)
$$;

-- หัวหน้า IT (ดูอย่างเดียว · อนุมัติขั้น IT เฉพาะใบที่ผู้ยื่น/ผู้รับสิทธิ์เป็นผู้อนุมัติขั้น IT เอง)
create or replace function private.itar_is_it_viewer(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_viewer)
$$;

create or replace function private.itar_is_staff(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id)
$$;

-- ผู้อยู่ใน allowlist ของทะเบียนอุปกรณ์/ทะเบียนสิทธิ์ (itas_admins) ในโหมดเดียวกัน = บันทึกลงทะเบียนสิทธิ์ผู้ใช้ได้
create or replace function private.itar_is_itas_admin(p_employee_id uuid, p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itas_admins a where a.employee_id = p_employee_id and a.is_test = p_is_test)
$$;

-- ใบนี้เกี่ยวข้องกับผู้อนุมัติขั้น IT โดยตรงไหม (ผู้ยื่นหรือผู้รับสิทธิ์เป็น is_it_approver) -> ขั้น IT ต้องให้หัวหน้า IT อนุมัติแทน
create or replace function private.itar_involves_it_approver(p_requester_id uuid, p_subject_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.itar_is_it_approver(p_requester_id)
      or (p_subject_employee_id is not null and private.itar_is_it_approver(p_subject_employee_id))
$$;

-- ผู้ทำรายการเป็น "ผู้อนุมัติขั้น IT" ของใบนี้หรือไม่
--   ใบทั่วไป = ผู้อนุมัติขั้น IT (is_it_approver) · ใบที่ผู้ยื่นหรือผู้รับสิทธิ์เป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) แทน
--   (ผู้อนุมัติขั้น IT อนุมัติใบที่ตัวเองเกี่ยวข้องไม่ได้ · ตรวจ "ห้ามอนุมัติใบตัวเอง" แยกที่ itar_approval_caps)
create or replace function private.itar_is_it_stage_approver(p_requester_id uuid, p_subject_employee_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.itar_involves_it_approver(p_requester_id, p_subject_employee_id) then private.itar_is_it_viewer(p_actor_id)
    else private.itar_is_it_approver(p_actor_id)
  end
$$;

-- มีผู้ที่ทำหน้าที่ผู้อนุมัติขั้น IT ใช้งานอยู่ในโหมดนี้หรือไม่ (p_involves = ใบที่เกี่ยวกับผู้อนุมัติขั้น IT -> นับหัวหน้า IT · ไม่ใช่ -> นับผู้อนุมัติ)
-- ของจริงนับเฉพาะคนที่ active + ผูกบัญชีล็อกอินแล้ว + ไม่ใช่บัญชี lab-only
create or replace function private.itar_has_active_stage_pool(p_is_test boolean, p_involves boolean)
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
    where case when p_involves then s.is_it_viewer else s.is_it_approver end
      and e.is_test = p_is_test and e.deleted_at is null
      and (
        p_is_test
        or (e.is_active
            and e.auth_user_id is not null
            and upper(e.employee_no) <> all (private.lab_only_employee_nos()))
      )
  )
$$;

-- แผนก IT ของโมดูลนี้ = departments.code 'IT'
create or replace function private.itar_is_it_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.departments d where d.id = p_department_id and d.code = 'IT')
$$;

-- ผู้ทำรายการเห็นใบนี้ได้ไหม: ผู้ยื่น / ผู้รับสิทธิ์ที่มีบัญชี / ทีม IT ใน itwo_staff (ทุกคน รวมหัวหน้า IT) / ผู้อนุมัติขั้นแผนกของแผนกผู้รับสิทธิ์
-- ใบต้องอยู่โหมดเดียวกับผู้ทำรายการ
create or replace function private.itar_can_view(p_req public.itar_requests, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_req.is_test = p_actor.is_test
    and (
      p_req.requester_id = p_actor.id
      -- ผู้รับสิทธิ์อาจไม่มีบัญชี (null) ต้องไม่ให้ null ลามไปทั้งเงื่อนไข (null = ไม่ใช่คนนี้)
      or coalesce(p_req.subject_employee_id = p_actor.id, false)
      or private.itar_is_staff(p_actor.id)
      or exists (select 1 from private.itar_dept_approvers(p_req.department_id, p_req.is_test) a(id) where a.id = p_actor.id)
    )
$$;

-- สถานะการอนุมัติของใบ (จาก events)
create or replace function private.itar_event_state(p_request_id uuid, out dept_done boolean, out it_done boolean, out rejected boolean)
returns record
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_or(e.action = 'dept_approved'), false),
         coalesce(bool_or(e.action = 'it_mgr_approved'), false),
         coalesce(bool_or(e.action in ('dept_rejected', 'it_mgr_rejected')), false)
  from public.itar_events e
  where e.request_id = p_request_id
$$;

-- สิทธิ์อนุมัติ/ไม่อนุมัติของผู้ทำรายการกับใบหนึ่ง (จุดตัดสินเดียว ใช้ทั้ง RPC อนุมัติ รายการรออนุมัติ และปุ่มในหน้ารายละเอียด)
--   can_dept = อนุมัติขั้นแผนกได้ · can_it = อนุมัติขั้น IT ได้ (ถ้า dept ยังไม่ผ่าน กดครั้งเดียวนับทั้งสองขั้น)
--   ห้ามอนุมัติใบที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ · ผู้อนุมัติขั้นแผนกไม่นับผู้ยื่น/ผู้รับสิทธิ์ (ถ้าไม่เหลือใคร = ผู้อนุมัติขั้น IT กดครั้งเดียว)
create or replace function private.itar_approval_caps(p_request_id uuid, p_actor_id uuid, out can_dept boolean, out can_it boolean, out dept_done boolean, out it_done boolean, out rejected boolean, out dept_is_it boolean, out has_dept_approvers boolean, out actor_is_dept_role boolean)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itar_requests%rowtype;
  v_actor public.employees%rowtype;
  v_is_it_approver boolean;
  v_open boolean;
begin
  can_dept := false;
  can_it := false;
  select * into v_req from public.itar_requests w where w.id = p_request_id;
  select * into v_actor from public.employees e where e.id = p_actor_id;
  if v_req.id is null or v_actor.id is null or v_req.is_test <> v_actor.is_test then
    return;
  end if;

  select s.dept_done, s.it_done, s.rejected into dept_done, it_done, rejected
  from private.itar_event_state(v_req.id) s;
  dept_is_it := private.itar_is_it_department(v_req.department_id);
  has_dept_approvers := exists (
    select 1 from private.itar_dept_approvers(v_req.department_id, v_req.is_test) a(id)
    where a.id <> v_req.requester_id and a.id is distinct from v_req.subject_employee_id);
  actor_is_dept_role := exists (
    select 1 from private.itar_dept_approvers(v_req.department_id, v_req.is_test) a(id) where a.id = p_actor_id);
  -- ขั้น IT: ใบทั่วไป = ผู้อนุมัติขั้น IT · ใบที่ผู้ยื่น/ผู้รับสิทธิ์เป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) อนุมัติแทน
  -- (ชื่อตัวแปรคงเดิม แต่ความหมายคือ "ผู้ทำรายการเป็นผู้อนุมัติขั้น IT ของใบนี้")
  v_is_it_approver := private.itar_is_it_stage_approver(v_req.requester_id, v_req.subject_employee_id, p_actor_id);

  -- need_info (รอผู้ยื่นตอบ) อยู่ในรายการเพื่อให้ผู้อนุมัติขั้นที่ยังค้างเห็นใบ · ทั้ง "อนุมัติ" และ "ไม่อนุมัติ" ถูกกันที่ private.itar_decide ให้รอคำตอบก่อน
  v_open := v_req.requester_id <> p_actor_id
    and v_req.subject_employee_id is distinct from p_actor_id
    and v_req.status in ('pending_dept', 'pending_it_mgr', 'need_info')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$$;

-- คำถามที่ค้างอยู่ของใบ (ยังไม่มีคำตอบ) ไม่มี = แถวว่าง
create or replace function private.itar_pending_question(p_request_id uuid)
returns public.itar_comments
language sql
stable
security definer
set search_path = ''
as $$
  select q from public.itar_comments q
  where q.request_id = p_request_id and q.kind = 'question'
    and not exists (select 1 from public.itar_comments a where a.reply_to = q.id)
  order by q.id desc
  limit 1
$$;

-- ขั้นที่ผู้ทำรายการถามผู้ยื่นได้ตอนนี้ (null = ถามไม่ได้) · ผู้รับสิทธิ์ที่ไม่ใช่ผู้ยื่นถามไม่ได้ (ไม่ใช่ผู้พิจารณา)
create or replace function private.itar_info_stage(p_req public.itar_requests, p_actor public.employees)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caps record;
begin
  if p_req.id is null or p_actor.id is null or p_req.is_test <> p_actor.is_test
     or p_req.requester_id = p_actor.id or coalesce(p_req.subject_employee_id = p_actor.id, false) then
    return null;
  end if;
  if p_req.status in ('pending_dept', 'pending_it_mgr') then
    select * into v_caps from private.itar_approval_caps(p_req.id, p_actor.id);
    if v_caps.can_it then
      return 'it_mgr';
    elsif v_caps.can_dept then
      return 'dept';
    end if;
  end if;
  if p_req.status in ('approved', 'in_progress') and private.itar_is_it_admin(p_actor.id) then
    return 'it';
  end if;
  return null;
end;
$$;

-- ตัวช่วยทั่วไป
create or replace function private.itar_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '')
$$;

create or replace function private.itar_status_message(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'cancelled' then 'ใบขอสิทธิ์นี้ถูกยกเลิกแล้ว'
    when 'rejected' then 'ใบขอสิทธิ์นี้ไม่อนุมัติไปแล้ว'
    when 'approved' then 'ใบขอสิทธิ์นี้อนุมัติครบแล้ว'
    when 'in_progress' then 'ใบขอสิทธิ์นี้ IT เริ่มดำเนินการไปแล้ว'
    when 'awaiting_ack' then 'ใบขอสิทธิ์นี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว กำลังรอผู้ใช้รับทราบ'
    when 'done' then 'ใบขอสิทธิ์นี้จบงานแล้ว'
    when 'need_info' then 'ใบขอสิทธิ์นี้รอผู้ยื่นตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้'
    else 'ใบขอสิทธิ์นี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้'
  end
$$;

-- ประเภทคำขอเป็นข้อความไทย (ใช้ในแจ้งเตือน)
create or replace function private.itar_type_text(p_request_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_request_type
    when 'new' then 'ขอสิทธิ์ใหม่'
    when 'change' then 'เปลี่ยนแปลงสิทธิ์'
    when 'revoke_all' then 'ยกเลิกสิทธิ์ทั้งหมด'
    else coalesce(p_request_type, '')
  end
$$;

-- ชื่อผู้รับสิทธิ์ที่แสดง (ไทยก่อน ไม่มีใช้อังกฤษ)
create or replace function private.itar_subject_name(p_req public.itar_requests)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_req.subject_name_th, p_req.subject_name_en)
$$;

-- มีการอนุมัติจริง (ไม่ใช่อนุมัติในตัวของผู้ยื่นเอง) แล้วหรือยัง: ใช้ปิดหน้าต่างแนบไฟล์ตอนยื่น
create or replace function private.itar_has_real_approval(p_request_id uuid, p_requester_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.itar_events e
    where e.request_id = p_request_id
      and e.action in ('dept_approved', 'it_mgr_approved')
      and e.actor_id <> p_requester_id
  )
$$;

-- หน้าต่างเวลาแนบไฟล์หลังสร้างใบ/ข้อความ (ที่เดียว ใช้ทั้ง policy ของ Storage และ RPC) · stable ไม่ใช่ immutable เพื่อให้ pgTAP แทนค่าได้
create or replace function private.itar_attach_window()
returns interval
language sql
stable
security definer
set search_path = ''
as $$ select interval '30 minutes' $$;

-- เวอร์ชันและข้อความนโยบายบนหน้ารับทราบ (เจ้าของยังไม่ส่งฉบับเต็ม — ใช้ประโยคเดิมบนฟอร์มไปก่อน · เปลี่ยนข้อความต้องขึ้นเวอร์ชันใหม่)
create or replace function private.itar_policy()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 'IT08-01/1',
    'text', 'ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์')
$$;

-- สิทธิ์ปัจจุบันของผู้ใช้ในทะเบียนหนึ่งคน (ใช้แสดงในใบ/หน้า IT และเป็น snapshot ตอนรับทราบ) · ไม่มีรหัสผ่านหรือช่องลับใด ๆ (ทะเบียนไม่มีช่องลับ)
--   คืน null ถ้าไม่พบผู้ใช้
create or replace function private.itar_subject_rights(p_user_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'auth_id', u.auth_id,
    'name_th', u.name_th,
    'name_en', u.name_en,
    'department_code', u.department_code,
    'division', u.division,
    'status', u.status,
    'internet', u.internet,
    'granted_doc_no', u.granted_doc_no,
    'granted_on', u.granted_on,
    'folders', coalesce((
      select jsonb_agg(jsonb_build_object('code', f.code, 'name', f.name, 'level', g.level, 'is_active', f.is_active) order by f.sort, f.code)
      from public.itua_folder_grants g join public.itua_folders f on f.id = g.folder_id
      where g.user_id = u.id), '[]'::jsonb),
    'programs', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'note', g.note, 'is_active', p.is_active) order by p.sort, p.code)
      from public.itua_program_grants g join public.itua_programs p on p.id = g.program_id
      where g.user_id = u.id), '[]'::jsonb),
    'emails', coalesce((
      select jsonb_agg(jsonb_build_object('address', m.address, 'kind', m.kind) order by m.kind, m.address)
      from public.itua_emails m
      where m.user_id = u.id and m.status = 'active'), '[]'::jsonb)
  )
  from public.itua_users u
  where u.id = p_user_id
$$;

-- การกระทำที่ผู้ทำรายการทำได้กับใบนี้ตอนนี้ (ให้หน้ารายละเอียดแสดงปุ่ม · ตรรกะเดียวกับ RPC แต่ละตัว)
create or replace function private.itar_allowed_actions(p_req public.itar_requests, p_actor public.employees)
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
begin
  if p_req.id is null or p_req.is_test <> p_actor.is_test then
    return v_actions;
  end if;
  v_is_admin := private.itar_is_it_admin(p_actor.id);

  -- ยกเลิกได้ก่อน IT บันทึกลงทะเบียนเท่านั้น · ผู้ยื่นยกเลิกเอง หรือผู้ดูแลงาน IT ยกเลิกแทน (ประวัติขึ้นต้น "IT ยกเลิกแทนผู้ยื่น: ")
  if (p_req.requester_id = p_actor.id or v_is_admin)
     and p_req.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info')
     and not exists (select 1 from public.itar_events e where e.request_id = p_req.id and e.action = 'applied') then
    v_actions := array_append(v_actions, 'cancel');
  end if;

  -- ระหว่างรอผู้ยื่นตอบ (need_info) ผู้อนุมัติทั้งอนุมัติและไม่อนุมัติไม่ได้ ต้องรอคำตอบก่อน
  select * into v_caps from private.itar_approval_caps(p_req.id, p_actor.id);
  if (v_caps.can_dept or v_caps.can_it) and p_req.status in ('pending_dept', 'pending_it_mgr') then
    v_actions := v_actions || array['approve', 'reject'];
  end if;

  -- start (กดรับงาน) ต้องเป็นผู้ดูแลงาน IT เมื่ออนุมัติครบแล้วเท่านั้น (ไม่มีงานด่วน)
  if v_is_admin and p_req.status = 'approved' then
    v_actions := array_append(v_actions, 'start');
  end if;

  -- บันทึกลงทะเบียน: ต้องเป็นทั้งผู้ดูแลงาน IT (itwo_staff) และอยู่ใน itas_admins ของโหมดนี้
  if v_is_admin and private.itar_is_itas_admin(p_actor.id, p_actor.is_test) and p_req.status = 'in_progress' then
    v_actions := array_append(v_actions, 'apply');
  end if;

  -- รับทราบ: ผู้รับสิทธิ์ที่มีบัญชีกดเอง · คนไม่มีบัญชี IT กด "รับทราบแล้ว (กระดาษ)" และแนบรูปใบที่เซ็น
  if p_req.status = 'awaiting_ack' then
    if p_req.subject_employee_id = p_actor.id then
      v_actions := array_append(v_actions, 'acknowledge');
    end if;
    if v_is_admin and p_req.subject_employee_id is null then
      v_actions := v_actions || array['acknowledge_paper', 'add_paper_attachment'];
    end if;
  end if;

  -- ถามกลับผู้ยื่น (ผู้อนุมัติของขั้นที่ใบรออยู่ / ผู้ดูแลงาน IT หลังอนุมัติ) และผู้ยื่นตอบ
  if private.itar_info_stage(p_req, p_actor) is not null then
    v_actions := array_append(v_actions, 'request_info');
  end if;
  if p_req.requester_id = p_actor.id and p_req.status = 'need_info' then
    v_actions := array_append(v_actions, 'provide_info');
  end if;
  return v_actions;
end;
$$;

-- 9. ไฟล์แนบ: ตัวช่วย + Storage -----------------------------------------------------------
-- ชนิดไฟล์ที่รับ (ที่เดียว ใช้ทั้งตั้งค่าบัคเก็ตและตรวจใน RPC) เหมือนใบสั่งงาน/ใบแจ้งซ่อม
create or replace function private.itar_allowed_mime_types()
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv']
$$;

-- นามสกุลใน path ต้องตรงกับชนิดไฟล์ (กันตั้งนามสกุลหลอก)
create or replace function private.itar_ext_matches_mime(p_name text, p_mime text)
returns boolean
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(case lower(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$'))
    when 'jpg' then p_mime = 'image/jpeg'
    when 'jpeg' then p_mime = 'image/jpeg'
    when 'png' then p_mime = 'image/png'
    when 'webp' then p_mime = 'image/webp'
    when 'heic' then p_mime = 'image/heic'
    when 'heif' then p_mime = 'image/heif'
    when 'pdf' then p_mime = 'application/pdf'
    when 'docx' then p_mime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'xlsx' then p_mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pptx' then p_mime = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    when 'doc' then p_mime = 'application/msword'
    when 'xls' then p_mime = 'application/vnd.ms-excel'
    when 'txt' then p_mime = 'text/plain'
    when 'csv' then p_mime = 'text/csv'
    else false
  end, false)
$$;

-- path ต้องเป็น <id ใบ>/<uuid>.<นามสกุลพิมพ์เล็ก> คืน id ใบ (ผิดรูปแบบ = null)
create or replace function private.itar_file_path_request_id(p_name text)
returns uuid
language sql
immutable
security definer
set search_path = ''
as $$
  select case
    when p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|pdf|docx|xlsx|pptx|doc|xls|txt|csv)$'
    then split_part(p_name, '/', 1)::uuid
  end
$$;

-- ไฟล์ตอนยื่นแนบได้เมื่อ: ใบยังไม่สิ้นสุดและยังไม่บันทึกลงทะเบียน ภายในหน้าต่างเวลา และยังไม่มีผู้อื่นอนุมัติจริง
create or replace function private.itar_initial_attach_open(p_req public.itar_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_req.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info')
    and now() - p_req.created_at <= private.itar_attach_window()
    and not private.itar_has_real_approval(p_req.id, p_req.requester_id)
$$;

-- แนบไฟล์กับข้อความถาม/ตอบ: ผู้เขียนข้อความเอง ภายในหน้าต่างเวลา ใบยังไม่สิ้นสุด
create or replace function private.itar_comment_attach_open(p_req public.itar_requests, p_comment_id bigint, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_actor.id is not null
    and p_req.status not in ('rejected', 'cancelled', 'done')
    and private.itar_can_view(p_req, p_actor)
    and exists (
      select 1 from public.itar_comments c
      where c.request_id = p_req.id
        and c.author_id = p_actor.id
        and (p_comment_id is null or c.id = p_comment_id)
        and now() - c.created_at <= private.itar_attach_window()
    )
$$;

-- รูปใบรับทราบที่เซ็นด้วยกระดาษ: IT แนบได้ขณะใบรอรับทราบและผู้รับสิทธิ์ไม่มีบัญชี (ไม่จำกัดเวลา)
create or replace function private.itar_paper_attach_open(p_req public.itar_requests, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_actor.id is not null
    and p_req.is_test = p_actor.is_test
    and p_req.status = 'awaiting_ack'
    and p_req.subject_employee_id is null
    and private.itar_is_it_admin(p_actor.id)
$$;

-- ตรวจไฟล์ใน Storage จริง (ชนิด/ขนาดใช้ค่าจาก Storage เท่านั้น ไม่เชื่อค่าที่ผู้เรียกส่งมา)
create or replace function private.itar_read_stored_file(p_is_test boolean, p_path text, out mime_type text, out size_bytes bigint)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_object storage.objects%rowtype;
begin
  select * into v_object
  from storage.objects o
  where o.bucket_id = case when p_is_test then 'itar-test-files' else 'itar-files' end
    and o.name = p_path and o.owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  mime_type := nullif(v_object.metadata ->> 'mimetype', '');
  size_bytes := nullif(v_object.metadata ->> 'size', '')::bigint;
  if mime_type is null or size_bytes is null then
    raise exception 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if mime_type <> all (private.itar_allowed_mime_types()) then
    raise exception 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)' using errcode = 'check_violation';
  end if;
  if not private.itar_ext_matches_mime(p_path, mime_type) then
    raise exception 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if size_bytes <= 0 or size_bytes > 20971520 then
    raise exception 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB' using errcode = 'check_violation';
  end if;
end;
$$;

-- 9b. Storage: บัคเก็ต + policy ------------------------------------------------------------
-- on conflict do update: ถ้ามีคนสร้างไว้เองใน Dashboard ให้ตั้งค่ากลับเป็นตามที่กำหนดเสมอ (private เสมอ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('itar-files', 'itar-files', false, 20971520, private.itar_allowed_mime_types()),
  ('itar-test-files', 'itar-test-files', false, 20971520, private.itar_allowed_mime_types())
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ฟังก์ชันตัดสินของ policy (เรียกด้วยสิทธิ์ผู้ใช้จึงต้อง grant ให้ authenticated · ตัวฟังก์ชันเป็น SECURITY DEFINER คืนแค่ true/false ตามสิทธิ์ของผู้เรียกเอง)
-- อ่านได้: ผู้ที่ itar_can_view ใบนั้น (ผู้ยื่น / ผู้รับสิทธิ์ / ทีม IT / ผู้อนุมัติแผนก) ใบต้องอยู่โหมดเดียวกับบัคเก็ต (ของจริง/ทดสอบ) และกับผู้เรียก
create or replace function private.itar_storage_can_read(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itar_requests%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itar_file_path_request_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itar_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_req from public.itar_requests w where w.id = v_id;
  return v_req.id is not null and v_req.is_test = p_is_test and private.itar_can_view(v_req, v_actor);
end;
$$;

-- อัปโหลดได้: ผู้ยื่นในหน้าต่างแนบตอนยื่น · ผู้เขียนข้อความในหน้าต่างแนบของข้อความ · IT แนบรูปใบรับทราบกระดาษ · จำกัดจำนวนไฟล์ต่อใบ
create or replace function private.itar_storage_can_upload(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itar_requests%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itar_file_path_request_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itar_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_req from public.itar_requests w where w.id = v_id;
  if v_req.id is null or v_req.is_test <> p_is_test or v_actor.is_test <> p_is_test then
    return false;
  end if;
  if not (
       (v_req.requester_id = v_actor.id and private.itar_initial_attach_open(v_req))
       or private.itar_comment_attach_open(v_req, null, v_actor)
       or private.itar_paper_attach_open(v_req, v_actor)
     ) then
    return false;
  end if;
  -- ตอนยื่น 1 ชุด + รูปใบรับทราบกระดาษ 1 ชุด + ข้อความถาม/ตอบแต่ละข้อ (ชุดละไม่เกิน 10 ไฟล์ ตรวจจริงที่ RPC · ตรงนี้เพดานกว้างกัน)
  return (
    select count(*) from storage.objects o
    where o.bucket_id = case when p_is_test then 'itar-test-files' else 'itar-files' end
      and starts_with(o.name, v_id::text || '/')
  ) < 20 * (2 + (select count(*) from public.itar_comments c where c.request_id = v_id));
end;
$$;

-- บัคเก็ตทดสอบ: ลบได้เฉพาะไฟล์ที่ไม่มีใครลงทะเบียน โดย admin ที่อยู่ในโหมดทดสอบ (ไว้ล้างหลัง purge)
create or replace function private.itar_storage_test_file_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.sandbox_persona()).id is not null
    and not exists (select 1 from public.itar_attachments a where a.storage_path = p_name)
$$;

create policy itar_files_read on storage.objects for select to authenticated
using (bucket_id = 'itar-files' and private.itar_storage_can_read(name, false));
create policy itar_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itar-files' and owner_id = (select auth.uid())::text
  and private.itar_storage_can_upload(name, false));
-- ไม่มี UPDATE (เขียนทับไม่ได้) และไม่มี DELETE ของบัคเก็ตจริง (ISO)
create policy itar_test_files_read on storage.objects for select to authenticated
using (bucket_id = 'itar-test-files'
  and (private.itar_storage_can_read(name, true) or private.itar_storage_test_file_removable(name)));
create policy itar_test_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itar-test-files' and owner_id = (select auth.uid())::text
  and private.itar_storage_can_upload(name, true));
create policy itar_test_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'itar-test-files' and private.itar_storage_test_file_removable(name));

-- 10. RPC: ยื่น · อนุมัติ · ยกเลิก · เริ่ม · ถามผู้ยื่น/ตอบ -------------------------------------------
-- ผู้ใช้เรียกผ่าน public.app_itar_* เท่านั้น (SECURITY DEFINER + search_path ว่าง · anon เรียกไม่ได้) ทุกตัวเริ่มด้วยด่าน lab-only และหาผู้ทำรายการจาก private.itar_actor()
-- ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ

-- ผู้ทำรายการ + บทบาทของตัวเองในโมดูลนี้ (ให้หน้าเว็บเลือกแท็บ/ปุ่ม)
create or replace function public.app_itar_my_role()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_is_admin boolean;
  v_is_dept_approver boolean;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  v_is_admin := private.itar_is_it_admin(v_actor.id);
  v_is_dept_approver := private.itar_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test);
  return jsonb_build_object(
    'employee_id', v_actor.id,
    'employee_no', v_actor.employee_no,
    'full_name', v_actor.first_name || ' ' || v_actor.last_name,
    'is_test', v_actor.is_test,
    'department', (select jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th)
                   from public.departments d where d.id = v_actor.department_id),
    'is_it_department', private.itar_is_it_department(v_actor.department_id),
    'is_dept_approver', v_is_dept_approver,
    'is_it_admin', v_is_admin,
    'is_it_approver', private.itar_is_it_approver(v_actor.id),
    'is_it_viewer', private.itar_is_it_viewer(v_actor.id),
    -- บันทึกลงทะเบียนสิทธิ์ได้ (ต้องเป็นทั้งผู้ดูแลงาน IT และอยู่ใน itas_admins ของโหมดนี้)
    'is_itas_admin', private.itar_is_itas_admin(v_actor.id, v_actor.is_test),
    -- ยื่นแทนผู้อื่นได้: IT ทุกประเภท · ผู้จัดการ/ผู้ช่วยแผนกเฉพาะ "ยกเลิกทั้งหมด" ของคนในแผนกตัวเอง
    'can_file_for_others', v_is_admin or v_is_dept_approver
  );
end;
$$;

-- หาผู้รับสิทธิ์ของใบที่กำลังยื่น + ตรวจว่าผู้ยื่นมีสิทธิ์ยื่นให้คนนี้ (จุดตัดสินเดียวของ create และ form_context)
--   p_subject (jsonb ไม่บังคับ) ช่อง: employee_id (พนักงานที่มีบัญชี) · user_id (ผู้ใช้ในทะเบียนสิทธิ์ — เฉพาะ IT หรือผู้จัดการแผนกที่ยกเลิกทั้งหมด)
--     name_th / name_en / department_id / division (ใช้เมื่อผู้รับสิทธิ์ไม่มีบัญชีและไม่มีในทะเบียน — เฉพาะ IT)
--   ไม่ระบุช่องใดเลย = ตัวผู้ยื่นเอง
--   คืน: employee_id (null = ไม่มีบัญชี), user_id (null = ยังไม่ผูกทะเบียน), ชื่อ/แผนก/ฝ่าย (snapshot), department_id ที่ใช้เดินอนุมัติ
create or replace function private.itar_resolve_subject(
  p_actor public.employees, p_type text, p_subject jsonb,
  out o_employee_id uuid, out o_user_id uuid, out o_name_th text, out o_name_en text,
  out o_department_id uuid, out o_department_code text, out o_division text)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject jsonb := coalesce(p_subject, '{}'::jsonb);
  v_is_admin boolean := private.itar_is_it_admin(p_actor.id);
  v_emp_id uuid;
  v_user_id uuid;
  v_emp public.employees%rowtype;
  v_user public.itua_users%rowtype;
  v_linked public.itua_users%rowtype;
  v_dept public.departments%rowtype;
  v_name_th text;
  v_name_en text;
  v_division text;
  v_dept_param uuid;
begin
  if jsonb_typeof(v_subject) <> 'object' then
    raise exception 'ข้อมูลผู้รับสิทธิ์ต้องเป็นรูปแบบ {ช่อง: ค่า}' using errcode = 'check_violation';
  end if;
  begin
    v_emp_id := nullif(btrim(coalesce(v_subject ->> 'employee_id', '')), '')::uuid;
    v_user_id := nullif(btrim(coalesce(v_subject ->> 'user_id', '')), '')::uuid;
    v_dept_param := nullif(btrim(coalesce(v_subject ->> 'department_id', '')), '')::uuid;
  exception when others then
    raise exception 'รหัสผู้รับสิทธิ์หรือแผนกไม่ถูกต้อง' using errcode = 'check_violation';
  end;
  v_name_th := private.itar_clean(v_subject ->> 'name_th');
  v_name_en := private.itar_clean(v_subject ->> 'name_en');
  v_division := private.itar_clean(v_subject ->> 'division');
  if v_name_th is not null and (char_length(v_name_th) > 200 or v_name_th ~ '[[:cntrl:]]') then
    raise exception 'ชื่อ (ไทย) ของผู้รับสิทธิ์ต้องไม่เกิน 200 ตัวอักษรและไม่มีอักขระควบคุม' using errcode = 'check_violation';
  end if;
  if v_name_en is not null and (char_length(v_name_en) > 200 or v_name_en ~ '[[:cntrl:]]') then
    raise exception 'ชื่อ (อังกฤษ) ของผู้รับสิทธิ์ต้องไม่เกิน 200 ตัวอักษรและไม่มีอักขระควบคุม' using errcode = 'check_violation';
  end if;
  if v_division is not null and v_division not in ('office', 'factory', 'manager', 'office_indesign') then
    raise exception 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)' using errcode = 'check_violation';
  end if;

  -- ไม่ระบุอะไรเลย = ตัวผู้ยื่นเอง
  if v_emp_id is null and v_user_id is null and v_name_th is null and v_name_en is null then
    v_emp_id := p_actor.id;
  end if;

  if v_user_id is not null then
    select * into v_user from public.itua_users u where u.id = v_user_id and u.is_test = p_actor.is_test;
    if v_user.id is null then
      raise exception 'ไม่พบผู้ใช้นี้ในทะเบียนสิทธิ์' using errcode = 'check_violation';
    end if;
    -- ผู้ใช้ทะเบียนที่ผูกกับพนักงานแล้ว = ใช้พนักงานคนนั้นเป็นผู้รับสิทธิ์ (เพื่อรับทราบในเว็บได้)
    if v_user.employee_id is not null then
      if v_emp_id is not null and v_emp_id <> v_user.employee_id then
        raise exception 'ผู้ใช้ในทะเบียนนี้ผูกกับพนักงานคนอื่นอยู่' using errcode = 'check_violation';
      end if;
      v_emp_id := v_user.employee_id;
    end if;
  end if;

  if v_emp_id is not null then
    select * into v_emp from public.employees e where e.id = v_emp_id and e.is_test = p_actor.is_test and e.deleted_at is null;
    if v_emp.id is null then
      raise exception 'ไม่พบพนักงานที่จะรับสิทธิ์' using errcode = 'check_violation';
    end if;
    if v_emp.id <> p_actor.id and not v_is_admin
       and not (p_type = 'revoke_all' and private.itar_is_dept_approver(p_actor.id, v_emp.department_id, p_actor.is_test)) then
      raise exception 'ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)'
        using errcode = 'insufficient_privilege';
    end if;
    select * into v_linked from public.itua_users u where u.employee_id = v_emp.id and u.is_test = p_actor.is_test;
    if v_user.id is not null and v_linked.id is not null and v_linked.id <> v_user.id then
      raise exception 'พนักงานคนนี้ผูกกับผู้ใช้อื่นในทะเบียนสิทธิ์แล้ว' using errcode = 'check_violation';
    end if;
    if v_user.id is null then
      v_user := v_linked;
    elsif v_user.employee_id is null and not v_is_admin then
      -- ผู้ใช้ทะเบียนที่ยังไม่ผูกกับพนักงาน: เฉพาะผู้ดูแลงาน IT ที่จับคู่กับพนักงานให้ได้ (กันผูกข้ามคน)
      raise exception 'เฉพาะผู้ดูแลงาน IT ที่ผูกพนักงานกับผู้ใช้ในทะเบียนสิทธิ์ได้' using errcode = 'insufficient_privilege';
    end if;
    select * into v_dept from public.departments d where d.id = v_emp.department_id;
    v_name_th := v_emp.first_name || ' ' || v_emp.last_name;
    v_name_en := coalesce(v_user.name_en, v_name_en);
  else
    -- ไม่มีบัญชีพนักงาน: ผู้ดูแลงาน IT ยื่นแทนได้ทุกประเภท · ผู้จัดการ/ผู้ช่วยแผนกยื่น "ยกเลิกทั้งหมด" ให้ผู้ใช้ทะเบียนของแผนกตัวเอง (รหัสแผนกตรงกัน)
    if v_user.id is not null then
      select * into v_dept from public.departments d where upper(d.code) = upper(v_user.department_code);
    end if;
    if not v_is_admin and not (
         p_type = 'revoke_all' and v_user.id is not null and v_dept.id is not null
         and private.itar_is_dept_approver(p_actor.id, v_dept.id, p_actor.is_test)) then
      raise exception 'ยื่นใบขอสิทธิ์ให้คนที่ไม่มีบัญชีได้เฉพาะผู้ดูแลงาน IT (หรือผู้จัดการแผนกที่ยกเลิกสิทธิ์ทั้งหมดของผู้ใช้ในแผนกตัวเอง)'
        using errcode = 'insufficient_privilege';
    end if;
    if v_user.id is not null then
      v_name_th := v_user.name_th;
      v_name_en := v_user.name_en;
    end if;
    if v_dept.id is null then
      select * into v_dept from public.departments d where d.id = v_dept_param;
      if v_dept.id is null then
        raise exception 'กรุณาเลือกแผนกของผู้รับสิทธิ์' using errcode = 'check_violation';
      end if;
    end if;
    if v_name_th is null and v_name_en is null then
      raise exception 'กรุณาระบุชื่อผู้รับสิทธิ์ (ไทยหรืออังกฤษอย่างน้อยหนึ่ง)' using errcode = 'check_violation';
    end if;
  end if;

  if not v_dept.is_active then
    raise exception 'แผนกของผู้รับสิทธิ์ถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;
  if p_type = 'new' and v_user.id is not null then
    raise exception 'ผู้ใช้นี้มีอยู่ในทะเบียนสิทธิ์แล้ว กรุณาเลือกประเภท "เปลี่ยนแปลง" แทน' using errcode = 'check_violation';
  end if;
  if p_type <> 'new' and v_user.id is not null and v_user.status <> 'active' then
    raise exception 'ผู้ใช้นี้ลาออกแล้วในทะเบียนสิทธิ์ ไม่สามารถขอเปลี่ยนแปลงหรือยกเลิกสิทธิ์ได้' using errcode = 'check_violation';
  end if;
  v_division := coalesce(v_user.division, v_division);
  if p_type = 'new' and v_division is null then
    raise exception 'กรุณาเลือกฝ่ายของผู้ใช้ใหม่ (สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน InDesign)' using errcode = 'check_violation';
  end if;

  o_employee_id := v_emp.id;
  o_user_id := v_user.id;
  o_name_th := v_name_th;
  o_name_en := v_name_en;
  o_department_id := v_dept.id;
  o_department_code := coalesce(v_user.department_code, v_dept.code);
  o_division := v_division;
end;
$$;

-- ยื่นใบขอสิทธิ์
--   p_request_type: new | change | revoke_all · p_reason: เหตุผลรวม (บังคับ ≤2,000)
--   p_items: array ของรายการที่ขอ (≤80 · ประเภท revoke_all ต้องว่าง · new/change ต้องมีอย่างน้อย 1) แต่ละรายการ
--     {kind:'folder', target:'<รหัสโฟลเดอร์>', from: null|'R'|'F', to: null|'R'|'F'}
--     {kind:'internet', from: boolean, to: boolean, note:'<เหตุผล บังคับเมื่อขอเพิ่ม>'}
--     {kind:'program', target:'<รหัสโปรแกรม>', from: boolean, to: boolean, note:'<ระบุ บังคับเมื่อ OTHER>'}
--     {kind:'email', target:'<ที่อยู่อีเมล>', to:'add'|'close', email_kind:'internal'|'extra' (เมื่อ add)}
--     from = ค่าปัจจุบันที่ผู้ยื่นเห็น (ต้องตรงกับทะเบียน ไม่ตรง = 40001) · ผู้รับสิทธิ์ที่ยังไม่ผูกทะเบียน/ขอใหม่ ไม่ต้องส่ง from (ขอใหม่ต้องเป็นการเพิ่มเท่านั้น)
--   p_subject: ผู้รับสิทธิ์ (ดู private.itar_resolve_subject) ไม่ส่ง = ตัวเอง
--   คืน id + เลขที่เอกสาร
create or replace function public.app_itar_create(
  p_request_type text,
  p_reason text,
  p_items jsonb default '[]'::jsonb,
  p_subject jsonb default null
)
returns table(id uuid, doc_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_type text := private.itar_clean(p_request_type);
  v_reason text := private.itar_clean(p_reason);
  v_subj record;
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  v_el jsonb;
  v_ord integer := 0;
  v_norm jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_key text;
  v_known boolean;
  v_kind text;
  v_target text;
  v_from text;
  v_to text;
  v_note text;
  v_email_kind text;
  v_folder public.itua_folders%rowtype;
  v_program public.itua_programs%rowtype;
  v_cur_level text;
  v_cur_exists boolean;
  v_cur_internet boolean;
  v_label text;
  v_user public.itua_users%rowtype;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_involves boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_request_id uuid;
  v_item jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  if v_type is null or v_type not in ('new', 'change', 'revoke_all') then
    raise exception 'กรุณาเลือกประเภทคำขอ (ขอใหม่ เปลี่ยนแปลง หรือยกเลิกทั้งหมด)' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ขอ' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 2000 then
    raise exception 'เหตุผลต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_subj from private.itar_resolve_subject(v_actor, v_type, p_subject);
  -- ผู้รับสิทธิ์ที่ผูกทะเบียนแล้ว: รู้ค่าปัจจุบัน -> เทียบ from ได้ · ขอใหม่: ไม่มีสิทธิ์อะไรเลย (ค่าเดิม = ว่าง/ไม่มี)
  v_known := v_subj.o_user_id is not null or v_type = 'new';
  if v_subj.o_user_id is not null then
    select * into v_user from public.itua_users u where u.id = v_subj.o_user_id;
  end if;

  -- ตรวจรายการที่ขอ -> สร้างรายการแบบ normalize (v_norm) ยังไม่เขียนข้อมูล
  if jsonb_typeof(v_items) is distinct from 'array' then
    raise exception 'รายการสิทธิ์ที่ขอต้องเป็นรูปแบบ array' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_items) > 80 then
    raise exception 'ขอสิทธิ์ได้ครั้งละไม่เกิน 80 รายการ' using errcode = 'check_violation';
  end if;
  if v_type = 'revoke_all' and jsonb_array_length(v_items) > 0 then
    raise exception 'ประเภทยกเลิกสิทธิ์ทั้งหมดไม่ต้องระบุรายการสิทธิ์ (ระบบถอดสิทธิ์ทั้งหมดของผู้ใช้ให้)' using errcode = 'check_violation';
  end if;
  if v_type <> 'revoke_all' and jsonb_array_length(v_items) = 0 then
    raise exception 'กรุณาเลือกสิทธิ์ที่ต้องการอย่างน้อยหนึ่งรายการ' using errcode = 'check_violation';
  end if;

  for v_el in select e.value from jsonb_array_elements(v_items) e loop
    v_ord := v_ord + 1;
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'รายการที่ % ต้องเป็นรูปแบบ {ช่อง: ค่า}', v_ord using errcode = 'check_violation';
    end if;
    v_kind := private.itar_clean(v_el ->> 'kind');
    v_note := private.itar_clean(v_el ->> 'note');
    if v_note is not null and (char_length(v_note) > 500 or v_note ~ '[[:cntrl:]]') then
      raise exception 'รายการที่ %: หมายเหตุต้องไม่เกิน 500 ตัวอักษรและไม่มีอักขระควบคุม', v_ord using errcode = 'check_violation';
    end if;
    v_target := null;
    v_from := null;
    v_to := null;
    v_email_kind := null;

    if v_kind = 'folder' then
      v_target := upper(private.itar_clean(v_el ->> 'target'));
      v_label := 'โฟลเดอร์ ' || coalesce(v_target, '?');
      if v_target is null then
        raise exception 'รายการที่ %: กรุณาระบุรหัสโฟลเดอร์', v_ord using errcode = 'check_violation';
      end if;
      select * into v_folder from public.itua_folders f where f.is_test = v_actor.is_test and f.code = v_target;
      if v_folder.id is null then
        raise exception 'ไม่พบโฟลเดอร์ %', v_target using errcode = 'check_violation';
      end if;
      if not (v_el ? 'to') or jsonb_typeof(v_el -> 'to') not in ('null', 'string')
         or (jsonb_typeof(v_el -> 'to') = 'string' and (v_el ->> 'to') not in ('R', 'F')) then
        raise exception '%: สิทธิ์ที่ขอ (to) ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', v_label using errcode = 'check_violation';
      end if;
      v_to := case when jsonb_typeof(v_el -> 'to') = 'string' then v_el ->> 'to' end;
      if v_to is not null and not v_folder.is_active then
        raise exception '%: โฟลเดอร์ปิดการใช้งานอยู่ ขอสิทธิ์ไม่ได้', v_label using errcode = 'check_violation';
      end if;
      if v_type = 'new' and v_to is null then
        raise exception '%: ขอสิทธิ์ใหม่เพิ่มสิทธิ์ได้อย่างเดียว', v_label using errcode = 'check_violation';
      end if;
      if v_known and v_type <> 'new' then
        if not (v_el ? 'from') or jsonb_typeof(v_el -> 'from') not in ('null', 'string')
           or (jsonb_typeof(v_el -> 'from') = 'string' and (v_el ->> 'from') not in ('R', 'F')) then
          raise exception '%: สิทธิ์ปัจจุบัน (from) ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', v_label using errcode = 'check_violation';
        end if;
        v_from := case when jsonb_typeof(v_el -> 'from') = 'string' then v_el ->> 'from' end;
        select g.level into v_cur_level from public.itua_folder_grants g where g.user_id = v_subj.o_user_id and g.folder_id = v_folder.id;
        if v_cur_level is distinct from v_from then
          raise exception '%: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
        end if;
      end if;
      if v_known and v_from is not distinct from v_to then
        raise exception '%: สิทธิ์ที่ขอเหมือนเดิม ไม่มีการเปลี่ยนแปลง', v_label using errcode = 'check_violation';
      end if;
      v_key := 'folder:' || v_target;

    elsif v_kind = 'internet' then
      v_label := 'อินเทอร์เน็ต';
      if not (v_el ? 'to') or jsonb_typeof(v_el -> 'to') <> 'boolean' then
        raise exception '%: สิทธิ์ที่ขอ (to) ต้องเป็น true หรือ false', v_label using errcode = 'check_violation';
      end if;
      v_to := (v_el ->> 'to');
      if v_type = 'new' and v_to <> 'true' then
        raise exception '%: ขอสิทธิ์ใหม่เพิ่มสิทธิ์ได้อย่างเดียว', v_label using errcode = 'check_violation';
      end if;
      if v_known then
        if v_type = 'new' then
          v_from := 'false';
        else
          if not (v_el ? 'from') or jsonb_typeof(v_el -> 'from') <> 'boolean' then
            raise exception '%: สิทธิ์ปัจจุบัน (from) ต้องเป็น true หรือ false', v_label using errcode = 'check_violation';
          end if;
          v_from := (v_el ->> 'from');
          select u.internet into v_cur_internet from public.itua_users u where u.id = v_subj.o_user_id;
          if v_cur_internet::text <> v_from then
            raise exception '%: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
          end if;
        end if;
        if v_from = v_to then
          raise exception '%: สิทธิ์ที่ขอเหมือนเดิม ไม่มีการเปลี่ยนแปลง', v_label using errcode = 'check_violation';
        end if;
      end if;
      -- ขอเพิ่มอินเทอร์เน็ตต้องบอกเหตุผล (ตามฟอร์ม)
      if v_to = 'true' and v_note is null then
        raise exception 'กรุณาระบุเหตุผลที่ขอใช้อินเทอร์เน็ต' using errcode = 'check_violation';
      end if;
      v_key := 'internet:';

    elsif v_kind = 'program' then
      v_target := upper(private.itar_clean(v_el ->> 'target'));
      v_label := 'โปรแกรม ' || coalesce(v_target, '?');
      if v_target is null then
        raise exception 'รายการที่ %: กรุณาระบุรหัสโปรแกรม', v_ord using errcode = 'check_violation';
      end if;
      select * into v_program from public.itua_programs p where p.is_test = v_actor.is_test and p.code = v_target;
      if v_program.id is null then
        raise exception 'ไม่พบโปรแกรม %', v_target using errcode = 'check_violation';
      end if;
      if not (v_el ? 'to') or jsonb_typeof(v_el -> 'to') <> 'boolean' then
        raise exception '%: สิทธิ์ที่ขอ (to) ต้องเป็น true หรือ false', v_label using errcode = 'check_violation';
      end if;
      v_to := (v_el ->> 'to');
      if v_to = 'true' and not v_program.is_active then
        raise exception '%: โปรแกรมปิดการใช้งานอยู่ ขอสิทธิ์ไม่ได้', v_label using errcode = 'check_violation';
      end if;
      if v_type = 'new' and v_to <> 'true' then
        raise exception '%: ขอสิทธิ์ใหม่เพิ่มสิทธิ์ได้อย่างเดียว', v_label using errcode = 'check_violation';
      end if;
      if v_to = 'true' and v_program.code = 'OTHER' and v_note is null then
        raise exception '%: ต้องระบุว่าเป็นโปรแกรมอะไร', v_label using errcode = 'check_violation';
      end if;
      if v_known then
        if v_type = 'new' then
          v_from := 'false';
        else
          if not (v_el ? 'from') or jsonb_typeof(v_el -> 'from') <> 'boolean' then
            raise exception '%: สิทธิ์ปัจจุบัน (from) ต้องเป็น true หรือ false', v_label using errcode = 'check_violation';
          end if;
          v_from := (v_el ->> 'from');
          select exists (select 1 from public.itua_program_grants g where g.user_id = v_subj.o_user_id and g.program_id = v_program.id) into v_cur_exists;
          if v_cur_exists::text <> v_from then
            raise exception '%: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
          end if;
        end if;
        if v_from = v_to then
          raise exception '%: สิทธิ์ที่ขอเหมือนเดิม ไม่มีการเปลี่ยนแปลง', v_label using errcode = 'check_violation';
        end if;
      end if;
      v_key := 'program:' || v_target;

    elsif v_kind = 'email' then
      v_target := lower(private.itar_clean(v_el ->> 'target'));
      v_label := 'อีเมล ' || coalesce(v_target, '?');
      if v_target is null or char_length(v_target) > 200 or v_target !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
        raise exception 'รายการที่ %: รูปแบบอีเมลไม่ถูกต้อง', v_ord using errcode = 'check_violation';
      end if;
      v_to := private.itar_clean(v_el ->> 'to');
      if v_to is null or v_to not in ('add', 'close') then
        raise exception '%: ต้องระบุ to เป็น add (ขออีเมลใหม่) หรือ close (ปิดอีเมล)', v_label using errcode = 'check_violation';
      end if;
      if v_type = 'new' and v_to <> 'add' then
        raise exception '%: ขอสิทธิ์ใหม่เพิ่มสิทธิ์ได้อย่างเดียว', v_label using errcode = 'check_violation';
      end if;
      if v_to = 'add' then
        v_email_kind := coalesce(private.itar_clean(v_el ->> 'email_kind'), 'extra');
        if v_email_kind not in ('internal', 'extra') then
          raise exception '%: ชนิดอีเมลต้องเป็น internal (อีเมลภายใน) หรือ extra (อื่น ๆ)', v_label using errcode = 'check_violation';
        end if;
        if exists (select 1 from public.itua_emails m where m.is_test = v_actor.is_test and m.address = v_target and m.status = 'active') then
          raise exception '%: ที่อยู่นี้ถูกใช้งานอยู่ในทะเบียนแล้ว', v_label using errcode = 'check_violation';
        end if;
        if v_email_kind = 'internal' and v_subj.o_user_id is not null and exists (
             select 1 from public.itua_emails m where m.user_id = v_subj.o_user_id and m.kind = 'internal' and m.status = 'active') then
          raise exception '%: ผู้ใช้นี้มีอีเมลภายในที่ใช้งานอยู่แล้ว (มีได้ 1 ที่อยู่)', v_label using errcode = 'check_violation';
        end if;
      elsif v_subj.o_user_id is not null and not exists (
             select 1 from public.itua_emails m where m.user_id = v_subj.o_user_id and m.address = v_target and m.status = 'active') then
        raise exception '%: ไม่พบอีเมลนี้ที่ใช้งานอยู่ของผู้ใช้', v_label using errcode = 'check_violation';
      end if;
      v_key := 'email:' || v_target;

    else
      raise exception 'รายการที่ %: kind ต้องเป็น folder, internet, program หรือ email', v_ord using errcode = 'check_violation';
    end if;

    if v_key = any (v_seen) then
      raise exception '% ซ้ำกันในรายการเดียวกัน', v_label using errcode = 'check_violation';
    end if;
    v_seen := v_seen || v_key;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'line_no', v_ord, 'kind', v_kind, 'target', v_target, 'from_known', v_known,
      'from_value', v_from, 'to_value', v_to, 'note', v_note, 'email_kind', v_email_kind));
  end loop;

  -- เลือกเส้นทางอนุมัติ (กติกาเดียวกับ itwo/itrp · แผนก = แผนกของผู้รับสิทธิ์)
  v_involves := private.itar_involves_it_approver(v_actor.id, v_subj.o_employee_id);
  v_dept_is_it := private.itar_is_it_department(v_subj.o_department_id);
  v_actor_is_dept_role := private.itar_is_dept_approver(v_actor.id, v_subj.o_department_id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itar_dept_approvers(v_subj.o_department_id, v_actor.is_test) a(id)
    where a.id <> v_actor.id and a.id is distinct from v_subj.o_employee_id);

  -- ใบทั่วไปต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ (ไม่เช่นนั้นใบค้างโดยไม่มีใครอนุมัติได้) · ใบที่เกี่ยวกับผู้อนุมัติขั้น IT เอง รอหัวหน้า IT
  -- ถ้าตอนนี้ไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ผ่านอัตโนมัติ) และไม่ปฏิเสธการยื่น
  if not v_involves and not private.itar_has_active_stage_pool(v_actor.is_test, false) then
    raise exception 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;
  if v_dept_is_it then
    -- ผู้รับสิทธิ์อยู่แผนก IT: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น (บันทึกตอนอนุมัติ)
    v_status := 'pending_it_mgr';
  elsif v_actor_is_dept_role then
    -- ผู้ยื่นเป็นผู้จัดการ/ผู้ช่วยของแผนกผู้รับสิทธิ์: ข้ามขั้นแผนก (บันทึก dept_approved ด้านล่าง)
    v_status := 'pending_it_mgr';
  elsif not v_has_dept_approvers then
    -- แผนกไม่มีผู้จัดการ/ผู้ช่วย: ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
    v_status := 'pending_it_mgr';
  else
    v_status := 'pending_dept';
  end if;

  -- เลขที่เอกสาร: ล็อกแถวตัวนับของปีนั้นจนจบ transaction จึงไม่ซ้ำแม้กดพร้อมกัน
  select n.year_ce, n.seq_no, n.doc_no
    into v_doc_year, v_doc_seq, v_doc_no
  from private.itar_next_doc_no(v_actor.is_test) n;

  insert into public.itar_requests as rq (
    is_test, doc_no, doc_year, doc_seq, requester_id, request_type, reason, department_id,
    subject_employee_id, subject_user_id, subject_name_th, subject_name_en, subject_department_code, subject_division, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_type, v_reason, v_subj.o_department_id,
    v_subj.o_employee_id, v_subj.o_user_id, v_subj.o_name_th, v_subj.o_name_en, v_subj.o_department_code, v_subj.o_division, v_status
  ) returning rq.id into v_request_id;

  for v_item in select e.value from jsonb_array_elements(v_norm) e loop
    insert into public.itar_request_items (is_test, request_id, line_no, kind, target, from_known, from_value, to_value, note, email_kind)
    values (v_actor.is_test, v_request_id, (v_item ->> 'line_no')::smallint, v_item ->> 'kind', v_item ->> 'target',
            (v_item ->> 'from_known')::boolean, v_item ->> 'from_value', v_item ->> 'to_value', v_item ->> 'note', v_item ->> 'email_kind');
  end loop;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved)
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_request_id, v_actor.id, 'created',
    case when not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้รับสิทธิ์ไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itar_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'dept_approved', 'ผู้ยื่นเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนกของผู้รับสิทธิ์ อนุมัติในตัวเมื่อยื่นใบขอสิทธิ์');
  end if;

  id := v_request_id;
  doc_no := v_doc_no;
  return next;
end;
$$;

-- ตัดสินใจอนุมัติ/ไม่อนุมัติของผู้ทำรายการ (ใช้ร่วมของ app_itar_approve / app_itar_reject)
create or replace function private.itar_decide(p_request_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itar_clean(p_reason);
  v_req public.itar_requests%rowtype;
  v_caps record;
  v_dept_done boolean;
  v_it_done boolean;
  v_new_status text;
begin
  v_actor := private.itar_actor();

  -- ไม่อนุมัติต้องมีเหตุผล (ตรวจก่อนแตะข้อมูลใบ)
  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' using errcode = 'check_violation';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id = v_actor.id or v_req.subject_employee_id is not distinct from v_actor.id then
    raise exception 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบขอสิทธิ์ที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'need_info') then
    raise exception '%', private.itar_status_message(v_req.status) using errcode = 'check_violation';
  end if;

  select * into v_caps from private.itar_approval_caps(v_req.id, v_actor.id);
  if v_caps.rejected then
    raise exception 'ใบขอสิทธิ์นี้ไม่อนุมัติไปแล้ว' using errcode = 'check_violation';
  end if;

  if not v_caps.can_dept and not v_caps.can_it then
    -- บอกเหตุผลให้ตรงที่สุด · ผู้อนุมัติขั้น IT "ของใบนี้" (ใบที่เกี่ยวกับผู้อนุมัติขั้น IT เอง = หัวหน้า IT) ไม่ใช่ทุกคนที่มีธง approver
    if private.itar_is_it_stage_approver(v_req.requester_id, v_req.subject_employee_id, v_actor.id) then
      if v_caps.it_done then
        raise exception 'ใบขอสิทธิ์นี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว' using errcode = 'check_violation';
      end if;
      raise exception 'ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
    elsif v_caps.actor_is_dept_role and not v_caps.dept_is_it then
      raise exception 'ใบขอสิทธิ์นี้ผู้จัดการแผนกพิจารณาไปแล้ว' using errcode = 'check_violation';
    end if;
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบขอสิทธิ์นี้' using errcode = 'insufficient_privilege';
  end if;

  -- รอผู้ยื่นตอบคำถามอยู่: ทั้งอนุมัติและไม่อนุมัติไม่ได้จนกว่าจะมีคำตอบ · ตรวจหลังตรวจสิทธิ์ เพื่อให้คนที่ไม่มีสิทธิ์ได้ข้อความสิทธิ์ตามเดิม
  if v_req.status = 'need_info' then
    if p_approve then
      raise exception 'ใบขอสิทธิ์นี้รอผู้ยื่นตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้' using errcode = 'check_violation';
    end if;
    raise exception 'ใบนี้กำลังรอผู้ยื่นตอบคำถาม กรุณารอคำตอบก่อน' using errcode = 'check_violation';
  end if;

  v_dept_done := v_caps.dept_done;
  v_it_done := v_caps.it_done;

  if p_approve then
    if v_caps.can_it then
      -- ผู้อนุมัติขั้น IT: ถ้าขั้นแผนกยังไม่ผ่านและไม่ต้องรอใคร กดครั้งเดียวบันทึกทั้งสองขั้นในชื่อเขา
      if not v_dept_done then
        insert into public.itar_events (is_test, request_id, actor_id, action, reason)
        values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved',
          case
            when v_caps.dept_is_it then 'ผู้รับสิทธิ์อยู่แผนก IT ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            when v_caps.actor_is_dept_role then 'ผู้อนุมัติเป็นผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้รับสิทธิ์และเป็นผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            else 'แผนกของผู้รับสิทธิ์ไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
          end);
        v_dept_done := true;
      end if;
      insert into public.itar_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'it_mgr_approved');
      v_it_done := true;
    else
      insert into public.itar_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved');
      v_dept_done := true;
    end if;
  else
    insert into public.itar_events (is_test, request_id, actor_id, action, reason)
    values (v_req.is_test, v_req.id, v_actor.id,
            case when v_caps.can_it then 'it_mgr_rejected' else 'dept_rejected' end, v_reason);
  end if;

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที · อนุมัติ = เลื่อนตามขั้นที่ผ่าน
  if not p_approve then
    v_new_status := 'rejected';
  else
    v_new_status := case
      when v_dept_done and v_it_done then 'approved'
      when v_dept_done then 'pending_it_mgr'
      else v_req.status
    end;
  end if;
  if v_new_status is distinct from v_req.status then
    update public.itar_requests set status = v_new_status, info_return_status = null where id = v_req.id;
  end if;
end;
$$;

create or replace function public.app_itar_approve(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itar_decide(p_request_id, true, null);
end;
$$;

create or replace function public.app_itar_reject(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itar_decide(p_request_id, false, p_reason);
end;
$$;

-- ยกเลิก: ผู้ยื่นก่อน IT บันทึกลงทะเบียน · IT (ผู้ดูแลงาน) ยกเลิกแทนผู้ยื่นได้ก่อนบันทึกลงทะเบียนเช่นกัน (เหตุผลบังคับ ประวัติขึ้นต้น "IT ยกเลิกแทนผู้ยื่น: ")
-- หลังบันทึกลงทะเบียนแล้ว (รอรับทราบ/จบ) ยกเลิกไม่ได้ทุกกรณี
create or replace function public.app_itar_cancel(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itar_clean(p_reason);
  v_req public.itar_requests%rowtype;
  -- IT ยกเลิกแทนผู้ยื่น: ขึ้นต้นเหตุผลในประวัติด้วยข้อความนี้ ให้ไทม์ไลน์/ผู้ตรวจ ISO เห็นว่าไม่ใช่ผู้ยื่นยกเลิกเอง
  c_it_prefix constant text := 'IT ยกเลิกแทนผู้ยื่น: ';
  v_on_behalf boolean := false;
  v_max_reason integer := 500;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    -- ไม่ใช่ผู้ยื่น: เฉพาะผู้ดูแลงาน IT เท่านั้น
    if not private.itar_is_it_admin(v_actor.id) then
      raise exception 'เฉพาะผู้ยื่นหรือผู้ดูแลงาน IT เท่านั้นที่ยกเลิกใบขอสิทธิ์ได้' using errcode = 'insufficient_privilege';
    end if;
    v_on_behalf := true;
    v_max_reason := 500 - char_length(c_it_prefix);
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
    raise exception '%', private.itar_status_message(v_req.status) using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.itar_events e where e.request_id = v_req.id and e.action = 'applied') then
    raise exception 'ใบนี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว ยกเลิกไม่ได้ (ต้องยื่นใบใหม่เพื่อย้อนสิทธิ์)' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > v_max_reason then
    raise exception 'เหตุผลต้องไม่เกิน % ตัวอักษร', v_max_reason using errcode = 'check_violation';
  end if;

  -- info_return_status ต้องเคลียร์คู่กับการออกจาก need_info (CHECK + guard บังคับ)
  update public.itar_requests set status = 'cancelled', info_return_status = null where id = v_req.id;
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'cancelled',
          case when v_on_behalf then c_it_prefix || v_reason else v_reason end);
end;
$$;

-- IT กดรับงาน (เริ่มดำเนินการ) เมื่ออนุมัติครบแล้วเท่านั้น (ไม่มีงานด่วน)
create or replace function public.app_itar_start(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่รับงานใบขอสิทธิ์ได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'approved' then
    raise exception '%', case
      when v_req.status in ('pending_dept', 'pending_it_mgr')
        then 'ใบขอสิทธิ์ต้องอนุมัติครบทั้งสองขั้นก่อนจึงจะรับงานได้'
      else private.itar_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;

  update public.itar_requests set status = 'in_progress' where id = v_req.id;
  insert into public.itar_events (is_test, request_id, actor_id, action)
  values (v_req.is_test, v_req.id, v_actor.id, 'started');
end;
$$;

-- 11. ถามผู้ยื่น / ตอบ -----------------------------------------------------------------------
create or replace function public.app_itar_request_info(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itar_clean(p_body);
  v_req public.itar_requests%rowtype;
  v_stage text;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์ข้อความที่ต้องการถามผู้ยื่น' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- คนที่ไม่เห็นใบนี้ได้ข้อความเดียวกับใบที่ไม่มีอยู่ (ไม่บอกสถานะของใบที่ตัวเองไม่มีสิทธิ์ดู)
  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test or not private.itar_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id = v_actor.id then
    raise exception 'ผู้ยื่นถามกลับใบขอสิทธิ์ของตัวเองไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status = 'need_info' then
    raise exception 'ใบขอสิทธิ์นี้มีคำถามที่รอผู้ยื่นตอบอยู่แล้ว ถามเพิ่มได้หลังผู้ยื่นตอบ' using errcode = 'check_violation';
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
    raise exception '%', private.itar_status_message(v_req.status) using errcode = 'check_violation';
  end if;

  v_stage := private.itar_info_stage(v_req, v_actor);
  if v_stage is null then
    raise exception 'คุณไม่มีสิทธิ์ถามผู้ยื่นในใบขอสิทธิ์นี้ในขั้นตอนนี้' using errcode = 'insufficient_privilege';
  end if;

  insert into public.itar_comments (is_test, request_id, kind, stage, author_id, body)
  values (v_req.is_test, v_req.id, 'question', v_stage, v_actor.id, v_body)
  returning itar_comments.id into v_comment_id;

  update public.itar_requests set status = 'need_info', info_return_status = v_req.status where id = v_req.id;
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'info_requested',
          'ถามผู้ยื่น (' || case v_stage when 'dept' then 'ผู้จัดการแผนก' when 'it_mgr' then 'ผู้อนุมัติขั้น IT' else 'ทีม IT' end
          || '): ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

create or replace function public.app_itar_provide_info(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itar_clean(p_body);
  v_req public.itar_requests%rowtype;
  v_question public.itar_comments%rowtype;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์คำตอบ' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้ยื่นเท่านั้นที่ตอบคำถามได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'need_info' then
    raise exception 'ใบขอสิทธิ์นี้ไม่มีคำถามที่รอตอบ' using errcode = 'check_violation';
  end if;

  v_question := private.itar_pending_question(v_req.id);
  if v_question.id is null then
    raise exception 'ไม่พบคำถามที่รอตอบของใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;

  insert into public.itar_comments (is_test, request_id, kind, stage, author_id, body, reply_to)
  values (v_req.is_test, v_req.id, 'answer', v_question.stage, v_actor.id, v_body, v_question.id)
  returning itar_comments.id into v_comment_id;

  update public.itar_requests set status = v_req.info_return_status, info_return_status = null where id = v_req.id;
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'info_provided', 'ผู้ยื่นตอบคำถาม: ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

-- 12. ไฟล์แนบ: ลงทะเบียนไฟล์ที่อัปโหลดแล้ว ------------------------------------------------------
-- ตอนยื่น · ผู้ยื่นเท่านั้น · แนบได้ภายใน 30 นาทีหลังยื่นและก่อนมีผู้อื่นอนุมัติจริง · ≤10 ไฟล์ต่อครั้งที่ยื่น
create or replace function public.app_itar_add_attachment(p_request_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_file_name text := private.itar_clean(p_file_name);
  v_existing public.itar_attachments%rowtype;
  v_file record;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้ยื่นเท่านั้นที่แนบไฟล์ให้ใบขอสิทธิ์ได้' using errcode = 'insufficient_privilege';
  end if;

  -- path ต้องอยู่ใต้โฟลเดอร์ของใบนี้ และรูปแบบถูกต้อง
  if p_storage_path is null or private.itar_file_path_request_id(p_storage_path) is distinct from v_req.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของใบเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม (ไฟล์ของข้อความ/ใบรับทราบกระดาษใช้ RPC ของตัวเอง)
  select * into v_existing from public.itar_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.request_id = v_req.id and v_existing.comment_id is null and not v_existing.is_paper_ack then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
    raise exception 'ใบขอสิทธิ์นี้สิ้นสุดแล้วหรือบันทึกลงทะเบียนแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
  end if;
  if now() - v_req.created_at > private.itar_attach_window() then
    raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังยื่นใบขอสิทธิ์)' using errcode = 'check_violation';
  end if;
  if private.itar_has_real_approval(v_req.id, v_req.requester_id) then
    raise exception 'มีผู้อนุมัติใบขอสิทธิ์นี้แล้ว แนบไฟล์เพิ่มไม่ได้' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.itar_attachments a where a.request_id = v_req.id and a.comment_id is null and not a.is_paper_ack) >= 10 then
    raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ยื่น' using errcode = 'check_violation';
  end if;

  -- ไฟล์ต้องอยู่ใน Storage จริง ในบัคเก็ตตามโหมดของใบ และผู้เรียกเป็นคนอัปโหลดเอง
  -- ชนิดและขนาดใช้ค่าจาก metadata ของ Storage เท่านั้น (ค่า p_mime_type / p_size_bytes ที่ผู้เรียกส่งมาไม่ถูกเชื่อ)
  select * into v_file from private.itar_read_stored_file(v_req.is_test, p_storage_path);

  insert into public.itar_attachments (is_test, request_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_req.is_test, v_req.id, p_storage_path, v_file_name, v_file.mime_type, v_file.size_bytes, v_actor.id)
  returning itar_attachments.id into v_id;
  return v_id;
end;
$$;

-- ไฟล์ของข้อความถาม/ตอบ · ผู้เขียนข้อความเท่านั้น · ≤10 ไฟล์ต่อข้อความ ภายใน 30 นาทีหลังส่งข้อความ
create or replace function public.app_itar_add_comment_attachment(p_request_id uuid, p_comment_id bigint, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_comment public.itar_comments%rowtype;
  v_file_name text := private.itar_clean(p_file_name);
  v_existing public.itar_attachments%rowtype;
  v_file record;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test or not private.itar_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  select * into v_comment from public.itar_comments c where c.id = p_comment_id and c.request_id = v_req.id;
  if v_comment.id is null then
    raise exception 'ไม่พบข้อความนี้ในใบขอสิทธิ์' using errcode = 'check_violation';
  end if;
  if v_comment.author_id <> v_actor.id then
    raise exception 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้' using errcode = 'insufficient_privilege';
  end if;

  if p_storage_path is null or private.itar_file_path_request_id(p_storage_path) is distinct from v_req.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของข้อความเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม
  select * into v_existing from public.itar_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.request_id = v_req.id and v_existing.comment_id is not distinct from v_comment.id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if v_req.status in ('rejected', 'cancelled', 'done') then
    raise exception 'ใบขอสิทธิ์นี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
  end if;
  if now() - v_comment.created_at > private.itar_attach_window() then
    raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังส่งข้อความ)' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.itar_attachments a where a.comment_id = v_comment.id) >= 10 then
    raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อข้อความ' using errcode = 'check_violation';
  end if;

  select * into v_file from private.itar_read_stored_file(v_req.is_test, p_storage_path);

  insert into public.itar_attachments (is_test, request_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_req.is_test, v_req.id, v_comment.id, p_storage_path, v_file_name, v_file.mime_type, v_file.size_bytes, v_actor.id)
  returning itar_attachments.id into v_id;
  return v_id;
end;
$$;

-- รูปใบรับทราบที่เซ็นด้วยกระดาษ · ผู้ดูแลงาน IT เท่านั้น · ใบต้องรอรับทราบและผู้รับสิทธิ์ไม่มีบัญชี · ≤10 ไฟล์ · ไม่จำกัดเวลา
create or replace function public.app_itar_add_paper_attachment(p_request_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_file_name text := private.itar_clean(p_file_name);
  v_existing public.itar_attachments%rowtype;
  v_file record;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่แนบรูปใบรับทราบที่เซ็นแล้วได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'awaiting_ack' then
    raise exception 'แนบรูปใบรับทราบได้เฉพาะใบที่ IT บันทึกสิทธิ์ลงทะเบียนแล้วและรอผู้ใช้รับทราบ' using errcode = 'check_violation';
  end if;
  if v_req.subject_employee_id is not null then
    raise exception 'ผู้รับสิทธิ์คนนี้มีบัญชีในระบบ ต้องกดรับทราบเองในระบบ (ไม่ใช้ใบกระดาษ)' using errcode = 'check_violation';
  end if;

  if p_storage_path is null or private.itar_file_path_request_id(p_storage_path) is distinct from v_req.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_existing from public.itar_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.request_id = v_req.id and v_existing.is_paper_ack then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.itar_attachments a where a.request_id = v_req.id and a.is_paper_ack) >= 10 then
    raise exception 'แนบรูปใบรับทราบได้ไม่เกิน 10 ไฟล์' using errcode = 'check_violation';
  end if;

  select * into v_file from private.itar_read_stored_file(v_req.is_test, p_storage_path);

  insert into public.itar_attachments (is_test, request_id, is_paper_ack, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_req.is_test, v_req.id, true, p_storage_path, v_file_name, v_file.mime_type, v_file.size_bytes, v_actor.id)
  returning itar_attachments.id into v_id;
  return v_id;
end;
$$;

-- 13. ฟอร์มยื่นใบ + ค้นหาผู้รับสิทธิ์ ---------------------------------------------------------
-- ข้อมูลประกอบหน้าฟอร์มยื่น: ผู้รับสิทธิ์ที่ตัดสินแล้ว (ตัวเองหรือผู้ที่ยื่นแทนได้) + สิทธิ์ปัจจุบันของเขา (ถ้าผูกทะเบียนแล้ว) + รายการโฟลเดอร์/โปรแกรมที่ขอได้ + นโยบาย
--   สิทธิ์ปัจจุบันเปิดเฉพาะของผู้รับสิทธิ์ที่ผู้เรียกมีสิทธิ์ยื่นให้ (ตัดสินที่ private.itar_resolve_subject) ไม่เปิดทะเบียนคนอื่น
create or replace function public.app_itar_form_context(p_request_type text default 'change', p_subject jsonb default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_type text := coalesce(private.itar_clean(p_request_type), 'change');
  v_subj record;
  v_is_admin boolean;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if v_type not in ('new', 'change', 'revoke_all') then
    raise exception 'ประเภทคำขอต้องเป็น new, change หรือ revoke_all' using errcode = 'check_violation';
  end if;
  v_is_admin := private.itar_is_it_admin(v_actor.id);
  select * into v_subj from private.itar_resolve_subject(v_actor, v_type, p_subject);
  return jsonb_build_object(
    'request_type', v_type,
    'subject', jsonb_build_object(
      'employee_id', v_subj.o_employee_id,
      'user_id', v_subj.o_user_id,
      'name_th', v_subj.o_name_th,
      'name_en', v_subj.o_name_en,
      'department_id', v_subj.o_department_id,
      'department_code', v_subj.o_department_code,
      'department_name', (select d.name_th from public.departments d where d.id = v_subj.o_department_id),
      'division', v_subj.o_division),
    -- ผูกทะเบียนแล้ว = รู้สิทธิ์ปัจจุบัน (ฟอร์มส่งเป็น from) · ยังไม่ผูก = ขอได้เฉพาะ "to" แล้ว IT เลือกผู้ใช้ตอนดำเนินการ
    'linked', v_subj.o_user_id is not null,
    'rights', case when v_subj.o_user_id is not null then private.itar_subject_rights(v_subj.o_user_id) end,
    'catalog', jsonb_build_object(
      'folders', coalesce((
        select jsonb_agg(jsonb_build_object('code', f.code, 'name', f.name, 'description', f.description) order by f.sort, f.code)
        from public.itua_folders f where f.is_test = v_actor.is_test and f.is_active), '[]'::jsonb),
      'programs', coalesce((
        select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name) order by p.sort, p.code)
        from public.itua_programs p where p.is_test = v_actor.is_test and p.is_active), '[]'::jsonb)),
    -- รายชื่อแผนกให้ผู้ดูแลงาน IT เลือกเมื่อยื่นแทนคนที่ไม่มีบัญชี
    'departments', case when v_is_admin then coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th) order by d.name_th)
        from public.departments d where d.is_active), '[]'::jsonb) end,
    'policy', private.itar_policy()
  );
end;
$$;

-- ค้นหาผู้รับสิทธิ์ตอนยื่นแทน (ผู้ดูแลงาน IT: พนักงานทุกคน + ผู้ใช้ในทะเบียน · ผู้จัดการ/ผู้ช่วยแผนก: เฉพาะคนในแผนกตัวเอง สำหรับยกเลิกทั้งหมด)
--   ผู้ใช้ในทะเบียนเปิดให้เฉพาะผู้อยู่ใน itas_admins และผู้จัดการแผนก (เฉพาะรหัสแผนกตรงกับแผนกตัวเอง) · คืนสูงสุด 20 รายการต่อกลุ่ม
create or replace function public.app_itar_search_subjects(p_search text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_q text := lower(coalesce(private.itar_clean(p_search), ''));
  v_is_admin boolean;
  v_is_register_admin boolean;
  v_is_dept_approver boolean;
  v_dept_code text;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  v_is_admin := private.itar_is_it_admin(v_actor.id);
  v_is_register_admin := private.itar_is_itas_admin(v_actor.id, v_actor.is_test);
  v_is_dept_approver := private.itar_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test);
  if not v_is_admin and not v_is_dept_approver then
    raise exception 'เฉพาะผู้ดูแลงาน IT หรือผู้จัดการ/ผู้ช่วยผู้จัดการแผนกเท่านั้นที่ค้นหาผู้รับสิทธิ์ได้' using errcode = 'insufficient_privilege';
  end if;
  if char_length(v_q) < 2 or char_length(v_q) > 100 then
    raise exception 'กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร' using errcode = 'check_violation';
  end if;
  select d.code into v_dept_code from public.departments d where d.id = v_actor.department_id;

  return jsonb_build_object(
    'employees', coalesce((
      select jsonb_agg(x.j order by x.ord) from (
        select jsonb_build_object('id', e.id, 'employee_no', e.employee_no, 'full_name', e.first_name || ' ' || e.last_name,
                                  'department_id', e.department_id, 'department_name', d.name_th,
                                  'user_id', (select u.id from public.itua_users u where u.employee_id = e.id and u.is_test = e.is_test
                                              and v_is_register_admin)) as j,
               e.employee_no as ord
        from public.employees e
        join public.departments d on d.id = e.department_id
        where e.is_test = v_actor.is_test and e.deleted_at is null and (e.is_test or e.is_active)
          and (v_is_admin or e.department_id = v_actor.department_id)
          and (position(v_q in lower(e.employee_no)) > 0 or position(v_q in lower(e.first_name || ' ' || e.last_name)) > 0)
        order by e.employee_no
        limit 20) x), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(x.j order by x.ord) from (
        select jsonb_build_object('id', u.id, 'auth_id', u.auth_id, 'name_th', u.name_th, 'name_en', u.name_en,
                                  'department_code', u.department_code, 'status', u.status, 'employee_id', u.employee_id) as j,
               u.auth_id as ord
        from public.itua_users u
        where u.is_test = v_actor.is_test
          and (v_is_register_admin or (v_is_dept_approver and u.status = 'active' and upper(u.department_code) = upper(v_dept_code)))
          and (position(v_q in lower(u.auth_id)) > 0 or position(v_q in lower(coalesce(u.name_th, ''))) > 0
               or position(v_q in lower(coalesce(u.name_en, ''))) > 0)
        order by u.auth_id
        limit 20) x), '[]'::jsonb)
  );
end;
$$;

-- 14. IT บันทึกสิทธิ์ลงทะเบียน ----------------------------------------------------------------
-- ข้อมูลประกอบหน้า "ปรับสิทธิ์ตามใบ" (ผู้ดูแลงาน IT ที่อยู่ใน itas_admins เท่านั้น): รายการที่ขอ + ค่าปัจจุบันในทะเบียน + ผู้ใช้ที่น่าจะตรงกับผู้รับสิทธิ์
--   current_value ต่อรายการ (เมื่อผูกผู้ใช้ทะเบียนแล้ว): folder = R/F/null · internet/program = 'true'/'false' · email = 'active'/null
create or replace function public.app_itar_apply_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not (private.itar_is_it_admin(v_actor.id) and private.itar_is_itas_admin(v_actor.id, v_actor.is_test)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT ที่อยู่ในรายชื่อผู้ใช้ทะเบียนสิทธิ์เท่านั้นที่บันทึกสิทธิ์ลงทะเบียนได้' using errcode = 'insufficient_privilege';
  end if;
  select * into v_req from public.itar_requests w where w.id = p_request_id;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id, 'doc_no', v_req.doc_no, 'request_type', v_req.request_type, 'status', v_req.status, 'reason', v_req.reason,
      'subject_employee_id', v_req.subject_employee_id, 'subject_user_id', v_req.subject_user_id,
      'subject_name_th', v_req.subject_name_th, 'subject_name_en', v_req.subject_name_en,
      'subject_department_code', v_req.subject_department_code, 'subject_division', v_req.subject_division),
    -- ต้องเลือกผู้ใช้ทะเบียนตอนบันทึก (change/revoke_all ที่ยังไม่ผูก) · new = สร้างผู้ใช้ใหม่ (ต้องระบุ Auth. Name)
    'needs_user_choice', v_req.request_type <> 'new' and v_req.subject_user_id is null,
    'needs_new_user', v_req.request_type = 'new',
    'can_apply', v_req.status = 'in_progress',
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'line_no', i.line_no, 'kind', i.kind, 'target', i.target, 'from_known', i.from_known,
               'from_value', i.from_value, 'to_value', i.to_value, 'note', i.note, 'email_kind', i.email_kind,
               'target_name', case i.kind
                 when 'folder' then (select f.name from public.itua_folders f where f.is_test = v_req.is_test and f.code = i.target)
                 when 'program' then (select p.name from public.itua_programs p where p.is_test = v_req.is_test and p.code = i.target) end,
               'current_known', v_req.subject_user_id is not null or v_req.request_type = 'new',
               'current_value', case
                 when v_req.subject_user_id is null then null
                 when i.kind = 'folder' then (select g.level from public.itua_folder_grants g join public.itua_folders f on f.id = g.folder_id
                                              where g.user_id = v_req.subject_user_id and f.code = i.target and f.is_test = v_req.is_test)
                 when i.kind = 'internet' then (select u.internet::text from public.itua_users u where u.id = v_req.subject_user_id)
                 when i.kind = 'program' then (select exists (select 1 from public.itua_program_grants g join public.itua_programs p on p.id = g.program_id
                                                              where g.user_id = v_req.subject_user_id and p.code = i.target and p.is_test = v_req.is_test)::text)
                 when i.kind = 'email' then (select 'active' from public.itua_emails m
                                             where m.user_id = v_req.subject_user_id and m.address = i.target and m.status = 'active')
               end,
               'result', (select jsonb_build_object('decision', r.decision, 'reason', r.reason, 'at', r.created_at)
                          from public.itar_item_results r where r.item_id = i.id)
             ) order by i.line_no)
      from public.itar_request_items i where i.request_id = v_req.id), '[]'::jsonb),
    'subject_rights', case when v_req.subject_user_id is not null then private.itar_subject_rights(v_req.subject_user_id) end,
    -- ผู้ใช้ทะเบียนที่น่าจะเป็นคนเดียวกัน: ผูกกับพนักงานเดียวกัน หรือชื่อไทย/อังกฤษตรงกัน (ใช้ช่วยเลือก หรือเตือนซ้ำเมื่อขอใหม่)
    'suggested_users', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'auth_id', u.auth_id, 'name_th', u.name_th, 'name_en', u.name_en,
                                          'department_code', u.department_code, 'status', u.status, 'employee_id', u.employee_id)
                       order by u.auth_id)
      from (
        select u0.* from public.itua_users u0
        where u0.is_test = v_req.is_test
          and ((v_req.subject_employee_id is not null and u0.employee_id = v_req.subject_employee_id)
               or (v_req.subject_name_th is not null and lower(u0.name_th) = lower(v_req.subject_name_th))
               or (v_req.subject_name_en is not null and lower(u0.name_en) = lower(v_req.subject_name_en)))
        order by u0.auth_id
        limit 10) u), '[]'::jsonb)
  );
end;
$$;

-- IT บันทึกสิทธิ์ลงทะเบียนตามใบ (ครั้งเดียวต่อใบ · atomic ทั้งใบ: ข้อใดผิด/ข้อมูลเก่าไม่ตรง = ไม่เปลี่ยนอะไรเลย รวมทั้งประวัติ)
--   ต้องเป็นทั้งผู้ดูแลงาน IT (itwo_staff) และอยู่ใน itas_admins ของโหมดนั้น · ใบต้อง in_progress (IT กดรับงานแล้ว)
--   p_decisions: array ครบทุกรายการของใบ [{item_id, decision:'applied'|'rejected', reason}] (rejected ต้องมีเหตุผล) · ประเภท revoke_all ส่งว่าง
--   p_user_id: ผู้ใช้ในทะเบียน (บังคับเมื่อใบ change/revoke_all ยังไม่ผูกผู้ใช้) · p_new_user: {auth_id, name_th?, name_en?} (บังคับเมื่อใบ new)
--   p_link_employee: true = ผูก employee_id ของผู้ใช้ทะเบียนกับพนักงานผู้รับสิทธิ์ (เมื่อผู้รับสิทธิ์มีบัญชีและผู้ใช้ทะเบียนยังไม่ผูก)
--   ก่อนเขียนทะเบียน ค่า "เดิม" ของทุกรายการต้องตรงกับทะเบียนปัจจุบัน (ไม่ตรง = 40001 ให้โหลดใหม่) · เขียนผ่าน app_itua_* เดิมจึงลง itua_log ครบ พร้อมอ้างเลขใบ
--   ใบ new/change: ไป awaiting_ack (รอผู้ใช้รับทราบ) · ใบ revoke_all: ถอดสิทธิ์ทั้งหมด + ปิดอีเมล + สถานะ resigned แล้วไป done เลย
create or replace function public.app_itar_apply(
  p_request_id uuid,
  p_decisions jsonb,
  p_user_id uuid default null,
  p_new_user jsonb default null,
  p_link_employee boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_item public.itar_request_items%rowtype;
  v_decisions jsonb := coalesce(p_decisions, '[]'::jsonb);
  v_dec jsonb;
  v_dec_id text;
  v_decision text;
  v_dec_reason text;
  v_map jsonb := '{}'::jsonb;
  v_total integer;
  v_applied integer := 0;
  v_rejected integer := 0;
  v_user public.itua_users%rowtype;
  v_user_id uuid;
  v_link boolean := false;
  v_new jsonb;
  v_data jsonb;
  v_event_id bigint;
  v_before jsonb;
  v_after jsonb;
  v_changes jsonb := '[]'::jsonb;
  v_reg_reason text;
  v_from_level text;
  v_to_level text;
  v_from_flag boolean;
  v_to_flag boolean;
  v_cur_exists boolean;
  v_email public.itua_emails%rowtype;
  v_today text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
  v_summary_items jsonb := '[]'::jsonb;
  v_new_status text;
  v_label text;
  v_grant record;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not (private.itar_is_it_admin(v_actor.id) and private.itar_is_itas_admin(v_actor.id, v_actor.is_test)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT ที่อยู่ในรายชื่อผู้ใช้ทะเบียนสิทธิ์เท่านั้นที่บันทึกสิทธิ์ลงทะเบียนได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'in_progress' then
    raise exception '%', case v_req.status
      when 'approved' then 'ต้องกดรับงานก่อนจึงจะบันทึกสิทธิ์ลงทะเบียนได้'
      when 'pending_dept' then 'ใบขอสิทธิ์ต้องอนุมัติครบทั้งสองขั้นก่อน'
      when 'pending_it_mgr' then 'ใบขอสิทธิ์ต้องอนุมัติครบทั้งสองขั้นก่อน'
      else private.itar_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;
  v_reg_reason := 'ตามใบขอสิทธิ์ ' || v_req.doc_no;

  -- 1) ตรวจการตัดสินต่อรายการ: ครบทุกรายการ ไม่ซ้ำ ไม่เกิน rejected ต้องมีเหตุผล · ใบ revoke_all ไม่มีรายการ
  select count(*) into v_total from public.itar_request_items i where i.request_id = v_req.id;
  if jsonb_typeof(v_decisions) is distinct from 'array' then
    raise exception 'การตัดสินต่อรายการต้องเป็นรูปแบบ array' using errcode = 'check_violation';
  end if;
  for v_dec in select e.value from jsonb_array_elements(v_decisions) e loop
    if jsonb_typeof(v_dec) <> 'object' then
      raise exception 'การตัดสินต่อรายการต้องเป็นรูปแบบ {item_id, decision, reason}' using errcode = 'check_violation';
    end if;
    v_dec_id := private.itar_clean(v_dec ->> 'item_id');
    v_decision := private.itar_clean(v_dec ->> 'decision');
    v_dec_reason := private.itar_clean(v_dec ->> 'reason');
    if v_dec_id is null or not exists (select 1 from public.itar_request_items i where i.request_id = v_req.id and i.id::text = v_dec_id) then
      raise exception 'การตัดสินอ้างรายการที่ไม่อยู่ในใบนี้' using errcode = 'check_violation';
    end if;
    if v_decision is null or v_decision not in ('applied', 'rejected') then
      raise exception 'การตัดสินต่อรายการต้องเป็น applied (บันทึกลงทะเบียน) หรือ rejected (ไม่บันทึก)' using errcode = 'check_violation';
    end if;
    if v_decision = 'rejected' then
      if v_dec_reason is null then
        raise exception 'กรุณาระบุเหตุผลที่ไม่บันทึกรายการนี้ลงทะเบียน' using errcode = 'check_violation';
      end if;
      if char_length(v_dec_reason) > 500 then
        raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
      end if;
      v_rejected := v_rejected + 1;
    else
      v_dec_reason := null;
      v_applied := v_applied + 1;
    end if;
    if v_map ? v_dec_id then
      raise exception 'มีการตัดสินซ้ำสำหรับรายการเดียวกัน' using errcode = 'check_violation';
    end if;
    v_map := v_map || jsonb_build_object(v_dec_id, jsonb_build_object('decision', v_decision, 'reason', v_dec_reason));
  end loop;
  if v_req.request_type = 'revoke_all' then
    if jsonb_array_length(v_decisions) > 0 then
      raise exception 'ใบยกเลิกสิทธิ์ทั้งหมดไม่มีรายการให้ตัดสิน' using errcode = 'check_violation';
    end if;
  else
    if jsonb_array_length(v_decisions) <> v_total then
      raise exception 'ต้องตัดสินให้ครบทุกรายการของใบ (บันทึกลงทะเบียน หรือไม่บันทึกพร้อมเหตุผล)' using errcode = 'check_violation';
    end if;
    if v_applied = 0 then
      raise exception 'ต้องบันทึกลงทะเบียนอย่างน้อยหนึ่งรายการ (ถ้าไม่ดำเนินการเลย ให้ยกเลิกใบพร้อมเหตุผลแทน)' using errcode = 'check_violation';
    end if;
  end if;

  -- 2) หาผู้ใช้ในทะเบียน
  if v_req.request_type = 'new' then
    if p_user_id is not null or v_req.subject_user_id is not null then
      raise exception 'ใบขอสิทธิ์ใหม่สร้างผู้ใช้ใหม่ในทะเบียน ไม่ต้องเลือกผู้ใช้เดิม' using errcode = 'check_violation';
    end if;
    v_new := coalesce(p_new_user, '{}'::jsonb);
    if jsonb_typeof(v_new) <> 'object' or private.itar_clean(v_new ->> 'auth_id') is null then
      raise exception 'กรุณาระบุ Auth. Name ของผู้ใช้ใหม่ (เช่น somchai.k)' using errcode = 'check_violation';
    end if;
    -- ข้อมูลผู้ใช้ใหม่: ชื่อ/แผนก/ฝ่ายจาก snapshot ของใบ (แก้ชื่อได้ผ่าน p_new_user) · ลงเลขใบและวันที่ให้สิทธิ์ตั้งแต่สร้าง
    v_data := jsonb_strip_nulls(jsonb_build_object(
      'auth_id', v_new ->> 'auth_id',
      'name_th', coalesce(private.itar_clean(v_new ->> 'name_th'), v_req.subject_name_th),
      'name_en', coalesce(private.itar_clean(v_new ->> 'name_en'), v_req.subject_name_en),
      'department_code', v_req.subject_department_code,
      'division', v_req.subject_division,
      'granted_doc_no', v_req.doc_no,
      'granted_on', v_today,
      'employee_id', v_req.subject_employee_id));
  else
    v_user_id := coalesce(v_req.subject_user_id, p_user_id);
    if v_req.subject_user_id is not null and p_user_id is not null and p_user_id <> v_req.subject_user_id then
      raise exception 'ใบนี้ผูกกับผู้ใช้ในทะเบียนไว้แล้ว เลือกผู้ใช้อื่นไม่ได้' using errcode = 'check_violation';
    end if;
    if v_user_id is null then
      raise exception 'กรุณาเลือกผู้ใช้ในทะเบียนสิทธิ์ที่ตรงกับผู้รับสิทธิ์' using errcode = 'check_violation';
    end if;
    select * into v_user from public.itua_users u where u.id = v_user_id and u.is_test = v_req.is_test;
    if v_user.id is null then
      raise exception 'ไม่พบผู้ใช้นี้ในทะเบียนสิทธิ์' using errcode = 'check_violation';
    end if;
    if v_user.status <> 'active' then
      raise exception 'ผู้ใช้นี้ลาออกแล้วในทะเบียนสิทธิ์ บันทึกสิทธิ์ตามใบนี้ไม่ได้' using errcode = 'check_violation';
    end if;
    if v_req.subject_employee_id is not null and v_user.employee_id is not null and v_user.employee_id <> v_req.subject_employee_id then
      raise exception 'ผู้ใช้ในทะเบียนนี้ผูกกับพนักงานคนอื่น เลือกผู้ใช้ไม่ตรงกับผู้รับสิทธิ์' using errcode = 'check_violation';
    end if;
    v_link := coalesce(p_link_employee, false) and v_req.subject_employee_id is not null and v_user.employee_id is null;
  end if;

  -- 3) เหตุการณ์ applied ก่อนเขียนทะเบียน: เป็นหลักฐานที่มาของ itua_log (private.itua_log ตรวจกับเหตุการณ์นี้) · ทั้งใบ rollback ได้ถ้าข้อใดล้ม
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'applied',
          case when v_req.request_type = 'revoke_all'
               then 'IT ถอดสิทธิ์ทั้งหมด ปิดอีเมล และเปลี่ยนสถานะผู้ใช้เป็นลาออกในทะเบียนแล้ว (ไม่ต้องรอรับทราบ)'
               else 'IT บันทึกสิทธิ์ลงทะเบียนแล้ว ' || v_applied || ' รายการ'
                    || case when v_rejected > 0 then ' ไม่บันทึก ' || v_rejected || ' รายการ' else '' end end)
  returning itar_events.id into v_event_id;

  for v_item in select * from public.itar_request_items i where i.request_id = v_req.id order by i.line_no loop
    v_dec := v_map -> v_item.id::text;
    insert into public.itar_item_results (is_test, request_id, item_id, decision, reason, decided_by)
    values (v_req.is_test, v_req.id, v_item.id, v_dec ->> 'decision', v_dec ->> 'reason', v_actor.id);
    v_summary_items := v_summary_items || jsonb_build_array(jsonb_build_object(
      'line_no', v_item.line_no, 'kind', v_item.kind, 'target', v_item.target, 'to', v_item.to_value,
      'decision', v_dec ->> 'decision', 'reason', v_dec ->> 'reason'));
  end loop;

  perform private.itar_begin_apply(v_event_id);

  -- 4) เขียนทะเบียน (ผ่าน RPC ของทะเบียนเดิมทั้งหมด จึงตรวจสิทธิ์/ค่าเดิม/ลง itua_log ตามกติกาของทะเบียน)
  if v_req.request_type = 'new' then
    v_new := public.app_itua_save_user(null, v_data, null, null);
    v_user_id := (v_new -> 'user' ->> 'id')::uuid;
  end if;
  v_before := private.itar_subject_rights(v_user_id);

  if v_req.request_type = 'revoke_all' then
    -- ถอดสิทธิ์ทั้งหมดที่มีอยู่ตามทะเบียนตอนนี้ (ค่าเดิมอ่านจากทะเบียนเอง)
    for v_grant in
      select f.code as code, g.level as level
      from public.itua_folder_grants g join public.itua_folders f on f.id = g.folder_id
      where g.user_id = v_user_id order by f.code
    loop
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('kind', 'folder', 'code', v_grant.code, 'from', v_grant.level, 'to', null));
    end loop;
    if (select u.internet from public.itua_users u where u.id = v_user_id) then
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('kind', 'internet', 'from', true, 'to', false));
    end if;
    for v_grant in
      select p.code as code
      from public.itua_program_grants g join public.itua_programs p on p.id = g.program_id
      where g.user_id = v_user_id order by p.code
    loop
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('kind', 'program', 'code', v_grant.code, 'from', true, 'to', false));
    end loop;
    if jsonb_array_length(v_changes) > 0 then
      perform public.app_itua_set_grants(v_user_id, v_changes, v_reg_reason || ' (ยกเลิกสิทธิ์ทั้งหมด)');
    end if;
    for v_email in select * from public.itua_emails m where m.user_id = v_user_id and m.status = 'active' order by m.address loop
      perform public.app_itua_close_email(v_email.id, v_reg_reason || ' (ยกเลิกสิทธิ์ทั้งหมด)');
    end loop;
    perform public.app_itua_set_status(v_user_id, 'resigned', v_reg_reason || ' (ลาออก/ยกเลิกสิทธิ์ทั้งหมด)');
  else
    -- (ก) โฟลเดอร์/อินเทอร์เน็ต/โปรแกรม: รวมเป็นชุดเดียวให้ app_itua_set_grants (atomic) · ค่าเดิมของรายการที่ผู้ยื่นเห็น (from_known) ต้องตรงกับทะเบียน (set_grants ตรวจให้ = 40001)
    --      ผู้รับสิทธิ์ที่ยังไม่ผูกทะเบียนตอนยื่น (ไม่รู้ค่าเดิม): อ่านค่าเดิมจากทะเบียนตอนนี้ ถ้าตรงกับที่ขออยู่แล้วให้ IT เลือก "ไม่บันทึก" แทน
    for v_item in select * from public.itar_request_items i where i.request_id = v_req.id and i.kind in ('folder', 'internet', 'program') order by i.line_no loop
      continue when (v_map -> v_item.id::text ->> 'decision') <> 'applied';
      if v_item.kind = 'folder' then
        v_label := 'โฟลเดอร์ ' || v_item.target;
        v_to_level := v_item.to_value;
        if v_item.from_known then
          v_from_level := v_item.from_value;
        else
          select g.level into v_from_level
          from public.itua_folder_grants g join public.itua_folders f on f.id = g.folder_id
          where g.user_id = v_user_id and f.code = v_item.target and f.is_test = v_req.is_test;
          if v_from_level is not distinct from v_to_level then
            raise exception '%: ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', v_label using errcode = 'check_violation';
          end if;
        end if;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object(
          'kind', 'folder', 'code', v_item.target, 'from', v_from_level, 'to', v_to_level));
      elsif v_item.kind = 'internet' then
        v_label := 'อินเทอร์เน็ต';
        v_to_flag := v_item.to_value::boolean;
        if v_item.from_known then
          v_from_flag := v_item.from_value::boolean;
        else
          select u.internet into v_from_flag from public.itua_users u where u.id = v_user_id;
          if v_from_flag = v_to_flag then
            raise exception '%: ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', v_label using errcode = 'check_violation';
          end if;
        end if;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('kind', 'internet', 'from', v_from_flag, 'to', v_to_flag));
      else
        v_label := 'โปรแกรม ' || v_item.target;
        v_to_flag := v_item.to_value::boolean;
        if v_item.from_known then
          v_from_flag := v_item.from_value::boolean;
        else
          select exists (
            select 1 from public.itua_program_grants g join public.itua_programs p on p.id = g.program_id
            where g.user_id = v_user_id and p.code = v_item.target and p.is_test = v_req.is_test) into v_cur_exists;
          v_from_flag := v_cur_exists;
          if v_from_flag = v_to_flag then
            raise exception '%: ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', v_label using errcode = 'check_violation';
          end if;
        end if;
        v_changes := v_changes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
          'kind', 'program', 'code', v_item.target, 'from', v_from_flag, 'to', v_to_flag, 'note', v_item.note)));
      end if;
    end loop;
    if jsonb_array_length(v_changes) > 0 then
      perform public.app_itua_set_grants(v_user_id, v_changes, v_reg_reason);
    end if;

    -- (ข) อีเมล: เพิ่ม/ปิดทีละรายการ (ที่อยู่ซ้ำ/อีเมลภายในซ้ำ/ไม่พบอีเมล = ทะเบียน raise ข้อความไทยและทั้งใบ rollback)
    for v_item in select * from public.itar_request_items i where i.request_id = v_req.id and i.kind = 'email' order by i.line_no loop
      continue when (v_map -> v_item.id::text ->> 'decision') <> 'applied';
      if v_item.to_value = 'add' then
        perform public.app_itua_add_email(v_user_id, v_item.target, v_item.email_kind, v_reg_reason);
      else
        select * into v_email from public.itua_emails m where m.user_id = v_user_id and m.address = v_item.target and m.status = 'active';
        if v_email.id is null then
          raise exception 'อีเมล %: ไม่พบอีเมลนี้ที่ใช้งานอยู่ของผู้ใช้ในทะเบียน กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', v_item.target using errcode = 'check_violation';
        end if;
        perform public.app_itua_close_email(v_email.id, v_reg_reason);
      end if;
    end loop;

    -- (ค) เลขใบ/วันที่ให้สิทธิ์ล่าสุดของผู้ใช้ (ผู้ใช้ใหม่ลงตั้งแต่สร้างแล้ว) · ผูกพนักงานให้เมื่อ IT สั่ง
    if v_req.request_type = 'change' then
      select * into v_user from public.itua_users u where u.id = v_user_id;
      v_data := jsonb_build_object('granted_doc_no', v_req.doc_no, 'granted_on', v_today);
      if v_link then
        v_data := v_data || jsonb_build_object('employee_id', v_req.subject_employee_id);
      end if;
      perform public.app_itua_save_user(v_user_id, v_data, v_reg_reason, v_user.updated_at);
    end if;
  end if;

  v_after := private.itar_subject_rights(v_user_id);
  perform private.itar_end_apply();

  v_new_status := case when v_req.request_type = 'revoke_all' then 'done' else 'awaiting_ack' end;
  update public.itar_requests
  set status = v_new_status,
      subject_user_id = v_user_id,
      applied_summary = jsonb_build_object(
        'before', v_before, 'after', v_after, 'items', v_summary_items,
        'applied_count', v_applied, 'rejected_count', v_rejected, 'user_id', v_user_id)
  where id = v_req.id;

  return jsonb_build_object('status', v_new_status, 'user_id', v_user_id, 'doc_no', v_req.doc_no,
                            'applied', v_applied, 'rejected', v_rejected);
end;
$$;

-- 15. รับทราบสิทธิ์ ------------------------------------------------------------------------------
-- ผู้รับสิทธิ์ที่มีบัญชีกด "รับทราบและยอมรับนโยบาย" เอง (ชื่อ + วันเวลา = ลายเซ็นอิเล็กทรอนิกส์) · เก็บ snapshot สิทธิ์ทั้งหมดหลังเปลี่ยนลง itua_acknowledgements · ใบจบ
create or replace function public.app_itar_acknowledge(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_policy jsonb := private.itar_policy();
  v_rights jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test or not private.itar_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.subject_employee_id is distinct from v_actor.id then
    raise exception 'เฉพาะผู้รับสิทธิ์เท่านั้นที่กดรับทราบสิทธิ์ของตัวเองได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'awaiting_ack' then
    raise exception '%', case when v_req.status = 'done' then 'ใบขอสิทธิ์นี้รับทราบและจบงานแล้ว' else private.itar_status_message(v_req.status) end
      using errcode = 'check_violation';
  end if;
  v_rights := private.itar_subject_rights(v_req.subject_user_id);
  if v_rights is null then
    raise exception 'ไม่พบผู้ใช้ในทะเบียนสิทธิ์ของใบนี้ กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  insert into public.itua_acknowledgements (is_test, user_id, request_id, acknowledged_by, snapshot, policy_version)
  values (v_req.is_test, v_req.subject_user_id, v_req.id, v_actor.id,
          v_rights || jsonb_build_object('method', 'online', 'doc_no', v_req.doc_no, 'policy_text', v_policy ->> 'text'),
          v_policy ->> 'version');
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'acknowledged', 'ผู้ใช้รับทราบสิทธิ์และยอมรับนโยบาย (' || (v_policy ->> 'version') || ')');
  update public.itar_requests set status = 'done' where id = v_req.id;

  return jsonb_build_object('status', 'done', 'doc_no', v_req.doc_no);
end;
$$;

-- IT กด "รับทราบแล้ว (กระดาษ)" แทนผู้รับสิทธิ์ที่ไม่มีบัญชี · ต้องแนบรูปใบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ (app_itar_add_paper_attachment) · เก็บ snapshot ลง itua_acknowledgements (method = paper)
create or replace function public.app_itar_acknowledge_paper(p_request_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
  v_note text := private.itar_clean(p_note);
  v_policy jsonb := private.itar_policy();
  v_rights jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการรับทราบด้วยกระดาษได้' using errcode = 'insufficient_privilege';
  end if;
  if v_note is not null and char_length(v_note) > 300 then
    raise exception 'หมายเหตุต้องไม่เกิน 300 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_req from public.itar_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบขอสิทธิ์นี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'awaiting_ack' then
    raise exception '%', private.itar_status_message(v_req.status) using errcode = 'check_violation';
  end if;
  if v_req.subject_employee_id is not null then
    raise exception 'ผู้รับสิทธิ์คนนี้มีบัญชีในระบบ ต้องกดรับทราบเองในระบบ (ไม่ใช้ใบกระดาษ)' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.itar_attachments a where a.request_id = v_req.id and a.is_paper_ack) then
    raise exception 'กรุณาแนบรูปใบรับทราบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ก่อน' using errcode = 'check_violation';
  end if;
  v_rights := private.itar_subject_rights(v_req.subject_user_id);
  if v_rights is null then
    raise exception 'ไม่พบผู้ใช้ในทะเบียนสิทธิ์ของใบนี้' using errcode = 'check_violation';
  end if;

  insert into public.itua_acknowledgements (is_test, user_id, request_id, acknowledged_by, snapshot, policy_version)
  values (v_req.is_test, v_req.subject_user_id, v_req.id, v_actor.id,
          v_rights || jsonb_build_object('method', 'paper', 'doc_no', v_req.doc_no, 'policy_text', v_policy ->> 'text', 'note', v_note),
          v_policy ->> 'version');
  insert into public.itar_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'acknowledged',
          'IT บันทึกการรับทราบด้วยกระดาษ (แนบรูปใบที่เซ็นแล้ว)' || case when v_note is not null then ': ' || v_note else '' end);
  update public.itar_requests set status = 'done' where id = v_req.id;

  return jsonb_build_object('status', 'done', 'doc_no', v_req.doc_no);
end;
$$;

-- 16. อ่านข้อมูล ----------------------------------------------------------------------
-- รายละเอียดใบ (ผู้ยื่น/ผู้รับสิทธิ์/ทีม IT/ผู้อนุมัติแผนกของใบนั้น) · สิทธิ์ที่แสดงมีเฉพาะของผู้รับสิทธิ์ในใบนี้ (ไม่เปิดทะเบียนคนอื่น ไม่มีรหัสผ่าน/ช่องลับ)
create or replace function public.app_itar_get_detail(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itar_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  select * into v_req from public.itar_requests w where w.id = p_request_id;
  if v_req.id is null or not private.itar_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_req.id,
    'is_test', v_req.is_test,
    'doc_no', v_req.doc_no,
    'doc_year', v_req.doc_year,
    'doc_seq', v_req.doc_seq,
    'request_type', v_req.request_type,
    'reason', v_req.reason,
    'status', v_req.status,
    'info_return_status', v_req.info_return_status,
    'created_at', v_req.created_at,
    'requester_id', v_req.requester_id,
    'department_id', v_req.department_id,
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_req.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_req.department_id),
    -- ผู้รับสิทธิ์: snapshot ตอนยื่น · has_account = มีบัญชีพนักงาน (รับทราบในเว็บ) · user_id = ผู้ใช้ในทะเบียนที่ผูกแล้ว
    'subject', jsonb_build_object(
      'employee_id', v_req.subject_employee_id,
      'employee_no', (select s.employee_no from public.employees s where s.id = v_req.subject_employee_id),
      'user_id', v_req.subject_user_id,
      'name_th', v_req.subject_name_th,
      'name_en', v_req.subject_name_en,
      'department_code', v_req.subject_department_code,
      'division', v_req.subject_division,
      'has_account', v_req.subject_employee_id is not null),
    -- รายการสิทธิ์ที่ขอ (ก่อน -> หลัง) พร้อมผลที่ IT ตัดสิน (ถ้าตัดสินแล้ว)
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', i.id,
               'line_no', i.line_no,
               'kind', i.kind,
               'target', i.target,
               'target_name', case i.kind
                 when 'folder' then (select f.name from public.itua_folders f where f.is_test = v_req.is_test and f.code = i.target)
                 when 'program' then (select p.name from public.itua_programs p where p.is_test = v_req.is_test and p.code = i.target) end,
               'from_known', i.from_known,
               'from_value', i.from_value,
               'to_value', i.to_value,
               'note', i.note,
               'email_kind', i.email_kind,
               'result', (select jsonb_build_object('decision', r.decision, 'reason', r.reason, 'at', r.created_at)
                          from public.itar_item_results r where r.item_id = i.id)
             ) order by i.line_no), '[]'::jsonb)
      from public.itar_request_items i where i.request_id = v_req.id),
    -- สิทธิ์ปัจจุบันของผู้รับสิทธิ์ในทะเบียน (ถ้าผูกแล้ว)
    'subject_rights', case when v_req.subject_user_id is not null then private.itar_subject_rights(v_req.subject_user_id) end,
    'applied_summary', v_req.applied_summary,
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
      from public.itar_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id),
    -- ไฟล์ตอนยื่น (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments · รูปใบรับทราบกระดาษอยู่ใน paper_attachments)
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itar-test-files' else 'itar-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by att.created_at, att.id), '[]'::jsonb)
      from public.itar_attachments att
      join public.employees a on a.id = att.uploaded_by
      where att.request_id = v_req.id and att.comment_id is null and not att.is_paper_ack),
    'paper_attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itar-test-files' else 'itar-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by att.created_at, att.id), '[]'::jsonb)
      from public.itar_attachments att
      join public.employees a on a.id = att.uploaded_by
      where att.request_id = v_req.id and att.is_paper_ack),
    -- ถามตอบ (ทุกคนที่เห็นใบเห็นครบ) เรียงตามลำดับจริง (id)
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'stage', c.stage,
               'body', c.body,
               'reply_to', c.reply_to,
               'created_at', c.created_at,
               'author_employee_no', a.employee_no,
               'author_full_name', a.first_name || ' ' || a.last_name,
               'attachments', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', att.id,
                          'storage_path', att.storage_path,
                          'bucket', case when att.is_test then 'itar-test-files' else 'itar-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itar_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itar_comments c
      join public.employees a on a.id = c.author_id
      where c.request_id = v_req.id),
    -- คำถามที่ค้างอยู่ (เฉพาะตอนใบ need_info) ไม่มี = null
    'info_pending', case when v_req.status = 'need_info' then (
      select jsonb_build_object(
               'comment_id', q.id,
               'stage', q.stage,
               'body', q.body,
               'asked_at', q.created_at,
               'asked_by_employee_no', a.employee_no,
               'asked_by_full_name', a.first_name || ' ' || a.last_name)
      from public.itar_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itar_pending_question(v_req.id)).id) end,
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itar_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itar_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    -- ช่องลงนามบนใบพิมพ์: IT ผู้บันทึกสิทธิ์ (applied) · ผู้รับสิทธิ์รับทราบ (acknowledged · online = ผู้รับสิทธิ์เอง / paper = IT บันทึกแทน)
    'started', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itar_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'started'
      order by ev.id limit 1),
    'applied', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
      from public.itar_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'applied'
      order by ev.id limit 1),
    'acknowledged', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason,
                                'method', case when ev.actor_id = v_req.subject_employee_id then 'online' else 'paper' end)
      from public.itar_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'acknowledged'
      order by ev.id desc limit 1),
    'policy', private.itar_policy(),
    'allowed_actions', to_jsonb(private.itar_allowed_actions(v_req, v_actor))
  );
end;
$$;

-- ใบของฉัน: ที่ผู้ทำรายการเป็นผู้ยื่น หรือเป็นผู้รับสิทธิ์ (needs_my_ack = ใบที่รอตัวเองกดรับทราบ)
create or replace function public.app_itar_list_mine()
returns table(
  id uuid, doc_no text, status text, request_type text, subject_name text, department_name text, requester_name text,
  created_at timestamptz, item_count integer, info_return_status text, info_stage text, is_requester boolean, needs_my_ack boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  return query
  select rq.id, rq.doc_no, rq.status, rq.request_type, private.itar_subject_name(rq), d.name_th,
         req.first_name || ' ' || req.last_name, rq.created_at,
         (select count(*)::integer from public.itar_request_items i where i.request_id = rq.id),
         rq.info_return_status,
         case when rq.status = 'need_info' then (private.itar_pending_question(rq.id)).stage end,
         rq.requester_id = v_actor.id,
         rq.status = 'awaiting_ack' and rq.subject_employee_id = v_actor.id
  from public.itar_requests rq
  join public.departments d on d.id = rq.department_id
  join public.employees req on req.id = rq.requester_id
  where rq.is_test = v_actor.is_test
    and (rq.requester_id = v_actor.id or rq.subject_employee_id = v_actor.id)
  order by rq.created_at desc, rq.doc_year desc, rq.doc_seq desc;
end;
$$;

-- รออนุมัติ: ใบที่ผู้ทำรายการเป็นผู้พิจารณาของขั้นที่ค้างอยู่ (ขั้นแผนกหรือขั้น IT) · ใบ need_info (รอผู้ยื่นตอบ) แสดงด้วยให้ผู้อนุมัติเห็นว่ายังค้างคำตอบ
-- ปุ่มที่กดได้จริงดูจาก allowed_actions ของ app_itar_get_detail (ระหว่างรอผู้ยื่นตอบ อนุมัติ/ไม่อนุมัติไม่ได้)
create or replace function public.app_itar_list_pending_approvals()
returns table(
  id uuid, doc_no text, status text, request_type text, subject_name text, department_name text, requester_name text,
  created_at timestamptz, item_count integer, pending_step text, info_return_status text, info_stage text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  return query
  select rq.id, rq.doc_no, rq.status, rq.request_type, private.itar_subject_name(rq), d.name_th,
         req.first_name || ' ' || req.last_name, rq.created_at,
         (select count(*)::integer from public.itar_request_items i where i.request_id = rq.id),
         case when caps.can_it then 'it_mgr' else 'dept' end,
         rq.info_return_status,
         case when rq.status = 'need_info' then (private.itar_pending_question(rq.id)).stage end
  from public.itar_requests rq
  join public.departments d on d.id = rq.department_id
  join public.employees req on req.id = rq.requester_id
  cross join lateral private.itar_approval_caps(rq.id, v_actor.id) caps
  where rq.is_test = v_actor.is_test
    and rq.requester_id <> v_actor.id
    and rq.status in ('pending_dept', 'pending_it_mgr', 'need_info')
    and (caps.can_dept or caps.can_it)
  order by rq.created_at, rq.doc_year, rq.doc_seq;
end;
$$;

-- จำนวนใบที่รอผู้ทำรายการอนุมัติ (ป้ายตัวเลข)
create or replace function public.app_itar_pending_count()
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
  v_actor := private.itar_actor();
  select count(*)::integer into v_count
  from public.itar_requests rq
  cross join lateral private.itar_approval_caps(rq.id, v_actor.id) caps
  where rq.is_test = v_actor.is_test
    and rq.requester_id <> v_actor.id
    and rq.status in ('pending_dept', 'pending_it_mgr')
    and (caps.can_dept or caps.can_it);
  return v_count;
end;
$$;

-- งาน IT: ทุกใบในโหมดของผู้ทำรายการ (ทีม IT ใน itwo_staff เท่านั้น รวมหัวหน้า IT ดูอย่างเดียว) ใบที่รอ IT ลงมือ (อนุมัติครบ/กำลังดำเนินการ) อยู่บนสุด
create or replace function public.app_itar_list_it()
returns table(
  id uuid, doc_no text, status text, request_type text, subject_name text, department_name text, requester_name text,
  created_at timestamptz, item_count integer, has_dept_approved boolean, has_it_mgr_approved boolean,
  info_return_status text, info_stage text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not private.itar_is_staff(v_actor.id) then
    raise exception 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select rq.id, rq.doc_no, rq.status, rq.request_type, private.itar_subject_name(rq), d.name_th,
         req.first_name || ' ' || req.last_name, rq.created_at,
         (select count(*)::integer from public.itar_request_items i where i.request_id = rq.id),
         exists (select 1 from public.itar_events ev where ev.request_id = rq.id and ev.action = 'dept_approved'),
         exists (select 1 from public.itar_events ev where ev.request_id = rq.id and ev.action = 'it_mgr_approved'),
         rq.info_return_status,
         case when rq.status = 'need_info' then (private.itar_pending_question(rq.id)).stage end
  from public.itar_requests rq
  join public.departments d on d.id = rq.department_id
  join public.employees req on req.id = rq.requester_id
  where rq.is_test = v_actor.is_test
  order by (rq.status in ('approved', 'in_progress')) desc, rq.created_at, rq.doc_year, rq.doc_seq;
end;
$$;

-- 17. เลขที่เอกสาร + รายชื่อทีม IT (อ่านอย่างเดียว) ---------------------------------------------
-- ดูตัวนับเลขที่เอกสาร (ผู้ดูแลงาน IT เท่านั้น)
create or replace function public.app_itar_get_doc_counter(p_year integer default null)
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
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(max(c.last_seq), 0) into v_last
  from public.itar_doc_counters c where c.is_test = v_actor.is_test and c.doc_year = v_year;
  return jsonb_build_object(
    'year', v_year, 'last_seq', v_last, 'next_seq', v_last + 1,
    'next_doc_no', private.itar_format_doc_no(v_actor.is_test, v_year, v_last + 1),
    'is_test', v_actor.is_test);
end;
$$;

-- ตั้งเลขที่เอกสารถัดไป (เดินหน้าอย่างเดียว ห้ามถอยหรือชนเลขที่ใช้แล้ว · ตั้งตามโหมดของผู้ทำรายการ) พร้อมบันทึกลง itar_admin_log
create or replace function public.app_itar_set_next_doc_seq(p_next integer, p_year integer default null)
returns jsonb
language plpgsql
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
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้' using errcode = 'insufficient_privilege';
  end if;
  if p_next is null or p_next < 1 or p_next > 9999 then
    raise exception 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999' using errcode = 'check_violation';
  end if;
  if v_year < v_this_year or v_year > v_this_year + 1 then
    raise exception 'ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า' using errcode = 'check_violation';
  end if;

  -- ล็อกแถวตัวนับ (สร้างถ้ายังไม่มี) กันชนกับการออกเลขที่กำลังเกิดขึ้น
  insert into public.itar_doc_counters (is_test, doc_year, last_seq)
  values (v_actor.is_test, v_year, 0)
  on conflict (is_test, doc_year) do nothing;
  select c.last_seq into v_last
  from public.itar_doc_counters c
  where c.is_test = v_actor.is_test and c.doc_year = v_year
  for update;
  select coalesce(max(rq.doc_seq), 0) into v_max_used
  from public.itar_requests rq
  where rq.is_test = v_actor.is_test and rq.doc_year = v_year;
  v_last := greatest(v_last, v_max_used);

  if p_next < v_last + 1 then
    raise exception 'ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง %, เลขถัดไปต้องไม่น้อยกว่า %)', v_last, v_last + 1
      using errcode = 'check_violation';
  end if;

  if p_next > v_last + 1 then
    update public.itar_doc_counters set last_seq = p_next - 1, updated_at = now()
    where is_test = v_actor.is_test and doc_year = v_year;
    insert into public.itar_admin_log (is_test, actor_id, action, detail)
    values (v_actor.is_test, v_actor.id, 'doc_seq_set',
            jsonb_build_object('year', v_year, 'previous_next', v_last + 1, 'new_next', p_next));
  end if;
  return jsonb_build_object(
    'year', v_year, 'next_seq', p_next,
    'next_doc_no', private.itar_format_doc_no(v_actor.is_test, v_year, p_next), 'is_test', v_actor.is_test);
end;
$$;

-- รายชื่อทีม IT (อ่านอย่างเดียว จาก itwo_staff) ให้แท็บตั้งค่าแสดง · แก้สิทธิ์ที่ใบสั่งงาน IT (app_itwo_set_staff) ที่เดียว ใบขอสิทธิ์ไม่มี RPC แก้สิทธิ์
create or replace function public.app_itar_list_staff()
returns table(employee_id uuid, employee_no text, full_name text, department_name text, is_it_admin boolean, is_it_approver boolean, is_it_viewer boolean,
              is_itas_admin boolean, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itar_actor();
  if not private.itar_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.name_th, s.is_it_admin, s.is_it_approver, s.is_it_viewer,
         private.itar_is_itas_admin(e.id, e.is_test), e.is_active
  from public.itwo_staff s
  join public.employees e on e.id = s.employee_id
  join public.departments d on d.id = e.department_id
  where e.is_test = v_actor.is_test
  order by e.employee_no;
end;
$$;

-- 18. ล้างข้อมูลทดสอบ -----------------------------------------------------------------
-- ลบเฉพาะแถว is_test ของตารางโมดูลนี้ (ประวัติ ISO ของจริงไม่ถูกแตะ) แล้วเริ่มนับเลข TEST-… ใหม่ · คืนรายการไฟล์ในบัคเก็ตทดสอบให้หน้าเว็บลบผ่าน Storage API
-- (storage.objects ลบด้วย SQL ไม่ได้ ต้องลบผ่าน Storage API) · เฉพาะ admin ที่อยู่ในโหมดทดสอบ (private.sandbox_persona)
-- ไม่แตะทะเบียนสิทธิ์ (itua_*) — ล้างด้วย app_sandbox_purge_itua แยกต่างหาก (itua_acknowledgements ที่อ้างใบทดสอบไม่มี FK จึงไม่ติดขัด)
create or replace function public.app_sandbox_purge_itar()
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
  v_files text[];
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกตารางเขียนของโมดูลทั้งหมดไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นยื่น/อนุมัติใบทดสอบพร้อมกันระหว่างล้าง
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> รายการ -> ข้อความ/ไฟล์แนบ -> ประวัติ/ผลต่อรายการ -> admin_log) กัน deadlock
  lock table public.itar_doc_counters, public.itar_requests, public.itar_request_items, public.itar_comments, public.itar_attachments,
             public.itar_events, public.itar_item_results, public.itar_admin_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itar.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itar.purge', 'on', true);

  -- ลูกก่อนแม่: ผลต่อรายการ -> รายการ -> ไฟล์แนบ (อ้างข้อความ) -> ข้อความ -> ประวัติ -> admin_log -> ใบ -> ตัวนับ
  foreach v_table in array array['itar_item_results', 'itar_request_items', 'itar_attachments', 'itar_comments',
                                 'itar_events', 'itar_admin_log', 'itar_requests', 'itar_doc_counters'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform set_config('itar.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select coalesce(array_agg(o.name order by o.name), '{}'::text[]) into v_files
  from storage.objects o where o.bucket_id = 'itar-test-files';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITAR_SANDBOX_PURGE', 'itar_requests', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'files_to_remove', cardinality(v_files)));
  return jsonb_build_object('deleted', v_deleted, 'files', to_jsonb(v_files));
end;
$$;

-- 19. แจ้งเตือน (กระดิ่ง/อีเมล/Push ผ่าน private.office_notify กลางของระบบสำนักงาน · ไม่ replace ตัวกลาง) --------------------
-- trigger หลังเพิ่ม event ในประวัติ (ธุรกรรมเดียวกับการอนุมัติ/บันทึกลงทะเบียน) · ใบทดสอบไม่ส่งเลย · started ไม่แจ้ง
-- ลิงก์เปิดใบตรง = /office/access/<uuid> (ต้องรองรับใน app.js notificationHref, notify-email, notify-push ฝั่งหน้าเว็บ/Edge Function — ขั้นที่ 5)
-- ผู้รับขั้นอนุมัติ: ขั้นแผนก -> ผู้อนุมัติของแผนกผู้รับสิทธิ์ · ขั้น IT -> ผู้อนุมัติขั้น IT (ใบที่เกี่ยวกับผู้อนุมัติขั้น IT เอง -> หัวหน้า IT)

-- ผู้อนุมัติขั้นแผนกที่ควรได้แจ้ง (ไม่นับผู้ยื่น/ผู้รับสิทธิ์)
create or replace function private.itar_notify_dept_approver_ids(p_req public.itar_requests)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select a.id
    from private.itar_dept_approvers(p_req.department_id, p_req.is_test) a(id)
    where a.id <> p_req.requester_id and a.id is distinct from p_req.subject_employee_id
    order by a.id)
$$;

-- ผู้ดูแลงาน IT ทุกคนใน itwo_staff (อ่านอย่างเดียว)
create or replace function private.itar_notify_it_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select s.employee_id from public.itwo_staff s where s.is_it_admin order by s.employee_id)
$$;

-- รายชื่อผู้ที่ต้องได้แจ้ง "รอคุณอนุมัติ" ขั้น IT ของใบนี้ (ใบที่เกี่ยวกับผู้อนุมัติขั้น IT เอง -> หัวหน้า IT · ใบอื่น -> ผู้อนุมัติขั้น IT)
-- ไม่นับผู้ยื่น/ผู้รับสิทธิ์ (อนุมัติใบตัวเองไม่ได้)
create or replace function private.itar_notify_it_stage_ids(p_req public.itar_requests)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select s.employee_id
    from public.itwo_staff s
    where case when private.itar_involves_it_approver(p_req.requester_id, p_req.subject_employee_id) then s.is_it_viewer else s.is_it_approver end
      and s.employee_id <> p_req.requester_id and s.employee_id is distinct from p_req.subject_employee_id
    order by s.employee_id)
$$;

-- ผู้อนุมัติของขั้นที่ใบรออยู่ตอนนี้ (ใช้ตอนผู้ยื่นยกเลิกเอง)
create or replace function private.itar_notify_stage_approver_ids(p_req public.itar_requests)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dept_done boolean;
  v_it_done boolean;
  v_dept_ids uuid[];
begin
  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itar_event_state(p_req.id) s;
  if v_dept_done and v_it_done then
    return '{}';
  end if;
  if not v_dept_done and not private.itar_is_it_department(p_req.department_id) then
    v_dept_ids := private.itar_notify_dept_approver_ids(p_req);
    if cardinality(v_dept_ids) > 0 then
      return v_dept_ids;
    end if;
  end if;
  return private.itar_notify_it_stage_ids(p_req);
end;
$$;

-- ส่งถึงหลายคนโดยไม่ซ้ำคน (คืนรายชื่อที่ส่งแล้วสะสม)
create or replace function private.itar_notify_each(p_recipients uuid[], p_already uuid[], p_actor_id uuid, p_title text, p_body text, p_action_url text)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_done uuid[] := coalesce(p_already, '{}');
  v_id uuid;
begin
  for v_id in
    select distinct r.id from unnest(coalesce(p_recipients, '{}')) r(id) where r.id is not null order by r.id
  loop
    if v_id = any (v_done) then
      continue;
    end if;
    perform private.office_notify(v_id, p_title, p_body, p_action_url, p_actor_id);
    v_done := v_done || v_id;
  end loop;
  return v_done;
end;
$$;

create or replace function private.itar_notify_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.itar_requests%rowtype;
  v_requester_name text;
  v_dept_name text;
  v_actor_name text;
  v_type_text text;
  v_summary text;
  v_title text;
  v_started boolean;
  v_url text;
  v_done uuid[] := '{}';
  v_ids uuid[];
  v_dept_done boolean;
  v_it_done boolean;
  v_question public.itar_comments%rowtype;
  v_answer public.itar_comments%rowtype;
begin
  -- ใบทดสอบ ไม่ insert เลย · started ไม่แจ้ง
  if new.is_test or new.action = 'started' then
    return new;
  end if;

  begin
    select * into v_req from public.itar_requests w where w.id = new.request_id;
    if v_req.id is null or v_req.is_test then
      return new;
    end if;

    select e.first_name || ' ' || e.last_name into v_requester_name from public.employees e where e.id = v_req.requester_id;
    select e.first_name || ' ' || e.last_name into v_actor_name from public.employees e where e.id = new.actor_id;
    select d.name_th into v_dept_name from public.departments d where d.id = v_req.department_id;
    v_type_text := private.itar_type_text(v_req.request_type);
    -- สรุป "<ชื่อผู้ยื่น> · ผู้รับสิทธิ์ <ชื่อ> · <แผนก> · <ประเภทคำขอ>"
    v_summary := concat_ws(' · ', v_requester_name, 'ผู้รับสิทธิ์ ' || private.itar_subject_name(v_req), v_dept_name, v_type_text);
    v_title := 'ใบขอสิทธิ์ ' || v_req.doc_no;
    v_url := '/office/access/' || v_req.id::text;

    if new.action = 'created' then
      -- ปลายทางแรกของใบ: รอขั้นแผนก -> ผู้อนุมัติแผนก · รอขั้น IT ทันที -> ผู้อนุมัติขั้น IT (ใบที่เกี่ยวกับผู้อนุมัติขั้น IT เอง -> หัวหน้า IT)
      if v_req.status = 'pending_dept' then
        v_ids := private.itar_notify_dept_approver_ids(v_req);
      elsif v_req.status = 'pending_it_mgr' then
        v_ids := private.itar_notify_it_stage_ids(v_req);
      else
        v_ids := '{}';
      end if;
      v_done := private.itar_notify_each(v_ids, v_done, new.actor_id, v_title || ' รอคุณอนุมัติ', v_summary, v_url);

    elsif new.action = 'dept_approved' then
      -- ข้ามเมื่ออนุมัติในตัว (ผู้ยื่นเอง) หรือผู้กดเป็นผู้อนุมัติขั้น IT ของใบนี้ (it_mgr_approved ตามมาในธุรกรรมเดียวกันเสมอ)
      if new.actor_id <> v_req.requester_id
         and not private.itar_is_it_stage_approver(v_req.requester_id, v_req.subject_employee_id, new.actor_id) then
        v_done := private.itar_notify_each(private.itar_notify_it_stage_ids(v_req), v_done, new.actor_id,
                                           v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      end if;

    elsif new.action = 'it_mgr_approved' then
      -- อนุมัติครบ: ผู้ยื่นและผู้รับสิทธิ์ที่มีบัญชีก่อน แล้วผู้ดูแลงาน IT
      v_done := private.itar_notify_each(array[v_req.requester_id, v_req.subject_employee_id], v_done, new.actor_id,
                                         v_title || ' อนุมัติครบแล้ว',
                                         'รอ IT ดำเนินการ · ' || v_type_text,
                                         v_url);
      v_done := private.itar_notify_each(private.itar_notify_it_admin_ids(), v_done, new.actor_id,
                                         v_title || ' อนุมัติครบ พร้อมให้ IT รับงาน', v_summary, v_url);

    elsif new.action in ('dept_rejected', 'it_mgr_rejected') then
      v_done := private.itar_notify_each(array[v_req.requester_id, v_req.subject_employee_id], v_done, new.actor_id,
                                         v_title || ' ไม่ได้รับอนุมัติ',
                                         concat_ws(' · ', 'เหตุผล: ' || private.office_clip(new.reason, 200), 'โดย ' || v_actor_name),
                                         v_url);

    elsif new.action = 'info_requested' then
      select * into v_question from public.itar_comments c
      where c.request_id = v_req.id and c.kind = 'question' order by c.id desc limit 1;
      v_done := private.itar_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' มีคำถามถึงคุณ',
                                         v_actor_name || ': ' || private.office_clip(coalesce(v_question.body, new.reason), 200),
                                         v_url);

    elsif new.action = 'info_provided' then
      -- แจ้งคนที่ถามคำถามข้อที่ผู้ยื่นเพิ่งตอบ (คำตอบล่าสุดของใบ -> คำถามที่มันตอบ -> ผู้ถาม)
      select * into v_answer from public.itar_comments a
      where a.request_id = v_req.id and a.kind = 'answer' order by a.id desc limit 1;
      select * into v_question from public.itar_comments q
      where q.id = v_answer.reply_to and q.request_id = v_req.id;
      if v_question.id is not null then
        v_done := private.itar_notify_each(array[v_question.author_id], v_done, new.actor_id,
                                           v_title || ' ผู้ยื่นตอบคำถามแล้ว',
                                           v_actor_name || ': ' || private.office_clip(v_answer.body, 200),
                                           v_url);
      end if;

    elsif new.action = 'applied' then
      if v_req.request_type = 'revoke_all' then
        -- ยกเลิกทั้งหมดจบทันที (ไม่ต้องรอรับทราบ): แจ้งผู้ยื่น
        v_done := private.itar_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' ยกเลิกสิทธิ์ทั้งหมดเรียบร้อยแล้ว', v_summary, v_url);
      elsif v_req.subject_employee_id is not null then
        -- ผู้รับสิทธิ์ที่มีบัญชี: ต้องกดรับทราบเอง · ผู้ยื่น (ถ้าเป็นคนละคน) ทราบว่า IT บันทึกแล้ว
        v_done := private.itar_notify_each(array[v_req.subject_employee_id], v_done, new.actor_id,
                                           v_title || ' IT ปรับสิทธิ์ให้แล้ว กรุณากดรับทราบ',
                                           'เปิดใบเพื่อตรวจสิทธิ์ของคุณและกดรับทราบ · ' || v_type_text, v_url);
        v_done := private.itar_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' IT บันทึกสิทธิ์ลงทะเบียนแล้ว รอผู้ใช้รับทราบ', v_summary, v_url);
      else
        v_done := private.itar_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' IT บันทึกสิทธิ์ลงทะเบียนแล้ว รอใบรับทราบ (กระดาษ)', v_summary, v_url);
      end if;

    elsif new.action = 'acknowledged' then
      v_done := private.itar_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' ผู้ใช้รับทราบสิทธิ์แล้ว ใบจบงาน',
                                         concat_ws(' · ', 'โดย ' || v_actor_name, private.itar_subject_name(v_req)),
                                         v_url);

    elsif new.action = 'cancelled' then
      if new.actor_id = v_req.requester_id then
        -- ผู้ยื่นยกเลิกเอง: ผู้อนุมัติของขั้นที่ใบรออยู่ · ผู้ดูแลงาน IT เมื่ออนุมัติครบแล้วหรือ IT รับงานแล้ว
        v_ids := private.itar_notify_stage_approver_ids(v_req);
        select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itar_event_state(v_req.id) s;
        select exists (select 1 from public.itar_events e where e.request_id = v_req.id and e.action = 'started') into v_started;
        if (v_dept_done and v_it_done) or v_started then
          v_ids := v_ids || private.itar_notify_it_admin_ids();
        end if;
        v_done := private.itar_notify_each(v_ids, v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', 'ผู้ยื่นยกเลิก', private.office_clip(new.reason, 200), v_summary),
                                           v_url);
      else
        -- IT ยกเลิกแทนผู้ยื่น (เหตุผลขึ้นต้นด้วย "IT ยกเลิกแทนผู้ยื่น: " อยู่แล้ว): แจ้งผู้ยื่นและผู้รับสิทธิ์ที่มีบัญชี
        v_done := private.itar_notify_each(array[v_req.requester_id, v_req.subject_employee_id], v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', v_actor_name, private.office_clip(new.reason, 200)),
                                           v_url);
      end if;
    end if;
  exception when others then
    -- แจ้งเตือนเป็นเรื่องรอง ห้ามทำให้การอนุมัติ/บันทึกลงทะเบียน (และบันทึก ISO) ล้มตาม
    raise warning 'itar_notify: สร้างแจ้งเตือนของ event % (ใบ %) ไม่สำเร็จ: % [%]', new.id, new.request_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

create trigger itar_events_notify
  after insert on public.itar_events
  for each row execute function private.itar_notify_on_event();

-- 20. สิทธิ์เรียกฟังก์ชัน ---------------------------------------------------------------------
-- private.itar_*: ถอนจาก public/anon/authenticated ทั้งหมด (เรียกได้เฉพาะผ่าน SECURITY DEFINER ของ RPC/trigger)
--   ยกเว้นตัวช่วยของ policy Storage 3 ตัวที่ต้องเรียกด้วยสิทธิ์ผู้ใช้ (คืนแค่ true/false ตามสิทธิ์ของผู้เรียกเอง)
--   private.itar_begin_apply / itar_end_apply (ตั้งที่มาของประวัติทะเบียน) ถอนสิทธิ์เหมือนตัวอื่น = ผู้ใช้เรียกเองไม่ได้ ปลอมที่มาไม่ได้
-- public.app_itar_* และ app_sandbox_purge_itar: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจพนักงานและบทบาทซ้ำอีกชั้น) anon เรียกไม่ได้
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('itar_storage_can_read', 'itar_storage_can_upload', 'itar_storage_test_file_removable')
  loop
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itar\_%' or p.proname = 'app_sandbox_purge_itar')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
  -- ฟังก์ชันเดิมที่ replace (private.itua_log, private.sandbox_unguarded_tables) คงสิทธิ์เดิม: ถอนจากผู้ใช้ทุกคนเหมือนเดิม
  revoke all on function private.itua_log() from public, anon, authenticated;
end $$;
