// แผนกที่เห็นเฉพาะบางโมดูล (ตัดสินจากรหัสแผนกของพนักงาน employee.department.code)
// เป็นรายการที่อนุญาต: โมดูลที่เพิ่มเข้าระบบภายหลังจะไม่โผล่ให้แผนกเหล่านี้ จนกว่าจะเพิ่มรหัสโมดูลในรายการนี้
// - ID (Indesign): เห็นเฉพาะแจ้งซ่อม MT และแจ้งซ่อม IT ทุกคนในแผนกไม่มีข้อยกเว้น รวม admin (ผู้ใช้กำหนด 2026-11-12)
// เป็น UX ล้วน (ซ่อนเมนู การ์ดโมดูล การแจ้งเตือนในหน้าเว็บ และพาออกจากหน้าของโมดูลอื่น) — สิทธิ์จริงยังตัดสินที่ฐานข้อมูล (RLS/RPC)
// ตามเดิม และการแจ้งเตือนทางอีเมล/บนเครื่อง (Web Push) ที่ฐานข้อมูลส่งเองยังไม่ถูกกรอง
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

  // การแจ้งเตือน (แถว notifications) ที่แผนกนั้นยังเห็น — ปิดไว้ก่อนเมื่อไม่แน่ใจ:
  // - ผูกใบคำร้อง (request_id): เห็นเมื่อประเภทใบเป็นโมดูลที่อนุญาต (requestTypeOf(id) คืนรหัสประเภท หรือ null ถ้าอ่านใบไม่ได้)
  // - สรุปงานค้าง (action_url "/" + digest): เห็นเมื่อทุกงานในสรุปเป็นใบคำร้องของโมดูลที่อนุญาต
  // - เรื่องข้อมูลส่วนตัว (/profile): เห็น · อื่น ๆ (NCR, ผู้ดูแลระบบ, ไม่มีลิงก์) ไม่เห็น
  const notificationAllowed = (employee, item, requestTypeOf) => {
    if (!isRestricted(employee)) return true;
    if (item?.request_id) return moduleAllowed(employee, requestTypeOf(item.request_id));
    if (item?.action_url === "/profile") return true;
    if (item?.action_url === "/") {
      const digest = Array.isArray(item.digest) ? item.digest : [];
      return digest.length > 0 && digest.every((entry) => entry?.item_type === "request" && typeof entry.item_id === "string" && moduleAllowed(employee, requestTypeOf(entry.item_id)));
    }
    return false;
  };
  // ใบคำร้องที่ต้องรู้ประเภทเพื่อตัดสินการแจ้งเตือนชุดนี้
  const notificationRequestIds = (items) => {
    const ids = new Set();
    for (const item of items ?? []) {
      if (item?.request_id) ids.add(item.request_id);
      for (const entry of Array.isArray(item?.digest) ? item.digest : []) {
        if (entry?.item_type === "request" && typeof entry.item_id === "string") ids.add(entry.item_id);
      }
    }
    return [...ids];
  };

  const api = { isRestricted, moduleAllowed, routeAllowed, notificationAllowed, notificationRequestIds };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_DEPARTMENT_ACCESS = api;
})();
