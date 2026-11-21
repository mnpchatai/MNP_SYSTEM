-- ============================================================================
-- ใบแจ้งซ่อมคอมพิวเตอร์ (ฟอร์มกระดาษ IT01-… เลขที่ IT01-YY/NNN) — โมดูลของระบบสำนักงาน › IT SUPPORT · ส่วนฐานข้อมูล (ยังไม่มีหน้าเว็บ)
--
-- ที่มา: สเปกที่เจ้าของตัดสิน 21/11/2026 (Work-Order/docs/itrp-spec.md) · เป็นโมดูลแยกของตัวเอง prefix itrp_
--   คัดลอกโครงจากใบสั่งงาน IT (itwo_*) รุ่นล่าสุดบน main (20261203 + v2 20261205 + v3 20261206 + v4 20261208 + แจ้งเตือน 20261209) มาเป็นสถานะสุดท้ายไฟล์เดียว
--   โดย "ไม่แก้" ตาราง/ฟังก์ชัน/trigger ของ itwo และของเพื่อน (ดูหัวข้อ "สิ่งที่แตะ" ด้านล่าง)
--
-- ต่างจากใบสั่งงาน IT (itwo)
--   - ฟิลด์ใบ: รหัสเครื่อง (asset_code, ไม่บังคับ), ชื่อเครื่อง/อุปกรณ์ (device_name), ประเภทคำขอ (request_kind: repair/replace_part/inspect/install/other),
--     ประเภทงานซ่อม (repair_target: computer/device/other), อาการเสีย (symptom), งานด่วน · "other" ต้องระบุข้อความ (CHECK ที่ตาราง + RPC)
--     ไม่มีวันที่ต้องการงาน / ออเดอร์ / ตัวเลือกเอกสารแนบ (แนบไฟล์ได้เสมอตามกติกา 30 นาทีแรกเหมือน itwo) / ส่วนสิทธิ์ในระบบ (ไม่มีตาราง access_changes)
--   - ส่วน "สำหรับแผนก IT" กรอกตอนกด "ส่งงาน" (app_itrp_complete): สาเหตุ, สรุปสาเหตุ, การตรวจซ่อม, การซ่อม-แก้ไข, เลขที่ PR/PO, ตารางอะไหล่ ≤10 แถว
--     เก็บเป็น "บันทึกการซ่อม" itrp_repair_reports + itrp_repair_parts ผูกกับ event completed แต่ละครั้ง · เพิ่มได้อย่างเดียว
--     (ผู้แจ้งขอแก้ไขแล้ว IT ส่งงานใหม่ = บันทึกชุดใหม่ ชุดเก่าคงอยู่ · หน้าแสดง/ใบพิมพ์ใช้ชุดล่าสุด)
--   - ไม่มี itrp_staff: ผู้ดูแลงาน IT (it_admin) และผู้อนุมัติขั้น IT ใช้ชุดเดียวกับใบสั่งงาน โดย "อ่านอย่างเดียว" จาก public.itwo_staff
--     (ผ่าน private.itrp_is_it_admin / itrp_is_it_approver / itrp_is_staff / itrp_has_active_it_approver / itrp_notify_it_*_ids) แก้สิทธิ์ที่ใบสั่งงาน IT (app_itwo_set_staff) ที่เดียว
--     ข้อควรระวัง: ถ้าภายหลังเปลี่ยนโครงสร้าง/ลบ itwo_staff ต้องแก้ฟังก์ชันอ่านสิทธิ์ของ itrp ด้วย (มี DB test เฝ้าไว้)
--   - เลขที่เอกสาร IT01-YY/NNN (itwo ใช้ IT06-) ตัวนับของตัวเอง itrp_doc_counters แยกของจริง/ทดสอบ (ทดสอบขึ้นต้น TEST-)
--   - action_url ของแจ้งเตือน /office/repair/<uuid> · ข้อความใช้คำว่า "ใบแจ้งซ่อม"
--   - ใบสั่งงานมีรุ่น 1.02 ที่ให้หัวหน้า IT (FANG) เป็นผู้อนุมัติ + ดูทุกใบเท่านั้น ไม่ใช่ผู้ดูแลงาน: itrp ถือตาม itwo_staff เดียวกัน (is_it_admin = ผู้ดูแลงาน, is_it_approver = ผู้อนุมัติขั้น IT)
--
-- กติกาที่เหมือน itwo (ตัดสินที่ฐานข้อมูล)
--   - ผู้อนุมัติขั้นแผนก = พนักงานที่ผูกบัญชีแล้ว role_id เป็น department_manager/assistant_department_manager ของแผนกผู้แจ้ง (ไม่ใช้ acting_role_id, ไม่นับ factory_manager/general_manager)
--   - แผนกไม่มีผู้จัดการ/ผู้ช่วย -> ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น · ผู้แจ้งอยู่แผนก IT -> กดครั้งเดียว · ผู้แจ้งเป็นผู้จัดการแผนกเอง -> ข้ามขั้นแผนก (บันทึก dept_approved ในชื่อผู้แจ้ง)
--     ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง -> อนุมัติครบตอนแจ้ง · ไม่อนุมัติ = จบทันที (ต้องมีเหตุผล) · ใบที่ยกเลิก/ไม่อนุมัติ/จบแล้วเปิดใหม่ไม่ได้
--   - งานด่วน: IT เริ่มได้ก่อนอนุมัติครบ ต้องอนุมัติตามหลัง ส่งงานได้เมื่ออนุมัติครบ · แจ้ง it_admin ทันที (ป้าย 🚨 [ด่วน])
--   - ถามผู้แจ้ง (ผู้อนุมัติแต่ละขั้น / IT) -> สถานะ need_info -> ตอบแล้วกลับสถานะเดิม · ระหว่างรอ ห้ามอนุมัติ/ไม่อนุมัติ · IT ยกเลิกแทนได้เมื่อค้าง need_info (เหตุผลบังคับ)
--   - ผู้แจ้งยืนยันรับงาน = จบ · ตรวจแล้วไม่ผ่าน = ขอแก้ไข (รายละเอียด + ไฟล์ + วันที่กำหนดเสร็จ) กลับ IT ทันที ไม่จำกัดรอบ · ใบที่ IT เคยส่งงานแล้วยกเลิกไม่ได้
--   - "อนุมัติขั้นไหนแล้ว" ตัดสินจาก itrp_events (แหล่งความจริง) ไม่ใช่จาก status อย่างเดียว
--
-- ISO: itrp_events / itrp_admin_log / itrp_reworks / itrp_comments / itrp_attachments / itrp_repair_reports / itrp_repair_parts เพิ่มได้อย่างเดียว (trigger กัน UPDATE/DELETE/TRUNCATE)
--   ใบ (itrp_requests) ลบไม่ได้ เปลี่ยนได้แค่ status (+ info_return_status คู่กับ need_info) ตามตารางการเปลี่ยนสถานะที่ trigger บังคับ · ไม่มีสิทธิ์เขียนตรงให้ใคร (RLS deny-all + revoke)
--   การลบมีทางเดียวคือ app_sandbox_purge_itrp (เฉพาะแถว is_test) · เลขที่เอกสารออกฝั่งฐานข้อมูลแบบ lock แถวตัวนับ
--   id ของ itrp_events / itrp_admin_log / itrp_comments เป็น identity ร่วมจริง+ทดสอบ: หลังล้างข้อมูลทดสอบ id ของข้อมูลจริงอาจ "เว้นช่อง" ไม่ใช่การลบ (ใช้ created_at + เลขที่เอกสารอ้างอิงลำดับ)
--
-- โหมดทดสอบ (Admin Sandbox ของ MNP_SYSTEM): ทุกตารางมี is_test + trigger private.sandbox_row_scope · เลขเอกสารทดสอบใช้ตัวนับแยก TEST-IT01-YY/NNN
--   ใช้ persona ของ itwo เดิม (SBX-IT-STAFF / SBX-IT-ADMIN / SBX-IT-APPROVER) จึงไม่เพิ่มแถว employees ใหม่
--   bucket ไฟล์: itrp-files (จริง) / itrp-test-files (ทดสอบ) private 20 MB ชนิดเดียวกับ itwo
--
-- สิ่งที่แตะ (นอกจากของใหม่ itrp_* ทั้งหมด)
--   1) replace private.sandbox_unguarded_tables() — คัดจากนิยามบน main/prod ทุกชื่อ (md5(pg_get_functiondef) บน prod ตอนเขียน = 6af9a5b2ee1c4ab951107a8aeb67a1cf,
--      ตรงกับ 20261206010000_itwo_v3_request_info.sql) แล้วเพิ่ม 9 ตาราง itrp_* · ก่อน apply ต้องเทียบ md5 ซ้ำ (ถ้าเพื่อน replace ไปแล้วให้ใช้ฉบับล่าสุดเป็นฐาน)
--   2) storage.buckets เพิ่ม itrp-files / itrp-test-files + storage.objects policy ชื่อ itrp_* (ไม่แตะ policy ของบัคเก็ตอื่น)
--   3) อ่านอย่างเดียว: public.itwo_staff, public.employees, public.departments, public.roles, public.notifications (ผ่าน private.office_notify เดิม ไม่ replace),
--      private.sandbox_* / lab_only_* / office_clip / office_format_date, public.audit_logs (insert จาก purge เหมือน itwo)
--   ไม่แตะ: ตาราง/ฟังก์ชัน/trigger ของ itwo, requests/approval_steps/app_create_request, private.office_notify
--
-- ลำดับ deploy: ตารางและ RPC ใหม่ล้วน ไม่กระทบโมดูลอื่น ยังไม่มีหน้าเว็บเรียก · apply ก่อนหรือหลัง merge ได้ (ตาม AGENTS.md ถ้ามีหน้าเว็บเรียก ต้อง apply ก่อน merge)
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod, md5 ของ sandbox_unguarded_tables, และ itwo_staff ยังมี it_admin + ผู้อนุมัติขั้น IT
--   หลัง apply ตรวจ: relrowsecurity ของตาราง itrp_*, ไม่มี grant ตรงให้ anon/authenticated/service_role, RPC anon เรียกไม่ได้, bucket private
--
-- Rollback (ตารางใหม่ ยังไม่มีข้อมูลจริง): drop policy itrp_* บน storage.objects · ลบ bucket itrp-files/itrp-test-files (ว่างเปล่า ผ่าน Storage API)
--   drop trigger itrp_events_notify · drop function public.app_itrp_*, public.app_sandbox_purge_itrp, private.itrp_* ·
--   drop table itrp_repair_parts, itrp_repair_reports, itrp_attachments, itrp_comments, itrp_reworks, itrp_admin_log, itrp_events, itrp_doc_counters, itrp_requests (ลูกก่อนแม่) ·
--   create or replace private.sandbox_unguarded_tables() กลับเป็นนิยามเดิม (ตัดชื่อ itrp_* ออก)
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if not exists (select 1 from public.departments where code = 'IT') then
    raise exception 'ไม่พบแผนก IT (departments.code = ''IT'') ซึ่งโมดูลใบแจ้งซ่อมใช้กำหนดเส้นทางอนุมัติ';
  end if;
  if not exists (select 1 from public.roles where code = 'department_manager')
     or not exists (select 1 from public.roles where code = 'assistant_department_manager') then
    raise exception 'ไม่พบบทบาท department_manager / assistant_department_manager';
  end if;
  if to_regclass('public.itwo_staff') is null then
    raise exception 'ไม่พบตาราง itwo_staff (โมดูลใบแจ้งซ่อมอ่านสิทธิ์ทีม IT จากตารางนี้) กรุณา apply migration ใบสั่งงาน IT ก่อน';
  end if;
  if to_regprocedure('private.office_notify(uuid, text, text, text, uuid)') is null then
    raise exception 'ไม่พบ private.office_notify (migration แจ้งเตือนของระบบสำนักงาน) กรุณา apply ก่อน';
  end if;
end;
$$;

-- 1. ตาราง -----------------------------------------------------------------------
-- ตัวนับเลขที่เอกสารรายปี แยกชุดของจริง/ทดสอบ (ใช้ผ่านฟังก์ชันเท่านั้น)
create table public.itrp_doc_counters (
  is_test boolean not null default false,
  doc_year integer not null check (doc_year between 2000 and 2999),
  last_seq integer not null default 0 check (last_seq between 0 and 99999),
  updated_at timestamptz not null default now(),
  primary key (is_test, doc_year)
);

create table public.itrp_requests (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  doc_no text not null unique,
  doc_year integer not null,
  doc_seq integer not null check (doc_seq >= 1),
  requester_id uuid not null references public.employees(id),
  department_id uuid not null references public.departments(id),
  asset_code text check (asset_code is null or (btrim(asset_code) <> '' and char_length(asset_code) <= 50)),
  device_name text not null check (btrim(device_name) <> '' and char_length(device_name) <= 200),
  request_kind text not null check (request_kind in ('repair', 'replace_part', 'inspect', 'install', 'other')),
  request_kind_note text check (request_kind_note is null or (btrim(request_kind_note) <> '' and char_length(request_kind_note) <= 200)),
  repair_target text not null check (repair_target in ('computer', 'device', 'other')),
  repair_target_note text check (repair_target_note is null or (btrim(repair_target_note) <> '' and char_length(repair_target_note) <= 200)),
  symptom text not null check (btrim(symptom) <> '' and char_length(symptom) <= 2000),
  is_urgent boolean not null default false,
  status text not null default 'pending_dept'
    check (status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'it_closed', 'received', 'rejected', 'cancelled', 'need_info')),
  -- สถานะที่ใบจะกลับไปหลังผู้แจ้งตอบคำถาม (ใช้คู่กับ status = need_info เท่านั้น)
  info_return_status text,
  created_at timestamptz not null default now(),
  unique (is_test, doc_year, doc_seq),
  unique (id, is_test),
  -- "อื่นๆ" ต้องระบุข้อความ และประเภทอื่นต้องไม่มีข้อความตกค้าง
  constraint itrp_requests_kind_note_ck check ((request_kind = 'other') = (request_kind_note is not null)),
  constraint itrp_requests_target_note_ck check ((repair_target = 'other') = (repair_target_note is not null)),
  constraint itrp_requests_info_return_status_check check (
    (status = 'need_info' and info_return_status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress'))
    or (status <> 'need_info' and info_return_status is null))
);
create index itrp_requests_requester_idx on public.itrp_requests (requester_id);
create index itrp_requests_department_idx on public.itrp_requests (department_id);
create index itrp_requests_status_idx on public.itrp_requests (is_test, status);
comment on table public.itrp_requests is
  'ใบแจ้งซ่อมคอมพิวเตอร์ (เลขที่ IT01-YY/NNN) · ลบไม่ได้ เปลี่ยนได้แค่คอลัมน์ status (+ info_return_status) ตามตารางการเปลี่ยนสถานะของ trigger · เขียนผ่าน app_itrp_* เท่านั้น';

-- ประวัติสำหรับ ISO (ลายเซ็นอิเล็กทรอนิกส์): เพิ่มได้อย่างเดียว id (identity) เรียงตามลำดับเหตุการณ์จริง
create table public.itrp_events (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  request_id uuid not null,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in (
    'created', 'dept_approved', 'dept_rejected', 'it_mgr_approved', 'it_mgr_rejected',
    'cancelled', 'started', 'completed', 'received', 'rework_requested', 'info_requested', 'info_provided')),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  -- ให้บันทึกการซ่อมอ้าง event completed ของใบเดียวกันได้
  unique (id, request_id)
);
create index itrp_events_req_idx on public.itrp_events (request_id, is_test, id);
create index itrp_events_actor_idx on public.itrp_events (actor_id);
comment on table public.itrp_events is
  'ประวัติการดำเนินการของใบแจ้งซ่อมสำหรับ ISO · เพิ่มได้อย่างเดียว ห้ามแก้/ลบ (trigger) · ถือเป็นลายเซ็นอิเล็กทรอนิกส์';

-- ประวัติการตั้งเลขเอกสารถัดไป (เพิ่มได้อย่างเดียว)
create table public.itrp_admin_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  actor_id uuid not null references public.employees(id),
  action text not null check (action in ('doc_seq_set')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index itrp_admin_log_actor_idx on public.itrp_admin_log (actor_id);
comment on table public.itrp_admin_log is 'ประวัติการตั้งเลขที่เอกสารถัดไปของใบแจ้งซ่อม · เพิ่มได้อย่างเดียว (trigger)';

-- รอบขอแก้ไขงาน (เพิ่มได้อย่างเดียว) round_no 1,2,3… ต่อใบ ไม่จำกัดจำนวนรอบ
create table public.itrp_reworks (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  round_no integer not null check (round_no >= 1),
  details text not null check (btrim(details) <> '' and char_length(details) <= 2000),
  due_date date not null,
  requested_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  unique (request_id, round_no),
  -- ให้ไฟล์แนบอ้างรอบแก้ไขพร้อมใบเดียวกันได้ (กันแนบรอบของใบอื่น)
  unique (id, request_id)
);
create index itrp_reworks_requested_by_idx on public.itrp_reworks (requested_by);
comment on table public.itrp_reworks is
  'รอบขอแก้ไขงานของใบแจ้งซ่อม · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_request_rework เท่านั้น';

-- คำถาม/คำตอบ "ถามกลับผู้แจ้ง" (เพิ่มได้อย่างเดียว) id (identity) = ลำดับจริง
create table public.itrp_comments (
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
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  unique (id, request_id),
  foreign key (reply_to, request_id) references public.itrp_comments (id, request_id),
  constraint itrp_comments_reply_kind check ((kind = 'question') = (reply_to is null))
);
-- คำถามหนึ่งข้อตอบได้ครั้งเดียว
create unique index itrp_comments_one_answer_idx on public.itrp_comments (reply_to) where reply_to is not null;
create index itrp_comments_req_idx on public.itrp_comments (request_id, is_test, id);
create index itrp_comments_author_idx on public.itrp_comments (author_id);
comment on table public.itrp_comments is
  'คำถาม/คำตอบ "ถามกลับผู้แจ้ง" ของใบแจ้งซ่อม · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_request_info / app_itrp_provide_info เท่านั้น';

-- ทะเบียนไฟล์แนบ (เพิ่มได้อย่างเดียว) rework_id และ comment_id ว่างทั้งคู่ = แนบตอนแจ้ง · ตัวไฟล์อยู่ใน Storage (บัคเก็ตตามโหมดของใบ)
create table public.itrp_attachments (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  rework_id uuid,
  comment_id bigint,
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  -- MATCH SIMPLE: rework_id / comment_id ว่าง = ไม่ตรวจ · ไม่ว่าง = ต้องเป็นของใบเดียวกัน
  foreign key (rework_id, request_id) references public.itrp_reworks (id, request_id),
  constraint itrp_attachments_comment_fk foreign key (comment_id, request_id) references public.itrp_comments (id, request_id),
  -- ผูกได้อย่างใดอย่างหนึ่ง (รอบแก้ไข หรือ ข้อความ) ไม่ใช่ทั้งสอง
  constraint itrp_attachments_one_owner check (rework_id is null or comment_id is null),
  -- ไฟล์ต้องอยู่ใต้โฟลเดอร์ของใบแจ้งซ่อมตัวเองเสมอ
  constraint itrp_attachments_path_in_request_folder check (starts_with(storage_path, request_id::text || '/'))
);
create index itrp_attachments_req_idx on public.itrp_attachments (request_id, is_test, created_at);
create index itrp_attachments_rework_idx on public.itrp_attachments (rework_id) where rework_id is not null;
create index itrp_attachments_comment_idx on public.itrp_attachments (comment_id) where comment_id is not null;
create index itrp_attachments_uploaded_by_idx on public.itrp_attachments (uploaded_by);
comment on table public.itrp_attachments is
  'ทะเบียนไฟล์แนบของใบแจ้งซ่อม · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_add_attachment / app_itrp_add_comment_attachment เท่านั้น';

-- บันทึกการซ่อม ("สำหรับแผนก IT") 1 ชุดต่อการส่งงาน 1 ครั้ง ผูกกับ event completed (เพิ่มได้อย่างเดียว · ขอแก้ไขแล้วส่งงานใหม่ = ชุดใหม่ ชุดเก่าคงอยู่)
create table public.itrp_repair_reports (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  completed_event_id bigint not null unique,
  cause text not null check (btrim(cause) <> '' and char_length(cause) <= 2000),
  -- สรุปสาเหตุเกิดจาก: usage การใช้งาน · part_expired อะไหล่หมดอายุ · other อื่นๆ (ต้องระบุ)
  cause_kind text not null check (cause_kind in ('usage', 'part_expired', 'other')),
  cause_kind_note text check (cause_kind_note is null or (btrim(cause_kind_note) <> '' and char_length(cause_kind_note) <= 200)),
  -- การตรวจซ่อม: internal ซ่อมภายใน · external_onsite เรียกผู้ซ่อมจากภายนอก (ระบุชื่อได้ ไม่บังคับ) · sent_out ส่งซ่อมที่ (ต้องระบุสถานที่)
  repair_method text not null check (repair_method in ('internal', 'external_onsite', 'sent_out')),
  repair_vendor text check (repair_vendor is null or (btrim(repair_vendor) <> '' and char_length(repair_vendor) <= 200)),
  repair_action text not null check (btrim(repair_action) <> '' and char_length(repair_action) <= 2000),
  pr_po_no text check (pr_po_no is null or (btrim(pr_po_no) <> '' and char_length(pr_po_no) <= 100)),
  -- ช่างผู้ดำเนินการซ่อม = ผู้กดส่งงาน
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  foreign key (completed_event_id, request_id) references public.itrp_events (id, request_id),
  unique (id, is_test),
  constraint itrp_repair_reports_cause_note_ck check ((cause_kind = 'other') = (cause_kind_note is not null)),
  constraint itrp_repair_reports_vendor_ck check (
    (repair_method = 'sent_out' and repair_vendor is not null)
    or (repair_method = 'external_onsite')
    or (repair_method = 'internal' and repair_vendor is null))
);
create index itrp_repair_reports_req_idx on public.itrp_repair_reports (request_id, is_test, completed_event_id);
create index itrp_repair_reports_created_by_idx on public.itrp_repair_reports (created_by);
comment on table public.itrp_repair_reports is
  'บันทึกการซ่อมของใบแจ้งซ่อม (ส่วนสำหรับแผนก IT) ต่อการส่งงานแต่ละครั้ง · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_complete เท่านั้น';

-- รายการอะไหล่/วัสดุที่ใช้ของบันทึกการซ่อม ≤10 แถว (เพิ่มได้อย่างเดียว)
create table public.itrp_repair_parts (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  report_id uuid not null,
  line_no smallint not null check (line_no between 1 and 10),
  item_name text not null check (btrim(item_name) <> '' and char_length(item_name) <= 200),
  quantity numeric(12, 2) not null check (quantity > 0),
  price numeric(12, 2) check (price is null or price >= 0),
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 200)),
  created_at timestamptz not null default now(),
  foreign key (report_id, is_test) references public.itrp_repair_reports (id, is_test),
  unique (report_id, line_no)
);
comment on table public.itrp_repair_parts is
  'รายการอะไหล่/วัสดุของบันทึกการซ่อม · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_complete เท่านั้น';

-- 2. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itrp_doc_counters', 'itrp_requests', 'itrp_events', 'itrp_admin_log', 'itrp_reworks', 'itrp_comments',
    'itrp_attachments', 'itrp_repair_reports', 'itrp_repair_parts'
  ] loop
    -- ถอน service_role ด้วย: Supabase ให้สิทธิ์ตารางใหม่แก่ service_role อัตโนมัติ (default privileges) ซึ่งเลี่ยง RLS ได้
    -- ตารางบันทึก ISO จึงไม่ควรเปิดให้ secret key เขียนตรงโดยไม่ผ่าน RPC (RPC เป็น SECURITY DEFINER เจ้าของ postgres ไม่กระทบ)
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
-- ลบได้เฉพาะแถวทดสอบ ภายใน app_sandbox_purge_itrp (ตั้ง itrp.purge = on แบบ transaction-local) แถวจริงลบไม่ได้เลย
create or replace function private.itrp_purge_allowed(p_is_test boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_is_test and coalesce(current_setting('itrp.purge', true), '') = 'on'
$$;

-- กันแก้/ลบประวัติ (events, admin_log, reworks, comments, attachments, repair_reports, repair_parts)
create or replace function private.itrp_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if private.itrp_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
end;
$$;

-- ใบแจ้งซ่อม: ลบไม่ได้ · แก้ได้เฉพาะ status (+ info_return_status คู่กับ need_info) ตามตารางการเปลี่ยนสถานะ (ปลายทางคือ rejected / cancelled / received เปิดใหม่ไม่ได้)
create or replace function private.itrp_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itrp_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ใบแจ้งซ่อมลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ใบแจ้งซ่อมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: ทุกคอลัมน์ยกเว้น status (และ info_return_status ที่เปลี่ยนคู่กับ status) ต้องไม่เปลี่ยน
  if (new.id, new.is_test, new.doc_no, new.doc_year, new.doc_seq, new.requester_id, new.department_id,
      new.asset_code, new.device_name, new.request_kind, new.request_kind_note, new.repair_target, new.repair_target_note,
      new.symptom, new.is_urgent, new.created_at)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.department_id,
      old.asset_code, old.device_name, old.request_kind, old.request_kind_note, old.repair_target, old.repair_target_note,
      old.symptom, old.is_urgent, old.created_at) then
    raise exception 'ใบแจ้งซ่อมแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled', 'need_info'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled', 'need_info'))
    -- it_closed -> in_progress = ผู้แจ้งขอแก้ไขงาน (ผ่าน app_itrp_request_rework เท่านั้น) · received / rejected / cancelled เปิดใหม่ไม่ได้
    or (old.status = 'it_closed' and new.status in ('received', 'in_progress'))
    -- need_info = รอผู้แจ้งตอบ: กลับสถานะเดิม (ตรวจต่อด้านล่าง) หรือจบด้วยยกเลิกเท่านั้น (ระหว่างรอคำตอบไม่อนุมัติไม่ได้)
    or (old.status = 'need_info' and new.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะใบแจ้งซ่อมจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- ถามกลับผู้แจ้ง: ต้องบันทึกสถานะที่จะกลับไปให้ตรงกับสถานะก่อนถาม · ตอนกลับต้องเป็นสถานะที่บันทึกไว้เท่านั้น (ยกเว้นยกเลิก)
  if new.status = 'need_info' and old.status <> 'need_info' and new.info_return_status is distinct from old.status then
    raise exception 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (%) ไว้เป็นสถานะที่จะกลับไป', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'need_info' and new.status <> 'need_info'
     and new.status <> 'cancelled' and new.status is distinct from old.info_return_status then
    raise exception 'ใบที่รอผู้แจ้งตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (%) เท่านั้น', old.info_return_status using errcode = 'check_violation';
  end if;
  if new.status = old.status and new.info_return_status is distinct from old.info_return_status then
    raise exception 'แก้สถานะที่ใบจะกลับไปไม่ได้' using errcode = 'check_violation';
  end if;

  -- การรับงานเป็นขั้นสุดท้ายเสมอ: ใบที่ IT เคยส่งงานแล้ว (มี completed) ยกเลิกไม่ได้ (ต้องขอแก้ไขงานหรือรับงานเท่านั้น)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
       select 1 from public.itrp_events e where e.request_id = old.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itrp_request_guard() from public, anon, authenticated;

-- กติกาของข้อความที่ฐานข้อมูลบังคับเอง (ชั้นซ้อนของ RPC): คำถามเขียนโดยคนที่ไม่ใช่ผู้แจ้งและห้ามมีคำถามค้าง ·
-- คำตอบเขียนโดยผู้แจ้ง อ้างคำถามจริงของใบเดียวกัน และใช้ขั้นเดียวกับคำถาม
create or replace function private.itrp_comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_question public.itrp_comments%rowtype;
begin
  select w.requester_id into v_requester_id from public.itrp_requests w where w.id = new.request_id;
  if new.kind = 'question' then
    if new.author_id = v_requester_id then
      raise exception 'ผู้แจ้งถามกลับใบแจ้งซ่อมของตัวเองไม่ได้' using errcode = 'check_violation';
    end if;
    if exists (
         select 1 from public.itrp_comments q
         where q.request_id = new.request_id and q.kind = 'question'
           and not exists (select 1 from public.itrp_comments a where a.reply_to = q.id)) then
      raise exception 'ใบแจ้งซ่อมนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว' using errcode = 'check_violation';
    end if;
  else
    if new.author_id is distinct from v_requester_id then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้' using errcode = 'check_violation';
    end if;
    select * into v_question from public.itrp_comments q
    where q.id = new.reply_to and q.request_id = new.request_id and q.kind = 'question';
    if v_question.id is null then
      raise exception 'คำตอบต้องอ้างถึงคำถามของใบแจ้งซ่อมเดียวกัน' using errcode = 'check_violation';
    end if;
    if new.stage <> v_question.stage then
      raise exception 'คำตอบต้องใช้ขั้นเดียวกับคำถามที่ตอบ' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

-- บันทึกการซ่อมต้องผูกกับ event completed ของใบเดียวกัน ที่ผู้ส่งงานคนเดียวกันเป็นผู้กด (ชั้นซ้อนของ RPC)
create or replace function private.itrp_repair_report_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
       select 1 from public.itrp_events e
       where e.id = new.completed_event_id and e.request_id = new.request_id
         and e.action = 'completed' and e.actor_id = new.created_by) then
    raise exception 'บันทึกการซ่อมต้องผูกกับเหตุการณ์ส่งงานของใบเดียวกันและผู้ส่งงานคนเดียวกัน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itrp_repair_report_guard() from public, anon, authenticated;

-- 4. trigger: โหมดทดสอบ + เพิ่มได้อย่างเดียว + ด่านของแต่ละตาราง ------------------------------
-- (ใช้ private.sandbox_row_scope เดิมของ MNP_SYSTEM: INSERT กำหนด is_test จากโหมดผู้ทำรายการ ไม่รับจาก client, UPDATE/DELETE ตรวจโหมดตรงกัน)
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'itrp_doc_counters', 'itrp_requests', 'itrp_events', 'itrp_admin_log', 'itrp_reworks', 'itrp_comments',
    'itrp_attachments', 'itrp_repair_reports', 'itrp_repair_parts'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.sandbox_row_scope()',
                   v_table || '_sandbox_scope', v_table);
  end loop;
  -- เพิ่มได้อย่างเดียว: กัน UPDATE/DELETE (ยกเว้น purge แถวทดสอบ) และ TRUNCATE
  foreach v_table in array array[
    'itrp_events', 'itrp_admin_log', 'itrp_reworks', 'itrp_comments', 'itrp_attachments', 'itrp_repair_reports', 'itrp_repair_parts'
  ] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.itrp_append_only_guard()',
                   v_table || '_append_only', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.itrp_append_only_guard()',
                   v_table || '_no_truncate', v_table);
  end loop;
end $$;

create trigger itrp_requests_guard before update or delete on public.itrp_requests
  for each row execute function private.itrp_request_guard();
create trigger itrp_requests_no_truncate before truncate on public.itrp_requests
  for each statement execute function private.itrp_request_guard();
create trigger itrp_comments_insert_guard before insert on public.itrp_comments
  for each row execute function private.itrp_comments_guard();
create trigger itrp_repair_reports_insert_guard before insert on public.itrp_repair_reports
  for each row execute function private.itrp_repair_report_guard();

-- 5. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- คัดจากนิยามล่าสุดบน main/prod (20261206010000_itwo_v3_request_info.sql, md5 บน prod 6af9a5b2ee1c4ab951107a8aeb67a1cf) ครบทุกชื่อ
-- เพิ่มเฉพาะตาราง itrp_* 9 ตาราง (ต่อท้ายด้วย to_regclass แบบเดียวกับ itwo) · ไม่มีตารางใดของ itrp ที่ติด sandbox_guard (ทุกตารางรู้จักโหมดทดสอบ)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 6. เลขที่เอกสาร ------------------------------------------------------------------------
-- รูปแบบเลขที่: IT01-YY/NNN (เกิน 999 แสดงเต็มตัวเลข ไม่ตัดทิ้ง) · ทดสอบขึ้นต้น TEST-
create or replace function private.itrp_format_doc_no(p_is_test boolean, p_year integer, p_seq integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_is_test then 'TEST-' else '' end
    || 'IT01-' || lpad((p_year % 100)::text, 2, '0') || '/'
    || case when p_seq < 1000 then lpad(p_seq::text, 3, '0') else p_seq::text end
$$;

-- ออกเลขที่เอกสาร (ฝั่งฐานข้อมูลเท่านั้น): ON CONFLICT DO UPDATE ล็อกแถวตัวนับของปีนั้น คนกดพร้อมกันจึงได้เลขไม่ซ้ำ
-- ปีคิดตามเวลาไทย (Asia/Bangkok) ไม่ใช่ UTC · ใบทดสอบใช้ตัวนับแยก · p_now ไว้ให้เทสต์จำลองช่วงข้ามปี (การเรียกจริงใช้ now())
create or replace function private.itrp_next_doc_no(p_is_test boolean, p_now timestamp with time zone default now(), out year_ce integer, out seq_no integer, out doc_no text)
returns record
language plpgsql
security definer
set search_path = ''
as $$
begin
  year_ce := extract(year from (p_now at time zone 'Asia/Bangkok'))::integer;
  insert into public.itrp_doc_counters as c (is_test, doc_year, last_seq)
  values (p_is_test, year_ce, 1)
  on conflict (is_test, doc_year) do update set last_seq = c.last_seq + 1, updated_at = now()
  returning c.last_seq into seq_no;
  doc_no := private.itrp_format_doc_no(p_is_test, year_ce, seq_no);
end;
$$;

-- 7. ตัวช่วยภายใน (private) ----------------------------------------------------------
-- ผู้ทำรายการของโมดูล: persona (ถ้า admin อยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานจริงที่ใช้งานอยู่ของ session นี้
create or replace function private.itrp_actor()
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

-- เหมือน itrp_actor แต่ไม่ raise (คืนแถวว่าง) ให้ policy ของ Storage ใช้
create or replace function private.itrp_actor_quiet()
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

-- ผู้อนุมัติขั้นแผนกของแผนกหนึ่งในโหมดหนึ่ง
--   ของจริง: active + ผูกบัญชีล็อกอินแล้ว (auth_user_id ไม่ว่าง) + ไม่ถูกลบ + ไม่ใช่ persona + ไม่ใช่บัญชี lab-only
--     (แถวที่ล็อกอินไม่ได้ เช่น แถว pilot หรือบัญชีที่ยังไม่ผูก ไม่ควรถูกนับว่า "แผนกมีผู้จัดการ" เพราะจะไม่มีใครกดอนุมัติได้จริง ใบจะค้าง)
--   โหมดทดสอบ: persona ของแผนกนั้น (persona ล็อกอินไม่ได้ตามดีไซน์ จึงไม่ต้องมี auth_user_id)
-- ดู role_id เท่านั้น "ไม่ใช้ acting_role_id" และไม่นับ factory_manager / general_manager (แยกหน้าที่ ISO เหมือน itwo)
create or replace function private.itrp_dept_approvers(p_department_id uuid, p_is_test boolean)
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

-- ผู้ทำรายการเป็นผู้อนุมัติขั้นแผนกของแผนก p_department_id หรือไม่ (ใช้รายการเดียวกับ private.itrp_dept_approvers จึงตัดสินตรงกันทุกที่)
create or replace function private.itrp_is_dept_approver(p_employee_id uuid, p_department_id uuid, p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from private.itrp_dept_approvers(p_department_id, p_is_test) a(id) where a.id = p_employee_id)
$$;

-- สิทธิ์ทีม IT: "อ่านอย่างเดียว" จาก public.itwo_staff (ชุดเดียวกับใบสั่งงาน IT) · แก้สิทธิ์ที่ใบสั่งงาน IT เท่านั้น
create or replace function private.itrp_is_it_admin(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_admin)
$$;

create or replace function private.itrp_is_it_approver(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_approver)
$$;

create or replace function private.itrp_is_staff(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id)
$$;

-- มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ในโหมดนี้หรือไม่ (กันใบค้างเพราะไม่มีใครอนุมัติได้)
-- ของจริงนับเฉพาะคนที่ active + ผูกบัญชีล็อกอินแล้ว + ไม่ใช่บัญชี lab-only (เงื่อนไขเดียวกับผู้อนุมัติขั้นแผนก)
create or replace function private.itrp_has_active_it_approver(p_is_test boolean)
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

-- แผนก IT ของโมดูลนี้ = departments.code 'IT'
create or replace function private.itrp_is_it_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.departments d where d.id = p_department_id and d.code = 'IT')
$$;

-- ผู้ทำรายการเห็นใบนี้ได้ไหม: ผู้แจ้ง / ทีม IT ใน itwo_staff (ทุกคน รวมหัวหน้า IT) / ผู้อนุมัติขั้นแผนกของแผนกนั้น · ใบต้องอยู่โหมดเดียวกับผู้ทำรายการ
create or replace function private.itrp_can_view(p_req public.itrp_requests, p_actor public.employees)
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
      or private.itrp_is_staff(p_actor.id)
      or exists (select 1 from private.itrp_dept_approvers(p_req.department_id, p_req.is_test) a(id) where a.id = p_actor.id)
    )
$$;

-- สถานะการอนุมัติของใบ (จาก events)
create or replace function private.itrp_event_state(p_request_id uuid, out dept_done boolean, out it_done boolean, out rejected boolean)
returns record
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(bool_or(e.action = 'dept_approved'), false),
         coalesce(bool_or(e.action = 'it_mgr_approved'), false),
         coalesce(bool_or(e.action in ('dept_rejected', 'it_mgr_rejected')), false)
  from public.itrp_events e
  where e.request_id = p_request_id
$$;

-- สิทธิ์อนุมัติ/ไม่อนุมัติของผู้ทำรายการกับใบหนึ่ง (จุดตัดสินเดียว ใช้ทั้ง RPC อนุมัติ รายการรออนุมัติ และปุ่มในหน้ารายละเอียด)
--   can_dept = อนุมัติขั้นแผนกได้ · can_it = อนุมัติขั้น IT ได้ (ถ้า dept ยังไม่ผ่าน กดครั้งเดียวนับทั้งสองขั้น)
create or replace function private.itrp_approval_caps(p_request_id uuid, p_actor_id uuid, out can_dept boolean, out can_it boolean, out dept_done boolean, out it_done boolean, out rejected boolean, out dept_is_it boolean, out has_dept_approvers boolean, out actor_is_dept_role boolean)
returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itrp_requests%rowtype;
  v_actor public.employees%rowtype;
  v_is_it_approver boolean;
  v_open boolean;
begin
  can_dept := false;
  can_it := false;
  select * into v_req from public.itrp_requests w where w.id = p_request_id;
  select * into v_actor from public.employees e where e.id = p_actor_id;
  if v_req.id is null or v_actor.id is null or v_req.is_test <> v_actor.is_test then
    return;
  end if;

  select s.dept_done, s.it_done, s.rejected into dept_done, it_done, rejected
  from private.itrp_event_state(v_req.id) s;
  dept_is_it := private.itrp_is_it_department(v_req.department_id);
  -- ไม่นับผู้แจ้งเอง: ผู้แจ้งอนุมัติใบตัวเองไม่ได้ (ถ้าเป็นผู้จัดการแผนก ขั้นแผนกผ่านอัตโนมัติตอนแจ้งอยู่แล้ว)
  has_dept_approvers := exists (
    select 1 from private.itrp_dept_approvers(v_req.department_id, v_req.is_test) a(id) where a.id <> v_req.requester_id);
  actor_is_dept_role := exists (
    select 1 from private.itrp_dept_approvers(v_req.department_id, v_req.is_test) a(id) where a.id = p_actor_id);
  v_is_it_approver := private.itrp_is_it_approver(p_actor_id);

  -- in_progress อยู่ในรายการเพราะงานด่วนเริ่มทำก่อน แต่ผู้จัดการยังต้องอนุมัติตามหลัง
  -- need_info (รอผู้แจ้งตอบ) อยู่ในรายการเพื่อให้ผู้อนุมัติขั้นที่ยังค้างกด "ไม่อนุมัติ" ได้ · ส่วน "อนุมัติ" ถูกกันที่ private.itrp_decide ให้รอคำตอบก่อน
  v_open := v_req.requester_id <> p_actor_id
    and v_req.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$$;

-- คำถามที่ค้างอยู่ของใบ (ยังไม่มีคำตอบ) ไม่มี = แถวว่าง
create or replace function private.itrp_pending_question(p_request_id uuid)
returns public.itrp_comments
language sql
stable
security definer
set search_path = ''
as $$
  select q from public.itrp_comments q
  where q.request_id = p_request_id and q.kind = 'question'
    and not exists (select 1 from public.itrp_comments a where a.reply_to = q.id)
  order by q.id desc
  limit 1
$$;

-- ขั้นที่ผู้ทำรายการถามผู้แจ้งได้ตอนนี้ (null = ถามไม่ได้)
create or replace function private.itrp_info_stage(p_req public.itrp_requests, p_actor public.employees)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caps record;
begin
  if p_req.id is null or p_actor.id is null or p_req.is_test <> p_actor.is_test or p_req.requester_id = p_actor.id then
    return null;
  end if;
  if p_req.status in ('pending_dept', 'pending_it_mgr', 'in_progress') then
    select * into v_caps from private.itrp_approval_caps(p_req.id, p_actor.id);
    if v_caps.can_it then
      return 'it_mgr';
    elsif v_caps.can_dept then
      return 'dept';
    end if;
  end if;
  if p_req.status in ('approved', 'in_progress') and private.itrp_is_it_admin(p_actor.id) then
    return 'it';
  end if;
  return null;
end;
$$;

-- ตัวช่วยทั่วไป
create or replace function private.itrp_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '')
$$;

create or replace function private.itrp_status_message(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'cancelled' then 'ใบแจ้งซ่อมนี้ถูกยกเลิกแล้ว'
    when 'rejected' then 'ใบแจ้งซ่อมนี้ไม่อนุมัติไปแล้ว'
    when 'approved' then 'ใบแจ้งซ่อมนี้อนุมัติครบแล้ว'
    when 'in_progress' then 'ใบแจ้งซ่อมนี้เริ่มดำเนินการไปแล้ว'
    when 'it_closed' then 'ใบแจ้งซ่อมนี้ IT ส่งงานแล้ว'
    when 'received' then 'ใบแจ้งซ่อมนี้จบงานแล้ว (ได้รับงานแล้ว)'
    when 'need_info' then 'ใบแจ้งซ่อมนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้'
    else 'ใบแจ้งซ่อมนี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้'
  end
$$;

-- ประเภทคำขอเป็นข้อความไทย (ใช้ในแจ้งเตือน)
create or replace function private.itrp_request_kind_text(p_request_kind text, p_request_kind_note text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_request_kind
    when 'repair' then 'ซ่อม'
    when 'replace_part' then 'เปลี่ยนอะไหล่'
    when 'inspect' then 'ตรวจเช็ค'
    when 'install' then 'ติดตั้ง'
    when 'other' then concat_ws(' · ', 'อื่นๆ', nullif(private.office_clip(p_request_kind_note, 40), ''))
    else coalesce(p_request_kind, '')
  end
$$;

-- มีการอนุมัติจริง (ไม่ใช่อนุมัติในตัวของผู้แจ้งเอง) แล้วหรือยัง: ใช้ปิดหน้าต่างแนบไฟล์ตอนแจ้ง
create or replace function private.itrp_has_real_approval(p_request_id uuid, p_requester_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.itrp_events e
    where e.request_id = p_request_id
      and e.action in ('dept_approved', 'it_mgr_approved')
      and e.actor_id <> p_requester_id
  )
$$;

-- หน้าต่างเวลาแนบไฟล์หลังสร้างใบ/รอบแก้ไข/ข้อความ (ที่เดียว ใช้ทั้ง policy ของ Storage และ RPC) · stable ไม่ใช่ immutable เพื่อให้ pgTAP แทนค่าได้
create or replace function private.itrp_attach_window()
returns interval
language sql
stable
security definer
set search_path = ''
as $$ select interval '30 minutes' $$;

-- การกระทำที่ผู้ทำรายการทำได้กับใบนี้ตอนนี้ (ให้หน้ารายละเอียดแสดงปุ่ม · ตรรกะเดียวกับ RPC แต่ละตัว)
create or replace function private.itrp_allowed_actions(p_req public.itrp_requests, p_actor public.employees)
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
  v_pending boolean := p_req.status in ('pending_dept', 'pending_it_mgr');
begin
  if p_req.id is null or p_req.is_test <> p_actor.is_test then
    return v_actions;
  end if;
  v_is_admin := private.itrp_is_it_admin(p_actor.id);

  -- ยกเลิกได้ก่อน IT ส่งงานครั้งแรกเท่านั้น: ใบที่เคยมี completed (แม้อยู่ในรอบแก้ไข) ไม่ส่ง cancel (การรับงานเป็นขั้นสุดท้าย)
  -- ระหว่างรอผู้แจ้งตอบ (need_info) ยกเลิกได้ตามเดิม · รุ่น 1.02: ผู้ดูแลงาน IT (it_admin) ยกเลิก "แทนผู้แจ้ง" ได้เฉพาะใบ need_info
  -- (กันใบค้างถาวรเมื่อผู้แจ้งไม่ตอบ) · ผู้แจ้งที่เป็น it_admin เองใช้สิทธิ์ผู้แจ้งตามปกติ
  if ((p_req.requester_id = p_actor.id and p_req.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info'))
      or (v_is_admin and p_req.status = 'need_info'))
     and not exists (select 1 from public.itrp_events e where e.request_id = p_req.id and e.action = 'completed') then
    v_actions := array_append(v_actions, 'cancel');
  end if;

  -- ระหว่างรอผู้แจ้งตอบ (need_info) ผู้อนุมัติทั้งอนุมัติและไม่อนุมัติไม่ได้ ต้องรอคำตอบก่อน (รุ่น 1.02)
  select * into v_caps from private.itrp_approval_caps(p_req.id, p_actor.id);
  if (v_caps.can_dept or v_caps.can_it) and p_req.status <> 'need_info' then
    v_actions := v_actions || array['approve', 'reject'];
  end if;

  -- start / complete ต้องเป็นผู้ดูแลงาน IT (it_admin) เท่านั้น: ผู้อนุมัติขั้น IT ที่ไม่ใช่ it_admin ได้แค่อนุมัติ/ไม่อนุมัติ/ถาม/ดู
  if v_is_admin and (p_req.status = 'approved' or (p_req.is_urgent and v_pending)) then
    v_actions := array_append(v_actions, 'start');
  end if;

  if v_is_admin and p_req.status = 'in_progress' then
    -- ส่งงานได้เมื่ออนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนและงานที่ขอแก้ไขก็เช่นกัน)
    if (select s.dept_done and s.it_done from private.itrp_event_state(p_req.id) s) then
      v_actions := array_append(v_actions, 'complete');
    end if;
  end if;

  -- IT ส่งงานแล้ว: ผู้แจ้งเลือกได้ว่ารับงาน หรือขอแก้ไขงาน (ไม่จำกัดจำนวนรอบ)
  if p_req.requester_id = p_actor.id and p_req.status = 'it_closed' then
    v_actions := array_append(v_actions, 'receive');
    v_actions := array_append(v_actions, 'request_rework');
  end if;

  -- ถามกลับผู้แจ้ง (ผู้อนุมัติของขั้นที่ใบรออยู่ / ผู้ดูแลงาน IT หลังอนุมัติ) และผู้แจ้งตอบ
  if private.itrp_info_stage(p_req, p_actor) is not null then
    v_actions := array_append(v_actions, 'request_info');
  end if;
  if p_req.requester_id = p_actor.id and p_req.status = 'need_info' then
    v_actions := array_append(v_actions, 'provide_info');
  end if;
  return v_actions;
end;
$$;

-- 8. ไฟล์แนบ: ตัวช่วย + Storage -----------------------------------------------------------
-- ชนิดไฟล์ที่รับ (ที่เดียว ใช้ทั้งตั้งค่าบัคเก็ตและตรวจใน RPC)
create or replace function private.itrp_allowed_mime_types()
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
create or replace function private.itrp_ext_matches_mime(p_name text, p_mime text)
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
create or replace function private.itrp_file_path_order_id(p_name text)
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

-- ไฟล์ตอนแจ้งแนบได้เมื่อ: ใบยังไม่สิ้นสุด ภายในหน้าต่างเวลา และยังไม่มีผู้อื่นอนุมัติจริง
-- (ใบแจ้งซ่อมไม่มีตัวเลือก "เอกสารแนบ มี/ไม่มี" แนบไฟล์ได้เสมอ)
create or replace function private.itrp_initial_attach_open(p_req public.itrp_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_req.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info')
    and now() - p_req.created_at <= private.itrp_attach_window()
    and not private.itrp_has_real_approval(p_req.id, p_req.requester_id)
$$;

-- แนบตอนขอแก้ไขงาน: รอบล่าสุดของใบที่ผู้แจ้งเพิ่งสร้าง ภายในหน้าต่างเวลา
create or replace function private.itrp_rework_attach_open(p_req public.itrp_requests, p_rework_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_req.status in ('in_progress', 'it_closed', 'need_info')
    and exists (
      select 1 from public.itrp_reworks r
      where r.request_id = p_req.id
        and (p_rework_id is null or r.id = p_rework_id)
        and r.requested_by = p_req.requester_id
        and r.round_no = (select max(x.round_no) from public.itrp_reworks x where x.request_id = p_req.id)
        and now() - r.created_at <= private.itrp_attach_window()
    )
$$;

-- แนบไฟล์กับข้อความถาม/ตอบ: ผู้เขียนข้อความเอง ภายในหน้าต่างเวลา ใบยังไม่สิ้นสุด
create or replace function private.itrp_comment_attach_open(p_req public.itrp_requests, p_comment_id bigint, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_req.id is not null
    and p_actor.id is not null
    and p_req.status not in ('rejected', 'cancelled', 'received')
    and private.itrp_can_view(p_req, p_actor)
    and exists (
      select 1 from public.itrp_comments c
      where c.request_id = p_req.id
        and c.author_id = p_actor.id
        and (p_comment_id is null or c.id = p_comment_id)
        and now() - c.created_at <= private.itrp_attach_window()
    )
$$;

-- ตรวจไฟล์ใน Storage จริง (ชนิด/ขนาดใช้ค่าจาก Storage เท่านั้น ไม่เชื่อค่าที่ผู้เรียกส่งมา)
create or replace function private.itrp_read_stored_file(p_is_test boolean, p_path text, out mime_type text, out size_bytes bigint)
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
  where o.bucket_id = case when p_is_test then 'itrp-test-files' else 'itrp-files' end
    and o.name = p_path and o.owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  mime_type := nullif(v_object.metadata ->> 'mimetype', '');
  size_bytes := nullif(v_object.metadata ->> 'size', '')::bigint;
  if mime_type is null or size_bytes is null then
    raise exception 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if mime_type <> all (private.itrp_allowed_mime_types()) then
    raise exception 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)' using errcode = 'check_violation';
  end if;
  if not private.itrp_ext_matches_mime(p_path, mime_type) then
    raise exception 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if size_bytes <= 0 or size_bytes > 20971520 then
    raise exception 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB' using errcode = 'check_violation';
  end if;
end;
$$;

-- 8b. Storage: บัคเก็ต + policy ------------------------------------------------------------
-- on conflict do update: ถ้ามีคนสร้างไว้เองใน Dashboard ให้ตั้งค่ากลับเป็นตามที่กำหนดเสมอ (private เสมอ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('itrp-files', 'itrp-files', false, 20971520, private.itrp_allowed_mime_types()),
  ('itrp-test-files', 'itrp-test-files', false, 20971520, private.itrp_allowed_mime_types())
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ฟังก์ชันตัดสินของ policy (เรียกด้วยสิทธิ์ผู้ใช้จึงต้อง grant ให้ authenticated · ตัวฟังก์ชันเป็น SECURITY DEFINER คืนแค่ true/false ตามสิทธิ์ของผู้เรียกเอง)
-- อ่านได้: ผู้ที่ itrp_can_view ใบนั้น (ผู้แจ้ง / ทีม IT / ผู้อนุมัติแผนก) ใบต้องอยู่โหมดเดียวกับบัคเก็ต (ของจริง/ทดสอบ) และกับผู้เรียก
create or replace function private.itrp_storage_can_read(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itrp_requests%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itrp_file_path_order_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itrp_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_req from public.itrp_requests w where w.id = v_id;
  return v_req.id is not null and v_req.is_test = p_is_test and private.itrp_can_view(v_req, v_actor);
end;
$$;

-- อัปโหลดได้: ผู้แจ้งในหน้าต่างแนบตอนแจ้ง/รอบแก้ไข หรือผู้เขียนข้อความในหน้าต่างแนบของข้อความ · จำกัดจำนวนไฟล์ต่อใบ
create or replace function private.itrp_storage_can_upload(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_req public.itrp_requests%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itrp_file_path_order_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itrp_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_req from public.itrp_requests w where w.id = v_id;
  if v_req.id is null or v_req.is_test <> p_is_test or v_actor.is_test <> p_is_test then
    return false;
  end if;
  if not (
       (v_req.requester_id = v_actor.id
        and (private.itrp_initial_attach_open(v_req) or private.itrp_rework_attach_open(v_req, null)))
       or private.itrp_comment_attach_open(v_req, null, v_actor)
     ) then
    return false;
  end if;
  return (
    select count(*) from storage.objects o
    where o.bucket_id = case when p_is_test then 'itrp-test-files' else 'itrp-files' end
      and starts_with(o.name, v_id::text || '/')
  ) < 20 * (1
            + (select count(*) from public.itrp_reworks r where r.request_id = v_id)
            + (select count(*) from public.itrp_comments c where c.request_id = v_id));
end;
$$;

-- บัคเก็ตทดสอบ: ลบได้เฉพาะไฟล์ที่ไม่มีใครลงทะเบียน โดย admin ที่อยู่ในโหมดทดสอบ (ไว้ล้างหลัง purge)
create or replace function private.itrp_storage_test_file_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.sandbox_persona()).id is not null
    and not exists (select 1 from public.itrp_attachments a where a.storage_path = p_name)
$$;

create policy itrp_files_read on storage.objects for select to authenticated
using (bucket_id = 'itrp-files' and private.itrp_storage_can_read(name, false));
create policy itrp_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itrp-files' and owner_id = (select auth.uid())::text
  and private.itrp_storage_can_upload(name, false));
-- ไม่มี UPDATE (เขียนทับไม่ได้) และไม่มี DELETE ของบัคเก็ตจริง (ISO)
create policy itrp_test_files_read on storage.objects for select to authenticated
using (bucket_id = 'itrp-test-files'
  and (private.itrp_storage_can_read(name, true) or private.itrp_storage_test_file_removable(name)));
create policy itrp_test_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itrp-test-files' and owner_id = (select auth.uid())::text
  and private.itrp_storage_can_upload(name, true));
create policy itrp_test_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'itrp-test-files' and private.itrp_storage_test_file_removable(name));

-- 9. RPC: แจ้งซ่อม · อนุมัติ · ยกเลิก · เริ่ม · ส่งงาน · ยืนยันรับ ------------------------------------
-- ผู้ใช้เรียกผ่าน public.app_itrp_* เท่านั้น (SECURITY DEFINER + search_path ว่าง · anon เรียกไม่ได้) ทุกตัวเริ่มด้วยด่าน lab-only และหาผู้ทำรายการจาก private.itrp_actor()
-- ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ

-- ผู้ทำรายการ + บทบาทของตัวเองในโมดูลนี้ (ให้หน้าเว็บเลือกแท็บ/ปุ่ม)
create or replace function public.app_itrp_my_role()
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
  v_actor := private.itrp_actor();
  return jsonb_build_object(
    'employee_id', v_actor.id,
    'employee_no', v_actor.employee_no,
    'full_name', v_actor.first_name || ' ' || v_actor.last_name,
    'is_test', v_actor.is_test,
    'department', (select jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th)
                   from public.departments d where d.id = v_actor.department_id),
    'is_it_department', private.itrp_is_it_department(v_actor.department_id),
    'is_dept_approver', private.itrp_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test),
    'is_it_admin', private.itrp_is_it_admin(v_actor.id),
    'is_it_approver', private.itrp_is_it_approver(v_actor.id)
  );
end;
$$;

-- แจ้งซ่อม: ตรวจข้อมูลที่กรอก เลือกเส้นทางอนุมัติ ออกเลขที่เอกสาร และบันทึกประวัติในธุรกรรมเดียว
-- ตารางใบกับเลขที่ ออกเลขฝั่งฐานข้อมูลเท่านั้น (หน้าเว็บไม่ส่งเลขมา)
create or replace function public.app_itrp_create(
  p_asset_code text,
  p_device_name text,
  p_request_kind text,
  p_request_kind_note text,
  p_repair_target text,
  p_repair_target_note text,
  p_symptom text,
  p_is_urgent boolean default false
)
returns table(id uuid, doc_no text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_dept public.departments%rowtype;
  v_asset_code text := private.itrp_clean(p_asset_code);
  v_device_name text := private.itrp_clean(p_device_name);
  v_kind_note text := private.itrp_clean(p_request_kind_note);
  v_target_note text := private.itrp_clean(p_repair_target_note);
  v_symptom text := private.itrp_clean(p_symptom);
  v_is_urgent boolean := coalesce(p_is_urgent, false);
  v_is_it_approver boolean;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_request_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_dept from public.departments d where d.id = v_actor.department_id;
  if v_dept.id is null or not v_dept.is_active then
    raise exception 'แผนกของคุณยังไม่ได้ตั้งค่าหรือถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  -- ตรวจข้อมูลที่กรอก ตามลำดับช่องในฟอร์ม (ข้อความภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ)
  if v_asset_code is not null and char_length(v_asset_code) > 50 then
    raise exception 'รหัสเครื่องคอมพิวเตอร์ต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_device_name is null then
    raise exception 'กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์' using errcode = 'check_violation';
  end if;
  if char_length(v_device_name) > 200 then
    raise exception 'ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_request_kind is null or p_request_kind not in ('repair', 'replace_part', 'inspect', 'install', 'other') then
    raise exception 'กรุณาเลือกประเภทคำขอ' using errcode = 'check_violation';
  end if;
  if p_request_kind = 'other' then
    if v_kind_note is null then
      raise exception 'กรุณาระบุประเภทคำขอ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_kind_note) > 200 then
      raise exception 'ประเภทคำขอ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- ประเภทอื่นไม่เก็บข้อความระบุ ล้างทิ้งกันข้อมูลตกค้าง
    v_kind_note := null;
  end if;
  if p_repair_target is null or p_repair_target not in ('computer', 'device', 'other') then
    raise exception 'กรุณาเลือกประเภทงานซ่อม' using errcode = 'check_violation';
  end if;
  if p_repair_target = 'other' then
    if v_target_note is null then
      raise exception 'กรุณาระบุประเภทงานซ่อม (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_target_note) > 200 then
      raise exception 'ประเภทงานซ่อม (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    v_target_note := null;
  end if;
  if v_symptom is null then
    raise exception 'กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น' using errcode = 'check_violation';
  end if;
  if char_length(v_symptom) > 2000 then
    raise exception 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- เลือกเส้นทางอนุมัติ (กติกาเดียวกับ itwo)
  v_is_it_approver := private.itrp_is_it_approver(v_actor.id);
  v_dept_is_it := private.itrp_is_it_department(v_dept.id);
  v_actor_is_dept_role := private.itrp_is_dept_approver(v_actor.id, v_dept.id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itrp_dept_approvers(v_dept.id, v_actor.is_test) a(id) where a.id <> v_actor.id);

  if v_is_it_approver then
    -- ผู้อนุมัติขั้น IT แจ้งเอง: อนุมัติในตัวทั้งสองขั้น ถือว่าอนุมัติครบทันที
    v_status := 'approved';
  else
    -- ต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ ไม่เช่นนั้นใบจะค้างโดยไม่มีใครอนุมัติได้
    if not private.itrp_has_active_it_approver(v_actor.is_test) then
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
  from private.itrp_next_doc_no(v_actor.is_test) n;

  insert into public.itrp_requests as rq (
    is_test, doc_no, doc_year, doc_seq, requester_id, department_id,
    asset_code, device_name, request_kind, request_kind_note, repair_target, repair_target_note, symptom, is_urgent, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    v_asset_code, v_device_name, p_request_kind, v_kind_note, p_repair_target, v_target_note, v_symptom, v_is_urgent, v_status
  ) returning rq.id into v_request_id;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved / it_mgr_approved)
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_request_id, v_actor.id, 'created',
    case when not v_is_it_approver and not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_is_it_approver then
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งซ่อม');
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'it_mgr_approved', 'ผู้แจ้งเป็นผู้อนุมัติขั้น IT อนุมัติในตัวเมื่อแจ้งซ่อม');
  elsif v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งซ่อม');
  end if;

  id := v_request_id;
  doc_no := v_doc_no;
  return next;
end;
$$;

-- อนุมัติ / ไม่อนุมัติ (ตัดสินที่ private.itrp_decide ตัวเดียว)
create or replace function private.itrp_decide(p_request_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itrp_clean(p_reason);
  v_req public.itrp_requests%rowtype;
  v_caps record;
  v_dept_done boolean;
  v_it_done boolean;
  v_new_status text;
begin
  v_actor := private.itrp_actor();

  -- ไม่อนุมัติต้องมีเหตุผล (ตรวจก่อนแตะข้อมูลใบ)
  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' using errcode = 'check_violation';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id = v_actor.id then
    raise exception 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบแจ้งซ่อมที่ตัวเองเป็นผู้แจ้งได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info') then
    raise exception '%', private.itrp_status_message(v_req.status) using errcode = 'check_violation';
  end if;

  select * into v_caps from private.itrp_approval_caps(v_req.id, v_actor.id);
  if v_caps.rejected then
    raise exception 'ใบแจ้งซ่อมนี้ไม่อนุมัติไปแล้ว' using errcode = 'check_violation';
  end if;

  if not v_caps.can_dept and not v_caps.can_it then
    -- บอกเหตุผลให้ตรงที่สุด
    if private.itrp_is_it_approver(v_actor.id) then
      if v_caps.it_done then
        raise exception 'ใบแจ้งซ่อมนี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว' using errcode = 'check_violation';
      end if;
      raise exception 'ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
    elsif v_caps.actor_is_dept_role and not v_caps.dept_is_it then
      raise exception 'ใบแจ้งซ่อมนี้ผู้จัดการแผนกพิจารณาไปแล้ว' using errcode = 'check_violation';
    end if;
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้' using errcode = 'insufficient_privilege';
  end if;

  -- รอผู้แจ้งตอบคำถามอยู่: ทั้งอนุมัติและไม่อนุมัติไม่ได้จนกว่าจะมีคำตอบ (รุ่น 1.02 · รุ่น 3 ยังให้ไม่อนุมัติได้)
  -- ตรวจหลังตรวจสิทธิ์ เพื่อให้คนที่ไม่มีสิทธิ์ได้ข้อความสิทธิ์ตามเดิม
  if v_req.status = 'need_info' then
    if p_approve then
      raise exception 'ใบแจ้งซ่อมนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้' using errcode = 'check_violation';
    end if;
    raise exception 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน' using errcode = 'check_violation';
  end if;

  v_dept_done := v_caps.dept_done;
  v_it_done := v_caps.it_done;

  if p_approve then
    if v_caps.can_it then
      -- ผู้อนุมัติขั้น IT: ถ้าขั้นแผนกยังไม่ผ่านและไม่ต้องรอใคร กดครั้งเดียวบันทึกทั้งสองขั้นในชื่อเขา
      if not v_dept_done then
        insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
        values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved',
          case
            when v_caps.dept_is_it then 'ผู้แจ้งอยู่แผนก IT ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            when v_caps.actor_is_dept_role then 'ผู้อนุมัติเป็นผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้แจ้งและเป็นผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            else 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
          end);
        v_dept_done := true;
      end if;
      insert into public.itrp_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'it_mgr_approved');
      v_it_done := true;
    else
      insert into public.itrp_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved');
      v_dept_done := true;
    end if;
  else
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_req.is_test, v_req.id, v_actor.id,
            case when v_caps.can_it then 'it_mgr_rejected' else 'dept_rejected' end, v_reason);
  end if;

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที (รวมงานด่วนที่ IT เริ่มทำแล้ว) · อนุมัติ = เลื่อนเฉพาะใบที่ยังรออนุมัติ
  -- (ใบที่เดินหน้าไปแล้ว in_progress บันทึก event อย่างเดียว ไม่ดึงสถานะถอยกลับ)
  if not p_approve then
    v_new_status := 'rejected';
  elsif v_req.status in ('pending_dept', 'pending_it_mgr') then
    v_new_status := case
      when v_dept_done and v_it_done then 'approved'
      when v_dept_done then 'pending_it_mgr'
      else v_req.status
    end;
  else
    v_new_status := v_req.status;
  end if;
  if v_new_status is distinct from v_req.status then
    -- info_return_status ต้องเคลียร์คู่กับสถานะที่ออกจาก need_info (CHECK + guard บังคับ)
    update public.itrp_requests set status = v_new_status, info_return_status = null where id = v_req.id;
  end if;
end;
$$;

create or replace function public.app_itrp_approve(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itrp_decide(p_request_id, true, null);
end;
$$;

create or replace function public.app_itrp_reject(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.itrp_decide(p_request_id, false, p_reason);
end;
$$;

-- ยกเลิก: ผู้แจ้งก่อน IT เคยส่งงาน · IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่ค้าง "รอผู้แจ้งตอบ" (เหตุผลบังคับ ประวัติขึ้นต้น "IT ยกเลิกแทนผู้แจ้ง: ")
create or replace function public.app_itrp_cancel(p_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itrp_clean(p_reason);
  v_req public.itrp_requests%rowtype;
  -- IT ยกเลิกแทนผู้แจ้ง: ขึ้นต้นเหตุผลในประวัติด้วยข้อความนี้ ให้ไทม์ไลน์/ผู้ตรวจ ISO เห็นว่าไม่ใช่ผู้แจ้งยกเลิกเอง
  c_it_prefix constant text := 'IT ยกเลิกแทนผู้แจ้ง: ';
  v_on_behalf boolean := false;
  v_max_reason integer := 500;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    -- ไม่ใช่ผู้แจ้ง: เฉพาะผู้ดูแลงาน IT กับใบที่รอผู้แจ้งตอบเท่านั้น
    if not private.itrp_is_it_admin(v_actor.id) then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบแจ้งซ่อมได้' using errcode = 'insufficient_privilege';
    end if;
    -- ใบที่จบไปแล้ว (ไม่อนุมัติ/ยกเลิก/รับงานแล้ว) ปล่อยให้ตรวจสถานะด้านล่างตอบข้อความสถานะตามเดิม
    if v_req.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'it_closed') then
      raise exception 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ' using errcode = 'insufficient_privilege';
    end if;
    v_on_behalf := v_req.status = 'need_info';
    v_max_reason := 500 - char_length(c_it_prefix);
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
    raise exception '%', case v_req.status
      when 'it_closed' then 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน'
      when 'received' then 'ใบแจ้งซ่อมนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้'
      else private.itrp_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;
  -- ใบที่เคยมี completed (แม้อยู่ในรอบแก้ไข) ยกเลิกไม่ได้ ทั้งผู้แจ้งและ IT (การรับงานเป็นขั้นสุดท้าย) · ตรวจก่อนเหตุผล เพื่อให้ได้ข้อความนี้เสมอ
  if exists (select 1 from public.itrp_events e where e.request_id = v_req.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > v_max_reason then
    raise exception 'เหตุผลต้องไม่เกิน % ตัวอักษร', v_max_reason using errcode = 'check_violation';
  end if;

  -- info_return_status ต้องเคลียร์คู่กับการออกจาก need_info (CHECK + guard บังคับ)
  update public.itrp_requests set status = 'cancelled', info_return_status = null where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'cancelled',
          case when v_on_behalf then c_it_prefix || v_reason else v_reason end);
end;
$$;

-- IT เริ่มดำเนินการ (งานด่วนเริ่มได้ก่อนอนุมัติครบ)
create or replace function public.app_itrp_start(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบแจ้งซ่อมได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if not (v_req.status = 'approved' or (v_req.is_urgent and v_req.status in ('pending_dept', 'pending_it_mgr'))) then
    raise exception '%', case
      when v_req.status in ('pending_dept', 'pending_it_mgr')
        then 'ใบแจ้งซ่อมปกติต้องอนุมัติครบทั้งสองขั้นก่อนจึงจะเริ่มทำได้ (เฉพาะงานด่วนเริ่มก่อนอนุมัติครบได้)'
      else private.itrp_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;

  update public.itrp_requests set status = 'in_progress' where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action)
  values (v_req.is_test, v_req.id, v_actor.id, 'started');
end;
$$;

-- IT ส่งงาน: บันทึกส่วน "สำหรับแผนก IT" (บันทึกการซ่อม + รายการอะไหล่) พร้อมเปลี่ยนสถานะและ event completed ในธุรกรรมเดียว
--   ส่งงานได้เมื่อ in_progress และอนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนและงานที่ขอแก้ไขก็เช่นกัน) · เฉพาะผู้ดูแลงาน IT (it_admin ใน itwo_staff)
--   p_parts = jsonb array ≤10 แถว แต่ละแถว {"item_name": ข้อความ ≤200, "quantity": ตัวเลข >0 ทศนิยม ≤2 ตำแหน่ง, "price": ตัวเลข ≥0 ทศนิยม ≤2 ตำแหน่ง หรือ null, "note": ข้อความ ≤200 หรือ null}
--     แถวที่ว่างทุกช่องข้ามให้ · ลำดับแถว (line_no) นับตามลำดับที่ส่งมา
--   คืน id ของบันทึกการซ่อมที่สร้าง
create or replace function public.app_itrp_complete(
  p_request_id uuid,
  p_cause text,
  p_cause_kind text,
  p_cause_kind_note text,
  p_repair_method text,
  p_repair_vendor text,
  p_repair_action text,
  p_pr_po_no text,
  p_parts jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_dept_done boolean;
  v_it_done boolean;
  v_cause text := private.itrp_clean(p_cause);
  v_cause_note text := private.itrp_clean(p_cause_kind_note);
  v_vendor text := private.itrp_clean(p_repair_vendor);
  v_action text := private.itrp_clean(p_repair_action);
  v_pr_po text := private.itrp_clean(p_pr_po_no);
  v_parts jsonb := case when p_parts is null or jsonb_typeof(p_parts) = 'null' then '[]'::jsonb else p_parts end;
  c_decimal constant text := '^[0-9]{1,8}(\.[0-9]{1,2})?$';
  v_row jsonb;
  v_i integer;
  v_line integer := 0;
  v_item text;
  v_qty_text text;
  v_price_text text;
  v_note text;
  v_event_id bigint;
  v_report_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'in_progress' then
    raise exception '%', case
      when v_req.status in ('pending_dept', 'pending_it_mgr', 'approved')
        then 'ใบแจ้งซ่อมต้องอยู่ในสถานะกำลังดำเนินการ (กดเริ่มทำก่อน) จึงจะส่งงานได้'
      when v_req.status = 'it_closed' then 'IT ส่งงานใบนี้ไปแล้ว'
      else private.itrp_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;

  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(v_req.id) s;
  if not v_dept_done and not v_it_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน' using errcode = 'check_violation';
  elsif not v_dept_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
  elsif not v_it_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้อนุมัติขั้น IT อนุมัติก่อน' using errcode = 'check_violation';
  end if;

  -- ตรวจส่วน "สำหรับแผนก IT" ทั้งหมดก่อนแตะข้อมูล (ตารางก็มี CHECK ซ้ำอีกชั้น)
  if v_cause is null then
    raise exception 'กรุณาระบุสาเหตุ' using errcode = 'check_violation';
  end if;
  if char_length(v_cause) > 2000 then
    raise exception 'สาเหตุต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_cause_kind is null or p_cause_kind not in ('usage', 'part_expired', 'other') then
    raise exception 'กรุณาเลือกสรุปสาเหตุเกิดจาก' using errcode = 'check_violation';
  end if;
  if p_cause_kind = 'other' then
    if v_cause_note is null then
      raise exception 'กรุณาระบุสรุปสาเหตุ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_cause_note) > 200 then
      raise exception 'สรุปสาเหตุ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    v_cause_note := null;
  end if;
  if p_repair_method is null or p_repair_method not in ('internal', 'external_onsite', 'sent_out') then
    raise exception 'กรุณาเลือกการตรวจซ่อม' using errcode = 'check_violation';
  end if;
  if p_repair_method = 'sent_out' and v_vendor is null then
    raise exception 'กรุณาระบุสถานที่ที่ส่งซ่อม' using errcode = 'check_violation';
  end if;
  if v_vendor is not null and char_length(v_vendor) > 200 then
    raise exception 'ชื่อผู้ซ่อม/สถานที่ส่งซ่อมต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_repair_method = 'internal' then
    -- ซ่อมภายในไม่มีผู้ซ่อมภายนอก ล้างทิ้งกันข้อมูลตกค้าง
    v_vendor := null;
  end if;
  if v_action is null then
    raise exception 'กรุณาระบุการซ่อม-แก้ไขที่เกิดขึ้น' using errcode = 'check_violation';
  end if;
  if char_length(v_action) > 2000 then
    raise exception 'การซ่อม-แก้ไขที่เกิดขึ้นต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_pr_po is not null and char_length(v_pr_po) > 100 then
    raise exception 'เลขที่ PR./PO. ต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_parts) <> 'array' then
    raise exception 'รายการอะไหล่/วัสดุที่ใช้ต้องเป็นรายการ' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_parts) > 10 then
    raise exception 'รายการอะไหล่/วัสดุที่ใช้ต้องไม่เกิน 10 แถว' using errcode = 'check_violation';
  end if;
  -- ตรวจทุกแถวก่อนบันทึก (แถวที่ว่างทุกช่องข้าม · ตัวเลขรับเฉพาะเลขจำนวนเต็ม/ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ติดลบ ไม่เกิน 8 หลักก่อนจุด)
  for v_i in 0 .. jsonb_array_length(v_parts) - 1 loop
    v_row := v_parts -> v_i;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'แถวที่ % ของรายการอะไหล่/วัสดุไม่ถูกต้อง', v_i + 1 using errcode = 'check_violation';
    end if;
    v_item := private.itrp_clean(v_row ->> 'item_name');
    v_qty_text := private.itrp_clean(v_row ->> 'quantity');
    v_price_text := private.itrp_clean(v_row ->> 'price');
    v_note := private.itrp_clean(v_row ->> 'note');
    continue when v_item is null and v_qty_text is null and v_price_text is null and v_note is null;
    if v_item is null then
      raise exception 'แถวที่ %: กรุณาระบุรายการอะไหล่/วัสดุ', v_i + 1 using errcode = 'check_violation';
    end if;
    if char_length(v_item) > 200 then
      raise exception 'แถวที่ %: ชื่อรายการต้องไม่เกิน 200 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_qty_text is null then
      raise exception 'แถวที่ %: กรุณาระบุจำนวน', v_i + 1 using errcode = 'check_violation';
    end if;
    -- ตรวจรูปแบบก่อนแล้วค่อยแปลงเป็นตัวเลข (แยก if กัน cast ของข้อความผิดรูปแบบทำให้ error ที่ไม่ใช่ภาษาไทย)
    if v_qty_text !~ c_decimal then
      raise exception 'แถวที่ %: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_qty_text::numeric <= 0 then
      raise exception 'แถวที่ %: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_price_text is not null and v_price_text !~ c_decimal then
      raise exception 'แถวที่ %: ราคาต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_note is not null and char_length(v_note) > 200 then
      raise exception 'แถวที่ %: หมายเหตุต้องไม่เกิน 200 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
  end loop;

  update public.itrp_requests set status = 'it_closed' where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action)
  values (v_req.is_test, v_req.id, v_actor.id, 'completed')
  returning id into v_event_id;

  insert into public.itrp_repair_reports (
    is_test, request_id, completed_event_id, cause, cause_kind, cause_kind_note,
    repair_method, repair_vendor, repair_action, pr_po_no, created_by)
  values (
    v_req.is_test, v_req.id, v_event_id, v_cause, p_cause_kind, v_cause_note,
    p_repair_method, v_vendor, v_action, v_pr_po, v_actor.id)
  returning id into v_report_id;

  for v_i in 0 .. jsonb_array_length(v_parts) - 1 loop
    v_row := v_parts -> v_i;
    v_item := private.itrp_clean(v_row ->> 'item_name');
    v_qty_text := private.itrp_clean(v_row ->> 'quantity');
    v_price_text := private.itrp_clean(v_row ->> 'price');
    v_note := private.itrp_clean(v_row ->> 'note');
    continue when v_item is null and v_qty_text is null and v_price_text is null and v_note is null;
    v_line := v_line + 1;
    insert into public.itrp_repair_parts (is_test, report_id, line_no, item_name, quantity, price, note)
    values (v_req.is_test, v_report_id, v_line, v_item, v_qty_text::numeric, v_price_text::numeric, v_note);
  end loop;

  return v_report_id;
end;
$$;

-- ผู้แจ้งยืนยันรับงาน (จบ)
create or replace function public.app_itrp_receive(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'it_closed' then
    raise exception '%', case
      when v_req.status = 'received' then 'ใบแจ้งซ่อมนี้ยืนยันรับงานไปแล้ว'
      when v_req.status in ('cancelled', 'rejected') then private.itrp_status_message(v_req.status)
      else 'ยังยืนยันรับงานไม่ได้ เพราะ IT ยังไม่ส่งงาน'
    end using errcode = 'check_violation';
  end if;

  update public.itrp_requests set status = 'received' where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action)
  values (v_req.is_test, v_req.id, v_actor.id, 'received');
end;
$$;

-- ผู้แจ้งตรวจแล้วไม่ผ่าน: ขอแก้ไขงาน (รายละเอียด + วันที่กำหนดเสร็จ บังคับ) กลับสถานะ in_progress ทันทีไม่ต้องอนุมัติใหม่ ไม่จำกัดรอบ
create or replace function public.app_itrp_request_rework(p_request_id uuid, p_details text, p_due_date date)
returns table(id uuid, round_no integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_details text := private.itrp_clean(p_details);
  v_today_th date := (now() at time zone 'Asia/Bangkok')::date;
  v_round integer;
  v_rework_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'it_closed' then
    raise exception '%', case v_req.status
      when 'received' then 'ใบแจ้งซ่อมนี้จบงานแล้ว (ได้รับงานแล้ว) ขอแก้ไขไม่ได้'
      when 'cancelled' then private.itrp_status_message(v_req.status)
      when 'rejected' then private.itrp_status_message(v_req.status)
      else 'ขอแก้ไขงานได้เมื่อ IT ส่งงานแล้วเท่านั้น'
    end using errcode = 'check_violation';
  end if;

  if v_details is null then
    raise exception 'กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข' using errcode = 'check_violation';
  end if;
  if char_length(v_details) > 2000 then
    raise exception 'รายละเอียดที่ต้องการให้แก้ไขต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_due_date is null then
    raise exception 'กรุณาระบุวันที่ต้องการให้แก้ไขเสร็จ' using errcode = 'check_violation';
  end if;
  -- เทียบกับ "วันนี้ตามเวลาไทย" (วันนี้เลือกได้ แต่ย้อนหลังไม่ได้)
  if p_due_date < v_today_th then
    raise exception 'วันที่ต้องการให้แก้ไขเสร็จต้องไม่ใช่วันที่ผ่านมาแล้ว' using errcode = 'check_violation';
  end if;

  -- ใบถูกล็อก (for update) แล้ว เลขรอบจึงไม่ชนกันแม้กดพร้อมกัน
  select coalesce(max(r.round_no), 0) + 1 into v_round from public.itrp_reworks r where r.request_id = v_req.id;

  update public.itrp_requests w set status = 'in_progress' where w.id = v_req.id;
  insert into public.itrp_reworks (is_test, request_id, round_no, details, due_date, requested_by)
  values (v_req.is_test, v_req.id, v_round, v_details, p_due_date, v_actor.id)
  returning itrp_reworks.id into v_rework_id;
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'rework_requested',
          'ขอแก้ไขงานรอบที่ ' || v_round || ' ต้องการภายใน ' || to_char(p_due_date, 'DD/MM/YYYY') || ': ' || left(v_details, 300));

  id := v_rework_id;
  round_no := v_round;
  return next;
end;
$$;

-- 10. ถามผู้แจ้ง / ตอบ + ไฟล์แนบ ------------------------------------------------------------
create or replace function public.app_itrp_request_info(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itrp_clean(p_body);
  v_req public.itrp_requests%rowtype;
  v_stage text;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- คนที่ไม่เห็นใบนี้ได้ข้อความเดียวกับใบที่ไม่มีอยู่ (ไม่บอกสถานะของใบที่ตัวเองไม่มีสิทธิ์ดู)
  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id = v_actor.id then
    raise exception 'ผู้แจ้งถามกลับใบแจ้งซ่อมของตัวเองไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status = 'need_info' then
    raise exception 'ใบแจ้งซ่อมนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ' using errcode = 'check_violation';
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
    raise exception '%', private.itrp_status_message(v_req.status) using errcode = 'check_violation';
  end if;

  v_stage := private.itrp_info_stage(v_req, v_actor);
  if v_stage is null then
    raise exception 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบแจ้งซ่อมนี้ในขั้นตอนนี้' using errcode = 'insufficient_privilege';
  end if;

  insert into public.itrp_comments (is_test, request_id, kind, stage, author_id, body)
  values (v_req.is_test, v_req.id, 'question', v_stage, v_actor.id, v_body)
  returning id into v_comment_id;

  update public.itrp_requests set status = 'need_info', info_return_status = v_req.status where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'info_requested',
          'ถามผู้แจ้ง (' || case v_stage when 'dept' then 'ผู้จัดการแผนก' when 'it_mgr' then 'ผู้อนุมัติขั้น IT' else 'ทีม IT' end
          || '): ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

create or replace function public.app_itrp_provide_info(p_request_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itrp_clean(p_body);
  v_req public.itrp_requests%rowtype;
  v_question public.itrp_comments%rowtype;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์คำตอบ' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status <> 'need_info' then
    raise exception 'ใบแจ้งซ่อมนี้ไม่มีคำถามที่รอตอบ' using errcode = 'check_violation';
  end if;

  v_question := private.itrp_pending_question(v_req.id);
  if v_question.id is null then
    raise exception 'ไม่พบคำถามที่รอตอบของใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;

  insert into public.itrp_comments (is_test, request_id, kind, stage, author_id, body, reply_to)
  values (v_req.is_test, v_req.id, 'answer', v_question.stage, v_actor.id, v_body, v_question.id)
  returning id into v_comment_id;

  update public.itrp_requests set status = v_req.info_return_status, info_return_status = null where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (v_req.is_test, v_req.id, v_actor.id, 'info_provided', 'ผู้แจ้งตอบคำถาม: ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

-- ลงทะเบียนไฟล์ที่อัปโหลดแล้ว (ตอนแจ้ง หรือรอบขอแก้ไข) · ผู้แจ้งเท่านั้น
create or replace function public.app_itrp_add_attachment(p_request_id uuid, p_rework_id uuid, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_file_name text := private.itrp_clean(p_file_name);
  v_existing public.itrp_attachments%rowtype;
  v_object storage.objects%rowtype;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบแจ้งซ่อมได้' using errcode = 'insufficient_privilege';
  end if;

  -- path ต้องอยู่ใต้โฟลเดอร์ของใบนี้ และรูปแบบถูกต้อง
  if p_storage_path is null or private.itrp_file_path_order_id(p_storage_path) is distinct from v_req.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของใบ/รอบเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม (ไฟล์ของข้อความถาม/ตอบใช้ RPC ของข้อความ ไม่ใช่ตัวนี้)
  select * into v_existing from public.itrp_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.request_id = v_req.id and v_existing.comment_id is null
       and v_existing.rework_id is not distinct from p_rework_id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if p_rework_id is null then
    -- (1) แนบตอนแจ้ง
    if v_req.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
      raise exception 'ใบแจ้งซ่อมนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if now() - v_req.created_at > private.itrp_attach_window() then
      raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งซ่อม)' using errcode = 'check_violation';
    end if;
    if private.itrp_has_real_approval(v_req.id, v_req.requester_id) then
      raise exception 'มีผู้อนุมัติใบแจ้งซ่อมนี้แล้ว แนบไฟล์เพิ่มไม่ได้' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.itrp_attachments a where a.request_id = v_req.id and a.rework_id is null and a.comment_id is null) >= 10 then
      raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง' using errcode = 'check_violation';
    end if;
  else
    -- (2) แนบตอนขอแก้ไขงาน: รอบล่าสุดของใบนี้ที่ผู้แจ้งเพิ่งสร้าง
    if not exists (select 1 from public.itrp_reworks r where r.id = p_rework_id and r.request_id = v_req.id) then
      raise exception 'ไม่พบรอบขอแก้ไขงานนี้' using errcode = 'check_violation';
    end if;
    if v_req.status not in ('in_progress', 'it_closed', 'need_info') then
      raise exception 'ใบแจ้งซ่อมนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if not exists (
         select 1 from public.itrp_reworks r
         where r.id = p_rework_id and r.requested_by = v_actor.id
           and r.round_no = (select max(x.round_no) from public.itrp_reworks x where x.request_id = v_req.id)) then
      raise exception 'แนบไฟล์ได้เฉพาะรอบขอแก้ไขงานล่าสุดของคุณ' using errcode = 'check_violation';
    end if;
    if not private.itrp_rework_attach_open(v_req, p_rework_id) then
      raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังขอแก้ไขงาน)' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.itrp_attachments a where a.rework_id = p_rework_id) >= 10 then
      raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง' using errcode = 'check_violation';
    end if;
  end if;

  -- ไฟล์ต้องอยู่ใน Storage จริง ในบัคเก็ตตามโหมดของใบ และผู้เรียกเป็นคนอัปโหลดเอง
  select * into v_object
  from storage.objects o
  where o.bucket_id = case when v_req.is_test then 'itrp-test-files' else 'itrp-files' end
    and o.name = p_storage_path and o.owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  -- ชนิดและขนาดใช้ค่าจาก metadata ของ Storage เท่านั้น (ค่า p_mime_type / p_size_bytes ที่ผู้เรียกส่งมาไม่ถูกเชื่อ และไม่ใช้เป็นค่าสำรอง)
  -- ถ้า metadata ว่าง = ปฏิเสธ (ให้อัปโหลดใหม่) · เก็บลงทะเบียนด้วยค่าจาก Storage เสมอ
  v_mime := nullif(v_object.metadata ->> 'mimetype', '');
  v_size := nullif(v_object.metadata ->> 'size', '')::bigint;
  if v_mime is null or v_size is null then
    raise exception 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if v_mime <> all (private.itrp_allowed_mime_types()) then
    raise exception 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)' using errcode = 'check_violation';
  end if;
  -- นามสกุลใน path ต้องตรงกับชนิดไฟล์ (กันตั้งนามสกุลหลอก เช่น .pdf แต่ชนิดเป็นรูป)
  if not private.itrp_ext_matches_mime(p_storage_path, v_mime) then
    raise exception 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if v_size <= 0 or v_size > 20971520 then
    raise exception 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB' using errcode = 'check_violation';
  end if;

  insert into public.itrp_attachments (is_test, request_id, rework_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_req.is_test, v_req.id, p_rework_id, p_storage_path, v_file_name, v_mime, v_size, v_actor.id)
  returning itrp_attachments.id into v_id;
  return v_id;
end;
$$;

-- ลงทะเบียนไฟล์ของข้อความถาม/ตอบ · ผู้เขียนข้อความเท่านั้น
create or replace function public.app_itrp_add_comment_attachment(p_request_id uuid, p_comment_id bigint, p_storage_path text, p_file_name text, p_mime_type text, p_size_bytes bigint)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_comment public.itrp_comments%rowtype;
  v_file_name text := private.itrp_clean(p_file_name);
  v_existing public.itrp_attachments%rowtype;
  v_file record;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  select * into v_comment from public.itrp_comments c where c.id = p_comment_id and c.request_id = v_req.id;
  if v_comment.id is null then
    raise exception 'ไม่พบข้อความนี้ในใบแจ้งซ่อม' using errcode = 'check_violation';
  end if;
  if v_comment.author_id <> v_actor.id then
    raise exception 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้' using errcode = 'insufficient_privilege';
  end if;

  -- path ต้องอยู่ใต้โฟลเดอร์ของใบนี้ และรูปแบบถูกต้อง
  if p_storage_path is null or private.itrp_file_path_order_id(p_storage_path) is distinct from v_req.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของข้อความเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม
  select * into v_existing from public.itrp_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.request_id = v_req.id and v_existing.comment_id is not distinct from v_comment.id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if v_req.status in ('rejected', 'cancelled', 'received') then
    raise exception 'ใบแจ้งซ่อมนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
  end if;
  if now() - v_comment.created_at > private.itrp_attach_window() then
    raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังส่งข้อความ)' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.itrp_attachments a where a.comment_id = v_comment.id) >= 10 then
    raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อข้อความ' using errcode = 'check_violation';
  end if;

  -- ไฟล์ต้องอยู่ใน Storage จริง ในบัคเก็ตตามโหมดของใบ และผู้เรียกเป็นคนอัปโหลดเอง (ชนิด/ขนาดใช้ค่าจาก Storage ค่า p_mime_type / p_size_bytes ไม่ถูกเชื่อ)
  select * into v_file from private.itrp_read_stored_file(v_req.is_test, p_storage_path);

  insert into public.itrp_attachments (is_test, request_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_req.is_test, v_req.id, v_comment.id, p_storage_path, v_file_name, v_file.mime_type, v_file.size_bytes, v_actor.id)
  returning itrp_attachments.id into v_id;
  return v_id;
end;
$$;

-- 11. อ่านข้อมูล ----------------------------------------------------------------------
-- บันทึกการซ่อมหนึ่งชุดเป็น jsonb พร้อมรายการอะไหล่ (ใช้ใน get_detail)
create or replace function private.itrp_report_json(p_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'completed_event_id', r.completed_event_id,
    'completed_at', ev.created_at,
    'completed_by_employee_no', a.employee_no,
    'completed_by_full_name', a.first_name || ' ' || a.last_name,
    'cause', r.cause,
    'cause_kind', r.cause_kind,
    'cause_kind_note', r.cause_kind_note,
    'repair_method', r.repair_method,
    'repair_vendor', r.repair_vendor,
    'repair_action', r.repair_action,
    'pr_po_no', r.pr_po_no,
    'parts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'line_no', p.line_no,
               'item_name', p.item_name,
               'quantity', p.quantity,
               'price', p.price,
               'note', p.note
             ) order by p.line_no), '[]'::jsonb)
      from public.itrp_repair_parts p
      where p.report_id = r.id)
  )
  from public.itrp_repair_reports r
  join public.itrp_events ev on ev.id = r.completed_event_id
  join public.employees a on a.id = r.created_by
  where r.id = p_report_id
$$;

-- รายละเอียดใบ: ข้อมูลทั้งใบ ประวัติ ไฟล์ ถาม-ตอบ ลายเซ็นอนุมัติ บันทึกการซ่อม และปุ่มที่ทำได้ (allowed_actions)
-- ผู้แจ้ง / ทีม IT (itwo_staff) / ผู้อนุมัติขั้นแผนกของแผนกนั้นเท่านั้นที่เห็น
create or replace function public.app_itrp_get_detail(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  select * into v_req from public.itrp_requests w where w.id = p_request_id;
  if v_req.id is null or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_req.id,
    'is_test', v_req.is_test,
    'doc_no', v_req.doc_no,
    'doc_year', v_req.doc_year,
    'doc_seq', v_req.doc_seq,
    'requester_id', v_req.requester_id,
    'department_id', v_req.department_id,
    'asset_code', v_req.asset_code,
    'device_name', v_req.device_name,
    'request_kind', v_req.request_kind,
    'request_kind_note', v_req.request_kind_note,
    'repair_target', v_req.repair_target,
    'repair_target_note', v_req.repair_target_note,
    'symptom', v_req.symptom,
    'is_urgent', v_req.is_urgent,
    'status', v_req.status,
    'info_return_status', v_req.info_return_status,
    'created_at', v_req.created_at,
    'rework_round', (select coalesce(max(r.round_no), 0) from public.itrp_reworks r where r.request_id = v_req.id),
    -- วันที่กำหนดเสร็จของรอบขอแก้ไขล่าสุด (ไม่มีรอบแก้ไข = null · ใบแจ้งซ่อมไม่มีวันที่ต้องการงานตอนแจ้ง)
    'latest_due_date', (select r.due_date from public.itrp_reworks r where r.request_id = v_req.id order by r.round_no desc limit 1),
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_req.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_req.department_id),
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
      from public.itrp_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id),
    'reworks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rw.id,
               'round_no', rw.round_no,
               'details', rw.details,
               'due_date', rw.due_date,
               'created_at', rw.created_at,
               'requested_by_employee_no', a.employee_no,
               'requested_by_full_name', a.first_name || ' ' || a.last_name
             ) order by rw.round_no), '[]'::jsonb)
      from public.itrp_reworks rw
      join public.employees a on a.id = rw.requested_by
      where rw.request_id = v_req.id),
    -- ไฟล์ตอนแจ้ง/รอบแก้ไข (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments)
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'rework_id', att.rework_id,
               'round_no', coalesce(rw.round_no, 0),
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by coalesce(rw.round_no, 0), att.created_at, att.id), '[]'::jsonb)
      from public.itrp_attachments att
      join public.employees a on a.id = att.uploaded_by
      left join public.itrp_reworks rw on rw.id = att.rework_id
      where att.request_id = v_req.id and att.comment_id is null),
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
                          'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itrp_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itrp_comments c
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
      from public.itrp_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itrp_pending_question(v_req.id)).id) end,
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null · it_mgr = "รับทราบ ฝ่ายบริหาร" บนใบพิมพ์
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    -- เวลาดำเนินการซ่อมบนใบพิมพ์: เริ่ม = event started · ซ่อมเสร็จ/ส่งมอบงาน = event completed ล่าสุด (ผู้กด = ช่างผู้ดำเนินการ) · รับมอบงาน = ผู้แจ้งที่กดรับ
    -- รวมเวลา (วัน/ชม.) ให้หน้าเว็บคำนวณจาก started.at ถึง completed.at ตอนแสดง
    'started', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'started'
      order by ev.id limit 1),
    'completed', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'completed'
      order by ev.id desc limit 1),
    'received', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'received'
      order by ev.id desc limit 1),
    -- มีการขอแก้ไขค้างอยู่ (ขอแก้ไขหลังการส่งงานล่าสุด และ IT ยังไม่ส่งงานใหม่) = ช่อง "ส่งแก้ไข" บนใบพิมพ์
    'rework_open', coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'rework_requested'
    ) > coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'completed'
    ), 0), false),
    -- บันทึกการซ่อม: ชุดล่าสุด (ใช้แสดง/พิมพ์) และทุกชุดเรียงตามการส่งงาน (ประวัติ · ชุดล่าสุดอยู่ท้ายสุด) ยังไม่เคยส่งงาน = null / []
    'repair_report', (
      select private.itrp_report_json(r.id)
      from public.itrp_repair_reports r where r.request_id = v_req.id
      order by r.completed_event_id desc limit 1),
    'repair_reports', (
      select coalesce(jsonb_agg(private.itrp_report_json(r.id) order by r.completed_event_id), '[]'::jsonb)
      from public.itrp_repair_reports r where r.request_id = v_req.id),
    'allowed_actions', to_jsonb(private.itrp_allowed_actions(v_req, v_actor))
  );
end;
$$;

-- ใบของฉัน
create or replace function public.app_itrp_list_mine()
returns table(
  id uuid, doc_no text, status text, is_urgent boolean, asset_code text, device_name text, request_kind text, request_kind_note text,
  repair_target text, symptom text, created_at timestamptz, rework_round integer, rework_due_date date,
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
  v_actor := private.itrp_actor();
  return query
  select rq.id, rq.doc_no, rq.status, rq.is_urgent, rq.asset_code, rq.device_name, rq.request_kind, rq.request_kind_note,
         rq.repair_target, rq.symptom, rq.created_at, coalesce(rw.round_no, 0), rw.due_date, rq.info_return_status,
         case when rq.status = 'need_info' then (private.itrp_pending_question(rq.id)).stage end
  from public.itrp_requests rq
  left join lateral (
    select r.round_no, r.due_date from public.itrp_reworks r
    where r.request_id = rq.id order by r.round_no desc limit 1
  ) rw on true
  where rq.requester_id = v_actor.id and rq.is_test = v_actor.is_test
  order by rq.created_at desc, rq.doc_year desc, rq.doc_seq desc;
end;
$$;

-- รออนุมัติ: ใบที่ผู้ทำรายการเป็นผู้พิจารณาของขั้นที่ค้างอยู่ (ขั้นแผนกหรือขั้น IT) · ใบ need_info (รอผู้แจ้งตอบ) แสดงด้วยให้ผู้อนุมัติเห็นว่ายังค้างคำตอบ
-- ปุ่มที่กดได้จริงดูจาก allowed_actions ของ app_itrp_get_detail (ระหว่างรอผู้แจ้งตอบ อนุมัติ/ไม่อนุมัติไม่ได้)
create or replace function public.app_itrp_list_pending_approvals()
returns table(
  id uuid, doc_no text, status text, is_urgent boolean, asset_code text, device_name text, request_kind text, request_kind_note text,
  repair_target text, symptom text, created_at timestamptz, requester_name text, department_name text, pending_step text,
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
  v_actor := private.itrp_actor();
  return query
  select rq.id, rq.doc_no, rq.status, rq.is_urgent, rq.asset_code, rq.device_name, rq.request_kind, rq.request_kind_note,
         rq.repair_target, rq.symptom, rq.created_at,
         req.first_name || ' ' || req.last_name, d.name_th,
         case when caps.can_it then 'it_mgr' else 'dept' end,
         rq.info_return_status,
         case when rq.status = 'need_info' then (private.itrp_pending_question(rq.id)).stage end
  from public.itrp_requests rq
  join public.departments d on d.id = rq.department_id
  join public.employees req on req.id = rq.requester_id
  cross join lateral private.itrp_approval_caps(rq.id, v_actor.id) caps
  where rq.is_test = v_actor.is_test
    and rq.requester_id <> v_actor.id
    and rq.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
    and (caps.can_dept or caps.can_it)
  order by rq.is_urgent desc, rq.created_at, rq.doc_year, rq.doc_seq;
end;
$$;

-- จำนวนใบที่รอผู้ทำรายการอนุมัติ (ป้ายตัวเลข)
create or replace function public.app_itrp_pending_count()
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
  v_actor := private.itrp_actor();
  select count(*)::integer into v_count
  from public.itrp_requests rq
  cross join lateral private.itrp_approval_caps(rq.id, v_actor.id) caps
  where rq.is_test = v_actor.is_test
    and rq.requester_id <> v_actor.id
    and rq.status in ('pending_dept', 'pending_it_mgr', 'in_progress')
    and (caps.can_dept or caps.can_it);
  return v_count;
end;
$$;

-- งาน IT: ทุกใบในโหมดของผู้ทำรายการ (ทีม IT ใน itwo_staff เท่านั้น) งานด่วนอยู่บนสุด แล้วใบที่มีรอบขอแก้ไขตามวันกำหนดเสร็จ แล้วตามเวลาแจ้ง
create or replace function public.app_itrp_list_it()
returns table(
  id uuid, doc_no text, status text, is_urgent boolean, asset_code text, device_name text, request_kind text, request_kind_note text,
  repair_target text, symptom text, created_at timestamptz, requester_full_name text, department_name text,
  has_dept_approved boolean, has_it_mgr_approved boolean, rework_round integer, rework_due_date date,
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
  v_actor := private.itrp_actor();
  if not private.itrp_is_staff(v_actor.id) then
    raise exception 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select rq.id, rq.doc_no, rq.status, rq.is_urgent, rq.asset_code, rq.device_name, rq.request_kind, rq.request_kind_note,
         rq.repair_target, rq.symptom, rq.created_at,
         req.first_name || ' ' || req.last_name, d.name_th,
         exists (select 1 from public.itrp_events ev where ev.request_id = rq.id and ev.action = 'dept_approved'),
         exists (select 1 from public.itrp_events ev where ev.request_id = rq.id and ev.action = 'it_mgr_approved'),
         coalesce(rw.round_no, 0), rw.due_date, rq.info_return_status,
         case when rq.status = 'need_info' then (private.itrp_pending_question(rq.id)).stage end
  from public.itrp_requests rq
  join public.departments d on d.id = rq.department_id
  join public.employees req on req.id = rq.requester_id
  left join lateral (
    select r.round_no, r.due_date from public.itrp_reworks r
    where r.request_id = rq.id order by r.round_no desc limit 1
  ) rw on true
  where rq.is_test = v_actor.is_test
  order by rq.is_urgent desc, rw.due_date nulls last, rq.created_at, rq.doc_year, rq.doc_seq;
end;
$$;

-- 12. เลขที่เอกสาร + รายชื่อทีม IT (อ่านอย่างเดียว) ---------------------------------------------
-- ดูตัวนับเลขที่เอกสาร (ผู้ดูแลงาน IT เท่านั้น)
create or replace function public.app_itrp_get_doc_counter(p_year integer default null)
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
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้' using errcode = 'insufficient_privilege';
  end if;
  select coalesce(max(c.last_seq), 0) into v_last
  from public.itrp_doc_counters c where c.is_test = v_actor.is_test and c.doc_year = v_year;
  return jsonb_build_object(
    'year', v_year, 'last_seq', v_last, 'next_seq', v_last + 1,
    'next_doc_no', private.itrp_format_doc_no(v_actor.is_test, v_year, v_last + 1),
    'is_test', v_actor.is_test);
end;
$$;

-- ตั้งเลขที่เอกสารถัดไป (เดินหน้าอย่างเดียว ห้ามถอยหรือชนเลขที่ใช้แล้ว · ตั้งตามโหมดของผู้ทำรายการ) พร้อมบันทึกลง itrp_admin_log
create or replace function public.app_itrp_set_next_doc_seq(p_next integer, p_year integer default null)
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
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้' using errcode = 'insufficient_privilege';
  end if;
  if p_next is null or p_next < 1 or p_next > 9999 then
    raise exception 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999' using errcode = 'check_violation';
  end if;
  if v_year < v_this_year or v_year > v_this_year + 1 then
    raise exception 'ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า' using errcode = 'check_violation';
  end if;

  -- ล็อกแถวตัวนับ (สร้างถ้ายังไม่มี) กันชนกับการออกเลขที่กำลังเกิดขึ้น
  insert into public.itrp_doc_counters (is_test, doc_year, last_seq)
  values (v_actor.is_test, v_year, 0)
  on conflict (is_test, doc_year) do nothing;
  select c.last_seq into v_last
  from public.itrp_doc_counters c
  where c.is_test = v_actor.is_test and c.doc_year = v_year
  for update;
  select coalesce(max(rq.doc_seq), 0) into v_max_used
  from public.itrp_requests rq
  where rq.is_test = v_actor.is_test and rq.doc_year = v_year;
  v_last := greatest(v_last, v_max_used);

  if p_next < v_last + 1 then
    raise exception 'ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง %, เลขถัดไปต้องไม่น้อยกว่า %)', v_last, v_last + 1
      using errcode = 'check_violation';
  end if;

  if p_next > v_last + 1 then
    update public.itrp_doc_counters set last_seq = p_next - 1, updated_at = now()
    where is_test = v_actor.is_test and doc_year = v_year;
    insert into public.itrp_admin_log (is_test, actor_id, action, detail)
    values (v_actor.is_test, v_actor.id, 'doc_seq_set',
            jsonb_build_object('year', v_year, 'previous_next', v_last + 1, 'new_next', p_next));
  end if;
  return jsonb_build_object(
    'year', v_year, 'next_seq', p_next,
    'next_doc_no', private.itrp_format_doc_no(v_actor.is_test, v_year, p_next), 'is_test', v_actor.is_test);
end;
$$;

-- รายชื่อทีม IT (อ่านอย่างเดียว จาก itwo_staff) ให้แท็บตั้งค่าแสดง · แก้สิทธิ์ที่ใบสั่งงาน IT (app_itwo_set_staff) ที่เดียว ใบแจ้งซ่อมไม่มี RPC แก้สิทธิ์
create or replace function public.app_itrp_list_staff()
returns table(employee_id uuid, employee_no text, full_name text, department_name text, is_it_admin boolean, is_it_approver boolean, is_active boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
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

-- 13. ล้างข้อมูลทดสอบ -----------------------------------------------------------------
-- ลบเฉพาะแถว is_test ของตารางโมดูลนี้ (ประวัติ ISO ของจริงไม่ถูกแตะ) แล้วเริ่มนับเลข TEST-… ใหม่ · คืนรายการไฟล์ในบัคเก็ตทดสอบให้หน้าเว็บลบผ่าน Storage API
-- (storage.objects ลบด้วย SQL ไม่ได้ ต้องลบผ่าน Storage API) · เฉพาะ admin ที่อยู่ในโหมดทดสอบ (private.sandbox_persona)
create or replace function public.app_sandbox_purge_itrp()
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

  -- ล็อกตารางเขียนของโมดูลทั้งหมดไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นแจ้ง/อนุมัติใบทดสอบพร้อมกันระหว่างล้าง
  -- จนเหลือแถวลูกกำพร้า หรือได้เลข TEST- ที่ชนกับตัวนับที่กำลังถูกลบ · ถ้าสั่งพร้อมกัน ฝั่งที่มาทีหลังจะรอแล้วทำงานหลังล้างเสร็จ
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> รอบแก้ไข/ข้อความ/ไฟล์แนบ -> ประวัติ -> บันทึกการซ่อม/อะไหล่ -> admin_log) กัน deadlock
  lock table public.itrp_doc_counters, public.itrp_requests, public.itrp_reworks, public.itrp_comments, public.itrp_attachments,
             public.itrp_events, public.itrp_repair_reports, public.itrp_repair_parts, public.itrp_admin_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itrp.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itrp.purge', 'on', true);

  -- ลูกก่อนแม่: อะไหล่ -> บันทึกการซ่อม (อ้าง event) -> ไฟล์แนบ (อ้างรอบแก้ไข/ข้อความ) -> ข้อความ (อ้างกันเองลบในคำสั่งเดียวได้) -> รอบแก้ไข -> ประวัติ -> ... -> ใบ
  foreach v_table in array array['itrp_repair_parts', 'itrp_repair_reports', 'itrp_attachments', 'itrp_comments', 'itrp_reworks',
                                 'itrp_events', 'itrp_admin_log', 'itrp_requests', 'itrp_doc_counters'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform set_config('itrp.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select coalesce(array_agg(o.name order by o.name), '{}'::text[]) into v_files
  from storage.objects o where o.bucket_id = 'itrp-test-files';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITRP_SANDBOX_PURGE', 'itrp_requests', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'files_to_remove', cardinality(v_files)));
  return jsonb_build_object('deleted', v_deleted, 'files', to_jsonb(v_files));
end;
$$;

-- 14. แจ้งเตือน (กระดิ่ง/อีเมล/Push ผ่าน private.office_notify กลางของระบบสำนักงาน · ไม่ replace ตัวกลาง) --------------------
-- ผู้รับ/เหตุการณ์ชุดเดียวกับใบสั่งงาน IT: trigger หลังเพิ่ม event ในประวัติ (ธุรกรรมเดียวกับการอนุมัติ/ส่งงาน)
-- ใบทดสอบไม่ส่งเลย · started / received ไม่แจ้ง · งานด่วนขึ้นหัว "🚨 [ด่วน] " และแจ้งผู้ดูแลงาน IT ทันที
-- ลิงก์เปิดใบตรง = /office/repair/<uuid> (ต้องรองรับใน app.js notificationHref, notify-email, notify-push ฝั่งหน้าเว็บ/Edge Function)

-- ผู้อนุมัติขั้นแผนกที่ควรได้แจ้ง (ไม่นับผู้แจ้งเอง)
create or replace function private.itrp_notify_dept_approver_ids(p_req public.itrp_requests)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select a.id
    from private.itrp_dept_approvers(p_req.department_id, p_req.is_test) a(id)
    where a.id <> p_req.requester_id
    order by a.id)
$$;

-- ผู้ดูแลงาน IT / ผู้อนุมัติขั้น IT ทุกคนใน itwo_staff (อ่านอย่างเดียว)
create or replace function private.itrp_notify_it_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select s.employee_id from public.itwo_staff s where s.is_it_admin order by s.employee_id)
$$;

create or replace function private.itrp_notify_it_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select s.employee_id from public.itwo_staff s where s.is_it_approver order by s.employee_id)
$$;

-- ผู้อนุมัติของขั้นที่ใบรออยู่ตอนนี้ (ใช้ตอนผู้แจ้งยกเลิกเอง)
create or replace function private.itrp_notify_stage_approver_ids(p_req public.itrp_requests)
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
  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(p_req.id) s;
  if v_dept_done and v_it_done then
    return '{}';
  end if;
  if not v_dept_done and not private.itrp_is_it_department(p_req.department_id) then
    v_dept_ids := private.itrp_notify_dept_approver_ids(p_req);
    if cardinality(v_dept_ids) > 0 then
      return v_dept_ids;
    end if;
  end if;
  return private.itrp_notify_it_approver_ids();
end;
$$;

-- ส่งถึงหลายคนโดยไม่ซ้ำคน (คืนรายชื่อที่ส่งแล้วสะสม)
create or replace function private.itrp_notify_each(p_recipients uuid[], p_already uuid[], p_actor_id uuid, p_title text, p_body text, p_action_url text)
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

create or replace function private.itrp_notify_on_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_req public.itrp_requests%rowtype;
  v_requester_name text;
  v_dept_name text;
  v_actor_name text;
  v_type_text text;
  v_summary text;
  v_title text;
  v_prefix text;
  v_started boolean;
  v_url text;
  v_done uuid[] := '{}';
  v_ids uuid[];
  v_dept_done boolean;
  v_it_done boolean;
  v_question public.itrp_comments%rowtype;
  v_answer public.itrp_comments%rowtype;
  v_rework public.itrp_reworks%rowtype;
begin
  -- ใบทดสอบ ไม่ insert เลย · started / received ไม่แจ้ง (เหมือน itwo)
  if new.is_test or new.action in ('started', 'received') then
    return new;
  end if;

  begin
    select * into v_req from public.itrp_requests w where w.id = new.request_id;
    if v_req.id is null or v_req.is_test then
      return new;
    end if;

    select e.first_name || ' ' || e.last_name into v_requester_name from public.employees e where e.id = v_req.requester_id;
    select e.first_name || ' ' || e.last_name into v_actor_name from public.employees e where e.id = new.actor_id;
    select d.name_th into v_dept_name from public.departments d where d.id = v_req.department_id;
    -- "<ชื่อเครื่อง> · <ประเภทคำขอ>" และสรุป "<ชื่อผู้แจ้ง> · <แผนก> · <ชื่อเครื่อง> · <ประเภทคำขอ>"
    v_type_text := concat_ws(' · ', v_req.device_name, private.itrp_request_kind_text(v_req.request_kind, v_req.request_kind_note));
    v_summary := concat_ws(' · ', v_requester_name, v_dept_name, v_type_text);
    -- ใบด่วนขึ้นหัวทุกข้อความด้วย "🚨 [ด่วน] " (ครั้งเดียว: notify-email เห็นแล้วตัดออกก่อนใส่ซ้ำที่หัวอีเมล)
    v_prefix := case when v_req.is_urgent then '🚨 [ด่วน] ' else '' end;
    v_title := v_prefix || 'ใบแจ้งซ่อม ' || v_req.doc_no;
    v_url := '/office/repair/' || v_req.id::text;

    if new.action = 'created' then
      -- ปลายทางแรกของใบ: รอขั้นแผนก -> ผู้อนุมัติแผนก · รอขั้น IT ทันที -> ผู้อนุมัติขั้น IT · อนุมัติครบทันที -> ไม่แจ้งตอนนี้
      if v_req.status = 'pending_dept' then
        v_ids := private.itrp_notify_dept_approver_ids(v_req);
      elsif v_req.status = 'pending_it_mgr' then
        v_ids := private.itrp_notify_it_approver_ids();
      else
        v_ids := '{}';
      end if;
      v_done := private.itrp_notify_each(v_ids, v_done, new.actor_id, v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      -- งานด่วน: IT เริ่มทำได้ก่อนอนุมัติครบ จึงแจ้งผู้ดูแลงาน IT ทุกคนทันที (ผู้ดูแลที่เป็นผู้อนุมัติด้วยได้ข้อความรออนุมัติด้านบนแล้ว ไม่ซ้ำ)
      -- ใบที่อนุมัติครบตั้งแต่แจ้ง (ผู้อนุมัติขั้น IT แจ้งเอง) ไม่แจ้งตรงนี้ เพราะ it_mgr_approved ในธุรกรรมเดียวกันแจ้งผู้ดูแลงานอยู่แล้ว
      if v_req.is_urgent and v_req.status in ('pending_dept', 'pending_it_mgr') then
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' แจ้งซ่อมด่วน เริ่มทำได้ก่อนอนุมัติครบ', v_summary, v_url);
      end if;

    elsif new.action = 'dept_approved' then
      -- ข้ามเมื่ออนุมัติในตัว (ผู้แจ้งเอง) หรือผู้กดเป็นผู้อนุมัติขั้น IT (it_mgr_approved ตามมาในธุรกรรมเดียวกันเสมอ)
      if new.actor_id <> v_req.requester_id and not private.itrp_is_it_approver(new.actor_id) then
        v_done := private.itrp_notify_each(private.itrp_notify_it_approver_ids(), v_done, new.actor_id,
                                           v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      end if;

    elsif new.action = 'it_mgr_approved' then
      -- อนุมัติครบ: ผู้แจ้งก่อน (ถ้าผู้แจ้งเป็นผู้ดูแลงาน IT ด้วยก็ได้ข้อความนี้ข้อความเดียว) แล้วผู้ดูแลงาน IT
      -- ใบที่ IT เริ่มงานไปแล้ว (งานด่วนที่ทำก่อนอนุมัติครบ) ข้อความต้องไม่บอกว่า "รอ IT ดำเนินการ/รับงาน"
      select exists (select 1 from public.itrp_events e where e.request_id = v_req.id and e.action = 'started') into v_started;
      if v_started then
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'IT กำลังดำเนินการ · ' || v_type_text,
                                           v_url);
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว ส่งงานได้', v_summary, v_url);
      else
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'รอ IT ดำเนินการ · ' || v_type_text,
                                           v_url);
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบ พร้อมให้ IT รับงาน', v_summary, v_url);
      end if;

    elsif new.action in ('dept_rejected', 'it_mgr_rejected') then
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' ไม่ได้รับอนุมัติ',
                                         concat_ws(' · ', 'เหตุผล: ' || private.office_clip(new.reason, 200), 'โดย ' || v_actor_name),
                                         v_url);

    elsif new.action = 'info_requested' then
      select * into v_question from public.itrp_comments c
      where c.request_id = v_req.id and c.kind = 'question' order by c.id desc limit 1;
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' มีคำถามถึงคุณ',
                                         v_actor_name || ': ' || private.office_clip(coalesce(v_question.body, new.reason), 200),
                                         v_url);

    elsif new.action = 'info_provided' then
      -- แจ้งคนที่ถามคำถามข้อที่ผู้แจ้งเพิ่งตอบ (คำตอบล่าสุดของใบ -> คำถามที่มันตอบ -> ผู้ถาม)
      select * into v_answer from public.itrp_comments a
      where a.request_id = v_req.id and a.kind = 'answer' order by a.id desc limit 1;
      select * into v_question from public.itrp_comments q
      where q.id = v_answer.reply_to and q.request_id = v_req.id;
      if v_question.id is not null then
        v_done := private.itrp_notify_each(array[v_question.author_id], v_done, new.actor_id,
                                           v_title || ' ผู้แจ้งตอบคำถามแล้ว',
                                           v_actor_name || ': ' || private.office_clip(v_answer.body, 200),
                                           v_url);
      end if;

    elsif new.action = 'completed' then
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_prefix || 'IT ส่งงานใบแจ้งซ่อม ' || v_req.doc_no || ' แล้ว กรุณาตรวจรับ',
                                         'กดรับงาน หรือขอแก้ไขงานได้ที่หน้าใบแจ้งซ่อม · ' || v_type_text,
                                         v_url);

    elsif new.action = 'rework_requested' then
      select * into v_rework from public.itrp_reworks r
      where r.request_id = v_req.id order by r.round_no desc limit 1;
      v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                         v_title || ' ผู้แจ้งขอแก้ไขงาน',
                                         concat_ws(' · ', v_requester_name,
                                                   case when v_rework.id is not null then 'รอบที่ ' || v_rework.round_no end,
                                                   case when v_rework.id is not null then 'ต้องการ ' || private.office_format_date(v_rework.due_date) end,
                                                   private.office_clip(v_rework.details, 150)),
                                         v_url);

    elsif new.action = 'cancelled' then
      if new.actor_id = v_req.requester_id then
        -- ผู้แจ้งยกเลิกเอง: ผู้อนุมัติของขั้นที่ใบรออยู่ · ผู้ดูแลงาน IT เมื่ออนุมัติครบแล้วหรือ IT เริ่มงานแล้ว
        v_ids := private.itrp_notify_stage_approver_ids(v_req);
        select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(v_req.id) s;
        if (v_dept_done and v_it_done)
           or exists (select 1 from public.itrp_events e where e.request_id = v_req.id and e.action = 'started') then
          v_ids := v_ids || private.itrp_notify_it_admin_ids();
        end if;
        v_done := private.itrp_notify_each(v_ids, v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', 'ผู้แจ้งยกเลิก', private.office_clip(new.reason, 200), v_summary),
                                           v_url);
      else
        -- IT ยกเลิกแทนผู้แจ้ง (เหตุผลขึ้นต้นด้วย "IT ยกเลิกแทนผู้แจ้ง: " อยู่แล้ว): แจ้งผู้แจ้ง
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', v_actor_name, private.office_clip(new.reason, 200)),
                                           v_url);
      end if;
    end if;
  exception when others then
    -- แจ้งเตือนเป็นเรื่องรอง ห้ามทำให้การอนุมัติ/ส่งงาน (และบันทึก ISO) ล้มตาม
    raise warning 'itrp_notify: สร้างแจ้งเตือนของ event % (ใบ %) ไม่สำเร็จ: % [%]', new.id, new.request_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;

create trigger itrp_events_notify
  after insert on public.itrp_events
  for each row execute function private.itrp_notify_on_event();

-- 15. สิทธิ์เรียกฟังก์ชัน ---------------------------------------------------------------------
-- private.itrp_*: ถอนจาก public/anon/authenticated ทั้งหมด (เรียกได้เฉพาะผ่าน SECURITY DEFINER ของ RPC/trigger)
--   ยกเว้นตัวช่วยของ policy Storage 3 ตัวที่ต้องเรียกด้วยสิทธิ์ผู้ใช้ (คืนแค่ true/false ตามสิทธิ์ของผู้เรียกเอง)
-- public.app_itrp_* และ app_sandbox_purge_itrp: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจพนักงานและบทบาทซ้ำอีกชั้น) anon เรียกไม่ได้
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('itrp_storage_can_read', 'itrp_storage_can_upload', 'itrp_storage_test_file_removable')
  loop
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itrp\_%' or p.proname = 'app_sandbox_purge_itrp')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
