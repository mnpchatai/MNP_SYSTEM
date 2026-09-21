-- ============================================================================
-- ช่องโหว่จริง: ใครก็ตามที่มีสิทธิ์อนุมัติทั่วไปกดอนุมัติแทน "หัวหน้าแผนก" คนอื่นได้ — และในขั้น
-- ที่ผูกกับบทบาท (role-bound) แย่ยิ่งกว่านั้นคือ "พนักงานคนไหนก็ได้" กดอนุมัติแทนได้แม้ไม่มีสิทธิ์
-- อนุมัติเลยสักนิด เพราะตัวตรวจสิทธิ์เดิมพังด้วยตรรกะ NULL ของ SQL (three-valued logic)
--
-- ต้นเหตุ: app_approval_decision (ทุกเวอร์ชันตั้งแต่ 20260918030000 ถึง 20260921010000) เช็คแบบ
--   if not v_is_admin and not (
--     (v_step.approver_employee_id = v_employee.id)
--     or (v_step.approver_role_id = v_employee.role_id and ... )
--   ) then raise exception 'NOT_AUTHORIZED'; end if;
--
-- แต่ละ step มีแค่ช่องเดียวที่ถูกตั้งค่า อีกช่องเป็น NULL เสมอ (ขั้น "หัวหน้าแผนก" ตั้งแต่
-- app_create_repair_request/app_create_request ตั้ง approver_employee_id อย่างเดียว ส่วนขั้น
-- "ผู้อนุมัติหน่วยงานรับผิดชอบ" ตั้ง approver_role_id อย่างเดียว) การเทียบ NULL = <ค่าใดๆ> ใน SQL
-- ไม่ได้ตอบ false แต่ตอบ NULL (ไม่ใช่ true และไม่ใช่ false) ซึ่งพอมาอยู่ใน AND/OR แล้วส่งต่อไปถึง
-- `not (...)` ผลลัพธ์รวมเป็น NULL ได้ และ PL/pgSQL ตีความ `if NULL then` เหมือน `if false then`
-- (ไม่ throw) — คือ "ไม่ผ่านการตรวจ" กลับกลายเป็น "ข้ามการตรวจไปเฉยๆ" แทน
--
-- เกิดสองทางแยกกัน (ทดสอบด้วย truth table ของ Postgres สามค่า TRUE/FALSE/NULL):
--   1) ขั้น "หัวหน้าแผนก" (approver_role_id เป็น NULL): ถ้าคนกดปุ่ม "ไม่ใช่" หัวหน้าแผนกคนนั้น แต่มี
--      สิทธิ์ approvals.act + can_approve_module ของโมดูลนั้น (เช่น เป็นผู้อนุมัติขั้นถัดไปของ
--      request type เดียวกันอยู่แล้ว) — branch เทียบ role กลายเป็น NULL AND TRUE AND TRUE = NULL,
--      รวมกับ branch แรก FALSE ผ่าน OR ได้ NULL → ข้ามเงียบๆ อนุมัติแทนคนอื่นได้ทั้งที่ไม่ใช่หัวหน้า
--      แผนกที่ถูกกำหนดไว้ นี่คืออาการที่เจอจริง: ใบรออนุมัติ "หัวหน้าช่าง" ถูกคนอื่นกดอนุมัติได้
--   2) ขั้นที่ผูกกับบทบาท (approver_employee_id เป็น NULL): แย่กว่านั้น — branch เทียบ employee_id
--      กลายเป็น NULL เสมอไม่ว่าใครกด (NULL = <uuid ใดๆ> = NULL) พอ role ไม่ตรง (branch สองได้
--      FALSE แน่นอน) จะได้ NULL OR FALSE = NULL อีกเช่นกัน → พนักงานคนไหนก็ได้ (ไม่ต้องมีสิทธิ์
--      อนุมัติเลยด้วยซ้ำ) เรียก RPC นี้ตรงๆ แล้วอนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่มแทนผู้อนุมัติจริงได้
--
-- private.can_access_request (ควบคุมการมองเห็น/RLS) ไม่มีบั๊กนี้ — เพราะมันเป็นเงื่อนไขใน WHERE ของ
-- exists(...) ซึ่ง NULL ถูกตัดออกจากผลลัพธ์อยู่แล้วโดยธรรมชาติ (WHERE เก็บเฉพาะแถวที่เป็น true จริง)
-- ต่างจากที่นี่ซึ่งเป็น `if not (...)` ใน PL/pgSQL ที่ NULL ทำตัวเหมือน false แทนที่จะเหมือน true —
-- ขั้วตรงข้ามกับที่ควรจะเป็นสำหรับการเช็คสิทธิ์แบบ "ต้องพิสูจน์ได้ว่าอนุญาต ไม่งั้นบล็อก"
--
-- แก้โดยเติม `is not null` การันตีก่อนเทียบทั้งสอง branch เพื่อให้ผลลัพธ์เป็น false เสมอเมื่อคอลัมน์
-- นั้นไม่ได้ถูกตั้งไว้สำหรับ step นี้ แทนที่จะปล่อยให้เป็น NULL แล้วรั่วผ่าน not(...) ไปได้
-- ============================================================================
create or replace function public.app_approval_decision(p_step_id uuid, p_decision text, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_next public.approval_steps%rowtype;
  v_is_admin boolean;
  v_uses_repair boolean;
  v_comment text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_step
  from public.approval_steps
  where id = p_step_id
  for update;
  if v_step.id is null or v_step.status <> 'pending' then
    raise exception 'STEP_NOT_PENDING';
  end if;

  select * into v_request
  from public.requests
  where id = v_step.request_id
  for update;
  if v_request.status <> 'pending_approval' or v_request.current_step <> v_step.step_order then
    raise exception 'STEP_NOT_CURRENT';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not (
    (v_step.approver_employee_id is not null and v_step.approver_employee_id = v_employee.id)
    or (
      v_step.approver_role_id is not null
      and v_step.approver_role_id = v_employee.role_id
      and (v_step.approver_department_id is null or v_step.approver_department_id = v_employee.department_id)
      and private.has_permission('approvals.act')
      and private.can_approve_module(v_employee.id, v_request.request_type_id)
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_comment
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info') then
    update public.requests
    set status = case when p_decision = 'rejected'
                      then 'rejected'::public.request_status
                      else 'more_info'::public.request_status end,
        last_changed_by = v_employee.id
    where id = v_request.id;
  else
    select * into v_next
    from public.approval_steps
    where request_id = v_request.id
      and status = 'pending'
      and step_order > v_step.step_order
    order by step_order
    limit 1;

    if v_next.id is null then
      select uses_repair_workflow into v_uses_repair
      from public.request_types
      where id = v_request.request_type_id;

      update public.requests
      set status = case when coalesce(v_uses_repair, false)
                        then 'pending_assign'::public.request_status
                        else 'approved'::public.request_status end,
          current_step = 0, approved_at = now(),
          last_changed_by = v_employee.id
      where id = v_request.id;
    else
      update public.requests
      set current_step = v_next.step_order, last_changed_by = v_employee.id
      where id = v_request.id;

      if v_next.approver_employee_id is not null then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        values (
          v_next.approver_employee_id, v_request.id, 'มีคำร้องรออนุมัติ',
          v_request.request_no || ' · ' || v_next.step_name,
          '/requests/' || v_request.id::text
        );
      else
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
               v_request.request_no || ' · ' || v_next.step_name,
               '/requests/' || v_request.id::text
        from public.employees e
        where e.role_id = v_next.approver_role_id
          and e.is_active
          and (v_next.approver_department_id is null or e.department_id = v_next.approver_department_id)
          and private.can_approve_module(e.id, v_request.request_type_id);
      end if;
    end if;
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;
