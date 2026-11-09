-- ทดสอบแท็บ "งานค้าง" ของบัญชี master (20261114010000_master_pending_work.sql)
--   1) เฉพาะ master เรียกได้
--   2) งานที่มีผู้ทำ: ตรงกับ private.pending_work_items (กติกาเดียวกับอีเมลเตือนงานค้าง) หนึ่งแถวต่อเอกสาร+สิ่งที่ต้องทำ
--   3) งานที่ไม่มีผู้ทำที่ใช้งานอยู่ขึ้นเป็น "ไม่มีผู้รับผิดชอบ" ส่วนใบที่จบแล้วไม่ขึ้น
begin;

create extension if not exists pgtap with schema extensions;
select plan(9);

-- ผู้ใช้: master, admin อีกคน, ช่างที่ใช้งานอยู่, ผู้แจ้งที่ถูกปิดบัญชี -------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a6ee0000-0000-0000-0000-000000000001', 'pw-master@mnp.local', '{}'::jsonb),
  ('a6ee0000-0000-0000-0000-000000000002', 'pw-other-admin@mnp.local', '{}'::jsonb),
  ('a6ee0000-0000-0000-0000-000000000003', 'pw-active-tech@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('a6ee0000-0000-0000-0000-000000000011', 'PWM-MASTER', 'ทดสอบ', 'มาสเตอร์', 'pw-master@mnp.local', 'Developer',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'a6ee0000-0000-0000-0000-000000000001', true),
  ('a6ee0000-0000-0000-0000-000000000012', 'PWM-ADMIN', 'ทดสอบ', 'แอดมิน', 'pw-other-admin@mnp.local', 'Admin',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'a6ee0000-0000-0000-0000-000000000002', true),
  ('a6ee0000-0000-0000-0000-000000000013', 'PWM-TECH', 'ช่าง', 'ทดสอบ', 'pw-active-tech@mnp.local', 'ช่าง',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'a6ee0000-0000-0000-0000-000000000003', true),
  ('a6ee0000-0000-0000-0000-000000000014', 'PWM-GONE', 'ผู้แจ้ง', 'ลาออก', 'pw-gone@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001', null, true);
update public.employees set is_master = true where id = 'a6ee0000-0000-0000-0000-000000000011';

-- ใบแจ้งซ่อม: รอช่างเริ่มงาน (มีผู้ทำ), รอผู้แจ้งตรวจรับแต่ผู้แจ้งถูกปิดบัญชี (ไม่มีผู้รับผิดชอบ), จบแล้ว
insert into public.requests (id, request_type_id, requester_id, department_id, title, description, status, assignee_id,
                             work_started_date, work_expected_date, submitted_at, created_at) values
  ('a6ee0000-0000-0000-0000-0000000000a1', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PWM รอช่างเริ่มงาน', 'PWM_A', 'assigned', 'a6ee0000-0000-0000-0000-000000000013',
   current_date, current_date + 3, now(), now()),
  ('a6ee0000-0000-0000-0000-0000000000a2', '40000000-0000-0000-0000-000000000001', 'a6ee0000-0000-0000-0000-000000000014',
   '10000000-0000-0000-0000-000000000007', 'PWM รอตรวจรับ ผู้แจ้งลาออก', 'PWM_B', 'pending_verify', 'a6ee0000-0000-0000-0000-000000000013',
   current_date - 5, current_date - 1, now(), now()),
  ('a6ee0000-0000-0000-0000-0000000000a3', '40000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003',
   '10000000-0000-0000-0000-000000000007', 'PWM จบแล้ว', 'PWM_C', 'completed', 'a6ee0000-0000-0000-0000-000000000013',
   current_date - 5, current_date - 1, now(), now());
update public.employees set is_active = false where id = 'a6ee0000-0000-0000-0000-000000000014';

-- 1. สิทธิ์ ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a6ee0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_master_pending_work() $$, 'NOT_AUTHORIZED', 'another admin cannot see company-wide pending work');
select set_config('request.jwt.claims', '{"sub":"a6ee0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_master_pending_work() $$, 'NOT_AUTHORIZED', 'a staff member cannot see company-wide pending work');
select set_config('request.jwt.claims', '{"sub":"a6ee0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select * from public.app_master_pending_work() $$, 'the master sees company-wide pending work');

-- 2. งานที่มีผู้ทำ ----------------------------------------------------------------------
select is(
  (select w.action from public.app_master_pending_work() w where w.item_id = 'a6ee0000-0000-0000-0000-0000000000a1'),
  'เริ่มงานซ่อม',
  'a repair waiting for its technician shows what has to be done'
);
select ok(
  (select w.holders from public.app_master_pending_work() w where w.item_id = 'a6ee0000-0000-0000-0000-0000000000a1')
    @> '[{"employee_no":"PWM-TECH"}]'::jsonb,
  'the technician who has to act is listed as holding the work'
);

-- 3. งานที่ไม่มีผู้รับผิดชอบ และใบที่จบแล้ว ------------------------------------------------------
select is(
  (select w.action || ' ' || w.holders::text from public.app_master_pending_work() w where w.item_id = 'a6ee0000-0000-0000-0000-0000000000a2'),
  'ไม่มีผู้รับผิดชอบ []',
  'work whose only holder was deactivated shows as having nobody responsible'
);
select ok(
  not exists (select 1 from public.app_master_pending_work() w where w.item_id = 'a6ee0000-0000-0000-0000-0000000000a3'),
  'a completed request is not pending work'
);
select ok(
  not exists (select 1 from public.app_master_pending_work() w where w.days_waiting < 0),
  'days waiting is never negative'
);

-- ทุกงานที่มีผู้ทำตรงกับกติกาของอีเมลเตือนงานค้าง (นับเป็นเอกสาร+สิ่งที่ต้องทำ ไม่รวม NCR ทดสอบ)
reset role;
select is(
  (select count(*)::integer from public.app_master_pending_work() w where w.holders <> '[]'::jsonb),
  (select count(distinct (p.item_type, p.item_id, p.action))::integer
   from private.pending_work_items(now()) p
   where p.item_type <> 'ncr' or exists (select 1 from public.ncr_reports n where n.id = p.item_id and not n.is_test)),
  'held work matches private.pending_work_items, one row per document and action'
);

select * from finish();
rollback;
