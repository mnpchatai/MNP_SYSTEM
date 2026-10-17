-- เพิ่มแผนก Indesign (รหัส ID) เป็นแผนกที่แจ้งซ่อม MT ได้
--
-- แผนกที่โผล่ในฟอร์มแจ้งซ่อมกำหนดด้วยธง departments.is_repair_site (ดู 20260918020000)
-- จึงเพิ่มแผนกด้วยข้อมูลอย่างเดียว ไม่แก้ฟังก์ชัน/นโยบาย/สิทธิ์ใด ๆ:
--   - สายอนุมัติของ MT ขั้น 1 เป็น ผจก.โรงงาน (ไม่ผูกแผนก) แผนกใหม่จึงไม่ต้องมีผู้จัดการก่อน
--   - เลขที่ใบเป็น "ID001/yy" จาก document_counters ต่อรหัสแผนก
--   - ตัวเลือกเครื่องจักร "สร้างใหม่" กับ "ไม่มี" ต้องมีทุกแผนกที่แจ้งซ่อมได้ ไม่งั้นผู้แจ้ง
--     เลือกเครื่องไม่ได้และติดอยู่กลางฟอร์ม (เหตุผลเดียวกับ 20260918020000)
-- เครื่องจักรจริงของแผนกนี้ยังไม่มีในทะเบียน เพิ่มภายหลังได้ที่ปุ่ม "สร้างเครื่องจักรใหม่" (app_create_machine)
--
-- เขียนแบบรันซ้ำได้: ทุกคำสั่งข้ามเมื่อมีข้อมูลอยู่แล้ว และถ้ามีแผนก ID อยู่ก่อน (สร้างด้วยมือ)
-- จะเปิดธง is_repair_site ให้โดยไม่แก้ชื่อหรือสถานะ active ของแผนกนั้น
--
-- ย้อนกลับ: update public.departments set is_repair_site = false where code = 'ID';
-- (อย่าลบแผนกหรือเครื่อง เพราะใบแจ้งซ่อมและพนักงานอาจอ้างอยู่ ถ้าลบตัวเลือก "สร้างใหม่"/"ไม่มี"
-- ให้ตั้ง is_active = false แทน) Pilot Web ซ่อนปุ่มแผนกจากรายการใน modules/module-mt.js
-- ได้เองเมื่อถอดแผนกออกจากธงนี้

insert into public.departments (code, name_th, name_en, is_repair_site)
values ('ID', 'Indesign', 'Indesign', true)
on conflict (code) do update set is_repair_site = true;

-- ตัวนับเลขที่ใบปี 26 เริ่มที่ 0 เหมือน WH/SR/PT (แผนกใหม่ ยังไม่เคยออกใบ)
insert into public.document_counters (department_code, year_key, last_number)
values ('ID', '26', 0)
on conflict (department_code, year_key) do nothing;

insert into public.machines (code, name, department_id, is_placeholder, sort_order)
select v.label, v.label, d.id, true, 9000 + v.ord
from public.departments d
cross join (values ('สร้างใหม่', 1), ('ไม่มี', 2)) as v(label, ord)
where d.code = 'ID'
  and not exists (
    select 1 from public.machines m
    where m.department_id = d.id and m.is_placeholder and m.code = v.label
  );
