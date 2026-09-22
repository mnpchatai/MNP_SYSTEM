/**
 * สำรองข้อมูลใบคำร้องถึงฝ่ายบริหาร (PP01-FM08) ไว้ในสเปรดชีตนี้
 *
 * เป็นแค่สำเนาสำรอง/รายงาน — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/สายอนุมัติ
 * ทั้งหมด ชีตนี้ไม่ต้องเขียนกลับไปที่ระบบ ใช้รูปแบบเดียวกับสคริปต์สำรองใบแจ้งซ่อม (Maintenance-MT)
 * ที่ Pilot Web เรียกอยู่แล้ว: POST body { batch: [{ key, value }, ...] } — upsert หนึ่งแถวต่อ key
 *
 * เก็บ 2 ชั้นเหมือนสคริปต์ใบแจ้งซ่อม:
 *   - ชีต "Log": key/value ดิบ (JSON string ทั้งก้อน) ไว้เป็นหลักฐานตั้งต้น/ใช้ debug
 *   - ชีต "ใบคำร้องถึงฝ่ายบริหาร": แกะฟิลด์จาก value มาลงคอลัมน์ที่มีชื่อ อ่านง่ายแบบเดียวกับชีต
 *     "ใบแจ้งซ่อม" ของสคริปต์เดิม — upsert ทับแถวเดิมด้วย "เลขที่เอกสาร" (request_no คงที่ ไม่ซ้ำ)
 *
 * วิธี deploy:
 *   1. เปิดสเปรดชีตนี้ > Extensions > Apps Script
 *   2. ลบโค้ดเดิมในไฟล์ Code.gs ทิ้ง แล้ววางไฟล์นี้แทน
 *   3. Deploy > Manage deployments > แก้ไข deployment เดิม (ไอคอนดินสอ) > Version: New version > Deploy
 *      (ใช้ deployment เดิม ไม่ต้องสร้างใหม่ — URL ใน app.js จะยังใช้ได้เหมือนเดิม)
 *   4. ถ้าเพิ่ง deploy ครั้งแรก ให้เลือกประเภท "Web app", Execute as: Me, Who has access: Anyone
 *      แล้วคัดลอก URL ไปใส่ในตัวแปร APPS_SCRIPT_MANAGEMENT_SYNC_URL ใน app.js
 *
 * หมายเหตุความปลอดภัย: ต้องตั้ง Access เป็น "Anyone" เพราะ Pilot Web ยิง fetch แบบ mode:"no-cors"
 * (อ่าน response กลับไม่ได้ และแนบ header/token ไม่ได้) เหมือนกับสคริปต์ใบแจ้งซ่อมเดิมทุกประการ —
 * URL นี้จึงควรถือเป็นความลับระดับหนึ่ง (เหมือน webhook) ไม่ควรเผยแพร่แบบสาธารณะ
 */

var SHEET_NAME = 'Log';
var HEADERS = ['key', 'value', 'updatedAt'];

var STRUCTURED_SHEET_NAME = 'ใบคำร้องถึงฝ่ายบริหาร';
var STRUCTURED_HEADERS = [
  'เลขที่เอกสาร', 'แผนก', 'เรื่อง', 'รายละเอียด', 'สิ่งที่แนบมาด้วย',
  'ผู้ยื่นคำร้อง', 'ตำแหน่ง', 'ยื่นเมื่อ', 'สถานะ', 'มติ', 'ความเห็น',
  'ผจก.โรงงาน อนุมัติโดย', 'ผจก.โรงงาน เมื่อ',
  'ผจก.ทั่วไป อนุมัติโดย', 'ผจก.ทั่วไป เมื่อ',
  'สำเนาถึงแผนก', 'สำเนาอื่นๆ', 'อัปเดตล่าสุด',
];

function doPost(e) {
  try {
    var payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    var batch = Array.isArray(payload.batch) ? payload.batch : [];
    var sheet = getLogSheet_();
    var structuredSheet = getStructuredSheet_();
    batch.forEach(function (item) {
      if (!item || !item.key) return;
      upsertRow_(sheet, String(item.key), String(item.value || ''));
      if (String(item.key).indexOf('mgmt:') === 0) {
        upsertStructuredRow_(structuredSheet, String(item.value || ''));
      }
    });
    return jsonOutput_({ ok: true, count: batch.length });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

function getLogSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// key อยู่คอลัมน์ A เสมอ — ไล่หาแถวเดิมแบบ linear scan (ปริมาณคำร้องต่อปีไม่มากพอจะต้องทำ index)
// เจอแล้วอัปเดตแค่ value/updatedAt ไม่แตะ key เดิม ไม่เจอก็ต่อแถวใหม่ท้ายชีต
function upsertRow_(sheet, key, value) {
  var now = new Date();
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][0] === key) {
        sheet.getRange(i + 2, 2, 1, 2).setValues([[value, now]]);
        return;
      }
    }
  }
  sheet.appendRow([key, value, now]);
}

// สร้างชีต "ใบคำร้องถึงฝ่ายบริหาร" ถ้ายังไม่มี และบังคับหัวคอลัมน์แถวแรกให้ตรงกับ STRUCTURED_HEADERS
// เสมอ (เผื่อแถวหัวถูกแก้มือหรือยังไม่เคยตั้งค่า) — ไม่แตะแถวข้อมูลด้านล่าง
function getStructuredSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(STRUCTURED_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(STRUCTURED_SHEET_NAME);
  }
  var currentHeaders = sheet.getRange(1, 1, 1, STRUCTURED_HEADERS.length).getValues()[0];
  var headersMatch = STRUCTURED_HEADERS.every(function (header, i) { return currentHeaders[i] === header; });
  if (!headersMatch) {
    sheet.getRange(1, 1, 1, STRUCTURED_HEADERS.length).setValues([STRUCTURED_HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// value คือ JSON string ของ order (ดู buildAppsScriptManagementOrder ใน app.js) — แกะฟิลด์มาลง
// คอลัมน์ที่มีชื่อ แล้ว upsert ทับแถวเดิมด้วย "เลขที่เอกสาร" (docNumber/request_no คงที่ ไม่ซ้ำ
// ตลอดอายุคำร้อง จึงใช้เป็น key ที่มองเห็นได้แทน uuid แบบเดียวกับชีตใบแจ้งซ่อม)
function upsertStructuredRow_(sheet, rawValue) {
  var order;
  try {
    order = JSON.parse(rawValue);
  } catch (err) {
    return;
  }
  if (!order || !order.docNumber) return;

  var approvals = order.approvals || {};
  var fm = approvals.fm || {};
  var gm = approvals.gm || {};
  var ccDepartments = Array.isArray(order.ccDepartments) ? order.ccDepartments : [];

  var row = [
    order.docNumber,
    order.department || '',
    order.subject || '',
    order.description || '',
    order.attachmentNote || '',
    order.requestedBy || '',
    order.position || '',
    order.submittedAt || '',
    order.status || '',
    order.decision || '',
    order.comment || '',
    fm.by || '',
    fm.at || '',
    gm.by || '',
    gm.at || '',
    ccDepartments.join(', '),
    order.ccOther || '',
    new Date(),
  ];

  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var docNumbers = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < docNumbers.length; i++) {
      if (docNumbers[i][0] === order.docNumber) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.appendRow(row);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
