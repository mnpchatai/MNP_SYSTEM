// โมดูลต้นทุนการผลิต #/cost — เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบเท่านั้น (ลงทะเบียนใน window.MNP_REQUEST_MODULES เหมือน BOM / โมดูลรายแผนก แต่ไม่ใช่แผนก จึงไม่มีรหัสแผนก)
// เมนูเห็นเฉพาะผู้ที่เห็นต้นทุน (modules/cost-rules.js canSeeCost: ผู้จัดการทั่วไป · ผู้จัดการโรงงาน · admin · แผนก PP) · แผนก ST ไม่เห็นเมนูนี้ (เห็นราคาเคมีที่ #/st?tab=stock)
// หน้าทั้งหมดอยู่ใน modules/cost-pages.js (โหลดก่อนไฟล์นี้) · เมนูท้ายกลุ่ม (ไม่มี flowNo ในผังงาน) · การซ่อนเมนูเป็นแค่ UX สิทธิ์จริงตัดสินที่ฐานข้อมูล (RF_FORBIDDEN)
(function registerCostModule() {
  const F = window.MNP_FACTORY;
  const pages = window.MNP_COST_PAGES;
  const rules = window.MNP_COST_RULES;
  const code = "FACTORY_COST";
  const modules = (window.MNP_REQUEST_MODULES ??= {});
  if (modules[code]) throw new Error(`โมดูล ${code} ลงทะเบียนแล้ว`);
  modules[code] = {
    code, enabled: true, standalone: true, sandbox: true, label: pages.LABEL, palette: "cost",
    navAllowed: (employee) => employee?.isSandbox === true && rules.canSeeCost(employee),
    nav: [{ path: pages.ROUTE, label: pages.LABEL, icon: window.MNP_UI_ICONS?.icon?.(pages.ICON) ?? "", sandboxOnly: true, group: F.FACTORY_GROUP, subnav: pages.subnav }],
    pages: { [pages.ROUTE]: (params) => pages.render(params) },
  };
})();
