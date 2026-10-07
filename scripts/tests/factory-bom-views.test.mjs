import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดไฟล์ของหน้า Item master (ที่เขียนเป็น script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
// ตรวจเฉพาะ HTML ที่วาดและข้อความผิดพลาด (ไม่มี DOM จริง จึงไม่ตรวจ event) การตรวจเต็มรูปแบบทำกับ app.js จริงใน browser
const FILES = [
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/module-factory-master.js",
  "modules/module-factory-bom.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const item = (id, code, name, type, procurement, status = "active", unit = "PCS") => ({ id, code, name, item_type: type, procurement, status, unit_code: unit, brand: "MNP" });
const FIXTURE = {
  items: [
    item("fg1", "FG-1", "สินค้า 1", "FG", "make"),
    item("fg2", "FG-2", "สินค้า 2 <b>x</b>", "FG", "make"),
    item("fg3", "FG-3", "สินค้า 3", "FG", "make"),
    item("wip1", "WIP-1", "ระหว่างผลิต", "WIP", "make", "active", "KG"),
    item("rm1", "RM-1", "วัตถุดิบ <img src=x onerror=alert(1)>", "RM", "buy", "active", "KG"),
    item("rm2", "RM-2", "วัตถุดิบเก่า", "RM", "buy", "inactive", "KG"),
    item("pkg1", "PKG-1", "กล่อง", "PKG", "buy"),
  ],
  boms: [
    { id: "b1", item_id: "fg1", code: "FG-1", name: "สินค้า 1", unit_code: "PCS", revision: "A", output_qty: 10, status: "approved", effective_date: "2026-10-01", version: 9, note: "", decision_note: "ตรวจแล้ว", decided_at: "2026-10-03T00:00:00Z", decided_by_name: "Admin", created_by_name: "ช่าง", created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-03T00:00:00Z", submitted_at: null, submitted_by_name: null },
    { id: "b2", item_id: "fg1", code: "FG-1", name: "สินค้า 1", unit_code: "PCS", revision: "B", output_qty: 10, status: "pending_approval", effective_date: "2026-10-06", version: 3, note: "ปรับสูตร <script>alert(1)</script>", decision_note: "", decided_at: null, decided_by_name: null, created_by_name: "ช่าง", created_at: "2026-10-05T00:00:00Z", updated_at: "2026-10-06T00:00:00Z", submitted_at: "2026-10-06T09:00:00Z", submitted_by_name: "ช่าง" },
    { id: "b3", item_id: "fg2", code: "FG-2", name: "สินค้า 2 <b>x</b>", unit_code: "PCS", revision: "A", output_qty: 1, status: "draft", effective_date: "2026-10-02", version: 4, note: "", decision_note: "สัดส่วนผิด <i>แก้ด้วย</i>", decided_at: "2026-10-04T00:00:00Z", decided_by_name: "Admin", created_by_name: "ช่าง", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-04T00:00:00Z", submitted_at: null, submitted_by_name: null },
    { id: "b4", item_id: "wip1", code: "WIP-1", name: "ระหว่างผลิต", unit_code: "KG", revision: "A", output_qty: 100, status: "obsolete", effective_date: "2026-09-01", version: 5, note: "", decision_note: "", decided_at: "2026-09-02T00:00:00Z", decided_by_name: "Admin", created_by_name: "ช่าง", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-30T00:00:00Z", submitted_at: null, submitted_by_name: null },
  ],
  bom_lines: [
    { id: "l1", bom_id: "b1", line_no: 1, component_id: "rm1", code: "RM-1", name: "วัตถุดิบ <img src=x onerror=alert(1)>", unit_code: "KG", quantity: 2.0625, scrap_percent: 1.5 },
    { id: "l2", bom_id: "b2", line_no: 1, component_id: "rm1", code: "RM-1", name: "วัตถุดิบ", unit_code: "KG", quantity: 3, scrap_percent: 0 },
    { id: "l3", bom_id: "b2", line_no: 2, component_id: "pkg1", code: "PKG-1", name: "กล่อง", unit_code: "PCS", quantity: 1, scrap_percent: 0 },
    { id: "l4", bom_id: "b3", line_no: 1, component_id: "rm2", code: "RM-2", name: "วัตถุดิบเก่า", unit_code: "KG", quantity: 1, scrap_percent: 0 },
    { id: "l5", bom_id: "b3", line_no: 2, component_id: "rm1", code: "RM-1", name: "วัตถุดิบ", unit_code: "KG", quantity: 5, scrap_percent: 2 },
  ],
  bom_history: [
    { id: 3, bom_id: "b3", code: "FG-2", name: "สินค้า 2", revision: "A", action: "reject", version: 4, status_after: "draft", note: "สัดส่วนผิด <i>แก้ด้วย</i>", changed_by_name: "Admin", created_at: "2026-10-04T00:00:00Z" },
    { id: 2, bom_id: "b2", code: "FG-1", name: "สินค้า 1", revision: "B", action: "submit", version: 3, status_after: "pending_approval", note: "", changed_by_name: "ช่าง", created_at: "2026-10-06T09:00:00Z" },
    { id: 1, bom_id: "b1", code: "FG-1", name: "สินค้า 1", revision: "A", action: "approve", version: 9, status_after: "approved", note: "ตรวจแล้ว", changed_by_name: "Admin", created_at: "2026-10-03T00:00:00Z" },
  ],
};

function loadFactory(data = FIXTURE) {
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    escapeHtml,
    formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`,
    showToast: () => {},
    friendlyError: (error) => String(error?.message ?? error),
    setFormBusy: () => {},
    renderRoute: async () => {},
    confirm: () => true,
    CSS: { escape: (value) => value },
    URLSearchParams,
    Intl,
    location: { hash: "" },
    sb: { rpc: async (name) => ({ data: name === "app_factory_master_data" ? data : null, error: null }) },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context;
}

// เรียก view แล้วคืน options ที่ส่งให้ frame.paint (body/back/subtitle)
async function render(view, query = "", data = FIXTURE) {
  const context = loadFactory(data);
  let painted = null;
  const root = { querySelector: () => null, querySelectorAll: () => [] };
  const frame = { loading: () => {}, paint: (options) => { painted = options; return root; } };
  await context.MNP_FACTORY_VIEWS[view]({ params: new URLSearchParams(query), frame });
  return painted;
}

test("every BOM error code the migration can raise has a Thai message", () => {
  const sql = fs.readFileSync("supabase/migrations/20261007010000_factory_bom_draft_approval.sql", "utf8");
  const codes = [...new Set([...sql.matchAll(/raise exception '((?:INVALID_)?BOM_[A-Z_]+)'/g)].map((match) => match[1]))];
  assert.ok(codes.length >= 25, `found ${codes.length} codes`);
  const messages = loadFactory().MNP_FACTORY_ERRORS;
  for (const code of codes) assert.ok(messages[code], `${code} has no message`);
});

test("friendlyError picks the intended message: no key is hidden by an earlier key that is a part of it", () => {
  const keys = Object.keys(loadFactory().MNP_FACTORY_ERRORS);
  for (const key of keys) {
    // friendlyError (app.js) takes the first key contained in the message
    assert.equal(keys.find((candidate) => key.includes(candidate)), key, `${key} would be shown as another message`);
  }
});

test("the read-only BOM view and the three new views are all registered", () => {
  const views = loadFactory().MNP_FACTORY_VIEWS;
  for (const name of ["bom", "bom-new", "bom-drafts", "bom-approvals", "items", "item-new", "history", "routing", "inventory", "production"]) {
    assert.equal(typeof views[name], "function", name);
  }
  assert.equal(views["bom-pending"], undefined, "the placeholder view is gone");
});

test("a pending BOM shows the decision panel and the withdraw button, not submit or edit", async () => {
  const { body } = await render("bom", "bom=b2");
  assert.match(body, /id="fm-approve"/);
  assert.match(body, /id="fm-reject"/);
  assert.match(body, /data-bom-action="withdraw"/);
  assert.doesNotMatch(body, /data-bom-action="submit"/);
  assert.doesNotMatch(body, /แก้ไขฉบับร่าง/);
  assert.match(body, /ส่งขออนุมัติแล้ว รอผู้ดูแลระบบพิจารณา/);
  assert.match(body, /การอนุมัติจะเลิกใช้ Rev\. A ที่ใช้อยู่เดิมของ FG-1/, "approving replaces the approved revision");
  assert.match(body, /มีโครงสร้างสินค้ารออนุมัติ <strong>1<\/strong> รายการ/);
});

test("a draft shows edit and submit, and a returned draft shows the reviewer's reason", async () => {
  const { body } = await render("bom", "bom=b3");
  assert.match(body, /href="#\/factory\?item=structure-new&amp;bom=b3"/);
  assert.match(body, /data-bom-action="submit"/);
  assert.doesNotMatch(body, /id="fm-approve"/, "a draft cannot be decided");
  assert.match(body, /ถูกส่งกลับ/);
  assert.match(body, /ผู้อนุมัติส่งกลับพร้อมเหตุผล: “สัดส่วนผิด &lt;i&gt;แก้ด้วย&lt;\/i&gt;”/);
});

test("an approved BOM offers a new revision, an obsolete one offers nothing", async () => {
  const approved = (await render("bom", "bom=b1")).body;
  assert.match(approved, /สร้าง Revision ใหม่จากฉบับนี้|มีฉบับ Rev\. B \(รออนุมัติ\) อยู่แล้ว/);
  assert.match(approved, /มีฉบับ Rev\. B \(รออนุมัติ\) อยู่แล้ว/, "FG-1 already has Rev. B open, so no second draft is offered");
  assert.doesNotMatch(approved, /structure-new&amp;from=/);
  const obsolete = (await render("bom", "bom=b4")).body;
  assert.match(obsolete, /ฉบับนี้เลิกใช้แล้ว/);
  assert.doesNotMatch(obsolete, /data-bom-action|fm-approve|structure-new/);
});

test("an approved BOM without an open revision links to a copy-as-new-revision draft", async () => {
  const data = { ...FIXTURE, boms: FIXTURE.boms.filter((bom) => bom.id !== "b2") };
  const { body } = await render("bom", "bom=b1", data);
  assert.match(body, /href="#\/factory\?item=structure-new&amp;from=b1"/);
});

test("BOM quantities keep four decimals and user text is escaped", async () => {
  const { body } = await render("bom", "bom=b1");
  assert.match(body, /2\.0625 KG/);
  assert.doesNotMatch(body, /<img src=x/);
  assert.match(body, /&lt;img src=x onerror=alert\(1\)&gt;/);
  const pending = (await render("bom", "bom=b2")).body;
  assert.doesNotMatch(pending, /<script>alert/);
  assert.match(pending, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test("the BOM page shows only that BOM's history", async () => {
  const { body } = await render("bom", "bom=b1");
  assert.match(body, /ประวัติของฉบับนี้/);
  assert.match(body, /<td>อนุมัติ<\/td>/);
  assert.doesNotMatch(body, /ส่งขออนุมัติ<\/td>/, "the submit entry belongs to another BOM");
});

test("an empty register points to the create form", async () => {
  const { body } = await render("bom", "", { ...FIXTURE, boms: [], bom_lines: [], bom_history: [] });
  assert.match(body, /ยังไม่มีโครงสร้างสินค้าในโหมดทดสอบ/);
  assert.match(body, /structure-new/);
});

test("the new form lists only parents free of an open revision and offers every active component", async () => {
  const { body } = await render("bom-new");
  const parentSelect = body.match(/<select class="select" id="fm-bom-item"[\s\S]*?<\/select>/)[0];
  assert.match(parentSelect, /<option value="fg3">FG-3 · สินค้า 3 \(PCS\)<\/option>/, "FG-3 has no BOM yet");
  assert.doesNotMatch(parentSelect, /value="fg1"/, "FG-1 has a pending revision");
  assert.doesNotMatch(parentSelect, /value="fg2"/, "FG-2 has a draft");
  assert.doesNotMatch(parentSelect, /value="(rm1|rm2|pkg1)"/, "raw materials and packaging cannot own a BOM");
  const firstLine = body.match(/<tr data-bom-row>[\s\S]*?<\/tr>/)[0];
  assert.match(firstLine, /<option value="rm1">RM-1 · /, "components include raw materials");
  assert.match(firstLine, /<option value="pkg1">/);
  assert.doesNotMatch(firstLine, /value="rm2"/, "inactive items are not offered");
  assert.match(body, /Item ที่มีฉบับร่าง\/รออนุมัติอยู่แล้ว/);
  assert.match(body, /FG-1 · Rev\. B \(รออนุมัติ\)/);
  assert.match(body, /data-intent="draft"/);
  assert.match(body, /data-intent="submit"/);
  assert.match(body, /id="fm-add-line"/);
  assert.match(body, /ระบบกำหนด Revision|หน่วยนับฐานของส่วนประกอบนั้น/);
});

test("editing a draft locks the parent, fills the form and skips inactive components", async () => {
  const { body, subtitle } = await render("bom-new", "bom=b3");
  assert.equal(subtitle, "แก้ไข FG-2 Rev. A");
  assert.match(body, /<select class="select" id="fm-bom-item" name="item_id" required disabled>/);
  assert.match(body, /<option value="fg2" selected>/);
  assert.match(body, /name="output_qty"[^>]*value="1"/);
  assert.match(body, /value="2026-10-02"/);
  assert.match(body, /<option value="rm1" selected>/, "the active component is kept");
  assert.doesNotMatch(body, /selected>RM-2/, "an inactive component is dropped from the editor");
  assert.match(body, /ผู้อนุมัติส่งกลับพร้อมเหตุผล/);
});

test("only drafts can be edited: pending, approved and unknown ids get an explanation", async () => {
  const pending = await render("bom-new", "bom=b2");
  assert.match(pending.body, /อยู่ในสถานะ “รออนุมัติ” แก้ไขได้เฉพาะฉบับร่าง/);
  assert.doesNotMatch(pending.body, /fm-bom-form/);
  const approved = await render("bom-new", "bom=b1");
  assert.match(approved.body, /อยู่ในสถานะ “อนุมัติแล้ว”/);
  const unknown = await render("bom-new", "bom=nope");
  assert.match(unknown.body, /ไม่พบโครงสร้างสินค้านี้/);
});

test("copying from a BOM prefills its active lines and tells the user", async () => {
  const data = { ...FIXTURE, boms: FIXTURE.boms.filter((bom) => bom.id !== "b2") };
  const { body } = await render("bom-new", "from=b1", data);
  assert.match(body, /คัดลอกส่วนประกอบจาก Rev\. A ของ FG-1 แล้ว/);
  assert.match(body, /<option value="fg1" selected>/);
  assert.match(body, /<option value="rm1" selected>/);
  assert.match(body, /Item นี้มีโครงสร้างที่อนุมัติแล้ว|id="fm-bom-item-hint"/);
});

test("copying is refused while the item already has an open revision", async () => {
  const { body } = await render("bom-new", "from=b1");
  assert.match(body, /FG-1 มีฉบับ Rev\. B \(รออนุมัติ\) อยู่แล้ว สร้างฉบับใหม่ซ้อนไม่ได้/);
});

test("the new form explains itself when no item can own a BOM", async () => {
  const none = { ...FIXTURE, items: FIXTURE.items.filter((entry) => entry.item_type === "RM"), boms: [] };
  const { body } = await render("bom-new", "", none);
  assert.match(body, /ไม่มีสินค้าหลักที่สร้างโครงสร้างใหม่ได้/);
  assert.doesNotMatch(body, /fm-bom-form/);
});

test("the draft list puts the returned draft first with its reason", async () => {
  const { body } = await render("bom-drafts");
  assert.match(body, /ฉบับร่างที่แก้ไขได้ 1 รายการ/);
  assert.match(body, /ถูกส่งกลับ/);
  assert.match(body, /สัดส่วนผิด &lt;i&gt;แก้ด้วย&lt;\/i&gt;/);
  assert.match(body, /aria-label="แก้ไข FG-2 Rev\. A"/);
  assert.match(body, /2 บรรทัด/);
});

test("the approval page lists pending BOMs with a review link and the latest decisions", async () => {
  const { body } = await render("bom-approvals");
  assert.match(body, /<span>รออนุมัติ<\/span><strong>1<\/strong>/);
  assert.match(body, /aria-label="ตรวจและตัดสิน FG-1 Rev\. B"/);
  assert.match(body, /โหมดทดสอบไม่ส่งแจ้งเตือน/);
  assert.match(body, /ผลการพิจารณาล่าสุด/);
  assert.match(body, /<td>ไม่อนุมัติ \(ส่งกลับ\)<\/td>/);
  assert.match(body, /<td>อนุมัติ<\/td>/);
  assert.doesNotMatch(body, /<td>ส่งขออนุมัติ<\/td>/, "submissions are not decisions");
});

test("the approval page says so when nothing is waiting", async () => {
  const { body } = await render("bom-approvals", "", { ...FIXTURE, boms: FIXTURE.boms.filter((bom) => bom.status !== "pending_approval") });
  assert.match(body, /ไม่มีโครงสร้างสินค้ารออนุมัติ/);
});
