-- ทดสอบข้อความของแต่ละคนในประวัติสถานะ (20261005020000_status_history_person_notes.sql):
--   1) ขอข้อมูลเพิ่ม / ตอบกลับ / ไม่อนุมัติ / อนุมัติขั้นสุดท้าย เก็บข้อความของคนนั้นลง note ของแถวประวัติ
--      ทุกรอบ ไม่หายเมื่อ approval_steps.comment ถูกเขียนทับ
--   2) ข้อความที่ฝากไว้ใช้ได้กับการเปลี่ยนสถานะครั้งถัดไปครั้งเดียว ไม่ติดไปกับครั้งอื่น
--   3) คนที่ไม่มีสิทธิ์ตัดสินใจ/ตอบกลับไม่ทำให้เกิดแถวประวัติ และแก้หรือฝากข้อความเองไม่ได้
--   4) เติม note ย้อนหลังจาก audit_logs ให้แถวเก่าที่ยังว่าง ไม่ทับแถวที่มี note อยู่แล้ว
begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

select has_function('private', 'set_status_note', array['text'], 'private.set_status_note exists');
select has_function('private', 'backfill_status_history_notes', array[]::text[], 'private.backfill_status_history_notes exists');

-- ผู้ยื่นคำร้อง (พนักงานสาธิต), admin สาธิต (อนุมัติได้ทุกขั้น), ผู้อนุมัติสาธิต (คนนอกสายของคำร้องนี้)
insert into auth.users (id, email, raw_user_meta_data) values
  ('74000000-0000-0000-0000-000000000001', 'notes-requester@mnp.local', '{}'::jsonb),
  ('74000000-0000-0000-0000-000000000002', 'notes-admin@mnp.local', '{}'::jsonb),
  ('74000000-0000-0000-0000-000000000003', 'notes-outsider@mnp.local', '{}'::jsonb);
update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000003'
where id = '50000000-0000-0000-0000-000000000002';

-- ตัวช่วยหา id อ่านในสิทธิ์ของผู้รันทดสอบ (ไม่ติด RLS) เพื่อให้คนนอกสายได้ id จริงไปเรียก RPC
-- และถูกปฏิเสธที่การตรวจสิทธิ์ ไม่ใช่เพราะมองไม่เห็นแถว
create function pg_temp.step_id(p_title text, p_order integer) returns uuid
language sql security definer set search_path = '' as $$
  select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
  where r.title = p_title and s.step_order = p_order
$$;
create function pg_temp.request_id(p_title text) returns uuid
language sql security definer set search_path = '' as $$
  select id from public.requests where title = p_title
$$;
-- แถวประวัติในการทดสอบนี้เกิดใน transaction เดียวกันจึงมี created_at เท่ากันหมด เทียบแบบไม่สนลำดับ (bag_eq)
create function pg_temp.note_rows(p_title text) returns setof text language sql as $$
  select h.to_status::text || '=' || coalesce(h.note, '∅')
  from public.request_status_history h
  join public.requests r on r.id = h.request_id
  where r.title = p_title and h.from_status is not null
$$;
grant execute on function pg_temp.step_id(text, integer), pg_temp.request_id(text) to authenticated;

-- 1. ขอ-ตอบหลายรอบ แล้วไม่อนุมัติ -----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_create_request(
  (select id from public.request_types where code = 'MANAGEMENT'),
  'NOTES_LOOP', 'ขอ-ตอบหลายรอบ', 'normal', '{}'::jsonb, '{}'::uuid[]);
select public.app_create_request(
  (select id from public.request_types where code = 'MANAGEMENT'),
  'NOTES_APPROVE', 'อนุมัติพร้อมความเห็น', 'normal', '{}'::jsonb, '{}'::uuid[]);

-- คนนอกสายอนุมัติตัดสินใจไม่ได้ และตอบแทนผู้ยื่นไม่ได้ (ไม่มีแถวประวัติเกิดขึ้น)
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_LOOP', 1), 'more_info', 'คนนอกขอข้อมูล') $$,
  'NOT_AUTHORIZED',
  'an employee outside the approval chain cannot ask for more information'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_LOOP', 1), 'approved', 'ผ่านขั้นโรงงาน') $$,
  'admin approves the intermediate step'
);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_LOOP', 2), 'more_info', '  ขอใบเสนอราคา  ') $$,
  'admin asks for more information with a reason'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_resubmit_request(pg_temp.request_id('NOTES_LOOP'), 'ตอบแทนผู้ยื่น') $$,
  'NOT_AUTHORIZED',
  'only the requester can reply'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_resubmit_request(pg_temp.request_id('NOTES_LOOP'), 'แนบใบเสนอราคาแล้ว') $$,
  'requester replies with the requested information'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_LOOP', 2), 'more_info', 'ขอรายละเอียดราคาเพิ่ม') $$,
  'admin asks for more information a second time'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_resubmit_request(pg_temp.request_id('NOTES_LOOP'), null) $$,
  'requester resubmits without a message'
);

select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_LOOP', 2), 'rejected', 'งบประมาณไม่พอ') $$,
  'admin rejects with a reason'
);

-- 2. อนุมัติขั้นสุดท้ายพร้อมความเห็น ---------------------------------------------------
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_APPROVE', 1), 'approved', null) $$,
  'admin approves the first step without a comment'
);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('NOTES_APPROVE', 2), 'approved', 'อนุมัติตามเสนอ') $$,
  'admin approves the final step with a comment'
);

-- ผู้ใช้แก้/เติม note ของประวัติเอง หรือฝากข้อความเองไม่ได้
select throws_ok(
  $$ update public.request_status_history set note = 'ปลอมข้อความ' where request_id = pg_temp.request_id('NOTES_LOOP') $$,
  '42501',
  null,
  'status history notes cannot be written through the Data API'
);
select throws_ok(
  $$ select private.set_status_note('ปลอมข้อความ') $$,
  '42501',
  null,
  'authenticated users cannot stage a status note'
);
select throws_ok(
  $$ select private.backfill_status_history_notes() $$,
  '42501',
  null,
  'authenticated users cannot run the backfill'
);
reset role;

select bag_eq(
  $$ select * from pg_temp.note_rows('NOTES_LOOP') $$,
  array[
    'more_info=ขอใบเสนอราคา',
    'pending_approval=แนบใบเสนอราคาแล้ว',
    'more_info=ขอรายละเอียดราคาเพิ่ม',
    'pending_approval=∅',
    'rejected=งบประมาณไม่พอ'
  ],
  'every request, reply and rejection keeps its own message in the timeline, trimmed, and an empty reply stays empty'
);
select is(
  (select comment from public.approval_steps where id = pg_temp.step_id('NOTES_LOOP', 2)),
  'งบประมาณไม่พอ',
  'the step comment is still overwritten by the latest decision (unchanged behavior), so history is the only full record'
);
select is(
  (select comment from public.approval_steps where id = pg_temp.step_id('NOTES_LOOP', 1)),
  'ผ่านขั้นโรงงาน',
  'an intermediate approval keeps its comment on the step'
);
select bag_eq(
  $$ select * from pg_temp.note_rows('NOTES_APPROVE') $$,
  array['approved=อนุมัติตามเสนอ'],
  'the final approval comment is recorded on the approved history row'
);
select is(
  (select count(*)::int from public.request_status_history h
   where h.request_id = pg_temp.request_id('NOTES_LOOP') and h.note in ('คนนอกขอข้อมูล', 'ตอบแทนผู้ยื่น', 'ปลอมข้อความ')),
  0,
  'denied attempts leave no message in the history'
);

-- 3. ข้อความที่ฝากไว้ใช้ได้ครั้งเดียว -----------------------------------------------------
select private.set_status_note('ข้อความครั้งเดียว');
update public.requests set status = 'more_info' where id = pg_temp.request_id('NOTES_APPROVE');
update public.requests set status = 'approved' where id = pg_temp.request_id('NOTES_APPROVE');
select bag_eq(
  $$ select * from pg_temp.note_rows('NOTES_APPROVE') $$,
  array['approved=อนุมัติตามเสนอ', 'more_info=ข้อความครั้งเดียว', 'approved=∅'],
  'a staged note is consumed by the next status change only'
);

-- 4. เติมย้อนหลังจาก audit_logs -----------------------------------------------------------
--    จำลองแถวที่เกิดจากนิยามเดิม: แถวประวัติไม่มี note ส่วน audit ของ approval_steps ใน transaction
--    เดียวกัน (created_at เท่ากัน) เก็บ comment ไว้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_create_request(
  (select id from public.request_types where code = 'MANAGEMENT'),
  'NOTES_LEGACY', 'แถวเก่าก่อน migration', 'normal', '{}'::jsonb, '{}'::uuid[]);
reset role;

insert into public.request_status_history (request_id, from_status, to_status, changed_by, note, created_at)
select pg_temp.request_id('NOTES_LEGACY'), v.from_status::public.request_status, v.to_status::public.request_status,
       null, v.note, v.at::timestamptz
from (values
  ('pending_approval', 'more_info', null, '2026-09-01 09:00:00+07'),
  ('more_info', 'pending_approval', null, '2026-09-01 10:00:00+07'),
  ('pending_approval', 'more_info', null, '2026-09-01 11:00:00+07'),
  ('more_info', 'pending_approval', null, '2026-09-01 12:00:00+07'),
  ('pending_approval', 'more_info', 'มีอยู่แล้ว', '2026-09-01 13:00:00+07'),
  ('more_info', 'pending_approval', null, '2026-09-01 14:00:00+07')
) v(from_status, to_status, note, at);

insert into public.audit_logs (action, entity_type, entity_id, metadata, created_at)
select 'UPDATE', 'approval_steps', pg_temp.step_id('NOTES_LEGACY', 1)::text,
       jsonb_build_object(
         'old', jsonb_build_object('request_id', pg_temp.request_id('NOTES_LEGACY'), 'status', v.old_status, 'comment', v.old_comment),
         'new', jsonb_build_object('request_id', pg_temp.request_id('NOTES_LEGACY'), 'status', v.new_status, 'comment', v.new_comment)),
       v.at::timestamptz
from (values
  ('pending', 'more_info', null, 'เหตุผลรอบแรก', '2026-09-01 09:00:00+07'),
  ('more_info', 'pending', 'เหตุผลรอบแรก', 'เหตุผลรอบแรก | ตอบกลับ: คำตอบ 100% | ครบ', '2026-09-01 10:00:00+07'),
  ('pending', 'more_info', 'เหตุผลรอบแรก | ตอบกลับ: คำตอบ 100% | ครบ', 'เหตุผลรอบสอง', '2026-09-01 11:00:00+07'),
  ('more_info', 'pending', 'เหตุผลรอบสอง', 'เหตุผลรอบสอง', '2026-09-01 12:00:00+07'),
  ('pending', 'more_info', null, 'ไม่ควรทับ', '2026-09-01 13:00:00+07'),
  ('more_info', 'pending', null, 'ตอบกลับ: ตอบโดยไม่มีเหตุผลเดิม', '2026-09-01 14:00:00+07')
) v(old_status, new_status, old_comment, new_comment, at);

select cmp_ok(private.backfill_status_history_notes(), '>=', 3, 'the backfill fills legacy rows');
-- แถวจำลองมี created_at ต่างกัน จึงตรวจตามลำดับเวลาได้
select is(
  (select array_agg(h.to_status::text || '=' || coalesce(h.note, '∅') order by h.created_at)
   from public.request_status_history h
   where h.request_id = pg_temp.request_id('NOTES_LEGACY') and h.from_status is not null),
  array[
    'more_info=เหตุผลรอบแรก',
    'pending_approval=คำตอบ 100% | ครบ',
    'more_info=เหตุผลรอบสอง',
    'pending_approval=∅',
    'more_info=มีอยู่แล้ว',
    'pending_approval=ตอบโดยไม่มีเหตุผลเดิม'
  ],
  'legacy reasons and replies are recovered from the audit trail without overwriting existing notes'
);
select is(private.backfill_status_history_notes(), 0, 'the backfill is safe to run again');

select * from finish();
rollback;
