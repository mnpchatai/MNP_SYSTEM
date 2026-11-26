// เวลาทำงานของบริษัท (กติกาเจ้าของ 2026-11-26): ทุกตัวเลขที่แสดงเป็น "ชั่วโมง" หรือ "X วัน Y ชม." นับเฉพาะเวลาทำงาน
// - เวลาทำงาน = 08:00–12:00 และ 13:00–17:00 ตามเวลา Asia/Bangkok (พักเที่ยง 12:00–13:00 ไม่นับ) = 8 ชม. ต่อวัน
// - จันทร์–เสาร์ · วันอาทิตย์ไม่นับ · วันในตาราง company_holidays (ผู้ดูแลระบบตั้งที่ #/admin?tab=holidays) ไม่นับ
// - งานที่ทำนอกเวลาเหล่านี้นับ 0 · "1 วัน" ในรูปแบบ "X วัน Y ชม." = 8 ชั่วโมงทำงาน
// - ตัวนับ "วัน" ทั้งวัน (ค้าง N วัน, เลยกำหนด N วัน, กำหนดตอบ NCR) ยังเป็นวันตามปฏิทิน ไม่ใช้ไฟล์นี้
// - เวลาของกระบวนการ (บ่ม/พักยาง, นาทีทดสอบ Mooney, นาที/ชิ้นของ BOM, ชั่วโมงที่พนักงานกรอกเอง) ไม่ใช้ไฟล์นี้
// Edge Function notify-email มีสำเนาตรรกะเดียวกันเป็น TypeScript (workingMs ใน supabase/functions/notify-email/index.ts) แก้ที่หนึ่งต้องแก้อีกที่
//
// ไม่มี DOM · เบราว์เซอร์: window.MNP_WORKING_TIME (+ loadHolidays/holidays ที่โหลดวันหยุดครั้งเดียวต่อการเปิดหน้า) · Node: module.exports ให้เทสต์
(function (root) {
  const HOUR_MS = 3600000;
  const DAY_MS = 24 * HOUR_MS;
  const BANGKOK_OFFSET_MS = 7 * HOUR_MS; // Asia/Bangkok ไม่มีเวลาออมแสง
  const WORK_BLOCKS = [[8, 12], [13, 17]]; // ชั่วโมงเริ่ม–จบของแต่ละช่วงในวันทำงาน
  const HOURS_PER_DAY = 8;
  const SUNDAY = 0;

  const toMs = (value) => {
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "number") return value;
    if (value instanceof Date) return value.getTime();
    return Date.parse(String(value));
  };

  // รับ Set / Array ของ "YYYY-MM-DD" (หรือแถว { holiday_date }) คืน Set ของวันที่
  function holidaySetOf(holidays) {
    if (holidays instanceof Set) return holidays;
    const set = new Set();
    for (const item of holidays ?? []) {
      const date = String(item && typeof item === "object" ? item.holiday_date ?? "" : item ?? "").slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) set.add(date);
    }
    return set;
  }

  // มิลลิวินาทีของเวลาทำงานระหว่าง start ถึง end (ISO / ms / Date) · ข้อมูลไม่ครบหรือ end ก่อน start = 0
  function workingMs(start, end, holidays) {
    const startMs = toMs(start);
    const endMs = toMs(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return 0;
    const days = holidaySetOf(holidays);
    // ทำงานบนแกนเวลาที่เลื่อนเป็นเวลากรุงเทพ: เที่ยงคืนของแต่ละวันจึงเป็นผลคูณของ DAY_MS
    const from = startMs + BANGKOK_OFFSET_MS;
    const to = endMs + BANGKOK_OFFSET_MS;
    let total = 0;
    for (let midnight = Math.floor(from / DAY_MS) * DAY_MS; midnight < to; midnight += DAY_MS) {
      const date = new Date(midnight);
      if (date.getUTCDay() === SUNDAY || days.has(date.toISOString().slice(0, 10))) continue;
      for (const [open, close] of WORK_BLOCKS) {
        const overlap = Math.min(to, midnight + close * HOUR_MS) - Math.max(from, midnight + open * HOUR_MS);
        if (overlap > 0) total += overlap;
      }
    }
    return total;
  }

  const workingHours = (start, end, holidays) => workingMs(start, end, holidays) / HOUR_MS;

  // ชั่วโมงทำงานเต็ม (ปัดลง) แยกเป็นวันทำงาน (8 ชม.) กับชั่วโมงที่เหลือ
  function splitWorkingHours(ms) {
    const totalHours = Math.floor(Math.max(0, Number(ms) || 0) / HOUR_MS);
    return { totalHours, days: Math.floor(totalHours / HOURS_PER_DAY), hours: totalHours % HOURS_PER_DAY };
  }

  // โหลดวันหยุดบริษัทครั้งเดียวต่อการเปิดหน้า (ทุกบัญชีอ่านได้ผ่าน RLS) · โหลดไม่สำเร็จ = นับเฉพาะวันอาทิตย์ แล้วลองใหม่ครั้งหน้า
  function createHolidayLoader() {
    let set = new Set();
    let pending = null;
    return {
      holidays: () => set,
      load(client) {
        if (typeof client?.from !== "function") return Promise.resolve(set);
        if (!pending) {
          // ห่อใน then: error ที่โยนทันทีจาก client ก็ไปเข้า catch เดียวกัน ไม่ทำให้หน้าที่รออยู่พัง
          pending = Promise.resolve().then(() => client.from("company_holidays").select("holiday_date"))
            .then(({ data, error }) => {
              if (error) throw error;
              set = holidaySetOf(data ?? []);
              return set;
            })
            .catch((error) => {
              pending = null;
              console.warn("โหลดวันหยุดบริษัทไม่สำเร็จ นับเวลาทำงานโดยไม่หักวันหยุด", error);
              return set;
            });
        }
        return pending;
      },
    };
  }

  const api = { HOUR_MS, HOURS_PER_DAY, WORK_BLOCKS, holidaySetOf, workingMs, workingHours, splitWorkingHours, createHolidayLoader };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  const loader = createHolidayLoader();
  root.MNP_WORKING_TIME = Object.freeze({ ...api, loadHolidays: loader.load, holidays: loader.holidays });
})(typeof window !== "undefined" ? window : globalThis);
