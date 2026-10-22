-- ประวัติการซ่อมของเครื่องจักร: กดการ์ด "เครื่องจักร" ในหน้ารายละเอียดใบแจ้งซ่อมแล้วเห็นรายการใบทั้งหมดที่ผูกกับเครื่องนั้น
--
-- ทำไมต้องผ่าน RPC: RLS ของ requests (private.can_access_request) ให้ผู้แจ้งเห็นแค่ใบของตัวเอง และช่างเห็นแค่ใบที่ได้รับ
-- มอบหมาย ถ้า query ตรงๆ ประวัติจะแหว่ง ฟังก์ชันนี้จึงอ่านข้ามขอบเขตนั้นได้เฉพาะกลุ่มที่กำหนดไว้ด้านล่าง
-- และคืนเฉพาะฟิลด์สรุป (ไม่คืนไฟล์แนบ ความเห็นอนุมัติ หรือข้อมูลผู้แจ้ง)
--
-- กติกา (ตรวจที่ฐานข้อมูลทุกครั้ง ไม่เชื่อค่าจาก client)
--   - เริ่มด้วย perform private.lab_only_block(); ตามกติกาของ 20261019005000_lab_only_accounts.sql (บัญชี LAB-only เรียกไม่ได้)
--   - ต้องล็อกอิน เป็นพนักงาน active และเปิดใบที่ส่งมา (p_request_id) ได้ตามสิทธิ์เดิม (private.can_access_request)
--     ใบนั้นต้องเป็นประเภทที่ใช้ workflow แจ้งซ่อม (request_types.uses_repair_workflow)
--   - ผู้เรียกต้องอยู่ในกลุ่มใดกลุ่มหนึ่ง
--       * บทบาท admin / ผู้จัดการทั่วไป / ผู้จัดการโรงงาน / ผู้ช่วยผู้จัดการโรงงาน
--       * ผู้แจ้งของใบที่เปิดอยู่
--       * พนักงานแผนกของเครื่อง (ทุกตำแหน่ง รวมผู้จัดการและผู้ช่วยผู้จัดการแผนก)
--       * พนักงานแผนกเจ้าของงานซ่อม (ช่างและหัวหน้าช่างของ MT) เห็นทุกเครื่อง เพราะช่างซ่อมข้ามแผนก
--   - ใบที่ผูกเครื่องเดียวกัน = machine_id เดียวกัน หรือฝั่งใดฝั่งหนึ่งเป็นใบเก่าที่ไม่มี machine_id แต่แผนกและรหัสเครื่อง
--     ตรงกัน (รหัสเทียบแบบไม่สนตัวพิมพ์และช่องว่าง เหมือน app_create_machine) ใบที่มี machine_id ต่างกันไม่ถูกรวมด้วยรหัส
--     เครื่องตัวเลือกพิเศษ "สร้างใหม่"/"ไม่มี" ไม่มีประวัติ
--   - ไม่รวมใบปัจจุบันและใบ draft เรียงใหม่ไปเก่า สูงสุด 50 รายการ
--   - can_open บอกว่าผู้เรียกเปิดใบนั้นได้ตามสิทธิ์เดิมหรือไม่ ให้ client แสดงลิงก์เฉพาะใบที่เปิดได้
--
-- ย้อนกลับ: drop function public.app_get_machine_repair_history(uuid);
-- (ฟังก์ชันอ่านอย่างเดียว ไม่แก้ข้อมูลใดๆ จึงลบได้โดยไม่กระทบใบที่มีอยู่ ส่วน client จะแสดงข้อความว่ายังไม่เปิดใช้)

create or replace function public.app_get_machine_repair_history(p_request_id uuid)
returns table (
  request_id uuid,
  request_no text,
  doc_type text,
  status text,
  created_at timestamptz,
  completed_at timestamptz,
  description text,
  cause_analysis text,
  parts_used text,
  technician_names text,
  can_open boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_employee_department uuid;
  v_role_code text;
  v_request public.requests%rowtype;
  v_owning_department uuid;
  v_machine public.machines%rowtype;
  v_key text;
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select e.id, e.department_id, ro.code
  into v_employee_id, v_employee_department, v_role_code
  from public.employees e
  join public.roles ro on ro.id = e.role_id
  where e.auth_user_id = auth.uid() and e.is_active
  limit 1;
  if v_employee_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_request from public.requests r where r.id = p_request_id;
  if v_request.id is null or not private.can_access_request(p_request_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select rt.owning_department_id into v_owning_department
  from public.request_types rt
  where rt.id = v_request.request_type_id and rt.uses_repair_workflow;
  if not found then
    raise exception 'NOT_REPAIR_REQUEST';
  end if;

  if v_request.machine_id is not null then
    select * into v_machine from public.machines m where m.id = v_request.machine_id;
  end if;

  if not coalesce(
    v_role_code in ('admin', 'general_manager', 'factory_manager', 'assistant_factory_manager')
    or v_request.requester_id = v_employee_id
    or v_employee_department = v_request.department_id
    or v_employee_department = v_machine.department_id
    or v_employee_department = v_owning_department,
    false
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_key := upper(regexp_replace(btrim(coalesce(v_request.machine_code, '')), '\s', '', 'g'));

  -- เครื่องตัวเลือกพิเศษ ("สร้างใหม่"/"ไม่มี") ไม่ใช่เครื่องจริง จึงไม่มีประวัติ
  if coalesce(v_machine.is_placeholder, false)
     or (v_request.machine_id is null and v_key in ('', 'สร้างใหม่', 'ไม่มี')) then
    return;
  end if;

  return query
  select
    r2.id,
    r2.request_no,
    r2.doc_type,
    r2.status::text,
    r2.created_at,
    r2.completed_at,
    r2.description,
    r2.cause_analysis,
    r2.parts_used,
    coalesce(
      (select string_agg(btrim(t.first_name || ' ' || t.last_name), ', ' order by t.first_name, t.last_name)
       from public.request_technicians rtech
       join public.employees t on t.id = rtech.technician_id
       where rtech.request_id = r2.id),
      (select btrim(a.first_name || ' ' || a.last_name) from public.employees a where a.id = r2.assignee_id)
    ),
    private.can_access_request(r2.id)
  from public.requests r2
  where r2.id <> v_request.id
    and r2.status <> 'draft'
    and (
      (v_request.machine_id is not null and r2.machine_id = v_request.machine_id)
      or (
        (r2.machine_id is null or v_request.machine_id is null)
        and r2.department_id = v_request.department_id
        and v_key <> ''
        and upper(regexp_replace(btrim(coalesce(r2.machine_code, '')), '\s', '', 'g')) = v_key
      )
    )
  order by r2.created_at desc, r2.request_no desc
  limit 50;
end;
$$;

revoke all on function public.app_get_machine_repair_history(uuid) from public, anon;
grant execute on function public.app_get_machine_repair_history(uuid) to authenticated;
