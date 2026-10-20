/**
 * เติมฟอร์ม "ใบคำร้องถึงฝ่ายบริหาร" (ชีต "เอกสาร") อัตโนมัติจากเลขที่เอกสาร — v2
 *
 * วิธีใช้: พิมพ์เลขที่เอกสาร (เช่น MG-2026-000005) ที่เซลล์ AD3 ของชีต "เอกสาร"
 *   → ค้นแถวที่ตรงกันในชีต "ใบคำร้องถึงฝ่ายบริหาร" แล้วเติมค่าต่อท้ายหัวข้อในฟอร์ม
 *   → ลบค่าใน AD3 หรือใส่เลขที่ไม่พบ = ฟอร์มกลับเป็นแบบฟอร์มเปล่า
 *   → เมนู "ใบคำร้อง > ดึงข้อมูลใหม่" ใช้เติมซ้ำเมื่อข้อมูลต้นทางอัปเดต (เช่น อนุมัติแล้ว)
 *
 * ต่างจาก v1: ไม่ fix ตำแหน่งเซลล์แล้ว — ค้นหาเซลล์จาก "ข้อความหัวข้อ" ในฟอร์มทุกครั้งที่รัน
 *   (ย้ายแถว/แทรกแถวในฟอร์มได้โดยสคริปต์ยังหาเจอ) และล้างข้อความที่ v1 เขียนผิดแถวออกให้อัตโนมัติ
 *
 * วิธีติดตั้ง: Extensions > Apps Script > เปิดไฟล์ FormFill > ลบโค้ดเดิม วางโค้ดนี้แทน > Save
 *   (ไม่ต้องแก้ Code.gs และไม่ต้อง Deploy ใหม่)
 */

// ===================== CONFIG =====================
var FF_FORM_SHEET = 'เอกสาร';
var FF_DATA_SHEET = 'ใบคำร้องถึงฝ่ายบริหาร';
var FF_KEY_CELL = 'AD3';
var FF_TZ = 'Asia/Bangkok';
var FF_USE_BUDDHIST_YEAR = false; // true = แสดงปี พ.ศ.
var FF_CHECKED = '☑ ';
var FF_UNCHECKED = '☐ ';

// ค่าในคอลัมน์ "มติ" → ช่องที่จะติ๊ก (เพิ่มคำได้ถ้าระบบใช้คำอื่น)
var FF_DECISION_MAP = {
  approved: 'approve', approve: 'approve',
  rejected: 'reject', reject: 'reject', not_approved: 'reject', disapproved: 'reject',
  acknowledged: 'ack', acknowledge: 'ack', noted: 'ack', ack: 'ack',
};

// รหัสแผนกในส่วนที่ 3 (สำเนาถึง)
var FF_CC_CODES = ['PP', 'BD', 'QA', 'RB', 'GR', 'PK', 'PT', 'BG', 'SR', 'SE', 'ST', 'WH',
                   'MS', 'MT', 'ธุรการ FT', 'IT', 'EX', 'SA', 'PC', 'HR', 'AD', 'AC', 'SP'];

// ช่องในฟอร์ม: find = เงื่อนไขหาเซลล์หัวข้อ (ข้อความตัด ☑/☐ แล้ว), offset = เลื่อนไปเซลล์ที่จะเขียน
//   blank = ข้อความแบบฟอร์มเปล่า, fill(r) = ข้อความเมื่อมีข้อมูล (คืน null = ใช้ blank)
var FF_FIELDS = [
  { name: 'issueDate', find: ffEq_('วันที่ออกเอกสาร'), offset: 1,
    blank: ' _______ / _______ / _______', fill: function (r) { return ffDate_(r['ยื่นเมื่อ']); } },
  { name: 'subject', find: ffStarts_('เรื่อง'),
    blank: 'เรื่อง ', fill: function (r) { return 'เรื่อง  ' + r['เรื่อง']; } },
  { name: 'attach', find: ffStarts_('สิ่งที่แนบมาด้วย'),
    blank: 'สิ่งที่แนบมาด้วย ', fill: function (r) { return 'สิ่งที่แนบมาด้วย  ' + (r['สิ่งที่แนบมาด้วย'] || '-'); } },
  { name: 'detail', find: ffStarts_('รายละเอียด'),
    blank: 'รายละเอียด ', fill: function (r) { return 'รายละเอียด  ' + r['รายละเอียด']; } },
  { name: 'requester', find: ffStarts_('ผู้ยื่นคำร้อง'),
    blank: 'ผู้ยื่นคำร้อง __________________', fill: function (r) { return 'ผู้ยื่นคำร้อง  ' + r['ผู้ยื่นคำร้อง']; } },
  { name: 'dept', find: ffStarts_('แผนก/หน่วยงาน'),
    blank: 'แผนก/หน่วยงาน _____________', fill: function (r) { return 'แผนก/หน่วยงาน  ' + r['แผนก']; } },
  { name: 'position', find: ffStarts_('ตำแหน่ง'),
    blank: 'ตำแหน่ง ____________________', fill: function (r) { return 'ตำแหน่ง  ' + r['ตำแหน่ง']; } },
  { name: 'submitDate', find: ffStarts_('วันที่ยื่น'),
    blank: 'วันที่ยื่น ______ / ______ / ______', fill: function (r) { return 'วันที่ยื่น  ' + ffDate_(r['ยื่นเมื่อ']); } },
  { name: 'approve', find: ffStarts_('อนุมัติ ดำเนินการ'),
    blank: 'อนุมัติ ดำเนินการตามคำร้อง', fill: function (r) { return ffBox_(ffDecision_(r) === 'approve') + 'อนุมัติ ดำเนินการตามคำร้อง'; } },
  { name: 'reject', find: ffStarts_('ไม่อนุมัติ'),
    blank: 'ไม่อนุมัติคำร้อง', fill: function (r) { return ffBox_(ffDecision_(r) === 'reject') + 'ไม่อนุมัติคำร้อง'; } },
  { name: 'ack', find: ffStarts_('ได้รับทราบ'),
    blank: 'ได้รับทราบข้อมูลที่แจ้ง', fill: function (r) { return ffBox_(ffDecision_(r) === 'ack') + 'ได้รับทราบข้อมูลที่แจ้ง'; } },
  { name: 'comment', find: ffStarts_('บันทึกข้อคิดเห็น'),
    blank: 'บันทึกข้อคิดเห็น ฝ่ายบริหาร ', fill: function (r) { return 'บันทึกข้อคิดเห็น ฝ่ายบริหาร  ' + r['ความเห็น']; } },
  { name: 'fmSign', find: ffSign_('ฝ่ายบริหารโรงงาน'),
    blank: 'ลงชื่อ ________________________ ฝ่ายบริหารโรงงาน',
    fill: function (r) { return r['ผจก.โรงงาน อนุมัติโดย'] ? 'ลงชื่อ  ' + r['ผจก.โรงงาน อนุมัติโดย'] + '  ฝ่ายบริหารโรงงาน' : null; } },
  { name: 'fmDate', find: ffSign_('ฝ่ายบริหารโรงงาน'), offset: 1,
    blank: '                                  _____ / _____ / _____',
    fill: function (r) { return r['ผจก.โรงงาน เมื่อ'] ? ffDate_(r['ผจก.โรงงาน เมื่อ']) : null; } },
  { name: 'gmSign', find: ffSign_('ผู้จัดการทั่วไป'),
    blank: 'ลงชื่อ ________________________ ผู้จัดการทั่วไป',
    fill: function (r) { return r['ผจก.ทั่วไป อนุมัติโดย'] ? 'ลงชื่อ  ' + r['ผจก.ทั่วไป อนุมัติโดย'] + '  ผู้จัดการทั่วไป' : null; } },
  { name: 'gmDate', find: ffSign_('ผู้จัดการทั่วไป'), offset: 1,
    blank: '                                      _____ / _____ / _____',
    fill: function (r) { return r['ผจก.ทั่วไป เมื่อ'] ? ffDate_(r['ผจก.ทั่วไป เมื่อ']) : null; } },
];
// ==================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ใบคำร้อง')
    .addItem('ดึงข้อมูลใหม่ (ตามเลขที่ใน ' + FF_KEY_CELL + ')', 'ffRefresh')
    .addItem('ล้างฟอร์ม', 'ffClearForm')
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== FF_FORM_SHEET) return;
  var key = sheet.getRange(FF_KEY_CELL);
  var r = e.range;
  var hit = r.getRow() <= key.getRow() && key.getRow() <= r.getLastRow() &&
            r.getColumn() <= key.getColumn() && key.getColumn() <= r.getLastColumn();
  if (!hit) return;
  ffFill_(sheet);
}

function ffRefresh() {
  ffFill_(SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FF_FORM_SHEET));
}

function ffClearForm() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FF_FORM_SHEET);
  ffWrite_(sheet, null);
}

function ffFill_(sheet) {
  var ss = sheet.getParent();
  var docNo = String(sheet.getRange(FF_KEY_CELL).getDisplayValue() || '').trim();
  var rec = docNo ? ffFindRecord_(ss, docNo) : null;
  var missing = ffWrite_(sheet, rec);
  if (docNo) {
    var msg = rec ? 'ดึงข้อมูล ' + docNo + ' แล้ว' : 'ไม่พบเลขที่เอกสาร ' + docNo + ' ในชีต "' + FF_DATA_SHEET + '"';
    if (missing.length) msg += ' (หาช่องในฟอร์มไม่เจอ: ' + missing.join(', ') + ')';
    ss.toast(msg, 'ใบคำร้อง', 6);
  }
}

// ---------- ค้นหาตำแหน่งช่องในฟอร์ม ----------

// อ่านทั้งชีตครั้งเดียว คืน {name: {row, col}} ใช้ "เซลล์ล่างสุด" ที่ตรงเงื่อนไข (กันกรณีมีข้อความซ้ำด้านบน)
function ffLocate_(values) {
  var loc = {};
  FF_FIELDS.forEach(function (f) {
    for (var r = values.length - 1; r >= 0; r--) {
      for (var c = 0; c < values[r].length; c++) {
        if (f.find(ffStrip_(values[r][c]))) {
          loc[f.name] = { row: r + 1 + (f.offset || 0), col: c + 1 };
          return;
        }
      }
    }
  });
  // ตารางสำเนาถึง: หาเซลล์ "สำเนาถึง :" แล้วสแกน 6 แถวถัดไป
  loc.cc = [];
  for (var r = values.length - 1; r >= 0; r--) {
    var anchor = -1;
    for (var c = 0; c < values[r].length; c++) {
      if (ffStrip_(values[r][c]).indexOf('สำเนาถึง :') === 0 || ffStrip_(values[r][c]) === 'สำเนาถึง :') { anchor = c; break; }
    }
    if (anchor < 0) continue;
    for (var rr = r + 1; rr < Math.min(values.length, r + 7); rr++) {
      for (var cc = 0; cc < values[rr].length; cc++) {
        var t = ffStrip_(values[rr][cc]);
        if (FF_CC_CODES.indexOf(t) >= 0) loc.cc.push({ row: rr + 1, col: cc + 1, code: t });
        else if (t.indexOf('อื่นๆ') === 0) loc.cc.push({ row: rr + 1, col: cc + 1, code: 'อื่นๆ' });
      }
    }
    break;
  }
  return loc;
}

function ffWrite_(sheet, rec) {
  var values = sheet.getDataRange().getDisplayValues();
  var loc = ffLocate_(values);
  ffCleanupV1_(sheet, values, loc);

  var missing = [];
  FF_FIELDS.forEach(function (f) {
    var p = loc[f.name];
    if (!p) { missing.push(f.name); return; }
    var text = f.blank;
    if (rec) {
      var filled = f.fill(rec);
      if (filled !== null && filled !== undefined) {
        // บรรทัดวันที่ใต้ลายเซ็น: คงช่องว่างนำหน้าเดิมไว้ ให้วันที่อยู่ตรงกลางเหมือนแบบฟอร์ม
        if (f.name === 'fmDate' || f.name === 'gmDate') filled = f.blank.match(/^\s*/)[0] + filled;
        text = filled;
      }
    }
    sheet.getRange(p.row, p.col).setValue(text);
  });

  var cc = rec && rec['สำเนาถึงแผนก']
    ? String(rec['สำเนาถึงแผนก']).split(',').map(function (s) { return s.trim().toUpperCase(); })
    : [];
  var ccOther = rec ? String(rec['สำเนาอื่นๆ'] || '') : '';
  loc.cc.forEach(function (p) {
    var text;
    if (!rec) text = p.code;
    else if (p.code === 'อื่นๆ') text = ffBox_(!!ccOther) + 'อื่นๆ' + (ccOther ? ' ' + ccOther : '');
    else text = ffBox_(cc.indexOf(p.code.toUpperCase()) >= 0) + p.code;
    sheet.getRange(p.row, p.col).setValue(text);
  });
  if (!loc.cc.length) missing.push('สำเนาถึง');
  return missing;
}

// ---------- ล้างข้อความที่ v1 เขียนผิดแถว (ทำงานเฉพาะเซลล์ที่ v1 เคยเขียน และเนื้อหาเป็นของ v1 เท่านั้น) ----------
var FF_V1_CELLS = ['B11', 'K11', 'T11', 'AC11', 'L13', 'U13', 'AD13', 'B14', 'B16', 'T16', 'B17', 'T17'];
['C', 'I', 'O', 'U', 'AA', 'AG'].forEach(function (col) {
  [19, 20, 21, 22].forEach(function (row) { FF_V1_CELLS.push(col + row); });
});
var FF_A6_ORIGINAL = 'ส่วนที่ 1 แผนก/หน่วยงาน ที่ยื่นคำร้อง';

function ffCleanupV1_(sheet, values, loc) {
  var inUse = {};
  FF_FIELDS.forEach(function (f) { if (loc[f.name]) inUse[loc[f.name].row + ':' + loc[f.name].col] = true; });
  loc.cc.forEach(function (p) { inUse[p.row + ':' + p.col] = true; });

  FF_V1_CELLS.forEach(function (a1) {
    var rng = sheet.getRange(a1);
    var r = rng.getRow(), c = rng.getColumn();
    if (inUse[r + ':' + c]) return;                     // เป็นช่องจริงของฟอร์ม ห้ามลบ
    var v = (values[r - 1] && values[r - 1][c - 1]) || '';
    if (v && ffLooksLikeV1_(v)) rng.clearContent();
  });
  // v1 ต่อท้าย "FT" ที่หัวข้อส่วนที่ 1 (เป็นป้ายแนวตั้ง ไม่ใช่ช่องกรอก) → คืนค่าเดิม
  var a6 = (values[5] && values[5][0]) || '';
  if (a6.indexOf(FF_A6_ORIGINAL) === 0 && a6 !== FF_A6_ORIGINAL) sheet.getRange('A6').setValue(FF_A6_ORIGINAL);
}

function ffLooksLikeV1_(v) {
  var s = String(v);
  if (/^[☑☐]/.test(s)) return true;
  if (/^\s*(_{5}|\d{2}) \/ /.test(s)) return true;
  var prefixes = ['ผู้ยื่นคำร้อง', 'แผนก/หน่วยงาน', 'ตำแหน่ง', 'วันที่ยื่น', 'บันทึกข้อคิดเห็น', 'ลงชื่อ'];
  for (var i = 0; i < prefixes.length; i++) if (s.indexOf(prefixes[i]) === 0) return true;
  return FF_CC_CODES.indexOf(s.trim()) >= 0 || s.trim() === 'อื่นๆ';
}

// ---------- ข้อมูลต้นทาง ----------

function ffFindRecord_(ss, docNo) {
  var data = ss.getSheetByName(FF_DATA_SHEET);
  if (!data || data.getLastRow() < 2) return null;
  var values = data.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var keyCol = headers.indexOf('เลขที่เอกสาร');
  if (keyCol < 0) return null;
  var target = docNo.toUpperCase();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][keyCol]).trim().toUpperCase() === target) {
      var rec = {};
      headers.forEach(function (h, c) {
        var v = values[i][c];
        rec[h] = (v instanceof Date) ? v : (v === null || v === undefined ? '' : String(v).trim());
      });
      return rec;
    }
  }
  return null;
}

// ---------- helpers ----------

function ffStrip_(v) { return String(v || '').replace(/^[☑☐]\s*/, '').trim(); }
function ffEq_(t) { return function (s) { return s === t; }; }
function ffStarts_(t) { return function (s) { return s.indexOf(t) === 0; }; }
function ffSign_(suffix) {
  return function (s) { return s.indexOf('ลงชื่อ') === 0 && s.slice(-suffix.length) === suffix; };
}
function ffBox_(checked) { return checked ? FF_CHECKED : FF_UNCHECKED; }
function ffDecision_(r) { return FF_DECISION_MAP[String(r['มติ'] || '').trim().toLowerCase()] || ''; }

// รับได้ทั้ง Date และข้อความ ISO เช่น 2026-09-22T03:52:07.599209+00:00 → 22 / 09 / 2026 (เวลาไทย)
function ffDate_(v) {
  if (!v) return '';
  var d = v instanceof Date ? v : null;
  if (!d) {
    d = new Date(String(v).replace(/(\.\d{3})\d+/, '$1'));
    if (isNaN(d.getTime())) return String(v);
  }
  var y = Number(Utilities.formatDate(d, FF_TZ, 'yyyy')) + (FF_USE_BUDDHIST_YEAR ? 543 : 0);
  return Utilities.formatDate(d, FF_TZ, 'dd') + ' / ' + Utilities.formatDate(d, FF_TZ, 'MM') + ' / ' + y;
}
