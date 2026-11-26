-- ตารางยางเส้นของ PR #196 (ปิดไม่ merge) และ RPC ของมันต้องไม่มีอยู่ (20270106010000_drop_lab_strand_specs.sql)
begin;

create extension if not exists pgtap with schema extensions;
select plan(2);

select hasnt_table('public', 'lab_strand_specs', 'lab_strand_specs table does not exist');
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname like 'app\_lab\_strand\_spec%'),
  0::bigint,
  'no app_lab_strand_spec* functions exist'
);

select * from finish();
rollback;
