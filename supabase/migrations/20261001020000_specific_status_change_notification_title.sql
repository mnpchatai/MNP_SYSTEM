-- แจ้งเตือนเปลี่ยนสถานะคำร้อง: เดิมทุกสถานะใช้ชื่อเดียวกันว่า "สถานะคำร้องมีการเปลี่ยนแปลง"
-- และ body เป็นรหัสอังกฤษ ("QA011/26 เปลี่ยนเป็น more_info") ผู้รับต้องเปิดอ่านเองว่าเกิดอะไรขึ้น
--
-- ใหม่: ชื่อแจ้งเตือนบอกชื่อเอกสาร + ผลลัพธ์ตรงๆ เช่น "ใบคำร้อง/แจ้งซ่อม MT ขอข้อมูลเพิ่มเติม"
-- และ body ใช้คำไทยชุดเดียวกับ statusLabels ใน app.js (เช่น "QA011/26 เปลี่ยนเป็น ขอข้อมูลเพิ่ม")
-- คำร้องเร่งด่วนได้คำนำหน้า "🚨 [ด่วน] " ผ่าน private.notify_title เหมือนแจ้งเตือนอื่น
--
-- ข้อความหัวข้อต้องตรงกับ statusChangePresentations ใน supabase/functions/notify-email/index.ts
-- (อีเมลใช้ตารางนั้นเติมอีโมจิ สี และกล่อง "สิ่งที่ต้องทำต่อ") แก้ที่หนึ่งต้องแก้อีกที่ด้วย
--
-- เปลี่ยนเฉพาะข้อความ ไม่เปลี่ยนผู้รับ/เงื่อนไขการแจ้ง/ประวัติสถานะ แถวแจ้งเตือนเก่าคงไว้ตามเดิม
-- (notify-email ยังรองรับชื่อเดิม) ย้อนกลับได้โดย create or replace ด้วยนิยามเดิมใน
-- 20260916070554_phase_one.sql

create or replace function private.status_change_notification_title(p_request_id uuid, p_status public.request_status)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select private.notify_title(
    p_request_id,
    d.doc || case p_status
      when 'pending_approval' then ' ส่งถึงผู้อนุมัติแล้ว'
      when 'approved' then ' อนุมัติแล้ว'
      when 'more_info' then ' ขอข้อมูลเพิ่มเติม'
      when 'rejected' then ' ไม่อนุมัติ'
      when 'acknowledged' then ' ฝ่ายบริหารรับทราบข้อมูลแล้ว'
      when 'pending_assign' then ' อนุมัติแล้ว รอมอบหมายช่าง'
      when 'assigned' then ' มอบหมายผู้รับผิดชอบแล้ว'
      when 'in_progress' then ' อยู่ระหว่างดำเนินการ'
      when 'pending_verify' then ' ดำเนินการเสร็จแล้ว รอคุณตรวจรับ'
      when 'completed' then ' เสร็จสิ้นแล้ว'
      when 'cancelled' then ' ถูกยกเลิก'
      else ' มีการเปลี่ยนแปลงสถานะ'
    end
  )
  from (
    select coalesce(nullif(btrim(t.name_th), ''), 'คำร้อง') as doc
    from (select 1) one
    left join public.requests r on r.id = p_request_id
    left join public.request_types t on t.id = r.request_type_id
  ) d
$$;

-- คำแปลชุดเดียวกับ statusLabels ใน app.js และ notify-email
create or replace function private.request_status_label(p_status public.request_status)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'draft' then 'ฉบับร่าง'
    when 'pending_approval' then 'รออนุมัติ'
    when 'approved' then 'อนุมัติแล้ว'
    when 'in_progress' then 'กำลังดำเนินการ'
    when 'more_info' then 'ขอข้อมูลเพิ่ม'
    when 'completed' then 'เสร็จแล้ว'
    when 'rejected' then 'ไม่อนุมัติ'
    when 'cancelled' then 'ยกเลิก'
    when 'pending_assign' then 'รอมอบหมายช่าง'
    when 'assigned' then 'รอดำเนินการ'
    when 'pending_verify' then 'รอผู้แจ้งตรวจสอบ'
    when 'acknowledged' then 'รับทราบข้อมูล'
    else p_status::text
  end
$$;

create or replace function private.log_request_status_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.request_status_history(request_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, coalesce(new.last_changed_by, private.current_employee_id()));

    insert into public.notifications(recipient_id, request_id, title, body, action_url)
    values (
      new.requester_id,
      new.id,
      private.status_change_notification_title(new.id, new.status),
      new.request_no || ' เปลี่ยนเป็น ' || private.request_status_label(new.status),
      '/requests/' || new.id::text
    );
  end if;
  return new;
end;
$$;

revoke all on function private.status_change_notification_title(uuid, public.request_status) from public, anon, authenticated;
revoke all on function private.request_status_label(public.request_status) from public, anon, authenticated;
revoke all on function private.log_request_status_change() from public, anon, authenticated;
