-- BOM / RubberFlow ใช้ได้เฉพาะโหมดทดสอบ (20261201010000_bom_rf_sandbox_lock.sql): สวิตช์ private.bom_real_open() ปิดอยู่
-- นอกโหมดทดสอบทุกคน (พนักงานจริง ผู้จัดการ admin) ได้ BOM_TEST_MODE_ONLY / RF_TEST_MODE_ONLY ทุก RPC · ไม่มี session ยังเป็น AUTH_REQUIRED · anon ยังเรียกไม่ได้
-- โหมดทดสอบ (admin สวม persona) ใช้ได้เหมือนเดิม
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. สวิตช์และสิทธิ์ ------------------------------------------------------------------------------------
select is(private.bom_real_open(), false, 'the real-use switch is closed');
select ok(not has_function_privilege('anon', 'private.bom_real_open()', 'execute')
      and not has_function_privilege('authenticated', 'private.bom_real_open()', 'execute'), 'clients cannot call the switch');
select is((select count(*)::integer from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_actor', 'rf_actor')
           and p.prosecdef and p.proconfig @> array['search_path=""'] and p.prosrc like '%if not private.bom_real_open() then%'), 2,
  'both actors check the switch and stay security definer with an empty search_path');

-- 2. บัญชีจริง: admin, ผู้วางแผน PP, ผู้จัดการโรงงาน, พนักงาน RB ------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8eb00000-0000-0000-0000-000000000001', 'lock-admin@test.local', '{}'),
  ('8eb00000-0000-0000-0000-000000000002', 'lock-pp@test.local', '{}'),
  ('8eb00000-0000-0000-0000-000000000003', 'lock-fm@test.local', '{}'),
  ('8eb00000-0000-0000-0000-000000000004', 'lock-rb@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('8eb00000-0000-0000-0000-000000000101', 'LOCK-ADMIN', 'Lock', 'Admin', 'lock-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8eb00000-0000-0000-0000-000000000001', true),
  ('8eb00000-0000-0000-0000-000000000102', 'LOCK-PP', 'Lock', 'PP', 'lock-pp@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8eb00000-0000-0000-0000-000000000002', true),
  ('8eb00000-0000-0000-0000-000000000103', 'LOCK-FM', 'Lock', 'FM', 'lock-fm@test.local', 'Factory manager',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '8eb00000-0000-0000-0000-000000000003', true),
  ('8eb00000-0000-0000-0000-000000000104', 'LOCK-RB', 'Lock', 'RB', 'lock-rb@test.local', 'RB',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '8eb00000-0000-0000-0000-000000000004', true);
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.employee_no like 'LOCK-%'), 4, 'every real account has its department and role');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. anon และไม่มี session เหมือนเดิม -------------------------------------------------------------------------
set local role anon;
select throws_ok('select public.app_bom_master()', '42501', null, 'anon cannot call the BOM read');
select throws_ok('select public.app_rf_master()', '42501', null, 'anon cannot call the RubberFlow read');
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'AUTH_REQUIRED', 'BOM still requires a session');
select throws_ok('select public.app_rf_master()', 'AUTH_REQUIRED', 'RubberFlow still requires a session');

-- 4. นอกโหมดทดสอบทุกคนถูกปฏิเสธทุก RPC ----------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read BOM');
select throws_ok('select public.app_bom_master_since(0)', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read the BOM delta');
select throws_ok('select public.app_bom_audit()', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read the BOM audit');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot save BOM');
select throws_ok('select public.app_rf_master()', 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot read RubberFlow');
select throws_ok('select public.app_rf_master_since(0)', 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot read the RubberFlow delta');
select throws_ok('select public.app_rf_audit()', 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot read the RubberFlow audit');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot save RubberFlow');

select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_TEST_MODE_ONLY', 'a real PP planner cannot read BOM');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_TEST_MODE_ONLY', 'a real PP planner cannot save BOM');
select throws_ok('select public.app_rf_master()', 'RF_TEST_MODE_ONLY', 'a real PP planner cannot read RubberFlow');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_TEST_MODE_ONLY', 'a real PP planner cannot save RubberFlow');

select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_TEST_MODE_ONLY', 'a real factory manager cannot read BOM');
select throws_ok('select public.app_rf_audit()', 'RF_TEST_MODE_ONLY', 'a real factory manager cannot read the RubberFlow audit');

select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master_since(0)', 'BOM_TEST_MODE_ONLY', 'a real RB staff cannot read the BOM delta');
select throws_ok('select public.app_rf_master()', 'RF_TEST_MODE_ONLY', 'a real RB staff cannot read RubberFlow');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_TEST_MODE_ONLY', 'a real RB staff cannot save RubberFlow');

-- 5. โหมดทดสอบใช้ได้เหมือนเดิม -----------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok('select public.app_bom_master()', 'in test mode the PP persona reads BOM');
select lives_ok('select public.app_bom_audit()', 'in test mode the PP persona reads the BOM audit');
select lives_ok($$ select public.app_bom_save_master('{}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveItem') $$, 'in test mode the PP persona may save BOM');
select lives_ok('select public.app_rf_master()', 'in test mode the PP persona reads RubberFlow');
select lives_ok($$ select public.app_rf_save('{}'::jsonb, (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial') $$, 'in test mode the PP persona may save RubberFlow');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok('select public.app_rf_master_since(0)', 'in test mode the RB persona reads the RubberFlow delta');

-- 6. สวิตช์เปิด = กฎใช้งานจริงของ 20261130010000 (ทดสอบละเอียดใน bom_rf_go_live.test.sql) ---------------------------------
reset role;
create or replace function private.bom_real_open() returns boolean language sql stable set search_path = '' as $$ select true $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok('select public.app_bom_master()', 'with the switch open a real PP planner reads BOM again');
select set_config('request.jwt.claims', '{"sub":"8eb00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok('select public.app_rf_master()', 'with the switch open a real RB staff reads RubberFlow again');

reset role;
select * from finish();
rollback;
