-- ทดสอบ 20261015020000_ncr_prevention_lock_after_submit.sql
--   แนวทางป้องกันส่งได้ครั้งเดียวระหว่างรอ QA ติดตามผล
--   1) ส่งภายหลังแล้วส่งซ้ำไม่ได้ ข้อความเดิมไม่ถูกเขียนทับ
--   2) ใบที่ส่งแนวทางป้องกันมาพร้อมคำตอบ ส่งผ่านฟอร์มแยกไม่ได้
--   3) แก้ได้ทางเดียวคือ QA ส่งกลับแล้วแผนกตอบใหม่พร้อมแนวทางป้องกันใหม่
begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79200000-0000-0000-0000-000000000001', 'ncrl-rb-staff@mnp.local', '{}'::jsonb),
  ('79200000-0000-0000-0000-000000000002', 'ncrl-factory@mnp.local', '{}'::jsonb),
  ('79200000-0000-0000-0000-000000000003', 'ncrl-rb-manager@mnp.local', '{}'::jsonb),
  ('79200000-0000-0000-0000-000000000005', 'ncrl-qa-staff@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79200000-0000-0000-0000-000000000101', 'NCRL-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrl-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79200000-0000-0000-0000-000000000001'),
  ('79200000-0000-0000-0000-000000000102', 'NCRL-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrl-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79200000-0000-0000-0000-000000000002'),
  ('79200000-0000-0000-0000-000000000103', 'NCRL-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncrl-rb-manager@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '79200000-0000-0000-0000-000000000003'),
  ('79200000-0000-0000-0000-000000000105', 'NCRL-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncrl-qa-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '79200000-0000-0000-0000-000000000005');

set local role authenticated;

-- ใบ A: ตอบโดยไม่มีแนวทางป้องกัน แล้วส่งภายหลัง -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_a', public.app_ncr_issue('NCRLOCK_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_b', public.app_ncr_issue('NCRLOCK_B', 50, 5, 'ท่อน', 'in_process', 'DIM', 'ความยาวเกินสเปค 100±1mm วัดได้ 103mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79200000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_b')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);

select set_config('request.jwt.claims', '{"sub":"79200000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', null);
select lives_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'the responsible manager submits the prevention the first time'
);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'เปลี่ยนเป็นแนวทางอื่น') $$,
  'NCR_PREVENTION_ALREADY_SUBMITTED',
  'the prevention cannot be submitted again once it was sent'
);
select results_eq(
  $$ select status, prevention from public.ncr_reports where id = current_setting('test.ncr_a')::uuid $$,
  $$ values ('awaiting_followup'::text, 'ติดตั้งตัวควบคุมอุณหภูมิ'::text) $$,
  'the rejected resubmission leaves the submitted prevention unchanged'
);
select is(
  (select count(*)::int from public.ncr_status_history
   where ncr_id = current_setting('test.ncr_a')::uuid and action = 'prevention'),
  1,
  'only the first submission is recorded in the status history'
);

-- ใบ B: ส่งแนวทางป้องกันมาพร้อมคำตอบ -------------------------------------------------------
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_b')::uuid,
       array['method'], 'ตั้งระยะตัดผิด', 'คัดแยกและตัดใหม่', 'ทำ jig กำหนดระยะตัด') $$,
  'the department can still send the prevention together with the response'
);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_b')::uuid, 'เปลี่ยนเป็นแนวทางอื่น') $$,
  'NCR_PREVENTION_ALREADY_SUBMITTED',
  'a prevention sent with the response cannot be replaced through the separate form'
);

-- แก้ได้ทางเดียว: QA ส่งกลับ แล้วแผนกตอบใหม่พร้อมแนวทางป้องกันใหม่ -------------------------------
select set_config('request.jwt.claims', '{"sub":"79200000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'return', 'แนวทางป้องกันยังไม่ครอบคลุมเครื่องอื่น') $$,
  'QA sends the response back so the department can revise the prevention'
);
select set_config('request.jwt.claims', '{"sub":"79200000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุมอุณหภูมิทุกเครื่องอบ') $$,
  'the department responds again with a revised prevention'
);
select is(
  (select prevention from public.ncr_reports where id = current_setting('test.ncr_a')::uuid),
  'ติดตั้งตัวควบคุมอุณหภูมิทุกเครื่องอบ',
  'the revised prevention replaces the earlier one through the response'
);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'เปลี่ยนเป็นแนวทางอื่น') $$,
  'NCR_PREVENTION_ALREADY_SUBMITTED',
  'the revised prevention is locked again during QA follow-up'
);
select results_eq(
  $$ select action from public.ncr_status_history where ncr_id = current_setting('test.ncr_a')::uuid order by id $$,
  $$ values ('issue'::text), ('dispose'), ('respond'), ('prevention'), ('followup_return'), ('respond') $$,
  'the revision path is recorded in the status history'
);

select * from finish();
rollback;
