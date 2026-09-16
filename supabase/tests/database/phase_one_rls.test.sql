begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

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

select * from finish();
rollback;
