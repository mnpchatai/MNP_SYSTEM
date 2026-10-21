-- ทดสอบ 20261021010000_ncr_pending_work_deterministic.sql
--   ตัวเตือนงานค้างของ NCR เมื่อคนเดียวอยู่ทั้ง audience 'qa' และ 'responsible_managers'
--   (QA เป็นแผนกที่รับผิดชอบของใบนั้นเอง) ต้องได้รายการเดียวต่อใบ และเป็น "ส่งแนวทางป้องกัน" จนกว่าจะส่ง
--   1) สิทธิ์ของฟังก์ชันไม่เปลี่ยน
--   2) ระหว่างยังไม่มีแนวทางป้องกัน: พนักงานและ ผจก. แผนก QA ได้รายการเดียว เป็นรายการส่งแนวทางป้องกันพร้อมวันกำหนด
--   3) หลังส่งแนวทางป้องกันแล้ว: เหลือรายการติดตามผลการแก้ไขรายการเดียว
begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select ok(
  not has_function_privilege('anon', 'private.pending_work_items(timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'private.pending_work_items(timestamptz)', 'execute'),
  'pending_work_items still cannot be executed by signed-in users or anon'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('7c100000-0000-0000-0000-000000000001', 'ncro-rb-staff@mnp.local', '{}'::jsonb),
  ('7c100000-0000-0000-0000-000000000002', 'ncro-factory@mnp.local', '{}'::jsonb),
  ('7c100000-0000-0000-0000-000000000003', 'ncro-qa-staff@mnp.local', '{}'::jsonb),
  ('7c100000-0000-0000-0000-000000000004', 'ncro-qa-manager@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('7c100000-0000-0000-0000-000000000101', 'NCRO-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncro-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '7c100000-0000-0000-0000-000000000001'),
  ('7c100000-0000-0000-0000-000000000102', 'NCRO-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncro-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '7c100000-0000-0000-0000-000000000002'),
  ('7c100000-0000-0000-0000-000000000103', 'NCRO-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncro-qa-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '7c100000-0000-0000-0000-000000000003'),
  ('7c100000-0000-0000-0000-000000000104', 'NCRO-QA-M', 'ทดสอบ', 'ผจก. QA', 'ncro-qa-manager@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '7c100000-0000-0000-0000-000000000004');

set local role authenticated;

-- ออกใบ -> ผจก.โรงงานให้แผนก QA เองเป็นแผนกที่รับผิดชอบ -------------------------------------
select set_config('request.jwt.claims', '{"sub":"7c100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr', public.app_ncr_issue('NCROVL_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"7c100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr')::uuid, array['sort'],
       array[(select id from public.departments where code = 'QA')]) $$,
  'the factory manager makes the QA department itself responsible'
);

-- พนักงาน QA ตอบเฉพาะสาเหตุและแนวทางแก้ไข ใบจึงรอ QA ติดตามผลโดยยังไม่มีแนวทางป้องกัน ------------
select set_config('request.jwt.claims', '{"sub":"7c100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'a QA employee responds for the responsible QA department'
);
select results_eq(
  $$ select status, prevention from public.ncr_reports where id = current_setting('test.ncr')::uuid $$,
  $$ values ('awaiting_followup'::text, null::text) $$,
  'the NCR waits for QA follow-up with no prevention yet'
);

-- ยังไม่มีแนวทางป้องกัน: คนที่อยู่ทั้งสอง audience ได้รายการเดียว เป็นรายการส่งแนวทางป้องกัน -----------
reset role;
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
     and holder_id = '7c100000-0000-0000-0000-000000000103'),
  1,
  'a QA employee in the responsible department has exactly one pending item for the NCR'
);
select results_eq(
  $$ select action, due_date from private.pending_work_items(now())
     where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
       and holder_id = '7c100000-0000-0000-0000-000000000103' $$,
  $$ select 'ส่งแนวทางป้องกันไม่ให้เกิดซ้ำ (ส่วนที่ 3)'::text, prevention_due
     from public.ncr_reports where id = current_setting('test.ncr')::uuid $$,
  'and that item is the prevention reminder with its due date, not the follow-up'
);
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
     and holder_id = '7c100000-0000-0000-0000-000000000104'),
  1,
  'the QA manager of the responsible department has exactly one pending item for the NCR'
);
select results_eq(
  $$ select action, due_date from private.pending_work_items(now())
     where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
       and holder_id = '7c100000-0000-0000-0000-000000000104' $$,
  $$ select 'ส่งแนวทางป้องกันไม่ให้เกิดซ้ำ (ส่วนที่ 3)'::text, prevention_due
     from public.ncr_reports where id = current_setting('test.ncr')::uuid $$,
  'and the QA manager also gets the prevention reminder with its due date'
);

-- ส่งแนวทางป้องกันแล้ว: เหลือรายการติดตามผลการแก้ไขรายการเดียว ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"7c100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ และปรับ WI') $$,
  'the QA employee submits the prevention'
);
reset role;
select results_eq(
  $$ select action, due_date from private.pending_work_items(now())
     where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
       and holder_id = '7c100000-0000-0000-0000-000000000103' $$,
  $$ values ('ติดตามผลการแก้ไข (ส่วนที่ 4)'::text, null::date) $$,
  'once the prevention is in, the QA employee is left with only the follow-up'
);
select results_eq(
  $$ select action, due_date from private.pending_work_items(now())
     where item_type = 'ncr' and item_id = current_setting('test.ncr')::uuid
       and holder_id = '7c100000-0000-0000-0000-000000000104' $$,
  $$ values ('ติดตามผลการแก้ไข (ส่วนที่ 4)'::text, null::date) $$,
  'and the QA manager is left with only the follow-up too'
);

select * from finish();
rollback;
