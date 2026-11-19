import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// เมนูกลุ่ม "โรงงาน" และโมดูลรายแผนก (modules/factory-kit.js registerDeptModule · module-st / sr / qa / gr / pt / bg / pk / wh.js)
// โหลดโมดูล BOM + RubberFlow + โมดูลแผนกทั้งแปดเข้า context จำลอง แล้วตรวจ: ลำดับเมนูตามผังงานใต้หัวกลุ่มเดียว · ใครเห็นโมดูลไหน (ผ่าน/ไม่ผ่าน)
// · ประตูโหมดทดสอบ (ใช้ usesBom ตัวเดียวกับ BOM) · หน้าปฏิเสธนอกโหมดทดสอบ · หน้าแรกของแต่ละแผนกวาดจากข้อมูลสาธิตของ BOM และ RubberFlow
const FILES = [
  "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/factory-kit.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
  "modules/module-st.js", "modules/module-sr.js", "modules/module-qa.js", "modules/module-gr.js", "modules/module-pt.js", "modules/module-bg.js", "modules/module-pk.js", "modules/module-wh.js",
];
const DEPT_FILES = ["st", "sr", "qa", "gr", "pt", "bg", "pk", "wh"].map((dept) => `modules/module-${dept}.js`);
const ALL_DEPTS = ["FACTORY_ST", "FACTORY_SR", "FACTORY_QA", "FACTORY_GR", "FACTORY_PT", "FACTORY_BG", "FACTORY_PK", "FACTORY_WH"];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const read = (file) => fs.readFileSync(file, "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

// พนักงาน/บัญชีทดสอบ: แผนก + ตำแหน่ง (employee = พนักงานทั่วไป)
const emp = (dept, role = "employee", extra = {}) => ({ department: { code: dept }, role: { code: role }, isSandbox: true, ...extra });

function load({ employee = emp("PP"), route = "" } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { renders: 0, notFound: 0, hash: `#/${route}`, toasts: [], listeners: {} };
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
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic() },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  for (const file of FILES) vm.runInContext(read(file), context, { filename: file });
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

const labelsOf = (html) => [...html.matchAll(/<a href="#\/([^"]+)">([^<]+)<\/a>/g)].map((match) => match[2]);
const DEPT_LABELS = Object.freeze({ FACTORY_ST: "คลังวัตถุดิบ (ST)", FACTORY_SR: "คลังยางเส้นยาว (SR)", FACTORY_QA: "ตรวจคุณภาพ (QA)", FACTORY_GR: "แปรรูปยาง (GR)", FACTORY_PT: "ขึ้นรูปพลาสติก (PT)", FACTORY_BG: "เย็บจักร (BG)", FACTORY_PK: "ประกอบและบรรจุ (PK)", FACTORY_WH: "คลังสินค้าสำเร็จรูป (WH)" });
const seen = (env, employee) => { env.setEmployee(employee); const links = labelsOf(env.nav()); return ALL_DEPTS.filter((code) => links.includes(DEPT_LABELS[code])); };

test("registerDeptModule writes one sandbox-only standalone module per department into the factory group, numbered by the work tree", () => {
  const env = load();
  const flow = env.context.MNP_BOM_RULES.PROCESS_FLOW;
  for (const [code, dept, route, palette] of [["FACTORY_ST", "ST", "st"], ["FACTORY_SR", "SR", "sr"], ["FACTORY_QA", "QA", "qa"], ["FACTORY_GR", "GR", "gr"], ["FACTORY_PT", "PT", "pt"], ["FACTORY_BG", "BG", "bg"], ["FACTORY_PK", "PK", "pk"], ["FACTORY_WH", "WH", "wh"]]) {
    const entry = env.modules[code];
    assert.equal(entry.palette, palette ?? route, `${code} uses its department palette`);
    assert.equal(entry.enabled, true);
    assert.equal(entry.standalone, true);
    assert.equal(entry.sandbox, true);
    assert.equal(entry.dept, dept);
    assert.equal(entry.label, DEPT_LABELS[code]);
    assert.equal(entry.nav.length, 1);
    assert.equal(entry.nav[0].path, route);
    assert.equal(entry.nav[0].sandboxOnly, true);
    assert.equal(entry.nav[0].realOnly, undefined);
    assert.equal(entry.nav[0].group, "โรงงาน");
    assert.equal(entry.nav[0].flowNo, flow.find((step) => step.dept === dept).no);
    assert.match(entry.nav[0].icon, /<svg/);
    assert.deepEqual(plain(Object.keys(entry.pages)), [route]);
  }
  // BOM และ RubberFlow ย้ายรายการโหมดทดสอบมาอยู่กลุ่มเดียวกัน (PP = 2, RB = 4) ส่วนรายการใช้งานจริงเดิม
  const bom = env.modules.BOM.nav;
  const rubberflow = env.modules.RUBBERFLOW.nav;
  assert.deepEqual(plain(bom.map((item) => [item.sandboxOnly ?? false, item.realOnly ?? false, item.group, item.flowNo ?? null])), [[true, false, "โรงงาน", flow.find((step) => step.dept === "PP").no], [false, true, "การผลิต", null]]);
  assert.deepEqual(plain(rubberflow.map((item) => [item.sandboxOnly ?? false, item.realOnly ?? false, item.group, item.flowNo ?? null])), [[true, false, "โรงงาน", flow.find((step) => step.dept === "RB").no], [false, true, "การผลิต", null]]);
  assert.equal(env.context.MNP_FACTORY.FACTORY_GROUP, "โรงงาน");
  assert.throws(() => env.context.MNP_FACTORY.registerDeptModule({ code: "FACTORY_SR", dept: "SR", route: "sr", label: "x", landing: () => ({ html: "" }) }), /ลงทะเบียนแล้ว/);
  assert.throws(() => env.context.MNP_FACTORY.registerDeptModule({ code: "X" }), /จำเป็น/);
});

test("the factory group reads PP (BOM) · ST · RB (RubberFlow) · SR · QA · GR · PT · BG · PK · WH under one header, whatever the script order", () => {
  const env = load({ employee: emp("PP") });
  const html = env.nav();
  assert.equal([...html.matchAll(/nav-group-label/g)].length, 1, "one header for the whole group");
  assert.match(html, /^<div class="nav-label nav-group-label">โรงงาน<\/div>/);
  const expected = ["BOM รายแผนก", "คลังวัตถุดิบ (ST)", "RubberFlow (แผนก RB)", "คลังยางเส้นยาว (SR)", "ตรวจคุณภาพ (QA)", "แปรรูปยาง (GR)", "ขึ้นรูปพลาสติก (PT)", "เย็บจักร (BG)", "ประกอบและบรรจุ (PK)", "คลังสินค้าสำเร็จรูป (WH)"];
  assert.deepEqual(labelsOf(html), expected);
  // กลับลำดับการลงทะเบียน: ผลต้องเหมือนเดิม
  const modules = env.modules;
  const reversed = Object.fromEntries(Object.entries(modules).reverse());
  for (const key of Object.keys(modules)) delete modules[key];
  Object.assign(modules, reversed);
  assert.deepEqual(labelsOf(env.nav()), expected);
  assert.equal([...env.nav().matchAll(/nav-group-label/g)].length, 1);
  // ไม่มีหัวกลุ่ม "ทดสอบ" ค้างอยู่
  assert.doesNotMatch(env.nav(), /ทดสอบ/);
  // app.js เรียกตัวเรียงจริง
  assert.match(read("app.js"), /return window\.MNP_FACTORY\.orderNavItems\(items\)/);
});

test("orderNavItems: sorts a group by flowNo (items without one last), leaves other groups and group-less items where they were", () => {
  const { orderNavItems } = load().context.MNP_FACTORY;
  const items = [{ path: "a" }, { path: "g3", group: "G", flowNo: 3 }, { path: "b" }, { path: "g1", group: "G", flowNo: 1 }, { path: "h2", group: "H" }, { path: "g9", group: "G" }, { path: "h1", group: "H" }, { path: "g2", group: "G", flowNo: 2 }];
  assert.deepEqual(plain(orderNavItems(items).map((item) => item.path)), ["a", "g1", "g2", "g3", "g9", "b", "h2", "h1"]);
  assert.deepEqual(plain(orderNavItems([])), []);
});

test("each department sees only its own module, in test mode; PP and the managers see all of them; BOM and RubberFlow stay visible to everyone in test mode", () => {
  const env = load();
  const OWN = { ST: "FACTORY_ST", SR: "FACTORY_SR", QA: "FACTORY_QA", GR: "FACTORY_GR", PT: "FACTORY_PT", BG: "FACTORY_BG", PK: "FACTORY_PK", WH: "FACTORY_WH" };
  for (const [dept, code] of Object.entries(OWN)) {
    assert.deepEqual(seen(env, emp(dept)), [code], `${dept} staff see only ${dept}`);
    assert.deepEqual(seen(env, emp(dept, "department_manager")), [code], `${dept} department head sees only ${dept}`);
    assert.deepEqual(seen(env, emp(dept, "assistant_department_manager")), [code], `${dept} assistant head sees only ${dept}`);
  }
  for (const dept of ["RB", "MT", "HR", "IT", "SA"]) {
    assert.deepEqual(seen(env, emp(dept)), [], `${dept} staff see none of them`);
    assert.deepEqual(seen(env, emp(dept, "department_manager")), [], `${dept} head sees none of them`);
  }
  for (const person of [emp("PP"), emp("PP", "department_manager"), emp("MT", "admin"), emp("MT", "general_manager"), emp("PK", "factory_manager"), emp("PK", "assistant_factory_manager")]) {
    assert.deepEqual(seen(env, person), ALL_DEPTS, `${person.department.code} ${person.role.code} sees all of them`);
  }
  // BOM และ RubberFlow ไม่เปลี่ยนสิทธิ์การเห็น: ทุกบัญชีทดสอบเห็นทั้งสอง
  for (const person of [emp("SR"), emp("RB"), emp("MT", "department_manager"), emp("ID")]) {
    env.setEmployee(person);
    const links = labelsOf(env.nav());
    assert.ok(links.includes("BOM รายแผนก") && links.includes("RubberFlow (แผนก RB)"), `${person.department.code} keeps BOM and RubberFlow`);
  }
  // snake_case จากแถวพนักงานก็อ่านได้
  assert.deepEqual(seen(env, { department_code: "sr", role_code: "employee", isSandbox: true }), ["FACTORY_SR"]);
  assert.deepEqual(seen(env, null), []);
});

test("the Indesign department never sees any of them, admin included (department-access), while the other restricted-free departments are unchanged", () => {
  const env = load();
  assert.deepEqual(seen(env, emp("ID")), []);
  assert.deepEqual(seen(env, emp("ID", "admin")), []);
  assert.deepEqual(seen(env, emp("ID", "factory_manager")), []);
  const { canSeeDept, canOpenDeptModule } = env.context.MNP_FACTORY;
  for (const [code, dept] of [["FACTORY_ST", "ST"], ["FACTORY_SR", "SR"], ["FACTORY_QA", "QA"], ["FACTORY_GR", "GR"], ["FACTORY_PT", "PT"], ["FACTORY_BG", "BG"], ["FACTORY_PK", "PK"], ["FACTORY_WH", "WH"]]) {
    assert.equal(canSeeDept(emp("ID", "admin"), dept, code), false);
    assert.equal(canSeeDept(emp("ID", "admin"), dept), false, "without a module code a restricted department is still refused");
    assert.equal(canSeeDept(emp("MT", "admin"), dept, code), true);
    assert.equal(env.context.MNP_DEPARTMENT_ACCESS.moduleAllowed(emp("ID"), code), false, "department-access keeps them off the Indesign list");
  }
  assert.equal(canSeeDept(null, "SR"), false);
  assert.equal(canOpenDeptModule(emp("ID", "admin"), "SR", "FACTORY_SR"), false);
});

test("outside test mode nobody sees any of them, not admin, not PP, not the managers (the same gate as BOM: usesBom)", async () => {
  const env = load();
  for (const person of [emp("PP", "employee", { isSandbox: false }), emp("MT", "admin", { isSandbox: false }), emp("PK", "factory_manager", { isSandbox: false }), emp("SR", "employee", { isSandbox: false }), emp("SR", "employee", { isSandbox: undefined })]) {
    assert.equal(env.context.MNP_BOM_STORE.usesBom(person), false, "BOM itself is closed there");
    assert.deepEqual(seen(env, person), [], `${person.department.code} ${person.role.code}`);
    for (const code of ALL_DEPTS) assert.equal(env.modules[code].navAllowed(person), false);
    // เมนูของ BOM/RubberFlow ใช้งานจริงก็ยังปิด (REAL_STAFF_OPEN)
    assert.deepEqual(labelsOf(env.nav()).filter((label) => label !== "BOM รายแผนก" && label !== "RubberFlow (แผนก RB)" && label !== undefined), []);
  }
  // หน้าปฏิเสธนอกโหมดทดสอบ แม้พิมพ์ URL เอง
  for (const code of ALL_DEPTS) {
    env.log.notFound = 0;
    env.setEmployee(emp("PP", "admin", { isSandbox: false }));
    await env.open(code);
    assert.equal(env.log.notFound, 1, `${code} refuses outside test mode`);
  }
  // และไม่ใช่แผนกของตัวเองในโหมดทดสอบ
  env.setEmployee(emp("SR"));
  for (const code of ALL_DEPTS.filter((entry) => entry !== "FACTORY_SR")) {
    env.log.notFound = 0;
    await env.open(code);
    assert.equal(env.log.notFound, 1, `SR staff typing the ${code} URL gets not found`);
  }
  env.log.notFound = 0;
  assert.match(await env.open("FACTORY_SR"), /<shell path="sr" title="คลังยางเส้นยาว \(SR\)">/);
  assert.equal(env.log.notFound, 0);
});

test("the pages for a department use no 'แท่งยาว' wording, escape what they print and only link to where the work lives", async () => {
  for (const file of DEPT_FILES) assert.doesNotMatch(read(file), /แท่งยาว/, `${file} says ยางเส้นยาว, not แท่งยาว`);
  const env = load({ employee: emp("PP") });
  const pages = {};
  for (const code of ALL_DEPTS) pages[code] = await env.open(code);
  for (const [code, html] of Object.entries(pages)) {
    assert.doesNotMatch(html, /แท่งยาว|undefined|NaN|\[object Object\]|ยังไม่เปิด|เร็วๆ นี้|coming soon/i, code);
    assert.doesNotMatch(html, /<script/i, code);
    assert.match(html, /data-module="(st|sr|qa|gr|pt|bg|pk|wh)"/);
    // ทุกแผนกสั่งงานผ่านปุ่มของการ์ดที่เปิด dialog (ดูการทดสอบ "…same cards") · ฟอร์มสั่งงานอยู่ใน dialog ไม่ได้อยู่ในหน้า
    assert.doesNotMatch(html, /<form[^>]*data-rf-form/, `${code} has no action form on the page itself`);
  }
  assert.match(pages.FACTORY_SR, /href="#\/bom\?p=work&amp;dept=SR"/);
  assert.match(pages.FACTORY_ST, /href="#\/bom\?p=work&amp;dept=ST"/);
  assert.match(pages.FACTORY_WH, /href="#\/bom\?p=work&amp;dept=WH"/);
  assert.match(pages.FACTORY_GR, /href="#\/bom\?p=work&amp;dept=GR"/);
  assert.match(pages.FACTORY_QA, /href="#\/bom\?p=work&amp;dept=QA"/);
  assert.match(pages.FACTORY_QA, /href="#\/rubberflow\?p=quality"/);
});

test("SR opens on the rods in the store: stored lots with code, name, quantity, lot, received date and order or central stock, searchable; rod tasks come after", async () => {
  const env = load({ employee: emp("SR") });
  const lots = env.store.data().rodLots;
  const stored = lots.filter((lot) => lot.status === "stored");
  const pending = lots.filter((lot) => lot.status === "pending");
  assert.ok(stored.length >= 2 && pending.length >= 1, "the demo seed has stored and pending rod lots");
  env.store.setUser("B11"); // SR
  const html = await env.open("FACTORY_SR");
  for (const lot of stored) assert.ok(html.includes(escapeHtml(lot.lotNo)), `stored lot ${lot.lotNo} is listed`);
  assert.match(html, /สต็อกกลาง/);
  assert.match(html, /href="#\/bom\?p=orders&amp;sel=DEMO-26006"/, "rods held for an order link to that order");
  assert.ok(html.indexOf("ยางเส้นยาวในคลัง") < html.indexOf("งานที่รอ"), "the store comes first, the tasks after");
  // ล็อตที่รอรับเข้าอยู่ในงานที่รอ ไม่ใช่ในของในคลัง
  const stockPart = html.slice(0, html.indexOf("งานที่รอ"));
  for (const lot of pending) assert.ok(!stockPart.includes(escapeHtml(lot.lotNo)), "a pending lot is not stock yet");
  assert.match(html, /รอรับเข้าคลัง/);
  assert.match(html, /<form[^>]*class="rf-search" data-rf-search/);
  // ค้นหา: เลขล็อต / รหัสที่ไม่มี
  const one = await env.open("FACTORY_SR", `q=${encodeURIComponent(stored[0].lotNo)}`);
  assert.ok(one.includes(escapeHtml(stored[0].lotNo)));
  assert.ok(!one.includes(escapeHtml(stored[1].lotNo)), "the search narrows the list");
  assert.match(await env.open("FACTORY_SR", "q=ZZZ-NONE"), /ไม่พบเส้นยางที่ค้นหา/);
  // ช่องค้นหาไปที่หน้านี้เอง (#/sr?q=) ผ่านตัวผูกกลาง
  const form = { handlers: {}, dataset: {}, __values: { q: "  FN-26  " }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["form[data-rf-search]"] = [form];
  await env.open("FACTORY_SR");
  form.handlers.submit({ preventDefault() {} });
  assert.equal(env.log.hash, "#/sr?q=FN-26");
});

test("ST opens on the purchased items in stock (quantity, safety stock, low flag), searchable, then the store tasks", async () => {
  const env = load({ employee: emp("ST") });
  env.store.setUser("B08");
  const data = env.store.data();
  const purchased = data.items.filter((item) => item.kind === "PURCHASED");
  assert.ok(purchased.length >= 2);
  data.stock = [{ itemCode: purchased[0].code, qty: 3, safetyQty: 10 }, { itemCode: purchased[1].code, qty: 50, safetyQty: 10 }];
  const html = await env.open("FACTORY_ST");
  for (const item of purchased) assert.ok(html.includes(escapeHtml(item.code)), `${item.code} is listed`);
  assert.equal([...html.matchAll(/ต่ำกว่าขั้นต่ำ/g)].length, 1, "only the item under its safety stock is flagged");
  assert.ok(html.indexOf("ของซื้อในคลัง") < html.indexOf("งานที่รอ"));
  const one = await env.open("FACTORY_ST", `q=${encodeURIComponent(purchased[1].code)}`);
  assert.ok(one.includes(escapeHtml(purchased[1].code)) && !one.includes(`<span class="rf-mono">${escapeHtml(purchased[0].code)}</span>`));
  assert.match(await env.open("FACTORY_ST", "q=ZZZ-NONE"), /ไม่พบของซื้อที่ค้นหา/);
});

test("WH opens on the finished goods in stock per code, with the orders that hold them, then the receive and deliver tasks", async () => {
  const env = load({ employee: emp("WH") });
  env.store.setUser("B09");
  assert.match(await env.open("FACTORY_WH"), /ยังไม่มีสินค้าสำเร็จรูปในคลัง|<table/);
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  const fgCode = data.items.find((item) => item.kind === "FG").code;
  data.fgMoves = [{ id: "m1", orderId: order.id, fgCode, kind: "receive", qty: 12, at: 1, by: "x" }, { id: "m2", orderId: order.id, fgCode, kind: "deliver", qty: 2, at: 2, by: "x" }];
  const html = await env.open("FACTORY_WH");
  assert.ok(html.includes(escapeHtml(fgCode)));
  assert.match(html, /10/);
  assert.ok(html.includes(`>${escapeHtml(order.id)}</a>`), "the order that holds the goods is linked");
  assert.ok(html.indexOf("สินค้าสำเร็จรูปในคลัง") < html.indexOf("งานที่รอ"));
  assert.match(await env.open("FACTORY_WH", "q=ZZZ-NONE"), /ไม่พบสินค้าสำเร็จรูปที่ค้นหา/);
});


// ---- แผนกผลิต (GR PT BG PK): หน้าแรกสั่งงานได้เหมือน BOM "งานของฉัน" ----
const ROUTE = { FACTORY_GR: "gr", FACTORY_PT: "pt", FACTORY_BG: "bg", FACTORY_PK: "pk" };
const liveOrder = (data, job) => ["released", "in_progress", "completed"].includes(data.orders.find((order) => order.id === job.orderId)?.status);
// ปุ่มต่อการ์ด (ตามลำดับการ์ด): ชื่อ dialog / action ที่การ์ดเสนอ · เทียบกับการ์ดเดียวกันที่หน้า BOM
const buttonsByCard = (html) => html.split('<article class="card rf-card bom-job').slice(1).map((card) => [...card.matchAll(/data-rf-(?:open|action)="(\w+)"/g)].map((match) => match[1]));

test("GR shows its open jobs on the shared job card with the same buttons as BOM งานของฉัน: report, hold, and close for a planner", async () => {
  const staff = load({ employee: emp("GR") });
  staff.store.setUser("B05");
  const data = staff.store.data();
  const open = data.jobs.filter((job) => job.dept === "GR" && liveOrder(data, job) && job.status !== "done");
  assert.ok(open.length >= 1, "the demo data has an open GR job on a released order");
  const html = await staff.open("FACTORY_GR");
  assert.equal([...html.matchAll(/class="card rf-card bom-job/g)].length, open.length, "one card per open GR job");
  for (const job of open) assert.ok(html.includes(escapeHtml(job.name)));
  assert.match(html, /data-rf-open="jobReport"/);
  assert.match(html, /data-rf-open="jobHold"/);
  assert.doesNotMatch(html, /data-rf-open="jobClose"/, "staff cannot close a job");
  assert.doesNotMatch(html, /แท่งยาว/);
  assert.match(html, /href="#\/bom\?p=work&amp;dept=GR"/, "the link to BOM งานของฉัน stays");
  // เหมือนการ์ดเดียวกันที่หน้า BOM งานของฉัน ของผู้ใช้คนเดียวกัน
  const work = await staff.context.MNP_BOM_PAGES.work(staff.context.MNP_BOM.context(new URLSearchParams("p=work")));
  assert.deepEqual(plain(buttonsByCard(html)), plain(buttonsByCard(work.html)), "the dept page offers exactly what BOM work offers for this user");
  // ฝ่ายวางแผนเห็นปุ่มปิดงานเพิ่ม เหมือนหน้า BOM
  const planner = load({ employee: emp("PP") });
  planner.store.setUser("B03");
  const plannerHtml = await planner.open("FACTORY_GR");
  assert.match(plannerHtml, /data-rf-open="jobClose"/);
  const plannerWork = await planner.context.MNP_BOM_PAGES.work(planner.context.MNP_BOM.context(new URLSearchParams("p=work&dept=GR")));
  assert.deepEqual(plain(buttonsByCard(plannerHtml)), plain(buttonsByCard(plannerWork.html)));
  // ไม่มีงาน: บรรทัดเดียว
  const emptied = load({ employee: emp("GR") });
  emptied.store.data().jobs = [];
  assert.match(await emptied.open("FACTORY_GR"), /ไม่มีงานของ GR ค้างอยู่/);
});

test("the done tab lists finished jobs of the department; the to-do tab leaves them out", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const data = env.store.data();
  const job = data.jobs.find((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done");
  const doneBefore = data.jobs.filter((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status === "done").length;
  const openBefore = data.jobs.filter((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done").length;
  job.status = "done";
  job.qtyDone = job.qtyPlanned;
  const doneHtml = await env.open("FACTORY_GR", "st=done");
  assert.ok(doneHtml.includes(escapeHtml(job.name)), "the finished job is on the done tab");
  assert.doesNotMatch(doneHtml, /data-rf-open|data-rf-action/, "a finished job has no buttons");
  assert.match(doneHtml, /href="#\/gr"[^>]*>ต้องทำ \d+</);
  assert.ok(doneHtml.includes(`เสร็จแล้ว ${doneBefore + 1}<`), "the tab counts the finished job");
  const openHtml = await env.open("FACTORY_GR");
  assert.equal([...openHtml.matchAll(/class="card rf-card bom-job/g)].length, openBefore - 1, "the finished job left the to-do tab");
  assert.match(openHtml, /href="#\/gr\?st=done"/);
  env.store.data().jobs = [];
  assert.match(await env.open("FACTORY_GR", "st=done"), /ยังไม่มีงานที่เสร็จ/);
});

test("production departments PT, BG and PK use the same landing: their own jobs only, with the report button", async () => {
  for (const [code, dept, userId] of [["FACTORY_PT", "PT", "B06"], ["FACTORY_BG", "BG", "B07"], ["FACTORY_GR", "GR", "B05"]]) {
    const env = load({ employee: emp(dept) });
    env.store.setUser(userId);
    const data = env.store.data();
    const open = data.jobs.filter((job) => job.dept === dept && liveOrder(data, job) && job.status !== "done");
    const html = await env.open(code);
    assert.match(html, new RegExp(`<shell path="${ROUTE[code]}"`), code);
    assert.equal([...html.matchAll(/class="card rf-card bom-job/g)].length, open.length, `${dept}: one card per open job`);
    assert.match(html, /<span class="small muted" role="status" data-bom-sync>/);
    if (open.length) assert.match(html, /data-rf-open="jobReport"/);
  }
  // PK: ผู้วางแผนเห็นงาน PK ของใบที่ปล่อยผลิต พร้อมปุ่มรายงานผล
  const pk = load({ employee: emp("PP") });
  pk.store.setUser("B03");
  const data = pk.store.data();
  const open = data.jobs.filter((job) => job.dept === "PK" && liveOrder(data, job) && job.status !== "done");
  const html = await pk.open("FACTORY_PK");
  assert.equal([...html.matchAll(/class="card rf-card bom-job/g)].length, open.length);
  assert.match(html, /href="#\/bom\?p=work&amp;dept=PK"/);
  assert.match(html, /data-module="pk"/);
  for (const code of ["FACTORY_PT", "FACTORY_BG", "FACTORY_PK"]) assert.doesNotMatch(read(`modules/module-${code.slice(-2).toLowerCase()}.js`), /แท่งยาว/);
});

const ctxCanReport = (job) => job.status !== "hold" && !job.externalRef;
// หน้าแรกของแผนกผูกคำสั่งจริงของ BOM: ปุ่มเปิด dialog, ปุ่มสั่งงาน (resume) ทำงานกับ store แล้ววาดหน้าใหม่ · ถูกปฏิเสธ = แจ้งผิดพลาด ไม่วาดใหม่
test("a department page binds the real BOM actions once: report opens the dialog, resume runs the action and redraws, a refused action toasts and does not redraw", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const data = env.store.data();
  const openJobs = data.jobs.filter((entry) => entry.dept === "GR" && liveOrder(data, entry) && entry.status !== "done" && ctxCanReport(entry));
  assert.ok(openJobs.length >= 2, "two open GR jobs: one is put on hold, the other is reported");
  const [job, other] = openJobs;
  assert.equal(env.store.run("reportJob", { jobId: job.id, qtyDone: 1, qtyReject: 0 }).ok, true);
  assert.equal(env.store.run("setJobStatus", { jobId: job.id, status: "hold", reason: "รอแม่พิมพ์" }).ok, true);
  assert.equal(env.store.data().jobs.find((entry) => entry.id === job.id).status, "hold");
  const html = await env.open("FACTORY_GR");
  assert.match(html, /data-rf-action="setJobStatus"/);
  // ตัวผูกถูกเรียกครั้งเดียวต่อปุ่ม: ใส่ปุ่มปลอมตามที่หน้าวาดไว้
  const argsOf = (text) => JSON.parse(text.replaceAll("&quot;", '"'));
  const resumeArgs = argsOf(html.match(/data-rf-action="setJobStatus" data-rf-args="([^"]+)"/)[1]);
  const button = (dataset) => ({ handlers: {}, dataset, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const resume = button({ rfAction: "setJobStatus", rfArgs: JSON.stringify(resumeArgs), rfSuccess: "" });
  const refused = button({ rfAction: "setJobStatus", rfArgs: JSON.stringify({ jobId: "NO-SUCH-JOB", status: "queued" }) });
  const open = button({ rfOpen: "jobReport", rfArgs: JSON.stringify({ jobId: other.id }) });
  const searchForm = { handlers: {}, dataset: {}, __values: { q: "x" }, addEventListener(type, handler) { this.handlers[type] = handler; } };
  env.fakes["[data-rf-action]"] = [resume, refused];
  env.fakes["[data-rf-open]"] = [open];
  env.fakes["form[data-rf-search]"] = [searchForm];
  // dialog: ใส่ host จำลองที่รับ HTML แล้วคืน dialog จำลอง
  let dialogHtml = "";
  const dialog = { tagName: "DIALOG", handlers: {}, dataset: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], close() {}, remove() {}, showModal() { this.shown = true; }, setAttribute() {} };
  env.root.insertAdjacentHTML = (_where, text) => { dialogHtml = text; env.root.lastElementChild = dialog; };
  await env.open("FACTORY_GR");
  assert.equal(Object.keys(searchForm.handlers).length, 1, "the search form is bound exactly once (no double binding)");
  env.log.renders = 0;
  await open.handlers.click();
  assert.match(dialogHtml, /data-rf-form="reportJob"/, "report opens the real dialog from the dept page");
  assert.equal(dialog.shown, true);
  await refused.handlers.click();
  assert.deepEqual(env.log.toasts.at(-1)[1], "error", "a refused action says why");
  assert.equal(env.log.renders, 0, "and nothing is redrawn");
  await resume.handlers.click();
  assert.equal(env.store.data().jobs.find((entry) => entry.id === job.id).status, resumeArgs.status, "the action ran against the BOM store");
  assert.equal(resume.disabled, true);
  assert.equal(env.log.renders, 1, "the page is redrawn after the action");
});

test("typing in a department page's dialog is protected like a BOM form: the browser asks before the tab closes", async () => {
  const env = load({ employee: emp("GR") });
  env.store.setUser("B05");
  const control = (extra = {}) => ({ name: "qtyDone", type: "number", tagName: "INPUT", value: "5", defaultValue: "", disabled: false, closest: () => null, ...extra });
  env.context.document.querySelectorAll = () => [control()];
  const fire = () => { const event = { prevented: false, returnValue: undefined, preventDefault() { this.prevented = true; } }; env.log.listeners.beforeunload[0](event); return event; };
  env.log.hash = "#/gr";
  assert.deepEqual([fire().prevented, fire().returnValue], [true, ""]);
  env.log.hash = "#/requests";
  assert.equal(fire().prevented, false);
  env.log.hash = "#/gr";
  env.context.document.querySelectorAll = () => [control({ value: "", defaultValue: "" })];
  assert.equal(fire().prevented, false, "nothing typed: no warning");
});

test("the store subscription of module-bom repaints a department route and the kit no longer registers a second watcher", () => {
  const kit = read("modules/factory-kit.js");
  assert.doesNotMatch(kit, /store\.subscribe/, "one repaint path: module-bom.js");
  const bom = read("modules/module-bom.js");
  assert.match(bom, /const onOwnRoute = \(\) => onBomRoute\(\) \|\| Boolean\(window\.MNP_FACTORY\?\.onDeptRoute\?\.\(\)\);/);
  assert.match(bom, /store\.subscribe\(\(event\) => \{\r?\n    if \(!onOwnRoute\(\)\) return;/);
});

test("QA shows the rod lots held for a decision and the RubberFlow lots held in the line, each with one link to where the decision is made", async () => {
  const env = load({ employee: emp("QA") });
  assert.match(await env.open("FACTORY_QA"), /ไม่มียางเส้นยาวที่กักรอตัดสิน/);
  // SR รับล็อตที่ไม่ผ่านขนาด → กักรอ QA
  env.store.setUser("B11");
  const pending = env.store.data().rodLots.find((lot) => lot.status === "pending");
  const outcome = env.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก" });
  assert.equal(outcome.ok, true, String(outcome.error?.message ?? ""));
  env.store.setUser("B12");
  const html = await env.open("FACTORY_QA");
  assert.ok(html.includes(escapeHtml(pending.lotNo)), "the held rod lot is listed");
  assert.match(html, /ยางเส้นยาวที่กักรอตัดสิน/);
  assert.match(html, /ล็อตในสายผลิตที่กักรอตัดสิน/);
  const rfHeld = env.rf.store.data().lots.filter((lot) => lot.qc === "hold");
  assert.ok(rfHeld.length >= 1, "the RubberFlow demo seed holds a lot");
  for (const lot of rfHeld) assert.ok(html.includes(escapeHtml(lot.id)), `RubberFlow lot ${lot.id} is listed`);
  assert.equal([...html.matchAll(/href="#\/bom\?p=work&amp;dept=QA"/g)].length, 1);
  assert.equal([...html.matchAll(/href="#\/rubberflow\?p=quality"/g)].length, 1);
});

test("a database store that is still loading or failed shows one short line, never an empty or broken page", async () => {
  const env = load({ employee: emp("SR") });
  env.store.status = () => "loading";
  assert.match(await env.open("FACTORY_SR"), /กำลังโหลดข้อมูล…/);
  env.store.status = () => "error";
  env.store.error = () => ({ message: "เชื่อมต่อไม่ได้" });
  const html = await env.open("FACTORY_SR");
  assert.match(html, /โหลดข้อมูล BOM ไม่สำเร็จ/);
  assert.match(html, /data-factory-retry/);
  assert.match(html, /เชื่อมต่อไม่ได้/);
});

test("the new scripts load before app.js with the one ?v= of every entry, and the harness serves what index.html lists", () => {
  const html = read("index.html");
  const versions = new Set([...html.matchAll(/\?v=([^"]+)"/g)].map((match) => match[1]));
  assert.equal(versions.size, 1, "every ?v= is the same");
  const order = [...html.matchAll(/<script defer src="\.\/([^"?]+)/g)].map((match) => match[1]);
  const at = (file) => order.indexOf(file);
  assert.ok(at("modules/factory-kit.js") >= 0);
  for (const file of DEPT_FILES) {
    assert.ok(at(file) > at("modules/factory-kit.js") && at(file) > at("modules/module-bom.js") && at(file) < at("app.js"), `${file} loads after the kit and BOM, before app.js`);
  }
  assert.match(read("scripts/pilot-harness.mjs"), /\.matchAll\(\/<script defer src=/, "the harness takes its script list from index.html");
});

// ---- งานที่รอของแผนกไม่ขึ้นกับผู้เปิดหน้า · RubberFlow โหลดไม่สำเร็จ ----
// ทำให้ใบที่ปล่อยผลิตแล้วมีสินค้ารอ WH รับเข้า: งาน PK ทุกงานเสร็จ ทำครบตามจำนวนแผน
function makeReceivable(env) {
  const data = env.store.data();
  const order = data.orders.find((entry) => entry.status === "released" || entry.status === "in_progress");
  for (const job of data.jobs.filter((entry) => entry.orderId === order.id && entry.dept === "PK")) { job.qtyDone = job.qtyPlanned; job.status = "done"; }
  return order;
}

test("WH shows the warehouse's pending receive to whoever opens it: PP and a manager see the same task as the WH staff", async () => {
  const seen = {};
  for (const [label, employee, bomUser] of [["WH", emp("WH"), "B09"], ["PP", emp("PP"), "B03"], ["manager", emp("PP", "factory_manager"), "B10"]]) {
    const env = load({ employee });
    env.store.setUser(bomUser);
    const order = makeReceivable(env);
    const html = await env.open("FACTORY_WH");
    seen[label] = html;
    assert.match(html, /รอรับเข้าคลัง/, `${label} sees the pending receive`);
    assert.ok(html.includes(escapeHtml(order.id)), `${label} sees the order ${order.id}`);
    assert.doesNotMatch(html, /ไม่มีงานค้าง/);
  }
  assert.equal(seen.PP.slice(seen.PP.indexOf("งานที่รอ")), seen.WH.slice(seen.WH.indexOf("งานที่รอ")), "the task card is the same for WH and PP");
});

test("SR shows the store's pending rod receipts to a planner as well, computed for the department, with the buttons a planner has in BOM", async () => {
  const env = load({ employee: emp("PP") });
  env.store.setUser("B03");
  const pending = env.store.data().rodLots.filter((lot) => lot.status === "pending");
  assert.ok(pending.length >= 1);
  const html = await env.open("FACTORY_SR");
  assert.doesNotMatch(html, /ไม่มีงานค้าง/);
  assert.match(html, /งานที่รอ/);
  assert.match(html, /data-rf-open="rodReceive"/, "a planner may receive rods, as in BOM");
});

test("when RubberFlow failed to load, ST and QA show one line in place of the RubberFlow part, not an empty table", async () => {
  for (const [code, dept] of [["FACTORY_ST", "ST"], ["FACTORY_QA", "QA"]]) {
    const env = load({ employee: emp(dept) });
    const rf = env.rf.store;
    rf.isRemote = () => true;
    rf.status = () => "error";
    rf.error = () => ({ message: "เชื่อมต่อไม่ได้" });
    const html = await env.open(code);
    assert.equal([...html.matchAll(/โหลดข้อมูล RubberFlow ไม่สำเร็จ/g)].length, 1, `${code} shows the failure once`);
    assert.doesNotMatch(html, /กำลังโหลดข้อมูล RubberFlow/);
    assert.doesNotMatch(html, code === "FACTORY_QA" ? /ไม่มีล็อตที่กักรอตัดสิน/ : /ไม่มีงานค้าง/, "no empty table in its place");
  }
});

// ---- โมดูลคลัง / ตรวจคุณภาพ (SR ST WH QA): การ์ดสั่งงานชุดเดียวกับ BOM "งานของฉัน" ----
const cardsOf = (html) => html.match(/<article class="card rf-card bom-job[\s\S]*?<\/article>/g) ?? [];
const workPage = async (env, query = "p=work") => env.context.MNP_BOM_PAGES.work(env.context.MNP_BOM.context(new URLSearchParams(query)));
const decodeArgs = (text) => JSON.parse(text.replaceAll("&quot;", '"'));
const openButtonsOf = (html) => [...html.matchAll(/data-rf-open="(\w+)" data-rf-args="([^"]*)"/g)].map((match) => ({ name: match[1], handlers: {}, dataset: { rfOpen: match[1], rfArgs: JSON.stringify(decodeArgs(match[2])) }, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } }));

// เปิดหน้าแผนก ผูกปุ่มของการ์ดที่วาดไว้ และเตรียม dialog จำลองที่รับ HTML ของ dialog ที่เปิด แล้วส่งฟอร์มของ dialog เหมือนผู้ใช้
async function landingWith(env, code) {
  const buttons = openButtonsOf(await env.open(code));
  env.fakes["[data-rf-open]"] = buttons;
  const shown = { html: "", forms: [] };
  const dialog = { tagName: "DIALOG", dataset: {}, addEventListener() {}, querySelector: () => null, querySelectorAll: (selector) => (selector === "form[data-rf-form]" ? shown.forms : []), close() {}, remove() {}, showModal() { this.shown = true; }, setAttribute() {} };
  env.root.insertAdjacentHTML = (_where, text) => {
    shown.html = text;
    shown.forms.length = 0;
    const match = text.match(/data-rf-form="(\w+)" data-rf-args="([^"]*)"/);
    if (match) shown.forms.push({ handlers: {}, dataset: { rfForm: match[1], rfArgs: JSON.stringify(decodeArgs(match[2])), rfSuccess: "" }, __values: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, closest: () => null, querySelectorAll: () => [] });
    env.root.lastElementChild = dialog;
  };
  env.context.MNP_RUBBERFLOW_UI.validateForm = () => true; // ตรวจช่องใต้ฟอร์มเป็นของ UI กลาง (ไม่ใช่เรื่องของการทดสอบนี้)
  const html = await env.open(code);
  return {
    html, buttons, shown,
    click: async (name) => { shown.html = ""; await buttons.find((button) => button.name === name).handlers.click(); return shown.html; },
    submit: async (values) => { const [form] = shown.forms; form.__values = values; await form.handlers.submit({ preventDefault() {}, submitter: null }); },
  };
}

test("SR: the landing shows the same task cards as BOM งานของฉัน for the same user; a click opens the real dialog and a submit runs the action", async () => {
  const env = load({ employee: emp("SR") });
  env.store.setUser("B11");
  const bom = cardsOf((await workPage(env)).html);
  assert.ok(bom.length >= 4, "two lots wait for receiving and several orders wait for rods");
  const page = await landingWith(env, "FACTORY_SR");
  assert.deepEqual(plain(cardsOf(page.html)), plain(bom), "the same cards, in the same order");
  assert.ok(page.html.indexOf("ยางเส้นยาวในคลัง") < page.html.indexOf("งานที่รอ"), "the stock stays first");
  assert.equal([...page.html.matchAll(/รอรับเข้าคลัง/g)].length >= 2, true);
  assert.doesNotMatch(page.html, /แท่ง/, "ยางเส้นยาว, not แท่ง, on the cards");
  const receive = await page.click("rodReceive");
  assert.match(receive, /data-rf-form="receiveRods"/);
  assert.match(receive, /รับยางเส้นยาวเข้าคลัง/);
  assert.doesNotMatch(receive, /แท่ง/);
  const issue = await page.click("rodIssue");
  assert.match(issue, /data-rf-form="issueRods"/);
  assert.match(issue, /จ่ายยางเส้นยาวให้ GR/);
  assert.doesNotMatch(issue, /แท่ง/);
  const before = env.store.data().rodMoves.length;
  env.log.renders = 0;
  await page.submit({ qty: "2" });
  assert.equal(env.store.data().rodMoves.length, before + 1, "the submit ran issueRods against the BOM store");
  assert.ok(env.log.renders >= 1, "and the page was redrawn");
  // ฝ่ายวางแผนเห็นการ์ดชุดเดียวกับที่ BOM ให้ฝ่ายวางแผนดูแผนก SR
  const planner = load({ employee: emp("PP") });
  planner.store.setUser("B03");
  const plannerBom = cardsOf((await workPage(planner, "p=work&dept=SR")).html);
  assert.deepEqual(plain(cardsOf(await planner.open("FACTORY_SR"))), plain(plannerBom));
  // ผู้ที่ไม่ใช่ SR / ฝ่ายวางแผน เปิดโมดูลได้แต่การ์ดดูอย่างเดียว (ไม่มีปุ่มที่ฐานข้อมูลจะปฏิเสธ)
  const manager = load({ employee: emp("PP", "factory_manager") });
  manager.store.setUser("B08"); // บัญชีคลังวัตถุดิบ (ST): ไม่ใช่ SR และไม่ใช่ฝ่ายวางแผน
  const readOnly = await manager.open("FACTORY_SR");
  assert.match(readOnly, /รอรับเข้าคลัง/);
  assert.doesNotMatch(readOnly, /data-rf-open="(rodReceive|rodIssue)"/);
  assert.match(readOnly, /ดูอย่างเดียว/);
});

test("QA: held rod lots are cards with the decide button, the RubberFlow held lots keep their link, and a submit decides the lot", async () => {
  const env = load({ employee: emp("QA") });
  env.store.setUser("B11");
  const pending = env.store.data().rodLots.find((lot) => lot.status === "pending");
  assert.equal(env.store.run("receiveRods", { lotId: pending.id, qtyReceived: pending.qtySent, values: { thickness: 99, width: 99, weightPerM: 9999 }, note: "ขนาดเกินสเปก" }).ok, true);
  env.store.setUser("B12");
  const bom = cardsOf((await workPage(env)).html);
  assert.equal(bom.length, 1, "one held lot waits for QA");
  const page = await landingWith(env, "FACTORY_QA");
  assert.deepEqual(plain(cardsOf(page.html)), plain(bom));
  assert.match(page.html, /data-rf-open="rodDecide"/);
  assert.equal([...page.html.matchAll(/href="#\/rubberflow\?p=quality"/g)].length, 1, "the RubberFlow held lots keep their one link");
  assert.match(page.html, /ล็อตในสายผลิตที่กักรอตัดสิน/);
  assert.doesNotMatch(page.html, /แท่ง/);
  const dialog = await page.click("rodDecide");
  assert.match(dialog, /data-rf-form="decideRods"/);
  assert.doesNotMatch(dialog, /แท่ง/);
  await page.submit({ decision: "accept", note: "ใช้ได้ตามสภาพ" });
  assert.equal(env.store.data().rodLots.find((lot) => lot.id === pending.id).status, "stored", "the decision ran against the BOM store");
  assert.match(await env.open("FACTORY_QA"), /ไม่มียางเส้นยาวที่กักรอตัดสิน/);
});

// ใบที่ปล่อยผลิตแล้วที่ PK ทำไม่ครบตามสั่งและรับเข้าคลังแล้ว (ปิดใบแบบรับไม่ครบได้)
function makeShortClosable(env) {
  const data = env.store.data();
  const rules = env.context.MNP_BOM_RULES;
  const order = data.orders.find((entry) => (entry.status === "released" || entry.status === "in_progress") && data.jobs.some((job) => job.orderId === entry.id && job.dept === "PK"));
  for (const job of data.jobs.filter((entry) => entry.orderId === order.id && !(entry.dept === "ST" && entry.kind === "PURCHASED"))) { job.status = "done"; job.qtyDone = job.dept === "PK" ? 1 : job.qtyPlanned; }
  data.fgMoves = rules.fgPosition(data, order).products.filter((product) => product.pkDone > 0).map((product, index) => ({ id: `s${index}`, orderId: order.id, fgCode: product.fgCode, kind: "receive", qty: product.pkDone, at: 1 + index, by: "x" }));
  assert.equal(rules.fgPosition(data, order).canCloseShort, true, "the order can be closed short");
  return order;
}

test("WH: the landing shows the same task cards as BOM งานของฉัน for the same user; close short opens its dialog and a submit closes the order; others see the card read-only", async () => {
  const env = load({ employee: emp("WH") });
  env.store.setUser("B09");
  const order = makeShortClosable(env);
  const bom = cardsOf((await workPage(env)).html);
  assert.ok(bom.some((card) => card.includes("ปิดใบ (รับไม่ครบ)")), "BOM offers close short");
  const page = await landingWith(env, "FACTORY_WH");
  assert.deepEqual(plain(cardsOf(page.html)), plain(bom));
  assert.ok(page.html.indexOf("สินค้าสำเร็จรูปในคลัง") < page.html.indexOf("งานที่รอ"));
  const dialog = await page.click("closeShort");
  assert.match(dialog, /data-rf-form="closeOrderShort"/);
  await page.submit({ note: "PK ทำไม่ครบ ลูกค้าตกลงรับเท่าที่มี" });
  assert.equal(env.store.data().orders.find((entry) => entry.id === order.id).status, "completed", "the submit ran closeOrderShort");
  // ฝ่ายวางแผนเห็นงานของ WH เหมือนกัน แต่ปิดใบรับไม่ครบไม่ได้ (admin / WH เท่านั้น): การ์ดดูอย่างเดียว ไม่มีปุ่ม
  const planner = load({ employee: emp("PP") });
  planner.store.setUser("B03");
  makeShortClosable(planner);
  const html = await planner.open("FACTORY_WH");
  assert.match(html, /ปิดใบ \(รับไม่ครบ\)|รอปิดใบ/);
  assert.doesNotMatch(html, /data-rf-open="closeShort"/);
  assert.match(html, /ดูอย่างเดียว/);
});

test("ST: the landing shows the same task cards as BOM งานของฉัน for the same user, including the parts issue card; return opens its dialog and a submit goes through the form transform", async () => {
  const env = load({ employee: emp("ST") });
  env.store.setUser("B08");
  const before = cardsOf((await workPage(env)).html);
  const issue = before.find((card) => card.includes("เบิกของตามใบ"));
  assert.ok(issue, "a released order waits for its purchased parts");
  assert.match(issue, /เบิกจ่ายที่ใบสั่งผลิต/);
  assert.deepEqual(plain(cardsOf(await env.open("FACTORY_ST"))), plain(before), "the issue card and the RubberFlow tasks are the same as in BOM");
  // ใบที่ยกเลิกแล้วที่เบิกของไปแล้ว: การ์ดคืนของเหลือ
  const data = env.store.data();
  const job = data.jobs.find((entry) => entry.dept === "ST" && entry.kind === "PURCHASED");
  data.orders.find((order) => order.id === job.orderId).status = "cancelled";
  job.status = "done";
  job.qtyDone = job.qtyPlanned;
  const bom = cardsOf((await workPage(env)).html);
  assert.ok(bom.some((card) => card.includes("คืนของซื้อที่เบิกไปแล้ว")));
  const page = await landingWith(env, "FACTORY_ST");
  assert.deepEqual(plain(cardsOf(page.html)), plain(bom));
  assert.ok(page.html.indexOf("ของซื้อในคลัง") < page.html.indexOf("งานที่รอ"));
  assert.doesNotMatch(page.html, /แท่ง/);
  const dialog = await page.click("returnParts");
  assert.match(dialog, /data-rf-form="returnOrderParts"/);
  const moves = (env.store.data().stockMoves ?? []).length;
  await page.submit({ "itemCode[]": job.itemCode, "qty[]": "0.5", reason: "เหลือจากการผลิต" });
  assert.equal((env.store.data().stockMoves ?? []).length, moves + 1, "the lines came from the form through the BOM transform and the action ran");
});

test("the task cards are drawn once (bom-hub taskCard / boardCards); the department files only place the shared section", () => {
  const hub = read("modules/bom-hub.js");
  assert.match(hub, /function taskCard\(ctx, task, \{ planner, dept \}\)/);
  assert.match(hub, /const \{ taskCards, cards \} = boardCards\(ctx, board\);/, "BOM work page uses it too");
  assert.match(read("modules/factory-kit.js"), /hub\.boardCards\(ctx, board\)/);
  for (const dept of ["sr", "st", "wh", "qa"]) {
    const source = read(`modules/module-${dept}.js`);
    assert.match(source, /F\.deptWorkSection\(ctx/, `${dept} places the shared section`);
    assert.match(source, /actions: true/, `${dept} asks for the real actions`);
    assert.doesNotMatch(source, /bom-job|openButton|data-rf-open|taskTable/, `${dept} keeps no copy of the card HTML`);
  }
});
