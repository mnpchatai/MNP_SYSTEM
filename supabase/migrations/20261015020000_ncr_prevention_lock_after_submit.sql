-- NCR ส่วนที่ 3: แนวทางป้องกันไม่ให้เกิดซ้ำส่งได้ครั้งเดียวระหว่างรอ QA ติดตามผล
--
-- เดิม app_ncr_submit_prevention (20261015010000_ncr_prevention_after_response.sql) ให้แผนกส่งซ้ำได้
-- ทุกเมื่อจนกว่า QA จะปิดประเด็น แต่ละครั้งเขียนทับข้อความเดิม และประวัติบันทึกแค่ action 'prevention'
-- โดยไม่เก็บข้อความ จึงย้อนดูไม่ได้ว่าแนวทางที่ QA อ่านไปแล้วเคยเขียนว่าอะไร
-- ตอนนี้: ถ้าใบมีแนวทางป้องกันแล้ว (ส่งมาพร้อมคำตอบหรือส่งภายหลัง) จะส่งซ้ำไม่ได้ (NCR_PREVENTION_ALREADY_SUBMITTED)
-- ถ้าต้องแก้ ให้ QA "ส่งกลับให้แผนกแก้ไขคำตอบ" แล้วแผนกแก้แนวทางป้องกันในฟอร์มตอบ NCR (app_ncr_respond ไม่เปลี่ยน)
-- การส่งกลับ/ตอบใหม่มีบันทึกในประวัติสถานะครบ
--
-- ไม่เปลี่ยนตาราง ใบเดิมไม่กระทบ (ใบที่ส่งแนวทางป้องกันไปแล้วก็แค่แก้ผ่านฟอร์มนี้ไม่ได้อีก)
-- Rollback: นำนิยาม app_ncr_submit_prevention จาก 20261015010000_ncr_prevention_after_response.sql กลับมา

-- (คัดจากนิยามล่าสุดใน 20261015010000_ncr_prevention_after_response.sql เพิ่มเฉพาะการตรวจว่าส่งไปแล้วหรือยัง)
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
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if private.employee_role_code(v_employee.id) not in ('department_manager', 'assistant_department_manager')
     or not exists (
       select 1 from public.ncr_responsibilities r
       where r.ncr_id = v_ncr.id and r.department_id = v_employee.department_id
     ) then
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

revoke all on function public.app_ncr_submit_prevention(uuid, text) from public, anon;
grant execute on function public.app_ncr_submit_prevention(uuid, text) to authenticated;
