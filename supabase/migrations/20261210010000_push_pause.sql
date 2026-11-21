-- พักแจ้งเตือน (Web Push) ชั่วคราวถึง 07:00 น. ของวันถัดไป (เวลาไทย) · เจ้าของสั่ง 21/11/2026
--
-- พฤติกรรม
--   - พนักงานกด "พักแจ้งเตือน" เอง (เช่นลาพักผ่อน) → พัก "ทั้งคน" (ทุกเครื่อง) ถึง 07:00 น. ของวันปฏิทินไทยถัดไปเสมอ ไม่ว่ากดกี่โมง
--     (กดตอน 00:30 ก็ถึง 07:00 ของวันถัดไป = พักราว 30 ชั่วโมง ไม่ใช่ 07:00 เช้าวันเดียวกัน — ตามกติกาที่เจ้าของกำหนด)
--   - พักเฉพาะ Web Push เท่านั้น: อีเมลส่งตามปกติ และแถวใน public.notifications (กระดิ่ง) ถูกสร้างตามปกติ
--   - Edge Function notify-push เห็นผู้รับที่กำลังพักแล้วไม่ส่ง ปิดแถวเป็น push_status = 'skipped', push_error = 'PAUSED'
--     (ใช้นับ "แจ้งเตือนที่พลาด" ตอนครบเวลา — ไม่ replace ฟังก์ชันเดิมของระบบ push ตัวใดเลย)
--   - ครบเวลา pg_cron (ทุกนาที เฉพาะเมื่อมีแถวพักที่หมดเวลา) เรียก notify-push โหมด {"mode":"pause-digest"} ส่ง Push สรุป 1 ครั้ง
--     "แจ้งเตือนที่คุณพลาดระหว่างพัก / คุณมี N แจ้งเตือนที่ยังไม่ได้อ่าน" ถ้า N > 0 (N = แถว PAUSED ที่ผู้รับยังไม่อ่าน) แล้วลบแถวพัก
--     Push สรุปส่งตรงจาก Edge Function ไม่สร้างแถว notifications เลย → ไม่มีอีเมลซ้ำ และตัวเลขกระดิ่ง "ยังไม่อ่าน" ไม่เพี้ยน
--   - กด "เปิดแจ้งเตือนต่อ" ก่อนเวลา = ลบแถวพัก ไม่ส่งสรุป (ผู้ใช้อยู่หน้าจออยู่แล้ว)
--
-- ตารางใหม่ public.push_pauses (แถวเดียวต่อพนักงาน แก้/ลบได้ ไม่ใช่บันทึก ISO)
--   RLS เปิด ไม่มี policy ไม่มีสิทธิ์ตรงให้ anon/authenticated (เข้าผ่าน RPC เท่านั้น) service_role อ่าน/ลบได้ (notify-push)
--   ติด sandbox_guard (เขียนไม่ได้ขณะ admin อยู่ในโหมดทดสอบ) และ lab_only_guard_table (บัญชี LAB-only มองไม่เห็น) เหมือน push_subscriptions
--
-- RPC สำหรับหน้าเว็บ (authenticated เท่านั้น ใช้พนักงานของ auth.uid() ไม่รับ employee_id จาก client)
--   public.app_push_pause()         returns timestamptz  ตั้งพักถึง 07:00 ไทยวันถัดไป คืนเวลาสิ้นสุด · กดซ้ำขณะพักอยู่ = คืนเวลาเดิม (ไม่ต่อเวลา)
--   public.app_push_resume()        returns void         ยกเลิกการพัก (ไม่มีการพักอยู่ก็ไม่ error)
--   public.app_push_pause_status()  returns timestamptz  เวลาสิ้นสุดถ้ายังพักอยู่ ไม่งั้น null
--   ข้อผิดพลาด (เป็นรหัส แอปแปลงเป็นข้อความไทยเอง): AUTH_REQUIRED, NOT_AUTHORIZED, LAB_ONLY_ACCOUNT(42501),
--   SANDBOX_MODULE_UNSUPPORTED (pause/resume ในโหมดทดสอบ; status อ่านได้)
--
-- ฟังก์ชันสำหรับ notify-push (service_role เท่านั้น)
--   public.app_claim_push_pause_digests(p_limit) จอง "แถวพักที่หมดเวลา" ที่ต้องส่งสรุป ด้วย FOR UPDATE SKIP LOCKED + เวลาเช่า 10 นาที
--   นับครั้งที่ลองตอนจอง (สูงสุด 3) และออก digest_claim_id ใหม่ทุกครั้ง: Edge Function ลบแถวได้เฉพาะเมื่อ claim id ยังตรง
--   (ถ้าพนักงานกดพักใหม่ระหว่างนั้น claim id ถูกล้าง ผลของรอบเก่าไม่ลบแถวของการพักใหม่)
--   ส่งซ้ำ: ถ้า Edge Function ล้มหลังส่งแต่ก่อนลบแถว จะถูกจองซ้ำหลังหมดเวลาเช่าได้ (tag ของ push เดิม → บนหน้าจอทับอันเดิม ไม่ขึ้นสองอัน)
--
-- ต้องตั้งก่อนใช้งานจริง: ใช้ Vault secret notify_push_function_url / notify_push_service_role_key ชุดเดียวกับ notification-push-drain
--   (ไม่มีอะไรต้องตั้งเพิ่ม) · ลำดับขึ้น prod: apply migration นี้ → deploy Edge Function notify-push → (หน้าเว็บ merge)
--   ถ้า migration ขึ้นแต่ยังไม่ deploy function: ไม่มีใครกดพักได้จนกว่าหน้าเว็บจะขึ้น จึงไม่กระทบ; ถ้ามีคนพักแล้วยังไม่ deploy function
--   push จะยังส่งตามปกติ (function เก่าไม่รู้จักการพัก) และ cron สรุปจะเรียก function เก่าซึ่งไม่ทำอะไร (วนทุกนาทีจนกว่าจะ deploy)
--
-- Rollback (ไม่มีข้อมูลธุรกิจ; ผู้ที่พักอยู่จะกลับมารับ push ทันที):
--   select cron.unschedule('push-pause-digest');
--   drop function if exists private.drain_push_pause_digests();
--   drop function if exists private.dispatch_push_pause_digests();
--   drop function if exists public.app_claim_push_pause_digests(integer);
--   drop function if exists public.app_push_pause_status();
--   drop function if exists public.app_push_resume();
--   drop function if exists public.app_push_pause();
--   drop function if exists private.push_pause_missed_count(uuid, timestamptz);
--   drop function if exists private.push_pause_end(timestamptz);
--   drop table if exists public.push_pauses;
--   (แถว notifications ที่เป็น push_error = 'PAUSED' คงอยู่ได้ ไม่เป็นปัญหา)

-- 1. ตาราง -----------------------------------------------------------------------------------------
create table public.push_pauses (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  -- เริ่มพักเมื่อไร: ใช้นับแจ้งเตือนที่พลาด (แถว PAUSED ที่ push_attempted_at >= paused_at)
  paused_at timestamptz not null default now(),
  -- สิ้นสุดพัก: 07:00 ไทยเสมอ (คำนวณใน private.push_pause_end)
  paused_until timestamptz not null,
  -- สถานะ "ส่งสรุป" หลังหมดเวลา (ดูหัวไฟล์): จำนวนครั้งที่จอง · เวลาที่จองล่าสุด (เช่า 10 นาที) · รหัสการจองล่าสุด
  digest_attempts integer not null default 0,
  digest_claimed_at timestamptz,
  digest_claim_id uuid,
  updated_at timestamptz not null default now(),
  constraint push_pauses_until_after_start check (paused_until > paused_at)
);

create index push_pauses_until_idx on public.push_pauses (paused_until);

comment on table public.push_pauses is
  'พนักงานที่พักแจ้งเตือน Web Push ถึง 07:00 ไทยวันถัดไป (แถวเดียวต่อคน) · เข้าถึงผ่าน RPC app_push_pause/resume/pause_status เท่านั้น';

alter table public.push_pauses enable row level security;
-- ไม่มี policy = ปิดทุกทางผ่าน Data API; service_role ข้าม RLS เอง (แต่ยังต้องมี grant ด้านล่าง)
revoke all on public.push_pauses from public, anon, authenticated, service_role;
grant select, delete on public.push_pauses to service_role;
select private.lab_only_guard_table('public.push_pauses');
-- โหมดทดสอบของ admin: ระหว่างอยู่ในโหมดทดสอบห้ามเขียนตารางนี้ · Edge Function/cron ใช้ service_role/postgres (auth.uid() เป็น null) จึงเขียนได้ตามปกติ
select private.sandbox_guard_table('public.push_pauses');

-- 2. ตัวช่วย -----------------------------------------------------------------------------------------
-- 07:00 น. ของ "วันปฏิทินไทยถัดไป" นับจาก p_from (คำนวณจากเวลาไทยเสมอ ไม่ใช่ UTC)
--   กด 14:00 พ.ย. 21 → 07:00 พ.ย. 22 · กด 00:30 พ.ย. 22 → 07:00 พ.ย. 23 (วันปฏิทินไทยถัดไป ไม่ใช่เช้าวันเดียวกัน)
-- ไทยไม่มี DST จึงบวก interval บน timestamp ท้องถิ่นได้ตรง ๆ
create or replace function private.push_pause_end(p_from timestamptz default now())
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (date_trunc('day', p_from at time zone 'Asia/Bangkok') + interval '1 day' + interval '7 hours') at time zone 'Asia/Bangkok'
$$;
revoke all on function private.push_pause_end(timestamptz) from public, anon, authenticated;

-- จำนวน "แจ้งเตือนที่พลาด" ของผู้รับตั้งแต่เริ่มพัก: แถวที่ notify-push ข้ามเพราะพัก (PAUSED) และผู้รับยังไม่อ่าน
-- นับจากเวลาที่ถูกข้ามจริง (push_attempted_at ที่ notify-push ตั้งตอนปิดแถว) ไม่ใช่ created_at: แถวที่เกิดก่อนกดพักไม่กี่วินาที
-- แต่ถูกไล่คิวหลังกดพัก ก็ถูกข้ามเพราะการพักเหมือนกัน
create or replace function private.push_pause_missed_count(p_employee_id uuid, p_since timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.recipient_id = p_employee_id
    and n.push_status = 'skipped'
    and n.push_error = 'PAUSED'
    and n.read_at is null
    and n.push_attempted_at >= p_since
$$;
revoke all on function private.push_pause_missed_count(uuid, timestamptz) from public, anon, authenticated;

-- 3. RPC ฝั่งผู้ใช้ ---------------------------------------------------------------------------------
create or replace function public.app_push_pause()
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_until timestamptz;
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;
  -- โหมดทดสอบของ admin: ไม่ทำอะไร (ด่านของตารางก็บล็อกอยู่แล้ว แต่ตรวจก่อนเพื่อให้ปฏิเสธเสมอแม้ไม่มีแถวให้เขียน)
  if (private.sandbox_persona()).id is not null then
    raise exception 'SANDBOX_MODULE_UNSUPPORTED';
  end if;

  -- แถวเดียวต่อคน:
  --   - ยังพักอยู่ (paused_until อยู่ในอนาคต) → คืนเวลาเดิม ไม่ต่อเวลา ไม่แตะสถานะอื่น
  --   - แถวเดิมหมดเวลาแล้วแต่ cron ยังไม่ได้ส่งสรุป/ปิดแถว → เริ่มพักรอบใหม่ แต่คง paused_at เดิม
  --     (แจ้งเตือนที่พลาดของรอบก่อนที่ยังไม่อ่านจึงไปรวมในสรุปรอบใหม่ ไม่หายไป) และล้างสถานะจองสรุปของรอบเก่า
  insert into public.push_pauses as p (employee_id, paused_at, paused_until)
  values (v_employee_id, now(), private.push_pause_end(now()))
  on conflict (employee_id) do update
    set paused_until = case when p.paused_until > now() then p.paused_until else excluded.paused_until end,
        digest_attempts = case when p.paused_until > now() then p.digest_attempts else 0 end,
        digest_claimed_at = case when p.paused_until > now() then p.digest_claimed_at else null end,
        digest_claim_id = case when p.paused_until > now() then p.digest_claim_id else null end,
        updated_at = now()
  returning p.paused_until into v_until;
  return v_until;
end;
$$;

create or replace function public.app_push_resume()
returns void
language plpgsql
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
  if (private.sandbox_persona()).id is not null then
    raise exception 'SANDBOX_MODULE_UNSUPPORTED';
  end if;

  -- ไม่ได้พักอยู่ก็ไม่ error (กดซ้ำ/สองเครื่องพร้อมกันได้) · ลบแถว = ไม่ส่งสรุป
  delete from public.push_pauses p where p.employee_id = v_employee_id;
end;
$$;

-- อ่านอย่างเดียว (ใช้ในโหมดทดสอบได้) · แถวที่หมดเวลาแล้วนับเป็น "ไม่ได้พัก" ทันทีแม้ cron ยังไม่ปิดแถว
create or replace function public.app_push_pause_status()
returns timestamptz
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

  return (
    select p.paused_until
    from public.push_pauses p
    where p.employee_id = v_employee_id and p.paused_until > now()
  );
end;
$$;

revoke all on function public.app_push_pause() from public, anon;
revoke all on function public.app_push_resume() from public, anon;
revoke all on function public.app_push_pause_status() from public, anon;
grant execute on function public.app_push_pause() to authenticated;
grant execute on function public.app_push_resume() to authenticated;
grant execute on function public.app_push_pause_status() to authenticated;

-- 4. จองแถวพักที่หมดเวลา เพื่อส่ง Push สรุป (service_role เท่านั้น) --------------------------------------
-- คืนเฉพาะคนที่ "มีแจ้งเตือนที่พลาดและยังไม่อ่าน" (N > 0): แถวที่ไม่มีอะไรให้สรุปหรือพนักงานไม่ active ถูกลบทิ้งในนี้เลย
-- ส่งซ้ำ/ไม่หลุด: นับครั้งที่ลองตอนจอง (สูงสุด 3) เช่า 10 นาที (ยาวกว่าเพดานเวลาของ Edge Function เหมือน app_claim_push_notifications)
create or replace function public.app_claim_push_pause_digests(p_limit integer default 50)
returns table (
  employee_id uuid,
  missed_count integer,
  digest_attempts integer,
  digest_claim_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_row record;
  v_missed integer;
begin
  -- พนักงานที่ไม่ active แล้วไม่ต้องสรุปอะไร
  delete from public.push_pauses p
  where p.paused_until <= now()
    and not exists (
      select 1 from public.employees e
      where e.id = p.employee_id and e.is_active and e.deleted_at is null
    );

  for v_row in
    with picked as (
      select p.employee_id
      from public.push_pauses p
      where p.paused_until <= now()
        and p.digest_attempts < 3
        and (p.digest_claimed_at is null or p.digest_claimed_at < now() - interval '10 minutes')
      order by p.paused_until, p.employee_id
      limit v_limit
      for update skip locked
    ),
    claimed as (
      update public.push_pauses u
      set digest_attempts = u.digest_attempts + 1,
          digest_claimed_at = now(),
          digest_claim_id = gen_random_uuid(),
          updated_at = now()
      from picked
      where u.employee_id = picked.employee_id
      returning u.employee_id, u.paused_at, u.digest_attempts, u.digest_claim_id
    )
    select c.employee_id as emp, c.paused_at as since, c.digest_attempts as attempts, c.digest_claim_id as claim_id
    from claimed c
  loop
    v_missed := private.push_pause_missed_count(v_row.emp, v_row.since);
    if v_missed = 0 then
      -- ไม่มีอะไรให้สรุป (ไม่มีแจ้งเตือนเข้าระหว่างพัก หรืออ่านครบแล้ว) → ปิดแถว ไม่ส่งอะไร
      delete from public.push_pauses p where p.employee_id = v_row.emp and p.digest_claim_id = v_row.claim_id;
      continue;
    end if;
    employee_id := v_row.emp;
    missed_count := v_missed;
    digest_attempts := v_row.attempts;
    digest_claim_id := v_row.claim_id;
    return next;
  end loop;
end;
$$;

revoke all on function public.app_claim_push_pause_digests(integer) from public, anon, authenticated;
grant execute on function public.app_claim_push_pause_digests(integer) to service_role;

-- 5. ไล่ส่งสรุปด้วย pg_cron ทุกนาที (เฉพาะเมื่อมีแถวพักที่หมดเวลา) ---------------------------------------------
-- เหตุที่ไม่ตั้งเวลาตายตัว 00:00 UTC: แถวพักหมดเวลาเฉพาะ 07:00 ไทย อยู่แล้ว (ทุกการพักสิ้นสุดที่เวลานั้น) งานที่เช็กทุกนาทีจึงทำงานจริง
-- แค่ช่วง 07:00 และลองใหม่เองได้ถ้ารอบแรก Edge Function ล้ม/ยังไม่ตั้ง VAPID ไม่ต้องรอพรุ่งนี้ · ช่วงที่ไม่มีแถวหมดเวลา = query ดัชนีเดียวแล้วจบ
create or replace function private.dispatch_push_pause_digests()
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
    raise notice 'dispatch_push_pause_digests: NOT_CONFIGURED — ยังไม่ได้ตั้ง vault secret notify_push_function_url / notify_push_service_role_key';
    return;
  end if;
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body := '{"mode":"pause-digest"}'::jsonb
  );
end;
$$;
revoke all on function private.dispatch_push_pause_digests() from public, anon, authenticated;

create or replace function private.drain_push_pause_digests()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- แถวที่หมดเวลาแล้วและไม่มีแจ้งเตือนที่พลาด → ปิดเลยโดยไม่ต้องเรียก Edge Function (กรณีส่วนใหญ่)
  delete from public.push_pauses p
  where p.paused_until <= now()
    and p.digest_claimed_at is null
    and private.push_pause_missed_count(p.employee_id, p.paused_at) = 0;

  -- ลองครบโควตาแล้วแต่ไม่มีใครปิดแถว (Edge Function ล้มซ้ำ) และหมดเวลาเช่า → เลิกส่งสรุปรอบนั้น
  delete from public.push_pauses p
  where p.paused_until <= now()
    and p.digest_attempts >= 3
    and p.digest_claimed_at < now() - interval '10 minutes';

  if exists (
    select 1
    from public.push_pauses p
    where p.paused_until <= now()
      and p.digest_attempts < 3
      and (p.digest_claimed_at is null or p.digest_claimed_at < now() - interval '10 minutes')
  ) then
    perform private.dispatch_push_pause_digests();
  end if;
end;
$$;
revoke all on function private.drain_push_pause_digests() from public, anon, authenticated;

-- cron.schedule คีย์ด้วยชื่องาน — รันซ้ำแล้วอัปเดตตารางเวลา/คำสั่งเดิม ไม่สร้างงานซ้ำ
select cron.schedule(
  'push-pause-digest',
  '* * * * *',
  $cron$ select private.drain_push_pause_digests(); $cron$
);
