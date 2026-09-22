/**
 * สำรองข้อมูลใบคำร้องถึงฝ่ายบริหาร (PP01-FM08) ไว้ในสเปรดชีตนี้
 *
 * เป็นแค่สำเนาสำรอง/รายงาน — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/สายอนุมัติ
 * ทั้งหมด ชีตนี้ไม่ต้องเขียนกลับไปที่ระบบ ใช้รูปแบบเดียวกับสคริปต์สำรองใบแจ้งซ่อม (Maintenance-MT)
 * ที่ Pilot Web เรียกอยู่แล้ว: POST body { batch: [{ key, value }, ...] } — upsert หนึ่งแถวต่อ key
 *
 * วิธี deploy:
 *   1. เปิดสเปรดชีตนี้ > Extensions > Apps Script
 *   2. ลบโค้ดเริ่มต้นในไฟล์ Code.gs ทิ้ง แล้ววางไฟล์นี้แทน (หรือสร้างไฟล์ใหม่ชื่อ Code.gs)
 *   3. Deploy > New deployment > เลือกประเภท "Web app"
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. คัดลอก URL ของ Web App ที่ได้ ไปใส่ในตัวแปร APPS_SCRIPT_MANAGEMENT_SYNC_URL ใน app.js
 *      (อยู่ต้นไฟล์ ใกล้ๆ APPS_SCRIPT_SYNC_URL ของใบแจ้งซ่อม)
 *
 * หมายเหตุความปลอดภัย: ต้องตั้ง Access เป็น "Anyone" เพราะ Pilot Web ยิง fetch แบบ mode:"no-cors"
 * (อ่าน response กลับไม่ได้ และแนบ header/token ไม่ได้) เหมือนกับสคริปต์ใบแจ้งซ่อมเดิมทุกประการ —
 * URL นี้จึงควรถือเป็นความลับระดับหนึ่ง (เหมือน webhook) ไม่ควรเผยแพร่แบบสาธารณะ
 */

var SHEET_NAME = 'Log';
var HEADERS = ['key', 'value', 'updatedAt'];

function doPost(e) {
  try {
    var payload = JSON.parse((e.postData && e.postData.contents) || '{}');
    var batch = Array.isArray(payload.batch) ? payload.batch : [];
    var sheet = getLogSheet_();
    batch.forEach(function (item) {
      if (item && item.key) upsertRow_(sheet, String(item.key), String(item.value || ''));
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

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
