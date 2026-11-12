-- แผนกที่ใช้ได้เฉพาะบางโมดูล: ไม่ส่งอีเมลและ Web Push ของโมดูลอื่นให้พนักงานแผนกนั้น
--
-- ที่มา: PR #346 ซ่อนทุกโมดูลยกเว้นแจ้งซ่อม MT/IT จากแผนก ID (Indesign) บน Pilot Web แล้ว (modules/department-access.js)
-- แต่อีเมล (Edge Function notify-email) และ Web Push (notify-push) ส่งจากคิวใน public.notifications โดยไม่ดูกติกาแผนก
-- จึงยังส่ง NCR คำร้องฝ่ายบริหาร ผู้ดูแลระบบ ฯลฯ ให้พนักงานแผนก ID ทั้งที่เปิดดูในเว็บไม่ได้
--
-- วิธี: ตัดที่ต้นคิว ไม่แก้ Edge Function
--   ทั้งสองช่องทางส่งเฉพาะแถวที่ email_status / push_status = 'pending' (notify-email อ่านตรง, notify-push ผ่าน
--   app_claim_push_notifications) trigger ในไฟล์นี้ตั้งแถวที่แผนกผู้รับไม่ควรได้เป็น 'skipped' (DEPARTMENT_FILTERED)
--   ตั้งแต่ตอน insert แถวจึงไม่เคยเข้าคิวส่ง ส่วนแถวแจ้งเตือนในแอปยังบันทึกตามปกติ (หน้าเว็บกรองซ่อนเองอยู่แล้ว)
--   ทุกทางที่สร้างแจ้งเตือน (RPC ทุกตัว สรุปงานค้าง/แจ้งหัวหน้า และทางที่เพิ่มในอนาคต) ผ่าน trigger นี้หมด
--
-- กติกา (ตรงกับ notificationAllowed ใน modules/department-access.js — แก้ที่หนึ่งต้องแก้อีกที่):
--   - แผนกที่มีแถวใน private.department_notification_modules = แผนกที่ถูกจำกัด แผนกอื่นไม่เปลี่ยนอะไร
--   - ผูกใบคำร้อง (request_id): ส่งเมื่อประเภทใบ (request_types.code) อยู่ในรายการของแผนก
--   - เรื่องข้อมูลส่วนตัว (action_url = '/profile' เช่น อีเมลลิงก์ตั้งรหัสผ่านตอนอนุมัติบัญชี): ส่ง
--   - สรุปงานค้าง (action_url = '/' + digest): ส่งเมื่อทุกรายการเป็นใบคำร้องของโมดูลที่อนุญาต มีรายการอื่นปน = ไม่ส่งทั้งฉบับ
--   - อื่น ๆ (NCR, /admin, ไม่มีลิงก์, โมดูลที่เพิ่มภายหลัง): ไม่ส่ง
--   - ใช้กับทุกคนในแผนก รวม admin ตัดสินจากแผนกของผู้รับ ณ ตอนที่แถวถูกสร้าง และตัดสินใหม่เมื่อการส่งล้มเหลวแล้ว
--     สถานะถูกตั้งกลับเป็น pending (รอบ retry) — การส่งครั้งแรกของแถวที่สร้างก่อนย้ายเข้าแผนกยังออกไปตามปกติ
--     แถวที่ถูกข้ามแล้วไม่ถูกปลุกกลับเมื่อย้ายออกจากแผนก
--   - ต่างจากเว็บหนึ่งข้อ: เว็บไม่ใช้กติกากับบัญชี LAB-only และโหมดทดสอบ (กันวน redirect) ที่นี่ใช้กับทุกบัญชีในแผนก
--
-- รายการที่อนุญาตตอนนี้ (ผู้ใช้กำหนด 2026-11-12): ID → MT_REPAIR, IT_REPAIR
-- เพิ่มโมดูลให้แผนก ID: insert แถวใน migration ใหม่ และเพิ่มรหัสเดียวกันใน POLICIES.ID ของ modules/department-access.js
--
-- Rollback (ไม่มีข้อมูลธุรกิจถูกแก้; แถวที่ถูกข้ามไปแล้วจะไม่ถูกส่งย้อนหลัง):
--   drop trigger if exists notifications_department_filter on public.notifications;
--   drop function if exists private.notifications_department_filter();
--   drop function if exists private.department_notification_allowed(uuid, uuid, text, jsonb);
--   drop table if exists private.department_notification_modules;

-- 1. รายการที่อนุญาต ------------------------------------------------------------------------------
create table if not exists private.department_notification_modules (
  department_code text not null,
  module_code text not null,
  primary key (department_code, module_code)
);

comment on table private.department_notification_modules is
  'แผนกที่ได้รับอีเมล/Web Push เฉพาะบางโมดูล (รหัสแผนก → request_types.code) แผนกที่ไม่มีแถว = ไม่จำกัด; ต้องตรงกับ POLICIES ใน modules/department-access.js';

-- schema private เปิด usage ให้ authenticated (20260916070554) จึงปิดตารางนี้เองด้วย
alter table private.department_notification_modules enable row level security;
revoke all on private.department_notification_modules from public, anon, authenticated;

insert into private.department_notification_modules (department_code, module_code) values
  ('ID', 'MT_REPAIR'),
  ('ID', 'IT_REPAIR')
on conflict do nothing;

-- 2. ตัดสินว่าแถวแจ้งเตือนนี้ส่งถึงผู้รับได้หรือไม่ ------------------------------------------------------
create or replace function private.department_notification_allowed(
  p_recipient_id uuid,
  p_request_id uuid,
  p_action_url text,
  p_digest jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_department_code text;
  v_allowed text[];
begin
  select d.code into v_department_code
  from public.employees e
  join public.departments d on d.id = e.department_id
  where e.id = p_recipient_id;

  select array_agg(m.module_code) into v_allowed
  from private.department_notification_modules m
  where m.department_code = v_department_code;

  -- แผนกไม่ถูกจำกัด (หรือหาผู้รับไม่เจอ) = ไม่ใช่เรื่องของกติกานี้
  if v_allowed is null then
    return true;
  end if;

  if p_request_id is not null then
    return exists (
      select 1
      from public.requests r
      join public.request_types t on t.id = r.request_type_id
      where r.id = p_request_id and t.code = any (v_allowed)
    );
  end if;

  if p_action_url = '/profile' then
    return true;
  end if;

  if p_action_url = '/' then
    if p_digest is null or jsonb_typeof(p_digest) <> 'array' or jsonb_array_length(p_digest) = 0 then
      return false;
    end if;
    -- ทุกรายการต้องเป็นใบคำร้อง (item_id เป็น uuid) ของโมดูลที่อนุญาต; ตรวจรูปแบบก่อน cast เพื่อไม่ให้ insert ล้ม
    return not exists (
      select 1
      from jsonb_array_elements(p_digest) e(item)
      -- coalesce(..., false): ค่า null (เช่นไม่มี item_type) นับเป็นรายการที่ไม่อนุญาต ไม่ใช่หลุดผ่าน
      where not coalesce((
        jsonb_typeof(e.item) = 'object'
        and e.item ->> 'item_type' = 'request'
        and coalesce(e.item ->> 'item_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and exists (
          select 1
          from public.requests r
          join public.request_types t on t.id = r.request_type_id
          where r.id = case
                         when e.item ->> 'item_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                           then (e.item ->> 'item_id')::uuid
                       end
            and t.code = any (v_allowed)
        )
      ), false)
    );
  end if;

  return false;
end;
$$;

revoke all on function private.department_notification_allowed(uuid, uuid, text, jsonb) from public, anon, authenticated;

-- 3. trigger: แถวที่ไม่อนุญาตไม่เข้าคิวอีเมล/push ---------------------------------------------------
-- ทำงานทั้งตอน insert และตอนมีการตั้งสถานะกลับเป็น pending (เช่น สั่งส่งใหม่) แตะเฉพาะสถานะที่เป็น pending
-- ไม่เปลี่ยน sent/failed/skipped ที่มีอยู่ และไม่แตะแถวแจ้งเตือนในแอป (read_at, title, body)
create or replace function private.notifications_department_filter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.email_status = 'pending' or new.push_status = 'pending')
     and not private.department_notification_allowed(new.recipient_id, new.request_id, new.action_url, new.digest) then
    if new.email_status = 'pending' then
      new.email_status := 'skipped';
      new.email_error := 'DEPARTMENT_FILTERED';
    end if;
    if new.push_status = 'pending' then
      new.push_status := 'skipped';
      new.push_error := 'DEPARTMENT_FILTERED';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.notifications_department_filter() from public, anon, authenticated;

drop trigger if exists notifications_department_filter on public.notifications;
create trigger notifications_department_filter
  before insert or update of email_status, push_status on public.notifications
  for each row execute function private.notifications_department_filter();

-- 4. คิวที่ค้างอยู่ตอนนี้: แถว pending ของแผนกที่ถูกจำกัดที่ไม่อนุญาต ไม่ต้องส่งออกไปหลัง migration นี้
-- (trigger ทำงานเฉพาะแถวที่ insert/ตั้งสถานะหลังจากนี้ แถวเดิมจึงไล่ตรงนี้ครั้งเดียว จำกัดเฉพาะผู้รับในแผนกที่ถูกจำกัด)
update public.notifications n
set email_status = case when n.email_status = 'pending' then 'skipped' else n.email_status end,
    email_error = case when n.email_status = 'pending' then 'DEPARTMENT_FILTERED' else n.email_error end,
    push_status = case when n.push_status = 'pending' then 'skipped' else n.push_status end,
    push_error = case when n.push_status = 'pending' then 'DEPARTMENT_FILTERED' else n.push_error end
where (n.email_status = 'pending' or n.push_status = 'pending')
  and n.recipient_id in (
    select e.id
    from public.employees e
    join public.departments d on d.id = e.department_id
    where d.code in (select m.department_code from private.department_notification_modules m)
  )
  and not private.department_notification_allowed(n.recipient_id, n.request_id, n.action_url, n.digest);
