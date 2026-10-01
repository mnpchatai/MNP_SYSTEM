-- แจ้งเตือนเปลี่ยนสถานะคำร้อง: ชื่อเรื่องบอกชื่อเอกสาร + ผลลัพธ์ และ body เป็นคำไทย
-- (migration 20261001020000_specific_status_change_notification_title.sql)
begin;

create extension if not exists pgtap with schema extensions;
select plan(11);

-- ฟังก์ชันช่วยอยู่ใน private และผู้ใช้ทั่วไปเรียกตรงไม่ได้
select ok(
  not has_function_privilege('authenticated', 'private.status_change_notification_title(uuid, public.request_status)', 'execute')
  and not has_function_privilege('anon', 'private.status_change_notification_title(uuid, public.request_status)', 'execute'),
  'status_change_notification_title is not executable by anon/authenticated'
);
select ok(
  not has_function_privilege('authenticated', 'private.request_status_label(public.request_status)', 'execute')
  and not has_function_privilege('anon', 'private.request_status_label(public.request_status)', 'execute'),
  'request_status_label is not executable by anon/authenticated'
);

-- คำร้องตัวอย่างจาก seed (สถานะ pending_approval)
create temp table target as
  select r.id, r.request_no, r.requester_id, t.name_th
  from public.requests r join public.request_types t on t.id = r.request_type_id
  where r.id = '60000000-0000-0000-0000-000000000002';

-- now() คงที่ทั้งทรานแซกชัน เรียงตาม created_at ไม่ได้ จึงล้างแจ้งเตือนของใบนี้ก่อนแต่ละขั้น ให้เหลือแถวเดียว
delete from public.notifications where request_id = (select id from target);
update public.requests set status = 'more_info' where id = (select id from target);

select is(
  (select title from public.notifications where request_id = (select id from target)),
  (select name_th || ' ขอข้อมูลเพิ่มเติม' from target),
  'more_info title names the document and the result'
);
select is(
  (select body from public.notifications where request_id = (select id from target)),
  (select request_no || ' เปลี่ยนเป็น ขอข้อมูลเพิ่ม' from target),
  'body uses the Thai status label, not the enum code'
);
select is(
  (select recipient_id from public.notifications where request_id = (select id from target)),
  (select requester_id from target),
  'recipient is still the requester'
);
select is(
  (select count(*) from public.notifications
   where request_id = (select id from target) and title = 'สถานะคำร้องมีการเปลี่ยนแปลง'),
  0::bigint,
  'the generic title is no longer written'
);

-- ไม่มีการเปลี่ยนสถานะ → ไม่มีแจ้งเตือนใหม่
create temp table before_count as
  select count(*) as n from public.notifications where request_id = (select id from target);
update public.requests set title = 'ขอสิทธิ์ระบบรายงาน BI (แก้ไข)' where id = (select id from target);
select is(
  (select count(*) from public.notifications where request_id = (select id from target)),
  (select n from before_count),
  'no notification when the status does not change'
);

delete from public.notifications where request_id = (select id from target);
update public.requests set status = 'approved' where id = (select id from target);
select is(
  (select title from public.notifications where request_id = (select id from target)),
  (select name_th || ' อนุมัติแล้ว' from target),
  'approved title'
);

-- คำร้องเร่งด่วนได้คำนำหน้าเดียวกับแจ้งเตือนอื่น
update public.requests set is_urgent = true where id = (select id from target);
delete from public.notifications where request_id = (select id from target);
update public.requests set status = 'rejected' where id = (select id from target);
select is(
  (select title from public.notifications where request_id = (select id from target)),
  (select '🚨 [ด่วน] ' || name_th || ' ไม่อนุมัติ' from target),
  'urgent requests keep the urgent prefix'
);

select is(
  private.status_change_notification_title('00000000-0000-0000-0000-000000000000', 'approved'),
  'คำร้อง อนุมัติแล้ว',
  'falls back to คำร้อง when the request type is unknown'
);

-- ผู้ใช้ทั่วไปยังสร้างแจ้งเตือนเองไม่ได้
set local role authenticated;
select throws_ok(
  $$ insert into public.notifications (recipient_id, title, body) values ('50000000-0000-0000-0000-000000000003', 'x', 'y') $$,
  '42501',
  null,
  'authenticated users cannot insert notifications directly'
);
reset role;

select * from finish();
rollback;
