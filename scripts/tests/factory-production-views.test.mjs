import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดไฟล์หน้าจอใบสั่งผลิต (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
// ตรวจ HTML ที่วาด ปุ่มที่โผล่ตามสถานะ/แผนก การเรียก RPC และข้อความผิดพลาด (ไม่มี DOM จริง การตรวจเต็มรูปแบบทำกับ app.js ใน browser)
const FILES = [
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/module-factory-master.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const XSS = "<script>alert(1)</script>";

const item = (id, code, type, procurement, stock = 0, unit = "PCS", status = "active") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, status, unit_code: unit, brand: "MNP", stock });
const order = (id, code, status, extra = {}) => ({
  id, code, item_id: "fg1", item_code: "FG-1", name: "สินค้า 1", unit_code: "SET", bom_id: null, routing_id: null,
  planned_qty: 120, completed_qty: 0, status, due_date: "2026-11-01", customer: "", note: "", survey_note: "", return_note: "",
  work_order_no: null, version: 3, bom_revision: null, bom_status: null, routing_revision: null,
  created_at: "2026-10-07T01:00:00Z", submitted_at: null, received_at: null, planned_at: null, released_at: null,
  created_by_name: "ทดสอบ พนักงานขาย", submitted_by_name: null, received_by_name: null, planned_by_name: null, released_by_name: null, ...extra,
});
const FIXTURE = {
  items: [item("fg1", "FG-1", "FG", "make"), item("fg2", "FG-2", "FG", "make"), item("wip1", "WIP-1", "WIP", "make"), item("rm1", "RM-1", "RM", "buy", 5, "KG")],
  boms: [
    { id: "b1", item_id: "fg1", code: "FG-1", name: "สินค้า 1", unit_code: "SET", revision: "A", output_qty: 12, status: "approved", effective_date: "2026-10-01", version: 2 },
    { id: "b2", item_id: "fg2", code: "FG-2", name: "สินค้า 2", unit_code: "SET", revision: "A", output_qty: 12, status: "draft", effective_date: "2026-10-01", version: 1 },
  ],
  bom_lines: [{ id: "l1", bom_id: "b1", line_no: 1, component_id: "rm1", code: "RM-1", name: "วัตถุดิบ", unit_code: "KG", quantity: 3, scrap_percent: 0 }],
  routings: [
    { id: "r1", item_id: "fg1", code: "FG-1", name: "สินค้า 1", revision: "A", status: "draft" },
    { id: "r2", item_id: "fg1", code: "FG-1", name: "สินค้า 1", revision: "B", status: "approved" },
    { id: "r3", item_id: "fg1", code: "FG-1", name: "สินค้า 1", revision: "C", status: "obsolete" },
  ],
  production: [
    order("o-draft", "TEST-MO-26-001", "draft", { customer: XSS, note: `หมายเหตุ ${XSS}`, return_note: `ส่งกลับ ${XSS}` }),
    order("o-sub", "TEST-MO-26-002", "submitted", { submitted_at: "2026-10-07T02:00:00Z", submitted_by_name: "ทดสอบ พนักงานขาย" }),
    order("o-plan", "TEST-MO-26-003", "planning", { received_at: "2026-10-07T03:00:00Z", received_by_name: "ทดสอบ พนักงานวางแผน" }),
    order("o-planned", "TEST-MO-26-004", "planned", { bom_id: "b1", routing_id: "r2", bom_revision: "A", routing_revision: "B", survey_note: `ยางพอ ${XSS}`, planned_at: "2026-10-07T04:00:00Z", planned_by_name: "ทดสอบ พนักงานวางแผน" }),
    order("o-rel", "TEST-MO-26-005", "released", { bom_id: "b1", routing_id: "r2", work_order_no: "TEST-WO-26-001", released_at: "2026-10-07T05:00:00Z", released_by_name: "ทดสอบ พนักงานวางแผน" }),
    order("o-nobom", "TEST-MO-26-006", "planning", { item_id: "fg2", item_code: "FG-2", name: "สินค้า 2" }),
  ],
  production_history: [
    { id: 2, order_id: "o-draft", code: "TEST-MO-26-001", action: "return", version: 3, status_after: "draft", note: `เหตุผล ${XSS}`, changed_by_name: "ทดสอบ พนักงานวางแผน", created_at: "2026-10-07T03:00:00Z" },
    { id: 1, order_id: "o-draft", code: "TEST-MO-26-001", action: "create", version: 1, status_after: "draft", note: "", changed_by_name: "ทดสอบ พนักงานขาย", created_at: "2026-10-07T01:00:00Z" },
  ],
};

function loadFactory({ data = FIXTURE, dept = "PP", rpc, confirmAnswer = true } = {}) {
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
    state: { employee: { department: { code: dept } } },
    location: { set hash(value) { log.hash = value; }, get hash() { return log.hash; } },
    FormData: class { constructor(form) { this.values = form.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    sb: { rpc: async (name, args) => { calls.push([name, args]); return rpc ? rpc(name, args) : { data: name === "app_factory_master_data" ? data : { id: "new", version: 1, code: "TEST-MO-26-009" }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

// เรียก view แล้วคืน options ที่ส่งให้ frame.paint พร้อม fake root: เก็บ handler ของตัวควบคุมตาม selector
async function render(view, { query = "", ...options } = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const controls = {};
  const make = () => ({ disabled: false, hidden: false, textContent: "", handlers: {}, dataset: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, reportValidity: () => true, querySelector() { return { value: "เหตุผลทดสอบ" }; }, scrollIntoView() {} });
  const root = {
    querySelector: (selector) => (controls[selector] ??= make()),
    querySelectorAll: () => [],
  };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS[view]({ params: new URLSearchParams(query), frame });
  return { ...painted, controls, log, context };
}
// ค่าที่สร้างใน vm context ต่าง prototype กับของ test จึงแปลงเป็น JSON ธรรมดาก่อนเทียบด้วย deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every error code the workflow migration can raise has a Thai message that is not hidden by another key", () => {
  const sql = fs.readFileSync("supabase/migrations/20261007030000_factory_production_order_workflow.sql", "utf8");
  const codes = [...new Set([...sql.matchAll(/raise exception '((?:INVALID_)?PRODUCTION_[A-Z_]+)'/g)].map((match) => match[1]))];
  codes.push("PRODUCTION_SALES_ONLY", "PRODUCTION_PLANNING_ONLY");
  assert.ok(codes.length >= 17, `found ${codes.length} codes`);
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  for (const code of new Set(codes)) assert.ok(messages[code], `${code} has no message`);
  const keys = Object.keys(messages);
  for (const key of keys) assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
});

test("the three production views are registered and every menu view of the production folder is drawable", () => {
  const { context } = loadFactory();
  for (const name of ["production", "production-new", "production-planning"]) assert.equal(typeof context.MNP_FACTORY_VIEWS[name], "function", name);
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "production");
  assert.deepEqual(plain(folder.entries.map((entry) => entry.view)), ["production-new", "production-planning", "production"]);
  for (const entry of folder.entries) assert.equal(typeof context.MNP_FACTORY_VIEWS[entry.view], "function", entry.key);
});

test("the list shows every order with its status, escapes text and filters by status", async () => {
  const all = await render("production");
  assert.match(all.body, /TEST-MO-26-001/);
  assert.match(all.body, /ใบสั่งงาน TEST-WO-26-001/);
  assert.match(all.body, /ฉบับร่าง \(ฝ่ายขาย\) \(1\)/);
  assert.match(all.body, /ส่งแล้ว รอฝ่ายวางแผนรับ \(1\)/);
  assert.doesNotMatch(all.body, /<script>/, "customer text is escaped");
  assert.match(all.actions, /ออกใบสั่งผลิต/);
  const planning = await render("production", { query: "status=planning" });
  assert.match(planning.body, /TEST-MO-26-003/);
  assert.match(planning.body, /TEST-MO-26-006/);
  assert.doesNotMatch(planning.body, /TEST-MO-26-001/);
  const unknown = await render("production", { query: "status=bogus" });
  assert.match(unknown.body, /TEST-MO-26-001/, "an unknown filter falls back to all");
  const empty = await render("production", { data: { ...FIXTURE, production: [] } });
  assert.match(empty.body, /ยังไม่มีใบสั่งผลิตในโหมดทดสอบ/);
});

test("sales sees edit and send on a draft and the planner's reason, but nothing on a submitted order except withdraw", async () => {
  const draft = await render("production", { query: "po=o-draft", dept: "SA" });
  assert.match(draft.body, /data-po-action="submit"/);
  assert.match(draft.body, /แก้ไขฉบับร่าง/);
  assert.doesNotMatch(draft.body, /data-po-action="receive"|id="po-return-form"|id="po-plan-form"/);
  assert.match(draft.body, /ฝ่ายวางแผนส่งกลับพร้อมเหตุผล: “ส่งกลับ &lt;script&gt;alert\(1\)&lt;\/script&gt;”/);
  assert.doesNotMatch(draft.body, /<script>/, "customer, note, reason and history are escaped");
  assert.match(draft.body, /ส่งกลับฝ่ายขาย/, "the history shows the return");
  const submitted = await render("production", { query: "po=o-sub", dept: "SA" });
  assert.match(submitted.body, /data-po-action="withdraw"/);
  assert.doesNotMatch(submitted.body, /data-po-action="submit"|data-po-action="receive"/);
});

test("planning gets receive and return on a waiting order and no sales buttons", async () => {
  const { body } = await render("production", { query: "po=o-sub", dept: "PP" });
  assert.match(body, /data-po-action="receive"/);
  assert.match(body, /id="po-return-form"/);
  assert.doesNotMatch(body, /data-po-action="withdraw"|data-po-action="submit"|id="po-plan-form"/);
});

test("the plan form shows the survey of the approved BOM, the routing choices and a prefilled note", async () => {
  const { body } = await render("production", { query: "po=o-plan", dept: "PP" });
  assert.match(body, /id="po-plan-form"/);
  assert.match(body, /<strong>RM-1<\/strong>/);
  assert.match(body, /FG-1 Rev\. A/);
  assert.match(body, /<option value="r1" selected>Rev\. A<\/option>/);
  assert.match(body, /<option value="r2">Rev\. B<\/option>/);
  assert.doesNotMatch(body, /Rev\. C/, "an obsolete routing is not offered");
  assert.match(body, /สำรวจคงคลังแล้ว: ขาด 1 รายการ — RM-1 ขาด 25 KG/, "120 ÷ 12 × 3 = 30 kg needed, 5 in stock, so 25 are short");
});

test("the plan form is blocked, with a way forward, when the product has no approved BOM", async () => {
  const { body } = await render("production", { query: "po=o-nobom", dept: "PP" });
  assert.match(body, /ยังไม่มี BOM ที่อนุมัติแล้ว/);
  assert.match(body, /href="#\/factory\?item=structure-new"/);
  assert.match(body, /<button class="btn" type="submit" disabled>/, "saving the plan is disabled");
});

test("a planned order offers re-planning and the work order button; a released one offers nothing and shows the number", async () => {
  const planned = await render("production", { query: "po=o-planned", dept: "PP" });
  assert.match(planned.body, /data-po-action="release"/);
  assert.match(planned.body, /บันทึกการวางแผนใหม่/);
  assert.match(planned.body, /<option value="r2" selected>/, "the routing already linked is selected");
  assert.match(planned.body, /ยางพอ/);
  const released = await render("production", { query: "po=o-rel", dept: "PP" });
  assert.doesNotMatch(released.body, /data-po-action|po-plan-form|po-return-form/);
  assert.match(released.body, /TEST-WO-26-001/);
  assert.match(released.body, /ออกใบสั่งงานแล้ว เลขที่ TEST-WO-26-001/);
});

test("another department sees who has to act, and the survey note is escaped", async () => {
  const { body } = await render("production", { query: "po=o-planned", dept: "RB" });
  assert.doesNotMatch(body, /data-po-action|po-plan-form/);
  assert.match(text(body), /ใบนี้รอฝ่ายวางแผน \(PP\)/);
  assert.match(body, /ยางพอ &lt;script&gt;/);
  assert.doesNotMatch(body, /<script>/);
});

test("an unknown order id says it was not found", async () => {
  const { body } = await render("production", { query: "po=ghost" });
  assert.match(body, /ไม่พบใบสั่งผลิตนี้/);
});

test("the new-order form lists finished goods only, warns users outside sales and refuses to edit a sent order", async () => {
  const asSales = await render("production-new", { dept: "SA" });
  assert.match(asSales.body, /id="po-form"/);
  assert.match(asSales.body, /FG-1 · ชื่อ FG-1/);
  assert.doesNotMatch(asSales.body, /WIP-1|RM-1/);
  assert.doesNotMatch(asSales.body, /สลับ “ทำหน้าที่เป็น”/);
  const asPlanner = await render("production-new", { dept: "PP" });
  assert.match(asPlanner.body, /สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงานขาย/);
  const edit = await render("production-new", { query: "po=o-draft", dept: "SA" });
  assert.match(edit.body, /id="po-form"/);
  assert.match(edit.body, /value="120"/);
  assert.match(edit.body, /ฝ่ายวางแผนส่งกลับพร้อมเหตุผล/);
  const sent = await render("production-new", { query: "po=o-sub", dept: "SA" });
  assert.doesNotMatch(sent.body, /id="po-form"/);
  assert.match(sent.body, /แก้ไขได้เฉพาะฉบับร่าง/);
  const none = await render("production-new", { dept: "SA", data: { ...FIXTURE, items: [item("rm1", "RM-1", "RM", "buy")] } });
  assert.match(none.body, /ยังไม่มีสินค้าสำเร็จรูป/);
});

test("the planning queue splits the three stages and tells other departments whose queue it is", async () => {
  const asPlanner = await render("production-planning", { dept: "PP" });
  assert.match(asPlanner.body, /รอรับ <span class="muted small">\(1\)<\/span>/);
  assert.match(asPlanner.body, /กำลังวางแผน <span class="muted small">\(2\)<\/span>/);
  assert.match(asPlanner.body, /วางแผนแล้ว รอออกใบสั่งงาน <span class="muted small">\(1\)<\/span>/);
  assert.match(asPlanner.body, /มีใบสั่งผลิตรอรับ <strong>1<\/strong> ใบ/);
  assert.doesNotMatch(asPlanner.body, /TEST-MO-26-001|TEST-MO-26-005/, "drafts and released orders are not in the planning queue");
  const asSales = await render("production-planning", { dept: "SA" });
  assert.match(asSales.body, /หน้านี้เป็นคิวของฝ่ายวางแผน/);
});

test("the receive and release buttons call their RPC with the order id and the version shown", async () => {
  const receive = await render("production", { query: "po=o-sub", dept: "PP" });
  await receive.controls['[data-po-action="receive"]'].handlers.click();
  assert.deepEqual(plain(receive.log.calls.at(-1)), ["app_factory_receive_production_order", { p_id: "o-sub", p_version: 3 }]);
  assert.equal(receive.log.renders, 1, "the page is redrawn after success");
  assert.match(receive.log.toasts.at(-1)[0], /รับ TEST-MO-26-002 แล้ว/);
  const release = await render("production", { query: "po=o-planned", dept: "PP" });
  await release.controls['[data-po-action="release"]'].handlers.click();
  assert.deepEqual(plain(release.log.calls.at(-1)), ["app_factory_release_production_order", { p_id: "o-planned", p_version: 3 }]);
  const submit = await render("production", { query: "po=o-draft", dept: "SA" });
  await submit.controls['[data-po-action="submit"]'].handlers.click();
  assert.equal(submit.log.calls.at(-1)[0], "app_factory_submit_production_order");
  const withdraw = await render("production", { query: "po=o-sub", dept: "SA" });
  await withdraw.controls['[data-po-action="withdraw"]'].handlers.click();
  assert.equal(withdraw.log.calls.at(-1)[0], "app_factory_withdraw_production_order");
});

test("return needs a confirmation and sends the reason; declining sends nothing", async () => {
  const sent = await render("production", { query: "po=o-plan", dept: "PP" });
  await sent.controls["#po-return-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(sent.log.calls.at(-1)), ["app_factory_return_production_order", { p_id: "o-plan", p_version: 3, p_note: "เหตุผลทดสอบ" }]);
  const declined = await render("production", { query: "po=o-plan", dept: "PP", confirmAnswer: false });
  await declined.controls["#po-return-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!declined.log.calls.some(([name]) => name === "app_factory_return_production_order"));
});

test("saving the plan sends the approved BOM, the chosen routing and the survey text", async () => {
  const view = await render("production", { query: "po=o-plan", dept: "PP" });
  const form = view.controls["#po-plan-form"];
  form.__values = { routing_id: "r2", survey_note: "ตรวจแล้ว ยางพอ" };
  await form.handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(view.log.calls.at(-1)), ["app_factory_plan_production_order",
    { p_id: "o-plan", p_version: 3, p_bom_id: "b1", p_routing_id: "r2", p_survey_note: "ตรวจแล้ว ยางพอ" }]);
});

test("a stale page is redrawn after a conflict, an ordinary error keeps the buttons usable", async () => {
  const conflict = await render("production", { query: "po=o-sub", dept: "PP", rpc: async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "PRODUCTION_ORDER_VERSION_CONFLICT" } }) });
  await conflict.controls['[data-po-action="receive"]'].handlers.click();
  assert.match(conflict.log.toasts.at(-1)[0], /ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว/);
  assert.equal(conflict.log.toasts.at(-1)[1], "error");
  assert.equal(conflict.log.renders, 1);
  const denied = await render("production", { query: "po=o-sub", dept: "PP", rpc: async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "PRODUCTION_PLANNING_ONLY" } }) });
  await denied.controls['[data-po-action="receive"]'].handlers.click();
  assert.match(denied.log.toasts.at(-1)[0], /เฉพาะฝ่ายวางแผน/);
  assert.equal(denied.log.renders, 0, "no redraw: the page is still current");
});

// ฟอร์มออกใบ: ฝั่งหน้าเว็บตรวจก่อนส่ง แล้วบันทึกและ (ถ้าเลือก) ส่งต่อ
async function submitForm(values, intent, rpc, dept = "SA") {
  const view = await render("production-new", { dept, rpc });
  const form = view.controls["#po-form"];
  form.__values = values;
  await form.handlers.submit({ preventDefault() {}, submitter: { dataset: { intent } } });
  return view;
}
const GOOD = { item_id: "fg1", planned_qty: "120", due_date: "2999-01-01", customer: "ลูกค้า", note: "" };

test("the form refuses bad values before calling the database", async () => {
  const view = await submitForm({ ...GOOD, planned_qty: "0" }, "save");
  assert.ok(!view.log.calls.some(([name]) => name === "app_factory_save_production_order"));
  assert.match(view.controls["#po-form-error"].textContent, /จำนวนที่สั่งผลิต/);
  assert.equal(view.controls["#po-form-error"].hidden, false);
});

test("save keeps a draft and opens it; save-and-send also sends it with the version the save returned", async () => {
  const saved = await submitForm(GOOD, "save");
  assert.equal(saved.log.calls.at(-1)[0], "app_factory_save_production_order");
  assert.deepEqual(plain(saved.log.calls.at(-1)[1]), { p_id: null, p_version: null, p_item_id: "fg1", p_planned_qty: 120, p_due_date: "2999-01-01", p_customer: "ลูกค้า", p_note: "" });
  assert.equal(saved.log.hash, "/factory?item=production-view&po=new");
  assert.match(saved.log.toasts.at(-1)[0], /ออกใบสั่งผลิต TEST-MO-26-009 \(ฉบับร่าง\) แล้ว/);
  const sent = await submitForm(GOOD, "send");
  assert.deepEqual(plain(sent.log.calls.map(([name]) => name).filter((name) => name.includes("production_order"))), ["app_factory_save_production_order", "app_factory_submit_production_order"]);
  assert.deepEqual(plain(sent.log.calls.at(-1)[1]), { p_id: "new", p_version: 1 });
  assert.match(sent.log.toasts.at(-1)[0], /ส่ง TEST-MO-26-009 ให้ฝ่ายวางแผนแล้ว/);
});

test("when sending fails after the draft was saved, the user is taken to the draft instead of saving a duplicate", async () => {
  const failing = async (name) => {
    if (name === "app_factory_master_data") return { data: FIXTURE, error: null };
    if (name === "app_factory_submit_production_order") return { data: null, error: { message: "PRODUCTION_ITEM_INVALID" } };
    return { data: { id: "new", version: 1, code: "TEST-MO-26-009" }, error: null };
  };
  const view = await submitForm(GOOD, "send", failing);
  assert.equal(view.log.hash, "/factory?item=production-view&po=new");
  assert.match(view.log.toasts.at(-1)[0], /บันทึก TEST-MO-26-009 เป็นฉบับร่างแล้ว แต่ส่งไม่สำเร็จ/);
  assert.equal(view.log.toasts.at(-1)[1], "error");
});

test("a save error stays on the form with the message", async () => {
  const view = await submitForm(GOOD, "save", async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "PRODUCTION_SALES_ONLY" } }), "PP");
  assert.match(view.controls["#po-form-error"].textContent, /เฉพาะแผนกขาย/);
  assert.equal(view.controls["#po-form-error"].hidden, false);
  assert.equal(view.log.hash, "");
});
