-- pg_cron ไล่คิวอีเมลทุกนาที: ฟังก์ชันตัดสินใจอยู่ใน private, ผู้ใช้ทั่วไปเรียกไม่ได้, งาน cron ลงทะเบียนครบ
begin;

create extension if not exists pgtap with schema extensions;
select plan(5);

select has_function('private', 'drain_pending_notification_emails', array[]::text[], 'drain function exists');
select ok(
  not has_function_privilege('authenticated', 'private.drain_pending_notification_emails()', 'execute')
  and not has_function_privilege('anon', 'private.drain_pending_notification_emails()', 'execute'),
  'drain function is not executable by anon/authenticated'
);
select is(
  (select count(*) from cron.job where jobname in ('notification-email-drain', 'cron-run-history-cleanup')),
  2::bigint,
  'both cron jobs are registered'
);
select is(
  (select schedule from cron.job where jobname = 'notification-email-drain'),
  '* * * * *',
  'queue drain runs every minute'
);
-- ตัวเรียกจริงต้องไม่ระเบิดเมื่อคิวว่าง (ไม่มีแถว pending เก่า → ไม่เรียก Edge Function)
select lives_ok(
  $$ select private.drain_pending_notification_emails() $$,
  'drain is a no-op when nothing is old enough to send'
);

select * from finish();
rollback;
