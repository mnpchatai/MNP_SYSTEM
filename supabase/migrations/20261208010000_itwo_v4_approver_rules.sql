-- ใบสั่งงาน IT รุ่น 1.02 (กติกาผู้อนุมัติ) · เจ้าของสั่ง 20/11/2026
--
-- ใครอ่านต่อ: เปลี่ยนจาก 20261206010000_itwo_v3_request_info.sql (ที่ apply บน prod แล้ว ห้ามแก้) 3 เรื่อง (A, B, C)
--
--   A. ระหว่างรอผู้แจ้งตอบ (status = need_info) ผู้ถาม/ผู้อนุมัติขั้นนั้น "ไม่อนุมัติ" ไม่ได้
--      รุ่น 3 อนุญาตไว้ (ไม่อนุมัติ = จบ) เจ้าของเปลี่ยนใจ: ต้องรอคำตอบก่อน แล้วค่อยอนุมัติ/ไม่อนุมัติ/ถามต่อ
--        - private.itwo_decide        ระหว่าง need_info ทั้ง "อนุมัติ" และ "ไม่อนุมัติ" ถูกปฏิเสธ
--                                     (อนุมัติ: ข้อความเดิมของรุ่น 3 · ไม่อนุมัติ: "ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน")
--        - private.itwo_allowed_actions  ใบ need_info ไม่ส่ง reject (และไม่ส่ง approve อยู่แล้ว) ให้ผู้อนุมัติเลย
--        - private.itwo_work_order_guard ตัดเส้นทาง need_info -> rejected ออกจากตารางเปลี่ยนสถานะ (ด่านซ้อนที่ระดับฐานข้อมูล)
--        - private.itwo_approval_caps ไม่แตะ (ยังรวม need_info ใน v_open เพื่อให้ใบที่รอผู้แจ้งตอบยังโผล่ในรายการ
--                                     "รออนุมัติ" ของขั้นนั้นแบบอ่านอย่างเดียว · คอมเมนต์ในนิยามเดิมของรุ่น 3 ยังพูดถึง "ไม่อนุมัติ" ได้
--                                     แต่การกันอยู่ที่ itwo_decide / allowed_actions / guard ตามข้อบน จึงไม่ replace เพื่อลดจำนวนฟังก์ชันที่ต้องเทียบ)
--      ผู้แจ้งยังยกเลิกใบที่ need_info ได้ตามกติกาเดิม
--
--   B. หัวหน้า IT (ผู้อนุมัติขั้น IT) ไม่ทำงาน IT: เจ้าของตัดสินให้ถอดสิทธิ์ผู้ดูแลงาน IT (itwo_staff.is_it_admin) ออกจาก FANG
--      บัญชีจริง "เจ้าของแก้เองในแท็บตั้งค่า" (app_itwo_set_staff) migration นี้ไม่แตะแถวของบัญชีจริง
--      migration นี้แก้เฉพาะบัญชีทดสอบ SBX-IT-APPROVER ให้ is_it_admin = false (is_it_approver = true คงไว้)
--      เพื่อให้โหมดทดสอบเดินตามกติกาจริง (ผู้อนุมัติขั้น IT เห็นทุกใบผ่าน itwo_staff แต่ start / complete / ถามหลังอนุมัติ ไม่ได้)
--      ผลต่อสิทธิ์ (ไม่ต้องแก้ฟังก์ชัน เพราะแยกด้วย itwo_is_it_admin / itwo_is_it_approver อยู่แล้ว):
--        start / complete / request_info ขั้น it / ส่วนบันทึกของ IT   = ต้องเป็น it_admin
--        approve / reject / request_info ขั้น it_mgr (ตอนรออนุมัติ)   = ต้องเป็นผู้อนุมัติขั้น IT
--        เห็นทุกใบ + หน้ารายการงาน IT (app_itwo_list_it)              = ทุกคนใน itwo_staff (itwo_is_staff)
--      การแก้แถว itwo_staff ใน migration ไม่มี actor ตามปกติ (ไม่มี auth.uid) จึงบันทึก itwo_admin_log เป็นแถว is_test
--      โดยใช้ persona SBX-IT-ADMIN เป็นผู้ทำ (actor_id บังคับ not null) เพื่อให้เห็นร่องรอยการเปลี่ยนสิทธิ์ทดสอบ
--      (แถวทดสอบถูกล้างได้ด้วยปุ่มล้างข้อมูลทดสอบตามปกติ)
--
--   ไม่เปลี่ยน: เนื้อหา/ขั้นตอนอื่นทุกอย่าง · ไม่แตะ private.sandbox_unguarded_tables · ไม่มีตาราง/คอลัมน์ใหม่ (RLS/grant ไม่เปลี่ยน)
--   ข้อความสถานะไทยที่ฐานข้อมูลส่ง (itwo_status_message) ของ received คือ "ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว)" อยู่แล้ว
--   สอดคล้องกับป้ายใหม่ "จบงานแล้ว" ของหน้าเว็บ จึงไม่แก้
--
--   C. กันใบค้างถาวรเมื่อผู้แจ้งไม่ตอบ/ลาออก (เจ้าของตัดสิน): ผู้ดูแลงาน IT (itwo_staff.is_it_admin) ยกเลิกใบที่สถานะ need_info
--      "แทนผู้แจ้ง" ได้ ต้องใส่เหตุผล (บังคับ) · ใบสถานะอื่นที่ไม่ใช่ของตัวเอง IT ยกเลิกไม่ได้ (เฉพาะผู้แจ้งเหมือนเดิม)
--        - public.app_itwo_cancel     ผู้แจ้ง: เหมือนเดิมทุกอย่าง · it_admin ที่ไม่ใช่ผู้แจ้ง: เฉพาะ need_info
--                                     บันทึก event cancelled ในชื่อ IT โดย reason ขึ้นต้นด้วย "IT ยกเลิกแทนผู้แจ้ง: " (ไทม์ไลน์/ISO อ่านออก)
--                                     ใบที่เคยมี completed ยกเลิกไม่ได้ทั้งผู้แจ้งและ IT (ข้อความเดิม)
--        - private.itwo_allowed_actions ส่ง cancel ให้ it_admin (ที่ไม่ใช่ผู้แจ้ง) เมื่อใบเป็น need_info และไม่เคยมี completed
--        - private.itwo_work_order_guard ไม่ต้องแก้เพิ่ม (need_info -> cancelled ยอมอยู่แล้ว และกัน completed ไว้ชั้นตาราง)
--
-- ย้อน (ถ้าจำเป็น): create or replace ฟังก์ชัน 4 ตัวด้านล่างกลับเป็นนิยามใน 20261206010000 · ส่วนบัญชีทดสอบตั้ง is_it_admin = true คืนได้เอง
--
-- ก่อน apply บน prod ต้องเทียบ md5(pg_get_functiondef) ของฟังก์ชันที่ replace (itwo_work_order_guard / itwo_decide /
-- itwo_allowed_actions / app_itwo_cancel) ว่ายังเป็นนิยามจาก 20261206010000 (AGENTS.md)

-- 1. guard ใบสั่งงาน: need_info -> rejected ไม่ได้อีก (นิยามเดิมของรุ่น 3 แก้เฉพาะ 2 จุด) ------------------------
create or replace function private.itwo_work_order_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itwo_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ใบสั่งงานลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ใบสั่งงานล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: ทุกคอลัมน์ยกเว้น status (และ info_return_status ที่เปลี่ยนคู่กับ status) ต้องไม่เปลี่ยน
  if (new.id, new.is_test, new.doc_no, new.doc_year, new.doc_seq, new.requester_id, new.department_id,
      new.request_type, new.order_ref, new.attachment_flag, new.attachment_note, new.details,
      new.needed_date, new.is_urgent, new.created_at, new.misc_detail)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.department_id,
      old.request_type, old.order_ref, old.attachment_flag, old.attachment_note, old.details,
      old.needed_date, old.is_urgent, old.created_at, old.misc_detail) then
    raise exception 'ใบสั่งงานแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled', 'need_info'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled', 'need_info'))
    -- it_closed -> in_progress = ผู้แจ้งขอแก้ไขงาน (ผ่าน app_itwo_request_rework เท่านั้น) · received / rejected / cancelled เปิดใหม่ไม่ได้
    or (old.status = 'it_closed' and new.status in ('received', 'in_progress'))
    -- need_info = รอผู้แจ้งตอบ: กลับสถานะเดิม (ตรวจต่อด้านล่าง) หรือจบด้วยยกเลิกของผู้แจ้งเท่านั้น
    -- (รุ่น 1.02: ไม่อนุมัติระหว่างรอคำตอบไม่ได้แล้ว ต้องรอคำตอบก่อน)
    or (old.status = 'need_info' and new.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะใบสั่งงานจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- ถามกลับผู้แจ้ง: ต้องบันทึกสถานะที่จะกลับไปให้ตรงกับสถานะก่อนถาม · ตอนกลับต้องเป็นสถานะที่บันทึกไว้เท่านั้น (ยกเว้นยกเลิก)
  if new.status = 'need_info' and old.status <> 'need_info' and new.info_return_status is distinct from old.status then
    raise exception 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (%) ไว้เป็นสถานะที่จะกลับไป', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'need_info' and new.status <> 'need_info'
     and new.status <> 'cancelled' and new.status is distinct from old.info_return_status then
    raise exception 'ใบที่รอผู้แจ้งตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (%) เท่านั้น', old.info_return_status using errcode = 'check_violation';
  end if;
  if new.status = old.status and new.info_return_status is distinct from old.info_return_status then
    raise exception 'แก้สถานะที่ใบจะกลับไปไม่ได้' using errcode = 'check_violation';
  end if;

  -- การรับงานเป็นขั้นสุดท้ายเสมอ: ใบที่ IT เคยปิดงานแล้ว (มี completed) ยกเลิกไม่ได้ (ต้องขอแก้ไขงานหรือรับงานเท่านั้น)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
       select 1 from public.itwo_events e where e.work_order_id = old.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itwo_work_order_guard() from public, anon, authenticated;

-- 2. อนุมัติ / ไม่อนุมัติ: ระหว่าง need_info ทำทั้งสองอย่างไม่ได้ ------------------------------------------
create or replace function private.itwo_decide(p_work_order_id uuid, p_approve boolean, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    if private.itwo_is_it_approver(v_actor.id) then
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
$$;
revoke all on function private.itwo_decide(uuid, boolean, text) from public, anon, authenticated;

-- 3. สิทธิ์การกระทำที่ทำได้กับใบ: ใบ need_info ไม่ส่ง approve / reject ให้ผู้อนุมัติ --------------------------
create or replace function private.itwo_allowed_actions(p_wo public.itwo_work_orders, p_actor public.employees)
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actions text[] := '{}';
  v_caps record;
  v_is_admin boolean;
  v_pending boolean := p_wo.status in ('pending_dept', 'pending_it_mgr');
begin
  if p_wo.id is null or p_wo.is_test <> p_actor.is_test then
    return v_actions;
  end if;
  v_is_admin := private.itwo_is_it_admin(p_actor.id);

  -- ยกเลิกได้ก่อน IT ปิดงานครั้งแรกเท่านั้น: ใบที่เคยมี completed (แม้อยู่ในรอบแก้ไข) ไม่ส่ง cancel (การรับงานเป็นขั้นสุดท้าย)
  -- ระหว่างรอผู้แจ้งตอบ (need_info) ยกเลิกได้ตามเดิม · รุ่น 1.02: ผู้ดูแลงาน IT (it_admin) ยกเลิก "แทนผู้แจ้ง" ได้เฉพาะใบ need_info
  -- (กันใบค้างถาวรเมื่อผู้แจ้งไม่ตอบ) · ผู้แจ้งที่เป็น it_admin เองใช้สิทธิ์ผู้แจ้งตามปกติ
  if ((p_wo.requester_id = p_actor.id and p_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info'))
      or (v_is_admin and p_wo.status = 'need_info'))
     and not exists (select 1 from public.itwo_events e where e.work_order_id = p_wo.id and e.action = 'completed') then
    v_actions := array_append(v_actions, 'cancel');
  end if;

  -- ระหว่างรอผู้แจ้งตอบ (need_info) ผู้อนุมัติทั้งอนุมัติและไม่อนุมัติไม่ได้ ต้องรอคำตอบก่อน (รุ่น 1.02)
  select * into v_caps from private.itwo_approval_caps(p_wo.id, p_actor.id);
  if (v_caps.can_dept or v_caps.can_it) and p_wo.status <> 'need_info' then
    v_actions := v_actions || array['approve', 'reject'];
  end if;

  -- start / complete ต้องเป็นผู้ดูแลงาน IT (it_admin) เท่านั้น: ผู้อนุมัติขั้น IT ที่ไม่ใช่ it_admin ได้แค่อนุมัติ/ไม่อนุมัติ/ถาม/ดู
  if v_is_admin and (p_wo.status = 'approved' or (p_wo.is_urgent and v_pending)) then
    v_actions := array_append(v_actions, 'start');
  end if;

  if v_is_admin and p_wo.status = 'in_progress' then
    -- ปิดงานได้เมื่ออนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนและงานที่ขอแก้ไขก็เช่นกัน)
    if (select s.dept_done and s.it_done from private.itwo_event_state(p_wo.id) s) then
      v_actions := array_append(v_actions, 'complete');
    end if;
  end if;

  -- IT ปิดงานแล้ว: ผู้แจ้งเลือกได้ว่ารับงาน หรือขอแก้ไขงาน (ไม่จำกัดจำนวนรอบ)
  if p_wo.requester_id = p_actor.id and p_wo.status = 'it_closed' then
    v_actions := array_append(v_actions, 'receive');
    v_actions := array_append(v_actions, 'request_rework');
  end if;

  -- ถามกลับผู้แจ้ง (ผู้อนุมัติของขั้นที่ใบรออยู่ / ผู้ดูแลงาน IT หลังอนุมัติ) และผู้แจ้งตอบ
  if private.itwo_info_stage(p_wo, p_actor) is not null then
    v_actions := array_append(v_actions, 'request_info');
  end if;
  if p_wo.requester_id = p_actor.id and p_wo.status = 'need_info' then
    v_actions := array_append(v_actions, 'provide_info');
  end if;
  return v_actions;
end;
$$;
revoke all on function private.itwo_allowed_actions(public.itwo_work_orders, public.employees) from public, anon, authenticated;

-- 4. ยกเลิก: ผู้แจ้งเหมือนเดิม + ผู้ดูแลงาน IT ยกเลิกใบที่รอผู้แจ้งตอบ (need_info) แทนผู้แจ้งได้ ------------------------
-- ส่วนของผู้แจ้งเหมือนนิยามใน 20261206010000 ทุกอย่าง (สถานะที่ยกเลิกได้ / ข้อความ / ตรวจ completed ก่อนเหตุผล)
create or replace function public.app_itwo_cancel(p_work_order_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itwo_clean(p_reason);
  v_wo public.itwo_work_orders%rowtype;
  -- IT ยกเลิกแทนผู้แจ้ง: ขึ้นต้นเหตุผลในประวัติด้วยข้อความนี้ ให้ไทม์ไลน์/ผู้ตรวจ ISO เห็นว่าไม่ใช่ผู้แจ้งยกเลิกเอง
  c_it_prefix constant text := 'IT ยกเลิกแทนผู้แจ้ง: ';
  v_on_behalf boolean := false;
  v_max_reason integer := 500;
begin
  perform private.lab_only_block();
  v_actor := private.itwo_actor();

  select * into v_wo from public.itwo_work_orders w where w.id = p_work_order_id for update;
  if v_wo.id is null or v_wo.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบสั่งงานนี้' using errcode = 'check_violation';
  end if;
  if v_wo.requester_id <> v_actor.id then
    -- ไม่ใช่ผู้แจ้ง: เฉพาะผู้ดูแลงาน IT กับใบที่รอผู้แจ้งตอบเท่านั้น
    if not private.itwo_is_it_admin(v_actor.id) then
      raise exception 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้' using errcode = 'insufficient_privilege';
    end if;
    -- ใบที่จบไปแล้ว (ไม่อนุมัติ/ยกเลิก/รับงานแล้ว) ปล่อยให้ตรวจสถานะด้านล่างตอบข้อความสถานะตามเดิม
    if v_wo.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'it_closed') then
      raise exception 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ' using errcode = 'insufficient_privilege';
    end if;
    v_on_behalf := v_wo.status = 'need_info';
    v_max_reason := 500 - char_length(c_it_prefix);
  end if;
  if v_wo.status not in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'need_info') then
    raise exception '%', case v_wo.status
      when 'it_closed' then 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน'
      when 'received' then 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้'
      else private.itwo_status_message(v_wo.status)
    end using errcode = 'check_violation';
  end if;
  -- ใบที่เคยมี completed (แม้อยู่ในรอบแก้ไข) ยกเลิกไม่ได้ ทั้งผู้แจ้งและ IT (การรับงานเป็นขั้นสุดท้าย) · ตรวจก่อนเหตุผล เพื่อให้ได้ข้อความนี้เสมอ
  if exists (select 1 from public.itwo_events e where e.work_order_id = v_wo.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิก' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > v_max_reason then
    raise exception 'เหตุผลต้องไม่เกิน % ตัวอักษร', v_max_reason using errcode = 'check_violation';
  end if;

  -- info_return_status ต้องเคลียร์คู่กับการออกจาก need_info (CHECK + guard บังคับ)
  update public.itwo_work_orders set status = 'cancelled', info_return_status = null where id = v_wo.id;
  insert into public.itwo_events (is_test, work_order_id, actor_id, action, reason)
  values (v_wo.is_test, v_wo.id, v_actor.id, 'cancelled',
          case when v_on_behalf then c_it_prefix || v_reason else v_reason end);
end;
$$;

-- 5. บัญชีทดสอบ SBX-IT-APPROVER: ถอนสิทธิ์ผู้ดูแลงาน IT (คงสิทธิ์ผู้อนุมัติขั้น IT) -----------------------------
-- ทำเฉพาะแถวที่ยังเป็น is_it_admin อยู่ (รันซ้ำไม่เปลี่ยนอะไร ไม่เขียน log ซ้ำ) · บัญชีจริง (FANG ฯลฯ) ไม่แตะ
-- itwo_staff ติดด่าน sandbox_guard แต่ migration ไม่มี auth.uid() ด่านนี้จึงไม่ขวาง (เหมือนตอน seed รุ่น 1)
-- itwo_admin_log.actor_id บังคับ not null → ใช้ persona SBX-IT-ADMIN เป็นผู้ทำ (is_test = true ทั้งแถวและผู้ทำ)
with changed as (
  update public.itwo_staff s
  set is_it_admin = false,
      updated_by = (select a.id from public.employees a where a.is_test and a.employee_no = 'SBX-IT-ADMIN'),
      updated_at = now()
  from public.employees e
  where e.id = s.employee_id and e.is_test and e.employee_no = 'SBX-IT-APPROVER'
    and s.is_it_admin and s.is_it_approver
  returning s.employee_id
)
insert into public.itwo_admin_log (is_test, actor_id, action, target_employee_id, detail)
select true, a.id, 'staff_changed', c.employee_id, jsonb_build_object(
  'employee_no', 'SBX-IT-APPROVER',
  'old', jsonb_build_object('is_it_admin', true, 'is_it_approver', true),
  'new', jsonb_build_object('is_it_admin', false, 'is_it_approver', true),
  'note', 'รุ่น 1.02: หัวหน้า IT ทำได้แค่อนุมัติ/ไม่อนุมัติ/ถาม/ดู (ปรับ persona ทดสอบให้ตรงกติกา)')
from changed c
join public.employees a on a.is_test and a.employee_no = 'SBX-IT-ADMIN';
