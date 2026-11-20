-- ใบสั่งงาน IT: แจ้งเตือน (กระดิ่ง + อีเมล + Web Push) · เจ้าของตัดสิน 20/11/2026
--
-- ใครอ่านต่อ: ทุกข้อความแจ้งเตือนเป็น 1 แถวใน public.notifications (คิวเดียวกับระบบคำร้อง kind = 'event') ต่อผู้รับ 1 คน
--   คิวเดิมส่งอีเมล (notify-email) และ Web Push (notify-push) จากแถวนี้ให้เอง ตัวกรองแผนก (private.notifications_department_filter)
--   ยังทำงานตามเดิม (แผนก ID ได้เฉพาะกระดิ่ง ไม่ได้อีเมล/push ของโมดูลนี้)
--
-- วิธีทำ: trigger AFTER INSERT บน public.itwo_events (ไม่ replace RPC ใดของ itwo เลย)
--   - ทุกการกระทำของใบสั่งงานเขียน itwo_events ในธุรกรรมเดียวกับการเปลี่ยนสถานะอยู่แล้ว (แหล่งความจริงของ ISO) trigger จึงเห็นเหตุการณ์ครบ
--     และแจ้งเตือนเกิด/ไม่เกิดพร้อมกับการกระทำนั้น (ถ้าการกระทำถูกย้อน แจ้งเตือนก็ย้อนด้วย)
--   - ไม่ต้องคัดลอกนิยามล่าสุดของ app_itwo_* / private.itwo_decide มาแก้ (ลดความเสี่ยงทับงานของคนอื่น + ไม่ต้องเทียบ md5 ก่อน apply)
--     migration นี้ "ไม่ replace ฟังก์ชันเดิมตัวใดเลย" มีแต่ของใหม่ + trigger ใหม่ 1 ตัว
--   - จุดที่ต้องระวัง: บาง RPC เขียน event ก่อนอัปเดตสถานะ (เช่น itwo_decide) trigger จึงไม่ตัดสินจาก status แต่ใช้ "event ที่มีอยู่" (itwo_event_state)
--     เป็นหลัก ยกเว้น created ที่ใบเพิ่งสร้างและ status = ปลายทางแรกของใบ
--   - ถ้าสร้างแจ้งเตือนล้มเหลว (เช่นแถวผู้รับมีปัญหา) ไม่ทำให้การอนุมัติ/ส่งงานล้มตาม: ครอบด้วย exception block แล้ว raise warning
--     (แจ้งเตือนเป็นเรื่องรอง ห้ามขวางบันทึก ISO) · ล้มรายคน (office_notify) ไม่ทำให้คนอื่นในเหตุการณ์เดียวกันอด
--
-- ตารางแจ้งเตือน (kind = 'event' ทุกข้อ · ไม่ส่งถึงคนที่กดเอง · ไม่ซ้ำผู้รับเดียวกันในเหตุการณ์เดียว):
--   งานด่วน (is_urgent): ทุกข้อความของใบด่วนขึ้นหัวด้วย "🚨 [ด่วน] " (รูปแบบเดียวกับ private.notify_title ของระบบคำร้อง และ URGENT_PREFIX ของ notify-email
--        ซึ่งเห็นคำนำหน้าในหัวข้อความแล้วตัดออกเองก่อนใส่ซ้ำที่หัวอีเมล จึงขึ้นครั้งเดียว · notify-email ไม่เติมคำนำหน้าให้แถวที่ไม่มี request_id)
--        และตอนแจ้งงานด่วนแจ้ง "ผู้ดูแลงาน IT ทุกคน" ทันทีด้วย (นอกจากผู้อนุมัติ) เพราะ IT เริ่มทำได้ก่อนอนุมัติครบ
--   created (ไปรอขั้นแผนก)             -> ผู้อนุมัติขั้นแผนกทุกคนของแผนกผู้แจ้ง (ไม่รวมผู้แจ้ง)       "รอคุณอนุมัติ"
--   created (ไปรอขั้น IT ทันที)         -> ผู้อนุมัติขั้น IT (itwo_staff.is_it_approver)                 "รอคุณอนุมัติ"
--        (แผนกไม่มีผจก. / แผนก IT / ผจก.แจ้งเอง) · ผู้อนุมัติขั้น IT แจ้งเอง (อนุมัติครบทันที) ไม่แจ้งตอน created แต่แจ้งตอน it_mgr_approved
--   dept_approved                      -> ผู้อนุมัติขั้น IT                                          "รอคุณอนุมัติ"
--        ข้ามเมื่อ: ผู้กดคือผู้แจ้งเอง (ผจก.แจ้งเอง = อนุมัติในตัว ใบ created แจ้ง IT ไปแล้ว) หรือผู้กดเป็นผู้อนุมัติขั้น IT
--        (กดครั้งเดียวนับสองขั้น itwo_decide เขียน dept_approved ตามด้วย it_mgr_approved เสมอ จึงแจ้งตอน it_mgr_approved ครั้งเดียว)
--   it_mgr_approved (= อนุมัติครบ)      -> ผู้แจ้ง "อนุมัติครบแล้ว" + ผู้ดูแลงาน IT (itwo_staff.is_it_admin) ทุกคน "อนุมัติครบ พร้อมให้ IT รับงาน"
--        ถ้าใบนั้น IT เริ่มงานไปแล้ว (งานด่วนที่ทำก่อนอนุมัติครบ): ผู้ดูแลงาน IT ได้ "อนุมัติครบแล้ว ส่งงานได้" และผู้แจ้งได้ "IT กำลังดำเนินการ"
--        (ไม่พูดว่ารอ IT ดำเนินการ/รับงาน เพราะเริ่มไปแล้ว)
--   dept_rejected / it_mgr_rejected    -> ผู้แจ้ง "ไม่ได้รับอนุมัติ" พร้อมเหตุผลย่อ
--   info_requested (ถามผู้แจ้ง)          -> ผู้แจ้ง · info_provided (ผู้แจ้งตอบ) -> คนที่ถามคำถามที่ถูกตอบ
--   completed (IT ส่งงาน)               -> ผู้แจ้ง
--   rework_requested (ขอแก้ไขงาน)       -> ผู้ดูแลงาน IT ทุกคน
--   cancelled                          -> ผู้ยกเลิกเอง: ผู้อนุมัติของขั้นที่ใบรออยู่ + ผู้ดูแลงาน IT ถ้าอนุมัติครบแล้วหรือ IT เริ่มงานแล้ว
--                                         IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้ง
--   ไม่แจ้ง: started (IT เริ่มงาน รวมงานด่วนที่เริ่มก่อนอนุมัติ), received (ผู้แจ้งรับงาน)
--
-- ผู้รับต้อง: active, ไม่ถูกลบ, ไม่ใช่บัญชีทดสอบ, ผูกบัญชีล็อกอินแล้ว (auth_user_id), ไม่ใช่บัญชี lab-only (private.office_notify ตรวจ)
-- ใบทดสอบ (is_test) "ไม่ insert เลย": ตาราง notifications ติด sandbox_guard (SANDBOX_MODULE_UNSUPPORTED) ถ้าเขียนขณะ admin อยู่ในโหมดทดสอบ
--   guard จะ raise exception แต่ insert ใน office_notify ครอบด้วย exception block จึงถูกจับไว้เป็น warning (การกระทำของใบไม่ล้ม แต่ไม่มีแถวแจ้งเตือน
--   และมี warning ใน Postgres log ทุกครั้ง) · เลยตรวจก่อนเขียนสองชั้น: trigger ข้าม is_test + office_notify ข้ามเมื่อ session อยู่ในโหมดทดสอบ
--
-- ปลายทางเมื่อกด: action_url = '/office/work-order/<uuid ใบ>' (รูปแบบใหม่ ไม่ชนของเดิม) แล้ว 3 จุดฝั่งโค้ดแปลงเป็น
--   #/office?module=work-order&view=order&id=<uuid> : app.js notificationHref, supabase/functions/notify-email linkFor,
--   supabase/functions/notify-push/payload.ts pushUrlFor (ต้อง deploy notify-email และ notify-push ใหม่หลัง merge)
--
-- helper กลางของระบบสำนักงาน (โมดูลสำนักงานอื่นในอนาคตใช้ซ้ำได้): private.office_notify / office_clip / office_format_date
--
-- RLS/grant: ไม่มีตารางใหม่ · ฟังก์ชันทั้งหมดอยู่ schema private เป็น SECURITY DEFINER search_path ว่าง ถอนสิทธิ์ public/anon/authenticated
--   (trigger ไม่ต้องใช้สิทธิ์ execute ของผู้เรียก) · การอ่านแจ้งเตือนใช้ policy เดิมของ notifications (ผู้รับอ่านของตัวเองเท่านั้น)
--
-- ย้อน (แจ้งเตือนที่สร้างไปแล้วคงอยู่ในกระดิ่ง ไม่ลบ):
--   drop trigger if exists itwo_events_notify on public.itwo_events;
--   drop function if exists private.itwo_notify_on_event();
--   drop function if exists private.itwo_notify_each(uuid[], uuid[], uuid, text, text, text);
--   drop function if exists private.itwo_notify_stage_approver_ids(public.itwo_work_orders);
--   drop function if exists private.itwo_notify_dept_approver_ids(public.itwo_work_orders);
--   drop function if exists private.itwo_notify_it_approver_ids();
--   drop function if exists private.itwo_notify_it_admin_ids();
--   drop function if exists private.itwo_request_type_text(text, text);
--   drop function if exists private.office_notify(uuid, text, text, text, uuid);
--   drop function if exists private.office_format_date(date);
--   drop function if exists private.office_clip(text, integer);

-- 1. helper กลางของระบบสำนักงาน -----------------------------------------------------------------
-- ย่อข้อความผู้ใช้ให้เป็นบรรทัดเดียว (ยุบช่องว่าง/ขึ้นบรรทัดใหม่) ตัดที่ p_max ตัวอักษรแล้วต่อ "…"
create or replace function private.office_clip(p_text text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when char_length(t.s) > p_max then left(t.s, greatest(p_max - 1, 0)) || '…' else t.s end
  from (select btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g')) as s) t
$$;
revoke all on function private.office_clip(text, integer) from public, anon, authenticated;

-- วันที่ในข้อความแจ้งเตือน: วว/ดด/ปปปป แบบ พ.ศ. ตรงกับหน้าจอของโมดูล (YEAR_OFFSET ใน modules/itwo-model.js)
-- ถ้าเจ้าของเปลี่ยนเป็น ค.ศ. ให้ออก migration ใหม่ replace ฟังก์ชันนี้ โดยเอา "+ 543" ออก (ปีเป็น ค.ศ. ตรง ๆ) และแก้ test ที่เทียบ '20/11/2569'
-- stable (ไม่ใช่ immutable): ผูกกับกติกาปีของหน้าจอที่เปลี่ยนได้ ไม่ใช่ค่าคงที่ตลอดกาล
create or replace function private.office_format_date(p_date date)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(to_char(p_date, 'DD/MM/') || (extract(year from p_date)::integer + 543)::text, '—')
$$;
revoke all on function private.office_format_date(date) from public, anon, authenticated;

-- ส่งแจ้งเตือน 1 ข้อความถึง 1 คนผ่านคิวกลาง (public.notifications ได้ทั้งกระดิ่ง อีเมล และ Web Push) · คืน true เมื่อบันทึกแล้ว
-- ไม่ส่ง (คืน false เงียบ ๆ) เมื่อ: ไม่มีผู้รับ · ผู้รับคือคนที่กดเอง (p_exclude_id) · session อยู่ในโหมดทดสอบ
--   · ผู้รับไม่ active / ถูกลบ / เป็นบัญชีทดสอบ / ยังไม่ผูกบัญชีล็อกอิน / เป็นบัญชี lab-only
-- ครอบ insert ด้วย exception block: แถวเดียวมีปัญหาแล้วไม่ทำให้ธุรกรรมของผู้เรียก (เช่นการอนุมัติ) ล้ม
create or replace function private.office_notify(
  p_recipient_id uuid,
  p_title text,
  p_body text,
  p_action_url text,
  p_exclude_id uuid default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_recipient_id is null or p_recipient_id is not distinct from p_exclude_id then
    return false;
  end if;
  if nullif(btrim(coalesce(p_title, '')), '') is null then
    return false;
  end if;
  -- ตาราง notifications ติด sandbox_guard: เขียนขณะอยู่ในโหมดทดสอบจะ raise SANDBOX_MODULE_UNSUPPORTED (ด้านล่างจับไว้เป็น warning)
  -- ห้ามส่งอยู่แล้ว จึงตรวจก่อนเขียน เพื่อไม่ให้มี warning เกลื่อน log และไม่พึ่ง guard ชั้นเดียว
  if auth.uid() is not null and (private.sandbox_persona()).id is not null then
    return false;
  end if;
  if not exists (
    select 1
    from public.employees e
    where e.id = p_recipient_id
      and e.is_active
      and e.deleted_at is null
      and not e.is_test
      and e.auth_user_id is not null
      and upper(e.employee_no) <> all (private.lab_only_employee_nos())
  ) then
    return false;
  end if;

  begin
    insert into public.notifications (recipient_id, title, body, action_url)
    values (
      p_recipient_id,
      left(btrim(p_title), 200),
      left(btrim(coalesce(p_body, '')), 500),
      p_action_url
    );
  exception when others then
    raise warning 'office_notify: ส่งแจ้งเตือนถึง % ไม่สำเร็จ: % [%]', p_recipient_id, sqlerrm, sqlstate;
    return false;
  end;
  return true;
end;
$$;
revoke all on function private.office_notify(uuid, text, text, text, uuid) from public, anon, authenticated;

-- 2. ตัวช่วยเลือกผู้รับของใบสั่งงาน IT --------------------------------------------------------------
create or replace function private.itwo_notify_it_admin_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select s.employee_id from public.itwo_staff s where s.is_it_admin order by s.employee_id)
$$;
revoke all on function private.itwo_notify_it_admin_ids() from public, anon, authenticated;

create or replace function private.itwo_notify_it_approver_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select s.employee_id from public.itwo_staff s where s.is_it_approver order by s.employee_id)
$$;
revoke all on function private.itwo_notify_it_approver_ids() from public, anon, authenticated;

-- ผู้อนุมัติขั้นแผนกของแผนกผู้แจ้ง ไม่รวมผู้แจ้งเอง (ใช้รายการเดียวกับที่ใช้ตัดสินสิทธิ์อนุมัติ)
create or replace function private.itwo_notify_dept_approver_ids(p_wo public.itwo_work_orders)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select a.id
    from private.itwo_dept_approvers(p_wo.department_id, p_wo.is_test) a(id)
    where a.id <> p_wo.requester_id
    order by a.id)
$$;
revoke all on function private.itwo_notify_dept_approver_ids(public.itwo_work_orders) from public, anon, authenticated;

-- ผู้อนุมัติของ "ขั้นที่ใบรออยู่" ตัดสินจาก event ที่มีอยู่ (ไม่ใช่ status เพราะบาง RPC เขียน event ก่อนอัปเดตสถานะ)
--   อนุมัติครบสองขั้นแล้ว = ไม่มี · ขั้นแผนกยังไม่ผ่านและแผนกมีผู้อนุมัติ (ไม่นับผู้แจ้ง) = ผู้อนุมัติขั้นแผนก
--   นอกนั้น (ขั้นแผนกผ่านแล้ว / แผนก IT / แผนกไม่มีผจก.) = ผู้อนุมัติขั้น IT (เส้นทางเดียวกับ app_itwo_create)
create or replace function private.itwo_notify_stage_approver_ids(p_wo public.itwo_work_orders)
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dept_done boolean;
  v_it_done boolean;
  v_dept_ids uuid[];
begin
  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itwo_event_state(p_wo.id) s;
  if v_dept_done and v_it_done then
    return '{}';
  end if;
  if not v_dept_done and not private.itwo_is_it_department(p_wo.department_id) then
    v_dept_ids := private.itwo_notify_dept_approver_ids(p_wo);
    if cardinality(v_dept_ids) > 0 then
      return v_dept_ids;
    end if;
  end if;
  return private.itwo_notify_it_approver_ids();
end;
$$;
revoke all on function private.itwo_notify_stage_approver_ids(public.itwo_work_orders) from public, anon, authenticated;

-- ประเภทคำขอเป็นคำไทยสำหรับข้อความ (ตรงกับ requestTypeText ใน modules/itwo-model.js)
-- SECURITY DEFINER ทั้งที่เป็นฟังก์ชันล้วน: ชุดทดสอบ itwo เดิมบังคับให้ private.itwo_* ทุกตัวที่ไม่ใช่ trigger เป็น SECURITY DEFINER (ยกเว้นรายการที่ระบุไว้)
create or replace function private.itwo_request_type_text(p_request_type text, p_misc_detail text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_request_type
    when 'design' then 'งานออกแบบ'
    when 'misc' then concat_ws(' · ', 'เบ็ดเตล็ดอื่นๆ', nullif(private.office_clip(p_misc_detail, 40), ''))
    when 'system_access' then 'สิทธิ์การใช้งานในระบบคอมพิวเตอร์'
    else coalesce(p_request_type, '')
  end
$$;
revoke all on function private.itwo_request_type_text(text, text) from public, anon, authenticated;

-- ส่งข้อความเดียวกันให้ทุกคนในรายการ ไม่ซ้ำ ไม่ถึงผู้กด และข้ามคนที่เหตุการณ์นี้ส่งไปแล้ว (p_already)
-- คืนรายชื่อที่ "จัดการแล้ว" ทั้งหมด (รวม p_already) ให้ส่งต่อไปข้อความถัดไปของเหตุการณ์เดียวกัน (ผู้รับคนเดียวได้ข้อความเดียว)
create or replace function private.itwo_notify_each(
  p_recipients uuid[],
  p_already uuid[],
  p_actor_id uuid,
  p_title text,
  p_body text,
  p_action_url text
)
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_done uuid[] := coalesce(p_already, '{}');
  v_id uuid;
begin
  for v_id in
    select distinct r.id from unnest(coalesce(p_recipients, '{}')) r(id) where r.id is not null order by r.id
  loop
    if v_id = any (v_done) then
      continue;
    end if;
    perform private.office_notify(v_id, p_title, p_body, p_action_url, p_actor_id);
    v_done := v_done || v_id;
  end loop;
  return v_done;
end;
$$;
revoke all on function private.itwo_notify_each(uuid[], uuid[], uuid, text, text, text) from public, anon, authenticated;

-- 3. trigger: event ใหม่ของใบสั่งงาน IT -> แจ้งเตือน --------------------------------------------------
create or replace function private.itwo_notify_on_event()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_wo public.itwo_work_orders%rowtype;
  v_requester_name text;
  v_dept_name text;
  v_actor_name text;
  v_type_text text;
  v_summary text;
  v_title text;
  v_prefix text;
  v_started boolean;
  v_url text;
  v_done uuid[] := '{}';
  v_ids uuid[];
  v_dept_done boolean;
  v_it_done boolean;
  v_question public.itwo_comments%rowtype;
  v_answer public.itwo_comments%rowtype;
  v_rework public.itwo_reworks%rowtype;
begin
  -- ใบทดสอบ ไม่ insert เลย · started / received ไม่แจ้ง (เจ้าของตัดสิน)
  if new.is_test or new.action in ('started', 'received') then
    return new;
  end if;

  begin
    select * into v_wo from public.itwo_work_orders w where w.id = new.work_order_id;
    if v_wo.id is null or v_wo.is_test then
      return new;
    end if;

    select e.first_name || ' ' || e.last_name into v_requester_name from public.employees e where e.id = v_wo.requester_id;
    select e.first_name || ' ' || e.last_name into v_actor_name from public.employees e where e.id = new.actor_id;
    select d.name_th into v_dept_name from public.departments d where d.id = v_wo.department_id;
    v_type_text := private.itwo_request_type_text(v_wo.request_type, v_wo.misc_detail);
    -- "<ชื่อผู้แจ้ง> · <แผนก> · <ประเภท> · ต้องการ <วว/ดด/ปปปป>"
    v_summary := concat_ws(' · ', v_requester_name, v_dept_name, v_type_text,
                           'ต้องการ ' || private.office_format_date(v_wo.needed_date));
    -- ใบด่วนขึ้นหัวทุกข้อความด้วย "🚨 [ด่วน] " (ครั้งเดียว: notify-email เห็นแล้วตัดออกก่อนใส่ซ้ำที่หัวอีเมล)
    v_prefix := case when v_wo.is_urgent then '🚨 [ด่วน] ' else '' end;
    v_title := v_prefix || 'ใบสั่งงาน ' || v_wo.doc_no;
    v_url := '/office/work-order/' || v_wo.id::text;

    if new.action = 'created' then
      -- ปลายทางแรกของใบ: รอขั้นแผนก -> ผู้อนุมัติแผนก · รอขั้น IT ทันที -> ผู้อนุมัติขั้น IT · อนุมัติครบทันที -> ไม่แจ้งตอนนี้
      if v_wo.status = 'pending_dept' then
        v_ids := private.itwo_notify_dept_approver_ids(v_wo);
      elsif v_wo.status = 'pending_it_mgr' then
        v_ids := private.itwo_notify_it_approver_ids();
      else
        v_ids := '{}';
      end if;
      v_done := private.itwo_notify_each(v_ids, v_done, new.actor_id, v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      -- งานด่วน: IT เริ่มทำได้ก่อนอนุมัติครบ จึงแจ้งผู้ดูแลงาน IT ทุกคนทันที (ผู้ดูแลที่เป็นผู้อนุมัติด้วยได้ข้อความรออนุมัติด้านบนแล้ว ไม่ซ้ำ)
      -- ใบที่อนุมัติครบตั้งแต่แจ้ง (ผู้อนุมัติขั้น IT แจ้งเอง) ไม่แจ้งตรงนี้ เพราะ it_mgr_approved ในธุรกรรมเดียวกันแจ้งผู้ดูแลงานอยู่แล้ว
      if v_wo.is_urgent and v_wo.status in ('pending_dept', 'pending_it_mgr') then
        v_done := private.itwo_notify_each(private.itwo_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' แจ้งงานด่วน เริ่มทำได้ก่อนอนุมัติครบ', v_summary, v_url);
      end if;

    elsif new.action = 'dept_approved' then
      -- ข้ามเมื่ออนุมัติในตัว (ผู้แจ้งเอง) หรือผู้กดเป็นผู้อนุมัติขั้น IT (it_mgr_approved ตามมาในธุรกรรมเดียวกันเสมอ)
      if new.actor_id <> v_wo.requester_id and not private.itwo_is_it_approver(new.actor_id) then
        v_done := private.itwo_notify_each(private.itwo_notify_it_approver_ids(), v_done, new.actor_id,
                                           v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      end if;

    elsif new.action = 'it_mgr_approved' then
      -- อนุมัติครบ: ผู้แจ้งก่อน (ถ้าผู้แจ้งเป็นผู้ดูแลงาน IT ด้วยก็ได้ข้อความนี้ข้อความเดียว) แล้วผู้ดูแลงาน IT
      -- ใบที่ IT เริ่มงานไปแล้ว (งานด่วนที่ทำก่อนอนุมัติครบ) ข้อความต้องไม่บอกว่า "รอ IT ดำเนินการ/รับงาน"
      select exists (select 1 from public.itwo_events e where e.work_order_id = v_wo.id and e.action = 'started') into v_started;
      if v_started then
        v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'IT กำลังดำเนินการ · ' || v_type_text || ' · ต้องการ ' || private.office_format_date(v_wo.needed_date),
                                           v_url);
        v_done := private.itwo_notify_each(private.itwo_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว ส่งงานได้', v_summary, v_url);
      else
        v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'รอ IT ดำเนินการ · ' || v_type_text || ' · ต้องการ ' || private.office_format_date(v_wo.needed_date),
                                           v_url);
        v_done := private.itwo_notify_each(private.itwo_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบ พร้อมให้ IT รับงาน', v_summary, v_url);
      end if;

    elsif new.action in ('dept_rejected', 'it_mgr_rejected') then
      v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id,
                                         v_title || ' ไม่ได้รับอนุมัติ',
                                         concat_ws(' · ', 'เหตุผล: ' || private.office_clip(new.reason, 200), 'โดย ' || v_actor_name),
                                         v_url);

    elsif new.action = 'info_requested' then
      select * into v_question from public.itwo_comments c
      where c.work_order_id = v_wo.id and c.kind = 'question' order by c.id desc limit 1;
      v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id,
                                         v_title || ' มีคำถามถึงคุณ',
                                         v_actor_name || ': ' || private.office_clip(coalesce(v_question.body, new.reason), 200),
                                         v_url);

    elsif new.action = 'info_provided' then
      -- แจ้งคนที่ถามคำถามข้อที่ผู้แจ้งเพิ่งตอบ (คำตอบล่าสุดของใบ -> คำถามที่มันตอบ -> ผู้ถาม)
      select * into v_answer from public.itwo_comments a
      where a.work_order_id = v_wo.id and a.kind = 'answer' order by a.id desc limit 1;
      select * into v_question from public.itwo_comments q
      where q.id = v_answer.reply_to and q.work_order_id = v_wo.id;
      if v_question.id is not null then
        v_done := private.itwo_notify_each(array[v_question.author_id], v_done, new.actor_id,
                                           v_title || ' ผู้แจ้งตอบคำถามแล้ว',
                                           v_actor_name || ': ' || private.office_clip(v_answer.body, 200),
                                           v_url);
      end if;

    elsif new.action = 'completed' then
      v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id,
                                         v_prefix || 'IT ส่งงานใบสั่งงาน ' || v_wo.doc_no || ' แล้ว กรุณาตรวจรับ',
                                         'กดรับงาน หรือขอแก้ไขงานได้ที่หน้าใบสั่งงาน · ' || v_type_text,
                                         v_url);

    elsif new.action = 'rework_requested' then
      select * into v_rework from public.itwo_reworks r
      where r.work_order_id = v_wo.id order by r.round_no desc limit 1;
      v_done := private.itwo_notify_each(private.itwo_notify_it_admin_ids(), v_done, new.actor_id,
                                         v_title || ' ผู้แจ้งขอแก้ไขงาน',
                                         concat_ws(' · ', v_requester_name,
                                                   case when v_rework.id is not null then 'รอบที่ ' || v_rework.round_no end,
                                                   case when v_rework.id is not null then 'ต้องการ ' || private.office_format_date(v_rework.due_date) end,
                                                   private.office_clip(v_rework.details, 150)),
                                         v_url);

    elsif new.action = 'cancelled' then
      if new.actor_id = v_wo.requester_id then
        -- ผู้แจ้งยกเลิกเอง: ผู้อนุมัติของขั้นที่ใบรออยู่ · ผู้ดูแลงาน IT เมื่ออนุมัติครบแล้วหรือ IT เริ่มงานแล้ว
        v_ids := private.itwo_notify_stage_approver_ids(v_wo);
        select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itwo_event_state(v_wo.id) s;
        if (v_dept_done and v_it_done)
           or exists (select 1 from public.itwo_events e where e.work_order_id = v_wo.id and e.action = 'started') then
          v_ids := v_ids || private.itwo_notify_it_admin_ids();
        end if;
        v_done := private.itwo_notify_each(v_ids, v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', 'ผู้แจ้งยกเลิก', private.office_clip(new.reason, 200), v_summary),
                                           v_url);
      else
        -- IT ยกเลิกแทนผู้แจ้ง (เหตุผลขึ้นต้นด้วย "IT ยกเลิกแทนผู้แจ้ง: " อยู่แล้ว): แจ้งผู้แจ้ง
        v_done := private.itwo_notify_each(array[v_wo.requester_id], v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', v_actor_name, private.office_clip(new.reason, 200)),
                                           v_url);
      end if;
    end if;
  exception when others then
    -- แจ้งเตือนเป็นเรื่องรอง ห้ามทำให้การอนุมัติ/ส่งงาน (และบันทึก ISO) ล้มตาม
    raise warning 'itwo_notify: สร้างแจ้งเตือนของ event % (ใบ %) ไม่สำเร็จ: % [%]', new.id, new.work_order_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$$;
revoke all on function private.itwo_notify_on_event() from public, anon, authenticated;

create trigger itwo_events_notify
  after insert on public.itwo_events
  for each row execute function private.itwo_notify_on_event();
