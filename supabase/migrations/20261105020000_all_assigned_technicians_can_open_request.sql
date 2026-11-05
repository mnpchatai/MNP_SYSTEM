-- ช่างทุกคนที่ได้รับมอบหมายในใบแจ้งซ่อมต้องเปิดใบได้ ไม่ใช่เฉพาะคนแรก (assignee_id)
--
-- 20260921090000 ใส่เงื่อนไข "ช่างในตาราง request_technicians อ่านใบได้" ไว้ใน can_access_request
-- แต่ 20260922050000 เขียนฟังก์ชันนี้ใหม่จากนิยามที่เก่ากว่าจึงตัดเงื่อนไขนั้นหายไป และ 20260930010000,
-- 20261001040000, 20261009094227 ก็เขียนต่อจากนิยามที่ขาดแล้ว ผลคือช่างคนที่ 2 ขึ้นไปในชุด
-- ไม่เห็นใบในรายการงาน กดลิงก์แจ้งเตือนแล้วเจอ "ไม่พบคำร้อง" และไม่มีปุ่มเริ่มงาน/บันทึกผล
-- ทั้งที่ app_start_repair_work / app_finish_repair_work อนุญาตช่างทุกคนในชุดอยู่แล้ว
-- (private.is_request_technician)
--
-- นิยามด้านล่างเริ่มจากนิยามล่าสุดบน main (20261009094227) แล้วเพิ่มเงื่อนไขเดียว:
-- or private.is_request_technician(r.id, me.id)
-- is_request_technician ครอบทั้ง assignee_id และ request_technicians จึงตรงกับฝั่ง RPC ทุกตัว
--
-- Recovery: restore private.can_access_request from 20261009094227 (ไม่มีข้อมูลเปลี่ยน ไม่มีสิทธิ์อื่นเปลี่ยน)
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
        -- ช่างทุกคนในชุด (ตาราง request_technicians) ไม่ใช่เฉพาะคนแรกที่อยู่ใน assignee_id
        or private.is_request_technician(r.id, me.id)
        or exists (
          select 1 from public.approval_steps s
          where s.request_id = r.id
            and (
              s.approver_employee_id = me.id
              or (
                private.approval_role_matches(s.id, me.role_id)
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
