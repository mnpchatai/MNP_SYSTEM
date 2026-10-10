begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values
  ('85000000-0000-0000-0000-000000000001', 'mt-owner-requester@mnp.local', '{}'::jsonb),
  ('85000000-0000-0000-0000-000000000002', 'mt-owner-outsider@mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '85000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
insert into public.employees (id, employee_no, first_name, last_name, department_id, role_id, auth_user_id) values
  ('85000000-0000-0000-0000-000000000002', 'MT-OWN-OUT', 'นอก', 'งาน', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000002'),
  ('85000000-0000-0000-0000-000000000003', 'MT-OWN-FM', 'ผู้จัดการ', 'หนึ่ง', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', null),
  ('85000000-0000-0000-0000-000000000004', 'MT-OWN-AFM', 'ผู้ช่วย', 'สอง', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', null),
  ('85000000-0000-0000-0000-000000000005', 'MT-OWN-NO-GRANT', 'ไม่มี', 'สิทธิ์', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', null),
  ('85000000-0000-0000-0000-000000000006', 'MT-OWN-MANAGER', 'หัวหน้า', 'MT', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', null),
  ('85000000-0000-0000-0000-000000000007', 'MT-OWN-OTHER-DEPT', 'หัวหน้า', 'อื่น', '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', null);
insert into public.approval_module_permissions (employee_id, request_type_id)
select e.id, t.id from public.employees e cross join public.request_types t
where e.employee_no in ('MT-OWN-FM', 'MT-OWN-AFM') and t.code = 'MT_REPAIR';

insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status, current_step)
select x.id::uuid, x.no, t.id, '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
  'ทดสอบชื่อผู้รับงาน', 'ข้อมูลจำลอง', x.status::public.request_status, 1
from (values
  ('85000000-0000-0000-0000-000000000010', 'MT-OWN-APP', 'pending_approval'),
  ('85000000-0000-0000-0000-000000000011', 'MT-OWN-ASSIGN', 'pending_assign'),
  ('85000000-0000-0000-0000-000000000012', 'MT-OWN-DONE', 'completed'),
  ('85000000-0000-0000-0000-000000000013', 'MT-OWN-EXPLICIT', 'pending_approval')
) x(id, no, status) cross join public.request_types t where t.code = 'MT_REPAIR';
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status, current_step)
select '85000000-0000-0000-0000-000000000014', 'MG-OWN-APP', t.id,
  '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007', 'โมดูลอื่น', 'ข้อมูลจำลอง', 'pending_approval', 1
from public.request_types t where t.code = 'MANAGEMENT';
insert into public.approval_steps (id, request_id, step_order, step_name, approver_role_id, approver_employee_id) values
  ('85000000-0000-0000-0000-000000000020', '85000000-0000-0000-0000-000000000010', 1, 'โรงงาน', '20000000-0000-0000-0000-000000000005', null),
  ('85000000-0000-0000-0000-000000000021', '85000000-0000-0000-0000-000000000010', 2, 'ทั่วไป', '20000000-0000-0000-0000-000000000006', null),
  ('85000000-0000-0000-0000-000000000022', '85000000-0000-0000-0000-000000000013', 1, 'ผู้อนุมัติเฉพาะ', null, '85000000-0000-0000-0000-000000000005');

select ok(not has_function_privilege('anon', 'public.app_mt_dashboard_role_owners(uuid[])', 'execute'), 'anonymous role cannot call the RPC');
select ok(has_function_privilege('authenticated', 'public.app_mt_dashboard_role_owners(uuid[])', 'execute'), 'authenticated role can call the RPC');
set local role authenticated;
select set_config('request.jwt.claims', '{}', true);
select throws_ok($$ select * from public.app_mt_dashboard_role_owners('{}') $$, 'P0001', 'AUTH_REQUIRED', 'authenticated role without a session is rejected');
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000010'::uuid])
  where employee_id in ('85000000-0000-0000-0000-000000000003', '85000000-0000-0000-0000-000000000004')), 2,
  'current first-step factory manager and assistant both appear');
select is((select full_name from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000010'::uuid])
  where employee_id = '85000000-0000-0000-0000-000000000003'), 'ผู้จัดการ หนึ่ง', 'only the full name and scoped owner fields are returned');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000010'::uuid])
  where employee_id = '85000000-0000-0000-0000-000000000005'), 0, 'a role holder without module permission is excluded');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000011'::uuid])
  where employee_id = '85000000-0000-0000-0000-000000000006'), 1, 'assignment names the owning department manager');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000011'::uuid])
  where employee_id = '85000000-0000-0000-0000-000000000007'), 0, 'another department manager is excluded');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000013'::uuid])
  where employee_id = '85000000-0000-0000-0000-000000000005'), 1, 'an explicit approver follows the existing recipient rule');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000012'::uuid, '85000000-0000-0000-0000-000000000014'::uuid])), 0,
  'closed work and other modules do not return owners');
select is((select count(*)::integer from public.app_mt_dashboard_role_owners('{}')), 0, 'empty input returns no owners');
select throws_ok($$ select * from public.app_mt_dashboard_role_owners(array_fill('85000000-0000-0000-0000-000000000010'::uuid, array[501])) $$,
  'P0001', 'TOO_MANY_REQUESTS', 'RPC batches are bounded');

-- Advancing the same request must replace the names, not keep the first-step owners.
reset role;
update public.requests set current_step = 2 where id = '85000000-0000-0000-0000-000000000010';
set local role authenticated;
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000010'::uuid])
  where employee_id in ('85000000-0000-0000-0000-000000000003', '85000000-0000-0000-0000-000000000004')), 0,
  'future or previous approval steps never supply names');
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::integer from public.app_mt_dashboard_role_owners(array['85000000-0000-0000-0000-000000000010'::uuid, '85000000-0000-0000-0000-000000000011'::uuid])), 0,
  'an unrelated active employee cannot discover owners using guessed request IDs');
reset role;
update public.employees set is_active = false where id = '85000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$ select * from public.app_mt_dashboard_role_owners('{}') $$, 'P0001', 'EMPLOYEE_NOT_FOUND', 'inactive accounts are rejected');
reset role;
select * from finish();
rollback;
