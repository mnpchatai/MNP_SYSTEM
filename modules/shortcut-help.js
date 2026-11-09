// ตารางคีย์ลัดของ Pilot Web ที่เปิดดูได้ทุกเมื่อ (กด ? หรือปุ่มช่วยเหลือที่แถบบน) แทนคำอธิบายถาวรบนหน้า
// รายการต้องตรงกับตัวจัดการแป้นใน app.js: "/" ค้นหา · J/K/A/R ของคิวและหน้ารายละเอียด · Esc
(function (root) {
  "use strict";

  const SHORTCUTS = Object.freeze([
    Object.freeze({ keys: ["/"], text: "ไปที่ช่องค้นหาของหน้า" }),
    Object.freeze({ keys: ["J", "K"], text: "เลื่อนไปใบถัดไป / ก่อนหน้าในหน้าหลัก" }),
    Object.freeze({ keys: ["A"], text: "เริ่มอนุมัติใบที่เปิดอยู่ (หน้าหลักและหน้ารายละเอียด) ยังไม่ส่งจนกว่าจะกดยืนยัน" }),
    Object.freeze({ keys: ["R"], text: "เริ่มไม่อนุมัติใบที่เปิดอยู่ ต้องระบุเหตุผลก่อนส่ง" }),
    Object.freeze({ keys: ["Esc"], text: "ปิดกล่องที่เปิดอยู่ · ยกเลิกขั้นยืนยัน · เลิกทำมติที่กำลังนับถอยหลัง" }),
    Object.freeze({ keys: ["?"], text: "เปิดตารางนี้" }),
  ]);

  // ? บนแป้นละติน (Shift + /) · แป้นไทยที่ปุ่มเดียวกันส่งตัวอักษรไทย จึงดูตำแหน่งปุ่ม (event.code) เมื่อไม่ได้ตัวอักษรละติน
  function isHelpKey(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return false;
    if (event.key === "?") return true;
    return event.code === "Slash" && Boolean(event.shiftKey) && !/^[\x20-\x7e]$/.test(event.key ?? "");
  }

  function legendHtml(escapeHtml) {
    return `<dl class="shortcut-list">${SHORTCUTS.map((item) => `<div><dt>${item.keys.map((key) => `<kbd>${escapeHtml(key)}</kbd>`).join(" ")}</dt><dd>${escapeHtml(item.text)}</dd></div>`).join("")}</dl>`;
  }

  root.MNP_SHORTCUT_HELP = Object.freeze({ SHORTCUTS, isHelpKey, legendHtml });
})(typeof window !== "undefined" ? window : globalThis);
