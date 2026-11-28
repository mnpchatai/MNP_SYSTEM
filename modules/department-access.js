// แผนกที่เห็นเฉพาะบางโมดูล (ตัดสินจากรหัสแผนกของพนักงาน employee.department.code)
// เป็นรายการที่อนุญาต: โมดูลที่เพิ่มเข้าระบบภายหลังจะไม่โผล่ให้แผนกเหล่านี้ จนกว่าจะเพิ่มรหัสโมดูลในรายการนี้
// - ID (Indesign): เห็นเฉพาะแจ้งซ่อม MT และแจ้งซ่อม IT ทุกคนในแผนกไม่มีข้อยกเว้น รวม admin (ผู้ใช้กำหนด 2026-11-12)
//   OFFICE (ระบบสำนักงาน) อยู่ในรายการเพียงเพื่อให้เมนูและหน้าเลือกระบบเปิดได้ เพราะใบแจ้งซ่อม IT (IT_COMPUTER_REPAIR = โมดูล itrp) อยู่ใต้เมนูนี้ (ระบบสำนักงาน › IT SUPPORT)
//   OFFICE ไม่ได้เปิดสิทธิ์ให้การ์ดอื่นในเมนู: แต่ละการ์ดมีรหัสโมดูลของตัวเอง (IT_COMPUTER_REPAIR, IT_WORK_ORDER, HR) และกรองด้วย moduleAllowed อีกชั้น
//   แผนก ID จึงเห็นแค่ IT SUPPORT › ใบแจ้งซ่อม IT ไม่เห็น HR และใบสั่งงาน IT (modules/office-sections.js) · แผนกที่ไม่เหลือการ์ดใดเลยไม่เห็นเมนู
//   IT_REPAIR (โมดูลคำร้องกลางเดิม) ยังอยู่ในรายการ: ใบเก่าและลิงก์เก่ายังเปิดได้ เพียงไม่มีการ์ดชี้ไปแล้ว
// ฝั่งหน้าเว็บเป็น UX ล้วน (ซ่อนเมนู การ์ดโมดูล การแจ้งเตือนในหน้าเว็บ และพาออกจากหน้าของโมดูลอื่น) — สิทธิ์จริงยังตัดสินที่ฐานข้อมูล (RLS/RPC)
// อีเมลและ Web Push กรองที่ฐานข้อมูลแล้ว: trigger notifications_department_filter + private.department_notification_allowed
// (migration 20261117010000, เพิ่ม IT_COMPUTER_REPAIR ใน 20261213010000) ใช้รายการ private.department_notification_modules
// แผนก ID ได้อีเมล/Push ของ MT_REPAIR, IT_REPAIR, IT_COMPUTER_REPAIR (ใบแจ้งซ่อมคอมพิวเตอร์) · ใบสั่งงาน IT (IT_WORK_ORDER) ไม่ได้ · "OFFICE" ไม่ใช่โมดูลแจ้งเตือน
// POLICIES ด้านล่างกับรายการในฐานข้อมูลต้องตรงกัน — แก้ที่หนึ่งต้องแก้อีกที่
(function () {
  const POLICIES = {
    ID: ["MT_REPAIR", "IT_REPAIR", "IT_COMPUTER_REPAIR", "OFFICE"],
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
  // - ใบขอสิทธิ์ IT (action_url /office/access/<id> ของโมดูล itar): เห็นเมื่อโมดูล IT_ACCESS_REQUEST อยู่ในรายการอนุญาต (แผนก ID ไม่เห็น)
  // - ใบแจ้งซ่อม IT (action_url /office/repair/<id> ของโมดูล itrp): เห็นเมื่อโมดูล IT_COMPUTER_REPAIR อยู่ในรายการอนุญาต (แผนก ID เห็น)
  // - เรื่องข้อมูลส่วนตัว (/profile): เห็น · อื่น ๆ (NCR, ใบสั่งงาน IT, ผู้ดูแลระบบ, ไม่มีลิงก์) ไม่เห็น
  const notificationAllowed = (employee, item, requestTypeOf) => {
    if (!isRestricted(employee)) return true;
    if (item?.request_id) return moduleAllowed(employee, requestTypeOf(item.request_id));
    if (item?.action_url === "/profile") return true;
    if (item?.action_url?.startsWith("/office/repair/")) return moduleAllowed(employee, "IT_COMPUTER_REPAIR");
    // ใบขอสิทธิ์ IT (action_url /office/access/<id> ของโมดูล itar): แผนกที่จำกัดโมดูล (ID) ไม่มี IT_ACCESS_REQUEST ในรายการ จึงไม่เห็น เหมือนใบสั่งงาน IT
    if (item?.action_url?.startsWith("/office/access/")) return moduleAllowed(employee, "IT_ACCESS_REQUEST");
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
