// สำเนาใบตรวจ QC ไปสเปรดชีต และดาวน์โหลดใบตรวจเป็น Excel ตามฟอร์ม QA01-PM11 ผ่าน Apps Script (apps-script/qc-sheet/Code.gs)
//
// Apps Script โปรเจกต์เดียวรับทั้งสองงานที่ URL เดียวกัน:
//   สำเนา (sync)   POST { batch: [{ key: "qc:<id>", value: "<JSON ของ record>" }] } → ชีตซ่อน QC_DATA + ชีต "รายงานQC" (แถวเดียวต่อใบ)
//   ดาวน์โหลด Excel POST { form: "qc", fileName, record }                           → วาดฟอร์ม QA01-PM11 ด้วยโค้ด คืน .xlsx เป็น base64
// เป็นแค่สำเนาสำรอง/ไฟล์ส่งออก — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/ขั้นตอนทั้งหมด
// Apps Script ไม่อ่านข้อมูลใบใดจากชีตตอนส่งออก คนที่ได้ URL ไปจึงดึงข้อมูลใบของคนอื่นไม่ได้ (ดู README ในโฟลเดอร์สคริปต์)
//
// record สร้างโดย buildSheetRecord / buildFormExport ใน modules/qc-model.js · ส่วนที่ไม่แตะ DOM เทสต์ที่ scripts/tests/qc-sheet.test.mjs
(function registerQcSheet(root) {
  // URL ของ Web App ที่ได้จากการ deploy apps-script/qc-sheet/Code.gs (ลงท้าย /exec) ใส่หลังติดตั้งตาม README
  // ว่าง = ยังไม่ได้ติดตั้ง: ปุ่มดาวน์โหลด Excel ถูกซ่อนและไม่ส่งสำเนา ต้องเป็นโปรเจกต์ใหม่แยก ห้ามซ้ำกับ URL ของ NCR / MT / MG (เทสต์ตรวจไว้)
  const EXPORT_URL = "";
  const SYNC_URL = "";

  const shouldSync = (record, url = SYNC_URL) => Boolean(url) && Boolean(record?.id) && Boolean(record.reportNo);

  // fire-and-forget แบบเดียวกับ modules/ncr-sheet-sync.js: no-cors อ่านผลกลับไม่ได้และแนบ token ไม่ได้
  // ยิงไม่สำเร็จก็แค่ log ไว้ ไม่กระทบผู้ใช้ — คืน true เมื่อส่งคำขอออกไป
  function sync(record, { url = SYNC_URL, fetchImpl = (...args) => root.fetch(...args) } = {}) {
    if (!shouldSync(record, url)) return false;
    fetchImpl(url, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ batch: [{ key: `qc:${record.id}`, value: JSON.stringify(record) }] }),
    }).catch((error) => console.warn("ซิงก์ใบตรวจ QC ไปสเปรดชีตไม่สำเร็จ", error));
    return true;
  }

  // ไฟล์ base64 จาก Apps Script → ไบต์
  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }

  // ส่งแบบ text/plain (simple request ไม่มี preflight) Apps Script redirect ไป googleusercontent ที่เปิด CORS ให้อ่านผลได้
  async function requestXlsx(payload, fetchImpl = root.fetch?.bind(root), url = EXPORT_URL) {
    if (!url) throw new Error("ยังไม่ได้ตั้งค่าการดาวน์โหลดเอกสาร");
    let response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
    } catch {
      throw new Error("เชื่อมต่อระบบสร้างเอกสารไม่ได้ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่");
    }
    const result = await response.json().catch(() => null);
    if (!response.ok || !result?.ok || typeof result.base64 !== "string") {
      // แนบรหัสจาก Apps Script (NOT_CONFIGURED, BAD_RECORD, FAILED_EXPORT_403 ...) ไว้ไล่สาเหตุตาม README
      const code = typeof result?.error === "string" && /^[A-Z0-9_]{1,40}$/.test(result.error) ? result.error : `HTTP_${response.status}`;
      throw new Error(`สร้างไฟล์ Excel ไม่สำเร็จ (${code}) กรุณาลองใหม่อีกครั้ง`);
    }
    return new Blob([base64ToBytes(result.base64)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }

  // ปุ่มดาวน์โหลดในหน้าใบตรวจ — helpers = { showToast, friendlyError } ของ app.js
  async function downloadXlsx(button, payload, helpers, { request = requestXlsx } = {}) {
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "กำลังสร้างไฟล์…";
    try {
      const blob = await request(payload);
      const url = URL.createObjectURL(blob);
      const link = Object.assign(document.createElement("a"), { href: url, download: payload.fileName });
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (exportError) {
      helpers.showToast(helpers.friendlyError(exportError), "error");
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  }

  const api = { EXPORT_URL, SYNC_URL, shouldSync, sync, requestXlsx, downloadXlsx };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_QC_SHEET = api;
})(typeof window !== "undefined" ? window : globalThis);
