// โมดูลแผนก PT — ขึ้นรูปพลาสติก (ลำดับ 08 ของผังงาน) #/pt · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · บันทึกผลรายวัน (?tab=log) · วัตถุดิบจาก ST (?tab=materials) · ส่งให้ PK (?tab=pk) · สรุปผล (?tab=summary)
// · ตั้งค่าขั้นตอนและเป้า (?tab=settings · เฉพาะหัวหน้าแผนก PT และฝ่ายวางแผน) · หน้างาน ?job=<เลขงาน> · เสร็จแล้ว = ลิงก์ที่หัวหน้า "งานของฉัน" (?st=done)
// หน้าทั้งหมดอยู่ใน modules/gr-pages.js (ชุดเดียวกับ GR) และ modules/dept-pages.js (เฉพาะ PT / BG / PK): ผลรายวันต่อคน × ขั้น × วัน ส่งงานให้ PK (20261224010000)
(function registerPtModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_GR_PAGES;
  F.registerDeptModule({ code: "FACTORY_PT", dept: "PT", route: "pt", label: "ขึ้นรูปพลาสติก (PT)", icon: "mold", palette: "pt", menu: window.MNP_DEPT_PAGES.menuFor("PT"), keep: pages.KEEP, landing: pages.landing });
})();
