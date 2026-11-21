-- ทดสอบไฟล์แนบของใบแจ้งซ่อมคอมพิวเตอร์ (20261212010000_itrp_repair_requests.sql) — Storage + ทะเบียนไฟล์
--   A) บัคเก็ต itrp-files / itrp-test-files + policy ของ Storage: อัปโหลดเฉพาะผู้แจ้งใน path ของใบ, อ่านตามสิทธิ์เห็นใบ, ไม่มี UPDATE/DELETE ของบัคเก็ตจริง
--   B) ลงทะเบียนไฟล์ (app_itrp_add_attachment): แนบได้เสมอ (ไม่มีตัวเลือก "เอกสารแนบ มี/ไม่มี"), ≤10 ไฟล์ต่อครั้ง, หน้าต่าง 30 นาที, ปิดเมื่อมีการอนุมัติจริง, ชนิด/ขนาดจาก Storage
--   C) ไฟล์ของรอบขอแก้ไข + ไฟล์ของข้อความถาม/ตอบ · เพิ่มได้อย่างเดียว
--   D) โหมดทดสอบ: ไฟล์ทดสอบอยู่บัคเก็ตทดสอบ, ล้างข้อมูลทดสอบคืนรายการไฟล์ที่ต้องลบ
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITF-*) ในแผนก ZXA/ZXB ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT, SBX-ZX-* สร้างในไฟล์นี้
begin;

create extension if not exists pgtap with schema extensions;
select plan(132);

create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"2d800000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.uid(n integer) returns text language sql as $$ select '2d800000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
create function pg_temp.new_req() returns text language sql as $$
  select (select id::text from public.app_itrp_create(null, 'PC-01', 'repair', null, 'computer', null, 'เปิดเครื่องไม่ติด', false)) $$;
-- ชื่อไฟล์ <uuid>.<นามสกุล> จากเลขลำดับ (prefix p ทำให้แต่ละหมวดไม่ชนกัน)
create function pg_temp.fn(p text, n integer, ext text default 'pdf') returns text language sql as $$
  select p || '0000-0000-0000-' || lpad(n::text, 12, '0') || '.' || ext $$;
-- อัปโหลดเข้า Storage ตามสิทธิ์ของ role ปัจจุบัน (ผ่าน policy จริง)
create function pg_temp.up(p_bucket text, p_name text, p_owner integer, p_meta jsonb default '{"size": 100, "mimetype": "application/pdf"}') returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values (p_bucket, p_name, pg_temp.uid(p_owner), p_meta) $$;
-- ลงทะเบียนไฟล์ของใบตอนแจ้ง
create function pg_temp.reg(p_req text, p_file text, p_label text default 'f.pdf') returns uuid language sql as $$
  select public.app_itrp_add_attachment(p_req::uuid, null, p_req || '/' || p_file, p_label, 'application/pdf', 1) $$;

-- 1. โครงสร้าง + บัคเก็ต + policy ------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from storage.buckets where id in ('itrp-files', 'itrp-test-files') and not public and file_size_limit = 20971520), 2, 'both buckets exist, are private and are limited to 20 MB');
select ok((select bool_and(b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'] and cardinality(b.allowed_mime_types) = 13) from storage.buckets b where b.id in ('itrp-files', 'itrp-test-files')), 'both buckets accept exactly the same 13 types as the work order buckets (no .ppt)');
select ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('itrp_files_read', 'itrp_files_upload', 'itrp_test_files_read', 'itrp_test_files_upload', 'itrp_test_files_delete')) = 5, 'the five itrp Storage policies exist');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'itrp\_%' and (cmd = 'UPDATE' or cmd = 'ALL' or (policyname like 'itrp\_files\_%' and cmd = 'DELETE'))), 'no itrp policy allows UPDATE (no overwrite) and the live bucket has no DELETE policy');
select ok((select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_storage\_%') = 3 and not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_storage\_%' and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'the three Storage policy helpers are callable by authenticated only (not anon)');
select ok(private.itrp_ext_matches_mime('x/y.pdf', 'application/pdf') and not private.itrp_ext_matches_mime('x/y.pdf', 'image/jpeg') and not private.itrp_ext_matches_mime('x/y.ppt', 'application/vnd.ms-powerpoint') and not private.itrp_ext_matches_mime('noext', 'application/pdf') and not private.itrp_ext_matches_mime(null, 'application/pdf'), 'the extension must match the type; .ppt, crossed pairs and missing extensions are refused');
select is(private.itrp_file_path_order_id('11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf')::text, '11111111-1111-1111-1111-111111111111', 'the folder of a well formed path is the request id');
select ok(private.itrp_file_path_order_id('11111111-1111-1111-1111-111111111111/มีชื่อไทย.pdf') is null and private.itrp_file_path_order_id('11111111-1111-1111-1111-111111111111/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.pdf') is null and private.itrp_file_path_order_id('x/y.pdf') is null, 'a path that is not <request>/<lower-case uuid>.<ext> gives no request');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZXA', 'แผนกทดสอบ X-A (มีผู้จัดการ)', 'ZX A'), ('ZXB', 'แผนกทดสอบ X-B (ไม่มีผู้จัดการ)', 'ZX B');
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.uid(n)::uuid, 'itf-u' || n || '@test.local', '{}'::jsonb from generate_series(1, 8) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itf.test', d.id, r.id, pg_temp.uid(v.n)::uuid, true
from (values
  (1, 'ITF-REQ1', 'ZXA', 'staff'), (2, 'ITF-REQ2', 'ZXA', 'staff'), (3, 'ITF-MGR', 'ZXA', 'department_manager'),
  (4, 'ITF-ADM', 'MGT', 'staff'), (5, 'ITF-APPR', 'MGT', 'general_manager'), (6, 'ITF-REQB', 'ZXB', 'staff'),
  (7, 'ITF-SBXADMIN', 'MGT', 'admin'), (8, 'ITF-REQ3', 'ZXA', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITF-ADM', true, false), ('ITF-APPR', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZX-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZXA', 'sbx-zx-staff@sandbox.local', (select id from public.departments where code = 'ZXA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZX-MGR', 'ทดสอบ', 'ผจก. ZXA', 'sbx-zx-mgr@sandbox.local', (select id from public.departments where code = 'ZXA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.oa', pg_temp.new_req(), true);
select set_config('t.og', pg_temp.new_req(), true);
select set_config('t.od', pg_temp.new_req(), true);
select set_config('t.oe', pg_temp.new_req(), true);
select set_config('t.orw', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.ob', pg_temp.new_req(), true);
select set_config('t.oq', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.oc', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.oh', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.og')::uuid, 'ยกเลิกเพื่อทดสอบ') $$, 'one request is cancelled for the "ended request" cases');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(public.app_itrp_get_detail(current_setting('t.oh')::uuid)->>'status', 'approved', 'the IT approver request is approved at once (auto approvals are not real approvals)');
select set_config('request.jwt.claims', pg_temp.sub(1), true);

-- 3. อัปโหลดผ่าน policy (ผู้แจ้งเท่านั้น ใน path ของใบตัวเอง) ------------------
select lives_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 1) $$, 'the requester uploads a file into the folder of the own request (no "attachment: yes" option exists)');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 1, '{"size": 2048}') $$, '23505', null, 'the same path cannot be overwritten (unique name, no upsert)');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/มีชื่อไทย.pdf', 1) $$, '42501', null, 'a path that is not <request>/<uuid>.<ext> is refused');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 2, 'exe'), 1) $$, '42501', null, 'an extension outside the allowed list is refused');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || upper(pg_temp.fn('aaaaaaaa-', 2)), 1) $$, '42501', null, 'the file name must be a lower-case uuid');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 3), 2) $$, '42501', null, 'the owner of the object must be the caller');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 5), 1) $$, '42501', null, 'no upload into the folder of another requester request');
select throws_ok($$ select pg_temp.up('itrp-files', '00000000-0000-0000-0000-000000000000/' || pg_temp.fn('aaaaaaaa-', 6), 1) $$, '42501', null, 'no upload into a folder of a request that does not exist');
select throws_ok($$ select pg_temp.up('itrp-test-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 7), 1) $$, '42501', null, 'a real request cannot receive files in the test bucket');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 8), 1) $$, '42501', null, 'no upload into a cancelled request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 9), 2) $$, '42501', null, 'a colleague cannot upload into the request of someone else');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 10), 3) $$, '42501', null, 'the department manager cannot upload into the request of an employee');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 11), 4) $$, '42501', null, 'IT cannot upload into the request of an employee');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 12), null, '{"size": 1}'::jsonb) $$, '42501', null, 'anon cannot upload');
reset role;

-- 3b. อ่านไฟล์ตามสิทธิ์เห็นใบ
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the requester sees the file of the own request');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the department manager of the requester sees the file');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the IT admin sees the file');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the IT approver (head of IT) sees the file');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 0, 'a colleague of the same department cannot see the file');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and starts_with(name, current_setting('t.oa') || '/')), 0, 'an employee of another department cannot see the file');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files'), 0, 'anon sees no file');
reset role;

-- 4. ลงทะเบียนไฟล์ (app_itrp_add_attachment) --------------------------------
-- ใส่วัตถุใน Storage แทนการอัปโหลดผ่าน API (ด้วยสิทธิ์เจ้าของฐานข้อมูล) · ขนาด/ชนิดอยู่ใน metadata เหมือน Storage จริง
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-files', current_setting('t.ob') || '/' || pg_temp.fn('aaaaaaaa-', 21), pg_temp.uid(2), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), pg_temp.uid(6), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 23), pg_temp.uid(1), '{"size": 100, "mimetype": "application/zip"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 24), pg_temp.uid(1), '{"size": 20971521, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 25), pg_temp.uid(1), '{"size": 20971520, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 26), pg_temp.uid(8), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 27), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 31, 'jpg'), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 32), pg_temp.uid(1), '{"size": 100}'),
  ('itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 33), pg_temp.uid(1), '{"mimetype": "application/pdf"}');
update storage.objects set metadata = '{"size": 2048, "mimetype": "application/pdf"}'::jsonb where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.att1', public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), '  รายงาน.pdf  ', 'application/pdf', 1)::text, true);
select ok(current_setting('t.att1')::uuid is not null, 'the uploaded file is registered and an id is returned');
select is(public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 'รายงาน.pdf', 'application/pdf', 1)::text, current_setting('t.att1'), 'registering the same path again returns the same id (safe retry)');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้', 'a file of another request cannot be registered');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, 'ไม่ใช่path', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้', 'a malformed path is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, null, 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้', 'a null path is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oc')::uuid, null, current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), 'x.pdf', 'application/pdf', 100) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบแจ้งซ่อมได้', 'only the requester can register files for a request');
select throws_ok($$ select public.app_itrp_add_attachment('00000000-0000-0000-0000-000000000000', null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'an unknown request is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 30), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'the file must exist in Storage');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 26), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'a file uploaded by somebody else cannot be registered by the caller');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 23), 'x.zip', 'application/zip', 100) $$, '23514', 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)', 'a file type outside the list is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 24), 'big.pdf', 'application/pdf', 100) $$, '23514', 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB', 'a file above 20 MB is refused (the size comes from Storage, not from the caller)');
select lives_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 25), 'exactly20.pdf', 'application/pdf', 1) $$, 'a file of exactly 20 MB is accepted');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 31, 'jpg'), 'x.jpg', 'image/jpeg', 100) $$, '23514', 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่', 'the extension in the path must match the type Storage recorded');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 32), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'a Storage object without a size is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 33), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'a Storage object without a type is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), '   ', 'application/pdf', 1) $$, '23514', 'กรุณาระบุชื่อไฟล์', 'a blank file name is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), repeat('ก', 201), 'application/pdf', 1) $$, '23514', 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร', 'a file name above 200 characters is refused');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.og')::uuid, null, current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 27), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ใบแจ้งซ่อมนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้', 'a cancelled request cannot get files');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.oa')::uuid, gen_random_uuid(), current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 23), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบรอบขอแก้ไขงานนี้', 'an unknown rework id is refused');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select pg_temp.reg(current_setting('t.ob'), pg_temp.fn('aaaaaaaa-', 21)) $$, 'a file can be registered on a request without any "attachment" choice (files are always allowed)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select mime_type || '|' || size_bytes || '|' || file_name from public.itrp_attachments where id = current_setting('t.att1')::uuid), 'application/pdf|2048|รายงาน.pdf', 'size and type come from Storage (2048), the file name is trimmed, the caller values were ignored');
select is((select uploaded_by from public.itrp_attachments where id = current_setting('t.att1')::uuid), (select id from public.employees where employee_no = 'ITF-REQ1'), 'the uploader is the requester');
select is((select count(*)::int from public.itrp_attachments where request_id = current_setting('t.oa')::uuid), 2, 'two files are registered on OA so far (the 20 MB one and the first)');

-- 4b. ≤ 10 ไฟล์ต่อครั้งที่ส่ง (ตอนแจ้ง)
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itrp-files', current_setting('t.oa') || '/' || pg_temp.fn('bbbbbbbb-', g), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}' from generate_series(1, 9) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is((select count(pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', g), 'f' || g || '.pdf')) from generate_series(1, 8) g)::int, 8, 'eight more files are registered (ten in total on OA)');
select throws_ok($$ select pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', 9), 'f9.pdf') $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง', 'the eleventh file at filing time is refused');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.oa')::uuid)->'attachments'), 10, 'get_detail lists the ten files');
select is(public.app_itrp_get_detail(current_setting('t.oa')::uuid)->'attachments'->0->>'bucket', 'itrp-files', 'each file names the bucket to download from');
select is((select count(*)::int from jsonb_array_elements(public.app_itrp_get_detail(current_setting('t.oa')::uuid)->'attachments') a where (a->>'round_no')::int = 0 and a->>'rework_id' is null), 10, 'files attached at filing time are round 0 with no rework id');
select ok(public.app_itrp_get_detail(current_setting('t.oa')::uuid)->'attachments'->0 ?& array['id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'created_at', 'uploaded_by_full_name'], 'each file entry carries the fields the page needs');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.oa')::uuid)->'attachments'), 10, 'the department manager sees the file list too');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.oa')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague cannot read the file list (no access to the request)');
select throws_ok($$ select pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', 9)) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบแจ้งซ่อมได้', 'a colleague cannot register files for the request');

-- 4c. เพดานจำนวนไฟล์ในโฟลเดอร์ (กัน spam ที่อัปโหลดแล้วไม่ลงทะเบียน) = 20 ต่อ (1 + รอบแก้ไข + ข้อความ)
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itrp-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', g), pg_temp.uid(1), '{"size": 1, "mimetype": "application/pdf"}' from generate_series(1, 19) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select pg_temp.up('itrp-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', 99), 1, '{"size": 1}') $$, 'the twentieth object in the folder is allowed');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', 98), 1, '{"size": 1}') $$, '42501', null, 'the twenty-first object in the folder is refused (anti-spam cap)');

-- 4d. ไม่มีการแก้/ลบไฟล์ผ่าน API ของบัคเก็ตจริง (policy ไม่มี UPDATE/DELETE)
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1)), 1, 'the requester cannot delete a file of the live bucket (no DELETE policy)');
update storage.objects set metadata = '{"size": 1, "mimetype": "application/pdf"}'::jsonb where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select metadata->>'size' from storage.objects where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1)), '2048', 'the requester cannot rewrite a file (no UPDATE policy)');

-- 5. หน้าต่างเวลา และการอนุมัติจริงปิดการแนบ -------------------------------
create or replace function private.itrp_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '-1 second' $$;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-files', current_setting('t.oe') || '/' || pg_temp.fn('dddddddd-', 3), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oe') || '/' || pg_temp.fn('dddddddd-', 2), 1, '{"size": 1}') $$, '42501', null, 'when the time window is over, uploads are refused by the policy');
select throws_ok($$ select pg_temp.reg(current_setting('t.oe'), pg_temp.fn('dddddddd-', 3)) $$, '23514', 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งซ่อม)', 'registering after the time window is refused');
reset role;
create or replace function private.itrp_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '30 minutes' $$;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select pg_temp.reg(current_setting('t.oe'), pg_temp.fn('dddddddd-', 3), 'ก่อนอนุมัติ.pdf') $$, 'inside the window and before any approval the file is registered');
select lives_ok($$ select pg_temp.up('itrp-files', current_setting('t.oe') || '/' || pg_temp.fn('dddddddd-', 4), 1) $$, 'and the upload is allowed too');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oe')::uuid) $$, 'the department manager really approves');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oe') || '/' || pg_temp.fn('dddddddd-', 5), 1, '{"size": 1}') $$, '42501', null, 'after a real approval the upload is refused');
select throws_ok($$ select pg_temp.reg(current_setting('t.oe'), pg_temp.fn('dddddddd-', 4)) $$, '23514', 'มีผู้อนุมัติใบแจ้งซ่อมนี้แล้ว แนบไฟล์เพิ่มไม่ได้', 'after a real approval nothing more can be registered');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-files', current_setting('t.oh') || '/' || pg_temp.fn('dddddddd-', 6), pg_temp.uid(5), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select pg_temp.reg(current_setting('t.oh'), pg_temp.fn('dddddddd-', 6)) $$, 'the automatic approvals of an IT approver filing are not real approvals: the files can still be registered');

-- 6. ไฟล์ของรอบขอแก้ไข ----------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.orw')::uuid) $$, 'the manager approves the request that will get a rework');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.orw')::uuid) $$, 'the IT approver approves it');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_start(current_setting('t.orw')::uuid) $$, 'the IT admin starts it');
select lives_ok($$ select public.app_itrp_complete(current_setting('t.orw')::uuid, 'ก', 'usage', null, 'internal', null, 'แก้', null) $$, 'and delivers it');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 1), 1, '{"size": 1}') $$, '42501', null, 'before a rework exists nobody can upload (approved request, no rework round)');
select set_config('t.rw1', (select id::text from public.app_itrp_request_rework(current_setting('t.orw')::uuid, 'ยังเสีย', ((now() at time zone 'Asia/Bangkok')::date + 2))), true);
select lives_ok($$ select pg_temp.up('itrp-files', current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 1), 1) $$, 'after asking for a rework the requester can upload files for that round');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itrp-files', current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', g), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}' from generate_series(2, 11) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select ok(public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw1')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 1), 'รอบ1.pdf', 'application/pdf', 1) is not null, 'a file is registered on the rework round');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.orw')::uuid, null, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 2), 'x.pdf', 'application/pdf', 1) $$, '23514', 'มีผู้อนุมัติใบแจ้งซ่อมนี้แล้ว แนบไฟล์เพิ่มไม่ได้', 'a file without a rework id is a filing-time file and is closed after the approvals');
select is((select count(public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw1')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', g), 'r' || g || '.pdf', 'application/pdf', 1)) from generate_series(2, 10) g)::int, 9, 'nine more files are registered (ten on the round)');
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw1')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 11), 'r11.pdf', 'application/pdf', 1) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง', 'the eleventh file of the round is refused');
select is((select count(*)::int from jsonb_array_elements(public.app_itrp_get_detail(current_setting('t.orw')::uuid)->'attachments') a where (a->>'round_no')::int = 1 and a->>'rework_id' = current_setting('t.rw1')), 10, 'the detail groups the files by rework round');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw1')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 11), 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบแจ้งซ่อมได้', 'a colleague cannot attach to the rework');
-- รอบที่ 2: แนบกับรอบที่ 1 ไม่ได้อีก
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_complete(current_setting('t.orw')::uuid, 'ข', 'usage', null, 'internal', null, 'แก้อีก', null) $$, 'IT delivers the second time');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.rw2', (select id::text from public.app_itrp_request_rework(current_setting('t.orw')::uuid, 'ยังไม่หาย', ((now() at time zone 'Asia/Bangkok')::date + 3))), true);
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-files', current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 20), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw1')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 20), 'x.pdf', 'application/pdf', 1) $$, '23514', 'แนบไฟล์ได้เฉพาะรอบขอแก้ไขงานล่าสุดของคุณ', 'only the latest rework round accepts files');
select ok(public.app_itrp_add_attachment(current_setting('t.orw')::uuid, current_setting('t.rw2')::uuid, current_setting('t.orw') || '/' || pg_temp.fn('eeeeeeee-', 20), 'รอบ2.pdf', 'application/pdf', 1) is not null, 'the latest round accepts the file');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.orw')::uuid, 'ขอข้อมูลเพิ่ม') $$, 'IT asks a question on the same request (so it has both a rework and a message)');

-- 7. ไฟล์ของข้อความถาม/ตอบ -------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.q1', (public.app_itrp_request_info(current_setting('t.oq')::uuid, 'ขอรูปอาการหน่อย')->>'comment_id'), true);
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-files', current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 1), pg_temp.uid(3), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-files', current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 2), pg_temp.uid(2), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select pg_temp.up('itrp-files', current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 3), 3, '{"size": 1}') $$, 'the author of a question can upload a file for it (the manager is not the requester)');
select set_config('t.qa1', public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.q1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 1), 'ตัวอย่าง.pdf', 'application/pdf', 1)::text, true);
select ok(current_setting('t.qa1')::uuid is not null, 'the question author registers a file on the question');
select is(public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.q1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 1), 'ตัวอย่าง.pdf', 'application/pdf', 1)::text, current_setting('t.qa1'), 'registering the same path for the same question again returns the same id');
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, 999999, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 3), 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบข้อความนี้ในใบแจ้งซ่อม', 'an unknown question id is refused');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.q1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 3), 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'a stranger who cannot see the request cannot attach');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 4), 8, '{"size": 1}') $$, '42501', null, 'a stranger cannot upload into the folder either');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.q1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 2), 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'the requester cannot attach a file to the question of the manager');
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.q1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 1), 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'the author check comes before the duplicate check');
select set_config('t.a1', (public.app_itrp_provide_info(current_setting('t.oq')::uuid, 'ส่งรูปให้แล้ว')->>'comment_id'), true);
select ok(public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.a1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('ffffffff-', 2), 'รูป.pdf', 'application/pdf', 1) is not null, 'the requester registers a file on the answer');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.oq')::uuid)->'comments'->1->'attachments'), 1, 'the answer shows its file');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.oq')::uuid)->'comments'->0->'attachments'), 1, 'the question shows its file');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.oq')::uuid)->'attachments'), 0, 'comment files are not mixed into the filing-time file list');
select is(public.app_itrp_get_detail(current_setting('t.oq')::uuid)->'comments'->0->'attachments'->0->>'bucket', 'itrp-files', 'a comment file names the bucket');
-- ≤10 ไฟล์ต่อข้อความ
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itrp-files', current_setting('t.oq') || '/' || pg_temp.fn('99999999-', g), pg_temp.uid(2), '{"size": 100, "mimetype": "application/pdf"}' from generate_series(1, 10) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is((select count(public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.a1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('99999999-', g), 'a' || g || '.pdf', 'application/pdf', 1)) from generate_series(1, 9) g)::int, 9, 'nine more files are registered on the answer (ten in total)');
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.a1')::bigint, current_setting('t.oq') || '/' || pg_temp.fn('99999999-', 10), 'a10.pdf', 'application/pdf', 1) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อข้อความ', 'the eleventh file of a message is refused');
select throws_ok($$ select public.app_itrp_add_comment_attachment(current_setting('t.oq')::uuid, current_setting('t.a1')::bigint, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 'x.pdf', 'application/pdf', 1) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบแจ้งซ่อมนี้', 'a path of another request is refused for a message too');

-- 8. เพิ่มได้อย่างเดียว ------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itrp_attachments set file_name = 'แก้' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a registered file cannot be renamed');
select throws_ok($$ delete from public.itrp_attachments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a registered file cannot be deleted from the register');
select throws_ok($$ truncate public.itrp_attachments $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the register cannot be truncated');
select throws_ok($$ insert into public.itrp_attachments (request_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) select id, '00000000-0000-0000-0000-000000000000/x.pdf', 'x', 'application/pdf', 1, requester_id from public.itrp_requests limit 1 $$, '23514', null, 'a file path outside the folder of its own request is refused by the table');
select throws_ok($$ insert into public.itrp_attachments (request_id, rework_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) select r.request_id, r.id, c.id, r.request_id::text || '/zzzzzzzz-0000-0000-0000-000000000001.pdf', 'x', 'application/pdf', 1, r.requested_by from public.itrp_reworks r join public.itrp_comments c on c.request_id = r.request_id limit 1 $$, '23514', null, 'a file cannot belong to a rework and a message at once');
select is((select count(*)::int from public.itrp_attachments where mime_type is null or size_bytes > 20971520 or size_bytes <= 0), 0, 'every registered file has a type and a size within 20 MB');

-- 9. โหมดทดสอบ: ไฟล์ทดสอบอยู่บัคเก็ตทดสอบ + ล้างข้อมูลคืนรายการไฟล์ ---------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zx_staff')::uuid) $$, 'the admin enters the test mode as a department staff persona');
select set_config('t.t1', pg_temp.new_req(), true);
select lives_ok($$ select pg_temp.up('itrp-test-files', current_setting('t.t1') || '/' || pg_temp.fn('44444444-', 2), 7) $$, 'the admin uploads a test file into the test bucket (acting as the requester persona)');
select throws_ok($$ select pg_temp.up('itrp-test-files', current_setting('t.oa') || '/' || pg_temp.fn('44444444-', 3), 7, '{"size": 1}') $$, '42501', null, 'a real request cannot receive files in the test bucket even in test mode');
select throws_ok($$ select pg_temp.up('itrp-files', current_setting('t.t1') || '/' || pg_temp.fn('44444444-', 4), 7, '{"size": 1}') $$, '42501', null, 'a test request cannot receive files in the live bucket');
select ok(public.app_itrp_add_attachment(current_setting('t.t1')::uuid, null, current_setting('t.t1') || '/' || pg_temp.fn('44444444-', 2), 'ทดสอบ.pdf', 'application/pdf', 1) is not null, 'the persona registers the test file');
select is(public.app_itrp_get_detail(current_setting('t.t1')::uuid)->'attachments'->0->>'bucket', 'itrp-test-files', 'a test file is served from the test bucket');
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-test-files' and name = current_setting('t.t1') || '/' || pg_temp.fn('44444444-', 2)), 1, 'the requester persona sees the test file');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itrp-test-files', current_setting('t.t1') || '/' || pg_temp.fn('55555555-', 1), pg_temp.uid(7), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itrp-test-files', '99999999-0000-0000-0000-000000000000/' || pg_temp.fn('55555555-', 2), pg_temp.uid(7), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itrp-test-files';
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-test-files'), 1, 'in test mode the admin can delete unregistered test files only (the registered file stays)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-test-files'), 0, 'out of test mode nobody sees the test bucket');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-test-files'), 0, 'IT staff of the real world does not see test files');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zx_staff')::uuid) $$, 'the admin re-enters the test mode');
select set_config('t.purge', public.app_sandbox_purge_itrp()::text, true);
select is(jsonb_array_length(current_setting('t.purge')::jsonb->'files'), 1, 'the purge returns the list of test files to remove through the Storage API');
select is(current_setting('t.purge')::jsonb->'files'->>0, current_setting('t.t1') || '/' || pg_temp.fn('44444444-', 2), 'it is the file that was registered');
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itrp-test-files' and name = any (array(select jsonb_array_elements_text(current_setting('t.purge')::jsonb->'files')));
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-test-files'), 0, 'after the purge the listed files can be removed through the Storage API (nothing references them any more)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode at the end');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_attachments where is_test), 0, 'no test file row is left in the register');
select ok((select count(*) from public.itrp_attachments where not is_test) >= 25, 'the real file register survived the purge');
select is((select count(*)::int from storage.objects where bucket_id = 'itrp-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1)), 1, 'the real files in the live bucket were not touched');

select * from finish();
rollback;
