/**
 * ใบตรวจ QC (Data Inspection Report, ฟอร์ม QA01-PM11) จาก Pilot Web — Apps Script โปรเจกต์เดียว URL เดียว ทำ 2 อย่าง
 *
 * 1) ดาวน์โหลด Excel — Pilot Web (modules/qc-sheet.js) ส่ง { form: "qc", fileName, record } สคริปต์ "วาด" ฟอร์ม QA01-PM11 ด้วยโค้ด
 *    (ไม่พึ่งชีตต้นแบบ) ลงสเปรดชีตชั่วคราว → export เป็น .xlsx → ส่งกลับเป็น base64 → ย้ายไฟล์ชั่วคราวลงถังขยะทุกครั้ง
 *    สคริปต์ไม่อ่านข้อมูลใบใดจากสเปรดชีต ค่าทั้งหมดมาจากหน้าเว็บที่โหลดตามสิทธิ์ของผู้ดูเอง คนที่ได้ URL ไปจึงได้แค่ไฟล์ที่มีค่าที่ตัวเองส่งมา
 * 2) สำเนาสำรอง — Pilot Web ส่ง { batch: [{ key: "qc:<id>", value: "<JSON ของ record>" }] } ทุกครั้งที่หน้าใบตรวจถูกวาด
 *    สคริปต์ upsert ข้อมูลเต็มไว้ในชีตซ่อน "QC_DATA" และหนึ่งแถวต่อใบในชีต "รายงานQC" (จับคู่ด้วยเลขที่ใบ)
 *    เป็นแค่สำเนา/รายงาน — Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/ขั้นตอนทั้งหมด
 *
 * ใบโหมดทดสอบ (เลขที่ TEST-…) รับเข้าสำเนาเฉพาะเมื่อ ACCEPT_TEST_REPORTS = true และติดป้าย [ทดสอบ] ที่คอลัมน์สถานะ
 * วิธี deploy: ดู apps-script/qc-sheet/README.md (ต้องเป็นโปรเจกต์ใหม่ที่ผูกกับสเปรดชีตใบตรวจ QC ห้ามใช้ร่วมกับสคริปต์อื่น)
 *
 * ความปลอดภัย: Web App ต้องเปิด "Anyone" เพราะ Pilot Web ยิง fetch แบบ no-cors ส่วนสำเนา (แนบ token ไม่ได้) — ถือ URL เป็นความลับระดับ webhook
 * สคริปต์ตรวจรูปแบบ/ขนาดข้อมูลก่อนเขียน และเขียนข้อความทุกช่องเป็นข้อความล้วน (กันสูตรที่ขึ้นต้นด้วย =)
 */

var ACCEPT_TEST_REPORTS = true;
var TEST_PREFIX = 'TEST-';
var TEST_LABEL = '[ทดสอบ] ';

var MAX_POST = 200000;        // ขนาดข้อความที่รับต่อครั้ง (ตัวอักษร)
var MAX_VALUE_LENGTH = 49000; // ช่องเดียวของชีตเก็บได้ 50,000 ตัวอักษร
var MAX_ITEMS = 30;           // ตรงกับเพดานของฐานข้อมูล (app_qc_save_report)
var MAX_TEXT = 5000;
var COLS = 15;                // A..O

var DATA_SHEET_NAME = 'QC_DATA';
var DATA_HEADERS = ['เลขที่ใบ', 'id', 'value', 'updatedAt'];
var LOG_SHEET_NAME = 'รายงานQC';
var LOG_HEADERS = ['เลขที่ใบ', 'สถานะ', 'ผล', 'Part Number', 'Part Name', 'ลูกค้า', 'Order No.', 'Lot ยางผสม', 'ผู้ตรวจ', 'วันที่ตรวจ',
  'ผจก.QA', 'ผจก.โรงงาน', 'ผจก.ทั่วไป (GM)', 'NCR', 'อัปเดตล่าสุด'];
var LOG_FIRST_ROW = 2;

var JUDGES = ['O', 'N', 'AC', 'NA'];
var STATUS_LABELS = {
  draft: 'ร่าง', pending_qa_manager: 'รอ ผจก.QA', pending_factory_manager: 'รอ ผจก.โรงงาน', pending_general_manager: 'รอ ผจก.ทั่วไป',
  approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก',
};

// กด Run ฟังก์ชันนี้ในตัวแก้ไขหนึ่งครั้งหลังวางโค้ด ให้ Google ขออนุญาตสิทธิ์ที่ doPost ใช้ครบทุกตัว
// (สเปรดชีต, Drive สำหรับไฟล์ชั่วคราว, เรียก URL ภายนอกสำหรับ export) — ไม่สร้างหรือแก้ไฟล์ใด
function authorize() {
  SpreadsheetApp.getActiveSpreadsheet().getName();
  DriveApp.getRootFolder().getName();
  UrlFetchApp.fetch('https://www.google.com/generate_204', { muteHttpExceptions: true });
  console.log('authorize: สิทธิ์ครบแล้ว');
}

function doGet() {
  return json_({ ok: false, error: 'USE_POST' });
}

function doPost(e) {
  var contents = (e && e.postData && e.postData.contents) || '';
  if (contents.length > MAX_POST) return json_({ ok: false, error: 'TOO_LARGE' });
  var payload;
  try {
    payload = JSON.parse(contents || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'BAD_RECORD' });
  }
  if (payload && payload.form === 'qc') return exportForm_(payload);
  return backup_(payload);
}

// ================= ดาวน์โหลด Excel =================

function exportForm_(payload) {
  var tempId = null;
  var stage = 'INPUT'; // ขั้นที่กำลังทำ ส่งกลับในรหัส error ให้รู้ว่าล้มตรงไหนโดยไม่ต้องเปิด Executions
  try {
    var record = validateExportRecord_(payload.record);
    var fileName = safeFileName_(payload.fileName);

    stage = 'CREATE';
    var temp = SpreadsheetApp.create('QA01-PM11 export ' + new Date().toISOString());
    tempId = temp.getId();
    var sheet = temp.getSheets()[0];
    sheet.setName('QA01-PM11');

    stage = 'DRAW';
    drawReport_(sheet, exportLayout_(record));
    SpreadsheetApp.flush();

    stage = 'EXPORT';
    var url = 'https://docs.google.com/spreadsheets/d/' + tempId + '/export?format=xlsx&gid=' + sheet.getSheetId()
      + '&portrait=false&size=A4&fitw=true&gridlines=false';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    if (response.getResponseCode() !== 200) throw new Error('EXPORT_HTTP_' + response.getResponseCode());
    return json_({ ok: true, fileName: fileName, base64: Utilities.base64Encode(response.getBlob().getBytes()) });
  } catch (err) {
    console.error('qc-sheet', stage, String(err));
    return json_({ ok: false, error: errorCode_(err, stage) });
  } finally {
    if (tempId) {
      try { DriveApp.getFileById(tempId).setTrashed(true); } catch (cleanupError) { console.error('cleanup', String(cleanupError)); }
    }
  }
}

// ข้อความจากหน้าเว็บ: ตัดความยาว และเติม ' นำหน้าค่าที่ขึ้นต้นด้วย = + - @ (กฎเดียวกับ asText_) ให้ชีตเก็บเป็นข้อความ ไม่รันเป็นสูตรด้วยสิทธิ์เจ้าของสคริปต์
function cleanText_(value, max) {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('BAD_RECORD');
  var text = String(value).slice(0, max || MAX_TEXT);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function cleanNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' || !isFinite(value) || Math.abs(value) > 1000000000) throw new Error('BAD_RECORD');
  return value;
}

// ตรวจและทำความสะอาด record ของใบ (ผลของ buildSheetRecord ใน modules/qc-model.js) — ผิดรูป = BAD_RECORD
function validateExportRecord_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('BAD_RECORD');
  var reportNo = cleanText_(record.reportNo, 50);
  if (!reportNo) throw new Error('BAD_RECORD');
  if (!Array.isArray(record.items) || record.items.length > MAX_ITEMS) throw new Error('BAD_RECORD');
  var approvals = {};
  ['qa', 'factory', 'gm'].forEach(function (key) {
    var step = (record.approvals && record.approvals[key]) || {};
    approvals[key] = {
      status: cleanText_(step.status, 20), name: cleanText_(step.name, 200), date: cleanText_(step.date, 20), comment: cleanText_(step.comment, 1000),
    };
  });
  var items = record.items.map(function (item) {
    if (!item || typeof item !== 'object') throw new Error('BAD_RECORD');
    if (typeof item.itemNo !== 'string' || !/^[A-Z]{1,2}$/.test(item.itemNo)) throw new Error('BAD_RECORD');
    if (JUDGES.indexOf(item.judge) < 0) throw new Error('BAD_RECORD');
    if (!Array.isArray(item.points) || item.points.length > 5) throw new Error('BAD_RECORD');
    return {
      itemNo: item.itemNo, name: cleanText_(item.name, 200), instrument: cleanText_(item.instrument, 200), unit: cleanText_(item.unit, 40),
      specMin: cleanNumber_(item.specMin), specStd: cleanNumber_(item.specStd), specMax: cleanNumber_(item.specMax),
      points: item.points.map(cleanNumber_), min: cleanNumber_(item.min), max: cleanNumber_(item.max), avg: cleanNumber_(item.avg),
      judge: item.judge, note: cleanText_(item.note, 500),
    };
  });
  return {
    reportNo: reportNo, isTest: record.isTest === true, status: cleanText_(record.status, 40), statusLabel: cleanText_(record.statusLabel, 60),
    result: cleanText_(record.result, 20), resultLabel: cleanText_(record.resultLabel, 60),
    // Part Number ไม่บังคับ: ว่าง = ชิ้นงานเดี่ยวไม่มีเลข Part ฟอร์มกระดาษใส่ "-" (ใส่หลัง cleanText_ ไม่งั้นถูกเติม ' หน้า - กันสูตร)
    partNumber: cleanText_(record.partNumber, 100) || '-', partName: cleanText_(record.partName, 300),
    customer: cleanText_(record.customer, 200), orderNo: cleanText_(record.orderNo, 100), code: cleanText_(record.code, 100),
    sampleLabel: cleanText_(record.sampleLabel, 40) || '2M', lots: cleanText_(record.lots, 1000), inspector: cleanText_(record.inspector, 200),
    inspectedAt: cleanText_(record.inspectedAt, 20), approvals: approvals,
    remark: cleanText_(record.remark, MAX_TEXT), items: items, ncrNo: cleanText_(record.ncrNo, 50),
  };
}

// ผังฟอร์ม QA01-PM11 เป็นข้อมูลล้วน (ไม่เรียก service ใดของ Google) — แถว × 15 คอลัมน์ (A..O) พร้อมรายการ merge / รูปแบบ / เส้นขอบ
// ITEM No. · Inspection Item · Instrument · Specification MIN/STD/MAX · Sample point 1–5 · min · max · average · Judge · REMARK · ช่องลงนาม 4 ช่อง
function exportLayout_(record) {
  var rows = [];
  var layout = { rows: rows, merges: [], bold: [], center: [], borders: [], wraps: [], heights: [], judges: [], formats: [] };
  function newRow() {
    var row = [];
    for (var i = 0; i < COLS; i++) row.push('');
    rows.push(row);
    return rows.length;
  }
  function put(rowNo, col, value) { rows[rowNo - 1][col - 1] = value; }
  function merge(rowNo, from, to, rowSpan) { if (to > from || rowSpan > 1) layout.merges.push([rowNo, from, rowSpan || 1, to - from + 1]); }

  var title = newRow();
  put(title, 1, 'M&P WORLD POLYMER CO.,LTD.'); merge(title, 1, 12);
  put(title, 13, 'Doc No. QA01-PM11'); merge(title, 13, 15);
  var subtitle = newRow();
  put(subtitle, 1, 'Data Inspection Report'); merge(subtitle, 1, 12);
  put(subtitle, 13, 'Rev. 00'); merge(subtitle, 13, 15);
  layout.bold.push([title, 1, 2, COLS]);
  layout.center.push([title, 1, 2, COLS]);
  layout.heights.push([title, 28]);
  newRow();

  var headFirst = rows.length + 1;
  function pair(label1, value1, label2, value2) {
    var row = newRow();
    put(row, 1, label1); merge(row, 1, 2);
    put(row, 3, value1); merge(row, 3, 7);
    put(row, 8, label2); merge(row, 8, 9);
    put(row, 10, value2); merge(row, 10, 15);
    layout.bold.push([row, 1, 1, 2], [row, 8, 1, 2]);
  }
  pair('Part Number', record.partNumber, 'Order No.', record.orderNo);
  pair('Part Name', record.partName, 'Code', record.code);
  pair('customer', record.customer, 'Inspecter By', record.inspector);
  pair('Lot ยางผสม', record.lots, 'inspection Date', record.inspectedAt);
  pair('Results', record.resultLabel, 'Report No.', (record.isTest ? TEST_LABEL : '') + record.reportNo + (record.statusLabel ? ' (' + record.statusLabel + ')' : ''));
  layout.borders.push([headFirst, 1, rows.length - headFirst + 1, COLS]);
  newRow();

  var head1 = newRow();
  var head2 = newRow();
  put(head1, 1, 'ITEM No.'); put(head1, 2, 'Inspection Item'); put(head1, 3, 'Instrument');
  put(head1, 4, 'Specification'); merge(head1, 4, 6);
  put(head1, 7, 'Sample (' + record.sampleLabel + ')'); merge(head1, 7, 11);
  put(head1, 12, 'min'); put(head1, 13, 'max'); put(head1, 14, 'average'); put(head1, 15, 'Judge');
  [1, 2, 3, 12, 13, 14, 15].forEach(function (col) { merge(head1, col, col, 2); });
  put(head2, 4, 'MIN'); put(head2, 5, 'STD'); put(head2, 6, 'MAX');
  for (var point = 1; point <= 5; point++) put(head2, 6 + point, point);
  layout.bold.push([head1, 1, 2, COLS]);
  layout.center.push([head1, 1, 2, COLS]);

  var itemFirst = rows.length + 1;
  record.items.forEach(function (item) {
    var row = newRow();
    put(row, 1, item.itemNo);
    put(row, 2, item.name + (item.unit ? ' (' + item.unit + ')' : ''));
    put(row, 3, item.instrument);
    [item.specMin, item.specStd, item.specMax].forEach(function (value, index) { put(row, 4 + index, value === null ? '' : value); });
    for (var i = 0; i < 5; i++) put(row, 7 + i, item.points[i] === undefined ? '' : item.points[i]);
    [item.min, item.max, item.avg].forEach(function (value, index) { put(row, 12 + index, value === null ? '' : value); });
    put(row, 15, item.judge === 'NA' ? '-' : item.judge);
    layout.judges.push([row, item.judge]);
  });
  var itemLast = rows.length;
  layout.borders.push([head1, 1, itemLast - head1 + 1, COLS]);
  layout.formats.push([1, 1, itemLast, COLS, '@']);
  if (itemLast >= itemFirst) {
    // General = แสดงตามค่าจริง (12 เป็น 12, ค่าเฉลี่ย 9.142 เป็น 9.142) ไม่ปัดจนค่าที่เกินสเปกดูเหมือนอยู่ในสเปก
    // และไม่ทิ้งจุดทศนิยมค้างกับจำนวนเต็มอย่าง '0.####'
    layout.formats.push([itemFirst, 4, itemLast - itemFirst + 1, 11, 'General']);
    layout.center.push([itemFirst, 15, itemLast - itemFirst + 1, 1], [itemFirst, 1, itemLast - itemFirst + 1, 1]);
  }
  newRow();

  // REMARK: หมายเหตุรายข้อ (เช่น เหตุผลที่ยอมรับ AC) ต่อท้ายใต้ REMARK ของใบ
  var notes = record.items.filter(function (item) { return item.note; })
    .map(function (item) { return 'รายการ ' + item.itemNo + ': ' + item.note; });
  var remarkText = [record.remark].concat(notes).filter(function (line) { return line; }).join('\n');
  var remark = newRow();
  put(remark, 1, 'REMARK : ' + remarkText); merge(remark, 1, COLS);
  layout.wraps.push([remark, 1, 1, COLS]);
  layout.borders.push([remark, 1, 1, COLS]);
  layout.heights.push([remark, 24 + 18 * Math.max(1, remarkText.split('\n').length + Math.floor(remarkText.length / 110))]);
  newRow();

  // ช่องลงนาม 4 ช่อง พร้อมวันที่/เวลา: Inspector ลงนามเมื่อส่งใบ ที่เหลือเป็น 3 ขั้นอนุมัติ
  var submitted = record.status !== 'draft' && record.status !== 'cancelled' && record.inspector;
  var inspectorBlock = { role: 'Inspector', name: submitted ? record.inspector : '', date: submitted ? record.inspectedAt : '' };
  function approvalBlock(role, step) {
    var name = '';
    if (step.status === 'approved') name = step.name;
    else if (step.status === 'rejected') name = 'ไม่อนุมัติ: ' + step.name + (step.comment ? '\n' + step.comment : '');
    return { role: role, name: name, date: step.date };
  }
  var blocks = [inspectorBlock, approvalBlock('manager QA', record.approvals.qa), approvalBlock('factory manager', record.approvals.factory),
    approvalBlock('General Manager Approved', record.approvals.gm)];
  var spans = [[1, 4], [5, 8], [9, 12], [13, 15]];
  var roleRow = newRow();
  var nameRow = newRow();
  var dateRow = newRow();
  blocks.forEach(function (block, index) {
    var span = spans[index];
    put(roleRow, span[0], block.role); merge(roleRow, span[0], span[1]);
    put(nameRow, span[0], block.name); merge(nameRow, span[0], span[1]);
    put(dateRow, span[0], 'วันที่/เวลา : ' + block.date); merge(dateRow, span[0], span[1]);
    layout.borders.push([roleRow, span[0], 3, span[1] - span[0] + 1]);
  });
  layout.bold.push([roleRow, 1, 1, COLS]);
  layout.center.push([roleRow, 1, 3, COLS]);
  layout.wraps.push([nameRow, 1, 1, COLS]);
  layout.heights.push([nameRow, 48]);
  return layout;
}

var COLUMN_WIDTHS = [64, 210, 110, 56, 56, 56, 56, 56, 56, 56, 56, 56, 56, 64, 64];
var JUDGE_COLORS = { O: '#d7f0e3', N: '#fbd5d0', AC: '#fff0c2', NA: '#eeeeee' };

// เติมผังลงชีต (เรียก service ของ Google)
function drawReport_(sheet, layout) {
  var rows = layout.rows;
  layout.formats.forEach(function (f) { sheet.getRange(f[0], f[1], f[2], f[3]).setNumberFormat(f[4]); });
  sheet.getRange(1, 1, rows.length, COLS).setValues(rows).setVerticalAlignment('middle').setFontSize(10);
  layout.merges.forEach(function (m) { sheet.getRange(m[0], m[1], m[2], m[3]).merge(); });
  layout.bold.forEach(function (r) { sheet.getRange(r[0], r[1], r[2], r[3]).setFontWeight('bold'); });
  layout.center.forEach(function (r) { sheet.getRange(r[0], r[1], r[2], r[3]).setHorizontalAlignment('center'); });
  layout.wraps.forEach(function (r) { sheet.getRange(r[0], r[1], r[2], r[3]).setWrap(true); });
  layout.borders.forEach(function (r) { sheet.getRange(r[0], r[1], r[2], r[3]).setBorder(true, true, true, true, true, true); });
  layout.heights.forEach(function (h) { sheet.setRowHeight(h[0], h[1]); });
  layout.judges.forEach(function (j) { sheet.getRange(j[0], 15).setBackground(JUDGE_COLORS[j[1]] || '#ffffff'); });
  sheet.getRange(1, 1, 1, 1).setFontSize(14);
  COLUMN_WIDTHS.forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
}

function safeFileName_(name) {
  var cleaned = String(name || '').replace(/[^\p{L}\p{N}_.-]+/gu, '-').slice(0, 80);
  return /\.xlsx$/.test(cleaned) ? cleaned : 'QA01-PM11.xlsx';
}

// ส่งกลับแค่รหัส ไม่ส่งข้อความ error ดิบ (อาจมี ID ของไฟล์/รายละเอียดภายใน) ข้อความเต็มอยู่ใน Executions
// รหัสที่ไม่รู้จักบอกขั้นที่ล้ม: FAILED_CREATE / FAILED_DRAW / FAILED_EXPORT (+ HTTP status ถ้ามี)
function errorCode_(err, stage) {
  var message = String(err && err.message || '');
  if (['BAD_RECORD', 'TOO_LARGE'].indexOf(message) >= 0) return message;
  var http = /^EXPORT_HTTP_(\d{3})$/.exec(message);
  return 'FAILED_' + (stage || 'UNKNOWN') + (http ? '_' + http[1] : '');
}

// ================= สำเนาสำรองลงชีต =================

function backup_(payload) {
  var lock = LockService.getScriptLock();
  try {
    // สองคนบันทึกพร้อมกันต้องไม่ต่อแถวใหม่ซ้ำกันในชีตรายงานQC
    lock.waitLock(20000);
    var batch = payload && Array.isArray(payload.batch) ? payload.batch : [];
    var saved = 0;
    batch.forEach(function (item) {
      if (!item || String(item.key || '').indexOf('qc:') !== 0) return;
      var record = parseRecord_(item.value);
      if (!record || 'qc:' + record.id !== String(item.key)) return;
      saveRecord_(record, String(item.value));
      saved++;
    });
    return json_({ ok: true, count: saved });
  } catch (err) {
    console.error('qc-sheet backup', String(err));
    return json_({ ok: false, error: 'FAILED_BACKUP' });
  } finally {
    lock.releaseLock();
  }
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
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
  if (typeof record.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(record.id)) return null;
  if (typeof record.reportNo !== 'string' || !record.reportNo.trim() || record.reportNo.length > 50) return null;
  // ใบโหมดทดสอบรับเฉพาะตอนเปิดทดลอง และต้องเป็นเลขที่ TEST-… เท่านั้น (เมนูลบข้อมูลทดสอบใช้คำนำหน้านี้)
  if (record.isTest === true && (!ACCEPT_TEST_REPORTS || !isTestDocNo_(record.reportNo))) return null;
  if (record.isTest !== true && isTestDocNo_(record.reportNo)) return null;
  return record;
}

function saveRecord_(record, rawValue) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  upsertData_(getDataSheet_(ss), record, rawValue);
  upsertLogRow_(getLogSheet_(ss), record);
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

function getLogSheet_(ss) {
  var sheet = ss.getSheetByName(LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// upsert ด้วย id (คอลัมน์ B) หรือเลขที่ใบ (คอลัมน์ A) — มีแถวเดียวต่อเลขที่
// (ล้างข้อมูลทดสอบในเว็บแล้วเลข TEST-… เริ่มนับใหม่ ใบใหม่ได้ id ใหม่แต่เลขที่ซ้ำของเดิม — ให้ทับแถวเดิม)
function upsertData_(sheet, record, rawValue) {
  var row = [asText_(record.reportNo), record.id, asText_(rawValue), new Date()];
  var wanted = normalizeDocNo_(record.reportNo);
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var keys = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (keys[i][1] === record.id || normalizeDocNo_(keys[i][0]) === wanted) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]);
        return;
      }
    }
  }
  sheet.getRange(lastRow + 1, 1, 1, row.length).setValues([row]);
}

function approvalText_(step) {
  step = step || {};
  if (step.status === 'approved') return joinNonEmpty_([step.name, step.date], ' ');
  if (step.status === 'rejected') return joinNonEmpty_(['ไม่อนุมัติ', step.name, step.date], ' ');
  return '';
}

// หนึ่งแถวต่อใบในชีตรายงานQC (ตามหัวตาราง LOG_HEADERS) upsert ด้วยเลขที่ใบ ทุกช่องเป็นข้อความล้วน
function upsertLogRow_(sheet, record) {
  var approvals = record.approvals || {};
  var status = record.statusLabel || STATUS_LABELS[record.status] || record.status;
  var row = [
    record.reportNo,
    (record.isTest === true ? TEST_LABEL : '') + status,
    record.resultLabel || record.result,
    record.partNumber,
    record.partName,
    record.customer,
    record.orderNo,
    record.lots,
    record.inspector,
    record.inspectedAt,
    approvalText_(approvals.qa),
    approvalText_(approvals.factory),
    approvalText_(approvals.gm),
    record.ncrNo,
    record.updatedAt,
  ].map(asText_);
  // Part Number ไม่บังคับ: ว่าง = "-" (ใส่หลัง asText_ เพราะ asText_ เติม ' หน้า - กันสูตร และช่องนี้เป็นข้อความล้วนอยู่แล้ว)
  if (!record.partNumber) row[3] = '-';
  var target = findLogRow_(sheet, record.reportNo);
  if (!target) target = Math.max(sheet.getLastRow() + 1, LOG_FIRST_ROW);
  sheet.getRange(target, 1, 1, row.length).setNumberFormat('@').setValues([row]);
}

function findLogRow_(sheet, reportNo) {
  var lastRow = sheet.getLastRow();
  if (lastRow < LOG_FIRST_ROW) return 0;
  var wanted = normalizeDocNo_(reportNo);
  var values = sheet.getRange(LOG_FIRST_ROW, 1, lastRow - LOG_FIRST_ROW + 1, 1).getDisplayValues();
  for (var i = 0; i < values.length; i++) {
    if (normalizeDocNo_(values[i][0]) === wanted) return LOG_FIRST_ROW + i;
  }
  return 0;
}

// ================= เมนูในสเปรดชีต =================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('QC')
    .addItem('ลบข้อมูลทดสอบ (TEST-) ทั้งหมด', 'deleteTestRecordsFromMenu')
    .addToUi();
}

// ลบทุกแถวที่เลขที่ขึ้นต้นด้วย TEST- ออกจาก QC_DATA และรายงานQC (ไม่แตะใบจริง)
function deleteTestRecordsFromMenu() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert('ลบข้อมูลทดสอบ', 'ลบทุกแถวที่เลขที่ขึ้นต้นด้วย ' + TEST_PREFIX + ' ออกจากชีต ' + LOG_SHEET_NAME + ' และ ' + DATA_SHEET_NAME + ' ?', ui.ButtonSet.OK_CANCEL);
  if (answer !== ui.Button.OK) return;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var removed = deleteTestRows_(ss.getSheetByName(LOG_SHEET_NAME), LOG_FIRST_ROW);
    deleteTestRows_(ss.getSheetByName(DATA_SHEET_NAME), 2);
    ss.toast('ลบข้อมูลทดสอบแล้ว ' + removed + ' ใบ', 'QC', 6);
  } finally {
    lock.releaseLock();
  }
}

// ลบจากล่างขึ้นบนเพื่อไม่ให้เลขแถวที่ยังไม่ได้ลบเลื่อน คืนจำนวนแถวที่ลบ
function deleteTestRows_(sheet, firstRow) {
  if (!sheet || sheet.getLastRow() < firstRow) return 0;
  var values = sheet.getRange(firstRow, 1, sheet.getLastRow() - firstRow + 1, 1).getDisplayValues();
  var removed = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (isTestDocNo_(values[i][0])) {
      sheet.deleteRow(firstRow + i);
      removed++;
    }
  }
  return removed;
}

// ================= ตัวช่วย =================

// ข้อความที่ขึ้นต้นด้วย = + - @ จะถูกชีตตีความเป็นสูตร — เติม ' ข้างหน้าให้เป็นข้อความล้วน
function asText_(value) {
  if (value === null || value === undefined) return '';
  var text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function isTestDocNo_(value) {
  return normalizeDocNo_(value).indexOf(TEST_PREFIX) === 0;
}

function normalizeDocNo_(value) {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

function joinNonEmpty_(parts, separator) {
  return parts.filter(function (part) { return part !== null && part !== undefined && String(part).trim() !== ''; }).join(separator);
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
