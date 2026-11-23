-- ============================================================================
-- เปิด MNP LAB ให้พนักงานทั่วไปบางคนตาม ID (เจ้าของสั่ง 2026-11-23: "ปรับ ID : GODGAZ ให้เห็นโมดูล MNP LAB")
--
-- ก่อนหน้านี้ private.can_access_lab() = admin หรือบัญชี lab-only (MNPLAB001/002) เท่านั้น
-- GODGAZ เป็นพนักงาน QA บทบาท staff จึงไม่เห็นโมดูล การใส่ GODGAZ ในรายชื่อ lab-only ใช้ไม่ได้
-- เพราะบัญชี lab-only ถูกปิดทุกโมดูลอื่น (GODGAZ ต้องใช้งานโมดูลอื่นตามปกติต่อไป)
--
-- แนวคิด
--   - รายชื่อ ID ที่เข้า LAB ได้เพิ่ม (โดยไม่จำกัดโมดูลอื่น) อยู่ที่เดียว private.lab_access_employee_nos()
--     employees.employee_no เก็บเป็นตัวพิมพ์ใหญ่ เทียบแบบ upper() เหมือน lab_only_employee_nos()
--   - นับเฉพาะพนักงานที่ยังใช้งานอยู่ (is_active)
--   - private.can_access_lab() = admin หรือ lab-only หรือ ID ในรายชื่อนี้ — ทุก RPC ของ LAB (app_lab_access,
--     app_lab_mooney_feed, app_lab_mdr_feed, app_lab_mdr_upload, app_lab_mdr_curves ฯลฯ) ตรวจที่ฟังก์ชันนี้จุดเดียว
--     หน้าเว็บอ่านผ่าน app_lab_access จึงไม่ต้องแก้ client
--   - ข้อควรระวังเดียวกับรายชื่อ lab-only: การเปลี่ยน ID ของพนักงาน (คำร้องแก้ ID ที่ admin อนุมัติ) จะทำให้สิทธิ์นี้ย้ายตาม ID
--
-- เพิ่ม/ลด ID: create or replace private.lab_access_employee_nos() ใน migration ใหม่
--
-- Rollback (ไม่มีข้อมูลถูกแก้): นำ private.can_access_lab() กลับเป็นนิยามของ 20261019005000_lab_only_accounts.sql
--   แล้ว drop function private.is_lab_access_employee(uuid), private.lab_access_employee_nos()
-- ============================================================================

create or replace function private.lab_access_employee_nos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['GODGAZ']
$$;
revoke all on function private.lab_access_employee_nos() from public, anon, authenticated;

create or replace function private.is_lab_access_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.is_active
      and upper(e.employee_no) = any (private.lab_access_employee_nos())
  )
$$;
revoke all on function private.is_lab_access_employee(uuid) from public, anon, authenticated;

-- จุดตัดสินเดียวของโมดูล: เริ่มจากนิยามล่าสุดของ 20261019005000_lab_only_accounts.sql แล้วเพิ่มเงื่อนไขที่สาม
create or replace function private.can_access_lab()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_only_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_access_employee(private.current_employee_id()), false)
$$;
revoke all on function private.can_access_lab() from public, anon, authenticated;
