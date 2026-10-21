-- ทดสอบ 20261020010000_ncr_responder_designation.sql
--   ผู้ตอบ NCR = พนักงาน/ผจก./ผช.ผจก. ของแผนกที่รับผิดชอบ และ ผจก.โรงงานระบุตัวผู้ตอบได้ (ไม่บังคับ)
--   1) โครงสร้างและสิทธิ์ของ RPC/ตัวช่วย
--   2) ระบุผู้ตอบตอนพิจารณา (app_ncr_dispose): ค่าไม่ถูกต้องทุกแบบถูกปฏิเสธและไม่เขียนอะไร
--   3) ระบุแล้วตอบได้เฉพาะคนนั้น ไม่ระบุแล้วทุกคนที่เข้าเกณฑ์ในแผนกตอบได้ (รวมแผนกที่ไม่มีหัวหน้าอย่าง PP)
--   4) กฎเดียวกันกับส่งแนวทางป้องกันภายหลัง และให้ข้อมูลเพิ่มเติม
--   5) แจ้งเตือนและตัวเตือนงานค้างตามผู้ที่ตอบได้
--   6) เปลี่ยน/ยกเลิกการระบุภายหลัง (app_ncr_assign_responder): สิทธิ์ สถานะ ประวัติ การแจ้งเตือน
--   7) RLS และโหมดทดสอบ (ใบทดสอบระบุได้เฉพาะบัญชีทดสอบ)
begin;

create extension if not exists pgtap with schema extensions;
select plan(96);

-- 1. โครงสร้าง ------------------------------------------------------------------
select ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'ncr_responsibilities' and column_name = 'responder_id'),
  'ncr_responsibilities has the optional responder_id column'
);
select ok(
  not has_function_privilege('authenticated', 'private.ncr_can_respond(uuid, public.employees)', 'execute')
    and not has_function_privilege('anon', 'private.ncr_can_respond(uuid, public.employees)', 'execute')
    and not has_function_privilege('authenticated', 'private.ncr_responder_valid(uuid, uuid, boolean)', 'execute')
    and not has_function_privilege('anon', 'private.ncr_responder_valid(uuid, uuid, boolean)', 'execute'),
  'the responder helpers cannot be called directly by signed-in users or anon'
);
select ok(
  not has_function_privilege('anon', 'public.app_ncr_assign_responder(uuid, uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'public.app_ncr_assign_responder(uuid, uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[])', 'execute'),
  'only signed-in users can execute the responder RPCs'
);
select ok(
  to_regprocedure('public.app_ncr_dispose(uuid, text[], uuid[], text)') is not null
    and to_regprocedure('public.app_ncr_dispose(uuid, text[], uuid[], text, uuid[])') is not null
    and has_function_privilege('authenticated', 'public.app_ncr_dispose(uuid, text[], uuid[], text)', 'execute')
    and not has_function_privilege('anon', 'public.app_ncr_dispose(uuid, text[], uuid[], text)', 'execute'),
  'the four-argument app_ncr_dispose stays callable (a wrapper) next to the five-argument one, with the same privileges as before'
);

-- id ของบัญชีทดสอบ (persona) เก็บไว้ตอนเป็น postgres: RLS ซ่อนแถว inactive จาก client โดยตั้งใจ
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 2. ผู้ใช้ทดสอบ ------------------------------------------------------------------
-- 1 RB-S1 พนักงาน RB · 2 RB-S2 พนักงาน RB · 3 ผจก. RB · 4 ผช.ผจก. GR · 5 พนักงาน GR · 6 พนักงาน PK (ผู้ออกใบ ไม่เกี่ยวข้อง)
-- 7 ผจก.โรงงาน · 8 พนักงาน QA · 9 ผจก. QA · 10 ผจก.ทั่วไป · 11 admin · 12 พนักงาน PP (PP ไม่มีหัวหน้าในระบบ) · 13 พนักงาน RB ปิดบัญชี
insert into auth.users (id, email, raw_user_meta_data) values
  ('7b100000-0000-0000-0000-000000000001', 'ncrr-rb-s1@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000002', 'ncrr-rb-s2@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000003', 'ncrr-rb-m@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000004', 'ncrr-gr-am@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000005', 'ncrr-gr-s@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000006', 'ncrr-pk-s@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000007', 'ncrr-fm@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000008', 'ncrr-qa-s@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000009', 'ncrr-qa-m@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000010', 'ncrr-gm@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000011', 'ncrr-admin@mnp.local', '{}'::jsonb),
  ('7b100000-0000-0000-0000-000000000012', 'ncrr-pp-s@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('7b100000-0000-0000-0000-000000000101', 'NCRR-RB-S1', 'ทดสอบ', 'พนักงาน RB1', 'ncrr-rb-s1@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000001'),
  ('7b100000-0000-0000-0000-000000000102', 'NCRR-RB-S2', 'ทดสอบ', 'พนักงาน RB2', 'ncrr-rb-s2@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000002'),
  ('7b100000-0000-0000-0000-000000000103', 'NCRR-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncrr-rb-m@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '7b100000-0000-0000-0000-000000000003'),
  ('7b100000-0000-0000-0000-000000000104', 'NCRR-GR-AM', 'ทดสอบ', 'ผู้ช่วย ผจก. GR', 'ncrr-gr-am@mnp.local',
   (select id from public.departments where code = 'GR'), (select id from public.roles where code = 'assistant_department_manager'), '7b100000-0000-0000-0000-000000000004'),
  ('7b100000-0000-0000-0000-000000000105', 'NCRR-GR-S', 'ทดสอบ', 'พนักงาน GR', 'ncrr-gr-s@mnp.local',
   (select id from public.departments where code = 'GR'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000005'),
  ('7b100000-0000-0000-0000-000000000106', 'NCRR-PK-S', 'ทดสอบ', 'พนักงาน PK', 'ncrr-pk-s@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000006'),
  ('7b100000-0000-0000-0000-000000000107', 'NCRR-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrr-fm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '7b100000-0000-0000-0000-000000000007'),
  ('7b100000-0000-0000-0000-000000000108', 'NCRR-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncrr-qa-s@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000008'),
  ('7b100000-0000-0000-0000-000000000109', 'NCRR-QA-M', 'ทดสอบ', 'ผจก. QA', 'ncrr-qa-m@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '7b100000-0000-0000-0000-000000000009'),
  ('7b100000-0000-0000-0000-000000000110', 'NCRR-GM', 'ทดสอบ', 'ผจก.ทั่วไป', 'ncrr-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'general_manager'), '7b100000-0000-0000-0000-000000000010'),
  ('7b100000-0000-0000-0000-000000000111', 'NCRR-ADMIN', 'ทดสอบ', 'แอดมิน', 'ncrr-admin@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '7b100000-0000-0000-0000-000000000011'),
  ('7b100000-0000-0000-0000-000000000112', 'NCRR-PP-S', 'ทดสอบ', 'พนักงาน PP', 'ncrr-pp-s@mnp.local',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '7b100000-0000-0000-0000-000000000012');

-- พนักงาน RB ที่ปิดบัญชีแล้ว: ระบุเป็นผู้ตอบไม่ได้
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, is_active) values
  ('7b100000-0000-0000-0000-000000000113', 'NCRR-RB-OFF', 'ทดสอบ', 'พนักงาน RB ปิดบัญชี', 'ncrr-rb-off@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), false);

set local role authenticated;

-- 3. ออก NCR (ผู้ออกใบเป็นพนักงาน PK ซึ่งไม่อยู่แผนกที่รับผิดชอบ) ---------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('test.ncr_a', public.app_ncr_issue('NCRRESP_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_b', public.app_ncr_issue('NCRRESP_B', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_c', public.app_ncr_issue('NCRRESP_C', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_d', public.app_ncr_issue('NCRRESP_D', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_e', public.app_ncr_issue('NCRRESP_E', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_f', public.app_ncr_issue('NCRRESP_F', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);

-- 4. ระบุผู้ตอบตอนพิจารณา: ค่าไม่ถูกต้องทุกแบบถูกปฏิเสธ และไม่เขียนอะไร -------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array['7b100000-0000-0000-0000-000000000106']::uuid[]) $$,
  'INVALID_RESPONDER',
  'a responder from a department that was not selected is rejected'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null,
       array['7b100000-0000-0000-0000-000000000101', '7b100000-0000-0000-0000-000000000102']::uuid[]) $$,
  'INVALID_RESPONDER',
  'only one responder per department can be named'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null,
       array['7b100000-0000-0000-0000-000000000101', '7b100000-0000-0000-0000-000000000101']::uuid[]) $$,
  'INVALID_RESPONDER',
  'the same person cannot be listed twice'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array[gen_random_uuid()]) $$,
  'INVALID_RESPONDER',
  'an unknown responder is rejected'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array[null]::uuid[]) $$,
  'INVALID_RESPONDER',
  'a null responder entry is rejected'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array['7b100000-0000-0000-0000-000000000113']::uuid[]) $$,
  'INVALID_RESPONDER',
  'a deactivated employee cannot be named'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'MGT')], null, array['7b100000-0000-0000-0000-000000000110']::uuid[]) $$,
  'INVALID_RESPONDER',
  'a general manager is not an eligible responder role'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array[current_setting('test.p_sbx_rb_staff')::uuid]) $$,
  'INVALID_RESPONDER',
  'a test persona cannot be named on a real NCR'
);
select is(
  (select count(*)::int from public.ncr_responsibilities where ncr_id = current_setting('test.ncr_a')::uuid),
  0,
  'a rejected decision writes no responsibility rows'
);
select is(
  (select status from public.ncr_reports where id = current_setting('test.ncr_a')::uuid),
  'awaiting_disposition',
  'and the NCR still waits for the factory decision'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array['7b100000-0000-0000-0000-000000000101']::uuid[]) $$,
  'NOT_AUTHORIZED',
  'only the factory manager can decide and name a responder'
);

-- 5. NCR A: RB ระบุ S1, GR ไม่ระบุ — ระบุแล้วตอบได้เฉพาะคนนั้น ไม่ระบุตอบได้ทุกคนที่เข้าเกณฑ์ ---------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB'), (select id from public.departments where code = 'GR')], null,
       array['7b100000-0000-0000-0000-000000000101']::uuid[]) $$,
  'the factory manager sends the NCR to RB and GR and names S1 for RB'
);
select results_eq(
  $$ select d.code, r.responder_id from public.ncr_responsibilities r join public.departments d on d.id = r.department_id
     where r.ncr_id = current_setting('test.ncr_a')::uuid order by d.code $$,
  $$ values ('GR'::text, null::uuid), ('RB'::text, '7b100000-0000-0000-0000-000000000101'::uuid) $$,
  'the named responder is stored for RB and GR is left open'
);

reset role;
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b100000-0000-0000-0000-000000000101' and action_url = '/ncr/' || current_setting('test.ncr_a')
     and title = 'NCR รอแผนกตอบภายใน 5 วันนับจากวันออกใบ'),
  1,
  'the named responder is notified'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id in ('7b100000-0000-0000-0000-000000000102', '7b100000-0000-0000-0000-000000000103')
     and action_url = '/ncr/' || current_setting('test.ncr_a')),
  0,
  'the other RB staff and the RB manager are not notified when someone is named'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id in ('7b100000-0000-0000-0000-000000000104', '7b100000-0000-0000-0000-000000000105')
     and action_url = '/ncr/' || current_setting('test.ncr_a')
     and title = 'NCR รอแผนกตอบภายใน 5 วันนับจากวันออกใบ'),
  2,
  'GR names nobody, so its assistant manager and its staff member are both notified'
);
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr_a')::uuid
     and holder_id in ('7b100000-0000-0000-0000-000000000101', '7b100000-0000-0000-0000-000000000104', '7b100000-0000-0000-0000-000000000105')),
  3,
  'the named responder and everyone in the open department have the NCR in their pending work'
);
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id = current_setting('test.ncr_a')::uuid
     and holder_id in ('7b100000-0000-0000-0000-000000000102', '7b100000-0000-0000-0000-000000000103')),
  0,
  'the RB manager and the other RB staff do not'
);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'other staff of RB cannot respond while S1 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'the RB manager cannot respond while S1 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'staff of an unrelated department cannot respond'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'the factory manager cannot respond'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_a')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'the named staff member responds'
);
select results_eq(
  $$ select status, responded_by, prevention from public.ncr_reports where id = current_setting('test.ncr_a')::uuid $$,
  $$ values ('awaiting_followup'::text, '7b100000-0000-0000-0000-000000000101'::uuid, null::text) $$,
  'the NCR moves to QA follow-up and records who responded'
);

-- 6. NCR B: ส่งให้ RB โดยไม่ระบุ — พนักงานและหัวหน้าของ RB ตอบได้ทุกคน
--    NCR E: ส่งให้ PP ที่ไม่มีหัวหน้าในระบบ (กรณีที่เดิมตอบไม่ได้เลย) ------------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_b')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], 'ส่งให้ RB') $$,
  'a four-argument call still works and names nobody'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_e')::uuid, array['sort'],
       array[(select id from public.departments where code = 'PP')]) $$,
  'the factory manager sends an NCR to PP, which has no manager in the system'
);
select is(
  (select count(*)::int from public.ncr_responsibilities where ncr_id in (current_setting('test.ncr_b')::uuid, current_setting('test.ncr_e')::uuid)
     and responder_id is not null),
  0,
  'a call without responders leaves every department open'
);

reset role;
select is(
  (select count(*)::int from public.notifications
   where recipient_id in ('7b100000-0000-0000-0000-000000000101', '7b100000-0000-0000-0000-000000000102', '7b100000-0000-0000-0000-000000000103')
     and action_url = '/ncr/' || current_setting('test.ncr_b') and title = 'NCR รอแผนกตอบภายใน 5 วันนับจากวันออกใบ'),
  3,
  'both RB staff members and the RB manager are notified when nobody is named'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b100000-0000-0000-0000-000000000113' and action_url = '/ncr/' || current_setting('test.ncr_b')),
  0,
  'the deactivated RB staff member is not notified'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b100000-0000-0000-0000-000000000112' and action_url = '/ncr/' || current_setting('test.ncr_e')
     and title = 'NCR รอแผนกตอบภายใน 5 วันนับจากวันออกใบ'),
  1,
  'the PP staff member is notified even though PP has no manager'
);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_b')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'unrelated staff still cannot respond to an NCR whose department is open'
);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_e')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'and cannot respond for PP either'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_e')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'PP staff can respond for PP'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_b')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'RB staff can respond when nobody is named'
);

-- 7. ส่งแนวทางป้องกันภายหลัง ใช้กฎเดียวกัน (NCR B ไม่ระบุ, NCR A ระบุ S1) --------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_b')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'NOT_AUTHORIZED',
  'unrelated staff cannot submit the prevention'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_b')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'the RB manager submits the prevention when nobody is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'NOT_AUTHORIZED',
  'other RB staff cannot submit the prevention while S1 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'NOT_AUTHORIZED',
  'the RB manager cannot submit the prevention while S1 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_submit_prevention(current_setting('test.ncr_a')::uuid, 'ติดตั้งตัวควบคุมอุณหภูมิ') $$,
  'the named staff member submits the prevention'
);

-- 8. ให้ข้อมูลเพิ่มเติมที่ผู้ลงนามขอ ใช้กฎเดียวกัน (NCR A: RB ระบุ S1, GR ไม่ระบุ) ---------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.ncr_a')::uuid, 'close', 'ตรวจซ้ำผ่าน') $$,
  'QA closes the follow-up of NCR A'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_request_info(current_setting('test.ncr_a')::uuid, 'ขอดูผลตรวจซ้ำและรูปหลังแก้ไข') $$,
  'the QA manager asks for more information'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_answer_info(current_setting('test.ncr_a')::uuid, 'แนบผลตรวจซ้ำและรูปหลังแก้ไขแล้ว') $$,
  'NOT_AUTHORIZED',
  'the RB manager cannot answer while S1 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_answer_info(current_setting('test.ncr_a')::uuid, 'แนบผลตรวจซ้ำและรูปหลังแก้ไขแล้ว') $$,
  'GR staff can answer because GR names nobody'
);
select is(
  (select status from public.ncr_reports where id = current_setting('test.ncr_a')::uuid),
  'awaiting_signoff',
  'the NCR is back at the signing step'
);

-- 9. เปลี่ยน/ยกเลิกการระบุผู้ตอบภายหลัง (NCR C ส่งให้ RB และ GR โดยไม่ระบุ) -------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_c')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB'), (select id from public.departments where code = 'GR')]) $$,
  'NCR C is sent to RB and GR with nobody named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'NOT_AUTHORIZED',
  'a department manager cannot name the responder'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'NOT_AUTHORIZED',
  'a QA manager cannot name the responder'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_assign_responder(gen_random_uuid(),
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'NCR_NOT_FOUND',
  'an unknown NCR is rejected'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'PK'), '7b100000-0000-0000-0000-000000000106') $$,
  'INVALID_RESPONSIBILITIES',
  'only a department responsible for the NCR can have a responder'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000105') $$,
  'INVALID_RESPONDER',
  'a person from another department cannot be named for RB'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000113') $$,
  'INVALID_RESPONDER',
  'a deactivated person cannot be named'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), current_setting('test.p_sbx_rb_staff')::uuid) $$,
  'INVALID_RESPONDER',
  'a test persona cannot be named on a real NCR'
);
select is(
  (select count(*)::int from public.ncr_status_history where ncr_id = current_setting('test.ncr_c')::uuid and action = 'assign_responder'),
  0,
  'rejected assignments leave no history'
);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), null) $$,
  'clearing a department that names nobody is accepted'
);
select is(
  (select count(*)::int from public.ncr_status_history where ncr_id = current_setting('test.ncr_c')::uuid and action = 'assign_responder'),
  0,
  'an unchanged assignment is not recorded'
);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'the factory manager names S2 for RB'
);
select results_eq(
  $$ select action, note, changed_by from public.ncr_status_history
     where ncr_id = current_setting('test.ncr_c')::uuid and action = 'assign_responder' $$,
  $$ values ('assign_responder'::text, 'RB: ทดสอบ พนักงาน RB2'::text, '7b100000-0000-0000-0000-000000000107'::uuid) $$,
  'the assignment is recorded in the status history with the department and the name'
);

reset role;
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b100000-0000-0000-0000-000000000102' and action_url = '/ncr/' || current_setting('test.ncr_c')
     and title = 'NCR ระบุให้คุณเป็นผู้ตอบ'),
  1,
  'the newly named person is notified'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b100000-0000-0000-0000-000000000107' and title = 'NCR ระบุให้คุณเป็นผู้ตอบ'),
  0,
  'the factory manager is not notified of their own assignment'
);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_c')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'S1 can no longer respond once S2 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_c')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'the RB manager cannot respond once S2 is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000103') $$,
  'the factory manager can switch the responder to the RB manager'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_c')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'S2 can no longer respond after being replaced'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'RB'), null) $$,
  'the factory manager can clear the named responder'
);
select is(
  (select responder_id from public.ncr_responsibilities
   where ncr_id = current_setting('test.ncr_c')::uuid and department_id = (select id from public.departments where code = 'RB')),
  null::uuid,
  'clearing the responder opens the department again'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_c')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'S1 can respond again once the department is open'
);

-- 10. เปลี่ยนผู้ตอบได้เฉพาะตอนที่แผนกยังมีงานต้องทำ -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_c')::uuid,
       (select id from public.departments where code = 'GR'), '7b100000-0000-0000-0000-000000000105') $$,
  'the responder can be named while the NCR waits for QA follow-up (the prevention is still due)'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_d')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'INVALID_TRANSITION',
  'a responder cannot be named before the factory decision'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_f')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'NCR F is sent to RB'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_cancel(current_setting('test.ncr_f')::uuid, 'เปิดซ้ำกับใบอื่น') $$,
  'the QA manager cancels NCR F'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_f')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'INVALID_TRANSITION',
  'a cancelled NCR cannot be changed'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_a')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000102') $$,
  'INVALID_TRANSITION',
  'nobody can be named while the NCR waits for sign-off'
);

-- 11. RLS: ผู้ตอบที่ระบุอ่านได้เฉพาะผู้ที่เห็นใบ และห้ามเขียนตรง ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ncr_responsibilities where ncr_id = current_setting('test.ncr_a')::uuid and responder_id is not null),
  1,
  'staff of a responsible department can read who is named'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ncr_responsibilities where ncr_id = current_setting('test.ncr_a')::uuid),
  0,
  'staff of an unrelated department cannot read the responsibilities'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ update public.ncr_responsibilities set responder_id = '7b100000-0000-0000-0000-000000000102'
     where ncr_id = current_setting('test.ncr_c')::uuid $$,
  '42501',
  'permission denied for table ncr_responsibilities',
  'nobody can change the named responder by writing the table directly'
);

-- 12. โหมดทดสอบ: ใบทดสอบระบุได้เฉพาะบัญชีทดสอบ (persona) --------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid) $$,
  'the admin enters the sandbox as the RB staff persona'
);
select lives_ok(
  $$ select set_config('test.ncr_t1', public.app_ncr_issue('NCRRESP_T1', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ทดสอบโหมดทดสอบ: รูในใหญ่เกินสเปค')->>'id', true) $$,
  'the persona issues a test NCR'
);
select lives_ok(
  $$ select set_config('test.ncr_t2', public.app_ncr_issue('NCRRESP_T2', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ทดสอบโหมดทดสอบ: ผิวเป็นตามด')->>'id', true) $$,
  'and a second one'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'switch to the factory manager persona'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_t1')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array['7b100000-0000-0000-0000-000000000101']::uuid[]) $$,
  'INVALID_RESPONDER',
  'a real employee cannot be named on a test NCR'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_t1')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')], null, array[current_setting('test.p_sbx_rb_staff')::uuid]) $$,
  'a test persona can be named on a test NCR'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid) $$,
  'switch to the RB manager persona'
);
select throws_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_t1')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'NOT_AUTHORIZED',
  'the RB manager persona cannot respond while the staff persona is named'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid) $$,
  'switch to the RB staff persona'
);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.ncr_t1')::uuid, array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', '') $$,
  'the named staff persona responds'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'switch back to the factory manager persona'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.ncr_t2')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'the second test NCR is sent to RB with nobody named'
);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_t2')::uuid,
       (select id from public.departments where code = 'RB'), '7b100000-0000-0000-0000-000000000101') $$,
  'INVALID_RESPONDER',
  'a real employee cannot be named on a test NCR afterwards either'
);
select lives_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_t2')::uuid,
       (select id from public.departments where code = 'RB'), current_setting('test.p_sbx_rb_mgr')::uuid) $$,
  'a test persona can be named afterwards'
);
select lives_ok(
  $$ select public.app_sandbox_exit() $$,
  'the admin leaves the sandbox'
);
select set_config('request.jwt.claims', '{"sub":"7b100000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_assign_responder(current_setting('test.ncr_t2')::uuid,
       (select id from public.departments where code = 'RB'), null) $$,
  'SANDBOX_SCOPE_MISMATCH',
  'a real factory manager cannot change the responder of a test NCR'
);

reset role;
select is(
  (select count(*)::int from public.notifications where action_url in ('/ncr/' || current_setting('test.ncr_t1'), '/ncr/' || current_setting('test.ncr_t2'))),
  0,
  'test NCRs notify nobody, including the named persona'
);

select * from finish();
rollback;
