-- ============================================================================
-- ใบสั่งงาน IT รุ่น 3 — "ถามกลับผู้แจ้ง" (ขอข้อมูลเพิ่ม) ส่วนฐานข้อมูล (ตามที่เจ้าของสั่ง 19/11/2026)
--   A. ก่อนอนุมัติ: ผู้อนุมัติของขั้นที่ใบรออยู่ (ผู้จัดการ/ผู้ช่วยผู้จัดการแผนก ขั้นแผนก · ผู้อนุมัติขั้น IT ขั้น IT รวมกรณีกดครั้งเดียวนับสองขั้น)
--      กด "ถามผู้แจ้ง" พร้อมข้อความ (บังคับ ≤2000) + แนบไฟล์ได้ ≤10 -> ใบไปสถานะใหม่ need_info (รอผู้แจ้งตอบ)
--      -> ผู้แจ้งตอบ (ข้อความบังคับ ≤2000 + ไฟล์ ≤10) -> ใบกลับไปสถานะเดิม (pending_dept / pending_it_mgr) ให้ผู้อนุมัติตัดสินต่อ
--      ถามซ้ำได้หลายรอบ (ทีละ 1 คำถามที่ค้าง)
--      เพิ่มเติม (ตัดสินเอง, ตามหลักเดียวกับ "ผู้ที่กดอนุมัติ/ไม่อนุมัติได้ย่อมถามได้"): งานด่วนที่ IT เริ่มแล้ว (in_progress) แต่ผู้จัดการยังไม่อนุมัติ
--      ผู้จัดการที่ยังมีสิทธิ์อนุมัติก็ถามได้ (กลับไป in_progress)
--   B. หลังอนุมัติ ระหว่าง IT ทำงาน: ผู้ดูแลงาน IT (itwo_staff.is_it_admin) ถามผู้แจ้งได้เมื่อใบ approved หรือ in_progress
--      (รวมงานด่วนที่เริ่มก่อนอนุมัติครบ และใบที่อยู่ในรอบแก้ไขงาน) -> need_info -> ผู้แจ้งตอบ -> กลับสถานะเดิม (approved / in_progress)
--   C. สถานะที่ต้องกลับไปเก็บในคอลัมน์ itwo_work_orders.info_return_status (CHECK: มีค่าเมื่อ need_info เท่านั้น) · guard การเปลี่ยนสถานะตรวจได้ชัด:
--        X -> need_info ต้องมาจาก pending_dept / pending_it_mgr / approved / in_progress และ info_return_status = X
--        need_info -> สถานะที่บันทึกไว้เท่านั้น (หรือ rejected / cancelled ดูข้อ D) และเคลียร์ info_return_status
--   D. ระหว่าง need_info (ตัดสินใจเอง):
--        - ผู้อนุมัติขั้นนั้น "ไม่อนุมัติ" ได้ (ต้องมีเหตุผลตามเดิม -> rejected) เพราะการรอคำตอบไม่ควรผูกมือผู้อนุมัติ · แต่ "อนุมัติ" ต้องรอคำตอบก่อน
--        - IT เริ่มงาน/ปิดงาน/บันทึกอื่น ๆ ไม่ได้ (RPC เดิมตรวจสถานะอยู่แล้ว ข้อความไทยบอกว่ารอผู้แจ้งตอบ)
--        - ผู้แจ้งยกเลิกได้ตามกติกาเดิม (ใบที่เคยมี event completed ยกเลิกไม่ได้เหมือนเดิม)
--   E. ตารางใหม่ itwo_comments (เพิ่มได้อย่างเดียว): id (identity = ลำดับจริง), is_test, work_order_id, kind question/answer, stage dept/it_mgr/it,
--      author_id, body (≤2000), reply_to (คำถามที่ตอบ), created_at · trigger ก่อน INSERT บังคับ: คำถามเขียนโดยคนที่ไม่ใช่ผู้แจ้งและห้ามมีคำถามค้าง
--      คำตอบเขียนโดยผู้แจ้งและตอบได้ครั้งเดียวต่อคำถาม (unique reply_to) · events ใหม่ info_requested / info_provided (reason = ข้อความย่อ)
--   F. RPC ใหม่: app_itwo_request_info(ใบ, ข้อความ) / app_itwo_provide_info(ใบ, ข้อความ) คืน {comment_id} ·
--      app_itwo_add_comment_attachment(ใบ, comment_id, path, ชื่อไฟล์, mime, ขนาด) แนบไฟล์ให้ข้อความ (คนเขียนข้อความนั้น ภายใน 30 นาที ≤10 ไฟล์ต่อข้อความ)
--      ลายเซ็น app_itwo_add_attachment เดิมไม่เปลี่ยน (หน้าเว็บรุ่น 2 บน production เรียกอยู่)
--   G. itwo_attachments เพิ่มคอลัมน์ comment_id (null = ไฟล์ตอนแจ้ง/รอบแก้ไข) · path ใช้รูปแบบเดิม <id ใบ>/<uuid>.<นามสกุล>
--      storage policy (itwo_storage_can_upload) อนุญาตผู้เขียนข้อความ (ผู้อนุมัติ/IT ที่ไม่ใช่ผู้แจ้ง) อัปโหลดเข้าโฟลเดอร์ของใบ
--      เมื่อมีข้อความของตัวเองที่หน้าต่าง 30 นาทีเปิดอยู่ และผู้นั้นยังดูใบนี้ได้ · อ่านไฟล์ใช้ itwo_can_view เดิม (ทุกคนที่เห็นใบเห็นไฟล์ในข้อความ)
--   H. การมองเห็น/รายการ: get_detail ส่ง comments[] (ผู้เขียน, stage, ไฟล์ของแต่ละข้อความ), info_pending (คำถามที่ค้าง), info_return_status ·
--      attachments[] เดิม "ไม่รวมไฟล์ของข้อความ" (กันหน้าเว็บรุ่น 2 เข้าใจว่าเป็นไฟล์ตอนแจ้ง) · allowed_actions เพิ่ม request_info / provide_info ·
--      list_mine / list_pending_approvals / list_it ส่ง info_return_status + info_stage · รออนุมัติแสดงใบ need_info ของขั้นฉันแต่ pending_count ไม่นับ
--   I. ล้างข้อมูลทดสอบลบ itwo_comments is_test ด้วย · sandbox_unguarded_tables เพิ่ม itwo_comments
--
-- ตารางใหม่ติดด่านเดิมครบ: RLS deny-all + ถอนสิทธิ์ anon/authenticated/service_role (รวม identity sequence) + ด่าน lab-only + trigger โหมดทดสอบ
--   (sandbox_row_scope) + เพิ่มได้อย่างเดียว (itwo_append_only_guard เดิม ยกเว้น purge แถว is_test)
--
-- นิยามที่ replace (เริ่มจากนิยามล่าสุดบน main ทุกตัว · ก่อน apply ที่ production เทียบ md5(pg_get_functiondef(oid)) กับต้นทางก่อน)
--   - private.sandbox_unguarded_tables()       จาก 20261205010000_itwo_v2_rework_files.sql (คงทุกชื่อเดิม เพิ่ม itwo_comments)
--   - private.itwo_status_message(text)        จาก 20261203010000 (เพิ่มข้อความ need_info)
--   - private.itwo_work_order_guard()          จาก 20261205010000
--   - private.itwo_approval_caps(uuid, uuid)   จาก 20261203010000 (v_open รวม need_info เพื่อให้ผู้อนุมัติ "ไม่อนุมัติ" ระหว่างรอได้)
--   - private.itwo_decide(uuid, boolean, text) จาก 20261203010000 (รับ need_info เฉพาะไม่อนุมัติ · เคลียร์ info_return_status)
--   - private.itwo_allowed_actions(...)        จาก 20261205010000
--   - private.itwo_initial_attach_open / private.itwo_rework_attach_open  จาก 20261205010000 (หน้าต่างแนบยังเปิดแม้ใบเข้า need_info)
--   - private.itwo_storage_can_upload(text, boolean) จาก 20261205010000
--   - public.app_itwo_cancel                   จาก 20261205010000 (ยกเลิกได้ตอน need_info)
--   - public.app_itwo_add_attachment           จาก 20261205010000 (ลายเซ็นเดิม: สถานะ need_info ผ่าน · ทะเบียนของข้อความไม่ถูกนับเป็นของใบ/รอบ)
--   - public.app_itwo_get_detail               จาก 20261205010000
--   - public.app_itwo_list_mine / list_pending_approvals / list_it  จาก 20261205010000 (คอลัมน์ผลลัพธ์เพิ่ม จึง drop แล้วสร้างใหม่)
--   - public.app_sandbox_purge_itwo            จาก 20261205010000
--   ไม่ replace app_itwo_pending_count: ตัวกรองสถานะเดิม (pending_dept / pending_it_mgr / in_progress) ไม่รวม need_info อยู่แล้ว = ไม่นับใบที่รอผู้แจ้งตอบ
--
-- ลำดับ deploy: หน้าเว็บรุ่น 3 เรียก RPC/คอลัมน์ใหม่ จึงต้อง apply ไฟล์นี้ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   หน้าเว็บรุ่น 2 + ฐานข้อมูลใหม่ (ช่วงก่อน merge หน้าเว็บรุ่น 3): ทำงานปกติ · ยังไม่มีใครกด "ถามผู้แจ้ง" (ไม่มีปุ่มในหน้าเว็บรุ่น 2)
--   จึงไม่มีใบ need_info ที่หน้าเก่าไม่รู้จัก · ถ้าเรียก RPC ตรง ๆ ใบ need_info จะแสดงสถานะดิบ และไฟล์ของข้อความไม่ปนในรายการไฟล์ตอนแจ้ง
--
-- Rollback (ถ้ายังไม่มีข้อมูลจริงของตารางใหม่): create or replace ฟังก์ชันที่ replace กลับด้วยนิยามต้นทางข้างบน · drop function app_itwo_request_info /
--   app_itwo_provide_info / app_itwo_add_comment_attachment + private.itwo_info_stage / itwo_pending_question / itwo_comment_attach_open /
--   itwo_read_stored_file / itwo_comments_guard · alter table itwo_attachments drop column comment_id · drop table itwo_comments ·
--   alter table itwo_work_orders drop column info_return_status + คืน CHECK ของ status · คืน CHECK ของ itwo_events.action
--   ถ้ามีข้อความถามตอบจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 1. คอลัมน์/constraint ใหม่ของตารางเดิม --------------------------------------------------
-- (ไม่ใส่ "if exists" ตั้งใจ: ถ้าชื่อ constraint ไม่ตรง migration ต้องล้ม ไม่ใช่ข้ามเงียบ ๆ)
alter table public.itwo_work_orders drop constraint itwo_work_orders_status_check;
alter table public.itwo_work_orders add constraint itwo_work_orders_status_check check (status in (
  'pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'it_closed', 'received', 'rejected', 'cancelled', 'need_info'));

-- สถานะที่ใบต้องกลับไปหลังผู้แจ้งตอบ (มีค่าเมื่อ need_info เท่านั้น) · เป็นส่วนของสถานะ ไม่ใช่เนื้อหาใบ (guard เปลี่ยนคู่กับ status เท่านั้น)
alter table public.itwo_work_orders add column info_return_status text;
alter table public.itwo_work_orders add constraint itwo_work_orders_info_return_status_check check (
  (status = 'need_info' and info_return_status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress'))
  or (status <> 'need_info' and info_return_status is null));
comment on column public.itwo_work_orders.info_return_status is
  'สถานะที่ใบต้องกลับไปหลังผู้แจ้งตอบคำถาม (มีค่าเมื่อ status = need_info เท่านั้น) · เปลี่ยนผ่าน app_itwo_request_info / app_itwo_provide_info เท่านั้น';

alter table public.itwo_events drop constraint itwo_events_action_check;
alter table public.itwo_events add constraint itwo_events_action_check check (action in (
  'created', 'dept_approved', 'dept_rejected', 'it_mgr_approved', 'it_mgr_rejected',
  'cancelled', 'started', 'completed', 'received', 'rework_requested', 'info_requested', 'info_provided'));

-- 2. ตารางใหม่ ----------------------------------------------------------------------------
-- คำถาม/คำตอบระหว่างผู้ถาม (ผู้อนุมัติ/IT) กับผู้แจ้ง (เพิ่มได้อย่างเดียว) id เป็น identity = ลำดับจริงของข้อความ
create table public.itwo_comments (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  work_order_id uuid not null,
  kind text not null check (kind in ('question', 'answer')),
  -- ขั้นที่ถาม: dept = ผู้จัดการ/ผู้ช่วยแผนก · it_mgr = ผู้อนุมัติขั้น IT · it = ผู้ดูแลงาน IT (หลังอนุมัติ) · คำตอบใช้ขั้นเดียวกับคำถามที่ตอบ
  stage text not null check (stage in ('dept', 'it_mgr', 'it')),
  author_id uuid not null references public.employees(id),
  body text not null check (btrim(body) <> '' and char_length(body) <= 2000),
  reply_to bigint,
  created_at timestamptz not null default now(),
  foreign key (work_order_id, is_test) references public.itwo_work_orders (id, is_test),
  -- ให้ไฟล์แนบและคำตอบอ้างข้อความของใบเดียวกันเท่านั้น
  unique (id, work_order_id),
  foreign key (reply_to, work_order_id) references public.itwo_comments (id, work_order_id),
  -- คำถามไม่มี reply_to · คำตอบต้องมี
  constraint itwo_comments_reply_kind check ((kind = 'question') = (reply_to is null))
);
-- คำถามหนึ่งข้อตอบได้ครั้งเดียว
create unique index itwo_comments_one_answer_idx on public.itwo_comments (reply_to) where reply_to is not null;
create index itwo_comments_wo_idx on public.itwo_comments (work_order_id, is_test, id);
create index itwo_comments_author_idx on public.itwo_comments (author_id);
comment on table public.itwo_comments is
  'คำถาม/คำตอบ "ถามกลับผู้แจ้ง" ของใบสั่งงาน IT · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itwo_request_info / app_itwo_provide_info เท่านั้น';

-- ไฟล์แนบของข้อความ: comment_id ว่าง = ไฟล์ตอนแจ้ง/รอบแก้ไขเดิม · ผูกได้อย่างใดอย่างหนึ่ง (รอบแก้ไข หรือ ข้อความ) ไม่ใช่ทั้งสอง
alter table public.itwo_attachments add column comment_id bigint;
alter table public.itwo_attachments add constraint itwo_attachments_comment_fk
  foreign key (comment_id, work_order_id) references public.itwo_comments (id, work_order_id);
alter table public.itwo_attachments add constraint itwo_attachments_one_owner check (rework_id is null or comment_id is null);
create index itwo_attachments_comment_idx on public.itwo_attachments (comment_id) where comment_id is not null;

-- 3. ปิดการเข้าถึงตรง + ด่าน lab-only (เหมือนตาราง itwo เดิม) --------------------------------
do $$
declare
  v_table text := 'itwo_comments';
  v_sequence text;
begin
  execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
  -- identity sequence ได้สิทธิ์ตาม default privileges ของ Supabase เช่นกัน ถอนด้วย (หาจาก pg_depend)
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
  execute format('select private.lab_only_guard_table(%L)', 'public.' || v_table);
end $$;

-- 4. trigger: โหมดทดสอบ + เพิ่มได้อย่างเดียว + กติกาของข้อความ ------------------------------------
create trigger itwo_comments_sandbox_scope before insert or update or delete on public.itwo_comments
  for each row execute function private.sandbox_row_scope();
create trigger itwo_comments_append_only before update or delete on public.itwo_comments
  for each row execute function private.itwo_append_only_guard();
create trigger itwo_comments_no_truncate before truncate on public.itwo_comments
  for each statement execute function private.itwo_append_only_guard();

-- กติกาของข้อความที่ฐานข้อมูลบังคับเอง (ชั้นซ้อนของ RPC): คำถามเขียนโดยคนที่ไม่ใช่ผู้แจ้งและห้ามมีคำถามค้าง ·
-- คำตอบเขียนโดยผู้แจ้ง อ้างคำถามจริงของใบเดียวกัน และใช้ขั้นเดียวกับคำถาม
create or replace function private.itwo_comments_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_question public.itwo_comments%rowtype;
begin
  select w.requester_id into v_requester_id from public.itwo_work_orders w where w.id = new.work_order_id;
  if new.kind = 'question' then
    if new.author_id = v_requester_id then
      raise exception 'ผู้แจ้งถามกลับใบสั่งงานของตัวเองไม่ได้' using errcode = 'check_violation';
    end if;
    if exists (
         select 1 from public.itwo_comments q
         where q.work_order_id = new.work_order_id and q.kind = 'question'
           and not exists (select 1 from public.itwo_comments a where a.reply_to = q.id)) then
      raise exception 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว' using errcode = 'check_violation';
    end if;
  else
    if new.author_id is distinct from v_requester_id then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้' using errcode = 'check_violation';
    end if;
    select * into v_question from public.itwo_comments q
    where q.id = new.reply_to and q.work_order_id = new.work_order_id and q.kind = 'question';
    if v_question.id is null then
      raise exception 'คำตอบต้องอ้างถึงคำถามของใบสั่งงานเดียวกัน' using errcode = 'check_violation';
    end if;
    if new.stage <> v_question.stage then
      raise exception 'คำตอบต้องใช้ขั้นเดียวกับคำถามที่ตอบ' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.itwo_comments_guard() from public, anon, authenticated;
create trigger itwo_comments_insert_guard before insert on public.itwo_comments
  for each row execute function private.itwo_comments_guard();

-- 5. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- คัดจากนิยามล่าสุดใน 20261205010000_itwo_v2_rework_files.sql ครบทุกชื่อ เพิ่มเฉพาะ itwo_comments (ยังต่อด้วย to_regclass เหมือนเดิม)
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
                                      'itwo_reworks','itwo_attachments','itwo_comments']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 6. ข้อความสถานะ + guard การเปลี่ยนสถานะ ---------------------------------------------------------
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
    when 'need_info' then 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้'
    else 'ใบสั่งงานนี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้'
  end
$$;
revoke all on function private.itwo_status_message(text) from public, anon, authenticated;

-- guard ใบสั่งงาน: เพิ่ม X -> need_info (บันทึกสถานะที่จะกลับ) และ need_info -> สถานะที่บันทึกไว้ / rejected / cancelled
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

  -- UPDATE: ทุกคอลัมน์ยกเว้น status (และ info_return_status ที่เปลี่ยนคู่กับ status) ต้องไม่เปลี่ยน
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
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled', 'need_info'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled', 'need_info'))
    -- it_closed -> in_progress = ผู้แจ้งขอแก้ไขงาน (ผ่าน app_itwo_request_rework เท่านั้น) · received / rejected / cancelled เปิดใหม่ไม่ได้
    or (old.status = 'it_closed' and new.status in ('received', 'in_progress'))
    -- need_info = รอผู้แจ้งตอบ: กลับสถานะเดิม (ตรวจต่อด้านล่าง) หรือจบด้วยไม่อนุมัติ/ยกเลิก
    or (old.status = 'need_info' and new.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะใบสั่งงานจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- ถามกลับผู้แจ้ง: ต้องบันทึกสถานะที่จะกลับไปให้ตรงกับสถานะก่อนถาม · ตอนกลับต้องเป็นสถานะที่บันทึกไว้เท่านั้น (ยกเว้นจบด้วย rejected / cancelled)
  if new.status = 'need_info' and old.status <> 'need_info' and new.info_return_status is distinct from old.status then
    raise exception 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (%) ไว้เป็นสถานะที่จะกลับไป', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'need_info' and new.status <> 'need_info'
     and new.status not in ('rejected', 'cancelled') and new.status is distinct from old.info_return_status then
    raise exception 'ใบที่รอผู้แจ้งตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (%) เท่านั้น', old.info_return_status using errcode = 'check_violation';
  end if;
  if new.status = old.status and new.info_return_status is distinct from old.info_return_status then
    raise exception 'แก้สถานะที่ใบจะกลับไปไม่ได้' using errcode = 'check_violation';
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

-- 7. สิทธิ์อนุมัติ: ระหว่าง need_info ผู้อนุมัติยัง "ไม่อนุมัติ" ได้ (นิยามเดิมทุกอย่าง เพิ่มเฉพาะ need_info ใน v_open) ----------
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
  -- need_info (รอผู้แจ้งตอบ) อยู่ในรายการเพื่อให้ผู้อนุมัติขั้นที่ยังค้างกด "ไม่อนุมัติ" ได้ · ส่วน "อนุมัติ" ถูกกันที่ private.itwo_decide ให้รอคำตอบก่อน
  v_open := v_wo.requester_id <> p_actor_id
    and v_wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$$;
revoke all on function private.itwo_approval_caps(uuid, uuid) from public, anon, authenticated;

-- ขั้นที่ผู้ทำรายการ "ถามผู้แจ้ง" ได้กับใบนี้ตอนนี้ (null = ถามไม่ได้) · จุดตัดสินเดียว ใช้ทั้ง RPC และปุ่มในหน้ารายละเอียด
--   ก่อนอนุมัติ: ผู้ที่มีสิทธิ์อนุมัติขั้นที่ใบรออยู่ (can_it = it_mgr, can_dept = dept) สถานะ pending_dept / pending_it_mgr
--     และ in_progress (งานด่วนที่เริ่มแล้วแต่ผู้จัดการยังไม่อนุมัติ)
--   หลังอนุมัติ: ผู้ดูแลงาน IT เมื่อใบ approved หรือ in_progress (รวมรอบแก้ไข) -> it
--   ผู้แจ้งถามกลับใบตัวเองไม่ได้ · ระหว่าง need_info ถามซ้ำไม่ได้ (สถานะไม่อยู่ในรายการ)
create or replace function private.itwo_info_stage(p_wo public.itwo_work_orders, p_actor public.employees)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caps record;
begin
  if p_wo.id is null or p_actor.id is null or p_wo.is_test <> p_actor.is_test or p_wo.requester_id = p_actor.id then
    return null;
  end if;
  if p_wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress') then
    select * into v_caps from private.itwo_approval_caps(p_wo.id, p_actor.id);
    if v_caps.can_it then
      return 'it_mgr';
    elsif v_caps.can_dept then
      return 'dept';
    end if;
  end if;
  if p_wo.status in ('approved', 'in_progress') and private.itwo_is_it_admin(p_actor.id) then
    return 'it';
  end if;
  return null;
end;
$$;
revoke all on function private.itwo_info_stage(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- คำถามที่ค้างอยู่ของใบ (ยังไม่มีคำตอบ) · ไม่มี = แถวว่าง
create or replace function private.itwo_pending_question(p_work_order_id uuid)
returns public.itwo_comments
language sql
stable
security definer
set search_path = ''
as $$
  select q from public.itwo_comments q
  where q.work_order_id = p_work_order_id and q.kind = 'question'
    and not exists (select 1 from public.itwo_comments a where a.reply_to = q.id)
  order by q.id desc
  limit 1
$$;
revoke all on function private.itwo_pending_question(uuid) from public, anon, authenticated;

-- 8. อนุมัติ / ไม่อนุมัติ: รับ need_info เฉพาะ "ไม่อนุมัติ" ------------------------------------------
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
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info') then
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

  -- รอผู้แจ้งตอบคำถามอยู่: อนุมัติไม่ได้จนกว่าจะมีคำตอบ (ไม่อนุมัติได้ ตามกติกาเดิมที่ต้องมีเหตุผล)
  if p_approve and v_wo.status = 'need_info' then
    raise exception 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้' using errcode = 'check_violation';
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

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที (รวมงานด่วนที่ IT เริ่มทำแล้ว และใบที่กำลังรอผู้แจ้งตอบ) · อนุมัติ = เลื่อนเฉพาะใบที่ยังรออนุมัติ
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
    -- info_return_status ต้องเคลียร์คู่กับสถานะที่ออกจาก need_info (CHECK + guard บังคับ)
    update public.itwo_work_orders set status = v_new_status, info_return_status = null where id = v_wo.id;
  end if;
end;
$$;
revoke all on function private.itwo_decide(uuid, boolean, text) from public, anon, authenticated;

-- 9. สิทธิ์การกระทำที่ทำได้กับใบ: เพิ่ม request_info / provide_info และ need_info ----------------
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
  -- ระหว่างรอผู้แจ้งตอบ (need_info) ยกเลิกได้ตามเดิม
  if p_wo.requester_id = p_actor.id and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info')
     and not exists (select 1 from public.itwo_events e where e.work_order_id = p_wo.id and e.action = 'completed') then
    v_actions := array_append(v_actions, 'cancel');
  end if;

  select * into v_caps from private.itwo_approval_caps(p_wo.id, p_actor.id);
  if v_caps.can_dept or v_caps.can_it then
    -- ระหว่างรอผู้แจ้งตอบ อนุมัติไม่ได้ (ไม่อนุมัติได้)
    if p_wo.status = 'need_info' then
      v_actions := array_append(v_actions, 'reject');
    else
      v_actions := v_actions || array['approve', 'reject'];
    end if;
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

  -- ถามกลับผู้แจ้ง (ผู้อนุมัติของขั้นที่ใบรออยู่ / ผู้ดูแลงาน IT หลังอนุมัติ) และผู้แจ้งตอบ
  if private.itwo_info_stage(p_wo, p_actor) is not null then
    v_actions := array_append(v_actions, 'request_info');
  end if;
  if p_wo.requester_id = p_actor.id and p_wo.status = 'need_info' then
    v_actions := array_append(v_actions, 'provide_info');
  end if;
  return v_actions;
end;
$$;
revoke all on function private.itwo_allowed_actions(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- 10. ยกเลิก (ผู้แจ้ง): เพิ่ม need_info · ส่วนอื่นเหมือนนิยามรุ่น 2 ทุกอย่าง -----------------------------------
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
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
    raise exception '%', case v_wo.status
      when 'it_closed' then 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน'
      when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;
  -- อยู่ in_progress เพราะขอแก้ไขงานหลัง IT ปิดงานแล้ว (หรือรอผู้แจ้งตอบในรอบแก้ไข): ยกเลิกไม่ได้เช่นกัน (ตรวจก่อนเหตุผล เพื่อให้ได้ข้อความนี้เสมอ)
  if exists (select 1 from public.itwo_events e where e.work_order_id = v_wo.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- info_return_status ต้องเคลียร์คู่กับการออกจาก need_info (CHECK + guard บังคับ)
  update public.itwo_work_orders set status = 'cancelled', info_return_status = null where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'cancelled', v_reason);
end;
$$;

-- 11. ถามกลับผู้แจ้ง / ผู้แจ้งตอบ ------------------------------------------------------------------
-- ถาม: ล็อกแถวใบ (for update) กันถามซ้ำพร้อมกัน · ใบไป need_info พร้อมบันทึกสถานะที่ต้องกลับ + event info_requested (ลายเซ็นของผู้ถาม)
create or replace function public.app_itwo_request_info(p_work_order_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itwo_clean(p_body);
  v_wo public.itwo_work_orders%rowtype;
  v_stage text;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id = v_actor.id then
    raise exception 'ผู้แจ้งถามกลับใบสั่งงานของตัวเองไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status = 'need_info' then
    raise exception 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ' using errcode = 'check_violation';
  end if;
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress') then
    raise exception '%', private.itwo_status_message(v_wo.status) using errcode = 'check_violation';
  end if;

  v_stage := private.itwo_info_stage(v_wo, v_actor);
  if v_stage is null then
    raise exception 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้' using errcode = 'insufficient_privilege';
  end if;

  insert into public.itwo_comments (is_test, work_order_id, kind, stage, author_id, body)
  values (v_wo.is_test, v_wo.id, 'question', v_stage, v_actor.id, v_body)
  returning id into v_comment_id;

  update public.itwo_work_orders set status = 'need_info', info_return_status = v_wo.status where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'info_requested',
          'ถามผู้แจ้ง (' || case v_stage when 'dept' then 'ผู้จัดการแผนก' when 'it_mgr' then 'ผู้อนุมัติขั้น IT' else 'ทีม IT' end
          || '): ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

-- ตอบ: เฉพาะผู้แจ้ง เมื่อใบ need_info · ใบกลับไปสถานะที่บันทึกไว้ + event info_provided
create or replace function public.app_itwo_provide_info(p_work_order_id uuid, p_body text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_body text := private.itwo_clean(p_body);
  v_wo public.itwo_work_orders%rowtype;
  v_question public.itwo_comments%rowtype;
  v_comment_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  if v_body is null then
    raise exception 'กรุณาพิมพ์คำตอบ' using errcode = 'check_violation';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status <> 'need_info' then
    raise exception 'ใบสั่งงานนี้ไม่มีคำถามที่รอตอบ' using errcode = 'check_violation';
  end if;

  v_question := private.itwo_pending_question(v_wo.id);
  if v_question.id is null then
    raise exception 'ไม่พบคำถามที่รอตอบของใบสั่งงานนี้' using errcode = 'check_violation';
  end if;

  insert into public.itwo_comments (is_test, work_order_id, kind, stage, author_id, body, reply_to)
  values (v_wo.is_test, v_wo.id, 'answer', v_question.stage, v_actor.id, v_body, v_question.id)
  returning id into v_comment_id;

  update public.itwo_work_orders set status = v_wo.info_return_status, info_return_status = null where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'info_provided', 'ผู้แจ้งตอบคำถาม: ' || left(v_body, 300));

  return jsonb_build_object('comment_id', v_comment_id);
end;
$$;

-- 12. ไฟล์แนบ: หน้าต่างเวลา/ตัวช่วยอ่านไฟล์ + policy ของ Storage + RPC ---------------------------------
-- หน้าต่างแนบ "ตอนแจ้ง" / "รอบแก้ไข": เพิ่ม need_info (ผู้อนุมัติ/IT ถามมาในช่วง 30 นาทีแรก ผู้แจ้งยังลงทะเบียนไฟล์ที่อัปโหลดไว้ได้)
create or replace function private.itwo_initial_attach_open(p_wo public.itwo_work_orders)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_wo.attachment_flag = 'yes'
    and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info')
    and now() - p_wo.created_at <= private.itwo_attach_window()
    and not private.itwo_has_real_approval(p_wo.id, p_wo.requester_id)
$$;
revoke all on function private.itwo_initial_attach_open(public.itwo_work_orders) from public, anon, authenticated;

create or replace function private.itwo_rework_attach_open(p_wo public.itwo_work_orders, p_rework_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_wo.status in ('in_progress', 'it_closed', 'need_info')
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

-- หน้าต่างแนบ "ข้อความถาม/ตอบ": ผู้เขียนข้อความนั้นเอง ภายใน 30 นาทีหลังเขียน ใบยังไม่สิ้นสุด และผู้เขียนยังดูใบนี้ได้
--   (p_comment_id ว่าง = ข้อความใดของผู้เขียนในใบนี้ก็ได้ ใช้ตอนตัดสินอัปโหลดผ่าน policy ที่ไม่รู้ว่าไฟล์เป็นของข้อความไหน)
create or replace function private.itwo_comment_attach_open(p_wo public.itwo_work_orders, p_comment_id bigint, p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.id is not null
    and p_actor.id is not null
    and p_wo.status not in ('rejected', 'cancelled', 'received')
    and private.itwo_can_view(p_wo, p_actor)
    and exists (
      select 1 from public.itwo_comments c
      where c.work_order_id = p_wo.id
        and c.author_id = p_actor.id
        and (p_comment_id is null or c.id = p_comment_id)
        and now() - c.created_at <= private.itwo_attach_window()
    )
$$;
revoke all on function private.itwo_comment_attach_open(public.itwo_work_orders, bigint, public.employees) from public, anon, authenticated;

-- อัปโหลดได้: (ก) ผู้แจ้งของใบ ขณะหน้าต่างแนบตอนแจ้ง/รอบแก้ไขล่าสุดเปิดอยู่ หรือ (ข) ผู้เขียนข้อความถาม/ตอบ ขณะหน้าต่างของข้อความตัวเองเปิดอยู่
--   เพดานไฟล์ในโฟลเดอร์กัน spam: 20 ไฟล์ต่อ 1 + จำนวนรอบแก้ไข + จำนวนข้อความ (เพดานจริง 10 ไฟล์ต่อครั้งบังคับที่ RPC ตอนลงทะเบียน)
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
  if v_wo.id is null or v_wo.is_test <> p_is_test or v_actor.is_test <> p_is_test then
    return false;
  end if;
  if not (
       (v_wo.requester_id = v_actor.id
        and (private.itwo_initial_attach_open(v_wo) or private.itwo_rework_attach_open(v_wo, null)))
       or private.itwo_comment_attach_open(v_wo, null, v_actor)
     ) then
    return false;
  end if;
  return (
    select count(*) from storage.objects o
    where o.bucket_id = case when p_is_test then 'itwo-test-files' else 'itwo-files' end
      and starts_with(o.name, v_id::text || '/')
  ) < 20 * (1
            + (select count(*) from public.itwo_reworks r where r.work_order_id = v_id)
            + (select count(*) from public.itwo_comments c where c.work_order_id = v_id));
end;
$$;
revoke all on function private.itwo_storage_can_upload(text, boolean) from public, anon;
grant execute on function private.itwo_storage_can_upload(text, boolean) to authenticated;

-- อ่านชนิด/ขนาดของไฟล์ที่อัปโหลดแล้วจาก Storage (ผู้เรียกต้องเป็นเจ้าของไฟล์) และตรวจชนิด/นามสกุล/ขนาด · ใช้กับ app_itwo_add_comment_attachment
--   ตรวจเหมือน app_itwo_add_attachment ทุกข้อ (ชนิดและขนาดใช้ค่าจาก metadata ของ Storage เท่านั้น ไม่เชื่อค่าที่ผู้เรียกส่งมา)
create or replace function private.itwo_read_stored_file(p_is_test boolean, p_path text, out mime_type text, out size_bytes bigint)
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
  where o.bucket_id = case when p_is_test then 'itwo-test-files' else 'itwo-files' end
    and o.name = p_path and o.owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  mime_type := nullif(v_object.metadata ->> 'mimetype', '');
  size_bytes := nullif(v_object.metadata ->> 'size', '')::bigint;
  if mime_type is null or size_bytes is null then
    raise exception 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if mime_type <> all (private.itwo_allowed_mime_types()) then
    raise exception 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)' using errcode = 'check_violation';
  end if;
  if not private.itwo_ext_matches_mime(p_path, mime_type) then
    raise exception 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่' using errcode = 'check_violation';
  end if;
  if size_bytes <= 0 or size_bytes > 20971520 then
    raise exception 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB' using errcode = 'check_violation';
  end if;
end;
$$;
revoke all on function private.itwo_read_stored_file(boolean, text) from public, anon, authenticated;

-- ลงทะเบียนไฟล์แนบของข้อความถาม/ตอบ (คืน id ทะเบียน · เรียกซ้ำด้วย path เดิมของข้อความเดียวกัน = คืน id เดิม)
-- เฉพาะคนเขียนข้อความนั้น ภายใน 30 นาทีหลังเขียน ≤10 ไฟล์ต่อข้อความ · lock แถวใบก่อนนับ จึงกดพร้อมกันก็เกิน 10 ไฟล์ไม่ได้
create or replace function public.app_itwo_add_comment_attachment(
  p_work_order_id uuid,
  p_comment_id bigint,
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
  v_comment public.itwo_comments%rowtype;
  v_file_name text := private.itwo_clean(p_file_name);
  v_existing public.itwo_attachments%rowtype;
  v_file record;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test or not private.itwo_can_view(v_wo, v_actor) then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  select * into v_comment from public.itwo_comments c where c.id = p_comment_id and c.work_order_id = v_wo.id;
  if v_comment.id is null then
    raise exception 'ไม่พบข้อความนี้ในใบสั่งงาน' using errcode = 'check_violation';
  end if;
  if v_comment.author_id <> v_actor.id then
    raise exception 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้' using errcode = 'insufficient_privilege';
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

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของข้อความเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม
  select * into v_existing from public.itwo_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.work_order_id = v_wo.id and v_existing.comment_id is not distinct from v_comment.id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if v_wo.status in ('rejected', 'cancelled', 'received') then
    raise exception 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
  end if;
  if now() - v_comment.created_at > private.itwo_attach_window() then
    raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังส่งข้อความ)' using errcode = 'check_violation';
  end if;
  if (select count(*) from public.itwo_attachments a where a.comment_id = v_comment.id) >= 10 then
    raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อข้อความ' using errcode = 'check_violation';
  end if;

  -- ไฟล์ต้องอยู่ใน Storage จริง ในบัคเก็ตตามโหมดของใบ และผู้เรียกเป็นคนอัปโหลดเอง (ชนิด/ขนาดใช้ค่าจาก Storage ค่า p_mime_type / p_size_bytes ไม่ถูกเชื่อ)
  select * into v_file from private.itwo_read_stored_file(v_wo.is_test, p_storage_path);

  insert into public.itwo_attachments (is_test, work_order_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_wo.is_test, v_wo.id, v_comment.id, p_storage_path, v_file_name, v_file.mime_type, v_file.size_bytes, v_actor.id)
  returning itwo_attachments.id into v_id;
  return v_id;
end;
$$;

-- ลงทะเบียนไฟล์ตอนแจ้ง/รอบแก้ไข (ลายเซ็นเดิม): ต่างจากรุ่น 2 เฉพาะ (1) สถานะ need_info ผ่านได้ (2) ทะเบียนที่ผูกกับข้อความไม่ถูกคืนเป็นของใบ/รอบ
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

  -- ลองใหม่หลังเน็ตหลุด: path เดิมของใบ/รอบเดียวกันที่ลงทะเบียนแล้ว = คืนทะเบียนเดิม (ไฟล์ของข้อความถาม/ตอบใช้ RPC ของข้อความ ไม่ใช่ตัวนี้)
  select * into v_existing from public.itwo_attachments a where a.storage_path = p_storage_path;
  if v_existing.id is not null then
    if v_existing.work_order_id = v_wo.id and v_existing.comment_id is null
       and v_existing.rework_id is not distinct from p_rework_id then
      return v_existing.id;
    end if;
    raise exception 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว' using errcode = 'check_violation';
  end if;

  if p_rework_id is null then
    -- (1) แนบตอนแจ้ง
    if v_wo.attachment_flag <> 'yes' then
      raise exception 'ใบสั่งงานนี้ไม่ได้เลือกเอกสารแนบเป็น "มี" จึงแนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
      raise exception 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้' using errcode = 'check_violation';
    end if;
    if now() - v_wo.created_at > private.itwo_attach_window() then
      raise exception 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)' using errcode = 'check_violation';
    end if;
    if private.itwo_has_real_approval(v_wo.id, v_wo.requester_id) then
      raise exception 'มีผู้อนุมัติใบสั่งงานนี้แล้ว แนบไฟล์เพิ่มไม่ได้' using errcode = 'check_violation';
    end if;
    if (select count(*) from public.itwo_attachments a where a.work_order_id = v_wo.id and a.rework_id is null and a.comment_id is null) >= 10 then
      raise exception 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง' using errcode = 'check_violation';
    end if;
  else
    -- (2) แนบตอนขอแก้ไขงาน: รอบล่าสุดของใบนี้ที่ผู้แจ้งเพิ่งสร้าง
    if not exists (select 1 from public.itwo_reworks r where r.id = p_rework_id and r.work_order_id = v_wo.id) then
      raise exception 'ไม่พบรอบขอแก้ไขงานนี้' using errcode = 'check_violation';
    end if;
    if v_wo.status not in ('in_progress', 'it_closed', 'need_info') then
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
-- เพิ่มจากรุ่น 2: info_return_status, info_pending (คำถามที่ค้าง: ใครถาม ขั้นไหน), comments[] (ผู้เขียน, stage, ไฟล์แนบของแต่ละข้อความ)
--   attachments[] เดิมไม่รวมไฟล์ของข้อความ (comment_id ไม่ว่าง) เพื่อไม่ปนกับไฟล์ตอนแจ้ง/รอบแก้ไข
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
    'info_return_status', v_wo.info_return_status,
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
    -- ไฟล์ตอนแจ้ง/รอบแก้ไข (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments)
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
      where att.work_order_id = v_wo.id and att.comment_id is null),
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
                          'bucket', case when att.is_test then 'itwo-test-files' else 'itwo-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itwo_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itwo_comments c
      join public.employees a on a.id = c.author_id
      where c.work_order_id = v_wo.id),
    -- คำถามที่ค้างอยู่ (เฉพาะตอนใบ need_info) ไม่มี = null
    'info_pending', case when v_wo.status = 'need_info' then (
      select jsonb_build_object(
               'comment_id', q.id,
               'stage', q.stage,
               'body', q.body,
               'asked_at', q.created_at,
               'asked_by_employee_no', a.employee_no,
               'asked_by_full_name', a.first_name || ' ' || a.last_name)
      from public.itwo_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itwo_pending_question(v_wo.id)).id) end,
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
-- info_return_status = สถานะที่ใบจะกลับไป (มีค่าเมื่อ need_info) · info_stage = ขั้นของผู้ถามที่ค้างอยู่ (dept / it_mgr / it) เฉพาะ need_info
drop function public.app_itwo_list_mine();
drop function public.app_itwo_list_pending_approvals();
drop function public.app_itwo_list_it();

-- ใบของฉัน (ผู้แจ้ง = ผู้เรียก) · status = need_info คือ "รอคุณตอบ"
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
  rework_due_date date,
  info_return_status text,
  info_stage text
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
         wo.misc_detail, coalesce(rw.round_no, 0), rw.due_date, wo.info_return_status,
         case when wo.status = 'need_info' then (private.itwo_pending_question(wo.id)).stage end
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
-- ใบที่ need_info (รอผู้แจ้งตอบ) ของขั้นผู้เรียกแสดงด้วย (status = need_info) แต่ไม่ใช่ "รอฉัน" และ app_itwo_pending_count ไม่นับ
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
  misc_detail text,
  info_return_status text,
  info_stage text
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
         wo.misc_detail, wo.info_return_status,
         case when wo.status = 'need_info' then (private.itwo_pending_question(wo.id)).stage end
  from public.itwo_work_orders wo
  join public.departments d on d.id = wo.department_id
  join public.employees req on req.id = wo.requester_id
  cross join lateral private.itwo_approval_caps(wo.id, v_actor.id) caps
  where wo.is_test = v_actor.is_test
    and wo.requester_id <> v_actor.id
    and wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
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
  rework_due_date date,
  info_return_status text,
  info_stage text
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
         wo.misc_detail, coalesce(rw.round_no, 0), rw.due_date, wo.info_return_status,
         case when wo.status = 'need_info' then (private.itwo_pending_question(wo.id)).stage end
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

-- 14. ล้างข้อมูลทดสอบ: เพิ่ม itwo_comments ------------------------------------------------------------
-- ลบเฉพาะแถว is_test ของตารางโมดูลทั้งหมด (รวมประวัติ) และเริ่มนับเลข TEST-… ใหม่ · ข้อมูลจริงไม่ถูกแตะ
-- files = path ของ "ทุกไฟล์" ในบัคเก็ต itwo-test-files หลังล้างแถวทะเบียนแล้ว (หน้าเว็บต้องลบผ่าน Storage API ต่อ ดู migration รุ่น 2)
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
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> ส่วนสิทธิ์/รอบแก้ไข/ข้อความ/ไฟล์แนบ -> ประวัติ -> admin_log) กัน deadlock
  lock table public.itwo_doc_counters, public.itwo_work_orders, public.itwo_access_changes,
             public.itwo_reworks, public.itwo_comments, public.itwo_attachments,
             public.itwo_events, public.itwo_admin_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itwo.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itwo.purge', 'on', true);

  -- ลูกก่อนแม่: ไฟล์แนบ (อ้างรอบแก้ไข/ข้อความ และใบ) -> ข้อความ (อ้างใบ และอ้างกันเอง ลบในคำสั่งเดียวได้) -> รอบแก้ไข -> ... -> ใบ
  foreach v_table in array array['itwo_events', 'itwo_access_changes', 'itwo_attachments', 'itwo_comments', 'itwo_reworks',
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
