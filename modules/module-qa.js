// โมดูลแผนก QA — ตรวจคุณภาพ (ลำดับ 06 ของผังงาน) #/qa · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// เมนูข้าง (ค่าตั้งต้น = งานของฉัน): งานของฉัน · ผลตรวจ (?tab=records) · NCR (?tab=ncr) · CoA (?tab=coa) · SPC (?tab=spc) · สืบย้อนกลับ (?tab=trace) · วัตถุดิบที่กัก (?tab=material)
// หน้าทั้งหมดอยู่ใน modules/qa-pages.js (โหลดก่อนไฟล์นี้): ยางเส้นยาวที่ SR กัก (store ของ BOM) และล็อตในสายผลิต ผลตรวจ NCR CoA SPC สืบย้อนกลับ ล็อตวัตถุดิบที่กัก (store ของ RubberFlow) ในที่เดียว
// งาน QA ย้ายมาจาก RubberFlow (p=quality / spc / trace) และจาก #/st?lot= (กักกันวัตถุดิบ) · ตัดสินล็อตที่กัก / ปล่อยล็อต / ปลดกักกันวัตถุดิบ = หัวหน้า QA หรือผู้จัดการโรงงาน/ผู้ดูแลระบบ
(function registerQaModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_QA_PAGES;
  F.registerDeptModule({ code: "FACTORY_QA", dept: "QA", route: "qa", label: "ตรวจคุณภาพ (QA)", icon: "clipboard-check", palette: "qa", menu: pages.MENU, keep: pages.KEEP, landing: pages.landing });
})();
