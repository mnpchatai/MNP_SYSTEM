-- เตือนงานค้างซ้ำ + CC หัวหน้า + ประวัติแก้วันที่คาดว่าจะเสร็จ (20261005010000_pending_work_reminders.sql)
--   1) เตือนคนที่ถือลูกตามสถานะ: ช่างที่ยังไม่เริ่มงาน, ช่างที่เลยกำหนดเสร็จ, ผู้แจ้งรอตรวจรับ, ผู้อนุมัติ, NCR
--      ไม่เตือน: ช่างที่เริ่มงานแล้วและยังไม่เลยกำหนด, ใบที่จบแล้ว, งานที่เพิ่งมาถึงไม่ถึง 2 ชั่วโมง
--   2) อีเมลสรุปฉบับเดียวต่อคนต่อรอบ ไม่ซ้ำในรอบเดียวกัน สรุปใหม่ปิดสรุปเก่าที่ยังไม่อ่าน
--   3) ข้ามวันอาทิตย์และวันหยุดบริษัท
--   4) 2 ชั่วโมงหลังรอบเตือน งานที่ยังค้างกับคนเดิมส่งสำเนาถึงหัวหน้า (ไม่ใส่ชื่อเรื่อง)
--   5) แก้วันที่คาดว่าจะเสร็จ: สิทธิ์ ข้อจำกัด และประวัติ "เดิม → ใหม่"
--   6) สิทธิ์: ผู้ใช้ทั่วไปเรียกงานตั้งเวลาไม่ได้ อ่าน log ไม่ได้ วันหยุดแก้ได้เฉพาะ admin
begin;

create extension if not exists pgtap with schema extensions;
select plan(50);

-- เตรียมคน: ช่าง MT 2 คน, ผจก.แผนก MT, ผจก.โรงงาน, ผจก.ทั่วไป, พนักงานนอกงาน
-- จาก seed (หลัง migration): 5..01 admin, 5..02 ผจก.แผนก MT, 5..03 พนักงาน OPS (manager_id = 5..02)
insert into auth.users (id, email, raw_user_meta_data) values
  ('75000000-0000-0000-0000-0000000000a1', 'pw-tech1@mnp.local', '{}'::jsonb),
  ('75000000-0000-0000-0000-0000000000a2', 'pw-tech2@mnp.local', '{}'::jsonb),
  ('75000000-0000-0000-0000-0000000000a6', 'pw-outsider@mnp.local', '{}'::jsonb),
  ('75000000-0000-0000-0000-0000000000b3', 'pw-requester@mnp.local', '{}'::jsonb),
  ('75000000-0000-0000-0000-0000000000b1', 'pw-admin@mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '75000000-0000-0000-0000-0000000000b3' where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '75000000-0000-0000-0000-0000000000b1' where id = '50000000-0000-0000-0000-000000000001';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('75000000-0000-0000-0000-000000000001', 'PW-T1', 'ช่าง', 'หนึ่ง', 'pw-tech1@mnp.local', 'ช่าง',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-0000000000a1'),
  ('75000000-0000-0000-0000-000000000002', 'PW-T2', 'ช่าง', 'สอง', 'pw-tech2@mnp.local', 'ช่าง',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-0000000000a2'),
  ('75000000-0000-0000-0000-000000000003', 'PW-MMT', 'หัวหน้า', 'ซ่อมบำรุง', 'pw-mmt@mnp.local', 'ผจก.ซ่อมบำรุง',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', null),
  ('75000000-0000-0000-0000-000000000004', 'PW-FM', 'ผจก', 'โรงงาน', 'pw-fm@mnp.local', 'ผจก.โรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', null),
  ('75000000-0000-0000-0000-000000000005', 'PW-GM', 'ผจก', 'ทั่วไป', 'pw-gm@mnp.local', 'ผจก.ทั่วไป',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', null),
  ('75000000-0000-0000-0000-000000000006', 'PW-OUT', 'พนักงาน', 'นอกงาน', 'pw-outsider@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '75000000-0000-0000-0000-0000000000a6');

-- เตรียมงาน (ใบแจ้งซ่อม MT ผู้แจ้ง 5..03) — เวลาเตือนที่ทดสอบคือ จันทร์ 7 ม.ค. 2030
insert into public.requests (id, request_type_id, requester_id, department_id, title, description, status, assignee_id,
                             work_started_date, work_expected_date, submitted_at, created_at) values
  ('75000000-0000-0000-0000-00000000000a', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_A รอช่างเริ่มงาน', 'PW_A', 'assigned', '75000000-0000-0000-0000-000000000001',
   current_date - 10, date '2031-01-01', now(), now()),
  ('75000000-0000-0000-0000-00000000000b', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_B กำลังซ่อม ยังไม่เลยกำหนด', 'PW_B', 'in_progress', '75000000-0000-0000-0000-000000000001',
   current_date - 10, date '2030-01-07', now(), now()),
  ('75000000-0000-0000-0000-00000000000c', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_C กำลังซ่อม เลยกำหนด', 'PW_C', 'in_progress', '75000000-0000-0000-0000-000000000001',
   current_date - 10, current_date - 1, now(), now()),
  ('75000000-0000-0000-0000-00000000000d', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_D รอตรวจรับ', 'PW_D', 'pending_verify', '75000000-0000-0000-0000-000000000001',
   current_date - 10, current_date - 1, now(), now()),
  ('75000000-0000-0000-0000-00000000000e', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_E ปิดงานแล้ว', 'PW_E', 'completed', '75000000-0000-0000-0000-000000000001',
   current_date - 10, current_date - 1, now(), now()),
  ('75000000-0000-0000-0000-00000000000f', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_F รออนุมัติ', 'PW_F', 'pending_approval', null,
   null, null, now(), now()),
  ('75000000-0000-0000-0000-000000000010', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PW_G เพิ่งมอบหมาย', 'PW_G', 'assigned', '75000000-0000-0000-0000-000000000002',
   current_date - 10, date '2031-01-01', timestamptz '2030-01-07 07:30+07', timestamptz '2030-01-07 07:30+07');
insert into public.request_technicians (request_id, technician_id) values
  ('75000000-0000-0000-0000-00000000000a', '75000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-00000000000a', '75000000-0000-0000-0000-000000000002'),
  ('75000000-0000-0000-0000-00000000000b', '75000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-00000000000c', '75000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-000000000010', '75000000-0000-0000-0000-000000000002');
insert into public.approval_steps (request_id, step_order, step_name, approver_employee_id, status) values
  ('75000000-0000-0000-0000-00000000000f', 1, 'หัวหน้าแผนก', '50000000-0000-0000-0000-000000000002', 'pending');
insert into public.ncr_reports (id, ncr_no, reporter_id, reporter_department_id, issue_date, product_name, qty_total, qty_defect,
                                unit, source, defect_type_id, description) values
  ('75000000-0000-0000-0000-000000000011', 'PWNCR/30', '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
   current_date, 'PW_N สินค้าทดสอบ', 100, 5, 'ชิ้น', 'in_process',
   (select id from public.ncr_defect_types where code = 'DIM'), 'PW_N ทดสอบเตือน NCR');

-- 1. ใครถือลูก -----------------------------------------------------------------
select set_eq(
  $$ select item_id from private.pending_work_items('2030-01-07 08:30+07') where holder_id = '75000000-0000-0000-0000-000000000001'
       and item_id::text like '75000000%' $$,
  array['75000000-0000-0000-0000-00000000000a'::uuid, '75000000-0000-0000-0000-00000000000c'::uuid],
  'technician 1 holds the unstarted job and the overdue job, not the in-progress job that is still on time'
);
select is(
  (select action from private.pending_work_items('2030-01-07 08:30+07')
   where holder_id = '75000000-0000-0000-0000-000000000001' and item_id = '75000000-0000-0000-0000-00000000000c'),
  'เลยกำหนดเสร็จแล้ว: บันทึกผลซ่อม หรือแก้ไขวันที่คาดว่าจะเสร็จ',
  'the overdue job asks the technician to finish or change the expected date'
);
select set_eq(
  $$ select item_id from private.pending_work_items('2030-01-07 08:30+07') where holder_id = '50000000-0000-0000-0000-000000000003'
       and item_id::text like '75000000%' $$,
  array['75000000-0000-0000-0000-00000000000d'::uuid],
  'the requester holds only the job waiting for their verification'
);
select ok(
  exists (select 1 from private.pending_work_items('2030-01-07 08:30+07')
          where holder_id = '50000000-0000-0000-0000-000000000002' and item_id = '75000000-0000-0000-0000-00000000000f'),
  'the current approver holds the request waiting for approval'
);
select ok(
  exists (select 1 from private.pending_work_items('2030-01-07 08:30+07')
          where holder_id = '75000000-0000-0000-0000-000000000004' and item_type = 'ncr' and item_id = '75000000-0000-0000-0000-000000000011'),
  'the factory manager holds the NCR waiting for disposition'
);
select is(
  (select count(*)::int from private.pending_work_items('2030-01-07 08:30+07') where item_id = '75000000-0000-0000-0000-00000000000e'),
  0,
  'a completed job is nobody''s pending work'
);

-- 2. เตือนรอบ 08:30 ----------------------------------------------------------------
select ok(
  private.send_pending_work_reminders('2030-01-07 08:30+07') > 0,
  'the 08:30 run queues reminders on a Monday'
);
select results_eq(
  $$ select kind, action_url, jsonb_array_length(digest) from public.notifications
     where recipient_id = '75000000-0000-0000-0000-000000000001' and kind = 'reminder' $$,
  $$ values ('reminder'::text, '/'::text, 2) $$,
  'technician 1 gets one summary with both of their jobs'
);
select set_eq(
  $$ select (e ->> 'item_id')::uuid from public.notifications n, jsonb_array_elements(n.digest) e
     where n.recipient_id = '75000000-0000-0000-0000-000000000002' and n.kind = 'reminder' $$,
  array['75000000-0000-0000-0000-00000000000a'::uuid],
  'technician 2 is reminded about the shared job but not the job assigned 1 hour ago'
);
select ok(
  (select title from public.notifications where recipient_id = '50000000-0000-0000-0000-000000000003' and kind = 'reminder')
    = 'งานค้างรอคุณดำเนินการ 1 รายการ',
  'the requester summary counts one pending verification'
);
select ok(
  exists (select 1 from public.notifications n, jsonb_array_elements(n.digest) e
          where n.recipient_id = '50000000-0000-0000-0000-000000000002' and n.kind = 'reminder'
            and e ->> 'item_id' = '75000000-0000-0000-0000-00000000000f'),
  'the approver summary lists the request waiting for approval'
);
select ok(
  exists (select 1 from public.notifications n, jsonb_array_elements(n.digest) e
          where n.recipient_id = '75000000-0000-0000-0000-000000000004' and n.kind = 'reminder'
            and e ->> 'item_type' = 'ncr' and e ->> 'doc_no' = 'PWNCR/30'),
  'the factory manager summary lists the NCR'
);
select is(
  (select count(*)::int from public.notifications n, jsonb_array_elements(n.digest) e
   where n.kind = 'reminder' and e ->> 'item_id' in ('75000000-0000-0000-0000-00000000000b', '75000000-0000-0000-0000-00000000000e')),
  0,
  'nobody is reminded about the on-time in-progress job or the completed job'
);
select is(
  (select email_status from public.notifications where recipient_id = '75000000-0000-0000-0000-000000000001' and kind = 'reminder'),
  'pending',
  'the summary enters the existing email queue'
);
select is(
  private.send_pending_work_reminders('2030-01-07 08:40+07'),
  0,
  'running again in the same slot sends nothing new'
);

-- 3. รอบ 13:30: สรุปใหม่ ปิดสรุปเก่า และงานที่เพิ่งมาถึงเมื่อเช้าถึงเวลาเตือน ---------------------
select ok(private.send_pending_work_reminders('2030-01-07 13:30+07') > 0, 'the 13:30 run queues a new round');
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '75000000-0000-0000-0000-000000000001' and kind = 'reminder' and read_at is null),
  1,
  'only the newest summary stays unread, so the bell does not pile up'
);
select ok(
  exists (select 1 from public.notifications n, jsonb_array_elements(n.digest) e
          where n.recipient_id = '75000000-0000-0000-0000-000000000002' and n.kind = 'reminder' and n.read_at is null
            and e ->> 'item_id' = '75000000-0000-0000-0000-000000000010'),
  'the job assigned at 07:30 is included in the 13:30 round'
);

-- 4. วันหยุด ------------------------------------------------------------------------
insert into public.company_holidays (holiday_date, name_th) values ('2030-01-08', 'วันหยุดทดสอบ');
select is(private.send_pending_work_reminders('2030-01-08 08:30+07'), 0, 'no reminders on a company holiday');
select is(private.send_pending_work_reminders('2030-01-13 08:30+07'), 0, 'no reminders on Sunday');
select is(private.send_pending_work_escalations('2030-01-08 10:30+07'), 0, 'no escalations on a company holiday');

-- 5. หัวหน้า -----------------------------------------------------------------------
select set_eq($$ select employee_id from private.employee_supervisors('50000000-0000-0000-0000-000000000003') $$,
  array['50000000-0000-0000-0000-000000000002'::uuid], 'a configured manager_id is the supervisor');
select set_eq($$ select employee_id from private.employee_supervisors('75000000-0000-0000-0000-000000000001') $$,
  array['50000000-0000-0000-0000-000000000002'::uuid, '75000000-0000-0000-0000-000000000003'::uuid],
  'a staff member without manager_id escalates to every manager of their department');
select set_eq($$ select employee_id from private.employee_supervisors('75000000-0000-0000-0000-000000000003') $$,
  array['75000000-0000-0000-0000-000000000004'::uuid], 'a department manager escalates to the factory manager');
select set_eq($$ select employee_id from private.employee_supervisors('75000000-0000-0000-0000-000000000004') $$,
  array['75000000-0000-0000-0000-000000000005'::uuid], 'the factory manager escalates to the general manager');
select is((select count(*)::int from private.employee_supervisors('75000000-0000-0000-0000-000000000005')), 0,
  'the general manager has no supervisor');

-- 6. สำเนาถึงหัวหน้า 10:30 (รอบ 08:30) -------------------------------------------------------
select is(private.send_pending_work_escalations('2030-01-07 09:00+07'), 0, 'no escalation before 2 hours have passed');
-- ช่างเริ่มงาน A แล้วก่อน 10:30 → A ไม่ถูกส่งถึงหัวหน้า
update public.requests set status = 'in_progress' where id = '75000000-0000-0000-0000-00000000000a';
select ok(private.send_pending_work_escalations('2030-01-07 10:30+07') > 0, 'the 10:30 run escalates what is still pending');
select set_eq(
  $$ select (e ->> 'item_id')::uuid from public.notifications n, jsonb_array_elements(n.digest) e
     where n.recipient_id = '75000000-0000-0000-0000-000000000003' and n.kind = 'escalation' $$,
  array['75000000-0000-0000-0000-00000000000c'::uuid],
  'the maintenance manager gets the overdue job but not the job started after the reminder'
);
select ok(
  (select bool_and(e ? 'holder_name' and not e ? 'title') from public.notifications n, jsonb_array_elements(n.digest) e
   where n.kind = 'escalation'),
  'escalation items name the employee and leave out the request title'
);
select ok(
  exists (select 1 from public.notifications n, jsonb_array_elements(n.digest) e
          where n.recipient_id = '50000000-0000-0000-0000-000000000002' and n.kind = 'escalation'
            and e ->> 'item_id' = '75000000-0000-0000-0000-00000000000d'),
  'the requester''s manager gets the pending verification'
);
select ok(
  exists (select 1 from public.notifications n, jsonb_array_elements(n.digest) e
          where n.recipient_id = '75000000-0000-0000-0000-000000000004' and n.kind = 'escalation'
            and e ->> 'item_id' = '75000000-0000-0000-0000-00000000000f'),
  'the department manager''s pending approval goes to the factory manager'
);
select is(
  (select count(*)::int from public.notifications n, jsonb_array_elements(n.digest) e
   where n.kind = 'escalation' and e ->> 'item_id' = '75000000-0000-0000-0000-000000000010'),
  0,
  'jobs that were not in the 08:30 reminder are not escalated'
);
select is(private.send_pending_work_escalations('2030-01-07 10:45+07'), 0, 'escalation does not repeat in the same round');

-- 7. แก้วันที่คาดว่าจะเสร็จ -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_reschedule_repair_expected_date('75000000-0000-0000-0000-00000000000c', current_date + 3, null) $$,
  'NOT_AUTHORIZED', 'an employee outside the job cannot change the expected date'
);
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_reschedule_repair_expected_date('75000000-0000-0000-0000-00000000000c', current_date - 1, null) $$,
  'EXPECTED_DATE_IN_PAST', 'the new expected date cannot be in the past'
);
select throws_ok(
  $$ select public.app_reschedule_repair_expected_date('75000000-0000-0000-0000-00000000000d', current_date + 3, null) $$,
  'REQUEST_NOT_RESCHEDULABLE', 'a job waiting for verification cannot be rescheduled'
);
select lives_ok(
  $$ select public.app_reschedule_repair_expected_date('75000000-0000-0000-0000-00000000000c', current_date + 3, 'รออะไหล่') $$,
  'the assigned technician changes the expected date'
);
select throws_ok(
  $$ select public.app_reschedule_repair_expected_date('75000000-0000-0000-0000-00000000000c', current_date + 3, null) $$,
  'EXPECTED_DATE_UNCHANGED', 'saving the same date again is rejected'
);
reset role;

select results_eq(
  $$ select old_date, new_date, note, changed_by from public.request_expected_date_changes
     where request_id = '75000000-0000-0000-0000-00000000000c' $$,
  $$ values (current_date - 1, current_date + 3, 'รออะไหล่'::text, '75000000-0000-0000-0000-000000000001'::uuid) $$,
  'history records the old date, the new date, the note and who changed it'
);
select set_eq(
  $$ select recipient_id from public.notifications
     where request_id = '75000000-0000-0000-0000-00000000000c' and title like '%เลื่อนกำหนดเสร็จงานซ่อม' $$,
  array['50000000-0000-0000-0000-000000000003'::uuid, '50000000-0000-0000-0000-000000000002'::uuid,
        '75000000-0000-0000-0000-000000000003'::uuid],
  'the requester and the maintenance managers are told about the new date'
);
select is(
  (select work_expected_date from public.requests where id = '75000000-0000-0000-0000-00000000000c'),
  current_date + 3,
  'the job carries the new expected date'
);
-- แก้ผ่านฟอร์มมอบหมายช่าง (อัปเดตคอลัมน์ตรง) ก็ต้องเกิดประวัติ
update public.requests set work_expected_date = current_date + 5 where id = '75000000-0000-0000-0000-00000000000c';
select is(
  (select count(*)::int from public.request_expected_date_changes where request_id = '75000000-0000-0000-0000-00000000000c'),
  2,
  'any change of the expected date is recorded, not only the reschedule button'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.request_expected_date_changes where request_id = '75000000-0000-0000-0000-00000000000c'),
  2,
  'the requester can read the expected date history of their request'
);
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-0000000000a6","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.request_expected_date_changes where request_id = '75000000-0000-0000-0000-00000000000c'),
  0,
  'an unrelated employee cannot read that history'
);

-- 8. สิทธิ์ -------------------------------------------------------------------------
select throws_ok(
  $$ select public.app_admin_set_holiday('2030-02-01', 'ห้ามเพิ่ม') $$,
  'NOT_AUTHORIZED', 'a non-admin cannot add a holiday'
);
select throws_ok(
  $$ select count(*) from public.pending_work_reminder_log $$,
  '42501', null, 'employees cannot read the reminder log'
);
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_admin_set_holiday('2030-02-01', 'วันหยุดบริษัท') $$,
  'an admin adds a holiday'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'private.send_pending_work_reminders(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.send_pending_work_escalations(timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.app_reschedule_repair_expected_date(uuid, date, text)', 'execute'),
  'scheduled senders are not callable by users and the reschedule RPC is not open to anon'
);
select results_eq(
  $$ select jobname, schedule from cron.job where jobname in ('pending-work-reminders', 'pending-work-escalations') order by jobname $$,
  $$ values ('pending-work-escalations'::text, '30 3,8 * * 1-6'::text), ('pending-work-reminders'::text, '30 1,6 * * 1-6'::text) $$,
  'reminders run 08:30/13:30 and escalations 10:30/15:30 Bangkok time, Monday to Saturday'
);

select * from finish();
rollback;
