-- ทดสอบรายชื่อ ID ที่เข้า MNP LAB ได้เพิ่มโดยไม่จำกัดโมดูลอื่น (20261219010000_lab_access_extra_ids.sql)
--   GODGAZ (staff) เข้า LAB ได้แบบดูอย่างเดียว (อัปโหลดไม่ได้) และยังใช้โมดูลอื่นตามปกติ · admin ยังอัปโหลดได้ · ถูกปิดใช้งานแล้วเข้าไม่ได้ · พนักงานอื่นยังเข้าไม่ได้
begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

-- 1. โครงสร้าง ------------------------------------------------------------------
select is(private.lab_access_employee_nos(), array['GODGAZ'], 'the extra LAB access list is GODGAZ');
select ok(
  not has_function_privilege('authenticated', 'private.lab_access_employee_nos()', 'execute')
    and not has_function_privilege('authenticated', 'private.is_lab_access_employee(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.is_lab_access_employee(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.can_access_lab()', 'execute'),
  'the list and the access rule are not callable through the Data API'
);
select ok(
  not has_function_privilege('authenticated', 'private.can_write_lab()', 'execute')
    and not has_function_privilege('anon', 'private.can_write_lab()', 'execute'),
  'the write rule is not callable through the Data API'
);
select ok(
  not has_function_privilege('anon', 'public.app_lab_can_write()', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_can_write()', 'execute'),
  'app_lab_can_write is for signed-in users only'
);

-- 2. ผู้ใช้ทดสอบ -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'godgaz@pilot.mnp.local', '{}'::jsonb),
  ('83000000-0000-0000-0000-000000000002', 'godgaz2@pilot.mnp.local', '{}'::jsonb),
  ('83000000-0000-0000-0000-000000000003', 'lab-write-admin@pilot.mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '83000000-0000-0000-0000-000000000003' where id = '50000000-0000-0000-0000-000000000001';

-- GODGAZ = staff (ตัวพิมพ์เล็กเพื่อพิสูจน์ว่าเทียบแบบไม่สนตัวพิมพ์), GODGAZ2 = ID คล้ายกันที่ไม่อยู่ในรายชื่อ
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('83000000-0000-0000-0000-000000000011', 'godgaz', 'ก็อด', 'แก๊ส', 'godgaz@pilot.mnp.local', 'QA',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001'),
  ('83000000-0000-0000-0000-000000000012', 'GODGAZ2', 'ก็อด', 'สอง', 'godgaz2@pilot.mnp.local', 'QA',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000002');

-- 3. GODGAZ เข้า LAB ได้ และไม่ใช่บัญชี lab-only ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_access(), true, 'GODGAZ has access to MNP LAB');
select is(public.app_lab_only(), false, 'GODGAZ is not a lab-only account');
select lives_ok($$ select public.app_lab_mdr_feed('F1') $$, 'GODGAZ can read the MDR feed');
select is(public.app_lab_can_write(), false, 'GODGAZ is view only');
select throws_ok($$ select public.app_lab_mdr_upload('[]'::jsonb) $$, 'NOT_AUTHORIZED', 'GODGAZ cannot upload MDR results');
select lives_ok($$ select public.app_peek_request_number('40000000-0000-0000-0000-000000000002') $$,
  'GODGAZ keeps the normal employee rights in other modules');
select cmp_ok((select count(*)::integer from public.employees), '>', 1, 'GODGAZ still sees the employee directory');
reset role;

-- 4. ถูกปิดใช้งานแล้วเข้าไม่ได้ -------------------------------------------------------------
update public.employees set is_active = false where id = '83000000-0000-0000-0000-000000000011';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'a deactivated GODGAZ has no LAB access');
select throws_ok($$ select public.app_lab_mdr_feed('F1') $$, 'NOT_AUTHORIZED', 'a deactivated GODGAZ cannot read the MDR feed');
reset role;
select is(private.is_lab_access_employee('83000000-0000-0000-0000-000000000011'), false,
  'the extra LAB access list itself ignores a deactivated employee');
update public.employees set is_active = true where id = '83000000-0000-0000-0000-000000000011';

-- 5. ผู้ใช้อื่นไม่ได้รับผลกระทบ ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'GODGAZ2 is not on the list so it has no LAB access');
select throws_ok($$ select public.app_lab_mdr_feed('F1') $$, 'NOT_AUTHORIZED', 'GODGAZ2 cannot read the MDR feed');
select is(public.app_lab_can_write(), false, 'GODGAZ2 cannot write in LAB either');
reset role;

-- admin ยังอัปโหลดได้: ผ่านด่านสิทธิ์แล้วไปติดที่การตรวจข้อมูล (รายการว่าง)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_lab_can_write(), true, 'an admin can still write in LAB');
select throws_ok($$ select public.app_lab_mdr_upload('[]'::jsonb) $$, 'LAB_MDR_INVALID_PAYLOAD', 'an admin passes the write check of the MDR upload');
reset role;

select ok(
  (select private.is_lab_access_employee(id) from public.employees where id = '50000000-0000-0000-0000-000000000003') = false,
  'a regular seed employee is not on the extra LAB access list'
);

select * from finish();
rollback;
