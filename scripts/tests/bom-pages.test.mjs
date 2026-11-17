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
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const PAGES = ["dashboard", "build", "items", "product", "structure", "variants", "compounds", "import", "check", "orders", "customers", "count", "stock", "jobs", "audit"];
const ROLES = ["admin", "manager", "planner", "rb", "gr", "pt", "bg", "st", "wh"];
const XSS = "<script>alert(1)</script>";

function load({ sandbox = true, route = "", storage = new Map() } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { listeners: {}, toasts: [], renders: 0, notFound: 0, hash: `#/bom${route ? `?${route}` : ""}`, dialogs: [], confirms: [], confirmAnswer: true };
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
    window: context, addEventListener: (type, handler) => { (log.listeners[type] ??= []).push(handler); }, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
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
  const submit = async (query, action, values, args = {}, event = {}) => {
    const form = { ...node(), dataset: { rfForm: action, rfArgs: JSON.stringify(args), rfSuccess: "ok {result}" }, __values: values, closest: () => null };
    fakes["form[data-rf-form]"] = [form];
    await render(query);
    fakes["form[data-rf-form]"] = [];
    await form.handlers.submit({ preventDefault() {}, ...event });
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
    // เมนูข้างมีแค่เมนูหลัก 4 อัน (storeApi.NAV) ที่บทบาทนั้นเห็นได้ · หน้าอื่นเปิดจากลิงก์ในหน้าเหล่านั้น
    const NAV = env.context.MNP_BOM_STORE.NAV;
    for (const page of [...PAGES, ...NAV]) assert.equal(sub.includes(`p=${page}"`), NAV.includes(page) && env.context.MNP_BOM_STORE.canSee(user, page), `${role} menu ${page}`);
    await env.render("p=nothing");
    assert.equal(env.log.hash, ["admin", "manager", "planner"].includes(role) ? "#/bom?p=find" : role === "wh" ? "#/bom?p=orders" : "#/bom?p=work", "unknown page → home of the role (planners land on products, the warehouse on orders, departments on their own jobs)");
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
  assert.match(html, /DEMO-TP-01\(P\)-A<\/strong> ยังไม่มีในทะเบียน/);
  assert.match(html, /ตั้งต้นจาก DEMO-TP-01\(P\)-Y/);
  assert.match(html, /value="SE-TP01-OR01-100-18-65"/);
  // ฐานรหัสใหม่ → แถวว่างหนึ่งแถว
  html = await env.render("p=build&base=BRAND-NEW-01&pkg=B&cs=A");
  assert.match(html, /BRAND-NEW-01\(B\)-A<\/strong> ยังไม่มีในทะเบียน/);
  assert.doesNotMatch(html, /data-bom-source>[^<]/, "no source line without a source");
  assert.equal([...html.matchAll(/class="bom-row is-new"/g)].length, 2, "one empty editable row plus the template row");
  // หมวดอื่นที่ขั้นที่ 1: WIP ใหม่ใช้รหัสช่องเดียว ไม่ตั้งต้นจากสินค้า · เส้นยางใหม่เริ่มด้วยแถวสูตรยาง · ชิ้นเดิมใช้ชนิดของมันเอง
  html = await env.render("p=build&code=SE-NEW-77&kind=SE");
  assert.match(html, /<option value="SE" selected>/);
  assert.match(html, /bom-pick-fg is-hidden/);
  assert.match(html, /name="code"[^>]*value="SE-NEW-77"/);
  assert.match(html, /<h2>2\. ชิ้นงาน<\/h2>/);
  assert.match(html, /SE-NEW-77<\/strong> ยังไม่มีในทะเบียน บันทึกแล้วระบบสร้างชิ้นงานใหม่ให้/, "the kind is not repeated (it is in the step-1 select)");
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
  assert.match(html, /<h2>2\. สูตรยาง<\/h2>/, "the card names the category once (the kind is in the step-1 select)");
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
  assert.match(bodyNode.textContent, /DEMO-TP-01\(P\)-A ยังไม่มีในทะเบียนชิ้นงาน — จะสร้างจาก BOM ของ DEMO-TP-01\(P\)-Y/);
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
  assert.equal(env.log.hash, `#/bom?p=orders&sel=${autoOrder.id}`, "a new order opens on its own page (U10), not the list");
  assert.match(await env.render(`p=orders&sel=${autoOrder.id}`), /title="ค่าเริ่มต้นจากระยะเวลาจัดหา \(lead time\)"><b>PK<\/b> 14 ธ\.ค\. 2569\*/);
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
  env.store.data().orders.find((entry) => entry.id === "DEMO-26002").stockCounts["SE-HL24-YE03-400-19-30"] = 600; // 24 more than the 576 sleeves the draft order needs
  assert.match(env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26002")).html, /bom-surplus">-24</, "600 sleeves counted against 576 needed shows a surplus, once per item");
  assert.doesNotMatch(built.html, /bom-surplus/, "the released order has no counted surplus (its purchased parts are not counted per PI)");
  assert.match(built.html, /PT-00320[\s\S]*?<td class="right rf-mono">24<\/td>[\s\S]*?<td class="right rf-mono">10<\/td><td class="right rf-mono">14<\/td>/, "stock is subtracted per item (24 needed, 10 counted → 14)");
  assert.match(built.html, /ต้องผลิต\/สั่งซื้อ \(รหัสนี้ทั้งใบ\)/);
  assert.doesNotMatch(built.html, /data-rf-open="stockCount"/, "a released order cannot be counted any more (jobs would not follow)");
  assert.match(env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26002")).html, /data-rf-open="stockCount"/, "a draft order can be counted");
  assert.match(built.html, /p=find&amp;code=DEMO-TP-01/, "each ordered product links to its product page");
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
  assert.match(env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26002&tab=req")).html, /SE-HL24-YE03-400-19-30[\s\S]*?<td class="right rf-mono">0<div class="small bom-surplus">เกิน 24<\/div>/, "the summary tab shows what to make (never negative) and the surplus apart");
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
  assert.match(html, /name="itemCode\[\]" value="BG-0092"/, "every counted kind is listed with all=1");
  assert.doesNotMatch(html, /name="itemCode\[\]" value="(P-BOX-01|DEMO-HL-24\(B\)-A)"/, "purchased parts are counted on the part stock page, and never the FG");
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
  assert.match(html, /ยังไม่ได้คำนวณวัตถุดิบ/);
  assert.doesNotMatch(html, /data-rf-form="setStockCounts"/);
  clean(await env.render("p=count&order=DEMO-26002&all=1"));
  // แผนกอื่นไม่เห็นเมนู
  env.store.setUser("B05");
  assert.match(await env.render("p=count"), /ไม่มีสิทธิ์เข้าถึงหน้านี้/);
});

test("a product of the order that is also a component of another product gets no count field (its figure is the amount from stock the planner sets at step 2), the other items still do", async () => {
  const env = load();
  env.store.setUser("B03");
  const product = "DEMO-HL-24(B)-A";
  const se = "SE-HL24-YE03-400-19-30";
  // ชุดรวมที่มีห่วงฮูล่า (สินค้าของใบเดียวกัน) เป็นส่วนประกอบ
  assert.equal(env.store.run("saveItem", { code: "KIT-01", kind: "FG", name: "ชุดรวมห่วงฮูล่า", uom: "set", create: true }).ok, true);
  // saveBom refuses a finished product as a component now, so the kit is the data an older version stored
  const refused = env.store.run("saveBom", { itemCode: "KIT-01", lines: [{ childCode: product, qty: 1 }] });
  assert.equal(refused.ok, false);
  assert.match(refused.error?.message, /สินค้าสำเร็จรูปใช้เป็นส่วนประกอบไม่ได้/);
  const kit = env.store.data().items.find((entry) => entry.code === "KIT-01");
  env.store.data().boms.push({ id: "BOM-KIT-01", itemCode: "KIT-01", revision: 1, status: "approved", ownerDept: kit.ownerDept, lines: [{ childCode: product, qty: 1, uom: "set", consumerDept: kit.ownerDept, producerDept: "PK", scrapPct: 0 }], createdBy: "test", createdAt: kit.createdAt, approvedBy: "test", approvedAt: kit.createdAt, note: "", changeLog: [] });
  const added = env.store.run("addOrderItem", { orderId: "DEMO-26002", fgCode: "KIT-01", qty: 2 });
  assert.equal(added.ok, true, added.error?.message);
  assert.equal(env.store.run("explodeOrder", { orderId: "DEMO-26002" }).ok, true);
  const order = env.store.data().orders.find((entry) => entry.id === "DEMO-26002");
  assert.ok(order.explosion.some((line) => line.itemCode === product && line.level > 0), "the product is also a component of the kit");
  const field = (code) => new RegExp(`name="itemCode\\[\\]" value="${code.replace(/[()]/g, "\\$&")}"`);
  const countButton = (code) => new RegExp(`data-rf-open="stockCount" data-rf-args="[^"]*${code.replace(/[()]/g, "\\$&")}[^"]*"`);
  const D = env.context.MNP_BOM_DIALOGS;
  for (const user of ["B08", "B09", "B03"]) { // ST · WH · ฝ่ายวางแผน
    env.store.setUser(user);
    let html = await env.render("p=count&order=DEMO-26002&all=1");
    clean(html);
    assert.doesNotMatch(html, field(product), `${user}: no count field for the product`);
    assert.match(html, field(se), `${user}: the other items are still counted`);
    html = await env.render("p=orders&sel=DEMO-26002&tab=bom");
    clean(html);
    assert.doesNotMatch(html, countButton(product), `${user}: no count button on the product's lines`);
    assert.match(html, countButton(se), `${user}: a count button on the other items`);
    assert.equal(D.stockCount(env.ctx("p=orders&sel=DEMO-26002"), { orderId: "DEMO-26002", itemCode: product }), null, `${user}: the count dialog does not open for the product`);
    assert.ok(D.stockCount(env.ctx("p=orders&sel=DEMO-26002"), { orderId: "DEMO-26002", itemCode: se }), `${user}: it opens for the other items`);
  }
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

test("leaving the BOM table from the step-3 card (switch product, back to the order) asks first when the table has unsaved edits", async () => {
  const env = load();
  env.store.setUser("B03"); // ฝ่ายวางแผน
  const query = "p=build&code=DEMO-TP-01(P)-Y&focus=NOPE-123&order=DEMO-26001";
  const html = await env.render(query);
  assert.match(html, /<a data-bom-build-nav [^>]*href="[^"]*NOPE-123[^"]*">เปิดตารางของ NOPE-123<\/a>/, "the links of the card are marked for the unsaved-edits check");
  const handlers = {};
  const qty = { name: "qty[]", type: "text", value: "2" };
  const fields = [{ name: "itemName", type: "text", value: "ตอปิโด" }, qty];
  const form = { querySelectorAll: () => fields };
  const link = { getAttribute: (name) => (name === "href" ? "#/bom?p=build&code=DEMO-TP-01(P)-B&focus=X&order=DEMO-26001" : null), addEventListener: (type, handler) => { handlers[type] = handler; } };
  env.context.MNP_BOM_PAGES.build(env.ctx(query)).bind({ querySelector: (selector) => (selector === "#bom-tree-form" ? form : null), querySelectorAll: (selector) => (selector === "[data-bom-build-nav]" ? [link] : []) });
  const click = async () => { const event = { prevented: false, preventDefault() { this.prevented = true; } }; await handlers.click(event); return event.prevented; };
  env.log.hash = `#/bom?${query}`;
  assert.equal(await click(), false, "nothing changed: the link opens normally");
  assert.equal(env.log.confirms.length, 0);
  qty.value = "3";
  env.log.confirmAnswer = false;
  assert.equal(await click(), true);
  assert.equal(env.log.hash, `#/bom?${query}`, "a cancelled dialog stays on the table");
  assert.equal(env.log.confirms.at(-1).title, "ทิ้งการแก้ไขที่ยังไม่บันทึก?");
  assert.equal(env.log.confirms.at(-1).danger, true);
  fields.push({ name: "rowId[]", type: "hidden", value: "n1" });
  qty.value = "2";
  assert.equal(await click(), true, "an added row counts as an edit too");
  env.log.confirmAnswer = true;
  assert.equal(await click(), true);
  assert.equal(env.log.hash, "#/bom?p=build&code=DEMO-TP-01(P)-B&focus=X&order=DEMO-26001", "confirmed: the other product opens");
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
  const cardTitles = [...html.matchAll(/<h2>([A-Z]{2}) <span class="muted">/g)].map((match) => match[1]);
  assert.deepEqual(cardTitles, ["ST", "RB", "GR", "PT", "PK"], "cards follow the company flow and skip departments without work (no BG in this product)");
  assert.match(html, /ต้องรีด/);
  assert.match(html, /RB-DM01-02-OR01-202-18-70[\s\S]*?<strong>7\.74<\/strong>/, "80 sets × 3 SE / 31 pieces per rod — the BOMSHEET number, before any stock");
  assert.match(html, /ตัด 6\.5 ซม\. · 31 ชิ้น\/เส้น · 1 SE ต่อ GR/, "GR sees the cutting data of the rod it cuts");
  assert.match(html, /ผูก RubberFlow แล้ว/);
  assert.match(html, /สินค้าสำเร็จรูป<\/span>/, "the FG row sits in the PK card");
  assert.match(html, /<h2>DEMO-TP-01\(P\)-Y <span class="muted">[^<]+<\/span> × 80 ชุด<\/h2>/);
  assert.match(html, /ลึกสุด 2 ชั้น/);
  assert.doesNotMatch(html, /<dt>สินค้า<\/dt>|<dt>จำนวนที่คิด<\/dt>|รายการ<\/span><\/h2>/, "the product, quantity and row counts are shown once (title, picker, tables)");
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
  assert.match(sub, /งานที่ต้องทำ">\d+</);
  assert.doesNotMatch(sub, /รออนุมัติ/);
  env.store.setUser("B01");
  await env.render("p=jobs");
  const bossTab = Number(/>ต้องทำ (\d+)</.exec(await env.render("p=work"))?.[1]);
  assert.ok(bossTab > 0, "a boss has open cards across the departments");
  assert.match(env.module.nav[0].subnav("bom"), new RegExp(`งานที่ต้องทำ">${bossTab}<`), "and the menu number is the card count of the open tab, not zero");
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
  // ขั้นตอนผลิตเลือกได้เฉพาะของแผนกที่เป็นเจ้าของชิ้นงาน (ไม่มีชื่อแผนกต่อท้าย) · ขั้นของแผนกอื่นที่ลำดับเดิมใช้อยู่ยังอยู่ พร้อมชื่อแผนก
  assert.match(dialog.html, /<option value="PK-02"[^>]*>PK-02 ใส่สินค้าในกระเป๋า \(จาก BG\)<\/option>/, "a same-department step has no department suffix");
  assert.doesNotMatch(dialog.html, /<option value="(?:GR|PT|RB)-\d+"/, "steps of other departments are not offered");
  const liveRouting = A.helpers.routingOf(live, "DEMO-TP-01(P)-Y");
  liveRouting.steps.push({ processCode: "GR-01", minutesPerPc: 1, inputs: [] });
  const withOther = D.routingEdit(env.ctx("p=structure"), { code: "DEMO-TP-01(P)-Y" });
  assert.match(withOther.html, /<option value="GR-01"[^>]*>GR-01 [^<]*\(GR\)<\/option>/, "a step of another department already in the routing stays, labelled with its department");
  assert.doesNotMatch(withOther.html, /<option value="GR-02"/, "other steps of that department are still not offered");
  liveRouting.steps.pop();
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
  assert.match(html, /<h2>สูตรยาง <span class="muted">ผสมโดย RB ตามสูตรใน RubberFlow<\/span>/);
  assert.match(html, /DM01[\s\S]*?RC-EPDM-DS01[\s\S]*?ผูกแล้ว[\s\S]*?<strong>11\.85<\/strong>/, "7.74 rods × 1.53 kg");
  assert.deepEqual([...html.matchAll(/<h2>([A-Z]{2}) <span class="muted">/g)].map((match) => match[1]), ["ST", "RB", "GR", "PT", "PK"], "the department cards are unchanged");
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
  assert.doesNotMatch(html, /คำนวณวัตถุดิบล่าสุด/, "a reopened order no longer claims a calculation");
  assert.doesNotMatch(html, /ระเบิด BOM/, "the old name is gone from the page");
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
  // วงจรหลายชั้น: ชิ้นที่ BOM อนุมัติของมันมีบรรพบุรุษอยู่ข้างใต้ (DEMO-TP-01 → SE → RB) ตัวอย่างต้องข้ามเหมือนตอนบันทึก
  const deepCycle = tools.pastePlan(env.ctx("p=build"), "DEMO-TP-01(P)-Y\t1\nP-STK-01\t1", { parentKind: "SE", ancestors: ["RB-DM01-02-OR01-202-18-70"] });
  assert.deepEqual(json(deepCycle.rows.map((row) => row.status)), ["error", "known"], "only the row whose tree reaches an ancestor is skipped");
  assert.match(deepCycle.rows[0].error, /RB-DM01-02-OR01-202-18-70 อยู่ข้างใต้ จะเป็นวงจร/);
  assert.equal(deepCycle.addable, 1);
  assert.equal(tools.pastePlan(env.ctx("p=build"), "SE-TP01-OR01-100-18-65\t1", { parentKind: "FG", ancestors: ["P-ROPE-01"] }).rows[0].status, "known", "an ancestor outside the pasted tree is no cycle");
  assert.match(tools.pastePlan(env.ctx("p=build"), "DEMO-TP-01(P)-Y\t1", { parentKind: "FG", ancestors: ["P-ROPE-01"] }).rows[0].error, /สินค้าสำเร็จรูปใช้เป็นส่วนประกอบไม่ได้/, "a finished product is never a component");
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
  assert.match(html, /สินค้า \(FG\) ที่ยังไม่มี BOM/);
  assert.match(html, /รหัสที่ระบบสร้างให้ \(XP-…\)/);
  assert.doesNotMatch(html, /ใช้ใน BOM แล้วแต่ยังไม่มี BOM/, "a group with nothing to fix is not shown");
  assert.match(html, /href="#\/bom\?p=build&amp;code=DEMO-BL-60%28K%29-Z"[^>]*>สร้าง BOM/, "the fix link opens the builder on that item");
  assert.match(html, /data-rf-open="itemEdit" data-rf-args="[^"]*XP-00001[^"]*"/, "or the item dialog");
  assert.doesNotMatch(html, /BOM ยังไม่มีบรรทัดสูตรยาง/);
  // ชิ้นที่ถูกใช้แล้วไม่มี BOM (MEGA-BBL-06)
  env.store.run("saveBom", { itemCode: "DEMO-BL-60(K)-Z", lines: [{ childCode: "SE-BL60-RD01-60-0-60", qty: 1 }] });
  html = await env.render("p=check");
  assert.match(html, /ใช้ใน BOM แล้วแต่ยังไม่มี BOM/);
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

test("in the in-browser demo a release opens no WOs: the confirm says nothing about RubberFlow and the jobs tab has no missing-WO callout", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=orders&sel=DEMO-26002&step=3");
  assert.match(html, /data-rf-confirm="ปล่อยผลิต DEMO-26002\? ระบบจะล็อกฉบับแก้ไขของ BOM และสร้างงานรายแผนก"/);
  assert.doesNotMatch(html, /เปิด WO ใน RubberFlow/);
  assert.equal(env.store.run("releaseOrder", { orderId: "DEMO-26002" }).ok, true);
  html = await env.render("p=orders&sel=DEMO-26002&tab=jobs");
  clean(html);
  assert.doesNotMatch(html, /งาน RB ที่ยังไม่มี WO ใน RubberFlow/, "demo jobs are linked by hand; the database mode is the only one that opens WOs for you");
});

test("the part stock page: ST and WH count, the planning group and ST edit the safety stock, the list is searchable and paged, the history dialog lists the moves", async () => {
  const env = load();
  env.store.setUser("B08"); // ST
  let html = await env.render("p=stock");
  clean(html);
  assert.match(html, /data-rf-form="countPartStock"/);
  assert.match(html, /name="itemCode\[\]" value="P-BOX-01"/);
  assert.match(html, /name="qty\[\]"[^>]*value="5"/, "the counted balance of the demo box");
  assert.match(html, /name="safetyQty\[\]"/, "ST edits the safety stock");
  assert.match(html, /name="safetyQty\[\][^>]*value="\d/, "ST's safety input carries the stored value");
  assert.doesNotMatch(html, /value="(SE|RB|BG|PT)-/, "only purchased parts are listed");
  assert.match(html, /data-rf-open="partHistory"/);
  assert.match(html, /—/, "no RubberFlow purchase data in this run: the on-order column shows a dash");
  html = await env.render("p=stock&q=box");
  assert.match(html, /P-BOX-01/);
  assert.doesNotMatch(html, /value="P-STK-01"/, "search narrows the list");
  assert.match(await env.render("p=stock&q=zzzz"), /ไม่พบของซื้อที่ค้นหา/);
  env.store.setUser("B03"); // ฝ่ายวางแผน
  html = await env.render("p=stock");
  assert.match(html, /name="safetyQty\[\]"[^>]*value="10"/, "the planner edits the safety stock");
  // ผู้ที่เข้าหน้านี้ได้แต่ตั้งสต็อกขั้นต่ำไม่ได้ (WH นับได้อย่างเดียว) เห็นเป็นตัวเลข: จำลองด้วยสิทธิ์ที่ canSetSafety ปฏิเสธ
  const stockCtx = env.ctx("p=stock");
  const asWh = { ...stockCtx, user: { id: "WH1", role: "wh", dept: "WH", name: "คลังสินค้า" }, helpers: stockCtx.helpers };
  const whHtml = env.context.MNP_BOM_PAGES.stock(asWh).html;
  assert.match(whHtml, /name="qty\[\]"/, "WH still counts the balance");
  assert.doesNotMatch(whHtml, /name="safetyQty\[\]"/, "WH cannot edit the safety stock");
  env.store.setUser("B04"); // RB: เมนูนี้ไม่มี
  assert.match(await env.render("p=stock"), /ไม่มีสิทธิ์เข้าถึงหน้านี้/);

  // หลายร้อยรายการ: แสดง 100 แล้ว "แสดงเพิ่ม"
  env.store.setUser("B03");
  const data = env.store.data();
  for (let n = 0; n < 250; n += 1) data.items.push({ code: `P-BULK-${String(n).padStart(3, "0")}`, kind: "PURCHASED", name: `ของซื้อ ${n}`, uom: "pcs", ownerDept: "ST", active: true });
  html = await env.render("p=stock");
  assert.equal((html.match(/name="itemCode\[\]"/g) ?? []).length, 100);
  assert.match(html, /แสดงเพิ่ม \(อีก 15\d\)/);
  assert.equal((await env.render("p=stock&n=200")).match(/name="itemCode\[\]"/g).length, 200);

  // ประวัติของชิ้น
  const D = env.context.MNP_BOM_DIALOGS;
  env.store.setUser("B08");
  const history = D.partHistory(env.ctx("p=stock"), { code: "P-BOX-01" }).html;
  clean(history);
  assert.match(history, /นับ[\s\S]*\+5[\s\S]*สมศักดิ์ แก้วใส/);
  assert.equal(D.partHistory(env.ctx("p=stock"), { code: "NOPE" }), null);
});

test("issuing parts from the PI page: the dialog has a tick box and an editable quantity per line, a short line starts unticked and marked and offers the purchase, one button issues the ticked lines; part jobs have no report buttons", async () => {
  const env = load();
  env.store.setUser("B08"); // ST
  const D = env.context.MNP_BOM_DIALOGS;
  let html = await env.render("p=orders&sel=DEMO-26001");
  assert.match(html, /data-rf-open="issueParts"[^>]*>เบิกจ่ายของซื้อ</, "ST sees the issue button of a PI with parts left");
  assert.doesNotMatch(html, /data-rf-open="stockCount"/, "no per-PI counting of a released PI, and none for purchased parts");
  let dialog = D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html;
  clean(dialog);
  assert.match(dialog, /P-BOX-01[\s\S]*ขาด 2/, "the shortage of the boxes (7 needed, 5 on hand)");
  assert.match(dialog, /สต็อกไม่พอเบิกส่วนที่เหลือ 1 รายการ จึงไม่ได้เลือกไว้/);
  assert.doesNotMatch(dialog, /ทุกรายการพร้อมกัน|data-rf-action="issueOrderParts"/, "no more all-at-once wording or button");
  // หนึ่งช่องเลือกต่อบรรทัด มีชื่อที่อ่านได้ · บรรทัดที่พอเลือกไว้ บรรทัดที่ขาดไม่เลือกและช่องจำนวน/รหัสปิดไว้ (ไม่ถูกตรวจและไม่ถูกส่ง)
  assert.equal((dialog.match(/type="checkbox" data-bom-issue-pick/g) ?? []).length, 7);
  assert.match(dialog, /<input type="checkbox" data-bom-issue-pick checked aria-label="เบิก P-STK-01 ครั้งนี้">/);
  assert.match(dialog, /<input type="checkbox" data-bom-issue-pick aria-label="เบิก P-BOX-01 ครั้งนี้">/, "the short line starts unticked");
  assert.match(dialog, /name="qty\[\]"[^>]*max="5" value="7" required data-bom-issue-field aria-label="จำนวนที่เบิก P-BOX-01 \(กล่อง\)" disabled>/, "its quantity is the remainder, capped by the stock, and off until ticked");
  assert.match(dialog, /name="itemCode\[\]" value="P-BOX-01" data-bom-issue-field disabled>/);
  assert.match(dialog, /name="qty\[\]"[^>]*max="400" value="120" required data-bom-issue-field aria-label="จำนวนที่เบิก P-STK-01 \(ชิ้น\)">/, "a covered line is prefilled with the remainder and can go up to the stock");
  assert.match(dialog, /data-rf-form="issueOrderParts" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26001&quot;\}"/);
  assert.match(dialog, /<button class="btn rf-btn" type="submit" form="bom-issue-parts-form">เบิกจ่ายรายการที่เลือก<\/button>/, "one button issues the ticked lines even when a line is short");
  // ติ๊ก/ไม่ติ๊ก: เปิด/ปิดช่องของบรรทัดนั้น (change ไม่ใช่ blur)
  const fields = [{ disabled: true }, { disabled: true }];
  const box = { checked: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, closest: () => ({ querySelectorAll: () => fields }) };
  const dialogNode = { querySelectorAll: (selector) => (selector === "[data-bom-issue-pick]" ? [box] : []), querySelector: () => null };
  D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).bind(dialogNode);
  assert.deepEqual(Object.keys(box.handlers), ["change"]);
  box.checked = true;
  box.handlers.change();
  assert.deepEqual(fields.map((field) => field.disabled), [false, false]);
  box.checked = false;
  box.handlers.change();
  assert.deepEqual(fields.map((field) => field.disabled), [true, true]);
  // สั่งซื้อเป็นสิทธิ์ของ RubberFlow ในโหมดฐานข้อมูล (แผนก ST) · โหมดสาธิตในเครื่องไม่มีใบสั่งซื้อ จึงไม่มีปุ่มให้ใคร และข้อความชี้ไปที่คลังวัตถุดิบ
  assert.doesNotMatch(dialog, /data-bom-parts-buy/, "no purchase button in the in-browser demo");
  assert.match(dialog, /แจ้งคลังวัตถุดิบ \(ST\) ให้สั่งซื้อหรือรับเข้า/);
  env.store.setUser("B03");
  dialog = D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html;
  assert.doesNotMatch(dialog, /data-bom-parts-buy/, "the planner does not order either");
  // โหมดฐานข้อมูล (จำลองสิทธิ์ของ RubberFlow): ผู้ที่สั่งได้เห็นปุ่มสั่งซื้อ ผู้ที่ดูได้อย่างเดียวเห็นปุ่มดูรายการ
  const withRights = (rights) => ({ ...env.ctx("p=orders&sel=DEMO-26001"), store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => rights.includes(permission) }) });
  assert.match(D.issueParts(withRights(["purchase"]), { orderId: "DEMO-26001" }).html, /data-bom-parts-buy>สั่งซื้อส่วนที่ขาด</);
  assert.match(D.issueParts(withRights(["viewPurchase"]), { orderId: "DEMO-26001" }).html, /data-bom-parts-buy>ดูรายการที่ต้องสั่ง</);
  assert.doesNotMatch(D.issueParts(withRights([]), { orderId: "DEMO-26001" }).html, /data-bom-parts-buy/);
  env.store.setUser("B08");
  assert.equal(env.store.run("countPartStock", { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }).ok, true);
  dialog = D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html;
  assert.equal((dialog.match(/data-bom-issue-pick checked/g) ?? []).length, 7, "with stock for every line all lines start ticked");
  assert.match(dialog, /เบิกเฉพาะรายการที่เลือก เบิกไม่ครบส่วนที่เหลือเบิกครั้งหน้าได้/);
  assert.doesNotMatch(dialog, /data-bom-parts-buy/);
  // ส่งฟอร์ม (บรรทัดที่เลือก = itemCode[] + qty[]): เบิกกล่อง 3 จาก 7 อย่างเดียว · ไม่เลือกเลย = แจ้งให้เลือก ไม่เขียนอะไร
  await env.submit("p=orders&sel=DEMO-26001", "issueOrderParts", {}, { orderId: "DEMO-26001" });
  assert.match(env.log.toasts.at(-1)[0], /เลือกรายการที่จะเบิกอย่างน้อยหนึ่งรายการ/);
  await env.submit("p=orders&sel=DEMO-26001", "issueOrderParts", { "itemCode[]": ["P-BOX-01"], "qty[]": ["3"] }, { orderId: "DEMO-26001" });
  const box01 = () => env.store.data().jobs.find((job) => job.orderId === "DEMO-26001" && job.dept === "ST" && job.itemCode === "P-BOX-01");
  assert.deepEqual([box01().status, box01().qtyDone], ["in_progress", 3]);
  dialog = D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html;
  clean(dialog);
  // ต้องเบิก = ส่วนที่เหลือ · ที่เบิกไปแล้วอยู่ใน title และข้อความสำหรับโปรแกรมอ่านหน้าจอ ไม่ใช่บรรทัดถาวร
  assert.match(dialog, /<td class="right rf-mono" title="เบิกแล้ว 3 จาก 7">4 <span class="small muted">กล่อง<\/span><span class="sr-only"> \(เบิกแล้ว 3 จาก 7\)<\/span><\/td>/, "the next issue offers the remainder and says what was issued in the title");
  assert.doesNotMatch(dialog, /<div class="small muted">เบิกแล้ว/, "no permanent issued line under the number");
  assert.match(dialog, /max="4" value="4" required data-bom-issue-field aria-label="จำนวนที่เบิก P-BOX-01/);
  // งานของคลังวัตถุดิบ: การ์ดรอเบิกแสดงส่วนที่เหลือ · ขั้น 4 บอกบรรทัดที่เบิกไปบางส่วน
  html = await env.render("p=work&dept=ST");
  assert.match(html, /กล่องนอก[^<]*<\/span><span class="nowrap">4 กล่อง</, "the waiting card shows the remainder of the partly issued line");
  env.store.setUser("B03");
  html = await env.render("p=orders&sel=DEMO-26001&step=4");
  assert.match(html, /รอเบิกของ 7 จาก 7 รายการ \(เบิกไปบางส่วน 1 รายการ\)/);
  env.store.setUser("B08");
  // คืนของเหลือ: บรรทัดที่ยังเบิกไม่ครบคืนไม่ได้ (ไม่มีปุ่มเมื่อมีแต่บรรทัดแบบนี้) · ยกเลิกการเบิกจ่ายมีให้
  html = await env.render("p=orders&sel=DEMO-26001");
  assert.doesNotMatch(html, /data-rf-open="returnParts"/);
  assert.match(html, /data-rf-open="undoParts"/);
  const partialReturn = D.returnParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html;
  assert.match(partialReturn, /name="qty\[\]" type="number" readonly[^>]*aria-label="P-BOX-01 ยังเบิกไม่ครบ คืนของเหลือได้เมื่อเบิกครบแล้ว"><div class="small muted">ยังเบิกไม่ครบ<\/div>/);
  assert.match(D.undoParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }).html, /P-BOX-01[\s\S]*3 กล่อง/, "the undo gives back the partly issued 3");
  // กด → เบิกจ่ายส่วนที่เหลือทั้งหมด → ไม่มีอะไรเหลือ: ปุ่มและ dialog หาย
  const issued = env.store.run("issueOrderParts", { orderId: "DEMO-26001" });
  assert.equal(issued.ok, true, issued.error?.message);
  assert.deepEqual([box01().status, box01().qtyDone], ["done", 7]);
  html = await env.render("p=orders&sel=DEMO-26001");
  assert.doesNotMatch(html, /data-rf-open="issueParts"/);
  assert.equal(D.issueParts(env.ctx("p=orders&sel=DEMO-26001"), { orderId: "DEMO-26001" }), null);
  assert.equal(D.issueParts(env.ctx("p=orders&sel=DEMO-26002"), { orderId: "DEMO-26002" }), null, "a draft order has no part jobs");
  // หน้างานแผนก ST: งานของซื้อไม่มีปุ่มรายงาน/พักงาน
  html = await env.render("p=jobs&dept=ST&st=all");
  assert.match(html, /P-BOX-01/);
  assert.doesNotMatch(html, /data-rf-open="jobReport"|data-rf-action="setJobStatus"/);
  const fresh = load();
  fresh.store.setUser("B08");
  html = await fresh.render("p=jobs&dept=ST");
  assert.match(html, /เบิกจ่ายที่ใบ PI/, "an open part job points to the PI page");
  assert.doesNotMatch(html, /data-rf-open="jobReport"|data-rf-action="setJobStatus"/, "and offers no report or hold");
});

test("returning parts from the PI page: the buttons appear only for ST and the planner once something is issued, the leftover dialog lists issued and returned, the undo dialog asks for a reason and the history shows the return with its reason", async () => {
  const env = load();
  const D = env.context.MNP_BOM_DIALOGS;
  const page = "p=orders&sel=DEMO-26001";
  env.store.setUser("B08"); // ST
  let html = await env.render(page);
  assert.doesNotMatch(html, /data-rf-open="returnParts"|data-rf-open="undoParts"/, "nothing issued yet → nothing to return");
  assert.equal(D.returnParts(env.ctx(page), { orderId: "DEMO-26001" }), null);
  assert.equal(D.undoParts(env.ctx(page), { orderId: "DEMO-26001" }), null);
  assert.equal(env.store.run("countPartStock", { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }).ok, true);
  assert.equal(env.store.run("issueOrderParts", { orderId: "DEMO-26001" }).ok, true);
  html = await env.render(page);
  assert.match(html, /data-rf-open="returnParts"[^>]*>คืนของเหลือ</);
  assert.match(html, /data-rf-open="undoParts"[^>]*>ยกเลิกการเบิกจ่าย</);
  // บทบาทอื่น: ไม่เห็นปุ่มและเปิด dialog ไม่ได้
  for (const id of ["B04", "B07"]) {
    env.store.setUser(id);
    html = await env.render(page);
    assert.doesNotMatch(html, /data-rf-open="returnParts"|data-rf-open="undoParts"/, id);
    assert.equal(D.returnParts(env.ctx(page), { orderId: "DEMO-26001" }), null, id);
    assert.equal(D.undoParts(env.ctx(page), { orderId: "DEMO-26001" }), null, id);
  }
  env.store.setUser("B03"); // ฝ่ายวางแผน
  html = await env.render(page);
  assert.match(html, /data-rf-open="returnParts"/);
  assert.match(html, /data-rf-open="undoParts"/);
  env.store.setUser("B08");
  // คืนของเหลือ: หนึ่งแถวต่อรายการที่เบิกจ่าย พร้อมช่องจำนวนและเหตุผล
  let dialog = D.returnParts(env.ctx(page), { orderId: "DEMO-26001" }).html;
  clean(dialog);
  assert.equal((dialog.match(/name="itemCode\[\]"/g) ?? []).length, 7);
  assert.equal((dialog.match(/name="qty\[\]"/g) ?? []).length, 7);
  assert.match(dialog, /data-rf-form="returnOrderParts" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26001&quot;\}"/);
  assert.match(dialog, /name="reason"[^>]*required/);
  assert.match(dialog, /P-STK-01[\s\S]*120/);
  const sent = env.store.run("returnOrderParts", { orderId: "DEMO-26001", lines: [{ itemCode: "P-STK-01", qty: 120 }], reason: "ใช้ไม่หมด" });
  assert.equal(sent.ok, true, sent.error?.message);
  dialog = D.returnParts(env.ctx(page), { orderId: "DEMO-26001" }).html;
  assert.match(dialog, /name="qty\[\]" type="number" readonly/, "an item that is fully returned has a read-only box (the rows keep their order)");
  assert.equal((dialog.match(/name="qty\[\]"/g) ?? []).length, 7);
  // ยกเลิกการเบิกจ่าย: ถามเหตุผลและบอกว่าทุกอย่างกลับเข้าสต็อก
  dialog = D.undoParts(env.ctx(page), { orderId: "DEMO-26001" }).html;
  clean(dialog);
  assert.match(dialog, /data-rf-form="undoOrderParts"/);
  assert.match(dialog, /name="reason"[^>]*required/);
  assert.match(dialog, /กลับเข้าสต็อก/);
  assert.doesNotMatch(dialog, /P-STK-01/, "the fully returned item has nothing left to give back");
  assert.match(dialog, /P-BOX-01/);
  assert.equal(env.store.run("undoOrderParts", { orderId: "DEMO-26001", reason: "เบิกผิดใบ" }).ok, true);
  html = await env.render(page);
  assert.doesNotMatch(html, /data-rf-open="returnParts"|data-rf-open="undoParts"/, "after the undo nothing is issued again");
  assert.match(html, /data-rf-open="issueParts"/, "and the issue button is back");
  // ประวัติของชิ้น: ชนิดคืนและเหตุผล
  const history = D.partHistory(env.ctx("p=stock"), { code: "P-STK-01" }).html;
  clean(history);
  assert.match(history, /คืน[\s\S]*DEMO-26001[\s\S]*ใช้ไม่หมด/);
  const box = D.partHistory(env.ctx("p=stock"), { code: "P-BOX-01" }).html;
  assert.match(box, /คืน[\s\S]*เบิกผิดใบ/);
  // บันทึกการใช้งานเรียกชื่อการกระทำเป็นภาษาไทย
  assert.ok(env.store.data().audit.some((row) => row.action === "ยกเลิกการเบิกจ่ายของซื้อ"));
  // เบิกจ่ายใหม่แล้วคืนของเหลือครบทุกรายการ: ปุ่มคืนของเหลือหายไป แต่ยกเลิกการเบิกจ่ายยังอยู่ (พางานกลับเป็นรอเบิกได้)
  assert.equal(env.store.run("issueOrderParts", { orderId: "DEMO-26001" }).ok, true);
  const rules = env.context.MNP_BOM_RULES;
  const all = rules.partReturnLines(env.store.data(), "DEMO-26001").filter((line) => line.returnable > 0).map((line) => ({ itemCode: line.itemCode, qty: line.returnable }));
  assert.ok(all.length > 0);
  assert.equal(env.store.run("returnOrderParts", { orderId: "DEMO-26001", lines: all, reason: "คืนครบ" }).ok, true);
  html = await env.render(page);
  assert.doesNotMatch(html, /data-rf-open="returnParts"/, "nothing left to return → no leftover button");
  assert.match(html, /data-rf-open="undoParts"/, "the undo stays");
});

test("a PI that closes while a part line is partly issued: the PI page offers the leftover return of that line (no issue, no undo), the dialog takes up to what was issued, and the ST work page has no dead waiting card", async () => {
  const env = load();
  const D = env.context.MNP_BOM_DIALOGS;
  const page = "p=orders&sel=DEMO-26001";
  env.store.setUser("B08"); // ST
  const issued = env.store.run("issueOrderParts", { orderId: "DEMO-26001", lines: [{ itemCode: "P-STK-01", qty: 50 }] });
  assert.equal(issued.ok, true, issued.error?.message);
  let html = await env.render("p=work&dept=ST");
  assert.match(html, /เบิกของตามใบ DEMO-26001/, "while the PI is open the waiting card is there");
  // แถวงานของซื้อของใบนี้ที่หน้างานแผนก (ใบยังเปิด = มีลิงก์ไปเบิก)
  const rowsOf = (text) => text.split("<tr").filter((row) => row.includes("orders&amp;sel=DEMO-26001") || row.includes("orders&sel=DEMO-26001"));
  html = await env.render("p=jobs&dept=ST");
  assert.ok(rowsOf(html).some((row) => row.includes("เบิกจ่ายที่ใบ PI")), "while the PI is open its part jobs link to the issue");
  html = await env.render(page);
  assert.doesNotMatch(html, /data-rf-open="returnParts"/, "an open PI: the partly issued line takes no leftover return");
  // ใบปิด (คลังสินค้ารับครบ / ปิดใบรับไม่ครบ) ขณะบรรทัดยังเบิกไม่ครบ
  env.store.data().orders.find((order) => order.id === "DEMO-26001").status = "completed";
  html = await env.render(page);
  assert.match(html, /data-rf-open="returnParts"[^>]*>คืนของเหลือ</, "the closed PI offers the leftover return of the partly issued line");
  assert.doesNotMatch(html, /data-rf-open="issueParts"|data-rf-open="undoParts"/, "but no issue and no undo");
  assert.equal(D.issueParts(env.ctx(page), { orderId: "DEMO-26001" }), null);
  assert.equal(D.undoParts(env.ctx(page), { orderId: "DEMO-26001" }), null);
  const dialog = D.returnParts(env.ctx(page), { orderId: "DEMO-26001" }).html;
  clean(dialog);
  assert.match(dialog, /name="qty\[\]" type="number" inputmode="decimal" step="any" min="0" max="50" placeholder="0" aria-label="จำนวนที่คืน P-STK-01/, "the line is editable up to the 50 issued");
  assert.doesNotMatch(dialog, /ยังเบิกไม่ครบ/);
  const sent = env.store.run("returnOrderParts", { orderId: "DEMO-26001", lines: [{ itemCode: "P-STK-01", qty: 50 }], reason: "ปิดใบแล้วเหลือ" });
  assert.equal(sent.ok, true, sent.error?.message);
  assert.equal(env.store.data().stock.find((row) => row.itemCode === "P-STK-01").qty, 400, "the 50 are back in stock");
  html = await env.render(page);
  assert.doesNotMatch(html, /data-rf-open="returnParts"/, "nothing left to return");
  // งานของฉัน (ST) และหน้างานแผนก: ใบที่ปิดแล้วไม่มีการ์ดรอเบิกหรือปุ่มเบิกจ่ายที่กดอะไรไม่ได้
  html = await env.render("p=work&dept=ST");
  assert.doesNotMatch(html, /เบิกของตามใบ DEMO-26001/, "no waiting card for a closed PI");
  // หน้างานของแผนก: บรรทัดของซื้อของใบที่ปิดแล้วไม่ใช่งานค้าง (ไม่อยู่ในค้างอยู่ ไม่นับบนแท็บ) อยู่ในแท็บทั้งหมดโดยไม่มีปุ่มเบิก ไม่เลยกำหนด และสถานะบอกว่าใบปิดแล้ว
  // (กำหนดเบิกของใบนี้ย้อนไปในอดีต: ถ้ายังนับเป็นงานค้างจะขึ้นเลยกำหนด)
  for (const job of env.store.data().jobs) if (job.orderId === "DEMO-26001" && job.dept === "ST") job.dueAt = 1;
  html = await env.render("p=jobs&dept=ST");
  assert.equal(rowsOf(html).length, 0, "the closed PI's part lines are not open work");
  // ใบสาธิตอื่นที่ยังเปิด (DEMO-26006 / 26007) มีงานของซื้อค้างจริง: แท็บนับเฉพาะงานเหล่านั้น ไม่นับบรรทัดของใบที่ปิดแล้ว
  const openSt = env.store.data().jobs.filter((job) => job.dept === "ST" && job.status !== "done" && ["released", "in_progress"].includes(env.store.data().orders.find((order) => order.id === job.orderId)?.status)).length;
  assert.match(html, new RegExp(`>ST \\(${openSt}\\)<`), "the ST tab counts no job of the closed PI");
  html = await env.render("p=jobs&dept=ST&st=all");
  assert.ok(rowsOf(html).length > 0 && rowsOf(html).every((row) => !row.includes("เบิกจ่ายที่ใบ PI")), "no issue link on the closed PI's part jobs");
  assert.ok(rowsOf(html).every((row) => !row.includes("เลยกำหนด") && !row.includes('class="is-late"') && row.includes(">ใบปิดแล้ว<")), "no overdue mark, and the status says the PI is closed");
  env.store.setUser("B03"); // ฝ่ายวางแผน: แท็บ ST ของงานของฉันไม่นับการ์ดนั้น
  html = await env.render("p=work&dept=ST");
  assert.doesNotMatch(html, /เบิกของตามใบ DEMO-26001/);
  // แท็บงานรายแผนกของหน้าใบ: บรรทัดของซื้อไม่เลยกำหนดและสถานะบอกว่าใบปิดแล้ว (ใบที่ปิดแล้วเปิดที่ขั้น 6 ขั้น 4 ไม่แสดง)
  html = await env.render(`${page}&tab=jobs`);
  clean(html);
  const stRows = html.split("<tr").filter((row) => row.includes('<span class="rf-badge">ST</span>'));
  assert.ok(stRows.length > 0 && stRows.every((row) => !row.includes('class="is-late"') && row.includes(">ใบปิดแล้ว<")), "the order's job tab shows the part lines as closed, not overdue");
  // ทุกงานของใบที่ปิดแล้ว (ไม่ใช่แค่บรรทัดของซื้อ: 20261125010000) ไม่ค้างและไม่เลยกำหนด สถานะบอกว่าใบปิดแล้ว
  for (const job of env.store.data().jobs) if (job.orderId === "DEMO-26001" && job.dept === "RB") job.dueAt = 1;
  html = await env.render("p=jobs&dept=RB");
  assert.equal(rowsOf(html).length, 0, "the closed PI's open RB jobs are not open work");
  // งาน RB ที่ค้างจริงเหลือเฉพาะของใบสาธิตอื่นที่ยังเปิด (DEMO-26006 / 26007 ที่ผูก WO)
  const openRb = env.store.data().jobs.filter((job) => job.dept === "RB" && job.status !== "done" && ["released", "in_progress"].includes(env.store.data().orders.find((order) => order.id === job.orderId)?.status)).length;
  assert.match(html, new RegExp(`>RB \\(${openRb}\\)<`), "the RB tab counts no job of the closed PI");
  html = await env.render("p=jobs&dept=RB&st=all");
  assert.ok(rowsOf(html).filter((row) => !row.includes(">เสร็จ<")).every((row) => !row.includes('class="is-late"') && row.includes(">ใบปิดแล้ว<") && !row.includes("data-rf-open=\"jobReport\"")),
    "unfinished RB jobs of the closed PI are neither overdue nor reportable, and say the PI is closed");
  // ภาพรวม: งานค้างไม่นับงานใดของใบที่ปิดแล้ว
  // ใบสาธิต DEMO-26008 ปิดแล้วเช่นกัน (ส่งมอบครบ งานของซื้อยังไม่เบิก) จึงไม่นับ
  const openOnDashboard = env.store.data().jobs.filter((job) => job.status !== "done" && job.orderId !== "DEMO-26001" && job.orderId !== "DEMO-26008").length;
  html = await env.render("p=dashboard");
  assert.match(html, new RegExp(`<span class="rf-stat-label">งานค้าง</span><strong class="rf-stat-value">${openOnDashboard}</strong>`), "the dashboard's open-job count leaves every job of the closed PI out");
});

test("import page: the group selected when pressing import is saved on new items, and a second import reuses the XP- subpart", async () => {
  const env = load();
  env.store.setUser("B03");
  const paste = { ...env.root, value: "" };
  const report = { ...env.root, innerHTML: "" };
  const importButton = { ...env.root, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  report.querySelector = (selector) => (selector === "[data-bom-import]" && /data-bom-import/.test(report.innerHTML) ? importButton : null);
  const check = { ...env.root, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const group = { value: "TOY" };
  const rootNode = { ...env.root, querySelector: (selector) => ({ "[data-bom-paste]": paste, "[data-bom-report]": report, "[data-bom-check]": check, "[data-bom-group]": group, "[data-bom-source]": { value: "กลุ่ม.tsv" } })[selector] ?? null, querySelectorAll: () => [] };
  const ctx = env.ctx("p=import");
  const page = env.context.MNP_BOM_PAGES.import(ctx);
  page.bind(rootNode, ctx);
  paste.value = ["ITEM\tCODE\tNAME\tรหัสแผนก\tแผนกผู้ผลิต\tจำนวนที่ใช้ต่อชุด\tหน่วยนับ", "G-01(P)-Y\tG-01\tสินค้า G\tPK\tPK\t-\tชุด", "G-01(P)-Y\t-\tแกน G\tPK\tPK-PK\t1\tชิ้น/pcs"].join("\n");
  check.handlers.click(); // the auto-check after choosing a sheet, with the group still TOY
  assert.match(report.innerHTML, /ใหม่ 1/);
  group.value = "IND"; // the user changes the group after the check, then imports
  assert.match(report.innerHTML, /แก้ได้ที่หน้า “สินค้า”/, "the note names the products page, not a menu that no longer exists");
  assert.doesNotMatch(report.innerHTML, /เมนู “สร้าง BOM”/);
  importButton.handlers.click({ currentTarget: importButton });
  assert.equal(env.log.hash, "#/bom?p=find", "after importing the user lands on the products page");
  const items = () => env.ctx("p=import").data.items;
  assert.equal(items().find((item) => item.code === "G-01(P)-Y")?.group, "IND");
  const subpart = items().filter((item) => item.kind === "SUBPART" && item.name === "แกน G");
  assert.equal(subpart.length, 1);
  assert.equal(subpart[0].group, "IND", "the preview never fixed the group: the selector at import time decides");
  const before = items().filter((item) => item.kind === "SUBPART").length;
  env.context.MNP_BOM_PAGES.import(env.ctx("p=import")).bind(rootNode, env.ctx("p=import")); // the page renders again after an import
  check.handlers.click(); // the same sheet again
  assert.match(report.innerHTML, /ใช้รหัสเดิม 1/);
  group.value = "TOY";
  importButton.handlers.click({ currentTarget: importButton });
  assert.equal(items().filter((item) => item.kind === "SUBPART").length, before, "no new XP- code on re-import");
  assert.equal(items().find((item) => item.code === "G-01(P)-Y")?.group, "IND", "existing items keep their group");
});

test("house rules stay: required fields carry the shared marker, files are picked through the .file-pick button, empty states and statuses look the same everywhere", () => {
  const env = load();
  const ui = env.context.MNP_RUBBERFLOW_UI;
  assert.match(ui.field("ชื่อ", "<input>", { required: true }), /<label>ชื่อ <span class="field-required">\(จำเป็น\)<\/span><\/label>/);
  assert.doesNotMatch(ui.field("ชื่อ", "<input>"), /field-required/);
  assert.match(ui.empty("ไม่มี"), /^<div class="empty empty-state rf-empty">.*<p>ไม่มี<\/p><\/div>$/);
  assert.match(ui.filePick("f1", "", "เลือกไฟล์ Excel", { title: "t" }), /^<label class="btn secondary file-pick" for="f1" title="t">.*เลือกไฟล์ Excel<\/label><input class="file-pick-input" id="f1" type="file">$/);
  assert.match(ui.urgent(), /^<span class="badge urgent-flag">ด่วน<\/span>$/);
  assert.match(ui.status("open"), /is-info/, "an open NCR is info, not red");
  assert.match(ui.status("in_progress"), /is-info/);
  assert.doesNotMatch(ui.status("cancelled"), /is-bad/, "cancelled is neutral");
  for (const file of FILES.filter((name) => /rubberflow-(pages|ui|documents)|module-rubberflow|bom-pages|module-bom|bom-store|bom-actions/.test(name))) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /field\((["`])[^"`\n]* \*\1/, `${file}: required fields use { required: true }, not " *"`);
    assert.doesNotMatch(source.split("\n").filter((line) => !line.includes("file-pick-input")).join("\n"), /<input[^>]*type="file"/, `${file}: no raw file input`);
    assert.doesNotMatch(source, /ui\.badge\("bad", "ด่วน"\)/, `${file}: urgent uses ui.urgent()`);
    assert.doesNotMatch(source, /<p class="muted">(ยังไม่มี|ไม่มี)/, `${file}: empty states use ui.empty`);
  }
  // every date field is turned into the Thai-date picker after a page or dialog is drawn
  for (const file of ["modules/module-rubberflow.js", "modules/module-bom.js"]) assert.equal((fs.readFileSync(file, "utf8").match(/ui\.enhanceDates\(/g) ?? []).length, 2, `${file}: page and dialogs`);
});

test("the Thai date picker drops required from the hidden native date input, so a blank date reaches the action's own message", () => {
  // ช่องที่ถูกซ่อน (input.hidden) ยัง required อยู่ เบราว์เซอร์จะไม่ยอมส่งฟอร์มและไม่บอกเหตุผล
  const ui = fs.readFileSync("modules/rubberflow-ui.js", "utf8");
  assert.match(ui, /const enhanceDates = \(scope\) => scope\?\.querySelectorAll\?\.\('input\[type="date"\]'\)\.forEach\(\(node\) => \{\s*if \(!root\.MNP_DATE_PICKER\?\.enhance\) return;\s*node\.required = false;\s*root\.MNP_DATE_PICKER\.enhance\(node\);/);
  for (const file of ["modules/module-rubberflow.js", "modules/module-bom.js"]) {
    assert.match(fs.readFileSync(file, "utf8"), /dialog\.querySelector\("input:not\(\[type=hidden\]\):not\(\[hidden\]\), select:not\(\[hidden\]\), textarea, \.date-pick-button"\)/, `${file}: first focus skips the hidden date input`);
  }
});

// ---------- โครงใหม่ 4 เมนู (modules/bom-hub.js) ----------
test("the menu has four entries and a bare #/bom opens the role's home: products for planners, own jobs for departments", async () => {
  const env = load();
  env.store.setUser("B03");
  const sub = env.module.nav[0].subnav("bom");
  assert.deepEqual([...sub.matchAll(/href="#\/bom\?p=(\w+)"/g)].map((match) => match[1]), ["find", "orders", "work", "setup"]);
  assert.match(await env.render(""), /<h1>สินค้า<\/h1>/, "planner home is the product search");
  env.store.setUser("B04");
  assert.match(await env.render(""), /<h1>งานของฉัน<\/h1>/, "a department lands on its own jobs");
  clean(await env.render("p=setup"));
});

test("the product page shows one item as a readable tree: an inverse ratio reads as pieces per rod, tabs embed the old pages without their own heads", async () => {
  const env = load();
  env.store.setUser("B03");
  const code = encodeURIComponent("DEMO-TP-01(P)-Y");
  let html = await env.render(`p=find&code=${code}&qty=80`);
  clean(html);
  assert.match(html, /<h1>ตอปิโดยาง TP-01 แพ็กถุง ชุดสี Y \(3 ชิ้น\/ชุด\)<\/h1>/);
  assert.match(html, /1 เส้น ได้ 31 ชิ้น/, "0.0323 rod per piece is shown as 31 pieces per rod");
  assert.match(html, /<strong>240 ชิ้น<\/strong>/, "3 per set × 80 sets");
  assert.match(html, /data-tree-toggle aria-expanded="true"/, "a small tree starts fully open");
  assert.equal((html.match(/<h1>/g) ?? []).length, 1);
  for (const tab of ["depts", "cost", "history"]) {
    html = await env.render(`p=find&code=${code}&tab=${tab}`);
    clean(html);
    assert.equal((html.match(/<h1>/g) ?? []).length, 1, `${tab}: the embedded page has no head of its own`);
    assert.doesNotMatch(html, /data-bom-pick/, `${tab}: no second product picker`);
    assert.doesNotMatch(html, /href="#\/bom\?p=(items|product|structure)[&"]/, `${tab}: links stay on the product page`);
  }
  assert.equal(env.context.MNP_BOM_PAGES.hub.ratioText(env.ctx(), 0.3, "pcs", "set"), "0.3000 ชิ้น", "a ratio that is not a whole inverse stays a plain quantity");
  env.store.setUser("B04");
  html = await env.render(`p=find&code=${code}`);
  assert.doesNotMatch(html, /แก้ BOM|data-rf-open="itemEdit"/, "a department cannot edit");
});

test("one BOM line can be edited from the product page: the dialog posts the whole BOM and an untouched ratio keeps its full precision", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "SE-TP01-OR01-100-18-65";
  const before = json(env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved"));
  const built = env.context.MNP_BOM_DIALOGS.lineEdit(env.ctx(), { parentCode: parent, childCode: before.lines[0].childCode });
  assert.equal((built.html.match(/name="childCode\[\]"/g) ?? []).length, before.lines.length, "every line travels with the form");
  const values = { "childCode[]": before.lines.map((line) => line.childCode), "qty[]": before.lines.map((line, index) => (index === 0 ? String(Math.round(line.qty * 1e6) / 1e6) : String(line.qty))), "scrapPct[]": before.lines.map((line, index) => (index === 0 ? "5" : String(line.scrapPct ?? 0))), "lineNote[]": before.lines.map((line) => line.note ?? ""), "lineStep[]": before.lines.map((line) => String(line.step ?? "")), origQty: String(before.lines[0].qty), note: "ทดสอบ" };
  await env.submit(`p=find&code=${parent}`, "saveBom", values, { itemCode: parent, editCode: before.lines[0].childCode });
  const after = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved");
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.lines.find((line) => line.childCode === before.lines[0].childCode).qty, before.lines[0].qty, "the rounded form value did not replace 1/31");
  assert.equal(after.lines.find((line) => line.childCode === before.lines[0].childCode).scrapPct, 5);
  assert.equal(after.lines.length, before.lines.length);
});

test("a PI opens as one page with a step bar: a draft is at step 2 with the shortage list, release sits on step 3, a released PI is at step 4", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  assert.match(html, /<li class="bom-step is-now" aria-current="step"><div><span class="bom-step-no">ขั้น 2<\/span>/);
  assert.match(html, /<strong class="bom-short-text">[\d.,]+ /, "purchased parts short of stock are listed");
  assert.doesNotMatch(html, /data-rf-action="releaseOrder"/, "no release button before step 3");
  assert.doesNotMatch(html, /bom-split/, "the PI list is not drawn beside an open PI");
  html = await env.render("p=orders&sel=DEMO-26002&step=3");
  assert.match(html, /data-rf-action="releaseOrder"/);
  html = await env.render("p=orders&sel=DEMO-26001");
  clean(html);
  assert.match(html, /aria-current="step"><div><span class="bom-step-no">ขั้น 4<\/span>/);
  assert.doesNotMatch(html, /data-rf-action="completeOrder"/, "nobody closes a PI by hand any more: the warehouse receiving closes it");
  assert.equal(env.context.MNP_BOM_PAGES.hub.orderStepOf(env.ctx(), { status: "draft", items: [] }), 1);
});

test("my jobs shows only the department's own jobs as cards, and the warehouse gets one card per PI for its purchased parts", async () => {
  const env = load();
  env.store.setUser("B04");
  let html = await env.render("p=work");
  clean(html);
  const open = env.store.data().jobs.filter((job) => job.dept === "RB" && job.status !== "done").length;
  assert.equal((html.match(/<article class="card rf-card bom-job/g) ?? []).length, open);
  assert.doesNotMatch(html, /role="tab"[^>]*>ทุกแผนก/, "no department switch for a department user");
  assert.equal((await env.render("p=work&dept=GR")).match(/<article class="card rf-card bom-job/g).length, open, "the dept parameter is ignored for a department user");
  env.store.setUser("B08");
  html = await env.render("p=work");
  clean(html);
  // ใบที่ปล่อยผลิตแล้วสามใบของชุดสาธิต (26001 · 26006 · 26007): งานของซื้อของแต่ละใบเป็นการ์ดเดียว
  assert.equal((html.match(/<article class="card rf-card bom-job/g) ?? []).length, 3, "the part jobs of each PI are one card");
  assert.match(html, /เบิกของตามใบ DEMO-26001/);
  assert.match(html, />ต้องทำ 3</, "the tab counts cards, not the part jobs");
  assert.match(env.module.nav[0].subnav("bom"), /rf-nav-count"[^>]*>3</, "and so does the menu badge");
  env.store.setUser("B04");
  html = await env.render("p=orders&sel=DEMO-26001");
  assert.equal((html.match(/>ดูงาน</g) ?? []).length, 1, "a department gets the jobs link on its own row only");
});

test("a component is added from the product tree with one small form: an existing code is appended, an unknown code creates the item, the other lines and child BOMs stay", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const bomOf = (code) => json(env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved"));
  const before = bomOf(parent);
  const childBefore = bomOf("SE-TP01-OR01-100-18-65");
  const dialog = env.context.MNP_BOM_DIALOGS.lineAdd(env.ctx(), { parentCode: parent });
  clean(dialog.html);
  assert.doesNotMatch(dialog.html, /<datalist|<option value="P-/, "items are searched in a popup, not listed in the markup");
  assert.equal(env.context.MNP_BOM_DIALOGS.lineAdd(env.ctx(), { parentCode: "P-STK-01" }), null, "a purchased part takes no components");
  // เส้นยาง: บรรทัดสูตรยางเปลี่ยนช่องสูตรของเส้นยางได้ ฟอร์มเพิ่มบรรทัดจึงไม่รับ (ทั้งปุ่ม หน้าต่าง และตัวแปลงฟอร์ม) แก้ที่หน้าต่างข้อมูลเส้นยาง
  const rod = "RB-DM01-02-OR01-202-18-70";
  const compound = env.store.data().items.find((item) => item.code === rod).rubber.compound;
  assert.equal(env.context.MNP_BOM_DIALOGS.lineAdd(env.ctx(), { parentCode: rod }), null, "no small add form under a rubber rod");
  await env.submit(`p=find&code=${rod}`, "saveBomTree", { addCode: "XCP-NEW", addQty: "1", newName: "สูตรใหม่", newKind: "CP", newUom: "kg" }, { lineAdd: true, code: rod });
  assert.match(env.log.toasts.at(-1)[0], /ข้อมูลเส้นยาง/);
  assert.equal(env.store.data().items.find((item) => item.code === rod).rubber.compound, compound, "the rod keeps its compound");
  assert.equal(env.store.data().items.some((item) => item.code === "XCP-NEW"), false);
  const query = `p=find&code=${encodeURIComponent(parent)}`;
  await env.submit(query, "saveBomTree", { addCode: "p-zip-05", addQty: "2", addScrap: "0", note: "" }, { lineAdd: true, code: parent });
  let after = bomOf(parent);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.lines.length, before.lines.length + 1);
  assert.equal(after.lines.find((line) => line.childCode === "P-ZIP-05").qty, 2);
  for (const line of before.lines) assert.equal(after.lines.find((entry) => entry.childCode === line.childCode).qty, line.qty, `${line.childCode} keeps its exact quantity`);
  assert.equal(bomOf("SE-TP01-OR01-100-18-65").revision, childBefore.revision, "a child's own BOM is not touched");
  env.log.toasts.length = 0;
  await env.submit(query, "saveBomTree", { addCode: "P-ZIP-05", addQty: "1" }, { lineAdd: true, code: parent });
  assert.match(env.log.toasts.at(-1)[0], /อยู่ใน BOM นี้แล้ว/);
  await env.submit(query, "saveBomTree", { addCode: "XP-T-NEW", addQty: "1", newName: "" }, { lineAdd: true, code: parent });
  assert.match(env.log.toasts.at(-1)[0], /ยังไม่มีรหัส XP-T-NEW ในทะเบียน/, "an unknown code needs a name before anything is saved");
  assert.equal(bomOf(parent).revision, after.revision);
  await env.submit(query, "saveBomTree", { addCode: "XP-T-NEW", addQty: "1", newName: "ชิ้นใหม่", newKind: "SUBPART", newUom: "pcs" }, { lineAdd: true, code: parent });
  after = bomOf(parent);
  assert.ok(after.lines.some((line) => line.childCode === "XP-T-NEW"));
  assert.equal(env.store.data().items.find((item) => item.code === "XP-T-NEW").name, "ชิ้นใหม่");
  const html = await env.render(query);
  assert.match(html, /data-rf-open="lineAdd"/, "the planner gets the add button above the tree");
  assert.match(html, />แก้หลายบรรทัด</, "the wide table stays one click away for bulk edits");
  env.store.setUser("B04");
  assert.doesNotMatch(await env.render(query), /data-rf-open="lineAdd"/, "a department cannot add components");
});

test("a new product is created from the product list with a four-field form", async () => {
  const env = load();
  env.store.setUser("B03");
  assert.match(await env.render("p=find"), /data-rf-open="productNew"/);
  const dialog = env.context.MNP_BOM_DIALOGS.productNew(env.ctx());
  clean(dialog.html);
  assert.doesNotMatch(dialog.html, /<option value="(PURCHASED|CP|RB)"/, "only kinds that take components and need no rubber data");
  await env.submit("p=find", "saveItem", { code: "test-new-01(p)-a", name: "สินค้าทดสอบ", kind: "FG", uom: "set" }, { create: true });
  const item = env.store.data().items.find((entry) => entry.code === "TEST-NEW-01(P)-A");
  assert.equal(item?.kind, "FG");
  clean(await env.render(`p=find&code=${encodeURIComponent(item.code)}`));
  env.store.setUser("B04");
  assert.doesNotMatch(await env.render("p=find"), /data-rf-open="productNew"/);
});

test("the add form finds items with a search popup instead of a capped datalist, and creates a new rubber rod only with a compound", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "SE-TP01-OR01-100-18-65";
  const dialog = env.context.MNP_BOM_DIALOGS.lineAdd(env.ctx(), { parentCode: parent });
  clean(dialog.html);
  assert.doesNotMatch(dialog.html, /<datalist/, "no datalist: the list is searched as the user types");
  assert.match(dialog.html, /name="addCode"[^>]*role="combobox"[^>]*data-pick-input/);
  assert.match(dialog.html, /<div class="bom-pick-list" id="bom-add-code-list" role="listbox" data-popup hidden>/, "the list is a data-popup next to its input (shared closePopup rule)");
  assert.match(dialog.html, /<option value="RB"/, "a rubber rod can be created here");
  assert.match(dialog.html, /data-add-rubber hidden>[\s\S]*name="rbCompound"[\s\S]*name="rb_cutLengthCm"[\s\S]*name="rb_pcsPerRoll"[\s\S]*name="rb_sePerGr"[\s\S]*name="rb_kgPerRoll"[\s\S]*name="rbWeightG"/);
  const query = `p=find&code=${parent}`;
  const revision = () => env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").revision;
  const before = revision();
  await env.submit(query, "saveBomTree", { addCode: "RB-T-NEW-01", addQty: "0.05", newName: "เส้นยางทดสอบ", newKind: "RB", newUom: "rod", rbCompound: "" }, { lineAdd: true, code: parent });
  assert.match(env.log.toasts.at(-1)[0], /เส้นยางใหม่ RB-T-NEW-01 ต้องระบุสูตรยาง/, "a new rod without a compound is still refused");
  assert.equal(env.store.data().items.some((item) => item.code === "RB-T-NEW-01"), false);
  assert.equal(revision(), before);
  await env.submit(query, "saveBomTree", { addCode: "RB-T-NEW-01", addQty: "0.05", newName: "เส้นยางทดสอบ", newKind: "RB", newUom: "rod", rbCompound: "dm02", rb_cutLengthCm: "6.5", rb_pcsPerRoll: "30", rb_sePerGr: "1", rb_kgPerRoll: "1.4", rbWeightG: "1400" }, { lineAdd: true, code: parent });
  const rod = env.store.data().items.find((item) => item.code === "RB-T-NEW-01");
  assert.equal(rod.kind, "RB");
  assert.equal(rod.uom, "rod");
  assert.equal(rod.weightG, 1400);
  assert.deepEqual(json(rod.rubber), { compound: "DM02", cutLengthCm: 6.5, pcsPerRoll: 30, sePerGr: 1, kgPerRoll: 1.4 });
  assert.equal(revision(), before + 1);
});

test("rubber rod data shows on the tree and is edited in its own dialog; changing the compound needs the confirmation and never happens as a side effect", async () => {
  const env = load();
  env.store.setUser("B03");
  const rod = "RB-DM01-02-OR01-202-18-70";
  const itemOf = (code) => env.store.data().items.find((item) => item.code === code);
  const hub = env.context.MNP_BOM_PAGES.hub;
  // แผงข้างของบรรทัดเส้นยางในต้นไม้ของชิ้นยาง: สูตร การตัด น้ำหนัก และปุ่มแก้ข้อมูลเส้นยาง
  const tree = hub.treeTab(env.ctx(), itemOf("SE-TP01-OR01-100-18-65"), 1);
  const side = tree.detailHtml(0);
  clean(side);
  assert.match(side, /<dt>สูตรยาง<\/dt><dd><span class="rf-mono">DM01<\/span>/);
  assert.match(side, /ตัดยาว 6\.50? ซม\. · ได้ 31 ชิ้นต่อเส้น/);
  assert.match(side, /data-rf-open="rubberEdit" data-rf-args="\{&quot;code&quot;:&quot;RB-DM01-02-OR01-202-18-70&quot;\}"/);
  assert.doesNotMatch(side, /data-rf-open="lineAdd"/, "a rod takes no small add form");
  // หน้าของเส้นยางเอง: การ์ดข้อมูลเส้นยางพร้อมปุ่มแก้ · แท็บประวัติไม่บอกสูตรซ้ำ
  let html = await env.render(`p=find&code=${rod}`);
  clean(html);
  assert.match(html, /<h2>ข้อมูลเส้นยาง<\/h2>/);
  assert.doesNotMatch(await env.render(`p=find&code=${rod}&tab=history`), /<dt>สูตรยาง<\/dt>/);
  const dialog = env.context.MNP_BOM_DIALOGS.rubberEdit(env.ctx(), { code: rod });
  clean(dialog.html);
  assert.match(dialog.html, /data-rf-form="saveItem"/, "a rod without a compound line saves the item only");
  assert.match(dialog.html, /data-compound-change hidden/, "the change notice starts hidden");
  assert.match(dialog.html, /type="checkbox" name="confirmCompound"/);
  for (const name of ["compound", "cutLengthCm", "pcsPerRoll", "sePerGr", "kgPerRoll", "weightG"]) assert.match(dialog.html, new RegExp(`name="${name}"`));
  // ข้อมูลการตัดอย่างเดียว: บันทึกได้เลย สูตรเดิม
  const query = `p=find&code=${rod}`;
  const cut = { compound: "DM01", cutLengthCm: "7", pcsPerRoll: "28", sePerGr: "1", kgPerRoll: "1.53", weightG: "1530" };
  await env.submit(query, "saveItem", cut, { rubberEdit: true, code: rod });
  assert.equal(itemOf(rod).rubber.cutLengthCm, 7);
  assert.equal(itemOf(rod).rubber.pcsPerRoll, 28);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  assert.equal(itemOf(rod).rubber.odMm, 70, "fields the dialog does not show are kept");
  // เปลี่ยนสูตรโดยไม่ติ๊กยืนยัน: ไม่บันทึก
  await env.submit(query, "saveItem", { ...cut, compound: "DM02" }, { rubberEdit: true, code: rod });
  assert.match(env.log.toasts.at(-1)[0], /ติ๊กยืนยันการเปลี่ยนสูตรยางจาก DM01 เป็น DM02/);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  await env.submit(query, "saveItem", { ...cut, compound: "DM02", confirmCompound: "1" }, { rubberEdit: true, code: rod });
  assert.equal(itemOf(rod).rubber.compound, "DM02");
  // เส้นยางที่มีบรรทัดสูตรยางใน BOM: ช่องสูตรและบรรทัดเปลี่ยนพร้อมกันในคำสั่งเดียว (saveBomTree) และต้องยืนยันเหมือนกัน
  const result = env.store.run("saveBomTree", { code: rod, nodes: [{ code: "DM02", qty: 1.5, newItem: { kind: "CP", name: "NBR ดำ 70 Shore A", uom: "kg" } }] });
  assert.equal(result.ok, true, JSON.stringify(result.error ?? ""));
  const lineOf = () => env.store.data().boms.find((bom) => bom.itemCode === rod && bom.status === "approved").lines[0];
  assert.equal(lineOf().childCode, "DM02");
  const withLine = env.context.MNP_BOM_DIALOGS.rubberEdit(env.ctx(), { code: rod });
  assert.match(withLine.html, /data-rf-form="saveBomTree"/);
  assert.match(withLine.html, /name="compoundQty"[^>]*value="1\.5"/);
  await env.submit(query, "saveBomTree", { ...cut, compound: "DM01", compoundQty: "1.5" }, { rubberEdit: true, code: rod });
  assert.match(env.log.toasts.at(-1)[0], /ติ๊กยืนยันการเปลี่ยนสูตรยางจาก DM02 เป็น DM01/);
  assert.equal(lineOf().childCode, "DM02", "nothing changes without the confirmation");
  await env.submit(query, "saveBomTree", { ...cut, compound: "DM01", compoundQty: "1.6", cutLengthCm: "8", confirmCompound: "1", note: "กลับสูตรเดิม" }, { rubberEdit: true, code: rod });
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  assert.equal(lineOf().childCode, "DM01", "the compound line follows the rod's compound in the same command");
  assert.equal(lineOf().qty, 1.6);
  assert.equal(itemOf(rod).rubber.cutLengthCm, 8);
  assert.equal(itemOf("DM01")?.kind, "CP", "the compound becomes an item for the line");
  // แก้เฉพาะข้อมูลการตัดของเส้นยางที่มีบรรทัดสูตร: ไม่มีฉบับ BOM ใหม่ แต่บอกว่าบันทึกแล้ว
  const revision = env.store.data().boms.find((bom) => bom.itemCode === rod && bom.status === "approved").revision;
  const form = await env.submit(query, "saveBomTree", { ...cut, compound: "DM01", compoundQty: "1.6", cutLengthCm: "9" }, { rubberEdit: true, code: rod });
  assert.equal(itemOf(rod).rubber.cutLengthCm, 9);
  assert.equal(env.store.data().boms.find((bom) => bom.itemCode === rod && bom.status === "approved").revision, revision);
  assert.ok(form);
  // ฟอร์มข้อมูลชิ้นงานทั่วไป (แก้ข้อมูล) เปลี่ยนสูตรของเส้นยางที่มีสูตรแล้วไม่ได้: ช่องเป็น readonly และตัวแปลงฟอร์มปฏิเสธ · ข้อมูลอื่นยังแก้ได้
  assert.match(env.context.MNP_BOM_DIALOGS.itemEdit(env.ctx(), { code: rod }).html, /name="rubber\.compound"[^>]*readonly/);
  await env.submit(query, "saveItem", { code: rod, kind: "RB", name: "ชื่อใหม่", uom: "rod", rubber: { compound: "DM02" } }, {});
  assert.match(env.log.toasts.at(-1)[0], /เปลี่ยนสูตรยางของ RB-DM01-02-OR01-202-18-70 ที่ปุ่ม “แก้ข้อมูลเส้นยาง”/);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  await env.submit(query, "saveItem", { code: rod, kind: "RB", name: "ชื่อใหม่", uom: "rod", rubber: { compound: "dm01" } }, {});
  assert.equal(itemOf(rod).name, "ชื่อใหม่", "the same compound passes, so the other fields of the item form still save");
  assert.doesNotMatch(await env.render(query), />แก้หลายบรรทัด</, "no link from a rod's page to the wide table, which rewrites the compound from its line");
  // ฟอร์มเล็กยังไม่รับบรรทัดใต้เส้นยาง และผู้ที่ไม่ใช่ฝ่ายวางแผนไม่มีหน้าต่างนี้
  await env.submit(query, "saveBomTree", { addCode: "DM03", addQty: "1" }, { lineAdd: true, code: rod });
  assert.match(env.log.toasts.at(-1)[0], /ข้อมูลเส้นยาง/);
  assert.equal(lineOf().childCode, "DM01");
  env.store.setUser("B04");
  assert.equal(env.context.MNP_BOM_DIALOGS.rubberEdit(env.ctx(), { code: rod }), null);
  html = await env.render(`p=find&code=${rod}`);
  assert.doesNotMatch(html, /data-rf-open="rubberEdit"/);
});

test("paste from Excel on the product page: the preview tells known, new and skipped lines apart, and the form adds them to the stored lines", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const hub = env.context.MNP_BOM_PAGES.hub;
  const item = env.store.data().items.find((entry) => entry.code === parent);
  const dialog = env.context.MNP_BOM_DIALOGS.linesPaste(env.ctx(), { parentCode: parent });
  clean(dialog.html);
  assert.match(dialog.html, /data-paste-submit disabled/, "nothing to add before a paste");
  assert.equal(env.context.MNP_BOM_DIALOGS.linesPaste(env.ctx(), { parentCode: "RB-DM01-02-OR01-202-18-70" }), null, "not under a rubber rod");
  const text = ["รหัส\tปริมาณ\tหน่วย\t% เผื่อเสีย\tหมายเหตุ", "P-ZIP-05\t2\tpcs\t3\tซิปสำรอง", "P-STK-01\t1", "XP-PASTE-1\t4\tpcs", "RB-PASTE-9\t0.1\trod", `${XSS}\tx`].join("\n");
  const preview = hub.pastePreview(env.ctx(), item, text);
  clean(preview.html);
  assert.equal(preview.addable, 2);
  assert.doesNotMatch(preview.html, /<script>alert/);
  assert.match(preview.html, /เพิ่มได้ 2 บรรทัด<\/strong> · เป็นชิ้นใหม่ 1/);
  assert.match(preview.html, /มีใน BOM นี้แล้ว/, "a code already in the BOM is skipped with the reason");
  assert.match(preview.html, /เส้นยางใหม่ เพิ่มทีละชิ้น/, "a new rod needs its compound, so it is skipped here");
  assert.match(preview.html, /name="pName\[\]"[^>]*required[^>]*data-paste-name="XP-PASTE-1"/, "a new item asks for its name in the preview");
  assert.equal((preview.html.match(/name="pCode\[\]"/g) ?? []).length, 2);
  assert.equal((preview.html.match(/name="pName\[\]"/g) ?? []).length, 2, "every sent row carries the same fields, so the arrays stay aligned");
  const bomOf = (code) => json(env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved"));
  const before = bomOf(parent);
  const query = `p=find&code=${encodeURIComponent(parent)}`;
  const values = { "pCode[]": ["P-ZIP-05", "XP-PASTE-1"], "pQty[]": ["2", "4"], "pScrap[]": ["3", "0"], "pNote[]": ["ซิปสำรอง", ""], "pUom[]": ["pcs", "pcs"], "pName[]": ["", ""], "pKind[]": ["", "SUBPART"], note: "วางจาก Excel" };
  await env.submit(query, "saveBomTree", values, { linesPaste: true, code: parent });
  assert.match(env.log.toasts.at(-1)[0], /ยังไม่มีรหัส XP-PASTE-1 ในทะเบียน กรอกชื่อ/);
  assert.equal(bomOf(parent).revision, before.revision, "nothing is saved until every new item has a name");
  await env.submit(query, "saveBomTree", { ...values, "pName[]": ["", "ชิ้นจากการวาง"] }, { linesPaste: true, code: parent });
  const after = bomOf(parent);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.lines.length, before.lines.length + 2);
  assert.equal(after.lines.find((line) => line.childCode === "P-ZIP-05").scrapPct, 3);
  assert.equal(after.lines.find((line) => line.childCode === "P-ZIP-05").note, "ซิปสำรอง");
  assert.equal(env.store.data().items.find((entry) => entry.code === "XP-PASTE-1").name, "ชิ้นจากการวาง");
  for (const line of before.lines) assert.equal(after.lines.find((entry) => entry.childCode === line.childCode).qty, line.qty);
  await env.submit(query, "saveBomTree", { "pCode[]": ["P-ZIP-05"], "pQty[]": ["1"] }, { linesPaste: true, code: parent });
  assert.match(env.log.toasts.at(-1)[0], /P-ZIP-05 อยู่ใน BOM นี้แล้ว/, "the form re-checks against the stored lines");
  assert.match(await env.render(query), /data-rf-open="linesPaste"[\s\S]*data-rf-open="treeCopy"/, "both bulk ways sit beside the add button");
});

test("copying a structure from another item: the preview lists what is added and skipped, add keeps the old lines and replace swaps them", async () => {
  const env = load();
  env.store.setUser("B03");
  const hub = env.context.MNP_BOM_PAGES.hub;
  const source = "DEMO-TP-01(P)-Y";
  await env.submit("p=find", "saveItem", { code: "TEST-COPY-01", name: "สินค้าคัดลอก", kind: "FG", uom: "set" }, { create: true });
  const target = env.store.data().items.find((entry) => entry.code === "TEST-COPY-01");
  const dialog = env.context.MNP_BOM_DIALOGS.treeCopy(env.ctx(), { code: target.code });
  clean(dialog.html);
  assert.match(dialog.html, /name="copyFrom"[^>]*role="combobox"/);
  assert.match(dialog.html, /<input type="hidden" name="mode" value="add">/, "an item without lines has nothing to keep or replace");
  const sourceLines = json(env.store.data().boms.find((bom) => bom.itemCode === source && bom.status === "approved").lines);
  let preview = hub.copyPreview(env.ctx(), target, source, "add");
  clean(preview.html);
  assert.equal(preview.ok, true);
  assert.equal(preview.added, sourceLines.length);
  assert.match(preview.html, new RegExp(`เพิ่ม ${sourceLines.length} บรรทัด`));
  assert.match(preview.html, /class="is-inner"/, "the inner levels are shown as following along");
  assert.equal(hub.copyPreview(env.ctx(), target, "NO-SUCH", "add").ok, false);
  assert.match(hub.copyPreview(env.ctx(), target, "P-STK-01", "add").html, /ยังไม่มี BOM ที่ใช้งาน/);
  const bomOf = (code) => json(env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null);
  const childRevision = bomOf("SE-TP01-OR01-100-18-65").revision;
  const query = `p=find&code=${target.code}`;
  await env.submit(query, "saveBomTree", { copyFrom: "P-STK-01", mode: "add" }, { treeCopy: true, code: target.code });
  assert.match(env.log.toasts.at(-1)[0], /ยังไม่มี BOM ที่ใช้งาน/);
  assert.equal(bomOf(target.code), null);
  await env.submit(query, "saveBomTree", { copyFrom: source.toLowerCase(), mode: "add", note: "" }, { treeCopy: true, code: target.code });
  let copied = bomOf(target.code);
  assert.deepEqual(copied.lines.map((line) => [line.childCode, line.qty]).sort(), sourceLines.map((line) => [line.childCode, line.qty]).sort());
  assert.match(copied.changeLog[0].text, /คัดลอกโครงสร้างจาก DEMO-TP-01\(P\)-Y/);
  assert.equal(bomOf("SE-TP01-OR01-100-18-65").revision, childRevision, "the children's own BOMs are not rewritten");
  // มีบรรทัดอยู่แล้ว: โหมดเพิ่มข้ามรหัสที่ซ้ำ โหมดแทนที่ใช้ของต้นแบบทั้งหมด
  const other = "DEMO-HL-24(B)-A";
  const otherLines = json(env.store.data().boms.find((bom) => bom.itemCode === other && bom.status === "approved").lines);
  const shared = otherLines.filter((line) => copied.lines.some((entry) => entry.childCode === line.childCode)).length;
  assert.match(env.context.MNP_BOM_DIALOGS.treeCopy(env.ctx(), { code: target.code }).html, /<select[^>]*name="mode"/);
  preview = hub.copyPreview(env.ctx(), target, other, "add");
  assert.equal(preview.added, otherLines.length - shared);
  if (shared) assert.match(preview.html, /มีอยู่แล้ว ข้าม/);
  preview = hub.copyPreview(env.ctx(), target, other, "replace");
  assert.match(preview.html, new RegExp(`ลบบรรทัดเดิม ${copied.lines.length} บรรทัด`));
  await env.submit(query, "saveBomTree", { copyFrom: other, mode: "add" }, { treeCopy: true, code: target.code });
  assert.equal(bomOf(target.code).lines.length, copied.lines.length + otherLines.length - shared);
  await env.submit(query, "saveBomTree", { copyFrom: other, mode: "replace" }, { treeCopy: true, code: target.code });
  copied = bomOf(target.code);
  assert.deepEqual(copied.lines.map((line) => line.childCode).sort(), otherLines.map((line) => line.childCode).sort());
  await env.submit(query, "saveBomTree", { copyFrom: target.code, mode: "add" }, { treeCopy: true, code: target.code });
  assert.match(env.log.toasts.at(-1)[0], /ชิ้นงานเดียวกับที่กำลังสร้างไม่ได้/);
  env.store.setUser("B04");
  assert.equal(env.context.MNP_BOM_DIALOGS.treeCopy(env.ctx(), { code: target.code }), null);
  assert.equal(env.context.MNP_BOM_DIALOGS.linesPaste(env.ctx(), { parentCode: target.code }), null);
});

test("flags of stored lines survive the small forms, the remove button of the side panel and the one-line edit", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const bom = () => env.store.data().boms.find((entry) => entry.itemCode === parent && entry.status === "approved");
  const flagged = bom().lines[0].childCode;
  bom().lines[0].flags = ["RECOLOR"];
  const transforms = env.context.MNP_BOM.transforms();
  const tree = transforms.saveBomTree({ lineAdd: true, code: parent, addCode: "P-ZIP-05", addQty: "1" });
  assert.deepEqual(json(tree.nodes.find((node) => node.code === flagged).flags), ["RECOLOR"], "the add form sends the siblings' flags back");
  const lines = bom().lines;
  const edit = transforms.saveBom({ itemCode: parent, editCode: lines[1].childCode, "childCode": lines.map((line) => line.childCode), qty: lines.map((line) => String(line.qty)), scrapPct: lines.map(() => "0"), lineNote: lines.map(() => ""), lineStep: lines.map(() => "") });
  assert.deepEqual(json(edit.lines[0].flags), ["RECOLOR"], "the one-line edit keeps the flags of every line");
  const query = `p=find&code=${encodeURIComponent(parent)}`;
  await env.submit(query, "saveBomTree", { addCode: "P-ZIP-05", addQty: "1" }, { lineAdd: true, code: parent });
  assert.deepEqual(json(bom().lines.find((line) => line.childCode === flagged).flags), ["RECOLOR"]);
  // ปุ่มลบบรรทัดของแผงข้าง: ส่ง BOM ที่เหลือพร้อม flags เดิม และถามยืนยันด้วยชื่อของบรรทัด
  const item = env.store.data().items.find((entry) => entry.code === parent);
  const hub = env.context.MNP_BOM_PAGES.hub;
  const rows = env.context.MNP_BOM_RULES.explode(parent, 1, { itemOf: (code) => env.store.data().items.find((entry) => entry.code === code) ?? null, approvedBomOf: (code) => env.store.data().boms.find((entry) => entry.itemCode === code && entry.status === "approved") ?? null }).lines.slice(1);
  const at = rows.findIndex((row) => row.itemCode === "P-ZIP-05" && row.level === 1);
  const side = hub.treeTab(env.ctx(), item, 1).detailHtml(at);
  const button = /<button class="btn rf-btn secondary" type="button" data-rf-action="saveBom" data-rf-args="([^"]*)" data-rf-confirm="([^"]*)"[^>]*>ลบบรรทัดนี้<\/button>/.exec(side);
  assert.ok(button, "the side panel has the remove button");
  const unescape = (value) => value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#039;", "'");
  const args = JSON.parse(unescape(button[1]));
  assert.match(unescape(button[2]), /^ลบ .+ ออกจาก .+\?$/);
  assert.equal(args.lines.some((line) => line.childCode === "P-ZIP-05"), false);
  assert.deepEqual(args.lines.find((line) => line.childCode === flagged).flags, ["RECOLOR"]);
  const count = bom().lines.length;
  assert.equal(env.store.run("saveBom", args).ok, true);
  assert.equal(bom().lines.length, count - 1);
  assert.deepEqual(json(bom().lines.find((line) => line.childCode === flagged).flags), ["RECOLOR"]);
  // บรรทัดเดียวที่เหลือของ BOM ไม่มีปุ่มลบ
  const single = env.store.data().boms.find((entry) => entry.status === "approved" && entry.lines.length === 1 && env.store.data().items.find((row) => row.code === entry.itemCode)?.kind !== "RB");
  if (single) assert.doesNotMatch(hub.treeTab(env.ctx(), env.store.data().items.find((entry) => entry.code === single.itemCode), 1).detailHtml(0), /ลบบรรทัดนี้/);
});

test("the tree announces the selected line without a live side panel, and shows the calculated quantity once", async () => {
  const env = load();
  env.store.setUser("B03");
  const html = await env.render(`p=find&code=${encodeURIComponent("DEMO-TP-01(P)-Y")}&qty=80`);
  assert.doesNotMatch(html, /data-tree-side[^>]*aria-live/, "the panel is not a live region (it would be read in full on every click)");
  assert.match(html, /<p class="sr-only" role="status" data-tree-status><\/p>/);
  assert.match(html, /id="bom-hub-qty"[^>]*value="80"/);
  assert.doesNotMatch(html, /<th[^>]*>สำหรับ 80 /, "the column head does not repeat the quantity of the input");
  assert.match(html, /<th class="right"[^>]*>ต้องใช้รวม<\/th>/);
});

test("creating a product does not navigate when the code already exists", async () => {
  const env = load();
  env.store.setUser("B03");
  const dialog = env.context.MNP_BOM_DIALOGS.productNew(env.ctx());
  assert.doesNotMatch(dialog.html, /p=build/, "the form no longer sends people to the wide table");
  const handlers = {};
  const input = { value: "demo-tp-01(p)-y" };
  const fake = { querySelector: (selector) => (selector === "#bom-new-form" ? { addEventListener: (type, handler) => { handlers[type] = handler; } } : selector === "[data-new-code]" ? input : null) };
  dialog.bind(fake);
  env.log.hash = "#/bom?p=find";
  handlers.submit();
  assert.equal(env.log.hash, "#/bom?p=find", "an existing code stays on the list with the form's own message");
  input.value = "TEST-NAV-01";
  handlers.submit();
  assert.equal(env.log.hash, "#/bom?p=find", "nothing was created yet, so no navigation");
  assert.equal(env.store.run("saveItem", { code: "TEST-NAV-01", name: "ทดสอบ", kind: "FG", uom: "set", create: true }).ok, true);
  handlers.submit();
  assert.equal(env.log.hash, `#/bom?p=find&code=TEST-NAV-01`, "a code created after the dialog opened opens its page");
});

test("my jobs for the warehouse and for a read-only account: no job cards of other departments and no report buttons", () => {
  const env = load();
  env.store.setUser("B03");
  const work = env.context.MNP_BOM_PAGES.work;
  for (const user of [{ id: "W1", role: "wh", dept: "WH", name: "คลังสินค้า" }, { id: "V1", role: "viewer", dept: "HR", name: "ผู้ดู" }, { id: "V2", role: "viewer", name: "ไม่มีแผนก" }]) {
    const base = env.ctx("p=work&dept=RB");
    const html = work({ ...base, user, canSee: (id) => env.context.MNP_BOM_STORE.canSee(user, id) }).html;
    clean(html);
    assert.doesNotMatch(html, /data-rf-open="jobReport"|data-rf-action="setJobStatus"/, `${user.role}: cannot report or hold a job`);
    assert.doesNotMatch(html, /role="tab"[^>]*>ทุกแผนก/, `${user.role}: no department switch`);
    assert.doesNotMatch(html, /<article class="card rf-card bom-job/, `${user.role}: the dept parameter does not open another department's cards`);
    assert.match(html, /ไม่มีงานค้าง|บัญชีนี้ไม่ได้อยู่ในแผนกผลิต/);
  }
  assert.equal(env.context.MNP_BOM_STORE.homeOf({ role: "wh" }), "orders");
  assert.equal(env.context.MNP_BOM_STORE.homeOf({ role: "viewer" }), "find");
});

test("an open PI names itself in the page head, a draft shows what other drafts need, and open purchase orders are named before cancelling or editing", async () => {
  const env = load();
  env.store.setUser("B03");
  let html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  assert.match(html, /<h1>ใบสั่งผลิต <span class="rf-mono">DEMO-26002<\/span><\/h1><p class="bom-hero-sub">ลูกค้าสาธิต กรุงเทพ /);
  assert.doesNotMatch(html, /<h1[^>]*>ใบสั่งผลิต \(PI\)/, "the generic title is for the list only");
  assert.equal((html.match(/ลูกค้าสาธิต กรุงเทพ/g) ?? []).length, 1, "the customer is shown once");
  assert.equal((html.match(/DEMO-26002<\/span>/g) ?? []).length, 1);
  assert.match(await env.render("p=orders"), /<h1[^>]*>ใบสั่งผลิต \(PI\)/);
  assert.doesNotMatch(html, /ใบร่างที่คำนวณทีหลังต้องใช้/, "no later draft shares a part yet: nothing to explain in the others column");
  const columns = (text) => [...text.matchAll(/<th class="right"[^>]*>([^<]*)<\/th>/g)].map((match) => match[1]).slice(0, 6);
  const fixedColumns = ["ต้องใช้", "มีในคลัง", "ใบอื่นต้องใช้", "สั่งแล้วรอรับ", "ใบนี้ขาด", "รวมทุกใบขาด"];
  assert.deepEqual(columns(html.slice(html.indexOf("ของซื้อ"))), fixedColumns, "one fixed column set (U2): the same on every order");
  // ใบร่างอีกใบที่ใช้ของซื้อเดียวกัน
  const first = env.store.data().orders.find((order) => order.id === "DEMO-26002");
  const created = env.store.run("createOrder", { pi: "DEMO-26009", customer: "ลูกค้าทดสอบสอง", country: "Thailand", orderType: first.orderType, orderedAt: Date.now(), whDue: Date.now() + 30 * 864e5, due: {}, autoDue: true });
  assert.equal(created.ok, true, JSON.stringify(created.error ?? ""));
  assert.equal(env.store.run("addOrderItem", { orderId: "DEMO-26009", base: env.context.MNP_BOM_RULES.parseFgCode(first.items[0].fgCode).base, pkg: env.context.MNP_BOM_RULES.parseFgCode(first.items[0].fgCode).pkg, colorSet: env.context.MNP_BOM_RULES.parseFgCode(first.items[0].fgCode).colorSet, qty: 10 }).ok, true);
  assert.equal(env.store.run("explodeOrder", { orderId: "DEMO-26009" }).ok, true);
  const demand = env.context.MNP_BOM_RULES.draftPartDemand(env.store.data().orders, "DEMO-26002");
  assert.ok(demand.size > 0);
  assert.deepEqual(json([...demand.values()][0].orders), ["DEMO-26009"]);
  assert.equal(env.context.MNP_BOM_RULES.draftPartDemand(env.store.data().orders, "DEMO-26009").has([...demand.keys()][0]), true, "each draft sees the other one");
  html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  // ลำดับจองของใบร่าง: DEMO-26002 คำนวณก่อน DEMO-26009 → DEMO-26002 เห็น 26009 ในคอลัมน์ "ใบร่างอื่นต้องใช้" (ใบนี้จองก่อน) และ 26009 เห็น 26002 ในยอดจอง (ไม่มีคอลัมน์นั้น)
  const draftRules = env.context.MNP_BOM_RULES;
  const orderOf = (id) => env.store.data().orders.find((order) => order.id === id);
  assert.ok(orderOf("DEMO-26002").explodedAt < orderOf("DEMO-26009").explodedAt, "the demo draft was calculated before the new one");
  const sharedCode = [...demand.keys()][0];
  assert.deepEqual(json([...draftRules.draftPartDemand(env.store.data().orders, "DEMO-26002", { relativeTo: orderOf("DEMO-26002"), side: "later" }).get(sharedCode).orders]), ["DEMO-26009"]);
  assert.equal(draftRules.draftPartDemand(env.store.data().orders, "DEMO-26002", { relativeTo: orderOf("DEMO-26002"), side: "earlier" }).size, 0, "nothing was calculated before the first draft");
  assert.match(html, /<th class="right" title="[^"]*ใบนี้จองก่อน[^"]*">ใบอื่นต้องใช้<\/th>/);
  assert.match(html, /<th class="right" title="[^"]*ที่คำนวณของก่อนใบนี้[^"]*">ใบอื่นต้องใช้<\/th>/, "the one others column says it includes earlier drafts");
  assert.match(html, /title="[^"]*ใบร่างที่คำนวณทีหลังต้องใช้ [\d.,]+ \(ใบ DEMO-26009\)"/, "the breakdown (and the later draft) is in the cell's tooltip");
  assert.deepEqual(columns(html.slice(html.indexOf("ของซื้อ"))), fixedColumns, "the column set does not change when another draft shares a part");
  const needsOf = (id) => draftRules.partNeeds({ jobs: env.store.data().jobs, orders: env.store.data().orders, stock: env.store.data().stock, purchaseOrders: [] }, id).rows.find((row) => row.itemCode === sharedCode);
  const earlierNeed = draftRules.draftPartDemand(env.store.data().orders, "DEMO-26009", { relativeTo: orderOf("DEMO-26009"), side: "earlier" }).get(sharedCode).qty;
  assert.ok(earlierNeed > 0);
  assert.ok(Math.abs(needsOf("DEMO-26009").reservedQty - needsOf("DEMO-26002").reservedQty - earlierNeed) < 0.0011, "the later draft holds the earlier draft's need on top of the released orders'");
  const laterHtml = await env.render("p=orders&sel=DEMO-26009");
  clean(laterHtml);
  assert.doesNotMatch(laterHtml, /ใบร่างที่คำนวณทีหลังต้องใช้/, "no draft was calculated after the later one: nothing about later drafts, the earlier draft is inside the held figure");
  assert.match(laterHtml, /title="จองไว้แล้ว [\d.,]+"/);
  assert.deepEqual(columns(laterHtml.slice(laterHtml.indexOf("ของซื้อ"))), fixedColumns, "the same columns on the later draft");
  html = await env.render("p=orders&sel=DEMO-26002");
  // ใบสั่งซื้อที่สั่งจากใบนี้และยังไม่รับของ
  assert.doesNotMatch(html, /มีใบสั่งซื้อที่สั่งจากใบนี้/);
  env.rf.store.data().purchaseOrders.push({ id: "PO-TEST-01", status: "ordered", sourcePi: "DEMO-26002", lines: [] }, { id: "PO-TEST-02", status: "received", sourcePi: "DEMO-26002", lines: [] }, { id: "PO-TEST-03", status: "ordered", sourcePi: "DEMO-26001", lines: [] });
  html = await env.render("p=orders&sel=DEMO-26002");
  assert.match(html, /data-rf-open="orderCancel"[^>]*data-rf-args="[^"]*DEMO-26002/, "cancelling opens the cancel dialog");
  const cancel = env.context.MNP_BOM_DIALOGS.orderCancel(env.ctx("p=orders&sel=DEMO-26002"), { orderId: "DEMO-26002" }).html;
  assert.match(cancel, /มีใบสั่งซื้อที่สั่งจากใบนี้และยังรับของไม่ครบ: PO-TEST-01 ระบบไม่ยกเลิก/);
  assert.doesNotMatch(cancel, /PO-TEST-02|PO-TEST-03/, "received orders and other PIs' orders are not named");
  assert.match(/data-rf-action="removeOrderItem"[^>]*data-rf-confirm="([^"]*)"/.exec(html)?.[1] ?? "", /PO-TEST-01/);
  assert.match(env.context.MNP_BOM_DIALOGS.orderItemEdit(env.ctx(), { orderId: "DEMO-26002", fgCode: first.items[0].fgCode }).html, /มีใบสั่งซื้อที่สั่งจากใบนี้และยังรับของไม่ครบ: PO-TEST-01/);
  assert.match(env.context.MNP_BOM_DIALOGS.orderItemAdd(env.ctx(), { orderId: "DEMO-26002" }).html, /PO-TEST-01/);
  assert.doesNotMatch(env.context.MNP_BOM_DIALOGS.orderItemAdd(env.ctx(), { orderId: "DEMO-26009" }).html, /PO-TEST/);
  // ใบสั่งซื้อที่รับแล้วบางบรรทัดยังเป็น ordered: บอกว่ารับแล้วกี่บรรทัด และยกเลิกไม่ได้
  // บรรทัด A รับแล้วแบบรุ่นเก่า (ครั้งเดียว ไม่มี receipts = ปิดแล้ว) · B รับไม่ครบ (ยังค้าง) · C ยังไม่รับ (20261128020000: นับเฉพาะบรรทัดที่ครบ)
  env.rf.store.data().purchaseOrders.push({ id: "PO-TEST-04", status: "ordered", sourcePi: "DEMO-26002", lines: [{ materialCode: "A", qtyKg: 10, receivedKg: 5 }, { materialCode: "B", qtyKg: 10, receivedKg: 4, receipts: [{ kg: 4 }] }, { materialCode: "C", qtyKg: 10 }] });
  const partly = env.context.MNP_BOM_DIALOGS.orderCancel(env.ctx("p=orders&sel=DEMO-26002"), { orderId: "DEMO-26002" }).html;
  assert.match(partly, /: PO-TEST-01, PO-TEST-04 \(รับแล้ว 1\/3 บรรทัด\) ระบบไม่ยกเลิก/, "untouched orders are named as before, the partly received one carries its count of finished lines");
  assert.match(partly, /ใบที่รับเข้าหรือปิดยอดไปแล้วบางส่วนยกเลิกไม่ได้ \(ปิดยอดที่เหลือได้\)/);
  assert.doesNotMatch(cancel, /รับแล้ว|ยกเลิกไม่ได้/, "with nothing received the sentence is unchanged");
  // ยกเลิกแล้วใบสั่งซื้อยังอยู่ (ระบบไม่ยกเลิกให้)
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26002" }).ok, false, "a cancel needs a reason");
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26002", reason: "ลูกค้ายกเลิก" }).ok, true);
  assert.equal(env.rf.store.data().purchaseOrders.find((po) => po.id === "PO-TEST-01").status, "ordered");
});

test("chemicals of a draft PI are estimated from the WOs the release would open, with the same rule as the check after release", async () => {
  const env = load();
  env.store.setUser("B03");
  const rules = env.context.MNP_BOM_RULES;
  const order = env.store.data().orders.find((entry) => entry.id === "DEMO-26002");
  const jobs = rules.draftRubberJobs(order);
  assert.ok(jobs.length > 0, "the demo draft needs rubber rods");
  for (const job of jobs) if (["rod", "roll"].includes(job.uom)) assert.equal(job.qtyPlanned, Math.ceil(job.qtyPlanned), "rods are planned whole, like at release");
  assert.deepEqual(json(rules.draftRubberJobs({ ...order, status: "released" })), []);
  const chem = env.context.MNP_BOM_PAGES.hub.draftChemicals(env.ctx(), order);
  assert.equal(chem.ready, true);
  assert.equal(chem.orders.length + chem.skipped.length, jobs.length, "every rod job is either estimated or named as skipped");
  assert.ok(chem.orders.length > 0);
  assert.ok(chem.rows.length > 0);
  // ตัวเลขเดียวกับที่ rules.chemicalNeeds ของ RubberFlow ให้ เมื่อ WO เหล่านั้นถูกเปิดจริง (สถานะ planned กิโลกรัมเท่ากัน สูตรเดียวกัน)
  const rf = env.rf.store.data();
  const real = chem.orders.map((draft, index) => ({ ...draft, id: `WO-REAL-${index}` }));
  const after = env.context.MNP_RUBBERFLOW_RULES.chemicalNeeds({ ...rf, orders: [...rf.orders, ...real] }, real.map((row) => row.id), env.rf.context(new URLSearchParams()).now, { remote: false });
  assert.deepEqual(json(chem.rows.map((row) => [row.itemCode, row.required, row.short]).sort()), json(after.rows.map((row) => [row.materialCode, row.needKg, row.shortageKg]).sort()));
  // กิโลกรัมของ WO ชั่วคราว = helpers.rbJobKg เผื่อ 5% ของงานที่จะถูกสร้าง (กฎของ private.bom_open_rf_orders)
  const job = jobs.find((entry) => chem.orders.some((draft) => draft.id.endsWith(`:${entry.itemCode}`)));
  const item = env.store.data().items.find((entry) => entry.code === job.itemCode);
  assert.equal(chem.orders.find((draft) => draft.id.endsWith(`:${job.itemCode}`)).targetKg, env.context.MNP_BOM_ACTIONS.helpers.rbJobKg(job, item, { scrapPct: 5, bom: null }));
  let html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  assert.match(html, /<th>เคมีของเส้นยาง<\/th>/);
  assert.doesNotMatch(html, /เคมี(ขาด \d+ จาก|พอทั้ง) \d+ รายการ/, "the chemical count is not repeated in the card header: the table above it says it row by row");
  if (chem.skipped.length) assert.match(html, /ยังประเมินเคมีไม่ได้ และจะยังไม่ได้ WO ตอนปล่อยผลิต/);
  assert.doesNotMatch(html, /data-bom-draft-buy/, "ordering needs the database mode (purchase orders live in RubberFlow)");
  // หลังปล่อยผลิตไม่มีตารางประเมินแล้ว
  assert.equal(env.store.run("releaseOrder", { orderId: "DEMO-26002" }).ok, true);
  html = await env.render("p=orders&sel=DEMO-26002");
  assert.doesNotMatch(html, /<th>เคมีของเส้นยาง<\/th>/);
  // หน้าต่างสั่งซื้อของ RubberFlow รับ WO ชั่วคราวและแสดงเคมีชุดเดียวกัน
  const rfCtx = env.rf.context(new URLSearchParams());
  const purchase = env.context.MNP_RUBBERFLOW_DIALOGS.purchase(rfCtx, { woIds: [], sourcePi: "DEMO-26002", draftOrders: chem.orders, parts: false });
  for (const row of chem.rows) assert.match(purchase.html, new RegExp(`name="materialCode\\[\\]" value="${row.itemCode}"`));
});

test("drafts reserve chemicals among themselves in calculation order like purchased parts: the earlier draft holds first, the later one is short, and the purchase dialog shows the same numbers", async () => {
  const env = load();
  env.store.setUser("B03");
  const rules = env.context.MNP_BOM_RULES;
  const hub = env.context.MNP_BOM_PAGES.hub;
  const first = env.store.data().orders.find((order) => order.id === "DEMO-26002");
  const fg = rules.parseFgCode(first.items[0].fgCode);
  assert.equal(env.store.run("createOrder", { pi: "DEMO-26009", customer: "ลูกค้าทดสอบสอง", country: "Thailand", orderType: first.orderType, orderedAt: Date.now(), whDue: Date.now() + 30 * 864e5, due: {}, autoDue: true }).ok, true);
  assert.equal(env.store.run("addOrderItem", { orderId: "DEMO-26009", base: fg.base, pkg: fg.pkg, colorSet: fg.colorSet, qty: 10 }).ok, true);
  assert.equal(env.store.run("explodeOrder", { orderId: "DEMO-26009" }).ok, true);
  const orderOf = (id) => env.store.data().orders.find((order) => order.id === id);
  assert.equal(rules.draftBefore(orderOf("DEMO-26002"), orderOf("DEMO-26009")), true, "26002 was calculated before 26009");
  assert.equal(rules.draftBefore(orderOf("DEMO-26009"), orderOf("DEMO-26002")), false);
  // ไม่มี WO / ใบเบิก / ใบสั่งซื้อของ RubberFlow อื่นมาจอง: ยอดจองมาจากใบร่างอย่างเดียว
  const rf = env.rf.store.data();
  rf.orders = [];
  rf.requisitions = [];
  rf.purchaseOrders = [];
  const free = hub.draftChemicals(env.ctx(), orderOf("DEMO-26002"));
  const free9 = hub.draftChemicals(env.ctx(), orderOf("DEMO-26009"));
  const code = free.rows.map((row) => row.itemCode).find((entry) => free9.rows.some((row) => row.itemCode === entry));
  assert.ok(code, "both drafts need a chemical in common");
  const needA = free.rows.find((row) => row.itemCode === code).required;
  const needB = free9.rows.find((row) => row.itemCode === code).required;
  // คงเหลือพอสำหรับใบที่ใหญ่กว่าใบเดียว (ไม่พอสองใบรวมกัน)
  const template = rf.materialLots.find((lot) => lot.materialCode === code);
  rf.materialLots = [...rf.materialLots.filter((lot) => lot.materialCode !== code), { ...template, qtyKg: Math.max(needA, needB) + 0.0004 }];
  const A = hub.draftChemicals(env.ctx(), orderOf("DEMO-26002"));
  const B = hub.draftChemicals(env.ctx(), orderOf("DEMO-26009"));
  const rowA = A.rows.find((row) => row.itemCode === code);
  const rowB = B.rows.find((row) => row.itemCode === code);
  // ใบที่คำนวณก่อน: ไม่ถูกจองตัดหน้า พอ · เห็นความต้องการของใบหลังในคอลัมน์ "ใบร่างอื่นต้องใช้" (ข้อมูลให้ดู ไม่เข้าสูตร)
  assert.equal(rowA.held, 0);
  assert.equal(rowA.short, 0);
  assert.equal(rowA.other, needB);
  assert.deepEqual(json(rowA.otherOrders), ["DEMO-26009"]);
  assert.deepEqual(json(A.reservedOrders), []);
  // ใบที่คำนวณทีหลัง: ยอดที่ใบก่อนต้องใช้อยู่ในยอดจอง จึงขาด · ไม่มีใบร่างที่คำนวณหลังมันมาเข้าคอลัมน์ข้างๆ
  assert.ok(Math.abs(rowB.held - needA) < 0.0011, `the earlier draft's need (${needA}) is held, got ${rowB.held}`);
  assert.ok(rowB.short > 0, "the later draft is short");
  assert.equal(rowB.other, 0);
  assert.deepEqual(json(rowB.otherOrders), []);
  assert.deepEqual(json(B.reservedOrders.map((order) => order.id)), json(A.orders.map((order) => order.id)), "the temporary WOs of the earlier draft are what the later one reserves");
  // ผลต่างจากเดิม: ไม่นับใบร่างอื่น ตัวเลขของใบหลังคือพอ (ยืนยันว่ายอดขาดมาจากการจองของใบก่อนเท่านั้น)
  const alone = env.ctx().rubberflow().draftChemicalNeeds(B.orders).rows.find((row) => row.materialCode === code);
  assert.equal(alone.shortageKg, 0, "without the reserved orders nothing changes from before");
  const together = env.ctx().rubberflow().draftChemicalNeeds(B.orders, B.reservedOrders).rows.find((row) => row.materialCode === code);
  assert.equal(together.shortageKg, rowB.short);
  // หน้า: ขั้น 2 ของใบหลังขาด และหัวคอลัมน์ "ใบอื่นจองไว้" บอกว่ารวมใบร่างที่คำนวณก่อน
  const html = await env.render("p=orders&sel=DEMO-26009");
  clean(html);
  assert.match(html, /<th class="right" title="ใบเบิกที่ค้างจ่าย WO อื่นที่ยังเปิดอยู่ และใบร่างที่คำนวณของก่อนใบนี้[^"]*">ใบอื่นต้องใช้<\/th>/);
  assert.match(html, /<th class="right"[^>]*>ใบนี้ขาด<\/th><th class="right"[^>]*>รวมทุกใบขาด<\/th>/, "the chemical table has the same columns");
  assert.ok(rowB.ownShort <= rowB.short && rowB.ownShort === 0, "the later draft alone is covered by the stock: its shortage comes from the earlier draft's reservation");
  assert.match(html, /<tr class="bom-short">/);
  const earlierHtml = await env.render("p=orders&sel=DEMO-26002");
  clean(earlierHtml);
  assert.match(earlierHtml, /title="[^"]*\(ใบ DEMO-26009\)"/, "the earlier draft names the later one in its others column tooltip");
  // หน้าต่างสั่งซื้อที่เปิดจากใบร่าง: ขาดและจำนวนสั่งตั้งต้นเท่ากับตารางขั้น 2 เมื่อส่ง WO ชั่วคราวของใบก่อนเป็นยอดจอง · ไม่ส่ง = เท่าเดิม
  const rfCtx = { ...env.rf.context(new URLSearchParams()), can: (permission) => ["purchase"].includes(permission) };
  const shortOf = (dialog) => Number(new RegExp(`<tr data-rf-po-row data-short="([^"]*)"[^>]*><td><span class="rf-mono">${code}</span>`).exec(dialog)?.[1]);
  const dialog = (extra) => env.context.MNP_RUBBERFLOW_DIALOGS.purchase(rfCtx, { woIds: [], sourcePi: "DEMO-26009", draftOrders: B.orders, parts: false, ...extra }).html;
  assert.equal(shortOf(dialog({ reservedDraftOrders: B.reservedOrders })), rowB.short, "the dialog is short by the same figure as the table");
  assert.equal(shortOf(dialog({})), 0, "without the argument the dialog is as before");
  // ปุ่มสั่งซื้อของใบร่างเรียก checkMaterials: ตัวเลขที่ตรวจได้ตามตารางเมื่อส่งใบก่อนเป็นยอดจอง · ไม่ส่งก็เท่าเดิม
  env.rf.store.setUser("U01");
  const checked = await env.rf.checkMaterials({ woIds: [], sourcePi: "DEMO-26009", draftOrders: B.orders, reservedDraftOrders: B.reservedOrders, auto: false });
  assert.equal(checked.ok, true);
  assert.equal(checked.result.rows.find((row) => row.materialCode === code).shortageKg, rowB.short, "the check shows the figure of the table");
  assert.equal((await env.rf.checkMaterials({ woIds: [], sourcePi: "DEMO-26009", draftOrders: B.orders, auto: false })).result.rows.find((row) => row.materialCode === code).shortageKg, 0, "without the argument the check is as before");
  // ใบร่างที่ขั้นหลังไม่เห็นใบอื่น: เมื่อใบก่อนปล่อยผลิตไปแล้ว WO จริงของมันอยู่ใน RubberFlow และใบร่างไม่ถูกนับซ้ำ
  assert.equal(env.store.run("releaseOrder", { orderId: "DEMO-26002" }).ok, true);
  const afterRelease = hub.draftChemicals(env.ctx(), orderOf("DEMO-26009"));
  assert.deepEqual(json(afterRelease.reservedOrders), [], "a released PI is no draft: its work orders are the real ones");
});

test("the wide table and a kind switch cannot change the compound of a rod that has one", async () => {
  const env = load();
  env.store.setUser("B03");
  const rod = "RB-DM01-02-OR01-202-18-70";
  const parent = "SE-TP01-OR01-100-18-65";
  const itemOf = (code) => env.store.data().items.find((item) => item.code === code);
  const line = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.find((entry) => entry.childCode === rod);
  const row = (compound, cut) => ({ code: parent, itemName: itemOf(parent).name, itemUom: "pcs", itemKind: "SE", "rowId[]": ["r1"], "parentId[]": [""], "childCode[]": [rod], "name[]": [itemOf(rod).name], "kind[]": ["RB"], "uom[]": ["rod"], "qty[]": [String(line.qty)], "scrapPct[]": ["0"], "lineNote[]": [""], "lineStep[]": [""], "weightG[]": ["1530"], "compound[]": [compound], "cutLengthCm[]": [cut], "pcsPerRoll[]": ["31"], "sePerGr[]": ["1"], "kgPerRoll[]": ["1.53"] });
  const query = `p=build&code=${parent}`;
  // ช่องสูตรของแถวเส้นยาง
  await env.submit(query, "saveBomTree", row("DM02", "6.5"), {});
  assert.match(env.log.toasts.at(-1)[0], /เปลี่ยนสูตรยางของ RB-DM01-02-OR01-202-18-70 \(DM01\) ที่ปุ่ม “แก้ข้อมูลเส้นยาง”/);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  // ข้อมูลการตัดของแถวเดียวกันยังแก้ได้เมื่อสูตรเท่าเดิม
  await env.submit(query, "saveBomTree", row("dm01", "7"), {});
  assert.equal(itemOf(rod).rubber.cutLengthCm, 7);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  // แถวสูตรยางใต้เส้นยาง (เส้นยางเป็นพ่อของตาราง): สูตรอื่นถูกปฏิเสธ สูตรเดิมบันทึกได้
  const under = (code) => ({ code: rod, itemName: itemOf(rod).name, itemUom: "rod", itemKind: "RB", "rowId[]": ["r1"], "parentId[]": [""], "childCode[]": [code], "name[]": ["สูตร"], "kind[]": ["CP"], "uom[]": ["kg"], "qty[]": ["1.5"], "scrapPct[]": ["0"], "lineNote[]": [""], "lineStep[]": [""], "weightG[]": [""], "compound[]": [""], "cutLengthCm[]": [""], "pcsPerRoll[]": [""], "sePerGr[]": [""], "kgPerRoll[]": [""] });
  await env.submit(`p=build&code=${rod}`, "saveBomTree", under("DM02"), {});
  assert.match(env.log.toasts.at(-1)[0], /ตารางนี้เปลี่ยนสูตรไม่ได้/);
  assert.equal(itemOf(rod).rubber.compound, "DM01");
  assert.equal(env.store.data().boms.some((bom) => bom.itemCode === rod), false);
  await env.submit(`p=build&code=${rod}`, "saveBomTree", under("DM01"), {});
  assert.equal(env.store.data().boms.find((bom) => bom.itemCode === rod && bom.status === "approved").lines[0].childCode, "DM01", "adding the line of the rod's own compound still works in the wide table");
  // สลับชนิดพร้อมเปลี่ยนสูตร (ทางอ้อม) ถูกปฏิเสธ
  const other = "RB-DM01-01-OR01-200-0-72";
  await env.submit("p=find", "saveItem", { code: other, kind: "SE", name: itemOf(other).name, uom: "rod", rubber: { compound: "DM02" } }, {});
  assert.match(env.log.toasts.at(-1)[0], /เปลี่ยนสูตรยางของ RB-DM01-01-OR01-200-0-72 ที่ปุ่ม/);
  assert.equal(itemOf(other).kind, "RB");
  assert.equal(itemOf(other).rubber.compound, "DM01");
  // ออกจากเส้นยางไปชนิดที่ไม่เก็บข้อมูลยาง (สูตรจะถูกล้าง แล้วกลับมาตั้งสูตรใหม่ได้): ปฏิเสธ · ไป SE ด้วยสูตรเดิมยังได้
  await env.submit("p=find", "saveItem", { code: other, kind: "PURCHASED", name: itemOf(other).name, uom: "rod", rubber: { compound: "DM01" } }, {});
  assert.match(env.log.toasts.at(-1)[0], /เป็นเส้นยางที่มีสูตรยาง DM01 แล้ว เปลี่ยนชนิดไม่ได้/);
  await env.submit("p=find", "saveItem", { code: other, kind: "SE", name: itemOf(other).name, uom: "rod", rubber: { compound: "DM01" } }, {});
  assert.match(env.log.toasts.at(-1)[0], /แล้ว เปลี่ยนชนิดไม่ได้/, "not to SE either: an SE's compound field is free, so RB → SE → new compound → RB would skip the confirmation");
  assert.equal(itemOf(other).kind, "RB");
  await env.submit("p=find", "saveItem", { code: other, kind: "RB", name: itemOf(other).name, uom: "rod", rubber: { compound: " dm 01 " } }, {});
  assert.equal(itemOf(other).rubber.compound, "DM01", "the same compound typed differently keeps the stored spelling");
});

test("a WIP item is inserted between a parent and one of its lines in one save, and the tree offers the step editor and a resize handle", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const child = "SE-TP01-OR01-100-18-65";
  const bomOf = (code) => json(env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null);
  const before = bomOf(parent);
  const line = before.lines.find((entry) => entry.childCode === child);
  const childBefore = bomOf(child);
  const dialog = env.context.MNP_BOM_DIALOGS.wipInsert(env.ctx(), { parentCode: parent, childCode: child });
  clean(dialog.html);
  assert.match(dialog.html, /name="wipCode"[^>]*required/);
  assert.match(dialog.html, new RegExp(`name="childQty"[^>]*value="${line.qty}"`), "the old quantity moves under the new item by default");
  assert.doesNotMatch(/<select[^>]*name="wipKind"[\s\S]*?<\/select>/.exec(dialog.html)[0], /<option value="(FG|RB|PURCHASED|CP)"/, "only kinds that can sit between the two");
  assert.match(/<select[^>]*name="wipDept"[\s\S]*?<\/select>/.exec(dialog.html)[0], /<option value="PK" selected>/, "the new item starts in the parent's department");
  assert.equal(env.context.MNP_BOM_DIALOGS.wipInsert(env.ctx(), { parentCode: "RB-DM01-02-OR01-202-18-70", childCode: "DM01" }), null, "nothing is inserted under a rubber rod");
  const query = `p=find&code=${encodeURIComponent(parent)}`;
  await env.submit(query, "saveBomTree", { wipCode: child, wipName: "ซ้ำ", wipKind: "SUBPART", wipUom: "pcs", wipQty: "1", childQty: String(line.qty) }, { wipInsert: true, code: parent, childCode: child });
  assert.match(env.log.toasts.at(-1)[0], /มีรหัส SE-TP01-OR01-100-18-65 อยู่แล้ว/);
  assert.equal(bomOf(parent).revision, before.revision);
  await env.submit(query, "saveBomTree", { wipCode: "wip-tp01-a", wipName: "ชุดลูกตอปิโดประกอบ", wipKind: "SUBPART", wipUom: "pcs", wipQty: "1", childQty: String(line.qty), note: "" }, { wipInsert: true, code: parent, childCode: child });
  const after = bomOf(parent);
  assert.equal(after.revision, before.revision + 1);
  assert.equal(after.lines.length, before.lines.length, "the line is replaced, not added");
  assert.equal(after.lines.some((entry) => entry.childCode === child), false);
  assert.equal(after.lines.find((entry) => entry.childCode === "WIP-TP01-A").qty, 1);
  const wip = bomOf("WIP-TP01-A");
  assert.deepEqual(wip.lines.map((entry) => [entry.childCode, entry.qty]), [[child, line.qty]]);
  assert.equal(env.store.data().items.find((item) => item.code === "WIP-TP01-A").kind, "SUBPART");
  assert.equal(bomOf(child).revision, childBefore.revision, "the moved line's own BOM is untouched");
  for (const other of before.lines.filter((entry) => entry.childCode !== child)) assert.equal(after.lines.find((entry) => entry.childCode === other.childCode).qty, other.qty);
  // ยอดรวมของชิ้นที่ย้ายไม่เปลี่ยน (1 × ปริมาณเดิม)
  const explode = (code) => env.context.MNP_BOM_RULES.explode(code, 10, { itemOf: (c) => env.store.data().items.find((item) => item.code === c) ?? null, approvedBomOf: (c) => env.store.data().boms.find((bom) => bom.itemCode === c && bom.status === "approved") ?? null }).lines;
  assert.equal(explode(parent).find((entry) => entry.itemCode === child).required, 10 * line.qty);
  // ต้นไม้: แถบลากปรับความกว้าง ปุ่มขั้นตอนของรายการ และปุ่มแทรก/ขั้นตอนในแผงข้าง
  const html = await env.render(query);
  assert.match(html, /<div class="bom-tree-split" role="separator" aria-orientation="vertical" tabindex="0"[^>]*data-tree-split>/);
  assert.match(html, /data-rf-open="routingEdit" data-rf-args="\{&quot;code&quot;:&quot;DEMO-TP-01\(P\)-Y&quot;\}"/);
  const item = env.store.data().items.find((entry) => entry.code === parent);
  const rows = explode(parent).slice(1);
  const side = env.context.MNP_BOM_PAGES.hub.treeTab(env.ctx(), item, 1).detailHtml(rows.findIndex((row) => row.itemCode === "WIP-TP01-A"));
  assert.match(side, /data-rf-open="wipInsert"/);
  assert.match(side, /data-rf-open="routingEdit"[^>]*>\+ ขั้นตอน</, "an item without steps offers to add them");
  env.store.setUser("B04");
  assert.equal(env.context.MNP_BOM_DIALOGS.wipInsert(env.ctx(), { parentCode: parent, childCode: "WIP-TP01-A" }), null);
  assert.doesNotMatch(await env.render(query), /data-rf-open="routingEdit"/);
});

test("purchasing belongs to the raw-material store: the purchase dialog is read-only for others, rows to order are marked, and the store's jobs list receipts and shortages", async () => {
  const env = load();
  env.store.setUser("B03");
  const hub = env.context.MNP_BOM_PAGES.hub;
  const rfCtx = (rights) => ({ ...env.rf.context(new URLSearchParams()), can: (permission) => rights.includes(permission) });
  const chem = hub.draftChemicals(env.ctx(), env.store.data().orders.find((order) => order.id === "DEMO-26002"));
  // ทำให้เคมีขาดหนึ่งตัว: เอาล็อตของเคมีตัวแรกออก
  const code = chem.rows[0].itemCode;
  const rf = env.rf.store.data();
  rf.materialLots = rf.materialLots.filter((lot) => lot.materialCode !== code);
  // step 2 of the draft: the chemical shortage is shown once, in the chemical table (its rows say ขาด), not again as a count in the card title
  const step2 = await env.render("p=orders&sel=DEMO-26002");
  clean(step2);
  assert.match(step2, /เคมีของเส้นยาง/, "the chemical table is there");
  assert.match(step2, /<tr class="bom-short">/, "with its short rows");
  assert.doesNotMatch(step2, /เคมีขาด \d+ จาก|เคมีพอทั้ง/, "no second count of the same shortage in the card header");
  assert.doesNotMatch(step2, /ขั้น 2 · ตรวจของ <span class="muted">/, "the header carries no summary of the purchased parts either: the table of the same card shows them");
  assert.match(step2, /<h2>ขั้น 2 · ตรวจของ<\/h2>/);
  const args = { woIds: [], sourcePi: "DEMO-26002", draftOrders: chem.orders, parts: false };
  const order = env.context.MNP_RUBBERFLOW_DIALOGS.purchase(rfCtx(["purchase"]), args).html;
  clean(order);
  assert.match(order, /data-rf-form="createPurchaseOrder"/);
  assert.match(order, /ต้องสั่ง 1 รายการ \(แถวที่ไฮไลต์\)/);
  assert.equal((order.match(/<tr data-rf-po-row[^>]*class="rf-po-need"/g) ?? []).length, 1, "only the short row is marked");
  assert.match(order, new RegExp(`class="rf-po-need"><td><span class="rf-mono">${code}</span>`));
  assert.match(order, /type="submit" form="rf-purchase">สั่งซื้อ</);
  const view = env.context.MNP_RUBBERFLOW_DIALOGS.purchase(rfCtx(["viewPurchase"]), args).html;
  assert.doesNotMatch(view, /data-rf-form="createPurchaseOrder"|type="submit"/, "a viewer gets no form and no order button");
  assert.match(view, /สั่งซื้อและรับเข้าโดยคลังวัตถุดิบ \(ST\) หน้าต่างนี้ดูได้อย่างเดียว/);
  assert.match(view, /data-rf-qty[^>]*readonly/);
  // สิทธิ์ของโหมดฐานข้อมูล: ST และ admin สั่ง/รับเข้า/ยกเลิกได้ กลุ่มวางแผนและ RB ดูได้อย่างเดียว
  const can = env.context.MNP_RUBBERFLOW_STORE.can;
  const persona = (role, dept) => env.context.MNP_RUBBERFLOW_STORE.personaUser({ id: "x", first_name: "ก", last_name: "ข", role: { code: role }, department: { code: dept } });
  for (const right of ["purchase", "receiveMaterial", "cancelPurchase"]) {
    assert.equal(can(persona("staff", "ST"), right), true, `ST: ${right}`);
    assert.equal(can(persona("admin", "AD"), right), true, `admin: ${right}`);
    assert.equal(can(persona("staff", "PP"), right), false, `planning staff: ${right}`);
    assert.equal(can(persona("department_manager", "MT"), right), false, `a department manager: ${right}`);
    assert.equal(can(persona("staff", "RB"), right), false, `RB: ${right}`);
  }
  assert.equal(can(persona("staff", "PP"), "viewPurchase"), true);
  assert.equal(can(persona("staff", "RB"), "viewPurchase"), true);
  assert.equal(can(persona("staff", "QA"), "viewPurchase"), false);
  // งานของฉันของคลังวัตถุดิบ (จำลองโหมดฐานข้อมูล): ใบสั่งซื้อที่รอรับ และใบที่ของซื้อยังขาด
  rf.purchaseOrders.push({ id: "PO-20261113-01", status: "ordered", sourcePi: "DEMO-26002", createdAt: Date.now(), lines: [{ materialCode: "P-BOX-01", source: "bom", uom: "box", qtyKg: 30, receivedKg: null }, { materialCode: code, source: "rf", qtyKg: 5, receivedKg: 5 }] }, { id: "PO-20261113-02", status: "received", lines: [{ materialCode: code, source: "rf", qtyKg: 1, receivedKg: 1 }] });
  const stUser = env.store.data().users.find((user) => user.role === "st");
  const stCtx = (rights) => ({ ...env.ctx("p=work"), user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => rights.includes(permission) }) });
  const tasks = hub.storeTasks(stCtx(["purchase", "receiveMaterial"]));
  assert.deepEqual(json(tasks.filter((task) => task.kind === "receive" && task.po.id.startsWith("PO-20261113")).map((task) => [task.po.id, task.lines.map((line) => line.materialCode)])), [["PO-20261113-01", ["P-BOX-01"]]], "only orders with a line still to receive");
  // ใบสั่งซื้อสาธิตของ RubberFlow: EPDM รับมาแล้ว 300 จาก 500 ยังค้าง 200 (รับไม่ครบยังเป็นงาน · 20261128020000) CBS ยังไม่มา
  assert.deepEqual(json(tasks.filter((task) => task.kind === "receive" && task.po.note === "สั่งเติมสต็อก (ข้อมูลสาธิต)").map((task) => task.lines.map((line) => [line.materialCode, line.open, line.received]))), [[["EPDM-55", 200, 300], ["CBS", 30, 0]]],
    "a partly received line stays on the store's card with what is still due");
  assert.ok(tasks.some((task) => task.kind === "buy" && task.orders.some((row) => row.orderId === "DEMO-26002")), "a draft with short parts is a job for the store");
  // U2: หนึ่งการ์ดต่อวัตถุดิบ (ไม่ใช่ต่อใบ) ยอดรวม = ค่ามากสุดของขาดต่อใบ ไม่ใช่ผลบวก · การ์ดพาไปสั่งที่ใบที่ขาดมากสุด
  const buys = tasks.filter((task) => task.kind === "buy");
  assert.equal(new Set(buys.map((task) => task.itemCode)).size, buys.length, "one card per material");
  const shared = buys.filter((task) => task.orders.length > 1);
  assert.ok(shared.length > 0, "the demo orders share at least one short part");
  for (const task of shared) {
    assert.equal(task.total, Math.max(...task.orders.map((row) => row.short)), `${task.itemCode}: the total is the largest per-order shortage, not the sum`);
    assert.ok(task.total < task.orders.reduce((sum, row) => sum + row.short, 0), "and the cards of the old per-order list would have double counted it");
    assert.equal(task.orders.find((row) => row.short === task.total).orderId, task.order.id, "the card leads to the order whose purchase dialog holds the whole figure");
  }
  assert.deepEqual(json(hub.storeTasks(stCtx([]))), [], "nothing for an account without the rights");
  const html = env.context.MNP_BOM_PAGES.work(stCtx(["purchase", "receiveMaterial"])).html;
  clean(html);
  assert.match(html, /<h2>รับเข้าตามใบสั่งซื้อ PO-20261113-01<\/h2>/);
  assert.match(html, /href="#\/rubberflow\?p=warehouse&amp;tab=po&amp;q=PO-20261113-01">ตรวจสอบรับเข้า</);
  const boxName = env.store.data().items.find((item) => item.code === "P-BOX-01").name;
  assert.ok(boxName, "the demo part has a name");
  assert.ok(html.includes(`<span class="rf-mono">P-BOX-01</span> <span class="small muted">${boxName}</span>`), "the receive card shows the part name next to the code (a purchase order line holds only the code)");
  assert.equal(count(html, /<h2>สั่งซื้อ [^<]*<\/h2>/g), buys.length, "the work page draws one purchase card per material");
  assert.match(html, /<div class="bom-job-amount"><span>ขาดรวม [\d.,]+ [^<]*<\/span><\/div>/);
  assert.match(html, new RegExp(`>ต้องทำ ${tasks.length + 3}<`), "the tab counts the store jobs with the part cards of the three released PIs");
  // the menu number is that same count (workCount reads the same board as the page), for the store and for admin, who sees the store's cards on the all-department board
  const tabOf = (ctx) => Number(/>ต้องทำ (\d+)</.exec(env.context.MNP_BOM_PAGES.work(ctx).html)[1]);
  assert.equal(hub.workCount(stCtx(["purchase", "receiveMaterial"])), tasks.length + 3);
  const adminCtx = { ...stCtx(["purchase", "receiveMaterial"]), user: env.store.data().users.find((user) => user.role === "admin") };
  assert.equal(hub.workCount(adminCtx), tabOf(adminCtx));
  assert.ok(tabOf(adminCtx) >= tasks.length + 3, "admin's board holds the store's cards too");
  assert.equal(hub.workCount(stCtx([])), tabOf(stCtx([])), "and without the rights the store's cards are in neither count");
  assert.doesNotMatch(env.context.MNP_BOM_PAGES.work(stCtx(["viewPurchase"])).html, /รับเข้าตามใบสั่งซื้อ|สั่งซื้อของที่ขาด/);
});

test("an inserted WIP item enters the parent at the step its line was ticked for in the production steps, and the store's order saves a chemical's safety stock while an account without planner, RB or ST rights leaves it alone", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const child = "PT-00320";
  const processes = env.context.MNP_BOM_ACTIONS.helpers.processesOf(env.store.data()).filter((entry) => entry.dept === "PK").slice(0, 2).map((entry) => entry.code);
  assert.equal(processes.length, 2);
  assert.equal(env.store.run("saveRouting", { itemCode: parent, steps: [{ processCode: processes[0], minutesPerPc: 1, inputs: [] }, { processCode: processes[1], minutesPerPc: 1, inputs: [child] }] }).ok, true);
  await env.submit("p=find", "saveBomTree", { wipCode: "WIP-STEP-1", wipName: "ชุดประกอบ", wipKind: "SUBPART", wipUom: "pcs", wipQty: "1", childQty: "" }, { wipInsert: true, code: parent, childCode: child });
  const line = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.find((entry) => entry.childCode === "WIP-STEP-1");
  assert.equal(line.step, 2, "the new item takes the step the moved line was routed to");
  const routingNow = () => env.context.MNP_BOM_ACTIONS.helpers.routingOf(env.store.data(), parent);
  assert.deepEqual(json(routingNow().steps.map((step) => step.inputs)), [[], ["WIP-STEP-1"]], "the parent's production steps now name the new item, not the old line");
  const revision = routingNow().revision;
  const previous = env.store.data().routings.find((entry) => entry.itemCode === parent && entry.revision === revision - 1);
  assert.deepEqual(json(previous.steps.map((step) => step.inputs)), [[], [child]], "as a new routing revision: the earlier one still names the old line");
  assert.equal(previous.status, "superseded");
  // บรรทัดที่ไม่มีขั้นตอนผลิตอ้างอยู่: ไม่เปิด revision ใหม่ของขั้นตอน
  const other = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.find((entry) => ![child, "WIP-STEP-1"].includes(entry.childCode));
  await env.submit("p=find", "saveBomTree", { wipCode: "WIP-STEP-2", wipName: "ชุดอื่น", wipKind: "SUBPART", wipUom: "pcs", wipQty: "1", childQty: "" }, { wipInsert: true, code: parent, childCode: other.childCode });
  assert.ok(env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.some((entry) => entry.childCode === "WIP-STEP-2"), "the second insert saved");
  assert.equal(routingNow().revision, revision, "a line no step names leaves the routing alone");
  // ใบสั่งซื้อในโหมดฐานข้อมูล: ST แก้สต็อกขั้นต่ำของเคมีได้พร้อมใบสั่งซื้อ (ค่านี้ถูกปัดเป็น 3 ตำแหน่งตามที่หน้าต่างส่งมา) · บัญชีที่ไม่ใช่ planner / RB / ST (ผู้ดูแลที่ไม่มี flag) สั่งได้แต่ไม่แตะวัตถุดิบ
  const A = env.context.MNP_RUBBERFLOW_ACTIONS;
  const d = json(env.rf.store.data());
  const material = d.materials[0];
  material.safetyKg = 12.3456;
  const ctx = (user) => ({ user, now: Date.now(), remote: true });
  const payload = { lines: [{ materialCode: material.code, needKg: 1, availableKg: 0, shortageKg: 1, safetyKg: 12.346, qtyKg: 5 }], safety: { [material.code]: 12.346 } };
  A.createPurchaseOrder(d, { ...payload, safety: { [material.code]: 7 }, lines: [{ ...payload.lines[0], safetyKg: 7 }] }, ctx({ name: "ผู้ดูแล", role: "admin" }));
  assert.equal(d.materials[0].safetyKg, 12.3456, "an account without planner, RB or ST rights does not change the stored safety stock");
  assert.equal(d.purchaseOrders.at(0).lines[0].safetyKg, 12.346, "its order line carries the stored value (3 decimals), not the 7 it asked for");
  A.createPurchaseOrder(d, payload, ctx({ name: "คลัง", role: "store", st: true }));
  assert.equal(d.materials[0].safetyKg, 12.346, "the store's order saves the changed safety stock");
  assert.equal(d.purchaseOrders.at(0).lines[0].safetyKg, 12.346);
  A.createPurchaseOrder(d, { ...payload, safety: { [material.code]: 20 } }, ctx({ name: "ผู้ดูแล", role: "admin", planner: true }));
  assert.equal(d.materials[0].safetyKg, 20, "an account that may edit materials still changes it with the order");
});

test("the store orders chemicals for every open RubberFlow work order from the purchase-order tab, and sees the shortage as a job", async () => {
  const env = load();
  env.store.setUser("B03");
  const rf = env.rf.store.data();
  const rules = env.context.MNP_RUBBERFLOW_RULES;
  const open = rf.orders.filter((order) => rules.OPEN_ORDER.includes(order.status));
  assert.ok(open.length > 0, "the demo has open work orders");
  const rfCtx = (rights, query = "p=warehouse&tab=po") => ({ ...env.rf.context(new URLSearchParams(query)), can: (permission) => rights.includes(permission) });
  // สต็อกพอ: ปุ่มเป็นปุ่มตรวจ · ทำให้เคมีตัวหนึ่งขาด: ปุ่มบอกจำนวนรายการที่ขาด
  let page = env.context.MNP_RUBBERFLOW_PAGES.warehouse(rfCtx(["purchase"])).html;
  clean(page);
  assert.match(page, /data-rf-open="purchase" data-rf-args="\{&quot;allOpen&quot;:true,&quot;parts&quot;:false\}"/);
  const all = env.rf.openChemicalNeeds();
  assert.ok(all.rows.length > 0);
  const code = all.rows[0].materialCode;
  rf.materialLots = rf.materialLots.filter((lot) => lot.materialCode !== code);
  page = env.context.MNP_RUBBERFLOW_PAGES.warehouse(rfCtx(["purchase"])).html;
  assert.match(page, />สั่งซื้อเคมีที่ขาด 1 รายการ</);
  assert.doesNotMatch(env.context.MNP_RUBBERFLOW_PAGES.warehouse(rfCtx(["purchase"], "p=warehouse")).html, /allOpen/, "only on the purchase-order tab");
  // หน้าต่าง: เคมีของทุกใบที่เปิดอยู่ ชุดเดียวกับ openChemicalNeeds · ไม่มีตารางของซื้อของ BOM
  const dialog = env.context.MNP_RUBBERFLOW_DIALOGS.purchase(rfCtx(["purchase"]), { allOpen: true, parts: false }).html;
  clean(dialog);
  const needs = env.rf.openChemicalNeeds();
  assert.equal((dialog.match(/data-rf-po-row/g) ?? []).length, needs.rows.length);
  assert.equal((dialog.match(/class="rf-po-need"/g) ?? []).length, 1);
  assert.match(dialog, new RegExp(`class="rf-po-need"><td><span class="rf-mono">${code}</span>`));
  assert.doesNotMatch(dialog, /ของซื้อ \(ตามหน่วยของชิ้น\)/);
  // งานของฉันของคลังวัตถุดิบ: การ์ดเคมีที่ขาด พาไปแท็บใบสั่งซื้อ · ผู้ที่สั่งไม่ได้ไม่เห็น
  const hub = env.context.MNP_BOM_PAGES.hub;
  const stUser = env.store.data().users.find((user) => user.role === "st");
  const stCtx = (rights) => ({ ...env.ctx("p=work"), user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => rights.includes(permission) }) });
  const tasks = hub.storeTasks(stCtx(["purchase"]));
  assert.deepEqual(json(tasks.filter((task) => task.kind === "chem").map((task) => task.short.map((row) => row.materialCode))), [[code]]);
  const html = env.context.MNP_BOM_PAGES.work(stCtx(["purchase"])).html;
  clean(html);
  assert.match(html, /<h2>สั่งซื้อเคมีที่ขาด 1 รายการ<\/h2>/);
  assert.match(html, /href="#\/rubberflow\?p=warehouse&amp;tab=po">เปิดหน้าใบสั่งซื้อ</);
  assert.equal(hub.storeTasks(stCtx(["receiveMaterial"])).some((task) => task.kind === "chem"), false);
  // แผนก RB ที่เคมีไม่พอ: ไม่มีปุ่มสั่ง มีข้อความให้แจ้งคลังวัตถุดิบ
  // วาดหน้าต่างเบิกเคมีจริงของ WO ที่เคมี (code) ขาด แล้วผูกกับ dialog จำลอง: บัญชีที่สั่งซื้อไม่ได้เห็นข้อความ ไม่เห็นปุ่ม · บัญชีที่สั่งซื้อได้เห็นปุ่ม ไม่เห็นข้อความ
  const rfRules = env.context.MNP_RUBBERFLOW_RULES;
  const rfData = env.rf.store.data();
  const reqOrder = rfData.orders.find((row) => {
    const recipe = rfRules.recipeOf(rfData.recipes, row.recipeId, row.recipeRevision);
    return ["released", "in_progress"].includes(row.status) && recipe && rfRules.nextRequisitionBatches(row, recipe, rfData.requisitions) > 0 && rfRules.recipeLines(recipe).some((line) => line.materialCode === code);
  });
  assert.ok(reqOrder, "a work order with batches left uses the short chemical");
  const openRequisition = (rights, extra = {}) => {
    const nodes = {
      "[data-rf-order]": { value: reqOrder.id, addEventListener() {} }, "[data-rf-batches]": { value: "" }, "[data-rf-submit]": { disabled: false },
      "[data-rf-recipe-line]": {}, "[data-rf-preview]": {}, "[data-rf-shortage]": { innerHTML: "", addEventListener() {} },
    };
    const built = env.context.MNP_RUBBERFLOW_DIALOGS.createRequisition({ ...rfCtx(rights, "p=requisition"), can: (permission) => rights.includes(permission), ...extra });
    assert.match(built.html, /data-rf-shortage/, "the real dialog markup has the shortage box");
    built.bind({ querySelector: (selector) => nodes[selector] }, extra);
    return nodes;
  };
  const rbNodes = openRequisition([]);
  assert.match(rbNodes["[data-rf-shortage]"].innerHTML, /แจ้งคลังวัตถุดิบ \(ST\) ให้สั่งซื้อ คลังวัตถุดิบเห็นรายการที่ขาดในแท็บใบสั่งซื้อของหน้าคลัง/);
  assert.doesNotMatch(rbNodes["[data-rf-shortage]"].innerHTML, /data-rf-po-short/, "no order button for an account that cannot order");
  assert.equal(rbNodes["[data-rf-submit]"].disabled, true, "and the requisition cannot be sent while a chemical is short");
  const stNodes = openRequisition(["purchase"], { openDialog() {} });
  assert.match(stNodes["[data-rf-shortage]"].innerHTML, /data-rf-po-short/, "the store gets the button");
  assert.doesNotMatch(stNodes["[data-rf-shortage]"].innerHTML, /แจ้งคลังวัตถุดิบ/);
});

test("lines are reordered across departments (the saved order is kept), moved under another item of the same structure in one save, and a cancelled PI turns its purchase order into a decision for the store", async () => {
  const env = load();
  env.store.setUser("B03");
  const root = "DEMO-TP-01(P)-Y";
  const hub = env.context.MNP_BOM_PAGES.hub;
  const itemOf = (code) => env.store.data().items.find((item) => item.code === code) ?? null;
  const bomOf = (code) => json(env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null);
  const rowsOf = () => env.context.MNP_BOM_RULES.explode(root, 1, { itemOf, approvedBomOf: (code) => env.store.data().boms.find((bom) => bom.itemCode === code && bom.status === "approved") ?? null }).lines.slice(1);
  const sideOf = (code) => hub.treeTab(env.ctx(), itemOf(root), 1).detailHtml(rowsOf().findIndex((row) => row.itemCode === code && row.level === 1));
  const unescape = (value) => value.replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&#039;", "'");
  const before = bomOf(root);
  const codes = before.lines.map((line) => line.childCode);
  // เลื่อนลำดับ: สลับกับบรรทัดติดกันได้ทุกแผนก (ของซื้อสามตัวแรกเป็นของคลังวัตถุดิบ ตัวที่สี่เป็นของ GR)
  let side = sideOf(codes[0]);
  assert.match(side, /<button class="btn rf-btn secondary" type="button" disabled title="อยู่บนสุดแล้ว">เลื่อนขึ้น</, "both directions always show: the first line has its up button switched off");
  const down = /data-rf-action="saveBom" data-rf-args="([^"]*)"[^>]*>เลื่อนลง</.exec(side);
  assert.ok(down, "a line with a neighbour can move down");
  const args = JSON.parse(unescape(down[1]));
  assert.deepEqual(args.lines.map((line) => line.childCode), [codes[1], codes[0], ...codes.slice(2)]);
  assert.equal(env.store.run("saveBom", args).ok, true);
  let after = bomOf(root);
  assert.equal(after.revision, before.revision + 1);
  assert.deepEqual(after.lines.map((line) => line.childCode), [codes[1], codes[0], ...codes.slice(2)]);
  assert.match(after.changeLog[0].text, /เรียงลำดับส่วนประกอบใหม่/);
  for (const line of before.lines) assert.equal(after.lines.find((entry) => entry.childCode === line.childCode).qty, line.qty);
  // สลับข้ามแผนก (ของซื้อ ST กับชิ้นของ GR): บันทึกแล้วลำดับคงตามที่สั่ง ไม่ถูกจัดตามผังงานกลับ
  const crossDown = /data-rf-action="saveBom" data-rf-args="([^"]*)"[^>]*>เลื่อนลง</.exec(sideOf(codes[2]));
  assert.ok(crossDown, "the next line belongs to another department and the down button is still on");
  const crossArgs = JSON.parse(unescape(crossDown[1]));
  assert.deepEqual(crossArgs.lines.map((line) => line.childCode), [codes[1], codes[0], codes[3], codes[2], ...codes.slice(4)]);
  assert.equal(env.store.run("saveBom", crossArgs).ok, true);
  after = bomOf(root);
  assert.deepEqual(after.lines.map((line) => line.childCode), crossArgs.lines.map((line) => line.childCode), "the order the user gave is what is stored");
  assert.equal(after.revision, before.revision + 2);
  assert.equal(rowsOf()[2].itemCode, codes[3], "the tree reads the stored order");
  assert.deepEqual(env.context.MNP_BOM_STORE.migrate(json(env.store.data())).boms.find((bom) => bom.id === after.id).lines.map((line) => line.childCode), after.lines.map((line) => line.childCode), "a reload of the stored data keeps the order");
  assert.match(sideOf(codes[1]), /disabled title="อยู่บนสุดแล้ว">เลื่อนขึ้น</, "only the top and bottom of the list switch a direction off");
  // ย้ายไปใต้ชิ้นอื่น: ตัวเลือกคือชิ้นในโครงสร้างนี้ที่รับได้ · ชิ้นแม่เดิมและใหม่ได้ฉบับใหม่ในคำสั่งเดียว
  const moved = codes[2];
  const target = "SE-TP01-OR01-100-18-65";
  const targetBefore = bomOf(target);
  const untouched = "SE-TP01-BK01-140-3-20";
  const untouchedBefore = bomOf(untouched);
  assert.ok(untouchedBefore, "the demo has a second sub-assembly");
  const dialog = env.context.MNP_BOM_DIALOGS.lineMove(env.ctx(), { rootCode: root, parentCode: root, childCode: moved });
  clean(dialog.html);
  assert.match(dialog.html, new RegExp(`<option value="${target}"`));
  assert.doesNotMatch(dialog.html, /<option value="(P-STK-01|RB-[^"]*|DEMO-TP-01\(P\)-Y)"/, "no purchased part, no rubber rod and not the current parent as a target");
  assert.match(side, /data-rf-open="lineMove"/);
  assert.match(side, /data-rf-open="itemEdit" data-rf-args="\{&quot;code&quot;:&quot;/, "the item's name and unit are edited from the side panel");
  const query = `p=find&code=${encodeURIComponent(root)}`;
  await env.submit(query, "saveBomTree", { toCode: "" }, { lineMove: true, code: root, fromCode: root, childCode: moved });
  assert.match(env.log.toasts.at(-1)[0], /เลือกชิ้นที่จะย้ายไปอยู่ใต้/);
  await env.submit(query, "saveBomTree", { toCode: targetBefore.lines[0].childCode }, { lineMove: true, code: root, fromCode: root, childCode: target });
  assert.match(env.log.toasts.at(-1)[0], /ข้อมูลเส้นยาง/, "a rubber rod is never a target: the move is refused before anything is saved");
  assert.equal(bomOf(target).revision, targetBefore.revision);
  assert.equal(bomOf(root).revision, before.revision + 2, "the refused move leaves the root as it was");
  await env.submit(query, "saveBomTree", { toCode: target, note: "" }, { lineMove: true, code: root, fromCode: root, childCode: moved });
  after = bomOf(root);
  const targetAfter = bomOf(target);
  assert.equal(after.lines.some((line) => line.childCode === moved), false);
  assert.equal(after.lines.length, before.lines.length - 1);
  assert.equal(targetAfter.revision, targetBefore.revision + 1);
  assert.equal(targetAfter.lines.find((line) => line.childCode === moved).qty, before.lines.find((line) => line.childCode === moved).qty, "the quantity moves with the line");
  for (const line of targetBefore.lines) assert.equal(targetAfter.lines.find((entry) => entry.childCode === line.childCode).qty, line.qty, "the target's own lines keep their exact quantities");
  assert.equal(bomOf(untouched).revision, untouchedBefore.revision, "other sub-assemblies are not rewritten");
  await env.submit(query, "saveBomTree", { toCode: target }, { lineMove: true, code: root, fromCode: root, childCode: moved });
  assert.match(env.log.toasts.at(-1)[0], /ไม่พบ .* ใน BOM ของ/, "a stale form is refused");
  // บรรทัดเดียวใต้ชิ้นแม่: ไม่มีปุ่มเลื่อนขึ้น/ลง (ไม่มีอะไรให้เรียง) และไม่มีปุ่มย้ายไปใต้ชิ้นอื่น
  assert.equal(env.store.run("saveBom", { itemCode: root, lines: [{ childCode: codes[3], qty: 1 }], note: "เหลือบรรทัดเดียว" }).ok, true);
  const only = sideOf(codes[3]);
  assert.doesNotMatch(only, />เลื่อนขึ้น</);
  assert.doesNotMatch(only, />เลื่อนลง</);
  assert.doesNotMatch(only, /data-rf-open="lineMove"/);
  // ชิ้นแม่ที่เหลือบรรทัดเดียวย้ายออกไม่ได้ และผู้ที่ไม่ใช่ฝ่ายวางแผนไม่มีหน้าต่างนี้
  const single = env.store.data().boms.find((bom) => bom.status === "approved" && bom.lines.length === 1 && itemOf(bom.itemCode)?.kind !== "RB");
  if (single) assert.equal(env.context.MNP_BOM_DIALOGS.lineMove(env.ctx(), { rootCode: single.itemCode, parentCode: single.itemCode, childCode: single.lines[0].childCode }), null);
  env.store.setUser("B04");
  assert.equal(env.context.MNP_BOM_DIALOGS.lineMove(env.ctx(), { rootCode: root, parentCode: root, childCode: codes[0] }), null);
  // ใบสั่งซื้อของใบสั่งผลิตที่ถูกยกเลิก: การ์ดให้คลังวัตถุดิบตัดสิน
  env.store.setUser("B03");
  const rf = env.rf.store.data();
  rf.purchaseOrders.push({ id: "PO-20261114-07", status: "ordered", sourcePi: "DEMO-26002", createdAt: Date.now(), lines: [{ materialCode: "P-BOX-01", source: "bom", uom: "box", qtyKg: 5, receivedKg: null }] });
  const stUser = env.store.data().users.find((user) => user.role === "st");
  const stCtx = () => ({ ...env.ctx("p=work"), user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => ["receiveMaterial", "purchase"].includes(permission) }) });
  const receiveTask = () => hub.storeTasks(stCtx()).find((task) => task.kind === "receive" && task.po.id === "PO-20261114-07");
  assert.equal(receiveTask().cancelled, false);
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26002", reason: "ทดสอบ" }).ok, true);
  assert.equal(receiveTask().cancelled, true);
  const work = env.context.MNP_BOM_PAGES.work(stCtx()).html;
  clean(work);
  assert.match(work, /<span class="bom-job-state">ใบสั่งผลิตถูกยกเลิกแล้ว<\/span>/);
  assert.match(work, /<h2>ตัดสินใบสั่งซื้อ PO-20261114-07<\/h2>/);
  assert.match(work, /ยกเลิกใบสั่งซื้อ หรือรับเข้าเป็นสต็อกไว้ใช้กับใบอื่น/);
});

// ---------- คลังสินค้า (WH): ขั้น 5 รับเข้าคลัง · ขั้น 6 ส่งมอบลูกค้า (โหมดในเครื่อง) ----------
const FG_TP = "DEMO-TP-01(P)-Y";
const FG_HL = "DEMO-HL-24(B)-A";
const FG_PI = "DEMO-26001";
const whLoad = () => {
  return load(); // B09 = พนักงานคลังสินค้าของข้อมูลสาธิต
};
// งานของแผนกผลิตอื่น (RB GR PT BG) ของใบถือว่าเสร็จแล้ว (ใบปิดได้เมื่อทุกงานผลิตเสร็จ: 20261125010000) · การเบิกของซื้อ (ST) ไม่นับ จึงไม่แตะ
const finishOtherDepts = (env, orderId = FG_PI) => { for (const job of env.store.data().jobs) if (job.orderId === orderId && !["PK", "ST"].includes(job.dept)) job.status = "done"; };
// PK รายงานตามจำนวนที่ให้ (ชิ้นย่อย XP- ของ PK ทำครบ) โดยฝ่ายวางแผน แล้วกลับมาเป็นผู้ใช้เดิม · แผนกอื่นเสร็จแล้ว
const pkReport = (env, made, backTo = "B09") => {
  finishOtherDepts(env);
  env.store.setUser("B03");
  for (const job of env.store.data().jobs.filter((entry) => entry.orderId === FG_PI && entry.dept === "PK")) {
    if (job.status === "done") continue;
    const qty = job.kind === "FG" ? made[job.itemCode] ?? 0 : job.qtyPlanned; // จำนวนที่รายงานเพิ่มครั้งนี้
    if (qty > 0) assert.equal(env.store.run("reportJob", { jobId: job.id, qtyDone: qty }).ok, true);
  }
  env.store.setUser(backTo);
};
const fgRun = (env, action, lines, extra = {}) => { const result = env.store.run(action, { orderId: FG_PI, lines: lines.map(([fgCode, qty]) => ({ fgCode, qty })), ...extra }); assert.equal(result.ok, true, result.error?.message); return result; };
const count = (html, pattern) => (html.match(pattern) ?? []).length;

test("a PI has a six-step bar: the warehouse's steps 5 and 6 replace the planner's close, nobody gets a close button, and the bar fits six steps", async () => {
  const env = load();
  env.store.setUser("B03");
  const html = await env.render(`p=orders&sel=${FG_PI}`);
  clean(html);
  assert.equal(count(html, /<li class="bom-step /g), 6);
  assert.match(html, /<span class="bom-step-no">ขั้น 5<\/span><strong>รับเข้าคลัง<\/strong><span class="small">คลังสินค้า \(WH\)<\/span>/);
  assert.match(html, /<span class="bom-step-no">ขั้น 6<\/span><strong>ส่งมอบลูกค้า<\/strong><span class="small">คลังสินค้า \(WH\)<\/span>/);
  assert.doesNotMatch(html, /completeOrder|>ปิดใบ</, "the planner's close button is gone");
  assert.doesNotMatch(html, /มีสินค้ารอรับเข้าคลัง/, "nothing to receive before PK reports");
  const css = fs.readFileSync("styles.css", "utf8");
  assert.match(css, /\.bom-steps \{[^}]*grid-template-columns: repeat\(6,/, "six columns on a wide screen");
  assert.match(css, /@media \(min-width: 761px\) and \(max-width: 1100px\) \{ \.bom-steps \{ grid-template-columns: repeat\(3,/, "three per row on a tablet");
  const phone = css.match(/@media \(max-width: 760px\) \{\s*\.bom-steps \{([^}]*)\}\s*\.bom-steps > \.bom-step \{([^}]*)\}/);
  assert.ok(phone, "the phone rules target .bom-steps > .bom-step, not the input class .bom-step");
  assert.match(phone[1], /display: flex/, "one row on a phone");
  assert.match(phone[1], /overflow-x: auto/, "that scrolls sideways");
  assert.match(phone[2], /flex: 0 0 auto/, "each step keeps its width");
  assert.match(css, /\.bom-steps > \.bom-step:not\(\.is-now\) \.small \{ display: none; \}/, "only the current step shows who does it");
  const hub = env.context.MNP_BOM_PAGES.hub;
  assert.equal(hub.orderStepOf(env.ctx(), { id: "X", status: "completed", items: [] }), 7, "closed with nothing to deliver: every step is done");
  assert.equal(hub.orderStepOf(env.ctx(), { status: "cancelled", items: [] }), 0);
});

test("step 5: the warehouse sees what PK made and what is waiting, receives while production runs, and everyone else sees the same table read-only", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  let html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /aria-current="step"><div><span class="bom-step-no">ขั้น 4/, "nothing reported yet: step 5 is not reachable, the page stays on step 4");
  assert.doesNotMatch(html, /receiveFg/);
  pkReport(env, { [FG_TP]: 30 });
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.match(html, /<strong>มีสินค้ารอรับเข้าคลัง<\/strong>/, "step 4 points to step 5 without repeating the numbers");
  assert.match(html, /<li class="bom-step is-todo"><a href="[^"]*step=5"><span class="bom-step-no">ขั้น 5/, "step 5 becomes a link");
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /<li class="bom-step is-now" aria-current="step"><div><span class="bom-step-no">ขั้น 5/);
  for (const head of ["สั่ง", "PK ส่งมอบแล้ว", "รับเข้าคลังแล้ว", "รอรับ", "รับครั้งนี้"]) assert.match(html, new RegExp(`<th class="right">${head}</th>`), head);
  assert.match(html, /data-rf-form="receiveFg" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26001&quot;\}"/);
  assert.equal(count(html, /name="qty\[\]"/g), 1, "one input: HL has nothing to receive and gets none");
  assert.match(html, /name="qty\[\]" type="number" inputmode="decimal" step="any" min="0" max="30" value="30"/, "prefilled with what is waiting");
  assert.match(html, /<input type="hidden" name="fgCode\[\]" value="DEMO-TP-01\(P\)-Y">/);
  assert.match(html, /<button class="btn rf-btn" type="submit" data-rf-confirm="รับสินค้าเข้าคลังตามจำนวนที่กรอก\?[^"]*">รับเข้าคลัง<\/button>/);
  assert.doesNotMatch(html, /ปิดใบ \(รับไม่ครบ\)/, "not closable: HL has no PK report");
  assert.doesNotMatch(html, /undo|นับถอยหลัง/);
  // read-only for the planning group and for ST
  for (const id of ["B03", "B01", "B08"]) {
    env.store.setUser(id);
    html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
    clean(html);
    if (id === "B01") { assert.match(html, /data-rf-form="receiveFg"/, "admin may receive"); continue; }
    assert.doesNotMatch(html, /data-rf-form="receiveFg"|name="qty\[\]"|data-rf-open="closeShort"/, `${id} cannot act`);
    assert.match(html, /<th class="right">PK ส่งมอบแล้ว<\/th>/, `${id} sees the table`);
    assert.match(html, /คลังสินค้า \(WH\) เป็นผู้รับสินค้าเข้าคลัง/, `${id} is told who acts`);
  }
});

test("receiving through the form asks once, sends at once, and the order closes by itself when everything is in; the stock page shows what is on hand", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 30 });
  // ปฏิเสธการยืนยัน = ไม่ส่ง
  env.log.confirmAnswer = false;
  const submitter = { dataset: { rfConfirm: "รับสินค้าเข้าคลังตามจำนวนที่กรอก? รับเข้าแล้วแก้ไขหรือยกเลิกไม่ได้" }, textContent: "รับเข้าคลัง", getAttribute: () => null };
  await env.submit(`p=orders&sel=${FG_PI}&step=5`, "receiveFg", { "fgCode[]": [FG_TP, FG_HL], "qty[]": ["30", ""] }, { orderId: FG_PI }, { submitter });
  assert.deepEqual(json(env.log.confirms.at(-1)), { title: "รับสินค้าเข้าคลังตามจำนวนที่กรอก?", message: "รับเข้าแล้วแก้ไขหรือยกเลิกไม่ได้", confirmLabel: "รับเข้าคลัง", danger: false });
  // ประวัติของใบนี้เท่านั้น (ชุดสาธิตมีประวัติของใบ DEMO-26008 อยู่แล้ว)
  const ownMoves = () => (env.store.data().fgMoves ?? []).filter((move) => move.orderId === FG_PI);
  assert.equal(ownMoves().length, 0, "declined: nothing is written");
  env.log.confirmAnswer = true;
  await env.submit(`p=orders&sel=${FG_PI}&step=5`, "receiveFg", { "fgCode[]": [FG_TP, FG_HL], "qty[]": ["30", ""] }, { orderId: FG_PI }, { submitter });
  assert.deepEqual(json(ownMoves().map((move) => [move.fgCode, move.kind, move.qty, move.by])), [[FG_TP, "receive", 30, "สุดา คลังสินค้า"]], "the blank row is not sent");
  assert.equal(env.log.toasts.at(-1)[0], "ok 1 รายการ");
  assert.equal(env.store.data().orders.find((order) => order.id === FG_PI).status, "in_progress");
  // ใครที่ไม่ใช่ WH ส่งฟอร์มเองก็ถูกปฏิเสธ (action ตรวจสิทธิ์ซ้ำ)
  env.store.setUser("B03");
  await env.submit(`p=orders&sel=${FG_PI}&step=5`, "receiveFg", { "fgCode[]": [FG_TP], "qty[]": ["1"] }, { orderId: FG_PI });
  assert.match(env.log.toasts.at(-1)[0], /คลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
  assert.equal(ownMoves().length, 1);
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 50, [FG_HL]: 40 });
  let html = await env.render("p=stock");
  clean(html);
  assert.match(html, /<h2>คงคลังสินค้าสำเร็จรูป<\/h2>/);
  assert.match(html, /DEMO-TP-01\(P\)-Y[\s\S]*?<td class="right rf-mono">30 <span class="small muted">[^<]*<\/span><\/td><td class="right rf-mono"><span class="muted">—<\/span><\/td><td><a class="rf-mono" href="[^"]*sel=DEMO-26001[^"]*">DEMO-26001<\/a> <span class="small muted">× 30<\/span>/, "in the warehouse and no free stock (the order still owes it), with the order that holds it");
  assert.match(html, /<th class="right"[^>]*>อยู่ในคลัง<\/th>/);
  assert.match(html, /<th class="right"[^>]*>สต็อกสินค้าสำเร็จรูป<\/th>/);
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.equal(count(html, /name="qty\[\]"/g), 2);
  fgRun(env, "receiveFg", [[FG_TP, 50], [FG_HL, 40]]);
  assert.equal(env.store.data().orders.find((order) => order.id === FG_PI).status, "completed", "received in full: the order closed by itself");
  assert.equal(env.context.MNP_BOM_PAGES.hub.orderStepOf(env.ctx(), env.store.data().orders.find((order) => order.id === FG_PI)), 6, "closed with goods still to deliver");
});

test("step 6: delivery per product with what is left prefilled, a compact history, and the status words follow the delivery", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 80, [FG_HL]: 40 });
  fgRun(env, "receiveFg", [[FG_TP, 80], [FG_HL, 40]], { note: "รอบบ่าย" });
  let html = await env.render(`p=orders&sel=${FG_PI}`);
  clean(html);
  assert.match(html, /<li class="bom-step is-now" aria-current="step"><div><span class="bom-step-no">ขั้น 6/);
  assert.equal(count(html, /<li class="bom-step is-done"/g), 5, "steps 1 to 5 are done");
  assert.match(html, /<span class="rf-badge is-info">รอส่งมอบ<\/span>/, "closed and waiting for delivery");
  assert.doesNotMatch(html, /ส่งมอบแล้ว<\/span>/);
  for (const head of ["มีของในใบนี้", "ส่งมอบแล้ว", "คงเหลือส่งมอบได้", "ส่งครั้งนี้"]) assert.match(html, new RegExp(`<th class="right"[^>]*>${head}</th>`), head);
  assert.match(html, /data-rf-form="deliverFg"/);
  assert.match(html, /max="80" value="80"/);
  assert.match(html, /max="40" value="40"/);
  assert.match(html, /data-rf-confirm="ส่งมอบสินค้าตามจำนวนที่กรอก\?[^"]*">ส่งมอบให้ลูกค้า<\/button>/);
  assert.match(html, /<h3 class="bom-h3">ประวัติรับเข้าและส่งมอบ<\/h3>/);
  assert.equal(count(html, /<td>รับเข้าคลัง <span class="rf-mono">/g), 2, "two receipts in the history");
  assert.match(html, /<div class="small muted">รอบบ่าย<\/div>/);
  // ผู้อื่นดูอย่างเดียว
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.doesNotMatch(html, /data-rf-form="deliverFg"|name="qty\[\]"/);
  assert.match(html, /คลังสินค้า \(WH\) เป็นผู้ส่งมอบสินค้าให้ลูกค้า/);
  assert.match(html, /<h3 class="bom-h3">ประวัติรับเข้าและส่งมอบ<\/h3>/, "the history is visible to everyone");
  // ส่งมอบบางส่วนผ่านฟอร์ม แล้วที่เหลือ
  env.store.setUser("B09");
  await env.submit(`p=orders&sel=${FG_PI}`, "deliverFg", { "fgCode[]": [FG_TP, FG_HL], "qty[]": ["20", ""] }, { orderId: FG_PI });
  assert.equal(env.log.toasts.at(-1)[0], "ok 1 รายการ");
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.match(html, /max="60" value="60"/, "what is left is prefilled");
  assert.match(html, /<span class="rf-badge is-info">รอส่งมอบ<\/span>/);
  fgRun(env, "deliverFg", [[FG_TP, 60], [FG_HL, 40]]);
  html = await env.render(`p=orders&sel=${FG_PI}`);
  clean(html);
  assert.match(html, /<span class="rf-badge is-good">ส่งมอบแล้ว<\/span>/);
  assert.equal(count(html, /<li class="bom-step is-done"/g), 6, "delivered in full: every step is done");
  assert.doesNotMatch(html, /aria-current="step"|data-rf-form="deliverFg"/);
  assert.match(await env.render("p=orders"), /<span class="rf-badge is-good">ส่งมอบแล้ว<\/span>/, "the list says so too");
  assert.doesNotMatch(await env.render("p=work"), /ส่งมอบให้ลูกค้าตามใบ/, "no card once everything is delivered");
  assert.match(await env.render("p=stock"), /ยังไม่มีสินค้าสำเร็จรูปในคลัง/, "everything delivered: nothing on hand");
});

test("closing short: only when PK is done and everything PK made is received; the reason is required, shown once, and escaped", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 70, [FG_HL]: 40 });
  for (const job of env.store.data().jobs.filter((entry) => entry.orderId === FG_PI && entry.dept === "PK")) job.status = "done";
  let html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.doesNotMatch(html, /data-rf-open="closeShort"/, "made but not received yet");
  fgRun(env, "receiveFg", [[FG_TP, 70], [FG_HL, 40]]);
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /<button class="btn rf-btn secondary" type="button" data-rf-open="closeShort"[^>]*>ปิดใบ \(รับไม่ครบ\)<\/button>/);
  const built = env.context.MNP_BOM_DIALOGS.closeShort(env.ctx(`p=orders&sel=${FG_PI}`), { orderId: FG_PI });
  assert.match(built.html, /data-rf-form="closeOrderShort"/);
  assert.match(built.html, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(built.html, /name="note"[^>]*required[^>]*minlength="3" maxlength="300"/);
  assert.match(built.html, /<td class="right rf-mono">10<\/td><\/tr>/, "the shortage is shown");
  env.store.setUser("B03");
  assert.equal(env.context.MNP_BOM_DIALOGS.closeShort(env.ctx(`p=orders&sel=${FG_PI}`), { orderId: FG_PI }), null, "the planning group gets no dialog");
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.doesNotMatch(html, /data-rf-open="closeShort"/);
  env.store.setUser("B09");
  await env.submit(`p=orders&sel=${FG_PI}`, "closeOrderShort", { note: "ab" }, { orderId: FG_PI });
  assert.match(env.log.toasts.at(-1)[0], /อย่างน้อย 3/);
  await env.submit(`p=orders&sel=${FG_PI}`, "closeOrderShort", { note: XSS }, { orderId: FG_PI });
  assert.equal(env.store.data().orders.find((order) => order.id === FG_PI).status, "completed");
  html = await env.render(`p=orders&sel=${FG_PI}`);
  clean(html);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "the typed reason is escaped");
  assert.equal(count(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/g), 1, "the reason is on the screen once (in the history)");
  assert.match(html, /<span class="rf-badge is-info">รอส่งมอบ<\/span>/);
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.equal(count(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/g), 1, "and once on step 5, as the closing note");
  assert.match(html, /ปิดใบโดยรับไม่ครบ:/);
});

test("closing short (U6): the warehouse gets a card and the menu count follows; everyone else reads at step 4 what the warehouse waits for, also while PK is still open", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 70, [FG_HL]: 40 });
  fgRun(env, "receiveFg", [[FG_TP, 70], [FG_HL, 40]]);
  const hub = env.context.MNP_BOM_PAGES.hub;
  const pos = () => env.context.MNP_BOM_RULES.fgPosition(env.store.data(), env.store.data().orders.find((order) => order.id === FG_PI));
  const closeCards = () => hub.fgTasks(env.ctx("p=work")).filter((task) => task.kind === "fgCloseShort");
  // PK ยังรายงานเพิ่มได้ (งาน PK ยังไม่เสร็จ): ปิดรับไม่ครบยังไม่ได้ · ฝ่ายวางแผนเห็นว่าคลังรออะไร ส่วน WH ยังไม่มีการ์ดปิดใบ
  assert.deepEqual([pos().canCloseShort, pos().waitingShort], [false, true]);
  assert.equal(closeCards().length, 0, "nothing to close yet");
  env.store.setUser("B03");
  let html = await env.render(`p=orders&sel=${FG_PI}`);
  clean(html);
  assert.match(html, /<strong>รับเข้าคลังครบตามที่ PK ทำแล้ว แต่ยังน้อยกว่าที่สั่ง<\/strong><div class="small muted">ถ้าแผนก PK จะไม่ทำต่อ ฝ่ายวางแผนกด “ปิดงานนี้” ที่งานนั้น แล้วคลังสินค้า \(WH\) ปิดใบ \(รับไม่ครบ\)<\/div>/);
  assert.doesNotMatch(html, /รอคลังสินค้า \(WH\) ปิดใบ \(รับไม่ครบ\)/, "not told twice");
  // งาน PK เสร็จทั้งหมด: ปิดรับไม่ครบได้
  for (const job of env.store.data().jobs.filter((entry) => entry.orderId === FG_PI && entry.dept === "PK")) job.status = "done";
  assert.deepEqual([pos().canCloseShort, pos().waitingShort], [true, false]);
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.match(html, /<strong>PK ทำครบและรับเข้าคลังแล้ว รอคลังสินค้า \(WH\) ปิดใบ \(รับไม่ครบ\)<\/strong>/, "step 4 says what the warehouse does next");
  assert.doesNotMatch(html, /data-rf-open="closeShort"/, "the planner has no close button");
  assert.doesNotMatch(await env.render("p=work"), /ปิดใบ \(รับไม่ครบ\)/, "and no warehouse card");
  assert.equal(hub.fgTasks(env.ctx("p=work")).length, 0, "fgTasks is empty for a role that is not the warehouse");
  env.store.setUser("B04");
  assert.equal(closeCards().length, 0, "nor does RB");
  env.store.setUser("B09");
  assert.equal(closeCards().length, 1);
  const card = closeCards()[0];
  assert.equal(card.order.id, FG_PI);
  assert.deepEqual(json(card.lines), [{ fgCode: FG_TP, qty: 10 }]);
  html = await env.render("p=work");
  clean(html);
  assert.match(html, new RegExp(`<span class="bom-job-state">รอปิดใบ</span>[\\s\\S]*?<h2>ใบ ${FG_PI}</h2>`), "the short-close card is a close card for the order");
  assert.match(html, /<button class="btn rf-btn bom-job-main" type="button" data-rf-open="closeShort"[^>]*>ปิดใบ \(รับไม่ครบ\)<\/button>/, "the card opens the existing dialog");
  assert.match(html, />ต้องทำ 1</, "the tab counts it");
  assert.equal(hub.workCount(env.ctx("p=work")), 1, "and so does the menu number");
  assert.ok(env.context.MNP_BOM_DIALOGS.closeShort(env.ctx("p=work"), { orderId: FG_PI }), "the dialog opens from the card");
  // ปิดใบแล้วการ์ดหาย
  await env.submit(`p=orders&sel=${FG_PI}`, "closeOrderShort", { note: "PK ผลิตได้ไม่ครบ" }, { orderId: FG_PI });
  assert.equal(closeCards().length, 0, "closed: the card is gone");
});

test("two released orders share one short part: the store gets ONE purchase card for the material with the combined shortage, never the sum of the orders' shortages (U2)", () => {
  const env = load();
  const hub = env.context.MNP_BOM_PAGES.hub;
  const stUser = env.store.data().users.find((user) => user.role === "st");
  const part = (id, orderId, itemCode, qty) => ({ id, orderId, dept: "ST", kind: "PURCHASED", itemCode, name: `ของ ${itemCode}`, uom: "yd", qtyPlanned: qty, qtyRequired: qty, qtyDone: 0, status: "queued", dueAt: Date.now() });
  const order = (id) => ({ id, customer: "ลูกค้า", status: "released", items: [], orderedAt: Date.now(), whDue: Date.now() });
  const data = {
    ...env.store.data(), orders: [order("PI-A"), order("PI-B"), order("PI-C")], stock: [], fgMoves: [],
    jobs: [part("J1", "PI-A", "P-SH-1", 63.28), part("J2", "PI-B", "P-SH-1", 11.8), part("J3", "PI-C", "P-SH-2", 4)],
  };
  const ctx = { ...env.ctx("p=work"), data, user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => permission === "purchase" }) };
  const buys = hub.storeTasks(ctx).filter((task) => task.kind === "buy");
  assert.deepEqual(json(buys.map((task) => task.itemCode)), ["P-SH-1", "P-SH-2"], "one card per material, not per order");
  const shared = buys[0];
  assert.equal(shared.total, 75.08, "63.28 + 11.8 once: both orders see each other's need as reserved, so each reports 75.08");
  assert.deepEqual(json(shared.orders.map((row) => [row.orderId, row.need, row.short])), [["PI-A", 63.28, 75.08], ["PI-B", 11.8, 75.08]]);
  assert.equal(buys[1].total, 4);
  const html = env.context.MNP_BOM_PAGES.work(ctx).html;
  clean(html);
  assert.equal(count(html, /<h2>สั่งซื้อ ของ P-SH-1<\/h2>/g), 1);
  assert.match(html, /ขาดรวม 75\.08 หลา/);
  assert.match(html, /PI-A<\/a><\/span><span class="nowrap">ต้องใช้ 63\.28 หลา/);
  assert.match(html, /PI-B<\/a><\/span><span class="nowrap">ต้องใช้ 11\.80 หลา/);
  // ใบนี้ขาด ต่างจาก รวมทุกใบขาด: ใบ B ใบเดียวขาดแค่ที่ตัวเองต้องใช้
  const rows = env.context.MNP_BOM_RULES.partNeeds({ jobs: data.jobs, orders: data.orders, stock: [], purchaseOrders: [] }, "PI-B").rows;
  assert.deepEqual(json(rows.map((row) => [row.itemCode, row.ownShort, row.shortage])), [["P-SH-1", 11.8, 75.08]]);
});

test("a new order is the first row of the list even on the same order date as the others (U10)", async () => {
  const env = load();
  env.store.setUser("B03");
  const orders = env.store.data().orders;
  const sameDay = Math.max(...orders.map((order) => order.orderedAt));
  assert.equal(env.store.run("createOrder", { pi: "AAA-NEW-1", customer: "ลูกค้าใหม่", country: "Thailand", orderedAt: sameDay, whDue: sameDay + 30 * 864e5 }).ok, true);
  const ids = [...(await env.render("p=orders")).matchAll(/<tr[^>]*><td><a class="rf-mono" href="[^"]*sel=([^"&]+)[^"]*">/g)].map((match) => match[1]);
  assert.equal(ids[0], "AAA-NEW-1", "the id sorts last alphabetically, yet the order opened last is on top");
  const sameDayIds = ids.filter((id) => orders.find((order) => order.id === id)?.orderedAt === sameDay && id !== "AAA-NEW-1");
  assert.deepEqual(sameDayIds, [...sameDayIds].sort().reverse(), "orders without an opening time on the same date follow the id, newest number first");
  assert.ok(ids.indexOf("AAA-NEW-1") < ids.indexOf(orders.find((order) => order.orderedAt < sameDay).id), "and older dates stay below");
});

test("a reload while typing in a BOM form warns once; saved, closed or untouched forms never do (U11)", () => {
  const env = load();
  assert.equal(env.log.listeners.beforeunload?.length, 1, "one beforeunload handler");
  vm.runInContext(fs.readFileSync("modules/module-bom.js", "utf8"), env.context, { filename: "modules/module-bom.js" });
  assert.equal(env.log.listeners.beforeunload.length, 1, "loading the module again does not register a second one");
  const control = (extra = {}) => ({ name: "customer", type: "text", tagName: "INPUT", value: "", defaultValue: "", disabled: false, closest: () => null, ...extra });
  const select = (selected, marked = true) => ({ name: "country", tagName: "SELECT", disabled: false, closest: () => null, options: [{ selected: !selected, defaultSelected: marked }, { selected, defaultSelected: false }] });
  const show = (...controls) => { env.context.document.querySelectorAll = () => controls; };
  const unsaved = () => env.context.MNP_BOM.hasUnsavedInput();
  show(control(), control({ name: "note", tagName: "TEXTAREA", type: "textarea" }), select(false), control({ type: "checkbox", checked: false, defaultChecked: false }));
  assert.equal(unsaved(), false, "nothing typed");
  show(control({ value: "ลูกค้าใหม่" }));
  assert.equal(unsaved(), true, "a typed value");
  show(control({ value: "10", defaultValue: "10" }));
  assert.equal(unsaved(), false, "a value the page itself filled in");
  show(select(true));
  assert.equal(unsaved(), true, "a changed select");
  show(select(false, false));
  assert.equal(unsaved(), false, "a select with no option marked selected shows its first option, which is not a change");
  show(select(true, false));
  assert.equal(unsaved(), true, "picking another option of such a select is a change");
  show(control({ type: "checkbox", checked: true, defaultChecked: false }));
  assert.equal(unsaved(), true, "a ticked box");
  show(control({ name: "q", value: "คำค้น", closest: (selector) => (selector.includes("data-rf-search") ? {} : null) }), control({ name: "user", closest: (selector) => (selector.includes("data-rf-user") ? {} : null), value: "B03", defaultValue: "B01" }));
  assert.equal(unsaved(), false, "the search box and the role chooser are not form input");
  show(control({ name: "", value: "x" }), control({ type: "hidden", value: "x" }), control({ value: "x", disabled: true }));
  assert.equal(unsaved(), false, "unnamed, hidden and disabled fields do not count");
  const fire = () => { const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; env.log.listeners.beforeunload[0](event); return event; };
  show(control({ value: "x" }));
  env.log.hash = "#/bom?p=orders";
  const warned = fire();
  assert.deepEqual([warned.prevented, warned.returnValue], [true, ""], "on a BOM page with typed input the browser is asked");
  env.log.hash = "#/requests";
  assert.equal(fire().prevented, false, "other pages are not this module's business");
  env.log.hash = "#/bom?p=orders";
  show();
  assert.equal(fire().prevented, false, "a page without form input (or after the form was saved and the page redrawn) does not warn");
});

test("close rules: everything received while RB and GR are open: step 5 names them, the planner closes each job with a reason, then WH gets a card and closes the order", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 80, [FG_HL]: 40 });
  const jobOf = (dept) => env.store.data().jobs.find((job) => job.orderId === FG_PI && job.dept === dept);
  const orderOf = () => env.store.data().orders.find((order) => order.id === FG_PI);
  const rbId = jobOf("RB").id;
  const grId = jobOf("GR").id;
  jobOf("RB").status = "in_progress";
  jobOf("GR").status = "queued";
  fgRun(env, "receiveFg", [[FG_TP, 80], [FG_HL, 40]]);
  assert.equal(orderOf().status, "in_progress", "received in full but RB and GR are open");
  let html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /ยังปิดใบไม่ได้: งานของแผนก รีดเส้นยาง \(RB\), ตัด\/เจาะชิ้นยาง \(GR\) ยังไม่เสร็จ · แผนกนั้นรายงานผลให้เสร็จ หรือฝ่ายวางแผนปิดงานที่จะไม่ทำต่อ แล้วคลังสินค้า \(WH\) ปิดใบ/);
  assert.doesNotMatch(html, /data-rf-action="closeOrder"|data-rf-open="closeShort"/, "nothing to close yet");
  assert.doesNotMatch(html, /ยังไม่มีสินค้าที่รอรับ|ดูงานที่ยังเปิด/, "no hint about PK, and WH gets no link to the planner's work");
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.match(html, /<strong>รับสินค้าเข้าคลังครบแล้ว<\/strong><div class="small muted">ใบปิดได้เมื่อทุกแผนกปิดงาน<\/div>/, "step 4 says it once, the departments are in its table");
  assert.doesNotMatch(await env.render("p=work"), /รอปิดใบ/, "no close card for WH yet");
  // ฝ่ายวางแผน: ลิงก์ไปงานของใบ · ปุ่มปิดงานที่การ์ดงานและตารางงานของแผนก · dialog ต้องมีเหตุผล
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.match(html, /<a [^>]*href="[^"]*p=work&amp;order=DEMO-26001"[^>]*>ดูงานที่ยังเปิด<\/a>/);
  html = await env.render(`p=work&dept=RB&order=${FG_PI}`);
  assert.match(html, new RegExp(`data-rf-open="jobClose" data-rf-args="\\{&quot;jobId&quot;:&quot;${rbId}&quot;\\}"[^>]*>ปิดงานนี้</button>`));
  html = await env.render("p=jobs&dept=GR");
  assert.match(html, new RegExp(`data-rf-open="jobClose" data-rf-args="\\{&quot;jobId&quot;:&quot;${grId}&quot;\\}"[^>]*>ปิดงานนี้</button>`));
  const D = env.context.MNP_BOM_DIALOGS;
  const built = D.jobClose(env.ctx("p=work"), { jobId: rbId });
  clean(built.html);
  assert.match(built.html, new RegExp(`data-rf-form="setJobStatus" data-rf-args="\\{&quot;jobId&quot;:&quot;${rbId}&quot;,&quot;status&quot;:&quot;done&quot;\\}"`));
  assert.match(built.html, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(built.html, /name="reason"[^>]*required[^>]*minlength="3" maxlength="200"/);
  const part = env.store.data().jobs.find((job) => job.orderId === FG_PI && job.dept === "ST");
  assert.equal(D.jobClose(env.ctx("p=work"), { jobId: part.id }), null, "no close for a purchased-part line (ST issues it)");
  // แผนกของงานเองและคลังสินค้าไม่มีปุ่มและ dialog
  for (const id of ["B04", "B09"]) {
    env.store.setUser(id);
    assert.doesNotMatch(await env.render("p=work"), /ปิดงานนี้/, id);
    assert.equal(D.jobClose(env.ctx("p=work"), { jobId: rbId }), null, id);
  }
  env.store.setUser("B03");
  await env.submit("p=work&dept=RB", "setJobStatus", { reason: "ab" }, { jobId: rbId, status: "done" });
  assert.match(env.log.toasts.at(-1)[0], /อย่างน้อย 3/);
  await env.submit("p=work&dept=RB", "setJobStatus", { reason: XSS }, { jobId: rbId, status: "done" });
  assert.equal(jobOf("RB").status, "done");
  html = await env.render("p=jobs&dept=RB&st=done");
  clean(html);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, "the typed reason is escaped");
  assert.match(html, /ปิดงานโดย ณัฐพล บุญมา: &lt;script&gt;alert\(1\)&lt;\/script&gt;/, "the closed job says who closed it and why");
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.match(html, /ยังปิดใบไม่ได้: งานของแผนก ตัด\/เจาะชิ้นยาง \(GR\) ยังไม่เสร็จ/, "only GR is left");
  await env.submit("p=jobs&dept=GR", "setJobStatus", { reason: "ใช้ชิ้นยางค้างไลน์แทน" }, { jobId: grId, status: "done" });
  // ทุกงานผลิตเสร็จ (เหลือแค่เบิกของซื้อ): ผู้อื่นเห็นว่ารอ WH · WH ได้การ์ดและปุ่มปิดใบ
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.match(html, /ทุกแผนกปิดงานแล้ว รอคลังสินค้า \(WH\) ปิดใบ/);
  assert.doesNotMatch(html, /data-rf-action="closeOrder"|ยังปิดใบไม่ได้/);
  env.store.setUser("B09");
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.match(html, /<strong>ทุกแผนกปิดงานและรับสินค้าครบแล้ว รอคลังสินค้า \(WH\) ปิดใบ<\/strong><\/div><a [^>]*href="[^"]*step=5"/, "step 4 (purchased lines still open) points to step 5");
  html = await env.render("p=work");
  clean(html);
  assert.match(html, /<span class="bom-job-state">รอปิดใบ<\/span>/);
  assert.match(html, /<h2>ใบ DEMO-26001<\/h2>/);
  assert.match(html, /href="[^"]*sel=DEMO-26001&amp;step=5"[^>]*>ไปปิดใบ<\/a>/);
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /<button class="btn rf-btn " type="button" data-rf-action="closeOrder" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26001&quot;\}" data-rf-confirm="ปิดใบ DEMO-26001\? [^"]*" data-rf-success="ปิดใบ \{result\} แล้ว">ปิดใบ<\/button>/);
  assert.doesNotMatch(html, /data-rf-open="closeShort"/, "nothing is short");
  // ปุ่มปิดใบ: ยืนยันครั้งเดียวแล้วส่งทันที
  const button = { ...env.root, dataset: { rfAction: "closeOrder", rfArgs: JSON.stringify({ orderId: FG_PI }), rfConfirm: `ปิดใบ ${FG_PI}? ทุกแผนกปิดงานแล้ว`, rfSuccess: "ปิดใบ {result} แล้ว" }, textContent: "ปิดใบ", getAttribute: () => null, handlers: {} };
  button.addEventListener = (type, handler) => { button.handlers[type] = handler; };
  env.fakes["[data-rf-action]"] = [button];
  await env.render(`p=orders&sel=${FG_PI}&step=5`);
  env.log.confirmAnswer = false;
  await button.handlers.click();
  assert.equal(orderOf().status, "in_progress", "declined: nothing is sent");
  env.log.confirmAnswer = true;
  await button.handlers.click();
  env.fakes["[data-rf-action]"] = [];
  assert.equal(orderOf().status, "completed");
  assert.equal(env.log.toasts.at(-1)[0], "ปิดใบ DEMO-26001 แล้ว");
  assert.doesNotMatch(await env.render("p=work"), /รอปิดใบ/, "the card is gone");
  html = await env.render(`p=orders&sel=${FG_PI}&step=6`);
  clean(html);
  assert.match(html, /<td>ปิดใบ \(รับครบ\)<\/td>/, "the history names the full close, without repeating the server note");
  assert.doesNotMatch(html, /รับครบ ปิดใบโดยคลังสินค้า|ปิดใบ \(รับไม่ครบ\)|ปิดใบโดยรับไม่ครบ/);
});

test("my jobs for the warehouse: a card to receive per PI with something waiting, a card to deliver per closed PI with stock left, linked to the right step", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  let html = await env.render("p=work");
  clean(html);
  assert.doesNotMatch(html, /ตามใบ/, "nothing yet");
  assert.match(html, /ไม่มีงานค้าง/);
  pkReport(env, { [FG_TP]: 30 });
  html = await env.render("p=work");
  clean(html);
  assert.equal(count(html, /<article class="card rf-card bom-job/g), 1);
  assert.match(html, /<h2>รับสินค้าเข้าคลังตามใบ DEMO-26001<\/h2>/);
  assert.match(html, /href="[^"]*sel=DEMO-26001&amp;step=5"[^>]*>เปิดใบเพื่อรับเข้าคลัง<\/a>/);
  assert.match(html, /<span class="rf-mono">DEMO-TP-01\(P\)-Y<\/span><span class="nowrap">30<\/span>/);
  assert.match(html, />ต้องทำ 1</);
  assert.match(env.module.nav[0].subnav("bom"), /rf-nav-count"[^>]*>1</, "the menu badge counts the card");
  // the others do not get it: planning group and ST (admin may act, so admin sees it)
  for (const [id, shown] of [["B03", false], ["B08", false], ["B04", false], ["B01", true]]) {
    env.store.setUser(id);
    assert.equal(/รับสินค้าเข้าคลังตามใบ/.test(await env.render("p=work")), shown, `${id}`);
  }
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 50, [FG_HL]: 40 });
  fgRun(env, "receiveFg", [[FG_TP, 80], [FG_HL, 40]]);
  html = await env.render("p=work");
  assert.doesNotMatch(html, /รับสินค้าเข้าคลังตามใบ/, "received in full");
  assert.match(html, /<h2>ส่งมอบให้ลูกค้าตามใบ DEMO-26001<\/h2>/);
  assert.match(html, /href="[^"]*sel=DEMO-26001&amp;step=6"[^>]*>เปิดใบเพื่อส่งมอบ<\/a>/);
  fgRun(env, "deliverFg", [[FG_TP, 80], [FG_HL, 40]]);
  assert.doesNotMatch(await env.render("p=work"), /ตามใบ DEMO-26001/);
});

test("the My-work menu number is the open tab's card count for every role: admin, planner, both kinds of manager, the warehouse and each department", async () => {
  const env = whLoad();
  pkReport(env, { [FG_TP]: 30 }, "B01"); // a card to receive for the warehouse
  const tab = (html) => Number(/>ต้องทำ (\d+)</.exec(html)?.[1] ?? 0);
  const badge = (sub) => Number(/rf-nav-count"[^>]*>(\d+)</.exec(sub)?.[1] ?? 0);
  const seen = {};
  for (const user of env.store.data().users) {
    env.store.setUser(user.id);
    const html = await env.render("p=work");
    clean(html);
    seen[user.id] = tab(html);
    assert.equal(badge(env.module.nav[0].subnav("bom")), tab(html), `${user.id} (${user.role} ${user.dept}): the menu number equals the cards on the page`);
  }
  assert.ok(seen.B01 > 0 && seen.B02 > 0 && seen.B03 > 0, "admin, manager and planner see every department's cards");
  assert.equal(seen.B09, 1, "WH staff: the one card to receive");
  assert.equal(seen.B10, seen.B02 + 1, "a manager of WH: the same cards as another manager plus the warehouse's own");
  assert.equal(seen.B01, seen.B10, "and admin, who may act for the warehouse too");
  // the shared board is the page's own: default parameters, no second count
  const hub = env.context.MNP_BOM_PAGES.hub;
  env.store.setUser("B10");
  const board = hub.workBoard(env.ctx("p=work"), new URLSearchParams());
  assert.equal(hub.workCount(env.ctx("p=work")), board.cardCount(board.open) + board.tasks.length);
});

test("while RubberFlow is still loading, My jobs says so instead of showing nothing, hooks one reload (not one per redraw) and redraws BOM once, only if it is still the page on screen", async () => {
  const env = load();
  env.store.setUser("B08");
  const stUser = env.store.data().users.find((user) => user.role === "st");
  let status = "loading";
  let hooks = 0;
  let release = () => {};
  const fakeStore = { isRemote: () => true, status: () => status, ensureLoaded: () => { hooks += 1; return new Promise((resolve) => { release = resolve; }); }, data: () => env.rf.store.data() };
  const rights = ["purchase", "receiveMaterial"];
  const stCtx = () => ({ ...env.ctx("p=work"), user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, store: fakeStore, can: (permission) => rights.includes(permission) }) });
  const work = () => env.context.MNP_BOM_PAGES.work(stCtx()).html;
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  let html = work();
  clean(html);
  assert.match(html, /<p class="small muted" role="status">กำลังโหลดข้อมูลเคมี…<\/p>/);
  assert.doesNotMatch(html, /ไม่มีงานค้าง/, "a page with no card yet does not claim there is no work");
  work();
  env.context.MNP_BOM_PAGES.hub.storeTasks(stCtx());
  assert.equal(hooks, 1, "one reload hook however many times the page, the tasks and the menu read RubberFlow");
  // the user left BOM meanwhile: RubberFlow finishing must not redraw this page
  env.log.hash = "#/rubberflow?p=warehouse";
  const renders = env.log.renders;
  status = "ready";
  release();
  await settle();
  assert.equal(env.log.renders, renders, "not on #/bom: no redraw");
  html = work();
  assert.doesNotMatch(html, /กำลังโหลดข้อมูลเคมี/, "ready: no loading line, no noise");
  assert.equal(hooks, 1, "ready needs no hook");
  // idle (never started) hooks too, and a redraw follows when still on #/bom
  status = "idle";
  env.log.hash = "#/bom?p=work";
  work();
  work();
  assert.equal(hooks, 2, "a new loading round hooks once");
  status = "ready";
  release();
  await settle();
  assert.equal(env.log.renders, renders + 1, "one redraw when it is ready");
  // a form or dialog left open on the BOM page: RubberFlow finishing does not redraw over what the user typed
  status = "idle";
  const savedBom = env.context.MNP_BOM;
  env.context.MNP_BOM = { ...(savedBom ?? {}), isEditing: () => true };
  work();
  assert.equal(hooks, 3);
  status = "ready";
  release();
  await settle();
  assert.equal(env.log.renders, renders + 1, "editing: no redraw");
  env.context.MNP_BOM = savedBom;
  // an account without the store's rights is told nothing about chemicals
  status = "loading";
  rights.length = 0;
  assert.doesNotMatch(work(), /กำลังโหลดข้อมูลเคมี/);
  status = "ready";
  release();
  await settle();
});

test("moving a line refuses a structure deeper than 12 levels with that reason, and the cycle check does not stop at depth 12", async () => {
  const env = load();
  env.store.setUser("B03");
  const code = (n) => `W-DEEP-${String(n).padStart(2, "0")}`;
  for (let n = 0; n <= 15; n += 1) assert.equal(env.store.run("saveItem", { code: code(n), kind: "SUBPART", name: `ชั้นลึก ${n}`, uom: "pcs", ownerDept: "PK" }).ok, true);
  const bom = (itemCode, ...children) => assert.equal(env.store.run("saveBom", { itemCode, lines: children.map((childCode) => ({ childCode, qty: 1 })) }).ok, true, itemCode);
  for (let n = 0; n < 14; n += 1) bom(code(n), code(n + 1), ...(n === 0 ? ["P-STK-01"] : []));
  bom(code(14), "P-BOX-01", "P-ZIP-05", code(15));
  bom(code(15), "P-ROPE-01");
  const query = `p=find&code=${code(0)}`;
  const move = async (args, values) => { env.log.toasts.length = 0; await env.submit(query, "saveBomTree", values, { lineMove: true, code: code(0), ...args }); return env.log.toasts.at(-1) ?? ["", ""]; };
  // the pieces sit 14 levels down: the old message said they were not in the structure at all
  assert.match((await move({ fromCode: code(14), childCode: "P-BOX-01" }, { toCode: code(15) }))[0], /โครงสร้างลึกเกิน 12 ชั้น/);
  assert.equal(env.store.data().boms.find((entry) => entry.itemCode === code(15) && entry.status === "approved").lines.length, 1, "nothing was saved");
  // a move into the child's own tree is a cycle however deep that tree is (it used to pass the check silently past depth 12)
  assert.match((await move({ fromCode: code(0), childCode: code(1) }, { toCode: code(14) }))[0], /วงจร/);
  assert.equal(env.store.data().boms.find((entry) => entry.itemCode === code(0) && entry.status === "approved").lines.length, 2, "nothing was saved");
  // the same kind of move in a shallow structure still works
  assert.notEqual((await move({ fromCode: code(0), childCode: "P-STK-01" }, { toCode: code(1) }))[1], "error", "no error toast: the shallow move saves");
  assert.ok(env.store.data().boms.find((entry) => entry.itemCode === code(1) && entry.status === "approved").lines.some((line) => line.childCode === "P-STK-01"));
});

test("component pickers do not offer finished goods: the builder's code list and the add-component dialog", async () => {
  const env = load();
  env.store.setUser("B03");
  const finished = env.store.data().items.filter((item) => item.kind === "FG").map((item) => item.code);
  assert.ok(finished.length >= 2);
  const html = await env.render("p=build&code=DEMO-TP-01(P)-Y");
  const list = /<datalist id="bom-item-list">([\s\S]*?)<\/datalist>/.exec(html)?.[1] ?? "";
  assert.ok(list.includes("P-BOX-01") && list.includes("SE-TP01-OR01-100-18-65"), "parts and pieces are offered");
  for (const fg of finished) assert.ok(!list.includes(`value="${fg}"`), `${fg} is not offered as a component`);
  // add-component dialog: bind with a fake picker and type what finished goods have in common
  const built = env.context.MNP_BOM_DIALOGS.lineAdd(env.ctx(), { parentCode: "DEMO-TP-01(P)-Y" });
  const handlers = {};
  const popup = { id: "bom-add-code-list", hidden: true, innerHTML: "", addEventListener() {}, querySelectorAll: () => [] };
  const input = { value: "", setAttribute() {}, removeAttribute() {}, addEventListener(type, handler) { handlers[type] = handler; } };
  const box = { querySelector: (selector) => (selector === "[data-pick-input]" ? input : selector === "[data-popup]" ? popup : null) };
  built.bind({ querySelector: (selector) => (selector === "[data-add-code]" ? { value: "", closest: () => box, addEventListener() {} } : selector === "[data-add-new]" ? { hidden: true } : null) });
  input.value = "demo";
  handlers.input();
  assert.match(popup.innerHTML, /ไม่พบในทะเบียน/, "every code starting with DEMO is a finished good: none is offered");
  input.value = "p-zip";
  handlers.input();
  assert.match(popup.innerHTML, /data-pick-value="P-ZIP-05"/);
});

// ---------- สต็อกสินค้าสำเร็จรูป (batch C): ขั้น 2 ตั้งยอดที่ใช้จากสต็อก · ขั้น 5/6 ส่วนเกินและของจากสต็อก · ใบที่ได้ครบจากสต็อก · ยกเลิก/เปิดใบคืนสต็อก ----------
const FG_DRAFT = "DEMO-26002"; // HL 192 (ร่างที่ระเบิด BOM แล้ว)
// PK รายงาน HL 60 (สั่ง 40) แล้ว WH รับเข้าครบ 60 → ส่วนเกิน 20 เป็นสต็อกสินค้าสำเร็จรูปของ HL · จบด้วยผู้ใช้ B09 (คลังสินค้า)
const surplusEnv = () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_HL]: 60 });
  fgRun(env, "receiveFg", [[FG_HL, 60]]);
  return env;
};
const stepOneNewDraft = (env, id, qty) => {
  env.store.setUser("B03");
  const now = Date.now();
  assert.equal(env.store.run("createOrder", { pi: id, customer: "ลูกค้าสต็อก", country: "Thailand", orderedAt: now, whDue: now + 10 * 86400000 }).ok, true);
  assert.equal(env.store.run("addOrderItem", { orderId: id, fgCode: FG_HL, qty }).ok, true);
  assert.equal(env.store.run("explodeOrder", { orderId: id }).ok, true);
};

test("draft step 2: a row per product with stock, the planner's input offers the maximum and saves only when saved, everyone else reads the saved number", async () => {
  const env = surplusEnv();
  env.store.setUser("B03");
  let html = await env.render(`p=orders&sel=${FG_DRAFT}`);
  clean(html);
  assert.match(html, /<h3 class="bom-h3">สต็อกสินค้าสำเร็จรูป<\/h3>/);
  assert.match(html, /<h2>ขั้น 2 · ตรวจของ<\/h2>/);
  assert.match(html, /data-rf-form="setStockCounts" data-rf-args="\{&quot;orderId&quot;:&quot;DEMO-26002&quot;\}"/);
  assert.match(html, /<input type="hidden" name="itemCode\[\]" value="DEMO-HL-24\(B\)-A">/);
  assert.match(html, /name="qty\[\]" type="number" inputmode="decimal" step="any" min="0" max="20" value="20"/, "the offered value is the maximum: min(192 ordered, 20 in stock)");
  assert.match(html, /<td class="right rf-mono">20<\/td>/, "the stock available to this draft");
  assert.equal(env.store.data().orders.find((order) => order.id === FG_DRAFT).stockCounts[FG_HL], undefined, "offered, not saved");
  // saving writes the amount; everyone else sees it read-only with no form
  await env.submit(`p=orders&sel=${FG_DRAFT}`, "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["15"] }, { orderId: FG_DRAFT });
  assert.equal(env.log.toasts.at(-1)[0], "ok 1 รายการ");
  assert.equal(env.store.data().orders.find((order) => order.id === FG_DRAFT).stockCounts[FG_HL], 15);
  html = await env.render(`p=orders&sel=${FG_DRAFT}`);
  assert.match(html, /name="qty\[\]"[^>]*value="15"/, "the saved value replaces the offer");
  for (const id of ["B08", "B09", "B04"]) {
    env.store.setUser(id);
    html = await env.render(`p=orders&sel=${FG_DRAFT}`);
    clean(html);
    assert.match(html, /<h3 class="bom-h3">สต็อกสินค้าสำเร็จรูป<\/h3>/, `${id} sees the row`);
    assert.doesNotMatch(html, /data-rf-form="setStockCounts"|name="itemCode\[\]"/, `${id} has no input`);
    assert.match(html, /<td class="right">15 <span class="small muted">[^<]*<\/span><\/td>/, `${id} reads the saved amount`);
  }
  // ST / WH are refused by the action as well (a hand-made form)
  env.store.setUser("B08");
  await env.submit(`p=orders&sel=${FG_DRAFT}`, "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["10"] }, { orderId: FG_DRAFT });
  assert.match(env.log.toasts.at(-1)[0], /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  assert.equal(env.store.data().orders.find((order) => order.id === FG_DRAFT).stockCounts[FG_HL], 15);
  // the raw-material table shows the reduced requirement only: the number in the calculation tab follows the amount (192 ordered, 15 taken, 177 to make)
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_DRAFT}`);
  assert.match(html, /<tr class="bom-fg-row">[\s\S]*?<td class="right rf-mono">192<\/td><td>[^<]*<\/td><td class="right rf-mono">15<\/td><td class="right rf-mono">177<\/td>/, "the product row: ordered 192, from stock 15, to make 177");
  // a draft that is not calculated, or a product with no stock at all, has no row
  stepOneNewDraft(env, "N-NOSTOCK", 5);
  env.store.data().fgMoves.length = 0;
  html = await env.render("p=orders&sel=N-NOSTOCK");
  assert.doesNotMatch(html, /<h3 class="bom-h3">สต็อกสินค้าสำเร็จรูป<\/h3>/, "no stock of the product: no row, each fact once");
});

test("draft step 2: two drafts see the stock once — the later one is offered what the earlier one leaves; step 3 says what will be taken and blocks a release the stock cannot cover", async () => {
  const env = surplusEnv();
  env.store.setUser("B03");
  await env.submit(`p=orders&sel=${FG_DRAFT}`, "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["15"] }, { orderId: FG_DRAFT });
  stepOneNewDraft(env, "N-LATE", 30);
  let html = await env.render("p=orders&sel=N-LATE");
  clean(html);
  assert.match(html, /name="qty\[\]"[^>]*max="5" value="5"/, "20 − 15 planned by the draft calculated before");
  assert.match(html, /ใบร่างที่คำนวณก่อนตั้งใช้ไว้ 15/, "and says why");
  // step 3 of the earlier draft: what will be taken, with the release button
  html = await env.render(`p=orders&sel=${FG_DRAFT}&step=3`);
  clean(html);
  assert.match(html, /ใช้สต็อกสินค้าสำเร็จรูป <span class="rf-mono">DEMO-HL-24\(B\)-A<\/span> × 15 หักจากสต็อกเมื่อปล่อยผลิต/);
  assert.match(html, /ระบบจะหักสต็อกสินค้าสำเร็จรูป DEMO-HL-24\(B\)-A × 15/, "the confirmation says it too");
  assert.match(html, />ปล่อยผลิต<\/button>/);
  // the stock shrinks under it (WH delivers 50 of the 60 pieces of the source order): the release is blocked on the page with the reason
  env.store.setUser("B09");
  fgRun(env, "deliverFg", [[FG_HL, 50]]);
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_DRAFT}&step=3`);
  assert.match(html, /ปล่อยผลิตไม่ได้ สต็อกสินค้าสำเร็จรูปไม่พอที่ตั้งใช้: DEMO-HL-24\(B\)-A เหลือ 10 ตั้งใช้ 15/);
  assert.doesNotMatch(html, />ปล่อยผลิต<\/button>/, "no release button");
  assert.match(html, /กลับไปตั้งยอดใหม่ที่ขั้น 2/);
});

test("steps 5 and 6 with stock: what came from stock is its own column only when non-zero, the history names the other order, and the stock page shows free stock with the orders holding it", async () => {
  const env = surplusEnv();
  env.store.setUser("B03");
  await env.submit(`p=orders&sel=${FG_DRAFT}`, "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["20"] }, { orderId: FG_DRAFT });
  assert.equal(env.store.run("releaseOrder", { orderId: FG_DRAFT }).ok, true);
  env.store.setUser("B09");
  // the receiving order of DEMO-26001 has no column (nothing came from stock to it); the draft's order does
  let html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.doesNotMatch(html, /ได้จากสต็อก<\/th>|<th class="right"[^>]*>ได้จากสต็อก/);
  html = await env.render(`p=orders&sel=${FG_DRAFT}&step=5`);
  clean(html);
  assert.match(html, /<th class="right"[^>]*>ได้จากสต็อก<\/th>/);
  assert.match(html, /<td class="right rf-mono">192<\/td><td class="right rf-mono">0<\/td><td class="right rf-mono">0<\/td><td class="right rf-mono">20<\/td><td class="right rf-mono">0<\/td>/, "ordered 192, PK 0, received 0, from stock 20, waiting 0");
  // step 6 of the draft's order: it holds 20 for its own customer, the history names the source order
  html = await env.render(`p=orders&sel=${FG_DRAFT}&step=6`);
  clean(html);
  assert.match(html, /<h3 class="bom-h3">ประวัติรับเข้า ส่งมอบ และสต็อก<\/h3>/);
  assert.match(html, /ได้จากสต็อกของใบ <a class="rf-mono" href="[^"]*sel=DEMO-26001[^"]*">DEMO-26001<\/a>/);
  assert.match(html, /max="20" value="20"/, "the customer of the draft's order waits for the 20 it holds");
  // the source order: gave 20 away (its own column), may deliver its 40 and the 20 are not an extra to deliver
  html = await env.render(`p=orders&sel=${FG_PI}&step=6`);
  clean(html);
  assert.match(html, /<th class="right"[^>]*>ให้ใบอื่นแล้ว<\/th>/);
  assert.match(html, /ให้ใบ <a class="rf-mono" href="[^"]*sel=DEMO-26002[^"]*">DEMO-26002<\/a> ใช้จากสต็อก/, "the source's history names the order that took it");
  assert.match(html, /max="40" value="40"/, "60 held − 20 given away");
  // the stock page: in the warehouse 60 (both orders), free stock none (the source's 20 went to the draft)
  html = await env.render("p=stock");
  clean(html);
  assert.match(html, /DEMO-HL-24\(B\)-A[\s\S]*?<td class="right rf-mono">60 <span class="small muted">[^<]*<\/span><\/td><td class="right rf-mono"><span class="muted">—<\/span><\/td>/);
  assert.match(html, /DEMO-26002<\/a> <span class="small muted">× 20<\/span>/, "the order holding stock");
});

test("an order released entirely from stock has no jobs: its step bar skips production, it waits at delivery, and the warehouse gets a card to deliver", async () => {
  const env = surplusEnv();
  stepOneNewDraft(env, "N-FULL", 12);
  env.store.setUser("B03");
  await env.submit("p=orders&sel=N-FULL", "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["12"] }, { orderId: "N-FULL" });
  assert.match(await env.render("p=orders&sel=N-FULL&step=3"), /ได้ครบทุกสินค้า ไม่มีงานผลิต ปล่อยแล้วใบปิดทันทีและไปที่ขั้นส่งมอบลูกค้า/);
  assert.doesNotMatch(await env.render("p=orders&sel=N-FULL&step=3"), /ปล่อยผลิตแล้วระบบสร้างงานให้แต่ละแผนก/, "no list of jobs to create");
  assert.equal(env.store.run("releaseOrder", { orderId: "N-FULL" }).ok, true);
  const order = env.store.data().orders.find((entry) => entry.id === "N-FULL");
  assert.equal(order.status, "completed");
  assert.equal(env.store.data().jobs.filter((job) => job.orderId === "N-FULL").length, 0);
  env.store.setUser("B09");
  let html = await env.render("p=orders&sel=N-FULL");
  clean(html);
  assert.match(html, /<li class="bom-step is-now" aria-current="step"><div><span class="bom-step-no">ขั้น 6/, "waiting at delivery");
  assert.equal(count(html, /<span class="bom-step-no">ข้าม<\/span>/g), 2, "steps 4 and 5 are skipped");
  assert.match(html, /ใช้สต็อกสินค้าสำเร็จรูป<\/span>/);
  assert.match(html, /<span class="rf-badge is-info">รอส่งมอบ<\/span>/);
  assert.match(html, /max="12" value="12"/, "deliver the 12 it holds");
  assert.match(await env.render("p=orders"), /ใช้สต็อก ไม่มีงานผลิต/, "the list says there are no jobs because of the stock");
  html = await env.render("p=orders&sel=N-FULL&step=5");
  assert.match(html, /ใบนี้ได้สินค้าครบจากสต็อกสินค้าสำเร็จรูป ไม่มีงานผลิตและไม่มีของให้รับเข้าคลัง/);
  const work = await env.render("p=work");
  assert.match(work, /<h2>ส่งมอบให้ลูกค้าตามใบ N-FULL<\/h2>/);
  fgRunFor(env, "N-FULL", "deliverFg", [[FG_HL, 12]]);
  html = await env.render("p=orders&sel=N-FULL");
  assert.match(html, /<span class="rf-badge is-good">ส่งมอบแล้ว<\/span>/);
  assert.doesNotMatch(await env.render("p=work"), /ตามใบ N-FULL/);
  // the buttons of a closed order: nothing to cancel or edit
  env.store.setUser("B03");
  html = await env.render("p=orders&sel=N-FULL");
  assert.doesNotMatch(html, /data-rf-action="cancelOrder"|data-rf-open="orderItemEdit"/);
});
const fgRunFor = (env, orderId, action, lines) => { const result = env.store.run(action, { orderId, lines: lines.map(([fgCode, qty]) => ({ fgCode, qty })) }); assert.equal(result.ok, true, result.error?.message); return result; };

test("a closed order with surplus PK made: WH gets a receive card and the form, wording says surplus going to stock; the planning group only reads", async () => {
  const env = whLoad();
  env.store.setUser("B09");
  pkReport(env, { [FG_TP]: 80, [FG_HL]: 60 });
  fgRun(env, "receiveFg", [[FG_TP, 80], [FG_HL, 40]]);
  assert.equal(env.store.data().orders.find((order) => order.id === FG_PI).status, "completed");
  let html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  clean(html);
  assert.match(html, /ใบนี้ปิดแล้ว ส่วนที่ PK ผลิตเกินจำนวนสั่งรับเข้าคลังได้ และเป็นสต็อกสินค้าสำเร็จรูปที่ใบสั่งผลิตอื่นนำไปใช้ได้/);
  assert.match(html, /<th class="right"[^>]*>รอรับ \(ส่วนเกิน\)<\/th>/);
  assert.match(html, /<th class="right"[^>]*>รับเป็นสต็อก<\/th>/);
  assert.match(html, /max="20" value="20"/);
  assert.match(html, /data-rf-confirm="รับส่วนที่ PK ผลิตเกินเข้าคลังเป็นสต็อกสินค้าสำเร็จรูป[^"]*">รับส่วนเกินเข้าคลัง<\/button>/);
  const work = await env.render("p=work");
  clean(work);
  assert.match(work, /<span class="bom-job-state">รอรับส่วนเกินเข้าคลัง<\/span>/);
  assert.match(work, /<h2>รับส่วนเกินเข้าคลังตามใบ DEMO-26001<\/h2>/);
  assert.match(work, /href="[^"]*sel=DEMO-26001&amp;step=5"[^>]*>เปิดใบเพื่อรับเข้าคลัง<\/a>/);
  assert.match(work, /<span class="rf-mono">DEMO-HL-24\(B\)-A<\/span><span class="nowrap">20<\/span>/);
  // the planning group reads the same table with no form
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_PI}&step=5`);
  assert.doesNotMatch(html, /data-rf-form="receiveFg"|name="qty\[\]"/);
  assert.match(html, /คลังสินค้า \(WH\) เป็นผู้รับสินค้าเข้าคลัง/);
  // the receive through the form: the order stays closed and the 20 become stock
  env.store.setUser("B09");
  await env.submit(`p=orders&sel=${FG_PI}&step=5`, "receiveFg", { "fgCode[]": [FG_TP, FG_HL], "qty[]": ["", "20"] }, { orderId: FG_PI });
  assert.equal(env.log.toasts.at(-1)[0], "ok 1 รายการ");
  assert.equal(env.store.data().orders.find((order) => order.id === FG_PI).status, "completed");
  html = await env.render("p=stock");
  assert.match(html, /DEMO-HL-24\(B\)-A[\s\S]*?<td class="right rf-mono">60 <span class="small muted">[^<]*<\/span><\/td><td class="right rf-mono">20 <span class="small muted">[^<]*<\/span><\/td>/, "60 in the warehouse, 20 of them free stock");
  assert.match(html, /DEMO-26001<\/a> <span class="small muted">× 60 \(ว่าง 20\)<\/span>/, "the order holding it, with its free part");
  assert.doesNotMatch(await env.render("p=work"), /รับส่วนเกินเข้าคลัง/, "nothing left to receive");
  // step 6: the 40 the customer waits for are prefilled; the 20 are shown as beyond the order
  html = await env.render(`p=orders&sel=${FG_PI}&step=6`);
  assert.match(html, /เกินที่สั่ง 20/);
  assert.match(html, /max="60" value="40"/, "the surplus is not filled in for delivery");
  assert.match(html, /ส่วนที่เกินที่สั่งเป็นสต็อกสินค้าสำเร็จรูป ใบสั่งผลิตอื่นนำไปใช้ได้/);
});

test("cancel and reopen of an order that took stock: the confirmation says the stock goes back; after a delivery or giving stock away the buttons explain why they are gone", async () => {
  const env = surplusEnv();
  env.store.setUser("B03");
  await env.submit(`p=orders&sel=${FG_DRAFT}`, "setStockCounts", { "itemCode[]": [FG_HL], "qty[]": ["20"] }, { orderId: FG_DRAFT });
  assert.equal(env.store.run("releaseOrder", { orderId: FG_DRAFT }).ok, true);
  let html = await env.render(`p=orders&sel=${FG_DRAFT}`);
  clean(html);
  assert.match(html, /data-rf-open="orderCancel"/, "the cancel button opens the cancel dialog");
  assert.match(env.context.MNP_BOM_DIALOGS.orderCancel(env.ctx(`p=orders&sel=${FG_DRAFT}`), { orderId: FG_DRAFT }).html,
    /สินค้าสำเร็จรูปที่ใบนี้ใช้จากสต็อก \(DEMO-HL-24\(B\)-A × 20 จากใบ DEMO-26001\) จะคืนเข้าสต็อกให้อัตโนมัติ/, "and the dialog says the stock goes back");
  assert.match(html, /data-rf-open="orderItemEdit"/, "the item can be edited (reopens the order)");
  assert.match(html, /data-rf-confirm="ลบ DEMO-HL-24\(B\)-A ออกจากใบ DEMO-26002\?[^"]*จะคืนเข้าสต็อกให้อัตโนมัติ/, "and the removal says the stock goes back");
  assert.match(env.context.MNP_BOM_DIALOGS.orderItemEdit(env.ctx(`p=orders&sel=${FG_DRAFT}`), { orderId: FG_DRAFT, fgCode: FG_HL }).html, /จะคืนเข้าสต็อกให้อัตโนมัติ/, "the edit dialog warns too");
  // the source order gave 20 away: it can neither be cancelled nor reopened, and says so
  html = await env.render(`p=orders&sel=${FG_PI}`);
  assert.doesNotMatch(html, /data-rf-open="orderCancel"/);
  assert.equal(env.context.MNP_BOM_DIALOGS.orderCancel(env.ctx(`p=orders&sel=${FG_PI}`), { orderId: FG_PI }), null, "and no dialog opens for it");
  assert.match(html, /ยกเลิกใบหรือแก้รายการไม่ได้: ให้สินค้าจากสต็อกแก่ใบ DEMO-26002 ไปแล้ว/);
  // after a delivery to the draft's customer: no cancel, no edit, with the reason
  env.store.setUser("B09");
  fgRunFor(env, FG_DRAFT, "deliverFg", [[FG_HL, 5]]);
  env.store.setUser("B03");
  html = await env.render(`p=orders&sel=${FG_DRAFT}`);
  assert.doesNotMatch(html, /data-rf-open="orderCancel"|data-rf-open="orderItemEdit"/);
  assert.match(html, /ยกเลิกใบหรือแก้รายการไม่ได้: ส่งมอบสินค้าให้ลูกค้าแล้ว ให้ปิดงานที่เหลือพร้อมเหตุผล แล้วให้คลังสินค้า \(WH\) ปิดใบ \(รับไม่ครบ\) แทน/);
});

test("an inserted WIP item whose production steps could not be updated says so plainly: what was saved, what was not, and what to do", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const child = "PT-00320";
  const processes = env.context.MNP_BOM_ACTIONS.helpers.processesOf(env.store.data()).filter((entry) => entry.dept === "PK").slice(0, 2).map((entry) => entry.code);
  assert.equal(env.store.run("saveRouting", { itemCode: parent, steps: [{ processCode: processes[0], minutesPerPc: 1, inputs: [] }, { processCode: processes[1], minutesPerPc: 1, inputs: [child] }] }).ok, true);
  const real = env.context.MNP_BOM_ACTIONS.saveRouting;
  env.context.MNP_BOM_ACTIONS.saveRouting = () => { throw new Error("บันทึกขั้นตอนผลิตไม่สำเร็จ"); };
  await env.submit("p=find", "saveBomTree", { wipCode: "WIP-FAIL-1", wipName: "ชุดประกอบ", wipKind: "SUBPART", wipUom: "pcs", wipQty: "1", childQty: "" }, { wipInsert: true, code: parent, childCode: child });
  env.context.MNP_BOM_ACTIONS.saveRouting = real;
  assert.ok(env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.some((line) => line.childCode === "WIP-FAIL-1"), "the BOM has the WIP");
  const [message, kind] = env.log.toasts.at(-1);
  assert.equal(kind, "error");
  assert.match(message, /แทรก WIP WIP-FAIL-1 ใน BOM ของ DEMO-TP-01\(P\)-Y แล้ว/, "what was saved");
  assert.match(message, /แต่ยังไม่ได้ปรับขั้นตอนผลิตของ DEMO-TP-01\(P\)-Y ให้อ้าง WIP นี้แทน PT-00320/, "what was not");
  assert.match(message, /เปิดหน้าของ DEMO-TP-01\(P\)-Y แล้วแก้ขั้นตอนผลิตเอง/, "what to do");
  assert.match(message, /บันทึกขั้นตอนผลิตไม่สำเร็จ/, "and the cause");
});

test("cancel after production started (20261128010000): the dialog lists what happens to the WOs, chemicals, parts and goods and asks for a reason; the store gets the return cards", async () => {
  const env = load();
  env.store.setUser("B03");
  const dialogs = env.context.MNP_BOM_DIALOGS;
  const hub = env.context.MNP_BOM_PAGES.hub;
  const data = () => env.store.data();
  const rbOf = (pi) => data().jobs.find((job) => job.orderId === pi && job.dept === "RB");
  // ใบที่ WO เบิกเคมีแล้ว (ชุดสาธิต DEMO-26007): ปุ่มยกเลิกเปิดหน้าต่าง · หน้าต่างบอก WO ใบเบิก สิ่งที่ไม่ย้อน และให้กรอกเหตุผล (จำเป็น)
  let html = await env.render("p=orders&sel=DEMO-26007");
  clean(html);
  assert.match(html, /data-rf-open="orderCancel"/);
  const woId = rbOf("DEMO-26007").externalRef.woId;
  const reqId = env.rf.store.data().requisitions.find((req) => req.orderId === woId).id;
  const dialog = dialogs.orderCancel(env.ctx("p=orders&sel=DEMO-26007"), { orderId: "DEMO-26007" }).html;
  clean(dialog);
  assert.ok(dialog.includes(`WO ใน RubberFlow ที่จะถูกยกเลิกหรือหยุด: ${woId}`), "the work order to stop is named");
  assert.ok(dialog.includes(`เคมีที่เบิกไปแล้ว (${reqId}) คลังวัตถุดิบ (ST) จะได้งานรับคืนเข้าล็อตเดิม`), "the issued requisition is named");
  assert.ok(dialog.includes("งานทุกแผนกของใบนี้หยุดและรายงานต่อไม่ได้ · ล็อตที่ฉีด อบ และตกแต่งแล้ว ยังเก็บเป็นประวัติ ไม่ถูกลบ"), "what is not undone");
  assert.match(dialog, /เหตุผลที่ยกเลิก <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(dialog, /data-rf-form="cancelOrder"/);
  assert.match(dialog, /minlength="3" maxlength="200"/);
  env.store.setUser("B04");
  assert.equal(dialogs.orderCancel(env.ctx("p=orders&sel=DEMO-26007"), { orderId: "DEMO-26007" }), null, "only the planning group gets the dialog");
  env.store.setUser("B03");
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26007", reason: "ab" }).ok, false, "a short reason is refused");
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26007", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" }).ok, true);
  assert.equal(data().orders.find((order) => order.id === "DEMO-26007").cancelReason, "ลูกค้ายกเลิกคำสั่งซื้อ");
  assert.ok(data().jobs.some((job) => job.orderId === "DEMO-26007"), "the jobs stay");
  // งานของ ST: ใบเบิกของ WO ที่ถูกยกเลิกเป็นการ์ดรับคืน (ฐานข้อมูลยกเลิก WO ให้เอง ที่นี่ตั้งเองเพราะโหมดในเครื่องไม่แตะ RubberFlow)
  env.rf.store.data().orders.find((row) => row.id === woId).status = "cancelled";
  const stUser = data().users.find((user) => user.role === "st");
  const stCtx = (rights) => ({ ...env.ctx("p=work"), user: stUser, store: { ...env.store, isRemote: () => true }, rubberflow: () => ({ ...env.rf, can: (permission) => rights.includes(permission) }) });
  const tasks = hub.storeTasks(stCtx(["returnRequisition"]));
  assert.deepEqual(json(tasks.filter((task) => task.kind === "chemReturn").map((task) => task.req.id)), [reqId]);
  assert.deepEqual(json(hub.storeTasks(stCtx([])).filter((task) => task.kind === "chemReturn")), [], "only for an account that may take chemicals back");
  html = env.context.MNP_BOM_PAGES.work(stCtx(["returnRequisition"])).html;
  clean(html);
  assert.ok(html.includes("WO ถูกยกเลิก · รอ ST รับคืน"));
  assert.ok(html.includes(`<h2>รับเคมีคืนตามใบเบิก ${reqId}</h2>`));
  assert.ok(html.includes(`href="#/rubberflow?p=requisition&amp;sel=${reqId}">เปิดใบเบิกเพื่อรับคืน<`), "the card opens the requisition where the return dialog is");
  // ของซื้อที่เบิกแล้วของใบที่ยกเลิก (DEMO-26006): การ์ดคืนของซื้อของ ST ค้างจนคืนครบ · ปุ่มคืนของเหลืออยู่ในแผงของใบที่ยกเลิก
  env.store.setUser("B08");
  const stk = data().jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "ST");
  assert.equal(env.store.run("countPartStock", { counts: [{ itemCode: stk.itemCode, qty: stk.qtyPlanned + 100 }] }).ok, true);
  const issued = env.store.run("issueOrderParts", { orderId: "DEMO-26006", lines: [{ itemCode: stk.itemCode, qty: stk.qtyPlanned }] });
  assert.equal(issued.ok, true, issued.error?.message);
  env.store.setUser("B03");
  assert.equal(env.store.run("cancelOrder", { orderId: "DEMO-26006", reason: "ลูกค้าเลื่อนไม่มีกำหนด" }).ok, true);
  env.store.setUser("B08");
  html = await env.render("p=work");
  clean(html);
  assert.ok(html.includes("<h2>คืนของซื้อที่เบิกไปแล้ว DEMO-26006</h2>"));
  assert.match(html, /data-rf-open="returnParts"/);
  assert.ok(dialogs.returnParts(env.ctx("p=work"), { orderId: "DEMO-26006" })?.html, "the return dialog opens for a cancelled order");
  html = await env.render("p=orders&sel=DEMO-26006");
  assert.match(html, /ใบนี้ถูกยกเลิก: ลูกค้าเลื่อนไม่มีกำหนด[\s\S]*data-rf-open="returnParts"/, "the cancelled order shows the return button next to its reason");
  const back = env.store.run("returnOrderParts", { orderId: "DEMO-26006", lines: [{ itemCode: stk.itemCode, qty: stk.qtyPlanned }], reason: "ยกเลิกใบ" });
  assert.equal(back.ok, true, back.error?.message);
  assert.ok(!(await env.render("p=work")).includes("คืนของซื้อที่เบิกไปแล้ว DEMO-26006"), "the card goes once everything is back");
});

test("a job linked to a WO has no report button and says its output comes from RubberFlow; holding opens a reason dialog and a held job with output resumes as in progress", async () => {
  const env = load();
  const data = () => env.store.data();
  const linked = data().jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "RB");
  env.store.setUser("B04");
  let html = await env.render("p=jobs&dept=RB");
  clean(html);
  const row = html.split("<tr").find((entry) => entry.includes(linked.id));
  assert.ok(row, "the linked job is listed");
  assert.doesNotMatch(row, /data-rf-open="jobReport"/);
  assert.match(row, /ยอดมาจาก RubberFlow/);
  assert.match(row, /data-rf-open="jobHold"/);
  assert.equal(env.context.MNP_BOM_DIALOGS.jobReport(env.ctx(), { jobId: linked.id }), null, "no report dialog either");
  html = await env.render("p=work");
  const card = html.split("<article").find((entry) => entry.includes(linked.itemCode) && entry.includes("DEMO-26006"));
  assert.ok(card && !card.includes('data-rf-open="jobReport"') && card.includes("ยอดมาจาก RubberFlow"), "the work card has no report button either");
  // หน้าต่างพักงาน: เหตุผล (จำเป็น) 3–200
  const hold = env.context.MNP_BOM_DIALOGS.jobHold(env.ctx(), { jobId: linked.id }).html;
  assert.match(hold, /data-rf-form="setJobStatus"/);
  assert.match(hold, /เหตุผลที่พัก <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(hold, /minlength="3" maxlength="200"/);
  assert.equal(env.store.run("setJobStatus", { jobId: linked.id, status: "hold" }).ok, false, "a hold needs a reason");
  assert.equal(env.store.run("setJobStatus", { jobId: linked.id, status: "hold", reason: "รอแม่พิมพ์" }).ok, true);
  assert.equal(env.context.MNP_BOM_DIALOGS.jobHold(env.ctx(), { jobId: linked.id }), null, "a held job has no hold dialog");
  html = await env.render("p=jobs&dept=RB&st=all");
  const held = html.split("<tr").find((entry) => entry.includes(linked.id));
  assert.match(held, /พักโดย [^:]+: รอแม่พิมพ์/);
  assert.match(held, />คืนคิว</, "no output yet: back to the queue");
  // งาน GR ที่มียอดแล้ว พักแล้ว "ทำต่อ" กลับเป็นกำลังทำ
  env.store.setUser("B05");
  const gr = data().jobs.find((job) => job.orderId === "DEMO-26001" && job.itemCode === "SE-TP01-BK01-140-3-20");
  assert.equal(env.store.run("setJobStatus", { jobId: gr.id, status: "hold", reason: "รอกาว" }).ok, true);
  html = await env.render("p=jobs&dept=GR");
  const grRow = html.split("<tr").find((entry) => entry.includes(gr.id));
  assert.match(grRow, />ทำต่อ</);
  assert.match(grRow, /in_progress/);
  // งานที่พัก: ไม่มีปุ่มรายงานผลที่ตารางและที่การ์ดงานของฉัน · dialog ไม่เปิด · action ปฏิเสธ (ต้องกด ทำต่อ ก่อน)
  assert.doesNotMatch(grRow, /data-rf-open="jobReport"/, "no report button on a held job");
  html = await env.render("p=work");
  const grCard = html.split("<article").find((entry) => entry.includes(gr.itemCode) && entry.includes("DEMO-26001"));
  assert.ok(grCard && grCard.includes(">ทำต่อ<") && !grCard.includes('data-rf-open="jobReport"'), "the work card offers resume, not report");
  assert.equal(env.context.MNP_BOM_DIALOGS.jobReport(env.ctx(), { jobId: gr.id }), null, "no report dialog for a held job");
  const refused = env.store.run("reportJob", { jobId: gr.id, qtyDone: 1 });
  assert.equal(refused.ok, false);
  assert.match(refused.error.message, /พักอยู่ กด ทำต่อ ก่อนรายงานผล/);
  assert.equal(env.store.run("setJobStatus", { jobId: gr.id, status: "in_progress" }).ok, true);
  assert.match(await env.render("p=jobs&dept=GR"), /data-rf-open="jobReport"/, "after resuming the report button is back");
  assert.equal(env.store.run("reportJob", { jobId: gr.id, qtyDone: 1 }).ok, true);
});

// ย้อนรับเข้าคลัง / ย้อนส่งมอบ (20261128020000): ใบสาธิต DEMO-26008 ส่งมอบครบแล้ว (รับ 8 + 12 ส่งมอบ 20)
test("reversing in step 6: only the warehouse manager sees a reverse button per receipt and delivery, the dialog asks a reason or says why not, a reversed row is faded with its reversal", async () => {
  const env = load();
  const PI = "DEMO-26008";
  const moves = env.store.data().fgMoves.filter((move) => move.orderId === PI);
  const receipt = moves.find((move) => move.kind === "receive" && move.qty === 12);
  const delivery = moves.find((move) => move.kind === "deliver");
  env.store.setUser("B09");
  let html = await env.render(`p=orders&sel=${PI}&step=6`);
  clean(html);
  assert.doesNotMatch(html, /data-rf-open="fgReverse"/, "WH staff has no reverse button");
  assert.match(env.store.run("reverseFg", { orderId: PI, moveId: delivery.id, note: "ส่งผิดใบ" }).error.message, /ผู้จัดการแผนกคลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
  env.store.setUser("B10");
  html = await env.render(`p=orders&sel=${PI}&step=6`);
  clean(html);
  assert.equal(count(html, /data-rf-open="fgReverse"/g), 3, "two receipts and one delivery can be reversed by the warehouse manager");
  const dialogs = env.context.MNP_BOM_DIALOGS;
  const blocked = dialogs.fgReverse(env.ctx(`p=orders&sel=${PI}`), { orderId: PI, moveId: receipt.id }).html;
  assert.match(blocked, /ให้ย้อนการส่งมอบก่อน/, "a receipt that was delivered says what to do first");
  assert.doesNotMatch(blocked, /data-rf-form="reverseFg"/, "and has nothing to confirm");
  const form = dialogs.fgReverse(env.ctx(`p=orders&sel=${PI}`), { orderId: PI, moveId: delivery.id }).html;
  assert.match(form, /data-rf-form="reverseFg"/);
  assert.match(form, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(form, /name="note"[^>]*required[^>]*minlength="3" maxlength="300"/);
  assert.doesNotMatch(form, /undefined|NaN/);
  assert.equal(env.store.run("reverseFg", { orderId: PI, moveId: delivery.id, note: "ส่งผิดใบ" }).ok, true);
  assert.equal(env.store.run("reverseFg", { orderId: PI, moveId: receipt.id, note: "รับซ้ำ" }).ok, true);
  assert.equal(env.store.data().orders.find((order) => order.id === PI).status, "in_progress", "8 left of the 20 ordered: the order reopens");
  html = await env.render(`p=orders&sel=${PI}&step=6`);
  clean(html);
  assert.match(html, /ย้อนรับเข้า <span class="rf-mono">DEMO-HL-24\(B\)-A<\/span>/);
  assert.match(html, /ย้อนส่งมอบ <span class="rf-mono">DEMO-HL-24\(B\)-A<\/span>/);
  assert.match(html, /<td class="right rf-mono">−12<\/td>/, "the reversal shows a negative quantity");
  assert.match(html, /<div class="small muted">รับซ้ำ<\/div>/, "and its reason");
  assert.equal(count(html, />ถูกย้อน</g), 2, "both originals are marked");
  assert.equal(count(html, /<tr class="muted">/g), 2, "and faded");
  assert.equal(count(html, /data-rf-open="fgReverse"/g), 1, "only the remaining receipt can still be reversed");
  // ข้อความยืนยันการรับเข้า / ส่งมอบบอกว่าใครย้อนได้ (แทน "แก้ไขหรือยกเลิกไม่ได้")
  env.store.setUser("B09");
  html = await env.render(`p=orders&sel=${PI}&step=6`);
  assert.match(html, /data-rf-confirm="ส่งมอบสินค้าตามจำนวนที่กรอก\? ถ้าบันทึกผิด ย้อนได้โดยผู้จัดการแผนกคลังสินค้า \(WH\) เท่านั้น"/);
  assert.doesNotMatch(html, /แก้ไขหรือยกเลิกไม่ได้/);
});

// ---------- ชุดที่ 3: กันตัวเลขผิดตอนสร้าง BOM และใบ (W5 U1 W9 W4 U13) ----------
// ช่องจำลองสำหรับทดสอบ bind ของ dialog (ไม่มี DOM จริง): querySelector คืนช่องตามตัวเลือกที่ให้ไว้ ที่เหลือเป็น null
const fakeNode = (value = "") => ({ value, innerHTML: "", textContent: "", hidden: false, disabled: false, required: false, checked: false, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector() { return null; }, closest() { return null; } });
const fakeDialog = (map, lists = {}) => ({ querySelector: (selector) => map[selector] ?? null, querySelectorAll: (selector) => lists[selector] ?? [] });
const callout = () => { const body = { textContent: "" }; return { hidden: true, body, querySelector: () => body }; };

test("the add-component dialog shows the item's unit in the quantity label, fills a rod's quantity from its cutting data and warns (without blocking) when the entered quantity differs by more than 1% (U1 W5)", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "SE-HL24-YE03-400-19-30";
  const rod = "RB-DM01-02-OR01-202-18-70";
  const c = env.ctx();
  const built = env.context.MNP_BOM_DIALOGS.lineAdd(c, { parentCode: parent });
  assert.match(built.html, /<label for="bom-add-qty">ใช้ต่อ 1 ชิ้น <span class="field-required">\(จำเป็น\)<\/span><\/label>/, "before an item is picked the label names the parent's unit only");
  assert.match(built.html, /id="bom-add-qty"[^>]*data-add-qty|data-add-qty[^>]*id="bom-add-qty"/);
  assert.match(built.html, /data-add-cut hidden>/, "the warning is hidden until needed");
  const nodes = { "[data-add-code]": fakeNode(), "[data-add-new]": fakeNode(), "[data-add-name]": fakeNode(), "[data-add-kind]": fakeNode("SUBPART"), "[data-add-uom]": fakeNode("pcs"), "[data-add-qty]": fakeNode(), "[data-add-cut-hint]": fakeNode(), "[data-add-cut]": callout() };
  const label = { firstChild: { nodeValue: "" } };
  nodes['label[for="bom-add-qty"]'] = label;
  built.bind(fakeDialog(nodes));
  const code = nodes["[data-add-code]"];
  const qty = nodes["[data-add-qty]"];
  const cut = nodes["[data-add-cut]"];
  // ชิ้นที่มีในทะเบียน: หน่วยของมัน (P-BAG-01 เป็นกก.)
  code.value = "P-BAG-01";
  code.handlers.change();
  assert.equal(label.firstChild.nodeValue, "ใช้ต่อ 1 ชิ้น (กก.)");
  // เส้นยางที่มีข้อมูลการตัด: ปริมาณถูกเติมจากการตัด (1/31) พร้อมบอกที่มา และไม่เตือน
  code.value = rod;
  code.handlers.change();
  assert.equal(label.firstChild.nodeValue, "ใช้ต่อ 1 ชิ้น (เส้น)");
  assert.equal(qty.value, String(Math.round((1 / 31) * 1e6) / 1e6));
  assert.equal(nodes["[data-add-cut-hint]"].textContent, "จากการตัด 0.0323");
  assert.equal(cut.hidden, true);
  // ผู้ใช้แก้เป็น 1: เตือนด้วยข้อมูลการตัด แต่ไม่ล้างค่าที่กรอกและไม่ห้าม
  qty.value = "1";
  qty.handlers.input();
  assert.equal(cut.hidden, false);
  assert.match(cut.body.textContent, /ข้อมูลการตัดของ RB-DM01-02-OR01-202-18-70: 1 เส้น ได้ 31 ชิ้น = ใช้ 0.0323 เส้น ต่อ 1 ชิ้น/);
  assert.equal(nodes["[data-add-cut-hint]"].textContent, "", "the hint is only for a value the system filled");
  code.value = "P-ZIP-05";
  code.handlers.change();
  assert.equal(qty.value, "1", "a value the user typed is kept when another item is picked");
  assert.equal(cut.hidden, true, "no cutting data for a purchased part: no warning");
  // ค่าที่ระบบเติมเองถูกล้างเมื่อเปลี่ยนไปเลือกชิ้นที่ไม่มีข้อมูลการตัด
  qty.value = "";
  code.value = rod;
  code.handlers.change();
  assert.notEqual(qty.value, "");
  code.value = "P-ZIP-05";
  code.handlers.change();
  assert.equal(qty.value, "", "the auto-filled quantity goes away with the rod");
  // ชิ้นใหม่: หน่วยตามที่เลือกในฟอร์ม (เปลี่ยนแล้วป้ายเปลี่ยนตาม)
  code.value = "XP-T-NEW-1";
  code.handlers.change();
  nodes["[data-add-new]"].hidden = false;
  nodes["[data-add-uom]"].value = "box";
  nodes["[data-add-uom]"].handlers.change();
  assert.equal(label.firstChild.nodeValue, "ใช้ต่อ 1 ชิ้น (กล่อง)");
  code.value = "";
  code.handlers.change();
  assert.equal(label.firstChild.nodeValue, "ใช้ต่อ 1 ชิ้น");
});

test("the edit-line dialog warns about a rod quantity that disagrees with its cutting data, when it opens and while typing, and has no warning for other items (W5)", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "SE-TP01-OR01-100-18-65";
  const rod = "RB-DM01-02-OR01-202-18-70";
  const built = env.context.MNP_BOM_DIALOGS.lineEdit(env.ctx(), { parentCode: parent, childCode: rod });
  assert.match(built.html, /name="qty\[\]"[^>]*data-edit-qty/);
  assert.match(built.html, /data-edit-cut hidden>/);
  const nodes = { "[data-edit-qty]": fakeNode(String(1 / 31)), "[data-edit-cut]": callout() };
  built.bind(fakeDialog(nodes));
  assert.equal(nodes["[data-edit-cut]"].hidden, true, "the stored ratio matches the cutting data");
  nodes["[data-edit-qty]"].value = "1";
  nodes["[data-edit-qty]"].handlers.input();
  assert.equal(nodes["[data-edit-cut]"].hidden, false);
  assert.match(nodes["[data-edit-cut]"].body.textContent, /1 เส้น ได้ 31 ชิ้น = ใช้ 0.0323 เส้น ต่อ 1 ชิ้น/);
  nodes["[data-edit-qty]"].value = "0.0324";
  nodes["[data-edit-qty]"].handlers.input();
  assert.equal(nodes["[data-edit-cut]"].hidden, true, "within 1%");
  const bag = env.context.MNP_BOM_DIALOGS.lineEdit(env.ctx(), { parentCode: "DEMO-TP-01(P)-Y", childCode: "P-BAG-01" });
  assert.doesNotMatch(bag.html, /data-edit-cut/, "a purchased part has no cutting data");
  // เปิดหน้าต่างของบรรทัดที่ขัดกับข้อมูลการตัดอยู่แล้ว: เตือนทันที
  const lines = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.map((line) => ({ childCode: line.childCode, qty: line.childCode === rod ? 1 : line.qty }));
  assert.equal(env.store.run("saveBom", { itemCode: parent, lines }).ok, true);
  const open = nodes2(env.context.MNP_BOM_DIALOGS.lineEdit(env.ctx(), { parentCode: parent, childCode: rod }), "1");
  assert.equal(open["[data-edit-cut]"].hidden, false);
});
function nodes2(built, value) {
  const map = { "[data-edit-qty]": fakeNode(value), "[data-edit-cut]": callout() };
  built.bind(fakeDialog(map));
  return map;
}

test("the data check page lists a rod line that disagrees with its cutting data and links to the BOM that holds it (W5)", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "SE-TP01-OR01-100-18-65";
  const rod = "RB-DM01-02-OR01-202-18-70";
  assert.doesNotMatch(await env.render("p=check"), /ปริมาณเส้นยางขัดกับข้อมูลการตัด/, "the demo data agrees with the cutting data");
  const lines = env.store.data().boms.find((bom) => bom.itemCode === parent && bom.status === "approved").lines.map((line) => ({ childCode: line.childCode, qty: line.childCode === rod ? 1 : line.qty }));
  assert.equal(env.store.run("saveBom", { itemCode: parent, lines }).ok, true);
  const html = await env.render("p=check");
  clean(html);
  assert.match(html, /ปริมาณเส้นยางขัดกับข้อมูลการตัด/);
  assert.match(html, /RB-DM01-02-OR01-202-18-70: ใช้ 1 เส้น ต่อ 1 ชิ้น · ข้อมูลการตัดบอก 0.0323 เส้น/);
  assert.match(html, new RegExp(`href="[^"]*${parent.replaceAll("-", "\\-")}[^"]*"[^>]*>แก้ BOM`), "the fix link opens the parent's BOM");
});

test("adding a product to an order: the pack and colour-set choices follow the chosen base, and a code that does not exist yet needs a confirmed, editable name before it is created (W9)", async () => {
  const env = load();
  env.store.setUser("B03");
  // ฐานที่มีสินค้าแพ็ก K ซึ่งยังไม่มีนิยาม: ชุดสี A มาจากสินค้าอีกตัวของฐานนั้น
  assert.equal(env.store.run("addOrderItem", { orderId: "DEMO-26002", base: "DEMO-HL-24", pkg: "K", colorSet: "", qty: 1 }).ok, true);
  const c = env.ctx("p=orders");
  const add = env.context.MNP_BOM_DIALOGS.orderItemAdd(c, { orderId: "DEMO-26002" });
  assert.match(add.html, /data-new-fg hidden>/, "the confirm panel starts hidden");
  assert.match(add.html, /name="name"[^>]*data-new-fg-name disabled/, "the name field is not sent until the panel shows");
  assert.match(add.html, /data-orderadd-submit>เพิ่ม<\/button>/);
  const base = fakeNode("");
  const pkg = fakeNode("");
  const set = fakeNode("");
  const warnBox = callout();
  const warnText = fakeNode();
  const preview = { className: "", querySelector: () => ({ textContent: "" }) };
  const panel = fakeNode();
  const name = fakeNode();
  const confirm = fakeNode();
  const submit = fakeNode();
  add.bind(fakeDialog({ "[data-bom-preview]": preview, "[data-new-fg]": panel, "[data-new-fg-warn]": warnBox, "[data-new-fg-warn-text]": warnText, "[data-new-fg-name]": name, "[data-new-fg-confirm]": confirm, "[data-orderadd-submit]": submit }, { "[data-bom-part]": [base, pkg, set] }), c);
  assert.equal(panel.hidden, true);
  const values = (node) => [...node.innerHTML.matchAll(/<option value="([^"]*)"/g)].map((match) => match[1]);
  // เลือกฐาน DEMO-TP-01: แพ็กเกจ P B และชุดสี Y A ที่นิยามไว้ (ไม่ใช่ของฐานอื่น)
  base.value = "DEMO-TP-01";
  base.handlers.change();
  assert.deepEqual([values(pkg), values(set)], [["", "B", "P"], ["", "A", "Y"]], "the blank option stays; K and the rest are gone");
  base.value = "DEMO-HL-24";
  base.handlers.change();
  assert.deepEqual([values(pkg), values(set)], [["", "B", "K"], ["", "A"]], "the base's existing products supply their pack and colour set");
  // รหัสที่ยังไม่มี: DEMO-HL-24(K)-A มาจากต้นแบบ (K) ที่ชุดสี A ไม่มีนิยาม → เตือน + ช่องชื่อพร้อมชื่อที่แนะนำ + ต้องติ๊กยืนยัน
  pkg.value = "K";
  set.value = "A";
  set.handlers.change();
  assert.equal(panel.hidden, false);
  assert.equal(name.disabled, false);
  assert.equal(name.required, true);
  assert.equal(name.value, "DEMO-HL-24 (แพ็กเกจ K ชุดสี A)", "the source's own description is not copied");
  assert.equal(warnBox.hidden, false);
  assert.match(warnText.innerHTML, /ฐาน DEMO-HL-24 ยังไม่มีนิยามชุดสี A สีจึงเป็นของ DEMO-HL-24\(K\)/);
  assert.equal(submit.disabled, true, "the add button waits for the confirmation");
  confirm.checked = true;
  confirm.handlers.change();
  assert.equal(submit.disabled, false);
  // ชื่อที่ผู้ใช้พิมพ์ไม่ถูกทับเมื่อเปลี่ยนเรื่องอื่น แต่เปลี่ยนรหัสแล้วแนะนำใหม่และต้องยืนยันใหม่
  name.value = "ชื่อที่พิมพ์เอง";
  confirm.handlers.change();
  assert.equal(name.value, "ชื่อที่พิมพ์เอง");
  pkg.value = "B";
  pkg.handlers.change();
  assert.equal(panel.hidden, true, "DEMO-HL-24(B)-A exists: nothing to confirm");
  assert.equal(name.disabled, true, "so no name is sent");
  assert.equal(submit.disabled, false);
  pkg.value = "K";
  set.value = "";
  set.handlers.change();
  assert.equal(panel.hidden, true, "DEMO-HL-24(K) exists too (made above)");
});

test("the job report dialog warns when the total would pass what the previous departments supplied, never blocks, and stays silent when the supply is unknown (W4)", async () => {
  const env = load();
  env.store.setUser("B03");
  const data = env.store.data();
  const job = data.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "SE-TP01-BK01-140-3-20");
  const limit = env.context.MNP_BOM_RULES.jobSupplyLimit(data, job);
  assert.equal(limit, 42, "the seed: the rod jobs behind this item have reported enough for 42, the item itself 120");
  const built = env.context.MNP_BOM_DIALOGS.jobReport(env.ctx("p=jobs"), { jobId: job.id });
  assert.match(built.html, /name="qtyDone"[^>]*data-job-qty/);
  // U4: ช่องจำนวนดีว่าง (บอกยอดที่เหลือเป็น placeholder) กดบันทึกครั้งเดียวจึงไม่รายงานว่าเสร็จทั้งแผน
  const qtyField = /<input[^>]*name="qtyDone"[^>]*>/.exec(built.html)[0];
  assert.match(qtyField, /value=""/);
  assert.match(qtyField, new RegExp(`placeholder="เหลือ ${env.context.MNP_BOM_RULES.fmtQty(job.qtyPlanned - job.qtyDone)}"`));
  assert.equal(env.store.run("reportJob", { jobId: job.id, qtyDone: "", qtyReject: "0" }).ok, false, "an empty good quantity with no rejects reports nothing");
  assert.match(built.html, /data-job-supply hidden>/);
  const qty = fakeNode("0");
  const box = callout();
  built.bind(fakeDialog({ "[data-job-qty]": qty, "[data-job-supply]": box }));
  assert.equal(box.hidden, true, "nothing entered: no warning even though the job is already past the supply");
  qty.value = "5";
  qty.handlers.input();
  assert.equal(box.hidden, false);
  assert.equal(box.body.textContent, `แผนกก่อนหน้าส่งมาพอสำหรับ 42 ชิ้น แต่ยอดรวมที่รายงานจะเป็น ${job.qtyDone + 5}`);
  // ไม่รู้ยอดที่ส่งมา (ชิ้นแม่ที่ไม่มีผลระเบิด) = ไม่มีกล่องเตือน
  const plain = env.context.MNP_BOM_DIALOGS.jobReport(env.ctx("p=jobs"), { jobId: data.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "XP-00001").id });
  assert.doesNotMatch(plain.html, /data-job-supply/);
});

test("inserting a WIP: changing the kind sets the department like the item form; the starting department stays the parent's (U13)", async () => {
  const env = load();
  env.store.setUser("B03");
  const parent = "DEMO-TP-01(P)-Y";
  const built = env.context.MNP_BOM_DIALOGS.wipInsert(env.ctx(), { parentCode: parent, childCode: "SE-TP01-OR01-100-18-65" });
  assert.match(built.html, /name="wipKind"[^>]*data-wip-kind/);
  assert.match(built.html, /name="wipDept"[^>]*data-wip-dept/);
  const kind = fakeNode("SUBPART");
  const dept = fakeNode("PK");
  built.bind(fakeDialog({ "[data-wip-kind]": kind, "[data-wip-dept]": dept }));
  assert.equal(dept.value, "PK", "binding does not change the starting department");
  kind.value = "BG";
  kind.handlers.change();
  assert.equal(dept.value, env.context.MNP_BOM_RULES.ownerDeptOf("BG"));
  kind.value = "SE";
  kind.handlers.change();
  assert.equal(dept.value, "GR");
});

test("audit page: a product's use-from-stock is named as such even though the database keeps the setStockCount key; a mixed batch stays a count", () => {
  const env = load();
  env.store.setUser("B03");
  const text = env.context.MNP_BOM_PAGES.audit.actionText;
  const { rules } = env.ctx("p=audit");
  const fg = { action: "setStockCount", entries: [{ action: "ใช้จากสต็อกสินค้าสำเร็จรูป", detail: "PI-1 FG-1 = 5" }] };
  assert.equal(text(rules, fg, true), "ใช้จากสต็อกสินค้าสำเร็จรูป");
  assert.equal(text(rules, { ...fg, action: "setStockCounts" }, true), "ใช้จากสต็อกสินค้าสำเร็จรูป", "a batch of only product rows");
  assert.equal(text(rules, { action: "setStockCounts", entries: [fg.entries[0], { action: "นับคงคลังตามใบ", detail: "PI-1 P-2 = 3" }] }, true), "นับคงคลัง", "a batch that also counts another item");
  assert.equal(text(rules, { action: "setStockCount", entries: [{ action: "นับคงคลังตามใบ", detail: "PI-1 P-2 = 3" }] }, true), "นับคงคลัง");
  assert.equal(text(rules, { action: "setStockCount", entries: [] }, true), "นับคงคลัง", "older rows with no recorded text");
  assert.equal(text(rules, { action: "explodeOrder", entries: [] }, true), "คำนวณวัตถุดิบ");
  assert.equal(text(rules, { action: "unknownKey" }, true), "unknownKey");
  assert.equal(text(rules, { action: "ใช้จากสต็อกสินค้าสำเร็จรูป" }, false), "ใช้จากสต็อกสินค้าสำเร็จรูป", "local rows carry the recorded text itself");
});

test("link-compound dialog: an existing formula shows its code once (title) and sends it hidden; adding a formula keeps the required field", () => {
  const env = load();
  env.store.setUser("B03");
  const D = env.context.MNP_BOM_DIALOGS;
  const existing = D.compoundLink(env.ctx("p=compounds"), { code: "DM03" });
  assert.match(existing.html, /<input type="hidden" name="code" value="DM03">/);
  assert.doesNotMatch(existing.html, /readonly|รหัสสูตรยาง/, "no read-only copy of the code in the form");
  assert.match(existing.html, /ผูกสูตร DM03/, "the title carries the code");
  const added = D.compoundLink(env.ctx("p=compounds"), {});
  assert.match(added.html, /รหัสสูตรยาง <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(added.html, /<input class="input rf-input" name="code"[^>]* required/);
});

test("orders list: one heading (the page title), the open-new-order button sits with it, and no card title repeats the menu name", async () => {
  const env = load();
  env.store.setUser("B03");
  const html = await env.render("p=orders");
  clean(html);
  assert.equal(count(html, /<h1>/g), 1);
  assert.match(html, /<h1>ใบสั่งผลิต \(PI\)/);
  assert.doesNotMatch(html, /<h2>ใบสั่งผลิต<\/h2>/, "the card carries no second 'ใบสั่งผลิต' title");
  assert.match(html, /<header class="rf-pagehead">[\s\S]*data-rf-open="orderNew"[\s\S]*<\/header>/, "the planner's button is in the page head");
  assert.match(html, /คำนวณวัตถุดิบ/);
  assert.doesNotMatch(html, /ระเบิด BOM/);
});
