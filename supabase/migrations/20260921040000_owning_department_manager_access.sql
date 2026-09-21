-- ============================================================================
-- ผู้จัดการแผนกเจ้าของประเภทเอกสาร ต้องอ่านงานของแผนกตัวเองได้
--
-- อาการ: หัวหน้าแผนกซ่อมบำรุงเปิดหน้าคำร้องแล้วไม่เห็นอะไรเลย ทั้งที่เป็นระบบแจ้งซ่อม
--
-- สาเหตุ: 20260921020000_assign_repair_technician_department_manager_only จำกัดให้เฉพาะ
-- "ผู้จัดการแผนก" ของแผนกเจ้าของประเภทเอกสารเป็นคนมอบหมายช่าง แต่ไม่ได้เปิดสิทธิ์ "อ่าน"
-- ให้ตรงกัน private.can_access_request เดิมให้สิทธิ์อ่านจาก 5 ทางคือ เป็นผู้แจ้ง /
-- เป็นผู้รับผิดชอบ / เป็นผู้อนุมัติขั้นใดขั้นหนึ่ง / มี requests.view_all /
-- มี requests.operate และใบอยู่สถานะ approved|in_progress
--
-- ผู้จัดการแผนกซ่อมบำรุงไม่เข้าเงื่อนไขใดเลยสำหรับใบแจ้งซ่อมที่คนแผนกอื่นแจ้งเข้ามา เพราะ
-- สายอนุมัติของ MT_REPAIR คือ หัวหน้าแผนกผู้แจ้ง → ผู้จัดการโรงงาน → ผู้จัดการทั่วไป
-- ไม่มีตัวเขาอยู่ในสายเลย ผลคือใบที่ตกมาถึงขั้น pending_assign ซึ่งมีเพียงเขาคนเดียวที่
-- มีสิทธิ์มอบหมายช่าง กลับเป็นใบที่เขามองไม่เห็น — งานค้างโดยไม่มีใครเห็น
--
-- แก้โดยเพิ่มสาขาที่ 6: ถ้าเป็น department_manager ของแผนกที่เป็นเจ้าของประเภทเอกสารนั้น
-- ให้อ่านใบของประเภทนั้นได้ (ยกเว้นฉบับร่าง) ซึ่งตรงกับอำนาจที่
-- app_assign_repair_technician ให้ไว้อยู่แล้ว
--
-- ขอบเขตแคบตามตั้งใจ: ให้แค่ "สิทธิ์อ่าน" ของประเภทเอกสารที่แผนกตัวเองรับผิดชอบเท่านั้น
-- ไม่ได้แตะสิทธิ์อนุมัติ (ยังผ่าน can_approve_module ใน app_approval_decision เหมือนเดิม)
-- และไม่ข้ามไปเห็นประเภทเอกสารของแผนกอื่น เช่น ผจก.แผนกซ่อมบำรุงยังไม่เห็น IT_ACCESS
--
-- ตรรกะสาขาอื่นคัดลอกมาจาก 20260918060000_approval_module_permissions ทุกตัวอักษร
-- ============================================================================
create or replace function private.can_access_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    join public.employees me on me.auth_user_id = (select auth.uid()) and me.is_active
    where r.id = target_request_id
      and (
        r.requester_id = me.id
        or r.assignee_id = me.id
        or exists (
          select 1 from public.approval_steps s
          where s.request_id = r.id
            and (
              s.approver_employee_id = me.id
              or (
                s.approver_role_id = me.role_id
                and (s.approver_department_id is null or s.approver_department_id = me.department_id)
                and private.can_approve_module(me.id, r.request_type_id)
              )
            )
        )
        or private.has_permission('requests.view_all')
        or (
          private.has_permission('requests.operate')
          and r.status in ('approved', 'in_progress')
        )
        -- ใหม่: ผู้จัดการแผนกเจ้าของประเภทเอกสาร อ่านงานของแผนกตัวเองได้
        or exists (
          select 1
          from public.request_types rt
          join public.roles me_role on me_role.id = me.role_id
          where rt.id = r.request_type_id
            and me_role.code = 'department_manager'
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
      )
  )
$$;

revoke all on function private.can_access_request(uuid) from public;
grant execute on function private.can_access_request(uuid) to authenticated;
