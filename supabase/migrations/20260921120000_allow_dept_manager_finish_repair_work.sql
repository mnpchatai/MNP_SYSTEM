-- ให้หัวหน้าแผนกซ่อมบำรุงเจ้าของงาน "บันทึกผลการซ่อมและจบงาน" แทนช่างในชุดได้
--
-- 20260921090000 ตัดสิทธิ์ ผจก.โรงงาน/ผจก.ทั่วไป ออกจากขั้นจบงานไปแล้ว แต่พลอยเหลือแค่ "ช่างในชุด"
-- เท่านั้นที่กดได้ ทั้งที่ปุ่มเริ่มงาน (app_start_repair_work, 090000 บรรทัด 682-685) กับหมุดความ
-- คืบหน้า (app_record_progress_step) ให้หัวหน้าแผนกซ่อมบำรุงเจ้าของงาน (department_manager ของ
-- request_types.owning_department_id) กดแทนช่างได้อยู่แล้ว — ผู้ใช้ยืนยันว่าขั้นจบงานต้องให้หัวหน้า
-- แผนกกดแทนได้เช่นกัน จึงเพิ่มเงื่อนไขเดียวกับ app_start_repair_work เข้ามาที่นี่
create or replace function public.app_finish_repair_work(
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

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  -- ผจก.โรงงาน/ผจก.ทั่วไป กดจบงานแทนช่างไม่ได้ (ยืนยันจากผู้ใช้) เหลือช่างในชุด + หัวหน้าแผนก
  -- ซ่อมบำรุงเจ้าของงาน + admin — เงื่อนไขเดียวกับปุ่มเริ่มงาน/หมุดความคืบหน้า
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

  update public.requests
  set status = 'pending_verify',
      cause_analysis = trim(p_cause_analysis),
      parts_used = nullif(v_summary, ''),
      parts_used_items = v_items,
      last_changed_by = v_employee.id
  where id = v_request.id;

  -- สเปกข้อ 06: แจ้งผู้แจ้งให้ไปลองใช้งาน และแจ้ง ผจก.ซ่อมบำรุงว่างานรอตรวจรับอยู่
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'ซ่อมเสร็จแล้ว รอตรวจรับ'),
         v_request.request_no || ' · ' || coalesce(v_request.machine_name, v_request.title),
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_finish_repair_work(uuid, text, jsonb) from public, anon;
grant execute on function public.app_finish_repair_work(uuid, text, jsonb) to authenticated;
