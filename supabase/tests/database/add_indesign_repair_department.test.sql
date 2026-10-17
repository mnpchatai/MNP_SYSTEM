-- ทดสอบ migration 20261017040000_add_indesign_repair_department
--   - แผนก ID (Indesign) active และเป็นแผนกที่แจ้งซ่อมได้ มีแถวเดียว
--   - มีตัวเลือก "สร้างใหม่" กับ "ไม่มี" อย่างละหนึ่งแถว และยังไม่มีเครื่องจักรจริง
--   - แผนกที่แจ้งซ่อมได้เดิม 12 แผนกยังมีธงและตัวเลือกของตัวเองครบ (เทียบรายชื่อรหัส ไม่เทียบยอดรวม
--     เพื่อไม่ให้พังเมื่อมี migration อื่นเพิ่มแผนกที่แจ้งซ่อมได้ในภายหลัง)
--   - ผู้แจ้งสร้างใบแจ้งซ่อมของ ID ได้จนได้เลขที่ ID001/yy และเดินเข้าสายอนุมัติปกติ (ไม่ต้องมี ผจก. ID)
--   - ใบของแผนกอื่นเลือกเครื่องของ ID ไม่ได้ (ยังกันข้ามแผนก)
--   - ย้อนกลับด้วย is_repair_site = false แล้วเปิดใบ/ดูเลขตัวอย่างของ ID ไม่ได้อีก
begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

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
  (select array_agg(d.code order by d.code) from public.departments d
   where d.is_repair_site and d.is_active
     and d.code in ('RB', 'GR', 'BG', 'PT', 'PK', 'QA', 'ST', 'WH', 'SR', 'FT', 'MT', 'AD')),
  array['AD', 'BG', 'FT', 'GR', 'MT', 'PK', 'PT', 'QA', 'RB', 'SR', 'ST', 'WH'],
  'the 12 original repair-site departments are still active repair sites'
);

select is(
  (select count(*)::integer from (
     select d.code
     from public.departments d
     join public.machines m on m.department_id = d.id
     where d.code in ('RB', 'GR', 'BG', 'PT', 'PK', 'QA', 'ST', 'WH', 'SR', 'FT', 'MT', 'AD')
       and m.is_placeholder and m.code in ('สร้างใหม่', 'ไม่มี')
     group by d.code
     having count(*) = 2
   ) own_placeholders),
  12,
  'each original repair site keeps exactly its own two placeholders'
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

-- ย้อนกลับตามที่เขียนไว้ใน migration: ถอดธงแล้ว ID เปิดใบและดูเลขตัวอย่างไม่ได้อีก
update public.departments set is_repair_site = false where code = 'ID';

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok($$ select public.app_peek_repair_doc_number((select id from public.departments where code = 'ID')) $$,
  'DEPARTMENT_NOT_REPAIR_SITE', 'after rollback the ID preview number is refused');
select throws_ok($$ select public.app_create_repair_request(
  (select id from public.departments where code = 'ID'),
  (select m.id from public.machines m join public.departments d on d.id = m.department_id
   where d.code = 'ID' and m.is_placeholder and m.code = 'ไม่มี'),
  'repair', 'INDESIGN_ROLLED_BACK ใบหลังย้อนกลับต้องถูกปฏิเสธ') $$,
  'DEPARTMENT_NOT_REPAIR_SITE', 'after rollback ID can no longer open repair requests');
reset role;

select * from finish();
rollback;
