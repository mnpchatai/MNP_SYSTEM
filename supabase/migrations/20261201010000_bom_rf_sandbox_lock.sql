-- ============================================================================
-- BOM / RubberFlow: ฐานข้อมูลใช้ได้เฉพาะโหมดทดสอบอีกครั้ง จนกว่าเจ้าของสั่งใช้จริงทั้งฝ่ายโรงงาน
--
-- ทำไม (เจ้าของโรงงาน 2026-11-18): "เอาเข้า sandbox ให้หมดจนกว่าจะมีคำสั่งว่าจะใช้จริงสำหรับฝ่ายโรงงานทั้งหมด" และ "ล็อคฐานข้อมูลในการทดสอบด้วย"
--   20261130010000 เปิดให้พนักงานจริงเรียก RPC ได้ · Pilot Web ซ่อนเมนูแล้ว (#385) แต่ RPC ยังตอบพนักงานที่ล็อกอินอยู่ถ้าเรียกตรง ๆ
--
-- กติกา
--   - private.bom_real_open() ใหม่ = false: สวิตช์เดียวของการใช้งานจริง (เปิดเมื่อเจ้าของสั่ง: create or replace ให้คืน true พร้อม REAL_STAFF_OPEN ของ Pilot Web)
--   - private.bom_actor() / private.rf_actor(): ไม่มี session = AUTH_REQUIRED เหมือนเดิม · โหมดทดสอบ (สวม persona) = persona เหมือนเดิม ·
--     นอกโหมดทดสอบ ถ้าสวิตช์ปิด = BOM_TEST_MODE_ONLY / RF_TEST_MODE_ONLY (รหัสเดิมก่อน 20261130010000 · Pilot แสดง "ใช้ได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ") รวม admin
--     สวิตช์เปิด = พนักงานจริงตาม 20261130010000 ทุกอย่าง
--   - ทุก RPC ของ BOM / RubberFlow (app_bom_master / _since / _audit / _save_master, app_rf_master / _since / _audit / _save) ผ่าน actor
--     (ตรง ๆ หรือผ่าน bom_reader / rf_reader) จึงถูกล็อกทั้งหมดด้วยการแก้สองฟังก์ชันนี้ · app_sandbox_purge_bom / _rf เป็นของ admin ในโหมดทดสอบอยู่แล้ว
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม): private.bom_actor() และ private.rf_actor() จาก 20261130010000_bom_rf_go_live.sql
--   เพิ่มเฉพาะการตรวจ bom_real_open ก่อนหาพนักงานจริง
-- ใหม่: private.bom_real_open() (revoke all from public, anon, authenticated)
-- ตาราง: ไม่มี
--
-- ลำดับ deploy: Pilot ปัจจุบัน (#385) ไม่เรียก RPC นอกโหมดทดสอบอยู่แล้ว apply ก่อนหรือหลัง merge ได้ · โหมดทดสอบไม่เปลี่ยน
-- Rollback: create or replace private.bom_real_open() ให้คืน true (= พฤติกรรม 20261130010000) หรือคืน bom_actor / rf_actor จาก 20261130010000 แล้ว drop private.bom_real_open()
-- ============================================================================

-- สวิตช์การใช้งานจริงของ BOM / RubberFlow: false = เฉพาะโหมดทดสอบ (เจ้าของสั่ง 2026-11-18)
create or replace function private.bom_real_open()
returns boolean
language sql
stable
set search_path = ''
as $$
  select false
$$;
revoke all on function private.bom_real_open() from public, anon, authenticated;
comment on function private.bom_real_open() is
  'สวิตช์การใช้งานจริงของ BOM / RubberFlow: false = นอกโหมดทดสอบปฏิเสธทุกคน (BOM_TEST_MODE_ONLY / RF_TEST_MODE_ONLY) จนกว่าเจ้าของสั่งใช้จริงทั้งฝ่ายโรงงาน';

-- private.bom_actor() จาก 20261130010000_bom_rf_go_live.sql (+ ตรวจ bom_real_open)
create or replace function private.bom_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- sandbox_persona ตรวจทุกครั้งว่ายังเป็น admin ที่ active และอยู่ในโหมดทดสอบจริง
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  -- ยังไม่เปิดใช้จริง: นอกโหมดทดสอบปฏิเสธทุกคน รวม admin
  if not private.bom_real_open() then
    raise exception 'BOM_TEST_MODE_ONLY';
  end if;
  -- นอกโหมดทดสอบ: พนักงานจริงของ session (persona ไม่มี auth_user_id อยู่แล้ว ตรวจซ้ำให้ชัด)
  select e.* into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.is_test = false
  limit 1;
  if v_actor.id is null then
    raise exception 'BOM_FORBIDDEN';
  end if;
  return v_actor;
end;
$$;

-- private.rf_actor() จาก 20261130010000_bom_rf_go_live.sql (+ ตรวจ bom_real_open)
create or replace function private.rf_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  if not private.bom_real_open() then
    raise exception 'RF_TEST_MODE_ONLY';
  end if;
  select e.* into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.is_test = false
  limit 1;
  if v_actor.id is null then
    raise exception 'RF_FORBIDDEN';
  end if;
  return v_actor;
end;
$$;
