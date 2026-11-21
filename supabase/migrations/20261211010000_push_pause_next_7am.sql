-- พักแจ้งเตือน (Web Push): เปลี่ยนกติกา "เปิดกลับตอน 07:00 น. (เวลาไทย) รอบถัดไปที่จะถึง" · เจ้าของสั่ง 21/11/2026
--
-- กติกาเดิม (20261210010000_push_pause.sql): ถึง 07:00 ของ "วันปฏิทินไทยถัดไป" เสมอ → กด 00:30 ต้องพักราว 30 ชั่วโมง
-- กติกาใหม่: ถึง 07:00 น. ไทย "รอบถัดไปที่ยังไม่ถึง" (ผลต้องอยู่ในอนาคตเสมอ)
--   กด 20:00            → 07:00 วันรุ่งขึ้น (เหมือนเดิม)
--   กด 00:30 หรือ 06:59 → 07:00 เช้าวันเดียวกัน
--   กด 07:00:00 พอดีหรือหลังจากนั้น → 07:00 ของวันถัดไป
--
-- เปลี่ยนเฉพาะสูตรเวลาของ private.push_pause_end (signature/attribute เท่าเดิม: stable, security invoker, search_path = '')
-- ไม่แตะอ็อบเจ็กต์อื่น · แถวที่พักอยู่แล้วไม่ถูกแก้ย้อนหลัง (paused_until ที่เก็บไว้เป็นของเดิมจนครบเวลา)
-- notify-push อ่าน push_pauses.paused_until ที่เก็บไว้ ไม่คำนวณเวลาเอง จึงไม่ต้อง deploy function ใหม่
-- create or replace ไม่เปลี่ยน grant · revoke ซ้ำด้านล่างเพื่อให้ชัดว่าฟังก์ชันนี้ผู้ใช้เรียกตรงไม่ได้ (เหมือนไฟล์เดิม)
--
-- Rollback (กลับไปกติกาเดิม: 07:00 ของวันปฏิทินไทยถัดไป):
--   create or replace function private.push_pause_end(p_from timestamptz default now())
--   returns timestamptz
--   language sql
--   stable
--   set search_path = ''
--   as $$
--     select (date_trunc('day', p_from at time zone 'Asia/Bangkok') + interval '1 day' + interval '7 hours') at time zone 'Asia/Bangkok'
--   $$;

-- คำนวณบนเวลาท้องถิ่นไทย (timestamp ไม่มีโซน) แล้วแปลงกลับ: ไทยไม่มี DST จึงบวก interval ได้ตรง ๆ
--   เริ่มจาก 07:00 ของวันไทยที่กด · ถ้ากดเวลา 07:00:00 หรือหลังจากนั้น (>= 07:00) บวกอีก 1 วัน → ผลมากกว่าเวลากดเสมอ
create or replace function private.push_pause_end(p_from timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (
    date_trunc('day', p_from at time zone 'Asia/Bangkok')
    + interval '7 hours'
    + case when (p_from at time zone 'Asia/Bangkok')::time >= time '07:00' then interval '1 day' else interval '0' end
  ) at time zone 'Asia/Bangkok'
$$;
revoke all on function private.push_pause_end(timestamptz) from public, anon, authenticated;
