// โมดูลแผนก GR — แปรรูปยาง (ลำดับ 07 ของผังงาน) #/gr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · บันทึกผลรายวัน (?tab=log) · ยางเส้นยาว (?tab=rods) · ส่งให้ PK (?tab=pk) · สรุปผล (?tab=summary)
// · ตั้งค่าขั้นตอนและเป้า (?tab=settings · เฉพาะหัวหน้าแผนก GR และฝ่ายวางแผน) · หน้างาน ?job=<เลขงาน> (อยู่ใต้ "งานของฉัน")
// หน้าทั้งหมดอยู่ใน modules/gr-pages.js (โหลดก่อนไฟล์นี้): ผลรายวันต่อคน × ขั้น × วัน ขอเบิกยางเส้นยาวจาก SR ส่งงานให้ PK (20261214010000)
(function registerGrModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_GR_PAGES;
  F.registerDeptModule({ code: "FACTORY_GR", dept: "GR", route: "gr", label: "แปรรูปยาง (GR)", icon: "machine", palette: "gr", menu: pages.MENU, keep: pages.KEEP, landing: pages.landing });
})();
