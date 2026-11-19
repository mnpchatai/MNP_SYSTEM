// โมดูลแผนก GR — แปรรูปยาง (ลำดับ 07 ของผังงาน) #/gr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ GR ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.productionLanding): รายงานผล พักงาน/ทำต่อ และปิดงาน (ฝ่ายวางแผน) ได้ที่นี่ ชุดเดียวกับ BOM "งานของฉัน" (ลิงก์ที่หัวหน้า)
(function registerGrModule() {
  const F = window.MNP_FACTORY;
  F.registerDeptModule({ code: "FACTORY_GR", dept: "GR", route: "gr", label: "แปรรูปยาง (GR)", icon: "machine", palette: "gr", landing: F.productionLanding("GR") });
})();
