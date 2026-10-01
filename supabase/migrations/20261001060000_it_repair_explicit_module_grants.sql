-- ใบแจ้งซ่อม IT: ให้สิทธิ์อนุมัติโมดูลเฉพาะคนที่ Admin เลือกเท่านั้น
--
-- 20261001050000_enable_it_repair_module.sql ให้สิทธิ์โมดูล IT_REPAIR อัตโนมัติแก่ผู้มี approvals.act
-- ทุกคน (ตามกฎตั้งต้นของ 20260918060000) แต่ฐานข้อมูลจริงยังไม่มีผู้จัดการแผนกในแผนก IT ทำให้
-- private.resolve_approval_target ตกไปใช้ขั้นอนุมัติที่ไม่จำกัดแผนก — ผู้จัดการแผนกอื่นทุกคนที่ได้
-- สิทธิ์อัตโนมัติจะกดอนุมัติใบ IT ได้ ซึ่งไม่ใช่ที่ต้องการ
--
-- ไฟล์นี้ถอนเฉพาะสิทธิ์ที่ระบบให้อัตโนมัติ (granted_by is null) ของ IT_REPAIR ออก สิทธิ์ที่ Admin
-- ให้ผ่าน app_set_module_permission (granted_by = ผู้ให้) ไม่ถูกแตะ หลังจากนี้ Admin กำหนดผู้อนุมัติ
-- ใบ IT เองในหน้า Admin ระหว่างที่ยังไม่มีใครได้สิทธิ์ มีแค่ role admin ที่อนุมัติขั้นนี้ได้
--
-- ย้อนกลับ: รันคำสั่ง insert ส่วนท้ายของ 20261001050000_enable_it_repair_module.sql ซ้ำ

delete from public.approval_module_permissions p
using public.request_types t
where p.request_type_id = t.id
  and t.code = 'IT_REPAIR'
  and p.granted_by is null;
