// โมดูลแผนก BG — เย็บจักร เย็บกระเป๋าใส่สินค้า (ลำดับ 09 ของผังงาน) #/bg · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ BG ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.productionLanding): รายงานผล พักงาน/ทำต่อ และปิดงาน (ฝ่ายวางแผน) ได้ที่นี่ ชุดเดียวกับ BOM "งานของฉัน" (ลิงก์ที่หัวหน้า)
(function registerBgModule() {
  const F = window.MNP_FACTORY;
  F.registerDeptModule({ code: "FACTORY_BG", dept: "BG", route: "bg", label: "เย็บจักร (BG)", icon: "layers", palette: "bg", landing: F.productionLanding("BG") });
})();
