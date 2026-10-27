/**
 * ปุ่ม "ดาวน์โหลด Excel" ของใบคำร้องถึงฝ่ายบริหาร — ไฟล์ที่สามในโปรเจกต์ของสเปรดชีตนี้ (คู่กับ Code.gs และ FormFill)
 *
 * ไฟล์นี้ไม่มี doPost/doGet ของตัวเอง (โปรเจกต์มีได้ชุดเดียว ถ้ามีสองชุดตัวที่โหลดทีหลังจะทับการซิงก์แบบเงียบๆ)
 * doPost ใน Code.gs ส่งคำขอที่มี form "mg" มาที่ exportManagementXlsx_ ส่วนคำขอซิงก์ { batch } ทำงานเหมือนเดิม
 *
 * Pilot Web (modules/mt-form-export.js → buildManagementFormRecord) ส่ง
 *   { form: "mg", record: { "เลขที่เอกสาร": ..., "เรื่อง": ..., ... }, fileName }
 * record คือ "แถว" รูปแบบเดียวกับชีต "ใบคำร้องถึงฝ่ายบริหาร" สคริปต์คัดลอกชีต "เอกสาร" ไปไฟล์ชั่วคราว
 * → ffWrite_ ของ FormFill (ตัวเดียวกับที่ใช้เมื่อพิมพ์เลขที่ที่ AD3) → แปลง checkbox เป็น ☑/☐ → export .xlsx
 * → ลบไฟล์ชั่วคราว → ส่งไฟล์กลับเป็น base64 ชีตจริงของสเปรดชีตนี้ไม่ถูกแก้ (ยกเว้นบันทึก error)
 *
 * ความปลอดภัย: ไม่อ่านข้อมูลใบใดจากชีต ค่าทั้งหมดมาจากหน้าเว็บที่โหลดตามสิทธิ์ (RLS) ของผู้ดูเอง
 * รับเฉพาะคีย์ใน MGX_RECORD_KEYS และไฟล์ที่ส่งกลับมีแค่ชีตฟอร์ม
 *
 * ชื่อทุกตัวในไฟล์นี้ขึ้นต้นด้วย mgx/MGX กันชนกับ Code.gs และ FormFill (เทสต์ตรวจไว้) ยกเว้น authorize
 */

var MGX_FORM_SHEET = 'เอกสาร';
var MGX_MAX_TEXT = 5000;
var MGX_CHECKED = '☑';
var MGX_UNCHECKED = '☐';
var MGX_ERROR_SHEET = 'บันทึกข้อผิดพลาด';

// คีย์ของ record = หัวคอลัมน์ชีต "ใบคำร้องถึงฝ่ายบริหาร" ที่ FormFill อ่าน (ต้องตรงกับ
// MANAGEMENT_RECORD_HEADERS ใน modules/mt-form-export.js — เทสต์ตรวจไว้)
var MGX_RECORD_KEYS = [
  'เลขที่เอกสาร', 'แผนก', 'เรื่อง', 'รายละเอียด', 'สิ่งที่แนบมาด้วย', 'ผู้ยื่นคำร้อง', 'ตำแหน่ง', 'ยื่นเมื่อ', 'สถานะ',
  'มติ', 'ความเห็น', 'ผจก.โรงงาน อนุมัติโดย', 'ผจก.โรงงาน เมื่อ', 'ผจก.ทั่วไป อนุมัติโดย', 'ผจก.ทั่วไป เมื่อ',
  'สำเนาถึงแผนก', 'สำเนาอื่นๆ',
];
var MGX_DATE_KEYS = ['ยื่นเมื่อ', 'ผจก.โรงงาน เมื่อ', 'ผจก.ทั่วไป เมื่อ'];

// กด Run ฟังก์ชันนี้ในตัวแก้ไขหนึ่งครั้งหลังวางโค้ด ให้ Google ขออนุญาตสิทธิ์ที่ export ใช้ครบทุกตัว
// (สเปรดชีต, Drive สำหรับไฟล์ชั่วคราว, เรียก URL ภายนอกสำหรับ export) — ไม่สร้างหรือแก้ไฟล์ใด
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  DriveApp.getRootFolder().getName();
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  console.log('authorize: สิทธิ์ครบแล้ว');
}

// เรียกจาก doPost ใน Code.gs เมื่อ payload.form === 'mg'
function exportManagementXlsx_(payload) {
  var tempId = null;
  var stage = 'INPUT'; // ขั้นที่กำลังทำ ส่งกลับในรหัส error ให้รู้ว่าล้มตรงไหนโดยไม่ต้องเปิด Executions
  var source = null;
  try {
    var record = mgxValidateRecord_(payload && payload.record);
    if (typeof ffWrite_ !== 'function') throw new Error('FORMFILL_MISSING');
    var fileName = mgxSafeFileName_(payload.fileName);

    stage = 'OPEN';
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    source = ss.getSheetByName(MGX_FORM_SHEET);
    if (!source) throw new Error('FORM_SHEET_NOT_FOUND');

    stage = 'COPY';
    var temp = SpreadsheetApp.create('PP01-FM08 export ' + new Date().toISOString());
    tempId = temp.getId();
    var sheet = source.copyTo(temp);
    sheet.setName(MGX_FORM_SHEET);
    temp.getSheets().forEach(function (other) {
      if (other.getSheetId() !== sheet.getSheetId()) temp.deleteSheet(other);
    });

    stage = 'FILL';
    mgxFill_(sheet, record);
    SpreadsheetApp.flush();

    stage = 'EXPORT';
    var url = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx&gid=' + sheet.getSheetId();
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('EXPORT_HTTP_' + response.getResponseCode());
    return mgxJson_({ ok: true, fileName: fileName, base64: Utilities.base64Encode(response.getBlob().getBytes()) });
  } catch (err) {
    console.error('mg-form-export', stage, String(err));
    mgxLogError_(stage, err);
    return mgxJson_({ ok: false, error: mgxErrorCode_(err, stage) });
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (cleanupError) { console.error('cleanup', String(cleanupError)); }
    }
  }
}

// เลขที่เอกสารลงช่องคีย์ของ FormFill (AD3) แล้วให้ ffWrite_ เติมทุกช่องตามหัวข้อของฟอร์ม (ในไฟล์ชั่วคราว)
// จากนั้นแปลง checkbox จริงทั้งชีตเป็น ☑/☐ (ใน Excel checkbox ของ Google จะกลายเป็น TRUE/FALSE)
function mgxFill_(sheet, record) {
  sheet.getRange(FF_KEY_CELL).setValue(record['เลขที่เอกสาร']);
  var result = ffWrite_(sheet, record) || {};
  // หาหัวข้อในฟอร์มไม่เจอ (ฟอร์มถูกแก้ข้อความ) ไฟล์ยังสร้างได้แต่ช่องนั้นว่าง บันทึกไว้ให้เจ้าของเห็น
  if (result.missing && result.missing.length) {
    mgxLogError_('FILL_MISSING', new Error('หาช่องในฟอร์มไม่เจอ: ' + result.missing.join(', ')));
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
      cell.setValue(values[r][c] === true ? MGX_CHECKED : MGX_UNCHECKED);
    });
  });
}

// รับเฉพาะคีย์ที่รู้จัก ค่าเป็นข้อความ (ตัดความยาว)
// - ช่องวันที่รับเฉพาะรูป ISO ที่ ffDate_ แปลงได้ อย่างอื่นเป็นค่าว่าง (ffDate_ คืนข้อความดิบเมื่อแปลงไม่ได้)
// - ค่าที่ขึ้นต้นด้วย = + - @ ใส่ตัวคั่นที่มองไม่เห็น (​ แบบเดียวกับ FF_CONT ของ FormFill) นำหน้า
//   บรรทัดแรกของรายละเอียดเป็นเซลล์ที่ขึ้นต้นด้วยค่าของผู้ใช้ จึงต้องไม่ให้กลายเป็นสูตร และไม่ให้มี ' โผล่ในไฟล์
function mgxValidateRecord_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BAD_RECORD');
  var clean = {};
  MGX_RECORD_KEYS.forEach(function (key) {
    var value = record[key];
    if (value !== undefined && typeof value !== 'string') throw new Error('BAD_RECORD');
    var text = String(value || '').slice(0, MGX_MAX_TEXT);
    if (MGX_DATE_KEYS.indexOf(key) >= 0) {
      clean[key] = /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})?$/.test(text) ? text : '';
    } else {
      clean[key] = (/^[=+\-@]/.test(text) ? '​' : '') + text;
    }
  });
  if (!clean['เลขที่เอกสาร']) throw new Error('BAD_RECORD');
  return clean;
}

function mgxSafeFileName_(name) {
  var cleaned = String(name || '').replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 80);
  return /\.xlsx$/.test(cleaned) ? cleaned : 'PP01-FM08.xlsx';
}

// ส่งกลับแค่รหัส ไม่ส่งข้อความ error ดิบ ข้อความเต็มอยู่ในชีต "บันทึกข้อผิดพลาด"
// รหัสที่ไม่รู้จักบอกขั้นที่ล้ม: FAILED_OPEN / FAILED_COPY / FAILED_FILL / FAILED_EXPORT (+ HTTP status ถ้ามี)
function mgxErrorCode_(err, stage) {
  var message = String(err && err.message || '');
  if (['BAD_RECORD', 'FORMFILL_MISSING', 'FORM_SHEET_NOT_FOUND'].indexOf(message) >= 0) return message;
  var http = /^EXPORT_HTTP_(\d{3})$/.exec(message);
  return 'FAILED_' + (stage || 'UNKNOWN') + (http ? '_' + http[1] : '');
}

// บันทึกข้อความ error เต็มลงชีต "บันทึกข้อผิดพลาด" ของสเปรดชีตนี้ (เจ้าของเปิดดูได้เอง) ถ้าเขียนไม่ได้ก็ข้าม
function mgxLogError_(stage, err) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(MGX_ERROR_SHEET) || ss.insertSheet(MGX_ERROR_SHEET);
    sheet.appendRow([new Date(), 'mg-form-export:' + stage, String(err && err.message || err).slice(0, 500)]);
  } catch (logFailure) {
    console.error('mg-form-export log', String(logFailure));
  }
}

function mgxJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
