-- "ห้องบริหาร" ไม่ใช่หน่วยงานจริงในองค์กร ที่ถูกต้องคือ "ฝ่ายบริหาร" (ดูคอมเมนต์ของ
-- 20260922010000_management_request_pp01_fm08.sql ซึ่งเรียกโมดูลนี้ว่า "ฝ่ายบริหาร" อยู่แล้ว
-- แต่ name_th/description ที่ตั้งไว้ใน 20260918040517_configure_request_modules.sql พิมพ์ผิด)
update public.request_types
set
  name_th = 'ใบคำร้องถึงฝ่ายบริหาร',
  description = 'ใบคำร้องที่ต้องการส่งถึงฝ่ายบริหาร'
where code = 'MANAGEMENT';
