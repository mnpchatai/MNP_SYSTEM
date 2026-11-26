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
      or p_req.subject_employee_id = p_actor.id
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
     or p_req.requester_id = p_actor.id or p_req.subject_employee_id = p_actor.id then
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
