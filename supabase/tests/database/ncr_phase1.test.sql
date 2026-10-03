-- ทดสอบ NCR Phase 1 (20261002020000_ncr_phase1.sql)
--   1) โครงสร้าง: RLS, grants, ตัวนับเลขที่แยกจากใบแจ้งซ่อม QA
--   2) ออก NCR: ต้องเข้าสู่ระบบ, ตรวจข้อมูล, เลขที่ QAxxx/yy เรียงต่อกัน
--   3) RLS: ใครเห็น NCR ได้บ้าง และเขียนตารางตรงไม่ได้
--   4) ทุกขั้นตอน (พิจารณา -> ตอบ -> ติดตาม/ส่งกลับ -> ลงนาม 3 ขั้น) ทั้งกรณีอนุญาตและปฏิเสธ
--   5) ความสูญเสีย, การยกเลิก, และการล็อกหลังปิด
begin;

create extension if not exists pgtap with schema extensions;
select plan(95);

-- 1. โครงสร้าง ------------------------------------------------------------------
select ok(
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('ncr_defect_types', 'ncr_reports', 'ncr_responsibilities', 'ncr_losses', 'ncr_status_history')),
  'RLS is enabled on every NCR table'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'ncr\_%'
      and grantee in ('authenticated', 'anon') and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
  ),
  'authenticated and anon cannot write NCR tables directly'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name like 'ncr\_%' and grantee = 'anon'
  ),
  'anon has no grant on NCR tables'
);
select ok(
  not has_function_privilege('anon', 'public.app_ncr_issue(text, numeric, numeric, text, text, text, text, text, text, text, text, text, numeric, numeric)', 'execute'),
  'anon cannot execute app_ncr_issue'
);
select ok(
  not has_function_privilege('authenticated', 'private.next_ncr_doc_number()', 'execute'),
  'authenticated cannot call the NCR number generator directly'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  40,
  'NCR counter for 2026 continues after the paper log (QA001–QA040)'
);
select is(
  (select count(*)::int from public.ncr_defect_types where is_active),
  9,
  'nine active defect types are seeded'
);

-- 2. ผู้ใช้ทดสอบ ----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('73000000-0000-0000-0000-000000000001', 'ncr-rb-staff@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000002', 'ncr-factory@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000003', 'ncr-rb-manager@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000004', 'ncr-gr-manager@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000005', 'ncr-pk-manager@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000006', 'ncr-qa-staff@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000007', 'ncr-qa-manager@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000008', 'ncr-gm@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000010', 'ncr-pk-staff@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('73000000-0000-0000-0000-000000000101', 'NCR-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncr-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '73000000-0000-0000-0000-000000000001'),
  ('73000000-0000-0000-0000-000000000102', 'NCR-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncr-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '73000000-0000-0000-0000-000000000002'),
  ('73000000-0000-0000-0000-000000000103', 'NCR-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncr-rb-manager@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '73000000-0000-0000-0000-000000000003'),
  ('73000000-0000-0000-0000-000000000104', 'NCR-GR-M', 'ทดสอบ', 'ผู้ช่วย ผจก. GR', 'ncr-gr-manager@mnp.local',
   (select id from public.departments where code = 'GR'), (select id from public.roles where code = 'assistant_department_manager'), '73000000-0000-0000-0000-000000000004'),
  ('73000000-0000-0000-0000-000000000105', 'NCR-PK-M', 'ทดสอบ', 'ผจก. PK', 'ncr-pk-manager@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'department_manager'), '73000000-0000-0000-0000-000000000005'),
  ('73000000-0000-0000-0000-000000000106', 'NCR-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncr-qa-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '73000000-0000-0000-0000-000000000006'),
  ('73000000-0000-0000-0000-000000000107', 'NCR-QA-M', 'ทดสอบ', 'ผจก. QA', 'ncr-qa-manager@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '73000000-0000-0000-0000-000000000007'),
  ('73000000-0000-0000-0000-000000000108', 'NCR-GM', 'ทดสอบ', 'ผจก.ทั่วไป', 'ncr-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'general_manager'), '73000000-0000-0000-0000-000000000008'),
  ('73000000-0000-0000-0000-000000000110', 'NCR-PK-S', 'ทดสอบ', 'พนักงาน PK', 'ncr-pk-staff@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '73000000-0000-0000-0000-000000000010');

set local role authenticated;

-- 3. ออก NCR --------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_ANON', 10, 1, 'ชิ้น', 'in_process', 'DIM', 'ต้องถูกปฏิเสธเพราะไม่ได้เข้าสู่ระบบ') $$,
  'AUTH_REQUIRED',
  'issuing an NCR requires a signed-in user'
);

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 120, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm') $$,
  'INVALID_QUANTITY',
  'defect quantity cannot exceed the total quantity'
);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm', p_qty_sampled => 200) $$,
  'INVALID_QUANTITY',
  'sampled quantity cannot exceed the total quantity'
);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 10, 'อัน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm') $$,
  'INVALID_UNIT',
  'unit must come from the allowed list'
);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 10, 'ท่อน', 'warehouse', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm') $$,
  'INVALID_SOURCE',
  'source must be one of the form options'
);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 10, 'ท่อน', 'in_process', 'NOPE', 'รูในใหญ่เกินสเปค 10±0.5mm') $$,
  'INVALID_DEFECT_TYPE',
  'defect type must exist and be active'
);
select throws_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'สั้นไป') $$,
  'INVALID_NCR_DESCRIPTION',
  'description must have at least 10 characters'
);

select lives_ok(
  $$ select public.app_ncr_issue('NCRTEST_A', 1000, 24, 'ท่อน', 'in_process', 'DIM',
       'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm', p_customer_name => 'ลูกค้าทดสอบ', p_qty_sampled => 80) $$,
  'any active employee can issue an NCR'
);
select lives_ok(
  $$ select public.app_ncr_issue('NCRTEST_B', 50, 5, 'ชิ้น', 'final_fg', 'SURF', 'ผิวเป็นตามดเกินเกณฑ์ตัวอย่างลูกค้า') $$,
  'a second NCR can be issued'
);

select results_eq(
  $$ select status, unit, source, reporter_id, issue_date = (now() at time zone 'Asia/Bangkok')::date
     from public.ncr_reports where product_name = 'NCRTEST_A' $$,
  $$ values ('awaiting_disposition'::text, 'ท่อน'::text, 'in_process'::text,
             '73000000-0000-0000-0000-000000000101'::uuid, true) $$,
  'a new NCR waits for the factory manager and records the reporter and Bangkok date'
);
select is(
  (select response_due - issue_date from public.ncr_reports where product_name = 'NCRTEST_A'),
  5,
  'the response due date is set to 5 days after the issue date when the NCR is issued'
);
select matches(
  (select ncr_no from public.ncr_reports where product_name = 'NCRTEST_A'),
  '^QA[0-9]{3}/[0-9]{2}$',
  'NCR number uses the QAxxx/yy format'
);
select is(
  (select substr(ncr_no, 3, 3)::int from public.ncr_reports where product_name = 'NCRTEST_B')
    - (select substr(ncr_no, 3, 3)::int from public.ncr_reports where product_name = 'NCRTEST_A'),
  1,
  'NCR numbers run consecutively'
);

reset role;
select is(
  (select last_number from public.document_counters where department_code = 'QA' and year_key = '26'),
  10,
  'issuing NCRs does not move the QA repair-request counter'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '73000000-0000-0000-0000-000000000102' and action_url like '/ncr/%' and title = 'NCR ใหม่ รอพิจารณา'),
  2,
  'the factory manager is notified of each new NCR'
);
-- เก็บ id ไว้ใช้ทั้งไฟล์ — ผู้ใช้ที่ RLS ไม่ให้เห็นใบจะหา id จากชื่อสินค้าไม่เจอ
select set_config('test.ncr_a', (select id::text from public.ncr_reports where product_name = 'NCRTEST_A'), true);
select set_config('test.ncr_b', (select id::text from public.ncr_reports where product_name = 'NCRTEST_B'), true);
set local role authenticated;

-- 4. RLS อ่าน -------------------------------------------------------------------
select is((select count(*)::int from public.ncr_reports where product_name like 'NCRTEST_%'), 2, 'the reporter sees their NCRs');

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from public.ncr_reports where product_name like 'NCRTEST_%'), 2, 'QA staff see every NCR');

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select is((select count(*)::int from public.ncr_reports where product_name like 'NCRTEST_%'), 0, 'staff of an unrelated department see no NCR');

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.ncr_reports where product_name = 'NCRTEST_A'), 0, 'GR cannot see the NCR before it is made responsible');

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ update public.ncr_reports set status = 'closed' where product_name = 'NCRTEST_A' $$,
  '42501',
  'permission denied for table ncr_reports',
  'nobody can change an NCR directly'
);
select throws_ok(
  $$ insert into public.ncr_losses (ncr_id, loss_type, quantity, unit, unit_cost, recorded_by)
     select id, 'scrap', 1, 'ชิ้น', 1, reporter_id from public.ncr_reports where product_name = 'NCRTEST_A' $$,
  '42501',
  'permission denied for table ncr_losses',
  'nobody can insert losses directly'
);

-- 5. ส่วนที่ 2 พิจารณา ------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid,
       array['sort'], array[(select id from public.departments where code = 'RB')]) $$,
  'NOT_AUTHORIZED',
  'a department manager cannot make the factory decision'
);

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'], array[]::uuid[]) $$,
  'INVALID_RESPONSIBILITIES',
  'at least one responsible department is required'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid,
       array['sort'], array[(select id from public.departments where code = 'RB'), (select id from public.departments where code = 'RB')]) $$,
  'INVALID_RESPONSIBILITIES',
  'a department cannot be listed twice'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid,
       array['burn'], array[(select id from public.departments where code = 'RB')]) $$,
  'INVALID_DISPOSITION',
  'disposition must come from the form options'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid,
       array['sort', 'repair'], array[(select id from public.departments where code = 'RB'), (select id from public.departments where code = 'GR')], 'คัดแยกและซ่อม') $$,
  'the factory manager decides the disposition and responsible departments'
);
select results_eq(
  $$ select status, response_due = issue_date + 5, disposed_by
     from public.ncr_reports where product_name = 'NCRTEST_A' $$,
  $$ values ('awaiting_response'::text, true, '73000000-0000-0000-0000-000000000102'::uuid) $$,
  'the response is due 5 days after the NCR was issued'
);
select results_eq(
  $$ select d.code, r.share from public.ncr_responsibilities r join public.departments d on d.id = r.department_id
     join public.ncr_reports n on n.id = r.ncr_id where n.product_name = 'NCRTEST_A' order by d.code $$,
  $$ values ('GR'::text, 0.5000::numeric), ('RB'::text, 0.5000::numeric) $$,
  'two responsible departments split the share equally'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_b')::uuid, array['scrap'],
       array[(select id from public.departments where code = 'RB'), (select id from public.departments where code = 'GR'),
             (select id from public.departments where code = 'PK')]) $$,
  'the factory manager can assign three departments'
);
select results_eq(
  $$ select array_agg(share order by share), sum(share) from public.ncr_responsibilities
     where ncr_id = current_setting('test.ncr_b')::uuid $$,
  $$ values (array[0.3333, 0.3333, 0.3334]::numeric[], 1.0000::numeric) $$,
  'three departments split the share equally and the shares add up to exactly 1'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid,
       array['scrap'], array[(select id from public.departments where code = 'RB')]) $$,
  'INVALID_TRANSITION',
  'the decision cannot be made twice'
);

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from public.ncr_reports where product_name = 'NCRTEST_A'), 1, 'a responsible department can now read the NCR');

-- 6. ส่วนที่ 3 ตอบ ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุม') $$,
  'NOT_AUTHORIZED',
  'a manager of an unrelated department cannot respond'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุม') $$,
  'NOT_AUTHORIZED',
  'staff of the responsible department cannot respond for the manager'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array[]::text[], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุม') $$,
  'INVALID_CAUSES',
  'at least one 4M cause is required'
);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array['machine', 'method'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'an assistant manager of a responsible department can respond'
);
select is(
  (select status from public.ncr_reports where product_name = 'NCRTEST_A'),
  'awaiting_followup',
  'after the response the NCR waits for QA follow-up'
);
select results_eq(
  $$ select correction_due - issue_date, prevention_due - correction_due
     from public.ncr_reports where product_name = 'NCRTEST_A' $$,
  $$ values (5, 7) $$,
  'correction is due on the response due date and prevention 7 days after it'
);

-- 7. ส่วนที่ 4 ติดตาม (ส่งกลับ แล้วตอบใหม่ แล้วปิด) -------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'close') $$,
  'NOT_AUTHORIZED',
  'only QA can record the follow-up'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'return') $$,
  'NCR_RETURN_NOTE_REQUIRED',
  'returning the response requires a reason'
);
select throws_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'car') $$,
  'INVALID_FOLLOWUP_RESULT',
  'issuing a CAR is not available until Phase 2'
);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'return', 'แนวทางป้องกันยังไม่ระบุผู้รับผิดชอบ') $$,
  'QA can send the response back'
);
select is(
  (select status from public.ncr_reports where product_name = 'NCRTEST_A'),
  'awaiting_response',
  'a returned NCR waits for the department again'
);
select is(
  (select response_due from public.ncr_reports where product_name = 'NCRTEST_A'),
  (now() at time zone 'Asia/Bangkok')::date + 5,
  'a returned NCR must be answered again within 5 days of being returned'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุม ผู้รับผิดชอบ: ช่าง RB') $$,
  'the other responsible manager can respond again'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'close', 'ตรวจซ้ำผ่าน') $$,
  'QA closes the nonconformity'
);
select is(
  (select status from public.ncr_reports where product_name = 'NCRTEST_A'),
  'awaiting_signoff',
  'a closed follow-up waits for the sign-offs'
);

-- 8. ความสูญเสีย ------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_add_loss(gen_random_uuid(), 'scrap', 1, 'ชิ้น', 1) $$,
  'NCR_NOT_FOUND',
  'an unknown NCR is rejected'
);
select throws_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'scrap', 24, 'ท่อน', 18) $$,
  'NOT_AUTHORIZED',
  'an unrelated employee cannot record losses'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'fire', 24, 'ท่อน', 18) $$,
  'INVALID_LOSS_TYPE',
  'loss type must be one of the defined types'
);
select throws_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'scrap', 0, 'ท่อน', 18) $$,
  'INVALID_LOSS',
  'loss quantity must be positive'
);
select lives_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'scrap', 24, 'ท่อน', 18.5, 'ทิ้ง') $$,
  'QA records a scrap loss'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'rework', 2.5, 'ชม.', 60, 'ซ่อม') $$,
  'a responsible department manager records a rework loss'
);
select is(
  (select sum(amount) from public.ncr_losses where ncr_id = current_setting('test.ncr_a')::uuid and voided_at is null),
  594.00::numeric,
  'loss amounts are computed as quantity x unit cost'
);
select lives_ok(
  $$ select public.app_ncr_void_loss((select id from public.ncr_losses where ncr_id = current_setting('test.ncr_a')::uuid and loss_type = 'rework'), 'บันทึกซ้ำ') $$,
  'a loss line can be voided with a reason'
);
select throws_ok(
  $$ select public.app_ncr_void_loss((select id from public.ncr_losses where ncr_id = current_setting('test.ncr_a')::uuid and loss_type = 'rework'), 'บันทึกซ้ำ') $$,
  'LOSS_ALREADY_VOIDED',
  'a loss line cannot be voided twice'
);
select is(
  (select count(*)::int from public.ncr_losses where ncr_id = current_setting('test.ncr_a')::uuid),
  2,
  'voided loss lines are kept for the audit trail'
);

-- 8.1 ไฟล์หลักฐาน ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', current_setting('test.ncr_a') || '/qa-evidence.pdf', '73000000-0000-0000-0000-000000000006',
             '{"size": 2048, "mimetype": "application/pdf"}'::jsonb) $$,
  'QA can upload an evidence file into the NCR folder'
);
select throws_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'other', current_setting('test.ncr_a') || '/qa-evidence.pdf', 'หลักฐาน.pdf') $$,
  'INVALID_ATTACHMENT',
  'attachment section must be report, response or followup'
);
select lives_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'followup', current_setting('test.ncr_a') || '/qa-evidence.pdf', 'หลักฐาน.pdf') $$,
  'QA records the uploaded file against the NCR'
);
select results_eq(
  $$ select section, file_name, content_type, size_bytes, uploader_id from public.ncr_attachments where ncr_id = current_setting('test.ncr_a')::uuid $$,
  $$ values ('followup'::text, 'หลักฐาน.pdf'::text, 'application/pdf'::text, 2048::bigint, '73000000-0000-0000-0000-000000000106'::uuid) $$,
  'size and file type come from storage, not from the client'
);
-- เพดานไฟล์หลักฐาน 20 MB (20261003000000): 15 MB และ 20 MB พอดีผ่าน, เกิน 20 MB ถูกปฏิเสธ
-- ใส่ต่อจากการตรวจ results_eq ข้างบน (ที่นับว่ามีไฟล์เดียว) จึงไม่กระทบ และไม่กระทบการตรวจ "ไม่เห็นไฟล์" ด้านล่าง
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', current_setting('test.ncr_a') || '/exactly-20mb.pdf', '73000000-0000-0000-0000-000000000006',
             '{"size": 20971520, "mimetype": "application/pdf"}'::jsonb) $$,
  'QA can upload a 20 MB evidence file'
);
select lives_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'followup', current_setting('test.ncr_a') || '/exactly-20mb.pdf', 'exactly-20mb.pdf') $$,
  'a 20 MB evidence file (above the old 10 MB limit) can be recorded'
);
select lives_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', current_setting('test.ncr_a') || '/over-20mb.pdf', '73000000-0000-0000-0000-000000000006',
             '{"size": 20971521, "mimetype": "application/pdf"}'::jsonb) $$,
  'storage metadata above 20 MB can exist (the bucket limit is enforced by the Storage API, not by SQL)'
);
select throws_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'followup', current_setting('test.ncr_a') || '/over-20mb.pdf', 'over-20mb.pdf') $$,
  'INVALID_ATTACHMENT',
  'an evidence file above 20 MB cannot be recorded'
);
-- storage ห้ามลบด้วย SQL ตรง (ต้องผ่าน Storage API) จึงตรวจว่ามี policy จำกัดการลบไว้เฉพาะไฟล์ที่ยังไม่ถูกบันทึก
select ok(
  exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'ncr_files_delete_unregistered' and cmd = 'DELETE' and qual like '%ncr_attachments%'),
  'storage only lets the uploader delete their own file that was never registered as evidence'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'response', current_setting('test.ncr_a') || '/qa-evidence.pdf', 'ของคนอื่น.pdf') $$,
  'ATTACHMENT_NOT_UPLOADED',
  'a user cannot register a file someone else uploaded'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', current_setting('test.ncr_a') || '/pk.pdf', '73000000-0000-0000-0000-000000000010', '{"size": 10}'::jsonb) $$,
  '42501',
  null,
  'an employee without access to the NCR cannot upload into its folder'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', 'not-a-uuid/pk.pdf', '73000000-0000-0000-0000-000000000010', '{"size": 10}'::jsonb) $$,
  '42501',
  null,
  'a file outside an NCR folder is rejected'
);
select is(
  (select count(*)::int from public.ncr_attachments) + (select count(*)::int from storage.objects where bucket_id = 'ncr-attachments'),
  0,
  'an employee without access to the NCR sees neither its attachment records nor its files'
);

-- 9. ลงนามตามลำดับ -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_signoff(current_setting('test.ncr_a')::uuid) $$,
  'NOT_AUTHORIZED',
  'the general manager cannot sign before the QA manager'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_signoff(current_setting('test.ncr_a')::uuid) $$,
  'NOT_AUTHORIZED',
  'QA staff cannot sign as the QA manager'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(public.app_ncr_signoff(current_setting('test.ncr_a')::uuid), 'qa', 'the QA manager signs first');
select throws_ok(
  $$ select public.app_ncr_signoff(current_setting('test.ncr_a')::uuid) $$,
  'NOT_AUTHORIZED',
  'the QA manager cannot sign the factory step'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_ncr_signoff(current_setting('test.ncr_a')::uuid), 'factory', 'the factory manager signs second');
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.app_ncr_signoff(current_setting('test.ncr_a')::uuid), 'gm', 'the general manager signs last');
select results_eq(
  $$ select status, closed_at is not null, signoff_qa_by, signoff_factory_by, signoff_gm_by
     from public.ncr_reports where id = current_setting('test.ncr_a')::uuid $$,
  $$ values ('closed'::text, true, '73000000-0000-0000-0000-000000000107'::uuid,
             '73000000-0000-0000-0000-000000000102'::uuid, '73000000-0000-0000-0000-000000000108'::uuid) $$,
  'the NCR is closed with all three signatures'
);

-- 10. ล็อกหลังปิด และการยกเลิก ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'scrap', 1, 'ท่อน', 18) $$,
  'NCR_LOCKED',
  'losses cannot be added after the NCR is closed'
);
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id, metadata)
     values ('ncr-attachments', current_setting('test.ncr_a') || '/late.pdf', '73000000-0000-0000-0000-000000000006', '{"size": 10}'::jsonb) $$,
  '42501',
  null,
  'files cannot be uploaded after the NCR is closed'
);
select throws_ok(
  $$ select public.app_ncr_add_attachment(current_setting('test.ncr_a')::uuid, 'followup', current_setting('test.ncr_a') || '/qa-evidence.pdf', 'ซ้ำ.pdf') $$,
  'NCR_LOCKED',
  'attachments cannot be registered after the NCR is closed'
);
select throws_ok(
  $$ select public.app_ncr_cancel(current_setting('test.ncr_b')::uuid, 'เปิดซ้ำกับใบอื่น') $$,
  'NOT_AUTHORIZED',
  'QA staff cannot cancel an NCR'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_cancel(current_setting('test.ncr_b')::uuid, 'สั้น') $$,
  'INVALID_REASON',
  'cancelling requires a reason of at least 5 characters'
);
select throws_ok(
  $$ select public.app_ncr_cancel(current_setting('test.ncr_a')::uuid, 'ไม่ควรยกเลิกได้') $$,
  'INVALID_TRANSITION',
  'a closed NCR cannot be cancelled'
);
select lives_ok(
  $$ select public.app_ncr_cancel(current_setting('test.ncr_b')::uuid, 'เปิดซ้ำกับใบอื่น') $$,
  'the QA manager can cancel an open NCR'
);
select results_eq(
  $$ select status, ncr_no ~ '^QA[0-9]{3}/[0-9]{2}$', cancel_reason
     from public.ncr_reports where id = current_setting('test.ncr_b')::uuid $$,
  $$ values ('cancelled'::text, true, 'เปิดซ้ำกับใบอื่น'::text) $$,
  'a cancelled NCR keeps its number in the register'
);
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_b')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'INVALID_TRANSITION',
  'a cancelled NCR cannot continue'
);

-- 11. ประวัติสถานะ ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select action from public.ncr_status_history where ncr_id = current_setting('test.ncr_a')::uuid order by id $$,
  -- attachment สองแถว: ไฟล์หลักฐานปกติ + ไฟล์ 20 MB ที่ลงทะเบียนในหัวข้อ 8.1 (app_ncr_add_attachment บันทึกประวัติทุกครั้ง)
  $$ values ('issue'::text), ('dispose'), ('respond'), ('followup_return'), ('respond'), ('followup_close'),
            ('attachment'), ('attachment'), ('signoff_qa'), ('signoff_factory'), ('signoff_gm') $$,
  'every step is recorded in the status history, readable by the reporter'
);

reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select count(*) from public.ncr_reports $$,
  '42501',
  'permission denied for table ncr_reports',
  'anon cannot read NCRs'
);

select * from finish();
rollback;
