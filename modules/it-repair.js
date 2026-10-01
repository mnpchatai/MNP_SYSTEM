// โมดูลใบแจ้งซ่อม IT (IT_REPAIR) ของ Pilot Web
//
// แยกไฟล์จาก app.js เพราะ flow งานของ IT ไม่เหมือนใบแจ้งซ่อม MT แต่ยังสร้างคำร้องผ่านหน้า
// "สร้างคำร้องใหม่" และฟังก์ชันส่งคำร้องกลางใน app.js เหมือนโมดูลอื่น ไฟล์นี้โหลดก่อน app.js
// (ดู index.html) แล้วลงทะเบียนตัวเองไว้ใน window.MNP_REQUEST_MODULES ให้ app.js อ่าน
//
// สถานะตอนนี้: โครงไฟล์เท่านั้น — ยังไม่เปิดให้ผู้ใช้เห็น
// - enabled: false ทำให้ app.js ไม่ดึงการ์ด IT มาแสดง และ request_types.IT_REPAIR ก็ยังเป็น
//   is_active = false ในฐานข้อมูล (20260918040517_configure_request_modules.sql) ซึ่งเป็นตัว
//   ตัดสินจริง — RPC สร้างคำร้องปฏิเสธประเภทที่ไม่ active อยู่แล้ว
// - ระหว่างนี้ใช้ flow อนุมัติทั่วไป (app_create_request) ไปก่อน เมื่อกำหนดขั้นตอนของ IT แล้ว
//   ให้เพิ่ม RPC/สถานะใน migration ใหม่ + test ใน supabase/tests/database/ แล้วค่อยเพิ่ม hook
//   ของ flow ที่นี่ จากนั้นเปิดทั้ง enabled และ is_active พร้อมกัน
//
// คู่กับฝั่ง Next.js: src/lib/request-modules/it-repair.ts — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
(function registerItRepairModule() {
  const IT_REPAIR_FIELDS = [
    { name: "asset_code", label: "รหัสอุปกรณ์/ทรัพย์สิน IT", placeholder: "เช่น NB-0123" },
    { name: "location", label: "สถานที่", placeholder: "อาคาร / แผนก / โต๊ะ" },
    { name: "impact", label: "ผลกระทบ", placeholder: "กระทบงานหรือผู้ใช้กี่คน" },
  ];

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.IT_REPAIR = {
    code: "IT_REPAIR",
    enabled: false,
    label: "ใบแจ้งซ่อม IT",
    theme: ["#60a5fa", "#1d4ed8"],
    // ฟิลด์เฉพาะของ IT — ใช้ class detail-field เพื่อให้ฟังก์ชันส่งคำร้องกลางเก็บลง details เอง
    renderFields({ escapeHtml }) {
      return IT_REPAIR_FIELDS.map((field) => `<div class="field"><label for="detail-${field.name}">${escapeHtml(field.label)}</label><input class="input detail-field" id="detail-${field.name}" name="${field.name}" placeholder="${escapeHtml(field.placeholder)}" maxlength="500"></div>`).join("");
    },
  };
})();
