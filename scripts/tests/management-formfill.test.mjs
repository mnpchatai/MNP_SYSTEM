import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// FormFill.gs และ Code.gs อยู่ในโปรเจกต์ Apps Script เดียวกัน (global scope เดียวกัน) จึงโหลดทั้งคู่เข้า vm เดียว
// stub เฉพาะ Utilities — ฟังก์ชันที่ทดสอบอ่าน/เขียนผ่านชีตจำลองที่สร้างจากเลย์เอาต์ของฟอร์ม PP01-FM08
// สิ่งที่ยังต้องทดสอบด้วยมือบน Google จริง: เมนู "ใบคำร้อง", onEdit trigger, toast และเลย์เอาต์ merged cell จริง
const read = (name) => readFileSync(new URL(`../../apps-script/management-backup/${name}`, import.meta.url), "utf8");
const codeSource = read("Code.gs");
const formFillSource = read("FormFill.gs");

const Utilities = {
  formatDate(date, timeZone, pattern) {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date)
      .reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
    return { yyyy: parts.year, MM: parts.month, dd: parts.day }[pattern];
  },
};
const context = vm.createContext({ Utilities });
vm.runInContext(codeSource, context);
vm.runInContext(formFillSource, context);
const api = vm.runInContext("({ ffFindRecord_, ffWrite_, ffDate_ })", context);

/* ---------- ชีตจำลอง ---------- */

const parseA1 = (a1) => {
  const [, letters, row] = /^([A-Z]+)(\d+)$/.exec(a1);
  return { row: Number(row), col: [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) };
};
const ROWS = 45;
const COLS = 33;

function makeFormSheet(cells) {
  const store = new Map();
  const key = (row, col) => `${row}:${col}`;
  for (const [a1, value] of Object.entries(cells)) {
    const { row, col } = parseA1(a1);
    store.set(key(row, col), value);
  }
  const range = (row, col) => ({
    getRow: () => row,
    getColumn: () => col,
    setValue: (value) => store.set(key(row, col), String(value)),
    clearContent: () => store.delete(key(row, col)),
  });
  return {
    getName: () => "เอกสาร",
    getRange: (first, second) => {
      if (typeof first === "string") {
        const { row, col } = parseA1(first);
        return range(row, col);
      }
      return range(first, second);
    },
    getDataRange: () => ({
      getDisplayValues: () => Array.from({ length: ROWS }, (_, r) => Array.from({ length: COLS }, (_, c) => store.get(key(r + 1, c + 1)) ?? "")),
    }),
    at(a1) {
      const { row, col } = parseA1(a1);
      return store.get(key(row, col));
    },
    store,
  };
}

// เลย์เอาต์ย่อของฟอร์มเปล่า: ตำแหน่งเซลล์ตามไฟล์ฟอร์มจริง (AD = ช่องเลขที่/วันที่, ตารางสำเนาถึง 6 คอลัมน์ C/I/O/U/AA/AG)
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
  B38: "สำเนาถึง : ",
  C39: "PP", I39: "BD", O39: "QA", U39: "RB", AA39: "GR", AG39: "PK",
  C40: "PT", I40: "BG", O40: "SR", U40: "SE", AA40: "ST", AG40: "WH",
  C41: "MS", I41: "MT", O41: "ธุรการ FT", U41: "IT", AA41: "EX", AG41: "SA",
  C42: "PC", I42: "HR", O42: "AD", U42: "AC", AA42: "SP", AG42: "อื่นๆ",
};

const HEADER = ["เลขที่เอกสาร", "แผนก", "เรื่อง", "รายละเอียด", "สิ่งที่แนบมาด้วย", "ผู้ยื่นคำร้อง", "ตำแหน่ง", "ยื่นเมื่อ", "สถานะ", "มติ", "ความเห็น",
  "ผจก.โรงงาน อนุมัติโดย", "ผจก.โรงงาน เมื่อ", "ผจก.ทั่วไป อนุมัติโดย", "ผจก.ทั่วไป เมื่อ", "สำเนาถึงแผนก", "สำเนาอื่นๆ", "อัปเดตล่าสุด"];
const APPROVED_ROW = ["FT 004/26", "FT", "ขออนุมัติเปิด OT", "ทำงานเพิ่ม 4 ชม./วัน", "", "สมชาย ใจดี", "ผู้ช่วยผู้จัดการโรงงาน", "2026-10-09T03:20:11.140928+00:00",
  "DONE", "approved", "", "สมหญิง รักงาน", "2026-10-16T03:03:48.871964+00:00", "สมศักดิ์ มั่นคง", "2026-10-16T09:00:00+00:00", "IT, ST", "", "10/16/2026 10:00:00"];
const PENDING_ROW = ["FT 005/26", "FT", "ขอซื้อเครื่องพิมพ์", "ใบปะหน้า", "ใบเสนอราคา", "สมชาย ใจดี", "ผู้ช่วยผู้จัดการโรงงาน", "2026-10-16T01:48:26.87938+00:00",
  "PENDING_FM", "", "", "", "", "", "", "", "", "10/16/2026 08:48:00"];

function makeWorkbook(...rows) {
  const values = [HEADER, ...rows];
  const dataSheet = {
    getLastRow: () => values.length,
    getDataRange: () => ({ getValues: () => values }),
  };
  return { getSheetByName: (name) => (name === "ใบคำร้องถึงฝ่ายบริหาร" ? dataSheet : null) };
}

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
  const missing = api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(APPROVED_ROW), "FT 004/26"));
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), []);
  assert.equal(sheet.at("AD5"), "09 / 10 / 2026");
  assert.equal(sheet.at("C7"), "เรื่อง  ขออนุมัติเปิด OT");
  assert.equal(sheet.at("C8"), "สิ่งที่แนบมาด้วย  -");
  assert.equal(sheet.at("B22"), "ผู้ยื่นคำร้อง  สมชาย ใจดี");
  assert.equal(sheet.at("K22"), "แผนก/หน่วยงาน  FT");
  assert.equal(sheet.at("AC22"), "วันที่ยื่น  09 / 10 / 2026");
  assert.equal(sheet.at("L24"), "☑ อนุมัติ ดำเนินการตามคำร้อง");
  assert.equal(sheet.at("U24"), "☐ ไม่อนุมัติคำร้อง");
  assert.equal(sheet.at("AD24"), "☐ ได้รับทราบข้อมูลที่แจ้ง");
  assert.equal(sheet.at("B35"), "ลงชื่อ  สมหญิง รักงาน  ฝ่ายบริหารโรงงาน");
  assert.equal(sheet.at("B36").trim(), "16 / 10 / 2026");
  assert.ok(sheet.at("B36").startsWith(" "), "the date keeps the form's leading spaces so it stays centred");
  assert.equal(sheet.at("T35"), "ลงชื่อ  สมศักดิ์ มั่นคง  ผู้จัดการทั่วไป");
  assert.equal(sheet.at("T36").trim(), "16 / 10 / 2026");
  assert.equal(sheet.at("U41"), "☑ IT");
  assert.equal(sheet.at("AA40"), "☑ ST");
  assert.equal(sheet.at("C39"), "☐ PP");
  assert.equal(sheet.at("AG42"), "☐ อื่นๆ");
});

test("filling another request after an approved one leaves nothing stale, and an empty record restores the blank form", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(APPROVED_ROW, PENDING_ROW), "FT 004/26"));
  api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(APPROVED_ROW, PENDING_ROW), "FT 005/26"));
  assert.equal(sheet.at("C7"), "เรื่อง  ขอซื้อเครื่องพิมพ์");
  assert.equal(sheet.at("C8"), "สิ่งที่แนบมาด้วย  ใบเสนอราคา");
  assert.equal(sheet.at("L24"), "☐ อนุมัติ ดำเนินการตามคำร้อง", "no decision yet, so no box is ticked");
  assert.equal(sheet.at("B35"), BLANK_FORM.B35, "an unsigned step keeps the blank signature line");
  assert.equal(sheet.at("B36"), BLANK_FORM.B36);
  assert.equal(sheet.at("U41"), "☐ IT");

  api.ffWrite_(sheet, null);
  for (const [a1, blank] of Object.entries(BLANK_FORM)) {
    assert.equal(sheet.at(a1), blank, `${a1} goes back to the blank form`);
  }
});

test("request text can never be written as a formula", () => {
  const sheet = makeFormSheet(BLANK_FORM);
  const hostile = [...APPROVED_ROW];
  hostile[2] = '=HYPERLINK("https://example.com","x")';
  hostile[3] = "+1+1";
  hostile[10] = "@SUM(1)";
  api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(hostile), "FT 004/26"));
  for (const [key, value] of sheet.store) {
    assert.ok(!/^[=+\-@]/.test(String(value)), `${key} starts with a formula character: ${value}`);
  }
});

test("text a previous version wrote into the wrong rows is cleared, and the real form cells are not", () => {
  const sheet = makeFormSheet({ ...BLANK_FORM, A6: `${BLANK_FORM.A6} FT`, B11: "ผู้ยื่นคำร้อง  สมชาย ใจดี", C19: "☑ PP", T16: "ตำแหน่ง  เก่า" });
  api.ffWrite_(sheet, null);
  assert.equal(sheet.at("A6"), BLANK_FORM.A6);
  for (const a1 of ["B11", "C19", "T16"]) assert.equal(sheet.at(a1), undefined, `${a1} is cleared`);
  assert.equal(sheet.at("B22"), BLANK_FORM.B22);
  assert.equal(sheet.at("C39"), "PP");
});

test("a form missing a heading reports it instead of writing somewhere else", () => {
  const withoutDetail = { ...BLANK_FORM };
  delete withoutDetail.C9;
  const sheet = makeFormSheet(withoutDetail);
  const missing = api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(APPROVED_ROW), "FT 004/26"));
  assert.deepEqual(JSON.parse(JSON.stringify(missing)), ["detail"]);
  assert.equal(sheet.at("C9"), undefined);
});

// ช่อง "ธุรการ FT" ในฟอร์มใช้ป้ายนั้น แต่ชีตข้อมูลเก็บรหัสแผนกเป็น "FT" (modules/module-mg.js) จึงไม่เคยถูกติ๊ก
test("a request copied to FT ticks the FT box", { todo: "the form label is 'ธุรการ FT' but the data sheet stores 'FT', so the box is never ticked" }, () => {
  const copiedToFt = [...APPROVED_ROW];
  copiedToFt[15] = "FT, IT";
  const sheet = makeFormSheet(BLANK_FORM);
  api.ffWrite_(sheet, api.ffFindRecord_(makeWorkbook(copiedToFt), "FT 004/26"));
  assert.equal(sheet.at("O41"), "☑ ธุรการ FT");
});
