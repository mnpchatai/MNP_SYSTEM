-- NCR ลงนามปิดขั้น ผจก.ทั่วไป: บัญชีผู้ดูแลระบบที่ตั้ง "บทบาทหลักในการทำงาน" (employees.acting_role_id) เป็น
-- general_manager ลงนาม/ขอข้อมูลเพิ่มเติม และได้รับแจ้งเตือนของขั้นนี้ได้
--
-- ปัญหา: ผจก.ทั่วไปตัวจริงใช้บัญชี role = admin ที่ตั้ง acting_role_id = general_manager
-- (20261003010000_admin_acting_role.sql) และไม่มีบัญชีที่ใช้งานอยู่บัญชีใดถือ role general_manager จริง
-- แต่ app_ncr_signoff / app_ncr_request_info ตัดสินขั้นสุดท้ายจาก private.employee_role_code (role จริงเท่านั้น)
-- และ private.ncr_audience('general_manager') เลือกผู้รับจาก role จริงเท่านั้น NCR ที่ถึงขั้นนี้จึงไม่มีใครลงนามหรือขอข้อมูลได้
-- ค้างอยู่ awaiting_signoff ตลอดไป และไม่มีใครได้แจ้งเตือนหรืออีเมลเตือนงานค้าง
--
-- แก้ (เฉพาะขั้น ผจก.ทั่วไป ตามที่ตกลงกับผู้ใช้ 2026-10-28):
--   - private.employee_working_role_code(employee_id) = code ของ coalesce(acting_role_id, role_id)
--     (กฎเดียวกับสายอนุมัติและการแจ้งเตือนใน 20261003010000, 20261005010000)
--   - app_ncr_signoff และ app_ncr_request_info: ขั้น gm ตรวจบทบาทที่ทำงาน = general_manager
--     ใช้ "is distinct from" จึงปฏิเสธเมื่อหาพนักงาน/บทบาทไม่เจอ (นิยามเดิม "<>" กับค่า null จะไม่ raise)
--   - private.ncr_audience กิ่ง 'general_manager' ใช้บทบาทที่ทำงาน มีผลกับแจ้งเตือน "NCR รอลงนามปิด (ผจก.ทั่วไป)"
--     และตัวเตือนงานค้าง (private.pending_work_items เรียก ncr_audience ตัวเดียวกัน) โดยไม่ต้องแก้ฟังก์ชันอื่น
-- ไม่เปลี่ยน: ขั้น ผจก.แผนก QA และ ผจก.โรงงาน กิ่งอื่นของ ncr_audience และขั้นอื่นของ NCR ยังดู role จริง
--   (ผจก.โรงงาน และ ผจก.แผนก QA ตัวจริงถือ role จริงอยู่แล้ว)
-- ผลคือ
--   - admin ที่ตั้งบทบาทหลักเป็น general_manager ลงนาม/ขอข้อมูลขั้น ผจก.ทั่วไป ได้ และได้แจ้งเตือนของขั้นนี้
--   - admin ที่ไม่ได้ตั้งบทบาทหลัก หรือตั้งเป็นบทบาทอื่น ยังทำไม่ได้เหมือนเดิม ผู้ถือ role general_manager จริงไม่เปลี่ยน
--   - acting_role_id มีค่าได้เฉพาะบัญชี role admin (trigger employees_normalize_acting_role) และตั้งได้เฉพาะผู้มีสิทธิ์
--     accounts.manage (app_admin_set_acting_role, 20261003020000)
--   - โหมดทดสอบไม่เปลี่ยน: ncr_current_employee คืนแถวของบัญชีทดสอบ (persona) ซึ่งไม่มี acting_role_id
--     และ ncr_audience ไม่ส่งแจ้งเตือนของใบทดสอบอยู่แล้ว
--
-- นิยามต้นทาง (ตรวจกับฐานข้อมูลจริง 2026-10-28 ด้วย md5(pg_get_functiondef(oid)) ก่อน apply ต้องตรวจซ้ำว่ายังตรงกัน):
--   public.app_ncr_signoff(uuid)            20261002020000_ncr_phase1.sql + ด่าน lab-only     md5 6a91ab71094f06cb4c0764b0f36843e3
--   public.app_ncr_request_info(uuid, text) 20261005060000_ncr_signoff_request_info.sql + ด่าน lab-only  md5 884af9798bbca605534a695366539bcf
--   private.ncr_audience(uuid, text)        20261020010000_ncr_responder_designation.sql          md5 24e79836703ffa7d8a9095221c3300cb
--   เปลี่ยนเฉพาะกิ่ง gm / 'general_manager' ที่เหลือคัดมาตามเดิม รวมบรรทัด perform private.lab_only_block();
-- สิทธิ์ execute คงเดิม (create or replace) และย้ำไว้ท้ายไฟล์
-- ลำดับ deploy: ขึ้น migration นี้ก่อนเผยแพร่ Pilot Web รุ่นที่แสดงปุ่มลงนามขั้น ผจก.ทั่วไป ให้ admin ตามบทบาทหลัก
--   (Pilot Web รุ่นเก่าไม่แสดงปุ่มให้ admin กลุ่มนี้ ฐานข้อมูลรุ่นนี้ทำงานกับหน้าเว็บรุ่นเก่าได้)
-- Rollback: create or replace ทั้งสามฟังก์ชันกลับเป็นนิยามต้นทางข้างบน แล้ว drop function private.employee_working_role_code(uuid)
--   (ลายเซ็นที่ลงไปแล้วยังอยู่ ใบที่ปิดแล้วไม่ถูกย้อนสถานะ)

-- บทบาทที่ทำงาน: บัญชี admin ที่ตั้งบทบาทหลักใช้บทบาทนั้น บัญชีอื่นใช้ role จริง (null เมื่อหาพนักงานไม่เจอ)
create or replace function private.employee_working_role_code(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.code
  from public.employees e
  join public.roles r on r.id = coalesce(e.acting_role_id, e.role_id)
  where e.id = p_employee_id
$$;
revoke all on function private.employee_working_role_code(uuid) from public, anon, authenticated;

-- ลงนามปิดตามลำดับ ผจก.แผนก QA -> ผจก.โรงงาน -> ผจก.ทั่วไป (ขั้น ผจก.ทั่วไป นับบทบาทหลักในการทำงานของ admin)
create or replace function public.app_ncr_signoff(p_ncr_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_role text;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();
  v_role := private.employee_role_code(v_employee.id);

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_signoff' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_ncr.signoff_qa_at is null then
    if not (v_role in ('department_manager', 'assistant_department_manager')
            and private.is_qa_department(v_employee.department_id)) then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports set signoff_qa_by = v_employee.id, signoff_qa_at = now() where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'signoff_qa', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'factory', 'NCR รอลงนามปิด (ผจก.โรงงาน)', v_employee.id);
    return 'qa';
  elsif v_ncr.signoff_factory_at is null then
    if v_role <> 'factory_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports set signoff_factory_by = v_employee.id, signoff_factory_at = now() where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'signoff_factory', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'general_manager', 'NCR รอลงนามปิด (ผจก.ทั่วไป)', v_employee.id);
    return 'factory';
  else
    if private.employee_working_role_code(v_employee.id) is distinct from 'general_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports
    set signoff_gm_by = v_employee.id, signoff_gm_at = now(), status = 'closed', closed_at = now()
    where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, 'closed', 'signoff_gm', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'reporter', 'NCR ปิดเรียบร้อยแล้ว', v_employee.id);
    return 'gm';
  end if;
end;
$$;
revoke all on function public.app_ncr_signoff(uuid) from public, anon;
grant execute on function public.app_ncr_signoff(uuid) to authenticated;

-- ผู้ลงนามลำดับปัจจุบันขอข้อมูลเพิ่มเติม (สิทธิ์ตรงกับ app_ncr_signoff ของลำดับนั้น)
create or replace function public.app_ncr_request_info(p_ncr_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_role text;
  v_step text;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();
  v_role := private.employee_role_code(v_employee.id);

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_signoff' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_ncr.signoff_qa_at is null then
    v_step := 'qa';
    if not (v_role in ('department_manager', 'assistant_department_manager')
            and private.is_qa_department(v_employee.department_id)) then
      raise exception 'NOT_AUTHORIZED';
    end if;
  elsif v_ncr.signoff_factory_at is null then
    v_step := 'factory';
    if v_role <> 'factory_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
  else
    v_step := 'gm';
    if private.employee_working_role_code(v_employee.id) is distinct from 'general_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
  end if;

  if char_length(trim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'INVALID_INFO_REQUEST';
  end if;

  insert into public.ncr_info_requests (ncr_id, step, request_note, requested_by)
  values (v_ncr.id, v_step, trim(p_note), v_employee.id)
  returning id into v_id;
  update public.ncr_reports set status = 'awaiting_info' where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_info', 'request_info', p_note, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'responsible_managers', 'NCR ผู้ลงนามขอข้อมูลเพิ่มเติม', v_employee.id);
  return v_id;
end;
$$;
revoke all on function public.app_ncr_request_info(uuid, text) from public, anon;
grant execute on function public.app_ncr_request_info(uuid, text) to authenticated;

-- ผู้รับแจ้งเตือน/ตัวเตือนงานค้างของ NCR: กิ่ง 'general_manager' ใช้บทบาทที่ทำงาน (wr) กิ่งอื่นยังใช้ role จริง (r)
create or replace function private.ncr_audience(p_ncr_id uuid, p_audience text)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.id
  from public.ncr_reports n
  join public.employees e on e.is_active
  join public.roles r on r.id = e.role_id
  join public.roles wr on wr.id = coalesce(e.acting_role_id, e.role_id)
  where n.id = p_ncr_id
    and not n.is_test
    and case p_audience
      when 'factory' then r.code = 'factory_manager'
      when 'general_manager' then wr.code = 'general_manager'
      when 'reporter' then e.id = n.reporter_id
      when 'qa' then private.is_qa_department(e.department_id)
      when 'qa_managers' then private.is_qa_department(e.department_id)
        and r.code in ('department_manager', 'assistant_department_manager')
      when 'responsible_managers' then r.code in ('staff', 'department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities x
          where x.ncr_id = n.id and x.department_id = e.department_id
            and (x.responder_id is null or x.responder_id = e.id)
        )
      else false
    end
$$;
revoke all on function private.ncr_audience(uuid, text) from public, anon, authenticated;
