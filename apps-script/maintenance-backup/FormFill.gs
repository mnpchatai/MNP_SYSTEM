/**
 * เติมฟอร์ม MT01-FM05 (ชีต "เอกสาร") จากเลขที่เอกสาร — อยู่โปรเจกต์เดียวกับ Code.gs
 *
 * วิธีใช้: พิมพ์เลขที่เอกสาร (เช่น BG026/26) ที่เซลล์ AG4 ของชีต "เอกสาร"
 *   → หาใบในชีต "ใบแจ้งซ่อม" → อ่าน JSON ของใบจากชีต "KV" → เติมทุกช่องของฟอร์ม
 *   → ลบค่าใน AG4 = ฟอร์มกลับเป็นแบบฟอร์มเปล่า
 *   → เมนู "ใบแจ้งซ่อม > ดึงข้อมูลใหม่" เติมซ้ำเมื่อข้อมูลอัปเดต แล้วพิมพ์ด้วย File > Print ได้ตามปกติ
 *
 * ค่าที่เติมคือ formCells ที่ Pilot Web คำนวณด้วย buildMtFormCells (modules/mt-form-export.js) แล้วส่งมากับการซิงก์
 * จึงตรงกับไฟล์ที่กด "ดาวน์โหลด Excel" ในเว็บทุกช่อง ใบที่ซิงก์ก่อนมีระบบนี้ยังไม่มี formCells
 * ให้เปิดใบนั้นในระบบหนึ่งครั้ง (การเปิดหน้ารายละเอียดจะซิงก์ใหม่) แล้วกด "ดึงข้อมูลใหม่"
 */

var FF_FORM_SHEET = 'เอกสาร';
var FF_KEY_CELL = 'AG4';
var FF_MAX_TEXT = 5000;
var FF_FORM_RANGE = 'A1:AJ41'; // ช่วงของแบบฟอร์ม อ่าน data validation ทีเดียวทั้งช่วงแทนทีละเซลล์

// ฟอร์มเปล่า: ผลของ buildMtFormCells({ request: {} }) — เทสต์ scripts/tests/maintenance-backup.test.mjs ตรวจว่าตรงกัน
var FF_BLANK_CELLS = {
  AG4: "",
  B6: false,
  G6: false,
  AB6: "",
  AB7: "",
  F7: "",
  P7: "",
  L8: "",
  X8: "",
  B10: "",
  K15: false,
  U15: false,
  B19: "ลงชื่อ ________________________ ฝ่ายบริหารโรงงาน",
  T19: "ลงชื่อ ________________________ ผู้จัดการทั่วไป",
  B20: "",
  T20: "",
  B23: "ลงชื่อ ______________________",
  B24: "วันที่ _______ / _______ / ______",
  K23: "ช่างชื่อ _____________________",
  K25: "วันที่ _______ / _______ / ______",
  U23: false,
  U24: false,
  U25: false,
  AB24: "วันที่ _______ / _______ / _______",
  B27: "วิเคราะห์สาเหตุ / อาการที่ชำรุด พบว่า",
  L28: false,
  Q28: false,
  Y28: false,
  AC28: false,
  B31: "",
  D31: "",
  T31: "",
  X31: "",
  Z31: "",
  AC31: "",
  AG31: "",
  B32: "",
  D32: "",
  T32: "",
  X32: "",
  Z32: "",
  AC32: "",
  AG32: "",
  B33: "",
  D33: "",
  T33: "",
  X33: "",
  Z33: "",
  AC33: "",
  AG33: "",
  B34: "",
  D34: "",
  T34: "",
  X34: "",
  Z34: "",
  AC34: "",
  AG34: "",
  B36: "วันที่",
  B37: "เวลา",
  K36: "วันที่ ",
  K37: "เวลา ",
  V36: "",
  Y36: "",
  AB36: "ลงชื่อ ",
  AB37: "วันที่ ",
  C39: false,
  C40: false,
  K40: "วันที่ ",
  T40: "วันที่ ",
  AB40: "วันที่ ",
};

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ใบแจ้งซ่อม')
    .addItem('ดึงข้อมูลใหม่', 'ffRefresh')
    .addItem('ล้างฟอร์ม', 'ffClear')
    .addToUi();
}

// simple trigger: ทำงานเมื่อมีคนแก้ AG4 ของชีต "เอกสาร" เท่านั้น
// AG4 ในแบบฟอร์มเป็นเซลล์รวม AG4:AJ4 จึงเทียบว่าช่วงที่แก้ครอบ AG4 แทนการเทียบชื่อเซลล์ตรงๆ
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FF_FORM_SHEET) return;
  var key = sheet.getRange(FF_KEY_CELL);
  var covers = e.range.getRow() <= key.getRow() && e.range.getLastRow() >= key.getRow()
    && e.range.getColumn() <= key.getColumn() && e.range.getLastColumn() >= key.getColumn();
  if (!covers) return;
  ffFill_(sheet, String(key.getValue() || '').trim());
}

function ffRefresh() {
  var sheet = ffFormSheet_();
  if (sheet) ffFill_(sheet, String(sheet.getRange(FF_KEY_CELL).getValue() || '').trim());
}

function ffClear() {
  var sheet = ffFormSheet_();
  if (sheet) ffApply_(sheet, FF_BLANK_CELLS);
}

function ffFormSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(FF_FORM_SHEET);
  if (!sheet) ss.toast('ไม่พบชีต "' + FF_FORM_SHEET + '"', 'ใบแจ้งซ่อม', 8);
  return sheet;
}

function ffFill_(sheet, docNumber) {
  var ss = sheet.getParent();
  if (!docNumber) {
    ffApply_(sheet, FF_BLANK_CELLS);
    return;
  }
  var result = ffFindCells_(ss, docNumber);
  if (!result.cells) {
    ffApply_(sheet, FF_BLANK_CELLS);
    sheet.getRange(FF_KEY_CELL).setValue(docNumber);
    ss.toast(result.message, 'ใบแจ้งซ่อม', 8);
    return;
  }
  ffApply_(sheet, result.cells);
  ss.toast('เติมข้อมูล ' + docNumber + ' แล้ว', 'ใบแจ้งซ่อม', 4);
}

// เลขที่เอกสาร → แถวในชีต "ใบแจ้งซ่อม" → รหัสอ้างอิงระบบ → JSON ใน KV → formCells
function ffFindCells_(ss, docNumber) {
  var orders = ss.getSheetByName(ORDER_SHEET);
  var row = orders ? findRow_(orders, 1, docNumber) : 0;
  if (!row) return { message: 'ไม่พบเลขที่เอกสาร ' + docNumber + ' ในชีต "ใบแจ้งซ่อม" (เปิดใบนั้นในระบบหนึ่งครั้งเพื่อซิงก์)' };
  var id = String(orders.getRange(row, ID_COL).getValue() || '');
  var kv = ss.getSheetByName(KV_SHEET);
  var kvRow = kv && id ? findRow_(kv, 1, 'order:' + id) : 0;
  var order = kvRow ? ffParse_(kv.getRange(kvRow, 2).getValue()) : null;
  if (!order || !order.formCells) return { message: 'ใบ ' + docNumber + ' ยังไม่มีข้อมูลฟอร์ม เปิดใบนี้ในระบบหนึ่งครั้งแล้วกด "ดึงข้อมูลใหม่"' };
  return { cells: ffSanitize_(order.formCells) };
}

function ffParse_(text) {
  try { return JSON.parse(String(text || '')); } catch (err) { return null; }
}

// รับเฉพาะช่องที่มีในฟอร์มเปล่า (กันข้อมูลเพี้ยนเขียนทับส่วนอื่นของชีต) ค่าที่ขาดใช้ค่าฟอร์มเปล่า
function ffSanitize_(cells) {
  var clean = {};
  Object.keys(FF_BLANK_CELLS).forEach(function (a1) {
    var blank = FF_BLANK_CELLS[a1];
    var value = cells && Object.prototype.hasOwnProperty.call(cells, a1) ? cells[a1] : blank;
    clean[a1] = typeof value !== typeof blank ? blank : typeof value === 'string' ? value.slice(0, FF_MAX_TEXT) : value;
  });
  return clean;
}

function ffApply_(sheet, cells) {
  // simple trigger มีเวลา 30 วินาที อ่านกฎ checkbox ครั้งเดียวแล้วเขียนอย่างเดียว ไม่สลับอ่าน/เขียนทีละเซลล์
  var rules = sheet.getRange(FF_FORM_RANGE).getDataValidations();
  Object.keys(cells).forEach(function (a1) {
    var value = cells[a1];
    var range = sheet.getRange(a1);
    if (typeof value === 'boolean') {
      var rule = rules[range.getRow() - 1] && rules[range.getRow() - 1][range.getColumn() - 1];
      var isCheckbox = rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX;
      range.setValue(isCheckbox ? value : (value ? '☑' : '☐'));
    } else {
      // '@' กันชีตแปลง "21/10/69" เป็นวันที่
      range.setNumberFormat('@').setValue(safeText_(value));
    }
  });
}
