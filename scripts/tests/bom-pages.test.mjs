import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { makeZip } from "./zip-fixture.mjs";

// โหลดโมดูล BOM ทั้งชุด (พร้อม RubberFlow ที่ให้ ui และ store สำหรับการเชื่อม WO) เข้า context จำลองที่มี helper ของ app.js แบบ stub
// และ localStorage จำลอง แล้ววาดทุกหน้า × ทุกบทบาท เรียก dialog ทุกตัว และยิงฟอร์ม/ปุ่มผ่านกติกา data-rf-* ของ module-bom.js
const FILES = [
  "modules/ui-icons.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const PAGES = ["dashboard", "build", "items", "product", "structure", "variants", "compounds", "import", "check", "orders", "customers", "count", "jobs", "audit"];
const ROLES = ["admin", "manager", "planner", "rb", "gr", "pt", "bg", "st"];
const XSS = "<script>alert(1)</script>";

function load({ sandbox = true, route = "", storage = new Map() } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: `#/bom${route ? `?${route}` : ""}`, dialogs: [], confirms: [], confirmAnswer: true };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {}, add() {}, remove() {} }, files: [],
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
    insertAdjacentHTML(_, html) { log.dialogs.push(html); this.lastElementChild = { ...generic(), tagName: "DIALOG", innerHTML: html }; },
  });
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const localStorage = { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  Object.assign(context, {
    window: context, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async (options) => { log.confirms.push(options); return log.confirmAnswer; }, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee: { isSandbox: sandbox } },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic() },
    localStorage,
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {},
    TextDecoder, Uint8Array, DataView,
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const registered = context.MNP_REQUEST_MODULES.BOM;
  const render = async (query = route) => {
    log.hash = `#/bom${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await registered.pages.bom(new URLSearchParams(query));
    return app.innerHTML;
  };
  const ctx = (query = "") => context.MNP_BOM.context(new URLSearchParams(query));
  const submit = async (query, action, values, args = {}) => {
    const form = { ...node(), dataset: { rfForm: action, rfArgs: JSON.stringify(args), rfSuccess: "ok {result}" }, __values: values, closest: () => null };
    fakes["form[data-rf-form]"] = [form];
    await render(query);
    fakes["form[data-rf-form]"] = [];
    form.handlers.submit({ preventDefault() {} });
    return form;
  };
  return { context, app, log, fakes, root, storage, module: registered, store: context.MNP_BOM.store, rf: context.MNP_RUBBERFLOW, render, ctx, submit };
}
const clean = (html) => { assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/); };
const json = (value) => JSON.parse(JSON.stringify(value));

test("the module registers a sandbox-only standalone page, refuses users outside the sandbox and shows the role chooser first", async () => {
  const env = load();
  assert.equal(env.module.enabled, true);
  assert.equal(env.module.sandbox, true);
  assert.equal(env.module.standalone, true);
  assert.equal(env.module.nav[0].sandboxOnly, true);
  assert.equal(env.module.nav[0].path, "bom");
  const html = await env.render();
  assert.match(html, /<select[^>]*data-rf-user/, "the role is picked from the toolbar select");
  assert.doesNotMatch(html, /data-rf-user-pick|rf-role-grid|data-rf-reset/, "no full-page role grid, and no reset before a role");
  assert.equal(env.module.nav[0].group, "ทดสอบ", "listed under the test group in the side menu");
  assert.equal(env.module.nav[0].subnav("bom"), "", "no sub-menu before a role is chosen");
  const outside = load({ sandbox: false });
  await outside.render();
  assert.equal(outside.log.notFound, 1);
});

test("every page renders for every role without undefined/NaN, menus follow the role and unknown pages redirect home", async () => {
  for (const role of ROLES) {
    const env = load();
    const user = env.store.data().users.find((row) => row.role === role);
    env.store.setUser(user.id);
    for (const page of PAGES) {
      const html = await env.render(`p=${page}`);
      clean(html);
      if (env.context.MNP_BOM_STORE.canSee(user, page)) assert.doesNotMatch(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/, `${role} sees ${page}`);
      else assert.match(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/, `${role} is denied ${page}`);
    }
    const sub = env.module.nav[0].subnav("bom");
    for (const page of PAGES) assert.equal(sub.includes(`p=${page}`) || page === "dashboard", env.context.MNP_BOM_STORE.canSee(user, page) || page === "dashboard", `${role} menu ${page}`);
    await env.render("p=nothing");
    assert.equal(env.log.hash, role === "st" ? "#/bom?p=count" : "#/bom", "unknown page → home of the role (the warehouse lands on the count page)");
  }
});

test("the single BOM builder: picker without a code, the full editable tree for an existing product, a sibling template for a new variant, an empty row for a new base", async () => {
  const env = load();
  env.store.setUser("B03"); // ฝ่ายวางแผน
  let html = await env.render("p=build");
  assert.match(html, /1\. เลือกหมวดและรหัส/);
  assert.match(html, /name="kind" data-native-select data-bom-pick-kind[^>]*><optgroup label="สินค้า"><option value="FG" selected>/, "step 1 starts with the category, product by default");
  assert.match(html, /bom-pick-code is-hidden[\s\S]*?name="code"[^>]*disabled/, "the single code field waits until a non-product kind is chosen");
  assert.match(html, /bom-base-list/);
  assert.match(html, /สินค้าที่แก้ล่าสุด/);
  assert.doesNotMatch(html, /data-rf-form="saveBomTree"/);
  html = await env.render("p=build&code=DEMO-TP-01(P)-Y");
  assert.match(html, /data-rf-form="saveBomTree"/);
  assert.match(html, /name="itemName"[^>]*value="ตอปิโดยาง TP-01/);
  const rows = [...html.matchAll(/<tr class="bom-row[^"]*" data-row="([^"]+)" data-parent="([^"]*)" data-level="(\d)"/g)].map((match) => ({ id: match[1], parent: match[2], level: Number(match[3]) }));
  assert.equal(rows.filter((row) => row.level === 1 && row.id !== "__ID__").length, 8, "8 first-level lines of the product (plus the template row)");
  assert.ok(rows.some((row) => row.level === 2), "RB rows under SE and pellets under PT are editable in the same table");
  assert.match(html, /value="RB-DM01-02-OR01-202-18-70"/);
  assert.match(html, /name="pcsPerRoll\[\]"[^>]*value="31"/, "RB cutting data is editable inline");
  assert.match(html, /จากการตัด 0.0323/);
  assert.match(html, /name="qty\[\]"[^>]*value="0.03225806452"/, "ratios are shown with 10 significant digits");
  assert.equal(new Set(rows.map((row) => row.id)).size, rows.length, "row ids are unique");
  assert.match(html, /aria-label="ปริมาณต่อ 1 พ่อ"/);
  assert.match(html, /ใช้ร่วมกับสินค้าอื่น 1 รายการ/, "shared sticker shows a warning");
  assert.match(html, /บันทึก BOM/);
  assert.match(html, /data-rf-open="useInOrder"/);
  assert.match(html, /<template data-bom-row>/);
  clean(html);
  // ชุดสีใหม่ของฐานรหัสเดิม → ตั้งต้นจากต้นแบบ
  html = await env.render("p=build&base=DEMO-TP-01&pkg=P&cs=A");
  assert.match(html, /DEMO-TP-01\(P\)-A<\/strong> ยังไม่มีใน item master/);
  assert.match(html, /ตั้งต้นจาก DEMO-TP-01\(P\)-Y/);
  assert.match(html, /value="SE-TP01-OR01-100-18-65"/);
  // ฐานรหัสใหม่ → แถวว่างหนึ่งแถว
  html = await env.render("p=build&base=BRAND-NEW-01&pkg=B&cs=A");
  assert.match(html, /BRAND-NEW-01\(B\)-A<\/strong> ยังไม่มีใน item master/);
  assert.doesNotMatch(html, /data-bom-source>[^<]/, "no source line without a source");
  assert.equal([...html.matchAll(/class="bom-row is-new"/g)].length, 2, "one empty editable row plus the template row");
  // หมวดอื่นที่ขั้นที่ 1: WIP ใหม่ใช้รหัสช่องเดียว ไม่ตั้งต้นจากสินค้า · เส้นยางใหม่เริ่มด้วยแถวสูตรยาง · ชิ้นเดิมใช้ชนิดของมันเอง
  html = await env.render("p=build&code=SE-NEW-77&kind=SE");
  assert.match(html, /<option value="SE" selected>/);
  assert.match(html, /bom-pick-fg is-hidden/);
  assert.match(html, /name="code"[^>]*value="SE-NEW-77"/);
  assert.match(html, /<h3>2\. ชิ้นงาน<\/h3>/);
  assert.match(html, /SE-NEW-77<\/strong> ยังไม่มีใน item master กดบันทึกแล้วระบบจะสร้างชิ้นงานใหม่ให้พร้อม BOM/, "the kind is not repeated (it is in the step-1 select)");
  assert.match(html, /ชั้นแรกต่อ 1 ชิ้น ของชิ้นงาน/);
  assert.match(html, /name="itemKind" value="SE"/);
  assert.match(html, /name="itemUom"[\s\S]*?<option value="pcs" selected>/);
  html = await env.render("p=build&code=SE-TP01-OR01-100-18-65");
  assert.doesNotMatch(html, /data-rf-open="useInOrder"/, "only products go into a production order");
  assert.doesNotMatch(html, /ชนิด WIP/, "an existing item does not repeat its kind under the card");
  html = await env.render("p=build&code=RB-DM09-02-RD01-200-3-20&kind=RB");
  assert.doesNotMatch(html, /name="itemCompound"/, "a new rod takes its compound from its compound line, not a second field");
  assert.match(html, /data-row="r1"[\s\S]*?<option value="CP" selected>[\s\S]*?<option value="kg" selected>/, "the first line of a rod is a compound in kg");
  html = await env.render("p=build&code=SE-TP01-OR01-100-18-65&kind=PT");
  assert.match(html, /<option value="SE" selected>/, "an existing item keeps its own kind whatever the URL says");
  // วัตถุดิบ / สูตรยาง: ไม่มีตารางส่วนประกอบ บันทึกเป็นชิ้นงาน
  html = await env.render("p=build&code=DM07&kind=CP");
  assert.doesNotMatch(html, /data-rf-form="saveBomTree"/);
  assert.match(html, /<h3>2\. สูตรยาง<\/h3>/, "the card names the category once (the kind is in the step-1 select)");
  assert.match(html, /data-rf-form="saveItem"[\s\S]*?name="code" value="DM07"[\s\S]*?name="kind" value="CP"[\s\S]*?<option value="kg" selected>/);
  html = await env.render("p=build&code=P-STK-01");
  assert.match(html, /<option value="PURCHASED" selected>/);
  assert.match(html, /data-rf-open="itemEdit"/);
  assert.doesNotMatch(html, /data-rf-form="saveItem"/, "an existing raw material is edited in the item dialog");
  // บทบาทที่ไม่มีสิทธิ์: ไม่เห็นเมนู และหน้าปฏิเสธ
  env.store.setUser("B05");
  html = await env.render("p=build&code=DEMO-TP-01(P)-Y");
  assert.match(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/);
});

test("the tree form goes through the data-rf-* rules: rows become a nested tree, new items are created, RB patches only when changed", async () => {
  const env = load();
  env.store.setUser("B03");
  await env.submit("p=build&code=DEMO-TP-01(P)-Y", "saveBomTree", {
    code: "DEMO-TP-01(P)-Y", itemName: "ตอปิโดยาง TP-01 แพ็กถุง ชุดสี Y (3 ชิ้น/ชุด)", itemUom: "set", note: "ทดสอบฟอร์ม",
    "rowId[]": ["r1", "r2", "r3", "r4"], "parentId[]": ["", "r1", "", "r3"],
    "childCode[]": ["SE-TP01-OR01-100-18-65", "RB-DM01-02-OR01-202-18-70", "SE-NEW-X1", "RB-DM01-01-OR01-200-0-72"],
    "name[]": ["ลูกตอปิโด TP-01 ส้ม OR01 ยาว 100", "ยางกลมมีรู ตัวตอปิโด ส้ม OR01 Ø70 รู 18", "ชิ้นยางใหม่จากฟอร์ม", "ยางกลมตัน หัวตอปิโด ส้ม OR01 Ø72"],
    "kind[]": ["SE", "RB", "SE", "RB"], "uom[]": ["pcs", "rod", "pcs", "rod"], "qty[]": ["3", "0.04", "1", "0.02"], "scrapPct[]": ["0", "0", "0", "0"], "lineNote[]": ["", "", "", ""],
    "weightG[]": ["49", "1530", "", "1405"], "compound[]": ["", "DM01", "", "DM01"], "cutLengthCm[]": ["", "7", "", "4"], "pcsPerRoll[]": ["", "25", "", "50"], "sePerGr[]": ["", "1", "", "1"], "kgPerRoll[]": ["", "1.53", "", "1.405"],
  });
  assert.deepEqual(env.log.toasts.at(-1)[1], "ok", env.log.toasts.at(-1)[0]);
  const data = env.store.data();
  const A = env.context.MNP_BOM_ACTIONS;
  const fg = A.helpers.approvedBomOf(data, "DEMO-TP-01(P)-Y");
  assert.deepEqual(json(fg.lines.map((line) => [line.childCode, line.qty])), [["SE-TP01-OR01-100-18-65", 3], ["SE-NEW-X1", 1]], "rows without a parent are the product's own lines");
  assert.deepEqual(json(A.helpers.approvedBomOf(data, "SE-TP01-OR01-100-18-65").lines.map((line) => [line.childCode, line.qty])), [["RB-DM01-02-OR01-202-18-70", 0.04]], "child rows become the SE's BOM (new revision)");
  assert.equal(A.helpers.approvedBomOf(data, "SE-TP01-OR01-100-18-65").revision, 3);
  const created = A.helpers.itemOf(data, "SE-NEW-X1");
  assert.equal(created.kind, "SE");
  assert.equal(created.ownerDept, "GR");
  assert.deepEqual(json(A.helpers.approvedBomOf(data, "SE-NEW-X1").lines.map((line) => line.childCode)), ["RB-DM01-01-OR01-200-0-72"]);
  const rb = A.helpers.itemOf(data, "RB-DM01-02-OR01-202-18-70");
  assert.equal(rb.rubber.cutLengthCm, 7, "changed cutting data patched the RB item");
  assert.equal(rb.rubber.pcsPerRoll, 25);
  const rb2 = A.helpers.itemOf(data, "RB-DM01-01-OR01-200-0-72");
  assert.equal(rb2.rubber.cutLengthCm, 4, "unchanged RB data left as is");
  assert.ok(!data.audit.some((entry) => entry.action === "แก้ชิ้นงาน" && entry.detail.startsWith("RB-DM01-01")), "no item edit audit for the unchanged RB");
  assert.equal(env.log.renders, 1);
  // ส่งค่าที่ฟอร์มปัดทศนิยมกลับมา (0.032258 แทน 1/31) โดยแก้แค่หมายเหตุของสินค้า: อัตราส่วนเดิมคงอยู่เต็มความละเอียด
  env.store.setUser("B03");
  const seBefore = A.helpers.approvedBomOf(env.store.data(), "SE-TP01-BK01-140-3-20").lines[0].qty;
  await env.submit("p=build&code=SE-TP01-BK01-140-3-20", "saveBomTree", { code: "SE-TP01-BK01-140-3-20", itemName: "แกนหาง 3 ร่อง ตอปิโด TP-01 ดำ BK01 ยาว 140", itemUom: "pcs", note: "ปัดทศนิยม", "rowId[]": ["r1"], "parentId[]": [""], "childCode[]": ["RB-DM02-02-BK01-225-3-20"], "name[]": ["x"], "kind[]": ["RB"], "uom[]": ["rod"], "qty[]": [String(Math.round(seBefore * 1e6) / 1e6)], "scrapPct[]": ["0"], "lineNote[]": ["แก้หมายเหตุ"], "lineStep[]": ["2"], "weightG[]": ["170"], "compound[]": ["DM02"], "cutLengthCm[]": ["14"], "pcsPerRoll[]": ["14"], "sePerGr[]": ["1"], "kgPerRoll[]": ["0.17"] });
  assert.equal(env.log.toasts.at(-1)[1], "ok", env.log.toasts.at(-1)[0]);
  const seAfter = A.helpers.approvedBomOf(env.store.data(), "SE-TP01-BK01-140-3-20");
  assert.equal(seAfter.lines[0].qty, seBefore, "the stored ratio keeps its full precision");
  assert.equal(seAfter.lines[0].note, "แก้หมายเหตุ");
  assert.equal(seAfter.lines[0].step, 2, "the step column is saved on the BOM line");
  const reopened = await env.render("p=build&code=SE-TP01-BK01-140-3-20");
  assert.match(reopened, /<th title="[^"]+">ขั้นที่<\/th>/, "the column explains itself in a title, not permanent text");
  assert.match(reopened, /name="lineStep\[\]" type="number" value="2"/);
  // ฟอร์มที่ผิด: ไม่มีชื่อสินค้าใหม่ → toast error และไม่บันทึก
  await env.submit("p=build&base=NEW-ZZ&pkg=P&cs=Y", "saveBomTree", { code: "NEW-ZZ(P)-Y", itemName: "", itemUom: "set", "rowId[]": ["r1"], "parentId[]": [""], "childCode[]": ["P-STK-01"], "name[]": [""], "kind[]": ["PURCHASED"], "uom[]": ["pcs"], "qty[]": ["1"], "scrapPct[]": ["0"], "lineNote[]": [""], "weightG[]": [""], "compound[]": [""], "cutLengthCm[]": [""], "pcsPerRoll[]": [""], "sePerGr[]": [""], "kgPerRoll[]": [""] });
  assert.equal(env.log.toasts.at(-1)[1], "error");
  assert.match(env.log.toasts.at(-1)[0], /ระบุชื่อและหน่วย/);
  assert.equal(A.helpers.itemOf(env.store.data(), "NEW-ZZ(P)-Y"), null);
});

test("the items page is read-only history: tree, where-used, revisions, and a link into the builder for planners only", async () => {
  const env = load();
  env.store.setUser("B05"); // หัวหน้า GR
  let html = await env.render("p=items");
  assert.match(html, /ชิ้นงานทั้งหมด/);
  assert.doesNotMatch(html, /เพิ่มชิ้นงานเดี่ยว/, "GR cannot add items");
  html = await env.render("p=items&sel=SE-TP01-OR01-100-18-65");
  assert.match(html, /RB-DM01-02-OR01-202-18-70/, "tree shows the RB children");
  assert.match(html, /0.0323/, "RB per SE from the cutting data");
  assert.match(html, /DEMO-TP-01\(P\)-Y/, "where-used lists the FG parent");
  assert.match(html, /Rev\.2/);
  assert.match(html, /ถูกแทนแล้ว/, "revision history keeps the superseded one");
  assert.doesNotMatch(html, /approveBom|data-rf-open="bomEdit"|แก้ BOM/, "no approval buttons and no editing for GR");
  env.store.setUser("B03");
  html = await env.render("p=items&sel=SE-TP01-OR01-100-18-65");
  assert.match(html, /href="#\/bom\?p=build&amp;code=SE-TP01-OR01-100-18-65"/, "planner gets a link into the builder");
  html = await env.render("p=items&sel=RB-DM03-03-YE03-3000-3-130");
  assert.match(html, /สูตรคอมปาวด์อยู่ที่ RubberFlow/);
  assert.match(html, /ยังไม่ผูกสูตร RubberFlow/);
  assert.match(html, /p=build&amp;code=RB-DM03/, "a rod can get a compound line in the builder");
  html = await env.render("p=items&sel=P-STK-01");
  assert.doesNotMatch(html, /p=build&amp;code=P-STK-01/, "a purchased part has no BOM to build");
  assert.match(html, /วัตถุดิบ · ของซื้อ\/คลัง/, "the item shows its category with its kind");
  env.store.run("importFlat", { items: [{ code: "RB-Z-01-1-1-1", kind: "RB", name: "z", uom: "rod", ownerDept: "RB", legacyCodes: ["RB-Z-01- -1-1-1"], rubber: { compound: "DM01" } }], boms: [], source: "t" });
  html = await env.render("p=items&q=RB-Z-01-%20-1");
  assert.match(html, /เดิม: RB-Z-01- -1-1-1/);
  clean(html);
});

test("dialogs render for their arguments and escape user text", async () => {
  const env = load();
  env.store.setUser("B01");
  env.store.run("createOrder", { pi: `X${XSS}`, customer: XSS, country: "Thailand", orderedAt: Date.now(), whDue: Date.now() + 86400000 });
  await env.render("p=orders");
  const c = env.ctx("p=orders");
  const D = env.context.MNP_BOM_DIALOGS;
  const rb = c.data.jobs.find((job) => job.dept === "RB" && job.status !== "done");
  const cases = [
    ["itemEdit", {}], ["itemEdit", { code: "RB-DM01-02-OR01-202-18-70" }], ["useInOrder", { code: "DEMO-TP-01(P)-Y" }],
    ["compoundLink", {}], ["compoundLink", { code: "DM03" }], ["orderNew", {}], ["orderItemAdd", { orderId: "DEMO-26002" }], ["stockCount", { orderId: "DEMO-26001", itemCode: "PT-00320" }],
    ["jobReport", { jobId: rb.id }], ["jobRubberflow", { jobId: rb.id }],
    ["colorSetEdit", { base: "DEMO-TP-01" }], ["colorSetEdit", { base: "DEMO-TP-01", code: "A" }], ["packageEdit", { base: "DEMO-TP-01" }], ["packageEdit", { base: "DEMO-TP-01", code: "P" }], ["packageEdit", { base: "DEMO-TP-01", code: "X", fromFg: "DEMO-TP-01(P)-Y" }], ["colorEdit", {}], ["colorEdit", { code: "OR01" }],
    ...c.rules.SHEETS.map((sheet) => ["printSheet", { orderId: "DEMO-26001", sheet: sheet.id }]),
  ];
  assert.equal(D.colorSetEdit(c, { base: "NOPE" }), null, "no colour slots → no dialog");
  assert.equal(D.printSheet(c, { orderId: "DEMO-26001", sheet: "NOPE" }), null);
  assert.equal(D.printSheet(c, { orderId: "NOPE", sheet: "RB" }), null);
  // ใบพิมพ์: หัวใบแบบ BOMSHEET + เฉพาะบรรทัดของสถานี + พิมพ์ได้ (.rf-printable)
  const rbSheet = D.printSheet(c, { orderId: "DEMO-26001", sheet: "RB" }).html;
  assert.match(rbSheet, /class="rf-printable bom-sheet"/);
  assert.match(rbSheet, /ลูกค้าสาธิต เบลเยียม[\s\S]*DEMO-26001/);
  assert.match(rbSheet, /RB-DM01-02-OR01-202-18-70/);
  assert.doesNotMatch(rbSheet, /SE-TP01-OR01-100-18-65|PT-00320/, "the RB sheet carries FG rows and rods only");
  assert.match(rbSheet, /data-bom-print/);
  const ask = D.printSheet(c, { orderId: "DEMO-26001", sheet: "ASK" }).html;
  assert.match(ask, /จำนวนที่นับได้/);
  assert.match(ask, /คลังชิ้นยาง \(SE\)/);
  assert.match(ask, /class="bom-sheet-se"/);
  const wip = D.printSheet(c, { orderId: "DEMO-26001", sheet: "WIP-RBGR" }).html;
  assert.match(wip, /ความยาวตัด \(ซม\.\)/);
  assert.match(wip, /<td class="right rf-mono">6\.5<\/td><td class="right rf-mono">31<\/td>/, "cutting data of the rod");
  // กำหนด RB ของใบสาธิต = วันนี้ + 2 วัน (bom-seed.js) คำนวณจากวันที่รัน ไม่ใช่ค่าตายตัว ไม่งั้น test พังเมื่อข้ามวัน
  const rbDue = new Date(Date.now() + 2 * 86400000).setHours(0, 0, 0, 0);
  assert.match(wip, new RegExp(`RB ${c.rules.fmtDate(rbDue).replace(/\./g, "\\.")}`), "department due date per row");
  // เพิ่มชิ้นงานเดี่ยว: แผนกเจ้าของตั้งต้นตามชนิด และเปลี่ยนตามเมื่อเปลี่ยนชนิด (เดิมค้างเป็น ST ทุกชนิด)
  const itemNew = D.itemEdit(c, {});
  assert.match(itemNew.html, /name="ownerDept"[\s\S]*?<option value="ST" selected/, "a new item defaults to PURCHASED → ST");
  assert.match(D.itemEdit(c, { code: "RB-DM01-02-OR01-202-18-70" }).html, /name="ownerDept"[\s\S]*?<option value="RB" selected/, "an existing rod shows its own department");
  const kindSelect = { value: "SE", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const deptSelect = { value: "ST" };
  itemNew.bind({ querySelector: (selector) => ({ 'select[name="kind"]': kindSelect, 'select[name="ownerDept"]': deptSelect })[selector] ?? null });
  kindSelect.handlers.change();
  assert.equal(deptSelect.value, "GR", "choosing SE moves the owner department to GR");
  kindSelect.value = "RB";
  kindSelect.handlers.change();
  assert.equal(deptSelect.value, "RB");
  const existingKind = { value: "PT", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  D.itemEdit(c, { code: "RB-DM01-02-OR01-202-18-70" }).bind({ querySelector: (selector) => ({ 'select[name="kind"]': existingKind })[selector] ?? null });
  assert.equal(existingKind.handlers.change, undefined, "an existing item keeps its saved department when the kind changes");
  const orderNewBuilt = D.orderNew(c, {});
  const orderNew = orderNewBuilt.html;
  assert.match(orderNew, /name="orderType"[\s\S]*?<option value="SA" selected/, "the order type is an explicit choice, defaulting to domestic");
  assert.match(orderNew, /name="autoDue"[^>]*checked/);
  assert.match(orderNew, /ว่าง = ออกเลขอัตโนมัติ/);
  assert.doesNotMatch(orderNew, /name="pi"[^>]*required/, "the PI number is optional now");
  // ค่าเริ่มต้นแสดงเป็นตัวอย่างใต้ช่อง ไม่เขียนลงช่อง (action เป็นผู้เติมและ clamp) · ติ๊กออกแล้วตัวอย่างหาย
  const mk = (extra = {}) => ({ value: "", handlers: {}, dataset: {}, textContent: "", addEventListener(type, handler) { this.handlers[type] = handler; }, ...extra });
  const whInput = mk({ value: "2026-12-15" });
  const orderedInput = mk({ value: "2026-10-30" });
  const auto = mk({ checked: true });
  const previews = c.rules.DUE_DEPTS.map((dept) => mk({ dataset: { bomDuePreview: dept } }));
  const dueInputs = c.rules.DUE_DEPTS.map((dept) => mk({ dataset: { bomDue: dept } }));
  const countryInput = mk({ value: "Thailand" });
  const typeSelect = mk({ value: "SA" });
  const dialogNode = { querySelector: (selector) => ({ "[data-bom-whdue]": whInput, 'input[name="orderedAt"]': orderedInput, "[data-bom-autodue]": auto, "[data-bom-country]": countryInput, "[data-bom-ordertype]": typeSelect })[selector] ?? null, querySelectorAll: (selector) => (selector === "[data-bom-due-preview]" ? previews : selector === "[data-bom-due]" ? dueInputs : []) };
  orderNewBuilt.bind(dialogNode);
  // ประเภทออร์เดอร์เดาจากประเทศจนกว่าผู้ใช้จะเลือกเอง
  countryInput.value = "Belgium";
  countryInput.handlers.input();
  assert.equal(typeSelect.value, "EX", "typing a foreign country flips the guess to export");
  countryInput.value = "Thailand";
  countryInput.handlers.input();
  assert.equal(typeSelect.value, "SA");
  typeSelect.value = "EX";
  typeSelect.handlers.change();
  countryInput.value = "ไทย";
  countryInput.handlers.input();
  assert.equal(typeSelect.value, "EX", "a type chosen by hand is not overwritten by the country guess");
  whInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "PK").textContent, "ว่าง = 14 ธ.ค. 2569");
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 4 ธ.ค. 2569");
  assert.ok(dueInputs.every((input) => input.value === ""), "the date inputs themselves stay empty");
  auto.checked = false;
  auto.handlers.change();
  assert.ok(previews.every((node) => node.textContent === ""), "unticking clears the previews");
  auto.checked = true;
  whInput.value = "2026-11-01";
  whInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 30 ต.ค. 2569", "the preview shows the clamped date (not before the order date)");
  orderedInput.value = "2026-10-20";
  orderedInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 21 ต.ค. 2569", "changing the order date recomputes the clamp");
  const pkInput = dueInputs.find((input) => input.dataset.bomDue === "PK");
  pkInput.value = "2026-10-31";
  pkInput.handlers.input();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "PK").textContent, "", "a typed date hides its preview");
  assert.notEqual(previews.find((node) => node.dataset.bomDuePreview === "GR").textContent, "");
  for (const [name, args] of cases) {
    const built = D[name](c, args);
    assert.ok(built?.html, `${name} renders`);
    clean(built.html);
    assert.match(built.html, /<dialog/);
  }
  assert.equal(D.useInOrder(c, { code: "NOPE" }), null);
  assert.equal(D.stockCount(c, { orderId: "NOPE", itemCode: "PT-00320" }), null);
  assert.match(D.useInOrder(c, { code: "DEMO-TP-01(P)-Y" }).html, /DEMO-26002/, "draft orders are offered");
  const html = await env.render(`p=orders&sel=X${encodeURIComponent(XSS.toUpperCase())}`);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;SCRIPT&gt;|&lt;script&gt;/i);
  // เพิ่มสินค้าแบบ 3 ช่อง: preview บอกว่ารหัสมีอยู่ หรือจะสร้างจากต้นแบบ
  const add = D.orderItemAdd(c, { orderId: "DEMO-26002" });
  assert.match(add.html, /name="base"/);
  assert.match(add.html, /\(B-N\)/);
  const makeNode = (value) => ({ value, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const parts = [makeNode("DEMO-TP-01"), makeNode("P"), makeNode("A")];
  const bodyNode = { textContent: "" };
  const preview = { className: "", querySelector: () => bodyNode };
  add.bind({ querySelector: (selector) => (selector === "[data-bom-preview]" ? preview : null), querySelectorAll: (selector) => (selector === "[data-bom-part]" ? parts : []) }, c);
  assert.match(bodyNode.textContent, /DEMO-TP-01\(P\)-A ยังไม่มีใน item master — จะสร้างจาก BOM ของ DEMO-TP-01\(P\)-Y/);
  parts[2].value = "Y";
  parts[2].handlers.change();
  assert.match(bodyNode.textContent, /DEMO-TP-01\(P\)-Y · .* BOM Rev\.1/);
  assert.equal(preview.className, "rf-callout is-good");
});

test("customers: the list escapes names, a new PI adds its customer, the form adds and edits by name and the PI form offers the list", async () => {
  const env = load();
  env.store.setUser("B03"); // ฝ่ายวางแผน
  env.store.run("createOrder", { pi: "C-XSS-1", customer: XSS, country: "Thailand", orderedAt: Date.now(), whDue: Date.now() + 86400000 });
  let html = await env.render("p=customers");
  clean(html);
  assert.ok(!html.includes(XSS), "the name is escaped");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /ลูกค้าสาธิต เบลเยียม/, "the customers of the demo orders are listed");
  assert.match(html, /data-rf-open="customerEdit"/);
  const D = env.context.MNP_BOM_DIALOGS;
  const c = env.ctx("p=customers");
  const add = D.customerEdit(c, {}).html;
  assert.match(add, /data-rf-form="saveCustomer"/);
  assert.match(add, /data-rf-args="\{&quot;create&quot;:true\}"/, "adding refuses an existing name");
  assert.doesNotMatch(add, /readonly/);
  const edit = D.customerEdit(c, { name: "ลูกค้าสาธิต เบลเยียม" }).html;
  assert.match(edit, /readonly/, "the name is the key of an existing customer");
  assert.doesNotMatch(edit, /create/);
  assert.equal(D.customerEdit(c, { name: "ไม่มีคนนี้" }), null);
  assert.match(D.orderNew(c).html, /<option value="ลูกค้าสาธิต เบลเยียม">Belgium<\/option>/);
  assert.ok(!D.orderNew(c).html.includes(XSS), "the PI form escapes the list too");

  await env.submit("p=customers", "saveCustomer", { name: "ลูกค้าใหม่", country: "Japan", orderType: "EX", note: "" }, { create: true });
  assert.deepEqual(json(env.store.data().customers.find((customer) => customer.name === "ลูกค้าใหม่")), { name: "ลูกค้าใหม่", country: "Japan", orderType: "EX", note: "" });
  assert.deepEqual(env.log.toasts.at(-1), ["ok ลูกค้าใหม่", "ok"]);
  await env.submit("p=customers", "saveCustomer", { name: "ลูกค้าใหม่", country: "Japan", orderType: "EX", note: "" }, { create: true });
  assert.match(env.log.toasts.at(-1)[0], /มีลูกค้า ลูกค้าใหม่ อยู่แล้ว/);
  assert.equal(env.store.data().customers.filter((customer) => customer.name === "ลูกค้าใหม่").length, 1);

  // ผู้ที่ไม่ใช่ฝ่ายวางแผนไม่มีเมนูลูกค้าและเปิดหน้าไม่ได้
  env.store.setUser("B05");
  html = await env.render("p=customers");
  assert.match(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/);
});

test("forms go through the data-rf-* rules: a new order is created with dates converted, a bad form shows a toast and keeps the state", async () => {
  const env = load();
  env.store.setUser("B03");
  // เปิดใบโดยไม่กรอกเลข PI และติ๊กเติมกำหนดเสร็จจาก lead time (ผ่าน transform ของฟอร์ม)
  await env.submit("p=orders", "createOrder", { pi: "", customer: "อัตโนมัติ", country: "Thailand", orderedAt: "2026-10-30", whDue: "2026-12-15", autoDue: "1" });
  const autoOrder = env.store.data().orders.find((order) => order.customer === "อัตโนมัติ");
  assert.equal(autoOrder.id, "261030-26001");
  assert.equal(new Date(autoOrder.due.PK).getDate(), 14);
  assert.deepEqual(json(autoOrder.dueDefaults), ["RB", "GR", "PT", "BG", "ST", "PK"]);
  assert.match(await env.render(`p=orders&sel=${autoOrder.id}`), /title="ค่าเริ่มต้นจาก lead time"><b>PK<\/b> 14 ธ\.ค\. 2569\*/);
  await env.submit("p=orders", "createOrder", { pi: "PI-TEST-1", customer: "ลูกค้าทดสอบ", country: "Belgium", orderedAt: "2026-10-01", whDue: "2026-12-01", "due.RB": "2026-10-20", "due.PK": "" });
  const order = env.store.data().orders.find((entry) => entry.id === "PI-TEST-1");
  assert.ok(order, "order created from the form");
  assert.equal(order.orderType, "EX");
  assert.equal(new Date(order.due.RB).getDate(), 20);
  assert.equal(order.due.PK, undefined, "empty department dates are dropped");
  assert.deepEqual(env.log.toasts.at(-1), ["ok PI-TEST-1", "ok"]);
  await env.submit("p=orders", "createOrder", { pi: "PI-TEST-1", customer: "x", country: "Belgium", orderedAt: "2026-10-01", whDue: "2026-12-01" });
  assert.equal(env.log.toasts.at(-1)[1], "error");
  assert.match(env.log.toasts.at(-1)[0], /อยู่แล้ว/);
  assert.equal(env.log.renders, 2, "failed form does not re-render (two successful submits re-rendered)");
  await env.submit("p=items", "saveItem", { code: "P-NEW-01", kind: "PURCHASED", name: "ของใหม่", ownerDept: "ST", uom: "pcs", weightG: "", "rubber.compound": "DM01" }, { create: true });
  assert.equal(env.store.data().items.find((entry) => entry.code === "P-NEW-01").rubber, null);
  env.store.setUser("B05");
  await env.submit("p=items", "saveItem", { code: "P-NEW-02", kind: "PURCHASED", name: "x", uom: "pcs" }, { create: true });
  assert.match(env.log.toasts.at(-1)[0], /ฝ่ายวางแผนหรือผู้จัดการ/);
});

test("an RB job creates a RubberFlow work order through the RubberFlow store and the job keeps the WO number", async () => {
  const env = load();
  env.store.setUser("B04");
  env.rf.store.load();
  await env.render("p=jobs");
  const c = env.ctx("p=jobs&dept=RB");
  const job = c.data.jobs.find((entry) => entry.dept === "RB" && entry.itemCode === "RB-DM02-02-BK01-225-3-20");
  const html = await env.render("p=jobs&dept=RB");
  assert.match(html, /สร้าง WO ใน RubberFlow/);
  const built = env.context.MNP_BOM_DIALOGS.jobRubberflow(c, { jobId: job.id });
  assert.match(built.html, /DM02 → RC-NBR-OR02/);
  assert.match(built.html, /data-bom-rf-create/);
  const button = { ...env.root, handlers: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const dialog = { ...env.root, querySelector: (selector) => (selector === "[data-bom-rf-create]" ? button : null), close() { this.closed = true; } };
  built.bind(dialog, c);
  const rfOrdersBefore = env.rf.store.data().orders.length;
  button.handlers.click({ currentTarget: button });
  assert.equal(env.rf.store.data().orders.length, rfOrdersBefore + 1);
  const wo = env.rf.store.data().orders[0];
  assert.equal(wo.recipeId, "RC-NBR-OR02");
  assert.equal(wo.customerPo, "DEMO-26001");
  assert.ok(wo.targetQty > 0);
  const linked = env.store.data().jobs.find((entry) => entry.id === job.id);
  assert.equal(linked.externalRef.woId, wo.id);
  assert.ok(dialog.closed);
  const again = env.context.MNP_BOM_DIALOGS.jobRubberflow(env.ctx("p=jobs&dept=RB"), { jobId: job.id });
  assert.match(again.html, /ไว้แล้ว/);
  assert.doesNotMatch(again.html, /data-bom-rf-create/, "no second WO for a linked job");
  const unlinked = c.data.jobs.find((entry) => entry.itemCode === "RB-DM03-03-YE03-3000-3-130");
  const noRecipe = env.context.MNP_BOM_DIALOGS.jobRubberflow(c, { jobId: unlinked.id });
  assert.match(noRecipe.html, /ยังไม่ผูกกับสูตร PHR/);
  assert.doesNotMatch(noRecipe.html, /data-bom-rf-create/);
});

test("the import page parses pasted TSV, reports before saving and the orders page exports CSV with the BOMSHEET columns", async () => {
  const env = load();
  env.store.setUser("B03");
  const paste = { ...env.root, value: "" };
  const report = { ...env.root, innerHTML: "", querySelector: () => null };
  const check = { ...env.root, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const rootNode = { ...env.root, querySelector: (selector) => ({ "[data-bom-paste]": paste, "[data-bom-report]": report, "[data-bom-check]": check, "[data-bom-group]": { value: "TOY" }, "[data-bom-source]": { value: "ทดสอบ.tsv" } })[selector] ?? null, querySelectorAll: () => [] };
  const page = env.context.MNP_BOM_PAGES.import(env.ctx("p=import"));
  clean(page.html);
  page.bind(rootNode, env.ctx("p=import"));
  paste.value = "garbage";
  check.handlers.click();
  assert.match(report.innerHTML, /ไม่พบแถวหัวคอลัมน์/);
  paste.value = ["ITEM\tCODE\tNAME\tรหัสแผนก\tแผนกผู้ผลิต\tจำนวนที่ใช้ต่อชุด\tหน่วยนับ", "T-01(P)-Y\tT-01\tสินค้า T\tPK\tPK\t-\tชุด", "T-01(P)-Y\tP-STK-01\tสติ๊กเกอร์\tST\tPK-ST\t2\tชิ้น/pcs"].join("\n");
  check.handlers.click();
  assert.match(report.innerHTML, /อ่านได้ 2 บรรทัด/);
  assert.match(report.innerHTML, /data-bom-import/);
  clean(report.innerHTML);
  // เลือกไฟล์ .xlsm: เปิดชีต BOMSHEET อ่านลงช่องวาง ตั้งชื่อแหล่งข้อมูล แสดงตัวเลือกชีต และตรวจสอบทันที
  const sheetField = { hidden: true };
  const sheetSelect = { ...env.root, handlers: {}, innerHTML: "", value: "" };
  const source = { value: "DATA BOM.xlsx" };
  const fileInput = { ...env.root, handlers: {}, files: [] };
  const xlsxRoot = { ...env.root, querySelector: (selector) => ({ "[data-bom-paste]": paste, "[data-bom-report]": report, "[data-bom-check]": { ...check, click: () => check.handlers.click() }, "[data-bom-group]": { value: "TOY" }, "[data-bom-source]": source, "[data-bom-file]": fileInput, "[data-bom-sheet-field]": sheetField, "[data-bom-sheet]": sheetSelect })[selector] ?? null, querySelectorAll: () => [] };
  env.context.MNP_BOM_PAGES.import(env.ctx("p=import")).bind(xlsxRoot, env.ctx("p=import"));
  const sheetXml = (rows) => `<worksheet><sheetData>${rows.map((cells, r) => `<row r="${r + 1}">${cells.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${value}</t></is></c>`).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const workbook = makeZip([ // ไม่บีบอัด: context ของเทสต์ไม่มี Blob/DecompressionStream
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="MAIN" r:id="rId1"/><sheet name="BOMSHEET" r:id="rId2"/><sheet name="EPLAN" state="hidden" r:id="rId3"/></sheets></workbook>', store: true },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>', store: true },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml([["PI"]]), store: true },
    { name: "xl/worksheets/sheet2.xml", data: sheetXml([["ITEM", "CODE", "NAME", "รหัสแผนก", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "หน่วยนับ"], ["X-01(P)-Y", "X-01", "สินค้า X", "PK", "PK", "-", "ชุด"], ["X-01(P)-Y", "P-STK-09", "สติ๊กเกอร์", "ST", "PK-ST", "1", "ใบ"]]), store: true },
    { name: "xl/worksheets/sheet3.xml", data: sheetXml([]), store: true },
  ]);
  fileInput.files = [{ name: "Material_X 26001.xlsm", arrayBuffer: async () => workbook }];
  await fileInput.handlers.change();
  assert.equal(sheetField.hidden, false, "the sheet chooser appears for a workbook");
  assert.match(sheetSelect.innerHTML, /<option value="BOMSHEET" selected>BOMSHEET<\/option>/);
  assert.match(sheetSelect.innerHTML, /EPLAN \(ซ่อน\)/);
  assert.equal(source.value, "Material_X 26001.xlsm");
  assert.match(paste.value, /^ITEM\tCODE\tNAME/);
  assert.equal(paste.readOnly, true, "a sheet read from a file is shown as a preview, the check reads the kept text");
  assert.match(report.innerHTML, /อ่านได้ 2 บรรทัด/, "the sheet is checked right away");
  assert.doesNotMatch(report.innerHTML, /หน่วยที่แปลงไม่ได้/);
  sheetSelect.value = "MAIN";
  await sheetSelect.handlers.change();
  assert.match(report.innerHTML, /ไม่พบแถวหัวคอลัมน์/, "another sheet is read and checked when chosen");
  // เลือกไฟล์ A (อ่านช้า) แล้วเลือก B ก่อน A เสร็จ: ผลของ A ที่มาทีหลังต้องไม่ทับ B
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  fileInput.files = [{ name: "slow-A.xlsm", arrayBuffer: () => slow }];
  const pendingA = fileInput.handlers.change();
  fileInput.files = [{ name: "fast-B.xlsm", arrayBuffer: async () => workbook }];
  await fileInput.handlers.change();
  const afterB = paste.value;
  releaseSlow(new ArrayBuffer(10)); // A กลับมาเป็นไฟล์เสีย หลัง B เสร็จแล้ว
  await pendingA;
  assert.equal(source.value, "fast-B.xlsm", "the older pick does not rename the source");
  assert.equal(paste.value, afterB);
  assert.equal(sheetField.hidden, false);
  assert.match(report.innerHTML, /อ่านได้ 2 บรรทัด/, "the older pick's error does not replace the newer report");
  // ไฟล์เก่าที่อ่านสำเร็จทีหลัง: รายการชีตยังเป็นของไฟล์ใหม่
  let releaseOld;
  const oldBook = makeZip([
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="OLD" r:id="rId1"/></sheets></workbook>', store: true },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/o.xml"/></Relationships>', store: true },
    { name: "xl/worksheets/o.xml", data: sheetXml([["OLD"]]), store: true },
  ]);
  fileInput.files = [{ name: "old.xlsm", arrayBuffer: () => new Promise((resolve) => { releaseOld = resolve; }) }];
  const pendingOld = fileInput.handlers.change();
  fileInput.files = [{ name: "fast-B.xlsm", arrayBuffer: async () => workbook }];
  await fileInput.handlers.change();
  releaseOld(oldBook);
  await pendingOld;
  assert.doesNotMatch(sheetSelect.innerHTML, /OLD/, "a late successful read of the older file does not replace the sheet list");
  assert.doesNotMatch(paste.value, /^OLD/);
  // ค่าที่อยู่เกินคอลัมน์ 256 (IW): ข้ามและเตือนในรายงานเดียวกับปุ่มนำเข้า (ไม่ต่อ innerHTML ทีหลัง ซึ่งทำให้ปุ่มเสีย handler)
  const wideBook = makeZip([
    { name: "xl/workbook.xml", data: '<workbook><sheets><sheet name="BOMSHEET" r:id="rId1"/></sheets></workbook>', store: true },
    { name: "xl/_rels/workbook.xml.rels", data: '<Relationships><Relationship Id="rId1" Target="worksheets/w.xml"/></Relationships>', store: true },
    { name: "xl/worksheets/w.xml", data: sheetXml([["ITEM", "CODE", "NAME", "รหัสแผนก", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "หน่วยนับ"], ["X-01(P)-Y", "X-01", "สินค้า X", "PK", "PK", "-", "ชุด"], ["X-01(P)-Y", "P-STK-09", "สติ๊กเกอร์", "ST", "PK-ST", "1", "ใบ"]]).replace("</row>", '<c r="IW1" t="inlineStr"><is><t>far</t></is></c></row>'), store: true },
  ]);
  fileInput.files = [{ name: "wide.xlsx", arrayBuffer: async () => wideBook }];
  await fileInput.handlers.change();
  assert.match(report.innerHTML, /ข้ามค่า 1 ช่องที่อยู่เกินคอลัมน์ที่ 256[\s\S]*data-bom-import/, "the note is part of the check report that holds the import button");
  check.handlers.click();
  assert.match(report.innerHTML, /ข้ามค่า 1 ช่อง/, "checking again keeps the note of the sheet");
  paste.handlers.input();
  check.handlers.click();
  assert.doesNotMatch(report.innerHTML, /ข้ามค่า/, "editing the paste box drops the note");
  assert.doesNotMatch(fs.readFileSync("modules/bom-pages.js", "utf8"), /report\.innerHTML \+=/, "the report is never appended to after the import button is bound");
  // เปลี่ยนไปไฟล์ข้อความ: ล้างชีตและรายงานเก่า ตั้งชื่อแหล่งข้อมูลใหม่
  fileInput.files = [{ name: "rows.tsv" }];
  await fileInput.handlers.change();
  assert.equal(sheetField.hidden, true);
  assert.equal(report.innerHTML, "");
  assert.equal(source.value, "rows.tsv");
  fileInput.files = [{ name: "broken.xlsx", arrayBuffer: async () => new ArrayBuffer(10) }];
  await fileInput.handlers.change();
  assert.equal(sheetField.hidden, true);
  assert.match(report.innerHTML, /ไม่ใช่ \.xlsx/);
  const c = env.ctx("p=orders&sel=DEMO-26001");
  const built = env.context.MNP_BOM_PAGES.orders(c);
  assert.match(built.html, /ส่งออก CSV ใบคำนวณ/);
  assert.match(built.html, /bom-surplus">-3</, "10 boxes counted against 7 needed by both products shows a surplus, once per item");
  assert.match(built.html, /PT-00320[\s\S]*?<td class="right rf-mono">24<\/td>[\s\S]*?<td class="right rf-mono">10<\/td><td class="right rf-mono">14<\/td>/, "stock is subtracted per item (24 needed, 10 counted → 14)");
  assert.match(built.html, /ต้องผลิต\/สั่งซื้อ \(รหัสนี้ทั้งใบ\)/);
  assert.doesNotMatch(built.html, /data-rf-open="stockCount"/, "a released order cannot be counted any more (jobs would not follow)");
  assert.match(env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26002")).html, /data-rf-open="stockCount"/, "a draft order can be counted");
  assert.match(built.html, /p=build&amp;code=DEMO-TP-01/, "each ordered product links into the builder");
  assert.match(built.html, /p=product&amp;code=DEMO-TP-01%28P%29-Y&amp;qty=80/, "each ordered product links to the per-department view with its quantity");
  assert.match(built.html, /data-bom-sheet[\s\S]*?<option value="RB"[\s\S]*?data-rf-open="printSheet" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26001&quot;,&quot;sheet&quot;:&quot;RB&quot;\}"/, "the sheet picker and its open button");
  // เลือกใบอื่นแล้วปุ่มเปิดชี้ไปใบนั้น (args ถูกอ่านตอนคลิก)
  const openButton = { ...env.root, dataset: { rfOpen: "printSheet", rfArgs: JSON.stringify({ orderId: "DEMO-26001", sheet: "RB" }) } };
  const picker = { ...env.root, value: "ASK", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, parentElement: { querySelector: () => openButton } };
  built.bind({ ...env.root, querySelectorAll: (selector) => (selector === "[data-bom-sheet]" ? [picker] : []) }, c);
  picker.handlers.change();
  assert.deepEqual(JSON.parse(openButton.dataset.rfArgs), { orderId: "DEMO-26001", sheet: "ASK" });
  const csvButton = { ...env.root, dataset: { bomCsv: "bomsheet", bomOrder: "DEMO-26001" }, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  built.bind({ ...env.root, querySelectorAll: (selector) => (selector === "[data-bom-csv]" ? [csvButton] : []) }, c);
  csvButton.handlers.click();
  const tabs = env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26001&tab=req")).html;
  assert.match(tabs, /ต้องการรวม/);
  assert.match(tabs, /P-BOX-01[\s\S]*?<td class="right rf-mono">0<div class="small bom-surplus">เกิน 3<\/div>/, "the summary tab shows what to make (never negative) and the surplus apart");
  assert.doesNotMatch(tabs, /DEMO-TP-01\(P\)-Y<\/span><\/td>/, "the FG itself is not a requirement line");
  clean(tabs);
  const jobsTab = env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26001&tab=jobs")).html;
  clean(jobsTab);
  assert.match(env.context.MNP_BOM_PAGES.jobs(env.ctx("p=jobs&dept=PT&st=all")).html, /14 ชิ้น<div class="small muted"[^>]*>ต้องการ 24 · คลัง 10<\/div>/, "a job shows the gross need and the counted stock behind its planned quantity");
});

test("the mobile count page lists draft orders, shows SE + RB of the stock-check rule (or every part), and saves many counts in one submit", async () => {
  const env = load();
  env.store.setUser("B08"); // คลัง
  let html = await env.render("p=count");
  clean(html);
  assert.match(html, /href="#\/bom\?p=count&amp;order=DEMO-26002"/, "the exploded draft order can be picked");
  assert.doesNotMatch(html, /order=DEMO-26001/, "a released order is not offered");
  html = await env.render("p=count&order=DEMO-26002");
  clean(html);
  assert.match(html, /data-rf-form="setStockCounts"/);
  assert.match(html, /name="itemCode\[\]" value="SE-HL24-YE03-400-19-30"/);
  assert.match(html, /name="itemCode\[\]" value="RB-DM02-02-YE03-204-19-34"/);
  assert.doesNotMatch(html, /name="itemCode\[\]" value="(BG-0092|P-BOX-01|DEMO-HL-24\(B\)-A)"/, "only SE and RB by default, never the FG");
  assert.match(html, /ต้องใช้ 576 ชิ้น/, "192 sets × 3 sleeves");
  assert.match(html, /inputmode="decimal"/);
  assert.match(html, /นับแล้ว 0\/2/);
  html = await env.render("p=count&order=DEMO-26002&all=1");
  assert.match(html, /name="itemCode\[\]" value="P-BOX-01"/);
  assert.doesNotMatch(html, /name="itemCode\[\]" value="DEMO-HL-24\(B\)-A"/);
  await env.submit("p=count&order=DEMO-26002", "setStockCounts", { "itemCode[]": ["SE-HL24-YE03-400-19-30", "RB-DM02-02-YE03-204-19-34"], "qty[]": ["100", ""] }, { orderId: "DEMO-26002" });
  const order = env.store.data().orders.find((entry) => entry.id === "DEMO-26002");
  assert.deepEqual(json(order.stockCounts), { "SE-HL24-YE03-400-19-30": 100 }, "an empty field leaves the item uncounted");
  assert.match(await env.render("p=count&order=DEMO-26002"), /นับแล้ว 1\/2[\s\S]*value="100"/);
  await env.submit("p=count&order=DEMO-26002", "setStockCounts", { "itemCode[]": ["SE-HL24-YE03-400-19-30"], "qty[]": [""] }, { orderId: "DEMO-26002" });
  assert.match(env.log.toasts.at(-1)[0], /ยังไม่ได้กรอก/);
  // บันทึกซ้ำด้วยยอดเท่าเดิมไม่เขียน audit
  const auditBefore = env.store.data().audit.length;
  await env.submit("p=count&order=DEMO-26002", "setStockCounts", { "itemCode[]": ["SE-HL24-YE03-400-19-30"], "qty[]": ["100"] }, { orderId: "DEMO-26002" });
  assert.equal(env.store.data().audit.length, auditBefore);
  // ใบที่ถูกแก้จนยังไม่ระเบิดใหม่ (explosion = null): กลับหน้าเลือกใบ ไม่พัง
  env.store.setUser("B03");
  env.store.run("removeOrderItem", { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A" });
  env.store.setUser("B08");
  html = await env.render("p=count&order=DEMO-26002");
  clean(html);
  assert.match(html, /ยังไม่ระเบิด BOM/);
  assert.doesNotMatch(html, /data-rf-form="setStockCounts"/);
  clean(await env.render("p=count&order=DEMO-26002&all=1"));
  // แผนกอื่นไม่เห็นเมนู
  env.store.setUser("B05");
  assert.match(await env.render("p=count"), /ไม่มีสิทธิ์เข้าถึงหน้านี้/);
});

test("leaving the count page with typed counts stops the link at once and goes only after the dialog confirms", async () => {
  const env = load();
  env.store.setUser("B08");
  const handlers = {};
  const form = { addEventListener: (type, handler) => { handlers.input = handler; } };
  const link = { getAttribute: (name) => (name === "href" ? "#/bom?p=count" : null), addEventListener: (type, handler) => { handlers.click = handler; } };
  env.context.MNP_BOM_PAGES.count(env.ctx("p=count&order=DEMO-26002")).bind({ querySelector: (selector) => (selector === ".bom-count-form" ? form : null), querySelectorAll: (selector) => (selector === "[data-bom-count-nav]" ? [link] : []) });
  const click = async () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; await handlers.click(event); return event.prevented; };
  env.log.hash = "#/bom?p=count&order=DEMO-26002";
  assert.equal(await click(), false, "nothing typed: the link opens normally");
  assert.equal(env.log.confirms.length, 0);
  handlers.input();
  env.log.confirmAnswer = false;
  assert.equal(await click(), true);
  assert.equal(env.log.hash, "#/bom?p=count&order=DEMO-26002", "a cancelled dialog stays on the page");
  assert.equal(env.log.confirms.at(-1).title, "มียอดที่ยังไม่บันทึก ออกจากหน้านี้?");
  env.log.confirmAnswer = true;
  assert.equal(await click(), true);
  assert.equal(env.log.hash, "#/bom?p=count");
});

test("a data-rf-action button with data-rf-confirm runs only after the dialog confirms, and names the action on the confirm button", async () => {
  const env = load();
  env.store.setUser("B03");
  const button = { ...env.root, dataset: { rfAction: "removeOrderItem", rfArgs: JSON.stringify({ orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A" }), rfConfirm: "ลบ DEMO-HL-24(B)-A ออกจากใบ DEMO-26002?" }, textContent: "ลบ", getAttribute: (name) => (name === "aria-label" ? "ลบ DEMO-HL-24(B)-A ออกจากใบ" : null), handlers: {} };
  button.addEventListener = (type, handler) => { button.handlers[type] = handler; };
  env.fakes["[data-rf-action]"] = [button];
  await env.render("p=orders&sel=DEMO-26002");
  const items = () => env.store.data().orders.find((entry) => entry.id === "DEMO-26002").items.length;
  const before = items();
  env.log.confirmAnswer = false;
  await button.handlers.click();
  assert.equal(items(), before, "a cancelled dialog runs nothing");
  assert.deepEqual(json(env.log.confirms.at(-1)), { title: "ลบ DEMO-HL-24(B)-A ออกจากใบ DEMO-26002?", message: "", confirmLabel: "ลบ DEMO-HL-24(B)-A ออกจากใบ", danger: true });
  env.log.confirmAnswer = true;
  await button.handlers.click();
  assert.equal(items(), before - 1);
});

test("the colour-set / package page shows learned and defined sets per base, the variant matrix creates products through the definitions, and the forms go through data-rf-*", async () => {
  const env = load();
  env.store.setUser("B03"); // ฝ่ายวางแผน
  let html = await env.render("p=variants");
  assert.match(html, /ฐานรหัสที่มี BOM/);
  assert.match(html, /DEMO-TP-01[\s\S]*?A: RD01 BK01 RD01/, "defined sets are summarised per base");
  assert.match(html, /สี \(แม่สี \+ เฉด\)/);
  assert.match(html, /PU01[\s\S]*?\(ยังไม่ลงทะเบียน\)/, "standard masters appear even when not registered");
  clean(html);
  html = await env.render("p=variants&base=DEMO-TP-01");
  clean(html);
  assert.match(html, /<th class="center">ชุด A<\/th><th class="center">ชุด Y<\/th>/, "defined A and learned-then-saved Y");
  assert.match(html, /SE-TP01-\*-100-18-65/);
  assert.match(html, /data-color="RD" title="แดง">RD01</);
  assert.match(html, /data-rf-open="colorSetEdit"/);
  assert.match(html, /data-rf-action="removeColorSet"/);
  assert.match(html, /ถุงพลาสติก \+ ลังรวม 40 ชุด/);
  assert.match(html, /แพ็กเกจ \\ ชุดสี/);
  assert.match(html, /href="#\/bom\?p=product&amp;code=DEMO-TP-01%28P%29-Y"/, "existing variant links to the per-department view");
  assert.match(html, /data-rf-action="createVariant" data-rf-args="\{&quot;base&quot;:&quot;DEMO-TP-01&quot;,&quot;pkg&quot;:&quot;B&quot;,&quot;colorSet&quot;:&quot;A&quot;\}"/, "missing variants get a create button");
  // สร้างรุ่นจากตาราง → ชิ้น SE/RB สีใหม่เกิดขึ้นและหน้าเปลี่ยนเป็นลิงก์
  const result = env.store.run("createVariant", { base: "DEMO-TP-01", pkg: "B", colorSet: "A" });
  assert.equal(result.ok, true, String(result.error?.message ?? ""));
  html = await env.render("p=variants&base=DEMO-TP-01");
  assert.match(html, /href="#\/bom\?p=product&amp;code=DEMO-TP-01%28B%29-A"/);
  assert.ok(env.store.data().items.some((item) => item.code === "SE-TP01-RD01-100-18-65"), "a red SE item was created by the colour set");
  assert.ok(env.store.data().items.some((item) => item.code === "RB-DM01-02-RD01-202-18-70"), "and its red rod");
  // ฟอร์มชุดสีผ่านกติกา data-rf-*: slotKey[] + slotColor[] → slots
  await env.submit("p=variants&base=DEMO-TP-01", "saveColorSet", { code: "c", name: "ฟ้า", "slotKey[]": ["SE-TP01-*-100-18-65", "SE-TP01-*-140-3-20", "SE-TP01-*-75-3-30"], "slotColor[]": ["BL02", "", "BL02"] }, { base: "DEMO-TP-01" });
  const setC = env.store.data().colorSets.find((set) => set.base === "DEMO-TP-01" && set.code === "C");
  assert.deepEqual(json(setC.slots.map((slot) => slot.color)), ["BL02", "", "BL02"]);
  await env.submit("p=variants&base=DEMO-TP-01", "savePackage", { code: "K", name: "กล่องคู่", "childCode[]": ["P-BOX-01", "", ""], "qty[]": ["0.5", "", ""] }, { base: "DEMO-TP-01" });
  assert.deepEqual(json(env.store.data().packages.find((entry) => entry.base === "DEMO-TP-01" && entry.code === "K").lines), [{ childCode: "P-BOX-01", qty: 0.5 }]);
  await env.submit("p=variants", "saveColor", { code: "gn05", name: "เขียวใบไม้" });
  assert.equal(env.store.data().colors.find((color) => color.code === "GN05").name, "เขียวใบไม้");
  // หัวหน้าแผนกอ่านได้ ไม่มีปุ่มแก้
  env.store.setUser("B05");
  html = await env.render("p=variants&base=DEMO-TP-01");
  assert.doesNotMatch(html, /data-rf-open="colorSetEdit"|data-rf-action="createVariant"|data-rf-open="colorEdit"/);
  assert.match(html, /ชุด A/);
  html = await env.render("p=variants&base=NOPE-99");
  assert.match(html, /ไม่มีฐานรหัส/);
  clean(html);
});

test("the per-department view explodes one product × quantity into cards from RB to PK, links back, and copes with unknown or BOM-less products", async () => {
  const env = load();
  env.store.setUser("B05"); // หัวหน้า GR อ่านได้
  let html = await env.render("p=product");
  assert.match(html, /แสดงงานทุกแผนก/);
  assert.match(html, /bom-product-base-list/);
  assert.match(html, /สินค้าที่มี BOM/);
  assert.match(html, /p=product&amp;code=DEMO-TP-01%28P%29-Y/);
  clean(html);
  html = await env.render("p=product&code=DEMO-TP-01(P)-Y&qty=80");
  clean(html);
  const cardTitles = [...html.matchAll(/<h3>([A-Z]{2}) <span class="muted">/g)].map((match) => match[1]);
  assert.deepEqual(cardTitles, ["ST", "RB", "GR", "PT", "PK"], "cards follow the company flow and skip departments without work (no BG in this product)");
  assert.match(html, /ต้องรีด/);
  assert.match(html, /RB-DM01-02-OR01-202-18-70[\s\S]*?<strong>7\.74<\/strong>/, "80 sets × 3 SE / 31 pieces per rod — the BOMSHEET number, before any stock");
  assert.match(html, /ตัด 6\.5 ซม\. · 31 ชิ้น\/เส้น · 1 SE ต่อ GR/, "GR sees the cutting data of the rod it cuts");
  assert.match(html, /ผูก RubberFlow แล้ว/);
  assert.match(html, /สินค้าสำเร็จรูป<\/span>/, "the FG row sits in the PK card");
  assert.match(html, /<h3>DEMO-TP-01\(P\)-Y <span class="muted">[^<]+<\/span> × 80 ชุด<\/h3>/);
  assert.match(html, /ลึกสุด 2 ชั้น/);
  assert.doesNotMatch(html, /<dt>สินค้า<\/dt>|<dt>จำนวนที่คิด<\/dt>|รายการ<\/span><\/h3>/, "the product, quantity and row counts are shown once (title, picker, tables)");
  assert.doesNotMatch(html, /data-rf-open="useInOrder"/, "a department head cannot push the product into an order");
  assert.doesNotMatch(html, /p=build/, "no builder links for a department head");
  env.store.setUser("B03"); // ฝ่ายวางแผน
  html = await env.render("p=product&base=DEMO-TP-01&pkg=P&cs=Y&qty=10");
  assert.match(html, /DEMO-TP-01\(P\)-Y <span class="muted">[^<]+<\/span> × 10 ชุด/, "the three picker fields compose the code like sheet ;}o");
  assert.match(html, /data-rf-open="useInOrder"/);
  assert.match(html, /p=build&amp;code=DEMO-TP-01/);
  assert.match(html, /<strong>0\.9677<\/strong>/, "quantities scale with the order quantity");
  html = await env.render("p=product&code=DEMO-BL-60(K)-Z");
  assert.match(html, /ยังไม่มี BOM/);
  assert.doesNotMatch(html, /ต้องรีด/);
  clean(html);
  html = await env.render(`p=product&code=${encodeURIComponent(XSS)}&qty=abc`);
  assert.match(html, /ไม่พบสินค้า/);
  assert.doesNotMatch(html, /<script>/);
  clean(html);
  // ลิงก์จากหน้าค้นหาชิ้นงาน
  html = await env.render("p=items&sel=DEMO-TP-01(P)-Y");
  assert.match(html, /p=product&amp;code=DEMO-TP-01%28P%29-Y">งานทุกแผนก/);
});

test("the sidebar sub-menu counts open jobs of the user's department; reset rebuilds the demo", async () => {
  const env = load();
  env.store.setUser("B05");
  await env.render("p=jobs");
  const sub = env.module.nav[0].subnav("bom");
  assert.match(sub, /งานค้างของแผนก">\d+</);
  assert.doesNotMatch(sub, /รออนุมัติ/);
  env.store.setUser("B01");
  await env.render("p=jobs");
  assert.doesNotMatch(env.module.nav[0].subnav("bom"), /งานค้างของแผนก/, "bosses see no personal job count");
  env.store.run("createOrder", { pi: "TMP", customer: "x", country: "Thailand", orderedAt: Date.now(), whDue: Date.now() + 1 });
  env.store.reset();
  assert.ok(!env.store.data().orders.some((order) => order.id === "TMP"));
  assert.ok(env.storage.has("mnp-bom-v1"));
});

test("the structure page rolls up cost and minutes per department, edits steps and costs through data-rf-*, and is read-only for departments", async () => {
  const env = load();
  env.store.setUser("B03"); // ฝ่ายวางแผน
  let html = await env.render("p=structure");
  clean(html);
  assert.match(html, /DEMO-HL-24\(B\)-A[\s\S]*?ดูโครงสร้าง/, "the list shows finished goods");
  assert.match(html, /ไม่ครบ/, "the torpedo misses a part cost in the demo");
  // มุมมองลำดับผลิต (ค่าเริ่มต้น): ขั้นแรกอยู่บน สายป้อนอยู่เหนือพ่อ วัตถุดิบอยู่ที่ขั้นที่ routing ระบุ สินค้าอยู่ล่างสุด
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y&qty=80");
  clean(html);
  assert.match(html, /ต้นทุนยังไม่ครบ: ไม่มีราคาของ <strong>XP-00001<\/strong>/);
  assert.match(html, /<li class="bom-flow-input"[^>]*>[\s\S]*?P-PEL-BK<\/[^>]+> <span class="bom-flow-input-name">เม็ดพลาสติก PE-LD สีดำ<\/span>/, "a material row shows its name next to the code, not only in a tooltip");
  const fedRows = html.match(/<li class="bom-flow-input is-fed"[^>]*>[\s\S]*?<\/li>/g) ?? [];
  assert.ok(fedRows.length > 0 && fedRows.every((row) => !row.includes("bom-flow-input-name")), "a row fed from a lane above keeps only its code (the lane card shows the name)");
  assert.match(html, /class="filter active" href="[^"]*view=flow" aria-current="page">ลำดับผลิต/);
  const order = (...needles) => needles.map((needle) => html.indexOf(needle));
  const [rbStep, seCard, asm, sticker, pack, fgCard] = order("RB-01", "<span class=\"rf-mono\">SE-TP01-OR01-100-18-65</span><div class=\"small\">", "PK-01", "P-STK-01", "PK-03", "<span class=\"rf-mono\">DEMO-TP-01(P)-Y</span><div class=\"small\">");
  assert.ok(rbStep > 0 && rbStep < seCard && seCard < asm && asm < sticker && sticker < pack && pack < fgCard, "first steps come first, the product card is last");
  assert.match(html, /คอมปาวด์ <span class="rf-mono">DM01<\/span>/, "a rod shows its compound as the first input");
  assert.match(html, /SE-TP01-OR01-100-18-65<\/span> <span class="muted nowrap">× 3 ชิ้น<\/span> <span class="muted">\(จากสายด้านบน\)/, "a fed part points to its lane");
  assert.match(html, /data-rf-open="routingEdit" data-rf-args="\{&quot;code&quot;:&quot;SE-TP01-OR01-100-18-65&quot;\}"/);
  assert.match(html, /data-rf-open="itemImage" data-rf-args="\{&quot;code&quot;:&quot;DEMO-TP-01\(P\)-Y&quot;\}"/);
  assert.match(html, /GR · ตัด\/เจาะชิ้นยาง<\/td><td class="num">6<\/td><td class="num">8<\/td>/, "6 min per set × 80 sets = 8 hours");
  // ตามผังงานบริษัท: ฝ่ายขาย (1) → วางแผน (2) → ST (3) อยู่หัวสุด · เส้นยาง (4) → SR รับยางเส้นยาว (5) → QA ตรวจขนาด (6) → GR (7) · สินค้า (10) → WH (11) ปิดท้าย
  assert.match(html, /<div class="bom-flow"><div class="bom-flow-node"><div class="bom-flow-step is-flow"[^>]*><span class="bom-flow-order"[^>]*>ลำดับ 1<\/span><span class="bom-flow-dept">ฝ่ายขาย<\/span><span class="bom-flow-step-name">ออกใบสั่งผลิตให้แผนกวางแผน<\/span><\/div>[\s\S]*?ลำดับ 2<\/span><span class="bom-flow-dept">ฝ่ายวางแผน<\/span>[\s\S]*?ลำดับ 3<\/span><span class="bom-flow-dept">ST · คลังวัตถุดิบ<\/span>/, "the flow opens with sales, planning and ST");
  assert.match(html, /aria-label="ลำดับ 4 · RB · รีดเส้นยาง · RB-DM01-02-OR01-202-18-70[\s\S]*?<div class="bom-flow-step is-flow"[^>]*><span class="bom-flow-order"[^>]*>ลำดับ 5<\/span><span class="bom-flow-dept">SR · คลังยางเส้นยาว<\/span>[\s\S]*?ลำดับ 6<\/span><span class="bom-flow-dept">QA · ตรวจขนาดยาง<\/span>[\s\S]*?aria-label="ลำดับ 7 · GR · ตัด\/เจาะชิ้นยาง · SE-TP01-OR01-100-18-65/, "rod (4) → receive (5) → check (6) → rubber part (7)");
  assert.match(html, /aria-label="ลำดับ 10 · PK · บรรจุ\/ประกอบ · DEMO-TP-01\(P\)-Y[\s\S]*?ลำดับ 11<\/span><span class="bom-flow-dept">WH · คลังสินค้าสำเร็จรูป<\/span><span class="bom-flow-step-name">รับสินค้าจาก PK เข้าคลังสินค้าสำเร็จรูป<\/span><\/div><\/div><\/div>/, "the product card is followed by the warehouse step");
  const laneOrder = [...html.matchAll(/<details class="bom-flow-lane" open><summary><span class="rf-mono">([A-Z]{2})-/g)].map((match) => match[1]).filter((prefix) => prefix !== "RB"); // สาย RB ซ้อนอยู่ในสาย SE
  assert.deepEqual(laneOrder, ["SE", "SE", "SE", "PT", "XP"], "rubber lanes (GR, 7) come before the plastic lane (PT, 8) and the PK sub-part (10)");
  assert.match(html, /aria-label="ลำดับ 8 · PT · ฉีดพลาสติก · PT-00320/);
  // มุมมองตารางต้นทุน: สินค้าอยู่บน ราคาตั้งได้เฉพาะชิ้นที่ไม่มี BOM
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y&view=table");
  clean(html);
  assert.match(html, /PK-01 1\.5′/);
  assert.match(html, /data-rf-open="itemCost" data-rf-args="\{&quot;code&quot;:&quot;XP-00001&quot;\}"/);
  assert.doesNotMatch(html, /data-rf-open="itemCost" data-rf-args="\{&quot;code&quot;:&quot;PT-00320&quot;\}"/, "parts with a BOM have no manual cost");
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "setItemCost", { unitCost: "0.4" }, { code: "XP-00001" });
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "saveRouting", { "processCode[]": ["PK-02", "", "PK-01"], "minutesPerPc[]": ["0.5", "9", "1"], "inputCode[]": ["P-BOX-01", "PT-00320", "P-STK-01"], "inputStep[]": ["PK-01", "PK-02", ""] }, { itemCode: "DEMO-TP-01(P)-Y" });
  const routing = env.context.MNP_BOM_ACTIONS.helpers.routingOf(env.store.data(), "DEMO-TP-01(P)-Y");
  assert.deepEqual(json(routing.steps.map((step) => [step.processCode, step.minutesPerPc, step.inputs])), [["PK-02", 0.5, ["PT-00320"]], ["PK-01", 1, ["P-BOX-01"]]], "blank rows are skipped, the order is kept and inputs follow their step");
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y");
  assert.doesNotMatch(html, /ต้นทุนยังไม่ครบ/);
  // รูปชิ้นงาน: data URL ที่ผ่านการตรวจแสดงเป็น <img> ค่าอื่นถูกปฏิเสธ
  const png = "data:image/png;base64,iVBORw0KGgo=";
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "setItemImage", { image: png }, { code: "DEMO-TP-01(P)-Y" });
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y");
  assert.match(html, /<img class="bom-pic" src="data:image\/png;base64,iVBORw0KGgo=" alt="DEMO-TP-01\(P\)-Y">/);
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "setItemImage", { image: "javascript:alert(1)" }, { code: "PT-00320" });
  assert.ok(env.log.toasts.some(([message, kind]) => kind === "error" && /PNG, JPEG หรือ WebP/.test(message)));
  const D = env.context.MNP_BOM_DIALOGS;
  const c = env.ctx("p=structure");
  const dialog = D.routingEdit(c, { code: "DEMO-TP-01(P)-Y" });
  clean(dialog.html);
  assert.match(dialog.html, /ใช้อยู่ Rev\.2/);
  assert.match(dialog.html, /<option value="PK-02" selected>/);
  assert.match(dialog.html, /name="inputCode\[\]" value="PT-00320"[\s\S]*?<option value="PK-02" selected>PK-02<\/option>/, "each BOM line shows the step it enters");
  // บรรทัดที่ขั้นตอนผลิตไม่ได้ระบุ แต่บรรทัด BOM มีขั้นที่: dialog บอกว่าใช้ตาม BOM · หน้าโครงสร้างใส่เลขขั้นทุกขั้น
  const live = env.store.data();
  const A = env.context.MNP_BOM_ACTIONS;
  const routed = new Set(A.helpers.routingOf(live, "DEMO-TP-01(P)-Y").steps.flatMap((step) => step.inputs ?? []));
  const free = A.helpers.approvedBomOf(live, "DEMO-TP-01(P)-Y").lines.find((line) => !routed.has(line.childCode));
  free.step = 2;
  const withBomStep = D.routingEdit(env.ctx("p=structure"), { code: "DEMO-TP-01(P)-Y" });
  assert.match(withBomStep.html, new RegExp(`name="inputCode\\[\\]" value="${free.childCode.replace(/[()]/g, "\\$&")}"[\\s\\S]*?<option value="">ตาม BOM: ขั้นที่ 2</option>`));
  const numberedFlow = await env.render("p=structure&code=DEMO-TP-01(P)-Y");
  assert.match(numberedFlow, /<div class="bom-flow-step"[^>]*><span class="bom-flow-step-no">ขั้นที่ 1<\/span>/, "a routing step carries its number");
  delete free.step;
  // เมนูคลิกขวา: การ์ดและแถววัตถุดิบเป็นเป้า · คำสั่งตามชิ้นที่ชี้และบทบาท · ทุกกลุ่มมีคำสั่ง
  assert.match(numberedFlow, /class="bom-flow-item is-root" data-bom-menu="DEMO-TP-01\(P\)-Y"/);
  assert.match(numberedFlow, /data-bom-menu="PT-00320" data-bom-menu-parent="DEMO-TP-01\(P\)-Y"/);
  const menu = env.context.MNP_BOM_PAGES.structure.menu;
  const labels = (groups) => json(groups.map((group) => group.map((entry) => entry.label)));
  const planner = env.ctx("p=structure");
  const rootMenu = menu(planner, { code: "DEMO-TP-01(P)-Y", root: "DEMO-TP-01(P)-Y" });
  assert.deepEqual(labels(rootMenu), [["ขั้นตอนผลิต…", "รูป…"], ["แก้ส่วนประกอบ (สร้าง BOM)", "ประวัติ BOM / ใช้ในสินค้าไหน"], ["คัดลอกรหัส", "คัดลอกรหัส + ชื่อ (วางใน Excel ได้ 2 ช่อง)"]], "a product with a BOM has no price command and no link to itself");
  assert.equal(rootMenu[2][1].copy, `DEMO-TP-01(P)-Y\t${A.helpers.itemOf(live, "DEMO-TP-01(P)-Y").name}`, "code and name paste into two Excel cells");
  const bought = menu(planner, { code: "P-BAG-01", parent: "DEMO-TP-01(P)-Y", root: "DEMO-TP-01(P)-Y" });
  assert.deepEqual(labels(bought)[0], ["ตั้งราคา…", "เข้าที่ขั้นไหน… (ขั้นตอนของ DEMO-TP-01(P)-Y)", "รูป…"]);
  assert.deepEqual(json(bought[0].map((entry) => [entry.open, entry.args.code])), [["itemCost", "P-BAG-01"], ["routingEdit", "DEMO-TP-01(P)-Y"], ["itemImage", "P-BAG-01"]], "a material row edits its own price and its parent's steps");
  assert.deepEqual(labels(bought)[1], ["แก้บรรทัดนี้ใน BOM ของ DEMO-TP-01(P)-Y", "ประวัติ BOM / ใช้ในสินค้าไหน"], "a bought part has no structure of its own");
  assert.ok(labels(menu(planner, { code: "PT-00320", parent: "DEMO-TP-01(P)-Y", root: "DEMO-TP-01(P)-Y" }))[1].includes("เปิดโครงสร้างของ PT-00320"));
  env.store.setUser("B05"); // หัวหน้า GR ดูอย่างเดียว
  assert.deepEqual(labels(menu(env.ctx("p=structure"), { code: "P-BAG-01", parent: "DEMO-TP-01(P)-Y", root: "DEMO-TP-01(P)-Y" })), [["ประวัติ BOM / ใช้ในสินค้าไหน"], ["คัดลอกรหัส", "คัดลอกรหัส + ชื่อ (วางใน Excel ได้ 2 ช่อง)"]], "read-only roles get only go-to and copy");
  assert.deepEqual(json(menu(env.ctx("p=structure"), { code: "NOPE" })), []);
  // ตัวช่วยของเมนู: Shift+คลิกขวาด้วยเมาส์ = เมนูเบราว์เซอร์ แต่ Shift+F10 (button 0) = เมนูของเรา · ไม่ล้นจอ · ชื่อไม่แตกช่อง Excel
  assert.equal(menu.browserMenuWanted({ shiftKey: true, button: 2 }), true);
  assert.equal(menu.browserMenuWanted({ shiftKey: true, button: 0 }), false, "Shift+F10 from the keyboard opens our menu");
  assert.equal(menu.browserMenuWanted({ shiftKey: false, button: 2 }), false);
  assert.deepEqual(json(menu.menuPosition(100, 50, 240, 300, 1000, 800)), { left: 100, top: 50 });
  assert.deepEqual(json(menu.menuPosition(900, 700, 240, 300, 1000, 800)), { left: 756, top: 496 }, "near the right and bottom edges the menu moves back inside");
  assert.deepEqual(json(menu.menuPosition(10, 10, 240, 900, 1000, 800)), { left: 10, top: 4 }, "a menu taller than the screen starts at the top and scrolls inside");
  assert.equal(menu.copyCodeAndName("B25-018", "สติ๊กเกอร์\tCE\r\nบาร์โค้ต "), "B25-018\tสติ๊กเกอร์ CE บาร์โค้ต", "tabs and line breaks in a name do not split Excel cells");
  assert.match(numberedFlow, /class="bom-flow-item is-root" data-bom-menu="DEMO-TP-01\(P\)-Y" tabindex="0" role="group" aria-label="ลำดับ \d+ · PK · บรรจุ\/ประกอบ · DEMO-TP-01\(P\)-Y [^"]+— คลิกขวา กดค้าง หรือปุ่ม Menu เพื่อดูคำสั่ง"/, "cards take keyboard focus so read-only roles can open the menu too");
  // ป้ายบนการ์ด: ลำดับการผลิต และแผนกที่รับผิดชอบ · สินค้าได้ลำดับสุดท้าย (มากกว่าทุกสายป้อน)
  const orders = [...numberedFlow.matchAll(/<span class="bom-flow-order"[^>]*>ลำดับ (\d+)<\/span>/g)].map((match) => Number(match[1]));
  assert.ok(orders.length > 1, "every card carries its production order");
  assert.ok(orders.slice(0, -1).every((order) => order < orders.at(-1)), "the product card is made after every feed");
  assert.ok(new Set(orders).size > 2, "rods, the parts cut from them and the product get different orders");
  // ขั้นตอนตามลำดับ (ผังงานบริษัท): ฝ่ายขาย 1 → วางแผน 2 → ST สั่งวัตถุดิบ 3 → RB 4 → SR 5 → QA 6 → GR 7 → PT 8 → PK 10 → WH 11 แถวสุดท้าย
  const stepList = await env.render("p=structure&code=DEMO-TP-01(P)-Y&view=steps");
  assert.match(stepList, /<tbody><tr><td><span class="bom-flow-order"[^>]*>ลำดับ 1<\/span><\/td><td class="nowrap">ฝ่ายขาย<\/td><td>ออกใบสั่งผลิตให้แผนกวางแผน<\/td><td><\/td><td><\/td><\/tr><tr><td><span class="bom-flow-order"[^>]*>ลำดับ 2<\/span><\/td><td class="nowrap">ฝ่ายวางแผน<\/td><td>ออก BOM และใบสั่งงานให้ฝ่ายผลิต<div class="small muted">สำรวจยางคงคลังก่อนสั่งผลิต<\/div><\/td>/, "sales and planning open the list");
  assert.match(stepList, /ลำดับ 3<\/span><\/td><td class="nowrap">ST · คลังวัตถุดิบ<\/td><td>สั่งวัตถุดิบที่เกี่ยวข้องกับการผลิต<\/td><td><\/td><td><ul class="bom-step-inputs">[\s\S]*?P-BOX-01[^<]*<\/span> <span class="small">[^<]+<\/span> <span class="muted nowrap">รวม /, "ST comes third with every bought item and its total");
  const stepOrders = [...stepList.matchAll(/<tr><td><span class="bom-flow-order"[^>]*>ลำดับ (\d+)<\/span>/g)].map((match) => Number(match[1]));
  assert.deepEqual([stepOrders[0], stepOrders.at(-1)], [1, 11]);
  assert.deepEqual(stepOrders, [...stepOrders].sort((a, b) => a - b), "rows run from the first order");
  assert.ok(stepOrders.includes(8) && stepOrders.indexOf(8) > stepOrders.lastIndexOf(7), "the plastic part (PT, 8) comes after every rubber part (GR, 7) as in the company flow");
  assert.match(stepList, /<td class="nowrap">SR · คลังยางเส้นยาว<\/td><td><span class="rf-mono">RB-DM01-01-OR01-200-0-72<\/span><div class="small">รับยางเส้นยาวเข้าคลัง<\/div><\/td><td class="num nowrap">[^<]+<\/td><td><span class="bom-flow-order is-quiet">จากลำดับ 4<\/span>/, "each rubber rod is received");
  assert.match(stepList, /<td class="nowrap">QA · ตรวจขนาดยาง<\/td><td><span class="rf-mono">RB-DM01-01-OR01-200-0-72<\/span><div class="small">ตรวจเช็คขนาดยางขณะรับเข้าคลัง<\/div><\/td><td class="num nowrap">[^<]+<\/td><td><span class="bom-flow-order is-quiet">จากลำดับ 5<\/span>/, "and checked by QA");
  const lastRows = stepList.split("<tr><td><span class=\"bom-flow-order\"").slice(-3);
  assert.match(lastRows[0], /^[^>]*>ลำดับ 10<\/span><\/td><td class="nowrap">PK · บรรจุ\/ประกอบ<\/td><td><span class="rf-mono">XP-00001<\/span>/, "the PK sub-part comes before the product it goes into (same order 10)");
  assert.match(lastRows[1], /^[^>]*>ลำดับ 10<\/span><\/td><td class="nowrap">PK · บรรจุ\/ประกอบ<\/td><td><span class="rf-mono">DEMO-TP-01\(P\)-Y<\/span>/, "PK assembles the product just before the warehouse");
  assert.match(lastRows[2], /^[^>]*>ลำดับ 11<\/span><\/td><td class="nowrap">WH · คลังสินค้าสำเร็จรูป<\/td><td><span class="rf-mono">DEMO-TP-01\(P\)-Y<\/span><div class="small">รับสินค้าจาก PK เข้าคลัง<\/div><\/td><td class="num nowrap">[^<]+<\/td><td><span class="bom-flow-order is-quiet">จากลำดับ 10<\/span>/, "the warehouse is the last row");
  assert.match(stepList, /คอมปาวด์ <span class="rf-mono">DM01<\/span>/, "a rubber rod row names its compound");
  assert.match(stepList, /SE-TP01-OR01-100-18-65[\s\S]*?RB-DM01-02-OR01-202-18-70<\/span> <span class="muted nowrap">× [^<]+<\/span> <span class="bom-flow-order is-quiet">จากลำดับ 6<\/span>/, "a rubber part uses the rod once QA has passed it");
  assert.match(stepList, /aria-current="page">ขั้นตอนตามลำดับ/);
  assert.match(numberedFlow, /is-root" data-bom-menu="DEMO-TP-01\(P\)-Y"[^>]*>(?:<img[^>]*>|<span[^>]*>[^<]*<\/span>)<div class="bom-flow-item-body"><div class="bom-flow-tags"><span class="bom-flow-order"[^>]*>ลำดับ \d+<\/span><span class="bom-flow-dept" title="แผนกที่รับผิดชอบ">PK · บรรจุ\/ประกอบ<\/span>/, "the card names its responsible department");
  env.store.setUser("B03");
  clean(D.itemCost(c, { code: "XP-00001" }).html);
  const imageDialog = D.itemImage(c, { code: "DEMO-TP-01(P)-Y" });
  clean(imageDialog.html);
  assert.match(imageDialog.html, /data-rf-action="setItemImage"[^>]*>ลบรูป/);
  assert.equal(D.routingEdit(c, { code: "NOPE" }), null);
  env.store.setUser("B05"); // หัวหน้า GR ดูได้ แก้ไม่ได้
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y");
  clean(html);
  assert.doesNotMatch(html, /data-rf-open="routingEdit"|data-rf-open="itemCost"|data-rf-open="itemImage"/);
});

test("kinds are chosen by category (สินค้า / WIP / วัตถุดิบ / สูตรยาง) and a rod's compound line shows as its own card and as the rod's input", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=build&code=DEMO-TP-01(P)-Y");
  clean(html);
  assert.deepEqual([...html.matchAll(/<optgroup label="([^"]+)">/g)].slice(0, 4).map((match) => match[1]), ["สินค้า", "WIP (งานระหว่างผลิต)", "วัตถุดิบ", "สูตรยาง"]);
  assert.match(html, /<optgroup label="สูตรยาง"><option value="CP">CP · สูตรยาง \(คอมปาวด์\)<\/option><\/optgroup>/);
  assert.match(html, /data-native-select data-bom-kind/, "the grouped select stays a native dropdown");
  assert.match(env.context.MNP_BOM_DIALOGS.itemEdit(env.ctx("p=items"), {}).html, /<optgroup label="วัตถุดิบ"><option value="PURCHASED" selected>/, "the item dialog uses the same grouped choice");
  assert.equal(env.store.run("saveItem", { code: "DM01", kind: "CP", name: "EPDM ส้ม", uom: "kg", create: true }).ok, true);
  assert.equal(env.store.run("saveBom", { itemCode: "RB-DM01-02-OR01-202-18-70", lines: [{ childCode: "DM01", qty: 1.53 }] }).ok, true);
  html = await env.render("p=product&code=DEMO-TP-01(P)-Y&qty=80");
  clean(html);
  assert.match(html, /<h3>สูตรยาง <span class="muted">ผสมโดย RB ตามสูตรใน RubberFlow<\/span>/);
  assert.match(html, /DM01[\s\S]*?RC-EPDM-DS01[\s\S]*?ผูกแล้ว[\s\S]*?<strong>11\.85<\/strong>/, "7.74 rods × 1.53 kg");
  assert.deepEqual([...html.matchAll(/<h3>([A-Z]{2}) <span class="muted">/g)].map((match) => match[1]), ["ST", "RB", "GR", "PT", "PK"], "the department cards are unchanged");
  html = await env.render("p=structure&code=RB-DM01-02-OR01-202-18-70");
  clean(html);
  assert.equal((html.match(/คอมปาวด์ <span class="rf-mono">DM01<\/span>/g) ?? []).length, 0, "the compound field is not repeated when the BOM has the compound line");
  assert.match(html, /DM01<\/span> <span class="bom-flow-input-name">EPDM ส้ม<\/span>[\s\S]*?\(สูตรอยู่ที่ RubberFlow\)/);
  html = await env.render("p=items&sel=DM01");
  assert.match(html, /สูตรยาง · สูตรยาง \(คอมปาวด์\)/);
});

test("order items show edit and delete buttons in a draft and in a released order with no started job, with a reopen warning", async () => {
  const env = load();
  env.store.setUser("B03");
  const D = env.context.MNP_BOM_DIALOGS;
  // ใบร่าง: แก้จำนวน/ลบ/เพิ่มได้ ไม่มีคำเตือน
  let html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  assert.match(html, /data-rf-open="orderItemEdit"/);
  assert.match(html, /data-rf-action="removeOrderItem"/);
  let c = env.ctx("p=orders&sel=DEMO-26002");
  const edit = D.orderItemEdit(c, { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A" });
  clean(edit.html);
  assert.match(edit.html, /data-rf-form="updateOrderItem"/);
  assert.match(edit.html, /name="qty"[^>]*value="192"/);
  assert.doesNotMatch(edit.html, /กลับเป็นร่าง/);
  assert.match(edit.html, /name="note"[^>]*maxlength="120"/);
  assert.equal(D.orderItemEdit(c, { orderId: "DEMO-26002", fgCode: "NOPE" }), null);
  // ใบที่ปล่อยผลิตแล้ว ยังไม่มีงานเริ่ม: ปุ่มยังอยู่ และเตือนว่าใบจะกลับเป็นร่าง
  assert.equal(env.store.run("releaseOrder", { orderId: "DEMO-26002" }).ok, true);
  html = await env.render("p=orders&sel=DEMO-26002");
  assert.match(html, /data-rf-open="orderItemEdit"/);
  assert.match(html, /data-rf-open="orderItemAdd"/);
  assert.match(html, /data-rf-confirm="[^"]*กลับเป็นร่าง/);
  c = env.ctx("p=orders&sel=DEMO-26002");
  assert.match(D.orderItemEdit(c, { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A" }).html, /กลับเป็นร่าง/);
  assert.match(D.orderItemAdd(c, { orderId: "DEMO-26002" }).html, /กลับเป็นร่าง/);
  assert.equal(env.store.run("updateOrderItem", { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A", qty: 10 }).ok, true);
  html = await env.render("p=orders&sel=DEMO-26002");
  assert.match(html, /<dt>REV\.<\/dt><dd>1<\/dd>/, "the bumped order revision is shown in the header");
  assert.doesNotMatch(html, /ระเบิด BOM ล่าสุด/, "a reopened order no longer claims an explosion");
  // ใบตัวอย่างที่มีงานเริ่มแล้ว: ไม่มีปุ่มแก้
  html = await env.render("p=orders&sel=DEMO-26001");
  assert.doesNotMatch(html, /data-rf-open="orderItemEdit"|data-rf-action="removeOrderItem"|data-rf-open="orderItemAdd"/);
  // แผนกอื่นไม่เห็นปุ่มแก้
  env.store.setUser("B05");
  html = await env.render("p=orders&sel=DEMO-26002");
  assert.doesNotMatch(html, /data-rf-open="orderItemEdit"/);
});

// ---------- ตั้งต้นจาก · วางจาก Excel · ตรวจข้อมูล · เลิกใช้ชิ้นงาน ----------
// DOM จำลองเล็กๆ ของตารางสร้าง BOM: ตารางเก็บแถวเป็นลำดับ (แปลงจาก HTML ที่หน้าสร้างให้) พอให้โค้ด bind ทำงานจริงได้
function fakeBuilder(env, query, { copyValue = "", pasteValue = "" } = {}) {
  const ctx = env.ctx(query);
  const page = env.context.MNP_BOM_PAGES.build(ctx);
  const handlers = (extra = {}) => ({ handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, setAttribute() {}, classList: { toggle() {}, add() {}, remove() {}, contains: () => false }, focus() {}, ...extra });
  const parse = (html) => html.split('<tr class="bom-row').slice(1).map((chunk) => {
    const meta = /data-row="([^"]*)" data-parent="([^"]*)" data-level="(\d+)"/.exec(chunk);
    const field = (pattern) => pattern.exec(chunk)?.[1] ?? "";
    const row = {
      html: chunk, dataset: { row: meta[1], parent: meta[2], level: meta[3] }, classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      code: field(/name="childCode\[\]"[^>]*value="([^"]*)"/), name: field(/name="name\[\]"[^>]*value="([^"]*)"/), kind: field(/name="kind\[\]"[\s\S]*?<option value="([^"]*)" selected/),
      remove() { table.rows = table.rows.filter((entry) => entry !== this); },
      insertAdjacentHTML(_, html) { table.rows.splice(table.rows.indexOf(this) + 1, 0, ...parse(html)); },
      querySelectorAll: () => [],
      querySelector(selector) {
        if (selector === "[data-bom-code]") return handlers({ value: this.code });
        if (selector === 'input[name="name[]"]') return { value: this.name };
        if (selector === "[data-bom-kind]") return handlers({ value: this.kind });
        return null;
      },
    };
    return row;
  });
  const table = { rows: parse(/<tbody data-bom-rows>([\s\S]*?)<\/tbody>/.exec(page.html)[1]) };
  const tbody = {
    ...handlers(), querySelectorAll: () => [...table.rows],
    set innerHTML(html) { table.rows = parse(html); },
    insertAdjacentHTML(_, html) { table.rows.push(...parse(html)); },
  };
  const named = {
    "[data-bom-rows]": tbody, "template[data-bom-row]": { innerHTML: "" }, "[data-bom-source]": { textContent: "" }, "[data-bom-copy-src]": handlers({ value: copyValue }),
    "[data-bom-copy]": handlers(), "[data-bom-paste]": handlers({ classList: { hidden: true, toggle(name, force) { if (name === "is-hidden") this.hidden = force; }, contains(name) { return name === "is-hidden" && this.hidden; } } }), "[data-bom-paste-text]": handlers({ value: pasteValue }), "[data-bom-paste-parent]": handlers({ value: "", innerHTML: "" }),
    "[data-bom-paste-preview]": { innerHTML: "" }, "[data-bom-paste-add]": handlers({ disabled: true, textContent: "" }), "[data-bom-paste-toggle]": handlers(), "[data-bom-paste-close]": handlers(),
  };
  const rootNode = { querySelector: (selector) => named[selector] ?? null, querySelectorAll: () => [] };
  page.bind(rootNode, ctx);
  return { page, table, named, codes: () => table.rows.map((row) => [row.code, Number(row.dataset.level), row.dataset.parent]) };
}

test("the builder starts from any product or item that has a BOM; a filled table needs the shared confirm and nothing is saved", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=build&base=BRAND-NEW-01&pkg=B&cs=A");
  assert.match(html, /<datalist id="bom-copy-list">/);
  assert.match(html, /<option value="DEMO-HL-24\(B\)-A">/, "a product of another base is offered");
  assert.match(html, /<option value="SE-TP01-OR01-100-18-65">/, "so is a WIP that has a BOM");
  const copyList = /<datalist id="bom-copy-list">([\s\S]*?)<\/datalist>/.exec(html)[1];
  assert.doesNotMatch(copyList, /value="P-BOX-01"/, "raw materials have no BOM");
  assert.doesNotMatch(copyList, /value="DEMO-BL-60\(K\)-Z"/, "an item without a BOM is not offered");
  assert.match(html, /data-bom-copy>โหลดโครงสร้าง/);
  assert.match(html, /data-bom-source><\/div>/, "no source line before one is chosen");
  html = await env.render("p=build&base=DEMO-TP-01&pkg=P&cs=A");
  assert.equal([...html.matchAll(/ตั้งต้นจาก DEMO-TP-01\(P\)-Y/g)].length, 1, "where the rows came from is said once");
  env.store.setUser("B05");
  assert.doesNotMatch(await env.render("p=build&base=BRAND-NEW-01&pkg=B&cs=A"), /data-bom-copy/, "view-only roles are refused the page");

  env.store.setUser("B03");
  const before = JSON.stringify(env.store.data().boms);
  const built = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { copyValue: "demo-hl-24(b)-a" });
  assert.deepEqual(built.codes(), [["", 1, ""]], "a new base starts with one empty row");
  await built.named["[data-bom-copy]"].handlers.click();
  assert.equal(env.log.confirms.length, 0, "an empty table is replaced without asking");
  const copied = built.codes();
  assert.ok(copied.length > 3 && copied.every(([code]) => code), "the whole tree is loaded");
  assert.ok(copied.some(([, level]) => level === 2), "with its deeper levels");
  assert.equal(new Set(built.table.rows.map((row) => row.dataset.row)).size, copied.length, "row ids are unique");
  assert.match(built.named["[data-bom-source]"].textContent, /^ตั้งต้นจาก DEMO-HL-24\(B\)-A \(.*\) แก้แล้วบันทึกเป็น BRAND-NEW-01\(B\)-A/);
  assert.equal(built.named["[data-bom-copy-src]"].value, "", "the source box is cleared");
  assert.equal(JSON.stringify(env.store.data().boms), before, "nothing is saved until the user presses save");
  // ตารางมีแถวแล้ว: ต้องยืนยันก่อนแทนที่ · ปฏิเสธ = ไม่เปลี่ยน
  built.named["[data-bom-copy-src]"].value = "DEMO-TP-01(P)-Y";
  env.log.confirmAnswer = false;
  await built.named["[data-bom-copy]"].handlers.click();
  assert.equal(env.log.confirms.length, 1);
  assert.equal(env.log.confirms[0].title, "แทนที่แถวในตารางด้วยโครงสร้างของ DEMO-TP-01(P)-Y?");
  assert.deepEqual(built.codes(), copied, "declined: the rows stay");
  env.log.confirmAnswer = true;
  await built.named["[data-bom-copy]"].handlers.click();
  assert.equal(env.log.confirms.length, 2);
  assert.notDeepEqual(built.codes(), copied);
  assert.ok(built.codes().some(([code]) => code === "SE-TP01-OR01-100-18-65"));
  assert.match(built.named["[data-bom-source]"].textContent, /^ตั้งต้นจาก DEMO-TP-01\(P\)-Y/);
  // ที่ไม่ได้: ไม่มีรหัส · ไม่มีชิ้น · ไม่มี BOM · ของซื้อ · ตัวเองและพ่อ-ลูกที่เข้ากันไม่ได้
  const plan = (src, target = "BRAND-NEW-01(B)-A", kind = "FG") => env.context.MNP_BOM_PAGES.tools.copyPlan(env.ctx("p=build"), src, target, kind);
  assert.match(plan("").error, /พิมพ์หรือเลือกรหัส/);
  assert.match(plan("NOPE").error, /ไม่พบชิ้นงาน NOPE/);
  assert.match(plan("DEMO-BL-60(K)-Z").error, /ยังไม่มี BOM/);
  assert.match(plan("P-BOX-01").error, /ยังไม่มี BOM/);
  assert.match(plan("DEMO-TP-01(P)-Y", "DEMO-TP-01(P)-Y").error, /เดียวกับที่กำลังสร้าง/);
  assert.match(plan("DEMO-TP-01(P)-Y", "RB-X-1", "RB").error, /เส้นยางมีส่วนประกอบได้เฉพาะสูตรยาง/);
  assert.match(plan("DEMO-TP-01(P)-Y", "SE-TP01-OR01-100-18-65", "SE").error, /วงจร/, "the target cannot sit under the source tree");
  // ชิ้นที่เลิกใช้: เลือกเป็นต้นแบบไม่ได้ · ในต้นไม้ที่โหลด = แจ้งให้ลบก่อนบันทึก
  env.store.run("saveItem", { code: "DEMO-HL-24(B)-A", kind: "FG", name: "x", uom: "set", active: false });
  assert.match(plan("DEMO-HL-24(B)-A").error, /เลิกใช้แล้ว/);
  env.store.run("saveItem", { code: "P-BOX-01", kind: "PURCHASED", name: "กล่องนอก", uom: "pcs", active: false });
  assert.deepEqual(json(plan("DEMO-TP-01(P)-Y").retired), ["P-BOX-01"]);
  // เลิกใช้ที่อยู่ลึกกว่าชั้นแรก (มาจาก BOM เดิมของพ่อมันเอง) ไม่ถูกปฏิเสธตอนบันทึก จึงไม่อยู่ในคำเตือน
  const deep = plan("DEMO-TP-01(P)-Y").rows.find((row) => row.level === 2 && row.code !== "P-BOX-01");
  assert.ok(deep, "the source tree has a deeper line");
  env.store.run("saveItem", { code: deep.code, kind: deep.kind, name: deep.name, uom: deep.uom, active: false });
  assert.deepEqual(json(plan("DEMO-TP-01(P)-Y").retired), ["P-BOX-01"], "only the first-level retired line is refused by saveBom");
  assert.equal(plan("DEMO-TP-01(P)-Y").rows.find((row) => row.code === deep.code).inactive, true, "but the row is still marked");
  const withRetired = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { copyValue: "DEMO-TP-01(P)-Y" });
  env.log.toasts.length = 0;
  await withRetired.named["[data-bom-copy]"].handlers.click();
  assert.match(env.log.toasts.at(-1)[0], /P-BOX-01 เลิกใช้แล้ว เพิ่มเป็นบรรทัดใหม่ของ BRAND-NEW-01\(B\)-A ไม่ได้ ต้องลบบรรทัดนั้นก่อนบันทึก/);
  assert.match(withRetired.table.rows.find((row) => row.code === "P-BOX-01").html, /เลิกใช้/, "the row is marked");
});

test("paste from Excel: the preview tells known items, new items and bad lines apart and adds the rows at the first level or under a chosen row", async () => {
  const env = load();
  env.store.setUser("B03");
  const text = ["รหัส\tจำนวน\tหน่วย\t% เผื่อเสีย\tหมายเหตุ", "P-STK-01\t2\tชิ้น\t3\tติดกล่อง", "P-NEW-9\t4\tกล่อง", "P-BOX-01\tabc", "NOPE-ROW\t0", "P-STK-01\t1", "RB-NEW-7\t1"].join("\n");
  const tools = env.context.MNP_BOM_PAGES.tools;
  const plan = tools.pastePlan(env.ctx("p=build"), text, { parentKind: "FG", ancestors: ["DEMO-NEW-1"], siblings: ["P-PEL-BK"] });
  assert.equal(plan.header, true);
  assert.deepEqual(json(plan.rows.map((row) => [row.code, row.status])), [["P-STK-01", "known"], ["P-NEW-9", "new"], ["P-BOX-01", "error"], ["NOPE-ROW", "error"], ["P-STK-01", "error"], ["RB-NEW-7", "new"]]);
  assert.equal(plan.rows[0].scrapPct, 3);
  assert.equal(plan.rows[0].note, "ติดกล่อง");
  assert.equal(plan.rows[1].kind, "PURCHASED", "an unknown plain code is a purchased part until the user changes it");
  assert.equal(plan.rows[1].uom, "box");
  assert.equal(plan.rows[5].kind, "RB", "the kind is guessed from the code like typing it in the table");
  assert.equal(plan.addable, 3);
  assert.match(plan.rows[2].error, /ปริมาณ/);
  // พ่อ-ลูกที่ไม่เข้ากัน · วงจร · มีอยู่แล้ว · เลิกใช้ · หน่วยต่างจากชิ้นงาน
  const under = (extra) => tools.pastePlan(env.ctx("p=build"), "SE-TP01-OR01-100-18-65\t1\nP-NEW-9\t1\nDM01\t2", { parentKind: "RB", ...extra });
  assert.deepEqual(json(under({}).rows.map((row) => [row.status, row.kind])), [["error", ""], ["new", "CP"], ["new", "CP"]], "under a rod only a compound goes; unknown codes become compounds in kg");
  assert.equal(under({}).rows[1].uom, "kg");
  assert.match(tools.pastePlan(env.ctx("p=build"), "DM01\t1", { parentKind: "FG" }).rows[0].error, /สูตรยางใส่ได้เฉพาะใต้เส้นยาง/);
  assert.match(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t1", { parentKind: "FG", ancestors: ["P-STK-01"] }).rows[0].error, /วงจร/);
  assert.match(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t1", { parentKind: "FG", siblings: ["P-STK-01"] }).rows[0].error, /มีในตารางแล้ว/);
  assert.match(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t1\tkg", { parentKind: "FG" }).rows[0].warn, /ต่างจากชิ้นงาน/);
  env.store.run("saveItem", { code: "P-STK-01", kind: "PURCHASED", name: "สติ๊กเกอร์", uom: "pcs", active: false });
  assert.match(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t1", { parentKind: "FG" }).rows[0].error, /เลิกใช้แล้ว/);
  env.store.run("saveItem", { code: "P-STK-01", kind: "PURCHASED", name: "สติ๊กเกอร์", uom: "pcs", active: true });

  // ผ่านตารางจริง: ชั้นแรก (ลบแถวว่างตั้งต้น) แล้วเพิ่มใต้แถวที่เลือก
  const built = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { pasteValue: text });
  const { named } = built;
  named["[data-bom-paste-toggle]"].handlers.click();
  assert.equal(named["[data-bom-paste-add]"].disabled, false);
  assert.equal(named["[data-bom-paste-add]"].textContent, "เพิ่ม 3 แถวในตาราง (ข้าม 3)");
  assert.match(named["[data-bom-paste-preview]"].innerHTML, /ชิ้นเดิม[\s\S]*ชิ้นใหม่[\s\S]*ข้าม/);
  clean(named["[data-bom-paste-preview]"].innerHTML);
  named["[data-bom-paste-add]"].handlers.click();
  assert.deepEqual(built.codes().map(([code, level, parent]) => [code, level, parent]), [["P-STK-01", 1, ""], ["P-NEW-9", 1, ""], ["RB-NEW-7", 1, ""]], "the empty start row is gone and the lines are first-level components");
  assert.match(env.log.toasts.at(-1)[0], /เพิ่ม 3 แถวเป็นส่วนประกอบชั้นแรก · ชิ้นใหม่ 2 แถว/);
  assert.match(built.table.rows[1].html, /^ is-new"/, "a new code is a row the user must complete");
  assert.equal(named["[data-bom-paste-text]"].value, "", "the box is cleared");
  // ใต้แถวที่เลือก (เส้นยาง): ลูกต่อท้ายลูกเดิมของแถวนั้น
  const rod = built.table.rows[2];
  named["[data-bom-paste-parent]"].value = rod.dataset.row;
  named["[data-bom-paste-text]"].value = "DM01\t0.5\nDM02\t1";
  named["[data-bom-paste-text]"].handlers.input();
  assert.equal(named["[data-bom-paste-add]"].textContent, "เพิ่ม 2 แถวในตาราง");
  named["[data-bom-paste-add]"].handlers.click();
  assert.deepEqual(built.codes().slice(2), [["RB-NEW-7", 1, ""], ["DM01", 2, rod.dataset.row], ["DM02", 2, rod.dataset.row]]);
  assert.match(env.log.toasts.at(-1)[0], /ใต้ RB-NEW-7/);
  assert.equal(new Set(built.table.rows.map((row) => row.dataset.row)).size, built.table.rows.length, "row ids stay unique");
  // ชิ้นเดิมที่มี BOM: ลูกของมันตามมาในตาราง
  named["[data-bom-paste-parent]"].value = "";
  named["[data-bom-paste-text]"].value = "SE-TP01-OR01-100-18-65\t3";
  named["[data-bom-paste-text]"].handlers.input();
  named["[data-bom-paste-add]"].handlers.click();
  const se = built.codes().findIndex(([code]) => code === "SE-TP01-OR01-100-18-65");
  assert.equal(built.codes()[se][1], 1);
  assert.equal(built.codes()[se + 1][1], 2, "its own components follow it");
  assert.equal(built.table.rows[se + 1].dataset.parent, built.table.rows[se].dataset.row);
});

test("the data check page: groups with counts, links to the builder or the item dialog for planners only, an empty state when everything is fine", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=check");
  clean(html);
  assert.match(html, /<h1>ตรวจข้อมูล<\/h1>/);
  assert.doesNotMatch(html, /ปล่อยผลิตไม่ได้/, "nothing here blocks a release yet, so no group claims it");
  assert.doesNotMatch(html, /เส้นยาง \(RB\) ที่ยังไม่มีสูตรยาง/, "rods with the compound field are fine without a CP line (Excel imports never have one)");
  assert.match(html, /สินค้า \(FG\) ที่ยังไม่มี BOM <span class="muted">1<\/span>/);
  assert.match(html, /รหัสที่ระบบสร้างให้ \(XP-…\) <span class="muted">1<\/span>/);
  assert.doesNotMatch(html, /ใช้ใน BOM แล้วแต่ยังไม่มี BOM/, "a group with nothing to fix is not shown");
  assert.match(html, /href="#\/bom\?p=build&amp;code=DEMO-BL-60%28K%29-Z"[^>]*>สร้าง BOM/, "the fix link opens the builder on that item");
  assert.match(html, /data-rf-open="itemEdit" data-rf-args="[^"]*XP-00001[^"]*"/, "or the item dialog");
  assert.doesNotMatch(html, /BOM ยังไม่มีบรรทัดสูตรยาง/);
  // ชิ้นที่ถูกใช้แล้วไม่มี BOM (MEGA-BBL-06)
  env.store.run("saveBom", { itemCode: "DEMO-BL-60(K)-Z", lines: [{ childCode: "SE-BL60-RD01-60-0-60", qty: 1 }] });
  html = await env.render("p=check");
  assert.match(html, /ใช้ใน BOM แล้วแต่ยังไม่มี BOM <span class="muted">1<\/span>/);
  assert.match(html, /ใช้ใน DEMO-BL-60\(K\)-Z/);
  assert.equal([...html.matchAll(/ปล่อยผลิตไม่ได้/g)].length, 1, "only the used-but-no-BOM group says it blocks a release, once");
  assert.match(html, /<p class="small muted">ปล่อยผลิตไม่ได้จนกว่าจะมี BOM<\/p>/);
  assert.doesNotMatch(html, /สินค้า \(FG\) ที่ยังไม่มี BOM/);
  // ทุกบทบาทที่เห็นเมนู BOM เปิดได้ แต่ปุ่มแก้เฉพาะฝ่ายวางแผนขึ้นไป
  for (const role of ROLES) {
    const user = env.store.data().users.find((row) => row.role === role);
    env.store.setUser(user.id);
    assert.equal(env.context.MNP_BOM_STORE.canSee(user, "check"), true, `${role} sees the check page`);
    html = await env.render("p=check");
    assert.doesNotMatch(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/);
    const canFix = ["admin", "manager", "planner"].includes(role);
    assert.equal(/สร้าง BOM<\/a>|data-rf-open="itemEdit"/.test(html), canFix, `${role}: fix links only for the planner group`);
    assert.match(html, /DEMO-BL-60\(K\)-Z|SE-BL60-RD01-60-0-60/, `${role} still sees the list`);
  }
  // ครบแล้ว = ข้อความว่าง
  env.store.setUser("B03");
  const mark = (code, extra) => env.store.run("saveItem", { code, kind: env.store.data().items.find((item) => item.code === code).kind, name: "x", uom: env.store.data().items.find((item) => item.code === code).uom, ...extra });
  assert.equal(env.store.run("saveBom", { itemCode: "SE-BL60-RD01-60-0-60", lines: [{ childCode: "RB-DM01-01-OR01-200-0-72", qty: 0.1 }] }).ok, true);
  for (const item of env.store.data().items.filter((entry) => entry.kind === "RB" || entry.code === "XP-00001")) assert.equal(mark(item.code, { active: false }).ok, true);
  html = await env.render("p=check");
  assert.match(html, /ข้อมูลครบ ไม่มีรายการที่ต้องแก้/);
  assert.doesNotMatch(html, /rf-card-head/);
});

test("deactivated items: a mark in the lists, left out of the pickers for new lines, new order items and the copy source, still shown in the BOMs that use them", async () => {
  const env = load();
  env.store.setUser("B03");
  const off = (code) => { const item = env.store.data().items.find((entry) => entry.code === code); return env.store.run("saveItem", { code, kind: item.kind, name: item.name, uom: item.uom, active: false }); };
  assert.equal(off("P-BOX-01").ok, true);
  assert.equal(off("DEMO-HL-24(B)-A").ok, true);
  assert.equal(off("SE-HL24-YE03-400-19-30").ok, true);
  // รายการ: ป้าย "เลิกใช้" ที่รหัส
  let html = await env.render("p=items&q=P-BOX-01");
  assert.match(html, /P-BOX-01<\/a> <span class="small muted">เลิกใช้<\/span>/);
  html = await env.render("p=items&sel=P-BOX-01");
  assert.match(html, /<span class="muted">กล่องนอก[^<]*<\/span> <span class="small muted">เลิกใช้<\/span>/, "the detail title carries the mark too");
  // ตัวเลือกบรรทัดใหม่ของตารางสร้าง BOM · ตั้งต้นจาก · ขั้นที่ 1
  html = await env.render("p=build&code=DEMO-TP-01(P)-Y");
  const list = (id) => new RegExp(`<datalist id="${id}">([\\s\\S]*?)</datalist>`).exec(html)[1];
  assert.doesNotMatch(list("bom-item-list"), /value="P-BOX-01"/, "not offered for a new line");
  assert.match(list("bom-item-list"), /value="P-STK-01"/);
  assert.match(html, /name="childCode\[\]"[^>]*value="P-BOX-01"/, "but the BOM that uses it still shows the line");
  assert.match(html, /P-BOX-01[\s\S]*?data-bom-flag>[^<]*เลิกใช้/, "marked in the row");
  assert.doesNotMatch(list("bom-copy-list"), /value="DEMO-HL-24\(B\)-A"|value="SE-HL24-YE03-400-19-30"/, "not offered as a copy source");
  assert.match(list("bom-copy-list"), /value="SE-TP01-OR01-100-18-65"/);
  html = await env.render("p=build");
  assert.doesNotMatch(list("bom-code-list"), /value="SE-HL24-YE03-400-19-30"/);
  assert.doesNotMatch(list("bom-base-list"), /value="DEMO-HL-24"/, "a base whose products are all retired is not offered");
  assert.match(list("bom-base-list"), /value="DEMO-TP-01"/);
  // สินค้าในใบสั่งผลิตใหม่
  const add = env.context.MNP_BOM_DIALOGS.orderItemAdd(env.ctx("p=orders"), { orderId: "DEMO-26002" });
  assert.doesNotMatch(add.html, /value="DEMO-HL-24"/);
  assert.match(add.html, /value="DEMO-TP-01"/);
  // dialog แก้ชิ้นงาน: ปุ่มเลิกใช้/เปิดใช้อีกครั้ง ส่ง saveItem พร้อม active ผ่านกล่องยืนยัน · เฉพาะฝ่ายวางแผน
  const D = env.context.MNP_BOM_DIALOGS;
  const live = D.itemEdit(env.ctx("p=items"), { code: "P-STK-01" }).html;
  assert.match(live, /data-bom-item-toggle data-rf-confirm="เลิกใช้ P-STK-01\? [^"]*" data-rf-success="[^"]*">เลิกใช้ชิ้นงาน<\/button>/);
  assert.doesNotMatch(live, /data-rf-action="saveItem"/, "no name/uom captured at render time is sent");
  const retired = D.itemEdit(env.ctx("p=items"), { code: "P-BOX-01" }).html;
  assert.match(retired, /แก้ข้อมูล P-BOX-01 \(เลิกใช้\)/);
  assert.match(retired, /data-bom-item-toggle data-rf-confirm="เปิดใช้ P-BOX-01 อีกครั้ง\?[^>]*>เปิดใช้อีกครั้ง<\/button>/);
  assert.doesNotMatch(D.itemEdit(env.ctx("p=items"), {}).html, /data-bom-item-toggle/, "a new item has nothing to deactivate");
  env.store.setUser("B05");
  assert.doesNotMatch(D.itemEdit(env.ctx("p=items"), { code: "P-STK-01" }).html, /data-bom-item-toggle/, "department users cannot");
});

test("the deactivate button sends the stored record with only active flipped, asks before dropping unsaved edits and refuses a stale state", async () => {
  const env = load();
  env.store.setUser("B03");
  const D = env.context.MNP_BOM_DIALOGS;
  const stored = (code) => env.store.data().items.find((item) => item.code === code);
  // dialog จำลอง: ปุ่มจากข้อความ html จริง · ฟอร์มมีช่องที่แก้ได้
  const open = (code) => {
    const built = D.itemEdit(env.ctx("p=items"), { code });
    const attrs = (name) => new RegExp(`data-bom-item-toggle[^>]*${name}="([^"]*)"`).exec(built.html)?.[1];
    const button = { dataset: { rfConfirm: attrs("data-rf-confirm"), rfSuccess: attrs("data-rf-success") }, getAttribute: () => null, textContent: />([^<]*)<\/button><button class="btn rf-btn secondary" type="button" data-rf-close>/.exec(built.html)?.[1] ?? "", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
    const fields = [{ name: "name", value: stored(code).name }, { name: "uom", value: stored(code).uom }];
    const form = { querySelectorAll: () => fields };
    const dialog = { closed: 0, close() { this.closed += 1; }, querySelector: (selector) => ({ "[data-bom-item-toggle]": button, "#bom-item-form": form })[selector] ?? null };
    built.bind(dialog);
    return { button, fields, dialog };
  };
  const first = open("P-STK-01");
  assert.match(first.button.dataset.rfConfirm, /^เลิกใช้ P-STK-01\? /);
  // คนอื่นเปลี่ยนชื่อหลังเปิด dialog: ปุ่มต้องไม่เอาชื่อเก่าไปทับ
  assert.equal(env.store.run("saveItem", { code: "P-STK-01", kind: "PURCHASED", name: "ชื่อใหม่ของอีกคน", uom: "pcs" }).ok, true);
  env.log.confirms.length = 0;
  await first.button.handlers.click();
  assert.equal(env.log.confirms.length, 1, "a clean form asks only the usual confirmation");
  assert.equal(stored("P-STK-01").active, false);
  assert.equal(stored("P-STK-01").name, "ชื่อใหม่ของอีกคน", "the other user's rename survives");
  assert.equal(first.dialog.closed, 1);
  assert.match(env.log.toasts.at(-1)[0], /เลิกใช้ P-STK-01 แล้ว/);
  // ซ้ำจากหน้าต่างเก่า (สถานะเปลี่ยนไปแล้ว): ไม่ทำ
  env.log.confirms.length = 0;
  await first.button.handlers.click();
  assert.match(env.log.toasts.at(-1)[0], /สถานะของ P-STK-01 ถูกเปลี่ยนไปแล้ว/);
  assert.equal(env.log.confirms.length, 0);
  // เปิดใช้อีกครั้ง: มีค่าในฟอร์มที่ยังไม่บันทึก = ถามว่าจะทิ้งก่อน · ปฏิเสธ = ไม่เปลี่ยนอะไร
  const second = open("P-STK-01");
  assert.match(second.button.dataset.rfConfirm, /^เปิดใช้ P-STK-01 อีกครั้ง\? /);
  second.fields[0].value = "แก้ค้างไว้";
  env.log.confirms.length = 0;
  env.log.confirmAnswer = false;
  await second.button.handlers.click();
  assert.equal(env.log.confirms.length, 1);
  assert.equal(env.log.confirms[0].title, "ทิ้งการแก้ไขที่ยังไม่บันทึก?");
  assert.equal(stored("P-STK-01").active, false, "declined: still retired");
  env.log.confirmAnswer = true;
  await second.button.handlers.click();
  assert.equal(env.log.confirms.length, 3, "discard question, then the usual confirmation");
  assert.equal(stored("P-STK-01").active, true);
  assert.equal(stored("P-STK-01").name, "ชื่อใหม่ของอีกคน", "the unsaved text in the form is not sent");
});

test("paste from Excel: a header line is announced, an unknown header never swallows a real item line", async () => {
  const env = load();
  env.store.setUser("B03");
  const preview = (text) => {
    const built = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { pasteValue: text });
    built.named["[data-bom-paste-toggle]"].handlers.click();
    return built.named["[data-bom-paste-preview]"].innerHTML;
  };
  assert.match(preview("รหัส\tจำนวน\nP-STK-01\t2"), /ข้ามบรรทัดที่ 1 \(ถือเป็นหัวตาราง\)/, "a known header");
  assert.match(preview("ITEM\tHOWMANY\nP-STK-01\t2"), /ข้ามบรรทัดที่ 1 \(ถือเป็นหัวตาราง\)/, "an unknown header");
  assert.doesNotMatch(preview("P-STK-01\t2"), /ข้ามบรรทัดที่ 1/);
  // บรรทัดแรกเป็นชิ้นงานที่มีอยู่แต่พิมพ์ปริมาณผิด: ไม่ถูกกลืนเป็นหัว · ติดธงปริมาณ
  const html = preview("P-STK-01\tx\nP-BOX-01\t3");
  assert.doesNotMatch(html, /ข้ามบรรทัดที่ 1 \(/);
  assert.match(html, /P-STK-01[\s\S]*อ่านปริมาณไม่ได้หรือกำกวม/);
  const tools = env.context.MNP_BOM_PAGES.tools;
  assert.deepEqual(json(tools.pastePlan(env.ctx("p=build"), "P-STK-01\tx\nP-BOX-01\t3", { parentKind: "FG" }).rows.map((row) => [row.line, row.code, row.status])), [[1, "P-STK-01", "error"], [2, "P-BOX-01", "known"]]);
  // เลขทศนิยมแบบจุลภาคไปถึงแถวที่เพิ่ม
  assert.equal(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t0,5", { parentKind: "FG" }).rows[0].qty, 0.5);
  assert.equal(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t0,500", { parentKind: "FG" }).rows[0].status, "error");
});

test("paste from Excel: more than one compound under a rod is warned in the preview", async () => {
  const env = load();
  env.store.setUser("B03");
  const tools = env.context.MNP_BOM_PAGES.tools;
  const plan = (text, extra) => tools.pastePlan(env.ctx("p=build"), text, { parentKind: "RB", ...extra });
  assert.equal(plan("DM01\t1").warning, "", "one compound is fine");
  assert.match(plan("DM01\t1\nDM02\t1").warning, /สูตรยางได้สูตรเดียว/);
  assert.match(plan("DM01\t1", { compoundsUnder: 1 }).warning, /มีสูตรยางอยู่แล้ว/, "a rod that already has one");
  assert.equal(plan("DM01\t1\nDM01\t1").warning, "", "a duplicate line is skipped, so only one would be added");
  assert.equal(tools.pastePlan(env.ctx("p=build"), "P-STK-01\t1\nP-BOX-01\t1", { parentKind: "FG" }).warning, "");
  // ผ่านตารางจริง: ใต้เส้นยางที่มีสูตรอยู่แล้ว
  const built = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { pasteValue: "RB-NEW-7\t1" });
  const { named } = built;
  named["[data-bom-paste-toggle]"].handlers.click();
  named["[data-bom-paste-add]"].handlers.click();
  const rod = built.table.rows[0];
  rod.insertAdjacentHTML("afterend", `<tr class="bom-row" data-row="cp1" data-parent="${rod.dataset.row}" data-level="2"><input name="childCode[]" value="DM01"><select name="kind[]"><option value="CP" selected>`);
  named["[data-bom-paste-parent]"].value = rod.dataset.row;
  named["[data-bom-paste-text]"].value = "DM02\t1";
  named["[data-bom-paste-text]"].handlers.input();
  assert.match(named["[data-bom-paste-preview]"].innerHTML, /เส้นยางนี้มีสูตรยางอยู่แล้ว/);
});

test("paste from Excel: Add re-checks the table, so a deleted parent or a changed code never inserts into a detached row", async () => {
  const env = load();
  env.store.setUser("B03");
  const built = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { pasteValue: "RB-NEW-7\t1" });
  const { named } = built;
  named["[data-bom-paste-toggle]"].handlers.click();
  named["[data-bom-paste-add]"].handlers.click();
  const rod = built.table.rows[0];
  assert.equal(rod.code, "RB-NEW-7");
  const add = () => named["[data-bom-paste-add]"].handlers.click();
  // 1) พ่อที่เลือกถูกลบหลังดูตัวอย่าง
  named["[data-bom-paste-parent]"].value = rod.dataset.row;
  named["[data-bom-paste-text]"].value = "DM01\t0.5";
  named["[data-bom-paste-text]"].handlers.input();
  assert.equal(named["[data-bom-paste-add]"].disabled, false);
  rod.remove();
  env.log.toasts.length = 0;
  const detached = built.table.rows.length;
  add();
  assert.equal(built.table.rows.length, detached, "nothing is inserted");
  assert.deepEqual(env.log.toasts.at(-1), ["แถวที่เลือกถูกลบไปแล้ว ตรวจรายการและเลือกแถวใหม่อีกครั้ง", "error"]);
  assert.doesNotMatch(named["[data-bom-paste-parent]"].innerHTML, new RegExp(`value="${rod.dataset.row}"`), "the parent options are refreshed");
  assert.equal(named["[data-bom-paste-text]"].value, "DM01\t0.5", "the pasted text is kept");
  // 2) พ่อยังอยู่แต่ตารางเปลี่ยน (มีบรรทัดเดียวกันใต้พ่อแล้ว): วาดตัวอย่างใหม่ ไม่เพิ่ม
  const built2 = fakeBuilder(env, "p=build&base=BRAND-NEW-01&pkg=B&cs=A", { pasteValue: "RB-NEW-7\t1" });
  const n2 = built2.named;
  n2["[data-bom-paste-toggle]"].handlers.click();
  n2["[data-bom-paste-add]"].handlers.click();
  const rod2 = built2.table.rows[0];
  n2["[data-bom-paste-parent]"].value = rod2.dataset.row;
  n2["[data-bom-paste-text]"].value = "DM01\t0.5";
  n2["[data-bom-paste-text]"].handlers.input();
  rod2.insertAdjacentHTML("afterend", `<tr class="bom-row" data-row="cp1" data-parent="${rod2.dataset.row}" data-level="2"><input name="childCode[]" value="DM01"><select name="kind[]"><option value="CP" selected>`);
  const before = built2.table.rows.length;
  n2["[data-bom-paste-add]"].handlers.click();
  assert.equal(built2.table.rows.length, before, "nothing is added");
  assert.match(env.log.toasts.at(-1)[0], /ตารางเปลี่ยนไปตั้งแต่ตรวจรายการ/);
  assert.match(n2["[data-bom-paste-preview]"].innerHTML, /มีในตารางแล้วใต้พ่อเดียวกัน/, "the preview now shows the conflict");
  assert.equal(n2["[data-bom-paste-add]"].disabled, true);
  // 3) ไม่มีอะไรเปลี่ยน: เพิ่มได้ตามปกติ
  n2["[data-bom-paste-text]"].value = "DM02\t1";
  n2["[data-bom-paste-text]"].handlers.input();
  n2["[data-bom-paste-add]"].handlers.click();
  assert.ok(built2.table.rows.some((row) => row.code === "DM02" && row.dataset.parent === rod2.dataset.row));
});
