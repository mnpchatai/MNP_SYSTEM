-- NCR ความสูญเสีย: บัญชีผู้ดูแลระบบที่ตั้ง "บทบาทหลักในการทำงาน" (employees.acting_role_id) กรอกต้นทุนได้ตามบทบาทนั้น
--
-- ปัญหา: ผจก.ทั่วไป และ ผช.ผจก.โรงงาน ตัวจริงใช้บัญชี role = admin และตั้ง acting_role_id เป็นบทบาทของตน
-- (20261003010000_admin_acting_role.sql) แต่ private.can_edit_ncr_losses ดูเฉพาะ role จริง ผ่าน private.employee_role_code
-- จึงได้ 'admin' และกรอก/แก้/ยืนยันยอด/ยกเลิกรายการความสูญเสีย และติ๊ก "ประเมินค่าเสียหายครบแล้ว" ไม่ได้เลย (NOT_AUTHORIZED)
-- ทั้งที่ระบบยังไม่มีบัญชีอื่นที่ถือ role general_manager / assistant_factory_manager
--
-- แก้: ตัดสินจากบทบาทที่ทำงาน coalesce(acting_role_id, role_id) แบบเดียวกับสายอนุมัติและการแจ้งเตือน
-- (20261003030000, 20261005010000, 20261009094227) รายชื่อบทบาทไม่เปลี่ยน:
--   ผจก.ทั่วไป ผจก.โรงงาน ผช.ผจก.โรงงาน และ ผจก./ผช.ผจก. ที่สังกัดแผนก QA
-- ผลคือ
--   - admin ที่ตั้งบทบาทหลักเป็น general_manager / factory_manager / assistant_factory_manager กรอกต้นทุนได้
--   - admin ที่ตั้งบทบาทหลักเป็น department_manager / assistant_department_manager กรอกได้เฉพาะเมื่อสังกัดแผนก QA
--   - admin ที่ไม่ได้ตั้งบทบาทหลัก หรือตั้งเป็น staff ยังกรอกไม่ได้เหมือนเดิม ผู้ถือ role จริงทุกคนไม่เปลี่ยน
--   acting_role_id มีค่าได้เฉพาะบัญชี role admin (trigger employees_normalize_acting_role ล้างค่าเมื่อเปลี่ยนออกจาก admin)
--   โหมดทดสอบไม่เปลี่ยน: ncr_current_employee คืนแถวของบัญชีทดสอบ (persona) ซึ่งไม่มี acting_role_id
-- ขั้นอื่นของ NCR (ลงนาม, พิจารณา, แจ้งเตือน) ยังตรวจ role จริงตามข้อจำกัดที่ตั้งใจใน 20261003010000
--
-- ฟังก์ชันนี้เป็นจุดเดียวที่ app_ncr_record_loss, app_ncr_save_outcome, app_ncr_void_loss, app_ncr_review_costs และ API รุ่นเก่า
-- (app_ncr_add_loss / app_ncr_add_losses) เรียกใช้ จึงมีผลครบทุกทางเข้า ไม่แก้ตารางและข้อมูล
-- เปลี่ยนรูปเป็น exists(...) ให้คืน false เสมอเมื่อหาพนักงานหรือบทบาทไม่เจอ (นิยามเดิมคืน null ได้)
-- สิทธิ์ execute คงเดิม (create or replace) และย้ำไว้ท้ายไฟล์
-- นิยามต้นทาง: private.can_edit_ncr_losses จาก 20261017030000_ncr_loss_editors_qa_managers.sql (ตรงกับฐานข้อมูลจริง)
-- ลำดับ deploy: ต้องขึ้น migration นี้ก่อนเผยแพร่ Pilot Web รุ่นที่แสดงฟอร์มต้นทุนให้ admin ตามบทบาทหลัก
--   (Pilot Web รุ่นเก่าไม่แสดงฟอร์มให้ admin กลุ่มนี้ ฐานข้อมูลรุ่นนี้ทำงานกับหน้าเว็บรุ่นเก่าได้)
-- Rollback: create or replace กลับเป็นนิยามใน 20261017030000 (รายการที่บันทึกไว้แล้วยังอยู่และอ่านได้ตามเดิม)

create or replace function private.can_edit_ncr_losses(p_ncr_id uuid, p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles working_role on working_role.id = coalesce(e.acting_role_id, e.role_id)
    where e.id = p_employee.id
      and (
        working_role.code in ('factory_manager', 'assistant_factory_manager', 'general_manager')
        or (
          working_role.code in ('department_manager', 'assistant_department_manager')
          and private.is_qa_department(p_employee.department_id)
        )
      )
  )
$$;

revoke all on function private.can_edit_ncr_losses(uuid, public.employees) from public, anon, authenticated;
