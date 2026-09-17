-- สถานะใหม่ของ workflow แจ้งซ่อม ให้ตรงกับระบบ Maintanance-MT เดิม
--
-- MT มี 10 สถานะ ซึ่งสามสถานะนี้ยังไม่มีใน MNP_SYSTEM
--   pending_assign  = รอมอบหมายช่าง        (ผ่านการอนุมัติครบแล้ว รอ ผจก.ซ่อมบำรุงเลือกช่าง)
--   assigned        = รอดำเนินการ          (มอบหมายช่างแล้ว ช่างยังไม่เริ่มงาน)
--   pending_verify  = รอผู้แจ้งตรวจสอบผล   (ช่างแจ้งซ่อมเสร็จ รอเจ้าของใบตรวจรับ)
--
-- สถานะที่เหลือของ MT ใช้ของเดิมที่มีอยู่แล้วได้ครบ:
--   PENDING_FM / PENDING_GM     -> pending_approval + current_step 1/2 (ดู approval_steps)
--   NEEDS_INFO_FM / NEEDS_INFO_GM -> more_info (ขั้นที่ขอข้อมูลบันทึกอยู่ใน approval_steps แล้ว)
--   IN_PROGRESS -> in_progress · DONE -> completed · REJECTED -> rejected
--
-- แยกเป็น migration ของตัวเองเพราะ Postgres ไม่ยอมให้ใช้ค่า enum ใหม่
-- ใน transaction เดียวกับที่เพิ่งเพิ่มค่านั้นเข้าไป

alter type public.request_status add value if not exists 'pending_assign';
alter type public.request_status add value if not exists 'assigned';
alter type public.request_status add value if not exists 'pending_verify';
