-- ฝ่ายโรงงาน ไฟล์แนบของเอกสาร (20261009030000_factory_attachments.sql): โครงสร้าง สิทธิ์ ขอบเขตโหมดทดสอบ
-- การตรวจไฟล์ใน Storage และการล้างข้อมูลทดสอบที่ต้องลบไฟล์จริงก่อน
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.factory_attachments'::regclass), 'attachments have RLS');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.factory_attachments', p.priv)),
  'clients have no direct table privilege on attachments');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.factory_attachments'::regclass
                  and tgname = 'factory_attachments_sandbox_scope' and not tgisinternal), 'attachments enforce sandbox scope');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.factory_attachments'::regclass
                  and tgname = 'factory_attachments_audit' and not tgisinternal), 'attachment rows are audited');
select ok('factory_attachments' = any (private.sandbox_unguarded_tables()), 'attachments are registered as sandbox aware');
select ok('factory_job_inspections' = any (private.sandbox_unguarded_tables()), 'the redefined sandbox list keeps the existing factory tables');
select ok(not has_function_privilege('anon', 'public.app_factory_add_attachment(text,uuid,text,text)', 'execute'), 'anon cannot add attachments');
select ok(not has_function_privilege('anon', 'public.app_factory_list_attachments(text,uuid)', 'execute'), 'anon cannot list attachments');
select ok(not has_function_privilege('anon', 'public.app_factory_attachment_paths()', 'execute'), 'anon cannot list attachment paths');
select ok(has_function_privilege('authenticated', 'public.app_factory_add_attachment(text,uuid,text,text)', 'execute'), 'signed-in users reach the API (it checks the mode itself)');
select ok(has_function_privilege('authenticated', 'private.factory_files_allowed()', 'execute')
  and not has_function_privilege('anon', 'private.factory_files_allowed()', 'execute'),
  'storage policies call a wrapper that signed-in users may execute (the persona helper itself stays private)');
select ok(not has_function_privilege('authenticated', 'private.sandbox_persona()', 'execute'), 'the persona helper is still not callable by clients');
select is((select public from storage.buckets where id = 'factory-attachments'), false, 'the bucket is private');
select is((select file_size_limit from storage.buckets where id = 'factory-attachments'), 20971520::bigint, 'the bucket limit is 20 MB');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'factory_files_%'), 3::bigint,
  'the bucket has read, upload and delete policies');

-- 2. บัญชีทดสอบ -------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('77000000-0000-0000-0000-000000000001', 'fa-admin@test.local', '{}'),
  ('77000000-0000-0000-0000-000000000002', 'fa-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('77000000-0000-0000-0000-000000000101', 'FA-ADMIN', 'Fa', 'Admin', 'fa-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '77000000-0000-0000-0000-000000000001'),
  ('77000000-0000-0000-0000-000000000102', 'FA-STAFF', 'Fa', 'Staff', 'fa-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '77000000-0000-0000-0000-000000000002');
-- Item จริง (ไม่ใช่โหมดทดสอบ) ใช้ตรวจว่าแนบไฟล์ให้เอกสารจริงไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('77000000-0000-0000-0000-00000000f001', 'FA-REAL-01', 'Item จริงสำหรับตรวจไฟล์แนบ', 'RM', 'rubber', 'MNP', 'KG', 'buy');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_list_attachments('item', gen_random_uuid())$$, 'AUTH_REQUIRED', 'listing requires a session');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_list_attachments('item', gen_random_uuid())$$, 'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot list attachments');
select throws_ok($$select public.app_factory_add_attachment('item', gen_random_uuid(), 'item/x/y.pdf', 'y.pdf')$$, 'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot add attachments');
select throws_ok('select public.app_factory_attachment_paths()', 'NOT_AUTHORIZED', 'a real staff account cannot list attachment paths');
select throws_ok('select count(*) from public.factory_attachments', '42501', null, 'clients cannot read the attachment table directly');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_list_attachments('item', gen_random_uuid())$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot list attachments');
select throws_ok('select public.app_factory_attachment_paths()', 'SANDBOX_NOT_ACTIVE', 'listing paths needs test mode');

-- 4. โหมดทดสอบ: แนบไฟล์ -----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select public.app_sandbox_seed_factory();
select set_config('test.item', (public.app_factory_master_data() -> 'items' -> 0 ->> 'id'), true);
select set_config('test.path', 'item/' || current_setting('test.item') || '/11111111-1111-1111-1111-111111111111-spec.pdf', true);

-- จำลองไฟล์ที่เบราว์เซอร์อัปโหลดเข้า Storage แล้ว (ตัวอัปโหลดจริงผ่าน policy ของ bucket)
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('factory-attachments', current_setting('test.path'), '77000000-0000-0000-0000-000000000001',
   '{"size": 2048, "mimetype": "application/pdf"}'::jsonb),
  ('factory-attachments', 'item/' || current_setting('test.item') || '/22222222-2222-2222-2222-222222222222-other.pdf', '77000000-0000-0000-0000-000000000002',
   '{"size": 2048, "mimetype": "application/pdf"}'::jsonb),
  ('factory-attachments', 'item/' || current_setting('test.item') || '/33333333-3333-3333-3333-333333333333-big.pdf', '77000000-0000-0000-0000-000000000001',
   '{"size": 99999999, "mimetype": "application/pdf"}'::jsonb),
  ('factory-attachments', 'item/77000000-0000-0000-0000-00000000f001/44444444-4444-4444-4444-444444444444-real.pdf', '77000000-0000-0000-0000-000000000001',
   '{"size": 2048, "mimetype": "application/pdf"}'::jsonb);
set local role authenticated;

select is(public.app_factory_list_attachments('item', current_setting('test.item')::uuid), '[]'::jsonb, 'a new document has no attachments');
select lives_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, %L, 'ข้อกำหนด.pdf')$$, current_setting('test.item'), current_setting('test.path')),
  'the uploaded file is registered on the item');
select is(jsonb_array_length(public.app_factory_list_attachments('item', current_setting('test.item')::uuid)), 1, 'the item lists one attachment');
select is(public.app_factory_list_attachments('item', current_setting('test.item')::uuid) -> 0 ->> 'file_name', 'ข้อกำหนด.pdf', 'the file name is kept');
select is((public.app_factory_list_attachments('item', current_setting('test.item')::uuid) -> 0 ->> 'size_bytes')::bigint, 2048::bigint, 'the size comes from Storage, not the client');
select is(public.app_factory_list_attachments('item', current_setting('test.item')::uuid) -> 0 ->> 'content_type', 'application/pdf', 'the type comes from Storage');
select is(jsonb_array_length(public.app_factory_list_attachments('bom', current_setting('test.item')::uuid)), 0, 'attachments are scoped to the entity type');

select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, %L, 'x.pdf')$$, current_setting('test.item'), current_setting('test.path')),
  '23505', null, 'the same stored file cannot be registered twice');
select throws_ok(format($$select public.app_factory_add_attachment('widget', %L::uuid, 'widget/x/y.pdf', 'y.pdf')$$, current_setting('test.item')),
  'INVALID_ATTACHMENT', 'unknown entity types are rejected');
select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, 'bom/%s/z.pdf', 'z.pdf')$$, current_setting('test.item'), current_setting('test.item')),
  'INVALID_ATTACHMENT', 'the stored path must belong to the entity');
select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, %L, '   ')$$, current_setting('test.item'), current_setting('test.path')),
  'INVALID_ATTACHMENT', 'a file name is required');
select throws_ok(format($$select public.app_factory_add_attachment('item', gen_random_uuid(), 'item/%s/z.pdf', 'z.pdf')$$, current_setting('test.item')),
  'INVALID_ATTACHMENT', 'a path for another id is rejected');
select throws_ok($$select public.app_factory_add_attachment('item', '77000000-0000-0000-0000-0000000000aa', 'item/77000000-0000-0000-0000-0000000000aa/55555555-5555-5555-5555-555555555555-x.pdf', 'x.pdf')$$,
  'ATTACHMENT_ENTITY_NOT_FOUND', 'the document must exist');
select throws_ok($$select public.app_factory_add_attachment('item', '77000000-0000-0000-0000-00000000f001', 'item/77000000-0000-0000-0000-00000000f001/44444444-4444-4444-4444-444444444444-real.pdf', 'real.pdf')$$,
  'ATTACHMENT_ENTITY_NOT_FOUND', 'a real (non-test) document cannot take test files');
select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, 'item/%s/66666666-6666-6666-6666-666666666666-missing.pdf', 'missing.pdf')$$, current_setting('test.item'), current_setting('test.item')),
  'ATTACHMENT_NOT_UPLOADED', 'a file that was never uploaded is rejected');
select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, 'item/%s/22222222-2222-2222-2222-222222222222-other.pdf', 'other.pdf')$$, current_setting('test.item'), current_setting('test.item')),
  'ATTACHMENT_NOT_UPLOADED', 'a file uploaded by someone else cannot be claimed');
select throws_ok(format($$select public.app_factory_add_attachment('item', %L::uuid, 'item/%s/33333333-3333-3333-3333-333333333333-big.pdf', 'big.pdf')$$, current_setting('test.item'), current_setting('test.item')),
  'INVALID_ATTACHMENT', 'an oversize file is rejected');

-- 5. ล้างข้อมูลทดสอบต้องลบไฟล์จริงก่อน -------------------------------------------------
select throws_ok('select public.app_sandbox_purge_factory()', 'FACTORY_FILES_REMAIN', 'purge is refused while the stored file still exists');
select is(public.app_factory_attachment_paths(), array[current_setting('test.path')], 'the admin gets the paths to delete through the Storage API');
select is(jsonb_array_length(public.app_factory_master_data() -> 'items'), 16, 'a refused purge changes nothing');

-- จำลองการลบไฟล์ผ่าน Storage API (Storage ห้ามลบแถวตรงด้วย SQL ปกติ จึงเปิดสวิตช์ของมันเฉพาะในธุรกรรมทดสอบนี้)
reset role;
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'factory-attachments' and name = current_setting('test.path');
set local role authenticated;
select is((select count(*) from storage.objects where bucket_id = 'factory-attachments' and name = current_setting('test.path')), 0::bigint,
  'the deleted file no longer exists in Storage');
select lives_ok('select public.app_sandbox_purge_factory()', 'purge succeeds once the files are gone');
select is(public.app_factory_attachment_paths(), '{}'::text[], 'no attachment rows remain after the purge');

select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_attachments), 0::bigint, 'no attachment rows remain');
select is((select count(*) from public.factory_items where not is_test), 1::bigint, 'the real item is untouched');
select * from finish();
rollback;
