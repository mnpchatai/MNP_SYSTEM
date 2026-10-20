import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// FormFill.gs และ Code.gs อยู่ในโปรเจกต์ Apps Script เดียวกัน (global scope เดียวกัน) จึงโหลดทั้งคู่เข้า vm เดียว
// stub เฉพาะ Utilities/SpreadsheetApp — ฟังก์ชันที่ทดสอบอ่าน/เขียนผ่านชีตจำลองที่สร้างจากเลย์เอาต์จริงของฟอร์ม PP01-FM08
// (ตรวจจากไฟล์ที่ส่งออกจาก Google Sheets: คอลัมน์ B–AP กว้างราว 25px, เนื้อฟอร์มสิ้นสุดที่คอลัมน์ AK, พื้นที่รายละเอียดคือ
// แถว 9–21 และพื้นที่ความเห็นคือแถว 25–33 เป็นบรรทัดมีเส้น, ช่องติ๊กเป็น checkbox จริงทางซ้ายของป้ายแต่ละช่อง)
// สิ่งที่ยังต้องทดสอบด้วยมือบน Google จริง: เมนู "ใบคำร้อง", onEdit trigger, toast, ความกว้างตัวอักษรจริงของ AngsanaUPC
// (FF_CHAR_EM เป็นค่าประมาณ) และการพิมพ์ออกกระดาษ
const read = (name) => readFileSync(new URL(`../../apps-script/management-backup/${name}`, import.meta.url), "utf8");
const codeSource = read("Code.gs");
const formFillSource = read("FormFill.gs");
const moduleSource = readFileSync(new URL("../../modules/module-mg.js", import.meta.url), "utf8");

const Utilities = {
  formatDate(date, timeZone, pattern) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
    return { yyyy: parts.year, MM: parts.month, dd: parts.day }[pattern];
  },
};
const SpreadsheetApp = { DataValidationCriteria: { CHECKBOX: "CHECKBOX" } };
const context = vm.createContext({ Utilities, SpreadsheetApp });
vm.runInContext(codeSource, context);
vm.runInContext(formFillSource, context);
const api = vm.runInContext("({ ffFindRecord_, ffWrite_, ffDate_, ffLocate_, ffUnits_ })", context);
const config = vm.runInContext("({ FF_CHAR_EM, FF_MIN_FONT, FF_CONT, FF_RIGHT_COL })", context);
// ผลลัพธ์จาก vm มี prototype คนละ realm — แปลงผ่าน JSON ก่อนเทียบ deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));

/* ---------- ชีตจำลอง ---------- */

const parseA1 = (a1) => {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(a1);
  return { row: Number(row), col: [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) };
};
const ROWS = 45;
const COLS = 40;
const COLUMN_PX = 25;

function makeFormSheet(cells, checkboxes = []) {
  const store = new Map();
  const sizes = new Map();
  const key = (row, col) => `${row}:${col}`;
  for (const [a1, value] of Object.entries(cells)) {
    const { row, col } = parseA1(a1);
    store.set(key(row, col), value);
  }
  const boxes = new Set(checkboxes.map((a1) => key(parseA1(a1).row, parseA1(a1).col)));
  for (const k of boxes) store.set(k, false);
  const range = (row, col, rows = 1, cols = 1) => ({
    getRow: () => row,
    getColumn: () => col,
    setValue: (value) => store.set(key(row, col), typeof value === "boolean" ? value : String(value)),
    setValues: (values) => values.forEach((line, r) => line.forEach((value, c) => store.set(key(row + r, col + c), String(value)))),
    setFontSize: (size) => {
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) sizes.set(key(row + r, col + c), size);
    },
    clearContent: () => store.delete(key(row, col)),
  });
  const grid = (cell) => Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => cell(r + 1, c + 1)));
  return {
    getName: () => "เอกสาร",
    getRange: (first, second, rows, cols) => {
      if (typeof first === "string") {
        const { row, col } = parseA1(first);
        return range(row, col);
      }
      return range(first, second, rows, cols);
    },
    getColumnWidth: (col) => (col === 1 ? 32 : COLUMN_PX),
    getDataRange: () => ({
      getDisplayValues: () => grid((r, c) => String(store.get(key(r, c)) ?? "")),
      getDataValidations: () => grid((r, c) => (boxes.has(key(r, c)) ? { getCriteriaType: () => "CHECKBOX" } : null)),
    }),
    at(a1) {
      const { row, col } = parseA1(a1);
      return store.get(key(row, col));
    },
    size(a1) {
      const { row, col } = parseA1(a1);
      return sizes.get(key(row, col));
    },
    values: () => grid((r, c) => store.get(key(r, c))),
    store,
  };
}

// ฟอร์มเปล่าตามตำแหน่งเซลล์จริง (AD = ช่องเลขที่/วันที่, ตารางสำเนาถึง 6 คอลัมน์ C/I/O/U/AA/AG แถว 38–41)
const BLANK_FORM = {
  AD2: "เอกสารเลขที่",
  AD4: "วันที่ออกเอกสาร",
  AD5: " _______ / _______ / _______",
  A6: "ส่วนที่ 1 แผนก/หน่วยงาน ที่ยื่นคำร้อง",
  C7: "เรื่อง ",
  C8: "สิ่งที่แนบมาด้วย ",
  C9: "รายละเอียด ",
  B22: "ผู้ยื่นคำร้อง __________________",
  K22: "แผนก/หน่วยงาน _____________",
  T22: "ตำแหน่ง ____________________",
  AC22: "วันที่ยื่น ______ / ______ / ______",
  L24: "อนุมัติ ดำเนินการตามคำร้อง",
  U24: "ไม่อนุมัติคำร้อง",
  AD24: "ได้รับทราบข้อมูลที่แจ้ง",
  B25: "บันทึกข้อคิดเห็น ฝ่ายบริหาร ",
  B35: "ลงชื่อ ________________________ ฝ่ายบริหารโรงงาน",
  B36: "                                  _____ / _____ / _____",
  T35: "ลงชื่อ ________________________ ผู้จัดการทั่วไป",
  T36: "                                      _____ / _____ / _____",
  B37: "สำเนาถึง : ",
  C38: "PP", I38: "BD", O38: "QA", U38: "RB", AA38: "GR", AG38: "PK",
  C39: "PT", I39: "BG", O39: "SR", U39: "SE", AA39: "ST", AG39: "WH",
  C40: "MS", I40: "MT", O40: "ธุรการ FT", U40: "IT", AA40: "EX", AG40: "SA",
  C41: "PC", I41: "HR", O41: "AD", U41: "AC", AA41: "SP", AG41: "อื่นๆ",
};
// ช่อง checkbox จริงของฟอร์ม: ทางซ้ายของป้ายอนุมัติ/ไม่อนุมัติ/รับทราบ และของแต่ละแผนกในตารางสำเนาถึง
const CHECKBOXES = ["K24", "T24", "AC24", ...[38, 39, 40, 41].flatMap((row) => ["B", "H", "N", "T", "Z", "AF"].map((col) => `${col}${row}`))];

const HEADER = ["เลขที่เอกสาร", "แผนก", "เรื่อง", "รายละเอียด", "สิ่งที่แนบมาด้วย", "ผู้ยื่นคำร้อง", "ตำแหน่ง", "ยื่นเมื่อ", "สถานะ", "มติ", "ความเห็น",
  "ผจก.โรงงาน อนุมัติโดย", "ผจก.โรงงาน เมื่อ", "ผจก.ทั่วไป อนุมัติโดย", "ผจก.ทั่วไป เมื่อ", "สำเนาถึงแผนก", "สำเนาอื่นๆ", "อัปเดตล่าสุด"];
const APPROVED_ROW = ["FT 004/26", "FT", "ขออนุมัติเปิด OT", "ทำงานเพิ่ม 4 ชม./วัน", "", "สมชาย ใจดี", "ผู้ช่วยผู้จัดการโรงงาน", "2026-10-09T03:20:11.140928+00:00",
  "DONE", "approved", "", "สมหญิง รักงาน", "2026-10-16T03:03:48.871964+00:00", "สมศักดิ์ มั่นคง", "2026-10-16T09:00:00+00:00", "IT, ST", "", "10/16/2026 10:00:00"];
const PENDING_ROW = ["FT 005/26", "FT", "ขอซื้อเครื่องพิมพ์", "ใบปะหน้า", "ใบเสนอราคา", "สมชาย ใจดี", "ผู้ช่วยผู้จัดการโรงงาน", "2026-10-16T01:48:26.87938+00:00",
  "PENDING_FM", "", "", "", "", "", "", "", "", "10/16/2026 08:48:00"];
const COLUMN = Object.fromEntries(HEADER.map((name, index) => [name, index]));

function makeWorkbook(...rows) {
  const values = [HEADER, ...rows];
  const dataSheet = {
    getLastRow: () => values.length,
    getDataRange: () => ({ getValues: () => values }),
  };
  return { getSheetByName: (name) => (name === "ใบคำร้องถึงฝ่ายบริหาร" ? dataSheet : null) };
}

const rowWith = (base, changes) => {
  const row = [...base];
  for (const [name, value] of Object.entries(changes)) row[COLUMN[name]] = value;
  return row;
};
const fill = (sheet, row) => plain(api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(row), row[0])));

// ความกว้างที่วางข้อความได้ของบรรทัดหนึ่ง (หน่วย = ตัวอักษร) ตามสูตรเดียวกับสคริปต์
const capacity = (cols, size) => Math.floor((cols * COLUMN_PX) / ((size * 4) / 3 * config.FF_CHAR_EM));
const FORM_COLS = config.FF_RIGHT_COL - 3 + 1; // คอลัมน์ C..AK
const noSpace = (text) => text.replace(/\s+/g, "");
const stripMark = (line) => line.replace(config.FF_CONT, "");
const SENTENCE = "ขอเสนอค่าทำงานนอกสถานที่ ช่วงเวลา 1/10/26 ถึง 8/10/26 คนละ 100 บาทต่อวัน มีรายชื่อดังนี้ครับ";
const rowsOf = (sheet, column, from, to) => Array.from({ length: to - from + 1 }, (_, i) => sheet.at(`${column}${from + i}`));

/* ---------- เทสต์ ---------- */

test("FormFill.gs shares a project with Code.gs without redefining any of its globals", () => {
  const globalNames = (source) => new Set([...source.matchAll(/^(?:function|var)\s+([A-Za-z_$][\w$]*)/gm)].map((match) => match[1]));
  const shared = [...globalNames(formFillSource)].filter((name) => globalNames(codeSource).has(name));
  assert.deepEqual(shared, [], "a duplicate global would silently replace the web app's own code");
  for (const name of ["doPost", "doGet", "onOpen", "onEdit"]) {
    assert.equal(vm.runInContext(`typeof ${name}`, context), "function", name);
  }
});

test("a document number finds its row regardless of case, and unknown numbers find nothing", () => {
  const workbook = makeWorkbook(APPROVED_ROW, PENDING_ROW);
  assert.equal(api.ffFindRecord_(workbook, "FT 004/26")["เรื่อง"], "ขออนุมัติเปิด OT");
  assert.equal(api.ffFindRecord_(workbook, "ft 005/26")["เรื่อง"], "ขอซื้อเครื่องพิมพ์");
  assert.equal(api.ffFindRecord_(workbook, "FT 099/26"), null);
  assert.equal(api.ffFindRecord_(makeWorkbook(), "FT 004/26"), null);
});

test("dates are shown in Bangkok time, and the year can switch to the Buddhist era", () => {
  assert.equal(api.ffDate_("2026-10-09T03:20:11.140928+00:00"), "09 / 10 / 2026");
  assert.equal(api.ffDate_("2026-10-16T18:30:00+00:00"), "17 / 10 / 2026", "18:30 UTC is already the next day in Bangkok");
  assert.equal(api.ffDate_(""), "");
  assert.equal(api.ffDate_("not a date"), "not a date");
  context.FF_USE_BUDDHIST_YEAR = true;
  try {
    assert.equal(api.ffDate_("2026-10-09T03:20:11+00:00"), "09 / 10 / 2569");
  } finally {
    context.FF_USE_BUDDHIST_YEAR = false;
  }
});

test("an approved request fills the form, including signatures, dates and ticked boxes", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const result = fill(sheet, APPROVED_ROW);
  assert.deepEqual(result, { missing: [], truncated: [] });
  assert.equal(sheet.at("AD5"), "09 / 10 / 2026");
  assert.equal(sheet.at("C7"), "เรื่อง  ขออนุมัติเปิด OT");
  assert.equal(sheet.at("C8"), "สิ่งที่แนบมาด้วย  -");
  assert.equal(sheet.at("C9"), "รายละเอียด ", "the form's own heading is left as it is");
  assert.equal(sheet.at("H9"), `${config.FF_CONT}ทำงานเพิ่ม 4 ชม./วัน`, "the text starts at column H, without the heading word");
  assert.equal(sheet.at("B22"), "ผู้ยื่นคำร้อง  สมชาย ใจดี");
  assert.equal(sheet.at("K22"), "แผนก/หน่วยงาน  FT");
  assert.equal(sheet.at("AC22"), "วันที่ยื่น  09 / 10 / 2026");
  assert.equal(sheet.at("B35"), "ลงชื่อ  สมหญิง รักงาน  ฝ่ายบริหารโรงงาน");
  assert.equal(sheet.at("B36").trim(), "16 / 10 / 2026");
  assert.ok(sheet.at("B36").startsWith(" "), "the date keeps the form's leading spaces so it stays centred");
  assert.equal(sheet.at("T35"), "ลงชื่อ  สมศักดิ์ มั่นคง  ผู้จัดการทั่วไป");
  assert.equal(sheet.at("T36").trim(), "16 / 10 / 2026");
});

test("without checkbox cells the boxes fall back to ☑/☐ in the label text", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  fill(sheet, APPROVED_ROW);
  assert.equal(sheet.at("L24"), "☑ อนุมัติ ดำเนินการตามคำร้อง");
  assert.equal(sheet.at("U24"), "☐ ไม่อนุมัติคำร้อง");
  assert.equal(sheet.at("AD24"), "☐ ได้รับทราบข้อมูลที่แจ้ง");
  assert.equal(sheet.at("U40"), "☑ IT");
  assert.equal(sheet.at("AA39"), "☑ ST");
  assert.equal(sheet.at("C38"), "☐ PP");
  assert.equal(sheet.at("AG41"), "☐ อื่นๆ");
});

test("the form's real checkboxes are ticked instead of typing ☑ into the label", () => {
  const sheet = makeFormSheet(BLANK_FORM, CHECKBOXES);
  fill(sheet, APPROVED_ROW);
  assert.equal(sheet.at("K24"), true, "approved");
  assert.equal(sheet.at("T24"), false);
  assert.equal(sheet.at("AC24"), false);
  assert.equal(sheet.at("L24"), "อนุมัติ ดำเนินการตามคำร้อง", "the label stays plain so the box is not drawn twice");
  assert.equal(sheet.at("U24"), "ไม่อนุมัติคำร้อง");
  // IT (U40 → T40) และ ST (AA39 → Z39) ติ๊ก ที่เหลือไม่ติ๊ก
  assert.equal(sheet.at("T40"), true);
  assert.equal(sheet.at("Z39"), true);
  assert.equal(sheet.at("B38"), false);
  assert.equal(sheet.at("U40"), "IT");

  fill(sheet, rowWith(APPROVED_ROW, { "มติ": "acknowledged", "สำเนาถึงแผนก": "HR", "สำเนาอื่นๆ": "ผู้ตรวจสอบภายนอก" }));
  assert.equal(sheet.at("K24"), false);
  assert.equal(sheet.at("AC24"), true, "acknowledged");
  assert.equal(sheet.at("T40"), false, "a previous request's ticks do not linger");
  assert.equal(sheet.at("H41"), true, "HR");
  assert.equal(sheet.at("AF41"), true, "the 'other' box");
  assert.equal(sheet.at("AG41"), "อื่นๆ ผู้ตรวจสอบภายนอก");

  api.ffWrite_(sheet, null);
  for (const a1 of CHECKBOXES) assert.equal(sheet.at(a1), false, `${a1} is unticked on the blank form`);
  assert.equal(sheet.at("AG41"), "อื่นๆ");
});

test("filling another request after an approved one leaves nothing stale, and an empty record restores the blank form", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": `${SENTENCE}\n${SENTENCE}` }));
  fill(sheet, PENDING_ROW);
  assert.equal(sheet.at("C7"), "เรื่อง  ขอซื้อเครื่องพิมพ์");
  assert.equal(sheet.at("C8"), "สิ่งที่แนบมาด้วย  ใบเสนอราคา");
  assert.equal(sheet.at("C9"), "รายละเอียด ");
  assert.equal(sheet.at("H9"), `${config.FF_CONT}ใบปะหน้า`);
  assert.deepEqual(rowsOf(sheet, "C", 10, 21), Array(12).fill(""), "continuation lines of the previous description are cleared");
  assert.equal(sheet.at("L24"), "☐ อนุมัติ ดำเนินการตามคำร้อง", "no decision yet, so no box is ticked");
  assert.equal(sheet.at("B35"), BLANK_FORM.B35, "an unsigned step keeps the blank signature line");
  assert.equal(sheet.at("B36"), BLANK_FORM.B36);
  assert.equal(sheet.at("U40"), "☐ IT");

  api.ffWrite_(sheet, null);
  for (const [a1, blank] of Object.entries(BLANK_FORM)) {
    assert.equal(sheet.at(a1), blank, `${a1} goes back to the blank form`);
  }
  assert.deepEqual(rowsOf(sheet, "C", 10, 21), Array(12).fill(""));
  assert.deepEqual(rowsOf(sheet, "B", 26, 33), Array(8).fill(""));
  assert.ok(!sheet.at("H9"), "the first-line cell is empty again on the blank form");
});

test("a long description is cut into lines on the form's ruled rows instead of running off the right edge", () => {
  const description = `${SENTENCE} ${SENTENCE}\n\n${SENTENCE} ${SENTENCE} ${SENTENCE}`;
  const sheet = makeFormSheet(BLANK_FORM);
  const result = fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": description }));
  assert.deepEqual(result.truncated, []);
  assert.equal(sheet.at("C9"), "รายละเอียด ", "the heading cell is not rewritten");
  const first = sheet.at("H9");
  assert.ok(first.startsWith(config.FF_CONT), "the first line sits in column H");
  assert.ok(!stripMark(first).startsWith("รายละเอียด"), "the heading word is not repeated in front of the text");
  const used = rowsOf(sheet, "C", 10, 21).filter(Boolean);
  assert.ok(used.length >= 2 && used.length < 12, `${used.length} continuation lines`);
  for (const line of used) assert.ok(line.startsWith(config.FF_CONT), "continuation lines carry the invisible marker");

  const body = [stripMark(first), ...used.map(stripMark)];
  assert.ok(api.ffUnits_(body[0]) <= capacity(FORM_COLS - 5, 16), "the first line fits from column H to the right edge");
  for (const line of body.slice(1)) assert.ok(api.ffUnits_(line) <= capacity(FORM_COLS, 14), `a line fits the form width: ${api.ffUnits_(line)}`);
  assert.equal(noSpace(body.join("")), noSpace(description), "no text is lost");
  assert.equal(sheet.at("B22"), "ผู้ยื่นคำร้อง  สมชาย ใจดี", "nothing spills into the next section");
  assert.equal(sheet.at("C22"), undefined);
  assert.equal(sheet.size("H9"), 16);
  assert.equal(sheet.size("C10"), 14);
});

test("a long comment stays on its own ruled rows and never reaches the signature line", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const comment = `${SENTENCE}\n${SENTENCE} ${SENTENCE} ${SENTENCE}`;
  const result = fill(sheet, rowWith(APPROVED_ROW, { "ความเห็น": comment, "ผจก.โรงงาน อนุมัติโดย": "สมหญิง รักงาน" }));
  assert.deepEqual(result.truncated, []);
  const body = [sheet.at("B25").slice("บันทึกข้อคิดเห็น ฝ่ายบริหาร  ".length), ...rowsOf(sheet, "B", 26, 33).filter(Boolean).map(stripMark)];
  assert.equal(noSpace(body.join("")), noSpace(comment));
  assert.equal(sheet.at("B34"), undefined, "the spacer row above the signatures stays empty");
  assert.equal(sheet.at("B35"), "ลงชื่อ  สมหญิง รักงาน  ฝ่ายบริหารโรงงาน");
});

test("a very long description shrinks the font before it cuts anything, and warns when it must cut", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const fits = fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": "ก".repeat(1700) }));
  assert.deepEqual(fits.truncated, [], "fits once the font is a few points smaller");
  assert.ok(sheet.size("C10") < 14 && sheet.size("C10") >= config.FF_MIN_FONT, `font ${sheet.size("C10")}`);
  assert.equal(noSpace([stripMark(sheet.at("H9")), ...rowsOf(sheet, "C", 10, 21).map(stripMark)].join("")), "ก".repeat(1700));

  const cut = fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": "ก".repeat(6000) }));
  assert.deepEqual(cut.truncated, ["detail"]);
  assert.equal(sheet.size("C10"), config.FF_MIN_FONT);
  assert.ok(sheet.at("C21").endsWith("…"), "the last line shows that text was cut");

  fill(sheet, APPROVED_ROW);
  assert.equal(sheet.size("H9"), 16, "a later short request goes back to the form's normal font size");
  assert.equal(sheet.size("C10"), 14);
});

test("lines are never cut where Thai text cannot break", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": "เกาะแกะโก๋ไก่ใจ๊ดีเสื้อแม่น้ำ".repeat(70) }));
  const lines = rowsOf(sheet, "C", 10, 21).filter(Boolean).map(stripMark);
  assert.ok(lines.length >= 2);
  for (const line of [stripMark(sheet.at("H9")), ...lines.slice(0, -1)]) assert.ok(!/[\u0E40-\u0E44]$/.test(line), `leading vowel left at the end of a line: ${line.slice(-4)}`);
  for (const line of lines) assert.ok(!/^[\u0E2F\u0E30-\u0E3A\u0E45-\u0E4E]/.test(line), `a line starts with a following vowel or tone mark: ${line.slice(0, 4)}`);
});

test("text in the description or comment that looks like a form heading is never mistaken for one", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const lookalikes = ["เรื่อง ทดสอบ", "สิ่งที่แนบมาด้วย ทดสอบ", "รายละเอียด ทดสอบ", "ตำแหน่ง ทดสอบ", "ได้รับทราบ ทดสอบ", "ไม่อนุมัติ ทดสอบ", "อนุมัติ ดำเนินการ ทดสอบ", "บันทึกข้อคิดเห็น ทดสอบ", "วันที่ยื่น ทดสอบ", "ลงชื่อ ทดสอบ ผู้จัดการทั่วไป", "IT", "อื่นๆ"].join("\n");
  fill(sheet, rowWith(APPROVED_ROW, { "รายละเอียด": `ข้อความ\n${lookalikes}`, "ความเห็น": `ข้อความ\n${lookalikes}` }));
  const expected = { subject: [7, 3], attach: [8, 3], detail: [9, 3], requester: [22, 2], dept: [22, 11], position: [22, 20], submitDate: [22, 29], approve: [24, 12], reject: [24, 21], ack: [24, 30], comment: [25, 2], fmSign: [35, 2], gmSign: [35, 20] };
  const loc = plain(api.ffLocate_(sheet.values().map((line) => line.map((value) => String(value ?? "")))));
  for (const [name, [row, col]] of Object.entries(expected)) assert.deepEqual([loc[name]?.row, loc[name]?.col], [row, col], name);
  assert.equal(loc.cc.length, 24, "every department box is still found exactly once");

  fill(sheet, PENDING_ROW);
  assert.equal(sheet.at("C7"), "เรื่อง  ขอซื้อเครื่องพิมพ์", "a second fill writes to the real headings");
  assert.equal(sheet.at("L24"), "☐ อนุมัติ ดำเนินการตามคำร้อง");
  assert.equal(sheet.at("B25"), "บันทึกข้อคิดเห็น ฝ่ายบริหาร  ");
});

test("single-line fields shrink to fit their slot and go back to normal size, and cut with a warning only as a last resort", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const wide = fill(sheet, rowWith(APPROVED_ROW, { "เรื่อง": "ก".repeat(110) }));
  assert.deepEqual(wide.truncated, []);
  assert.ok(sheet.size("C7") < 16 && sheet.size("C7") >= config.FF_MIN_FONT, `font ${sheet.size("C7")}`);
  assert.equal(sheet.at("C7"), `เรื่อง  ${"ก".repeat(110)}`);

  const narrow = fill(sheet, rowWith(APPROVED_ROW, { "ผู้ยื่นคำร้อง": "ก".repeat(80) }));
  assert.deepEqual(narrow.truncated, ["requester"]);
  assert.ok(sheet.at("B22").endsWith("…"));
  assert.ok(api.ffUnits_(sheet.at("B22")) <= capacity(9, config.FF_MIN_FONT), "B..J slot (9 columns)");
  assert.equal(sheet.size("B22"), config.FF_MIN_FONT);

  fill(sheet, APPROVED_ROW);
  assert.equal(sheet.size("C7"), 16);
  assert.equal(sheet.size("B22"), 14);
  assert.equal(sheet.at("C7"), "เรื่อง  ขออนุมัติเปิด OT");
});

test("request text can never be written as a formula", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  fill(sheet, rowWith(APPROVED_ROW, {
    "เรื่อง": '=HYPERLINK("https://example.com","x")',
    "รายละเอียด": "+1+1\n=SUM(1)\n-2\n@SUM(1)",
    "ความเห็น": "@SUM(1)\n=1+1",
    "สำเนาอื่นๆ": "=1+1",
  }));
  for (const [key, value] of sheet.store) {
    assert.ok(!/^[=+\-@]/.test(String(value)), `${key} starts with a formula character: ${value}`);
  }
});

test("text a previous version wrote into the wrong rows is cleared, and the real form cells are not", () => {
  const sheet = makeFormSheet({ ...BLANK_FORM, A6: `${BLANK_FORM.A6} FT`, B11: "ผู้ยื่นคำร้อง  สมชาย ใจดี", C19: "☑ PP", T16: "ตำแหน่ง  เก่า" });
  api.ffWrite_(sheet, null);
  assert.equal(sheet.at("A6"), BLANK_FORM.A6);
  for (const a1 of ["B11", "C19", "T16"]) assert.ok(!sheet.at(a1), `${a1} is cleared`);
  assert.equal(sheet.at("B22"), BLANK_FORM.B22);
  assert.equal(sheet.at("C38"), "PP");
});

test("a form missing a heading reports it instead of writing somewhere else", () => {
  const withoutDetail = { ...BLANK_FORM };
  delete withoutDetail.C9;
  const sheet = makeFormSheet(withoutDetail);
  const result = fill(sheet, APPROVED_ROW);
  assert.deepEqual(result.missing, ["detail"]);
  assert.equal(sheet.at("C9"), undefined);
  assert.equal(sheet.at("H9"), undefined);
  assert.equal(sheet.at("C10"), undefined);
});

// ฟอร์มใช้ป้าย "ธุรการ FT" แต่ชีตข้อมูลเก็บรหัสแผนกเป็น "FT" (modules/module-mg.js) — เคยทำให้ช่องนี้ไม่ถูกติ๊ก
test("a request copied to FT ticks the form's 'ธุรการ FT' box, and only then", () => {
  const copiedToFt = rowWith(APPROVED_ROW, { "สำเนาถึงแผนก": "FT, IT" });
  const sheet = makeFormSheet(BLANK_FORM);
  fill(sheet, copiedToFt);
  assert.equal(sheet.at("O40"), "☑ ธุรการ FT", "the label on the form is unchanged");
  assert.equal(sheet.at("U40"), "☑ IT");
  assert.equal(sheet.at("C40"), "☐ MS");

  // APPROVED_ROW สำเนาถึง IT, ST เท่านั้น — ช่อง FT ต้องไม่ถูกติ๊กลอยๆ
  fill(sheet, APPROVED_ROW);
  assert.equal(sheet.at("O40"), "☐ ธุรการ FT");

  api.ffWrite_(sheet, null);
  assert.equal(sheet.at("O40"), "ธุรการ FT", "clearing restores the blank label");

  const boxed = makeFormSheet(BLANK_FORM, CHECKBOXES);
  fill(boxed, copiedToFt);
  assert.equal(boxed.at("N40"), true, "the real checkbox beside 'ธุรการ FT'");
  assert.equal(boxed.at("O40"), "ธุรการ FT");
});

test("every department box on the form maps to a code in the web app's copy-to grid, and vice versa", () => {
  const grid = plain(vm.runInNewContext(`(${/const CC_DEPARTMENT_GRID = (\[[\s\S]*?\n  \]);/.exec(moduleSource)[1]})`));
  const webCodes = grid.flat().filter((code) => code !== null).sort();
  const { FF_CC_CODES, FF_CC_LABEL_TO_CODE } = plain(vm.runInContext("({ FF_CC_CODES, FF_CC_LABEL_TO_CODE })", context));
  const formCodes = FF_CC_CODES.map((label) => FF_CC_LABEL_TO_CODE[label] ?? label).sort();
  assert.equal(webCodes.length, 23, "the grid was parsed");
  assert.deepEqual(formCodes, webCodes, "a form label that differs from the stored code needs an entry in FF_CC_LABEL_TO_CODE");
});
