import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ATTACHMENT_STUBS } from "./support/factory-attachment-stubs.mjs";

// โหลดหน้า RubberFlow ของแผนก RB (modules/module-factory-rb.js, script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริง
// ด้วยข้อมูล app_factory_master_data จำลอง ตรวจตัวเลขสรุป แถบสถานี การเลือกสถานีจาก URL ฟอร์มทำขั้นตอนในหน้าสถานี
// (ฟอร์มเดียวกับหน้าใบงาน รวมการยิง RPC) ใบที่ถูกกักกัน นาฬิกาพักยาง ใบที่ส่งต่อแล้ว และการ escape ข้อความจากฐานข้อมูล
const FILES = [
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/factory-rb-flow-model.js",
  "modules/module-factory-master.js",
  "modules/factory-attachments.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
  "modules/module-factory-rb.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";
const NOW = Date.now();
const HOUR = 3600000;

const step = (sequence, name, center = "RB", status = "pending", extra = {}) => ({ sequence, name, work_center_code: center, department_code: center === "QC" ? "QA" : center, instruction: "", setup_minutes: 0, run_minutes: 0, status, note: "", completed_at: null, completed_by_name: null, params: [], ...extra });
const job = (id, code, status, steps, extra = {}) => ({
  id, code, status, version: 3, production_order_id: "wo", production_code: "TEST-MO-26-001", order_item_code: "FG-1",
  item_id: "rbl", item_code: "WIP-RBL", item_name: `ยางเส้นยาว ${XSS}`, unit_code: "KG", qty: 100, output_qty: null, bom_id: "b", bom_revision: "A",
  routing_id: "r", routing_revision: "A", warehouse_code: "SR", warehouse_name: "คลังยางเส้นยาว (SR)", note: "", cancel_note: "", on_hold: false, hold_reason: null, held_at: null,
  created_at: "2026-10-07T01:00:00Z", started_at: null, completed_at: null, cancelled_at: null, created_by_name: "ทดสอบ", cancelled_by_name: null, steps, ...extra,
});
const line = (doneBelow = 0, extra = {}) => [
  step(10, "RB-01 ชั่งเคมี", "RB", doneBelow > 10 ? "done" : "pending", { completed_at: "2026-10-07T02:00:00Z" }),
  step(20, "RB-10 ฉีดยาง", "RB", doneBelow > 20 ? "done" : "pending", { completed_at: "2026-10-07T03:00:00Z", params: extra.params ?? [] }),
  step(30, "RB-11 อบยางด้วย Oven", "RB", doneBelow > 30 ? "done" : "pending"),
  step(40, "RB-13 ตัดยางเส้นยาว", "RB", doneBelow > 40 ? "done" : "pending"),
  step(50, "SR-01 รับเข้าคลัง", "SR", doneBelow > 50 ? "done" : "pending"),
];
const FIXTURE = {
  items: [], boms: [], bom_lines: [], routings: [], steps: [], warehouses: [{ id: "w", code: "SR", name: "คลังยางเส้นยาว (SR)" }], production: [], production_history: [], material_orders: [],
  jobs: [
    job("j-mix", "TEST-JB-26-001", "open", line()),
    job("j-rest", "TEST-JB-26-002", "in_progress", [step(10, "RB-03 ตียาง", "RB", "done", { completed_at: new Date(NOW - 3 * HOUR).toISOString() }), step(20, "RB-04 พักยาง 4 ชั่วโมง"), step(30, "RB-10 ฉีดยาง")], { started_at: "2026-10-07T02:00:00Z" }),
    job("j-form", "TEST-JB-26-003", "in_progress", line(20, { params: [{ code: "THICK", label: "ความหนา", unit: "mm", min: 1.9, max: 2.1 }] }), { started_at: "2026-10-07T02:00:00Z" }),
    job("j-held", "TEST-JB-26-004", "in_progress", line(30), { on_hold: true, hold_reason: `ความหนาหลุดสเปก ${XSS}`, held_at: "2026-10-07T04:00:00Z", started_at: "2026-10-07T02:00:00Z" }),
    job("j-handed", "TEST-JB-26-005", "in_progress", line(50), { started_at: "2026-10-07T02:00:00Z" }),
    job("j-done", "TEST-JB-26-006", "completed", line(60), { output_qty: 90, completed_at: "2026-10-08T02:00:00Z" }),
    job("j-gr", "TEST-JB-26-007", "open", [step(10, "GR-01 แปรรูป", "GR")]),
  ],
  ncr_defect_types: [{ code: "DIM", name_th: "ขนาดไม่ได้สเปค" }],
  job_inspections: [], job_readings: [], job_history: [],
};

function loadFactory({ data = FIXTURE, dept = "RB", confirmAnswer = true } = {}) {
  const calls = [];
  const toasts = [];
  const log = { calls, toasts, renders: 0 };
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    ...ATTACHMENT_STUBS,
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: (message, kind) => toasts.push([message, kind ?? "ok"]),
    friendlyError: (error) => String(error?.message ?? error),
    setFormBusy: () => {},
    renderRoute: async () => { log.renders += 1; },
    confirm: () => confirmAnswer,
    CSS: { escape: (value) => value },
    URLSearchParams, Intl, Date,
    state: { employee: { department: dept ? { code: dept } : null } },
    location: { hash: "" },
    FormData: class { constructor(form) { this.values = form.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    sb: { rpc: async (name, args) => { calls.push([name, args]); return { data: name === "app_factory_master_data" ? data : { held: false }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

async function render(query = "", options = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const controls = {};
  const make = () => ({ disabled: false, hidden: false, textContent: "", handlers: {}, dataset: {}, elements: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, reportValidity: () => true, querySelector() { return { value: "" }; }, scrollIntoView() {} });
  const root = { querySelector: (selector) => (controls[selector] ??= make()), querySelectorAll: () => [] };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS["department:RB"]({ params: new URLSearchParams(query), frame, department: { code: "RB", name: "ขึ้นรูปยาง" } });
  return { body: painted.body, controls, log, context };
}
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("the RB page is registered as the department's own view and reads only the master data", async () => {
  const { context } = loadFactory();
  assert.equal(typeof context.MNP_FACTORY_VIEWS["department:RB"], "function");
  assert.equal(typeof context.MNP_FACTORY_VIEWS.department, "function", "the generic queue stays for the other departments");
  const { body, log } = await render();
  assert.deepEqual(log.calls.map(([name]) => name), ["app_factory_master_data"]);
  assert.match(body, /RubberFlow · สายผลิตยาง 4 สถานี/);
  assert.doesNotMatch(body, /<script>/, "item names and hold reasons from the database are escaped");
  assert.match(body, /ยางเส้นยาว &lt;script&gt;/);
});

test("the summary and the station strip count the line once each, and the first station with work is selected", async () => {
  const { body } = await render();
  const summary = text(body.slice(0, body.indexOf("rbf-stations")));
  assert.match(summary, /ใบงานในสาย RB 4/, "mixing 2 + forming 1 + held at curing 1");
  assert.match(summary, /ถูกกักกัน รอ QA 1/);
  assert.match(summary, /ส่งต่อแผนกถัดไปแล้ว 1/);
  assert.match(summary, /เสร็จแล้ว 1 ผลิตจริง\/สั่ง 90%/);
  const stations = [...body.matchAll(/<a class="rbf-station([^"]*)" href="([^"]+)"/g)].map((match) => [match[1].trim(), match[2]]);
  assert.deepEqual(stations, [
    ["is-active has-work", "#/factory?dept=RB&amp;st=mixing"],
    ["has-work", "#/factory?dept=RB&amp;st=forming"],
    ["has-work", "#/factory?dept=RB&amp;st=curing"],
    ["", "#/factory?dept=RB&amp;st=finishing"],
  ]);
  assert.match(body, /aria-label="ถึงคิว 2 ใบ">2</, "mixing has two jobs");
  assert.match(body, /rbf-station-held">กักกัน 1</, "the held job shows on its station, not in the big count");
  assert.match(body, /<h2>สถานีที่ 1 · ผสมยาง <span class="muted small">\(2\)<\/span><\/h2>/);
  assert.match(body, /TEST-JB-26-001[\s\S]*TEST-JB-26-002/, "oldest first");
  assert.match(body, /href="#\/factory\?dept=RB&amp;st=mixing&amp;jb=j-mix"[^>]*>ทำขั้นตอน</, "the action opens the form on this page");
  assert.match(body, /⏱ พักอีก 1 ชม\. 0 นาที/, "the resting job shows its timer");
  assert.match(body, /title="ครบกำหนด d\([^)]*t\)"/);
});

test("the station in the URL is drawn, with the held job marked and without an action for it", async () => {
  const { body } = await render("st=curing");
  assert.match(body, /<h2>สถานีที่ 3 · อบ <span class="muted small">\(0\)<\/span><\/h2>/);
  assert.match(body, /TEST-JB-26-004/);
  assert.match(body, /<span class="badge cancelled">กักกัน รอ QA<\/span>/);
  assert.match(body, /ความหนาหลุดสเปก &lt;script&gt;/);
  assert.doesNotMatch(body, /jb=j-held"[^>]*>ทำขั้นตอน</, "a held job has no step to run");
  assert.match(body, /aria-current="page"[\s\S]*?<strong>อบ<\/strong>/);
  const empty = await render("st=finishing");
  assert.match(empty.body, /ไม่มีใบงานที่สถานีตัดและตกแต่ง/);
  const unknown = await render("st=nope");
  assert.match(unknown.body, /<h2>สถานีที่ 1 · ผสมยาง/, "an unknown station falls back to the first one with work");
});

test("opening a job on its station shows the job's own step form and submits through the same RPC as the job page", async () => {
  const { body, controls, log } = await render("st=forming&jb=j-form", { dept: "RB" });
  assert.match(body, /rbf-open/);
  assert.match(body, /<strong>RB-10 ฉีดยาง<\/strong> · WIP-RBL/);
  assert.match(body, /id="jb-step-form"/);
  assert.match(body, /data-reading="THICK"/, "the parameter inputs of the step are there");
  assert.match(body, /href="#\/factory\?item=job-view&amp;jb=j-form">เปิดใบงานเต็ม</);
  assert.match(body, /<tr class="is-open">[\s\S]*?TEST-JB-26-003[\s\S]*?>เปิดอยู่</, "the row of the open job is marked");
  const form = controls["#jb-step-form"];
  form.__values = { note: "ฉีดแล้ว", "reading:THICK": "2.0" };
  await form.handlers.submit({ preventDefault() {} });
  const [name, args] = log.calls.at(-1);
  assert.equal(name, "app_factory_complete_job_step_with_readings");
  assert.deepEqual(JSON.parse(JSON.stringify(args)), { p_id: "j-form", p_version: 3, p_sequence: 20, p_note: "ฉีดแล้ว", p_output_qty: null, p_readings: { THICK: 2 } });
  assert.equal(log.renders, 1, "the page is redrawn after the step, staying on the RB page");
});

test("another persona sees whose turn it is instead of the form, and a job elsewhere points to its station", async () => {
  const other = await render("st=forming&jb=j-form", { dept: "GR" });
  assert.doesNotMatch(other.body, /id="jb-step-form"/);
  assert.match(text(other.body), /ตอนนี้ทำหน้าที่เป็นแผนก GR/);
  assert.match(text(other.body), /เป็นของแผนก RB — สลับ “ทำหน้าที่เป็น”/);
  const elsewhere = await render("st=curing&jb=j-mix");
  assert.match(elsewhere.body, /TEST-JB-26-001 อยู่ที่สถานีผสมยาง — <a href="#\/factory\?dept=RB&amp;st=mixing&amp;jb=j-mix">ไปที่สถานีผสมยาง<\/a>/);
  assert.doesNotMatch(elsewhere.body, /id="jb-step-form"/);
  const handed = await render("jb=j-handed");
  assert.match(text(handed.body), /TEST-JB-26-005 อยู่ที่ขั้น “SR-01 รับเข้าคลัง” ของแผนก SR ไม่ได้อยู่ในสถานีของ RB ตอนนี้/);
  const finished = await render("jb=j-done");
  assert.match(text(finished.body), /TEST-JB-26-006 เสร็จแล้ว รับเข้าคลังแล้ว — ไม่มีขั้นให้ทำแล้ว/);
  const missing = await render("jb=nope");
  assert.match(missing.body, /ไม่พบใบงานนี้/);
});

test("jobs that left the line are listed with the step they wait at, and the tools link to BOM, routing and SPC", async () => {
  const { body } = await render();
  const handed = body.slice(body.indexOf("rbf-handed"));
  assert.match(handed, /ส่งต่อแผนกถัดไปแล้ว <span class="muted small">\(1\)<\/span>/);
  assert.match(handed, /TEST-JB-26-005[\s\S]*?SR-01 รับเข้าคลัง<br><span class="muted small">\(แผนก SR\)<\/span>/);
  assert.doesNotMatch(handed, /รอแผนกอื่นก่อน/, "nothing is waiting for another department");
  assert.doesNotMatch(body, /TEST-JB-26-007/, "a job without RB steps is not on this page");
  for (const key of ["structure-view", "routing-view", "quality-spc", "job-view"]) assert.match(body, new RegExp(`href="#/factory\\?item=${key}"`), key);
  const waiting = await render("", { data: { ...FIXTURE, jobs: [job("j-wait", "TEST-JB-26-008", "in_progress", [step(10, "RB-01 ชั่งเคมี", "RB", "done"), step(20, "QC-01 ตรวจขนาด", "QC"), step(30, "RB-13 ตัดยางเส้นยาว")])] } });
  assert.match(waiting.body, /รอแผนกอื่นก่อน แล้วกลับมาที่ RB <span class="muted small">\(1\)<\/span>/);
  assert.match(waiting.body, /ยังไม่มีใบงานที่ส่งต่อ/);
});
