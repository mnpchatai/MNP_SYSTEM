-- แผนกที่แจ้งซ่อมได้ และตัวเลือกเครื่องจักรสำรองของทุกแผนกนั้น
--
-- ระบบ MT เดิมมีปุ่มแผนกให้เลือก 11 แผนกซึ่งเป็นแผนกในโรงงานทั้งหมด ส่วน MNP_SYSTEM
-- มีแผนกรวม 18 แผนก เพราะยังมีแผนกชุดเดิม (MGT, IT, HR, PUR, FIN, OPS) ที่ประเภทคำร้อง
-- อื่นอ้างถึงอยู่และมีพนักงานสังกัดอยู่จริง จึงลบทิ้งไม่ได้ แต่ก็ไม่ควรโผล่ในฟอร์มแจ้งซ่อม
--
-- ใช้ธงบนตารางแผนกแทนการฝังรายชื่อไว้ในโค้ดหน้าจอ เพิ่ม/ลดแผนกภายหลังจึงแก้ที่ข้อมูล
-- ไม่ต้องแก้โค้ด — เป็นเหตุผลเดียวกับ request_types.uses_repair_workflow

alter table public.departments
  add column if not exists is_repair_site boolean not null default false;

update public.departments set is_repair_site = true
where code in ('RB', 'GR', 'BG', 'PT', 'PK', 'QA', 'ST', 'WH', 'SR', 'FT', 'MT', 'AD');

-- ทุกแผนกที่แจ้งซ่อมได้ต้องมีตัวเลือก "สร้างใหม่" กับ "ไม่มี" เสมอ เหมือนที่ MT มีให้ทุกแผนก
-- ไม่งั้นแผนกที่ยังไม่มีเครื่องใน master (เช่น WH ซึ่งเป็นแผนกใหม่ที่ชีตเดิมไม่มี) จะเลือก
-- เครื่องจักรไม่ได้เลยสักตัว แล้วผู้แจ้งจะติดอยู่กลางฟอร์มโดยไม่มีทางไปต่อ
insert into public.machines (code, name, department_id, is_placeholder, sort_order)
select v.label, v.label, d.id, true, 9000 + v.ord
from public.departments d
cross join (values ('สร้างใหม่', 1), ('ไม่มี', 2)) as v(label, ord)
where d.is_repair_site
  and not exists (
    select 1 from public.machines m
    where m.department_id = d.id and m.is_placeholder and m.code = v.label
  );
