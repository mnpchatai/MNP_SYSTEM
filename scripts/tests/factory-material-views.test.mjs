import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดไฟล์หน้าจอใบสั่งวัตถุดิบ (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
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

const item = (id, code, type, procurement, stock = 0, unit = "KG", status = "active") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, status, unit_code: unit, brand: "MNP", stock });
const wo = (id, code, status, extra = {}) => ({
  id, code, item_id: "fg", item_code: "FG-1", name: "สินค้า 1", unit_code: "SET", bom_id: "b-fg", routing_id: null, planned_qty: 100, completed_qty: 0,
  status, due_date: "2026-11-01", customer: "", note: "", survey_note: "", return_note: "", work_order_no: status === "released" ? "TEST-WO-26-001" : null, version: 5, ...extra,
});
const mo = (id, code, status, lines, extra = {}) => ({
  id, code, status, version: 4, production_order_id: "wo-rel", production_code: "TEST-MO-26-001", item_code: "FG-1", item_name: "สินค้า 1",
  supplier: "", expected_date: "2026-11-05", note: "", cancel_note: "", created_at: "2026-10-07T01:00:00Z", ordered_at: null, received_at: null, cancelled_at: null,
  created_by_name: "ทดสอบ พนักงาน ST", ordered_by_name: null, received_by_name: null, cancelled_by_name: null,
  lines: lines.map(([itemId, quantity], index) => ({ line_no: index + 1, item_id: itemId, code: itemId.toUpperCase(), name: `ชื่อ ${itemId}`, unit_code: "KG", quantity })), ...extra,
});
const FIXTURE = {
  items: [item("fg", "FG-1", "FG", "make", 0, "SET"), item("nr", "RM-NR", "RM", "buy", 10), item("chem", "RM-CHEM", "RM", "buy", 0), item("part", "WIP-PART", "WIP", "make", 0, "PCS"), item("box", "PKG-BOX", "PKG", "buy", 400, "PCS")],
  boms: [{ id: "b-fg", item_id: "fg", code: "FG-1", name: "สินค้า 1", unit_code: "SET", revision: "A", output_qty: 10, status: "approved" }],
  bom_lines: [
    { id: "l1", bom_id: "b-fg", line_no: 1, component_id: "nr", quantity: 50, scrap_percent: 0 },
    { id: "l2", bom_id: "b-fg", line_no: 2, component_id: "chem", quantity: 5, scrap_percent: 10 },
    { id: "l3", bom_id: "b-fg", line_no: 3, component_id: "part", quantity: 10, scrap_percent: 0 },
  ],
  routings: [],
  production: [wo("wo-rel", "TEST-MO-26-001", "released"), wo("wo-draft", "TEST-MO-26-002", "draft", { work_order_no: null })],
  production_history: [],
  material_orders: [
    mo("m-draft", "TEST-MR-26-001", "draft", [["nr", 300]], { supplier: XSS, note: `หมายเหตุ ${XSS}` }),
    mo("m-ord", "TEST-MR-26-002", "ordered", [["chem", 55]], { supplier: "ผู้ขาย ก", ordered_at: "2026-10-07T02:00:00Z", ordered_by_name: "ทดสอบ พนักงาน ST" }),
    mo("m-rec", "TEST-MR-26-003", "received", [["box", 10]], { received_at: "2026-10-07T03:00:00Z", received_by_name: "ทดสอบ พนักงาน ST" }),
    mo("m-can", "TEST-MR-26-004", "cancelled", [["nr", 5]], { cancel_note: `ผิดใบ ${XSS}` }),
  ],
  material_history: [
    { id: 2, order_id: "m-can", code: "TEST-MR-26-004", action: "cancel", version: 3, status_after: "cancelled", note: `เหตุผล ${XSS}`, changed_by_name: "ทดสอบ พนักงาน ST", created_at: "2026-10-07T04:00:00Z" },
    { id: 1, order_id: "m-can", code: "TEST-MR-26-004", action: "create", version: 1, status_after: "draft", note: "", changed_by_name: "ทดสอบ พนักงาน ST", created_at: "2026-10-07T01:00:00Z" },
  ],
};

function loadFactory({ data = FIXTURE, dept = "ST", rpc, confirmAnswer = true } = {}) {
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
    sb: { rpc: async (name, args) => { calls.push([name, args]); return rpc ? rpc(name, args) : { data: name === "app_factory_master_data" ? data : { id: "new", version: 1, code: "TEST-MR-26-009" }, error: null }; } },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, log };
}

async function render(view, { query = "", ...options } = {}) {
  const { context, log } = loadFactory(options);
  let painted = null;
  const controls = {};
  const make = () => ({ disabled: false, hidden: false, textContent: "", handlers: {}, dataset: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, reportValidity: () => true, querySelector() { return { value: "เหตุผลทดสอบ" }; }, scrollIntoView() {} });
  const root = { querySelector: (selector) => (controls[selector] ??= make()), querySelectorAll: () => [] };
  const frame = { loading: () => {}, paint: (opts) => { painted = opts; return root; } };
  await context.MNP_FACTORY_VIEWS[view]({ params: new URLSearchParams(query), frame });
  return { ...painted, controls, log, context };
}
// ค่าที่สร้างใน vm context ต่าง prototype กับของ test จึงแปลงเป็น JSON ธรรมดาก่อนเทียบด้วย deepEqual
const plain = (value) => JSON.parse(JSON.stringify(value));
const text = (html) => String(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

test("every error code the material migration can raise has a Thai message that is not hidden by another key", () => {
  const sql = fs.readFileSync("supabase/migrations/20261007040000_factory_material_order_workflow.sql", "utf8");
  const codes = [...new Set([...sql.matchAll(/raise exception '((?:INVALID_)?MATERIAL_[A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(codes.length >= 18, `found ${codes.length} codes`);
  const messages = loadFactory().context.MNP_FACTORY_ERRORS;
  for (const code of codes) assert.ok(messages[code], `${code} has no message`);
  const keys = Object.keys(messages);
  for (const key of keys) assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
});

test("the material views are registered and every menu view of the material folder is drawable", () => {
  const { context } = loadFactory();
  for (const name of ["material", "material-new"]) assert.equal(typeof context.MNP_FACTORY_VIEWS[name], "function", name);
  const folder = context.MNP_FACTORY_ITEM_MASTER.FOLDERS.find((entry) => entry.key === "material");
  assert.deepEqual(plain(folder.entries.map((entry) => entry.view)), ["material-new", "material"]);
  for (const entry of folder.entries) assert.equal(typeof context.MNP_FACTORY_VIEWS[entry.view], "function", entry.key);
});

test("the list shows every order with its status, escapes text and filters by status", async () => {
  const all = await render("material");
  for (const code of ["TEST-MR-26-001", "TEST-MR-26-002", "TEST-MR-26-003", "TEST-MR-26-004"]) assert.match(all.body, new RegExp(code));
  assert.match(all.body, /ฉบับร่าง \(1\)/);
  assert.match(all.body, /สั่งแล้ว รอรับของ \(1\)/);
  assert.doesNotMatch(all.body, /<script>/, "supplier text is escaped");
  assert.match(all.actions, /ออกใบสั่งวัตถุดิบ/);
  const ordered = await render("material", { query: "status=ordered" });
  assert.match(ordered.body, /TEST-MR-26-002/);
  assert.doesNotMatch(ordered.body, /TEST-MR-26-001/);
  const unknown = await render("material", { query: "status=bogus" });
  assert.match(unknown.body, /TEST-MR-26-001/, "an unknown filter falls back to all");
  const empty = await render("material", { data: { ...FIXTURE, material_orders: [] } });
  assert.match(empty.body, /ยังไม่มีใบสั่งวัตถุดิบในโหมดทดสอบ/);
});

test("stores sees edit, place and cancel on a draft, escaped text, and nothing but a hint for other departments", async () => {
  const draft = await render("material", { query: "mo=m-draft", dept: "ST" });
  assert.match(draft.body, /data-mo-action="place"/);
  assert.match(draft.body, /แก้ไขฉบับร่าง/);
  assert.match(draft.body, /id="mo-cancel-form"/);
  assert.doesNotMatch(draft.body, /data-mo-action="receive"/);
  assert.doesNotMatch(draft.body, /<script>/, "supplier and note are escaped");
  const other = await render("material", { query: "mo=m-draft", dept: "PP" });
  assert.doesNotMatch(other.body, /data-mo-action|mo-cancel-form/);
  assert.match(text(other.body), /ใบนี้เป็นงานของแผนก ST/);
});

test("an ordered order offers receive and cancel but no edit; received and cancelled offer nothing", async () => {
  const ordered = await render("material", { query: "mo=m-ord", dept: "ST" });
  assert.match(ordered.body, /data-mo-action="receive"/);
  assert.match(ordered.body, /id="mo-cancel-form"/);
  assert.doesNotMatch(ordered.body, /data-mo-action="place"|แก้ไขฉบับร่าง/);
  assert.match(ordered.body, /เพิ่มยอดคงคลังเข้าคลัง RM/);
  const received = await render("material", { query: "mo=m-rec", dept: "ST" });
  assert.doesNotMatch(received.body, /data-mo-action|mo-cancel-form/);
  assert.match(received.body, /รับของเข้าคลังแล้ว ยอดคงคลังเพิ่มตามใบนี้/);
  const cancelled = await render("material", { query: "mo=m-can", dept: "ST" });
  assert.doesNotMatch(cancelled.body, /data-mo-action|mo-cancel-form/);
  assert.match(cancelled.body, /ยกเลิกแล้ว เหตุผล: “ผิดใบ &lt;script&gt;/);
  assert.match(cancelled.body, /เหตุผล &lt;script&gt;/, "the history reason is escaped");
  assert.doesNotMatch(cancelled.body, /<script>/);
});

test("an unknown order id says it was not found", async () => {
  const { body } = await render("material", { query: "mo=ghost" });
  assert.match(body, /ไม่พบใบสั่งวัตถุดิบนี้/);
});

test("the new-order page first asks for a released production order, and only released ones are offered", async () => {
  const { body } = await render("material-new");
  assert.match(body, /เลือกใบสั่งผลิตที่ต้องการสั่งวัตถุดิบ/);
  assert.match(body, /TEST-MO-26-001/);
  assert.doesNotMatch(body, /TEST-MO-26-002/, "a draft production order is not offered");
  assert.match(body, /href="#\/factory\?item=material-new&amp;wo=wo-rel"/);
  const none = await render("material-new", { data: { ...FIXTURE, production: [wo("wo-draft", "TEST-MO-26-002", "draft")] } });
  assert.match(none.body, /ยังไม่มีใบสั่งผลิตที่ออกใบสั่งงานแล้ว/);
});

test("the form proposes the shortages minus what is already on order, and lists only purchasable extras", async () => {
  const { body } = await render("material-new", { query: "wo=wo-rel", dept: "ST" });
  assert.match(body, /id="mo-form"/);
  assert.match(body, /name="qty:chem"[^>]*value=""/, "chemical: 55 short but 55 already ordered (TEST-MR-26-002), so nothing is proposed");
  assert.match(body, /name="qty:nr"[^>]*value="190"/, "rubber: 490 short − 300 in the draft order");
  assert.doesNotMatch(body, /name="qty:part"/, "an item made in-house cannot be bought");
  assert.match(body, /ต้องผลิตเอง\/ทำ BOM ก่อน สั่งซื้อไม่ได้: WIP-PART ขาด 100 PCS/);
  assert.match(body, /<option value="box">PKG-BOX · ชื่อ PKG-BOX \(PCS\)<\/option>/);
  assert.doesNotMatch(body, /<option value="part">/);
  assert.doesNotMatch(body, /สลับ “ทำหน้าที่เป็น”/);
  const planner = await render("material-new", { query: "wo=wo-rel", dept: "PP" });
  assert.match(planner.body, /สลับ “ทำหน้าที่เป็น” ที่แถบสีเหลืองเป็นพนักงาน ST/);
});

test("a production order that is not released cannot be ordered for, and a missing one says so", async () => {
  const draft = await render("material-new", { query: "wo=wo-draft" });
  assert.match(draft.body, /สั่งวัตถุดิบได้เฉพาะใบสั่งผลิตที่ออกใบสั่งงานแล้ว/);
  assert.doesNotMatch(draft.body, /id="mo-form"/);
  const ghost = await render("material-new", { query: "wo=ghost" });
  assert.match(ghost.body, /ไม่พบใบสั่งผลิตนี้/);
});

test("editing a draft starts from its own quantities and does not count them twice as already ordered", async () => {
  const { body } = await render("material-new", { query: "mo=m-draft", dept: "ST" });
  assert.match(body, /id="mo-form"/);
  assert.match(body, /name="qty:nr"[^>]*value="300"/, "the saved quantity");
  assert.match(body, /name="qty:chem"[^>]*value=""/, "the chemical stays blank: it is fully ordered by another order");
  assert.match(body, /<td class="right">0<\/td>/, "this draft is not counted as already on order for itself");
  const sent = await render("material-new", { query: "mo=m-ord", dept: "ST" });
  assert.doesNotMatch(sent.body, /id="mo-form"/);
  assert.match(sent.body, /แก้ไขได้เฉพาะฉบับร่าง/);
});

test("the production order page shows the shortages and the material orders linked to it", async () => {
  const { body } = await render("production", { query: "po=wo-rel", dept: "PP" });
  assert.match(body, /สั่งวัตถุดิบ \(ขั้น 3 แผนก ST\)/);
  assert.match(body, /ควรสั่งเพิ่ม 190/);
  assert.match(body, /สั่งไว้แล้ว/);
  assert.match(body, /ต้องผลิตเอง \(ทำ BOM\)/);
  assert.match(body, /TEST-MR-26-003/, "a received order is listed");
  assert.match(body, /href="#\/factory\?item=material-new&amp;wo=wo-rel"/);
  const draft = await render("production", { query: "po=wo-draft", dept: "PP" });
  assert.doesNotMatch(draft.body, /สั่งวัตถุดิบ \(ขั้น 3 แผนก ST\)/, "only released orders show the material section");
});

test("place and receive call their RPC with the order id and the version shown, and redraw", async () => {
  const place = await render("material", { query: "mo=m-draft", dept: "ST" });
  await place.controls['[data-mo-action="place"]'].handlers.click();
  assert.deepEqual(plain(place.log.calls.at(-1)), ["app_factory_place_material_order", { p_id: "m-draft", p_version: 4 }]);
  assert.equal(place.log.renders, 1);
  assert.match(place.log.toasts.at(-1)[0], /สั่งวัตถุดิบตาม TEST-MR-26-001 แล้ว/);
  const receive = await render("material", { query: "mo=m-ord", dept: "ST" });
  await receive.controls['[data-mo-action="receive"]'].handlers.click();
  assert.deepEqual(plain(receive.log.calls.at(-1)), ["app_factory_receive_material_order", { p_id: "m-ord", p_version: 4 }]);
  assert.match(receive.log.toasts.at(-1)[0], /ยอดคงคลังเพิ่มขึ้น/);
});

test("cancel needs a confirmation and sends the reason; declining sends nothing", async () => {
  const sent = await render("material", { query: "mo=m-ord", dept: "ST" });
  await sent.controls["#mo-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.deepEqual(plain(sent.log.calls.at(-1)), ["app_factory_cancel_material_order", { p_id: "m-ord", p_version: 4, p_note: "เหตุผลทดสอบ" }]);
  const declined = await render("material", { query: "mo=m-ord", dept: "ST", confirmAnswer: false });
  await declined.controls["#mo-cancel-form"].handlers.submit({ preventDefault() {} });
  assert.ok(!declined.log.calls.some(([name]) => name === "app_factory_cancel_material_order"));
});

test("a stale page is redrawn after a conflict or a repeated receipt, an ordinary error keeps the buttons usable", async () => {
  const failing = (code) => async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: code } });
  const conflict = await render("material", { query: "mo=m-ord", dept: "ST", rpc: failing("MATERIAL_ORDER_VERSION_CONFLICT") });
  await conflict.controls['[data-mo-action="receive"]'].handlers.click();
  assert.match(conflict.log.toasts.at(-1)[0], /ถูกเปลี่ยนจากหน้าต่างอื่นแล้ว/);
  assert.equal(conflict.log.renders, 1);
  const twice = await render("material", { query: "mo=m-ord", dept: "ST", rpc: failing("MATERIAL_ORDER_NOT_ORDERED") });
  await twice.controls['[data-mo-action="receive"]'].handlers.click();
  assert.match(twice.log.toasts.at(-1)[0], /อาจรับไปแล้วหรือยกเลิกแล้ว/);
  assert.equal(twice.log.renders, 1, "the page is redrawn so the receipt is not tried again");
  const denied = await render("material", { query: "mo=m-ord", dept: "ST", rpc: failing("MATERIAL_STORES_ONLY") });
  await denied.controls['[data-mo-action="receive"]'].handlers.click();
  assert.match(denied.log.toasts.at(-1)[0], /เฉพาะแผนก ST/);
  assert.equal(denied.log.renders, 0);
});

// ฟอร์มออกใบ: ฝั่งหน้าเว็บตรวจก่อนส่ง แล้วบันทึกและ (ถ้าเลือก) สั่งต่อ
async function submitForm(values, intent, rpc, query = "wo=wo-rel") {
  const view = await render("material-new", { query, dept: "ST", rpc });
  const form = view.controls["#mo-form"];
  form.__values = values;
  await form.handlers.submit({ preventDefault() {}, submitter: { dataset: { intent } } });
  return view;
}
const GOOD = { supplier: "ผู้ขาย", expected_date: "2999-01-01", note: "", "qty:chem": "55", "qty:nr": "190", extra_item_1: "box", extra_qty_1: "10" };

test("the form refuses bad values before calling the database", async () => {
  const view = await submitForm({ ...GOOD, "qty:chem": "", "qty:nr": "", extra_item_1: "", extra_qty_1: "" }, "save");
  assert.ok(!view.log.calls.some(([name]) => name === "app_factory_save_material_order"));
  assert.match(view.controls["#mo-form-error"].textContent, /อย่างน้อย 1 รายการ/);
  assert.equal(view.controls["#mo-form-error"].hidden, false);
  const duplicate = await submitForm({ ...GOOD, extra_item_1: "nr" }, "save");
  assert.match(duplicate.controls["#mo-form-error"].textContent, /ซ้ำ/);
});

test("save keeps a draft and opens it; save-and-place also places it with the version the save returned", async () => {
  const saved = await submitForm(GOOD, "save");
  const call = plain(saved.log.calls.find(([name]) => name === "app_factory_save_material_order"));
  assert.deepEqual(call[1], {
    p_id: null, p_version: null, p_production_order_id: "wo-rel", p_supplier: "ผู้ขาย", p_expected_date: "2999-01-01", p_note: "",
    p_lines: [{ item_id: "chem", quantity: 55 }, { item_id: "nr", quantity: 190 }, { item_id: "box", quantity: 10 }],
  });
  assert.equal(saved.log.hash, "/factory?item=material-view&mo=new");
  assert.match(saved.log.toasts.at(-1)[0], /ออกใบสั่งวัตถุดิบ TEST-MR-26-009 \(ฉบับร่าง\) แล้ว/);
  const placed = await submitForm(GOOD, "place");
  assert.deepEqual(plain(placed.log.calls.map(([name]) => name).filter((name) => name.includes("material_order"))), ["app_factory_save_material_order", "app_factory_place_material_order"]);
  assert.deepEqual(plain(placed.log.calls.at(-1)[1]), { p_id: "new", p_version: 1 });
  assert.match(placed.log.toasts.at(-1)[0], /สั่งวัตถุดิบตาม TEST-MR-26-009 แล้ว/);
});

test("editing a draft sends its id and version and keeps its production order", async () => {
  const view = await submitForm(GOOD, "save", undefined, "mo=m-draft");
  const call = plain(view.log.calls.find(([name]) => name === "app_factory_save_material_order"));
  assert.equal(call[1].p_id, "m-draft");
  assert.equal(call[1].p_version, 4);
  assert.equal(call[1].p_production_order_id, "wo-rel");
});

test("when placing fails after the draft was saved, the user is taken to the draft instead of saving a duplicate", async () => {
  const failing = async (name) => {
    if (name === "app_factory_master_data") return { data: FIXTURE, error: null };
    if (name === "app_factory_place_material_order") return { data: null, error: { message: "MATERIAL_ORDER_LINE_INVALID" } };
    return { data: { id: "new", version: 1, code: "TEST-MR-26-009" }, error: null };
  };
  const view = await submitForm(GOOD, "place", failing);
  assert.equal(view.log.hash, "/factory?item=material-view&mo=new");
  assert.match(view.log.toasts.at(-1)[0], /บันทึก TEST-MR-26-009 เป็นฉบับร่างแล้ว แต่สั่งไม่สำเร็จ/);
  assert.equal(view.log.toasts.at(-1)[1], "error");
});

test("a save error stays on the form with the message", async () => {
  const view = await submitForm(GOOD, "save", async (name) => (name === "app_factory_master_data" ? { data: FIXTURE, error: null } : { data: null, error: { message: "MATERIAL_STORES_ONLY" } }));
  assert.match(view.controls["#mo-form-error"].textContent, /เฉพาะแผนก ST/);
  assert.equal(view.controls["#mo-form-error"].hidden, false);
  assert.equal(view.log.hash, "");
});
