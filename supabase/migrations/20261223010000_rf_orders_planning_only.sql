-- ============================================================================
-- RubberFlow: เปิดใบสั่งผลิตยางใหม่และปล่อยผลิตเป็นของฝ่ายวางแผนเท่านั้น
--
-- ทำไม (คำสั่งเจ้าของโรงงาน 2026-11-24): การเปิด WO ใหม่ (public.rf_orders insert สถานะ planned) และการปล่อยผลิต (planned -> released)
--   ทำโดยกลุ่มวางแผนจากโมดูลวางแผนเท่านั้น สมาชิกแผนก RB (p_rb) และหัว RB (p_head เช่นผู้ช่วยผู้จัดการแผนก RB ที่ไม่อยู่กลุ่มวางแผน)
--   ถูกปฏิเสธด้วย RF_FORBIDDEN · ผู้จัดการแผนก RB อยู่ในกลุ่มวางแผนแล้ว (private.bom_can_edit รวม department_manager ของแผนกผลิต) จึงยังทำได้
--
-- เปลี่ยนเพียงสองเงื่อนไขใน private.rf_save_orders (นอกนั้นเหมือนต้นฉบับทุกตัวอักษร):
--   1) ปล่อยผลิต:  not (p_planner or p_head)  ->  not p_planner
--   2) ใบใหม่:     not (p_planner or p_rb)    ->  not p_planner
--   ไม่เปลี่ยน: ใบเดิมที่ RB ยังเลื่อน released -> in_progress, in_progress / released -> on_hold, on_hold -> in_progress, in_progress -> completed,
--     กฎยกเลิก, private.bom_open_rf_orders (เปิด WO อัตโนมัติตอนปล่อย PI), ด่านโหมดทดสอบ · ไม่แตะ private.bom_real_open() และการเปิดใช้งานจริง
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม): private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint)
--   คัดจากนิยามล่าสุดบน main: 20261130010000_bom_rf_go_live.sql (บรรทัด 1318-1470) · ไม่มี migration ใหม่กว่านั้นที่นิยามซ้ำ
--
-- ลำดับ deploy: backward compatible (ไม่มีช่องหรือ action ใหม่ แค่ปฏิเสธเพิ่ม)
--   Pilot เก่า + ฐานข้อมูลใหม่: ปุ่มเปิด / ปล่อยของ RB ยังแสดงแต่กดแล้วได้ RF_FORBIDDEN · Pilot ใหม่ + ฐานข้อมูลเก่า: ซ่อนปุ่ม แต่ฐานข้อมูลยังยอม RB ถ้าเรียก RPC ตรง
--   ก่อน apply ที่ production (ต้องได้อนุมัติของผู้ใช้): เทียบ md5(pg_get_functiondef(oid)) กับนิยามในไฟล์ต้นทาง แล้ว apply ไฟล์ที่อยู่บน branch ตรง ๆ
--
-- Rollback: รันนิยามเดิมของ private.rf_save_orders จาก 20261130010000_bom_rf_go_live.sql อีกครั้ง (create or replace) · ไม่มีข้อมูลที่ต้องย้อน
-- ============================================================================

-- private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261130010000_bom_rf_go_live.sql
create or replace function private.rf_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rb boolean, p_head boolean,
  p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_wo text;
  v_customer text;
  v_po text;
  v_rcode text;
  v_rrev numeric;
  v_color text;
  v_target numeric;
  v_tkg numeric;
  v_kpu numeric;
  v_prod numeric;
  v_start numeric;
  v_due numeric;
  v_priority text;
  v_note text;
  v_status text;
  v_src text;
  v_uom text;
  v_old public.rf_orders%rowtype;
  v_new public.rf_orders%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_job public.bom_jobs%rowtype;
  v_content boolean;
  v_status_changed boolean;
  v_flow boolean;
  v_res jsonb;
  v_bom_jobs integer := 0;
  v_bom_orders integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_ORDER'; end if;
    v_wo := private.bom_text(v_row, 'id', 40, 1, 'RF_INVALID_ORDER');
    if v_wo !~ '^[A-Za-z0-9._-]{1,40}$' or v_wo = any (v_seen) then raise exception 'RF_INVALID_ORDER'; end if;
    v_seen := v_seen || v_wo;
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'RF_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_po := private.bom_text(v_row, 'customerPo', 60, 0, 'RF_INVALID_ORDER');
    v_rcode := private.bom_text(v_row, 'recipeId', 60, 1, 'RF_INVALID_ORDER');
    v_rrev := private.bom_num(v_row -> 'recipeRevision', 'RF_INVALID_ORDER', 1, 9999);
    if v_rrev is not null and v_rrev <> trunc(v_rrev) then raise exception 'RF_INVALID_ORDER'; end if;
    v_color := private.bom_text(v_row, 'color', 40, 0, 'RF_INVALID_ORDER');
    v_target := private.bom_num(v_row -> 'targetQty', 'RF_INVALID_ORDER', 0, 1000000000);
    if v_target is null or v_target <= 0 then raise exception 'RF_INVALID_ORDER'; end if;
    v_tkg := private.bom_num(v_row -> 'targetKg', 'RF_INVALID_ORDER', 0, 1000000000);
    v_kpu := private.bom_num(v_row -> 'kgPerUnit', 'RF_INVALID_ORDER', 0, 1000000000);
    v_prod := coalesce(private.bom_num(v_row -> 'producedQty', 'RF_INVALID_ORDER', 0, 1000000000), 0);
    v_start := private.bom_num(v_row -> 'startDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    v_due := private.bom_num(v_row -> 'dueDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    if v_start is null or v_due is null or v_start <> trunc(v_start) or v_due <> trunc(v_due) or v_due < v_start then
      raise exception 'RF_INVALID_ORDER';
    end if;
    v_priority := coalesce(nullif(private.bom_text(v_row, 'priority', 10, 0, 'RF_INVALID_ORDER'), ''), 'normal');
    if v_priority not in ('normal', 'urgent') then raise exception 'RF_INVALID_ORDER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_ORDER');
    if v_status not in ('planned', 'released', 'in_progress', 'on_hold', 'completed', 'cancelled') then raise exception 'RF_INVALID_ORDER'; end if;
    v_src := nullif(private.bom_text(v_row, 'sourceJobId', 40, 0, 'RF_INVALID_ORDER'), '');
    if v_src is not null and v_src !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'RF_INVALID_ORDER'; end if;

    select * into v_old from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_wo;
    if found then
      -- ใบเดิม: เนื้อหาแก้ไม่ได้หลังสร้าง (recipeRevision ที่ client ไม่ส่งมาไม่นับ) · สถานะเปลี่ยนได้ตามกฎ · producedQty ที่ client ส่งมาเมิน (เซิร์ฟเวอร์นับจากล็อตตกแต่ง)
      v_content := v_old.customer <> v_customer or v_old.customer_po <> v_po or v_old.recipe_code <> v_rcode
        or (v_rrev is not null and v_old.recipe_revision <> v_rrev::integer) or v_old.color <> v_color
        or v_old.target_qty <> v_target or v_old.target_kg is distinct from v_tkg or v_old.kg_per_unit is distinct from v_kpu
        or v_old.start_date <> v_start::bigint or v_old.due_date <> v_due::bigint or v_old.priority <> v_priority
        or v_old.note <> v_note or v_old.source_job_no is distinct from v_src;
      v_status_changed := v_old.status <> v_status;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if not (v_content or v_status_changed) then continue; end if;

      -- ชนก่อนสิทธิ์/กฎเสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
      if v_content then raise exception 'RF_INVALID_ORDER'; end if;
      -- ปล่อยผลิต: ฝ่ายวางแผนเท่านั้น (คำสั่งเจ้าของ 2026-11-24 · สมาชิกและหัว RB ที่ไม่ใช่กลุ่มวางแผนปล่อยไม่ได้ · ตรวจสิทธิ์ก่อนความถูกต้องของสถานะ)
      if v_status_changed and v_status = 'released' and not p_planner then raise exception 'RF_FORBIDDEN'; end if;
      if v_status_changed then
        v_flow := case v_old.status
          when 'planned' then v_status in ('released', 'cancelled')
          when 'released' then v_status in ('in_progress', 'on_hold', 'cancelled')
          when 'in_progress' then v_status in ('on_hold', 'completed')
          when 'on_hold' then v_status = 'in_progress'
          else false end;
        if not v_flow then raise exception 'RF_INVALID_TRANSITION'; end if;
      end if;

      update public.rf_orders set
        status = v_status,
        released_at = case when v_status = 'released' and v_status_changed then now() else released_at end,
        released_by = case when v_status = 'released' and v_status_changed then p_actor.id else released_by end,
        completed_at = case when v_status = 'completed' and v_status_changed then now() else completed_at end,
        cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else cancelled_at end,
        updated_at = now()
      where id = v_old.id
      returning * into v_new;
      -- ยกเลิก WO ที่ผูกงาน BOM: ล้างการผูกของงาน (ผูกกับ WO ใบใหม่ได้) ในธุรกรรมเดียวกัน
      if v_status_changed and v_status = 'cancelled' and v_new.source_job_no is not null then
        v_res := private.rf_unlink_job(p_actor_name, v_new);
        v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
        v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
      end if;
      continue;
    end if;

    -- ใบใหม่: ฝ่ายวางแผนเท่านั้น (คำสั่งเจ้าของ 2026-11-24) เริ่มที่ planned เสมอ ยอดผลิต 0
    if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'planned' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if v_prod <> 0 then raise exception 'RF_INVALID_ORDER'; end if;
    -- สูตร: ใช้ได้เฉพาะ approved (ไม่ระบุ revision = ตัวที่ approved อยู่) สูตรที่ถูกแก้หลังเวอร์ชันฐาน = ถือสำเนาเก่า
    if v_rrev is null then
      select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode and r.status = 'approved';
    else
      select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode and r.revision = v_rrev::integer;
    end if;
    if not found or v_rec.status <> 'approved' then
      if exists (select 1 from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode
                 and r.changed_version > p_base and r.changed_version <= p_cur) then
        raise exception 'RF_STALE';
      end if;
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_uom := v_rec.uom;
    if v_src is not null then
      -- ตรวจและล็อกงาน BOM ก่อนเขียน WO (ผิด = RF_INVALID_SOURCE_JOB) WO ใช้หน่วยของงาน
      v_job := private.rf_job_for_link(v_src);
      v_uom := v_job.uom;
    end if;
    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      (select private.bom_test_mode()), v_wo, v_customer, v_po, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_uom, v_color,
      v_target, v_tkg, v_kpu, 0, v_start::bigint, v_due::bigint, v_priority, v_note, 'planned', v_src, p_actor.id);
    if v_src is not null then
      v_res := private.rf_link_job(v_job, p_actor_name, v_wo, coalesce(v_tkg, 0));
      v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
      v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_bom_jobs, 'orders', v_bom_orders);
end;
$$;
revoke all on function private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;
