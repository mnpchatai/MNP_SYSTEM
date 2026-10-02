import type { RequestModule } from "./types";

// NCR/CAR (NCR_CAR) — รายงานความไม่สอดคล้องและการดำเนินการแก้ไข/ป้องกัน
//
// ตอนนี้ใช้ฟอร์มและ flow คำร้องทั่วไปทั้งหมด (ช่องจาก request_types.form_schema, สายอนุมัติจาก
// createRequestAction) ไฟล์นี้เป็นที่วางส่วนเฉพาะของ NCR/CAR เมื่อกำหนดฟอร์มหรือขั้นตอนของตัวเอง
// ส่วน flow/สิทธิ์ใหม่ต้องเพิ่มเป็น migration + test ใน supabase/ ก่อนเสมอ
//
// คู่กับฝั่ง Pilot Web: modules/module-ncr.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
export const ncrCarModule: RequestModule = {
  code: "NCR_CAR",
  enabled: true,
};
