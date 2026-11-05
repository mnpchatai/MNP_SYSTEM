-- ช่างทุกคนในชุดเปิดใบแจ้งซ่อมได้ ไม่ใช่เฉพาะคนแรก (private.can_access_request ผ่าน RLS)
--   บั๊กเดิม: ใบ FT058/26 มอบหมายช่าง 2 คน คนที่ไม่ได้อยู่ใน assignee_id มองไม่เห็นใบ
--   จึงไม่มีปุ่มเริ่มงาน ทั้งที่ app_start_repair_work อนุญาตช่างทุกคนในชุด
--   - allow: ช่างคนที่ 2 อ่านใบ รายชื่อช่าง และกดเริ่มงานได้
--   - deny: คนนอกชุด และช่างที่ถูกถอดออกจากชุดแล้ว อ่านไม่ได้และเริ่มงานไม่ได้
begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('86000000-0000-0000-0000-000000000001', 'tech-first@mnp.local', '{}'::jsonb),
  ('86000000-0000-0000-0000-000000000002', 'tech-second@mnp.local', '{}'::jsonb),
  ('86000000-0000-0000-0000-000000000003', 'tech-outsider@mnp.local', '{}'::jsonb);

-- ช่างทั้งสามคนเป็นพนักงานทั่วไป (ไม่มี requests.operate) เพื่อให้สิทธิ์มาจากการเป็นช่างในชุดเท่านั้น
-- คนนอกอยู่แผนกเดียวกับช่าง (MT) เพื่อยืนยันว่าแผนกเดียวกันไม่พอ ต้องอยู่ในชุดจริง
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('86000000-0000-0000-0000-000000000011', 'TECH-1', 'ช่าง', 'คนแรก', 'tech-first@mnp.local', 'ช่างซ่อม',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000012', 'TECH-2', 'ช่าง', 'คนที่สอง', 'tech-second@mnp.local', 'ช่างซ่อม',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000002'),
  ('86000000-0000-0000-0000-000000000013', 'TECH-OUT', 'ช่าง', 'นอกชุด', 'tech-outsider@mnp.local', 'ช่างซ่อม',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000003');

-- ใบที่ 1: ช่างคนแรกอยู่ใน assignee_id ทั้งสองคนอยู่ในตารางช่าง
-- ใบที่ 2: เคยมอบหมายช่างคนที่สอง แล้วถูกถอดออก เหลือแต่ช่างคนแรก
insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description, status, current_step, assignee_id)
select x.id::uuid, x.no, t.id, '50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000007',
  x.no, 'ข้อมูลจำลอง', 'assigned', 0, '86000000-0000-0000-0000-000000000011'
from (values
  ('86000000-0000-0000-0000-000000000021', 'TECH-SHARED'),
  ('86000000-0000-0000-0000-000000000022', 'TECH-REMOVED')
) x(id, no) cross join public.request_types t where t.code = 'MT_REPAIR';

insert into public.request_technicians (request_id, technician_id) values
  ('86000000-0000-0000-0000-000000000021', '86000000-0000-0000-0000-000000000011'),
  ('86000000-0000-0000-0000-000000000021', '86000000-0000-0000-0000-000000000012'),
  ('86000000-0000-0000-0000-000000000022', '86000000-0000-0000-0000-000000000011');

set local role authenticated;

-- deny: คนนอกชุด แม้อยู่แผนกเดียวกัน
select set_config('request.jwt.claims', '{"sub":"86000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.requests where id = '86000000-0000-0000-0000-000000000021' $$,
  'a same-department technician outside the crew cannot read the request'
);
select throws_ok(
  $$ select public.app_start_repair_work('86000000-0000-0000-0000-000000000021') $$,
  'P0001', 'NOT_ASSIGNED_TECHNICIAN',
  'a technician outside the crew cannot start the work'
);

-- allow: ช่างคนแรก (assignee_id) ยังอ่านได้เหมือนเดิม
select set_config('request.jwt.claims', '{"sub":"86000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.requests where id = '86000000-0000-0000-0000-000000000021' $$,
  'the first technician (assignee_id) can read the request'
);

-- allow: ช่างคนที่สองที่อยู่แค่ในตารางช่าง
select set_config('request.jwt.claims', '{"sub":"86000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.requests where id = '86000000-0000-0000-0000-000000000021' $$,
  'a second technician in the crew can read the request'
);
select is(
  (select count(*)::integer from public.request_technicians where request_id = '86000000-0000-0000-0000-000000000021'),
  2,
  'a second technician sees the whole crew list'
);
select ok(
  exists (
    select 1 from public.requests r
    join public.request_technicians rt on rt.request_id = r.id
    where r.status = 'assigned' and rt.technician_id = '86000000-0000-0000-0000-000000000012'
  ),
  'the second technician''s assigned job appears in their job query'
);

-- deny: ช่างที่ถูกถอดออกจากชุดแล้ว
select is_empty(
  $$ select 1 from public.requests where id = '86000000-0000-0000-0000-000000000022' $$,
  'a technician removed from the crew can no longer read the request'
);
select throws_ok(
  $$ select public.app_start_repair_work('86000000-0000-0000-0000-000000000022') $$,
  'P0001', 'NOT_ASSIGNED_TECHNICIAN',
  'a technician removed from the crew cannot start the work'
);

-- allow: ช่างคนที่สองกดเริ่มงานได้ และยังเห็นใบหลังเปลี่ยนสถานะ
select lives_ok(
  $$ select public.app_start_repair_work('86000000-0000-0000-0000-000000000021') $$,
  'a second technician in the crew can start the work'
);
select isnt_empty(
  $$ select 1 from public.requests where id = '86000000-0000-0000-0000-000000000021' and status = 'in_progress' $$,
  'the second technician still reads the request once it is in progress'
);

select * from finish();
rollback;
