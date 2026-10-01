// โมดูลคำร้องที่แยกไฟล์ออกมาเพราะมีส่วนเฉพาะของตัวเอง แต่ยังสร้างคำร้องผ่านหน้า
// "สร้างคำร้องใหม่" และ createRequestAction เดียวกัน — flow/สิทธิ์จริงอยู่ที่ฐานข้อมูล
export type RequestModule = {
  code: string;
  // ชื่อที่แสดงแทน request_types.name_th (ไม่ระบุ = ใช้ชื่อจากฐานข้อมูล)
  label?: string;
  // เปิดให้เห็นในหน้าสร้างคำร้อง — ต้องเปิด request_types.is_active ในฐานข้อมูลด้วย ซึ่งเป็นตัวตัดสินจริง
  enabled: boolean;
  // ชื่อฟิลด์ใน requests.details ที่โมดูลนี้ใช้แทน form_schema (ต้องอยู่ใน fieldMeta ของ
  // request-form และอยู่ในรายการที่ createRequestAction ยอมรับ)
  detailFields?: readonly string[];
  // ไม่มีช่องความสำคัญ — createRequestAction ใช้ค่า normal เมื่อไม่ได้ส่งมา
  hidePriority?: boolean;
  // ตาราง "สำเนาถึงแผนก" (รหัสแผนก, null = ช่อง "อื่นๆ" ข้อความอิสระ)
  ccDepartmentGrid?: readonly (readonly (string | null)[])[];
  // แสดงเลขที่เอกสารในข้อความหลังสร้างคำร้อง
  showDocNumberOnCreate?: boolean;
  // ปุ่มพิมพ์ฟอร์มกระดาษในหน้ารายละเอียด (ไปที่ /requests/[id]/print)
  printFormLabel?: string;
  // มติเพิ่มเติมในกล่องพิจารณาคำร้อง นอกจากอนุมัติ/ไม่อนุมัติ/ขอข้อมูลเพิ่ม
  extraDecisions?: readonly { decision: string; label: string }[];
};
