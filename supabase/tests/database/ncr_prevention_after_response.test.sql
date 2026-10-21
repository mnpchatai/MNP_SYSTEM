-- ทดสอบ 20261015010000_ncr_prevention_after_response.sql
--   ส่วนที่ 3 ตอบภายใน 5 วันด้วยสาเหตุ + แนวทางแก้ไข แนวทางป้องกันไม่บังคับ แล้วส่งตามมาภายหลัง
--   1) สิทธิ์ RPC ใหม่ (anon ปิด, แผนกที่ไม่รับผิดชอบ/พนักงานทั่วไปส่งไม่ได้)
--   2) ตอบโดยไม่มีแนวทางป้องกันได้ แต่ถ้าส่งมาต้องถูกรูปแบบ
--   3) QA ปิดประเด็นไม่ได้จนกว่าจะมีแนวทางป้องกัน ส่งกลับได้ตามปกติ
--   4) ตัวเตือนงานค้างให้แผนกส่งแนวทางป้องกัน และหายไปเมื่อส่งแล้ว
--   5) ตอบใหม่หลังส่งกลับโดยเว้นช่องป้องกันว่าง คงแนวทางป้องกันที่ส่งไว้แล้ว
begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select ok(
  not has_function_privilege('anon', 'public.app_ncr_submit_prevention(uuid, text)', 'execute')
    and has_function_privilege('authenticated', 'public.app_ncr_submit_prevention(uuid, text)', 'execute'),
  'only signed-in users can execute app_ncr_submit_prevention'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79100000-0000-0000-0000-000000000001', 'ncrp-rb-staff@mnp.local', '{}'::jsonb),
  ('79100000-0000-0000-0000-000000000002', 'ncrp-factory@mnp.local', '{}'::jsonb),
  ('79100000-0000-0000-0000-000000000003', 'ncrp-rb-manager@mnp.local', '{}'::jsonb),
  ('79100000-0000-0000-0000-000000000004', 'ncrp-pk-manager@mnp.local', '{}'::jsonb),
  ('79100000-0000-0000-0000-000000000005', 'ncrp-qa-staff@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79100000-0000-0000-0000-000000000101', 'NCRP-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrp-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79100000-0000-0000-0000-000000000001'),
  ('79100000-0000-0000-0000-000000000102', 'NCRP-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrp-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79100000-0000-0000-0000-000000000002'),
  ('79100000-0000-0000-0000-000000000103', 'NCRP-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncrp-rb-manager@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '79100000-0000-0000-0000-000000000003'),
  ('79100000-0000-0000-0000-000000000104', 'NCRP-PK-M', 'ทดสอบ', 'ผจก. PK', 'ncrp-pk-manager@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'department_manager'), '79100000-0000-0000-0000-000000000004'),
  ('79100000-0000-0000-0000-000000000105', 'NCRP-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncrp-qa-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '79100000-0000-0000-0000-000000000005');

set local role authenticated;

-- ออกใบ -> ผจก.โรงงานส่งให้ RB -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr', public.app_ncr_issue('NCRPREV_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'the factory manager sends the NCR to RB'
);

-- ตอบภายใน 5 วัน: ไม่ต้องมีแนวทางป้องกัน -------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'สั้น') $$,
  'INVALID_PREVENTION',
  'a prevention that is sent with the response must still be 5–5,000 characters'
);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', '', null) $$,
  'INVALID_CORRECTION',
  'the correction is still required in the 5-day response'
);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'the department can respond with only the cause and the correction'
);
select results_eq(
  $$ select status, prevention, prevention_due - correction_due
     from public.ncr_reports where id = current_setting('test.ncr')::uuid $$,
  $$ values ('awaiting_followup'::text, null::text, 7) $$,
  'the NCR moves to QA follow-up with no prevention yet and the prevention still due 7 days after the correction'
);

-- QA ปิดประเด็นไม่ได้จนกว่าจะมีแนวทางป้องกัน -----------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr')::uuid, 'close', 'ตรวจซ้ำผ่าน') $$,
  'NCR_PREVENTION_REQUIRED',
  'QA cannot close the nonconformity before the prevention is submitted'
);

reset role;
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
     and holder_id = '79100000-0000-0000-0000-000000000103'
     and action = 'ส่งแนวทางป้องกันไม่ให้เกิดซ้ำ (ส่วนที่ 3)'
     and due_date = (select prevention_due from public.ncr_reports where id = current_setting('test.ncr')::uuid)),
  1,
  'the responsible manager is reminded to send the prevention by its due date'
);
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
     and holder_id = '79100000-0000-0000-0000-000000000105'),
  1,
  'QA still has the follow-up in its pending work'
);
set local role authenticated;

-- ส่งแนวทางป้องกันภายหลัง -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'NOT_AUTHORIZED',
  'a manager of an unrelated department cannot submit the prevention'
);
-- พนักงานแผนกที่รับผิดชอบส่งได้ตั้งแต่ 20261020010000 (ดู ncr_responder_designation.test.sql) จึงตรวจกับแผนกที่ไม่รับผิดชอบแทน
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'NOT_AUTHORIZED',
  'staff of an unrelated department cannot submit the prevention'
);
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, '  ') $$,
  'INVALID_PREVENTION',
  'an empty prevention is rejected'
);
select lives_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, '  ติดตั้งตัวควบคุมอุณหภูมิ และปรับ WI  ') $$,
  'the responsible manager submits the prevention later'
);
select results_eq(
  $$ select status, prevention from public.ncr_reports where id = current_setting('test.ncr')::uuid $$,
  $$ values ('awaiting_followup'::text, 'ติดตั้งตัวควบคุมอุณหภูมิ และปรับ WI'::text) $$,
  'submitting the prevention keeps the NCR in QA follow-up and stores the trimmed text'
);

reset role;
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
     and holder_id = '79100000-0000-0000-0000-000000000103'),
  0,
  'the prevention reminder disappears once the prevention is submitted'
);
set local role authenticated;

-- ส่งกลับแล้วตอบใหม่โดยเว้นช่องป้องกัน: คงค่าที่ส่งไว้ ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr')::uuid, 'return', 'การแก้ไขยังไม่ระบุจำนวนที่คัด') $$,
  'QA can still send the response back'
);
select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'INVALID_TRANSITION',
  'the separate prevention form is only for the QA follow-up step'
);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยก 100 ท่อน ซ่อม 10 ท่อน', null) $$,
  'the department responds again without retyping the prevention'
);
select is(
  (select prevention from public.ncr_reports where id = current_setting('test.ncr')::uuid),
  'ติดตั้งตัวควบคุมอุณหภูมิ และปรับ WI',
  'the prevention submitted earlier is kept'
);

select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr')::uuid, 'close', 'ตรวจซ้ำผ่าน') $$,
  'QA closes the nonconformity once the prevention exists'
);

select set_config('request.jwt.claims', '{"sub":"79100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select action from public.ncr_status_history where ncr_id = current_setting('test.ncr')::uuid order by id $$,
  $$ values ('issue'::text), ('dispose'), ('respond'), ('prevention'), ('followup_return'), ('respond'), ('followup_close') $$,
  'the later prevention is recorded in the status history'
);

select * from finish();
rollback;
