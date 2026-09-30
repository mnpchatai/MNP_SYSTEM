-- เพิ่มตำแหน่ง "ผู้ช่วยผู้จัดการแผนก" (assistant_department_manager)
--
-- ตำแหน่ง = roles.role_id (ดู 20260919000000_unify_position_and_role) dropdown "ตำแหน่ง"
-- ในฟอร์มขอเปิดบัญชี/หน้า Admin อ่านจากตาราง roles เรียงตาม sort_order จึงไม่ต้องแก้ UI
--
-- สิทธิ์: คัดลอกชุดสิทธิ์ทั้งหมดของ department_manager (ดู/สร้าง/อนุมัติคำร้อง) ณ เวลา
-- รัน migration นี้ ส่วนสิทธิ์เฉพาะ "ผู้จัดการแผนกเจ้าของงาน" ที่ RPC ตรวจจาก role code
-- (มอบหมายช่าง, เริ่ม/จบงานซ่อม, ติดตามจัดซื้อ) ยังผูกกับ department_manager เท่านั้น
-- และไม่ขยายให้ตำแหน่งนี้ในงานนี้ — ต้องตัดสินใจแยกหากต้องการให้ทำได้
--
-- Rollback: ต้องย้ายพนักงานที่ใช้ role นี้ไปตำแหน่งอื่นก่อน แล้วจึง
--   delete from public.role_permissions where role_id = '20000000-0000-0000-0000-000000000007';
--   delete from public.roles where id = '20000000-0000-0000-0000-000000000007';

insert into public.roles (id, code, name_th, description, sort_order) values
  ('20000000-0000-0000-0000-000000000007', 'assistant_department_manager',
   'ผู้ช่วยผู้จัดการแผนก', 'ช่วยอนุมัติคำร้องของแผนกตนเอง/หน่วยงานที่รับผิดชอบ', 45)
on conflict (id) do nothing;

insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000007', rp.permission_id
from public.role_permissions rp
join public.roles r on r.id = rp.role_id
where r.code = 'department_manager'
on conflict do nothing;
