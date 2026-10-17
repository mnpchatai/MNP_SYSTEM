-- NCR ความสูญเสีย: ผู้กรอกต้นทุนเป็น ผจก.ทั่วไป, ผจก.โรงงาน, ผช.ผจก.โรงงาน และ ผจก./ผช.ผจก.แผนก QA เท่านั้น
--
-- เดิม (20261017010000) ผู้กรอกต้นทุนคือ ผจก.ทั่วไป, ผจก.โรงงาน, ผช.ผจก.โรงงาน และ ผจก./ผช.ผจก.ของ "แผนกที่รับผิดชอบใบนั้น"
-- (ncr_responsibilities) ผู้ดูแลระบบสั่งให้เปลี่ยนเป็นรายชื่อชุดใหม่ข้างต้น ผลคือ
--   - ผจก./ผช.ผจก.แผนก QA (department_manager / assistant_department_manager ที่อยู่แผนก QA) กรอกต้นทุนได้ในทุกใบ
--     ไม่ขึ้นกับว่า QA เป็นแผนกที่รับผิดชอบหรือไม่ (นิยามเดียวกับขั้นลงนาม "ผจก.แผนก QA" ใน app_ncr_signoff)
--   - ผจก./ผช.ผจก.ของแผนกที่รับผิดชอบใบนั้น (ที่ไม่ใช่ QA) กรอกต้นทุนไม่ได้อีก (NOT_AUTHORIZED) ยังตอบ NCR และให้ข้อมูลเพิ่มได้ตามเดิม
--   - พนักงานแผนก QA ที่ไม่ใช่ ผจก./ผช.ผจก. ยังกรอกไม่ได้ ผจก.ทั่วไป ผจก.โรงงาน ผช.ผจก.โรงงาน ไม่เปลี่ยน
--   ทั้งใบจริงและใบทดสอบใช้กฎเดียวกัน และผลไม่ขึ้นกับตาราง ncr_responsibilities อีก
--
-- ฟังก์ชันนี้เป็นจุดเดียวที่ app_ncr_record_loss, app_ncr_save_outcome, app_ncr_void_loss, app_ncr_review_costs และ API รุ่นเก่า
-- (app_ncr_add_loss / app_ncr_add_losses) เรียกใช้ จึงมีผลครบทุกทางเข้า พารามิเตอร์ p_ncr_id ยังอยู่เพื่อไม่ให้เปลี่ยนลายเซ็น
-- (ผู้เรียกทุกตัวส่งมา) แต่กฎใหม่ไม่ได้ใช้ การกันข้ามโหมดทดสอบไม่ได้อยู่ในฟังก์ชันนี้: record_loss / save_outcome / review_costs
-- ตรวจ SANDBOX_SCOPE_MISMATCH เอง ส่วน void_loss / add_loss / add_losses พึ่ง trigger ncr_losses_sandbox_scope ซึ่งมี pgTAP ครอบคลุม
-- ไม่แก้ตารางและข้อมูล สิทธิ์ execute คงเดิม (create or replace) และย้ำไว้ท้ายไฟล์
-- นิยามต้นทาง: private.can_edit_ncr_losses จาก 20261017010000_ncr_loss_editors_same_in_all_modes.sql
-- ลำดับ deploy: ต้องขึ้น migration นี้ก่อนเผยแพร่ Pilot Web รุ่นที่เปลี่ยนฟอร์มต้นทุนตามกฎใหม่
--   (Pilot Web รุ่นเก่าจะยังแสดงฟอร์มให้หัวหน้าแผนกที่รับผิดชอบ แต่ฐานข้อมูลปฏิเสธด้วย NOT_AUTHORIZED และจะไม่แสดงฟอร์มให้ ผจก. QA)
-- Rollback: create or replace กลับเป็นนิยามใน 20261017010000 (รายการที่บันทึกไว้แล้วยังอยู่และอ่านได้ตามเดิม)

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
      and private.is_qa_department(p_employee.department_id)
    )
$$;

revoke all on function private.can_edit_ncr_losses(uuid, public.employees) from public, anon, authenticated;
