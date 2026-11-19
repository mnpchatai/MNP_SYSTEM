// โมดูลแผนก PT — ขึ้นรูปพลาสติก (ลำดับ 08 ของผังงาน) #/pt · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ PT ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.productionLanding): รายงานผล พักงาน/ทำต่อ และปิดงาน (ฝ่ายวางแผน) ได้ที่นี่ ชุดเดียวกับ BOM "งานของฉัน" (ลิงก์ที่หัวหน้า)
(function registerPtModule() {
  const F = window.MNP_FACTORY;
  F.registerDeptModule({ code: "FACTORY_PT", dept: "PT", route: "pt", label: "ขึ้นรูปพลาสติก (PT)", icon: "mold", palette: "pt", landing: F.productionLanding("PT") });
})();
