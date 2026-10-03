-- ทดสอบเพดานขนาดไฟล์แนบ 20 MB ต่อไฟล์ (20261003000000_raise_attachment_size_limit_to_20mb.sql)
--   - check constraint ของ request_attachments / ncr_attachments: ผ่านที่ 20 MB พอดี, ปฏิเสธเกิน 20 MB และขนาด 0
--   - bucket request-attachments / ncr-attachments ตั้ง file_size_limit = 20 MB และยัง private
--   - (การลงทะเบียนไฟล์ NCR ผ่าน app_ncr_add_attachment ทดสอบใน ncr_phase1.test.sql เพราะต้องมี fixture NCR)
--
-- ไม่ใช้ fixture: แถวที่ใส่ใช้ uuid สุ่มที่ไม่มีอยู่จริง CHECK constraint ถูกตรวจตอนใส่แถว (ก่อน foreign key ซึ่งตรวจท้าย statement)
-- ขนาดที่ผ่าน CHECK จึงไปพังที่ foreign key (23503) ส่วนขนาดที่ไม่ผ่านพังที่ CHECK (23514) แยกสองกรณีนี้ได้ชัดเจนโดยไม่ต้องสร้างคำร้อง
begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

-- 1. ตารางไฟล์แนบของคำร้อง -----------------------------------------------------------
select throws_ok(
  $$ insert into public.request_attachments (request_id, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), gen_random_uuid(), 'size-test/a', 'a.pdf', 'application/pdf', 10485761) $$,
  '23503',
  null,
  'request attachment above the old 10 MB limit now passes the size check (stops at the foreign key only)'
);
select throws_ok(
  $$ insert into public.request_attachments (request_id, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), gen_random_uuid(), 'size-test/b', 'b.pdf', 'application/pdf', 20971520) $$,
  '23503',
  null,
  'request attachment of exactly 20 MB passes the size check'
);
select throws_ok(
  $$ insert into public.request_attachments (request_id, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), gen_random_uuid(), 'size-test/c', 'c.pdf', 'application/pdf', 20971521) $$,
  '23514',
  null,
  'request attachment above 20 MB is rejected by the size check'
);
select throws_ok(
  $$ insert into public.request_attachments (request_id, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), gen_random_uuid(), 'size-test/d', 'd.pdf', 'application/pdf', 0) $$,
  '23514',
  null,
  'empty request attachment is still rejected'
);

-- 2. ตารางไฟล์หลักฐาน NCR --------------------------------------------------------------
select throws_ok(
  $$ insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), 'report', gen_random_uuid(), 'size-test/e', 'e.pdf', 'application/pdf', 10485761) $$,
  '23503',
  null,
  'NCR evidence above the old 10 MB limit now passes the size check (stops at the foreign key only)'
);
select throws_ok(
  $$ insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), 'report', gen_random_uuid(), 'size-test/f', 'f.pdf', 'application/pdf', 20971520) $$,
  '23503',
  null,
  'NCR evidence of exactly 20 MB passes the size check'
);
select throws_ok(
  $$ insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), 'report', gen_random_uuid(), 'size-test/g', 'g.pdf', 'application/pdf', 20971521) $$,
  '23514',
  null,
  'NCR evidence above 20 MB is rejected by the size check'
);
select throws_ok(
  $$ insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (gen_random_uuid(), 'report', gen_random_uuid(), 'size-test/h', 'h.pdf', 'application/pdf', 0) $$,
  '23514',
  null,
  'empty NCR evidence is still rejected'
);

-- 3. bucket ------------------------------------------------------------------------
select is(
  (select file_size_limit from storage.buckets where id = 'request-attachments'),
  20971520::bigint,
  'request-attachments bucket allows up to 20 MB per file'
);
select is(
  (select file_size_limit from storage.buckets where id = 'ncr-attachments'),
  20971520::bigint,
  'ncr-attachments bucket allows up to 20 MB per file'
);
select is(
  (select count(*)::int from storage.buckets where id in ('request-attachments', 'ncr-attachments') and public),
  0,
  'attachment buckets stay private'
);
select is(
  (select allowed_mime_types from storage.buckets where id = 'request-attachments'),
  (select allowed_mime_types from storage.buckets where id = 'ncr-attachments'),
  'both attachment buckets still accept the same file types'
);

-- 4. ชนิดไฟล์ไม่เปลี่ยน: ยังรับเฉพาะรูป/PDF/TXT/DOCX/XLSX ------------------------------
select is(
  (select cardinality(allowed_mime_types) from storage.buckets where id = 'request-attachments'),
  7,
  'request-attachments still allows exactly the seven original file types'
);
select ok(
  (select not ('application/zip' = any (allowed_mime_types)) and 'application/pdf' = any (allowed_mime_types)
   from storage.buckets where id = 'request-attachments'),
  'archives are still not accepted while PDF is'
);

select * from finish();
rollback;
