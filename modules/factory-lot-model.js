// ตรรกะของหน้า "ล็อตวัตถุดิบ" ฝ่ายโรงงาน (โหมดทดสอบ) — ไม่มี DOM/Supabase เทสต์ที่ scripts/tests/factory-lot-model.test.mjs
//
// ข้อมูลมาจาก RPC app_factory_lots (supabase/migrations/20261030010000_factory_lot_fefo_quarantine.sql) ซึ่งเรียงล็อตตามลำดับ FEFO แล้ว
// สถานะ (available / hold / expired) คำนวณที่ฐานข้อมูลด้วยวันนี้ตามเวลาไทย ที่นี่เพิ่มแค่ "ใกล้หมดอายุ" สำหรับป้าย
// การตรวจค่าที่นี่ใช้บอกผู้ใช้ก่อนส่งเท่านั้น RPC ตรวจสิทธิ์ (ST/QA, QA) วันที่ เหตุผล และ version เองทุกครั้ง
(function (root) {
  const STATUSES = Object.freeze({ available: "ใช้ได้", hold: "กักกัน", expired: "หมดอายุ" });
  const BADGE_CLASS = Object.freeze({ available: "approved", hold: "rejected", expired: "rejected", near: "pending_approval" });
  const FILTERS = Object.freeze([["all", "ทุกสถานะ"], ["available", "ใช้ได้"], ["near", "ใกล้หมดอายุ"], ["hold", "กักกัน"], ["expired", "หมดอายุ"]]);
  const HISTORY_ACTIONS = Object.freeze({ expiry: "วันหมดอายุ", hold: "กักกัน", release: "ปลดกักกัน" });
  // ป้าย "ใกล้หมดอายุ" สำหรับล็อตที่ยังใช้ได้และหมดอายุภายในกี่วัน
  const NEAR_EXPIRY_DAYS = 30;
  const NOTE_MIN = 10;
  const NOTE_MAX = 1000;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

  const dayNumber = (date) => (DATE.test(String(date ?? "")) ? Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 86400000 : null);
  const validDate = (date) => {
    const day = dayNumber(date);
    return day !== null && new Date(day * 86400000).toISOString().slice(0, 10) === date;
  };

  // สถานะที่หน้าแสดง: สถานะจากฐานข้อมูล และ "near" เมื่อยังใช้ได้แต่หมดอายุภายใน NEAR_EXPIRY_DAYS วัน
  function displayStatus(lot, today) {
    if (lot.status !== "available" || !lot.expiry_date) return lot.status;
    const left = dayNumber(lot.expiry_date) - dayNumber(today);
    return left <= NEAR_EXPIRY_DAYS ? "near" : "available";
  }

  // ล็อตที่ยังมีของ (คงเหลือ > 0) ตามตัวกรอง ลำดับคงตาม RPC (FEFO = ลำดับที่การตัดวัตถุดิบจะหยิบ)
  function rows(data, { q = "", status = "all" } = {}) {
    const needle = String(q ?? "").trim().toLowerCase();
    return (data?.lots ?? [])
      .filter((lot) => Number(lot.balance) > 0)
      .map((lot) => ({ ...lot, display: displayStatus(lot, data.today) }))
      .filter((lot) => status === "all" || lot.display === status || (status === "available" && lot.display === "near"))
      .filter((lot) => !needle || [lot.lot_number, lot.item_code, lot.item_name].some((text) => String(text ?? "").toLowerCase().includes(needle)));
  }

  const filterOf = (value) => (FILTERS.some(([key]) => key === value) ? value : "all");

  // ปุ่มที่ persona นี้เห็นสำหรับล็อตหนึ่ง (ซ่อนปุ่มไม่ใช่การควบคุมสิทธิ์)
  function actionsFor(lot, data) {
    // วันที่ผ่านมาแล้ว และการแก้ล็อตที่หมดอายุแล้ว เป็นของ QA (can_hold) ตาม LOT_EXPIRY_PAST_QA_ONLY ของ RPC
    const qa = Boolean(data?.can_hold);
    return { expiry: Boolean(data?.can_set_expiry) && (qa || lot.status !== "expired"), hold: qa && !lot.on_hold, release: qa && Boolean(lot.on_hold) };
  }

  // วันแรกที่เลือกได้ในช่องวันหมดอายุ: QA ตั้งแต่วันที่รับของ · คนอื่นตั้งแต่วันนี้ (ถ้ารับของหลังวันนี้ ใช้วันที่รับ)
  function minExpiry(lot, data) {
    const received = lot.received_date ?? "";
    return data?.can_hold || !data?.today || received > data.today ? received : data.today;
  }

  // ฟอร์มวันหมดอายุ: ค่าว่าง = ล้างวันหมดอายุ -> { args } หรือ { error }
  function expiryPayload(lot, value) {
    const date = String(value ?? "").trim();
    if (date && (!validDate(date) || date < "2000-01-01" || date > "2100-12-31")) return { error: "วันหมดอายุไม่ถูกต้อง" };
    if (date && lot.received_date && date < lot.received_date) return { error: "วันหมดอายุต้องไม่ก่อนวันที่รับของ" };
    if ((date || null) === (lot.expiry_date ?? null)) return { error: "วันหมดอายุเหมือนเดิม" };
    return { args: { p_id: lot.id, p_version: lot.version, p_expiry_date: date || null } };
  }

  // ฟอร์มกักกัน/ปลดกักกัน -> { args } หรือ { error }
  function holdPayload(lot, hold, note) {
    const text = String(note ?? "").trim();
    if (text.length < NOTE_MIN || text.length > NOTE_MAX) return { error: `กรุณาระบุเหตุผล ${NOTE_MIN}–${NOTE_MAX.toLocaleString("en-US")} ตัวอักษร` };
    return { args: { p_id: lot.id, p_version: lot.version, p_hold: Boolean(hold), p_note: text } };
  }

  const api = { STATUSES, BADGE_CLASS, FILTERS, HISTORY_ACTIONS, NEAR_EXPIRY_DAYS, NOTE_MIN, NOTE_MAX, displayStatus, rows, filterOf, actionsFor, minExpiry, expiryPayload, holdPayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_LOT_MODEL = api;
})(typeof window !== "undefined" ? window : globalThis);
