// โมดูลคำร้องที่แยกไฟล์ออกมาเพราะ flow งานต่างจากโมดูลอื่น แต่ยังสร้างคำร้องผ่านหน้า
// "สร้างคำร้องใหม่" และ createRequestAction เดียวกัน
export type RequestModule = {
  code: string;
  label: string;
  // เปิดให้เห็นในหน้าสร้างคำร้อง — ต้องเปิด request_types.is_active ในฐานข้อมูลด้วย ซึ่งเป็นตัวตัดสินจริง
  enabled: boolean;
  // ชื่อฟิลด์ใน requests.details ที่โมดูลนี้ใช้ (ต้องอยู่ใน fieldMeta ของ request-form และ
  // อยู่ในรายการที่ createRequestAction ยอมรับ)
  detailFields: readonly string[];
};
