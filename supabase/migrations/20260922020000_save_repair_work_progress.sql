-- แยกปุ่ม "บันทึกข้อมูล" ออกจากปุ่ม "เสร็จสิ้นงาน" ในฟอร์มบันทึกผลการซ่อม เพราะฟังก์ชันไม่เหมือนกัน:
-- app_finish_repair_work (เดิม) เปลี่ยนสถานะเป็น pending_verify และแจ้งเตือนผู้แจ้ง/ผจก. ให้ไปตรวจรับ
-- ส่วน RPC ใหม่นี้แค่บันทึกวิเคราะห์สาเหตุ/รายการอะไหล่ที่กรอกไว้ ทำต่อภายหลังได้ ไม่เปลี่ยนสถานะ
-- และไม่ส่งแจ้งเตือน — ใช้ตอนช่างยังทำงานไม่เสร็จแต่อยากกันข้อมูลหาย
create or replace function public.app_save_repair_work_progress(
  p_request_id uuid,
  p_cause_analysis text,
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
  v_owning_department_id uuid;
  v_is_admin boolean;
  v_is_owning_department_manager boolean;
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

  -- ต่างจาก app_finish_repair_work ตรงที่ยอมให้บันทึกค่าว่าง/ไม่ครบได้ (แค่บันทึกความคืบหน้า)
  if char_length(coalesce(p_cause_analysis, '')) > 5000 then
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

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  -- เงื่อนไขสิทธิ์เดียวกับ app_finish_repair_work: ช่างในชุด + หัวหน้าแผนกซ่อมบำรุงเจ้าของงาน + admin
  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  v_is_owning_department_manager := v_owning_department_id is not null
    and v_employee.department_id = v_owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code = 'department_manager'
    );
  if not (v_is_admin or v_is_owning_department_manager
          or private.is_request_technician(v_request.id, v_employee.id)) then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

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

  -- ไม่แตะ status และไม่ insert notifications — แค่บันทึกความคืบหน้า ไม่ใช่การจบงาน
  update public.requests
  set cause_analysis = nullif(trim(coalesce(p_cause_analysis, '')), ''),
      parts_used = nullif(v_summary, ''),
      parts_used_items = v_items,
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_save_repair_work_progress(uuid, text, jsonb) from public, anon;
grant execute on function public.app_save_repair_work_progress(uuid, text, jsonb) to authenticated;
