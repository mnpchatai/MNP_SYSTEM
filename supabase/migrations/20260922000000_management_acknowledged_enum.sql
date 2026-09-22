-- PP01-FM08 "ใบคำร้องถึงฝ่ายบริหาร" ส่วนที่ 2 มีมติฝ่ายบริหาร 3 ทาง ไม่ใช่ 2 ทาง:
--   อนุมัติ ดำเนินการตามคำร้อง / ไม่อนุมัติคำร้อง / ได้รับทราบข้อมูลที่แจ้ง
-- ทางเลือกที่สามคือ "รับทราบ" ไม่ใช่การอนุมัติหรือไม่อนุมัติ แต่เป็นการปิดคำร้องแบบ
-- รับทราบข้อมูลเฉยๆ โดยไม่ต้องมีการดำเนินการต่อ จึงต้องมีค่าสถานะของตัวเอง แยกจาก
-- approved/rejected ทั้งใน approval_steps.status และ requests.status
--
-- แยกเป็น migration ของตัวเองเพราะ Postgres ไม่ยอมให้ใช้ค่า enum ใหม่ในทรานแซกชัน
-- เดียวกับที่เพิ่งเพิ่มค่านั้นเข้าไป (รูปแบบเดียวกับ 20260917100000_repair_workflow_enums.sql)
alter type public.approval_status add value if not exists 'acknowledged';
alter type public.request_status add value if not exists 'acknowledged';
