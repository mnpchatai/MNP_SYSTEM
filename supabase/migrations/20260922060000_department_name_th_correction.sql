-- แก้ไขชื่อแผนกภาษาไทย (name_th) จากที่ตั้งเป็นตัวย่อไปก่อน (เช่น 'RB', 'GR' ตอนสร้างใน
-- 20260917070000_account_registration_workflow.sql และ 20260922010000_management_request_pp01_fm08.sql)
-- ให้เป็นชื่อเต็มตามผังองค์กรจริงของโรงงานครบทั้ง 22 แผนก

update public.departments set name_th = case code
  when 'AC' then 'บัญชี'
  when 'AD' then 'ธุรการสำนักงาน'
  when 'BD' then 'พัฒนาธุรกิจ'
  when 'BG' then 'เย็บจักร'
  when 'EX' then 'ฝ่ายขายต่างประเทศ'
  when 'FT' then 'บริหารโรงงาน'
  when 'GR' then 'แปรรูปยาง'
  when 'HR' then 'ฝ่ายทรัพยากรบุคคล'
  when 'IT' then 'ฝ่ายเทคโนโลยีสารสนเทศ'
  when 'MS' then 'ขึ้นรูปตัวอย่าง'
  when 'MT' then 'ซ่อมบำรุง'
  when 'PC' then 'จัดซื้อ'
  when 'PK' then 'ประกอบบรรจุภัณฑ์'
  when 'PP' then 'วางแผนการผลิต'
  when 'PT' then 'ขึ้นรูปพลาสติก'
  when 'QA' then 'ประกันคุณภาพ'
  when 'RB' then 'ขึ้นรูปยาง'
  when 'SA' then 'ขายในประเทศ'
  when 'SP' then 'นำเข้าและส่งออกสินค้า'
  when 'SR' then 'คลังยางเส้นยาว'
  when 'ST' then 'คลังสินค้าวัตถุดิบ'
  when 'WH' then 'คลังสินค้าสำเร็จรูป'
  else name_th
end
where code in (
  'AC','AD','BD','BG','EX','FT','GR','HR','IT','MS','MT',
  'PC','PK','PP','PT','QA','RB','SA','SP','SR','ST','WH'
);

-- FT เคยตั้งชื่ออังกฤษคู่กับ 'ธุรการ' (General Affairs) ไว้ใน 20260922010000
-- ตอนนี้ชื่อไทยที่ถูกต้องคือ "บริหารโรงงาน" จึงแก้ชื่ออังกฤษให้ตรงกันด้วย
update public.departments set name_en = 'Factory Management' where code = 'FT';
