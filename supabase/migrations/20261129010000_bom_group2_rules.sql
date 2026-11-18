-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ (กลุ่มแก้ 2 จากรายงานทดสอบซ้ำ docs/BOM_RETEST_REPORT.md: N1 N2 U9 และกติกาค้างจาก #376)
--   ปิดงานที่ผูก WO แล้ว WO ถูกยกเลิก / หยุด · สเปกมิติการฉีดเป็นของสูตรยาง · แก้ BOM หลายครั้งในวันเดียวกันรวมในฉบับเดิม ·
--   ไม่มีใคร (รวมฝ่ายวางแผน) แก้ยอดดี / เสียของงานได้โดยไม่มีรายการรายงาน
--
-- ทำไม (ผู้ใช้ตัดสิน 2026-11-18):
--   N1  PP "ปิดงานนี้" ที่งาน RB ที่ผูก WO แล้ว WO ยังเป็น "วางแผน" ปล่อยผลิตและเบิกเคมีเต็ม batch ให้งานที่ปิดไปแล้วได้ (เลือก ก: ยกเลิก / หยุดอัตโนมัติ)
--   N2  ล็อตฉีดของเส้นยางกลมถูกกักทุกล็อตเพราะ private.rf_save_lots เทียบกับสเปกตายตัวของ Door Seal (2.5 / 18 / 160) (เลือก ข: เก็บสเปกที่สูตร หัวหน้า RB อนุมัติ)
--   U9  แก้ BOM หนึ่งครั้ง = หนึ่งฉบับ ทำให้ฉบับงอกวันละหลายฉบับ (เลือก ก: คนเดียวกัน วันเดียวกัน ฉบับล่าสุดที่ยังไม่มีใบใช้ = แก้ในฉบับเดิม)
--   #376 ฝ่ายวางแผนตั้ง qty_done / qty_reject ผ่าน RPC ได้โดยไม่มีรายงาน (ผู้ใช้ให้คงแค่ "คืนงานที่ยังไม่มียอดกลับเป็นรอคิวแล้วลดแผน")
--
-- กติกาใหม่ (ทุกข้อฝั่งฐานข้อมูล · mock ของ harness ทำเหมือนกัน scripts/pilot-harness-mock.mjs)
--   1) ปิดงานโดยฝ่ายวางแผนพร้อมเหตุผล (private.bom_save_jobs รายการเหตุผลของการปิด v_close_note): งานที่ผูก WO (external_ref.woId และ WO ชี้กลับ source_job_no)
--      WO planned / released = ยกเลิก · in_progress / on_hold = หยุด (สถานะ cancelled ยอดผลิตและล็อตคงอยู่) · completed / cancelled = คงเดิม
--      ใช้ตัวช่วยเดียวกับการยกเลิกใบ (private.bom_cancel_rf_job ใหม่ ซึ่ง private.bom_cancel_rf_orders เรียกต่องานแทนโค้ดเดิมในตัว) · การผูกของงานคงอยู่
--      app_bom_save_master เพิ่ม version ของ RF ครั้งเดียวและเขียน audit ของ RF แถว client_action = bom:closeJob · คำตอบ rubberflow.cancelled มีเลข WO
--      private.bom_save_jobs จึงคืน jsonb { started: uuid[], cancelled: text[] } แทน uuid[] (drop แล้วสร้างใหม่ ลายเซ็นอาร์กิวเมนต์เดิม ผู้เรียกมีที่เดียว)
--   2) สเปกมิติการฉีด: คอลัมน์ใหม่ rf_recipes.extrusion_spec jsonb (null = ไม่มีสเปก) รูป { thickness?: {target, tol}, width?: {...}, weightPerM?: {...} }
--      target > 0 ถึง 1,000,000 · tol 0 ถึง 1,000,000 · คีย์อื่น / รูปผิด = RF_INVALID_RECIPE (private.rf_parse_extrusion_spec ใหม่ · {} = null)
--      แก้ได้ในร่างสูตร (RB / กลุ่มวางแผน) และอยู่ในเนื้อหาที่ต้องตรงตอนอนุมัติ · revision ที่อนุมัติแล้วแก้ไม่ได้รวมช่องนี้ (RF_REVISION_IMMUTABLE)
--      rf_save_lots กักล็อตฉีดเฉพาะค่าที่สูตร (revision ที่ WO ผูก) กำหนด · สูตรไม่มีสเปก = เก็บค่าที่วัด ไม่กักตามมิติ · ข้อความเหตุผลรูปเดิม
--      rf_records ส่ง extrusionSpec เมื่อไม่ว่าง · ไม่เติมสเปกให้สูตรเดิมในฐานข้อมูล (สูตรที่ต้องการสเปกออก revision ใหม่แล้วให้หัวหน้า RB อนุมัติ)
--   3) BOM (private.bom_save_boms): revision ที่มีอยู่แก้บรรทัด / หมายเหตุในฉบับเดิมได้เมื่อครบทุกข้อ (ไม่ครบ = BOM_REVISION_IMMUTABLE เหมือนเดิม)
--      - ฉบับเดิมและที่ส่งมาเป็น approved และเป็น revision สูงสุดของชิ้นนั้น
--      - ผู้อนุมัติฉบับนั้น (approved_by) คือผู้บันทึกครั้งนี้ และอนุมัติวันเดียวกับวันนี้ตามเวลา Asia/Bangkok
--      - ไม่มีใบสั่งผลิตที่ไม่ใช่ร่าง (รวม cancelled) ที่ explosion อ้าง bomId ของฉบับนี้
--      - changeLog ต่อท้ายอย่างน้อยหนึ่งรายการ (private.bom_log เดิม ผู้ทำเป็น persona)
--      บรรทัดถูกแทนทั้งชุด (bom_bom_lines ลบแล้วเขียนใหม่) แถว bom_boms ถูกประทับ changed_version ใหม่ ชิ้นนั้นเข้ารายการตรวจกฎ / วงจรเหมือน revision ใหม่
--      revision ใหม่ (max + 1) ยังบันทึกได้เหมือนเดิม
--   4) ยอดของงาน (private.bom_save_jobs): ยอดดี / เสียที่เปลี่ยนต้องเท่าผลรวมดี / เสียของรายการรายงานใหม่ในคำสั่งเดียวกัน ทุกผู้เรียกรวมกลุ่มวางแผน
--      (เดิมตรวจเฉพาะพนักงานแผนก) ยอดจึงลดไม่ได้อีก · พนักงานแผนก: งาน done แก้ไม่ได้และยอดลดไม่ได้ เหมือนเดิม
--      ยังทำได้: ปิด / พักพร้อมเหตุผล (ยอดไม่เปลี่ยน) · ฝ่ายวางแผนคืนงาน in_progress ที่ไม่มียอดเป็น queued แล้วลดแผน (#376 คงไว้)
--      ไม่ผ่านฟังก์ชันนี้จึงไม่กระทบ: ป้อนกลับจาก RubberFlow (private.rf_apply_feedback) · เบิก / คืนของซื้อ (bom_issue_parts / bom_return_parts)
--
-- นิยามที่ replace (เริ่มจากนิยามล่าสุดบน main · security definer + set search_path = '' และ revoke / grant เหมือนต้นทาง)
--   - private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint)                        จาก 20261107010000_rubberflow_core.sql
--   - private.rf_records(bigint)                                                          จาก 20261110010000_rf_purchase_orders.sql
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.bom_cancel_rf_orders(uuid)                                                  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) จาก 20261128010000_bom_cancel_rf_stop.sql (drop + create: คืน jsonb)
--   - private.bom_save_boms(uuid, text, jsonb, bigint, bigint)                             จาก 20261105010000_bom_master_data.sql
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)                          จาก 20261128020000_bom_po_partial_fg_reverse.sql (revoke all from public, anon · grant execute to authenticated)
--   ใหม่: private.rf_parse_extrusion_spec(jsonb) · private.bom_cancel_rf_job(text, text) (revoke all from public, anon, authenticated)
--   ตาราง: rf_recipes เพิ่มคอลัมน์ extrusion_spec jsonb null + check (null หรือ object) · ไม่แตะ RLS และสิทธิ์ตาราง (ตาราง rf_* ยังเข้าถึงตรงไม่ได้)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ส่ง extrusionSpec ของสูตร และแก้ BOM ในฉบับเดิม จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของทุกฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางข้างบน แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (anon เรียก app_bom_save_master ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้)
--   Pilot เก่า + ฐานข้อมูลใหม่: ปิดงานที่ผูก WO แล้ว WO ถูกยกเลิก / หยุดด้วย (ข้อความแจ้งเดิมของ Pilot เก่าบอกเลข WO ได้อยู่แล้ว) · ล็อตฉีดของสูตรที่ไม่มีสเปกไม่ถูกกักตามมิติ
--     (หน้าฟอร์มรุ่นเก่ายังแสดงมาตรฐาน Door Seal) · แก้ BOM สร้าง revision ใหม่ทุกครั้งเหมือนเดิม · สูตรที่ Pilot เก่าออก revision ใหม่ไม่มีสเปก (ฟอร์มเก่าไม่มีช่อง)
--   Pilot ใหม่ + ฐานข้อมูลเก่า: บันทึกสูตรที่มีสเปก = สเปกถูกเมิน (คอลัมน์ไม่มี) แต่อนุมัติสูตรที่มีสเปกไม่ได้ (สำเนาไม่ตรง RF_INVALID_TRANSITION) ·
--     แก้ BOM วันเดียวกันในฉบับเดิม = BOM_REVISION_IMMUTABLE (ไม่มีอะไรถูกเขียน) · ปิดงานที่ผูก WO แล้ว WO ยังเปิด (เหมือนก่อนไฟล์นี้) · ข้อมูลไม่เสียหาย
--
-- Rollback (ข้อมูลทดสอบเท่านั้น): create or replace ฟังก์ชันทั้งหมดกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke / grant)
--   โดย bom_save_jobs ต้อง drop แล้วสร้างกลับ (คืน uuid[]) พร้อม app_bom_save_master ของ 20261128020000 ในธุรกรรมเดียวกัน · drop function private.bom_cancel_rf_job(text, text),
--   private.rf_parse_extrusion_spec(jsonb) · alter table public.rf_recipes drop column extrusion_spec (สเปกที่ตั้งไว้หาย ล็อตที่บันทึกแล้วคงผลเดิม)
--   BOM ที่แก้ในฉบับเดิมคงบรรทัดล่าสุด (changeLog บอกการแก้) · ล้างข้อมูลทดสอบได้ด้วย app_sandbox_purge_bom / app_sandbox_purge_rf ตามปกติ
-- ============================================================================

-- 1. สูตรยาง: สเปกมิติการฉีด (null = ไม่มีสเปก ล็อตฉีดไม่ถูกกักตามมิติ) ----------------------------------------------------------------
alter table public.rf_recipes add column extrusion_spec jsonb;
alter table public.rf_recipes add constraint rf_recipes_extrusion_spec_check
  check (extrusion_spec is null or jsonb_typeof(extrusion_spec) = 'object');
comment on column public.rf_recipes.extrusion_spec is
  'สเปกมิติการฉีดของสูตร { thickness?: {target, tol}, width?: {...}, weightPerM?: {...} } (mm, mm, g/m) · null = ไม่มีสเปก · ตรวจรูปใน private.rf_parse_extrusion_spec';

-- อ่านสเปกจาก payload ของสูตร: null / ไม่มี = null · ต้องเป็น object ที่มีเฉพาะ thickness / width / weightPerM แต่ละตัว { target > 0, tol >= 0 } (ไม่เกิน 1,000,000)
-- คืนรูปเดียวกับที่เก็บ (ตัวเลขตัดศูนย์ท้าย) ให้เทียบกับแถวเดิมได้ · ไม่มีคีย์เลย = null · ผิด = RF_INVALID_RECIPE
create or replace function private.rf_parse_extrusion_spec(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_key text;
  v_el jsonb;
  v_target numeric;
  v_tol numeric;
  v_out jsonb := '{}'::jsonb;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then return null; end if;
  if jsonb_typeof(p_node) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
  for v_key, v_el in select e.key, e.value from jsonb_each(p_node) as e loop
    if v_key not in ('thickness', 'width', 'weightPerM') then raise exception 'RF_INVALID_RECIPE'; end if;
    if jsonb_typeof(v_el) is distinct from 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    if exists (select 1 from jsonb_object_keys(v_el) as k(name) where k.name not in ('target', 'tol')) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_target := private.bom_num(v_el -> 'target', 'RF_INVALID_RECIPE', 0, 1000000);
    v_tol := private.bom_num(v_el -> 'tol', 'RF_INVALID_RECIPE', 0, 1000000);
    if v_target is null or v_target <= 0 or v_tol is null then raise exception 'RF_INVALID_RECIPE'; end if;
    v_out := v_out || jsonb_build_object(v_key, jsonb_build_object('target', trim_scale(v_target), 'tol', trim_scale(v_tol)));
  end loop;
  if v_out = '{}'::jsonb then return null; end if;
  return v_out;
end;
$$;
revoke all on function private.rf_parse_extrusion_spec(jsonb) from public, anon, authenticated;

-- 2. สูตร PHR: สเปกการฉีดเป็นเนื้อหาของสูตร (ร่างแก้ได้ อนุมัติแล้วแก้ไม่ได้ ต้องตรงตอนอนุมัติ) (นิยามจาก 20261107010000_rubberflow_core.sql) ----------
create or replace function private.rf_save_recipes(p_actor uuid, p_head boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_seen text[] := '{}';
  v_approving text[] := '{}';
  v_code text;
  v_rev numeric;
  v_pcode text;
  v_uom text;
  v_batch numeric;
  v_stages jsonb;
  v_el jsonb;
  v_i integer;
  v_mixer numeric;
  v_dump numeric;
  v_mix numeric;
  v_tol numeric;
  v_rest numeric;
  v_yield numeric;
  v_items jsonb;
  v_status text;
  v_old public.rf_recipes%rowtype;
  v_latest public.rf_recipes%rowtype;
  v_found boolean;
  v_has_latest boolean;
  v_same boolean;
  v_spec jsonb;
begin
  -- รหัสสูตรที่มีแถวกำลังจะเป็น approved ในคำสั่งนี้ (ใช้ยอมรับสำเนา superseded ของตัวเดิมที่ client ส่งมาด้วย)
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    if private.bom_text(v_row, 'status', 20, 0, 'RF_INVALID_RECIPE') = 'approved' then
      v_approving := v_approving || private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'RF_INVALID_RECIPE', 1, 9999);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'RF_INVALID_RECIPE'; end if;
    if (v_code || '#' || v_rev::integer) = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || (v_code || '#' || v_rev::integer);
    v_pcode := private.bom_text(v_row, 'productCode', 60, 0, 'RF_INVALID_RECIPE');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_RECIPE'), ''), 'm');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_batch := private.bom_num(v_row -> 'batchKg', 'RF_INVALID_RECIPE', 0, 1000000);
    v_tol := coalesce(private.bom_num(v_row -> 'dumpTol', 'RF_INVALID_RECIPE', 0, 100), 5);
    -- ผสมสองขั้น: ต้องมีขั้น 1 และขั้น 2 อย่างละหนึ่ง (เก็บเรียง 1, 2 ให้เทียบกับที่เก็บได้) อุณหภูมิ 0-1000 °C เวลา > 0 ถึง 1440 นาที
    v_node := v_row -> 'stages';
    if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) <> 2 then raise exception 'RF_INVALID_RECIPE'; end if;
    v_stages := '[]'::jsonb;
    for v_i in 1..2 loop
      select t.e into v_el from jsonb_array_elements(v_node) as t(e) where jsonb_typeof(t.e) = 'object' and t.e ->> 'stage' = v_i::text;
      if not found then raise exception 'RF_INVALID_RECIPE'; end if;
      v_mixer := private.bom_num(v_el -> 'mixerTemp', 'RF_INVALID_RECIPE', 0, 1000);
      v_dump := private.bom_num(v_el -> 'dumpTemp', 'RF_INVALID_RECIPE', 0, 1000);
      v_mix := private.bom_num(v_el -> 'mixMin', 'RF_INVALID_RECIPE', 0, 1440);
      if v_mixer is null or v_dump is null or v_mix is null or v_mix <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
      v_stages := v_stages || jsonb_build_array(jsonb_build_object('stage', v_i, 'mixerTemp', v_mixer, 'dumpTemp', v_dump, 'mixMin', v_mix));
    end loop;
    v_rest := coalesce(private.bom_num(v_row -> 'restHours', 'RF_INVALID_RECIPE', 0, 1000), 4);
    v_yield := private.bom_num(v_row -> 'yieldPerKg', 'RF_INVALID_RECIPE', 0, 1000000000);
    if v_batch is null or v_batch <= 0 or v_yield is null or v_yield <= 0 then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_RECIPE');
    if v_status not in ('draft', 'approved', 'superseded') then raise exception 'RF_INVALID_RECIPE'; end if;
    -- สเปกมิติการฉีด (20261129010000): ไม่ส่ง / null = ไม่มีสเปก
    v_spec := private.rf_parse_extrusion_spec(v_row -> 'extrusionSpec');

    select * into v_old from public.rf_recipes r where r.is_test and r.recipe_code = v_code and r.revision = v_rev::integer;
    v_found := found;
    select * into v_latest from public.rf_recipes r where r.is_test and r.recipe_code = v_code order by r.revision desc limit 1;
    v_has_latest := found;
    v_node := case when v_found then v_old.items when v_has_latest then v_latest.items end;
    v_items := private.rf_parse_items(v_row -> 'items', v_node);

    if v_found then
      v_same := v_old.product_code = v_pcode and v_old.uom = v_uom
        and v_old.batch_kg = v_batch and v_old.stages = v_stages and v_old.dump_tol = v_tol
        and v_old.rest_hours = v_rest and v_old.yield_per_kg = v_yield and v_old.items = v_items
        and v_old.extrusion_spec is not distinct from v_spec;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if v_same and v_old.status = v_status then continue; end if;

      -- ชนก่อนสิทธิ์/กฎ revision เสมอ: แถวถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if v_old.status = 'draft' then
        if v_status = 'draft' then
          update public.rf_recipes set
            product_code = v_pcode, uom = v_uom, batch_kg = v_batch, stages = v_stages,
            dump_tol = v_tol, rest_hours = v_rest, yield_per_kg = v_yield, items = v_items, extrusion_spec = v_spec, updated_at = now()
          where id = v_old.id;
        elsif v_status = 'approved' then
          -- อนุมัติ: หัว RB เท่านั้น และเนื้อหาต้องตรงกับที่เก็บ (แก้พร้อมอนุมัติในคำสั่งเดียวไม่ได้)
          if not p_head then raise exception 'RF_FORBIDDEN'; end if;
          if not v_same then raise exception 'RF_INVALID_TRANSITION'; end if;
          update public.rf_recipes set status = 'superseded', superseded_at = now(), updated_at = now()
          where is_test and recipe_code = v_code and status = 'approved' and id <> v_old.id;
          update public.rf_recipes set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
          where id = v_old.id;
        else
          raise exception 'RF_INVALID_TRANSITION';
        end if;
      elsif v_old.status = 'approved' then
        if not v_same then raise exception 'RF_REVISION_IMMUTABLE'; end if;
        -- approved -> superseded เกิดเองตอนอนุมัติ revision ใหม่ ยอมรับสำเนา superseded ที่มาพร้อมการอนุมัตินั้น (ข้าม) อย่างอื่นไม่ได้
        if v_status = 'superseded' and v_code = any (v_approving) then continue; end if;
        raise exception 'RF_INVALID_TRANSITION';
      else
        -- superseded เป็นสถานะสุดท้าย
        raise exception 'RF_REVISION_IMMUTABLE';
      end if;
      continue;
    end if;

    -- ระเบียนใหม่: เริ่มเป็นร่างเสมอ
    if v_status <> 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if not v_has_latest then
      -- สูตรใหม่ทั้งรหัส: รหัสที่ต่างจากของเดิมแค่ตัวพิมพ์ = ซ้ำ · revision แรกต้องเป็น 1
      if exists (select 1 from public.rf_recipes r where r.is_test and upper(r.recipe_code) = upper(v_code)) then
        raise exception 'RF_CONFLICT';
      end if;
      if v_rev <> 1 then raise exception 'RF_REVISION_ORDER'; end if;
    else
      if v_rev::integer <> v_latest.revision + 1 then
        -- มีคนแก้สูตรนี้หลังเวอร์ชันฐาน = ถือสำเนาเก่า (ตามทันแล้วทำใหม่) ไม่เช่นนั้นข้ามลำดับเอง
        if exists (select 1 from public.rf_recipes r where r.is_test and r.recipe_code = v_code
                   and r.changed_version > p_base and r.changed_version <= p_cur) then
          raise exception 'RF_STALE';
        end if;
        raise exception 'RF_REVISION_ORDER';
      end if;
      -- มีร่างค้างอยู่แล้ว: ให้แก้ร่างนั้น ไม่เปิดร่างที่สอง
      if v_latest.status = 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    end if;
    insert into public.rf_recipes (
      is_test, recipe_code, revision, product_code, uom, batch_kg, stages, dump_tol, rest_hours,
      yield_per_kg, items, status, created_by, extrusion_spec)
    values (true, v_code, v_rev::integer, v_pcode, v_uom, v_batch, v_stages, v_tol, v_rest,
            v_yield, v_items, 'draft', p_actor, v_spec);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 3. snapshot / delta: สูตรส่ง extrusionSpec เมื่อมีสเปก (นิยามจาก 20261110010000_rf_purchase_orders.sql) -------------------------------------
create or replace function private.rf_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', m.code, 'name', m.name, 'category', m.category, 'storage', m.storage_location, 'uom', m.uom, 'active', m.active,
          'safetyKg', m.safety_kg, 'shelfLifeDays', m.shelf_life_days, 'createdAt', private.bom_ms(m.created_at)) order by m.code collate "C")
      from public.rf_materials m where m.is_test and m.changed_version > p_since), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.recipe_code, 'revision', r.revision, 'productCode', r.product_code,
          'uom', r.uom, 'batchKg', r.batch_kg, 'stages', r.stages, 'dumpTol', r.dump_tol,
          'restHours', r.rest_hours, 'yieldPerKg', r.yield_per_kg, 'items', r.items, 'status', r.status,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.approved_at is null then '{}'::jsonb
                else jsonb_build_object('approvedBy', coalesce(private.bom_person(r.approved_by), ''), 'approvedAt', private.bom_ms(r.approved_at)) end
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        || case when r.extrusion_spec is null then '{}'::jsonb else jsonb_build_object('extrusionSpec', r.extrusion_spec) end
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.wo_no, 'customer', o.customer, 'customerPo', o.customer_po, 'recipeId', o.recipe_code, 'recipeRevision', o.recipe_revision,
          'productCode', o.product_code, 'uom', o.uom, 'color', o.color,
          'targetQty', o.target_qty, 'producedQty', o.produced_qty, 'startDate', o.start_date, 'dueDate', o.due_date,
          'priority', o.priority, 'note', o.note, 'status', o.status,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.target_kg is null then '{}'::jsonb else jsonb_build_object('targetKg', o.target_kg) end
        || case when o.kg_per_unit is null then '{}'::jsonb else jsonb_build_object('kgPerUnit', o.kg_per_unit) end
        || case when o.source_job_no is null then '{}'::jsonb else jsonb_build_object('sourceJobId', o.source_job_no) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at), 'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at)) end
        order by o.created_at desc, o.wo_no collate "C" desc)
      from public.rf_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
    'molds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.mold_no, 'name', d.name, 'kind', d.kind, 'unit', d.unit, 'perCycle', d.per_cycle, 'cleanEvery', d.clean_every,
          'pmLimit', d.pm_limit, 'totalUsage', d.total_usage, 'usageSinceClean', d.usage_since_clean)
        || case when d.last_clean_at is null then '{}'::jsonb else jsonb_build_object('lastCleanAt', private.bom_ms(d.last_clean_at)) end
        order by d.mold_no collate "C")
      from public.rf_molds d where d.is_test and d.changed_version > p_since), '[]'::jsonb),
    'materialLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'lotNo', l.lot_no, 'materialCode', l.material_code, 'qtyKg', l.qty_kg, 'initialKg', l.initial_kg, 'expiry', l.expiry,
          'supplier', l.supplier, 'location', l.location, 'status', l.status, 'coa', l.coa,
          'receivedAt', private.bom_ms(l.received_at), 'receivedBy', coalesce(private.bom_person(l.received_by), ''))
        order by l.lot_no collate "C")
      from public.rf_material_lots l where l.is_test and l.changed_version > p_since), '[]'::jsonb),
    'requisitions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.req_no, 'orderId', q.order_no, 'recipeId', q.recipe_code, 'recipeRevision', q.recipe_revision,
          'batches', q.batches, 'totalKg', q.total_kg, 'lines', q.lines, 'status', q.status, 'note', q.note,
          'requestedBy', coalesce(private.bom_person(q.requested_by), ''), 'createdAt', private.bom_ms(q.created_at))
        || case when q.issued_at is null then '{}'::jsonb
                else jsonb_build_object('issuedAt', private.bom_ms(q.issued_at), 'issuedBy', coalesce(private.bom_person(q.issued_by), '')) end
        || case when q.consumed_by_lot is null then '{}'::jsonb else jsonb_build_object('consumedBy', q.consumed_by_lot) end
        order by q.req_no collate "C")
      from public.rf_requisitions q where q.is_test and q.changed_version > p_since), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.lot_no, 'stage', t.stage, 'orderId', t.order_no, 'uom', t.uom, 'machine', t.machine, 'shift', t.shift,
          'sources', t.sources, 'params', t.params, 'goodQty', t.good_qty, 'scrapQty', t.scrap_qty, 'scrapReason', t.scrap_reason,
          'qc', t.qc, 'holdReasons', t.hold_reasons, 'transferredQty', t.transferred_qty,
          'createdAt', private.bom_ms(t.created_at), 'operator', coalesce(private.bom_person(t.created_by), ''))
        || case when t.recipe_code is null then '{}'::jsonb else jsonb_build_object('recipeId', t.recipe_code) end
        || case when t.ready_at is null then '{}'::jsonb else jsonb_build_object('readyAt', private.bom_ms(t.ready_at)) end
        || case when t.stage = 'extrusion' and t.mold_id is not null then jsonb_build_object('dieId', t.mold_id)
                when t.stage = 'curing' and t.mold_id is not null then jsonb_build_object('moldId', t.mold_id)
                else '{}'::jsonb end
        || case when t.stage = 'finishing' then jsonb_build_object('grade', t.grade, 'boxes', t.boxes, 'countedToOrder', t.counted_to_order) else '{}'::jsonb end
        order by t.lot_no collate "C")
      from public.rf_lots t where t.is_test and t.changed_version > p_since), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.transfer_no, 'lotId', x.lot_no, 'orderId', x.order_no, 'from', x.from_stage, 'to', x.to_stage, 'uom', x.uom,
          'qtySent', x.qty_sent, 'qtyReceived', x.qty_received, 'remaining', x.remaining, 'condition', x.condition, 'note', x.note,
          'status', x.status, 'createdAt', private.bom_ms(x.created_at), 'createdBy', coalesce(private.bom_person(x.created_by), ''),
          'sentAt', private.bom_ms(x.created_at), 'sentBy', coalesce(private.bom_person(x.created_by), ''))
        || case when x.received_at is null then '{}'::jsonb
                else jsonb_build_object('receivedAt', private.bom_ms(x.received_at), 'receivedBy', coalesce(private.bom_person(x.received_by), '')) end
        order by x.transfer_no collate "C")
      from public.rf_transfers x where x.is_test and x.changed_version > p_since), '[]'::jsonb),
    'fgBoxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.box_no, 'lotId', b.lot_no, 'orderId', b.order_no, 'recipeId', b.recipe_code, 'productCode', b.product_code,
          'qty', b.qty, 'uom', b.uom, 'grade', b.grade, 'status', b.status, 'createdAt', private.bom_ms(b.created_at))
        || case when b.shipped_at is null then '{}'::jsonb
                else jsonb_build_object('shippedAt', private.bom_ms(b.shipped_at), 'shippedBy', coalesce(private.bom_person(b.shipped_by), '')) end
        order by b.box_no collate "C")
      from public.rf_fg_boxes b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'qcRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.qc_no, 'lotId', c.lot_no, 'orderId', c.order_no, 'stage', c.stage, 'tests', c.tests, 'result', c.result, 'note', c.note,
          'inspector', coalesce(private.bom_person(c.tested_by), ''), 'at', private.bom_ms(c.tested_at),
          'testedBy', coalesce(private.bom_person(c.tested_by), ''), 'testedAt', private.bom_ms(c.tested_at))
        order by c.qc_no collate "C")
      from public.rf_qc_records c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'ncrs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.ncr_no, 'title', n.title, 'stage', n.stage, 'lotId', n.lot_no, 'severity', n.severity, 'defectQty', n.defect_qty,
          'whys', n.whys, 'containment', n.containment, 'corrective', n.corrective, 'preventive', n.preventive, 'owner', n.owner,
          'status', n.status, 'createdAt', private.bom_ms(n.created_at), 'createdBy', coalesce(private.bom_person(n.created_by), ''),
          'openedAt', private.bom_ms(n.created_at), 'openedBy', coalesce(private.bom_person(n.created_by), ''))
        || case when n.closed_at is null then '{}'::jsonb
                else jsonb_build_object('closedAt', private.bom_ms(n.closed_at), 'closedBy', coalesce(private.bom_person(n.closed_by), ''), 'verification', n.verification) end
        order by n.ncr_no collate "C")
      from public.rf_ncrs n where n.is_test and n.changed_version > p_since), '[]'::jsonb),
    'purchaseOrders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.po_no, 'status', o.status, 'sourcePi', o.source_pi, 'sourceRequisition', o.source_requisition, 'note', o.note,
          'lines', o.lines, 'createdAt', private.bom_ms(o.created_at), 'createdBy', coalesce(private.bom_person(o.created_by), ''),
          'cancelledAt', private.bom_ms(o.cancelled_at))
        order by o.po_no collate "C")
      from public.rf_purchase_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- 4. ล็อตฉีด: เทียบมิติกับสเปกของสูตรที่ WO ผูก แทนค่าตายตัวของ Door Seal (นิยามจาก 20261128010000_bom_cancel_rf_stop.sql) -------------------------
create or replace function private.rf_save_lots(
  p_actor public.employees, p_actor_name text, p_may boolean, p_may_close boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_old public.rf_lots%rowtype;
  v_stage text;
  v_prefix text;
  v_params jsonb;
  v_srcs jsonb;
  v_src jsonb;
  v_src_id text;
  v_use numeric;
  v_machine text;
  v_shift text;
  v_reason text;
  v_good numeric;
  v_scrap numeric;
  v_order_no text;
  v_req public.rf_requisitions%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_tr public.rf_transfers%rowtype;
  v_ord public.rf_orders%rowtype;
  v_mold public.rf_molds%rowtype;
  v_mold_id text;
  v_stage_arr jsonb;
  v_stages jsonb;
  v_i integer;
  v_el jsonb;
  v_std jsonb;
  v_mixer numeric;
  v_dump numeric;
  v_mix numeric;
  v_issued numeric;
  v_reasons jsonb;
  v_qc text;
  v_ready timestamptz;
  v_uom text;
  v_out jsonb;
  v_sources jsonb;
  v_grade text;
  v_perbox numeric;
  v_boxes integer;
  v_rework numeric;
  v_pct numeric;
  v_thick numeric;
  v_width numeric;
  v_wpm numeric;
  v_espec jsonb;
  v_temp numeric;
  v_time numeric;
  v_press numeric;
  v_shots numeric;
  v_cid text;
  v_flot public.rf_lots%rowtype;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_LOT'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_LOT');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_LOT'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_lots l where l.is_test and l.lot_no = v_no;
    if found then
      -- เลขล็อตซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- ล็อตเดิม: ข้ามเวลาบ่ม (endRest) ได้อย่างเดียว ช่องอื่นเป็นของเซิร์ฟเวอร์
      if p_action = 'endRest' and v_old.ready_at is not null and jsonb_typeof(v_row -> 'readyAt') = 'number'
         and (v_row ->> 'readyAt')::numeric <> private.bom_ms(v_old.ready_at) then
        if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
        -- ข้ามเวลาบ่ม (20261128010000): หัวหน้า RB (private.rf_is_rb_head รวมผู้ช่วยผู้จัดการโรงงานขึ้นไปและ admin) หรือแผนก QA (private.rf_is_qa) เท่านั้น
        -- พนักงาน RB ทั่วไปและกลุ่มวางแผนที่ไม่ใช่สองกลุ่มนี้ = RF_FORBIDDEN · เหตุผล 3-300 ตัวอักษร (params.skipRest.reason ของแถวที่ส่งมา ไม่มี/สั้น/ยาวเกิน = RF_INVALID_LOT)
        -- เซิร์ฟเวอร์เก็บ { by, reason, at } ไว้ที่ params.skipRest ของล็อต (ผู้ทำและเวลาเซิร์ฟเวอร์ตั้ง ไม่เชื่อ client) · ล็อตที่บ่มครบแล้วไม่เขียนอะไร
        if not (private.rf_is_rb_head(p_actor) or private.rf_is_qa(p_actor)) then raise exception 'RF_FORBIDDEN'; end if;
        v_reason := private.bom_text(v_row #> '{params,skipRest}', 'reason', 300, 3, 'RF_INVALID_LOT');
        update public.rf_lots set
          ready_at = now(),
          params = params || jsonb_build_object('skipRest', jsonb_build_object('by', p_actor_name, 'reason', v_reason, 'at', private.bom_ms(now()))),
          updated_at = now()
        where id = v_old.id and ready_at > now();
      end if;
      continue;
    end if;

    -- ล็อตใหม่ -------------------------------------------------------------------------------
    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    v_stage := private.bom_text(v_row, 'stage', 12, 1, 'RF_INVALID_LOT');
    if v_stage not in ('mixing', 'extrusion', 'curing', 'finishing') then raise exception 'RF_INVALID_LOT'; end if;
    v_prefix := case v_stage when 'mixing' then 'MX' when 'extrusion' then 'EX' when 'curing' then 'CU' else 'FN' end;
    if v_no !~ ('^' || v_prefix || '-[A-Za-z0-9._-]{1,50}$') then raise exception 'RF_INVALID_LOT'; end if;
    v_params := coalesce(v_row -> 'params', '{}'::jsonb);
    if jsonb_typeof(v_params) <> 'object' then raise exception 'RF_INVALID_LOT'; end if;
    v_machine := private.bom_text(v_row, 'machine', 120, 0, 'RF_INVALID_LOT');
    v_shift := private.bom_text(v_row, 'shift', 10, 0, 'RF_INVALID_LOT');
    v_reason := private.bom_text(v_row, 'scrapReason', 200, 0, 'RF_INVALID_LOT');
    v_good := private.bom_num(v_row -> 'goodQty', 'RF_INVALID_LOT', 0, 1000000000);
    v_scrap := coalesce(private.bom_num(v_row -> 'scrapQty', 'RF_INVALID_LOT', 0, 1000000000), 0);
    if v_good is null then raise exception 'RF_INVALID_LOT'; end if;
    v_srcs := v_row -> 'sources';
    if jsonb_typeof(v_srcs) is distinct from 'array' then raise exception 'RF_INVALID_LOT'; end if;
    v_src := null;
    select t.e into v_src from jsonb_array_elements(v_srcs) as t(e)
    where jsonb_typeof(t.e) = 'object'
      and coalesce(t.e ->> 'type', t.e ->> 'kind') = case when v_stage = 'mixing' then 'requisition' else 'transfer' end
    limit 1;
    if v_src is null then raise exception 'RF_INVALID_LOT'; end if;
    v_src_id := private.bom_text(v_src, 'id', 60, 1, 'RF_INVALID_LOT');
    v_reasons := '[]'::jsonb;
    v_mold_id := null;
    v_ready := null;
    v_grade := '';
    v_boxes := null;
    v_rec := null;

    if v_stage = 'mixing' then
      select * into v_req from public.rf_requisitions q where q.is_test and q.req_no = v_src_id for update;
      if not found then raise exception 'RF_INVALID_LOT'; end if;
      if v_req.status <> 'issued' then
        perform private.rf_fail(v_req.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
      end if;
      v_order_no := v_req.order_no;
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_req.recipe_code and r.revision = v_req.recipe_revision;
      -- ผสมสองขั้น: บันทึกทั้งสองขั้น Dump temp ของแต่ละขั้นเทียบกับค่าของสูตรในขั้นนั้นด้วยค่าเผื่อ dumpTol เดียวกัน ขั้นไหนหลุด = ล็อตถูก QC Hold
      v_stage_arr := v_params -> 'stages';
      if jsonb_typeof(v_stage_arr) is distinct from 'array' or jsonb_array_length(v_stage_arr) <> 2 then raise exception 'RF_INVALID_LOT'; end if;
      v_stages := '[]'::jsonb;
      for v_i in 1..2 loop
        select t.e into v_el from jsonb_array_elements(v_stage_arr) as t(e) where jsonb_typeof(t.e) = 'object' and t.e ->> 'stage' = v_i::text;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_mixer := private.bom_num(v_el -> 'mixerTemp', 'RF_INVALID_LOT', 0, 1000);
        v_dump := private.bom_num(v_el -> 'dumpTemp', 'RF_INVALID_LOT', 0, 1000);
        v_mix := private.bom_num(v_el -> 'mixMin', 'RF_INVALID_LOT', 0, 1440);
        if v_mixer is null or v_dump is null or v_mix is null or v_mix <= 0 then raise exception 'RF_INVALID_LOT'; end if;
        select t.e into v_std from jsonb_array_elements(v_rec.stages) as t(e) where t.e ->> 'stage' = v_i::text;
        -- สูตรที่ไม่มีค่ามาตรฐานของขั้นนี้ (ข้อมูลรูปเก่า) บันทึกไม่ได้ แทนที่จะปล่อยผ่านโดยไม่เทียบ
        if not found then raise exception 'RF_INVALID_RECIPE'; end if;
        if abs(v_dump - (v_std ->> 'dumpTemp')::numeric) > v_rec.dump_tol then
          v_reasons := v_reasons || to_jsonb('Dump temp ขั้น ' || v_i || ' ' || trim_scale(v_dump)::text || '°C นอกช่วง '
            || trim_scale((v_std ->> 'dumpTemp')::numeric)::text || '±' || trim_scale(v_rec.dump_tol)::text);
        end if;
        v_stages := v_stages || jsonb_build_array(jsonb_build_object('stage', v_i, 'mixerTemp', v_mixer, 'dumpTemp', v_dump, 'mixMin', v_mix));
      end loop;
      v_issued := coalesce((select sum((e ->> 'actualKg')::numeric) from jsonb_array_elements(v_req.lines) e), 0);
      if v_good + v_scrap > v_issued + 0.5 then raise exception 'RF_INVALID_LOT'; end if;
      v_uom := 'kg';
      v_ready := now() + v_rec.rest_hours::double precision * interval '1 hour';
      v_out := jsonb_build_object('stages', v_stages, 'batches', v_req.batches);
      v_sources := jsonb_build_array(jsonb_build_object('type', 'requisition', 'id', v_req.req_no));
    else
      -- ฉีด / อบ / ตกแต่ง: รับจากใบส่งมอบที่รับมอบแล้วและส่งมาสถานีนี้
      select * into v_tr from public.rf_transfers t where t.is_test and t.transfer_no = v_src_id for update;
      if not found or v_tr.to_stage <> v_stage then raise exception 'RF_INVALID_LOT'; end if;
      if v_tr.status <> 'received' then
        perform private.rf_fail(v_tr.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
      end if;
      v_use := private.bom_num(v_src -> 'qty', 'RF_INVALID_LOT', 0, 1000000000);
      if v_use is null or v_use <= 0 then raise exception 'RF_INVALID_LOT'; end if;
      if v_use > v_tr.remaining + 0.000000001 then
        perform private.rf_fail(v_tr.changed_version, p_base, p_cur, 'RF_INVALID_LOT');
      end if;
      v_order_no := v_tr.order_no;
      select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order_no;
      v_uom := v_ord.uom;
      v_sources := jsonb_build_array(jsonb_build_object('type', 'transfer', 'id', v_tr.transfer_no, 'lotId', v_tr.lot_no, 'qty', v_use));

      if v_stage = 'extrusion' then
        v_rework := coalesce(private.bom_num(v_params -> 'reworkKg', 'RF_INVALID_LOT', 0, 1000000000), 0);
        v_pct := v_rework / (v_use + v_rework) * 100;
        if v_pct > 10 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'dieId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test and m.mold_no = v_mold_id for update;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_thick := private.bom_num(v_params -> 'thickness', 'RF_INVALID_LOT', 0, 1000000);
        v_width := private.bom_num(v_params -> 'width', 'RF_INVALID_LOT', 0, 1000000);
        v_wpm := private.bom_num(v_params -> 'weightPerM', 'RF_INVALID_LOT', 0, 1000000);
        if v_thick is null or v_width is null or v_wpm is null then raise exception 'RF_INVALID_LOT'; end if;
        -- สเปกมิติของสูตรยางที่ WO ผูก (revision ของ WO · 20261129010000) แทนค่าตายตัวของเส้น Door Seal: กักเฉพาะค่าที่สูตรกำหนด
        -- สูตรที่ไม่มีสเปก หรือไม่มีค่านั้น = เก็บค่าที่วัด ไม่กักตามมิติ · ข้อความเหตุผลรูปเดิม
        v_espec := null;
        select r.extrusion_spec into v_espec from public.rf_recipes r
        where r.is_test and r.recipe_code = v_ord.recipe_code and r.revision = v_ord.recipe_revision;
        if coalesce(v_espec ? 'thickness', false)
           and not private.rf_in_spec(v_thick, (v_espec #>> '{thickness,target}')::numeric, (v_espec #>> '{thickness,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('ความหนา ' || trim_scale(v_thick)::text || ' mm นอกสเปก');
        end if;
        if coalesce(v_espec ? 'width', false)
           and not private.rf_in_spec(v_width, (v_espec #>> '{width,target}')::numeric, (v_espec #>> '{width,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('ความกว้าง ' || trim_scale(v_width)::text || ' mm นอกสเปก');
        end if;
        if coalesce(v_espec ? 'weightPerM', false)
           and not private.rf_in_spec(v_wpm, (v_espec #>> '{weightPerM,target}')::numeric, (v_espec #>> '{weightPerM,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('น้ำหนักต่อเมตร ' || trim_scale(v_wpm)::text || ' g/m นอกสเปก');
        end if;
        v_out := jsonb_build_object('thickness', v_thick, 'width', v_width, 'weightPerM', v_wpm,
                                    'reworkKg', v_rework, 'reworkPct', trim_scale(round(v_pct, 2)), 'useKg', v_use);
      elsif v_stage = 'curing' then
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'moldId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test and m.mold_no = v_mold_id for update;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_temp := private.bom_num(v_params -> 'temp', 'RF_INVALID_LOT', 0, 1000000);
        v_time := private.bom_num(v_params -> 'time', 'RF_INVALID_LOT', 0, 1000000);
        v_press := private.bom_num(v_params -> 'pressure', 'RF_INVALID_LOT', 0, 1000000);
        if v_temp is null or v_time is null or v_press is null then raise exception 'RF_INVALID_LOT'; end if;
        if not private.rf_in_spec(v_temp, 200, 6, null) then
          v_reasons := v_reasons || to_jsonb('อุณหภูมิอบ ' || trim_scale(v_temp)::text || ' °C นอกสเปก');
        end if;
        if not private.rf_in_spec(v_time, 150, 10, null) then
          v_reasons := v_reasons || to_jsonb('เวลาอบ ' || trim_scale(v_time)::text || ' s นอกสเปก');
        end if;
        if not private.rf_in_spec(v_press, 150, 15, null) then
          v_reasons := v_reasons || to_jsonb('ความดัน ' || trim_scale(v_press)::text || ' bar นอกสเปก');
        end if;
        v_out := jsonb_build_object('temp', v_temp, 'time', v_time, 'pressure', v_press);
        v_machine := v_mold.name;
      else
        v_perbox := private.bom_num(v_params -> 'perBox', 'RF_INVALID_LOT', 0, 1000000000);
        if v_perbox is null or v_perbox <= 0 then raise exception 'RF_INVALID_LOT'; end if;
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_grade := coalesce(nullif(private.bom_text(v_row, 'grade', 20, 0, 'RF_INVALID_LOT'), ''), 'A');
        v_boxes := case when v_good > 0 then ceil(v_good / v_perbox)::integer else 0 end;
        if v_boxes > 1000 then raise exception 'RF_INVALID_LOT'; end if;
        v_out := jsonb_build_object('perBox', v_perbox);
      end if;
    end if;

    -- ล็อตที่ client ระบุใบสั่งผลิตต่างจากเอกสารต้นทาง = ผิด
    v_cid := nullif(private.bom_text(v_row, 'orderId', 40, 0, 'RF_INVALID_LOT'), '');
    if v_cid is not null and v_cid <> v_order_no then raise exception 'RF_INVALID_LOT'; end if;

    -- บันทึกล็อตของสถานีไหนก็ได้เฉพาะใบ WO ที่ released / in_progress / on_hold (planned / completed / cancelled = RF_INVALID_TRANSITION)
    -- ข้อยกเว้นเดียว: ล็อตตกแต่งที่ client ปิดใบเป็น completed ในคำสั่งเดียวกัน (ใบถูกประทับด้วยเวอร์ชันของคำสั่งนี้ เพราะ client ปิดใบเองเมื่อครบเป้า)
    select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order_no for update;
    if not found then raise exception 'RF_INVALID_LOT'; end if;
    if v_ord.status not in ('released', 'in_progress', 'on_hold')
       and not (v_stage = 'finishing' and v_ord.status = 'completed' and v_ord.changed_version > p_cur) then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
    end if;

    if v_stage = 'finishing' then
      -- ผลตัดสินของงานตกแต่งมาจากผู้บันทึก (ผ่านนับเข้าใบทันที) อื่น ๆ รอ QA
      v_qc := coalesce(nullif(private.bom_text(v_row, 'qc', 10, 0, 'RF_INVALID_LOT'), ''), 'pass');
      if v_qc not in ('pass', 'hold', 'fail') then raise exception 'RF_INVALID_LOT'; end if;
      if v_qc <> 'pass' then v_reasons := to_jsonb(array['ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน']); end if;
    else
      v_qc := case when jsonb_array_length(v_reasons) > 0 then 'hold' else 'pass' end;
    end if;

    insert into public.rf_lots (
      is_test, lot_no, stage, order_no, recipe_code, uom, machine, shift, mold_id, sources, params, good_qty, scrap_qty, scrap_reason,
      qc, hold_reasons, transferred_qty, ready_at, grade, boxes, counted_to_order, created_by)
    values (
      true, v_no, v_stage, v_order_no, case when v_stage = 'mixing' then v_rec.recipe_code end, v_uom, v_machine, v_shift, v_mold_id,
      v_sources, v_out, v_good, v_scrap, v_reason, v_qc, v_reasons, 0, v_ready, v_grade, v_boxes, (v_stage = 'finishing' and v_qc = 'pass'), p_actor.id)
    returning * into v_flot;

    -- ผลข้างเคียง (ธุรกรรมเดียวกัน) ---------------------------------------------------------------
    if v_stage = 'mixing' then
      update public.rf_requisitions set status = 'consumed', consumed_by_lot = v_no, updated_at = now() where id = v_req.id;
      update public.rf_orders set status = 'in_progress', updated_at = now() where is_test and wo_no = v_order_no and status = 'released';
    else
      update public.rf_transfers set remaining = trim_scale(round(remaining - v_use, 3)), updated_at = now() where id = v_tr.id;
      if v_stage = 'extrusion' then
        update public.rf_molds set usage_since_clean = usage_since_clean + v_good, total_usage = total_usage + v_good, updated_at = now() where id = v_mold.id;
      elsif v_stage = 'curing' then
        v_shots := ceil((v_good + v_scrap) / v_mold.per_cycle);
        update public.rf_molds set usage_since_clean = usage_since_clean + v_shots, total_usage = total_usage + v_shots, updated_at = now() where id = v_mold.id;
      else
        -- กล่อง: ใบละไม่เกิน perBox ชิ้น (กล่องสุดท้ายเศษ) id = เลขล็อต (FN -> BOX) ต่อด้วยลำดับ 3 หลัก
        for v_i in 1..v_boxes loop
          insert into public.rf_fg_boxes (is_test, box_no, lot_no, order_no, recipe_code, product_code, qty, uom, grade, status)
          values (true, regexp_replace(v_no, 'FN', 'BOX') || '-' || lpad(v_i::text, 3, '0'), v_no, v_order_no, v_ord.recipe_code, v_ord.product_code,
                  trim_scale(round(least(v_perbox, v_good - (v_i - 1) * v_perbox), 3)), v_uom, v_grade,
                  case when v_qc = 'pass' then 'in_stock' else 'hold' end);
        end loop;
        if v_qc = 'pass' then
          perform private.rf_add_produced(v_order_no, v_good, p_may_close, p_base, p_cur);
          -- ชิ้นผ่านสถานีสุดท้าย (ตกแต่ง QC ผ่าน นับเข้า WO) = ป้อนผลผลิตกลับงาน BOM ที่ผูกกับ WO นี้ ณ จุดเดียวกับที่นับเข้า WO
          v_res := private.rf_apply_feedback(p_actor_name, v_flot, v_ord);
          v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
          v_orders := v_orders + (v_res ->> 'orders')::integer;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. ยกเลิก / หยุด WO ที่ผูกงานหนึ่งงาน (ใหม่) ใช้ทั้งตอนยกเลิกใบ / เปิดใบกลับมาแก้ (bom_cancel_rf_orders) และตอนฝ่ายวางแผนปิดงาน (bom_save_jobs) ------------
-- WO ต้องชี้กลับมาที่งานนี้ (source_job_no) ไม่งั้นถือว่าไม่มี WO ให้ยกเลิก · planned / released = ยกเลิก · in_progress / on_hold = หยุด (สถานะ cancelled เหมือนกัน
-- ยอดผลิต ล็อต และบันทึกผสม/ฉีด/อบ/ตกแต่งคงอยู่) · completed / cancelled = คงเดิม · คืนเลข WO ที่ยกเลิก / หยุด หรือ null
-- ล็อกแถวตัวนับ RF ก่อนแตะ WO (ผู้เรียกถือ advisory lock 'mnp_bom_rf_master' และแถว bom_master_state แล้ว) · ผู้เรียกถือแถวงานอยู่
create or replace function private.bom_cancel_rf_job(p_job_no text, p_wo_no text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.rf_orders%rowtype;
begin
  if p_wo_no is null then return null; end if;
  perform private.bom_lock_rf();
  select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = p_wo_no and o.source_job_no = p_job_no for update;
  if not found then return null; end if;
  if v_wo.status in ('planned', 'released', 'in_progress', 'on_hold') then
    update public.rf_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_wo.id;
    return v_wo.wo_no;
  end if;
  return null;
end;
$$;
revoke all on function private.bom_cancel_rf_job(text, text) from public, anon, authenticated;

-- 6. ยกเลิก / หยุด WO ที่ผูกงานของใบ: เรียกตัวช่วยต่องาน (นิยามจาก 20261128010000_bom_cancel_rf_stop.sql · ผลเหมือนเดิม) ----------------------------------
create or replace function private.bom_cancel_rf_orders(p_order_pk uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_cancelled text[] := '{}';
  v_wo_no text;
begin
  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test and j.order_pk = p_order_pk and j.external_ref is not null
    order by j.job_no collate "C"
    for update
  loop
    v_wo_no := private.bom_cancel_rf_job(v_job.job_no, v_job.external_ref ->> 'woId');
    if v_wo_no is not null then v_cancelled := v_cancelled || v_wo_no; end if;
  end loop;
  return v_cancelled;
end;
$$;
revoke all on function private.bom_cancel_rf_orders(uuid) from public, anon, authenticated;

-- 7. งาน: ปิดงานที่ผูก WO แล้ว WO ถูกยกเลิก / หยุด · ยอดเปลี่ยนต้องมีรายงานทุกผู้เรียก (นิยามจาก 20261128010000_bom_cancel_rf_stop.sql) -----------------------
-- คืน jsonb { started: uuid[] (ใบที่งานเริ่มในคำสั่งนี้), cancelled: text[] (WO ที่ยกเลิก / หยุดเพราะปิดงาน) } แทน uuid[] จึง drop แล้วสร้างใหม่ (ลายเซ็นอาร์กิวเมนต์เดิม)
drop function private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint);


create function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_started uuid[] := '{}';
  v_dept_actor text := private.bom_dept_of(p_actor);
  v_no text;
  v_ord public.bom_orders%rowtype;
  v_dept text;
  v_item text;
  v_name text;
  v_kind text;
  v_uom text;
  v_planned numeric;
  v_required numeric;
  v_stock numeric;
  v_done numeric;
  v_reject numeric;
  v_due numeric;
  v_status text;
  v_fg jsonb;
  v_ext jsonb;
  v_reports jsonb;
  v_old public.bom_jobs%rowtype;
  v_struct boolean;
  v_work boolean;
  v_ext_changed boolean;
  v_good numeric;
  v_rej numeric;
  v_ext_stored jsonb;
  v_done_at timestamptz;
  v_present boolean;
  v_contrib numeric;
  v_rep jsonb;
  v_last jsonb;
  v_close_note text;
  v_hold_note text;
  v_rf_cancelled text[] := '{}';
  v_wo_no text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_ord from public.bom_orders o
    where o.is_test and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB'));
    if not found then raise exception 'BOM_INVALID_JOB'; end if;
    v_dept := private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT'));
    v_item := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_JOB'));
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_JOB');
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_JOB');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_JOB'; end if;
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_JOB');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_JOB'; end if;
    v_planned := private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000);
    v_required := private.bom_num(v_row -> 'qtyRequired', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_planned is null or v_required is null then raise exception 'BOM_INVALID_JOB'; end if;
    v_stock := private.bom_num(v_row -> 'stockCounted', 'BOM_INVALID_JOB', 0, 1000000000);
    v_done := coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_reject := coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_due := private.bom_num(v_row -> 'dueAt', 'BOM_INVALID_JOB', 1, 100000000000000);
    if v_due is not null and v_due <> trunc(v_due) then raise exception 'BOM_INVALID_JOB'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB');
    if v_status not in ('queued', 'in_progress', 'done', 'hold') then raise exception 'BOM_INVALID_JOB'; end if;
    v_node := v_row -> 'fgCodes';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 500 then raise exception 'BOM_INVALID_JOB'; end if;
    v_fg := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or char_length(btrim(v_el #>> '{}')) not between 1 and 60 then raise exception 'BOM_INVALID_JOB'; end if;
      v_fg := v_fg || jsonb_build_array(private.bom_code(v_el #>> '{}'));
    end loop;
    v_ext := private.bom_parse_external_ref(v_row -> 'externalRef');

    select * into v_old from public.bom_jobs j where j.is_test and j.job_no = v_no;
    -- ชนก่อนสิทธิ์/รูปเสมอ: งานถูกคนอื่นแก้หลังเวอร์ชันฐาน หรือถูกลบหลังเวอร์ชันฐาน (เปิดใบกลับมาแก้ / ยกเลิก) = ฝั่ง client ถือสำเนาเก่า
    -- เทียบกับแถวล่าสุดแล้วตัดสินว่าไม่มีสิทธิ์ไม่ได้ (สองคนในแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน คนที่สองต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN)
    v_present := found;
    if v_present then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    elsif exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no
                  and k.changed_version > p_base and k.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    if not v_present then
      -- งานใหม่: เกิดตอนปล่อยผลิตเท่านั้น (ใบ draft -> released ในคำสั่งเดียวกัน) เริ่มที่ queued ว่าง
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if not (v_ord.id = any (p_released)) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_status <> 'queued' or v_done <> 0 or v_reject <> 0 or v_ext is not null
         or jsonb_array_length(private.bom_parse_reports(v_row -> 'reports', '[]'::jsonb, p_actor_name)) > 0 then
        raise exception 'BOM_INVALID_JOB';
      end if;
      delete from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values (true, v_no, v_ord.id, v_dept, v_item, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
      continue;
    end if;

    -- ฝ่ายวางแผนปิดงานที่จะไม่รายงานต่อพร้อมเหตุผล (20261125010000): action setJobStatus งานเดิมยังไม่ done -> done และรายการรายงานใหม่หนึ่งรายการท้ายสุด
    -- ที่ยอดดีและยอดเสียเป็น 0 = เหตุผลของการปิด (note 3-200 ตัวอักษร) · private.bom_parse_reports ไม่รับรายการใหม่ที่ยอดเป็น 0 จึงแยกรายการนี้ออกมาเขียนเอง
    -- (เวลาและผู้ทำเซิร์ฟเวอร์ตั้ง) รายการเดิมทั้งหมดยังตรวจด้วย bom_parse_reports · พนักงานแผนก action อื่น หรือไม่มีเหตุผล = รายการยอด 0 ถูกปฏิเสธเหมือนเดิม (BOM_INVALID_JOB)
    v_close_note := null;
    v_rep := v_row -> 'reports';
    if p_planner and p_action = 'setJobStatus' and v_status = 'done' and v_old.status <> 'done' and jsonb_typeof(v_rep) = 'array' then
      if jsonb_array_length(v_rep) = coalesce(jsonb_array_length(v_old.reports), 0) + 1 then
        v_last := v_rep -> (jsonb_array_length(v_rep) - 1);
        if jsonb_typeof(v_last) = 'object' then
          if coalesce(private.bom_num(v_last -> 'good', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0
             and coalesce(private.bom_num(v_last -> 'reject', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0 then
            v_close_note := private.bom_text(v_last, 'note', 200, 3, 'BOM_INVALID_JOB');
          end if;
        end if;
      end if;
    end if;
    -- พักงานพร้อมเหตุผล (20261128010000): action setJobStatus งานเดิมที่ยังไม่ hold -> hold และรายการรายงานใหม่หนึ่งรายการท้ายสุดที่ยอดดีและยอดเสียเป็น 0
    -- = เหตุผลของการพัก (note 3-200 ตัวอักษร) · เซิร์ฟเวอร์เขียนรายการเองแบบเดียวกับการปิดงาน (เวลา ผู้ทำ) พร้อมเครื่องหมาย kind = 'hold' ประวัติของงานจึงเห็นเหตุผล
    -- ผู้พักได้ = ผู้ที่เปลี่ยนสถานะงานนี้ได้อยู่แล้ว (แผนกของงาน หรือกลุ่มวางแผน: ด่านสิทธิ์รายช่องเดิม) · ไม่มีรายการนี้ = พักไม่ได้ (ด่านข้างล่าง)
    v_hold_note := null;
    if p_action = 'setJobStatus' and v_status = 'hold' and v_old.status <> 'hold' and jsonb_typeof(v_rep) = 'array' then
      if jsonb_array_length(v_rep) = coalesce(jsonb_array_length(v_old.reports), 0) + 1 then
        v_last := v_rep -> (jsonb_array_length(v_rep) - 1);
        if jsonb_typeof(v_last) = 'object' then
          if coalesce(private.bom_num(v_last -> 'good', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0
             and coalesce(private.bom_num(v_last -> 'reject', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0 then
            v_hold_note := private.bom_text(v_last, 'note', 200, 3, 'BOM_INVALID_JOB');
          end if;
        end if;
      end if;
    end if;
    if v_close_note is null and v_hold_note is null then
      v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    elsif v_close_note is not null then
      v_reports := private.bom_parse_reports(v_rep - (jsonb_array_length(v_rep) - 1), v_old.reports, p_actor_name)
        || jsonb_build_array(jsonb_build_object('at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', v_close_note));
    else
      v_reports := private.bom_parse_reports(v_rep - (jsonb_array_length(v_rep) - 1), v_old.reports, p_actor_name)
        || jsonb_build_array(jsonb_build_object('at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', v_hold_note, 'kind', 'hold'));
    end if;
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

    -- งานของซื้อของ ST (PURCHASED / ST): ช่องผลงาน (status, qty_done, qty_reject, reports) เปลี่ยนได้ทางเดียวคือ action issueOrderParts เท่านั้น (ผู้ทำ/ผู้วางแผนก็เช่นกัน)
    -- ภายใต้ action นั้นตัวเขียนนี้ตรวจชน (ข้างบน) และสถานะใบ แล้วข้ามแถวไป: private.bom_issue_parts ตั้งงานเป็น done หักสต็อก และเขียนประวัติเอง
    if v_work and ((v_old.kind = 'PURCHASED' and v_old.dept = 'ST') or (v_kind = 'PURCHASED' and v_dept = 'ST')) then
      if p_action is distinct from 'issueOrderParts' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_struct or v_ext_changed or v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if;
      select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
      if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_ord.status = 'released' then v_started := v_started || v_ord.id; end if;
      continue;
    end if;

    -- สิทธิ์รายช่อง
    if not p_planner then
      -- แผนกอื่นแก้ชื่อ จำนวนแผน วันครบกำหนด ชิ้นงาน ใบ ฯลฯ ไม่ได้
      if v_struct then raise exception 'BOM_FORBIDDEN'; end if;
      -- รายงาน/สถานะ/ยอด: พนักงานแผนกเดียวกับงาน (ทุกบทบาท)
      if v_work and v_dept_actor is distinct from v_old.dept then raise exception 'BOM_FORBIDDEN'; end if;
      -- ผูก WO: พนักงานแผนก RB เฉพาะงานที่ยังไม่ผูก
      if v_ext_changed and (v_dept_actor is distinct from 'RB' or v_old.external_ref is not null or v_ext is null) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;
    if v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if; -- ย้ายงานไปใบอื่นไม่ได้
    -- แก้งานได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด (อ่านสถานะล่าสุดหลังเปลี่ยนสถานะใบในคำสั่งนี้)
    select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- พักงานต้องมีเหตุผล (20261128010000): งานที่เปลี่ยนเป็น hold โดยไม่มีรายการเหตุผลของการพัก = BOM_INVALID_JOB ทุกผู้เรียกทุก action · การพักไม่เพิ่มหรือลดยอด
    if v_status = 'hold' and v_old.status <> 'hold' and v_hold_note is null then raise exception 'BOM_INVALID_JOB'; end if;
    if v_hold_note is not null and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject) then raise exception 'BOM_INVALID_JOB'; end if;
    -- งานที่ผูก WO ของ RubberFlow (external_ref.woId ของแถวเดิมหรือแถวที่ส่งมา): ยอดดี / เสียและรายงานผลมาจาก RubberFlow เท่านั้น (20261128010000)
    -- ทุกผู้เรียกรวมกลุ่มวางแผน: ยอดเปลี่ยน หรือรายการรายงานใหม่ที่ไม่ใช่รายการเหตุผลของการปิดงาน / การพัก = BOM_INVALID_JOB
    -- ยังทำได้: พัก / คืนคิว / ทำต่อ / ปิดงานพร้อมเหตุผล · private.rf_apply_feedback เขียนตารางเองไม่ผ่านฟังก์ชันนี้ จึงไม่ถูกด่านนี้
    if ((v_old.external_ref ->> 'woId') is not null or (v_ext ->> 'woId') is not null)
       and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject
            or jsonb_array_length(v_reports) - coalesce(jsonb_array_length(v_old.reports), 0)
               > (case when v_close_note is not null or v_hold_note is not null then 1 else 0 end)) then
      raise exception 'BOM_INVALID_JOB';
    end if;
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;
    -- ปิดงานโดยฝ่ายวางแผน (20261125010000): ไม่เพิ่มหรือลดยอดดี / เสีย (ด่าน PK / FG ข้างล่างจึงผ่านเสมอสำหรับการปิด)
    if v_close_note is not null and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject) then raise exception 'BOM_INVALID_JOB'; end if;
    -- งานที่เปลี่ยนเป็น done โดยไม่มีรายการเหตุผลของการปิดงาน (20261126010000): ต้องถึงยอดแผนแล้ว (ตรงกับ reportJob: qtyDone + 1e-9 >= qtyPlanned)
    -- ไม่งั้นการเรียก RPC ตรงปิดงานที่ยังไม่ถึงแผนได้โดยไม่เพิ่มยอดและไม่มีเหตุผล · ปิดก่อนถึงแผนต้องผ่านรายการเหตุผล (v_close_note) ของฝ่ายวางแผนเท่านั้น
    if v_status = 'done' and v_old.status <> 'done' and v_close_note is null and v_done + 0.000000001 < greatest(v_planned, v_old.qty_planned) then
      raise exception 'BOM_INVALID_JOB';
    end if;
    -- ลดยอดแผนของงานที่เริ่มแล้วไม่ได้ (20261127010000) ทุกผู้เรียกทุก action รวมกลุ่มวางแผน · "เริ่มแล้ว" = เงื่อนไขรายงานของ private.bom_started_jobs กับแถวเดิม
    -- (สถานะไม่ใช่ queued มียอดดี / เสีย มีรายงาน หรือผูก WO ที่เลย released ไปแล้วหรือหาไม่พบ) หรือแถวที่ส่งมาเริ่มงานในคำสั่งเดียวกัน (ลดยอดพร้อมรายงาน / เริ่มงานจึงเลี่ยงไม่ได้)
    -- เพิ่มยอดแผน และแก้ยอดแผนของงานที่ยังไม่เริ่มยังทำได้เหมือนเดิม
    if v_planned < v_old.qty_planned
       and (v_old.status <> 'queued' or v_old.qty_done > 0 or v_old.qty_reject > 0 or jsonb_array_length(v_old.reports) > 0
            or (v_old.external_ref is not null and not exists (
                  select 1 from public.rf_orders o
                  where o.is_test and o.wo_no = (v_old.external_ref ->> 'woId') and o.source_job_no = v_old.job_no and o.status in ('planned', 'released', 'cancelled')))
            or v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0) then
      raise exception 'BOM_INVALID_JOB';
    end if;
    -- งานของซื้อที่เบิกไปแล้ว (แถวเดิม ST / PURCHASED ที่ qty_done > 0 ครบหรือบางส่วน หรือ done): ตัวเขียนนี้ไม่แก้อะไรของงานนี้เลย ทุก action ทุกผู้เรียก (20261124010000)
    -- แถวที่มาถึงตรงนี้มีการแก้ช่องโครงสร้าง / WO เท่านั้น (แถวที่เท่าเดิมข้ามไปแล้ว แถวที่แก้ช่องผลงานไปสาขาของซื้อข้างบน) เช่นลด qty_planned ลงเท่ายอดที่เบิก
    -- = งาน in_progress ที่เบิกต่อไม่ได้ · ผลงานเปลี่ยนได้เฉพาะตัวเขียนเบิกจ่าย (issueOrderParts -> private.bom_issue_parts) และตัวเขียนคืน
    -- (undoOrderParts / returnOrderParts -> private.bom_return_parts แก้ตารางเอง ไม่ผ่านฟังก์ชันนี้) · งานของซื้อที่ยังไม่เบิก (ยอด 0 ไม่ done) แก้ได้เหมือนเดิม
    if v_old.kind = 'PURCHASED' and v_old.dept = 'ST' and (v_old.qty_done > 0 or v_old.status = 'done') then
      raise exception 'BOM_INVALID_JOB';
    end if;
    -- งานแพ็กสินค้าสำเร็จรูป (PK / FG): ยอดที่ PK รายงานรวมของสินค้านั้นในใบ (private.bom_fg_pk_done) ต้องไม่ต่ำกว่ายอดที่ WH รับเข้าคลังสะสมแล้ว
    -- (ต่ำกว่า = ใบค้างปิดไม่ได้: closeOrderShort ต้องการรับสะสม = ยอด PK ทุกสินค้า และรับเพิ่มไม่ได้เพราะเกินยอด PK) · ทุกผู้เรียกรวมกลุ่มวางแผน
    -- ตัวตนของงานอ่านจากแถวเดิม (v_old): ลดยอด หรือย้ายงานไปสินค้า / ชนิด / แผนกอื่นในแถวเดียวกัน = ยอดเดิมของงานนี้หายจากสินค้าเดิมเท่ากัน
    if v_old.dept = 'PK' and v_old.kind = 'FG' then
      v_contrib := case when v_dept = 'PK' and v_kind = 'FG' and v_item = v_old.item_code then v_done else 0 end;
      if v_contrib < v_old.qty_done
         and private.bom_fg_pk_done(v_old.order_pk, v_old.item_code) - v_old.qty_done + v_contrib
             < private.bom_fg_total(v_old.order_pk, v_old.item_code, 'receive') then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    if v_work then
      -- พนักงานแผนก: งานที่ done แล้วแก้ไม่ได้ · ยอดลดไม่ได้
      if not p_planner then
        if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
        if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
      end if;
      -- ทุกผู้เรียกรวมกลุ่มวางแผน (20261129010000 · เดิมเฉพาะพนักงานแผนก): ยอดดี / เสียที่เปลี่ยนต้องเท่าผลรวมดี / เสียของรายการรายงานใหม่ในคำสั่งเดียวกัน
      -- รายการรายงานยอดติดลบไม่มี ยอดจึงลดไม่ได้ · ปิด / พักพร้อมเหตุผล (รายการยอด 0) และเปลี่ยนสถานะเฉย ๆ ไม่เปลี่ยนยอดจึงผ่าน
      select coalesce(sum((t.value ->> 'good')::numeric), 0), coalesce(sum((t.value ->> 'reject')::numeric), 0)
      into v_good, v_rej
      from jsonb_array_elements(v_reports) with ordinality as t(value, ord)
      where t.ord > jsonb_array_length(v_old.reports);
      if abs((v_done - v_old.qty_done) - v_good) > 0.001 or abs((v_reject - v_old.qty_reject) - v_rej) > 0.001 then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    v_done_at := case when v_status = 'done' then coalesce(v_old.done_at, now()) else null end;
    v_ext_stored := case
      when not v_ext_changed then v_old.external_ref
      when v_ext is null then null
      else v_ext || jsonb_build_object('linkedAt', private.bom_ms(now()), 'by', p_actor_name) end;
    update public.bom_jobs set
      dept = v_dept, item_code = v_item, name = v_name, kind = v_kind, uom = v_uom, qty_planned = v_planned, qty_required = v_required,
      stock_counted = v_stock, due_at = v_due::bigint, fg_codes = v_fg, status = v_status, qty_done = v_done, qty_reject = v_reject,
      reports = v_reports, external_ref = v_ext_stored, done_at = v_done_at, updated_at = now()
    where id = v_old.id;

    -- ฝ่ายวางแผนปิดงานที่ผูก WO พร้อมเหตุผล (20261129010000): WO ที่ยังไม่จบถูกยกเลิก (planned / released) หรือหยุด (in_progress / on_hold) แบบเดียวกับยกเลิกใบ
    -- completed / cancelled คงเดิม · การผูกของงานคงอยู่ · ผู้เรียก (app_bom_save_master) เพิ่ม version ของ RF และเขียน audit bom:closeJob
    if v_close_note is not null and (v_ext_stored ->> 'woId') is not null then
      v_wo_no := private.bom_cancel_rf_job(v_old.job_no, v_ext_stored ->> 'woId');
      if v_wo_no is not null then v_rf_cancelled := v_rf_cancelled || v_wo_no; end if;
    end if;

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return jsonb_build_object('started', to_jsonb(v_started), 'cancelled', to_jsonb(v_rf_cancelled));
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 8. BOM: แก้บรรทัด / หมายเหตุในฉบับเดิมได้เมื่อคนเดียวกันแก้ในวันเดียวกันและยังไม่มีใบสั่งผลิตใช้ (นิยามจาก 20261105010000_bom_master_data.sql) ----------
-- คืนรหัสชิ้นของ revision ใหม่ และของฉบับที่แก้ในที่เดิม (ใช้เริ่มตรวจวงจรและกฎหลังเขียน)
create or replace function private.bom_save_boms(p_actor uuid, p_actor_name text, p_rows jsonb, p_base bigint, p_cur bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_roots text[] := '{}';
  v_seen text[] := '{}';
  v_id text;
  v_item_code text;
  v_item public.bom_items%rowtype;
  v_rev numeric;
  v_status text;
  v_dept text;
  v_note text;
  v_lines jsonb;
  v_log jsonb;
  v_old public.bom_boms%rowtype;
  v_max integer;
  v_changed boolean;
  v_pk uuid;
  v_content boolean;
  v_locked boolean;
  v_inplace boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_BOM'; end if;
    v_id := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_BOM');
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' or v_id = any (v_seen) then raise exception 'BOM_INVALID_BOM'; end if;
    v_seen := v_seen || v_id;
    v_item_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_BOM'));
    select * into v_item from public.bom_items i where i.is_test and i.code = v_item_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'BOM_INVALID_BOM', 1, 100000);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'BOM_INVALID_BOM'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_BOM');
    if v_status not in ('approved', 'superseded') then raise exception 'BOM_INVALID_BOM'; end if;
    v_dept := private.bom_dept(coalesce(nullif(private.bom_text(v_row, 'ownerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), v_item.owner_dept));
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_BOM');
    v_lines := private.bom_parse_lines(v_item_code, v_dept, v_row -> 'lines');

    select * into v_old from public.bom_boms b where b.is_test and b.bom_id = v_id;
    if found then
      -- มีคนอื่นแก้ revision นี้หลังเวอร์ชันฐานของ client (เช่น ตั้ง superseded ด้วย revision ใหม่ หรือย้ายแผนกเจ้าของ)
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
      -- revision ที่มีอยู่แล้วเปลี่ยนได้เฉพาะ approved -> superseded, แผนกเจ้าของ และ changeLog ต่อท้าย · ชิ้นและเลข revision เปลี่ยนไม่ได้เสมอ
      if v_old.item_code <> v_item_code or v_old.revision <> v_rev::integer then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      if v_old.status = 'superseded' and v_status = 'approved' then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      -- แก้บรรทัด / หมายเหตุในฉบับเดิม (20261129010000): ฉบับเดิมและที่ส่งมาเป็น approved และเป็น revision สูงสุดของชิ้น · ผู้อนุมัติฉบับนั้นคือผู้บันทึกครั้งนี้
      -- อนุมัติวันเดียวกับวันนี้ (Asia/Bangkok) · ไม่มีใบสั่งผลิตที่ไม่ใช่ร่าง (รวม cancelled) ที่ explosion อ้างฉบับนี้ · ไม่ครบ = BOM_REVISION_IMMUTABLE เหมือนเดิม
      v_content := v_old.note <> v_note or private.bom_lines_json(v_old.id) <> v_lines;
      if v_content then
        v_locked := exists (
          select 1 from public.bom_orders o, jsonb_array_elements(coalesce(o.explosion, '[]'::jsonb)) as e(line)
          where o.is_test and o.status <> 'draft' and e.line ->> 'bomId' = v_old.bom_id);
        v_inplace := coalesce(
          v_old.status = 'approved' and v_status = 'approved'
          and v_old.approved_by = p_actor
          and (v_old.approved_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
          and not exists (select 1 from public.bom_boms b where b.is_test and b.item_code = v_old.item_code and b.revision > v_old.revision)
          and not v_locked, false);
        if not v_inplace then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      end if;
      v_log := private.bom_log(v_row -> 'changeLog', v_old.change_log, p_actor_name);
      -- การแก้ในฉบับเดิมต้องมีบันทึกการแก้ต่อท้ายอย่างน้อยหนึ่งรายการ (ประวัติของฉบับบอกว่าแก้อะไร)
      if v_content and jsonb_array_length(v_log) <= jsonb_array_length(v_old.change_log) then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      update public.bom_boms set
        status = v_status,
        superseded_at = case when v_old.status = 'approved' and v_status = 'superseded' then now() else v_old.superseded_at end,
        owner_dept = v_dept,
        note = v_note,
        change_log = v_log
      where id = v_old.id;
      if v_content then
        -- บรรทัดถูกแทนทั้งชุดในลำดับที่ส่งมา · ชิ้นนี้เข้ารายการตรวจกฎ / วงจรหลังเขียนเหมือน revision ใหม่
        delete from public.bom_bom_lines l where l.bom_pk = v_old.id;
        insert into public.bom_bom_lines (
          is_test, bom_pk, line_no, step, child_code, qty, uom, consumer_dept, producer_dept, scrap_pct, flags, note)
        select true, v_old.id, (t.ord - 1)::integer, (t.ln ->> 'step')::integer, t.ln ->> 'childCode',
               (t.ln ->> 'qty')::numeric, t.ln ->> 'uom', t.ln ->> 'consumerDept', t.ln ->> 'producerDept',
               (t.ln ->> 'scrapPct')::numeric, t.ln -> 'flags', t.ln ->> 'note'
        from jsonb_array_elements(v_lines) with ordinality as t(ln, ord);
        v_roots := v_roots || v_item_code;
      end if;
    else
      -- revision ใหม่: approved เสมอ และต้องเป็น (สูงสุดเดิม + 1) ตัวที่ approved อยู่ถูกตั้ง superseded ในคำสั่งเดียวกัน
      if v_status <> 'approved' then raise exception 'BOM_INVALID_BOM'; end if;
      select coalesce(max(b.revision), 0), coalesce(bool_or(b.changed_version > p_base and b.changed_version <= p_cur), false)
      into v_max, v_changed from public.bom_boms b where b.is_test and b.item_code = v_item_code;
      -- มีคนอื่นเพิ่ม/แก้ revision ของชิ้นนี้หลังเวอร์ชันฐานของ client = ชน (ให้ client โหลดส่วนต่างแล้วทำใหม่) · เลขรุ่นข้ามลำดับโดยไม่มีใครแก้ = ผิดลำดับ
      if v_changed then raise exception 'BOM_STALE'; end if;
      if v_rev::integer <> v_max + 1 then raise exception 'BOM_REVISION_ORDER'; end if;
      update public.bom_boms set status = 'superseded', superseded_at = now()
      where is_test and item_code = v_item_code and status = 'approved';
      v_log := private.bom_log(v_row -> 'changeLog', null, p_actor_name);
      insert into public.bom_boms (
        is_test, bom_id, item_code, revision, status, owner_dept, note, created_by, approved_by, approved_at, change_log)
      values (true, v_id, v_item_code, v_rev::integer, 'approved', v_dept, v_note, p_actor, p_actor, now(), v_log)
      returning id into v_pk;
      insert into public.bom_bom_lines (
        is_test, bom_pk, line_no, step, child_code, qty, uom, consumer_dept, producer_dept, scrap_pct, flags, note)
      select true, v_pk, (t.ord - 1)::integer, (t.ln ->> 'step')::integer, t.ln ->> 'childCode',
             (t.ln ->> 'qty')::numeric, t.ln ->> 'uom', t.ln ->> 'consumerDept', t.ln ->> 'producerDept',
             (t.ln ->> 'scrapPct')::numeric, t.ln -> 'flags', t.ln ->> 'note'
      from jsonb_array_elements(v_lines) with ordinality as t(ln, ord);
      v_roots := v_roots || v_item_code;
    end if;
  end loop;
  return v_roots;
end;
$$;
revoke all on function private.bom_save_boms(uuid, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 9. RPC: WO ที่ยกเลิก / หยุดเพราะฝ่ายวางแผนปิดงานนับใน rubberflow.cancelled และ audit ของ RF แถว bom:closeJob (นิยามจาก 20261128020000_bom_po_partial_fg_reverse.sql) --
create or replace function public.app_bom_save_master(
  p_changes jsonb, p_base_version bigint, p_action text, p_audit jsonb default '[]'::jsonb, p_epoch text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_actor_name text;
  v_planner boolean;
  v_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves'];
  -- ส่วนที่เขียนได้เฉพาะกลุ่มวางแผน (orders / jobs ตรวจรายช่องในตัวเขียน)
  v_planner_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                              'customers'];
  v_key text;
  v_sub text;
  v_sec jsonb;
  v_node jsonb;
  v_n integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_version bigint;
  v_epoch uuid;
  v_row jsonb;
  v_dbase text;
  v_dcode text;
  v_row_version bigint;
  v_item_codes text[] := '{}';
  v_roots text[] := '{}';
  v_touched text[];
  v_released uuid[] := '{}';
  v_started uuid[] := '{}';
  v_bad text;
  v_res jsonb;
  v_oid uuid;
  v_delta jsonb;
  v_rf_opened jsonb := '[]'::jsonb;
  v_rf_skipped jsonb := '[]'::jsonb;
  v_rf_cancelled jsonb := '[]'::jsonb;
  v_rf_n integer;
  v_rf_cancel_n integer := 0;
  v_rf_reopen_n integer := 0;
  v_rf_close_n integer := 0;
  v_jobs jsonb;
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
  v_stock_n integer;
  v_fg jsonb;
  v_fg_orders_n integer;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_actor();
  v_planner := private.bom_can_edit(v_actor);
  -- ด่านหยาบ: คนนอกกลุ่มวางแผนเรียกได้เฉพาะ action ของนับคงคลัง/รายงานงาน (สิทธิ์จริงตรวจรายส่วนและรายช่องข้างล่าง)
  if not v_planner and (p_action is null or not (p_action = any (private.bom_staff_actions()))) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action is null or not (p_action = any (private.bom_client_actions())) then raise exception 'BOM_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'BOM_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'BOM_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert (ทุกส่วน) / delete (เฉพาะ colorSets, packages และ jobs), เป็นอาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if not (v_sub = 'upsert' or (v_sub = 'delete' and v_key in ('colorSets', 'packages', 'jobs'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'BOM_TOO_MANY'; end if;
      -- ของสำเร็จรูป: ส่วน fgMoves ส่งได้เฉพาะ receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg และห้าการกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น)
      if v_n > 0 and ((v_key = 'fgMoves' and not (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg')))
                      or (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') and v_key <> 'fgMoves')) then
        raise exception 'BOM_INVALID_FG';
      end if;
      -- สต็อกของซื้อ: ส่วน stock ส่งได้เฉพาะ countPartStock และ countPartStock ส่งได้เฉพาะส่วน stock · issueOrderParts ส่งได้เฉพาะงาน (jobs upsert)
      -- คืนของซื้อ: ส่วน partReturns ส่งได้เฉพาะ undoOrderParts / returnOrderParts และสองการกระทำนี้ส่งได้เฉพาะส่วน partReturns
      if v_n > 0 and ((v_key = 'stock' and p_action <> 'countPartStock')
                      or (p_action = 'countPartStock' and v_key <> 'stock')
                      or (p_action = 'issueOrderParts' and not (v_key = 'jobs' and v_sub = 'upsert'))
                      or (v_key = 'partReturns' and p_action not in ('undoOrderParts', 'returnOrderParts'))
                      or (p_action in ('undoOrderParts', 'returnOrderParts') and v_key <> 'partReturns')) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ของสำเร็จรูป: receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg ต้องมีคำขอในส่วน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG
  -- ไม่ใช่สำเร็จแบบไม่ทำอะไร) ตามสัญญา "คำขอเดียวต่อคำสั่ง" · ตรวจหลังรูป payload ก่อนล็อกตัวนับ (BOM_RESET / ฐานเวอร์ชันมาทีหลัง)
  if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') and coalesce(jsonb_array_length(p_changes #> '{fgMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_FG';
  end if;

  -- ล็อกตัวนับก่อนตรวจชน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็นเวอร์ชันของระเบียนที่คนแรกเพิ่งแก้ (changed_version) แล้วได้ BOM_STALE เฉพาะที่ชนกัน
  -- v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน) ระเบียนที่แก้ในคำสั่งนี้ได้ v_version + 1 จึงไม่ถูกนับว่าเป็นของคนอื่น
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.bom_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (ระเบียนที่มันถืออยู่ไม่มีแล้ว การบันทึกจะสร้างระเบียนที่ถูกล้างกลับมา)
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'BOM_RESET'; end if;
  if p_base_version > v_version then raise exception 'BOM_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.bom_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.bom_save_compounds(v_actor.id, coalesce(p_changes #> '{compounds,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_colors(v_actor.id, coalesce(p_changes #> '{colors,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_processes(v_actor.id, coalesce(p_changes #> '{processes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_item_codes := private.bom_save_items(v_actor.id, coalesce(p_changes #> '{items,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลบก่อนเขียน (ลบแล้วสร้างใหม่รหัสเดิมในคำสั่งเดียวกันได้) ไม่พบ = BOM_NOT_FOUND แต่ถ้าคนอื่นเพิ่งลบหลังเวอร์ชันฐาน = BOM_STALE
    -- แถวที่คนอื่นแก้หลังเวอร์ชันฐานลบไม่ได้ (BOM_STALE) · ที่ลบแล้วจดหลุมฝังศพไว้ให้ delta
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{colorSets,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
      select s.changed_version into v_row_version from public.bom_color_sets s where s.is_test and s.base = v_dbase and s.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'colorSets' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_color_sets where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'colorSets', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      select p.changed_version into v_row_version from public.bom_packages p where p.is_test and p.base = v_dbase and p.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'packages' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_packages where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'packages', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลูกค้า → ใบสั่งผลิต (รวมเปลี่ยนสถานะ ลบงานของใบที่ยกเลิก/เปิดกลับมาแก้) → ลบงานตรง ๆ → งาน (เพิ่ม/แก้) ตามลำดับนี้เสมอ
    perform private.bom_save_customers(v_actor.id, coalesce(p_changes #> '{customers,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := array(select t.value::uuid from jsonb_array_elements_text(v_res -> 'released') as t(value));
    v_rf_cancel_n := jsonb_array_length(v_res -> 'cancelled');
    v_rf_reopen_n := jsonb_array_length(v_res -> 'reopened');
    v_rf_cancelled := (v_res -> 'cancelled') || (v_res -> 'reopened');
    -- สต็อกสินค้าสำเร็จรูป: แถว transfer (ปล่อยผลิต) / untransfer (ยกเลิก / เปิดกลับ) ที่ตัวเขียนใบเขียนเอง นับเป็น fgMoves (ส่วน fgMoves ไม่มากับ action ของใบ)
    v_fg_orders_n := coalesce((v_res ->> 'fgMoves')::integer, 0);
    if v_fg_orders_n > 0 then v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', v_fg_orders_n)); end if;
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_jobs := private.bom_save_jobs(v_actor, v_actor_name, v_planner, p_action, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                    v_released, p_base_version, v_version);
    v_started := array(select t.value::uuid from jsonb_array_elements_text(v_jobs -> 'started') as t(value));
    -- ฝ่ายวางแผนปิดงานที่ผูก WO (20261129010000): WO ที่ยกเลิก / หยุดรวมใน rubberflow.cancelled ของคำตอบ และ audit ของ RF แถว bom:closeJob
    v_rf_close_n := jsonb_array_length(v_jobs -> 'cancelled');
    v_rf_cancelled := v_rf_cancelled || (v_jobs -> 'cancelled');
    -- สต็อกของซื้อ: นับ (countPartStock) / เบิกจ่ายรายใบ (issueOrderParts: ตัวเขียนงานตรวจชนและข้ามแถวผลงานของงานของซื้อมาแล้ว) ทั้งสองอยู่ในธุรกรรมเดียวกับงาน
    perform private.bom_save_stock(v_actor, v_planner, coalesce(p_changes #> '{stock,upsert}', '[]'::jsonb), p_base_version, v_version);
    if p_action = 'issueOrderParts' then
      v_stock_n := private.bom_issue_parts(v_actor, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
      v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n));
    end if;
    -- คืนของซื้อ (undoOrderParts / returnOrderParts): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (งานที่กลับไปรอเบิกจ่าย สต็อก ประวัติ) · นับเป็น stock ตามจำนวนประวัติที่เขียน
    if p_action in ('undoOrderParts', 'returnOrderParts') then
      v_stock_n := private.bom_return_parts(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{partReturns,upsert}', '[]'::jsonb), p_base_version, v_version);
      if v_stock_n > 0 then v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n)); end if;
    end if;
    -- ของสำเร็จรูป (receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (ประวัติ และใบที่ปิดเอง / เปิดกลับ)
    -- audit นับเป็น fgMoves ตามจำนวนแถวประวัติที่เขียน และ orders +1 เมื่อใบถูกปิด หรือถูกเปิดกลับเพราะย้อนรับเข้า (reverseFg ใช้ตัวเขียน private.bom_fg_reverse · 20261128020000)
    if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') then
      if p_action = 'reverseFg' then
        v_fg := private.bom_fg_reverse(v_actor, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      else
        v_fg := private.bom_fg_move(v_actor, p_action, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      end if;
      v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', (v_fg ->> 'moves')::integer));
      if (v_fg ->> 'closed')::boolean or coalesce((v_fg ->> 'reopened')::boolean, false) then
        v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', 1));
      end if;
    end if;
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตในคำสั่งนี้: ยังไม่ completed ต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้) · completed (bom_save_orders ปิดให้เพราะได้ครบทุกสินค้าจากสต็อก
    -- สินค้าสำเร็จรูป) ต้องไม่มีงาน เพราะงานของใบที่ปิดแล้วทำต่อไม่ได้ (bom_save_jobs แก้งานได้เฉพาะใบ released / in_progress) · ข้อหลังเพิ่มใน 20261124010000
    -- ตรวจจากสถานะสุดท้ายหลังเขียนใบ ลบงาน และเขียนงานของคำสั่งนี้ครบแล้ว และก่อนเปิด WO ใน RubberFlow ให้งาน RB ของใบเหล่านี้ (ผิด = ทั้งคำสั่งไม่เขียนอะไร)
    if exists (select 1 from unnest(v_released) r(id) join public.bom_orders o on o.id = r.id
               where (o.status <> 'completed' and not exists (select 1 from public.bom_jobs j where j.order_pk = r.id))
                  or (o.status = 'completed' and exists (select 1 from public.bom_jobs j where j.order_pk = r.id))) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- เปิด WO ใน RubberFlow ให้งาน RB ของใบที่เพิ่งปล่อยผลิต (เปิดไม่ได้ = ข้ามพร้อมเหตุผล ไม่ทำให้การปล่อยล้ม)
    foreach v_oid in array v_released loop
      v_res := private.bom_open_rf_orders(v_actor, v_actor_name, v_oid);
      v_rf_opened := v_rf_opened || (v_res -> 'opened');
      v_rf_skipped := v_rf_skipped || (v_res -> 'skipped');
    end loop;

    -- ตรวจกฎ BOM หลังเขียนเฉพาะส่วนที่เกี่ยว: BOM ที่ approved ของชิ้นที่ถูกแก้/มี revision ใหม่ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก
    v_touched := v_item_codes || v_roots;
    if cardinality(v_touched) > 0 then
      -- ชนิดพ่อ/ลูก (rules.childKindError) · ลูกเป็น FG = BOM_INVALID_CHILD_KIND (20261126010000)
      select case when p.kind in ('PURCHASED', 'CP') then 'BOM_INVALID_PARENT_KIND' else 'BOM_INVALID_CHILD_KIND' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test and c.code = l.child_code
      where b.is_test and b.status = 'approved'
        and (b.item_code = any (v_touched) or l.child_code = any (v_touched))
        and (p.kind in ('PURCHASED', 'CP')
             or (p.kind = 'RB' and c.kind <> 'CP')
             or (c.kind = 'CP' and p.kind <> 'RB')
             or c.kind = 'FG')
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;

      -- เส้นยาง: บรรทัดสูตรยางได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
      select case when x.n <> 1 then 'BOM_RB_ONE_COMPOUND' else 'BOM_RB_COMPOUND_MISMATCH' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test and b.status = 'approved' and b.item_code = any (v_touched)
        and (x.n <> 1
             or (coalesce(p.rubber ->> 'compound', '') <> '' and private.bom_code(p.rubber ->> 'compound') <> x.child))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;

    -- วงจร: เดินจากพ่อของ revision ใหม่ลงไปตาม BOM ที่ approved (วงจรใหม่เกิดจากเส้นใหม่เท่านั้น) เพดาน 30 ชั้น
    if cardinality(v_roots) > 0 then
      with recursive walk(code, path) as (
        select l.child_code, array[r.root, l.child_code]
        from unnest(v_roots) as r(root)
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = w.code
        join public.bom_bom_lines l on l.bom_pk = b.id
        where cardinality(w.path) < 30
          and not (w.code = any (w.path[1:cardinality(w.path) - 1]))
      )
      select case
               when bool_or(w.code = any (w.path[1:cardinality(w.path) - 1])) then 'BOM_CYCLE'
               when max(cardinality(w.path)) >= 30 then 'BOM_TOO_DEEP'
             end
      into v_bad
      from walk w;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  exception
    when unique_violation then
      raise exception 'BOM_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'BOM_INVALID_DATA';
  end;

  -- WO ที่เปิด/ยกเลิกในคำสั่งนี้: เพิ่ม version ของ RF อีก 1 ครั้งเดียว (แถวถูก trigger rf_stamp_version ประทับ version + 1 แล้ว) และเขียน audit ของ RF ให้ app_rf_master_since / หน้า audit เห็น
  -- ล็อกแถวตัวนับ RF ถูกถือแล้ว (bom_lock_rf ตอนเขียน WO) ไม่มี WO ที่เปิด/ยกเลิก = ไม่แตะ RF เลย
  v_rf_n := jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_cancelled);
  if v_rf_n > 0 then
    update public.rf_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test returning version into v_rf_version;
    -- แถว audit ละชนิด (ปล่อยผลิต / ยกเลิกใบ / เปิดใบกลับเป็นร่าง) ใช้ version ใหม่ตัวเดียวกัน
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_rf_version::text,
           jsonb_build_object('client_action', k.action, 'version', v_rf_version, 'base_version', v_rf_version - 1,
                              'counts', jsonb_build_object('orders', jsonb_build_object('upsert', k.n)),
                              'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                              'entries', '[]'::jsonb)
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n),
                 (4, 'bom:closeJob', v_rf_close_n)) as k(ord, action, n)
    where k.n > 0
    order by k.ord;
  end if;
  if v_rf_n > 0 or jsonb_array_length(v_rf_skipped) > 0 then
    v_rf_meta := jsonb_build_object('rubberflow', jsonb_build_object(
      'opened', jsonb_array_length(v_rf_opened), 'skipped', jsonb_array_length(v_rf_skipped), 'cancelled', jsonb_array_length(v_rf_cancelled)));
  end if;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit) || v_rf_meta);
  v_delta := private.bom_delta(p_base_version);
  if v_rf_meta <> '{}'::jsonb then
    v_delta := v_delta || jsonb_build_object('rubberflow', jsonb_build_object('opened', v_rf_opened, 'skipped', v_rf_skipped, 'cancelled', v_rf_cancelled));
  end if;
  return v_delta;
end;
$$;

revoke all on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) to authenticated;
