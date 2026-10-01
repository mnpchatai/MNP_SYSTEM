-- เปิดใช้โมดูล "ใบแจ้งซ่อม IT" (IT_REPAIR) ด้วย flow คำร้องทั่วไปไปก่อน
--
-- request_types.IT_REPAIR มีอยู่แล้วตั้งแต่ phase_one แต่ถูกปิด (is_active = false) ใน
-- 20260918040517_configure_request_modules.sql ตอนนี้เปิดใช้โดยไม่สร้าง RPC/สถานะใหม่:
--   สร้างผ่าน app_create_request เดิม -> หัวหน้าแผนกผู้แจ้ง (employees.manager_id ถ้ามี)
--   -> ผู้จัดการแผนก IT (final_approver_role_id + owning_department_id ผ่าน
--   private.resolve_approval_target) -> อนุมัติแล้ว -> ผู้ปฏิบัติงานเปลี่ยนสถานะผ่าน
--   app_update_request_status เหมือนคำร้องทั่วไป
-- เมื่อกำหนด flow เฉพาะของ IT แล้วให้เพิ่ม RPC/สถานะใน migration ใหม่ (ไม่แก้ไฟล์นี้)
--
-- ย้อนกลับ: update public.request_types set is_active = false where code = 'IT_REPAIR';
-- (ใบที่สร้างไปแล้วยังอยู่และเปิดดูได้ตามเดิม เหมือนประเภทอื่นที่ถูกปิดใน 20260918040517)

do $$
begin
  if not exists (select 1 from public.request_types where code = 'IT_REPAIR') then
    raise exception 'IT_REPAIR request type is missing';
  end if;
  if not exists (select 1 from public.departments where code = 'IT' and is_active) then
    raise exception 'active IT department is missing';
  end if;
  if not exists (select 1 from public.roles where code = 'department_manager') then
    raise exception 'department_manager role is missing';
  end if;
end;
$$;

update public.request_types
set
  name_th = 'ใบแจ้งซ่อม IT',
  name_en = 'IT repair',
  description = 'แจ้งปัญหาคอมพิวเตอร์ อุปกรณ์ ระบบ หรือซอฟต์แวร์',
  owning_department_id = (select id from public.departments where code = 'IT'),
  final_approver_role_id = (select id from public.roles where code = 'department_manager'),
  requires_manager_approval = true,
  uses_repair_workflow = false,
  uses_factory_general_chain = false,
  form_schema = '{"fields":["asset_code","location","impact"]}'::jsonb,
  is_active = true,
  sort_order = 40
where code = 'IT_REPAIR';

-- สิทธิ์โมดูล: ให้ผลเหมือนการตั้งค่าเริ่มต้นใน 20260918060000_approval_module_permissions.sql
-- (ผู้มี approvals.act ที่ไม่ใช่ requests.view_all ได้สิทธิ์ทุกโมดูลที่เปิดอยู่) ซึ่งตอนนั้น
-- IT_REPAIR ถูกปิดอยู่จึงไม่ได้รับ — ขั้นอนุมัติยังจำกัดแผนกด้วย approver_department_id
-- Admin ปรับรายคนได้ภายหลังผ่าน app_set_module_permission
insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
select distinct e.id, t.id, null::uuid
from public.employees e
join public.role_permissions rp on rp.role_id = e.role_id
join public.permissions p on p.id = rp.permission_id and p.code = 'approvals.act'
cross join public.request_types t
where e.is_active
  and t.code = 'IT_REPAIR'
  and not exists (
    select 1
    from public.role_permissions rp2
    join public.permissions p2 on p2.id = rp2.permission_id
    where rp2.role_id = e.role_id and p2.code = 'requests.view_all'
  )
on conflict do nothing;
