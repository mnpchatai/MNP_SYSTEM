-- แก้: แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" กดลิงก์จากอีเมล "ได้รับสำเนาคำร้อง" แล้วเจอ
-- "ไม่พบคำร้อง หรือคุณไม่มีสิทธิ์เข้าถึง"
--
-- สาเหตุ: สาขาสิทธิ์อ่านของแผนกที่ถูกสำเนา (เพิ่มใน 20260922050000_cc_department_notify_on_approval.sql)
-- เช็ค r.status = 'approved' อย่างเดียว แต่ใบคำร้องที่อนุมัติครบแล้วจะถูกเดินสถานะต่อเป็น
-- in_progress / completed (ผ่าน app_update_request_status) ทันทีที่สถานะขยับ แผนกที่ได้รับสำเนา
-- ก็หมดสิทธิ์อ่าน ทั้งที่อีเมล/แจ้งเตือนในระบบส่งลิงก์ไปให้แล้ว
--
-- แก้: ให้แผนกที่ถูกสำเนาอ่านได้ในทุกสถานะหลังอนุมัติครบ ('approved', 'in_progress', 'completed')
-- ยังคงปิดไว้สำหรับ draft / pending_approval / more_info / rejected / acknowledged / cancelled
-- เหมือนเดิม (สำเนาส่งถึงแผนกเฉพาะเมื่ออนุมัติครบทุกขั้นเท่านั้น)
--
-- นิยามคัดลอกจาก 20260930010000_assistant_department_manager_acts_as_manager.sql ทุกตัวอักษร
-- เปลี่ยนเฉพาะเงื่อนไขสถานะของสาขา "สำเนาถึงแผนก"
-- create or replace คงสิทธิ์ grant/revoke เดิมไว้
--
-- Rollback: apply นิยามจาก 20260930010000_assistant_department_manager_acts_as_manager.sql อีกครั้ง

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
        or exists (
          select 1
          from public.request_types rt
          join public.roles me_role on me_role.id = me.role_id
          where rt.id = r.request_type_id
            and me_role.code in ('department_manager', 'assistant_department_manager')
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
        -- แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" อ่านได้ตั้งแต่อนุมัติครบแล้ว รวมถึงหลังเดินสถานะต่อเป็น
        -- in_progress / completed
        or (
          r.status in ('approved', 'in_progress', 'completed')
          and me.department_id = any(r.cc_department_ids)
        )
      )
  )
$$;
