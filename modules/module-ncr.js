// โมดูล NCR/CAR (NCR_CAR) ของ Pilot Web
//
// รายงานความไม่สอดคล้อง (NCR) และการดำเนินการแก้ไข/ป้องกัน (CAR) ตอนนี้ยังใช้ฟอร์มและ flow
// คำร้องทั่วไปทั้งหมด (app_create_request: หัวหน้าแผนกผู้แจ้ง -> ผู้อนุมัติของแผนก QA ที่เป็นเจ้าของ
// ประเภทเอกสาร, ดู 20260918040517_configure_request_modules.sql) ไฟล์นี้จึงมีแค่ชื่อ/สีการ์ด
// เป็นที่วางโค้ดเฉพาะของ NCR/CAR เมื่อกำหนดฟอร์มหรือขั้นตอนของตัวเอง เช่น ฟิลด์เฉพาะ (renderFields),
// ส่วนในหน้ารายละเอียด (detailView/bindDetail) — ดู hook ที่ใช้ได้ใน modules/module-mg.js และ
// modules/module-mt.js ส่วน flow/สิทธิ์ใหม่ต้องเพิ่มเป็น migration + test ใน supabase/ ก่อนเสมอ
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) แล้วลงทะเบียนตัวเองไว้ใน window.MNP_REQUEST_MODULES
// คู่กับฝั่ง Next.js: src/lib/request-modules/module-ncr.ts — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
(function registerNcrCarModule() {
  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.NCR_CAR = {
    code: "NCR_CAR",
    enabled: true,
    // ไม่ระบุ label — ใช้ชื่อจาก request_types.name_th ("NCR/CAR") เหมือนเดิม
    theme: ["#facc15", "#a16207"],
  };
})();
