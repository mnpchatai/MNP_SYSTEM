-- ตำแหน่ง "ผู้ช่วยผู้จัดการแผนก": มีอยู่, เรียงอยู่ใต้ผู้จัดการแผนก, สิทธิ์เท่ากับผู้จัดการแผนก
begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select results_eq(
  $$ select name_th from public.roles where code = 'assistant_department_manager' $$,
  array['ผู้ช่วยผู้จัดการแผนก'],
  'assistant_department_manager role exists'
);
select ok(
  (select a.sort_order from public.roles a where a.code = 'assistant_department_manager')
    > (select d.sort_order from public.roles d where d.code = 'department_manager')
  and (select a.sort_order from public.roles a where a.code = 'assistant_department_manager')
    < (select s.sort_order from public.roles s where s.code = 'staff'),
  'sorted between department_manager and staff'
);
select is_empty(
  $$ select rp.permission_id from public.role_permissions rp
       join public.roles r on r.id = rp.role_id and r.code = 'department_manager'
     except
     select rp.permission_id from public.role_permissions rp
       join public.roles r on r.id = rp.role_id and r.code = 'assistant_department_manager' $$,
  'has every permission department_manager has'
);
select is_empty(
  $$ select p.code from public.role_permissions rp
       join public.roles r on r.id = rp.role_id and r.code = 'assistant_department_manager'
       join public.permissions p on p.id = rp.permission_id
     where p.code in ('accounts.manage', 'requests.view_all') $$,
  'has no admin-level or view-all permission'
);

select * from finish();
rollback;
