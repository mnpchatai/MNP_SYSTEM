import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// เมนูกลุ่ม "โรงงาน" และโมดูลรายแผนก (modules/factory-kit.js registerDeptModule · module-st / sr / qa / gr / pt / bg / pk / wh.js)
// โหลดโมดูล BOM + RubberFlow + โมดูลแผนกทั้งแปดเข้า context จำลอง แล้วตรวจ: ลำดับเมนูตามผังงานใต้หัวกลุ่มเดียว · ใครเห็นโมดูลไหน (ผ่าน/ไม่ผ่าน)
// · ประตูโหมดทดสอบ (ใช้ usesBom ตัวเดียวกับ BOM) · หน้าปฏิเสธนอกโหมดทดสอบ · หน้าแรกของแต่ละแผนกวาดจากข้อมูลสาธิตของ BOM และ RubberFlow
const FILES = [
  "vendor/qrcode-generator/qrcode.js", "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/st-pages.js", "modules/module-st.js", "modules/module-sr.js", "modules/module-qa.js", "modules/gr-pages.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/wh-pages.js", "modules/module-wh.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

// พนักงาน/บัญชีทดสอบ: แผนก + ตำแหน่ง (employee = พนักงานทั่วไป)
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, ...extra });

function load({ employee = emp("PP"), route = "", capture = null } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: `#/${route}`, toasts: [], listeners: {}, docListeners: {} };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {}, add() {}, remove() {} }, files: [],
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
  });
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const storage = new Map();
  Object.assign(context, {
    window: context, addEventListener: (type, handler) => { (log.listeners[type] ??= []).push(handler); }, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic(), addEventListener: (type, handler) => { (log.docListeners[type] ??= []).push(handler); } },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  for (const file of FILES) {
    vm.runInContext(read(file), context, { filename: file });
    // เก็บตัวฟัง event ของ store BOM ที่ module-bom.js ลงทะเบียน (store ในเครื่องไม่ส่ง event เอง)
    if (capture && file === "modules/bom-store.js") {
      const api = context.MNP_BOM_STORE;
      const create = api.createStore;
      api.createStore = (...args) => { const made = create(...args); const subscribe = made.subscribe; made.subscribe = (listener) => { capture.push(listener); return subscribe(listener); }; return made; };
    }
  }
  const modules = context.MNP_REQUEST_MODULES;
  const setEmployee = (next) => { context.state.employee = next; };
  const open = async (code, query = "") => {
    const entry = modules[code];
    const path = entry.nav[0].path;
    log.hash = `#/${path}${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await entry.pages[path](new URLSearchParams(query));
    return app.innerHTML;
  };
  // เมนูเหมือน requestModuleNavLinks ของ app.js (ตัดฟังก์ชันจริงจาก app.js มาเรียก ไม่เขียนซ้ำ) · isLab ไม่มี
  const source = read("app.js").replaceAll("\r\n", "\n");
  const start = source.indexOf("function requestModuleNavLinks(active) {");
  const body = source.slice(start, source.indexOf("\n}\n", start) + 2);
  const nav = vm.runInContext(`(() => { const REQUEST_MODULES = MNP_REQUEST_MODULES; const isSandboxMode = () => Boolean(state.employee?.isSandbox); const sandboxSupports = (entry) => !isSandboxMode() || entry.sandbox === true; const isLabOnly = () => false; const deptAccessSubject = () => (isSandboxMode() || isLabOnly() ? null : state.employee); const deptModuleAllowed = (code) => window.MNP_DEPARTMENT_ACCESS.moduleAllowed(deptAccessSubject(), code); const navLink = (path, label) => '<a href="#/' + path + '">' + label + '</a>'; ${body}; return requestModuleNavLinks; })()`, context, { filename: "app.js (requestModuleNavLinks)" });
  return { context, app, log, fakes, root, modules, store: context.MNP_BOM.store, rf: context.MNP_RUBBERFLOW, setEmployee, open, nav: (active = "") => nav(active) };
}

// เมนูข้างของโมดูล (nav[0].subnav) ตอนที่หน้านั้นเปิดอยู่: อ่านรายการกลับเป็นข้อมูล
const navOf = (env, code) => {
  const item = env.modules[code].nav[0];
  const html = item.subnav(item.path);
  const items = [...html.matchAll(/<a class="rf-nav-item( is-active)?" href="([^"]*)"( aria-current="page")?>[\s\S]*?<span class="rf-nav-text">([^<]*)<\/span>(?:<span class="rf-nav-count"[^>]*>(\d+)<\/span>)?<\/a>/g)]
    .map((match) => ({ label: match[4], href: match[2], active: Boolean(match[1]), current: Boolean(match[3]), count: match[5] ? Number(match[5]) : 0 }));
  return { html, items };
};

function makeReceivable(env) {
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  for (const job of data.jobs.filter((entry) => entry.orderId === order.id && entry.dept === "PK")) { job.qtyDone = job.qtyPlanned; job.status = "done"; }
  return order;
}


// โมดูลคลังสินค้าสำเร็จรูป (WH) #/wh: หน้าในคลัง รับเข้า ส่งมอบ ประวัติ หน้าใบ และหน้าล็อตของกล่องจาก RubberFlow · ใครเห็นโมดูล · ปุ่มของใคร · ย้อนโดยหัวหน้า WH กับผู้ดูแลระบบ


// ---------- โมดูลคลังสินค้าสำเร็จรูป (WH) #/wh · modules/wh-pages.js (โรงงาน ขั้น 4 · 20261207010000) ----------
// สินค้าจาก PK (store ของ BOM) และกล่องจาก RubberFlow (store ของ RubberFlow) ในที่เดียว: ในคลัง · รับเข้า · ส่งมอบ · ประวัติ · หน้าใบ · หน้าล็อต
const h1Of = (html) => (html.match(/<h1>([^<]*)<\/h1>/) ?? [])[1] ?? "";
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const NOW = Date.parse("2026-11-19T10:00:00+07:00");

// ข้อมูลตั้งต้นของ WH: ไม่มีกล่องสาธิตของ RubberFlow ใส่ล็อตของเราเอง · ล็อต A ในคลัง 3 กล่อง (ลูกค้า ALFA PO-A) · B รอ WH รับ 2 กล่อง · C ส่งมอบแล้ว 1 กล่อง · D กักรอ QC 1 กล่อง
function seedBoxes(env) {
  const rf = env.rf.store.data();
  rf.fgBoxes.length = 0;
  const wo = rf.orders[0];
  const lot = (id, extra = {}) => ({ id, stage: "finishing", orderId: wo.id, uom: "pcs", machine: "", shift: "D", sources: [], params: { perBox: 10 }, goodQty: 20, scrapQty: 0, scrapReason: "", qc: "pass", holdReasons: [], transferredQty: 0, createdAt: NOW - 86400000, operator: "พนักงาน RB", grade: "A", boxes: 2, countedToOrder: true, destination: "customer", whCredit: null, ...extra });
  const box = (lotId, n, status, extra = {}) => ({ id: `${lotId.replace("FN", "BOX")}-${String(n).padStart(3, "0")}`, lotId, orderId: wo.id, recipeId: wo.recipeId, productCode: "P-ALFA", qty: 10, uom: "pcs", grade: "A", status, createdAt: NOW - 86400000, customer: "ALFA", customerPo: "PO-A", moves: [], ...extra });
  const rec = (at) => ({ kind: "receive", at, by: "สุดา คลังสินค้า", note: "" });
  rf.lots.push(lot("FN-A"), lot("FN-B"), lot("FN-C", { boxes: 1, goodQty: 10 }), lot("FN-D", { boxes: 1, goodQty: 10, qc: "hold" }));
  rf.fgBoxes.push(
    ...[1, 2, 3].map((n) => box("FN-A", n, "in_stock", { receivedAt: NOW - 3600000, receivedBy: "สุดา คลังสินค้า", moves: [rec(NOW - 3600000)] })),
    ...[1, 2].map((n) => box("FN-B", n, "pending_wh")),
    box("FN-C", 1, "shipped", { receivedAt: NOW - 7200000, shippedAt: NOW - 3600000, shippedBy: "สุดา คลังสินค้า", moves: [rec(NOW - 7200000), { kind: "ship", at: NOW - 3600000, by: "สุดา คลังสินค้า", note: "" }] }),
    box("FN-D", 1, "hold"),
  );
  return rf;
}
const WH_USERS = Object.freeze({ staff: ["B09", emp("WH")], head: ["B10", emp("WH", "department_manager")], admin: ["B01", emp("AD", "admin")], planner: ["B03", emp("PP")], manager: ["B02", emp("PP", "factory_manager")] });
const whEnv = (who) => { const [bomUser, employee] = WH_USERS[who]; const env = load({ employee }); env.store.setUser(bomUser); seedBoxes(env); return env; };
const wh = (env, query = "") => env.open("FACTORY_WH", query);

test("WH is visible in test mode to the warehouse (staff and head), PP and the managers; other departments' staff and heads, the Indesign department, an office employee and anyone outside test mode never see it", () => {
  const { modules } = load();
  const allowed = [["WH staff", emp("WH")], ["WH head", emp("WH", "department_manager")], ["PP", emp("PP")], ["factory manager", emp("PP", "factory_manager")], ["admin", emp("AD", "admin")], ["general manager", emp("OFFICE", "general_manager")]];
  const denied = [["ST staff", emp("ST")], ["ST head", emp("ST", "department_manager")], ["RB staff", emp("RB")], ["SR head", emp("SR", "department_manager")], ["ID employee", emp("ID")], ["office employee", emp("HR")], ["outside test mode", { ...emp("WH"), isSandbox: false }], ["admin outside test mode", { ...emp("AD", "admin"), isSandbox: false }]];
  for (const [label, employee] of allowed) assert.equal(modules.FACTORY_WH.navAllowed(employee), true, `${label} sees WH`);
  for (const [label, employee] of denied) assert.equal(modules.FACTORY_WH.navAllowed(employee), false, `${label} does not see WH`);
});

test("WH pages are refused (not found) for a department that may not open the module, even by typing the address", async () => {
  for (const employee of [emp("ST"), emp("RB"), emp("ST", "department_manager"), emp("ID")]) {
    const env = load({ employee });
    env.store.setUser("B08");
    await env.open("FACTORY_WH", "tab=stock").catch(() => {});
    assert.equal(env.log.notFound, 1, JSON.stringify(employee.department));
  }
});

test("WH ในคลัง lists only what is in the warehouse now (stock > 0): PK goods per code per order, free stock apart, RubberFlow boxes per lot; waiting, shipped and held boxes are not stock", async () => {
  const env = whEnv("staff");
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  const product = env.context.MNP_BOM_RULES.fgPosition(data, order).products[0];
  // received 5 more than ordered, 2 delivered: the order holds ordered − 2 and 5 are free stock; a second product only received nothing → no row
  data.fgMoves = [{ id: "m1", orderId: order.id, fgCode: product.fgCode, kind: "receive", qty: product.ordered + 5, at: 1000, by: "x" }, { id: "m2", orderId: order.id, fgCode: product.fgCode, kind: "deliver", qty: 2, at: 2000, by: "x" }];
  const html = await wh(env, "tab=stock");
  assert.equal(h1Of(html), "ในคลัง");
  for (const head of ["สินค้า", "จำนวน", "ของ", "ที่มา", "วันที่รับ"]) assert.match(html, new RegExp(`<th[^>]*>${head}</th>`), head);
  const rows = html.match(/<tr class="row-link">[\s\S]*?<\/tr>/g) ?? [];
  assert.equal(rows.length, 3, "the order's goods, the free stock, and the one lot of boxes in the warehouse");
  const pk = rows.filter((row) => row.includes(escapeHtml(product.fgCode)));
  assert.equal(pk.length, 2);
  assert.ok(pk.some((row) => row.includes(`href="#/wh?order=${order.id}"`) && row.includes(`ใบ ${order.id}`) && row.includes(`${product.ordered - 2} `)), "held by the order: ordered − 2");
  assert.ok(pk.some((row) => row.includes("สต็อกกลาง") && row.includes(">5 ")), "free stock is its own row");
  const lotRow = rows.find((row) => row.includes("FN-A"));
  assert.ok(lotRow, "the lot in the warehouse");
  assert.match(lotRow, /href="#\/wh\?lot=FN-A"/, "the whole row links to the lot page");
  assert.match(lotRow, /P-ALFA/);
  assert.match(lotRow, /30 pcs|30 ชิ้น|>30 /, "3 boxes × 10");
  assert.match(lotRow, /ใบ PO-A · ALFA/, "whose: the order and the customer on the boxes");
  assert.match(lotRow, /RB · ล็อต FN-A · 3 กล่อง/);
  for (const hidden of ["FN-B", "FN-C", "FN-D"]) assert.ok(!html.includes(hidden), `${hidden}: not stock`);
  // a product with nothing left leaves the list
  data.fgMoves.push({ id: "m3", orderId: order.id, fgCode: product.fgCode, kind: "deliver", qty: product.ordered + 3, at: 3000, by: "x" });
  assert.ok(!(await wh(env, "tab=stock")).includes(`href="#/wh?order=${order.id}"`), "all delivered: no row");
});

test("WH ในคลัง: search covers code, name, order, customer and lot; the source and owner filters narrow it and stay on the clear link; 100 rows a page with a link for more", async () => {
  const env = whEnv("staff");
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  const product = env.context.MNP_BOM_RULES.fgPosition(data, order).products[0];
  data.fgMoves = [{ id: "m1", orderId: order.id, fgCode: product.fgCode, kind: "receive", qty: product.ordered + 5, at: 1000, by: "x" }];
  const lots = (html) => [...html.matchAll(/href="#\/wh\?lot=([^"]+)"/g)].map((match) => match[1]);
  const orders = (html) => [...new Set([...html.matchAll(/href="#\/wh\?order=([^"]+)"/g)].map((match) => match[1]))];
  assert.deepEqual([lots(await wh(env, "tab=stock")), orders(await wh(env, "tab=stock"))], [["FN-A"], [order.id]]);
  for (const q of ["ALFA", "po-a", "FN-A", "P-ALFA"]) assert.deepEqual(lots(await wh(env, `tab=stock&q=${q}`)), ["FN-A"], q);
  assert.deepEqual(orders(await wh(env, `tab=stock&q=${order.id}`)), [order.id]);
  assert.deepEqual(lots(await wh(env, `tab=stock&q=${order.id}`)), [], "an order number finds PK rows only");
  assert.match(await wh(env, "tab=stock&q=ZZZ-NONE"), /ไม่พบสินค้าที่ค้นหา/);
  // filters
  assert.deepEqual([lots(await wh(env, "tab=stock&src=rb")), orders(await wh(env, "tab=stock&src=rb"))], [["FN-A"], []]);
  assert.deepEqual([lots(await wh(env, "tab=stock&src=pk")), orders(await wh(env, "tab=stock&src=pk"))], [[], [order.id]]);
  const central = await wh(env, "tab=stock&own=central");
  assert.ok(central.includes("สต็อกกลาง") && lots(central).length === 0);
  const ofOrders = await wh(env, "tab=stock&own=order");
  assert.deepEqual(lots(ofOrders), ["FN-A"]);
  assert.ok(!ofOrders.includes("<td>สต็อกกลาง</td>"));
  const filtered = await wh(env, "tab=stock&src=rb&q=ALFA");
  assert.match(filtered, /<a class="btn rf-btn secondary small" href="#\/wh\?tab=stock">ล้างตัวกรอง<\/a>/, "a clear link while filtered");
  assert.ok(!(await wh(env, "tab=stock")).includes("ล้างตัวกรอง"));
  assert.match(await wh(env, "tab=stock&src=rb"), /<select[^>]*name="src"[^>]*data-wh-filter[\s\S]*?<option value="rb" selected>/, "the filter keeps its value");
  // 100 rows a page
  const rf = env.rf.store.data();
  for (let i = 0; i < 130; i += 1) {
    const id = `FN-M${String(i).padStart(3, "0")}`;
    rf.lots.push({ ...rf.lots.find((row) => row.id === "FN-A"), id });
    rf.fgBoxes.push({ ...rf.fgBoxes.find((row) => row.lotId === "FN-A"), id: `BOX-M${i}`, lotId: id });
  }
  const page = await wh(env, "tab=stock&src=rb");
  assert.equal(lots(page).length, 100, "100 rows a page");
  assert.match(page, /href="#\/wh\?tab=stock&amp;src=rb&amp;n=200"[^>]*>แสดงเพิ่ม \(อีก 31\)<\/a>/, "the link for more keeps the filter");
  assert.equal(lots(await wh(env, "tab=stock&src=rb&n=200")).length, 131);
});

test("WH: the pending work is on the menu and on งานของฉัน — PK cards plus one card per RubberFlow lot waiting for WH, each opening the lot page; the count follows", async () => {
  const env = whEnv("staff");
  const html = await wh(env);
  assert.equal(h1Of(html), "งานของฉัน");
  const cards = cardsOf(html).filter((card) => card.includes("จาก RubberFlow"));
  assert.equal(cards.length, 1, "only FN-B waits: A is in, C went out, D is held for QC");
  assert.match(cards[0], /<h2><a class="bom-card-link" href="#\/wh\?lot=FN-B">รับกล่องเข้า WH ล็อต FN-B<\/a><\/h2>/);
  assert.match(cards[0], /20 pcs · 2 กล่อง/);
  assert.match(cards[0], /data-rf-action="receiveBoxes" data-rf-args="\{&quot;lotId&quot;:&quot;FN-B&quot;\}" data-rf-confirm="รับกล่องของล็อต FN-B เข้า WH ทั้ง 2 กล่อง\?/);
  const menu = navOf(env, "FACTORY_WH").items;
  assert.equal(menu.find((item) => item.label === "งานของฉัน").count, 1, "the menu number counts the lot card");
  // stock page: the menu already shows the count, so the head link is only for screens without the side menu (hidden from 1041 px by styles.css)
  assert.match(await wh(env, "tab=stock"), /<a class="btn rf-btn secondary small wh-work-link" href="#\/wh">งานของฉัน 1<\/a>/);
  assert.doesNotMatch(await wh(env, "tab=stock"), /งานที่รอ/);
  assert.match(fs.readFileSync("styles.css", "utf8"), /@media \(min-width: 1041px\) \{\s*\.wh-work-link \{ display: none; \}/, "wide screens hide it (the side menu is visible there)");
});

test("WH รับเข้า: PK goods per order with the receive form, close and close-short buttons, and one press per RubberFlow lot; the buttons are for the warehouse and admin only", async () => {
  const seen = {};
  for (const who of ["staff", "head", "admin", "planner", "manager"]) {
    const env = whEnv(who);
    const order = makeReceivable(env);
    const html = await wh(env, "tab=receive");
    seen[who] = html;
    assert.equal(h1Of(html), "รับเข้า");
    assert.ok(html.includes(`href="#/wh?order=${order.id}"`), `${who}: the order is listed and links to its page`);
    assert.match(html, /<h2>จาก RubberFlow \(กล่องรอรับเข้า\)<\/h2>/);
    assert.match(html, /FN-B/, `${who}: the lot waiting for WH`);
    assert.ok(!html.includes("FN-A"), `${who}: a lot already in is not listed`);
    const acts = ["staff", "head", "admin"].includes(who);
    assert.equal(count(html, /data-rf-form="receiveFg"/g) > 0, acts, `${who}: PK receive form`);
    assert.equal(count(html, /data-rf-action="receiveBoxes"/g), acts ? 1 : 0, `${who}: one press per lot`);
    assert.equal(count(html, /type="submit" data-rf-confirm="รับสินค้าเข้า WH ตามจำนวนที่กรอก/g) > 0, acts, `${who}: the confirm button`);
    assert.equal(/คลังสินค้า \(WH\) เป็นผู้รับสินค้าเข้าคลัง/.test(html), !acts, `${who}: the others are told who acts`);
  }
});

test("WH ส่งมอบ: PK goods per order with the delivery form, and RubberFlow boxes per lot with every box ticked; the forms are for the warehouse and admin only; reverse buttons only for the WH head and admin", async () => {
  for (const who of ["staff", "head", "admin", "planner", "manager"]) {
    const env = whEnv(who);
    const html = await wh(env, "tab=deliver");
    assert.equal(h1Of(html), "ส่งมอบ");
    const acts = ["staff", "head", "admin"].includes(who);
    assert.match(html, /FN-A/, `${who}: the lot in the warehouse`);
    assert.ok(!/FN-B|FN-C|FN-D/.test(html), `${who}: nothing else is deliverable`);
    assert.equal(count(html, /data-rf-form="shipBoxes"/g), acts ? 1 : 0, `${who}: ship form`);
    if (acts) {
      assert.equal(count(html, /<input type="checkbox" name="ids\[\]" value="BOX-A-00[123]" checked>/g), 3, "all three boxes ticked");
      assert.match(html, /data-rf-confirm="ส่งมอบกล่องที่เลือกของล็อต FN-A ให้ลูกค้า ALFA\?[^"]*">ส่งมอบให้ลูกค้า<\/button>/);
    } else assert.match(html, /คลังสินค้า \(WH\) เป็นผู้ส่งมอบสินค้าให้ลูกค้า/);
    assert.ok(!html.includes("boxReverse"), `${who}: no reverse here`);
  }
});

test("WH ประวัติ: newest first, both kinds, searchable and filterable; reverse buttons only for the WH head and admin, on rows that can still be reversed", async () => {
  const rows = (html) => html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g)?.filter((row) => row.includes("<td")) ?? [];
  for (const who of ["staff", "head", "admin", "planner", "manager"]) {
    const env = whEnv(who);
    const order = env.store.data().orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
    const code = env.context.MNP_BOM_RULES.fgPosition(env.store.data(), order).products[0].fgCode;
    env.store.data().fgMoves = [{ id: "g1", orderId: order.id, fgCode: code, kind: "receive", qty: 3, at: NOW - 5000, by: "สุดา คลังสินค้า" }];
    const html = await wh(env, "tab=history");
    assert.equal(h1Of(html), "ประวัติ");
    const list = rows(html);
    // newest first: the ship of FN-C (1h ago) and the receipt of FN-A (1h ago), then the older receipt of FN-C, and the PK receipt last-but-not-least by time
    const at = (needle) => list.findIndex((row) => row.includes(needle));
    assert.ok(at("ส่งมอบให้ลูกค้า") >= 0 && at("รับเข้า WH · 3 กล่อง") >= 0 && at("รับเข้า WH · 1 กล่อง") >= 0, `${who}: both kinds of RubberFlow rows`);
    assert.ok(list.some((row) => row.includes(escapeHtml(code)) && row.includes("รับเข้า WH")), `${who}: the PK receipt`);
    assert.ok(at("รับเข้า WH · 1 กล่อง") > at("ส่งมอบให้ลูกค้า"), `${who}: the older receipt of FN-C comes after the ship`);
    const head = ["head", "admin"].includes(who);
    // reversible: the PK receipt, the receipt of FN-A (boxes in stock), the ship of FN-C (box shipped)
    assert.equal(count(html, /data-rf-open="fgReverse"/g), head ? 1 : 0, `${who}: PK reverse`);
    assert.equal(count(html, /data-rf-open="boxReverse"/g), head ? 2 : 0, `${who}: box reverse (the receipt of FN-A and the ship of FN-C; the receipt of FN-C is not: its box went out)`);
  }
  const env = whEnv("staff");
  const base = await wh(env, "tab=history");
  const lotsIn = (html) => [...new Set([...html.matchAll(/ล็อต (FN-[A-Z])/g)].map((match) => match[1]))].sort();
  assert.deepEqual(lotsIn(base), ["FN-A", "FN-C"]);
  assert.deepEqual(lotsIn(await wh(env, "tab=history&q=ALFA")), ["FN-A", "FN-C"]);
  assert.deepEqual(lotsIn(await wh(env, "tab=history&kind=deliver")), ["FN-C"]);
  assert.match(await wh(env, "tab=history&q=ZZZ"), /ไม่พบรายการที่ค้นหา/);
});

test("WH: a reversed receipt or delivery shows faded with 'ถูกย้อน' and its reversal, and offers no second reverse", async () => {
  const env = whEnv("head");
  const ctx = env.context.MNP_BOM.context(new URLSearchParams("tab=history"));
  // reverse the delivery of FN-C (needs a reason) then its box is back in stock
  assert.equal(ctx.runAction("reverseBoxShip", { ids: ["BOX-C-001"], note: "ab" }, "x"), false, "a reason of 2 characters is refused");
  assert.match(env.log.toasts.at(-1)[0], /อย่างน้อย 3/);
  assert.equal(ctx.runAction("reverseBoxShip", { ids: ["BOX-C-001"], note: "ส่งผิดลูกค้า" }, "ย้อนแล้ว"), true);
  const box = env.rf.store.data().fgBoxes.find((row) => row.id === "BOX-C-001");
  assert.equal(box.status, "in_stock");
  const html = await wh(env, "tab=history");
  assert.match(html, /ย้อนการส่งมอบ · 1 กล่อง/);
  assert.match(html, /<div class="small muted">ส่งผิดลูกค้า<\/div>/, "the reason");
  assert.equal(count(html, />ถูกย้อน</g), 1, "the original ship is marked");
  assert.equal(count(html, /<tr class="row-link muted">/g), 1, "and faded");
});

test("WH actions on RubberFlow boxes go to the RubberFlow store through the page's action runner: receive a lot at once, ship ticked boxes, reverse with a reason", async () => {
  const env = whEnv("staff");
  const ctx = env.context.MNP_BOM.context(new URLSearchParams("tab=receive"));
  const boxes = (lotId) => env.rf.store.data().fgBoxes.filter((row) => row.lotId === lotId);
  assert.equal(ctx.runAction("receiveBoxes", { lotId: "FN-B" }, "รับเข้า WH ล็อต {result} แล้ว"), true);
  assert.deepEqual(boxes("FN-B").map((row) => row.status), ["in_stock", "in_stock"], "one press receives the whole lot");
  assert.equal(env.log.toasts.at(-1)[0], "รับเข้า WH ล็อต FN-B แล้ว");
  assert.equal(ctx.runAction("receiveBoxes", { lotId: "FN-B" }, ""), false, "a second press has nothing to receive");
  assert.equal(ctx.runAction("shipBoxes", { ids: ["BOX-B-001"] }, "ส่งมอบแล้ว"), true);
  assert.deepEqual(boxes("FN-B").map((row) => row.status), ["shipped", "in_stock"]);
  assert.equal(ctx.runAction("shipBoxes", { ids: [] }, ""), false, "no box ticked");
  // the ticked boxes of the form become the ids
  const transforms = env.context.MNP_BOM.transforms();
  assert.deepEqual(plain(transforms.shipBoxes({ "ids": ["a", "b"] })), { ids: ["a", "b"] });
  assert.deepEqual(plain(transforms.shipBoxes({})), { ids: [] });
  // the BOM store is not asked to run them
  assert.equal(env.store.data().audit?.some?.((entry) => entry.action === "receiveBoxes") ?? false, false);
});

test("WH: the reverse dialogs are for the WH head and admin: a receipt is reversed per lot and says why not when a box has left; a delivery per box; both need a reason of 3 to 300 characters", async () => {
  const dialogs = (env) => env.context.MNP_BOM_DIALOGS;
  const open = (env, args) => dialogs(env).boxReverse(env.context.MNP_BOM.context(new URLSearchParams("tab=history")), args);
  const staff = whEnv("staff");
  assert.equal(open(staff, { kind: "receipt", lotId: "FN-A" }), null, "WH staff cannot reverse");
  assert.equal(whEnv("planner") && open(whEnv("planner"), { kind: "receipt", lotId: "FN-A" }), null, "nor the planning group");
  for (const who of ["head", "admin"]) {
    const env = whEnv(who);
    const receipt = open(env, { kind: "receipt", lotId: "FN-A" }).html;
    assert.match(receipt, /data-rf-form="reverseBoxReceipt" data-rf-args="\{&quot;lotId&quot;:&quot;FN-A&quot;\}"/);
    assert.match(receipt, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
    assert.match(receipt, /name="note"[^>]*required[^>]*minlength="3" maxlength="300"/);
    assert.match(receipt, /กล่องทั้ง 3 กล่องของล็อตกลับไปรอ WH รับเข้าใหม่/);
    const ship = open(env, { kind: "ship", lotId: "FN-C", ids: ["BOX-C-001"] }).html;
    assert.match(ship, /data-rf-form="reverseBoxShip" data-rf-args="\{&quot;ids&quot;:\[&quot;BOX-C-001&quot;\]\}"/);
    // a lot with a box already out: a receipt cannot be reversed, and the dialog says so without a confirm button
    const rf = env.rf.store.data();
    rf.fgBoxes.find((row) => row.id === "BOX-A-003").status = "shipped";
    const blocked = open(env, { kind: "receipt", lotId: "FN-A" }).html;
    assert.match(blocked, /ย้อนการรับเข้าไม่ได้ \(ย้อนการส่งมอบกล่องนั้นก่อน\)/);
    assert.doesNotMatch(blocked, /data-rf-form=/);
  }
  assert.equal(open(whEnv("head"), { kind: "receipt", lotId: "FN-NONE" }), null, "an unknown lot gives no dialog");
  // toasts and confirmations: a space before แล้ว after "WH", and who may reverse (the WH manager or the admin)
  const head = whEnv("head");
  assert.match(open(head, { kind: "receipt", lotId: "FN-A" }).html, /data-rf-success="ย้อนการรับเข้า WH แล้ว"/);
  assert.match(open(head, { kind: "ship", lotId: "FN-C", ids: ["BOX-C-001"] }).html, /data-rf-success="ย้อนการส่งมอบแล้ว"/);
  makeReceivable(head);
  const pages = [await wh(head), await wh(head, "tab=receive"), await wh(head, "tab=deliver")].join("");
  assert.match(pages, /ถ้าบันทึกผิด ผู้จัดการแผนกคลังสินค้า \(WH\) หรือผู้ดูแลระบบย้อนได้/);
  assert.doesNotMatch(pages, /WHแล้ว|ย้อนได้โดยผู้จัดการแผนกคลังสินค้า \(WH\) เท่านั้น/);
});

test("WH งานของฉัน: receipts first (PK, then RubberFlow lots waiting for WH), then delivery; a card lists at most 5 lines plus how many more", async () => {
  const env = whEnv("staff");
  const receivable = makeReceivable(env);
  const data = env.store.data();
  // a closed order with goods in the warehouse that the customer still waits for = a delivery card
  const closed = data.orders.find((entry) => entry.id !== receivable.id && ["released", "in_progress"].includes(entry.status));
  const products = env.context.MNP_BOM_RULES.fgPosition(data, closed).products;
  for (const job of data.jobs.filter((entry) => entry.orderId === closed.id)) { job.qtyDone = job.qtyPlanned; job.status = "done"; }
  data.fgMoves = products.map((product, i) => ({ id: `d${i}`, orderId: closed.id, fgCode: product.fgCode, kind: "receive", qty: product.ordered, at: 1000, by: "x" }));
  closed.status = "completed";
  const cards = cardsOf(await wh(env));
  const at = (pattern) => cards.findIndex((card) => pattern.test(card));
  const pk = at(new RegExp(`รับสินค้าเข้า WH ตามใบ ${receivable.id}`));
  const rb = at(/รับกล่องเข้า WH ล็อต FN-B/);
  const deliver = at(new RegExp(`ส่งมอบให้ลูกค้าตามใบ ${closed.id}`));
  assert.ok(pk >= 0 && rb >= 0 && deliver >= 0, JSON.stringify({ pk, rb, deliver }));
  assert.ok(pk < rb && rb < deliver, "PK receipt, then the RubberFlow lot, then the delivery");
  // the same order on the BOM side: receipts before deliveries
  const kinds = env.context.MNP_BOM_PAGES.hub.fgTasks(env.context.MNP_BOM.context(new URLSearchParams())).map((task) => task.kind);
  assert.ok(kinds.indexOf("fgReceive") < kinds.indexOf("fgDeliver"), kinds.join());
  // 40 codes on one order: 5 lines and "อีก 35 รายการ" (the card opens the order page with every line)
  const hub = env.context.MNP_BOM_PAGES.hub;
  const lines = Array.from({ length: 40 }, (_, i) => ({ fgCode: `FG-${String(i).padStart(2, "0")}`, qty: 1 }));
  const card = hub.taskCard(env.context.MNP_BOM.context(new URLSearchParams()), { kind: "fgReceive", order: receivable, lines }, { planner: false, dept: "WH" });
  assert.equal(count(card, /<li>/g), 5);
  assert.match(card, /<p class="small muted">อีก 35 รายการ<\/p>/);
  assert.ok(!card.includes("FG-05"), "the sixth code is not drawn");
  const five = hub.taskCard(env.context.MNP_BOM.context(new URLSearchParams()), { kind: "fgDeliver", order: closed, lines: lines.slice(0, 5) }, { planner: false, dept: "WH" });
  assert.equal(count(five, /<li>/g), 5);
  assert.doesNotMatch(five, /อีก \d+ รายการ/, "five lines need no remainder");
});

test("WH รับเข้า: jump buttons to the PK and RB sections only when both have something waiting; the sections are focusable targets", async () => {
  const env = whEnv("staff");
  makeReceivable(env);
  const html = await wh(env, "tab=receive");
  const pk = count(html, /data-rf-form="receiveFg"/g);
  assert.match(html, /<nav class="rf-row wh-jump" aria-label="ไปยังส่วน">/);
  assert.match(html, new RegExp(`<button type="button" class="btn rf-btn secondary small" data-wh-jump="wh-receive-pk">จาก PK ${pk} ใบ</button>`));
  assert.match(html, /<button type="button" class="btn rf-btn secondary small" data-wh-jump="wh-receive-rb">จาก RB 1 ล็อต<\/button>/);
  assert.ok(html.indexOf("wh-jump") < html.indexOf('id="wh-receive-pk"') && html.indexOf('id="wh-receive-pk"') < html.indexOf('id="wh-receive-rb"'));
  assert.match(html, /<div id="wh-receive-rb" class="wh-jump-target" tabindex="-1">[\s\S]*?<h2>จาก RubberFlow \(กล่องรอรับเข้า\)<\/h2>/, "the RB heading itself carries no count");
  // nothing waiting from RB: no jump buttons
  env.rf.store.data().fgBoxes.filter((box) => box.status === "pending_wh").forEach((box) => { box.status = "in_stock"; });
  assert.doesNotMatch(await wh(env, "tab=receive"), /data-wh-jump/);
  assert.match(fs.readFileSync("styles.css", "utf8"), /\.wh-jump-target \{ scroll-margin-top: 80px; \}/, "the target clears the sticky top bar");
});

test("WH: the lot page shows the facts, every box with its state, the ship form and the history; the order page shows the PK receive and delivery panels and its own history; unknown ones say so", async () => {
  const env = whEnv("staff");
  const html = await wh(env, "lot=FN-A");
  assert.equal(h1Of(html), "ล็อต FN-A");
  assert.match(html, /<a class="request-back-link" href="#\/wh\?tab=stock">‹ ในคลัง<\/a>/);
  assert.match(html, /ใบ PO-A · ALFA/);
  assert.match(html, /ส่งมอบให้ลูกค้าผ่าน WH/);
  assert.match(html, /อยู่ในคลัง 3/, "boxes by state");
  assert.equal(count(html, /<td><span class="rf-mono">BOX-A-00\d<\/span><\/td>/g), 3);
  assert.match(html, /data-rf-form="shipBoxes"/, "WH staff can ship from the lot page");
  assert.ok(!/data-rf-open="boxReverse"/.test(html), "and cannot reverse");
  // show once: the ship card on the lot page has a short title; lot, product, customer and quantity are in the head and the facts already
  const shipCard = html.slice(html.lastIndexOf("<section", html.indexOf('data-rf-form="shipBoxes"')), html.indexOf("</form>", html.indexOf('data-rf-form="shipBoxes"')));
  assert.match(shipCard, /<h2>ส่งมอบให้ลูกค้า<\/h2>/);
  assert.doesNotMatch(shipCard, /P-ALFA|PO-A|30 pcs|3 กล่อง/, "no second copy of the facts");
  assert.equal(count(html, /ใบ PO-A · ALFA/g), 1, "the customer shows once on the lot page");
  assert.match(await wh(env, "tab=deliver"), /ล็อต FN-A<\/a> <span class="small muted">P-ALFA · ใบ PO-A · ALFA · 30 pcs · 3 กล่อง<\/span>/, "the deliver list keeps them: it is the only place there");
  // reprint a box label: one button per box for WH and admin, opening the RubberFlow tag dialog
  assert.equal(count(html, /data-rf-open="boxTag" data-rf-args="\{&quot;id&quot;:&quot;BOX-A-00\d&quot;\}"[^>]*aria-label="พิมพ์ป้าย BOX-A-00\d"[^>]*>ป้าย<\/button>/g), 3);
  const pending = await wh(env, "lot=FN-B");
  assert.match(pending, /data-rf-action="receiveBoxes"/, "a lot waiting for WH has the receive button");
  assert.match(pending, /รอ WH รับเข้า 2/);
  assert.match(await wh(env, "lot=FN-NONE"), /ไม่พบล็อตนี้/);
  const head = whEnv("head");
  assert.match(await wh(head, "lot=FN-A"), /data-rf-open="boxReverse" data-rf-args="\{&quot;kind&quot;:&quot;receipt&quot;,&quot;lotId&quot;:&quot;FN-A&quot;\}"[^>]*>ย้อนการรับเข้า<\/button>/, "the head can reverse the receipt of a lot whose boxes are all in");
  const order = env.store.data().orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  const orderPage = await wh(env, `order=${order.id}`);
  assert.equal(h1Of(orderPage), `ใบ ${order.id}`);
  assert.match(orderPage, /<h2>รับเข้า WH<\/h2>/);
  assert.match(orderPage, /<h2>ส่งมอบให้ลูกค้า<\/h2>/);
  assert.match(await wh(env, "order=NOPE-1"), /ไม่พบใบสั่งผลิตนี้/);
  assert.match(await wh(env, "order=DEMO-DRAFT-NONE"), /ไม่พบใบสั่งผลิตนี้/);
});

test("WH: a box label is reprinted from the lot page with the RubberFlow tag dialog, by WH and admin only; others see no ship card and no label button", async () => {
  for (const who of ["staff", "head", "admin"]) {
    const env = whEnv(who);
    const ctx = env.context.MNP_BOM.context(new URLSearchParams("lot=FN-A"));
    const built = env.context.MNP_BOM_DIALOGS.boxTag(ctx, { id: "BOX-A-002" });
    assert.ok(built?.html, `${who}: the dialog opens`);
    const rfBuilt = env.context.MNP_RUBBERFLOW_DIALOGS.tag(env.rf.context(new URLSearchParams()), { kind: "box", id: "BOX-A-002" });
    // the same dialog as RubberFlow (only the print time may differ)
    const strip = (text) => text.replace(/พิมพ์เมื่อ [^<]*/, "");
    assert.equal(strip(built.html), strip(rfBuilt.html), `${who}: no second copy of the label`);
    assert.match(built.html, /ป้ายติดตามงาน \(Traveler Tag\)/);
    assert.match(built.html, /<div class="rf-tag-code rf-mono">BOX-A-002<\/div>/);
    assert.match(built.html, /data-rf-print/);
    assert.equal(typeof built.bind, "function", `${who}: the print button is wired`);
    assert.equal(env.context.MNP_BOM_DIALOGS.boxTag(ctx, { id: "BOX-NONE" }), null, "an unknown box gives no dialog");
  }
  for (const who of ["planner", "manager"]) {
    const env = whEnv(who);
    const html = await wh(env, "lot=FN-A");
    assert.doesNotMatch(html, /data-rf-open="boxTag"/, `${who}: no label button`);
    assert.doesNotMatch(html, /data-rf-form="shipBoxes"|คลังสินค้า \(WH\) เป็นผู้ส่งมอบ/, `${who}: no ship card (the boxes are in the table)`);
    assert.equal(env.context.MNP_BOM_DIALOGS.boxTag(env.context.MNP_BOM.context(new URLSearchParams("lot=FN-A")), { id: "BOX-A-002" }), null, `${who}: the dialog refuses`);
  }
});

test("the old places keep no second copy: the order page in BOM has no receive, delivery, close or reverse controls; the RubberFlow finished-goods tab is one link; the ST store has no finished-goods table", async () => {
  const env = whEnv("admin");
  assert.equal(env.context.MNP_BOM_PAGES.stock, undefined, "BOM's purchased-parts page moved to the ST module");
  const stock = await env.open("FACTORY_ST", "tab=stock");
  assert.doesNotMatch(stock, /สินค้าสำเร็จรูปคงคลัง|อยู่ในคลัง<\/th>|สต็อกสินค้าสำเร็จรูป<\/th>/, "the finished-goods stock list is the warehouse's");
  const source = (file) => fs.readFileSync(file, "utf8");
  const hub = source("modules/bom-hub.js");
  assert.doesNotMatch(hub, /data-rf-form="receiveFg"|data-rf-form="deliverFg"|dialogs\.fgReverse|dialogs\.closeShort|function receivePanel|function deliverPanel|bindDeliverOver/, "BOM's order page keeps no receive/delivery panel or dialog");
  assert.match(source("modules/wh-pages.js"), /dialogs\.fgReverse = /);
  assert.match(source("modules/wh-pages.js"), /dialogs\.closeShort = /);
  const plan = source("modules/rubberflow-pages-plan.js");
  assert.doesNotMatch(plan, /data-rf-form="shipBoxes"|name="ids\[\]"/, "RubberFlow ships nothing any more");
  // the audit page knows the new labels
  const audit = source("modules/bom-pages.js");
  for (const action of ["receiveBoxes", "shipBoxes", "reverseBoxReceipt", "reverseBoxShip"]) { assert.ok(audit.includes(`"rubberflow:${action}"`), `BOM audit label ${action}`); assert.ok(plan.includes(`${action}:`), `RubberFlow audit label ${action}`); }
});

test("wording: no bare 'รับเข้าคลัง' in the RubberFlow finishing form or the warehouse module, and the warehouse module uses ยางเส้นยาว and never แท่ง", () => {
  for (const file of ["modules/wh-pages.js", "modules/module-wh.js"]) {
    const code = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((line) => !line.trimStart().startsWith("//")).join("\n");
    assert.doesNotMatch(code, /รับเข้าคลัง|แท่ง/, file);
  }
  const line = fs.readFileSync("modules/rubberflow-pages-line.js", "utf8").split(/\r?\n/);
  const start = line.findIndex((row) => row.includes("pages.finishing = (ctx)"));
  const end = line.findIndex((row, index) => index > start && row.includes("// ---------- ส่งมอบ WIP"));
  const finishing = line.slice(start, end).filter((row) => !row.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(finishing, /รับเข้าคลัง/, "the finishing page");
});

test("RubberFlow finishing list: each lot sent to the customer through WH shows where it is — รอ WH รับเข้า, WH รับแล้ว, ส่งมอบแล้ว — and a held lot shows none; the badge links to the lot page for those who can open WH", async () => {
  const env = whEnv("staff");
  const page = () => env.context.MNP_RUBBERFLOW_PAGES.finishing(env.rf.context(new URLSearchParams("p=finishing"))).html;
  const rowOf = (html, lotId) => (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) ?? []).find((row) => row.includes(`>${lotId}<`)) ?? "";
  const html = page();
  assert.match(rowOf(html, "FN-B"), /<span class="rf-badge is-warn">รอ WH รับเข้า<\/span>/);
  assert.match(rowOf(html, "FN-A"), /<span class="rf-badge is-good">WH รับแล้ว<\/span>/);
  assert.match(rowOf(html, "FN-C"), /<span class="rf-badge">ส่งมอบแล้ว<\/span>/);
  assert.ok(!rowOf(html, "FN-D").includes("data-rf-wh-state"), "a held lot has no WH state yet");
  assert.match(rowOf(html, "FN-B"), /<a href="#\/wh\?lot=FN-B" title="[^"]*">/, "the warehouse's lot page, for someone who can open the module");
  // one of two boxes out: the rest is still in the warehouse
  const rf = env.rf.store.data();
  rf.fgBoxes.find((row) => row.id === "BOX-A-001").status = "shipped";
  assert.match(rowOf(page(), "FN-A"), /WH รับแล้ว · ส่งมอบแล้ว 1\/3/);
});
