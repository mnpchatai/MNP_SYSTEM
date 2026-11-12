// กล่องช่วยเหลือของ Pilot Web (ปุ่ม ? ที่แถบบน หรือกด ?): วิธีใช้หน้านี้ ความหมายของป้ายสถานะ และคีย์ลัด
// ตารางคีย์ลัดของ Pilot Web ที่เปิดดูได้ทุกเมื่อ (กด ? หรือปุ่มช่วยเหลือที่แถบบน) แทนคำอธิบายถาวรบนหน้า
// รายการต้องตรงกับตัวจัดการแป้นใน app.js: "/" ค้นหา · J/K/A/R ของคิวและหน้ารายละเอียด · Esc
(function (root) {
  "use strict";

  const SHORTCUTS = Object.freeze([
    Object.freeze({ keys: ["/"], text: "ไปที่ช่องค้นหาของหน้า" }),
    Object.freeze({ keys: ["J", "K"], text: "เลื่อนไปใบถัดไป / ก่อนหน้าในหน้าหลัก" }),
    Object.freeze({ keys: ["A"], text: "กดปุ่มหลักของใบที่เปิดอยู่ (อนุมัติ หรือรับทราบ ตามขั้น) ในหน้าหลักและหน้ารายละเอียด ยังไม่ส่งจนกว่าจะกดยืนยัน" }),
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

  // วิธีใช้ต่อหน้า (คีย์ = path ของ hash เช่น #/request → request) เขียนเฉพาะสิ่งที่หน้านั้นทำจริง
  const PAGE_HELP = Object.freeze({
    dashboard: Object.freeze([
      "“ต้องจัดการ” รวมใบที่รอคุณอนุมัติ งานซ่อม และขั้นของ NCR ที่เป็นของคุณ เรียงงานด่วนก่อน แล้วตามใบที่รอนานที่สุด",
      "ใบที่รออนุมัติตัดสินได้จากหน้านี้ ติ๊กหลายใบเพื่ออนุมัติพร้อมกันได้",
      "กดยืนยันแล้วยังกดเลิกทำได้ภายใน 5 วินาที",
    ]),
    request: Object.freeze([
      "ปุ่มหลักในแผงตัดสินใช้คำของขั้น เช่น อนุมัติ หรือรับทราบ",
      "ไม่อนุมัติต้องใส่เหตุผล ส่วนขอข้อมูลเพิ่มจะส่งใบกลับให้ผู้แจ้ง",
      "อนุมัติแล้วกดเลิกทำได้ภายใน 5 วินาที ส่วนเริ่มงาน เสร็จสิ้นงาน และตรวจรับส่งทันทีหลังกดยืนยัน",
      "ประวัติเอกสาร (ใครทำอะไรเมื่อไร) อยู่ใต้แผงตัดสิน",
    ]),
    requests: Object.freeze([
      "เลือกโมดูลเพื่อดูรายการและสร้างคำร้องของโมดูลนั้น",
      "พิมพ์คำค้นแล้วกด Enter เพื่อค้นในรายการ",
      "บนมือถือแตะตรงไหนของแถวก็เปิดใบนั้น",
    ]),
    new: Object.freeze([
      "เลือกประเภทคำร้องก่อน แบบฟอร์มของประเภทนั้นจะเปิดขึ้น",
      "กดส่งแล้วระบบจะบอกช่องที่ยังขาด",
    ]),
    ncr: Object.freeze([
      "สิ่งที่คุณต้องดำเนินการอยู่บนสุดของใบ",
      "ส่วนที่ยังไม่มีข้อมูลจะยังไม่แสดง",
    ]),
    "mt-dashboard": Object.freeze([
      "เลือกช่วงเดือนและตัวกรองได้ที่ส่วนบนของหน้า",
      "แตะแถบขั้นตอน เครื่องจักร แผนก หรือช่าง เพื่อดูตัวเลขของรายการนั้น แล้วกดกรองรายการด้านล่างได้",
      "ปุ่ม “ด่วน” และ “เลยกำหนดเสร็จ” บนการ์ดตัวเลขกรองรายการให้ทันที",
    ]),
    "ncr-dashboard": Object.freeze([
      "เลือกช่วงเดือนและตัวกรองได้ที่ส่วนบนของหน้า",
      "แตะแท่งหรือชื่อแผนกในกราฟเพื่อดูตัวเลขของรายการนั้น แล้วกดกรองทั้งหน้าได้",
      "การ์ดสูญเสียสุทธินับเฉพาะยอดที่ยืนยันแล้ว",
    ]),
    rubberflow: Object.freeze([
      "เลือกหน้าจากเมนูด้านข้าง เมนูเรียงตามขั้นของงาน",
      "ข้อมูลในโหมดทดสอบไม่ใช่ข้อมูลจริง ผู้ดูแลล้างได้ที่ “จัดการข้อมูลทดสอบ” ท้ายหน้า",
    ]),
    bom: Object.freeze([
      "เลือกหน้าจากเมนูด้านข้าง",
      "ข้อมูลในโหมดทดสอบไม่ใช่ข้อมูลจริง ผู้ดูแลล้างได้ที่ “จัดการข้อมูลทดสอบ” ท้ายหน้า",
    ]),
    profile: Object.freeze([
      "เปลี่ยนรหัสพนักงานหรือรหัสผ่านได้ที่การ์ดด้านล่าง ถ้าไม่ใช่ผู้ดูแลระบบ คำขอจะส่งให้ผู้ดูแลอนุมัติก่อน",
    ]),
  });

  // ป้ายสถานะ: สีบอกกลุ่ม สัญลักษณ์ในวงขาวบอกความหมาย (styles.css "แบบ 1")
  const BADGE_LEGEND = Object.freeze([
    Object.freeze(["pending_approval", "รอ (อนุมัติ มอบหมาย เริ่มงาน ตรวจรับ)"]),
    Object.freeze(["more_info", "ขอข้อมูลเพิ่ม"]),
    Object.freeze(["in_progress", "กำลังดำเนินการ"]),
    Object.freeze(["completed", "เสร็จแล้ว / รับทราบ"]),
    Object.freeze(["rejected", "ไม่อนุมัติ"]),
    Object.freeze(["cancelled", "ยกเลิก"]),
    Object.freeze(["urgent-flag", "ด่วน / เกินกำหนด"]),
    // สีน้ำเงินของป้ายนี้คงไว้ตามที่ผู้ใช้เลือก (ต่างจาก "รอ" อื่นที่เป็นอำพัน) จึงต้องอยู่ใน legend
    Object.freeze(["loss-pending-flag", "NCR รอข้อมูลการสูญเสีย"]),
  ]);

  function helpHtml(escapeHtml, path) {
    const tips = PAGE_HELP[path] ?? [];
    const page = tips.length ? `<section class="help-section"><h3>หน้านี้</h3><ul class="help-tips">${tips.map((tip) => `<li>${escapeHtml(tip)}</li>`).join("")}</ul></section>` : "";
    const badges = `<section class="help-section"><h3>ป้ายสถานะ</h3><ul class="help-badges">${BADGE_LEGEND.map(([name, label]) => `<li><span class="badge ${escapeHtml(name)}">${escapeHtml(label)}</span></li>`).join("")}</ul></section>`;
    // จอสัมผัสล้วนไม่มีคีย์บอร์ด ส่วนคีย์ลัดจึงซ่อนด้วย CSS (.help-keys)
    const keys = `<section class="help-section help-keys"><h3>คีย์ลัด</h3>${legendHtml(escapeHtml)}</section>`;
    return page + badges + keys;
  }

  root.MNP_SHORTCUT_HELP = Object.freeze({ SHORTCUTS, PAGE_HELP, BADGE_LEGEND, isHelpKey, legendHtml, helpHtml });
})(typeof window !== "undefined" ? window : globalThis);
