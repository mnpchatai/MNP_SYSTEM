-- ลบของค้างจากโมดูลฝ่ายโรงงานที่ถูกถอดไปแล้ว (20261031010000_remove_factory_module.sql) ตามที่ผู้ใช้สั่ง
--   1) ตาราง private._mg_deploy_chunks: ชิ้น SQL ที่ใช้ส่งข้อมูล seed ของโรงงานขึ้น production
--      (insert เข้า factory_units/factory items ซึ่งไม่มีแล้ว) ไม่มี migration โค้ด ฟังก์ชัน หรือ view ใดอ้างถึง
--      ตารางนี้ไม่ได้สร้างจาก migration ใน repo จึงใช้ if exists
--   2) audit_logs ของ sandbox_session ที่บันทึกการเติม/ล้างข้อมูลโรงงาน
--      (SANDBOX_SEED_FACTORY, SANDBOX_SEED_FACTORY_TRIAL, SANDBOX_SEED_FACTORY_MEGAFORM, SANDBOX_PURGE_FACTORY)
--      ต่อจาก 20261103010000 ซึ่งลบเฉพาะ entity_type factory_*
--
-- สิ่งที่ "ไม่" แตะ: บัญชีทดสอบ SBX-*-STAFF และ SBX-FT-AFM (ยังใช้เป็น persona ของ NCR/QC ในโหมดทดสอบ)
--   audit ของ sandbox_session ประเภทอื่น
--
-- Audit: เพิ่มแถวสรุป action = 'remove_factory_leftovers'
-- Rollback: ลบถาวร กู้ได้จาก backup ของ Supabase ที่มีอยู่ก่อน apply เท่านั้น

drop table if exists private._mg_deploy_chunks;

with deleted as (
  delete from public.audit_logs
  where entity_type = 'sandbox_session'
    and action in ('SANDBOX_SEED_FACTORY', 'SANDBOX_SEED_FACTORY_TRIAL',
                   'SANDBOX_SEED_FACTORY_MEGAFORM', 'SANDBOX_PURGE_FACTORY')
  returning 1
)
insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
select null, 'remove_factory_leftovers', 'audit_logs', null,
       jsonb_build_object('dropped_table', 'private._mg_deploy_chunks',
                          'factory_sandbox_audit_deleted', (select count(*) from deleted));
