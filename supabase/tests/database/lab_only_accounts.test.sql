-- ทดสอบบัญชีที่เห็นเฉพาะ MNP LAB (20261019010000_lab_only_accounts.sql)
--   1) โครงสร้าง: รายชื่อ ID, ทุก RPC ที่เรียกได้มีด่านหรืออยู่ในรายการอนุญาต, ทุกตารางมี policy ปิด, Storage
--   2) พฤติกรรม: บัญชี lab-only เข้า LAB ได้ แต่ RPC/ตาราง/ไฟล์ของโมดูลอื่นถูกปฏิเสธ แม้ตั้งบทบาท admin ให้
--   3) ผู้ใช้อื่น (staff, admin, ID คล้ายกันที่ไม่อยู่ในรายชื่อ) ไม่ได้รับผลกระทบ
begin;

create extension if not exists pgtap with schema extensions;
select plan(57);

-- 1. โครงสร้าง ------------------------------------------------------------------
select is(
  private.lab_only_employee_nos(), array['MNPLAB001', 'MNPLAB002'],
  'the lab-only account list is MNPLAB001 and MNPLAB002'
);
select is(
  (select count(*)::integer from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype
     and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname <> all (private.lab_only_allowed_functions())
     and pg_get_functiondef(p.oid) not like '%private.lab_only_block()%'),
  0,
  'every public function a signed-in user can call has the lab-only guard or is listed in private.lab_only_allowed_functions() — add "perform private.lab_only_block();" after begin when you add or replace one'
);
select is(
  (select count(*)::integer from unnest(private.lab_only_allowed_functions()) as f(name)
   where not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f.name)),
  0,
  'every function named in private.lab_only_allowed_functions() exists (no typo)'
);
select is(
  (select count(*)::integer from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
     and c.relname <> all (private.lab_only_open_tables())
     and not exists (
       select 1 from pg_policy pol
       where pol.polrelid = c.oid and pol.polname = 'lab_only_no_access' and not pol.polpermissive
     )),
  0,
  'every public table has the restrictive lab_only_no_access policy or is listed in private.lab_only_open_tables() — call private.lab_only_guard_table when you add a table'
);
select is(
  (select count(*)::integer from unnest(private.lab_only_open_tables()) as t(name)
   where not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = t.name)),
  0,
  'every table named in private.lab_only_open_tables() exists (no typo)'
);
select is(
  (select count(*)::integer from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity),
  0,
  'row level security is enabled on every public table'
);
select ok(
  exists (select 1 from pg_policy where polrelid = 'public.employees'::regclass and polname = 'lab_only_own_row' and not polpermissive),
  'employees has the restrictive own-row policy'
);
select ok(
  exists (select 1 from pg_policy where polrelid = 'storage.objects'::regclass and polname = 'lab_only_no_files' and not polpermissive),
  'storage objects have the restrictive lab-only policy'
);
select ok(
  not has_function_privilege('anon', 'public.app_lab_only()', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_only()', 'execute'),
  'app_lab_only is for signed-in users only'
);
select ok(
  not has_function_privilege('authenticated', 'private.can_access_lab()', 'execute')
    and not has_function_privilege('authenticated', 'private.lab_only_employee_nos()', 'execute'),
  'the access rule and the account list are not callable through the Data API'
);

-- 2. ผู้ใช้ทดสอบ -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'mnplab001@pilot.mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000002', 'mnplab002@pilot.mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000003', 'mnplab003@pilot.mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000004', 'lab-staff@pilot.mnp.local', '{}'::jsonb),
  ('82000000-0000-0000-0000-000000000005', 'lab-admin@pilot.mnp.local', '{}'::jsonb);

-- MNPLAB001 = พนักงานทั่วไป, MNPLAB002 = ถูกตั้งบทบาท admin (ID ต้องชนะบทบาท), MNPLAB003 ไม่อยู่ในรายชื่อ
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('82000000-0000-0000-0000-000000000011', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001@pilot.mnp.local', 'LAB',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000012', 'MNPLAB002', 'แล็บ', 'สอง', 'mnplab002@pilot.mnp.local', 'LAB',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000004', '82000000-0000-0000-0000-000000000002'),
  ('82000000-0000-0000-0000-000000000013', 'MNPLAB003', 'แล็บ', 'สาม', 'mnplab003@pilot.mnp.local', 'LAB',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000003');
update public.employees set auth_user_id = '82000000-0000-0000-0000-000000000004' where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '82000000-0000-0000-0000-000000000005' where id = '50000000-0000-0000-0000-000000000001';

-- ข้อมูลของโมดูลอื่นที่พนักงานทั่วไปเห็นได้ (seed.sql มีคำร้องของ MNP0102) และไฟล์ใน Storage
-- MNPLAB001 เป็น "เจ้าของคำร้อง" ของตนเอง 1 ใบ: ถ้าไม่มี policy ปิด สิทธิ์ปกติจะให้เห็น/เขียนใบนี้ได้ จึงพิสูจน์ได้ว่าด่านทำงานจริง
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description)
values ('82000000-0000-0000-0000-000000000021', 'lab-own-1', '40000000-0000-0000-0000-000000000002',
        '82000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000007', 'คำร้องของ LAB', 'คำร้องของ LAB');
insert into storage.buckets (id, name, public) values ('employee-photos', 'employee-photos', true)
on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner_id) values
  ('request-attachments', '60000000-0000-0000-0000-000000000001/doc.pdf', '82000000-0000-0000-0000-000000000004'),
  ('request-attachments', '82000000-0000-0000-0000-000000000021/own.pdf', '82000000-0000-0000-0000-000000000001'),
  ('employee-photos', '82000000-0000-0000-0000-000000000011/photo.jpg', '82000000-0000-0000-0000-000000000001');

-- 3. MNPLAB001: เข้า LAB ได้ -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.app_lab_access(), true, 'MNPLAB001 has access to MNP LAB');
select is(public.app_lab_only(), true, 'MNPLAB001 is a lab-only account');
select is(public.app_lab_mooney_results('NO-SUCH-MATERIAL'), '[]'::jsonb, 'MNPLAB001 can read LAB data');
select lives_ok($$ select * from public.app_my_approval_modules() $$, 'the sidebar module lookup still works');
select lives_ok(
  $$ select public.app_update_own_profile('แล็บ', 'หนึ่ง (แก้ไข)', 'mnplab001@pilot.mnp.local', '0800000000', 'LAB') $$,
  'MNPLAB001 can edit their own profile'
);
select is(
  (select last_name from public.employees where employee_no = 'MNPLAB001'),
  'หนึ่ง (แก้ไข)', 'the profile edit was saved'
);

-- ปิดทุกโมดูลอื่นที่ RPC
select throws_ok($$ select public.app_peek_request_number('40000000-0000-0000-0000-000000000002') $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot use the request RPCs (peek number)');
select throws_ok($$ select * from public.app_request_status_board(null, null, 10) $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot read the organisation status board');
select throws_ok($$ select public.app_factory_master_data() $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot read the factory module');
select throws_ok($$ select public.app_create_request('40000000-0000-0000-0000-000000000001', 'หัวข้อทดสอบ', 'รายละเอียดทดสอบ', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot create a request');
select throws_ok($$ select * from public.app_list_credentials() $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot list accounts (SQL-language function is guarded too)');
select throws_ok($$ select public.app_sandbox_status() $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB001 cannot use admin tools');

-- ปิดทุกตารางที่ Data API
select is((select count(*)::integer from public.requests), 0, 'MNPLAB001 sees no requests, not even one they filed themselves');
select is((select count(*)::integer from public.request_types), 0, 'MNPLAB001 sees no request types (module list)');
select is((select count(*)::integer from public.notifications), 0, 'MNPLAB001 sees no notifications');
select is((select count(*)::integer from public.ncr_reports), 0, 'MNPLAB001 sees no NCR reports');
select is((select count(*)::integer from public.employees), 1, 'MNPLAB001 sees only their own employee row');
select is(
  (select e.employee_no || '/' || r.code || '/' || d.code
   from public.employees e join public.roles r on r.id = e.role_id join public.departments d on d.id = e.department_id),
  'MNPLAB001/staff/OPS', 'the profile lookup with role and department still works'
);
select throws_ok(
  $$ insert into public.request_comments (request_id, author_id, body)
     values ('82000000-0000-0000-0000-000000000021', '82000000-0000-0000-0000-000000000011', 'ไม่ควรเขียนได้') $$,
  '42501', null, 'MNPLAB001 cannot write to another module through the Data API (even on their own request)'
);

-- Storage: ไฟล์ของโมดูลอื่นปิด เหลือรูปโปรไฟล์
select is((select count(*)::integer from storage.objects where bucket_id = 'request-attachments'), 0,
  'MNPLAB001 cannot see request attachments, not even those of their own request');
select is((select count(*)::integer from storage.objects where bucket_id = 'employee-photos'), 1,
  'MNPLAB001 can still see profile photos');
select throws_ok(
  $$ insert into storage.objects (bucket_id, name, owner_id)
     values ('request-attachments', '82000000-0000-0000-0000-000000000021/y.pdf', '82000000-0000-0000-0000-000000000001') $$,
  '42501', null, 'MNPLAB001 cannot upload an attachment (even to their own request)'
);
reset role;

-- 4. MNPLAB002: บทบาท admin แต่ยังเห็นเฉพาะ LAB -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

select is(public.app_lab_access(), true, 'MNPLAB002 has access to MNP LAB');
select is(public.app_lab_only(), true, 'MNPLAB002 is a lab-only account even with the admin role');
select throws_ok($$ select * from public.app_list_credentials() $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB002 cannot use admin tools although the role is admin');
select throws_ok($$ select public.app_factory_master_data() $$,
  'LAB_ONLY_ACCOUNT', 'MNPLAB002 cannot read the factory module although the role is admin');
select is((select count(*)::integer from public.requests), 0, 'MNPLAB002 sees no requests although the role is admin');
select is((select count(*)::integer from public.audit_logs), 0, 'MNPLAB002 cannot read the audit trail although the role is admin');
select is((select count(*)::integer from public.employees), 1, 'MNPLAB002 sees only their own employee row');
reset role;

-- 5. ID ตัวพิมพ์เล็ก และบัญชีที่ถูกปิด (fail-closed) ----------------------------------------
update public.employees set employee_no = 'mnplab001' where id = '82000000-0000-0000-0000-000000000011';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_only(), true, 'the account list matches the ID in any letter case');
reset role;
update public.employees set employee_no = 'MNPLAB001' where id = '82000000-0000-0000-0000-000000000011';

update public.employees set is_active = false where id = '82000000-0000-0000-0000-000000000011';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'a deactivated lab-only account has no LAB access');
select throws_ok($$ select public.app_factory_master_data() $$,
  'LAB_ONLY_ACCOUNT', 'a deactivated lab-only account is still shut out of every other module');
reset role;
update public.employees set is_active = true where id = '82000000-0000-0000-0000-000000000011';

-- 6. ผู้ใช้อื่นไม่ได้รับผลกระทบ ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_lab_only(), false, 'MNPLAB003 is not on the list so it is not lab-only');
select is(public.app_lab_access(), false, 'MNPLAB003 has no LAB access either');
select lives_ok($$ select public.app_peek_request_number('40000000-0000-0000-0000-000000000002') $$,
  'MNPLAB003 keeps the normal employee rights');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_lab_only(), false, 'a regular employee is not lab-only');
select is(public.app_lab_access(), false, 'a regular employee still has no LAB access');
select lives_ok($$ select public.app_peek_request_number('40000000-0000-0000-0000-000000000002') $$,
  'a regular employee can still call the request RPCs');
select cmp_ok((select count(*)::integer from public.requests), '>', 0, 'a regular employee still sees their requests');
select cmp_ok((select count(*)::integer from public.employees), '>', 1, 'a regular employee still sees the employee directory');
select is((select count(*)::integer from storage.objects where bucket_id = 'request-attachments'), 1,
  'a regular employee still sees request attachments');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.app_lab_only(), false, 'an admin is not lab-only');
select is(public.app_lab_access(), true, 'an admin still has LAB access');
select lives_ok($$ select * from public.app_list_credentials() $$, 'an admin can still use admin tools');
select lives_ok($$ select * from public.app_request_status_board(null, null, 10) $$, 'an admin can still read the organisation status board');
reset role;

-- 7. ผู้ที่ไม่ได้ล็อกอิน ---------------------------------------------------------------
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.app_lab_only() $$, '42501', null, 'anon cannot check the lab-only flag');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_only() $$, 'AUTH_REQUIRED', 'a session without a user id is asked to sign in');
reset role;

select * from finish();
rollback;
