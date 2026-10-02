-- ทดสอบ master เครื่องจักรหลัง migration 20261002010000_sync_machines_with_register
--   - ST: รหัสกับชื่อเครื่องไม่สลับช่องกัน (ค้นด้วยรหัสเจอ ใบแจ้งซ่อมเก็บรหัสถูกช่อง)
--   - BG/PK: เครื่องที่ทะเบียนมีรหัสซ้ำคนละเครื่องมีครบ 2 แถว ไม่ถูกกันทิ้งเหลือแถวเดียว
begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'ST' and not m.is_placeholder
     and (m.code, m.name) in (
       ('F-LF1-1', 'รอกไฟฟ้า'),
       ('F-SE 1-1', 'รถลากยกสูงระบบไฟฟ้า'),
       ('H-LF1-1', 'รอกไฟฟ้า'),
       ('F-PK 2-1', 'เครื่องรัดกล่อง')
     )),
  4,
  'ST machines carry the register code in code and the machine name in name'
);

select is_empty(
  $$ select 1
     from public.machines m
     join public.departments d on d.id = m.department_id
     where d.code = 'ST' and not m.is_placeholder
       and m.name in ('F-LF1-1', 'F-SE 1-1', 'H-LF1-1', 'F-PK 2-1') $$,
  'no ST machine has its code and name in swapped columns'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'BG' and m.code = 'S-SM 3-4'
     and m.name = 'จักรอุตสาหกรรม-ธรรมดาเข็มเดี่ยว' and not m.is_placeholder),
  2,
  'BG keeps both machines the register lists under code S-SM 3-4'
);

select is(
  (select count(*)::integer
   from public.machines m
   join public.departments d on d.id = m.department_id
   where d.code = 'PK' and m.code = 'P-SK 1-2'
     and m.name = 'เครื่องรีดสตื๊กเกอร์ความร้อน-ลูกกลิ้ง' and not m.is_placeholder),
  2,
  'PK keeps both machines the register lists under code P-SK 1-2'
);

select * from finish();
rollback;
