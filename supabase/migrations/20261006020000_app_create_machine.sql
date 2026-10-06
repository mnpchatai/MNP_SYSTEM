-- ให้ผู้แจ้งซ่อมกำหนดรหัสเครื่องจักรเองได้ตอนกรอกใบแจ้งซ่อม แล้วเก็บเข้า master (public.machines)
-- รอบหน้าค้นหารหัสนี้เจอในรายการ ไม่ต้องพิมพ์ซ้ำ
--
-- ทำไมต้องผ่าน RPC: machines เปิดให้ authenticated อ่านอย่างเดียว (RLS + grant select) ผู้ใช้เขียนตรงไม่ได้
-- ฟังก์ชันนี้จึงเป็นทางเดียวที่ผู้ใช้เพิ่มเครื่องได้ และตรวจสิทธิ์/ข้อมูลทุกครั้ง
--
-- กติกา
--   - ต้องล็อกอิน เป็นพนักงาน active ที่มีสิทธิ์ requests.create (เท่ากับสิทธิ์สร้างใบแจ้งซ่อม)
--   - แผนกต้องเป็นแผนกที่แจ้งซ่อมได้ (is_repair_site) และ active
--   - รหัส: ตัดช่องว่างหัวท้าย ยุบช่องว่างซ้ำ แปลงอังกฤษเป็นตัวพิมพ์ใหญ่ 2–40 ตัว
--     ใช้ได้เฉพาะ อังกฤษ ตัวเลข ไทย ช่องว่าง และ - . _ / ( ) + ขึ้นต้นด้วยตัวอักษรหรือตัวเลข
--   - ชื่อ: ตัดช่องว่างซ้ำ 2–120 ตัว ห้ามมีอักขระควบคุม
--   - "สร้างใหม่" และ "ไม่มี" เป็นตัวเลือกพิเศษ ใช้เป็นรหัสไม่ได้
--   - ถ้าแผนกนั้นมีรหัสเดียวกันอยู่แล้ว (เทียบแบบไม่สนตัวพิมพ์และช่องว่าง เช่น h-hl1-1 = H-HL1-1 = H-HL1 -1)
--     จะไม่สร้างซ้ำ คืนเครื่องเดิมพร้อมธง existed = true ไม่แก้ชื่อของเดิม
--   - กดพร้อมกันหลายคนด้วยรหัสเดียวกันได้เครื่องเดียว (advisory lock ต่อแผนก+รหัส เพราะตารางไม่มี unique(code)
--     จากรหัสซ้ำในข้อมูลจริงบางคู่)
--
-- สิ่งที่เพิ่ม: คอลัมน์ machines.created_by (ใครเพิ่ม เครื่องที่ import เดิมเป็น null) และ audit trigger ของ machines
-- ผู้ดูแลตรวจย้อนหลังได้จาก audit_logs (entity_type = 'machines') และปิดเครื่องที่เพิ่มผิดด้วย is_active = false
--
-- ย้อนกลับ: drop function public.app_create_machine(uuid, text, text); drop trigger machines_audit on public.machines;
-- ปิดเครื่องที่ผู้ใช้เพิ่ม: update public.machines set is_active = false where created_by is not null
-- (อย่าลบ เพราะใบแจ้งซ่อมที่เปิดไปแล้วอาจอ้าง machine_id) ส่วนคอลัมน์ created_by เก็บไว้ได้

alter table public.machines
  add column if not exists created_by uuid references public.employees(id) on delete set null;

drop trigger if exists machines_audit on public.machines;
create trigger machines_audit after insert or update or delete on public.machines
for each row execute function private.audit_row_change();

create or replace function public.app_create_machine(
  p_department_id uuid,
  p_code text,
  p_name text
)
returns table (id uuid, code text, name text, department_id uuid, existed boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_department public.departments%rowtype;
  v_code text;
  v_name text;
  v_key text;
  v_machine public.machines%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active
  limit 1;
  if v_employee.id is null or not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_department
  from public.departments d
  where d.id = p_department_id and d.is_active and d.is_repair_site
  limit 1;
  if v_department.id is null then
    raise exception 'DEPARTMENT_NOT_REPAIR_SITE';
  end if;

  v_code := upper(regexp_replace(btrim(coalesce(p_code, '')), '\s+', ' ', 'g'));
  v_name := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');

  if char_length(v_code) not between 2 and 40
     or v_code !~ '^[A-Z0-9฀-๿][A-Z0-9฀-๿ ._/()+-]*$' then
    raise exception 'INVALID_MACHINE_CODE';
  end if;
  if char_length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then
    raise exception 'INVALID_MACHINE_NAME';
  end if;
  if v_code in ('สร้างใหม่', 'ไม่มี') then
    raise exception 'MACHINE_CODE_RESERVED';
  end if;

  v_key := regexp_replace(v_code, '\s', '', 'g');

  -- ล็อกต่อแผนก+รหัส กันสองคนสร้างรหัสเดียวกันพร้อมกันจนได้ 2 แถว
  perform pg_advisory_xact_lock(hashtextextended('machines:' || v_department.id::text || ':' || v_key, 0));

  select * into v_machine
  from public.machines m
  where m.department_id = v_department.id
    and m.is_active
    and not m.is_placeholder
    and upper(regexp_replace(m.code, '\s', '', 'g')) = v_key
  order by m.sort_order
  limit 1;

  if v_machine.id is not null then
    return query select v_machine.id, v_machine.code, v_machine.name, v_machine.department_id, true;
    return;
  end if;

  insert into public.machines (code, name, department_id, is_placeholder, sort_order, created_by)
  values (
    v_code, v_name, v_department.id, false,
    (select coalesce(max(m.sort_order), 0) + 1 from public.machines m),
    v_employee.id
  )
  returning * into v_machine;

  return query select v_machine.id, v_machine.code, v_machine.name, v_machine.department_id, false;
end;
$$;

revoke all on function public.app_create_machine(uuid, text, text) from public, anon;
grant execute on function public.app_create_machine(uuid, text, text) to authenticated;
