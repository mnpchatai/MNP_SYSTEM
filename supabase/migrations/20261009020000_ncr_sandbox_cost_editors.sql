-- NCR โหมดทดสอบ: จำกัดผู้กรอกต้นทุน/ผลดำเนินการเป็น
--   หัวหน้าที่รับผิดชอบใบนั้น (ผจก./ผู้ช่วย ผจก. ของแผนกที่อยู่ใน ncr_responsibilities),
--   ผจก.ทั่วไป, ผจก.โรงงาน, ผู้ช่วย ผจก.โรงงาน
--
-- เดิม private.can_edit_ncr_losses ให้พนักงานแผนก QA ทุกคน + ผจก.โรงงาน + ผจก./ผู้ช่วยของแผนกที่รับผิดชอบ
-- ตอนนี้ "ใบทดสอบ" (ncr_reports.is_test) ใช้กฎใหม่ข้างต้น (พนักงาน QA ที่ไม่ใช่หัวหน้าที่รับผิดชอบไม่มีสิทธิ์)
-- "ใบจริง" ใช้กฎเดิมทุกประการ — ไม่เปลี่ยนพฤติกรรมข้อมูลจริง
--
-- ฟังก์ชันนี้เป็นจุดเดียวที่ app_ncr_record_loss, app_ncr_save_outcome, app_ncr_void_loss และ API รุ่นเก่า
-- (app_ncr_add_loss / app_ncr_add_losses) เรียกใช้ จึงมีผลครบทุกทางเข้า สิทธิ์ execute ไม่เปลี่ยน (create or replace)
-- ส่วนที่เปลี่ยนเฉพาะ private.can_edit_ncr_losses; เริ่มจากนิยามล่าสุดใน 20261002020000_ncr_phase1.sql
-- Rollback: create or replace กลับเป็นนิยามใน 20261002020000_ncr_phase1.sql (ไม่มีข้อมูลถูกแก้)

create or replace function private.can_edit_ncr_losses(p_ncr_id uuid, p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((select n.is_test from public.ncr_reports n where n.id = p_ncr_id), false) then
      private.employee_role_code(p_employee.id) in ('factory_manager', 'assistant_factory_manager', 'general_manager')
      or (
        private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities r
          where r.ncr_id = p_ncr_id and r.department_id = p_employee.department_id
        )
      )
    else
      private.is_qa_department(p_employee.department_id)
      or private.employee_role_code(p_employee.id) = 'factory_manager'
      or (
        private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities r
          where r.ncr_id = p_ncr_id and r.department_id = p_employee.department_id
        )
      )
  end
$$;
