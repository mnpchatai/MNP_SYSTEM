-- ไล่คิวอีเมลแจ้งเตือนด้วย pg_cron ทุกนาที — อีเมลไม่ต้องรอให้ใครเปิดแอป
--
-- เดิมคิว (notifications.email_status = 'pending') ถูกไล่ส่งเมื่อมี client เปิดแอป หรือ pilot-auth สั่งหลังอนุมัติ/
-- ยื่นคำร้องเท่านั้น แถวที่เกิดจาก migration (เช่นอีเมลยืนยันสิทธิ์ย้อนหลัง) หรือที่ส่งไม่ผ่านรอบก่อนจึงรอจนมีคนเปิดแอป
-- (วัดจริง 21 นาที) งานนี้ให้ฐานข้อมูลเรียก notify-email เองผ่านโครงที่มีอยู่แล้ว
-- (private.dispatch_pending_notification_emails + Vault secret notify_email_function_url / notify_email_service_role_key)
--
-- ออกแบบให้เบาและไม่ชนกับการส่งทันทีของ pilot-auth
--   1) เรียก Edge Function เฉพาะเมื่อมีแถว pending ที่ยังลองไม่ครบโควตา (MAX_ATTEMPTS = 3 ใน notify-email) และ
--      "ค้างเกิน 90 วินาที" เท่านั้น คิวว่างหรือมีแต่แถวใหม่ = ไม่เรียกอะไรเลย
--      หน่วง 90 วินาทีเพื่อให้การส่งทันทีหลังอนุมัติ (pilot-auth) จบก่อน ไม่ชนกัน — ถ้าชนจะเกิดอีเมลซ้ำ
--      และลิงก์ตั้งรหัสผ่านฉบับแรกใช้ไม่ได้ (ออกลิงก์ใหม่จะลบลิงก์เก่าที่ยังไม่ใช้)
--   2) ลบประวัติการรันของ pg_cron (cron.job_run_details) ที่เก่ากว่า 7 วัน วันละครั้ง ตารางนี้ pg_cron ไม่ลบเอง
--      และงานทุกนาทีจะเพิ่มวันละ 1,440 แถว
--
-- ข้อควรรู้: ถ้ายังไม่ได้ตั้งช่องทางส่งอีเมล (Resend/Gmail) แถว pending จะไม่ถูกปิด cron จึงเรียกทุกนาทีต่อไป
--   (ฟังก์ชันตอบ configured=false และไม่แตะคิว) ตั้งค่าช่องทางส่งแล้วคิวจะไหลเองทันที
--
-- Rollback:
--   select cron.unschedule('notification-email-drain');
--   select cron.unschedule('cron-run-history-cleanup');
--   drop function private.drain_pending_notification_emails();

create or replace function private.drain_pending_notification_emails()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.notifications n
    where n.email_status = 'pending'
      and n.email_attempts < 3
      and n.created_at < now() - interval '90 seconds'
  ) then
    perform private.dispatch_pending_notification_emails();
  end if;
end;
$$;

revoke all on function private.drain_pending_notification_emails() from public, anon, authenticated;

-- cron.schedule คีย์ด้วยชื่องาน — รันซ้ำแล้วอัปเดตตารางเวลา/คำสั่งเดิม ไม่สร้างงานซ้ำ
select cron.schedule(
  'notification-email-drain',
  '* * * * *',
  $cron$ select private.drain_pending_notification_emails(); $cron$
);

-- 19:30 UTC = 02:30 น. เวลาไทย
select cron.schedule(
  'cron-run-history-cleanup',
  '30 19 * * *',
  $cron$ delete from cron.job_run_details where end_time < now() - interval '7 days'; $cron$
);
