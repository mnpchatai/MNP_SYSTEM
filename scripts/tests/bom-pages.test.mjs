import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { makeZip } from "./zip-fixture.mjs";

// โหลดโมดูล BOM ทั้งชุด (พร้อม RubberFlow ที่ให้ ui และ store สำหรับการเชื่อม WO) เข้า context จำลองที่มี helper ของ app.js แบบ stub
// และ localStorage จำลอง แล้ววาดทุกหน้า × ทุกบทบาท เรียก dialog ทุกตัว และยิงฟอร์ม/ปุ่มผ่านกติกา data-rf-* ของ module-bom.js
const FILES = [
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const PAGES = ["dashboard", "build", "items", "product", "structure", "variants", "compounds", "import", "orders", "count", "jobs", "audit"];
const ROLES = ["admin", "manager", "planner", "rb", "gr", "pt", "bg", "st"];
const XSS = "<script>alert(1)</script>";

function load({ sandbox = true, route = "", storage = new Map() } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: `#/bom${route ? `?${route}` : ""}`, dialogs: [] };
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
    renderRoute: async () => { log.renders += 1; }, confirm: () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
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
  assert.match(html, /เลือกบทบาทสาธิต/);
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
  assert.match(html, /1\. เลือกสินค้า/);
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
  assert.doesNotMatch(html, /ตั้งต้นจาก/);
  assert.equal([...html.matchAll(/class="bom-row is-new"/g)].length, 2, "one empty editable row plus the template row");
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
  assert.doesNotMatch(html, /p=build&amp;code=RB-DM03/, "RB has no BOM to build");
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
  const orderNewBuilt = D.orderNew(c, {});
  const orderNew = orderNewBuilt.html;
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
  const dialogNode = { querySelector: (selector) => ({ "[data-bom-whdue]": whInput, 'input[name="orderedAt"]': orderedInput, "[data-bom-autodue]": auto })[selector] ?? null, querySelectorAll: (selector) => (selector === "[data-bom-due-preview]" ? previews : selector === "[data-bom-due]" ? dueInputs : []) };
  orderNewBuilt.bind(dialogNode);
  whInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "PK").textContent, "ว่าง = 14 ธ.ค. 69");
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 4 ธ.ค. 69");
  assert.ok(dueInputs.every((input) => input.value === ""), "the date inputs themselves stay empty");
  auto.checked = false;
  auto.handlers.change();
  assert.ok(previews.every((node) => node.textContent === ""), "unticking clears the previews");
  auto.checked = true;
  whInput.value = "2026-11-01";
  whInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 30 ต.ค. 69", "the preview shows the clamped date (not before the order date)");
  orderedInput.value = "2026-10-20";
  orderedInput.handlers.change();
  assert.equal(previews.find((node) => node.dataset.bomDuePreview === "RB").textContent, "ว่าง = 21 ต.ค. 69", "changing the order date recomputes the clamp");
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

test("forms go through the data-rf-* rules: a new order is created with dates converted, a bad form shows a toast and keeps the state", async () => {
  const env = load();
  env.store.setUser("B03");
  // เปิดใบโดยไม่กรอกเลข PI และติ๊กเติมกำหนดเสร็จจาก lead time (ผ่าน transform ของฟอร์ม)
  await env.submit("p=orders", "createOrder", { pi: "", customer: "อัตโนมัติ", country: "Thailand", orderedAt: "2026-10-30", whDue: "2026-12-15", autoDue: "1" });
  const autoOrder = env.store.data().orders.find((order) => order.customer === "อัตโนมัติ");
  assert.equal(autoOrder.id, "261030-26001");
  assert.equal(new Date(autoOrder.due.PK).getDate(), 14);
  assert.deepEqual(json(autoOrder.dueDefaults), ["RB", "GR", "PT", "BG", "ST", "PK"]);
  assert.match(await env.render(`p=orders&sel=${autoOrder.id}`), /title="ค่าเริ่มต้นจาก lead time"><b>PK<\/b> 14 ธ\.ค\. 69\*/);
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
  assert.deepEqual(cardTitles, ["RB", "GR", "PT", "ST", "PK"], "cards run upstream → downstream and skip departments without work (no BG in this product)");
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
  assert.match(html, /<li class="bom-flow-input">[\s\S]*?P-PEL-BK<\/[^>]+> <span class="bom-flow-input-name">เม็ดพลาสติก PE-LD สีดำ<\/span>/, "a material row shows its name next to the code, not only in a tooltip");
  const fedRows = html.match(/<li class="bom-flow-input is-fed">[\s\S]*?<\/li>/g) ?? [];
  assert.ok(fedRows.length > 0 && fedRows.every((row) => !row.includes("bom-flow-input-name")), "a row fed from a lane above keeps only its code (the lane card shows the name)");
  assert.match(html, /class="filter active" href="[^"]*view=flow" aria-current="page">ลำดับผลิต/);
  const order = (...needles) => needles.map((needle) => html.indexOf(needle));
  const [rbStep, seCard, asm, sticker, pack, fgCard] = order("RB-EXT", "<span class=\"rf-mono\">SE-TP01-OR01-100-18-65</span><div class=\"small\">", "PK-ASM", "P-STK-01", "PK-PACK", "<span class=\"rf-mono\">DEMO-TP-01(P)-Y</span><div class=\"small\">");
  assert.ok(rbStep > 0 && rbStep < seCard && seCard < asm && asm < sticker && sticker < pack && pack < fgCard, "first steps come first, the product card is last");
  assert.match(html, /คอมปาวด์ <span class="rf-mono">DM01<\/span>/, "a rod shows its compound as the first input");
  assert.match(html, /SE-TP01-OR01-100-18-65<\/span> <span class="muted nowrap">× 3 ชิ้น<\/span> <span class="muted">\(จากสายด้านบน\)/, "a fed part points to its lane");
  assert.match(html, /data-rf-open="routingEdit" data-rf-args="\{&quot;code&quot;:&quot;SE-TP01-OR01-100-18-65&quot;\}"/);
  assert.match(html, /data-rf-open="itemImage" data-rf-args="\{&quot;code&quot;:&quot;DEMO-TP-01\(P\)-Y&quot;\}"/);
  assert.match(html, /GR · ตัด\/เจาะชิ้นยาง<\/td><td class="num">3\.45<\/td><td class="num">4\.6<\/td>/, "3.45 min per set × 80 sets = 4.6 hours");
  // มุมมองตารางต้นทุน: สินค้าอยู่บน ราคาตั้งได้เฉพาะชิ้นที่ไม่มี BOM
  html = await env.render("p=structure&code=DEMO-TP-01(P)-Y&view=table");
  clean(html);
  assert.match(html, /PK-ASM 1\.5′/);
  assert.match(html, /data-rf-open="itemCost" data-rf-args="\{&quot;code&quot;:&quot;XP-00001&quot;\}"/);
  assert.doesNotMatch(html, /data-rf-open="itemCost" data-rf-args="\{&quot;code&quot;:&quot;PT-00320&quot;\}"/, "parts with a BOM have no manual cost");
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "setItemCost", { unitCost: "0.4" }, { code: "XP-00001" });
  await env.submit("p=structure&code=DEMO-TP-01(P)-Y", "saveRouting", { "processCode[]": ["PK-QC", "", "PK-ASM"], "minutesPerPc[]": ["0.5", "9", "1"], "inputCode[]": ["P-BOX-01", "PT-00320", "P-STK-01"], "inputStep[]": ["PK-ASM", "PK-QC", ""] }, { itemCode: "DEMO-TP-01(P)-Y" });
  const routing = env.context.MNP_BOM_ACTIONS.helpers.routingOf(env.store.data(), "DEMO-TP-01(P)-Y");
  assert.deepEqual(json(routing.steps.map((step) => [step.processCode, step.minutesPerPc, step.inputs])), [["PK-QC", 0.5, ["PT-00320"]], ["PK-ASM", 1, ["P-BOX-01"]]], "blank rows are skipped, the order is kept and inputs follow their step");
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
  assert.match(dialog.html, /<option value="PK-QC" selected>/);
  assert.match(dialog.html, /name="inputCode\[\]" value="PT-00320"[\s\S]*?<option value="PK-QC" selected>PK-QC<\/option>/, "each BOM line shows the step it enters");
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
