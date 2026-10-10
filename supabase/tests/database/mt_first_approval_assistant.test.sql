begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'mt-first-requester@mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000002', 'mt-first-assistant@mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000003', 'mt-first-factory@mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000004', 'mt-first-assistant-admin@mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '82000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('82000000-0000-0000-0000-000000000002', 'MT-FIRST-AFM', 'ทดสอบ', 'ผู้ช่วย', 'mt-first-assistant@mnp.local', 'ผู้ช่วยผู้จัดการโรงงาน', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000002'),
  ('82000000-0000-0000-0000-000000000003', 'MT-FIRST-FM', 'ทดสอบ', 'ผู้จัดการ', 'mt-first-factory@mnp.local', 'ผู้จัดการโรงงาน', '10000000-0000-0000-0000-000000000001',
   '20000000-0000-0000-0000-000000000005', '82000000-0000-0000-0000-000000000003');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, acting_role_id, auth_user_id) values
  ('82000000-0000-0000-0000-000000000004', 'MT-FIRST-AFM-ADMIN', 'ทดสอบ', 'ผู้ช่วยที่เป็น Admin', 'mt-first-assistant-admin@mnp.local',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004',
   '20000000-0000-0000-0000-000000000003', '82000000-0000-0000-0000-000000000004');
insert into public.approval_module_permissions (employee_id, request_type_id)
select e.id, t.id from public.employees e cross join public.request_types t
where e.employee_no in ('MT-FIRST-AFM','MT-FIRST-FM') and t.code in ('MT_REPAIR','MANAGEMENT');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$ select public.app_create_repair_request(
  (select m.department_id from public.machines m join public.departments d on d.id=m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  (select m.id from public.machines m join public.departments d on d.id=m.department_id
   where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
  'repair', 'MT_FIRST_NEW ใบแจ้งซ่อมใหม่สำหรับทดสอบสิทธิ์') $$, 'requester creates a new MT request');
reset role;
select is((select count(*)::int from public.notifications n join public.requests r on r.id=n.request_id
  where r.description like 'MT_FIRST_NEW%' and n.recipient_id='82000000-0000-0000-0000-000000000002'
  and n.title='มีคำร้องรออนุมัติ'), 1, 'new requests automatically notify the assistant');
select is((select count(*)::int from public.notifications n join public.requests r on r.id=n.request_id
  where r.description like 'MT_FIRST_NEW%' and n.recipient_id='82000000-0000-0000-0000-000000000004'
  and n.title='มีคำร้องรออนุมัติ' and n.email_status='pending'), 1,
  'assistant acting admin without module grants gets one queued email for the new MT request');
select results_eq($$ select s.step_order from public.approval_steps s join public.requests r on r.id=s.request_id
  where r.description like 'MT_FIRST_NEW%' order by s.step_order $$, array[1,2], 'new requests still have exactly two steps');

-- Fixed IDs let unauthorized actors call the RPC without depending on RLS to discover a step.
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status, current_step)
select '82000000-0000-0000-0000-000000000010', 'MT-AFM-TEST', t.id,
       '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
       'ทดสอบสิทธิ์ MT', 'ทดสอบผู้ช่วยอนุมัติขั้นแรก', 'pending_approval', 1
from public.request_types t where t.code = 'MT_REPAIR';
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status, current_step)
select '82000000-0000-0000-0000-000000000011', 'MG-AFM-TEST', t.id,
       '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
       'ทดสอบสิทธิ์ฝ่ายบริหาร', 'ไม่ขยายสิทธิ์โมดูลอื่น', 'pending_approval', 1
from public.request_types t where t.code = 'MANAGEMENT';
insert into public.approval_steps (id, request_id, step_order, step_name, approver_role_id) values
  ('82000000-0000-0000-0000-000000000020','82000000-0000-0000-0000-000000000010',1,'ผู้จัดการโรงงาน','20000000-0000-0000-0000-000000000005'),
  ('82000000-0000-0000-0000-000000000021','82000000-0000-0000-0000-000000000010',2,'ผู้จัดการทั่วไป','20000000-0000-0000-0000-000000000006'),
  ('82000000-0000-0000-0000-000000000022','82000000-0000-0000-0000-000000000011',1,'ผู้จัดการโรงงาน','20000000-0000-0000-0000-000000000005');

select is(private.approval_role_matches('82000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000003'), true,
  'assistant matches the existing first MT step');
select is(private.approval_role_matches('82000000-0000-0000-0000-000000000021','20000000-0000-0000-0000-000000000003'), false,
  'assistant does not match the general manager step');
select is(private.approval_role_matches('82000000-0000-0000-0000-000000000022','20000000-0000-0000-0000-000000000003'), false,
  'assistant does not match another module even with its module grant');
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id='82000000-0000-0000-0000-000000000004' and not is_fallback), 1,
  'assistant acting admin receives first-step events and reminders without a module grant');
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000021')
  where employee_id='82000000-0000-0000-0000-000000000004' and not is_fallback), 0,
  'the exception does not subscribe assistant acting admins to the general manager step');
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000022')
  where employee_id='82000000-0000-0000-0000-000000000004' and not is_fallback), 0,
  'the exception does not subscribe assistant acting admins to other modules');
update public.employees set acting_role_id=null where id='82000000-0000-0000-0000-000000000004';
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id='82000000-0000-0000-0000-000000000004'), 0,
  'an admin without the assistant acting role is not added to normal MT recipients');
update public.employees set acting_role_id='20000000-0000-0000-0000-000000000003', is_active=false
where id='82000000-0000-0000-0000-000000000004';
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id='82000000-0000-0000-0000-000000000004'), 0,
  'inactive assistant acting admins do not receive MT notifications');
update public.employees set is_active=true where id='82000000-0000-0000-0000-000000000004';
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id in ('82000000-0000-0000-0000-000000000002','82000000-0000-0000-0000-000000000003') and not is_fallback), 2,
  'both managers receive step 1, with no duplicate recipient');
select private.notify_approval_step('82000000-0000-0000-0000-000000000020', 'ทดสอบ');
select is((select count(*)::int from public.notifications where request_id='82000000-0000-0000-0000-000000000010'
  and recipient_id='82000000-0000-0000-0000-000000000002' and title='มีคำร้องรออนุมัติ'), 1, 'assistant receives the first-step notification');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.requests where id='82000000-0000-0000-0000-000000000010'), 1,
  'RLS permits assistant to read MT outside their own department');
select throws_ok($$ select private.approval_role_matches('82000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000003') $$,
  '42501', null, 'clients cannot call the internal role matcher');
select throws_ok($$ select private.mt_assistant_admin_receives_notifications(
  '82000000-0000-0000-0000-000000000004', (select id from public.request_types where code='MT_REPAIR'), 1) $$,
  '42501', null, 'clients cannot call the internal notification helper');
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000022','approved',null) $$,
  'NOT_AUTHORIZED', 'assistant cannot approve MANAGEMENT');
select lives_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','more_info','ขอข้อมูลเพิ่ม') $$,
  'assistant can request more information on step 1');
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select lives_ok($$ select public.app_resubmit_request('82000000-0000-0000-0000-000000000010','ข้อมูลเพิ่มเติม') $$,
  'requester resubmits to the same step');
reset role;
select is((select count(*)::int from public.notifications where request_id='82000000-0000-0000-0000-000000000010'
  and recipient_id='82000000-0000-0000-0000-000000000002' and title='ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว'), 1,
  'assistant is notified when additional information returns');
select is((select count(*)::int from public.notifications where request_id='82000000-0000-0000-0000-000000000010'
  and recipient_id='82000000-0000-0000-0000-000000000004'
  and title='ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว' and email_status='pending'), 1,
  'assistant acting admin gets one queued email when the requester sends more information');

delete from public.approval_module_permissions where employee_id='82000000-0000-0000-0000-000000000002'
and request_type_id=(select id from public.request_types where code='MT_REPAIR');
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id='82000000-0000-0000-0000-000000000002'), 0, 'revoked assistant receives no reminders');
select is((select count(*)::int from private.approval_step_recipients('82000000-0000-0000-0000-000000000020')
  where employee_id='82000000-0000-0000-0000-000000000004' and not is_fallback), 1,
  'ordinary assistant revocation does not remove the existing admin from MT reminders');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select is((select count(*)::int from public.requests where id='82000000-0000-0000-0000-000000000010'), 0, 'revocation removes approval-based RLS access');
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved',null) $$,
  'NOT_AUTHORIZED', 'assistant without a module grant cannot approve');
reset role;
insert into public.approval_module_permissions (employee_id, request_type_id)
select '82000000-0000-0000-0000-000000000002', id from public.request_types where code='MT_REPAIR';

update public.approval_steps set approver_department_id='10000000-0000-0000-0000-000000000002' where id='82000000-0000-0000-0000-000000000020';
set local role authenticated;
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved',null) $$,
  'NOT_AUTHORIZED', 'department restriction is preserved');
reset role;
update public.approval_steps set approver_department_id=null, approver_employee_id='82000000-0000-0000-0000-000000000003'
where id='82000000-0000-0000-0000-000000000020';
set local role authenticated;
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved',null) $$,
  'NOT_AUTHORIZED', 'assistant cannot replace a personally assigned approver');
reset role;
update public.approval_steps set approver_employee_id=null where id='82000000-0000-0000-0000-000000000020';
update public.employees set is_active=false where id='82000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved',null) $$,
  'EMPLOYEE_NOT_FOUND', 'inactive assistant cannot approve');
reset role;
update public.employees set is_active=true where id='82000000-0000-0000-0000-000000000002';
set local role authenticated;
select lives_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved','ผ่าน') $$,
  'assistant approves the first step');
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000021','approved',null) $$,
  'NOT_AUTHORIZED', 'assistant cannot approve the current second step');
select set_config('request.jwt.claims','{"sub":"82000000-0000-0000-0000-000000000003","role":"authenticated"}',true);
select throws_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000020','approved',null) $$,
  'STEP_NOT_PENDING', 'factory manager cannot approve the same first step a second time');
select lives_ok($$ select public.app_approval_decision('82000000-0000-0000-0000-000000000022','approved',null) $$,
  'factory manager retains the existing approval rule');
reset role;
select results_eq($$ select status::text, current_step from public.requests where id='82000000-0000-0000-0000-000000000010' $$,
  $$ values ('pending_approval'::text,2) $$, 'MT still waits for the general manager after assistant approval');
select is((select acted_by from public.approval_steps where id='82000000-0000-0000-0000-000000000020'),
  '82000000-0000-0000-0000-000000000002'::uuid, 'the audit actor is the actual assistant');
select ok(exists(select 1 from public.audit_logs where entity_type='approval_steps'
  and entity_id='82000000-0000-0000-0000-000000000020'
  and metadata->'new'->>'acted_by'='82000000-0000-0000-0000-000000000002'), 'approval remains audited');
select is((select count(*)::int from public.approval_module_permissions
  where employee_id='82000000-0000-0000-0000-000000000004'), 0,
  'notifications do not add module grants or change admin authorization');
select * from finish();
rollback;
