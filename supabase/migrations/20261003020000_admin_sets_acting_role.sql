-- ============================================================================
-- ย้ายการตั้ง "บทบาทหลักในการทำงาน" (employees.acting_role_id) จากหน้าข้อมูลส่วนตัว
-- (admin ตั้งของตัวเอง ผ่าน app_set_my_acting_role ใน 20261003010000_admin_acting_role.sql)
-- ไปอยู่ในฟอร์มแก้ไขบัญชีของหน้าผู้ดูแลระบบ: ผู้ที่มีสิทธิ์ accounts.manage ตั้งให้บัญชี admin
-- คนใดก็ได้ รวมถึงบัญชีของตัวเอง ใช้เกณฑ์สิทธิ์เดียวกับ app_admin_update_employee
--
-- ความหมายของค่าและ trigger normalize_employee_acting_role ไม่เปลี่ยน
-- Rollback: drop app_admin_set_acting_role แล้วสร้าง app_set_my_acting_role กลับจากไฟล์ข้างต้น
-- ============================================================================

create or replace function public.app_admin_set_acting_role(p_employee_id uuid, p_role_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_actor.id is null or not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- บัญชีที่ถูกลบ (เก็บไว้เพื่อประวัติ) แก้ไขไม่ได้ เหมือน app_admin_update_employee
  select * into v_target from public.employees where id = p_employee_id and deleted_at is null for update;
  if v_target.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  if p_role_id is not null then
    -- ค่านี้มีความหมายเฉพาะบัญชี admin (trigger ล้างทิ้งอยู่แล้ว) แจ้งชัดๆ แทนการเงียบ
    if not exists (select 1 from public.roles r where r.id = v_target.role_id and r.code = 'admin') then
      raise exception 'TARGET_NOT_ADMIN';
    end if;
    if not exists (select 1 from public.roles r where r.id = p_role_id and r.code <> 'admin') then
      raise exception 'INVALID_ROLE';
    end if;
  end if;

  -- trigger audit_row_change ของ employees บันทึกผู้แก้และค่าก่อน/หลังไว้ใน audit_logs
  update public.employees
  set acting_role_id = p_role_id
  where id = v_target.id;

  return v_target.id;
end;
$$;

revoke all on function public.app_admin_set_acting_role(uuid, uuid) from public, anon;
grant execute on function public.app_admin_set_acting_role(uuid, uuid) to authenticated;

drop function if exists public.app_set_my_acting_role(uuid);
