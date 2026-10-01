import type { RequestModule } from "./types";

// ใบแจ้งซ่อม IT (IT_REPAIR) — แยกไฟล์เพราะ flow งานไม่เหมือนใบแจ้งซ่อม MT
//
// สถานะตอนนี้: เปิดใช้แล้วด้วย flow คำร้องทั่วไป (20261001050000_enable_it_repair_module.sql)
// หัวหน้าแผนกผู้แจ้ง -> ผู้จัดการแผนก IT -> อนุมัติแล้ว -> ผู้ปฏิบัติงานดำเนินการ
// เมื่อกำหนดขั้นตอนเฉพาะของ IT แล้ว ให้เพิ่ม RPC/สถานะใน migration ใหม่ + test ใน
// supabase/tests/database/ แล้วค่อยเพิ่มส่วนของ flow ที่นี่
//
// คู่กับฝั่ง Pilot Web: modules/module-it.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
export const itRepairModule: RequestModule = {
  code: "IT_REPAIR",
  label: "ใบแจ้งซ่อม IT",
  enabled: true,
  detailFields: ["asset_code", "location", "impact"],
};
