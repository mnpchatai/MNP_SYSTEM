import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดไฟล์หน้าจอใบงานผลิต (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
// ตรวจ HTML ที่วาด ปุ่มที่โผล่ตามสถานะ/แผนก การเรียก RPC และข้อความผิดพลาด (ไม่มี DOM จริง การตรวจเต็มรูปแบบทำกับ app.js ใน browser)
const FILES = [
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/module-factory-master.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";

const item = (id, code, type, procurement, stock = 0, unit = "KG") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, status: "active", unit_code: unit, brand: "MNP", stock });
const step = (sequence, name, center, status = "pending", extra = {}) => ({ sequence, name, work_center_code: center, department_code: center === "QC" ? "QA" : center, instruction: "", setup_minutes: 0, run_minutes: 0, status, note: "", completed_at: null, completed_by_name: null, ...extra });
const job = (id, code, status, steps, extra = {}) => ({
  id, code, status, version: 6, production_order_id: "wo-rel", production_code: "TEST-MO-26-001", order_item_code: "FG-1",
  item_id: "rbl", item_code: "WIP-RBL", item_name: "ยางเส้นยาว", unit_code: "KG", qty: 100, output_qty: null, bom_id: "b-rbl", bom_revision: "A",
  routing_id: "r-rbl", routing_revision: "A", warehouse_code: "SR", warehouse_name: "คลังยางเส้นยาว (SR)", note: "", cancel_note: "",
  created_at: "2026-10-07T01:00:00Z", started_at: null, completed_at: null, cancelled_at: null, created_by_name: "ทดสอบ พนักงานวางแผน", cancelled_by_name: null, steps, ...extra,
});
const wo = (id, code, status, extra = {}) => ({
  id, code, item_id: "fg", item_code: "FG-1", name: "สินค้า 1", unit_code: "SET", bom_id: "b-fg", routing_id: "r-fg", planned_qty: 12, completed_qty: 0,
  status, due_date: "2026-11-01", customer: "", note: "", survey_note: "", return_note: "", work_order_no: status === "draft" ? null : "TEST-WO-26-001", version: 5, ...extra,
});
const RBL_STEPS = () => [step(10, "RB-01 ชั่งเคมี", "RB"), step(20, "RB-02 ตียาง", "RB"), step(30, "SR-01 รับเข้าคลัง", "SR"), step(40, "QC-01 ตรวจขนาด", "QC")];
const FIXTURE = {
  items: [
    item("fg", "FG-1", "FG", "make", 0, "SET"), item("rbp", "WIP-RBP", "WIP", "make", 0, "PCS"), item("rbl", "WIP-RBL", "WIP", "make", 0),
    item("nr", "RM-NR", "RM", "buy", 10), item("glue", "RM-GLUE", "RM", "buy", 60),
  ],
  boms: [
    { id: "b-fg", item_id: "fg", code: "FG-1", name: "สินค้า 1", unit_code: "SET", revision: "A", output_qty: 12, status: "approved" },
    { id: "b-rbp", item_id: "rbp", code: "WIP-RBP", name: "ชิ้นงาน", unit_code: "PCS", revision: "A", output_qty: 100, status: "approved" },
    { id: "b-rbl", item_id: "rbl", code: "WIP-RBL", name: "ยางเส้นยาว", unit_code: "KG", revision: "A", output_qty: 100, status: "approved" },
  ],
  bom_lines: [
    { id: "l1", bom_id: "b-fg", line_no: 1, component_id: "rbp", code: "WIP-RBP", name: "ชิ้นงาน", unit_code: "PCS", quantity: 12, scrap_percent: 0 },
    { id: "l2", bom_id: "b-rbp", line_no: 1, component_id: "rbl", code: "WIP-RBL", name: "ยางเส้นยาว", unit_code: "KG", quantity: 5, scrap_percent: 3 },
    { id: "l3", bom_id: "b-rbp", line_no: 2, component_id: "glue", code: "RM-GLUE", name: "กาว", unit_code: "KG", quantity: 0.25, scrap_percent: 0 },
    { id: "l4", bom_id: "b-rbl", line_no: 1, component_id: "nr", code: "RM-NR", name: "ยาง", unit_code: "KG", quantity: 62, scrap_percent: 2 },
  ],
  routings: [{ id: "r-fg", item_id: "fg", code: "FG-1", revision: "A", status: "draft" }, { id: "r-rbl", item_id: "rbl", code: "WIP-RBL", revision: "A", status: "draft" }],
  steps: [{ routing_id: "r-rbl", sequence: 10, name: "RB-01 ชั่งเคมี" }, { routing_id: "r-rbl", sequence: 20, name: "SR-01 รับเข้าคลัง" }],
  warehouses: [{ id: "w1", code: "RM", name: "คลังวัตถุดิบ" }, { id: "w2", code: "SR", name: "คลังยางเส้นยาว (SR)" }, { id: "w3", code: "WIP", name: "คลังระหว่างผลิต" }, { id: "w4", code: "FG", name: "คลังสินค้าสำเร็จรูป" }],
  production: [wo("wo-rel", "TEST-MO-26-001", "released"), wo("wo-draft", "TEST-MO-26-002", "draft"), wo("wo-done", "TEST-MO-26-003", "completed", { completed_qty: 12 })],
  production_history: [],
  material_orders: [],
  jobs: [
    job("j-open", "TEST-JB-26-001", "open", RBL_STEPS(), { note: `หมายเหตุ ${XSS}` }),
    job("j-run", "TEST-JB-26-002", "in_progress", [step(10, "RB-01 ชั่งเคมี", "RB", "done", { note: `ชั่งแล้ว ${XSS}`, completed_by_name: "ทดสอบ พนักงาน RB", completed_at: "2026-10-07T02:00:00Z" }), step(20, "RB-02 ตียาง", "RB"), step(30, "SR-01 รับเข้าคลัง", "SR"), step(40, "QC-01 ตรวจขนาด", "QC")], { started_at: "2026-10-07T02:00:00Z" }),
    job("j-last", "TEST-JB-26-003", "in_progress", [step(10, "RB-01", "RB", "done", { completed_at: "2026-10-07T02:00:00Z" }), step(20, "QC-01 ตรวจขนาด", "QC")], { item_id: "rbl" }),
    job("j-done", "TEST-JB-26-004", "completed", [step(10, "RB-01", "RB", "done", { completed_at: "2026-10-07T02:00:00Z" })], { output_qty: 95, completed_at: "2026-10-07T03:00:00Z" }),
    job("j-can", "TEST-JB-26-005", "cancelled", RBL_STEPS(), { cancel_note: `ผิดใบ ${XSS}`, returned: [{ code: "RM-NR", name: "ยาง", unit_code: "KG", quantity: 63.24 }] }),
  ],
  ncr_defect_types: [{ code: "DIM", name_th: "ขนาดไม่ได้สเปค" }, { code: "SURF", name_th: "ผิวไม่สมบูรณ์" }],
  job_inspections: [
    { id: "i1", job_id: "j-last", step_sequence: 20, result: "fail", qty_checked: 100, qty_defect: 8, measurement: `วัด 24.1 ${XSS}`, defect_type_code: "DIM", defect_type_name: "ขนาดไม่ได้สเปค",
      description: `เกินเกณฑ์ ${XSS}`, ncr_id: "ncr-1", ncr_no: "TEST-QA001/26", inspected_at: "2026-10-07T04:00:00Z", inspected_by_name: "ทดสอบ พนักงาน QA" },
  ],
  job_history: [
    { id: 2, job_id: "j-can", code: "TEST-JB-26-005", action: "cancel", version: 2, status_after: "cancelled", step_sequence: null, note: `เหตุผล ${XSS}`, changed_by_name: "ทดสอบ พนักงานวางแผน", created_at: "2026-10-07T04:00:00Z" },
    { id: 1, job_id: "j-can", code: "TEST-JB-26-005", action: "create", version: 1, status_after: "open", step_sequence: null, note: "", changed_by_name: "ทดสอบ พนักงานวางแผน", created_at: "2026-10-07T01:00:00Z" },
  ],
};

function loadFactory({ data = FIXTURE, dept = "RB", rpc, confirmAnswer = true } = {}) {
  const calls = [];
  const toasts = [];
  const log = { calls, toasts, renders: 0, hash: "" };
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: (message, kind) => toasts.push([message, kind ?? "ok"]),
    friendlyError: (error) => context.MNP_FACTORY_ERRORS[Object.keys(context.MNP_FACTORY_ERRORS).find((key) => String(error?.message ?? error).includes(key))] ?? String(error?.message ?? error),
    setFormBusy: () => {},
    renderRoute: async () => { log.renders += 1; },
    confirm: () => confirmAnswer,
    CSS: { escape: (value) => value },
    URLSearchParams,
    Intl,
    Date,
    state: { employee: { department: dept ? { code: dept } : null } },
    location: { set hash(value) { log.hash = value; }, get hash() { return log.hash; } },
    FormData: class { constructor(form) { this.values = form.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    sb: { rpc: async (name, args) => { calls.push([name, args]); return rpc ? rpc(name, args) : { data: name === "app_factory_master_data" ? data : { id: "new", version: 1, code: "TEST-JB-26-009" }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

async function render(view, { query = "", department, ...options } = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const controls = {};
  const make = () => ({ disabled: false, hidden: false, textContent: "", handlers: {}, dataset: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, reportValidity: () => true, querySelector() { return { value: "เหตุผลทดสอบ" }; }, scrollIntoView() {} });
  const root = { querySelector: (selector) => (controls[selector] ??= make()), querySelectorAll: () => [] };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS[view]({ params: new URLSearchParams(query), frame, department });
  return { ...painted, controls, log, context };
}
// ค่าที่สร้างใน vm context ต่าง prototype กับของ test จึงแปลงเป็น JSON ธรรมดาก่อนเทียบด้วย deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every error code the job migration can raise has a Thai message that is not hidden by another key", () => {
  const sql = ["20261007050000_factory_job_workflow.sql", "20261007060000_factory_cancel_and_return.sql", "20261007070000_factory_qc_ncr.sql"]
    .map((file) => fs.readFileSync(`supabase/migrations/${file}`, "utf8")).join("\n");
  const codes = [...new Set([...sql.matchAll(/raise exception '((?:INVALID_)?JOB_[A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(codes.length >= 19, `found ${codes.length} codes`);
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  for (const code of codes) assert.ok(messages[code], `${code} has no message`);
  const keys = Object.keys(messages);
  for (const key of keys) assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
});

test("the job views and the department view are registered and every menu view of the job folder is drawable", () => {
  const { context } = loadFactory();
  for (const name of ["job-queue", "job-new", "job", "department"]) assert.equal(typeof context.MNP_FACTORY_VIEWS[name], "function", name);
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "job");
  assert.deepEqual(plain(folder.entries.map((entry) => entry.view)), ["job-queue", "job-new", "job"]);
  for (const entry of folder.entries) assert.equal(typeof context.MNP_FACTORY_VIEWS[entry.view], "function", entry.key);
});

test("the list shows every job with progress and status, escapes text and filters by status", async () => {
  const all = await render("job");
  for (const code of ["TEST-JB-26-001", "TEST-JB-26-002", "TEST-JB-26-004", "TEST-JB-26-005"]) assert.match(all.body, new RegExp(code));
  assert.match(all.body, /ออกใบงานแล้ว รอเริ่ม \(1\)/);
  assert.match(all.body, /กำลังผลิต \(2\)/);
  assert.match(all.body, /1\/4 ขั้น/);
  assert.match(all.actions, /ออกใบงานผลิต/);
  const running = await render("job", { query: "status=in_progress" });
  assert.match(running.body, /TEST-JB-26-002/);
  assert.doesNotMatch(running.body, /TEST-JB-26-001/);
  const unknown = await render("job", { query: "status=bogus" });
  assert.match(unknown.body, /TEST-JB-26-001/, "an unknown filter falls back to all");
  const empty = await render("job", { data: { ...FIXTURE, jobs: [] } });
  assert.match(empty.body, /ยังไม่มีใบงานผลิตในโหมดทดสอบ/);
});

test("a job that has not started shows the materials it will take, with the shortage, and the first-step warning", async () => {
  const { body } = await render("job", { query: "jb=j-open", dept: "RB" });
  assert.match(body, /วัตถุดิบที่จะตัดเมื่อทำขั้นแรกเสร็จ \(BOM Rev\. A\)/);
  assert.match(body, /<strong>RM-NR<\/strong>/);
  assert.match(body, /63\.24/, "62 × 100 ÷ 100 × 1.02");
  assert.match(body, /ขาด 53\.24/, "10 kg in stock");
  assert.match(body, /ยอดคงคลังไม่พอสำหรับบางรายการ/);
  assert.match(body, /ขั้นแรก: เมื่อกดเสร็จ ระบบตัดวัตถุดิบ/);
  assert.match(body, /id="jb-step-form"/);
  assert.match(body, /ทำขั้นตอนนี้เสร็จ/);
  assert.doesNotMatch(body, /<script>/, "the note is escaped");
  const running = await render("job", { query: "jb=j-run", dept: "RB" });
  assert.doesNotMatch(running.body, /วัตถุดิบที่จะตัด/, "materials were already issued");
  assert.match(running.body, /ชั่งแล้ว &lt;script&gt;/);
  assert.doesNotMatch(running.body, /<script>/);
});

test("only the department that owns the next step gets the form; others are told whose turn it is", async () => {
  const sr = await render("job", { query: "jb=j-run", dept: "SR" });
  assert.doesNotMatch(sr.body, /id="jb-step-form"/, "RB-02 is next, not SR-01");
  assert.match(text(sr.body), /ขั้นถัดไป “RB-02 ตียาง” เป็นของแผนก RB/);
  const rb = await render("job", { query: "jb=j-run", dept: "RB" });
  assert.match(rb.body, /id="jb-step-form"/);
  assert.match(rb.body, /<h3>RB-02 ตียาง<\/h3>/);
  assert.doesNotMatch(rb.body, /ขั้นแรก: เมื่อกดเสร็จ|id="jb-output"/, "neither the first nor the last step");
  const pp = await render("job", { query: "jb=j-run", dept: "PP" });
  assert.doesNotMatch(pp.body, /id="jb-step-form"/, "planning does not run production steps");
  assert.match(pp.body, /id="jb-cancel-form"/, "but planning can cancel a running job");
  assert.match(text(pp.body), /ระบบคืนวัตถุดิบที่ตัดไปกลับเข้าคลังและล็อตเดิมทั้งหมด/, "and is told the materials are returned");
  assert.match(text(pp.body), /เป็นของแผนก RB/);
  assert.doesNotMatch(rb.body, /id="jb-cancel-form"/, "the production line cannot cancel");
});

test("the QC step is run by the QA department through the inspection form, not the plain step button", async () => {
  const qa = await render("job", { query: "jb=j-last", dept: "QA" });
  assert.match(qa.body, /id="jb-qc-form"/);
  assert.doesNotMatch(qa.body, /id="jb-step-form"/, "the plain step form is not offered for a QC step");
  assert.match(qa.body, /id="jb-output"/, "the last step still asks for the real output");
  assert.match(qa.body, /placeholder="100"/);
  assert.match(qa.body, /ระบบรับผลผลิตเข้าคลัง คลังยางเส้นยาว \(SR\)/);
  assert.match(qa.body, /\(แผนก QA\)/, "the QC work center shows its department");
  assert.match(qa.body, /name="result" value="pass" checked/);
  assert.match(qa.body, /name="result" value="fail"/);
  assert.match(qa.body, /<option value="DIM">ขนาดไม่ได้สเปค<\/option>/, "the NCR defect types are offered");
  assert.match(qa.body, /id="jb-qc-fail-fields" hidden/, "the failure fields stay hidden until the result is a failure");
  assert.match(qa.body, /name="qty_checked"[^>]*value="100"/, "the checked quantity starts from the job quantity");
  for (const dept of ["RB", "PP", "SR"]) {
    const other = await render("job", { query: "jb=j-last", dept });
    assert.doesNotMatch(other.body, /id="jb-qc-form"|id="jb-step-form"/, dept);
    assert.match(text(other.body), /เป็นของแผนก QA/, dept);
  }
});

test("a failed inspection is shown to everyone: the waiting notice, the table and the NCR link, all escaped", async () => {
  for (const dept of ["QA", "RB", "PP"]) {
    const view = await render("job", { query: "jb=j-last", dept });
    assert.match(text(view.body), /ตรวจ QC ไม่ผ่านล่าสุด \(8 จาก 100 KG\) ออก NCR TEST-QA001\/26 แล้ว — ขั้น QC รอตรวจซ้ำ/, dept);
    assert.match(view.body, /href="#\/ncr\?id=ncr-1">TEST-QA001\/26<\/a>/, `${dept}: the NCR is one click away`);
    assert.match(view.body, /<h3>ผลตรวจ QC<\/h3>/);
    assert.match(view.body, /ขนาดไม่ได้สเปค: เกินเกณฑ์ &lt;script&gt;/);
    assert.doesNotMatch(view.body, /<script>/);
  }
  const clean = await render("job", { query: "jb=j-run", dept: "QA" });
  assert.doesNotMatch(text(clean.body), /รอตรวจซ้ำ/);
  assert.doesNotMatch(clean.body, /ผลตรวจ QC/, "a job without inspections has no table");
});

test("finished and cancelled jobs offer nothing; the notices say what happened to the stock", async () => {
  const done = await render("job", { query: "jb=j-done", dept: "RB" });
  assert.doesNotMatch(done.body, /id="jb-step-form"|id="jb-cancel-form"/);
  assert.match(text(done.body), /ผลิตเสร็จ รับเข้าคลัง คลังยางเส้นยาว \(SR\) แล้ว 95 KG/);
  const cancelled = await render("job", { query: "jb=j-can", dept: "PP" });
  assert.doesNotMatch(cancelled.body, /id="jb-step-form"|id="jb-cancel-form"/);
  assert.match(cancelled.body, /ยกเลิกแล้ว เหตุผล: “ผิดใบ &lt;script&gt;/);
  assert.match(text(cancelled.body), /คืนวัตถุดิบเข้าคลังแล้ว: RM-NR 63\.24 KG/, "the notice lists what went back to stock");
  assert.match(cancelled.body, /เหตุผล &lt;script&gt;/, "the history reason is escaped");
  assert.doesNotMatch(cancelled.body, /<script>/);
});

test("planning can cancel a job that has not started", async () => {
  const { body } = await render("job", { query: "jb=j-open", dept: "PP" });
  assert.match(body, /id="jb-cancel-form"/);
  assert.doesNotMatch(body, /id="jb-step-form"/);
  assert.match(text(body), /ขั้นถัดไป “RB-01 ชั่งเคมี” เป็นของแผนก RB/);
});

test("an unknown job id says it was not found", async () => {
  const { body } = await render("job", { query: "jb=ghost" });
  assert.match(body, /ไม่พบใบงานนี้/);
});

test("the department queue lists the jobs that reached the department and the ones still coming", async () => {
  const rb = await render("job-queue", { dept: "RB" });
  assert.match(rb.body, /ถึงคิวแผนก RB <span class="muted small">\(2\)<\/span>/, "j-open (RB-01) and j-run (RB-02)");
  assert.match(rb.body, /TEST-JB-26-001/);
  assert.doesNotMatch(rb.body, /TEST-JB-26-004|TEST-JB-26-005/, "finished and cancelled jobs are not in any queue");
  const sr = await render("job-queue", { dept: "SR" });
  assert.match(sr.body, /ถึงคิวแผนก SR <span class="muted small">\(0\)<\/span>/);
  assert.match(sr.body, /กำลังจะมาถึง <span class="muted small">\(2\)<\/span>/);
  const qa = await render("job-queue", { dept: "QA" });
  assert.match(qa.body, /ถึงคิวแผนก QA <span class="muted small">\(1\)<\/span>/, "the last step of j-last");
  const none = await render("job-queue", { dept: null });
  assert.match(none.body, /ไม่พบแผนกของผู้ใช้ปัจจุบัน/);
});

test("a department page shows its queue, and the planning page adds the shortcuts", async () => {
  const rb = await render("department", { dept: "RB", department: { code: "RB", name: "ขึ้นรูปยาง" } });
  assert.match(rb.body, /ถึงคิวแผนก RB/);
  assert.doesNotMatch(rb.body, /งานของฝ่ายวางแผน/);
  const pp = await render("department", { dept: "PP", department: { code: "PP", name: "วางแผนการผลิต" } });
  assert.match(pp.body, /งานของฝ่ายวางแผน/);
  assert.match(pp.body, /href="#\/factory\?item=production-planning"/);
  assert.match(pp.body, /href="#\/factory\?item=job-new"/);
});

test("the new-job page first asks for a released production order that is not finished", async () => {
  const { body } = await render("job-new");
  assert.match(body, /เลือกใบสั่งผลิตที่ต้องการออกใบงาน/);
  assert.match(body, /TEST-MO-26-001/);
  assert.doesNotMatch(body, /TEST-MO-26-002|TEST-MO-26-003/, "a draft and a completed order are not offered");
  assert.match(body, /href="#\/factory\?item=job-new&amp;wo=wo-rel"/);
});

test("the form proposes the semi-finished items first and prefills the chosen one with its quantity and warehouse", async () => {
  const plain1 = await render("job-new", { query: "wo=wo-rel", dept: "PP" });
  assert.match(plain1.body, /id="jb-form"/);
  assert.match(plain1.body, /ชิ้นงานที่ควรออกใบงาน/);
  const rbpPos = plain1.body.indexOf("WIP-RBP");
  const fgPos = plain1.body.indexOf("สินค้าสำเร็จรูป (ประกอบที่ PK)");
  assert.ok(rbpPos > 0 && fgPos > rbpPos, "the finished good comes after the parts");
  assert.match(plain1.body, /href="#\/factory\?item=job-new&amp;wo=wo-rel&amp;part=rbp&amp;qty=12"/);
  assert.doesNotMatch(plain1.body, /สลับ “ทำหน้าที่เป็น”/);
  const strip = await render("job-new", { query: "wo=wo-rel&part=rbl&qty=0.618", dept: "PP" });
  assert.match(strip.body, /<option value="rbl" selected>/);
  assert.match(strip.body, /name="qty"[^>]*value="0.618"/);
  assert.match(strip.body, /<option value="SR" selected>/, "the long strip is received into SR");
  assert.match(strip.body, /วัตถุดิบที่จะตัด: RM-NR 0\.3908 KG/, "62 × 0.618 ÷ 100 × 1.02, and 10 kg in stock is enough");
  assert.doesNotMatch(strip.body, /\(ไม่พอ\)/);
  const fg = await render("job-new", { query: "wo=wo-rel&part=fg&qty=12", dept: "PP" });
  assert.match(fg.body, /<option value="FG" selected>/);
  const other = await render("job-new", { query: "wo=wo-rel", dept: "RB" });
  assert.match(other.body, /สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานวางแผน/);
});

test("a production order that is not released cannot get jobs, and a missing one says so", async () => {
  const draft = await render("job-new", { query: "wo=wo-draft" });
  assert.match(draft.body, /ออกใบงานได้เฉพาะใบสั่งผลิตที่ออกใบสั่งงานแล้ว/);
  assert.doesNotMatch(draft.body, /id="jb-form"/);
  const ghost = await render("job-new", { query: "wo=ghost" });
  assert.match(ghost.body, /ไม่พบใบสั่งผลิตนี้/);
});

test("the production order page lists its jobs and the items still to be issued", async () => {
  const { body } = await render("production", { query: "po=wo-rel", dept: "PP" });
  assert.match(body, /ใบงานผลิต \(ขั้น 4–8 สายผลิต\)/);
  assert.match(body, /ชิ้นงานที่ควรออกใบงาน/);
  assert.match(body, /href="#\/factory\?item=job-new&amp;wo=wo-rel&amp;part=rbp&amp;qty=12"/);
  assert.match(body, /TEST-JB-26-001/);
  const done = await render("production", { query: "po=wo-done", dept: "PP" });
  assert.match(done.body, /ใบงานผลิต \(ขั้น 4–8 สายผลิต\)/);
  assert.doesNotMatch(done.body, /ออกใบงานผลิต \(ฝ่ายวางแผน\)/, "a completed order cannot get more jobs");
  const draft = await render("production", { query: "po=wo-draft", dept: "PP" });
  assert.doesNotMatch(draft.body, /ใบงานผลิต \(ขั้น 4–8 สายผลิต\)/, "only orders with a work order show the job section");
});

test("running a step sends the job id, the version shown, the step and the note; the last step sends the real output", async () => {
  const mid = await render("job", { query: "jb=j-run", dept: "RB" });
  const form = mid.controls["#jb-step-form"];
  form.__values = { note: "ตีเสร็จ" };
  await form.handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(mid.log.calls.at(-1)), ["app_factory_complete_job_step", { p_id: "j-run", p_version: 6, p_sequence: 20, p_note: "ตีเสร็จ", p_output_qty: null }]);
  assert.equal(mid.log.renders, 1);
  assert.match(mid.log.toasts.at(-1)[0], /ทำขั้น “RB-02 ตียาง” เสร็จแล้ว/);
  const last = await render("job", { query: "jb=j-last", dept: "QA" });
  last.controls["#jb-step-form"].__values = { note: "", output_qty: "95.5" };
  await last.controls["#jb-step-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(last.log.calls.at(-1)), ["app_factory_complete_job_step", { p_id: "j-last", p_version: 6, p_sequence: 20, p_note: "", p_output_qty: 95.5 }]);
  assert.match(last.log.toasts.at(-1)[0], /ผลิตเสร็จ รับผลผลิตเข้าคลังแล้ว/);
  const blank = await render("job", { query: "jb=j-last", dept: "QA" });
  blank.controls["#jb-step-form"].__values = { note: "", output_qty: "" };
  await blank.controls["#jb-step-form"].handlers.submit({ preventDefault() {} });
  assert.equal(plain(blank.log.calls.at(-1))[1].p_output_qty, null, "a blank output means the job quantity");
});

test("a bad output quantity is refused on the page and nothing is sent", async () => {
  const view = await render("job", { query: "jb=j-last", dept: "QA" });
  view.controls["#jb-step-form"].__values = { note: "", output_qty: "0" };
  await view.controls["#jb-step-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!view.log.calls.some(([name]) => name === "app_factory_complete_job_step"));
  assert.match(view.controls["#jb-form-error"].textContent, /จำนวนผลิตจริง/);
  assert.equal(view.controls["#jb-form-error"].hidden, false);
});

test("cancel needs a confirmation and sends the reason; declining sends nothing", async () => {
  const sent = await render("job", { query: "jb=j-open", dept: "PP" });
  await sent.controls["#jb-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(sent.log.calls.at(-1)), ["app_factory_cancel_job", { p_id: "j-open", p_version: 6, p_note: "เหตุผลทดสอบ" }]);
  const declined = await render("job", { query: "jb=j-open", dept: "PP", confirmAnswer: false });
  await declined.controls["#jb-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!declined.log.calls.some(([name]) => name === "app_factory_cancel_job"));
});

test("cancelling a started job asks about the return of materials and reports how many lines went back", async () => {
  const messages = [];
  const started = await render("job", { query: "jb=j-run", dept: "PP", confirmAnswer: false });
  await started.controls["#jb-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!started.log.calls.some(([name]) => name === "app_factory_cancel_job"), "declining sends nothing");
  const view = await render("job", {
    query: "jb=j-run", dept: "PP",
    rpc: async (name) => ({ data: name === "app_factory_master_data" ? FIXTURE : { id: "j-run", version: 7, code: "TEST-JB-26-002", status: "cancelled", returned_lines: 6 }, error: null }),
  });
  await view.controls["#jb-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(view.log.calls.at(-1)), ["app_factory_cancel_job", { p_id: "j-run", p_version: 6, p_note: "เหตุผลทดสอบ" }]);
  messages.push(...view.log.toasts.map(([message]) => message));
  assert.ok(messages.some((message) => /ยกเลิก TEST-JB-26-002 แล้ว คืนวัตถุดิบเข้าคลัง 6 รายการ/.test(message)), messages.join("|"));
  const open = await render("job", { query: "jb=j-open", dept: "PP" });
  await open.controls["#jb-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.ok(open.log.toasts.some(([message]) => message === "ยกเลิก TEST-JB-26-001 แล้ว"), "an untouched job has nothing to return");
});

test("the QC form sends a pass, asks before a failure, and keeps a bad entry on the form", async () => {
  const pass = await render("job", { query: "jb=j-last", dept: "QA" });
  pass.controls["#jb-qc-form"].__values = { result: "pass", qty_checked: "100", measurement: "ตรวจแล้ว", output_qty: "95" };
  await pass.controls["#jb-qc-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(pass.log.calls.at(-1)), ["app_factory_record_qc", {
    p_id: "j-last", p_version: 6, p_sequence: 20, p_result: "pass", p_qty_checked: 100, p_qty_defect: 0, p_measurement: "ตรวจแล้ว",
    p_defect_type_code: null, p_description: "", p_output_qty: 95,
  }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(pass.log.toasts.some(([message]) => /TEST-JB-26-003 ผลิตเสร็จ รับผลผลิตเข้าคลังแล้ว/.test(message)), JSON.stringify(pass.log.toasts));

  const failing = { result: "fail", qty_checked: "100", qty_defect: "8", measurement: "", defect_type_code: "DIM", description: "ขนาดเกินเกณฑ์ 8 เส้นจาก 100" };
  const fail = await render("job", {
    query: "jb=j-last", dept: "QA",
    rpc: async (name) => ({ data: name === "app_factory_master_data" ? FIXTURE : { id: "j-last", version: 7, ncr_id: "ncr-2", ncr_no: "TEST-QA002/26" }, error: null }),
  });
  fail.controls["#jb-qc-form"].__values = failing;
  await fail.controls["#jb-qc-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(fail.log.calls.at(-1)), ["app_factory_record_qc", {
    p_id: "j-last", p_version: 6, p_sequence: 20, p_result: "fail", p_qty_checked: 100, p_qty_defect: 8, p_measurement: "",
    p_defect_type_code: "DIM", p_description: "ขนาดเกินเกณฑ์ 8 เส้นจาก 100", p_output_qty: null,
  }]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(fail.log.toasts.some(([message]) => message === "ตรวจ QC ไม่ผ่าน ออก NCR TEST-QA002/26 แล้ว ขั้นนี้รอตรวจซ้ำ"), JSON.stringify(fail.log.toasts));

  const declined = await render("job", { query: "jb=j-last", dept: "QA", confirmAnswer: false });
  declined.controls["#jb-qc-form"].__values = failing;
  await declined.controls["#jb-qc-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!declined.log.calls.some(([name]) => name === "app_factory_record_qc"), "declining the NCR sends nothing");

  const bad = await render("job", { query: "jb=j-last", dept: "QA" });
  bad.controls["#jb-qc-form"].__values = { ...failing, description: "สั้น" };
  await bad.controls["#jb-qc-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!bad.log.calls.some(([name]) => name === "app_factory_record_qc"), "an invalid entry is not sent");
  assert.match(bad.controls["#jb-form-error"].textContent, /10 ตัวอักษร/);
  assert.equal(bad.controls["#jb-form-error"].hidden, false);
});

test("a stale page is redrawn after a conflict, an ordinary error such as short stock keeps the form usable", async () => {
  const failing = (code) => async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: code } });
  const submit = async (code) => {
    const view = await render("job", { query: "jb=j-run", dept: "RB", rpc: failing(code) });
    view.controls["#jb-step-form"].__values = { note: "" };
    await view.controls["#jb-step-form"].handlers.submit({ preventDefault() {} });
    return view;
  };
  const conflict = await submit("JOB_VERSION_CONFLICT");
  assert.match(conflict.log.toasts.at(-1)[0], /ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว/);
  assert.equal(conflict.log.renders, 1);
  const twice = await submit("JOB_STEP_ALREADY_DONE");
  assert.match(twice.log.toasts.at(-1)[0], /ทำเสร็จไปแล้ว/);
  assert.equal(twice.log.renders, 1, "redrawn so the step is not tried again");
  const stock = await submit("JOB_INSUFFICIENT_STOCK");
  assert.match(stock.log.toasts.at(-1)[0], /ยังไม่ได้ตัดอะไร/);
  assert.equal(stock.log.toasts.at(-1)[1], "error");
  assert.equal(stock.log.renders, 0, "the page is still current, the user can retry after stock arrives");
  const wrong = await submit("JOB_STEP_DEPARTMENT_ONLY");
  assert.match(wrong.log.toasts.at(-1)[0], /เป็นของแผนกอื่น/);
  assert.equal(wrong.log.renders, 0);
});

// ฟอร์มออกใบงาน: ฝั่งหน้าเว็บตรวจก่อนส่ง แล้วสร้างและเปิดใบงาน
async function submitForm(values, rpc, dept = "PP") {
  const view = await render("job-new", { query: "wo=wo-rel", dept, rpc });
  const form = view.controls["#jb-form"];
  form.__values = values;
  await form.handlers.submit({ preventDefault() {} });
  return view;
}
const GOOD = { item_id: "rbl", qty: "6.18", warehouse_code: "sr", note: "ล็อตแรก" };

test("the form refuses bad values before calling the database", async () => {
  const view = await submitForm({ ...GOOD, qty: "0", item_id: "glue", warehouse_code: "NOPE" });
  assert.ok(!view.log.calls.some(([name]) => name === "app_factory_create_job"));
  const message = view.controls["#jb-form-error"].textContent;
  assert.match(message, /WIP หรือ FG/);
  assert.match(message, /จำนวนที่ผลิต/);
  assert.match(message, /เลือกคลัง/);
  assert.equal(view.controls["#jb-form-error"].hidden, false);
});

test("creating a job sends the production order and opens the new job", async () => {
  const view = await submitForm(GOOD);
  assert.deepEqual(plain(view.log.calls.find(([name]) => name === "app_factory_create_job")), ["app_factory_create_job",
    { p_production_order_id: "wo-rel", p_item_id: "rbl", p_qty: 6.18, p_warehouse_code: "SR", p_note: "ล็อตแรก" }]);
  assert.equal(view.log.hash, "/factory?item=job-view&jb=new");
  assert.match(view.log.toasts.at(-1)[0], /ออกใบงาน TEST-JB-26-009 แล้ว/);
});

test("a create error stays on the form with the message", async () => {
  const view = await submitForm(GOOD, async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "JOB_BOM_INVALID" } }), "RB");
  assert.match(view.controls["#jb-form-error"].textContent, /ยังไม่มี BOM ที่อนุมัติแล้ว/);
  assert.equal(view.controls["#jb-form-error"].hidden, false);
  assert.equal(view.log.hash, "");
});
