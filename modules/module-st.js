// โมดูลแผนก ST — คลังวัตถุดิบ (ลำดับ 03 ของผังงาน) #/st · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · ในคลัง (?tab=stock) · วัตถุดิบที่กัก (?tab=hold · ชุดเดียวกับ #/qa?tab=material) · ใบสั่งซื้อ (?tab=po) · จ่ายออก (?tab=issue) · รับคืน (?tab=returns) · นับสต็อก (?tab=count) · หน้าของซื้อ ?part= และหน้าล็อตเคมี ?lot= (อยู่ใต้ "ในคลัง")
// หน้าทั้งหมดอยู่ใน modules/st-pages.js (โหลดก่อนไฟล์นี้): ของซื้อ (store ของ BOM) และเคมี ใบสั่งซื้อ ใบขอเบิก / ใบคืนของ RB (store ของ RubberFlow · 20261220010000) ในที่เดียว
// ผู้เข้าชมทางลิงก์ (ไม่อยู่ในเมนู): แผนก RB ดูเคมีในคลัง ST อย่างเดียว · แผนก WH ดูและนับของซื้อ (MNP_ST_PAGES.guest)
(function registerStModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_ST_PAGES;
  F.registerDeptModule({ code: "FACTORY_ST", dept: "ST", route: "st", label: "คลังวัตถุดิบ (ST)", icon: "box", palette: "st", menu: pages.MENU, keep: pages.KEEP, guest: pages.guest, landing: pages.landing });
})();
