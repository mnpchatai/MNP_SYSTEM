import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Code.gs เป็นสคริปต์ Apps Script (ไม่มี export) โหลดเข้า vm — ฟังก์ชันแปลงข้อมูลไม่แตะบริการของ Google จึงทดสอบตรงๆ ได้
// ส่วน doPost ทดสอบโดยส่ง stub ของ UrlFetchApp/ContentService/SpreadsheetApp เข้า vm (ดู makeWebApp ด้านล่าง)
// สิ่งที่ยังต้องทดสอบด้วยมือบน Google จริง: getMergedRanges, การ deploy Web App และการอ่านผลข้ามโดเมนจากเบราว์เซอร์
const source = readFileSync(new URL("../../apps-script/lab-mooney/Code.gs", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const api = vm.runInContext(
  "({ isMooneyHeader_, parseDisplayDate_, parseDisplayTime_, parseNumber_, expandMerged_, rowsFromTab_, parseRequestToken_, decideAccess_, HEADERS_ })",
  context,
);
// ผลลัพธ์จาก vm มี prototype คนละ realm — แปลงผ่าน JSON ก่อนเทียบ deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));

const HEADER = ["ID", "Material", "TestDate", "Time", "Temperature", "Test time", "MH", "MV", "AVG MH", "SD MH", "AVG MV", "SD MV"];

test("a Mooney tab is recognised by its A–H headers, ignoring case and spacing", () => {
  assert.equal(api.isMooneyHeader_(HEADER), true);
  assert.equal(api.isMooneyHeader_(HEADER.map((cell) => ` ${cell.toUpperCase()}  `)), true);
  assert.equal(api.isMooneyHeader_(HEADER.slice(0, 8)), true, "AVG/SD columns are optional");
  assert.equal(api.isMooneyHeader_(["Date", "Sheet", "Notes"]), false);
  assert.equal(api.isMooneyHeader_(["ID", "Material", "TestDate", "Time", "Temp", "Test time", "MH", "MV"]), false);
  assert.equal(api.isMooneyHeader_([]), false);
});

test("dates are read day-first and must be real calendar dates", () => {
  assert.equal(api.parseDisplayDate_("21/09/2026"), "2026-09-21");
  assert.equal(api.parseDisplayDate_("09/10/2026"), "2026-10-09", "dd/mm — 9 October, not 10 September");
  assert.equal(api.parseDisplayDate_("1/9/2026"), "2026-09-01");
  assert.equal(api.parseDisplayDate_(" 2026-09-21 "), "2026-09-21");
  assert.equal(api.parseDisplayDate_("31/02/2026"), null);
  assert.equal(api.parseDisplayDate_("21/09/2569"), null, "a Buddhist-era year is refused, not guessed");
  assert.equal(api.parseDisplayDate_(""), null);
  assert.equal(api.parseDisplayDate_("Sep 21"), null);
  assert.equal(api.parseDisplayDate_(null), null);
});

test("times are normalised to HH:MM:SS and out-of-range values are refused", () => {
  assert.equal(api.parseDisplayTime_("8:29:13"), "08:29:13");
  assert.equal(api.parseDisplayTime_("16:06:21"), "16:06:21");
  assert.equal(api.parseDisplayTime_("16:06"), "16:06:00");
  assert.equal(api.parseDisplayTime_("24:00:00"), null);
  assert.equal(api.parseDisplayTime_("8:60:00"), null);
  assert.equal(api.parseDisplayTime_("8:29:61"), null);
  assert.equal(api.parseDisplayTime_("noon"), null);
  assert.equal(api.parseDisplayTime_(undefined), null);
});

test("numbers: blanks are null, text numbers are parsed, anything else is NaN", () => {
  assert.equal(api.parseNumber_(50.79), 50.79);
  assert.equal(api.parseNumber_("50.79"), 50.79);
  assert.equal(api.parseNumber_("1,234.5"), 1234.5);
  assert.equal(api.parseNumber_(""), null);
  assert.equal(api.parseNumber_("   "), null);
  assert.equal(api.parseNumber_(null), null);
  assert.equal(api.parseNumber_(undefined), null);
  assert.ok(Number.isNaN(api.parseNumber_("n/a")));
  assert.ok(Number.isNaN(api.parseNumber_(Infinity)));
});

test("merged cells spread their top-left value over the whole merged range without mutating the input", () => {
  const grid = [["h1", "h2"], [50.33, 0.45], ["", ""], ["", ""], [60, 1], ["", ""]];
  const merges = [
    { row: 1, col: 0, numRows: 3, numCols: 1 },
    { row: 1, col: 1, numRows: 3, numCols: 1 },
    { row: 4, col: 0, numRows: 2, numCols: 1 },
  ];
  const expanded = plain(api.expandMerged_(grid, merges));
  assert.deepEqual(expanded, [["h1", "h2"], [50.33, 0.45], [50.33, 0.45], [50.33, 0.45], [60, 1], [60, ""]]);
  assert.deepEqual(plain(grid[2]), ["", ""], "the input grid is untouched");
});

// ตารางจำลองแท็บ A1802: 3 แถวข้อมูลจริง (สามแถวแรกของชีต) AVG/SD merge ครอบทั้งสามแถว มีแถวว่างต่อท้าย
function a1802Tab() {
  const display = [
    HEADER,
    ["111", "A1802", "21/09/2026", "8:29:13", "100", "4", "50.79", "31.39", "50.33", "0.45", "31.52", "0.21"],
    ["112", "A1802", "21/09/2026", "8:36:01", "100", "4", "49.95", "31.78", "", "", "", ""],
    ["113", "A1802", "21/09/2026", "8:42:31", "100", "4", "50.24", "31.68", "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
  ];
  const raw = [
    HEADER,
    ["111", "A1802", "x", "x", 100, 4, 50.79, 31.39, 50.33, 0.45, 31.52, 0.21],
    ["112", "A1802", "x", "x", 100, 4, 49.95, 31.78, "", "", "", ""],
    ["113", "A1802", "x", "x", 100, 4, 50.24, 31.68, "", "", "", ""],
    ["", "", "", "", "", "", "", "", "", "", "", ""],
  ];
  const merges = [0, 1, 2, 3].map((col) => ({ row: 1, col, numRows: 3, numCols: 1 }));
  return { display, raw, merges };
}

test("a tab becomes one row per measurement with the sheet's own AVG/SD on every row of the group", () => {
  const { display, raw, merges } = a1802Tab();
  const { rows, problems } = plain(api.rowsFromTab_("A1802", display, raw, merges));
  assert.deepEqual(problems, []);
  assert.equal(rows.length, 3, "the blank trailing row is skipped");
  assert.deepEqual(rows[1], {
    source_sheet: "A1802", sample_id: "112", material: "A1802", test_date: "2026-09-21", test_time: "08:36:01",
    temperature_c: 100, test_minutes: 4, mh: 49.95, mv: 31.78, avg_mh: 50.33, sd_mh: 0.45, avg_mv: 31.52, sd_mv: 0.21,
  });
  assert.deepEqual(rows.map((row) => row.avg_mh), [50.33, 50.33, 50.33]);
});

test("a tab with empty AVG/SD cells (E00030S T) keeps them null", () => {
  const display = [
    HEADER,
    ["111", "E00030S T", "23/09/2026", "11:52:07", "145", "5", "32.14", "30.97", "", "", "", ""],
  ];
  const raw = [HEADER, ["111", "E00030S T", "x", "x", 145, 5, 32.14, 30.97, "", "", "", ""]];
  const { rows, problems } = plain(api.rowsFromTab_("E00030S T", display, raw, []));
  assert.deepEqual(problems, []);
  assert.equal(rows[0].material, "E00030S T");
  assert.equal(rows[0].temperature_c, 145);
  assert.deepEqual([rows[0].avg_mh, rows[0].sd_mh, rows[0].avg_mv, rows[0].sd_mv], [null, null, null, null]);
});

test("a table narrower than 12 columns still yields null AVG/SD instead of undefined", () => {
  const display = [HEADER.slice(0, 8), ["111", "X", "21/09/2026", "8:29:13", "100", "4", "50.79", "31.39"]];
  const raw = [HEADER.slice(0, 8), ["111", "X", "x", "x", 100, 4, 50.79, 31.39]];
  const { rows } = plain(api.rowsFromTab_("X", display, raw, []));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].avg_mh, rows[0].sd_mh, rows[0].avg_mv, rows[0].sd_mv], [null, null, null, null]);
});

test("rows with missing or malformed cells are reported with the tab and row number, never sent half-filled", () => {
  const display = [
    HEADER,
    ["111", "B0005", "31/02/2026", "10:11:14", "100", "4", "99.04", "52.58", "", "", "", ""],
    ["112", "B0005", "12/09/2026", "25:00:00", "100", "4", "96.34", "52.94", "", "", "", ""],
    ["113", "B0005", "12/09/2026", "10:26:30", "100", "4", "", "53.33", "", "", "", ""],
    ["", "B0005", "12/09/2026", "10:35:26", "100", "4", "101.45", "54.02", "", "", "", ""],
    ["122", "B0005", "12/09/2026", "10:44:00", "100", "4", "98.00", "54.00", "abc", "", "", ""],
  ];
  const raw = display.map((row, index) => (index === 0 ? row : [row[0], row[1], "x", "x", 100, 4, Number(row[6]) || "", Number(row[7]) || "", row[8], "", "", ""]));
  const { rows, problems } = plain(api.rowsFromTab_("B0005", display, raw, []));
  assert.equal(rows.length, 0);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /^B0005 แถว 2: วันที่ไม่ถูกต้อง "31\/02\/2026"/);
  assert.match(problems[1], /^B0005 แถว 3: เวลาไม่ถูกต้อง "25:00:00"/);
  assert.match(problems[2], /^B0005 แถว 4: MH ไม่ใช่ตัวเลข/);
  assert.match(problems[3], /^B0005 แถว 5: ไม่มี ID/);
  assert.match(problems[4], /^B0005 แถว 6: AVG MH ไม่ใช่ตัวเลข/);
});

test("the sheet header the feed expects is the 12-column Mooney layout", () => {
  assert.deepEqual(plain(api.HEADERS_), HEADER);
});

/* ---------- สิทธิ์และ Web App (fail-closed) ---------- */

const JWT = "aaa.bbb.ccc";

test("the request token must be a JWT-shaped string in a JSON body", () => {
  assert.equal(api.parseRequestToken_(JSON.stringify({ token: JWT })), JWT);
  assert.equal(api.parseRequestToken_(JSON.stringify({ token: `  ${JWT} ` })), JWT);
  assert.equal(api.parseRequestToken_(JSON.stringify({ token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln-_x" })), "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln-_x");
  for (const bad of [
    "", "not json", "null", "[]", '"text"', "{}", JSON.stringify({ token: 5 }), JSON.stringify({ token: "" }),
    JSON.stringify({ token: "no-dots" }), JSON.stringify({ token: "a.b" }), JSON.stringify({ token: "a.b.c.d" }),
    JSON.stringify({ token: "a.b.c\nX-Evil: 1" }), JSON.stringify({ token: "a b.c.d" }),
    JSON.stringify({ token: `${"a".repeat(9000)}.b.c` }),
  ]) {
    assert.equal(api.parseRequestToken_(bad), null, bad.slice(0, 40));
  }
  assert.equal(api.parseRequestToken_(undefined), null);
  assert.equal(api.parseRequestToken_(null), null);
});

test("only an HTTP 200 with a JSON true allows access; everything else is denied or unavailable", () => {
  assert.equal(api.decideAccess_(200, "true"), "allowed");
  assert.equal(api.decideAccess_(200, " true\n"), "allowed");
  for (const text of ["false", "null", '"true"', "1", "{}", "[true]", "", "<html>", "truee"]) {
    assert.equal(api.decideAccess_(200, text), "denied", text);
  }
  for (const status of [400, 401, 403, 404, 422]) assert.equal(api.decideAccess_(status, "true"), "denied", String(status));
  for (const status of [500, 502, 503, 0, undefined, null, NaN, "200"]) assert.equal(api.decideAccess_(status, "true"), "unavailable", String(status));
  assert.equal(api.decideAccess_(201, "true"), "unavailable", "only exactly 200 counts");
});

// Web App ทดสอบด้วย stub: นับว่าชีตถูกอ่านกี่ครั้ง และ Supabase ถูกเรียกอย่างไร
function fakeSheet({ name, display, raw, merges = [], hidden = false }) {
  return {
    getName: () => name,
    getLastRow: () => display.length,
    isSheetHidden: () => hidden,
    getRange: (row, col, numRows, numCols) => ({
      getDisplayValues: () => display.slice(row - 1, row - 1 + numRows).map((cells) => cells.slice(col - 1, col - 1 + numCols)),
      getValues: () => raw.slice(row - 1, row - 1 + numRows).map((cells) => cells.slice(col - 1, col - 1 + numCols)),
      getMergedRanges: () => merges.map((merge) => ({
        getRow: () => merge.row + 1,
        getColumn: () => merge.col + 9,
        getNumRows: () => merge.numRows,
        getNumColumns: () => merge.numCols,
      })),
    }),
  };
}

function makeWebApp({ respond, sheets = [fakeSheet({ name: "A1802", ...a1802Tab() })], sheetError = null, sheetId = null }) {
  const calls = { fetch: [], sheetOpened: 0, sheetById: [] };
  const spreadsheet = { getSheets: () => { if (sheetError) throw sheetError; return sheets; } };
  const ctx = vm.createContext({
    UrlFetchApp: {
      fetch(url, options) {
        calls.fetch.push({ url, options });
        return respond(url, options);
      },
    },
    ContentService: { MimeType: { JSON: "JSON" }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => (key === "SHEET_ID" ? sheetId : null) }) },
    SpreadsheetApp: {
      getActiveSpreadsheet() { calls.sheetOpened += 1; return spreadsheet; },
      openById(id) { calls.sheetOpened += 1; calls.sheetById.push(id); return spreadsheet; },
    },
  });
  vm.runInContext(source, ctx);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: typeof body === "string" ? body : JSON.stringify(body) } }).text);
  return { ctx, calls, post };
}

const supabaseAnswers = (status, text) => () => ({ getResponseCode: () => status, getContentText: () => text });

test("an authorised caller gets the live rows, and Supabase is asked with the caller's own token", () => {
  const app = makeWebApp({ respond: supabaseAnswers(200, "true") });
  const body = app.post({ token: JWT });
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 3);
  assert.deepEqual(body.rows.map((row) => row.avg_mh), [50.33, 50.33, 50.33]);
  assert.equal(body.problem_count, 0);
  assert.deepEqual(body.skipped, []);
  assert.ok(!Number.isNaN(Date.parse(body.generated_at)));
  assert.equal(app.calls.fetch.length, 1);
  const [call] = app.calls.fetch;
  assert.equal(call.url, "https://iqlydmkylqyowmvpsete.supabase.co/rest/v1/rpc/app_lab_access");
  assert.equal(call.options.headers.Authorization, `Bearer ${JWT}`);
  assert.match(call.options.headers.apikey, /^sb_publishable_/);
  assert.equal(call.options.payload, "{}");
  assert.equal(call.options.method, "post");
});

test("a caller Supabase does not approve never reaches the sheet and gets no data back", () => {
  const cases = [
    ["Supabase says false (not an admin)", supabaseAnswers(200, "false"), "NOT_AUTHORIZED"],
    ["invalid or expired token (401)", supabaseAnswers(401, '{"message":"JWT expired"}'), "NOT_AUTHORIZED"],
    ["no employee behind the token (400)", supabaseAnswers(400, '{"message":"AUTH_REQUIRED"}'), "NOT_AUTHORIZED"],
    ["function missing (404)", supabaseAnswers(404, "{}"), "NOT_AUTHORIZED"],
    ["a string that merely looks like true", supabaseAnswers(200, '"true"'), "NOT_AUTHORIZED"],
    ["garbage body", supabaseAnswers(200, "<html>ok</html>"), "NOT_AUTHORIZED"],
    ["Supabase is down (503)", supabaseAnswers(503, ""), "AUTH_UNAVAILABLE"],
    ["the network call throws", () => { throw new Error("DNS failure"); }, "AUTH_UNAVAILABLE"],
  ];
  for (const [label, respond, expected] of cases) {
    const app = makeWebApp({ respond });
    const result = app.post({ token: JWT });
    assert.deepEqual(result, { ok: false, error: expected }, label);
    assert.equal(app.calls.sheetOpened, 0, `${label}: the spreadsheet must not even be opened`);
  }
});

test("malformed requests are refused before Supabase or the sheet are touched", () => {
  for (const body of ["", "{not json", "{}", JSON.stringify({ token: "no-dots" }), JSON.stringify({ token: "a.b.c\nX-Evil: 1" }), JSON.stringify({ token: 7 })]) {
    const app = makeWebApp({ respond: supabaseAnswers(200, "true") });
    assert.deepEqual(app.post(body), { ok: false, error: "BAD_REQUEST" }, body);
    assert.equal(app.calls.fetch.length, 0, `${body}: no call to Supabase`);
    assert.equal(app.calls.sheetOpened, 0, `${body}: no sheet access`);
  }
  const app = makeWebApp({ respond: supabaseAnswers(200, "true") });
  assert.deepEqual(JSON.parse(app.ctx.doPost({}).text), { ok: false, error: "BAD_REQUEST" }, "an event without postData");
  assert.deepEqual(JSON.parse(app.ctx.doPost(undefined).text), { ok: false, error: "BAD_REQUEST" });
});

test("opening the URL in a browser (GET) shows no data", () => {
  const app = makeWebApp({ respond: supabaseAnswers(200, "true") });
  assert.deepEqual(JSON.parse(app.ctx.doGet().text), { ok: false, error: "USE_POST" });
  assert.equal(app.calls.sheetOpened, 0);
  assert.equal(app.calls.fetch.length, 0);
});

test("a failure while reading the sheet returns a generic error without internals", () => {
  const app = makeWebApp({ respond: supabaseAnswers(200, "true"), sheetError: new Error("Exception: secret internal detail") });
  const text = app.ctx.doPost({ postData: { contents: JSON.stringify({ token: JWT }) } }).text;
  assert.deepEqual(JSON.parse(text), { ok: false, error: "SERVER_ERROR" });
  assert.ok(!text.includes("secret internal detail"));
});

test("hidden tabs and tabs that are not Mooney results are left out; the other tabs still arrive", () => {
  const summary = fakeSheet({ name: "Summary", display: [["Date", "Notes"], ["x", "y"]], raw: [["Date", "Notes"], ["x", "y"]] });
  const hidden = fakeSheet({ name: "Old", hidden: true, ...a1802Tab() });
  const app = makeWebApp({ respond: supabaseAnswers(200, "true"), sheets: [fakeSheet({ name: "A1802", ...a1802Tab() }), summary, hidden] });
  const body = app.post({ token: JWT });
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 3);
  assert.deepEqual(body.skipped, ["Summary"]);
});

test("unreadable rows are reported (capped) while the readable rows are still returned", () => {
  const bad = Array.from({ length: 25 }, (_, index) => [String(index + 1), "B0005", "31/02/2026", "10:11:14", "100", "4", "99.04", "52.58", "", "", "", ""]);
  const display = [HEADER, ...bad, ["999", "B0005", "12/09/2026", "10:11:14", "100", "4", "99.04", "52.58", "", "", "", ""]];
  const raw = display.map((row, index) => (index === 0 ? row : [row[0], row[1], "x", "x", 100, 4, 99.04, 52.58, "", "", "", ""]));
  const app = makeWebApp({ respond: supabaseAnswers(200, "true"), sheets: [fakeSheet({ name: "B0005", display, raw })] });
  const body = app.post({ token: JWT });
  assert.equal(body.ok, true);
  assert.equal(body.rows.length, 1);
  assert.equal(body.problem_count, 25);
  assert.equal(body.problems.length, 20);
  assert.match(body.problems[0], /^B0005 แถว 2: วันที่ไม่ถูกต้อง "31\/02\/2026"/);
});

test("a standalone script reads the spreadsheet named by the SHEET_ID property", () => {
  const app = makeWebApp({ respond: supabaseAnswers(200, "true"), sheetId: "sheet-id-from-properties" });
  assert.equal(app.post({ token: JWT }).ok, true);
  assert.deepEqual(app.calls.sheetById, ["sheet-id-from-properties"]);
});
