import type { RequestModule } from "./types";

// ใบแจ้งซ่อม IT (IT_REPAIR) — แยกไฟล์เพราะ flow งานไม่เหมือนใบแจ้งซ่อม MT
//
// สถานะตอนนี้: โครงไฟล์เท่านั้น ยังไม่เปิดให้ผู้ใช้เห็น (enabled: false และ
// request_types.IT_REPAIR ยังเป็น is_active = false) ระหว่างนี้ใช้ flow อนุมัติทั่วไปไปก่อน
// เมื่อกำหนดขั้นตอนของ IT แล้ว ให้เพิ่ม RPC/สถานะใน migration ใหม่ + test ใน
// supabase/tests/database/ แล้วค่อยเพิ่มส่วนของ flow ที่นี่
//
// คู่กับฝั่ง Pilot Web: modules/Module IT.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
export const itRepairModule: RequestModule = {
  code: "IT_REPAIR",
  label: "ใบแจ้งซ่อม IT",
  enabled: false,
  detailFields: ["asset_code", "location", "impact"],
};
