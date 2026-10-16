/**
 * ฟีดผลทดสอบ Mooney แบบสด (Web App) สำหรับโมดูล MNP LAB ของ MNP Workspace
 *
 * ชีต Mooney_Test_Report คือข้อมูลต้นทางและไม่มีสำเนาที่ไหน — ทุกครั้งที่หน้า MNP LAB เปิดหรือรีเฟรช เว็บส่งคำขอมาที่
 * Web App นี้ สคริปต์อ่านทุกแท็บที่มีหัวคอลัมน์ ID/Material/TestDate/Time/Temperature/Test time/MH/MV (แท็บละหนึ่งวัสดุ)
 * ณ ตอนนั้นแล้วตอบกลับเป็น JSON
 *
 * สิทธิ์ (ปฏิเสธไว้ก่อนเสมอ — fail-closed):
 *   เว็บแนบ access token ของผู้ใช้ที่ล็อกอินมาใน body สคริปต์ถาม Supabase (RPC app_lab_access ซึ่งเรียก
 *   private.can_access_lab ในฐานข้อมูล ตอนนี้ = admin เท่านั้น) ด้วยโทเค็นนั้น คืนข้อมูลเฉพาะเมื่อตอบ true เท่านั้น
 *   ทุกกรณีอื่น (ไม่มีโทเค็น โทเค็นผิด/หมดอายุ ตอบ false Supabase ล่ม) ไม่มีข้อมูลหลุดออกไป
 *   ภายหลังเพิ่มรายชื่อ ID ที่เข้าได้ที่ฐานข้อมูลจุดเดียว สคริปต์นี้ไม่ต้องแก้
 *
 * สคริปต์ไม่ต้องมี secret: URL และ publishable key ของ Supabase ด้านล่างเป็นค่าสาธารณะ (อยู่ใน app.js ของเว็บอยู่แล้ว)
 * สคริปต์ไม่บันทึกโทเค็นลง log หรือ cache
 *
 * Deploy: Deploy > New deployment > Web app — Execute as: Me, Who has access: Anyone
 *   (Anyone จำเป็นเพราะเบราว์เซอร์เรียกแบบไม่มีบัญชี Google สิทธิ์จริงตรวจที่ฐานข้อมูลตามข้างบน)
 *   สคริปต์อ่านชีตด้วยสิทธิ์ของเจ้าของสคริปต์ จึงไม่ต้องแชร์ชีตให้ผู้ใช้เว็บ ตั้งแชร์ชีตเฉพาะคนที่ต้องแก้ไขได้
 *
 * ถ้าสคริปต์ไม่ได้ผูกกับชีต (สร้างจาก script.google.com ตรงๆ) ให้ตั้ง Script property SHEET_ID = รหัสสเปรดชีต
 *
 * คอลัมน์ AVG MH / SD MH / AVG MV / SD MV ในชีตเป็นเซลล์ที่ merge หลายแถว (ค่าอยู่ที่เซลล์บนสุดของกลุ่ม)
 * สคริปต์ขยายค่านั้นไปทุกแถวในกลุ่มก่อนส่ง จึงตรงกับชีตทุกประการ ไม่คำนวณใหม่
 *
 * ฟังก์ชันที่ลงท้าย _ ไม่ใช้บริการของ Google (ยกเว้น checkAccess_/openSpreadsheet_) และมีเทสต์ที่
 * scripts/tests/lab-mooney-feed.test.mjs
 */

// ค่าสาธารณะของโปรเจกต์ Supabase (เหมือน SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY ใน app.js ของเว็บ)
var SUPABASE_URL_ = 'https://iqlydmkylqyowmvpsete.supabase.co';
var SUPABASE_PUBLISHABLE_KEY_ = 'sb_publishable_uWsULpN8jWF8XCp73B8K_A_YkbKJNUD';

var HEADERS_ = ['ID', 'Material', 'TestDate', 'Time', 'Temperature', 'Test time', 'MH', 'MV', 'AVG MH', 'SD MH', 'AVG MV', 'SD MV'];
// คอลัมน์ A–H ต้องตรงหัวคอลัมน์ ส่วน I–L (ค่าเฉลี่ย/SD) ไม่บังคับ — แท็บ "E00030S T" ไม่มี
var REQUIRED_COLUMNS_ = 8;
var STAT_COLUMNS_ = 4;
var MAX_ROWS_ = 20000;
var MAX_PROBLEMS_SHOWN_ = 20;
var MAX_TOKEN_LENGTH_ = 8192;

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

// แปลงหนึ่งแท็บเป็นแถวข้อมูล
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
    // ทำให้ครบ 4 ค่าเสมอ (ตารางที่แคบกว่านี้ให้ null) เพื่อไม่ส่ง undefined ออกไป
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

/* ---------- ตรวจสิทธิ์ (fail-closed) ---------- */

// คำขอจากเว็บ: body เป็น JSON { token } token ต้องมีรูปแบบ JWT (3 ส่วน base64url) และไม่ยาวเกินกำหนด
// รูปแบบที่ไม่ใช่ JWT ถูกปฏิเสธตั้งแต่ตรงนี้ จึงไม่มีทางแทรกอักขระแปลกๆ เข้า header Authorization
// คืน token หรือ null (null = คำขอไม่ถูกต้อง)
function parseRequestToken_(contents) {
  var body;
  try {
    body = JSON.parse(String(contents === null || contents === undefined ? '' : contents));
  } catch (error) {
    return null;
  }
  if (!body || typeof body !== 'object' || typeof body.token !== 'string') return null;
  var token = body.token.trim();
  if (!token || token.length > MAX_TOKEN_LENGTH_) return null;
  return /^[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*$/.test(token) ? token : null;
}

// ผลตอบของ Supabase RPC app_lab_access → 'allowed' | 'denied' | 'unavailable'
// 'allowed' เฉพาะเมื่อ HTTP 200 และเนื้อหาเป็น JSON true เป๊ะ ทุกกรณีอื่นไม่ได้รับอนุญาต
//   4xx (โทเค็นผิด/หมดอายุ/ไม่ใช่พนักงาน/ไม่มีฟังก์ชัน) = denied, 5xx หรืออ่านสถานะไม่ได้ = unavailable
function decideAccess_(status, text) {
  if (status === 200) {
    try {
      return JSON.parse(text) === true ? 'allowed' : 'denied';
    } catch (error) {
      return 'denied';
    }
  }
  if (typeof status === 'number' && status >= 400 && status < 500) return 'denied';
  return 'unavailable';
}

function checkAccess_(token) {
  try {
    var response = UrlFetchApp.fetch(SUPABASE_URL_ + '/rest/v1/rpc/app_lab_access', {
      method: 'post',
      contentType: 'application/json',
      headers: { apikey: SUPABASE_PUBLISHABLE_KEY_, Authorization: 'Bearer ' + token },
      payload: '{}',
      muteHttpExceptions: true
    });
    return decideAccess_(response.getResponseCode(), response.getContentText());
  } catch (error) {
    return 'unavailable';
  }
}

/* ---------- อ่านชีต ---------- */

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

function openSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

/* ---------- Web App ---------- */

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

// เปิด URL นี้ในเบราว์เซอร์ (GET) ไม่คืนข้อมูลใดๆ — ข้อมูลตอบเฉพาะ POST ที่แนบโทเค็นผู้มีสิทธิ์
function doGet() {
  return json_({ ok: false, error: 'USE_POST' });
}

// POST body (text/plain เพื่อไม่ให้เบราว์เซอร์ส่ง preflight): {"token":"<Supabase access token>"}
// ตอบ { ok: true, generated_at, rows, problem_count, problems, skipped } หรือ { ok: false, error }
// error: BAD_REQUEST | NOT_AUTHORIZED | AUTH_UNAVAILABLE | SERVER_ERROR (ไม่คืนรายละเอียดภายใน)
function doPost(e) {
  try {
    var token = parseRequestToken_(e && e.postData ? e.postData.contents : '');
    if (!token) return json_({ ok: false, error: 'BAD_REQUEST' });

    var decision = checkAccess_(token);
    if (decision === 'denied') return json_({ ok: false, error: 'NOT_AUTHORIZED' });
    if (decision !== 'allowed') return json_({ ok: false, error: 'AUTH_UNAVAILABLE' });

    var collected = collectRows_(openSpreadsheet_());
    if (collected.rows.length > MAX_ROWS_) return json_({ ok: false, error: 'SERVER_ERROR' });
    return json_({
      ok: true,
      generated_at: new Date().toISOString(),
      rows: collected.rows,
      problem_count: collected.problems.length,
      problems: collected.problems.slice(0, MAX_PROBLEMS_SHOWN_),
      skipped: collected.skipped
    });
  } catch (error) {
    return json_({ ok: false, error: 'SERVER_ERROR' });
  }
}
