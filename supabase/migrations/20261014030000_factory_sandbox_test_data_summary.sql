-- ฝ่ายโรงงาน (โหมดทดสอบ): หน้า "ข้อมูลทดสอบ" ดูสถานะชุดข้อมูลตัวอย่าง และรายการที่จะลบพร้อมจำนวนก่อนยืนยันล้าง
--
-- แนวคิดจาก ERPNext (demo data + Transaction Deletion Record): ทำรายการที่จะลบพร้อมจำนวนให้ผู้ใช้ตรวจก่อนยืนยัน
-- แล้วบันทึกจำนวนที่ลบจริงแยกตามประเภทข้อมูลไว้ตรวจย้อนหลัง (นำมาแค่แนวคิด ไม่ได้คัดลอกโค้ดของ ERPNext ซึ่งเป็น GPL-3.0)
--
-- 1. private.factory_test_data_counts(): นับข้อมูลทดสอบ (is_test) ของทุกตารางที่ app_sandbox_purge_factory ลบ
--    ใช้ร่วมกันทั้งหน้าสรุปและการล้าง ตัวเลขก่อนยืนยันกับตัวเลขใน audit หลังลบจึงมาจากนิยามเดียวกัน
--    (เพิ่มตาราง factory_* ใหม่ที่การล้างต้องลบ ให้เพิ่มทั้งใน purge และในฟังก์ชันนี้)
-- 2. public.app_sandbox_factory_test_data(): อ่านอย่างเดียว เฉพาะ admin ในโหมดทดสอบ คืนจำนวนข้อมูลทดสอบ
--    และสถานะชุดข้อมูลตัวอย่าง (เงื่อนไขเดียวกับที่ seed แต่ละชุดใช้กันการเติมซ้ำ)
-- 3. public.app_sandbox_purge_factory(): นิยามจาก 20261009030000_factory_attachments.sql + นับก่อนลบ
--    คืน counts และบันทึกใน audit_logs.metadata (ยังคืน deleted = จำนวน Item เหมือนเดิม ผู้เรียกเดิมไม่ต้องแก้)
--
-- Rollback: drop function public.app_sandbox_factory_test_data(); drop function private.factory_test_data_counts();
-- แล้วรันนิยาม app_sandbox_purge_factory ของ 20261009030000_factory_attachments.sql อีกครั้ง ไม่มีตารางหรือข้อมูลถูกแก้

create or replace function private.factory_test_data_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'items', (select count(*) from public.factory_items where is_test),
    'boms', (select count(*) from public.factory_boms where is_test),
    'routings', (select count(*) from public.factory_routings where is_test),
    'production_orders', (select count(*) from public.factory_production_orders where is_test),
    'material_orders', (select count(*) from public.factory_material_orders where is_test),
    'jobs', (select count(*) from public.factory_jobs where is_test),
    'inventory_movements', (select count(*) from public.factory_inventory_movements where is_test),
    'lots', (select count(*) from public.factory_lots where is_test),
    'attachments', (select count(*) from public.factory_attachments where is_test),
    'work_centers', (select count(*) from public.factory_work_centers where is_test),
    'warehouses', (select count(*) from public.factory_warehouses where is_test),
    -- รายการย่อยและประวัติที่ถูกลบตามเอกสารแม่
    'details', (select count(*) from public.factory_job_inspections where is_test)
             + (select count(*) from public.factory_job_history where is_test)
             + (select count(*) from public.factory_job_steps where is_test)
             + (select count(*) from public.factory_material_order_history where is_test)
             + (select count(*) from public.factory_material_order_lines where is_test)
             + (select count(*) from public.factory_production_order_history where is_test)
             + (select count(*) from public.factory_routing_steps where is_test)
             + (select count(*) from public.factory_bom_history where is_test)
             + (select count(*) from public.factory_bom_lines where is_test)
             + (select count(*) from public.factory_item_unit_conversions where is_test)
             + (select count(*) from public.factory_item_history where is_test)
  )
$$;
revoke all on function private.factory_test_data_counts() from public, anon, authenticated;

create or replace function public.app_sandbox_factory_test_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_counts jsonb;
begin
  perform private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  v_counts := private.factory_test_data_counts();
  return jsonb_build_object(
    'counts', v_counts,
    'total', (select coalesce(sum(value::bigint), 0) from jsonb_each_text(v_counts)),
    -- เงื่อนไขเดียวกับที่ seed แต่ละชุดใช้ตัดสินว่าเติมแล้ว (20261006050000 / 20261007020000 / 20261008050000)
    'sets', jsonb_build_object(
      'sample_available', not exists (select 1 from public.factory_items where is_test),
      'trial_loaded', exists (select 1 from public.factory_items where is_test and code like '%-TRY-%'),
      'megaform_loaded', exists (select 1 from public.factory_production_orders
                                 where is_test and note like 'ชุดทดสอบ MEGAFORM 260702-26031%')
    )
  );
end;
$$;
revoke all on function public.app_sandbox_factory_test_data() from public, anon;
grant execute on function public.app_sandbox_factory_test_data() to authenticated;

create or replace function public.app_sandbox_purge_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_items integer;
  v_counts jsonb;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ไฟล์แนบ: ลบไฟล์ผ่าน Storage API ก่อน (app_factory_attachment_paths) มิฉะนั้นไฟล์จริงจะค้างโดยไม่มีแถวชี้
  if exists (
    select 1 from public.factory_attachments a
    join storage.objects o on o.bucket_id = 'factory-attachments' and o.name = a.storage_path
    where a.is_test
  ) then
    raise exception 'FACTORY_FILES_REMAIN';
  end if;

  -- รายการที่จะลบ นับในธุรกรรมเดียวกับการลบ (ชุดเดียวกับที่หน้า "ข้อมูลทดสอบ" แสดงก่อนยืนยัน)
  v_counts := private.factory_test_data_counts();

  delete from public.factory_attachments where is_test;

  -- ใบงานผลิตและใบสั่งวัตถุดิบอ้างใบสั่งผลิต/BOM/Routing/คลัง ต้องลบก่อน (ลูกก่อนแม่)
  delete from public.factory_job_inspections where is_test;
  delete from public.factory_job_history where is_test;
  delete from public.factory_job_steps where is_test;
  delete from public.factory_jobs where is_test;
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
  delete from public.document_counters where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST', 'FACTORY-MR-TEST', 'FACTORY-JB-TEST');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items, 'counts', v_counts));
  return jsonb_build_object('deleted', v_items, 'counts', v_counts);
end;
$$;
revoke all on function public.app_sandbox_purge_factory() from public, anon;
grant execute on function public.app_sandbox_purge_factory() to authenticated;
