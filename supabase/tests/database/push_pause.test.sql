-- ทดสอบพักแจ้งเตือน Web Push ถึง 07:00 ไทยวันถัดไป (20261210010000_push_pause.sql)
--   1) โครงสร้าง: ตาราง push_pauses เปิด RLS ไม่มีสิทธิ์ตรงของ anon/authenticated (service_role อ่าน/ลบได้เท่านั้น), RPC 3 ตัวเรียกได้เฉพาะ authenticated,
--      ฟังก์ชันจองสรุปเรียกได้เฉพาะ service_role, drain/dispatch/ตัวช่วยเรียกจากผู้ใช้ไม่ได้, งาน cron ลงทะเบียน, ติด sandbox_guard + lab-only
--   2) เวลาสิ้นสุด: 07:00 น. ของวันปฏิทินไทยถัดไปเสมอ (รวมกดหลังเที่ยงคืน ขอบเขต UTC และสิ้นปี)
--   3) RPC: anon / บัญชีที่ไม่ผูกพนักงาน / พนักงานปิดใช้งาน / LAB-only ถูกปฏิเสธ · พัก/ถาม/ยกเลิก · กดซ้ำคืนเวลาเดิม · คนอื่นเห็นหรือยกเลิกของกันไม่ได้
--      แถวเดิมหมดเวลาแล้วกดพักใหม่ = เริ่มรอบใหม่ (ล้างสถานะจอง คง paused_at เดิม) · แถวหมดเวลาแล้วถือว่าไม่ได้พัก
--   4) ส่งสรุปหลังครบเวลา: จองเฉพาะคนที่มีแจ้งเตือนที่ถูกข้าม (PAUSED) และยังไม่อ่าน นับถูก (ไม่นับที่อ่านแล้ว/ก่อนพัก/เหตุผลอื่น) ·
--      คนไม่มีอะไรให้สรุป/ไม่ active ถูกลบ · ยังไม่หมดเวลาไม่แตะ · จองซ้ำทันทีไม่ได้ (เช่า) · หมดเช่าจองใหม่ นับครั้ง ครบ 3 ครั้งเลิก ·
--      กดยกเลิกพักก่อนเวลา = ไม่ส่งสรุป · เคารพ p_limit · drain ไม่ล้มเมื่อยังไม่ตั้ง Vault
--   5) โหมดทดสอบของ admin: พัก/ยกเลิกพักไม่ได้ อ่านสถานะได้ และกลับมาใช้ได้หลังออกจากโหมด
begin;

create extension if not exists pgtap with schema extensions;
select plan(76);

-- 1. โครงสร้าง ------------------------------------------------------------------------------
select has_table('public', 'push_pauses', 'push_pauses exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.push_pauses'::regclass),
  'row level security is enabled on push_pauses'
);
select ok(
  not has_table_privilege('anon', 'public.push_pauses', 'select')
  and not has_table_privilege('authenticated', 'public.push_pauses', 'select')
  and not has_table_privilege('authenticated', 'public.push_pauses', 'insert')
  and not has_table_privilege('authenticated', 'public.push_pauses', 'update')
  and not has_table_privilege('authenticated', 'public.push_pauses', 'delete'),
  'anon and authenticated have no direct privilege on push_pauses'
);
select ok(
  has_table_privilege('service_role', 'public.push_pauses', 'select')
  and has_table_privilege('service_role', 'public.push_pauses', 'delete')
  and not has_table_privilege('service_role', 'public.push_pauses', 'insert')
  and not has_table_privilege('service_role', 'public.push_pauses', 'update'),
  'service_role can only read and delete push_pauses (notify-push); writes go through the RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.app_push_pause()', 'execute')
  and has_function_privilege('authenticated', 'public.app_push_resume()', 'execute')
  and has_function_privilege('authenticated', 'public.app_push_pause_status()', 'execute')
  and not has_function_privilege('anon', 'public.app_push_pause()', 'execute')
  and not has_function_privilege('anon', 'public.app_push_resume()', 'execute')
  and not has_function_privilege('anon', 'public.app_push_pause_status()', 'execute'),
  'the three user RPCs are executable by authenticated and not by anon'
);
select ok(
  has_function_privilege('service_role', 'public.app_claim_push_pause_digests(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.app_claim_push_pause_digests(integer)', 'execute')
  and not has_function_privilege('anon', 'public.app_claim_push_pause_digests(integer)', 'execute'),
  'the digest claim function is executable by service_role only'
);
select ok(
  not has_function_privilege('authenticated', 'private.drain_push_pause_digests()', 'execute')
  and not has_function_privilege('authenticated', 'private.dispatch_push_pause_digests()', 'execute')
  and not has_function_privilege('authenticated', 'private.push_pause_end(timestamptz)', 'execute')
  and not has_function_privilege('authenticated', 'private.push_pause_missed_count(uuid, timestamptz)', 'execute'),
  'drain, dispatch and helper functions are not executable by authenticated'
);
select is(
  (select schedule from cron.job where jobname = 'push-pause-digest'),
  '* * * * *',
  'the pause digest job runs every minute'
);
select ok(
  exists (select 1 from pg_trigger t where t.tgrelid = 'public.push_pauses'::regclass and t.tgname = 'sandbox_guard' and not t.tgisinternal),
  'push_pauses has the sandbox guard trigger'
);
select ok(
  exists (select 1 from pg_policy p where p.polrelid = 'public.push_pauses'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'push_pauses has the lab-only restrictive policy'
);

-- 2. เวลาสิ้นสุดการพัก = 07:00 ไทยของวันปฏิทินไทยถัดไป ------------------------------------------------
select is(private.push_pause_end('2026-11-22 14:00:00+07'), '2026-11-23 07:00:00+07'::timestamptz, 'afternoon press pauses until 07:00 the next Thai day');
select is(private.push_pause_end('2026-11-22 06:59:00+07'), '2026-11-23 07:00:00+07'::timestamptz, 'a press just before 07:00 still pauses until 07:00 the next Thai day');
select is(private.push_pause_end('2026-11-22 07:00:00+07'), '2026-11-23 07:00:00+07'::timestamptz, 'a press exactly at 07:00 pauses until 07:00 the next Thai day');
select is(private.push_pause_end('2026-11-22 23:59:00+07'), '2026-11-23 07:00:00+07'::timestamptz, 'a press just before Thai midnight pauses until 07:00 the next Thai day');
select is(private.push_pause_end('2026-11-23 00:30:00+07'), '2026-11-24 07:00:00+07'::timestamptz, 'a press after Thai midnight pauses until 07:00 of the NEXT Thai calendar day (not the same morning)');
select is(private.push_pause_end('2026-11-22 17:30:00+00'), '2026-11-24 00:00:00+00'::timestamptz, 'the Thai day is used, not the UTC day (17:30 UTC is already the next Thai day)');
select is(private.push_pause_end('2026-12-31 20:00:00+07'), '2027-01-01 07:00:00+07'::timestamptz, 'the end of the year rolls over');

-- ผู้ใช้ทดสอบ: A, B, E ใช้งานอยู่; C ปิดใช้งาน; D เป็นบัญชี LAB-only; 99 เป็นบัญชี auth ที่ไม่ผูกพนักงาน -----------
insert into auth.users (id, email, raw_user_meta_data) values
  ('92000000-0000-0000-0000-0000000000a1', 'pause-a@mnp.local', '{}'::jsonb),
  ('92000000-0000-0000-0000-0000000000b1', 'pause-b@mnp.local', '{}'::jsonb),
  ('92000000-0000-0000-0000-0000000000c1', 'pause-c@mnp.local', '{}'::jsonb),
  ('92000000-0000-0000-0000-0000000000d1', 'pause-d@mnp.local', '{}'::jsonb),
  ('92000000-0000-0000-0000-0000000000e1', 'pause-e@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('92000000-0000-0000-0000-000000000001', 'PAUSE-A', 'เอ', 'ทดสอบ', 'pause-a@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000a1', true),
  ('92000000-0000-0000-0000-000000000002', 'PAUSE-B', 'บี', 'ทดสอบ', 'pause-b@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000b1', true),
  ('92000000-0000-0000-0000-000000000003', 'PAUSE-C', 'ซี', 'ทดสอบ', 'pause-c@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000c1', false),
  ('92000000-0000-0000-0000-000000000004', 'MNPLAB002', 'แล็บ', 'ทดสอบ', 'pause-d@mnp.local', 'LAB',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000d1', true),
  ('92000000-0000-0000-0000-000000000005', 'PAUSE-E', 'อี', 'ทดสอบ', 'pause-e@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-0000000000e1', true);

-- 3. ไม่มีสิทธิ์ ------------------------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.app_push_pause() $$, '42501', null, 'anon cannot pause');
select throws_ok($$ select public.app_push_resume() $$, '42501', null, 'anon cannot resume');
select throws_ok($$ select public.app_push_pause_status() $$, '42501', null, 'anon cannot ask for the pause status');
select throws_ok($$ select * from public.app_claim_push_pause_digests(10) $$, '42501', null, 'anon cannot claim pause digests');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-000000000099","role":"authenticated"}', true);
select throws_ok($$ select public.app_push_pause() $$, 'NOT_AUTHORIZED', 'an account that is not mapped to an employee cannot pause');
select throws_ok($$ select public.app_push_resume() $$, 'NOT_AUTHORIZED', 'an account that is not mapped to an employee cannot resume');
select throws_ok($$ select public.app_push_pause_status() $$, 'NOT_AUTHORIZED', 'an account that is not mapped to an employee cannot ask for the status');
select throws_ok($$ select * from public.app_claim_push_pause_digests(10) $$, '42501', null, 'authenticated users cannot claim pause digests');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
select throws_ok($$ select public.app_push_pause() $$, 'NOT_AUTHORIZED', 'an inactive employee cannot pause');

select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select throws_ok($$ select public.app_push_pause() $$, '42501', 'LAB_ONLY_ACCOUNT', 'a LAB-only account cannot pause');
select throws_ok($$ select public.app_push_resume() $$, '42501', 'LAB_ONLY_ACCOUNT', 'a LAB-only account cannot resume');
select throws_ok($$ select public.app_push_pause_status() $$, '42501', 'LAB_ONLY_ACCOUNT', 'a LAB-only account cannot ask for the status');

-- 4. พัก / ถามสถานะ / ยกเลิก -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.app_push_pause_status(), null::timestamptz, 'A is not paused at first');
select set_config('test.a_until', public.app_push_pause()::text, true);
reset role;
select is(
  current_setting('test.a_until')::timestamptz, private.push_pause_end(now()),
  'pausing returns 07:00 of the next Thai day computed from now()'
);
select ok(
  (current_setting('test.a_until')::timestamptz at time zone 'Asia/Bangkok')::time = time '07:00'
  and current_setting('test.a_until')::timestamptz > now() + interval '6 hours'
  and current_setting('test.a_until')::timestamptz <= now() + interval '31 hours',
  'the pause always ends at 07:00 Thai time, between 6 and 31 hours from now'
);
select is(
  (select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'),
  1,
  'pausing stores one row for the employee'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.app_push_pause_status()::text, current_setting('test.a_until'), 'the status returns the end time while paused');
select is(public.app_push_pause()::text, current_setting('test.a_until'), 'pausing again while paused returns the same end time (no extension)');
select throws_ok($$ select count(*) from public.push_pauses $$, '42501', null, 'authenticated users cannot read push_pauses directly');
select throws_ok(
  $$ insert into public.push_pauses (employee_id, paused_until) values ('92000000-0000-0000-0000-000000000002', now() + interval '1 day') $$,
  '42501', null, 'authenticated users cannot insert into push_pauses directly'
);

-- B ไม่เห็น/ยกเลิกการพักของ A
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select is(public.app_push_pause_status(), null::timestamptz, 'B does not see A''s pause');
select lives_ok($$ select public.app_push_resume() $$, 'B resumes (B was not paused: no error)');
reset role;
select is(
  (select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'
     and paused_until = current_setting('test.a_until')::timestamptz),
  1,
  'B resuming never removes A''s pause'
);

-- A ยกเลิกเอง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select public.app_push_resume() $$, 'A resumes');
select is(public.app_push_pause_status(), null::timestamptz, 'the status is null after resuming');
select lives_ok($$ select public.app_push_resume() $$, 'resuming when not paused is not an error');
reset role;
select is((select count(*)::integer from public.push_pauses), 0, 'resuming removed the row');

-- แถวเดิมหมดเวลาแล้วแต่ cron ยังไม่ปิด: ถือว่าไม่ได้พัก และกดพักใหม่เริ่มรอบใหม่ (คง paused_at เดิม ล้างสถานะจอง)
insert into public.push_pauses (employee_id, paused_at, paused_until, digest_attempts, digest_claimed_at, digest_claim_id)
values ('92000000-0000-0000-0000-000000000001', now() - interval '2 days', now() - interval '1 hour', 2, now(), gen_random_uuid());
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is(public.app_push_pause_status(), null::timestamptz, 'an expired pause row counts as not paused');
select set_config('test.a_until2', public.app_push_pause()::text, true);
reset role;
select ok(
  current_setting('test.a_until2')::timestamptz = private.push_pause_end(now())
  and exists (
    select 1 from public.push_pauses p
    where p.employee_id = '92000000-0000-0000-0000-000000000001'
      and p.paused_until = current_setting('test.a_until2')::timestamptz
      and p.paused_at < now() - interval '47 hours'
      and p.digest_attempts = 0 and p.digest_claimed_at is null and p.digest_claim_id is null
  ),
  'pausing again after the pause expired starts a new round: keeps the old paused_at and clears the digest claim'
);
delete from public.push_pauses;

-- 5. ส่งสรุปหลังครบเวลา ------------------------------------------------------------------------
-- แถวที่ seed/trigger สร้างไว้ก่อนหน้านี้ไม่เกี่ยวกับการทดสอบ
update public.notifications set push_status = 'skipped', push_error = 'TEST_OLD' where push_error is distinct from 'TEST_OLD';

-- A พักมาเมื่อวาน (หมดเวลาแล้ว): แจ้งเตือนที่พลาด 2 รายการ (ข้ามเพราะพัก ยังไม่อ่าน) · ที่อ่านแล้ว · ที่ถูกข้ามก่อนเริ่มพัก · ที่ถูกข้ามด้วยเหตุผลอื่น
-- B หมดเวลาแล้วแต่ไม่มีอะไรพลาด (มีแต่ที่อ่านแล้ว) · C ปิดใช้งานแล้วแต่มีแจ้งเตือนที่พลาด · E ยังไม่หมดเวลา
insert into public.push_pauses (employee_id, paused_at, paused_until) values
  ('92000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 hour'),
  ('92000000-0000-0000-0000-000000000002', now() - interval '1 day', now() - interval '1 hour'),
  ('92000000-0000-0000-0000-000000000003', now() - interval '1 day', now() - interval '1 hour'),
  ('92000000-0000-0000-0000-000000000005', now() - interval '1 hour', now() + interval '5 hours');

insert into public.notifications (recipient_id, title, body, push_status, push_error, push_attempted_at, read_at) values
  ('92000000-0000-0000-0000-000000000001', 'a-missed-1', 'b', 'skipped', 'PAUSED', now() - interval '5 hours', null),
  ('92000000-0000-0000-0000-000000000001', 'a-missed-2', 'b', 'skipped', 'PAUSED', now() - interval '3 hours', null),
  ('92000000-0000-0000-0000-000000000001', 'a-read', 'b', 'skipped', 'PAUSED', now() - interval '4 hours', now() - interval '2 hours'),
  ('92000000-0000-0000-0000-000000000001', 'a-before-pause', 'b', 'skipped', 'PAUSED', now() - interval '2 days', null),
  ('92000000-0000-0000-0000-000000000001', 'a-no-device', 'b', 'skipped', 'NO_SUBSCRIPTION', now() - interval '5 hours', null),
  ('92000000-0000-0000-0000-000000000001', 'a-sent', 'b', 'sent', null, now() - interval '5 hours', null),
  ('92000000-0000-0000-0000-000000000002', 'b-read', 'b', 'skipped', 'PAUSED', now() - interval '4 hours', now() - interval '2 hours'),
  ('92000000-0000-0000-0000-000000000003', 'c-missed', 'b', 'skipped', 'PAUSED', now() - interval '4 hours', null),
  ('92000000-0000-0000-0000-000000000005', 'e-missed', 'b', 'skipped', 'PAUSED', now() - interval '30 minutes', null);

select is(private.push_pause_missed_count('92000000-0000-0000-0000-000000000001', now() - interval '1 day'), 2, 'missed count: only unread PAUSED rows since the pause began');
select is(private.push_pause_missed_count('92000000-0000-0000-0000-000000000002', now() - interval '1 day'), 0, 'missed count is 0 when everything was read');

set local role service_role;
select is(
  (select jsonb_agg(jsonb_build_object('e', c.employee_id, 'n', c.missed_count, 'a', c.digest_attempts)) from public.app_claim_push_pause_digests(50) c)::text,
  '[{"a": 1, "e": "92000000-0000-0000-0000-000000000001", "n": 2}]',
  'claim returns only A (2 missed, first attempt): B has nothing to summarize, C is inactive, E has not expired'
);
reset role;
select is(
  (select array_agg(employee_id::text order by employee_id::text) from public.push_pauses),
  array['92000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000005'],
  'B (nothing missed) and C (inactive) rows were deleted by the claim; A (leased) and E (not expired) remain'
);
select is(
  (select digest_attempts from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000005'), 0,
  'an unexpired pause is never claimed'
);

set local role service_role;
select is((select count(*)::integer from public.app_claim_push_pause_digests(50)), 0, 'claiming again straight away returns nothing (the row is leased), so two runs never send the same digest');
reset role;
select ok(
  exists (select 1 from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'
            and digest_attempts = 1 and digest_claimed_at is not null and digest_claim_id is not null),
  'the claim counted an attempt and stored a claim id'
);
select set_config('test.claim1', (select digest_claim_id::text from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), true);

-- หมดเวลาเช่า → จองใหม่ได้ นับครั้งต่อ และได้รหัสจองใหม่
update public.push_pauses set digest_claimed_at = now() - interval '11 minutes' where employee_id = '92000000-0000-0000-0000-000000000001';
set local role service_role;
select is(
  (select jsonb_agg(jsonb_build_object('n', c.missed_count, 'a', c.digest_attempts))::text from public.app_claim_push_pause_digests(50) c),
  '[{"a": 2, "n": 2}]',
  'after the lease expires the row is claimed again and the attempts continue counting'
);
reset role;
select isnt(
  (select digest_claim_id::text from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), current_setting('test.claim1'),
  'a new claim gets a new claim id'
);
update public.push_pauses set digest_claimed_at = now() - interval '11 minutes' where employee_id = '92000000-0000-0000-0000-000000000001';
set local role service_role;
select is((select max(digest_attempts) from public.app_claim_push_pause_digests(50)), 3, 'the third attempt is still claimed');
reset role;
update public.push_pauses set digest_claimed_at = now() - interval '11 minutes' where employee_id = '92000000-0000-0000-0000-000000000001';
set local role service_role;
select is((select count(*)::integer from public.app_claim_push_pause_digests(50)), 0, 'after 3 attempts the row is never claimed again');
reset role;
select lives_ok($$ select private.drain_push_pause_digests() $$, 'drain does not fail when the Vault secrets are not configured');
select is(
  (select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), 0,
  'drain gives up on a digest that used all its attempts and whose lease expired'
);

-- service_role ลบแถวพักได้เฉพาะเมื่อ claim id ตรง (วิธีที่ notify-push ปิดแถวหลังส่งสำเร็จ)
insert into public.push_pauses (employee_id, paused_at, paused_until, digest_attempts, digest_claimed_at, digest_claim_id)
values ('92000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 hour', 1, now(),
        '92000000-0000-0000-0000-0000000000f1');
set local role service_role;
delete from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001' and digest_claim_id = '92000000-0000-0000-0000-0000000000f2';
select is((select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), 1, 'a stale claim id does not delete the row');
delete from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001' and digest_claim_id = '92000000-0000-0000-0000-0000000000f1';
select is((select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), 0, 'the matching claim id deletes the row (digest sent)');
reset role;

-- ยกเลิกพักก่อนเวลา (หมดเวลาแล้วแต่ยังไม่ถูกจอง) = ไม่ส่งสรุป
delete from public.push_pauses;
insert into public.push_pauses (employee_id, paused_at, paused_until)
values ('92000000-0000-0000-0000-000000000002', now() - interval '1 day', now() - interval '1 minute');
insert into public.notifications (recipient_id, title, body, push_status, push_error, push_attempted_at, read_at)
values ('92000000-0000-0000-0000-000000000002', 'b-missed', 'b', 'skipped', 'PAUSED', now() - interval '3 hours', null);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok($$ select public.app_push_resume() $$, 'B resumes before the digest was claimed');
set local role service_role;
select is((select count(*)::integer from public.app_claim_push_pause_digests(50)), 0, 'resuming cancels the digest');
reset role;

-- drain: แถวหมดเวลาที่ไม่มีอะไรพลาดถูกปิดเองโดยไม่ต้องเรียก Edge Function; แถวที่มีของพลาดอยู่ต่อ; ยังไม่หมดเวลาไม่แตะ
delete from public.push_pauses;
update public.notifications set read_at = now() where title = 'b-missed';
insert into public.push_pauses (employee_id, paused_at, paused_until) values
  ('92000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '1 hour'),
  ('92000000-0000-0000-0000-000000000002', now() - interval '1 day', now() - interval '1 hour'),
  ('92000000-0000-0000-0000-000000000005', now() - interval '1 hour', now() + interval '5 hours');
insert into public.notifications (recipient_id, title, body, push_status, push_error, push_attempted_at, read_at)
values ('92000000-0000-0000-0000-000000000001', 'a-missed-3', 'b', 'skipped', 'PAUSED', now() - interval '2 hours', null);
select lives_ok($$ select private.drain_push_pause_digests() $$, 'drain runs with an expired row that has missed notifications');
select is(
  (select array_agg(employee_id::text order by employee_id::text) from public.push_pauses),
  array['92000000-0000-0000-0000-000000000001', '92000000-0000-0000-0000-000000000005'],
  'drain removes the expired row with nothing missed (B) and keeps A (to summarize) and E (not expired)'
);
select is(
  (select digest_attempts from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), 0,
  'drain only calls the Edge Function and never claims rows itself'
);

-- p_limit: A, B, E หมดเวลาแล้วและมีของพลาดทั้งหมด
delete from public.push_pauses;
insert into public.push_pauses (employee_id, paused_at, paused_until) values
  ('92000000-0000-0000-0000-000000000001', now() - interval '1 day', now() - interval '3 hours'),
  ('92000000-0000-0000-0000-000000000002', now() - interval '1 day', now() - interval '2 hours'),
  ('92000000-0000-0000-0000-000000000005', now() - interval '1 day', now() - interval '1 hour');
update public.notifications set read_at = null where title in ('b-missed', 'e-missed');
update public.notifications set push_attempted_at = now() - interval '2 hours' where title = 'e-missed';
set local role service_role;
select is((select count(*)::integer from public.app_claim_push_pause_digests(2)), 2, 'claim honours p_limit');
select is((select count(*)::integer from public.app_claim_push_pause_digests(null)), 1, 'a null p_limit falls back to the default batch and takes what is left');
reset role;
delete from public.push_pauses;

-- 6. โหมดทดสอบของ admin: พัก/ยกเลิกพักไม่ได้ อ่านสถานะได้ และกลับมาใช้ได้หลังออกจากโหมด -------------------
select set_config('test.sbx_persona', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);
update public.employees set role_id = '20000000-0000-0000-0000-000000000004' where id = '92000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"92000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.sbx_persona')::uuid) $$, 'an admin enters the sandbox');
select throws_ok($$ select public.app_push_pause() $$, 'P0001', 'SANDBOX_MODULE_UNSUPPORTED', 'pausing is blocked while in the sandbox');
select throws_ok($$ select public.app_push_resume() $$, 'P0001', 'SANDBOX_MODULE_UNSUPPORTED', 'resuming is blocked while in the sandbox');
select is(public.app_push_pause_status(), null::timestamptz, 'reading the pause status still works in the sandbox');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the sandbox');
select lives_ok($$ select public.app_push_pause() $$, 'pausing works again after leaving the sandbox');
select ok(public.app_push_pause_status() is not null, 'and the status shows the pause');
reset role;
select is(
  (select count(*)::integer from public.push_pauses where employee_id = '92000000-0000-0000-0000-000000000001'), 1,
  'nothing was written while in the sandbox, and one row after leaving it'
);

select * from finish();
rollback;
