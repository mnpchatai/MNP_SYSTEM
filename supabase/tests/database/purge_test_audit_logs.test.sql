-- ทดสอบการล้าง audit ของข้อมูลทดสอบ (20261103010000_purge_factory_and_test_ncr_audit_logs.sql):
--   1) ลบ audit ของโมดูลโรงงาน (entity_type factory_*)
--   2) ลบ audit ของใบ NCR ทดสอบ ทั้งใบที่ยังอยู่และใบที่ถูกล้างไปแล้ว รวม audit ของตารางลูก
--   3) audit ของใบ NCR จริงและประเภทอื่นไม่ถูกแตะ แม้มีแถว audit ปลอมอ้างว่าใบจริงเป็นใบทดสอบ
--   4) มีแถวสรุป และผู้ใช้ผ่าน Data API เรียกฟังก์ชันไม่ได้ (deny)
begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

-- เตรียมข้อมูล ---------------------------------------------------------------
-- audit ของโรงงาน (ตารางถูกลบไปแล้ว จึงใส่แถว audit ตรงๆ)
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values
  (null, 'INSERT', 'factory_jobs', 'PTAL-F1', '{}'::jsonb),
  (null, 'UPDATE', 'factory_production_orders', 'PTAL-F2', '{}'::jsonb);

-- ใบ NCR: T1 ทดสอบที่ยังอยู่, T2 ทดสอบที่ถูกล้างแล้ว, R1 ใบจริง (trigger audit_row_change สร้าง audit ให้)
insert into public.ncr_reports (id, ncr_no, reporter_id, reporter_department_id, issue_date, product_name,
                                qty_total, qty_defect, unit, source, defect_type_id, description, is_test)
select v.id, v.ncr_no, '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
       current_date, 'PTAL สินค้า', 100, 5, 'ชิ้น', 'in_process',
       (select id from public.ncr_defect_types where code = 'DIM'), 'PTAL ทดสอบ', v.is_test
from (values
  ('76000000-0000-0000-0000-000000000001'::uuid, 'PTAL-T1/26', true),
  ('76000000-0000-0000-0000-000000000002'::uuid, 'PTAL-T2/26', true),
  ('76000000-0000-0000-0000-000000000003'::uuid, 'PTAL-R1/26', false)
) as v(id, ncr_no, is_test);

insert into public.ncr_responsibilities (ncr_id, department_id, share) values
  ('76000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 1),
  ('76000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000007', 1),
  ('76000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007', 1);

-- ล้าง T2 แบบที่ปุ่ม "ล้างข้อมูลทดสอบ" ทำ (cascade + audit DELETE)
delete from public.ncr_reports where id = '76000000-0000-0000-0000-000000000002';

-- audit ปลอมที่อ้างว่าใบจริง R1 เป็นใบทดสอบ: ต้องไม่ทำให้ audit ของ R1 ถูกลบ
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values
  (null, 'UPDATE', 'ncr_reports', '76000000-0000-0000-0000-000000000003',
   '{"new": {"is_test": true}, "old": {"is_test": true}}'::jsonb);

-- audit ประเภทอื่นที่ต้องอยู่ต่อ
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values
  (null, 'SANDBOX_PURGE_NCR', 'sandbox_session', 'PTAL-S1', '{"deleted_ncr": 1}'::jsonb);

create temp table ptal_ncr_audit on commit drop as
select a.id, coalesce(a.metadata->'new'->>'ncr_id', a.metadata->'old'->>'ncr_id', a.entity_id) as ncr_id
from public.audit_logs a
where a.entity_type like 'ncr\_%'
  and coalesce(a.metadata->'new'->>'ncr_id', a.metadata->'old'->>'ncr_id', a.entity_id) like '76000000-%';

select ok(
  (select count(*) from ptal_ncr_audit where ncr_id = '76000000-0000-0000-0000-000000000002') >= 4,
  'precondition: the purged test NCR left INSERT and DELETE audit rows for itself and its children'
);

-- ลบ ---------------------------------------------------------------------
select results_eq(
  $$ select (private.purge_test_audit_logs()->>'factory_deleted')::int $$,
  array[2],
  'purge reports the number of deleted factory audit rows'
);

select results_eq(
  $$ select count(*)::bigint from public.audit_logs where entity_type like 'factory\_%' $$,
  array[0::bigint],
  'no factory audit rows remain'
);

select results_eq(
  $$ select count(*)::bigint from public.audit_logs a join ptal_ncr_audit p on p.id = a.id
     where p.ncr_id = '76000000-0000-0000-0000-000000000001' $$,
  array[0::bigint],
  'audit rows of an existing test NCR and its children are deleted'
);

select results_eq(
  $$ select count(*)::bigint from public.audit_logs a join ptal_ncr_audit p on p.id = a.id
     where p.ncr_id = '76000000-0000-0000-0000-000000000002' $$,
  array[0::bigint],
  'audit rows of an already purged test NCR are deleted, including its DELETE rows'
);

-- ไม่แตะของจริง ------------------------------------------------------------
select results_eq(
  $$ select count(*)::bigint from public.audit_logs a join ptal_ncr_audit p on p.id = a.id
     where p.ncr_id = '76000000-0000-0000-0000-000000000003' $$,
  $$ select count(*)::bigint from ptal_ncr_audit where ncr_id = '76000000-0000-0000-0000-000000000003' $$,
  'audit rows of a real NCR are kept, even when an audit row claims it is a test NCR'
);

select ok(
  exists (select 1 from public.audit_logs where entity_type = 'sandbox_session' and entity_id = 'PTAL-S1'),
  'audit rows of other entity types are kept'
);

select ok(
  exists (select 1 from public.ncr_reports where id = '76000000-0000-0000-0000-000000000001')
  and exists (select 1 from public.ncr_responsibilities where ncr_id = '76000000-0000-0000-0000-000000000001'),
  'the purge removes audit rows only, not the NCR rows themselves'
);

-- แถวสรุป + deny -----------------------------------------------------------
select results_eq(
  $$ select metadata from public.audit_logs
     where action = 'purge_test_audit_logs' order by id desc limit 1 $$,
  $$ select jsonb_build_object('factory_deleted', 2,
       'test_ncr_deleted', (select count(*) from ptal_ncr_audit
                            where ncr_id in ('76000000-0000-0000-0000-000000000001',
                                             '76000000-0000-0000-0000-000000000002'))) $$,
  'summary audit row records the deleted counts'
);

select ok(
  not has_function_privilege('authenticated', 'private.purge_test_audit_logs()', 'execute'),
  'authenticated cannot execute the purge function'
);
select ok(
  not has_function_privilege('anon', 'private.purge_test_audit_logs()', 'execute'),
  'anon cannot execute the purge function'
);

select * from finish();
rollback;
