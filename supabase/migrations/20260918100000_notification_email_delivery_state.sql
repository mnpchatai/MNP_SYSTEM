-- บันทึก "ผลจริง" ของการส่งอีเมลแจ้งเตือนแต่ละแถว ไม่ใช่แค่ "เคยลองส่งแล้ว"
--
-- ปัญหาเดิม: ไมเกรชัน notification_email_dispatch มีแค่ email_sent_at และ Edge Function
-- ปั๊มเวลาลงไปใน finally ทุกกรณี ทั้งส่งสำเร็จ ส่งพัง อีเมลผู้รับใช้ไม่ได้ หรือยังไม่ได้ตั้งค่า
-- secret เลย ผลคือเมื่ออีเมลไม่ถึงผู้รับ ไม่มีร่องรอยใดในฐานข้อมูลบอกได้ว่าพังตรงไหน และแถวนั้น
-- ถูกตัดสิทธิ์จากการส่งซ้ำถาวรทั้งที่ยังไม่เคยส่งออกไปจริง
--
-- โครงใหม่แยกสถานะออกจากเวลา และเก็บเหตุผลไว้เสมอ
--   pending  ยังไม่ได้ส่ง (รวมถึงเคยพยายามแล้วพังแต่ยังไม่ครบโควตา retry)
--   sent     ส่งออกจากระบบสำเร็จจริง — email_sent_at ถูกปั๊มเฉพาะกรณีนี้เท่านั้น
--   skipped  ไม่ต้องส่ง เช่น ผู้รับปิดใช้งานอยู่ หรืออีเมลเป็นค่า placeholder ที่ส่งไม่ได้จริง
--   failed   พยายามครบโควตาแล้วยังไม่สำเร็จ ต้องให้คนเข้ามาดู email_error
alter table public.notifications
  add column if not exists email_status text not null default 'pending',
  add column if not exists email_attempts integer not null default 0,
  add column if not exists email_attempted_at timestamptz,
  add column if not exists email_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'notifications_email_status_check'
  ) then
    alter table public.notifications
      add constraint notifications_email_status_check
      check (email_status in ('pending', 'sent', 'skipped', 'failed'));
  end if;
end $$;

-- แถวเดิมที่มี email_sent_at อยู่แล้วคือ "เคยถูกโค้ดเก่าปั๊มเวลาไว้" ซึ่งอาจไม่ได้ส่งสำเร็จจริง
-- แต่ไม่มีข้อมูลพอจะแยกได้ย้อนหลัง จึงถือว่า sent เพื่อไม่ส่งซ้ำให้ผู้รับโดยไม่จำเป็น
update public.notifications
   set email_status = 'sent',
       email_attempts = greatest(email_attempts, 1),
       email_attempted_at = coalesce(email_attempted_at, email_sent_at)
 where email_sent_at is not null
   and email_status = 'pending';

-- คิวงานส่งอีเมลอ่านด้วย where email_status = 'pending' เสมอ จึงทำ partial index ให้ตรงรูปแบบนั้น
create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where email_status = 'pending';

comment on column public.notifications.email_status is
  'สถานะการส่งอีเมลแจ้งเตือนแถวนี้: pending | sent | skipped | failed (ดู Edge Function notify-email)';
comment on column public.notifications.email_error is
  'เหตุผลล่าสุดที่ส่งไม่สำเร็จหรือถูกข้าม ใช้วินิจฉัยเมื่อผู้ใช้แจ้งว่าอีเมลไม่เข้า';
