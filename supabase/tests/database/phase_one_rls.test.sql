begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.requests'::regclass),
  'requests has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.employees'::regclass),
  'employees has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.request_attachments'::regclass),
  'attachments has RLS enabled'
);
select ok(
  not has_table_privilege('anon', 'public.requests', 'SELECT'),
  'anonymous users cannot select requests'
);
select ok(
  not has_table_privilege('anon', 'public.requests', 'INSERT'),
  'anonymous users cannot create requests'
);
select ok(
  not has_table_privilege('authenticated', 'public.requests', 'DELETE'),
  'authenticated users cannot delete requests directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.requests', 'INSERT'),
  'authenticated users cannot insert requests directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.requests', 'UPDATE'),
  'authenticated users cannot update requests directly'
);
select ok(
  not has_function_privilege('anon', 'public.app_request_status_board(text, text, integer)', 'EXECUTE'),
  'anonymous users cannot read the request status board'
);
select ok(
  has_function_privilege('authenticated', 'public.app_request_status_board(text, text, integer)', 'EXECUTE'),
  'authenticated users can read the request status board'
);

insert into auth.users (id, email, raw_user_meta_data)
values ('70000000-0000-0000-0000-000000000001', 'rls-employee@mnp.local', '{}'::jsonb);
update public.employees
set auth_user_id = '70000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.requests
  (id, request_type_id, requester_id, department_id, title, description, last_changed_by)
values
  ('60000000-0000-0000-0000-000000000099',
   '40000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000002',
   '10000000-0000-0000-0000-000000000007',
   'Outsider request', 'Must not be accessible to the employee',
   '50000000-0000-0000-0000-000000000002');

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"70000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select results_eq(
  $$ select count(*)::bigint from public.requests $$,
  array[2::bigint],
  'employee can read only their accessible demo requests'
);

select lives_ok(
  $$ insert into public.request_comments(request_id, author_id, body)
     values ('60000000-0000-0000-0000-000000000001',
             '50000000-0000-0000-0000-000000000003',
             'Allowed owner comment') $$,
  'employee can comment on an accessible request'
);

select throws_ok(
  $$ insert into public.request_comments(request_id, author_id, body)
     values ('60000000-0000-0000-0000-000000000099',
             '50000000-0000-0000-0000-000000000003',
             'Blocked outsider comment') $$,
  '42501',
  null,
  'employee cannot comment on an inaccessible request'
);

-- กระดานติดตามสถานะ: พนักงานคนนี้เข้าถึงคำร้อง 'Outsider request' ตาม RLS ไม่ได้
-- แต่ต้องยังเห็นสถานะของใบนั้นบนกระดาน โดยเปิดดูรายละเอียดเต็มไม่ได้ (can_open = false)
-- อ้างด้วย id ตรง ๆ เพราะการ select จาก public.requests ตอนนี้ถูก RLS กรองใบนั้นออกไปแล้ว
select results_eq(
  $$ select count(*)::bigint from public.app_request_status_board()
     where id = '60000000-0000-0000-0000-000000000099' $$,
  array[1::bigint],
  'status board shows a request the employee cannot otherwise read'
);

select results_eq(
  $$ select can_open from public.app_request_status_board()
     where id = '60000000-0000-0000-0000-000000000099' $$,
  array[false],
  'status board marks an inaccessible request as not openable'
);

select ok(
  exists (
    select 1 from public.app_request_status_board() b
    where not exists (select 1 from public.requests r where r.id = b.id)
  ),
  'status board exposes status for requests RLS hides from this employee'
);

select * from finish();
rollback;
