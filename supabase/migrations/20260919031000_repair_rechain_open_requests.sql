-- ย้ายใบแจ้งซ่อมที่ยัง "ค้าง" อยู่ในช่วงอนุมัติมาใช้ลำดับใหม่ ผจก.โรงงาน → ผจก.ทั่วไป
--
-- ไมเกรชัน 20260919030000 เปลี่ยนเฉพาะใบที่สร้างใหม่ ใบที่ส่งไปแล้วและยังรออนุมัติอยู่จึงยังชี้ไป
-- ขั้นแบบเดิม ("หัวหน้าแผนก" / "ผู้อนุมัติหน่วยงานรับผิดชอบ") ไฟล์นี้เขียนทับเฉพาะขั้นที่ยังไม่มีใคร
-- กด (status = 'pending') แล้วต่อขั้นผู้จัดการสองระดับเข้าไปแทน
--
-- ขอบเขต: ใบของประเภทคำร้องที่ใช้ repair workflow และสถานะยังอยู่ในช่วงอนุมัติ
-- (pending_approval / more_info) เท่านั้น — ใบที่อนุมัติผ่านไปแล้ว (pending_assign เป็นต้นไป)
-- ถูกปิดงานอนุมัติไปแล้วจึงไม่แตะ และขั้นที่มีคนกดไปแล้ว (approved/rejected/more_info) ยังอยู่ครบ
-- เพื่อไม่ให้ประวัติการอนุมัติจริงหายไป
--
-- สถานะของใบไม่ถูกเปลี่ยน — ใบที่ค้างที่ more_info ยังคงเป็น more_info เหมือนเดิม เพียงแต่ขั้นถัดไป
-- ที่รออยู่เปลี่ยนเป็น ผจก.โรงงาน แล้ว

-- 1. ลบขั้นอนุมัติที่ยังไม่มีใครกด
delete from public.approval_steps s
using public.requests r
join public.request_types t on t.id = r.request_type_id and t.uses_repair_workflow
where s.request_id = r.id
  and s.status = 'pending'
  and r.status in ('pending_approval', 'more_info');

-- 2. ต่อขั้น ผจก.โรงงาน → ผจก.ทั่วไป ถัดจากขั้นที่ลงมือไปแล้ว (ถ้าไม่มีเลยก็เริ่มที่ 1 และ 2)
insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
select r.id,
       coalesce((select max(s.step_order) from public.approval_steps s where s.request_id = r.id), 0) + n.step_gap,
       n.step_name,
       (select id from public.roles where code = n.role_code)
from public.requests r
join public.request_types t on t.id = r.request_type_id and t.uses_repair_workflow
cross join (values
  (1, 'ผู้จัดการโรงงาน', 'factory_manager'),
  (2, 'ผู้จัดการทั่วไป', 'general_manager')
) as n(step_gap, step_name, role_code)
where r.status in ('pending_approval', 'more_info');

-- 3. ชี้ current_step ไปที่ขั้น ผจก.โรงงาน ที่เพิ่งสร้าง
update public.requests r
set current_step = s.step_order
from public.approval_steps s
join public.roles ro on ro.id = s.approver_role_id and ro.code = 'factory_manager'
where s.request_id = r.id
  and s.status = 'pending'
  and r.status in ('pending_approval', 'more_info')
  and exists (
    select 1 from public.request_types t
    where t.id = r.request_type_id and t.uses_repair_workflow
  );
