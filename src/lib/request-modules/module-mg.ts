import type { RequestModule } from "./types";

// ใบคำร้องถึงฝ่ายบริหาร (MANAGEMENT, ฟอร์ม PP01-FM08) — ส่วนเฉพาะของ MG ในหน้าเว็บ ส่วนสายอนุมัติ
// และสิทธิ์อยู่ที่ฐานข้อมูล (20260922010000_management_request_pp01_fm08.sql) และ createRequestAction
//
// คู่กับฝั่ง Pilot Web: modules/module-mg.js — แก้ที่หนึ่งให้แก้อีกที่ให้ตรงกัน
export const managementModule: RequestModule = {
  code: "MANAGEMENT",
  enabled: true,
  hidePriority: true,
  // ส่วนที่ 3 ของฟอร์ม PP01-FM08 "สำเนาถึงแผนก" — ตาราง 6 คอลัมน์ 4 แถว เรียงตามฟอร์มต้นฉบับ
  // ช่องสุดท้าย (null) คือ "อื่นๆ" ซึ่งเป็นช่องข้อความอิสระ ไม่ใช่แผนกในระบบ
  ccDepartmentGrid: [
    ["PP", "BD", "QA", "RB", "GR", "PK"],
    ["PT", "BG", "SR", "SE", "ST", "WH"],
    ["MS", "MT", "FT", "IT", "EX", "SA"],
    ["PC", "HR", "AD", "AC", "SP", null],
  ],
  showDocNumberOnCreate: true,
  printFormLabel: "พิมพ์ฟอร์ม PP01-FM08",
  extraDecisions: [{ decision: "acknowledged", label: "รับทราบข้อมูล" }],
};
