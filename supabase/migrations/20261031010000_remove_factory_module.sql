-- ลบโมดูลฝ่ายโรงงาน (โหมดทดสอบ) ทั้งหมด: ข้อมูล ตาราง ฟังก์ชัน/RPC ไฟล์แนบ และตัวนับเลขเอกสาร
--
-- โมดูลนี้เปิดได้เฉพาะในโหมดทดสอบ (ทุก RPC ปฏิเสธนอกโหมดทดสอบด้วย FACTORY_TEST_MODE_ONLY)
-- ผู้ใช้ขอให้ลบทั้งโมดูล ทั้งโค้ดของ Pilot Web และของฐานข้อมูล migration เดิม
-- (20261006050000_factory_item_master.sql ถึง 20261030010000_factory_lot_fefo_quarantine.sql) คงไว้ตามเดิม
-- เพราะอาจถูก apply แล้ว ไฟล์นี้ถอดทุกอย่างที่ migration เหล่านั้นสร้างออก
--
-- สิ่งที่ลบ
--   1) policy ของ storage.objects สำหรับ bucket factory-attachments และตัว bucket (ต้องว่างก่อน ดูข้อ "ก่อน apply")
--   2) ฟังก์ชัน/RPC ของโมดูลทั้งหมด (public.app_factory_*, public.app_sandbox_*factory*, private.factory_*,
--      private.next_factory_doc_number) ทุก overload
--   3) ตาราง public.factory_* 27 ตาราง พร้อมข้อมูล trigger index และ policy ของตาราง
--   4) ตัวนับเลขเอกสารของโหมดทดสอบ FACTORY-MO/WO/MR/JB-TEST ใน public.document_counters
--   5) ชื่อตาราง factory_* ใน private.sandbox_unguarded_tables()
--
-- สิ่งที่คงไว้ (ตั้งใจ)
--   - private.factory_sandbox_scope() เปลี่ยนชื่อเป็น private.sandbox_row_scope() เพราะ trigger ของใบตรวจ QC
--     (20261027010000_qc_inspection_reports.sql) ใช้ฟังก์ชันนี้ trigger อ้างฟังก์ชันด้วย OID จึงทำงานต่อได้ทันที
--     และเนื้อฟังก์ชันไม่อ้างอะไรของโมดูลโรงงาน
--   - บัญชีทดสอบ (persona) ที่ migration ของโรงงานเพิ่ม (SBX-SA/PP/ST/SR/GR/PT/BG/WH-STAFF, SBX-FT-AFM)
--     เป็นแถว employees ที่ is_test, inactive และล็อกอินไม่ได้ ใช้สลับบทบาทในโหมดทดสอบของ NCR/QC ได้ด้วย
--     (ncr_loss_outcomes.test.sql ใช้ SBX-FT-AFM) และอาจถูกอ้างจากใบ NCR/QC ทดสอบหรือ audit_logs
--     การลบอาจล้มด้วย foreign key จึงไม่ลบ
--   - public.audit_logs ของการทำรายการฝ่ายโรงงาน: เป็นบันทึกตรวจสอบย้อนหลัง (AGENTS.md ให้คงไว้)
--
-- ก่อน apply ที่ production (ลำดับ deploy ใน AGENTS.md)
--   - ไฟล์ใน bucket factory-attachments ต้องถูกลบผ่าน Storage API หรือหน้า Dashboard ก่อน
--     (select count(*) from storage.objects where bucket_id = 'factory-attachments'; ต้องได้ 0)
--     ถ้ายังมีไฟล์ migration นี้หยุดด้วย FACTORY_FILES_REMAIN ที่คำสั่งแรก ก่อนเปลี่ยนอะไร
--     ไม่ลบแถว storage.objects ด้วย SQL เพราะไฟล์จริงจะค้างใน storage โดยไม่มีใครเห็น
--   - Pilot Web รุ่นนี้ไม่เรียก RPC ของโรงงานแล้ว จึง merge ก่อนหรือหลัง apply ก็ได้ แต่ Pilot Web รุ่นเก่า
--     ที่เปิดค้างจะเรียก RPC ที่หายไป (เฉพาะ admin ในโหมดทดสอบที่เปิดหน้าโรงงานอยู่)
--
-- Rollback: ลบข้อมูลถาวร ไม่มี rollback ด้วย SQL ถ้าต้องการกู้ ให้กู้จาก backup ของ Supabase ที่ทำก่อน apply
-- แล้วรันนิยามจาก migration ของโรงงานเดิมอีกครั้ง

-- 0. ด่าน: ไฟล์แนบต้องถูกลบผ่าน Storage API ก่อน ---------------------------------------------
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'factory-attachments') then
    raise exception 'FACTORY_FILES_REMAIN: delete every file in bucket factory-attachments through the Storage API first';
  end if;
end $$;

-- 1. ฟังก์ชัน trigger ที่ใบตรวจ QC ใช้ร่วม: เปลี่ยนชื่อให้ไม่ผูกกับโมดูลที่ถูกลบ -----------------------
alter function private.factory_sandbox_scope() rename to sandbox_row_scope;
comment on function private.sandbox_row_scope() is
  'trigger แยกโหมดทดสอบรายแถว: INSERT ตั้ง is_test จากโหมดของผู้ทำรายการ, UPDATE/DELETE ข้ามโหมด = SANDBOX_SCOPE_MISMATCH (เดิมชื่อ private.factory_sandbox_scope)';

-- 2. policy ของไฟล์แนบ (อ้างฟังก์ชันของโมดูล ต้องลบก่อนฟังก์ชัน) ------------------------------------
drop policy if exists factory_files_read on storage.objects;
drop policy if exists factory_files_upload on storage.objects;
drop policy if exists factory_files_delete on storage.objects;

-- 3. ฟังก์ชัน/RPC ของโมดูล (ทุก overload) — ลบก่อนตาราง เพราะบางตัวคืนชนิดแถวของตาราง factory_* ----------
do $$
declare
  v_fn regprocedure;
begin
  for v_fn in
    select p.oid::regprocedure
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    join (values
      ('private', 'factory_actor'), ('private', 'factory_assert_bom_parent'), ('private', 'factory_assert_released_order'),
      ('private', 'factory_attachment_path_ok'), ('private', 'factory_bom_check_graph'), ('private', 'factory_bom_revalidate'),
      ('private', 'factory_bom_snapshot'), ('private', 'factory_can_schedule'), ('private', 'factory_center_department'),
      ('private', 'factory_files_allowed'), ('private', 'factory_issue_stock'), ('private', 'factory_job_issue_reference'),
      ('private', 'factory_job_lock'), ('private', 'factory_job_log'), ('private', 'factory_job_return_reference'),
      ('private', 'factory_job_snapshot'), ('private', 'factory_lot_lock'), ('private', 'factory_lot_log'),
      ('private', 'factory_lot_usable'), ('private', 'factory_material_lock'), ('private', 'factory_material_log'),
      ('private', 'factory_material_snapshot'), ('private', 'factory_ncr_unit'), ('private', 'factory_order_actor'),
      ('private', 'factory_order_lock'), ('private', 'factory_order_log'), ('private', 'factory_order_snapshot'),
      ('private', 'factory_return_job_stock'), ('private', 'factory_run_job_step'), ('private', 'factory_schedule_actor'),
      ('private', 'factory_test_data_counts'), ('private', 'factory_today'), ('private', 'next_factory_doc_number'),
      ('public', 'app_factory_add_attachment'), ('public', 'app_factory_attachment_paths'), ('public', 'app_factory_cancel_job'),
      ('public', 'app_factory_cancel_material_order'), ('public', 'app_factory_cancel_production_order'),
      ('public', 'app_factory_complete_job_step'), ('public', 'app_factory_complete_job_step_with_readings'),
      ('public', 'app_factory_create_job'), ('public', 'app_factory_decide_bom'), ('public', 'app_factory_decide_job_hold'),
      ('public', 'app_factory_list_attachments'), ('public', 'app_factory_lots'), ('public', 'app_factory_master_data'),
      ('public', 'app_factory_place_material_order'), ('public', 'app_factory_plan_production_order'),
      ('public', 'app_factory_receive_material_order'), ('public', 'app_factory_receive_production_order'),
      ('public', 'app_factory_record_qc'), ('public', 'app_factory_release_production_order'),
      ('public', 'app_factory_return_production_order'), ('public', 'app_factory_save_bom_draft'),
      ('public', 'app_factory_save_item'), ('public', 'app_factory_save_material_order'),
      ('public', 'app_factory_save_production_order'), ('public', 'app_factory_save_work_center_calendar'),
      ('public', 'app_factory_schedule_data'), ('public', 'app_factory_schedule_job'), ('public', 'app_factory_set_lot_expiry'),
      ('public', 'app_factory_set_lot_hold'), ('public', 'app_factory_set_step_params'), ('public', 'app_factory_submit_bom'),
      ('public', 'app_factory_submit_production_order'), ('public', 'app_factory_withdraw_bom'),
      ('public', 'app_factory_withdraw_production_order'), ('public', 'app_sandbox_factory_test_data'),
      ('public', 'app_sandbox_purge_factory'), ('public', 'app_sandbox_seed_factory'),
      ('public', 'app_sandbox_seed_factory_megaform'), ('public', 'app_sandbox_seed_factory_trial')
    ) as f(schema_name, function_name) on f.schema_name = n.nspname and f.function_name = p.proname
  loop
    execute format('drop function %s', v_fn);
  end loop;
end $$;

-- 4. ตารางและข้อมูล (คำสั่งเดียว foreign key ระหว่างตาราง factory_* จึงไม่ติด ไม่ใช้ cascade
--    เพื่อให้หยุดทันทีถ้ามีวัตถุนอกโมดูลอ้างตารางเหล่านี้) -----------------------------------------
drop table
  public.factory_attachments,
  public.factory_job_inspections,
  public.factory_job_step_readings,
  public.factory_job_history,
  public.factory_job_steps,
  public.factory_jobs,
  public.factory_material_order_history,
  public.factory_material_order_lines,
  public.factory_material_orders,
  public.factory_inventory_movements,
  public.factory_lot_history,
  public.factory_lots,
  public.factory_production_order_history,
  public.factory_production_orders,
  public.factory_routing_step_params,
  public.factory_routing_steps,
  public.factory_routings,
  public.factory_bom_history,
  public.factory_bom_lines,
  public.factory_boms,
  public.factory_item_unit_conversions,
  public.factory_item_history,
  public.factory_items,
  public.factory_work_centers,
  public.factory_warehouses,
  public.factory_categories,
  public.factory_units;

-- 5. bucket ไฟล์แนบ (ว่างแล้วตามข้อ 0) — Storage รุ่นใหม่กันการลบตรงจากตาราง storage
--    ยกเว้นตั้ง storage.allow_delete_query ในธุรกรรมเดียวกัน (DO block) รุ่นที่ไม่มีด่านนี้ไม่สนใจค่านี้ --------------------
do $
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.buckets where id = 'factory-attachments';
  perform set_config('storage.allow_delete_query', 'false', true);
end $;

-- 6. ตัวนับเลขเอกสารของโหมดทดสอบ (เลข TEST-MO/WO/MR/JB-yy-nnn) ----------------------------------
delete from public.document_counters
where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST', 'FACTORY-MR-TEST', 'FACTORY-JB-TEST');

-- 7. รายการตารางที่รู้จักโหมดทดสอบ: นิยามจาก 20261030010000_factory_lot_fefo_quarantine.sql ตัดชื่อ factory_* ออก ----
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 8. ตรวจว่าไม่เหลือของโมดูล ----------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname like 'factory\_%'
  ) then
    raise exception 'FACTORY_REMOVAL_INCOMPLETE: a public.factory_* relation remains';
  end if;
  if exists (
    select 1 from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and (p.proname like 'app\_factory\_%' or p.proname like 'app\_sandbox\_%factory%'))
       or (n.nspname = 'private' and (p.proname like 'factory\_%' or p.proname = 'next_factory_doc_number'))
  ) then
    raise exception 'FACTORY_REMOVAL_INCOMPLETE: a factory function remains';
  end if;
  if exists (select 1 from pg_catalog.pg_policies where schemaname = 'storage' and policyname like 'factory\_files\_%')
     or exists (select 1 from storage.buckets where id = 'factory-attachments') then
    raise exception 'FACTORY_REMOVAL_INCOMPLETE: factory storage policy or bucket remains';
  end if;
end $$;
