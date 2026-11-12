-- ทดสอบกติกาแผนกกับอีเมล/Web Push (20261117010000_department_notification_filter.sql)
--   1) โครงสร้าง: ตารางรายการที่อนุญาตปิดจาก anon/authenticated, ฟังก์ชันเรียกจากผู้ใช้ไม่ได้, trigger ลงทะเบียน,
--      รายการของแผนก ID = MT_REPAIR + IT_REPAIR พอดี
--   2) allow: พนักงานแผนก ID ได้อีเมล/push ของแจ้งซ่อม MT/IT, เรื่อง /profile และสรุปงานค้างที่มีแต่ใบ MT/IT
--   3) deny: แผนก ID (รวม admin) ไม่ได้ของคำร้องฝ่ายบริหาร NCR /admin ไม่มีลิงก์ สรุปงานค้างที่มีงานอื่นปน/ว่าง/รูปแบบผิด
--      แถวในแอปยังถูกบันทึก, ตั้งกลับเป็น pending ไม่ได้, คิว push ไม่จองแถวที่ถูกข้าม
--   4) แผนกอื่นไม่เปลี่ยน และย้ายออกจากแผนก ID แล้วได้รับตามปกติ
begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

-- 1. โครงสร้าง ------------------------------------------------------------------------------
select has_table('private', 'department_notification_modules', 'the department allowlist table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'private.department_notification_modules'::regclass),
  'row level security is enabled on the allowlist'
);
select ok(
  not has_table_privilege('anon', 'private.department_notification_modules', 'select')
  and not has_table_privilege('authenticated', 'private.department_notification_modules', 'select')
  and not has_table_privilege('authenticated', 'private.department_notification_modules', 'insert')
  and not has_table_privilege('authenticated', 'private.department_notification_modules', 'update')
  and not has_table_privilege('authenticated', 'private.department_notification_modules', 'delete'),
  'anon and authenticated have no privilege on the allowlist'
);
select ok(
  not has_function_privilege('authenticated', 'private.department_notification_allowed(uuid, uuid, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'private.department_notification_allowed(uuid, uuid, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'private.notifications_department_filter()', 'execute')
  and not has_function_privilege('anon', 'private.notifications_department_filter()', 'execute'),
  'the rule and trigger functions are not executable by users'
);
select ok(
  exists (select 1 from pg_trigger t
          where t.tgrelid = 'public.notifications'::regclass and t.tgname = 'notifications_department_filter' and not t.tgisinternal),
  'notifications has the department filter trigger'
);
select is(
  (select array_agg(module_code order by module_code)::text from private.department_notification_modules where department_code = 'ID'),
  '{IT_REPAIR,MT_REPAIR}',
  'department ID is allowed exactly MT_REPAIR and IT_REPAIR'
);

-- ข้อมูลทดสอบ: S = พนักงานแผนก ID, A = admin แผนก ID, O = พนักงานแผนก MT ---------------------------
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active) values
  ('93100000-0000-0000-0000-000000000001', 'DNF-S', 'ไอดี', 'พนักงาน', 'dnf-s@mnp.local', 'พนักงาน',
   (select id from public.departments where code = 'ID'), '20000000-0000-0000-0000-000000000001', true),
  ('93100000-0000-0000-0000-000000000002', 'DNF-A', 'ไอดี', 'แอดมิน', 'dnf-a@mnp.local', 'ผู้ดูแลระบบ',
   (select id from public.departments where code = 'ID'), '20000000-0000-0000-0000-000000000004', true),
  ('93100000-0000-0000-0000-000000000003', 'DNF-O', 'เอ็มที', 'พนักงาน', 'dnf-o@mnp.local', 'พนักงาน',
   '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', true);

insert into public.requests (id, request_no, request_type_id, requester_id, department_id, title, description)
select x.id::uuid, x.no, t.id, '93100000-0000-0000-0000-000000000001', (select id from public.departments where code = 'ID'),
       x.no, 'ข้อมูลจำลอง'
from (values
  ('93100000-0000-0000-0000-000000000011', 'DNF-MT', 'MT_REPAIR'),
  ('93100000-0000-0000-0000-000000000012', 'DNF-IT', 'IT_REPAIR'),
  ('93100000-0000-0000-0000-000000000013', 'DNF-MG', 'MANAGEMENT')
) x(id, no, code)
join public.request_types t on t.code = x.code;

select is(
  (select count(*)::integer from public.requests where id::text like '93100000-%'),
  3,
  'fixture: one MT_REPAIR, one IT_REPAIR and one MANAGEMENT request exist'
);

-- แถวแจ้งเตือน (สร้างแบบที่ RPC สร้าง: สถานะอีเมล/push เป็นค่าเริ่มต้น pending)
insert into public.notifications (id, recipient_id, request_id, title, body, action_url, kind, digest) values
  -- allow
  ('93100000-0000-0000-0000-0000000000a1', '93100000-0000-0000-0000-000000000001', '93100000-0000-0000-0000-000000000011', 'mt', 'b', '/requests/93100000-0000-0000-0000-000000000011', 'event', null),
  ('93100000-0000-0000-0000-0000000000a2', '93100000-0000-0000-0000-000000000001', '93100000-0000-0000-0000-000000000012', 'it', 'b', '/requests/93100000-0000-0000-0000-000000000012', 'event', null),
  ('93100000-0000-0000-0000-0000000000a3', '93100000-0000-0000-0000-000000000001', null, 'profile', 'b', '/profile', 'event', null),
  ('93100000-0000-0000-0000-0000000000a4', '93100000-0000-0000-0000-000000000001', null, 'digest ok', 'b', '/', 'reminder',
   '[{"item_type":"request","item_id":"93100000-0000-0000-0000-000000000011"},{"item_type":"request","item_id":"93100000-0000-0000-0000-000000000012"}]'),
  ('93100000-0000-0000-0000-0000000000a5', '93100000-0000-0000-0000-000000000002', '93100000-0000-0000-0000-000000000011', 'admin mt', 'b', '/requests/93100000-0000-0000-0000-000000000011', 'event', null),
  -- deny
  ('93100000-0000-0000-0000-0000000000d1', '93100000-0000-0000-0000-000000000001', '93100000-0000-0000-0000-000000000013', 'mg', 'b', '/requests/93100000-0000-0000-0000-000000000013', 'event', null),
  ('93100000-0000-0000-0000-0000000000d2', '93100000-0000-0000-0000-000000000002', '93100000-0000-0000-0000-000000000013', 'admin mg', 'b', '/requests/93100000-0000-0000-0000-000000000013', 'event', null),
  ('93100000-0000-0000-0000-0000000000d3', '93100000-0000-0000-0000-000000000001', null, 'ncr', 'b', '/ncr/93100000-0000-0000-0000-000000000099', 'event', null),
  ('93100000-0000-0000-0000-0000000000d4', '93100000-0000-0000-0000-000000000002', null, 'admin', 'b', '/admin', 'event', null),
  ('93100000-0000-0000-0000-0000000000d5', '93100000-0000-0000-0000-000000000001', null, 'no link', 'b', null, 'event', null),
  ('93100000-0000-0000-0000-0000000000d6', '93100000-0000-0000-0000-000000000001', null, 'digest ncr', 'b', '/', 'reminder',
   '[{"item_type":"request","item_id":"93100000-0000-0000-0000-000000000011"},{"item_type":"ncr","item_id":"93100000-0000-0000-0000-000000000099"}]'),
  ('93100000-0000-0000-0000-0000000000d7', '93100000-0000-0000-0000-000000000001', null, 'digest mg', 'b', '/', 'escalation',
   '[{"item_type":"request","item_id":"93100000-0000-0000-0000-000000000012"},{"item_type":"request","item_id":"93100000-0000-0000-0000-000000000013"}]'),
  ('93100000-0000-0000-0000-0000000000d8', '93100000-0000-0000-0000-000000000001', null, 'digest empty', 'b', '/', 'reminder', '[]'),
  ('93100000-0000-0000-0000-0000000000d9', '93100000-0000-0000-0000-000000000001', null, 'digest malformed', 'b', '/', 'reminder',
   '[{"item_type":"request","item_id":"not-a-uuid"},"x"]'),
  -- แผนกอื่น: ไม่จำกัด
  ('93100000-0000-0000-0000-0000000000c1', '93100000-0000-0000-0000-000000000003', '93100000-0000-0000-0000-000000000013', 'other mg', 'b', '/requests/93100000-0000-0000-0000-000000000013', 'event', null),
  ('93100000-0000-0000-0000-0000000000c2', '93100000-0000-0000-0000-000000000003', null, 'other ncr', 'b', '/ncr/93100000-0000-0000-0000-000000000099', 'event', null);

-- 2. allow: ยังเข้าคิวอีเมลและ push ตามปกติ --------------------------------------------------------
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a1'),
  'pending/pending', 'ID staff: an MT_REPAIR notification stays queued for email and push'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a2'),
  'pending/pending', 'ID staff: an IT_REPAIR notification stays queued for email and push'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a3'),
  'pending/pending', 'ID staff: a /profile notice (account setup link) stays queued'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a4'),
  'pending/pending', 'ID staff: a digest whose items are all MT/IT requests stays queued'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a5'),
  'pending/pending', 'ID admin: an MT_REPAIR notification stays queued'
);

-- 3. deny: ถูกข้ามทั้งอีเมลและ push ด้วยเหตุผล DEPARTMENT_FILTERED ------------------------------------
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d1'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: a management request notification is not emailed or pushed'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d2'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID admin: a management request notification is not emailed or pushed (admins included)'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d3'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: an NCR notification is not emailed or pushed'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d4'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID admin: an /admin notification is not emailed or pushed'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d5'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: a notification without a link is not emailed or pushed'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d6'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: a digest that mixes an NCR item is skipped entirely'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d7'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: an escalation digest that mixes a management request is skipped entirely'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d8'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: an empty digest is skipped'
);
select is(
  (select concat_ws('/', email_status, email_error, push_status, push_error) from public.notifications where id = '93100000-0000-0000-0000-0000000000d9'),
  'skipped/DEPARTMENT_FILTERED/skipped/DEPARTMENT_FILTERED', 'ID staff: a malformed digest is skipped without failing the insert'
);
select is(
  (select count(*)::integer from public.notifications
   where id::text like '93100000-0000-0000-0000-0000000000d%' and read_at is null),
  9, 'skipped notifications are still stored in the app (unread)'
);

-- แผนกอื่นไม่เปลี่ยน
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000c1'),
  'pending/pending', 'another department: a management request notification is still queued'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000c2'),
  'pending/pending', 'another department: an NCR notification is still queued'
);

-- ตั้งกลับเป็น pending (เช่นสั่งส่งใหม่) ไม่ได้สำหรับแถวที่ไม่อนุญาต
update public.notifications set email_status = 'pending', email_error = null, push_status = 'pending', push_error = null
where id = '93100000-0000-0000-0000-0000000000d1';
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000d1'),
  'skipped/skipped', 'setting a filtered row back to pending is turned back to skipped'
);

-- แถวที่อนุญาต: ปิดผลและลองใหม่ตามปกติ (notify-email/notify-push อัปเดตสถานะได้)
update public.notifications set email_status = 'sent', email_error = null where id = '93100000-0000-0000-0000-0000000000a1';
update public.notifications set push_status = 'pending', push_error = 'HTTP_503' where id = '93100000-0000-0000-0000-0000000000a1';
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000a1'),
  'sent/pending', 'allowed rows settle and retry normally'
);

-- สถานะที่ไม่ใช่ pending ไม่ถูกแตะ
insert into public.notifications (id, recipient_id, request_id, title, body, action_url, email_status, push_status)
values ('93100000-0000-0000-0000-0000000000da', '93100000-0000-0000-0000-000000000001', '93100000-0000-0000-0000-000000000013',
        'mg sent', 'b', '/requests/93100000-0000-0000-0000-000000000013', 'sent', 'failed');
select is(
  (select email_status || '/' || push_status || '/' || coalesce(email_error, '-') from public.notifications where id = '93100000-0000-0000-0000-0000000000da'),
  'sent/failed/-', 'statuses other than pending are left unchanged'
);

-- คิวอีเมลที่ notify-email อ่าน (email_status = pending) ไม่มีแถวที่ถูกข้าม
select is(
  (select array_agg(right(id::text, 2) order by id)::text from public.notifications
   where id::text like '93100000-%' and email_status = 'pending'),
  '{a2,a3,a4,a5,c1,c2}',
  'the email queue holds only the allowed rows'
);

-- คิว push: app_claim_push_notifications จองเฉพาะแถวที่อนุญาต (แถวอื่นนอกชุดทดสอบถูกปิดก่อน)
update public.notifications set push_status = 'skipped' where id::text not like '93100000-%' and push_status = 'pending';
set local role service_role;
select is(
  (select array_agg(right(c.id::text, 2) order by c.id)::text from public.app_claim_push_notifications(100) c),
  '{a1,a2,a3,a4,a5,c1,c2}',
  'the push claim returns only the allowed rows'
);
reset role;

-- 4. ตัดสินจากแผนก ณ เวลาที่สร้างแถว: ย้ายออกจากแผนก ID แล้วได้รับตามปกติ ------------------------------
update public.employees set department_id = '10000000-0000-0000-0000-000000000002' where id = '93100000-0000-0000-0000-000000000001';
insert into public.notifications (id, recipient_id, request_id, title, body, action_url)
values ('93100000-0000-0000-0000-0000000000c3', '93100000-0000-0000-0000-000000000001', null, 'moved ncr', 'b', '/ncr/93100000-0000-0000-0000-000000000099');
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000c3'),
  'pending/pending', 'an employee moved out of department ID gets other modules again'
);
select is(
  (select email_status || '/' || push_status from public.notifications where id = '93100000-0000-0000-0000-0000000000d3'),
  'skipped/skipped', 'rows created while the employee was in department ID stay skipped'
);
select ok(
  private.department_notification_allowed('93100000-0000-0000-0000-0000000000ff', null, '/admin', null),
  'an unknown recipient is not restricted by the department rule'
);

select * from finish();
rollback;
