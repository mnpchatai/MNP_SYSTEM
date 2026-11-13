// กติกาของคิวงานหน้าหลัก (app.js renderDashboard) แยกออกมาให้ทดสอบได้
// - เรียงงาน: เร่งด่วนก่อน แล้วสูง แล้วที่เหลือ; ในกลุ่มเดียวกันใบที่รอนานที่สุดก่อน
// - บอกว่าค้างกี่วันตามวันปฏิทินเวลาไทย
// - เลือกใบที่เปิดอยู่: ใบที่ขอมา > ใบที่เปิดค้างไว้ > ใบแรก; เลื่อนด้วยคีย์ J/K ไม่เกินหัวท้าย
(function (root) {
  "use strict";

  const PRIORITY_RANK = Object.freeze({ urgent: 0, high: 1 });
  const DAY_MS = 24 * 60 * 60 * 1000;
  // วันปฏิทินของไทย (UTC+7 ไม่มีเวลาออมแสง)
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

  function priorityRank(priority) {
    return PRIORITY_RANK[priority] ?? 2;
  }

  function sortQueue(items) {
    return [...items].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)
      || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  function bangkokDay(value) {
    return Math.floor((new Date(value).getTime() + BANGKOK_OFFSET_MS) / DAY_MS);
  }

  function waitingDays(createdAt, now = Date.now()) {
    if (!createdAt) return 0;
    return Math.max(0, bangkokDay(now) - bangkokDay(createdAt));
  }

  // เวลาที่ขั้นปัจจุบันมาถึงผู้ใช้ (ใช้นับ "ค้าง N วัน" และเรียงใบที่รอนานก่อน):
  // ค่าล่าสุดของ fallback (วันส่งหรือวันสร้างใบ) · acted_at ของขั้นอนุมัติก่อนหน้า (ขั้นอนุมัติทุกขั้นถูกสร้างพร้อมใบ
  // created_at ของขั้นจึงใช้ไม่ได้) · เวลาที่ใบเปลี่ยนเข้าสถานะปัจจุบันครั้งล่าสุด (request_status_history เช่น ส่งใหม่หลังขอข้อมูลเพิ่ม)
  function stepArrivedAt({ fallback = null, status = null, history = [], previousActedAt = [] } = {}) {
    const times = [fallback, ...previousActedAt, ...history.filter((row) => !status || row.to_status === status).map((row) => row.created_at)]
      .filter((value) => value && Number.isFinite(Date.parse(value)));
    return times.reduce((latest, value) => (Date.parse(value) > Date.parse(latest) ? value : latest), times[0] ?? null);
  }

  function waitingLabel(days) {
    return days <= 0 ? "ถึงวันนี้" : `ค้าง ${days} วัน`;
  }

  function pickSelection(ids, { requested = null, current = null } = {}) {
    if (requested && ids.includes(requested)) return requested;
    if (current && ids.includes(current)) return current;
    return ids[0] ?? null;
  }

  function stepSelection(ids, current, delta) {
    if (!ids.length) return null;
    const index = ids.indexOf(current);
    if (index < 0) return ids[0];
    return ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
  }

  root.MNP_HOME_QUEUE = Object.freeze({ priorityRank, sortQueue, waitingDays, stepArrivedAt, waitingLabel, pickSelection, stepSelection });
})(typeof window !== "undefined" ? window : globalThis);
