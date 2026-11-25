// โมดูลแผนก PK — ประกอบและบรรจุ (ลำดับ 10 ของผังงาน) #/pk · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน: การ์ดรับจาก GR / PT / BG แล้วการ์ดงาน): งานของฉัน · บันทึกผลรายวัน (?tab=log) · รอรับของ (?tab=incoming) · ส่งให้ WH (?tab=wh) · สรุปผล (?tab=summary)
// · ตั้งค่าขั้นตอนและเป้า (?tab=settings · เฉพาะหัวหน้าแผนก PK และฝ่ายวางแผน) · หน้างาน ?job=<เลขงาน> · เสร็จแล้ว = ลิงก์ที่หัวหน้า "งานของฉัน" (?st=done)
// หน้าทั้งหมดอยู่ใน modules/gr-pages.js (ชุดเดียวกับ GR · การ์ดรับจาก GR / PT / BG = pkCards) และ modules/dept-pages.js (ความพร้อมของที่ต้องรับ รอรับของ ส่งให้ WH): 3 ขั้น ประกอบ → ใส่กระเป๋า → บรรจุกล่อง (20261224010000)
(function registerPkModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_GR_PAGES;
  F.registerDeptModule({ code: "FACTORY_PK", dept: "PK", route: "pk", label: "ประกอบและบรรจุ (PK)", icon: "box", palette: "pk", menu: window.MNP_DEPT_PAGES.menuFor("PK"), keep: pages.KEEP, landing: pages.landing });
})();
