// โมดูลแผนก SA — ฝ่ายขาย (ลำดับ 1 ของผังงาน) #/sa · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · ออกใบสั่งผลิต (?tab=new) · ใบของฝ่ายขาย (?tab=orders) · ทะเบียนลูกค้า (?tab=customers) · หน้าใบ ?order=<เลขใบ>
// หน้าทั้งหมดอยู่ใน modules/sa-pages.js (โหลดก่อนไฟล์นี้) · พนักงานและหัวหน้าแผนก SA เห็นเฉพาะโมดูลนี้ · ฝ่ายวางแผน (PP) และผู้จัดการเห็นทุกโมดูล (กติกาเดียวกับโมดูลแผนกอื่น)
(function registerSaModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_SA_PAGES;
  F.registerDeptModule({ code: "FACTORY_SA", dept: "SA", route: "sa", label: "ฝ่ายขาย (SA)", icon: "tag", palette: "sa", flowNo: 1, menu: pages.MENU, keep: pages.KEEP, landing: pages.landing });
})();
