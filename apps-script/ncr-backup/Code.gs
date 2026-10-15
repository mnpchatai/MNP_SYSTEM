/**
 * สำเนา NCR (QA02-FM01) จาก Pilot Web ลงสเปรดชีต "NCR/CAR"
 *
 * เป็นแค่สำเนาสำรอง/รายงาน — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/ขั้นตอนทั้งหมด
 * Pilot Web (modules/ncr-sheet-sync.js) ยิง POST body { batch: [{ key: "ncr:<id>", value: "<JSON>" }] }
 * ทุกครั้งที่หน้ารายละเอียด NCR ถูกวาด (หลังออก NCR และหลังส่งทุกขั้นตอน) สคริปต์นี้จึง:
 *   1. upsert ข้อมูลเต็มของใบไว้ในชีตซ่อน "NCR_DATA" (หนึ่งแถวต่อใบ)
 *   2. upsert หนึ่งแถวต่อใบในชีต "รายงานNCR" (NCR LOG) ตั้งแต่แถวที่ 4 โดยใช้ "เลขที่ใบ NCR" (คอลัมน์ A)
 *   3. ถ้าชีต "เอกสารNCR" กำลังแสดงใบเดียวกันอยู่ ก็เติมฟอร์มใหม่ให้เป็นข้อมูลล่าสุด
 * และเมื่อพิมพ์เลขที่เอกสารลงช่อง X2 ของชีต "เอกสารNCR" (onEdit) จะดึงข้อมูลของใบนั้นลงช่องในฟอร์ม
 * (ลบเลขที่ออก = ล้างฟอร์มกลับเป็นแบบฟอร์มเปล่า)
 *
 * วิธี deploy: ดู apps-script/ncr-backup/README.md
 *
 * หมายเหตุความปลอดภัย: ต้องตั้ง Access ของ Web App เป็น "Anyone" เพราะ Pilot Web ยิง fetch แบบ
 * mode:"no-cors" (แนบ header/token ไม่ได้) เหมือนสคริปต์สำรองใบแจ้งซ่อม/ใบคำร้องถึงฝ่ายบริหาร —
 * URL นี้จึงควรถือเป็นความลับระดับหนึ่ง (เหมือน webhook) สคริปต์ตรวจรูปแบบข้อมูลก่อนเขียน และเขียนข้อความ
 * ทุกช่องเป็นข้อความล้วน (กันสูตรที่ขึ้นต้นด้วย = + - @ จากข้อมูลที่ผู้ใช้กรอก)
 */

var DATA_SHEET_NAME = 'NCR_DATA';
var DATA_HEADERS = ['เลขที่ใบ NCR', 'id', 'value', 'updatedAt'];
var MAX_VALUE_LENGTH = 49000; // ช่องเดียวของชีตเก็บได้ 50,000 ตัวอักษร

var LOG_SHEET_NAME = 'รายงานNCR';
var LOG_FIRST_ROW = 4; // แถว 1-3 เป็นหัวตาราง NCR LOG
var LOG_DATE_COLUMNS = [2, 16, 17, 20]; // B, P, Q, T

var FORM_SHEET_NAME = 'เอกสารNCR';
var FORM_DOC_NO_CELL = 'X2';

var STATUS_LABELS = {
  awaiting_disposition: 'รอ ผจก.โรงงานพิจารณา',
  awaiting_response: 'รอแผนกตอบ',
  awaiting_followup: 'รอ QA ติดตามผล',
  awaiting_signoff: 'รอลงนามปิด',
  awaiting_info: 'รอข้อมูลเพิ่มเติม',
  closed: 'ปิดแล้ว',
  cancelled: 'ยกเลิก',
};
// ลำดับคอลัมน์ F-L ของชีตรายงานNCR: บุคลากร เครื่องจักร วัตถุดิบ วิธีการ การวัด สิ่งแวดล้อม อื่นๆ
var CAUSE_ORDER = ['man', 'machine', 'material', 'method', 'measure', 'environment', 'other'];

// ---- ตำแหน่งช่องในฟอร์ม "เอกสารNCR" (ถ้าย้ายช่องในแบบฟอร์ม ให้แก้ตรงนี้ที่เดียว) ----
var SOURCE_CHECKBOXES = { incoming: 'F8', in_process: 'K8', final_fg: 'O8', customer_reject: 'S8', other: 'Y8' };
var DISPOSITION_CHECKBOXES = {
  return: 'C18', accept: 'H18', reproduce: 'O18', exchange: 'V18',
  repair: 'C19', sort: 'H19', scrap: 'O19', sell: 'V19', other: 'C20',
};
var FORWARD_CHECKBOX = 'O20'; // "ส่งเรื่องให้ แผนก ... เป็นผู้ดำเนินการ"
var CAUSE_CHECKBOXES = { man: 'E25', machine: 'H25', material: 'L25', method: 'O25', measure: 'R25', environment: 'U25', other: 'Y25' };
var FOLLOWUP_CLOSED_CHECKBOX = 'G40';
var FOLLOWUP_CAR_CHECKBOX = 'Q40'; // ระบบยังไม่มีผล "ออก CAR" (Phase 2) จึงล้างเป็น false เสมอ
var QUANTITY_CELLS = { qtyTotal: 'E7', qtySampled: 'J7', qtyDefect: 'P7', qtyReturned: 'V7' };
var UNIT_CELLS = { 'ชุด': 'Y7', 'ชิ้น': 'Z7', 'เซต': 'AA7', 'ม้วน': 'AB7', 'เส้น': 'AC7', 'กก.': 'AD7' };
var UNIT_MARK = '☑ ';
var TEXT_CELLS = {
  productCode: 'G5', productName: 'G6', customer: 'V5', poNo: 'V6', forwardTo: 'S20',
};
// ช่องข้อความหลายบรรทัด: แต่ละบรรทัดเป็นเซลล์ที่ตัวหนังสือล้นไปทางขวาบนเส้นบรรทัดของฟอร์ม
// maxChars ตั้งเผื่อไว้ ถ้าตัวหนังสือล้นเกินกรอบหรือสั้นเกินไป ให้ปรับตัวเลขนี้
var LINE_FIELDS = {
  description: { cells: ['E9', 'E10', 'C11', 'C12', 'C13', 'C14'], maxChars: 200 },
  dispositionNote: { cells: ['C21', 'C22'], maxChars: 200 },
  rootCause: { cells: ['G26', 'D27', 'C28'], maxChars: 200 },
  correction: { cells: ['C31', 'C32', 'C33', 'C34', 'C35', 'C36'], maxChars: 100 },
  prevention: { cells: ['Q31', 'Q32', 'Q33', 'Q34', 'Q35', 'Q36'], maxChars: 100 },
};
// ข้อความเดิมของแบบฟอร์ม — ใช้เติมช่องว่าง และคืนค่าตอนล้างฟอร์ม
var BLANK_DATE = '_______ / _______ / _______';
var TEMPLATE_TEXT = {
  X4: BLANK_DATE,
  B16: 'ลงชื่อ __________________ ผู้รายงาน',
  J16: 'แผนก _____________________',
  Q16: 'ตำแหน่ง ___________________',
  X16: 'วันที่ ' + BLANK_DATE,
  B24: 'ลงชื่อ _________________________ ',
  J24: 'วันที่ ' + BLANK_DATE,
  I37: BLANK_DATE,
  X37: BLANK_DATE,
  B39: 'ลงชื่อ _________________ ผู้ดำเนินการ',
  J39: 'แผนก _____________________',
  Q39: 'ตำแหน่ง ___________________',
  X39: 'วันที่ ' + BLANK_DATE,
  B44: '______________________', J44: '______________________', Q44: '______________________', X44: '______________________',
  B45: '_____ / _____ / _____', J45: '_____ / _____ / _____', Q45: '_____ / _____ / _____', X45: '_____ / _____ / _____',
  Y7: 'ชุด /', Z7: 'ชิ้น /', AA7: 'เซต /', AB7: 'ม้วน /', AC7: 'เส้น /', AD7: 'กก.',
};

// ================= รับข้อมูลจาก Pilot Web =================

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // สองคนบันทึกพร้อมกันต้องไม่ต่อแถวใหม่ซ้ำกันในชีตรายงานNCR
    lock.waitLock(20000);
    var payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var batch = Array.isArray(payload.batch) ? payload.batch : [];
    var saved = 0;
    batch.forEach(function (item) {
      if (!item || String(item.key || '').indexOf('ncr:') !== 0) return;
      var record = parseRecord_(item.value);
      if (!record || 'ncr:' + record.id !== String(item.key)) return;
      saveRecord_(record, String(item.value));
      saved++;
    });
    return jsonOutput_({ ok: true, count: saved });
  } catch (err) {
    return jsonOutput_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

function doGet() {
  return ContentService.createTextOutput('OK').setMimeType(ContentService.MimeType.TEXT);
}

// ตรวจรูปแบบขั้นต่ำของข้อมูลจากภายนอก — ไม่ผ่านก็ข้ามไปเงียบ ๆ ไม่เขียนอะไรลงชีต
function parseRecord_(rawValue) {
  var raw = String(rawValue || '');
  if (!raw || raw.length > MAX_VALUE_LENGTH) return null;
  var record;
  try {
    record = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  if (!record || typeof record !== 'object') return null;
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) return null;
  if (typeof record.ncrNo !== 'string' || !record.ncrNo.trim() || record.ncrNo.length > 50) return null;
  if (record.isTest === true) return null; // ใบโหมดทดสอบไม่ลงทะเบียนจริง
  return record;
}

function saveRecord_(record, rawValue) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  upsertData_(getDataSheet_(ss), record, rawValue);
  upsertLogRow_(ss.getSheetByName(LOG_SHEET_NAME), record);
  // ฟอร์มกำลังแสดงใบนี้อยู่ → เติมใหม่ให้ตรงกับข้อมูลล่าสุด
  var form = ss.getSheetByName(FORM_SHEET_NAME);
  if (form && normalizeDocNo_(form.getRange(FORM_DOC_NO_CELL).getDisplayValue()) === normalizeDocNo_(record.ncrNo)) {
    resetForm_(form);
    fillForm_(form, record);
  }
}

function getDataSheet_(ss) {
  var sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(DATA_SHEET_NAME);
    sheet.getRange(1, 1, 1, DATA_HEADERS.length).setValues([DATA_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

// upsert ด้วย id (คอลัมน์ B) — เลขที่ใบ (คอลัมน์ A) ใช้ค้นหาตอนดึงลงฟอร์ม
function upsertData_(sheet, record, rawValue) {
  var row = [asText_(record.ncrNo), record.id, asText_(rawValue), new Date()];
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var ids = sheet.getRange(2, 2, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (ids[i][0] === record.id) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
}

// หนึ่งแถวต่อใบในชีตรายงานNCR (คอลัมน์ A-T ตามหัวตาราง NCR LOG) upsert ด้วยเลขที่ใบ NCR
function upsertLogRow_(sheet, record) {
  if (!sheet) throw new Error('ไม่พบชีต ' + LOG_SHEET_NAME);
  var causes = Array.isArray(record.causes) ? record.causes : [];
  var reporter = record.reporter || {};
  var responder = record.responder || {};
  var followup = record.followup || {};
  var row = [
    asText_(record.ncrNo),
    dateCell_(record.issueDate),
    asText_(joinNonEmpty_([reporter.name, reporter.department], ' / ')),
    asText_(record.productName + (record.productCode ? ' (' + record.productCode + ')' : '')),
    asText_(record.description),
  ].concat(CAUSE_ORDER.map(function (cause) { return causes.indexOf(cause) >= 0 ? '✓' : ''; })).concat([
    asText_(record.correction),
    asText_(record.prevention),
    asText_(receiverText_(record)),
    dateCell_(record.correctionDue), // ระบบเก็บ "กำหนดเสร็จ" ของแนวทางแก้ไข ยังไม่มีวันที่แก้เสร็จจริงแยก
    dateCell_(followup.date),
    asText_(responder.name),
    asText_(record.statusLabel || STATUS_LABELS[record.status] || record.status),
    dateCell_(record.closedAt),
  ]);

  var target = findLogRow_(sheet, record.ncrNo);
  if (!target) target = Math.max(sheet.getLastRow() + 1, LOG_FIRST_ROW);
  sheet.getRange(target, 1, 1, row.length).setValues([row]);
  LOG_DATE_COLUMNS.forEach(function (column) {
    sheet.getRange(target, column).setNumberFormat('dd/mm/yyyy');
  });
}

function findLogRow_(sheet, ncrNo) {
  var lastRow = sheet.getLastRow();
  if (lastRow < LOG_FIRST_ROW) return 0;
  var wanted = normalizeDocNo_(ncrNo);
  var values = sheet.getRange(LOG_FIRST_ROW, 1, lastRow - LOG_FIRST_ROW + 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (normalizeDocNo_(values[i][0]) === wanted) return LOG_FIRST_ROW + i;
  }
  return 0;
}

// "แผนกที่รับ NCR / พ่อค้า": แผนกที่ ผจก.โรงงานมอบหมาย และชื่อพ่อค้าเมื่อเลือก "ส่งคืนพ่อค้า"
function receiverText_(record) {
  var departments = (Array.isArray(record.responsibilities) ? record.responsibilities : []).join(', ');
  var vendor = (record.dispositions || []).indexOf('return') >= 0 ? record.customerName : '';
  return joinNonEmpty_([departments, vendor], ' / ');
}

// ================= ดึงข้อมูลลงฟอร์ม "เอกสารNCR" =================

// simple trigger: ทำงานเองเมื่อแก้ช่อง X2 ของชีตเอกสารNCR (ไม่ต้องตั้ง trigger เพิ่ม)
function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FORM_SHEET_NAME) return;
  if (!rangesIntersect_(e.range, sheet.getRange(FORM_DOC_NO_CELL))) return;
  loadForm_(sheet);
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('NCR')
    .addItem('ดึงข้อมูลตามเลขที่ในช่อง ' + FORM_DOC_NO_CELL, 'loadFormFromMenu')
    .addItem('ล้างข้อมูลในฟอร์ม', 'clearFormFromMenu')
    .addToUi();
}

function loadFormFromMenu() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FORM_SHEET_NAME);
  if (sheet) loadForm_(sheet);
}

function clearFormFromMenu() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FORM_SHEET_NAME);
  if (sheet) resetForm_(sheet);
}

function loadForm_(sheet) {
  var docNo = String(sheet.getRange(FORM_DOC_NO_CELL).getDisplayValue() || '').trim();
  resetForm_(sheet);
  if (!docNo) return;
  var record = findRecord_(docNo);
  if (!record) {
    toast_('ไม่พบ NCR เลขที่ ' + docNo + ' ในชีต ' + DATA_SHEET_NAME + ' หรือ ' + LOG_SHEET_NAME);
    return;
  }
  fillForm_(sheet, record);
  toast_(record.status === 'cancelled'
    ? 'ดึงข้อมูล ' + record.ncrNo + ' แล้ว — ใบนี้ถูกยกเลิก'
    : 'ดึงข้อมูล ' + record.ncrNo + ' แล้ว' + (record.partial ? ' (มีเฉพาะข้อมูลในชีต ' + LOG_SHEET_NAME + ')' : ''));
}

// หาใบจาก NCR_DATA ก่อน (ข้อมูลครบทุกช่อง) ถ้าไม่มี (เช่น แถวที่กรอกมือในรายงานNCR) ใช้ข้อมูลเท่าที่ชีตรายงานNCR มี
function findRecord_(docNo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var wanted = normalizeDocNo_(docNo);
  var dataSheet = ss.getSheetByName(DATA_SHEET_NAME);
  if (dataSheet && dataSheet.getLastRow() > 1) {
    var rows = dataSheet.getRange(2, 1, dataSheet.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < rows.length; i++) {
      if (normalizeDocNo_(rows[i][0]) === wanted) {
        var record = parseRecordForForm_(rows[i][2]);
        if (record) return record;
      }
    }
  }
  var logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  var logRow = logSheet ? findLogRow_(logSheet, docNo) : 0;
  return logRow ? recordFromLogRow_(logSheet, logRow) : null;
}

function parseRecordForForm_(raw) {
  try {
    var record = JSON.parse(String(raw || ''));
    return record && typeof record === 'object' ? record : null;
  } catch (err) {
    return null;
  }
}

function recordFromLogRow_(sheet, row) {
  var values = sheet.getRange(row, 1, 1, 20).getValues()[0];
  var display = sheet.getRange(row, 1, 1, 20).getDisplayValues()[0];
  var issuer = String(display[2] || '').split(' / ');
  return {
    partial: true,
    ncrNo: display[0],
    issueDate: isoFromCell_(values[1]),
    reporter: { name: issuer[0] || '', department: issuer.slice(1).join(' / ') },
    productName: display[3],
    description: display[4],
    causes: CAUSE_ORDER.filter(function (cause, index) { return String(display[5 + index]).trim() !== ''; }),
    correction: display[12],
    prevention: display[13],
    correctionDue: isoFromCell_(values[15]),
    followup: { date: isoFromCell_(values[16]) },
    responder: { name: display[17] },
    statusLabel: display[18],
  };
}

function fillForm_(sheet, record) {
  var reporter = record.reporter || {};
  var disposer = record.disposer || {};
  var responder = record.responder || {};
  var followup = record.followup || {};
  var signoffs = record.signoffs || {};
  var values = {};

  values.X4 = formatDate_(record.issueDate) || TEMPLATE_TEXT.X4;

  // ส่วนที่ 1
  values[TEXT_CELLS.productCode] = record.productCode;
  values[TEXT_CELLS.productName] = record.productName;
  values[TEXT_CELLS.customer] = joinNonEmpty_([record.customerName, record.customerCode ? '(' + record.customerCode + ')' : ''], ' ');
  values[TEXT_CELLS.poNo] = joinNonEmpty_([record.poNo, record.lotNo ? 'Lot ' + record.lotNo : ''], ' · ');
  setCheckboxes_(values, SOURCE_CHECKBOXES, record.source ? [record.source] : []);
  if (UNIT_CELLS[record.unit]) values[UNIT_CELLS[record.unit]] = UNIT_MARK + TEMPLATE_TEXT[UNIT_CELLS[record.unit]];
  values.B16 = 'ลงชื่อ ' + (reporter.name || '__________________') + ' ผู้รายงาน';
  values.J16 = 'แผนก ' + (reporter.department || '_____________________');
  values.Q16 = 'ตำแหน่ง ' + (reporter.position || '___________________');
  values.X16 = 'วันที่ ' + (formatDate_(record.issueDate) || BLANK_DATE);

  // ส่วนที่ 2
  var responsibilities = Array.isArray(record.responsibilities) ? record.responsibilities : [];
  setCheckboxes_(values, DISPOSITION_CHECKBOXES, record.dispositions || []);
  values[FORWARD_CHECKBOX] = responsibilities.length > 0;
  values[TEXT_CELLS.forwardTo] = responsibilities.join(', ');
  values.B24 = 'ลงชื่อ ' + (disposer.name || '_________________________ ');
  values.J24 = 'วันที่ ' + (formatDate_(disposer.date) || BLANK_DATE);

  // ส่วนที่ 3
  setCheckboxes_(values, CAUSE_CHECKBOXES, record.causes || []);
  values.I37 = formatDate_(record.correctionDue) || BLANK_DATE;
  values.X37 = formatDate_(record.preventionDue) || BLANK_DATE;
  values.B39 = 'ลงชื่อ ' + (responder.name || '_________________') + ' ผู้ดำเนินการ';
  values.J39 = 'แผนก ' + (responder.department || '_____________________');
  values.Q39 = 'ตำแหน่ง ' + (responder.position || '___________________');
  values.X39 = 'วันที่ ' + (formatDate_(responder.date) || BLANK_DATE);

  // ส่วนที่ 4
  values[FOLLOWUP_CLOSED_CHECKBOX] = followup.closed === true;
  values[FOLLOWUP_CAR_CHECKBOX] = false;
  [['B', followup], ['J', signoffs.qa], ['Q', signoffs.factory], ['X', signoffs.gm]].forEach(function (pair) {
    var signer = pair[1] || {};
    if (signer.name) values[pair[0] + '44'] = signer.name;
    if (signer.date) values[pair[0] + '45'] = formatDate_(signer.date);
  });

  Object.keys(values).forEach(function (a1) {
    var value = values[a1];
    sheet.getRange(a1).setValue(typeof value === 'boolean' ? value : asText_(value));
  });

  Object.keys(QUANTITY_CELLS).forEach(function (key) {
    var quantity = record[key];
    if (quantity === null || quantity === undefined || quantity === '' || isNaN(Number(quantity))) return;
    sheet.getRange(QUANTITY_CELLS[key])
      .setNumberFormat('#,##0.###' + (record.unit ? ' "' + String(record.unit).replace(/"/g, '') + '"' : ''))
      .setValue(Number(quantity));
  });

  var description = (record.defectType ? 'ประเภทข้อบกพร่อง: ' + record.defectType + '\n' : '') + (record.description || '');
  writeLines_(sheet, LINE_FIELDS.description, description);
  writeLines_(sheet, LINE_FIELDS.dispositionNote, record.dispositionNote);
  writeLines_(sheet, LINE_FIELDS.rootCause, record.rootCause);
  writeLines_(sheet, LINE_FIELDS.correction, record.correction);
  writeLines_(sheet, LINE_FIELDS.prevention, record.prevention);
}

// คืนฟอร์มเป็นแบบฟอร์มเปล่า (ไม่แตะช่องเลขที่เอกสาร X2)
function resetForm_(sheet) {
  Object.keys(TEMPLATE_TEXT).forEach(function (a1) {
    sheet.getRange(a1).setValue(TEMPLATE_TEXT[a1]);
  });
  var checkboxes = [FORWARD_CHECKBOX, FOLLOWUP_CLOSED_CHECKBOX, FOLLOWUP_CAR_CHECKBOX]
    .concat(values_(SOURCE_CHECKBOXES), values_(DISPOSITION_CHECKBOXES), values_(CAUSE_CHECKBOXES));
  checkboxes.forEach(function (a1) { sheet.getRange(a1).setValue(false); });
  values_(TEXT_CELLS).forEach(function (a1) { sheet.getRange(a1).setValue(''); });
  values_(QUANTITY_CELLS).forEach(function (a1) { sheet.getRange(a1).setValue('').setNumberFormat('General'); });
  Object.keys(LINE_FIELDS).forEach(function (key) {
    LINE_FIELDS[key].cells.forEach(function (a1) { sheet.getRange(a1).setValue(''); });
  });
}

// ================= ตัวช่วย =================

function setCheckboxes_(values, cells, selected) {
  Object.keys(cells).forEach(function (key) {
    values[cells[key]] = selected.indexOf(key) >= 0;
  });
}

function writeLines_(sheet, field, text) {
  var lines = wrapText_(text, field.maxChars);
  if (lines.length > field.cells.length) {
    var last = field.cells.length - 1;
    lines = lines.slice(0, field.cells.length);
    lines[last] = cutText_(lines[last], field.maxChars - 1) + '…';
  }
  field.cells.forEach(function (a1, index) {
    sheet.getRange(a1)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.OVERFLOW)
      .setHorizontalAlignment('left')
      .setValue(asText_(lines[index] || ''));
  });
}

// ตัดข้อความเป็นบรรทัดตามขึ้นบรรทัดใหม่เดิม และตามความยาวไม่เกิน maxChars ต่อบรรทัด
// (ภาษาไทยไม่เว้นวรรคระหว่างคำ จึงตัดที่ช่องว่างถ้ามี ไม่มีก็ตัดตามความยาวโดยไม่แยกสระ/วรรณยุกต์ออกจากพยัญชนะ)
function wrapText_(text, maxChars) {
  var lines = [];
  String(text || '').replace(/\r\n?/g, '\n').split('\n').forEach(function (paragraph) {
    var rest = paragraph.trim();
    if (!rest) return;
    while (rest.length > maxChars) {
      var head = cutText_(rest, maxChars);
      var space = head.lastIndexOf(' ');
      if (space > maxChars * 0.6) head = head.slice(0, space);
      lines.push(head);
      rest = rest.slice(head.length).trim();
    }
    if (rest) lines.push(rest);
  });
  return lines;
}

// ตัดสตริงไม่เกิน length โดยไม่ให้สระบน/ล่าง วรรณยุกต์ (ตัวกำกับไทย) หลุดไปขึ้นต้นบรรทัดถัดไป
function cutText_(text, length) {
  var end = Math.min(length, text.length);
  while (end > 1 && end < text.length && /[ัิ-ฺ็-๎]/.test(text.charAt(end))) end--;
  return text.slice(0, end);
}

// ข้อความจากผู้ใช้ที่ขึ้นต้นด้วย = + - @ จะถูกชีตตีความเป็นสูตร — เติม ' ข้างหน้าให้เป็นข้อความล้วน
function asText_(value) {
  if (value === null || value === undefined) return '';
  var text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

// 'YYYY-MM-DD' -> Date เวลาเที่ยงวัน (กันวันที่เลื่อนเมื่อโซนเวลาของสคริปต์กับสเปรดชีตต่างกัน)
function dateCell_(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : '';
}

// 'YYYY-MM-DD' -> 'dd/MM/yyyy' (ค.ศ.)
function formatDate_(iso) {
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return match ? match[3] + '/' + match[2] + '/' + match[1] : '';
}

function isoFromCell_(value) {
  if (Object.prototype.toString.call(value) !== '[object Date]' || isNaN(value.getTime())) return '';
  return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizeDocNo_(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function joinNonEmpty_(parts, separator) {
  return parts.filter(function (part) { return part !== null && part !== undefined && String(part).trim() !== ''; }).join(separator);
}

function values_(object) {
  return Object.keys(object).map(function (key) { return object[key]; });
}

function rangesIntersect_(a, b) {
  return a.getRow() <= b.getLastRow() && b.getRow() <= a.getLastRow()
    && a.getColumn() <= b.getLastColumn() && b.getColumn() <= a.getLastColumn();
}

function toast_(message) {
  SpreadsheetApp.getActiveSpreadsheet().toast(message, 'NCR', 6);
}

function jsonOutput_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
