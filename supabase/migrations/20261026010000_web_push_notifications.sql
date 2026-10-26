-- Web Push: ส่งแจ้งเตือนไปที่หน้าจอเครื่องของผู้ใช้ (มือถือ/คอมพิวเตอร์) ทุกแถวที่เข้าระฆังใน public.notifications
--
-- ภาพรวม
--   1) public.push_subscriptions เก็บ "เครื่อง" ที่ผู้ใช้กดเปิดแจ้งเตือนไว้ (endpoint + กุญแจเข้ารหัสของเบราว์เซอร์)
--      ตารางนี้ไม่เปิดให้ anon/authenticated อ่านหรือเขียนตรง — endpoint คือที่อยู่ที่ใครถือก็ส่งข้อความหาเครื่องนั้นได้
--      ผู้ใช้จัดการผ่าน RPC 3 ตัวที่ผูกกับพนักงาน active ของ auth.uid() เท่านั้น
--   2) notifications.push_status/push_attempts/push_attempted_at/push_error เป็นสถานะคิวส่ง push แยกจากคิวอีเมล
--      แถวที่มีอยู่แล้วก่อน migration นี้ถูกตั้งเป็น 'skipped' ทั้งหมด จะไม่มีการส่งย้อนหลังของเก่าออกไปพร้อมกัน
--   3) public.app_claim_push_notifications() ให้ Edge Function notify-push (service_role เท่านั้น) "จอง" แถวที่จะส่ง
--      ด้วย FOR UPDATE SKIP LOCKED + เวลาเช่า (push_attempted_at) กันสองรอบไล่คิวซ้อนกันแล้วส่งแถวเดียวกันซ้ำ
--      จำนวนครั้งที่ลองนับตอนจอง จึงไม่มีแถวใดวนลองไม่รู้จบแม้ฟังก์ชันล้มกลางทาง
--   4) pg_cron ทุกนาทีเรียก notify-push ผ่าน pg_net เฉพาะเมื่อมีแถว pending ที่จองได้ (โครงเดียวกับ
--      notification-email-drain ใน 20260930030000)
--
-- กติกาของคิว (บังคับที่ฐานข้อมูล ไม่ใช่ที่ client)
--   - แถวที่ผู้รับอ่านแล้ว หรือค้างเกิน 24 ชั่วโมง ถูกปิดเป็น skipped (ALREADY_READ / EXPIRED) ตอนจอง
--     push ที่มาถึงช้าข้ามวันไม่มีประโยชน์ และกันการยิงรวดเดียวเมื่อเปิดใช้ช่องทางนี้หลังจากคิวค้างมานาน
--   - ลองสูงสุด 3 ครั้ง (นับตอนจอง) ครบแล้วยังไม่สำเร็จ = failed; แถวที่ถูกจองแล้วฟังก์ชันล้มก่อนปิดผล
--     จะถูกจองซ้ำได้หลังหมดเวลาเช่า 10 นาที และถูกปิดเป็น failed (LEASE_EXPIRED) เมื่อใช้โควตาครบ
--     เวลาเช่าต้องยาวกว่าเวลาทำงานนานสุดของ Edge Function (เพดาน wall-clock ของ Supabase ราว 400 วินาที) เสมอ
--     ไม่งั้นรอบถัดไปจะจองแถวที่รอบเดิมยังส่งอยู่แล้วส่งซ้ำ — ถ้าเปลี่ยนค่านี้ ต้องแก้ทั้ง 3 จุดในไฟล์นี้
--     (app_claim_push_notifications 2 จุด และ drain_pending_push_notifications) ให้ตรงกัน
--
-- ต้องตั้งก่อนระบบทำงานจริง (ไม่มีค่าในไฟล์นี้)
--   Vault secret    notify_push_function_url         = https://<project-ref>.supabase.co/functions/v1/notify-push
--                   notify_push_service_role_key     = service role key ของโปรเจกต์ (ค่าเดียวกับ notify_email_service_role_key)
--   Edge Function secrets  VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… หรือ https://…)
--   ยังไม่ตั้ง Vault = cron ไม่เรียกอะไร (ขึ้น notice) / ยังไม่ตั้ง VAPID = ฟังก์ชันตอบ configured=false และไม่แตะคิว
--
-- Rollback (ไม่มีข้อมูลธุรกิจถูกแก้; subscription ที่ผู้ใช้ลงทะเบียนไว้จะหายไป ผู้ใช้กดเปิดใหม่ได้):
--   select cron.unschedule('notification-push-drain');
--   drop function private.drain_pending_push_notifications();
--   drop function private.dispatch_pending_push_notifications();
--   drop function public.app_claim_push_notifications(integer);
--   drop function public.app_save_push_subscription(text, text, text, text);
--   drop function public.app_delete_push_subscription(text);
--   drop function public.app_is_push_subscribed(text);
--   drop table public.push_subscriptions;
--   drop index public.notifications_push_pending_idx;
--   alter table public.notifications drop column push_status, drop column push_attempts,
--     drop column push_attempted_at, drop column push_error;
--   (แล้วลบ Vault secret notify_push_* และ Edge Function secrets VAPID_* ถ้าไม่ใช้อีก)

-- 1. สถานะคิว push บน notifications --------------------------------------------------------------
-- เพิ่มคอลัมน์ด้วย default 'skipped' ก่อน เพื่อให้ "แถวเดิมทุกแถว" เป็น skipped โดยไม่ต้องเขียนทับทั้งตาราง
-- แล้วค่อยเปลี่ยน default เป็น 'pending' สำหรับแถวใหม่ (แถวเดิมคงค่า skipped)
alter table public.notifications
  add column if not exists push_status text not null default 'skipped',
  add column if not exists push_attempts integer not null default 0,
  add column if not exists push_attempted_at timestamptz,
  add column if not exists push_error text;

alter table public.notifications alter column push_status set default 'pending';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_push_status_check') then
    alter table public.notifications
      add constraint notifications_push_status_check
      check (push_status in ('pending', 'sent', 'skipped', 'failed'));
  end if;
end $$;

create index if not exists notifications_push_pending_idx
  on public.notifications (created_at)
  where push_status = 'pending';

comment on column public.notifications.push_status is
  'สถานะส่ง Web Push แถวนี้: pending | sent | skipped | failed (ดู Edge Function notify-push); แถวก่อนเปิดช่องทางนี้เป็น skipped';
comment on column public.notifications.push_error is
  'รหัสเหตุผลสั้น ๆ ที่ push ไม่สำเร็จหรือถูกข้าม (เช่น NO_SUBSCRIPTION, HTTP_503) — ไม่เก็บ endpoint หรือเนื้อหา';

-- 2. เครื่องที่เปิดแจ้งเตือน -----------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  -- ใช้จัดอันดับ "เครื่องที่เก่าที่สุด" ตอนเกินโควตา: เครื่องที่เปิดแอปแล้วบันทึกซ้ำทุกครั้งจึงไม่ถูกตัดก่อนเครื่องที่ทิ้งร้าง
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0
);

create index if not exists push_subscriptions_employee_idx on public.push_subscriptions (employee_id);

alter table public.push_subscriptions enable row level security;
-- ไม่มี policy = ปิดทุกทางผ่าน Data API; service_role ข้าม RLS เอง
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, update, delete on public.push_subscriptions to service_role;
select private.lab_only_guard_table('public.push_subscriptions');
-- โหมดทดสอบของ admin (20261005030000): ระหว่างอยู่ในโหมดทดสอบห้ามเขียนตารางนี้ (บันทึก/ลบเครื่องที่รับแจ้งเตือนไม่ได้)
-- Edge Function ใช้ service_role (auth.uid() เป็น null) จึงลบ endpoint ที่หมดอายุได้ตามปกติ
select private.sandbox_guard_table('public.push_subscriptions');

-- 3. RPC ฝั่งผู้ใช้ ---------------------------------------------------------------------------------
-- บันทึก/ย้ายเครื่องนี้มาเป็นของผู้เรียก
--   - endpoint เดิมที่เคยเป็นของคนอื่น (เครื่องที่ใช้ร่วมกัน) ถูกย้ายมาเป็นของผู้เรียก: ผู้เรียกถือกุญแจของเครื่องนั้นอยู่จริง
--     และกุญแจของเบราว์เซอร์ (p256dh/auth) ถูกเขียนทับด้วยชุดที่ส่งมา
--   - ผู้ใช้หนึ่งคนมีได้ไม่เกิน 10 เครื่อง เกินแล้วตัดเครื่องที่ updated_at เก่าที่สุดออก
create or replace function public.app_save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_endpoint text := btrim(coalesce(p_endpoint, ''));
  v_user_agent text := nullif(btrim(coalesce(p_user_agent, '')), '');
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- endpoint ต้องเป็น https URL ล้วน (ไม่มีช่องว่าง/ตัวควบคุม) ยาวไม่เกิน 2048; กุญแจเป็น base64url ตามที่ PushSubscription.toJSON() คืน
  -- (p256dh = จุด P-256 65 ไบต์ ≈ 87 ตัว, auth = 16 ไบต์ ≈ 22 ตัว)
  if length(v_endpoint) > 2048 or v_endpoint !~ '^https://[^[:space:][:cntrl:]]{4,}$' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION' using errcode = '22023';
  end if;
  -- endpoint ต้องเป็นของ push service ของเบราว์เซอร์จริงเท่านั้น (ไม่ให้ผู้ใช้บันทึก URL อื่นให้เซิร์ฟเวอร์ยิง)
  -- รายการ host ต้องตรงกับ PUSH_HOST_SUFFIXES ใน supabase/functions/notify-push/payload.ts — แก้ที่หนึ่งต้องแก้อีกที่
  -- (ฝั่ง Edge Function ตรวจซ้ำก่อนยิงทุกครั้ง) ที่นี่เข้มกว่าเล็กน้อย: ไม่รับ userinfo และพอร์ตใด ๆ
  --   FCM  fcm.googleapis.com · android.googleapis.com   Firefox  *.push.services.mozilla.com
  --   Safari/iOS  *.push.apple.com   Edge/Windows  *.notify.windows.com
  if v_endpoint !~* '^https://([a-z0-9-]+\.)*(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)(/|$)' then
    raise exception 'PUSH_ENDPOINT_NOT_ALLOWED' using errcode = '22023';
  end if;
  if coalesce(p_p256dh, '') !~ '^[A-Za-z0-9_-]{80,100}$' or coalesce(p_auth, '') !~ '^[A-Za-z0-9_-]{16,32}$' then
    raise exception 'INVALID_PUSH_SUBSCRIPTION' using errcode = '22023';
  end if;

  insert into public.push_subscriptions as s (employee_id, endpoint, p256dh, auth, user_agent)
  values (v_employee_id, v_endpoint, p_p256dh, p_auth, left(v_user_agent, 300))
  on conflict (endpoint) do update
    set employee_id = excluded.employee_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        updated_at = now(),
        failure_count = 0;

  delete from public.push_subscriptions s
  where s.id in (
    select o.id
    from public.push_subscriptions o
    where o.employee_id = v_employee_id
    order by o.updated_at desc, o.id
    offset 10
  );
end;
$$;

-- ลบเครื่องนี้ของตัวเองตอนปิดแจ้งเตือน/ออกจากระบบ: คืน true เมื่อมีแถวถูกลบ (endpoint ของคนอื่นลบไม่ได้ ตอบ false)
create or replace function public.app_delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_deleted integer;
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  delete from public.push_subscriptions s
  where s.employee_id = v_employee_id and s.endpoint = btrim(coalesce(p_endpoint, ''));
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

-- หน้าแจ้งเตือนถามว่าเครื่องนี้ (endpoint นี้) ยังเปิดอยู่สำหรับฉันหรือไม่ — ไม่คืนข้อมูลของ subscription ใด ๆ
create or replace function public.app_is_push_subscribed(p_endpoint text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  return exists (
    select 1 from public.push_subscriptions s
    where s.employee_id = v_employee_id and s.endpoint = btrim(coalesce(p_endpoint, ''))
  );
end;
$$;

revoke all on function public.app_save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.app_delete_push_subscription(text) from public, anon;
revoke all on function public.app_is_push_subscribed(text) from public, anon;
grant execute on function public.app_save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.app_delete_push_subscription(text) to authenticated;
grant execute on function public.app_is_push_subscribed(text) to authenticated;

-- 4. จองแถวที่จะส่ง (service_role เท่านั้น) ---------------------------------------------------------
-- คืนเฉพาะคอลัมน์ที่ต้องใช้ประกอบ push (ไม่คืน body) และนับ push_attempts + 1 ให้แล้วตอนจอง
create or replace function public.app_claim_push_notifications(p_limit integer default 50)
returns table (
  id uuid,
  recipient_id uuid,
  request_id uuid,
  title text,
  action_url text,
  kind text,
  digest jsonb,
  push_attempts integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  -- แถวที่ไม่ต้องส่งแล้ว: ผู้รับอ่านในแอปไปแล้ว หรือเก่าเกิน 24 ชั่วโมง
  update public.notifications n
  set push_status = 'skipped',
      push_error = case when n.read_at is not null then 'ALREADY_READ' else 'EXPIRED' end,
      push_attempted_at = now()
  where n.push_status = 'pending'
    and (n.read_at is not null or n.created_at < now() - interval '24 hours');

  -- ใช้โควตาครบแล้วแต่ไม่มีใครปิดผล (ฟังก์ชันล้มกลางทาง) และหมดเวลาเช่า → ปิดเป็น failed
  update public.notifications n
  set push_status = 'failed',
      push_error = coalesce(n.push_error, 'LEASE_EXPIRED')
  where n.push_status = 'pending'
    and n.push_attempts >= 3
    and n.push_attempted_at < now() - interval '10 minutes';

  return query
  with picked as (
    select c.id
    from public.notifications c
    where c.push_status = 'pending'
      and c.push_attempts < 3
      and (c.push_attempted_at is null or c.push_attempted_at < now() - interval '10 minutes')
    order by c.created_at
    limit v_limit
    for update skip locked
  )
  update public.notifications n
  set push_attempts = n.push_attempts + 1,
      push_attempted_at = now()
  from picked
  where n.id = picked.id
  returning n.id, n.recipient_id, n.request_id, n.title, n.action_url, n.kind, n.digest, n.push_attempts;
end;
$$;

revoke all on function public.app_claim_push_notifications(integer) from public, anon, authenticated;
grant execute on function public.app_claim_push_notifications(integer) to service_role;

-- 5. ไล่คิวด้วย pg_cron ทุกนาที ---------------------------------------------------------------------
create or replace function private.dispatch_pending_push_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'notify_push_function_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'notify_push_service_role_key';
  if v_url is null or v_key is null then
    raise notice 'dispatch_pending_push_notifications: NOT_CONFIGURED — ยังไม่ได้ตั้ง vault secret notify_push_function_url / notify_push_service_role_key';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function private.dispatch_pending_push_notifications() from public, anon, authenticated;

-- เรียก Edge Function เฉพาะเมื่อมีแถวที่ "จองได้จริง" (ยังไม่อ่าน ไม่เก่าเกิน 24 ชั่วโมง ไม่ติดเวลาเช่า) คิวว่าง = ไม่เรียกอะไรเลย
create or replace function private.drain_pending_push_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.notifications n
    where n.push_status = 'pending'
      and n.push_attempts < 3
      and n.read_at is null
      and n.created_at > now() - interval '24 hours'
      and (n.push_attempted_at is null or n.push_attempted_at < now() - interval '10 minutes')
  ) then
    perform private.dispatch_pending_push_notifications();
  end if;
end;
$$;

revoke all on function private.drain_pending_push_notifications() from public, anon, authenticated;

-- cron.schedule คีย์ด้วยชื่องาน — รันซ้ำแล้วอัปเดตตารางเวลา/คำสั่งเดิม ไม่สร้างงานซ้ำ
select cron.schedule(
  'notification-push-drain',
  '* * * * *',
  $cron$ select private.drain_pending_push_notifications(); $cron$
);
