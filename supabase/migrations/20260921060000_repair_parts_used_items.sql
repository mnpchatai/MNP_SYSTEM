-- รายการอะไหล่/วัสดุที่ใช้ในงานซ่อม — เปลี่ยนจากช่องข้อความล้วนเดียว ให้เป็นรายการโครงสร้าง
-- (ชื่อ/จำนวน/หน่วย/ราคา/ร้าน/หมายเหตุ) แบบเดียวกับ maintRecord.parts[] ของระบบ Maintanance-MT เดิม
--
-- ระบบเดิมเก็บอะไหล่แต่ละใบเป็นอาร์เรย์ของอ็อบเจกต์แล้วจัดรูปเป็นรายการลำดับเลขด้วย formatParts_()
-- (ดู docs/main-api.gs) แต่ตอนยกงานซ่อมเข้า MNP_SYSTEM ครั้งแรก (20260917101000) ช่องนี้ถูกลดรูป
-- เหลือ parts_used เป็น text เดียว ช่างจึงพิมพ์ได้แค่ก้อนข้อความ ไม่มีจำนวน/ราคา/ร้านแยกช่องให้กรอก
-- และฝั่งอ่านก็เอาไปใช้เปรียบเทียบ/รวมยอดต่อไม่ได้
--
-- แก้โดยเพิ่ม parts_used_items (jsonb array) เก็บรายการโครงสร้างจริง ส่วน parts_used (text เดิม)
-- ยังอยู่ครบ ไม่ลบ — ตอนนี้ RPC เป็นผู้คำนวณให้อัตโนมัติจาก parts_used_items (จัดรูปแบบเดียวกับ
-- formatParts_ เดิม) แทนที่จะรับข้อความจากผู้เรียกตรงๆ จึงยังอ่านได้จากทุกจุดที่เคยอ่าน parts_used
-- อยู่แล้ว (request facts ในหน้ารายละเอียด, สำเนาที่ซิงก์ไป Apps Script) โดยไม่ต้องแก้โค้ดฝั่งอ่าน

alter table public.requests
  add column if not exists parts_used_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(parts_used_items) = 'array');

-- app_finish_repair_work รุ่นใหม่ รับ p_parts_used_items (jsonb) แทน p_parts_used (text) เดิม —
-- ชนิดพารามิเตอร์ตัวที่ 5 เปลี่ยนจาก text เป็น jsonb จึงเป็นฟังก์ชันคนละตัวกับของเดิมในทาง Postgres
-- (overload ตาม argument types) ต้อง drop ตัวเดิมทิ้งท้ายไฟล์ตามกติกาเดิมของ repo นี้
create or replace function public.app_finish_repair_work(
  p_request_id uuid,
  p_execution_plan text,
  p_cause_analysis text,
  p_inspector_opinion text,
  p_parts_used_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_is_admin boolean;
  v_item jsonb;
  v_name text;
  v_qty text;
  v_unit text;
  v_price text;
  v_shop text;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_summary text := '';
  v_line text;
  v_n integer := 0;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  if p_execution_plan not in ('immediate', 'need_purchase', 'use_existing') then
    raise exception 'INVALID_EXECUTION_PLAN';
  end if;
  if p_inspector_opinion not in ('send_repair', 'external', 'self_repair', 'buy_parts') then
    raise exception 'INVALID_INSPECTOR_OPINION';
  end if;
  if char_length(trim(coalesce(p_cause_analysis, ''))) not between 3 and 5000 then
    raise exception 'INVALID_CAUSE_ANALYSIS';
  end if;
  if jsonb_typeof(coalesce(p_parts_used_items, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_PARTS_USED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'in_progress' then
    raise exception 'REQUEST_NOT_IN_PROGRESS';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if v_request.assignee_id is null or (v_request.assignee_id <> v_employee.id and not v_is_admin) then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

  -- แถวที่ไม่มีชื่ออะไหล่เลยถูกข้ามเงียบๆ (ผู้ใช้เพิ่มแถวว่างทิ้งไว้แล้วไม่ได้กรอกก็ยังส่งฟอร์มได้)
  -- ส่วนแถวที่มีชื่อ ทุกช่องอื่นเป็น optional เหมือนระบบเดิม (formatParts_ ก็ join เฉพาะช่องที่มีค่า)
  for v_item in select * from jsonb_array_elements(coalesce(p_parts_used_items, '[]'::jsonb))
  loop
    v_name := nullif(trim(coalesce(v_item->>'name', '')), '');
    continue when v_name is null;
    v_name := left(v_name, 200);
    v_qty := nullif(left(trim(coalesce(v_item->>'qty', '')), 50), '');
    v_unit := nullif(left(trim(coalesce(v_item->>'unit', '')), 50), '');
    v_price := nullif(left(trim(coalesce(v_item->>'price', '')), 50), '');
    v_shop := nullif(left(trim(coalesce(v_item->>'shop', '')), 200), '');
    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');

    v_n := v_n + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'qty', v_qty, 'unit', v_unit, 'price', v_price, 'shop', v_shop, 'note', v_note
    ));

    v_line := v_n::text || '. ' || v_name;
    if v_qty is not null or v_unit is not null then
      v_line := v_line || ' / จำนวน ' || trim(both ' ' from concat_ws(' ', v_qty, v_unit));
    end if;
    if v_price is not null then
      v_line := v_line || ' / ราคา ' || v_price || ' บาท';
    end if;
    if v_shop is not null then
      v_line := v_line || ' / ร้าน ' || v_shop;
    end if;
    if v_note is not null then
      v_line := v_line || ' / หมายเหตุ ' || v_note;
    end if;
    v_summary := v_summary || case when v_n = 1 then '' else chr(10) end || v_line;
  end loop;

  update public.requests
  set status = 'pending_verify',
      execution_plan = p_execution_plan,
      cause_analysis = trim(p_cause_analysis),
      inspector_opinion = p_inspector_opinion,
      parts_used = nullif(v_summary, ''),
      parts_used_items = v_items,
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_finish_repair_work(uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.app_finish_repair_work(uuid, text, text, text, jsonb) to authenticated;

-- ฟังก์ชันเดิมรับ p_parts_used เป็น text (ตัวที่ 5) — ลบทิ้งเมื่อไม่มีผู้เรียกแล้ว (app.js ปรับตามในคอมมิตนี้)
drop function if exists public.app_finish_repair_work(uuid, text, text, text, text);
