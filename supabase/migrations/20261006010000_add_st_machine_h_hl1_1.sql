-- เพิ่มเครื่องจักร H-HL1-1 (รถยกลากพาเลส) ให้แผนก ST และผูกใบแจ้งซ่อม ST007/26 เข้ากับเครื่องนี้
--
-- ที่มา: ST007/26 ถูกแจ้งตอนยังไม่มีรหัสเครื่องในระบบ จึงเลือกตัวเลือก "ไม่มี" ไว้
-- รหัส H-HL1-1 ใช้ประเภท HL1 (รถยกลากพาเลส) เหมือน A-/B-/C-/P-HL1-x ของแผนกอื่น
-- ชื่อเครื่องจึงใช้ "รถยกลากพาเลส" ตามประเภทเดียวกัน (ยังไม่ได้ยืนยันกับทะเบียน MT01-FM01)
--
-- เขียนแบบรันซ้ำได้:
--   - เพิ่มเครื่องเมื่อ ST ยังไม่มีรหัสนี้เท่านั้น
--   - แก้ใบเฉพาะที่ยังชี้ตัวเลือก "ไม่มี" ของแผนก ST อยู่ ถ้าผู้ดูแลแก้เครื่องในใบไปแล้วจะไม่ถูกทับ
--   - การแก้ใบถูกบันทึกใน audit_logs ผ่าน trigger requests_audit (ค่าเก่าอยู่ใน metadata.old)
--
-- ย้อนกลับ: ปิดเครื่องด้วย is_active = false (อย่าลบ เพราะใบแจ้งซ่อมอ้าง machine_id) แล้วคืนใบ ST007/26
-- ไปชี้ตัวเลือก "ไม่มี" ของ ST โดยดูค่าเดิมจาก audit_logs (entity_type = 'requests')

insert into public.machines (code, name, department_id, is_placeholder, sort_order)
select 'H-HL1-1', 'รถยกลากพาเลส', d.id, false, 412
from public.departments d
where d.code = 'ST'
  and not exists (
    select 1 from public.machines m
    where m.department_id = d.id and m.code = 'H-HL1-1'
  );

update public.requests r
set machine_id = target.id,
    machine_code = target.code,
    machine_name = target.name
from public.machines target
join public.departments d on d.id = target.department_id and d.code = 'ST'
where r.request_no = 'ST007/26'
  and target.code = 'H-HL1-1'
  and not target.is_placeholder
  and target.is_active
  and r.machine_id in (
    select p.id
    from public.machines p
    where p.department_id = d.id and p.is_placeholder and p.code = 'ไม่มี'
  );
