-- ใบคำร้องถึงฝ่ายบริหาร (MANAGEMENT, PP01-FM08): ผจก.ทั่วไปลงมติสุดท้ายเสมอ และผู้ยื่นตอบกลับความเห็นได้
--
-- 1. app_approval_decision (นิยามล่าสุดจาก 20261014040000_management_request_flow_completion.sql)
--    มติ "รับทราบข้อมูล" ที่ขั้นที่ยังมีขั้นถัดไปรออยู่ (เช่น ผจก.โรงงาน) ส่งใบต่อไปขั้นถัดไปเหมือน "อนุมัติ"
--    (ขั้นนั้นบันทึกสถานะ acknowledged ไว้ตามจริง) ใบจะปิดเป็น "รับทราบข้อมูล" ได้เฉพาะเมื่อเป็นมติของ
--    ขั้นสุดท้าย (ผจก.ทั่วไป) เท่านั้น ตามฟอร์มที่ต้องมีลายเซ็นทั้งสองช่อง เดิมใบปิดทันทีที่ขั้นแรก
--    ผจก.ทั่วไปไม่เคยเห็น และขั้นของ ผจก.ทั่วไปค้างเป็น pending ตลอดไป
--    มติอื่นเหมือนเดิมทุกประการ ("ไม่อนุมัติ" ยังปิดใบได้ทุกขั้น "ขอข้อมูลเพิ่ม" ยังรอผู้ยื่น)
-- 2. ใบที่ปิดเป็น "รับทราบข้อมูล" ไปแล้วทั้งที่ยังมีขั้นถัดไปรออยู่ (ณ วันที่เขียนมีใบเดียวคือ FT 004/26)
--    เปิดกลับเป็น "รออนุมัติ" ที่ขั้นถัดไป แจ้งผู้อนุมัติขั้นนั้น (หรือ admin ถ้ายังไม่มีผู้ถือบทบาท)
--    และแจ้งผู้ยื่นผ่าน trigger ประวัติสถานะเดิม บันทึก audit ทุกใบที่แก้
-- 3. ผู้ยื่นตอบกลับความเห็นของผู้อนุมัติได้ ไม่ว่ามติของขั้นนั้นจะเป็นอนุมัติ รับทราบข้อมูล หรือไม่อนุมัติ
--    และไม่ว่าใบจะอยู่สถานะใด คำตอบเป็นข้อความเท่านั้น ไม่เปลี่ยนสถานะหรือขั้นอนุมัติ
--    - เก็บใน public.request_comments (ตารางเดิม) เพิ่มคอลัมน์ approval_step_id ผูกกับขั้นที่ตอบ
--    - เขียนได้ทาง public.app_reply_to_step_comment เท่านั้น: ผู้ยื่นของใบนั้น, ใบ MANAGEMENT,
--      ขั้นที่ตัดสินแล้วและมีความเห็น ("ขอข้อมูลเพิ่ม" ยังใช้การส่งข้อมูลกลับเดิม) แจ้งผู้ที่ให้ความเห็น
--    - policy เดิมที่ให้ insert ตรงได้ ถูกจำกัดให้ใช้ได้เฉพาะความเห็นที่ไม่ผูกขั้น
--      จึงปลอมคำตอบของขั้นผ่าน Data API ไม่ได้
--
-- Rollback/recovery:
--   - create or replace public.app_approval_decision ด้วยนิยามจาก 20261014040000_management_request_flow_completion.sql
--   - drop function public.app_reply_to_step_comment(uuid, text);
--     สร้าง policy comments_create ตามนิยามใน 20260916070554_phase_one.sql
--     แล้ว alter table public.request_comments drop column approval_step_id (คำตอบที่บันทึกไว้จะหายไปด้วย)
--   - drop function private.reopen_acknowledged_before_final_step(); ใบที่ถูกเปิดกลับในข้อ 2 ดูได้จาก audit_logs action = 'reopen_acknowledged_for_next_step'
--     (ถ้าผู้อนุมัติขั้นถัดไปยังไม่ได้ตัดสิน คืนสถานะได้ด้วย update requests set status = 'acknowledged',
--     current_step = <from_step> ผ่าน migration ใหม่)

-- 1. app_approval_decision ------------------------------------------------------------------
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
  v_type_code text;
  v_comment text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info', 'acknowledged') then
    raise exception 'INVALID_DECISION';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
  if p_decision in ('rejected', 'more_info') and coalesce(char_length(v_comment), 0) < 3 then
    raise exception 'COMMENT_REQUIRED';
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

  select code, uses_repair_workflow into v_type_code, v_uses_repair
  from public.request_types
  where id = v_request.request_type_id;
  if p_decision = 'acknowledged' and v_type_code is distinct from 'MANAGEMENT' then
    raise exception 'DECISION_NOT_ALLOWED';
  end if;

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  if not v_is_admin and not (
    (v_step.approver_employee_id is not null and v_step.approver_employee_id = v_employee.id)
    or (
      v_step.approver_role_id is not null
      and private.approval_role_matches(v_step.id, v_employee.role_id)
      and (v_step.approver_department_id is null or v_step.approver_department_id = v_employee.department_id)
      and private.has_permission('approvals.act')
      and private.can_approve_module(v_employee.id, v_request.request_type_id)
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_comment
  where id = v_step.id and status = 'pending';

  -- ใหม่: อนุมัติและรับทราบข้อมูลไปต่อขั้นถัดไปเมื่อยังมีขั้นรออยู่
  if p_decision in ('approved', 'acknowledged') then
    select * into v_next
    from public.approval_steps
    where request_id = v_request.id
      and status = 'pending'
      and step_order > v_step.step_order
    order by step_order
    limit 1;
  end if;

  if p_decision in ('rejected', 'more_info') or (p_decision = 'acknowledged' and v_next.id is null) then
    perform private.set_status_note(v_comment);
    update public.requests
    set status = case p_decision
                   when 'rejected' then 'rejected'::public.request_status
                   when 'acknowledged' then 'acknowledged'::public.request_status
                   else 'more_info'::public.request_status
                 end,
        last_changed_by = v_employee.id
    where id = v_request.id;
  elsif v_next.id is null then
    perform private.set_status_note(v_comment);
    update public.requests
    set status = case when coalesce(v_uses_repair, false)
                      then 'pending_assign'::public.request_status
                      else 'approved'::public.request_status end,
        current_step = 0, approved_at = now(),
        last_changed_by = v_employee.id
    where id = v_request.id;

    -- อนุมัติผ่านครบทุกขั้นแล้ว (ไม่ใช่สายซ่อมที่ไปต่อ pending_assign) — ส่งสำเนาให้
    -- แผนกที่ถูกติ๊กไว้ตอนสร้างคำร้อง ถ้ามี
    if not coalesce(v_uses_repair, false)
       and coalesce(array_length(v_request.cc_department_ids, 1), 0) > 0 then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'ได้รับสำเนาคำร้อง',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.is_active
        and e.department_id = any(v_request.cc_department_ids);
    end if;
  else
    update public.requests
    set current_step = v_next.step_order, last_changed_by = v_employee.id
    where id = v_request.id;

    perform private.notify_approval_step(v_next.id, v_request.request_no || ' · ' || v_next.step_name);
  end if;

  return v_request.id;
end;
$$;
revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

-- 2. เปิดใบที่ปิดเป็น "รับทราบข้อมูล" ก่อนถึงขั้นสุดท้าย กลับไปรอขั้นถัดไป ------------------------
create or replace function private.reopen_acknowledged_before_final_step()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select req.id, req.request_no, req.current_step,
           nxt.id as next_step_id, nxt.step_order as next_order, nxt.step_name as next_name
    from public.requests req
    join public.request_types t on t.id = req.request_type_id and t.code = 'MANAGEMENT'
    join public.approval_steps cur on cur.request_id = req.id
      and cur.step_order = req.current_step and cur.status = 'acknowledged'
    join lateral (
      select s.id, s.step_order, s.step_name
      from public.approval_steps s
      where s.request_id = req.id and s.status = 'pending' and s.step_order > req.current_step
      order by s.step_order
      limit 1
    ) nxt on true
    where req.status = 'acknowledged'
    order by req.request_no
  loop
    perform private.set_status_note(
      'เปิดให้ ' || r.next_name || ' พิจารณาต่อ: มติรับทราบข้อมูลก่อนถึงขั้นสุดท้ายไม่ปิดใบแล้ว');
    -- last_changed_by = null: ระบบเป็นผู้เปลี่ยน ไม่ใช่ผู้อนุมัติคนเดิม
    update public.requests
    set status = 'pending_approval', current_step = r.next_order, last_changed_by = null
    where id = r.id;

    perform private.notify_approval_step(r.next_step_id, r.request_no || ' · ' || r.next_name);

    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (null, 'reopen_acknowledged_for_next_step', 'requests', r.id::text,
            jsonb_build_object('request_no', r.request_no, 'from_step', r.current_step, 'to_step', r.next_order));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.reopen_acknowledged_before_final_step() from public, anon, authenticated;

select private.reopen_acknowledged_before_final_step();

-- 3. ผู้ยื่นตอบกลับความเห็นของผู้อนุมัติ -----------------------------------------------------
alter table public.request_comments
  add column if not exists approval_step_id uuid references public.approval_steps(id) on delete cascade;

create index if not exists request_comments_step_idx
  on public.request_comments(approval_step_id) where approval_step_id is not null;

drop policy if exists comments_create on public.request_comments;
create policy comments_create on public.request_comments for insert to authenticated
with check (
  approval_step_id is null
  and author_id = private.current_employee_id()
  and private.can_access_request(request_id)
);

create or replace function public.app_reply_to_step_comment(p_step_id uuid, p_message text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_type_code text;
  v_message text;
  v_comment_id uuid;
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

  v_message := nullif(left(trim(coalesce(p_message, '')), 1000), '');
  if v_message is null then
    raise exception 'INVALID_MESSAGE';
  end if;

  select * into v_step from public.approval_steps where id = p_step_id;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;
  select * into v_request from public.requests where id = v_step.request_id;
  if v_request.requester_id <> v_employee.id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select code into v_type_code from public.request_types where id = v_request.request_type_id;
  if v_type_code is distinct from 'MANAGEMENT' then
    raise exception 'REPLY_NOT_SUPPORTED';
  end if;
  -- ขั้นที่ยังรอพิจารณาหรือกำลังขอข้อมูลเพิ่ม (ใช้การส่งข้อมูลกลับ) ยังไม่มีความเห็นให้ตอบ
  if v_step.status not in ('approved', 'acknowledged', 'rejected') or nullif(trim(coalesce(v_step.comment, '')), '') is null then
    raise exception 'STEP_HAS_NO_COMMENT';
  end if;

  insert into public.request_comments (request_id, author_id, body, approval_step_id)
  values (v_request.id, v_employee.id, v_message, v_step.id)
  returning id into v_comment_id;

  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select e.id, v_request.id, 'ผู้ยื่นคำร้องตอบกลับความเห็นของคุณ',
         v_request.request_no || ' · ' || v_step.step_name,
         '/requests/' || v_request.id::text
  from public.employees e
  where e.id = v_step.acted_by and e.is_active and e.id <> v_employee.id;

  return v_comment_id;
end;
$$;
revoke all on function public.app_reply_to_step_comment(uuid, text) from public, anon;
grant execute on function public.app_reply_to_step_comment(uuid, text) to authenticated;
