-- เลขที่ NCR จริงปี 2026 เริ่มที่ QA052/26
--
-- เดิม (20261002020000) ตั้งตัวนับ NCR ปี 2026 ไว้ที่ 40 ใบแรกในระบบจึงได้ QA041/26 เพราะ NCR LOG กระดาษใช้/จองถึง QA040
-- ผู้ดูแลระบบแจ้งว่ากระดาษใช้ถึง QA051 แล้ว ใบแรกในระบบต้องเป็น QA052/26 จึงตั้ง last_number = 51
-- (private.next_ncr_doc_number ออกเลข = last_number + 1 และรีเซ็ตทุกปีตามเวลา Asia/Bangkok)
--
-- ปลอดภัยต่อการรันซ้ำและไม่ย้อนกลับ: ถ้าตัวนับของปี 2026 สูงกว่า 51 อยู่แล้ว (มีเลขออกไปเกินแล้ว) จะคงค่าเดิม ไม่ลดลง
-- ไม่แตะตัวนับของใบทดสอบ (department_code = 'NCR-TEST' เลขขึ้นต้น TEST-QA…) ตัวนับใบแจ้งซ่อมแผนก QA (department_code = 'QA')
-- และปีอื่น ไม่แก้ตารางอื่น ไม่เปลี่ยนฟังก์ชัน ไม่เปลี่ยนสิทธิ์
-- ข้อมูลบน production ก่อนใช้ migration นี้: แถว ('NCR','26') = 40 ยังไม่มี NCR จริง
-- ลำดับ deploy: ไม่มีโค้ดฝั่งเว็บที่ผูกกับ migration นี้ จะ apply ก่อนหรือหลัง merge ก็ได้ แต่ต้อง apply ก่อนออก NCR จริงใบแรก
--   (ถ้าออกใบแรกก่อน จะได้ QA041/26 และเลขที่ออกไปแล้วแก้ไม่ได้ เลขจะซ้ำกับกระดาษ)
-- Rollback: ตั้ง last_number กลับเป็นค่าเดิมได้เฉพาะเมื่อยังไม่มี NCR จริงออกจากเลขใหม่
--   (update public.document_counters set last_number = 40, updated_at = now() where department_code = 'NCR' and year_key = '26' and last_number = 51;)

insert into public.document_counters (department_code, year_key, last_number)
values ('NCR', '26', 51)
on conflict (department_code, year_key) do update
  set last_number = greatest(public.document_counters.last_number, excluded.last_number),
      updated_at = case
        when public.document_counters.last_number < excluded.last_number then now()
        else public.document_counters.updated_at
      end;
