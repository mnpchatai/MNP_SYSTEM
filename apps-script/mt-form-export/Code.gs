/**
 * ดาวน์โหลดใบแจ้งซ่อม/ใบคำร้อง MT เป็นไฟล์ Excel ตามแบบฟอร์ม MT01-FM05 (ชีต "เอกสาร")
 *
 * เป็นโปรเจกต์ Apps Script แยกจากสคริปต์สำรองใบแจ้งซ่อมเดิม (ไม่แตะ doPost ของสคริปต์นั้น)
 * Pilot Web (modules/mt-form-export.js) ส่ง { cells: { "AG4": "BG026/26", "G6": true, ... }, fileName }
 * สคริปต์นี้แค่ "วาด" ไฟล์: คัดลอกชีตฟอร์มไปไฟล์ชั่วคราว → เติมค่า → แปลง checkbox เป็น ☑/☐ → export .xlsx
 * → ลบไฟล์ชั่วคราว → ส่งไฟล์กลับเป็น base64
 *
 * ความปลอดภัย: สคริปต์ไม่อ่านข้อมูลใบใดจากสเปรดชีต ค่าทั้งหมดมาจากหน้าเว็บที่โหลดตามสิทธิ์ (RLS) ของผู้ดูเอง
 * คนที่ได้ URL ไปจึงได้แค่ไฟล์ฟอร์มที่มีค่าที่ตัวเองส่งมา ไม่เห็นข้อมูลของคนอื่น และไฟล์ที่ส่งกลับมีแค่ชีตฟอร์ม
 * (ไม่มีชีต KV/ใบแจ้งซ่อม ฯลฯ ของสเปรดชีตต้นทาง) เขียนได้เฉพาะเซลล์ในช่วงฟอร์ม A1:AJ41
 *
 * ติดตั้ง: ดู README.md ในโฟลเดอร์นี้ (ต้องตั้ง Script property TEMPLATE_SHEET_ID)
 */

var FORM_SHEET = 'เอกสาร';
var MAX_ROW = 41;          // แถวสุดท้ายของฟอร์ม
var MAX_COL = 36;          // AJ
var MAX_CELLS = 200;
var MAX_TEXT = 5000;
var CHECKED = '☑';
var UNCHECKED = '☐';

function doGet() {
  return json_({ ok: false, error: 'USE_POST' });
}

function doPost(e) {
  var tempId = null;
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var cells = validateCells_(payload.cells);
    var fileName = safeFileName_(payload.fileName);

    var templateId = PropertiesService.getScriptProperties().getProperty('TEMPLATE_SHEET_ID');
    if (!templateId) throw new Error('NOT_CONFIGURED');
    var source = SpreadsheetApp.openById(templateId).getSheetByName(FORM_SHEET);
    if (!source) throw new Error('FORM_SHEET_NOT_FOUND');

    var temp = SpreadsheetApp.create('MT01-FM05 export ' + new Date().toISOString());
    tempId = temp.getId();
    var sheet = source.copyTo(temp);
    sheet.setName(FORM_SHEET);
    temp.getSheets().forEach(function (other) {
      if (other.getSheetId() !== sheet.getSheetId()) temp.deleteSheet(other);
    });

    Object.keys(cells).forEach(function (a1) {
      var value = cells[a1];
      var range = sheet.getRange(a1);
      if (typeof value === 'boolean') {
        range.clearDataValidations();
        range.setValue(value ? CHECKED : UNCHECKED);
      } else {
        // '@' ไม่ให้ชีตแปลง "17/10/69" หรือ "1" เป็นวันที่/ตัวเลข
        range.setNumberFormat('@').setValue(value);
      }
    });
    SpreadsheetApp.flush();

    var url = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx&gid=' + sheet.getSheetId();
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('EXPORT_FAILED_' + response.getResponseCode());
    return json_({ ok: true, fileName: fileName, base64: Utilities.base64Encode(response.getBlob().getBytes()) });
  } catch (err) {
    console.error('mt-form-export', String(err));
    return json_({ ok: false, error: errorCode_(err) });
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (cleanupError) { console.error('cleanup', String(cleanupError)); }
    }
  }
}

// รับเฉพาะ A1 ในช่วงฟอร์ม ค่าเป็นข้อความ (ตัดความยาว) หรือ boolean
function validateCells_(cells) {
  if (!cells || typeof cells !== 'object' || Array.isArray(cells)) throw new Error('BAD_CELLS');
  var keys = Object.keys(cells);
  if (!keys.length || keys.length > MAX_CELLS) throw new Error('BAD_CELLS');
  var clean = {};
  keys.forEach(function (a1) {
    var match = /^([A-Z]{1,2})([1-9][0-9]?)$/.exec(a1);
    if (!match) throw new Error('BAD_CELLS');
    var col = match[1].split('').reduce(function (n, ch) { return n * 26 + ch.charCodeAt(0) - 64; }, 0);
    if (col > MAX_COL || Number(match[2]) > MAX_ROW) throw new Error('BAD_CELLS');
    var value = cells[a1];
    if (typeof value === 'boolean') clean[a1] = value;
    else if (typeof value === 'string') clean[a1] = value.slice(0, MAX_TEXT);
    else throw new Error('BAD_CELLS');
  });
  return clean;
}

function safeFileName_(name) {
  var cleaned = String(name || '').replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 80);
  return /\.xlsx$/.test(cleaned) ? cleaned : 'MT01-FM05.xlsx';
}

// ส่งกลับแค่รหัสที่รู้จัก ไม่ส่งข้อความ error ดิบ (อาจมี ID ของไฟล์/รายละเอียดภายใน)
function errorCode_(err) {
  var message = String(err && err.message || '');
  return ['BAD_CELLS', 'NOT_CONFIGURED', 'FORM_SHEET_NOT_FOUND'].indexOf(message) >= 0 ? message : 'EXPORT_FAILED';
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
