-- Local-only Storage metadata fixtures simulate the API; all changes roll back.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

select is((select public from storage.buckets where id='ncr-test-attachments'), false, 'test bucket is private');
select is((select file_size_limit from storage.buckets where id='ncr-test-attachments'), 20971520::bigint, 'test files retain the 20 MB limit');
select ok(not has_function_privilege('anon','public.app_sandbox_begin_ncr_file_cleanup()','execute')
  and not has_function_privilege('anon','public.app_sandbox_finish_ncr_file_cleanup()','execute'), 'anonymous callers cannot start or finish cleanup');
select ok(not has_function_privilege('authenticated','private.sandbox_persona()','execute'), 'the persona lookup remains private');
select ok(not has_table_privilege('authenticated','public.sandbox_sessions','update'), 'clients cannot set the cleanup flag directly');

insert into auth.users(id,email,raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001','ncr-files-admin@test.local','{}'),
  ('83000000-0000-0000-0000-000000000002','ncr-files-staff@test.local','{}');
insert into public.employees(id,employee_no,first_name,last_name,email,department_id,role_id,auth_user_id) values
  ('83000000-0000-0000-0000-000000000101','NCR-FILES-ADMIN','Files','Admin','ncr-files-admin@test.local',
   (select id from public.departments where code='FT'),(select id from public.roles where code='admin'),'83000000-0000-0000-0000-000000000001'),
  ('83000000-0000-0000-0000-000000000102','NCR-FILES-STAFF','Files','Staff','ncr-files-staff@test.local',
   (select id from public.departments where code='RB'),(select id from public.roles where code='staff'),'83000000-0000-0000-0000-000000000002');
select set_config('test.file_persona',(select id::text from public.employees where employee_no='SBX-RB-STAFF'),true);
select set_config('test.other_persona',(select id::text from public.employees where employee_no='SBX-PK-STAFF'),true);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
select throws_ok('select public.app_sandbox_begin_ncr_file_cleanup()','NOT_AUTHORIZED','staff cannot get cleanup access');
select throws_ok('select public.app_sandbox_finish_ncr_file_cleanup()','NOT_AUTHORIZED','staff cannot finish another user cleanup');
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select throws_ok('select public.app_sandbox_begin_ncr_file_cleanup()','SANDBOX_NOT_ACTIVE','admin must enter sandbox first');
select set_config('test.files_real',public.app_ncr_issue('FILES_REAL',100,10,'ชิ้น','in_process','DIM','หลักฐานจริง')->>'id',true);
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-attachments',current_setting('test.files_real')||'/real.pdf','83000000-0000-0000-0000-000000000001','{"size":100,"mimetype":"application/pdf"}')$$,
  'live uploads continue working outside sandbox');
select lives_ok($$select public.app_ncr_add_attachment(current_setting('test.files_real')::uuid,'report',current_setting('test.files_real')||'/real.pdf','real.pdf')$$,
  'live evidence is registered as before');
select set_config('test.notifications_before',(select count(*)::text from public.notifications),true);
select public.app_sandbox_enter(current_setting('test.file_persona')::uuid);
select set_config('test.files_test',public.app_ncr_issue('FILES_TEST',100,10,'ชิ้น','in_process','DIM','หลักฐานทดสอบ')->>'id',true);
select ok(private.can_upload_ncr_attachment(current_setting('test.files_test')::uuid),'the reporter persona may upload');
select lives_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-test-attachments',current_setting('test.files_test')||'/test.pdf','83000000-0000-0000-0000-000000000001','{"size":123,"mimetype":"application/pdf"}')$$,
  'test uploads pass Storage RLS');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-attachments',current_setting('test.files_test')||'/wrong.pdf','83000000-0000-0000-0000-000000000001','{"size":10}')$$,
  '42501',null,'a test report cannot upload to the live bucket');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-test-attachments',current_setting('test.files_real')||'/wrong.pdf','83000000-0000-0000-0000-000000000001','{"size":10}')$$,
  '42501',null,'a live report cannot upload to the test bucket');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-test-attachments','not-a-uuid/wrong.pdf','83000000-0000-0000-0000-000000000001','{"size":10}')$$,
  '42501',null,'invalid report folders are rejected without cast errors');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-test-attachments',current_setting('test.files_test')||'/owner.pdf','83000000-0000-0000-0000-000000000002','{"size":10}')$$,
  '42501',null,'clients cannot forge the uploader');
select lives_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/test.pdf','หลักฐาน.pdf')$$,
  'test file registration uses the test bucket');
select results_eq($$select uploader_id,size_bytes,content_type from public.ncr_attachments where ncr_id=current_setting('test.files_test')::uuid$$,
  $$select current_setting('test.file_persona')::uuid,123::bigint,'application/pdf'::text$$,
  'uploader is the persona while size and MIME come from Storage');
select is((select count(*) from storage.objects where bucket_id='ncr-attachments'),0::bigint,'sandbox cannot read live files');
select is((select count(*) from storage.objects where bucket_id='ncr-test-attachments'),1::bigint,'the permitted persona can preview test files');
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_real')::uuid,'report',current_setting('test.files_real')||'/real.pdf','real.pdf')$$,
  'NCR_NOT_FOUND','sandbox cannot register live evidence');
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/test.pdf','duplicate.pdf')$$,
  '23505',null,'a file cannot be registered twice');
select throws_ok('select public.app_sandbox_purge_ncr()','NCR_FILES_REMAIN','purge refuses to orphan stored files');
select is((select count(*) from public.ncr_reports where id=current_setting('test.files_test')::uuid),1::bigint,'a failed purge leaves the report');

-- Fixtures for oversize files, wrong owners and a failed unregistered upload.
reset role;
insert into storage.objects(bucket_id,name,owner_id,metadata) values
  ('ncr-test-attachments',current_setting('test.files_test')||'/large.pdf','83000000-0000-0000-0000-000000000001','{"size":20971521,"mimetype":"application/pdf"}'),
  ('ncr-test-attachments',current_setting('test.files_test')||'/other.pdf','83000000-0000-0000-0000-000000000002','{"size":10,"mimetype":"application/pdf"}'),
  ('ncr-test-attachments','83000000-0000-0000-0000-000000000999/orphan.pdf','83000000-0000-0000-0000-000000000002','{"size":10,"mimetype":"application/pdf"}'),
  ('ncr-attachments',current_setting('test.files_test')||'/wrong-bucket.pdf','83000000-0000-0000-0000-000000000001','{"size":10,"mimetype":"application/pdf"}');
select ok(exists(select 1 from public.audit_logs where entity_type='ncr_attachments'
  and actor_id='83000000-0000-0000-0000-000000000101'),'attachment audit records the real Admin');
set local role authenticated;
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/large.pdf','large.pdf')$$,
  'INVALID_ATTACHMENT','oversize test files cannot be registered');
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/other.pdf','other.pdf')$$,
  'ATTACHMENT_NOT_UPLOADED','an Admin cannot claim another uploader file');
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/wrong-bucket.pdf','wrong.pdf')$$,
  'ATTACHMENT_NOT_UPLOADED','a matching path in the wrong bucket is not accepted');
select public.app_sandbox_enter(current_setting('test.other_persona')::uuid);
select is((select count(*) from public.ncr_attachments where ncr_id=current_setting('test.files_test')::uuid),0::bigint,'unrelated personas cannot read attachment metadata');
select is((select count(*) from storage.objects where bucket_id='ncr-test-attachments'),0::bigint,'unrelated personas cannot read test objects');
select throws_ok($$insert into storage.objects(bucket_id,name,owner_id,metadata)
  values('ncr-test-attachments',current_setting('test.files_test')||'/pk.pdf','83000000-0000-0000-0000-000000000001','{"size":10}')$$,
  '42501',null,'unrelated personas cannot upload');

-- Local-only switch: simulate the Storage API DELETE under the actual RLS role.
select set_config('storage.allow_delete_query','true',true);
delete from storage.objects where bucket_id='ncr-test-attachments';
reset role;
select is((select count(*) from storage.objects where bucket_id='ncr-test-attachments'),4::bigint,'normal sandbox mode cannot delete registered or unrelated test evidence');
set local role authenticated;
select ok('83000000-0000-0000-0000-000000000999/orphan.pdf'=any(public.app_sandbox_begin_ncr_file_cleanup()),'cleanup includes orphan uploads from other Admin sessions');
select is((select count(*) from storage.objects where bucket_id='ncr-test-attachments'),4::bigint,'explicit cleanup can read all test objects for removal');
select ok(private.ncr_test_cleanup_allowed(),'cleanup mode is active only after the Admin RPC');
reset role;
update public.sandbox_sessions set ncr_files_cleanup_until=now()-interval '1 second'
  where admin_auth_user_id='83000000-0000-0000-0000-000000000001';
set local role authenticated;
select ok(not private.ncr_test_cleanup_allowed(),'cleanup access expires if the browser stops before finishing');
select public.app_sandbox_enter(current_setting('test.other_persona')::uuid);
select ok(not private.ncr_test_cleanup_allowed(),'switching personas does not renew expired cleanup access');
select is(cardinality(public.app_sandbox_begin_ncr_file_cleanup()),4,'explicit retry renews cleanup access');
delete from storage.objects where bucket_id='ncr-attachments';
reset role;
select is((select count(*) from storage.objects where bucket_id='ncr-attachments'),2::bigint,'cleanup does not delete any live-bucket object');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.file_persona')::uuid);
select ok(not private.can_upload_ncr_attachment(current_setting('test.files_test')::uuid),'uploads pause during this Admin cleanup');
select throws_ok($$select public.app_ncr_add_attachment(current_setting('test.files_test')::uuid,'report',current_setting('test.files_test')||'/other.pdf','other.pdf')$$,
  'NCR_FILES_CLEANUP_ACTIVE','registration also pauses during cleanup');
delete from storage.objects where bucket_id='ncr-test-attachments' and name=current_setting('test.files_test')||'/test.pdf';
select throws_ok('select public.app_sandbox_purge_ncr()','NCR_FILES_REMAIN','partial removal keeps the reports for retry');
select public.app_sandbox_finish_ncr_file_cleanup();
select ok(not private.ncr_test_cleanup_allowed(),'failed cleanup can close temporary access');
select is((select count(*) from storage.objects where name='83000000-0000-0000-0000-000000000999/orphan.pdf'),0::bigint,'orphan reads are hidden again after cleanup');
select is(cardinality(public.app_sandbox_begin_ncr_file_cleanup()),3,'retry enumerates remaining files only');
delete from storage.objects where bucket_id='ncr-test-attachments';
select lives_ok('select public.app_sandbox_purge_ncr()','purge succeeds after every test file is removed');
select ok(not private.ncr_test_cleanup_allowed(),'successful purge closes temporary access');
select lives_ok('select public.app_sandbox_finish_ncr_file_cleanup()','finishing again is safe');
reset role;
select is((select count(*) from public.ncr_reports where id=current_setting('test.files_test')::uuid),0::bigint,'test report was removed');
select is((select count(*) from public.ncr_attachments where ncr_id=current_setting('test.files_test')::uuid),0::bigint,'test metadata was removed with its report');
select is((select count(*) from public.ncr_reports where id=current_setting('test.files_real')::uuid),1::bigint,'live report survives test purge');
select is((select count(*) from public.ncr_attachments where ncr_id=current_setting('test.files_real')::uuid),1::bigint,'live evidence metadata survives test purge');
select is((select count(*) from public.notifications),current_setting('test.notifications_before')::bigint,'test uploads and purge do not send notifications');

-- Revalidate actual account status on every policy/RPC, even with an existing session.
select set_config('request.jwt.claims','{}',true);
update public.employees set is_active=false where id='83000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok(not private.ncr_test_files_allowed(),'an inactive Admin loses all test-file access');
select throws_ok('select public.app_sandbox_begin_ncr_file_cleanup()','NOT_AUTHORIZED','inactive Admin cannot start cleanup');
reset role;
select set_config('request.jwt.claims','{}',true);
update public.employees set is_active=true,role_id=(select id from public.roles where code='staff') where id='83000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
select ok(not private.ncr_test_files_allowed(),'a downgraded Admin loses test-file access');
select throws_ok('select public.app_sandbox_begin_ncr_file_cleanup()','NOT_AUTHORIZED','downgraded Admin cannot clean test files');
reset role;
select set_config('request.jwt.claims','{}',true);
select * from finish();
rollback;
