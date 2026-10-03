-- ทดสอบสายอนุมัติ ผจก.โรงงาน -> ผจก.ทั่วไป ไม่ข้ามขั้นแบบเงียบๆ
-- (20261003030000_never_skip_factory_general_approval_steps.sql):
--   1) ไม่มีผู้ถือบทบาท ผจก.ทั่วไป ใบแจ้งซ่อมก็ยังมีขั้น ผจก.ทั่วไป
--   2) ผจก.โรงงานอนุมัติแล้วใบต้องรอ ผจก.ทั่วไป ไม่ไปถึงรอมอบหมายช่าง และมอบหมายช่างไม่ได้
--   3) ขั้นที่ไม่มีผู้ถือบทบาท แจ้ง admin แทน และมีแค่ admin ที่อนุมัติแทนได้
--   4) ใบที่หลุดไปรอมอบหมายช่างโดยขาดขั้น ถูกย้อนกลับมารออนุมัติ ใบที่มอบหมายช่างแล้วไม่ถูกแตะ
begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_function('private', 'notify_approval_step', array['uuid','text'], 'private.notify_approval_step exists');
select has_function('private', 'restore_missing_factory_general_steps', array[]::text[], 'private.restore_missing_factory_general_steps exists');

-- เตรียมผู้ใช้: ผู้แจ้ง (พนักงานสาธิต), ผจก.โรงงาน, admin สาธิต ไม่มีใครถือบทบาท ผจก.ทั่วไป
insert into auth.users (id, email, raw_user_meta_data) values
  ('73000000-0000-0000-0000-000000000001', 'skip-requester@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000002', 'skip-factory@mnp.local', '{}'::jsonb),
  ('73000000-0000-0000-0000-000000000003', 'skip-admin@mnp.local', '{}'::jsonb);

update public.employees
set auth_user_id = '73000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
update public.employees
set auth_user_id = '73000000-0000-0000-0000-000000000003'
where id = '50000000-0000-0000-0000-000000000001';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('73000000-0000-0000-0000-000000000004', 'SKIP-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'skip-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '73000000-0000-0000-0000-000000000002');

insert into public.approval_module_permissions (employee_id, request_type_id)
select '73000000-0000-0000-0000-000000000004', t.id
from public.request_types t
where t.code = 'MT_REPAIR';

select is(
  (select count(*)::int from public.employees e
   where coalesce(e.acting_role_id, e.role_id) = '20000000-0000-0000-0000-000000000006' and e.is_active),
  0,
  'precondition: nobody holds the general manager role'
);

-- 1. สร้างใบแจ้งซ่อม -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_create_repair_request(
       (select m.department_id from public.machines m join public.departments d on d.id = m.department_id
        where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
       (select m.id from public.machines m join public.departments d on d.id = m.department_id
        where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
       'repair', 'SKIP_NEW ใบแจ้งซ่อมตอนที่ยังไม่มี ผจก.ทั่วไป') $$,
  'requester creates a repair request while nobody holds the general manager role'
);
reset role;

select results_eq(
  $$ select s.step_name from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.description like 'SKIP_NEW%' order by s.step_order $$,
  array['ผู้จัดการโรงงาน', 'ผู้จัดการทั่วไป'],
  'the general manager step is created even without a holder'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.description like 'SKIP_NEW%' and n.recipient_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'admins are not notified while the current step has a holder'
);

-- 2. ผจก.โรงงานอนุมัติ: ใบต้องรอ ผจก.ทั่วไป -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.description like 'SKIP_NEW%' and s.step_order = 1),
       'approved', null) $$,
  'factory manager approves step 1'
);
reset role;

select results_eq(
  $$ select r.status::text, r.current_step from public.requests r where r.description like 'SKIP_NEW%' $$,
  $$ values ('pending_approval'::text, 2) $$,
  'after the factory manager the request waits for the general manager, not for technician assignment'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.description like 'SKIP_NEW%' and n.recipient_id = '50000000-0000-0000-0000-000000000001'
     and n.title = 'มีคำร้องรออนุมัติ (ขั้นนี้ยังไม่มีผู้อนุมัติ)'),
  1,
  'admins are notified of the general manager step that has no holder'
);

set local role authenticated;
select throws_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.description like 'SKIP_NEW%' and s.step_order = 2),
       'approved', null) $$,
  'NOT_AUTHORIZED',
  'the factory manager cannot approve the general manager step'
);

select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_assign_repair_technician(
       (select r.id from public.requests r where r.description like 'SKIP_NEW%'),
       array['50000000-0000-0000-0000-000000000004'::uuid]) $$,
  'REQUEST_NOT_ASSIGNABLE',
  'technicians cannot be assigned before the general manager step is approved'
);

-- 3. admin อนุมัติแทนขั้นที่ไม่มีผู้ถือ -------------------------------------------------
select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.description like 'SKIP_NEW%' and s.step_order = 2),
       'approved', null) $$,
  'an admin approves the general manager step on behalf of the missing holder'
);
reset role;

select is(
  (select r.status::text from public.requests r where r.description like 'SKIP_NEW%'),
  'pending_assign',
  'after both steps the repair request moves to technician assignment'
);

-- 4. ย้อนใบที่หลุดไปแล้ว -------------------------------------------------------------
--    จำลองใบที่สร้างด้วยนิยามเดิม: มีแค่ขั้น ผจก.โรงงาน ที่อนุมัติแล้ว และอยู่ที่รอมอบหมายช่าง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"73000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_create_repair_request(
  (select m.department_id from public.machines m join public.departments d on d.id = m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  (select m.id from public.machines m join public.departments d on d.id = m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  'repair', 'SKIP_LEGACY ใบที่ยังไม่ได้มอบหมายช่าง');
select public.app_create_repair_request(
  (select m.department_id from public.machines m join public.departments d on d.id = m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  (select m.id from public.machines m join public.departments d on d.id = m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  'repair', 'SKIP_ASSIGNED ใบที่มีช่างถูกมอบหมายแล้ว');
reset role;

delete from public.approval_steps s
using public.requests r
where r.id = s.request_id
  and (r.description like 'SKIP_LEGACY%' or r.description like 'SKIP_ASSIGNED%')
  and s.step_order = 2;
update public.approval_steps s
set status = 'approved', acted_by = '73000000-0000-0000-0000-000000000004', acted_at = now()
from public.requests r
where r.id = s.request_id and (r.description like 'SKIP_LEGACY%' or r.description like 'SKIP_ASSIGNED%');
update public.requests
set status = 'pending_assign', current_step = 0, approved_at = now()
where description like 'SKIP_LEGACY%' or description like 'SKIP_ASSIGNED%';
insert into public.request_technicians (request_id, technician_id, assigned_by)
select r.id, '50000000-0000-0000-0000-000000000004', '50000000-0000-0000-0000-000000000001'
from public.requests r where r.description like 'SKIP_ASSIGNED%';

select is(
  private.restore_missing_factory_general_steps(),
  1,
  'exactly one stranded repair request is reopened'
);
select results_eq(
  $$ select r.status::text, r.current_step, r.approved_at is null from public.requests r where r.description like 'SKIP_LEGACY%' $$,
  $$ values ('pending_approval'::text, 2, true) $$,
  'the stranded request goes back to pending approval at the added step'
);
select results_eq(
  $$ select s.step_order, s.step_name, s.status::text from public.approval_steps s
     join public.requests r on r.id = s.request_id
     where r.description like 'SKIP_LEGACY%' order by s.step_order $$,
  $$ values (1, 'ผู้จัดการโรงงาน'::text, 'approved'::text), (2, 'ผู้จัดการทั่วไป'::text, 'pending'::text) $$,
  'the approved factory step is kept and the general manager step is appended'
);
select is(
  (select count(*)::int from public.request_status_history h join public.requests r on r.id = h.request_id
   where r.description like 'SKIP_LEGACY%' and h.from_status = 'pending_assign' and h.to_status = 'pending_approval'
     and h.note like 'ย้อนกลับมารออนุมัติ%'),
  1,
  'the reopening is recorded in the status history with a note'
);
select results_eq(
  $$ select r.status::text, (select count(*)::int from public.approval_steps s where s.request_id = r.id)
     from public.requests r where r.description like 'SKIP_ASSIGNED%' $$,
  $$ values ('pending_assign'::text, 1) $$,
  'a request that already has a technician is not touched'
);
select is(
  private.restore_missing_factory_general_steps(),
  0,
  'running the repair again changes nothing'
);

set local role authenticated;
select throws_ok(
  $$ select private.restore_missing_factory_general_steps() $$,
  '42501',
  null,
  'a signed-in user cannot run the repair function'
);
reset role;

select * from finish();
rollback;
