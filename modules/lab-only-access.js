// นโยบายฝั่งหน้าเว็บของบัญชีที่เห็นเฉพาะ MNP LAB (MNPLAB001, MNPLAB002)
// รายชื่อ ID อยู่ที่ฐานข้อมูลที่เดียว (private.lab_only_employee_nos) หน้าเว็บไม่รู้รายชื่อ: ถามผ่าน RPC app_lab_only
// แล้วเก็บเป็น employee.labOnly ไฟล์นี้ตัดสินแค่ว่าหน้าไหน/เมนูไหนยังแสดงให้บัญชีนั้น ซึ่งเป็น UX ล้วน
// ตัวบังคับจริงคือฐานข้อมูล (supabase/migrations/20261019005000_lab_only_accounts.sql: RPC ทุกตัวและทุกตารางปฏิเสธบัญชีนี้)
(function () {
  const HOME = "lab";
  // หน้าที่เปิดได้: MNP LAB และข้อมูลส่วนตัวของตนเอง (ลิงก์ตั้งรหัสผ่านทำงานก่อนล็อกอิน จึงไม่ผ่านด่านนี้)
  const ROUTES = new Set(["lab", "profile"]);
  // โมดูลที่เมนูข้างยังแสดง (ตรงกับ code ที่โมดูลลงทะเบียนใน window.MNP_REQUEST_MODULES)
  const MODULE_CODES = new Set(["MNP_LAB"]);

  const isLabOnly = (employee) => employee?.labOnly === true;
  const routeAllowed = (path) => ROUTES.has(path);
  const moduleAllowed = (code) => MODULE_CODES.has(code);

  const api = { HOME, isLabOnly, routeAllowed, moduleAllowed };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else window.MNP_LAB_ONLY = api;
})();
