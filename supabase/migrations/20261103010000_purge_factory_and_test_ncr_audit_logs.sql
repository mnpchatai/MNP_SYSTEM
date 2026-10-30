-- ล้างบันทึกตรวจสอบ (public.audit_logs) ที่เหลือจากข้อมูลทดสอบ 2 กลุ่ม ตามที่ผู้ใช้ตัดสินใจ
--   1) การทำรายการของโมดูลฝ่ายโรงงาน (entity_type = 'factory_*') ซึ่งเป็นโมดูลโหมดทดสอบที่ถูกลบไปแล้ว
--      (20261031010000_remove_factory_module.sql ตั้งใจคง audit ไว้ ครั้งนี้ผู้ใช้สั่งลบ)
--   2) การทำรายการของใบ NCR ทดสอบ (ncr_reports.is_test) ทั้งใบที่ยังอยู่และใบที่ถูกล้างด้วยปุ่ม
--      "ล้างข้อมูลทดสอบ" (public.app_sandbox_purge_ncr) ไปแล้ว ปุ่มนั้นลบใบ NCR แต่ไม่ลบ audit
--      และ trigger audit_row_change ยังเพิ่มแถว DELETE ของใบที่ถูกล้างเข้ามาอีก
--
-- วิธีระบุใบ NCR ทดสอบ: id ของ ncr_reports ที่ is_test ตอนนี้ รวมกับ id ที่ audit ของ ncr_reports เองบันทึก
--   is_test = true ไว้ใน metadata 'new' หรือ 'old' (ใช้ได้แม้ใบถูกล้างไปแล้ว จึงไม่ขึ้นกับลำดับว่ากดปุ่มล้าง
--   ก่อนหรือหลัง apply) แล้วตัด id ของใบจริงที่มีอยู่ (is_test = false) ออกเสมอ
--   audit ของตารางลูก (ncr_losses, ncr_outcomes, ncr_responsibilities, ncr_attachments, ncr_info_requests)
--   ผูกกับใบผ่าน metadata 'new'/'old' ->> 'ncr_id'
--
-- สิ่งที่ "ไม่" แตะ: ใบ NCR และตารางลูกเอง (ให้ล้างด้วยปุ่มในแอป), audit ของใบ NCR จริง, audit ประเภทอื่น
--   (รวม sandbox_session ซึ่งบันทึกการเข้า/ออกโหมดทดสอบและการกดล้าง), ตาราง ฟังก์ชัน และสิทธิ์อื่น
--
-- Audit: เพิ่มแถวสรุป action = 'purge_test_audit_logs' พร้อมจำนวนที่ลบของแต่ละกลุ่ม
-- Rollback: ลบถาวร ผู้ใช้เลือกไม่สำรองข้อมูล กู้ได้จาก backup ของ Supabase ที่มีอยู่ก่อน apply เท่านั้น
-- ใช้ซ้ำได้: หลังกดปุ่มล้างข้อมูลทดสอบ NCR ครั้งต่อไป ผู้ดูแลฐานข้อมูลเรียก
--   select private.purge_test_audit_logs(); ได้ (Data API เรียกไม่ได้)

create or replace function private.purge_test_audit_logs()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_factory integer;
  v_test_ncr integer;
begin
  -- ด่าน: ลบ audit ของโรงงานได้เฉพาะเมื่อโมดูลถูกถอดแล้ว
  if exists (
    select 1 from pg_catalog.pg_tables
    where schemaname = 'public' and tablename like 'factory\_%'
  ) then
    raise exception 'FACTORY_TABLES_REMAIN';
  end if;

  delete from public.audit_logs where entity_type like 'factory\_%';
  get diagnostics v_factory = row_count;

  with test_ncr as (
    (
      select r.id::text as id from public.ncr_reports r where r.is_test
      union
      select a.entity_id from public.audit_logs a
      where a.entity_type = 'ncr_reports'
        and a.entity_id is not null
        and (coalesce((a.metadata->'new'->>'is_test')::boolean, false)
          or coalesce((a.metadata->'old'->>'is_test')::boolean, false))
    )
    except
    select r.id::text from public.ncr_reports r where not r.is_test
  )
  delete from public.audit_logs a
  where a.entity_type in ('ncr_reports', 'ncr_losses', 'ncr_outcomes', 'ncr_responsibilities',
                          'ncr_attachments', 'ncr_info_requests')
    and (case when a.entity_type = 'ncr_reports' then a.entity_id
              else coalesce(a.metadata->'new'->>'ncr_id', a.metadata->'old'->>'ncr_id') end)
        in (select id from test_ncr);
  get diagnostics v_test_ncr = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (null, 'purge_test_audit_logs', 'audit_logs', null,
          jsonb_build_object('factory_deleted', v_factory, 'test_ncr_deleted', v_test_ncr));

  return jsonb_build_object('factory_deleted', v_factory, 'test_ncr_deleted', v_test_ncr);
end;
$$;

revoke all on function private.purge_test_audit_logs() from public, anon, authenticated;

select private.purge_test_audit_logs();
