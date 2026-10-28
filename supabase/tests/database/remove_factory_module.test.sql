-- ลบโมดูลฝ่ายโรงงาน (20261031010000_remove_factory_module.sql): ไม่เหลือตาราง ฟังก์ชัน ไฟล์แนบ และตัวนับของโมดูล
-- ส่วนที่ใบตรวจ QC ใช้ร่วม (trigger แยกโหมดทดสอบ) ยังทำงาน และบัญชีทดสอบที่ NCR ใช้ยังอยู่
-- พฤติกรรมของ trigger กับข้อมูลจริงทดสอบใน qc_inspection_reports.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- 1. ตารางและฟังก์ชันของโมดูลไม่เหลือ ----------------------------------------------------------
select is(
  (select count(*)::integer from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'factory\_%'),
  0, 'no public.factory_* table, index or sequence remains');
select is(
  (select count(*)::integer from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and (p.proname like 'app\_factory\_%' or p.proname like 'app\_sandbox\_%factory%'))
      or (n.nspname = 'private' and (p.proname like 'factory\_%' or p.proname = 'next_factory_doc_number'))),
  0, 'no factory RPC or helper function remains');
select ok(to_regprocedure('public.app_factory_master_data()') is null, 'the factory read RPC is gone');
select ok(to_regprocedure('public.app_sandbox_purge_factory()') is null, 'the factory test-data purge RPC is gone');

-- 2. ไฟล์แนบ -------------------------------------------------------------------------------
select is(
  (select count(*)::integer from pg_policies where schemaname = 'storage' and policyname like 'factory\_files\_%'),
  0, 'the factory storage policies are dropped');
select is((select count(*)::integer from storage.buckets where id = 'factory-attachments'), 0,
  'the factory-attachments bucket is deleted');

-- 3. ตัวนับเลขเอกสารของโหมดทดสอบ -------------------------------------------------------------
select is((select count(*)::integer from public.document_counters where department_code like 'FACTORY-%'), 0,
  'no factory document counter remains');

-- 4. ส่วนที่ใบตรวจ QC ใช้ร่วม -------------------------------------------------------------------
select ok(to_regprocedure('private.factory_sandbox_scope()') is null and to_regprocedure('private.sandbox_row_scope()') is not null,
  'the shared sandbox trigger function is renamed to private.sandbox_row_scope');
select is(
  (select count(*)::integer from pg_trigger g
   where g.tgname like 'qc\_inspection\_%\_sandbox\_scope' and not g.tgisinternal
     and g.tgfoid = 'private.sandbox_row_scope()'::regprocedure),
  6, 'all six QC inspection tables still use the shared sandbox trigger');
select ok(
  not has_function_privilege('anon', 'private.sandbox_row_scope()', 'execute')
    and not has_function_privilege('authenticated', 'private.sandbox_row_scope()', 'execute'),
  'API roles cannot call the trigger function directly');

-- 5. รายการตารางที่รู้จักโหมดทดสอบ --------------------------------------------------------------
select is(
  (select count(*)::integer from unnest(private.sandbox_unguarded_tables()) as t(name) where t.name like 'factory\_%'),
  0, 'the sandbox-aware table list has no factory table');
select is(
  (select count(*)::integer from unnest(private.sandbox_unguarded_tables()) as t(name)
   where not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                     where n.nspname = 'public' and c.relname = t.name and c.relkind in ('r', 'p'))),
  0, 'every table in the sandbox-aware list exists');
select ok(
  array['ncr_reports', 'ncr_outcomes', 'qc_inspection_reports', 'qc_inspection_history'] <@ private.sandbox_unguarded_tables(),
  'NCR and QC tables stay sandbox aware');

-- 6. บัญชีทดสอบที่ NCR ใช้ร่วมยังอยู่ ---------------------------------------------------------------
select ok(exists (select 1 from public.employees where employee_no = 'SBX-FT-AFM' and is_test and not is_active),
  'the assistant factory manager persona used by NCR test mode is kept');

select * from finish();
rollback;
