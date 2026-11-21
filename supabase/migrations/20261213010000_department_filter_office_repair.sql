-- แผนก ID: อนุญาตอีเมล/Web Push ของ "ใบแจ้งซ่อมคอมพิวเตอร์" (โมดูล itrp, รหัส IT_COMPUTER_REPAIR)
--
-- ที่มา: 20261117010000_department_notification_filter.sql กรองอีเมล/Push ของแผนก ID ให้เหลือเฉพาะ MT_REPAIR, IT_REPAIR
-- ตัดสินจาก request_id → request_types.code แต่แจ้งเตือนของ itrp ไม่ผูกใบคำร้องกลาง (request_id เป็น null)
-- ลิงก์เป็น /office/repair/<uuid> จึงตกไป "return false" → email/push = skipped (DEPARTMENT_FILTERED) ทั้งที่
-- เจ้าของตัดสิน 21/11/2026 ว่าพนักงานแผนก ID ต้องได้แจ้งเตือนของใบแจ้งซ่อมคอมพิวเตอร์ (เป็นผู้แจ้งหลักของโมดูลนี้)
--
-- การเปลี่ยน (เล็กที่สุด):
--   1) เพิ่ม ('ID', 'IT_COMPUTER_REPAIR') ในรายการโมดูลของแผนก — ตรงกับ POLICIES.ID ใน modules/department-access.js
--   2) เพิ่ม "กิ่งเดียว" ในฟังก์ชัน: action_url ขึ้นต้น /office/repair/ → อนุญาตเมื่อแผนกผู้รับมีโมดูล IT_COMPUTER_REPAIR
--      กิ่งอื่นทุกกิ่งไม่เปลี่ยนผล (ใบคำร้องกลาง, /profile, สรุปงานค้าง '/', อื่น ๆ = ไม่ส่ง)
--      แผนกที่ไม่ถูกจำกัดคืน true ตั้งแต่ต้นฟังก์ชันเหมือนเดิม จึงไม่ต้องดูกิ่งใหม่
--   ไม่เปิด /office/work-order/ (ใบสั่งงาน IT) ให้แผนก ID — ยังถูกกรองเหมือนเดิมตามที่ itwo_notify.test.sql ยืนยัน
--
-- ฐานของฟังก์ชัน: นิยามบน prod ตรวจแล้ว 21/11/2026 (SELECT pg_get_functiondef) เนื้อฟังก์ชันตรงกับไฟล์ 20261117010000 ทุกบรรทัด
--   (md5 ของ pg_get_functiondef ก่อน apply = 268f8b81223d79560db92ef363f8dbec; security definer, stable, search_path = '',
--   ACL เฉพาะ postgres) · signature/attribute ด้านล่างเหมือนเดิมเป๊ะ
-- ตารางรายการโมดูล private.department_notification_modules (RLS เปิด ไม่มี grant ให้ anon/authenticated) ไม่เปลี่ยนโครงสร้าง
--
-- แถวแจ้งเตือนที่ถูกข้ามไปแล้ว (skipped) ก่อน migration นี้ จะไม่ถูกส่งย้อนหลัง (trigger ตั้งสถานะตอน insert/ตั้งกลับ pending เท่านั้น)
--
-- Rollback (ไม่มีข้อมูลธุรกิจถูกแก้):
--   delete from private.department_notification_modules where department_code = 'ID' and module_code = 'IT_COMPUTER_REPAIR';
--   แล้ว create or replace private.department_notification_allowed(uuid, uuid, text, jsonb) กลับเป็นนิยามเดิมใน
--   20261117010000_department_notification_filter.sql (ส่วน "2. ตัดสินว่าแถวแจ้งเตือนนี้ส่งถึงผู้รับได้หรือไม่")
--   (ต้องตรวจ md5 ให้ตรง 268f8b81223d79560db92ef363f8dbec และ revoke all ... from public, anon, authenticated ซ้ำ)

-- 1. รายการที่อนุญาต ------------------------------------------------------------------------------
insert into private.department_notification_modules (department_code, module_code) values
  ('ID', 'IT_COMPUTER_REPAIR')
on conflict do nothing;

-- 2. ตัดสินว่าแถวแจ้งเตือนนี้ส่งถึงผู้รับได้หรือไม่ (เพิ่มกิ่ง /office/repair/ กิ่งเดียว) ------------------------
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

  -- ใบแจ้งซ่อมคอมพิวเตอร์ (itrp) ไม่ผูก request_id จึงตัดสินจากลิงก์ /office/repair/<uuid> + รายการโมดูลของแผนก
  -- (เพิ่มใหม่: กิ่งเดียวในฟังก์ชัน; /office/work-order/ ของ itwo ไม่เข้ากิ่งนี้ ยังตกไป false ด้านล่าง)
  if p_action_url like '/office/repair/%' then
    return 'IT_COMPUTER_REPAIR' = any (v_allowed);
  end if;

  return false;
end;
$$;

revoke all on function private.department_notification_allowed(uuid, uuid, text, jsonb) from public, anon, authenticated;
