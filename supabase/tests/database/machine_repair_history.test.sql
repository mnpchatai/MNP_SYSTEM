-- ทดสอบ public.app_get_machine_repair_history (20261022010000_machine_repair_history.sql)
--   1) เฉพาะกลุ่มที่กำหนดเรียกได้: ผู้แจ้ง, พนักงานแผนกของเครื่อง, ช่าง/หัวหน้าช่าง MT, ผจก.โรงงาน, ผช.ผจก.โรงงาน, ผจก.ทั่วไป, admin
--   2) ต้องเปิดใบที่ส่งมาได้ตามสิทธิ์เดิมก่อน (คนที่ไม่เกี่ยวข้อง/อยู่แผนกอื่นที่ได้ cc ถูกปฏิเสธ) และ anon/ไม่ใช่พนักงาน/พนักงานที่ปิดใช้งานเรียกไม่ได้
--   3) รายการที่คืน: ใบที่ผูกเครื่องเดียวกัน (รวมใบเก่าที่ไม่มี machine_id แต่แผนก+รหัสตรงกัน) ไม่รวมใบปัจจุบัน ใบ draft เครื่องอื่น
--      และใบรหัสเดียวกันของอีกแผนก เรียงใหม่ไปเก่า คืนเฉพาะฟิลด์สรุป และ can_open ตามสิทธิ์เดิมของผู้เรียก
--   4) เครื่องตัวเลือกพิเศษไม่มีประวัติ และใบที่ไม่ใช่ประเภทแจ้งซ่อมถูกปฏิเสธ
begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

select has_function('public', 'app_get_machine_repair_history', array['uuid'], 'public.app_get_machine_repair_history exists');

-- ผู้ใช้ทดสอบ -----------------------------------------------------------------------------
-- role: 01 staff, 02 department_manager, 03 assistant_factory_manager, 04 admin, 05 factory_manager, 06 general_manager
insert into auth.users (id, email, raw_user_meta_data)
select ('88000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid, 'mach-hist-' || n || '@mnp.local', '{}'::jsonb
from generate_series(1, 11) n;

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id)
select ('88000000-0000-0000-0000-0000000000' || lpad(v.n::text, 2, '0'))::uuid,
       'MACH-HIST-' || v.n, v.first_name, v.last_name, 'mach-hist-' || v.n || '@mnp.local', v.job_title,
       (select d.id from public.departments d where d.code = v.dept),
       ('20000000-0000-0000-0000-0000000000' || v.role_no)::uuid,
       ('88000000-0000-0000-0000-0000000000' || lpad(v.n::text, 2, '0'))::uuid
from (values
  (1,  'ผู้แจ้ง',   'ทดสอบ', 'พนักงาน RB',        'RB', '01'),
  (2,  'เพื่อน',    'ทดสอบ', 'พนักงาน RB อีกคน',  'RB', '01'),
  (3,  'คนนอก',     'ทดสอบ', 'พนักงาน GR',        'GR', '01'),
  (4,  'ช่าง',      'ทดสอบ', 'ช่างซ่อมบำรุง',     'MT', '01'),
  (5,  'หัวหน้า',   'ช่าง',  'หัวหน้าช่าง',       'MT', '02'),
  (6,  'ผจก',       'โรงงาน', 'ผู้จัดการโรงงาน',   'FT', '05'),
  (7,  'ผช',        'โรงงาน', 'ผู้ช่วยผู้จัดการโรงงาน', 'FT', '03'),
  (8,  'ผจก',       'ทั่วไป', 'ผู้จัดการทั่วไป',   'AD', '06'),
  (9,  'แอดมิน',    'ทดสอบ', 'ผู้ดูแลระบบ',       'AD', '04'),
  (10, 'ไม่เกี่ยว', 'ทดสอบ', 'พนักงาน GR อีกคน',  'GR', '01')
) as v(n, first_name, last_name, job_title, dept, role_no);
-- เลข 11 เป็นบัญชี auth ที่ไม่ผูกกับพนักงาน

-- ข้อมูลทดสอบ -----------------------------------------------------------------------------
-- เครื่องหลักอยู่แผนก RB, เครื่องอื่นอยู่แผนก GR, ตัวเลือกพิเศษ "ไม่มี" ของ RB
insert into public.machines (id, code, name, department_id, is_placeholder, sort_order) values
  ('88000000-0000-0000-0000-000000000101', 'HIST-RB-1', 'เครื่องทดสอบ RB', (select id from public.departments where code = 'RB'), false, 9001),
  ('88000000-0000-0000-0000-000000000102', 'HIST-GR-1', 'เครื่องทดสอบ GR', (select id from public.departments where code = 'GR'), false, 9002),
  ('88000000-0000-0000-0000-000000000103', 'ไม่มี', 'ไม่มี', (select id from public.departments where code = 'RB'), true, 9003);

insert into public.requests
  (id, request_no, request_type_id, requester_id, department_id, title, description, status, doc_type,
   machine_id, machine_code, machine_name, assignee_id, cc_department_ids, created_at, completed_at, cause_analysis, parts_used)
select v.id::uuid, v.request_no, t.id, v.requester::uuid, d.id, 'ทดสอบประวัติเครื่อง ' || v.request_no, v.description,
       v.status::public.request_status, v.doc_type, v.machine_id::uuid, v.machine_code, 'ชื่อเครื่อง', v.assignee::uuid,
       case when v.cc then array[
         (select id from public.departments where code = 'RB'),
         (select id from public.departments where code = 'GR')] else '{}'::uuid[] end,
       v.created_at::timestamptz, v.completed_at::timestamptz, v.cause, v.parts
from (values
  -- R1: ใบปัจจุบัน (ผู้แจ้ง = 01, ช่าง = 04, cc ไปแผนก RB และ GR)
  ('88000000-0000-0000-0000-0000000000a1', 'HIST-R1', '88000000-0000-0000-0000-000000000001', 'RB', 'in_progress', 'repair',
   '88000000-0000-0000-0000-000000000101', 'HIST-RB-1', '88000000-0000-0000-0000-000000000004', true,
   'อาการของใบปัจจุบัน', '2026-10-01 02:00+00', null, null, null),
  -- R2: ซ่อมเสร็จแล้ว มีสาเหตุ/อะไหล่/ช่าง ผู้แจ้งเป็นอีกคน
  ('88000000-0000-0000-0000-0000000000a2', 'HIST-R2', '50000000-0000-0000-0000-000000000003', 'RB', 'completed', 'repair',
   '88000000-0000-0000-0000-000000000101', 'HIST-RB-1', '88000000-0000-0000-0000-000000000004', false,
   'เครื่องมีเสียงดัง', '2026-08-01 02:00+00', '2026-08-03 02:00+00', 'ลูกปืนสึก', 'ลูกปืน 6204'),
  -- R3: ใบคำร้องของเครื่องเดียวกัน
  ('88000000-0000-0000-0000-0000000000a3', 'HIST-R3', '50000000-0000-0000-0000-000000000003', 'RB', 'pending_approval', 'request',
   '88000000-0000-0000-0000-000000000101', 'HIST-RB-1', null, false,
   'ขอเปลี่ยนสายพาน', '2026-09-01 02:00+00', null, null, null),
  -- R4: draft ต้องไม่ขึ้น
  ('88000000-0000-0000-0000-0000000000a4', 'HIST-R4', '50000000-0000-0000-0000-000000000003', 'RB', 'draft', 'repair',
   '88000000-0000-0000-0000-000000000101', 'HIST-RB-1', null, false,
   'ร่างที่ยังไม่ส่ง', '2026-09-15 02:00+00', null, null, null),
  -- R5: เครื่องอื่น ต้องไม่ขึ้น
  ('88000000-0000-0000-0000-0000000000a5', 'HIST-R5', '50000000-0000-0000-0000-000000000003', 'GR', 'completed', 'repair',
   '88000000-0000-0000-0000-000000000102', 'HIST-GR-1', null, false,
   'เครื่องอื่น', '2026-09-10 02:00+00', null, null, null),
  -- R6: ใบเก่าที่ไม่มี machine_id แต่แผนกและรหัสเครื่องตรงกัน (ตัวพิมพ์/ช่องว่างต่างกัน) ต้องขึ้น
  ('88000000-0000-0000-0000-0000000000a6', 'HIST-R6', '50000000-0000-0000-0000-000000000003', 'RB', 'completed', 'repair',
   null, 'hist-rb -1', null, false,
   'ใบเก่าไม่มีรหัสเครื่องในทะเบียน', '2026-07-01 02:00+00', '2026-07-02 02:00+00', null, null),
  -- R7: ไม่มี machine_id รหัสเดียวกันแต่เป็นแผนก GR ต้องไม่ขึ้น
  ('88000000-0000-0000-0000-0000000000a7', 'HIST-R7', '50000000-0000-0000-0000-000000000003', 'GR', 'completed', 'repair',
   null, 'HIST-RB-1', null, false,
   'รหัสเดียวกันคนละแผนก', '2026-06-01 02:00+00', null, null, null),
  -- R8: ใบที่เลือกเครื่องตัวเลือกพิเศษ "ไม่มี"
  ('88000000-0000-0000-0000-0000000000a8', 'HIST-R8', '88000000-0000-0000-0000-000000000001', 'RB', 'in_progress', 'repair',
   '88000000-0000-0000-0000-000000000103', 'ไม่มี', null, false,
   'ไม่มีรหัสเครื่อง', '2026-10-02 02:00+00', null, null, null)
) as v(id, request_no, requester, dept, status, doc_type, machine_id, machine_code, assignee, cc, description, created_at, completed_at, cause, parts)
join public.departments d on d.code = v.dept
cross join (select id from public.request_types where code = 'MT_REPAIR') t;

-- ใบที่ไม่ใช่ประเภทแจ้งซ่อม (ผู้แจ้งเดียวกันเปิดได้)
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status)
select '88000000-0000-0000-0000-0000000000a9', 'HIST-MG', t.id, '88000000-0000-0000-0000-000000000001',
       (select id from public.departments where code = 'RB'), 'ทดสอบใบฝ่ายบริหาร', 'ไม่ใช่ใบแจ้งซ่อม', 'pending_approval'
from public.request_types t where t.code = 'MANAGEMENT';

-- R2 มีช่างในตารางช่าง (ชื่อรวมจากตารางนี้)
insert into public.request_technicians (request_id, technician_id)
values ('88000000-0000-0000-0000-0000000000a2', '88000000-0000-0000-0000-000000000004');

-- ชุดข้อมูลเพิ่ม: เครื่อง RB-2 (ใบ cancelled/rejected, ช่างมีแค่ assignee_id, อีกเครื่องรหัสเดียวกันคนละ machine_id)
-- และเครื่อง RB-3 ที่มีใบเกินขีดจำกัด 50 รายการ
insert into public.machines (id, code, name, department_id, is_placeholder, sort_order) values
  ('88000000-0000-0000-0000-000000000104', 'HIST-RB-2', 'เครื่องทดสอบ RB-2', (select id from public.departments where code = 'RB'), false, 9004),
  ('88000000-0000-0000-0000-000000000105', 'HIST-RB-2', 'เครื่องรหัสซ้ำ RB-2', (select id from public.departments where code = 'RB'), false, 9005),
  ('88000000-0000-0000-0000-000000000106', 'HIST-RB-3', 'เครื่องทดสอบ RB-3', (select id from public.departments where code = 'RB'), false, 9006);

insert into public.requests
  (id, request_no, request_type_id, requester_id, department_id, title, description, status, doc_type,
   machine_id, machine_code, machine_name, assignee_id, created_at)
select v.id::uuid, v.request_no, t.id, v.requester::uuid, d.id, 'ทดสอบประวัติเครื่อง ' || v.request_no, v.description,
       v.status::public.request_status, 'repair', v.machine_id::uuid, v.machine_code, 'ชื่อเครื่อง', v.assignee::uuid, v.created_at::timestamptz
from (values
  ('88000000-0000-0000-0000-0000000000b1', 'HIST-S1', '88000000-0000-0000-0000-000000000001', 'in_progress', '88000000-0000-0000-0000-000000000104', 'HIST-RB-2', null, 'ใบปัจจุบันของเครื่อง RB-2', '2026-10-05 02:00+00'),
  ('88000000-0000-0000-0000-0000000000b2', 'HIST-S2', '50000000-0000-0000-0000-000000000003', 'cancelled',   '88000000-0000-0000-0000-000000000104', 'HIST-RB-2', '88000000-0000-0000-0000-000000000004', 'ใบที่ยกเลิก ช่างมีแค่ assignee', '2026-09-05 02:00+00'),
  ('88000000-0000-0000-0000-0000000000b3', 'HIST-S3', '50000000-0000-0000-0000-000000000003', 'rejected',    '88000000-0000-0000-0000-000000000104', 'HIST-RB-2', null, 'ใบที่ไม่อนุมัติ', '2026-08-05 02:00+00'),
  ('88000000-0000-0000-0000-0000000000b4', 'HIST-S4', '50000000-0000-0000-0000-000000000003', 'completed',   '88000000-0000-0000-0000-000000000105', 'HIST-RB-2', null, 'รหัสเดียวกันแต่คนละเครื่อง ต้องไม่ขึ้น', '2026-07-05 02:00+00'),
  ('88000000-0000-0000-0000-0000000000c0', 'HIST-L0', '88000000-0000-0000-0000-000000000001', 'in_progress', '88000000-0000-0000-0000-000000000106', 'HIST-RB-3', null, 'ใบปัจจุบันของเครื่อง RB-3', '2026-10-06 02:00+00')
) as v(id, request_no, requester, status, machine_id, machine_code, assignee, description, created_at)
join public.departments d on d.code = 'RB'
cross join (select id from public.request_types where code = 'MT_REPAIR') t;

insert into public.requests
  (id, request_no, request_type_id, requester_id, department_id, title, description, status, doc_type,
   machine_id, machine_code, machine_name, created_at)
select ('88000000-0000-0000-0001-' || lpad(n::text, 12, '0'))::uuid, 'HIST-L' || n, t.id,
       '50000000-0000-0000-0000-000000000003', d.id, 'ทดสอบขีดจำกัด ' || n, 'ใบเก่าลำดับที่ ' || n, 'completed', 'repair',
       '88000000-0000-0000-0000-000000000106', 'HIST-RB-3', 'ชื่อเครื่อง', '2026-01-01 02:00+00'::timestamptz + (n || ' hours')::interval
from generate_series(1, 55) n
join public.departments d on d.code = 'RB'
cross join (select id from public.request_types where code = 'MT_REPAIR') t;

-- 1. ไม่ล็อกอิน / ไม่ใช่พนักงาน -----------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  '42501', null, 'anon cannot execute app_get_machine_repair_history'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  'NOT_AUTHORIZED', 'an account that is not mapped to an active employee is rejected'
);

-- 2. ผู้แจ้ง: เห็นใบอื่นของเครื่อง เรียงใหม่ไปเก่า ไม่มีใบปัจจุบัน/draft/เครื่องอื่น/แผนกอื่น --------
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select request_id from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  $$ values ('88000000-0000-0000-0000-0000000000a3'::uuid), ('88000000-0000-0000-0000-0000000000a2'::uuid), ('88000000-0000-0000-0000-0000000000a6'::uuid) $$,
  'the requester sees the other requests of the machine, newest first, without the current/draft/other-machine/other-department ones'
);
select results_eq(
  $$ select doc_type, status, cause_analysis, parts_used, technician_names, completed_at is not null, can_open
     from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') where request_id = '88000000-0000-0000-0000-0000000000a2' $$,
  $$ values ('repair'::text, 'completed'::text, 'ลูกปืนสึก'::text, 'ลูกปืน 6204'::text, 'ช่าง ทดสอบ'::text, true, false) $$,
  'a row carries the summary fields and can_open is false for a request the caller cannot open'
);
select is(
  (select can_open from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') where request_id = '88000000-0000-0000-0000-0000000000a3'),
  false,
  'can_open follows the existing access rule, not the history permission'
);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a8')),
  0,
  'the placeholder machine "ไม่มี" has no history'
);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a9') $$,
  'NOT_REPAIR_REQUEST', 'a request that is not an MT repair request is rejected'
);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('00000000-0000-0000-0000-000000000000') $$,
  'NOT_AUTHORIZED', 'an unknown request id is rejected without saying whether it exists'
);

select results_eq(
  $$ select request_id, status from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000b1') $$,
  $$ values ('88000000-0000-0000-0000-0000000000b2'::uuid, 'cancelled'::text), ('88000000-0000-0000-0000-0000000000b3'::uuid, 'rejected'::text) $$,
  'cancelled and rejected requests are listed, and another machine that merely shares the code is not'
);
select is(
  (select technician_names from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000b1') where request_id = '88000000-0000-0000-0000-0000000000b2'),
  'ช่าง ทดสอบ',
  'without rows in request_technicians the technician name falls back to the assignee'
);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000c0')),
  50,
  'the history is capped at 50 rows'
);

-- 3. พนักงานแผนกของเครื่อง (ได้ cc) เห็น, แผนกอื่นที่ได้ cc ไม่เห็น, คนที่เปิดใบไม่ได้ถูกปฏิเสธ -------
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'a colleague from the machine department sees the history'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.requests where id = '88000000-0000-0000-0000-0000000000a1'),
  1,
  'precondition: the cc-ed outsider can open the request itself'
);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  'NOT_AUTHORIZED', 'someone who can open the request but belongs to none of the allowed groups is rejected'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  'NOT_AUTHORIZED', 'someone who cannot open the request is rejected'
);

-- 4. ช่างและหัวหน้าช่าง MT ----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select results_eq(
  $$ select request_id, can_open from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') order by request_id $$,
  $$ values ('88000000-0000-0000-0000-0000000000a2'::uuid, true), ('88000000-0000-0000-0000-0000000000a3'::uuid, false), ('88000000-0000-0000-0000-0000000000a6'::uuid, false) $$,
  'the assigned technician sees the history of the machine, and can open the requests they are assigned to'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the maintenance department manager (head technician) sees the history'
);

-- 5. ผจก.โรงงาน / ผช.ผจก.โรงงาน / ผจก.ทั่วไป / admin ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the factory manager sees the history'
);
select is(
  (select count(*) filter (where can_open)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the factory manager can open every listed request'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the assistant factory manager sees the history'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the general manager sees the history'
);
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(
  (select count(*)::integer from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1')),
  3,
  'the administrator sees the history'
);

-- 6. ใบเก่าที่ไม่มี machine_id: จับคู่ด้วยแผนก + รหัส -----------------------------------------
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select results_eq(
  $$ select request_id from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a6') order by request_id $$,
  $$ values ('88000000-0000-0000-0000-0000000000a1'::uuid), ('88000000-0000-0000-0000-0000000000a2'::uuid), ('88000000-0000-0000-0000-0000000000a3'::uuid) $$,
  'a legacy request without machine_id lists the requests of the same machine by department and code'
);

-- 7. พนักงานที่ปิดใช้งานแล้วเรียกไม่ได้ --------------------------------------------------------
reset role;
update public.employees set is_active = false where id = '88000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"88000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_get_machine_repair_history('88000000-0000-0000-0000-0000000000a1') $$,
  'NOT_AUTHORIZED', 'a deactivated employee is rejected'
);
reset role;

-- 8. สิทธิ์ของฟังก์ชัน -----------------------------------------------------------------------
select is(
  has_function_privilege('anon', 'public.app_get_machine_repair_history(uuid)', 'execute'),
  false,
  'anon has no execute privilege'
);
select is(
  has_function_privilege('authenticated', 'public.app_get_machine_repair_history(uuid)', 'execute'),
  true,
  'authenticated may execute'
);
select is(
  (select p.prosecdef from pg_proc p where p.oid = 'public.app_get_machine_repair_history(uuid)'::regprocedure),
  true,
  'the function is security definer'
);
select ok(
  (select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.app_get_machine_repair_history(uuid)'::regprocedure),
  'the function pins an empty search_path'
);
select is(
  (select count(*)::integer from public.employees where auth_user_id is not null and id::text like '88000000-%'),
  10,
  'precondition: the ten test employees exist'
);

select * from finish();
rollback;
