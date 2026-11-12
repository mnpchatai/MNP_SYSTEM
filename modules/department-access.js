// แผนกที่เห็นเฉพาะบางโมดูล (ตัดสินจากรหัสแผนกของพนักงาน employee.department.code)
// เป็นรายการที่อนุญาต: โมดูลที่เพิ่มเข้าระบบภายหลังจะไม่โผล่ให้แผนกเหล่านี้ จนกว่าจะเพิ่มรหัสโมดูลในรายการนี้
// - ID (Indesign): เห็นเฉพาะแจ้งซ่อม MT และแจ้งซ่อม IT ทุกคนในแผนกไม่มีข้อยกเว้น รวม admin (ผู้ใช้กำหนด 2026-11-12)
// เป็น UX ล้วน (ซ่อนเมนู การ์ดโมดูล และพาออกจากหน้าของโมดูลอื่น) — สิทธิ์จริงยังตัดสินที่ฐานข้อมูล (RLS/RPC) ตามเดิม
(function () {
  const POLICIES = {
    ID: ["MT_REPAIR", "IT_REPAIR"],
  };
  // หน้ากลางที่ใช้ติดตาม/อนุมัติใบของโมดูลที่อนุญาต (รายการในหน้าเหล่านี้กรองเหลือเฉพาะโมดูลที่อนุญาต)
  // หน้าของโมดูล (เช่น #/mt-dashboard ของ MT_REPAIR) เปิดได้เมื่อโมดูลเจ้าของหน้าอยู่ในรายการ
  const SHARED_ROUTES = new Set(["dashboard", "approvals", "requests", "new", "repair/new", "request", "notifications", "profile"]);

  const allowedModules = (employee) => {
    const code = employee?.department?.code;
    return typeof code === "string" && Object.prototype.hasOwnProperty.call(POLICIES, code) ? new Set(POLICIES[code]) : null;
  };
  const isRestricted = (employee) => allowedModules(employee) !== null;
  const moduleAllowed = (employee, code) => {
    const allowed = allowedModules(employee);
    return !allowed || allowed.has(code);
  };
  // moduleCode = โมดูลเจ้าของหน้านั้น (null ถ้าไม่ใช่หน้าของโมดูล)
  const routeAllowed = (employee, path, moduleCode = null) => {
    if (!isRestricted(employee)) return true;
    if (SHARED_ROUTES.has(path)) return true;
    return Boolean(moduleCode) && moduleAllowed(employee, moduleCode);
  };

  const api = { isRestricted, moduleAllowed, routeAllowed };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_DEPARTMENT_ACCESS = api;
})();
