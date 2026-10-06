// เมนู "Item master" ของฝ่ายโรงงาน (โหมดทดสอบ) — โครงสร้างต้นไม้ โฟลเดอร์ > รายการเอกสาร
// ข้อมูลล้วน ไม่มี DOM/Supabase
//
// ที่มา: ภาพเมนู Item master ที่ผู้ใช้ส่งมาเป็นแบบอย่าง (โฟลเดอร์ 6 อัน กางแล้วเห็นรายการเอกสารด้านใน)
// ภาพนั้นเห็นรายการภายในครบเฉพาะบางส่วนของโฟลเดอร์ "โครงสร้าง" (ชื่อรายการที่เหลือถูกตัดขอบภาพ)
// จึงใส่เฉพาะชื่อที่อ่านได้ครบ โฟลเดอร์อื่นยังไม่มีรายการ — ไม่เดาชื่อที่ไม่เห็น
// เมื่อได้รายการครบให้เพิ่มที่ไฟล์นี้ที่เดียว หน้าจอไม่ต้องแก้ (key ต้องไม่ซ้ำทั้งเมนู)
//
// เทสต์ที่ scripts/tests/factory-item-master.test.mjs
(function (root) {
  const entry = (key, name) => Object.freeze({ key, name });
  const folder = (key, name, entries = []) => Object.freeze({ key, name, entries: Object.freeze(entries) });

  const FOLDERS = Object.freeze([
    folder("structure", "โครงสร้าง", [
      entry("structure-new", "โครงสร้างสินค้า-ใหม่"),
      entry("structure-edit", "โครงสร้างสินค้า-แก้ไข"),
      entry("structure-view", "โครงสร้างสินค้า-ดู"),
    ]),
    folder("item", "สินค้า"),
    folder("price", "ราคา"),
    folder("partner", "ผู้ร่วมมือ"),
    folder("quotation", "ใบเสนอราคา"),
    folder("sales-order", "ใบสั่งขาย"),
  ]);

  // หารายการจาก key ของรายการ — ไม่พบคืน null ไม่เดาให้ (key มาจาก DOM จึงถือเป็นข้อมูลที่ยังไม่ตรวจ)
  function findEntry(key) {
    const wanted = String(key ?? "");
    for (const parent of FOLDERS) {
      const found = parent.entries.find((candidate) => candidate.key === wanted);
      if (found) return Object.freeze({ folder: parent, entry: found });
    }
    return null;
  }

  const api = { FOLDERS, findEntry };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_ITEM_MASTER = api;
})(typeof window !== "undefined" ? window : globalThis);
