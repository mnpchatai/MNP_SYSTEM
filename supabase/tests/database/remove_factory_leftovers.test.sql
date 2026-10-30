-- ทดสอบการลบของค้างจากโมดูลฝ่ายโรงงาน (20261104010000_remove_factory_leftovers.sql):
--   1) ไม่มีตาราง private._mg_deploy_chunks และไม่มี audit การเติม/ล้างข้อมูลโรงงาน
--   2) มีแถวสรุป
--   3) บัญชีทดสอบที่ยังใช้เป็น persona ของ NCR/QC ยังอยู่
begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select hasnt_table('private', '_mg_deploy_chunks', 'the factory seed deploy chunks table is gone');

select results_eq(
  $$ select count(*)::bigint from public.audit_logs
     where entity_type = 'sandbox_session'
       and action in ('SANDBOX_SEED_FACTORY', 'SANDBOX_SEED_FACTORY_TRIAL',
                      'SANDBOX_SEED_FACTORY_MEGAFORM', 'SANDBOX_PURGE_FACTORY') $$,
  array[0::bigint],
  'no factory seed/purge audit rows remain'
);

select ok(
  exists (select 1 from public.audit_logs where action = 'remove_factory_leftovers'),
  'a summary audit row records the cleanup'
);

select results_eq(
  $$ select count(*)::bigint from public.employees
     where is_test and employee_no in ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-ST-STAFF', 'SBX-SR-STAFF',
                                       'SBX-GR-STAFF', 'SBX-PT-STAFF', 'SBX-BG-STAFF', 'SBX-WH-STAFF',
                                       'SBX-FT-AFM') $$,
  array[9::bigint],
  'sandbox personas still used by NCR/QC are kept'
);

select * from finish();
rollback;
