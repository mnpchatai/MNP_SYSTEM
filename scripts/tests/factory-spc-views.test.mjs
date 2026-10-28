import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ATTACHMENT_STUBS } from "./support/factory-attachment-stubs.mjs";

// โหลดหน้า SPC / Cpk (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูล app_factory_master_data จำลอง
// ตรวจ HTML ที่วาด (ตัวเลข กราฟ ตารางค่าที่หลุดสเปก คำเตือนสเปก) การเลือกค่าที่ติดตามจาก URL/dropdown และว่าหน้านี้ไม่เขียนข้อมูล
const FILES = [
  "modules/lab-mooney-model.js",
  "modules/factory-departments.js",
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-job-model.js",
  "modules/factory-spc-model.js",
  "modules/module-factory-master.js",
  "modules/factory-attachments.js",
  "modules/module-factory-spc.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";

const job = (id, code, routing = "r1") => ({ id, code, routing_id: routing, routing_revision: 1, item_code: "RB-01", item_name: "ยางเส้น", steps: [{ sequence: 20, name: "ขึ้นรูป" }] });
const reading = (jobId, code, value, day, extra = {}) => ({ job_id: jobId, step_sequence: 20, code, label: code === "THICK" ? "ความหนา" : `อุณหภูมิ ${XSS}`, unit: code === "THICK" ? "mm" : "°C",
  value, min: code === "THICK" ? 1.9 : 90, max: code === "THICK" ? 2.1 : null, recorded_at: `2026-10-${day}T03:00:00Z`, recorded_by_name: `ผู้บันทึก ${XSS}`, ...extra });
const THICK = [2.0, 2.02, 1.98, 2.01, 2.25, 1.99];
const FIXTURE = {
  jobs: THICK.map((_, index) => job(`j${index}`, `TEST-JB-26-00${index}`)),
  steps: [{ routing_id: "r1", sequence: 20, name: "ขึ้นรูป", params: [
    { code: "THICK", label: "ความหนา", unit: "mm", min: 1.9, max: 2.1 },
    { code: "TEMP", label: `อุณหภูมิ ${XSS}`, unit: "°C", min: 95, max: null },
  ] }],
  job_readings: [
    ...THICK.map((value, index) => reading(`j${index}`, "THICK", value, String(10 + index))),
    reading("j0", "TEMP", 96, "10"),
    reading("j1", "TEMP", 97, "11"),
  ],
};

function loadFactory({ data = FIXTURE } = {}) {
  const calls = [];
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    ...ATTACHMENT_STUBS,
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: () => {},
    friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => {},
    location: { hash: "" },
    Intl, URLSearchParams,
    sb: { rpc: async (name, args) => { calls.push([name, args]); return { data, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, calls };
}

async function render(query = "", options = {}) {
  const { context, calls } = loadFactory(options);
  let painted = null;
  const select = { handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const root = { querySelector: (selector) => (selector === "form[data-spc-pick] select" ? select : null) };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS.spc({ params: new URLSearchParams(query), frame });
  return { body: painted.body, calls, context, select };
}
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the SPC view is registered and the quality folder of the menu is drawable", () => {
  const { context } = loadFactory();
  assert.equal(typeof context.MNP_FACTORY_VIEWS.spc, "function");
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "quality");
  assert.equal(folder.entries[0].view, "spc");
});

test("the first characteristic is drawn with its indices, charts and out-of-spec values, reading only the master data", async () => {
  const { body, calls } = await render();
  assert.deepEqual(calls.map(([name]) => name), ["app_factory_master_data"]);
  const words = text(body);
  assert.match(body, /<option value="r1:20:THICK" selected>RB-01 · 20 ขึ้นรูป · ความหนา \(mm\)<\/option>/);
  assert.match(words, /Cpk \S+ /);
  assert.match(words, /น้อยกว่า 25 ค่า ใช้ดูแนวโน้ม/);
  assert.match(words, /จำนวนค่า 6 นอกเส้นควบคุม \d+ · นอกสเปก 1/);
  assert.match(body, /<svg class="spc-chart" viewBox="0 0 720 \d+" role="img"/);
  assert.match(body, /USL 2\.1/);
  assert.match(body, /LSL 1\.9/);
  assert.match(body, /UCL /);
  assert.equal((body.match(/class="spc-pt is-/g) ?? []).length, 6);
  assert.match(body, /<g class="spc-pt is-oos"><title>TEST-JB-26-004 · d\(2026-10-14T03:00:00Z t\) · 2\.25 mm<\/title>/);
  assert.match(body, /class="spc-chart spc-hist"/);
  // ตารางค่าที่หลุดสเปก: ลิงก์ไปใบงาน และข้อความจากฐานข้อมูลถูก escape
  assert.match(body, /href="#\/factory\?item=job-view&amp;jb=j4"><strong>TEST-JB-26-004<\/strong>/);
  assert.ok(!body.includes(XSS));
  assert.ok(body.includes(escapeHtml(`ผู้บันทึก ${XSS}`)));
});

test("the characteristic in the URL is drawn, an unknown one falls back to the first, and the dropdown navigates", async () => {
  const temp = await render("ch=r1:20:TEMP");
  assert.match(temp.body, /<option value="r1:20:TEMP" selected>/);
  assert.ok(!temp.body.includes(XSS));
  assert.ok(temp.body.includes(escapeHtml(`อุณหภูมิ ${XSS}`)));
  // สเปกด้านเดียว: Cp คิดไม่ได้ ไม่มีเส้น USL
  assert.match(text(temp.body), /Cp \/ Ppk — \/ /);
  assert.ok(!temp.body.includes("USL"));
  assert.match(temp.body, /ไม่มีค่าที่หลุดสเปก/);

  const unknown = await render(`ch=${encodeURIComponent(XSS)}`);
  assert.match(unknown.body, /<option value="r1:20:THICK" selected>/);
  unknown.select.handlers.change({ target: { value: "r1:20:TEMP" } });
  assert.equal(unknown.context.location.hash, "/factory?item=quality-spc&ch=r1%3A20%3ATEMP");
});

test("spec notices appear only when the spec was edited after recording or the parameter was removed", async () => {
  const plain = await render();
  assert.ok(!plain.body.includes("fm-notice"));
  const edited = await render("", { data: { ...FIXTURE, steps: [{ ...FIXTURE.steps[0], params: [{ code: "THICK", label: "ความหนา", unit: "mm", min: 1.95, max: 2.1 }] }] } });
  assert.match(text(edited.body), /สเปกถูกแก้หลังบันทึกไปแล้ว 6 ค่า/);
  const removed = await render("", { data: { ...FIXTURE, steps: [] } });
  assert.match(text(removed.body), /พารามิเตอร์นี้ถูกลบออกจาก Routing แล้ว/);
});

test("a single value or identical values still draw without indices", async () => {
  const one = await render("", { data: { ...FIXTURE, job_readings: [FIXTURE.job_readings[0]] } });
  assert.match(text(one.body), /Cpk — ข้อมูลไม่พอ/);
  assert.equal((one.body.match(/class="spc-pt is-/g) ?? []).length, 1);
  assert.ok(!one.body.includes("NaN"));
  const flat = await render("", { data: { ...FIXTURE, job_readings: FIXTURE.job_readings.slice(0, 3).map((row) => ({ ...row, value: 2 })) } });
  assert.match(text(flat.body), /Cpk — ค่าทุกตัวเท่ากัน/);
  assert.ok(!flat.body.includes("NaN"));
});

test("without recorded values the page explains where values come from and links to the routing page", async () => {
  const { body } = await render("", { data: { jobs: [], steps: [], job_readings: [] } });
  assert.match(text(body), /ยังไม่มีค่าพารามิเตอร์ที่บันทึก/);
  assert.match(body, /href="#\/factory\?item=routing-view"/);
  assert.ok(!body.includes("<svg"));
});
