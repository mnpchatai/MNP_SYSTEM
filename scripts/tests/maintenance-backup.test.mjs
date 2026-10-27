import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
const require = createRequire(import.meta.url);
const formExport = require("../../modules/mt-form-export.js");

// Code.gs + FormFill.gs อยู่โปรเจกต์ Apps Script เดียวกัน (global scope เดียวกัน) จึงโหลดเข้า vm เดียว
// ชีตจำลองรองรับเฉพาะ API ที่สคริปต์ใช้ สิ่งที่ยังต้องทดสอบบน Google จริง: เมนู, onEdit trigger, toast, การพิมพ์
const read = (name) => readFileSync(new URL(`../../apps-script/maintenance-backup/${name}`, import.meta.url), "utf8");

const Utilities = {
  formatDate(date, timeZone) {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date).reduce((all, part) => ({ ...all, [part.type]: part.value }), {});
    return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
  },
};

const colOf = (letters) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function fakeSheet(name, rows = []) {
  const data = rows.map((row) => [...row]);
  const checkboxes = new Set();
  const range = (row, col, nr = 1, nc = 1) => ({
    getRow: () => row,
    getColumn: () => col,
    getLastRow: () => row + nr - 1,
    getLastColumn: () => col + nc - 1,
    getDataValidations: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => (
      checkboxes.has(`${row + i},${col + j}`) ? { getCriteriaType: () => "CHECKBOX" } : null))),
    setNumberFormat() { return this; },
    setFontWeight() { return this; },
    setValues(values) { values.forEach((line, i) => line.forEach((v, j) => { (data[row - 1 + i] ??= [])[col - 1 + j] = v; })); return this; },
    setValue(value) { (data[row - 1] ??= [])[col - 1] = value; return this; },
    getValue() { return data[row - 1]?.[col - 1] ?? ""; },
    getDataValidation() { return checkboxes.has(`${row},${col}`) ? { getCriteriaType: () => "CHECKBOX" } : null; },
    createTextFinder(text) {
      return { matchEntireCell() { return this; }, findNext() {
        for (let r = row; r < row + nr; r += 1) if (String(data[r - 1]?.[col - 1] ?? "").toLowerCase() === String(text).toLowerCase()) return { getRow: () => r };
        return null;
      } };
    },
  });
  const sheet = {
    data, checkboxes,
    getName: () => name,
    getLastRow: () => data.length,
    getRange(a, b, c, d) {
      if (typeof a === "string") {
        const [, l, r, l2, r2] = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a);
        const nr = r2 ? Number(r2) - Number(r) + 1 : 1;
        const nc = l2 ? colOf(l2) - colOf(l) + 1 : 1;
        return { ...range(Number(r), colOf(l), nr, nc), getSheet: () => sheet, getA1Notation: () => a };
      }
      return range(a, b, c, d);
    },
    getParent: () => spreadsheet,
    cell: (a1) => { const [, l, r] = /^([A-Z]+)(\d+)$/.exec(a1); return data[Number(r) - 1]?.[colOf(l) - 1]; },
  };
  return sheet;
}
let spreadsheet;
const toasts = [];
function freshSpreadsheet() {
  const sheets = {};
  spreadsheet = {
    sheets,
    getSheetByName: (name) => sheets[name] ?? null,
    insertSheet: (name) => (sheets[name] = fakeSheet(name)),
    toast: (message) => toasts.push(message),
  };
  return spreadsheet;
}
const SpreadsheetApp = { getActiveSpreadsheet: () => spreadsheet, DataValidationCriteria: { CHECKBOX: "CHECKBOX" } };
const LockService = { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) };
const ContentService = { createTextOutput: (text) => ({ text, setMimeType() { return this; } }), MimeType: { JSON: "json", TEXT: "text" } };
const context = vm.createContext({ Utilities, SpreadsheetApp, LockService, ContentService, console });
vm.runInContext(read("Code.gs"), context);
vm.runInContext(read("FormFill.gs"), context);
const gs = vm.runInContext("({ orderRow_, fmtDate_, ffSanitize_, doPost, onEdit, ORDER_HEADERS, FF_BLANK_CELLS })", context);
const plain = (value) => JSON.parse(JSON.stringify(value));

const order = (extra = {}) => ({
  id: "37b12ed2-3ca8-4471-a144-0f2991d7d841", docNumber: "GR062/26", department: "GR", machineCode: "ไม่มี", machineName: "ไม่มี",
  cause: "ชักโครกห้องน้ำเสีย", neededDate: "2026-09-05", requestedBy: "ประมวลขาวฉลาด", createdAt: "2026-09-03T00:58:00Z",
  status: "ASSIGNED", docType: "repair",
  approvals: {
    fm: { status: "approved", by: "นพรัตน์ ไชยเวช", at: "2026-09-03T03:06:00Z", note: "" },
    gm: { status: "approved", by: "รสริน เชน", at: "2026-09-03T05:05:00Z", note: "ด่วน" },
  },
  assignment: { technicians: ["ปิยะวัฒน์ ธิขาว"], startDate: "2026-09-04", endDate: "2026-09-07", assignedBy: "ยุทธไพศาล ดำจันทร์", assignedAt: "2026-09-03T07:09:00Z", executionPlan: "use_existing", receivedByName: "ยุทธไพศาล" },
  maintRecord: { causeAnalysis: "คันโยกชำรุด", inspectorOpinion: "buy_parts", parts: [{ name: "ปุ่มคันโยกชักโครก", qty: "1", unit: "ชิ้น", price: "118", shop: "ไทวัสดุ" }] },
  verification: { result: "pass", note: "", at: "2026-10-22T01:35:00Z" },
  verificationHistory: [], photoCount: 0,
  ...extra,
});

test("a synced order becomes one row in the same format as the sheet's existing rows", () => {
  const row = plain(gs.orderRow_(order()));
  assert.equal(row.length, gs.ORDER_HEADERS.length);
  const byHeader = Object.fromEntries(gs.ORDER_HEADERS.map((header, i) => [header, row[i]]));
  assert.equal(byHeader["วันที่ต้องการใช้งาน"], "05/09/69");
  assert.equal(byHeader["แจ้งเมื่อ"], "03/09/69 07:58");
  assert.equal(byHeader["สถานะ"], "รอดำเนินการ");
  assert.equal(byHeader["อนุมัติผจก.โรงงาน"], "อนุมัติ");
  assert.equal(byHeader["โดย/เมื่อ (ผจก.โรงงาน)"], "นพรัตน์ ไชยเวช / 03/09/69 10:06");
  assert.equal(byHeader["หมายเหตุ (ผจก.ทั่วไป)"], "ด่วน");
  assert.equal(byHeader["มอบหมายเมื่อ"], "03/09/69 14:09");
  assert.equal(byHeader["ประเภทเอกสาร"], "ใบแจ้งซ่อม");
  assert.equal(byHeader["การดำเนินงาน"], "ใช้อุปกรณ์ที่มีอยู่");
  assert.equal(byHeader["ความคิดเห็นของช่างผู้ตรวจสอบ"], "ซื้ออุปกรณ์มาทำเอง");
  assert.equal(byHeader["รายการอะไหล่/วัสดุที่ใช้"], "1. ปุ่มคันโยกชักโครก / จำนวน 1 ชิ้น / ราคา 118 บาท / ร้าน ไทวัสดุ");
  assert.equal(byHeader["ผลการตรวจสอบของผู้แจ้ง (ล่าสุด)"], "ผ่าน — ใช้งานได้ปกติ (22/10/69 08:35)");
  assert.equal(byHeader["รหัสอ้างอิงระบบ"], order().id);
});

test("a new order without assignment leaves the later columns empty and text never runs as a formula", () => {
  const row = plain(gs.orderRow_(order({ status: "PENDING_FM", approvals: {}, assignment: null, maintRecord: null, verification: null, cause: "=IMPORTRANGE(1)", machineName: "- ไม่มี" })));
  assert.equal(row[4], "'=IMPORTRANGE(1)");
  assert.equal(row[3], "- ไม่มี");
  assert.equal(row[8], "รออนุมัติ (ผจก.โรงงาน)");
  assert.deepEqual(row.slice(9, 20), ["", "", "", "", "", "", "", "", "", "", ""]);
});

test("the blank form in FormFill.gs is exactly the web module's blank form", () => {
  assert.deepEqual(plain(gs.FF_BLANK_CELLS), formExport.buildMtFormCells({ request: {} }).cells);
});

test("form cells from the sync are limited to the form's own cells and types", () => {
  const clean = plain(gs.ffSanitize_({ AG4: "GR062/26", G6: true, B6: "yes", ZZ99: "x", A1: "x" }));
  assert.equal(clean.AG4, "GR062/26");
  assert.equal(clean.G6, true);
  assert.equal(clean.B6, false);
  assert.equal("ZZ99" in clean, false);
  assert.equal("A1" in clean, false);
  assert.deepEqual(Object.keys(clean).sort(), Object.keys(gs.FF_BLANK_CELLS).sort());
});

test("sync then typing the document number in AG4 fills the form, and clearing it empties the form", () => {
  freshSpreadsheet();
  spreadsheet.sheets["เอกสาร"] = fakeSheet("เอกสาร");
  const form = spreadsheet.sheets["เอกสาร"];
  form.checkboxes.add("6,7"); // G6 เป็น checkbox จริงของแบบฟอร์ม
  const { cells } = formExport.buildMtFormCells({ request: { request_no: "GR062/26", doc_type: "repair", machine_name: "ไม่มี", needed_date: "2026-09-05" } });
  const value = JSON.stringify({ ...order(), formCells: cells });
  gs.doPost({ postData: { contents: JSON.stringify({ batch: [{ key: `order:${order().id}`, value }] }) } });
  assert.equal(spreadsheet.sheets["KV"].data[1][0], `order:${order().id}`);
  assert.equal(spreadsheet.sheets["ใบแจ้งซ่อม"].data[1][0], "GR062/26");

  // ซิงก์ซ้ำใบเดิมต้องทับแถวเดิม ไม่เพิ่มแถว
  gs.doPost({ postData: { contents: JSON.stringify({ batch: [{ key: `order:${order().id}`, value }] }) } });
  assert.equal(spreadsheet.sheets["ใบแจ้งซ่อม"].data.length, 2);
  assert.equal(spreadsheet.sheets["KV"].data.length, 2);

  form.getRange("AG4").setValue("gr062/26");
  gs.onEdit({ range: form.getRange("AG4") });
  assert.equal(form.cell("AG4"), "GR062/26");
  assert.equal(form.cell("G6"), true);
  assert.equal(form.cell("B6"), "☐");
  assert.equal(form.cell("P7"), "05/09/69");

  form.getRange("AG4").setValue("");
  gs.onEdit({ range: form.getRange("AG4") });
  assert.equal(form.cell("P7"), "");
  assert.equal(form.cell("G6"), false);

  // AG4 ในแบบฟอร์มจริงเป็นเซลล์รวม AG4:AJ4 — แก้แล้วได้ช่วงรวมก็ต้องเติม ส่วนแก้เซลล์อื่นไม่ต้องทำอะไร
  form.getRange("AG4").setValue("GR062/26");
  gs.onEdit({ range: form.getRange("AG4:AJ4") });
  assert.equal(form.cell("P7"), "05/09/69");
  form.getRange("P7").setValue("แก้มือ");
  gs.onEdit({ range: form.getRange("P7") });
  assert.equal(form.cell("P7"), "แก้มือ");
});

test("the web app only stores order:<uuid> items whose JSON id matches the key", () => {
  freshSpreadsheet();
  const id = order().id;
  const post = (batch) => gs.doPost({ postData: { contents: JSON.stringify({ batch }) } });
  post([
    { key: "config", value: "x" },
    { key: `order:${id}`, value: "{not json" },
    { key: "order:00000000-0000-0000-0000-000000000000", value: JSON.stringify(order()) },
    { key: `order:${id}`, value: JSON.stringify(order()) },
  ]);
  assert.deepEqual(spreadsheet.sheets["KV"].data.slice(1).map((row) => row[0]), [`order:${id}`]);
  assert.equal(spreadsheet.sheets["ใบแจ้งซ่อม"].data.length, 2);
});

test("an unknown number or an order synced before formCells existed shows a message and keeps the number", () => {
  freshSpreadsheet();
  spreadsheet.sheets["เอกสาร"] = fakeSheet("เอกสาร");
  const form = spreadsheet.sheets["เอกสาร"];
  gs.doPost({ postData: { contents: JSON.stringify({ batch: [{ key: `order:${order().id}`, value: JSON.stringify(order()) }] }) } });
  for (const [number, message] of [["XX999/26", /ไม่พบเลขที่เอกสาร/], ["GR062/26", /ยังไม่มีข้อมูลฟอร์ม/]]) {
    form.getRange("AG4").setValue(number);
    gs.onEdit({ range: form.getRange("AG4") });
    assert.equal(form.cell("AG4"), number);
    assert.match(toasts.at(-1), message);
  }
});

test("the Pilot sync sends the form cells with each order", () => {
  const source = readFileSync(new URL("../../modules/module-mt.js", import.meta.url), "utf8");
  assert.match(source, /formCells: formCells\?\.cells \?\? null/);
});
