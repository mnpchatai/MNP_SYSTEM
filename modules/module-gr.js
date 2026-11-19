// โมดูลแผนก GR — แปรรูปยาง (ลำดับ 07 ของผังงาน) #/gr · เมนูกลุ่ม "โรงงาน" ในโหมดทดสอบ (ลงทะเบียนผ่าน MNP_FACTORY.registerDeptModule ใน modules/factory-kit.js)
// หน้าแรก = งานของ GR ที่ยังเปิดอยู่ ใช้การ์ดงานกลาง (MNP_FACTORY.productionLanding): รายงานผล พักงาน/ทำต่อ และปิดงาน (ฝ่ายวางแผน) ได้ที่นี่ ชุดเดียวกับ BOM "งานของฉัน"
// เมนูข้างมี "ยางเส้นยาวในคลัง SR" (?tab=rods): ตารางเดียวกับหน้า "ในคลัง" ของโมดูล SR แบบอ่านอย่างเดียว (GR เปิดโมดูล SR ไม่ได้ จึงดูยอดและตำแหน่งที่นี่) ไม่มีปุ่มทำรายการ
(function registerGrModule() {
  const F = window.MNP_FACTORY;
  const work = F.productionLanding("GR");
  const RODS = Object.freeze({ id: "rods", label: "ยางเส้นยาวในคลัง SR", icon: "ruler", params: { tab: "rods" } });

  function landing(ctx) {
    if (ctx.view?.id !== RODS.id) return work(ctx);
    // ตารางจากโมดูล SR (window.MNP_SR · โหลดแล้วตอนวาดหน้า) · ไม่มีโมดูล SR = บอกตรงๆ แทนหน้าว่าง
    const stock = window.MNP_SR?.stockView?.(ctx, { readOnly: true });
    return { html: `${F.viewHead(ctx)}${stock?.html ?? ctx.ui.card(ctx.ui.empty("ไม่พบข้อมูลยางเส้นยาวในคลัง"))}`, bind: window.MNP_SR?.bindPage };
  }
  landing.menu = Object.freeze([...work.menu, RODS]);

  F.registerDeptModule({ code: "FACTORY_GR", dept: "GR", route: "gr", label: "แปรรูปยาง (GR)", icon: "machine", palette: "gr", keep: ["own", "loc"], landing });
})();
