-- ทดสอบ Web Push (20261026010000_web_push_notifications.sql)
--   1) โครงสร้าง: ตาราง push_subscriptions เปิด RLS และไม่มีสิทธิ์ตรงของ anon/authenticated, RPC ผู้ใช้เรียกได้เฉพาะ authenticated,
--      ฟังก์ชันจองคิวเรียกได้เฉพาะ service_role, ฟังก์ชัน drain เรียกจากผู้ใช้ไม่ได้, งาน cron ลงทะเบียนครบ
--   2) RPC ผู้ใช้: anon / บัญชีที่ไม่ผูกพนักงาน / พนักงานที่ปิดใช้งาน / บัญชี LAB-only ถูกปฏิเสธ, ตรวจรูปแบบ endpoint และกุญแจ,
--      บันทึกซ้ำคือ upsert, endpoint ของอีกคนถูกย้ายมาเป็นของผู้เรียก, เกิน 10 เครื่องตัดเครื่องเก่าสุด,
--      ลบ/ถามได้เฉพาะของตัวเอง, ผู้ใช้อ่าน/เขียนตารางตรงไม่ได้
--   3) คิว: แถวใหม่เป็น pending, จองแล้วนับครั้งและเช่าไว้ (จองซ้ำทันทีไม่ได้), อ่านแล้ว/เก่าเกิน 24 ชม. ถูกข้าม,
--      ใช้โควตาครบแล้วหมดเวลาเช่าเป็น failed, เคารพ p_limit, drain ไม่แตะแถวและไม่ล้มเมื่อยังไม่ตั้ง Vault
begin;

create extension if not exists pgtap with schema extensions;
select plan(60);

-- 1. โครงสร้าง ------------------------------------------------------------------------------
select has_table('public', 'push_subscriptions', 'push_subscriptions exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_subscriptions'::regclass),
  'row level security is enabled on push_subscriptions'
);
select ok(
  not has_table_privilege('anon', 'public.push_subscriptions', 'select')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'select')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'insert')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'update')
  and not has_table_privilege('authenticated', 'public.push_subscriptions', 'delete'),
  'anon and authenticated have no direct privilege on push_subscriptions'
);
select ok(
  has_table_privilege('service_role', 'public.push_subscriptions', 'select')
  and has_table_privilege('service_role', 'public.push_subscriptions', 'delete'),
  'service_role can read and delete push_subscriptions (notify-push removes dead endpoints)'
);
select ok(
  has_function_privilege('authenticated', 'public.app_save_push_subscription(text, text, text, text)', 'execute')
  and has_function_privilege('authenticated', 'public.app_delete_push_subscription(text)', 'execute')
  and has_function_privilege('authenticated', 'public.app_is_push_subscribed(text)', 'execute')
  and not has_function_privilege('anon', 'public.app_save_push_subscription(text, text, text, text)', 'execute')
  and not has_function_privilege('anon', 'public.app_delete_push_subscription(text)', 'execute')
  and not has_function_privilege('anon', 'public.app_is_push_subscribed(text)', 'execute'),
  'the three user RPCs are executable by authenticated and not by anon'
);
select ok(
  has_function_privilege('service_role', 'public.app_claim_push_notifications(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.app_claim_push_notifications(integer)', 'execute')
  and not has_function_privilege('anon', 'public.app_claim_push_notifications(integer)', 'execute'),
  'the claim function is executable by service_role only'
);
select ok(
  not has_function_privilege('authenticated', 'private.drain_pending_push_notifications()', 'execute')
  and not has_function_privilege('authenticated', 'private.dispatch_pending_push_notifications()', 'execute'),
  'drain and dispatch functions are not executable by authenticated'
);
select is(
  (select schedule from cron.job where jobname = 'notification-push-drain'),
  '* * * * *',
  'the push queue drain runs every minute'
);
select is(
  (select count(*)::integer from pg_indexes
   where schemaname = 'public' and tablename = 'notifications' and indexname = 'notifications_push_pending_idx'),
  1,
  'there is a partial index for pending push rows'
);

-- ผู้ใช้ทดสอบ: A, B ใช้งานอยู่; C ปิดใช้งาน; D เป็นบัญชี LAB-only; 99 เป็นบัญชี auth ที่ไม่ผูกพนักงาน ---------
insert into auth.users (id, email, raw_user_meta_data) values
  ('91000000-0000-0000-0000-0000000000a1', 'push-a@mnp.local', '{}'::jsonb),
  ('91000000-0000-0000-0000-0000000000b1', 'push-b@mnp.local', '{}'::jsonb),
  ('91000000-0000-0000-0000-0000000000c1', 'push-c@mnp.local', '{}'::jsonb),
  ('91000000-0000-0000-0000-0000000000d1', 'push-d@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('91000000-0000-0000-0000-000000000001', 'PUSH-A', 'เอ', 'ทดสอบ', 'push-a@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-0000000000a1', true),
  ('91000000-0000-0000-0000-000000000002', 'PUSH-B', 'บี', 'ทดสอบ', 'push-b@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-0000000000b1', true),
  ('91000000-0000-0000-0000-000000000003', 'PUSH-C', 'ซี', 'ทดสอบ', 'push-c@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-0000000000c1', false),
  ('91000000-0000-0000-0000-000000000004', 'MNPLAB001', 'แล็บ', 'ทดสอบ', 'push-d@mnp.local', 'LAB',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '91000000-0000-0000-0000-0000000000d1', true);

-- 2. ไม่มีสิทธิ์ ------------------------------------------------------------------------------
set local role anon;
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22)) $$,
  '42501', null, 'anon cannot save a push subscription'
);
select throws_ok(
  $$ select public.app_delete_push_subscription('https://fcm.googleapis.com/fcm/send/x') $$,
  '42501', null, 'anon cannot delete a push subscription'
);
select throws_ok(
  $$ select public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/x') $$,
  '42501', null, 'anon cannot ask whether an endpoint is subscribed'
);
select throws_ok(
  $$ select * from public.app_claim_push_notifications(10) $$,
  '42501', null, 'anon cannot claim push notifications'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22)) $$,
  'NOT_AUTHORIZED', 'an account that is not mapped to an employee is rejected'
);
select throws_ok(
  $$ select * from public.app_claim_push_notifications(10) $$,
  '42501', null, 'authenticated users cannot claim push notifications'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22)) $$,
  'NOT_AUTHORIZED', 'an inactive employee cannot save a push subscription'
);
select throws_ok(
  $$ select public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/x') $$,
  'NOT_AUTHORIZED', 'an inactive employee cannot ask about subscriptions'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22)) $$,
  '42501', 'LAB_ONLY_ACCOUNT', 'a LAB-only account cannot save a push subscription'
);

-- 3. ตรวจรูปแบบข้อมูล -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_save_push_subscription('http://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a non-https endpoint is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/' || repeat('x', 2100), repeat('A', 87), repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'an endpoint longer than 2048 characters is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/a b', repeat('A', 87), repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'an endpoint containing whitespace is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription(null, repeat('A', 87), repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a missing endpoint is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 20), repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a too-short p256dh key is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 86) || '+', repeat('B', 22)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a p256dh key that is not base64url is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), null) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a missing auth secret is rejected'
);
select throws_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('A', 87), repeat('B', 5)) $$,
  '22023', 'INVALID_PUSH_SUBSCRIPTION', 'a too-short auth secret is rejected'
);

-- 4. บันทึก / ถาม / ย้าย / ลบ -----------------------------------------------------------------
select lives_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/push-test-a', repeat('A', 87), repeat('B', 22), '  UA-1  ') $$,
  'employee A saves a valid subscription'
);
select is(public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/push-test-a'), true, 'A sees the endpoint as subscribed');
select is(public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/never-saved'), false, 'an unknown endpoint is not subscribed');
select throws_ok(
  $$ select count(*) from public.push_subscriptions $$,
  '42501', null, 'authenticated users cannot read push_subscriptions directly'
);
select throws_ok(
  $$ insert into public.push_subscriptions (employee_id, endpoint, p256dh, auth) values ('91000000-0000-0000-0000-000000000001', 'https://x.example/e', 'a', 'b') $$,
  '42501', null, 'authenticated users cannot insert into push_subscriptions directly'
);

select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/push-test-a'), false, 'B does not see A''s endpoint as its own');
select is(public.app_delete_push_subscription('https://fcm.googleapis.com/fcm/send/push-test-a'), false, 'B cannot delete A''s subscription');

reset role;
select is(
  (select count(*)::integer from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/push-test-a'
     and employee_id = '91000000-0000-0000-0000-000000000001' and user_agent = 'UA-1'),
  1,
  'A''s subscription is still there with a trimmed user agent after B tried to delete it'
);

-- บันทึกซ้ำ = upsert และล้าง failure_count
update public.push_subscriptions set failure_count = 5 where endpoint = 'https://fcm.googleapis.com/fcm/send/push-test-a';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/push-test-a', repeat('C', 87), repeat('D', 22), 'UA-2') $$,
  'A saves the same endpoint again with new keys'
);
reset role;
select is(
  (select count(*)::integer from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/push-test-a'
     and p256dh = repeat('C', 87) and auth = repeat('D', 22) and user_agent = 'UA-2' and failure_count = 0),
  1,
  'saving again updates the same row (no duplicate), replaces the keys and clears failure_count'
);

-- เครื่องที่ใช้ร่วมกัน: B บันทึก endpoint เดียวกัน → ย้ายมาเป็นของ B
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/push-test-a', repeat('E', 87), repeat('F', 22)) $$,
  'B saves an endpoint that belonged to A'
);
select is(public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/push-test-a'), true, 'the endpoint now belongs to B');
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.app_is_push_subscribed('https://fcm.googleapis.com/fcm/send/push-test-a'), false, 'and no longer belongs to A');
reset role;
select is(
  (select count(*)::integer from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/push-test-a'),
  1,
  'moving an endpoint never leaves two rows for it'
);

-- เกิน 10 เครื่อง: ตัดเครื่องที่ updated_at เก่าที่สุดของ A
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/cap-' || n, repeat('A', 87), repeat('B', 22))
from generate_series(1, 10) n;
reset role;
update public.push_subscriptions
set updated_at = now() - ((100 - substring(endpoint from '[0-9]+$')::integer) || ' hours')::interval
where endpoint like 'https://fcm.googleapis.com/fcm/send/cap-%';
update public.push_subscriptions set updated_at = now() - interval '200 hours'
where endpoint = 'https://fcm.googleapis.com/fcm/send/cap-1';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_save_push_subscription('https://fcm.googleapis.com/fcm/send/cap-11', repeat('A', 87), repeat('B', 22)) $$,
  'A saves an 11th device'
);
reset role;
select is(
  (select count(*)::integer from public.push_subscriptions where employee_id = '91000000-0000-0000-0000-000000000001'),
  10,
  'an employee keeps at most 10 devices'
);
select ok(
  not exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/cap-1')
  and exists (select 1 from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/cap-11'),
  'the oldest device is dropped and the newly saved one is kept'
);
select is(
  (select count(*)::integer from public.push_subscriptions where employee_id = '91000000-0000-0000-0000-000000000002'),
  1,
  'the cap of one employee does not touch another employee''s devices'
);

-- ลบของตัวเอง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"91000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.app_delete_push_subscription('https://fcm.googleapis.com/fcm/send/cap-2'), true, 'A deletes its own subscription');
select is(public.app_delete_push_subscription('https://fcm.googleapis.com/fcm/send/cap-2'), false, 'deleting it again reports nothing was deleted');
reset role;

-- 5. คิวส่ง ----------------------------------------------------------------------------------
-- แถวที่ seed/trigger สร้างไว้ก่อนหน้านี้ไม่เกี่ยวกับการทดสอบ ปิดทิ้งเพื่อให้การจองเห็นเฉพาะแถวของเทสต์นี้
update public.notifications set push_status = 'skipped';

-- n1 ใหม่ / n2 ผู้รับอ่านแล้ว / n3 เก่าเกิน 24 ชม. / n4 ใช้โควตาครบและหมดเวลาเช่า / n5 กำลังเช่าอยู่ / n6 เช่าหมดแล้วลองไปครั้งเดียว / n7 ส่งแล้ว
insert into public.notifications (id, recipient_id, title, body, created_at, read_at, push_status, push_attempts, push_attempted_at) values
  ('91000000-0000-0000-0000-0000000000f1', '91000000-0000-0000-0000-000000000001', 'n1', 'b', now() - interval '10 minutes', null, default, default, null),
  ('91000000-0000-0000-0000-0000000000f2', '91000000-0000-0000-0000-000000000001', 'n2', 'b', now() - interval '10 minutes', now(), default, default, null),
  ('91000000-0000-0000-0000-0000000000f3', '91000000-0000-0000-0000-000000000001', 'n3', 'b', now() - interval '25 hours', null, default, default, null),
  ('91000000-0000-0000-0000-0000000000f4', '91000000-0000-0000-0000-000000000001', 'n4', 'b', now() - interval '1 hour', null, 'pending', 3, now() - interval '10 minutes'),
  ('91000000-0000-0000-0000-0000000000f5', '91000000-0000-0000-0000-000000000001', 'n5', 'b', now() - interval '1 hour', null, 'pending', 1, now() - interval '1 minute'),
  ('91000000-0000-0000-0000-0000000000f6', '91000000-0000-0000-0000-000000000001', 'n6', 'b', now() - interval '1 hour', null, 'pending', 1, now() - interval '5 minutes'),
  ('91000000-0000-0000-0000-0000000000f7', '91000000-0000-0000-0000-000000000001', 'n7', 'b', now() - interval '1 hour', null, 'sent', 1, now() - interval '5 minutes');

select is(
  (select push_status from public.notifications where id = '91000000-0000-0000-0000-0000000000f1'),
  'pending',
  'a newly inserted notification starts as pending'
);
select throws_ok(
  $$ update public.notifications set push_status = 'bogus' where id = '91000000-0000-0000-0000-0000000000f1' $$,
  '23514', null, 'push_status only accepts pending, sent, skipped or failed'
);
select is(
  (select column_default from information_schema.columns
   where table_schema = 'public' and table_name = 'notifications' and column_name = 'push_status'),
  '''pending''::text',
  'new notifications default to pending (rows that existed before the migration were set to skipped by it)'
);

-- drain: มีแถว pending ที่จองได้แต่ยังไม่ได้ตั้ง Vault → ไม่ล้ม ไม่แตะแถว
select lives_ok($$ select private.drain_pending_push_notifications() $$, 'drain does not fail when the Vault secrets are not configured');
select is(
  (select push_attempts from public.notifications where id = '91000000-0000-0000-0000-0000000000f1'),
  0,
  'drain only calls the Edge Function and never claims rows itself'
);

set local role service_role;
select is(
  (select array_agg(c.id order by c.id)::text from public.app_claim_push_notifications(50) c),
  array['91000000-0000-0000-0000-0000000000f1', '91000000-0000-0000-0000-0000000000f6']::text,
  'claim returns the fresh row and the row whose lease expired, and nothing else'
);
select is(
  (select count(*)::integer from public.app_claim_push_notifications(50)),
  0,
  'claiming again straight away returns nothing (rows are leased), so two drains never send the same row'
);
reset role;

select is(
  (select push_attempts from public.notifications where id = '91000000-0000-0000-0000-0000000000f1'),
  1,
  'claiming counts an attempt'
);
select is(
  (select push_attempts from public.notifications where id = '91000000-0000-0000-0000-0000000000f6'),
  2,
  'a re-claimed row continues counting from its previous attempts'
);
select results_eq(
  $$ select push_status, push_error from public.notifications where id in
       ('91000000-0000-0000-0000-0000000000f2', '91000000-0000-0000-0000-0000000000f3') order by id $$,
  $$ values ('skipped'::text, 'ALREADY_READ'::text), ('skipped'::text, 'EXPIRED'::text) $$,
  'a read notification and one older than 24 hours are skipped with a reason'
);
select results_eq(
  $$ select push_status, push_error from public.notifications where id = '91000000-0000-0000-0000-0000000000f4' $$,
  $$ values ('failed'::text, 'LEASE_EXPIRED'::text) $$,
  'a row that used all its attempts and was never settled becomes failed'
);
select results_eq(
  $$ select push_status, push_attempts from public.notifications where id in
       ('91000000-0000-0000-0000-0000000000f5', '91000000-0000-0000-0000-0000000000f7') order by id $$,
  $$ values ('pending'::text, 1), ('sent'::text, 1) $$,
  'a leased row and an already sent row are left alone'
);

-- p_limit
insert into public.notifications (id, recipient_id, title, body) values
  ('91000000-0000-0000-0000-0000000000e1', '91000000-0000-0000-0000-000000000001', 'e1', 'b'),
  ('91000000-0000-0000-0000-0000000000e2', '91000000-0000-0000-0000-000000000001', 'e2', 'b'),
  ('91000000-0000-0000-0000-0000000000e3', '91000000-0000-0000-0000-000000000001', 'e3', 'b');
set local role service_role;
select is(
  (select count(*)::integer from public.app_claim_push_notifications(2)),
  2,
  'claim honours p_limit'
);
select is(
  (select count(*)::integer from public.app_claim_push_notifications(null)),
  1,
  'a null p_limit falls back to the default batch and takes what is left'
);
reset role;

select * from finish();
rollback;
