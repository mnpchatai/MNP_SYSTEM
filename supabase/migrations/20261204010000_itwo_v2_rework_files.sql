-- ============================================================================
-- ใบสั่งงาน IT รุ่น 2 — ส่วนฐานข้อมูล (ตามที่เจ้าของสั่ง 19/11/2026)
--   A. เอาส่วน "สิทธิ์ในระบบ" ออกจากใบสั่งงาน (จะแยกเป็นโมดูลขอสิทธิ์ภายหลัง)
--      - app_itwo_create ไม่รับ request_type = 'system_access' อีก (และ trigger กันที่ฐานข้อมูลด้วย)
--      - app_itwo_save_access_changes ปฏิเสธทุกครั้ง (ฟังก์ชันและ grant ยังอยู่ เพื่อให้หน้าเว็บรุ่นเก่าได้ข้อความไทยแทน error แปลก)
--      - ตาราง itwo_access_changes / CHECK ของ request_type / ข้อมูลเดิมคงไว้ครบ (ISO ห้ามลบ) get_detail ยังส่ง access_changes เดิมได้
--      - allowed_actions ไม่ส่ง edit_access อีก
--   B. ประเภท "เบ็ดเตล็ดอื่นๆ" (misc) ต้องระบุว่างานอะไร: คอลัมน์ itwo_work_orders.misc_detail (≤200) บังคับเมื่อ misc ประเภทอื่นเป็น null
--      บังคับที่ RPC (ข้อความไทย) + trigger ก่อน INSERT (ไม่ใช้ CHECK ตรง ๆ เพราะ CHECK จะตรวจแถวเดิมตอน UPDATE สถานะด้วย)
--      guard "แก้เนื้อหาใบไม่ได้" รวมคอลัมน์ใหม่แล้ว
--   C. แนบไฟล์ (เมื่อเอกสารแนบ = "มี") · ตาราง itwo_attachments (เพิ่มได้อย่างเดียว) · bucket private 2 ใบแยกของจริง/ทดสอบ (แบบเดียวกับ NCR)
--      - itwo-files (ของจริง) / itwo-test-files (โหมดทดสอบ) ไฟล์ละ ≤ 20 MB ชนิด jpg/png/webp/heic/heif/pdf/docx/xlsx/pptx/doc/xls/txt/csv
--      - path ต้องเป็น <id ใบ>/<uuid>.<นามสกุลพิมพ์เล็ก> (ชื่อเดิมของไฟล์เก็บในตาราง) บังคับทั้ง policy และ RPC
--      - app_itwo_add_attachment ลงทะเบียนหลังอัปโหลด: ผู้แจ้งเท่านั้น
--          (1) ตอนแจ้ง: attachment_flag = 'yes' ภายใน 30 นาทีหลังสร้างใบ และยังไม่มีผู้อื่นอนุมัติจริง (กติกาเดียวกับ Work-Order เดิม)
--          (2) ตอนขอแก้ไขงาน: แนบกับรอบแก้ไขล่าสุดของตัวเอง ภายใน 30 นาทีหลังสร้างรอบนั้น (ไม่ผูกกับ attachment_flag ของใบเดิม)
--        ≤ 10 ไฟล์ต่อครั้งที่ส่ง (ตอนแจ้ง 10, แต่ละรอบแก้ไข 10) · ไฟล์ที่ต้องมีอยู่ใน Storage จริง ขนาด/ชนิดใช้ค่าจาก Storage
--      - storage policy: INSERT = ผู้แจ้งของใบนั้น ใน path ของใบ ขณะหน้าต่างแนบเปิด · SELECT = ผู้ที่ itwo_can_view ใบนั้น (โหมดทดสอบ = persona)
--        ไม่มี UPDATE (เขียนทับไม่ได้) · ไม่มี DELETE ของบัคเก็ตจริง (ISO) · บัคเก็ตทดสอบลบได้เฉพาะไฟล์ที่ไม่ได้ลงทะเบียน (ดูข้อ F)
--   D. ขอแก้ไขงาน (rework): สถานะ it_closed ผู้แจ้งกด "แก้ไขงาน" แทน "ได้รับงาน"
--      - app_itwo_request_rework(ใบ, รายละเอียดที่ต้องแก้ บังคับ ≤2000, วันที่ต้องการ บังคับ ไม่ย้อนหลังตามเวลาไทย) -> ตาราง itwo_reworks (เพิ่มได้อย่างเดียว)
--        + event ใหม่ rework_requested + สถานะ it_closed -> in_progress ทันที (ไม่ต้องอนุมัติใหม่) · IT ปิดงานใหม่ได้ตามเดิม ไม่จำกัดจำนวนรอบ
--      - guard การเปลี่ยนสถานะ: it_closed -> in_progress เพิ่ม · CHECK ของ itwo_events.action เพิ่ม 'rework_requested'
--      - allowed_actions เพิ่ม request_rework (ผู้แจ้ง, it_closed) · get_detail ส่ง reworks[] + latest_due_date + rework_round + attachments[]
--      - list_mine / list_it ส่ง rework_round + rework_due_date (+ misc_detail) · list_pending_approvals ส่ง misc_detail
--   D2. การรับงานเป็นขั้นตอนสุดท้ายเสมอ (เจ้าของตัดสิน): ใบที่มี event completed อย่างน้อยครั้งหนึ่ง ผู้แจ้งยกเลิกไม่ได้ (ต้องขอแก้ไขงานหรือรับงาน)
--      - app_itwo_cancel ปฏิเสธ (it_closed และ in_progress ในรอบแก้ไข) · allowed_actions ไม่ส่ง cancel · trigger ของใบกัน -> cancelled ซ้ำอีกชั้น
--   E. ผู้แจ้งคนเดียวแจ้งได้หลายใบ: ฐานข้อมูลไม่เคยกัน (ไม่มี unique บน requester_id) ไม่แก้ · มี pgTAP ยืนยัน
--   F. ล้างข้อมูลทดสอบ: app_sandbox_purge_itwo ลบแถว is_test ของตารางใหม่ด้วย และ "คืนรายการ path ของไฟล์ในบัคเก็ตทดสอบ" (files) ให้หน้าเว็บลบผ่าน Storage API
--      เหตุผล: storage.objects ลบด้วย SQL ไม่ได้ (trigger ของ Storage) และถ้าลบแถวตรงไฟล์จริงจะค้างใน S3 · หลังล้างแถวทะเบียน ไฟล์ทดสอบทุกไฟล์ไม่มีใครลงทะเบียน
--      policy ของบัคเก็ตทดสอบจึงอนุญาตให้ admin ที่อยู่ในโหมดทดสอบอ่าน/ลบได้ · ถ้าลบไม่ครบ เรียก purge ซ้ำจะได้รายการที่เหลืออีก
--
-- ตารางใหม่ติดด่านเดิมครบ: RLS deny-all + ถอนสิทธิ์ anon/authenticated/service_role + ด่าน lab-only + trigger โหมดทดสอบ (sandbox_row_scope)
--   + เพิ่มได้อย่างเดียว (itwo_append_only_guard เดิม ยกเว้น purge แถว is_test) · private.sandbox_unguarded_tables() ต่อท้ายตารางใหม่
--
-- นิยามที่ replace (เริ่มจากนิยามล่าสุดบน main ทุกตัว · ก่อน apply ที่ production เทียบ md5(pg_get_functiondef(oid)) กับต้นทางก่อน)
--   - private.sandbox_unguarded_tables()      จาก 20261202010000_bom_sr_rod_store.sql (คงทุกชื่อเดิม เพิ่ม itwo_reworks, itwo_attachments)
--   - private.itwo_work_order_guard()         จาก 20261203010000_itwo_work_orders.sql
--   - private.itwo_allowed_actions(...)       จาก 20261203010000_itwo_work_orders.sql
--   - public.app_itwo_create                  จาก 20261203010000 (ลายเซ็นใหม่: เพิ่ม p_misc_detail default null · drop ลายเซ็น 7 ตัวแปรเดิม)
--   - public.app_itwo_save_access_changes     จาก 20261203010000 (ปฏิเสธทุกครั้ง)
--   - public.app_itwo_cancel                  จาก 20261203010000 (ใบที่ IT เคยปิดงานแล้วยกเลิกไม่ได้ · การรับงานเป็นขั้นสุดท้ายเสมอ)
--   - public.app_itwo_get_detail             จาก 20261203010000
--   - public.app_itwo_list_mine / list_pending_approvals / list_it  จาก 20261203010000 (คอลัมน์ผลลัพธ์เพิ่ม จึง drop แล้วสร้างใหม่)
--   - public.app_sandbox_purge_itwo           จาก 20261203010000 (คืน files)
--
-- ลำดับ deploy: หน้าเว็บรุ่นใหม่เรียก RPC ใหม่/คอลัมน์ใหม่ จึงต้อง apply ไฟล์นี้ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   หน้าเว็บรุ่นเก่า + ฐานข้อมูลใหม่: แจ้งงานประเภท misc ไม่ได้ (ไม่ส่ง misc_detail), system_access ไม่ได้, ปุ่มสิทธิ์ในระบบ/ปุ่มรับงานแบบเก่ายังทำงานตามที่ฐานข้อมูลอนุญาต
--   ฐานข้อมูลใหม่ต้องการ "Global file size limit" ของ Storage >= 20 MB (ตั้งไว้แล้วจากรอบ NCR)
--
-- Rollback (ถ้ายังไม่มีข้อมูลจริงของตารางใหม่): drop policy itwo_*_files_* บน storage.objects · ลบ bucket ว่าง ๆ ผ่าน Storage API ·
--   drop function app_itwo_request_rework/app_itwo_add_attachment + private.itwo_storage_* ฯลฯ · create or replace ฟังก์ชันที่ replace กลับด้วยนิยามต้นทางข้างบน ·
--   drop table itwo_attachments, itwo_reworks · alter table itwo_work_orders drop column misc_detail · คืน CHECK ของ itwo_events.action
--   ถ้ามีรอบแก้ไขแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 1. คอลัมน์/constraint ใหม่ของตารางเดิม --------------------------------------------------
alter table public.itwo_work_orders
  add column misc_detail text check (misc_detail is null or (btrim(misc_detail) <> '' and char_length(misc_detail) <= 200));
alter table public.itwo_work_orders
  add constraint itwo_work_orders_misc_detail_only_misc check (misc_detail is null or request_type = 'misc');
comment on column public.itwo_work_orders.misc_detail is
  'ระบุว่าเป็นงานเบ็ดเตล็ดอะไร (บังคับเมื่อ request_type = misc ที่ RPC + trigger ก่อน INSERT) ประเภทอื่นเป็น null';

-- ประเภท "เบ็ดเตล็ด" ต้องระบุงาน และไม่รับ system_access สำหรับใบใหม่ (ตรวจเฉพาะ INSERT: ใบเดิมที่ไม่มี misc_detail ยังเปลี่ยนสถานะได้)
create or replace function private.itwo_work_order_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.request_type = 'system_access' then
    raise exception 'ใบสั่งงาน IT ไม่รับประเภท "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)' using errcode = 'check_violation';
  end if;
  if new.request_type = 'misc' and new.misc_detail is null then
    raise exception 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itwo_work_order_insert_guard() from public, anon, authenticated;
create trigger itwo_work_orders_insert_guard before insert on public.itwo_work_orders
  for each row execute function private.itwo_work_order_insert_guard();

-- events: เพิ่ม rework_requested (ไม่ใส่ "if exists" ตั้งใจ: ถ้าชื่อไม่ตรง migration ต้องล้ม ไม่ใช่ข้ามเงียบ ๆ)
alter table public.itwo_events drop constraint itwo_events_action_check;
alter table public.itwo_events add constraint itwo_events_action_check check (action in (
  'created', 'dept_approved', 'dept_rejected', 'it_mgr_approved', 'it_mgr_rejected',
  'cancelled', 'started', 'completed', 'received', 'rework_requested'));

-- guard ใบสั่งงาน: คอลัมน์ใหม่ห้ามแก้ + it_closed -> in_progress (ขอแก้ไขงาน)
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
      new.needed_date, new.is_urgent, new.created_at, new.misc_detail)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.department_id,
      old.request_type, old.order_ref, old.attachment_flag, old.attachment_note, old.details,
      old.needed_date, old.is_urgent, old.created_at, old.misc_detail) then
    raise exception 'ใบสั่งงานแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled'))
    -- it_closed -> in_progress = ผู้แจ้งขอแก้ไขงาน (ผ่าน app_itwo_request_rework เท่านั้น) · received / rejected / cancelled เปิดใหม่ไม่ได้
    or (old.status = 'it_closed' and new.status in ('received', 'in_progress'))
  ) then
    raise exception 'เปลี่ยนสถานะใบสั่งงานจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- การรับงานเป็นขั้นสุดท้ายเสมอ: ใบที่ IT เคยปิดงานแล้ว (มี completed) ยกเลิกไม่ได้ (ต้องขอแก้ไขงานหรือรับงานเท่านั้น)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
       select 1 from public.itwo_events e where e.work_order_id = old.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itwo_work_order_guard() from public, anon, authenticated;

-- 2. ตารางใหม่ ----------------------------------------------------------------------------
-- รอบขอแก้ไขงาน (เพิ่มได้อย่างเดียว) round_no 1,2,3… ต่อใบ ไม่จำกัดจำนวนรอบ
create table public.itwo_reworks (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  work_order_id uuid not null,
  round_no integer not null check (round_no >= 1),
  details text not null check (btrim(details) <> '' and char_length(details) <= 2000),
  due_date date not null,
  requested_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (work_order_id, is_test) references public.itwo_work_orders (id, is_test),
  unique (work_order_id, round_no),
  -- ให้ไฟล์แนบอ้างรอบแก้ไขพร้อมใบเดียวกันได้ (กันแนบรอบของใบอื่น)
  unique (id, work_order_id)
);
create index itwo_reworks_requested_by_idx on public.itwo_reworks (requested_by);
comment on table public.itwo_reworks is
  'รอบขอแก้ไขงานของใบสั่งงาน IT · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itwo_request_rework เท่านั้น';

-- ทะเบียนไฟล์แนบ (เพิ่มได้อย่างเดียว) rework_id ว่าง = แนบตอนแจ้ง · ตัวไฟล์อยู่ใน Storage (บัคเก็ตตามโหมดของใบ)
create table public.itwo_attachments (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  work_order_id uuid not null,
  rework_id uuid,
  storage_path text not null unique,
  file_name text not null check (btrim(file_name) <> '' and char_length(file_name) <= 200),
  mime_type text not null check (char_length(mime_type) between 1 and 100),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  uploaded_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (work_order_id, is_test) references public.itwo_work_orders (id, is_test),
  -- MATCH SIMPLE: rework_id ว่าง = ไม่ตรวจ · ไม่ว่าง = ต้องเป็นรอบของใบเดียวกัน
  foreign key (rework_id, work_order_id) references public.itwo_reworks (id, work_order_id),
  -- ไฟล์ต้องอยู่ใต้โฟลเดอร์ของใบสั่งงานตัวเองเสมอ
  constraint itwo_attachments_path_in_order_folder check (starts_with(storage_path, work_order_id::text || '/'))
);
create index itwo_attachments_wo_idx on public.itwo_attachments (work_order_id, is_test, created_at);
create index itwo_attachments_rework_idx on public.itwo_attachments (rework_id) where rework_id is not null;
create index itwo_attachments_uploaded_by_idx on public.itwo_attachments (uploaded_by);
comment on table public.itwo_attachments is
  'ทะเบียนไฟล์แนบของใบสั่งงาน IT · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itwo_add_attachment เท่านั้น';

-- 3. ปิดการเข้าถึงตรง + ด่าน lab-only (เหมือนตาราง itwo เดิม) --------------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['itwo_reworks', 'itwo_attachments'] loop
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
    execute format('select private.lab_only_guard_table(%L)', 'public.' || v_table);
  end loop;
end $$;

-- 4. trigger: โหมดทดสอบ + เพิ่มได้อย่างเดียว -------------------------------------------------
create trigger itwo_reworks_sandbox_scope before insert or update or delete on public.itwo_reworks
  for each row execute function private.sandbox_row_scope();
create trigger itwo_attachments_sandbox_scope before insert or update or delete on public.itwo_attachments
  for each row execute function private.sandbox_row_scope();

create trigger itwo_reworks_append_only before update or delete on public.itwo_reworks
  for each row execute function private.itwo_append_only_guard();
create trigger itwo_reworks_no_truncate before truncate on public.itwo_reworks
  for each statement execute function private.itwo_append_only_guard();
create trigger itwo_attachments_append_only before update or delete on public.itwo_attachments
  for each row execute function private.itwo_append_only_guard();
create trigger itwo_attachments_no_truncate before truncate on public.itwo_attachments
  for each statement execute function private.itwo_append_only_guard();

-- 5. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- คัดจากนิยามล่าสุดใน 20261202010000_bom_sr_rod_store.sql ครบทุกชื่อ เพิ่มเฉพาะ itwo_reworks, itwo_attachments (ยังต่อด้วย to_regclass เหมือนเดิม)
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
                                      'itwo_reworks','itwo_attachments']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 6. ตัวช่วยภายใน (private) ----------------------------------------------------------------
-- หน้าต่างเวลาแนบไฟล์หลังสร้างใบ/รอบแก้ไข (ที่เดียว ใช้ทั้ง policy ของ Storage และ RPC) · stable ไม่ใช่ immutable เพื่อให้ pgTAP แทนค่าได้
create or replace function private.itwo_attach_window()
returns interval
language sql
stable
security definer
set search_path = ''
as $$ select interval '30 minutes' $$;
revoke all on function private.itwo_attach_window() from public, anon, authenticated;

-- ชนิดไฟล์ที่รับ (ใช้ทั้งตอนสร้างบัคเก็ตและตอนลงทะเบียน)
create or replace function private.itwo_allowed_mime_types()
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
revoke all on function private.itwo_allowed_mime_types() from public, anon, authenticated;

-- ถอด id ใบสั่งงานจาก path ของไฟล์ · รูปแบบต้องเป็น <uuid>/<uuid>.<นามสกุลพิมพ์เล็ก> ไม่ตรง = null
-- (บังคับชื่อไฟล์เป็น uuid กัน path แปลก/ซ้อนโฟลเดอร์ · ชื่อเดิมเก็บในตาราง)
create or replace function private.itwo_file_path_order_id(p_name text)
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
revoke all on function private.itwo_file_path_order_id(text) from public, anon, authenticated;

-- นามสกุลท้าย path ต้องตรงกับ mimetype (ตารางจับคู่เดียว: รูป/PDF/Office ใหม่-เก่า/txt/csv · ไม่มี .ppt)
create or replace function private.itwo_ext_matches_mime(p_name text, p_mime text)
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
revoke all on function private.itwo_ext_matches_mime(text, text) from public, anon, authenticated;

-- ผู้ทำรายการแบบไม่ raise (ให้ policy ของ Storage ตอบ "ไม่ได้" แทน error) · id ว่าง = ไม่มี
create or replace function private.itwo_actor_quiet()
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
revoke all on function private.itwo_actor_quiet() from public, anon, authenticated;

-- ใบนี้มีการอนุมัติจริงจากผู้อื่นแล้วหรือยัง (ปิดการแนบทันทีที่มีคนอนุมัติ) · การอนุมัติอัตโนมัติตอนแจ้งเอง (ผู้แจ้ง = ผู้ทำ) ไม่นับ
create or replace function private.itwo_has_real_approval(p_work_order_id uuid, p_requester_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.itwo_events e
    where e.work_order_id = p_work_order_id
      and e.action in ('dept_approved', 'it_mgr_approved')
      and e.actor_id <> p_requester_id
  )
$$;
revoke all on function private.itwo_has_real_approval(uuid, uuid) from public, anon, authenticated;

-- หน้าต่างแนบ "ตอนแจ้ง" เปิดอยู่ไหม (ไม่ดูว่าใครเป็นผู้เรียก)
create or replace function private.itwo_initial_attach_open(p_wo public.itwo_work_orders)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_wo.attachment_flag = 'yes'
    and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress')
    and now() - p_wo.created_at <= private.itwo_attach_window()
    and not private.itwo_has_real_approval(p_wo.id, p_wo.requester_id)
$$;
revoke all on function private.itwo_initial_attach_open(public.itwo_work_orders) from public, anon, authenticated;

-- หน้าต่างแนบ "รอบขอแก้ไข" เปิดอยู่ไหม: รอบล่าสุดของใบ สร้างโดยผู้แจ้ง ภายในหน้าต่างเวลา ใบยังไม่จบ (p_rework_id ว่าง = รอบล่าสุดรอบใดก็ได้)
create or replace function private.itwo_rework_attach_open(p_wo public.itwo_work_orders, p_rework_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_wo.status in ('in_progress', 'it_closed')
    and exists (
      select 1 from public.itwo_reworks r
      where r.work_order_id = p_wo.id
        and (p_rework_id is null or r.id = p_rework_id)
        and r.requested_by = p_wo.requester_id
        and r.round_no = (select max(x.round_no) from public.itwo_reworks x where x.work_order_id = p_wo.id)
        and now() - r.created_at <= private.itwo_attach_window()
    )
$$;
revoke all on function private.itwo_rework_attach_open(public.itwo_work_orders, uuid) from public, anon, authenticated;

-- 7. Storage: บัคเก็ต + policy ------------------------------------------------------------
-- on conflict do update: ถ้ามีคนสร้างไว้เองใน Dashboard ให้ตั้งค่ากลับเป็นตามที่กำหนดเสมอ (private เสมอ)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('itwo-files', 'itwo-files', false, 20971520, private.itwo_allowed_mime_types()),
  ('itwo-test-files', 'itwo-test-files', false, 20971520, private.itwo_allowed_mime_types())
on conflict (id) do update set public = false,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ฟังก์ชันตัดสินของ policy (เรียกด้วยสิทธิ์ผู้ใช้จึงต้อง grant ให้ authenticated · ตัวฟังก์ชันเป็น SECURITY DEFINER คืนแค่ true/false ตามสิทธิ์ของผู้เรียกเอง)
-- อ่านได้: ผู้ที่ itwo_can_view ใบนั้น (ผู้แจ้ง / ทีม IT / ผู้อนุมัติแผนก) ใบต้องอยู่โหมดเดียวกับบัคเก็ต (ของจริง/ทดสอบ) และกับผู้เรียก
create or replace function private.itwo_storage_can_read(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wo public.itwo_work_orders%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itwo_file_path_order_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itwo_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_wo from public.itwo_work_orders w where w.id = v_id;
  return v_wo.id is not null and v_wo.is_test = p_is_test and private.itwo_can_view(v_wo, v_actor);
end;
$$;
revoke all on function private.itwo_storage_can_read(text, boolean) from public, anon;
grant execute on function private.itwo_storage_can_read(text, boolean) to authenticated;

-- อัปโหลดได้: ผู้แจ้งของใบนั้นเท่านั้น ขณะหน้าต่างแนบ (ตอนแจ้ง หรือรอบแก้ไขล่าสุด) เปิดอยู่ · ไฟล์ในโฟลเดอร์ของใบไม่เกินเพดานกัน spam
--   (เพดานจริง 10 ไฟล์ต่อครั้งบังคับที่ app_itwo_add_attachment ตรงนี้เผื่ออัปโหลดแล้วลงทะเบียนไม่สำเร็จ: 20 ไฟล์ต่อ 1 + จำนวนรอบแก้ไข)
create or replace function private.itwo_storage_can_upload(p_name text, p_is_test boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_wo public.itwo_work_orders%rowtype;
  v_actor public.employees%rowtype;
  v_id uuid := private.itwo_file_path_order_id(p_name);
begin
  if v_id is null then
    return false;
  end if;
  v_actor := private.itwo_actor_quiet();
  if v_actor.id is null then
    return false;
  end if;
  select * into v_wo from public.itwo_work_orders w where w.id = v_id;
  if v_wo.id is null or v_wo.is_test <> p_is_test or v_actor.is_test <> p_is_test or v_wo.requester_id <> v_actor.id then
    return false;
  end if;
  if not (private.itwo_initial_attach_open(v_wo) or private.itwo_rework_attach_open(v_wo, null)) then
    return false;
  end if;
  return (
    select count(*) from storage.objects o
    where o.bucket_id = case when p_is_test then 'itwo-test-files' else 'itwo-files' end
      and starts_with(o.name, v_id::text || '/')
  ) < 20 * (1 + (select count(*) from public.itwo_reworks r where r.work_order_id = v_id));
end;
$$;
revoke all on function private.itwo_storage_can_upload(text, boolean) from public, anon;
grant execute on function private.itwo_storage_can_upload(text, boolean) to authenticated;

-- ไฟล์ในบัคเก็ตทดสอบที่ลบ/อ่านเพื่อเก็บกวาดได้: admin ที่อยู่ในโหมดทดสอบ และไฟล์นั้นไม่มีแถวทะเบียน itwo_attachments อ้างถึง
--   (ไฟล์ที่ลงทะเบียนแล้วต้องรอ app_sandbox_purge_itwo ลบแถวทะเบียนก่อน แล้วหน้าเว็บลบไฟล์ตามรายการ path ที่ purge คืนมา)
create or replace function private.itwo_storage_test_file_removable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.sandbox_persona()).id is not null
    and not exists (select 1 from public.itwo_attachments a where a.storage_path = p_name)
$$;
revoke all on function private.itwo_storage_test_file_removable(text) from public, anon;
grant execute on function private.itwo_storage_test_file_removable(text) to authenticated;

-- policy ไม่มี UPDATE (เขียนทับ/upsert ไม่ได้) และบัคเก็ตจริงไม่มี DELETE (ISO: ไฟล์ที่อัปโหลดแต่ลงทะเบียนไม่สำเร็จค้างได้ ยอมรับ)
create policy itwo_files_read on storage.objects for select to authenticated
using (bucket_id = 'itwo-files' and private.itwo_storage_can_read(name, false));
create policy itwo_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itwo-files' and owner_id = (select auth.uid())::text
  and private.itwo_storage_can_upload(name, false));

create policy itwo_test_files_read on storage.objects for select to authenticated
using (bucket_id = 'itwo-test-files'
  and (private.itwo_storage_can_read(name, true) or private.itwo_storage_test_file_removable(name)));
create policy itwo_test_files_upload on storage.objects for insert to authenticated
with check (bucket_id = 'itwo-test-files' and owner_id = (select auth.uid())::text
  and private.itwo_storage_can_upload(name, true));
create policy itwo_test_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'itwo-test-files' and private.itwo_storage_test_file_removable(name));

-- 8. สิทธิ์การกระทำที่ทำได้กับใบ: ตัด edit_access เพิ่ม request_rework -------------------------
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

  -- ยกเลิกได้ก่อน IT ปิดงานครั้งแรกเท่านั้น: ใบที่เคยมี completed (แม้อยู่ในรอบแก้ไข) ไม่ส่ง cancel (การรับงานเป็นขั้นสุดท้าย)
  if p_wo.requester_id = p_actor.id and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress')
     and not exists (select 1 from public.itwo_events e where e.work_order_id = p_wo.id and e.action = 'completed') then
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
    -- ปิดงานได้เมื่ออนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนและงานที่ขอแก้ไขก็เช่นกัน)
    if (select s.dept_done and s.it_done from private.itwo_event_state(p_wo.id) s) then
      v_actions := array_append(v_actions, 'complete');
    end if;
  end if;

  -- IT ปิดงานแล้ว: ผู้แจ้งเลือกได้ว่ารับงาน หรือขอแก้ไขงาน (ไม่จำกัดจำนวนรอบ)
  if p_wo.requester_id = p_actor.id and p_wo.status = 'it_closed' then
    v_actions := array_append(v_actions, 'receive');
    v_actions := array_append(v_actions, 'request_rework');
  end if;
  return v_actions;
end;
$$;
revoke all on function private.itwo_allowed_actions(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- 8.1 RPC: ยกเลิก (ผู้แจ้ง) — เพิ่มกติกา: ใบที่ IT เคยปิดงานแล้วอย่างน้อยครั้งหนึ่งยกเลิกไม่ได้ (เจ้าของตัดสิน: การรับงานเป็นขั้นตอนสุดท้ายเสมอ)
--   ต่างจากเดิมเฉพาะข้อความตอน it_closed และการตรวจ completed ของสถานะ in_progress (ใบที่อยู่ในรอบขอแก้ไขงาน) · ส่วนอื่นเหมือนเดิมทุกอย่าง
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
      when 'it_closed' then 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน'
      when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;
  -- อยู่ in_progress เพราะขอแก้ไขงานหลัง IT ปิดงานแล้ว: ยกเลิกไม่ได้เช่นกัน (ตรวจก่อนเหตุผล เพื่อให้ได้ข้อความนี้เสมอ)
  if exists (select 1 from public.itwo_events e where e.work_order_id = v_wo.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
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

-- 9. RPC: แจ้งงานใหม่ (เพิ่ม p_misc_detail · ไม่รับ system_access) -----------------------------
drop function public.app_itwo_create(text, text, text, text, text, date, boolean);
create or replace function public.app_itwo_create(
  p_request_type text,
  p_order_ref text,
  p_attachment_flag text,
  p_attachment_note text,
  p_details text,
  p_needed_date date,
  p_is_urgent boolean,
  p_misc_detail text default null
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
  v_misc_detail text := private.itwo_clean(p_misc_detail);
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
  if p_request_type = 'system_access' then
    raise exception 'ใบสั่งงาน IT ไม่รับประเภท "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)' using errcode = 'check_violation';
  end if;
  if p_request_type = 'misc' then
    if v_misc_detail is null then
      raise exception 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร' using errcode = 'check_violation';
    end if;
    if char_length(v_misc_detail) > 200 then
      raise exception 'งานเบ็ดเตล็ดต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- ประเภทอื่นไม่เก็บ ล้างทิ้งกันข้อมูลตกค้าง
    v_misc_detail := null;
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
    request_type, misc_detail, order_ref, attachment_flag, attachment_note, details, needed_date, is_urgent, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    p_request_type, v_misc_detail, v_order_ref, p_attachment_flag, v_attach_note, v_details, p_needed_date, v_is_urgent, v_status
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

-- 10. RPC: ส่วน "สิทธิ์ในระบบ" ถูกถอดออกจากใบสั่งงาน — ปฏิเสธการบันทึกใหม่ทุกครั้ง ----------------
-- (ผู้ที่ไม่ใช่ผู้ดูแลงาน IT ยังได้ข้อความไม่มีสิทธิ์เหมือนเดิม · ข้อมูลเดิมใน itwo_access_changes ไม่ถูกแตะ)
create or replace function public.app_itwo_save_access_changes(p_work_order_id uuid, p_changes jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกส่วนสำหรับแผนก IT ได้' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ส่วนสิทธิ์ในระบบถูกถอดออกจากใบสั่งงาน IT แล้ว (จะแยกเป็นโมดูลขอสิทธิ์ต่างหาก) บันทึกเพิ่มไม่ได้' using errcode = 'check_violation';
end;
$$;

-- 11. RPC: ขอแก้ไขงาน (ผู้แจ้ง, สถานะ it_closed) ------------------------------------------------
-- สถานะกลับเป็น in_progress ทันที ไม่ต้องอนุมัติใหม่ · IT ปิดงานใหม่ได้ตามเดิม · ผู้แจ้งรับงานหรือขอแก้อีกได้ไม่จำกัดครั้ง
-- คืน id/เลขรอบของรอบแก้ไข (หน้าเว็บใช้ id นี้เป็น p_rework_id ตอนแนบไฟล์ของรอบนั้น)
create or replace function public.app_itwo_request_rework(p_work_order_id uuid, p_details text, p_due_date date)
returns table (id uuid, round_no integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
  v_details text := private.itwo_clean(p_details);
  v_today_th date := (now() at time zone 'Asia/Bangkok')::date;
  v_round integer;
  v_rework_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status <> 'it_closed' then
    raise exception '%', case v_wo.status
      when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ขอแก้ไขไม่ได้'
      when 'cancelled' then private.itwo_status_message(v_wo.status)
      when 'rejected' then private.itwo_status_message(v_wo.status)
      else 'ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น'
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
  select coalesce(max(r.round_no), 0) + 1 into v_round from public.itwo_reworks r where r.work_order_id = v_wo.id;

  update public.itwo_work_orders w set status = 'in_progress' where w.id = v_wo.id;
  insert into public.itwo_reworks (is_test, work_order_id, round_no, details, due_date, requested_by)
  values (v_wo.is_test, v_wo.id, v_round, v_details, p_due_date, v_actor.id)
  returning itwo_reworks.id into v_rework_id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'rework_requested',
          'ขอแก้ไขงานรอบที่ ' || v_round || ' ต้องการภายใน ' || to_char(p_due_date, 'DD/MM/YYYY') || ': ' || left(v_details, 300));

  id := v_rework_id;
  round_no := v_round;
  return next;
end;
$$;

-- 12. RPC: ลงทะเบียนไฟล์แนบที่อัปโหลดขึ้น Storage แล้ว --------------------------------------------
-- คืน id ทะเบียน · เรียกซ้ำด้วย path เดิม (ของใบ/รอบเดียวกัน) = คืน id เดิม (ปลอดภัยเวลาลองใหม่หลังเน็ตหลุด)
-- ขนาด/ชนิดไฟล์ใช้ค่าจาก Storage เป็นหลัก (ผู้ใช้โกหกไม่ได้) ค่าที่ส่งมาใช้สำรองเท่านั้น · lock แถวใบก่อนนับ จึงกดพร้อมกันก็เกิน 10 ไฟล์ไม่ได้
create or replace function public.app_itwo_add_attachment(
  p_work_order_id uuid,
  p_rework_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_size_bytes bigint
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
  v_file_name text := private.itwo_clean(p_file_name);
  v_existing public.itwo_attachments%rowtype;
  v_object storage.objects%rowtype;
  v_mime text;
  v_size bigint;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบสั่งงานได้' using errcode = 'insufficient_privilege';
  end if;

  -- path ต้องอยู่ใต้โฟลเดอร์ของใบนี้ และรูปแบบถูกต้อง
  if p_storage_path is null or private.itwo_file_path_order_id(p_storage_path) is distinct from v_wo.id then
    raise exception 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_file_name is null then
    raise exception 'กรุณาระบุชื่อไฟล์' using errcode = 'check_violation';
  end if;
  if char_length(v_file_name) > 200 then
    raise exception 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของใบ/รอบเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม
  select * into v_existing from public.itwo_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.work_order_id = v_wo.id and v_existing.rework_id is not distinct from p_rework_id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if p_rework_id is null then
    -- (1) แนบตอนแจ้ง
    if v_wo.attachment_flag <> 'yes' then
      raise exception 'ใบสั่งงานนี้ไม่ได้เลือกเอกสารแนบเป็น "มี" จึงแนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
      raise exception 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if now() - v_wo.created_at > private.itwo_attach_window() then
      raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)' using errcode = 'check_violation';
    end if;
    if private.itwo_has_real_approval(v_wo.id, v_wo.requester_id) then
      raise exception 'มีผู้อนุมัติใบสั่งงานนี้แล้ว แนบไฟล์เพิ่มไม่ได้' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.itwo_attachments a where a.work_order_id = v_wo.id and a.rework_id is null) >= 10 then
      raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง' using errcode = 'check_violation';
    end if;
  else
    -- (2) แนบตอนขอแก้ไขงาน: รอบล่าสุดของใบนี้ที่ผู้แจ้งเพิ่งสร้าง
    if not exists (select 1 from public.itwo_reworks r where r.id = p_rework_id and r.work_order_id = v_wo.id) then
      raise exception 'ไม่พบรอบขอแก้ไขงานนี้' using errcode = 'check_violation';
    end if;
    if v_wo.status not in ('in_progress', 'it_closed') then
      raise exception 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if not exists (
         select 1 from public.itwo_reworks r
         where r.id = p_rework_id and r.requested_by = v_actor.id
           and r.round_no = (select max(x.round_no) from public.itwo_reworks x where x.work_order_id = v_wo.id)) then
      raise exception 'แนบไฟล์ได้เฉพาะรอบขอแก้ไขงานล่าสุดของคุณ' using errcode = 'check_violation';
    end if;
    if not private.itwo_rework_attach_open(v_wo, p_rework_id) then
      raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังขอแก้ไขงาน)' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.itwo_attachments a where a.rework_id = p_rework_id) >= 10 then
      raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง' using errcode = 'check_violation';
    end if;
  end if;

  -- ไฟล์ต้องอยู่ใน Storage จริง ในบัคเก็ตตามโหมดของใบ และผู้เรียกเป็นคนอัปโหลดเอง
  select * into v_object
  from storage.objects o
  where o.bucket_id = case when v_wo.is_test then 'itwo-test-files' else 'itwo-files' end
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
  if v_mime <> all (private.itwo_allowed_mime_types()) then
    raise exception 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)' using errcode = 'check_violation';
  end if;
  -- นามสกุลใน path ต้องตรงกับชนิดไฟล์ (กันตั้งนามสกุลหลอก เช่น .pdf แต่ชนิดเป็นรูป)
  if not private.itwo_ext_matches_mime(p_storage_path, v_mime) then
    raise exception 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if v_size <= 0 or v_size > 20971520 then
    raise exception 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB' using errcode = 'check_violation';
  end if;

  insert into public.itwo_attachments (is_test, work_order_id, rework_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_wo.is_test, v_wo.id, p_rework_id, p_storage_path, v_file_name, v_mime, v_size, v_actor.id)
  returning itwo_attachments.id into v_id;
  return v_id;
end;
$$;

-- 13. RPC อ่าน: รายละเอียดใบ + รายการใบ -----------------------------------------------------------
-- เพิ่มจากเดิม: misc_detail, rework_round, latest_due_date (วันที่ต้องการล่าสุด = รอบแก้ไขล่าสุด ถ้าไม่มีรอบ = needed_date), reworks[], attachments[]
--   attachments[] เป็นรายการเดียว แต่ละไฟล์บอก rework_id / round_no (0 = ไฟล์ตอนแจ้ง) และ bucket ที่ต้องใช้ดาวน์โหลด (หน้าเว็บจัดกลุ่มตามรอบเอง)
--   access_changes ยังส่งข้อมูลเดิมได้ (ใบเก่า) แต่ไม่มีการบันทึกใหม่แล้ว
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
    'misc_detail', v_wo.misc_detail,
    'order_ref', v_wo.order_ref,
    'attachment_flag', v_wo.attachment_flag,
    'attachment_note', v_wo.attachment_note,
    'details', v_wo.details,
    'needed_date', v_wo.needed_date,
    'is_urgent', v_wo.is_urgent,
    'status', v_wo.status,
    'created_at', v_wo.created_at,
    'rework_round', (select coalesce(max(r.round_no), 0) from public.itwo_reworks r where r.work_order_id = v_wo.id),
    'latest_due_date', coalesce(
      (select r.due_date from public.itwo_reworks r where r.work_order_id = v_wo.id order by r.round_no desc limit 1),
      v_wo.needed_date),
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
      from public.itwo_reworks rw
      join public.employees a on a.id = rw.requested_by
      where rw.work_order_id = v_wo.id),
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'rework_id', att.rework_id,
               'round_no', coalesce(rw.round_no, 0),
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itwo-test-files' else 'itwo-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by coalesce(rw.round_no, 0), att.created_at, att.id), '[]'::jsonb)
      from public.itwo_attachments att
      join public.employees a on a.id = att.uploaded_by
      left join public.itwo_reworks rw on rw.id = att.rework_id
      where att.work_order_id = v_wo.id),
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

-- ผลลัพธ์ของ list เพิ่มคอลัมน์ จึงต้อง drop แล้วสร้างใหม่ (grant ตั้งใหม่ท้ายไฟล์)
drop function public.app_itwo_list_mine();
drop function public.app_itwo_list_pending_approvals();
drop function public.app_itwo_list_it();

-- ใบของฉัน (ผู้แจ้ง = ผู้เรียก) · rework_round 0 = ไม่เคยขอแก้ไข
create or replace function public.app_itwo_list_mine()
returns table (
  id uuid,
  doc_no text,
  status text,
  is_urgent boolean,
  request_type text,
  details text,
  needed_date date,
  created_at timestamptz,
  misc_detail text,
  rework_round integer,
  rework_due_date date
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
  select wo.id, wo.doc_no, wo.status, wo.is_urgent, wo.request_type, wo.details, wo.needed_date, wo.created_at,
         wo.misc_detail, coalesce(rw.round_no, 0), rw.due_date
  from public.itwo_work_orders wo
  left join lateral (
    select r.round_no, r.due_date from public.itwo_reworks r
    where r.work_order_id = wo.id order by r.round_no desc limit 1
  ) rw on true
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
  pending_step text,
  misc_detail text
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
         case when caps.can_it then 'it_mgr' else 'dept' end,
         wo.misc_detail
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

-- ทุกใบสำหรับหน้างาน IT (เฉพาะผู้อยู่ใน itwo_staff) เรียง: งานด่วนก่อน แล้ววันที่ต้องการ (ใบที่ขอแก้ไขใช้วันที่ของรอบล่าสุด) แล้วเวลาที่แจ้ง
-- rework_round > 0 = งานแก้ไขรอบที่ N และ rework_due_date = กำหนดเสร็จของรอบนั้น
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
  has_it_mgr_approved boolean,
  misc_detail text,
  rework_round integer,
  rework_due_date date
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
         exists (select 1 from public.itwo_events ev where ev.work_order_id = wo.id and ev.action = 'it_mgr_approved'),
         wo.misc_detail, coalesce(rw.round_no, 0), rw.due_date
  from public.itwo_work_orders wo
  join public.departments d on d.id = wo.department_id
  join public.employees req on req.id = wo.requester_id
  left join lateral (
    select r.round_no, r.due_date from public.itwo_reworks r
    where r.work_order_id = wo.id order by r.round_no desc limit 1
  ) rw on true
  where wo.is_test = v_actor.is_test
  order by wo.is_urgent desc, coalesce(rw.due_date, wo.needed_date), wo.created_at, wo.doc_year, wo.doc_seq;
end;
$$;

-- 14. ล้างข้อมูลทดสอบ: เพิ่มตารางใหม่ + คืนรายการไฟล์ที่ต้องลบผ่าน Storage API -------------------------
-- ลบเฉพาะแถว is_test ของตารางโมดูลทั้งหมด (รวมประวัติ) และเริ่มนับเลข TEST-… ใหม่ · ข้อมูลจริงไม่ถูกแตะ
-- files = path ของ "ทุกไฟล์" ในบัคเก็ต itwo-test-files หลังล้างแถวทะเบียนแล้ว (รวมไฟล์ที่อัปโหลดแต่ไม่ได้ลงทะเบียน)
--   หน้าเว็บต้องลบไฟล์เหล่านี้ผ่าน Storage API ต่อ (ลบด้วย SQL ไม่ได้: trigger ของ Storage กัน และไฟล์จริงจะค้างใน S3)
--   ถ้าลบไม่ครบ เรียก purge ซ้ำได้ จะได้รายการที่เหลือ · ต้องเป็น admin จริงและอยู่ในโหมดทดสอบ (เหมือน app_sandbox_purge_bom)
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
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> ส่วนสิทธิ์/รอบแก้ไข/ไฟล์แนบ -> ประวัติ -> admin_log) กัน deadlock
  lock table public.itwo_doc_counters, public.itwo_work_orders, public.itwo_access_changes,
             public.itwo_reworks, public.itwo_attachments,
             public.itwo_events, public.itwo_admin_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itwo.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itwo.purge', 'on', true);

  -- ลูกก่อนแม่: ไฟล์แนบ (อ้างรอบแก้ไขและใบ) -> รอบแก้ไข -> ... -> ใบ
  foreach v_table in array array['itwo_events', 'itwo_access_changes', 'itwo_attachments', 'itwo_reworks',
                                 'itwo_admin_log', 'itwo_work_orders', 'itwo_doc_counters'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform set_config('itwo.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select coalesce(array_agg(o.name order by o.name), '{}'::text[]) into v_files
  from storage.objects o where o.bucket_id = 'itwo-test-files';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITWO_SANDBOX_PURGE', 'itwo_work_orders', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'files_to_remove', cardinality(v_files)));
  return jsonb_build_object('deleted', v_deleted, 'files', to_jsonb(v_files));
end;
$$;

-- 15. สิทธิ์เรียกฟังก์ชัน: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจพนักงานและบทบาทซ้ำอีกชั้น) anon เรียกไม่ได้ ------
-- รันซ้ำทั้งชุด: ฟังก์ชันที่ drop แล้วสร้างใหม่ได้สิทธิ์เริ่มต้นของ Postgres (PUBLIC execute) กลับมา ต้องถอนใหม่
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
