-- ทดสอบการเคลียรายการใบคำร้องถึงฝ่ายบริหาร (20261009010000_clear_management_requests.sql):
--   1) ลบเฉพาะคำร้องประเภท MANAGEMENT พร้อมข้อมูลลูกที่ผูกด้วย cascade
--   2) คำร้องประเภทอื่นไม่ถูกแตะ และโมดูล MANAGEMENT (request_types / ฟังก์ชันยื่นใบ) ยังอยู่
--   3) ตัวนับเลขที่เอกสารไม่ถูกรีเซ็ต และมี audit สรุปการลบ
--   4) ฟังก์ชันลบไม่เปิดให้ผู้ใช้ผ่าน Data API (deny)
begin;

create extension if not exists pgtap with schema extensions;
select plan(13);

-- เตรียมข้อมูล: คำร้อง MANAGEMENT 2 ใบ (ใบแรกมีไฟล์แนบ/ขั้นอนุมัติ/คอมเมนต์) + คำร้องประเภทอื่น (seed) --------
insert into public.requests (
  id, request_no, request_type_id, requester_id, department_id, title, description
)
select v.id, v.request_no, t.id, '50000000-0000-0000-0000-000000000003',
       '10000000-0000-0000-0000-000000000007', 'CLEAR_MG_TEST', 'CLEAR_MG_TEST'
from public.request_types t
cross join (values
  ('72000000-0000-0000-0000-000000000001'::uuid, 'CLEARMG-001'),
  ('72000000-0000-0000-0000-000000000002'::uuid, 'CLEARMG-002')
) as v(id, request_no)
where t.code = 'MANAGEMENT';

insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
select '72000000-0000-0000-0000-000000000001', 1, 'ผู้จัดการโรงงาน', id
from public.roles where code = 'factory_manager';

insert into public.request_comments (request_id, author_id, body)
values ('72000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'ความเห็นทดสอบ');

insert into public.request_attachments (request_id, uploader_id, storage_path, file_name, content_type, size_bytes)
values ('72000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
        'clear-mg-test/file.pdf', 'file.pdf', 'application/pdf', 100);

insert into public.document_counters (department_code, year_key, last_number)
values ('FT-MGMT', 'CLEAR_MG_TEST', 7);

select results_eq(
  $$ select count(*)::bigint from public.requests r
     join public.request_types t on t.id = r.request_type_id where t.code = 'MANAGEMENT' $$,
  array[2::bigint],
  'precondition: MANAGEMENT requests exist before clearing'
);

-- 1. ลบ -------------------------------------------------------------------
select results_eq(
  $$ select private.purge_requests_by_type('MANAGEMENT') $$,
  array[2],
  'purge returns the number of deleted MANAGEMENT requests'
);

select results_eq(
  $$ select count(*)::bigint from public.requests r
     join public.request_types t on t.id = r.request_type_id where t.code = 'MANAGEMENT' $$,
  array[0::bigint],
  'no MANAGEMENT requests remain'
);

select results_eq(
  $$ select (select count(*) from public.approval_steps where request_id = '72000000-0000-0000-0000-000000000001')
          + (select count(*) from public.request_comments where request_id = '72000000-0000-0000-0000-000000000001')
          + (select count(*) from public.request_attachments where request_id = '72000000-0000-0000-0000-000000000001')
          + (select count(*) from public.request_status_history where request_id = '72000000-0000-0000-0000-000000000001') $$,
  array[0::bigint],
  'child rows of the deleted requests are removed by cascade'
);

-- 2. ไม่กระทบคำร้องอื่นและตัวโมดูล -------------------------------------------
select results_eq(
  $$ select count(*)::bigint from public.requests where id in
       ('60000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000002') $$,
  array[2::bigint],
  'requests of other types are untouched'
);
select ok(
  exists (select 1 from public.request_types where code = 'MANAGEMENT' and is_active),
  'MANAGEMENT request type still exists and is active'
);
select ok(
  (select uses_factory_general_chain from public.request_types where code = 'MANAGEMENT'),
  'MANAGEMENT approval chain configuration is unchanged'
);
select has_function(
  'public', 'app_create_request', array['uuid','text','text','text','jsonb','uuid[]'],
  'app_create_request is still available for new MANAGEMENT requests'
);

-- 3. ตัวนับเลข + audit --------------------------------------------------------
select results_eq(
  $$ select last_number from public.document_counters
     where department_code = 'FT-MGMT' and year_key = 'CLEAR_MG_TEST' $$,
  array[7],
  'FT-MGMT document counter is not reset'
);
select results_eq(
  $$ select (metadata->>'deleted_count')::int from public.audit_logs
     where action = 'purge_requests_by_type' order by id desc limit 1 $$,
  array[2],
  'summary audit row records the deleted count'
);
select results_eq(
  $$ select metadata->'orphaned_storage_paths' from public.audit_logs
     where action = 'purge_requests_by_type' order by id desc limit 1 $$,
  $$ values ('["clear-mg-test/file.pdf"]'::jsonb) $$,
  'summary audit row lists attachment paths left in Storage'
);

-- 4. deny: ผู้ใช้ผ่าน Data API เรียกฟังก์ชันลบไม่ได้ -----------------------------
select ok(
  not has_function_privilege('authenticated', 'private.purge_requests_by_type(text)', 'execute'),
  'authenticated cannot execute the purge function'
);
select ok(
  not has_function_privilege('anon', 'private.purge_requests_by_type(text)', 'execute'),
  'anon cannot execute the purge function'
);

select * from finish();
rollback;
