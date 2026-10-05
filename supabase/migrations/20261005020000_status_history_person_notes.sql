-- ============================================================================
-- "ลำดับเหตุการณ์" ในหน้าคำร้องต้องบอกได้ว่าแต่ละคนพิมพ์อะไรไว้ในแต่ละรอบ
--
-- ปัญหา: ความเห็นตอนผู้อนุมัติ "ขอข้อมูลเพิ่ม" และคำตอบตอนผู้ยื่น "ส่งข้อมูลกลับ" ถูกเก็บไว้ที่
-- approval_steps.comment ช่องเดียว ซึ่งถูกเขียนทับทุกรอบ (app_approval_decision ตั้ง comment ใหม่
-- app_resubmit_request ต่อท้ายคำตอบแล้วตั้งขั้นกลับเป็น pending) ส่วนแถว request_status_history
-- ที่ trigger requests_status_history สร้างให้ไม่มี note เลย หน้าจอจึงเหลือแค่ "X ขอข้อมูลเพิ่มเติม" /
-- "X ส่งข้อมูลเพิ่มเติมเพื่อพิจารณาอีกครั้ง" โดยไม่มีข้อความ เมื่อขอ-ตอบกันหลายรอบ
--
-- แก้:
--   1) private.log_request_status_change — อ่านข้อความที่ RPC ฝากไว้ใน setting ระดับ transaction
--      'mnp.status_note' ใส่เป็น note ของแถวประวัติ แล้วล้างทิ้งทันที (ใช้ได้ครั้งเดียว จึงไม่ติดไปกับ
--      การเปลี่ยนสถานะครั้งอื่นใน transaction เดียวกัน) ส่วนการแจ้งเตือนเหมือนเดิมทุกประการ
--   2) app_approval_decision — ฝากความเห็นของผู้อนุมัติก่อนเปลี่ยนสถานะคำร้อง (ขอข้อมูลเพิ่ม /
--      ไม่อนุมัติ / รับทราบข้อมูล / อนุมัติขั้นสุดท้าย) ขั้นกลางที่ไม่เปลี่ยนสถานะยังอยู่ที่
--      approval_steps.comment ตามเดิม (ขั้นที่อนุมัติแล้วไม่ถูกเขียนทับอีก)
--   3) app_resubmit_request — ฝากคำตอบของผู้ยื่นคำร้องก่อนพาคำร้องกลับไปรออนุมัติ
--      การต่อท้าย "| ตอบกลับ:" ใน approval_steps.comment ยังทำเหมือนเดิม
--   4) เติม note ให้แถวประวัติเก่าที่ยังว่าง จาก audit_logs ของ approval_steps (trigger
--      approvals_audit เก็บแถวก่อน/หลังแก้ไว้ทุกครั้ง และอยู่ใน transaction เดียวกับแถวประวัติ
--      จึงมี created_at เท่ากันพอดี) เติมเฉพาะแถวที่ note ยังว่าง ไม่แตะแถวอื่น
--
-- setting 'mnp.status_note' ตั้งได้เฉพาะโค้ดในฐานข้อมูล ผู้ใช้ที่เรียกผ่าน Data API ตั้งเองไม่ได้
-- (PostgREST ไม่เปิด set_config ให้เรียก) ข้อความผ่านการ trim และจำกัด 1000 ตัวอักษรจาก RPC แล้ว
--
-- ฟังก์ชันที่ redefine คัดลอกจากนิยามล่าสุดบน main เปลี่ยนเฉพาะจุดที่ระบุข้างต้น
--   private.log_request_status_change ← 20261001020000_specific_status_change_notification_title.sql
--   public.app_approval_decision      ← 20261003030000_never_skip_factory_general_approval_steps.sql
--   public.app_resubmit_request       ← 20261003010000_admin_acting_role.sql
--
-- Rollback: นำนิยามทั้งสามจากไฟล์ข้างต้นกลับมา แล้ว drop private.set_status_note และ
-- private.backfill_status_history_notes ข้อ 4 ย้อนได้ด้วย
--   update public.request_status_history set note = null where id in (<id ที่ถูกเติม>)
-- (ก่อน migration นี้ แถวประวัติที่เปลี่ยนสถานะจากการตัดสินใจ/ตอบกลับไม่มี note ใดเลย)
-- ============================================================================

-- ฝากข้อความให้แถวประวัติที่ trigger จะสร้างในการเปลี่ยนสถานะครั้งถัดไปของ transaction นี้
create or replace function private.set_status_note(p_note text)
returns void
language sql
set search_path = ''
as $$
  select set_config('mnp.status_note', coalesce(p_note, ''), true);
$$;

revoke all on function private.set_status_note(text) from public, anon, authenticated;

-- 1. trigger บันทึกประวัติสถานะ
create or replace function private.log_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text;
begin
  if old.status is distinct from new.status then
    v_note := nullif(current_setting('mnp.status_note', true), '');
    perform private.set_status_note(null);

    insert into public.request_status_history(request_id, from_status, to_status, changed_by, note)
    values (new.id, old.status, new.status, coalesce(new.last_changed_by, private.current_employee_id()), v_note);

    insert into public.notifications(recipient_id, request_id, title, body, action_url)
    values (
      new.requester_id,
      new.id,
      private.status_change_notification_title(new.id, new.status),
      new.request_no || ' เปลี่ยนเป็น ' || private.request_status_label(new.status),
      '/requests/' || new.id::text
    );
  end if;
  return new;
end;
$$;

revoke all on function private.log_request_status_change() from public, anon, authenticated;

-- 2. app_approval_decision
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
  if p_decision not in ('approved', 'rejected', 'more_info', 'acknowledged') then
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

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
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

  if p_decision in ('rejected', 'more_info', 'acknowledged') then
    -- ใหม่: ความเห็นของผู้อนุมัติไปอยู่ในแถวประวัติสถานะด้วย ไม่หายเมื่อ comment ของขั้นถูกเขียนทับ
    perform private.set_status_note(v_comment);
    update public.requests
    set status = case p_decision
                   when 'rejected' then 'rejected'::public.request_status
                   when 'acknowledged' then 'acknowledged'::public.request_status
                   else 'more_info'::public.request_status
                 end,
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

      -- ใหม่: ความเห็นตอนอนุมัติขั้นสุดท้ายไปอยู่ในแถวประวัติสถานะด้วย
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
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

-- 3. app_resubmit_request
create or replace function public.app_resubmit_request(p_request_id uuid, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_step public.approval_steps%rowtype;
  v_comment text;
  v_step_comment text;
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

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'more_info' then
    raise exception 'REQUEST_NOT_AWAITING_INFO';
  end if;
  if v_request.requester_id <> v_employee.id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_step
  from public.approval_steps
  where request_id = v_request.id and status = 'more_info'
  order by step_order desc
  limit 1
  for update;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
  v_step_comment := case
    when v_comment is not null and v_step.comment is not null then v_step.comment || ' | ตอบกลับ: ' || v_comment
    when v_comment is not null then 'ตอบกลับ: ' || v_comment
    else v_step.comment
  end;

  update public.approval_steps
  set status = 'pending', acted_by = null, acted_at = null, comment = v_step_comment
  where id = v_step.id;

  -- ใหม่: คำตอบของผู้ยื่นคำร้องไปอยู่ในแถวประวัติสถานะด้วย ไม่หายเมื่อถูกขอข้อมูลเพิ่มรอบถัดไป
  perform private.set_status_note(v_comment);
  update public.requests
  set status = 'pending_approval', current_step = v_step.step_order, last_changed_by = v_employee.id
  where id = v_request.id;

  if v_step.approver_employee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_step.approver_employee_id, v_request.id, 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว',
      v_request.request_no || ' · ' || v_step.step_name,
      '/requests/' || v_request.id::text
    );
  else
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว',
           v_request.request_no || ' · ' || v_step.step_name,
           '/requests/' || v_request.id::text
    from public.employees e
    where coalesce(e.acting_role_id, e.role_id) = v_step.approver_role_id
      and e.is_active
      and (v_step.approver_department_id is null or e.department_id = v_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;

-- 4. เติม note ให้แถวประวัติเก่าจาก audit_logs ของ approval_steps
--    จับคู่แถวประวัติกับการแก้ขั้นอนุมัติใน transaction เดียวกัน (created_at เท่ากัน, request เดียวกัน)
--      ขอข้อมูลเพิ่ม / ไม่อนุมัติ / รับทราบข้อมูล / อนุมัติขั้นสุดท้าย ← ขั้นที่เปลี่ยนจาก pending เป็นผลนั้น
--        ใช้ comment หลังแก้
--      ส่งข้อมูลกลับ (more_info → pending_approval) ← ขั้นที่เปลี่ยนจาก more_info เป็น pending
--        ตัดคำตอบออกจาก comment หลังแก้ ซึ่ง app_resubmit_request สร้างเป็น
--        "<comment เดิม> | ตอบกลับ: <คำตอบ>" หรือ "ตอบกลับ: <คำตอบ>" (comment เท่าเดิม = ไม่ได้ตอบ)
--    เขียนเป็นฟังก์ชัน private (ไม่ grant ให้ใคร) เพื่อให้ทดสอบได้ใน supabase/tests/database
--    รันซ้ำได้ปลอดภัย: เติมเฉพาะแถวที่ note ยังว่าง คืนจำนวนแถวที่เติม
create or replace function private.backfill_status_history_notes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  with step_changes as materialized (
    select a.id,
           a.created_at,
           (a.metadata->'new'->>'request_id')::uuid as request_id,
           a.metadata->'old'->>'status' as old_status,
           a.metadata->'new'->>'status' as new_status,
           a.metadata->'old'->>'comment' as old_comment,
           a.metadata->'new'->>'comment' as new_comment
    from public.audit_logs a
    where a.entity_type = 'approval_steps'
      and a.action = 'UPDATE'
  ),
  recovered as (
    select distinct on (h.id)
           h.id,
           case
             when h.from_status = 'more_info' then
               case
                 when c.new_comment is not distinct from c.old_comment then null
                 when c.old_comment is not null
                      and left(c.new_comment, length(c.old_comment || ' | ตอบกลับ: ')) = c.old_comment || ' | ตอบกลับ: '
                   then substr(c.new_comment, length(c.old_comment || ' | ตอบกลับ: ') + 1)
                 when c.old_comment is null and left(c.new_comment, length('ตอบกลับ: ')) = 'ตอบกลับ: '
                   then substr(c.new_comment, length('ตอบกลับ: ') + 1)
               end
             else c.new_comment
           end as note
    from public.request_status_history h
    join step_changes c
      on c.request_id = h.request_id
     and c.created_at = h.created_at
    where h.note is null
      and (
        (h.from_status = 'more_info' and h.to_status = 'pending_approval'
         and c.old_status = 'more_info' and c.new_status = 'pending')
        or (h.from_status = 'pending_approval' and c.old_status = 'pending' and c.new_status = case h.to_status
              when 'more_info' then 'more_info'
              when 'rejected' then 'rejected'
              when 'acknowledged' then 'acknowledged'
              when 'approved' then 'approved'
              when 'pending_assign' then 'approved'
            end)
      )
    order by h.id, c.id desc
  )
  update public.request_status_history h
  set note = nullif(left(btrim(r.note), 1000), '')
  from recovered r
  where r.id = h.id
    and nullif(btrim(r.note), '') is not null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function private.backfill_status_history_notes() from public, anon, authenticated;

select private.backfill_status_history_notes();
