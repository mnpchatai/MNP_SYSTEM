/**
 * เติมฟอร์ม "ใบคำร้องถึงฝ่ายบริหาร" (ชีต "เอกสาร") อัตโนมัติจากเลขที่เอกสาร — v2.3
 *
 * v2.3: "รายละเอียด" เริ่มเนื้อหาที่คอลัมน์ H ของแถวหัวข้อ (bodyOffset) หัวข้อ "รายละเอียด" คงเป็นข้อความของแบบฟอร์ม
 *   ไม่ถูกเขียนทับและไม่ซ้ำหน้าเนื้อหา บรรทัดแรกจึงยาวเท่าบรรทัดอื่น ส่วนบรรทัดต่อยังเริ่มที่คอลัมน์ของหัวข้อ
 * v2.2: ข้อความไม่ล้นขอบฟอร์มอีก
 *   - "รายละเอียด" และ "บันทึกข้อคิดเห็น" ตัดเป็นบรรทัดลงตามเส้นของแบบฟอร์ม (ไม่ merge เซลล์ เส้นจึงไม่หาย)
 *     ถ้ายังยาวเกินจำนวนบรรทัด จะย่อตัวอักษรก่อน และตัดท้ายพร้อมแจ้งเตือนเป็นทางสุดท้าย
 *   - ช่องบรรทัดเดียว (เรื่อง ฯลฯ) ย่อตัวอักษรให้พอดีช่อง
 *   - ติ๊กช่องสี่เหลี่ยม (checkbox) จริงของแบบฟอร์ม แทนการพิมพ์ ☑ ลงในข้อความ (ถ้าไม่พบ checkbox จะใช้ ☑/☐ แบบเดิม)
 * v2.1: แก้ช่อง "ธุรการ FT" ในส่วนที่ 3 ไม่เคยถูกติ๊ก (ฟอร์มใช้ป้าย "ธุรการ FT" แต่ชีตข้อมูลเก็บรหัสแผนก "FT")
 *   — ดู FF_CC_LABEL_TO_CODE
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

// การจัดข้อความให้อยู่ในช่อง (ขนาดจริงของคอลัมน์อ่านจากชีตด้วย getColumnWidth จึงไม่ต้องกรอกความกว้างที่นี่)
var FF_RIGHT_COL = 37;   // คอลัมน์ขวาสุดของเนื้อฟอร์ม (37 = AK) ข้อความต้องไม่เกินขอบนี้
var FF_MIN_FONT = 10;    // ย่อตัวอักษรได้เล็กสุดเท่านี้ ถ้ายังไม่พอจะตัดท้ายข้อความและแจ้งเตือน
var FF_CHAR_EM = 0.42;   // ความกว้างเฉลี่ยของ 1 ตัวอักษร เป็นเท่าของขนาดฟอนต์ (AngsanaUPC ราว 0.35)
                         // เพิ่มค่านี้ = ตัดบรรทัดเร็วขึ้น/ย่อมากขึ้น ลดค่านี้ถ้าบรรทัดสั้นเกินไป
var FF_CONT = '\u200B';  // เครื่องหมายไม่แสดงผลหน้าบรรทัดต่อ กัน ffLocate_ เข้าใจว่าข้อความในรายละเอียด/ความเห็น
                         // ที่ขึ้นต้นด้วยคำว่า "เรื่อง" "ตำแหน่ง" ฯลฯ คือหัวข้อของฟอร์ม

// ค่าในคอลัมน์ "มติ" → ช่องที่จะติ๊ก (เพิ่มคำได้ถ้าระบบใช้คำอื่น)
var FF_DECISION_MAP = {
  approved: 'approve', approve: 'approve',
  rejected: 'reject', reject: 'reject', not_approved: 'reject', disapproved: 'reject',
  acknowledged: 'ack', acknowledge: 'ack', noted: 'ack', ack: 'ack',
};

// รหัสแผนกในส่วนที่ 3 (สำเนาถึง)
var FF_CC_CODES = ['PP', 'BD', 'QA', 'RB', 'GR', 'PK', 'PT', 'BG', 'SR', 'SE', 'ST', 'WH',
                   'MS', 'MT', 'ธุรการ FT', 'IT', 'EX', 'SA', 'PC', 'HR', 'AD', 'AC', 'SP'];

// ป้ายในฟอร์ม → รหัสแผนกที่ระบบเก็บในคอลัมน์ "สำเนาถึงแผนก" (ป้ายที่ไม่อยู่ในรายการนี้ใช้เป็นรหัสตรงตัว)
var FF_CC_LABEL_TO_CODE = { 'ธุรการ FT': 'FT' };

// ช่องในฟอร์ม: find = เงื่อนไขหาเซลล์หัวข้อ (ข้อความตัด ☑/☐ แล้ว), offset = เลื่อนไปเซลล์ที่จะเขียน
//   blank = ข้อความแบบฟอร์มเปล่า, fill(r) = ข้อความเมื่อมีข้อมูล (คืน null = ใช้ blank)
//   fit + size = ช่องบรรทัดเดียว: ย่อตัวอักษรจาก size ลงมาให้พอดีช่อง (ช่องคือจากหัวข้อนี้ถึงหัวข้อถัดไปในแถวเดียวกัน
//     หรือถึงขอบขวา FF_RIGHT_COL) — size คือขนาดตัวอักษรปกติของช่องนั้นในฟอร์ม
//   block = ช่องหลายบรรทัด: ตัดข้อความเป็นบรรทัดใส่ทีละแถวตามเส้นของฟอร์ม ตั้งแต่แถวหัวข้อลงมาถึงแถวก่อนหัวข้อ until
//     (ลบ gap แถว) head = ข้อความหัวข้อหน้าบรรทัดแรก, body(r) = เนื้อหา, size = ขนาดบรรทัดแรก, lineSize = ขนาดบรรทัดต่อ
//     bodyOffset = (ไม่บังคับ) เริ่มเนื้อหาบรรทัดแรกในเซลล์ที่อยู่ทางขวาของหัวข้อกี่คอลัมน์ (C + 5 = H) หัวข้อคงเดิมไม่ถูกแก้
//       ถ้าไม่ระบุ จะเขียนต่อท้าย head ในเซลล์หัวข้อเดียวกัน
//   tick(r) = ช่องที่ติ๊กได้: ติ๊ก checkbox ที่อยู่ทางซ้ายของหัวข้อ (ถ้าไม่มี checkbox ใช้ ☑/☐ ในข้อความแทน)
var FF_FIELDS = [
  { name: 'issueDate', find: ffEq_('วันที่ออกเอกสาร'), offset: 1,
    blank: ' _______ / _______ / _______', fill: function (r) { return ffDate_(r['ยื่นเมื่อ']); } },
  { name: 'subject', find: ffStarts_('เรื่อง'), fit: true, size: 16,
    blank: 'เรื่อง ', fill: function (r) { return 'เรื่อง  ' + r['เรื่อง']; } },
  { name: 'attach', find: ffStarts_('สิ่งที่แนบมาด้วย'), fit: true, size: 16,
    blank: 'สิ่งที่แนบมาด้วย ', fill: function (r) { return 'สิ่งที่แนบมาด้วย  ' + (r['สิ่งที่แนบมาด้วย'] || '-'); } },
  { name: 'detail', find: ffStarts_('รายละเอียด'), block: { until: 'requester', gap: 0 }, size: 16, lineSize: 14, bodyOffset: 5,
    blank: 'รายละเอียด ', head: 'รายละเอียด  ', body: function (r) { return r['รายละเอียด']; } },
  { name: 'requester', find: ffStarts_('ผู้ยื่นคำร้อง'), fit: true, size: 14,
    blank: 'ผู้ยื่นคำร้อง __________________', fill: function (r) { return 'ผู้ยื่นคำร้อง  ' + r['ผู้ยื่นคำร้อง']; } },
  { name: 'dept', find: ffStarts_('แผนก/หน่วยงาน'), fit: true, size: 14,
    blank: 'แผนก/หน่วยงาน _____________', fill: function (r) { return 'แผนก/หน่วยงาน  ' + r['แผนก']; } },
  { name: 'position', find: ffStarts_('ตำแหน่ง'), fit: true, size: 14,
    blank: 'ตำแหน่ง ____________________', fill: function (r) { return 'ตำแหน่ง  ' + r['ตำแหน่ง']; } },
  { name: 'submitDate', find: ffStarts_('วันที่ยื่น'), fit: true, size: 14,
    blank: 'วันที่ยื่น ______ / ______ / ______', fill: function (r) { return 'วันที่ยื่น  ' + ffDate_(r['ยื่นเมื่อ']); } },
  { name: 'approve', find: ffStarts_('อนุมัติ ดำเนินการ'), tick: function (r) { return ffDecision_(r) === 'approve'; },
    blank: 'อนุมัติ ดำเนินการตามคำร้อง', fill: function (r) { return ffBox_(ffDecision_(r) === 'approve') + 'อนุมัติ ดำเนินการตามคำร้อง'; } },
  { name: 'reject', find: ffStarts_('ไม่อนุมัติ'), tick: function (r) { return ffDecision_(r) === 'reject'; },
    blank: 'ไม่อนุมัติคำร้อง', fill: function (r) { return ffBox_(ffDecision_(r) === 'reject') + 'ไม่อนุมัติคำร้อง'; } },
  { name: 'ack', find: ffStarts_('ได้รับทราบ'), tick: function (r) { return ffDecision_(r) === 'ack'; },
    blank: 'ได้รับทราบข้อมูลที่แจ้ง', fill: function (r) { return ffBox_(ffDecision_(r) === 'ack') + 'ได้รับทราบข้อมูลที่แจ้ง'; } },
  { name: 'comment', find: ffStarts_('บันทึกข้อคิดเห็น'), block: { until: 'fmSign', gap: 1 }, size: 14, lineSize: 14,
    blank: 'บันทึกข้อคิดเห็น ฝ่ายบริหาร ', head: 'บันทึกข้อคิดเห็น ฝ่ายบริหาร  ', body: function (r) { return r['ความเห็น']; } },
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
  var result = ffWrite_(sheet, rec);
  if (docNo) {
    var msg = rec ? 'ดึงข้อมูล ' + docNo + ' แล้ว' : 'ไม่พบเลขที่เอกสาร ' + docNo + ' ในชีต "' + FF_DATA_SHEET + '"';
    if (result.missing.length) msg += ' (หาช่องในฟอร์มไม่เจอ: ' + result.missing.join(', ') + ')';
    if (result.truncated.length) msg += ' (ข้อความยาวเกินช่อง จึงตัดท้าย: ' + result.truncated.join(', ') + ')';
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
  // อ่านความกว้างคอลัมน์และกฎช่องติ๊กครั้งเดียวแล้วใช้ซ้ำ — onEdit มีเวลาจำกัด 30 วินาที เรียกทีละเซลล์จะช้าเกินไป
  var ctx = { widths: ffWidths_(sheet), rules: sheet.getDataRange().getDataValidations() };

  var missing = [];
  var truncated = [];
  FF_FIELDS.forEach(function (f) {
    var p = loc[f.name];
    if (!p) { missing.push(f.name); return; }
    if (f.block) { ffWriteBlock_(sheet, ctx, f, p, loc, rec, truncated); return; }
    var cell = sheet.getRange(p.row, p.col);
    var box = f.tick ? ffCheckbox_(sheet, ctx, p.row, p.col - 1) : null;
    if (box) {
      box.setValue(!!(rec && f.tick(rec)));
      cell.setValue(f.blank);
      return;
    }
    var text = f.blank;
    if (rec) {
      var filled = f.fill(rec);
      if (filled !== null && filled !== undefined) {
        // บรรทัดวันที่ใต้ลายเซ็น: คงช่องว่างนำหน้าเดิมไว้ ให้วันที่อยู่ตรงกลางเหมือนแบบฟอร์ม
        if (f.name === 'fmDate' || f.name === 'gmDate') filled = f.blank.match(/^\s*/)[0] + filled;
        text = filled;
      }
    }
    if (f.fit) {
      var size = f.size;
      if (rec) {
        var fit = ffFitLine_(f.size, text, ffWidthPx_(ctx, p.col, ffSlotEnd_(f, p, loc)));
        text = fit.text;
        size = fit.size;
        if (fit.cut) truncated.push(f.name);
      }
      cell.setFontSize(size);
    }
    cell.setValue(text);
  });

  var cc = rec && rec['สำเนาถึงแผนก']
    ? String(rec['สำเนาถึงแผนก']).split(',').map(function (s) { return s.trim().toUpperCase(); })
    : [];
  var ccOther = rec ? String(rec['สำเนาอื่นๆ'] || '') : '';
  loc.cc.forEach(function (p) {
    var isOther = p.code === 'อื่นๆ';
    var ticked = !!rec && (isOther ? !!ccOther : cc.indexOf(ffCcCode_(p.code)) >= 0);
    var label = isOther && rec ? 'อื่นๆ' + (ccOther ? ' ' + ccOther : '') : p.code;
    var cell = sheet.getRange(p.row, p.col);
    if (isOther) {
      var fit = rec ? ffFitLine_(13, label, ffWidthPx_(ctx, p.col, FF_RIGHT_COL)) : { text: label, size: 13, cut: false };
      label = fit.text;
      cell.setFontSize(fit.size);
      if (fit.cut) truncated.push('สำเนาอื่นๆ');
    }
    var box = ffCheckbox_(sheet, ctx, p.row, p.col - 1);
    if (box) {
      box.setValue(ticked);
      cell.setValue(label);
    } else {
      cell.setValue(rec ? ffBox_(ticked) + label : label);
    }
  });
  if (!loc.cc.length) missing.push('สำเนาถึง');
  return { missing: missing, truncated: truncated };
}

// ---------- จัดข้อความให้อยู่ในช่อง ----------

// สระ/วรรณยุกต์ที่ซ้อนบนตัวอักษร ไม่กินความกว้าง
var FF_MARKS = '\u0E31\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E3A\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E';
// ห้ามขึ้นต้นบรรทัด (สระตาม วรรณยุกต์ ๆ ฯ) / ห้ามค้างท้ายบรรทัด (สระหน้า เ แ โ ใ ไ)
var FF_NO_START = '\u0E2F\u0E30\u0E31\u0E32\u0E33\u0E34\u0E35\u0E36\u0E37\u0E38\u0E39\u0E3A\u0E45\u0E46\u0E47\u0E48\u0E49\u0E4A\u0E4B\u0E4C\u0E4D\u0E4E';
var FF_NO_END = '\u0E40\u0E41\u0E42\u0E43\u0E44';

function ffIsMark_(ch) { return FF_MARKS.indexOf(ch) >= 0; }

// ความกว้างโดยประมาณของข้อความ หน่วยเป็น "จำนวนตัวอักษร" (ไม่นับสระ/วรรณยุกต์ที่ซ้อนอยู่บนตัวอักษร)
function ffUnits_(s) {
  var n = 0;
  for (var i = 0; i < s.length; i++) if (!ffIsMark_(s.charAt(i))) n++;
  return n;
}

// จำนวนตัวอักษรที่วางได้ในความกว้าง px (พิกเซล) ที่ขนาดตัวอักษร size (pt)
function ffCap_(px, size) { return Math.max(1, Math.floor(px / (size * 4 / 3 * FF_CHAR_EM))); }

// ความกว้าง (พิกเซล) ของคอลัมน์ 1..FF_RIGHT_COL อ่านจากชีตจริง
function ffWidths_(sheet) {
  var widths = [0];
  for (var c = 1; c <= FF_RIGHT_COL; c++) widths.push(sheet.getColumnWidth(c));
  return widths;
}

function ffWidthPx_(ctx, fromCol, toCol) {
  var px = 0;
  for (var c = fromCol; c <= toCol; c++) px += ctx.widths[c] || 0;
  return px;
}

// ช่องบรรทัดเดียวยาวถึงหัวข้อถัดไปในแถวเดียวกัน หรือถึงขอบขวาของฟอร์ม
function ffSlotEnd_(f, p, loc) {
  var end = FF_RIGHT_COL;
  FF_FIELDS.forEach(function (g) {
    var q = loc[g.name];
    if (g !== f && q && q.row === p.row && q.col > p.col && q.col - 1 < end) end = q.col - 1;
  });
  return end;
}

// ตัดท้ายให้ไม่เกิน cap หน่วย แล้วต่อ "…"
function ffTrunc_(s, cap) {
  var out = '', u = 0;
  for (var i = 0; i < s.length; i++) {
    var w = ffIsMark_(s.charAt(i)) ? 0 : 1;
    if (u + w > cap - 1) break;
    out += s.charAt(i);
    u += w;
  }
  return out + '…';
}

// ย่อขนาดตัวอักษรลงทีละ 1pt จนข้อความบรรทัดเดียวพอดีความกว้าง px; ถ้าถึง FF_MIN_FONT แล้วยังไม่พอ ตัดท้าย (cut = true)
function ffFitLine_(size, text, px) {
  while (size > FF_MIN_FONT && ffUnits_(text) > ffCap_(px, size)) size--;
  var cap = ffCap_(px, size);
  if (ffUnits_(text) <= cap) return { text: text, size: size, cut: false };
  return { text: ffTrunc_(text, cap), size: size, cut: true };
}

// หาจุดตัดบรรทัด: ได้ดัชนีที่ s.slice(0, cut) ไม่เกิน cap หน่วย เลือกตัดหลังช่องว่างถ้ามีในช่วงท้ายบรรทัด
// ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงตัดที่ตัวอักษรโดยเลี่ยงไม่ให้บรรทัดใหม่ขึ้นต้นด้วยสระตาม/วรรณยุกต์
// หรือบรรทัดเก่าค้างสระหน้า
function ffCut_(s, cap) {
  var u = 0, i = 0;
  for (; i < s.length; i++) {
    var w = ffIsMark_(s.charAt(i)) ? 0 : 1;
    if (u + w > cap) break;
    u += w;
  }
  var space = s.lastIndexOf(' ', i);
  if (space > 0 && space >= i * 0.6) return space + 1;
  var cut = i;
  while (cut > 1 && (FF_NO_START.indexOf(s.charAt(cut)) >= 0 || FF_NO_END.indexOf(s.charAt(cut - 1)) >= 0)) cut--;
  return Math.max(cut, 1);
}

// ตัดเนื้อหา body เป็นบรรทัด: บรรทัดแรกต่อจาก head (วางได้ capFirst - ความกว้าง head) บรรทัดต่อไปวางได้ capNext
// ย่อหน้า (ขึ้นบรรทัดใหม่ในต้นฉบับ) ขึ้นบรรทัดใหม่เสมอ ย่อหน้าว่างถูกข้ามเพื่อประหยัดบรรทัด
function ffLayout_(head, body, capFirst, capNext) {
  var lines = [];
  String(body === null || body === undefined ? '' : body).split(/\r?\n/).forEach(function (para) {
    var rest = para.replace(/^\s+|\s+$/g, '');
    while (rest) {
      var room = lines.length === 0 ? Math.max(1, capFirst - ffUnits_(head)) : capNext;
      if (ffUnits_(rest) <= room) {
        lines.push(rest);
        rest = '';
      } else {
        var cut = ffCut_(rest, room);
        lines.push(rest.slice(0, cut).replace(/\s+$/, ''));
        rest = rest.slice(cut).replace(/^\s+/, '');
      }
    }
  });
  return lines;
}

// ช่องหลายบรรทัด (รายละเอียด / ความเห็น): แถวหัวข้อ = บรรทัดแรก, แถวถัดลงไปตามเส้นของฟอร์ม = บรรทัดต่อ
// บรรทัดแรกอยู่ต่อท้าย head ในเซลล์หัวข้อ หรือ (ถ้าระบุ bodyOffset) อยู่ในเซลล์ทางขวาของหัวข้อโดยหัวข้อไม่ถูกแก้
// ไม่ merge เซลล์ เพราะเส้นบรรทัดของฟอร์มอยู่ที่ขอบล่างของแต่ละแถว merge แล้วเส้นจะหาย
function ffWriteBlock_(sheet, ctx, f, p, loc, rec, truncated) {
  var until = loc[f.block.until];
  var last = until ? until.row - 1 - (f.block.gap || 0) : p.row;
  var rows = Math.max(1, last - p.row + 1);
  var offset = f.bodyOffset || 0;
  var head = offset ? '' : f.head;
  var pxFirst = ffWidthPx_(ctx, p.col + offset, FF_RIGHT_COL);
  var pxNext = ffWidthPx_(ctx, p.col, FF_RIGHT_COL);
  var sizeFirst = f.size, sizeNext = f.lineSize, lines = [];
  if (rec) {
    for (var drop = 0; ; drop++) {
      sizeFirst = Math.max(FF_MIN_FONT, f.size - drop);
      sizeNext = Math.max(FF_MIN_FONT, f.lineSize - drop);
      lines = ffLayout_(head, f.body(rec), ffCap_(pxFirst, sizeFirst), ffCap_(pxNext, sizeNext));
      if (lines.length <= rows || (sizeFirst <= FF_MIN_FONT && sizeNext <= FF_MIN_FONT)) break;
    }
    if (lines.length > rows) {
      // บรรทัดสุดท้ายที่เหลือ: ถ้ามีบรรทัดเดียวต้องเผื่อที่ให้ head ด้วย
      var capLast = rows === 1 ? Math.max(1, ffCap_(pxFirst, sizeFirst) - ffUnits_(head)) : ffCap_(pxNext, sizeNext);
      lines = lines.slice(0, rows);
      lines[rows - 1] = ffTrunc_(lines[rows - 1], capLast);
      truncated.push(f.name);
    }
  }
  var label = sheet.getRange(p.row, p.col);
  if (offset) {
    // หัวข้อคงเป็นข้อความของแบบฟอร์ม เนื้อหาบรรทัดแรกลงเซลล์ถัดไป (ขึ้นต้นด้วย FF_CONT กันถูกเข้าใจว่าเป็นหัวข้อหรือสูตร)
    label.setValue(f.blank);
    var first = sheet.getRange(p.row, p.col + offset);
    first.setFontSize(sizeFirst);
    first.setValue(rec && lines.length ? FF_CONT + lines[0] : '');
  } else {
    label.setFontSize(sizeFirst);
    label.setValue(rec ? head + (lines.length ? lines[0] : '') : f.blank);
  }
  if (last > p.row) {
    var rest = [];
    for (var r = 1; r <= last - p.row; r++) rest.push([r < lines.length ? FF_CONT + lines[r] : '']);
    var area = sheet.getRange(p.row + 1, p.col, last - p.row, 1);
    area.setFontSize(sizeNext);
    area.setValues(rest);
  }
}

// ช่องติ๊ก (checkbox) จริงของฟอร์ม; ไม่ใช่ checkbox = null
function ffCheckbox_(sheet, ctx, row, col) {
  if (col < 1) return null;
  var rule = ctx.rules[row - 1] && ctx.rules[row - 1][col - 1];
  return rule && rule.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.CHECKBOX ? sheet.getRange(row, col) : null;
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
function ffCcCode_(label) { return (FF_CC_LABEL_TO_CODE[label] || label).toUpperCase(); }
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
