-- ทดสอบข้อมูลยางเส้นของ MNP LAB (20261019010000_lab_strand_specs.sql)
--   1) โครงสร้าง: RLS, ไม่มีสิทธิ์ตรงบนตาราง, สิทธิ์เรียก RPC ของแต่ละบทบาท, ด่านโหมดทดสอบ
--   2) อนุญาต: admin เพิ่ม/อ่าน/แก้/ลบ ได้ ข้อมูลคงอยู่เมื่อชีตลบแถวผลทดสอบ ทุกการเปลี่ยนมี audit
--   3) ตรวจข้อมูล: ID ที่ไม่มีในผลทดสอบ, ขนาด/ช่วงสเปกผิด, บันทึกว่าง, version กันบันทึกทับ
--   4) ปฏิเสธ: พนักงานทั่วไป/admin ที่ถูกปิดบัญชี/ไม่มีข้อมูลพนักงาน/ไม่ล็อกอิน/บทบาทที่ถูกถอน
begin;

create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง ------------------------------------------------------------------
select has_table('public', 'lab_strand_specs', 'lab_strand_specs exists');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'lab_strand_specs'),
  'RLS is enabled on lab_strand_specs'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'lab_strand_specs' and grantee in ('anon', 'authenticated')
  ),
  'anon and authenticated have no direct grant on lab_strand_specs'
);
select ok(
  not (has_function_privilege('anon', 'public.app_lab_strand_specs(text)', 'execute')
    or has_function_privilege('anon', 'public.app_lab_strand_spec_save(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, integer)', 'execute')
    or has_function_privilege('anon', 'public.app_lab_strand_spec_delete(text, text, integer)', 'execute')),
  'anon cannot execute the strand spec RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.app_lab_strand_specs(text)', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_strand_spec_save(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, integer)', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_strand_spec_delete(text, text, integer)', 'execute'),
  'authenticated can execute the strand spec RPCs (they check the caller themselves)'
);
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.lab_strand_specs'::regclass and t.tgname = 'sandbox_guard' and not t.tgisinternal
  ),
  'lab_strand_specs is covered by the sandbox write guard'
);
select ok(
  not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.lab_strand_specs'::regclass and c.contype = 'f'
      and c.confrelid = 'public.lab_mooney_results'::regclass
  ),
  'there is no foreign key to the sheet mirror, so a sheet sync cannot delete these rows'
);

-- 2. เตรียมผู้ใช้: admin, พนักงานทั่วไป, admin ที่ถูกปิดบัญชี และผลทดสอบ 4 แถว ------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'strand-admin@mnp.local', '{}'::jsonb),
  ('83000000-0000-0000-0000-000000000002', 'strand-staff@mnp.local', '{}'::jsonb),
  ('83000000-0000-0000-0000-000000000003', 'strand-former-admin@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '83000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '83000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('83000000-0000-0000-0000-000000000004', 'STRAND-OLD-ADMIN', 'ทดสอบ', 'อดีตผู้ดูแล', 'strand-former-admin@mnp.local', 'System Administrator',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', '83000000-0000-0000-0000-000000000003', false);

insert into public.lab_mooney_results (source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes, mh, mv) values
  ('A1802', '111', 'A1802', '2026-09-21', '08:29:13', 100, 4, 50.79, 31.39),
  ('A1802', '112', 'A1802', '2026-09-21', '08:36:01', 100, 4, 49.95, 31.78),
  ('A1802', '113', 'A1802', '2026-09-21', '08:42:31', 100, 4, 50.24, 31.68),
  ('E00030S T', '111', 'E00030S T', '2026-09-23', '11:52:07', 145, 5, 32.14, 30.97);

-- 3. admin: อ่านตอนยังไม่มีข้อมูล และเพิ่มข้อมูล -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.app_lab_strand_specs('A1802'), '[]'::jsonb, 'a material with no strand data reads as an empty list');
select throws_ok($$ select public.app_lab_strand_specs('   ') $$, 'LAB_INVALID_MATERIAL', 'a blank material is rejected when reading');
select throws_ok($$ select public.app_lab_strand_specs(repeat('x', 61)) $$, 'LAB_INVALID_MATERIAL', 'an over-long material is rejected when reading');

select is(
  (public.app_lab_strand_spec_save('A1802', '111', 'PO-2610-001', 20.10, 3.05, 19.5, 20.5, 2.5, 3.5) ->> 'version')::integer,
  1, 'adding strand data creates version 1'
);
select is(
  (select jsonb_array_length(public.app_lab_strand_specs('A1802'))), 1, 'the new record is listed under its material'
);
select is(
  public.app_lab_strand_specs('E00030S T'), '[]'::jsonb, 'the same ID under another material is a separate (empty) record'
);
select is(
  (public.app_lab_strand_specs('A1802') -> 0 ->> 'order_no'), 'PO-2610-001', 'the order number is returned'
);
select is(
  (public.app_lab_strand_specs('A1802') -> 0 ->> 'outer_mm')::numeric, 20.10::numeric, 'the measured outer diameter is returned'
);
select is(
  (public.app_lab_strand_specs('A1802') -> 0 ->> 'inner_min_mm')::numeric, 2.50::numeric, 'the inner diameter spec limits are returned'
);

-- ID เดียวกันของอีกวัสดุ เป็นคนละข้อมูล และข้อความถูกตัดช่องว่างหัวท้าย
select is(
  public.app_lab_strand_spec_save(' E00030S T ', ' 111 ', '  PO-2610-002  ', null, null, null, null, null, null) ->> 'order_no',
  'PO-2610-002', 'text is trimmed and an order number alone is a valid record'
);
select is(
  jsonb_array_length(public.app_lab_strand_specs('A1802')) + jsonb_array_length(public.app_lab_strand_specs('E00030S T')),
  2, 'two records now exist, one per (material, ID)'
);

-- ใส่สเปกด้านเดียวได้ (เช่น วงนอกห้ามลบ มีเฉพาะค่าสูงสุด)
select is(
  (public.app_lab_strand_spec_save('A1802', '112', null, null, null, null, 21, 14.5, null) ->> 'outer_max_mm')::numeric,
  21.00::numeric, 'a one-sided spec is accepted'
);

-- 4. ตรวจข้อมูล -----------------------------------------------------------------------
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '999', 'PO-1', null, null, null, null, null, null) $$,
  'LAB_SAMPLE_NOT_FOUND', 'an ID that is not in the material test results cannot be attached'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('NO-SUCH', '111', 'PO-1', null, null, null, null, null, null) $$,
  'LAB_SAMPLE_NOT_FOUND', 'an unknown material cannot be attached'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '111', 'PO-X', null, null, null, null, null, null) $$,
  'LAB_SPEC_CONFLICT', 'adding data for an ID that already has data is refused instead of overwriting it'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('  ', '113', 'PO-1', null, null, null, null, null, null) $$,
  'LAB_INVALID_MATERIAL', 'a blank material is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '  ', 'PO-1', null, null, null, null, null, null) $$,
  'LAB_INVALID_SAMPLE', 'a blank ID is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', repeat('9', 31), 'PO-1', null, null, null, null, null, null) $$,
  'LAB_INVALID_SAMPLE', 'an over-long ID is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', repeat('P', 61), null, null, null, null, null, null) $$,
  'LAB_INVALID_ORDER', 'an over-long order number is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, 0, null, null, null, null, null) $$,
  'LAB_INVALID_SIZE', 'a size of zero is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, null, -1, null, null, null, null) $$,
  'LAB_INVALID_SIZE', 'a negative size is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, 20.123, null, null, null, null, null) $$,
  'LAB_INVALID_SIZE', 'a size with more than 2 decimals is rejected instead of being rounded silently'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, 100000, null, null, null, null, null) $$,
  'LAB_INVALID_SIZE', 'a size beyond the column range is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, 'NaN'::numeric, null, null, null, null, null) $$,
  'LAB_INVALID_SIZE', 'NaN is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, null, null, 20.5, 19.5, null, null) $$,
  'LAB_INVALID_SPEC_RANGE', 'an outer spec whose minimum is above its maximum is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, null, null, null, null, 3.5, 2.5) $$,
  'LAB_INVALID_SPEC_RANGE', 'an inner spec whose minimum is above its maximum is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', null, null, null, null, null, null, null) $$,
  'LAB_SPEC_EMPTY', 'a record with nothing filled in is rejected'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', '   ', null, null, null, null, null, null) $$,
  'LAB_SPEC_EMPTY', 'a blank order number counts as nothing filled in'
);
select is(
  (select count(*)::integer from jsonb_array_elements(public.app_lab_strand_specs('A1802')) e where e ->> 'sample_id' = '113'),
  0, 'rejected saves left no record behind'
);

-- 5. แก้ไข: version กันบันทึกทับ ----------------------------------------------------------
select is(
  (public.app_lab_strand_spec_save('A1802', '111', 'PO-2610-001', 20.20, 3.05, 19.5, 20.5, 2.5, 3.5, 1) ->> 'version')::integer,
  2, 'editing with the version that was seen bumps it to 2'
);
select is(
  (public.app_lab_strand_specs('A1802') -> 0 ->> 'outer_mm')::numeric, 20.20::numeric, 'the edited measurement replaced the old one'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '111', 'PO-2610-001', 20.30, 3.05, 19.5, 20.5, 2.5, 3.5, 1) $$,
  'LAB_SPEC_CONFLICT', 'editing with an out-of-date version is refused'
);
select is(
  (public.app_lab_strand_specs('A1802') -> 0 ->> 'outer_mm')::numeric, 20.20::numeric, 'the refused edit changed nothing'
);
select is(
  (public.app_lab_strand_spec_save('A1802', '111', 'PO-2610-001', 20.20, 3.05, 19.5, 20.5, 2.5, 3.5, 2) ->> 'version')::integer,
  2, 'saving values identical to the stored ones does not bump the version'
);
reset role;
select is(
  (select count(*)::integer from public.audit_logs where entity_type = 'lab_strand_specs' and action = 'LAB_STRAND_SPEC_UPDATE'),
  1, 'an unchanged save writes no audit row'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-3', null, null, null, null, null, null, 1) $$,
  'LAB_SPEC_CONFLICT', 'editing a record that does not exist is refused'
);
-- ล้างช่องได้ทีละช่อง (ส่ง null) แต่ล้างทุกช่องไม่ได้
select is(
  public.app_lab_strand_spec_save('A1802', '111', null, 20.20, null, null, null, null, null, 2) ->> 'order_no',
  null, 'a field sent as null is cleared'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '111', null, null, null, null, null, null, null, 3) $$,
  'LAB_SPEC_EMPTY', 'clearing every field is refused (delete the record instead)'
);

-- ข้อมูลยังอยู่และแก้ได้ แม้ชีตลบแถวผลทดสอบของ ID นั้นไปแล้ว (กระจกสะท้อนชีตลบแถว แต่ตารางนี้ไม่ผูกกัน)
reset role;
delete from public.lab_mooney_results where material = 'A1802' and sample_id = '111';
select is(
  (select count(*)::integer from public.lab_strand_specs where material = 'A1802' and sample_id = '111'),
  1, 'strand data survives when the sheet mirror drops the test rows of that ID'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (public.app_lab_strand_spec_save('A1802', '111', 'PO-2610-009', 20.20, null, null, null, null, null, 3) ->> 'version')::integer,
  4, 'an existing record can still be edited after its ID left the sheet'
);

-- 6. ลบ ------------------------------------------------------------------------------------
select throws_ok(
  $$ select public.app_lab_strand_spec_delete('A1802', '111', 3) $$,
  'LAB_SPEC_CONFLICT', 'deleting with an out-of-date version is refused'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_delete('A1802', '111', null) $$,
  'LAB_SPEC_CONFLICT', 'deleting without a version is refused'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_delete('A1802', '   ', 4) $$,
  'LAB_INVALID_SAMPLE', 'deleting with a blank ID is rejected'
);
select is(
  public.app_lab_strand_spec_delete('A1802', '111', 4), '{"deleted":true,"sample_id":"111"}'::jsonb,
  'deleting with the current version succeeds'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_delete('A1802', '111', 4) $$,
  'LAB_SPEC_CONFLICT', 'deleting the same record twice is refused (no replay)'
);
select is(
  jsonb_array_length(public.app_lab_strand_specs('A1802')), 1, 'only the deleted record is gone'
);

-- 7. audit: ผู้ทำรายการและค่าก่อน-หลังถูกบันทึกทุกครั้ง ------------------------------------------
reset role;
select is(
  (select count(*)::integer from public.audit_logs where entity_type = 'lab_strand_specs' and action = 'LAB_STRAND_SPEC_CREATE'),
  3, 'each creation wrote an audit row'
);
select is(
  (select count(*)::integer from public.audit_logs where entity_type = 'lab_strand_specs' and action = 'LAB_STRAND_SPEC_UPDATE'),
  3, 'each real edit wrote an audit row'
);
select is(
  (select count(*)::integer from public.audit_logs where entity_type = 'lab_strand_specs' and action = 'LAB_STRAND_SPEC_DELETE'),
  1, 'the deletion wrote an audit row'
);
select ok(
  not exists (
    select 1 from public.audit_logs
    where entity_type = 'lab_strand_specs' and actor_id is distinct from '50000000-0000-0000-0000-000000000001'::uuid
  ),
  'every audit row names the admin who made the change'
);
select is(
  (select metadata -> 'before' ->> 'order_no' from public.audit_logs
   where action = 'LAB_STRAND_SPEC_DELETE' and metadata ->> 'sample_id' = '111'),
  'PO-2610-009', 'the delete audit row keeps the values as they were before deletion'
);
select is(
  (select (metadata -> 'before' ->> 'outer_mm')::numeric from public.audit_logs
   where action = 'LAB_STRAND_SPEC_UPDATE' and metadata ->> 'sample_id' = '111' and (metadata -> 'after' ->> 'version')::integer = 2),
  20.10::numeric, 'an update audit row keeps the previous values'
);

-- 8. ตารางอ่านตรงไม่ได้ แม้เป็น admin -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select count(*) from public.lab_strand_specs $$,
  '42501', null, 'even an admin cannot read the table directly through the Data API'
);
select throws_ok(
  $$ insert into public.lab_strand_specs (material, sample_id, order_no) values ('A1802', '113', 'PO-DIRECT') $$,
  '42501', null, 'even an admin cannot write the table directly through the Data API'
);
reset role;

-- 9. ปฏิเสธ: พนักงานทั่วไป ----------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, 'NOT_AUTHORIZED', 'a regular employee cannot read strand data');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-STAFF', null, null, null, null, null, null) $$,
  'NOT_AUTHORIZED', 'a regular employee cannot add strand data'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '112', 'PO-STAFF', null, null, null, null, null, null, 1) $$,
  'NOT_AUTHORIZED', 'a regular employee cannot edit strand data'
);
select throws_ok(
  $$ select public.app_lab_strand_spec_delete('A1802', '112', 1) $$,
  'NOT_AUTHORIZED', 'a regular employee cannot delete strand data'
);
select throws_ok($$ select count(*) from public.lab_strand_specs $$, '42501', null, 'a regular employee cannot read the table directly');
reset role;
select is(
  (select order_no from public.lab_strand_specs where material = 'A1802' and sample_id = '112'),
  null, 'the denied calls changed nothing'
);

-- 10. ปฏิเสธ: admin ที่ถูกปิดบัญชี ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, 'NOT_AUTHORIZED', 'a deactivated admin cannot read strand data');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-OLD', null, null, null, null, null, null) $$,
  'NOT_AUTHORIZED', 'a deactivated admin cannot add strand data'
);
reset role;

-- ผู้ล็อกอินที่ไม่มีข้อมูลพนักงาน
insert into auth.users (id, email, raw_user_meta_data)
values ('83000000-0000-0000-0000-000000000009', 'strand-unlinked@mnp.local', '{}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, 'NOT_AUTHORIZED', 'a signed-in user with no employee record cannot read strand data');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-X', null, null, null, null, null, null) $$,
  'NOT_AUTHORIZED', 'a signed-in user with no employee record cannot add strand data'
);
reset role;

-- ผู้ไม่ล็อกอิน และ JWT ที่ไม่มี sub
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, '42501', null, 'anon cannot read strand data');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-X', null, null, null, null, null, null) $$,
  '42501', null, 'anon cannot add strand data'
);
select throws_ok($$ select public.app_lab_strand_spec_delete('A1802', '112', 1) $$, '42501', null, 'anon cannot delete strand data');
select throws_ok($$ select count(*) from public.lab_strand_specs $$, '42501', null, 'anon cannot read the table');
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, 'AUTH_REQUIRED', 'a session without a user id is asked to sign in');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '113', 'PO-X', null, null, null, null, null, null) $$,
  'AUTH_REQUIRED', 'saving requires a signed-in user'
);
reset role;

-- 11. สิทธิ์ตามบทบาทปัจจุบัน: ถอนบทบาท admin แล้วแก้ไม่ได้ทันที ------------------------------------------
update public.employees set role_id = '20000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_strand_specs('A1802') $$, 'NOT_AUTHORIZED', 'an admin demoted to staff can no longer read strand data');
select throws_ok(
  $$ select public.app_lab_strand_spec_save('A1802', '112', 'PO-DEMOTED', null, null, null, null, null, null, 1) $$,
  'NOT_AUTHORIZED', 'a demoted admin can no longer edit strand data'
);
reset role;

select * from finish();
rollback;
