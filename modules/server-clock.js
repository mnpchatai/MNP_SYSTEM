// นาฬิกาเซิร์ฟเวอร์โดยประมาณ จาก header Date ของคำตอบ Supabase (app.js ส่งทุกคำตอบเข้ามาที่ sample)
// ทำไม: ฐานข้อมูลประทับเวลาด้วยนาฬิกาเซิร์ฟเวอร์ (เช่น readyAt ของล็อตผสมหลัง "ข้ามเวลาบ่ม") ถ้านาฬิกาเครื่องช้ากว่า หน้าจอจะเห็นเวลานั้นอยู่ในอนาคต
// วิธี: header Date ปัดลงเป็นวินาที และเซิร์ฟเวอร์ตอบระหว่างที่เครื่องส่งคำขอ (t0) กับได้รับคำตอบ (t1) จึงได้ช่วงของ
//   offset = เวลาเซิร์ฟเวอร์ − เวลาเครื่อง ∈ [Date − t1, Date + 1000 − t0] · ตัวอย่างใหม่ตัดช่วงให้แคบลงเรื่อย ๆ (เหลือไม่กี่ร้อยมิลลิวินาที)
//   ช่วงไม่ทับกัน (นาฬิกาเครื่องถูกตั้งใหม่ / ตัวอย่างเก่าผิด) = เริ่มนับใหม่จากตัวอย่างล่าสุด · ยังไม่มีตัวอย่าง = offset 0 (เวลาเครื่อง)
// ไม่มี DOM · เบราว์เซอร์: window.MNP_SERVER_CLOCK (นาฬิกาเดียวของหน้า) · Node: module.exports ให้เทสต์
(function (root) {
  function createClock({ now = () => Date.now() } = {}) {
    let low = null;
    let high = null;
    const clock = {
      // dateHeader = ค่า header Date (เช่น "Tue, 10 Nov 2026 06:33:30 GMT") · t0/t1 = เวลาเครื่องตอนส่งและตอนได้รับคำตอบ
      sample(dateHeader, t0, t1) {
        const server = Date.parse(String(dateHeader ?? ""));
        if (!Number.isFinite(server) || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return false;
        const lo = server - t1;
        const hi = server + 1000 - t0;
        if (low === null || lo > high || hi < low) {
          low = lo;
          high = hi;
        } else {
          low = Math.max(low, lo);
          high = Math.min(high, hi);
        }
        return true;
      },
      offset: () => (low === null ? 0 : Math.round((low + high) / 2)),
      now: () => now() + clock.offset(),
      bounds: () => (low === null ? null : [low, high]),
    };
    return clock;
  }

  const api = { createClock };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.MNP_SERVER_CLOCK = Object.assign(createClock(), { createClock });
})(typeof window !== "undefined" ? window : globalThis);
