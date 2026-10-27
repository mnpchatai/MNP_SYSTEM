/**
 * สำรองใบแจ้งซ่อม/ใบคำร้อง MT จาก Pilot Web ไว้ในสเปรดชีตระบบแจ้งซ่อม (ชุดเขียนใหม่ แทนโค้ดเดิมที่ถูกวางทับ)
 *
 * Supabase เป็นฐานข้อมูลหลักและบังคับสิทธิ์/workflow ทั้งหมด ชีตนี้เป็นแค่สำเนาไว้ดู/รายงาน/พิมพ์ฟอร์ม
 * Pilot Web (modules/module-mt.js → syncRepairOrderToAppsScript) ยิง POST ทุกครั้งที่เปิดหน้ารายละเอียดใบ:
 *   body { batch: [{ key: "order:<uuid>", value: "<JSON ของใบ>" }] }   (fetch แบบ no-cors อ่านผลกลับไม่ได้)
 *
 * เก็บ 2 ชั้น:
 *   - ชีต "KV": key/value ดิบ (JSON ทั้งก้อน) upsert ตาม key — FormFill.gs อ่าน formCells จากที่นี่ไปเติมฟอร์ม
 *   - ชีต "ใบแจ้งซ่อม": แกะฟิลด์ลงคอลัมน์อ่านง่าย upsert ตาม "รหัสอ้างอิงระบบ"
 * ข้อผิดพลาดบันทึกในชีต "บันทึกข้อผิดพลาด"
 *
 * ไฟล์นี้อยู่โปรเจกต์เดียวกับ FormFill.gs (Extensions > Apps Script ของสเปรดชีตนี้) วิธีติดตั้งดู README.md
 * ห้ามวางโค้ดของ apps-script/mt-form-export/ ในโปรเจกต์นี้ (คนละ Web App)
 */

var KV_SHEET = 'KV';
var KV_HEADERS = ['key', 'value'];
var ORDER_SHEET = 'ใบแจ้งซ่อม';
var ERROR_SHEET = 'บันทึกข้อผิดพลาด';
var TZ = 'Asia/Bangkok';

var ORDER_HEADERS = [
  'เลขที่เอกสาร', 'แผนก', 'รหัสเครื่องจักร', 'ชื่อเครื่องจักร', 'อาการ/สาเหตุ', 'วันที่ต้องการใช้งาน', 'ผู้แจ้ง', 'แจ้งเมื่อ',
  'สถานะ', 'อนุมัติผจก.โรงงาน', 'โดย/เมื่อ (ผจก.โรงงาน)', 'หมายเหตุ (ผจก.โรงงาน)', 'อนุมัติผจก.ทั่วไป',
  'โดย/เมื่อ (ผจก.ทั่วไป)', 'หมายเหตุ (ผจก.ทั่วไป)', 'ช่างผู้รับผิดชอบ', 'วันที่เริ่มงาน', 'วันที่คาดว่าจะเสร็จ', 'มอบหมายโดย',
  'มอบหมายเมื่อ', 'จำนวนรูปภาพ', 'ประเภทเอกสาร', 'ผู้รับใบแจ้งซ่อม', 'การดำเนินงาน', 'วิเคราะห์สาเหตุ/อาการที่ชำรุด',
  'ความคิดเห็นของช่างผู้ตรวจสอบ', 'รายการอะไหล่/วัสดุที่ใช้', 'ผลการตรวจสอบของผู้แจ้ง (ล่าสุด)', 'ประวัติตรวจสอบไม่ผ่าน',
  'รหัสอ้างอิงระบบ',
];
var ID_COL = ORDER_HEADERS.length; // คอลัมน์ "รหัสอ้างอิงระบบ" (AD)

// ต้องตรงกับ mapRepairAppsScriptStatus ใน modules/module-mt.js
var STATUS_LABELS = {
  PENDING_FM: 'รออนุมัติ (ผจก.โรงงาน)', PENDING_GM: 'รออนุมัติ (ผจก.ทั่วไป)',
  NEEDS_INFO_FM: 'ต้องการข้อมูลเพิ่มเติม (ผจก.โรงงาน)', NEEDS_INFO_GM: 'ต้องการข้อมูลเพิ่มเติม (ผจก.ทั่วไป)',
  PENDING_ASSIGN: 'รอมอบหมายช่าง', ASSIGNED: 'รอดำเนินการ', IN_PROGRESS: 'กำลังดำเนินการ',
  PENDING_VERIFY: 'รอผู้แจ้งตรวจสอบผลการซ่อม', DONE: 'ซ่อมเรียบร้อย', REJECTED: 'ไม่อนุมัติ',
};
var DOC_TYPE_LABELS = { request: 'ใบคำร้อง', repair: 'ใบแจ้งซ่อม' };
var EXECUTION_PLAN_LABELS = { immediate: 'ดำเนินการได้ทันที', need_purchase: 'ต้องการสั่งซื้ออุปกรณ์', use_existing: 'ใช้อุปกรณ์ที่มีอยู่' };
var OPINION_LABELS = { send_repair: 'ส่งซ่อม', external: 'เรียกช่างภายนอกมาซ่อม', self_repair: 'ซ่อมเอง', buy_parts: 'ซื้ออุปกรณ์มาทำเอง' };

function doGet() {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var batch = Array.isArray(payload.batch) ? payload.batch : [];
    lock.waitLock(20000);
    var kv = getSheet_(KV_SHEET, KV_HEADERS);
    var orders = getSheet_(ORDER_SHEET, ORDER_HEADERS);
    batch.forEach(function (item) {
      var order = parseOrderItem_(item);
      if (!order) return;
      upsertKv_(kv, String(item.key), String(item.value));
      upsertOrderRow_(orders, order);
    });
    return json_({ ok: true, count: batch.length });
  } catch (err) {
    logError_('doPost', err);
    return json_({ ok: false, error: 'SYNC_FAILED' });
  } finally {
    lock.releaseLock();
  }
}

// URL ของ Web App เปิดเป็น Anyone จึงรับเฉพาะ key ใบแจ้งซ่อม order:<uuid> ที่ id ใน JSON ตรงกับ key
// key อื่นของระบบเดิมใน KV (config, lineWebhooks ฯลฯ) เขียนทับผ่าน URL นี้ไม่ได้ และ JSON เสียไม่ถูกเขียนลงชีต
function parseOrderItem_(item) {
  var key = item && String(item.key || '');
  var match = /^order:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(key || '');
  if (!match) return null;
  var order;
  try { order = JSON.parse(String(item.value || '')); } catch (err) { return null; }
  return order && typeof order === 'object' && order.id === match[1] ? order : null;
}

/* ---------- ชีต ---------- */

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  return sheet;
}

// แถวที่ค่าในคอลัมน์ col ตรงกับ value (นับแถวหัวเป็นแถว 1) ไม่พบคืน 0
function findRow_(sheet, col, value) {
  var last = sheet.getLastRow();
  if (last < 2) return 0;
  var match = sheet.getRange(2, col, last - 1, 1).createTextFinder(value).matchEntireCell(true).findNext();
  return match ? match.getRow() : 0;
}

function upsertKv_(sheet, key, value) {
  var row = findRow_(sheet, 1, key) || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[key, value]]);
}

function upsertOrderRow_(sheet, order) {
  if (!order || !order.id) return;
  var row = findRow_(sheet, ID_COL, String(order.id)) || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, ORDER_HEADERS.length).setNumberFormat('@').setValues([orderRow_(order)]);
}

/* ---------- แปลงใบ → แถว (ไม่แตะชีต ทดสอบได้) ---------- */

function orderRow_(order) {
  var approvals = order.approvals || {};
  var assignment = order.assignment || null;
  var record = order.maintRecord || null;
  var verification = order.verification || null;
  var row = [
    order.docNumber, order.department, order.machineCode, order.machineName, order.cause,
    fmtDate_(order.neededDate, false), order.requestedBy, fmtDate_(order.createdAt, true),
    STATUS_LABELS[order.status] || order.status,
  ].concat(approvalCells_(approvals.fm), approvalCells_(approvals.gm), [
    assignment ? (assignment.technicians || []).join(', ') : '',
    assignment ? fmtDate_(assignment.startDate, false) : '',
    assignment ? fmtDate_(assignment.endDate, false) : '',
    assignment ? assignment.assignedBy : '',
    assignment ? fmtDate_(assignment.assignedAt, true) : '',
    String(order.photoCount || 0),
    DOC_TYPE_LABELS[order.docType] || order.docType,
    assignment ? assignment.receivedByName : '',
    assignment ? (EXECUTION_PLAN_LABELS[assignment.executionPlan] || assignment.executionPlan) : '',
    record ? record.causeAnalysis : '',
    record ? (OPINION_LABELS[record.inspectorOpinion] || record.inspectorOpinion) : '',
    record ? partsText_(record.parts) : '',
    verification ? verificationText_(verification) : '',
    (order.verificationHistory || []).map(function (item) { return fmtDate_(item.at, true) + ' : ' + (item.note || ''); }).join('\n'),
    order.id,
  ]);
  return row.map(safeText_);
}

function approvalCells_(stage) {
  if (!stage) return ['', '', ''];
  var decision = stage.status === 'approved' ? 'อนุมัติ' : stage.status === 'rejected' ? 'ไม่อนุมัติ' : '';
  var byAt = stage.by && stage.at ? stage.by + ' / ' + fmtDate_(stage.at, true) : '';
  return [decision, byAt, stage.note || ''];
}

function partsText_(parts) {
  return (parts || []).map(function (part, index) {
    var bits = [(index + 1) + '. ' + (part.name || '')];
    if (part.qty) bits.push('จำนวน ' + part.qty + (part.unit ? ' ' + part.unit : ''));
    if (part.price) bits.push('ราคา ' + part.price + ' บาท');
    if (part.shop) bits.push('ร้าน ' + part.shop);
    if (part.note) bits.push(part.note);
    return bits.join(' / ');
  }).join('\n');
}

function verificationText_(verification) {
  var label = verification.result === 'pass' ? 'ผ่าน — ใช้งานได้ปกติ' : 'ไม่ผ่าน — ต้องซ่อมเพิ่มเติม';
  return label + ' (' + fmtDate_(verification.at, true) + ')' + (verification.note ? ' : ' + verification.note : '');
}

// dd/MM/yy ปี พ.ศ. (และ HH:mm) เวลาไทย เหมือนแถวเดิมในชีต ค่า date ล้วน YYYY-MM-DD ไม่แปลงเขตเวลา
function fmtDate_(value, withTime) {
  if (!value) return '';
  var dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (dateOnly) return dateOnly[3] + '/' + dateOnly[2] + '/' + pad2_((Number(dateOnly[1]) + 543) % 100);
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  var text = Utilities.formatDate(date, TZ, 'dd/MM/yyyy HH:mm');
  var year = Number(text.slice(6, 10)) + 543;
  return text.slice(0, 6) + pad2_(year % 100) + (withTime ? text.slice(10) : '');
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

// ' นำหน้าเฉพาะค่าที่ขึ้นต้นด้วย = ให้ชีตเก็บเป็นข้อความ ไม่รันเป็นสูตร (เซลล์ตั้งเป็นข้อความ '@' อยู่แล้ว)
// ไม่แตะ "- ..." ที่ใช้เขียนรายการบ่อย กัน ' โผล่หน้าข้อความ
function safeText_(value) {
  var text = value === null || value === undefined ? '' : String(value);
  return text.charAt(0) === '=' ? "'" + text : text;
}

function logError_(context, err) {
  try {
    var sheet = getSheet_(ERROR_SHEET, ['เวลา', 'บริบท', 'ข้อความ']);
    sheet.appendRow([new Date(), context, String(err && err.message || err).slice(0, 500)]);
  } catch (ignored) {
    console.error(context, String(err));
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
