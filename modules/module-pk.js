// โมดูลแผนก PK — ประกอบและบรรจุ (ลำดับ 10 ของผังงาน) #/pk · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ PK ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.productionLanding): รายงานผล พักงาน/ทำต่อ และปิดงาน (ฝ่ายวางแผน) ได้ที่นี่ ชุดเดียวกับ BOM "งานของฉัน" (ลิงก์ที่หัวหน้า)
(function registerPkModule() {
  const F = window.MNP_FACTORY;
  F.registerDeptModule({ code: "FACTORY_PK", dept: "PK", route: "pk", label: "ประกอบและบรรจุ (PK)", icon: "box", palette: "pk", landing: F.productionLanding("PK") });
})();
