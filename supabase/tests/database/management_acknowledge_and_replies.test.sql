-- ทดสอบ 20261014100000_management_acknowledge_forwards_and_requester_replies.sql:
--   1) ใบที่ปิดเป็น "รับทราบข้อมูล" ก่อนถึงขั้นสุดท้าย ถูกเปิดกลับไปรอขั้นถัดไป พร้อมแจ้งเตือนและ audit
--   2) ผู้ยื่นตอบกลับความเห็นของขั้นที่ตัดสินแล้วได้ทุกมติ แจ้งผู้ให้ความเห็น และไม่เปลี่ยนสถานะ
--   3) คนอื่นตอบแทนไม่ได้ ขั้นที่ไม่มีความเห็น/ยังไม่ตัดสินตอบไม่ได้ ประเภทอื่นตอบไม่ได้
--      และ insert คำตอบผูกขั้นผ่าน Data API ตรงๆ ไม่ได้
begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

insert into auth.users (id, email, raw_user_meta_data) values
  ('76000000-0000-0000-0000-000000000001', 'mgreply-requester@mnp.local', '{}'::jsonb),
  ('76000000-0000-0000-0000-000000000002', 'mgreply-factory@mnp.local', '{}'::jsonb),
  ('76000000-0000-0000-0000-000000000003', 'mgreply-general@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '76000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('76000000-0000-0000-0000-000000000004', 'MGREPLY-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'mgreply-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '76000000-0000-0000-0000-000000000002'),
  ('76000000-0000-0000-0000-000000000005', 'MGREPLY-GM', 'ทดสอบ', 'ผู้จัดการทั่วไป', 'mgreply-general@mnp.local', 'ผู้จัดการทั่วไป',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '76000000-0000-0000-0000-000000000003');

insert into public.approval_module_permissions (employee_id, request_type_id)
select e.id, t.id
from (values ('76000000-0000-0000-0000-000000000004'::uuid), ('76000000-0000-0000-0000-000000000005'::uuid)) e(id)
cross join public.request_types t where t.code = 'MANAGEMENT'
on conflict do nothing;

create function pg_temp.step_id(p_title text, p_order integer) returns uuid language sql as $$
  select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
  where r.title = p_title and s.step_order = p_order
$$;
grant execute on function pg_temp.step_id(text, integer) to authenticated;

-- ผู้ยื่นสร้างใบสองใบ: REOPEN (จำลองใบเก่าที่ปิดผิด) และ REPLY (ทดสอบตอบกลับ)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_create_request((select id from public.request_types where code = 'MANAGEMENT'),
       'MGREPLY_REOPEN', 'ใบเก่าที่ถูกปิดด้วยรับทราบข้อมูลที่ขั้นแรก', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'requester creates the request to reopen'
);
select lives_ok(
  $$ select public.app_create_request((select id from public.request_types where code = 'MANAGEMENT'),
       'MGREPLY_REPLY', 'ใบสำหรับทดสอบการตอบกลับความเห็น', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'requester creates the request to reply on'
);
reset role;

-- 1. จำลองสภาพของใบเก่า (เหมือน FT 004/26): ขั้น 1 รับทราบ ใบปิด ขั้น 2 ค้าง pending -------------
update public.approval_steps set status = 'acknowledged', acted_by = '76000000-0000-0000-0000-000000000004', acted_at = now(),
  comment = 'รับทราบ'
where id = pg_temp.step_id('MGREPLY_REOPEN', 1);
update public.requests set status = 'acknowledged' where title = 'MGREPLY_REOPEN';

select is(private.reopen_acknowledged_before_final_step(), 1, 'exactly the stranded request is reopened');
select results_eq(
  $$ select status, current_step from public.requests where title = 'MGREPLY_REOPEN' $$,
  $$ values ('pending_approval'::public.request_status, 2) $$,
  'the reopened request waits for the general manager'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'MGREPLY_REOPEN' and n.title = 'มีคำร้องรออนุมัติ'
     and n.recipient_id = '76000000-0000-0000-0000-000000000005'),
  1,
  'the general manager is notified about the reopened request'
);
select is(
  (select count(*)::int from public.audit_logs a join public.requests r on r.id::text = a.entity_id
   where r.title = 'MGREPLY_REOPEN' and a.action = 'reopen_acknowledged_for_next_step'),
  1,
  'reopening is audited'
);
select is(private.reopen_acknowledged_before_final_step(), 0, 'running the reopen again changes nothing');

-- 2. ผู้อนุมัติให้ความเห็น แล้วผู้ยื่นตอบกลับ -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_reply_to_step_comment(pg_temp.step_id('MGREPLY_REPLY', 1), 'ตอบก่อนพิจารณา') $$,
  'STEP_HAS_NO_COMMENT',
  'a step that is still pending has nothing to reply to'
);

select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGREPLY_REPLY', 1), 'approved', 'อนุมัติ แต่ขอให้ส่งแผนงานภายในสัปดาห์นี้') $$,
  'factory manager approves with a comment'
);
select throws_ok(
  $$ select public.app_reply_to_step_comment(pg_temp.step_id('MGREPLY_REPLY', 1), 'ตอบแทนผู้ยื่น') $$,
  'NOT_AUTHORIZED',
  'only the requester can reply'
);

select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_reply_to_step_comment(pg_temp.step_id('MGREPLY_REPLY', 1), '   ') $$,
  'INVALID_MESSAGE',
  'an empty reply is refused'
);
select lives_ok(
  $$ select public.app_reply_to_step_comment(pg_temp.step_id('MGREPLY_REPLY', 1), 'รับทราบครับ จะส่งแผนงานวันศุกร์') $$,
  'requester replies to the approval comment'
);
select throws_ok(
  $$ insert into public.request_comments (request_id, author_id, body, approval_step_id)
     values ((select id from public.requests where title = 'MGREPLY_REPLY'),
             '50000000-0000-0000-0000-000000000003', 'ปลอมคำตอบ', pg_temp.step_id('MGREPLY_REPLY', 1)) $$,
  '42501',
  null,
  'a step reply cannot be inserted directly through the Data API'
);

-- ขั้น ผจก.ทั่วไป ไม่อนุมัติ (ใบปิด) ผู้ยื่นยังตอบความเห็นได้
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGREPLY_REPLY', 2), 'rejected', 'งบประมาณปีนี้ไม่พอ') $$,
  'general manager rejects with a reason'
);
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_reply_to_step_comment(pg_temp.step_id('MGREPLY_REPLY', 2), 'เข้าใจครับ จะเสนอใหม่ไตรมาสหน้า') $$,
  'requester can still reply after the request is closed'
);

-- ประเภทอื่นไม่รองรับ (ใบ IT_ACCESS ของผู้ยื่นใน seed)
select throws_ok(
  $$ select public.app_reply_to_step_comment(
       (select id from public.approval_steps where request_id = '60000000-0000-0000-0000-000000000002' and step_order = 1),
       'ตอบกลับประเภทอื่น') $$,
  'REPLY_NOT_SUPPORTED',
  'replies are only for management requests'
);
reset role;

select results_eq(
  $$ select s.step_order, c.body from public.request_comments c
     join public.approval_steps s on s.id = c.approval_step_id
     join public.requests r on r.id = c.request_id
     where r.title = 'MGREPLY_REPLY' order by s.step_order $$,
  $$ values (1, 'รับทราบครับ จะส่งแผนงานวันศุกร์'::text), (2, 'เข้าใจครับ จะเสนอใหม่ไตรมาสหน้า'::text) $$,
  'each reply is stored against the step it answers'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'MGREPLY_REPLY' and n.title = 'ผู้ยื่นคำร้องตอบกลับความเห็นของคุณ'
     and n.recipient_id in ('76000000-0000-0000-0000-000000000004', '76000000-0000-0000-0000-000000000005')),
  2,
  'each approver who commented is told about the reply'
);
select results_eq(
  $$ select status from public.requests where title = 'MGREPLY_REPLY' $$,
  array['rejected'::public.request_status],
  'replying does not change the request status'
);

select * from finish();
rollback;
