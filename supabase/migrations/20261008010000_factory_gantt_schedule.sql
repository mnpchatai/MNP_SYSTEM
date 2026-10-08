-- ============================================================================
-- ฝ่ายโรงงาน: ตารางเวลาการผลิต (Gantt) — วันที่ตามแผนของใบงาน + ปฏิทินกะ/กำลังการผลิตของศูนย์งาน (โหมดทดสอบเท่านั้น)
--
-- ต่อจากใบงานผลิต (20261007050000) ที่ยังไม่มีข้อมูลเวลาตามแผน migration นี้เพิ่ม "ข้อมูลส่วนกลาง" ที่หน้า Gantt อ่านร่วมกันทุกแผนก
-- (ข้อมูลอยู่ในตาราง factory_* เดิม ไม่แยกตารางตารางเวลา จึงได้ RLS / is_test / ประวัติ / ด่านโหมดทดสอบชุดเดียวกัน)
--
--   1. ใบงาน (factory_jobs): planned_start / planned_end (วันที่ รวมวันสุดท้าย) ระดับใบงาน — ใบงานของใบสั่งผลิต (ออเดอร์ลูกค้า) เดียวกัน
--      แสดงอยู่ในกรอบของใบสั่งผลิตนั้น · schedule_version ล็อกการแก้ตารางเวลาแยกจาก version ของใบงาน เพื่อให้การย้ายแถบ Gantt
--      ไม่ทำให้แผนกที่เปิดหน้าทำขั้นตอนค้างอยู่ติด JOB_VERSION_CONFLICT (และการทำขั้นตอนไม่ทำให้การแก้ตารางเวลาชน)
--   2. ศูนย์งาน (factory_work_centers): กะ (เริ่ม/เลิก/พัก) วันทำงานต่อสัปดาห์ จำนวนเครื่อง/สายที่ทำงานคู่กัน และประสิทธิภาพ (%)
--      กำลังการผลิตต่อวันทำงาน (นาที) = (เลิกกะ − เริ่มกะ − พัก) × จำนวนเครื่อง × ประสิทธิภาพ ฝั่งหน้าเว็บคำนวณเทียบกับภาระงานของใบงาน
--      (เตรียมเครื่อง + เวลาเดินต่อชุด × จำนวนชุด) แล้วเตือนวันที่เกินกำลัง — เป็นคำเตือน ไม่ปฏิเสธการบันทึก (วางแผนเกินกำลังได้โดยผู้วางแผนเห็นเอง)
--
-- สิทธิ์ (ทุก RPC เรียก private.factory_actor() ก่อน จึงใช้ได้เฉพาะ admin ในโหมดทดสอบ) แล้วแยกตาม persona
--   * อ่าน (app_factory_schedule_data): persona ฝ่ายโรงงานทุกคน — ทุกแผนกดู Gantt ได้ แผนกอื่นเห็นแบบอ่านอย่างเดียว (can_edit = false)
--   * แก้ตารางเวลาใบงาน / ปฏิทินศูนย์งาน: แผนก PP หรือบทบาท ผู้จัดการทั่วไป · ผู้จัดการโรงงาน · ผู้ช่วยผู้จัดการโรงงาน
--     ปฏิเสธด้วย SCHEDULE_NOT_ALLOWED (private.factory_can_schedule เป็นด่านเดียว ทั้งปุ่มบนหน้าเว็บและ RPC ใช้ผลเดียวกัน)
--     เพิ่มบัญชีทดสอบ SBX-FT-AFM (ผู้ช่วย ผจก.โรงงาน) เพราะบทบาทนี้ยังไม่มีบัญชีทดสอบ
--
-- กฎที่ฐานข้อมูลบังคับ
--   * วันที่ครบทั้งคู่ สิ้นสุดไม่ก่อนเริ่ม ช่วง ≤ 365 วัน อยู่ในปี 2020–2100 (INVALID_SCHEDULE_DATES) · ตั้งตารางเวลาได้เฉพาะใบงานที่ยังไม่จบ
--     (open / in_progress, SCHEDULE_JOB_FINISHED) · ล็อกแถวและเทียบ schedule_version ในธุรกรรมเดียวกัน (SCHEDULE_STALE)
--   * ทุกการตั้งตารางเขียน factory_job_history (action 'schedule' พร้อม snapshot ที่มีวันที่) และ audit_logs (FACTORY_JOB_SCHEDULE)
--   * ปฏิทินศูนย์งาน: กะต้องเริ่มก่อนเลิกในวันเดียวกัน (ยังไม่รองรับกะข้ามคืน) พัก < ความยาวกะ วันทำงาน 1–7 (จันทร์=1) เครื่อง 1–100
--     ประสิทธิภาพ > 0 ถึง 100 ล็อกด้วย calendar_version (CALENDAR_STALE) บันทึก audit_logs (FACTORY_WORK_CENTER_CALENDAR) พร้อมค่าก่อน/หลัง
--   * ค่าตั้งต้นของศูนย์งาน: 08:00–17:00 พัก 60 นาที จันทร์–ศุกร์ 1 เครื่อง ประสิทธิภาพ 100% — เป็นค่าสมมติที่ต้องยืนยันกับหน้างาน
--     ยังไม่รองรับวันหยุดนักขัตฤกษ์ (วันทำงานกำหนดเป็นวันในสัปดาห์เท่านั้น)
--
-- ไม่เปลี่ยน app_factory_master_data (ใบงานเดิมไม่มีวันที่ในชุดข้อมูลนั้น) หน้า Gantt อ่านผ่าน app_factory_schedule_data ที่ส่งชุดข้อมูลของตัวเอง
-- ไม่มีตารางใหม่ จึงไม่ต้องแก้ private.sandbox_unguarded_tables() และการล้างข้อมูลทดสอบ (คอลัมน์ใหม่อยู่ในตารางที่ล้างอยู่แล้ว)
--
-- เริ่มจากนิยามล่าสุดของ private.factory_job_snapshot (20261007050000) และ check ของ factory_job_history.action (20261007070000)
--
-- Rollback (ข้อมูลทดสอบอย่างเดียว): drop function public.app_factory_schedule_data(), public.app_factory_schedule_job(uuid, integer, date, date, text),
--   public.app_factory_save_work_center_calendar(text, integer, time, time, integer, integer[], integer, numeric);
--   drop function private.factory_schedule_actor(), private.factory_can_schedule(public.employees);
--   ลบแถว factory_job_history ที่ action = 'schedule' แล้วคืน check ของ action เป็นชุดของ 20261007070000;
--   create or replace private.factory_job_snapshot ด้วยนิยามเดิมของ 20261007050000;
--   alter table factory_jobs drop constraint factory_jobs_schedule_check, factory_jobs_schedule_range_check และ drop column
--   planned_start, planned_end, schedule_version, scheduled_by, scheduled_at;
--   alter table factory_work_centers drop constraint factory_work_centers_shift_check, factory_work_centers_days_check และ drop column
--   shift_start, shift_end, break_minutes, working_days, units, efficiency_percent, calendar_version, calendar_updated_by, calendar_updated_at;
--   ลบแถว employees SBX-FT-AFM
-- ============================================================================

-- 1. คอลัมน์ตารางเวลาของใบงาน ---------------------------------------------------------------
alter table public.factory_jobs
  add column planned_start date,
  add column planned_end date,
  add column schedule_version integer not null default 1 check (schedule_version >= 1),
  add column scheduled_by uuid references public.employees(id) on delete set null,
  add column scheduled_at timestamptz,
  add constraint factory_jobs_schedule_check
    check ((planned_start is null) = (planned_end is null) and (planned_end is null or planned_end >= planned_start)),
  add constraint factory_jobs_schedule_range_check
    check (planned_start is null or (planned_start >= date '2020-01-01' and planned_end <= date '2100-12-31' and planned_end - planned_start <= 365));
comment on column public.factory_jobs.planned_start is 'วันเริ่มตามแผน (รวมวันนี้) ตั้งโดย app_factory_schedule_job เท่านั้น ยังไม่ตั้ง = null';
comment on column public.factory_jobs.planned_end is 'วันสิ้นสุดตามแผน (รวมวันนี้) ไม่ก่อนวันเริ่ม';
comment on column public.factory_jobs.schedule_version is 'เลขล็อกการแก้ตารางเวลา แยกจาก version ของใบงาน (การทำขั้นตอนไม่ชนกับการย้ายแถบ Gantt)';

-- 2. คอลัมน์ปฏิทินกะ/กำลังการผลิตของศูนย์งาน --------------------------------------------------
alter table public.factory_work_centers
  add column shift_start time not null default time '08:00',
  add column shift_end time not null default time '17:00',
  add column break_minutes integer not null default 60 check (break_minutes between 0 and 600),
  add column working_days smallint[] not null default array[1, 2, 3, 4, 5]::smallint[],
  add column units integer not null default 1 check (units between 1 and 100),
  add column efficiency_percent numeric(5, 2) not null default 100 check (efficiency_percent > 0 and efficiency_percent <= 100),
  add column calendar_version integer not null default 1 check (calendar_version >= 1),
  add column calendar_updated_by uuid references public.employees(id) on delete set null,
  add column calendar_updated_at timestamptz,
  add constraint factory_work_centers_shift_check
    check (shift_end > shift_start and break_minutes < extract(epoch from (shift_end - shift_start)) / 60),
  add constraint factory_work_centers_days_check
    check (cardinality(working_days) between 1 and 7 and working_days <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]);
comment on column public.factory_work_centers.working_days is 'วันทำงานในสัปดาห์ จันทร์=1 ... อาทิตย์=7 (ISO)';
comment on column public.factory_work_centers.units is 'จำนวนเครื่อง/สายที่ทำงานคู่กัน ใช้คูณกำลังการผลิตต่อวัน';

-- ประวัติของใบงานเพิ่มการกระทำ schedule (กำหนด/เลื่อนตารางเวลา)
alter table public.factory_job_history drop constraint if exists factory_job_history_action_check;
alter table public.factory_job_history
  add constraint factory_job_history_action_check
  check (action in ('create', 'step', 'complete', 'cancel', 'qc_fail', 'schedule'));

-- snapshot ของใบงานเก็บวันที่ตามแผนด้วย (คัดลอกนิยามเดิมของ 20261007050000 เพิ่มเฉพาะ planned_start / planned_end / schedule_version)
create or replace function private.factory_job_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id, 'code', j.code, 'status', j.status, 'version', j.version, 'production_code', p.code,
    'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code, 'qty', j.qty, 'output_qty', j.output_qty,
    'warehouse', w.code, 'note', j.note, 'cancel_note', j.cancel_note,
    'planned_start', j.planned_start, 'planned_end', j.planned_end, 'schedule_version', j.schedule_version,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object('sequence', s.sequence, 'name', s.name, 'work_center', s.work_center_code,
                                          'status', s.status, 'note', s.note) order by s.sequence)
      from public.factory_job_steps s where s.job_id = j.id), '[]'::jsonb))
  from public.factory_jobs j
  join public.factory_production_orders p on p.id = j.production_order_id
  join public.factory_items i on i.id = j.item_id
  join public.factory_warehouses w on w.id = j.warehouse_id
  where j.id = p_id
$$;
revoke all on function private.factory_job_snapshot(uuid) from public, anon, authenticated;

-- 3. บัญชีทดสอบ ผู้ช่วยผู้จัดการโรงงาน -------------------------------------------------------
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select 'SBX-FT-AFM', 'ทดสอบ', 'ผู้ช่วย ผจก.โรงงาน', 'sbx-ft-afm@sandbox.local', 'ผู้ช่วย ผจก.โรงงาน (ทดสอบ)', d.id, r.id, false, true
from public.departments d, public.roles r
where d.code = 'FT' and r.code = 'assistant_factory_manager'
on conflict (employee_no) do nothing;

-- 4. ตัวช่วย (private) -------------------------------------------------------------------
-- ใครแก้ตารางเวลาได้: แผนก PP หรือบทบาท ผจก.ทั่วไป / ผจก.โรงงาน / ผู้ช่วย ผจก.โรงงาน
create or replace function private.factory_can_schedule(p_actor public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.departments d where d.id = p_actor.department_id and d.code = 'PP')
      or exists (select 1 from public.roles r where r.id = p_actor.role_id
                 and r.code in ('general_manager', 'factory_manager', 'assistant_factory_manager'))
$$;
revoke all on function private.factory_can_schedule(public.employees) from public, anon, authenticated;

create or replace function private.factory_schedule_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  v_actor := private.factory_actor();
  if not private.factory_can_schedule(v_actor) then raise exception 'SCHEDULE_NOT_ALLOWED'; end if;
  return v_actor;
end;
$$;
revoke all on function private.factory_schedule_actor() from public, anon, authenticated;

-- 5. กำหนด/เลื่อนตารางเวลาของใบงาน -------------------------------------------------------------
create or replace function public.app_factory_schedule_job(
  p_id uuid, p_schedule_version integer, p_start date, p_end date, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_actor := private.factory_schedule_actor();
  if p_start is null or p_end is null or p_end < p_start or p_start < date '2020-01-01' or p_end > date '2100-12-31'
     or p_end - p_start > 365 then
    raise exception 'INVALID_SCHEDULE_DATES';
  end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_SCHEDULE_NOTE'; end if;

  select * into v_job from public.factory_jobs where id = p_id and is_test for update;
  if v_job.id is null then raise exception 'SCHEDULE_TARGET_UNKNOWN'; end if;
  if p_schedule_version is null or p_schedule_version <> v_job.schedule_version then raise exception 'SCHEDULE_STALE'; end if;
  if v_job.status not in ('open', 'in_progress') then raise exception 'SCHEDULE_JOB_FINISHED'; end if;

  update public.factory_jobs
  set planned_start = p_start, planned_end = p_end, schedule_version = v_job.schedule_version + 1,
      scheduled_by = v_actor.id, scheduled_at = now(), updated_by = v_actor.id, updated_at = now()
  where id = v_job.id;
  return private.factory_job_log(v_job.id, 'schedule', null, v_note, v_actor)
         || jsonb_build_object('schedule_version', v_job.schedule_version + 1);
end;
$$;

-- 6. บันทึกปฏิทินกะ/กำลังการผลิตของศูนย์งาน -----------------------------------------------------
create or replace function public.app_factory_save_work_center_calendar(
  p_code text, p_calendar_version integer, p_shift_start time, p_shift_end time, p_break_minutes integer,
  p_working_days integer[], p_units integer, p_efficiency numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_admin_id uuid;
  v_center public.factory_work_centers%rowtype;
  v_days smallint[];
  v_before jsonb;
begin
  v_actor := private.factory_schedule_actor();
  if p_shift_start is null or p_shift_end is null or p_break_minutes is null or p_working_days is null
     or p_units is null or p_efficiency is null or p_efficiency = 'NaN'::numeric then
    raise exception 'INVALID_WORK_CENTER_CALENDAR';
  end if;
  if p_shift_end <= p_shift_start or p_break_minutes < 0 or p_break_minutes > 600
     or p_break_minutes >= extract(epoch from (p_shift_end - p_shift_start)) / 60
     or p_units < 1 or p_units > 100 or p_efficiency <= 0 or p_efficiency > 100
     or exists (select 1 from unnest(p_working_days) d where d is null or d < 1 or d > 7) then
    raise exception 'INVALID_WORK_CENTER_CALENDAR';
  end if;
  select coalesce(array_agg(d order by d), array[]::smallint[]) into v_days
  from (select distinct d::smallint as d from unnest(p_working_days) d) x;
  if cardinality(v_days) = 0 then raise exception 'INVALID_WORK_CENTER_CALENDAR'; end if;

  select * into v_center from public.factory_work_centers where is_test and code = upper(btrim(coalesce(p_code, ''))) for update;
  if v_center.id is null then raise exception 'CALENDAR_CENTER_UNKNOWN'; end if;
  if p_calendar_version is null or p_calendar_version <> v_center.calendar_version then raise exception 'CALENDAR_STALE'; end if;

  v_before := jsonb_build_object('shift_start', v_center.shift_start, 'shift_end', v_center.shift_end, 'break_minutes', v_center.break_minutes,
                                 'working_days', to_jsonb(v_center.working_days), 'units', v_center.units,
                                 'efficiency_percent', v_center.efficiency_percent);
  update public.factory_work_centers
  set shift_start = p_shift_start, shift_end = p_shift_end, break_minutes = p_break_minutes, working_days = v_days,
      units = p_units, efficiency_percent = round(p_efficiency, 2), calendar_version = v_center.calendar_version + 1,
      calendar_updated_by = v_actor.id, calendar_updated_at = now()
  where id = v_center.id;

  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_WORK_CENTER_CALENDAR', 'factory_work_centers', v_center.id::text,
          jsonb_build_object('code', v_center.code, 'is_test', true, 'persona_employee_no', v_actor.employee_no, 'before', v_before,
                             'after', jsonb_build_object('shift_start', p_shift_start, 'shift_end', p_shift_end, 'break_minutes', p_break_minutes,
                                                         'working_days', to_jsonb(v_days), 'units', p_units,
                                                         'efficiency_percent', round(p_efficiency, 2))));
  return jsonb_build_object('code', v_center.code, 'calendar_version', v_center.calendar_version + 1);
end;
$$;

-- 7. อ่านข้อมูล Gantt (ชุดเดียวสำหรับหน้าเว็บ) --------------------------------------------------------
-- orders = ใบสั่งผลิต (ออเดอร์ลูกค้า) ที่มีใบงานอย่างน้อยหนึ่งใบ · jobs ไม่รวมใบที่ยกเลิก · needs = ใบงานอื่นในใบสั่งผลิตเดียวกันที่ผลิตชิ้นงาน
-- ที่ BOM ของใบงานนี้ใช้ (ลำดับก่อนหลังตามสูตร) หน้าเว็บใช้เตือนเมื่อวางตารางชนลำดับ ไม่ใช่การบังคับ
create or replace function public.app_factory_schedule_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  v_actor := private.factory_actor();
  return jsonb_build_object(
    'can_edit', private.factory_can_schedule(v_actor),
    'work_centers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', w.id, 'code', w.code, 'name', w.name, 'department_code', private.factory_center_department(w.code),
          'shift_start', to_char(w.shift_start, 'HH24:MI'), 'shift_end', to_char(w.shift_end, 'HH24:MI'),
          'break_minutes', w.break_minutes, 'working_days', to_jsonb(w.working_days), 'units', w.units,
          'efficiency_percent', w.efficiency_percent, 'calendar_version', w.calendar_version,
          'updated_at', w.calendar_updated_at,
          'updated_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = w.calendar_updated_by)
        ) order by w.code)
      from public.factory_work_centers w where w.is_test), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'code', p.code, 'status', p.status, 'customer', p.customer, 'due_date', p.due_date,
          'work_order_no', p.work_order_no, 'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code,
          'planned_qty', p.planned_qty, 'completed_qty', p.completed_qty
        ) order by p.due_date, p.code)
      from public.factory_production_orders p
      join public.factory_items i on i.id = p.item_id
      where p.is_test and exists (select 1 from public.factory_jobs j where j.production_order_id = p.id and j.is_test and j.status <> 'cancelled')), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', j.id, 'code', j.code, 'status', j.status, 'version', j.version, 'schedule_version', j.schedule_version,
          'production_order_id', j.production_order_id, 'item_id', j.item_id, 'item_code', i.code, 'item_name', i.name,
          'unit_code', i.unit_code, 'qty', j.qty, 'output_qty', j.output_qty, 'bom_output_qty', b.output_qty,
          'planned_start', j.planned_start, 'planned_end', j.planned_end, 'started_at', j.started_at, 'completed_at', j.completed_at,
          'scheduled_at', j.scheduled_at,
          'scheduled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = j.scheduled_by),
          'needs', coalesce((
            select jsonb_agg(k.id order by k.code)
            from public.factory_jobs k
            where k.is_test and k.production_order_id = j.production_order_id and k.id <> j.id and k.status <> 'cancelled'
              and exists (select 1 from public.factory_bom_lines l where l.bom_id = j.bom_id and l.is_test and l.component_id = k.item_id)), '[]'::jsonb),
          'steps', coalesce((
            select jsonb_agg(jsonb_build_object(
                'sequence', s.sequence, 'name', s.name, 'work_center_code', s.work_center_code,
                'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes, 'status', s.status
              ) order by s.sequence)
            from public.factory_job_steps s where s.job_id = j.id), '[]'::jsonb)
        ) order by j.planned_start nulls last, j.code)
      from public.factory_jobs j
      join public.factory_items i on i.id = j.item_id
      join public.factory_boms b on b.id = j.bom_id
      where j.is_test and j.status <> 'cancelled'), '[]'::jsonb));
end;
$$;

-- 8. สิทธิ์เรียก API (ทุกฟังก์ชันตรวจโหมดทดสอบและสิทธิ์เองข้างใน) ------------------------------------------
revoke all on function public.app_factory_schedule_job(uuid, integer, date, date, text) from public, anon;
revoke all on function public.app_factory_save_work_center_calendar(text, integer, time, time, integer, integer[], integer, numeric) from public, anon;
revoke all on function public.app_factory_schedule_data() from public, anon;
grant execute on function public.app_factory_schedule_job(uuid, integer, date, date, text) to authenticated;
grant execute on function public.app_factory_save_work_center_calendar(text, integer, time, time, integer, integer[], integer, numeric) to authenticated;
grant execute on function public.app_factory_schedule_data() to authenticated;
