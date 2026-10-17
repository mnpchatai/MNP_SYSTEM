-- NCR ความสูญเสีย: ใช้กฎผู้กรอกต้นทุนของโหมดทดสอบกับใบจริงด้วย (ทั้งสองโหมดใช้กฎเดียวกัน)
--
-- เดิม private.can_edit_ncr_losses แยกสองกฎ (นิยามล่าสุดอยู่ใน 20261015060000):
--   ใบทดสอบ (ncr_reports.is_test): ผจก.โรงงาน, ผช.ผจก.โรงงาน, ผจก.ทั่วไป และผจก./ผช.ผจก.ของแผนกที่อยู่ใน ncr_responsibilities
--   ใบจริง: ทุกคนข้างต้นยกเว้น ผจก.ทั่วไป + พนักงานแผนก QA ทุกคน
-- ตอนนี้ใบจริงใช้กฎเดียวกับใบทดสอบ ผลคือ
--   - พนักงานแผนก QA (และ ผจก. QA ที่แผนก QA ไม่ได้อยู่ในรายการแผนกที่รับผิดชอบ) กรอก/แก้/ยืนยันยอด/ยกเลิกรายการความสูญเสีย
--     และติ๊ก "ประเมินค่าเสียหายครบแล้ว" ในใบจริงไม่ได้อีก (NOT_AUTHORIZED) ยังอ่านใบและรายการที่บันทึกไว้แล้วได้ตามเดิม
--   - ผจก.ทั่วไปกรอกต้นทุนในใบจริงได้
--   ผู้มีสิทธิ์อื่น (ผจก.โรงงาน, ผช.ผจก.โรงงาน, ผจก./ผช.ผจก.ของแผนกที่รับผิดชอบใบนั้น) ไม่เปลี่ยน
--
-- ฟังก์ชันนี้เป็นจุดเดียวที่ app_ncr_record_loss, app_ncr_save_outcome, app_ncr_void_loss, app_ncr_review_costs และ API รุ่นเก่า
-- (app_ncr_add_loss / app_ncr_add_losses) เรียกใช้ จึงมีผลครบทุกทางเข้า การตรวจว่าผู้ทำรายการกับใบอยู่โหมดเดียวกัน
-- (SANDBOX_SCOPE_MISMATCH) ทำที่ RPC เหล่านั้นก่อนเรียกฟังก์ชันนี้ จึงไม่ต้องดู is_test ที่นี่อีก
-- ไม่แก้ตารางและข้อมูล สิทธิ์ execute คงเดิม (create or replace) และย้ำไว้ท้ายไฟล์
-- นิยามต้นทาง: private.can_edit_ncr_losses จาก 20261015060000_ncr_loss_retroactive_and_assistant_factory_manager.sql
-- ลำดับ deploy: ต้องขึ้น migration นี้ก่อนเผยแพร่ Pilot Web รุ่นที่ซ่อนฟอร์มต้นทุนจากพนักงาน QA ในใบจริง
--   (Pilot Web รุ่นเก่าจะยังแสดงฟอร์มให้ QA แต่ฐานข้อมูลปฏิเสธด้วย NOT_AUTHORIZED)
-- Rollback: create or replace กลับเป็นนิยามใน 20261015060000 (รายการที่บันทึกไว้แล้วยังอยู่และอ่านได้ตามเดิม)

create or replace function private.can_edit_ncr_losses(p_ncr_id uuid, p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.employee_role_code(p_employee.id) in ('factory_manager', 'assistant_factory_manager', 'general_manager')
    or (
      private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager')
      and exists (
        select 1 from public.ncr_responsibilities r
        where r.ncr_id = p_ncr_id and r.department_id = p_employee.department_id
      )
    )
$$;

revoke all on function private.can_edit_ncr_losses(uuid, public.employees) from public, anon, authenticated;
