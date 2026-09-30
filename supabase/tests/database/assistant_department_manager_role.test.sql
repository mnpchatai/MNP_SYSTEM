-- ตำแหน่ง "ผู้ช่วยผู้จัดการแผนก": มีอยู่, เรียงอยู่ใต้ผู้จัดการแผนก, สิทธิ์เท่ากับผู้จัดการแผนก
begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

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

-- ทำแทนผู้จัดการแผนกได้ในฟังก์ชันที่ตรวจ role code (ต้องไม่เหลือนิยามที่รู้จักแค่ department_manager)
select unlike(
  pg_get_functiondef('private.owning_department_managers(uuid)'::regprocedure),
  '%code = ''department_manager''%',
  'owning_department_managers no longer matches department_manager alone'
);
select like(
  pg_get_functiondef('private.owning_department_managers(uuid)'::regprocedure),
  '%assistant_department_manager%',
  'owning_department_managers includes assistant_department_manager'
);
select like(
  pg_get_functiondef('public.app_start_repair_work(uuid)'::regprocedure),
  '%assistant_department_manager%',
  'app_start_repair_work allows assistant_department_manager'
);
select like(
  pg_get_functiondef('private.can_access_request(uuid)'::regprocedure),
  '%assistant_department_manager%',
  'can_access_request allows assistant_department_manager'
);

select * from finish();
rollback;
