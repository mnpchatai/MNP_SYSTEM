-- ทดสอบ public.app_create_machine (20261006020000_app_create_machine.sql)
--   1) ผู้แจ้งที่มีสิทธิ์ requests.create เพิ่มเครื่องได้ รหัสถูกปรับรูป (ตัวพิมพ์ใหญ่ ยุบช่องว่าง) และบันทึกผู้เพิ่ม + audit
--   2) รหัสซ้ำในแผนกเดียวกัน (ไม่สนตัวพิมพ์/ช่องว่าง) ไม่สร้างแถวใหม่ คืนเครื่องเดิม ไม่แก้ชื่อเดิม
--   3) แผนกอื่นใช้รหัสเดียวกันได้ ตัวเลือกพิเศษ "สร้างใหม่"/"ไม่มี" เป็นรหัสไม่ได้ ข้อมูลผิดรูปถูกปฏิเสธ
--   4) ไม่ล็อกอิน/ไม่ใช่พนักงาน/แผนกที่ไม่ใช่แผนกแจ้งซ่อมถูกปฏิเสธ และเขียนตาราง machines ตรงไม่ได้
--   5) เครื่องที่เพิ่มแล้วเลือกในใบแจ้งซ่อมได้ ใบเก็บรหัสและชื่อเครื่อง
begin;

create extension if not exists pgtap with schema extensions;
select plan(21);

select has_function('public', 'app_create_machine', array['uuid', 'text', 'text'], 'public.app_create_machine exists');

-- ผู้ใช้ทดสอบ: พนักงานสาธิต (มี requests.create) และ auth user ที่ไม่ผูกกับพนักงาน
insert into auth.users (id, email, raw_user_meta_data) values
  ('75000000-0000-0000-0000-000000000001', 'newmachine-staff@mnp.local', '{}'::jsonb),
  ('75000000-0000-0000-0000-000000000002', 'newmachine-unmapped@mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '75000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

-- 1. ไม่ล็อกอิน / ไม่ใช่พนักงาน ---------------------------------------------------
set local role anon;
select throws_ok(
  $$ select * from public.app_create_machine('00000000-0000-0000-0000-000000000000', 'H-HL2-1', 'รถยกลากพาเลส') $$,
  '42501',
  null,
  'anon cannot execute app_create_machine'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'H-HL2-1', 'รถยกลากพาเลส') $$,
  'NOT_AUTHORIZED',
  'an account that is not mapped to an active employee cannot add a machine'
);

-- 2. เพิ่มเครื่องใหม่ ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select code, name, existed
     from public.app_create_machine((select id from public.departments where code = 'ST'), '  h-hl2-1 ', '  รถยกลาก   พาเลส ') $$,
  $$ values ('H-HL2-1'::text, 'รถยกลาก พาเลส'::text, false) $$,
  'a new code is normalised (upper case, collapsed spaces) and created'
);
select results_eq(
  $$ select m.is_active, m.is_placeholder, m.created_by
     from public.machines m join public.departments d on d.id = m.department_id
     where d.code = 'ST' and m.code = 'H-HL2-1' $$,
  $$ values (true, false, '50000000-0000-0000-0000-000000000003'::uuid) $$,
  'the new machine is active, not a placeholder, and records who added it'
);

-- 3. รหัสซ้ำในแผนกเดียวกันไม่สร้างแถวใหม่ -------------------------------------------
select results_eq(
  $$ select code, name, existed
     from public.app_create_machine((select id from public.departments where code = 'ST'), 'H-HL2 -1', 'ชื่ออื่น') $$,
  $$ values ('H-HL2-1'::text, 'รถยกลาก พาเลส'::text, true) $$,
  'the same code typed differently returns the existing machine and keeps its name'
);
select is(
  (select count(*)::integer from public.machines m join public.departments d on d.id = m.department_id
   where d.code = 'ST' and m.code = 'H-HL2-1'),
  1,
  'no duplicate row was created for the repeated code'
);
select results_eq(
  $$ select code, existed
     from public.app_create_machine((select id from public.departments where code = 'RB'), 'a-au1-1', 'เครื่องผสมยาง') $$,
  $$ values ('A-AU 1-1'::text, true) $$,
  'a code from the imported register matches regardless of case and spaces'
);
select results_eq(
  $$ select code, existed
     from public.app_create_machine((select id from public.departments where code = 'RB'), 'H-HL2-1', 'รถยกลาก พาเลส') $$,
  $$ values ('H-HL2-1'::text, false) $$,
  'another department can use the same code as its own machine'
);

-- 4. ข้อมูลที่ต้องปฏิเสธ -------------------------------------------------------------
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'ไม่มี', 'ไม่มี') $$,
  'MACHINE_CODE_RESERVED',
  'the "ไม่มี" placeholder cannot be used as a code'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'สร้างใหม่', 'สร้างใหม่') $$,
  'MACHINE_CODE_RESERVED',
  'the "สร้างใหม่" placeholder cannot be used as a code'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'A', 'รถยกลากพาเลส') $$,
  'INVALID_MACHINE_CODE',
  'a one-character code is rejected'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), '-AB1', 'รถยกลากพาเลส') $$,
  'INVALID_MACHINE_CODE',
  'a code starting with a symbol is rejected'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'AB;1', 'รถยกลากพาเลส') $$,
  'INVALID_MACHINE_CODE',
  'a code with disallowed characters is rejected'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'ST'), 'H-HL3-1', 'x') $$,
  'INVALID_MACHINE_NAME',
  'a one-character name is rejected'
);
select throws_ok(
  $$ select * from public.app_create_machine((select id from public.departments where code = 'IT'), 'H-HL3-1', 'รถยกลากพาเลส') $$,
  'DEPARTMENT_NOT_REPAIR_SITE',
  'a department that is not a repair site is rejected'
);
select throws_ok(
  $$ insert into public.machines (code, name, department_id)
     values ('H-HL4-1', 'เพิ่มตรง', (select id from public.departments where code = 'ST')) $$,
  '42501',
  null,
  'authenticated users cannot write machines directly'
);

-- 5. เครื่องที่เพิ่มแล้วใช้ในใบแจ้งซ่อมได้ -------------------------------------------
select is(
  (select count(*)::integer from public.machines where code = 'H-HL2-1'),
  2,
  'the added machines are visible to authenticated users through the normal read policy'
);
select lives_ok(
  $$ select public.app_create_repair_request(
       (select id from public.departments where code = 'ST'),
       (select m.id from public.machines m join public.departments d on d.id = m.department_id
        where d.code = 'ST' and m.code = 'H-HL2-1'),
       'repair', 'MCREATE ใบแจ้งซ่อมที่ใช้เครื่องที่เพิ่มเอง') $$,
  'a repair request can be filed against the machine the user added'
);
reset role;

select results_eq(
  $$ select machine_code, machine_name from public.requests where description like 'MCREATE%' $$,
  $$ values ('H-HL2-1'::text, 'รถยกลาก พาเลส'::text) $$,
  'the request stores the code and name of the added machine'
);
select is(
  (select count(*)::integer from public.audit_logs
   where entity_type = 'machines' and action = 'INSERT' and metadata->'new'->>'code' = 'H-HL2-1'),
  2,
  'each added machine is recorded in the audit log'
);

select * from finish();
rollback;
