-- ============================================================================
-- ปล่อยผลิตใบ PI ใน BOM = เปิดใบสั่งผลิต (WO) ใน RubberFlow ให้งานแผนก RB เอง (โหมดทดสอบ) · RubberFlow รอบที่ 2 ต่อจาก 20261108010000_rubberflow_shopfloor.sql
--
-- ทำไม: ก่อนหน้านี้ปล่อยผลิตแล้วทุกงาน RB ต้องมีคนเปิด WO ใน RubberFlow ด้วยมือ (createOrder + sourceJobId) ตอนนี้เซิร์ฟเวอร์เปิดให้ในธุรกรรมเดียวกับที่สร้างงาน
--
-- กติกา (ยืนยันกับผู้ใช้ 2026-11-06)
--   1) ตอนปล่อยผลิต (bom_orders draft -> released ใน app_bom_save_master) ทุกงาน RB ของใบ (bom_jobs.dept = 'RB', external_ref ว่าง เรียงตาม job_no):
--      เส้นยาง = bom_items ของงาน · รหัสคอมปาวด์ = rubber ->> 'compound' · คอมปาวด์ = bom_compounds · สูตร = rf_recipes ที่ recipe_code = recipe_id และ status = 'approved'
--      เปิดได้ = เขียน rf_orders 1 แถว (planned) แล้วผูกงาน · เปิดไม่ได้ = ข้าม พร้อมเหตุผล (ข้ามไม่ทำให้การปล่อยผลิตล้ม):
--        ไม่มีรหัสสูตรยาง · ยังไม่ผูกสูตร RubberFlow · สูตร <รหัส> ยังไม่อนุมัติ · ไม่มียอดให้ผลิต (qty_planned - qty_done <= 0) · คำนวณกิโลกรัมไม่ได้ (kg = 0 หรือเกินเพดานของคอลัมน์)
--      ช่องของ WO: wo_no = WO-<yyyymmdd เวลา Asia/Bangkok>-<nn> (nn = เลขสูงสุดของวันนั้นในรายการ WO ของโหมดทดสอบ + 1 เติม 0 ให้ 2 หลัก เหมือน nextOrderId ฝั่ง client ปล่อยหลายใบ = เลขต่อกัน)
--        customer = ลูกค้าของ PI · customer_po = เลข PI · recipe/product_code จากสูตร approved · uom = หน่วยของงาน · color = rubber ->> 'color' ไม่ก็ 'ดำ'
--        target_qty = qty_planned - qty_done · target_kg = kg ด้านล่าง · kg_per_unit = kg / target_qty · start_date = วันนี้ 00:00 (Asia/Bangkok) เป็น ms
--        due_date = max(due_at ของงาน, start_date) · priority = urgent เมื่อ due_at ของงานเลยเวลาปัจจุบัน ไม่ก็ normal · source_job_no = job_no · created_by = ผู้ปล่อยผลิต
--      kg = สูตรเดียวกับ rbJobKg(job, item, { scrapPct: 5, bom }) ใน modules/bom-actions.js: ถ้า BOM ที่ approved ของเส้นยางมีบรรทัดแรก (line_no ต่ำสุด) หน่วย kg หรือ g และ qty > 0
--        = round(qty x line.qty x (1 | 0.001) x (1 + scrap_pct/100), 2) ไม่ก็ qty (หน่วยเส้นยางเป็น kg) / qty x rubber.kgPerRoll (> 0) / qty x weight_g / 1000 แล้ว round(kg x 1.05, 2)
--      ผูกงาน: external_ref = { system: "rubberflow", woId, kg, linkedAt, by: ผู้ปล่อยผลิต, auto: true } งานยังเป็น queued และใบยังเป็น released (ต่างจาก rf_link_job ที่ดันเป็น in_progress)
--        ใบรับมอบใบแรกค่อยดันงานเป็น in_progress ผ่าน rf_apply_feedback เหมือนเดิม · หัว RB ปล่อย WO ต่อเหมือนเดิม (rf_save_orders ไม่เปลี่ยน)
--      ฝั่ง RubberFlow: ล็อกตัวนับ rf_master_state, trigger rf_stamp_version ประทับแถวใหม่, เพิ่ม version อีก 1 ครั้งเดียวต่อการบันทึก และเขียน audit_logs 1 แถว
--        (RF_SAVE แถวละชนิดต่อการบันทึก: client_action = 'bom:releaseOrder' / 'bom:cancelOrder' / 'bom:reopenOrder', counts { orders: { upsert: n } }) ให้ app_rf_master_since เห็น WO และหน้า audit ของ RubberFlow บอกว่ามาจาก BOM · ไม่มี WO ที่เปิด/ยกเลิก = ไม่เพิ่ม version
--   2) ยกเลิกใบ PI (released/in_progress -> cancelled) หรือเปิดใบกลับเป็นร่าง (-> draft): ทุกงานของใบที่ external_ref ชี้ไป WO
--        WO planned / released = ตั้ง cancelled (cancelled_at = now()) ทั้ง WO ที่เปิดเองและที่เปิดด้วยมือ แล้วลบงานเหมือนเดิม (บันทึก RF audit เหมือนข้อ 1)
--        WO in_progress / on_hold / completed = BOM_RF_ORDER_STARTED (ยกเลิกใบไม่ได้ ต้องปิดหรือยกเลิก WO ใน RubberFlow ก่อน)
--        WO ที่ยกเลิกไปแล้ว (การผูกค้าง) ไม่ขวาง · ไม่พบ WO ในตาราง = ข้ามเงียบ ๆ (ไม่มีอะไรให้ยกเลิก)
--        ยังคงห้ามยกเลิกเมื่อมีงาน qty_done > 0 (BOM_INVALID_TRANSITION)
--      เปิดใบกลับเป็นร่าง (bom_started_jobs): งานที่มี external_ref นับว่า "เริ่มแล้ว" ก็ต่อเมื่อ WO เลย released ไปแล้ว หรือหา WO ไม่พบ (WO planned / released / cancelled ไม่นับ)
--      ลำดับตรวจตอนเปิดใบกลับ: bom_started_jobs ก่อน (WO เลย released หรือหาไม่พบ = BOM_INVALID_TRANSITION) แล้วจึงยกเลิก WO ที่เหลือ ส่วนยกเลิกใบ: WO เลย released = BOM_RF_ORDER_STARTED ทั้งหมดอยู่ในธุรกรรมเดียวกัน ผิดข้อใด = ไม่เขียนอะไรเลย
--   3) คำตอบของ app_bom_save_master: delta เดิม { version, epoch, changes } บวก "rubberflow": { opened: [{jobId, woId, kg}], skipped: [{jobId, itemCode, reason}], cancelled: [wo_no] }
--      เฉพาะเมื่อมีอย่างน้อยหนึ่งอย่าง · audit BOM_MASTER_SAVE ได้ metadata.rubberflow = { opened: n, skipped: m, cancelled: k } เมื่อไม่เป็นศูนย์ทั้งหมด
--   4) กัน deadlock: app_bom_save_master ล็อก bom_master_state ก่อนแล้วจึง rf_master_state ส่วน app_rf_save ล็อก rf ก่อน bom ทั้งสองจึงเรียก
--      pg_advisory_xact_lock(hashtext('mnp_bom_rf_master')) เป็นอย่างแรกหลัง lab_only_block (app_rf_save แก้ในไฟล์ 20261108010000 ที่ยังไม่ถูก apply) ล็อกแถวหลังจากนั้นจึงไม่วนกัน
--   5) โหมดในเครื่องของ Pilot (ไม่มี Supabase) ไม่เปลี่ยน ไม่เปิด WO อัตโนมัติ
--
-- ข้อต้องแก้ที่พบ: external_ref ของงานที่เปิดเองมีช่อง "auto" เพิ่ม ตัวเขียนงาน (bom_save_jobs) เทียบ external_ref ที่ client ส่งกลับกับของเดิมโดยตัด linkedAt และ by
--   แล้ว parse เหลือ system/woId/kg จึงมองว่า "ผูกใหม่" ทุกครั้งที่ client บันทึกงานนั้น (เช่น reportJob) จึงตัด auto ออกในการเทียบด้วย (นอกนั้นเหมือนเดิมทุกบรรทัด)
--
-- นิยามที่ replace (เริ่มจากนิยามล่าสุดใน 20261106010000_bom_orders_jobs.sql ทุกตัว ไม่มี migration อื่นแก้ซ้ำ):
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text) (create or replace ลายเซ็นเดิม เพิ่มล็อก advisory, เปิด WO หลังสร้างงาน, บันทึก RF, คำตอบ/audit)
--   - private.bom_save_orders(...): ชนิดคืนเปลี่ยนจาก uuid[] เป็น jsonb { released: [uuid], cancelled: [wo_no] } จึง DROP ลายเซ็นเดิมแล้วสร้างใหม่ (ยกเลิก WO ตอนยกเลิก/เปิดใบกลับ)
--   - private.bom_started_jobs(uuid) (กติกาข้อ 2) · private.bom_save_jobs(...) (ตัด auto ในการเทียบ external_ref)
--   - ใหม่: private.bom_lock_rf(), bom_rb_job_kg(public.bom_jobs, public.bom_items), bom_open_rf_orders(public.employees, text, uuid), bom_cancel_rf_orders(uuid)
--   - ไม่แตะ: rf_save_orders rf_link_job rf_job_for_link rf_unlink_job rf_apply_feedback (งานที่เปิดเองผ่านทางเดียวกับที่ผูกด้วยมือหลังจากนั้น)
--   - app_rf_save ได้ล็อก advisory เพิ่มใน 20261108010000_rubberflow_shopfloor.sql (แก้ในที่ ยังไม่ถูก apply)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ที่ปล่อยพร้อม migration นี้พึ่งคำตอบ "rubberflow" ของ app_bom_save_master และรหัสข้อผิดพลาด BOM_RF_ORDER_STARTED จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ครั้งนี้เท่านั้น) "ก่อน merge" PR ตาม "Deployment order" ใน AGENTS.md และต้อง apply 20261108010000_rubberflow_shopfloor.sql ก่อนไฟล์นี้ (ยังไม่ถูก apply)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของ public.app_bom_save_master, private.bom_save_orders, bom_started_jobs, bom_save_jobs ที่ production กับนิยามใน
--   20261106010000_bom_orders_jobs.sql แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ ตรวจหลัง apply: md5 ของฟังก์ชันทั้งหมดข้างบนเท่ากับ local stack ที่ผ่าน db:test, has_function_privilege
--   (anon ไม่ได้ authenticated ได้เฉพาะ RPC สาธารณะ ฟังก์ชัน private ไม่มีใครได้) Pilot Web เดิมที่ไม่รู้จักช่อง "rubberflow" ยังใช้ได้กับฐานใหม่ (ไม่เห็น WO ที่เปิดเอง จนกว่าจะโหลด RubberFlow ใหม่)
--
-- Rollback (WO ที่เปิดเองมีแต่ข้อมูลทดสอบ):
--   1) คืนนิยามเดิมของ public.app_bom_save_master, private.bom_started_jobs, private.bom_save_jobs ด้วยการรัน create or replace จาก 20261106010000_bom_orders_jobs.sql (รวม revoke/grant)
--   2) drop function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) แล้วสร้างใหม่ตามนิยามเดิม (คืน uuid[]) จากไฟล์เดียวกัน
--   3) drop function private.bom_cancel_rf_orders(uuid), private.bom_open_rf_orders(public.employees, text, uuid), private.bom_rb_job_kg(public.bom_jobs, public.bom_items), private.bom_lock_rf()
--   4) WO ที่เปิดเองและงานที่ผูกไว้แล้วไม่ถูกย้อนกลับ (ยกเลิก WO ใน RubberFlow ได้ตามปกติ การผูกถูกล้างเอง) ล็อก advisory ของ app_rf_save ถอนโดยคืนนิยามใน 20261108010000
-- ============================================================================


-- 1. ฟังก์ชันช่วยใหม่ (private) ----------------------------------------------------------------
-- ล็อกแถวตัวนับ RF (เรียกหลังล็อก bom_master_state เท่านั้น: ผู้เรียกถือ advisory lock 'mnp_bom_rf_master' อยู่แล้ว จึงไม่วนกับ app_rf_save) คืน version ของ RF ก่อนบันทึกนี้
create or replace function private.bom_lock_rf()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  insert into public.rf_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version into v_version from public.rf_master_state s where s.is_test for update;
  return v_version;
end;
$$;
revoke all on function private.bom_lock_rf() from public, anon, authenticated;

-- กิโลกรัมคอมปาวด์ของงาน RB (rbJobKg(job, item, { scrapPct: 5, bom }) ใน modules/bom-actions.js): ยอดที่เหลือผลิต = qty_planned - qty_done
-- บรรทัดแรกของ BOM ที่ approved ของเส้นยางเป็น kg/g และ qty > 0 = ปริมาณ x (1 + scrap_pct/100) ปัด 2 ตำแหน่ง (ไม่เผื่อ 5% ซ้ำ)
-- ไม่เช่นนั้นหน่วยเส้นยางเป็น kg = ยอด · kgPerRoll > 0 = ยอด x kgPerRoll · weight_g > 0 = ยอด x weight_g / 1000 แล้วเผื่อ 5% ปัด 2 ตำแหน่ง (ไม่มีเส้นยาง = 0)
-- กิโลกรัมต่อหน่วยของ WO = kg / จำนวน ปัดที่ 12 เลขนัยสำคัญ: หน้าเว็บอ่านเป็นเลข JS (double) แล้วส่งระเบียนกลับมาได้ค่าเดิมทุกครั้ง
-- (rf_save_orders เทียบ kg_per_unit ตรง ๆ) และยอดรับมอบเป็นกิโลกรัมแปลงกลับเป็นชิ้นได้ใกล้เคียงแม้ชิ้นเล็กมาก
create or replace function private.bom_kg_per_unit(p_kg numeric, p_qty numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_kg is null or p_qty is null or p_qty <= 0 then null
              when p_kg <= 0 then 0
              else round(p_kg / p_qty, least(30, greatest(0, 11 - floor(log(p_kg / p_qty))::integer))) end
$$;
revoke all on function private.bom_kg_per_unit(numeric, numeric) from public, anon, authenticated;

create or replace function private.bom_rb_job_kg(p_job public.bom_jobs, p_item public.bom_items)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_qty numeric := greatest(0, p_job.qty_planned - p_job.qty_done);
  v_line public.bom_bom_lines%rowtype;
  v_roll numeric;
  v_kg numeric := 0;
begin
  if p_item.code is null then return 0; end if;
  select l.* into v_line
  from public.bom_bom_lines l
  join public.bom_boms b on b.id = l.bom_pk
  where b.is_test and b.status = 'approved' and b.item_code = p_item.code
  order by l.line_no
  limit 1;
  if found and v_line.uom in ('kg', 'g') and v_line.qty > 0 then
    return round(v_qty * v_line.qty * (case when v_line.uom = 'kg' then 1 else 0.001 end) * (1 + v_line.scrap_pct / 100), 2);
  end if;
  if p_item.uom = 'kg' then
    v_kg := v_qty;
  else
    v_roll := case when jsonb_typeof(p_item.rubber -> 'kgPerRoll') = 'number' then (p_item.rubber ->> 'kgPerRoll')::numeric else 0 end;
    if v_roll > 0 then
      v_kg := v_qty * v_roll;
    elsif p_item.weight_g > 0 then
      v_kg := v_qty * p_item.weight_g / 1000;
    end if;
  end if;
  return round(v_kg * 1.05, 2);
end;
$$;
revoke all on function private.bom_rb_job_kg(public.bom_jobs, public.bom_items) from public, anon, authenticated;

-- เปิด WO ใน RubberFlow ให้งาน RB ของใบที่เพิ่งปล่อยผลิต (กติกาข้อ 1 ในหัวไฟล์) เรียกจาก app_bom_save_master หลังสร้างงานแล้วเท่านั้น
-- คืน { opened: [{jobId, woId, kg}], skipped: [{jobId, itemCode, reason}] } ผู้เรียกเพิ่ม version ของ RF และเขียน audit เมื่อ opened ไม่ว่าง
-- ล็อกแถวตัวนับ RF ก่อนอ่านเลข WO สูงสุด (เลขต่อกันไม่ซ้ำ) เฉพาะเมื่อมีงานที่เปิดได้
create or replace function private.bom_open_rf_orders(p_actor public.employees, p_actor_name text, p_order_pk uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ord public.bom_orders%rowtype;
  v_job public.bom_jobs%rowtype;
  v_item public.bom_items%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_compound text;
  v_recipe_code text;
  v_reason text;
  v_qty numeric;
  v_kg numeric;
  v_wo text;
  v_seq numeric := 0;
  v_locked boolean := false;
  v_stamp text := to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD');
  v_today bigint := private.bom_ms((date_trunc('day', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok');
  v_now bigint := private.bom_ms(now());
  v_opened jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  select * into v_ord from public.bom_orders o where o.is_test and o.id = p_order_pk;
  if not found then return jsonb_build_object('opened', v_opened, 'skipped', v_skipped); end if;

  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test and j.order_pk = p_order_pk and j.dept = 'RB' and j.external_ref is null
    order by j.job_no collate "C"
    for update
  loop
    v_reason := null;
    v_rec := null;
    select * into v_item from public.bom_items i where i.is_test and i.code = v_job.item_code;
    v_compound := nullif(v_item.rubber ->> 'compound', '');
    if v_compound is null then
      v_reason := 'ไม่มีรหัสสูตรยาง';
    else
      select c.recipe_id into v_recipe_code from public.bom_compounds c where c.is_test and c.code = v_compound;
      if v_recipe_code is null then
        v_reason := 'ยังไม่ผูกสูตร RubberFlow';
      else
        select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_recipe_code and r.status = 'approved';
        if not found then v_reason := 'สูตร ' || v_recipe_code || ' ยังไม่อนุมัติ'; end if;
      end if;
    end if;
    v_qty := greatest(0, v_job.qty_planned - v_job.qty_done);
    if v_reason is null and v_qty <= 0 then v_reason := 'ไม่มียอดให้ผลิต'; end if;
    if v_reason is null then
      v_kg := private.bom_rb_job_kg(v_job, v_item);
      -- เพดานเท่าคอลัมน์ target_kg และ kg_per_unit: เกินแล้วข้าม ไม่ปล่อยให้ constraint ทำการปล่อยผลิตล้ม
      if v_kg is null or v_kg <= 0 or v_kg > 1000000000 or v_kg / v_qty > 1000000000 then v_reason := 'คำนวณกิโลกรัมไม่ได้'; end if;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'itemCode', v_job.item_code, 'reason', v_reason));
      continue;
    end if;

    if not v_locked then
      perform private.bom_lock_rf();
      v_locked := true;
      -- เลข WO ถัดไปของวันนี้ (เวลา Asia/Bangkok): สูงสุดของ WO-<วัน>-<เลข> ที่มีอยู่ + 1 (ตัวเลขยาวผิดปกติเทียบเป็น numeric ไม่ล้น)
      select coalesce(max((m.n)[1]::numeric), 0) into v_seq
      from (select regexp_match(o.wo_no, '^WO-' || v_stamp || '-(\d{1,8})
      where m.n is not null;
    end if;
    v_seq := v_seq + 1;
    v_wo := 'WO-' || v_stamp || '-' || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');

    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      true, v_wo, v_ord.customer, v_ord.pi_no, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_job.uom,
      coalesce(nullif(left(v_item.rubber ->> 'color', 40), ''), 'ดำ'),
      v_qty, v_kg, private.bom_kg_per_unit(v_kg, v_qty), 0, v_today, greatest(coalesce(v_job.due_at, v_today), v_today),
      case when v_job.due_at < v_now then 'urgent' else 'normal' end,
      left('จาก BOM งาน ' || v_job.job_no || ' · PI ' || v_ord.pi_no || ' · ' || v_job.item_code || ' ' || trim_scale(v_qty)::text || ' ' || v_job.uom
           || ' ≈ ' || trim_scale(v_kg)::text || ' kg · เปิดอัตโนมัติตอนปล่อยใบ', 300),
      'planned', v_job.job_no, p_actor.id);

    update public.bom_jobs set
      external_ref = jsonb_build_object('system', 'rubberflow', 'woId', v_wo, 'kg', v_kg, 'linkedAt', v_now, 'by', p_actor_name, 'auto', true),
      updated_at = now()
    where id = v_job.id;

    v_opened := v_opened || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'woId', v_wo, 'kg', v_kg));
  end loop;

  return jsonb_build_object('opened', v_opened, 'skipped', v_skipped);
end;
$$;
revoke all on function private.bom_open_rf_orders(public.employees, text, uuid) from public, anon, authenticated;

-- ยกเลิก WO ที่ผูกกับงานของใบ (ยกเลิกใบ / เปิดใบกลับเป็นร่าง กติกาข้อ 2 ในหัวไฟล์) ก่อนลบงาน · คืนเลข WO ที่ยกเลิก
-- planned / released = cancelled · in_progress / on_hold / completed = BOM_RF_ORDER_STARTED · cancelled อยู่แล้วหรือไม่พบ WO = ข้ามเงียบ ๆ (ไม่มีอะไรให้ยกเลิก)
-- ผู้เรียก (app_bom_save_master) เพิ่ม version ของ RF และเขียน audit เมื่อคืนรายการ
create or replace function private.bom_cancel_rf_orders(p_order_pk uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_wo public.rf_orders%rowtype;
  v_cancelled text[] := '{}';
  v_locked boolean := false;
begin
  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test and j.order_pk = p_order_pk and j.external_ref is not null
    order by j.job_no collate "C"
    for update
  loop
    if not v_locked then
      perform private.bom_lock_rf();
      v_locked := true;
    end if;
    -- WO ต้องชี้กลับมาที่งานนี้ (source_job_no) ไม่งั้นถือว่าไม่มี WO ให้ยกเลิก (งานที่ถูกผูกมือกับ WO ของใบอื่นแตะ WO นั้นไม่ได้)
    select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = (v_job.external_ref ->> 'woId') and o.source_job_no = v_job.job_no for update;
    if not found then continue; end if;
    if v_wo.status in ('planned', 'released') then
      update public.rf_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_wo.id;
      v_cancelled := v_cancelled || v_wo.wo_no;
    elsif v_wo.status <> 'cancelled' then
      raise exception 'BOM_RF_ORDER_STARTED';
    end if;
  end loop;
  return v_cancelled;
end;
$$;
revoke all on function private.bom_cancel_rf_orders(uuid) from public, anon, authenticated;


-- 2. กติกาข้อ 2: งานที่ผูก WO นับว่าเริ่มแล้วเมื่อ WO เลย released (นิยามจาก 20261106010000 แล้วเปลี่ยนเฉพาะเงื่อนไข external_ref) ------------------------
create or replace function private.bom_started_jobs(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bom_jobs j
    where j.is_test and j.order_pk = p_order
      and (j.status <> 'queued' or j.qty_done > 0 or j.qty_reject > 0 or jsonb_array_length(j.reports) > 0
           -- ผูก WO: นับว่าเริ่มแล้วต่อเมื่อ WO เลย released ไปแล้ว หรือหา WO ไม่พบ (WO planned / released / cancelled ไม่นับ)
           or (j.external_ref is not null and not exists (
                 select 1 from public.rf_orders o
                 where o.is_test and o.wo_no = (j.external_ref ->> 'woId') and o.source_job_no = j.job_no and o.status in ('planned', 'released', 'cancelled')))))
$$;
revoke all on function private.bom_started_jobs(uuid) from public, anon, authenticated;
revoke all on function private.bom_started_jobs(uuid) from public, anon, authenticated;

-- 3. ใบสั่งผลิต: ยกเลิก / เปิดกลับเป็นร่าง ยกเลิก WO ที่ผูก (นิยามจาก 20261106010000 แล้วเปลี่ยนชนิดคืนและสองสาขานี้เท่านั้น) ----------------------------
-- คืน { released: [รหัสแถวของใบที่ปล่อยผลิต], cancelled: [เลข WO ที่ยกเลิก] } (ชนิดคืนเปลี่ยนจาก uuid[] จึงต้อง drop ก่อน)
drop function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint);
create or replace function private.bom_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_job_rows jsonb, p_base bigint, p_cur bigint)
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
  v_released uuid[] := '{}';
  v_cancelled text[] := '{}';
  v_reopened text[] := '{}';
  v_dept text := private.bom_dept_of(p_actor);
  v_pi text;
  v_customer text;
  v_country text;
  v_type text;
  v_ordered numeric;
  v_wh numeric;
  v_due jsonb;
  v_defaults jsonb;
  v_items jsonb;
  v_expl jsonb;
  v_counts jsonb;
  v_note text;
  v_status text;
  v_reason text;
  v_old public.bom_orders%rowtype;
  v_content boolean;
  v_counts_changed boolean;
  v_status_changed boolean;
  v_revision integer;
  v_reopen boolean;
  v_has_job boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
    if v_pi ~ '[[:cntrl:]]' or v_pi = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_pi;
    -- ชื่อลูกค้าบนใบใช้การจัดรูปเดียวกับตาราง bom_customers (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) client ใช้กฎเดียวกันกับกุญแจ
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_country := private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER'));
    if v_type not in ('SA', 'EX') then raise exception 'BOM_INVALID_ORDER'; end if;
    v_ordered := private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000);
    v_wh := private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ordered is null or v_wh is null or v_ordered <> trunc(v_ordered) or v_wh <> trunc(v_wh) or v_wh < v_ordered then
      raise exception 'BOM_INVALID_ORDER';
    end if;
    v_due := private.bom_parse_due(v_row -> 'due');
    v_node := v_row -> 'dueDefaults';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 10 then raise exception 'BOM_INVALID_ORDER'; end if;
    v_defaults := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
      v_defaults := v_defaults || jsonb_build_array(v_el);
    end loop;
    v_items := private.bom_parse_order_items(v_row -> 'items');
    v_expl := private.bom_parse_explosion(v_row -> 'explosion');
    v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER');
    v_reason := private.bom_text(v_row, 'cancelReason', 200, 0, 'BOM_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER');
    if v_status not in ('draft', 'released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_ORDER'; end if;

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id);
      continue;
    end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน: เช่นใบที่ผู้อื่นเพิ่งเปลี่ยนเป็น in_progress แล้วสำเนานี้ก็เป็น in_progress)
    if not (v_content or v_counts_changed or v_status_changed) then continue; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน (ตัวเขียนงานตรวจชนของงานเอง)
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- ชนก่อนสิทธิ์เสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า
    -- (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    -- สิทธิ์: กลุ่มวางแผนแก้ได้ทุกอย่าง · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่นแก้ไม่ได้
    if not p_planner then
      if v_content or v_status_changed or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
    end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        null;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'completed' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.dept = 'PK' and j.status <> 'done') then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.qty_done > 0) then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        -- WO ที่ผูกงาน: planned / released ยกเลิกให้ · เลยจากนั้น = BOM_RF_ORDER_STARTED (ผิดข้อใด ทั้งคำสั่งไม่เขียนอะไร)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- งานที่ผูก WO ที่เลย released ถูกนับว่าเริ่มแล้วข้างบน ที่เหลือ (WO planned / released) ยกเลิกให้ก่อนลบงาน
        v_reopened := v_reopened || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    update public.bom_orders set
      customer = v_customer, country = v_country, order_type = v_type, ordered_at = v_ordered::bigint, wh_due = v_wh::bigint,
      due = v_due, due_defaults = v_defaults, items = v_items, explosion = v_expl,
      exploded_at = case when v_reopen or v_expl is null then null
                         when v_old.explosion is distinct from v_expl or v_old.exploded_at is null then now()
                         else v_old.exploded_at end,
      stock_counts = v_counts,
      stock_counted_at = case when v_counts_changed then now() else v_old.stock_counted_at end,
      stock_counted_by = case when v_counts_changed then p_actor.id else v_old.stock_counted_by end,
      note = v_note, status = v_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened));
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. งานรายแผนก: external_ref ที่เซิร์ฟเวอร์ผูกให้เองมีช่อง auto ไม่นับเป็นการแก้ (นิยามจาก 20261106010000 แล้วเปลี่ยนเฉพาะการเทียบ external_ref) ------------
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns uuid[]
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

    v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

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
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;

    if not p_planner and v_work then
      -- งานที่ done แล้วพนักงานแผนกแก้ไม่ได้ · ยอดเพิ่มได้อย่างเดียวและต้องมาพร้อมรายงาน (ผลรวมดี/เสียของรายการใหม่เท่าส่วนที่เพิ่ม)
      if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
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

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return v_started;
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 5. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261106010000 แล้วเพิ่มล็อก advisory, เปิด/ยกเลิก WO ใน RubberFlow, ช่อง rubberflow ในคำตอบและ audit) ------------
-- ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย คืน delta ตั้งแต่ p_base_version: { version, epoch, changes } บวก rubberflow: { opened, skipped, cancelled } เฉพาะเมื่อมีอย่างน้อยหนึ่งอย่าง
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
                                      'customers', 'orders', 'jobs'];
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
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
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
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

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
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_started := private.bom_save_jobs(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                       v_released, p_base_version, v_version);
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    if exists (select 1 from unnest(v_released) r(id) where not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
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
      -- ชนิดพ่อ/ลูก (rules.childKindError)
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
             or (c.kind = 'CP' and p.kind <> 'RB'))
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
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n)) as k(ord, action, n)
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
) as n from public.rf_orders o where o.is_test) m
      where m.n is not null;
    end if;
    v_seq := v_seq + 1;
    v_wo := 'WO-' || v_stamp || '-' || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');

    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      true, v_wo, v_ord.customer, v_ord.pi_no, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_job.uom,
      coalesce(nullif(left(v_item.rubber ->> 'color', 40), ''), 'ดำ'),
      v_qty, v_kg, private.bom_kg_per_unit(v_kg, v_qty), 0, v_today, greatest(coalesce(v_job.due_at, v_today), v_today),
      case when v_job.due_at < v_now then 'urgent' else 'normal' end,
      left('จาก BOM งาน ' || v_job.job_no || ' · PI ' || v_ord.pi_no || ' · ' || v_job.item_code || ' ' || trim_scale(v_qty)::text || ' ' || v_job.uom
           || ' ≈ ' || trim_scale(v_kg)::text || ' kg · เปิดอัตโนมัติตอนปล่อยใบ', 300),
      'planned', v_job.job_no, p_actor.id);

    update public.bom_jobs set
      external_ref = jsonb_build_object('system', 'rubberflow', 'woId', v_wo, 'kg', v_kg, 'linkedAt', v_now, 'by', p_actor_name, 'auto', true),
      updated_at = now()
    where id = v_job.id;

    v_opened := v_opened || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'woId', v_wo, 'kg', v_kg));
  end loop;

  return jsonb_build_object('opened', v_opened, 'skipped', v_skipped);
end;
$$;
revoke all on function private.bom_open_rf_orders(public.employees, text, uuid) from public, anon, authenticated;

-- ยกเลิก WO ที่ผูกกับงานของใบ (ยกเลิกใบ / เปิดใบกลับเป็นร่าง กติกาข้อ 2 ในหัวไฟล์) ก่อนลบงาน · คืนเลข WO ที่ยกเลิก
-- planned / released = cancelled · in_progress / on_hold / completed = BOM_RF_ORDER_STARTED · cancelled อยู่แล้วหรือไม่พบ WO = ข้ามเงียบ ๆ (ไม่มีอะไรให้ยกเลิก)
-- ผู้เรียก (app_bom_save_master) เพิ่ม version ของ RF และเขียน audit เมื่อคืนรายการ
create or replace function private.bom_cancel_rf_orders(p_order_pk uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_wo public.rf_orders%rowtype;
  v_cancelled text[] := '{}';
  v_locked boolean := false;
begin
  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test and j.order_pk = p_order_pk and j.external_ref is not null
    order by j.job_no collate "C"
    for update
  loop
    if not v_locked then
      perform private.bom_lock_rf();
      v_locked := true;
    end if;
    -- WO ต้องชี้กลับมาที่งานนี้ (source_job_no) ไม่งั้นถือว่าไม่มี WO ให้ยกเลิก (งานที่ถูกผูกมือกับ WO ของใบอื่นแตะ WO นั้นไม่ได้)
    select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = (v_job.external_ref ->> 'woId') and o.source_job_no = v_job.job_no for update;
    if not found then continue; end if;
    if v_wo.status in ('planned', 'released') then
      update public.rf_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_wo.id;
      v_cancelled := v_cancelled || v_wo.wo_no;
    elsif v_wo.status <> 'cancelled' then
      raise exception 'BOM_RF_ORDER_STARTED';
    end if;
  end loop;
  return v_cancelled;
end;
$$;
revoke all on function private.bom_cancel_rf_orders(uuid) from public, anon, authenticated;


-- 2. กติกาข้อ 2: งานที่ผูก WO นับว่าเริ่มแล้วเมื่อ WO เลย released (นิยามจาก 20261106010000 แล้วเปลี่ยนเฉพาะเงื่อนไข external_ref) ------------------------
create or replace function private.bom_started_jobs(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bom_jobs j
    where j.is_test and j.order_pk = p_order
      and (j.status <> 'queued' or j.qty_done > 0 or j.qty_reject > 0 or jsonb_array_length(j.reports) > 0
           -- ผูก WO: นับว่าเริ่มแล้วต่อเมื่อ WO เลย released ไปแล้ว หรือหา WO ไม่พบ (WO planned / released / cancelled ไม่นับ)
           or (j.external_ref is not null and not exists (
                 select 1 from public.rf_orders o
                 where o.is_test and o.wo_no = (j.external_ref ->> 'woId') and o.source_job_no = j.job_no and o.status in ('planned', 'released', 'cancelled')))))
$$;
revoke all on function private.bom_started_jobs(uuid) from public, anon, authenticated;
revoke all on function private.bom_started_jobs(uuid) from public, anon, authenticated;

-- 3. ใบสั่งผลิต: ยกเลิก / เปิดกลับเป็นร่าง ยกเลิก WO ที่ผูก (นิยามจาก 20261106010000 แล้วเปลี่ยนชนิดคืนและสองสาขานี้เท่านั้น) ----------------------------
-- คืน { released: [รหัสแถวของใบที่ปล่อยผลิต], cancelled: [เลข WO ที่ยกเลิก] } (ชนิดคืนเปลี่ยนจาก uuid[] จึงต้อง drop ก่อน)
drop function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint);
create or replace function private.bom_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_job_rows jsonb, p_base bigint, p_cur bigint)
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
  v_released uuid[] := '{}';
  v_cancelled text[] := '{}';
  v_reopened text[] := '{}';
  v_dept text := private.bom_dept_of(p_actor);
  v_pi text;
  v_customer text;
  v_country text;
  v_type text;
  v_ordered numeric;
  v_wh numeric;
  v_due jsonb;
  v_defaults jsonb;
  v_items jsonb;
  v_expl jsonb;
  v_counts jsonb;
  v_note text;
  v_status text;
  v_reason text;
  v_old public.bom_orders%rowtype;
  v_content boolean;
  v_counts_changed boolean;
  v_status_changed boolean;
  v_revision integer;
  v_reopen boolean;
  v_has_job boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
    if v_pi ~ '[[:cntrl:]]' or v_pi = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_pi;
    -- ชื่อลูกค้าบนใบใช้การจัดรูปเดียวกับตาราง bom_customers (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) client ใช้กฎเดียวกันกับกุญแจ
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_country := private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER'));
    if v_type not in ('SA', 'EX') then raise exception 'BOM_INVALID_ORDER'; end if;
    v_ordered := private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000);
    v_wh := private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ordered is null or v_wh is null or v_ordered <> trunc(v_ordered) or v_wh <> trunc(v_wh) or v_wh < v_ordered then
      raise exception 'BOM_INVALID_ORDER';
    end if;
    v_due := private.bom_parse_due(v_row -> 'due');
    v_node := v_row -> 'dueDefaults';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 10 then raise exception 'BOM_INVALID_ORDER'; end if;
    v_defaults := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
      v_defaults := v_defaults || jsonb_build_array(v_el);
    end loop;
    v_items := private.bom_parse_order_items(v_row -> 'items');
    v_expl := private.bom_parse_explosion(v_row -> 'explosion');
    v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER');
    v_reason := private.bom_text(v_row, 'cancelReason', 200, 0, 'BOM_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER');
    if v_status not in ('draft', 'released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_ORDER'; end if;

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id);
      continue;
    end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน: เช่นใบที่ผู้อื่นเพิ่งเปลี่ยนเป็น in_progress แล้วสำเนานี้ก็เป็น in_progress)
    if not (v_content or v_counts_changed or v_status_changed) then continue; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน (ตัวเขียนงานตรวจชนของงานเอง)
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- ชนก่อนสิทธิ์เสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า
    -- (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    -- สิทธิ์: กลุ่มวางแผนแก้ได้ทุกอย่าง · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่นแก้ไม่ได้
    if not p_planner then
      if v_content or v_status_changed or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
    end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        null;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'completed' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.dept = 'PK' and j.status <> 'done') then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.qty_done > 0) then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        -- WO ที่ผูกงาน: planned / released ยกเลิกให้ · เลยจากนั้น = BOM_RF_ORDER_STARTED (ผิดข้อใด ทั้งคำสั่งไม่เขียนอะไร)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- งานที่ผูก WO ที่เลย released ถูกนับว่าเริ่มแล้วข้างบน ที่เหลือ (WO planned / released) ยกเลิกให้ก่อนลบงาน
        v_reopened := v_reopened || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    update public.bom_orders set
      customer = v_customer, country = v_country, order_type = v_type, ordered_at = v_ordered::bigint, wh_due = v_wh::bigint,
      due = v_due, due_defaults = v_defaults, items = v_items, explosion = v_expl,
      exploded_at = case when v_reopen or v_expl is null then null
                         when v_old.explosion is distinct from v_expl or v_old.exploded_at is null then now()
                         else v_old.exploded_at end,
      stock_counts = v_counts,
      stock_counted_at = case when v_counts_changed then now() else v_old.stock_counted_at end,
      stock_counted_by = case when v_counts_changed then p_actor.id else v_old.stock_counted_by end,
      note = v_note, status = v_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened));
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. งานรายแผนก: external_ref ที่เซิร์ฟเวอร์ผูกให้เองมีช่อง auto ไม่นับเป็นการแก้ (นิยามจาก 20261106010000 แล้วเปลี่ยนเฉพาะการเทียบ external_ref) ------------
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns uuid[]
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

    v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

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
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;

    if not p_planner and v_work then
      -- งานที่ done แล้วพนักงานแผนกแก้ไม่ได้ · ยอดเพิ่มได้อย่างเดียวและต้องมาพร้อมรายงาน (ผลรวมดี/เสียของรายการใหม่เท่าส่วนที่เพิ่ม)
      if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
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

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return v_started;
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 5. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261106010000 แล้วเพิ่มล็อก advisory, เปิด/ยกเลิก WO ใน RubberFlow, ช่อง rubberflow ในคำตอบและ audit) ------------
-- ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย คืน delta ตั้งแต่ p_base_version: { version, epoch, changes } บวก rubberflow: { opened, skipped, cancelled } เฉพาะเมื่อมีอย่างน้อยหนึ่งอย่าง
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
                                      'customers', 'orders', 'jobs'];
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
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
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
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

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
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_started := private.bom_save_jobs(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                       v_released, p_base_version, v_version);
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    if exists (select 1 from unnest(v_released) r(id) where not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
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
      -- ชนิดพ่อ/ลูก (rules.childKindError)
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
             or (c.kind = 'CP' and p.kind <> 'RB'))
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
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n)) as k(ord, action, n)
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
