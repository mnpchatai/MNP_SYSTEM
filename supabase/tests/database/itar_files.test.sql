-- ทดสอบไฟล์แนบของใบขอสิทธิ์ IT (20270107010000_itar_access_requests.sql) — Storage + ทะเบียนไฟล์
--   A) บัคเก็ต itar-files / itar-test-files + policy ของ Storage: อัปโหลดเฉพาะผู้ยื่น (ตอนยื่น) / ผู้เขียนข้อความ / IT (รูปใบรับทราบกระดาษ) ใน path ของใบ, อ่านตามสิทธิ์เห็นใบ, ไม่มี UPDATE/DELETE ของบัคเก็ตจริง
--   B) ลงทะเบียนไฟล์ตอนยื่น (app_itar_add_attachment): ชนิด/ขนาดมาจาก Storage, ≤10 ไฟล์ต่อครั้ง, หมดเวลา 30 นาที, ปิดเมื่อมีผู้อนุมัติจริง
--   C) ไฟล์ของข้อความถาม/ตอบ (app_itar_add_comment_attachment)
--   D) รูปใบรับทราบที่เซ็นด้วยกระดาษ (app_itar_add_paper_attachment) + app_itar_acknowledge_paper
--   E) โหมดทดสอบ: ไฟล์ทดสอบอยู่บัคเก็ตทดสอบ, ล้างข้อมูลทดสอบคืนรายการไฟล์ที่ต้องลบ
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (F-*) ในแผนก ZX* ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(148);

create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"2c400000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.uid(n integer) returns text language sql as $$ select '2c400000-0000-0000-0000-' || lpad(n::text, 12, '0') $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- ใบยกเลิกสิทธิ์ทั้งหมดของตัวเอง (ไม่ต้องมีรายการสิทธิ์ จึงไม่ต้องพึ่งข้อมูลทะเบียน)
create function pg_temp.new_req() returns text language sql as $$
  select (select id::text from public.app_itar_create('revoke_all', 'ทดสอบไฟล์แนบ')) $$;
-- ชื่อไฟล์ <uuid>.<นามสกุล> จากเลขลำดับ (prefix p ทำให้แต่ละหมวดไม่ชนกัน)
create function pg_temp.fn(p text, n integer, ext text default 'pdf') returns text language sql as $$
  select p || '0000-0000-0000-' || lpad(n::text, 12, '0') || '.' || ext $$;
-- อัปโหลดเข้า Storage ตามสิทธิ์ของ role ปัจจุบัน (ผ่าน policy จริง)
create function pg_temp.up(p_bucket text, p_name text, p_owner integer, p_meta jsonb default '{"size": 100, "mimetype": "application/pdf"}') returns void language sql as $$
  insert into storage.objects (bucket_id, name, owner_id, metadata) values (p_bucket, p_name, pg_temp.uid(p_owner), p_meta) $$;
-- ลงทะเบียนไฟล์ตอนยื่น
create function pg_temp.reg(p_req text, p_file text, p_label text default 'f.pdf') returns uuid language sql as $$
  select public.app_itar_add_attachment(p_req::uuid, p_req || '/' || p_file, p_label, 'application/pdf', 1) $$;
create function pg_temp.seen(p_bucket text, p_req text) returns integer language sql as $$
  select count(*)::int from storage.objects where bucket_id = p_bucket and starts_with(name, p_req || '/') $$;

-- 1. โครงสร้าง + บัคเก็ต + policy ------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from storage.buckets where id in ('itar-files', 'itar-test-files') and not public and file_size_limit = 20971520), 2, 'both buckets exist, are private and are limited to 20 MB');
select ok((select bool_and(b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] and cardinality(b.allowed_mime_types) = 13) from storage.buckets b where b.id in ('itar-files', 'itar-test-files')), 'both buckets accept the 13 file types');
select ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('itar_files_read', 'itar_files_upload', 'itar_test_files_read', 'itar_test_files_upload', 'itar_test_files_delete')) = 5, 'the five itar storage policies exist');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'itar\_%' and (cmd = 'UPDATE' or cmd = 'ALL' or (policyname like 'itar\_files\_%' and cmd = 'DELETE'))), 'no itar policy allows UPDATE, ALL, or DELETE on the live bucket');
select ok((select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_storage\_%') = 3 and not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_storage\_%' and (not has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 'the three storage helpers are callable by authenticated only');
select ok(private.itar_ext_matches_mime('x/y.pdf', 'application/pdf') and not private.itar_ext_matches_mime('x/y.pdf', 'image/jpeg') and not private.itar_ext_matches_mime('x/y.ppt', 'application/vnd.ms-powerpoint') and not private.itar_ext_matches_mime(null, 'application/pdf'), 'the extension must match the mime type (and .ppt is not accepted)');
select is(private.itar_file_path_request_id('11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf')::text, '11111111-1111-1111-1111-111111111111', 'the folder of a well formed path is the request id');
select ok(private.itar_file_path_request_id('11111111-1111-1111-1111-111111111111/มีชื่อไทย.pdf') is null and private.itar_file_path_request_id('11111111-1111-1111-1111-111111111111/AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA.pdf') is null and private.itar_file_path_request_id('11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.exe') is null and private.itar_file_path_request_id('x/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf') is null, 'any other path shape has no request folder');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZXA', 'แผนกทดสอบ X-A (มีผู้จัดการ)', 'ZX A'), ('ZXB', 'แผนกทดสอบ X-B (ไม่มีผู้จัดการ)', 'ZX B'), ('ZXM', 'แผนกทดสอบ X-M (ทีม IT)', 'ZX M');
insert into auth.users (id, email, raw_user_meta_data)
select pg_temp.uid(n)::uuid, 'itaf-u' || n || '@test.local', '{}'::jsonb from generate_series(1, 8) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itaf.test', d.id, r.id, pg_temp.uid(v.n)::uuid, true
from (values
  (1, 'F-REQ1', 'ZXA', 'staff'), (2, 'F-REQ2', 'ZXA', 'staff'), (3, 'F-MGR', 'ZXA', 'department_manager'),
  (4, 'F-ADM', 'ZXM', 'staff'), (5, 'F-HEAD', 'ZXM', 'staff'), (6, 'F-REQB', 'ZXB', 'staff'),
  (7, 'F-SBXADMIN', 'ZXM', 'admin'), (8, 'F-REQ3', 'ZXA', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer)
select e.id, v.adm, v.appr, v.head from (values ('F-ADM', true, true, false), ('F-HEAD', false, false, true)) v(no, adm, appr, head)
join public.employees e on e.employee_no = v.no;
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no = 'F-ADM';
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZX-STAFF', 'ทดสอบ', 'ผู้ยื่น ZXA', 'sbx-zx-staff@sandbox.local', (select id from public.departments where code = 'ZXA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZX-MGR', 'ทดสอบ', 'ผจก. ZXA', 'sbx-zx-mgr@sandbox.local', (select id from public.departments where code = 'ZXA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('t.e_f_req3', (select id::text from public.employees where employee_no = 'F-REQ3'), true));

set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itua_save_folder('FF', 'แชร์ทดสอบไฟล์', null, 10) $$, 'a folder for the paper flow');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "f.noacct", "name_th": "ผู้ใช้ไม่มีบัญชี", "department_code": "ZXB", "division": "office"}'::jsonb) $$, 'a register user without an employee account');
select set_config('t.u_noacct', (select (e ->> 'id') from jsonb_array_elements(public.app_itua_list_users('f.noacct') -> 'items') e limit 1), true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.oa', pg_temp.new_req(), true);
select set_config('t.og', pg_temp.new_req(), true);
select set_config('t.od', pg_temp.new_req(), true);
select set_config('t.oe', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.ob', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.oc', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(4), true);
-- IT ยื่นแทนผู้ใช้ทะเบียนที่ไม่มีบัญชี (ใบสำหรับทดสอบรูปใบรับทราบกระดาษ)
select set_config('t.op', (select id::text from public.app_itar_create('change', 'ขอสิทธิ์ให้ผู้ใช้ไม่มีบัญชี', '[{"kind":"folder","target":"FF","from":null,"to":"R"}]'::jsonb, jsonb_build_object('user_id', current_setting('t.u_noacct')))), true);
-- IT ยื่นแทนพนักงานที่มีบัญชี (ใบสำหรับทดสอบอ่านไฟล์ของผู้รับสิทธิ์)
select set_config('t.os', (select id::text from public.app_itar_create('change', 'ขอสิทธิ์แทนพนักงาน', '[{"kind":"folder","target":"FF","to":"R"}]'::jsonb, jsonb_build_object('employee_id', current_setting('t.e_f_req3')))), true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itar_cancel(current_setting('t.og')::uuid, 'ยกเลิกเพื่อทดสอบ') $$, 'one request is cancelled for the "ended request" cases');
select is(public.app_itar_get_detail(current_setting('t.oa')::uuid) ->> 'status', 'pending_dept', 'oa waits for the department manager');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(public.app_itar_get_detail(current_setting('t.oc')::uuid) ->> 'status', 'pending_it_mgr', 'oc (no department manager) waits for the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(1), true);

-- 3. อัปโหลดผ่าน policy (ผู้ยื่นเท่านั้น ใน path ของใบตัวเอง ภายในหน้าต่างเวลา) ----------
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 1) $$, 'the requester uploads a file into the folder of the own request');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 1, '{"size": 2048}') $$, '23505', null, 'the same path cannot be overwritten (unique name, no upsert)');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/มีชื่อไทย.pdf', 1) $$, '42501', null, 'a path that is not <request>/<uuid>.<ext> is refused');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 2, 'exe'), 1) $$, '42501', null, 'an extension outside the allowed list is refused');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || upper(pg_temp.fn('aaaaaaaa-', 2)), 1) $$, '42501', null, 'the file name must be a lower-case uuid');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 3), 2) $$, '42501', null, 'the owner of the object must be the caller');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 5), 1) $$, '42501', null, 'no upload into the folder of another requester request');
select throws_ok($$ select pg_temp.up('itar-files', '00000000-0000-0000-0000-000000000000/' || pg_temp.fn('aaaaaaaa-', 6), 1) $$, '42501', null, 'no upload into a folder of a request that does not exist');
select throws_ok($$ select pg_temp.up('itar-test-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 7), 1) $$, '42501', null, 'a real request cannot receive files in the test bucket');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 8), 1) $$, '42501', null, 'no upload into a cancelled request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 9), 2) $$, '42501', null, 'a colleague cannot upload into the request of someone else');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 10), 3) $$, '42501', null, 'the department manager cannot upload into the request of an employee');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 11), 4) $$, '42501', null, 'IT cannot upload into the request of an employee (the paper window is only for requests waiting for the acknowledgement)');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.os') || '/' || pg_temp.fn('aaaaaaaa-', 13), 8) $$, '42501', null, 'the subject (not the requester) cannot upload initial files either');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 12), null, '{"size": 1}'::jsonb) $$, '42501', null, 'anon cannot upload');
reset role;

-- 3b. อ่านตามสิทธิ์เห็นใบ
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 1, 'the requester sees the file of the own request');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 1, 'the department manager of the subject sees the file');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 1, 'the IT admin sees the file');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 1, 'the IT head (viewer) sees the file');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 0, 'a colleague of the same department cannot see the file');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 0, 'an employee of another department cannot see the file');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 0, 'anon sees no file');
reset role;

-- 4. ลงทะเบียนไฟล์ตอนยื่น (app_itar_add_attachment) ----------------------------
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itar-files', current_setting('t.ob') || '/' || pg_temp.fn('aaaaaaaa-', 21), pg_temp.uid(2), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), pg_temp.uid(6), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 23), pg_temp.uid(1), '{"size": 100, "mimetype": "application/zip"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 24), pg_temp.uid(1), '{"size": 20971521, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 25), pg_temp.uid(1), '{"size": 20971520, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 26), pg_temp.uid(8), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 27), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 31, 'jpg'), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 32), pg_temp.uid(1), '{"size": 100}'),
  ('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 33), pg_temp.uid(1), '{"mimetype": "application/pdf"}');
update storage.objects set metadata = '{"size": 2048, "mimetype": "application/pdf"}'::jsonb where bucket_id = 'itar-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.att1', public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), '  รายงาน.pdf  ', 'application/pdf', 1)::text, true);
select ok(current_setting('t.att1')::uuid is not null, 'the uploaded file is registered and an id is returned');
select is(public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 'รายงาน.pdf', 'application/pdf', 1)::text, current_setting('t.att1'), 'registering the same path again (after a lost connection) returns the same registration');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบขอสิทธิ์นี้', 'a path in the folder of another request is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, null, 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบขอสิทธิ์นี้', 'a null path is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oc')::uuid, current_setting('t.oc') || '/' || pg_temp.fn('aaaaaaaa-', 22), 'x.pdf', 'application/pdf', 100) $$, '42501', 'เฉพาะผู้ยื่นเท่านั้นที่แนบไฟล์ให้ใบขอสิทธิ์ได้', 'only the requester can attach');
select throws_ok($$ select public.app_itar_add_attachment('00000000-0000-0000-0000-000000000000', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบใบขอสิทธิ์นี้', 'an unknown request is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 30), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'a path that was never uploaded is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 26), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'a file uploaded by somebody else cannot be registered');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 23), 'x.zip', 'application/zip', 100) $$, '23514', 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)', 'an unsupported type (from Storage) is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 24), 'big.pdf', 'application/pdf', 100) $$, '23514', 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB', 'a file over 20 MB (from Storage) is refused');
select lives_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 25), 'exactly20.pdf', 'application/pdf', 1) $$, 'a file of exactly 20 MB is accepted');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 31, 'jpg'), 'x.jpg', 'image/jpeg', 100) $$, '23514', 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่', 'a file whose extension does not match its stored type is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 32), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'an object without a stored type is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 33), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'an object without a stored size is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), '   ', 'application/pdf', 1) $$, '23514', 'กรุณาระบุชื่อไฟล์', 'a blank file name is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.oa')::uuid, current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1), repeat('ก', 201), 'application/pdf', 1) $$, '23514', 'ชื่อไฟล์ต้องไม่เกิน 200 ตัวอักษร', 'a file name over 200 characters is refused');
select throws_ok($$ select public.app_itar_add_attachment(current_setting('t.og')::uuid, current_setting('t.og') || '/' || pg_temp.fn('aaaaaaaa-', 27), 'x.pdf', 'application/pdf', 100) $$, '23514', 'ใบขอสิทธิ์นี้สิ้นสุดแล้วหรือบันทึกลงทะเบียนแล้ว แนบไฟล์ไม่ได้', 'a cancelled request refuses files');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select pg_temp.reg(current_setting('t.ob'), pg_temp.fn('aaaaaaaa-', 21)) $$, 'another requester registers a file on his own request');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select mime_type || '|' || size_bytes || '|' || file_name from public.itar_attachments where id = current_setting('t.att1')::uuid), 'application/pdf|2048|รายงาน.pdf', 'size and type come from Storage (2048), the file name is trimmed, the values sent by the caller are ignored');
select is((select uploaded_by from public.itar_attachments where id = current_setting('t.att1')::uuid), (select id from public.employees where employee_no = 'F-REQ1'), 'the uploader is the requester');
select is((select count(*)::int from public.itar_attachments where request_id = current_setting('t.oa')::uuid), 2, 'two files are registered on oa so far');

-- 4b. ≤ 10 ไฟล์ต่อครั้งที่ยื่น
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itar-files', current_setting('t.oa') || '/' || pg_temp.fn('bbbbbbbb-', g), pg_temp.uid(1), '{"size": 100, "mimetype": "application/pdf"}' from generate_series(1, 9) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is((select count(pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', g), 'f' || g || '.pdf')) from generate_series(1, 8) g)::int, 8, 'eight more files are registered (ten in total on oa)');
select throws_ok($$ select pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', 9), 'f9.pdf') $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ยื่น', 'the eleventh file at filing time is refused');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.oa')::uuid) -> 'attachments'), 10, 'get_detail lists the ten files');
select is(public.app_itar_get_detail(current_setting('t.oa')::uuid) -> 'attachments' -> 0 ->> 'bucket', 'itar-files', 'each file names the bucket to download from');
select ok(public.app_itar_get_detail(current_setting('t.oa')::uuid) -> 'attachments' -> 0 ?& array['id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'created_at', 'uploaded_by_full_name'], 'each file entry carries the fields the page needs');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.oa')::uuid) -> 'paper_attachments'), 0, 'and no paper-acknowledgement photo yet');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.oa')::uuid) -> 'attachments'), 10, 'the department manager sees the file list too');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itar_get_detail(current_setting('t.oa')::uuid) $$, '42501', 'ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague cannot read the file list');
select throws_ok($$ select pg_temp.reg(current_setting('t.oa'), pg_temp.fn('bbbbbbbb-', 9)) $$, '42501', 'เฉพาะผู้ยื่นเท่านั้นที่แนบไฟล์ให้ใบขอสิทธิ์ได้', 'a colleague cannot register a file on it either');

-- 4c. เพดานจำนวนไฟล์ในโฟลเดอร์ (กัน spam ที่อัปโหลดแล้วไม่ลงทะเบียน) = 20 ต่อ (2 + ข้อความ)
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itar-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', g), pg_temp.uid(1), '{"size": 1, "mimetype": "application/pdf"}' from generate_series(1, 39) g;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', 99), 1, '{"size": 1}') $$, 'the fortieth object in the folder is allowed');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.od') || '/' || pg_temp.fn('cccccccc-', 98), 1, '{"size": 1}') $$, '42501', null, 'the forty-first object in the folder is refused (anti-spam cap)');

-- 4d. ไม่มีการแก้/ลบไฟล์ผ่าน API ของบัคเก็ตจริง (policy ไม่มี UPDATE/DELETE)
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itar-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itar-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1)), 1, 'the requester cannot delete a file of the live bucket (no DELETE policy)');
update storage.objects set metadata = '{"size": 1, "mimetype": "application/pdf"}'::jsonb where bucket_id = 'itar-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1);
reset role;
select is((select metadata ->> 'size' from storage.objects where bucket_id = 'itar-files' and name = current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 1)), '2048', 'the requester cannot rewrite a file (no UPDATE policy)');
select throws_ok(format($$ update public.itar_attachments set file_name = 'x' where id = '%s' $$, current_setting('t.att1')), '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a registration cannot be edited');
select throws_ok(format($$ delete from public.itar_attachments where id = '%s' $$, current_setting('t.att1')), '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'or deleted');

-- 5. หน้าต่างเวลา 30 นาที + ปิดเมื่อมีผู้อนุมัติจริง ------------------------------
select set_config('request.jwt.claims', '', true);
create or replace function private.itar_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '-1 second' $$;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.ob') || '/' || pg_temp.fn('aaaaaaaa-', 41), 2) $$, '42501', null, 'after the window closes the requester cannot upload any more');
reset role;
create or replace function private.itar_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '30 minutes' $$;
select set_config('request.jwt.claims', '', true);
-- ผู้จัดการแผนกอนุมัติ oa แล้ว: แนบเพิ่มไม่ได้อีก
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select public.app_itar_approve(current_setting('t.oa')::uuid) $$, 'the department manager approves oa');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('aaaaaaaa-', 42), 1) $$, '42501', null, 'once somebody else has approved, no more files can be uploaded');
select throws_ok($$ select pg_temp.reg(current_setting('t.oa'), pg_temp.fn('aaaaaaaa-', 23), 'late.pdf') $$, '23514', 'มีผู้อนุมัติใบขอสิทธิ์นี้แล้ว แนบไฟล์เพิ่มไม่ได้', 'nor registered (the check order: approvals before the file itself)');

-- 6. ไฟล์ของข้อความถาม/ตอบ -----------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.cq', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.cq_q', (public.app_itar_request_info(current_setting('t.cq')::uuid, 'ขอเอกสารประกอบ') ->> 'comment_id'), true);
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 1), 3) $$, 'the person who asked can upload a file for his question');
select lives_ok($$ select public.app_itar_add_comment_attachment(current_setting('t.cq')::uuid, current_setting('t.cq_q')::bigint, current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 1), 'ตัวอย่างฟอร์ม.pdf', 'application/pdf', 1) $$, 'and register it on the question');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 2), 4) $$, '42501', null, 'IT, who wrote nothing, cannot upload into the folder of this request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 3), 2) $$, 'the requester can upload while the first window is open (initial files)');
select is(pg_temp.try(format($$ select public.app_itar_add_comment_attachment('%s', %s, '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.cq'), current_setting('t.cq_q'), current_setting('t.cq'), pg_temp.fn('dddddddd-', 3))), '42501: เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'only the author of a message can attach to it');
select set_config('t.cq_a', (public.app_itar_provide_info(current_setting('t.cq')::uuid, 'แนบมาให้แล้ว') ->> 'comment_id'), true);
select lives_ok($$ select public.app_itar_add_comment_attachment(current_setting('t.cq')::uuid, current_setting('t.cq_a')::bigint, current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 3), 'คำตอบ.pdf', 'application/pdf', 1) $$, 'the requester attaches the file to his answer');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.cq')::uuid) -> 'comments' -> 0 -> 'attachments'), 1, 'the question lists its file');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.cq')::uuid) -> 'comments' -> 1 -> 'attachments'), 1, 'the answer lists its file');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.cq')::uuid) -> 'attachments'), 0, 'comment files are not mixed into the initial list');
select throws_ok($$ select public.app_itar_add_comment_attachment(current_setting('t.cq')::uuid, 999999, current_setting('t.cq') || '/' || pg_temp.fn('dddddddd-', 3), 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบข้อความนี้ในใบขอสิทธิ์', 'an unknown message is refused');
select is(pg_temp.try(format($$ select public.app_itar_add_comment_attachment('%s', %s, '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.cq'), current_setting('t.cq_a'), current_setting('t.cq'), pg_temp.fn('dddddddd-', 3))), 'OK', 'registering the same path again for the same message returns the existing registration');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(pg_temp.try(format($$ select public.app_itar_add_comment_attachment('%s', %s, '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.cq'), current_setting('t.cq_a'), current_setting('t.cq'), pg_temp.fn('dddddddd-', 3))), '23514: ไม่พบใบขอสิทธิ์นี้', 'someone who cannot see the request cannot attach to it');

-- 7. รูปใบรับทราบกระดาษ: ใบของผู้ใช้ทะเบียนที่ไม่มีบัญชี ----------------------
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itar_approve(current_setting('t.op')::uuid) $$, 'the IT head approves the request IT filed (IT approver is the requester)');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itar_start(current_setting('t.op')::uuid) $$, 'IT takes the work');
select is(pg_temp.try(format($$ select public.app_itar_add_paper_attachment('%s', '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.op'), current_setting('t.op'), pg_temp.fn('eeeeeeee-', 1))), '23514: แนบรูปใบรับทราบได้เฉพาะใบที่ IT บันทึกสิทธิ์ลงทะเบียนแล้วและรอผู้ใช้รับทราบ', 'the paper photo cannot be attached before the apply');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.op') || '/' || pg_temp.fn('eeeeeeee-', 1), 4) $$, '42501', null, 'nor uploaded');
select lives_ok($$ select public.app_itar_apply(current_setting('t.op')::uuid, (select jsonb_agg(jsonb_build_object('item_id', i ->> 'id', 'decision', 'applied')) from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.op')::uuid) -> 'items') i)) $$, 'IT records the rights');
select is(public.app_itar_get_detail(current_setting('t.op')::uuid) ->> 'status', 'awaiting_ack', 'the request waits for the acknowledgement');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.op'))), '23514: กรุณาแนบรูปใบรับทราบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ก่อน', 'the acknowledgement needs the photo first');
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.op') || '/' || pg_temp.fn('eeeeeeee-', 1, 'jpg'), 4, '{"size": 5000, "mimetype": "image/jpeg"}') $$, 'IT uploads the photo of the signed paper');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.oa') || '/' || pg_temp.fn('eeeeeeee-', 2, 'jpg'), 4, '{"size": 5000, "mimetype": "image/jpeg"}') $$, '42501', null, 'but only in a request that waits for a paper acknowledgement');
select set_config('t.paper1', public.app_itar_add_paper_attachment(current_setting('t.op')::uuid, current_setting('t.op') || '/' || pg_temp.fn('eeeeeeee-', 1, 'jpg'), 'ใบเซ็น.jpg', 'image/jpeg', 1)::text, true);
select is(public.app_itar_add_paper_attachment(current_setting('t.op')::uuid, current_setting('t.op') || '/' || pg_temp.fn('eeeeeeee-', 1, 'jpg'), 'ใบเซ็น.jpg', 'image/jpeg', 1)::text, current_setting('t.paper1'), 'registering the same photo again returns the same registration');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.op')::uuid) -> 'paper_attachments'), 1, 'the detail lists the paper photo separately');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.op')::uuid) -> 'attachments'), 0, 'and not among the files of the filing');
select is(pg_temp.try(format($$ select public.app_itar_add_paper_attachment('%s', '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.oa'), current_setting('t.oa'), pg_temp.fn('eeeeeeee-', 3))), '23514: แนบรูปใบรับทราบได้เฉพาะใบที่ IT บันทึกสิทธิ์ลงทะเบียนแล้วและรอผู้ใช้รับทราบ', 'the paper photo of a request that is not waiting for it is refused');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s', repeat('ก', 301)) $$, current_setting('t.op'))), '23514: หมายเหตุต้องไม่เกิน 300 ตัวอักษร', 'the paper note is limited');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.seen('itar-files', current_setting('t.op')), 1, 'the IT head sees the paper photo');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.op'))), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการรับทราบด้วยกระดาษได้', 'the IT head (read only) cannot record the paper acknowledgement');
select is(pg_temp.try(format($$ select public.app_itar_add_paper_attachment('%s', '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.op'), current_setting('t.op'), pg_temp.fn('eeeeeeee-', 1, 'jpg'))), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่แนบรูปใบรับทราบที่เซ็นแล้วได้', 'nor attach a paper photo');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itar_acknowledge_paper(current_setting('t.op')::uuid, 'ผู้ใช้เซ็นต่อหน้า') $$, 'IT records the paper acknowledgement');
select is(public.app_itar_get_detail(current_setting('t.op')::uuid) ->> 'status', 'done', 'the request is done');
select is(public.app_itar_get_detail(current_setting('t.op')::uuid) -> 'acknowledged' ->> 'method', 'paper', 'the detail says the acknowledgement was made on paper');
select is(public.app_itar_get_detail(current_setting('t.op')::uuid) -> 'events' -> -1 ->> 'reason', 'IT บันทึกการรับทราบด้วยกระดาษ (แนบรูปใบที่เซ็นแล้ว): ผู้ใช้เซ็นต่อหน้า', 'the history says who recorded it and the note');
select is(pg_temp.try(format($$ select public.app_itar_add_paper_attachment('%s', '%s/%s', 'x.pdf', 'application/pdf', 1) $$, current_setting('t.op'), current_setting('t.op'), pg_temp.fn('eeeeeeee-', 5))), '23514: แนบรูปใบรับทราบได้เฉพาะใบที่ IT บันทึกสิทธิ์ลงทะเบียนแล้วและรอผู้ใช้รับทราบ', 'no more photos after the acknowledgement');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select a.snapshot ->> 'method' from public.itua_acknowledgements a where a.request_id = current_setting('t.op')::uuid), 'paper', 'the register acknowledgement says paper');
select is((select e.employee_no from public.itua_acknowledgements a join public.employees e on e.id = a.acknowledged_by where a.request_id = current_setting('t.op')::uuid), 'F-ADM', 'signed by the IT admin who recorded it');
select is((select a.snapshot ->> 'note' from public.itua_acknowledgements a where a.request_id = current_setting('t.op')::uuid), 'ผู้ใช้เซ็นต่อหน้า', 'with the note');
select is((select is_paper_ack from public.itar_attachments where id = current_setting('t.paper1')::uuid), true, 'the photo is flagged as a paper acknowledgement file');

-- 7b. ผู้รับสิทธิ์มีบัญชีแต่บัญชีถูกปิดภายหลัง (ใบค้าง awaiting_ack): IT ใช้ใบรับทราบกระดาษได้ · ตอนบัญชียังใช้งานอยู่ต้องกดเองเท่านั้น ----------
reset role;
select set_config('request.jwt.claims', '', true);
insert into auth.users (id, email, raw_user_meta_data) values (pg_temp.uid(9)::uuid, 'itaf-u9@test.local', '{}'::jsonb);
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select 'F-REQ4', 'ทดสอบ', 'F-REQ4', 'f-req4@itaf.test', d.id, r.id, pg_temp.uid(9)::uuid, true
from public.departments d, public.roles r where d.code = 'ZXB' and r.code = 'staff';
select count(set_config('t.e_f_req4', (select id::text from public.employees where employee_no = 'F-REQ4'), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itua_save_user(null, '{"auth_id": "f.dis", "name_th": "ผู้ใช้บัญชีถูกปิด", "department_code": "ZXB", "division": "office", "employee_id": "%s"}'::jsonb) $$, current_setting('t.e_f_req4')), 'a register user linked to the employee F-REQ4');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select set_config('t.od2', (select id::text from public.app_itar_create('change', 'ขอสิทธิ์ก่อนบัญชีถูกปิด', '[{"kind":"folder","target":"FF","from":null,"to":"R"}]'::jsonb)), true);
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itar_approve(current_setting('t.od2')::uuid) $$, 'the IT approver approves (department without a manager)');
select lives_ok($$ select public.app_itar_start(current_setting('t.od2')::uuid) $$, 'IT takes the work');
select lives_ok($$ select public.app_itar_apply(current_setting('t.od2')::uuid, (select jsonb_agg(jsonb_build_object('item_id', i ->> 'id', 'decision', 'applied')) from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'items') i)) $$, 'IT records the rights');
select is(public.app_itar_get_detail(current_setting('t.od2')::uuid) ->> 'status', 'awaiting_ack', 'the request waits for the subject (the account is still active)');
select ok(not (public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'allowed_actions' ?| array['acknowledge_paper', 'add_paper_attachment']), 'while the account is active IT is not offered the paper acknowledgement');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.od2'))), '23514: ผู้รับสิทธิ์คนนี้มีบัญชีในระบบ ต้องกดรับทราบเองในระบบ (ไม่ใช้ใบกระดาษ)', 'and cannot record the paper acknowledgement');
select is(pg_temp.try(format($$ select public.app_itar_add_paper_attachment('%s', '%s/%s', 'x.jpg', 'image/jpeg', 1) $$, current_setting('t.od2'), current_setting('t.od2'), pg_temp.fn('eeeeeeee-', 21, 'jpg'))), '23514: ผู้รับสิทธิ์คนนี้มีบัญชีในระบบ ต้องกดรับทราบเองในระบบ (ไม่ใช้ใบกระดาษ)', 'nor register a paper photo');
select throws_ok($$ select pg_temp.up('itar-files', current_setting('t.od2') || '/' || pg_temp.fn('eeeeeeee-', 21, 'jpg'), 4, '{"size": 5000, "mimetype": "image/jpeg"}') $$, '42501', null, 'nor upload one into the folder');
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = false where employee_no = 'F-REQ4';
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.od2'))), '42501: ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT', 'after the account is closed the subject cannot acknowledge online any more');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select ok(public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'allowed_actions' ?& array['acknowledge_paper', 'add_paper_attachment'], 'IT is now offered the paper acknowledgement and the upload');
select ok(not (public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'allowed_actions' ? 'acknowledge'), 'but not the online acknowledgement');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.od2'))), '23514: กรุณาแนบรูปใบรับทราบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ก่อน', 'the photo of the signed paper is still required');
select lives_ok($$ select pg_temp.up('itar-files', current_setting('t.od2') || '/' || pg_temp.fn('eeeeeeee-', 21, 'jpg'), 4, '{"size": 5000, "mimetype": "image/jpeg"}') $$, 'IT uploads the photo of the signed paper');
select lives_ok($$ select public.app_itar_add_paper_attachment(current_setting('t.od2')::uuid, current_setting('t.od2') || '/' || pg_temp.fn('eeeeeeee-', 21, 'jpg'), 'ใบเซ็น.jpg', 'image/jpeg', 1) $$, 'and registers it');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.od2'))), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการรับทราบด้วยกระดาษได้', 'the IT head (read only) still cannot record it');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itar_acknowledge_paper(current_setting('t.od2')::uuid, 'ลาออกก่อนรับทราบ') $$, 'IT records the paper acknowledgement for the closed account');
select is(public.app_itar_get_detail(current_setting('t.od2')::uuid) ->> 'status', 'done', 'the request is done');
select is(public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'acknowledged' ->> 'method', 'paper', 'the acknowledgement is marked as paper');
select ok((public.app_itar_get_detail(current_setting('t.od2')::uuid) -> 'events' -> -1 ->> 'reason') like '%บัญชีของผู้รับสิทธิ์ถูกปิดใช้งานแล้ว%', 'and the history says why the paper was used');
reset role;
select set_config('request.jwt.claims', '', true);

-- 8. ผู้รับสิทธิ์ (ไม่ใช่ผู้ยื่น) อ่านไฟล์ของใบที่ IT ยื่นแทน ---------------------
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itar-files', current_setting('t.os') || '/' || pg_temp.fn('ffffffff-', 1), pg_temp.uid(4), '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.seen('itar-files', current_setting('t.os')), 1, 'the subject (an employee with an account) can read the files of a request IT filed for him');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.seen('itar-files', current_setting('t.os')), 0, 'but a colleague cannot');
reset role;

-- 9. โหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zx_staff')::uuid) $$, 'the admin enters the test mode as the requester persona');
select set_config('t.t1', pg_temp.new_req(), true);
select is(pg_temp.try(format($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itar-test-files', '%s/%s', '%s', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, current_setting('t.t1'), pg_temp.fn('aaaaaaaa-', 51), pg_temp.uid(7))), 'OK', 'a persona uploads into the test bucket (the owner is the admin session)');
select throws_ok(format($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itar-files', '%s/%s', '%s', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, current_setting('t.t1'), pg_temp.fn('aaaaaaaa-', 52), pg_temp.uid(7)), '42501', null, 'a test request cannot receive files in the real bucket');
select is(pg_temp.try(format($$ select public.app_itar_add_attachment('%s', '%s/%s', 'ทดสอบ.pdf', 'application/pdf', 1) $$, current_setting('t.t1'), current_setting('t.t1'), pg_temp.fn('aaaaaaaa-', 51))), 'OK', 'the file is registered on the test request');
select is(public.app_itar_get_detail(current_setting('t.t1')::uuid) -> 'attachments' -> 0 ->> 'bucket', 'itar-test-files', 'the detail points to the test bucket');
select is(pg_temp.seen('itar-files', current_setting('t.oa')), 0, 'a persona cannot see the real files');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.seen('itar-test-files', current_setting('t.t1')), 0, 'a real user cannot see the test file');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zx_staff')::uuid) $$, 'the admin re-enters the test mode');
select is(public.app_sandbox_purge_itar() -> 'files' ->> 0, current_setting('t.t1') || '/' || pg_temp.fn('aaaaaaaa-', 51), 'the purge returns the files of the test bucket for the page to delete through the Storage API');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode at the end');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_attachments where is_test), 0, 'and removed the test registrations');
select is((select count(*)::int from public.itar_attachments where not is_test), 15, 'the real registrations survived the purge (11 on oa/ob, 2 comment files, 2 paper photos)');

select * from finish();
rollback;
