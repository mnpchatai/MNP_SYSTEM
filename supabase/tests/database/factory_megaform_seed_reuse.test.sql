-- ฝ่ายโรงงาน: ชุดทดสอบ MEGAFORM เมื่อโหมดทดสอบมี Item รหัสเดียวกันอยู่ก่อนแล้ว (20261008050000_factory_megaform_reuse_items.sql)
-- ครอบคลุม: ใช้ Item เดิมแทนการสร้างซ้ำ (ไม่ error ด้วย unique รหัสซ้ำ), ไม่แก้ข้อมูลเดิม, ไม่ลงยอดยกมาซ้ำให้ Item เดิม,
-- BOM ฉบับร่างเดิมคงไว้และเพิ่ม Revision B ที่อนุมัติแล้ว, Routing/ใบงานของ Item เดิมครบ, เติมซ้ำไม่ได้, ล้างข้อมูลได้
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

insert into auth.users (id, email, raw_user_meta_data) values ('85000000-0000-0000-0000-000000000001', 'megareuse-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id)
values ('85000000-0000-0000-0000-000000000101', 'MEGAREUSE-ADMIN', 'Mega', 'Reuse', 'megareuse-admin@test.local',
        (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '85000000-0000-0000-0000-000000000001');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);

-- Item ทดสอบที่มีอยู่ก่อน (จากชุดอื่น) รหัสตรงกับใบคำนวณ MEGAFORM: วัตถุดิบ 2 รายการ และ PT-00110-1 ที่มี BOM ฉบับร่าง Revision A
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement, is_test) values
  ('85000000-0000-0000-0000-00000000f001', 'C07-017', 'เทปเดิมจากชุดอื่น', 'RM', 'rubber', 'MNP', 'KG', 'buy', true),
  ('85000000-0000-0000-0000-00000000f002', 'D21-019', 'เม็ดพลาสติกเดิมจากชุดอื่น', 'RM', 'rubber', 'MNP', 'KG', 'buy', true),
  ('85000000-0000-0000-0000-00000000f003', 'PT-00110-1', 'ตัวล็อคเดิมจากชุดอื่น', 'WIP', 'industrial', 'MNP', 'PCS', 'make', true);
insert into public.factory_boms (id, item_id, revision, output_qty, status, effective_date, is_test)
values ('85000000-0000-0000-0000-00000000b001', '85000000-0000-0000-0000-00000000f003', 'A', 1, 'draft', date '2026-07-01', true);
insert into public.factory_bom_lines (bom_id, line_no, component_id, quantity, scrap_percent, is_test)
values ('85000000-0000-0000-0000-00000000b001', 1, '85000000-0000-0000-0000-00000000f002', 5, 0, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"85000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);

-- 1. เติมได้แม้รหัสซ้ำ -------------------------------------------------------------------
select lives_ok($$select set_config('test.seed', public.app_sandbox_seed_factory_megaform()::text, true)$$, 'seeding does not fail on item codes that already exist');
select is(current_setting('test.seed')::jsonb ->> 'seeded', 'true', 'the set is added');
select is(current_setting('test.seed')::jsonb ->> 'items', '352', 'only the 352 missing items are created');
select is(current_setting('test.seed')::jsonb ->> 'reused_items', '3', 'the 3 existing items are reused');
select is(current_setting('test.seed')::jsonb ->> 'orders', '14', 'all 14 production orders are created');
select is(current_setting('test.seed')::jsonb ->> 'jobs', '173', 'all 173 jobs are created');
select is(public.app_sandbox_seed_factory_megaform() ->> 'seeded', 'false', 'seeding again changes nothing');

-- 2. ข้อมูลเดิมไม่ถูกแก้ ----------------------------------------------------------------
reset role;
select is((select count(*) from public.factory_items where is_test and code in ('C07-017', 'D21-019', 'PT-00110-1'))::integer, 3, 'the existing items are not duplicated');
select is((select name from public.factory_items where is_test and code = 'C07-017'), 'เทปเดิมจากชุดอื่น', 'an existing item keeps its own name');
select is((select version from public.factory_items where is_test and code = 'C07-017'), 1, 'an existing item is not edited');
select is((select count(*) from public.factory_inventory_movements m join public.factory_items i on i.id = m.item_id
           where i.is_test and i.code in ('C07-017', 'D21-019') and m.kind = 'opening')::integer, 0, 'no opening balance is added to an existing item');

-- 3. BOM / Routing ของ Item เดิม ---------------------------------------------------------
select is((select status from public.factory_boms where id = '85000000-0000-0000-0000-00000000b001'), 'draft', 'the existing draft BOM stays a draft');
select is((select count(*) from public.factory_bom_lines where bom_id = '85000000-0000-0000-0000-00000000b001')::integer, 1, 'the existing draft BOM keeps its single line');
select is((select quantity from public.factory_bom_lines where bom_id = '85000000-0000-0000-0000-00000000b001' and line_no = 1), 5.0000, 'the existing BOM line is untouched');
select is((select b.revision from public.factory_boms b where b.item_id = '85000000-0000-0000-0000-00000000f003' and b.status = 'approved'), 'B',
  'the seeded BOM for an item with a draft Revision A is approved as Revision B');
select is((select l.quantity from public.factory_bom_lines l join public.factory_boms b on b.id = l.bom_id join public.factory_items c on c.id = l.component_id
           where b.item_id = '85000000-0000-0000-0000-00000000f003' and b.status = 'approved' and c.code = 'D21-019'), 3.0000, 'Revision B carries the quantities of the sheet');
select is((select count(*) from public.factory_boms where is_test)::integer, 230, '229 seeded BOMs plus the pre-existing draft');
select ok(exists (select 1 from public.factory_routings r where r.item_id = '85000000-0000-0000-0000-00000000f003')
      and exists (select 1 from public.factory_routing_steps s join public.factory_routings r on r.id = s.routing_id where r.item_id = '85000000-0000-0000-0000-00000000f003'),
  'a routing with steps is created for the reused item');
select is((select count(*) from public.factory_jobs j where j.is_test and j.item_id = '85000000-0000-0000-0000-00000000f003')::integer, 2, 'the reused item still gets its two jobs');
select is((select count(*) from public.factory_jobs j join public.factory_boms b on b.id = j.bom_id
           where j.item_id = '85000000-0000-0000-0000-00000000f003' and b.revision = 'B' and b.status = 'approved')::integer, 2, 'its jobs use the approved Revision B');
select is((select count(*) from public.factory_job_steps s join public.factory_jobs j on j.id = s.job_id where j.item_id = '85000000-0000-0000-0000-00000000f003')::integer > 0, true, 'its jobs have steps');
select is((select count(*) from public.factory_jobs where is_test)::integer, 173, 'every job of the set exists');
select is((select (metadata ->> 'items')::integer from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_MEGAFORM' order by created_at desc limit 1), 352, 'the audit log records the created item count');

-- 4. ล้างข้อมูลได้ ----------------------------------------------------------------------
set local role authenticated;
select lives_ok($$select public.app_sandbox_purge_factory()$$, 'the test data can be purged afterwards');
reset role;
select is((select count(*) from public.factory_items where is_test)::integer, 0, 'no test items remain after the purge');

select * from finish();
rollback;
