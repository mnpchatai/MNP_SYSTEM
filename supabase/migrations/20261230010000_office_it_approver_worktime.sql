-- ผู้อนุมัติขั้น IT = IT3462 (หัวหน้า IT ดูอย่างเดียว) + สรุปเวลาทำงานของ IT · เจ้าของสั่ง 26/11/2026
-- ใช้กับ: ใบสั่งงาน IT (itwo_*) และใบแจ้งซ่อม (itrp_*) · สเปก: Work-Order/docs/it-approver-worktime-spec.md
--
-- ใครอ่านต่อ: ฟังก์ชันที่ replace ทั้งหมดเริ่มจากนิยามที่ prod ใช้อยู่จริง ณ 26/11/2026 (md5 ฐานอยู่ท้ายคอมเมนต์นี้) แก้เฉพาะจุดที่ระบุ
-- ไม่ได้แก้ migration เก่า (20261203 ... 20261225 apply บน prod แล้ว) ใบจริงของทั้งสองโมดูลตอนเขียน = 0 (มีแต่ใบทดสอบ)
--
-- A. กติกาผู้อนุมัติขั้น IT
--   - ผู้อนุมัติขั้น IT ของใบทั่วไป = ผู้ที่มี itwo_staff.is_it_approver (IT3462 คนเดียวตามข้อมูลด้านล่าง)
--   - หัวหน้า IT (FANG) = ธงใหม่ itwo_staff.is_it_viewer: เห็นทุกใบ/ประวัติ (เพราะมีแถวใน itwo_staff) ไม่ได้รับแจ้งเตือน "รอคุณอนุมัติ" ของใบทั่วไป
--     ไม่มีสิทธิ์ฝั่ง IT (เริ่ม/ส่งงาน/ถาม/ตั้งค่า ยังผูกกับ is_it_admin อย่างเดียว ไม่แก้)
--   - ใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง (IT3462 แจ้งเอง): ไม่ผ่านอัตโนมัติอีกต่อไป (เอากิ่ง "อนุมัติในตัวทั้งสองขั้น" ออกจาก app_itwo_create / app_itrp_create)
--     ใบวิ่งตามเส้นทางปกติ (แผนก IT/แผนกไม่มีผู้จัดการ -> รอขั้น IT) และขั้น IT ผู้อนุมัติ = หัวหน้า IT (is_it_viewer) เท่านั้น
--     แผนกไม่มีผู้จัดการ/ผู้ช่วย (เช่นแผนก IT) หัวหน้า IT กดครั้งเดียวนับสองขั้น (บันทึก dept_approved + it_mgr_approved ในชื่อหัวหน้า IT)
--     ถ้าไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ผ่านอัตโนมัติ) การแจ้งไม่ถูกปฏิเสธ
--     หัวหน้า IT อนุมัติใบอื่นไม่ได้ · ผู้อนุมัติขั้น IT อนุมัติใบตัวเองไม่ได้ (เดิม) และอนุมัติใบของผู้อนุมัติด้วยกันเองไม่ได้
--     จุดเดียวที่ตัดสินสิทธิ์นี้: private.itwo_is_it_stage_approver / private.itrp_is_it_stage_approver (approval_caps เรียกใช้
--     allowed_actions / info_stage / list_pending_approvals / pending_count / decide ตามมาจาก approval_caps)
--   - แจ้งเตือน "รออนุมัติขั้น IT" ของใบที่ผู้แจ้งเป็นผู้อนุมัติ -> ส่งหาหัวหน้า IT · ใบอื่นส่งหาผู้อนุมัติเหมือนเดิม (private.*_notify_it_stage_ids)
--   - app_itwo_set_staff เพิ่มพารามิเตอร์ที่ 4 p_is_it_viewer แบบมี default null (= คงธงเดิมของคนนั้น) เรียกแบบ 3 พารามิเตอร์ได้ต่อ
--     app_itwo_list_staff / app_itrp_list_staff คืนคอลัมน์ is_it_viewer เพิ่ม · app_itwo_my_role / app_itrp_my_role เพิ่มคีย์ is_it_viewer
--   - itrp: ประวัติการซ่อม/ทะเบียนเครื่อง (app_itrp_device_history / history_get / list_devices อ่านอย่างเดียว) หัวหน้า IT ดูได้
--     (เดิม FANG ดูได้ในฐานะผู้อนุมัติ จึงคงสิทธิ์ดูไว้ ไม่ให้สิทธิ์เขียน)
--   - ข้อมูล: IT3462 -> admin + approver · FANG -> viewer · SBX-IT-ADMIN -> admin + approver · SBX-IT-APPROVER -> viewer เท่านั้น
--     (บันทึก itwo_admin_log ต่อแถวที่เปลี่ยน) · ไม่พบแถว/คนใดให้ข้าม ไม่ error
--
-- B. สรุปเวลาทำงานของ IT
--   - ตารางตั้งค่า public.office_work_hours (แถวเดียว 08:00-17:00 พัก 12:00-13:00 วันทำงาน จันทร์-เสาร์ แก้ด้วย SQL ได้)
--   - private.office_working_minutes(from, to): นับเฉพาะเวลาทำงานตามเวลา Asia/Bangkok ตัดวันนอกวันทำงาน, วันใน public.company_holidays
--     (ตารางของระบบเพื่อน อ่านอย่างเดียว), พักเที่ยง, นอกเวลา · private.office_work_minutes_from_events รวมช่วงจาก events
--   - ใช้เวลาของ IT = ช่วงเริ่ม started / rework_requested ถึง completed รวมทุกช่วงที่ปิดแล้ว หัก info_requested -> info_provided ที่อยู่ในช่วงงาน
--   - RPC รายละเอียด (app_itwo_get_detail / app_itrp_get_detail) เพิ่มคีย์ work_minutes (integer หรือ null) คีย์เดิมไม่เปลี่ยน
--   - ไม่เก็บค่าซ้ำ คิดจากประวัติทุกครั้งที่เรียก
--
-- ตารางใหม่ office_work_hours: deny-all (RLS เปิด ไม่มี grant ให้ anon/authenticated/service_role) ติด sandbox_guard + lab_only_guard
--   ไม่เพิ่มชื่อใน private.sandbox_unguarded_tables() (ตารางนี้ไม่รู้จักโหมดทดสอบ ใช้ guard แบบเดียวกับ itwo_staff)
--
-- ย้อน (ถ้าจำเป็น): create or replace ฟังก์ชันที่ replace กลับเป็นนิยามจาก 20261203..20261225 (md5 ฐานอยู่ด้านล่าง) · drop function app_itwo_set_staff(text,boolean,boolean,boolean)
--   แล้วสร้างฉบับ 3 พารามิเตอร์คืน · list_staff drop/create คืนชนิดเดิม · ตั้ง is_it_approver ของ FANG คืนแล้วเอาคอลัมน์ is_it_viewer/ตาราง office_work_hours ออก
--   ลำดับ: ต้องแก้ฟังก์ชันที่เรียก *_is_it_stage_approver ก่อน drop ตัวช่วยใหม่
--
-- ก่อน apply บน prod ต้องเทียบ md5(pg_get_functiondef(oid)) ของทุกฟังก์ชันด้านล่างว่ายังตรงกับค่าฐาน (นิยามตอน 26/11/2026)
-- (ถ้าเพื่อนหรืองานอื่นแตะฟังก์ชันเหล่านี้ระหว่างนั้น ต้องรวมการแก้ก่อน)
-- ตรวจเพิ่ม: มี migration ใหม่กว่า 20261227010000 บน prod หรือไม่ · public.company_holidays ยังอยู่
--
-- md5 ฐาน (prod 26/11/2026):
--   private.itwo_approval_caps(p_work_order_id uuid, p_actor_id uuid, OUT can_dept boolean, OUT can_it boolean, OUT dept_done boolean, OUT it_done boolean, OUT rejected boolean, OUT dept_is_it boolean, OUT has_dept_approvers boolean, OUT actor_is_dept_role boolean)
--     md5 2edcab1e6e19a58ce996de19db2e2f72
--   private.itwo_decide(p_work_order_id uuid, p_approve boolean, p_reason text)
--     md5 7ae0994844c3211f319c4bd300e9317c
--   public.app_itwo_create(p_request_type text, p_order_ref text, p_attachment_flag text, p_attachment_note text, p_details text, p_needed_date date, p_is_urgent boolean, p_misc_detail text)
--     md5 b04f3181170dd3247dc06d7455ed735b
--   private.itwo_notify_stage_approver_ids(p_wo itwo_work_orders)
--     md5 c8827eec32879597c68a40616f536594
--   private.itwo_notify_on_event()
--     md5 041caa3d6e155308f7bf2a5de09a4e95
--   public.app_itwo_my_role()
--     md5 f52f9a9dcef07d57e8248dc4d22050e3
--   public.app_itwo_get_detail(p_work_order_id uuid)
--     md5 79645c06a5900c03c6150aa2c2067331
--   private.itrp_approval_caps(p_request_id uuid, p_actor_id uuid, OUT can_dept boolean, OUT can_it boolean, OUT dept_done boolean, OUT it_done boolean, OUT rejected boolean, OUT dept_is_it boolean, OUT has_dept_approvers boolean, OUT actor_is_dept_role boolean)
--     md5 06e6f1571fff0f2a88599d9db28009f3
--   private.itrp_decide(p_request_id uuid, p_approve boolean, p_reason text)
--     md5 cfbfe26b0ac26aa369b252724246e2d8
--   public.app_itrp_create(p_asset_code text, p_device_name text, p_request_kind text, p_request_kind_note text, p_repair_target text, p_repair_target_note text, p_symptom text, p_is_urgent boolean)
--     md5 22da8eac0ad58b2a6799dd53794bb50f
--   private.itrp_notify_stage_approver_ids(p_req itrp_requests)
--     md5 1a335127769b3b1ac4157b15faf98ff5
--   private.itrp_notify_on_event()
--     md5 26bd99619865ea069be794bf2b49902e
--   public.app_itrp_my_role()
--     md5 c9bf53fcda895b04c138ced644983504
--   public.app_itrp_get_detail(p_request_id uuid)
--     md5 c63e9f87c7cfe8a891bd12647dc040dd
--   public.app_itrp_device_history(p_code text)
--     md5 46e9526d65acb311fc00e9a79a1470da
--   public.app_itrp_history_get(p_entry_id bigint)
--     md5 ce6e086c3e333c8519a4bbdd633d6a53
--   public.app_itrp_list_devices(p_search text, p_include_retired boolean)
--     md5 6fb8fcfc004c307eff4948179be38e41
--   public.app_itwo_list_staff()
--     md5 85c3f386762e0586f3d0b3cf88b7975b
--   public.app_itrp_list_staff()
--     md5 17de550a5e69369abf2d446e3853aebc
--   public.app_itwo_set_staff(p_employee_no text, p_is_it_admin boolean, p_is_it_approver boolean)
--     md5 d568ecfc2d7bd525554ecf2822f68fe6

-- 1. สิทธิ์ทีม IT: เพิ่มธง "หัวหน้า IT (ดูอย่างเดียว)" ---------------------------------------------
-- is_it_viewer = เห็นทุกใบ + อ่านประวัติ แต่ไม่ได้ทำงานฝั่ง IT (เริ่ม/ส่งงาน/ถาม/ตั้งค่า) และไม่ได้รับแจ้งเตือน "รอคุณอนุมัติ" ของใบทั่วไป
-- "เห็นทุกใบ" มาจากการมีแถวใน itwo_staff (itwo_is_staff / itrp_is_staff) ไม่เกี่ยวกับธง จึงไม่ต้องแก้ฟังก์ชันมองเห็น
alter table public.itwo_staff add column is_it_viewer boolean not null default false;
alter table public.itwo_staff drop constraint itwo_staff_has_a_role;
alter table public.itwo_staff add constraint itwo_staff_has_a_role check (is_it_admin or is_it_approver or is_it_viewer);
comment on table public.itwo_staff is
  'สิทธิ์ฝั่ง IT ของใบสั่งงาน IT และใบแจ้งซ่อม (itrp อ่านตารางนี้ร่วม): is_it_admin = รับงาน/เริ่ม/ส่งงาน/ถาม/จัดการสิทธิ์ · is_it_approver = ผู้อนุมัติขั้น IT ของใบทั่วไป · is_it_viewer = หัวหน้า IT ดูอย่างเดียว (อนุมัติขั้น IT เฉพาะใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT) · ทุกแถวเห็นทุกใบ · แก้ผ่าน app_itwo_set_staff เท่านั้น';
comment on column public.itwo_staff.is_it_viewer is
  'หัวหน้า IT (ดูอย่างเดียว): เห็นทุกใบ/ประวัติ · อนุมัติขั้น IT ได้เฉพาะใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT (is_it_approver) · ไม่ทำงานฝั่ง IT';

-- 2. ตั้งค่าเวลาทำงานของบริษัท (ใช้คำนวณ "ใช้เวลาทำงานกี่วัน/ชม./นาที") ---------------------------------
-- แถวเดียวทั้งระบบ (id = true เสมอ) ค่าเริ่มต้นตามที่เจ้าของบอก: จันทร์-เสาร์ วันละ 8 ชม. พักเที่ยง 1 ชม.
--   เวลาเข้า-ออกจริงเจ้าของยังไม่ได้ระบุ ตั้งค่าเริ่มต้น 08:00-17:00 พัก 12:00-13:00 (แก้ด้วย SQL ได้ ยังไม่มีหน้าจอ)
-- วันหยุดนักขัตฤกษ์/วันหยุดบริษัทอ่านจาก public.company_holidays (ตารางของระบบเพื่อน admin กรอกเอง · ไม่แก้ตารางนั้น)
create table public.office_work_hours (
  id boolean primary key default true check (id),
  work_start time not null default '08:00',
  work_end time not null default '17:00',
  break_start time not null default '12:00',
  break_end time not null default '13:00',
  -- วันทำงาน 1 = จันทร์ ... 7 = อาทิตย์ (isodow)
  working_isodow smallint[] not null default '{1,2,3,4,5,6}',
  updated_at timestamptz not null default now(),
  constraint office_work_hours_times_ok check (work_start < break_start and break_start <= break_end and break_end < work_end),
  constraint office_work_hours_days_ok check (
    cardinality(working_isodow) between 1 and 7 and working_isodow <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[])
);
comment on table public.office_work_hours is
  'ตั้งค่าเวลาทำงานของบริษัท (แถวเดียว) ใช้คำนวณเวลาทำงานของ IT ในใบสั่งงาน/ใบแจ้งซ่อม · วันหยุดอ่านจาก company_holidays · อ่าน/เขียนผ่านฟังก์ชันภายในเท่านั้น';
insert into public.office_work_hours (id) values (true) on conflict (id) do nothing;

-- ปิดการเข้าถึงตรง (deny-all) แบบเดียวกับตารางของโมดูลใบสั่งงาน: ไม่มี grant ให้ anon/authenticated/service_role
revoke all on public.office_work_hours from public, anon, authenticated, service_role;
alter table public.office_work_hours enable row level security;
create policy office_work_hours_no_direct_access on public.office_work_hours
  for all to authenticated using (false) with check (false);
select private.lab_only_guard_table('public.office_work_hours');
-- ตารางตั้งค่าไม่มี is_test: ติดด่าน sandbox_guard (เขียนไม่ได้ระหว่างอยู่ในโหมดทดสอบ) เหมือน itwo_staff
-- จึงไม่ต้อง replace private.sandbox_unguarded_tables()
select private.sandbox_guard_table('public.office_work_hours');


-- 3. ฟังก์ชันช่วยใหม่: หัวหน้า IT / ผู้อนุมัติขั้น IT ของใบนี้ / ผู้รับแจ้งเตือนขั้น IT ----------------------


-- itwo: หัวหน้า IT (ดูอย่างเดียว)
create or replace function private.itwo_is_it_viewer(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_viewer)
$$;
revoke all on function private.itwo_is_it_viewer(uuid) from public, anon, authenticated;

-- itwo: ผู้ทำรายการเป็น "ผู้อนุมัติขั้น IT" ของใบที่ผู้แจ้งคือ p_requester_id หรือไม่
--   ใบทั่วไป = ผู้อนุมัติขั้น IT (is_it_approver) · ใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) แทน
--   (ผู้อนุมัติขั้น IT อนุมัติใบตัวเองไม่ได้ และไม่อนุมัติใบของผู้อนุมัติด้วยกันเอง · หัวหน้า IT อนุมัติได้เฉพาะใบของผู้อนุมัติขั้น IT)
create or replace function private.itwo_is_it_stage_approver(p_requester_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.itwo_is_it_approver(p_requester_id) then private.itwo_is_it_viewer(p_actor_id)
    else private.itwo_is_it_approver(p_actor_id)
  end
$$;
revoke all on function private.itwo_is_it_stage_approver(uuid, uuid) from public, anon, authenticated;

-- itwo: รายชื่อผู้ที่ต้องได้แจ้งเตือน "รอคุณอนุมัติ" ขั้น IT ของใบนี้ (ใบของผู้อนุมัติขั้น IT เอง -> หัวหน้า IT · ใบอื่น -> ผู้อนุมัติขั้น IT)
create or replace function private.itwo_notify_it_stage_ids(p_wo public.itwo_work_orders)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select s.employee_id
    from public.itwo_staff s
    where case when private.itwo_is_it_approver(p_wo.requester_id) then s.is_it_viewer else s.is_it_approver end
    order by s.employee_id)
$$;
revoke all on function private.itwo_notify_it_stage_ids(public.itwo_work_orders) from public, anon, authenticated;


-- itrp: หัวหน้า IT (ดูอย่างเดียว)
create or replace function private.itrp_is_it_viewer(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_viewer)
$$;
revoke all on function private.itrp_is_it_viewer(uuid) from public, anon, authenticated;

-- itrp: ผู้ทำรายการเป็น "ผู้อนุมัติขั้น IT" ของใบที่ผู้แจ้งคือ p_requester_id หรือไม่
--   ใบทั่วไป = ผู้อนุมัติขั้น IT (is_it_approver) · ใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) แทน
--   (ผู้อนุมัติขั้น IT อนุมัติใบตัวเองไม่ได้ และไม่อนุมัติใบของผู้อนุมัติด้วยกันเอง · หัวหน้า IT อนุมัติได้เฉพาะใบของผู้อนุมัติขั้น IT)
create or replace function private.itrp_is_it_stage_approver(p_requester_id uuid, p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.itrp_is_it_approver(p_requester_id) then private.itrp_is_it_viewer(p_actor_id)
    else private.itrp_is_it_approver(p_actor_id)
  end
$$;
revoke all on function private.itrp_is_it_stage_approver(uuid, uuid) from public, anon, authenticated;

-- itrp: รายชื่อผู้ที่ต้องได้แจ้งเตือน "รอคุณอนุมัติ" ขั้น IT ของใบนี้ (ใบของผู้อนุมัติขั้น IT เอง -> หัวหน้า IT · ใบอื่น -> ผู้อนุมัติขั้น IT)
create or replace function private.itrp_notify_it_stage_ids(p_req public.itrp_requests)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(
    select s.employee_id
    from public.itwo_staff s
    where case when private.itrp_is_it_approver(p_req.requester_id) then s.is_it_viewer else s.is_it_approver end
    order by s.employee_id)
$$;
revoke all on function private.itrp_notify_it_stage_ids(public.itrp_requests) from public, anon, authenticated;


-- 4. สรุปเวลาทำงาน (ใบสั่งงาน + ใบแจ้งซ่อม) ---------------------------------------------------------
-- 4.1 นับวินาทีทำงานระหว่างสองเวลา: เฉพาะวันที่อยู่ใน working_isodow (เวลา Asia/Bangkok) ที่ไม่ใช่วันหยุดใน company_holidays
--     นับเฉพาะช่วง [work_start, break_start) กับ [break_end, work_end) ของแต่ละวัน · ช่วงนอกเวลา/พักเที่ยง/วันหยุด = 0
--     ไม่มีแถวตั้งค่า = ใช้ค่าเริ่มต้น (08:00-17:00 พัก 12:00-13:00 จันทร์-เสาร์)
create or replace function private.office_working_seconds(p_from timestamptz, p_to timestamptz)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.office_work_hours%rowtype;
  v_start time;
  v_end time;
  v_break_start time;
  v_break_end time;
  v_days smallint[];
  v_first date;
  v_last date;
  v_day date;
  v_n integer;
  v_total numeric := 0;
begin
  if p_from is null or p_to is null or p_to <= p_from then
    return 0;
  end if;
  select * into v_cfg from public.office_work_hours limit 1;
  v_start := coalesce(v_cfg.work_start, time '08:00');
  v_end := coalesce(v_cfg.work_end, time '17:00');
  v_break_start := coalesce(v_cfg.break_start, time '12:00');
  v_break_end := coalesce(v_cfg.break_end, time '13:00');
  v_days := coalesce(v_cfg.working_isodow, array[1, 2, 3, 4, 5, 6]::smallint[]);

  v_first := (p_from at time zone 'Asia/Bangkok')::date;
  v_last := (p_to at time zone 'Asia/Bangkok')::date;
  for v_n in 0 .. (v_last - v_first) loop
    v_day := v_first + v_n;
    continue when not (extract(isodow from v_day)::integer::smallint = any (v_days));
    continue when exists (select 1 from public.company_holidays h where h.holiday_date = v_day);
    -- ช่วงเช้า: เข้างาน -> เริ่มพัก · ช่วงบ่าย: เลิกพัก -> เลิกงาน (ทับซ้อนกับ [p_from, p_to) เท่าไร นับเท่านั้น)
    v_total := v_total
      + greatest(0, extract(epoch from (
          least(p_to, ((v_day + v_break_start)::timestamp at time zone 'Asia/Bangkok'))
          - greatest(p_from, ((v_day + v_start)::timestamp at time zone 'Asia/Bangkok'))))::numeric)
      + greatest(0, extract(epoch from (
          least(p_to, ((v_day + v_end)::timestamp at time zone 'Asia/Bangkok'))
          - greatest(p_from, ((v_day + v_break_end)::timestamp at time zone 'Asia/Bangkok'))))::numeric);
  end loop;
  return v_total;
end;
$$;
revoke all on function private.office_working_seconds(timestamptz, timestamptz) from public, anon, authenticated;

-- 4.2 นาทีทำงานระหว่างสองเวลา (ปัดลงเป็นนาทีเต็ม)
create or replace function private.office_working_minutes(p_from timestamptz, p_to timestamptz)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select floor(private.office_working_seconds(p_from, p_to) / 60)::integer
$$;
revoke all on function private.office_working_minutes(timestamptz, timestamptz) from public, anon, authenticated;

-- 4.3 รวมนาทีทำงานของ IT จากประวัติ (เรียงตามลำดับเหตุการณ์จริง) ใช้ร่วมกันทั้ง itwo และ itrp
--   ช่วงงานเปิดเมื่อ started หรือ rework_requested (ผู้แจ้งขอแก้ไข พาใบกลับไปให้ IT) ปิดเมื่อ completed
--   ระหว่างช่วงงานเปิด info_requested -> info_provided (รอผู้แจ้งตอบ) ไม่นับ
--   info_requested/info_provided ที่เกิดนอกช่วงงาน (เช่นผู้จัดการถามก่อนอนุมัติ, IT ถามก่อนกดเริ่ม) ไม่มีผลต่อเวลา
--   รวมทุกช่วงที่ "ปิดแล้ว" (ขอแก้ไขกี่รอบก็รวม) · ช่วงที่ยังเปิดอยู่ (ยังไม่ส่งงาน) ไม่นับ · ยังไม่เคยส่งงานเลย = null
--   สะสมเป็นวินาทีแล้วปัดลงเป็นนาทีครั้งเดียวตอนท้าย (ไม่ปัดทีละช่วง กันเศษหาย)
create or replace function private.office_work_minutes_from_events(p_actions text[], p_times timestamptz[])
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state text := 'closed';   -- closed = นอกช่วงงาน · open = กำลังนับ · paused = อยู่ในช่วงงานแต่รอผู้แจ้งตอบ
  v_from timestamptz;
  v_window numeric := 0;      -- วินาทีของช่วงงานปัจจุบัน (บวกเข้า v_total เมื่อ completed เท่านั้น)
  v_total numeric := 0;
  v_ever_completed boolean := false;
  i integer;
begin
  for i in 1 .. coalesce(cardinality(p_actions), 0) loop
    if p_actions[i] in ('started', 'rework_requested') then
      if v_state = 'closed' then
        v_state := 'open';
        v_from := p_times[i];
        v_window := 0;
      end if;
    elsif p_actions[i] = 'info_requested' then
      if v_state = 'open' then
        v_window := v_window + private.office_working_seconds(v_from, p_times[i]);
        v_state := 'paused';
      end if;
    elsif p_actions[i] = 'info_provided' then
      if v_state = 'paused' then
        v_state := 'open';
        v_from := p_times[i];
      end if;
    elsif p_actions[i] = 'completed' then
      if v_state = 'open' then
        v_window := v_window + private.office_working_seconds(v_from, p_times[i]);
      end if;
      if v_state <> 'closed' then
        v_total := v_total + v_window;
        v_ever_completed := true;
        v_state := 'closed';
        v_window := 0;
      end if;
    end if;
  end loop;
  if not v_ever_completed then
    return null;
  end if;
  return floor(v_total / 60)::integer;
end;
$$;
revoke all on function private.office_work_minutes_from_events(text[], timestamptz[]) from public, anon, authenticated;

-- 4.4 ตัวห่อรายโมดูล (คิดจากประวัติทุกครั้ง ไม่เก็บค่าซ้ำ)
create or replace function private.itwo_work_minutes(p_work_order_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.office_work_minutes_from_events(array_agg(e.action order by e.id), array_agg(e.created_at order by e.id))
  from public.itwo_events e
  where e.work_order_id = p_work_order_id
    and e.action in ('started', 'completed', 'rework_requested', 'info_requested', 'info_provided')
$$;
revoke all on function private.itwo_work_minutes(uuid) from public, anon, authenticated;

create or replace function private.itrp_work_minutes(p_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.office_work_minutes_from_events(array_agg(e.action order by e.id), array_agg(e.created_at order by e.id))
  from public.itrp_events e
  where e.request_id = p_request_id
    and e.action in ('started', 'completed', 'rework_requested', 'info_requested', 'info_provided')
$$;
revoke all on function private.itrp_work_minutes(uuid) from public, anon, authenticated;


-- 5. กติกาผู้อนุมัติขั้น IT: replace ฟังก์ชันเดิม (นิยามตั้งต้นจาก prod 26/11/2026 แก้เฉพาะจุดที่ระบุ) -------------------


-- 5.A itwo ------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.itwo_approval_caps(p_work_order_id uuid, p_actor_id uuid, OUT can_dept boolean, OUT can_it boolean, OUT dept_done boolean, OUT it_done boolean, OUT rejected boolean, OUT dept_is_it boolean, OUT has_dept_approvers boolean, OUT actor_is_dept_role boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_wo public.itwo_work_orders%rowtype;
  v_actor public.employees%rowtype;
  v_is_it_approver boolean;
  v_open boolean;
begin
  can_dept := false;
  can_it := false;
  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id;
  select * into v_actor from public.employees e where e.id = p_actor_id;
  if v_wo.id is null or v_actor.id is null or v_wo.is_test <> v_actor.is_test then
    return;
  end if;

  select s.dept_done, s.it_done, s.rejected into dept_done, it_done, rejected
  from private.itwo_event_state(v_wo.id) s;
  dept_is_it := private.itwo_is_it_department(v_wo.department_id);
  -- ไม่นับผู้แจ้งเอง: ผู้แจ้งอนุมัติใบตัวเองไม่ได้ (ถ้าเป็นผู้จัดการแผนก ขั้นแผนกผ่านอัตโนมัติตอนแจ้งอยู่แล้ว)
  has_dept_approvers := exists (
    select 1 from private.itwo_dept_approvers(v_wo.department_id, v_wo.is_test) a(id) where a.id <> v_wo.requester_id);
  actor_is_dept_role := exists (
    select 1 from private.itwo_dept_approvers(v_wo.department_id, v_wo.is_test) a(id) where a.id = p_actor_id);
  -- ขั้น IT: ใบทั่วไป = ผู้อนุมัติขั้น IT · ใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) อนุมัติแทน
  -- (ชื่อตัวแปรคงเดิม แต่ความหมายคือ "ผู้ทำรายการเป็นผู้อนุมัติขั้น IT ของใบนี้")
  v_is_it_approver := private.itwo_is_it_stage_approver(v_wo.requester_id, p_actor_id);

  -- in_progress อยู่ในรายการเพราะงานด่วนเริ่มทำก่อน แต่ผู้จัดการยังต้องอนุมัติตามหลัง
  -- need_info (รอผู้แจ้งตอบ) อยู่ในรายการเพื่อให้ผู้อนุมัติขั้นที่ยังค้างกด "ไม่อนุมัติ" ได้ · ส่วน "อนุมัติ" ถูกกันที่ private.itwo_decide ให้รอคำตอบก่อน
  v_open := v_wo.requester_id <> p_actor_id
    and v_wo.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$function$;

CREATE OR REPLACE FUNCTION private.itwo_decide(p_work_order_id uuid, p_approve boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itwo_clean(p_reason);
  v_wo public.itwo_work_orders%rowtype;
  v_caps record;
  v_dept_done boolean;
  v_it_done boolean;
  v_new_status text;
begin
  v_actor := private.itwo_actor();

  -- ไม่อนุมัติต้องมีเหตุผล (ตรวจก่อนแตะข้อมูลใบ)
  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' using errcode = 'check_violation';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id = v_actor.id then
    raise exception 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบสั่งงานที่ตัวเองเป็นผู้แจ้งได้' using errcode = 'insufficient_privilege';
  end if;
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info') then
    raise exception '%', private.itwo_status_message(v_wo.status) using errcode = 'check_violation';
  end if;

  select * into v_caps from private.itwo_approval_caps(v_wo.id, v_actor.id);
  if v_caps.rejected then
    raise exception 'ใบสั่งงานนี้ไม่อนุมัติไปแล้ว' using errcode = 'check_violation';
  end if;

  if not v_caps.can_dept and not v_caps.can_it then
    -- บอกเหตุผลให้ตรงที่สุด
    -- ผู้อนุมัติขั้น IT "ของใบนี้" (ใบของผู้อนุมัติขั้น IT เอง = หัวหน้า IT) ไม่ใช่ทุกคนที่มีธง approver
    if private.itwo_is_it_stage_approver(v_wo.requester_id, v_actor.id) then
      if v_caps.it_done then
        raise exception 'ใบสั่งงานนี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว' using errcode = 'check_violation';
      end if;
      raise exception 'ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
    elsif v_caps.actor_is_dept_role and not v_caps.dept_is_it then
      raise exception 'ใบสั่งงานนี้ผู้จัดการแผนกพิจารณาไปแล้ว' using errcode = 'check_violation';
    end if;
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้' using errcode = 'insufficient_privilege';
  end if;

  -- รอผู้แจ้งตอบคำถามอยู่: ทั้งอนุมัติและไม่อนุมัติไม่ได้จนกว่าจะมีคำตอบ (รุ่น 1.02 · รุ่น 3 ยังให้ไม่อนุมัติได้)
  -- ตรวจหลังตรวจสิทธิ์ เพื่อให้คนที่ไม่มีสิทธิ์ได้ข้อความสิทธิ์ตามเดิม
  if v_wo.status = 'need_info' then
    if p_approve then
      raise exception 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้' using errcode = 'check_violation';
    end if;
    raise exception 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน' using errcode = 'check_violation';
  end if;

  v_dept_done := v_caps.dept_done;
  v_it_done := v_caps.it_done;

  if p_approve then
    if v_caps.can_it then
      -- ผู้อนุมัติขั้น IT: ถ้าขั้นแผนกยังไม่ผ่านและไม่ต้องรอใคร กดครั้งเดียวบันทึกทั้งสองขั้นในชื่อเขา
      if not v_dept_done then
        insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
        values (v_wo.is_test, v_wo.id, v_actor.id, 'dept_approved',
          case
            when v_caps.dept_is_it then 'ผู้แจ้งอยู่แผนก IT ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            when v_caps.actor_is_dept_role then 'ผู้อนุมัติเป็นผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้แจ้งและเป็นผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            else 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
          end);
        v_dept_done := true;
      end if;
      insert into public.itwo_events (is_test, work_order_id, actor_id, action)
      values (v_wo.is_test, v_wo.id, v_actor.id, 'it_mgr_approved');
      v_it_done := true;
    else
      insert into public.itwo_events (is_test, work_order_id, actor_id, action)
      values (v_wo.is_test, v_wo.id, v_actor.id, 'dept_approved');
      v_dept_done := true;
    end if;
  else
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_wo.is_test, v_wo.id, v_actor.id,
            case when v_caps.can_it then 'it_mgr_rejected' else 'dept_rejected' end, v_reason);
  end if;

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที (รวมงานด่วนที่ IT เริ่มทำแล้ว) · อนุมัติ = เลื่อนเฉพาะใบที่ยังรออนุมัติ
  -- (ใบที่เดินหน้าไปแล้ว in_progress บันทึก event อย่างเดียว ไม่ดึงสถานะถอยกลับ)
  if not p_approve then
    v_new_status := 'rejected';
  elsif v_wo.status in ('pending_dept', 'pending_it_mgr') then
    v_new_status := case
      when v_dept_done and v_it_done then 'approved'
      when v_dept_done then 'pending_it_mgr'
      else v_wo.status
    end;
  else
    v_new_status := v_wo.status;
  end if;
  if v_new_status is distinct from v_wo.status then
    -- info_return_status ต้องเคลียร์คู่กับสถานะที่ออกจาก need_info (CHECK + guard บังคับ)
    update public.itwo_work_orders set status = v_new_status, info_return_status = null where id = v_wo.id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itwo_create(p_request_type text, p_order_ref text, p_attachment_flag text, p_attachment_note text, p_details text, p_needed_date date, p_is_urgent boolean, p_misc_detail text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, doc_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_dept public.departments%rowtype;
  v_details text := private.itwo_clean(p_details);
  v_order_ref text := private.itwo_clean(p_order_ref);
  v_attach_note text := private.itwo_clean(p_attachment_note);
  v_misc_detail text := private.itwo_clean(p_misc_detail);
  v_is_urgent boolean := coalesce(p_is_urgent, false);
  v_today_th date := (now() at time zone 'Asia/Bangkok')::date;
  v_is_it_approver boolean;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_work_order_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_dept from public.departments d where d.id = v_actor.department_id;
  if v_dept.id is null or not v_dept.is_active then
    raise exception 'แผนกของคุณยังไม่ได้ตั้งค่าหรือถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  -- ตรวจข้อมูลที่กรอก (ข้อความภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ)
  if p_request_type is null or p_request_type not in ('design', 'system_access', 'misc') then
    raise exception 'กรุณาเลือกประเภทคำขอ' using errcode = 'check_violation';
  end if;
  if p_request_type = 'system_access' then
    raise exception 'ใบสั่งงาน IT ไม่รับประเภท "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)' using errcode = 'check_violation';
  end if;
  if p_request_type = 'misc' then
    if v_misc_detail is null then
      raise exception 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร' using errcode = 'check_violation';
    end if;
    if char_length(v_misc_detail) > 200 then
      raise exception 'งานเบ็ดเตล็ดต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- ประเภทอื่นไม่เก็บ ล้างทิ้งกันข้อมูลตกค้าง
    v_misc_detail := null;
  end if;
  if p_attachment_flag is null or p_attachment_flag not in ('yes', 'no', 'other') then
    raise exception 'กรุณาเลือกเอกสารแนบ (มี / ไม่มี / อื่นๆ)' using errcode = 'check_violation';
  end if;
  if v_details is null then
    raise exception 'กรุณากรอกรายละเอียดงาน' using errcode = 'check_violation';
  end if;
  if char_length(v_details) > 2000 then
    raise exception 'รายละเอียดงานต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_order_ref is not null and char_length(v_order_ref) > 100 then
    raise exception 'เลขที่ออเดอร์ต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_attachment_flag = 'other' then
    if v_attach_note is null then
      raise exception 'กรุณาระบุรายละเอียดเอกสารแนบ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_attach_note) > 200 then
      raise exception 'รายละเอียดเอกสารแนบต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- มี / ไม่มี ไม่ต้องมีหมายเหตุ ล้างทิ้งกันข้อมูลตกค้าง
    v_attach_note := null;
  end if;
  if p_needed_date is null then
    raise exception 'กรุณาระบุวันที่ต้องการงาน' using errcode = 'check_violation';
  end if;
  -- เทียบกับ "วันนี้ตามเวลาไทย" ไม่ใช่ UTC (วันนี้เลือกได้ แต่ย้อนหลังไม่ได้)
  if p_needed_date < v_today_th then
    raise exception 'วันที่ต้องการงานต้องไม่ใช่วันที่ผ่านมาแล้ว' using errcode = 'check_violation';
  end if;

  -- เลือกเส้นทางอนุมัติ
  v_is_it_approver := private.itwo_is_it_approver(v_actor.id);
  v_dept_is_it := private.itwo_is_it_department(v_dept.id);
  v_actor_is_dept_role := private.itwo_is_dept_approver(v_actor.id, v_dept.id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itwo_dept_approvers(v_dept.id, v_actor.is_test) a(id) where a.id <> v_actor.id);

  -- ผู้อนุมัติขั้น IT แจ้งเอง (กติกาใหม่ 26/11/2026): ไม่อนุมัติในตัวเองอีกต่อไป ใบวิ่งตามเส้นทางปกติ
  -- (แผนก IT / แผนกไม่มีผู้จัดการ -> รอขั้น IT ครั้งเดียวนับสองขั้น) แต่ขั้น IT ผู้อนุมัติเป็น "หัวหน้า IT" (is_it_viewer) แทน
  -- ถ้าตอนนี้ไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ผ่านอัตโนมัติ) และไม่ปฏิเสธการแจ้ง
  if not v_is_it_approver then
    -- ต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ ไม่เช่นนั้นใบจะค้างโดยไม่มีใครอนุมัติได้
    if not private.itwo_has_active_it_approver(v_actor.is_test) then
      raise exception 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT' using errcode = 'check_violation';
    end if;
  end if;
  if v_dept_is_it then
    -- ผู้แจ้งอยู่แผนก IT: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น (บันทึกตอนอนุมัติ)
    v_status := 'pending_it_mgr';
  elsif v_actor_is_dept_role then
    -- ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยของแผนกตัวเอง: ข้ามขั้นแผนก (บันทึก dept_approved ด้านล่าง)
    v_status := 'pending_it_mgr';
  elsif not v_has_dept_approvers then
    -- แผนกไม่มีผู้จัดการ/ผู้ช่วย: ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
    v_status := 'pending_it_mgr';
  else
    v_status := 'pending_dept';
  end if;

  -- เลขที่เอกสาร: ล็อกแถวตัวนับของปีนั้นจนจบ transaction จึงไม่ซ้ำแม้กดพร้อมกัน
  select n.year_ce, n.seq_no, n.doc_no
    into v_doc_year, v_doc_seq, v_doc_no
  from private.itwo_next_doc_no(v_actor.is_test) n;

  insert into public.itwo_work_orders as wo (
    is_test, doc_no, doc_year, doc_seq, requester_id, department_id,
    request_type, misc_detail, order_ref, attachment_flag, attachment_note, details, needed_date, is_urgent, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    p_request_type, v_misc_detail, v_order_ref, p_attachment_flag, v_attach_note, v_details, p_needed_date, v_is_urgent, v_status
  ) returning wo.id into v_work_order_id;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved / it_mgr_approved)
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_work_order_id, v_actor.id, 'created',
    case when not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
    values (v_actor.is_test, v_work_order_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งงาน');
  end if;

  id := v_work_order_id;
  doc_no := v_doc_no;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION private.itwo_notify_stage_approver_ids(p_wo itwo_work_orders)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  return private.itwo_notify_it_stage_ids(p_wo);
end;
$function$;

CREATE OR REPLACE FUNCTION private.itwo_notify_on_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
      -- ปลายทางแรกของใบ: รอขั้นแผนก -> ผู้อนุมัติแผนก · รอขั้น IT ทันที -> ผู้อนุมัติขั้น IT (ใบของผู้อนุมัติขั้น IT เอง -> หัวหน้า IT)
      -- ตั้งแต่ 26/11/2026 ไม่มีใบที่อนุมัติครบตั้งแต่แจ้งอีกแล้ว (v_ids ว่างเฉพาะกรณีไม่มีผู้รับ)
      if v_wo.status = 'pending_dept' then
        v_ids := private.itwo_notify_dept_approver_ids(v_wo);
      elsif v_wo.status = 'pending_it_mgr' then
        v_ids := private.itwo_notify_it_stage_ids(v_wo);
      else
        v_ids := '{}';
      end if;
      v_done := private.itwo_notify_each(v_ids, v_done, new.actor_id, v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      -- งานด่วน: IT เริ่มทำได้ก่อนอนุมัติครบ จึงแจ้งผู้ดูแลงาน IT ทุกคนทันที (ผู้ดูแลที่เป็นผู้อนุมัติด้วยได้ข้อความรออนุมัติด้านบนแล้ว ไม่ซ้ำ)
      -- (ใบของผู้อนุมัติขั้น IT เองเคยอนุมัติครบตั้งแต่แจ้งจึงไม่เข้ากิ่งนี้ · ตั้งแต่ 26/11/2026 ใบเหล่านั้นรอหัวหน้า IT และเข้ากิ่งนี้ตามปกติเมื่อเป็นงานด่วน)
      if v_wo.is_urgent and v_wo.status in ('pending_dept', 'pending_it_mgr') then
        v_done := private.itwo_notify_each(private.itwo_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' แจ้งงานด่วน เริ่มทำได้ก่อนอนุมัติครบ', v_summary, v_url);
      end if;

    elsif new.action = 'dept_approved' then
      -- ข้ามเมื่ออนุมัติในตัว (ผู้แจ้งเอง) หรือผู้กดเป็นผู้อนุมัติขั้น IT (it_mgr_approved ตามมาในธุรกรรมเดียวกันเสมอ)
      -- (ผู้ที่เป็นผู้อนุมัติขั้น IT "ของใบนี้" กดแล้ว it_mgr_approved ตามมา · ใบของผู้อนุมัติขั้น IT เอง ขั้น IT คือหัวหน้า IT)
      if new.actor_id <> v_wo.requester_id and not private.itwo_is_it_stage_approver(v_wo.requester_id, new.actor_id) then
        v_done := private.itwo_notify_each(private.itwo_notify_it_stage_ids(v_wo), v_done, new.actor_id,
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
$function$;

CREATE OR REPLACE FUNCTION public.app_itwo_my_role()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  return jsonb_build_object(
    'employee_id', v_actor.id,
    'employee_no', v_actor.employee_no,
    'full_name', v_actor.first_name || ' ' || v_actor.last_name,
    'is_test', v_actor.is_test,
    'department', (select jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th)
                   from public.departments d where d.id = v_actor.department_id),
    'is_it_department', private.itwo_is_it_department(v_actor.department_id),
    'is_dept_approver', private.itwo_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test),
    'is_it_admin', private.itwo_is_it_admin(v_actor.id),
    'is_it_approver', private.itwo_is_it_approver(v_actor.id),
    'is_it_viewer', private.itwo_is_it_viewer(v_actor.id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itwo_get_detail(p_work_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_wo public.itwo_work_orders%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id;
  if v_wo.id is null or not private.itwo_can_view(v_wo, v_actor) then
    raise exception 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_wo.id,
    'is_test', v_wo.is_test,
    'doc_no', v_wo.doc_no,
    'doc_year', v_wo.doc_year,
    'doc_seq', v_wo.doc_seq,
    'requester_id', v_wo.requester_id,
    'department_id', v_wo.department_id,
    'request_type', v_wo.request_type,
    'misc_detail', v_wo.misc_detail,
    'order_ref', v_wo.order_ref,
    'attachment_flag', v_wo.attachment_flag,
    'attachment_note', v_wo.attachment_note,
    'details', v_wo.details,
    'needed_date', v_wo.needed_date,
    'is_urgent', v_wo.is_urgent,
    'status', v_wo.status,
    'info_return_status', v_wo.info_return_status,
    'created_at', v_wo.created_at,
    'rework_round', (select coalesce(max(r.round_no), 0) from public.itwo_reworks r where r.work_order_id = v_wo.id),
    'latest_due_date', coalesce(
      (select r.due_date from public.itwo_reworks r where r.work_order_id = v_wo.id order by r.round_no desc limit 1),
      v_wo.needed_date),
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_wo.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_wo.department_id),
    -- ประวัติ ISO เรียงตาม id (identity = ลำดับเหตุการณ์จริง) พร้อมชื่อผู้ทำ
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ev.id,
               'action', ev.action,
               'reason', ev.reason,
               'created_at', ev.created_at,
               'actor_employee_no', a.employee_no,
               'actor_full_name', a.first_name || ' ' || a.last_name
             ) order by ev.id), '[]'::jsonb)
      from public.itwo_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.work_order_id = v_wo.id),
    'access_changes', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ac.id,
               'system', ac.system,
               'action', ac.action,
               'new_username', ac.new_username,
               'old_username', ac.old_username,
               'note', ac.note
             ) order by ac.line_no, ac.id), '[]'::jsonb)
      from public.itwo_access_changes ac
      where ac.work_order_id = v_wo.id),
    'reworks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rw.id,
               'round_no', rw.round_no,
               'details', rw.details,
               'due_date', rw.due_date,
               'created_at', rw.created_at,
               'requested_by_employee_no', a.employee_no,
               'requested_by_full_name', a.first_name || ' ' || a.last_name
             ) order by rw.round_no), '[]'::jsonb)
      from public.itwo_reworks rw
      join public.employees a on a.id = rw.requested_by
      where rw.work_order_id = v_wo.id),
    -- ไฟล์ตอนแจ้ง/รอบแก้ไข (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments)
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'rework_id', att.rework_id,
               'round_no', coalesce(rw.round_no, 0),
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itwo-test-files' else 'itwo-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by coalesce(rw.round_no, 0), att.created_at, att.id), '[]'::jsonb)
      from public.itwo_attachments att
      join public.employees a on a.id = att.uploaded_by
      left join public.itwo_reworks rw on rw.id = att.rework_id
      where att.work_order_id = v_wo.id and att.comment_id is null),
    -- ถามตอบ (ทุกคนที่เห็นใบเห็นครบ) เรียงตามลำดับจริง (id)
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'stage', c.stage,
               'body', c.body,
               'reply_to', c.reply_to,
               'created_at', c.created_at,
               'author_employee_no', a.employee_no,
               'author_full_name', a.first_name || ' ' || a.last_name,
               'attachments', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', att.id,
                          'storage_path', att.storage_path,
                          'bucket', case when att.is_test then 'itwo-test-files' else 'itwo-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itwo_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itwo_comments c
      join public.employees a on a.id = c.author_id
      where c.work_order_id = v_wo.id),
    -- คำถามที่ค้างอยู่ (เฉพาะตอนใบ need_info) ไม่มี = null
    'info_pending', case when v_wo.status = 'need_info' then (
      select jsonb_build_object(
               'comment_id', q.id,
               'stage', q.stage,
               'body', q.body,
               'asked_at', q.created_at,
               'asked_by_employee_no', a.employee_no,
               'asked_by_full_name', a.first_name || ' ' || a.last_name)
      from public.itwo_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itwo_pending_question(v_wo.id)).id) end,
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itwo_events ev join public.employees a on a.id = ev.actor_id
        where ev.work_order_id = v_wo.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itwo_events ev join public.employees a on a.id = ev.actor_id
        where ev.work_order_id = v_wo.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    -- นาทีทำงานของ IT (เวลาทำงานเท่านั้น หักช่วงรอผู้แจ้งตอบ) · null = IT ยังไม่เคยส่งงาน
    'work_minutes', private.itwo_work_minutes(v_wo.id),
    'allowed_actions', to_jsonb(private.itwo_allowed_actions(v_wo, v_actor))
  );
end;
$function$;


-- 5.B itrp ------------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.itrp_approval_caps(p_request_id uuid, p_actor_id uuid, OUT can_dept boolean, OUT can_it boolean, OUT dept_done boolean, OUT it_done boolean, OUT rejected boolean, OUT dept_is_it boolean, OUT has_dept_approvers boolean, OUT actor_is_dept_role boolean)
 RETURNS record
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_req public.itrp_requests%rowtype;
  v_actor public.employees%rowtype;
  v_is_it_approver boolean;
  v_open boolean;
begin
  can_dept := false;
  can_it := false;
  select * into v_req from public.itrp_requests w where w.id = p_request_id;
  select * into v_actor from public.employees e where e.id = p_actor_id;
  if v_req.id is null or v_actor.id is null or v_req.is_test <> v_actor.is_test then
    return;
  end if;

  select s.dept_done, s.it_done, s.rejected into dept_done, it_done, rejected
  from private.itrp_event_state(v_req.id) s;
  dept_is_it := private.itrp_is_it_department(v_req.department_id);
  -- ไม่นับผู้แจ้งเอง: ผู้แจ้งอนุมัติใบตัวเองไม่ได้ (ถ้าเป็นผู้จัดการแผนก ขั้นแผนกผ่านอัตโนมัติตอนแจ้งอยู่แล้ว)
  has_dept_approvers := exists (
    select 1 from private.itrp_dept_approvers(v_req.department_id, v_req.is_test) a(id) where a.id <> v_req.requester_id);
  actor_is_dept_role := exists (
    select 1 from private.itrp_dept_approvers(v_req.department_id, v_req.is_test) a(id) where a.id = p_actor_id);
  -- ขั้น IT: ใบทั่วไป = ผู้อนุมัติขั้น IT · ใบที่ผู้แจ้งเป็นผู้อนุมัติขั้น IT เอง = หัวหน้า IT (is_it_viewer) อนุมัติแทน
  -- (ชื่อตัวแปรคงเดิม แต่ความหมายคือ "ผู้ทำรายการเป็นผู้อนุมัติขั้น IT ของใบนี้")
  v_is_it_approver := private.itrp_is_it_stage_approver(v_req.requester_id, p_actor_id);

  -- in_progress อยู่ในรายการเพราะงานด่วนเริ่มทำก่อน แต่ผู้จัดการยังต้องอนุมัติตามหลัง
  -- need_info (รอผู้แจ้งตอบ) อยู่ในรายการเพื่อให้ผู้อนุมัติขั้นที่ยังค้างกด "ไม่อนุมัติ" ได้ · ส่วน "อนุมัติ" ถูกกันที่ private.itrp_decide ให้รอคำตอบก่อน
  v_open := v_req.requester_id <> p_actor_id
    and v_req.status in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info')
    and not rejected;

  can_dept := v_open and not dept_is_it and actor_is_dept_role and not dept_done;
  can_it := v_open and v_is_it_approver and not it_done
    and (dept_done or dept_is_it or not has_dept_approvers or actor_is_dept_role);
end;
$function$;

CREATE OR REPLACE FUNCTION private.itrp_decide(p_request_id uuid, p_approve boolean, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itrp_clean(p_reason);
  v_req public.itrp_requests%rowtype;
  v_caps record;
  v_dept_done boolean;
  v_it_done boolean;
  v_new_status text;
begin
  v_actor := private.itrp_actor();

  -- ไม่อนุมัติต้องมีเหตุผล (ตรวจก่อนแตะข้อมูลใบ)
  if not coalesce(p_approve, false) then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' using errcode = 'check_violation';
    end if;
    if char_length(v_reason) > 500 then
      raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
    end if;
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.requester_id = v_actor.id then
    raise exception 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบแจ้งซ่อมที่ตัวเองเป็นผู้แจ้งได้' using errcode = 'insufficient_privilege';
  end if;
  if v_req.status not in ('pending_dept', 'pending_it_mgr', 'in_progress', 'need_info') then
    raise exception '%', private.itrp_status_message(v_req.status) using errcode = 'check_violation';
  end if;

  select * into v_caps from private.itrp_approval_caps(v_req.id, v_actor.id);
  if v_caps.rejected then
    raise exception 'ใบแจ้งซ่อมนี้ไม่อนุมัติไปแล้ว' using errcode = 'check_violation';
  end if;

  if not v_caps.can_dept and not v_caps.can_it then
    -- บอกเหตุผลให้ตรงที่สุด
    -- ผู้อนุมัติขั้น IT "ของใบนี้" (ใบของผู้อนุมัติขั้น IT เอง = หัวหน้า IT) ไม่ใช่ทุกคนที่มีธง approver
    if private.itrp_is_it_stage_approver(v_req.requester_id, v_actor.id) then
      if v_caps.it_done then
        raise exception 'ใบแจ้งซ่อมนี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว' using errcode = 'check_violation';
      end if;
      raise exception 'ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
    elsif v_caps.actor_is_dept_role and not v_caps.dept_is_it then
      raise exception 'ใบแจ้งซ่อมนี้ผู้จัดการแผนกพิจารณาไปแล้ว' using errcode = 'check_violation';
    end if;
    raise exception 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้' using errcode = 'insufficient_privilege';
  end if;

  -- รอผู้แจ้งตอบคำถามอยู่: ทั้งอนุมัติและไม่อนุมัติไม่ได้จนกว่าจะมีคำตอบ (รุ่น 1.02 · รุ่น 3 ยังให้ไม่อนุมัติได้)
  -- ตรวจหลังตรวจสิทธิ์ เพื่อให้คนที่ไม่มีสิทธิ์ได้ข้อความสิทธิ์ตามเดิม
  if v_req.status = 'need_info' then
    if p_approve then
      raise exception 'ใบแจ้งซ่อมนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้' using errcode = 'check_violation';
    end if;
    raise exception 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน' using errcode = 'check_violation';
  end if;

  v_dept_done := v_caps.dept_done;
  v_it_done := v_caps.it_done;

  if p_approve then
    if v_caps.can_it then
      -- ผู้อนุมัติขั้น IT: ถ้าขั้นแผนกยังไม่ผ่านและไม่ต้องรอใคร กดครั้งเดียวบันทึกทั้งสองขั้นในชื่อเขา
      if not v_dept_done then
        insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
        values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved',
          case
            when v_caps.dept_is_it then 'ผู้แจ้งอยู่แผนก IT ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            when v_caps.actor_is_dept_role then 'ผู้อนุมัติเป็นผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกผู้แจ้งและเป็นผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
            else 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
          end);
        v_dept_done := true;
      end if;
      insert into public.itrp_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'it_mgr_approved');
      v_it_done := true;
    else
      insert into public.itrp_events (is_test, request_id, actor_id, action)
      values (v_req.is_test, v_req.id, v_actor.id, 'dept_approved');
      v_dept_done := true;
    end if;
  else
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_req.is_test, v_req.id, v_actor.id,
            case when v_caps.can_it then 'it_mgr_rejected' else 'dept_rejected' end, v_reason);
  end if;

  -- เปลี่ยนสถานะ: ไม่อนุมัติ = จบทันที (รวมงานด่วนที่ IT เริ่มทำแล้ว) · อนุมัติ = เลื่อนเฉพาะใบที่ยังรออนุมัติ
  -- (ใบที่เดินหน้าไปแล้ว in_progress บันทึก event อย่างเดียว ไม่ดึงสถานะถอยกลับ)
  if not p_approve then
    v_new_status := 'rejected';
  elsif v_req.status in ('pending_dept', 'pending_it_mgr') then
    v_new_status := case
      when v_dept_done and v_it_done then 'approved'
      when v_dept_done then 'pending_it_mgr'
      else v_req.status
    end;
  else
    v_new_status := v_req.status;
  end if;
  if v_new_status is distinct from v_req.status then
    -- info_return_status ต้องเคลียร์คู่กับสถานะที่ออกจาก need_info (CHECK + guard บังคับ)
    update public.itrp_requests set status = v_new_status, info_return_status = null where id = v_req.id;
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itrp_create(p_asset_code text, p_device_name text, p_request_kind text, p_request_kind_note text, p_repair_target text, p_repair_target_note text, p_symptom text, p_is_urgent boolean DEFAULT false)
 RETURNS TABLE(id uuid, doc_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_dept public.departments%rowtype;
  v_asset_code text := private.itrp_clean(p_asset_code);
  v_device_name text := private.itrp_clean(p_device_name);
  v_kind_note text := private.itrp_clean(p_request_kind_note);
  v_target_note text := private.itrp_clean(p_repair_target_note);
  v_symptom text := private.itrp_clean(p_symptom);
  v_is_urgent boolean := coalesce(p_is_urgent, false);
  v_is_it_approver boolean;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_request_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_dept from public.departments d where d.id = v_actor.department_id;
  if v_dept.id is null or not v_dept.is_active then
    raise exception 'แผนกของคุณยังไม่ได้ตั้งค่าหรือถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  -- ตรวจข้อมูลที่กรอก ตามลำดับช่องในฟอร์ม (ข้อความภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ)
  if v_asset_code is not null and char_length(v_asset_code) > 50 then
    raise exception 'รหัสเครื่องคอมพิวเตอร์ต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_device_name is null then
    raise exception 'กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์' using errcode = 'check_violation';
  end if;
  if char_length(v_device_name) > 200 then
    raise exception 'ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_request_kind is null or p_request_kind not in ('repair', 'replace_part', 'inspect', 'install', 'other') then
    raise exception 'กรุณาเลือกประเภทคำขอ' using errcode = 'check_violation';
  end if;
  if p_request_kind = 'other' then
    if v_kind_note is null then
      raise exception 'กรุณาระบุประเภทคำขอ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_kind_note) > 200 then
      raise exception 'ประเภทคำขอ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- ประเภทอื่นไม่เก็บข้อความระบุ ล้างทิ้งกันข้อมูลตกค้าง
    v_kind_note := null;
  end if;
  if p_repair_target is null or p_repair_target not in ('computer', 'device', 'other') then
    raise exception 'กรุณาเลือกประเภทงานซ่อม' using errcode = 'check_violation';
  end if;
  if p_repair_target = 'other' then
    if v_target_note is null then
      raise exception 'กรุณาระบุประเภทงานซ่อม (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_target_note) > 200 then
      raise exception 'ประเภทงานซ่อม (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    v_target_note := null;
  end if;
  if v_symptom is null then
    raise exception 'กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น' using errcode = 'check_violation';
  end if;
  if char_length(v_symptom) > 2000 then
    raise exception 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- เลือกเส้นทางอนุมัติ (กติกาเดียวกับ itwo)
  v_is_it_approver := private.itrp_is_it_approver(v_actor.id);
  v_dept_is_it := private.itrp_is_it_department(v_dept.id);
  v_actor_is_dept_role := private.itrp_is_dept_approver(v_actor.id, v_dept.id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itrp_dept_approvers(v_dept.id, v_actor.is_test) a(id) where a.id <> v_actor.id);

  -- ผู้อนุมัติขั้น IT แจ้งเอง (กติกาใหม่ 26/11/2026): ไม่อนุมัติในตัวเองอีกต่อไป ใบวิ่งตามเส้นทางปกติ
  -- (แผนก IT / แผนกไม่มีผู้จัดการ -> รอขั้น IT ครั้งเดียวนับสองขั้น) แต่ขั้น IT ผู้อนุมัติเป็น "หัวหน้า IT" (is_it_viewer) แทน
  -- ถ้าตอนนี้ไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ผ่านอัตโนมัติ) และไม่ปฏิเสธการแจ้ง
  if not v_is_it_approver then
    -- ต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ ไม่เช่นนั้นใบจะค้างโดยไม่มีใครอนุมัติได้
    if not private.itrp_has_active_it_approver(v_actor.is_test) then
      raise exception 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT' using errcode = 'check_violation';
    end if;
  end if;
  if v_dept_is_it then
    -- ผู้แจ้งอยู่แผนก IT: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น (บันทึกตอนอนุมัติ)
    v_status := 'pending_it_mgr';
  elsif v_actor_is_dept_role then
    -- ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยของแผนกตัวเอง: ข้ามขั้นแผนก (บันทึก dept_approved ด้านล่าง)
    v_status := 'pending_it_mgr';
  elsif not v_has_dept_approvers then
    -- แผนกไม่มีผู้จัดการ/ผู้ช่วย: ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
    v_status := 'pending_it_mgr';
  else
    v_status := 'pending_dept';
  end if;

  -- เลขที่เอกสาร: ล็อกแถวตัวนับของปีนั้นจนจบ transaction จึงไม่ซ้ำแม้กดพร้อมกัน
  select n.year_ce, n.seq_no, n.doc_no
    into v_doc_year, v_doc_seq, v_doc_no
  from private.itrp_next_doc_no(v_actor.is_test) n;

  insert into public.itrp_requests as rq (
    is_test, doc_no, doc_year, doc_seq, requester_id, department_id,
    asset_code, device_name, request_kind, request_kind_note, repair_target, repair_target_note, symptom, is_urgent, status
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    v_asset_code, v_device_name, p_request_kind, v_kind_note, p_repair_target, v_target_note, v_symptom, v_is_urgent, v_status
  ) returning rq.id into v_request_id;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved / it_mgr_approved)
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_request_id, v_actor.id, 'created',
    case when not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งซ่อม');
  end if;

  id := v_request_id;
  doc_no := v_doc_no;
  return next;
end;
$function$;

CREATE OR REPLACE FUNCTION private.itrp_notify_stage_approver_ids(p_req itrp_requests)
 RETURNS uuid[]
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_dept_done boolean;
  v_it_done boolean;
  v_dept_ids uuid[];
begin
  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(p_req.id) s;
  if v_dept_done and v_it_done then
    return '{}';
  end if;
  if not v_dept_done and not private.itrp_is_it_department(p_req.department_id) then
    v_dept_ids := private.itrp_notify_dept_approver_ids(p_req);
    if cardinality(v_dept_ids) > 0 then
      return v_dept_ids;
    end if;
  end if;
  return private.itrp_notify_it_stage_ids(p_req);
end;
$function$;

CREATE OR REPLACE FUNCTION private.itrp_notify_on_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_req public.itrp_requests%rowtype;
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
  v_question public.itrp_comments%rowtype;
  v_answer public.itrp_comments%rowtype;
  v_rework public.itrp_reworks%rowtype;
begin
  -- ใบทดสอบ ไม่ insert เลย · started / received ไม่แจ้ง (เหมือน itwo)
  if new.is_test or new.action in ('started', 'received') then
    return new;
  end if;

  begin
    select * into v_req from public.itrp_requests w where w.id = new.request_id;
    if v_req.id is null or v_req.is_test then
      return new;
    end if;

    select e.first_name || ' ' || e.last_name into v_requester_name from public.employees e where e.id = v_req.requester_id;
    select e.first_name || ' ' || e.last_name into v_actor_name from public.employees e where e.id = new.actor_id;
    select d.name_th into v_dept_name from public.departments d where d.id = v_req.department_id;
    -- "<ชื่อเครื่อง> · <ประเภทคำขอ>" และสรุป "<ชื่อผู้แจ้ง> · <แผนก> · <ชื่อเครื่อง> · <ประเภทคำขอ>"
    v_type_text := concat_ws(' · ', v_req.device_name, private.itrp_request_kind_text(v_req.request_kind, v_req.request_kind_note));
    v_summary := concat_ws(' · ', v_requester_name, v_dept_name, v_type_text);
    -- ใบด่วนขึ้นหัวทุกข้อความด้วย "🚨 [ด่วน] " (ครั้งเดียว: notify-email เห็นแล้วตัดออกก่อนใส่ซ้ำที่หัวอีเมล)
    v_prefix := case when v_req.is_urgent then '🚨 [ด่วน] ' else '' end;
    v_title := v_prefix || 'ใบแจ้งซ่อม ' || v_req.doc_no;
    v_url := '/office/repair/' || v_req.id::text;

    if new.action = 'created' then
      -- ปลายทางแรกของใบ: รอขั้นแผนก -> ผู้อนุมัติแผนก · รอขั้น IT ทันที -> ผู้อนุมัติขั้น IT (ใบของผู้อนุมัติขั้น IT เอง -> หัวหน้า IT)
      -- ตั้งแต่ 26/11/2026 ไม่มีใบที่อนุมัติครบตั้งแต่แจ้งอีกแล้ว (v_ids ว่างเฉพาะกรณีไม่มีผู้รับ)
      if v_req.status = 'pending_dept' then
        v_ids := private.itrp_notify_dept_approver_ids(v_req);
      elsif v_req.status = 'pending_it_mgr' then
        v_ids := private.itrp_notify_it_stage_ids(v_req);
      else
        v_ids := '{}';
      end if;
      v_done := private.itrp_notify_each(v_ids, v_done, new.actor_id, v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      -- งานด่วน: IT เริ่มทำได้ก่อนอนุมัติครบ จึงแจ้งผู้ดูแลงาน IT ทุกคนทันที (ผู้ดูแลที่เป็นผู้อนุมัติด้วยได้ข้อความรออนุมัติด้านบนแล้ว ไม่ซ้ำ)
      -- (ใบของผู้อนุมัติขั้น IT เองเคยอนุมัติครบตั้งแต่แจ้งจึงไม่เข้ากิ่งนี้ · ตั้งแต่ 26/11/2026 ใบเหล่านั้นรอหัวหน้า IT และเข้ากิ่งนี้ตามปกติเมื่อเป็นงานด่วน)
      if v_req.is_urgent and v_req.status in ('pending_dept', 'pending_it_mgr') then
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' แจ้งซ่อมด่วน เริ่มทำได้ก่อนอนุมัติครบ', v_summary, v_url);
      end if;

    elsif new.action = 'dept_approved' then
      -- ข้ามเมื่ออนุมัติในตัว (ผู้แจ้งเอง) หรือผู้กดเป็นผู้อนุมัติขั้น IT (it_mgr_approved ตามมาในธุรกรรมเดียวกันเสมอ)
      -- (ผู้ที่เป็นผู้อนุมัติขั้น IT "ของใบนี้" กดแล้ว it_mgr_approved ตามมา · ใบของผู้อนุมัติขั้น IT เอง ขั้น IT คือหัวหน้า IT)
      if new.actor_id <> v_req.requester_id and not private.itrp_is_it_stage_approver(v_req.requester_id, new.actor_id) then
        v_done := private.itrp_notify_each(private.itrp_notify_it_stage_ids(v_req), v_done, new.actor_id,
                                           v_title || ' รอคุณอนุมัติ', v_summary, v_url);
      end if;

    elsif new.action = 'it_mgr_approved' then
      -- อนุมัติครบ: ผู้แจ้งก่อน (ถ้าผู้แจ้งเป็นผู้ดูแลงาน IT ด้วยก็ได้ข้อความนี้ข้อความเดียว) แล้วผู้ดูแลงาน IT
      -- ใบที่ IT เริ่มงานไปแล้ว (งานด่วนที่ทำก่อนอนุมัติครบ) ข้อความต้องไม่บอกว่า "รอ IT ดำเนินการ/รับงาน"
      select exists (select 1 from public.itrp_events e where e.request_id = v_req.id and e.action = 'started') into v_started;
      if v_started then
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'IT กำลังดำเนินการ · ' || v_type_text,
                                           v_url);
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว ส่งงานได้', v_summary, v_url);
      else
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                           v_title || ' อนุมัติครบแล้ว',
                                           'รอ IT ดำเนินการ · ' || v_type_text,
                                           v_url);
        v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                           v_title || ' อนุมัติครบ พร้อมให้ IT รับงาน', v_summary, v_url);
      end if;

    elsif new.action in ('dept_rejected', 'it_mgr_rejected') then
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' ไม่ได้รับอนุมัติ',
                                         concat_ws(' · ', 'เหตุผล: ' || private.office_clip(new.reason, 200), 'โดย ' || v_actor_name),
                                         v_url);

    elsif new.action = 'info_requested' then
      select * into v_question from public.itrp_comments c
      where c.request_id = v_req.id and c.kind = 'question' order by c.id desc limit 1;
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_title || ' มีคำถามถึงคุณ',
                                         v_actor_name || ': ' || private.office_clip(coalesce(v_question.body, new.reason), 200),
                                         v_url);

    elsif new.action = 'info_provided' then
      -- แจ้งคนที่ถามคำถามข้อที่ผู้แจ้งเพิ่งตอบ (คำตอบล่าสุดของใบ -> คำถามที่มันตอบ -> ผู้ถาม)
      select * into v_answer from public.itrp_comments a
      where a.request_id = v_req.id and a.kind = 'answer' order by a.id desc limit 1;
      select * into v_question from public.itrp_comments q
      where q.id = v_answer.reply_to and q.request_id = v_req.id;
      if v_question.id is not null then
        v_done := private.itrp_notify_each(array[v_question.author_id], v_done, new.actor_id,
                                           v_title || ' ผู้แจ้งตอบคำถามแล้ว',
                                           v_actor_name || ': ' || private.office_clip(v_answer.body, 200),
                                           v_url);
      end if;

    elsif new.action = 'completed' then
      v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id,
                                         v_prefix || 'IT ส่งงานใบแจ้งซ่อม ' || v_req.doc_no || ' แล้ว กรุณาตรวจรับ',
                                         'กดรับงาน หรือขอแก้ไขงานได้ที่หน้าใบแจ้งซ่อม · ' || v_type_text,
                                         v_url);

    elsif new.action = 'rework_requested' then
      select * into v_rework from public.itrp_reworks r
      where r.request_id = v_req.id order by r.round_no desc limit 1;
      v_done := private.itrp_notify_each(private.itrp_notify_it_admin_ids(), v_done, new.actor_id,
                                         v_title || ' ผู้แจ้งขอแก้ไขงาน',
                                         concat_ws(' · ', v_requester_name,
                                                   case when v_rework.id is not null then 'รอบที่ ' || v_rework.round_no end,
                                                   case when v_rework.id is not null then 'ต้องการ ' || private.office_format_date(v_rework.due_date) end,
                                                   private.office_clip(v_rework.details, 150)),
                                         v_url);

    elsif new.action = 'cancelled' then
      if new.actor_id = v_req.requester_id then
        -- ผู้แจ้งยกเลิกเอง: ผู้อนุมัติของขั้นที่ใบรออยู่ · ผู้ดูแลงาน IT เมื่ออนุมัติครบแล้วหรือ IT เริ่มงานแล้ว
        v_ids := private.itrp_notify_stage_approver_ids(v_req);
        select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(v_req.id) s;
        if (v_dept_done and v_it_done)
           or exists (select 1 from public.itrp_events e where e.request_id = v_req.id and e.action = 'started') then
          v_ids := v_ids || private.itrp_notify_it_admin_ids();
        end if;
        v_done := private.itrp_notify_each(v_ids, v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', 'ผู้แจ้งยกเลิก', private.office_clip(new.reason, 200), v_summary),
                                           v_url);
      else
        -- IT ยกเลิกแทนผู้แจ้ง (เหตุผลขึ้นต้นด้วย "IT ยกเลิกแทนผู้แจ้ง: " อยู่แล้ว): แจ้งผู้แจ้ง
        v_done := private.itrp_notify_each(array[v_req.requester_id], v_done, new.actor_id, v_title || ' ถูกยกเลิก',
                                           concat_ws(' · ', v_actor_name, private.office_clip(new.reason, 200)),
                                           v_url);
      end if;
    end if;
  exception when others then
    -- แจ้งเตือนเป็นเรื่องรอง ห้ามทำให้การอนุมัติ/ส่งงาน (และบันทึก ISO) ล้มตาม
    raise warning 'itrp_notify: สร้างแจ้งเตือนของ event % (ใบ %) ไม่สำเร็จ: % [%]', new.id, new.request_id, sqlerrm, sqlstate;
  end;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itrp_my_role()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  return jsonb_build_object(
    'employee_id', v_actor.id,
    'employee_no', v_actor.employee_no,
    'full_name', v_actor.first_name || ' ' || v_actor.last_name,
    'is_test', v_actor.is_test,
    'department', (select jsonb_build_object('id', d.id, 'code', d.code, 'name_th', d.name_th)
                   from public.departments d where d.id = v_actor.department_id),
    'is_it_department', private.itrp_is_it_department(v_actor.department_id),
    'is_dept_approver', private.itrp_is_dept_approver(v_actor.id, v_actor.department_id, v_actor.is_test),
    'is_it_admin', private.itrp_is_it_admin(v_actor.id),
    'is_it_approver', private.itrp_is_it_approver(v_actor.id),
    'is_it_viewer', private.itrp_is_it_viewer(v_actor.id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itrp_get_detail(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  select * into v_req from public.itrp_requests w where w.id = p_request_id;
  if v_req.id is null or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_req.id,
    'is_test', v_req.is_test,
    'doc_no', v_req.doc_no,
    'doc_year', v_req.doc_year,
    'doc_seq', v_req.doc_seq,
    'requester_id', v_req.requester_id,
    'department_id', v_req.department_id,
    'asset_code', v_req.asset_code,
    'device_name', v_req.device_name,
    'request_kind', v_req.request_kind,
    'request_kind_note', v_req.request_kind_note,
    'repair_target', v_req.repair_target,
    'repair_target_note', v_req.repair_target_note,
    'symptom', v_req.symptom,
    'is_urgent', v_req.is_urgent,
    'status', v_req.status,
    'info_return_status', v_req.info_return_status,
    'created_at', v_req.created_at,
    'rework_round', (select coalesce(max(r.round_no), 0) from public.itrp_reworks r where r.request_id = v_req.id),
    -- วันที่กำหนดเสร็จของรอบขอแก้ไขล่าสุด (ไม่มีรอบแก้ไข = null · ใบแจ้งซ่อมไม่มีวันที่ต้องการงานตอนแจ้ง)
    'latest_due_date', (select r.due_date from public.itrp_reworks r where r.request_id = v_req.id order by r.round_no desc limit 1),
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_req.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_req.department_id),
    -- ประวัติ ISO เรียงตาม id (identity = ลำดับเหตุการณ์จริง) พร้อมชื่อผู้ทำ
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ev.id,
               'action', ev.action,
               'reason', ev.reason,
               'created_at', ev.created_at,
               'actor_employee_no', a.employee_no,
               'actor_full_name', a.first_name || ' ' || a.last_name
             ) order by ev.id), '[]'::jsonb)
      from public.itrp_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id),
    'reworks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rw.id,
               'round_no', rw.round_no,
               'details', rw.details,
               'due_date', rw.due_date,
               'created_at', rw.created_at,
               'requested_by_employee_no', a.employee_no,
               'requested_by_full_name', a.first_name || ' ' || a.last_name
             ) order by rw.round_no), '[]'::jsonb)
      from public.itrp_reworks rw
      join public.employees a on a.id = rw.requested_by
      where rw.request_id = v_req.id),
    -- ไฟล์ตอนแจ้ง/รอบแก้ไข (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments)
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'rework_id', att.rework_id,
               'round_no', coalesce(rw.round_no, 0),
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by coalesce(rw.round_no, 0), att.created_at, att.id), '[]'::jsonb)
      from public.itrp_attachments att
      join public.employees a on a.id = att.uploaded_by
      left join public.itrp_reworks rw on rw.id = att.rework_id
      where att.request_id = v_req.id and att.comment_id is null),
    -- ถามตอบ (ทุกคนที่เห็นใบเห็นครบ) เรียงตามลำดับจริง (id)
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'stage', c.stage,
               'body', c.body,
               'reply_to', c.reply_to,
               'created_at', c.created_at,
               'author_employee_no', a.employee_no,
               'author_full_name', a.first_name || ' ' || a.last_name,
               'attachments', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', att.id,
                          'storage_path', att.storage_path,
                          'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itrp_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itrp_comments c
      join public.employees a on a.id = c.author_id
      where c.request_id = v_req.id),
    -- คำถามที่ค้างอยู่ (เฉพาะตอนใบ need_info) ไม่มี = null
    'info_pending', case when v_req.status = 'need_info' then (
      select jsonb_build_object(
               'comment_id', q.id,
               'stage', q.stage,
               'body', q.body,
               'asked_at', q.created_at,
               'asked_by_employee_no', a.employee_no,
               'asked_by_full_name', a.first_name || ' ' || a.last_name)
      from public.itrp_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itrp_pending_question(v_req.id)).id) end,
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null · it_mgr = "รับทราบ ฝ่ายบริหาร" บนใบพิมพ์
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    -- เวลาดำเนินการซ่อมบนใบพิมพ์: เริ่ม = event started · ซ่อมเสร็จ/ส่งมอบงาน = event completed ล่าสุด (ผู้กด = ช่างผู้ดำเนินการ) · รับมอบงาน = ผู้แจ้งที่กดรับ
    -- รวมเวลา (วัน/ชม.) ให้หน้าเว็บคำนวณจาก started.at ถึง completed.at ตอนแสดง
    'started', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'started'
      order by ev.id limit 1),
    'completed', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'completed'
      order by ev.id desc limit 1),
    'received', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'received'
      order by ev.id desc limit 1),
    -- มีการขอแก้ไขค้างอยู่ (ขอแก้ไขหลังการส่งงานล่าสุด และ IT ยังไม่ส่งงานใหม่) = ช่อง "ส่งแก้ไข" บนใบพิมพ์
    'rework_open', coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'rework_requested'
    ) > coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'completed'
    ), 0), false),
    -- บันทึกการซ่อม: ชุดล่าสุด (ใช้แสดง/พิมพ์) และทุกชุดเรียงตามการส่งงาน (ประวัติ · ชุดล่าสุดอยู่ท้ายสุด) ยังไม่เคยส่งงาน = null / []
    'repair_report', (
      select private.itrp_report_json(r.id)
      from public.itrp_repair_reports r where r.request_id = v_req.id
      order by r.completed_event_id desc limit 1),
    'repair_reports', (
      select coalesce(jsonb_agg(private.itrp_report_json(r.id) order by r.completed_event_id), '[]'::jsonb)
      from public.itrp_repair_reports r where r.request_id = v_req.id),
    -- นาทีทำงานของ IT (เวลาทำงานเท่านั้น หักช่วงรอผู้แจ้งตอบ) · null = IT ยังไม่เคยส่งงาน
    'work_minutes', private.itrp_work_minutes(v_req.id),
    'allowed_actions', to_jsonb(private.itrp_allowed_actions(v_req, v_actor))
  );
end;
$function$;


-- 5.C itrp: ประวัติการซ่อม/ทะเบียนเครื่อง (อ่านอย่างเดียว) หัวหน้า IT ดูได้ต่อเนื่องจากที่เคยดูได้ในฐานะผู้อนุมัติ ------------

CREATE OR REPLACE FUNCTION public.app_itrp_device_history(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_code text := private.itrp_norm_code(p_code);
  v_code_error text;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id) or private.itrp_is_it_viewer(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  v_code_error := private.itrp_code_error(v_code);
  if v_code_error is not null then
    raise exception '%', v_code_error using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'code', v_code,
    'is_test', v_actor.is_test,
    'device', (
      select jsonb_build_object(
               'id', d.id, 'code', d.code, 'kind', d.kind, 'user_name', d.user_name, 'division', d.division,
               'cpu_name', d.cpu_name, 'cpu_model', d.cpu_model, 'started_on', d.started_on,
               'asset_no', d.asset_no, 'status', d.status, 'note', d.note)
      from public.itrp_devices d where d.is_test = v_actor.is_test and d.code = v_code),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'source', h.h_source, 'entry_id', h.h_entry_id, 'request_id', h.h_request_id, 'request_status', h.h_request_status,
               'doc_no', h.h_doc_no, 'reported_on', h.h_reported_on, 'symptom', h.h_symptom, 'action', h.h_action,
               'finished_on', h.h_finished_on, 'remark', h.h_remark, 'reporter_name', h.h_reporter_name,
               'revision_count', h.h_revision_count, 'updated_at', h.h_updated_at
             ) order by coalesce(h.h_reported_on, h.h_finished_on) nulls last, h.h_doc_no nulls last, h.h_entry_id nulls last, h.h_request_id), '[]'::jsonb)
      from private.itrp_history_rows(v_actor.is_test, v_code) h)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itrp_history_get(p_entry_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_entry public.itrp_history_entries%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id) or private.itrp_is_it_viewer(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  select * into v_entry from public.itrp_history_entries e where e.id = p_entry_id;
  if v_entry.id is null or v_entry.is_test <> v_actor.is_test then
    raise exception 'ไม่พบรายการประวัติการซ่อมนี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'entry', jsonb_build_object(
      'id', v_entry.id, 'source', v_entry.source, 'doc_no', v_entry.doc_no, 'device_code', v_entry.device_code,
      'reported_on', v_entry.reported_on, 'symptom', v_entry.symptom, 'action', v_entry.action,
      'finished_on', v_entry.finished_on, 'remark', v_entry.remark, 'reporter_name', v_entry.reporter_name,
      'created_at', v_entry.created_at,
      'created_by_employee_no', (select e.employee_no from public.employees e where e.id = v_entry.created_by),
      'created_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.created_by),
      'updated_at', v_entry.updated_at,
      'updated_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.updated_by),
      'voided_at', v_entry.voided_at, 'void_reason', v_entry.void_reason,
      'voided_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.voided_by)),
    'revisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'revision_no', r.revision_no, 'change_kind', r.change_kind, 'snapshot', r.snapshot,
               'changed_by_employee_no', a.employee_no, 'changed_by_full_name', a.first_name || ' ' || a.last_name,
               'reason', r.reason, 'created_at', r.created_at
             ) order by r.revision_no), '[]'::jsonb)
      from public.itrp_history_entry_revisions r
      join public.employees a on a.id = r.changed_by
      where r.entry_id = v_entry.id)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.app_itrp_list_devices(p_search text DEFAULT NULL::text, p_include_retired boolean DEFAULT true)
 RETURNS TABLE(code text, in_registry boolean, device_id uuid, kind text, user_name text, division text, cpu_name text, cpu_model text, started_on date, asset_no text, status text, note text, history_count integer, last_repair_on date, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_search text := lower(private.itrp_clean(p_search));
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id) or private.itrp_is_it_viewer(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูทะเบียนเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (
    select h.h_device_code as device_code, count(*)::integer as cnt, max(coalesce(h.h_finished_on, h.h_reported_on)) as last_on
    from private.itrp_history_rows(v_actor.is_test, null) h
    group by h.h_device_code
  ),
  codes as (
    select dv.code as c from public.itrp_devices dv where dv.is_test = v_actor.is_test
    union
    select hs.device_code from hist hs
  )
  select cs.c, (d.id is not null), d.id, d.kind, d.user_name, d.division, d.cpu_name, d.cpu_model,
         d.started_on, d.asset_no, d.status, d.note, coalesce(hs.cnt, 0), hs.last_on, d.updated_at
  from codes cs
  left join public.itrp_devices d on d.is_test = v_actor.is_test and d.code = cs.c
  left join hist hs on hs.device_code = cs.c
  where (p_include_retired or d.status is distinct from 'retired')
    and (v_search is null
         or position(v_search in lower(cs.c)) > 0
         or position(v_search in lower(coalesce(d.user_name, ''))) > 0
         or position(v_search in lower(coalesce(d.division, ''))) > 0
         or position(v_search in lower(coalesce(d.asset_no, ''))) > 0
         or position(v_search in lower(coalesce(d.cpu_name, ''))) > 0
         or position(v_search in lower(coalesce(d.cpu_model, ''))) > 0)
  order by cs.c
  limit 2000;
end;
$function$;


-- 6. รายชื่อ/ตั้งสิทธิ์ทีม IT: เพิ่มธงหัวหน้า IT (is_it_viewer) ---------------------------------------------

-- list_staff: คืนตารางเพิ่มคอลัมน์ is_it_viewer (ท้ายสุด ไม่ขยับคอลัมน์เดิม) · เปลี่ยนชนิดที่คืน create or replace ทำไม่ได้ จึง drop แล้วสร้างใหม่
-- (ไม่มีอะไรพึ่งฟังก์ชันนี้ในฐานข้อมูล · สร้างแล้วคืนสิทธิ์เรียกให้เหมือนเดิม: เฉพาะผู้ล็อกอินแล้ว)

drop function if exists public.app_itwo_list_staff();
CREATE OR REPLACE FUNCTION public.app_itwo_list_staff()
 RETURNS TABLE(employee_id uuid, employee_no text, full_name text, department_name text, is_it_admin boolean, is_it_approver boolean, is_active boolean, is_it_viewer boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.name_th, s.is_it_admin, s.is_it_approver, e.is_active, s.is_it_viewer
  from public.itwo_staff s
  join public.employees e on e.id = s.employee_id
  join public.departments d on d.id = e.department_id
  where e.is_test = v_actor.is_test
  order by e.employee_no;
end;
$function$;
revoke all on function public.app_itwo_list_staff() from public, anon;
grant execute on function public.app_itwo_list_staff() to authenticated;

drop function if exists public.app_itrp_list_staff();
CREATE OR REPLACE FUNCTION public.app_itrp_list_staff()
 RETURNS TABLE(employee_id uuid, employee_no text, full_name text, department_name text, is_it_admin boolean, is_it_approver boolean, is_active boolean, is_it_viewer boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.name_th, s.is_it_admin, s.is_it_approver, e.is_active, s.is_it_viewer
  from public.itwo_staff s
  join public.employees e on e.id = s.employee_id
  join public.departments d on d.id = e.department_id
  where e.is_test = v_actor.is_test
  order by e.employee_no;
end;
$function$;
revoke all on function public.app_itrp_list_staff() from public, anon;
grant execute on function public.app_itrp_list_staff() to authenticated;

-- set_staff: signature เดิม (3 พารามิเตอร์) ถูกแทนที่ด้วยฉบับ 4 พารามิเตอร์ที่ตัวที่ 4 มี default -> เรียกแบบเดิมได้ต่อ
-- (ถ้าเก็บทั้งสองฉบับไว้ การเรียก 3 พารามิเตอร์จะกำกวม "function is not unique")
drop function if exists public.app_itwo_set_staff(text, boolean, boolean);
CREATE OR REPLACE FUNCTION public.app_itwo_set_staff(p_employee_no text, p_is_it_admin boolean, p_is_it_approver boolean, p_is_it_viewer boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
  v_admin boolean := coalesce(p_is_it_admin, false);
  v_approver boolean := coalesce(p_is_it_approver, false);
  v_viewer boolean;
  v_old public.itwo_staff%rowtype;
  v_action text;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();
  if v_actor.is_test then
    raise exception 'ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้' using errcode = 'check_violation';
  end if;
  if not private.itwo_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_target
  from public.employees e
  where e.employee_no = upper(btrim(coalesce(p_employee_no, ''))) and not e.is_test and e.deleted_at is null;
  if v_target.id is null then
    raise exception 'ไม่พบรหัสพนักงานนี้' using errcode = 'check_violation';
  end if;
  -- ห้ามแก้สิทธิ์ของตัวเอง (ตรวจก่อนทุกอย่าง รวมกรณีไม่มีอะไรเปลี่ยน เพื่อให้ผลเหมือนกันเสมอ)
  if v_target.id = v_actor.id then
    raise exception 'ไม่สามารถแก้สิทธิ์ทีม IT ของตัวเองได้ กรุณาให้ผู้ดูแลงาน IT คนอื่นเป็นผู้ตั้งให้' using errcode = 'insufficient_privilege';
  end if;

  -- ล็อกทั้งตาราง (มีไม่กี่แถว) กันสองคนแก้พร้อมกันจนเหลือไม่ครบ
  lock table public.itwo_staff in exclusive mode;
  select * into v_old from public.itwo_staff s where s.employee_id = v_target.id;
  -- หัวหน้า IT: ไม่ส่งมา (null) = คงค่าเดิมของคนนั้น (หน้าเว็บรุ่นเก่าส่งแค่ 3 พารามิเตอร์ จะไม่ทำให้ธงหัวหน้า IT หลุดโดยไม่ตั้งใจ)
  v_viewer := coalesce(p_is_it_viewer, v_old.is_it_viewer, false);
  if (v_admin or v_approver or v_viewer) and not v_target.is_active then
    raise exception 'พนักงานคนนี้ถูกปิดการใช้งาน ตั้งสิทธิ์ทีม IT ไม่ได้' using errcode = 'check_violation';
  end if;

  if v_old.employee_id is null and not (v_admin or v_approver or v_viewer) then
    return;
  end if;
  if v_old.employee_id is not null and v_old.is_it_admin = v_admin and v_old.is_it_approver = v_approver and v_old.is_it_viewer = v_viewer then
    return;
  end if;

  if not (v_admin or v_approver or v_viewer) then
    delete from public.itwo_staff where employee_id = v_target.id;
    v_action := 'staff_removed';
  elsif v_old.employee_id is null then
    insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer, updated_by)
    values (v_target.id, v_admin, v_approver, v_viewer, v_actor.id);
    v_action := 'staff_added';
  else
    update public.itwo_staff
    set is_it_admin = v_admin, is_it_approver = v_approver, is_it_viewer = v_viewer, updated_by = v_actor.id, updated_at = now()
    where employee_id = v_target.id;
    v_action := 'staff_changed';
  end if;

  if not exists (
    select 1 from public.itwo_staff s join public.employees e on e.id = s.employee_id
    where s.is_it_admin and e.is_active and e.auth_user_id is not null and e.deleted_at is null and not e.is_test
      and upper(e.employee_no) <> all (private.lab_only_employee_nos())) then
    raise exception 'ต้องเหลือผู้ดูแลงาน IT ที่ใช้งานอยู่อย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;
  if not private.itwo_has_active_it_approver(false) then
    raise exception 'ต้องเหลือผู้อนุมัติขั้น IT ที่ใช้งานอยู่อย่างน้อย 1 คน' using errcode = 'check_violation';
  end if;

  insert into public.itwo_admin_log (is_test, actor_id, action, target_employee_id, detail)
  values (false, v_actor.id, v_action, v_target.id, jsonb_build_object(
    'employee_no', v_target.employee_no,
    'old', case when v_old.employee_id is null then null
                else jsonb_build_object('is_it_admin', v_old.is_it_admin, 'is_it_approver', v_old.is_it_approver, 'is_it_viewer', v_old.is_it_viewer) end,
    'new', jsonb_build_object('is_it_admin', v_admin, 'is_it_approver', v_approver, 'is_it_viewer', v_viewer)));
end;
$function$;
revoke all on function public.app_itwo_set_staff(text, boolean, boolean, boolean) from public, anon;
grant execute on function public.app_itwo_set_staff(text, boolean, boolean, boolean) to authenticated;


-- 7. ข้อมูลสิทธิ์ทีม IT ตามกติกาใหม่ (เจ้าของตัดสิน 26/11/2026) ---------------------------------------------
--   IT3462 (เจ้าของ)  -> ผู้ดูแลงาน IT + ผู้อนุมัติขั้น IT     (admin = true, approver = true, viewer = false)
--   FANG   (หัวหน้า IT) -> ดูอย่างเดียว                         (admin = false, approver = false, viewer = true)
--   persona ทดสอบ SBX-IT-ADMIN -> admin + approver · SBX-IT-APPROVER -> viewer เท่านั้น (ให้โหมดทดสอบเดินตามกติกาจริง)
-- อ้างด้วยรหัสพนักงาน: ไม่พบแถว (เช่นฐาน CI/local ที่ไม่มี IT3462/FANG จริง) ให้ข้ามโดยไม่ error
-- ทำเฉพาะแถวที่ค่ายังไม่ตรง (รันซ้ำไม่เปลี่ยนอะไร ไม่เขียน log ซ้ำ)
-- itwo_staff ติดด่าน sandbox_guard แต่ migration ไม่มี auth.uid() ด่านนี้จึงไม่ขวาง (เหมือน v4)
-- ร่องรอย: บันทึก itwo_admin_log (เพิ่มได้อย่างเดียว) ต่อทุกแถวที่เปลี่ยน
--   แถวของจริง actor = IT3462 (เจ้าของระบบ ผู้สั่งเปลี่ยน) · แถว persona actor = SBX-IT-ADMIN (is_test = true ทั้งแถวและผู้ทำ)
do $$
declare
  v_row record;
  v_staff public.itwo_staff%rowtype;
  v_target public.employees%rowtype;
  v_actor_id uuid;
begin
  for v_row in
    select * from (values
      ('IT3462', false, true, true, false),
      ('FANG', false, false, false, true),
      ('SBX-IT-ADMIN', true, true, true, false),
      ('SBX-IT-APPROVER', true, false, false, true)
    ) as t(employee_no, is_test, is_it_admin, is_it_approver, is_it_viewer)
  loop
    select * into v_target from public.employees e
    where e.employee_no = v_row.employee_no and e.is_test = v_row.is_test and e.deleted_at is null;
    if v_target.id is null then
      continue;
    end if;
    select * into v_staff from public.itwo_staff s where s.employee_id = v_target.id;
    if v_staff.employee_id is null then
      continue;   -- ไม่มีแถวสิทธิ์ทีม IT ของคนนี้ ไม่สร้างใหม่ที่นี่ (เพิ่มคนใหม่ใช้ app_itwo_set_staff)
    end if;
    if v_staff.is_it_admin = v_row.is_it_admin and v_staff.is_it_approver = v_row.is_it_approver
       and v_staff.is_it_viewer = v_row.is_it_viewer then
      continue;
    end if;

    select e.id into v_actor_id from public.employees e
    where e.employee_no = case when v_row.is_test then 'SBX-IT-ADMIN' else 'IT3462' end
      and e.is_test = v_row.is_test and e.deleted_at is null;

    update public.itwo_staff
    set is_it_admin = v_row.is_it_admin, is_it_approver = v_row.is_it_approver, is_it_viewer = v_row.is_it_viewer,
        updated_by = coalesce(v_actor_id, v_target.id), updated_at = now()
    where employee_id = v_target.id;

    insert into public.itwo_admin_log (is_test, actor_id, action, target_employee_id, detail)
    values (v_row.is_test, coalesce(v_actor_id, v_target.id), 'staff_changed', v_target.id, jsonb_build_object(
      'employee_no', v_row.employee_no,
      'old', jsonb_build_object('is_it_admin', v_staff.is_it_admin, 'is_it_approver', v_staff.is_it_approver, 'is_it_viewer', v_staff.is_it_viewer),
      'new', jsonb_build_object('is_it_admin', v_row.is_it_admin, 'is_it_approver', v_row.is_it_approver, 'is_it_viewer', v_row.is_it_viewer),
      'note', 'ผู้อนุมัติขั้น IT = IT3462 · หัวหน้า IT ดูอย่างเดียว (เจ้าของตัดสิน 26/11/2026) · ปรับโดย migration 20261230010000'));
  end loop;

  -- ฐานข้อมูลจริง: ต้องเหลือผู้อนุมัติขั้น IT ที่ใช้งานอยู่ (กันใบใหม่ถูกปฏิเสธเพราะไม่มีผู้อนุมัติ)
  if exists (select 1 from public.employees e where e.employee_no = 'IT3462' and not e.is_test and e.auth_user_id is not null)
     and not private.itwo_has_active_it_approver(false) then
    raise exception 'หลังปรับสิทธิ์ไม่เหลือผู้อนุมัติขั้น IT ที่ใช้งานอยู่ (IT3462) ยกเลิกการปรับ';
  end if;
end;
$$;
