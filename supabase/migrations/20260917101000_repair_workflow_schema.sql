-- โครงข้อมูลสำหรับ workflow แจ้งซ่อมแบบเดียวกับระบบ Maintanance-MT
--
-- ยกโดเมนใบแจ้งซ่อมของ MT เข้ามาไว้ใน MNP_SYSTEM ทั้งชุด: master เครื่องจักร,
-- เลขที่เอกสารรันตามแผนก, ฟิลด์ของงานช่าง และประวัติการตรวจรับของผู้แจ้ง
-- โดยยังใช้ approval engine, สิทธิ์, notification และ audit ชุดเดิมของระบบนี้

-- 1. Master เครื่องจักร ย้ายมาจากแท็บ "เครื่องจักร" ของชีต MT
--    ไม่ใส่ unique(code) โดยตั้งใจ เพราะข้อมูลจริงมีรหัสซ้ำอยู่ 4 คู่ การบังคับ unique
--    จะทำให้ import ล้มทั้งชุด และไปบังคับให้ต้องแก้ข้อมูลหน้างานก่อนย้ายระบบ
--    is_placeholder = แถว "สร้างใหม่" กับ "ไม่มี" ซึ่ง MT ใช้เป็นตัวเลือกตอนไม่มีรหัสเครื่อง
create table if not exists public.machines (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  name text not null,
  department_id uuid not null references public.departments(id),
  is_placeholder boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists machines_department_idx on public.machines(department_id) where is_active;
create index if not exists machines_code_idx on public.machines(department_id, code);

drop trigger if exists machines_touch on public.machines;
create trigger machines_touch before update on public.machines
for each row execute function private.touch_updated_at();

alter table public.machines enable row level security;
revoke all on public.machines from anon, authenticated;
grant select on public.machines to authenticated;

drop policy if exists machines_read on public.machines;
create policy machines_read on public.machines for select to authenticated using (is_active);

-- 2. ประเภทคำร้องที่ใช้ workflow แจ้งซ่อมเต็มรูปแบบ
--    ทำเป็นธงบนประเภทคำร้อง ไม่ใช่เช็กรหัส MT_REPAIR ตรงๆ ในโค้ด เพราะวันหลังจะเปิด
--    ให้แจ้งซ่อมรถหรือแจ้งซ่อม IT ใช้ workflow เดียวกันก็แค่ติดธงเพิ่ม ไม่ต้องแก้โค้ด
alter table public.request_types
  add column if not exists uses_repair_workflow boolean not null default false;

update public.request_types set uses_repair_workflow = true where code = 'MT_REPAIR';

-- 3. ฟิลด์ของใบแจ้งซ่อม
--    machine_code/machine_name เก็บเป็นข้อความ ณ วันแจ้งด้วย ไม่ใช่อ้าง machine_id อย่างเดียว
--    เพราะใบที่พิมพ์ไปแล้วต้องอ่านได้เหมือนเดิมแม้ภายหลังจะแก้ชื่อหรือลบเครื่องออกจาก master
alter table public.requests
  add column if not exists doc_type text check (doc_type is null or doc_type in ('request', 'repair')),
  add column if not exists machine_id uuid references public.machines(id) on delete set null,
  add column if not exists machine_code text,
  add column if not exists machine_name text,
  add column if not exists needed_date date,
  add column if not exists is_urgent boolean not null default false,
  add column if not exists requester_name text,
  add column if not exists assigned_by uuid references public.employees(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists work_started_date date,
  add column if not exists work_expected_date date,
  add column if not exists execution_plan text check (execution_plan is null or execution_plan in ('immediate', 'need_purchase', 'use_existing')),
  add column if not exists cause_analysis text,
  add column if not exists inspector_opinion text check (inspector_opinion is null or inspector_opinion in ('send_repair', 'external', 'self_repair', 'buy_parts')),
  add column if not exists parts_used text;

create index if not exists requests_machine_idx on public.requests(machine_id) where machine_id is not null;
create index if not exists requests_assigned_by_idx on public.requests(assigned_by) where assigned_by is not null;

-- 4. ประวัติการตรวจรับของผู้แจ้ง — MT เก็บทั้งครั้งที่ผ่านและไม่ผ่านไว้ดูย้อนหลัง
create table if not exists public.request_verifications (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  result text not null check (result in ('pass', 'fail')),
  note text,
  verified_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists request_verifications_request_idx on public.request_verifications(request_id);
create index if not exists request_verifications_verified_by_idx on public.request_verifications(verified_by)
  where verified_by is not null;

alter table public.request_verifications enable row level security;
revoke all on public.request_verifications from anon, authenticated;
grant select on public.request_verifications to authenticated;

drop policy if exists request_verifications_read on public.request_verifications;
create policy request_verifications_read on public.request_verifications for select to authenticated
using (private.can_access_request(request_id));

-- 5. เลขที่เอกสารรันตามแผนก รูปแบบเดียวกับ MT คือ <รหัสแผนก><เลข 3 หลัก>/<ปี 2 หลัก>
create table if not exists public.document_counters (
  department_code text not null,
  year_key text not null,
  last_number integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (department_code, year_key)
);

alter table public.document_counters enable row level security;
revoke all on public.document_counters from anon, authenticated;

drop policy if exists document_counters_no_direct_access on public.document_counters;
create policy document_counters_no_direct_access on public.document_counters
for all to authenticated using (false) with check (false);

-- ยกตัวนับปี 26 ของ MT มาตั้งต้น เลขใหม่จึงเดินต่อจากของเดิมและไม่ชนกับใบที่ออกไปแล้ว
-- (ST เริ่มที่ 6 เพราะรับช่วงจาก ST-WH ของชีตเดิม ส่วน WH เป็นแผนกใหม่จึงเริ่มที่ 0)
insert into public.document_counters (department_code, year_key, last_number) values
  ('RB', '26', 43),
  ('GR', '26', 69),
  ('BG', '26', 19),
  ('PT', '26', 0),
  ('PK', '26', 22),
  ('QA', '26', 10),
  ('ST', '26', 6),
  ('SR', '26', 0),
  ('FT', '26', 42),
  ('AD', '26', 31),
  ('MT', '26', 34),
  ('WH', '26', 0)
on conflict (department_code, year_key) do nothing;

create or replace function private.next_repair_doc_number(p_department_code text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_next integer;
begin
  insert into public.document_counters (department_code, year_key, last_number)
  values (p_department_code, v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;
  return p_department_code || lpad(v_next::text, 3, '0') || '/' || v_year;
end;
$$;

revoke all on function private.next_repair_doc_number(text) from public, anon, authenticated;

-- 6. ใบของประเภทที่ใช้ workflow แจ้งซ่อม ออกเลขตามแผนก ส่วนประเภทอื่นใช้รูปแบบเดิมทุกประการ
create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_prefix text;
  uses_repair boolean;
  dept_code text;
begin
  select prefix, uses_repair_workflow into type_prefix, uses_repair
  from public.request_types where id = new.request_type_id;
  if type_prefix is null then raise exception 'Unknown request type'; end if;

  if coalesce(uses_repair, false) then
    select code into dept_code from public.departments where id = new.department_id;
    if dept_code is null then raise exception 'Unknown department'; end if;
    new.request_no := private.next_repair_doc_number(dept_code);
    return new;
  end if;

  new.request_no := type_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.request_number_seq')::text, 6, '0');
  return new;
end;
$$;

revoke all on function private.assign_request_number() from public, anon, authenticated;
