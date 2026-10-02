import type { RequestModule } from "./types";

// NCR/CAR (NCR_CAR) — รายงานความไม่สอดคล้องและการดำเนินการแก้ไข/ป้องกัน
//
// ตอนนี้ฝั่ง Next.js ยังใช้ฟอร์มและ flow คำร้องทั่วไป (ช่องจาก request_types.form_schema, สายอนุมัติจาก
// createRequestAction) ส่วน Pilot Web ย้าย NCR ไปใช้ workflow QA02-FM01 ของตัวเองแล้ว (ตาราง ncr_* และ
// RPC app_ncr_* ใน 20261002020000_ncr_phase1.sql) — ต่างกันโดยตั้งใจ เพราะผู้ใช้จริงใช้ Pilot Web อยู่
// หน้า NCR ของ Next.js จะทำเมื่อย้ายผู้ใช้มาที่นี่ (เรียก RPC ชุดเดียวกัน ไม่ต้องแก้ฐานข้อมูล)
// ส่วน flow/สิทธิ์ใหม่ต้องเพิ่มเป็น migration + test ใน supabase/ ก่อนเสมอ
//
// คู่กับฝั่ง Pilot Web: modules/module-ncr.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
export const ncrCarModule: RequestModule = {
  code: "NCR_CAR",
  enabled: true,
};
