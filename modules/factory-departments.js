// แผนกของฝ่ายโรงงาน (โมดูล "ฝ่ายโรงงาน" ในโหมดทดสอบ) — ข้อมูลล้วน ไม่มี DOM/Supabase
//
// code ตรงกับ departments.code ในฐานข้อมูล (PP: 20260922010000, RB/GR/BG/PT/PK: 20260917070000)
// แต่ departments.name_th ของแผนกเหล่านี้ยังเป็นตัวย่อ ชื่อไทยที่แสดงในโมดูลนี้จึงเก็บที่ไฟล์นี้ก่อน
// ยังไม่แก้ตารางจริงเพราะชื่อแผนกถูกใช้ร่วมกับหน้าขอเปิดบัญชี/NCR/คำร้อง (ต้องผ่าน migration แยก)
//
// ลำดับในรายการ = ลำดับที่แสดงบนหน้าโมดูล เทสต์ที่ scripts/tests/factory-departments.test.mjs
(function (root) {
  // theme: [สีต้น, สีปลาย] ของการ์ด — สีต้นทุกสีเทียบกับตัวอักษรสีขาวได้ contrast ≥ 4.5:1
  const DEPARTMENTS = Object.freeze([
    { code: "PP", name: "วางแผนการผลิต", theme: Object.freeze(["#2563eb", "#1e40af"]) },
    { code: "RB", name: "ขึ้นรูปยาง", theme: Object.freeze(["#c2410c", "#9a3412"]) },
    { code: "GR", name: "แปรรูปยาง", theme: Object.freeze(["#047857", "#065f46"]) },
    { code: "PT", name: "ขึ้นรูปพลาสติก", theme: Object.freeze(["#0e7490", "#155e75"]) },
    { code: "BG", name: "เย็บจักร", theme: Object.freeze(["#be185d", "#9d174d"]) },
    { code: "PK", name: "ประกอบบรรจุภัณฑ์", theme: Object.freeze(["#6d28d9", "#5b21b6"]) },
  ].map((department) => Object.freeze(department)));

  // หาแผนกจากรหัส (ไม่สนตัวพิมพ์/ช่องว่างหัวท้าย) — ไม่พบคืน null ไม่เดาให้
  function find(code) {
    const key = String(code ?? "").trim().toUpperCase();
    return DEPARTMENTS.find((department) => department.code === key) ?? null;
  }

  // ลิงก์ไปหน้าโมดูล: ใส่ dept เฉพาะรหัสที่รู้จัก ค่าอื่นพากลับหน้ารวมแทนที่จะส่งต่อค่าที่ไม่ตรวจ
  function url(code) {
    const department = find(code);
    return department ? `#/factory?dept=${encodeURIComponent(department.code)}` : "#/factory";
  }

  const api = { DEPARTMENTS, find, url };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_FACTORY = api;
})(typeof window !== "undefined" ? window : globalThis);
