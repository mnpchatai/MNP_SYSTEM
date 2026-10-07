// เมนู "Item master" ของฝ่ายโรงงาน (โหมดทดสอบ) — โครงสร้างต้นไม้ โฟลเดอร์ > รายการเอกสาร
// ข้อมูลล้วน ไม่มี DOM/Supabase
//
// ที่มา: ภาพเมนู Item master ที่ผู้ใช้ส่งมาเป็นแบบอย่าง (โฟลเดอร์ 6 อัน กางแล้วเห็นรายการเอกสารด้านใน)
// ภาพนั้นเห็นรายการภายในครบเฉพาะบางส่วนของโฟลเดอร์ "โครงสร้าง" (ชื่อรายการที่เหลือถูกตัดขอบภาพ)
// จึงใส่เฉพาะชื่อที่อ่านได้ครบ — ไม่เดาชื่อที่ไม่เห็น
// ต่อมาย้ายแอป Item Master ที่ผู้ใช้ส่งมาเข้าระบบ (ผู้ใช้เลือก "ใส่ในโฟลเดอร์เดิม"):
//   * "สินค้า" = ทะเบียนสินค้า, "โครงสร้าง" (โครงสร้างสินค้า = BOM) = สูตรการผลิต
//   * ส่วนที่ไม่มีโฟลเดอร์ในภาพ (Routing, คลัง, ใบสั่งผลิต) เพิ่มเป็นโฟลเดอร์ใหม่ต่อท้ายโฟลเดอร์ในภาพ
//   * ราคา / ผู้ร่วมมือ / ใบเสนอราคา / ใบสั่งขาย ยังไม่มีรายการ
// ต่อมาเปิดการสร้างโครงสร้างสินค้า (BOM) ฉบับร่างและส่งให้ admin อนุมัติ:
//   * "-ใหม่" = ฟอร์มสร้างฉบับร่าง (และแก้ฉบับร่างด้วย &bom=<id> / ออก Revision ใหม่จากฉบับที่อนุมัติแล้วด้วย &from=<id>)
//   * "-แก้ไข" = รายการฉบับร่างที่แก้ได้ (รวมฉบับที่ถูกส่งกลับพร้อมเหตุผล)
//   * "-อนุมัติ" (เพิ่มใหม่ ไม่อยู่ในภาพเมนูเดิม) = คิวรออนุมัติของผู้ดูแลระบบ
// view = หน้าจอที่ modules/module-factory-master.js วาดให้รายการนั้น (ไม่มี view = หน้าว่าง "ยังไม่เปิดใช้งาน")
// เมื่อได้รายการครบให้เพิ่มที่ไฟล์นี้ที่เดียว (key ต้องไม่ซ้ำทั้งเมนู)
//
// เทสต์ที่ scripts/tests/factory-item-master.test.mjs
(function (root) {
  const entry = (key, name, view = null) => Object.freeze({ key, name, view });
  const folder = (key, name, entries = []) => Object.freeze({ key, name, entries: Object.freeze(entries) });

  const FOLDERS = Object.freeze([
    folder("structure", "โครงสร้าง", [
      entry("structure-new", "โครงสร้างสินค้า-ใหม่", "bom-new"),
      entry("structure-edit", "โครงสร้างสินค้า-แก้ไข", "bom-drafts"),
      entry("structure-approve", "โครงสร้างสินค้า-อนุมัติ", "bom-approvals"),
      entry("structure-view", "โครงสร้างสินค้า-ดู", "bom"),
    ]),
    folder("item", "สินค้า", [
      entry("item-list", "ทะเบียนสินค้า", "items"),
      entry("item-new", "สินค้า-ใหม่", "item-new"),
      entry("item-history", "ประวัติการแก้ไขสินค้า", "history"),
    ]),
    folder("price", "ราคา"),
    folder("partner", "ผู้ร่วมมือ"),
    folder("quotation", "ใบเสนอราคา"),
    folder("sales-order", "ใบสั่งขาย"),
    folder("routing", "ขั้นตอนการผลิต", [entry("routing-view", "ขั้นตอนการผลิต-ดู", "routing")]),
    folder("inventory", "คลังสินค้า", [entry("inventory-view", "สินค้าคงคลัง-ดู", "inventory")]),
    folder("production", "ใบสั่งผลิต", [entry("production-view", "ใบสั่งผลิต-ดู", "production")]),
  ]);

  // พารามิเตอร์เพิ่มเติมที่หน้าของรายการใช้ได้ (ตัวกรอง/รายการที่เลือก) — ชื่ออื่นถูกทิ้ง
  const EXTRA_PARAMS = Object.freeze(["id", "edit", "bom", "from", "routing", "qty", "q", "type", "brand", "status", "sort", "page"]);

  // หารายการจาก key ของรายการ — ไม่พบคืน null ไม่เดาให้ (key มาจาก DOM จึงถือเป็นข้อมูลที่ยังไม่ตรวจ)
  function findEntry(key) {
    const wanted = String(key ?? "");
    for (const parent of FOLDERS) {
      const found = parent.entries.find((candidate) => candidate.key === wanted);
      if (found) return Object.freeze({ folder: parent, entry: found });
    }
    return null;
  }

  // ลิงก์ไปหน้าของรายการ — ใส่ item เฉพาะ key ที่รู้จัก ค่าอื่นพากลับหน้ารวมของฝ่ายโรงงาน
  // extra: { id, bom, q, ... } ใส่เฉพาะชื่อใน EXTRA_PARAMS ที่มีค่า (encode ทุกค่า)
  function url(key, extra = {}) {
    const found = findEntry(key);
    if (!found) return "#/factory";
    const query = new URLSearchParams({ item: found.entry.key });
    for (const name of EXTRA_PARAMS) {
      const value = extra?.[name];
      if (value !== undefined && value !== null && value !== "") query.set(name, String(value));
    }
    return `#/factory?${query}`;
  }

  const api = { FOLDERS, EXTRA_PARAMS, findEntry, url };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY_ITEM_MASTER = api;
})(typeof window !== "undefined" ? window : globalThis);
