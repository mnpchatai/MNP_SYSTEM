import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Code.gs เป็นสคริปต์ Apps Script (ไม่มี export) โหลดเข้า vm เปล่า — ฟังก์ชันที่ลงท้าย _ ที่ทดสอบไม่แตะ
// SpreadsheetApp/UrlFetchApp จึงรันนอก Apps Script ได้ ส่วนที่ต้องมี Google runtime (เมนู, ส่ง HTTP) ทดสอบด้วยมือในชีต
const source = readFileSync(new URL("../../apps-script/lab-mooney/Code.gs", import.meta.url), "utf8");
const context = vm.createContext({});
vm.runInContext(source, context);
const api = vm.runInContext(
  "({ isMooneyHeader_, parseDisplayDate_, parseDisplayTime_, parseNumber_, expandMerged_, rowsFromTab_, HEADERS_ })",
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

test("a 12-column header is the one the database import expects", () => {
  assert.deepEqual(plain(api.HEADERS_), HEADER);
});
