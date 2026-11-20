// โมดูลแผนก WH — คลังสินค้าสำเร็จรูป (ลำดับ 11 ของผังงาน) #/wh · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · ในคลัง (?tab=stock) · รับเข้า (?tab=receive) · ส่งมอบ (?tab=deliver) · ประวัติ (?tab=history) · หน้าใบ ?order=<ใบสั่งผลิต> · หน้าล็อต ?lot=<ล็อตของ RubberFlow> (อยู่ใต้ "ในคลัง")
// หน้าทั้งหมดอยู่ใน modules/wh-pages.js (โหลดก่อนไฟล์นี้): สินค้าสำเร็จรูปจาก PK (store ของ BOM) และกล่องสินค้าจาก RubberFlow (store ของ RubberFlow) ในที่เดียว
// การ์ดงานของ PK ใช้ชุดเดียวกับ BOM (MNP_FACTORY.deptWork) แต่ลิงก์เข้าหน้าใบของ WH · ปิดใบ (รับไม่ครบ) สั่งที่การ์ดได้เลย
(function registerWhModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_WH_PAGES;
  F.registerDeptModule({ code: "FACTORY_WH", dept: "WH", route: "wh", label: "คลังสินค้าสำเร็จรูป (WH)", icon: "warehouse", palette: "wh", menu: pages.MENU, keep: pages.KEEP, landing: pages.landing });
})();
