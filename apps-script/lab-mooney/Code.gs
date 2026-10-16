/**
 * ซิงก์ผลทดสอบ Mooney จากสเปรดชีต Mooney_Test_Report ไป MNP Workspace (โมดูล MNP LAB)
 *
 * ชีตนี้ยังเป็นต้นทางของข้อมูล — สคริปต์อ่านทุกแท็บที่มีหัวคอลัมน์ ID/Material/TestDate/Time/Temperature/
 * Test time/MH/MV (แท็บละหนึ่งวัสดุ) แล้วส่งทั้งหมดไป Edge Function lab-sheet-sync ของ Supabase
 * ซึ่งบันทึกลงฐานข้อมูลแบบ "กระจกสะท้อนชีต" (ดู supabase/migrations/20261016020000_mnp_lab_mooney.sql)
 * Pilot Web อ่านจากฐานข้อมูลเท่านั้น และให้เฉพาะผู้ที่ได้รับสิทธิ์ (ตอนนี้ admin) เห็นข้อมูล
 *
 * ค่าที่ต้องตั้งใน Project Settings > Script properties (ห้ามใส่ในโค้ด/ห้ามคอมมิต):
 *   LAB_SYNC_URL     = URL ของ Edge Function เช่น https://<project>.supabase.co/functions/v1/lab-sheet-sync
 *   LAB_SYNC_SECRET  = ค่าเดียวกับ Edge Function secret LAB_SYNC_SECRET (สุ่มยาว 32 ตัวอักษรขึ้นไป)
 *
 * คอลัมน์ AVG MH / SD MH / AVG MV / SD MV ในชีตเป็นเซลล์ที่ merge หลายแถว (ค่าอยู่ที่เซลล์บนสุดของกลุ่ม)
 * สคริปต์ขยายค่านั้นไปทุกแถวในกลุ่มก่อนส่ง จึงเก็บค่าตามชีตทุกประการ ไม่คำนวณใหม่
 *
 * ฟังก์ชันที่ลงท้าย _ ไม่ใช้ SpreadsheetApp/UrlFetchApp และมีเทสต์ที่ scripts/tests/lab-mooney-sync.test.mjs
 */

var HEADERS_ = ['ID', 'Material', 'TestDate', 'Time', 'Temperature', 'Test time', 'MH', 'MV', 'AVG MH', 'SD MH', 'AVG MV', 'SD MV'];
// คอลัมน์ A–H ต้องตรงหัวคอลัมน์ ส่วน I–L (ค่าเฉลี่ย/SD) ไม่บังคับ — แท็บ "E00030S T" ไม่มี
var REQUIRED_COLUMNS_ = 8;
var STAT_COLUMNS_ = 4;
var MAX_ROWS_ = 20000;
var MAX_PROBLEMS_SHOWN_ = 10;

/* ---------- แปลงข้อมูล (pure) ---------- */

function normalizeHeader_(value) {
  return String(value === null || value === undefined ? '' : value).trim().toLowerCase().replace(/\s+/g, ' ');
}

// แท็บผลทดสอบ = แถวที่ 1 คอลัมน์ A–H ตรงหัวคอลัมน์ที่กำหนด (แท็บอื่น เช่น สรุป/กราฟ จะถูกข้าม)
function isMooneyHeader_(headerRow) {
  for (var index = 0; index < REQUIRED_COLUMNS_; index += 1) {
    if (normalizeHeader_(headerRow[index]) !== normalizeHeader_(HEADERS_[index])) return false;
  }
  return true;
}

// วันที่ตามที่ชีตแสดง (dd/mm/yyyy ปี ค.ศ.) → 'YYYY-MM-DD' หรือ null ถ้าไม่ใช่วันที่จริง
// รับ yyyy-mm-dd ด้วยเผื่อมีคนเปลี่ยนรูปแบบเซลล์ ไม่เดารูปแบบอื่น (เช่นปี พ.ศ.) เพื่อไม่ให้ข้อมูลผิดเงียบๆ
function parseDisplayDate_(text) {
  var value = String(text === null || text === undefined ? '' : text).trim();
  var day;
  var month;
  var year;
  var match = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(value);
  if (match) {
    day = Number(match[1]);
    month = Number(match[2]);
    year = Number(match[3]);
  } else {
    match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  if (year < 2000 || year > 2100) return null;
  var date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return year + '-' + pad2_(month) + '-' + pad2_(day);
}

// เวลาตามที่ชีตแสดง (h:mm:ss หรือ h:mm) → 'HH:MM:SS' หรือ null
function parseDisplayTime_(text) {
  var match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(text === null || text === undefined ? '' : text).trim());
  if (!match) return null;
  var hour = Number(match[1]);
  var minute = Number(match[2]);
  var second = match[3] === undefined ? 0 : Number(match[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return pad2_(hour) + ':' + pad2_(minute) + ':' + pad2_(second);
}

function pad2_(number) {
  return (number < 10 ? '0' : '') + number;
}

// เซลล์ว่าง → null, ตัวเลข/ข้อความที่เป็นตัวเลข → number, อย่างอื่น → NaN (ผู้เรียกถือเป็นข้อมูลผิด)
function parseNumber_(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return isFinite(value) ? value : NaN;
  var text = String(value).trim().replace(/,/g, '');
  if (text === '') return null;
  var number = Number(text);
  return isFinite(number) ? number : NaN;
}

// ขยายค่าของเซลล์ที่ merge ไปทุกช่องในช่วง merge — grid เป็นอาร์เรย์ 2 มิติ (ไม่แก้ต้นฉบับ)
// merges: [{ row, col, numRows, numCols }] พิกัดเริ่มที่ 0 เทียบกับ grid
function expandMerged_(grid, merges) {
  var copy = grid.map(function (row) { return row.slice(); });
  merges.forEach(function (merge) {
    var value = copy[merge.row] ? copy[merge.row][merge.col] : undefined;
    for (var r = merge.row; r < merge.row + merge.numRows; r += 1) {
      for (var c = merge.col; c < merge.col + merge.numCols; c += 1) {
        if (copy[r] && c < copy[r].length) copy[r][c] = value;
      }
    }
  });
  return copy;
}

// แปลงหนึ่งแท็บเป็นแถวที่ส่งเข้า RPC
//   display = getDisplayValues() ทั้งตาราง (แถวแรกคือหัวคอลัมน์) — ใช้กับ ID/Material/วันที่/เวลา ให้ตรงกับที่เห็นในชีต
//   raw     = getValues() ตารางเดียวกัน — ใช้กับค่าตัวเลข
//   merges  = ช่วง merge ของคอลัมน์ AVG/SD (I–L) พิกัดเทียบกับแถวที่ 1 และคอลัมน์ I
// คืน { rows, problems } — แถวว่างทั้งแถวข้าม ส่วนแถวที่กรอกไม่ครบ/ผิดรูปแบบเข้า problems (ไม่ส่งครึ่งๆ กลางๆ)
function rowsFromTab_(tabName, display, raw, merges) {
  var rows = [];
  var problems = [];
  var stats = expandMerged_(
    raw.map(function (row) { return row.slice(REQUIRED_COLUMNS_, REQUIRED_COLUMNS_ + STAT_COLUMNS_); }),
    merges || []
  );
  for (var index = 1; index < display.length; index += 1) {
    var shown = display[index];
    var values = raw[index];
    var blank = true;
    for (var c = 0; c < REQUIRED_COLUMNS_; c += 1) {
      if (String(shown[c] === null || shown[c] === undefined ? '' : shown[c]).trim() !== '') blank = false;
    }
    if (blank) continue;

    var where = tabName + ' แถว ' + (index + 1);
    var sampleId = String(shown[0]).trim();
    var material = String(shown[1]).trim();
    var testDate = parseDisplayDate_(shown[2]);
    var testTime = parseDisplayTime_(shown[3]);
    var temperature = parseNumber_(values[4]);
    var testMinutes = parseNumber_(values[5]);
    var mh = parseNumber_(values[6]);
    var mv = parseNumber_(values[7]);
    var rowProblems = [];
    if (!sampleId) rowProblems.push('ไม่มี ID');
    if (!material) rowProblems.push('ไม่มี Material');
    if (!testDate) rowProblems.push('วันที่ไม่ถูกต้อง "' + shown[2] + '"');
    if (!testTime) rowProblems.push('เวลาไม่ถูกต้อง "' + shown[3] + '"');
    [['Temperature', temperature], ['Test time', testMinutes], ['MH', mh], ['MV', mv]].forEach(function (pair) {
      if (pair[1] === null || (typeof pair[1] === 'number' && isNaN(pair[1]))) rowProblems.push(pair[0] + ' ไม่ใช่ตัวเลข');
    });
    var statNames = ['AVG MH', 'SD MH', 'AVG MV', 'SD MV'];
    // ทำให้ครบ 4 ค่าเสมอ (ตารางที่แคบกว่านี้ให้ null) เพื่อไม่ส่ง undefined ไปฐานข้อมูล
    var statValues = [0, 1, 2, 3].map(function (position) { return parseNumber_(stats[index][position]); });
    statValues.forEach(function (value, position) {
      if (typeof value === 'number' && isNaN(value)) rowProblems.push(statNames[position] + ' ไม่ใช่ตัวเลข');
    });
    if (rowProblems.length) {
      problems.push(where + ': ' + rowProblems.join(', '));
      continue;
    }
    rows.push({
      source_sheet: tabName,
      sample_id: sampleId,
      material: material,
      test_date: testDate,
      test_time: testTime,
      temperature_c: temperature,
      test_minutes: testMinutes,
      mh: mh,
      mv: mv,
      avg_mh: statValues[0],
      sd_mh: statValues[1],
      avg_mv: statValues[2],
      sd_mv: statValues[3]
    });
  }
  return { rows: rows, problems: problems };
}

/* ---------- อ่านชีต + ส่ง ---------- */

function collectRows_(spreadsheet) {
  var rows = [];
  var problems = [];
  var skipped = [];
  spreadsheet.getSheets().forEach(function (sheet) {
    var name = sheet.getName();
    var lastRow = sheet.getLastRow();
    if (sheet.isSheetHidden() || lastRow < 1) return;
    var header = sheet.getRange(1, 1, 1, REQUIRED_COLUMNS_).getDisplayValues()[0];
    if (!isMooneyHeader_(header)) {
      skipped.push(name);
      return;
    }
    var columns = REQUIRED_COLUMNS_ + STAT_COLUMNS_;
    var display = sheet.getRange(1, 1, lastRow, columns).getDisplayValues();
    var raw = sheet.getRange(1, 1, lastRow, columns).getValues();
    var merges = sheet.getRange(1, REQUIRED_COLUMNS_ + 1, lastRow, STAT_COLUMNS_).getMergedRanges().map(function (range) {
      return {
        row: range.getRow() - 1,
        col: range.getColumn() - (REQUIRED_COLUMNS_ + 1),
        numRows: range.getNumRows(),
        numCols: range.getNumColumns()
      };
    });
    var result = rowsFromTab_(name, display, raw, merges);
    rows = rows.concat(result.rows);
    problems = problems.concat(result.problems);
  });
  return { rows: rows, problems: problems, skipped: skipped };
}

function getSetting_(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

var ERROR_MESSAGES_ = {
  UNAUTHORIZED: 'secret ไม่ตรงกับที่ตั้งไว้ฝั่ง Supabase (LAB_SYNC_SECRET)',
  NOT_CONFIGURED: 'ฝั่ง Supabase ยังไม่ได้ตั้ง LAB_SYNC_SECRET (ต้องยาว 32 ตัวอักษรขึ้นไป)',
  LAB_INVALID_ROW: 'ฐานข้อมูลปฏิเสธข้อมูลบางแถว (ค่าผิดช่วง หรือ ID/วันที่/เวลาซ้ำกันในแท็บเดียวกัน)',
  LAB_INVALID_PAYLOAD: 'รูปแบบข้อมูลที่ส่งไม่ถูกต้อง',
  LAB_IMPORT_TOO_DESTRUCTIVE: 'การซิงก์ครั้งนี้จะลบข้อมูลที่มีอยู่เกินครึ่ง จึงไม่ทำ — ถ้าตั้งใจ ให้ใช้เมนู "ซิงก์ (ยืนยันลบข้อมูลที่หายไป)"',
  IMPORT_FAILED: 'ฐานข้อมูลบันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'
};

// คืนข้อความสรุป หรือ throw Error ข้อความไทย (ผู้เรียกแสดงเอง) — ไม่ใส่ secret ในข้อความเสมอ
function syncMooney_(force) {
  var url = getSetting_('LAB_SYNC_URL');
  var secret = getSetting_('LAB_SYNC_SECRET');
  if (!url || !secret) throw new Error('ยังไม่ได้ตั้งค่า LAB_SYNC_URL และ LAB_SYNC_SECRET ใน Project Settings > Script properties');

  var collected = collectRows_(SpreadsheetApp.getActiveSpreadsheet());
  if (collected.problems.length) {
    var shown = collected.problems.slice(0, MAX_PROBLEMS_SHOWN_).join('\n');
    var more = collected.problems.length > MAX_PROBLEMS_SHOWN_ ? '\n… และอีก ' + (collected.problems.length - MAX_PROBLEMS_SHOWN_) + ' แถว' : '';
    throw new Error('ไม่ซิงก์ เพราะพบแถวที่ข้อมูลไม่ถูกต้อง ' + collected.problems.length + ' แถว (แก้ในชีตก่อน):\n' + shown + more);
  }
  if (collected.rows.length === 0) throw new Error('ไม่พบข้อมูลผลทดสอบในชีตนี้ จึงไม่ซิงก์');
  if (collected.rows.length > MAX_ROWS_) throw new Error('ข้อมูลมากกว่า ' + MAX_ROWS_ + ' แถว เกินที่ระบบรับต่อครั้ง');

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-lab-sync-secret': secret },
    payload: JSON.stringify({ rows: collected.rows, force: force === true }),
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var body = {};
  try {
    body = JSON.parse(response.getContentText());
  } catch (parseError) {
    body = {};
  }
  if (status !== 200 || !body.ok) {
    throw new Error('ซิงก์ไม่สำเร็จ (' + status + '): ' + (ERROR_MESSAGES_[body.error] || body.error || 'ไม่ทราบสาเหตุ'));
  }
  return 'ซิงก์สำเร็จ ' + body.rows + ' แถว (ใหม่ ' + body.inserted + ' · มีอยู่แล้ว ' + body.updated + ' · ลบที่หายจากชีต ' + body.deleted + ')'
    + (collected.skipped.length ? '\nข้ามแท็บที่ไม่ใช่ผลทดสอบ: ' + collected.skipped.join(', ') : '');
}

/* ---------- เมนูและตัวตั้งเวลา ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('MNP LAB')
    .addItem('ซิงก์ไป MNP Workspace', 'syncToWorkspace')
    .addItem('ซิงก์ (ยืนยันลบข้อมูลที่หายไป)', 'syncToWorkspaceForced')
    .addSeparator()
    .addItem('ตั้งซิงก์อัตโนมัติทุกชั่วโมง', 'installHourlyTrigger')
    .addItem('ยกเลิกซิงก์อัตโนมัติ', 'removeSyncTriggers')
    .addToUi();
}

function runInteractive_(force) {
  var ui = SpreadsheetApp.getUi();
  try {
    ui.alert('MNP LAB', syncMooney_(force), ui.ButtonSet.OK);
  } catch (error) {
    ui.alert('MNP LAB', String(error.message || error), ui.ButtonSet.OK);
  }
}

function syncToWorkspace() {
  runInteractive_(false);
}

function syncToWorkspaceForced() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    'MNP LAB',
    'ข้อมูลใน MNP Workspace ที่ไม่มีในชีตนี้จะถูกลบ แม้เกินครึ่งของที่มีอยู่ ยืนยันหรือไม่?',
    ui.ButtonSet.YES_NO
  );
  if (answer === ui.Button.YES) runInteractive_(true);
}

// ตัวที่ trigger เรียก: ไม่มี UI ถ้าพลาดให้ throw เพื่อให้ Apps Script ส่งอีเมลแจ้งความล้มเหลว
function syncOnSchedule() {
  Logger.log(syncMooney_(false));
}

function installHourlyTrigger() {
  removeSyncTriggers();
  ScriptApp.newTrigger('syncOnSchedule').timeBased().everyHours(1).create();
  SpreadsheetApp.getUi().alert('MNP LAB', 'ตั้งซิงก์อัตโนมัติทุกชั่วโมงแล้ว', SpreadsheetApp.getUi().ButtonSet.OK);
}

function removeSyncTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'syncOnSchedule') ScriptApp.deleteTrigger(trigger);
  });
}
