-- NCR ส่วนที่ 3: ผู้ตอบเป็นพนักงานหรือหัวหน้าของแผนกที่รับผิดชอบ และระบุตัวผู้ตอบได้ (ไม่บังคับ)
--
-- เดิม app_ncr_respond / app_ncr_submit_prevention / app_ncr_answer_info อนุญาตเฉพาะ ผจก. และ ผช.ผจก.
-- ของแผนกที่รับผิดชอบ ถ้าแผนกนั้นไม่มีหัวหน้าในระบบ (เช่น PP ที่มีแต่พนักงาน) ใบจะค้างที่รอแผนกตอบโดยไม่มีใครตอบได้
-- ตอนนี้:
--   * ผู้ตอบได้ = พนักงาน (staff) หรือ ผจก./ผช.ผจก. แผนก ที่อยู่แผนกเดียวกับแผนกที่ ผจก.โรงงานเลือกไว้
--   * ผจก.โรงงานระบุตัวผู้ตอบของแต่ละแผนกได้ แต่ไม่บังคับ — ไม่ระบุ = ทุกคนที่เข้าเกณฑ์ในแผนกตอบได้
--     ระบุแล้ว = ผู้ที่ถูกระบุเท่านั้นที่ตอบได้ (คนอื่นในแผนกเดียวกันรวมถึง ผจก.แผนก ตอบไม่ได้)
--   * ระบุตอนพิจารณา (app_ncr_dispose รับ p_responder_ids เพิ่ม) และเปลี่ยน/ยกเลิกการระบุภายหลังได้
--     (app_ncr_assign_responder) ตราบที่ใบยังรอแผนกทำอะไรสักอย่าง เพื่อไม่ให้ใบค้างถ้าผู้ที่ถูกระบุลา/ลาออก
--   * แจ้งเตือนและตัวเตือนงานค้าง (private.ncr_audience 'responsible_managers') ตามเกณฑ์เดียวกับสิทธิ์ตอบ
--     จึงไม่ต้องแก้ private.pending_work_items
--
-- ข้อมูล: เพิ่มคอลัมน์ ncr_responsibilities.responder_id (null = ไม่ระบุ) ใบเดิมทุกใบเป็น null จึงเปิดให้ทุกคนในแผนกตอบได้
-- ไม่ใช่การเปลี่ยนที่ทำให้ใบเดิมตอบไม่ได้ (ผจก./ผช.ผจก.เดิมยังตอบได้เหมือนเดิม)
--
-- ฟังก์ชัน public ทุกตัวที่แก้/เพิ่มในไฟล์นี้เริ่มด้วย perform private.lab_only_block(); ตามกติกาของ 20261019005000_lab_only_accounts.sql
-- (นิยามเดิมที่คัดมามีด่านนี้ในฐานข้อมูลอยู่แล้ว การ create or replace จากนิยามก่อนหน้าต้องไม่ทำให้ด่านหาย)
--
-- ลำดับ deploy: ต้องนำ migration นี้ขึ้นฐานข้อมูลจริงก่อนเผยแพร่ Pilot Web รุ่นที่เรียก app_ncr_assign_responder
-- หน้าจอส่ง p_responder_ids ไปกับ app_ncr_dispose เฉพาะเมื่อมีการระบุผู้ตอบ จึงใช้กับฐานข้อมูลเดิมได้ถ้าไม่ระบุ
--
-- Rollback: drop function public.app_ncr_assign_responder(uuid, uuid, uuid);
--   drop function public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[]) แล้วนำนิยาม app_ncr_dispose จาก 20261002020000_ncr_phase1.sql กลับมา
--   นำนิยาม app_ncr_respond (20261015010000), app_ncr_submit_prevention (20261015020000), app_ncr_answer_info
--   (20261005060000), private.ncr_audience (20261005030000) กลับมา แล้ว drop function private.ncr_can_respond(uuid, public.employees),
--   private.ncr_responder_valid(uuid, uuid, boolean) และ alter table public.ncr_responsibilities drop column responder_id
--   (ใบที่ระบุผู้ตอบไว้จะกลับไปให้ ผจก./ผช.ผจก.ของแผนกตอบแทน)

-- 1. ข้อมูล: ผู้ตอบที่ระบุของแต่ละแผนก (null = ไม่ระบุ)
alter table public.ncr_responsibilities
  add column responder_id uuid references public.employees(id);
comment on column public.ncr_responsibilities.responder_id is
  'ผู้ตอบที่ ผจก.โรงงานระบุของแผนกนี้ (null = ไม่ระบุ ทุกคนที่เข้าเกณฑ์ในแผนกตอบได้) ถ้าระบุ ตอบได้เฉพาะคนนี้';

-- 2. เกณฑ์เดียวของ "ใครตอบ NCR ได้": role เข้าเกณฑ์ + อยู่แผนกที่รับผิดชอบ + (ไม่ระบุผู้ตอบ หรือถูกระบุให้เป็นผู้ตอบ)
create or replace function private.ncr_can_respond(p_ncr_id uuid, p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
    and private.employee_role_code(p_employee.id) in ('staff', 'department_manager', 'assistant_department_manager')
    and exists (
      select 1 from public.ncr_responsibilities r
      where r.ncr_id = p_ncr_id
        and r.department_id = p_employee.department_id
        and (r.responder_id is null or r.responder_id = p_employee.id)
    )
$$;
revoke all on function private.ncr_can_respond(uuid, public.employees) from public, anon, authenticated;

-- ผู้ที่ระบุเป็นผู้ตอบได้: อยู่แผนกนั้น มี role เข้าเกณฑ์ และอยู่โหมดเดียวกับใบ
-- ใบจริง = พนักงานจริงที่ยังใช้งานอยู่ ใบทดสอบ = บัญชีทดสอบ (persona) เท่านั้น
create or replace function private.ncr_responder_valid(p_employee_id uuid, p_department_id uuid, p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles r on r.id = e.role_id
    where e.id = p_employee_id
      and e.department_id = p_department_id
      and e.is_test = p_is_test
      and (e.is_test or (e.is_active and e.deleted_at is null))
      and r.code in ('staff', 'department_manager', 'assistant_department_manager')
  )
$$;
revoke all on function private.ncr_responder_valid(uuid, uuid, boolean) from public, anon, authenticated;

-- 3. ผู้รับแจ้งเตือน/ตัวเตือนของ 'responsible_managers' = ผู้ที่ตอบได้ (ชื่อเดิมคงไว้เพราะมีหลายจุดเรียกใช้)
-- (คัดจากนิยามล่าสุดใน 20261005030000_admin_sandbox_mode.sql เปลี่ยนเฉพาะกิ่ง 'responsible_managers')
create or replace function private.ncr_audience(p_ncr_id uuid, p_audience text)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.id
  from public.ncr_reports n
  join public.employees e on e.is_active
  join public.roles r on r.id = e.role_id
  where n.id = p_ncr_id
    and not n.is_test
    and case p_audience
      when 'factory' then r.code = 'factory_manager'
      when 'general_manager' then r.code = 'general_manager'
      when 'reporter' then e.id = n.reporter_id
      when 'qa' then private.is_qa_department(e.department_id)
      when 'qa_managers' then private.is_qa_department(e.department_id)
        and r.code in ('department_manager', 'assistant_department_manager')
      when 'responsible_managers' then r.code in ('staff', 'department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities x
          where x.ncr_id = n.id and x.department_id = e.department_id
            and (x.responder_id is null or x.responder_id = e.id)
        )
      else false
    end
$$;
revoke all on function private.ncr_audience(uuid, text) from public, anon, authenticated;

-- 4. ส่วนที่ 2: ผจก.โรงงานเลือกวิธีจัดการ + แผนกที่รับผิดชอบ (1–10 แผนก ไม่ซ้ำ) และระบุผู้ตอบของแผนกได้ (ไม่บังคับ)
-- p_responder_ids: รายชื่อผู้ตอบที่ระบุ แผนกละไม่เกิน 1 คน และต้องอยู่ในแผนกที่เลือก (แผนกไหนไม่มีรายชื่อ = ไม่ระบุ)
-- เปลี่ยนจากเดิมเฉพาะพารามิเตอร์ใหม่ที่ท้ายสุด (default null) จึงเรียกแบบเดิม 3–4 พารามิเตอร์ได้เหมือนเดิม
-- (คัดจากนิยามใน 20261002020000_ncr_phase1.sql — ไม่มี migration หลังจากนั้นที่แก้ฟังก์ชันนี้)
drop function public.app_ncr_dispose(uuid, text[], uuid[], text);

create or replace function public.app_ncr_dispose(
  p_ncr_id uuid,
  p_dispositions text[],
  p_department_ids uuid[],
  p_note text default null,
  p_responder_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_count integer;
  v_share numeric;
  v_found integer;
  v_depts integer;
  v_valid integer;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();
  if private.employee_role_code(v_employee.id) <> 'factory_manager' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_disposition' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if coalesce(cardinality(p_dispositions), 0) = 0
     or not (p_dispositions <@ array['return', 'accept', 'reproduce', 'exchange', 'repair', 'sort', 'scrap', 'sell', 'other']::text[]) then
    raise exception 'INVALID_DISPOSITION';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'INVALID_NOTE';
  end if;

  v_count := coalesce(cardinality(p_department_ids), 0);
  if v_count = 0 or v_count > 10
     or array_position(p_department_ids, null) is not null
     or (select count(distinct x) from unnest(p_department_ids) x) <> v_count
     or (select count(*) from public.departments d where d.id = any(p_department_ids) and d.is_active) <> v_count then
    raise exception 'INVALID_RESPONSIBILITIES';
  end if;

  -- ผู้ตอบที่ระบุ: ต้องมีอยู่จริงไม่ซ้ำ อยู่ในแผนกที่เลือก แผนกละไม่เกิน 1 คน และเข้าเกณฑ์/โหมดเดียวกับใบ
  if coalesce(cardinality(p_responder_ids), 0) > 0 then
    select count(*),
           count(distinct e.department_id),
           count(*) filter (
             where e.department_id = any(p_department_ids)
               and private.ncr_responder_valid(e.id, e.department_id, v_ncr.is_test)
           )
      into v_found, v_depts, v_valid
    from public.employees e
    where e.id = any(p_responder_ids);
    if array_position(p_responder_ids, null) is not null
       or v_found <> cardinality(p_responder_ids)
       or v_depts <> v_found
       or v_valid <> v_found then
      raise exception 'INVALID_RESPONDER';
    end if;
  end if;

  v_share := round(1::numeric / v_count, 4);
  insert into public.ncr_responsibilities (ncr_id, department_id, share, responder_id)
  select v_ncr.id, x.department_id,
         case when x.position = v_count then 1 - v_share * (v_count - 1) else v_share end,
         (select e.id from public.employees e
          where e.id = any(coalesce(p_responder_ids, '{}'::uuid[])) and e.department_id = x.department_id)
  from unnest(p_department_ids) with ordinality as x(department_id, position);

  update public.ncr_reports
  set status = 'awaiting_response',
      dispositions = (select array_agg(distinct d) from unnest(p_dispositions) d),
      disposition_note = nullif(trim(coalesce(p_note, '')), ''),
      disposed_by = v_employee.id,
      disposed_at = now()
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_response', 'dispose', p_note, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'responsible_managers', 'NCR รอแผนกตอบภายใน 5 วันนับจากวันออกใบ', v_employee.id);
  return v_ncr.id;
end;
$$;
revoke all on function public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[]) from public, anon;
grant execute on function public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[]) to authenticated;

-- 5. ระบุ/เปลี่ยน/ยกเลิกการระบุผู้ตอบของแผนกหลังพิจารณาแล้ว (ผจก.โรงงานเท่านั้น)
-- p_responder_id = null คือยกเลิกการระบุ (ทุกคนที่เข้าเกณฑ์ในแผนกตอบได้) ทำได้ตราบที่ใบรอแผนกทำอะไรสักอย่าง
-- (รอตอบ / รอ QA ติดตาม ซึ่งแผนกยังส่งแนวทางป้องกันได้ / รอข้อมูลเพิ่มเติม) ค่าเดิมซ้ำไม่บันทึกอะไร
create or replace function public.app_ncr_assign_responder(p_ncr_id uuid, p_department_id uuid, p_responder_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_current public.ncr_responsibilities%rowtype;
  v_dept_code text;
  v_name text;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();
  if private.employee_role_code(v_employee.id) <> 'factory_manager' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status not in ('awaiting_response', 'awaiting_followup', 'awaiting_info') then
    raise exception 'INVALID_TRANSITION';
  end if;

  select * into v_current
  from public.ncr_responsibilities
  where ncr_id = v_ncr.id and department_id = p_department_id
  for update;
  if v_current.ncr_id is null then
    raise exception 'INVALID_RESPONSIBILITIES';
  end if;

  if p_responder_id is not null
     and not private.ncr_responder_valid(p_responder_id, p_department_id, v_ncr.is_test) then
    raise exception 'INVALID_RESPONDER';
  end if;
  if v_current.responder_id is not distinct from p_responder_id then
    return v_ncr.id;
  end if;

  update public.ncr_responsibilities
  set responder_id = p_responder_id
  where ncr_id = v_ncr.id and department_id = p_department_id;

  select d.code into v_dept_code from public.departments d where d.id = p_department_id;
  select e.first_name || ' ' || e.last_name into v_name from public.employees e where e.id = p_responder_id;
  perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'assign_responder',
    v_dept_code || ': ' || coalesce(v_name, 'ทุกคนในแผนก'), v_employee.id);

  -- แจ้งผู้ที่ถูกระบุ (ใบทดสอบไม่แจ้งใคร เหมือน private.ncr_audience)
  if p_responder_id is not null and not v_ncr.is_test and p_responder_id is distinct from v_employee.id then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, null::uuid, 'NCR ระบุให้คุณเป็นผู้ตอบ',
           v_ncr.ncr_no || ' · ' || v_ncr.product_name,
           '/ncr/' || v_ncr.id::text
    from public.employees e
    where e.id = p_responder_id and e.is_active;
  end if;
  return v_ncr.id;
end;
$$;
revoke all on function public.app_ncr_assign_responder(uuid, uuid, uuid) from public, anon;
grant execute on function public.app_ncr_assign_responder(uuid, uuid, uuid) to authenticated;

-- 6. ส่วนที่ 3: ตอบ NCR — ผู้ที่ตอบได้ตาม private.ncr_can_respond
-- (คัดจากนิยามล่าสุดใน 20261015010000_ncr_prevention_after_response.sql เปลี่ยนเฉพาะการตรวจสิทธิ์)
create or replace function public.app_ncr_respond(
  p_ncr_id uuid,
  p_causes text[],
  p_root_cause text,
  p_correction text,
  p_prevention text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_prevention text := nullif(trim(coalesce(p_prevention, '')), '');
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.ncr_can_respond(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status <> 'awaiting_response' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if coalesce(cardinality(p_causes), 0) = 0
     or not (p_causes <@ array['man', 'machine', 'material', 'method', 'measure', 'environment', 'other']::text[]) then
    raise exception 'INVALID_CAUSES';
  end if;
  if char_length(trim(coalesce(p_root_cause, ''))) not between 5 and 5000 then
    raise exception 'INVALID_ROOT_CAUSE';
  end if;
  if char_length(trim(coalesce(p_correction, ''))) not between 5 and 5000 then
    raise exception 'INVALID_CORRECTION';
  end if;
  if v_prevention is not null and char_length(v_prevention) not between 5 and 5000 then
    raise exception 'INVALID_PREVENTION';
  end if;

  update public.ncr_reports
  set status = 'awaiting_followup',
      causes = (select array_agg(distinct c) from unnest(p_causes) c),
      root_cause = trim(p_root_cause),
      correction = trim(p_correction),
      correction_due = v_ncr.response_due,
      prevention = coalesce(v_prevention, v_ncr.prevention),
      prevention_due = v_ncr.response_due + 7,
      responded_by = v_employee.id,
      responded_at = now()
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_followup', 'respond', null, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'qa', 'NCR ตอบกลับแล้ว รอ QA ติดตามผล', v_employee.id);
  return v_ncr.id;
end;
$$;

-- ส่วนที่ 3 (ภายหลัง): ส่งแนวทางป้องกัน — ผู้ที่ตอบได้ตาม private.ncr_can_respond
-- (คัดจากนิยามล่าสุดใน 20261015020000_ncr_prevention_lock_after_submit.sql เปลี่ยนเฉพาะการตรวจสิทธิ์)
create or replace function public.app_ncr_submit_prevention(p_ncr_id uuid, p_prevention text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.ncr_can_respond(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status <> 'awaiting_followup' then
    raise exception 'INVALID_TRANSITION';
  end if;
  if v_ncr.prevention is not null then
    raise exception 'NCR_PREVENTION_ALREADY_SUBMITTED';
  end if;
  if char_length(trim(coalesce(p_prevention, ''))) not between 5 and 5000 then
    raise exception 'INVALID_PREVENTION';
  end if;

  update public.ncr_reports
  set prevention = trim(p_prevention)
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'prevention', null, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'qa', 'NCR แผนกส่งแนวทางป้องกันแล้ว', v_employee.id);
  return v_ncr.id;
end;
$$;

-- ให้ข้อมูลเพิ่มเติมที่ผู้ลงนามขอ — ผู้ที่ตอบได้ตาม private.ncr_can_respond แล้วกลับไปรอลงนามที่ลำดับเดิม
-- (คัดจากนิยามล่าสุดใน 20261005060000_ncr_signoff_request_info.sql เปลี่ยนเฉพาะการตรวจสิทธิ์)
create or replace function public.app_ncr_answer_info(p_ncr_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_request public.ncr_info_requests%rowtype;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.ncr_can_respond(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status <> 'awaiting_info' then
    raise exception 'INVALID_TRANSITION';
  end if;

  select * into v_request
  from public.ncr_info_requests
  where ncr_id = v_ncr.id and answered_at is null
  for update;
  if v_request.id is null then
    raise exception 'INVALID_TRANSITION';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 5 and 5000 then
    raise exception 'INVALID_INFO_ANSWER';
  end if;

  update public.ncr_info_requests
  set answer_note = trim(p_note), answered_by = v_employee.id, answered_at = now()
  where id = v_request.id;
  update public.ncr_reports set status = 'awaiting_signoff' where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_signoff', 'answer_info', p_note, v_employee.id);
  perform private.ncr_notify(
    v_ncr.id,
    case v_request.step when 'qa' then 'qa_managers' when 'factory' then 'factory' else 'general_manager' end,
    'NCR ได้รับข้อมูลเพิ่มเติมแล้ว รอลงนามต่อ',
    v_employee.id
  );
  return v_request.id;
end;
$$;
