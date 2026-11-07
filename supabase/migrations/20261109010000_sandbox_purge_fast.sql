-- ============================================================================
-- ล้างข้อมูลทดสอบ BOM / RubberFlow ให้ทันเวลา (statement_timeout ของ authenticated = 8 วินาที)
--
-- ทำไม: ล้างข้อมูลทดสอบ BOM ด้วยข้อมูลจริงจาก DATA_BOM.xlsx (bom_items 6,955 · bom_boms 3,892 · bom_bom_lines 17,782 · คอมปาวด์ 75 แถว)
--   ล้มเหลวด้วยเวลาหมด ("ฐานข้อมูลบันทึกไม่ทันเวลาที่กำหนด") สาเหตุสองข้อ
--   1) ทุกแถวที่ลบเรียก trigger BEFORE DELETE private.sandbox_row_scope() -> private.sandbox_scope_matches(old.is_test) -> private.sandbox_persona()
--      (join 4 ตาราง อิงตาม auth.uid()) รวมประมาณ 31,000 ครั้งต่อการล้างหนึ่งครั้ง ทั้งที่ผู้เรียกผ่านการตรวจ admin + โหมดทดสอบมาแล้ว
--      sandbox_scope_matches ตอบ true ทันทีเมื่อ auth.uid() เป็น null (งาน cron/service) และ auth.uid() อ่านจาก request.jwt.claim.sub กับ request.jwt.claims
--   2) foreign key ที่ฝั่งตารางลูกไม่มีดัชนี การตรวจ FK / ON DELETE CASCADE จึงสแกนทั้งตารางต่อแถวที่ลบ:
--      bom_jobs(item_code, is_test) และฝั่ง RubberFlow (bom_bom_lines ไม่ต้อง: unique (bom_pk, line_no) / (bom_pk, child_code) ใน 20261105010000 รองรับ cascade จาก bom_boms อยู่แล้ว)
--      rf_orders(recipe_code, recipe_revision, is_test), rf_requisitions(order_no, is_test), rf_requisitions(recipe_code, recipe_revision, is_test),
--      rf_lots(mold_id, is_test), rf_transfers(order_no, is_test), rf_transfers(lot_no, is_test), rf_fg_boxes(order_no, is_test), rf_qc_records(order_no, is_test)
--
-- สิ่งที่เปลี่ยน
--   1) public.app_sandbox_purge_bom() และ public.app_sandbox_purge_rf(): ตรวจสิทธิ์ (admin จริง + อยู่ในโหมดทดสอบ) และล็อกตัวนับเหมือนเดิมทุกอย่าง
--      แล้วพักค่า request.jwt.claim.sub / request.jwt.claims ไว้ ตั้งเป็นค่าว่างแบบ transaction-local เฉพาะช่วงที่ลบ (trigger รายแถวจึงข้ามการค้นหา persona)
--      และคืนค่าเดิมก่อนอัปเดต epoch / เขียน audit · ที่เหลือคัดลอกจากนิยามเดิมทุกตัวอักษร
--      ความปลอดภัย: ไม่เปิดสิทธิ์เพิ่ม เพราะการลบทั้งหมดยังเป็น "where is_test" ของโหมดทดสอบเท่านั้น และผู้เรียกต้องผ่าน private.lab_only_block / sandbox_admin / sandbox_persona ก่อนแล้ว
--      ค่าเคลียร์เป็น transaction-local จึงไม่รั่วไปคำสั่งอื่นของ connection เดียวกัน และถ้าฟังก์ชัน raise ทั้งธุรกรรมถูกย้อน
--   2) ดัชนีฝั่งตารางลูกของ foreign key ข้างต้น (create index if not exists)
--
-- ฟังก์ชันที่ replace (ลายเซ็น / security definer / search_path / สิทธิ์ เหมือนเดิม)
--   public.app_sandbox_purge_bom()  จาก 20261106010000_bom_orders_jobs.sql
--   public.app_sandbox_purge_rf()   จาก 20261108010000_rubberflow_shopfloor.sql
--
-- ลำดับ deploy: ไม่มีโค้ด client เปลี่ยน (client เดิมเรียก RPC ชื่อและผลลัพธ์เดิม) จึงไม่ต้องรอ merge แต่ยังต้องได้การอนุมัติจากผู้ใช้ก่อน apply ตาม AGENTS.md
--   ก่อน apply: เทียบ md5(prosrc) ของสองฟังก์ชันบน production กับนิยามในไฟล์ต้นทางข้างบน (ต้องตรง ไม่งั้นมีงานใหม่กว่าที่จะถูกทับ)
--   หลัง apply: เทียบ md5(prosrc) กับนิยามในไฟล์นี้ และตรวจว่าดัชนีมีครบ
--
-- Rollback: คืนนิยามเดิมของสองฟังก์ชันด้วยการรัน create or replace จาก 20261106010000_bom_orders_jobs.sql และ 20261108010000_rubberflow_shopfloor.sql
--   (รวม revoke/grant ท้ายฟังก์ชัน) แล้ว drop index ที่สร้างในไฟล์นี้ (bom_jobs_item_idx, rf_orders_recipe_idx, rf_requisitions_order_idx,
--   rf_requisitions_recipe_idx, rf_lots_mold_idx, rf_transfers_order_idx, rf_transfers_lot_idx, rf_fg_boxes_order_idx, rf_qc_records_order_idx) · ไม่มีข้อมูลถูกแก้
-- ============================================================================

-- 1. ดัชนีฝั่งตารางลูกของ foreign key (คู่กับ is_test เพราะ FK ทุกตัวอ้างทั้งสองคอลัมน์) -------------------------
create index if not exists bom_jobs_item_idx on public.bom_jobs (item_code, is_test);
create index if not exists rf_orders_recipe_idx on public.rf_orders (recipe_code, recipe_revision, is_test);
create index if not exists rf_requisitions_order_idx on public.rf_requisitions (order_no, is_test);
create index if not exists rf_requisitions_recipe_idx on public.rf_requisitions (recipe_code, recipe_revision, is_test);
create index if not exists rf_lots_mold_idx on public.rf_lots (mold_id, is_test);
create index if not exists rf_transfers_order_idx on public.rf_transfers (order_no, is_test);
create index if not exists rf_transfers_lot_idx on public.rf_transfers (lot_no, is_test);
create index if not exists rf_fg_boxes_order_idx on public.rf_fg_boxes (order_no, is_test);
create index if not exists rf_qc_records_order_idx on public.rf_qc_records (order_no, is_test);

-- 2. ล้างข้อมูล BOM ทดสอบ (นิยามจาก 20261106010000_bom_orders_jobs.sql เพิ่มการพักค่า claims ระหว่างลบ) --------------
-- ลบทุกแถว is_test ของตาราง bom_* (ลูกก่อนแม่) เปลี่ยน epoch (ตัวนับ version เดินต่อ) เขียน audit (audit_logs เดิมคงไว้) ไม่แตะข้อมูลจริง
create or replace function public.app_sandbox_purge_bom()
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
  v_version bigint;
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_bom_save_master) การบันทึกที่กำลังทำอยู่จึงจบก่อน และไม่มีการบันทึกใหม่แทรกระหว่างลบ
  insert into public.bom_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.bom_master_state s where s.is_test for update;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) เพื่อให้ trigger รายแถว private.sandbox_row_scope ข้ามการหา persona
  -- (auth.uid() เป็น null = sandbox_scope_matches ตอบ true ทันที) ไม่เช่นนั้นการลบหลักหมื่นแถวเรียก persona หลักหมื่นครั้งจนเกิน statement_timeout 8 วินาที
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_table in array array[
    'bom_jobs', 'bom_orders', 'bom_customers', 'bom_bom_lines', 'bom_boms', 'bom_routings', 'bom_color_sets', 'bom_packages',
    'bom_colors', 'bom_processes', 'bom_compounds', 'bom_items', 'bom_deleted_keys'
  ] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- คืน claims ก่อนอัปเดต epoch / เขียน audit (trigger ของตัวนับและ audit เห็นผู้เรียกเหมือนเดิม; audit ใช้ v_admin ที่อ่านไว้ก่อนแล้ว)
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ แถวที่สร้างหลังล้างจึงได้เวอร์ชันใหม่กว่าที่ client ใดเคยถือ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.bom_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.bom_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'BOM_SANDBOX_PURGE', 'bom_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล BOM ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- 3. ล้างข้อมูล RubberFlow ทดสอบ (นิยามจาก 20261108010000_rubberflow_shopfloor.sql เพิ่มการพักค่า claims ระหว่างลบ) -------
-- ลบทุกแถว is_test ของตาราง rf_* (ลูกก่อนแม่) เปลี่ยน epoch (ตัวนับ version เดินต่อ) เขียน audit (audit_logs เดิมคงไว้) ไม่แตะข้อมูลจริง และไม่แตะ BOM
create or replace function public.app_sandbox_purge_rf()
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
  v_version bigint;
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_rf_save) การบันทึกที่กำลังทำอยู่จึงจบก่อน
  insert into public.rf_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.rf_master_state s where s.is_test for update;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) เพื่อให้ trigger รายแถว private.sandbox_row_scope ข้ามการหา persona
  -- (เหตุผลเดียวกับ app_sandbox_purge_bom)
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_table in array array['rf_ncrs', 'rf_qc_records', 'rf_fg_boxes', 'rf_transfers', 'rf_requisitions', 'rf_lots', 'rf_material_lots', 'rf_molds',
                                 'rf_orders', 'rf_recipes', 'rf_materials', 'rf_deleted_keys'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- คืน claims ก่อนอัปเดต epoch / เขียน audit (audit ใช้ v_admin ที่อ่านไว้ก่อนแล้ว)
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.rf_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.rf_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'RF_SANDBOX_PURGE', 'rf_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล RubberFlow ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.app_sandbox_purge_bom() from public, anon;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_sandbox_purge_bom() to authenticated;
grant execute on function public.app_sandbox_purge_rf() to authenticated;
