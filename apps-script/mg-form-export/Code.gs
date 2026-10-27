/**
 * ดาวน์โหลดใบคำร้องถึงฝ่ายบริหารเป็นไฟล์ Excel ตามแบบฟอร์ม PP01-FM08 (ชีต "เอกสาร" ของสเปรดชีตใบคำร้องถึงฝ่ายบริหาร)
 *
 * โปรเจกต์ Apps Script แยกของฟอร์มนี้โดยเฉพาะ (สร้างที่ script.google.com > New project ไม่ผูกกับสเปรดชีตใด)
 * ไม่ใช่โปรเจกต์ของชีตบริหาร (sync + AD3) และไม่ใช่ export ของใบ MT — พังก็กระทบแค่ปุ่มดาวน์โหลดของใบบริหาร
 *
 * โปรเจกต์นี้มี 2 ไฟล์:
 *   - Code.gs   = ไฟล์นี้
 *   - FormFill  = สำเนา apps-script/management-backup/FormFill.gs (ไฟล์เดียวกับที่ใช้บนชีตบริหาร)
 *                 ใช้ ffWrite_ เติมฟอร์ม หน้าตาไฟล์จึงตรงกับฟอร์มที่เติมบนชีตทุกอย่าง
 *
 * Pilot Web (modules/mt-form-export.js → buildManagementFormRecord) ส่ง
 *   { form: "mg", record: { "เลขที่เอกสาร": ..., "เรื่อง": ..., ... }, fileName }
 * record คือ "แถว" รูปแบบเดียวกับชีต "ใบคำร้องถึงฝ่ายบริหาร" สคริปต์คัดลอกชีตฟอร์มไปไฟล์ชั่วคราว → ffWrite_
 * → แปลง checkbox เป็น ☑/☐ → export .xlsx → ลบไฟล์ชั่วคราว → ส่งไฟล์กลับเป็น base64
 *
 * ความปลอดภัย: สคริปต์ไม่อ่านข้อมูลใบใดจากสเปรดชีต ค่าทั้งหมดมาจากหน้าเว็บที่โหลดตามสิทธิ์ (RLS) ของผู้ดูเอง
 * รับเฉพาะคีย์ใน MG_RECORD_KEYS และไฟล์ที่ส่งกลับมีแค่ชีตฟอร์ม
 *
 * ติดตั้ง: ดู README.md ในโฟลเดอร์นี้ (Script property TEMPLATE_SHEET_ID, appsscript.json, Run authorize)
 */

var FORM_SHEET = 'เอกสาร';
var MAX_TEXT = 5000;
var CHECKED = '☑';
var UNCHECKED = '☐';
var ERROR_SHEET = 'บันทึกข้อผิดพลาด';

// คีย์ของ record = หัวคอลัมน์ชีต "ใบคำร้องถึงฝ่ายบริหาร" ที่ FormFill.gs อ่าน (ต้องตรงกับ
// MANAGEMENT_RECORD_HEADERS ใน modules/mt-form-export.js — เทสต์ตรวจไว้)
var MG_RECORD_KEYS = [
  'เลขที่เอกสาร', 'แผนก', 'เรื่อง', 'รายละเอียด', 'สิ่งที่แนบมาด้วย', 'ผู้ยื่นคำร้อง', 'ตำแหน่ง', 'ยื่นเมื่อ', 'สถานะ',
  'มติ', 'ความเห็น', 'ผจก.โรงงาน อนุมัติโดย', 'ผจก.โรงงาน เมื่อ', 'ผจก.ทั่วไป อนุมัติโดย', 'ผจก.ทั่วไป เมื่อ',
  'สำเนาถึงแผนก', 'สำเนาอื่นๆ',
];
var MG_DATE_KEYS = ['ยื่นเมื่อ', 'ผจก.โรงงาน เมื่อ', 'ผจก.ทั่วไป เมื่อ'];

// กด Run ฟังก์ชันนี้ในตัวแก้ไขหนึ่งครั้งหลังวางโค้ด ให้ Google ขออนุญาตสิทธิ์ที่ doPost ใช้ครบทุกตัว
// (สเปรดชีต, Drive สำหรับไฟล์ชั่วคราว, เรียก URL ภายนอกสำหรับ export) — ไม่สร้างหรือแก้ไฟล์ใด
function authorize() {
  var templateId = PropertiesService.getScriptProperties().getProperty('TEMPLATE_SHEET_ID');
  if (templateId) SpreadsheetApp.openById(templateId).getName();
  DriveApp.getRootFolder().getName();
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  if (typeof ffWrite_ !== 'function') throw new Error('ยังไม่ได้เพิ่มไฟล์ FormFill ในโปรเจกต์นี้');
  console.log('authorize: สิทธิ์ครบแล้ว');
}

function doGet() {
  return json_({ ok: false, error: 'USE_POST' });
}

function doPost(e) {
  var tempId = null;
  var stage = 'INPUT'; // ขั้นที่กำลังทำ ส่งกลับในรหัส error ให้รู้ว่าล้มตรงไหนโดยไม่ต้องเปิด Executions
  var templateId = null;
  try {
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var record = validateRecord_(payload.record);
    if (typeof ffWrite_ !== 'function') throw new Error('FORMFILL_MISSING');
    var fileName = safeFileName_(payload.fileName);

    templateId = PropertiesService.getScriptProperties().getProperty('TEMPLATE_SHEET_ID');
    if (!templateId) throw new Error('NOT_CONFIGURED');
    stage = 'OPEN';
    var source = SpreadsheetApp.openById(templateId).getSheetByName(FORM_SHEET);
    if (!source) throw new Error('FORM_SHEET_NOT_FOUND');

    stage = 'COPY';
    var temp = SpreadsheetApp.create('PP01-FM08 export ' + new Date().toISOString());
    tempId = temp.getId();
    var sheet = source.copyTo(temp);
    sheet.setName(FORM_SHEET);
    temp.getSheets().forEach(function (other) {
      if (other.getSheetId() !== sheet.getSheetId()) temp.deleteSheet(other);
    });

    stage = 'FILL';
    fillManagementForm_(sheet, record, templateId);
    SpreadsheetApp.flush();

    stage = 'EXPORT';
    var url = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx&gid=' + sheet.getSheetId();
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('EXPORT_HTTP_' + response.getResponseCode());
    return json_({ ok: true, fileName: fileName, base64: Utilities.base64Encode(response.getBlob().getBytes()) });
  } catch (err) {
    console.error('mg-form-export', stage, String(err));
    logError_(templateId, stage, err);
    return json_({ ok: false, error: errorCode_(err, stage) });
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (cleanupError) { console.error('cleanup', String(cleanupError)); }
    }
  }
}

// เลขที่เอกสารลงช่องคีย์ของ FormFill (AD3) แล้วให้ ffWrite_ เติมทุกช่องตามหัวข้อของฟอร์ม
// จากนั้นแปลง checkbox จริงทั้งชีตเป็น ☑/☐ (ใน Excel checkbox ของ Google จะกลายเป็น TRUE/FALSE)
function fillManagementForm_(sheet, record, templateId) {
  sheet.getRange(FF_KEY_CELL).setValue(record['เลขที่เอกสาร']);
  var result = ffWrite_(sheet, record) || {};
  // หาหัวข้อในฟอร์มไม่เจอ (ฟอร์มถูกแก้ข้อความ) ไฟล์ยังสร้างได้แต่ช่องนั้นว่าง บันทึกไว้ให้เจ้าของเห็น
  if (result.missing && result.missing.length) {
    logError_(templateId, 'FILL_MISSING', new Error('หาช่องในฟอร์มไม่เจอ: ' + result.missing.join(', ')));
  }
  SpreadsheetApp.flush();
  var range = sheet.getDataRange();
  var rules = range.getDataValidations();
  var values = range.getValues();
  rules.forEach(function (row, r) {
    row.forEach(function (rule, c) {
      if (!rule || rule.getCriteriaType() !== SpreadsheetApp.DataValidationCriteria.CHECKBOX) return;
      var cell = sheet.getRange(r + 1, c + 1);
      cell.clearDataValidations();
      cell.setValue(values[r][c] === true ? CHECKED : UNCHECKED);
    });
  });
}

// รับเฉพาะคีย์ที่รู้จัก ค่าเป็นข้อความ (ตัดความยาว)
// - ช่องวันที่รับเฉพาะรูป ISO ที่ ffDate_ แปลงได้ อย่างอื่นเป็นค่าว่าง (ffDate_ คืนข้อความดิบเมื่อแปลงไม่ได้)
// - ค่าที่ขึ้นต้นด้วย = + - @ ใส่ตัวคั่นที่มองไม่เห็น (​ แบบเดียวกับ FF_CONT ของ FormFill) นำหน้า
//   บรรทัดแรกของรายละเอียดเป็นเซลล์ที่ขึ้นต้นด้วยค่าของผู้ใช้ จึงต้องไม่ให้กลายเป็นสูตร และไม่ให้มี ' โผล่ในไฟล์
function validateRecord_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BAD_RECORD');
  var clean = {};
  MG_RECORD_KEYS.forEach(function (key) {
    var value = record[key];
    if (value !== undefined && typeof value !== 'string') throw new Error('BAD_RECORD');
    var text = String(value || '').slice(0, MAX_TEXT);
    if (MG_DATE_KEYS.indexOf(key) >= 0) {
      clean[key] = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(text) ? text : '';
    } else {
      clean[key] = (/^[=+\-@]/.test(text) ? '​' : '') + text;
    }
  });
  if (!clean['เลขที่เอกสาร']) throw new Error('BAD_RECORD');
  return clean;
}

function safeFileName_(name) {
  var cleaned = String(name || '').replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 80);
  return /\.xlsx$/.test(cleaned) ? cleaned : 'PP01-FM08.xlsx';
}

// ส่งกลับแค่รหัส ไม่ส่งข้อความ error ดิบ (อาจมี ID ของไฟล์/รายละเอียดภายใน) ข้อความเต็มอยู่ในชีต "บันทึกข้อผิดพลาด"
// รหัสที่ไม่รู้จักบอกขั้นที่ล้ม: FAILED_OPEN / FAILED_COPY / FAILED_FILL / FAILED_EXPORT (+ HTTP status ถ้ามี)
function errorCode_(err, stage) {
  var message = String(err && err.message || '');
  if (['BAD_RECORD', 'FORMFILL_MISSING', 'NOT_CONFIGURED', 'FORM_SHEET_NOT_FOUND'].indexOf(message) >= 0) return message;
  var http = /^EXPORT_HTTP_(\d{3})$/.exec(message);
  return 'FAILED_' + (stage || 'UNKNOWN') + (http ? '_' + http[1] : '');
}

// บันทึกข้อความ error เต็มลงชีต "บันทึกข้อผิดพลาด" ของสเปรดชีตบริหาร (เจ้าของเปิดดูได้เอง) ถ้าเขียนไม่ได้ก็ข้าม
function logError_(templateId, stage, err) {
  if (!templateId) return;
  try {
    var ss = SpreadsheetApp.openById(templateId);
    var sheet = ss.getSheetByName(ERROR_SHEET) || ss.insertSheet(ERROR_SHEET);
    sheet.appendRow([new Date(), 'mg-form-export:' + stage, String(err && err.message || err).slice(0, 500)]);
  } catch (logFailure) {
    console.error('mg-form-export log', String(logFailure));
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
