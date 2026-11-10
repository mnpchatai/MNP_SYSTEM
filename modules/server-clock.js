// นาฬิกาเซิร์ฟเวอร์โดยประมาณ จาก header Date ของคำตอบ Supabase (app.js ส่งทุกคำตอบเข้ามาที่ sample)
// ทำไม: ฐานข้อมูลประทับเวลาด้วยนาฬิกาเซิร์ฟเวอร์ (เช่น readyAt ของล็อตผสมหลัง "ข้ามเวลาบ่ม") ถ้านาฬิกาเครื่องช้ากว่า หน้าจอจะเห็นเวลานั้นอยู่ในอนาคต
// วิธี: header Date ปัดลงเป็นวินาที และเซิร์ฟเวอร์ตอบระหว่างที่เครื่องส่งคำขอ (t0) กับได้รับคำตอบ (t1) จึงได้ช่วงของ
//   offset = เวลาเซิร์ฟเวอร์ − เวลาเครื่อง ∈ [Date − t1, Date + 1000 − t0] · ตัวอย่างใหม่ตัดช่วงให้แคบลงเรื่อย ๆ (เหลือไม่กี่ร้อยมิลลิวินาที)
//   ตัวอย่างที่ไม่ทับช่วงเดิม: ตัวเดียวไม่นับ (เช่นคำตอบเก่าจาก cache) · สองตัวติดกันที่ทับกันเองแต่ไม่ทับช่วงเดิม = นาฬิกาเครื่องถูกตั้งใหม่
//   จึงเริ่มนับใหม่จากสองตัวนั้น · ยังไม่มีตัวอย่าง = offset 0 (เวลาเครื่อง)
// ไม่มี DOM · เบราว์เซอร์: window.MNP_SERVER_CLOCK (นาฬิกาเดียวของหน้า) · Node: module.exports ให้เทสต์
(function (root) {
  function createClock({ now = () => Date.now() } = {}) {
    let low = null;
    let high = null;
    let stray = null; // ตัวอย่างล่าสุดที่ไม่ทับช่วงเดิม [lo, hi] รอดูว่าตัวถัดไปยืนยันหรือไม่
    const overlaps = (a, b) => a[0] <= b[1] && b[0] <= a[1];
    const clock = {
      // dateHeader = ค่า header Date (เช่น "Tue, 10 Nov 2026 06:33:30 GMT") · t0/t1 = เวลาเครื่องตอนส่งและตอนได้รับคำตอบ
      sample(dateHeader, t0, t1) {
        const server = Date.parse(String(dateHeader ?? ""));
        if (!Number.isFinite(server) || !Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return false;
        const next = [server - t1, server + 1000 - t0];
        if (low === null) {
          [low, high] = next;
        } else if (overlaps(next, [low, high])) {
          low = Math.max(low, next[0]);
          high = Math.min(high, next[1]);
          stray = null;
        } else if (stray && overlaps(next, stray)) {
          low = Math.max(stray[0], next[0]);
          high = Math.min(stray[1], next[1]);
          stray = null;
        } else {
          stray = next;
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
