-- ============================================================================
-- เตือนถามว่า "ของมาส่งหรือยัง" ทุกวัน 16:00 น. เวลาไทย ในวันที่คาดว่าจะมาส่ง (และวันถัดๆ ไปถ้ายัง
-- ไม่ได้กดว่าของมาส่งแล้ว หรือยังไม่ได้เลื่อนวันที่ใหม่ — กันไม่ให้ค้างเงียบถ้าลืมทั้งสองทาง)
--
-- ผู้รับ: ช่างทุกคนในชุดของใบนี้ + ผจก.แผนกซ่อมบำรุงเจ้าของงาน (คนละชุดกับตอนบันทึกหมุดปกติ ซึ่ง
-- แจ้ง "ผู้แจ้ง + ผจก." เพราะรอบนี้ต้องเตือน "คนที่มีสิทธิ์กดปุ่ม" ให้นึกขึ้นได้ ไม่ใช่เตือนคนที่รออยู่)
--
-- อีเมลปกติรอ client เปิดแอปแล้วเรียก edge function notify-email มาไล่ส่งคิว แต่การเตือนตามเวลานี้
-- ไม่มีใครเปิดแอปอยู่แน่นอนตอน 16:00 น. จึงให้ pg_cron ยิงเรียก edge function เองผ่าน pg_net ต่อท้าย
-- ทันที — อ่าน URL และ service role key จาก Supabase Vault เท่านั้น ห้ามฝัง secret จริงในไฟล์นี้
--
-- ต้องตั้งค่าเพิ่มเติมนอกไมเกรชันนี้ก่อนจะทำงานได้จริง (ทำครั้งเดียวผ่าน Supabase SQL editor/Dashboard):
--   1) เปิด extension pg_cron และ pg_net ให้โปรเจกต์ (Database → Extensions) ถ้ายังไม่เปิด
--   2) insert into vault.secrets (name, secret) values
--        ('notify_email_function_url', 'https://iqlydmkylqyowmvpsete.supabase.co/functions/v1/notify-email'),
--        ('notify_email_service_role_key', '<service role key จริง — คัดลอกจาก Project Settings>');
--   3) ตรวจว่า cron ตั้งสำเร็จ: select * from cron.job where jobname = 'purchase-progress-step-reminders';
-- ไม่ตั้ง secret สองตัวข้างบน = ฟังก์ชันแทรกแจ้งเตือนในตาราง notifications ไว้ตามปกติ (เห็นในหน้าเว็บ
-- ได้ทันที) แต่จะไม่มีอีเมลออกจนกว่าจะมีคนเปิดแอปมาเรียก notify-email เอง หรือมี secret ครบ
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. คำนวณว่าหมุดไหนถึงกำหนดต้องเตือน แล้วแทรกแจ้งเตือนให้คนที่กดหมุดนั้นได้
-- ---------------------------------------------------------------------------
create or replace function public.app_send_progress_step_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_step record;
  v_sent integer := 0;
begin
  for v_step in
    select s.id, s.request_id, s.step_label, s.expected_on, r.request_no,
           coalesce(r.machine_name, r.title) as subject
    from public.request_progress_steps s
    join public.requests r on r.id = s.request_id
    where s.done_on is null
      and s.expected_on is not null
      and s.expected_on <= v_today
      and (s.reminder_last_sent_on is null or s.reminder_last_sent_on < v_today)
    for update of s
  loop
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select x.employee_id, v_step.request_id,
           private.notify_title(v_step.request_id, 'ของที่สั่งซื้อมาส่งหรือยัง'),
           v_step.request_no || ' · ' || v_step.subject || ' · คาดว่าจะมาส่ง ' || to_char(v_step.expected_on, 'DD/MM/YYYY'),
           '/requests/' || v_step.request_id::text
    from (
      select rt.technician_id as employee_id
      from public.request_technicians rt
      where rt.request_id = v_step.request_id
      union
      select m.employee_id from private.owning_department_managers(v_step.request_id) m
    ) x
    where x.employee_id is not null;

    update public.request_progress_steps
    set reminder_last_sent_on = v_today
    where id = v_step.id;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;

-- เรียกได้เฉพาะ pg_cron (รันเป็นเจ้าของฐานข้อมูล/postgres ซึ่งข้าม grant อยู่แล้ว) ไม่เปิดให้ผู้ใช้ทั่วไป
-- ยิงเองได้ตามใจ เพราะจะกลายเป็นช่องสแปมแจ้งเตือนโดยไม่ต้องรอถึงเวลาจริง
revoke all on function public.app_send_progress_step_reminders() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. ยิงเรียก edge function notify-email ทันทีหลังแทรกคิว เพราะรอบนี้ไม่มี client มาเรียกให้
-- ---------------------------------------------------------------------------
create or replace function private.dispatch_pending_notification_emails()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_email_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_email_service_role_key';
  if v_url is null or v_key is null then
    raise notice 'dispatch_pending_notification_emails: NOT_CONFIGURED — ยังไม่ได้ตั้ง vault secret notify_email_function_url / notify_email_service_role_key';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function private.dispatch_pending_notification_emails() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. ตั้งเวลา pg_cron ให้รันทุกวัน 09:00 UTC = 16:00 น. เวลาไทย (ไทยไม่มี DST จึงคงที่ตลอดปี)
--    cron.schedule คีย์ด้วยชื่องาน — รันไมเกรชันซ้ำแล้วอัปเดตตารางเวลา/คำสั่งเดิมได้โดยไม่สร้างซ้ำ
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'purchase-progress-step-reminders',
  '0 9 * * *',
  $cron$
    select public.app_send_progress_step_reminders();
    select private.dispatch_pending_notification_emails();
  $cron$
);
