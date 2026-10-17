-- ทดสอบ migration 20261017020000_add_indesign_repair_department
--   - แผนก ID (Indesign) active และเป็นแผนกที่แจ้งซ่อมได้ มีแถวเดียว
--   - มีตัวเลือก "สร้างใหม่" กับ "ไม่มี" อย่างละหนึ่งแถว และยังไม่มีเครื่องจักรจริง
--   - ตัวนับเลขที่ใบปี 26 เริ่มที่ 0 ดูเลขตัวอย่างได้เป็น ID001/26
--   - ผู้แจ้งสร้างใบแจ้งซ่อมของ ID ได้จนได้เลขที่ ID001/yy และเดินเข้าสายอนุมัติปกติ (ไม่ต้องมี ผจก. ID)
--   - ใบของแผนกอื่นเลือกเครื่องของ ID ไม่ได้ (ยังกันข้ามแผนก)
--   - แผนกที่แจ้งซ่อมได้เดิมไม่เปลี่ยน และตัวเลือกของแผนกอื่นไม่ถูกแตะ
begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

select is(
  (select count(*)::integer from public.departments
   where code = 'ID' and name_th = 'Indesign' and is_active and is_repair_site),
  1,
  'ID (Indesign) is one active repair-site department'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ID' and m.is_placeholder and m.is_active
     and m.code in ('สร้างใหม่', 'ไม่มี')),
  2,
  'ID has the "สร้างใหม่" and "ไม่มี" placeholders'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ID' and not m.is_placeholder),
  0,
  'ID has no real machine until one is registered'
);

select is(
  (select last_number from public.document_counters
   where department_code = 'ID' and year_key = '26'),
  0,
  'the ID 2026 counter starts at 0'
);

select is(
  (select count(*)::integer from public.departments where is_repair_site and code <> 'ID'),
  12,
  'the original 12 repair-site departments are unchanged'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code <> 'ID' and d.is_repair_site and m.is_placeholder and m.code in ('สร้างใหม่', 'ไม่มี')),
  24,
  'every other repair site keeps exactly its own two placeholders'
);

-- ผู้แจ้งสร้างใบแจ้งซ่อมของ ID ได้ เลขที่ใบเดินจาก ID001/yy
insert into auth.users (id, email, raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'indesign-requester@mnp.local', '{}'::jsonb);
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id)
values ('83000000-0000-0000-0000-000000000011', 'ID-REQ-1', 'ทดสอบ', 'Indesign', 'indesign-requester@mnp.local',
        (select id from public.departments where code = 'ID'),
        '20000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);

select is(
  public.app_peek_repair_doc_number((select id from public.departments where code = 'ID')),
  'ID001/' || to_char(now() at time zone 'Asia/Bangkok', 'YY'),
  'the preview number for ID starts at 001'
);

select lives_ok($$ select public.app_create_repair_request(
  (select id from public.departments where code = 'ID'),
  (select m.id from public.machines m join public.departments d on d.id = m.department_id
   where d.code = 'ID' and m.is_placeholder and m.code = 'ไม่มี'),
  'repair', 'INDESIGN_NEW ใบแจ้งซ่อมแผนก Indesign สำหรับทดสอบ') $$,
  'an ID requester creates a repair request for the ID department');

reset role;

select is(
  (select r.request_no from public.requests r where r.description like 'INDESIGN_NEW%'),
  'ID001/' || to_char(now() at time zone 'Asia/Bangkok', 'YY'),
  'the new ID request gets number ID001/yy'
);

select is(
  (select count(*)::integer from public.approval_steps s
   join public.requests r on r.id = s.request_id
   join public.roles ro on ro.id = s.approver_role_id
   where r.description like 'INDESIGN_NEW%' and s.step_order = 1 and s.status = 'pending'
     and ro.code = 'factory_manager' and s.approver_department_id is null),
  1,
  'step 1 goes to the factory manager role (not tied to the ID department), so no ID manager is needed'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$ select public.app_create_repair_request(
  (select id from public.departments where code = 'MT'),
  (select m.id from public.machines m join public.departments d on d.id = m.department_id
   where d.code = 'ID' and m.is_placeholder and m.code = 'ไม่มี'),
  'repair', 'INDESIGN_CROSS ใบข้ามแผนกต้องถูกปฏิเสธ') $$,
  'MACHINE_NOT_FOUND', 'a machine of ID cannot be used on another department''s request');
reset role;

select * from finish();
rollback;
