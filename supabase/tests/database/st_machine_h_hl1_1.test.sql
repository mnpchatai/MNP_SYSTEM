-- ทดสอบ migration 20261006010000_add_st_machine_h_hl1_1
--   - ST มีเครื่อง H-HL1-1 (รถยกลากพาเลส) เพียงแถวเดียว ไม่ใช่ตัวเลือกพิเศษ
--   - แผนกอื่นไม่ได้รับรหัสนี้
--   - ตัวเลือก "ไม่มี" และ H-LF1-1 เดิมของ ST ไม่ถูกแตะ
--   ใบ ST007/26 ไม่มีใน DB ทดสอบ จึงทดสอบเฉพาะส่วนเครื่อง
begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ST' and m.code = 'H-HL1-1'
     and m.name = 'รถยกลากพาเลส' and not m.is_placeholder and m.is_active),
  1,
  'ST has exactly one active H-HL1-1 pallet jack'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where m.code = 'H-HL1-1' and d.code <> 'ST'),
  0,
  'no other department carries H-HL1-1'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ST' and m.code = 'ไม่มี' and m.is_placeholder and m.is_active),
  1,
  'the ST "ไม่มี" placeholder is untouched'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ST' and m.code = 'H-LF1-1' and m.name = 'รอกไฟฟ้า'),
  1,
  'the existing ST H-LF1-1 electric hoist is untouched'
);

select * from finish();
rollback;
